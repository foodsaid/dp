#!/usr/bin/env bats
# =============================================================================
# clone-company.sh 基础设施功能测试
# =============================================================================
# 策略: 临时目录沙箱隔离，验证文件操作和输入校验
# =============================================================================

load 'setup_suite'

setup() {
    load_bats_libs

    export ORIG_PATH="$PATH"
    export TEST_PROJECT_DIR="$(mktemp -d)"

    # 模拟项目目录结构
    mkdir -p "$TEST_PROJECT_DIR/scripts"
    mkdir -p "$TEST_PROJECT_DIR/apps/wms"
    touch "$TEST_PROJECT_DIR/apps/wms/shared.js"

    cp "$BATS_TEST_DIRNAME/../../scripts/clone-company.sh" "$TEST_PROJECT_DIR/scripts/"

    # 创建 .env.example 模板 (必须与实际 .env.example 中的 sed 目标行保持同步)
    cat > "$TEST_PROJECT_DIR/.env.example" <<'ENV'
DP_COMPANY_CODE=DEFAULT
DP_COMPANY_NAME=Digital Platform
APP_BASE_URL=
API_BASE_URL=/api/wms
WEBHOOK_URL=http://localhost:5678
N8N_EDITOR_BASE_URL=http://localhost:5678/
DP_DB_PASSWORD=
ENV

    export MOCK_BIN="$(mktemp -d)"
    export PATH="$MOCK_BIN:$PATH"
}

teardown() {
    export PATH="$ORIG_PATH"
    # 清理 clone-company.sh 创建的 sibling 目录
    rm -rf "$TEST_PROJECT_DIR/../dp-"* 2>/dev/null || true
    rm -rf "$TEST_PROJECT_DIR" "$MOCK_BIN"
}

# =============================================================================
# 用例 1: 缺少必需参数时报错
# =============================================================================
@test "clone-company.sh fails without COMPANY_CODE argument" {
    run bash "$TEST_PROJECT_DIR/scripts/clone-company.sh"
    assert_failure
    assert_output --partial "用法"
}

# =============================================================================
# 用例 2: COMPANY_CODE 输入验证 — 拒绝特殊字符
# =============================================================================
@test "clone-company.sh rejects invalid COMPANY_CODE with special chars" {
    run bash "$TEST_PROJECT_DIR/scripts/clone-company.sh" "a;rm -rf /"
    assert_failure
    assert_output --partial "COMPANY_CODE 只能包含"
}

# =============================================================================
# 用例 3: COMPANY_CODE 输入验证 — 拒绝超长输入
# =============================================================================
@test "clone-company.sh rejects COMPANY_CODE exceeding 20 chars" {
    run bash "$TEST_PROJECT_DIR/scripts/clone-company.sh" "ABCDEFGHIJKLMNOPQRSTU"
    assert_failure
    assert_output --partial "COMPANY_CODE 只能包含"
}

# =============================================================================
# 用例 4: DOMAIN 输入验证 — 拒绝非法域名
# =============================================================================
@test "clone-company.sh rejects invalid DOMAIN" {
    run bash "$TEST_PROJECT_DIR/scripts/clone-company.sh" "TEST001" "exam ple.com"
    assert_failure
    assert_output --partial "DOMAIN 只能包含"
}

# =============================================================================
# 用例 5: 目标目录已存在时报错
# =============================================================================
@test "clone-company.sh fails if target directory already exists" {
    mkdir -p "$TEST_PROJECT_DIR/../dp-EXIST01"
    run bash "$TEST_PROJECT_DIR/scripts/clone-company.sh" "EXIST01"
    assert_failure
    assert_output --partial "目录已存在"
    rm -rf "$TEST_PROJECT_DIR/../dp-EXIST01"
}

# =============================================================================
# 用例 6: 正常克隆 — 创建目录 + 替换 company_code
# =============================================================================
@test "clone-company.sh clones project with correct company_code" {
    run bash "$TEST_PROJECT_DIR/scripts/clone-company.sh" "CLIENT01"
    assert_success
    assert_output --partial "新客户环境已创建"

    local target="$TEST_PROJECT_DIR/../dp-CLIENT01"
    [ -d "$target" ]
    [ -f "$target/.env" ]
    # .git 目录应被移除
    [ ! -d "$target/.git" ]
    # .env 中 company_code 应已替换
    run grep "DP_COMPANY_CODE=CLIENT01" "$target/.env"
    assert_success

    rm -rf "$target"
}

# =============================================================================
# 用例 7: 带域名克隆 — 替换 URL
# =============================================================================
@test "clone-company.sh substitutes domain in .env" {
    run bash "$TEST_PROJECT_DIR/scripts/clone-company.sh" "CLIENT02" "client02.example.com"
    assert_success

    local target="$TEST_PROJECT_DIR/../dp-CLIENT02"
    # APP_BASE_URL 替换为完整域名
    run grep "APP_BASE_URL=https://client02.example.com" "$target/.env"
    assert_success
    # API_BASE_URL 替换为完整域名
    run grep "API_BASE_URL=https://client02.example.com/api/wms" "$target/.env"
    assert_success
    # WEBHOOK_URL 替换为 wf 子域名
    run grep "WEBHOOK_URL=https://wf.client02.example.com" "$target/.env"
    assert_success
    # N8N_EDITOR_BASE_URL 替换为 wf 子域名
    run grep "N8N_EDITOR_BASE_URL=https://wf.client02.example.com/" "$target/.env"
    assert_success

    rm -rf "$target"
}

# =============================================================================
# 用例 8: Mock 同步检查 — BATS 夹具中的 sed 模式必须与实际 .env.example 一致
# =============================================================================
@test "clone-company.sh sed patterns match actual .env.example" {
    local real_env="$BATS_TEST_DIRNAME/../../.env.example"
    [ -f "$real_env" ] || skip "仓库根目录无 .env.example"

    # 验证 clone-company.sh 依赖的关键行在实际 .env.example 中存在
    # 1. DP_COMPANY_CODE=DEFAULT
    run grep -c "^DP_COMPANY_CODE=DEFAULT$" "$real_env"
    assert_success
    assert_output "1"

    # 2. DP_COMPANY_NAME=Digital Platform
    run grep -c "^DP_COMPANY_NAME=Digital Platform$" "$real_env"
    assert_success
    assert_output "1"

    # 3. APP_BASE_URL= (空值，sed 用 ^APP_BASE_URL=.* 匹配)
    run grep -c "^APP_BASE_URL=" "$real_env"
    assert_success

    # 4. API_BASE_URL=/api/wms (相对路径，sed 用 ^API_BASE_URL=.* 匹配)
    run grep -c "^API_BASE_URL=" "$real_env"
    assert_success

    # 5. WEBHOOK_URL= (sed 用 ^WEBHOOK_URL=.* 匹配)
    run grep -c "^WEBHOOK_URL=" "$real_env"
    assert_success

    # 6. N8N_EDITOR_BASE_URL= (sed 用 ^N8N_EDITOR_BASE_URL=.* 匹配)
    run grep -c "^N8N_EDITOR_BASE_URL=" "$real_env"
    assert_success
}
