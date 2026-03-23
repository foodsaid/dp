# 测试覆盖率分析报告 (2026-03-18)

> **范围**: 单元测试 (Jest) + 基建测试 (BATS/pytest) + SQL 行为测试
> **排除**: E2E 测试 (Playwright，计划下月执行)

---

## 1. 当前状态总览

| 类型 | 框架 | 文件数 | 用例数 | 覆盖状态 |
|------|------|--------|--------|----------|
| 单元测试 | Jest 29.7 (jsdom) | 51 (34 WMS + 16 WF + 1 scripts) | 2364 | 全局 85% 门禁; shared.js 90%/80%; wf/lib 85%/80% |
| 基建 Shell | BATS 1.13 | 18 | ~165 | 12/12 生产脚本覆盖 (100%) |
| 基建 Python | pytest | 12 (含 conftest.py) | ~175 | nginx 路由/安全头 + sync 工具 + superset 配置 |
| SQL 行为 | 原生 SQL (DO $$/\\echo) | 13 | ~148 | 14 初始化脚本中 13 有直接或间接测试 |

**总计: ~2852 个测试用例** (不含 E2E 的 153 个)

---

## 2. 覆盖良好的区域

### 2.1 WMS 前端 — 15/15 源文件 100% 覆盖

所有 JS 模块均在 `jest.config.js` 的 `collectCoverageFrom` 中:

| 模块 | 测试文件 | 亮点 |
|------|---------|------|
| `shared.js` (1300+ 行) | 18 个专项文件 (API/DOM/状态/验证/扫描/路由等) | Istanbul vm.Script 沙盒穿透; 90% 行覆盖门禁 |
| `oms.js` | `oms.test.js` (419 用例) | 最大单文件; PrintService 分支覆盖 84.65% |
| `so/po/tr/pi/wo/ic/lm` | 各自 .test.js | 8 个模块均完成 DOM 纯函数提取 (buildXxxLineRowHtml) |
| `stock/export/login/index` | 各自 .test.js | XSS 转义、company_code 过滤、浮点精度保护 |

### 2.2 WF 纯函数库 — 16/16 文件 100% 覆盖

`apps/wf/lib/*.js` 共 ~511 用例，覆盖:
- 交易验证 (`wf02`)、文档校验 (`wf03`)、查询构建 (`wf04/wf21`)
- CSV 导出 (`wf05`)、库存聚合 (`wf08`)、快照引擎 (`wf09`)
- OMS 映射 (`wf20/wf22`)、锁状态机 (`wf13`)、SO 解析 (`wf1c`)

### 2.3 Shell 脚本 — 12/12 生产脚本覆盖 (100%)

全部 12 个生产脚本均有 BATS 测试:
dev-up, backup, clone-company, health-check, import-workflows, init-platform, sso-manage-user, sso-migrate-wms-users, cert-renew, build-gh-pages, publish-snapshot, **check-container-versions** (22 用例)

另有 6 个基建入口脚本 (`enable-ssl`, `bi-entrypoint`, `wms-entrypoint`, `wms-test-envsubst`, `landing-port`, `sso-auth-toggle`) 由专项 BATS 覆盖。

### 2.4 SQL 行为测试 — 核心链路完整

```
01_extensions → 02_schemas → 03_wms_tables(间接) → 05_oms_tables
   ↓                                    ↓
schema 约束 (05) ← views (06/08/09) ← triggers (10)
   ↓
监控/SSO (06) → company_code 隔离 (11) → cache 回填 (12) → RLS 策略 (13) → RLS 回滚 (14)
```

### 2.5 CI 流水线 — 12 Job 全方位守护

compose 语法、env 完整性、PG Schema、安全审计、WMS 完整性、ShellCheck、Jest、ESLint、镜像构建、基建测试、nginx 语法、工作流 JSON — 每次 PR 自动执行。

---

## 3. 覆盖缺口分析

### 3.1 高优先级 (P0)

#### ~~A. `check-container-versions.sh` — 唯一无测试的生产脚本~~ ✅ 已完成

已创建 `tests/infra/check-container-versions.bats` (22 用例): extract_current_version/assess_risk/risk_color 函数级测试 + IMAGE_REGISTRY 完整性 + Mock curl JSON 模式。

#### ~~B. n8n 工作流 company_code 隔离无自动化 CI 验证~~ ✅ 已完成

已在 CI `workflow-validate` Job 中新增 Python 校验步骤: 自动检测 19 个含 PG 节点的工作流是否包含 company_code 过滤 (3 个豁免 + 7 个安全查询模式)。

#### ~~C. RLS 回滚脚本 (`14_rollback_rls.sql`) 无测试~~ ✅ 已完成

已创建 `tests/sql/14_rls_rollback_test.sql` (8 断言): 验证回滚后 RLS 禁用/策略删除/触发器清理/函数删除/角色删除/SECURITY INVOKER 还原/子表约束放宽/数据完整性。

#### D. `sync-workflows.py` 缺少函数级单元测试

