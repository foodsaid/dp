-- =============================================================================
-- 16_oms_sync_incremental.sql — OMS 增量同步扩展
-- v0.7.1: sync_progress 加 sap_count 列 + orders 锚点查询索引
-- v0.8.1: 加 context JSONB + last_anchor_date 列 (智能跳过 + 增量锚点)
-- 幂等: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
-- =============================================================================

-- Layer2 校验写入 SAP 端计数
ALTER TABLE oms.sync_progress
    ADD COLUMN IF NOT EXISTS sap_count INTEGER DEFAULT NULL;

COMMENT ON COLUMN oms.sync_progress.sap_count
    IS 'SAP 端该月按 UpdateDate 统计的单据数（Layer2 校验写入），NULL=未校验';

-- Layer1 锚点查询性能索引
CREATE INDEX IF NOT EXISTS idx_orders_anchor
    ON oms.orders (company_code, doc_type, sap_update_date DESC);

-- 差异校验视图（运维快查：|diff| > 2 的月份）
CREATE OR REPLACE VIEW oms.v_sync_discrepancy AS
SELECT company_code,
       doc_type,
       month_start,
       month_end,
       row_count                          AS dp_count,
       sap_count,
       sap_count - COALESCE(row_count, 0) AS diff,
       status,
       completed_at
FROM oms.sync_progress
WHERE sap_count IS NOT NULL
  AND ABS(sap_count - COALESCE(row_count, 0)) > 2
ORDER BY doc_type, month_start;

GRANT SELECT ON oms.v_sync_discrepancy TO dp_app_rls, dp_bi;

-- v0.8.1: wf20a 同步优化 — 智能跳过 + 增量锚点 + 透明化
ALTER TABLE oms.sync_progress
    ADD COLUMN IF NOT EXISTS context JSONB DEFAULT '{}';
ALTER TABLE oms.sync_progress
    ADD COLUMN IF NOT EXISTS last_anchor_date DATE;

COMMENT ON COLUMN oms.sync_progress.context
    IS '同步上下文 (耗时/行数/跳过原因等透明化信息)';
COMMENT ON COLUMN oms.sync_progress.last_anchor_date
    IS '上次成功同步的最大 sap_update_date，用于增量查询锚点';
