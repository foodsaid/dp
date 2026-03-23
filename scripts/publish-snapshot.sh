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

# 生成 Apache 2.0 LICENSE (替换私有仓库的 UNLICENSED)
cat > "$SNAPSHOT_DIR/LICENSE" << 'APACHE2'
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to the Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by the Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding any notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   Copyright 2026 FoodSaid

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
APACHE2

echo "   Apache 2.0 LICENSE 已生成"

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
    | grep -v -E \
    ':[0-9]+:[[:space:]]*//' \
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
