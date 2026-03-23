# RLS 行级安全实施经验教训

> **版本**: v1.1 — 2026-03-18
> **适用**: PostgreSQL 17 + n8n 2.x + 连接池场景

---

## 🚨 致命陷阱

### 1. CTE 内联 set_config 不可用

```sql
-- ❌ 不可用! PG 优化器可能先评估 RLS 策略再执行 CTE
WITH _ctx AS (SELECT set_config('app.company_code', 'ACME', true))
SELECT * FROM wms.wms_documents d, _ctx;
-- 结果: 0 行 (RLS 评估时 GUC 还未设置)
```

**验证**: 2026-03-18 实测确认，PG17 中 CTE set_config 对 RLS 策略无效。

### 2. 超级用户永远绕过 RLS

`POSTGRES_USER` 创建的用户是超级用户 → `FORCE ROW LEVEL SECURITY` 也无效。
**必须**: 创建 NOSUPERUSER 角色 (`dp_app_rls`) 给业务查询。

### 3. 自定义 GUC 需要预注册

非超级用户首次使用 `set_config('app.company_code', ...)` 会报:
`unrecognized configuration parameter "app.company_code"`

**解法**: `ALTER DATABASE <db> SET app.company_code = '';` (注册空默认值)

---

## n8n PG 节点连接行为 (实测)

### 核心发现 (2026-03-18 验证)

| 特性 | 结果 |
|------|------|
| 同一工作流多个 PG 节点 | **共享同一连接** (pg_backend_pid 相同) |
| 每个节点是否独立事务 | **是** (auto-commit) |
| set_config(true) 跨节点 | **❌ 失效** (事务边界清除) |
| set_config(false) 跨节点 | **✅ 有效** (session 级保持) |
| 工作流结束后连接 | **归还池，GUC 残留** (必须每个工作流开头覆盖) |

### 5. 独立 set_config 节点切断数据流 🚨

**血泪教训 (2026-03-18)**:
在 Webhook 和业务节点之间插入独立的 "RLS Set Context" PG 节点 →
下游节点的 `$input/$json` 读到的是 `{set_config: "ACME"}`，**原始 Webhook 数据丢失**。
wf08 库存查询全部返回空 (参数提取失败 → 默认空 → 查不到数据)。

```
❌ Webhook → [RLS Set Context] → 提取参数 → PG查询
   提取参数读到 {set_config:"ACME"} 而不是 {query:{item:"xxx"}}

✅ Webhook → 提取参数 → PG查询 (SQL内联 set_config)
   PG查询的 SQL 第一行: SELECT set_config('app.company_code', $1, false);
```

### 生产模式 (最终确认 v3)

**角色级 GUC** (最简方案，无需改任何工作流节点):
```bash
# 11_rls_roles.sh 中动态设置，从 DP_COMPANY_CODE 环境变量读取
ALTER ROLE dp_app_rls SET app.company_code = '${DP_COMPANY_CODE}';
```
- dp_app_rls 每次连接自动带 `app.company_code`
- 不需要 set_config 节点、不需要内联多语句、不改工作流 SQL
- 只需切换 PG 节点凭据 → dp_app_rls → RLS 自动生效

**⚠️ 禁止硬编码 company_code 到 ALTER ROLE** — 必须从 `DP_COMPANY_CODE` 环境变量读取

**淘汰方案** (记录但不再使用):
- ❌ 独立 RLS Set Context 节点 (切断数据流)
- ❌ SQL 内联 set_config 多语句 (22 个工作流改不完，部分节点无 $env 参数)
- ❌ CTE 内联 set_config (PG 优化器先评估 RLS)

**池污染防护**: 角色级 GUC 是 session 默认值，连接归还池后下次取出仍有效，无污染问题

---

## n8n 工作流批量切换 RLS 凭据 (通用方法)

### 原则
- **不添加独立节点** (会切断数据流)
- **不改连接** (保持原始工作流结构)
- 只改每个 PG 节点的: (1) 凭据 ID → dp_app_rls  (2) SQL 内联 set_config

