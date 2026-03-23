#!/usr/bin/env python3
"""
修复 DD 仓库数据 + wf1c/wf21 查询 warehouse 回退到源单
v3:
  1. wf1c OMS查询: warehouse_code fallback to source SO line
  2. wf21 Query Lines / Batch Query Lines: warehouse_code fallback
  3. 回填已有 DD order_lines.warehouse_code
  4. 回填已有 DD orders.warehouse_code (从首行获取)
"""
import os, sys, json, uuid, psycopg2

# 从 .env 读取配置
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
env_vars = {}
with open(env_path, 'r') as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, _, val = line.partition('=')
            env_vars[key.strip()] = val.strip()

DB_HOST = '127.0.0.1'
DB_PORT = int(env_vars.get('DP_DB_PORT', '5432'))
DB_NAME = env_vars.get('DP_DB_NAME', env_vars.get('DB_POSTGRESDB_DATABASE', 'dp'))
DB_USER = env_vars.get('DP_DB_USER', env_vars.get('DB_POSTGRESDB_USER', 'dp_app'))
DB_PASS = env_vars.get('DP_DB_PASSWORD', env_vars.get('DB_POSTGRESDB_PASSWORD', ''))

print(f"[DB] 连接 {DB_HOST}:{DB_PORT}/{DB_NAME} as {DB_USER}")
conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASS)
conn.autocommit = False
cur = conn.cursor()

# ============================================================
# 1. 回填已有 DD order_lines.warehouse_code
# ============================================================
print("\n=== 1. 回填 DD order_lines.warehouse_code ===")
cur.execute("""
UPDATE oms.order_lines ol
SET warehouse_code = src_ol.warehouse_code
FROM oms.orders o,
     oms.orders src_o,
     oms.order_lines src_ol
WHERE ol.order_id = o.id
  AND o.doc_type = 'DD'
  AND (ol.warehouse_code IS NULL OR ol.warehouse_code = '')
  AND src_o.sap_doc_num = ol.source_doc_number
  AND src_o.company_code = o.company_code
  AND src_ol.order_id = src_o.id
  AND src_ol.line_num = ol.source_line_num
  AND src_ol.warehouse_code IS NOT NULL
  AND src_ol.warehouse_code <> ''
""")
print(f"  回填 DD order_lines: {cur.rowcount} 行")

# ============================================================
# 2. 回填 DD orders.warehouse_code (取第一行的 warehouse)
# ============================================================
print("\n=== 2. 回填 DD orders.warehouse_code ===")
cur.execute("""
UPDATE oms.orders o
SET warehouse_code = (
    SELECT ol.warehouse_code FROM oms.order_lines ol
    WHERE ol.order_id = o.id AND ol.warehouse_code IS NOT NULL AND ol.warehouse_code <> ''
    ORDER BY ol.line_num LIMIT 1
)
WHERE o.doc_type = 'DD'
  AND (o.warehouse_code IS NULL OR o.warehouse_code = '')
  AND EXISTS (
    SELECT 1 FROM oms.order_lines ol
    WHERE ol.order_id = o.id AND ol.warehouse_code IS NOT NULL AND ol.warehouse_code <> ''
  )
""")
print(f"  回填 DD orders: {cur.rowcount} 行")

conn.commit()
print("✓ 数据回填完成")

# ============================================================
# 3. 更新 wf1c: OMS查询 warehouse fallback
# ============================================================
print("\n=== 3. 更新 wf1c OMS查询 ===")
cur.execute("SELECT id, nodes FROM wf.workflow_entity WHERE name LIKE '%wf1c%' LIMIT 1")
row = cur.fetchone()
if not row:
    print("ERROR: 未找到 wf1c")
    sys.exit(1)

wf_id, nodes = row
nodes_data = json.loads(nodes) if isinstance(nodes, str) else nodes

