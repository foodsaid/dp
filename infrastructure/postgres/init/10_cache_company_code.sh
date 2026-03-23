#!/bin/bash
# ============================================================================
# DP v0.5 — 缓存表补 company_code 迁移脚本
# 已有数据回填 DP_COMPANY_CODE，新建复合主键
# 适用于已有部署的在线迁移 (分批 UPDATE 防长锁)
# ============================================================================

set -e

COMPANY="${DP_COMPANY_CODE:-DEFAULT}"
DB_NAME="${POSTGRES_DB:-dp}"
DB_USER="${POSTGRES_USER:-dp_app}"

echo "=== [DP] 缓存表 company_code 迁移 (公司: $COMPANY) ==="

psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
    -v company="$COMPANY" <<'SQL'

-- ============================================================================
-- 幂等检查: 如果 company_code 列已存在则跳过
-- ============================================================================
DO $$
BEGIN
    -- wms_items_cache
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'wms' AND table_name = 'wms_items_cache' AND column_name = 'company_code'
    ) THEN
        RAISE NOTICE '>>> 迁移 wms_items_cache: 添加 company_code';

        ALTER TABLE wms.wms_items_cache ADD COLUMN company_code VARCHAR(20);

        -- 分批回填 (ctid 子查询，防长锁)
        LOOP
            WITH batch AS (
                SELECT ctid FROM wms.wms_items_cache
                WHERE company_code IS NULL LIMIT 10000
                FOR UPDATE SKIP LOCKED
            )
            UPDATE wms.wms_items_cache t
            SET company_code = :'company'
            FROM batch WHERE t.ctid = batch.ctid;

            EXIT WHEN NOT FOUND;
            PERFORM pg_sleep(0.05);
        END LOOP;

        ALTER TABLE wms.wms_items_cache ALTER COLUMN company_code SET NOT NULL;
        ALTER TABLE wms.wms_items_cache ADD CHECK (TRIM(company_code) <> '');
        ALTER TABLE wms.wms_items_cache DROP CONSTRAINT wms_items_cache_pkey;
        ALTER TABLE wms.wms_items_cache ADD PRIMARY KEY (company_code, item_code);

        RAISE NOTICE '>>> wms_items_cache 迁移完成';
    ELSE
        RAISE NOTICE '>>> wms_items_cache: company_code 已存在，跳过';
    END IF;

    -- wms_locations_cache
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'wms' AND table_name = 'wms_locations_cache' AND column_name = 'company_code'
    ) THEN
        RAISE NOTICE '>>> 迁移 wms_locations_cache: 添加 company_code';

        ALTER TABLE wms.wms_locations_cache ADD COLUMN company_code VARCHAR(20);

        LOOP
            WITH batch AS (
                SELECT ctid FROM wms.wms_locations_cache
                WHERE company_code IS NULL LIMIT 10000
                FOR UPDATE SKIP LOCKED
            )
            UPDATE wms.wms_locations_cache t
            SET company_code = :'company'
            FROM batch WHERE t.ctid = batch.ctid;

            EXIT WHEN NOT FOUND;
            PERFORM pg_sleep(0.05);
        END LOOP;

        ALTER TABLE wms.wms_locations_cache ALTER COLUMN company_code SET NOT NULL;
        ALTER TABLE wms.wms_locations_cache ADD CHECK (TRIM(company_code) <> '');
        ALTER TABLE wms.wms_locations_cache DROP CONSTRAINT wms_locations_cache_pkey;
        ALTER TABLE wms.wms_locations_cache ADD PRIMARY KEY (company_code, whs_code);

        RAISE NOTICE '>>> wms_locations_cache 迁移完成';
    ELSE
        RAISE NOTICE '>>> wms_locations_cache: company_code 已存在，跳过';
    END IF;

    -- wms_bins_cache
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'wms' AND table_name = 'wms_bins_cache' AND column_name = 'company_code'
    ) THEN
        RAISE NOTICE '>>> 迁移 wms_bins_cache: 添加 company_code';

        ALTER TABLE wms.wms_bins_cache ADD COLUMN company_code VARCHAR(20);

        LOOP
            WITH batch AS (
                SELECT ctid FROM wms.wms_bins_cache
                WHERE company_code IS NULL LIMIT 10000
                FOR UPDATE SKIP LOCKED
            )
            UPDATE wms.wms_bins_cache t
            SET company_code = :'company'
            FROM batch WHERE t.ctid = batch.ctid;

            EXIT WHEN NOT FOUND;
            PERFORM pg_sleep(0.05);
        END LOOP;

        ALTER TABLE wms.wms_bins_cache ALTER COLUMN company_code SET NOT NULL;
        ALTER TABLE wms.wms_bins_cache ADD CHECK (TRIM(company_code) <> '');
        ALTER TABLE wms.wms_bins_cache DROP CONSTRAINT wms_bins_cache_pkey;
        ALTER TABLE wms.wms_bins_cache ADD PRIMARY KEY (company_code, bin_code);

        -- 重建索引 (company_code 最左前缀)
        DROP INDEX IF EXISTS wms.idx_bins_whs;
        CREATE INDEX idx_bins_whs ON wms.wms_bins_cache (company_code, whs_code);

        RAISE NOTICE '>>> wms_bins_cache 迁移完成';
    ELSE
        RAISE NOTICE '>>> wms_bins_cache: company_code 已存在，跳过';
    END IF;
END $$;

-- 添加 enforce_company_code 触发器 (幂等)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_items_cache_enforce_cc') THEN
        CREATE TRIGGER trg_items_cache_enforce_cc
            BEFORE INSERT OR UPDATE ON wms.wms_items_cache
            FOR EACH ROW EXECUTE FUNCTION wms.fn_enforce_company_code();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_locations_cache_enforce_cc') THEN
        CREATE TRIGGER trg_locations_cache_enforce_cc
            BEFORE INSERT OR UPDATE ON wms.wms_locations_cache
            FOR EACH ROW EXECUTE FUNCTION wms.fn_enforce_company_code();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_bins_cache_enforce_cc') THEN
        CREATE TRIGGER trg_bins_cache_enforce_cc
            BEFORE INSERT OR UPDATE ON wms.wms_bins_cache
            FOR EACH ROW EXECUTE FUNCTION wms.fn_enforce_company_code();
    END IF;
END $$;

-- 脏数据检查
SELECT 'wms_items_cache' AS tbl, COUNT(*) AS null_cc FROM wms.wms_items_cache WHERE company_code IS NULL
UNION ALL
SELECT 'wms_locations_cache', COUNT(*) FROM wms.wms_locations_cache WHERE company_code IS NULL
UNION ALL
SELECT 'wms_bins_cache', COUNT(*) FROM wms.wms_bins_cache WHERE company_code IS NULL;

SQL

echo "=== [DP] 缓存表 company_code 迁移完成 ==="
