#!/usr/bin/env bats
# =============================================================================
# init-platform.sh 基础设施功能测试
# =============================================================================
# 策略: Mock docker + 临时项目目录 + 模拟 health-check.sh
# =============================================================================

load 'setup_suite'

setup() {
    load_bats_libs

    export ORIG_PATH="$PATH"
    export TEST_PROJECT_DIR="$(mktemp -d)"
    mkdir -p "$TEST_PROJECT_DIR/scripts"

    cp "$BATS_TEST_DIRNAME/../../scripts/init-platform.sh" "$TEST_PROJECT_DIR/scripts/"

    # init-platform.sh 调用 health-check.sh，创建一个简化版
    cat > "$TEST_PROJECT_DIR/scripts/health-check.sh" <<'HC'
#!/bin/bash
echo "✅ 所有服务正常"
exit 0
HC
    chmod +x "$TEST_PROJECT_DIR/scripts/health-check.sh"

    export MOCK_BIN="$(mktemp -d)"
    export PATH="$MOCK_BIN:$PATH"

    # Mock sleep 为空操作 (加速测试)
    cat > "$MOCK_BIN/sleep" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
    chmod +x "$MOCK_BIN/sleep"
}

teardown() {
    export PATH="$ORIG_PATH"
    rm -rf "$TEST_PROJECT_DIR" "$MOCK_BIN"
}

# ---------------------------------------------------------------------------
# 辅助: 创建 docker mock
# ---------------------------------------------------------------------------
create_docker_mock() {
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
echo "mock-docker: $*"
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"
}

# =============================================================================
# 用例 1: .env 不存在 + .env.example 存在 → 提示用户配置
# =============================================================================
@test "init-platform.sh creates .env from template and exits" {
    # 创建 .env.example (但不创建 .env)
    cat > "$TEST_PROJECT_DIR/.env.example" <<'ENV'
DP_DB_PASSWORD=
ENV
    create_docker_mock

    run bash "$TEST_PROJECT_DIR/scripts/init-platform.sh"
    assert_failure
    assert_output --partial "请修改 .env"
    # 验证 .env 被从模板创建
    [ -f "$TEST_PROJECT_DIR/.env" ]
}

# =============================================================================
# 用例 2: Docker 未安装时报错
# =============================================================================
@test "init-platform.sh fails when docker is not installed" {
    touch "$TEST_PROJECT_DIR/.env"
    # 用受限 PATH 确保 docker 不在路径中
    # 保留基本命令 (bash/cat/cp 等) 但排除 docker
    local restricted_bin="$(mktemp -d)"
    # 只链接基础命令
    for cmd in bash cat cp dirname cd pwd test [ mkdir touch echo grep sed; do
        local found
        found="$(which "$cmd" 2>/dev/null)" && ln -sf "$found" "$restricted_bin/$cmd"
    done

    run env PATH="$restricted_bin" bash "$TEST_PROJECT_DIR/scripts/init-platform.sh"
    assert_failure
    assert_output --partial "Docker 未安装"

    rm -rf "$restricted_bin"
}

# =============================================================================
# 用例 3: Docker Compose 未安装时报错
# =============================================================================
@test "init-platform.sh fails when docker compose is not available" {
    touch "$TEST_PROJECT_DIR/.env"
    # docker 存在但 docker compose version 失败
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$*" == *"compose version"* ]]; then
    exit 1
fi
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"

    run bash "$TEST_PROJECT_DIR/scripts/init-platform.sh"
    assert_failure
    assert_output --partial "Docker Compose 未安装"
}

# =============================================================================
# 用例 4: 正常初始化流程
# =============================================================================
@test "init-platform.sh completes successfully with all dependencies" {
    touch "$TEST_PROJECT_DIR/.env"
    touch "$TEST_PROJECT_DIR/docker-compose.yml"
    touch "$TEST_PROJECT_DIR/docker-compose.dev.yml"
    create_docker_mock

    run bash "$TEST_PROJECT_DIR/scripts/init-platform.sh"
    assert_success
    assert_output --partial "DP 平台初始化完成"
}
