# 监控栈部署经验教训 (Prometheus + Grafana + Alertmanager)

> **版本**: v2.0 (2026-03-10)
> **适用**: WSL2 Docker Desktop + profile: monitoring
> **来源**: v0.2.0 可观测性部署实战 (8 容器从零到生产 + 仪表板调试 + 镜像升级)

---

## 1. WSL2 Docker Desktop 权限模型 — 最大坑

### 问题
WSL2 Docker Desktop 对 **bind-mount 目录**的 UID/GID 处理有缺陷:
- `chown 65534:65534 /path` 后 `docker compose up`，目录被重置为 `root:root`
- `chmod 777` 也无效 — Docker 挂载时覆盖权限
- 导致 Prometheus (nobody:65534)、Alertmanager (nobody:65534)、Grafana (grafana:472) 全部报 `permission denied`

### 解决方案
**使用 Docker named volumes 替代 bind-mount**:
```yaml
# ❌ 错误 — WSL2 下权限不可控
volumes:
  - ${DP_DATA_DIR}/prometheus:/prometheus

# ✅ 正确 — Docker 管理权限
volumes:
  - dp_prometheus_data:/prometheus

# docker-compose.yml 底部声明
volumes:
  dp_prometheus_data:
  dp_alertmanager_data:
  dp_grafana_data:
```

### Grafana 额外注意
- **不要**设置 `user: "472"` — Grafana 官方 entrypoint 会自动处理权限
- Dashboard 配置文件挂载到 `/etc/grafana/dashboards:ro` (只读)

### 铁律
> **WSL2 环境下，除非目录由容器自身创建 (如 PG pgdata)，否则一律使用 Docker named volumes**

---

## 2. route-prefix / external-url 的连锁反应

### 问题
Prometheus 和 Alertmanager 通过 nginx 子路径 (`/prometheus/`、`/alertmanager/`) 暴露时，需要配置 route-prefix。但这会影响 **所有 HTTP 端点**，包括 `/metrics`。

### Prometheus 配置
```yaml
# docker-compose.yml
command:
  - '--web.external-url=/prometheus/'  # 同时设置 route-prefix 和重定向 base URL
  - '--config.file=/etc/prometheus/prometheus.yml'
  - '--storage.tsdb.path=/prometheus'
  - '--storage.tsdb.retention.time=15d'
```
- `--web.external-url=/prometheus/` **既设置 route-prefix 又正确生成重定向 URL**
- ⚠️ 不要用 `--web.route-prefix`，否则 Prometheus UI 内部重定向 (`/query` → `/prometheus/query`) 会失败

### Alertmanager 配置
```yaml
# docker-compose.yml
command:
  - '--web.route-prefix=/alertmanager/'  # Alertmanager 必须用 route-prefix
  - '--config.file=/etc/alertmanager/alertmanager.yml'
  - '--storage.path=/alertmanager'
```
- ⚠️ Alertmanager 的 `--web.external-url` **要求完整 URL (含 scheme)**，纯路径会报错
- 所以 Alertmanager 用 `--web.route-prefix`，Prometheus 用 `--web.external-url`

### 必须同步更新的 4 个位置
1. **prometheus.yml scrape_configs**: `metrics_path: /prometheus/metrics` 和 `/alertmanager/metrics`
2. **prometheus.yml alerting**: `path_prefix: /alertmanager`
3. **Grafana datasource prometheus.yml**: `url: http://dp-prometheus:9090/prometheus`
4. **Grafana datasource alertmanager.yml**: `url: http://dp-alertmanager:9093/alertmanager`

### 铁律
> **修改 route-prefix 后，必须检查并更新 scrape_configs、alerting、Grafana datasources 共 4 处**

---

## 3. 容器镜像标签约定差异

| 镜像 | 标签格式 | 示例 |
|------|---------|------|
| prom/prometheus | `v3.10.0-distroless` | 有 `v` 前缀 |
| prom/alertmanager | `v0.31.1` | 有 `v` 前缀 |
| prom/node-exporter | `v1.10.2` | 有 `v` 前缀 |
| ghcr.io/google/cadvisor | `0.56.2` | **无 `v` 前缀** ⚠️ |
| grafana/grafana | `12.4.1` | **无 `v` 前缀** (grafana-oss 已废弃) |
| oliver006/redis_exporter | `v1.82.0` | 有 `v` 前缀 |
| prometheuscommunity/postgres-exporter | `v0.19.1` | 有 `v` 前缀 |

### 铁律
> **拉取新版本前，先去 Docker Hub / GitHub 确认 tag 格式，不要假设 `v` 前缀**

---

## 4. PostgreSQL Exporter — DSN 格式选择

### 问题
密码包含 `/` 字符时，URI 格式 `postgresql://user:pass@host/db` 会被解析器误切割。

### 解决方案
**使用 keyword-value 格式 (libpq 格式)**:
```yaml
# ❌ 错误 — 密码含 / 会断裂
DATA_SOURCE_NAME: "postgresql://dp_monitor:Pa$$w0rd/With/Slashes@dp-db:5432/dp?sslmode=disable"

# ✅ 正确 — keyword-value 格式不受特殊字符影响
DATA_SOURCE_NAME: "host=dp-db port=5432 user=dp_monitor password=${DP_MONITOR_PASSWORD} dbname=${DP_DB_NAME:-dp} sslmode=disable"
```

