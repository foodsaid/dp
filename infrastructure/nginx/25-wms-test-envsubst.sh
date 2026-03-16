#!/bin/sh
# =============================================================================
# DP — WMS 测试网关配置生成器
# =============================================================================
# 挂载到 dp-gateway 的 /docker-entrypoint.d/25-wms-test-envsubst.sh
# nginx 官方镜像在启动时自动执行 /docker-entrypoint.d/ 下的脚本
#
# 行为:
#   DP_WMS_TEST_DOMAIN 有值 → 生成 /etc/nginx/dynamic/wms-test.conf
#   DP_WMS_TEST_DOMAIN 为空 → 跳过 (不影响网关启动)
#
# 环境自适应:
#   ssl-params.conf 存在 (prod) → 生成 HTTP 301 跳转 + HTTPS:443
#   ssl-params.conf 不存在 (dev) → 仅生成 HTTP:80 (Tunnel 终止 TLS)
# =============================================================================

set -e

DYNAMIC_DIR="/etc/nginx/dynamic"
TEMPLATE="/etc/nginx/wms-test-gateway.conf.template"
OUTPUT="${DYNAMIC_DIR}/wms-test.conf"
SSL_PARAMS="/etc/nginx/conf.d/ssl-params.conf"

# 确保动态目录存在
mkdir -p "${DYNAMIC_DIR}"

if [ -n "${DP_WMS_TEST_DOMAIN}" ] && [ -f "${TEMPLATE}" ]; then
    if [ -f "${SSL_PARAMS}" ]; then
        # === 生产模式: 完整 HTTPS (ssl-params.conf 存在) ===
        envsubst '${DP_WMS_TEST_DOMAIN}' < "${TEMPLATE}" > "${OUTPUT}"
        echo "=== [DP-Gateway] WMS 测试网关已配置 (HTTPS): ${DP_WMS_TEST_DOMAIN} ==="
    else
        # === 开发模式: 仅 HTTP:80 (无 SSL 证书, Cloudflare Tunnel 终止 TLS) ===
        cat > "${OUTPUT}" <<CONF
# 自动生成 (DEV 模式, 无 SSL) — 请勿手动编辑
server {
    listen 80;
    server_name ${DP_WMS_TEST_DOMAIN};

    # Docker 内置 DNS, 运行时解析
    resolver 127.0.0.11 valid=10s ipv6=off;
    resolver_timeout 3s;
    set \$wms_test_backend http://dp-wms-test:80;

    error_page 502 504 = @wms_test_down;
    location @wms_test_down {
        default_type text/html;
        return 503 '<html><body style="font-family:sans-serif;text-align:center;padding:50px"><h1>WMS Test Not Running</h1><p><code>docker compose --profile test up -d dp-wms-test</code></p></body></html>';
    }

    location /api/wms/ {
        set \$wf_backend http://dp-wf:5678;
        rewrite ^/api/(.*)\$ /webhook/\$1 break;
        proxy_pass \$wf_backend;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_read_timeout 180s;
        proxy_send_timeout 180s;
    }

    location /api/webhook/ {
        set \$wf_backend http://dp-wf:5678;
        rewrite ^/api/(.*)\$ /\$1 break;
        proxy_pass \$wf_backend;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_read_timeout 180s;
        proxy_send_timeout 180s;
    }

    location /api/webhook-test/ {
        set \$wf_backend http://dp-wf:5678;
        rewrite ^/api/(.*)\$ /\$1 break;
        proxy_pass \$wf_backend;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_read_timeout 180s;
        proxy_send_timeout 180s;
    }

    location / {
        proxy_pass \$wms_test_backend;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_intercept_errors on;
        proxy_connect_timeout 3s;
        proxy_read_timeout 60s;
    }
}
CONF
        echo "=== [DP-Gateway] WMS 测试网关已配置 (HTTP): ${DP_WMS_TEST_DOMAIN} ==="
    fi
else
    # 清理残留 (域名移除后不留旧配置)
    rm -f "${OUTPUT}"
    echo "=== [DP-Gateway] WMS 测试网关未配置 (DP_WMS_TEST_DOMAIN 为空) ==="
fi
