#!/usr/bin/env python3
"""
修复 wf21/wf1c 子查询缺少 doc_type 过滤
问题: 同一 sap_doc_num 可能有 SO/PO/WO, 子查询 LIMIT 1 可能取到错误的行
修复: 所有 COALESCE fallback 和 source_planned_qty 子查询添加 doc_type='SO'

同时确保 activeVersionId 一致 (教训 #25)
"""
import os, sys, json, uuid, psycopg2, re

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


def fix_workflow(wf_name_pattern, label):
    """通用工作流修复函数"""
    cur.execute(
        "SELECT id, nodes, connections FROM wf.workflow_entity WHERE name LIKE %s LIMIT 1",
        (wf_name_pattern,)
    )
    row = cur.fetchone()
    if not row:
        print(f"  ERROR: 未找到 {label}")
        return False

    wf_id, nodes_raw, conn_raw = row
    nodes = json.loads(nodes_raw) if isinstance(nodes_raw, str) else nodes_raw

    changed = False
    for n in nodes:
        ntype = n.get('type', '')
        if ntype != 'n8n-nodes-base.postgres':
            continue
        q = n.get('parameters', {}).get('query', '')
        if not q:
            continue

        new_q = q

        # 修复1: source_planned_qty 子查询 — 添加 doc_type='SO'
        # 匹配模式: FROM oms.orders src_o2 ... WHERE src_o2.sap_doc_num = ... LIMIT 1)
        # 在 WHERE 后添加 AND src_o2.doc_type = 'SO'
        if 'source_planned_qty' in new_q and "src_o2.doc_type" not in new_q:
            new_q = new_q.replace(
                "WHERE src_o2.sap_doc_num = ol.source_doc_number AND src_o2.company_code = o.company_code\n     AND src_ol2.line_num = ol.source_line_num LIMIT 1)",
                "WHERE src_o2.sap_doc_num = ol.source_doc_number AND src_o2.company_code = o.company_code\n     AND src_o2.doc_type = 'SO' AND src_ol2.line_num = ol.source_line_num LIMIT 1)"
            )

        # 修复2: warehouse COALESCE fallback — 多种别名模式
        # 模式A: src_o + src_ol (wf21 warehouse)
        if 'warehouse_code' in new_q:
            for alias_o, alias_ol in [('src_o', 'src_ol'), ('src_o2', 'src_ol2')]:
                pattern = f"WHERE {alias_o}.sap_doc_num = ol.source_doc_number AND {alias_o}.company_code = o.company_code"
                if pattern in new_q and f"{alias_o}.doc_type = 'SO'" not in new_q:
                    new_q = new_q.replace(
                        pattern,
                        f"{pattern}\n     AND {alias_o}.doc_type = 'SO'"
                    )

        if new_q != q:
            n['parameters']['query'] = new_q
            changed = True
            print(f"  ✓ {label} '{n.get('name','')}' 已添加 doc_type='SO' 过滤")

    if not changed:
        print(f"  ⚠ {label} 无变化 (可能已修复)")
        return False

    # 按 skills SOP: 先 INSERT history, 再 UPDATE entity (四字段)
    new_ver = str(uuid.uuid4())
    nodes_json = json.dumps(nodes, ensure_ascii=False)
    conn_json = json.dumps(
        json.loads(conn_raw) if isinstance(conn_raw, str) else conn_raw,
        ensure_ascii=False
    )

    cur.execute("""
    INSERT INTO wf.workflow_history ("versionId", "workflowId", authors, nodes, connections, "createdAt", "updatedAt")
    VALUES (%s, %s, 'script', %s::json, %s::json, NOW(), NOW())
    """, (new_ver, wf_id, nodes_json, conn_json))

    cur.execute("""
    UPDATE wf.workflow_entity
    SET nodes = %s::json, "versionId" = %s, "activeVersionId" = %s, "updatedAt" = NOW()
    WHERE id = %s
    """, (nodes_json, new_ver, new_ver, wf_id))

    print(f"  ✓ {label} versionId = activeVersionId = {new_ver}")
    return True


# ============================================================
print("\n=== 修复 wf21 (OMS订单查询) ===")
wf21_changed = fix_workflow('%wf21%', 'wf21')

print("\n=== 修复 wf1c (SO查询) ===")
wf1c_changed = fix_workflow('%wf1c%', 'wf1c')

if wf21_changed or wf1c_changed:
    conn.commit()
    print("\n✅ 已提交")
else:
    print("\n⚠ 无变化")

# 验证
cur.execute("""
SELECT name,
  "versionId" = "activeVersionId" AS synced
FROM wf.workflow_entity
WHERE name LIKE '%wf21%' OR name LIKE '%wf1c%'
ORDER BY name
""")
for name, synced in cur.fetchall():
    print(f"  {name}: {'✓' if synced else '✗'} activeVersionId synced")

cur.close()
conn.close()
print("\n需要: docker restart dp-wf")
