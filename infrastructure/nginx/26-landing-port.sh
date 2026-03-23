#!/bin/sh
# =============================================================================
# DP — Landing 页端口注入脚本
# =============================================================================
# 挂载到 dp-gateway 的 /docker-entrypoint.d/26-landing-port.sh
# nginx 官方镜像在启动时自动执行 /docker-entrypoint.d/ 下的脚本
#
# 行为:
#   从 /usr/share/nginx/landing-src 复制文件到 /usr/share/nginx/landing
#   将 JavaScript 中的 __WF_PORT__ 占位符替换为 DP_WF_PORT 的实际值
# =============================================================================

set -e

SRC="/usr/share/nginx/landing-src"
DST="/usr/share/nginx/landing"
WF_PORT="${DP_WF_PORT:-5678}"
CONTACT_EMAIL="${DP_CONTACT_EMAIL:-admin@example.com}"

# 安全: 端口号必须为纯数字
case "$WF_PORT" in
    *[!0-9]*) echo "=== [DP-Gateway] DP_WF_PORT 必须为数字，使用默认 5678 ==="; WF_PORT="5678" ;;
esac

# 复制 landing 文件到动态目录
cp -r "${SRC}/." "${DST}/"

# 替换 JavaScript 中的 n8n 端口占位符
if [ -f "${DST}/index.html" ]; then
    sed "s|__WF_PORT__|${WF_PORT}|g" "${DST}/index.html" > "${DST}/index.html.tmp" && mv "${DST}/index.html.tmp" "${DST}/index.html"
    echo "=== [DP-Gateway] landing WF 端口注入: ${WF_PORT} ==="
else
    echo "=== [DP-Gateway] landing/index.html 未找到，跳过端口注入 ==="
fi

# 替换 privacy/terms 中的联系邮箱
for f in privacy.html terms.html; do
    if [ -f "${DST}/${f}" ]; then
        sed "s|__DP_CONTACT_EMAIL__|${CONTACT_EMAIL}|g" "${DST}/${f}" > "${DST}/${f}.tmp" && mv "${DST}/${f}.tmp" "${DST}/${f}"
    fi
done
echo "=== [DP-Gateway] landing 联系邮箱注入: ${CONTACT_EMAIL} ==="
