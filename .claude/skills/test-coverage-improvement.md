# 测试覆盖率改善模式 (Test Coverage Improvement Patterns)

> **版本**: v1.0
> **创建**: 2026-03-07
> **来源**: v0.1.15~v0.1.16 多轮测试优化实战经验

---

## 1. 项目测试金字塔

```
Jest 2264 (单元, 49 文件: 32 WMS + 16 WF + 1 scripts)
  ├── WMS 前端: jsdom + Istanbul 手动插桩 (vm.Script 沙盒穿透)
  ├── n8n 纯函数: 标准 Jest (无 DOM 依赖)
  └── 工具脚本: add-ids.js (纯函数提取后可测)
Playwright 152 (E2E, 14 文件: 12 页面全覆盖 + 边界用例 + 移动端视口)
  └── Network Interception + python3 http.server
BATS 119 (基建 Shell, 15 文件)
pytest 107 (基建 Python, 8 文件)
SQL 95 (约束/触发器/视图, 8 文件: RAISE NOTICE 'PASS' 断言)
总计: ~2725
```

---

## 2. DOM 纯函数提取模式 (核心模式)

### 问题
页面 JS 文件中 HTML 构建逻辑位于 `/* istanbul ignore next */` DOM 绑定区域内，无法被 Jest 覆盖。

### 解决方案: 依赖注入 helpers 对象

**步骤**:
1. 在 `/* istanbul ignore next */` 注释**之前**创建纯函数
2. 纯函数接受 `helpers` 对象 (简写 `h`)，包含需要的工具函数
3. DOM 绑定函数内委托调用纯函数
4. 在 `module.exports` 中导出纯函数

**模板**:
```javascript
// ===== 在 /* istanbul ignore next */ 之前 =====

function buildXxxLineRowHtml(line, wms, opts, h) {
    // h = { escapeHtml, formatNumber, generateBarcodeUrl }
    var received = getXxxLineReceived(wms, line.lineNum);
    var open = calcXxxLineOpen(line, received);
    var lineDone = isXxxLineDone(opts.headerClosed, line.lineStatus, open);
    var rowHtml = '<tr class="' + (lineDone ? 'line-done' : '') + '">' +
        '<td>' + h.escapeHtml(line.itemCode || '') + '</td>' +
        // ... 其他列 ...
        '</tr>';
    return { html: rowHtml, lineDone: lineDone };
}

function buildXxxHistoryRowsHtml(transactions, h) {
    // h = { escapeHtml, formatNumber, formatDateTime }
    if (!transactions || transactions.length === 0) return '';
    return transactions.map(function(tx) {
        return '<tr>' +
            '<td>' + h.formatDateTime(tx.created_at) + '</td>' +
            // ...
            '</tr>';
    }).join('');
}

/* istanbul ignore next */
function renderOrder(data) {
    // 委托给纯函数
    var rowHelpers = { escapeHtml: escapeHtml, formatNumber: formatNumber, generateBarcodeUrl: generateBarcodeUrl };
    var result = buildXxxLineRowHtml(l, wms, opts, rowHelpers);
    tbody.innerHTML += result.html;
}

// module.exports 中导出纯函数
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        // 计算函数
        getXxxLineReceived: getXxxLineReceived,
        calcXxxLineOpen: calcXxxLineOpen,
        // HTML 构建函数
        buildXxxLineRowHtml: buildXxxLineRowHtml,
        buildXxxHistoryRowsHtml: buildXxxHistoryRowsHtml
    };
}
```

### 已完成模块 (8/8 全部完成)
| 模块 | 行构建函数 | 历史/明细构建函数 | 特殊点 |
|------|-----------|-----------------|--------|
| so.js | buildSoLineRowHtml | buildHistoryRowsHtml | DD 模式分支 (source_doc_number) |
| po.js | buildPoLineRowHtml | buildPoHistoryRowsHtml | 9 列, 收货按钮 |
| tr.js | buildTrLineRowHtml | buildTrHistoryRowsHtml | 10 列 (双仓库), 调拨操作 |
| pi.js | buildPiLineRowHtml | buildPiHistoryRowsHtml | 3 变量计算 (baseQty/sapIssued/issued) |
| wo.js | — (单行工单) | buildWoHistoryRowsHtml | 列顺序特殊 (item→name→time) |
| ic.js | — (无 SAP 行) | buildIcDetailRowsHtml, buildIcPendingRowsHtml | 6 列, 待提交含删除按钮索引 |
| lm.js | — (无 SAP 行) | buildLmDetailRowsHtml, buildLmPendingRowsHtml | 借贷双行 (每记录 2 行), 红/绿色 |
| oms.js | — (由 renderOrders 处理) | buildOmsDetailRowHtml | 11 列, DD/SO 源单交叉引用, is_split 分支 |

