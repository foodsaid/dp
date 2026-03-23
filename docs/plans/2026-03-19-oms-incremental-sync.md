# OMS 增量同步改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 OMS 同步从"每次全量扫描所有月份"改造为基于 SAP UpdateDate 锚点的增量同步，并增加月度数量校验层，彻底解决重复同步和手动停止后无法续传的问题。

**Architecture:** 三层设计 — Layer1 锚点增量（每次只重置最近变更的月份，带安全回退窗口 + 并发锁）、Layer2 数量校验（用 PG 实时聚合 vs SAP 实时聚合比对，避免静态快照悖论）、Layer3 全量历史（现有逻辑不变，一次性使用）。所有层复用现有 `oms.sync_progress` 队列 + `wf20a` 执行器，改动最小化。

**Tech Stack:** PostgreSQL 17 / n8n / Microsoft SQL Server (SAP B1)

---

## 已知前提确认（实施前必须确认）

| 问题 | 确认项 | 影响 |
|------|--------|------|
| SAP 是否为单公司库？ | ✅ 是 → Layer2 SAP COUNT 无需过滤公司<br>❌ 否 → SAP COUNT 必须加 BPLId/CardCode 过滤 | Layer2 数据正确性 |
| `sync_progress.row_count` 口径 | 必须 = `COUNT(DISTINCT sap_doc_entry)` 单据数，不是行数 | Layer2 比对口径一致性 |

> **如 SAP 是多公司库，Layer2 的 4 个 SAP COUNT 查询必须加公司过滤条件，否则不可上线。**

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `infrastructure/postgres/init/16_oms_sync_incremental.sql` | 新建 | DDL: sync_progress 加 sap_count 列 + orders 索引 |
| `apps/wf/wf20-oms-sync-so.json` | 修改 | Layer1: 加锚点+锁节点，修改生成计划逻辑 |
| `apps/wf/wf20-oms-sync-po.json` | 修改 | 同上 |
| `apps/wf/wf20-oms-sync-wo.json` | 修改 | 同上 |
| `apps/wf/wf20-oms-sync-tr.json` | 修改 | 同上 |
| `apps/wf/wf20d-oms-sync-verify.json` | 新建 | Layer2: 月度数量校验（动态聚合比对） |

> wf20a / wf20b / wf20c 不需要改动。

---

## 核心设计说明

### Layer1 锚点逻辑（修改 4 个 launcher）

**当前问题**：每次触发从 `DP_OMS_SYNC_START_DATE` 全量生成，历史 completed 月份永远不会重新检查最近变更的数据。

**修正后的锚点策略**（修正了两个致命缺陷）：

```
anchor = MAX(sap_update_date) FROM oms.orders WHERE doc_type=...

安全回退 = anchor - 1 个月（月底缝隙防护，因为 SAP 可能在月底改老数据）
（注：月份回退已经覆盖了 7 天安全窗口，无需额外 SAFE_DAYS 计算）

重置范围 = month_start >= safe_anchor_month 的 completed 月份 → pending
```

**为什么回退一个月而不是 7 天**：
- 如果 anchor = 2026-03-10，回退 7 天 = 2026-03-03，锚点月依然是 3 月
- 如果 2026-02-28 有数据被修改（UpdateDate 变为 2026-03-xx），2 月份不会被重置
- 回退一个月 = 重置 2月+3月，覆盖所有月底缝隙场景，且 UPSERT 幂等，无副作用

**并发保护**：
- 在锚点查询之前，先用 `pg_try_advisory_lock` 申请软锁
- 锁 key = `hashtext(company_code || doc_type)`
- 锁失败直接返回 `{ message: "已有同步任务运行中" }`，不执行后续逻辑

### Layer2 数量校验（修正了"流动水桶悖论"）

**致命缺陷的根源**：`sync_progress.row_count` 是历史执行快照（静态）。SAP 的 UpdateDate 是可变的（订单被修改后 UpdateDate 随之更新到新月份）。用静态 vs 动态比较，必然产生永久性差异，导致死循环重同步。

