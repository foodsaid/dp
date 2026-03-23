#!/usr/bin/env bats
# =============================================================================
# 25-wms-test-envsubst.sh 基础设施功能测试
# =============================================================================
# 策略: 临时目录模拟 /etc/nginx, 验证 WMS 测试网关配置生成的 3 个分支:
#   1. 域名为空或模板缺失 → 清理残留, 跳过
#   2. 域名有值 + 模板存在 + SSL 存在 → HTTPS 模式 (envsubst)
#   3. 域名有值 + 模板存在 + 无 SSL → HTTP 开发模式 (内联配置)
# =============================================================================

load 'setup_suite'

setup() {
    load_bats_libs

    export TEST_SCRIPT="$BATS_TEST_DIRNAME/../../infrastructure/nginx/25-wms-test-envsubst.sh"

    # 使用临时目录模拟 /etc/nginx
    export TEST_ROOT="$(mktemp -d)"
    export TEST_DYNAMIC_DIR="$TEST_ROOT/etc/nginx/dynamic"
    export TEST_TEMPLATE="$TEST_ROOT/etc/nginx/wms-test-gateway.conf.template"
    export TEST_SSL_PARAMS="$TEST_ROOT/etc/nginx/conf.d/ssl-params.conf"
    export TEST_OUTPUT="$TEST_DYNAMIC_DIR/wms-test.conf"
}

teardown() {
    rm -rf "$TEST_ROOT"
}

# 辅助: 复制脚本并重写路径, 然后运行
run_envsubst() {
    local domain="${1:-}"

    # 若系统无 envsubst, 创建 shim (用 sed 模拟变量替换)
    if ! command -v envsubst &>/dev/null; then
        local shim_dir="$TEST_ROOT/bin"
        mkdir -p "$shim_dir"
        cat > "$shim_dir/envsubst" <<'SHIM'
#!/bin/sh
# envsubst shim: 替换 stdin 中的 ${DP_WMS_TEST_DOMAIN}
sed "s|\${DP_WMS_TEST_DOMAIN}|${DP_WMS_TEST_DOMAIN}|g"
SHIM
        chmod +x "$shim_dir/envsubst"
        export PATH="$shim_dir:$PATH"
    fi

    local script_copy="$TEST_ROOT/run.sh"
    sed \
        -e "s|/etc/nginx/dynamic|$TEST_DYNAMIC_DIR|g" \
        -e "s|/etc/nginx/wms-test-gateway.conf.template|$TEST_TEMPLATE|g" \
        -e "s|/etc/nginx/conf.d/ssl-params.conf|$TEST_SSL_PARAMS|g" \
        "$TEST_SCRIPT" > "$script_copy"
    chmod +x "$script_copy"

    DP_WMS_TEST_DOMAIN="$domain" run bash "$script_copy"
}

# 辅助: 创建模板文件 (从实际项目复制)
create_template() {
    mkdir -p "$(dirname "$TEST_TEMPLATE")"
    cp "$BATS_TEST_DIRNAME/../../infrastructure/nginx/wms-test-gateway.conf.template" "$TEST_TEMPLATE"
}

# 辅助: 创建 SSL 参数文件 (模拟生产环境)
create_ssl_params() {
    mkdir -p "$(dirname "$TEST_SSL_PARAMS")"
    echo "# ssl params placeholder" > "$TEST_SSL_PARAMS"
}

# =============================================================================
# 用例 1: 域名为空 → 跳过, 不生成配置
# =============================================================================
@test "wms-test-envsubst skips when domain is empty" {
    create_template

    run_envsubst ""
    assert_success
    assert_output --partial "WMS 测试网关未配置"

    assert [ ! -f "$TEST_OUTPUT" ]
}

