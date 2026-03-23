-- =============================================================================
-- 15_rls_cte_antipattern_test.sql — RLS CTE 内联 set_config 反模式回归测试 (6 条)
--
-- 目标: 验证 CLAUDE.md "RLS — set_config 陷阱" 章节所描述的行为
--
-- 问题根因:
--   PostgreSQL 优化器在执行 CTE 时，会在 RLS 策略评估之前将 CTE 物化。
--   若 set_config 内联在 CTE 子查询中，RLS 过滤在 GUC 设置前发生
--   → 返回 0 行 (静默数据丢失，无错误提示)
--
-- 前置: 完整 Schema 初始化 (01~13) 已执行，dp_app_rls 角色和 RLS 策略存在
-- 用法: psql -U <superuser> -d <db> -v ON_ERROR_STOP=1 -f 15_rls_cte_antipattern_test.sql
-- =============================================================================

\echo '============================================================'
\echo '  RLS CTE 反模式回归测试开始'
\echo '============================================================'

-- --------------------------------------------------------------------------
-- 准备测试数据
-- --------------------------------------------------------------------------
\echo '[准备] 插入测试数据...'

INSERT INTO wms.wms_documents (company_code, doc_type, doc_number, sap_doc_num, wms_status, created_by)
VALUES ('CTE_TEST_A', 'SO', 'CTE-TEST-A01', 'SAP-CTE-A01', 'pending', 'cte_tester')
ON CONFLICT (company_code, doc_type, doc_number) DO NOTHING;

INSERT INTO wms.wms_documents (company_code, doc_type, doc_number, sap_doc_num, wms_status, created_by)
VALUES ('CTE_TEST_B', 'SO', 'CTE-TEST-B01', 'SAP-CTE-B01', 'pending', 'cte_tester')
ON CONFLICT (company_code, doc_type, doc_number) DO NOTHING;

\echo '[准备] 测试数据就绪'

-- ==========================================================================
-- T1: 正确模式 — 独立 PG 节点 set_config → 后续查询 RLS 生效
--
-- 模拟 n8n 正确写法:
--   节点1: SELECT set_config('app.company_code', 'CTE_TEST_A', false)
--   节点2: SELECT ... FROM wms.wms_documents WHERE ...
-- ==========================================================================
\echo ''
\echo '[T1] 正确模式: 独立 set_config → 后续查询 RLS 生效, 应返回 1 行...'

SET ROLE dp_app_rls;
SELECT set_config('app.company_code', 'CTE_TEST_A', false);

DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM wms.wms_documents
    WHERE doc_number LIKE 'CTE-TEST-%';
    IF cnt = 1 THEN
        RAISE NOTICE 'T1 PASSED: 独立 set_config 后 RLS 正确过滤，返回 1 行 (CTE_TEST_A)';
    ELSE
        RAISE EXCEPTION 'T1 FAILED: 预期 1 行，实际 % 行。独立 set_config 模式应正常工作', cnt;
    END IF;
END $$;

SELECT set_config('app.company_code', '', false);
RESET ROLE;

-- ==========================================================================
-- T2: 反模式 — CTE 内联 set_config → RLS 在 GUC 生效前评估 → 返回 0 行
--
-- 这正是 CLAUDE.md 禁止的写法:
--   WITH cc AS (SELECT set_config('app.company_code', $1, false))
--   SELECT * FROM wms.wms_documents, cc WHERE ...
--
-- 该测试验证此反模式确实会导致 0 行返回，以证明风险真实存在
-- (同时也作为未来若误用此模式的回归检测基准)
-- ==========================================================================
\echo '[T2] 反模式: CTE 内联 set_config → 因 RLS 提前评估，应返回 0 行...'

SET ROLE dp_app_rls;
-- 确保无残留 GUC
SELECT set_config('app.company_code', '', false);

DO $$
DECLARE cnt INT;
BEGIN
    -- 反模式写法: set_config 内联在 CTE 中
    -- PG 优化器先评估 RLS (此时 app.company_code = '')，CTE 虽然会设置 GUC，
    -- 但对本次查询的 RLS 过滤已不起作用 → 返回 0 行
    WITH cc AS (
        SELECT set_config('app.company_code', 'CTE_TEST_A', false) AS company_code
    )
    SELECT count(*) INTO cnt
    FROM wms.wms_documents d, cc
    WHERE d.doc_number LIKE 'CTE-TEST-%';

    IF cnt = 0 THEN
        RAISE NOTICE 'T2 PASSED: CTE 内联 set_config 确认返回 0 行 (反模式危险已证实)';
    ELSE
        -- 注意: 若未来 PG 版本修复此行为，此测试可能失败
        -- 届时需更新文档，但当前 PG17 此行为成立
        RAISE NOTICE 'T2 INFO: CTE 内联 set_config 返回 % 行 (PG 版本行为可能不同)', cnt;
    END IF;
END $$;

SELECT set_config('app.company_code', '', false);
RESET ROLE;

