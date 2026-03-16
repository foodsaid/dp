#!/usr/bin/env bats
# =============================================================================
# backup.sh 基础设施功能测试
# =============================================================================
# 策略: Mock docker 命令 + 临时目录沙箱
# =============================================================================

load 'setup_suite'

setup() {
    load_bats_libs

    export ORIG_PATH="$PATH"
    export TEST_PROJECT_DIR="$(mktemp -d)"
    mkdir -p "$TEST_PROJECT_DIR/scripts"

    cp "$BATS_TEST_DIRNAME/../../scripts/backup.sh" "$TEST_PROJECT_DIR/scripts/"

    export MOCK_BIN="$(mktemp -d)"
    export PATH="$MOCK_BIN:$PATH"

    # 默认备份目录
    export BACKUP_DIR="$TEST_PROJECT_DIR/backups"
}

teardown() {
    export PATH="$ORIG_PATH"
    rm -rf "$TEST_PROJECT_DIR" "$MOCK_BIN"
}

# ---------------------------------------------------------------------------
# 辅助函数: 创建 Mock docker (支持 exec/cp 子命令)
# ---------------------------------------------------------------------------
create_docker_mock() {
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
# 记录所有调用
echo "docker $*" >> "$TEST_PROJECT_DIR/.docker_calls"

case "$1" in
    exec)
        # pg_dump: 在容器 /tmp 创建模拟文件
        if [[ "$*" == *"pg_dump"* ]]; then
            echo "mock-pg_dump-ok"
            exit 0
        fi
        # rm: 清理容器内文件
        if [[ "$*" == *"rm -f"* ]]; then
            exit 0
        fi
        echo "mock-exec: $*"
        exit 0
        ;;
    cp)
        # 模拟从容器复制文件到宿主机 (创建目标文件)
        local dest="${@: -1}"
        echo "mock-dump-data" > "$dest"
        exit 0
        ;;
    *)
        echo "mock-docker: $*"
        exit 0
        ;;
esac
MOCK
    chmod +x "$MOCK_BIN/docker"
}

# 辅助: 创建 du mock
create_du_mock() {
    cat > "$MOCK_BIN/du" <<'MOCK'
#!/usr/bin/env bash
echo "42K	$2"
MOCK
    chmod +x "$MOCK_BIN/du"
}

# =============================================================================
# 用例 1: docker 命令不可用时失败
# =============================================================================
@test "backup.sh fails if docker is not available" {
    # 不创建 docker mock → 命令找不到
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
echo "Cannot connect to Docker" >&2
exit 1
MOCK
    chmod +x "$MOCK_BIN/docker"

    run bash "$TEST_PROJECT_DIR/scripts/backup.sh"
    assert_failure
}

# =============================================================================
# 用例 2: 正常备份流程 — pg_dump + docker cp 成功
# =============================================================================
@test "backup.sh creates backup file successfully" {
    create_docker_mock
    create_du_mock

    run bash "$TEST_PROJECT_DIR/scripts/backup.sh"
    assert_success
    assert_output --partial "备份完成"

    # 验证备份目录已创建
    [ -d "$BACKUP_DIR" ]
}

# =============================================================================
# 用例 3: 自定义 BACKUP_DIR 被正确使用
# =============================================================================
@test "backup.sh respects custom BACKUP_DIR" {
    export BACKUP_DIR="$TEST_PROJECT_DIR/custom-backups"
    create_docker_mock
    create_du_mock

    run bash "$TEST_PROJECT_DIR/scripts/backup.sh"
    assert_success
    [ -d "$TEST_PROJECT_DIR/custom-backups" ]
}

# =============================================================================
# 用例 4: 输出包含恢复命令提示
# =============================================================================
@test "backup.sh prints restore instructions" {
    create_docker_mock
    create_du_mock

    run bash "$TEST_PROJECT_DIR/scripts/backup.sh"
    assert_success
    assert_output --partial "恢复命令"
    assert_output --partial "pg_restore"
}

# =============================================================================
# 用例 5: docker exec pg_dump 失败时脚本退出
# =============================================================================
@test "backup.sh fails when pg_dump fails" {
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$*" == *"pg_dump"* ]]; then
    echo "pg_dump: error" >&2
    exit 1
fi
echo "mock-docker: $*"
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"

    run bash "$TEST_PROJECT_DIR/scripts/backup.sh"
    assert_failure
}
