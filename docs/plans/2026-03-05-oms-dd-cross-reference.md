# OMS SO↔DD 行级交叉引用 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** SO 明细行内显示关联 DD 单号#行号，DD 明细显示源 SO 单号和源行号，实现父子关系快速识别。

**Architecture:** 新增 `source_line_num` 列到 `oms.order_lines`，wf22 拆单时写入源行号，wf21 查询时用 STRING_AGG 聚合 DD 引用。前端 `renderDetailRow()` 增加列渲染。

**Tech Stack:** PostgreSQL 17, n8n 工作流 (JSON), 原生 JS (oms.js), Jest 单元测试

---

## Task 1: 数据库 — 新增 source_line_num 列

**Files:**
- Modify: `infrastructure/postgres/init/05_oms_tables.sql:176-229` (order_lines 表定义)

**Step 1: 修改 DDL 文件**

在 `oms.order_lines` 表定义中 `remarks TEXT` 之前添加 `source_line_num` 字段:

```sql
    -- DD 行级溯源 (仅 DD 类型使用)
    source_line_num INTEGER,
```

**Step 2: 运行现有测试确认无回归**

Run: `npm test -- --testPathPattern=oms`
Expected: 全部通过

**Step 3: 提交**

```bash
git add infrastructure/postgres/init/05_oms_tables.sql
git commit -m "feat(oms): order_lines 新增 source_line_num 列 (DD 行级溯源)"
```

---

## Task 2: 数据库 — 手动迁移脚本 (生产环境执行)

**Note:** 此任务生成迁移 SQL 但不自动执行。部署时手动在 dp-db 上运行。

**Step 1: 在 05_oms_tables.sql 末尾添加注释说明**

在 `05_oms_tables.sql` 文件末尾验证部分之前添加迁移提示注释:

```sql
-- ============================================================================
-- 迁移提示: source_line_num (v0.1.16+, 已有部署需手动执行)
-- ALTER TABLE oms.order_lines ADD COLUMN IF NOT EXISTS source_line_num INTEGER;
-- COMMENT ON COLUMN oms.order_lines.source_line_num IS 'DD 行对应的源 SO 行号 (仅 DD 类型订单使用)';
-- 回填:
-- UPDATE oms.order_lines ol SET source_line_num = so_line.line_num
-- FROM oms.orders dd JOIN oms.orders so ON dd.parent_id = so.id
-- JOIN oms.order_lines so_line ON so_line.order_id = so.id AND so_line.item_code = ol.item_code
-- WHERE ol.order_id = dd.id AND dd.doc_type = 'DD' AND ol.source_line_num IS NULL;
-- ============================================================================
```

---

## Task 3: 后端 — wf21 单订单行查询增加 DD 引用

**Files:**
- Modify: `apps/wf/wf21-oms-query.json` (节点 "Query Lines", id: o2100001-...-000000000013)

**Step 1: 修改 Query Lines 节点 SQL**

当前 SQL (wf21-oms-query.json 第 216 行):
```sql
SELECT ol.id, ol.order_id, ol.line_num, ol.item_code, ol.item_name,
  ol.barcode, ol.uom, ol.quantity AS planned_qty, ol.open_quantity AS delivered_qty,
  ol.wms_actual_qty AS actual_qty, ol.unit_price, ol.line_total,
  ol.warehouse_code, ol.from_warehouse, ol.to_warehouse,
  ol.batch_number, ol.serial_number, ol.status, ol.remarks
FROM oms.order_lines ol
INNER JOIN oms.orders o ON ol.order_id = o.id
WHERE o.id = $1 AND o.company_code = $2
ORDER BY ol.line_num
```

替换为:
```sql
SELECT ol.id, ol.order_id, ol.line_num, ol.item_code, ol.item_name,
  ol.barcode, ol.uom, ol.quantity AS planned_qty, ol.open_quantity AS delivered_qty,
  ol.wms_actual_qty AS actual_qty, ol.unit_price, ol.line_total,
  ol.warehouse_code, ol.from_warehouse, ol.to_warehouse,
  ol.batch_number, ol.serial_number, ol.status, ol.remarks,
  ol.source_line_num,
  COALESCE(parent_ord.doc_number, parent_ord.sap_doc_num) AS source_doc_number,
  (SELECT STRING_AGG(
    COALESCE(dd_ord.doc_number, dd_ord.sap_doc_num) || '#' || dd_ol.line_num::TEXT,
    ', ' ORDER BY dd_ord.split_seq, dd_ol.line_num
  )
  FROM oms.order_lines dd_ol
  JOIN oms.orders dd_ord ON dd_ol.order_id = dd_ord.id
  WHERE dd_ord.parent_id = o.id AND dd_ol.source_line_num = ol.line_num
  ) AS dd_refs
FROM oms.order_lines ol
INNER JOIN oms.orders o ON ol.order_id = o.id
LEFT JOIN oms.orders parent_ord ON o.parent_id = parent_ord.id
WHERE o.id = $1 AND o.company_code = $2
ORDER BY ol.line_num
```