### PG17 兼容性
- postgres-exporter **v0.16.0** 不支持 PG 17 (引用已移除的 `checkpoints_timed` 列)
- 必须使用 **v0.19.1+** (支持 PG 17 的 `pg_stat_checkpointer`)

---

## 5. WSL2 特有的 node-exporter 限制

### 问题
`/:/host:ro,rslave` 挂载在 WSL2 上不支持:
```
path / is mounted on / but it is not a shared or slave mount
```

### 解决方案
```yaml
# 移除根挂载，保留 proc/sys
volumes:
  - /proc:/host/proc:ro
  - /sys:/host/sys:ro
command:
  - '--path.procfs=/host/proc'
  - '--path.sysfs=/host/sys'
  - '--no-collector.filesystem'  # 禁用 filesystem 采集器
```

### 已知影响
以下告警规则和仪表板面板在 WSL2 环境下 **无数据** (生产环境原生 Linux 不受影响):
- 告警: `HostDiskSpaceHigh`、`HostInodeHigh`、`DiskWillFillIn4Hours`
- 仪表板: dp-overview 的"磁盘使用率" gauge

### 铁律
> **生产环境部署时，必须移除 `--no-collector.filesystem` 并恢复 `/:/host:ro,rslave` 挂载**

---

## 6. Redis Exporter — 最小镜像限制

### 问题
`oliver006/redis_exporter` 是极简镜像，不含 `wget`、`curl`、`nc` 等工具。

### 解决方案
**不配置 healthcheck** — 依赖 Prometheus scrape 状态判断健康:
```yaml
# ❌ 错误 — 镜像内无 wget
healthcheck:
  test: ["CMD", "wget", "--spider", "http://localhost:9121/metrics"]

# ✅ 正确 — 不配置 healthcheck，Prometheus target 状态即健康指标
```

---

## 7. nginx 优雅降级 (监控未启动时 503)

### 模式
使用变量 proxy_pass + Docker DNS resolver 延迟解析:
```nginx
resolver 127.0.0.11 valid=30s;

location /grafana/ {
    set $grafana http://dp-grafana:3000;
    proxy_pass $grafana;
    # ...
    error_page 502 503 = @monitoring_unavailable;
}

location @monitoring_unavailable {
    default_type application/json;
    return 503 '{"error":"monitoring service unavailable","hint":"docker compose --profile monitoring up -d"}';
}
```

- `set $var; proxy_pass $var;` 使 nginx 不在启动时解析 DNS → 监控容器不存在也能启动
- `error_page 502 503 = @named_location` 统一返回 JSON 提示

---

## 8. Grafana 跨大版本升级检查清单

### 升级前必查项
| 检查项 | 方法 | 危险信号 |
|--------|------|---------|
| Angular 面板 | 搜索 dashboard JSON `"type": "graph"` | Angular 面板在 12.x 被移除 |
| 注解迁移 | 检查 provisioning 是否使用自定义注解 | 迁移格式可能变化 |
| 数据源配置 | provisioning API 版本 | `apiVersion: 1` 跨版本稳定 |
| 环境变量 | `GF_*` 格式 | 极少数变量重命名 |
| 数据卷 | Docker named volume | SQLite DB 自动迁移 |
| `editors_can_admin` | 检查是否使用 | 11→12 行为变更 |
| 健康检查 | `/api/health` 端点 | 跨版本稳定 |

### 安全面板类型 (12.x 兼容)
`gauge`、`timeseries`、`stat`、`table`、`row` — 全部 React 原生面板

---

## 9. 部署顺序最佳实践

```
1. 创建监控专用 PG 账号 (dp_monitor, pg_monitor 权限)
2. 修改代码 (docker-compose.yml + 配置文件)
3. 初始化数据卷权限 (如用 bind-mount) / 声明 named volumes
4. 重启 nginx 网关 (加载监控路由 + 优雅降级)
5. 启动监控容器 (分批: 先 prometheus → 再 exporter → 最后 grafana)
6. 验证: Prometheus targets 全绿 → Grafana 仪表板正常 → 告警规则生效
```

### 验证命令
```bash
# Prometheus targets 状态
curl -s http://localhost:18080/prometheus/api/v1/targets | python3 -m json.tool | grep -E '"health"|"job"'

# Grafana 健康
curl -s http://localhost:18080/grafana/api/health

# 8/8 targets 全绿确认
curl -s http://localhost:18080/prometheus/api/v1/targets | python3 -c "
import json,sys
data=json.load(sys.stdin)
targets=data['data']['activeTargets']
up=[t for t in targets if t['health']=='up']
print(f'{len(up)}/{len(targets)} targets UP')
for t in targets:
    print(f\"  {t['labels'].get('job','?'):20s} {t['health']}\")
"
```

---

## 10. 镜像升级安全评估流程

