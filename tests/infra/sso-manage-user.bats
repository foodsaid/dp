#!/usr/bin/env bats
# =============================================================================
# sso-manage-user.sh 基础设施功能测试
# =============================================================================
# 策略: Mock docker 命令 (psql + authelia), 验证输入校验/命令路由/YAML 生成
# =============================================================================

load 'setup_suite'

setup() {
    load_bats_libs

    export ORIG_PATH="$PATH"
    export TEST_PROJECT_DIR="$(mktemp -d)"

    mkdir -p "$TEST_PROJECT_DIR/scripts"
    mkdir -p "$TEST_PROJECT_DIR/infrastructure/sso"

    cp "$BATS_TEST_DIRNAME/../../scripts/sso-manage-user.sh" "$TEST_PROJECT_DIR/scripts/"

    export MOCK_BIN="$(mktemp -d)"
    export PATH="$MOCK_BIN:$PATH"

    # 默认不加载 .env
    unset DP_DB_NAME DP_DB_USER DB_CONTAINER SSO_CONTAINER
    export DB_CONTAINER="dp-db"
    export SSO_CONTAINER="dp-sso"
}

teardown() {
    export PATH="$ORIG_PATH"
    rm -rf "$TEST_PROJECT_DIR" "$MOCK_BIN"
}

# ---------------------------------------------------------------------------
# 辅助: docker mock — 容器运行 + psql 返回指定值
# ---------------------------------------------------------------------------
create_docker_mock() {
    local psql_output="${1:-0}"
    cat > "$MOCK_BIN/docker" <<MOCK
#!/usr/bin/env bash
if [[ "\$1" == "inspect" ]]; then
    echo "true"
    exit 0
fi
if [[ "\$1" == "exec" ]]; then
    # docker exec -i dp-db psql ...
    if [[ "\$*" == *"psql"* ]]; then
        # 提取 SQL 命令 (-c 后面的参数)
        sql=""
        for arg in "\$@"; do
            if [[ "\$prev" == "-c" ]]; then
                sql="\$arg"
                break
            fi
            prev="\$arg"
        done
        # SELECT COUNT(*) 查询
        if [[ "\$sql" == *"SELECT COUNT"* ]]; then
            echo "$psql_output"
            exit 0
        fi
        # DELETE ... RETURNING
        if [[ "\$sql" == *"RETURNING"* ]]; then
            if [[ "$psql_output" == "0" ]]; then
                # 无输出 = 删除失败
                exit 0
            else
                echo "testuser"
                exit 0
            fi
        fi
        # SELECT 列表查询
        if [[ "\$sql" == *"SELECT username"* ]]; then
            echo "$psql_output"
            exit 0
        fi
        # INSERT / UPDATE
        exit 0
    fi
    # docker exec dp-sso authelia crypto hash generate ...
    if [[ "\$*" == *"authelia"* ]]; then
        echo '\$argon2id\$v=19\$m=65536,t=3,p=4\$mockhashmockhashmockhash'
        exit 0
    fi
fi
if [[ "\$1" == "cp" ]]; then
    exit 0
fi
echo "mock-docker: \$*"
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"
}

# docker mock — 容器未运行
create_docker_not_running() {
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "inspect" ]]; then
    echo "false"
    exit 0
fi
echo "mock-docker: $*"
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"
}

# docker mock — psql 返回用户列表 (sync 用)
create_docker_mock_with_users() {
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "inspect" ]]; then
    echo "true"
    exit 0
fi
if [[ "$1" == "exec" ]]; then
    if [[ "$*" == *"psql"* ]]; then
        sql=""
        for arg in "$@"; do
            if [[ "$prev" == "-c" ]]; then
                sql="$arg"
                break
            fi
            prev="$arg"
        done
        if [[ "$sql" == *"SELECT username"* ]]; then
            echo "admin|Admin User|\$argon2id\$v=19\$m=65536|admin@example.com|admins,wms-users|f"
            echo "alice|Alice Wang|\$argon2id\$v=19\$m=65536|alice@example.com|wms-users|f"
            exit 0
        fi
        exit 0
    fi
fi
if [[ "$1" == "cp" ]]; then
    exit 0
fi
echo "mock-docker: $*"
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"
}

# docker mock — 同步空用户列表
create_docker_mock_empty_users() {
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "inspect" ]]; then
    echo "true"
    exit 0
fi
if [[ "$1" == "exec" ]]; then
    if [[ "$*" == *"psql"* ]]; then
        echo ""
        exit 0
    fi
fi
if [[ "$1" == "cp" ]]; then
    exit 0
fi
echo "mock-docker: $*"
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"
}

# docker mock — 用户存在返回 1, disabled 列表含 t
create_docker_mock_user_exists() {
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "inspect" ]]; then
    echo "true"
    exit 0
