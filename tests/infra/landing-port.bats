#!/usr/bin/env bats
# =============================================================================
# 26-landing-port.sh 基础设施功能测试
# =============================================================================
# 策略: 临时目录模拟 landing-src 和 landing, 验证端口注入行为
# =============================================================================

load 'setup_suite'

setup() {
    load_bats_libs

    export TEST_SCRIPT="$BATS_TEST_DIRNAME/../../infrastructure/nginx/26-landing-port.sh"

    # 使用临时目录模拟 nginx 路径
    export TEST_ROOT="$(mktemp -d)"
    export TEST_SRC_DIR="$TEST_ROOT/usr/share/nginx/landing-src"
    export TEST_DST_DIR="$TEST_ROOT/usr/share/nginx/landing"

    # 创建模拟 landing-src 目录和 index.html
    mkdir -p "$TEST_SRC_DIR"
    mkdir -p "$TEST_DST_DIR"
    cat > "$TEST_SRC_DIR/index.html" <<'HTML'
<html>
<body>
<script>const wfPort = __WF_PORT__;</script>
<a href="http://localhost:__WF_PORT__">n8n</a>
</body>
</html>
HTML
    # privacy/terms 模拟文件 (联系邮箱占位符)
    echo '<p><a href="mailto:__DP_CONTACT_EMAIL__">__DP_CONTACT_EMAIL__</a></p>' > "$TEST_SRC_DIR/privacy.html"
    echo '<p><a href="mailto:__DP_CONTACT_EMAIL__">__DP_CONTACT_EMAIL__</a></p>' > "$TEST_SRC_DIR/terms.html"
}

teardown() {
    rm -rf "$TEST_ROOT"
}

# 辅助: 重写脚本中的路径并执行
run_landing_port() {
    local script_copy="$TEST_ROOT/run.sh"
    sed \
        -e "s|SRC=\"/usr/share/nginx/landing-src\"|SRC=\"$TEST_SRC_DIR\"|" \
        -e "s|DST=\"/usr/share/nginx/landing\"|DST=\"$TEST_DST_DIR\"|" \
        "$TEST_SCRIPT" > "$script_copy"
    chmod +x "$script_copy"

    run bash "$script_copy"
}

# =============================================================================
# 用例 1: 未设置 DP_WF_PORT 时使用默认端口 5678
# =============================================================================
@test "landing-port uses default port 5678 when DP_WF_PORT not set" {
    unset DP_WF_PORT
    run_landing_port
    assert_success
    assert_output --partial "5678"

    # 验证 index.html 中占位符被替换为 5678
    run cat "$TEST_DST_DIR/index.html"
    assert_output --partial "const wfPort = 5678;"
    refute_output --partial "__WF_PORT__"
}

# =============================================================================
# 用例 2: 自定义有效端口正常注入
# =============================================================================
@test "landing-port injects custom valid port" {
    export DP_WF_PORT="9090"
    run_landing_port
    assert_success
    assert_output --partial "9090"

    run cat "$TEST_DST_DIR/index.html"
    assert_output --partial "const wfPort = 9090;"
    assert_output --partial "http://localhost:9090"
    refute_output --partial "__WF_PORT__"
}

# =============================================================================
# 用例 3: 非数字端口回退到 5678 并输出警告
# =============================================================================
@test "landing-port falls back to 5678 for non-numeric port" {
    export DP_WF_PORT="abc"
    run_landing_port
    assert_success
    assert_output --partial "必须为数字"
    assert_output --partial "5678"

    run cat "$TEST_DST_DIR/index.html"
    assert_output --partial "const wfPort = 5678;"
    refute_output --partial "__WF_PORT__"
}

# =============================================================================
# 用例 4: 含特殊字符的端口回退到 5678
# =============================================================================
@test "landing-port falls back to 5678 for port with special chars" {
    export DP_WF_PORT="80;rm"
    run_landing_port
    assert_success
    assert_output --partial "必须为数字"

    run cat "$TEST_DST_DIR/index.html"
    assert_output --partial "const wfPort = 5678;"
}

# =============================================================================
# 用例 5: __WF_PORT__ 占位符在 index.html 中被全部替换
# =============================================================================
@test "landing-port replaces all __WF_PORT__ occurrences in index.html" {
    export DP_WF_PORT="3000"
    run_landing_port
    assert_success

    # index.html 包含两处 __WF_PORT__，均应被替换
    run cat "$TEST_DST_DIR/index.html"
    refute_output --partial "__WF_PORT__"
    # 验证两处都替换为 3000
    assert_output --partial "const wfPort = 3000;"
    assert_output --partial "http://localhost:3000"
}

# =============================================================================
# 用例 6: 源目录不存在时脚本报错退出
# =============================================================================
@test "landing-port fails when source directory missing" {
    rm -rf "$TEST_SRC_DIR"

    run_landing_port
    assert_failure
}

# =============================================================================
# 用例 7: 源目录无 index.html 时输出跳过消息
# =============================================================================
@test "landing-port skips injection when index.html missing in destination" {
    # 移除 index.html，只保留目录 (cp -r 会复制空目录)
    rm -f "$TEST_SRC_DIR/index.html"
    # 放一个非 index.html 文件确保 cp 成功
    touch "$TEST_SRC_DIR/other.css"

    unset DP_WF_PORT
    run_landing_port
    assert_success
    assert_output --partial "未找到，跳过端口注入"
}

# =============================================================================
# 用例 8: 输出消息包含正确的端口注入提示
# =============================================================================
@test "landing-port outputs correct injection message" {
    export DP_WF_PORT="8080"
    run_landing_port
    assert_success
    assert_output --partial "[DP-Gateway] landing WF 端口注入: 8080"
    assert_output --partial "[DP-Gateway] landing 联系邮箱注入:"
}

# =============================================================================
# 用例 9: 联系邮箱注入到 privacy.html 和 terms.html
# =============================================================================
@test "landing-port injects contact email into privacy and terms" {
    export DP_CONTACT_EMAIL="admin@foodsaid.com"
    run_landing_port
    assert_success

    run cat "$TEST_DST_DIR/privacy.html"
    assert_output --partial "admin@foodsaid.com"
    refute_output --partial "__DP_CONTACT_EMAIL__"

    run cat "$TEST_DST_DIR/terms.html"
    assert_output --partial "admin@foodsaid.com"
    refute_output --partial "__DP_CONTACT_EMAIL__"
}

# =============================================================================
# 用例 10: 未设置 DP_CONTACT_EMAIL 时使用默认值
# =============================================================================
@test "landing-port uses default contact email when not set" {
    unset DP_CONTACT_EMAIL
    run_landing_port
    assert_success

    run cat "$TEST_DST_DIR/privacy.html"
    assert_output --partial "admin@example.com"
    refute_output --partial "__DP_CONTACT_EMAIL__"
}