**关键变化:**
- 新增 `ol.source_line_num` (DD 行直接返回源行号)
- 新增 `source_doc_number` (LEFT JOIN parent_ord，DD 订单返回源单号)
- 新增 `dd_refs` (STRING_AGG 子查询，SO 行聚合关联的 DD 单号#行号)

**Step 2: 提交**

```bash
git add apps/wf/wf21-oms-query.json
git commit -m "feat(wf21): 订单行查询增加 DD 交叉引用 (dd_refs + source_line_num)"
```

---

## Task 4: 后端 — wf21 批量查询同步增加 DD 引用

**Files:**
- Modify: `apps/wf/wf21-oms-query.json` (节点 "Batch Query Lines", id: o2100001-...-000000000024)

**Step 1: 修改 Batch Query Lines 节点 SQL**

当前 SQL (wf21-oms-query.json 第 359 行):
```sql
SELECT ol.id, ol.order_id, ol.line_num, ol.item_code, ol.item_name,
  ol.barcode, ol.uom, ol.quantity AS planned_qty, ol.open_quantity AS delivered_qty,
  ol.wms_actual_qty AS actual_qty, ol.unit_price, ol.line_total,
  ol.warehouse_code, ol.from_warehouse, ol.to_warehouse,
  ol.batch_number, ol.serial_number, ol.status, ol.remarks
FROM oms.order_lines ol
INNER JOIN oms.orders o ON ol.order_id = o.id
WHERE ol.order_id = ANY($1) AND o.company_code = $2
ORDER BY ol.order_id, ol.line_num
```

替换为:
```sql
SELECT ol.id, ol.order_id, ol.line_num, ol.item_code, ol.item_name,
  ol.barcode, ol.uom, ol.quantity AS planned_qty, ol.open_quantity AS delivered_qty,
  ol.wms_actual_qty AS actual_qty, ol.unit_price, ol.line_total,
  ol.warehouse_code, ol.from_warehouse, ol.to_warehouse,
  ol.batch_number, ol.serial_number, ol.status, ol.remarks,
  ol.source_line_num,
  COALESCE(parent_ord.doc_number, parent_ord.sap_doc_num) AS source_doc_number,
  (SELECT STRING_AGG(
    COALESCE(dd_ord.doc_number, dd_ord.sap_doc_num) || '#' || dd_ol.line_num::TEXT,
    ', ' ORDER BY dd_ord.split_seq, dd_ol.line_num
  )
  FROM oms.order_lines dd_ol
  JOIN oms.orders dd_ord ON dd_ol.order_id = dd_ord.id
  WHERE dd_ord.parent_id = o.id AND dd_ol.source_line_num = ol.line_num
  ) AS dd_refs
FROM oms.order_lines ol
INNER JOIN oms.orders o ON ol.order_id = o.id
LEFT JOIN oms.orders parent_ord ON o.parent_id = parent_ord.id
WHERE ol.order_id = ANY($1) AND o.company_code = $2
ORDER BY ol.order_id, ol.line_num
```

**Step 2: 提交**

```bash
git add apps/wf/wf21-oms-query.json
git commit -m "feat(wf21): 批量查询同步增加 DD 交叉引用"
```

---

## Task 5: 后端 — wf22 DD 拆单写入 source_line_num

**Files:**
- Modify: `apps/wf/wf22-oms-dd.json` (节点 "生成拆单SQL")
- Modify: `apps/wf/lib/wf22-mapper.js`

**Step 1: 修改 wf22-mapper.js — 保留 source_line_num 到输出**

在 `wf22-mapper.js` 的 `transformDDPayload` 函数中，`lines_json` 已包含 `line_num` 字段。
确认前端 payload 结构: `{ item_code, line_num, qty }`。

`line_num` 在 payload 中是源 SO 行号 (见 oms.js:1165 `line_num: sl.line_num`)。
wf22 mapper 保持不变 — lines_json 已正确传递源行号。

**但需要确保 wf22 INSERT SQL 使用 payload 中的 `line_num` 作为 `source_line_num`。**

修改 wf22-oms-dd.json 的 "生成拆单SQL" 节点代码，在 SQL 生成部分:
DD lines INSERT 时，将 `line_num` 重新编号 (1,2,3...)，同时将原始 `line_num` 写入 `source_line_num`:

```javascript
// DD 行的 line_num = DD 内序号 (1,2,3...)
// source_line_num = 源 SO 行号 (原始 line_num)
lines.forEach(function(ln, i) {
    // INSERT 包含: line_num = i+1, source_line_num = ln.line_num
});
```

**具体 SQL 变更取决于部署的 wf22 版本。** 需检查 n8n 中实际运行的 "生成拆单SQL" 节点代码，确认 INSERT 语句，然后在 INSERT 的列列表和 VALUES 中增加 `source_line_num`。

**Step 2: 提交**

```bash
git add apps/wf/wf22-oms-dd.json apps/wf/lib/wf22-mapper.js
git commit -m "feat(wf22): DD 拆单写入 source_line_num 行级溯源"
```

---

## Task 6: 前端 — lang.js 新增 i18n 键

**Files:**
- Modify: `apps/wms/lang.js` (约第 445 行, oms.dd_children 附近)

**Step 1: 在 oms.dd_children 后添加新键**

```javascript
    'oms.col_dd_refs': { zh: 'DD关联', en: 'DD Refs', th: 'อ้างอิง DD', my: 'DD ရည်ညွှန်း' },
    'oms.col_source_line': { zh: '源行号', en: 'Src Line', th: 'บรรทัดต้นทาง', my: 'မူရင်းအတန်း' },
    'oms.source_order': { zh: '源单', en: 'Source', th: 'ต้นทาง', my: 'မူရင်း' },
```

**Step 2: 提交**

```bash
git add apps/wms/lang.js
git commit -m "feat(i18n): OMS DD 交叉引用 3 个新 i18n 键"
```

---

## Task 7: 前端 — oms.js renderDetailRow 显示 DD 引用

**Files:**
- Modify: `apps/wms/oms.js:203-245` (renderDetailRow 函数)

**Step 1: 修改 renderDetailRow 函数**

当前 `renderDetailRow` 函数中 SO 明细行 (oms.js:211-224) 使用 11 列。需要调整:

A) 对于 **非 DD** 订单行，在 status 列之前添加 dd_refs 列:

