-- ============================================================================
-- DP v0.8.0 — 数据库审计热补丁 (幂等迁移脚本)
-- 修复: TIMESTAMP→TIMESTAMPTZ · 状态字段 DEPRECATED · 索引优化
--       通用函数统一到 core Schema · 跨 Schema 触发器观测日志
-- 适用: 现有环境增量执行，所有操作严格幂等
-- 注意: 不使用全局 BEGIN/COMMIT，每段 DO 块独立事务（幂等安全）
-- ============================================================================


-- ============================================================================
-- 0. core Schema — 通用基础函数 (消除 WMS/OMS 重复定义)
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS core;
COMMENT ON SCHEMA core IS '通用基础函数（不含业务数据，仅工具函数）';

DO $$
DECLARE
    app_user TEXT := current_user;
BEGIN
    EXECUTE format('GRANT USAGE ON SCHEMA core TO %I', app_user);
    EXECUTE format('GRANT ALL ON SCHEMA core TO %I', app_user);
END $$;

-- 统一 fn_updated_at
CREATE OR REPLACE FUNCTION core.fn_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 统一 fn_synced_at
CREATE OR REPLACE FUNCTION core.fn_synced_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.synced_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 统一 fn_enforce_company_code
CREATE OR REPLACE FUNCTION core.fn_enforce_company_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.company_code IS NULL OR TRIM(NEW.company_code) = '' THEN
        RAISE EXCEPTION 'company_code cannot be empty (table: %, operation: %)',
            TG_TABLE_NAME, TG_OP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- RLS 角色授权 core Schema
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_app_rls') THEN
        GRANT USAGE ON SCHEMA core TO dp_app_rls;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_bi') THEN
        GRANT USAGE ON SCHEMA core TO dp_bi;
    END IF;
END $$;

-- 标记旧函数 DEPRECATED (保留不删，已绑定触发器依赖)
COMMENT ON FUNCTION wms.fn_updated_at() IS
    'DEPRECATED v0.8: 已统一到 core.fn_updated_at()。现有触发器绑定暂不迁移，v1.0 切换';
COMMENT ON FUNCTION wms.fn_synced_at() IS
    'DEPRECATED v0.8: 已统一到 core.fn_synced_at()。现有触发器绑定暂不迁移，v1.0 切换';
COMMENT ON FUNCTION wms.fn_enforce_company_code() IS
    'DEPRECATED v0.8: 已统一到 core.fn_enforce_company_code()。现有触发器绑定暂不迁移，v1.0 切换';
COMMENT ON FUNCTION oms.fn_updated_at() IS
    'DEPRECATED v0.8: 已统一到 core.fn_updated_at()。现有触发器绑定暂不迁移，v1.0 切换';
COMMENT ON FUNCTION oms.fn_synced_at() IS
    'DEPRECATED v0.8: 已统一到 core.fn_synced_at()。现有触发器绑定暂不迁移，v1.0 切换';
COMMENT ON FUNCTION oms.fn_enforce_company_code() IS
    'DEPRECATED v0.8: 已统一到 core.fn_enforce_company_code()。现有触发器绑定暂不迁移，v1.0 切换';


-- ============================================================================
-- 1. TIMESTAMPTZ 迁移 — WMS Schema (幂等: 仅当 data_type 为 timestamp 时执行)
-- 注意: 视图依赖列类型，必须先 DROP 再 ALTER 再 CREATE OR REPLACE
-- ============================================================================

-- 1.0 暂存: 删除依赖视图 (CREATE OR REPLACE 无法改列类型)
DROP VIEW IF EXISTS wms.v_stock_realtime;
DROP VIEW IF EXISTS wms.v_daily_activity;
DROP VIEW IF EXISTS wms.v_pending_export;
DROP VIEW IF EXISTS wms.v_document_summary;

