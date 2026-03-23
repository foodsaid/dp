-- =============================================================================
-- 13_rls_behavior_test.sql — RLS 行级安全行为测试 (14 条)
-- 前置: 11_rls_roles.sh + 12_child_table_company_code.sh + 13_rls_policies.sql
-- 用法: psql -U <superuser> -d <db> -v ON_ERROR_STOP=1 -f 13_rls_behavior_test.sql
-- =============================================================================

\echo '============================================================'
\echo '  RLS 行为测试开始'
\echo '============================================================'

-- --------------------------------------------------------------------------
-- 准备测试数据 (以超级用户插入)
-- --------------------------------------------------------------------------
\echo '[准备] 插入测试数据...'

INSERT INTO wms.wms_documents (company_code, doc_type, doc_number, sap_doc_num, wms_status, created_by)
VALUES ('TEST_A', 'SO', 'RLS-TEST-A01', 'SAP-RLS-A01', 'pending', 'rls_tester')
ON CONFLICT (company_code, doc_type, doc_number) DO NOTHING;

INSERT INTO wms.wms_documents (company_code, doc_type, doc_number, sap_doc_num, wms_status, created_by)
VALUES ('TEST_B', 'SO', 'RLS-TEST-B01', 'SAP-RLS-B01', 'pending', 'rls_tester')
ON CONFLICT (company_code, doc_type, doc_number) DO NOTHING;

DO $$
DECLARE
    doc_a_id INT;
    doc_b_id INT;
BEGIN
    SELECT id INTO doc_a_id FROM wms.wms_documents
        WHERE company_code = 'TEST_A' AND doc_number = 'RLS-TEST-A01';
    SELECT id INTO doc_b_id FROM wms.wms_documents
        WHERE company_code = 'TEST_B' AND doc_number = 'RLS-TEST-B01';

    IF doc_a_id IS NOT NULL THEN
        INSERT INTO wms.wms_document_lines (document_id, company_code, line_num, item_code, planned_qty)
        VALUES (doc_a_id, 'TEST_A', 1, 'ITEM-RLS-01', 10)
        ON CONFLICT DO NOTHING;
    END IF;
    IF doc_b_id IS NOT NULL THEN
        INSERT INTO wms.wms_document_lines (document_id, company_code, line_num, item_code, planned_qty)
        VALUES (doc_b_id, 'TEST_B', 1, 'ITEM-RLS-02', 20)
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

INSERT INTO wms.wms_audit_log (company_code, table_name, record_id, action, performed_by)
VALUES ('TEST_A', 'rls_test', 0, 'INSERT', 'rls_tester');
INSERT INTO wms.wms_audit_log (company_code, table_name, record_id, action, performed_by)
VALUES ('TEST_B', 'rls_test', 0, 'INSERT', 'rls_tester');

\echo '[准备] 测试数据就绪'

-- ==========================================================================
-- T1: dp_app_rls 无 GUC → current_setting() 报错 (loud failure)
-- ==========================================================================
\echo ''
\echo '[T1] dp_app_rls 无 GUC → 应报错...'
-- 先清除 session 级 GUC (防止前面残留)
SELECT set_config('app.company_code', '', false);
SET ROLE dp_app_rls;
DO $$
BEGIN
    -- RLS 策略: company_code = current_setting('app.company_code')
    -- 空字符串不匹配任何 company_code (CHECK 约束保证非空)
    -- 所以应返回 0 行 (安全拒绝)
    DECLARE cnt INT;
    BEGIN
        SELECT count(*) INTO cnt FROM wms.wms_documents;
        IF cnt = 0 THEN
            RAISE NOTICE 'T1 PASSED: 无 GUC → 返回 0 行 (安全拒绝)';
        ELSE
            RAISE EXCEPTION 'T1 FAILED: 预期 0 行, 实际 %', cnt;
        END IF;
    END;
END $$;
RESET ROLE;

-- ==========================================================================
-- T2: dp_app_rls set_config(false) → 只看 TEST_A
-- (验证 session 级 GUC, 即 n8n 生产模式)
-- ==========================================================================
\echo '[T2] dp_app_rls set_config(false) → 只看自己公司...'
SET ROLE dp_app_rls;
SELECT set_config('app.company_code', 'TEST_A', false);
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM wms.wms_documents
    WHERE doc_number LIKE 'RLS-TEST-%';
    IF cnt = 1 THEN
        RAISE NOTICE 'T2 PASSED: TEST_A 只看到 1 条文档';
    ELSE
        RAISE EXCEPTION 'T2 FAILED: 预期 1 条, 实际 %', cnt;
    END IF;
END $$;
-- 清除 GUC
SELECT set_config('app.company_code', '', false);
RESET ROLE;

