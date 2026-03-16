# WMS n8n 工作流配置说明

> **版本**: v0.3.3 (2026-03-15 更新)
> **总数**: 22 个工作流 JSON 文件 + 16 个纯函数库模块
> **运行时**: n8n 2.x (dp-wf 容器, 端口 5678)

## 概述

WMS 的所有后端 API 均通过 n8n Webhook 实现。每个工作流遵循统一模式:

```
Webhook → Code(校验) → PostgreSQL/MS SQL(查询) → Code(转换) → Respond(返回JSON)
```

## 数据库连接

### PostgreSQL (WMS + OMS Schema)
- 凭证名称: 在 n8n 编辑器中配置 (因环境而异)
- 数据库: 由 `DB_POSTGRESDB_DATABASE` 环境变量控制 (Schema: `wms`/`oms`)
- Host: `dp-db` (Docker 网络内)
- 端口: 5432

### SAP B1 MS SQL (只读查询)
- 使用 n8n 中已配置的 MS SQL 凭证
- **仅查询**，禁止写入 SAP 数据库
- SQL 中必须加 `SET NOCOUNT ON` + `WITH(NOLOCK)`

---

## 文件命名规范

```
wf{编号}-{功能}.json

编号规则:
  0a, 0b       → 初始化工具 (一次性运行, 默认停用)
  1a~1e        → SAP 单据查询 (按业务类型细分)
  02~09        → 核心业务 + 数据同步 (两位数补前导零)
  10~13        → 系统管理 (自然两位数)
  20~22        → OMS 订单管理 (SAP 同步/查询/DD 拆单)
```

---

## 工作流文件列表

### 初始化工具 (2个, 仅首次部署运行)

| # | 文件名 | 工作流名称 | 说明 | 激活 |
|---|--------|-----------|------|------|
| 0a | `wf0a-init-masterdata.json` | wf0a - 期初主数据灌库(一次性) | SAP 主数据全量导入 | ⏸️ |
| 0b | `wf0b-init-inventory.json` | wf0b - 期初库存导入(精简查询+缓存补全) | SAP 库存全量导入 | ⏸️ |

### SAP 单据查询 (5个)

| # | 文件名 | 工作流名称 | Webhook | 激活 |
|---|--------|-----------|---------|------|
| 1a | `wf1a-wo-lookup.json` | wf1a - WO查询(生产订单) | `GET /wms/wo` | ✅ |
| 1b | `wf1b-po-lookup.json` | wf1b - PO查询(采购订单) | `GET /wms/po` | ✅ |
| 1c | `wf1c-so-lookup.json` | wf1c - SO查询(销售订单) | `GET /wms/so` | ✅ |
| 1d | `wf1d-tr-lookup.json` | wf1d - TR查询(转储申请) | `GET /wms/tr` | ✅ |
| 1e | `wf1e-pi-lookup.json` | wf1e - PI查询(生产领料BOM) | `GET /wms/pi` | ✅ |

### 核心业务 (4个)

| # | 文件名 | 工作流名称 | Webhook | 激活 |
|---|--------|-----------|---------|------|
| 02 | `wf02-transaction.json` | wf02 - 事务提交 | `POST /wms/transaction` | ✅ |
| 03 | `wf03-document-management.json` | wf03 - 单据管理 | `POST /wms/document/create`<br>`POST /wms/document/complete`<br>`POST /wms/document/mark-exported` | ✅ |
| 04 | `wf04-document-query.json` | wf04 - 单据查询 | `GET /wms/documents`<br>`GET /wms/document` | ✅ |
| 05 | `wf05-item-export-dashboard.json` | wf05 - 物料查询与导出 | `GET /wms/item`<br>`GET /wms/export`<br>`GET /wms/dashboard` | ✅ |

### 数据同步 (5个)

| # | 文件名 | 工作流名称 | 触发方式 | 激活 |
|---|--------|-----------|---------|------|
| 06 | `wf06-items-sync.json` | wf06 - 物料缓存同步 | Cron 19:00 + `POST /wms/sync/items` | ✅ |
| 07 | `wf07-locations-sync.json` | wf07 - 仓库缓存同步 | Cron 19:00 + `POST /wms/sync/locations` | ✅ |
| 08 | `wf08-stock-query.json` | wf08 - 库存查询 | `GET /wms/stock` | ✅ |
| 09 | `wf09-stock-snapshot.json` | wf09 - 库存快照同步(每晚22:00) | Cron 22:00 + `POST /wms/sync/stock` | ✅ |
| 10 | `wf10-bin-sync.json` | wf10 - 库位缓存同步(OBIN增量) | Cron 19:30 + `POST /wms/sync/bins` | ✅ |

### 系统管理 (3个)

