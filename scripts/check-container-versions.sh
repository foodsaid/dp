#!/usr/bin/env bash
# =============================================================================
# DP 容器镜像版本检查工具
# 用途: 对比本地运行版本 vs Docker Hub/Registry 最新版本
#       检测可升级镜像，输出兼容性风险等级
#
# 用法:
#   bash scripts/check-container-versions.sh           # 检查所有镜像
#   bash scripts/check-container-versions.sh --json    # JSON 输出 (供 CI 使用)
# =============================================================================

set -uo pipefail

# --- 颜色定义 ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# --- 配置 ---
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
JSON_MODE=false

[[ "${1:-}" == "--json" ]] && JSON_MODE=true

# --- 镜像注册表 ---
# 格式: "compose中的image|注册表类型|仓库路径|版本过滤正则|架构要求|风险备注"
# 注册表类型: dockerhub / ghcr / quay
# 版本过滤: 用于从 tags 中筛选稳定版本的正则 (排除 rc/beta/alpha/sha)
declare -a IMAGE_REGISTRY=(
    "pgvector/pgvector:pg17|dockerhub|pgvector/pgvector|^pg[0-9]+$|amd64,arm64|PostgreSQL 主版本升级需完整迁移"
    "redis:7.4-alpine|dockerhub|library/redis|^[0-9]+\.[0-9]+-alpine$|amd64,arm64|次版本安全，主版本需检查持久化格式"
    "n8nio/n8n:stable|dockerhub|n8nio/n8n|^[0-9]+\.[0-9]+\.[0-9]+$|amd64,arm64|浮动标签; 检查 CHANGELOG 和数据库迁移"
    "apache/superset:latest|dockerhub|apache/superset|^[0-9]+\.[0-9]+\.[0-9]+$|amd64|浮动标签! 仅 amd64; 自定义 Dockerfile 需重建"
    "nginx:stable-alpine|dockerhub|library/nginx|^[0-9]+\.[0-9]+-alpine$|amd64,arm64|浮动标签; 通常安全"
    "cloudflare/cloudflared:latest|dockerhub|cloudflare/cloudflared|^[0-9]+\.[0-9]+\.[0-9]+$|amd64,arm64|浮动标签; API 稳定"
    "authelia/authelia:4.39.16|dockerhub|authelia/authelia|^v?[0-9]+\.[0-9]+\.[0-9]+$|amd64,arm64|配置格式偶有变更，检查 breaking changes"
    "prom/prometheus:v3.10.0-distroless|dockerhub|prom/prometheus|^v[0-9]+\.[0-9]+\.[0-9]+-distroless$|amd64,arm64|distroless 无 shell; 告警规则语法偶有变更"
    "prom/alertmanager:v0.31.1|dockerhub|prom/alertmanager|^v[0-9]+\.[0-9]+\.[0-9]+$|amd64,arm64|配置格式稳定"
    "grafana/grafana-oss:12.4.1|dockerhub|grafana/grafana-oss|^[0-9]+\.[0-9]+\.[0-9]+$|amd64,arm64|注意 grafana vs grafana-oss 区别; 插件 API 偶有变更"
    "prom/node-exporter:v1.10.2|dockerhub|prom/node-exporter|^v[0-9]+\.[0-9]+\.[0-9]+$|amd64,arm64|指标名称偶有变更，影响仪表盘"
    "ghcr.io/google/cadvisor:0.56.2|ghcr|google/cadvisor|^v?[0-9]+\.[0-9]+\.[0-9]+$|amd64,arm64|旧 gcr.io 已弃用，用 ghcr.io"
    "prometheuscommunity/postgres-exporter:v0.19.1|dockerhub|prometheuscommunity/postgres-exporter|^v[0-9]+\.[0-9]+\.[0-9]+$|amd64,arm64|指标名称偶有变更"
    "oliver006/redis_exporter:v1.82.0|dockerhub|oliver006/redis_exporter|^v[0-9]+\.[0-9]+\.[0-9]+$|amd64,arm64|稳定"
    "grafana/loki:3.6.7|dockerhub|grafana/loki|^[0-9]+\.[0-9]+\.[0-9]+$|amd64,arm64|存储格式版本注意; distroless 无 shell"
    "grafana/alloy:v1.14.1|dockerhub|grafana/alloy|^v[0-9]+\.[0-9]+\.[0-9]+$|amd64,arm64|配置语法偶有变更 (River → Alloy HCL)"
)

