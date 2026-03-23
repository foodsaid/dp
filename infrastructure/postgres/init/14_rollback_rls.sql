-- =============================================================================
-- 14_rollback_rls.sql — RLS 完整回滚脚本
-- 用法: psql -U $DP_DB_USER -d $DP_DB_NAME -f 14_rollback_rls.sql
-- 注意: 此脚本会禁用所有 RLS 策略并删除相关对象
-- =============================================================================

-- ============================================================================
-- 1. 禁用 RLS (14 张表)
-- ============================================================================
ALTER TABLE wms.wms_documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE wms.wms_document_lines DISABLE ROW LEVEL SECURITY;
ALTER TABLE wms.wms_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE wms.wms_stock_snapshot DISABLE ROW LEVEL SECURITY;
ALTER TABLE wms.wms_items_cache DISABLE ROW LEVEL SECURITY;
ALTER TABLE wms.wms_locations_cache DISABLE ROW LEVEL SECURITY;
ALTER TABLE wms.wms_bins_cache DISABLE ROW LEVEL SECURITY;
ALTER TABLE wms.wms_audit_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE wms.wms_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE oms.orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE oms.order_lines DISABLE ROW LEVEL SECURITY;
ALTER TABLE oms.order_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE oms.audit_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE ai.ai_embeddings DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. 删除策略
-- ============================================================================
DROP POLICY IF EXISTS company_isolation ON wms.wms_documents;
DROP POLICY IF EXISTS company_isolation ON wms.wms_document_lines;
DROP POLICY IF EXISTS company_isolation ON wms.wms_transactions;
DROP POLICY IF EXISTS company_isolation ON wms.wms_stock_snapshot;
DROP POLICY IF EXISTS company_isolation ON wms.wms_items_cache;
DROP POLICY IF EXISTS company_isolation ON wms.wms_locations_cache;
DROP POLICY IF EXISTS company_isolation ON wms.wms_bins_cache;
DROP POLICY IF EXISTS company_isolation ON wms.wms_audit_log;
DROP POLICY IF EXISTS company_isolation ON wms.wms_users;
DROP POLICY IF EXISTS company_isolation ON oms.orders;
DROP POLICY IF EXISTS company_isolation ON oms.order_lines;
DROP POLICY IF EXISTS company_isolation ON oms.order_events;
DROP POLICY IF EXISTS company_isolation ON oms.audit_logs;
DROP POLICY IF EXISTS company_isolation ON ai.ai_embeddings;

-- ============================================================================
-- 3. 删除不可变触发器
-- ============================================================================
DROP TRIGGER IF EXISTS trg_wms_documents_cc_immutable ON wms.wms_documents;
DROP TRIGGER IF EXISTS trg_wms_document_lines_cc_immutable ON wms.wms_document_lines;
DROP TRIGGER IF EXISTS trg_wms_transactions_cc_immutable ON wms.wms_transactions;
DROP TRIGGER IF EXISTS trg_wms_stock_snapshot_cc_immutable ON wms.wms_stock_snapshot;
DROP TRIGGER IF EXISTS trg_wms_items_cache_cc_immutable ON wms.wms_items_cache;
DROP TRIGGER IF EXISTS trg_wms_locations_cache_cc_immutable ON wms.wms_locations_cache;
DROP TRIGGER IF EXISTS trg_wms_bins_cache_cc_immutable ON wms.wms_bins_cache;
DROP TRIGGER IF EXISTS trg_wms_audit_log_cc_immutable ON wms.wms_audit_log;
DROP TRIGGER IF EXISTS trg_orders_cc_immutable ON oms.orders;
DROP TRIGGER IF EXISTS trg_order_events_cc_immutable ON oms.order_events;
DROP TRIGGER IF EXISTS trg_audit_logs_cc_immutable ON oms.audit_logs;

-- 子表触发器
DROP TRIGGER IF EXISTS trg_fill_child_cc ON wms.wms_document_lines;
DROP TRIGGER IF EXISTS trg_fill_child_cc ON oms.order_lines;
DROP TRIGGER IF EXISTS trg_lines_enforce_cc ON wms.wms_document_lines;
DROP TRIGGER IF EXISTS trg_order_lines_enforce_cc ON oms.order_lines;
DROP TRIGGER IF EXISTS trg_order_lines_cc_immutable ON oms.order_lines;

-- ============================================================================
-- 4. 删除函数
-- ============================================================================
DROP FUNCTION IF EXISTS wms.current_company();
DROP FUNCTION IF EXISTS wms.fn_immutable_company_code();
DROP FUNCTION IF EXISTS wms.fn_fill_child_company_code();

-- ============================================================================
-- 5. 还原跨 schema 触发器 (移除 SECURITY DEFINER)
-- ============================================================================
ALTER FUNCTION oms.fn_sync_wms_status_to_oms() SECURITY INVOKER;
ALTER FUNCTION oms.fn_sync_wms_qty_to_oms() SECURITY INVOKER;
ALTER FUNCTION oms.fn_link_wms_to_oms() SECURITY INVOKER;
ALTER FUNCTION oms.fn_sync_wms_status_to_oms() RESET search_path;
ALTER FUNCTION oms.fn_sync_wms_qty_to_oms() RESET search_path;
ALTER FUNCTION oms.fn_link_wms_to_oms() RESET search_path;

-- ============================================================================
-- 6. 子表 cc 列: 放宽约束 (保留列无害, 去掉 NOT NULL 允许旧工作流)
-- ============================================================================
ALTER TABLE wms.wms_document_lines ALTER COLUMN company_code DROP NOT NULL;
ALTER TABLE oms.order_lines ALTER COLUMN company_code DROP NOT NULL;

-- ============================================================================
-- 7. 删除角色 (需先 REVOKE)
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dp_app_rls') THEN
        REASSIGN OWNED BY dp_app_rls TO dp_app;
        DROP OWNED BY dp_app_rls;
        DROP ROLE dp_app_rls;
        RAISE NOTICE '14_rollback: dp_app_rls 角色已删除';
    END IF;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dp_bi') THEN
        REASSIGN OWNED BY dp_bi TO dp_app;
        DROP OWNED BY dp_bi;
        DROP ROLE dp_bi;
        RAISE NOTICE '14_rollback: dp_bi 角色已删除';
    END IF;
END $$;

-- ============================================================================
-- 索引保留 (复合索引无害, 不删除)
-- 如需删除: DROP INDEX CONCURRENTLY IF NOT EXISTS idx_xxx;
-- ============================================================================
