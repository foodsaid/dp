#!/usr/bin/env bats
# =============================================================================
# publish-snapshot.sh 基础设施功能测试
# =============================================================================
# 策略: Mock git 命令 + 临时目录沙箱，测试参数校验和流程
# =============================================================================

load 'setup_suite'

setup() {
    load_bats_libs

    export ORIG_PATH="$PATH"
    export TEST_PROJECT_DIR="$(mktemp -d)"

    # 创建必要的项目结构
    mkdir -p "$TEST_PROJECT_DIR/scripts"
    mkdir -p "$TEST_PROJECT_DIR/apps/wms"
    mkdir -p "$TEST_PROJECT_DIR/infrastructure/nginx/landing"

    # 复制脚本
    cp "$BATS_TEST_DIRNAME/../../scripts/publish-snapshot.sh" "$TEST_PROJECT_DIR/scripts/"

    # 创建 VERSION 文件
    echo "0.3.3" > "$TEST_PROJECT_DIR/VERSION"

    # 创建 .public-ignore
    echo "# test" > "$TEST_PROJECT_DIR/.public-ignore"
    echo ".env" >> "$TEST_PROJECT_DIR/.public-ignore"

    # Mock 命令目录
    export MOCK_BIN="$(mktemp -d)"
    export PATH="$MOCK_BIN:$PATH"
}

teardown() {
    export PATH="$ORIG_PATH"
    rm -rf "$TEST_PROJECT_DIR" "$MOCK_BIN"
}

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------
create_git_mock() {
    cat > "$MOCK_BIN/git" <<'MOCK'
#!/usr/bin/env bash
echo "git $*" >> "$TEST_PROJECT_DIR/.git_calls"
case "$1" in
    status)
        if [ "${MOCK_GIT_DIRTY:-}" = "true" ]; then
            echo " M dirty-file.txt"
        fi
        ;;
    archive)
        # 创建一个空 tar
        tar cf - --files-from=/dev/null
        ;;
    *)
        ;;
esac
MOCK
    chmod +x "$MOCK_BIN/git"
}

# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------

@test "publish-snapshot: fails when .public-ignore missing" {
    create_git_mock
    rm "$TEST_PROJECT_DIR/.public-ignore"

    cd "$TEST_PROJECT_DIR"
    run bash scripts/publish-snapshot.sh
    assert_failure
    assert_output --partial ".public-ignore"
}

@test "publish-snapshot: fails when working directory has uncommitted changes" {
    export MOCK_GIT_DIRTY="true"
    create_git_mock

    cd "$TEST_PROJECT_DIR"
    run bash scripts/publish-snapshot.sh
    assert_failure
}

@test "publish-snapshot: VERSION file read correctly" {
    version=$(cat "$TEST_PROJECT_DIR/VERSION")
    assert_equal "$version" "0.3.3"
}