fi
if [[ "$1" == "exec" ]]; then
    if [[ "$*" == *"psql"* ]]; then
        sql=""
        for arg in "$@"; do
            if [[ "$prev" == "-c" ]]; then
                sql="$arg"
                break
            fi
            prev="$arg"
        done
        if [[ "$sql" == *"SELECT COUNT"* ]]; then
            echo "1"
            exit 0
        fi
        if [[ "$sql" == *"SELECT username"* ]]; then
            echo "alice|Alice|\$argon2id|alice@example.com|wms-users|f"
            exit 0
        fi
        exit 0
    fi
fi
if [[ "$1" == "cp" ]]; then
    exit 0
fi
echo "mock-docker: $*"
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"
}

# =============================================================================
# 用例 1: 无参数时显示帮助
# =============================================================================
@test "sso-manage-user.sh shows help with no arguments" {
    create_docker_mock
    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh"
    assert_success
    assert_output --partial "SSO 用户管理工具"
    assert_output --partial "add"
    assert_output --partial "remove"
    assert_output --partial "list"
    assert_output --partial "sync"
}

# =============================================================================
# 用例 2: help 命令显示帮助
# =============================================================================
@test "sso-manage-user.sh help shows usage" {
    create_docker_mock
    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh" help
    assert_success
    assert_output --partial "用法"
    assert_output --partial "reset-password"
    assert_output --partial "disable"
    assert_output --partial "enable"
}

# =============================================================================
# 用例 3: add 命令缺少参数时报错
# =============================================================================
@test "sso-manage-user.sh add fails without required args" {
    create_docker_mock
    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh" add
    assert_failure
    assert_output --partial "用法"
}

# =============================================================================
# 用例 4: add 命令仅 username 无 display_name 时报错
# =============================================================================
@test "sso-manage-user.sh add fails with only username" {
    create_docker_mock
    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh" add testuser
    assert_failure
    assert_output --partial "用法"
}

# =============================================================================
# 用例 5: add 命令检测到用户已存在时报错
# =============================================================================
@test "sso-manage-user.sh add rejects duplicate username" {
    create_docker_mock "1"  # COUNT(*) 返回 1
    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh" add testuser "Test User" test@example.com
    assert_failure
    assert_output --partial "已存在"
}

# =============================================================================
# 用例 6: remove 命令缺少参数时报错
# =============================================================================
@test "sso-manage-user.sh remove fails without username" {
    create_docker_mock
    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh" remove
    assert_failure
    assert_output --partial "用法"
}

# =============================================================================
# 用例 7: remove 用户不存在时报错
# =============================================================================
@test "sso-manage-user.sh remove fails for nonexistent user" {
    create_docker_mock "0"
    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh" remove nobody
    assert_failure
    assert_output --partial "不存在"
}

# =============================================================================
# 用例 8: reset-password 缺少参数时报错
# =============================================================================
@test "sso-manage-user.sh reset-password fails without username" {
    create_docker_mock
    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh" reset-password
    assert_failure
    assert_output --partial "用法"
}

# =============================================================================
# 用例 9: reset-password 用户不存在时报错
# =============================================================================
@test "sso-manage-user.sh reset-password fails for nonexistent user" {
    create_docker_mock "0"
    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh" reset-password nobody
    assert_failure
    assert_output --partial "不存在"
}

# =============================================================================
# 用例 10: disable 缺少参数时报错
# =============================================================================
@test "sso-manage-user.sh disable fails without username" {
    create_docker_mock
    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh" disable
    assert_failure
    assert_output --partial "用法"
}

# =============================================================================
# 用例 11: enable 缺少参数时报错
# =============================================================================
@test "sso-manage-user.sh enable fails without username" {
    create_docker_mock
    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh" enable
    assert_failure
    assert_output --partial "用法"
}

# =============================================================================
# 用例 12: delete 别名等同 remove
# =============================================================================
@test "sso-manage-user.sh delete is alias for remove" {
    create_docker_mock
    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh" delete
    assert_failure
    assert_output --partial "用法"
}

# =============================================================================
# 用例 13: ls 别名等同 list
# =============================================================================
@test "sso-manage-user.sh ls is alias for list" {
    create_docker_mock_with_users
    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh" ls
    assert_success
    assert_output --partial "SSO 用户列表"
    assert_output --partial "USERNAME"
}

# =============================================================================
# 用例 14: list 显示表头和用户数据
# =============================================================================
@test "sso-manage-user.sh list displays users table" {
    create_docker_mock_with_users
    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh" list
    assert_success
    assert_output --partial "SSO 用户列表"
    assert_output --partial "USERNAME"
    assert_output --partial "DISPLAY_NAME"
    assert_output --partial "EMAIL"
    assert_output --partial "GROUPS"
    assert_output --partial "STATUS"
}

