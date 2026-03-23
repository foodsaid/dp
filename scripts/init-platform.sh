#!/bin/bash
# =============================================================================
# DP v0.1 — 平台首次初始化
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "============================================"
echo "  DP — Digital Platform 初始化"
echo "============================================"

# 检查 .env
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo "⚠️  .env 文件不存在，从模板创建..."
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    echo "📝 请修改 .env 中的密码和 SAP 连接参数后重新运行"
    exit 1
fi

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装"
    exit 1
fi

if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose 未安装"
    exit 1
fi

echo ""
echo "🚀 启动 DP 平台 (开发环境)..."
cd "$PROJECT_DIR"
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

echo ""
echo "⏳ 等待服务就绪..."
sleep 10

# 健康检查
echo ""
echo "🏥 健康检查..."
bash "$SCRIPT_DIR/health-check.sh"

echo ""
echo "============================================"
echo "  DP 平台初始化完成!"
echo "============================================"
echo ""
echo "  WMS:    http://localhost:8080/"
echo "  工作流: http://localhost:8080/wf/"
echo "  BI:     http://localhost:8080/bi/"
echo "  API:    http://localhost:8080/api/wms/dashboard"
echo "  PG:     localhost:5432"
echo ""
