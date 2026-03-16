# DP — Digital Platform 数字大脑

> **版本**: v0.3.3
> **语言**: 所有输出、代码注释和文档使用中文
> **仓库**: https://github.com/foodsaid/dp
> **核心理念**: SAP B1 为锚，OMS + WMS + BI 三位一体，AI 预留，多公司一键复制

---

## 项目架构

### 容器清单 (8 核心 + 2 SSO + 3 可选 + 8 监控)
| 容器 | 镜像 | 职责 | 环境 |
|------|------|------|------|
| `dp-db` | pgvector/pgvector:pg17 | 统一数据库 (5 Schema + pgvector) | 全部 |
| `dp-cache-wf` | redis:7.4-alpine | WF 队列 (db:0=Bull, db:1=WMS 会话) | 全部 |
| `dp-cache-bi` | redis:7.4-alpine | BI 缓存 (db:0=BI, db:1=Celery, db:2=AI 预留) | 全部 |
| `dp-wms-web` | 自定义 (nginx:alpine) | WMS 前端静态文件 | 全部 |
| `dp-wf` | n8nio/n8n:stable | 工作流引擎 (PG 后端, 遥测已关闭, Prometheus /metrics) | 全部 |
| `dp-bi` | 自定义 (BI 引擎+pyodbc+pymssql) | BI 数据可视化 (PG 后端 + SAP MSSQL) | 全部 |
| `dp-gateway` | nginx:stable-alpine | 统一网关 (多路路由 + 动态配置 + stub_status:18222) | 全部 |
| `dp-sso` | authelia/authelia:4.39.15 | SSO 统一认证 (Authelia, PG+Redis 后端) | 按需 (profile: sso) |
| `dp-cache-sso` | redis:7.4-alpine | SSO 会话 (noeviction, 128MB, 纯内存) | 按需 (profile: sso) |
| `dp-wms-test` | 自定义 (nginx:alpine) | WMS 测试前端 (bind-mount 热更新 + 内置 API 代理) | 按需 (profile: test) |
| `dp-tunnel` | cloudflare/cloudflared | 零信任隧道 | 仅生产 (profile: production) |
| `dp-certbot` | certbot/dns-cloudflare | Let's Encrypt 证书管理 | 仅生产 (profile: certbot) |
| `dp-dns` | dockurr/dnsmasq | Split DNS (路由器不支持时) | 仅生产 (profile: dns) |
| `dp-prometheus` | prom/prometheus:v3.10.0-distroless | 指标收集 + 告警评估 (8 targets) | 按需 (profile: monitoring) |
| `dp-alertmanager` | prom/alertmanager:v0.31.1 | 告警路由 + 通知 | 按需 (profile: monitoring) |
| `dp-grafana` | ${DP_GRAFANA_IMAGE} (默认 grafana-oss:12.4.1, dev-up.sh 自动检测) | 可视化仪表板 (4 dashboard) | 按需 (profile: monitoring) |
| `dp-node-exporter` | prom/node-exporter:v1.10.2 | 宿主机指标 | 按需 (profile: monitoring) |
| `dp-cadvisor` | ghcr.io/google/cadvisor:0.56.2 | 容器资源指标 | 按需 (profile: monitoring) |
| `dp-pg-exporter` | prometheuscommunity/postgres-exporter:v0.19.1 | PostgreSQL 指标 (dp_monitor 账号) | 按需 (profile: monitoring) |
| `dp-redis-exporter-wf` | oliver006/redis_exporter:v1.82.0 | Redis WF 队列指标 | 按需 (profile: monitoring) |
| `dp-redis-exporter-bi` | oliver006/redis_exporter:v1.82.0 | Redis BI 缓存指标 | 按需 (profile: monitoring) |

### 数据库: 统一 PostgreSQL 17
- **一库六 Schema**: `wms` / `oms` / `wf` / `bi` / `ai` / `authelia`
- n8n 连接参数: `DB_POSTGRESDB_SCHEMA=wf`
- BI 连接参数: `options=-c search_path=bi,wms`
- BI 可直接 `SELECT wms.table JOIN bi.table` (零 ETL)

### 网关路由 (dp-gateway)

#### 开发环境 (conf.d/default.conf)
| 路径 | 目标 | 说明 |
|------|------|------|
| `= /` | landing/index.html | 导航首页 (精确匹配, SSO bypass) |
| `/auth/` | dp-sso (Authelia) | SSO 登录门户 (公开, no-cache) |
| `/api/auth/whoami` | dp-sso | 统一身份端点 (5s micro-cache) |
| `/wms/` | dp-wms-web | WMS 前端 (SSO 保护) |
| `/api/wms/` | dp-wf (→/webhook/wms/...) | WMS 业务 API (SSO bypass) |
| `/api/webhook/` | dp-wf (→/webhook/...) | n8n 原生 webhook 透传 (SSO bypass) |
| `/api/webhook-test/` | dp-wf (→/webhook-test/...) | n8n webhook 测试 (SSO bypass) |
| `/superset/` | dp-bi | BI 引擎 (SSO 保护 + Remote-User) |
| `= /bi` / `= /bi/` | 302 → BI 欢迎页 | BI 快捷入口 |
| `/health` | 200 JSON | 网关健康检查 (application/json) |
| `/ai/` | 503 预留 | AI 智能体 (application/json) |
| `/grafana/` | dp-grafana | Grafana 仪表板 (SSO 保护 + Auth Proxy) |
| `/prometheus/` | dp-prometheus | Prometheus UI (SSO 保护, admins 组) |
| `/alertmanager/` | dp-alertmanager | Alertmanager (SSO 保护, admins 组) |
| `/static/` | dp-bi | BI 静态资源 (7天缓存) |
| `/ (兜底)` | 404 JSON | 未知路径兜底 (不再回退 BI) |
| `wf.*` 子域名 | dp-wf | n8n 编辑器 (独立 server block, 不纳入 SSO) |

#### 生产环境 (conf.d-prod/)
- HTTP:80 + HTTPS:443 双 server block (主域名，在 nginx conf 中配置)
- n8n 编辑器: HTTP:80 + HTTPS:443 (wf 子域名)
- Let's Encrypt 通配符证书
- Split DNS: LAN 直连 + WAN Cloudflare Tunnel

