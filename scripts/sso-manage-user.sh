#!/bin/bash
# =============================================================================
# sso-manage-user.sh — SSO 用户管理 CLI
# =============================================================================
# 用法:
#   bash scripts/sso-manage-user.sh add <username> <display_name> <email> [groups]
#   bash scripts/sso-manage-user.sh remove <username>
#   bash scripts/sso-manage-user.sh list
#   bash scripts/sso-manage-user.sh reset-password <username>
#   bash scripts/sso-manage-user.sh disable <username>
#   bash scripts/sso-manage-user.sh enable <username>
#   bash scripts/sso-manage-user.sh sync    ← 同步 DB → users.yml → 重载 Authelia
#
# 前提:
#   - dp-db 容器运行中
#   - dp-sso 容器运行中 (用于生成 argon2id 哈希 + 热重载)
#   - .env 文件已配置 (或导出环境变量)
# =============================================================================
set -euo pipefail

# 加载 .env (如果存在)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$PROJECT_DIR/.env"
    set +a
fi

# 数据库连接参数
DB_CONTAINER="${DB_CONTAINER:-dp-db}"
DB_NAME="${DP_DB_NAME:-dp}"
DB_USER="${DP_DB_USER:-dp_app}"
SSO_CONTAINER="${SSO_CONTAINER:-dp-sso}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# 检查容器是否运行
check_container() {
    local name="$1"
    if ! docker inspect --format='{{.State.Running}}' "$name" 2>/dev/null | grep -q true; then
        error "$name 容器未运行"
        exit 1
    fi
}

# 执行 SQL (无用户输入的查询)
run_sql() {
    docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "$1"
}

# 执行参数化 SQL (防注入, 用于含用户输入的查询)
# 用法: run_sql_vars "SQL with :'var'" var1="val1" var2="val2"
# SQL 中用 :'varname' 引用变量 (psql 自动转义单引号)
run_sql_vars() {
    local sql="$1"
    shift
    local args=()
    for pair in "$@"; do
        args+=(-v "$pair")
    done
    docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A "${args[@]}" -c "$sql"
}

# 生成 argon2id 密码哈希 (通过 Authelia 容器)
generate_hash() {
    local password="$1"
    docker exec "$SSO_CONTAINER" authelia crypto hash generate argon2 --password "$password" 2>/dev/null | grep '^\$argon2id'
}

# 读取密码 (不回显)
read_password() {
    local prompt="${1:-密码}"
    local password
    read -rs -p "$prompt: " password
    echo >&2
    echo "$password"
}

