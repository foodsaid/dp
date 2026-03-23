#!/bin/bash
# =============================================================================
# DP — Let's Encrypt 自动续期 (cron 调用)
# =============================================================================
# 用法: crontab -e
#   0 3 1,15 * * /path/to/Digital-Platform/scripts/cert-renew.sh >> /var/log/dp-cert-renew.log 2>&1
#
# 逻辑:
#   1. certbot renew 读取 /etc/letsencrypt/renewal/*.conf (首次 certonly 时自动保存)
#   2. --deploy-hook 仅在证书实际续期时触发, 写 flag 到共享 volume
#   3. 主机脚本检测 flag, 验证 nginx 配置后热重载
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"

echo "$LOG_PREFIX cert-renew: 开始检查证书..."

# certbot renew 自动读取 /etc/letsencrypt/renewal/*.conf
# --deploy-hook: 仅在证书实际续期时触发, 写 flag 文件到共享 volume
# (deploy-hook 在 certbot 容器内执行, 容器内无 docker CLI, 故用 flag 文件)
docker compose $COMPOSE_FILES \
  --profile certbot run --rm dp-certbot \
  renew --quiet \
  --deploy-hook "touch /etc/letsencrypt/.renewed"

# 检查是否有证书被续期
RENEWED_FLAG="${DP_DATA_DIR:-./data}/certbot/.renewed"
if [ -f "$RENEWED_FLAG" ]; then
    rm -f "$RENEWED_FLAG"
    echo "$LOG_PREFIX cert-renew: 证书已续期, 准备重载 nginx..."

    # nginx 热重载 (先验证配置, 防止错误配置导致服务中断)
    if docker exec dp-gateway nginx -t 2>&1; then
        docker exec dp-gateway nginx -s reload
        echo "$LOG_PREFIX cert-renew: nginx 重载成功"
    else
        echo "$LOG_PREFIX cert-renew: nginx -t 验证失败! 跳过重载!" >&2
        echo "$LOG_PREFIX cert-renew: 请手动检查 nginx 配置并重载" >&2
        exit 1
    fi
else
    echo "$LOG_PREFIX cert-renew: 证书未到期, 无需续期"
fi
