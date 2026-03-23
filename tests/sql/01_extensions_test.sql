-- =============================================================================
-- 01_extensions_test.sql — PostgreSQL 扩展加载验证
-- =============================================================================
-- 验证 01_extensions.sql 初始化后所有必要扩展已正确安装
-- 在 CI pg-schema-test Job 中执行
-- =============================================================================

-- =============================================================================
-- 测试 1: pgvector 扩展已加载
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE NOTICE 'PASS: extension vector (pgvector) loaded';
  ELSE
    RAISE NOTICE 'FAIL: extension vector not found';
  END IF;
END $$;

-- =============================================================================
-- 测试 2: pg_trgm 扩展已加载 (模糊搜索)
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE NOTICE 'PASS: extension pg_trgm loaded';
  ELSE
    RAISE NOTICE 'FAIL: extension pg_trgm not found';
  END IF;
END $$;

-- =============================================================================
-- 测试 3: uuid-ossp 扩展已加载 (UUID 生成)
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp') THEN
    RAISE NOTICE 'PASS: extension uuid-ossp loaded';
  ELSE
    RAISE NOTICE 'FAIL: extension uuid-ossp not found';
  END IF;
END $$;

-- =============================================================================
-- 测试 4: pgcrypto 扩展已加载 (加密)
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    RAISE NOTICE 'PASS: extension pgcrypto loaded';
  ELSE
    RAISE NOTICE 'FAIL: extension pgcrypto not found';
  END IF;
END $$;
