#!/usr/bin/env python3
"""
更新 wf1c OMS查询 (修复 DelivrdQty BUG + 添加 sourcePlannedQty)
更新 wf22 生成拆SQL (DD 拆分后 WMS documents upsert)
"""
import subprocess, json, uuid, sys, os

DB_USER = os.environ.get('DP_DB_USER', os.environ.get('DB_POSTGRESDB_USER', 'dp_app'))
DB_NAME = os.environ.get('DP_DB_NAME', os.environ.get('DB_POSTGRESDB_DATABASE', 'dp'))

def sql(query):
    r = subprocess.run(
        ["docker", "exec", "dp-db", "psql", "-U", DB_USER, "-d", DB_NAME, "-t", "-A", "-c", query],
        capture_output=True, text=True
    )
    if r.returncode != 0:
        print(f"SQL ERROR: {r.stderr}", file=sys.stderr)
    return r.stdout.strip()

def get_workflow(wf_id):
    raw = sql(f"SELECT json_build_object('nodes', nodes, 'connections', connections, 'name', name, 'active', active, 'settings', settings) FROM wf.workflow_entity WHERE id = '{wf_id}';")
    return json.loads(raw)

def find_node(nodes, name):
    for n in nodes:
        if n.get("name") == name:
            return n
    return None

def update_workflow(wf_id, nodes, connections):
    new_version = str(uuid.uuid4())
    nodes_json = json.dumps(nodes).replace("'", "''")
    conn_json = json.dumps(connections).replace("'", "''")
    sql(f"""
INSERT INTO wf.workflow_history ("versionId", "workflowId", authors, name, nodes, connections, "createdAt", "updatedAt")
SELECT '{new_version}', '{wf_id}', 'AI Update', name, '{nodes_json}'::json, '{conn_json}'::json, NOW(), NOW()
FROM wf.workflow_entity WHERE id = '{wf_id}';
""")
    sql(f"""
UPDATE wf.workflow_entity SET
  nodes = '{nodes_json}'::json,
  connections = '{conn_json}'::json,
  "versionId" = '{new_version}',
  "activeVersionId" = '{new_version}',
  "updatedAt" = NOW()
WHERE id = '{wf_id}';
""")
    return new_version

# =====================================================
# wf1c: SO查询 — 修复 OMS 查询 DelivrdQty + sourcePlannedQty
# =====================================================
print("=" * 60)
print("更新 wf1c - SO查询(销售订单)")
print("=" * 60)

wf1c_id = sql("SELECT id FROM wf.workflow_entity WHERE name LIKE 'wf1c%';")
print(f"  工作流 ID: {wf1c_id}")

wf1c = get_workflow(wf1c_id)
nodes1c = wf1c["nodes"]

# 修复 OMS查询: DelivrdQty=0 (修复已发BUG) + sourcePlannedQty (源计划数)
node = find_node(nodes1c, "OMS查询")
if node:
    node["parameters"]["query"] = """SELECT COALESCE(o.sap_doc_num, o.doc_number) AS "DocNum", o.sap_doc_entry AS "DocEntry",
  o.business_partner AS "CardCode", o.bp_name AS "CardName",
  o.sap_status AS "DocStatus", o.due_date AS "DocDueDate",
  o.doc_type AS "omsDocType", o.doc_number AS "omsDocNumber",
  o.container_no AS "containerNo",
  ol.line_num AS "LineNum", ol.item_code AS "ItemCode",
  ol.item_name AS "ItemName", ol.uom,
  ol.quantity AS "Quantity", 0 AS "DelivrdQty",
  (ol.quantity - COALESCE(ol.wms_actual_qty, 0)) AS "OpenQty",
  CASE WHEN ol.wms_actual_qty >= ol.quantity THEN 'C' ELSE 'O' END AS "LineStatus",
  ol.warehouse_code AS "WhsCode", ol.warehouse_code AS "WhsName",
  ol.source_doc_number AS "sourceDocNumber",
  ol.source_line_num AS "sourceLineNum",
  (SELECT src_ol.quantity FROM oms.orders src_o
   JOIN oms.order_lines src_ol ON src_ol.order_id = src_o.id
   WHERE src_o.sap_doc_num = ol.source_doc_number
   AND src_o.company_code = o.company_code
   AND src_ol.line_num = ol.source_line_num
   LIMIT 1) AS "sourcePlannedQty"
FROM oms.orders o
LEFT JOIN oms.order_lines ol ON ol.order_id = o.id
WHERE o.company_code = $1
  AND o.doc_number = $2
ORDER BY ol.line_num"""
    print("  ✅ OMS查询 - query 已更新 (DelivrdQty=0 + sourcePlannedQty)")

