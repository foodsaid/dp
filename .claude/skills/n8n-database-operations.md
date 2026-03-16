# n8n 数据库操作速查 (PostgreSQL 后端)

> **适用**: n8n 2.x + PostgreSQL (Schema: wf)
> **凭证**: dp-db 容器内 psql -U $POSTGRES_USER -d $POSTGRES_DB
> **更新**: 2026-03-05 v1.6 — 新增: API 方式精确更新节点 SOP (容器内 node 调用)

---

## 核心表关系

```
workflow_entity (草稿)
  ├─ id (工作流 ID)
  ├─ nodes (JSON: 当前编辑版本)
  ├─ versionId (当前版本号)
  ├─ activeVersionId → workflow_history.versionId (发布版本)
  └─ active (是否激活)

workflow_history (版本历史)
  ├─ versionId (版本 ID)
  ├─ workflowId → workflow_entity.id
  └─ nodes (JSON: 该版本的节点快照) ← n8n 激活时实际读取的源!

webhook_entity (运行时缓存)
  ├─ webhookPath (如 wms/auth/login)
  ├─ method (GET/POST)
  ├─ node (节点名)
  └─ workflowId → workflow_entity.id

credentials_entity (凭证)
  ├─ id, name, type (如 postgres, microsoftSql)
  └─ data (加密的连接参数)

shared_credentials (凭证 → 项目关系)
  └─ credentialsId, projectId, role

shared_workflow (工作流 → 项目关系)
  └─ workflowId, projectId, role
```

## Webhook URL 规范

```
n8n 有两种 webhook 端点，绝不要搞混:

/webhook/path      → 生产模式 (工作流激活后永久可用)
/webhook-test/path → 测试模式 (需在编辑器点 "Listen for Test Event"，仅一次性)

浏览器测试地址:
  ✅ http://localhost:5678/webhook/wms/init-masterdata   (直连 n8n)
  ✅ http://localhost:8080/api/wms/init-masterdata        (通过网关)
  ❌ http://0.0.0.0:5678/...                               (容器内部地址，浏览器不可达)
  ❌ http://localhost:5678/webhook-test/...                (需先在编辑器点按钮)

WEBHOOK_URL 环境变量 (⚠️ 不是 N8N_WEBHOOK_URL — n8n 2.x 不识别带前缀的!):
  docker-compose.yml: WEBHOOK_URL: ${WEBHOOK_URL:-http://localhost:5678}
  开发 .env: WEBHOOK_URL=http://localhost:5678
  生产 .env: WEBHOOK_URL=https://wf.example.com

  n8n UI 显示 = WEBHOOK_URL + /webhook/ + Path字段
  WMS 前端用  = /api/wms/... (网关重写 → /webhook/wms/...)
  两条路径殊途同归，都到同一个 webhook

多公司部署: 只改 .env 即可
  WEBHOOK_URL=https://wf.companyB.com
  N8N_EDITOR_BASE_URL=https://wf.companyB.com/
  API_BASE_URL=/api/wms
```

## ⚠️ $env 访问控制 — n8n 2.x 安全变更

```
n8n 2.x 默认全面封锁 $env 访问 (Code 节点 + 表达式字段 全部!):
  环境变量: N8N_BLOCK_ENV_ACCESS_IN_NODE
  v1.x 默认 = 未封锁 (需手动设 "true" 才封锁)
  v2.x 默认 = 已封锁 (需手动设 "false" 才解封) ← 破坏性变更!

  错误: Cannot assign to read only property 'name' of object 'Error: access to env vars denied'

DP 项目解决方案: 在 docker-compose.yml 显式解封
  N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"
  理由: 自托管单租户部署，安全可接受

解封后所有上下文均可访问 $env:
  ✅ Code 节点:        const cc = $env.DP_COMPANY_CODE;
  ✅ Expression 字段:  {{ $env.DP_COMPANY_CODE }}
  ✅ Set / IF 节点:    {{ $env.DP_COMPANY_CODE }}

当前使用 $env 的工作流:
  - WMS - 期初库存导入:  Code='生成批量INSERT' → $env.DP_COMPANY_CODE
  - WMS - 库存快照同步:  Code='转换+生成SQL'   → $env.DP_COMPANY_CODE

company_code 架构说明:
  - company_code 是 DP 自己的设计 (非 SAP 字段)
  - SAP B1 按数据库隔离公司，不是行级字段
  - DP v0.1 每公司独立部署，company_code 是固定常量标签
  - 数据库 NOT NULL 约束要求 INSERT 时必须提供
  - 值来自 .env 的 DP_COMPANY_CODE (如 "ACME")
```

