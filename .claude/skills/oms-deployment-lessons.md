# OMS 部署经验 (v0.1.14+)

> **创建**: 2026-03-03
> **更新**: 2026-03-20 v8.0 — 新增教训 35 (WMS-SAP 解耦迁移: wf1x MSSQL→PG + 领空保护 + sync_status 闭环)
> **来源**: OMS P1+P2 首次部署 + P3 WO 全栈支持实战 + 生产环境部署验证

---

## 教训 1: DDL 列名 vs 工作流 SQL 列名不一致

**问题**: 工作流 JSON 开发时使用了 `bp_code`、`planned_qty`、`actual_qty`、`delivered_qty` 等直觉列名，但 DDL 实际列名是 `business_partner`、`quantity`、`wms_actual_qty`、`open_quantity`。

**影响**: n8n 执行报 `column xxx does not exist`，API 返回空 body (200 但 0 字节)。

**修复**: 批量全文替换 4 个工作流 JSON + 前端 oms.html。

**预防 SOP**:
1. DDL 定义完成后，**立即生成列名映射表**
2. 工作流 Code 节点开发时，**必须对照 DDL 列名**，不要凭直觉
3. 使用 Python 脚本审计所有 `o.xxx`/`ol.xxx` 引用是否在 DDL 列集合内
4. 对于 API 返回字段名与前端期望不一致的情况，在 SQL 中使用 `AS` 别名

**列名映射参考**:
| 直觉名称 | DDL 实际列名 | 说明 |
|----------|------------|------|
| `bp_code` | `business_partner` | 客商编码 |
| `planned_qty` | `quantity` | 计划数量 |
| `actual_qty` | `wms_actual_qty` | WMS 实际数量 |
| `delivered_qty` | `open_quantity` | SAP 未交数量 |
| `event_data` | `new_value` | 事件数据 |

---

## 教训 2: n8n 并行节点导致 "Node hasn't been executed" 错误

**问题**: wf21 中 `Has Error? → [Count Query, List Query](并行) → 格式化结果`，格式化结果引用 `$('List Query')` 但该节点可能未完成。

**原因**: n8n IF 节点 false 分支同时连接两个 PG 节点，格式化结果从 Count Query 收到输入后立即执行，此时 List Query 可能还在运行。

**修复**: 改为**串行执行** `Has Error? → Count Query → List Query → 格式化结果`。`格式化结果` 用 `$('Count Query')` 跨节点引用获取 count 结果。

**预防 SOP**:
- n8n 中需要等待多个节点完成再处理时，**优先用串行链接**
- 如果必须并行，使用 **Merge 节点** (mode: waitForAll) 汇合后再处理
- 避免 Code 节点同时依赖两个并行上游节点的 `$('xxx')` 引用

---

## 教训 3: 空查询结果返回空对象 `[{}]`

**问题**: PostgreSQL 节点在无结果时返回 `[{}]` 而非 `[]`，导致 API 返回 `orders: [{}]`。

**修复**: 格式化结果节点增加过滤 `total > 0 ? $('List Query').all().map(r => r.json).filter(r => r.id) : []`。

**预防 SOP**: 所有从 PG 节点取数据的 Code 节点，都要处理空结果场景 (`.filter(r => r.id || r.count)`)。

---

## 教训 4: OMS Schema 需要手动创建

**问题**: `05_oms_tables.sql` 只在容器首次初始化时自动执行。已运行的环境需要手动执行 DDL。

**修复**: `docker exec -i dp-db psql -U $USER -d $DB < infrastructure/postgres/init/05_oms_tables.sql`

**同时**: `wms.wms_documents.doc_type` CHECK 约束也需要手动更新添加 'DD':
```sql
ALTER TABLE wms.wms_documents DROP CONSTRAINT wms_documents_doc_type_check;
ALTER TABLE wms.wms_documents ADD CONSTRAINT wms_documents_doc_type_check
  CHECK (doc_type IN ('SO','WO','PO','TR','IC','LM','PI','DD'));
```

---

## 教训 5: psql 输出 SET 前缀干扰脚本

**问题**: `SET search_path TO wf;` 输出 `SET` 字符串混入查询结果，导致 Python JSON 解析失败。

**修复**: 使用 `grep -v '^SET$'` 过滤，或在 SQL 中使用 `SET search_path ... \gset` (无输出)。

---

## 教训 6: ⚠️ 禁止 `{{ $json.sql }}` 传递动态 SQL (安全漏洞)

**问题**: wf20 原设计中 `构建SAP查询` Code 节点生成完整 SQL 字符串，通过 `{{ $json.sql }}` 传给 MSSQL 节点执行。这是**重大安全漏洞** — 允许任意 SQL 在 SAP 数据库上执行。

**违反规则**: CLAUDE.md 明确规定 "SAP B1 集成 — MS SQL 直连 (仅查询)"

**修复**:
1. **SAP MSSQL 节点**: SQL **必须硬编码**在节点 query 字段中，仅日期等参数用 `{{ $json.last_sync_date }}` 动态注入
2. **Code 节点**: 只准备和校验参数（如日期格式 YYYY-MM-DD regex），**禁止构建 SQL**
3. **PG ETL 节点**: 批量 UPSERT 的 `{{ $json.sql }}` 可接受（内部数据流、非用户输入），但必须：
   - 字符串用 `esc()` 转义
   - 数值用 `num()` 校验（`const num = (v) => { const n = Number(v); return isNaN(n) ? 0 : n; };`）

