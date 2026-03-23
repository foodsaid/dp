#!/bin/bash
# =============================================================================
# sso-migrate-wms-users.sh — 从 WMS 用户表迁移到 SSO 用户表
# =============================================================================
# 注意: WMS 使用 SHA-256 密码哈希, Authelia 使用 argon2id
#       密码无法直接迁移, 所有用户需设置临时密码后重置
#
# 用法: bash scripts/sso-migrate-wms-users.sh [临时密码]
#       默认临时密码: Changeme123!
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$PROJECT_DIR/.env"
    set +a
fi

DB_CONTAINER="${DB_CONTAINER:-dp-db}"
DB_NAME="${DP_DB_NAME:-dp}"
DB_USER="${DP_DB_USER:-dp_app}"
SSO_CONTAINER="${SSO_CONTAINER:-dp-sso}"

TEMP_PASSWORD="${1:-Changeme123!}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

run_sql() {
    docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "$1"
}

# 参数化 SQL (防注入, 与 sso-manage-user.sh 保持一致)
# 用法: run_sql_vars "SQL with :'var'" var1="val1" var2="val2"
run_sql_vars() {
    local sql="$1"
    shift
    local args=()
    for pair in "$@"; do
        args+=(-v "$pair")
    done
    docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A "${args[@]}" -c "$sql"
}

# 检查容器
for c in "$DB_CONTAINER" "$SSO_CONTAINER"; do
    if ! docker inspect --format='{{.State.Running}}' "$c" 2>/dev/null | grep -q true; then
        error "$c 容器未运行"
        exit 1
    fi
done

info "=== WMS → SSO 用户迁移 ==="
info "临时密码: $TEMP_PASSWORD (所有迁移用户需首次登录后重置)"

# 生成 argon2id 哈希
info "生成临时密码的 argon2id 哈希..."
HASH=$(docker exec "$SSO_CONTAINER" authelia crypto hash generate argon2 --password "$TEMP_PASSWORD" 2>/dev/null | grep '^\$argon2id')
if [ -z "$HASH" ]; then
    error "密码哈希生成失败"
    exit 1
fi

# 查询 WMS 用户
info "查询 WMS 用户表..."
WMS_USERS=$(run_sql "SELECT username, display_name, role FROM wms.wms_users WHERE is_active = true ORDER BY username;")

if [ -z "$WMS_USERS" ]; then
    warn "WMS 用户表无活跃用户"
    exit 0
fi

# 角色映射: WMS role → Authelia groups
map_groups() {
    local role="$1"
    case "$role" in
        admin)    echo "admins,wms-users,bi-users" ;;
        qm)       echo "wms-users,qm" ;;
        operator) echo "wms-users" ;;
        *)        echo "wms-users" ;;
    esac
}

MIGRATED=0
SKIPPED=0

while IFS='|' read -r username display_name role; do
    [ -z "$username" ] && continue

    # 检查是否已存在 (参数化防注入)
    exists=$(run_sql_vars "SELECT COUNT(*) FROM authelia.sso_users WHERE username = :'username'" "username=$username")
    if [ "$exists" -gt 0 ]; then
        warn "跳过 '$username' (已存在于 SSO 表)"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    groups=$(map_groups "$role")

    # PG 数组: 使用 psql 参数化 + ::text[] 类型转换 (与 sso-manage-user.sh 一致)
    pg_groups="{$groups}"

    run_sql_vars "INSERT INTO authelia.sso_users (username, display_name, password_hash, groups)
             VALUES (:'username', :'display_name', :'hash', :'pg_groups'::text[])
             ON CONFLICT (username) DO NOTHING;" \
        "username=$username" "display_name=$display_name" "hash=$HASH" "pg_groups=$pg_groups"

    info "  迁移: $username ($display_name) → 组: $groups"
    MIGRATED=$((MIGRATED + 1))
done <<< "$WMS_USERS"

info ""
info "=== 迁移完成 ==="
info "  迁移: $MIGRATED 个用户"
info "  跳过: $SKIPPED 个用户 (已存在)"
info ""
warn "⚠️  所有迁移用户使用临时密码: $TEMP_PASSWORD"
warn "⚠️  请通知用户首次登录后重置密码:"
warn "     bash scripts/sso-manage-user.sh reset-password <username>"

# 自动同步
info ""
info "正在同步到 users.yml..."
bash "$SCRIPT_DIR/sso-manage-user.sh" sync