**修正方案**：Layer2 比对的双方都必须是**实时动态聚合**：

```
比对左侧（DP）：
  SELECT COUNT(*) FROM oms.orders
  WHERE sap_update_date BETWEEN month_start AND month_end AND doc_type=...
  （与 SAP 同口径：按 sap_update_date 分组）

比对右侧（SAP）：
  SELECT COUNT(DISTINCT DocEntry)
  WHERE UpdateDate BETWEEN month_start AND month_end
  （同上，按 UpdateDate 分组）

容忍阈值：|diff| > 2 才触发重置
（避免 NOLOCK 脏读导致的微小波动触发不必要重同步）
```

---

## Task 1: DDL

**Files:**
- 新建: `infrastructure/postgres/init/16_oms_sync_incremental.sql`

- [ ] **Step 1: 创建 DDL 文件**

```sql
-- =============================================================================
-- 16_oms_sync_incremental.sql — OMS 增量同步扩展
-- v0.7.1: sync_progress.sap_count + orders 查询索引
-- 幂等: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
-- =============================================================================

-- Layer2 校验写入 SAP 端计数
ALTER TABLE oms.sync_progress
    ADD COLUMN IF NOT EXISTS sap_count INTEGER DEFAULT NULL;

COMMENT ON COLUMN oms.sync_progress.sap_count
    IS 'SAP 端该月按 UpdateDate 统计的单据数（Layer2 校验写入），NULL=未校验';

-- Layer1 锚点查询性能索引（表大后必须有）
CREATE INDEX IF NOT EXISTS idx_orders_anchor
    ON oms.orders (company_code, doc_type, sap_update_date DESC);

-- 差异校验视图（运维快查）
CREATE OR REPLACE VIEW oms.v_sync_discrepancy AS
SELECT company_code, doc_type,
       month_start, month_end,
       row_count  AS dp_count,
       sap_count,
       sap_count - row_count AS diff,
       status,
       completed_at
FROM oms.sync_progress
WHERE sap_count IS NOT NULL
  AND ABS(sap_count - COALESCE(row_count, 0)) > 2
ORDER BY doc_type, month_start;

GRANT SELECT ON oms.v_sync_discrepancy TO dp_app_rls, dp_bi;
```

- [ ] **Step 2: 在容器中执行 DDL**

```bash
docker exec dp-db psql -U dp_app -d dp_wms \
  -f /docker-entrypoint-initdb.d/16_oms_sync_incremental.sql
```

预期：`ALTER TABLE` + `CREATE INDEX` + `CREATE VIEW`，无 ERROR。

- [ ] **Step 3: 验证**

```bash
docker exec dp-db psql -U dp_app -d dp_wms -c \
  "SELECT column_name FROM information_schema.columns WHERE table_schema='oms' AND table_name='sync_progress' AND column_name='sap_count';"
```

预期：返回 1 行 `sap_count`。

---

## Task 2: Layer1 — 4 个 Launcher 增量锚点改造

**Files:**
- 修改: `apps/wf/wf20-oms-sync-wo.json`（其余 3 个同理）

### 2.1 流程变更

```
原：手动同步触发 → RLS set_config → 检查队列 → 生成计划 → ...
新：手动同步触发 → RLS set_config → 申请锁 → 检查队列 → 读取锚点 → 生成计划 → ...
```

### 2.2 新节点：`申请锁`（PG，插在 RLS set_config 之后）

```json
{
  "parameters": {
    "operation": "executeQuery",
    "query": "SELECT pg_try_advisory_lock(hashtext(current_setting('app.company_code') || 'WO')) AS acquired",
    "options": {}
  },
  "id": "o20w0001-0001-0001-0001-000000000010",
  "name": "申请锁",
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [-100, 200],
  "alwaysOutputData": true,
  "credentials": { "postgres": { "id": "__CREDENTIAL_PG_WMS__", "name": "__CREDENTIAL_PG_WMS_NAME__" } }
}
```