**安全架构原则**:
```
✅ MSSQL 节点: 硬编码 SQL + {{ 参数 }}   (SQL 结构不可变)
✅ PG 节点:    queryReplacement ($1, $2)  (参数化查询, 最安全)
⚠️ PG 节点:    {{ $json.sql }} + esc/num  (内部 ETL, 可接受)
❌ MSSQL 节点:  {{ $json.sql }}            (禁止! 允许任意 SQL)
❌ 任何节点:    字符串拼接无 esc/num        (SQL 注入风险)
```

---

## 教训 7: SAP 列名与 DDL 列名映射错误

**问题**: SAP 的 `DelivrdQty` (已交数量) 被映射到 OMS 的 `open_quantity` (未交数量)；POR1 的 `RcptQty` 列不存在。

**根因**:
- SAP `DelivrdQty` = 已交付数量 (已完成的)
- SAP `OpenQty` = 未交付数量 (待完成的) ← 才是正确映射
- SAP POR1 没有 `RcptQty` 列

**修复**: SO 和 PO 统一用 `T1.OpenQty AS open_quantity`

**SAP B1 常用列速查**:
| SAP 列 | 含义 | 存在于 |
|--------|------|--------|
| `Quantity` | 订单数量 | RDR1, POR1, WOR1 |
| `OpenQty` | 未交/未收数量 | RDR1, POR1 |
| `DelivrdQty` | 已交付数量 | RDR1 |
| `DocEntry` | 内部 ID (唯一) | 所有头表 |
| `DocNum` | 单据编号 (用户可见) | 所有头表 |
| `UpdateDate` | 更新日期 (DATE) | 所有头表 |
| `UpdateTS` | 更新时间 (INTEGER, 如 92745) | 所有头表 |

---

## 教训 8: SAP UpdateTS 是整数格式

**问题**: SAP `UpdateTS` 字段是整数 (如 `92745` 表示 09:27:45)，不是 DATETIME。直接 `CONVERT(varchar, T0.UpdateTS, 8)` 不会产生 `HH:MM:SS` 格式。

**错误**: `invalid input syntax for type time: "92745"` (PG TIME 列拒绝整数字符串)

**修复**:
```sql
-- ❌ 错误: CONVERT 不会格式化整数
CONVERT(varchar, T0.UpdateTS, 8) AS sap_update_time

-- ✅ 正确: STUFF 插入冒号
STUFF(STUFF(RIGHT('000000'+CAST(T0.UpdateTS AS VARCHAR),6),5,0,':'),3,0,':') AS sap_update_time
-- 92745 → '092745' → '09:27:45'
```

---

## 教训 9: n8n `add-ids.js` 导致重复工作流

**问题**: 每次运行 `add-ids.js` 都会生成新的随机 ID。多次导入同一工作流会创建多个副本，而非更新原有工作流。webhook 仍指向第一个导入的版本。

**影响**: 修改后的代码导入成功但不生效（webhook 仍调用旧版本）。

**修复/清理**:
```sql
SET search_path TO wf;
BEGIN;
-- 1. 断开 FK
UPDATE workflow_entity SET "activeVersionId" = NULL WHERE id IN ('重复ID1', '重复ID2');
-- 2. 按顺序删除
DELETE FROM webhook_entity WHERE "workflowId" IN ('重复ID1', '重复ID2');
DELETE FROM workflow_history WHERE "workflowId" IN ('重复ID1', '重复ID2');
DELETE FROM shared_workflow WHERE "workflowId" IN ('重复ID1', '重复ID2');
DELETE FROM workflow_entity WHERE id IN ('重复ID1', '重复ID2');
COMMIT;
```

**预防 SOP**:
1. **首次导入**: 用 `add-ids.js` 生成 ID → 记录下每个工作流的 ID
2. **后续更新**: 用 `REPLACE` 精确更新 DB 中的节点（参见 `n8n-database-operations.md`），避免重复导入
3. **或者**: 导入前先查询已有 ID，用 `jq` 将其写入 JSON 再导入
4. **检查重复**: `SELECT name, COUNT(*) FROM workflow_entity GROUP BY name HAVING COUNT(*) > 1;`

---

## 教训 10: ⚠️ n8n 导入禁止删除无关工作流

**问题**: 正式环境中可能已有公司特有的、或已上线的工作流。批量导入时**绝对禁止**使用会删除其他工作流的方式。

**规则**:
- ✅ `--separate --input=目录/` — 逐个更新/创建，不影响其他工作流
- ✅ `--input=单文件.json` — 导入单个工作流
- ❌ `n8n import:workflow` 配合 `--deleteAll` — **绝对禁止**
- ❌ 任何会覆盖整个 workflow_entity 表的操作

**注意**: 即使是开发环境，也应养成安全习惯，避免在生产环境犯错。

---

## 教训 11: ON CONFLICT 必须精确匹配唯一索引

**问题**: `ON CONFLICT (columns)` 的列组合和 WHERE 条件必须**精确匹配**某个 UNIQUE INDEX。PostgreSQL 不会"最佳匹配"——要么完全匹配，要么报错。

**常见错误**:
```sql
-- 唯一索引: (company_code, doc_type, sap_doc_entry) WHERE parent_id IS NULL AND sap_doc_entry IS NOT NULL
-- ❌ 错误: 缺少 WHERE 条件
ON CONFLICT (company_code, doc_type, sap_doc_entry) DO UPDATE ...
-- ❌ 错误: WHERE 条件不完整
ON CONFLICT (company_code, doc_type, sap_doc_entry) WHERE parent_id IS NULL DO UPDATE ...
-- ✅ 正确: 完全匹配
ON CONFLICT (company_code, doc_type, sap_doc_entry) WHERE parent_id IS NULL AND sap_doc_entry IS NOT NULL DO UPDATE ...
```

