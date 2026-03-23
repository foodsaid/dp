#!/usr/bin/env bats
# =============================================================================
# check-container-versions.sh infrastructure tests
# =============================================================================
# Strategy: Mock curl/python3 commands + temp dir sandbox
# Tests pure functions: extract_current_version, assess_risk, risk_color,
#                       get_latest_dockerhub_tag, IMAGE_REGISTRY, main
# =============================================================================

load 'setup_suite'

setup() {
    load_bats_libs

    export ORIG_PATH="$PATH"
    export TEST_PROJECT_DIR="$(mktemp -d)"
    mkdir -p "$TEST_PROJECT_DIR/scripts"

    cp "$BATS_TEST_DIRNAME/../../scripts/check-container-versions.sh" "$TEST_PROJECT_DIR/scripts/"

    export MOCK_BIN="$(mktemp -d)"
    export PATH="$MOCK_BIN:$PATH"
}

teardown() {
    export PATH="$ORIG_PATH"
    rm -rf "$TEST_PROJECT_DIR" "$MOCK_BIN"
}

# ---------------------------------------------------------------------------
# Helper: source script functions without running main
# ---------------------------------------------------------------------------
# NOTE: Not a function — sourcing inside a function makes `declare -a` local,
# causing IMAGE_REGISTRY to be unbound in the test scope.
source_functions() {
    local script="$TEST_PROJECT_DIR/scripts/check-container-versions.sh"
    sed 's/^main "\$@"/# main "$@"/' "$script" \
        | sed 's/^declare -a //' \
        > "$TEST_PROJECT_DIR/scripts/_testable.sh"
    export COMPOSE_FILE="$TEST_PROJECT_DIR/docker-compose.yml"
    echo "version: '3'" > "$COMPOSE_FILE"
    source "$TEST_PROJECT_DIR/scripts/_testable.sh"
}

# ===========================================================================
# extract_current_version tests
# ===========================================================================

@test "extract_current_version: standard image format" {
    source_functions
    run extract_current_version "pgvector/pgvector:pg17"
    assert_success
    assert_output "pg17"
}

@test "extract_current_version: version with v prefix" {
    source_functions
    run extract_current_version "prom/prometheus:v3.10.0-distroless"
    assert_success
    assert_output "v3.10.0-distroless"
}

@test "extract_current_version: latest tag" {
    source_functions
    run extract_current_version "apache/superset:latest"
    assert_success
    assert_output "latest"
}

@test "extract_current_version: alpine suffix" {
    source_functions
    run extract_current_version "redis:7.4-alpine"
    assert_success
    assert_output "7.4-alpine"
}

# ===========================================================================
# assess_risk tests
# ===========================================================================

@test "assess_risk: same version returns UP_TO_DATE" {
    source_functions
    run assess_risk "v0.31.1" "v0.31.1" "notes"
    assert_success
    assert_output "UP_TO_DATE"
}

@test "assess_risk: patch upgrade returns LOW" {
    source_functions
    run assess_risk "v1.10.2" "v1.10.3" "metric names may change"
    assert_success
    assert_output "LOW"
}

@test "assess_risk: minor upgrade returns MEDIUM" {
    source_functions
    run assess_risk "v1.10.2" "v1.11.0" "notes"
    assert_success
    assert_output "MEDIUM"
}

@test "assess_risk: major upgrade returns HIGH" {
    source_functions
    run assess_risk "v1.10.2" "v2.0.0" "notes"
    assert_success
    assert_output "HIGH"
}

@test "assess_risk: floating tag latest returns FLOATING" {
    source_functions
    run assess_risk "latest" "3.0.0" "notes"
    assert_success
    assert_output "FLOATING"
}

@test "assess_risk: floating tag stable returns FLOATING" {
    source_functions
    run assess_risk "stable" "1.85.0" "notes"
    assert_success
    assert_output "FLOATING"
}

@test "assess_risk: floating tag stable-alpine returns FLOATING" {
    source_functions
    run assess_risk "stable-alpine" "1.27.4-alpine" "notes"
    assert_success
    assert_output "FLOATING"
}

@test "assess_risk: non-numeric version returns MANUAL_CHECK" {
    source_functions
    run assess_risk "pg17" "pg18" "major upgrade needs migration"
    assert_success
    assert_output "MANUAL_CHECK"
}

@test "assess_risk: strips suffix before comparison" {
    source_functions
    run assess_risk "v3.10.0-distroless" "v3.10.1-distroless" "notes"
    assert_success
    assert_output "LOW"
}

@test "assess_risk: version without v prefix" {
    source_functions
    run assess_risk "12.4.1" "12.5.0" "notes"
    assert_success
    assert_output "MEDIUM"
}

# ===========================================================================
# risk_color tests (output contains Chinese from source script)
# ===========================================================================

@test "risk_color: UP_TO_DATE contains expected text" {
    source_functions
    run risk_color "UP_TO_DATE"
    assert_success
    # Source script outputs Chinese
    assert_output --partial "已是最新"
}

@test "risk_color: HIGH contains expected text" {
    source_functions
    run risk_color "HIGH"
    assert_success
    assert_output --partial "高"
}

@test "risk_color: FLOATING contains expected text" {
    source_functions
    run risk_color "FLOATING"
    assert_success
    assert_output --partial "浮动标签"
}

