# 测试覆盖率分析报告 — 2026-03-15 (历史存档)

> 基于 Jest 覆盖率实测 + 全仓库源码/测试文件映射分析
>
> **范围**: 单元测试 (Jest)、基建测试 (BATS + pytest)、SQL 行为测试、静态分析
> **注意**: 此为历史存档。最新报告见 [test-coverage-analysis-2026-03-17.md](test-coverage-analysis-2026-03-17.md)
> **排除**: E2E 端到端测试 (Playwright) — 计划下月单独执行

---

## 一、当前覆盖率概览

### Jest 单元测试 (实测数据)

```
全局:   94.96% Stmts | 89.47% Branch | 93.90% Funcs | 95.65% Lines
阈值:   85%          | 85%           | 85%           | 85%
余量:   +9.96%       | +4.47%        | +8.90%        | +10.65%
```

| 文件 | Stmts | Branch | Funcs | Lines | 状态 |
|------|:-----:|:------:|:-----:|:-----:|:----:|
| export.js | 100% | 96.55% | 100% | 100% | ⭐ 满分 |
| ic.js | 100% | 98.90% | 100% | 100% | ⭐ 满分 |
| index.js | 100% | 98.33% | 100% | 100% | ⭐ 满分 |
| lang.js | 100% | 94.20% | 100% | 100% | ⭐ 满分 |
| lm.js | 100% | 96.10% | 100% | 100% | ⭐ 满分 |
| login.js | 100% | 95.45% | 100% | 100% | ⭐ 满分 |
| pi.js | 100% | 98.30% | 100% | 100% | ⭐ 满分 |
| po.js | 100% | 96.42% | 100% | 100% | ⭐ 满分 |
| so.js | 100% | 97.26% | 100% | 100% | ⭐ 满分 |
| tr.js | 100% | 97.77% | 100% | 100% | ⭐ 满分 |
| wo.js | 100% | 97.72% | 100% | 100% | ⭐ 满分 |
| camera-fallback.js | 99.17% | 91.00% | 95.31% | 99.76% | ✅ 优秀 |
| stock.js | 97.03% | 88.28% | 97.77% | 99.19% | ✅ 良好 |
| shared.js | 97.28% | 87.82% | 96.85% | 98.10% | ✅ 核心库 (↑ funcs +2.37%) |
| **oms.js** | **88.97%** | **84.65%** | **84.93%** | **89.27%** | ✅ P0 已修复 (↑ +3.78% branch) |

### 测试规模统计

| 层级 | 文件数 | 用例数 | 工具 |
|------|:------:|:------:|------|
| Jest 单元测试 (WMS) | 34 | ~1783 | Jest + jsdom + Istanbul 手动插桩 |
| Jest 单元测试 (WF/lib) | 16 | ~487 | Jest |
| Jest 单元测试 (scripts) | 1 | 25 | Jest (add-ids.js 纯函数) |
| BATS Shell 测试 | 17 | ~128 | BATS |
| pytest Python 测试 | 12 | ~107 | pytest |
| SQL 行为测试 | 9 | 95 | psql RAISE NOTICE 断言 |
| ESLint 静态分析 | — | 0 错误 0 警告 | ESLint |
| **合计 (不含 E2E)** | **~89** | **~2625** | — |

---

## 二、覆盖率薄弱区域分析

### 2.1 oms.js — 最大改善空间 (Branch 80.87%)

**现状**: 全仓库唯一一个接近阈值底线的文件 (80% 阈值, 仅 0.87% 余量)。

**未覆盖行分析**:
- **L35**: 模块加载时的条件分支
- **L1022**: Vue 组件内部状态分支
- **L1631-1863**: Vue 3 IIFE (setup() 函数, ~232 行) — 包含 Kanban 看板、拖拽排序、响应式状态管理

**根因**: oms.js 是唯一使用 Vue 3 的文件，Vue IIFE 内的响应式代码在 jsdom 环境下无法执行 (缺少 Vue 运行时)。

**改善建议**:
1. **提取更多纯函数**: 从 Vue setup() 中剥离计算逻辑到 `module.exports` 区域，如:
   - Kanban 列排序/过滤逻辑
   - DD 状态聚合计算
   - 多 SO 批量提交的校验逻辑 (部分已提取，可进一步)
2. **预期收益**: Branch 80.87% → ~85%+，远离阈值危险线

### 2.2 shared.js — 核心库分支覆盖 (Branch 87.65%)