**预防**: 写 ON CONFLICT 前先 `\d oms.orders` 查看所有索引，确认 WHERE 条件一字不差。

---

## 教训 12: INSERT 必须包含所有 NOT NULL 列

**问题**: `oms.orders.doc_number` 为 `NOT NULL`，但 SAP 同步 INSERT 遗漏了该列。

**错误**: `null value in column "doc_number" of relation "orders" violates not-null constraint`

**修复**: 对于 SAP 同步的订单，`doc_number = sap_doc_num`。对于 DD 拆单，`doc_number = 'DD' + parent_sap_doc_num + '-' + split_seq`。

**预防 SOP**: 写 INSERT 前先检查表的所有 NOT NULL 列:
```sql
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'oms' AND table_name = 'orders' AND is_nullable = 'NO'
ORDER BY ordinal_position;
```

---

## 教训 13: n8n webhook typeVersion 1.1 不支持路径参数

**问题**: `wms/oms/orders/:id/lines` 路径在 n8n 2.x 中注册成功 (webhook_entity.pathLength=5)，但实际请求 `GET /webhook/wms/oms/orders/31/lines` 返回 404 "webhook not registered"。

**原因**: n8n 2.x 的 webhook typeVersion 1.1 在路由匹配时不能正确解析路径参数 `:id`。项目中其他所有 WMS 工作流都使用 query parameter 方式。

**修复**: 改为 query parameter 方式:
```
❌ GET /webhook/wms/oms/orders/:id/lines  (路径参数, 不可用)
✅ GET /webhook/wms/oms/order-lines?order_id=31  (查询参数, 标准方式)
```

**Code 节点参数获取**:
```javascript
// ❌ 路径参数方式 (不可用)
const orderId = parseInt($input.first().json.params.id);
// ✅ 查询参数方式
const orderId = parseInt($input.first().json.query.order_id);
```

**预防**: 在 n8n 中统一使用 query parameter，不使用路径参数。

---

## 教训 14: n8n 串行节点传入导致 Code 节点重复执行

**问题**: `Query Lines → Query DD Children → 合并结果` 串行链接时，`Query Lines` 返回 N 行，每行都会触发 `Query DD Children` 执行一次，最终 `合并结果` 收到 N × M 条 DD 子单数据。

**修复**: 在 `合并结果` Code 节点中按 `id` 去重:
```javascript
const seen = new Set();
$('Query DD Children').all().forEach(r => {
  if (r.json.id && !seen.has(r.json.id)) {
    seen.add(r.json.id);
    ddChildren.push(r.json);
  }
});
```

**同时**: 用 try-catch 保护可能未执行的节点引用:
```javascript
try {
  ddChildren = $('Query DD Children').all()...;
} catch(e) { /* 未执行时安全忽略 */ }
```

**预防**: 当串行节点可能产生多行传入时，下游汇总节点必须去重。

---

## 教训 15: 前端 API 路径必须与 webhook 路径同步更新

**问题**: webhook 路径从 `/oms/orders/:id/lines` 改为 `/oms/order-lines?order_id=` 后，必须同步更新前端代码。

**检查清单**:
1. 搜索前端所有 `apiGet`/`apiPost` 调用中涉及变更路径的引用
2. 更新参数传递方式 (路径参数 → query 参数)
3. 确认工作流 JSON 导出到本地 `apps/wf/` 目录

---

## OMS 工作流部署完整 SOP

### 前置条件
1. ✅ PG 数据库中已创建 `oms` Schema (执行 `05_oms_tables.sql`)
2. ✅ `wms_documents.doc_type` CHECK 已包含 'DD'
3. ✅ n8n 中已存在 PostgreSQL 和 MSSQL 凭据

### 步骤
```bash
# 1. 查询真实凭据 ID
docker exec $DB_CONTAINER psql -U $USER -d $DB -c \
  "SET search_path TO wf; SELECT id, name, type FROM credentials_entity;"

# 2. 复制工作流到临时目录并替换占位符
mkdir -p /tmp/oms-wf
cp apps/wf/wf{20,21,22,1c}*.json /tmp/oms-wf/
cd /tmp/oms-wf
for f in *.json; do
  sed -i 's/__CREDENTIAL_PG_ID__/<真实PG_ID>/g; s/__CREDENTIAL_PG_NAME__/<真实PG名>/g' "$f"
  sed -i 's/__CREDENTIAL_MSSQL_ID__/<真实MSSQL_ID>/g; s/__CREDENTIAL_MSSQL_NAME__/<真实MSSQL名>/g' "$f"
done

# 3. ⚠️ add-ids 只运行一次! 记录生成的 ID 用于后续更新
node scripts/n8n-tools/add-ids.js /tmp/oms-wf/

# 4. 导入 (--separate 安全模式，不删除其他工作流)
docker cp /tmp/oms-wf dp-wf:/tmp/oms-wf
docker exec dp-wf n8n import:workflow --separate --input=/tmp/oms-wf

# 5. 修复 activeVersionId + 激活
docker exec $DB_CONTAINER psql -U $USER -d $DB -c "
  SET search_path TO wf;
  UPDATE workflow_entity SET \"activeVersionId\" = \"versionId\", active = true
  WHERE name LIKE 'wf1c%' OR name LIKE 'wf2%';"

# 6. 重启 n8n
docker restart dp-wf

# 7. 验证 webhook 注册
docker exec $DB_CONTAINER psql -U $USER -d $DB -c "
  SET search_path TO wf;
  SELECT we.\"webhookPath\", wfe.name FROM webhook_entity we
  JOIN workflow_entity wfe ON we.\"workflowId\" = wfe.id
  WHERE wfe.name LIKE '%OMS%' OR wfe.name LIKE '%wf1c%';"

# 8. 检查重复工作流 (必须!)
docker exec $DB_CONTAINER psql -U $USER -d $DB -c "
  SET search_path TO wf;
  SELECT name, COUNT(*) FROM workflow_entity GROUP BY name HAVING COUNT(*) > 1;"
```