| 项目 | 详情 |
|------|------|
| **文件** | `scripts/n8n-tools/sync-workflows.py` (300+ 行) |
| **现状** | `test_sync_workflows.py` + `test_sync_workflows_unit.py` 以文件结构检查和 API 模式验证为主，未测试核心函数逻辑 |
| **风险** | DB 查询、API 调用、工作流比对、错误恢复路径均未验证 |
| **建议** | 在 `test_sync_workflows_unit.py` 中新增函数级测试 (mock subprocess/requests) |
| **测试点** | `run()` 命令执行 + 异常处理; `psql()` 结果解析; `main()` GET→比较→PUT 主流程; 网络错误重试 |
| **预估** | 15-20 用例，中复杂度 |

#### ~~E. 监控/SSO 初始化脚本无专项测试~~ ✅ 已完成

已创建 `tests/sql/06_monitoring_sso_test.sql` (10 断言): dp_monitor 权限 + authelia schema 属主 + sso_users 8 列结构/主键/唯一约束/GIN 索引/触发器/默认值/CRUD 行为。CI 环境优雅跳过未初始化的 schema。

### 3.2 中优先级 (P1)

#### F. `env.js` / `config.js` 未纳入覆盖率门禁

| 项目 | 详情 |
|------|------|
| **问题** | `config.js` 有测试但不在 `collectCoverageFrom`; `env.js` 无测试文件 |
| **影响** | 配置注入是全部 12 个 HTML 页面的前置依赖，变更不受 85% 门禁保护 |
| **建议** | (1) `jest.config.js` 追加 `apps/wms/config.js`; (2) 创建 `tests/unit/wms/env.test.js` 验证 `window.__ENV` 注入 + 缺失键回退 |
| **预估** | 5-8 用例，低复杂度 |

#### G. `12_child_table_company_code.sh` 缺专项 SQL 测试

| 项目 | 详情 |
|------|------|
| **文件** | `infrastructure/postgres/init/12_child_table_company_code.sh` (170 行) |
| **现状** | 仅靠 CI pg-schema-test Job 的隐式验证 (检查列存在)，无行为断言 |
| **建议** | 扩展 `12_cache_company_code_test.sql` 或新建测试 |
| **测试点** | 子表 company_code 列 NOT NULL; 触发器从父表继承 company_code; 拒绝与父表不一致的 company_code |
| **预估** | 5-6 断言，低复杂度 |

#### H. Redis 配置无验证测试

| 项目 | 详情 |
|------|------|
| **文件** | `infrastructure/redis/{wf,bi,sso}.conf` (3 个实例) |
| **现状** | 零测试 — 错误配置仅在容器启动失败时才发现 |
| **建议** | 创建 `tests/infra/test_redis_config.py` |
| **测试点** | 配置语法合法; 密码占位符存在 (`requirepass`); 持久化策略正确; 最大内存设置合理; 三实例端口无冲突 |
| **预估** | 6-8 用例，低复杂度 |

#### I. Nginx 路由逻辑深度测试不足

| 项目 | 详情 |
|------|------|
| **现有** | `test_nginx_routes.py` (路由矩阵) + `test_nginx_security.py` (安全头) + CI `nginx-validate` (语法) |
| **缺失** | SSO `auth_request` 逻辑正确性; WebSocket upgrade (n8n 编辑器); `client_max_body_size` 限制; 错误页面状态码 |
| **建议** | 扩展 `test_nginx_routes.py`，增加配置项解析验证 |
| **预估** | 10-15 用例，高复杂度 |

### 3.3 低优先级 (P2)

#### J. 归档脚本部分无测试

`scripts/archive/` 中 4 个 Python 脚本 (`update_wf21_wf22.py`, `update_wf1c_wf21.py`, `update_wf1c_wf22_v2.py`, `fix_sync_counts.py`) 无测试。影响低 — 已归档，非活跃使用。

#### K. 监控栈配置无功能测试

Prometheus 告警规则、Grafana 仪表盘 JSON、Loki 配置仅靠 `compose-validate` 语法检查。未来可添加 PromQL 语法验证和告警规则回归测试。

---

## 4. 实施路线图

### Phase 1 — ✅ 已完成 (2026-03-18)

| # | 任务 | 目标文件 | 实际用例 | 状态 |
|---|------|---------|---------|------|
| 1 | `check-container-versions.sh` BATS 测试 | `tests/infra/check-container-versions.bats` | 22 | ✅ |
| 2 | n8n 工作流 company_code CI 验证 | `.github/workflows/ci.yml` (workflow-validate) | 19 工作流 | ✅ |
| 3 | RLS 回滚脚本 SQL 测试 | `tests/sql/14_rls_rollback_test.sql` | 8 | ✅ |
| 4 | 监控/SSO 初始化 SQL 测试 | `tests/sql/06_monitoring_sso_test.sql` | 10 | ✅ |

**Phase 1 成果**: Shell 脚本覆盖率 12/12 (100%); SQL 初始化覆盖率 13/14 (93%); CI 自动守护工作流 company_code 合规

### Phase 2 — 待实施 (补全剩余盲区)

