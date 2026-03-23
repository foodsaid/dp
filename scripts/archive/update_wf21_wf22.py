#!/usr/bin/env python3
"""
更新 wf21 + wf22 的节点参数 (保留真实凭据)
方法: 从 DB 读取 → 替换目标节点的 jsCode/query → 写回 DB
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
    """从 workflow_entity 读取完整工作流"""
    raw = sql(f"SELECT json_build_object('nodes', nodes, 'connections', connections, 'name', name, 'active', active, 'settings', settings) FROM wf.workflow_entity WHERE id = '{wf_id}';")
    return json.loads(raw)

def find_node(nodes, name):
    """按名称查找节点"""
    for n in nodes:
        if n.get("name") == name:
            return n
    return None

def update_workflow(wf_id, nodes, connections):
    """写回 DB: workflow_entity + workflow_history"""
    new_version = str(uuid.uuid4())
    nodes_json = json.dumps(nodes).replace("'", "''")
    conn_json = json.dumps(connections).replace("'", "''")

    # 1. 先插入 history
    sql(f"""
INSERT INTO wf.workflow_history ("versionId", "workflowId", authors, name, nodes, connections, "createdAt", "updatedAt")
SELECT '{new_version}', '{wf_id}', 'AI Update', name, '{nodes_json}'::json, '{conn_json}'::json, NOW(), NOW()
FROM wf.workflow_entity WHERE id = '{wf_id}';
""")

    # 2. 再更新 entity
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
# wf22: DD 拆单管理 — 更新 3 个节点
# =====================================================
print("=" * 60)
print("更新 wf22 - OMS DD拆单管理")
print("=" * 60)

wf22 = get_workflow("d71ba497cf")
nodes22 = wf22["nodes"]

# 1. 验证请求 — 新的 jsCode (支持 source_order_ids)
node = find_node(nodes22, "验证请求")
if node:
    node["parameters"]["jsCode"] = """// V2.0: 验证 DD 拆单请求 (支持多 SO 合并)
const body = $input.first().json.body || {};
const companyCode = $env.DP_COMPANY_CODE;

if (!companyCode) {
  return { json: { _error: true, message: 'DP_COMPANY_CODE not set' } };
}

// 支持新格式 source_order_ids (数组) 和旧格式 source_order_id (单个)
let sourceOrderIds = [];
if (Array.isArray(body.source_order_ids) && body.source_order_ids.length > 0) {
  sourceOrderIds = body.source_order_ids.map(id => parseInt(id)).filter(id => id > 0);
} else if (body.source_order_id) {
  const single = parseInt(body.source_order_id);
  if (single > 0) sourceOrderIds = [single];
}
if (sourceOrderIds.length === 0) {
  return { json: { _error: true, message: '缺少 source_order_ids' } };
}

const ddGroups = body.dd_groups;
if (!Array.isArray(ddGroups) || ddGroups.length === 0) {
  return { json: { _error: true, message: '缺少 dd_groups' } };
}

// 验证每个 DD 组
for (let i = 0; i < ddGroups.length; i++) {
  const g = ddGroups[i];
  if (!Array.isArray(g.lines) || g.lines.length === 0) {
    return { json: { _error: true, message: `DD #${i+1} 缺少行项目` } };
  }
  for (const ln of g.lines) {
    if (!ln.item_code || typeof ln.qty !== 'number' || ln.qty <= 0) {
      return { json: { _error: true, message: `DD #${i+1} 行项目无效: ${ln.item_code}` } };
    }
  }
}

return { json: {
  _error: false,
  company_code: companyCode,
  source_order_ids: sourceOrderIds,
  dd_groups: ddGroups
} };"""
    print("  ✅ 验证请求 - jsCode 已更新")

# 2. 查询源订单 — 改为 ANY 查询多个
node = find_node(nodes22, "查询源订单")
if node:
    node["parameters"]["query"] = "SELECT o.id, o.doc_type, o.sap_doc_num, o.doc_number, o.business_partner, o.bp_name, o.warehouse_code, o.doc_date, o.due_date, o.oms_status, o.execution_state, o.is_split FROM oms.orders o WHERE o.id = ANY($1::int[]) AND o.company_code = $2 AND o.parent_id IS NULL"
    node["parameters"]["options"]["queryReplacement"] = "={{ ['{' + $json.source_order_ids.join(',') + '}', $json.company_code] }}"
    print("  ✅ 查询源订单 - query + replacement 已更新")

# 3. 生成拆单SQL — 全面重构
node = find_node(nodes22, "生成拆单SQL")
if node:
    node["parameters"]["jsCode"] = r"""// ==========================================================
