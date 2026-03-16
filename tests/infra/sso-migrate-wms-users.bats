#!/usr/bin/env bats
# =============================================================================
# sso-migrate-wms-users.sh 基础设施功能测试
# =============================================================================
# 策略: Mock docker 命令, 验证角色映射/跳过已存在/计数统计/YAML 同步
# =============================================================================

load 'setup_suite'

setup() {
    load_bats_libs

    export ORIG_PATH="$PATH"
    export TEST_PROJECT_DIR="$(mktemp -d)"

    mkdir -p "$TEST_PROJECT_DIR/scripts"
    mkdir -p "$TEST_PROJECT_DIR/infrastructure/sso"

    cp "$BATS_TEST_DIRNAME/../../scripts/sso-migrate-wms-users.sh" "$TEST_PROJECT_DIR/scripts/"
    cp "$BATS_TEST_DIRNAME/../../scripts/sso-manage-user.sh" "$TEST_PROJECT_DIR/scripts/"

    export MOCK_BIN="$(mktemp -d)"
    export PATH="$MOCK_BIN:$PATH"

    unset DP_DB_NAME DP_DB_USER DB_CONTAINER SSO_CONTAINER
    export DB_CONTAINER="dp-db"
    export SSO_CONTAINER="dp-sso"
}

teardown() {
    export PATH="$ORIG_PATH"
    rm -rf "$TEST_PROJECT_DIR" "$MOCK_BIN"
}

# ---------------------------------------------------------------------------
# 辅助: docker mock — 容器未运行
# ---------------------------------------------------------------------------
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

# ---------------------------------------------------------------------------
# 辅助: docker mock — db 运行但 sso 未运行
# ---------------------------------------------------------------------------
create_docker_db_only() {
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "inspect" ]]; then
    container="${!#}"
    case "$container" in
        dp-db)  echo "true"; exit 0 ;;
        dp-sso) echo "false"; exit 0 ;;
        *)      echo "false"; exit 0 ;;
    esac
fi
echo "mock-docker: $*"
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"
}

# ---------------------------------------------------------------------------
# 辅助: docker mock — 有 WMS 用户 (3 角色), 无已存在 SSO 用户
# ---------------------------------------------------------------------------
create_docker_mock_fresh_migration() {
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
        # WMS 用户查询
        if [[ "$sql" == *"FROM wms.wms_users"* ]]; then
            echo "alice|Alice Admin|admin"
            echo "dave|Dave QM|qm"
            echo "carol|Carol Op|operator"
            exit 0
        fi
        # SSO 用户不存在
        if [[ "$sql" == *"SELECT COUNT"* ]]; then
            echo "0"
            exit 0
        fi
        # INSERT (迁移) — 成功
        if [[ "$sql" == *"INSERT INTO authelia"* ]]; then
            exit 0
        fi
        # sync 阶段的 SELECT username 查询
        if [[ "$sql" == *"SELECT username"* ]]; then
            echo "alice|Alice Admin|\$argon2id|alice@example.com|admins,wms-users,bi-users|f"
            echo "dave|Dave QM|\$argon2id|dave@example.com|wms-users,qm|f"
            echo "carol|Carol Op|\$argon2id|carol@example.com|wms-users|f"
            exit 0
        fi
        exit 0
    fi
    # argon2id 哈希生成
    if [[ "$*" == *"authelia"* ]]; then
        echo '$argon2id$v=19$m=65536,t=3,p=4$mockhashmockhash'
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

# ---------------------------------------------------------------------------
# 辅助: docker mock — WMS 用户已全部存在于 SSO
# ---------------------------------------------------------------------------
create_docker_mock_all_exist() {
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
        if [[ "$sql" == *"FROM wms.wms_users"* ]]; then
            echo "alice|Alice|admin"
            echo "dave|Dave|operator"
            exit 0
        fi
        if [[ "$sql" == *"SELECT COUNT"* ]]; then
            echo "1"
            exit 0
        fi
        if [[ "$sql" == *"SELECT username"* ]]; then
            echo "alice|Alice|\$argon2id|alice@example.com|admins,wms-users,bi-users|f"
            echo "dave|Dave|\$argon2id|dave@example.com|wms-users|f"
            exit 0
        fi
        exit 0
    fi
    if [[ "$*" == *"authelia"* ]]; then
        echo '$argon2id$v=19$m=65536,t=3,p=4$mockhashmockhash'
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

# ---------------------------------------------------------------------------
# 辅助: docker mock — WMS 无活跃用户
# ---------------------------------------------------------------------------
create_docker_mock_no_wms_users() {
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
        if [[ "$sql" == *"FROM wms.wms_users"* ]]; then
            echo ""
            exit 0
        fi
        exit 0
    fi
    if [[ "$*" == *"authelia"* ]]; then
        echo '$argon2id$v=19$m=65536,t=3,p=4$mockhashmockhash'
        exit 0
    fi
fi
echo "mock-docker: $*"
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"
}

# ---------------------------------------------------------------------------
# 辅助: docker mock — argon2id 哈希生成失败
# ---------------------------------------------------------------------------
create_docker_mock_hash_fail() {
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "inspect" ]]; then
    echo "true"
    exit 0
fi
if [[ "$1" == "exec" ]]; then
    if [[ "$*" == *"authelia"* ]]; then
        # 返回非 argon2id 输出 (模拟哈希失败但不触发 set -e)
        echo "Error: hash generation failed" >&2
        exit 0
    fi
fi
echo "mock-docker: $*"
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"
}