**未覆盖行**:
- **L23**: IIFE sessionStorage catch 分支 (环境初始化，不可达)
- **L58, L63-71**: 加载时横幅显示逻辑 (执行时序限制)
- **L89-92**: 条件初始化路径
- **L309-311**: 移动端特定分支
- **L601-602, L632-633, L643-644**: 沙盒内 inline onclick (Istanbul 无法追踪)
- **L1585**: 深层嵌套条件

**改善建议**:
1. **L309-311 移动端分支**: 可通过 mock `navigator.userAgent` + `ontouchstart` 覆盖
2. **L601-602 onclick 处理器**: 考虑将 onclick 回调逻辑提取为命名函数
3. **预期收益**: Branch 87.65% → ~90%

### 2.3 camera-fallback.js — 硬件 API 边界 (Branch 91%)

**未覆盖**: L883 (ImageCapture/MediaStream 硬件 API 深层闭包)

**结论**: 91% 为 Istanbul 沙盒在硬件 API 模拟下的上限，无需额外投入。

### 2.4 stock.js — 死代码 (Branch 88.28%)

**未覆盖**:
- **L449-450**: `typeof module === 'undefined'` 浏览器初始化路径 (Jest 环境结构性不可达)

**改善建议**: 检查 L449-450 是否可简化或移除死代码。

---

## 三、源码/测试文件覆盖矩阵

### 3.1 无测试的源文件 (关键发现)

| 源文件 | 风险等级 | 说明 | 建议 |
|--------|:--------:|------|------|
| `scripts/n8n-tools/add-ids.js` | 🟡 中 | 为工作流 JSON 添加 id 字段，变更生产工作流定义 | **新增 Jest 单元测试** |
| `infrastructure/postgres/init/09_enable_ssl.sh` | 🟡 中 | PG SSL 自签名证书生成 (安全关键) | **新增 BATS 测试** |
| `infrastructure/postgres/init/06_monitoring_user.sh` | 🟢 低 | 监控账号创建 (一次性) | 可选 |
| `infrastructure/postgres/init/07_sso_schema.sh` | 🟢 低 | SSO Schema 创建 (一次性) | 可选 |
| `scripts/archive/fix_sync_counts.py` | 🟢 低 | 已归档的修复脚本 | 低优先 |

### 3.2 n8n 工作流逻辑提取率

22 个工作流中，**16 个** 已将核心逻辑提取到 `apps/wf/lib/` 并有 Jest 测试。

| 未提取工作流 | 类型 | 内嵌逻辑复杂度 | 建议 |
|-------------|------|:-------------:|------|
| `wf0b-init-inventory.json` | 一次性初始化 | 低 | 暂不提取 |
| `wf12-bin-add.json` | 库位新增 | 低 | 暂不提取 |
| `wf1a-wo-lookup.json` | SAP WO 查询 | 中 | **建议提取公共 SAP 查询解析逻辑** |
| `wf1b-po-lookup.json` | SAP PO 查询 | 中 | **同上，与 wf1a 共享** |
| `wf1d-tr-lookup.json` | SAP TR 查询 | 中 | **同上** |
| `wf1e-pi-lookup.json` | SAP PI 查询 | 中 | **同上** |

**建议**: wf1a/1b/1d/1e 共享大量 SAP 查询→WMS 预填逻辑 (类似 wf1c-so-parser.js 模式)。提取为 `wf-sap-lookup-helpers.js` 可一次覆盖 4 个工作流。

### 3.3 已覆盖文件完整清单

| 类别 | 已测/总数 | 覆盖率 |
|------|:---------:|:------:|
| WMS 前端 JS | 15/15 | 100% |
| WF/lib 纯函数 | 16/16 | 100% |
| 运维 Shell 脚本 | 11/11 | 100% |
| Python 脚本 | 12/12 | 100% |
| Nginx 配置脚本 | 3/3 | 100% |
| Docker Entrypoint | 2/2 | 100% |
| PG 初始化脚本 | 2/4 | 50% |
| **总计** | **61/63** | **97%** |

---

## 四、改善建议 (按优先级排序)

### P0: ✅ oms.js 分支覆盖强化 (已完成)

**结果**: Branch 80.87% → **84.65%** (+3.78%)，余量从 0.87% 提升至 **4.65%**。

**完成内容** (+42 用例):
1. renderOrders 缺字段 fallback 分支 (DD/WO/is_split/container_no)
2. queryOrders 多单号附加筛选、null/失败响应处理
3. ensureOrderLines batch 失败 fallback 逐个加载路径
4. PrintService 缺字段 fallback (DD 原单引用、WO BOM 合并、delivered_qty)
5. createKanbanState 搜索/拖拽/CBM/Weight 边界分支
6. buildMultiSOPayload containerNo 为空时自动编号
7. validateMultiSOSubmit sapDocNum 前缀分支
8. fmtNum formatNumber 不可用时 String() 回退

