#!/usr/bin/env python3
"""
更新 wf1c OMS查询 + wf21 DD Children SQL (修复 DISTINCT ORDER BY)
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
# wf1c: SO查询 — 修复 OMS查询 DocNum fallback
# =====================================================
print("=" * 60)
print("更新 wf1c - SO查询(销售订单)")
print("=" * 60)

wf1c_id = sql("SELECT id FROM wf.workflow_entity WHERE name LIKE 'wf1c%';")
print(f"  工作流 ID: {wf1c_id}")

wf1c = get_workflow(wf1c_id)
nodes1c = wf1c["nodes"]

# 修复 OMS查询: DocNum fallback + 添加源单信息
node = find_node(nodes1c, "OMS查询")
if node:
    node["parameters"]["query"] = """SELECT COALESCE(o.sap_doc_num, o.doc_number) AS "DocNum", o.sap_doc_entry AS "DocEntry",
  o.business_partner AS "CardCode", o.bp_name AS "CardName",
  o.sap_status AS "DocStatus", o.due_date AS "DocDueDate",
  o.doc_type AS "omsDocType", o.doc_number AS "omsDocNumber",
  o.container_no AS "containerNo",
  ol.line_num AS "LineNum", ol.item_code AS "ItemCode",
  ol.item_name AS "ItemName", ol.uom,
  ol.quantity AS "Quantity", ol.open_quantity AS "DelivrdQty",
  (ol.quantity - COALESCE(ol.wms_actual_qty, 0)) AS "OpenQty",
  CASE WHEN ol.wms_actual_qty >= ol.quantity THEN 'C' ELSE 'O' END AS "LineStatus",
  ol.warehouse_code AS "WhsCode", ol.warehouse_code AS "WhsName",
  ol.source_doc_number AS "sourceDocNumber",
  ol.source_line_num AS "sourceLineNum"
FROM oms.orders o
LEFT JOIN oms.order_lines ol ON ol.order_id = o.id
WHERE o.company_code = $1
  AND o.doc_number = $2
ORDER BY ol.line_num"""
    print("  ✅ OMS查询 - query 已更新 (DocNum fallback + 源单字段)")

# 修复 Merge Data: 传递源单信息给前端
node = find_node(nodes1c, "Merge Data")
if node:
    # 读取现有 jsCode 并替换
    old_code = node["parameters"].get("jsCode", "")
    # 完全重写 Merge Data
    node["parameters"]["jsCode"] = r"""// V1.3: 合并 SAP 或 OMS 数据 + WMS 历史 (支持 DD 源单信息)
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
  sourceLineNum: r.json.sourceLineNum
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
    print("  ✅ Merge Data - jsCode 已更新 (V1.3: DD 源单信息)")

ver1c = update_workflow(wf1c_id, nodes1c, wf1c["connections"])
print(f"  📦 wf1c 已写入 DB (版本: {ver1c})")

# =====================================================
# 重启 n8n
# =====================================================
print()
print("🔄 重启 n8n...")
subprocess.run(["docker", "restart", "dp-wf"], capture_output=True)
print("✅ 全部完成!")