# --- 函数: 从 Docker Hub 获取最新 tag ---
get_latest_dockerhub_tag() {
    local repo="$1"
    local filter_regex="$2"

    # Docker Hub API v2 — 获取前 3 页 (最多 300 个 tag)
    local tags=""
    local url="https://hub.docker.com/v2/repositories/${repo}/tags?page_size=100&ordering=last_updated"
    local page=0

    while [[ -n "$url" && "$url" != "null" ]] && (( page < 5 )); do
        ((page++)) || true
        local page_result
        page_result=$(curl -s --max-time 10 "$url" 2>/dev/null) || break

        local page_tags
        page_tags=$(echo "$page_result" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for r in data.get('results', []):
        if r.get('name'):
            print(r['name'])
except:
    pass
" 2>/dev/null) || true

        if [[ -n "$page_tags" ]]; then
            tags="${tags}${tags:+$'\n'}${page_tags}"
        fi

        # 检查是否有下一页
        url=$(echo "$page_result" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('next') or '')
except:
    print('')
" 2>/dev/null) || break
    done

    # 过滤后语义版本排序
    local filtered
    filtered=$(echo "$tags" | grep -E "$filter_regex" 2>/dev/null) || true

    if [[ -z "$filtered" ]]; then
        echo "FETCH_ERROR"
        return
    fi

    echo "$filtered" | python3 -c "
import sys, re
lines = [l.strip() for l in sys.stdin if l.strip()]
def semver_key(t):
    m = re.search(r'(\d+)\.(\d+)(?:\.(\d+))?', t)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))
    nums = re.findall(r'\d+', t)
    return tuple(int(n) for n in nums) if nums else (0,)
lines.sort(key=semver_key, reverse=True)
if lines:
    print(lines[0])
" 2>/dev/null || echo "FETCH_ERROR"
    return
}

# --- 函数: 从 GHCR 获取最新 tag ---
get_latest_ghcr_tag() {
    local repo="$1"
    local filter_regex="$2"

    # GHCR 需要 token
    local token
    token=$(curl -s "https://ghcr.io/token?scope=repository:${repo}:pull" 2>/dev/null | \
        python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null) || true

    if [[ -z "$token" ]]; then
        echo "FETCH_ERROR"
        return
    fi

    local tags
    tags=$(curl -s --max-time 10 -H "Authorization: Bearer $token" \
        "https://ghcr.io/v2/${repo}/tags/list" 2>/dev/null | \
        python3 -c "
import sys, json, re
try:
    data = json.load(sys.stdin)
    tags = data.get('tags', [])
    def semver_key(t):
        m = re.search(r'(\d+)\.(\d+)(?:\.(\d+))?', t)
        if m:
            return (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))
        nums = re.findall(r'\d+', t)
        return tuple(int(n) for n in nums) if nums else (0,)
    tags = sorted(tags, key=semver_key, reverse=True)
    for t in tags:
        print(t)
except:
    pass
" 2>/dev/null) || true

    if [[ -z "$tags" ]]; then
        echo "FETCH_ERROR"
        return
    fi

    echo "$tags" | grep -E "$filter_regex" | head -1
}

# --- 函数: 提取当前版本号 ---
extract_current_version() {
    local image_spec="$1"
    echo "${image_spec##*:}"
}

# --- 函数: 判断升级风险等级 ---
assess_risk() {
    local current="$1"
    local latest="$2"
    local notes="$3"

    # 浮动标签无法比较
    if [[ "$current" == "latest" || "$current" == "stable" || "$current" == "stable-alpine" ]]; then
        echo "FLOATING"
        return
    fi

    # 去除版本前缀 v
    local cur_clean="${current#v}"
    local lat_clean="${latest#v}"

    # 去除后缀 (-alpine, -distroless 等) 进行比较
    local cur_base lat_base
    cur_base=$(echo "$cur_clean" | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+' 2>/dev/null || echo "$cur_clean")
    lat_base=$(echo "$lat_clean" | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+' 2>/dev/null || echo "$lat_clean")

    if [[ "$cur_base" == "$lat_base" ]]; then
        echo "UP_TO_DATE"
        return
    fi

    # 提取主版本.次版本.补丁
    IFS='.' read -r cur_major cur_minor cur_patch <<< "$cur_base"
    IFS='.' read -r lat_major lat_minor lat_patch <<< "$lat_base"

    # 处理非数字版本 (如 pg17)
    if [[ ! "$cur_major" =~ ^[0-9]+$ ]] || [[ ! "$lat_major" =~ ^[0-9]+$ ]]; then
        echo "MANUAL_CHECK"
        return
    fi

    if (( lat_major > cur_major )); then
        echo "HIGH"
    elif (( lat_minor > cur_minor )); then
        echo "MEDIUM"
    elif (( lat_patch > cur_patch )); then
        echo "LOW"
    else
        echo "UP_TO_DATE"
    fi
}

# --- 函数: 风险等级颜色 ---
risk_color() {
    case "$1" in
        UP_TO_DATE)    echo "${GREEN}已是最新${NC}" ;;
        LOW)           echo "${GREEN}低 (补丁)${NC}" ;;
        MEDIUM)        echo "${YELLOW}中 (次版本)${NC}" ;;
        HIGH)          echo "${RED}高 (主版本)${NC}" ;;
        FLOATING)      echo "${CYAN}浮动标签${NC}" ;;
        MANUAL_CHECK)  echo "${YELLOW}需手动检查${NC}" ;;
        FETCH_ERROR)   echo "${RED}获取失败${NC}" ;;
        *)             echo "${YELLOW}未知${NC}" ;;
    esac
}

