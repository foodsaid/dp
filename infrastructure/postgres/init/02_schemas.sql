-- ============================================================================
-- DP v0.1 — Schema 隔离初始化
-- 5 个 Schema: wms / oms / wf / bi / ai
-- ============================================================================

-- WMS 操作数据
CREATE SCHEMA IF NOT EXISTS wms;
COMMENT ON SCHEMA wms IS 'WMS 仓库管理系统 — 单据、库存、事务';

-- WF 工作流元数据 (n8n 自动管理)
CREATE SCHEMA IF NOT EXISTS wf;
COMMENT ON SCHEMA wf IS '工作流引擎 — n8n 元数据 (自动管理)';

-- BI 仪表盘元数据 (Superset 自动管理)
CREATE SCHEMA IF NOT EXISTS bi;
COMMENT ON SCHEMA bi IS 'BI 商业智能 — Superset 元数据 (自动管理)';

-- AI 向量数据 (pgvector, 预留)
CREATE SCHEMA IF NOT EXISTS ai;
COMMENT ON SCHEMA ai IS 'AI 智能体 — 向量数据 (pgvector, 预留)';

-- 授予应用用户访问所有 Schema 的权限
DO $$
DECLARE
    app_user TEXT := current_user;
BEGIN
    EXECUTE format('GRANT ALL ON SCHEMA wms TO %I', app_user);
    EXECUTE format('GRANT ALL ON SCHEMA wf TO %I', app_user);
    EXECUTE format('GRANT ALL ON SCHEMA bi TO %I', app_user);
    EXECUTE format('GRANT ALL ON SCHEMA ai TO %I', app_user);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA wms GRANT ALL ON TABLES TO %I', app_user);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA wf GRANT ALL ON TABLES TO %I', app_user);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA bi GRANT ALL ON TABLES TO %I', app_user);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA ai GRANT ALL ON TABLES TO %I', app_user);
END $$;

SELECT '✓ DP Schema 隔离完成: wms / wf / bi / ai' AS status;
