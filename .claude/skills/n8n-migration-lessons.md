# n8n 工作流部署与运维教训

> **创建**: 2026-02-23
> **版本**: v4.0 (2026-03-23 新增教训 24-27: sync-workflows.py 误用/legacy 保护/凭据激活前检查/webhook 400 冲突)
> **权威来源**: n8n 工作流部署、凭据管理、跨环境迁移
> **另见**: `n8n-database-operations.md` (三表同步/FALSE-TRUE/API 精确更新)

---

## ⚠️ 每次部署必读 — 持续适用教训

### 教训 19: n8n API PUT 整体替换会覆盖手动修正
→ Git JSON 可能落后于线上，先 GET 对比再 PUT

### 教训 20: Git JSON 与线上 n8n 不同步是常态
→ 编辑器修改只存数据库，部署前必须 GET 线上对比

### 教训 21: 纯函数库字段名必须与 SQL 输出 + 前端完全对齐
→ SQL 输出 = 纯函数 = 前端消费，三方逐字段核对

### 教训 22: 单元测试使用错误字段名 = "假覆盖"
→ 测试数据必须从真实 SQL/API 取样，不凭记忆构造

### 教训 23: n8n Code 节点返回值格式必须配合 Respond to Webhook
→ Code 返回单个 item 包装: `return [{ json: { success: true, data: [...] } }]`

### 凭据脱敏占位符规则 (每次从 Git 导入工作流必查!)
```
Git JSON 中的凭据是脱敏占位符 (__CREDENTIAL_PG_ID__ 等)
导入线上前必须替换为真实凭据 ID:
  1. SELECT id, name, type FROM wf.credentials_entity;
  2. REPLACE 占位符 → 真实 ID/Name
  3. 同步 workflow_history
  4. docker restart dp-wf
❌ 绝不能直接导入含占位符的 JSON 到线上!
```

### 教训 24: sync-workflows.py 是核弹级操作 — git pull 后禁止使用
→ 该脚本会清除 DB 中**所有** wf* 工作流记录并重建，历史版本全部丢失；旧版本更会误删 legacy/自定义工作流
→ **仅适用于全新空环境**首次部署；日常 git pull 更新使用 API 单独更新变更文件
→ 若必须使用脚本，须先确认 `.env` 中已配置 `DP_CREDENTIAL_PG_ID/NAME` 和 `DP_CREDENTIAL_MSSQL_ID/NAME`

### 教训 25: 批量操作前必须盘点 DB vs Git 差异 — 禁止盲目删除
→ 任何删除/覆盖操作前先执行: `SELECT name FROM wf.workflow_entity ORDER BY name;`
→ 与 `ls apps/wf/wf*.json` 对比，DB 中有而 Git 中无的 = legacy/自定义工作流，**绝对不能删除**
→ 需要删除时必须明确列出清单，向用户确认后再操作

### 教训 26: 导入后激活前必须通过凭据占位符检查 — 有结果则停止
→ 含占位符的节点导入后 n8n 会静默「修正」名称字段 (如 `__CREDENTIAL_PG_NAME__` → `dp_app_rls`)，不报错
→ 看似成功实则凭据错误，运行时会因凭据 ID 不存在而失败
→ **激活前强制检查**: `SELECT name FROM wf.workflow_entity WHERE nodes::text LIKE '%__CREDENTIAL_%__%';`
→ 有任何结果 = 立即停止，用 SQL REPLACE 修复 entity + history 两张表，再激活
→ 修复 SQL 模板见 `n8n-database-operations.md` 的"git pull 后工作流更新 SOP"

### 教训 27: webhook 400 冲突多数是 n8n 内存残留 — 重启后逐个重试
→ 激活报 `{"message":"There is a conflict with one of the webhooks."}` 不一定是真实 DB 冲突
→ 先检查 DB 是否有重复: `SELECT "webhookPath", COUNT(*) FROM wf.webhook_entity GROUP BY 1 HAVING COUNT(*)>1;`
→ DB 无重复 = n8n 内部内存状态残留（通常由前一次失败激活留下）
→ 修复: `docker restart dp-wf dp-wf-worker` → 等 n8n 启动完毕 → **逐个** API 重试激活，不要并发

---

## 一、迁移中遇到的教训

> 标签说明: [持续适用] = 每次部署都可能遇到 | [历史参考] = 一次性迁移完成，部署 Ubuntu 服务器时可参考 | [→见其他文件] = 已有更详细的权威来源
>
> - 教训 1 (三表同步) → 见 `n8n-database-operations.md`
> - 教训 2 (MySQL→PG 语法) [历史参考 — Ubuntu 部署时可参考]
> - 教训 3 (FALSE/TRUE) → 见 `n8n-database-operations.md`
> - 教训 4 (UNION ALL 类型) [历史参考]
> - 教训 5 ($env 封锁) [持续适用]
> - 教训 6 (WEBHOOK_URL) [持续适用]
> - 教训 7 (env.js CDN) → 见 `frontend-cache-versioning.md`
> - 教训 8 (品牌硬编码) [历史参考]
> - 教训 9 (INSERT 列数) [持续适用]
> - 教训 10 (restart≠up) → 见 `docker-network-troubleshooting.md`
> - 教训 11 (connections 断链) [持续适用]
> - 教训 12 (PG 常量折叠) [持续适用]
> - 教训 13 (localStorage 限额) [持续适用]
> - 教训 14-15 (增量锚点/MSSQL 表达式) [持续适用]
> - 教训 16-18 (凭据跨项目/activeVersionId/Git 脱敏) [持续适用 — Ubuntu 部署必读]
> - 教训 19-27 → 见顶部"每次部署必读"摘要

### 教训 1: n8n 三表同步 — 不可忽略 workflow_history

**问题**: 直接改 `workflow_entity.nodes` 后重启 n8n，webhook 仍走旧路径。
**根因**: n8n 2.x 从 `workflow_history` (通过 `activeVersionId`) 读取发布版本。
**规则**:
```
修改数据库中工作流 = 必须同步三表:
1. workflow_entity (草稿)
2. workflow_history (发布版，activeVersionId 匹配)
3. webhook_entity (DELETE 全部，让 n8n 重建)
→ docker restart dp-wf
```

### 教训 2: MySQL → PostgreSQL 语法迁移需要多轮扫描

**问题**: 第一轮正则替换漏掉了许多边界情况。
**完整清单**:
```
Pass 1: 节点类型替换 (microsoftSql 凭证不变, MySQL→Postgres)
Pass 2: 静态 SQL 语法
  CURDATE()                        → CURRENT_DATE
  DATE_FORMAT(x,'%Y-%m-%d')       → TO_CHAR(x,'YYYY-MM-DD')
  IFNULL()                         → COALESCE()
  INSERT IGNORE                    → ON CONFLICT DO NOTHING
  ON DUPLICATE KEY UPDATE col=VALUES(col) → ON CONFLICT(key) DO UPDATE SET col=EXCLUDED.col
  CONCAT('[',GROUP_CONCAT(SEPARATOR ','),']') → json_agg(...)::text
  LAST_INSERT_ID()                 → RETURNING id
  DATE_SUB(NOW(),INTERVAL 24 HOUR) → NOW() - interval '24 hours'
  TINYINT(1)                       → BOOLEAN
  AUTO_INCREMENT                   → SERIAL
Pass 3: Code 节点内的 JS 模板字符串 SQL (容易遗漏!)
Pass 4: 全文残留扫描确认零遗漏
```

### 教训 3: FALSE/TRUE 跨语言陷阱

**问题**: 5 个工作流报错 `Invalid column name 'FALSE'` 或 `FALSE is not defined`。
**根因**: 原开发者混用了 Python/MySQL 的 FALSE 与 MSSQL/JS 的写法。
```
| 语境         | FALSE 含义        | 合法? | 正确写法          |
|-------------|-------------------|-------|------------------|
| MSSQL SQL   | 无此关键字(当列名) | ❌    | 0                |
| JavaScript  | 未定义变量        | ❌    | false (小写) 或 0 |
| PostgreSQL  | 布尔字面量        | ✅    | 仅用于 BOOLEAN 列 |
| PG COALESCE | SUM()返回numeric  | ❌    | COALESCE(SUM(),0) |
```

