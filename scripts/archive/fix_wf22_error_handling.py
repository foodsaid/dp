#!/usr/bin/env python3
"""
为 wf22 执行拆单 节点添加 onError 错误处理
- 执行拆单: 添加 onError="continueErrorOutput"
- 新增 DB错误响应 节点: 捕获错误并返回 JSON
- 连接: 执行拆单 error output → DB错误响应
解决问题: DD创建失败时 webhook 挂起 (无响应/卡)
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
DB_NAME = env_vars.get('DP_DB_NAME', env_vars.get('DB_POSTGRESDB_DATABASE', 'dp'))
DB_USER = env_vars.get('DP_DB_USER', env_vars.get('DB_POSTGRESDB_USER', 'dp_app'))
DB_PASS = env_vars.get('DP_DB_PASSWORD', env_vars.get('DB_POSTGRESDB_PASSWORD', ''))

print(f"[DB] 连接 {DB_HOST}:{DB_PORT}/{DB_NAME} as {DB_USER}")
conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASS)
conn.autocommit = False
cur = conn.cursor()

cur.execute("SELECT id, nodes, connections, \"versionId\", \"activeVersionId\" FROM wf.workflow_entity WHERE name LIKE '%wf22%' LIMIT 1")
row = cur.fetchone()
if not row:
    print("ERROR: 未找到 wf22")
    sys.exit(1)

wf_id, nodes_raw, conn_raw, ver_id, active_ver_id = row
nodes = json.loads(nodes_raw) if isinstance(nodes_raw, str) else nodes_raw
connections = json.loads(conn_raw) if isinstance(conn_raw, str) else conn_raw

print(f"  wf22 id={wf_id}, versionId={ver_id}, activeVersionId={active_ver_id}")

# ============================================================
# 1. 给 执行拆单 节点添加 onError
# ============================================================
changed = False
for n in nodes:
    if n.get('name') == '执行拆单':
        if n.get('onError') != 'continueErrorOutput':
            n['onError'] = 'continueErrorOutput'
            changed = True
            print("  ✓ 执行拆单: 添加 onError=continueErrorOutput")
        else:
            print("  ⚠ 执行拆单: 已有 onError")
        break
else:
    print("  ERROR: 未找到 执行拆单 节点")
    sys.exit(1)

# ============================================================
# 2. 添加 DB错误响应 节点 (如果不存在)
# ============================================================
err_node_name = 'DB错误响应'
has_err_node = any(n.get('name') == err_node_name for n in nodes)
if not has_err_node:
    # 放在 执行拆单 下方 (y+200)
    err_node = {
        "parameters": {
            "respondWith": "json",
            "responseBody": "={{ JSON.stringify({ success: false, message: '数据库错误: ' + ($json.error ? ($json.error.message || JSON.stringify($json.error)) : '未知错误') }) }}",
            "options": {}
        },
        "id": "o2200001-0001-0001-0001-000000000012",
        "name": err_node_name,
        "type": "n8n-nodes-base.respondToWebhook",
        "typeVersion": 1.1,
        "position": [1320, 700]
    }
    nodes.append(err_node)
    changed = True
    print(f"  ✓ 添加节点: {err_node_name}")
else:
    print(f"  ⚠ {err_node_name}: 已存在")

# ============================================================
# 3. 添加连接: 执行拆单 error output → DB错误响应
# ============================================================
exec_conn = connections.get('执行拆单', {}).get('main', [])
# 执行拆单 现有连接: main[0] → 成功响应
# 需要添加: main[1] → DB错误响应 (error output)
if len(exec_conn) < 2:
    # 确保 main[0] 存在
    while len(exec_conn) < 1:
        exec_conn.append([])
    # 添加 main[1] = error output → DB错误响应
    exec_conn.append([{
        "node": err_node_name,
        "type": "main",
        "index": 0
    }])
    if '执行拆单' not in connections:
        connections['执行拆单'] = {"main": exec_conn}
    else:
        connections['执行拆单']['main'] = exec_conn
    changed = True
    print(f"  ✓ 连接: 执行拆单 [error] → {err_node_name}")
else:
    print(f"  ⚠ 执行拆单 已有 error output 连接")

if not changed:
    print("\n  无变化")
    cur.close()
    conn.close()
    sys.exit(0)

# ============================================================
# 4. 保存到 DB (按 skills SOP: 先 INSERT history，再 UPDATE entity)
# ============================================================
new_ver = str(uuid.uuid4())
nodes_json = json.dumps(nodes, ensure_ascii=False)
conn_json = json.dumps(connections, ensure_ascii=False)

# 4a. 先插入 history
cur.execute("""
INSERT INTO wf.workflow_history ("versionId", "workflowId", authors, nodes, connections, "createdAt", "updatedAt")
VALUES (%s, %s, 'script', %s::json, %s::json, NOW(), NOW())
""", (new_ver, wf_id, nodes_json, conn_json))
print(f"  ✓ workflow_history: 插入 versionId={new_ver}")

# 4b. 再更新 entity (四个字段全部更新)
cur.execute("""
UPDATE wf.workflow_entity
SET nodes = %s::json,
    connections = %s::json,
    "versionId" = %s,
    "activeVersionId" = %s,
    "updatedAt" = NOW()
WHERE id = %s
""", (nodes_json, conn_json, new_ver, new_ver, wf_id))
print(f"  ✓ workflow_entity: 更新 versionId + activeVersionId")

conn.commit()
print(f"\n✅ wf22 错误处理修复完成，versionId: {new_ver}")
print("  需要: docker restart dp-wf")

cur.close()
conn.close()
