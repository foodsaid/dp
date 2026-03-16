#!/usr/bin/env bats
# =============================================================================
# 27-sso-auth-toggle.sh 基础设施功能测试
# =============================================================================
# 策略: 临时目录模拟 /etc/nginx/dynamic, 验证 SSO 开关生成的配置文件
# =============================================================================

load 'setup_suite'

setup() {
    load_bats_libs

    export TEST_SCRIPT="$BATS_TEST_DIRNAME/../../infrastructure/nginx/27-sso-auth-toggle.sh"

    # 使用临时目录模拟 /etc/nginx
    export TEST_ROOT="$(mktemp -d)"
    export TEST_DYNAMIC_DIR="$TEST_ROOT/etc/nginx/dynamic"
}

teardown() {
    rm -rf "$TEST_ROOT"
}

# 辅助: 在 chroot-like 环境中运行脚本 (重写 mkdir/cat 路径)
run_toggle() {
    local sso_enabled="${1:-false}"

    # 将脚本复制到临时目录并修改路径
    local script_copy="$TEST_ROOT/run.sh"
    sed "s|/etc/nginx/dynamic|$TEST_DYNAMIC_DIR|g" "$TEST_SCRIPT" > "$script_copy"
    chmod +x "$script_copy"

    DP_SSO_ENABLED="$sso_enabled" run bash "$script_copy"
}

# =============================================================================
# 用例 1: SSO 启用时生成 auth_request 配置
# =============================================================================
@test "sso-auth-toggle generates auth_request config when SSO enabled" {
    run_toggle "true"
    assert_success
    assert_output --partial "SSO 已启用"

    # 验证文件存在且非空
    assert [ -f "$TEST_DYNAMIC_DIR/sso-auth.inc" ]
    assert [ -s "$TEST_DYNAMIC_DIR/sso-auth.inc" ]
}

# =============================================================================
# 用例 2: SSO 启用时 sso-auth.inc 包含 auth_request 指令
# =============================================================================
@test "sso-auth-toggle auth.inc contains auth_request directive" {
    run_toggle "true"
    assert_success

    run cat "$TEST_DYNAMIC_DIR/sso-auth.inc"
    assert_output --partial "auth_request /internal/authelia/authz"
}

# =============================================================================
# 用例 3: SSO 启用时 sso-auth.inc 包含错误处理
# =============================================================================
@test "sso-auth-toggle auth.inc contains error pages" {
    run_toggle "true"
    assert_success

    run cat "$TEST_DYNAMIC_DIR/sso-auth.inc"
    assert_output --partial "error_page 401"
    assert_output --partial "error_page 403"
    assert_output --partial "error_page 500 502 503"
}

# =============================================================================
# 用例 4: SSO 启用时 sso-auth.inc 包含 authelia 变量设置
# =============================================================================
@test "sso-auth-toggle auth.inc sets authelia variables" {
    run_toggle "true"
    assert_success

    run cat "$TEST_DYNAMIC_DIR/sso-auth.inc"
    assert_output --partial "auth_request_set \$authelia_user"
    assert_output --partial "auth_request_set \$authelia_groups"
    assert_output --partial "auth_request_set \$authelia_email"
    assert_output --partial "auth_request_set \$authelia_redirect"
}

# =============================================================================
# 用例 5: SSO 启用时生成 headers 配置
# =============================================================================
@test "sso-auth-toggle generates headers config when SSO enabled" {
    run_toggle "true"
    assert_success

    assert [ -f "$TEST_DYNAMIC_DIR/sso-headers.inc" ]
    assert [ -s "$TEST_DYNAMIC_DIR/sso-headers.inc" ]
}

# =============================================================================
# 用例 6: SSO 启用时 headers 包含双 header (现代+遗留)
# =============================================================================
@test "sso-auth-toggle headers.inc contains both header styles" {
    run_toggle "true"
    assert_success

    run cat "$TEST_DYNAMIC_DIR/sso-headers.inc"
    # 现代应用 (Grafana)
    assert_output --partial "X-Forwarded-User"
    # 遗留应用 (Superset FAB)
    assert_output --partial "Remote-User"
    # 组信息
    assert_output --partial "X-Forwarded-Groups"
    # 邮箱
    assert_output --partial "X-Forwarded-Email"
}

