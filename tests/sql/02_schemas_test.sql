-- =============================================================================
-- 02_schemas_test.sql — PostgreSQL Schema 存在性与权限验证
-- =============================================================================
-- 验证 02_schemas.sql 初始化后所有必要 Schema 已创建且权限正确
-- 在 CI pg-schema-test Job 中执行
-- =============================================================================

-- =============================================================================
-- 测试 1: wms Schema 存在
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'wms') THEN
    RAISE NOTICE 'PASS: schema wms exists';
  ELSE
    RAISE NOTICE 'FAIL: schema wms not found';
  END IF;
END $$;

-- =============================================================================
-- 测试 2: oms Schema 存在
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'oms') THEN
    RAISE NOTICE 'PASS: schema oms exists';
  ELSE
    RAISE NOTICE 'FAIL: schema oms not found';
  END IF;
END $$;

-- =============================================================================
-- 测试 3: wf Schema 存在
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'wf') THEN
    RAISE NOTICE 'PASS: schema wf exists';
  ELSE
    RAISE NOTICE 'FAIL: schema wf not found';
  END IF;
END $$;

-- =============================================================================
-- 测试 4: bi Schema 存在
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'bi') THEN
    RAISE NOTICE 'PASS: schema bi exists';
  ELSE
    RAISE NOTICE 'FAIL: schema bi not found';
  END IF;
END $$;

-- =============================================================================
-- 测试 5: ai Schema 存在
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'ai') THEN
    RAISE NOTICE 'PASS: schema ai exists';
  ELSE
    RAISE NOTICE 'FAIL: schema ai not found';
  END IF;
END $$;

-- =============================================================================
-- 测试 6: authelia Schema 存在
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'authelia') THEN
    RAISE NOTICE 'PASS: schema authelia exists';
  ELSE
    RAISE NOTICE 'FAIL: schema authelia not found';
  END IF;
END $$;

-- =============================================================================
-- 测试 7: 当前用户对 wms Schema 有 USAGE 权限
-- =============================================================================

DO $$
BEGIN
  IF has_schema_privilege(current_user, 'wms', 'USAGE') THEN
    RAISE NOTICE 'PASS: current_user has USAGE on schema wms';
  ELSE
    RAISE NOTICE 'FAIL: current_user lacks USAGE on schema wms';
  END IF;
END $$;

-- =============================================================================
-- 测试 8: 当前用户对 oms Schema 有 USAGE 权限
-- =============================================================================

DO $$
BEGIN
  IF has_schema_privilege(current_user, 'oms', 'USAGE') THEN
    RAISE NOTICE 'PASS: current_user has USAGE on schema oms';
  ELSE
    RAISE NOTICE 'FAIL: current_user lacks USAGE on schema oms';
  END IF;
END $$;

-- =============================================================================
-- 测试 9: 当前用户对 bi Schema 有 USAGE 权限
-- =============================================================================

DO $$
BEGIN
  IF has_schema_privilege(current_user, 'bi', 'USAGE') THEN
    RAISE NOTICE 'PASS: current_user has USAGE on schema bi';
  ELSE
    RAISE NOTICE 'FAIL: current_user lacks USAGE on schema bi';
  END IF;
END $$;

-- =============================================================================
-- 测试 10: 当前用户对 ai Schema 有 USAGE 权限
-- =============================================================================

DO $$
BEGIN
  IF has_schema_privilege(current_user, 'ai', 'USAGE') THEN
    RAISE NOTICE 'PASS: current_user has USAGE on schema ai';
  ELSE
    RAISE NOTICE 'FAIL: current_user lacks USAGE on schema ai';
  END IF;
END $$;