-- --- wms_documents ---
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='wms' AND table_name='wms_documents' AND column_name='created_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE wms.wms_documents ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='wms' AND table_name='wms_documents' AND column_name='updated_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE wms.wms_documents ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='wms' AND table_name='wms_documents' AND column_name='locked_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE wms.wms_documents ALTER COLUMN locked_at TYPE TIMESTAMPTZ USING locked_at AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='wms' AND table_name='wms_documents' AND column_name='exported_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE wms.wms_documents ALTER COLUMN exported_at TYPE TIMESTAMPTZ USING exported_at AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;

-- --- wms_document_lines ---
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='wms' AND table_name='wms_document_lines' AND column_name='created_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE wms.wms_document_lines ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='wms' AND table_name='wms_document_lines' AND column_name='updated_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE wms.wms_document_lines ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;

-- --- wms_transactions ---
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='wms' AND table_name='wms_transactions' AND column_name='transaction_time' AND data_type='timestamp without time zone') THEN
    ALTER TABLE wms.wms_transactions ALTER COLUMN transaction_time TYPE TIMESTAMPTZ USING transaction_time AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;

-- --- wms_stock_snapshot ---
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='wms' AND table_name='wms_stock_snapshot' AND column_name='synced_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE wms.wms_stock_snapshot ALTER COLUMN synced_at TYPE TIMESTAMPTZ USING synced_at AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;

-- --- wms_items_cache ---
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='wms' AND table_name='wms_items_cache' AND column_name='synced_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE wms.wms_items_cache ALTER COLUMN synced_at TYPE TIMESTAMPTZ USING synced_at AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;

-- --- wms_locations_cache ---
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='wms' AND table_name='wms_locations_cache' AND column_name='synced_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE wms.wms_locations_cache ALTER COLUMN synced_at TYPE TIMESTAMPTZ USING synced_at AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;

-- --- wms_bins_cache ---
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='wms' AND table_name='wms_bins_cache' AND column_name='synced_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE wms.wms_bins_cache ALTER COLUMN synced_at TYPE TIMESTAMPTZ USING synced_at AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;

-- --- wms_users ---
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='wms' AND table_name='wms_users' AND column_name='created_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE wms.wms_users ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='wms' AND table_name='wms_users' AND column_name='updated_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE wms.wms_users ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;

-- --- wms_system_settings ---
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='wms' AND table_name='wms_system_settings' AND column_name='updated_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE wms.wms_system_settings ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;

-- --- wms_id_sequences ---
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='wms' AND table_name='wms_id_sequences' AND column_name='updated_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE wms.wms_id_sequences ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;

-- --- wms_audit_log ---
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='wms' AND table_name='wms_audit_log' AND column_name='created_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE wms.wms_audit_log ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;

-- --- wms_sessions (非 DDL 管理，由旧工作流创建) ---
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='wms' AND table_name='wms_sessions' AND column_name='created_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE wms.wms_sessions ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='wms' AND table_name='wms_sessions' AND column_name='expires_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE wms.wms_sessions ALTER COLUMN expires_at TYPE TIMESTAMPTZ USING expires_at AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;

-- --- ai.ai_embeddings ---
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='ai' AND table_name='ai_embeddings' AND column_name='created_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE ai.ai_embeddings ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;

-- ============================================================================
-- 1b. TIMESTAMPTZ 迁移 — OMS Schema
-- ============================================================================

-- --- oms.orders.synced_at ---
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='oms' AND table_name='orders' AND column_name='synced_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE oms.orders ALTER COLUMN synced_at TYPE TIMESTAMPTZ USING synced_at AT TIME ZONE 'Asia/Bangkok';
  END IF;
END $$;


-- ============================================================================
-- 1c. 重建 WMS 视图 (TIMESTAMPTZ 迁移后恢复)
-- ============================================================================

