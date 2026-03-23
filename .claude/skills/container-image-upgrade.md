# 容器镜像升级 SOP

> **版本**: v1.0 (2026-03-18)
> **适用**: 所有 DP 项目 Docker 镜像版本升级
> **触发**: 用户请求升级镜像版本 / 定期巡检发现新版本

---

## 1. 升级前评估 (必须完成)

### 1.1 兼容性分析

升级任何镜像前，**必须**完成以下检查:

| 检查项 | 方法 | 必须 |
|--------|------|------|
| 发布类型 | GitHub Releases: 正式版 vs RC/beta/alpha | ✅ |
| 变更日志 | 读 CHANGELOG / Release Notes | ✅ |
| 破坏性变更 | 搜索 "breaking change" / "deprecation" | ✅ |
| 配置格式变更 | 对比配置项是否废弃/重命名 | ✅ |
| 数据迁移 | 是否需要 schema migration / data conversion | ✅ |
| 依赖链 | 基础镜像变更 (Debian/Alpine 版本、Python/Node 版本) | ✅ |
| 多平台架构 | amd64 + arm64 支持情况 (见 1.2) | ✅ |
| 上游依赖 | 项目自定义组件与新版本的兼容性 | ✅ |

### 1.2 多平台架构检查 (关键)

部分镜像有架构差异，**必须确认目标平台支持**:

```bash
# 检查镜像支持的平台架构
docker manifest inspect <image:tag> | jq '.manifests[].platform'

# 或使用 Docker Hub API
curl -s "https://hub.docker.com/v2/repositories/<namespace>/<image>/tags/<tag>" | jq '.images[].architecture'
```

**常见陷阱**:

| 镜像 | 注意事项 |
|------|---------|
| `grafana/grafana` vs `grafana/grafana-oss` | grafana 是企业版，grafana-oss 是开源版；两者都支持 amd64+arm64 |
| `prom/prometheus` vs `*-distroless` | distroless 变体无 shell，healthcheck 只能用二进制 `--version` |
| `apache/superset` | 官方镜像仅 amd64；ARM64 需自行构建 |
| `msodbcsql18` | 仅 x86_64，ARM64 不可用 (需 pymssql 替代) |
| `n8nio/n8n` | 支持 amd64+arm64 |
| `pgvector/pgvector` | 支持 amd64+arm64 |
| `cadvisor` | ghcr.io 版本支持多架构，gcr.io 旧版可能不支持 |

### 1.3 风险等级判定

| 等级 | 条件 | 操作 |
|------|------|------|
| **低 (补丁版本)** | x.y.Z 变更，仅 Bug 修复，无破坏性变更 | 建议升级，标准流程 |
| **中 (次版本)** | x.Y.0 变更，有新功能，可能有废弃项 | 开发环境验证后升级 |
| **高 (主版本)** | X.0.0 变更，有破坏性变更 | 完整评估 + 代码适配 + 分阶段验证 |
| **阻断** | RC/beta、缺平台支持、核心 API 不兼容 | 暂缓，等待正式版或替代方案 |

---

## 2. 版本引用全量搜索

升级前**必须**搜索所有引用点:

```bash
# 搜索镜像版本引用 (替换 OLD_VERSION 为当前版本号)
grep -rn "OLD_VERSION" \
  docker-compose*.yml \
  apps/ \
  infrastructure/ \
  docs/ \
  CLAUDE.md \
  README.md \
  .claude/skills/ \
  tests/
```

**必须同步更新的文件类型**:
- `docker-compose.yml` — 镜像标签 (主要)
- `CLAUDE.md` — 容器清单表格
- `README.md` — 架构图
- `docs/DEPLOY-GUIDE.md` — 部署文档
- `docs/ADR/*.md` — 架构决策记录
- `.claude/skills/*.md` — 技能 SOP
- `apps/*/Dockerfile` — FROM 基础镜像
- `infrastructure/*/` — 配置文件中的版本引用

---

## 3. 升级执行

### 3.1 标准流程 (低风险)

