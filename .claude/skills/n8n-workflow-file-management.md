# n8n 工作流文件管理规范

> **创建**: 2026-03-01
> **版本**: v2.0 (2026-03-23 新增: 更新已有工作流流程/wf20d/sync-workflows.py 使用限制)
> **背景**: apps/wf/ 目录必须与 Git 仓库严格一致，禁止存放 legacy 或临时工作流文件

---

## 一、核心规则

### 1.1 apps/wf/ 目录 = Git 唯一真相源

- `apps/wf/` 目录 **仅允许** 存放 Git 仓库中已跟踪的 30 个工作流 JSON
- **禁止** 将 n8n 导出的原始 JSON 直接丢进此目录
- **禁止** 在此目录存放备份文件、旧版本文件、测试文件或临时文件

### 1.2 合法文件清单 (30 个)

```
wf0a-init-masterdata.json      # 期初主数据灌库 (一次性)
wf0b-init-inventory.json       # 期初库存导入 (一次性)
wf02-transaction.json          # 事务提交
wf03-document-management.json  # 单据管理
wf04-document-query.json       # 单据查询
wf05-item-export-dashboard.json # 物料/导出/仪表板
wf06-items-sync.json           # 物料缓存同步
wf07-locations-sync.json       # 仓库缓存同步
wf08-stock-query.json          # 库存查询
wf09-stock-snapshot.json       # 库存快照同步
wf10-bin-sync.json             # 库位缓存同步
wf11-masterdata.json           # 主数据查询
wf12-bin-add.json              # 新增库位
wf13-lock.json                 # 单据锁管理
wf1a-wo-lookup.json            # WO 查询
wf1b-po-lookup.json            # PO 查询
wf1c-so-lookup.json            # SO 查询
wf1d-tr-lookup.json            # TR 查询
wf1e-pi-lookup.json            # PI 查询
wf20-oms-sync.json             # OMS 夜间全量同步 (Cron 21:00~21:45)
wf20-oms-sync-so.json          # OMS SO 手动同步启动器
wf20-oms-sync-po.json          # OMS PO 手动同步启动器
wf20-oms-sync-wo.json          # OMS WO 手动同步启动器
wf20-oms-sync-tr.json          # OMS TR 手动同步启动器
wf20a-oms-sync-batch.json      # OMS 分批执行器 (事件驱动+兜底)
wf20b-oms-sync-status.json     # OMS 同步进度查询
wf20c-oms-sync-stop.json       # OMS 同步停止
wf20d-oms-sync-verify.json     # OMS 同步验证/校对 (2026-03 新增)
wf21-oms-query.json            # OMS 订单查询
wf22-oms-dd.json               # OMS DD 拆单管理
```

### 1.3 新增工作流的流程

1. 按命名规范确定编号: `wf{编号}-{功能}.json`
2. 在 n8n 编辑器中开发、测试
3. 在 n8n 编辑器中手动导出 JSON 到 `apps/wf/`（**禁止**使用 `sync-workflows.py` 导出——会覆盖 DB 中线上修改）
4. **必须** 凭据脱敏 (使用占位符替换真实凭据 ID)
5. 更新本文件合法清单 + CLAUDE.md 中的工作流一览表
6. Git 提交

### 1.4 更新已有工作流的流程 (git pull 后)

> ⛔ **绝对禁止**直接运行 `sync-workflows.py` 更新线上工作流（旧版会删除所有 wf* 历史记录）

```bash
# 0. 加载 .env (Linux / macOS / WSL2 通用)
set -a; source .env; set +a

# 1. 查看哪些文件发生了变更
git diff --name-only HEAD~1 HEAD apps/wf/

# 2. 运行 sync-workflows.py (v2.0 安全模式: 仅操作 wf*.json 对应工作流，保护 legacy)
#    脚本自动读取 .env，无需手动传参
python3 scripts/n8n-tools/sync-workflows.py

# 3. 激活前必须检查凭据占位符 (有结果则停止修复再激活)
#    DP_DB_USER / DP_DB_NAME 来自 .env，不同公司/平台值不同
docker exec dp-db psql -U "${DP_DB_USER:-dp_app}" -d "${DP_DB_NAME:-dp}" \
  -c "SELECT name FROM wf.workflow_entity WHERE nodes::text LIKE '%__CREDENTIAL_%__%';"
```

完整 SOP（含 source .env 方法/凭据修复 SQL/端口说明）见 `n8n-database-operations.md` → "git pull 后工作流更新 SOP"

### 1.5 删除工作流的流程

1. 确认工作流已在 n8n 中停用
2. 从 `apps/wf/` 删除 JSON 文件
3. 更新 CLAUDE.md 中的工作流一览表
4. Git 提交

---

## 二、禁止事项

| # | 禁止行为 | 原因 |
|---|---------|------|
| 1 | 在 apps/wf/ 存放 n8n 全量导出 (legacy JSON) | 污染仓库，与项目工作流混淆 |
| 2 | 保留已废弃的工作流文件 | 增加维护成本，误导开发者 |
| 3 | 工作流 JSON 中包含真实凭据 ID | 跨环境部署失败，安全风险 |
| 4 | 不更新 CLAUDE.md 就增删工作流 | 文档与代码不同步 |
| 5 | 将备份文件 (.bak / _old / _backup) 放入 wf/ | 使用 Git 历史追溯，不靠文件副本 |
| 6 | 用 `sync-workflows.py` 更新生产工作流 (非全新环境) | v2.0 前会删除所有工作流含 legacy；生产更新必须先盘点 DB 工作流清单 |

---

## 三、备份与恢复

- **修改前备份**: 使用 Git (提交或 stash)，不在 wf/ 目录创建副本文件
- **临时备份**: 如需 n8n API 全量导出，放到项目根目录以外或 `.claude_backup/` (已在 .gitignore)
- **恢复**: 从 Git 历史 `git checkout <commit> -- apps/wf/xxx.json`

---

## 四、凭据脱敏占位符 (8 类)

工作流 JSON 提交到 Git 前，凭据 ID 必须替换为占位符:

```
__CREDENTIAL_PG_WMS__        # PostgreSQL WMS 数据库
__CREDENTIAL_PG_WF__         # PostgreSQL WF 数据库
__CREDENTIAL_MSSQL_SAP__     # MS SQL SAP 数据库
__CREDENTIAL_SAP_SL__        # SAP Service Layer
__CREDENTIAL_REDIS_WF__      # Redis WF 队列
__CREDENTIAL_REDIS_BI__      # Redis BI 缓存
__CREDENTIAL_SMTP__          # 邮件服务
__CREDENTIAL_HTTP_BASIC__    # HTTP Basic Auth
```

部署到新环境时，`sync-workflows.py` (v2.0+) 会自动替换占位符为实际凭据 ID（须在 `.env` 中配置 `DP_CREDENTIAL_PG_ID/NAME` 和 `DP_CREDENTIAL_MSSQL_ID/NAME`）。
**更新已有工作流时，导入后必须在激活前检查并手动修复 DB 中的占位符**（SQL 方法见 `n8n-database-operations.md`）。

---

## 变更日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-03-01 | v1.0 | 初始创建: 基于 legacy 文件污染事件总结规范 |
| 2026-03-23 | v2.0 | 新增: 更新已有工作流 SOP (1.4) / wf20d / sync-workflows.py 限制 / 禁止事项 #6 / 凭据检查说明 |
