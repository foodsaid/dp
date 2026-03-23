-- =============================================================================
-- 13_rls_policies.sql — RLS 行级安全策略 + 复合索引 + 跨 Schema 触发器
-- v0.6: 14 张表启用 RLS, 2 张全局表豁免
-- 幂等: DROP POLICY IF EXISTS 再 CREATE
-- =============================================================================

-- ============================================================================
-- 1. RLS 策略: 14 张表
--    策略: company_code = current_setting('app.company_code')
--    GUC 未设 → current_setting() 抛异常 (loud failure)
-- ============================================================================

-- ---------- wms schema ----------

-- wms_documents
ALTER TABLE wms.wms_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON wms.wms_documents;
CREATE POLICY company_isolation ON wms.wms_documents
    FOR ALL TO dp_app_rls
    USING (company_code = current_setting('app.company_code'))
    WITH CHECK (company_code = current_setting('app.company_code'));

-- wms_document_lines
ALTER TABLE wms.wms_document_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON wms.wms_document_lines;
CREATE POLICY company_isolation ON wms.wms_document_lines
    FOR ALL TO dp_app_rls
    USING (company_code = current_setting('app.company_code'))
    WITH CHECK (company_code = current_setting('app.company_code'));

-- wms_transactions
ALTER TABLE wms.wms_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON wms.wms_transactions;
CREATE POLICY company_isolation ON wms.wms_transactions
    FOR ALL TO dp_app_rls
    USING (company_code = current_setting('app.company_code'))
    WITH CHECK (company_code = current_setting('app.company_code'));

-- wms_stock_snapshot
ALTER TABLE wms.wms_stock_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON wms.wms_stock_snapshot;
CREATE POLICY company_isolation ON wms.wms_stock_snapshot
    FOR ALL TO dp_app_rls
    USING (company_code = current_setting('app.company_code'))
    WITH CHECK (company_code = current_setting('app.company_code'));

-- wms_items_cache
ALTER TABLE wms.wms_items_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON wms.wms_items_cache;
CREATE POLICY company_isolation ON wms.wms_items_cache
    FOR ALL TO dp_app_rls
    USING (company_code = current_setting('app.company_code'))
    WITH CHECK (company_code = current_setting('app.company_code'));

-- wms_locations_cache
ALTER TABLE wms.wms_locations_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON wms.wms_locations_cache;
CREATE POLICY company_isolation ON wms.wms_locations_cache
    FOR ALL TO dp_app_rls
    USING (company_code = current_setting('app.company_code'))
    WITH CHECK (company_code = current_setting('app.company_code'));

-- wms_bins_cache
ALTER TABLE wms.wms_bins_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON wms.wms_bins_cache;
CREATE POLICY company_isolation ON wms.wms_bins_cache
    FOR ALL TO dp_app_rls
    USING (company_code = current_setting('app.company_code'))
    WITH CHECK (company_code = current_setting('app.company_code'));

-- wms_audit_log (只需 INSERT + SELECT 策略, 但 FOR ALL 也安全因为有 immutable trigger)
ALTER TABLE wms.wms_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON wms.wms_audit_log;
CREATE POLICY company_isolation ON wms.wms_audit_log
    FOR ALL TO dp_app_rls
    USING (company_code = current_setting('app.company_code'))
    WITH CHECK (company_code = current_setting('app.company_code'));

-- wms_users (deprecated, 保留兼容)
ALTER TABLE wms.wms_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON wms.wms_users;
CREATE POLICY company_isolation ON wms.wms_users
    FOR ALL TO dp_app_rls
    USING (company_code = current_setting('app.company_code'))
    WITH CHECK (company_code = current_setting('app.company_code'));

-- ---------- oms schema ----------

-- oms.orders
ALTER TABLE oms.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON oms.orders;
CREATE POLICY company_isolation ON oms.orders
    FOR ALL TO dp_app_rls
    USING (company_code = current_setting('app.company_code'))
    WITH CHECK (company_code = current_setting('app.company_code'));

-- oms.order_lines
ALTER TABLE oms.order_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON oms.order_lines;
CREATE POLICY company_isolation ON oms.order_lines
    FOR ALL TO dp_app_rls
    USING (company_code = current_setting('app.company_code'))
    WITH CHECK (company_code = current_setting('app.company_code'));

