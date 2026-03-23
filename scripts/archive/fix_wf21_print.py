#!/usr/bin/env python3
"""
为 wf21 Query Lines / Batch Query Lines 添加 source_planned_qty 字段
(DD 打印需要显示源单计划数量)
"""
import os, sys, json, uuid, psycopg2

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
DB_NAME = env_vars.get('DP_DB_NAME', 'dp')
DB_USER = env_vars.get('DP_DB_USER', 'dp_app')
DB_PASS = env_vars.get('DP_DB_PASSWORD', env_vars.get('DB_POSTGRESDB_PASSWORD', ''))

conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASS)
conn.autocommit = False
cur = conn.cursor()

cur.execute("SELECT id, nodes FROM wf.workflow_entity WHERE name LIKE '%wf21%' LIMIT 1")
row = cur.fetchone()
if not row:
    print("ERROR: wf21 not found")
    sys.exit(1)

wf_id, nodes = row
data = json.loads(nodes) if isinstance(nodes, str) else nodes

changed = False
for n in data:
    name = n.get('name', '')
    if name in ('Query Lines', 'Batch Query Lines') and n.get('type', '') == 'n8n-nodes-base.postgres':
        q = n['parameters']['query']
        if 'source_planned_qty' not in q:
            insert_text = """  CASE WHEN o.doc_type = 'DD' AND ol.source_doc_number IS NOT NULL THEN
    (SELECT src_ol2.quantity FROM oms.orders src_o2
     JOIN oms.order_lines src_ol2 ON src_ol2.order_id = src_o2.id
     WHERE src_o2.sap_doc_num = ol.source_doc_number AND src_o2.company_code = o.company_code
     AND src_ol2.line_num = ol.source_line_num LIMIT 1)
  ELSE NULL END AS source_planned_qty,
"""
            q = q.replace(
                '  (SELECT STRING_AGG(',
                insert_text + '  (SELECT STRING_AGG('
            )
            n['parameters']['query'] = q
            changed = True
            print(f"  ✓ {name} 已添加 source_planned_qty")
        else:
            print(f"  ⚠ {name} 已有 source_planned_qty")

if changed:
    new_ver = str(uuid.uuid4())
    nodes_json = json.dumps(data, ensure_ascii=False)
    cur.execute("""
    UPDATE wf.workflow_entity SET nodes = %s::jsonb, "versionId" = %s, "updatedAt" = NOW()
    WHERE id = %s
    """, (nodes_json, new_ver, wf_id))
    cur.execute("""
    INSERT INTO wf.workflow_history ("workflowId", nodes, connections, "versionId", authors, "createdAt", "updatedAt")
    SELECT id, nodes, connections, %s, 'script', NOW(), NOW() FROM wf.workflow_entity WHERE id = %s
    """, (new_ver, wf_id))
    conn.commit()
    print(f"  wf21 versionId: {new_ver}")
else:
    print("  无变化")

cur.close()
conn.close()
print("✅ 完成")