### 后续更新 (非首次导入)
```bash
# ⚠️ 不要再次 add-ids.js ! 会产生重复
# 方式 A: 直接用 REPLACE 更新 DB (推荐, 参见 n8n-database-operations.md)
# 方式 B: 用 jq 写入已有 ID 后重新导入
jq '.id = "已有ID"' wf20-oms-sync.json > /tmp/wf20-update.json
```

### 验证检查点
- [ ] `GET /webhook/wms/oms/orders?page=1&page_size=10` → `{"success":true, "total":N, ...}`
- [ ] `GET /webhook/wms/oms/orders?doc_type=SO` → SO 类型过滤正常
- [ ] `GET /webhook/wms/oms/order-lines?order_id=N` → `{"success":true, "lines":[...], "dd_children":[...]}`
- [ ] `POST /webhook/wms/oms/dd/split` + `{"source_order_id":N, "dd_groups":[...]}` → 拆单成功
- [ ] `POST /webhook/wms/oms/sync` → 触发 SAP 同步，返回 `{"success":true,"count":N}`
- [ ] `GET /wms/oms.html` → 200 OK，页面正常加载
- [ ] n8n 编辑器中每个 OMS 工作流只有**一个**副本
- [ ] SAP MSSQL 节点**不包含** `{{ $json.sql }}` (安全审计)
- [ ] 拆单后 DD 子单在订单行查询中正确显示 (去重，非重复)

---

## 教训 16: SAP OWOR 表与 ORDR/OPOR 结构差异

**问题**: OWOR (生产订单) 与 ORDR/OPOR (销售/采购订单) 的表结构差异较大，直接复用会报 "Invalid column name"。

**OWOR 不存在的列**:
| 列名 | ORDR/OPOR 含义 | OWOR 替代方案 |
|------|---------------|--------------|
| `CANCELED` | 取消标志 Y/N | `CASE WHEN T0.Status = 'C' THEN 'Y' ELSE 'N' END` |
| `CardCode` | 客商编码 | 生产订单无客商，用 `''` 占位 |
| `CardName` | 客商名称 | 同上 `''` |

**OWOR 特有列**:
| 列名 | 含义 | 用途 |
|------|------|------|
| `ItemCode` | BOM 成品物料号 | 填入 `oms.orders.item_code` |
| `ProdName` | 成品名称 | 填入 `oms.orders.item_name` |
| `PlannedQty` | 计划生产数 | 填入 `oms.orders.planned_qty` |
| `CmpltQty` | 已完工数 | 填入 `oms.orders.actual_qty` |
| `Warehouse` | 收货仓库 | 填入 `oms.orders.warehouse_code` |

**OWOR.Status 状态码** (与 ORDR/OPOR 不同):
| 状态 | 含义 |
|------|------|
| `P` | Planned 已计划 |
| `R` | Released 已释放 |
| `L` | Closed 已关闭 |
| `C` | Cancelled 已取消 |

**预防 SOP**: UNION ALL 拼接不同 SAP 表时，必须逐列验证列名是否存在，用 ISNULL/CASE/常量占位缺失列。

---

## 教训 17: WOR1.ItemType 过滤 — 只取物料行

**问题**: WOR1 (生产订单行) 包含多种行类型，不仅是物料。未过滤导致 OMS 中出现 OH001 (Overhead 製造費用) 等非物料行。

**WOR1.ItemType 值**:
| ItemType | 含义 | 是否需要 |
|----------|------|---------|
| 4 | 物料 (Material) | ✅ 需要 |
| 其他 | 资源/人工/开销 | ❌ 不需要 |

**修复**: SAP 查询 WOR1 时必须加 `AND T1.ItemType = 4`。

**影响范围**: wf20 SAP 同步 + 前端打印/显示 — 非物料行不应出现在任何地方。

---

## 教训 18: WMS 与 OMS 表列名混淆 (跨 Schema 同名不同列)

**问题**: `wms.wms_document_lines` 和 `oms.order_lines` 对相同业务概念使用不同列名。wf1c Prefill 节点 INSERT 到 WMS 表时误用了 OMS 列名。

**列名映射 (同一业务概念)**:
| 业务含义 | `wms.wms_document_lines` | `oms.order_lines` |
|---------|--------------------------|-------------------|
| 计划数量 | `planned_qty` | `quantity` |
| 实际数量 | `actual_qty` | `wms_actual_qty` |
| 未交数量 | *(无)* | `open_quantity` |

**错误**: wf1c Prepare Prefill 用了 `quantity` / `wms_actual_qty` INSERT 到 `wms.wms_document_lines`，该表实际列名是 `planned_qty` / `actual_qty`。

**根因**: OMS Schema 设计时 (P1) 列名风格偏 SAP (`quantity`)，WMS Schema 设计更早列名偏描述性 (`planned_qty`)。

**预防 SOP**: 写跨 Schema 的 INSERT/UPDATE 前，先确认目标表的精确列名:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='wms' AND table_name='wms_document_lines' ORDER BY ordinal_position;
```

---

## 教训 19: n8n 工作流部署 — API PATCH vs 全量导入

**问题**: 通过 n8n CLI `import:workflow` 导入会覆盖凭据引用。API 方式更安全。

**推荐部署方式 (本项目已验证)**:
```python
# 1. GET 线上工作流 (保留凭据)
live = api('GET', f'/workflows/{wf_id}')
# 2. 仅替换目标节点的 jsCode / query
for node in live['nodes']:
    if node['name'] == '目标节点':
        node['parameters']['jsCode'] = new_code