# =========================================================================
# 命令: add
# =========================================================================
cmd_add() {
    local username="${1:-}"
    local display_name="${2:-}"
    local email="${3:-}"
    local groups="${4:-wms-users}"

    if [ -z "$username" ] || [ -z "$display_name" ]; then
        echo "用法: $0 add <username> <display_name> [email] [groups]"
        echo "  groups: 逗号分隔, 默认 wms-users"
        echo "  可用组: admins, wms-users, bi-users, qm"
        echo "  示例: $0 add alice 'Alice Wang' alice@example.com admins,wms-users"
        exit 1
    fi

    check_container "$DB_CONTAINER"
    check_container "$SSO_CONTAINER"

    # 检查用户是否已存在
    local exists
    exists=$(run_sql_vars "SELECT COUNT(*) FROM authelia.sso_users WHERE username = :'username'" "username=$username")
    if [ "$exists" -gt 0 ]; then
        error "用户 '$username' 已存在"
        exit 1
    fi

    # 读取密码
    local password
    password=$(read_password "设置密码")
    local password2
    password2=$(read_password "确认密码")
    if [ "$password" != "$password2" ]; then
        error "两次密码不一致"
        exit 1
    fi
    if [ ${#password} -lt 8 ]; then
        error "密码长度至少 8 位"
        exit 1
    fi

    # 生成 argon2id 哈希
    info "生成 argon2id 密码哈希..."
    local hash
    hash=$(generate_hash "$password")
    if [ -z "$hash" ]; then
        error "密码哈希生成失败 (dp-sso 容器问题?)"
        exit 1
    fi

    # 转换 groups 为 PG 数组字面量 (e.g. "admins,wms-users" → "{admins,wms-users}")
    local pg_groups="{$groups}"

    # 插入数据库 (参数化防注入)
    if [ -n "$email" ]; then
        run_sql_vars "INSERT INTO authelia.sso_users (username, display_name, password_hash, email, groups)
                 VALUES (:'username', :'display_name', :'hash', :'email', :'pg_groups'::text[]);" \
            "username=$username" "display_name=$display_name" "hash=$hash" "email=$email" "pg_groups=$pg_groups"
    else
        run_sql_vars "INSERT INTO authelia.sso_users (username, display_name, password_hash, email, groups)
                 VALUES (:'username', :'display_name', :'hash', NULL, :'pg_groups'::text[]);" \
            "username=$username" "display_name=$display_name" "hash=$hash" "pg_groups=$pg_groups"
    fi

    info "用户 '$username' ($display_name) 创建成功"
    info "组: $groups"

    # 自动同步
    cmd_sync
}

# =========================================================================
# 命令: remove
# =========================================================================
cmd_remove() {
    local username="${1:-}"
    if [ -z "$username" ]; then
        echo "用法: $0 remove <username>"
        exit 1
    fi

    check_container "$DB_CONTAINER"

    local deleted
    deleted=$(run_sql_vars "DELETE FROM authelia.sso_users WHERE username = :'username' RETURNING username;" "username=$username" | wc -l)
    if [ "$deleted" -eq 0 ]; then
        error "用户 '$username' 不存在"
        exit 1
    fi

    info "用户 '$username' 已删除"
    cmd_sync
}

# =========================================================================
# 命令: list
# =========================================================================
cmd_list() {
    check_container "$DB_CONTAINER"

    echo ""
    echo "=== SSO 用户列表 ==="
    run_sql "SELECT username, display_name, email, array_to_string(groups, ',') AS groups,
                    CASE WHEN disabled THEN '禁用' ELSE '启用' END AS status,
                    TO_CHAR(created_at, 'YYYY-MM-DD') AS created
             FROM authelia.sso_users ORDER BY username;" | \
        awk -F'|' 'BEGIN { printf "%-15s %-20s %-25s %-25s %-6s %s\n", "USERNAME", "DISPLAY_NAME", "EMAIL", "GROUPS", "STATUS", "CREATED"; print "-----------------------------------------------------------------------------------------------------------" }
                   { printf "%-15s %-20s %-25s %-25s %-6s %s\n", $1, $2, $3, $4, $5, $6 }'
    echo ""
}

# =========================================================================
# 命令: reset-password
# =========================================================================
cmd_reset_password() {
    local username="${1:-}"
    if [ -z "$username" ]; then
        echo "用法: $0 reset-password <username>"
        exit 1
    fi

    check_container "$DB_CONTAINER"
    check_container "$SSO_CONTAINER"

    # 验证用户存在
    local exists
    exists=$(run_sql_vars "SELECT COUNT(*) FROM authelia.sso_users WHERE username = :'username'" "username=$username")
    if [ "$exists" -eq 0 ]; then
        error "用户 '$username' 不存在"
        exit 1
    fi

    local password
    password=$(read_password "新密码")
    local password2
    password2=$(read_password "确认密码")
    if [ "$password" != "$password2" ]; then
        error "两次密码不一致"
        exit 1
    fi
    if [ ${#password} -lt 8 ]; then
        error "密码长度至少 8 位"
        exit 1
    fi

    info "生成 argon2id 密码哈希..."
    local hash
    hash=$(generate_hash "$password")
    if [ -z "$hash" ]; then
        error "密码哈希生成失败"
        exit 1
    fi

    run_sql_vars "UPDATE authelia.sso_users SET password_hash = :'hash' WHERE username = :'username';" "hash=$hash" "username=$username"
    info "用户 '$username' 密码已重置"
    cmd_sync
}

# =========================================================================
# 命令: disable / enable
# =========================================================================
cmd_disable() {
    local username="${1:-}"
    [ -z "$username" ] && { echo "用法: $0 disable <username>"; exit 1; }
    check_container "$DB_CONTAINER"
    run_sql_vars "UPDATE authelia.sso_users SET disabled = true WHERE username = :'username';" "username=$username"
    info "用户 '$username' 已禁用"
    cmd_sync
}

cmd_enable() {
    local username="${1:-}"
    [ -z "$username" ] && { echo "用法: $0 enable <username>"; exit 1; }
    check_container "$DB_CONTAINER"
    run_sql_vars "UPDATE authelia.sso_users SET disabled = false WHERE username = :'username';" "username=$username"
    info "用户 '$username' 已启用"
    cmd_sync
}

# =========================================================================
# 命令: sync — 数据库 → users.yml → Authelia 热重载
# =========================================================================
cmd_sync() {
    check_container "$DB_CONTAINER"

    info "从数据库同步用户到 users.yml..."

    # 查询所有用户
    local users_data
    users_data=$(run_sql "SELECT username, display_name, password_hash, email,
                                 array_to_string(groups, ',') AS groups,
                                 disabled
                          FROM authelia.sso_users ORDER BY username;")

    if [ -z "$users_data" ]; then
        warn "数据库中无 SSO 用户, 生成空 users.yml"
    fi

    # 生成 YAML
    local yml_file="$PROJECT_DIR/infrastructure/sso/users.yml"
    {
        echo "# ============================================================================="
        echo "# Authelia users.yml — 由 sso-manage-user.sh sync 自动生成"
        echo "# 请勿手动编辑! 修改请使用: bash scripts/sso-manage-user.sh add/remove/..."
        echo "# 生成时间: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
        echo "# ============================================================================="
        echo "users:"
    } > "$yml_file"

    local count=0
    while IFS='|' read -r username display_name password_hash email groups disabled; do
        [ -z "$username" ] && continue
        {
            echo "  $username:"
            echo "    displayname: \"$display_name\""
            echo "    password: \"$password_hash\""
            if [ -n "$email" ]; then
                echo "    email: \"$email\""
            else
                echo "    email: \"\""
            fi
            echo "    groups:"
            IFS=',' read -ra group_array <<< "$groups"
            for g in "${group_array[@]}"; do
                [ -n "$g" ] && echo "      - $g"
            done
            if [ "$disabled" = "t" ]; then
                echo "    disabled: true"
            fi
        } >> "$yml_file"
        count=$((count + 1))
    done <<< "$users_data"

    info "已写入 $count 个用户到 $yml_file"

    # 复制到 Authelia 容器 (如果运行中)
    if docker inspect --format='{{.State.Running}}' "$SSO_CONTAINER" 2>/dev/null | grep -q true; then
        docker cp "$yml_file" "$SSO_CONTAINER:/config/users.yml"
        info "已同步到 $SSO_CONTAINER 容器 (Authelia 自动检测文件变更并重载)"
    else
        warn "$SSO_CONTAINER 容器未运行, users.yml 已更新但未同步到容器"
        warn "启动容器后自动读取最新文件: docker compose --profile sso up -d"
    fi
}

# =========================================================================
# 主入口
# =========================================================================
case "${1:-help}" in
    add)            shift; cmd_add "$@" ;;
    remove|delete)  shift; cmd_remove "$@" ;;
    list|ls)        cmd_list ;;
    reset-password) shift; cmd_reset_password "$@" ;;
    disable)        shift; cmd_disable "$@" ;;
    enable)         shift; cmd_enable "$@" ;;
    sync)           cmd_sync ;;
    *)
        echo "SSO 用户管理工具"
        echo ""
        echo "用法: $0 <command> [args...]"
        echo ""
        echo "命令:"
        echo "  add <user> <name> [email] [groups]  创建用户"
        echo "  remove <user>                       删除用户"
        echo "  list                                列出所有用户"
        echo "  reset-password <user>               重置密码"
        echo "  disable <user>                      禁用用户"
        echo "  enable <user>                       启用用户"
        echo "  sync                                同步 DB → users.yml"
        echo ""
        echo "示例:"
        echo "  $0 add alice 'Alice' alice@example.com admins,wms-users"
        echo "  $0 list"
        echo "  $0 reset-password alice"
        echo "  $0 sync"
        ;;
esac