```bash
# 1. 更新所有版本引用 (代码 + 文档)
# 2. 拉取新镜像
docker compose pull <service-name>
# 3. 重建容器
docker compose [--profile xxx] up -d <service-name>
# 4. 验证
docker ps --filter "name=<container>" --format "{{.Names}}\t{{.Image}}\t{{.Status}}"
docker logs <container> --tail 20
```

### 3.2 需要构建的镜像 (如 Superset)

```bash
# 1. 修改 Dockerfile 中 FROM 标签
# 2. 重新构建
docker compose build <service-name> --no-cache
# 3. 重启
docker compose up -d <service-name>
# 4. 验证功能 (SSO 登录、数据连接、报表加载等)
```

### 3.3 有数据迁移的升级

```bash
# 1. 备份数据
pg_dump -n <schema> > backup_$(date +%Y%m%d).sql
# 或 docker exec dp-db pg_dump ...
# 2. 执行升级
# 3. 验证迁移
# 4. 保留备份至少 7 天
```

---

## 4. 升级后验证

| 检查项 | 命令 |
|--------|------|
| 容器状态 | `docker ps --filter "name=dp-*"` |
| 健康检查 | `bash scripts/health-check.sh` |
| 容器日志 | `docker logs <container> --tail 20` |
| 功能验证 | 根据服务类型验证核心功能 |
| 监控指标 | Grafana 仪表盘确认指标正常 |
| CI 测试 | 提交后 CI 流水线全部通过 |

---

## 5. 版本标签策略

| 标签类型 | 示例 | 建议 |
|----------|------|------|
| 精确版本 | `v3.10.0-distroless` | **推荐** — 可复现、可回滚 |
| 次版本锁定 | `7.4-alpine` | 可接受 — 只收补丁 |
| 浮动标签 | `latest` / `stable` | **避免** — 不可控升级 |

**当前例外**: `n8nio/n8n:stable` 和 `nginx:stable-alpine` 使用浮动标签，升级时需额外注意实际拉取的版本。

---

## 6. 项目容器镜像清单

> 使用 `scripts/check-container-versions.sh` 自动检查最新版本

| 容器 | 当前镜像 | 标签类型 | 架构 |
|------|---------|---------|------|
| dp-db | pgvector/pgvector:pg17 | 主版本锁定 | amd64+arm64 |
| dp-cache-* | redis:7.4-alpine | 次版本锁定 | amd64+arm64 |
| dp-wf / dp-wf-worker | n8nio/n8n:stable | 浮动 | amd64+arm64 |
| dp-bi | apache/superset:6.1.0rc1 | RC 验证分支 (feature/superset-6.1.0) | amd64 only |
| dp-gateway | nginx:stable-alpine | 浮动 | amd64+arm64 |
| dp-tunnel | cloudflare/cloudflared:latest | 浮动 | amd64+arm64 |
| dp-sso | authelia/authelia:4.39.16 | 精确版本 | amd64+arm64 |
| dp-prometheus | prom/prometheus:v3.10.0-distroless | 精确版本 | amd64+arm64 |
| dp-alertmanager | prom/alertmanager:v0.31.1 | 精确版本 | amd64+arm64 |
| dp-grafana | grafana/grafana-oss:12.4.1 | 精确版本 | amd64+arm64 |
| dp-node-exporter | prom/node-exporter:v1.10.2 | 精确版本 | amd64+arm64 |
| dp-cadvisor | ghcr.io/google/cadvisor:0.56.2 | 精确版本 | amd64+arm64 |
| dp-pg-exporter | prometheuscommunity/postgres-exporter:v0.19.1 | 精确版本 | amd64+arm64 |
| dp-redis-exporter-* | oliver006/redis_exporter:v1.82.0 | 精确版本 | amd64+arm64 |
| dp-loki | grafana/loki:3.6.7 | 精确版本 | amd64+arm64 |
| dp-alloy | grafana/alloy:v1.14.1 | 精确版本 | amd64+arm64 |

---

## 7. 回滚策略

```bash
# 如果升级后出现问题，立即回滚:
# 1. 改回旧版本标签
# 2. 重新拉取+重建
docker compose pull <service>
docker compose up -d <service>
# 3. 如有数据迁移，恢复备份
docker exec -i dp-db psql -U $POSTGRES_USER -d $POSTGRES_DB < backup.sql
```