## 常用查询

```sql
-- 列出所有工作流及状态
SELECT name, active, id FROM wf.workflow_entity ORDER BY name;

-- 列出所有注册的 webhook
SELECT "webhookPath", method, node, "workflowId" FROM wf.webhook_entity ORDER BY 1;

-- 列出所有凭证
SELECT id, name, type FROM wf.credentials_entity;

-- 查找特定类型的节点
SELECT we.name, n->>'name' as node_name, n->>'type' as node_type
FROM wf.workflow_entity we, json_array_elements(we.nodes) as n
WHERE n->>'type' = 'n8n-nodes-base.microsoftSql';

-- 检查 MySQL 语法残留
SELECT name FROM wf.workflow_entity
WHERE nodes::text LIKE '%CURDATE%'
   OR nodes::text LIKE '%IFNULL%'
   OR nodes::text LIKE '%SEPARATOR%'
   OR nodes::text LIKE '%GROUP_CONCAT%';

-- 查看用户
SELECT id, email FROM wf."user";
```

## ⚠️ FALSE/TRUE 跨语言陷阱 — 批量扫描查询

```sql
-- 扫描所有工作流中的 FALSE/TRUE 问题 (MSSQL + JS + PG混用)
-- 每次批量修改或导入工作流后必须运行!
SELECT e.name,
       CASE
         WHEN h.nodes::text ~ '"FALSE"' THEN 'FALSE in nodes'
         WHEN h.nodes::text ~ ', FALSE)' THEN 'FALSE as function arg'
       END as issue
FROM wf.workflow_entity e
JOIN wf.workflow_history h ON h."versionId" = e."activeVersionId"
WHERE h.nodes::text ~ '\bFALSE\b'
   OR h.nodes::text ~ 'ISNULL\([^,]+, ''''\)'  -- ISNULL(col, '') 空字符串用于数值列
ORDER BY e.name;
```

### FALSE 跨语言对照表

| 语境 | `FALSE` 含义 | 是否合法 | 正确写法 |
|------|-------------|---------|---------|
| **MSSQL SQL** | 无此关键字 (认为是列名) | ❌ `Invalid column name 'FALSE'` | `0` |
| **MSSQL SQL** | `ISNULL(numeric_col, '')` | ❌ `Error converting varchar to numeric` | `ISNULL(col, 0)` |
| **JavaScript** | `FALSE` 未定义 | ❌ `FALSE is not defined` | `false` 或 `0` |
| **PostgreSQL** | 布尔字面量 | ✅ 合法 | `FALSE` (仅用于 BOOLEAN 列) |
| **PostgreSQL** | `COALESCE(SUM(qty), FALSE)` | ❌ 类型不匹配 numeric vs bool | `COALESCE(SUM(qty), 0)` |

### 批量修复脚本模板