`申请锁` 后接 IF 节点 `锁获取成功?`：
- 条件：`$json.acquired == true`
- true 分支 → `检查队列`
- false 分支 → `锁冲突响应`（respondToWebhook 返回 `{ success: false, message: "已有同步任务运行中，请稍后再试" }`）

### 2.3 新节点：`读取锚点`（PG，插在 检查队列 和 生成计划 之间）

以 WO 为例（SO/PO/TR 改 doc_type）：

```json
{
  "parameters": {
    "operation": "executeQuery",
    "query": "SELECT MAX(sap_update_date)::text AS anchor_date FROM oms.orders WHERE company_code = current_setting('app.company_code') AND doc_type = 'WO'",
    "options": {}
  },
  "id": "o20w0001-0001-0001-0001-000000000011",
  "name": "读取锚点",
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [350, 300],
  "alwaysOutputData": true,
  "credentials": { "postgres": { "id": "__CREDENTIAL_PG_WMS__", "name": "__CREDENTIAL_PG_WMS_NAME__" } }
}
```

### 2.4 修改 `生成计划` Code 节点（V2.0）

以 WO 为例：

```javascript
// V2.0: 锚点增量同步 + 月份安全回退 + 注入防护
const docType = 'WO';  // 各 launcher 不同: SO / PO / WO / TR
const companyCode = ($env.DP_COMPANY_CODE || '').replace(/'/g, "''");
const cnt = Number($('检查队列').first().json.cnt) || 0;

if (cnt > 0) {
  return { json: { _has_queue: true, doc_type: docType, message: docType + ' 同步已在队列中，请等待完成' } };
}

const anchorDate = $input.first().json.anchor_date; // 来自读取锚点

let sql = '';

// Step1: 重置 failed → pending（保持原逻辑）
sql += `UPDATE oms.sync_progress SET status='pending', error_message=NULL, started_at=NULL WHERE company_code='${companyCode}' AND doc_type='${docType}' AND status='failed';\n`;

// Step2: 如果有锚点，重置"锚点前一个月"及之后的 completed 月份 → pending
// 回退一个月 = 防月底缝隙（月末修改的老订单 UpdateDate 推到次月，导致本月数量减少）
if (anchorDate && anchorDate !== 'null') {
  const d = new Date(anchorDate);
  d.setMonth(d.getMonth() - 1); // 强制回退 1 个月
  const safeAnchorMonth = d.toISOString().slice(0, 7) + '-01'; // e.g. "2026-02-01"
  sql += `UPDATE oms.sync_progress SET status='pending', error_message=NULL, started_at=NULL, completed_at=NULL WHERE company_code='${companyCode}' AND doc_type='${docType}' AND status='completed' AND month_start >= '${safeAnchorMonth}';\n`;
}

// Step3: 补全所有月份（DO NOTHING 跳过已有行）
const startStr = ($env.DP_OMS_SYNC_START_DATE || '20240101').replace(/'/g, "''");
const startDate = new Date(startStr.slice(0,4) + '-' + startStr.slice(4,6) + '-01');
const now = new Date();
const values = [];
for (let d = new Date(startDate); d <= now; d.setMonth(d.getMonth() + 1)) {
  const ms = d.toISOString().slice(0, 10);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const me = lastDay.toISOString().slice(0, 10);
  values.push(`('${companyCode}', '${docType}', '${ms}', '${me}', 'pending')`);
}

sql += `INSERT INTO oms.sync_progress (company_code, doc_type, month_start, month_end, status)\nVALUES ${values.join(',\n')}\nON CONFLICT (company_code, doc_type, month_start) DO NOTHING;`;

return {
  json: {
    _has_queue: false,
    doc_type: docType,
    sql: sql,
    total_batches: values.length,
    anchor_date: anchorDate,
    safe_anchor_month: anchorDate && anchorDate !== 'null'
      ? (() => { const d = new Date(anchorDate); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,7); })()
      : null
  }
};
```