### 教训 3 补充: 2026-02-24 实战全量清除 FALSE

**核心结论**: `FALSE` 在 MSSQL/JS/PG-COALESCE 中全部非法，必须用 `0` 替代。之前误判 MSSQL `ISNULL(x, FALSE)` 可用——实际 MSSQL 会将 FALSE 当作列名报 `Invalid column name 'FALSE'`。
**PG COALESCE**: `COALESCE(SUM(dl.actual_qty), FALSE)` → 报 `types numeric and boolean cannot be matched`。修复为 `COALESCE(SUM(...), 0)`。
**MSSQL ISNULL**: `ISNULL(T4.OnHandQty, FALSE)` → 报 `Invalid column name 'FALSE'`。修复为 `ISNULL(..., 0)`。涉及 4 个文件 20+ 处。
**JS reduce**: `.reduce((s,r)=> s + (r.json.count||0), FALSE)` → JS 中 `FALSE` 是未定义变量。修复为初始值 `0`。
**排查命令**: `Grep FALSE apps/wf/` → **一律替换为 0**，仅 PG 布尔列 (`is_active = FALSE`, `posted_flag=FALSE`) 保留。
**INTEGER 列赋值 TRUE**: `VALUES ('prefix', TRUE)` → 报 `column "next_val" is of type integer but expression is of type boolean`。wf03 的序号生成器首次 INSERT 用了 `TRUE` 代替 `1`。修复为 `VALUES ('prefix', 1)`。
**判断规则**: `TRUE/FALSE` 仅合法于 PG BOOLEAN 列。任何 INTEGER/NUMERIC 列用 `TRUE/FALSE` 必报错。

### 教训 12: PostgreSQL 常量折叠 — CASE WHEN 不能阻止 ::integer 求值

**问题**: `d.id = CASE WHEN 'LM20260224001' ~ '^[0-9]+$' THEN 'LM20260224001'::integer END` 仍报 `invalid input syntax for type integer`。
**根因**: PostgreSQL 对字面量 `'LM20260224001'::integer` 在解析/规划阶段就执行常量折叠 (constant folding)，CASE WHEN 短路逻辑来不及生效。
**正确做法**: 反向转换 — `d.id::text = '{{ $json.docId }}'`。integer→text 永远安全，且单条查询无性能影响。
**规则**: 当 n8n 模板注入的值可能是非数字字符串时，不要用 `'...'::integer`，而是用 `column::text = '...'`。

### 教训 13: localStorage 5MB 限额 — 主数据缓存大小控制

**问题**: wf11 返回 5.17MB 主数据 (items:16K + bins:70K)，前端 `localStorage.setItem()` 抛出 `QuotaExceededError`，显示"主数据加载失败"。
**根因**: 浏览器 localStorage 限额约 5-10MB/origin。70K 条 bins 数据以 `[{bin_code:"x", whs_code:"y"}, ...]` 格式占用 3.5MB。
**修复**: 将 bins 改为 `bins_map: { whs_code: [bin_code, ...] }` 压缩格式：
  - 消除 whs_code 重复 (70K条→11个key)
  - 消除 JSON key 重复 ("bin_code"/"whs_code"×70K)
  - 结果: 5.17MB → 3.05MB (-41%)
**前端兼容**: `validateBin()` 先检查 `cache.bins_map`，回退到旧 `cache.bins` 数组格式。
**规则**: 凡是通过 localStorage 缓存的 API 响应，必须控制在 3MB 以内。大数据集用紧凑格式 (map/array 替代 object 数组)。

### 教训 11: connections 中节点名残留 (节点改名后断链)

**问题**: wf11-stock-query.json 的 connections 引用 `"MySQL查询"` 但实际节点已改名为 `"PG查询"`，导致流程链路断裂。
**根因**: 批量迁移时只改了 nodes 数组中的节点名和类型，漏改 connections 中的引用。
**规则**: 节点改名必须同步 connections + 其他节点中的 `$('节点名')` 引用。
**排查**: 提取 connections 中所有节点名 → 与 nodes[].name 做交叉比对 → 找出不匹配项。

### 教训 4: UNION ALL 类型推断 — 空字符串 ≠ NULL

**问题**: `invalid input syntax for type date: ""`
**根因**: UNION ALL 按第一个 SELECT 推断列类型。第一个返回 DATE，后续返回 `''` → 转换失败。
**规则**: UNION ALL 中占位值必须用 `NULL`，不能用空字符串 `''`。

### 教训 5: n8n 2.x $env 全面封锁 (破坏性变更)

**问题**: Code 节点和 Expression 字段都报 `access to env vars denied`。
**根因**: n8n 2.x 将 `N8N_BLOCK_ENV_ACCESS_IN_NODE` 默认值从"开放"改为"封锁"。
**修复**: docker-compose.yml 加 `N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"`
**过程教训**: 先尝试了复杂的占位符方案 (`__DP_CC__` + `replaceAll`)，最终发现直接开启环境变量才是正解。**不要为框架限制发明 workaround，先查文档找正确配置。**

### 教训 6: WEBHOOK_URL 变量名变更

**问题**: n8n UI 显示 `http://0.0.0.0:5678` 而非配置的域名。
**根因**: n8n 2.x 使用 `WEBHOOK_URL` (无前缀)，不识别旧版的 `N8N_WEBHOOK_URL`。
**教训**: 升级大版本时必须检查环境变量名是否有变更。

### 教训 7: env.js 被 CDN 长缓存导致生产事故

**问题**: 生产环境登录页无限循环，本地正常。
**根因**: `env.js?v=phase18.0` 匹配 nginx 的 `.js` 缓存规则 (1年 immutable)，Cloudflare 缓存了旧 env.js。
**规则**: 动态配置文件 (env.js) 必须有独立 nginx location 块 + no-cache 头，且不带 `?v=` 版本号。

### 教训 8: 品牌/路径硬编码不能用 nginx 转发兜底

**问题**: `easywms` 硬编码散布在 JSON + 前端 + 数据库三层。
**反面做法**: 用 nginx rewrite 适配旧路径。
**正确做法**: 从根源修复 — 磁盘文件 → 数据库 → 运行时缓存，用 Python 批量替换。

### 教训 9: INSERT 列数与 VALUES 数不匹配

**问题**: 添加 `company_code` 到 INSERT 列表后忘了在 VALUES 中也加上。
**规则**: 修改 INSERT 语句时，必须同时核对 列名列表 和 VALUES 列表的数量一致。

### 教训 10: docker restart ≠ docker compose up

**问题**: 修改 `.env` 后 `docker restart` 不生效。
**根因**: `docker restart` 只重启进程，不重新读取 `.env`。
**规则**: 改了 `.env` 或 `docker-compose.yml` → 必须 `docker compose up -d` 重建容器。

---

## 二、批量操作 SOP (Standard Operating Procedure)

### 数据库修改工作流
```
1. 写 Python 脚本 (不要手动改 JSON!)
2. 脚本模板:
   - sql(): 查询 (psql -t -A)
   - sql_exec(): 执行 (psql -c)
   - json.loads(nodes_json): 解析节点
   - 遍历 nodes → 按 node_type 修改 parameters
   - json.dumps() → 转义单引号 → UPDATE
3. 同步三表: entity → history → DELETE webhook
4. docker restart dp-wf
5. 验证: webhook 数量 + 工作流激活数
```

### 健康检查脚本 (每次批量修改后运行)
```bash
python3 scripts/healthcheck_v2.py
# 检查项:
#   - 连接完整性 (目标节点是否存在)
#   - 表名正确性 (复数 vs 单数)
#   - FALSE/TRUE 残留
#   - MySQL 语法残留
#   - 重复工作流检测
```

