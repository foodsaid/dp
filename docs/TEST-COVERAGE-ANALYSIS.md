# 测试覆盖率分析报告 (v0.3.3 历史存档)

> **日期**: 2026-03-17 · **版本**: v0.3.3
> **状态**: ✅ 全部 8 项改善已实施
> **注意**: 此为 v0.3.3 历史存档。最新报告见 [test-coverage-analysis-2026-03-17.md](test-coverage-analysis-2026-03-17.md)，当前 Jest **2394** 用例，Branch **91.32%**

---

## 零、改善成果

| 指标 | 改善前 | 改善后 |
|------|--------|--------|
| Jest 测试套件 | 49 | **51** (+2) |
| Jest 测试用例 | 2264 | **2295** (+31) |
| pytest 测试 | 见下 | **+68** 新 Python 测试 |
| oms.js Stmts | 88.97% | **94.01%** |
| shared.js Stmts | 95.46% | **97.34%** |
| WF lib 门禁 | ❌ 未追踪 | ✅ **97.69%** (85% 门禁) |
| 全局 Stmts | 94.5% | **96.92%** |

---

## 一、现状总览

### 测试层级

| 层级 | 框架 | 文件数 | 状态 |
|------|------|--------|------|
| WMS 前端单元测试 | Jest + jsdom | 34 个 `.test.js` | ✅ 覆盖率门禁 85%，实际 ~96.92% |
| WF 工作流纯函数 | Jest | 16 个 `.test.js` | ✅ 全部 16 个 lib 有对应测试 |
| 脚本工具 | Jest | 1 个 (`add-ids.test.js`) | ⚠️ 仅 1 个脚本有单元测试 |
| 基建测试 | BATS + pytest | 17 bats + 12 py | ✅ 主要 Shell 脚本均有覆盖 |
| SQL 行为测试 | 原生 SQL | 9 个 `.sql` | ✅ Schema/视图/触发器/约束 |
| CI 流水线 | GitHub Actions | 12 个 Job | ✅ 全面 (构建/安全/lint/测试) |

### WMS 前端覆盖率 (Jest)

```
全局:     Stmts 96.92% | Branch 89.12% | Funcs 96.72% | Lines 97.44%
门禁阈值: Stmts 85%    | Branch 85%    | Funcs 85%    | Lines 85%
```

**低覆盖文件:**

| 文件 | Stmts | Branch | 主要未覆盖区域 |
|------|-------|--------|----------------|
| `oms.js` | 94.01% | 85.38% | 行 1708-1812 (DD 全屏看板 Vue 组件) |
| `shared.js` | 97.34% | 87.77% | 行 309-311, 601-602, 1619 |
| `stock.js` | 97.03% | 88.28% | 行 449-450 |
| `camera-fallback.js` | 99.17% | 91% | 行 883 |

---

## 二、改善建议 (按优先级排序)

### 🔴 P0 — 高优先级 (业务风险)

#### 1. OMS 看板逻辑测试 (`oms.js` 行 1631-1863)

**问题**: DD 拆单全屏看板是 OMS 核心交互组件，约 230 行完全未被测试覆盖。包含拖拽分配、数量分配、容器管理等关键业务逻辑。

**建议**: 看板已通过 `createKanbanState()` 将纯逻辑与 Vue 分离，应补充对 Vue setup 函数内委托调用、事件处理分支的测试。重点覆盖:
- `openBoard()` / `closeBoard()` 状态切换
- `handleDrop()` 拖拽分配
- `submitSplit()` 提交拆单 (含网络错误分支)
- `filteredPoolItems` 搜索过滤

**预估工作量**: 新增约 150-200 行测试

#### 2. `shared.js` 库位历史 + initBinAutocomplete 测试

**问题**: 行 1534-1619 涉及 `_removeBinHistory()`、`initBinAutocomplete()` 等 DOM 操作函数，分支覆盖率拖低整体 shared.js 的 branch 指标 (86.43%)。

**建议**: 在 jsdom 环境下构造 input + form 元素，测试:
- 历史记录的 CRUD (存/取/删)
- 标签点击填入、双击移除
- blur 事件触发的 bin 校验纠正
- form submit 时保存历史

**预估工作量**: 新增约 80-100 行测试

---

### 🟡 P1 — 中优先级 (覆盖盲区)

#### 3. WF lib 覆盖率纳入 Jest 门禁

**问题**: `apps/wf/lib/` 全部 16 个文件都有测试，但 **未纳入 `collectCoverageFrom`**，覆盖率不被统计和门禁管控。这意味着 wf 代码可以悄悄退化而 CI 不会报警。