| # | 文件名 | 工作流名称 | Webhook | 激活 |
|---|--------|-----------|---------|------|
| 11 | `wf11-masterdata.json` | wf11 - 主数据查询(物料/仓库/库位) | `GET /wms/masterdata` | ✅ |
| 12 | `wf12-bin-add.json` | wf12 - 新增库位 | `POST /wms/bin/add` | ✅ |
| 13 | `wf13-lock.json` | wf13 - 单据锁管理(Acquire/Release/Check) | `POST /wms/lock/acquire`<br>`POST /wms/lock/release`<br>`GET /wms/lock/check` | ✅ |

### OMS 订单管理 (3个, v0.1.14+)

| # | 文件名 | 工作流名称 | 触发方式 | 激活 |
|---|--------|-----------|---------|------|
| 20 | `wf20-oms-sync.json` | wf20 - OMS SAP订单同步 | Cron 19:30 + `POST /wms/oms/sync` | ✅ |
| 21 | `wf21-oms-query.json` | wf21 - OMS订单查询+明细 | `GET /wms/oms/orders`<br>`GET /wms/oms/order` | ✅ |
| 22 | `wf22-oms-dd.json` | wf22 - OMS DD拆单管理 | `POST /wms/oms/dd/split`<br>`GET /wms/oms/dd/list` | ✅ |

---

## 纯函数库 (lib/)

> v0.1.15+ 从 n8n Code 节点剥离的核心逻辑，可独立单测。

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
| `wf20-oms-mapper.js` | OMS 同步映射 | wf20 |
| `wf21-query-builder.js` | OMS 查询构建 | wf21 |
| `wf22-mapper.js` | DD 拆单 mapper | wf22 |
| `wf-doc-param-extractor.js` | 单据参数提取 (共享) | wf1a~1e |
| `wf-merge-data.js` | 数据合并 (共享) | wf1a~1e |
| `wf-prefill-builder.js` | 预填 SQL 构建 (共享) | wf1a~1e |
| `wf-sync-helpers.js` | 同步辅助函数 (共享) | wf06~wf10 |

---

## 部署步骤

### 方式 A: 一键同步 (推荐)

```bash
# 在 WSL 中执行
cd "Digital-Platform"
N8N_API_KEY="your-api-key" python3 scripts/n8n-tools/sync-workflows.py
```

详见 `scripts/n8n-tools/README.md`

### 方式 B: n8n CLI 手动导入

```bash
# 1. 复制文件到容器
cd apps/wf && for f in wf*.json; do docker cp "./$f" "dp-wf:/tmp/wf-import/$f"; done

# 2. 添加 id 字段 (n8n 要求)
docker cp scripts/n8n-tools/add-ids.js dp-wf:/tmp/
docker exec dp-wf node /tmp/add-ids.js /tmp/wf-import

# 3. 批量导入
docker exec dp-wf n8n import:workflow --separate --input=/tmp/wf-import/

# 4. 通过 API 激活 (导入后默认 inactive)
curl -X POST -H "X-N8N-API-KEY: $API_KEY" \
  "http://localhost:5678/api/v1/workflows/{id}/activate"
```

### 方式 C: n8n UI 手动导入

1. 打开 n8n 编辑器 (`https://wf.example.com` 或 `http://localhost:5678`)
2. Workflows → Import from File → 选择 JSON 文件
3. 配置凭证 → 激活工作流

---

## 凭证配置

导入后需确认以下凭证已正确配置:

### PostgreSQL 凭证
所有 PostgreSQL 节点使用同一凭证。凭证名因环境而异，需在 n8n 编辑器中确认。

### SAP MS SQL 凭证
以下工作流包含 SAP 查询节点，需手动选择 MS SQL 凭证:

| 工作流 | SAP 节点名 |
|--------|-----------|
| wf1a~1e (5个 Lookup) | `SAP查询` |
| wf05 (物料查询) | `SAP Item Query` |
| wf06 (物料同步) | `SAP查询OITM` |
| wf07 (仓库同步) | `SAP查询OWHS` |
| wf09 (库存快照) | 多个 SAP 查询节点 |
| wf10 (库位同步) | `SAP查询OBIN增量` |
| wf0a, wf0b (初始化) | 多个 SAP 查询节点 |

---

## 验证测试

### 1. Dashboard API
```bash
curl http://localhost:5678/webhook/wms/dashboard
# 预期: {"success":true,"stats":{"today_transactions":0,...}}
```

### 2. 用户认证
```bash
curl -X POST http://localhost:5678/webhook/wms/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"xxx"}'
```

### 3. SAP 查询 (需 MS SQL 凭证)
```bash
curl "http://localhost:5678/webhook/wms/wo?docnum=26000123"
```

---

## 关键约束

- 所有 SQL 操作必须带 `company_code` 过滤 (值来自 `$env.DP_COMPANY_CODE`)
- SAP 查询只读，禁止写入
- `wms_audit_log` 只增不删不改
- 时区使用 `SYSTEM_TIMEZONE` 环境变量，不硬编码
- 更多规则和模式详见 [CLAUDE.md](../../CLAUDE.md)