### WSL 路径注意事项 (重要！反复犯错)
```
核心问题: Claude Code 运行在 Windows, Docker 在 WSL, 路径常出错

✅ 正确做法:
  - wsl -d Ubuntu-24.04 -- bash -c '命令'     # 包裹完整命令
  - docker cp 用相对路径: cd 目录 && docker cp ./文件 容器:/路径
  - python3 脚本: 用 Write 写到 WSL 路径, 再 wsl -- bash -c 'python3 /path'
  - 复杂 shell 逻辑: 写成 .sh/.py 脚本文件, 不要在 -c 中嵌套

❌ 常见错误:
  - docker cp "/home/user/..." 从 Windows 调用 → 路径被 Git Bash 篡改
  - wsl -- python3 "/path" → 被解析为 Windows 路径 (C:/Program Files/Git/...)
  - 嵌套引号 'python3 -c "import json; print(json.load(open(\"$f\")))"' → 爆炸
  - node -e 在 docker exec 中 → 反斜杠/引号逃逸地狱

💡 黄金规则: 凡是超过一行的逻辑，写成独立脚本文件再执行
```

### n8n 工作流批量管理 SOP (v2 — 2026-02-24 实战验证)

#### 1. 导入工作流 (CLI 方式，最可靠)
```bash
# 步骤: 复制文件到容器 → 添加 id → CLI 导入

# a. 复制 JSON 文件到 n8n 容器
wsl -d Ubuntu-24.04 -- bash -c '
  cd "/home/user/Digital Platform/apps/wf"
  docker exec dp-wf mkdir -p /tmp/wf-import
  for f in wf*.json; do
    docker cp "./$f" "dp-wf:/tmp/wf-import/$f"
  done'

# b. 每个 JSON 必须有 "id" 顶层字段 (n8n CLI 强制要求)
#    写 Node.js 脚本添加:
#    data.id = crypto.randomBytes(5).toString('hex').substring(0,10);
#    docker cp add-ids.js dp-wf:/tmp/ && docker exec dp-wf node /tmp/add-ids.js

# c. 执行批量导入
wsl -d Ubuntu-24.04 -- docker exec dp-wf sh -c \
  'cd /tmp/wf-import && n8n import:workflow --separate --input=/tmp/wf-import/'
# ⚠️ 所有工作流会被设为 inactive (deactivated)
```

#### 2. 激活工作流 (API 方式，唯一正确途径)
```bash
# ❌ 直接改 DB active=true 无效 (n8n 不注册 webhook/cron)
# ❌ PATCH /api/v1/workflows/{id} 405 Method Not Allowed
# ✅ POST /api/v1/workflows/{id}/activate

API_KEY="..."  # 从 wf.user_api_keys 表获取 (audience=public-api)
curl -s -X POST \
  -H "X-N8N-API-KEY: $API_KEY" \
  "http://localhost:5678/api/v1/workflows/{id}/activate"

# 批量激活: 写成 .sh 脚本, 每个 ID 调用一次, sleep 0.5 避免过快
```

#### 3. 删除旧工作流 (DB 方式)
```sql
-- 必须按顺序删除 (外键约束)
DELETE FROM wf.webhook_entity WHERE "workflowId" IN (...);
DELETE FROM wf.shared_workflow WHERE "workflowId" IN (...);
DELETE FROM wf.workflow_entity WHERE id IN (...);
-- 然后 docker restart dp-wf
```

#### 4. 重编号/重命名
```
规则:
  - 文件名用两阶段重命名 (避免冲突): old → __tmp__new → new
  - 同时更新 JSON 内部 "name" 字段
  - 用 Python 脚本处理 (不用 bash 循环 + sed, 容易被特殊字符搞炸)
  - 删除旧 "id" 字段 (重新导入时自动生成)
```

#### 5. 完整流程 (删除→重导→激活)
```
1. DB 删除旧工作流 (webhook → shared → entity)
2. docker restart dp-wf
3. 复制文件到容器
4. 添加 id 字段 (node 脚本)
5. n8n import:workflow --separate
6. API POST /activate 逐个激活
7. 验证: SELECT name, active, "triggerCount" FROM wf.workflow_entity
```

#### 6. 更新单个工作流 (API PUT，最高效)
```python
# 适用于只修改 1-2 个工作流的场景 (无需全量重导)
# Python 脚本 (推荐, 避免 bash 引号地狱):
import json, urllib.request
allowed = {"name", "nodes", "connections", "settings", "staticData"}
put_body = {k: v for k, v in wf_json.items() if k in allowed}
# 步骤: 停用 → PUT 更新 → 激活
api("POST", "/workflows/{id}/deactivate")
api("PUT",  "/workflows/{id}", put_body)   # ⚠️ 必须过滤额外字段!
api("POST", "/workflows/{id}/activate")
# n8n PUT API 不接受: pinData, tags, active, id 等字段
# 错误: {"message":"request/body must NOT have additional properties"}
```

#### 7. 关键 API 端点 (n8n 2.x)
```
GET  /api/v1/workflows?limit=25     # 列出工作流
PUT  /api/v1/workflows/{id}         # 更新 (只接受 name/nodes/connections/settings/staticData)
POST /api/v1/workflows/{id}/activate   # 激活 ✅
POST /api/v1/workflows/{id}/deactivate # 停用
GET  /api/v1/executions?workflowId={id}&limit=5  # 查看执行记录
GET  /api/v1/executions/{execId}?includeData=true # 查看执行详情(含错误)
GET  /healthz                         # 健康检查
# 认证: Header X-N8N-API-KEY (从 n8n UI Settings > API 创建)
# 注意: apiKey 列存储 JWT token，UI 展示的 UUID-style key 是旧版格式
# 多项目端口: 由 DP_WF_PORT 配置 (.env), 不再固定为 5678
```

#### 8. 多项目部署 — 首次初始化 SOP (2026-02-28)

**场景**: 全新 DP 实例（无旧工作流），从 JSON 文件首次导入 20 个工作流并激活

**关键陷阱**:
| 问题 | 根因 | 解决 |
|------|------|------|
| `null value in column "id"` | 19/20 JSON 文件根节点是 `[{...}]` 数组，缺少 id 字段 | 导入前用 Python 提取 `data[0]` 并注入稳定 hash id |
| `--separate` 模式 400 错误 | `n8n import:workflow --separate` 处理数组格式异常 | 改为逐文件 `--input=单文件.json` |
| API `401 unauthorized` | host 端用 JWT key + curl 时 header 可能被截断 | 从容器内 `docker exec node -e` 调用 API |
| Cron 激活 `Invalid timezone` | `.env` 中 `GENERIC_TIMEZONE=Aisia/Bangkok` 拼写错误 | 修正为 `Asia/Bangkok` 后重建容器 |

**推荐导入脚本** (Python, 在宿主机运行):
```python
# 每个 JSON 文件: 提取 data[0] → 注入 id → 复制到容器 → CLI 导入 → API 激活
for fpath in glob("apps/wf/wf*.json"):
    wf = json.load(open(fpath))
    wf = wf[0] if isinstance(wf, list) else wf
    if not wf.get('id'):
        wf['id'] = hashlib.sha256(fpath.encode()).hexdigest()[:10]
    # 写临时文件 → docker cp → n8n import:workflow --input=xxx
    # 激活: docker exec dp-wf node -e "http.request(...activate...)"
```

**激活 API 调用 (容器内 node)**:
```bash
# 从容器内调用避免 JWT header 传递问题
docker exec dp-wf node -e "
const http = require('http');
http.request({host:'localhost',port:5678,
  path:'/api/v1/workflows/{ID}/activate',method:'POST',
  headers:{'X-N8N-API-KEY':'${KEY}','Content-Type':'application/json','Content-Length':2}
}, res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>console.log(d))}).end('{}');
"
```

**激活顺序**:
- wf02~wf1e (含 Cron) 全部激活
- wf0a, wf0b (期初一次性工作流) 保持停用

---

## 三、n8n 2.x 关键配置清单

```yaml
# docker-compose.yml dp-wf environment
WEBHOOK_URL: ${WEBHOOK_URL}                    # 不是 N8N_WEBHOOK_URL!
N8N_EDITOR_BASE_URL: ${N8N_EDITOR_BASE_URL}    # 编辑器基础 URL
N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"           # 允许 $env 访问
N8N_ENCRYPTION_KEY: ${N8N_ENCRYPTION_KEY}       # 凭据加密 (不可为空!)
N8N_TRUST_PROXY: "true"                        # 反向代理信任
EXECUTIONS_MODE: queue                         # v0.4+ 分布式 (main 路由+入队, worker 执行)
# --- Queue 模式专用 (v0.4+) ---
OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS: "true"   # 手动执行也下发 worker
N8N_CONCURRENCY_PRODUCTION_LIMIT: 5            # main 入队并发限制
N8N_METRICS_INCLUDE_QUEUE_METRICS: "true"      # Prometheus 采集队列深度
EXECUTIONS_DATA_PRUNE: "true"                  # 自动清理执行记录 (防 PG 膨胀)
EXECUTIONS_DATA_MAX_AGE: 168                   # 保留 7 天
EXECUTIONS_DATA_PRUNE_MAX_COUNT: 10000         # 单次清理上限
```

