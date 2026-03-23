#!/bin/bash
# =============================================================================
# 11_rls_roles.sh — RLS 行级安全角色 + 权限 + 辅助函数
# v0.6: dp_app_rls (业务受限) + dp_bi (BI 只读)
# 幂等: 角色/函数已存在则跳过
# =============================================================================
set -e

# --------------------------------------------------------------------------
# 前置: 密码必须存在
# --------------------------------------------------------------------------
if [ -z "${DP_DB_RLS_PASSWORD:-}" ]; then
    echo "11_rls_roles.sh: DP_DB_RLS_PASSWORD 未设置, 跳过 RLS 角色创建"
    exit 0
fi

if [ -z "${DP_DB_BI_PASSWORD:-}" ]; then
    echo "11_rls_roles.sh: DP_DB_BI_PASSWORD 未设置, 跳过 RLS 角色创建"
    exit 0
fi

echo "11_rls_roles.sh: 开始创建 RLS 角色..."

# --------------------------------------------------------------------------
# 角色创建 (bash 层幂等检查, 因为 psql -v 变量不能在 DO $$ 内使用)
# --------------------------------------------------------------------------
rls_exists=$(psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='dp_app_rls'" \
    --username "$POSTGRES_USER" --dbname "$POSTGRES_DB")
if [ "$rls_exists" != "1" ]; then
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
        <<EOSQL_ROLE1
CREATE ROLE dp_app_rls WITH LOGIN PASSWORD '${DP_DB_RLS_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
EOSQL_ROLE1
    echo "11_rls_roles.sh: dp_app_rls 角色已创建"
else
    echo "11_rls_roles.sh: dp_app_rls 角色已存在, 跳过"
fi

bi_exists=$(psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='dp_bi'" \
    --username "$POSTGRES_USER" --dbname "$POSTGRES_DB")
if [ "$bi_exists" != "1" ]; then
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
        <<EOSQL_ROLE2
CREATE ROLE dp_bi WITH LOGIN PASSWORD '${DP_DB_BI_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
EOSQL_ROLE2
    echo "11_rls_roles.sh: dp_bi 角色已创建"
else
    echo "11_rls_roles.sh: dp_bi 角色已存在, 跳过"
fi

# --------------------------------------------------------------------------
# 权限 + 函数 + 触发器 (纯 SQL, 不需要密码变量)
# --------------------------------------------------------------------------
psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'

-- ============================================================================
-- 1. dp_app_rls 权限
-- ============================================================================

-- Schema 使用权
GRANT USAGE ON SCHEMA wms TO dp_app_rls;
GRANT USAGE ON SCHEMA oms TO dp_app_rls;
GRANT USAGE ON SCHEMA ai  TO dp_app_rls;

-- 表权限: SELECT + INSERT + UPDATE + DELETE (审计表后面单独 REVOKE)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA wms TO dp_app_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA oms TO dp_app_rls;
GRANT SELECT ON ALL TABLES IN SCHEMA ai TO dp_app_rls;
GRANT INSERT ON ai.ai_embeddings TO dp_app_rls;

-- 序列权限 (INSERT 需要)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA wms TO dp_app_rls;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA oms TO dp_app_rls;

-- 默认权限 (未来新表自动继承)
ALTER DEFAULT PRIVILEGES IN SCHEMA wms
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dp_app_rls;
ALTER DEFAULT PRIVILEGES IN SCHEMA oms
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dp_app_rls;
ALTER DEFAULT PRIVILEGES IN SCHEMA wms
    GRANT USAGE, SELECT ON SEQUENCES TO dp_app_rls;
ALTER DEFAULT PRIVILEGES IN SCHEMA oms
    GRANT USAGE, SELECT ON SEQUENCES TO dp_app_rls;

-- 审计表: 只允许 INSERT + SELECT (禁止 UPDATE/DELETE)
REVOKE UPDATE, DELETE ON wms.wms_audit_log FROM dp_app_rls;
REVOKE UPDATE, DELETE ON oms.audit_logs FROM dp_app_rls;

-- ============================================================================
-- 2. dp_bi 权限 (角色已在上面 bash 层创建)
-- ============================================================================

-- Schema 使用权
GRANT USAGE ON SCHEMA wms TO dp_bi;
GRANT USAGE ON SCHEMA oms TO dp_bi;
GRANT USAGE ON SCHEMA bi  TO dp_bi;
GRANT USAGE ON SCHEMA ai  TO dp_bi;

-- 只读: SELECT ONLY
GRANT SELECT ON ALL TABLES IN SCHEMA wms TO dp_bi;
GRANT SELECT ON ALL TABLES IN SCHEMA oms TO dp_bi;
GRANT SELECT ON ALL TABLES IN SCHEMA bi  TO dp_bi;
GRANT SELECT ON ALL TABLES IN SCHEMA ai  TO dp_bi;

-- 显式 REVOKE 写权限 (防止未来 GRANT ALL 覆盖)
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA wms FROM dp_bi;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA oms FROM dp_bi;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA bi  FROM dp_bi;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ai  FROM dp_bi;

-- 默认权限: 未来新表只给 SELECT
ALTER DEFAULT PRIVILEGES IN SCHEMA wms GRANT SELECT ON TABLES TO dp_bi;
ALTER DEFAULT PRIVILEGES IN SCHEMA oms GRANT SELECT ON TABLES TO dp_bi;
ALTER DEFAULT PRIVILEGES IN SCHEMA bi  GRANT SELECT ON TABLES TO dp_bi;
ALTER DEFAULT PRIVILEGES IN SCHEMA bi  GRANT ALL ON TABLES TO dp_bi;

-- PUBLIC 兜底
REVOKE ALL ON ALL TABLES IN SCHEMA wms FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA oms FROM PUBLIC;

-- ============================================================================
-- 3. 辅助函数: wms.current_company() (应用层诊断用, 不用于 RLS 策略)
-- ============================================================================
CREATE OR REPLACE FUNCTION wms.current_company() RETURNS TEXT
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog
AS $$
DECLARE v TEXT;
BEGIN
    v := current_setting('app.company_code', true);
    IF v IS NULL OR TRIM(v) = '' THEN
        RAISE EXCEPTION 'app.company_code not set — 请在事务开头调用 set_config';
    END IF;
    RETURN v;
END;
$$;

-- 授权
GRANT EXECUTE ON FUNCTION wms.current_company() TO dp_app_rls;
GRANT EXECUTE ON FUNCTION wms.current_company() TO dp_bi;

-- ============================================================================
-- 4. 父表 company_code 不可变触发器
-- ============================================================================
CREATE OR REPLACE FUNCTION wms.fn_immutable_company_code()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.company_code IS DISTINCT FROM NEW.company_code THEN
        RAISE EXCEPTION 'company_code 禁止修改 (table: %, old: %, new: %)',
            TG_TABLE_NAME, OLD.company_code, NEW.company_code;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 应用到所有有 company_code 的父表 (幂等: DROP IF EXISTS 再创建)
DO $$
DECLARE
    tbl RECORD;
    trg_name TEXT;
BEGIN
    FOR tbl IN
        SELECT schemaname, tablename FROM (VALUES
            ('wms', 'wms_documents'),
            ('wms', 'wms_transactions'),
            ('wms', 'wms_stock_snapshot'),
            ('wms', 'wms_items_cache'),
            ('wms', 'wms_locations_cache'),
            ('wms', 'wms_bins_cache'),
            ('wms', 'wms_audit_log'),
            ('oms', 'orders'),
            ('oms', 'order_events'),
            ('oms', 'audit_logs')
        ) AS t(schemaname, tablename)
    LOOP
        trg_name := 'trg_' || tbl.tablename || '_cc_immutable';
        EXECUTE format(
            'DROP TRIGGER IF EXISTS %I ON %I.%I',
            trg_name, tbl.schemaname, tbl.tablename
        );
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE ON %I.%I '
            'FOR EACH ROW EXECUTE FUNCTION wms.fn_immutable_company_code()',
            trg_name, tbl.schemaname, tbl.tablename
        );
        RAISE NOTICE '11_rls_roles.sh: 触发器 % 已创建 on %.%',
            trg_name, tbl.schemaname, tbl.tablename;
    END LOOP;
END $$;

EOSQL

# --------------------------------------------------------------------------
# 5. dp_app_rls 角色级 GUC: 从 DP_COMPANY_CODE 环境变量动态设置
#    每次连接自动带 app.company_code，无需工作流节点手动 set_config
# --------------------------------------------------------------------------
dp_cc="${DP_COMPANY_CODE:-DEFAULT}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    <<EOSQL_GUC
ALTER ROLE dp_app_rls SET app.company_code = '${dp_cc}';
EOSQL_GUC
echo "11_rls_roles.sh: dp_app_rls GUC app.company_code = '${dp_cc}'"

echo "11_rls_roles.sh: 角色 + 权限 + 函数 + 触发器创建完成"