# 3. PUT 回去 (只传允许的字段)
allowed = {'name', 'nodes', 'connections', 'settings', 'staticData'}
put_body = {k: v for k, v in live.items() if k in allowed}
api('POST', f'/workflows/{wf_id}/deactivate')
api('PUT', f'/workflows/{wf_id}', put_body)
api('POST', f'/workflows/{wf_id}/activate')
```

**优势**: 凭据引用保留不变，只修改逻辑代码。

---

## 教训 20: 大量 SAP 数据同步超时

**问题**: 强制回退 `last_sync_date` 到 2024-06-01 触发全量 WO 同步，导致 n8n 处理数万条记录，webhook 返回超时 (Remote end closed connection)。

**后果**:
1. 同步 webhook 超时但 n8n **后台仍在执行** — 数据最终同步成功
2. 恢复脚本也超时导致 wf20 留在异常状态 (硬编码日期)

**预防策略**:
- 大量数据同步改用分批处理 (如按月窗口)
- 恢复脚本先等待同步完成再操作 (增加 retry/sleep)
- 验证方式: `SELECT COUNT(*) FROM oms.order_lines ...` 确认数据是否已落库

---

## 教训 21: WO 打印布局 — 抬头卡片 + 合并明细

**问题**: WO 打印订单经历了多次迭代才确定最终格式。

**最终需求** (用户验收后):
1. **WO 抬头**: 卡片式网格 (每行 6 个)，类似条码打印格式
   - 每张卡片: QR码 (1.5cm, 内容=WO号) + 工单号 + 物料号 + 仓库+计划数
2. **分隔线**: 粗横线隔开抬头和明细
3. **BOM 明细**: 所有 WO 的行按 `(item_code, warehouse_code)` 合并
   - 相同物料 → 一行，数量汇总
   - QR 码 1.5cm
   - **不要**额外汇总表
4. **条码打印 (printBarcodes)**: 所有类型统一简单 QR 去重网格，WO **无特殊处理**

**关键决策**:
- 线性条形码冗余 → 只用 QR 码
- 抬头 QR ≥ 1.5cm (手机可扫)
- printBarcodes ≠ printOrders，职责分离

---

## 教训 22: ⚠️ 首次同步 OOM — COALESCE 默认日期过早

**问题**: wf20 首次执行时报 "n8n may have run out of memory"。

**根因追踪**:
```
PG 节点: COALESCE(MAX(sap_update_date), '2000-01-01')
  ↓ OMS 表空，返回 '2000-01-01' (truthy 字符串)
Code 节点: lastSync = '2000-01-01' || params.date_from → 短路返回 '2000-01-01'
  ↓
SAP 查询: WHERE UpdateDate >= '2000-01-01' → 全量 SO+PO+WO UNION ALL
  ↓
返回数万行 × 20+ 列 → n8n Node.js 默认堆 1.5GB 溢出
```

**关键陷阱**: `||` (JS OR) 对非空字符串 `'2000-01-01'` 短路，Code 节点的 fallback 永远不生效。修复 Code 节点不够，必须修复 SQL COALESCE 的默认值。

**修复 (两处)**:
1. PG SQL: `COALESCE(MAX(...), '2000-01-01')` → `COALESCE(MAX(...), TO_CHAR(CURRENT_DATE - INTERVAL '90 days', 'YYYY-MM-DD'))`
2. docker-compose.yml: 新增 `NODE_OPTIONS: "--max-old-space-size=4096"` (堆 1.5G → 4G 安全网)

**预防 SOP**:
- 任何首次同步 (空表) 的 COALESCE 默认值，必须限制为合理时间窗口 (如 90 天)
- **禁止** `'2000-01-01'` / `'1900-01-01'` 作为默认同步起始日期
- n8n 处理 SAP 数据的容器建议 `NODE_OPTIONS=--max-old-space-size=4096`

---

## 教训 23: SQL 行为测试必须与实际 DDL 列名同步

**问题**: `07_oms_schema_behavior_test.sql` 拉取后执行 13/15 测试失败。

**三类不匹配**:
| # | 测试中的列名/写法 | DDL 实际 | 修复 |
|---|------------------|---------|------|
| 1 | INSERT 缺少 `doc_number` | `NOT NULL` 无 DEFAULT | 所有 INSERT 补充 `doc_number` |
| 2 | `audit_logs(table_name, record_id, performed_by)` | `(target_type, target_id, operator)` | 替换列名 |
| 3 | `pg_sleep(0.01)` + 比较 `NOW()` 前后差 | PG `NOW()` 在事务内固定 | 改为验证触发器绑定存在性 |

**根因**: 测试脚本与 DDL 在不同分支/时间线开发，列名发生漂移后未同步。

**预防 SOP**:
1. DDL 变更后**必须**立即运行 SQL 行为测试验证
2. CI 中 `pg-schema-test` Job 应在建表后自动执行行为测试
3. 测试中依赖事务内时间差的断言 (`NOW()` 比较) 改为结构性验证 (触发器存在性检查)

---

## 教训 24: 跨环境 OMS 增量部署 SOP (已有运行环境)

**场景**: 从 Git 拉取 OMS 更新到已运行的 DP 环境 (非全新初始化)

**完整步骤 (实战验证)**:
```bash
# === 1. 数据库 DDL (手动, init 脚本只在首次生效) ===
docker exec -i dp-db psql -U $USER -d $DB < infrastructure/postgres/init/05_oms_tables.sql