### dp-wf-worker 容器 (v0.4+)
```yaml
# docker-compose.yml dp-wf-worker
dp-wf-worker:
  image: n8nio/n8n:stable
  command: ["worker", "--concurrency=${N8N_WORKER_CONCURRENCY:-10}"]
  # ⚠️ 并发必须用 CLI flag，env var N8N_WORKER_CONCURRENCY 无效
  # ⚠️ N8N_ENCRYPTION_KEY 必须与 dp-wf 完全一致，否则凭据解密静默失败
  # ⚠️ GENERIC_TIMEZONE 必须与 dp-wf 一字不差，否则 Cron 节点行为诡异
  # ⚠️ 不挂载 .n8n 目录 — Main 和 Worker 共享会导致 SQLite 锁死
  # ⚠️ 不依赖 dp-wf — Worker 只需 Redis + DB
```

```ini
# .env 开发环境
WEBHOOK_URL=http://localhost:5678
N8N_EDITOR_BASE_URL=http://localhost:5678/

# .env 生产环境
WEBHOOK_URL=https://wf.example.com
N8N_EDITOR_BASE_URL=https://wf.example.com/
```

---

## 三-B、跨容器工作流+凭据完整迁移 SOP (v1.5 — 2026-02-27)

> **场景**: 旧 n8n 容器 (SQLite 后端 + 工作流连 MySQL 业务库) → 新 dp-wf 容器 (PostgreSQL 后端 + 工作流连 PostgreSQL 业务库)
> **两层迁移**: ① n8n 后端: SQLite → PostgreSQL (wf schema)  ② 工作流节点: MySQL 节点 → PostgreSQL 节点
> **实战**: 53 个工作流 (72 MySQL→PG 节点) + 17 个凭据成功迁移

### 1. 导出工作流 (旧容器)

```bash
# --separate 导出到容器内目录 (避免 Windows 路径问题)
docker exec <old-n8n> mkdir -p /tmp/wf-export
docker exec <old-n8n> n8n export:workflow --all --separate --output=/tmp/wf-export/

# 用 tar 管道拷贝到本地 (docker cp 在 WSL 环境经常路径出错)
mkdir -p /tmp/n8n-migration
docker exec <old-n8n> tar cf - -C /tmp/wf-export . | tar xf - -C /tmp/n8n-migration/
```

### 2. 批量转换 MySQL → PostgreSQL

**节点转换** (Python 脚本):
```python
# 节点类型 + 凭据
node['type'] = 'n8n-nodes-base.postgres'
node['typeVersion'] = 2.5
node['credentials'] = {'postgres': {"id": "xxx", "name": "MyPostgres"}}

# SQL 语法 (正则替换)
IFNULL()          → COALESCE()
DATE_FORMAT()     → TO_CHAR()
CURDATE()         → CURRENT_DATE
DATE_SUB(x, INTERVAL n UNIT) → (x - INTERVAL 'n unit')
INSERT IGNORE     → INSERT INTO (+ ON CONFLICT DO NOTHING 视情况)
JSON_OBJECT()     → JSON_BUILD_OBJECT()
GROUP_CONCAT(...SEPARATOR...) → STRING_AGG(...)
is_active = 1/0   → is_active = TRUE/FALSE
SET NAMES utf8mb4  → 删除
SET SESSION group_concat_max_len → 删除
easywms.           → wms. (Schema 名变更)
```

**MSSQL 凭据统一**: 所有 `microsoftSql` 节点指向同一凭据 `SAP B1`。

**重名处理**: 已存在的 EasyWMS 工作流加 `[旧]` 前缀。

### 3. 导入工作流 (新容器)

```bash
# ⚠️ 关键: 每个 JSON 必须有 "id" 字段 (否则报 null value violation)
# 用 Python 生成: hashlib.sha256(filename).hexdigest()[:10]

# 拷贝到新容器
tar cf - -C /tmp/converted . | docker exec -i dp-wf tar xf - -C /home/node/import-wf/

# 逐个导入 (sh -c 中 glob 在 alpine 可能失败, 用宿主机循环)
filelist=$(docker exec dp-wf ls /home/node/import-wf/)
for f in $filelist; do
  docker exec dp-wf n8n import:workflow --input="/home/node/import-wf/$f"
done
```

### 4. 凭据迁移 (加密密钥不同时)

**核心问题**: n8n 凭据用 `N8N_ENCRYPTION_KEY` 加密存储。新旧容器密钥不同，无法直接复制。

**解决方案**: 用旧数据卷 + 旧密钥解密导出，再导入新容器（自动用新密钥加密）。

```bash
# a. 旧容器删了但数据卷还在
docker volume ls | grep n8n  # → n8n_data

# b. 用临时容器挂载旧卷，解密导出凭据
MSYS_NO_PATHCONV=1 docker run --rm \
  -v n8n_data:/home/node/.n8n \
  --entrypoint n8n n8nio/n8n:stable \
  export:credentials --all --decrypted --separate --output=/home/node/.n8n/creds-export/

# c. 从数据卷拷贝到本地
MSYS_NO_PATHCONV=1 docker run --rm \
  -v n8n_data:/data alpine tar cf - -C /data/creds-export . | tar xf - -C /tmp/n8n-creds/

# d. 筛选 (排除 MySQL 凭据等)
# e. 包装成数组格式 (n8n import 要求 JSON 数组)
python3 -c "
import json, glob
for f in glob.glob('*.json'):
    c = json.load(open(f, encoding='utf-8'))
    if not isinstance(c, list): c = [c]
    json.dump(c, open(f, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
"

# f. 拷贝到新容器并导入
tar cf - . | docker exec -i dp-wf tar xf - -C /home/node/creds-import/
for f in $(docker exec dp-wf ls /home/node/creds-import/); do
  docker exec dp-wf n8n import:credentials --input="/home/node/creds-import/$f"
done
```

**踩坑记录**:
| 坑 | 现象 | 解决 |
|----|------|------|
| id 字段缺失 | `null value in column "id"` | 工作流 JSON 必须有 id 字段 |
| 凭据非数组 | `File does not seem to contain credentials` | 包装为 `[{...}]` 数组格式 |
| sh -c glob 失败 | `*.json: No such file` | alpine ash 的 glob 不稳定，用宿主机循环 |
| Git Bash 路径转换 | `/home/node` → `C:/Program Files/Git/home/node` | 加 `MSYS_NO_PATHCONV=1` |
| OAuth token 过期 | 导入成功但无法使用 | Google 等 OAuth 凭据需在编辑器中重新授权 |

### 5. .gitignore 隔离

```gitignore
# 已归档的一次性修复脚本
scripts/archive/
```

### 6. Data Tables 迁移 (SQLite → PostgreSQL)

**背景**: n8n Data Tables 存储在旧容器的 SQLite 中，新 dp-wf 使用 PostgreSQL (wf schema)。

**架构**: n8n Data Tables 在 PG 中的存储结构:
```
wf.data_table              — 元数据 (id, name, columns, row_count)
wf.data_table_column       — 列定义 (data_table_id, name, data_type, position)
wf."data_table_user_<id>"  — 实际数据表 (每个 Data Table 一张独立表)
```