# --- 主逻辑 ---
main() {
    cd "$PROJECT_DIR" || exit 1

    if ! command -v curl &>/dev/null; then
        echo "错误: 需要 curl" >&2
        exit 1
    fi

    if ! command -v python3 &>/dev/null; then
        echo "错误: 需要 python3" >&2
        exit 1
    fi

    local total=0
    local upgradable=0
    local floating=0
    local errors=0
    local json_results=()

    if ! $JSON_MODE; then
        echo ""
        echo -e "${BLUE}═══════════════════════════════════════════════════════════════════${NC}"
        echo -e "${BLUE}  DP 容器镜像版本检查  $(date '+%Y-%m-%d %H:%M:%S')${NC}"
        echo -e "${BLUE}═══════════════════════════════════════════════════════════════════${NC}"
        echo ""
        printf "%-30s %-22s %-22s %-18s %s\n" "镜像" "当前版本" "最新版本" "风险等级" "备注"
        printf "%-30s %-22s %-22s %-18s %s\n" "-----" "--------" "--------" "--------" "----"
    fi

    for entry in "${IMAGE_REGISTRY[@]}"; do
        IFS='|' read -r image_spec registry_type repo filter_regex arch_req notes <<< "$entry"
        ((total++)) || true

        # 提取当前版本
        local current_tag
        current_tag=$(extract_current_version "$image_spec")

        # 获取最新版本
        local latest_tag
        case "$registry_type" in
            dockerhub) latest_tag=$(get_latest_dockerhub_tag "$repo" "$filter_regex") ;;
            ghcr)      latest_tag=$(get_latest_ghcr_tag "$repo" "$filter_regex") ;;
            *)         latest_tag="UNSUPPORTED_REGISTRY" ;;
        esac

        local risk
        if [[ -z "$latest_tag" || "$latest_tag" == "FETCH_ERROR" ]]; then
            latest_tag="获取失败"
            ((errors++)) || true
            risk="FETCH_ERROR"
        else
            risk=$(assess_risk "$current_tag" "$latest_tag" "$notes") || risk="MANUAL_CHECK"
        fi

        case "$risk" in
            LOW|MEDIUM|HIGH) ((upgradable++)) || true ;;
            FLOATING) ((floating++)) || true ;;
        esac

        # 提取短镜像名
        local short_name
        short_name=$(echo "$image_spec" | sed 's/:.*$//' | sed 's|.*/||')

        if $JSON_MODE; then
            json_results+=("{\"image\":\"$image_spec\",\"current\":\"$current_tag\",\"latest\":\"$latest_tag\",\"risk\":\"$risk\",\"arch\":\"$arch_req\",\"notes\":\"$notes\"}")
        else
            printf "%-30s %-22s %-22s " "$short_name" "$current_tag" "$latest_tag"
            echo -e "$(risk_color "$risk")"
        fi
    done

    if $JSON_MODE; then
        echo "{\"timestamp\":\"$(date -Iseconds)\",\"total\":$total,\"upgradable\":$upgradable,\"floating\":$floating,\"errors\":$errors,\"results\":[$(IFS=,; echo "${json_results[*]}")]}"
    else
        echo ""
        echo -e "${BLUE}───────────────────────────────────────────────────────────────────${NC}"
        echo -e "  总计: ${total} 个镜像  |  ${GREEN}可升级: ${upgradable}${NC}  |  ${CYAN}浮动标签: ${floating}${NC}  |  ${RED}获取失败: ${errors}${NC}"
        echo -e "${BLUE}───────────────────────────────────────────────────────────────────${NC}"

        if (( floating > 0 )); then
            echo ""
            echo -e "${YELLOW}⚠ 浮动标签建议: latest/stable 标签不可控，建议固定为精确版本${NC}"
            echo -e "  当前浮动标签: apache/superset:latest, n8nio/n8n:stable, nginx:stable-alpine, cloudflared:latest"
        fi
        echo ""
    fi
}

main "$@"