### 2.5 Connections 变更（以 WO 为例）

```
RLS set_config → 申请锁 → 锁获取成功? → [true] 检查队列 → 读取锚点 → 生成计划 → ...
                                        → [false] 锁冲突响应
```

原 `connections["RLS set_config"]` 指向 `检查队列` → 改为指向 `申请锁`。

### 2.6 执行步骤

- [ ] **Step 1: 修改 wf20-oms-sync-wo.json**

添加节点 `申请锁`（id: `o20w...010`）、`锁获取成功?`（IF，id: `...012`）、`锁冲突响应`（respondToWebhook，id: `...013`）、`读取锚点`（id: `...011`）。

修改 `生成计划` jsCode 为上方 V2.0（docType = 'WO'）。

更新 connections 按 2.5 所示。

- [ ] **Step 2: 同样修改 wf20-oms-sync-so.json**（docType='SO'，节点 id 前缀 `o20s`）

- [ ] **Step 3: 同样修改 wf20-oms-sync-po.json**（docType='PO'，节点 id 前缀 `o20p`）

- [ ] **Step 4: 同样修改 wf20-oms-sync-tr.json**（docType='TR'，节点 id 前缀 `o20t`）

- [ ] **Step 5: 通过 n8n API SOP 部署 4 个工作流**

按 `.claude/skills/n8n-database-operations.md` SOP，对每个工作流：
```
GET /api/v1/workflows/{id}  →  精确修改 nodes + connections
→ PATCH active:false  →  PUT body（过滤后）→  PATCH active:true
```

- [ ] **Step 6: 验证 WO launcher**

```bash
# 触发
curl -s -X POST http://localhost:25678/webhook/wms/oms/sync/wo | jq .
```

预期输出包含 `anchor_date`（非 null，如有 WO 数据）和 `safe_anchor_month`（比 anchor 早 1 个月）。

```bash
# 检查 sync_progress: 只有最近 2 个月重置为 pending，其余保持 completed
docker exec dp-db psql -U dp_app -d dp_wms -c "
SELECT doc_type, status, COUNT(*), MIN(month_start)::text, MAX(month_start)::text
FROM oms.sync_progress WHERE doc_type='WO'
GROUP BY doc_type, status ORDER BY status;"
```

- [ ] **Step 7: 验证并发锁**

```bash
# 同时触发两次（模拟并发）
curl -s -X POST http://localhost:25678/webhook/wms/oms/sync/wo &
curl -s -X POST http://localhost:25678/webhook/wms/oms/sync/wo &
wait
```

预期：其中一次返回 `{ "success": false, "message": "已有同步任务运行中..." }`。

---

## Task 3: Layer2 — 新建 wf20d 月度数量校验工作流

**Files:**
- 新建: `apps/wf/wf20d-oms-sync-verify.json`

### 3.1 工作流结构

```
POST /wms/oms/sync/verify
→ RLS set_config
→ DP 实时聚合 (PG: 按 sap_update_date 分组 COUNT，4 doc_type)
→ SAP-SO计数 / SAP-PO计数 / SAP-WO计数 / SAP-TR计数 (MSSQL 并行)
→ 汇总比对 (Code: 动态 vs 动态，|diff|>2 才触发)
→ 有差异? (IF)
→ [有] 写入修复 (PG) → 触发批次执行器
→ [无] 直接 Respond
→ Respond
```

### 3.2 关键节点定义

**节点: DP 实时聚合**（PG，替代静态 row_count）

```sql
SELECT doc_type,
       TO_CHAR(sap_update_date, 'YYYY-MM') AS month_key,
       COUNT(*) AS dp_count
FROM oms.orders
WHERE company_code = current_setting('app.company_code')
  AND sap_update_date IS NOT NULL
GROUP BY doc_type, TO_CHAR(sap_update_date, 'YYYY-MM')
ORDER BY doc_type, month_key
```

