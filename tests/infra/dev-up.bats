#!/usr/bin/env bats
# =============================================================================
# dev-up.sh 基础设施功能测试
# =============================================================================
# 策略: Mock docker/docker-compose 命令 + 临时项目目录隔离
# 运行: npm run test:infra
# =============================================================================

load 'setup_suite'

# ---------------------------------------------------------------------------
# 每个用例前: 构造隔离的临时项目结构 + Mock 命令目录
# ---------------------------------------------------------------------------
setup() {
    load_bats_libs

    # 保存原始 PATH，teardown 时恢复
    export ORIG_PATH="$PATH"

    # 临时项目目录 (模拟 Digital-Platform/ 根目录)
    export TEST_PROJECT_DIR="$(mktemp -d)"
    export TEST_SCRIPTS_DIR="$TEST_PROJECT_DIR/scripts"
    mkdir -p "$TEST_SCRIPTS_DIR"
    mkdir -p "$TEST_PROJECT_DIR/apps/wms"
    touch "$TEST_PROJECT_DIR/apps/wms/shared.js"

    # 复制被测脚本到临时项目
    cp "$BATS_TEST_DIRNAME/../../scripts/dev-up.sh" "$TEST_SCRIPTS_DIR/"

    # Mock 命令目录 (优先级高于系统命令)
    export MOCK_BIN="$(mktemp -d)"
    export PATH="$MOCK_BIN:$PATH"
}

# ---------------------------------------------------------------------------
# 每个用例后: 清理临时文件，恢复 PATH
# ---------------------------------------------------------------------------
teardown() {
    export PATH="$ORIG_PATH"
    rm -rf "$TEST_PROJECT_DIR" "$MOCK_BIN"
}

# ---------------------------------------------------------------------------
# 辅助函数: 创建 Mock docker 可执行文件
# 参数: $1 = 脚本内容 (默认: 成功返回)
# ---------------------------------------------------------------------------
create_docker_mock() {
    cat > "$MOCK_BIN/docker" <<MOCK
#!/usr/bin/env bash
${1:-echo "mock-docker: \$*"; exit 0}
MOCK
    chmod +x "$MOCK_BIN/docker"
}

# ---------------------------------------------------------------------------
# 辅助函数: 创建最小化的 .env 文件
# ---------------------------------------------------------------------------
create_env_file() {
    local mode="${1:-uat}"
    cat > "$TEST_PROJECT_DIR/.env.$mode" <<'ENV'
DP_DOCKER_NETWORK=test-network
DP_DATA_DIR=./data
DP_GATEWAY_PORT=8080
DP_WF_PORT=5678
DP_DB_PORT=5432
DP_BI_PORT=8088
WEBHOOK_URL=http://localhost:5678
ENV
}

# =============================================================================
# 用例 1: 依赖缺失拦截 — Docker 守护进程未运行
# =============================================================================
@test "dev-up.sh fails if Docker is not running" {
    # 准备: 创建 env 文件 (确保通过 env 检查)
    create_env_file "uat"

    # Mock: docker 命令始终返回失败 (模拟 Docker 守护进程未启动)
    create_docker_mock 'echo "Cannot connect to the Docker daemon" >&2; exit 1'

    # 执行
    run bash "$TEST_SCRIPTS_DIR/dev-up.sh"

    # 断言: 脚本失败退出 + 输出包含错误信息
    assert_failure
    assert_output --partial "Docker is not running"
}

# =============================================================================
# 用例 2: 环境变量缺失警告 — .env 文件不存在
# =============================================================================
@test "dev-up.sh handles missing .env file gracefully" {
    # 准备: 不创建 .env.uat (默认模式为 uat)
    # Mock: docker 正常 (确保不是因为 docker 导致失败)
    create_docker_mock

    # 执行
    run bash "$TEST_SCRIPTS_DIR/dev-up.sh"

    # 断言: 脚本失败退出 + 输出包含环境文件缺失提示
    assert_failure
    assert_output --partial "环境文件不存在"
}

# =============================================================================
# 用例 3: 正常启动流程 — 所有预检通过，docker compose 成功
# =============================================================================
@test "dev-up.sh executes docker-compose successfully when env is ready" {
    # 准备: 创建 env 文件
    create_env_file "uat"

    # Mock: docker 命令始终成功 (包括 info/network/compose)
    create_docker_mock 'echo "mock-docker: $*"; exit 0'

    # 执行
    run bash "$TEST_SCRIPTS_DIR/dev-up.sh"

    # 断言: 脚本成功退出 + 输出包含启动成功标识
    assert_success
    assert_output --partial "DP 开发环境已启动"
    # 验证 docker compose 被正确调用
    assert_output --partial "mock-docker: compose"
}
