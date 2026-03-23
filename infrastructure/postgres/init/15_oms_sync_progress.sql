-- =============================================================================
-- 15_oms_sync_progress.sql — OMS 同步进度表
-- v0.7: 分类型分月批量同步，支持断点续传
-- 幂等: IF NOT EXISTS + DROP POLICY IF EXISTS
-- =============================================================================

-- ============================================================================
-- 1. 建表
-- ============================================================================
CREATE TABLE IF NOT EXISTS oms.sync_progress (
    id              SERIAL PRIMARY KEY,
    company_code    VARCHAR(20) NOT NULL CHECK (TRIM(company_code) <> ''),
    doc_type        VARCHAR(10) NOT NULL CHECK (doc_type IN ('SO','PO','WO','TR')),
    month_start     DATE NOT NULL,
    month_end       DATE NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','running','completed','failed')),
    row_count       INTEGER DEFAULT 0,
    error_message   TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    context         JSONB DEFAULT '{}',             -- 同步上下文 (耗时/行数/跳过原因等透明化信息)
    last_anchor_date DATE                           -- 上次成功同步的最大 sap_update_date，用于增量查询锚点
);

COMMENT ON TABLE oms.sync_progress IS 'OMS SAP 同步进度 — 分类型分月批量，支持断点续传';

-- ============================================================================
-- 2. 索引
-- ============================================================================

-- 唯一索引: 幂等防重复插入
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_progress_batch
    ON oms.sync_progress (company_code, doc_type, month_start);

-- 查询索引: wf20a 批次执行器高频查询 (FOR UPDATE SKIP LOCKED)
CREATE INDEX IF NOT EXISTS idx_sync_progress_status
    ON oms.sync_progress (company_code, status, month_start);

-- ============================================================================
-- 3. 触发器
-- ============================================================================

-- updated_at 自动更新 (复用 wms.fn_updated_at)
DROP TRIGGER IF EXISTS trg_sync_progress_updated_at ON oms.sync_progress;
CREATE TRIGGER trg_sync_progress_updated_at
    BEFORE UPDATE ON oms.sync_progress
    FOR EACH ROW EXECUTE FUNCTION wms.fn_updated_at();

-- company_code 不可变 (复用 wms.fn_enforce_company_code)
DROP TRIGGER IF EXISTS trg_sync_progress_enforce_cc ON oms.sync_progress;
CREATE TRIGGER trg_sync_progress_enforce_cc
    BEFORE UPDATE ON oms.sync_progress
    FOR EACH ROW EXECUTE FUNCTION wms.fn_enforce_company_code();

-- ============================================================================
-- 4. RLS 行级安全
-- ============================================================================
ALTER TABLE oms.sync_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON oms.sync_progress;
CREATE POLICY company_isolation ON oms.sync_progress
    FOR ALL TO dp_app_rls
    USING (company_code = current_setting('app.company_code'))
    WITH CHECK (company_code = current_setting('app.company_code'));

-- ============================================================================
-- 5. 权限 (dp_app_rls 已有 oms schema 全表 CRUD，自动继承)
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON oms.sync_progress TO dp_app_rls;
GRANT USAGE, SELECT ON SEQUENCE oms.sync_progress_id_seq TO dp_app_rls;
GRANT SELECT ON oms.sync_progress TO dp_bi;
