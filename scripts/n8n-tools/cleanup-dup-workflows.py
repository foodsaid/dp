#!/usr/bin/env python3
"""查询并清理 wf20 系列重复工作流"""
import json, os, subprocess, sys, time

# === 自动加载 .env (优先级: 环境变量 > .env 文件 > 默认值) ===
def _load_dotenv():
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    env_file = os.path.join(repo_root, ".env")
    if not os.path.exists(env_file):
        return
    with open(env_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val
_load_dotenv()

API_KEY = os.environ.get("N8N_API_KEY", "")
DB_USER = os.environ.get("DP_DB_USER", "dp_app")
DB_NAME = os.environ.get("DP_DB_NAME", "dp")

if not API_KEY:
    print("❌ 请设置 N8N_API_KEY 环境变量 (或在 .env 文件中配置)")
    sys.exit(1)

def run_sql(sql):
    r = subprocess.run(
        ["docker", "exec", "-i", "dp-db", "psql", "-U", DB_USER, "-d", DB_NAME, "-t", "-A"],
        input=sql, capture_output=True, text=True, timeout=10
    )
    return r.stdout.strip()

def docker_node(js):
    r = subprocess.run(["docker", "exec", "dp-wf", "node", "-e", js],
                       capture_output=True, text=True, timeout=30)
    return r.stdout.strip()

def n8n_post(path):
    js = f"""const http=require('http');const body='{{}}';
const opts={{host:'localhost',port:5678,path:'{path}',method:'POST',
headers:{{'X-N8N-API-KEY':'{API_KEY}','Content-Type':'application/json',
'Content-Length':Buffer.byteLength(body)}}}};
http.request(opts,res=>{{let d='';res.on('data',c=>d+=c);
res.on('end',()=>process.stdout.write(d))}}).end(body);"""
    out = docker_node(js)
    try: return json.loads(out)
    except: return out

def n8n_delete(wf_id):
    js = f"""const http=require('http');
const opts={{host:'localhost',port:5678,path:'/api/v1/workflows/{wf_id}',method:'DELETE',
headers:{{'X-N8N-API-KEY':'{API_KEY}'}}}};
http.request(opts,res=>{{let d='';res.on('data',c=>d+=c);
res.on('end',()=>process.stdout.write(d))}}).end();"""
    out = docker_node(js)
    try: return json.loads(out)
    except: return out

# 查询所有 wf* 工作流
rows = run_sql("SELECT name, active, id FROM wf.workflow_entity ORDER BY name")
workflows = []
for row in rows.split("\n"):
    parts = row.strip().split("|")
    if len(parts) >= 3 and parts[0].startswith("wf"):
        workflows.append({"name": parts[0], "active": parts[1] == "t", "id": parts[2]})

print(f"当前 wf* 工作流共 {len(workflows)} 个:\n")
for w in workflows:
    status = "✅ 激活" if w["active"] else "❌ 停用"
    print(f"  {status} | {w['name'][:40]:<40} | {w['id']}")

# 找出按名称重复的
from collections import defaultdict
by_name = defaultdict(list)
for w in workflows:
    by_name[w["name"]].append(w)

dups = {name: items for name, items in by_name.items() if len(items) > 1}
print(f"\n发现 {len(dups)} 个重复工作流名称:")
for name, items in sorted(dups.items()):
    for item in items:
        print(f"  {'激活' if item['active'] else '停用'} | {name[:35]:<35} | {item['id']}")

# 清理: 对于重复对，停用并删除短 ID 副本 (sync 产生的)
# 短 ID = 10 位十六进制, 长 ID = 更长的字母数字 (n8n 原生)
print("\n清理重复短 ID 副本 (sync 产生的):")
deleted = 0
for name, items in sorted(dups.items()):
    # 按 ID 长度分: 10 位 hex = 短 ID (sync 产生), 更长 = n8n 原生
    short_id_items = [i for i in items if len(i["id"]) == 10]
    long_id_items  = [i for i in items if len(i["id"]) != 10]
    if short_id_items and long_id_items:
        for item in short_id_items:
            print(f"  删除短 ID 副本: {name[:35]} | {item['id']} (active={item['active']})")
            if item["active"]:
                n8n_post(f"/api/v1/workflows/{item['id']}/deactivate")
                time.sleep(0.3)
            r = n8n_delete(item["id"])
            if isinstance(r, dict) and r.get("success"):
                print(f"    ✅ 删除成功")
                deleted += 1
            else:
                print(f"    ⚠️ 删除结果: {str(r)[:100]}")

print(f"\n共删除 {deleted} 个重复副本")

# 确认活跃工作流
print("\n最终状态 (wf* 仅激活):")
rows2 = run_sql("SELECT name, active, id FROM wf.workflow_entity ORDER BY name")
for row in rows2.split("\n"):
    parts = row.strip().split("|")
    if len(parts) >= 3 and parts[0].startswith("wf") and parts[1] == "t":
        print(f"  ✅ {parts[0][:50]:<50} | {parts[2]}")
