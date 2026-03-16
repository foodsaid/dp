#!/usr/bin/env bash
# ============================================================================
# publish-snapshot.sh — 推送脱敏快照到公开仓库 foodsaid/dp
#
# 用法: bash scripts/publish-snapshot.sh
#
# 流程:
#   1. git archive 提取干净文件 (天然遵守 .gitignore)
#   2. 按 .public-ignore 移除额外敏感文件
#   3. URL 替换 (Digital-Platform → dp)
#   4. 敏感内容扫描 (fail-fast)
#   5. 推送 main (单 commit, 无历史)
#   6. 构建 + 推送 GitHub Pages (gh-pages 分支)
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SNAPSHOT_DIR="/tmp/dp-snapshot"
PUBLIC_REPO="git@github.com:foodsaid/dp.git"
VERSION=$(cat "$REPO_ROOT/VERSION")

# ── 0. 前置检查 ──────────────────────────────────────────
cd "$REPO_ROOT"

[[ -f "$REPO_ROOT/.public-ignore" ]] || { echo "❌ .public-ignore 文件不存在"; exit 1; }

if [[ -n $(git status --porcelain) ]]; then
    echo "❌ 有未提交改动，请先 commit"
    exit 1
fi

echo "📦 正在构建 v$VERSION 快照..."

# ── 1. git archive 提取干净文件 (天然遵守 .gitignore) ────
rm -rf "$SNAPSHOT_DIR"
mkdir -p "$SNAPSHOT_DIR"
git archive HEAD | tar -x -C "$SNAPSHOT_DIR"

# 移除 .public-ignore 中列出的精确路径
while IFS= read -r pattern; do
    [[ -z "$pattern" || "$pattern" =~ ^# ]] && continue
    rm -rf "${SNAPSHOT_DIR:?}/$pattern" 2>/dev/null || true
done < "$REPO_ROOT/.public-ignore"

echo "   已按 .public-ignore 清理敏感文件"

# ── 2. URL 替换 (Digital-Platform → dp) ─────────────────
SED_I=(sed -i)
[[ "$OSTYPE" == "darwin"* ]] && SED_I=(sed -i '')

find "$SNAPSHOT_DIR" -type f \( \
    -name '*.md' -o -name '*.sh' -o -name '*.yml' -o -name '*.yaml' \
    -o -name '*.json' -o -name '*.html' -o -name 'Dockerfile*' \
\) -exec "${SED_I[@]}" -e 's|foodsaid/dp|foodsaid/dp|g' \
                       -e 's|foodsaid\.github\.io/Digital-Platform|foodsaid.github.io/dp|g' {} +

echo "   URL 替换完成"

# ── 2.5 README 顶部追加公告 ─────────────────────────────
README_FILE="$SNAPSHOT_DIR/README.md"
if [ -f "$README_FILE" ]; then
    printf '> **注意**: 本仓库为 [foodsaid/dp](https://github.com/foodsaid/dp) 的脱敏快照发布版，仅供参考，不包含 git 历史。\n\n' > "$SNAPSHOT_DIR/_README_TEMP.md"
    cat "$README_FILE" >> "$SNAPSHOT_DIR/_README_TEMP.md"
    mv "$SNAPSHOT_DIR/_README_TEMP.md" "$README_FILE"
fi

# ── 3. 敏感内容扫描 (fail-fast) ─────────────────────────
# 策略: 扫描真实硬编码凭据，排除环境变量引用 ${...} 和代码逻辑
echo "🔍 扫描敏感内容..."
FILE_COUNT=$(find "$SNAPSHOT_DIR" -type f | wc -l)
echo "   扫描 $FILE_COUNT 个文件..."

# 第一遍: 找到包含敏感关键词的行
SCAN_HITS=$(grep -r -n -iE \
    'password[[:space:]]*[:=]|secret[[:space:]]*[:=]|apikey[[:space:]]*[:=]|private_key|Authorization:[[:space:]]*Bearer' \
    "$SNAPSHOT_DIR" \
    --include='*.yml' --include='*.yaml' --include='*.sh' \
    --include='*.js' --include='*.ts' --include='*.py' \
    --include='*.sql' --include='*.conf' \
    --exclude-dir='.git' --exclude-dir='node_modules' \
    2>/dev/null || true)

# 第二遍: 过滤掉已知安全模式 (仅保留真实硬编码凭据)
SCAN_FILTERED=$(echo "$SCAN_HITS" | grep -v -E \
    '\$\{|\$\(|\.example:|/test_|/conftest\.' \
    | grep -v -E \
    'password:[[:space:]]*$|local password|password_hash|hashPassword|read_password' \
    | grep -v -E \
    'DB_PASS|TEMP_PASSWORD|_PASSWORD=|_SECRET=|_PASS=' \
    | grep -v -E \
    'grep -E|echo "|另需|publish-snapshot|monitor_pass|#[[:space:]]' \
    | grep -v '^$' || true)

if [[ -n "$SCAN_FILTERED" ]]; then
    echo "❌ 发现潜在敏感内容，已中断发布:"
    echo "$SCAN_FILTERED"
    echo ""
    echo "请检查上述内容，确认无真实凭据后可在脚本中添加排除规则"
    exit 1
fi
echo "✅ 扫描通过 ($FILE_COUNT 个文件)"

# ── 4. 推送 main (单 commit, 无历史) ────────────────────
cd "$SNAPSHOT_DIR"
git init -q
git add -A
git commit -q -m "snapshot: Digital Platform v$VERSION"
git branch -M main
git remote add origin "$PUBLIC_REPO"
git push --force origin main

echo "✅ main 分支已推送"

# ── 5. 构建 + 推送 GitHub Pages ─────────────────────────
bash "$SNAPSHOT_DIR/scripts/build-gh-pages.sh" "$SNAPSHOT_DIR/_gh-pages"
cd "$SNAPSHOT_DIR/_gh-pages"
git init -q
git add -A
git commit -q -m "deploy: GitHub Pages v$VERSION"
git branch -M gh-pages
git remote add origin "$PUBLIC_REPO"
git push --force origin gh-pages

echo "✅ gh-pages 分支已推送"

# ── 6. 清理 ─────────────────────────────────────────────
rm -rf "$SNAPSHOT_DIR"

echo ""
echo "🎉 快照 v$VERSION 已发布到 https://github.com/foodsaid/dp"
echo "📄 GitHub Pages: https://foodsaid.github.io/dp/"
