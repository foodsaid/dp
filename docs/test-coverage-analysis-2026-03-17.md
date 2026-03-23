# 测试覆盖率分析报告 (2026-03-18 更新)

> **范围**: 单元测试 (Jest) + 基建测试 (BATS/pytest) + SQL 行为测试
> **排除**: E2E 测试 (Playwright)

---

## 1. 覆盖率改进结果

```
Jest 51 文件, 2394 用例, 全部通过 (原 2295, +99)

整体:  97.15% Stmts | 91.32% Branch | 96.72% Funcs | 97.71% Lines
原始:  96.92% Stmts | 89.12% Branch | 96.72% Funcs | 97.44% Lines
```

### 改进明细

| 文件 | Branch 前 | Branch 后 | 变化 | 关键改进 |
|------|-----------|-----------|------|----------|
| `wf-merge-data.js` | **66.12%** | **99.19%** | +33.07% | 4 个 merge 函数 `||` 默认值全覆盖 |
| `wf04-doc-query.js` | **89.23%** | **97.69%** | +8.46% | mergeDetail 行/事务字段默认值 + SO/DD line_num=0 |
| `wf-prefill-builder.js` | **74.25%** | **95.04%** | +20.79% | SQL builder 守卫 + 安全默认值 |
| `wf11-masterdata-parser.js` | **87.50%** | **95.83%** | +8.33% | whs/bins null _json 默认分支 |
| `po.js` | **93.33%** | **95.00%** | +1.67% | lineStatus `|| 'O'` 默认值 |

---

## 2. SAP B1 对账一致性测试 (全单据类型覆盖)

SAP B1 10.0 MS SQL Server 行项目 ID 从 0 开始 (`LineNum=0`)。
以下测试确保所有单据类型正确处理 `LineNum=0` 第一行:

| 单据 | 测试点 | 文件 |
|------|--------|------|
| **WO** | 单行 line_num=0 WMS 事务累计 + prefill SQL 行号 0 | wf-merge-data + wf-prefill-builder |
| **PO** | 多行 LineNum=0 映射 + lineReceipts 对应 + SQL VALUES + buildPoOpenLines | wf-merge-data + wf-prefill-builder + po |
| **TR** | 多行 LineNum=0 + prefill SQL | wf-merge-data + wf-prefill-builder |
| **PI** | BOM LineNum=0 + lineStatus 计算 + SQL VALUES | wf-merge-data + wf-prefill-builder |
| **SO** | wf04 mergeDetail line_num=0 透传 | wf04-doc-query |
| **DD** | OMS 拆单 line_num=0 保留 + 单号大写规范化 | wf04-doc-query + wf1c-so-parser |

---

## 3. 已确认的架构天花板 (Jest 无法覆盖)

### WMS 前端模块 (jsdom 沙盒限制)

| 文件 | 未覆盖行 | 原因 | 覆盖方式 |
|------|---------|------|---------|
| `shared.js` L23 | IIFE sessionStorage catch | 仅浏览器异常触发 | E2E |
| `shared.js` L58,63-71 | env.js 缺失/testing 环境横幅 | DOMContentLoaded 事件 | E2E |
| `shared.js` L309-311 | `_isLoadingDoc` 闭包变量 | sandbox 外部不可设置 | E2E |
| `shared.js` L601-602 | Modal 回调 | DOM 事件不可模拟 | E2E |
| `shared.js` L1619 | binHistory catch 块 | 异常路径 | E2E |
| `oms.js` L1708-1812,1857 | Vue IIFE (拖拽/提交/关闭) | jsdom 无 Vue 运行时 | E2E |
| `oms.js` L35 | Enter keydown 事件 | DOM 事件注册 | E2E |
| `oms.js` L1022 | DOMContentLoaded 分支 | readyState='complete' | E2E |
| `so/po/tr/pi.js` | `typeof t === 'function'` | sandbox 始终提供 `t` (setup.js L115) | E2E |
| `camera-fallback.js` L883 | DOMContentLoaded | readyState='complete' | E2E |

### 结构性不可达 (纵深防御代码)

| 文件 | 未覆盖行 | 原因 |
|------|---------|------|
| 所有 WMS/WF `typeof module` | 模块导出守卫 | Jest 环境 module 始终存在 |
| `wf-doc-param-extractor.js` L61 | `parseInt` NaN 检查 | 前置正则 `/^\d+$/` 已拦截 |
| `wf1c-so-parser.js` L50 | 同上 | 前置正则已拦截 |
| `wf-sync-helpers.js` L57 | 日期格式异常 throw | `pad()` 函数保证格式正确 |
| `wf-prefill-builder.js` L66,127,189,249 | `docEntry \|\| 0` | SAP DocEntry 从 1 开始 |
| `lang.js` L797 | `resolveTranslation \|\| fallback` | resolveTranslation 始终返回 truthy |
| `lang.js` L829 | `langMap[lang] \|\| lang` | setLang 不支持语言回退 zh |

---

## 4. 剩余改进建议 (需 E2E 或其他框架)

| 优先级 | 区域 | 框架 | 说明 |
|--------|------|------|------|
| P1 | Vue IIFE 拖拽/提交逻辑 | Playwright E2E | oms.js DD 拆单 |
| P1 | 错误弹窗/网络超时恢复 | Playwright E2E | 所有模块 |
| P2 | SQL 并发 upsert | PG 容器 + pgTAP | 多事务冲突 |
| P2 | 跨模块集成 | Jest 集成套件 | WF parser→validator→builder 链 |
| P3 | 性能基准 | k6/Artillery | 大数据量场景 |
