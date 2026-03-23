#!/usr/bin/env bash
# ============================================================================
# build-gh-pages.sh — 将 landing 页面构建为 GitHub Pages 静态站点
#
# 用法: bash scripts/build-gh-pages.sh [输出目录]
#
# 从 infrastructure/nginx/landing/ 复制文件到输出目录 (默认 _gh-pages/)，
# 并做最小化转换使其适配 GitHub Pages 静态托管环境:
#   - favicon 路径改为相对路径
#   - 内部链接 (/privacy, /terms) 改为 .html 后缀
#   - 内部服务链接 (/wms/, /bi/ 等) 在 GitHub Pages 上禁用
#   - n8n URL 路由在 github.io 域名下跳过
# ============================================================================
set -euo pipefail

# macOS sed -i 需要空后缀参数，GNU sed 不需要
sedi() { sed -i '' "$@" 2>/dev/null || sed -i "$@"; }

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-${REPO_ROOT}/_gh-pages}"
SRC="${REPO_ROOT}/infrastructure/nginx/landing"

# 清理并创建输出目录
rm -rf "$OUT"
mkdir -p "$OUT"

# 复制 landing 源文件
cp "$SRC/index.html"      "$OUT/"
cp "$SRC/privacy.html"    "$OUT/"
cp "$SRC/terms.html"      "$OUT/"
cp "$SRC/logo-oauth.svg"  "$OUT/"

# 复制 favicon (源在 WMS 目录)
cp "$REPO_ROOT/apps/wms/favicon.svg" "$OUT/favicon.svg"

# 禁用 Jekyll 处理
touch "$OUT/.nojekyll"

# ============================================================================
# 转换 index.html
# ============================================================================
INDEX="$OUT/index.html"

# 1. favicon: 绝对路径 → 相对路径
sedi 's|href="/wms/favicon.svg"|href="favicon.svg"|g' "$INDEX"

# 2. 注入 gh-pages 检测标记 (在 </head> 前)
sedi 's|</head>|    <meta name="gh-pages" content="true">\
</head>|' "$INDEX"

# 3. privacy/terms 链接: 绝对路径 → 相对 .html
sedi 's|href="/privacy"|href="privacy.html"|g' "$INDEX"
sedi 's|href="/terms"|href="terms.html"|g' "$INDEX"

# 4. 在 </body> 前注入 GitHub Pages 展示模式脚本
#    - 禁用内部服务链接 + 灰色样式 + tooltip
#    - github.io 域名下跳过 n8n URL 路由
cat >> "$INDEX" << 'GHSCRIPT'
<!-- GitHub Pages 展示模式 -->
<style>
.gh-disabled{opacity:.45!important;cursor:not-allowed!important;position:relative}
.gh-disabled::after{content:'仅自部署可用';position:absolute;bottom:-22px;left:50%;transform:translateX(-50%);font-size:11px;color:#64748b;white-space:nowrap;pointer-events:none}
.gh-disabled:hover{transform:none!important;box-shadow:none!important;border-color:rgba(255,255,255,.07)!important}
</style>
<script>
(function(){
    if(!document.querySelector('meta[name="gh-pages"]'))return;
    // 内部服务路径列表
    var internalPaths=['/wms/','/BI/','/bi/','/ai/','/auth/','/auth/settings','/auth/logout','/grafana/'];
    document.querySelectorAll('a[href]').forEach(function(a){
        var h=a.getAttribute('href');
        if(!h)return;
        for(var i=0;i<internalPaths.length;i++){
            if(h===internalPaths[i]){
                a.href='#';
                a.classList.add('gh-disabled');
                a.addEventListener('click',function(e){e.preventDefault()});
                break;
            }
        }
    });
    // n8n URL 路由: github.io 域名下重置为 GitHub 仓库链接
    var isGhPages=location.hostname.indexOf('github.io')!==-1;
    if(isGhPages){
        var repoUrl='https://github.com/foodsaid/dp';
        ['wf-link','wf-face','footer-wf','wf-link-grid'].forEach(function(id){
            var el=document.getElementById(id);
            if(el){el.href=repoUrl;el.classList.remove('gh-disabled')}
        });
    }
})();
</script>
GHSCRIPT

# 修复: </body></html> 被推到脚本之前了，需要调整
# 注入的内容在 </body> 之后，把它移到 </body> 之前
# 实际上 cat >> 追加在文件末尾，在 </html> 之后
# 需要将注入内容移到 </body> 之前
# 先删除末尾的 </body></html>，再追加回去
# 更简单的方法: sed 将注入标记移到正确位置

# 因为 cat >> 把内容追加到了 </html> 之后，
# 需要重新组织: 把 </body>\n</html> 移到文件最后
INDEX_FILE="$INDEX" python3 -c "
import os, re
index_path = os.environ['INDEX_FILE']
with open(index_path, 'r') as f:
    content = f.read()
# 找到 <!-- GitHub Pages 展示模式 --> 注入的内容
marker = '<!-- GitHub Pages 展示模式 -->'
idx = content.index(marker)
injected = content[idx:]
before = content[:idx]
# 从 before 中去掉末尾的 </body>\n</html>\n
before = before.rstrip()
if before.endswith('</html>'):
    before = before[:-len('</html>')].rstrip()
if before.endswith('</body>'):
    before = before[:-len('</body>')].rstrip()
# 重组: before + injected + </body></html>
result = before + '\n\n' + injected + '\n</body>\n</html>\n'
with open(index_path, 'w') as f:
    f.write(result)
"

# ============================================================================
# 转换 privacy.html
# ============================================================================
PRIVACY="$OUT/privacy.html"
sedi 's|href="/wms/favicon.svg"|href="favicon.svg"|g' "$PRIVACY"
sedi 's|href="/"|href="./"|g' "$PRIVACY"
sedi 's|__DP_CONTACT_EMAIL__|admin@foodsaid.com|g' "$PRIVACY"

# ============================================================================
# 转换 terms.html
# ============================================================================
TERMS="$OUT/terms.html"
sedi 's|href="/wms/favicon.svg"|href="favicon.svg"|g' "$TERMS"
sedi 's|href="/"|href="./"|g' "$TERMS"
sedi 's|href="/privacy"|href="privacy.html"|g' "$TERMS"
sedi 's|__DP_CONTACT_EMAIL__|admin@foodsaid.com|g' "$TERMS"

echo "✅ GitHub Pages 构建完成: $OUT/"
echo "   文件列表:"
ls -la "$OUT/"
echo ""
echo "   本地预览: python3 -m http.server -d $OUT 8000"