# =============================================================================
# 用例 2: 域名为空 → 清理残留旧配置
# =============================================================================
@test "wms-test-envsubst cleans up old config when domain is empty" {
    create_template

    # 预先放一个残留配置文件
    mkdir -p "$TEST_DYNAMIC_DIR"
    echo "old config" > "$TEST_OUTPUT"
    assert [ -f "$TEST_OUTPUT" ]

    run_envsubst ""
    assert_success

    # 残留文件应被删除
    assert [ ! -f "$TEST_OUTPUT" ]
}

# =============================================================================
# 用例 3: 模板文件缺失 → 跳过, 不生成配置
# =============================================================================
@test "wms-test-envsubst skips when template file is missing" {
    # 不调用 create_template — 模板不存在

    run_envsubst "test.example.com"
    assert_success
    assert_output --partial "WMS 测试网关未配置"

    assert [ ! -f "$TEST_OUTPUT" ]
}

# =============================================================================
# 用例 4: 域名有值 + 无 SSL → 生成 HTTP 开发模式配置
# =============================================================================
@test "wms-test-envsubst generates HTTP dev config without SSL" {
    create_template

    run_envsubst "wms-test.dev.local"
    assert_success
    assert_output --partial "WMS 测试网关已配置 (HTTP)"
    assert_output --partial "wms-test.dev.local"

    assert [ -f "$TEST_OUTPUT" ]
    assert [ -s "$TEST_OUTPUT" ]
}

# =============================================================================
# 用例 5: HTTP 开发模式配置包含正确的 server_name
# =============================================================================
@test "wms-test-envsubst dev config contains correct server_name" {
    create_template

    run_envsubst "wms-test.dev.local"
    assert_success

    run cat "$TEST_OUTPUT"
    assert_output --partial "server_name wms-test.dev.local"
}

# =============================================================================
# 用例 6: HTTP 开发模式配置包含 resolver 指令
# =============================================================================
@test "wms-test-envsubst dev config contains resolver directive" {
    create_template

    run_envsubst "wms-test.dev.local"
    assert_success

    run cat "$TEST_OUTPUT"
    assert_output --partial "resolver 127.0.0.11"
    assert_output --partial "resolver_timeout 3s"
}

# =============================================================================
# 用例 7: HTTP 开发模式配置包含 dp-wms-test 代理
# =============================================================================
@test "wms-test-envsubst dev config proxies to dp-wms-test" {
    create_template

    run_envsubst "wms-test.dev.local"
    assert_success

    run cat "$TEST_OUTPUT"
    assert_output --partial "http://dp-wms-test:80"
}

# =============================================================================
# 用例 8: HTTP 开发模式配置包含 /api/wms/ location 块
# =============================================================================
@test "wms-test-envsubst dev config contains /api/wms/ location block" {
    create_template

    run_envsubst "wms-test.dev.local"
    assert_success

    run cat "$TEST_OUTPUT"
    assert_output --partial "location /api/wms/"
    assert_output --partial "proxy_pass \$wf_backend"
}

# =============================================================================
# 用例 9: 域名有值 + SSL 存在 → 生成 HTTPS 生产模式配置
# =============================================================================
@test "wms-test-envsubst generates HTTPS config with SSL" {
    create_template
    create_ssl_params

    run_envsubst "wms-test.prod.example.com"
    assert_success
    assert_output --partial "WMS 测试网关已配置 (HTTPS)"
    assert_output --partial "wms-test.prod.example.com"

    assert [ -f "$TEST_OUTPUT" ]
    assert [ -s "$TEST_OUTPUT" ]
}

# =============================================================================
# 用例 10: HTTPS 模式配置通过 envsubst 替换域名
# =============================================================================
@test "wms-test-envsubst HTTPS config contains substituted domain" {
    create_template
    create_ssl_params

    run_envsubst "wms-test.prod.example.com"
    assert_success

    run cat "$TEST_OUTPUT"
    assert_output --partial "server_name wms-test.prod.example.com"
    assert_output --partial "listen 443 ssl"
}