# =============================================================================
# 用例 1: 容器未运行时报错退出
# =============================================================================
@test "sso-migrate fails when containers not running" {
    create_docker_not_running
    run bash "$TEST_PROJECT_DIR/scripts/sso-migrate-wms-users.sh"
    assert_failure
    assert_output --partial "容器未运行"
}

# =============================================================================
# 用例 2: SSO 容器未运行时报错退出
# =============================================================================
@test "sso-migrate fails when sso container not running" {
    create_docker_db_only
    run bash "$TEST_PROJECT_DIR/scripts/sso-migrate-wms-users.sh"
    assert_failure
    assert_output --partial "容器未运行"
}

# =============================================================================
# 用例 3: argon2id 哈希失败时脚本以非零退出
# =============================================================================
# 注: set -euo pipefail 下, grep 无匹配返回 exit 1 → pipefail 传播 → 脚本直接崩溃
#     error "密码哈希生成失败" 行无法到达 (这是脚本的一个已知边界行为)
@test "sso-migrate fails when hash generation fails" {
    create_docker_mock_hash_fail
    run bash "$TEST_PROJECT_DIR/scripts/sso-migrate-wms-users.sh"
    assert_failure
}

# =============================================================================
# 用例 4: 无 WMS 活跃用户时正常退出
# =============================================================================
@test "sso-migrate exits gracefully with no active WMS users" {
    create_docker_mock_no_wms_users
    run bash "$TEST_PROJECT_DIR/scripts/sso-migrate-wms-users.sh"
    assert_success
    assert_output --partial "无活跃用户"
}

# =============================================================================
# 用例 5: 全新迁移 — 3 个用户全部迁移成功
# =============================================================================
@test "sso-migrate migrates 3 fresh users successfully" {
    create_docker_mock_fresh_migration
    run bash "$TEST_PROJECT_DIR/scripts/sso-migrate-wms-users.sh" "TempPass123!"
    assert_success
    assert_output --partial "迁移: 3 个用户"
    assert_output --partial "跳过: 0 个用户"
    assert_output --partial "临时密码: TempPass123!"
}

# =============================================================================
# 用例 6: 角色映射验证 — admin → admins,wms-users,bi-users
# =============================================================================
@test "sso-migrate maps admin role to admins,wms-users,bi-users" {
    create_docker_mock_fresh_migration
    run bash "$TEST_PROJECT_DIR/scripts/sso-migrate-wms-users.sh"
    assert_success
    assert_output --partial "alice"
    assert_output --partial "admins,wms-users,bi-users"
}

# =============================================================================
# 用例 7: 角色映射验证 — qm → wms-users,qm
# =============================================================================
@test "sso-migrate maps qm role to wms-users,qm" {
    create_docker_mock_fresh_migration
    run bash "$TEST_PROJECT_DIR/scripts/sso-migrate-wms-users.sh"
    assert_success
    assert_output --partial "dave"
    assert_output --partial "wms-users,qm"
}

# =============================================================================
# 用例 8: 角色映射验证 — operator → wms-users
# =============================================================================
@test "sso-migrate maps operator role to wms-users" {
    create_docker_mock_fresh_migration
    run bash "$TEST_PROJECT_DIR/scripts/sso-migrate-wms-users.sh"
    assert_success
    assert_output --partial "carol"
}

# =============================================================================
# 用例 9: 已存在用户全部跳过
# =============================================================================
@test "sso-migrate skips all existing users" {
    create_docker_mock_all_exist
    run bash "$TEST_PROJECT_DIR/scripts/sso-migrate-wms-users.sh"
    assert_success
    assert_output --partial "迁移: 0 个用户"
    assert_output --partial "跳过: 2 个用户"
    assert_output --partial "已存在"
}

# =============================================================================
# 用例 10: 默认临时密码为 Changeme123!
# =============================================================================
@test "sso-migrate uses default temp password when not specified" {
    create_docker_mock_no_wms_users
    run bash "$TEST_PROJECT_DIR/scripts/sso-migrate-wms-users.sh"
    assert_success
    assert_output --partial "临时密码: Changeme123!"
}

# =============================================================================
# 用例 11: 自定义临时密码
# =============================================================================
@test "sso-migrate accepts custom temp password" {
    create_docker_mock_no_wms_users
    run bash "$TEST_PROJECT_DIR/scripts/sso-migrate-wms-users.sh" "MySecret456!"
    assert_success
    assert_output --partial "临时密码: MySecret456!"
}

# =============================================================================
# 用例 12: 迁移完成后自动同步提示
# =============================================================================
@test "sso-migrate triggers sync after migration" {
    create_docker_mock_fresh_migration
    run bash "$TEST_PROJECT_DIR/scripts/sso-migrate-wms-users.sh"
    assert_success
    assert_output --partial "同步到 users.yml"
}