CREATE OR REPLACE VIEW wms.v_document_summary AS
SELECT
    d.id, d.company_code, d.doc_type, d.doc_number, d.sap_doc_num,
    d.status, d.wms_status, d.warehouse_code, d.business_partner, d.bp_name,
    d.created_by, d.doc_date, d.created_at, d.exported_at,
    COUNT(dl.id) AS line_count,
    COALESCE(SUM(dl.planned_qty), 0) AS total_planned,
    COALESCE(SUM(dl.actual_qty), 0) AS total_actual,
    CASE
        WHEN COALESCE(SUM(dl.planned_qty), 0) = 0 THEN 0
        ELSE ROUND(COALESCE(SUM(dl.actual_qty), 0) / SUM(dl.planned_qty) * 100, 1)
    END AS completion_pct
FROM wms.wms_documents d
LEFT JOIN wms.wms_document_lines dl ON d.id = dl.document_id
GROUP BY d.id;

CREATE OR REPLACE VIEW wms.v_pending_export AS
SELECT
    d.id, d.company_code, d.doc_type, d.doc_number, d.sap_doc_num,
    d.warehouse_code, d.business_partner, d.bp_name, d.doc_date,
    d.created_by, d.created_at,
    COUNT(dl.id) AS line_count,
    COALESCE(SUM(dl.actual_qty), 0) AS total_qty
FROM wms.wms_documents d
JOIN wms.wms_document_lines dl ON d.id = dl.document_id
WHERE d.wms_status = 'completed' AND d.exported_at IS NULL
GROUP BY d.id;

CREATE OR REPLACE VIEW wms.v_daily_activity AS
SELECT
    d.company_code,
    t.transaction_time::DATE AS activity_date,
    t.action, d.doc_type,
    COUNT(*) AS transaction_count,
    COUNT(DISTINCT t.document_id) AS document_count,
    COALESCE(SUM(t.quantity), 0) AS total_quantity
FROM wms.wms_transactions t
JOIN wms.wms_documents d ON t.document_id = d.id
GROUP BY d.company_code, t.transaction_time::DATE, t.action, d.doc_type;

CREATE OR REPLACE VIEW wms.v_stock_realtime AS
SELECT
    s.company_code, s.item_code, s.item_name, s.foreign_name, s.item_group,
    s.uom, s.whs_code, s.whs_name, s.bin_code, s.bin_enabled,
    s.batch_managed, s.batch_number, s.mfr_batch, s.lot_number,
    s.mfr_date, s.exp_date, s.in_date,
    s.on_hand AS snapshot_qty, s.bin_qty, s.batch_qty,
    s.avg_price, s.stock_value, s.total_on_hand, s.committed_qty, s.ordered_qty,
    s.snapshot_date, s.synced_at,
    COALESCE(delta.in_qty, 0) AS today_in_qty,
    COALESCE(delta.out_qty, 0) AS today_out_qty,
    COALESCE(delta.in_qty, 0) - COALESCE(delta.out_qty, 0) AS today_delta,
    s.on_hand + COALESCE(delta.in_qty, 0) - COALESCE(delta.out_qty, 0) AS realtime_qty
FROM wms.wms_stock_snapshot s
LEFT JOIN (
    SELECT t.company_code, t.item_code, t.warehouse_code,
        SUM(CASE WHEN t.action IN ('receipt', 'count') THEN t.quantity ELSE 0 END) AS in_qty,
        SUM(CASE WHEN t.action IN ('scan', 'issue', 'move') THEN t.quantity ELSE 0 END) AS out_qty
    FROM wms.wms_transactions t
    WHERE t.posted_flag = FALSE
    GROUP BY t.company_code, t.item_code, t.warehouse_code
) delta ON s.company_code = delta.company_code
       AND s.item_code = delta.item_code
       AND s.whs_code = delta.warehouse_code
WHERE s.snapshot_date = (
    SELECT MAX(s2.snapshot_date) FROM wms.wms_stock_snapshot s2
    WHERE s2.company_code = s.company_code
);


