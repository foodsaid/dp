#!/usr/bin/env bats
# =============================================================================
# BI docker-entrypoint.sh 功能测试
# =============================================================================
# 策略: Mock python3/superset/uv/pip/gunicorn 命令，验证依赖自愈逻辑
# =============================================================================

load 'setup_suite'

setup() {
    load_bats_libs

    export ORIG_PATH="$PATH"
    export TEST_DIR="$(mktemp -d)"
    export MOCK_BIN="$(mktemp -d)"
    export PATH="$MOCK_BIN:$PATH"

    # 复制被测脚本
    cp "$BATS_TEST_DIRNAME/../../apps/bi/docker-entrypoint.sh" "$TEST_DIR/entrypoint.sh"

    # 移除 exec gunicorn (会替换进程导致测试失败) — 替换为 echo
    sed -i.bak 's/^exec gunicorn/echo "GUNICORN_STARTED"/g' "$TEST_DIR/entrypoint.sh" && rm -f "$TEST_DIR/entrypoint.sh.bak"
    # 移除 exec 后多行参数的反斜杠续行
    sed -i.bak '/^    --bind/d; /^    --workers/d; /^    --threads/d; /^    --timeout/d; /^    --limit-request-line/d; /^    --limit-request-field_size/d; /^    "superset.app/d' "$TEST_DIR/entrypoint.sh" && rm -f "$TEST_DIR/entrypoint.sh.bak"

    # 记录调用的文件
    export CALL_LOG="$TEST_DIR/.calls"
    touch "$CALL_LOG"

    # 默认环境变量
    export SUPERSET_ADMIN_USERNAME="admin"
    export SUPERSET_ADMIN_EMAIL="admin@test.com"
    export SUPERSET_ADMIN_PASSWORD="testpass123"
}

teardown() {
    export PATH="$ORIG_PATH"
    rm -rf "$TEST_DIR" "$MOCK_BIN"
}

# ---------------------------------------------------------------------------
# Mock 辅助函数
# ---------------------------------------------------------------------------

# 创建全部依赖已安装的 mock 环境
create_all_deps_installed() {
    cat > "$MOCK_BIN/python3" <<'MOCK'
#!/usr/bin/env bash
echo "python3 $*" >> "$CALL_LOG"
exit 0
MOCK
    chmod +x "$MOCK_BIN/python3"

    cat > "$MOCK_BIN/superset" <<'MOCK'
#!/usr/bin/env bash
echo "superset $*" >> "$CALL_LOG"
exit 0
MOCK
    chmod +x "$MOCK_BIN/superset"
}

# 创建部分依赖缺失的 mock 环境
create_missing_deps() {
    local missing_modules="$1"  # 空格分隔的缺失模块名

    cat > "$MOCK_BIN/python3" <<MOCK
#!/usr/bin/env bash
echo "python3 \$*" >> "$CALL_LOG"
# 检查 import 的模块是否在缺失列表中
if [[ "\$1" == "-c" ]]; then
    for m in $missing_modules; do
        if [[ "\$2" == *"\$m"* ]]; then
            exit 1
        fi
    done
fi
exit 0
MOCK
    chmod +x "$MOCK_BIN/python3"

    cat > "$MOCK_BIN/uv" <<'MOCK'
#!/usr/bin/env bash
echo "uv $*" >> "$CALL_LOG"
exit 0
MOCK
    chmod +x "$MOCK_BIN/uv"

    cat > "$MOCK_BIN/pip" <<'MOCK'
#!/usr/bin/env bash
echo "pip $*" >> "$CALL_LOG"
exit 0
MOCK
    chmod +x "$MOCK_BIN/pip"

    cat > "$MOCK_BIN/superset" <<'MOCK'
#!/usr/bin/env bash
echo "superset $*" >> "$CALL_LOG"
exit 0
MOCK
    chmod +x "$MOCK_BIN/superset"
}

# =============================================================================
# Case 1: all deps installed - skip installation
# =============================================================================
@test "bi-entrypoint: skip install when all deps present" {
    create_all_deps_installed

    run bash "$TEST_DIR/entrypoint.sh"
    assert_success
    assert_output --partial "依赖检查通过"

    # 不应调用 uv 或 pip
    run cat "$CALL_LOG"
    refute_output --partial "uv pip install"
    refute_output --partial "pip install"
}

# =============================================================================
# Case 2: pyodbc missing - trigger self-heal
# =============================================================================
@test "bi-entrypoint: self-heal when pyodbc missing" {
    create_missing_deps "pyodbc"

    run bash "$TEST_DIR/entrypoint.sh"
    assert_success
    assert_output --partial "检测到缺失依赖"
    assert_output --partial "自愈完成"

    # 应调用 uv pip install pyodbc
    run cat "$CALL_LOG"
    assert_output --partial "pyodbc"
}

# =============================================================================
# Case 3: multiple deps missing - install all at once
# =============================================================================
@test "bi-entrypoint: install all when multiple deps missing" {
    create_missing_deps "pyodbc pymssql"

    run bash "$TEST_DIR/entrypoint.sh"
    assert_success
    assert_output --partial "检测到缺失依赖"

    run cat "$CALL_LOG"
    assert_output --partial "pyodbc"
    assert_output --partial "pymssql"
}

# =============================================================================
# Case 4: uv unavailable - fallback to pip
# =============================================================================
@test "bi-entrypoint: fallback to pip when uv fails" {
    create_missing_deps "pymssql"

    # 覆盖 uv 为失败
    cat > "$MOCK_BIN/uv" <<'MOCK'
#!/usr/bin/env bash
echo "uv $*" >> "$CALL_LOG"
exit 1
MOCK
    chmod +x "$MOCK_BIN/uv"

    run bash "$TEST_DIR/entrypoint.sh"
    assert_success

    # 应先尝试 uv 再回退到 pip
    run cat "$CALL_LOG"
    assert_output --partial "pip"
}

# =============================================================================
# Case 5: superset db upgrade is called
# =============================================================================
@test "bi-entrypoint: runs superset db upgrade" {
    create_all_deps_installed

    run bash "$TEST_DIR/entrypoint.sh"
    assert_success

    run cat "$CALL_LOG"
    assert_output --partial "superset db upgrade"
}

# =============================================================================
# Case 6: superset init is called
# =============================================================================
@test "bi-entrypoint: runs superset init" {
    create_all_deps_installed

    run bash "$TEST_DIR/entrypoint.sh"
    assert_success

    run cat "$CALL_LOG"
    assert_output --partial "superset init"
}

# =============================================================================
# Case 7: admin creation uses env vars
# =============================================================================
@test "bi-entrypoint: admin creation uses custom credentials" {
    create_all_deps_installed

    export SUPERSET_ADMIN_USERNAME="custom_admin"
    export SUPERSET_ADMIN_EMAIL="custom@dp.io"

    run bash "$TEST_DIR/entrypoint.sh"
    assert_success

    run cat "$CALL_LOG"
    assert_output --partial "superset fab create-admin"
}

# =============================================================================
# Case 8: output contains ready message
# =============================================================================
@test "bi-entrypoint: output contains ready message" {
    create_all_deps_installed

    run bash "$TEST_DIR/entrypoint.sh"
    assert_success
    assert_output --partial "[DP-BI]"
}

# =============================================================================
# Case 9: gunicorn start command present
# =============================================================================
@test "bi-entrypoint: gunicorn start command present" {
    create_all_deps_installed

    run bash "$TEST_DIR/entrypoint.sh"
    assert_success
    assert_output --partial "GUNICORN_STARTED"
}
