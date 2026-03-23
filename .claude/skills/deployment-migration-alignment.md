# 部署迁移对齐 SOP (新环境 / 机器迁移)

> **版本**: v1.0
> **创建日期**: 2026-03-21
> **依据来源**: macOS 新环境从零对齐 v0.8.1 的完整踩坑复盘
> **核心认知**: `git pull` 只同步代码文件，不等于环境对齐。数据库、n8n、容器三者都需要独立处理。

---

## 一、对齐 ≠ 仅仅拉代码

### 完整的对齐包含四个层次

```
Layer 1: 代码文件 (git pull)          ← 仅此一步是不够的！
Layer 2: 数据库 Schema               ← 必须手动执行迁移脚本
Layer 3: n8n 工作流 + 凭证           ← 必须通过 API 同步，且要对齐历史版本
Layer 4: 容器镜像 + 运行状态          ← 代码变更后必须重建
```

遗漏任何一层，都会出现"代码是对的但运行是错的"的幽灵问题。

---

## 二、完整对齐执行顺序

### Step 1: 拉取最新代码
```bash
git pull origin main
```
**检查 git log**，识别每个提交的影响范围：
- `feat: WMS 解耦 SAP` → n8n 工作流变更
- `feat: DB 审计热补丁` → DDL 迁移脚本
- `fix: wf20a 同步优化` → n8n 工作流变更
- `chore: 容器镜像升级` → 需要重建容器

---

### Step 2: 数据库迁移脚本

**原则**：`infrastructure/postgres/init/` 下的脚本按序号顺序执行，新增脚本必须补跑。

#### 2.1 检查已执行到哪一步
```bash
# 查现有 schema 和关键表
docker exec dp-db psql -U $DP_DB_USER -d $DP_DB_NAME -c "\dn"
docker exec dp-db psql -U $DP_DB_USER -d $DP_DB_NAME -c "\dt oms.*"
```

#### 2.2 逐个核对脚本是否已执行
```bash
# 用脚本内的特征对象验证 (比直接跑脚本更安全)
docker exec dp-db psql -U $DP_DB_USER -d $DP_DB_NAME -c "
SELECT
  EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name='core') AS core_schema,
  EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='oms' AND tablename='wms_alerts') AS wms_alerts,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='oms' AND table_name='orders' AND column_name='sync_status') AS sync_status,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='oms' AND table_name='orders' AND column_name='expected_line_count') AS expected_line_count;
"
```

#### 2.3 执行缺失脚本 (所有脚本均幂等)
```bash
# 按序号执行缺失的脚本
docker exec -i dp-db psql -U $DP_DB_USER -d $DP_DB_NAME < infrastructure/postgres/init/17_wms_decouple_sap.sql
docker exec -i dp-db psql -U $DP_DB_USER -d $DP_DB_NAME < infrastructure/postgres/init/18_v08_db_audit_hotfixes.sql
```

#### 2.4 增量字段补丁 (脚本遗漏时手动补)
```bash
# 如 oms.sync_progress 新增字段未在热补丁里
docker exec dp-db psql -U $DP_DB_USER -d $DP_DB_NAME -c "
ALTER TABLE oms.sync_progress
  ADD COLUMN IF NOT EXISTS context JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_anchor_date DATE;
"
```

---

### Step 3: n8n 工作流同步

**⚠️ 三条铁律**：
1. **禁止从 Git JSON 整体导入** — Git 文件的凭据全是占位符 `__CREDENTIAL_*_ID__`，导入后所有节点失联
2. **必须通过 API GET → 精确修改 → PUT** — 先取线上版本（保留真实凭据），再合并 Git 的逻辑变更
3. **凭据 ID 必须从线上取** — 绝不猜测，先 `SELECT id, name, type FROM wf.credentials_entity`

#### 3.1 获取真实凭据 ID
```bash
docker exec dp-db psql -U $DP_DB_USER -d $DP_DB_NAME -t -A -c \
  "SELECT id, name, type FROM wf.credentials_entity ORDER BY type;"
```
典型输出：
```
ErNkuJo8qSS95epv|SAP B1|microsoftSql
7oUSCZ4trIFk83ew|DP PostgreSQL RLS|postgres
1Jz8VzGbtvebkUkb|DP PostgreSQL|postgres
```

#### 3.2 正确更新工作流的完整流程
```python
# 标准 API 更新模板 (见 n8n-database-operations.md 完整版)
ALLOWED_SETTINGS = {'executionOrder', 'callerPolicy', 'saveDataErrorExecution', ...}

for wf_id, name, git_file in workflows:
    # 1. GET 线上版本 (保留真实凭据)
    live_wf = api_get(wf_id)

    # 2. 从 Git 文件取新的 nodes/connections (仅逻辑)
    with open(git_file) as f:
        git_wf = json.load(f)

    # 3. 替换占位符为真实 ID (精确替换，不整体替换)
    wf_str = json.dumps(live_wf).replace('__CREDENTIAL_PG_ID__', PG_RLS_ID)...

    # 4. 过滤 settings (API 不接受 availableInMCP 等扩展字段)
    clean_settings = {k: v for k, v in wf_fixed['settings'].items() if k in ALLOWED_SETTINGS}

    # 5. deactivate → PUT → activate
    api_call('POST', f'/deactivate')
    api_call('PUT',  f'/{wf_id}', put_body)
    api_call('POST', f'/activate')
```