**建议**: 在 `jest.config.js` 的 `collectCoverageFrom` 中添加 `'apps/wf/lib/*.js'`，并设置门禁:
```js
'./apps/wf/lib/': {
    statements: 85,
    branches: 80,
    functions: 85,
    lines: 85,
}
```

**预估工作量**: 配置变更 ~5 行，可能需补少量测试达标

#### 4. `sync-workflows.py` 单元测试

**问题**: `scripts/n8n-tools/sync-workflows.py` (6101 字节) 是 n8n 工作流部署的推荐工具，包含 API 交互、错误处理、重试逻辑，但仅有基建层面的 pytest (`test_sync_workflows.py`, 128 行) 做基本校验，缺少对核心函数的深入单元测试。

**建议**: 用 pytest + `unittest.mock` 补充:
- API 调用的 mock 测试 (GET/PUT/activate/deactivate)
- 网络错误重试逻辑
- JSON 解析失败的错误处理
- 工作流冲突检测

**预估工作量**: 新增约 150-200 行 pytest

#### 5. `superset_config.py` 配置测试

**问题**: BI 配置文件 (216 行) 包含 SSO 角色映射、Redis URL 构建、安全策略等关键逻辑，完全无测试。SSO 角色映射 (admins→Admin, bi-users→Alpha) 是 v0.3.3 的核心功能。

**建议**: 用 pytest 验证:
- 环境变量缺失时的默认值
- `AUTH_ROLES_MAPPING` 映射正确性 (Authelia groups → Superset roles)
- `SQLALCHEMY_DATABASE_URI` 拼接含特殊字符密码时的正确性
- `TALISMAN_ENABLED` 在不同 `DP_SSO_ENABLED` 下的行为

**预估工作量**: 新增约 100 行 pytest

---

### 🟢 P2 — 低优先级 (锦上添花)

#### 6. `publish-snapshot.sh` / `build-gh-pages.sh` 测试

**问题**: 两个发布类脚本 (合计 470 行) 无测试。虽然不影响业务运行，但发布流程出错影响范围大。

**建议**: 添加 BATS 测试覆盖参数校验、dry-run 路径

#### 7. SQL 测试增加 `company_code` 隔离验证

**问题**: 现有 SQL 行为测试覆盖了约束和触发器，但缺少 **跨 company_code 数据隔离** 的专项测试。这是 CLAUDE.md 中的规则红线。

**建议**: 新增 SQL 测试文件验证:
- 插入不同 company_code 的数据后，视图/查询是否正确隔离
- `v_stock_realtime` 视图的 company_code 过滤
- OMS `v_dd_lineage` 跨公司数据不泄露

#### 8. Nginx 路由规则单元测试

**问题**: 现有 `test_nginx_routes.py` (305 行) 做了基本路由测试，但未覆盖:
- SSO 相关的动态 include (`sso-auth.inc` 等)
- 安全头注入 (`security-headers.conf`)
- WebSocket upgrade (n8n 编辑器)

---

## 三、改善路线图

| 阶段 | 任务 | 目标指标 |
|------|------|----------|
| **本周** | P0-1: OMS 看板测试 | oms.js Stmts ≥ 95% |
| **本周** | P0-2: shared.js 库位历史测试 | shared.js Branch ≥ 90% |
| **下周** | P1-3: WF lib 纳入覆盖率门禁 | wf/lib 门禁 85% |
| **下周** | P1-4: sync-workflows.py 测试 | 核心函数 mock 覆盖 |
| **v0.4** | P1-5: superset_config.py 测试 | SSO 映射验证 |
| **v0.4** | P2: SQL 隔离测试 + 发布脚本 | company_code 隔离专项 |

---

## 四、当前覆盖率优势

值得肯定的已有成果:
- **WMS 7 模块全覆盖**: SO/WO/PO/TR/IC/LM/PI 每个模块都有独立测试
- **WF 纯函数 100% 覆盖**: 全部 16 个 lib 文件都有对应测试
- **CI 门禁严格**: 85% 全局门禁 + shared.js 独立 90% 锁定
- **基建脚本覆盖面广**: 全部 11 个运维脚本有 BATS 测试 (17 bats + 12 py)
- **SQL 行为测试完善**: 9 个测试文件覆盖 Schema/视图/触发器/约束/OMS/隔离
- **安全审计自动化**: CI 自动检查硬编码密钥、.env 泄露、加密密钥