# WMS doc_type 扩展 DD
docker exec dp-db psql -U $USER -d $DB -c "
  ALTER TABLE wms.wms_documents DROP CONSTRAINT wms_documents_doc_type_check;
  ALTER TABLE wms.wms_documents ADD CONSTRAINT wms_documents_doc_type_check
    CHECK (doc_type IN ('SO','WO','PO','TR','IC','LM','PI','DD'));"

# 验证
docker exec -i dp-db psql -U $USER -d $DB < tests/sql/07_oms_schema_behavior_test.sql

# === 2. 前端容器重建 (新增 oms.html, vue/pinia vendor) ===
docker compose build dp-wms-web dp-wms-test
docker compose up -d dp-wms-web
docker compose --profile test up -d dp-wms-test  # 如有测试环境

# === 3. n8n 工作流导入 (不删除现有流程!) ===
# a. Python 替换占位符 (按凭据类型精确匹配, 非全局替换)
# b. 注入 id: 新工作流用 hashlib, wf1c 用已有 DB id
# c. docker cp → n8n import:workflow --input=单文件 (逐个)
# d. UPDATE activeVersionId = versionId + active = true
# e. docker restart dp-wf (三表同步后必须重启)

# === 4. 验证 ===
# - 总工作流数只增不减
# - 现有 wf02-wf1e 全部 active
# - webhook_entity 数量合理
# - 无重复工作流: SELECT name, COUNT(*) ... HAVING COUNT(*) > 1
```

**关键安全点**:
- ⚠️ 占位符替换必须按凭据类型 (postgres/microsoftSql) 区分，通用 `__CREDENTIAL_ID__` 不能统一替换
- ⚠️ 替换后的 JSON **不提交 Git** — 操作完成后 `git checkout -- apps/wf/` 恢复占位符版本
- ⚠️ wf1c 是更新而非新建 — id 必须使用 DB 中已有 id，否则产生重复

## 教训 25: 通过 DB 脚本更新 n8n 工作流时必须更新 activeVersionId

**问题**: Python 修复脚本 (fix_wf21_print.py, fix_dd_warehouse_v3.py) 只更新了 `workflow_entity.nodes` + `versionId`，但没有更新 `activeVersionId`。导致 n8n 重启后仍然运行旧版本的工作流。

**根因**: n8n 2.x 的 webhook 执行引擎读取 `activeVersionId` 指向的 `workflow_history.nodes`，不读 `workflow_entity.nodes`。`versionId` 和 `activeVersionId` 不一致 = 改动无效。

**影响**: wf21 的 `source_planned_qty` 字段和 `warehouse_code COALESCE fallback` 修改都没有生效，用户看到打印原单数为空、仓库为空。

**预防 SOP**:
1. 每次通过 DB 修改工作流，必须同步更新 **四个字段**: `nodes`, `versionId`, `activeVersionId`, `connections`
2. 先 INSERT `workflow_history` (FK 约束要求)，再 UPDATE `workflow_entity`
3. 修改完成后立即验证:
   ```sql
   SELECT name, "versionId" = "activeVersionId" AS synced
   FROM wf.workflow_entity WHERE name LIKE '%目标%';
   ```
4. 参考 `.claude/skills/n8n-database-operations.md` §工作流节点注入 (正确模式)

**快速修复模板**:
```sql
-- 同步 history 到最新 entity 数据
UPDATE wf.workflow_history SET nodes = e.nodes, connections = e.connections
FROM wf.workflow_entity e
WHERE wf.workflow_history."versionId" = e."versionId" AND e.name LIKE '%目标%';
-- 对齐 activeVersionId
UPDATE wf.workflow_entity SET "activeVersionId" = "versionId" WHERE name LIKE '%目标%';
-- docker restart dp-wf
```

## 教训 26: wf22 执行拆单节点必须有 onError 错误处理

**问题**: `执行拆单` Postgres 节点没有 `onError` 配置。当 SQL 执行失败 (如 CHECK 约束违反) 时，webhook 以 `responseMode: "responseNode"` 等待 Respond 节点，但执行中断后永远到不了 → 前端超时 (卡) + 无错误提示。

**修复**: 添加 `onError: "continueErrorOutput"` + `DB错误响应` respondToWebhook 节点，错误输出路径立即返回 JSON 错误信息。

**预防**: 所有 `responseMode: "responseNode"` 的 webhook 工作流中，数据库操作节点必须有 `onError` 错误处理，确保任何路径都能到达 Respond 节点。

---

## 教训 27: OMS 同步每次返回相同数量 — DATE 粒度不够

**问题**: 用户每次手动同步 OMS 订单，返回数量始终为 477，即使无新数据。

**根因**: "获取上次同步时间" 只返回 `MAX(sap_update_date)` (DATE 精度)，SAP 查询 `WHERE UpdateDate >= 'YYYY-MM-DD'` 总是拉取最后一天所有订单。UPSERT 通过 `sap_data_hash IS DISTINCT FROM` 保证数据正确，但 SAP 查询浪费且用户看到的 count 误导。

**修复 (3 个节点)**:
1. **获取上次同步时间**: 增加 `last_sync_time` 返回 (从 `sap_update_time` 列)
2. **构建SAP查询**: `HH:MM:SS` → SAP 整数格式 `HHMMSS` (如 `153045`)
3. **SAP订单查询**: 3 个 UNION ALL 的 WHERE 改为:
   ```sql
   WHERE (T0.UpdateDate > 'last_date'
     OR (T0.UpdateDate = 'last_date' AND T0.UpdateTS > last_ts_int))
   ```

**关键**: SAP `UpdateTS` 是整数 (如 `153045` = 15:30:45)，OMS 存为 TIME 类型。同步比较时需要转换回整数。

---

## 教训 25: ⚠️ OMS 分批同步架构 (v0.7 重构)

**问题**: wf20 原设计一次查询 SO+PO+WO+TR 四种单据 90 天 UNION ALL，worker 内存飙到 2.7GB 打死 Redis + n8n 主进程 + 数据库。

**重构架构 (8 个工作流)**:
```
wf20    — Cron 夜间启动器 (21:00 SO / 21:15 PO / 21:30 WO / 21:45 TR)
wf20-so — SO 手动同步启动器
wf20-po — PO 手动同步启动器
wf20-wo — WO 手动同步启动器
wf20-tr — TR 手动同步启动器
wf20a   — 批次执行器 (事件驱动 + 120 秒兜底)
wf20b   — 进度查询 (前端轮询)
wf20c   — 停止同步 (用户手动停止)
```

**关键设计决策**:
- `oms.sync_progress` 表跟踪进度 (company_code + doc_type + month_start)
- 每个批次 = 1 种单据 × 1 个月，内存可控
- 事件驱动: 完成一批后 HTTP 自调用触发下一批 + 120 秒 Schedule 兜底
- `FOR UPDATE SKIP LOCKED` 原子领取，防多 worker 抢同一任务
- 超时回收: running > 10 分钟自动重置为 pending
- `DP_OMS_SYNC_START_DATE` ENV 控制历史追溯起点 (默认 20240101)

---

## 教训 26: ⚠️ FOR UPDATE SKIP LOCKED 防并发抢单

**问题**: n8n queue 模式下多个 worker 并发执行 Schedule Trigger，普通 SELECT + UPDATE 会多个 worker 抢同一条任务。

**正确做法**:
```sql
UPDATE oms.sync_progress
SET status='running', started_at=NOW()
WHERE id = (
    SELECT id FROM oms.sync_progress
    WHERE status='pending' AND company_code=current_setting('app.company_code')
    ORDER BY doc_type, month_start
    FOR UPDATE SKIP LOCKED LIMIT 1
) RETURNING *;
```

**配套**: 超时回收机制防止 worker 崩溃导致任务永久 running:
```sql
UPDATE oms.sync_progress SET status='pending', started_at=NULL
WHERE status='running' AND started_at < NOW() - INTERVAL '10 minutes';
```

---

## 教训 27: ⚠️ 前端异步状态设置被覆盖 (时序竞争)

**问题**: 同步完成后调用 `async applyOmsBtnStates()` 设 `data-sync-disabled` 灰显按钮，但其他同步代码（`resetOmsButtons`、`applyI18n`）在异步返回前已执行，覆盖了状态。

**根因**: 异步函数（发 API 请求）和同步函数（DOM 操作）混用导致时序不确定。

**修复**: 轮询已经拿到完整 `status.progress` 数据，**同步传给** `setOmsBtnStatesDirect(progress)` 设按钮状态，不再发额外异步请求。

**另一个陷阱**: `.force-enabled` class 的 `opacity: 1 !important` 会覆盖 `button[data-sync-disabled]` 的 `opacity: 0.5`。设灰显时必须同时清掉 `force-enabled`:
```javascript
btn.dataset.syncDisabled = '1';
delete btn.dataset.forceEnabled;
btn.classList.remove('force-enabled');
```

---

## 教训 28: ⚠️ Docker 管道 UTF-8 编码损坏

**问题**: Windows Python → docker cp → container 管道中，中文 UTF-8 被 GBK 截断。7 个工作流名称和代码注释全部乱码。

**正确做法**:
1. `docker cp` 源 JSON 文件到容器 `/home/node/` (保留原始字节)
2. 容器内 `node -e` 读文件 + 凭据替换 + API 调用 (全程 UTF-8)
3. **禁止**用 Windows Python 写临时文件再 docker cp

**参考**: `.claude/skills/wsl-file-operations.md` §3 — docker exec 路径 `/tmp/` 会被 Windows 映射为 `C:/Users/.../Temp/`

---

## 教训 29: SAP 表名必须验证

**问题**: 用户提供的 TR 调拨单表名 `OTWQ/TWQ1` 是错的，实际是 `OWTQ/WTQ1`。部署后 SAP 报 `Invalid object name 'OTWQ'`。

**预防 SOP**:
1. 新增 SAP 表查询前，先在 MSSQL 中验证: `SELECT TOP 1 * FROM OWTQ`
2. SAP B1 库存转储表名速查:
   - `OWTQ/WTQ1` — 库存转储请求 (Inventory Transfer Request)
   - `OWTR/WTR1` — 库存转储 (Inventory Transfer)
3. 4 个 SAP 查询节点使用**硬编码 SQL** + Switch/IF 路由，禁止 Code 节点拼 SQL

---

## 教训 30: 多选 checkbox 下拉 i18n 模式

**问题**: 自定义多选下拉框的 summary 文字在语言切换后不更新。`t()` 函数在初始化时调用，之后 `applyI18n()` 更新了 checkbox 旁的 span 文字，但 summary 仍是旧语言。

**正确模式**:
1. `applyI18n()` 末尾派发 `document.dispatchEvent(new Event('i18nUpdated'))`
2. 页面监听 `i18nUpdated` 事件，重新从 checkbox 旁 span 的 `textContent` 读已翻译文字
3. summary 不用 `t()` 函数，而是直接读 DOM 中已翻译的文字

```javascript
// lang.js applyI18n() 末尾
try { document.dispatchEvent(new Event('i18nUpdated')); } catch(e) {}

