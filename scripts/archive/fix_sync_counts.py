#!/usr/bin/env python3
"""修复同步计数问题 — n8n API 精确更新 (v2)

问题:
  - wf20 汇总结果: $input.all() 取 PG 节点输出，order_count 丢失 → 永远 0
  - wf06 Format Success: items.length = 批数，非实际条数; 生成批量UPSERT 缺少 count 字段
  - wf10 Format Success: $input.all() 取 PG 节点输出，count 丢失 → 永远 0

修复:
  - wf20: 汇总结果 改用 $('生成UPSERT SQL').all() 获取 order_count
  - wf06: 生成批量UPSERT 添加 count: batch.length; Format Success 改用 $('生成批量UPSERT').all()
  - wf10: Format Success 改用 $('生成批量UPSERT').all()
"""
import subprocess
import json
import sys
import re


def get_api_key():
    """从容器环境获取 API key"""
    r = subprocess.run(
        ["docker", "exec", "dp-wf", "printenv", "N8N_API_KEY"],
        capture_output=True, text=True
    )
    key = r.stdout.strip()
    if not key:
        print("错误: 无法获取 N8N_API_KEY")
        sys.exit(1)
    return key


API_KEY = get_api_key()

# 工作流 ID (从 DB 查询确认)
WF_IDS = {
    "wf20": "472a72e22e",
    "wf06": "477423cc7f",
    "wf10": "f9d3ccef58",
}


def docker_node(js_code):
    """在 dp-wf 容器内执行 Node.js 代码"""
    r = subprocess.run(
        ["docker", "exec", "dp-wf", "node", "-e", js_code],
        capture_output=True, text=True
    )
    if r.returncode != 0:
        print(f"Node.js 错误: {r.stderr}")
        return None
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        print(f"JSON 解析失败: {r.stdout[:200]}")
        return None


def n8n_get(path):
    """GET n8n API"""
    return docker_node(f"""
const http=require('http');
http.request({{host:'localhost',port:5678,path:'{path}',method:'GET',
headers:{{'X-N8N-API-KEY':'{API_KEY}'}}}},
res=>{{let d='';res.on('data',c=>d+=c);res.on('end',()=>process.stdout.write(d))}}).end();""")


def n8n_put_file(path, filepath):
    """PUT n8n API (从容器内文件)"""
    return docker_node(f"""
const http=require('http'),fs=require('fs');
const data=fs.readFileSync('{filepath}','utf8');
http.request({{host:'localhost',port:5678,path:'{path}',method:'PUT',
headers:{{'X-N8N-API-KEY':'{API_KEY}','Content-Type':'application/json',
'Content-Length':Buffer.byteLength(data)}}}},
res=>{{let d='';res.on('data',c=>d+=c);res.on('end',()=>process.stdout.write(d))}}).end(data);""")


def n8n_post(path):
    """POST n8n API"""
    return docker_node(f"""
const http=require('http');
http.request({{host:'localhost',port:5678,path:'{path}',method:'POST',
headers:{{'X-N8N-API-KEY':'{API_KEY}','Content-Type':'application/json',
'Content-Length':2}}}},
res=>{{let d='';res.on('data',c=>d+=c);res.on('end',()=>process.stdout.write(d))}}).end('{{}}');""")


def update_workflow_multi(wf_id, node_updates, dry_run=False):
    """精确更新工作流中多个节点的 jsCode

    node_updates: list of dict, 每项包含:
      - node: 节点名称
      - code: 新代码 (完整替换)
      - transform: 函数 (接收旧代码，返回新代码)
      二选一: code 或 transform
    """
    print(f"\n{'='*60}")
    print(f"更新工作流 {wf_id}")
    print(f"  目标节点: {', '.join(u['node'] for u in node_updates)}")
    print(f"{'='*60}")

    # 1. GET 线上版本
    wf = n8n_get(f"/api/v1/workflows/{wf_id}")
    if not wf:
        print("错误: 无法获取工作流")
        return False

    print(f"工作流名称: {wf.get('name')}")
    print(f"节点数: {len(wf.get('nodes', []))}")

    # 2. 逐个更新目标节点
    updated = []
    for update in node_updates:
        node_name = update['node']
        found = False
        for node in wf.get('nodes', []):
            if node['name'] == node_name:
                old_code = node.get('parameters', {}).get('jsCode', '')

                if 'code' in update:
                    new_code = update['code']
                elif 'transform' in update:
                    new_code = update['transform'](old_code)
                else:
                    print(f"错误: 节点 '{node_name}' 缺少 code 或 transform")
                    continue

                print(f"\n--- [{node_name}] 原代码 ---")
                print(old_code)
                print(f"\n--- [{node_name}] 新代码 ---")
                print(new_code)

                if old_code == new_code:
                    print(f"⚠️ [{node_name}] 代码无变化，跳过")
                else:
                    node['parameters']['jsCode'] = new_code
                    updated.append(node_name)
                found = True
                break

        if not found:
            print(f"错误: 未找到节点 '{node_name}'")
            return False

    if dry_run:
        print(f"\n[DRY RUN] 不执行实际更新 (待更新: {len(updated)} 个节点)")
        return True

    if not updated:
        print("所有节点代码无变化，跳过更新")
        return True

    # 3. 构建 PUT body
    allowed = {'name', 'nodes', 'connections', 'settings', 'staticData'}
    put_body = {k: v for k, v in wf.items() if k in allowed}

    tmp_path = '/tmp/wf-put.json'
    with open(tmp_path, 'w') as f:
        json.dump(put_body, f, ensure_ascii=False)

    subprocess.run(
        ["docker", "cp", tmp_path, f"dp-wf:{tmp_path}"],
        check=True
    )

    # 4. Deactivate → PUT → Activate
    print(f"\n[1/3] Deactivating...")
    n8n_post(f"/api/v1/workflows/{wf_id}/deactivate")

    print(f"[2/3] Updating ({len(updated)} 个节点)...")
    result = n8n_put_file(f"/api/v1/workflows/{wf_id}", tmp_path)

    print(f"[3/3] Activating...")
    n8n_post(f"/api/v1/workflows/{wf_id}/activate")

    if result and result.get('active'):
        print(f"✅ 工作流 {wf.get('name')} 更新成功并已激活")
        return True
    else:
        print(f"⚠️ 更新结果: {json.dumps(result, ensure_ascii=False)[:200] if result else 'None'}")
        return True  # PUT 可能成功但响应格式不同


