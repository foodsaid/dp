#!/usr/bin/env bats
# =============================================================================
# cert-renew.sh 基础设施功能测试
# =============================================================================
# 策略: Mock docker 命令 + 临时沙箱 + flag 文件模拟
# =============================================================================

load 'setup_suite'

setup() {
    load_bats_libs

    export ORIG_PATH="$PATH"
    export TEST_PROJECT_DIR="$(mktemp -d)"
    mkdir -p "$TEST_PROJECT_DIR/scripts"
    mkdir -p "$TEST_PROJECT_DIR/data/certbot"

    cp "$BATS_TEST_DIRNAME/../../scripts/cert-renew.sh" "$TEST_PROJECT_DIR/scripts/"

    # cert-renew.sh 使用 cd "$(dirname "$0")/.." 定位项目根
    # 还需要 docker-compose.yml 和 docker-compose.prod.yml 存在 (仅需文件存在)
    touch "$TEST_PROJECT_DIR/docker-compose.yml"
    touch "$TEST_PROJECT_DIR/docker-compose.prod.yml"

    export MOCK_BIN="$(mktemp -d)"
    export PATH="$MOCK_BIN:$PATH"

    export DP_DATA_DIR="$TEST_PROJECT_DIR/data"
}

teardown() {
    export PATH="$ORIG_PATH"
    rm -rf "$TEST_PROJECT_DIR" "$MOCK_BIN"
}

# ---------------------------------------------------------------------------
# 辅助: 创建 docker mock (certbot 成功但未续期)
# ---------------------------------------------------------------------------
create_docker_mock_no_renewal() {
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
echo "mock-docker: $*"
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"
}

# ---------------------------------------------------------------------------
# 辅助: 创建 docker mock (certbot 续期成功 + nginx 验证通过)
# ---------------------------------------------------------------------------
create_docker_mock_with_renewal() {
    local flag_file="$1"
    cat > "$MOCK_BIN/docker" <<MOCK
#!/usr/bin/env bash
# certbot run: 创建 .renewed flag
if [[ "\$*" == *"certbot"* ]] || [[ "\$*" == *"dp-certbot"* ]]; then
    touch "$flag_file"
    exit 0
fi
# nginx -t: 验证成功
if [[ "\$*" == *"nginx -t"* ]]; then
    echo "nginx: configuration file /etc/nginx/nginx.conf test is successful"
    exit 0
fi
# nginx -s reload: 成功
if [[ "\$*" == *"nginx -s reload"* ]]; then
    exit 0
fi
echo "mock-docker: \$*"
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"
}

# =============================================================================
# 用例 1: 证书未到期 — 无需续期
# =============================================================================
@test "cert-renew.sh reports no renewal needed when flag absent" {
    create_docker_mock_no_renewal

    run bash "$TEST_PROJECT_DIR/scripts/cert-renew.sh"
    assert_success
    assert_output --partial "证书未到期"
}

# =============================================================================
# 用例 2: 证书续期后 nginx 热重载
# =============================================================================
@test "cert-renew.sh reloads nginx after certificate renewal" {
    local flag="$TEST_PROJECT_DIR/data/certbot/.renewed"
    create_docker_mock_with_renewal "$flag"

    run bash "$TEST_PROJECT_DIR/scripts/cert-renew.sh"
    assert_success
    assert_output --partial "nginx 重载成功"
}

# =============================================================================
# 用例 3: nginx -t 验证失败时脚本报错
# =============================================================================
@test "cert-renew.sh fails when nginx config test fails" {
    local flag="$TEST_PROJECT_DIR/data/certbot/.renewed"
    cat > "$MOCK_BIN/docker" <<MOCK
#!/usr/bin/env bash
if [[ "\$*" == *"certbot"* ]] || [[ "\$*" == *"dp-certbot"* ]]; then
    touch "$flag"
    exit 0
fi
if [[ "\$*" == *"nginx -t"* ]]; then
    echo "nginx: configuration file test failed" >&2
    exit 1
fi
echo "mock-docker: \$*"
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"

    run bash "$TEST_PROJECT_DIR/scripts/cert-renew.sh"
    assert_failure
    assert_output --partial "nginx -t 验证失败"
}

# =============================================================================
# 用例 4: docker compose 失败时脚本退出
# =============================================================================
@test "cert-renew.sh fails when docker compose certbot fails" {
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$*" == *"compose"* ]]; then
    echo "compose error" >&2
    exit 1
fi
echo "mock-docker: $*"
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"

    run bash "$TEST_PROJECT_DIR/scripts/cert-renew.sh"
    assert_failure
}