**关键**: n8n 编辑器使用独立端口/子域名访问 (不走网关子路径，避免官方 BUG n8n-io/n8n #18596 #19635)

#### SSO 登录页重定向 (v0.3.3+)
`DP_SSO_ENABLED=true` 时，`27-sso-auth-toggle.sh` 自动生成 `sso-login-redirects.inc`，将各模块内置登录页 301 重定向:
| 内置登录页 | 重定向目标 | 说明 |
|-----------|-----------|------|
| `/wms/login.html` | `/wms/` | WMS 登录页 (已由 SSO 替代) |
| `/superset/login/` | `/superset/welcome/` | BI 内置登录 (Remote-User 替代) |
| `/login/` | `/superset/welcome/` | BI 登录别名 |
| `/grafana/login` | `/grafana/` | Grafana 内置登录 (Auth Proxy 替代) |

`DP_SSO_ENABLED=false` 时 conf 为空文件，各模块保留独立认证。

### WMS 测试环境 (v0.1.4+)
- 独立子域名访问 (通过 `DP_WMS_TEST_DOMAIN` 配置)
- `dp-wms-test` 容器 (profile: test): bind-mount 热更新 + 内置 API 代理到 n8n
- `dp-gateway` 动态 nginx 配置: 容器启动时 `25-wms-test-envsubst.sh` 根据域名有无决定是否生成配置
- 域名为空时不生成配置，不影响网关启动
- 启动: `docker compose --profile test up -d dp-wms-test`

### 手机摄像头扫码 (v0.1.4+)
- `camera-fallback.js`: 非侵入式摄像头扫码兜底模块 (零修改 shared.js / 后端)
- 依赖: `vendor/html5-qrcode.min.js` + `lang.js` (I18N) + `shared.js` (showMessage)
- 激活方式: 连点页面标题 5 次
- 功能: iOS 兼容、1.5cm+ 小码识别、原生 BarcodeDetector 硬件加速 + 多帧确认防误读

---

## 关键规则

### AI 工作方法 (最高优先级)
- **必须优先查阅 `.claude/skills/`**: 遇到问题时，先搜索 skills 目录中是否已有对应 SOP/教训记录，严格按照已验证的方法执行，禁止跳过 skills 自创方法
- **禁止重复踩坑**: skills 中记录的教训和 SOP 是实战验证的，直接遵循比自行探索效率更高、风险更低
- **skills 适用顺序**: skills 精确匹配 > skills 相关参考 > 官方文档 > 自行探索
- **n8n 工作流更新必须走 API SOP**: 修改线上 n8n 工作流时，**禁止**自创方法 (CLI update、直接改 DB、从 Git 覆盖)，**必须**按 `n8n-database-operations.md` 的 API 精确更新流程执行: GET 线上版本 → 精确修改目标节点 → 过滤 PUT body (只保留 name/nodes/connections/settings/staticData) → deactivate → PUT → activate。这条规则被反复违反超过 20 次，现升级为强制规则

### 绝对禁止
- **禁止** 硬编码域名、IP、密码到源码
- **禁止** 将 .env 或含密钥文件提交到 Git
- **禁止** 在 n8n 工作流中硬编码凭据 (使用 Credential)
- **禁止** 直接写入 SAP B1 数据库 (只能通过 Service Layer)
- **禁止** 跨 company_code 操作数据
- **禁止** 删除审计日志 (wms_audit_log)
- **禁止** 在 `apps/wf/` 存放非项目工作流文件 (legacy/备份/临时导出，详见 `.claude/skills/n8n-workflow-file-management.md`)

### 文档同步规则 (详见 `.claude/skills/release-version-consistency.md`)
- **发布新版本时，必须按 `release-version-consistency.md` SOP 检查 7 个版本号位置 + 敏感信息 + 统计数据**
- **禁止硬编码个人路径 (`/home/<user>`)、个人姓名、旧系统名称 (`easywms`)、数据库凭据 (`dp_app/dp`)** — 使用环境变量或通用占位符
- **新增/删除/重命名文件后，必须同步更新 CLAUDE.md 目录树**
- **新增 CI Job 前，先 `ls .github/workflows/` 检查是否已有独立工作流处理同一职责**
- **统计数据 (用例数/文件数/覆盖率) 变更后，全量搜索所有引用处同步更新**
- **BATS 测试夹具 mock 数据必须与实际脚本/配置文件保持同步**

### 必须遵守
- 所有 WMS 核心表操作必须带 `company_code` 过滤
- n8n 工作流开头必须有 Company Filter 节点
- 前端配置通过 env.js 注入，不硬编码
- 时区统一使用 `SYSTEM_TIMEZONE` 环境变量，**永远不要硬编码 'Asia/Bangkok'**
- 缓存版本号格式: `?v=phaseX.Y`，所有 HTML 文件必须一致
- env.js 必须在 shared.js 之前加载
- n8n 必须配置 `N8N_ENCRYPTION_KEY` (不允许空值，容器重建后凭据依赖此密钥)
- Docker 网络名由 `DP_DOCKER_NETWORK` 环境变量控制 (默认 `n8network`，外部网络，`dev-up.sh` 自动创建)

### 数据库规范
- MySQL 语法已弃用，全部使用 PostgreSQL
- `IFNULL()` → `COALESCE()`
- `DATE_FORMAT()` → `TO_CHAR()`
- `TINYINT(1)` → `BOOLEAN`
- `AUTO_INCREMENT` → `SERIAL`
- `ON UPDATE CURRENT_TIMESTAMP` → `fn_updated_at()` 触发器
- `company_code` 为 `VARCHAR(20) NOT NULL`，**禁止 DEFAULT**，数据库层有 CHECK + 触发器防错
- 所有 DDL 变更通过 `infrastructure/postgres/init/` 管理

### SAP B1 集成
- **首选**: Service Layer REST API (`SAP_SL_*` 环境变量)
- **备选**: MS SQL 直连 (仅查询，必须加 `SET NOCOUNT ON` + `WITH(NOLOCK)`)
- BI 连 SAP (二选一):
  - `mssql+pymssql://user:pass@host:1433/db` (简洁，无 SSL 问题)
  - `mssql+pyodbc://user:pass@host:1433/db?driver=ODBC+Driver+18+for+SQL+Server&TrustServerCertificate=yes`

---

## 目录结构

```
Digital-Platform/
├── CLAUDE.md                           # 本文件 (数字大脑)
├── PLAN.md                             # 执行计划
├── README.md                           # 项目说明
├── VERSION                             # 语义化版本号 (当前 0.3.3)
├── LICENSE                             # 开源许可
├── .env.example                        # 完整环境模板 (含 SSO/监控, 密码空值)
├── .env.dev.example                    # 最小化开发模板 (7 核心容器, 无 SSO/监控)
├── .editorconfig                       # 编辑器统一配置
├── .gitattributes                      # Git 属性
├── .gitignore                          # Git 忽略规则
├── package.json                        # Node.js 依赖 (Jest 测试)
├── package-lock.json                   # 依赖锁定文件
├── eslint.config.js                    # ESLint 扁平配置 (3 环境: 浏览器/Node/Jest)
├── jest.config.js                      # Jest 配置 (jsdom 环境)
├── playwright.config.js                # Playwright E2E 测试配置
├── requirements-dev.txt                # Python 测试依赖 (pytest + BATS)
├── docker-compose.yml                  # 8 核心容器
├── docker-compose.dev.yml              # 开发覆盖 (端口暴露 + 热更新)
├── docker-compose.prod.yml             # 生产覆盖 (HTTPS + 资源限制 + certbot/dns)
├── infrastructure/
│   ├── postgres/init/                  # PG 初始化脚本 (按编号顺序执行)
│   │   ├── 01_extensions.sql           # pgvector + pg_trgm + uuid-ossp + pgcrypto
│   │   ├── 02_schemas.sql             # 5 Schema (wms/oms/wf/bi/ai)
│   │   ├── 03_wms_tables.sql          # 11 表 + 4 视图 + AI 预留表 (doc_type 含 DD)
│   │   ├── 04_wms_seed.sh            # 管理员账号初始化
│   │   ├── 05_oms_tables.sql          # OMS Schema: 4 表 + 2 视图 + 触发器 + 索引
│   │   ├── 06_monitoring_user.sh      # 监控账号初始化 (dp_monitor, pg_monitor 权限)
│   │   ├── 07_sso_schema.sh           # SSO authelia Schema 创建 + 授权
│   │   ├── 08_sso_users.sql           # SSO 用户管理表 (数据库为源, 同步到 users.yml)
│   │   └── 09_enable_ssl.sh           # PostgreSQL SSL 自签名证书 (容器间加密通信)
│   ├── redis/
│   │   ├── wf.conf                    # 队列 Redis 配置
│   │   ├── bi.conf                    # 缓存 Redis 配置
│   │   └── sso.conf                   # SSO 会话 Redis 配置 (noeviction, 128MB)
│   ├── nginx/
│   │   ├── nginx.conf                 # 网关主配 (gzip + 代理缓冲 + WebSocket + 动态 include)
│   │   ├── security-headers.conf      # 安全响应头公共片段 (防子 location add_header 覆盖)
│   │   ├── conf.d/default.conf        # 开发环境路由 (HTTP:80)
│   │   ├── conf.d-prod/               # 生产环境路由 (HTTP+HTTPS)
│   │   │   ├── default.conf           # 4 server block (主域名/wf子域名 × http/https)
│   │   │   ├── proxy-params.conf      # 公共代理参数 (安全头 + CSP)
│   │   │   └── ssl-params.conf        # SSL 配置 (ECDHE+AESGCM 密码套件)
│   │   ├── security-headers.conf           # 安全响应头 include (主站 CSP, location 级继承修复)
│   │   ├── security-headers-wf.conf       # 安全响应头 include (n8n, unsafe-eval+wss:)
│   │   ├── wms-test-gateway.conf.template  # WMS 测试网关模板 (envsubst 动态生成)
│   │   ├── wms-test.conf              # WMS 测试容器内部 nginx 配置
│   │   ├── 25-wms-test-envsubst.sh    # 测试网关配置生成器 (容器启动时执行)
│   │   ├── 26-landing-port.sh         # Landing 页端口注入脚本
│   │   ├── 27-sso-auth-toggle.sh      # SSO 开关 (生成 sso-auth.inc + sso-headers.inc + sso-login-redirects.inc)
│   │   └── landing/                   # 网关导航页
│   │       ├── index.html             # 导航首页
│   │       ├── logo-oauth.svg         # OAuth 登录 Logo
│   │       ├── privacy.html           # 隐私政策页
│   │       └── terms.html             # 服务条款页
│   ├── monitoring/                    # 可观测性 (profile: monitoring)
│   │   ├── prometheus/
│   │   │   ├── prometheus.yml         # 抓取配置 (8 个 scrape job)
│   │   │   └── rules/
│   │   │       └── dp-alerts.yml      # 告警规则 (10 组)
│   │   ├── alertmanager/
│   │   │   └── alertmanager.yml       # 告警路由 + 通知渠道
│   │   └── grafana/
│   │       ├── provisioning/
│   │       │   ├── datasources/
│   │       │   │   ├── prometheus.yml # Prometheus 数据源
│   │       │   │   └── alertmanager.yml # Alertmanager 数据源
│   │       │   └── dashboards/
│   │       │       └── default.yml    # 仪表板提供器
│   │       └── dashboards/
│   │           ├── dp-overview.json   # 总览 (宿主机+容器+告警)
│   │           ├── dp-n8n.json        # n8n 工作流统计
│   │           ├── dp-postgres.json   # PostgreSQL 性能
│   │           └── dp-redis.json      # Redis 双实例
│   ├── sso/                           # SSO 统一认证 (Authelia, profile: sso)
│   │   ├── configuration.yml         # Authelia 配置模板 (__PLACEHOLDER__ + sed 渲染)
│   │   └── users.yml.example         # 用户模板 (Git 跟踪, users.yml 不跟踪)
│   ├── certbot/
│   │   └── cloudflare.ini.example     # Cloudflare DNS API 凭据模板
│   └── dns/
│       └── dnsmasq.conf.example       # Split DNS 配置模板
├── apps/
│   ├── wms/                            # WMS 前端 (扁平结构，原生 HTML/JS)
│   │   ├── index.html                 # 仪表板 (主入口)
│   │   ├── login.html                 # 登录页
│   │   ├── so.html                    # 销售拣货
│   │   ├── wo.html                    # 生产收货
│   │   ├── po.html                    # 采购收货
│   │   ├── tr.html                    # 库存调拨
│   │   ├── ic.html                    # 盘点
│   │   ├── lm.html                    # 库位移动
│   │   ├── pi.html                    # 生产领料
│   │   ├── stock.html                 # 库存查询
│   │   ├── export.html                # 数据导出
│   │   ├── oms.html                   # OMS 订单管理 (查询+DD拆单+批量打印)
│   │   ├── shared.js                  # 核心公共模块 (~1823行)
│   │   ├── shared.css                 # 公共样式
│   │   ├── so.js                      # 销售拣货页面逻辑 (DD 复用)
│   │   ├── wo.js                      # 生产收货页面逻辑
│   │   ├── po.js                      # 采购收货页面逻辑
│   │   ├── tr.js                      # 库存调拨页面逻辑
│   │   ├── ic.js                      # 盘点页面逻辑
│   │   ├── lm.js                      # 库位移动页面逻辑
│   │   ├── pi.js                      # 生产领料页面逻辑
│   │   ├── index.js                   # 仪表板页面逻辑
│   │   ├── login.js                   # 登录页面逻辑 (读取 env.js SSO_ENABLED 条件重定向)
│   │   ├── stock.js                   # 库存查询页面逻辑
│   │   ├── export.js                  # 数据导出页面逻辑
│   │   ├── oms.js                     # OMS 订单管理页面逻辑
│   │   ├── camera-fallback.js         # 手机摄像头扫码兜底模块 (~957行)
│   │   ├── lang.js                    # 国际化 (中/英/泰/缅 四语, ~806行)
│   │   ├── print.css                  # 打印样式
│   │   ├── favicon.svg                # 图标
│   │   ├── vendor/                    # 第三方库
│   │   │   ├── JsBarcode.all.min.js   # 条码生成
│   │   │   ├── html5-qrcode.min.js    # 摄像头扫码库 (camera-fallback 依赖)
│   │   │   ├── qrcode.min.js          # QR 码生成
│   │   │   └── vue.global.prod.js     # Vue 3 运行时 (OMS 前端)
│   │   └── docker/                    # 容器构建
│   │       ├── Dockerfile             # nginx:alpine 基础镜像
│   │       ├── docker-entrypoint.sh   # env.js 生成器 (运行时注入配置)
│   │       └── nginx.conf             # WMS 内部 nginx 配置
│   ├── wf/                             # n8n 工作流 (22 个 JSON + 纯函数库)
│   │   ├── README.md                  # 工作流配置说明
│   │   ├── lib/                       # 纯函数库 (16 模块，从 n8n Code 节点剥离，可单测)
│   │   │   ├── wf02-tx-validator.js   # 事务提交校验
│   │   │   ├── wf03-doc-validator.js  # 单据管理校验
│   │   │   ├── wf04-doc-query.js      # 单据查询逻辑
│   │   │   ├── wf05-csv-builder.js    # CSV 导出构建
│   │   │   ├── wf08-stock-aggregator.js  # 库存 4 维聚合逻辑
│   │   │   ├── wf09-snapshot-engine.js   # 库存快照引擎
│   │   │   ├── wf11-masterdata-parser.js # 主数据解析
│   │   │   ├── wf13-lock-machine.js   # 悲观锁状态机
│   │   │   ├── wf1c-so-parser.js      # SO 查询解析 (含 DD 分支)
│   │   │   ├── wf20-oms-mapper.js     # OMS 同步映射
│   │   │   ├── wf21-query-builder.js  # OMS 查询构建
│   │   │   ├── wf22-mapper.js         # DD 拆单 mapper 逻辑
│   │   │   ├── wf-doc-param-extractor.js  # 单据参数提取 (共享)
│   │   │   ├── wf-merge-data.js       # 数据合并 (共享)
│   │   │   ├── wf-prefill-builder.js  # 预填 SQL 构建 (共享)
│   │   │   └── wf-sync-helpers.js     # 同步辅助函数 (共享)
│   │   ├── wf0a-init-masterdata.json  # 期初主数据灌库 (一次性)
│   │   ├── wf0b-init-inventory.json   # 期初库存导入 (一次性)
│   │   ├── wf02-transaction.json      # 事务提交
│   │   ├── wf03-document-management.json  # 单据管理
│   │   ├── wf04-document-query.json   # 单据查询
│   │   ├── wf05-item-export-dashboard.json  # 物料/导出/仪表板
│   │   ├── wf06-items-sync.json       # 物料缓存同步 (Cron 19:00)
│   │   ├── wf07-locations-sync.json   # 仓库缓存同步 (Cron 19:00)
│   │   ├── wf08-stock-query.json      # 库存查询
│   │   ├── wf09-stock-snapshot.json   # 库存快照同步 (Cron 22:00)
│   │   ├── wf10-bin-sync.json         # 库位缓存同步 (Cron 19:30)
│   │   ├── wf11-masterdata.json       # 主数据查询
│   │   ├── wf12-bin-add.json          # 新增库位
│   │   ├── wf13-lock.json             # 单据锁管理
│   │   ├── wf1a-wo-lookup.json        # WO 查询 (生产订单)
│   │   ├── wf1b-po-lookup.json        # PO 查询 (采购订单)
│   │   ├── wf1c-so-lookup.json        # SO 查询 (销售订单)
│   │   ├── wf1d-tr-lookup.json        # TR 查询 (转储申请)
│   │   ├── wf1e-pi-lookup.json        # PI 查询 (生产领料 BOM)
│   │   ├── wf20-oms-sync.json         # OMS SAP 订单同步 (Cron 19:30 + 手动)
│   │   ├── wf21-oms-query.json        # OMS 订单查询 + 明细
│   │   └── wf22-oms-dd.json           # OMS DD 拆单管理
│   ├── bi/
│   │   ├── Dockerfile                # BI 引擎 + pyodbc + pymssql + ODBC 18 (双 MSSQL 驱动)
│   │   ├── superset_config.py        # BI PG 后端配置 (search_path=bi,wms)
│   │   └── docker-entrypoint.sh      # BI 引擎启动脚本
│   └── ai/README.md                   # AI 责任边界 (能做/不能做)
├── scripts/                           # 运维脚本
│   ├── dev-up.sh                      # 开发环境启动 (自动检测 IP)
│   ├── init-platform.sh               # 首次平台初始化
│   ├── clone-company.sh               # 新客户部署克隆
│   ├── import-workflows.sh            # n8n 工作流批量导入
│   ├── backup.sh                      # 数据库备份 (pg_dump -Fc + GPG 可选加密)
│   ├── health-check.sh                # 容器健康检查 (8 核心 + 4 可选)
│   ├── cert-renew.sh                  # Let's Encrypt 证书续期
│   ├── sso-manage-user.sh             # SSO 用户管理 CLI
│   ├── sso-migrate-wms-users.sh       # WMS 用户迁移到 SSO
│   ├── build-gh-pages.sh              # GitHub Pages 静态站点构建 (landing 页转换)
│   ├── n8n-tools/                     # n8n 工具集
│   │   ├── README.md                  # 工具说明
│   │   ├── add-ids.js                 # 为工作流 JSON 添加 id 字段
│   │   └── sync-workflows.py          # API 方式同步工作流
│   └── archive/                       # 已归档的一次性修复脚本 (8 个)
│       ├── fix_dd_warehouse_v3.py     # DD 仓库修复
│       ├── fix_wf21_print.py         # wf21 打印修复
│       ├── fix_wf21_wf1c_doctype.py  # wf21/wf1c 单据类型修复
│       ├── fix_wf22_error_handling.py # wf22 错误处理修复
│       ├── fix_sync_counts.py        # 同步计数修复
│       ├── update_wf1c_wf21.py       # wf1c/wf21 更新脚本
│       ├── update_wf1c_wf22_v2.py    # wf1c/wf22 更新脚本 v2
│       └── update_wf21_wf22.py       # wf21/wf22 更新脚本
├── tests/
│   ├── unit/wms/                      # WMS 前端单元测试 (Jest + jsdom, 32 个 *.test.js + setup.js)
│   ├── unit/wf/                       # n8n 工作流纯函数测试 (16 个 *.test.js, 与 apps/wf/lib/ 一一对应)
│   ├── unit/scripts/                  # 工具脚本单元测试 (add-ids.test.js)
│   ├── e2e/                           # E2E 端到端测试 (Playwright, 153 场景, 14 个 *.spec.js, 覆盖全 12 页面)
│   └── sql/
│       ├── 01_extensions_test.sql       # 扩展加载测试
│       ├── 02_schemas_test.sql          # Schema 创建测试
│       ├── 05_schema_behavior_test.sql  # WMS Schema 行为测试 (约束+触发器)
│       ├── 06_view_behavior_test.sql    # WMS 视图行为测试
│       ├── 07_oms_schema_behavior_test.sql  # OMS Schema 行为测试 (15 项)
│       ├── 08_views_aggregation_test.sql    # WMS 视图聚合测试
│       ├── 09_oms_view_behavior_test.sql    # OMS 视图行为测试 (8 项)
│       └── 10_trigger_behavior_test.sql    # 触发器行为 + 跨 Schema 查询测试 (12 项)
│   └── infra/                         # 基建测试 (BATS 15 文件 + pytest 8 文件)
│       ├── *.bats                     # Shell 脚本行为测试 (backup/bi-entrypoint/cert-renew/clone/dev-up/enable-ssl/health/import/init/landing-port/sso-auth-toggle/sso-manage-user/sso-migrate-wms-users/wms-entrypoint/wms-test-envsubst)
│       └── test_*.py                  # Python 脚本单元测试 (backup/fix_dd/fix_wf21/fix_wf22/nginx_routes/sync/update)
├── docs/
│   ├── ADR/                           # 架构决策记录
│   │   ├── 001-unified-postgresql.md  # 统一 PostgreSQL 决策
│   │   ├── 002-multi-schema-isolation.md  # 多 Schema 隔离
│   │   ├── 003-dual-redis.md          # 双 Redis 架构
│   │   ├── 004-sap-service-layer.md   # SAP 接入方式
│   │   ├── 005-pyodbc-mssql-driver.md # MS SQL 驱动选择
│   │   ├── 006-test-coverage-analysis.md  # 测试覆盖分析
│   │   ├── 007-oms-independent-schema.md  # OMS 独立 Schema 决策
│   │   └── 008-authelia-sso.md        # Authelia SSO 架构决策
│   ├── plans/                         # 设计规划文档
│   │   ├── 2026-03-05-oms-dd-cross-reference-design.md  # OMS SO↔DD 交叉引用设计
│   │   └── 2026-03-05-oms-dd-cross-reference.md         # OMS SO↔DD 交叉引用规划
│   ├── WMS-UAT-Guide.md              # WMS 用户验收测试指南
│   ├── DEPLOY-GUIDE.md               # 系统部署实施手册
│   └── test-coverage-analysis-2026-03-15.md  # 测试覆盖率分析报告
├── .claude/skills/                    # AI 技能库 (16 个可复用模式)
│   ├── authelia-sso-integration.md    # Authelia SSO 集成经验 (12 项教训)
│   ├── docker-network-troubleshooting.md
│   ├── frontend-cache-versioning.md
│   ├── macos-self-hosted-runner.md     # macOS self-hosted runner 经验 (11 项: BSD 工具链/Docker/Python/BATS)
│   ├── monitoring-deployment-lessons.md # 监控栈部署经验 v2.0 (14 项)
│   ├── n8n-database-operations.md
│   ├── n8n-migration-lessons.md
│   ├── n8n-workflow-file-management.md
│   ├── oms-deployment-lessons.md      # OMS 部署教训 (24 项, v5.0)
│   ├── playwright-e2e-testing.md      # E2E 测试模式 (Playwright + Network Interception)
│   ├── production-deployment.md       # 生产部署经验 (HTTPS + Tunnel + Split DNS)
│   ├── release-version-consistency.md # 发布版本一致性检查 SOP
│   ├── test-coverage-improvement.md   # 测试覆盖率提升策略
│   ├── wms-frontend-bug-patterns.md
│   ├── workflow-sop.md
│   └── wsl-file-operations.md
├── .github/
│   ├── SECURITY.md                    # 安全政策
│   ├── dependabot.yml                 # Dependabot 依赖漏洞扫描 (npm, weekly)
│   └── workflows/
│       ├── ci.yml                    # CI (12 Jobs)
│       └── e2e-tests.yml            # E2E 测试 (Playwright, 独立工作流)
```

---

## 开发工作流

### 本地开发启动
```bash
# 方式 A: 自动检测启动 (推荐，自动创建网络 + 平台检测 + 权限预检)
bash scripts/dev-up.sh

# 方式 B: 手动启动
cp .env.example .env
# 编辑 .env 填入密码 (所有空值密码字段必须填写)
docker network create "${DP_DOCKER_NETWORK:-n8network}"  # 只需一次
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### 开发环境端口
| 服务 | URL | 端口变量 |
|------|-----|---------|
| WMS 前端 (直连) | http://localhost:8081 | `DP_WMS_WEB_PORT` |
| WMS 测试 (直连) | http://localhost:8082 | `DP_WMS_TEST_PORT` |
| n8n 编辑器 | http://localhost:5678 | `DP_WF_PORT` |
| BI 数据可视化 | http://localhost:8088 | `DP_BI_PORT` |
| 统一网关 | http://localhost:8080 | `DP_GATEWAY_PORT` |
| PostgreSQL | localhost:5432 | `DP_DB_PORT` |
| Redis (WF) | localhost:6379 | `DP_REDIS_WF_PORT` |
| Redis (BI) | localhost:6380 | `DP_REDIS_BI_PORT` |
| Prometheus (监控) | http://localhost:9090 | `DP_PROMETHEUS_PORT` |
| Alertmanager (监控) | http://localhost:9093 | `DP_ALERTMANAGER_PORT` |
| Grafana (监控) | http://localhost:3000 | `DP_GRAFANA_PORT` |

### 生产环境部署
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 首次生成 SSL 证书
docker compose --profile certbot run --rm dp-certbot

# 证书续期 (crontab 配置)
# 0 3 1,15 * * /path/to/scripts/cert-renew.sh
```

### 运行测试
```bash
# WMS 前端 + n8n 纯函数单元测试 (Jest, 49 文件, 2264 用例)
npm test

# E2E 端到端测试 (Playwright, 14 文件, 153 场景)
npx playwright test

# SQL 行为测试 (需要运行中的 PG)
psql -h 127.0.0.1 -U "$DP_DB_USER" -d "$DP_DB_NAME" -f tests/sql/05_schema_behavior_test.sql

# ESLint 静态分析 (0 errors, 0 warnings)
npm run lint

# 基建测试 (BATS + pytest)
pip install -r requirements-dev.txt && pytest tests/infra/
```

### 工作流部署
```bash
# 方式 A: API 同步 (推荐)
N8N_API_KEY="your-api-key" python3 scripts/n8n-tools/sync-workflows.py

# 方式 B: CLI 导入
bash scripts/import-workflows.sh
```

---

## 多公司策略

### v0.1: 模板化独立部署
```bash
git clone https://github.com/foodsaid/dp && cd Digital-Platform
cp .env.example .env
# 修改 DP_COMPANY_CODE, SAP 参数等
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### company_code 预埋
- 所有 WMS 核心表 + 审计日志包含 `company_code VARCHAR(20) NOT NULL` (无 DEFAULT，数据库层强制非空)
- n8n 工作流通过 `$env.DP_COMPANY_CODE` 注入
- 唯一约束包含 company_code (如 `idx_documents_type_number`)
- 三重防御: NOT NULL 约束 + CHECK (company_code <> '') + `fn_enforce_company_code()` 触发器

---

## WMS 业务模块

| 模块 | 代码 | SAP 对应 | 说明 |
|------|------|---------|------|
| 销售拣货 | SO | ORDR/RDR1 | 按单拣货 |
| 生产收货 | WO | OWOR/WOR1 | 生产收货 |
| 采购收货 | PO | OPOR/POR1 | 按单收货 |
| 库存调拨 | TR | OWTQ/WTQ1 | 仓间调拨 |
| 盘点 | IC | — | 全量/增量盘点 |
| 库位移动 | LM | — | 仓内移库 |
| 生产领料 | PI | OWOR/WOR1 | 按工单 BOM 领料 |

### 实时库存公式
```
实时库存 = SAP 夜间快照 + 当日未过账入库 - 当日未过账出库
```
实现: `wms.v_stock_realtime` 视图 (快照表 LEFT JOIN 未过账事务聚合)

### 悲观锁机制
- `locked_by` + `locked_at` + `locked_session` (crypto.randomUUID)
- 多标签页隔离: 不同标签页有不同 session ID (sessionStorage 固化)
- 锁超时: 应用层控制
- 管理工作流: `wf13-lock.json` (Acquire/Release/Check)

---

## WMS 数据库 Schema

### 11 表
| 表名 | 说明 | company_code |
|------|------|:---:|
| `wms_documents` | 统一单据头 (7 种 doc_type) | ✅ |
| `wms_document_lines` | 统一行项目 (FK → documents) | ❌ (FK 隔离) |
| `wms_transactions` | 操作事务日志 | ✅ |
| `wms_stock_snapshot` | SAP 库存快照 (每夜同步) | ✅ |
| `wms_items_cache` | 主数据: 物料缓存 | ❌ |
| `wms_locations_cache` | 主数据: 仓库缓存 | ❌ |
| `wms_bins_cache` | 主数据: 库位缓存 | ❌ |
| `wms_users` | ~~用户管理~~ DEPRECATED (v0.3.1, SSO 替代) | ✅ |
| `wms_system_settings` | 系统配置 (K-V) | ❌ |
| `wms_id_sequences` | 原子序列生成器 | ❌ |
| `wms_audit_log` | 审计日志 (只增不删不改) | ✅ |

### 4 视图
| 视图名 | 说明 |
|--------|------|
| `v_document_summary` | 单据汇总 (行数+数量+完成率) |
| `v_pending_export` | 待导出单据 (completed 且未 exported) |
| `v_daily_activity` | 每日活动统计 |
| `v_stock_realtime` | 实时库存 (快照+未过账增量) |

### OMS Schema (v0.1.14+)
| 表名 | 说明 | company_code |
|------|------|:---:|
| `oms.orders` | 订单头 (SO/PO/WO/TR/DD, parent_id 自引用) | ✅ |
| `oms.order_lines` | 订单行 (planned_qty/picked_qty/packed_qty) | ❌ (FK 隔离) |
| `oms.order_events` | 订单事件日志 (同步/拆单/状态变更) | ❌ |
| `oms.audit_logs` | 审计日志 (只增不删不改) | ✅ |

| 视图名 | 说明 |
|--------|------|
| `oms.v_order_summary` | 订单汇总 (行数+数量+完成率+DD 数) |
| `oms.v_dd_lineage` | DD 血缘树 (源订单→DD 子单层级) |

### AI 预留表
| 表名 | Schema | 说明 |
|------|--------|------|
| `ai_embeddings` | ai | 向量嵌入 (vector(1536)，RAG 检索) |

### 通用触发器函数
| 函数 | 说明 |
|------|------|
| `fn_updated_at()` | 自动更新 updated_at |
| `fn_synced_at()` | 自动更新 synced_at (缓存表) |
| `fn_enforce_company_code()` | 阻止空 company_code |
| `fn_prevent_audit_log_tampering()` | 禁止审计日志 UPDATE/DELETE (append-only 不可变性保护) |

---

## n8n 工作流

### 命名规范
```
wf{编号}-{功能}.json

编号规则:
  0a, 0b       → 初始化工具 (一次性运行, 默认停用)
  1a~1e        → SAP 单据查询 (按业务类型细分)
  02~09        → 核心业务 + 数据同步
  10~13        → 系统管理
  20~22        → OMS 订单管理
```

### 工作流一览 (22 个)
| 分类 | 编号 | 功能 | 触发方式 |
|------|------|------|---------|
| 初始化 | 0a, 0b | 期初主数据/库存灌库 | 手动 (默认停用) |
| SAP 查询 | 1a~1e | WO/PO/SO/TR/PI 单据查询 (1c 含 DD) | GET /wms/{type} |
| 核心业务 | 02~05 | 事务/单据管理/单据查询/物料导出 | Webhook |
| 数据同步 | 06~10 | 物料/仓库/库存/库位缓存同步 | Cron + 手动 |
| 系统管理 | 11~13 | 主数据/库位新增/并发锁 | Webhook |
| OMS | 20~22 | SAP 订单同步/订单查询/DD 拆单 | Cron + Webhook |

### 统一模式
```
Webhook → Code(校验) → PostgreSQL/MS SQL(查询) → Code(转换) → Respond(返回JSON)
```

### SAP 查询预填模式 (v0.1.3)
SAP 单据查询工作流 (wf1a~wf1e) 在返回数据的同时，将 SAP 全量行预填到 `wms_document_lines`:
```
SAP 查询 → Merge Data → [Prepare Prefill SQL] → [Prefill WMS] → Respond
```
- CTE 原子操作: `WITH doc AS (INSERT INTO documents... RETURNING id) INSERT INTO lines...`
- `ON CONFLICT`: 不覆盖已有 WMS 数据 (actual_qty/status/wms_status 以 WMS 为准)
- 解决 Auto Complete 过早完成单据的问题 (确保所有 SAP 行在 WMS 可见)

所有工作流使用 `$env.DP_COMPANY_CODE` 进行 company_code 过滤。

---

## CI/CD

### GitHub Actions CI (ci.yml — 12 Jobs)

| Job | 说明 |
|-----|------|
| `compose-validate` | docker-compose × 3 配置语法验证 |
| `env-completeness` | 环境变量声明完整性 |
| `pg-schema-test` | PostgreSQL 17 + Schema 部署 + 表/视图/索引验证 + SQL 行为测试 |
| `security-audit` | 硬编码密钥 + changeme_ 检测 + Secret Key 长度 + .env 未 tracked + N8N_ENCRYPTION_KEY |
| `wms-integrity` | 前端必要文件 + 缓存版本一致性 |
| `shellcheck` | Shell 脚本静态分析 (scripts/ + 04_wms_seed.sh + entrypoint.sh) |
| `wms-unit-test` | WMS 前端单元测试 (Jest + Node.js 20) |
| `eslint` | ESLint 静态分析 (零错误零警告 + 警告上限 10) |
| `image-build` | WMS + BI Docker 镜像构建测试 |
| `infra-test` | 基建测试 (BATS 132 用例 + pytest 107 用例) |
| `nginx-validate` | Nginx 开发环境路由配置验证 (`nginx -t`) |
| `workflow-validate` | n8n 工作流 JSON 语法 + 硬编码敏感值检测 |

### E2E 测试 (e2e-tests.yml — 独立工作流)

| Job | 说明 |
|-----|------|
| `playwright-e2e` | Playwright E2E 测试 (153 场景 14 文件，python3 http.server + Network Interception) |

**触发条件**: 仅在 `apps/wms/**`、`tests/e2e/**`、`playwright.config.js` 变更时运行 (非每次 CI 全量触发)

---

## 自进化协议

当你 (AI) 在本项目中工作时:

1. **读取本文件**: 每次会话开始先读 CLAUDE.md
2. **遵守规则**: 严格遵循上述禁止和必须规则
3. **更新记录**: 重要架构变更后更新本文件
4. **技能积累**: 将可复用模式记录到 `.claude/skills/`
5. **ADR 记录**: 重要决策写入 `docs/ADR/`

### 变更日志

> 完整历史变更日志见 [PLAN.md § 已完成版本摘要](PLAN.md)

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-03-16 | v0.3.3 | WMS 体验优化: IC 盘点仓库名自动补齐, 库位新增 blur 竞态修复 (addBinToDict), 标星库位双击移除, SSO 登录页统一 301 重定向 (WMS/BI/Grafana), env.js SSO_ENABLED 注入, 7 页面 async 函数 window 挂载, PC 宽屏自适应布局 (1100/1280px), 库存表格横向滚动, 缓存版本号 phase20.12 |
| 2026-03-15 | v0.3.2 | 安全加固+OMS 触发器修复: nginx CSP/Permissions-Policy 安全头 (security-headers include 解决 location 继承丢失), SSL 密码套件收紧 (ECDHE+AESGCM), Redis 安全加固 (显式 bind + 禁用 FLUSHALL/FLUSHDB/DEBUG/KEYS), PG 容器间 SSL (自签名证书, 全部连接加密), OMS 触发器同步 (3 函数从 init SQL 同步), wms_sessions 表删除, landing 联系邮箱环境变量化 (DP_CONTACT_EMAIL), 代码审核修复 (SQL注入/XSS/HSTS/API超时/wf逻辑修正), grafana-oss→grafana (ARM64兼容), .env.example 精简, CI Node.js 20→22 |

---

## 架构演进记录

| # | 日期 | 版本 | 决策 | 状态 | 原因 | 未来 |
|---|------|------|------|------|------|------|
| 1 | 2026-02-22 | v0.1 | n8n 使用 regular 执行模式 | ✅ Accepted | 单节点部署，queue 需额外 worker 容器 | v1.0 评估 queue+worker |
| 2 | 2026-02-22 | v0.1 | company_code VARCHAR(20) NOT NULL 无 DEFAULT | ✅ Accepted | 长度预留 + CHECK + 触发器三重防御 | v1.0 RLS 行级安全 |
| 3 | 2026-02-22 | v0.1 | BI search_path=bi,wms | ✅ Accepted | 零 ETL 跨 Schema JOIN | — |
| 4 | 2026-02-22 | v0.1 | pg_dump -Fc 自定义格式 | ✅ Accepted | 并行恢复 + 选择性恢复 + 自带压缩 | — |
| 5 | 2026-02-22 | v0.1 | N8N_ENCRYPTION_KEY 强制无默认值 | ✅ Accepted | compose 启动即报错，防遗忘 | — |
| 6 | 2026-02-22 | v0.1 | PI 模块对应 OWOR/WOR1 (非 OIGE) | ✅ Accepted | 按工单 BOM 领料，非库存总账发料 | — |
| 7 | 2026-02-22 | v0.1 | .env.example 密码空值 (非 changeme_) | ✅ Accepted | 消除弱密码攻击面，空值强制用户配置 | — |
| 8 | 2026-02-22 | v0.1 | n8n 编辑器独立端口/子域名 (不走网关子路径) | ✅ Accepted | 官方 BUG n8n-io/n8n #18596 #19635 | 持续观察上游修复 |
| 9 | 2026-02-22 | v0.1 | Docker 外部网络 (DP_DOCKER_NETWORK) | ✅ Accepted | 网络名可配置 (默认 n8network)，dev-up.sh 自动创建，兼容多项目共存 | — |
| 10 | 2026-02-25 | v0.1.3 | SAP 查询工作流预填 wms_document_lines | ✅ Accepted | 防止 Auto Complete 过早完成单据 (仅操作过的行 ≠ 全量行) | — |
| 11 | 2026-02-25 | v0.1.3 | 扫码枪去重防护 (SCAN_DEDUP_MS=800) | ✅ Accepted | 工业扫码枪 100-300ms 连发导致重复提交 | — |
| 12 | 2026-02-26 | v0.1.4 | 手机摄像头扫码兜底 (camera-fallback.js) | ✅ Accepted | PDA 无扫码枪时 iOS/Android 摄像头替代，非侵入式零修改后端 | — |
| 13 | 2026-02-26 | v0.1.4 | WMS 测试环境独立子域名 + 动态 nginx | ✅ Accepted | 测试环境与生产隔离，dp-wms-test 容器按需启停不影响网关 | — |
| 14 | 2026-02-26 | v0.1.5 | 原生 BarcodeDetector 硬件加速 + 多帧确认 | ✅ Accepted | 优先使用浏览器原生 API (性能更优)，多帧确认兜底防误读 | — |
| 15 | 2026-02-27 | v0.1.5 | 三环境配置 (.env.dev/.env.uat/.env.prod) | ✅ Accepted | --env-file 切换，删除 dev.yml WEBHOOK_URL 覆盖 | — |
| 16 | 2026-02-27 | v0.1.5 | BI MSSQL 双驱动 (pyodbc + pymssql) + 自愈 | ✅ Accepted | pyodbc 需 TrustServerCertificate; pymssql 无 SSL 问题; entrypoint 自愈防镜像更新后依赖丢失 | CI/CD 推镜像到 GHCR |
| 17 | 2026-02-28 | v0.1.7 | 快照双触发器 (手动=昨天/Cron=今天) | ✅ Accepted | 手动补拉昨天 23:59 收盘库存，Cron 拉当日收盘 | — |
| 18 | 2026-02-28 | v0.1.7 | SAP 日期比较智能同步 (/sync/check) | ✅ Accepted | SAP UpdateDate vs PG synced_at 精确对比，避免无效同步浪费资源 | — |
| 19 | 2026-03-01 | v0.1.10 | env.js 多容器隔离 (/var/run/wms-env/) | ✅ Accepted | 防止多容器写入同一 env.js 产生竞态条件 | — |
| 20 | 2026-03-01 | v0.1.10 | 全量 SQL 注入消除 (n8n 参数化 + Python 变量绑定) | ✅ Accepted | OWASP Top 1 风险; 12 工作流 + 7 脚本全面修复 | — |
| 21 | 2026-03-01 | v0.1.10 | 审计日志数据库层不可变性保护 | ✅ Accepted | 仅应用层 "只增不删" 不够; 触发器阻止 UPDATE/DELETE | — |
| 22 | 2026-03-01 | v0.1.10 | n8n 遥测关闭 (N8N_DIAGNOSTICS_ENABLED=false) | ✅ Accepted | 消除 CORS 刷屏日志; 数据不外泄 | — |
| 23 | 2026-03-01 | v0.1.10 | Istanbul VM 沙盒插桩与 DOM API 动态委托 (测试基建) | ✅ Accepted | Node.js vm.Script 环境下 Jest 无法收集覆盖率 + Audio API 缺失导致测试崩溃; 手动插桩穿透沙盒达 92% 覆盖率，DOM 动态委托保障核心业务 100% 可测 | — |
| 24 | 2026-03-03 | v0.1.14 | OMS 独立 Schema (oms.*) + DD 拆单模型 | ✅ Accepted | OMS 关注"可执行性" (哪些订单可下发 WMS)，与 WMS 关注"执行过程"职责分离; 独立 Schema 避免 WMS 表膨胀 (4→16 表); parent_id 自引用 + split_seq 支持 DD 无限拆分; 幂等键防网络重试重复创建 | v0.2 跨 Schema 触发器 (WMS→OMS 状态回写) |
| 25 | 2026-03-04 | v0.1.15 | n8n 工作流逻辑剥离为纯函数库 (apps/wf/lib/) | ✅ Accepted | n8n Code 节点内嵌 JS 无法单测; 剥离核心逻辑为纯函数后可 Jest 覆盖; wf08 库存 4 维聚合 + wf22 DD mapper 已提取 | 更多工作流逻辑提取 |
| 26 | 2026-03-04 | v0.1.15 | 页面级 JS 模块化 (7 个独立 .js 文件) | ✅ Accepted | 各业务页面逻辑从 HTML 内联脚本提取到独立 JS 文件 (so/wo/po/tr/ic/lm/pi.js); 便于单元测试 + 缓存优化 + 代码复用 | — |
| 27 | 2026-03-06 | v0.1.16 | OMS↔WMS 双向状态联动 (DD 拣货回写 + SO 柜号聚合) | ✅ Accepted | DD 拣货完成后自动回写 SO picked_qty (跨 DD 聚合); SO 列表通过 parent_id + source_doc_number 双路径聚合 DD 子单柜号; 搜索与展示逻辑统一 | v0.2 可观测性 |
| 28 | 2026-03-10 | v0.2.0 | Prometheus + Grafana + Alertmanager 全栈可观测性 | ✅ Accepted | 8 容器 profile:monitoring; Prometheus distroless (无 shell 减少攻击面); nginx 变量 proxy_pass 优雅降级 (监控未启动时 503 JSON); dp_monitor 独立 PG 账号 (pg_monitor 最小权限); Redis 双独立 exporter (multi-target 不支持 per-target 密码); external-url 自动派生 route-prefix (无 nginx rewrite) | v0.3 Loki + Promtail 日志聚合 |
| 29 | 2026-03-11 | v0.3.0 | Authelia SSO 统一认证 (WMS+BI+Grafana+监控全覆盖) | ✅ Accepted | Authelia v4.39.15 轻量 (<50 用户); profiles:sso 按需启停; DP_SSO_ENABLED 开关零侵入降级; PG 统一存储 (authelia schema); 独立 dp-cache-sso Redis (noeviction 防 session eviction); 双域名 Cookie (本地+Tunnel); 4 头防伪造; Superset 6.0 FLASK_APP_MUTATOR 绕过; n8n 保持独立认证 | v0.4 OIDC (Google OAuth) |

---

## 系统边界原则

- **AI 只能建议，不可直接操作**: AI 不可直接改库存、不可自动过账 SAP、不可绕过审批
- **单一数据库不可拆分**: PostgreSQL 17 一库六 Schema 是架构护城河
- **逻辑隔离优于物理隔离**: company_code 过滤而非多库

---

## 已知技术债

| # | 技术债 | 优先级 | 计划版本 |
|---|--------|--------|---------|
| 1 | 未实现 RLS (行级安全) | 高 | v1.0 |
| 2 | 前端无构建工具 (原生 HTML/JS) | 低 | v1.0+ |
| 3 | 缓存表 (items/locations/bins) 缺少 company_code (v1.0 多租户需补) | 中 | v1.0 |