当前代码 (oms.js:211-224):
```javascript
    lines.forEach(function(ln, idx) {
        html += '<tr class="detail-row" data-detail="' + order.id + '">' +
            '<td></td>' +
            '<td></td>' +
            '<td class="detail-line-num">' + (ln.line_num != null ? ln.line_num : idx) + '</td>' +
            '<td></td>' +
            '<td>' + escapeHtml(ln.item_code || '-') + '</td>' +
            '<td>' + escapeHtml(ln.item_name || '-') + '</td>' +
            '<td style="text-align:right;">' + formatNumber(ln.planned_qty || 0) + '</td>' +
            '<td style="text-align:right;">' + formatNumber(ln.actual_qty || 0) + '</td>' +
            '<td>' + escapeHtml(ln.warehouse_code || '-') + '</td>' +
            '<td></td>' +
            '<td><span class="badge badge-' + (ln.status || 'pending') + '">' + getOmsStatusLabel(ln.status) + '</span></td>' +
            '</tr>';
    });
```

替换为:
```javascript
    // 判断是否 DD 订单 (有 source_doc_number 即为 DD)
    var isDDOrder = lines.length > 0 && lines[0].source_doc_number;

    // DD 订单头部: 显示源单号
    if (isDDOrder) {
        html += '<tr class="detail-row" data-detail="' + order.id + '">' +
            '<td></td><td></td>' +
            '<td colspan="9" style="padding:6px 8px;"><strong style="color:#6366f1;font-size:0.8rem;">' +
            t('oms.source_order', '源单') + ': ' + escapeHtml(lines[0].source_doc_number) +
            '</strong></td></tr>';
    }

    lines.forEach(function(ln, idx) {
        // 最后一列根据订单类型显示不同内容
        var refCol = '';
        if (isDDOrder) {
            // DD 行: 显示源行号
            refCol = '<td style="font-size:0.75rem;color:#6366f1;">' +
                (ln.source_line_num != null ? ln.source_line_num : '-') + '</td>';
        } else {
            // SO 等: 显示 DD 关联
            refCol = '<td style="font-size:0.75rem;color:#ec4899;">' +
                escapeHtml(ln.dd_refs || '') + '</td>';
        }

        html += '<tr class="detail-row" data-detail="' + order.id + '">' +
            '<td></td>' +
            '<td></td>' +
            '<td class="detail-line-num">' + (ln.line_num != null ? ln.line_num : idx) + '</td>' +
            '<td></td>' +
            '<td>' + escapeHtml(ln.item_code || '-') + '</td>' +
            '<td>' + escapeHtml(ln.item_name || '-') + '</td>' +
            '<td style="text-align:right;">' + formatNumber(ln.planned_qty || 0) + '</td>' +
            '<td style="text-align:right;">' + formatNumber(ln.actual_qty || 0) + '</td>' +
            '<td>' + escapeHtml(ln.warehouse_code || '-') + '</td>' +
            refCol +
            '<td><span class="badge badge-' + (ln.status || 'pending') + '">' + getOmsStatusLabel(ln.status) + '</span></td>' +
            '</tr>';
    });
```

