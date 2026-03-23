-- ============================================================================
-- DP v0.8 — Schema 隔离初始化
-- 6 个 Schema: core / wms / oms / wf / bi / ai
-- ============================================================================

-- Core 通用基础函数 (不含业务数据，仅工具函数)
CREATE SCHEMA IF NOT EXISTS core;
COMMENT ON SCHEMA core IS '通用基础函数（不含业务数据，仅工具函数）';

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
    EXECUTE format('GRANT ALL ON SCHEMA core TO %I', app_user);
    EXECUTE format('GRANT ALL ON SCHEMA wms TO %I', app_user);
    EXECUTE format('GRANT ALL ON SCHEMA wf TO %I', app_user);
    EXECUTE format('GRANT ALL ON SCHEMA bi TO %I', app_user);
    EXECUTE format('GRANT ALL ON SCHEMA ai TO %I', app_user);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA core GRANT ALL ON TABLES TO %I', app_user);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA wms GRANT ALL ON TABLES TO %I', app_user);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA wf GRANT ALL ON TABLES TO %I', app_user);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA bi GRANT ALL ON TABLES TO %I', app_user);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA ai GRANT ALL ON TABLES TO %I', app_user);
END $$;

-- ============================================================================
-- Core 通用触发器函数 (各 Schema 共用，避免重复定义)
-- ============================================================================

CREATE OR REPLACE FUNCTION core.fn_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION core.fn_synced_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.synced_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

SELECT '✓ DP Schema 隔离完成: core / wms / wf / bi / ai' AS status;