-- ============================================================================
-- 2. 状态字段 DEPRECATED 标记
-- ============================================================================

-- WMS: status 为主状态，wms_status 废弃
COMMENT ON COLUMN wms.wms_documents.wms_status IS
    'DEPRECATED v0.8: 冗余字段，业务逻辑统一使用 status。计划 v1.0 物理删除';
COMMENT ON COLUMN wms.wms_document_lines.wms_status IS
    'DEPRECATED v0.8: 冗余字段，业务逻辑统一使用 status。计划 v1.0 物理删除';

-- OMS: execution_state 为主状态，oms_status 为派生
COMMENT ON COLUMN oms.orders.oms_status IS
    'DEPRECATED v0.8: 派生状态，由 execution_state + sap_status 推算。计划 v1.0 改为视图/计算列';


-- ============================================================================
-- 3. 索引优化 — 新增复合索引 + 保守去重
-- ============================================================================

-- 新增复合索引 (高频查询覆盖)
CREATE INDEX IF NOT EXISTS idx_documents_cc_type_status
    ON wms.wms_documents (company_code, doc_type, status);

CREATE INDEX IF NOT EXISTS idx_documents_cc_sap_docnum
    ON wms.wms_documents (company_code, sap_doc_num) WHERE sap_doc_num IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_oms_orders_cc_exec_state
    ON oms.orders (company_code, doc_type, execution_state);

-- 安全删除 (明确被复合索引左前缀覆盖，无独立使用场景)
DROP INDEX IF EXISTS wms.idx_documents_company;       -- 被 idx_documents_cc_type_status 左前缀覆盖
DROP INDEX IF EXISTS wms.idx_documents_doc_type;       -- 同上
DROP INDEX IF EXISTS wms.idx_documents_wms_status;     -- DEPRECATED 字段索引
DROP INDEX IF EXISTS wms.idx_lines_wms_status;         -- DEPRECATED 字段索引

-- DEPRECATED 标记但保留 (可能被 BI/Debug/老代码使用)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='wms' AND indexname='idx_documents_status') THEN
    COMMENT ON INDEX wms.idx_documents_status IS 'DEPRECATED v0.8: 建议使用 idx_documents_cc_type_status(company_code, doc_type, status)';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='wms' AND indexname='idx_documents_doc_number') THEN
    COMMENT ON INDEX wms.idx_documents_doc_number IS 'DEPRECATED v0.8: 建议使用 idx_documents_cc_sap_docnum(company_code, sap_doc_num)。保留供 BI/Debug 查询';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='wms' AND indexname='idx_documents_sap_doc_num') THEN
    COMMENT ON INDEX wms.idx_documents_sap_doc_num IS 'DEPRECATED v0.8: 建议使用 idx_documents_cc_sap_docnum(company_code, sap_doc_num)';
  END IF;
END $$;


-- ============================================================================
-- 4. 跨 Schema 触发器 — 观测日志表 + DEPRECATED 标记
-- ============================================================================

-- 触发器审计表 (量化跨 Schema 触发频率，为 v1.0 事件驱动迁移提供数据)
CREATE TABLE IF NOT EXISTS oms.trigger_audit_log (
    id SERIAL PRIMARY KEY,
    trigger_name VARCHAR(100) NOT NULL,
    table_name VARCHAR(100) NOT NULL,
    fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    row_id INTEGER,
    company_code VARCHAR(20)
);

CREATE INDEX IF NOT EXISTS idx_trigger_audit_name_time
    ON oms.trigger_audit_log (trigger_name, fired_at);

-- RLS 策略 (如角色存在)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_app_rls') THEN
        -- 允许 dp_app_rls 写入审计表
        GRANT SELECT, INSERT ON oms.trigger_audit_log TO dp_app_rls;
        GRANT USAGE, SELECT ON SEQUENCE oms.trigger_audit_log_id_seq TO dp_app_rls;
    END IF;
