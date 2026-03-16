# DP 数字大脑 — 新系统部署实施手册

> **版本**: v0.3.3 | **日期**: 2026-03-15 | **适用**: 全新服务器部署

---

## 目录

1. [部署前准备](#1-部署前准备)
2. [环境配置 (.env)](#2-环境配置)
3. [启动容器](#3-启动容器)
4. [数据库初始化验证](#4-数据库初始化验证)
5. [n8n 工作流部署](#5-n8n-工作流部署)
6. [BI 数据可视化配置](#6-bi-数据可视化配置)
7. [部署后验证](#7-部署后验证)
8. [SSO 统一认证部署 (可选)](#8-sso-统一认证部署-可选)
9. [可观测性部署 (可选)](#9-可观测性部署-可选)
10. [生产环境专项](#10-生产环境专项)
11. [备份与恢复](#11-备份与恢复)
12. [日常维护](#12-日常维护)
13. [故障排查](#13-故障排查)
14. [附录](#附录)

---

## 1. 部署前准备

### 1.1 硬件要求

| 项目 | 最低 | 推荐 |
|------|------|------|
| CPU | 2 核 | 4 核 |
| 内存 | 4 GB | 8 GB |
| 磁盘 | 20 GB | 50 GB (SSD) |
| 网络 | 局域网 | 局域网 + 外网 |

### 1.2 软件要求

```
必须安装:
  - Docker Engine 24+ (含 Docker Compose v2)
  - Git
  - Python 3.8+ (工作流同步脚本需要)

验证命令:
  docker --version          # Docker version 24.x+
  docker compose version    # Docker Compose version v2.x+
  git --version
  python3 --version
```

### 1.3 平台差异速查

| 项目 | Ubuntu/Linux | macOS | WSL2 (Windows) |
|------|-------------|-------|----------------|
| 数据目录 | `/opt/dp-data` | `/Users/<用户>/Docker/dp-data` | `/home/<用户>/docker/dp` |
| n8n 数据目录 | `/opt/dp-data/n8n` | `/Users/<用户>/Data/N8N` | `/mnt/d/Data/N8N` |
| 权限处理 | `chown` 确保 docker 可写 | Docker Desktop 自动处理 | 避免 `/mnt/` 路径 (性能差) |
| 文件共享 | 无需额外配置 | Docker Desktop → Settings → Resources → File Sharing 添加目录 | 无需额外配置 |

### 1.4 获取代码

```bash
git clone https://github.com/foodsaid/dp.git
cd Digital-Platform
```

### 1.5 架构总览

```
浏览器/PDA → dp-gateway (nginx:80/443)
               ├─ auth_request   → dp-sso (Authelia, SSO 认证)
               ├─ /              → landing/index.html (导航首页, 公开)
               ├─ /auth/         → dp-sso (SSO 登录门户, 公开)
               ├─ /wms/          → dp-wms-web (WMS 前端, SSO 保护)
               ├─ /api/wms/      → dp-wf (n8n webhook, SSO bypass)
               ├─ /api/webhook/  → dp-wf (n8n 原生 webhook, SSO bypass)
               ├─ /superset/     → dp-bi (BI 数据可视化, SSO 保护)
               ├─ /grafana/      → dp-grafana (仪表板, SSO 保护)
               ├─ /prometheus/   → dp-prometheus (指标, SSO 保护)
               ├─ /alertmanager/ → dp-alertmanager (告警, SSO 保护)
               ├─ /ai/           → 503 预留
               └─ /*             → 404 JSON (未知路径兜底)

独立入口: wf.域名 (子域名 server block, 不纳入 SSO)
               └─ /*             → dp-wf (n8n 编辑器 + WebSocket)

数据库:  dp-db (PostgreSQL 17, 6 Schema: wms/oms/wf/bi/ai/authelia)
缓存:    dp-cache-wf  (Redis, Bull 队列 + WMS 会话)
         dp-cache-bi  (Redis, BI 缓存 + Celery)
         dp-cache-sso (Redis, SSO 会话, noeviction)
SSO:     dp-sso (Authelia 4.39.15, file backend + PG + Redis)
监控:    dp-prometheus + dp-grafana + dp-alertmanager + 5 exporter
```

8 个核心容器 + 2 SSO 容器 (profile: sso) + 8 监控容器 (profile: monitoring) + 3 可选容器 (tunnel/certbot/dns)

---

## 2. 环境配置

### 2.1 创建 .env 文件

```bash
# 快速启动 (7 核心容器, 无 SSO/监控):
cp .env.dev.example .env    # 开发环境最小配置

# 完整部署 (含 SSO + 监控):
cp .env.example .env.dev    # 开发 (localhost 直连)
cp .env.example .env.uat    # UAT  (域名, Cloudflare Tunnel)
cp .env.example .env.prod   # 生产 (正式域名, HTTPS)
```

### 2.2 生成密码

所有密码字段留空 = 容器启动失败。请用以下命令生成:

```bash
# 生成一个 32 字符随机密码
openssl rand -base64 32

# 一次性生成多个 (复制粘贴到 .env)
for i in 1 2 3 4 5 6; do echo "密码$i: $(openssl rand -base64 32)"; done
```

### 2.3 完整变量配置表

以下按 .env 文件中的顺序逐项说明。**标记 [必填] 的不可留空**。

#### Docker Compose 叠加

```ini
# 开发/UAT:
COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml
# 生产:
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
```

#### Docker 网络

```ini
# 外部网络名 (多项目可独立)
DP_DOCKER_NETWORK=n8network
```

#### 全局

```ini
# [必填] 数据卷根目录 (bind-mount)
DP_DATA_DIR=./data
# 例: /opt/dp-data (Linux), /Users/xx/Docker/dp-data (macOS)

# [必填] 时区 — 按实际部署地区修改
SYSTEM_TIMEZONE=UTC
# 例: Asia/Bangkok / Asia/Shanghai / America/New_York 等

# [必填] 公司编码 (多租户标识)
DP_COMPANY_CODE=ACME
# [必填] 公司名称
DP_COMPANY_NAME=ACME Corp
```

#### PostgreSQL

```ini
# [必填] 超级用户密码
DP_DB_ROOT_PASSWORD=<openssl rand -base64 32 的输出>
# 数据库名 (一般不改)
DP_DB_NAME=dp
# 应用用户名 (一般不改)
DP_DB_USER=<自定义用户名>
# [必填] 应用用户密码
DP_DB_PASSWORD=<openssl rand -base64 32 的输出>
# 宿主机暴露端口 (仅开发环境有效)
DP_DB_PORT=5432
# 注: v0.3.3+ PG 自动启用 SSL (自签名证书, 09_enable_ssl.sh)
# 注: WMS 管理员已废弃 (v0.3.1+, SSO 替代), 无需配置 DP_WMS_ADMIN_*
```

#### Redis

```ini
# [必填] 工作流队列 Redis 密码
DP_REDIS_WF_PASSWORD=<openssl rand -base64 32 的输出>
DP_REDIS_WF_PORT=6379

# [必填] BI 缓存 Redis 密码
DP_REDIS_BI_PASSWORD=<openssl rand -base64 32 的输出>
DP_REDIS_BI_PORT=6380
```

#### n8n 工作流引擎

```ini
# n8n 文件节点数据目录 (留空默认 ./data/n8n-data)
DP_N8N_DATA_DIR=
# n8n 宿主机端口
DP_WF_PORT=5678

# ⚠️ [必填] 三环境不同! ⚠️
WEBHOOK_URL=http://localhost:5678          # DEV
# WEBHOOK_URL=https://wf.example.com      # UAT/PROD
N8N_EDITOR_BASE_URL=http://localhost:5678/ # DEV
# N8N_EDITOR_BASE_URL=https://wf.example.com/ # UAT/PROD

# ⚠️ [必填] 凭据加密密钥 — 首次设置后永不更改!
N8N_ENCRYPTION_KEY=<openssl rand -base64 32 的输出>
# API Key (部署后填写, 用于工作流同步)
N8N_API_KEY=

# 注: DB_POSTGRESDB_*、QUEUE_BULL_*、GENERIC_TIMEZONE 等由 compose 自动派生,
# 无需在 .env 中配置 (compose 从 DP_DB_*、DP_REDIS_WF_*、SYSTEM_TIMEZONE 读取)
```

#### WMS 前端

```ini
DP_WMS_WEB_PORT=8081

# 环境标识: development / staging / production
ENV_NAME=development
# API 基础路径 (所有环境统一，必须是相对路径!)
API_BASE_URL=/api/wms
# QR 码服务 (无则留空)
QR_SERVICE_URL=
# 应用 URL (留空 = 相对路径，推荐)
APP_BASE_URL=
# 功能开关
SOUND_ENABLED=true
AUTO_FOCUS_DELAY=100
DEBUG=true
APP_VERSION=v0.3.3
```

#### BI 数据可视化

```ini
# [必填] BI 密钥 (≥32 字符)
DP_BI_SECRET_KEY=<openssl rand -base64 48 的输出>
# [必填] BI 管理员用户名
DP_BI_ADMIN_USERNAME=<自定义管理员用户名>
# [必填] BI 管理员密码
DP_BI_ADMIN_PASSWORD=<强密码>
DP_BI_ADMIN_EMAIL=admin@example.com
DP_BI_PORT=8088
```

#### SAP 集成 (有 SAP 时必填)

```ini
# Service Layer (REST API, 首选)
SAP_SL_URL=https://<SAP服务器>:50000/b1s/v1
SAP_SL_COMPANY_DB=<SAP数据库名>
SAP_SL_USER=<SAP用户名>
SAP_SL_PASSWORD=<SAP密码>

# MSSQL 直连 (备选, 仅查询, BI 报表需要时填)
SAP_MSSQL_HOST=<SAP服务器IP>
SAP_MSSQL_PORT=1433
SAP_MSSQL_DATABASE=<SAP数据库名>
SAP_MSSQL_USER=<MSSQL用户名>
SAP_MSSQL_PASSWORD=<MSSQL密码>
```

#### 网关

```ini
DP_GATEWAY_PORT=8080
```

#### 生产环境专用 (开发环境可留空)

```ini
# Cloudflare Tunnel Token
DP_TUNNEL_TOKEN=
# Let's Encrypt 邮箱
DP_CERTBOT_EMAIL=
# WMS 测试环境域名 (留空不启用)
DP_WMS_TEST_DOMAIN=
```

### 2.4 三环境关键差异对照

| 变量 | `.env.dev` | `.env.uat` | `.env.prod` |
|------|-----------|-----------|------------|
| `COMPOSE_FILE` | `...dev.yml` | `...dev.yml` | `...prod.yml` |
| `WEBHOOK_URL` | `http://localhost:5678` | `https://wf.example.com` | `https://wf.公司.com` |
| `N8N_EDITOR_BASE_URL` | `http://localhost:5678/` | `https://wf.example.com/` | `https://wf.公司.com/` |
| `ENV_NAME` | `development` | `staging` | `production` |
| `DEBUG` | `true` | `true` | `false` |
| `DP_SSO_ENABLED` | `true` | `true` | `true` |

### 2.5 变量说明

> v0.3.3+ 简化: n8n 的 PG/Redis/时区连接参数由 compose 自动从 `DP_DB_*`、`DP_REDIS_WF_*`、`SYSTEM_TIMEZONE` 派生，无需手动保持一致。

---

## 3. 启动容器

### 3.1 创建 Docker 网络 (仅首次)

```bash
docker network create n8network
# 验证:
docker network ls | grep n8network
```

> 如果 .env 中改了 `DP_DOCKER_NETWORK`，则创建对应名称的网络。

### 3.2 创建数据目录

```bash
# 如果 DP_DATA_DIR 使用绝对路径:
mkdir -p /opt/dp-data       # Linux
mkdir -p ~/Docker/dp-data   # macOS
```

### 3.3 启动

**方式 A: 使用启动脚本 (推荐)**

```bash
# 开发环境
bash scripts/dev-up.sh --dev

# UAT 环境
bash scripts/dev-up.sh --uat

# 脚本自动执行: 平台检测 → 网络创建 → 权限预检 → docker compose up -d
```

**方式 B: 手动启动**

```bash
# 开发/UAT
docker compose --env-file .env.dev \
    -f docker-compose.yml \
    -f docker-compose.dev.yml \
    up -d

# 生产
docker compose --env-file .env.prod \
    -f docker-compose.yml \
    -f docker-compose.prod.yml \
    up -d
```

### 3.4 等待初始化

首次启动需要 1-3 分钟:
- dp-db: PostgreSQL 初始化 + Schema 创建 + 表创建 (约 30 秒)
- dp-wf: n8n 初始化 wf schema (约 30 秒)
- dp-bi: Superset 初始化 (约 60-90 秒，最慢)

```bash
# 观察启动日志
docker compose logs -f

# 等到所有容器就绪后 Ctrl+C 退出
```

### 3.5 健康检查

```bash
bash scripts/health-check.sh
```

预期输出:
```
=== DP 健康检查 ===
✅ dp-db: healthy
✅ dp-cache-wf: healthy
✅ dp-cache-bi: healthy
✅ dp-wms-web: healthy
✅ dp-wf: healthy
✅ dp-bi: healthy
✅ dp-gateway: healthy
ℹ️  dp-sso: 未启动 (profile: sso)
ℹ️  dp-cache-sso: 未启动 (profile: sso)
ℹ️  dp-tunnel: 未启动 (profile: production)
ℹ️  dp-prometheus: 未启动 (profile: monitoring)
ℹ️  dp-grafana: 未启动 (profile: monitoring)

✅ 所有核心服务正常
```

如果有 `⏳ starting`，等 30 秒再检查。如果有 `❌ unhealthy`，见 [故障排查](#13-故障排查)。

---

## 4. 数据库初始化验证

首次启动时，PostgreSQL 自动执行 `infrastructure/postgres/init/` 下 9 个脚本:

| 脚本 | 作用 |
|------|------|
| `01_extensions.sql` | 启用 pgvector + pg_trgm + uuid-ossp + pgcrypto |
| `02_schemas.sql` | 创建 6 个 Schema: wms, oms, wf, bi, ai, authelia |
| `03_wms_tables.sql` | 创建 12 张表 + 4 个视图 + 触发器 + 索引 |
| `04_wms_seed.sh` | 创建 WMS 管理员账号 (DEPRECATED, SSO 替代) |
| `05_oms_tables.sql` | 创建 OMS Schema: 4 张表 + 2 个视图 + 触发器 + 索引 |
| `06_monitoring_user.sh` | 创建监控账号 (dp_monitor, pg_monitor 权限) |
| `07_sso_schema.sh` | 创建 SSO authelia Schema + 授权 |
| `08_sso_users.sql` | SSO 用户管理表 (数据库为源, 同步到 users.yml) |
| `09_enable_ssl.sh` | PostgreSQL SSL 自签名证书 (容器间加密通信) |

### 验证命令

> **提示**: 以下 `psql` 命令使用 `.env` 中的 `DP_DB_USER`/`DP_DB_NAME`，请确保已 `source .env`。

```bash
# 进入数据库
source .env && docker exec -it dp-db psql -U "$DP_DB_USER" -d "$DP_DB_NAME"

# 查看 Schema
\dn
#  wms      | <DP_DB_USER>
#  oms      | <DP_DB_USER>
#  wf       | <DP_DB_USER>
#  bi       | <DP_DB_USER>
#  ai       | <DP_DB_USER>
#  authelia | <DP_DB_USER>

# 查看 WMS 表
SET search_path TO wms;
\dt
#  11 张表: wms_documents, wms_document_lines, wms_transactions, ...

# 查看视图
\dv
#  4 个视图: v_document_summary, v_pending_export, v_daily_activity, v_stock_realtime

# 验证管理员账号 (SSO 启用后改查 authelia schema)
SELECT username, display_name FROM authelia.sso_users;
#  应返回 SSO 中配置的用户

# 退出
\q
```

> 如果表为空，检查 `docker logs dp-db` 是否有初始化错误。

---

## 5. n8n 工作流部署

这是整个部署中最关键的一步。共 22 个工作流 JSON 文件在 `apps/wf/` 目录下。

### 5.1 首次访问 n8n

```
浏览器打开: http://localhost:5678  (开发环境)
           或 https://wf.域名.com  (UAT/生产)
```

1. **创建管理员账号** — 首次访问时 n8n 要求设置 owner 账号
2. 设置邮箱、密码 (这是 n8n 编辑器的登录凭据，与 WMS 无关)
3. 登录后进入编辑器界面

### 5.2 创建凭据 (Credentials)

工作流需要两个数据库凭据:

#### PostgreSQL 凭据

```
n8n 编辑器 → 左侧菜单 → Credentials → Add Credential
  Type:     Postgres
  Name:     DP-PostgreSQL (名称随意，记住即可)
  Host:     dp-db
  Port:     5432
  Database: <DP_DB_NAME 的值, 默认 dp>
  User:     <DP_DB_USER 的值, 默认 dp_app>
  Password: <DP_DB_PASSWORD 的值>
  SSL:      Require (v0.3.3+ PG 已启用 SSL, 自签名证书)
  → Save → 测试连接
```

#### MSSQL 凭据 (有 SAP 时必填)

```
n8n 编辑器 → Credentials → Add Credential
  Type:     Microsoft SQL
  Name:     SAP-MSSQL (名称随意，记住即可)
  Host:     <SAP 服务器 IP>
  Port:     1433
  Database: <SAP 数据库名>
  User:     <MSSQL 用户名>
  Password: <MSSQL 密码>
  → Save → 测试连接
```

### 5.3 获取凭据 ID (导入前必须)

```bash
# 查询刚创建的凭据 ID
docker exec dp-db psql -U "$DP_DB_USER" -d "$DP_DB_NAME" -c \
  "SELECT id, name, type FROM wf.credentials_entity;"

# 记下输出，例如:
#   id   |     name      |    type
# -------+---------------+----------
#  abc12 | DP-PostgreSQL | postgres
#  def34 | SAP-MSSQL     | microsoftSql
```

### 5.4 获取项目 ID 和用户 ID

```bash
# 项目 ID
docker exec dp-db psql -U "$DP_DB_USER" -d "$DP_DB_NAME" -c \
  "SELECT id, name, type FROM wf.project;"
# 记下 type = 'personal' 的 id

# 用户 ID
docker exec dp-db psql -U "$DP_DB_USER" -d "$DP_DB_NAME" -c \
  "SELECT id, email FROM wf.\"user\";"
# 记下 owner 用户的 id
```

### 5.5 替换工作流占位符

仓库中的工作流 JSON 使用占位符 (不含任何实例凭据)。部署前需要替换:

| 占位符 | 替换为 | 来源 |
|--------|--------|------|
| `__CREDENTIAL_PG_ID__` | PostgreSQL 凭据 ID | 步骤 5.3 |
| `__CREDENTIAL_PG_NAME__` | PostgreSQL 凭据名 | 步骤 5.2 中你取的名字 |
| `__CREDENTIAL_MSSQL_ID__` | MSSQL 凭据 ID | 步骤 5.3 |
| `__CREDENTIAL_MSSQL_NAME__` | MSSQL 凭据名 | 步骤 5.2 中你取的名字 |
| `__PROJECT_ID__` | personal project ID | 步骤 5.4 |
| `__CREATOR_ID__` | owner 用户 ID | 步骤 5.4 |
| `user@example.com` | 管理员邮箱 | 步骤 5.1 创建的邮箱 |
| `Deploy User` | 管理员姓名 | 步骤 5.1 创建的姓名 |

**Python 批量替换脚本:**

```python
#!/usr/bin/env python3
"""占位符替换脚本 — 部署前在 apps/wf/ 目录执行"""
import glob

# ========== 按实际值填写 ==========
REPLACE_MAP = {
    "__CREDENTIAL_PG_ID__":     "abc12",           # ← 改为实际 PG 凭据 ID
    "__CREDENTIAL_PG_NAME__":   "DP-PostgreSQL",   # ← 改为实际 PG 凭据名
    "__CREDENTIAL_MSSQL_ID__":  "def34",           # ← 改为实际 MSSQL 凭据 ID
    "__CREDENTIAL_MSSQL_NAME__":"SAP-MSSQL",       # ← 改为实际 MSSQL 凭据名
    "__PROJECT_ID__":           "proj-xxx",         # ← 改为实际 project ID
    "__CREATOR_ID__":           "user-xxx",         # ← 改为实际 user ID
    "user@example.com":         "admin@acme.com",  # ← 改为实际管理员邮箱
    "Deploy User":              "Admin",           # ← 改为实际管理员姓名
}
# ==================================

count = 0
for fpath in sorted(glob.glob("apps/wf/wf*.json")):
    with open(fpath) as f:
        content = f.read()
    original = content
    for placeholder, actual in REPLACE_MAP.items():
        content = content.replace(placeholder, actual)
    if content != original:
        with open(fpath, 'w') as f:
            f.write(content)
        count += 1
        print(f"  ✅ 已替换: {fpath}")

print(f"\n共处理 {count} 个文件")
```

```bash
# 执行:
python3 replace_placeholders.py
```

### 5.6 创建 n8n API Key

```
n8n 编辑器 → 左侧菜单 → Settings → n8n API → Create API Key
→ 复制生成的 Key (格式: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
```

### 5.7 导入工作流

**推荐: 使用同步脚本 (一键完成)**

```bash
N8N_API_KEY="你的API-Key" \
DP_DB_USER=<DP_DB_USER 的值> \
DP_DB_NAME=<DP_DB_NAME 的值> \
N8N_API_PORT=5678 \
python3 scripts/n8n-tools/sync-workflows.py
```

脚本自动执行:
1. 删除所有旧工作流
2. 重启 n8n
3. 复制 JSON 到容器 + 注入 ID
4. CLI 批量导入
5. API 逐个激活
6. 验证最终状态

预期输出:
```
找到 22 个工作流文件

=== 步骤 1: 删除所有旧工作流 ===
  ℹ️ 无旧工作流

=== 步骤 2: 重启 n8n ===
  ✅ n8n 已启动

=== 步骤 3: 复制文件到容器 ===
  ✅ 已复制 22 个文件

=== 步骤 4: n8n CLI 导入 ===
  (导入日志)

=== 步骤 5: API 激活 ===
  ✅ wf02-transaction
  ✅ wf03-document-management
  ... (21 个激活)
  ⏸ wf0a-init-masterdata (停用，期初工具)
  ⏸ wf0b-init-inventory  (停用，期初工具)

  激活: 21/23

=== 最终验证 ===
  ✅ wf02-transaction
  ✅ wf03-document-management
  ...
  ⏸ wf0a-init-masterdata
  ⏸ wf0b-init-inventory

  总计: 23 工作流, 21 激活, ~35 webhook
```

### 5.8 导入后关键修复

```bash
# 修复 activeVersionId (import 不设置此字段 → webhook 不注册)
docker exec dp-db psql -U "$DP_DB_USER" -d "$DP_DB_NAME" -c "
SET search_path TO wf;
UPDATE workflow_entity
SET \"activeVersionId\" = \"versionId\"
WHERE \"activeVersionId\" IS NULL;"

# 重启 n8n 使 webhook 注册生效
docker restart dp-wf

# 等待启动后验证
sleep 10
docker logs dp-wf 2>&1 | tail -20
# 应看到: "Activated workflow xxx" 的日志
```

### 5.9 验证工作流

```bash
# 检查工作流状态
docker exec dp-db psql -U "$DP_DB_USER" -d "$DP_DB_NAME" -c "
SELECT
    CASE WHEN active THEN '✅' ELSE '⏸' END AS status,
    name
FROM wf.workflow_entity
ORDER BY name;"

# 检查 webhook 注册数量 (应为 35 左右)
docker exec dp-db psql -U "$DP_DB_USER" -d "$DP_DB_NAME" -c "
SELECT COUNT(*) AS webhook_count FROM wf.webhook_entity;"

# 测试一个 API (仪表板)
curl -s http://localhost:5678/webhook/wms/dashboard \
  -H "Content-Type: application/json" | python3 -m json.tool
```

### 5.10 工作流一览

| 编号 | 文件名 | 功能 | 触发 | 激活? |
|------|--------|------|------|:-----:|
| 0a | wf0a-init-masterdata.json | 期初主数据灌库 | 手动 | ⏸ 停用 |
| 0b | wf0b-init-inventory.json | 期初库存导入 | 手动 | ⏸ 停用 |
| 02 | wf02-transaction.json | 事务提交 | Webhook | ✅ |
| 03 | wf03-document-management.json | 单据管理 | Webhook | ✅ |
| 04 | wf04-document-query.json | 单据查询 | Webhook | ✅ |
| 05 | wf05-item-export-dashboard.json | 物料/导出/仪表板 | Webhook | ✅ |
| 06 | wf06-items-sync.json | 物料缓存同步 | Cron 19:00 | ✅ |
| 07 | wf07-locations-sync.json | 仓库缓存同步 | Cron 19:00 | ✅ |
| 08 | wf08-stock-query.json | 库存查询 | Webhook | ✅ |
| 09 | wf09-stock-snapshot.json | 库存快照同步 | Cron 22:00 | ✅ |
| 10 | wf10-bin-sync.json | 库位缓存同步 | Cron 19:30 | ✅ |
| 11 | wf11-masterdata.json | 主数据查询 | Webhook | ✅ |
| 12 | wf12-bin-add.json | 新增库位 | Webhook | ✅ |
| 13 | wf13-lock.json | 单据锁管理 | Webhook | ✅ |
| 1a | wf1a-wo-lookup.json | 生产订单查询 | Webhook | ✅ |
| 1b | wf1b-po-lookup.json | 采购订单查询 | Webhook | ✅ |
| 1c | wf1c-so-lookup.json | 销售订单查询 | Webhook | ✅ |
| 1d | wf1d-tr-lookup.json | 转储申请查询 | Webhook | ✅ |
| 1e | wf1e-pi-lookup.json | 生产领料查询 | Webhook | ✅ |
| 20 | wf20-oms-sync.json | OMS SAP 订单同步 (Cron 19:30 + 手动) | Cron + 手动 | ✅ |
| 21 | wf21-oms-query.json | OMS 订单查询 + 明细 | Webhook | ✅ |
| 22 | wf22-oms-dd.json | OMS DD 拆单管理 | Webhook | ✅ |

---

## 6. BI 数据可视化配置

### 6.1 首次登录

```
浏览器打开: http://localhost:8088 (开发, 仅本机可达)
           或 https://域名/bi      (UAT/生产, 通过网关)

用户名: <DP_BI_ADMIN_USERNAME 的值>
密码:   <DP_BI_ADMIN_PASSWORD 的值>
```

> 首次登录可能需要 60+ 秒 (Superset 初始化数据库)

### 6.2 添加数据库连接

#### PostgreSQL (WMS 数据)

```
Settings → Database Connections → + DATABASE
  选择: PostgreSQL
  HOST: dp-db
  PORT: 5432
  DATABASE: <DP_DB_NAME 的值>
  USERNAME: <DP_DB_USER 的值>
  PASSWORD: <DP_DB_PASSWORD 的值>
  DISPLAY NAME: DP-PostgreSQL

  Advanced → Other → 添加:
    options: -c search_path=bi,wms

  → Test Connection → Connect
```

> `search_path=bi,wms` 允许 BI 直接查询 WMS 表 (零 ETL)

#### MSSQL (SAP B1, 可选)

```
Settings → Database Connections → + DATABASE
  选择: Microsoft SQL Server
  SQLALCHEMY URI:
    mssql+pymssql://用户:密码@SAP服务器IP:1433/SAP数据库名
  DISPLAY NAME: SAP-MSSQL
  → Test Connection → Connect
```

> 如果 pymssql 连接失败，试:
> `mssql+pyodbc://用户:密码@SAP服务器IP:1433/SAP数据库名?driver=ODBC+Driver+18+for+SQL+Server&TrustServerCertificate=yes`

> MSSQL 密码含特殊字符 (@#$% 等) 需要 URL 编码 (如 `@` → `%40`)

---

## 7. 部署后验证

### 7.1 服务访问清单

| 服务 | 开发环境 URL | 说明 |
|------|-------------|------|
| 网关首页 | http://localhost:8080 | 导航页 |
| WMS 前端 | http://localhost:8080/wms/ | 通过网关 (SSO 保护) |
| WMS 前端 (直连) | http://localhost:8081 | 绕过网关 |
| BI 可视化 | http://localhost:8080/superset/ | 通过网关 (SSO 保护) |
| BI 可视化 (直连) | http://localhost:8088 | 仅本机 |
| n8n 编辑器 | http://localhost:5678 | 仅本机 (独立认证) |
| SSO 登录门户 | http://localhost:8080/auth/ | 公开 (profile: sso) |
| Grafana | http://localhost:8080/grafana/ | SSO 保护 (profile: monitoring) |
| Prometheus | http://localhost:8080/prometheus/ | SSO 保护 (profile: monitoring) |
| Alertmanager | http://localhost:8080/alertmanager/ | SSO 保护 (profile: monitoring) |
| PostgreSQL | localhost:5432 | 仅本机 |

### 7.2 核心功能验证

```bash
# 1. 网关健康
curl -s http://localhost:8080/health
# → {"status":"ok","service":"dp-gateway","proto":"http"}

# 2. n8n 健康
curl -s http://localhost:5678/healthz
# → {"status":"ok"}

# 3. WMS 前端 env.js 注入
docker exec dp-wms-web cat /var/run/wms-env/env.js
# 应看到 window.__ENV = { ... } 配置

# 4. SSO 身份端点
curl -s http://localhost:8080/api/auth/whoami
# 401 = 未登录 (正常); 登录后返回用户信息

# 5. BI 健康
curl -s http://localhost:8088/health
# 应返回 OK
```

### 7.3 PDA/手机测试

在同一局域网的手机浏览器中访问:
```
http://<服务器局域网IP>:8080/wms/
```
- 登录 → 仪表板 → 选择一个业务模块 → 扫码测试
- 如无扫码枪: 连点页面标题 5 次 → 激活摄像头扫码

---

## 8. SSO 统一认证部署 (可选)

> SSO 使用 Authelia v4.39.15，通过 nginx `auth_request` 实现前置认证。默认关闭 (`DP_SSO_ENABLED=false`)，按需启用。

### 8.1 前置条件

- 核心容器已正常运行 (dp-db / dp-gateway / dp-wms-web 等)
- `.env` 中已配置所有 `DP_SSO_*` 变量 (见 2.3 节)

### 8.2 生成 SSO 密钥

```bash
# SSO 需要 4 个独立密钥 (hex 格式, 避免 base64 的 +/= 破坏 .env 解析)
echo "DP_SSO_JWT_SECRET=$(openssl rand -hex 64)"
echo "DP_SSO_SESSION_SECRET=$(openssl rand -hex 64)"
echo "DP_SSO_STORAGE_ENCRYPTION_KEY=$(openssl rand -hex 64)"
echo "DP_SSO_REDIS_PASSWORD=$(openssl rand -hex 32)"

# 将输出复制到 .env 对应字段
```

### 8.3 创建用户文件

```bash
# 从模板创建 (users.yml 已被 .gitignore)
cp infrastructure/sso/users.yml.example infrastructure/sso/users.yml
```

### 8.4 启动 SSO 容器

```bash
# 启用 SSO 总开关
# 编辑 .env: DP_SSO_ENABLED=true

# 启动 SSO 容器 (dp-sso + dp-cache-sso)
docker compose --profile sso up -d

# 重启网关 (加载 SSO auth_request 配置)
docker compose restart dp-gateway

# WMS 无需额外操作 (v0.3.1+ SSO 始终生效, 无需 SSO_ENABLED 开关)
```

### 8.5 生成用户密码

```bash
# 在 Authelia 容器内生成 argon2id 哈希
docker exec dp-sso authelia crypto hash generate argon2 --password '你的密码'

# ⚠️ 密码必须用单引号! 双引号会被 shell 转义导致哈希不一致
# 将输出的哈希写入 infrastructure/sso/users.yml (单引号包裹)

# 重启 SSO 使用户生效
docker restart dp-sso
```

### 8.6 验证 SSO

```bash
# 1. 容器健康
docker compose ps dp-sso dp-cache-sso

# 2. 检查 SSO 配置渲染 (无 __PLACEHOLDER__ 残留)
docker exec dp-sso cat /tmp/configuration.yml | grep -E '__|domain|cookie'

# 3. 检查 nginx SSO 配置
docker exec dp-gateway cat /etc/nginx/dynamic/sso-auth.inc

# 4. 测试 whoami 端点
curl -s http://localhost:8080/api/auth/whoami
# 401 = 未登录 (正常)

# 5. 浏览器测试
# 访问 http://localhost:8080/wms/ → 应跳转 Authelia 登录页
# 登录后 → 正常进入 WMS
```

### 8.7 域名与 Cookie 配置

| 环境 | `DP_DOMAIN` | `DP_SSO_COOKIE_DOMAIN` | `DP_SSO_BASE_URL` |
|------|------------|----------------------|------------------|
| 开发 | `127.0.0.1` | `127.0.0.1` | `https://127.0.0.1:<SSO端口>` (mkcert) |
| UAT/生产 | `<你的域名>` | `<你的域名>` | `https://<你的域名>` |

> 如使用 Cloudflare Tunnel, 需额外设置 `DP_SSO_TUNNEL_DOMAIN` 和 `DP_SSO_TUNNEL_COOKIE_DOMAIN`

### 8.8 SSO 故障排查

| 症状 | 原因 | 修复 |
|------|------|------|
| "SSO 暂不可用" (503) | dp-sso 未启动 | `docker compose --profile sso up -d` |
| 登录后仍跳回 /auth/ | Cookie 域名不匹配 | 检查 `DP_SSO_COOKIE_DOMAIN` |
| BI 全白屏/403 | SSO 用户角色为 Public | 改 `AUTH_USER_REGISTRATION_ROLE` 为 Alpha |
| Tunnel 访问被拒 | 缺少 Tunnel 域名 | 设置 `DP_SSO_TUNNEL_DOMAIN` |

> 详细教训参考: `.claude/skills/authelia-sso-integration.md` (16 项)

---

## 9. 可观测性部署 (可选)

> Prometheus + Grafana + Alertmanager 全栈监控, 通过 `profile: monitoring` 按需启动。

### 9.1 启动监控容器

```bash
# 初始化数据目录权限 (Prometheus 以 nobody:65534 运行)
mkdir -p "${DP_DATA_DIR:-./data}/prometheus"
chmod 777 "${DP_DATA_DIR:-./data}/prometheus"

# 启动 8 个监控容器
docker compose --profile monitoring up -d

# 重启网关 (加载 /grafana/ 等子路径路由)
docker compose restart dp-gateway
```

### 9.2 验证监控

```bash
# 健康检查 (应显示 8 个监控容器)
bash scripts/health-check.sh

# Grafana (默认账号: admin / DP_GRAFANA_ADMIN_PASSWORD)
curl -s http://localhost:8080/grafana/api/health
# → {"commit":"...","database":"ok","version":"12.4.1"}

# Prometheus targets
curl -s http://localhost:8080/prometheus/api/v1/targets | python3 -m json.tool
# 应有 8 个 scrape target

# Alertmanager
curl -s http://localhost:8080/alertmanager/api/v2/status | python3 -m json.tool
```

### 9.3 预置仪表板

Grafana 启动后自动加载 4 个仪表板 (provisioning):

| 仪表板 | 说明 |
|--------|------|
| DP Overview | 宿主机 + 容器 + 告警总览 |
| DP n8n | n8n 工作流运行时指标 |
| DP PostgreSQL | 数据库连接 + 事务 + 缓存 |
| DP Redis | 双 Redis 实例 (WF 队列 + BI 缓存) |

### 9.4 告警规则

10 组告警规则已预配置 (`infrastructure/monitoring/prometheus/rules/dp-alerts.yml`):
- 宿主机: CPU/内存/磁盘/磁盘预测
- 容器: 高内存/重启
- 服务: n8n/PG/Redis 不可用
- 通知渠道: 在 `infrastructure/monitoring/alertmanager/alertmanager.yml` 中配置

---

## 10. 生产环境专项

> 以下步骤仅生产环境需要，开发/UAT 可跳过。

### 10.1 域名准备

```
1. 域名注册 (如 acme-dp.com)
2. Cloudflare DNS 托管
3. 创建 DNS 记录:
   - app.acme-dp.com  → A 记录 → 服务器公网 IP (DNS only, 非代理)
   - wf.acme-dp.com   → A 记录 → 服务器公网 IP (DNS only, 非代理)
```

### 10.2 修改 nginx 配置

需要手动修改 **2 个文件共 6 处**:

#### 文件 1: `infrastructure/nginx/conf.d-prod/default.conf`

替换 `example.com` 为实际域名 (共 4 处):

```
第 38 行:  server_name app.example.com;  →  server_name app.acme-dp.com;
第 161 行: server_name app.example.com;  →  server_name app.acme-dp.com;
第 285 行: server_name wf.example.com;   →  server_name wf.acme-dp.com;
第 329 行: server_name wf.example.com;   →  server_name wf.acme-dp.com;
```

#### 文件 2: `infrastructure/nginx/conf.d-prod/ssl-params.conf`

替换证书路径 (共 2 处):

```
第 8 行: ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
      →  ssl_certificate     /etc/letsencrypt/live/acme-dp.com/fullchain.pem;

第 9 行: ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
      →  ssl_certificate_key /etc/letsencrypt/live/acme-dp.com/privkey.pem;
```

### 10.3 Cloudflare API Token (SSL 证书)

```bash
# 1. Cloudflare Dashboard → My Profile → API Tokens → Create Token
#    模板: "Edit zone DNS"
#    权限: Zone > DNS > Edit (仅此一项!)
#    范围: Specific zone > acme-dp.com
#    不要选 Account 级权限!

# 2. 创建配置文件
cp infrastructure/certbot/cloudflare.ini.example infrastructure/certbot/cloudflare.ini

# 3. 填入 Token
vim infrastructure/certbot/cloudflare.ini
# 内容: dns_cloudflare_api_token = 你的TOKEN

# 4. 设置权限 (必须! certbot 拒绝 world-readable 文件)
chmod 600 infrastructure/certbot/cloudflare.ini
```

### 10.4 生成 SSL 证书

```bash
docker compose --env-file .env.prod \
    -f docker-compose.yml \
    -f docker-compose.prod.yml \
    --profile certbot run --rm dp-certbot

# 成功后证书存储在: ${DP_DATA_DIR}/certbot/live/acme-dp.com/
```

### 10.5 Cloudflare Tunnel

```
1. Cloudflare Dashboard → Zero Trust → Access → Tunnels
2. Create a tunnel → 命名 → 获取 Token
3. 将 Token 填入 .env.prod 的 DP_TUNNEL_TOKEN
4. 配置 Public Hostname:
   - app.acme-dp.com → http://dp-gateway:80
   - wf.acme-dp.com  → http://dp-gateway:80
```

### 10.6 Split DNS (工厂内网直连)

如果工厂路由器不支持静态 DNS:

```bash
# 1. 配置 dnsmasq
cp infrastructure/dns/dnsmasq.conf.example infrastructure/dns/dnsmasq.conf

# 2. 修改为服务器局域网 IP
vim infrastructure/dns/dnsmasq.conf
# address=/app.acme-dp.com/192.168.1.100
# address=/wf.acme-dp.com/192.168.1.100

# 3. 启动 DNS 容器
docker compose --env-file .env.prod \
    -f docker-compose.yml \
    -f docker-compose.prod.yml \
    --profile dns up -d dp-dns

# 4. 将工厂 PDA 的 DNS 指向此服务器 IP
```

效果: 工厂内 PDA 直接走局域网访问 (快速)，外部用户走 Cloudflare Tunnel (安全)。

### 10.7 启动生产环境

```bash
docker compose --env-file .env.prod \
    -f docker-compose.yml \
    -f docker-compose.prod.yml \
    up -d

# 验证
bash scripts/health-check.sh
curl -kI https://app.acme-dp.com/health
curl -kI https://wf.acme-dp.com/healthz
```

### 10.8 证书自动续期

```bash
crontab -e

# 添加 (每月 1 号和 15 号凌晨 3 点):
0 3 1,15 * * /home/deploy/Digital-Platform/scripts/cert-renew.sh >> /var/log/dp-cert-renew.log 2>&1
```

---

## 11. 备份与恢复

### 11.1 数据库备份

```bash
# 执行备份 (pg_dump 自定义格式, 含 6 个 Schema)
bash scripts/backup.sh

# 输出:
# ✅ 备份完成: ./backups/dp_backup_20260301_120000.dump (12M)
```

建议设置定时备份:
```bash
crontab -e
# 每天凌晨 2 点备份
0 2 * * * cd /home/deploy/Digital-Platform && bash scripts/backup.sh >> /var/log/dp-backup.log 2>&1
```

### 11.2 数据库恢复

```bash
# 1. 复制备份到容器
docker cp ./backups/dp_backup_20260301_120000.dump dp-db:/tmp/dp_backup.dump

# 2. 恢复
docker exec dp-db pg_restore \
    -U "$DP_DB_USER" \
    -d "$DP_DB_NAME" \
    --clean \
    --if-exists \
    /tmp/dp_backup.dump

# 3. 清理临时文件
docker exec dp-db rm -f /tmp/dp_backup.dump

# 4. 重启 n8n (刷新缓存)
docker restart dp-wf
```

### 11.3 重要: 保管好这些密钥

| 密钥 | 位置 | 影响 |
|------|------|------|
| `N8N_ENCRYPTION_KEY` | .env | 丢失 = 所有 n8n 凭据作废，需重建 |
| `DP_DB_ROOT_PASSWORD` | .env | 丢失 = 无法管理数据库 |
| `DP_BI_SECRET_KEY` | .env | 丢失 = BI 会话全部失效 |
| `DP_SSO_STORAGE_ENCRYPTION_KEY` | .env | 丢失 = SSO 存储数据无法解密 |
| `DP_SSO_JWT_SECRET` | .env | 丢失 = SSO 身份令牌无效 |
| Cloudflare API Token | cloudflare.ini | 丢失 = 无法续期证书 |

> 建议: 将 .env 文件加密备份到安全位置 (非 Git!)

---

## 12. 日常维护

### 12.1 修改 .env 后生效

```bash
# ⚠️ docker restart 不读取新的 .env!
# 必须用 up -d 重建容器:
docker compose --env-file .env.uat up -d <容器名>

# 例: 修改了 WEBHOOK_URL
docker compose --env-file .env.uat up -d dp-wf
```

### 12.2 查看日志

```bash
# 实时跟踪
docker compose logs -f dp-wf        # n8n
docker compose logs -f dp-gateway    # 网关
docker compose logs -f dp-db         # 数据库

# 最近 100 行
docker logs --tail 100 dp-wf
```

### 12.3 更新工作流

修改 `apps/wf/` 中的 JSON 后:

```bash
# 重新同步 (会删除所有旧工作流再导入)
N8N_API_KEY="你的Key" python3 scripts/n8n-tools/sync-workflows.py

# 同步后修复 activeVersionId
docker exec dp-db psql -U "$DP_DB_USER" -d "$DP_DB_NAME" -c "
SET search_path TO wf;
UPDATE workflow_entity
SET \"activeVersionId\" = \"versionId\"
WHERE \"activeVersionId\" IS NULL;"

docker restart dp-wf
```

### 12.4 更新代码

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 重建需要更新的容器
docker compose --env-file .env.uat up -d --build dp-wms-web dp-bi

# 3. 如果工作流有变更，重新同步 (见 10.3)
```

### 12.5 期初数据灌库

首次上线需要从 SAP 灌入主数据和库存:

```bash
# 在 n8n 编辑器中:
# 1. 打开 wf0a-init-masterdata → 手动执行 (灌入物料/仓库/库位)
# 2. 打开 wf0b-init-inventory  → 手动执行 (灌入库存快照)
# 执行完毕后保持停用 (这两个是一次性工具)
```

---

## 13. 故障排查

### 容器启动失败

```bash
# 查看失败原因
docker logs dp-wf    # 哪个容器有问题就看哪个

# 常见原因:
# "password authentication failed" → .env 中密码不一致 (见 2.5 一致性检查)
# "role xxx does not exist"       → DP_DB_USER 配置错误
# "database xxx does not exist"   → DP_DB_NAME 配置错误
```

### n8n 凭据丢失

```
原因: N8N_ENCRYPTION_KEY 被修改或丢失
修复: 恢复原来的 N8N_ENCRYPTION_KEY → docker compose up -d dp-wf
预防: 永远不要修改 N8N_ENCRYPTION_KEY!
```

### WMS 前端白屏

```bash
# 检查 env.js 是否生成
docker exec dp-wms-web cat /var/run/wms-env/env.js
# 如果为空 → docker compose restart dp-wms-web

# 检查 API 是否通
curl -s http://localhost:8080/api/wms/auth/login -X POST -H "Content-Type: application/json" -d '{}'
# 如果 502 → dp-wf 未启动或 webhook 未注册
```

### n8n webhook 返回 404

```bash
# 检查 webhook 注册状态
docker exec dp-db psql -U "$DP_DB_USER" -d "$DP_DB_NAME" -c \
  "SELECT COUNT(*) FROM wf.webhook_entity;"
# 如果为 0 → 执行步骤 5.8 修复 activeVersionId

# 检查工作流是否激活
docker exec dp-db psql -U "$DP_DB_USER" -d "$DP_DB_NAME" -c \
  "SELECT name, active FROM wf.workflow_entity WHERE active = false;"
```

### 502 Bad Gateway

```bash
# nginx 检查上游容器是否存活
docker ps -a  # 看哪个容器没有 running

# nginx 重载 (容器重建后可能需要)
docker exec dp-gateway nginx -t      # 先验证配置
docker exec dp-gateway nginx -s reload  # 再重载
```

### Cron 工作流不执行

```bash
# 检查时区设置
docker exec dp-wf env | grep TIMEZONE
# GENERIC_TIMEZONE 应与 SYSTEM_TIMEZONE 一致

# 查看 n8n 日志中的调度信息
docker logs dp-wf 2>&1 | grep -i "cron\|schedule"
```

---

## 附录

### A. 一键部署快速清单

给有经验的运维人员的精简步骤:

```bash
# 1. 准备
git clone https://github.com/foodsaid/dp.git && cd Digital-Platform
# 快速启动 (无 SSO/监控):
cp .env.dev.example .env && vim .env       # 填写密码字段
# 完整部署 (含 SSO/监控):
# cp .env.example .env.uat && vim .env.uat

# 2. 启动
bash scripts/dev-up.sh
# 等待 2 分钟

# 3. 验证
bash scripts/health-check.sh

# 4. n8n 首次设置
# 浏览器打开 http://localhost:5678 → 创建 owner → 创建凭据

# 5. 部署工作流
# 查询凭据ID → 替换占位符 → 运行同步脚本
docker exec dp-db psql -U "$DP_DB_USER" -d "$DP_DB_NAME" -c "SELECT id, name, type FROM wf.credentials_entity;"
vim replace_placeholders.py   # 填入实际ID
python3 replace_placeholders.py
N8N_API_KEY="xxx" python3 scripts/n8n-tools/sync-workflows.py

# 6. 修复 + 重启
docker exec dp-db psql -U "$DP_DB_USER" -d "$DP_DB_NAME" -c "
  SET search_path TO wf;
  UPDATE workflow_entity SET \"activeVersionId\" = \"versionId\" WHERE \"activeVersionId\" IS NULL;"
docker restart dp-wf

# 7. 期初数据 (n8n 编辑器中手动执行 wf0a + wf0b)

# 8. SSO (可选)
# .env: DP_SSO_ENABLED=true + 填写 DP_SSO_* 密钥
cp infrastructure/sso/users.yml.example infrastructure/sso/users.yml
docker compose --profile sso up -d
docker compose restart dp-gateway

# 9. 监控 (可选)
mkdir -p "${DP_DATA_DIR:-./data}/prometheus" && chmod 777 "${DP_DATA_DIR:-./data}/prometheus"
docker compose --profile monitoring up -d
docker compose restart dp-gateway
```

### B. 容器端口映射总览

| 容器 | 内部端口 | 开发端口 (host) | 绑定地址 | 生产 | Profile |
|------|---------|----------------|---------|------|---------|
| dp-gateway | 80 | 8080 | 0.0.0.0 | 80+443 | 核心 |
| dp-wms-web | 80 | 8081 | 0.0.0.0 | 无 (仅网关) | 核心 |
| dp-wf | 5678 | 5678 | 127.0.0.1 | 无 (仅网关) | 核心 |
| dp-bi | 8088 | 8088 | 127.0.0.1 | 无 (仅网关) | 核心 |
| dp-db | 5432 | 5432 | 127.0.0.1 | 无 | 核心 |
| dp-cache-wf | 6379 | 6379 | 127.0.0.1 | 无 | 核心 |
| dp-cache-bi | 6379 | 6380 | 127.0.0.1 | 无 | 核心 |
| dp-sso | 9091 | 9091 | 127.0.0.1 | 无 (仅网关) | sso |
| dp-cache-sso | 6379 | — | — | 无 | sso |
| dp-prometheus | 9090 | 9090 | 127.0.0.1 | 无 (仅网关) | monitoring |
| dp-alertmanager | 9093 | 9093 | 127.0.0.1 | 无 (仅网关) | monitoring |
| dp-grafana | 3000 | 3000 | 127.0.0.1 | 无 (仅网关) | monitoring |

> `0.0.0.0` = 局域网可达 (手机/PDA)，`127.0.0.1` = 仅本机

### C. 数据库表结构速查

```
wms Schema — 11 张表:
  wms_documents          单据头 (7 种 doc_type)
  wms_document_lines     单据行 (FK → documents)
  wms_transactions       操作事务日志
  wms_stock_snapshot     库存快照 (每夜同步)
  wms_items_cache        物料缓存
  wms_locations_cache    仓库缓存
  wms_bins_cache         库位缓存
  wms_users              用户 (DEPRECATED, v0.3.1 SSO 替代)
  wms_system_settings    系统设置 (K-V)
  wms_id_sequences       序列生成器
  wms_audit_log          审计日志 (只增不删)

wms Schema — 4 个视图:
  v_document_summary     单据汇总
  v_pending_export       待导出单据
  v_daily_activity       每日活动
  v_stock_realtime       实时库存 (快照 + 增量)

oms Schema — 4 张表:
  oms.orders             订单头 (SO/PO/WO/TR/DD, parent_id 自引用)
  oms.order_lines        订单行 (planned_qty/picked_qty/packed_qty)
  oms.order_events       订单事件日志 (同步/拆单/状态变更)
  oms.audit_logs         审计日志 (只增不删不改)

oms Schema — 2 个视图:
  oms.v_order_summary    订单汇总 (行数+数量+完成率+DD 数)
  oms.v_dd_lineage       DD 血缘树 (源订单→DD 子单层级)

authelia Schema — Authelia 自动管理:
  (SSO 会话/身份验证/TOTP/WebAuthn 等, Authelia 内部管理)

ai Schema — 预留:
  ai_embeddings          向量嵌入 (vector(1536), RAG 检索)
```

### D. 网关路由表

```
入口 A: 主域名 (dp-gateway)
  /                   → 导航首页 (精确匹配, SSO bypass)
  /auth/              → dp-sso (SSO 登录门户, 公开)
  /api/auth/whoami    → dp-sso (统一身份端点, 5s micro-cache)
  /wms/               → dp-wms-web (WMS 前端, SSO 保护)
  /api/wms/           → dp-wf (/webhook/wms/..., SSO bypass)
  /api/webhook/       → dp-wf (n8n webhook 透传, SSO bypass)
  /api/webhook-test/  → dp-wf (n8n webhook 测试, SSO bypass)
  /superset/          → dp-bi (BI 引擎, SSO 保护)
  /bi | /bi/          → 302 重定向 BI 欢迎页
  /grafana/           → dp-grafana (仪表板, SSO 保护)
  /prometheus/        → dp-prometheus (指标, SSO 保护, admins 组)
  /alertmanager/      → dp-alertmanager (告警, SSO 保护, admins 组)
  /static/            → dp-bi (7 天缓存)
  /ai/                → 503 预留
  /health             → 200 JSON (网关健康检查)
  /*                  → 404 JSON (未知路径兜底)

入口 B: wf 子域名 (独立 server block, 不纳入 SSO)
  /*                  → dp-wf (n8n 编辑器 + WebSocket)
```

### E. 占位符反向替换 (导出回仓库)

从运行中的 n8n 导出工作流后，提交 Git 前必须将实际值替换回占位符:

```python
#!/usr/bin/env python3
"""反向替换 — 导出工作流后脱敏"""
import glob

# 与正向替换相反: 实际值 → 占位符
REVERSE_MAP = {
    "abc12":             "__CREDENTIAL_PG_ID__",
    "DP-PostgreSQL":     "__CREDENTIAL_PG_NAME__",
    "def34":             "__CREDENTIAL_MSSQL_ID__",
    "SAP-MSSQL":         "__CREDENTIAL_MSSQL_NAME__",
    "proj-xxx":          "__PROJECT_ID__",
    "user-xxx":          "__CREATOR_ID__",
    "admin@acme.com":    "user@example.com",
    "Admin":             "Deploy User",
}

for fpath in sorted(glob.glob("apps/wf/wf*.json")):
    with open(fpath) as f:
        content = f.read()
    for actual, placeholder in REVERSE_MAP.items():
        content = content.replace(actual, placeholder)
    with open(fpath, 'w') as f:
        f.write(content)
    print(f"  ✅ 脱敏: {fpath}")
```

---

> 本手册基于 DP v0.3.3 编写。如有问题，请联系系统管理员。
