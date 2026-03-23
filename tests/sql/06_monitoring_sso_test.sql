-- =============================================================================
-- 06_monitoring_sso_test.sql — 监控账号 + SSO Schema + SSO 用户表测试
-- 覆盖: 06_monitoring_user.sh / 07_sso_schema.sh / 08_sso_users.sql
-- 前置: 01~08 初始化已执行 (CI 环境可能仅执行 .sql, 跳过 .sh)
-- 用法: psql -U <superuser> -d <db> -v ON_ERROR_STOP=1 -f 06_monitoring_sso_test.sql
-- =============================================================================

\echo '============================================================'
\echo '  监控/SSO 初始化测试开始'
\echo '============================================================'

-- ==========================================================================
-- 测试 1: dp_monitor 角色 (条件: DP_MONITOR_PASSWORD 已设置时创建)
-- ==========================================================================
\echo '[测试 1] dp_monitor 角色...'

DO $$
DECLARE
    role_exists BOOLEAN;
    has_pg_monitor BOOLEAN;
BEGIN
    SELECT EXISTS(SELECT FROM pg_roles WHERE rolname = 'dp_monitor') INTO role_exists;
    IF NOT role_exists THEN
        RAISE NOTICE '⏭ 测试 1 跳过: dp_monitor 未创建 (DP_MONITOR_PASSWORD 未设置)';
        RETURN;
    END IF;

    SELECT EXISTS(
        SELECT FROM pg_auth_members
        WHERE roleid = (SELECT oid FROM pg_roles WHERE rolname = 'pg_monitor')
          AND member = (SELECT oid FROM pg_roles WHERE rolname = 'dp_monitor')
    ) INTO has_pg_monitor;

    IF NOT has_pg_monitor THEN
        RAISE EXCEPTION '❌ 测试 1 失败: dp_monitor 存在但未授予 pg_monitor 权限';
    END IF;
    RAISE NOTICE '✅ 测试 1: dp_monitor 角色存在且拥有 pg_monitor 权限';
END $$;

-- ==========================================================================
-- 测试 2~10: authelia Schema + sso_users 表 (条件: 07_sso_schema.sh 已执行)
-- ==========================================================================
\echo '[测试 2~10] SSO 相关测试...'

DO $$
DECLARE
    schema_exists BOOLEAN;
    schema_owner TEXT;
    col_count INT;
    required_cols TEXT[] := ARRAY['username', 'display_name', 'password_hash', 'email', 'groups', 'disabled', 'created_at', 'updated_at'];
    missing_cols TEXT[] := '{}';
    col TEXT;
    pk_col TEXT;
    uq_exists BOOLEAN;
    idx_exists BOOLEAN;
    trg_exists BOOLEAN;
    col_default TEXT;
    test_updated TIMESTAMPTZ;
    passed INT := 0;
