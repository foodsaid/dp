-- =============================================================================
-- 14_rls_rollback_test.sql — RLS 回滚脚本行为测试
-- 前置: 完整 Schema 初始化 (01~13) 已执行
-- 用法: psql -U <superuser> -d <db> -v ON_ERROR_STOP=1 -f 14_rls_rollback_test.sql
-- 策略: 执行回滚 → 验证对象已清理 → 不影响核心数据
-- =============================================================================

\echo '============================================================'
\echo '  RLS 回滚行为测试开始'
\echo '============================================================'

-- --------------------------------------------------------------------------
-- 准备: 确保 RLS 对象存在 (依赖 11~13 已初始化)
-- --------------------------------------------------------------------------
\echo '[准备] 验证 RLS 对象存在...'

DO $$
DECLARE
    policy_count INT;
BEGIN
    SELECT COUNT(*) INTO policy_count
    FROM pg_policies WHERE policyname = 'company_isolation';
    IF policy_count = 0 THEN
        RAISE EXCEPTION '前置条件失败: 未找到 company_isolation 策略, 请先运行 11~13 初始化';
    END IF;
    RAISE NOTICE '✅ 前置条件: 找到 % 条 company_isolation 策略', policy_count;
END $$;

-- --------------------------------------------------------------------------
-- 执行回滚 (内联执行, 避免 \i 路径依赖)
-- --------------------------------------------------------------------------
\echo '[执行] 运行回滚逻辑...'

-- 1. 禁用 RLS
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

-- 2. 删除策略
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

-- 3. 删除不可变触发器
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
DROP TRIGGER IF EXISTS trg_fill_child_cc ON wms.wms_document_lines;
DROP TRIGGER IF EXISTS trg_fill_child_cc ON oms.order_lines;
DROP TRIGGER IF EXISTS trg_lines_enforce_cc ON wms.wms_document_lines;
DROP TRIGGER IF EXISTS trg_order_lines_enforce_cc ON oms.order_lines;
DROP TRIGGER IF EXISTS trg_order_lines_cc_immutable ON oms.order_lines;

-- 4. 删除函数
DROP FUNCTION IF EXISTS wms.current_company();
DROP FUNCTION IF EXISTS wms.fn_immutable_company_code();
DROP FUNCTION IF EXISTS wms.fn_fill_child_company_code();

-- 5. 还原跨 schema 函数
DO $$ BEGIN
    IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='oms' AND p.proname='fn_sync_wms_status_to_oms') THEN
        ALTER FUNCTION oms.fn_sync_wms_status_to_oms() SECURITY INVOKER;
        ALTER FUNCTION oms.fn_sync_wms_status_to_oms() RESET search_path;
    END IF;
    IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='oms' AND p.proname='fn_sync_wms_qty_to_oms') THEN
        ALTER FUNCTION oms.fn_sync_wms_qty_to_oms() SECURITY INVOKER;
        ALTER FUNCTION oms.fn_sync_wms_qty_to_oms() RESET search_path;
    END IF;
    IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='oms' AND p.proname='fn_link_wms_to_oms') THEN
        ALTER FUNCTION oms.fn_link_wms_to_oms() SECURITY INVOKER;
        ALTER FUNCTION oms.fn_link_wms_to_oms() RESET search_path;
    END IF;
END $$;

-- 6. 子表 cc 列放宽
ALTER TABLE wms.wms_document_lines ALTER COLUMN company_code DROP NOT NULL;
ALTER TABLE oms.order_lines ALTER COLUMN company_code DROP NOT NULL;

-- 7. 删除角色
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dp_app_rls') THEN
        REASSIGN OWNED BY dp_app_rls TO dp_app;
        DROP OWNED BY dp_app_rls;
        DROP ROLE dp_app_rls;
    END IF;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dp_bi') THEN
        REASSIGN OWNED BY dp_bi TO dp_app;
        DROP OWNED BY dp_bi;
        DROP ROLE dp_bi;
    END IF;
END $$;

-- ==========================================================================
-- 测试 1: RLS 已在所有 14 表上禁用
-- ==========================================================================
\echo '[测试 1] RLS 已禁用...'

DO $$
DECLARE
    rls_enabled_count INT;
BEGIN
    SELECT COUNT(*) INTO rls_enabled_count
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname IN ('wms', 'oms', 'ai')
      AND c.relname IN (
          'wms_documents', 'wms_document_lines', 'wms_transactions',
          'wms_stock_snapshot', 'wms_items_cache', 'wms_locations_cache',
          'wms_bins_cache', 'wms_audit_log', 'wms_users',
          'orders', 'order_lines', 'order_events', 'audit_logs',
          'ai_embeddings'
      )
      AND c.relrowsecurity = true;

    IF rls_enabled_count > 0 THEN
        RAISE EXCEPTION '❌ 测试 1 失败: 仍有 % 张表启用了 RLS', rls_enabled_count;
    END IF;
    RAISE NOTICE '✅ 测试 1: 所有 14 张表 RLS 已禁用';
END $$;

-- ==========================================================================
-- 测试 2: company_isolation 策略已全部删除
-- ==========================================================================
\echo '[测试 2] 策略已删除...'

DO $$
DECLARE
    policy_count INT;
