#!/usr/bin/env bats
# =============================================================================
# 09_enable_ssl.sh infrastructure test
# =============================================================================
# Strategy: Mock openssl/chown + temp PGDATA directory
# =============================================================================

load 'setup_suite'

setup() {
    load_bats_libs

    export ORIG_PATH="$PATH"
    export TEST_DIR="$(mktemp -d)"
    export PGDATA="$TEST_DIR/pgdata"
    mkdir -p "$PGDATA"

    # Create mock postgresql.conf
    echo '#ssl = off' > "$PGDATA/postgresql.conf"

    # Mock openssl
    export MOCK_BIN="$(mktemp -d)"
    cat > "$MOCK_BIN/openssl" << 'MOCKEOF'
#!/bin/bash
# Mock openssl to create cert files
while [[ $# -gt 0 ]]; do
    case "$1" in
        -keyout) touch "$2"; shift 2 ;;
        -out)    touch "$2"; shift 2 ;;
        *)       shift ;;
    esac
done
MOCKEOF
    chmod +x "$MOCK_BIN/openssl"

    # Mock chown (no postgres user outside container)
    cat > "$MOCK_BIN/chown" << 'MOCKEOF'
#!/bin/bash
exit 0
MOCKEOF
    chmod +x "$MOCK_BIN/chown"

    # Wrap sed for macOS/GNU compatibility
    # The source script uses `sed -i 's/.../' file` (GNU style).
    # macOS BSD sed requires `sed -i '' 's/.../' file`.
    # This wrapper detects the environment and calls the real sed correctly.
    export REAL_SED="$(command -v sed)"
    cat > "$MOCK_BIN/sed" << 'MOCKEOF'
#!/bin/bash
# Cross-platform sed -i wrapper
args=("$@")
if [[ "${args[0]}" == "-i" && "${args[1]}" == s* ]]; then
    # GNU-style `sed -i 's/.../...' file` on macOS needs `sed -i '' ...`
    if [[ "$(uname)" == "Darwin" ]]; then
        "$REAL_SED" -i '' "${args[@]:1}"
    else
        "$REAL_SED" "${args[@]}"
    fi
else
    "$REAL_SED" "${args[@]}"
fi
MOCKEOF
    chmod +x "$MOCK_BIN/sed"

    export PATH="$MOCK_BIN:$PATH"

    # Copy script under test
    cp "$BATS_TEST_DIRNAME/../../infrastructure/postgres/init/09_enable_ssl.sh" "$TEST_DIR/"
}

teardown() {
    export PATH="$ORIG_PATH"
    rm -rf "$TEST_DIR" "$MOCK_BIN"
}

# -----------------------------------------------------------------------------
# First run: certs do not exist -> generate + enable SSL
# -----------------------------------------------------------------------------

@test "first run generates server.key and server.crt" {
    run bash "$TEST_DIR/09_enable_ssl.sh"
    assert_success
    assert [ -f "$PGDATA/server.key" ]
    assert [ -f "$PGDATA/server.crt" ]
}

@test "first run output contains cert generation message" {
    run bash "$TEST_DIR/09_enable_ssl.sh"
    assert_success
    assert_output --partial "SSL 自签名证书已生成"
}

@test "first run modifies postgresql.conf to enable SSL" {
    run bash "$TEST_DIR/09_enable_ssl.sh"
    assert_success
    run grep "^ssl = on" "$PGDATA/postgresql.conf"
    assert_success
}

@test "first run output contains SSL enabled message" {
    run bash "$TEST_DIR/09_enable_ssl.sh"
    assert_success
    assert_output --partial "SSL 已启用"
}

# -----------------------------------------------------------------------------
# Repeat run: certs already exist -> skip generation
# -----------------------------------------------------------------------------

@test "repeat run skips generation when certs exist" {
    touch "$PGDATA/server.key"
    touch "$PGDATA/server.crt"
    run bash "$TEST_DIR/09_enable_ssl.sh"
    assert_success
    assert_output --partial "SSL 证书已存在, 跳过生成"
}

# -----------------------------------------------------------------------------
# SSL already enabled: postgresql.conf already has ssl = on
# -----------------------------------------------------------------------------

@test "does not modify if SSL already enabled" {
    echo "ssl = on" > "$PGDATA/postgresql.conf"
    touch "$PGDATA/server.key"
    run bash "$TEST_DIR/09_enable_ssl.sh"
    assert_success
    assert_output --partial "SSL 已处于启用状态"
}

# -----------------------------------------------------------------------------
# Custom PGDATA path
# -----------------------------------------------------------------------------

@test "uses custom PGDATA path" {
    export PGDATA="$TEST_DIR/custom-pg"
    mkdir -p "$PGDATA"
    echo '#ssl = off' > "$PGDATA/postgresql.conf"
    run bash "$TEST_DIR/09_enable_ssl.sh"
    assert_success
    assert [ -f "$PGDATA/server.key" ]
}

@test "output contains config complete message" {
    run bash "$TEST_DIR/09_enable_ssl.sh"
    assert_success
    assert_output --partial "PostgreSQL SSL 配置完成"
}

# -----------------------------------------------------------------------------
# postgresql.conf without ssl line
# -----------------------------------------------------------------------------

@test "no error when postgresql.conf has no ssl line" {
    echo "# no ssl config" > "$PGDATA/postgresql.conf"
    touch "$PGDATA/server.key"
    run bash "$TEST_DIR/09_enable_ssl.sh"
    assert_success
    assert_output --partial "PostgreSQL SSL 配置完成"
}