### P1: SAP 查询工作流公共逻辑提取

**原因**: wf1a/1b/1d/1e 四个 SAP 查询工作流含相似的 Code 节点逻辑 (查询解析、预填 SQL 生成)，但未提取为可测试的纯函数。

**方案**:
1. 分析 wf1a/1b/1d/1e 的 Code 节点，识别公共模式
2. 提取到 `apps/wf/lib/wf-sap-lookup-helpers.js`
3. 参照 `wf1c-so-parser.js` 模式编写测试

**预期**: 工作流纯函数提取率 16/22 → 20/22

### P1: add-ids.js 单元测试

**原因**: 这个工具修改生产工作流 JSON 定义，错误可能导致工作流损坏。

**方案**:
1. 在 `tests/unit/wf/` 新增 `add-ids.test.js`
2. 测试: 空 JSON、已有 id、嵌套节点、边界情况

### P2: shared.js 移动端分支补充

**原因**: L309-311 等移动端分支可通过 mock 覆盖。

**方案**:
1. 在现有 shared 测试中增加 mobile userAgent mock 场景
2. 覆盖 `isMobileDevice()` 组合条件的更多路径

**预期**: Branch 87.65% → ~90%

### P2: ✅ 09_enable_ssl.sh BATS 测试 (已完成)

**结果**: 新增 `tests/infra/enable-ssl.bats` (9 用例)
- Mock openssl/chown，验证首次生成、重复跳过、SSL 启用、自定义 PGDATA、无配置行容错

### P3: ✅ SQL 行为测试扩充 (已完成)

**结果**: 新增 `tests/sql/10_trigger_behavior_test.sql` (12 断言)
- `fn_updated_at()` 触发器行为验证
- `fn_enforce_company_code()` 纯空格 company_code 拒绝
- `fn_prevent_audit_log_tampering()` UPDATE/DELETE 拒绝
- `fn_synced_at()` 缓存表同步时间自动更新
- doc_type/status CHECK 约束验证
- v_stock_realtime/v_document_summary 视图可查询性
- 跨 Schema 查询 (oms.orders 访问)
- DD doc_type 插入验证
- stock_snapshot/transactions company_code 约束

SQL 测试: 7 文件 83 断言 → 9 文件 95 断言

### P3: 提升 Jest 分支覆盖阈值

**当前阈值**: 80% branches (全局)
**实际数据**: 88.21% branches

**建议**: 待 P0/P2 完成后，将全局分支阈值提升至 85%，防止覆盖率倒退。

---

## 五、架构天花板说明

以下文件的未覆盖分支属于技术限制，非测试不足:

| 文件 | Branch | 天花板原因 |
|------|:------:|-----------|
| oms.js | ~85% | Vue 3 IIFE (L1631-1863) 需要 Vue 运行时，jsdom 不支持 |
| stock.js | ~88% | `typeof module === 'undefined'` 浏览器路径在 Jest 中不可达 |
| shared.js | ~88% | IIFE 闭包 (L23) + 加载时横幅 (L63-71) + 沙盒 onclick (L588) |
| camera-fallback.js | ~91% | ImageCapture/MediaStream 硬件 API 闭包 |

这些文件的剩余未覆盖代码需要通过 E2E 测试 (Playwright) 间接覆盖 (下月计划)。

---

## 六、总结

| 指标 | 当前值 | 目标值 | 差距 |
|------|:------:|:------:|:----:|
| Jest Stmts | 96.92% | 95%+ | ✅ +1.92% |
| Jest Branch | 89.12% | 90%+ | -0.88% |
| 源文件有测试 | 97% | 95%+ | ✅ 达标 |
| WF/lib 提取率 | 73% (16/22) | 90%+ (20/22) | 4 个工作流 |
| SQL 断言数 | 95 | 100+ | ~5 断言 |

**P0 已解决**: oms.js Branch 80.87% → 84.65% (+3.78%)，CI 安全余量充足。
**P3 已完成**: 全局分支阈值 80% → 85%，防止覆盖率倒退。
**P1 add-ids.js**: 纯函数提取 + 25 用例 100% 覆盖。
**P2 shared.js**: 弹窗按钮/AbortController/filterLine 分支补充 (+10 用例)。
