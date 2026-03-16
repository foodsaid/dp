#!/bin/bash
set -e

# =============================================================================
# DP v0.1 — WMS 前端 env.js 生成器
# 在 nginx 容器启动时运行 (docker-entrypoint.d/90-generate-env-js.sh)
# =============================================================================

# 写到容器内部独立目录，避免多容器 bind-mount 同一 apps/wms/ 时互相覆盖
ENV_JS_DIR="/var/run/wms-env"
ENV_JS_PATH="${ENV_JS_DIR}/env.js"
mkdir -p "${ENV_JS_DIR}"

# 布尔值安全处理: 仅允许 true/false，其他值回退到默认值
_SOUND_ENABLED="${SOUND_ENABLED:-true}"
[[ "$_SOUND_ENABLED" == "true" || "$_SOUND_ENABLED" == "false" ]] || _SOUND_ENABLED="true"

_DEBUG="${DEBUG:-true}"
[[ "$_DEBUG" == "true" || "$_DEBUG" == "false" ]] || _DEBUG="true"

_SSO_ENABLED="${DP_SSO_ENABLED:-false}"
[[ "$_SSO_ENABLED" == "true" || "$_SSO_ENABLED" == "false" ]] || _SSO_ENABLED="false"

# 字符串环境变量安全处理: 转义反斜杠和单引号 (防 JS 注入)
safe_js_str() {
    printf '%s' "$1" | sed "s/\\\\/\\\\\\\\/g; s/'/\\\\'/g; s/\n/\\\\n/g"
}
_ENV_NAME="$(safe_js_str "${ENV_NAME:-development}")"
_API_BASE_URL="$(safe_js_str "${API_BASE_URL:-}")"
_QR_SERVICE_URL="$(safe_js_str "${QR_SERVICE_URL:-}")"
_APP_BASE_URL="$(safe_js_str "${APP_BASE_URL:-}")"
_SYSTEM_TIMEZONE="$(safe_js_str "${SYSTEM_TIMEZONE:-UTC}")"

# 数值型环境变量安全处理: 仅允许数字
_AUTO_FOCUS_DELAY="${AUTO_FOCUS_DELAY:-100}"
[[ "$_AUTO_FOCUS_DELAY" =~ ^[0-9]+$ ]] || _AUTO_FOCUS_DELAY="100"

# WMS 业务配置 JSON (可选, 留空=使用内置默认值)
_WMS_CONFIG="${WMS_CONFIG:-}"

echo "=== [DP-WMS] 生成 env.js ==="

cat > "$ENV_JS_PATH" <<'ENVEOF'
/**
 * DP — WMS 环境配置
 * 由 Docker 自动生成 — 请勿手动修改 — 修改 .env 后重启容器
 */
ENVEOF

# 使用变量安全注入 (heredoc 已禁止 shell 展开)
cat >> "$ENV_JS_PATH" <<ENVEOF
window.__ENV = {
    ENV_NAME: '${_ENV_NAME}',
    API_BASE_URL: '${_API_BASE_URL}',
    QR_SERVICE_URL: '${_QR_SERVICE_URL}',
    APP_BASE_URL: '${_APP_BASE_URL}',
    SYSTEM_TIMEZONE: '${_SYSTEM_TIMEZONE}',
    SOUND_ENABLED: ${_SOUND_ENABLED},
    AUTO_FOCUS_DELAY: ${_AUTO_FOCUS_DELAY},
    DEBUG: ${_DEBUG},
    SSO_ENABLED: ${_SSO_ENABLED},
ENVEOF

# 有条件注入 WMS_CONFIG (仅当 .env 中配置了非空 JSON)
if [ -n "${_WMS_CONFIG}" ]; then
cat >> "$ENV_JS_PATH" <<ENVEOF
    WMS_CONFIG: ${_WMS_CONFIG},
ENVEOF
echo "  WMS_CONFIG=${_WMS_CONFIG}"
fi

# 闭合对象
echo "};" >> "$ENV_JS_PATH"

echo "  ENV_NAME=${ENV_NAME:-development}"
echo "  API_BASE_URL=${API_BASE_URL:-}"
echo "  SYSTEM_TIMEZONE=${SYSTEM_TIMEZONE:-UTC}"

# env.js 写入独立目录，设置 nginx 可读权限
chown -R nginx:nginx "${ENV_JS_DIR}" 2>/dev/null || true
chmod 644 "${ENV_JS_PATH}" 2>/dev/null || true

echo "=== [DP-WMS] env.js 就绪 ==="