END $$;

-- 更新 fn_sync_wms_status_to_oms: 增加观测日志
CREATE OR REPLACE FUNCTION oms.fn_sync_wms_status_to_oms()
RETURNS TRIGGER AS $$
DECLARE
    new_exec_state TEXT;
    new_oms_status TEXT;
    cur_oms_status TEXT;
BEGIN
    IF pg_trigger_depth() > 2 THEN RETURN NEW; END IF;

    -- 观测日志 (量化跨 Schema 触发频率)
    INSERT INTO oms.trigger_audit_log (trigger_name, table_name, row_id, company_code)
    VALUES ('trg_wms_docs_sync_oms_status', 'wms_documents', NEW.id, NEW.company_code);

    CASE NEW.wms_status
        WHEN 'pending' THEN new_exec_state := 'idle';
        WHEN 'in_progress' THEN new_exec_state := 'executing';
        WHEN 'completed' THEN new_exec_state := 'done';
        WHEN 'exported' THEN new_exec_state := 'done';
        ELSE RETURN NEW;
    END CASE;

    -- oms_status 联动 (只升级不降级)
    CASE new_exec_state
        WHEN 'executing' THEN new_oms_status := 'in_progress';
        WHEN 'done' THEN new_oms_status := 'completed';
        ELSE new_oms_status := NULL;
    END CASE;

    -- 查询当前 OMS 状态，防止降级
    SELECT oms_status INTO cur_oms_status
    FROM oms.orders WHERE wms_document_id = NEW.id;

    IF cur_oms_status IS NULL THEN RETURN NEW; END IF;

    -- 只允许向上转换: pending → in_progress → completed → exported
    IF new_oms_status IS NOT NULL THEN
        IF (cur_oms_status = 'completed' AND new_oms_status = 'in_progress')
        OR (cur_oms_status = 'exported')
        OR (cur_oms_status IN ('split', 'cancelled'))
        THEN
            new_oms_status := NULL;  -- 不降级
        END IF;
    END IF;

    UPDATE oms.orders
    SET execution_state = CASE
            WHEN cur_oms_status IN ('completed', 'exported') AND new_exec_state IN ('idle', 'executing')
            THEN execution_state  -- 不降级 execution_state
            ELSE new_exec_state
        END,
        oms_status = COALESCE(new_oms_status, oms_status)
    WHERE wms_document_id = NEW.id
      AND (execution_state IS DISTINCT FROM new_exec_state
           OR (new_oms_status IS NOT NULL AND oms_status IS DISTINCT FROM new_oms_status));

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 更新 fn_link_wms_to_oms: 增加观测日志
CREATE OR REPLACE FUNCTION oms.fn_link_wms_to_oms()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.doc_type IN ('DD', 'SO', 'PO', 'WO', 'TR') THEN
        -- 观测日志
        INSERT INTO oms.trigger_audit_log (trigger_name, table_name, row_id, company_code)
        VALUES ('trg_wms_docs_link_oms', 'wms_documents', NEW.id, NEW.company_code);

        UPDATE oms.orders
        SET wms_document_id = NEW.id
        WHERE doc_number = NEW.doc_number
          AND doc_type = NEW.doc_type
          AND company_code = NEW.company_code
          AND wms_document_id IS DISTINCT FROM NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 更新 fn_sync_wms_qty_to_oms: 增加观测日志
CREATE OR REPLACE FUNCTION oms.fn_sync_wms_qty_to_oms()
RETURNS TRIGGER AS $$
DECLARE
    v_oms_order_id INTEGER;
    v_dd_doc_type TEXT;
    v_parent_id INTEGER;
    v_company_code TEXT;
    v_source_docs TEXT[];
    v_src_doc TEXT;
    v_src_so_id INTEGER;
    v_all_lines_done BOOLEAN;