---

## 3. 测试编写模式

### 行构建函数测试用例清单 (每个模块 5-6 个)
1. **正常 open 行**: 验证非 done 样式、按钮可用
2. **完成行**: open=0 → `line-done` class、按钮 disabled
3. **headerClosed 强制完成**: 不论 open 是否 >0
4. **lineStatus='C' 关闭行**: SAP 侧关闭
5. **部分完成**: 已收 < 待收，显示正确数量
6. **条码 URL**: 验证 `generateBarcodeUrl` 调用结果嵌入 img src

### 历史构建函数测试用例清单 (每个模块 3-4 个)
1. **空数组**: 返回空字符串
2. **null/undefined**: 返回空字符串
3. **单条记录**: 验证字段正确
4. **多条记录**: 验证行数

### XSS 测试关键点
- **文本列必须经过 escapeHtml**: 验证 `&lt;` 等转义
- **img src 中的 itemCode**: 不在 HTML 文本上下文，不需要 HTML 转义 (URL 编码由 generateBarcodeUrl 处理)
- **测试写法**: `expect(html).toContain('&lt;b&gt;')` 而非 `expect(html).not.toContain('<script>')`

---

## 4. 统计数据维护教训 (严重)

### 问题
统计数据 (用例数/文件数/覆盖率) 在多处引用，容易不一致:
- CLAUDE.md 目录树注释
- ADR-006 多个章节 (汇总表、路线图、决策、摘要)
- 变更日志

### 解决方案: 更新统计数据的 SOP
1. **运行测试获取精确数字**: `npm test` (Jest), 计数 E2E/BATS/pytest/SQL
2. **全量搜索所有引用**: `grep -rn "1901\|SQL 56\|~2071" CLAUDE.md docs/ADR/`
3. **逐个替换**: 不要只改一处就提交
4. **区分历史快照 vs 当前数据**: "1901 → 1956" 是合法的历史记录

### SQL 断言计数方法
```bash
grep -c "RAISE NOTICE 'PASS" tests/sql/*.sql
# 05: 25, 06: 5, 07: 20, 08: 11, 09: 8 = 69
```

### E2E 场景计数方法
```bash
grep -c "test\(" tests/e2e/*.spec.js
# dashboard:12, login:9, oms-dd-split:14, so-pick:11, stock-query:8 = 54
```

---

## 5. E2E 测试模式 (Playwright)

### 架构
```
python3 -m http.server 3000 (静态文件服务)
  └── page.route() 拦截所有 /api/** 请求
  └── localStorage 注入认证令牌
  └── Network Interception 返回 mock 数据
```

### 关键技巧
- **不需要后端**: 所有 API 调用通过 `page.route()` mock
- **认证**: `page.evaluate(() => localStorage.setItem('token', '...'))`
- **导航等待**: `page.waitForLoadState('networkidle')`
- **触发条件**: 仅在 `apps/wms/**`、`tests/e2e/**` 变更时运行 (非每次 CI)

---

## 6. Istanbul 沙盒穿透模式

### 问题
Jest 使用 `vm.Script` 执行被测文件，标准 Istanbul 无法收集覆盖率。

### 解决方案
在 `tests/unit/wms/setup.js` 中:
1. 手动为每个源文件创建 Istanbul instrumenter
2. 将插桩后的代码在 vm 中执行
3. 从 vm context 中提取 `__coverage__` 合并到全局

### DOM API 动态委托
- jsdom 缺少 Audio API → 在 setup.js 中 mock
- `document.createElement('audio')` 返回带 `play()`, `pause()` 的 mock 对象
- 确保核心业务函数 100% 可测

---

## 7. 检查清单: 新增测试后

- [ ] 运行 `npm test` 确认全部通过
- [ ] 更新 ADR-006 统计数据 (全量搜索旧数字)
- [ ] 更新 CLAUDE.md 目录树注释中的用例数
- [ ] 更新 CLAUDE.md 变更日志
- [ ] 如果新增 SQL 测试文件，计数 `RAISE NOTICE 'PASS'` 更新总数
- [ ] 如果新增 E2E 文件，计数 `test(` 更新总数
- [ ] 提交时包含精确的用例数增量 (如 "Jest 1901→1956 (+55)")

---