### 切换条件
只对满足以下条件的 PG 节点加 set_config:
- `options.queryReplacement` 包含 `$env.DP_COMPANY_CODE`
- SQL 中还没有 `set_config`

### 脚本模板 (`scripts/rls_batch_switch.py`)
```python
for n in nodes:
    if n.get("type") != "n8n-nodes-base.postgres":
        continue
    # 1. 切凭据
    creds["postgres"] = {"id": NEW_CRED_ID, "name": NEW_CRED_NAME}
    # 2. 内联 set_config (仅对有 $env 参数的节点)
    if "set_config" not in q and "$env.DP_COMPANY_CODE" in qr:
        params["query"] = "SELECT set_config('app.company_code', $1, false);\n" + q
```

### 保存方式 (按 skills SOP)
```
1. INSERT workflow_history (新 versionId)
2. UPDATE workflow_entity (nodes + connections + versionId + activeVersionId)
3. docker restart dp-wf dp-wf-worker
```

### 回滚
每个工作流的旧版本保留在 `workflow_history`，按 versionId 回退即可。

### node-postgres pool.query() 多语句

```javascript
// ✅ 支持多语句，返回数组
const r = await pool.query("BEGIN; SELECT ...; INSERT ...; COMMIT;");
// r 是数组: [beginResult, selectResult, insertResult, commitResult]
```

---

## RLS 策略最佳实践

### 用原始表达式，不包函数

```sql
-- ✅ 优化器可 inline
USING (company_code = current_setting('app.company_code'))

-- ❌ plpgsql 函数影响 plan cache
USING (company_code = wms.current_company())
```

### 安全默认值

- `ALTER DATABASE SET app.company_code = ''` → 未设 GUC 时默认空字符串
- 空字符串不匹配任何 company_code (CHECK 约束保证非空)
- 效果: 安全拒绝 (0 行返回)

### 4. 子表加 NOT NULL 必须同时加自动填充触发器 🚨

**血泪教训 (2026-03-18)**:
给 `wms_document_lines` 加了 `company_code NOT NULL` 但没加自动填充触发器。
22 个工作流中的 Prefill SQL 都没有传 company_code → **全部 INSERT 失败 → 生产瘫痪**。

v4 计划为了"性能"去掉了自动填充，只保留"校验不填充"——**大错特错**。
22 个工作流的 SQL 不可能一次改完，过渡期必须有兜底。

```sql
-- ✅ 正确: 自动填充 + 不可变 (向后兼容)
CREATE FUNCTION wms.fn_fill_child_company_code() ...
  -- INSERT 时如果没传 cc → 从父表自动获取
  -- UPDATE 时如果 cc 变了 → 拒绝 (不可变)

-- ❌ 错误: 只做校验不填充 (理论上更优但实际不兼容旧工作流)
```

**原则**: DDL 约束变更必须向后兼容。先加触发器兜底，等所有工作流迁移完再考虑去掉。

### 子表触发器最佳配置

```sql
-- BEFORE INSERT 触发器执行顺序 (按名称字母序):
-- 1. trg_fill_child_cc  → fn_fill_child_company_code() — 自动填充 (兜底)
-- 2. trg_lines_enforce_cc → fn_enforce_company_code() — NOT NULL 校验
-- 3. trg_xxx_cc_immutable → fn_immutable_company_code() — UPDATE 不可变
```

---

## search_path 安全

```sql
-- ❌ 含 public (可被劫持)
SET search_path = oms, wms, public;

-- ✅ pg_catalog 替代 public
SET search_path = pg_catalog, oms, wms;
```

---

## 回滚策略

**即时回滚 (30 秒)**: n8n Credential 切回超级用户 → RLS 即刻绕过
**完整回滚**: `14_rollback_rls.sql` → DISABLE RLS + DROP POLICY + DROP ROLE