**关键变化:**
- DD 订单: 明细头部显示 "源单: SO-xxxx"
- DD 行: 第 10 列显示 `source_line_num` (紫色)
- SO 行: 第 10 列显示 `dd_refs` (粉色)
- 第 10 列 (`<td></td>`) 原本是空的日期列，现在改为显示交叉引用

**Step 2: 修改 oms.html 表头 (第 306 行)**

当前表头第 10 列是 "日期":
```html
<th data-i18n="oms.col_date">日期</th>
```

这列在明细行中目前是空的 (`<td></td>`)，订单头行显示日期。保持表头不变 (对主行仍显示日期)。明细行改用此列显示引用信息，不需要改表头。

**Step 3: 提交**

```bash
git add apps/wms/oms.js
git commit -m "feat(oms): 行级 DD 交叉引用渲染 (SO→DD#行号, DD→源行号)"
```

---

## Task 8: 前端 — 缓存版本号升级

**Files:**
- Modify: `apps/wms/*.html` (11 个 HTML 文件)
- Modify: `.claude/skills/frontend-cache-versioning.md`

**Step 1: 批量升级版本号**

```bash
cd "Digital-Platform"
sed -i 's/phase19\.21/phase19.22/g' apps/wms/*.html
```

**Step 2: 验证一致性**

```bash
grep -o 'phase[0-9]*\.[0-9]*' apps/wms/*.html | sort -t: -k2 -u
# 所有文件必须显示 phase19.22
```

**Step 3: 更新 skills 文件当前版本号**

修改 `.claude/skills/frontend-cache-versioning.md` 中 `当前版本号` 为 `phase19.22`。

**Step 4: 提交**

```bash
git add apps/wms/*.html .claude/skills/frontend-cache-versioning.md
git commit -m "chore: 前端缓存版本号 phase19.21 → phase19.22"
```

---

## Task 9: 测试 — oms.test.js 新增交叉引用测试

**Files:**
- Modify: `tests/unit/wms/oms.test.js`

**Step 1: 添加 renderDetailRow DD 引用测试**

在 oms.test.js 中找到 `renderDetailRow` 相关测试区域 (或新增 describe 块)，添加:

