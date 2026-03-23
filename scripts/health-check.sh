#!/bin/bash
# =============================================================================
# DP v0.4 — 容器健康检查 (8 核心 + 6 可选 + 10 监控)
# =============================================================================

set -e

echo "=== DP 健康检查 ==="

errors=0
containers="dp-db dp-cache-wf dp-cache-bi dp-wms-web dp-wf dp-bi dp-gateway"

for c in $containers; do
    status=$(docker inspect --format='{{.State.Health.Status}}' "$c" 2>/dev/null || echo "not_found")
    case "$status" in
        healthy)
            echo "✅ $c: healthy"
            ;;
        unhealthy)
            echo "❌ $c: unhealthy"
            errors=$((errors+1))
            ;;
        starting)
            echo "⏳ $c: starting"
            ;;
        not_found)
            echo "⚠️  $c: 未运行"
            errors=$((errors+1))
            ;;
        *)
            echo "❓ $c: $status"
            ;;
    esac
done

# dp-wf-worker: queue 模式 worker (v0.4+, regular 模式不需要)
echo ""
echo "--- Queue Worker ---"
worker_status=$(docker inspect --format='{{.State.Health.Status}}' dp-wf-worker 2>/dev/null || echo "not_found")
case "$worker_status" in
    healthy)
        echo "✅ dp-wf-worker: healthy"
        ;;
    unhealthy)
        echo "❌ dp-wf-worker: unhealthy"
        errors=$((errors+1))
        ;;
    starting)
        echo "⏳ dp-wf-worker: starting"
        ;;
    not_found)
        echo "⚠️  dp-wf-worker: 未运行 (仅 queue 模式需要)"
        ;;
    *)
        echo "❓ dp-wf-worker: $worker_status"
        ;;
esac

# 可选容器 (按 profile 启停，未运行不算异常)
echo ""
echo "--- 可选容器 ---"

# dp-tunnel: 仅生产环境 (profile: production)
tunnel_status=$(docker inspect --format='{{.State.Status}}' dp-tunnel 2>/dev/null || echo "not_found")
if [ "$tunnel_status" = "running" ]; then
    echo "✅ dp-tunnel: running (生产)"
else
    echo "ℹ️  dp-tunnel: 未启动 (profile: production)"
fi

# dp-wms-test: 测试环境 (profile: test)
wms_test_status=$(docker inspect --format='{{.State.Status}}' dp-wms-test 2>/dev/null || echo "not_found")
if [ "$wms_test_status" = "running" ]; then
    echo "✅ dp-wms-test: running (测试)"
else
    echo "ℹ️  dp-wms-test: 未启动 (profile: test)"
fi

# dp-certbot: 证书管理 (profile: certbot)
certbot_status=$(docker inspect --format='{{.State.Status}}' dp-certbot 2>/dev/null || echo "not_found")
if [ "$certbot_status" = "running" ]; then
    echo "✅ dp-certbot: running (证书管理)"
else
    echo "ℹ️  dp-certbot: 未启动 (profile: certbot)"
fi

# dp-dns: Split DNS (profile: dns)
dns_status=$(docker inspect --format='{{.State.Status}}' dp-dns 2>/dev/null || echo "not_found")
if [ "$dns_status" = "running" ]; then
    echo "✅ dp-dns: running (Split DNS)"
else
    echo "ℹ️  dp-dns: 未启动 (profile: dns)"
fi

# --- SSO 容器 (profile: sso) ---
echo ""
echo "--- SSO 容器 (profile: sso) ---"
sso_containers="dp-sso dp-cache-sso"
sso_found=false

for sc in $sso_containers; do
    sc_status=$(docker inspect --format='{{.State.Status}}' "$sc" 2>/dev/null || echo "not_found")
    if [ "$sc_status" = "not_found" ]; then
        continue
    fi
    sso_found=true
    hc_status=$(docker inspect --format='{{.State.Health.Status}}' "$sc" 2>/dev/null || echo "none")
    case "$hc_status" in
        healthy)
            echo "✅ $sc: healthy"
            ;;
        unhealthy)
            echo "❌ $sc: unhealthy"
            errors=$((errors+1))
            ;;
        starting)
            echo "⏳ $sc: starting"
            ;;
        none|"")
            if [ "$sc_status" = "running" ]; then
                echo "✅ $sc: running"
            else
                echo "❌ $sc: $sc_status"
                errors=$((errors+1))
            fi
            ;;
    esac
done

if [ "$sso_found" = false ]; then
    echo "ℹ️  SSO 未启用 (docker compose --profile sso up -d)"
fi

# --- 监控容器 (profile: monitoring) ---
echo ""
echo "--- 监控容器 (profile: monitoring) ---"
monitoring_containers="dp-prometheus dp-alertmanager dp-grafana dp-node-exporter dp-cadvisor dp-pg-exporter dp-redis-exporter-wf dp-redis-exporter-bi dp-loki dp-alloy"
monitoring_found=false

for mc in $monitoring_containers; do
    mc_status=$(docker inspect --format='{{.State.Status}}' "$mc" 2>/dev/null || echo "not_found")
    if [ "$mc_status" = "not_found" ]; then
        continue
    fi
    monitoring_found=true
    # 有 healthcheck 的容器检查健康状态
    hc_status=$(docker inspect --format='{{.State.Health.Status}}' "$mc" 2>/dev/null || echo "none")
    case "$hc_status" in
        healthy)
            echo "✅ $mc: healthy"
            ;;
        unhealthy)
            echo "❌ $mc: unhealthy"
            errors=$((errors+1))
            ;;
        starting)
            echo "⏳ $mc: starting"
            ;;
        none|"")
            # 无 healthcheck 的容器 (prometheus/alertmanager/node-exporter) 检查运行状态
            if [ "$mc_status" = "running" ]; then
                echo "✅ $mc: running"
            else
                echo "❌ $mc: $mc_status"
                errors=$((errors+1))
            fi
            ;;
    esac
done

if [ "$monitoring_found" = false ]; then
    echo "ℹ️  监控未启用 (docker compose --profile monitoring up -d)"
fi

echo ""
if [ $errors -gt 0 ]; then
    echo "❌ 有 $errors 个服务异常"
    exit 1
else
    echo "✅ 所有服务正常"
fi