```python
# Python 修复模板 — 保存为 /tmp/fix_false.py 执行
import json, re, subprocess

DB_USER, DB_NAME = "dp_app", "dp_db"

def sql(query):
    r = subprocess.run(
        ["docker", "exec", "dp-db", "psql", "-U", DB_USER, "-d", DB_NAME, "-t", "-A", "-c", query],
        capture_output=True, text=True
    )
    return r.stdout.strip()

def fix_node(node):
    """修复单个节点，返回是否修改"""
    params = node.get("parameters", {})
    changed = False

    # MSSQL: ISNULL(col, FALSE) → ISNULL(col, 0)
    if "microsoftSql" in node.get("type", ""):
        q = params.get("query", "")
        new_q = re.sub(r"ISNULL\(([^,]+),\s*FALSE\)", r"ISNULL(\1, 0)", q)
        new_q = new_q.replace("ISNULL(B.maxLevel, '')", "ISNULL(B.maxLevel, 0)")
        if new_q != q:
            params["query"] = new_q
            changed = True

    # JavaScript: .reduce(..., FALSE) → .reduce(..., 0)
    code = params.get("jsCode", "")
    new_code = re.sub(r",\s*FALSE\)", ", 0)", code)
    if new_code != code:
        params["jsCode"] = new_code
        changed = True

    # PostgreSQL: COALESCE(SUM(...), FALSE) → COALESCE(SUM(...), 0)
    if "postgres" in node.get("type", ""):
        q = params.get("query", "")
        new_q = re.sub(r"COALESCE\(SUM\(([^)]+)\),\s*FALSE\)", r"COALESCE(SUM(\1), 0)", q)
        if new_q != q:
            params["query"] = new_q
            changed = True

    return changed

# 遍历所有工作流，修复 entity + history
# ... (完整脚本见 /tmp/fix_false_all.py)
```

## 工作流节点注入 (正确模式)

```sql
-- ⚠️ 正确顺序: 先 INSERT history，再 UPDATE entity
-- 原因: workflow_entity.activeVersionId 有 FK 约束指向 workflow_history.versionId
-- 如果反过来，UPDATE entity 会因为 history 里没有对应 versionId 而报 FK 错误

BEGIN;

-- 1. 先插入新版本到 workflow_history (必须在 UPDATE 之前!)
INSERT INTO wf.workflow_history
  ("versionId", "workflowId", authors, name, nodes, connections, "createdAt", "updatedAt")
VALUES
  ('新UUID', '工作流ID', '作者', '工作流名', '新nodes'::json, '新connections'::json, NOW(), NOW());

-- 2. 再更新 workflow_entity (nodes + connections + versionId + activeVersionId 四个都要!)
UPDATE wf.workflow_entity SET
  nodes = '新nodes'::json,
  connections = '新connections'::json,
  "versionId" = '新UUID',
  "activeVersionId" = '新UUID',   -- ⚠️ 这个最关键! 决定 webhook 执行哪个版本
  "updatedAt" = NOW()
WHERE id = '工作流ID';

COMMIT;
-- 3. docker restart dp-wf
```

### ⚠️ 血泪教训

