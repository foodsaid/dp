# WMS n8n 工作流配置说明

> **版本**: v0.8.1 · **工作流**: 30 个 JSON + 16 个纯函数库
> **运行时**: n8n 2.x (dp-wf 主节点 + dp-wf-worker 执行节点)

## 统一模式

```
Webhook → Code(校验) → PostgreSQL(查询) → Code(转换) → Respond(JSON)
```

> v0.8+: wf1a~1e 已从 SAP MSSQL 切换到 PG OMS，wf20a 负责增量同步 SAP→PG。

## 数据库连接

| 类型 | Host | 用途 |
|------|------|------|
| PostgreSQL 17 | `dp-db:5432` | WMS/OMS Schema，凭证在 n8n 编辑器配置 |
| SAP B1 MS SQL | 由环境变量注入 | **仅同步** (wf20a)，必须加 `SET NOCOUNT ON` + `WITH(NOLOCK)` |

---

## 文件命名规范

```
wf{编号}-{功能}.json

  0a/0b    → 初始化工具 (一次性，默认停用)
  1a~1e    → 单据查询 (v0.8 PG OMS，按业务类型)
  02~09    → 核心业务 + 数据同步
  10~13    → 系统管理
  20~22    → OMS 订单管理
  20a~20c  → OMS 分批同步控制 (v0.7+)
```

---

## 工作流列表

### 初始化工具 (2 个，仅首次部署运行)

| 编号 | 文件 | 说明 | 激活 |
|------|------|------|------|
| 0a | `wf0a-init-masterdata.json` | SAP 主数据全量导入 | ⏸️ |
| 0b | `wf0b-init-inventory.json` | SAP 库存全量导入 | ⏸️ |

### OMS 单据查询 (5 个，v0.8 从 SAP MSSQL 切换到 PG OMS)

| 编号 | 文件 | Webhook | 数据源 | 激活 |
|------|------|---------|--------|------|
| 1a | `wf1a-wo-lookup.json` | `GET /wms/wo` | PG `oms.orders` (WO) | ✅ |
| 1b | `wf1b-po-lookup.json` | `GET /wms/po` | PG `oms.orders` + `order_lines` (PO) | ✅ |
| 1c | `wf1c-so-lookup.json` | `GET /wms/so` | PG `oms.orders` + `order_lines` (SO/DD) | ✅ |
| 1d | `wf1d-tr-lookup.json` | `GET /wms/tr` | PG `oms.orders` + `order_lines` (TR) | ✅ |
| 1e | `wf1e-pi-lookup.json` | `GET /wms/pi` | PG `oms.orders` + `order_lines` (WO BOM) | ✅ |

> **v0.8 变更**: wf1a~1e 不再直连 SAP MSSQL，改为查询 PG `oms.orders` + `oms.order_lines`（由 wf20a 增量同步）。
> `sync_status` 作为返回字段供前端展示，不作为查询过滤条件（查看与执行分离）。

### 核心业务 (4 个)

| 编号 | 文件 | Webhook | 激活 |
|------|------|---------|------|
| 02 | `wf02-transaction.json` | `POST /wms/transaction` | ✅ |
| 03 | `wf03-document-management.json` | `POST /wms/document/{create\|complete\|mark-exported}` | ✅ |
| 04 | `wf04-document-query.json` | `GET /wms/documents` · `GET /wms/document` | ✅ |
| 05 | `wf05-item-export-dashboard.json` | `GET /wms/{item\|export\|dashboard}` | ✅ |

### 数据同步 (5 个)

| 编号 | 文件 | 触发方式 | 激活 |
|------|------|---------|------|
| 06 | `wf06-items-sync.json` | Cron 20:00 + `POST /wms/sync/items` | ✅ |
| 07 | `wf07-locations-sync.json` | Cron 20:15 + `POST /wms/sync/locations` | ✅ |
| 08 | `wf08-stock-query.json` | `GET /wms/stock` | ✅ |
| 09 | `wf09-stock-snapshot.json` | Cron 22:00 + `POST /wms/sync/stock` | ✅ |
| 10 | `wf10-bin-sync.json` | Cron 21:15 + `POST /wms/sync/bins` | ✅ |

### 系统管理 (3 个)

| 编号 | 文件 | Webhook | 激活 |
|------|------|---------|------|
| 11 | `wf11-masterdata.json` | `GET /wms/masterdata` | ✅ |
| 12 | `wf12-bin-add.json` | `POST /wms/bin/add` | ✅ |
| 13 | `wf13-lock.json` | `POST /wms/lock/{acquire\|release}` · `GET /wms/lock/check` | ✅ |

### OMS 订单管理 (3 个，v0.1.14+)

| 编号 | 文件 | 触发方式 | 激活 |
|------|------|---------|------|
| 20 | `wf20-oms-sync.json` | 分批同步调度入口 (夜间定时 Cron 21:30) | ✅ |
| 21 | `wf21-oms-query.json` | `GET /wms/oms/orders` · `GET /wms/oms/order` | ✅ |
| 22 | `wf22-oms-dd.json` | `POST /wms/oms/dd/split` · `GET /wms/oms/dd/list` | ✅ |

### OMS 分批同步 (8 个，v0.7+)

> 分批拉取 SAP 历史订单，支持 SO/PO/WO/TR 四种类型，按月粒度断点续传。