// oms.js 监听
document.addEventListener('i18nUpdated', function() {
    updateSapSummary();  // 从 .sap-chk:checked 的 sibling span 读文字
});

function updateSapSummary() {
    var labels = [];
    document.querySelectorAll('.sap-chk:checked').forEach(function(cb) {
        var span = cb.parentElement.querySelector('span');
        labels.push(span ? span.textContent : cb.value);
    });
    document.getElementById('sapStatusSummary').textContent = labels.join(', ');
}
```

**另一个陷阱**: `<select>` 的 `<option>` 带 `data-i18n` 可以被 `applyI18n` 更新 `textContent`，但自定义 div 下拉需要手动处理。

---

## 教训 31: 启动器停止后必须触发执行器

**问题**: 用户手动停止同步后（wf20c 将 running/pending → failed），重新点击同步时，启动器重置 failed → pending，但检测到 pending 任务后走"已在队列"分支 — 该分支**不触发** wf20a 执行器，导致 pending 任务无人处理。

**修复**: 两个分支都必须连接到"触发批次执行器"节点。

**预防 SOP**: 工作流中有 IF 分支时，必须检查所有分支的下游节点是否完整。特别是"短路"分支（如 already queued）容易遗漏后续动作。

---

## 教训 32: ⚠️ ON CONFLICT DO NOTHING → DO UPDATE (允许重跑)

**问题**: 4 个启动器 (wf20-so/po/wo/tr) 向 `sync_progress` 插入月度任务时使用 `ON CONFLICT DO NOTHING`。当任务已存在且状态为 `completed/failed` 时，INSERT 被跳过，任务无法被重置为 `pending` — 手动停止后无法重新触发。

**根因**: `DO NOTHING` = 完全忽略冲突行。用户点"重新同步"时，已有月份不会被重置。

**修复**: 改为 `ON CONFLICT (...) DO UPDATE SET status='pending', started_at=NULL, error_message=NULL WHERE sync_progress.status IN ('completed','failed')`。

**关键约束**: `WHERE status IN ('completed','failed')` — 不重置 `running` 状态的任务，避免中断正在执行的批次。

---

## 教训 33: ⚠️ 内部 URL 不走 Cloudflare 隧道

**问题**: wf20a 批次执行链通过 `WEBHOOK_URL` (外部 URL) 自调用触发下一批。当 Cloudflare 隧道不稳定或有延迟时，链条中断。

**根因**: `WEBHOOK_URL` 环境变量指向外部域名 (如 `https://wf.example.com`)，数据包经 Cloudflare → 公网 → 再回容器网络，徒增延迟和故障点。