BEGIN
    -- 前置检查: authelia schema 是否存在
    SELECT EXISTS(
        SELECT FROM information_schema.schemata WHERE schema_name = 'authelia'
    ) INTO schema_exists;

    IF NOT schema_exists THEN
        RAISE NOTICE '⏭ 测试 2~10 跳过: authelia schema 不存在 (07_sso_schema.sh 未执行)';
        RETURN;
    END IF;

    -- 测试 2: authelia Schema 存在
    RAISE NOTICE '✅ 测试 2: authelia Schema 存在';
    passed := passed + 1;

    -- 测试 3: authelia Schema 属主非 postgres
    SELECT nspowner::regrole::text INTO schema_owner
    FROM pg_namespace WHERE nspname = 'authelia';

    IF schema_owner = 'postgres' THEN
        RAISE EXCEPTION '❌ 测试 3 失败: authelia Schema 属主是 postgres (应为业务用户)';
    END IF;
    RAISE NOTICE '✅ 测试 3: authelia Schema 属主是 % (非 postgres)', schema_owner;
    passed := passed + 1;

    -- 检查 sso_users 表是否存在
    IF NOT EXISTS(
        SELECT FROM information_schema.tables
        WHERE table_schema = 'authelia' AND table_name = 'sso_users'
    ) THEN
        RAISE NOTICE '⏭ 测试 4~10 跳过: authelia.sso_users 表不存在 (08_sso_users.sql 未执行)';
        RETURN;
    END IF;

    -- 测试 4: sso_users 表结构完整
    FOR col IN SELECT unnest(required_cols) LOOP
        IF NOT EXISTS(
            SELECT FROM information_schema.columns
            WHERE table_schema = 'authelia' AND table_name = 'sso_users' AND column_name = col
        ) THEN
            missing_cols := array_append(missing_cols, col);
        END IF;
    END LOOP;

    IF array_length(missing_cols, 1) > 0 THEN
        RAISE EXCEPTION '❌ 测试 4 失败: sso_users 缺少列: %', array_to_string(missing_cols, ', ');
    END IF;
    RAISE NOTICE '✅ 测试 4: sso_users 表包含全部 8 个必需列';
    passed := passed + 1;

    -- 测试 5: sso_users 主键是 username
    SELECT a.attname INTO pk_col
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = 'authelia.sso_users'::regclass
      AND i.indisprimary;

    IF pk_col != 'username' THEN
        RAISE EXCEPTION '❌ 测试 5 失败: sso_users 主键是 % (应为 username)', pk_col;
    END IF;
    RAISE NOTICE '✅ 测试 5: sso_users 主键是 username';
    passed := passed + 1;

    -- 测试 6: display_name 唯一约束
    SELECT EXISTS(
        SELECT FROM pg_constraint c
        JOIN pg_namespace n ON c.connamespace = n.oid
        WHERE n.nspname = 'authelia'
          AND c.conrelid = 'authelia.sso_users'::regclass
          AND c.contype = 'u'
          AND c.conname = 'uq_sso_users_display_name'
    ) INTO uq_exists;

    IF NOT uq_exists THEN
        RAISE EXCEPTION '❌ 测试 6 失败: display_name 唯一约束不存在';
    END IF;
    RAISE NOTICE '✅ 测试 6: display_name 唯一约束存在';
    passed := passed + 1;

    -- 测试 7: groups GIN 索引存在
    SELECT EXISTS(
        SELECT FROM pg_indexes
        WHERE schemaname = 'authelia'
          AND tablename = 'sso_users'
          AND indexname = 'idx_sso_users_groups'
    ) INTO idx_exists;

    IF NOT idx_exists THEN
        RAISE EXCEPTION '❌ 测试 7 失败: groups GIN 索引不存在';
    END IF;
    RAISE NOTICE '✅ 测试 7: groups GIN 索引存在';
    passed := passed + 1;

    -- 测试 8: updated_at 触发器存在
    SELECT EXISTS(
        SELECT FROM information_schema.triggers
        WHERE event_object_schema = 'authelia'
          AND event_object_table = 'sso_users'
          AND trigger_name = 'trg_sso_users_updated'
    ) INTO trg_exists;

    IF NOT trg_exists THEN
        RAISE EXCEPTION '❌ 测试 8 失败: sso_users updated_at 触发器不存在';
    END IF;
    RAISE NOTICE '✅ 测试 8: updated_at 触发器存在';
    passed := passed + 1;

    -- 测试 9: groups 默认值为 {wms-users}
    SELECT column_default INTO col_default
    FROM information_schema.columns
    WHERE table_schema = 'authelia' AND table_name = 'sso_users' AND column_name = 'groups';

    IF col_default IS NULL OR col_default NOT LIKE '%wms-users%' THEN
        RAISE EXCEPTION '❌ 测试 9 失败: groups 默认值不含 wms-users (实际: %)', COALESCE(col_default, 'NULL');
    END IF;
    RAISE NOTICE '✅ 测试 9: groups 默认值包含 wms-users';
    passed := passed + 1;

    -- 测试 10: CRUD 行为验证
    INSERT INTO authelia.sso_users (username, display_name, password_hash)
    VALUES ('_test_user_06', '测试用户06', '$argon2id$v=19$m=65536,t=3,p=4$test')
    ON CONFLICT (username) DO UPDATE SET display_name = '测试用户06';

    IF NOT EXISTS(
        SELECT FROM authelia.sso_users
        WHERE username = '_test_user_06' AND groups @> ARRAY['wms-users']
    ) THEN
        RAISE EXCEPTION '❌ 测试 10a 失败: 默认 groups 不含 wms-users';
    END IF;

    PERFORM pg_sleep(0.1);
    UPDATE authelia.sso_users SET display_name = '测试用户06更新' WHERE username = '_test_user_06';
    SELECT updated_at INTO test_updated FROM authelia.sso_users WHERE username = '_test_user_06';

    IF test_updated <= (SELECT created_at FROM authelia.sso_users WHERE username = '_test_user_06') THEN
        RAISE EXCEPTION '❌ 测试 10b 失败: updated_at 未随更新变化';
    END IF;

    DELETE FROM authelia.sso_users WHERE username = '_test_user_06';
    RAISE NOTICE '✅ 测试 10: CRUD 行为正常 (插入/更新/触发器/清理)';
    passed := passed + 1;

    RAISE NOTICE '  SSO 测试通过: %/9', passed;
END $$;

\echo '============================================================'
\echo '  监控/SSO 初始化测试完成'
\echo '============================================================'