```
1. activeVersionId 必须更新!
   只更新 versionId + nodes 不够，n8n 2.x 的 webhook 执行引擎
   读取 activeVersionId 指向的 workflow_history.nodes，不是 workflow_entity.nodes。
   不更新 activeVersionId → 重启后还是跑旧版本!

2. workflow_entity.nodes 类型是 json (不是 jsonb)
   INSERT/UPDATE 时必须加 ::json 类型转换

3. wms_documents.status CHECK 约束
   有效值: 'draft', 'in_progress', 'completed', 'cancelled', 'exported'
   ❌ 'pending' 不是有效的 status! (但 wms_status 可以是 'pending')

4. Python 中 JS 模板字面量不需要转义
   Python 不解释 ${expr}，以下写法直接用:
   ✅ code = "const sql = `${esc(cc)}`;"   # Python 照搬
   ❌ code = "" + "`" + "{esc(cc)}`;"       # 错误! 会破坏 JS 语法

5. workflow_history.authors NOT NULL
   INSERT 时必须提供 authors 字段 (如 'BO Li')

6. JSON 序列化后的单引号转义
   nodes_sql = json.dumps(nodes).replace("'", "''")  # PostgreSQL 单引号转义

7. 通过 DB 更新节点时不能从 Git 仓库 JSON 整体替换!
   Git 中的工作流 JSON 是脱敏版 (凭据全是 __CREDENTIAL_*_ID__ 占位符)。
   如果从 Git 读取节点数据写入 DB → 所有凭据被覆盖为占位符 → 节点报错:
   "Credential with ID '__CREDENTIAL_MSSQL_ID__' does not exist"

   ✅ 正确: 只更新目标字段 (如 SQL 查询)，用 jsonb_set 或 REPLACE 精确修改
   ❌ 错误: 从 Git JSON 整体替换 nodes 数组中的某个节点

8. 修复凭据占位符被误写入 DB 的恢复方法:
   -- 查询真实凭据 ID
   SELECT id, name, type FROM wf.credentials_entity;
   -- 批量替换占位符
   UPDATE wf.workflow_entity
   SET nodes = REPLACE(REPLACE(REPLACE(REPLACE(nodes::text,
     '__CREDENTIAL_MSSQL_ID__', '真实MSSQL_ID'),
     '__CREDENTIAL_MSSQL_NAME__', '真实MSSQL名'),
     '__CREDENTIAL_PG_ID__', '真实PG_ID'),
     '__CREDENTIAL_PG_NAME__', '真实PG名')::json
   WHERE name LIKE '%目标工作流%';
   -- 同步 history + 重启
```

## 精确更新单节点 SQL (不触碰凭据)

```sql
-- ✅ 安全模式: 只更新目标节点的 query 字段，保留原有凭据不变
-- 适用: 修复某个节点的 SQL 语句，但不想影响凭据/连接/位置等

-- 方法 A: REPLACE 字符串替换 (最安全，适合小改动)
UPDATE wf.workflow_entity
SET nodes = REPLACE(nodes::text,
  '旧SQL片段',
  '新SQL片段')::json
WHERE name LIKE '%wf05%';

-- 方法 B: 用 json 数组索引更新特定节点的特定字段 (适合整体替换 SQL)
-- 先查出目标节点在 nodes 数组中的索引
SELECT idx, n->>'name' FROM wf.workflow_entity,
  json_array_elements(nodes) WITH ORDINALITY AS t(n, idx)
WHERE name LIKE '%wf05%' AND n->>'name' = 'SAP查询';
-- 然后用 jsonb_set 精确更新 (注意 json→jsonb→json 转换)
UPDATE wf.workflow_entity
SET nodes = (
  SELECT jsonb_set(nodes::jsonb, ARRAY[(idx-1)::text, 'parameters', 'query'],
    '"新的SQL语句"'::jsonb)::json
  FROM (SELECT idx FROM ... WHERE n->>'name' = '目标节点') sub
)
WHERE name LIKE '%wf05%';

-- ⚠️ 无论用哪种方法，都必须同步 workflow_history:
UPDATE wf.workflow_history
SET nodes = (SELECT nodes FROM wf.workflow_entity WHERE id = '工作流ID')
WHERE "versionId" = '活跃版本ID';
-- 然后 docker restart dp-wf
```

## n8n API 精确更新节点 (推荐方式)

```
当 n8n 端口未发布到宿主机时 (仅容器内可访问 5678):
  通过 docker exec dp-wf node -e "..." 在容器内发起 HTTP 请求

安全的 API 更新流程 (精确修改单个节点):
  1. GET → 获取线上最新工作流 JSON
  2. Python/Node 解析 JSON → 找到目标节点 → 仅修改需要变更的字段
  3. 构建 PUT body (只保留 name/nodes/connections/settings/staticData)
  4. 写入临时 JSON 文件 → docker cp 到容器 → 容器内 node 读文件发 PUT
  5. 先 deactivate → PUT → activate (避免热更新冲突)

示例 Python 脚本模板:
```

