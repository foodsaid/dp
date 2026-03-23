# 监控栈部署经验教训 (Prometheus + Grafana + Alertmanager + Loki + Alloy)

> **版本**: v4.0 (2026-03-17)
> **适用**: WSL2 Docker Desktop / macOS Docker Desktop + profile: monitoring
> **来源**: v0.2.0 可观测性部署 + v0.3.3 Loki 日志聚合部署实战

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

## 13-B. n8n Queue 模式监控 (v0.4+)

### 架构变更
- `dp-wf` (main): 路由 + 入队，不执行工作流
- `dp-wf-worker`: 消费 Redis Bull 队列执行工作流
- **若所有 worker 宕机，任务在 Redis 无限堆积 (main 不会自动降级执行)**

### Prometheus 采集配置
```yaml
# prometheus.yml — n8n job 需采集两个 target
- job_name: 'n8n'
  metrics_path: /metrics
  static_configs:
    - targets: ['dp-wf:5678']
      labels:
        role: 'main'
    - targets: ['dp-wf-worker:5678']
      labels:
        role: 'worker'
```

### Queue 模式新增指标
```
n8n_scaling_mode_queue_jobs_waiting   # 队列中等待的任务数
n8n_scaling_mode_queue_jobs_active    # 正在执行的任务数
n8n_scaling_mode_queue_jobs_completed # 已完成的任务数
n8n_scaling_mode_queue_jobs_failed    # 失败的任务数
```

### 3 条新告警规则 (dp-alerts.yml)
| 告警 | 条件 | 严重度 | 说明 |
|------|------|--------|------|
| `N8nQueueBacklog` | `waiting > 50` 持续 5m | warning | 队列积压，考虑增加 worker |
| `N8nWorkerDown` | `up{role="worker"} == 0` 持续 2m | critical | Worker 离线，任务将无限堆积 |
| `N8nQueueFailedJobs` | `increase(failed[5m]) > 5` | warning | 失败任务激增 |