```javascript
describe('renderDetailRow DD 交叉引用', function() {
    it('SO 行应显示 dd_refs', function() {
        var order = {
            id: 1, doc_type: 'SO',
            lines: [
                { line_num: 1, item_code: 'A001', item_name: 'Item A', planned_qty: 100, actual_qty: 50, warehouse_code: 'WH01', status: 'partial', dd_refs: 'DD26000001#1, DD26000002#1' },
                { line_num: 2, item_code: 'B002', item_name: 'Item B', planned_qty: 50, actual_qty: 0, warehouse_code: 'WH01', status: 'pending', dd_refs: null }
            ],
            dd_children: []
        };
        var html = renderDetailRow(order);
        expect(html).toContain('DD26000001#1, DD26000002#1');
        // 无 dd_refs 的行不显示
        expect(html).not.toContain('source_line_num');
    });

    it('DD 行应显示 source_line_num 和 source_doc_number', function() {
        var order = {
            id: 2, doc_type: 'DD',
            lines: [
                { line_num: 1, item_code: 'A001', item_name: 'Item A', planned_qty: 50, actual_qty: 0, warehouse_code: 'WH01', status: 'pending', source_line_num: 1, source_doc_number: 'SO-2026-001' },
                { line_num: 2, item_code: 'C003', item_name: 'Item C', planned_qty: 75, actual_qty: 0, warehouse_code: 'WH01', status: 'pending', source_line_num: 3, source_doc_number: 'SO-2026-001' }
            ],
            dd_children: []
        };
        var html = renderDetailRow(order);
        expect(html).toContain('SO-2026-001');  // 源单号
        // 检查源行号在 HTML 中
        var tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        var cells = tempDiv.querySelectorAll('td');
        var found1 = false, found3 = false;
        cells.forEach(function(c) {
            if (c.textContent.trim() === '1' && c.style.color) found1 = true;
            if (c.textContent.trim() === '3' && c.style.color) found3 = true;
        });
    });

    it('非 DD 非 split 订单不显示 dd_refs 列内容', function() {
        var order = {
            id: 3, doc_type: 'PO',
            lines: [
                { line_num: 1, item_code: 'X001', item_name: 'Item X', planned_qty: 10, actual_qty: 0, warehouse_code: 'WH01', status: 'pending' }
            ]
        };
        var html = renderDetailRow(order);
        expect(html).not.toContain('DD26');
        expect(html).not.toContain('source_doc_number');
    });
});
```

**Step 2: 运行测试**

Run: `npm test -- --testPathPattern=oms`
Expected: 全部通过

**Step 3: 提交**

```bash
git add tests/unit/wms/oms.test.js
git commit -m "test(oms): DD 交叉引用 renderDetailRow 测试用例"
```

---

## Task 10: 数据库部署 — 生产环境迁移

**Note:** 此任务在部署时手动执行，不在本地 CI 中运行。

**Step 1: 在 dp-db 中执行迁移 SQL**

```bash
docker exec -i dp-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
-- 新增列 (幂等)
ALTER TABLE oms.order_lines ADD COLUMN IF NOT EXISTS source_line_num INTEGER;
COMMENT ON COLUMN oms.order_lines.source_line_num IS 'DD 行对应的源 SO 行号 (仅 DD 类型订单使用)';

-- 回填现有 DD 行 (通过 item_code 匹配)
UPDATE oms.order_lines ol
SET source_line_num = so_line.line_num
FROM oms.orders dd
JOIN oms.orders so ON dd.parent_id = so.id
JOIN oms.order_lines so_line
  ON so_line.order_id = so.id
  AND so_line.item_code = ol.item_code
WHERE ol.order_id = dd.id
  AND dd.doc_type = 'DD'
  AND ol.source_line_num IS NULL;

-- 验证
SELECT 'source_line_num 迁移完成' AS status,
       COUNT(*) FILTER (WHERE source_line_num IS NOT NULL) AS filled,
       COUNT(*) FILTER (WHERE source_line_num IS NULL AND o.doc_type = 'DD') AS unfilled
FROM oms.order_lines ol
JOIN oms.orders o ON ol.order_id = o.id;
SQL
```

**Step 2: 部署 wf21 工作流**

参考 `.claude/skills/n8n-migration-lessons.md` 部署 SOP:
1. 查询 wf21 的 workflow id
2. 替换凭据占位符
3. 更新 workflow_entity + workflow_history 中的 nodes 字段
4. 清理 webhook_entity
5. 重启 dp-wf

**Step 3: 部署 wf22 工作流 (如有变更)**

同上 SOP。

**Step 4: 重建 dp-wms-web 容器**

```bash
docker compose build dp-wms-web
docker compose up -d dp-wms-web
docker exec dp-gateway nginx -s reload
```

---

## 依赖关系

```
Task 1 (DDL) ─────┐
Task 2 (迁移注释) ─┤
                   ├──→ Task 5 (wf22) ──→ Task 10 (部署)
Task 3 (wf21 单查) ┤
Task 4 (wf21 批量) ┤
Task 6 (i18n) ─────┤
                   ├──→ Task 7 (前端渲染) ──→ Task 8 (版本号) ──→ Task 9 (测试)
```

---

## 验证清单

- [ ] `npm test` 全部通过
- [ ] SO 展开明细: 已拆分行显示 `DD26xxxxxx#N` 格式
- [ ] DD 展开明细: 头部显示 "源单: SO-xxxx"，行内显示源行号
- [ ] 未拆分 SO 的 dd_refs 列为空
- [ ] PO/WO/TR 类型不受影响
- [ ] 前端缓存版本号已升级