# =============================================================================
# 用例 15: sync 生成正确的 YAML 结构
# =============================================================================
@test "sso-manage-user.sh sync generates valid users.yml" {
    create_docker_mock_with_users
    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh" sync
    assert_success
    assert_output --partial "从数据库同步用户到 users.yml"
    assert_output --partial "已写入 2 个用户"

    # 验证 YAML 文件结构
    local yml="$TEST_PROJECT_DIR/infrastructure/sso/users.yml"
    assert [ -f "$yml" ]

    # 验证 YAML 头部注释
    run grep "请勿手动编辑" "$yml"
    assert_success

    # 验证用户块
    run grep "users:" "$yml"
    assert_success

    run grep "  admin:" "$yml"
    assert_success

    run grep "  alice:" "$yml"
    assert_success

    run grep "displayname:" "$yml"
    assert_success

    run grep "password:" "$yml"
    assert_success

    run grep "email:" "$yml"
    assert_success

    run grep "groups:" "$yml"
    assert_success
}

# =============================================================================
# 用例 16: sync 空用户生成最小 YAML
# =============================================================================
@test "sso-manage-user.sh sync with no users generates minimal yml" {
    create_docker_mock_empty_users
    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh" sync
    assert_success
    assert_output --partial "无 SSO 用户"

    local yml="$TEST_PROJECT_DIR/infrastructure/sso/users.yml"
    assert [ -f "$yml" ]

    run grep "users:" "$yml"
    assert_success
}

# =============================================================================
# 用例 17: 容器未运行时报错
# =============================================================================
@test "sso-manage-user.sh list fails when db container not running" {
    create_docker_not_running
    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh" list
    assert_failure
    assert_output --partial "容器未运行"
}

# =============================================================================
# 用例 18: sync 生成 YAML 中 disabled 用户标记
# =============================================================================
@test "sso-manage-user.sh sync marks disabled users in YAML" {
    # mock: 一个禁用用户
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "inspect" ]]; then
    echo "true"
    exit 0
fi
if [[ "$1" == "exec" ]]; then
    if [[ "$*" == *"psql"* ]]; then
        sql=""
        for arg in "$@"; do
            if [[ "$prev" == "-c" ]]; then
                sql="$arg"
                break
            fi
            prev="$arg"
        done
        if [[ "$sql" == *"SELECT username"* ]]; then
            echo "disabled_user|Disabled User|\$argon2id\$v=19|disabled@example.com|wms-users|t"
            exit 0
        fi
        exit 0
    fi
fi
if [[ "$1" == "cp" ]]; then
    exit 0
fi
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"

    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh" sync
    assert_success

    local yml="$TEST_PROJECT_DIR/infrastructure/sso/users.yml"
    run grep "disabled: true" "$yml"
    assert_success
}

# =============================================================================
# 用例 19: sync 处理无邮箱用户
# =============================================================================
@test "sso-manage-user.sh sync handles user without email" {
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "inspect" ]]; then
    echo "true"
    exit 0
fi
if [[ "$1" == "exec" ]]; then
    if [[ "$*" == *"psql"* ]]; then
        sql=""
        for arg in "$@"; do
            if [[ "$prev" == "-c" ]]; then
                sql="$arg"
                break
            fi
            prev="$arg"
        done
        if [[ "$sql" == *"SELECT username"* ]]; then
            echo "noemail|No Email|\$argon2id\$v=19||wms-users|f"
            exit 0
        fi
        exit 0
    fi
fi
if [[ "$1" == "cp" ]]; then
    exit 0
fi
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"

    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh" sync
    assert_success

    local yml="$TEST_PROJECT_DIR/infrastructure/sso/users.yml"
    # 应有 email: "" (空值)
    run grep 'email: ""' "$yml"
    assert_success
}

# =============================================================================
# 用例 20: sync SSO 容器未运行时仍更新文件并给出警告
# =============================================================================
@test "sso-manage-user.sh sync warns when sso container not running" {
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "inspect" ]]; then
    container="${!#}"
    case "$container" in
        dp-db)  echo "true"; exit 0 ;;
        dp-sso) echo "false"; exit 0 ;;
        *)      echo "true"; exit 0 ;;
    esac
fi
if [[ "$1" == "exec" ]]; then
    if [[ "$*" == *"psql"* ]]; then
        sql=""
        for arg in "$@"; do
            if [[ "$prev" == "-c" ]]; then
                sql="$arg"
                break
            fi
            prev="$arg"
        done
        if [[ "$sql" == *"SELECT username"* ]]; then
            echo "user1|User One|\$argon2id|user@example.com|wms-users|f"
            exit 0
        fi
        exit 0
    fi
fi
if [[ "$1" == "cp" ]]; then
    exit 0
fi
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"

    run bash "$TEST_PROJECT_DIR/scripts/sso-manage-user.sh" sync
    assert_success
    assert_output --partial "已写入 1 个用户"
    assert_output --partial "容器未运行"
}