# 替换 OMS查询 节点中的 warehouse 部分
for node in nodes_data:
    if 'OMS' in node.get('name', '') and node.get('type', '') == 'n8n-nodes-base.postgres':
        old_query = node['parameters']['query']
        # 替换: ol.warehouse_code AS "WhsCode", ol.warehouse_code AS "WhsName"
        # → COALESCE fallback
        new_query = old_query.replace(
            'ol.warehouse_code AS "WhsCode", ol.warehouse_code AS "WhsName"',
            """COALESCE(NULLIF(ol.warehouse_code, ''),
    (SELECT src_ol.warehouse_code FROM oms.orders src_o
     JOIN oms.order_lines src_ol ON src_ol.order_id = src_o.id
     WHERE src_o.sap_doc_num = ol.source_doc_number
     AND src_o.company_code = o.company_code
     AND src_ol.line_num = ol.source_line_num
     LIMIT 1)
  ) AS "WhsCode",
  COALESCE(NULLIF(ol.warehouse_code, ''),
    (SELECT src_ol2.warehouse_code FROM oms.orders src_o2
     JOIN oms.order_lines src_ol2 ON src_ol2.order_id = src_o2.id
     WHERE src_o2.sap_doc_num = ol.source_doc_number
     AND src_o2.company_code = o.company_code
     AND src_ol2.line_num = ol.source_line_num
     LIMIT 1)
  ) AS "WhsName\""""
        )
        if new_query != old_query:
            node['parameters']['query'] = new_query
            print(f"  ✓ wf1c '{node['name']}' 已更新 warehouse fallback")
        else:
            print(f"  ⚠ wf1c '{node['name']}' 未发生变化 (可能已修改)")
        break

new_version = str(uuid.uuid4())
nodes_json = json.dumps(nodes_data, ensure_ascii=False)
cur.execute("""
UPDATE wf.workflow_entity SET nodes = %s::jsonb, "versionId" = %s, "updatedAt" = NOW()
WHERE id = %s
""", (nodes_json, new_version, wf_id))
cur.execute("""
INSERT INTO wf.workflow_history ("workflowId", nodes, connections, "versionId", authors, "createdAt", "updatedAt")
SELECT id, nodes, connections, %s, 'script', NOW(), NOW() FROM wf.workflow_entity WHERE id = %s
""", (new_version, wf_id))
conn.commit()
print(f"  wf1c versionId: {new_version}")

# ============================================================
# 4. 更新 wf21: Query Lines + Batch Query Lines warehouse fallback
# ============================================================
print("\n=== 4. 更新 wf21 Query Lines 仓库回退 ===")
cur.execute("SELECT id, nodes FROM wf.workflow_entity WHERE name LIKE '%wf21%' LIMIT 1")
row = cur.fetchone()
if not row:
    print("ERROR: 未找到 wf21")
    sys.exit(1)

wf21_id, wf21_nodes = row
wf21_data = json.loads(wf21_nodes) if isinstance(wf21_nodes, str) else wf21_nodes

# 需要修复的两个节点: Query Lines + Batch Query Lines
wf21_changed = False
for node in wf21_data:
    name = node.get('name', '')
    if name in ('Query Lines', 'Batch Query Lines') and node.get('type', '') == 'n8n-nodes-base.postgres':
        old_q = node['parameters']['query']
        # 替换 ol.warehouse_code → COALESCE fallback (仅对 DD 类型生效)
        # 原: ol.warehouse_code,
        # 新: COALESCE(NULLIF(ol.warehouse_code, ''), ...) AS warehouse_code,
        new_q = old_q.replace(
            '  ol.warehouse_code, ol.from_warehouse, ol.to_warehouse,',
            """  COALESCE(NULLIF(ol.warehouse_code, ''),
    CASE WHEN o.doc_type = 'DD' AND ol.source_doc_number IS NOT NULL THEN
      (SELECT src_ol.warehouse_code FROM oms.orders src_o
       JOIN oms.order_lines src_ol ON src_ol.order_id = src_o.id
       WHERE src_o.sap_doc_num = ol.source_doc_number AND src_o.company_code = o.company_code
       AND src_ol.line_num = ol.source_line_num LIMIT 1)
    ELSE NULL END
  ) AS warehouse_code, ol.from_warehouse, ol.to_warehouse,"""
        )
        if new_q != old_q:
            node['parameters']['query'] = new_q
            wf21_changed = True
            print(f"  ✓ wf21 '{name}' 已更新 warehouse fallback")
        else:
            print(f"  ⚠ wf21 '{name}' 未变化")

if wf21_changed:
    new_version_21 = str(uuid.uuid4())
    nodes_json_21 = json.dumps(wf21_data, ensure_ascii=False)
    cur.execute("""
    UPDATE wf.workflow_entity SET nodes = %s::jsonb, "versionId" = %s, "updatedAt" = NOW()
    WHERE id = %s
    """, (nodes_json_21, new_version_21, wf21_id))
    cur.execute("""
    INSERT INTO wf.workflow_history ("workflowId", nodes, connections, "versionId", authors, "createdAt", "updatedAt")
    SELECT id, nodes, connections, %s, 'script', NOW(), NOW() FROM wf.workflow_entity WHERE id = %s
    """, (new_version_21, wf21_id))
    conn.commit()
    print(f"  wf21 versionId: {new_version_21}")
else:
    print("  wf21 无变化")

cur.close()
conn.close()
print("\n✅ 全部完成")