# =============================================================================
# 用例 7: SSO 未启用时生成空配置文件
# =============================================================================
@test "sso-auth-toggle generates empty configs when SSO disabled" {
    run_toggle "false"
    assert_success
    assert_output --partial "SSO 未启用"

    # 文件存在但为空
    assert [ -f "$TEST_DYNAMIC_DIR/sso-auth.inc" ]
    assert [ -f "$TEST_DYNAMIC_DIR/sso-headers.inc" ]
    assert [ ! -s "$TEST_DYNAMIC_DIR/sso-auth.inc" ]
    assert [ ! -s "$TEST_DYNAMIC_DIR/sso-headers.inc" ]
}

# =============================================================================
# 用例 8: 默认 (未设置环境变量) 时 SSO 关闭
# =============================================================================
@test "sso-auth-toggle defaults to SSO disabled when env not set" {
    # 不传 DP_SSO_ENABLED
    local script_copy="$TEST_ROOT/run.sh"
    sed "s|/etc/nginx/dynamic|$TEST_DYNAMIC_DIR|g" "$TEST_SCRIPT" > "$script_copy"
    chmod +x "$script_copy"

    unset DP_SSO_ENABLED
    run bash "$script_copy"
    assert_success
    assert_output --partial "SSO 未启用"

    assert [ ! -s "$TEST_DYNAMIC_DIR/sso-auth.inc" ]
    assert [ ! -s "$TEST_DYNAMIC_DIR/sso-headers.inc" ]
}

# =============================================================================
# 用例 9: dynamic 目录不存在时自动创建
# =============================================================================
@test "sso-auth-toggle creates dynamic directory if not exists" {
    # 确保 dynamic 目录不存在
    rm -rf "$TEST_DYNAMIC_DIR"
    assert [ ! -d "$TEST_DYNAMIC_DIR" ]

    run_toggle "true"
    assert_success

    # 目录被创建
    assert [ -d "$TEST_DYNAMIC_DIR" ]
    assert [ -f "$TEST_DYNAMIC_DIR/sso-auth.inc" ]
}

# =============================================================================
# 用例 10: SSO 从启用切换到禁用时清空配置
# =============================================================================
@test "sso-auth-toggle clears config when switching from enabled to disabled" {
    # 先启用
    run_toggle "true"
    assert_success
    assert [ -s "$TEST_DYNAMIC_DIR/sso-auth.inc" ]

    # 再禁用 — 应清空
    run_toggle "false"
    assert_success
    assert [ ! -s "$TEST_DYNAMIC_DIR/sso-auth.inc" ]
    assert [ ! -s "$TEST_DYNAMIC_DIR/sso-headers.inc" ]
}

# =============================================================================
# 用例 11: sso-auth.inc 包含 @access_denied named location
# =============================================================================
@test "sso-auth-toggle auth.inc references @access_denied named location" {
    run_toggle "true"
    assert_success

    run cat "$TEST_DYNAMIC_DIR/sso-auth.inc"
    assert_output --partial "@access_denied"
}

# =============================================================================
# 用例 12: sso-auth.inc 包含 @sso_down 降级处理
# =============================================================================
@test "sso-auth-toggle auth.inc references @sso_down fallback" {
    run_toggle "true"
    assert_success

    run cat "$TEST_DYNAMIC_DIR/sso-auth.inc"
    assert_output --partial "@sso_down"
}

# =============================================================================
# 用例 13: SSO 启用时生成 sso-login-redirects.inc (各模块 301 重定向)
# =============================================================================
@test "sso-auth-toggle generates sso-login-redirects.inc when SSO enabled" {
    run_toggle "true"
    assert_success

    assert [ -f "$TEST_DYNAMIC_DIR/sso-login-redirects.inc" ]
    assert [ -s "$TEST_DYNAMIC_DIR/sso-login-redirects.inc" ]

    run cat "$TEST_DYNAMIC_DIR/sso-login-redirects.inc"
    # WMS 登录页重定向
    assert_output --partial "login.html"
    assert_output --partial "return 301"
    # BI (Superset) 登录页重定向
    assert_output --partial "/superset/login/"
    assert_output --partial "/superset/welcome/"
    # Grafana 登录页重定向
    assert_output --partial "/grafana/login"
    assert_output --partial "/grafana/"
}

# =============================================================================
# 用例 14: SSO 未启用时 sso-login-redirects.inc 为空
# =============================================================================
@test "sso-auth-toggle sso-login-redirects.inc is empty when SSO disabled" {
    run_toggle "false"
    assert_success

    assert [ -f "$TEST_DYNAMIC_DIR/sso-login-redirects.inc" ]
    assert [ ! -s "$TEST_DYNAMIC_DIR/sso-login-redirects.inc" ]
}