// V2.0: 生成 DD 拆单 SQL (支持多 SO 合并到同一个 DD)
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

    // 标记所有源订单为已拆分
    const updateParts = sourceOrderIds.map(id =>
        `UPDATE oms.orders SET is_split = TRUE, oms_status = 'split' WHERE id = ${id} AND oms_status <> 'split'`
    );

    // 合并为单条 SQL (事务内)
    const fullSql = sqlParts.join(';\n') + ';\n' + updateParts.join(';\n') + ';';

    return [{ json: { sql: fullSql, dd_count: sqlParts.length } }];
} catch (error) {
    throw new Error('Data Transformation Failed: ' + error.message);
}"""
    print("  ✅ 生成拆单SQL - jsCode 已更新")

ver22 = update_workflow("d71ba497cf", nodes22, wf22["connections"])
print(f"  📦 wf22 已写入 DB (版本: {ver22})")

# =====================================================
# wf21: OMS 订单查询 — 更新 5 个节点
# =====================================================
print()
print("=" * 60)
print("更新 wf21 - OMS订单查询")
print("=" * 60)

wf21 = get_workflow("ba6f20997d")
nodes21 = wf21["nodes"]

# 1. Query Lines
node = find_node(nodes21, "Query Lines")
if node:
    node["parameters"]["query"] = """SELECT ol.id, ol.order_id, ol.line_num, ol.item_code, ol.item_name,
  ol.barcode, ol.uom, ol.quantity AS planned_qty, ol.open_quantity AS delivered_qty,
  ol.wms_actual_qty AS actual_qty, ol.unit_price, ol.line_total,
  ol.warehouse_code, ol.from_warehouse, ol.to_warehouse,
  ol.batch_number, ol.serial_number, ol.status, ol.remarks,
  ol.source_line_num,
  COALESCE(ol.source_doc_number, parent_ord.sap_doc_num, parent_ord.doc_number) AS source_doc_number,
  (SELECT STRING_AGG(
    COALESCE(dd_ord.doc_number, dd_ord.sap_doc_num) || '#' || dd_ol.line_num::TEXT,
    ', ' ORDER BY dd_ord.split_seq, dd_ol.line_num
  )
  FROM oms.order_lines dd_ol
  JOIN oms.orders dd_ord ON dd_ol.order_id = dd_ord.id
  WHERE dd_ord.doc_type = 'DD'
    AND dd_ol.source_doc_number = COALESCE(o.sap_doc_num, o.doc_number)
    AND dd_ol.source_line_num = ol.line_num
  ) AS dd_refs
FROM oms.order_lines ol
INNER JOIN oms.orders o ON ol.order_id = o.id
LEFT JOIN oms.orders parent_ord ON o.parent_id = parent_ord.id
WHERE o.id = $1 AND o.company_code = $2
ORDER BY ol.line_num"""
    print("  ✅ Query Lines - query 已更新")

# 2. Query DD Children
node = find_node(nodes21, "Query DD Children")
if node:
    node["parameters"]["query"] = """SELECT DISTINCT dd.id, dd.doc_number, dd.sap_doc_num, dd.container_no, dd.split_seq, dd.oms_status, dd.execution_state,
  (SELECT CASE WHEN SUM(ol.quantity) > 0
    THEN SUM(COALESCE(ol.wms_actual_qty,0))/SUM(ol.quantity)
    ELSE 0 END
   FROM oms.order_lines ol WHERE ol.order_id = dd.id) AS completion_rate
FROM oms.orders dd
WHERE dd.company_code = $2
  AND dd.doc_type = 'DD'
  AND (dd.parent_id = $1
       OR dd.id IN (SELECT DISTINCT ol2.order_id FROM oms.order_lines ol2
                   WHERE ol2.source_doc_number = (SELECT sap_doc_num FROM oms.orders WHERE id = $1)))
ORDER BY dd.split_seq"""
    print("  ✅ Query DD Children - query 已更新")

# 3. Batch Query Lines
node = find_node(nodes21, "Batch Query Lines")
if node:
    node["parameters"]["query"] = """SELECT ol.id, ol.order_id, ol.line_num, ol.item_code, ol.item_name,
  ol.barcode, ol.uom, ol.quantity AS planned_qty, ol.open_quantity AS delivered_qty,
  ol.wms_actual_qty AS actual_qty, ol.unit_price, ol.line_total,
  ol.warehouse_code, ol.from_warehouse, ol.to_warehouse,
  ol.batch_number, ol.serial_number, ol.status, ol.remarks,
  ol.source_line_num,
  COALESCE(ol.source_doc_number, parent_ord.sap_doc_num, parent_ord.doc_number) AS source_doc_number,
  (SELECT STRING_AGG(
    COALESCE(dd_ord.doc_number, dd_ord.sap_doc_num) || '#' || dd_ol.line_num::TEXT,
    ', ' ORDER BY dd_ord.split_seq, dd_ol.line_num
  )
  FROM oms.order_lines dd_ol
  JOIN oms.orders dd_ord ON dd_ol.order_id = dd_ord.id
  WHERE dd_ord.doc_type = 'DD'
    AND dd_ol.source_doc_number = COALESCE(o.sap_doc_num, o.doc_number)
    AND dd_ol.source_line_num = ol.line_num
  ) AS dd_refs