```python
#!/usr/bin/env python3
"""n8n API 精确更新节点模板"""
import subprocess, json

API_KEY = "从 DB 查询: SELECT data FROM wf.settings WHERE key = 'n8n-api-key'"
WF_ID = "目标工作流 ID"

def docker_node(js):
    r = subprocess.run(["docker", "exec", "dp-wf", "node", "-e", js],
                       capture_output=True, text=True)
    try: return json.loads(r.stdout)
    except: return r.stdout

def n8n_get(path):
    return docker_node(f"""
const http=require('http');
http.request({{host:'localhost',port:5678,path:'{path}',method:'GET',
headers:{{'X-N8N-API-KEY':'{API_KEY}'}}}},
res=>{{let d='';res.on('data',c=>d+=c);res.on('end',()=>process.stdout.write(d))}}).end();""")

def n8n_put_file(path, filepath):
    return docker_node(f"""
const http=require('http'),fs=require('fs');
const data=fs.readFileSync('{filepath}','utf8');
http.request({{host:'localhost',port:5678,path:'{path}',method:'PUT',
headers:{{'X-N8N-API-KEY':'{API_KEY}','Content-Type':'application/json',
'Content-Length':Buffer.byteLength(data)}}}},
res=>{{let d='';res.on('data',c=>d+=c);res.on('end',()=>process.stdout.write(d))}}).end(data);""")

def n8n_post(path):
    return docker_node(f"""
const http=require('http');
http.request({{host:'localhost',port:5678,path:'{path}',method:'POST',
headers:{{'X-N8N-API-KEY':'{API_KEY}','Content-Type':'application/json',
'Content-Length':2}}}},
res=>{{let d='';res.on('data',c=>d+=c);res.on('end',()=>process.stdout.write(d))}}).end('{{}}');""")

# 1. GET 线上版本
wf = n8n_get(f"/api/v1/workflows/{WF_ID}")

# 2. 精确修改目标节点
for node in wf['nodes']:
    if node['name'] == '目标节点名':
        node['parameters']['jsCode'] = "新代码"  # 只改需要的字段
        break

# 3. 构建 PUT body (不包含 id/createdAt/updatedAt 等只读字段)
allowed = {'name', 'nodes', 'connections', 'settings', 'staticData'}
put_body = {k: v for k, v in wf.items() if k in allowed}
with open('/tmp/wf-put.json', 'w') as f:
    json.dump(put_body, f, ensure_ascii=False)
subprocess.run(["docker", "cp", "/tmp/wf-put.json", "dp-wf:/tmp/wf-put.json"], check=True)

# 4. Deactivate → PUT → Activate
n8n_post(f"/api/v1/workflows/{WF_ID}/deactivate")
n8n_put_file(f"/api/v1/workflows/{WF_ID}", "/tmp/wf-put.json")
n8n_post(f"/api/v1/workflows/{WF_ID}/activate")
```

```
⚠️ 关键注意事项:
  - API PUT 会替换整个 nodes 数组，但因为是从 GET 获取的线上版本修改的，凭据不会丢失
  - 与 DB 方式的区别: API 方式自动处理 versionId/activeVersionId/webhook 注册
  - 无需手动重启 dp-wf
  - 对比 Git 和线上差异时，以线上为准 (线上可能有 n8n 编辑器的手动修改)
```

## 危险操作 (已弃用的旧模式 — 保留参考)

```sql
-- ⚠️ 旧模式: 直接更新 entity 再同步 history (不推荐)
-- 推荐使用上面的"工作流节点注入"新模式
BEGIN;
UPDATE wf.workflow_entity SET nodes = '...'::json WHERE id = 'xxx';
UPDATE wf.workflow_history wh SET nodes = we.nodes
FROM wf.workflow_entity we
WHERE wh."workflowId" = we.id AND wh."versionId" = we."activeVersionId";
DELETE FROM wf.webhook_entity;
COMMIT;
-- docker restart dp-wf
```

