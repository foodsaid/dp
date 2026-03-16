-- =============================================================================
-- 08_sso_users.sql — SSO 用户管理表 (方案A: 数据库为源, 同步到 users.yml)
-- =============================================================================
-- 此表是 SSO 用户的"源数据", 通过 scripts/sso-sync-users.sh 同步到 Authelia users.yml
-- Authelia 使用 file backend 读取 users.yml; 此表提供 CRUD 管理能力
-- =============================================================================

-- 依赖: 07_sso_schema.sh 已创建 authelia schema
-- 依赖: wms.fn_updated_at() 触发器 (03_wms_tables.sql 定义)

CREATE TABLE IF NOT EXISTS authelia.sso_users (
    -- username: Authelia users.yml 的 key, 用于 X-Forwarded-User header
    username        VARCHAR(50)     PRIMARY KEY,
    -- display_name: Authelia displayname 字段, 同时作为 WMS performed_by
    display_name    VARCHAR(100)    NOT NULL,
    -- password_hash: argon2id 哈希, 由 authelia crypto hash generate 生成
    password_hash   TEXT            NOT NULL,
    -- email: 可选, Authelia emails 字段
    email           VARCHAR(200),
    -- groups: PostgreSQL 数组, 映射到 Authelia groups
    -- 常用组: admins (管理), wms-users (WMS), bi-users (BI), qm (质检)
    groups          TEXT[]          NOT NULL DEFAULT '{wms-users}',
    -- disabled: true=禁用, Authelia users.yml 中 disabled: true
    disabled        BOOLEAN         NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- 自动更新 updated_at
CREATE TRIGGER trg_sso_users_updated
    BEFORE UPDATE ON authelia.sso_users
    FOR EACH ROW EXECUTE FUNCTION wms.fn_updated_at();

-- display_name 唯一 (SSO 模式下 display_name 同时作为 WMS performed_by, 必须唯一)
ALTER TABLE authelia.sso_users ADD CONSTRAINT uq_sso_users_display_name UNIQUE (display_name);

-- 索引: 按组查询
CREATE INDEX IF NOT EXISTS idx_sso_users_groups ON authelia.sso_users USING GIN (groups);

COMMENT ON TABLE authelia.sso_users IS 'SSO 用户管理 (源数据, 同步到 Authelia users.yml)';
COMMENT ON COLUMN authelia.sso_users.username IS 'Authelia 用户名 (users.yml key, X-Forwarded-User 值)';
COMMENT ON COLUMN authelia.sso_users.display_name IS '显示名称 (同时作为 WMS performed_by)';
COMMENT ON COLUMN authelia.sso_users.password_hash IS 'argon2id 哈希 (authelia crypto hash generate)';
COMMENT ON COLUMN authelia.sso_users.groups IS '用户组: admins/wms-users/bi-users/qm';
