#!/usr/bin/env python3
"""
检查并修复被 sync 覆盖为占位符的工作流凭据
1. 扫描所有 __CREDENTIAL_* 占位符
2. 从活跃的 wf20a 获取真实凭据 ID
3. 通过 n8n API 精确替换 + 重新激活
"""
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

ALLOWED_SETTINGS = {
    "executionOrder", "saveManualExecutions", "callerPolicy",
    "errorWorkflow", "timezone", "saveDataSuccessExecution",
    "saveDataErrorExecution", "saveExecutionProgress", "executionTimeout"
}


def run_sql(sql):
    r = subprocess.run(
        ["docker", "exec", "-i", "dp-db", "psql", "-U", DB_USER, "-d", DB_NAME, "-t", "-A"],
        input=sql, capture_output=True, text=True
    )
    return r.stdout.strip()


def docker_node(js_code):
    r = subprocess.run(
        ["docker", "exec", "dp-wf", "node", "-e", js_code],
        capture_output=True, text=True, timeout=30
    )
    return r.stdout.strip()


def n8n_get(path):
    js = f"""
const http=require('http');
const opts={{host:'localhost',port:5678,path:'{path}',method:'GET',
  headers:{{'X-N8N-API-KEY':'{API_KEY}'}}}};
http.request(opts,res=>{{let d='';res.on('data',c=>d+=c);
  res.on('end',()=>process.stdout.write(d))}}).end();
"""
    return json.loads(docker_node(js))


def n8n_post(path):
    js = f"""
const http=require('http');
const body='{{}}';
const opts={{host:'localhost',port:5678,path:'{path}',method:'POST',
  headers:{{'X-N8N-API-KEY':'{API_KEY}','Content-Type':'application/json',
  'Content-Length':Buffer.byteLength(body)}}}};
http.request(opts,res=>{{let d='';res.on('data',c=>d+=c);
  res.on('end',()=>process.stdout.write(d))}}).end(body);
"""
    out = docker_node(js)
    try: return json.loads(out)
    except: return out


def n8n_put_file(path, filepath_in_container):
    js = f"""
const http=require('http'),fs=require('fs');
const data=fs.readFileSync('{filepath_in_container}','utf8');
const opts={{host:'localhost',port:5678,path:'{path}',method:'PUT',
  headers:{{'X-N8N-API-KEY':'{API_KEY}','Content-Type':'application/json',
  'Content-Length':Buffer.byteLength(data)}}}};
http.request(opts,res=>{{let d='';res.on('data',c=>d+=c);
  res.on('end',()=>process.stdout.write(d))}}).end(data);
"""
    out = docker_node(js)
    try: return json.loads(out)
    except: return out


def get_real_cred_ids():
    """从活跃的 wf20a 获取真实凭据映射"""
    print("Step A: 从活跃 wf20a 获取真实凭据 ID")
    # wf20a 活跃 ID: 1xSnIxNFXCzhbOLY — 未被 sync 覆盖
    wf = n8n_get("/api/v1/workflows/1xSnIxNFXCzhbOLY")
    cred_map = {}
    for node in wf.get("nodes", []):
        creds = node.get("credentials", {})
        for ctype, cinfo in creds.items():
            if "__CREDENTIAL" not in str(cinfo.get("id", "")):
                cred_map[ctype] = cinfo
                print(f"  {ctype}: id={cinfo.get('id')}, name={cinfo.get('name')}")
    return cred_map


def replace_placeholders(nodes, cred_map):
    """替换节点列表中的 __CREDENTIAL_* 占位符"""
    changed = False
    for node in nodes:
        creds = node.get("credentials", {})
        for ctype, cinfo in list(creds.items()):
            cid = str(cinfo.get("id", ""))
            if "__CREDENTIAL" in cid:
                # 按类型匹配真实凭据
                if ctype in cred_map:
                    node["credentials"][ctype] = cred_map[ctype]
                    changed = True
                    print(f"    [{node.get('name')}] {ctype}: {cid} → {cred_map[ctype].get('id')}")
    return changed


def fix_workflow(wf_id, wf_name, cred_map):
    """获取工作流 → 替换凭据 → Deactivate → PUT → Activate"""
    print(f"\n  处理: {wf_name} (id={wf_id})")
    try:
        wf = n8n_get(f"/api/v1/workflows/{wf_id}")
        nodes = wf.get("nodes", [])
        changed = replace_placeholders(nodes, cred_map)
        if not changed:
            print("    ✅ 无占位符，跳过")
            return

        # 构建 PUT body
        allowed = {"name", "nodes", "connections", "settings", "staticData"}
        put_body = {k: v for k, v in wf.items() if k in allowed}
        if "settings" in put_body and isinstance(put_body["settings"], dict):
            put_body["settings"] = {k: v for k, v in put_body["settings"].items()
                                    if k in ALLOWED_SETTINGS}

        tmp = f"/tmp/wf-fix-{wf_id}.json"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(put_body, f, ensure_ascii=False)
        subprocess.run(["docker", "cp", tmp, f"dp-wf:{tmp}"],
                       capture_output=True, check=True)

        n8n_post(f"/api/v1/workflows/{wf_id}/deactivate")
        time.sleep(0.5)
        r = n8n_put_file(f"/api/v1/workflows/{wf_id}", tmp)
        if isinstance(r, dict) and r.get("id"):
            r2 = n8n_post(f"/api/v1/workflows/{wf_id}/activate")
            active = r2.get("active", "?") if isinstance(r2, dict) else "?"
            print(f"    ✅ 凭据已修复 + 重新激活 (active={active})")
        else:
            print(f"    ⚠️ PUT 失败: {str(r)[:200]}")
    except Exception as e:
        print(f"    ❌ 错误: {e}")


def main():
    print("=" * 60)
    print("扫描并修复被 sync 覆盖的占位符凭据")
    print("=" * 60)

    # 获取真实凭据映射 (从未被覆盖的 wf20a)
    cred_map = get_real_cred_ids()
    if not cred_map:
        print("❌ 无法获取真实凭据，终止")
        sys.exit(1)

    print(f"\n  共找到 {len(cred_map)} 种凭据类型")

    # 查询所有工作流
    print("\nStep B: 查询所有工作流 ID")
    rows = run_sql("SELECT id, name, active FROM wf.workflow_entity ORDER BY name")
    workflows = []
    for row in rows.split("\n"):
        parts = row.strip().split("|")
        if len(parts) >= 3:
            workflows.append({"id": parts[0], "name": parts[1], "active": parts[2] == "t"})

    print(f"  共 {len(workflows)} 个工作流")

    # 只处理 wf 开头的工作流 (跳过用户自定义工作流)
    wf_workflows = [w for w in workflows if w["name"].startswith("wf")]
    print(f"  其中 wf* 工作流: {len(wf_workflows)} 个")

    print("\nStep C: 逐个检查并修复占位符凭据")
    for wf in wf_workflows:
        fix_workflow(wf["id"], wf["name"], cred_map)

    print("\n" + "=" * 60)
    print("完成！所有 wf* 工作流的占位符凭据已修复。")


if __name__ == "__main__":
    main()
