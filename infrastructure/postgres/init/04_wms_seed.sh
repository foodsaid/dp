#!/bin/bash
# ============================================================================
# DP v0.1 — WMS 管理员初始化脚本
# 在 PostgreSQL 首次启动时由 docker-entrypoint-initdb.d 自动执行
# 凭据来自 .env → docker-compose.yml 环境变量
# ============================================================================

set -e

ADMIN_USER="${DP_WMS_ADMIN_USERNAME:-wmsadmin}"
ADMIN_PASS="${DP_WMS_ADMIN_PASSWORD}"
COMPANY="${DP_COMPANY_CODE:-DEFAULT}"
DB_NAME="${POSTGRES_DB:-dp}"
DB_USER="${POSTGRES_USER:-dp_app}"

echo "=== [DP] 创建 WMS 管理员: $ADMIN_USER (公司: $COMPANY) ==="

# 使用 pgcrypto 的 encode + digest 实现 SHA-256 (与前端 SubtleCrypto 兼容)
# 注意: 使用 psql -v 变量绑定 + :'var' 语法防止 SQL 注入 (单引号自动转义)
psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
    -v company="$COMPANY" \
    -v admin_user="$ADMIN_USER" \
    -v admin_pass="$ADMIN_PASS" <<'SQL'
INSERT INTO wms.wms_users (company_code, username, password, display_name, role, is_active)
VALUES (
    :'company',
    :'admin_user',
    encode(digest(:'admin_pass', 'sha256'), 'hex'),
    'Administrator',
    'admin',
    TRUE
)
ON CONFLICT (company_code, username) DO NOTHING;
SQL

echo "=== [DP] WMS 管理员就绪 ==="
