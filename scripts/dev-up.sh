#!/bin/bash
# =============================================================================
# DP 开发环境启动脚本 — 多平台 + 多 env 文件切换
# =============================================================================
# 用法:
#   bash scripts/dev-up.sh              # 默认使用 .env.uat (域名环境)
#   bash scripts/dev-up.sh --dev        # 使用 .env.dev (纯本地 localhost)
#   bash scripts/dev-up.sh --uat        # 使用 .env.uat (UAT 域名)
#   bash scripts/dev-up.sh --dev dp-wf  # 使用 .env.dev 且只重启 n8n
#   bash scripts/dev-up.sh --build      # 默认 .env.uat + 重新构建
#
# 三环境对照:
#   --dev  (.env.dev)  : WEBHOOK_URL=http://localhost:5678  (纯本地开发)
#   --uat  (.env.uat)  : WEBHOOK_URL=https://wf.example.com     (UAT 域名)
#   PROD (.env.prod)   : WEBHOOK_URL=https://wf.company.com (生产, 另机部署)
#
# 支持平台: WSL2 / macOS / Ubuntu / 其他 Linux
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# =============================================================================
# 平台检测
# =============================================================================
detect_platform() {
    if grep -qiE '(microsoft|wsl)' /proc/version 2>/dev/null; then
        echo "wsl2"
    elif [ "$(uname)" = "Darwin" ]; then
        echo "macos"
    else
        echo "linux"  # Ubuntu / Debian / CentOS / ...
    fi
}

PLATFORM=$(detect_platform)

# =============================================================================
# CPU 架构检测 → 自动设置依赖镜像
# =============================================================================
detect_cpu_arch() {
    case "$(uname -m)" in
        x86_64|amd64)  echo "amd64" ;;
        aarch64|arm64) echo "arm64" ;;
        *)             echo "$(uname -m)" ;;
    esac
}

CPU_ARCH=$(detect_cpu_arch)
# Grafana: arm64 用 grafana/grafana, amd64 用 grafana/grafana-oss (更轻量)
export DP_CPU_ARCH="$CPU_ARCH"
if [ -z "$DP_GRAFANA_IMAGE" ]; then
    if [ "$CPU_ARCH" = "arm64" ]; then
        export DP_GRAFANA_IMAGE="grafana/grafana:12.4.1"
    else
        export DP_GRAFANA_IMAGE="grafana/grafana-oss:12.4.1"
    fi
fi

# --- 解析 --dev / --uat 参数 ---
ENV_MODE="uat"  # 默认 UAT
COMPOSE_ARGS=()

for arg in "$@"; do
    case "$arg" in
        --dev)
            ENV_MODE="dev"
            ;;
        --uat)
            ENV_MODE="uat"
            ;;
        *)
            COMPOSE_ARGS+=("$arg")
            ;;
    esac
done

ENV_FILE="$PROJECT_DIR/.env.$ENV_MODE"

# --- 检查 env 文件是否存在 ---
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ 环境文件不存在: $ENV_FILE"
    echo ""
    echo "请先创建:"
    echo "  cp .env .env.$ENV_MODE"
    echo "  # 然后修改 WEBHOOK_URL / N8N_EDITOR_BASE_URL 等变量"
    echo ""
    echo "三环境模板:"
    echo "  .env.dev → WEBHOOK_URL=http://localhost:5678"
    echo "  .env.uat → WEBHOOK_URL=https://wf.example.com"
    exit 1
fi

# =============================================================================
# 预检: Docker 守护进程
# =============================================================================
if ! docker info &>/dev/null; then
    echo "❌ Docker is not running"
    echo "   请先启动 Docker Desktop 或 Docker 守护进程"
    exit 1
fi

