# ADR-007: OMS 独立 Schema 与 DD 拆单模型

> **日期**: 2026-03-03
> **状态**: Accepted
> **上下文**: OMS (订单管理系统) 需要在 WMS 之外建立独立的订单生命周期管理，支持 SAP 订单缓存、DD 拆单、状态追踪

---

## 决策

### 1. 独立 `oms` Schema (非嵌入 `wms`)

**选择**: 在 PostgreSQL 中创建独立 `oms` Schema，包含 `orders`、`order_lines`、`order_events`、`audit_logs` 四张核心表。

**理由**:
- **职责分离**: OMS 关注"可执行性" (哪些订单可以下发到 WMS)，WMS 关注"执行过程" (拣货/收货/移库)
- **避免表膨胀**: WMS 已有 12 表，OMS 新增 4 表独立管理，不污染 WMS 命名空间
- **数据权威分明**: SAP 拥有订单存在性/数量，OMS 拥有可操作性/终态，WMS 拥有执行状态
- **未来扩展**: 独立 Schema 方便 RLS 策略、权限隔离、跨系统集成

**放弃方案**: 在 `wms` Schema 中增加 `wms_oms_orders` 系列表 — 命名冗余，职责混淆。

### 2. DD 拆单模型 (parent_id 自引用)

**选择**: `oms.orders` 表使用 `parent_id` 自引用 FK 实现 DD (配送单) 从 SO (销售订单) 拆分。

**关键设计**:
- `doc_type` CHECK: DD 必须有 `parent_id`，非 DD 必须无 `parent_id`
- `split_seq`: 同一源订单下的 DD 序号 (UNIQUE on parent_id + split_seq)
- `container_no`: DD 柜号标识
- `idempotency_key`: UNIQUE 约束防网络重试重复创建
- `is_split`: 标记源订单已拆分

**理由**:
- 自引用 FK 比独立关联表更简洁，`v_dd_lineage` 视图可展开血缘树
- 幂等键确保前端重试安全 (网络超时场景)
- `split_seq` 支持同一源订单无限拆分

### 3. 双状态字段

**选择**: `oms_status` (业务状态) + `execution_state` (执行生命周期) 分离。

| 字段 | 值域 | 含义 |
|------|------|------|
| `oms_status` | pending/in_progress/completed/exported/split/cancelled | 业务流转状态 |
| `execution_state` | idle/executing/done | WMS 执行状态 |

**理由**: 一个订单可以处于 `oms_status=in_progress` 但 `execution_state=idle` (OMS 确认但 WMS 尚未开始)，分离两个维度避免状态爆炸。

### 4. WMS doc_type 扩展 DD

**选择**: 在 `wms.wms_documents.doc_type` CHECK 约束中增加 'DD'，DD 拣货复用 so.html/so.js。

**理由**: DD 拣货流程与 SO 完全一致 (按行扫码确认数量)，无需独立页面。`wf1c-so-lookup.json` 通过 DD 前缀分支查询 OMS 数据。

---

## 实施概要

| 组件 | 文件 | 变更 |
|------|------|------|
| DDL | `05_oms_tables.sql` | 4 表 + 2 视图 + 触发器 + 索引 |
| WMS DDL | `03_wms_tables.sql` | doc_type CHECK 增加 DD |
| 前端 | `oms.html` | 订单查询 + DD 拆单弹窗 + 批量打印 |
| 前端 | `index.html` | OMS 磁贴 + 同步按钮 |
| 前端 | `shared.js` | DD 路由/图标/标签 |
| 前端 | `so.js` | DD 拣货支持 |
| 前端 | `lang.js` | ~80 个 OMS i18n 键 |
| 工作流 | `wf20-oms-sync.json` | SAP 订单同步 (Cron 19:30) |
| 工作流 | `wf21-oms-query.json` | 订单查询 + 明细 |
| 工作流 | `wf22-oms-dd.json` | DD 拆单事务 |
| 工作流 | `wf1c-so-lookup.json` | DD 查询分支 |
| 测试 | `07_oms_schema_behavior_test.sql` | 15 项 SQL 行为测试 |
| 测试 | `oms.test.js` | 37 项 Jest 测试 |
| CI | `ci.yml` | OMS 表/视图验证 + SQL 测试 |

---

## 后续计划

| 阶段 | 内容 | 版本 |
|------|------|------|
| P3 | WMS→OMS 跨 Schema 触发器 (执行状态/数量回写) | v0.2 |
| P4 | Feature flag 驱动 SAP 解耦 (OMS 独立运行) | v0.3 |
| P5 | OMS 前端丰富化 (仪表板/图表/批量操作) | v0.3+ |
