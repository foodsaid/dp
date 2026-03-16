#!/bin/bash
# =============================================================================
# DP v0.1 — 批量导入 n8n 工作流
# 用法: ./scripts/import-workflows.sh [目录]
# =============================================================================

set -euo pipefail

WF_DIR="${1:-apps/wf}"
N8N_URL="${N8N_URL:-http://localhost:5678}"

# 优先使用 API Key (推荐), 降级到 Basic Auth
N8N_API_KEY="${N8N_API_KEY:-}"
N8N_USER="${N8N_BASIC_AUTH_USER:-admin}"
N8N_PASS="${N8N_BASIC_AUTH_PASSWORD:-}"

if [ -z "$N8N_API_KEY" ] && [ -z "$N8N_PASS" ]; then
    echo "❌ 请设置 N8N_API_KEY 或 N8N_BASIC_AUTH_PASSWORD"
    exit 1
fi

echo "=== DP 工作流批量导入 ==="
echo "目录: $WF_DIR"
echo "目标: $N8N_URL"
echo "认证: $([ -n "$N8N_API_KEY" ] && echo 'API Key' || echo 'Basic Auth')"

if [ ! -d "$WF_DIR" ]; then
    echo "❌ 目录不存在: $WF_DIR"
    exit 1
fi

count=0
errors=0

for f in "$WF_DIR"/*.json; do
    [ -f "$f" ] || continue
    name=$(basename "$f" .json)
    echo -n "📥 导入 $name... "

    # 构建认证参数 (API Key 优先, 降级 Basic Auth via .netrc 避免进程列表泄露)
    auth_args=()
    if [ -n "$N8N_API_KEY" ]; then
        auth_args+=(-H "X-N8N-API-KEY: $N8N_API_KEY")
    else
        auth_args+=(--netrc-file /dev/stdin)
    fi

    if [ -n "$N8N_API_KEY" ]; then
        response=$(curl -s -w "%{http_code}" \
            -X POST "$N8N_URL/api/v1/workflows" \
            -H "X-N8N-API-KEY: $N8N_API_KEY" \
            -H "Content-Type: application/json" \
            -d @"$f")
    else
        response=$(printf 'machine %s login %s password %s\n' \
            "$(echo "$N8N_URL" | sed 's|https\?://||;s|/.*||')" "$N8N_USER" "$N8N_PASS" | \
            curl -s -w "%{http_code}" \
            -X POST "$N8N_URL/api/v1/workflows" \
            --netrc-file /dev/stdin \
            -H "Content-Type: application/json" \
            -d @"$f")
    fi

    http_code="${response: -3}"
    if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
        echo "✅"
        count=$((count+1))
    else
        echo "❌ (HTTP $http_code)"
        errors=$((errors+1))
    fi
done

echo ""
echo "=== 导入完成: $count 成功, $errors 失败 ==="