#### 3.3 凭证历史版本对齐 (新环境特有问题)

**背景**：v0.6 起所有 22 个工作流应切换到 `DP PostgreSQL RLS`，但新环境从未做过此操作。

**检查命令**：
```python
# 扫描所有工作流，找出还在用非 RLS 凭证的节点
for wf in all_workflows:
    for node in wf['nodes']:
        if node.get('credentials', {}).get('postgres', {}).get('name') == 'DP PostgreSQL':
            print(f'❌ {wf["name"]} / {node["name"]} 未使用 RLS 凭证')
```

**批量修复**：把所有 PG 节点的凭证从 `DP PostgreSQL` 替换为 `DP PostgreSQL RLS`，MSSQL 节点不动。

---

### Step 4: 容器重建

前端代码 (apps/wms/) 或 BI (apps/bi/) 变更后必须重建：
```bash
docker compose build dp-wms-web
docker compose up -d dp-wms-web

# landing 页 / nginx 配置变更后
docker restart dp-gateway
```

---

## 三、对齐检查清单 (每次迁移必过)

```
数据库层
□ 确认所有 init 脚本 (01~最新) 已按序执行
□ 核对关键表/字段是否存在 (用特征查询，不只看脚本列表)
□ 确认 core schema 存在 (v0.8+)
□ 确认 oms.wms_alerts / oms.orders.sync_status 等新字段 (v0.8+)

n8n 工作流层
□ 列出所有工作流及其凭证: 确认没有 __CREDENTIAL 占位符
□ 凭证版本对齐: PG 业务节点全用 DP PostgreSQL RLS, MSSQL 用 SAP B1
□ 功能版本对齐: 对比 git log，识别哪些工作流有逻辑更新，按 API SOP 更新
□ 更新后验证 active 状态和最近一次执行是否 success

容器层
□ 前端代码变更 → rebuild dp-wms-web
□ nginx/landing 变更 → restart dp-gateway
□ BI 变更 → rebuild dp-bi

.env 配置层
□ 对比 .env.example，确认无缺漏环境变量
□ N8N_ENCRYPTION_KEY 必须存在且非空
□ DP_DB_RLS_PASSWORD 必须配置 (否则 RLS 凭证无法连接)
```

---

## 四、版本历史 — 各版本引入的必做操作

| 版本 | 必须执行的额外操作 |
|------|-----------------|
| v0.6 | n8n 22 个工作流全切 `DP PostgreSQL RLS` 凭证 |
| v0.7 | `15_oms_sync_progress.sql` + `16_oms_sync_incremental.sql` |
| v0.8.0 | `17_wms_decouple_sap.sql` + wf1a~1e 切换为 PG OMS 查询 |
| v0.8.1 | `18_v08_db_audit_hotfixes.sql` + `oms.sync_progress` 补 context/last_anchor_date 字段 + wf20a 更新 |

---

## 五、wf20a 触发机制说明

```
主触发链路 (正常路径):
  wf20 夜间 Cron (21:00/21:15/21:30/21:45)
    → wf20-so/po/wo/tr 写 oms.sync_progress
    → HTTP 触发 wf20a /webhook/wms/oms/sync/next
    → wf20a 处理一批 → 链式触发下一批 (自调用)
    → 直到 sync_progress 全部 completed

兜底定时器 (安全网, 非主路径):
  每 1h 检查一次 sync_progress 是否有 pending 批次
  有 → 接管继续处理 (链断时的恢复机制)
  无 → 立即退出 (正常情况下每次仅耗时 < 1s)

❌ 常见误解: 以为 wf20a 在"每分钟轮询 SAP"
✅ 实际: 只是检查 PG 内部队列表，SAP 查询只在真正处理批次时才发生
```

---

## 六、踩坑记录

### 坑1: git pull 后直接启动，工作流报列不存在
- **现象**: wf20a 报 `column "sync_status" does not exist`
- **原因**: v0.8 的 `17_wms_decouple_sap.sql` 从未在本机执行
- **经验**: git 文件更新了，但 DB 没更新。**代码和 DB 是两条独立的轨道**。

### 坑2: 从 Git JSON 直接推送 nodes → 凭据失联
- **现象**: n8n 节点报 `Credential with ID '__CREDENTIAL_PG_ID__' does not exist`
- **原因**: Git 文件是脱敏版，占位符不是真实 ID
- **经验**: 永远 **GET 线上 → 精确修改 → PUT**，不要用 Git JSON 整体覆盖 nodes

### 坑3: 新环境没有历史版本的手动操作记录
- **现象**: wf1a~1e 仍用旧 MSSQL 凭证，wf02~22 用非 RLS 凭证
- **原因**: v0.6/v0.8 的凭证切换是在旧机器 n8n 里手动做的，Git 无记录
- **经验**: 迁移时必须对比 **版本历史表**，逐版补上每个版本的操作，不能只看 git diff

### 坑4: API settings 字段报 400
- **现象**: PUT 工作流时返回 `"request/body/settings must NOT have additional properties"`
- **原因**: n8n API 不接受 `availableInMCP`, `binaryMode` 等扩展字段
- **经验**: PUT 前过滤 settings，只保留 API 白名单字段

---

## 变更日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-03-21 | v1.0 | 初始创建: 基于 macOS 新环境 v0.8.1 对齐复盘 |