# 修复 Merge Data: 传递 sourcePlannedQty
node = find_node(nodes1c, "Merge Data")
if node:
    node["parameters"]["jsCode"] = r"""// V1.4: 合并 SAP 或 OMS 数据 + WMS 历史 (支持 DD 源单信息 + 源计划数)
const docSource = $('Extract Params').item.json.doc_source || 'sap';
let dataRows = [];
try {
  if (docSource === 'oms') {
    dataRows = $('OMS查询').all();
  } else {
    dataRows = $('SAP查询').all();
  }
} catch(e) {
  const src = docSource === 'oms' ? 'OMS' : 'SAP';
  return { json: { success: false, message: src + '查询失败: ' + e.message } };
}

let wmsRows = [];
try { wmsRows = $('PG WMS').all(); } catch(e) { /* PG WMS 可能未执行 */ }

if (!dataRows || dataRows.length === 0 || !dataRows[0].json.DocNum) {
  const src = docSource === 'oms' ? 'OMS' : 'SAP';
  return { json: { success: false, message: '未在' + src + '中找到该订单' } };
}

const first = dataRows[0].json;
const lines = dataRows.map(r => ({
  lineNum: r.json.LineNum,
  itemCode: r.json.ItemCode,
  itemName: r.json.ItemName || '',
  quantity: parseFloat(r.json.Quantity) || 0,
  deliveredQty: parseFloat(r.json.DelivrdQty) || 0,
  openQty: parseFloat(r.json.OpenQty) || 0,
  lineStatus: r.json.LineStatus || 'O',
  uom: r.json.uom || '',
  whsCode: r.json.WhsCode || '',
  sourceDocNumber: r.json.sourceDocNumber || '',
  sourceLineNum: r.json.sourceLineNum,
  sourcePlannedQty: r.json.sourcePlannedQty != null ? parseFloat(r.json.sourcePlannedQty) : null
}));

// 收集 DD 的所有源单号 (去重)
const sourceDocs = [];
if (docSource === 'oms') {
  const seen = new Set();
  lines.forEach(l => {
    if (l.sourceDocNumber && !seen.has(l.sourceDocNumber)) {
      seen.add(l.sourceDocNumber);
      sourceDocs.push(l.sourceDocNumber);
    }
  });
}

const lineReceipts = {};
const transactions = [];
let docWmsStatus = 'pending';
for (const r of wmsRows) {
  if (r.json.doc_wms_status) docWmsStatus = r.json.doc_wms_status;
  if (r.json.id) {
    const ln = r.json.line_num;
    if (ln !== null && ln !== undefined) {
      lineReceipts[ln] = (lineReceipts[ln] || 0) + parseFloat(r.json.quantity || 0);
    }
    transactions.push({
      transaction_time: r.json.transaction_time,
      item_code: r.json.item_code || '',
      item_name: r.json.item_name || '',
      quantity: parseFloat(r.json.quantity),
      performed_by: r.json.performed_by,
      remarks: r.json.remarks || ''
    });
  }
}

return { json: {
  success: true,
  data_source: docSource,
  sap_order: {
    docNum: String(first.DocNum),
    docEntry: first.DocEntry,
    docType: docSource === 'oms' ? (first.omsDocType || 'DD') : 'SO',
    cardCode: first.CardCode || '',
    cardName: first.CardName || '',
    docDueDate: first.DocDueDate,
    docStatus: first.DocStatus || 'O',
    containerNo: first.containerNo || '',
    sourceDocs: sourceDocs,
    lines: lines
  },
  wms_history: {
    wms_status: docWmsStatus,
    lineReceipts: lineReceipts,
    transactions: transactions
  }
}};"""
    print("  ✅ Merge Data - jsCode 已更新 (V1.4: sourcePlannedQty)")

