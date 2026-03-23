-- ============================================================================
-- DP v0.1 — PostgreSQL 扩展初始化
-- 在默认数据库 dp 上启用所需扩展
-- ============================================================================

-- 向量检索 (AI 预留)
CREATE EXTENSION IF NOT EXISTS vector;

-- 模糊文本搜索 (物料名称/批号模糊匹配)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- UUID 生成 (会话 token 等)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 加密函数 (密码哈希等)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

SELECT '✓ DP 扩展初始化完成: vector, pg_trgm, uuid-ossp, pgcrypto' AS status;