| # | 任务 | 目标文件 | 预估用例 | 复杂度 |
|---|------|---------|---------|--------|
| 5 | `sync-workflows.py` 函数级单测 | `tests/infra/test_sync_workflows_unit.py` | 15-20 | 中 |
| 6 | `config.js`/`env.js` 纳入覆盖率 | `jest.config.js` + `tests/unit/wms/env.test.js` | 5-8 | 低 |
| 7 | Redis 配置验证 | `tests/infra/test_redis_config.py` | 6-8 | 低 |
| 8 | 子表 company_code 行为测试 | `tests/sql/12_cache_company_code_test.sql` (扩展) | 5-6 | 低 |

**Phase 2 完成后**: Python 工具链全覆盖; SQL 初始化覆盖率 14/14 (100%)

### Phase 3 — 持续改进

| # | 任务 | 预估用例 | 复杂度 |
|---|------|---------|--------|
| 9 | Nginx 深度逻辑测试 (auth_request/WebSocket/upload limit) | 10-15 | 高 |
| 10 | Prometheus 告警规则回归 (PromQL 语法 + 阈值验证) | 5-8 | 中 |
| 11 | Jest oms.js 分支覆盖率 84.65% → 87%+ | 20-30 | 中 |

---

## 5. 关键指标目标

| 指标 | Phase 1 前 | Phase 1 后 (当前) | Phase 2 后 |
|------|-----------|-------------------|-----------|
| 总用例数 (不含 E2E) | ~2812 | **~2852** | ~2890 |
| Shell 脚本覆盖率 | 11/12 (92%) | **12/12 (100%)** ✅ | 12/12 (100%) |
| SQL 初始化覆盖率 | 10/14 (71%) | **13/14 (93%)** ✅ | 14/14 (100%) |
| n8n company_code 合规 | 手动 | **CI 自动化** ✅ | CI 自动化 |
| Jest collectCoverageFrom | 31 模式 | 31 模式 | 32 模式 (+config.js) |
| Jest 全局分支覆盖率 | 85%+ | 85%+ | 85%+ |

---

## 6. 覆盖率地图 (速查)

### 6.1 Shell 脚本 → BATS 映射

```
scripts/
├── backup.sh               → tests/infra/backup.bats              ✅
├── build-gh-pages.sh        → tests/infra/build-gh-pages.bats     ✅
├── cert-renew.sh            → tests/infra/cert-renew.bats         ✅
├── check-container-versions.sh → tests/infra/check-container-versions.bats ✅ (22 用例)
├── clone-company.sh         → tests/infra/clone-company.bats      ✅
├── dev-up.sh                → tests/infra/dev-up.bats             ✅
├── health-check.sh          → tests/infra/health-check.bats       ✅
├── import-workflows.sh      → tests/infra/import-workflows.bats   ✅
├── init-platform.sh         → tests/infra/init-platform.bats      ✅
├── publish-snapshot.sh      → tests/infra/publish-snapshot.bats   ✅
├── sso-manage-user.sh       → tests/infra/sso-manage-user.bats   ✅
└── sso-migrate-wms-users.sh → tests/infra/sso-migrate-wms-users.bats ✅
```

### 6.2 PG 初始化脚本 → SQL 测试映射

```
infrastructure/postgres/init/
├── 01_extensions.sql           → tests/sql/01_extensions_test.sql         ✅ (4 断言)
├── 02_schemas.sql              → tests/sql/02_schemas_test.sql            ✅ (10 断言)
├── 03_wms_tables.sql           → tests/sql/05+06+10 (间接)               ✅
├── 04_wms_seed.sh              → CI pg-schema-test (隐式)                 ✅
├── 05_oms_tables.sql           → tests/sql/07+09 (间接)                   ✅
├── 06_monitoring_user.sh       → (无)                                     ❌ P0
├── 07_sso_schema.sh            → (无)                                     ❌ P0
├── 08_sso_users.sql            → (无)                                     ❌ P0
├── 09_enable_ssl.sh            → tests/infra/enable-ssl.bats             ✅
├── 10_cache_company_code.sh    → tests/sql/12_cache_company_code_test.sql ✅ (10 断言)
├── 11_rls_roles.sh             → tests/sql/13_rls_behavior_test.sql       ✅ (14 断言)
├── 12_child_table_company_code.sh → CI pg-schema-test (隐式)              ⚠️ P1
├── 13_rls_policies.sql         → tests/sql/13_rls_behavior_test.sql       ✅ (14 断言)
└── 14_rollback_rls.sql         → (无)                                     ❌ P0
```

### 6.3 Jest 覆盖率门禁

```
coverageThreshold:
  global:            85% stmt / 85% branch / 85% func / 85% line
  shared.js:         90% stmt / 80% branch / 85% func / 90% line
  apps/wf/lib/:      85% stmt / 80% branch / 85% func / 85% line

collectCoverageFrom: 15 WMS 模块 + apps/wf/lib/*.js (31 个模式)
缺失: config.js (有测试无门禁), env.js (无测试无门禁)
```