-- oms.order_events
ALTER TABLE oms.order_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON oms.order_events;
CREATE POLICY company_isolation ON oms.order_events
    FOR ALL TO dp_app_rls
    USING (company_code = current_setting('app.company_code'))
    WITH CHECK (company_code = current_setting('app.company_code'));

-- oms.audit_logs
ALTER TABLE oms.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON oms.audit_logs;
CREATE POLICY company_isolation ON oms.audit_logs
    FOR ALL TO dp_app_rls
    USING (company_code = current_setting('app.company_code'))
    WITH CHECK (company_code = current_setting('app.company_code'));

-- ---------- ai schema ----------

-- ai.ai_embeddings
ALTER TABLE ai.ai_embeddings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON ai.ai_embeddings;
CREATE POLICY company_isolation ON ai.ai_embeddings
    FOR ALL TO dp_app_rls
    USING (company_code = current_setting('app.company_code'))
    WITH CHECK (company_code = current_setting('app.company_code'));

-- ============================================================================
-- 2. 复合索引 (CONCURRENTLY 零锁表)
--    注意: CONCURRENTLY 不能在事务块内执行, 需要 autocommit
-- ============================================================================

-- wms 核心表
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wms_docs_cc
    ON wms.wms_documents (company_code);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wms_docs_cc_status
    ON wms.wms_documents (company_code, wms_status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wms_docs_cc_created
    ON wms.wms_documents (company_code, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wms_tx_cc
    ON wms.wms_transactions (company_code);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wms_tx_cc_time
    ON wms.wms_transactions (company_code, transaction_time);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wms_snap_cc
    ON wms.wms_stock_snapshot (company_code);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wms_snap_cc_date
    ON wms.wms_stock_snapshot (company_code, snapshot_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wms_audit_cc
    ON wms.wms_audit_log (company_code);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wms_audit_cc_user
    ON wms.wms_audit_log (company_code, performed_by, created_at);

-- 子表 (索引已在 12_child_table_company_code.sh 中创建, 这里仅做 IF NOT EXISTS 兜底)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wms_lines_cc_docid
    ON wms.wms_document_lines (company_code, document_id);

-- oms 表
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oms_orders_cc
    ON oms.orders (company_code);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oms_orders_cc_status
    ON oms.orders (company_code, oms_status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oms_lines_cc_orderid
    ON oms.order_lines (company_code, order_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oms_events_cc
    ON oms.order_events (company_code);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oms_events_cc_order
    ON oms.order_events (company_code, order_id);

-- ============================================================================
-- 3. 跨 Schema 触发器: SECURITY DEFINER (绕过 RLS)
--    这些函数在 dp_app_rls 触发写操作时, 需要以 dp_app (owner) 身份
--    执行跨 schema UPDATE, 否则 RLS 会拦截
-- ============================================================================

-- fn_sync_wms_status_to_oms (wms.wms_documents AFTER UPDATE → oms.orders)
ALTER FUNCTION oms.fn_sync_wms_status_to_oms() SECURITY DEFINER;
ALTER FUNCTION oms.fn_sync_wms_status_to_oms() SET search_path = pg_catalog, oms, wms;

-- fn_sync_wms_qty_to_oms (wms.wms_document_lines AFTER UPDATE → oms.order_lines)
ALTER FUNCTION oms.fn_sync_wms_qty_to_oms() SECURITY DEFINER;
ALTER FUNCTION oms.fn_sync_wms_qty_to_oms() SET search_path = pg_catalog, oms, wms;

-- fn_link_wms_to_oms (wms.wms_documents AFTER INSERT/UPDATE → oms.orders)
ALTER FUNCTION oms.fn_link_wms_to_oms() SECURITY DEFINER;
ALTER FUNCTION oms.fn_link_wms_to_oms() SET search_path = pg_catalog, oms, wms;

-- REVOKE + OWNER 安全加固
REVOKE ALL ON FUNCTION oms.fn_sync_wms_status_to_oms() FROM PUBLIC;
REVOKE ALL ON FUNCTION oms.fn_sync_wms_qty_to_oms() FROM PUBLIC;
REVOKE ALL ON FUNCTION oms.fn_link_wms_to_oms() FROM PUBLIC;