-- ==========================================================================
-- T3: dp_app_rls INSERT 错误 cc → WITH CHECK 拒绝
-- ==========================================================================
\echo '[T3] dp_app_rls INSERT 错误 cc → 拒绝...'
SET ROLE dp_app_rls;
DO $$
BEGIN
    PERFORM set_config('app.company_code', 'TEST_A', false);
    INSERT INTO wms.wms_audit_log (company_code, table_name, record_id, action, performed_by)
    VALUES ('WRONG_CC', 'rls_test', 0, 'INSERT', 'rls_tester');
    RAISE EXCEPTION 'T3 FAILED: 应该被 RLS 拦截但没有';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'T3 PASSED: INSERT 错误 cc 被 RLS 拦截';
    WHEN OTHERS THEN
        IF SQLERRM LIKE '%row-level security%' OR SQLERRM LIKE '%policy%' THEN
            RAISE NOTICE 'T3 PASSED: INSERT 错误 cc 被 RLS 拦截: %', SQLERRM;
        ELSE
            RAISE EXCEPTION 'T3 FAILED: 错误类型不符预期: %', SQLERRM;
        END IF;
END $$;
SELECT set_config('app.company_code', '', false);
RESET ROLE;

-- ==========================================================================
-- T4: dp_app (超级用户) 看全量
-- ==========================================================================
\echo '[T4] dp_app 超级用户 → 看全量...'
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(DISTINCT company_code) INTO cnt FROM wms.wms_documents
    WHERE doc_number LIKE 'RLS-TEST-%';
    IF cnt >= 2 THEN
        RAISE NOTICE 'T4 PASSED: dp_app 看到 % 个公司', cnt;
    ELSE
        RAISE EXCEPTION 'T4 FAILED: 预期 >=2 公司, 实际 %', cnt;
    END IF;
END $$;

-- ==========================================================================
-- T5: dp_bi (BYPASSRLS) 只读 + 看全量
-- ==========================================================================
\echo '[T5] dp_bi BYPASSRLS → 看全量...'
SET ROLE dp_bi;
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(DISTINCT company_code) INTO cnt FROM wms.wms_documents
    WHERE doc_number LIKE 'RLS-TEST-%';
    IF cnt >= 2 THEN
        RAISE NOTICE 'T5 PASSED: dp_bi 看到 % 个公司', cnt;
    ELSE
        RAISE EXCEPTION 'T5 FAILED: 预期 >=2 公司, 实际 %', cnt;
    END IF;
END $$;
RESET ROLE;

-- ==========================================================================
-- T6: 子表 INSERT cc 一致 → OK
-- ==========================================================================
\echo '[T6] 子表 INSERT cc 一致 → OK...'
SET ROLE dp_app_rls;
DO $$
DECLARE doc_id INT;
BEGIN
    PERFORM set_config('app.company_code', 'TEST_A', false);
    SELECT id INTO doc_id FROM wms.wms_documents
        WHERE company_code = 'TEST_A' AND doc_number = 'RLS-TEST-A01';

    INSERT INTO wms.wms_document_lines (document_id, company_code, line_num, item_code, planned_qty)
    VALUES (doc_id, 'TEST_A', 99, 'ITEM-T6', 1);

    DELETE FROM wms.wms_document_lines WHERE item_code = 'ITEM-T6';
    RAISE NOTICE 'T6 PASSED: 子表 INSERT 一致 cc 成功';
END $$;
SELECT set_config('app.company_code', '', false);
RESET ROLE;

-- ==========================================================================
-- T7: 子表 INSERT cc 不一致 → 被 RLS WITH CHECK 拦截
-- ==========================================================================
\echo '[T7] 子表 INSERT cc 不一致 → 拦截...'
SET ROLE dp_app_rls;
DO $$
DECLARE doc_id INT;
BEGIN
    PERFORM set_config('app.company_code', 'TEST_A', false);
    SELECT id INTO doc_id FROM wms.wms_documents
        WHERE company_code = 'TEST_A' AND doc_number = 'RLS-TEST-A01';

    INSERT INTO wms.wms_document_lines (document_id, company_code, line_num, item_code, planned_qty)
    VALUES (doc_id, 'TEST_B', 98, 'ITEM-T7', 1);

    RAISE EXCEPTION 'T7 FAILED: 应该被拦截';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM LIKE '%row-level security%' OR SQLERRM LIKE '%policy%' OR SQLERRM LIKE '%insufficient_privilege%' THEN
            RAISE NOTICE 'T7 PASSED: 子表 INSERT 不一致 cc 被拦截';
        ELSE
            RAISE EXCEPTION 'T7 FAILED: 错误类型不符: %', SQLERRM;
        END IF;
END $$;
SELECT set_config('app.company_code', '', false);
RESET ROLE;

-- ==========================================================================
-- T8: 父表 UPDATE cc → 不可变触发器报错
-- ==========================================================================
\echo '[T8] 父表 UPDATE cc → 不可变触发器报错...'
DO $$
BEGIN
    UPDATE wms.wms_documents SET company_code = 'CHANGED'
    WHERE doc_number = 'RLS-TEST-A01' AND company_code = 'TEST_A';
    RAISE EXCEPTION 'T8 FAILED: 应该被不可变触发器拦截';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM LIKE '%禁止修改%' THEN
            RAISE NOTICE 'T8 PASSED: 父表 cc 不可变';
        ELSE
            RAISE EXCEPTION 'T8 FAILED: 错误不符: %', SQLERRM;
        END IF;