```
1. 查看 GitHub releases / changelog
2. 检查 breaking changes (尤其是 CLI flags、API 端点、metrics 名称)
3. 逐项比对当前配置是否受影响
4. 小版本 (patch/minor) → 通常安全
5. 大版本 (major) → 必须逐项审计 (见 Grafana 升级检查清单)
6. 先改代码 → 重建单个容器 → 验证 → 再改下一个
```

---

## 11. Grafana Datasource UID — 仪表板引用锚点

### 问题
Grafana provisioning 不指定 `uid` 时，自动生成随机 UID (如 `PBFA97CFB590B2093`)。
仪表板 JSON 中面板的 `datasource.uid` 如果写死 `"prometheus"`，与自动生成的 UID 不匹配，导致**所有面板无数据** (数据源找不到)。

### 解决方案
**在 datasource provisioning YAML 中显式声明 uid**:
```yaml
# ✅ 正确 — 显式声明 uid，仪表板 JSON 引用此值
apiVersion: 1
datasources:
  - name: Prometheus
    uid: prometheus        # ← 必须与仪表板 JSON 中 datasource.uid 一致
    type: prometheus
    url: http://dp-prometheus:9090/prometheus

  - name: Alertmanager
    uid: alertmanager      # ← 同理
    type: alertmanager
    url: http://dp-alertmanager:9093/alertmanager
```

### ⚠️ 已有 Grafana 数据卷时修改 UID
如果 Grafana 已经初始化过 (数据卷非空)，修改 provisioning 中的 uid 会报错:
```
Datasource provisioning error: data source not found
```
**解决**: 必须删除 Grafana 数据卷重新初始化:
```bash
docker compose --profile monitoring stop dp-grafana
docker rm dp-grafana
docker volume rm dp_dp_grafana_data  # 卷名前缀取决于 compose project name
docker compose --profile monitoring up -d dp-grafana
```
> 所有仪表板都是文件 provisioned (`/etc/grafana/dashboards:ro`)，删卷不丢仪表板配置。

### 铁律
> **新建 Grafana 数据源时，provisioning YAML 必须显式指定 uid；仪表板 JSON 中所有 datasource.uid 必须与之完全一致**

---

## 12. Grafana 子路径部署 — ROOT_URL 不可为空

### 问题
Grafana 通过 nginx 子路径 `/grafana/` 暴露时，如果 `GF_SERVER_ROOT_URL` 为空:
- 登录重定向到 `/login` (缺少 `/grafana/` 前缀)
- nginx 将 `/login` 路由到默认后端 (如 BI)，用户看到的是 BI 登录页而非 Grafana

### 解决方案
```yaml
# docker-compose.yml
environment:
  GF_SERVER_ROOT_URL: ${DP_GRAFANA_ROOT_URL:-http://localhost:3000/grafana/}
  GF_SERVER_SERVE_FROM_SUB_PATH: "true"
```
- 默认值中的主机/端口不影响子路径行为，关键是 `/grafana/` 后缀
- 生产环境通过 `DP_GRAFANA_ROOT_URL=https://domain.com/grafana/` 覆盖

### 铁律
> **Grafana 走 nginx 子路径时，ROOT_URL 必须包含子路径后缀，否则所有重定向丢失前缀**

---

## 13. n8n Prometheus 指标 — stable 版可用指标有限

### 问题
n8n stable 版本 **不暴露** 以下常见指标:
- `n8n_workflow_execution_total` (不存在)
- `n8n_workflow_active_total` (不存在)
- `n8n_workflow_execution_duration_seconds_bucket` (不存在)

### 实际可用指标 (n8n stable)
```
n8n_active_workflow_count          # 活跃工作流数 (gauge)
n8n_process_cpu_seconds_total      # CPU (counter)
n8n_process_resident_memory_bytes  # RSS 内存 (gauge)
n8n_process_start_time_seconds     # 启动时间 (gauge, 用 time()-x 算运行时长)
n8n_process_open_fds / max_fds     # 文件描述符 (gauge)
n8n_nodejs_heap_size_used_bytes    # 堆已用 (gauge)
n8n_nodejs_heap_size_total_bytes   # 堆总量 (gauge)
n8n_nodejs_eventloop_lag_p50/p90/p99_seconds  # 事件循环延迟 (gauge)
n8n_nodejs_gc_duration_seconds_sum # GC 暂停 (summary)
n8n_nodejs_active_handles/resources # 活跃句柄 (gauge)
```

### 铁律
> **编写 n8n 仪表板前，先 `curl /metrics` 确认实际暴露的指标名，不要假设社区仪表板的查询可用**

---

## 14. postgres-exporter 指标命名 — 无 `_total` 后缀

### 问题
postgres-exporter v0.19.1 暴露的计数器指标 **不带 `_total` 后缀**:
```
pg_stat_database_xact_commit       # ✅ 实际名称
pg_stat_database_xact_commit_total # ❌ 不存在
pg_stat_database_xact_rollback     # ✅ 实际名称
pg_stat_database_blks_hit          # ✅ 实际名称 (也无 _total)
```

### 铁律
> **编写 PG 仪表板查询前，先在 Prometheus 中验证 `pg_stat_*` 的精确指标名，不要加 `_total` 后缀**