**导出 SOP** (从旧 SQLite 容器):
```bash
# a. 查看旧容器 SQLite 中有哪些 Data Tables
docker run --rm -v n8n_data:/data alpine ls -la /data/database.sqlite
# SQLite 表: data_table, data_table_column, data_table_user_<id>

# b. 用临时容器 + Python 导出为 JSON
docker run --rm -v n8n_data:/data python:3-alpine sh -c '
pip install -q sqlite3 2>/dev/null
python3 -c "
import sqlite3, json
conn = sqlite3.connect(\"/data/database.sqlite\")
conn.row_factory = sqlite3.Row

# 导出元数据
tables = [dict(r) for r in conn.execute(\"SELECT * FROM data_table\").fetchall()]
json.dump(tables, open(\"/data/dt_meta.json\",\"w\"), indent=2, ensure_ascii=False)

# 导出列定义
cols = [dict(r) for r in conn.execute(\"SELECT * FROM data_table_column\").fetchall()]
json.dump(cols, open(\"/data/dt_columns.json\",\"w\"), indent=2, ensure_ascii=False)

# 导出每个数据表内容
for t in tables:
    tid = t[\"id\"]
    tname = f\"data_table_user_{tid}\"
    rows = [dict(r) for r in conn.execute(f\"SELECT * FROM [{tname}]\").fetchall()]
    json.dump(rows, open(f\"/data/dt_{tid}.json\",\"w\"), indent=2, ensure_ascii=False)
    print(f\"{tname}: {len(rows)} rows\")
"'

# c. 从数据卷取出 JSON
docker run --rm -v n8n_data:/data alpine tar cf - /data/dt_*.json | tar xf - -C /tmp/
```

**导入 SOP** (到新 PG 容器):
```bash
# a. 生成 SQL (Python 脚本读取 JSON → 拼装 INSERT)
# 关键: 表名含特殊字符需双引号 → wf."data_table_user_<id>"
# 关键: 列名也需双引号 (PG 大小写敏感)

# b. 插入元数据
INSERT INTO wf.data_table (id, name, "createdAt", "updatedAt", "deletedAt", columns, "rowCount")
VALUES ('<id>', '<name>', NOW(), NOW(), NULL, <columns_jsonb>, <row_count>);

# c. 插入列定义
INSERT INTO wf.data_table_column ("dataTableId", id, name, "dataType", "createdAt", "updatedAt", position, "displayName")
VALUES ('<dt_id>', '<col_id>', '<name>', '<type>', NOW(), NOW(), <pos>, '<displayName>');

# d. 创建数据表 + 插入数据
CREATE TABLE wf."data_table_user_<id>" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW(),
  "deletedAt" TIMESTAMPTZ,
  "<col1>" TEXT,
  "<col2>" TEXT,
  ...
);
INSERT INTO wf."data_table_user_<id>" ("<col1>", "<col2>", ...) VALUES (...);

# e. 通过 psql 执行
docker exec -i dp-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < /tmp/import_datatables.sql
```

**踩坑记录**:
| 坑 | 现象 | 解决 |
|----|------|------|
| 表名含特殊字符 | `data_table_user_ObUaw07MTfXFF3hG` 大小写混合 | PG 中必须双引号包裹 `"data_table_user_xxx"` |
| SQLite 列名驼峰 | `createdAt`, `dataTableId` | PG 也用双引号保持驼峰 |
| columns 字段为 JSONB | SQLite 存 TEXT, PG 存 JSONB | 导入时用 `::jsonb` 转换 |
| 数据量大 | 16K+ 行 INSERT | 分批 INSERT (每 500 行), 或用 COPY 命令 |
| rowCount 同步 | 导入后 rowCount 可能不准 | `UPDATE wf.data_table SET "rowCount" = (SELECT count(*) FROM wf."data_table_user_<id>")` |

**选择性迁移**: 不是所有 Data Tables 都需要迁移。评估标准:
- 有业务价值的数据 (如物料编码规则) → 迁移
- 临时测试数据 (如 SSL check) → 跳过
- 已在新系统中重建的数据 (如 wms_users) → 跳过

### 6-B. Data Tables 多公司隔离 (跨公司泄漏防护)

**风险**: n8n Data Tables 存在 `wf` schema，无 `company_code` 隔离。
备份恢复 (`pg_dump`/`pg_restore`) 整个 wf schema 时，会把 A 公司的 Data Tables 带入 B 公司。

**不受影响的场景**:
- `clone-company.sh`: 文件级 cp + `init-platform.sh` 全新建库 → 不含旧数据

**受影响的场景**:
- `backup.sh` → `pg_restore` 到另一套部署 → Data Tables 泄漏
- 手动 `pg_dump wf schema` → 导入新环境 → Data Tables 泄漏

**方案 A (短期 — 备份恢复排除)**:
```bash
# 恢复备份时排除 Data Tables (pg_restore -Fc 支持 --exclude-table)
docker exec dp-db pg_restore \
  -U dp_app -d dp --clean --if-exists \
  --exclude-table='data_table' \
  --exclude-table='data_table_column' \
  --exclude-table='data_table_user_*' \
  /tmp/dp_backup.dump

# 或导出时排除
docker exec dp-db pg_dump -U dp_app -d dp --format=custom \
  --exclude-table='wf.data_table' \
  --exclude-table='wf.data_table_column' \
  --exclude-table='wf.data_table_user_*' \
  -f /tmp/dp_backup_no_dt.dump
```

**方案 B (长期 — 业务数据归位 wms schema)**:
```
n8n Data Tables 定位 = 临时/运营数据 (工作流内部使用)
业务持久数据 → 迁入 wms schema 正规表 (带 company_code 隔离)

示例:
  物料编码规则 → wms_material_rules (company_code, prefix, pattern, ...)
  物料主数据   → 已有 wms_items_cache (定时同步)

迁移后 Data Tables 可清空，仅保留临时用途。
```

**判断规则**:
```
Data Table 内容分类:
  ├── 公司专属业务数据 → 必须迁入 wms schema (带 company_code)
  ├── 工作流运算中间结果 → 保留 Data Table (临时性质，丢了可重算)
  └── 通用配置/参考数据 → 可保留 Data Table (跨公司通用)
```

### 7. 清理

```bash
# 旧容器已删，清理数据卷 (确认不再需要后)
docker volume rm n8n_data
# 清理容器内临时文件
docker exec dp-wf rm -rf /home/node/import-wf /home/node/creds-import
```

---

## 三-C、n8n /data 卷跨平台挂载 (v1.8 — 2026-02-27)

> **场景**: n8n Read/Write from Disk 节点依赖容器内 `/data` 目录读写文件
> **问题**: 旧 n8n 用 `docker run -v /mnt/d/Data/N8N:/data`，新 dp-wf 用 compose 管理卷

### 解法: compose 中 `/data` 路径通过 .env 可配

**docker-compose.yml 改动** (一行):
```yaml
# 之前 (硬编码)
- ${DP_DATA_DIR}/n8n-data:/data

# 之后 (可配，向后兼容)
- ${DP_N8N_DATA_DIR:-./data/n8n-data}:/data
```

### 跨平台路径差异

| 平台 | Docker 引擎 | 路径机制 | .env 配置示例 |
|------|------------|---------|--------------|
| **Windows** | WSL2 + Docker Desktop | WSL 自动挂载 Windows 盘到 `/mnt/<盘符>/` | `DP_N8N_DATA_DIR=/mnt/d/Data/N8N` |
| **macOS** | Docker Desktop for Mac | 使用 macOS 原生路径，需在 Docker Desktop 文件共享中添加 | `DP_N8N_DATA_DIR=/Users/<用户名>/Data/N8N` |
| **Linux** | 原生 Docker | 直接使用宿主机绝对路径 | `DP_N8N_DATA_DIR=/opt/data/n8n` |

### macOS 额外步骤 ⚠️

macOS Docker Desktop **默认只共享部分目录** (`/Users`, `/tmp`, `/private`)。
若数据目录不在这些路径下，必须手动添加:

```
Docker Desktop → Settings → Resources → File Sharing
  → 点击 "+" 添加目标目录 (如 /Volumes/ExternalDisk/N8N)
  → Apply & Restart
```

不添加会报 `Mounts denied: The path ... is not shared from the host and is not known to Docker`。

### 配合的 n8n 环境变量

```yaml
# docker-compose.yml dp-wf environment
N8N_RESTRICT_FILE_ACCESS_TO: ${N8N_RESTRICT_FILE_ACCESS_TO:-/data}
```

此变量限制 Read/Write from Disk 节点只能访问 `/data` 及子目录，防止容器内任意路径读写。

### 重建容器使挂载生效