| 编号 | 文件 | 说明 | 激活 |
|------|------|------|------|
| 20-so | `wf20-oms-sync-so.json` | SO 分批同步启动器 | ✅ |
| 20-po | `wf20-oms-sync-po.json` | PO 分批同步启动器 | ✅ |
| 20-wo | `wf20-oms-sync-wo.json` | WO 分批同步启动器 | ✅ |
| 20-tr | `wf20-oms-sync-tr.json` | TR 分批同步启动器 | ✅ |
| 20a | `wf20a-oms-sync-batch.json` | 批次执行器 (被启动器调用) | ✅ |
| 20b | `wf20b-oms-sync-status.json` | 进度查询 `GET /wms/oms/sync/status` | ✅ |
| 20c | `wf20c-oms-sync-stop.json` | 停止同步 `POST /wms/oms/sync/stop` | ✅ |
| 20d | `wf20d-oms-sync-verify.json` | 数量校验 `POST /wms/oms/sync/verify` (Layer2) | ✅ |
| — | `wf20-oms-sync.json` | 夜间定时统一入口 (见 OMS 管理行) | ✅ |

---

## 纯函数库 (lib/)

> v0.1.15+ 从 n8n Code 节点剥离，可独立单测 (`npm test`)。

| 文件 | 说明 | 对应工作流 |
|------|------|-----------|
| `wf02-tx-validator.js` | 事务提交校验 | wf02 |
| `wf03-doc-validator.js` | 单据管理校验 | wf03 |
| `wf04-doc-query.js` | 单据查询逻辑 | wf04 |
| `wf05-csv-builder.js` | CSV 导出构建 | wf05 |
| `wf08-stock-aggregator.js` | 库存 4 维聚合 | wf08 |
| `wf09-snapshot-engine.js` | 库存快照引擎 | wf09 |
| `wf11-masterdata-parser.js` | 主数据解析 | wf11 |
| `wf13-lock-machine.js` | 悲观锁状态机 | wf13 |
| `wf1c-so-parser.js` | SO 查询解析 (含 DD) | wf1c |
| `wf20-oms-mapper.js` | OMS 同步映射 | wf20 系列 |
| `wf21-query-builder.js` | OMS 查询构建 | wf21 |
| `wf22-mapper.js` | DD 拆单 mapper | wf22 |
| `wf-doc-param-extractor.js` | 单据参数提取 (共享) | wf1a~1e |
| `wf-merge-data.js` | 数据合并 (共享) | wf1a~1e |
| `wf-prefill-builder.js` | 预填 SQL 构建 (共享) | wf1a~1e |
| `wf-sync-helpers.js` | 同步辅助函数 (共享) | wf06~wf10 |

---

## 部署

### 方式 A: API 同步 (推荐)

```bash
N8N_API_KEY="your-api-key" python3 scripts/n8n-tools/sync-workflows.py
```

详见 `scripts/n8n-tools/README.md`

### 方式 B: n8n CLI 导入

```bash
# 1. 复制文件到容器
cd apps/wf && for f in wf*.json; do docker cp "./$f" "dp-wf:/tmp/wf-import/$f"; done

# 2. 添加 id 字段
docker cp scripts/n8n-tools/add-ids.js dp-wf:/tmp/
docker exec dp-wf node /tmp/add-ids.js /tmp/wf-import

# 3. 批量导入
docker exec dp-wf n8n import:workflow --separate --input=/tmp/wf-import/

# 4. 激活工作流
curl -X POST -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "http://localhost:${DP_WF_PORT}/api/v1/workflows/{id}/activate"
```

### 方式 C: n8n UI 手动导入

Workflows → Import from File → 选择 JSON → 配置凭证 → 激活

---

## 凭证配置

### PostgreSQL
所有工作流共用同一 PG 凭证，在 n8n 编辑器中按环境配置。

### SAP MS SQL
以下工作流需手动绑定 MS SQL 凭证:

| 工作流 | 涉及节点 |
|--------|---------|
| wf0a, wf0b (初始化) | 多个 SAP 查询节点 |
| ~~wf1a~1e~~ (v0.8 已切 PG) | — |
| wf05, wf06, wf07, wf09, wf10 (同步) | 各 SAP 查询节点 |
| wf20 系列 (OMS 同步) | SAP 订单查询节点 |

---

## 验证

```bash
# Dashboard (无需认证)
curl http://localhost:${DP_WF_PORT}/webhook/wms/dashboard
# 预期: {"success":true,"stats":{...}}

# SAP 单据查询 (需 MS SQL 凭证已配置)
curl "http://localhost:${DP_WF_PORT}/webhook/wms/wo?docnum=26000123"

# OMS 分批同步状态
curl "http://localhost:${DP_WF_PORT}/webhook/wms/oms/sync/status"
```

---

## 关键约束

- 所有 PG 操作首节点必须执行 `SELECT set_config('app.company_code', $env.DP_COMPANY_CODE, false)`
- SAP 查询只读，禁止写入，SQL 必须参数化 (防注入)
- `wms_audit_log` / `oms.audit_logs` 只增不删不改
- 时区使用 `$env.SYSTEM_TIMEZONE`，禁止硬编码
- 更新工作流必须走 API SOP，见 [CLAUDE.md](../../CLAUDE.md)