## 工作流导入最佳实践

```bash
# 传输文件 (WSL 空格路径安全方式)
cat "/home/user/Digital Platform/apps/wf/file.json" | \
  docker exec -i dp-wf sh -c "cat > /tmp/file.json"

# 导入 (不要用 --userId 和 --separate)
docker exec dp-wf n8n import:workflow --input=/tmp/file.json

# 导入后设置 activeVersionId
docker exec dp-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  UPDATE wf.workflow_entity
  SET \"activeVersionId\" = \"versionId\"
  WHERE \"activeVersionId\" IS NULL;"

# 激活
docker exec dp-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  UPDATE wf.workflow_entity SET active = true WHERE name LIKE 'WMS%';"

# 重启 + 验证
docker restart dp-wf && sleep 15
docker exec dp-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  SELECT COUNT(*) FROM wf.webhook_entity;"
```

## SQL 跨平台迁移必检清单

```
每次新增或修改工作流后，按此清单逐项扫描:

=== MSSQL (SAP 查询节点) ===
□ ISNULL(numeric_col, FALSE)     → ISNULL(numeric_col, 0)
□ ISNULL(numeric_col, '')        → ISNULL(numeric_col, 0)
□ 无 SET NOCOUNT ON              → 加上 SET NOCOUNT ON
□ 无 WITH (NOLOCK)               → 加上 WITH (NOLOCK)

=== JavaScript (Code 节点) ===
□ .reduce(fn, FALSE)             → .reduce(fn, 0)
□ if (x == TRUE)                 → if (x === true) 或 if (x)
□ FALSE 作为变量                  → false (小写) 或 0
□ $env.XXX 在 Code 节点          → 需确认 N8N_BLOCK_ENV_ACCESS_IN_NODE=false
□ INSERT 列数 ≠ VALUES 数         → 检查 company_code 是否遗漏

=== PostgreSQL ===
□ COALESCE(SUM(qty), FALSE)      → COALESCE(SUM(qty), 0)  [类型不匹配]
□ posted_flag = FALSE            → ✅ 有效 (BOOLEAN 列)
□ is_active = TRUE               → ✅ 有效 (BOOLEAN 列)
□ IFNULL()                       → COALESCE()
□ DATE_FORMAT()                  → TO_CHAR()
□ CURDATE()                      → CURRENT_DATE
□ GROUP_CONCAT(... SEPARATOR)    → json_agg(...)::text
□ INSERT IGNORE                  → ON CONFLICT DO NOTHING
□ ON DUPLICATE KEY UPDATE        → ON CONFLICT (key) DO UPDATE SET col=EXCLUDED.col
```

## 变更日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-02-23 | v1.0 | 初始创建 |
| 2026-02-23 | v1.1 | 新增: FALSE/TRUE 跨语言防御规则, Webhook URL 规范, 批量扫描查询, 跨平台迁移清单 |
| 2026-02-23 | v1.2 | 新增: $env 访问被拒模式 + 占位符解决方案 (已废弃) |
| 2026-02-23 | v1.3 | 修正: $env 方案改为 N8N_BLOCK_ENV_ACCESS_IN_NODE=false (废弃占位符), company_code 架构说明 |
| 2026-02-25 | v1.4 | 重写: 工作流节点注入正确模式 (activeVersionId/FK 约束/事务顺序), 血泪教训 6 条, CHECK 约束, Python 模板字面量 |
| 2026-03-02 | v1.5 | 新增: 血泪教训 #7/#8 (DB 更新禁止从 Git JSON 整体替换 — 脱敏占位符覆盖凭据) + 精确更新单节点 SQL 安全模式 |
| 2026-03-05 | v1.6 | 新增: n8n API 精确更新节点 SOP (容器内 node 调用模板 + PUT body 构建 + deactivate/activate 流程) |
