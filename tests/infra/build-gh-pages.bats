#!/usr/bin/env bats
# =============================================================================
# build-gh-pages.sh 基础设施功能测试
# =============================================================================
# 策略: 创建临时 landing 文件 + 运行构建 + 验证输出
# =============================================================================

load 'setup_suite'

setup() {
    load_bats_libs

    export TEST_PROJECT_DIR="$(mktemp -d)"

    # 创建完整的项目结构 (build-gh-pages.sh 需要)
    mkdir -p "$TEST_PROJECT_DIR/scripts"
    mkdir -p "$TEST_PROJECT_DIR/apps/wms"
    mkdir -p "$TEST_PROJECT_DIR/infrastructure/nginx/landing"

    # 复制脚本
    cp "$BATS_TEST_DIRNAME/../../scripts/build-gh-pages.sh" "$TEST_PROJECT_DIR/scripts/"

    # 创建 landing 源文件
    cat > "$TEST_PROJECT_DIR/infrastructure/nginx/landing/index.html" << 'HTML'
<!DOCTYPE html>
<html>
<head><link rel="icon" href="/wms/favicon.svg"><title>DP</title></head>
<body>
<a href="/privacy">隐私</a>
<a href="/terms">条款</a>
<a href="/wms/">WMS</a>
</body>
</html>
HTML

    cat > "$TEST_PROJECT_DIR/infrastructure/nginx/landing/privacy.html" << 'HTML'
<!DOCTYPE html>
<html><head><link rel="icon" href="/wms/favicon.svg"></head>
<body><a href="/">返回</a><p>__DP_CONTACT_EMAIL__</p></body></html>
HTML

    cat > "$TEST_PROJECT_DIR/infrastructure/nginx/landing/terms.html" << 'HTML'
<!DOCTYPE html>
<html><head><link rel="icon" href="/wms/favicon.svg"></head>
<body><a href="/">返回</a><a href="/privacy">隐私</a><p>__DP_CONTACT_EMAIL__</p></body></html>
HTML

    echo '<svg></svg>' > "$TEST_PROJECT_DIR/infrastructure/nginx/landing/logo-oauth.svg"
    echo '<svg>favicon</svg>' > "$TEST_PROJECT_DIR/apps/wms/favicon.svg"

    export OUT_DIR="$TEST_PROJECT_DIR/_gh-pages"
}

teardown() {
    rm -rf "$TEST_PROJECT_DIR"
}

# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------

@test "build-gh-pages: output contains all required files" {
    cd "$TEST_PROJECT_DIR"
    run bash scripts/build-gh-pages.sh "$OUT_DIR"
    assert_success

    assert [ -f "$OUT_DIR/index.html" ]
    assert [ -f "$OUT_DIR/privacy.html" ]
    assert [ -f "$OUT_DIR/terms.html" ]
    assert [ -f "$OUT_DIR/logo-oauth.svg" ]
    assert [ -f "$OUT_DIR/favicon.svg" ]
    assert [ -f "$OUT_DIR/.nojekyll" ]
}

@test "build-gh-pages: favicon path rewritten to relative" {
    cd "$TEST_PROJECT_DIR"
    bash scripts/build-gh-pages.sh "$OUT_DIR"

    # index.html: /wms/favicon.svg -> favicon.svg
    run grep -c 'href="/wms/favicon.svg"' "$OUT_DIR/index.html"
    assert_output "0"

    run grep -c 'href="favicon.svg"' "$OUT_DIR/index.html"
    assert_output "1"
}

@test "build-gh-pages: privacy/terms links rewritten to .html suffix" {
    cd "$TEST_PROJECT_DIR"
    bash scripts/build-gh-pages.sh "$OUT_DIR"

    run grep -c 'href="privacy.html"' "$OUT_DIR/index.html"
    assert_output "1"

    run grep -c 'href="terms.html"' "$OUT_DIR/index.html"
    assert_output "1"
}

@test "build-gh-pages: gh-pages detection meta tag injected" {
    cd "$TEST_PROJECT_DIR"
    bash scripts/build-gh-pages.sh "$OUT_DIR"

    run grep -c '<meta name="gh-pages"' "$OUT_DIR/index.html"
    assert_output "1"
}

@test "build-gh-pages: GitHub Pages demo mode script injected" {
    cd "$TEST_PROJECT_DIR"
    bash scripts/build-gh-pages.sh "$OUT_DIR"

    run grep -c 'GitHub Pages' "$OUT_DIR/index.html"
    assert [ "$output" -ge 1 ]
    run grep -c 'gh-disabled' "$OUT_DIR/index.html"
    assert [ "$output" -ge 1 ]
}

@test "build-gh-pages: privacy.html email placeholder replaced" {
    cd "$TEST_PROJECT_DIR"
    bash scripts/build-gh-pages.sh "$OUT_DIR"

    run grep -c '__DP_CONTACT_EMAIL__' "$OUT_DIR/privacy.html"
    assert_output "0"

    run grep -c 'admin@foodsaid.com' "$OUT_DIR/privacy.html"
    assert_output "1"
}

@test "build-gh-pages: terms.html privacy link rewritten to .html" {
    cd "$TEST_PROJECT_DIR"
    bash scripts/build-gh-pages.sh "$OUT_DIR"

    run grep -c 'href="privacy.html"' "$OUT_DIR/terms.html"
    assert_output "1"
}

@test "build-gh-pages: defaults output dir to _gh-pages" {
    cd "$TEST_PROJECT_DIR"
    run bash scripts/build-gh-pages.sh
    assert_success
    assert [ -d "$TEST_PROJECT_DIR/_gh-pages" ]
}