```bash
# ❌ docker restart dp-wf  → 不会重新读取 volume 配置
# ✅ docker compose up -d dp-wf  → 重建容器，新挂载生效
```

教训回顾: **教训 10** — 改了 `.env` 或 `docker-compose.yml` → 必须 `docker compose up -d` 重建容器。

---

## 三-D、三环境配置方案 — 多 .env 文件 + --env-file 切换 (v1.9 — 2026-02-27)

### 背景

n8n 编辑器 Webhook 节点显示两个 URL:
- **Test URL** = `{N8N_EDITOR_BASE_URL}/webhook-test/xxx` (编辑器调试用)
- **Production URL** = `{WEBHOOK_URL}/webhook/xxx` (生产回调用)

**这两个概念是 n8n 内部的，和部署环境 (DEV/UAT/PROD) 无关。**

### 三环境对照表

| 变量 | `.env.dev` | `.env.uat` | `.env.prod` |
|------|-----------|-----------|------------|
| `WEBHOOK_URL` | `http://localhost:5678` | `https://wf.example.com` | `https://wf.company.com` |
| `N8N_EDITOR_BASE_URL` | `http://localhost:5678/` | `https://wf.example.com/` | `https://wf.company.com/` |
| `N8N_SECURE_COOKIE` | `false` | `false` | `true` |
| `ENV_NAME` | `development` | `staging` | `production` |
| `API_BASE_URL` | `/api/wms` | `/api/wms` | `/api/wms` |
| `APP_BASE_URL` | (空) | (空) | (空) |
| `DEBUG` | `true` | `true` | `false` |

### 启动命令

```bash
# DEV — 纯本地开发 (所有 URL = localhost)
docker compose --env-file .env.dev -f docker-compose.yml -f docker-compose.dev.yml up -d

# UAT — 用户验收 (URL = 域名，走 Cloudflare Tunnel)
docker compose --env-file .env.uat -f docker-compose.yml -f docker-compose.dev.yml up -d

# PROD — 正式上线 (Hyper-V 独立机器)
docker compose --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml up -d
```

快捷脚本:
```bash
bash scripts/dev-up.sh --dev   # → 自动使用 .env.dev
bash scripts/dev-up.sh --uat   # → 自动使用 .env.uat (默认)
bash scripts/dev-up.sh         # → 等同 --uat
```

### 关键设计决策

1. **删除 dev.yml 的 WEBHOOK_URL 覆盖**: 统一由 `--env-file` 控制，dev.yml 只做端口映射
2. **安全端口绑定**: PG/Redis/n8n/BI 端口绑定 `127.0.0.1` 防局域网扫描，网关保持 `0.0.0.0` (手机测试需要)
3. **.env.example 保持字段主模板**: 只记录字段和注释，不含实际密码
4. **X-Forwarded-Host**: dev 和 prod nginx 均已补充，OAuth 回调节点需要此头

### 踩坑记录

1. **WEBHOOK_URL 被 dev.yml 覆盖**: 旧版 `docker-compose.dev.yml` 第 44 行 `WEBHOOK_URL: http://${DP_LOCAL_IP}:${DP_GATEWAY_PORT:-8080}` 强制覆盖，导致 n8n Production URL 显示局域网 IP → 已删除
2. **nginx upstream DNS 缓存**: 容器重建后 nginx 缓存旧 IP → 502 → 必须 `docker exec dp-gateway nginx -s reload`
3. **DEV 使用域名 URL 的心智混淆**: 开发环境应该看到 localhost URL，否则开发者会误以为在操作远程 → 拆分 `.env.dev` 和 `.env.uat`
4. **API_BASE_URL 绝对路径 → 跨域 (CORS) 登录失败**: `env.js` 中 `API_BASE_URL` 如果是绝对域名 URL (如 `https://app.example.com/api/wms`)，浏览器通过 `localhost:8080` 访问时 JS 请求发到域名 = 跨域被拦截，表现为登录无响应。**必须使用相对路径 `/api/wms`**，这样不管通过 localhost、域名、IP 访问都走同源请求，零 CORS 问题。`APP_BASE_URL` 同理留空。

---

## 三-E、n8n 执行日志/统计完整清理 SOP (v2.2 — 2026-02-28)

> **场景**: 迁移完成后清理测试期执行记录，释放磁盘空间
> **⚠️ 血的教训**: 只清 execution_* 不清 insights_* → Overview 页面仍显示旧统计 (2,566次/75失败)！
> **必须同时清理两组表**: 执行记录 (3张) + 统计聚合 (4张) = 7张全清

### 两组表的关系 (⚠️ 核心理解)

```
n8n 数据流:
  工作流执行 → execution_entity/data/metadata (原始执行记录)
                    ↓ (n8n 内部异步聚合)
              insights_raw → insights_by_period (按小时/天聚合)
                    ↓
              n8n Overview 页面读取 insights_by_period 显示统计

⚠️ Overview 不读 execution_entity！只读 insights_by_period！
   所以只清 execution 不清 insights = Overview 数据不变！
```

### 需要清理的 7 张表

| # | 表名 | 作用 | 备注 |
|---|------|------|------|
| 1 | `execution_metadata` | 执行标签/注释 | 有外键依赖 execution_entity |
| 2 | `execution_data` | 执行详细数据 (占用最大) | 有外键依赖 execution_entity |
| 3 | `execution_entity` | 执行记录主表 | 基础表 |
| 4 | `insights_raw` | 原始统计数据 | ⚠️ Overview 页面数据源 |
| 5 | `insights_by_period` | 按周期聚合统计 | ⚠️ Overview 页面数据源 (失败次数/执行次数从此表 SUM) |
| 6 | `insights_metadata` | 统计元数据 (工作流↔指标映射) | ⚠️ TRUNCATE insights_by_period 会级联清此表 |
| 7 | `workflow_statistics` | 工作流级统计 | 首次成功/失败时间等 |

### 清理命令

```bash
# ⚠️ 7 张表缺一不可！不清 insights 表 = Overview 仍显示旧数据！

# 1. 删除执行记录 (注意: metadata 和 data 有外键依赖 entity)
docker exec dp-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
BEGIN;
DELETE FROM wf.execution_metadata;
DELETE FROM wf.execution_data;
DELETE FROM wf.execution_entity;
TRUNCATE TABLE wf.insights_metadata CASCADE;  -- 级联清 insights_raw + insights_by_period
DELETE FROM wf.workflow_statistics;
COMMIT;
SQL

# 2. 回收空间 (VACUUM FULL 不能在事务中)
for t in execution_data execution_entity execution_metadata insights_raw insights_by_period insights_metadata workflow_statistics; do
  docker exec dp-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "VACUUM FULL wf.$t"
done

# 3. 重启 n8n 刷新内存缓存 (⚠️ 必须！n8n 有内存缓存统计数据)
docker restart dp-wf

# 4. 验证 (所有表应为 0 行)
docker exec dp-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
SELECT 'execution_entity' AS tbl, COUNT(*) FROM wf.execution_entity
UNION ALL SELECT 'insights_raw', COUNT(*) FROM wf.insights_raw
UNION ALL SELECT 'insights_by_period', COUNT(*) FROM wf.insights_by_period
UNION ALL SELECT 'insights_metadata', COUNT(*) FROM wf.insights_metadata
UNION ALL SELECT 'workflow_statistics', COUNT(*) FROM wf.workflow_statistics;"
```

**不影响**: 工作流定义、凭据、变量、Data Tables 完全不受影响。n8n 会从零开始重新累积统计。

---

## 三-F、增量同步改造经验 (v2.1 — 2026-02-28)

### 教训 14: 增量锚点时间戳截断导致死循环

**问题**: wf09 库存快照和 wf10 库位同步的增量锚点一直卡在同一个日期不前进。
**根因**: JavaScript 代码用 `split('T')[0]` 或 `substring(0, 10)` 截断时间戳到日期，导致锚点精度丢失。每次运行时 SAP 都返回相同的旧数据，锚点永远不会更新。
**修复**: `split('T')[0]` → `substring(0, 19)` 保留 `YYYY-MM-DD HH:mm:ss` 精度。
**规则**: 增量锚点的时间精度必须 >= SAP 源数据的更新精度。

### 教训 15: n8n MSSQL 节点必须用表达式包装