# =============================================================================
# 预检: Docker 网络
# 从 env 文件读取网络名，不存在则自动创建
# =============================================================================
DOCKER_NETWORK=$(grep -E "^DP_DOCKER_NETWORK=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
DOCKER_NETWORK="${DOCKER_NETWORK:-n8network}"

if ! docker network inspect "$DOCKER_NETWORK" &>/dev/null; then
    echo "🔗 创建 Docker 网络: $DOCKER_NETWORK"
    docker network create "$DOCKER_NETWORK"
else
    echo "🔗 Docker 网络已就绪: $DOCKER_NETWORK"
fi

# =============================================================================
# 预检: 数据目录权限 (WSL2 / Linux bind-mount 兼容性)
# =============================================================================
DP_DATA_DIR=$(grep -E "^DP_DATA_DIR=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
DP_DATA_DIR="${DP_DATA_DIR:-./data}"

# 相对路径转绝对路径
if [[ "$DP_DATA_DIR" == ./* ]]; then
    DP_DATA_DIR="$PROJECT_DIR/${DP_DATA_DIR#./}"
fi

# 确保数据目录存在
if [ ! -d "$DP_DATA_DIR" ]; then
    echo "📁 创建数据目录: $DP_DATA_DIR"
    mkdir -p "$DP_DATA_DIR"
fi

# 平台特定的权限预检
case "$PLATFORM" in
    wsl2)
        echo "🖥️  平台: WSL2 (Windows)"
        echo "   ⚠️  bind-mount 文件权限受 Windows NTFS 限制"
        echo "   💡 建议 DP_DATA_DIR 使用 WSL 原生路径 (/home/...) 而非 /mnt/"
        # WSL2 上 /mnt/ 路径性能差且权限受限；/home/ 下的 ext4 文件系统更友好
        if [[ "$DP_DATA_DIR" == /mnt/* ]]; then
            echo "   ⚠️  检测到 Windows 盘路径 ($DP_DATA_DIR)，I/O 性能可能较低"
        fi
        ;;
    macos)
        echo "🖥️  平台: macOS (Docker Desktop)"
        # macOS Docker Desktop 默认共享 /Users, /tmp, /private, /var/folders
        if [[ "$DP_DATA_DIR" != /Users/* ]] && [[ "$DP_DATA_DIR" != /tmp/* ]] && [[ "$DP_DATA_DIR" != "$PROJECT_DIR"/* ]]; then
            echo "   ⚠️  数据目录 $DP_DATA_DIR 可能不在 Docker Desktop 文件共享列表中"
            echo "   💡 请确认: Docker Desktop → Settings → Resources → File Sharing"
        fi
        ;;
    linux)
        echo "🖥️  平台: Linux (Ubuntu / Debian / ...)"
        # Linux 原生 Docker: 确保数据目录当前用户可写
        if [ ! -w "$DP_DATA_DIR" ]; then
            echo "   ⚠️  数据目录无写权限: $DP_DATA_DIR"
            echo "   💡 修复: sudo chown -R \$(whoami) $DP_DATA_DIR"
        fi
        ;;
esac

# =============================================================================
# 预检: WMS 前端文件权限 (dev 模式 bind-mount 时需要)
# =============================================================================
WMS_DIR="$PROJECT_DIR/apps/wms"
if [ -d "$WMS_DIR" ] && [ "$PLATFORM" != "macos" ]; then
    # WSL2 / Linux: 确保 WMS 前端文件属于当前用户 (避免 git/docker 权限冲突)
    WMS_OWNER=$(stat -c '%U' "$WMS_DIR/shared.js" 2>/dev/null || echo "unknown")
    CURRENT_USER=$(whoami)
    if [ "$WMS_OWNER" != "$CURRENT_USER" ] && [ "$WMS_OWNER" != "unknown" ]; then
        echo "🔧 修复 WMS 前端文件权限 ($WMS_OWNER → $CURRENT_USER)..."
        sudo chown -R "$CURRENT_USER:$(id -gn)" "$WMS_DIR" 2>/dev/null || true
    fi
fi

# =============================================================================
# 预检: 监控卷权限 (profile: monitoring 启用时)
# =============================================================================
COMPOSE_PROFILES=$(grep -E "^COMPOSE_PROFILES=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
if [[ "${COMPOSE_PROFILES:-}" == *monitoring* ]] || [[ " ${COMPOSE_ARGS[*]} " == *"--profile monitoring"* ]]; then
    echo "📊 监控模式: 初始化数据卷权限..."
    mkdir -p "${DP_DATA_DIR}/grafana" "${DP_DATA_DIR}/prometheus" "${DP_DATA_DIR}/alertmanager"

    SUDO=""
    if [ "$(id -u)" != "0" ]; then SUDO="sudo"; fi

    $SUDO chown -R 472:472 "${DP_DATA_DIR}/grafana"
    $SUDO chown -R 65534:65534 "${DP_DATA_DIR}/prometheus"
    $SUDO chown -R 65534:65534 "${DP_DATA_DIR}/alertmanager"
    $SUDO chmod -R 775 "${DP_DATA_DIR}/grafana" "${DP_DATA_DIR}/prometheus" "${DP_DATA_DIR}/alertmanager"

    # Grafana 密码强制检查
    GRAFANA_PASS=$(grep -E "^DP_GRAFANA_ADMIN_PASSWORD=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
    if [ -z "${GRAFANA_PASS:-}" ]; then
        echo "❌ DP_GRAFANA_ADMIN_PASSWORD 未设置!"
        echo "   运行: openssl rand -base64 32"
        exit 1
    fi
fi

# =============================================================================
# 预检: SSO 用户文件 (profile: sso 启用时)
# =============================================================================
SSO_ENABLED=$(grep -E "^DP_SSO_ENABLED=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
if [ "${SSO_ENABLED:-false}" = "true" ] || [[ "${COMPOSE_PROFILES:-}" == *sso* ]] || [[ " ${COMPOSE_ARGS[*]} " == *"--profile sso"* ]]; then
    SSO_DIR="$PROJECT_DIR/infrastructure/sso"
    if [ ! -f "$SSO_DIR/users.yml" ]; then
        echo "🔒 SSO 模式: 从模板创建用户文件..."
        cp "$SSO_DIR/users.yml.example" "$SSO_DIR/users.yml"
        echo "   ⚠️  请编辑 infrastructure/sso/users.yml 设置用户密码哈希!"
        echo "   💡 生成密码: docker exec -it dp-sso authelia crypto hash generate argon2 --password 'YOUR_PASSWORD'"
    fi

    # SSO 密钥检查
    SSO_JWT=$(grep -E "^DP_SSO_JWT_SECRET=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
    SSO_REDIS_PASS=$(grep -E "^DP_SSO_REDIS_PASSWORD=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
    if [ -z "${SSO_JWT:-}" ] || [ -z "${SSO_REDIS_PASS:-}" ]; then
        echo "❌ SSO 密钥未设置! 请在 $ENV_FILE 中配置:"
        echo "   DP_SSO_JWT_SECRET=\$(openssl rand -base64 64)"
        echo "   DP_SSO_SESSION_SECRET=\$(openssl rand -base64 64)"
        echo "   DP_SSO_STORAGE_ENCRYPTION_KEY=\$(openssl rand -base64 64)"
        echo "   DP_SSO_REDIS_PASSWORD=\$(openssl rand -base64 32)"
        exit 1
    fi
fi

# --- 自动检测本地 IP (信息展示用) ---
detect_local_ip() {
    local ip=""
    # 方法1: hostname -I (Linux / WSL2)
    if command -v hostname &>/dev/null; then
        ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    fi
    # 方法2: ip route (Linux fallback)
    if [ -z "$ip" ] && command -v ip &>/dev/null; then
        ip=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
    fi
    # 方法3: ifconfig (macOS)
    if [ -z "$ip" ] && command -v ifconfig &>/dev/null; then
        ip=$(ifconfig 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | head -1 | awk '{print $2}')
    fi
    echo "${ip:-localhost}"
}

LOCAL_IP=$(detect_local_ip)

# --- 读取关键变量用于显示 ---
WEBHOOK_URL=$(grep -E "^WEBHOOK_URL=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
GATEWAY_PORT=$(grep -E "^DP_GATEWAY_PORT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
WF_PORT=$(grep -E "^DP_WF_PORT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
DB_PORT=$(grep -E "^DP_DB_PORT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
BI_PORT=$(grep -E "^DP_BI_PORT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)

echo ""
echo "🔧 环境模式: $ENV_MODE"
echo "📄 环境文件: .env.$ENV_MODE"
echo "🏗️  CPU 架构: $CPU_ARCH"
echo "🌐 本地 IP: $LOCAL_IP"
echo "🔗 WEBHOOK_URL: ${WEBHOOK_URL:-http://localhost:5678}"
echo ""

# --- 启动 Docker Compose ---
cd "$PROJECT_DIR"
echo "🚀 启动开发环境..."
docker compose --env-file ".env.$ENV_MODE" \
    -f docker-compose.yml \
    -f docker-compose.dev.yml \
    up -d "${COMPOSE_ARGS[@]}"

echo ""
echo "========================================="
echo "  DP 开发环境已启动 ($ENV_MODE · $PLATFORM)"
echo "========================================="
echo "  网关入口:  http://$LOCAL_IP:${GATEWAY_PORT:-8080}"
echo "  WMS 前端:  http://$LOCAL_IP:${GATEWAY_PORT:-8080}/wms/"
echo "  n8n 编辑:  http://localhost:${WF_PORT:-5678}"
echo "  BI 可视化: http://localhost:${BI_PORT:-8088}  (127.0.0.1 仅本机)"
echo "  PG 数据库: localhost:${DB_PORT:-5432}"
echo "-----------------------------------------"
echo "  Docker 网络: $DOCKER_NETWORK"
echo "  WEBHOOK_URL: ${WEBHOOK_URL:-http://localhost:5678}"
echo "========================================="
echo ""
echo "💡 切换环境: bash scripts/dev-up.sh --dev   # 纯本地"
echo "             bash scripts/dev-up.sh --uat   # UAT 域名"