**修复**: 所有 n8n 工作流之间的自调用/链式调用，**硬编码内部 URL** `http://dp-wf:5678/webhook/...`，不使用 `$env.WEBHOOK_URL`。

**规则**:
```
✅ 内部自调用: http://dp-wf:5678/webhook/wms/oms/sync/next
❌ 内部自调用: {{ $env.WEBHOOK_URL }}/webhook/wms/oms/sync/next
✅ 外部入口: WEBHOOK_URL → 浏览器/PDA 访问的地址
```

**影响范围**: wf20-so/po/wo/tr (4 个启动器) + wf20a (批次执行器) + wf20 (夜间 cron) = 6 个工作流。

---

## 教训 34: wf20c 停止应标记 failed 而非 completed

**问题**: wf20c 手动停止时将 `running/pending` 任务标记为 `completed`。但 4 个启动器只重置 `failed` → `pending`，不重置 `completed`。导致停止后再触发同步，被停止的月份被视为"已完成"，永远跳过。

**修复**: wf20c 停止队列节点 `SET status='failed'`（而非 `'completed'`），使启动器的 `failed→pending` 重置逻辑能正确捕获手动停止的月份。

**语义**:
- `completed` = 正常跑完，数据已同步到位，不需要重跑
- `failed` = 异常中断（含手动停止），需要重新运行

---

## 教训 35: WMS-SAP 解耦迁移 (v0.8)

**背景**: WMS 扫单时实时查询 SAP B1 (MSSQL)，造成强耦合。OMS 增量同步 (wf20a) 已将 SO/PO/WO/TR 拉取到 PG，具备切换条件。

**改造要点**:
1. **wf1a~1e** 全部从 MSSQL 切到 PG `oms.orders` + `oms.order_lines`，查询带 `sync_status = 'complete'`
2. **领空保护**: `oms.fn_protect_wms_fields()` 触发器 — SAP 同步时自动还原 WMS 字段 (wms_actual_qty/picked_qty/status)
3. **防旧覆盖**: wf20a UPSERT 用 `(EXCLUDED.sap_update_date, sap_update_time) >= (old)` 复合比较
4. **sync_status 闭环**: pending→syncing→complete|error，wf1x 只查 complete
5. **软降级**: PG 查不到 → `error_type: 'sync_pending'`，前端 `loadOrderWithRetry()` 指数退避重试

**DDL**: `infrastructure/postgres/init/17_wms_decouple_sap.sql`
**测试**: `tests/sql/17_wms_decouple_sap_test.sql`

**部署顺序**:
1. 执行 DDL (17_wms_decouple_sap.sql)
2. 更新 wf06 (物料缓存扩充) + wf20a (防旧覆盖+sync_status)
3. 运行一次全量同步，等 sync_status 全部 complete
4. 更新 wf1a~1e + wf05 (切到 PG)
5. 更新 WMS 前端 (shared.js/lang.js/ic.js/lm.js + HTML cache version)
6. 验证: 扫单正常、领空不被覆盖、软降级提示正确
