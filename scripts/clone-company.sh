#!/bin/bash
# =============================================================================
# DP v0.1 — 新客户复制脚本
# 用法: ./scripts/clone-company.sh CLIENT002 client002.example.com
# =============================================================================

set -e

COMPANY_CODE="${1:?用法: $0 <COMPANY_CODE> [DOMAIN]}"
DOMAIN="${2:-}"

# 安全: 输入验证 (防 sed/shell 注入)
if [[ ! "$COMPANY_CODE" =~ ^[a-zA-Z0-9_-]{1,20}$ ]]; then
    echo "❌ COMPANY_CODE 只能包含字母、数字、下划线和连字符 (最长20字符)"
    exit 1
fi
if [[ -n "$DOMAIN" && ! "$DOMAIN" =~ ^[a-zA-Z0-9._-]+$ ]]; then
    echo "❌ DOMAIN 只能包含字母、数字、点、下划线和连字符"
    exit 1
fi

echo "============================================"
echo "  DP — 新客户复制: $COMPANY_CODE"
echo "============================================"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TARGET_DIR="$PROJECT_DIR/../dp-$COMPANY_CODE"

if [ -d "$TARGET_DIR" ]; then
    echo "❌ 目录已存在: $TARGET_DIR"
    exit 1
fi

echo "📋 复制项目模板..."
cp -r "$PROJECT_DIR" "$TARGET_DIR"

# 移除 git 历史 (新部署)
rm -rf "$TARGET_DIR/.git"

# 创建 .env
cp "$TARGET_DIR/.env.example" "$TARGET_DIR/.env"

# 跨平台 sed -i (macOS BSD sed 需要 -i ''，GNU sed 用 -i)
sedi() { local f="${*: -1}"; sed -i.bak "$@" && rm -f "${f}.bak"; }

# 替换 company_code
sedi "s/DP_COMPANY_CODE=DEFAULT/DP_COMPANY_CODE=$COMPANY_CODE/" "$TARGET_DIR/.env"
sedi "s/DP_COMPANY_NAME=Digital Platform/DP_COMPANY_NAME=$COMPANY_CODE/" "$TARGET_DIR/.env"

if [ -n "$DOMAIN" ]; then
    echo "🌐 配置域名: $DOMAIN"
    # APP_BASE_URL 默认为空 (相对路径)，设置为完整域名
    sedi "s|^APP_BASE_URL=.*|APP_BASE_URL=https://$DOMAIN|" "$TARGET_DIR/.env"
    # API_BASE_URL 默认为 /api/wms (相对路径)，设置为完整域名
    sedi "s|^API_BASE_URL=.*|API_BASE_URL=https://$DOMAIN/api/wms|" "$TARGET_DIR/.env"
    # WEBHOOK_URL 默认 http://localhost:5678，设置为 wf 子域名
    sedi "s|^WEBHOOK_URL=.*|WEBHOOK_URL=https://wf.$DOMAIN|" "$TARGET_DIR/.env"
    # N8N_EDITOR_BASE_URL 默认 http://localhost:5678/，设置为 wf 子域名
    sedi "s|^N8N_EDITOR_BASE_URL=.*|N8N_EDITOR_BASE_URL=https://wf.$DOMAIN/|" "$TARGET_DIR/.env"
fi

echo ""
echo "✅ 新客户环境已创建: $TARGET_DIR"
echo ""
echo "下一步:"
echo "  cd $TARGET_DIR"
echo "  vim .env          # 修改密码和 SAP 连接参数"
echo "  bash scripts/init-platform.sh"