BEGIN
    -- 递归防御
    IF pg_trigger_depth() > 2 THEN RETURN NEW; END IF;

    -- 观测日志 (量化跨 Schema 触发频率)
    INSERT INTO oms.trigger_audit_log (trigger_name, table_name, row_id, company_code)
    VALUES ('trg_wms_lines_sync_oms_qty', 'wms_document_lines', NEW.id,
            (SELECT company_code FROM wms.wms_documents WHERE id = NEW.document_id));

    -- 查找关联的 OMS 订单 (通过 wms_document_id)
    SELECT o.id, o.doc_type, o.parent_id, o.company_code
    INTO v_oms_order_id, v_dd_doc_type, v_parent_id, v_company_code
    FROM oms.orders o
    WHERE o.wms_document_id = NEW.document_id;

    -- Fallback: 通过 doc_number 匹配 (wms_document_id 可能尚未设置)
    IF v_oms_order_id IS NULL THEN
        SELECT o.id, o.doc_type, o.parent_id, o.company_code
        INTO v_oms_order_id, v_dd_doc_type, v_parent_id, v_company_code
        FROM oms.orders o
        JOIN wms.wms_documents wd ON wd.id = NEW.document_id
        WHERE o.doc_number = wd.doc_number
          AND o.doc_type = wd.doc_type
          AND o.company_code = wd.company_code;

        -- 顺便回填 wms_document_id
        IF v_oms_order_id IS NOT NULL THEN
            UPDATE oms.orders SET wms_document_id = NEW.document_id
            WHERE id = v_oms_order_id AND wms_document_id IS NULL;
        END IF;
    END IF;

    IF v_oms_order_id IS NULL THEN
        RETURN NEW;  -- 无 OMS 关联, 跳过 (普通 WMS 单据)
    END IF;

    -- 更新 DD 自身的 OMS 行 wms_actual_qty (1:1 line_num 匹配)
    UPDATE oms.order_lines
    SET wms_actual_qty = NEW.actual_qty
    WHERE order_id = v_oms_order_id
      AND line_num = NEW.line_num
      AND wms_actual_qty IS DISTINCT FROM NEW.actual_qty;

    -- ========== DD→SO 回写 (仅 DD 类型, 通过 source_doc_number 定位所有源 SO) ==========
    IF v_dd_doc_type = 'DD' THEN

        -- 获取此 DD 涉及的所有不同 source_doc_number
        SELECT ARRAY_AGG(DISTINCT ddl.source_doc_number)
        INTO v_source_docs
        FROM oms.order_lines ddl
        WHERE ddl.order_id = v_oms_order_id
          AND ddl.source_doc_number IS NOT NULL;

        IF v_source_docs IS NOT NULL THEN
            FOREACH v_src_doc IN ARRAY v_source_docs LOOP
                -- 找到源 SO (通过 sap_doc_num 匹配, 必须是已拆分的非 DD 订单)
                SELECT o.id INTO v_src_so_id
                FROM oms.orders o
                WHERE o.sap_doc_num = v_src_doc
                  AND o.company_code = v_company_code
                  AND o.parent_id IS NULL
                  AND o.is_split = TRUE
                LIMIT 1;

                IF v_src_so_id IS NOT NULL THEN
                    -- 聚合所有 DD 行 (跨多个 DD) 指向此 SO 行的 wms_actual_qty
                    UPDATE oms.order_lines sol
                    SET picked_qty = COALESCE(sub.total_picked, 0),
                        status = CASE
                            WHEN COALESCE(sub.total_picked, 0) >= sol.quantity THEN 'completed'
                            WHEN COALESCE(sub.total_picked, 0) > 0 THEN 'partial'
                            ELSE 'pending'
                        END
                    FROM (
                        SELECT ddl.source_line_num AS line_num,
                               SUM(ddl.wms_actual_qty) AS total_picked
                        FROM oms.order_lines ddl
                        JOIN oms.orders dd ON ddl.order_id = dd.id
                        WHERE dd.doc_type = 'DD'
                          AND ddl.source_doc_number = v_src_doc
                        GROUP BY ddl.source_line_num
                    ) sub
                    WHERE sol.order_id = v_src_so_id
                      AND sol.line_num = sub.line_num
                      AND (sol.picked_qty IS DISTINCT FROM COALESCE(sub.total_picked, 0)
                           OR sol.status IS DISTINCT FROM CASE
                               WHEN COALESCE(sub.total_picked, 0) >= sol.quantity THEN 'completed'
                               WHEN COALESCE(sub.total_picked, 0) > 0 THEN 'partial'
                               ELSE 'pending'
                           END);

                    -- 检查此 SO 是否所有行都已完成
                    SELECT NOT EXISTS(
                        SELECT 1 FROM oms.order_lines
                        WHERE order_id = v_src_so_id AND status != 'completed'
                    ) INTO v_all_lines_done;

                    IF v_all_lines_done THEN
                        UPDATE oms.orders
                        SET oms_status = 'completed', execution_state = 'done'
                        WHERE id = v_src_so_id AND oms_status = 'split';

                        UPDATE wms.wms_documents
                        SET wms_status = 'completed'
                        WHERE company_code = v_company_code
                          AND doc_type = 'SO'
                          AND doc_number = v_src_doc
                          AND wms_status = 'split';
                    END IF;
                END IF;
            END LOOP;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- SECURITY DEFINER 保持 (跨 Schema 操作需要)