**问题**: 将 SAP 查询从 `={{ "SQL..." }}` 改为纯字符串后，只返回 2 行（应返回 17,000+）。
**根因**: n8n MSSQL 节点 (typeVersion 1) 只有在 `={{ "..." }}` 表达式包装下才能正确执行查询。纯字符串参数行为异常。
**规则**: 所有 MSSQL 节点的 query 参数必须用 `={{ "SQL" }}` 包装，即使是纯静态 SQL。

### 全量模式 vs 增量模式决策

| 场景 | 推荐模式 | 原因 |
|------|---------|------|
| 每日快照 (DELETE+INSERT) | **全量** | 快照本质就是当前状态全量镜像 |
| 缓存同步 (UPSERT) | 增量 | 只同步变化的记录，效率更高 |
| 主数据同步 | 增量 | 变化少，全量浪费 |

wf09 (库存快照) 改为全量模式后效果:
- SAP 查询: `WHERE OnHand > 0` (无增量条件)
- PG 写入: `DELETE WHERE snapshot_date = today` + `INSERT` (覆盖当天)
- 结果: 2 行 → 17,064 行 (18 个仓库)

---

## 四、company_code 架构决策

```
company_code 是 DP 项目自己的多租户标签，不来自 SAP:
  - SAP B1 用独立数据库隔离公司，无行级 company_code
  - DP v0.1 每公司独立部署 (clone → 改 .env → up)
  - 数据库 NOT NULL 要求 INSERT 时必须提供
  - 值来自 .env 的 DP_COMPANY_CODE (如 "ACME")
  - Code 节点: const cc = $env.DP_COMPANY_CODE;
  - Expression 字段: {{ $env.DP_COMPANY_CODE }}
```

---

## 五、跨项目凭据 ID 重映射 SOP (v2.4 — 2026-02-28)

> **场景**: 从项目 A 导出的工作流 JSON 导入项目 B 时，凭据 ID 不匹配导致所有节点报错
> **根因**: n8n 凭据 ID 在每个实例中独立生成，跨实例不可复用

### 教训 16: 凭据 ID 跨项目不可复用

**错误**: `Credential with ID "xxx" does not exist for type "postgres"`

**v0.1.9+ 仓库已脱敏**: 工作流 JSON 中使用占位符，不含任何实例凭据 ID。

**占位符映射表** (仓库中的值 → 部署时需替换):
| 占位符 | 含义 | 替换为 |
|--------|------|--------|
| `__CREDENTIAL_PG_ID__` | PostgreSQL 凭据 ID | 新实例中创建的 PG 凭据 ID |
| `__CREDENTIAL_PG_NAME__` | PostgreSQL 凭据名 | 新实例中创建的 PG 凭据名 |
| `__CREDENTIAL_MSSQL_ID__` | MSSQL 凭据 ID | 新实例中创建的 MSSQL 凭据 ID |
| `__CREDENTIAL_MSSQL_NAME__` | MSSQL 凭据名 | 新实例中创建的 MSSQL 凭据名 |
| `__PROJECT_ID__` | n8n 项目 ID | 新实例的 personal project ID |
| `__CREATOR_ID__` | n8n 创建者 ID | 新实例的 owner user ID |
| `user@example.com` | 用户邮箱 | 实际管理员邮箱 |
| `Deploy User` | 用户姓名 | 实际管理员姓名 |

**部署步骤**:
```bash
# 1. 新实例中创建凭据 (n8n UI → Settings → Credentials)
# 2. 查询新凭据 ID
docker exec dp-db psql -U dp_fs -d dpfs -c \
  "SET search_path TO wf; SELECT id, name, type FROM credentials_entity;"
# 3. 查询 project ID 和 creator ID
docker exec dp-db psql -U dp_fs -d dpfs -c \
  "SET search_path TO wf; SELECT id, name, type FROM project; SELECT id, email FROM \"user\";"
```

**修复 — 批量替换凭据占位符**:
```python
# Python 批量替换 (处理单行/多行 JSON)
import glob

# 映射表: 占位符 → 新实例的实际值
REPLACE_MAP = {
    "__CREDENTIAL_PG_ID__":     "新实例的PG凭据ID",
    "__CREDENTIAL_PG_NAME__":   "新实例的PG凭据名",
    "__CREDENTIAL_MSSQL_ID__":  "新实例的MSSQL凭据ID",
    "__CREDENTIAL_MSSQL_NAME__":"新实例的MSSQL凭据名",
    "__PROJECT_ID__":           "新实例的projectId",
    "__CREATOR_ID__":           "新实例的creatorId",
    "user@example.com":         "实际管理员邮箱",
    "Deploy User":              "实际管理员姓名",
}

for fpath in sorted(glob.glob("apps/wf/wf*.json")):
    with open(fpath) as f:
        content = f.read()
    for placeholder, actual in REPLACE_MAP.items():
        content = content.replace(placeholder, actual)
    with open(fpath, 'w') as f:
        f.write(content)
```

**⚠️ 导出回仓库时**: 从运行中的 n8n 导出工作流后，务必用反向脚本将实例值替换回占位符再提交。

### 教训 17: import 后 activeVersionId 为 NULL = webhook 不注册

**问题**: `n8n import:workflow` 后日志显示 `Processed N draft workflows, 0 published workflows`
**根因**: CLI import 不设置 `activeVersionId`，n8n 2.x 将其视为 draft (草稿)
**修复**:
```bash
# import 后必须执行:
docker exec dp-db psql -U dp_fs -d dpfs -c "
SET search_path TO wf;
UPDATE workflow_entity
SET \"activeVersionId\" = \"versionId\"
WHERE \"activeVersionId\" IS NULL;"

# 然后重启 (让 n8n 重新注册 webhook)
docker restart dp-wf
# 日志应显示: Processed N draft workflows, N published workflows
# 以及: Activated workflow "xxx" (ID: yyy)
```

### 教训 18: 数据库修改节点 SQL 时禁止从 Git JSON 整体替换节点

**问题**: 通过数据库修复 wf05 `SAP查询` 节点的 SQL 后，相邻节点 `SAP查询更新日期` 报错 `Credential with ID '__CREDENTIAL_MSSQL_ID__' does not exist`。
**根因**: 修复时从 Git 仓库的 `apps/wf/wf05-*.json` 读取了完整节点数据，但 Git 中是脱敏版本（凭据全是 `__CREDENTIAL_*_ID__` 占位符）。写入 DB 时把真实凭据 ID 覆盖成了占位符。
**规则**:
```
通过 DB 更新工作流节点时:
  ✅ 只修改目标字段 (如 SQL 查询) — 用 REPLACE() 或 jsonb_set()
  ✅ 直接从 DB 读取当前节点 → 修改 → 写回 (保留真实凭据)
  ❌ 从 Git 仓库 JSON 读取节点数据写入 DB (会写入脱敏占位符)
  ❌ 整体替换 nodes 数组中的节点 (影响凭据/位置/连接等)

恢复方法:
  1. SELECT id, name, type FROM wf.credentials_entity;  -- 查真实凭据 ID
  2. UPDATE ... SET nodes = REPLACE(REPLACE(nodes::text, 占位符, 真实ID), ...)::json
  3. 同步 workflow_history + docker restart dp-wf
```

### 教训 19: n8n API PUT 整体替换工作流会覆盖手动修正

**问题**: 用 API PUT 将 Git 版本的完整工作流推送到线上 n8n，导致之前在 n8n 编辑器中手动修正的字段名/逻辑被覆盖回错误版本。
**根因**: Git JSON 与线上 n8n 存在版本差异（线上已手动修正 BUG，Git 未同步）。API PUT 整体替换不区分哪些节点有改动。
**规则**:
```
API PUT 更新工作流时:
  ✅ 先 GET 线上版本 → 对比 Git 版本差异 → 仅修改确认需要变更的节点
  ✅ 修改完成后先测试验证，再 PUT 回去
  ❌ 直接将 Git JSON 整体 PUT 到线上 (会覆盖手动修正)
  ❌ 未对比就替换 (Git 可能落后于线上)

安全的 API 更新流程:
  1. GET /api/v1/workflows/{id} → 获取线上最新版本
  2. 在线上版本基础上精确修改目标节点
  3. PUT 修改后的版本 (保留线上其他节点不变)
  4. 测试验证后再更新 Git JSON
```

