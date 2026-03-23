#!/bin/bash
# =============================================================================
# 12_child_table_company_code.sh — 子表 (document_lines/order_lines) 补 company_code
# v0.6: 加列 + 从父表回填 + NOT NULL + CHECK + 触发器
# 幂等: 列已存在则跳过
# =============================================================================
set -e

# 默认公司代码 (回填用)
dp_cc="${DP_COMPANY_CODE:-DEFAULT}"
echo "12_child_table_company_code.sh: 开始子表 company_code 迁移 (cc=${dp_cc})..."

psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'

-- ============================================================================
-- wms.wms_document_lines: 加 company_code
-- ============================================================================
DO $$
DECLARE cnt INT;
BEGIN
    -- 1. 加列 (幂等)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'wms' AND table_name = 'wms_document_lines'
              AND column_name = 'company_code'
    ) THEN
        RAISE NOTICE '>>> wms_document_lines: 添加 company_code 列';
        ALTER TABLE wms.wms_document_lines ADD COLUMN company_code VARCHAR(20);

        -- 2. 从父表回填 (ctid 分批)
        LOOP
            WITH batch AS (
                SELECT l.ctid
                FROM wms.wms_document_lines l
                WHERE l.company_code IS NULL
                LIMIT 5000
                FOR UPDATE SKIP LOCKED
            )
            UPDATE wms.wms_document_lines l
            SET company_code = d.company_code
            FROM batch, wms.wms_documents d
            WHERE l.ctid = batch.ctid AND l.document_id = d.id;
            GET DIAGNOSTICS cnt = ROW_COUNT;
            EXIT WHEN cnt = 0;
            RAISE NOTICE '>>>   回填 % 行', cnt;
            PERFORM pg_sleep(0.05);
        END LOOP;

        -- 3. NOT NULL + CHECK
        ALTER TABLE wms.wms_document_lines ALTER COLUMN company_code SET NOT NULL;
        ALTER TABLE wms.wms_document_lines ADD CHECK (TRIM(company_code) <> '');

        -- 4. 索引
        CREATE INDEX idx_wms_lines_cc_docid
            ON wms.wms_document_lines (company_code, document_id);

        RAISE NOTICE '>>> wms_document_lines: company_code 迁移完成';
    ELSE
        RAISE NOTICE '>>> wms_document_lines: company_code 已存在, 跳过';
    END IF;
END $$;

-- 触发器: cc 不可变
DROP TRIGGER IF EXISTS trg_wms_document_lines_cc_immutable ON wms.wms_document_lines;
CREATE TRIGGER trg_wms_document_lines_cc_immutable
    BEFORE UPDATE ON wms.wms_document_lines
    FOR EACH ROW EXECUTE FUNCTION wms.fn_immutable_company_code();

-- 触发器: fn_enforce_company_code (NOT NULL + TRIM)
DROP TRIGGER IF EXISTS trg_lines_enforce_cc ON wms.wms_document_lines;
CREATE TRIGGER trg_lines_enforce_cc
    BEFORE INSERT OR UPDATE ON wms.wms_document_lines
    FOR EACH ROW EXECUTE FUNCTION wms.fn_enforce_company_code();

-- ============================================================================
-- oms.order_lines: 加 company_code
-- ============================================================================
DO $$
DECLARE cnt INT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'oms' AND table_name = 'order_lines'
              AND column_name = 'company_code'
    ) THEN
        RAISE NOTICE '>>> oms.order_lines: 添加 company_code 列';
        ALTER TABLE oms.order_lines ADD COLUMN company_code VARCHAR(20);

        -- 从父表回填
        LOOP
            WITH batch AS (
                SELECT l.ctid
                FROM oms.order_lines l
                WHERE l.company_code IS NULL
                LIMIT 5000
                FOR UPDATE SKIP LOCKED
            )
            UPDATE oms.order_lines l
            SET company_code = o.company_code
            FROM batch, oms.orders o
            WHERE l.ctid = batch.ctid AND l.order_id = o.id;
            GET DIAGNOSTICS cnt = ROW_COUNT;
            EXIT WHEN cnt = 0;
            RAISE NOTICE '>>>   回填 % 行', cnt;
            PERFORM pg_sleep(0.05);
        END LOOP;

        -- NOT NULL + CHECK
        ALTER TABLE oms.order_lines ALTER COLUMN company_code SET NOT NULL;
        ALTER TABLE oms.order_lines ADD CHECK (TRIM(company_code) <> '');

        -- 索引
        CREATE INDEX idx_oms_lines_cc_orderid
            ON oms.order_lines (company_code, order_id);

        RAISE NOTICE '>>> oms.order_lines: company_code 迁移完成';
    ELSE
        RAISE NOTICE '>>> oms.order_lines: company_code 已存在, 跳过';
    END IF;
END $$;

-- 触发器: cc 不可变
DROP TRIGGER IF EXISTS trg_order_lines_cc_immutable ON oms.order_lines;
CREATE TRIGGER trg_order_lines_cc_immutable
    BEFORE UPDATE ON oms.order_lines
    FOR EACH ROW EXECUTE FUNCTION wms.fn_immutable_company_code();

-- 触发器: fn_enforce_company_code (NOT NULL + TRIM)
DROP TRIGGER IF EXISTS trg_order_lines_enforce_cc ON oms.order_lines;
CREATE TRIGGER trg_order_lines_enforce_cc
    BEFORE INSERT OR UPDATE ON oms.order_lines
    FOR EACH ROW EXECUTE FUNCTION wms.fn_enforce_company_code();

-- ============================================================================
-- 自动填充函数: INSERT 时如果没传 cc, 从父表获取 (向后兼容旧工作流)
-- ============================================================================
CREATE OR REPLACE FUNCTION wms.fn_fill_child_company_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.company_code IS NULL OR TRIM(NEW.company_code) = '' THEN
        IF TG_TABLE_SCHEMA = 'wms' AND TG_TABLE_NAME = 'wms_document_lines' THEN
            NEW.company_code := (SELECT company_code FROM wms.wms_documents WHERE id = NEW.document_id);
        ELSIF TG_TABLE_SCHEMA = 'oms' AND TG_TABLE_NAME = 'order_lines' THEN
            NEW.company_code := (SELECT company_code FROM oms.orders WHERE id = NEW.order_id);
        END IF;
    END IF;
    IF NEW.company_code IS NULL THEN
        RAISE EXCEPTION 'company_code 无法从父表填充 (table: %, parent_id: %)',
            TG_TABLE_NAME, COALESCE(NEW.document_id::text, NEW.order_id::text, '?');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- wms_document_lines 自动填充 (触发器名 trg_fill 字母序在 trg_lines 前, 先执行)
DROP TRIGGER IF EXISTS trg_fill_child_cc ON wms.wms_document_lines;
CREATE TRIGGER trg_fill_child_cc
    BEFORE INSERT ON wms.wms_document_lines
    FOR EACH ROW EXECUTE FUNCTION wms.fn_fill_child_company_code();

-- oms.order_lines 自动填充
DROP TRIGGER IF EXISTS trg_fill_child_cc ON oms.order_lines;
CREATE TRIGGER trg_fill_child_cc
    BEFORE INSERT ON oms.order_lines
    FOR EACH ROW EXECUTE FUNCTION wms.fn_fill_child_company_code();

EOSQL

echo "12_child_table_company_code.sh: 子表迁移完成"