FROM oms.order_lines ol
INNER JOIN oms.orders o ON ol.order_id = o.id
LEFT JOIN oms.orders parent_ord ON o.parent_id = parent_ord.id
WHERE ol.order_id = ANY($1) AND o.company_code = $2
ORDER BY ol.order_id, ol.line_num"""
    print("  ✅ Batch Query Lines - query 已更新")

# 4. Batch Query DD Children
node = find_node(nodes21, "Batch Query DD Children")
if node:
    node["parameters"]["query"] = """SELECT DISTINCT dd.id, dd.parent_id, dd.doc_number, dd.sap_doc_num, dd.container_no, dd.split_seq, dd.oms_status, dd.execution_state,
  (SELECT CASE WHEN SUM(ol.quantity) > 0
    THEN SUM(COALESCE(ol.wms_actual_qty,0))/SUM(ol.quantity)
    ELSE 0 END
   FROM oms.order_lines ol WHERE ol.order_id = dd.id) AS completion_rate,
  COALESCE(
    (SELECT array_agg(DISTINCT parent_so.id)
     FROM oms.order_lines ol2
     JOIN oms.orders parent_so ON parent_so.sap_doc_num = ol2.source_doc_number
       AND parent_so.company_code = dd.company_code AND parent_so.parent_id IS NULL
     WHERE ol2.order_id = dd.id AND ol2.source_doc_number IS NOT NULL
    ), ARRAY[dd.parent_id]
  ) AS related_order_ids
FROM oms.orders dd
WHERE dd.company_code = $2
  AND dd.doc_type = 'DD'
  AND (dd.parent_id = ANY($1)
       OR dd.id IN (SELECT DISTINCT ol3.order_id FROM oms.order_lines ol3
                   WHERE ol3.source_doc_number IN (SELECT sap_doc_num FROM oms.orders WHERE id = ANY($1) AND sap_doc_num IS NOT NULL)))
ORDER BY dd.split_seq"""
    print("  ✅ Batch Query DD Children - query 已更新")

# 5. 合并批量结果
node = find_node(nodes21, "合并批量结果")
if node:
    node["parameters"]["jsCode"] = """// V2.0: 合并批量行和DD子单，按 order_id 分组 (支持多 SO 关联)
const lines = $('Batch Query Lines').all().map(r => r.json);
let ddChildren = [];
try {
  const seen = new Set();
  $('Batch Query DD Children').all().forEach(r => {
    if (r.json.id && !seen.has(r.json.id)) {
      seen.add(r.json.id);
      ddChildren.push(r.json);
    }
  });
} catch(e) {}

// 按 order_id 分组
const results = {};
const idsArray = $('解析批量参数').first().json.idsArray;
idsArray.forEach(id => { results[id] = { lines: [], dd_children: [] }; });

lines.forEach(ln => {
  if (results[ln.order_id]) results[ln.order_id].lines.push(ln);
});

// DD 子单按 related_order_ids 分配到所有关联 SO (支持跨 SO 的 DD)
ddChildren.forEach(dd => {
  const relatedIds = dd.related_order_ids || (dd.parent_id ? [dd.parent_id] : []);
  relatedIds.forEach(soId => {
    if (results[soId]) {
      // 防重复 (同一 DD 不重复加入同一 SO)
      if (!results[soId].dd_children.some(d => d.id === dd.id)) {
        results[soId].dd_children.push(dd);
      }
    }
  });
});

return { json: { success: true, results } };"""
    print("  ✅ 合并批量结果 - jsCode 已更新")

ver21 = update_workflow("ba6f20997d", nodes21, wf21["connections"])
print(f"  📦 wf21 已写入 DB (版本: {ver21})")

# =====================================================
# 重启 n8n
# =====================================================
print()
print("🔄 重启 n8n...")
subprocess.run(["docker", "restart", "dp-wf"], capture_output=True)
print("✅ 全部完成!")