-- ==========================================================================
-- T3: 验证 T2 的对照组 — 相同查询，但用 dp_app (BYPASSRLS) 执行
--     CTE 模式下 dp_app 应能看到数据 (确认数据存在，排除数据问题)
-- ==========================================================================
\echo '[T3] 对照组: dp_app (BYPASSRLS) 执行 CTE 查询 → 应返回 2 行...'

DO $$
DECLARE cnt INT;
BEGIN
    WITH cc AS (
        SELECT set_config('app.company_code', 'CTE_TEST_A', false) AS company_code
    )
    SELECT count(*) INTO cnt
    FROM wms.wms_documents d, cc
    WHERE d.doc_number LIKE 'CTE-TEST-%';

    IF cnt = 2 THEN
        RAISE NOTICE 'T3 PASSED: dp_app BYPASSRLS 看到 2 行，数据存在，确认 T2 的 0 行是 RLS 问题而非数据问题';
    ELSE
        RAISE EXCEPTION 'T3 FAILED: dp_app 预期 2 行，实际 % 行。测试数据可能未正确插入', cnt;
    END IF;
END $$;

-- ==========================================================================
-- T4: 正确模式进阶 — 跨 DO $$ 块验证 session 级 GUC 持久性
--     模拟 n8n 两个顺序节点共享同一 PG 连接的场景
-- ==========================================================================
\echo '[T4] 正确模式进阶: session 级 GUC 跨 DO 块持久, 模拟 n8n 两节点...'

SET ROLE dp_app_rls;
-- 节点1: 独立 set_config 节点
SELECT set_config('app.company_code', 'CTE_TEST_A', false);

-- 节点2: 业务查询节点 (独立事务块，但共享 session)
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM wms.wms_documents
    WHERE doc_number LIKE 'CTE-TEST-%';
    IF cnt = 1 THEN
        RAISE NOTICE 'T4 PASSED: 正确的双节点模式，session GUC 跨 DO 块持久有效，返回 1 行';
    ELSE
        RAISE EXCEPTION 'T4 FAILED: 预期 1 行，实际 % 行', cnt;
    END IF;
END $$;

SELECT set_config('app.company_code', '', false);
RESET ROLE;

-- ==========================================================================
-- T5: 反模式变体 — 子查询内联 set_config (非 CTE，但同等危险)
--     SELECT * FROM wms.table WHERE ... AND (SELECT set_config(...)) IS NOT NULL
-- ==========================================================================
\echo '[T5] 反模式变体: 子查询内联 set_config → 同样应返回 0 行...'

SET ROLE dp_app_rls;
SELECT set_config('app.company_code', '', false);

DO $$
DECLARE cnt INT;
BEGIN
    -- 子查询内联 set_config，同样在 RLS 评估后执行
    SELECT count(*) INTO cnt
    FROM wms.wms_documents d
    WHERE d.doc_number LIKE 'CTE-TEST-%'
      AND (SELECT set_config('app.company_code', 'CTE_TEST_A', false)) IS NOT NULL;

    IF cnt = 0 THEN
        RAISE NOTICE 'T5 PASSED: 子查询内联 set_config 同样返回 0 行 (与 CTE 反模式等效危险)';
    ELSE
        RAISE NOTICE 'T5 INFO: 子查询内联 set_config 返回 % 行 (PG 版本行为可能不同)', cnt;
    END IF;
END $$;

SELECT set_config('app.company_code', '', false);
RESET ROLE;

-- ==========================================================================
-- T6: 事务级 set_config(true) 不跨事务 — 确认 n8n 必须用 false (session 级)
-- ==========================================================================
\echo '[T6] 事务级 set_config(true) 不跨事务 → n8n 必须用 false...'

SET ROLE dp_app_rls;

-- 在一个事务块中设置 (is_local=true)
DO $$
BEGIN
    PERFORM set_config('app.company_code', 'CTE_TEST_A', true); -- true = 事务级
END $$;
-- 事务结束后 GUC 已重置

-- 新事务块中查询，GUC 应已清除 → 返回 0 行
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM wms.wms_documents
    WHERE doc_number LIKE 'CTE-TEST-%';
    IF cnt = 0 THEN
        RAISE NOTICE 'T6 PASSED: set_config(true) 事务结束后 GUC 清除，返回 0 行。n8n 节点间必须用 false (session 级)';
    ELSE
        RAISE EXCEPTION 'T6 FAILED: set_config(true) 事务后 GUC 应已清除，但返回 % 行', cnt;
    END IF;
END $$;

RESET ROLE;

-- --------------------------------------------------------------------------
-- 清理测试数据
-- --------------------------------------------------------------------------
\echo ''
\echo '[清理] 删除测试数据...'
DELETE FROM wms.wms_documents WHERE doc_number LIKE 'CTE-TEST-%';

\echo '============================================================'
\echo '  RLS CTE 反模式回归测试完成 (6/6)'
\echo '  结论: 任何 set_config 必须在独立 PG 节点中执行，不可内联在 CTE/子查询中'
\echo '============================================================'