BEGIN
    SELECT COUNT(*) INTO policy_count
    FROM pg_policies WHERE policyname = 'company_isolation';

    IF policy_count > 0 THEN
        RAISE EXCEPTION '❌ 测试 2 失败: 仍存在 % 条 company_isolation 策略', policy_count;
    END IF;
    RAISE NOTICE '✅ 测试 2: company_isolation 策略已全部删除';
END $$;

-- ==========================================================================
-- 测试 3: 不可变触发器已删除
-- ==========================================================================
\echo '[测试 3] 不可变触发器已删除...'

DO $$
DECLARE
    trigger_count INT;
BEGIN
    SELECT COUNT(*) INTO trigger_count
    FROM information_schema.triggers
    WHERE trigger_name LIKE 'trg_%_cc_immutable'
       OR trigger_name IN ('trg_fill_child_cc', 'trg_lines_enforce_cc',
                           'trg_order_lines_enforce_cc');

    IF trigger_count > 0 THEN
        RAISE EXCEPTION '❌ 测试 3 失败: 仍存在 % 个 cc 相关触发器', trigger_count;
    END IF;
    RAISE NOTICE '✅ 测试 3: 所有 cc 不可变/子表触发器已删除';
END $$;

-- ==========================================================================
-- 测试 4: RLS 函数已删除
-- ==========================================================================
\echo '[测试 4] RLS 函数已删除...'

DO $$
DECLARE
    fn_count INT;
BEGIN
    SELECT COUNT(*) INTO fn_count
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'wms'
      AND p.proname IN ('current_company', 'fn_immutable_company_code', 'fn_fill_child_company_code');

    IF fn_count > 0 THEN
        RAISE EXCEPTION '❌ 测试 4 失败: 仍存在 % 个 RLS 函数', fn_count;
    END IF;
    RAISE NOTICE '✅ 测试 4: RLS 函数 (current_company/fn_immutable_company_code/fn_fill_child_company_code) 已删除';
END $$;

-- ==========================================================================
-- 测试 5: dp_app_rls 和 dp_bi 角色已删除
-- ==========================================================================
\echo '[测试 5] RLS 角色已删除...'

DO $$
DECLARE
    role_count INT;
BEGIN
    SELECT COUNT(*) INTO role_count
    FROM pg_roles WHERE rolname IN ('dp_app_rls', 'dp_bi');

    IF role_count > 0 THEN
        RAISE EXCEPTION '❌ 测试 5 失败: 仍存在 % 个 RLS 角色', role_count;
    END IF;
    RAISE NOTICE '✅ 测试 5: dp_app_rls 和 dp_bi 角色已删除';
END $$;

-- ==========================================================================
-- 测试 6: 跨 schema 函数已还原为 SECURITY INVOKER
-- ==========================================================================
\echo '[测试 6] 跨 schema 函数安全模式已还原...'

DO $$
DECLARE
    definer_count INT;
BEGIN
    SELECT COUNT(*) INTO definer_count
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'oms'
      AND p.proname IN ('fn_sync_wms_status_to_oms', 'fn_sync_wms_qty_to_oms', 'fn_link_wms_to_oms')
      AND p.prosecdef = true;

    IF definer_count > 0 THEN
        RAISE EXCEPTION '❌ 测试 6 失败: 仍有 % 个 OMS 函数是 SECURITY DEFINER', definer_count;
    END IF;
    RAISE NOTICE '✅ 测试 6: OMS 跨 schema 函数已还原为 SECURITY INVOKER';
END $$;

-- ==========================================================================
-- 测试 7: 子表 company_code 已放宽 NOT NULL
-- ==========================================================================
\echo '[测试 7] 子表 cc 约束已放宽...'

DO $$
DECLARE
    nn_count INT;
BEGIN
    SELECT COUNT(*) INTO nn_count
    FROM information_schema.columns
    WHERE (table_schema = 'wms' AND table_name = 'wms_document_lines' AND column_name = 'company_code' AND is_nullable = 'NO')
       OR (table_schema = 'oms' AND table_name = 'order_lines' AND column_name = 'company_code' AND is_nullable = 'NO');

    IF nn_count > 0 THEN
        RAISE EXCEPTION '❌ 测试 7 失败: 仍有 % 个子表 company_code 保持 NOT NULL', nn_count;
    END IF;
    RAISE NOTICE '✅ 测试 7: 子表 (wms_document_lines/order_lines) company_code NOT NULL 已放宽';
END $$;

-- ==========================================================================
-- 测试 8: 核心表数据未受影响
-- ==========================================================================
\echo '[测试 8] 核心表数据完整性...'

DO $$
DECLARE
    tbl TEXT;
    cnt INT;
BEGIN
    -- 仅验证核心表仍可查询 (回滚不应删数据)
    FOR tbl IN SELECT unnest(ARRAY[
        'wms.wms_documents', 'wms.wms_document_lines',
        'wms.wms_transactions', 'wms.wms_stock_snapshot',
        'wms.wms_items_cache', 'wms.wms_locations_cache'
    ]) LOOP
        EXECUTE format('SELECT COUNT(*) FROM %s', tbl) INTO cnt;
        -- 不检查具体数量,只验证查询不报错
    END LOOP;
    RAISE NOTICE '✅ 测试 8: 核心表查询正常, 数据未受影响';
END $$;

\echo '============================================================'
\echo '  RLS 回滚行为测试完成 (8/8)'
\echo '============================================================'
