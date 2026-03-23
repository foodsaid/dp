# OMS SO↔DD 行级交叉引用 — 设计文档

> **日期**: 2026-03-05
> **版本**: v0.1.16
> **状态**: 已批准

---

## 一、需求

当前 OMS 订单明细中，SO 和 DD 的父子关联关系不能快速识别：
- SO 明细无法看到关联的 DD 单号和 DD 行号
- DD 明细无法看到源 SO 单号和 SO 行号

**期望**:
1. SO 行表格新增 "DD关联" 列，显示 DD 单号和行号（多个用逗号隔开）
2. DD 展开头部显示源 SO 单号
3. DD 行表格新增 "源行号" 列，显示对应 SO 行号

---

## 二、当前数据模型限制

`oms.order_lines` **没有 `source_line_num` 字段**。DD 拆单时：
- 前端 `buildPayload()` 传了源行号 `line_num: sl.line_num`
- wf22 创建 DD 行后重新编号，源行号**丢失**

**结论**: 需要数据库层补充行级映射字段。

---

## 三、设计方案 (3 层变更)

### 第 1 层 — 数据库迁移

新增字段:
```sql
ALTER TABLE oms.order_lines
ADD COLUMN source_line_num INTEGER;

COMMENT ON COLUMN oms.order_lines.source_line_num
IS 'DD 行对应的源 SO 行号 (仅 DD 类型订单使用)';
```

回填现有数据:
```sql
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
```

### 第 2 层 — 后端工作流

**wf22 DD 拆单** — 创建 DD lines 时写入 `source_line_num`:
- 前端 payload 已包含 `line_num` (源行号)
- wf22 INSERT 语句增加 `source_line_num` 列

**wf21 查询** — 两处增强:

A) SO 明细查询: 新增 `dd_line_refs` 子查询
```sql
SELECT ol.*, (
  SELECT STRING_AGG(
    dd_ord.doc_number || '#' || dd_ol.line_num::TEXT,
    ', ' ORDER BY dd_ord.split_seq, dd_ol.line_num
  )
  FROM oms.order_lines dd_ol
  JOIN oms.orders dd_ord ON dd_ol.order_id = dd_ord.id
  WHERE dd_ord.parent_id = o.id
    AND dd_ol.source_line_num = ol.line_num
) AS dd_refs
FROM oms.order_lines ol
JOIN oms.orders o ON ol.order_id = o.id
WHERE o.id = $1 AND o.company_code = $2
ORDER BY ol.line_num
```

B) DD 明细查询: 返回 `source_doc_number` + `source_line_num`
```sql
SELECT ol.*, ol.source_line_num,
       parent.doc_number AS source_doc_number
FROM oms.order_lines ol
JOIN oms.orders o ON ol.order_id = o.id
LEFT JOIN oms.orders parent ON o.parent_id = parent.id
WHERE o.id = $1 AND o.company_code = $2
ORDER BY ol.line_num
```

### 第 3 层 — 前端

**SO 行表格**: 新增 "DD关联" 列
```
行号 | 物料       | 数量 | DD关联
  1  | A001      | 100  | DD26000001#1, DD26000002#1
  2  | B002      |  50  | DD26000003#1
  3  | C003      |  75  | (空)
```

**DD 展开头部**: 显示 "源单: SO-2026-001"
**DD 行表格**: 新增 "源行号" 列
```
源单: SO-2026-001
行号 | 物料       | 数量 | 源行号
  1  | A001      |  50  | 1
  2  | C003      |  75  | 3
```

---

## 四、影响范围

| 组件 | 文件 | 变更类型 |
|------|------|---------|
| 数据库 | `infrastructure/postgres/init/05_oms_tables.sql` | DDL 新增列 |
| 数据库 | 迁移 SQL (Supabase 或手动) | 回填 source_line_num |
| 后端 | `apps/wf/wf22-oms-dd.json` | INSERT 增加 source_line_num |
| 后端 | `apps/wf/wf21-oms-query.json` | 查询增加 dd_refs / source_line_num |
| 前端 | `apps/wms/oms.js` | 渲染新增列 |
| 前端 | `apps/wms/oms.html` | 表头新增列 |
| 国际化 | `apps/wms/lang.js` | 新增 i18n 键 |
| 测试 | `tests/unit/wms/oms.test.js` | 新增关联显示测试 |
| 测试 | `tests/sql/07_oms_schema_behavior_test.sql` | 新增 source_line_num 测试 |

---

## 五、风险与缓解

| 风险 | 缓解 |
|------|------|
| 现有 DD 数据回填不准 (同物料多行) | 回填 SQL 使用 item_code + warehouse_code 组合匹配 |
| wf22 SQL 变更后部署需同步 | 遵循 n8n-migration-lessons 部署 SOP |
| 前端缓存旧版本 | 升版本号 (frontend-cache-versioning SOP) |