ALTER FUNCTION oms.fn_sync_wms_status_to_oms() SECURITY DEFINER;
ALTER FUNCTION oms.fn_sync_wms_status_to_oms() SET search_path = pg_catalog, oms, wms;
ALTER FUNCTION oms.fn_sync_wms_qty_to_oms() SECURITY DEFINER;
ALTER FUNCTION oms.fn_sync_wms_qty_to_oms() SET search_path = pg_catalog, oms, wms;
ALTER FUNCTION oms.fn_link_wms_to_oms() SECURITY DEFINER;
ALTER FUNCTION oms.fn_link_wms_to_oms() SET search_path = pg_catalog, oms, wms;

REVOKE ALL ON FUNCTION oms.fn_sync_wms_status_to_oms() FROM PUBLIC;
REVOKE ALL ON FUNCTION oms.fn_sync_wms_qty_to_oms() FROM PUBLIC;
REVOKE ALL ON FUNCTION oms.fn_link_wms_to_oms() FROM PUBLIC;

-- 触发器 DEPRECATED 注释
COMMENT ON TRIGGER trg_wms_docs_sync_oms_status ON wms.wms_documents IS
    'DEPRECATED v0.8: 跨 Schema 强耦合 + 已加观测日志。v1.0 → oms.order_events 事件驱动';
COMMENT ON TRIGGER trg_wms_lines_sync_oms_qty ON wms.wms_document_lines IS
    'DEPRECATED v0.8: 跨 Schema 强耦合 + 已加观测日志。v1.0 → oms.order_events 事件驱动';
COMMENT ON TRIGGER trg_wms_docs_link_oms ON wms.wms_documents IS
    'DEPRECATED v0.8: 跨 Schema 强耦合 + 已加观测日志。v1.0 → oms.order_events 事件驱动';


-- ============================================================================
-- 5. order_lines 加 item_type 字段 (SAP WOR1.ItemType)
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='oms' AND table_name='order_lines' AND column_name='item_type') THEN
    ALTER TABLE oms.order_lines ADD COLUMN item_type INTEGER;
    COMMENT ON COLUMN oms.order_lines.item_type IS 'SAP ItemType: 4=物料, 290=人工/间接费用 (LB/OH)';
  END IF;
END $$;

-- ============================================================================
-- 6. 完成
-- ============================================================================

SELECT '✓ v0.8 数据库审计热补丁执行完成' AS status;
