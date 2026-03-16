#!/usr/bin/env python3
"""
n8n 工作流同步脚本: 删除旧工作流 → 重新导入 → 激活
用法: python3 scripts/n8n-tools/sync-workflows.py

前置条件:
  - dp-wf 和 dp-db 容器运行中
  - apps/wf/ 目录下有所有 wf*.json 文件
  - n8n API Key 已在 wf.user_api_keys 表中创建
"""
import json, os, subprocess, time, hashlib, urllib.request, sys

# === 配置 (从环境变量或默认值) ===
WF_DIR = os.environ.get("WF_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "apps", "wf"))
DB_USER = os.environ.get("DP_DB_USER", os.environ.get("DB_USER", "dp_app"))
DB_NAME = os.environ.get("DP_DB_NAME", os.environ.get("DB_NAME", "dp"))
N8N_CONTAINER = os.environ.get("N8N_CONTAINER", "dp-wf")
DB_CONTAINER = os.environ.get("DB_CONTAINER", "dp-db")
API_PORT = os.environ.get("N8N_API_PORT", "5678")
API_KEY = os.environ.get("N8N_API_KEY", "")

def run(cmd, check=True):
    """执行命令 (安全: 使用列表模式避免 shell 注入)"""
    if isinstance(cmd, str):
        import shlex
        cmd = shlex.split(cmd)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if check and r.returncode != 0 and r.stderr.strip():
        print(f"  ⚠️ {r.stderr.strip()[:200]}")
    return r

def psql(sql):
    """执行 SQL 查询并返回结果 (安全: 通过 stdin 传递 SQL 避免注入)"""
    cmd = ["docker", "exec", "-i", DB_CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME, "-t", "-A"]
    r = subprocess.run(cmd, input=sql, capture_output=True, text=True)
    if r.returncode != 0 and r.stderr.strip():
        print(f"  ⚠️ {r.stderr.strip()[:200]}")
    return r.stdout.strip()

def psql_exec(sql):
    """执行 SQL 语句 (安全: 通过 stdin 传递 SQL 避免注入)"""
    cmd = ["docker", "exec", "-i", DB_CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME]
    return subprocess.run(cmd, input=sql, capture_output=True, text=True)

def main():
    if not API_KEY:
        print("❌ 请设置 N8N_API_KEY 环境变量")
        print("   获取方式: n8n UI → Settings → API → Create API Key")
        sys.exit(1)

    os.chdir(WF_DIR)
    wf_files = sorted([f for f in os.listdir(".") if f.endswith(".json") and f.startswith("wf")])
    print(f"找到 {len(wf_files)} 个工作流文件\n")

    # === 1. 删除旧工作流 ===
    print("=== 步骤 1: 删除所有旧工作流 ===")
    old_ids = psql("SELECT id FROM wf.workflow_entity")
    if old_ids:
        ids_list = [i for i in old_ids.split('\n') if i.strip()]
        ids_sql = ",".join([f"'{i}'" for i in ids_list])
        for tbl in ['webhook_entity', 'workflow_statistics', 'shared_workflow',
                     'workflow_publish_history', 'workflow_published_version',
                     'workflow_history', 'workflow_dependency']:
            psql_exec(f"DELETE FROM wf.{tbl} WHERE \"workflowId\" IN ({ids_sql})")
        psql_exec(f"DELETE FROM wf.workflow_entity WHERE id IN ({ids_sql})")
        print(f"  ✅ 已删除 {len(ids_list)} 个旧工作流")
    else:
        print("  ℹ️ 无旧工作流")

    # === 2. 重启 n8n ===
    print("\n=== 步骤 2: 重启 n8n ===")
    run(["docker", "restart", N8N_CONTAINER])
    for i in range(15):
        time.sleep(2)
        r = run(["docker", "exec", N8N_CONTAINER, "wget", "-q", "-O-", f"http://localhost:{API_PORT}/healthz"], check=False)
        if '"ok"' in r.stdout:
            print("  ✅ n8n 已启动")
            break
    else:
        print("  ⚠️ n8n 启动超时")

    # === 3. 复制文件 + 添加 ID ===
    print("\n=== 步骤 3: 复制文件到容器 ===")
    run(["docker", "exec", N8N_CONTAINER, "rm", "-rf", "/tmp/wf-import"])
    run(["docker", "exec", N8N_CONTAINER, "mkdir", "-p", "/tmp/wf-import"])
    for f in wf_files:
        with open(f, "r", encoding="utf-8") as fp:
            data = json.load(fp)
        data["id"] = hashlib.md5(f.encode()).hexdigest()[:10]
        tmp = f"/tmp/_wf_tmp_{f}"
        with open(tmp, "w", encoding="utf-8") as fp:
            json.dump(data, fp, indent=2, ensure_ascii=False)
        run(["docker", "cp", tmp, f"{N8N_CONTAINER}:/tmp/wf-import/{f}"])
        os.remove(tmp)
    print(f"  ✅ 已复制 {len(wf_files)} 个文件")

    # === 4. CLI 导入 ===
    print("\n=== 步骤 4: n8n CLI 导入 ===")
    r = run(["docker", "exec", N8N_CONTAINER, "sh", "-c", "cd /tmp/wf-import && n8n import:workflow --separate --input=/tmp/wf-import/"])
    for line in r.stdout.strip().split('\n'):
        print(f"  {line}")

    # === 5. API 激活 ===
    print("\n=== 步骤 5: API 激活 ===")
    activated = 0
    for f in wf_files:
        with open(f, "r", encoding="utf-8") as fp:
            data = json.load(fp)
        wf_id = hashlib.md5(f.encode()).hexdigest()[:10]
        if data.get("active", False):
            url = f"http://localhost:{API_PORT}/api/v1/workflows/{wf_id}/activate"
            req = urllib.request.Request(url, method="POST", headers={"X-N8N-API-KEY": API_KEY})
            try:
                resp = urllib.request.urlopen(req)
                resp_data = json.loads(resp.read())
                if resp_data.get("active"):
                    print(f"  ✅ {data.get('name', f)}")
                    activated += 1
            except Exception as e:
                print(f"  ❌ {data.get('name', f)} -> {str(e)[:100]}")
    print(f"\n  激活: {activated}/{len(wf_files)}")

    # === 6. 清理 + 验证 ===
    run(["docker", "exec", N8N_CONTAINER, "rm", "-rf", "/tmp/wf-import"])
    print("\n=== 最终验证 ===")
    result = psql("SELECT CASE WHEN active THEN '✅' ELSE '⏸' END || ' ' || name FROM wf.workflow_entity ORDER BY name")
    for line in result.split('\n'):
        if line.strip():
            print(f"  {line}")
    total = psql("SELECT COUNT(*) FROM wf.workflow_entity")
    active_c = psql("SELECT COUNT(*) FROM wf.workflow_entity WHERE active=true")
    wh_c = psql("SELECT COUNT(*) FROM wf.webhook_entity")
    print(f"\n  总计: {total} 工作流, {active_c} 激活, {wh_c} webhook")

if __name__ == "__main__":
    main()
