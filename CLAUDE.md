# DP — Digital Platform 数字底座

> **版本**: v0.8.1 · **语言**: 所有输出、代码注释和文档使用中文
> **核心理念**: SAP B1 为锚，WMS + OMS + BI 三位一体，AI 预留，多公司一键复制

---

## 架构哲学

- **一库七 Schema**: PostgreSQL 17 (`core`/`wms`/`oms`/`wf`/`bi`/`ai`/`authelia`)，不可拆分
- **逻辑隔离**: `company_code` 四层防御 (NOT NULL + CHECK + 触发器 + RLS)，`dp_app_rls` 角色受 RLS 约束
- **零 ETL**: BI `search_path=bi,wms`，直接跨 Schema JOIN
- **n8n 独立入口**: 编辑器走子域名，不走网关子路径 (官方 BUG #18596 #19635)
- **SSO 两层权限**: Authelia 网关门禁 (admins/wms-users/bi-users 组) + 应用内角色映射 (Superset: admins→Admin, bi-users→Alpha, 无组→Gamma)
- **可观测性**: Prometheus + Loki + Grafana + Alertmanager，全部 profile: monitoring
- **AI 只能建议**: 不可直接改库存、不可自动过账 SAP、不可绕过审批

---

## 代码库结构

```
Digital-Platform/
├── apps/
│   ├── wms/                       # WMS 前端 (原生 HTML/JS + Vue 3，无构建工具)
│   │   ├── *.html (12 个)         # 页面: index/so/wo/po/pi/lm/tr/ic/oms/stock/export/login
│   │   ├── *.js (15 个)           # 模块逻辑
│   │   ├── shared.js / shared.css # 公共库 (API 封装、状态管理、UI 组件)
│   │   ├── lang.js                # 中英文国际化
│   │   ├── camera-fallback.js     # 摄像头 QR/条码降级
│   │   ├── env.js                 # 配置注入 (运行时生成，必须在 shared.js 前加载)
│   │   ├── vendor/                # Vue 3、JsBarcode、html5-qrcode、qrcode
│   │   └── docker/nginx.conf      # WMS 专属 nginx 配置
│   ├── wf/                        # n8n 工作流
│   │   ├── *.json (30 个)         # 工作流定义 (含 OMS 分批同步 8 个)
│   │   └── lib/ (16 个 .js)       # 纯函数业务逻辑 (可单元测试)
│   ├── bi/                        # Superset BI (Dockerfile + superset_config.py)
│   └── ai/                        # AI 模块 (v1.5 预留，pgvector 已准备)
├── infrastructure/
│   ├── postgres/init/             # DDL 初始化 (01~18，按序执行)
│   ├── nginx/                     # 网关路由 (conf.d/ + conf.d-prod/ + landing/)
│   ├── monitoring/                # Prometheus + Alertmanager + Grafana (5 个仪表盘)
│   ├── loki/                      # 日志聚合
│   ├── redis/                     # 三个 Redis 配置 (wf/bi/sso)
│   └── sso/                       # Authelia 配置
├── scripts/                       # 运维脚本 (14 个 + n8n-tools/ + archive/)
├── tests/
│   ├── unit/ (55 个 .test.js)     # Jest: 36 WMS + 18 WF + 1 scripts
│   ├── e2e/ (14 个 .spec.js)      # Playwright E2E
│   ├── infra/ (33 个 .bats/.py)   # BATS 18 + pytest 15
│   └── sql/ (16 个 .sql)          # Schema 约束 + 触发器行为
├── docs/
│   ├── DEPLOY-GUIDE.md            # 部署手册
│   ├── WMS-UAT-Guide.md           # 用户验收测试
│   ├── ADR/ (8 篇)                # 架构决策记录
│   └── plans/                     # 功能规划文档
├── .claude/skills/ (21 个 SOP)    # AI 实战技能库
├── .github/workflows/             # ci.yml (12 Job) + e2e-tests.yml
├── docker-compose.yml             # 基础编排
├── docker-compose.dev.yml         # 开发覆盖
├── docker-compose.prod.yml        # 生产覆盖
├── .env.example / .env.dev.example
├── VERSION · PLAN.md · README.md · package.json
```

---

## 容器清单

### 核心服务 (12 个)

| 容器 | 镜像 | 用途 |
|------|------|------|
| `dp-db` | pgvector/pgvector:pg17 | 一库七 Schema 数据库 |
| `dp-cache-wf` | redis:7.4-alpine | n8n Bull 队列 |
| `dp-cache-bi` | redis:7.4-alpine | BI 缓存 + Celery broker |
| `dp-wms-web` | 自定义 (apps/wms/docker/) | WMS + OMS 前端 |
| `dp-wf` | n8nio/n8n:stable | queue 模式 main (路由+入队) |
| `dp-wf-worker` | n8nio/n8n:stable | 工作流执行 Worker |
| `dp-bi` | 自定义 (apps/bi/Dockerfile) | BI 可视化 (pyodbc + pymssql) |
| `dp-gateway` | nginx:stable-alpine | 统一路由 + SSO auth_request |
| `dp-tunnel` | cloudflare/cloudflared:latest | Cloudflare 隧道 (profile: production) |
| `dp-sso` | authelia/authelia:4.39.16 | SSO 认证网关 (可选) |
| `dp-cache-sso` | redis:7.4-alpine | SSO 会话存储 (可选) |
| `dp-wms-test` | 自定义 (apps/wms/docker/) | E2E 测试专用 (Playwright) |

### 监控栈 (10 个，profile: monitoring)

| 容器 | 镜像版本 | 用途 |
|------|---------|------|
| `dp-prometheus` | prom/prometheus:v3.10.0-distroless | 指标采集 |
| `dp-alertmanager` | prom/alertmanager:v0.31.1 | 告警路由 |
| `dp-grafana` | grafana/grafana-oss:12.4.1 | 可视化仪表盘 |
| `dp-node-exporter` | prom/node-exporter:v1.10.2 | 主机指标 |
| `dp-cadvisor` | ghcr.io/google/cadvisor:0.56.2 | 容器指标 |
| `dp-pg-exporter` | prometheuscommunity/postgres-exporter:v0.19.1 | PG 指标 |
| `dp-redis-exporter-wf` | oliver006/redis_exporter:v1.82.0 | Redis WF 指标 |
| `dp-redis-exporter-bi` | oliver006/redis_exporter:v1.82.0 | Redis BI 指标 |
| `dp-loki` | grafana/loki:3.6.7 | 日志聚合 |
| `dp-alloy` | grafana/alloy:v1.14.1 | 日志收集代理 |

---

## 🚨 高风险警示

> 反复踩坑、代价最高的错误，**每次相关操作前必须确认**。

### 硬编码 — 零容忍
```
❌ 禁止: IP、域名、/home/<user> 路径、密码、easywms、时区字符串
✅ 必须: 环境变量 DP_* / SAP_*，时区用 SYSTEM_TIMEZONE
```

### SAP — SQL 安全
```
❌ 禁止: 直接写入 SAP B1 数据库 / 拼接 SQL 字符串 (注入风险)
✅ 首选: Service Layer REST API (参数化)
✅ 备选: MS SQL 直连仅查询，加 SET NOCOUNT ON + WITH(NOLOCK)，参数化
```

### n8n 工作流更新 — 必走 API SOP
```
❌ 禁止: CLI update / 直接改 DB / 从 Git 覆盖 / 手动导入覆盖
✅ 必须: .claude/skills/n8n-database-operations.md
        GET → 精确修改 → 过滤 PUT body → deactivate → PUT → activate
```

### RLS — set_config 陷阱
```
❌ 绝对禁止: CTE 内联 set_config (PG 优化器先评估 RLS → 返回 0 行)
✅ 必须: 工作流首个独立 PG 节点执行 SELECT set_config('app.company_code', ...)
```

### 跨平台迁移
```
迁移到 macOS 前必读:
  .claude/skills/macos-self-hosted-runner.md
  .claude/skills/wsl-file-operations.md
```

### 🚨 版本同步 / 部署对齐 — git pull ≠ 环境对齐
```
❌ git pull 之后不能直接认为环境已对齐，必须同时处理:
   DB: 核对 postgres/init/ 脚本是否按序全量执行 (用 SELECT EXISTS 验证)
   n8n: 通过 API 同步工作流 + 逐版核对凭证历史操作 (见 skill)
   容器: 代码变更后 rebuild/restart 对应容器
✅ 完整 SOP: .claude/skills/deployment-migration-alignment.md
```

---

## 规则红线

### AI 工作方法
- **Skills 优先**: `.claude/skills/` 精确匹配 > 相关参考 > 官方文档 > 自行探索
- **遇到报错不重试**: 找根因，查对应 skills，参考历史踩坑记录

### 绝对禁止
- 将 `.env` 或含密钥文件提交 Git
- 在 n8n 工作流中硬编码凭据 (使用 n8n Credential)
- 跨 `company_code` 操作数据
- 删除或修改审计日志 (`wms_audit_log` / `oms.audit_logs`)
- 在 `apps/wf/` 存放非项目工作流文件

### 必须遵守
- n8n 工作流首个 PG 节点: `SELECT set_config('app.company_code', $env.DP_COMPANY_CODE, false)`
- RLS 角色: `dp_app_rls` 业务查询 (受 RLS) · `dp_app` 迁移/管理 (绕过) · `dp_bi` BI 只读 (BYPASSRLS)
- `company_code VARCHAR(20) NOT NULL`，**禁止 DEFAULT**
- 前端配置通过 `env.js` 注入，不硬编码；缓存版本号格式 `?v=phaseX.Y` 全站一致
- PostgreSQL 语法: `COALESCE` · `TO_CHAR` · `BOOLEAN` · `SERIAL` · `fn_updated_at()` 触发器
- DDL 变更通过 `infrastructure/postgres/init/` 管理
- `N8N_ENCRYPTION_KEY` 必须配置，不允许空值
- **BATS 测试 `@test` 名称和错误消息必须用英文**

### 文档同步
- 发布新版本按 `.claude/skills/release-version-consistency.md` SOP 检查
- 新增/删除文件后同步更新本文件；新增 CI Job 前检查是否已有重复职责

### 🚨 发版规则
```
Stable vX.Y.Z  新功能 → 10 个位置版本号全量对齐 + 统计数据硬验证 + npm test
Fix    vX.Y.Z.N 仅修复 → 只打 tag，不改文档版本号
❌ 先打 tag 再改代码 / 从文档复制旧数字 (必须重新 count)
❌ 先 tag+release，必须先 commit+push → CI 通过 → 再 tag
✅ 完整 SOP: .claude/skills/release-version-consistency.md
```

---

## 快速开发

```bash
bash scripts/dev-up.sh                                          # 启动 (自动检测 IP + 网络)
npm test                                                        # Jest 单元测试
npx playwright test                                             # E2E 测试
npm run lint                                                    # ESLint
pip install -r requirements-dev.txt && pytest tests/infra/      # 基建测试
N8N_API_KEY="..." python3 scripts/n8n-tools/sync-workflows.py   # 工作流同步 (推荐)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d  # 生产启动
```

---

## 文档导航

| 角色 | 文档 | 用途 |
|------|------|------|
| AI / 架构师 | **CLAUDE.md** (本文) | 规则红线 + 架构 + 方向 |
| DevOps | [DEPLOY-GUIDE.md](docs/DEPLOY-GUIDE.md) | 部署实施手册 |
| n8n 开发 | [apps/wf/README.md](apps/wf/README.md) | 30 个工作流 + 凭证 + 部署 |
| 终端用户 | [WMS-UAT-Guide.md](docs/WMS-UAT-Guide.md) | 用户验收测试 |
| 决策溯源 | [docs/ADR/](docs/ADR/) | 8 篇架构决策记录 |
| AI 技能 | [.claude/skills/](.claude/skills/) | 21 个实战 SOP |
| 路线图 | [PLAN.md](PLAN.md) | 版本历史 + 技术债 |

---

## 测试体系

| 类型 | 框架 | 数量 | 命令 |
|------|------|------|------|
| 单元测试 | Jest 29.7 | 55 个 | `npm test` |
| E2E 测试 | Playwright 1.58 | 14 个 | `npx playwright test` |
| 基建测试 | BATS + pytest | 33 个 | `npm run test:infra` |
| SQL 测试 | 原生 SQL | 16 个 | CI PG 容器执行 |
| 代码检查 | ESLint 10.0 | — | `npm run lint` |

**约定**: WF 纯函数必须有单元测试；新增 WMS 功能必须有 E2E 覆盖；`company_code` 隔离必须有 SQL 行为测试。

---

## CI/CD 流水线

主流水线 `.github/workflows/ci.yml` — 12 个 Job:

`compose-validate` · `env-completeness` · `pg-schema-test` · `security-audit` · `wms-integrity` · `shellcheck` · `wms-unit-test` · `eslint` · `image-build` · `infra-test` · `nginx-validate` · `workflow-validate`

E2E 流水线 `e2e-tests.yml` — 条件触发 (仅 `apps/wms/` 或 `tests/e2e/` 变更时运行)

---

## 命名约定

| 范围 | 约定 | 示例 |
|------|------|------|
| 容器 | `dp-{module}` | `dp-wms-web` |
| 工作流文件 | `wf{编号}-{功能}.json` | `wf02-transaction.json` |
| WF 纯函数 | `wf{编号}-{功能}.js` | `wf02-tx-validator.js` |
| 测试文件 | `{module}.test.js` / `{feature}.spec.js` / `{script}.bats` | `so.test.js` |
| DDL 脚本 | `{序号}_{描述}.sql/.sh` | `03_wms_tables.sql` |
| 环境变量 | `DP_` 平台 / `SAP_` SAP 集成 | `DP_DB_PASSWORD` |
| 缓存版本号 | `?v=phaseX.Y` | `?v=phase0.7` |

---

## 关键环境变量

### 必填

| 变量 | 用途 |
|------|------|
| `DP_DB_PASSWORD` | PostgreSQL 应用用户密码 |
| `DP_REDIS_WF_PASSWORD` | n8n Redis 密码 |
| `DP_REDIS_BI_PASSWORD` | BI Redis 密码 |
| `N8N_ENCRYPTION_KEY` | n8n 凭据加密密钥 (一旦设定不可更改) |
| `DP_BI_SECRET_KEY` | Superset 密钥 |

### 重要配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DP_COMPANY_CODE` | `DEFAULT` | 多公司隔离标识 |
| `SYSTEM_TIMEZONE` | `UTC` | 系统时区 (禁止硬编码) |
| `ENV_NAME` | `development` | development / staging / production |
| `DP_SSO_ENABLED` | `false` | SSO 开关 |
| `DP_DOCKER_NETWORK` | `n8network` | Docker 桥接网络名 |
| `DP_DB_RLS_PASSWORD` | — | dp_app_rls 密码 (留空跳过 RLS) |
| `DP_DB_BI_PASSWORD` | — | dp_bi 只读密码 (留空跳过) |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | `false` | 允许 n8n 2.x `$env` 访问 |
| `N8N_WORKER_CONCURRENCY` | `10` | Worker 并发数 |
| `DP_OMS_SYNC_START_DATE` | `20240101` | OMS 分批同步起始日期 (YYYYMMDD) |

SAP 集成: `SAP_SL_URL / SAP_SL_USER / SAP_SL_PASSWORD` (Service Layer) · `SAP_MSSQL_*` (直连只读)
详见 `.env.example`。

---

## 业务速查

**WMS 7 模块**: `SO` 销售拣货 · `WO` 生产收货 · `PO` 采购收货 · `TR` 库存调拨 · `IC` 盘点 · `LM` 库位移动 · `PI` 生产领料

**实时库存** = SAP 夜间快照 + 当日未过账入库 − 当日未过账出库 → `wms.v_stock_realtime`

**OMS**: `oms.orders` (parent_id 自引用) → DD 拆单 → WMS 执行 → 双向状态联动

**n8n 工作流分组**: `0a/0b` 初始化 · `1a~1e` 单据查询 (v0.8 切 PG OMS，解耦 SAP) · `02~09` 核心+同步 · `10~13` 系统管理 · `20~22` OMS · `20a~20c` OMS 分批同步

---

## 路线图

**关键里程碑**:
`v0.1` WMS 7模块 + SAP集成 → `v0.2` 全栈监控 → `v0.3` SSO统一认证 → `v0.4` n8n Queue模式 → `v0.5` 缓存表多公司 → `v0.6` RLS行级安全 → `v0.7` OMS分批同步 → `v0.8` WMS解耦SAP → `v0.8.1` OMS同步优化 *(当前)*

**远期**: 工作流失败自愈 · Service Layer 回写 SAP · RAG + pgvector · 库存异动异常检测 · 自然语言查询 BI

---

## Skills 技能速查

| SOP 文件 | 何时查阅 |
|----------|---------|
| `n8n-database-operations.md` | 操作 n8n / 更新工作流 |
| `n8n-migration-lessons.md` | n8n 版本升级 / 数据迁移 |
| `n8n-workflow-file-management.md` | 工作流文件组织 |
| `workflow-sop.md` | 工作流更新标准流程 |
| `rls-implementation-lessons.md` | RLS 实施 (CTE 陷阱 / set_config 模式) |
| `authelia-sso-integration.md` | SSO 部署 / 调试 / 用户管理 |
| `docker-network-troubleshooting.md` | 容器网络问题排查 |
| `monitoring-deployment-lessons.md` | 监控栈部署踩坑 |
| `oms-deployment-lessons.md` | OMS 模块部署实战 |
| `oms-sync-optimization.md` | OMS 同步优化 (wf20a 批次执行器) |
| `playwright-e2e-testing.md` | E2E 测试编写 |
| `production-deployment.md` | 生产上线检查清单 |
| `release-version-consistency.md` | 版本发布一致性 |
| `frontend-cache-versioning.md` | 浏览器缓存版本管理 |
| `test-coverage-improvement.md` | 测试覆盖率提升 |
| `wms-frontend-bug-patterns.md` | WMS 前端常见 Bug |
| `container-image-upgrade.md` | 容器镜像升级 + 版本监控 |
| `superset-upgrade-lessons.md` | Superset 大版本升级 |
| `macos-self-hosted-runner.md` | macOS 自托管 Runner |
| `wsl-file-operations.md` | WSL2 文件路径处理 |
| `deployment-migration-alignment.md` | 新环境/迁移部署对齐 (git pull ≠ 环境对齐) |

---

## 自进化协议

1. **Skills 优先**: 遇到问题先搜 `.claude/skills/`，禁止重复踩坑
2. **更新记录**: 架构变更后同步更新本文件 + ADR
3. **技能积累**: 可复用踩坑记录到 `.claude/skills/`