### Worker healthcheck 注意事项
- n8n v1.97+ worker 可能不监听 HTTP 端口 (issue #16900)
- 使用进程级检查: `pgrep -f 'n8n worker' || exit 1`
- Prometheus 采集可能因 HTTP 端口未监听而返回 `up=0`，需关注实际版本行为

### 铁律
> **Worker 宕机是 critical 级别 — main 不会自动降级执行，必须确保 worker 始终在线**

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

---

## 15. Loki 3.x Distroless 镜像 — 无 Shell、无工具

### 问题
`grafana/loki:3.6.7` 是 distroless 镜像:
- 没有 `/bin/sh` → `CMD-SHELL` 健康检查直接报 `exec: "/bin/sh": stat /bin/sh: no such file or directory`
- 没有 `wget`、`curl`、`nc` 等网络工具 → `CMD wget` 也失败
- 唯一可用的二进制: `/usr/bin/loki`

### 解决方案
**使用 `CMD` 模式 + `/usr/bin/loki --version` 作为存活检查**:
```yaml
# ❌ 错误 — distroless 无 shell
healthcheck:
  test: ["CMD-SHELL", "wget -qO- http://localhost:3100/ready || exit 1"]

# ❌ 错误 — distroless 无 wget
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://localhost:3100/ready"]

# ✅ 正确 — 只依赖 loki 二进制本身
healthcheck:
  test: ["CMD", "/usr/bin/loki", "--version"]
  interval: 30s
  timeout: 5s
  retries: 5
  start_period: 15s
```

### 铁律
> **Grafana 系列 distroless 镜像 (Loki 3.x) 只有主程序二进制，healthcheck 必须用 CMD 模式调用自身，不能依赖 shell 或外部工具**

---

## 16. Alloy 日志采集 — 必须显式添加 job 标签

### 问题
Grafana Alloy 通过 `discovery.docker` 采集日志时，默认只生成 `compose_service`、`container`、`compose_project` 等标签，**不会自动添加 `job` 标签**。
仪表板查询使用 `{job="docker"}` 过滤时，所有面板返回 No data。

### 解决方案
**在 `discovery.relabel` 规则中显式添加 `job` 标签**:
```alloy
discovery.relabel "containers" {
  targets = discovery.docker.containers.targets

  // ... 其他 relabel 规则 ...

  // 添加 job 标签 (仪表板查询依赖)
  rule {
    target_label = "job"
    replacement  = "docker"
  }
}
```

### 铁律
> **Alloy relabel 规则必须显式添加 `job` 标签，确保与仪表板 LogQL 查询中的 `{job="docker"}` 匹配**

---

## 17. LogQL 语法陷阱 — count_over_time 不支持 by 分组

### 问题
Loki LogQL 的 `count_over_time` 是**日志范围聚合函数**，不支持直接 `by` 分组:
```logql
# ❌ 错误 — parse error: grouping not allowed for count_over_time aggregation
count(count_over_time({job="docker"}[5m]) by (compose_service))
```

### 解决方案
**先用 `sum by` 做指标聚合，再用 `count` 计数**:
```logql
# ✅ 正确 — 先按标签分组聚合，再 count
count(sum by (compose_service) (count_over_time({job="docker"}[5m])))
```

### LogQL vs PromQL 区别
- **PromQL**: `count by (label) (metric)` → by 在外层聚合函数上
- **LogQL**: `count_over_time({...}[5m])` → 范围聚合不能带 by，必须外层包裹 `sum by`

### 铁律
> **LogQL `count_over_time`/`bytes_over_time` 等范围聚合函数不支持 by 分组，必须用外层 `sum by` / `count` 组合实现**

---

## 18. Grafana 镜像选择 — grafana vs grafana-oss

### 问题
`grafana/grafana` 和 `grafana/grafana-oss` 在同版本下是**完全相同的镜像** (Image ID 一致)。但 `.env.example` 中按 `DP_CPU_ARCH` 推荐不同名称。

### 约定
| 架构 | 推荐镜像 | 原因 |
|------|---------|------|
| arm64 (macOS) | `grafana/grafana:12.x.x` | 统一使用标准名称 |
| amd64 (WSL2/Linux) | `grafana/grafana-oss:12.x.x` | 历史惯例 + 明确标注 OSS |

### dev-up.sh 自动选择
```bash
if [ "$CPU_ARCH" = "arm64" ]; then
    export DP_GRAFANA_IMAGE="grafana/grafana:12.4.1"
else
    export DP_GRAFANA_IMAGE="grafana/grafana-oss:12.4.1"
fi
```

### 铁律
> **同一台机器不要同时拉两个 Grafana 镜像名，`dev-up.sh` 按架构自动选择，`.env` 中 `DP_GRAFANA_IMAGE` 覆盖即可**

---

## 19. Grafana Loki 插件 — 正则转义限制

### 问题
Grafana 的 Loki 插件在**客户端解析** LogQL 时，不支持 `\S`、`\s`、`\d` 等 Perl 风格正则缩写。查询直接被 Grafana 拒绝 (返回 400)，**根本不会发送到 Loki**。

Loki 后端 (Go RE2) 支持 `\d`/`\s`/`\S`，但 Grafana 前端拦截了。

```logql
# ❌ Grafana 400 — \S \s 不被前端解析器识别
{compose_service="dp-gateway"} |~ "HTTP/\S+\s[45]\d{2}\s"

# ❌ Grafana 400 — \" 转义引号导致 Grafana LogQL 解析器混乱
{compose_service="dp-gateway"} |~ "\" [45]\d{2} "

# ✅ 正确 — 纯字符类 + 字面空格
{compose_service="dp-gateway"} |~ "HTTP/[^ ]+ [45][0-9]{2} "
```

### JSON 仪表板中的正确写法
```json
"expr": "{compose_service=\"dp-gateway\"} |~ \"HTTP/[^ ]+ [45][0-9]{2} \""
```

### 铁律
> **Grafana Loki 仪表板正则只用 `[0-9]`、`[^ ]`、`[a-z]` 等 POSIX 字符类，禁止 `\d` `\s` `\S` `\w` Perl 缩写，也不要用 `\"` 转义引号**

---

## 20. cAdvisor WSL2 smaps 错误 — referenced_memory 指标

### 问题
WSL2 环境下 cAdvisor 日志不断刷 `Cannot read smaps files for any PID from CONTAINER` 警告。原因: WSL2 内核不完整暴露 `/proc/[pid]/smaps`，而 `referenced_memory` 指标依赖此文件。

### 解决方案
**在 `--disable_metrics` 中追加 `referenced_memory`**:
```yaml
command:
  - '--housekeeping_interval=30s'
  - '--store_container_labels=false'
  - '--disable_metrics=percpu,sched,tcp,udp,referenced_memory'
```

### 铁律
> **WSL2 环境必须禁用 cAdvisor 的 `referenced_memory` 指标，否则日志持续刷 smaps 错误**

---

## 21. PromQL 值过滤 vs 标签过滤 — 容器内存告警

### 问题
`ContainerMemoryHigh` 告警在开发环境误报 (21 个容器全部 firing)。原因: 开发环境未设内存限制 → `container_spec_memory_limit_bytes = 0` → 除法结果 `+Inf` → 永远 > 85%。

### 解决方案
**PromQL 值过滤** `(metric > 0)` 过滤零值序列:
```yaml
# ❌ 标签过滤 (无效 — 0 不是标签值)
container_spec_memory_limit_bytes{name!=""} != "0"

# ✅ 值过滤 (正确 — 过滤掉值为 0 的时间序列)
container_memory_usage_bytes{name!=""} / (container_spec_memory_limit_bytes{name!=""} > 0) * 100 > 85
```

### 铁律
> **PromQL 中过滤指标值为 0 用 `(metric > 0)` 值过滤，不是 `metric != "0"` 标签过滤。两者语义完全不同**

---

## 22. Grafana Alertmanager 数据源 — 外部 vs 内置

### 问题
Grafana 12.x 的 `alertmanager` 数据源类型的 `stateFilter` 参数 (`firing`/`pending`/`inactive`) 是为 **Grafana 内置 alerting** 设计的，对外部 Prometheus Alertmanager 无效。告警面板 (stat + table) 始终显示空。

### 解决方案
**改用 Prometheus 数据源查询 `ALERTS` 指标**:
```promql
# 活跃告警数
count(ALERTS{alertstate="firing"})

# 告警列表 (table, instant query)
ALERTS{alertstate="firing"}
```

### 铁律
> **外部 Prometheus Alertmanager 的告警查询，必须通过 Prometheus 数据源查 `ALERTS` 指标，不要用 Grafana alertmanager 数据源的 stateFilter**

---

## 23. cAdvisor macOS vs WSL2 — Docker Socket 路径差异

### 问题
cAdvisor 在 **macOS Docker Desktop** 上注册 Docker factory 失败:
```
Registration of the docker container factory failed:
failed to connect to the docker API at unix:///var/run/docker.sock: no such file or directory
```
原因: macOS Docker Desktop VM 内部的 `/var/run/docker.sock` 不存在，真实 socket 在宿主机 `~/.docker/run/docker.sock`。

没有 Docker factory → 没有容器 `name` 标签 → 仪表板 `{name=~"dp-.*"}` 查询全部为空。

### 平台差异对比
| 平台 | Docker Socket 宿主机路径 | 容器内默认路径 | 是否需要额外配置 |
|------|------------------------|---------------|----------------|
| WSL2 Docker Desktop | `/var/run/docker.sock` | `/var/run/docker.sock` ✅ | 不需要 |
| macOS Docker Desktop | `~/.docker/run/docker.sock` | `/var/run/docker.sock` ❌ | 需要显式挂载 |
| 原生 Linux | `/var/run/docker.sock` | `/var/run/docker.sock` ✅ | 不需要 |

### macOS 解决方案
**在 `docker-compose.dev.yml` 中覆盖 cAdvisor 配置**:
```yaml
dp-cadvisor:
  command:
    - '--housekeeping_interval=30s'
    - '--store_container_labels=false'
    - '--whitelisted_container_labels=com.docker.compose.service'
    - '--docker_only=true'
    - '--docker=unix:///tmp/docker.sock'        # 指向新挂载路径
    - '--disable_metrics=percpu,sched,tcp,udp,referenced_memory'
  volumes:
    - /:/rootfs:ro
    - /var/run:/var/run:ro
    - /sys:/sys:ro
    - /var/lib/docker/:/var/lib/docker:ro
    - ${HOME}/.docker/run/docker.sock:/tmp/docker.sock:ro  # macOS socket
```

### 关键点
1. **不能挂载到 `/var/run/docker.sock`** — 主 compose 已有 `/var/run:/var/run:ro`，在只读目录内创建挂载点会失败
2. **挂载到 `/tmp/docker.sock`** + `--docker=unix:///tmp/docker.sock` 绕过冲突
3. **`--docker_only=true`** — 只采集 Docker 容器，减少噪音
4. **`--whitelisted_container_labels=com.docker.compose.service`** — `store_container_labels=false` 下只保留 compose service 名
5. **`name` 标签来自 Docker API**，不是 container labels — 只要 Docker factory 注册成功就会自动暴露
6. **主 compose 不改** — 生产环境 (原生 Linux/WSL2) Docker socket 路径正确，不需要这些覆盖

### 铁律
> **macOS Docker Desktop 下 cAdvisor 必须显式挂载 `~/.docker/run/docker.sock` 到容器非 `/var/run/` 路径，并用 `--docker` 参数指向，否则 Docker factory 注册失败导致无容器名标签**

---

## 24. Grafana 仪表板 noValue — 无数据时显示默认值

### 问题
`count(ALERTS{alertstate="firing"})` 在无告警时返回空结果 (不是 0)，面板显示 "No data"。

### 解决方案
**在面板 `fieldConfig.defaults` 中设置 `noValue`**:
```json
"fieldConfig": {
  "defaults": {
    "noValue": "0"
  }
}
```

### 适用场景
- 告警计数 (`count(ALERTS{...})`) — 无告警时应显示 0
- 不适用于时序面板 (timeseries) — 无数据就是无数据，不应填充

### 铁律
> **stat 类型面板的计数查询，如果空结果应显示 0，必须设置 `noValue: "0"`，否则会显示 No data**
