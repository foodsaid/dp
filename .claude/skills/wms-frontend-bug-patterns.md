# WMS 前端常见 Bug 模式

> **适用**: WMS 前端 (apps/wms/*.html + shared.js)
> **更新**: 2026-02-25 v1.0

---

## Bug #1: 切换行时输入框状态残留

### 症状
用户在 A 行填写备注/批次/其他输入后，切换到 B 行时，A 行的输入值仍然留在输入框中，导致误提交。

### 根因
`selectLine()` 函数中只更新了物料名称和数量，但没有清空其他输入框。

### 排查清单
```
每个操作页面的 selectLine() 函数必须清空:
□ 备注输入框 (xxxRemark.value = '')
□ 批次输入框 (batchNumber.value = '') — 仅 PO
□ 生产日期   (productionDate.value = '') — 仅 PO
□ 任何用户可编辑的自由文本字段
```

### 受影响页面及修复状态
| 页面 | 备注字段 ID | selectLine 清空 |
|------|------------|----------------|
| po.html | receiptRemark | ✅ 已有 |
| pi.html | issueRemark | ✅ v0.1.3 修复 |
| so.html | pickRemark | ✅ v0.1.3 修复 |
| tr.html | moveRemark | ✅ v0.1.3 修复 |
| wo.html | receiptRemark | N/A (单行无selectLine) |

### 修复模板
```javascript
// 在 selectLine() 中, show('xxxCard') 之前加入:
// 清空备注 (防止上一行备注带入)
document.getElementById('xxxRemark').value = '';
```

---

## Bug #2: Auto Complete 过早完成单据

### 症状
用户只做了 1 行（如 8 行中的 1 行），整个单据就被标记为 completed。

### 根因
wf02-transaction 的 Auto Complete Doc 检查 `NOT EXISTS (wms_status != 'completed')` on `wms_document_lines`，
但该表只包含用户已扫描/操作过的行。做完 1 行 = 表中只有 1 行 = 全部完成。

### 解法
在 SAP 查询工作流 (wf1a~wf1e) 中预填 SAP 全量行到 wms_document_lines，
确保 Auto Complete 能看到所有行。

### 实施模式
```
SAP 查询工作流:
  Merge Data → [Prepare Prefill] → [Prefill WMS] → Respond

Prepare Prefill (Code 节点):
  - 从 SAP 数据构建 INSERT SQL
  - CTE 原子操作: WITH doc AS (INSERT INTO documents... RETURNING id) INSERT INTO lines...
  - ON CONFLICT: 不覆盖 actual_qty/status/wms_status (WMS 已操作数据为准)

Prefill WMS (PostgreSQL 节点):
  - 执行 {{ $json._prefillSql }}
```

### CHECK 约束参考
```
wms_documents.status:      'draft' | 'in_progress' | 'completed' | 'cancelled' | 'exported'
wms_documents.wms_status:  'pending' | 'in_progress' | 'completed' | 'exported'
wms_document_lines.status: 'pending' | 'partial' | 'completed' | 'cancelled'
wms_document_lines.wms_status: 'pending' | 'partial' | 'completed'

⚠️ 注意: documents.status 没有 'pending'! 新建用 'draft'
```

---

## Bug #3: 扫码枪连发防护

### 症状
工业扫码枪在 100-300ms 内连续触发两次相同条码，导致重复提交。

### 解法
shared.js 中 `handleBarcodeScan()` 加入去重保护:
```javascript
var SCAN_DEDUP_MS = 800;
var _lastScanCode = '', _lastScanTime = 0;
function handleBarcodeScan(code) {
    var now = Date.now();
    if (code === _lastScanCode && (now - _lastScanTime) < SCAN_DEDUP_MS) return;
    _lastScanCode = code; _lastScanTime = now;
    // ... 正常处理
}
```

---

## Bug #4: 扫码出错后焦点丢失

### 症状
扫码出错 (如"找不到物料") 后，焦点跑到错误提示或其他位置，用户需要手动点回扫码框才能继续扫。

### 解法
所有错误分支和 showMessage 后都要调用 `focusScanInput()`:
```javascript
if (error) {
    showMessage('错误信息', 'error');
    playErrorSound();
    focusScanInput();  // ← 关键! 确保焦点回到扫码框
    return;
}
```

---

## 新功能开发排查模板

```
新增页面功能时，按以下清单检查:

=== 输入状态管理 ===
□ selectLine() 切换行时，所有用户输入框是否清空？
□ handleSubmit() 提交后，表单是否重置？
□ cancelXxx() 取消后，焦点是否回到扫码框？

=== 扫码体验 ===
□ 错误分支是否都有 focusScanInput()？
□ suppressScanFocus() 是否在需要时调用？（防止输入焦点被抢）
□ 扫码去重保护 (SCAN_DEDUP_MS) 是否生效？

=== 数据一致性 ===
□ 前端 hasOpenLines 判断与后端 Auto Complete 逻辑是否一致？
□ ON CONFLICT 是否保护已有 WMS 数据不被覆盖？
□ company_code 是否正确传递？
```

## 变更日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-02-25 | v1.0 | 初始创建: 4 个 Bug 模式 + 排查模板 |