**节点: SAP-WO计数**（MSSQL，需 JOIN WOR1 过滤 ItemType=4）

```sql
SET NOCOUNT ON;
SELECT 'WO' AS doc_type,
       CONVERT(varchar(7), T0.UpdateDate, 120) AS month_key,
       COUNT(DISTINCT T0.DocEntry) AS sap_count
FROM OWOR T0 WITH (NOLOCK)
INNER JOIN WOR1 T1 WITH (NOLOCK) ON T0.DocEntry = T1.DocEntry AND T1.ItemType = 4
WHERE T0.UpdateDate >= '2024-01-01'
GROUP BY CONVERT(varchar(7), T0.UpdateDate, 120)
```

SO/PO/TR 类似（分别用 ORDR/OPOR/OWTQ，COUNT(DISTINCT DocEntry)，无需 JOIN）。

> 注意：如 SAP 为多公司库，4 个 COUNT 查询均需加公司过滤条件（实施前确认）。

**节点: 汇总比对**（Code）

```javascript
// 动态 vs 动态比对，|diff| > 2 才触发重置
const dpRows = $('DP实时聚合').all().map(r => r.json);
const sapRows = $input.all().map(r => r.json).filter(r => r.doc_type && r.month_key);

// SAP 映射: doc_type_month_key → sap_count
const sapMap = new Map();
sapRows.forEach(r => sapMap.set(`${r.doc_type}_${r.month_key}`, Number(r.sap_count) || 0));

// DP 映射: doc_type_month_key → dp_count
const dpMap = new Map();
dpRows.forEach(r => dpMap.set(`${r.doc_type}_${r.month_key}`, Number(r.dp_count) || 0));

// 取所有月份的并集
const allKeys = new Set([...sapMap.keys(), ...dpMap.keys()]);
const toReset = [];
const report = [];

allKeys.forEach(key => {
  const [docType, monthKey] = key.split('_');
  const sapCnt = sapMap.get(key) || 0;
  const dpCnt  = dpMap.get(key) || 0;
  const diff = sapCnt - dpCnt;
  const needReset = Math.abs(diff) > 2; // 容忍 NOLOCK 微小波动
  if (needReset) toReset.push({ doc_type: docType, month_key: monthKey, sap_count: sapCnt });
  if (diff !== 0) report.push({ doc_type: docType, month: monthKey, dp_count: dpCnt, sap_count: sapCnt, diff, reset: needReset });
});

return { json: { to_reset: toReset, report, reset_count: toReset.length } };
```

**节点: 生成修复SQL**（Code，接 IF 有差异? 的 true 分支）

```javascript
const toReset = $json.to_reset;
const companyCode = ($env.DP_COMPANY_CODE || '').replace(/'/g, "''");

// 按 doc_type + month 匹配 sync_progress，UPDATE status='pending' + sap_count
const conditions = toReset.map(r => {
  const monthStart = r.month_key + '-01';
  return `(doc_type='${r.doc_type}' AND month_start='${monthStart}' AND status='completed')`;
}).join(' OR ');

const sapCaseWhen = toReset.map(r => {
  return `WHEN doc_type='${r.doc_type}' AND month_start='${r.month_key}-01' THEN ${r.sap_count}`;
}).join(' ');

const sql = `
UPDATE oms.sync_progress
SET status='pending',
    sap_count = CASE ${sapCaseWhen} ELSE sap_count END,
    error_message='Layer2数量校验差异，自动重置',
    started_at=NULL,
    completed_at=NULL
WHERE company_code='${companyCode}'
  AND (${conditions});
`;

return { json: { sql, reset_count: toReset.length } };
```

后接 PG executeQuery 节点执行 SQL，再接 HTTP 触发执行器（`http://dp-wf:5678/webhook/wms/oms/sync/next`，continueOnFail: true）。

### 3.3 执行步骤

- [ ] **Step 1: 创建 wf20d-oms-sync-verify.json**

