# WSL 文件操作规范

> **创建**: 2026-02-24
> **场景**: Windows + WSL2 (Ubuntu-24.04) 混合开发环境

---

## 一、路径格式

### 仓库根目录含空格
仓库名为 `Digital Platform`，路径中有空格，**所有 Bash 命令必须双引号包裹**。

```bash
# 正确
ls "apps/wms/"
docker cp "apps/wf/wf04.json" dp-wf:/data/

# 错误 — 空格导致路径断裂
ls apps/wms/
```

### 当前工作目录
Claude Code 的 CWD 是 UNC 路径:
```
//wsl.localhost/Ubuntu-24.04/home/user/Digital Platform
```

- Read/Glob/Grep 工具: 使用 `//wsl.localhost/...` 前缀 **可以读取**
- Write/Edit 工具: 使用 `//wsl.localhost/...` **可能 EPERM 失败**
- Bash 工具: CWD 已在仓库根目录，直接用相对路径

---

## 二、文件写入权限问题

### 症状
```
EPERM: operation not permitted, open '\\wsl.localhost\...\file.html'
```

### 原因
Windows 进程 (Node.js/Claude Code) 通过 UNC 路径写入 WSL 文件系统时，
权限模型不匹配，导致 EPERM。

### 解决方案 (按优先级)

**方案 1: 通过 WSL root 执行** (推荐)
```bash
wsl -d Ubuntu-24.04 -u root -e bash -c '
cd "/home/user/Digital Platform"
sed -i "s/old/new/" "apps/wms/file.html"
'
```

**方案 2: 用 Python 写文件** (复杂替换时)
```bash
wsl -d Ubuntu-24.04 -u root -e bash -c 'python3 -c "
path = \"/home/user/Digital Platform/apps/wms/file.html\"
with open(path) as f: c = f.read()
c = c.replace(\"old\", \"new\")
with open(path, \"w\") as f: f.write(c)
print(\"done\")
"'
```

**方案 3: Python 脚本文件** (大量修改时)
```bash
# 1. 用 Write 工具创建脚本 (scripts/ 目录)
# 2. 通过 WSL 执行:
wsl -d Ubuntu-24.04 -u root -e bash -c 'python3 "Digital Platform/scripts/fix.py"'
# 3. 完成后删除脚本
```

### 绝对禁止
- **不要** 反复用 Write/Edit 工具试错 (EPERM 会一直失败)
- **不要** 用 Windows 的 sed/node 直接写 WSL 文件
- **不要** 猜测用户的绝对路径

---

## 三、WSL 路径映射陷阱

### docker exec 路径自动转换
Windows Git Bash 会把 `/tmp/` 自动映射为 `C:/Users/.../Temp/`:
```bash
# 错误 — Windows 自动转换路径
docker exec dp-wf cat /tmp/file.json
# 实际执行: cat C:/Program Files/Git/tmp/file.json

# 正确 — 使用 /data/ (docker volume 内路径)
docker exec dp-wf cat /data/file.json
```

### wsl -e 路径转换
```bash
# 错误 — Windows 路径被注入
wsl -d Ubuntu-24.04 -u root -e python3 "/home/user/Digital Platform/script.py"
# 实际变成: python3 /home/user/Digital Platform/C:/Program Files/Git/home/user/...

# 正确 — 用 bash -c 隔离
wsl -d Ubuntu-24.04 -u root -e bash -c 'python3 "/home/user/Digital Platform/script.py"'
```

---

## 四、文件读取策略

### 大文件分批读取
`shared.js` 和 `03_wms_tables.sql` 体量较大，超时时分批:
```
Read(file_path, offset=0, limit=200)
Read(file_path, offset=200, limit=200)
```

### Read vs Bash
- 读文件内容: **用 Read 工具** (不要 cat/head/tail)
- 搜索文件: **用 Grep/Glob 工具** (不要 find/grep 命令)
- 写文件: **用 WSL bash -c** (不要 Write/Edit 工具)
- 列目录: **用 Bash ls** (Read 工具不支持目录)

---

## 五、核心文件索引

| 用途 | 文件 | 备注 |
|------|------|------|
| 前端核心逻辑 | apps/wms/shared.js | 大文件，按需分段读 |
| 数据库表结构 | infrastructure/postgres/init/03_wms_tables.sql | 大文件 |
| 项目总纲 | CLAUDE.md | 架构规则 |
| 本地配置 | CLAUDE.local.md | 不提交 Git |
| 前端自托管库 | apps/wms/vendor/ | JsBarcode + QRCode |
| n8n 工作流 | apps/wf/wfXX-*.json | 用 CLI 同步到 n8n |

---

## 教训总结

| 要点 | 说明 |
|------|------|
| UNC 路径可读不可写 | Read 能用，Write/Edit 会 EPERM |
| 写文件走 WSL root | wsl -d Ubuntu-24.04 -u root -e bash -c |
| 路径必须双引号 | 仓库名含空格 |
| docker exec 避免 /tmp/ | Windows 自动转换，改用 /data/ |
| wsl -e 避免直接传路径 | 用 bash -c 包裹隔离 |