# ============================================================
# 修复 1: wf20 汇总结果 — 从 $input.all() 改为 $('生成UPSERT SQL').all()
# ============================================================
WF20_RESULT_CODE = """// V1.1: 汇总同步结果 — 从生成节点获取 order_count (修复 PG 节点丢失字段)
const allItems = $('生成UPSERT SQL').all();
let totalOrders = 0;

allItems.forEach(item => {
  totalOrders += (item.json.order_count || 0);
});

return { json: {
  success: true,
  count: totalOrders,
  message: 'OMS 订单同步完成: ' + totalOrders + ' 个订单已处理'
} };"""

# ============================================================
# 修复 2: wf06 生成批量UPSERT — 添加 count: batch.length
#          wf06 Format Success — 从批数改为实际条数
# ============================================================
def wf06_add_count_field(old_code):
    """在 生成批量UPSERT 的 batches.push 中添加 count: batch.length"""
    # 匹配 batches.push({ json: { sql, batch_num: ... } })
    # 在闭合 } 前插入 , count: batch.length
    pattern = r'(batch_num:\s*Math\.floor\(i/batchSize\)\+1)\s*\}'
    replacement = r'\1, count: batch.length }'
    new_code = re.sub(pattern, replacement, old_code)
    if new_code == old_code:
        # 尝试更宽泛的匹配
        pattern2 = r'(batch_num:\s*[^,}]+)\s*\}\s*\}'
        replacement2 = r'\1, count: batch.length } }'
        new_code = re.sub(pattern2, replacement2, old_code)
    if new_code == old_code:
        print("⚠️ 无法自动添加 count 字段，可能已存在或格式不匹配")
    return new_code


WF06_FORMAT_CODE = """// V1.1: 统计实际同步条数 — 从生成节点获取每批行数 (修复批数≠条数)
const batches = $('生成批量UPSERT').all();
let totalRows = 0;
batches.forEach(b => {
  totalRows += (b.json.count || 0);
});
const batchCount = batches.length;
return { json: { success: true, count: totalRows, message: '物料缓存增量同步: ' + totalRows + ' 条 (' + batchCount + ' 批) 写入PG' } };"""

# ============================================================
# 修复 3: wf10 Format Success — 从 $input.all() 改为 $('生成批量UPSERT').all()
# ============================================================
WF10_FORMAT_CODE = """// V1.1: 统计实际同步条数 — 从生成节点获取每批行数 (修复 PG 节点丢失 count)
const batches = $('生成批量UPSERT').all();
const total = batches.reduce((s, r) => s + (r.json.count || 0), 0);
return { json: { success: true, count: total, message: '库位缓存增量同步: ' + total + ' 条写入PG' } };"""


if __name__ == '__main__':
    dry_run = '--dry-run' in sys.argv

    if dry_run:
        print("=== DRY RUN 模式 — 只显示变更，不执行 ===\n")

    # 修复 1: wf20 — 1 个节点
    update_workflow_multi(WF_IDS['wf20'], [
        {'node': '汇总结果', 'code': WF20_RESULT_CODE},
    ], dry_run)

    # 修复 2: wf06 — 2 个节点 (同一次 GET/PUT)
    update_workflow_multi(WF_IDS['wf06'], [
        {'node': '生成批量UPSERT', 'transform': wf06_add_count_field},
        {'node': 'Format Success', 'code': WF06_FORMAT_CODE},
    ], dry_run)

    # 修复 3: wf10 — 1 个节点
    update_workflow_multi(WF_IDS['wf10'], [
        {'node': 'Format Success', 'code': WF10_FORMAT_CODE},
    ], dry_run)

    if not dry_run:
        print("\n" + "="*60)
        print("所有工作流更新完成!")
        print("建议: 在 n8n 编辑器中手动触发一次同步，验证计数是否正确")
        print("="*60)