按上方节点定义组装完整 JSON，节点 ID 格式 `o20d0001-0001-0001-0001-00000000000N`，webhookId `wms-oms-sync-verify`。

- [ ] **Step 2: 通过 API 导入并激活 wf20d**

```bash
# 导入
N8N_API_KEY="..." curl -X POST http://localhost:25678/api/v1/workflows \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d @apps/wf/wf20d-oms-sync-verify.json

# 激活（用返回的 id）
N8N_API_KEY="..." curl -X PATCH http://localhost:25678/api/v1/workflows/{id} \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"active": true}'
```

- [ ] **Step 3: 验证 wf20d**

```bash
curl -s -X POST http://localhost:25678/webhook/wms/oms/sync/verify | jq .
```

预期：`{ "success": true, "reset_count": N, "report": [...] }`

检查报告：`diff` 为 0 的月份不应出现在 `report` 中；`|diff| <= 2` 的不在 `to_reset` 中。

- [ ] **Step 4: 验证差异视图**

```bash
docker exec dp-db psql -U dp_app -d dp_wms -c "SELECT * FROM oms.v_sync_discrepancy LIMIT 10;"
```

---

## Task 4: 更新文档 + 提交

- [ ] **Step 1: 更新 apps/wf/README.md**，增加 wf20d 行

- [ ] **Step 2: 向用户确认 GitHub Issue 编号**

```
我在审查代码时发现了以下问题已全部修复并纳入本次计划：
1. [严重] Layer1 锚点月底缝隙 — 月份安全回退 1 个月
2. [严重] Layer2 流动水桶悖论 — 改用 PG 实时聚合替代静态 row_count
3. [中等] 并发触发冲突 — pg_try_advisory_lock 软锁
4. [中等] NOLOCK 脏读触发误重置 — 容忍阈值 |diff| > 2
5. [低] SQL 注入防护 — companyCode .replace(/'/g, "''")

请告知 Issue 编号，我们开始提交。
```

- [ ] **Step 3: 提交**

```
feat: OMS 增量同步改造 — Layer1 锚点+安全回退+并发锁 / Layer2 动态聚合校验 (Fixes #XX)
```

---

## 验证矩阵

| 场景 | 预期行为 |
|------|---------|
| oms.orders 有 WO，anchor=2026-03-10 | 触发 WO 同步后，2月+3月重置为 pending，历史月份保持 completed |
| 2026-02-28 SAP 有旧单被修改 | 因 safe_anchor_month=2月，2月被重置，数据不遗漏 |
| 两次并发触发 WO 同步 | 第二次返回"已有同步任务运行中"，锁保护 |
| wf20d 校验，某月 SAP=150 DP=148（diff=2） | |diff|=2，不触发重置（容忍阈值） |
| wf20d 校验，某月 SAP=150 DP=120（diff=30） | 重置为 pending，sap_count=150，自动触发批次执行 |
| wf20d 校验，1月 SAP=95（5单被改到3月） | DP 也按 sap_update_date 聚合，1月=95，diff=0，无死循环 |

---

## 操作手册（给用户）

**日常增量同步**（推荐，只重置最近 2 个月）：
```bash
curl -X POST http://localhost:25678/webhook/wms/oms/sync/wo
```

**月度数量校验**（每月或怀疑数据偏差时）：
```bash
curl -X POST http://localhost:25678/webhook/wms/oms/sync/verify
```

**查看当前差异**：
```sql
SELECT * FROM oms.v_sync_discrepancy;
```

**强制全量重同步某类型**（谨慎，需等待时间长）：
```bash
# 1. 停止当前同步
curl -X POST http://localhost:25678/webhook/wms/oms/sync/stop
# 2. 重置所有月份（手动操作）
docker exec dp-db psql -U dp_app -d dp_wms -c "
UPDATE oms.sync_progress SET status='failed' WHERE doc_type='WO';"
# 3. 触发（将自动从 failed → pending 全量跑）
curl -X POST http://localhost:25678/webhook/wms/oms/sync/wo
```