ver1c = update_workflow(wf1c_id, nodes1c, wf1c["connections"])
print(f"  📦 wf1c 已写入 DB (版本: {ver1c})")

# =====================================================
# wf22: OMS DD拆单 — 添加 WMS documents upsert
# =====================================================
print()
print("=" * 60)
print("更新 wf22 - OMS DD拆单管理")
print("=" * 60)

wf22_id = sql("SELECT id FROM wf.workflow_entity WHERE name LIKE 'wf22%';")
print(f"  工作流 ID: {wf22_id}")

wf22 = get_workflow(wf22_id)
nodes22 = wf22["nodes"]

node = find_node(nodes22, "生成拆单SQL")
if not node:
    node = find_node(nodes22, "生成拆SQL")
if node:
    node["parameters"]["jsCode"] = r"""// ==========================================================
// V2.1: 生成 DD 拆单 SQL (支持多 SO 合并 + WMS 状态回写)
// DD 编号格式: DD + YY + 6位序列 (DD26000001)
// 每个容器 = 1 个 DD (非按 SO×容器)
// ==========================================================

// SQL 安全转义
function esc(val) {
    if (val == null) return 'NULL';
    return "'" + String(val).replace(/'/g, "''") + "'";
}

const validated = $('验证请求').first().json;
const sourceOrders = $('查询源订单').all().map(item => item.json);

if (!sourceOrders || sourceOrders.length === 0) {
    return { json: { _error: true, message: '未找到源订单' } };
}

try {
    const companyCode = validated.company_code;
    const ddGroups = validated.dd_groups || [];
    const sourceOrderIds = validated.source_order_ids;

    // 建立 sourceOrder 查找表 (id → order)
    const soMap = {};
    sourceOrders.forEach(so => { soMap[so.id] = so; });

    // 第一个源订单作为 DD 头部默认值
    const primarySO = sourceOrders[0];

    // 幂等键: 排序的源订单 ID 组合
    const sortedIds = sourceOrderIds.slice().sort((a, b) => a - b).join('_');

    // 所有 DD 的 SQL 合并为一条事务
    const sqlParts = [];

    ddGroups.forEach((group, index) => {
        if (!group.lines || group.lines.length === 0) return;
        const ddIndex = index + 1;
        const containerNo = group.container_no || '';
        const idempotencyKey = sortedIds + '_DD_' + ddIndex;

        // 确定此 DD 的 parent_id (第一行的 source_order_id, 或 primarySO)
        const firstLineSourceId = group.lines[0].source_order_id || sourceOrderIds[0];

        // 确定客商信息 (从源订单中取)
        const parentSO = soMap[firstLineSourceId] || primarySO;

        // 为 lines 添加 source_doc_num (从 soMap 查找)
        const enrichedLines = group.lines.map(ln => {
            const srcSO = soMap[ln.source_order_id] || primarySO;
            return {
                item_code: ln.item_code,
                item_name: ln.item_name || '',
                qty: ln.qty,
                source_line_num: ln.line_num,
                source_doc_number: srcSO.sap_doc_num || srcSO.doc_number || '',
                warehouse_code: ln.warehouse_code || srcSO.warehouse_code || ''
            };
        });

        const linesJson = JSON.stringify(enrichedLines);

        // DD 编号: DD + YY(2位年份) + 6位序列号
        const sql = `
WITH dd_${ddIndex} AS (
    INSERT INTO oms.orders (
        company_code, doc_type, doc_number, parent_id, is_split, split_seq,
        container_no, sap_doc_num, business_partner, bp_name,
        warehouse_code, doc_date, due_date, oms_status, idempotency_key, created_by
    ) VALUES (
        ${esc(companyCode)}, 'DD',
        'DD' || TO_CHAR(NOW(), 'YY') || LPAD(nextval('oms.dd_doc_seq')::TEXT, 6, '0'),
        ${firstLineSourceId}, FALSE, ${ddIndex},
        ${esc(containerNo)}, NULL,
        ${esc(parentSO.business_partner || '')},
        ${esc(parentSO.bp_name || '')},
        ${esc(parentSO.warehouse_code || '')},
        CURRENT_DATE,
        ${parentSO.due_date ? esc(parentSO.due_date) : 'NULL'},
        'pending', ${esc(idempotencyKey)}, 'wf22'
    )
    ON CONFLICT (company_code, idempotency_key) WHERE idempotency_key IS NOT NULL
    DO NOTHING
    RETURNING id
)
INSERT INTO oms.order_lines (
    order_id, line_num, item_code, item_name,
    quantity, open_quantity, warehouse_code, source_line_num, source_doc_number
)
SELECT
    dd_${ddIndex}.id,
    ROW_NUMBER() OVER (ORDER BY elem_idx) AS line_num,
    (elem.value->>'item_code')::TEXT,
    COALESCE((elem.value->>'item_name')::TEXT, ''),
    (elem.value->>'qty')::DECIMAL(18,4),
    (elem.value->>'qty')::DECIMAL(18,4),
    COALESCE((elem.value->>'warehouse_code')::TEXT, ''),
    (elem.value->>'source_line_num')::INTEGER,
    (elem.value->>'source_doc_number')::TEXT
FROM dd_${ddIndex},
     jsonb_array_elements(${esc(linesJson)}::JSONB) WITH ORDINALITY AS elem(value, elem_idx)`;

        sqlParts.push(sql);
    });

    if (sqlParts.length === 0) {
        return { json: { _error: true, message: '无有效 DD 可创建' } };
    }

    // 标记所有源订单为已拆分 (OMS)
    const updateParts = sourceOrderIds.map(id =>
        `UPDATE oms.orders SET is_split = TRUE, oms_status = 'split' WHERE id = ${id} AND oms_status <> 'split'`
    );

    // V2.1: 同步更新 WMS documents 状态为 'split' (如已存在则更新, 不存在则创建)
    const wmsParts = sourceOrders.map(so => {
        const docNum = so.sap_doc_num || so.doc_number || '';
        if (!docNum) return '';
        return `INSERT INTO wms.wms_documents (company_code, doc_type, doc_number, sap_doc_num, status, wms_status, priority, doc_date, created_by)
VALUES (${esc(companyCode)}, 'SO', ${esc(docNum)}, ${esc(docNum)}, 'draft', 'split', 'normal', CURRENT_DATE, 'wf22')
ON CONFLICT (company_code, doc_type, doc_number) DO UPDATE SET wms_status = 'split', updated_at = NOW()`;
    }).filter(s => s);

    // 合并为单条 SQL (事务内)
    const fullSql = sqlParts.join(';\n') + ';\n' + updateParts.join(';\n') + ';\n' + wmsParts.join(';\n') + ';';

    return [{ json: { sql: fullSql, dd_count: sqlParts.length } }];
} catch (error) {
    throw new Error('Data Transformation Failed: ' + error.message);
}"""
    print("  ✅ 生成拆单SQL - jsCode 已更新 (V2.1: WMS 状态回写)")

ver22 = update_workflow(wf22_id, nodes22, wf22["connections"])
print(f"  📦 wf22 已写入 DB (版本: {ver22})")

# =====================================================
# 重启 n8n
# =====================================================
print()
print("🔄 重启 n8n...")
subprocess.run(["docker", "restart", "dp-wf"], capture_output=True)
print("✅ 全部完成!")
