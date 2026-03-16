#!/usr/bin/env bats
# =============================================================================
# import-workflows.sh 基础设施功能测试
# =============================================================================
# 策略: Mock curl + 临时工作流 JSON 文件
# =============================================================================

load 'setup_suite'

setup() {
    load_bats_libs

    export ORIG_PATH="$PATH"
    export TEST_PROJECT_DIR="$(mktemp -d)"
    mkdir -p "$TEST_PROJECT_DIR/scripts"

    cp "$BATS_TEST_DIRNAME/../../scripts/import-workflows.sh" "$TEST_PROJECT_DIR/scripts/"

    export MOCK_BIN="$(mktemp -d)"
    export PATH="$MOCK_BIN:$PATH"

    # 创建模拟工作流目录和文件
    export WF_DIR="$TEST_PROJECT_DIR/wf"
    mkdir -p "$WF_DIR"
    echo '{"name":"wf01-test"}' > "$WF_DIR/wf01-test.json"
    echo '{"name":"wf02-test"}' > "$WF_DIR/wf02-test.json"

    # 默认 n8n 凭据
    export N8N_URL="http://localhost:5678"
    export N8N_BASIC_AUTH_USER="admin"
    export N8N_BASIC_AUTH_PASSWORD="test-pass"
}

teardown() {
    export PATH="$ORIG_PATH"
    rm -rf "$TEST_PROJECT_DIR" "$MOCK_BIN"
}

# ---------------------------------------------------------------------------
# 辅助: 创建 curl mock (成功 201)
# ---------------------------------------------------------------------------
create_curl_mock_success() {
    cat > "$MOCK_BIN/curl" <<'MOCK'
#!/usr/bin/env bash
# 返回 JSON body + HTTP 201 状态码
echo '{"id":"123"}201'
MOCK
    chmod +x "$MOCK_BIN/curl"
}

# ---------------------------------------------------------------------------
# 辅助: 创建 curl mock (失败 500)
# ---------------------------------------------------------------------------
create_curl_mock_failure() {
    cat > "$MOCK_BIN/curl" <<'MOCK'
#!/usr/bin/env bash
echo '{"error":"internal"}500'
MOCK
    chmod +x "$MOCK_BIN/curl"
}

# =============================================================================
# 用例 1: 工作流目录不存在时报错
# =============================================================================
@test "import-workflows.sh fails when workflow directory does not exist" {
    run bash "$TEST_PROJECT_DIR/scripts/import-workflows.sh" "/nonexistent/dir"
    assert_failure
    assert_output --partial "目录不存在"
}

# =============================================================================
# 用例 2: 成功导入工作流
# =============================================================================
@test "import-workflows.sh imports workflows successfully" {
    create_curl_mock_success

    run bash "$TEST_PROJECT_DIR/scripts/import-workflows.sh" "$WF_DIR"
    assert_success
    assert_output --partial "2 成功"
    assert_output --partial "0 失败"
}

# =============================================================================
# 用例 3: curl 失败时报告错误计数
# =============================================================================
@test "import-workflows.sh reports failures when curl returns error" {
    create_curl_mock_failure

    run bash "$TEST_PROJECT_DIR/scripts/import-workflows.sh" "$WF_DIR"
    assert_success  # 脚本本身不退出，只报告
    assert_output --partial "失败"
}

# =============================================================================
# 用例 4: 空目录 — 无文件可导入
# =============================================================================
@test "import-workflows.sh handles empty directory" {
    local empty_dir="$TEST_PROJECT_DIR/empty-wf"
    mkdir -p "$empty_dir"
    create_curl_mock_success

    run bash "$TEST_PROJECT_DIR/scripts/import-workflows.sh" "$empty_dir"
    assert_success
    assert_output --partial "0 成功, 0 失败"
}