## 8. 分支覆盖率提升经验与教训 (v0.3.2, 2026-03-15)

### 8.1 P0 教训: oms.js Branch 80.87% 逼近阈值

**问题**: oms.js 是仓库中唯一 Branch 覆盖率接近 80% 阈值的文件 (余量仅 0.87%)。新增任何未覆盖分支都会导致 CI 失败。

**根因分析**: 157 个未覆盖分支中:
- ~95 个位于 Vue IIFE (L1631-1864) — 架构天花板，无法单测
- ~62 个位于非 Vue 区域但未被覆盖 — **这些是可以测试的**

**解决策略 (实测有效)**:
1. **`binary-expr` 分支最多**: `o.doc_type || ''`、`ln.item_name || ''` 等 `||` 短路表达式。只需传入缺少对应字段的测试数据即可触发 falsy 分支
2. **PrintService 内部 HTML 生成**: 传入缺字段的订单对象 (无 bp_name、无 item_name、无 warehouse_code)，覆盖大量 `|| '-'` 和 `|| ''` 分支
3. **不同 doc_type 路径**: DD 使用 `doc_number` 而非 `sap_doc_num`，WO 有 BOM 合并逻辑，分别构建测试数据
4. **API 失败路径**: batch API 失败 → fallback 逐个加载、逐个也失败 → `_loadError`

**结果**: Branch 80.87% → 84.65% (+3.78%)，仅新增 42 个测试用例

### 8.2 关键发现: 哪些分支不可覆盖

| 类型 | 原因 | 应对 |
|------|------|------|
| Vue IIFE (L1631-1864) | jsdom 无 Vue 运行时 | 委托纯函数 (已完成 16 个)，剩余由 E2E 覆盖 |
| `_isLoadingDoc` 闭包变量 (shared.js L309) | sandbox 闭包无法从外部设置 | E2E 覆盖 |
| Modal addEventListener (shared.js L632/643) | DOM 事件在沙盒中无法模拟点击 | E2E 覆盖 |
| `typeof module === 'undefined'` (stock.js L450) | Jest 环境结构性不可达 | 忽略 (死代码) |
| IIFE sessionStorage catch (shared.js L23) | 仅在浏览器环境执行 | E2E 覆盖 |

### 8.3 高效提升覆盖率的优先顺序

1. **先查 `binary-expr` 分支**: 这类分支最多也最容易覆盖，只需传入 null/undefined/空值数据
2. **再查 `if` 分支**: 条件分支需要构建特定场景 (如 batch API 失败)
3. **最后查 `cond-expr` 分支**: 三元表达式的 falsy 分支
4. **不碰 Vue/闭包**: 这些分支无法在 jsdom 中覆盖，投入产出比为零

### 8.4 SQL 测试编写模式

```sql
-- 标准模式: DO 块 + 内部 BEGIN...EXCEPTION...END
DO $$
BEGIN
  BEGIN
    -- 执行应被拒绝的操作
    INSERT INTO ... VALUES (...);
    RAISE EXCEPTION 'FAIL: 描述';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: 描述';
    WHEN raise_exception THEN
      RAISE NOTICE 'PASS: 触发器拦截';
  END;
END $$;

-- 触发器行为验证: 插入 → 等待 → 更新 → 比较时间戳
DO $$
DECLARE _ts1 TIMESTAMPTZ; _ts2 TIMESTAMPTZ;
BEGIN
  INSERT INTO ... RETURNING updated_at INTO _ts1;
  PERFORM pg_sleep(0.01);
  UPDATE ... ;
  SELECT updated_at INTO _ts2 FROM ... ;
  IF _ts2 > _ts1 THEN RAISE NOTICE 'PASS: ...';
  ELSE RAISE EXCEPTION 'FAIL: ...';
  END IF;
  DELETE FROM ... ; -- 清理
END $$;
```

### 8.5 文档同步教训 (再次强调)

统计数据分布在 **5 个位置**，必须全量更新:
1. `CLAUDE.md` — 运行测试注释 (`Jest, 48 文件, N 用例`)
2. `CLAUDE.md` — 目录树注释 (`BATS N 文件`)
3. `docs/ADR/006-test-coverage-analysis.md` — 上下文行、统计表、总用例
4. `.claude/skills/test-coverage-improvement.md` — 金字塔数字
5. `docs/test-coverage-analysis-*.md` — 当次报告

**SOP**: 提交前用 `grep -rn "旧数字" CLAUDE.md docs/ .claude/` 全量搜索确认无遗漏
