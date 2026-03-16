#!/usr/bin/env bash
# =============================================================================
# BATS 测试套件初始化 — 加载 bats-support 和 bats-assert
# =============================================================================
# bats-core 1.7+ 自动加载此文件并调用 setup_suite()
# 在 .bats 文件的 setup() 中调用 load_bats_libs 完成辅助库加载
# =============================================================================

# 定位 node_modules 中的 BATS 辅助库 (绝对路径，兼容任意工作目录)
_BATS_LIBS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/node_modules"

# bats-core 要求此函数存在 (套件级初始化，此处仅导出路径)
setup_suite() {
    export BATS_LIBS_ROOT="$_BATS_LIBS_ROOT"
}

# 在每个 .bats 文件的 setup() 中调用
load_bats_libs() {
    load "${_BATS_LIBS_ROOT}/bats-support/load"
    load "${_BATS_LIBS_ROOT}/bats-assert/load"
}