### 教训 20: Git JSON 与线上 n8n 不同步是常态

**问题**: n8n 编辑器中的手动修改不会自动同步回 Git，导致 Git JSON 是过时版本。
**根因**: n8n 没有双向同步机制，编辑器修改只存在数据库中。
**规则**:
```
n8n 工作流变更后必须同步:
  ✅ 每次在 n8n 编辑器修改后，导出 JSON 并更新 Git
  ✅ 部署前先 GET 线上版本对比 Git，确认是否有未同步的修改
  ✅ 发现差异时，以线上版本为准（线上是实际运行的版本）
  ❌ 假设 Git JSON 是最新版本
  ❌ 不对比直接用 Git 版本覆盖线上
```

### 教训 21: 纯函数库字段名必须与 SQL 输出 + 前端完全对齐

**问题**: `wf08-stock-aggregator.js` 使用 `warehouse_code`/`location_code`/`batch_no`，但 SQL 输出是 `whs_code`/`bin_code`/`batch_number`，前端也用后者。函数运行后所有聚合维度错误。
**根因**: 提取纯函数库时，字段名来自开发者记忆而非实际 SQL/前端代码。
**规则**:
```
提取 n8n Code 节点为纯函数库时:
  ✅ 先读取实际 SQL 的 SELECT 输出字段名
  ✅ 先读取前端实际使用的字段名 (如 stock.html/stock.js)
  ✅ 三方对齐: SQL 输出 = 纯函数 = 前端消费
  ❌ 凭记忆写字段名
  ❌ 不看 SQL 就写聚合逻辑
```

### 教训 22: 单元测试使用错误字段名 = "假覆盖"

**问题**: `wf08-stock-aggregator.test.js` 测试数据也用了错误字段名 (`warehouse_code` 等)，所有测试通过但实际数据完全不工作。
**根因**: 测试和被测函数使用相同的错误字段名，形成"自洽的错误"。
**规则**:
```
编写纯函数测试时:
  ✅ 测试数据必须模拟真实数据格式 (从 SQL 查询结果或 API 返回值取样)
  ✅ 至少有一个测试用例验证"透传字段"是否正确保留
  ✅ 字段名变更时，先改测试数据，确认测试失败，再改函数
  ❌ 凭记忆构造测试数据 (可能和函数犯同样的错)
  ❌ 只测逻辑正确性，不测字段名正确性
```

### 教训 23: n8n Code 节点返回值格式必须配合 Respond to Webhook

**问题**: `构建响应` Code 节点返回多个 n8n item，但 `Respond to Webhook` 节点的 `{{ JSON.stringify($json) }}` 只取最后一个 item，导致前端只收到一条记录。
**根因**: n8n 的 `$json` 是当前 item 的数据，多 item 场景下 Respond 节点只处理最后一个。
**规则**:
```
n8n Code 节点 + Respond to Webhook 配合:
  ✅ Code 节点返回单个 item 包装: return [{ json: { success: true, data: [...] } }]
  ✅ Respond 节点使用: {{ JSON.stringify($json) }}
  ❌ Code 节点返回多个 item: return items.map(i => ({ json: i }))
     (Respond 只会发最后一个)
  ❌ Code 节点返回裸数组: return aggregatedData
     (n8n 不认识，需要 { json: ... } 包装)
```

### 完整首次部署检查清单 (v0.1.9+ 占位符版)

```
□ 1. 新实例中创建凭据 (n8n UI → Settings → Credentials)
     - PostgreSQL: host=dp-db, port=5432, database=<DP_DB_NAME>, user=<DP_DB_USER>
     - Microsoft SQL: host=<SAP_IP>, port=1433, database=<SAP_DB>, user=sa
□ 2. 查询新凭据 ID + 项目 ID:
     SELECT id, name, type FROM wf.credentials_entity;
     SELECT id, name FROM wf.project;
     SELECT id, email FROM wf."user";
□ 3. 运行占位符替换脚本 (上述 Python 脚本, 填入实际值)
□ 4. docker cp + n8n import:workflow --input=<file>
□ 5. 设置 activeVersionId = versionId (教训 17)
□ 6. 数据库中设置 active = true (0a/0b 除外)
□ 7. docker restart dp-wf
□ 8. 验证: webhook_entity 应有 30 条记录
□ 9. 验证: 日志显示 "N published workflows"
□ 10. 导出回仓库时: 反向替换实际值 → 占位符，再 git commit
```

---

## 变更日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-02-23 | v1.0 | 初始创建: 10 大教训 + 批量操作 SOP + n8n 2.x 配置 + company_code 架构 |
| 2026-02-24 | v1.1 | 补充: 教训 11 (connections 节点名残留) + 教训 3 扩展 (COALESCE+reduce 实战) |
| 2026-02-24 | v1.2 | 新增: n8n 批量管理 SOP (导入/激活/删除/重编号), WSL 路径经验大幅扩展 |
| 2026-02-24 | v1.3 | 教训 3 扩展 (INTEGER列赋值TRUE报错), 文件命名规范 (wf0a/0b, wf02-09补零), apps/wf/ 清理工具脚本→scripts/n8n-tools/ |
| 2026-02-24 | v1.4 | 教训 12 (PG常量折叠::integer), 教训 13 (localStorage 5MB), n8n API PUT 更新SOP |
| 2026-02-27 | v1.5 | 新增: 跨容器工作流+凭据迁移 SOP (旧 n8n → dp-wf), 加密密钥不同时的凭据导出方案 |
| 2026-02-27 | v1.6 | 新增: Data Tables 迁移 SOP (SQLite → PostgreSQL), 含表结构/导出/导入/踩坑记录 |
| 2026-02-27 | v1.7 | 新增: Data Tables 多公司隔离防护 (备份排除 + 业务数据归位 wms schema) |
| 2026-02-27 | v1.8 | 新增: n8n /data 卷跨平台挂载 (Windows WSL/macOS/Linux 路径差异 + Docker Desktop 文件共享) |
| 2026-02-27 | v1.9 | 新增: §三-D 三环境配置方案 (多 .env 文件 + --env-file 切换 + 安全端口绑定 + X-Forwarded-Host) |
| 2026-02-27 | v2.0 | 修复: API_BASE_URL 必须用相对路径 `/api/wms` (绝对域名 URL → CORS 跨域登录失败), 三环境对照表同步更新 |
| 2026-02-28 | v2.1 | 新增: §三-E 执行日志清理 SOP + 教训 14 (增量锚点截断) + 教训 15 (MSSQL 表达式包装) |
| 2026-02-28 | v2.2 | 修复: §三-E 清理 SOP 升级 — 强调 insights 表是 Overview 数据源 (只清 execution 不清 insights = Overview 仍显旧数据), 7 张表缺一不可, 增加验证步骤 |
| 2026-02-28 | v2.5 | 重构: §五 凭据重映射 SOP 全面升级 — 仓库工作流 JSON 脱敏 (8 类占位符), 部署检查清单适配占位符流程, 新增反向替换导出提醒 |
| 2026-02-28 | v2.3 | 新增: §7-8 多项目首次初始化 SOP — JSON 数组格式处理/id 注入/容器内 API 调用/GENERIC_TIMEZONE 拼写陷阱, API 端口由 DP_WF_PORT 配置 |
| 2026-02-28 | v2.4 | 新增: §五 跨项目凭据 ID 重映射 SOP — 教训 16 (凭据 ID 不可复用) + 教训 17 (activeVersionId 为 NULL = webhook 不注册) + 完整首次部署检查清单 |
| 2026-03-02 | v2.6 | 新增: 教训 18 (DB 修改节点 SQL 禁止从 Git JSON 整体替换 — 脱敏占位符覆盖真实凭据) |
| 2026-03-05 | v2.7 | 新增: 教训 19-23 (API PUT 整体替换风险/Git 与线上不同步/纯函数字段对齐/假覆盖测试/Code+Respond 格式) |
| 2026-03-17 | v2.8 | 新增: §三 queue 模式配置 (dp-wf-worker 容器 + CLI flag 并发 + 执行数据修剪 + 5 条注意事项) |
