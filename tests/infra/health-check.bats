#!/usr/bin/env bats
# =============================================================================
# health-check.sh 基础设施功能测试
# =============================================================================
# 策略: Mock docker inspect 返回不同健康状态
# =============================================================================

load 'setup_suite'

setup() {
    load_bats_libs

    export ORIG_PATH="$PATH"
    export TEST_PROJECT_DIR="$(mktemp -d)"
    mkdir -p "$TEST_PROJECT_DIR/scripts"

    cp "$BATS_TEST_DIRNAME/../../scripts/health-check.sh" "$TEST_PROJECT_DIR/scripts/"

    export MOCK_BIN="$(mktemp -d)"
    export PATH="$MOCK_BIN:$PATH"
}

teardown() {
    export PATH="$ORIG_PATH"
    rm -rf "$TEST_PROJECT_DIR" "$MOCK_BIN"
}

# ---------------------------------------------------------------------------
# 辅助: 创建 docker mock (全部 healthy)
# ---------------------------------------------------------------------------
create_docker_all_healthy() {
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "inspect" ]]; then
    echo "healthy"
    exit 0
fi
echo "mock-docker: $*"
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"
}

# ---------------------------------------------------------------------------
# 辅助: 创建 docker mock (部分 unhealthy)
# ---------------------------------------------------------------------------
create_docker_mixed_health() {
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "inspect" ]]; then
    # docker inspect --format='...' <container>
    # 容器名是最后一个参数
    container="${!#}"
    case "$container" in
        dp-wf)     echo "unhealthy"; exit 0 ;;
        dp-tunnel) echo "running"; exit 0 ;;
        *)         echo "healthy"; exit 0 ;;
    esac
fi
echo "mock-docker: $*"
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"
}

# ---------------------------------------------------------------------------
# 辅助: 创建 docker mock (容器未运行)
# ---------------------------------------------------------------------------
create_docker_not_found() {
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "inspect" ]]; then
    echo "Error: No such container" >&2
    exit 1
fi
echo "mock-docker: $*"
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"
}

# =============================================================================
# 用例 1: 全部容器 healthy — 脚本成功
# =============================================================================
@test "health-check.sh succeeds when all containers are healthy" {
    create_docker_all_healthy

    run bash "$TEST_PROJECT_DIR/scripts/health-check.sh"
    assert_success
    assert_output --partial "所有服务正常"
}

# =============================================================================
# 用例 2: 有容器 unhealthy — 脚本失败
# =============================================================================
@test "health-check.sh fails when some containers are unhealthy" {
    create_docker_mixed_health

    run bash "$TEST_PROJECT_DIR/scripts/health-check.sh"
    assert_failure
    assert_output --partial "服务异常"
}

# =============================================================================
# 用例 3: 容器未运行 — 报告未运行
# =============================================================================
@test "health-check.sh reports containers not found" {
    create_docker_not_found

    run bash "$TEST_PROJECT_DIR/scripts/health-check.sh"
    assert_failure
    assert_output --partial "未运行"
}

# =============================================================================
# 用例 4: dp-tunnel 未启动时显示开发环境正常提示
# =============================================================================
@test "health-check.sh shows dev info when dp-tunnel not running" {
    create_docker_all_healthy

    run bash "$TEST_PROJECT_DIR/scripts/health-check.sh"
    assert_success
    assert_output --partial "dp-tunnel"
}

# =============================================================================
# 用例 5: 可选容器 (dp-wms-test/dp-certbot/dp-dns) 未启动不影响结果
# =============================================================================
@test "health-check.sh shows info for all optional containers" {
    create_docker_all_healthy

    run bash "$TEST_PROJECT_DIR/scripts/health-check.sh"
    assert_success
    assert_output --partial "dp-wms-test"
    assert_output --partial "dp-certbot"
    assert_output --partial "dp-dns"
    assert_output --partial "可选容器"
}

# =============================================================================
# 用例 6: 可选容器运行时显示 running 状态
# =============================================================================
@test "health-check.sh shows running status for active optional containers" {
    create_docker_mixed_health

    run bash "$TEST_PROJECT_DIR/scripts/health-check.sh"
    # dp-tunnel 在 mixed mock 中返回 running
    assert_output --partial "dp-tunnel: running"
}