@test "risk_color: FETCH_ERROR contains expected text" {
    source_functions
    run risk_color "FETCH_ERROR"
    assert_success
    assert_output --partial "获取失败"
}

# ===========================================================================
# IMAGE_REGISTRY data integrity
# ===========================================================================

@test "IMAGE_REGISTRY: contains 16 image entries" {
    source_functions
    [ "${#IMAGE_REGISTRY[@]}" -eq 16 ]
}

@test "IMAGE_REGISTRY: each entry has 6 pipe-delimited fields" {
    source_functions
    for entry in "${IMAGE_REGISTRY[@]}"; do
        local fields
        IFS='|' read -ra fields <<< "$entry"
        if [ "${#fields[@]}" -ne 6 ]; then
            echo "wrong field count (${#fields[@]}): $entry"
            return 1
        fi
    done
}

@test "IMAGE_REGISTRY: registry type is only dockerhub or ghcr" {
    source_functions
    for entry in "${IMAGE_REGISTRY[@]}"; do
        local registry_type
        IFS='|' read -r _ registry_type _ <<< "$entry"
        case "$registry_type" in
            dockerhub|ghcr) ;;
            *) echo "unknown registry type: $registry_type"; return 1 ;;
        esac
    done
}

# ===========================================================================
# get_latest_dockerhub_tag: mock curl tests
# ===========================================================================

@test "get_latest_dockerhub_tag: parses and sorts tags correctly" {
    source_functions

    cat > "$MOCK_BIN/curl" <<'MOCK'
#!/usr/bin/env bash
echo '{"results":[{"name":"v1.10.0"},{"name":"v1.10.2"},{"name":"v1.10.1"},{"name":"v1.9.0"},{"name":"latest"}],"next":null}'
MOCK
    chmod +x "$MOCK_BIN/curl"

    run get_latest_dockerhub_tag "prom/node-exporter" "^v[0-9]+\.[0-9]+\.[0-9]+$"
    assert_success
    assert_output "v1.10.2"
}

@test "get_latest_dockerhub_tag: no matching tags returns FETCH_ERROR" {
    source_functions

    cat > "$MOCK_BIN/curl" <<'MOCK'
#!/usr/bin/env bash
echo '{"results":[{"name":"rc1"},{"name":"beta2"}],"next":null}'
MOCK
    chmod +x "$MOCK_BIN/curl"

    run get_latest_dockerhub_tag "some/repo" "^v[0-9]+\.[0-9]+\.[0-9]+$"
    assert_success
    assert_output "FETCH_ERROR"
}

@test "get_latest_dockerhub_tag: curl failure returns FETCH_ERROR" {
    source_functions

    cat > "$MOCK_BIN/curl" <<'MOCK'
#!/usr/bin/env bash
exit 1
MOCK
    chmod +x "$MOCK_BIN/curl"

    run get_latest_dockerhub_tag "some/repo" "^v[0-9]+$"
    assert_success
    assert_output "FETCH_ERROR"
}

# ===========================================================================
# main: JSON mode output
# ===========================================================================

@test "main --json: outputs valid JSON with required fields" {
    source_functions

    cat > "$MOCK_BIN/curl" <<'MOCK'
#!/usr/bin/env bash
echo '{"results":[{"name":"v99.99.99"},{"name":"1.0.0"},{"name":"pg17"}],"next":null}'
MOCK
    chmod +x "$MOCK_BIN/curl"

    JSON_MODE=true
    run main
    assert_success
    echo "$output" | python3 -m json.tool > /dev/null
    echo "$output" | python3 -c "
import sys, json
data = json.load(sys.stdin)
assert 'total' in data, 'missing total'
assert 'upgradable' in data, 'missing upgradable'
assert 'floating' in data, 'missing floating'
assert 'errors' in data, 'missing errors'
assert 'results' in data, 'missing results'
assert data['total'] == 16, f'expected 16, got {data[\"total\"]}'
print('OK')
"
}

@test "main: non-JSON mode includes table headers" {
    source_functions

    cat > "$MOCK_BIN/curl" <<'MOCK'
#!/usr/bin/env bash
echo '{"results":[{"name":"v1.0.0"}],"next":null}'
MOCK
    chmod +x "$MOCK_BIN/curl"

    JSON_MODE=false
    run main
    assert_success
    # Table headers are in Chinese (from source script)
    assert_output --partial "镜像"
    assert_output --partial "当前版本"
    assert_output --partial "最新版本"
    assert_output --partial "总计"
}

# ===========================================================================
# dependency checks
# ===========================================================================

@test "main fails when curl is not available" {
    source_functions

    rm -f "$MOCK_BIN/curl"
    export PATH="$MOCK_BIN"

    JSON_MODE=false
    run main
    assert_failure
    assert_output --partial "curl"
}

@test "main fails when python3 is not available" {
    source_functions

    cat > "$MOCK_BIN/curl" <<'MOCK'
#!/usr/bin/env bash
echo '{}'
MOCK
    chmod +x "$MOCK_BIN/curl"

    export PATH="$MOCK_BIN"

    JSON_MODE=false
    run main
    assert_failure
    assert_output --partial "python3"
}