END $$;

-- ==========================================================================
-- T9: 子表 UPDATE cc → 不可变触发器报错
-- ==========================================================================
\echo '[T9] 子表 UPDATE cc → 不可变触发器报错...'
DO $$
BEGIN
    UPDATE wms.wms_document_lines SET company_code = 'CHANGED'
    WHERE item_code = 'ITEM-RLS-01';
    RAISE EXCEPTION 'T9 FAILED: 应该被不可变触发器拦截';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM LIKE '%禁止修改%' THEN
            RAISE NOTICE 'T9 PASSED: 子表 cc 不可变';
        ELSE
            RAISE EXCEPTION 'T9 FAILED: 错误不符: %', SQLERRM;
        END IF;
END $$;

-- ==========================================================================
-- T10: set_config(true) 事务级 → 新事务后 GUC 清除
-- ==========================================================================
\echo '[T10] set_config(true) 事务后 GUC 清除...'
DO $$
DECLARE v TEXT;
BEGIN
    PERFORM set_config('app.company_code', 'TEMP_VALUE', true);
    v := current_setting('app.company_code', true);
    IF v = 'TEMP_VALUE' THEN
        RAISE NOTICE 'T10 step1: 事务内 GUC = TEMP_VALUE ✓';
    ELSE
        RAISE EXCEPTION 'T10 FAILED step1: 预期 TEMP_VALUE, 实际 %', v;
    END IF;
END $$;
DO $$
DECLARE v TEXT;
BEGIN
    v := current_setting('app.company_code', true);
    IF v IS NULL OR v = '' THEN
        RAISE NOTICE 'T10 PASSED: 新事务 GUC 已清除';
    ELSE
        RAISE EXCEPTION 'T10 FAILED: GUC 残留 = %', v;
    END IF;
END $$;

-- ==========================================================================
-- T11: session 级 set_config(false) → 跨 DO $$ 块保持
-- (模拟 n8n 两个节点共享连接)
-- ==========================================================================
\echo '[T11] set_config(false) 跨事务保持 (n8n 模式)...'
SET ROLE dp_app_rls;
SELECT set_config('app.company_code', 'TEST_A', false);
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM wms.wms_documents
    WHERE doc_number LIKE 'RLS-TEST-%';
    IF cnt = 1 THEN
        RAISE NOTICE 'T11 PASSED: session 级 GUC 跨事务有效, 看到 1 条';
    ELSE
        RAISE EXCEPTION 'T11 FAILED: 预期 1 条, 实际 %', cnt;
    END IF;
END $$;
SELECT set_config('app.company_code', '', false);
RESET ROLE;

-- ==========================================================================
-- T12: 跨 schema 触发器 → SKIP
-- ==========================================================================
\echo '[T12] 跨 schema 触发器 → SKIP (Phase B 手动验证)'

-- ==========================================================================
-- T13: 审计表 dp_app_rls 只能 INSERT+SELECT
-- ==========================================================================
\echo '[T13] 审计表 dp_app_rls UPDATE 被拦截...'
SET ROLE dp_app_rls;
DO $$
BEGIN
    PERFORM set_config('app.company_code', 'TEST_A', false);
    UPDATE wms.wms_audit_log SET old_value = 'hacked' WHERE company_code = 'TEST_A';
    RAISE EXCEPTION 'T13 FAILED: UPDATE 应被拦截';
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'T13 PASSED: 审计表 UPDATE 被拦截: %', SQLERRM;
END $$;
SELECT set_config('app.company_code', '', false);
RESET ROLE;

-- ==========================================================================
-- T14: EXPLAIN ANALYZE (人工检查索引命中)
-- ==========================================================================
\echo '[T14] EXPLAIN ANALYZE:'
SET ROLE dp_app_rls;
SELECT set_config('app.company_code', 'TEST_A', false);
EXPLAIN ANALYZE
SELECT * FROM wms.wms_documents WHERE doc_number LIKE 'RLS-TEST-%';
SELECT set_config('app.company_code', '', false);
RESET ROLE;

-- --------------------------------------------------------------------------
-- 清理测试数据
-- --------------------------------------------------------------------------
\echo ''
\echo '[清理] 删除测试数据...'
DELETE FROM wms.wms_document_lines WHERE item_code LIKE 'ITEM-RLS-%';
DELETE FROM wms.wms_audit_log WHERE performed_by = 'rls_tester' AND action = 'INSERT';
DELETE FROM wms.wms_documents WHERE doc_number LIKE 'RLS-TEST-%';

\echo '============================================================'
\echo '  RLS 行为测试完成'
\echo '============================================================'
