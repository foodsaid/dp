#!/usr/bin/env bats
# =============================================================================
# WMS docker-entrypoint.sh 功能测试
# =============================================================================
# 策略: 隔离临时目录 + 替换输出路径，验证 env.js 生成逻辑
# =============================================================================

load 'setup_suite'

setup() {
    load_bats_libs

    export ORIG_PATH="$PATH"
    export TEST_DIR="$(mktemp -d)"

    # 复制被测脚本
    cp "$BATS_TEST_DIRNAME/../../apps/wms/docker/docker-entrypoint.sh" "$TEST_DIR/entrypoint.sh"

    # 替换 ENV_JS_DIR 为临时目录 (避免写入 /var/run/)
    sed -i.bak "s|/var/run/wms-env|$TEST_DIR/wms-env|g" "$TEST_DIR/entrypoint.sh" && rm -f "$TEST_DIR/entrypoint.sh.bak"

    # 替换 chown nginx:nginx (CI 无 nginx 用户)
    sed -i.bak 's/chown -R nginx:nginx/chown -R nobody:nogroup/g' "$TEST_DIR/entrypoint.sh" && rm -f "$TEST_DIR/entrypoint.sh.bak"

    # 清除环境变量
    unset ENV_NAME API_BASE_URL QR_SERVICE_URL APP_BASE_URL
    unset SYSTEM_TIMEZONE SOUND_ENABLED DEBUG AUTO_FOCUS_DELAY WMS_CONFIG
}

teardown() {
    export PATH="$ORIG_PATH"
    rm -rf "$TEST_DIR"
}

# =============================================================================
# Case 1: defaults - generate correct env.js without any env vars
# =============================================================================
@test "wms-entrypoint: default values generate correct env.js" {
    run bash "$TEST_DIR/entrypoint.sh"
    assert_success

    # env.js 文件已创建
    [ -f "$TEST_DIR/wms-env/env.js" ]

    # 验证默认值
    run cat "$TEST_DIR/wms-env/env.js"
    assert_output --partial "ENV_NAME: 'development'"
    assert_output --partial "SYSTEM_TIMEZONE: 'UTC'"
    assert_output --partial "SOUND_ENABLED: true"
    assert_output --partial "DEBUG: true"
    assert_output --partial "AUTO_FOCUS_DELAY: 100"
}

# =============================================================================
# Case 2: custom env vars injected correctly
# =============================================================================
@test "wms-entrypoint: custom env vars injected correctly" {
    export ENV_NAME="production"
    export API_BASE_URL="/api/wms"
    export SYSTEM_TIMEZONE="Asia/Shanghai"
    export SOUND_ENABLED="false"
    export DEBUG="false"
    export AUTO_FOCUS_DELAY="200"

    run bash "$TEST_DIR/entrypoint.sh"
    assert_success

    run cat "$TEST_DIR/wms-env/env.js"
    assert_output --partial "ENV_NAME: 'production'"
    assert_output --partial "API_BASE_URL: '/api/wms'"
    assert_output --partial "SYSTEM_TIMEZONE: 'Asia/Shanghai'"
    assert_output --partial "SOUND_ENABLED: false"
    assert_output --partial "DEBUG: false"
    assert_output --partial "AUTO_FOCUS_DELAY: 200"
}

# =============================================================================
# Case 3: boolean invalid input falls back to default
# =============================================================================
@test "wms-entrypoint: SOUND_ENABLED invalid value falls back to true" {
    export SOUND_ENABLED="yes"

    run bash "$TEST_DIR/entrypoint.sh"
    assert_success

    run cat "$TEST_DIR/wms-env/env.js"
    assert_output --partial "SOUND_ENABLED: true"
}

@test "wms-entrypoint: DEBUG invalid value falls back to true" {
    export DEBUG="1"

    run bash "$TEST_DIR/entrypoint.sh"
    assert_success

    run cat "$TEST_DIR/wms-env/env.js"
    assert_output --partial "DEBUG: true"
}

# =============================================================================
# Case 4: AUTO_FOCUS_DELAY non-numeric falls back to default
# =============================================================================
@test "wms-entrypoint: AUTO_FOCUS_DELAY non-numeric falls back to 100" {
    export AUTO_FOCUS_DELAY="abc"

    run bash "$TEST_DIR/entrypoint.sh"
    assert_success

    run cat "$TEST_DIR/wms-env/env.js"
    assert_output --partial "AUTO_FOCUS_DELAY: 100"
}

@test "wms-entrypoint: AUTO_FOCUS_DELAY negative falls back to 100" {
    export AUTO_FOCUS_DELAY="-50"

    run bash "$TEST_DIR/entrypoint.sh"
    assert_success

    run cat "$TEST_DIR/wms-env/env.js"
    assert_output --partial "AUTO_FOCUS_DELAY: 100"
}

# =============================================================================
# Case 5: single quote escaping (prevent JS injection)
# =============================================================================
@test "wms-entrypoint: single quote env var escaped correctly" {
    export ENV_NAME="test'inject"

    run bash "$TEST_DIR/entrypoint.sh"
    assert_success

    run cat "$TEST_DIR/wms-env/env.js"
    # 单引号应被转义为 \'
    assert_output --partial "ENV_NAME: 'test\\'inject'"
}

# =============================================================================
# Case 6: WMS_CONFIG conditional injection
# =============================================================================
@test "wms-entrypoint: WMS_CONFIG non-empty is injected" {
    export WMS_CONFIG='{"maxItems":100}'

    run bash "$TEST_DIR/entrypoint.sh"
    assert_success

    run cat "$TEST_DIR/wms-env/env.js"
    assert_output --partial "WMS_CONFIG:"
    assert_output --partial '"maxItems":100'
}

@test "wms-entrypoint: WMS_CONFIG empty is not injected" {
    run bash "$TEST_DIR/entrypoint.sh"
    assert_success

    run cat "$TEST_DIR/wms-env/env.js"
    refute_output --partial "WMS_CONFIG:"
}

# =============================================================================
# Case 7: env.js is valid JS syntax (closes window.__ENV object)
# =============================================================================
@test "wms-entrypoint: env.js closes with };" {
    run bash "$TEST_DIR/entrypoint.sh"
    assert_success

    # 最后一行应是 };
    local last_line
    last_line=$(tail -1 "$TEST_DIR/wms-env/env.js")
    [ "$last_line" = "};" ]
}

# =============================================================================
# Case 8: env.js file permissions (644)
# =============================================================================
@test "wms-entrypoint: env.js file permissions are 644" {
    run bash "$TEST_DIR/entrypoint.sh"
    assert_success

    local perms
    perms=$(stat -c '%a' "$TEST_DIR/wms-env/env.js" 2>/dev/null || stat -f '%Lp' "$TEST_DIR/wms-env/env.js" 2>/dev/null)
    [ "$perms" = "644" ]
}

# =============================================================================
# Case 9: timezone defaults to UTC (not Asia/Bangkok)
# =============================================================================
@test "wms-entrypoint: timezone defaults to UTC" {
    run bash "$TEST_DIR/entrypoint.sh"
    assert_success

    run cat "$TEST_DIR/wms-env/env.js"
    assert_output --partial "SYSTEM_TIMEZONE: 'UTC'"
    refute_output --partial "Asia/Bangkok"
}

# =============================================================================
# Case 10: output contains ready message
# =============================================================================
@test "wms-entrypoint: output contains ready message" {
    run bash "$TEST_DIR/entrypoint.sh"
    assert_success
    assert_output --partial "[DP-WMS] env.js"
}
