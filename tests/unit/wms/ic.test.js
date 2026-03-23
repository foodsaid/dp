/**
 * ic.js 盘点页纯函数单元测试
 * 覆盖: 交易合并 / 条码校验 / 防重复扫码 / 差异计算 / payload 构建
 *
 * 纯函数通过 require() 直接导入，无需 DOM 环境
 */

const {
  mergeTransactions,
  formatCountedText,
  validateItemBarcode,
  findPendingIndex,
  preparePendingEntry,
  buildCountPayload,
  filterStockByBin,
  summarizeStock,
  buildIcDetailRowsHtml,
  buildIcPendingRowsHtml,
} = require('../../../apps/wms/ic');

// ============================================================================
// mergeTransactions — 交易记录合并
// ============================================================================

describe('mergeTransactions — 交易记录合并', () => {

  test('空数组返回空结果', () => {
    var result = mergeTransactions([]);
    expect(result.mergedMap).toEqual({});
    expect(result.mergedLines).toEqual([]);
    expect(result.uniqueItemCount).toBe(0);
  });

  test('null/undefined 输入安全处理', () => {
    expect(mergeTransactions(null).mergedLines).toEqual([]);
    expect(mergeTransactions(undefined).mergedLines).toEqual([]);
  });

  test('单条交易记录正常合并', () => {
    var txns = [
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 5, bin_location: 'A01', transaction_time: '2026-03-01 10:00:00' }
    ];
    var result = mergeTransactions(txns);
    expect(result.mergedLines).toHaveLength(1);
    expect(result.mergedLines[0].item_code).toBe('ITEM-001');
    expect(result.mergedLines[0].actual_qty).toBe(5);
    expect(result.uniqueItemCount).toBe(1);
  });

  test('同物料同库位多条交易 SUM 累加', () => {
    var txns = [
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 5, bin_location: 'A01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 3, bin_location: 'A01', transaction_time: '2026-03-01 10:05:00' },
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: -2, bin_location: 'A01', transaction_time: '2026-03-01 10:10:00' },
    ];
    var result = mergeTransactions(txns);
    expect(result.mergedLines).toHaveLength(1);
    expect(result.mergedLines[0].actual_qty).toBe(6); // 5 + 3 + (-2)
    expect(result.mergedLines[0].updated_at).toBe('2026-03-01 10:10:00');
    expect(result.uniqueItemCount).toBe(1);
  });

  test('同物料不同库位分别统计', () => {
    var txns = [
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 5, bin_location: 'A01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 3, bin_location: 'B02', transaction_time: '2026-03-01 10:00:00' },
    ];
    var result = mergeTransactions(txns);
    expect(result.mergedLines).toHaveLength(2);
    expect(result.uniqueItemCount).toBe(1); // 同一物料，去重后只有 1 种
  });

  test('不同物料分别统计', () => {
    var txns = [
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 5, bin_location: 'A01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'ITEM-002', item_name: '螺母', quantity: 10, bin_location: 'A01', transaction_time: '2026-03-01 10:00:00' },
    ];
    var result = mergeTransactions(txns);
    expect(result.mergedLines).toHaveLength(2);
    expect(result.uniqueItemCount).toBe(2);
  });

  test('空库位视为同一组', () => {
    var txns = [
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 5, bin_location: '', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 3, transaction_time: '2026-03-01 10:05:00' },
    ];
    var result = mergeTransactions(txns);
    expect(result.mergedLines).toHaveLength(1);
    expect(result.mergedLines[0].actual_qty).toBe(8);
    expect(result.mergedLines[0].bin_location).toBe('');
  });

  test('quantity 非数字时视为 0', () => {
    var txns = [
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 'abc', bin_location: 'A01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 5, bin_location: 'A01', transaction_time: '2026-03-01 10:05:00' },
    ];
    var result = mergeTransactions(txns);
    expect(result.mergedLines[0].actual_qty).toBe(5); // NaN → 0, 0 + 5 = 5
  });

  test('保留最新时间和物料名称', () => {
    var txns = [
      { item_code: 'ITEM-001', item_name: '旧名', quantity: 5, bin_location: 'A01', transaction_time: '2026-03-01 08:00:00' },
      { item_code: 'ITEM-001', item_name: '新名', quantity: 3, bin_location: 'A01', transaction_time: '2026-03-01 12:00:00' },
    ];
    var result = mergeTransactions(txns);
    expect(result.mergedLines[0].item_name).toBe('新名');
    expect(result.mergedLines[0].updated_at).toBe('2026-03-01 12:00:00');
  });

  test('mergedMap 键格式为 item_code||bin', () => {
    var txns = [
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 5, bin_location: 'A01', transaction_time: '2026-03-01 10:00:00' },
    ];
    var result = mergeTransactions(txns);
    expect(result.mergedMap).toHaveProperty('ITEM-001||A01');
    expect(result.mergedMap['ITEM-001||A01'].actual_qty).toBe(5);
  });

  test('item_code 为 null/undefined 时 fallback 为空字符串', () => {
    var txns = [
      { item_code: null, item_name: '未知', quantity: 3, bin_location: 'A01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: undefined, item_name: '未知2', quantity: 2, bin_location: 'A01', transaction_time: '2026-03-01 10:05:00' },
    ];
    var result = mergeTransactions(txns);
    // 两条 item_code falsy → fallback '' → 同 key 合并
    expect(result.mergedLines).toHaveLength(1);
    expect(result.mergedLines[0].actual_qty).toBe(5);
    // item_code 为空不计入 uniqueItemCount
    expect(result.uniqueItemCount).toBe(0);
  });

  test('较新记录 item_name 为空时不覆盖已有名称', () => {
    var txns = [
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 5, bin_location: 'A01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'ITEM-001', item_name: '', quantity: 3, bin_location: 'A01', transaction_time: '2026-03-01 12:00:00' },
    ];
    var result = mergeTransactions(txns);
    // 第二条时间更新触发 if(t.transaction_time > ...)，但 item_name 为空不进 if(t.item_name)
    expect(result.mergedLines[0].item_name).toBe('螺丝');
    expect(result.mergedLines[0].updated_at).toBe('2026-03-01 12:00:00');
  });

  test('较新记录 item_name 为 null 时不覆盖已有名称', () => {
    var txns = [
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 5, bin_location: 'A01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'ITEM-001', item_name: null, quantity: 3, bin_location: 'A01', transaction_time: '2026-03-01 12:00:00' },
    ];
    var result = mergeTransactions(txns);
    expect(result.mergedLines[0].item_name).toBe('螺丝');
  });

  test('transaction_time 相同或更早时不更新 (false 分支)', () => {
    var txns = [
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 5, bin_location: 'A01', transaction_time: '2026-03-01 12:00:00' },
      { item_code: 'ITEM-001', item_name: '新名', quantity: 3, bin_location: 'A01', transaction_time: '2026-03-01 08:00:00' },
    ];
    var result = mergeTransactions(txns);
    // 第二条时间更早，不触发时间更新和名称更新
    expect(result.mergedLines[0].updated_at).toBe('2026-03-01 12:00:00');
    expect(result.mergedLines[0].item_name).toBe('螺丝');
  });

  test('大量交易记录性能合并', () => {
    var txns = [];
    for (var i = 0; i < 100; i++) {
      txns.push({ item_code: 'ITEM-' + String(i % 10).padStart(3, '0'), item_name: 'Item ' + (i % 10), quantity: 1, bin_location: 'BIN-' + (i % 3), transaction_time: '2026-03-01 10:' + String(i % 60).padStart(2, '0') + ':00' });
    }
    var result = mergeTransactions(txns);
    // 10 物料 × 3 库位 = 最多 30 行
    expect(result.mergedLines.length).toBeLessThanOrEqual(30);
    expect(result.uniqueItemCount).toBe(10);
  });
});

// ============================================================================
// formatCountedText — 已盘品种文本格式化
// ============================================================================

describe('formatCountedText — 已盘品种文本', () => {

  test('正常格式化', () => {
    expect(formatCountedText(3, 5)).toBe('3 种 / 5 行');
  });

  test('零值', () => {
    expect(formatCountedText(0, 0)).toBe('0 种 / 0 行');
  });

  test('大数值', () => {
    expect(formatCountedText(100, 500)).toBe('100 种 / 500 行');
  });
});

// ============================================================================
// validateItemBarcode — 物料条码格式校验
// ============================================================================

describe('validateItemBarcode — 条码格式校验', () => {

  test('正常条码通过校验', () => {
    expect(validateItemBarcode('ITEM-001')).toEqual({ valid: true });
  });

  test('纯数字条码通过校验', () => {
    expect(validateItemBarcode('1234567890')).toEqual({ valid: true });
  });

  test('短条码通过校验 (即使有多个短横线)', () => {
    expect(validateItemBarcode('A-B-C')).toEqual({ valid: true }); // length <= 15
  });

  test('16字符3段被拦截 (dashParts>2 && length>15)', () => {
    // 'ITEM-001-VARIANT' = 16 chars, 3 parts → 视为合并条码
    var result = validateItemBarcode('ITEM-001-VARIANT');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('物料号异常');
  });

  test('两个条码合并被拦截 (>2个短横线且>15字符)', () => {
    var merged = 'ITEM-001-SOMETHING-EXTRA'; // length > 15, dashes > 2
    var result = validateItemBarcode(merged);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('物料号异常');
  });

  test('空字符串不通过', () => {
    var result = validateItemBarcode('');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('条码为空');
  });

  test('null 不通过', () => {
    var result = validateItemBarcode(null);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('条码为空');
  });

  test('undefined 不通过', () => {
    var result = validateItemBarcode(undefined);
    expect(result.valid).toBe(false);
  });

  test('恰好15字符且3段通过校验 (边界)', () => {
    // 15 chars, 3 parts: 'ABCDE-FGHIJ-KLM' = 15 chars
    var code = 'ABCDE-FGHIJ-KLM';
    expect(code.length).toBe(15);
    expect(code.split('-').length).toBe(3);
    // length > 15 is false (15 is not > 15), so valid
    expect(validateItemBarcode(code)).toEqual({ valid: true });
  });

  test('恰好16字符且3段不通过 (边界)', () => {
    var code = 'ABCDE-FGHIJ-KLMN'; // 16 chars, 3 parts
    expect(code.length).toBe(16);
    expect(code.split('-').length).toBe(3);
    expect(validateItemBarcode(code).valid).toBe(false);
  });

  test('非字符串类型 (数字) → 条码为空', () => {
    var result = validateItemBarcode(12345);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('条码为空');
  });

  test('布尔 false → 条码为空', () => {
    var result = validateItemBarcode(false);
    expect(result.valid).toBe(false);
  });

  test('2段长条码通过校验', () => {
    var code = 'VERY-LONGBARCODESTRING'; // 2 parts, long
    expect(code.split('-').length).toBe(2);
    expect(validateItemBarcode(code)).toEqual({ valid: true });
  });
});

// ============================================================================
// findPendingIndex — 待提交清单重复查找
// ============================================================================

describe('findPendingIndex — 重复项查找', () => {

  var pending = [
    { itemCode: 'ITEM-001', bin: 'A01' },
    { itemCode: 'ITEM-002', bin: '' },
    { itemCode: 'ITEM-003', bin: 'B01' },
  ];

  test('找到匹配项返回索引', () => {
    expect(findPendingIndex(pending, 'ITEM-001', 'A01')).toBe(0);
    expect(findPendingIndex(pending, 'ITEM-002', '')).toBe(1);
    expect(findPendingIndex(pending, 'ITEM-003', 'B01')).toBe(2);
  });

  test('物料相同但库位不同返回 -1', () => {
    expect(findPendingIndex(pending, 'ITEM-001', 'B01')).toBe(-1);
  });

  test('物料不存在返回 -1', () => {
    expect(findPendingIndex(pending, 'ITEM-999', 'A01')).toBe(-1);
  });

  test('空清单返回 -1', () => {
    expect(findPendingIndex([], 'ITEM-001', 'A01')).toBe(-1);
  });

  test('null 清单安全处理', () => {
    expect(findPendingIndex(null, 'ITEM-001', 'A01')).toBe(-1);
  });

  test('undefined 清单安全处理', () => {
    expect(findPendingIndex(undefined, 'ITEM-001', '')).toBe(-1);
  });
});

// ============================================================================
// preparePendingEntry — 核心差异计算逻辑
// ============================================================================

describe('preparePendingEntry — 差异计算', () => {

  var NOW = '2026-03-01 10:30:00';

  // --- 场景 1: 全新条目 (无重复) ---

  test('全新条目直接添加，无需确认', () => {
    var result = preparePendingEntry([], {}, 'ITEM-001', '螺丝', 10, 'A01', '首次盘点', NOW);
    expect(result.action).toBe('add');
    expect(result.needConfirm).toBe(false);
    expect(result.entry).toEqual({
      itemCode: 'ITEM-001', itemName: '螺丝', qty: 10,
      bin: 'A01', remark: '首次盘点', sendQty: 10, addedAt: NOW
    });
  });

  test('全新条目无库位', () => {
    var result = preparePendingEntry([], {}, 'ITEM-001', '螺丝', 5, '', '', NOW);
    expect(result.action).toBe('add');
    expect(result.needConfirm).toBe(false);
    expect(result.entry.bin).toBe('');
    expect(result.entry.sendQty).toBe(5);
  });

  // --- 场景 2: 待提交清单中已有同物料+同库位 ---

  test('待提交重复 - 数量相同跳过', () => {
    var pending = [{ itemCode: 'ITEM-001', bin: 'A01', qty: 10 }];
    var result = preparePendingEntry(pending, {}, 'ITEM-001', '螺丝', 10, 'A01', '', NOW);
    expect(result.action).toBe('skip');
    expect(result.message).toContain('数量未变');
    expect(result.message).toContain('ITEM-001');
  });

  test('待提交重复 - 数量不同需确认覆盖', () => {
    var pending = [{ itemCode: 'ITEM-001', bin: 'A01', qty: 10 }];
    var result = preparePendingEntry(pending, {}, 'ITEM-001', '螺丝', 15, 'A01', '修正', NOW);
    expect(result.action).toBe('update');
    expect(result.needConfirm).toBe(true);
    expect(result.confirmMsg).toContain('ITEM-001');
    expect(result.confirmMsg).toContain('10');
    expect(result.confirmMsg).toContain('15');
    expect(result.pendingIdx).toBe(0);
    expect(result.updates).toEqual({ qty: 15, remark: '修正', addedAt: NOW });
  });

  test('待提交重复 - 库位为空时也能正确匹配', () => {
    var pending = [{ itemCode: 'ITEM-001', bin: '', qty: 5 }];
    var result = preparePendingEntry(pending, {}, 'ITEM-001', '螺丝', 5, '', '', NOW);
    expect(result.action).toBe('skip');
  });

  // --- 场景 3: 后端已有记录 (mergedCounts) ---

  test('后端已有记录 - 数量相同跳过', () => {
    var merged = { 'ITEM-001||A01': { actual_qty: 10 } };
    var result = preparePendingEntry([], merged, 'ITEM-001', '螺丝', 10, 'A01', '', NOW);
    expect(result.action).toBe('skip');
    expect(result.message).toContain('数量未变');
  });

  test('后端已有记录 - 数量不同需确认，计算 delta', () => {
    var merged = { 'ITEM-001||A01': { actual_qty: 10 } };
    var result = preparePendingEntry([], merged, 'ITEM-001', '螺丝', 15, 'A01', '', NOW);
    expect(result.action).toBe('add');
    expect(result.needConfirm).toBe(true);
    expect(result.confirmMsg).toContain('10');
    expect(result.confirmMsg).toContain('15');
    expect(result.entry.sendQty).toBe(5); // 15 - 10 = 5 (delta)
    expect(result.entry.qty).toBe(15);
    expect(result.entry.remark).toContain('覆盖: 10 → 15');
  });

  test('后端已有记录 - 减少数量时 delta 为负', () => {
    var merged = { 'ITEM-001||A01': { actual_qty: 20 } };
    var result = preparePendingEntry([], merged, 'ITEM-001', '螺丝', 5, 'A01', '', NOW);
    expect(result.entry.sendQty).toBe(-15); // 5 - 20 = -15
  });

  test('后端已有记录 - 备注拼接', () => {
    var merged = { 'ITEM-001||A01': { actual_qty: 10 } };
    var result = preparePendingEntry([], merged, 'ITEM-001', '螺丝', 20, 'A01', '二次盘点', NOW);
    expect(result.entry.remark).toBe('二次盘点; 覆盖: 10 → 20');
  });

  test('后端已有记录 - 无原始备注时不加分号', () => {
    var merged = { 'ITEM-001||A01': { actual_qty: 10 } };
    var result = preparePendingEntry([], merged, 'ITEM-001', '螺丝', 20, 'A01', '', NOW);
    expect(result.entry.remark).toBe('覆盖: 10 → 20');
  });

  // --- 场景 4: 待提交优先于后端 ---

  test('待提交清单和后端都有时，优先走待提交逻辑', () => {
    var pending = [{ itemCode: 'ITEM-001', bin: 'A01', qty: 10 }];
    var merged = { 'ITEM-001||A01': { actual_qty: 5 } };
    // pending 中已有，应走 update 逻辑而非 add+delta
    var result = preparePendingEntry(pending, merged, 'ITEM-001', '螺丝', 20, 'A01', '', NOW);
    expect(result.action).toBe('update');
    expect(result.pendingIdx).toBe(0);
  });

  // --- 场景 5: 确认消息中包含库位信息 ---

  test('确认消息 - 有库位时显示', () => {
    var pending = [{ itemCode: 'ITEM-001', bin: 'A01', qty: 10 }];
    var result = preparePendingEntry(pending, {}, 'ITEM-001', '螺丝', 20, 'A01', '', NOW);
    expect(result.confirmMsg).toContain('库位 A01');
  });

  test('确认消息 - 无库位时不显示', () => {
    var pending = [{ itemCode: 'ITEM-001', bin: '', qty: 10 }];
    var result = preparePendingEntry(pending, {}, 'ITEM-001', '螺丝', 20, '', '', NOW);
    expect(result.confirmMsg).not.toContain('库位');
  });

  // --- 场景 6: mergedCounts 为 null/undefined ---

  test('mergedCounts 为 null 时安全处理', () => {
    var result = preparePendingEntry([], null, 'ITEM-001', '螺丝', 10, '', '', NOW);
    expect(result.action).toBe('add');
    expect(result.needConfirm).toBe(false);
  });

  test('mergedCounts 为 undefined 时安全处理', () => {
    var result = preparePendingEntry([], undefined, 'ITEM-001', '螺丝', 10, 'A01', '', NOW);
    expect(result.action).toBe('add');
  });

  // --- 场景 7: 边界数量 ---

  test('数量为 0 的新条目正常添加', () => {
    var result = preparePendingEntry([], {}, 'ITEM-001', '螺丝', 0, '', '', NOW);
    expect(result.action).toBe('add');
    expect(result.entry.sendQty).toBe(0);
  });

  test('负数差异正常处理', () => {
    var result = preparePendingEntry([], {}, 'ITEM-001', '螺丝', -5, 'A01', '实际少5个', NOW);
    expect(result.action).toBe('add');
    expect(result.entry.sendQty).toBe(-5);
    expect(result.entry.qty).toBe(-5);
  });

  test('浮点数差异精确计算', () => {
    var merged = { 'ITEM-001||A01': { actual_qty: 1.5 } };
    var result = preparePendingEntry([], merged, 'ITEM-001', '螺丝', 3.7, 'A01', '', NOW);
    expect(result.entry.sendQty).toBeCloseTo(2.2, 10);
  });

  test('itemCode 为 null/空时 key 构建安全', () => {
    var merged = { '||A01': { actual_qty: 5 } };
    var result = preparePendingEntry([], merged, null, '未知', 5, 'A01', '', NOW);
    // itemCode 为 null → key = '||A01' 命中后端记录，数量相同 → skip
    expect(result.action).toBe('skip');
  });

  test('itemCode 为空字符串 + 后端有记录 → delta 计算', () => {
    var merged = { '||B01': { actual_qty: 10 } };
    var result = preparePendingEntry([], merged, '', '未知', 15, 'B01', '', NOW);
    expect(result.action).toBe('add');
    expect(result.entry.sendQty).toBe(5); // 15 - 10
  });

  test('后端 actual_qty 为 NaN/非数字时回退为 0', () => {
    var merged = { 'ITEM-001||A01': { actual_qty: 'abc' } };
    var result = preparePendingEntry([], merged, 'ITEM-001', '螺丝', 10, 'A01', '', NOW);
    // Number('abc') || 0 = 0, qty=10 !== 0 → add with delta = 10 - 0 = 10
    expect(result.action).toBe('add');
    expect(result.entry.sendQty).toBe(10);
  });

  test('后端 actual_qty 为 null 时回退为 0', () => {
    var merged = { 'ITEM-001||': { actual_qty: null } };
    var result = preparePendingEntry([], merged, 'ITEM-001', '螺丝', 5, '', '', NOW);
    // Number(null) = 0, qty=5 !== 0 → add with delta = 5
    expect(result.action).toBe('add');
    expect(result.entry.sendQty).toBe(5);
  });

  test('后端 actual_qty 为字符串时转为数字', () => {
    var merged = { 'ITEM-001||': { actual_qty: '10' } };
    var result = preparePendingEntry([], merged, 'ITEM-001', '螺丝', 15, '', '', NOW);
    expect(result.entry.sendQty).toBe(5);
  });
});

// ============================================================================
// buildCountPayload — 提交 payload 构建
// ============================================================================

describe('buildCountPayload — payload 构建', () => {

  test('标准 payload 构建', () => {
    var entry = {
      itemCode: 'ITEM-001', itemName: '螺丝', qty: 10,
      bin: 'A01', remark: '盘点', sendQty: 10,
      addedAt: '2026-03-01 10:00:00'
    };
    var payload = buildCountPayload('IC20260301001', 'WH01', '张三', entry);
    expect(payload).toEqual({
      doc_type: 'IC',
      doc_number: 'IC20260301001',
      item_code: 'ITEM-001',
      item_name: '螺丝',
      quantity: 10,
      warehouse_code: 'WH01',
      bin_location: 'A01',
      performed_by: '张三',
      action: 'count',
      remarks: '盘点',
      planned_qty: 0,
      transaction_time: '2026-03-01 10:00:00'
    });
  });

  test('有 sendQty 时使用 sendQty 而非 qty', () => {
    var entry = { itemCode: 'ITEM-001', itemName: '螺丝', qty: 15, sendQty: 5, bin: '', remark: '', addedAt: '' };
    var payload = buildCountPayload('IC001', 'WH01', '张三', entry);
    expect(payload.quantity).toBe(5); // sendQty 优先
  });

  test('sendQty 为 undefined 时回退到 qty', () => {
    var entry = { itemCode: 'ITEM-001', itemName: '螺丝', qty: 10, bin: '', remark: '', addedAt: '' };
    var payload = buildCountPayload('IC001', 'WH01', '张三', entry);
    expect(payload.quantity).toBe(10); // 回退到 qty
  });

  test('sendQty 为 0 时使用 0 (不回退)', () => {
    var entry = { itemCode: 'ITEM-001', itemName: '螺丝', qty: 10, sendQty: 0, bin: '', remark: '', addedAt: '' };
    var payload = buildCountPayload('IC001', 'WH01', '张三', entry);
    expect(payload.quantity).toBe(0); // sendQty = 0 有效
  });

  test('sendQty 为负数时正常传递', () => {
    var entry = { itemCode: 'ITEM-001', itemName: '螺丝', qty: 5, sendQty: -15, bin: 'A01', remark: '覆盖', addedAt: '2026-03-01 12:00:00' };
    var payload = buildCountPayload('IC001', 'WH01', '张三', entry);
    expect(payload.quantity).toBe(-15);
  });

  test('doc_type 始终为 IC', () => {
    var entry = { itemCode: 'X', itemName: 'Y', qty: 1, sendQty: 1, bin: '', remark: '', addedAt: '' };
    var payload = buildCountPayload('IC999', 'WH01', '张三', entry);
    expect(payload.doc_type).toBe('IC');
  });

  test('planned_qty 始终为 0', () => {
    var entry = { itemCode: 'X', itemName: 'Y', qty: 1, sendQty: 1, bin: '', remark: '', addedAt: '' };
    var payload = buildCountPayload('IC999', 'WH01', '张三', entry);
    expect(payload.planned_qty).toBe(0);
  });

  test('空值字段正常传递', () => {
    var entry = { itemCode: '', itemName: '', qty: 0, sendQty: 0, bin: '', remark: '', addedAt: '' };
    var payload = buildCountPayload('', '', '', entry);
    expect(payload.doc_number).toBe('');
    expect(payload.item_code).toBe('');
    expect(payload.bin_location).toBe('');
  });
});

// ============================================================================
// 集成场景 — 完整盘点流程纯函数串联
// ============================================================================

describe('集成场景 — 盘点流程', () => {

  test('场景: 首次盘点 3 个物料，合并后再计算差异', () => {
    // 1. 首次盘点，后端无历史
    var pending = [];
    var merged = {};

    // 添加 3 个物料
    var r1 = preparePendingEntry(pending, merged, 'ITEM-001', '螺丝', 10, 'A01', '', '2026-03-01 10:00:00');
    expect(r1.action).toBe('add');
    pending.push(r1.entry);

    var r2 = preparePendingEntry(pending, merged, 'ITEM-002', '螺母', 20, 'A01', '', '2026-03-01 10:01:00');
    expect(r2.action).toBe('add');
    pending.push(r2.entry);

    var r3 = preparePendingEntry(pending, merged, 'ITEM-003', '垫片', 5, 'B01', '', '2026-03-01 10:02:00');
    expect(r3.action).toBe('add');
    pending.push(r3.entry);

    expect(pending).toHaveLength(3);

    // 2. 构建 payload
    var payloads = pending.map(function(e) { return buildCountPayload('IC001', 'WH01', '张三', e); });
    expect(payloads).toHaveLength(3);
    expect(payloads[0].item_code).toBe('ITEM-001');
    expect(payloads[1].quantity).toBe(20);
    expect(payloads[2].bin_location).toBe('B01');
  });

  test('场景: 二次盘点覆盖已有后端记录', () => {
    // 后端已有 ITEM-001 的盘点记录 (qty=10)
    var merged = { 'ITEM-001||A01': { actual_qty: 10 } };
    var pending = [];

    // 用户修正为 15
    var result = preparePendingEntry(pending, merged, 'ITEM-001', '螺丝', 15, 'A01', '', '2026-03-01 11:00:00');
    expect(result.action).toBe('add');
    expect(result.needConfirm).toBe(true);
    expect(result.entry.sendQty).toBe(5); // delta = 15 - 10
    expect(result.entry.remark).toContain('覆盖');

    // 构建 payload 验证 delta 传递
    var payload = buildCountPayload('IC001', 'WH01', '张三', result.entry);
    expect(payload.quantity).toBe(5);
  });

  test('场景: 防连击 — 同一物料连续扫码数量相同', () => {
    var pending = [{ itemCode: 'ITEM-001', bin: 'A01', qty: 10 }];

    // 再次提交相同数量
    var r1 = preparePendingEntry(pending, {}, 'ITEM-001', '螺丝', 10, 'A01', '', '2026-03-01 10:05:00');
    expect(r1.action).toBe('skip');

    // 不同数量则允许覆盖
    var r2 = preparePendingEntry(pending, {}, 'ITEM-001', '螺丝', 20, 'A01', '', '2026-03-01 10:05:00');
    expect(r2.action).toBe('update');
  });

  test('场景: 合并交易后格式化文本', () => {
    var txns = [
      { item_code: 'A', item_name: 'X', quantity: 1, bin_location: 'B1', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'A', item_name: 'X', quantity: 2, bin_location: 'B2', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'B', item_name: 'Y', quantity: 3, bin_location: 'B1', transaction_time: '2026-03-01 10:00:00' },
    ];
    var result = mergeTransactions(txns);
    var text = formatCountedText(result.uniqueItemCount, result.mergedLines.length);
    expect(text).toBe('2 种 / 3 行');
  });

  test('场景: 条码校验 + 差异计算串联', () => {
    // 1. 校验条码
    var check = validateItemBarcode('ITEM-001');
    expect(check.valid).toBe(true);

    // 2. 盘点
    var result = preparePendingEntry([], {}, 'ITEM-001', '螺丝', 10, '', '', '2026-03-01 10:00:00');
    expect(result.action).toBe('add');

    // 3. 构建 payload
    var payload = buildCountPayload('IC001', 'WH01', '张三', result.entry);
    expect(payload.doc_type).toBe('IC');
    expect(payload.item_code).toBe('ITEM-001');
  });
});

// ============================================================================
// filterStockByBin — 库存数据按库位过滤
// ============================================================================

describe('filterStockByBin — 库位过滤', () => {

  var stockData = [
    { item_code: 'ITEM-001', bin_code: 'A01', base_qty: 10, delta_qty: 2, real_time_qty: 12 },
    { item_code: 'ITEM-001', bin_code: 'B02', base_qty: 5, delta_qty: -1, real_time_qty: 4 },
    { item_code: 'ITEM-001', bin_code: '', base_qty: 3, delta_qty: 0, real_time_qty: 3 },
  ];

  test('空库位不过滤，返回全部', () => {
    expect(filterStockByBin(stockData, '')).toHaveLength(3);
    expect(filterStockByBin(stockData, null)).toHaveLength(3);
    expect(filterStockByBin(stockData, undefined)).toHaveLength(3);
  });

  test('匹配库位 + 空库位行保留', () => {
    var result = filterStockByBin(stockData, 'A01');
    expect(result).toHaveLength(2); // A01 + empty
    expect(result[0].bin_code).toBe('A01');
    expect(result[1].bin_code).toBe('');
  });

  test('大小写不敏感', () => {
    expect(filterStockByBin(stockData, 'a01')).toHaveLength(2);
    expect(filterStockByBin(stockData, 'b02')).toHaveLength(2);
  });

  test('不存在的库位只返回空库位行', () => {
    var result = filterStockByBin(stockData, 'Z99');
    expect(result).toHaveLength(1);
    expect(result[0].bin_code).toBe('');
  });

  test('空数据安全处理', () => {
    expect(filterStockByBin([], 'A01')).toHaveLength(0);
    expect(filterStockByBin(null, 'A01')).toHaveLength(0);
    expect(filterStockByBin(undefined, '')).toHaveLength(0);
  });

  test('使用 bins 字段备选', () => {
    var data = [{ item_code: 'X', bins: 'C03', base_qty: 1 }];
    var result = filterStockByBin(data, 'C03');
    expect(result).toHaveLength(1);
  });
});

// ============================================================================
// summarizeStock — 库存汇总
// ============================================================================

describe('summarizeStock — 库存汇总', () => {

  test('正常汇总多行', () => {
    var data = [
      { base_qty: 10, delta_qty: 2, real_time_qty: 12 },
      { base_qty: 5, delta_qty: -1, real_time_qty: 4 },
      { base_qty: 3, delta_qty: 0, real_time_qty: 3 },
    ];
    var result = summarizeStock(data);
    expect(result.base_qty).toBe(18);
    expect(result.delta_qty).toBe(1);
    expect(result.real_time_qty).toBe(19);
    expect(result.rowCount).toBe(3);
  });

  test('单行返回自身', () => {
    var data = [{ base_qty: 10, delta_qty: -3, real_time_qty: 7 }];
    var result = summarizeStock(data);
    expect(result.base_qty).toBe(10);
    expect(result.delta_qty).toBe(-3);
    expect(result.real_time_qty).toBe(7);
    expect(result.rowCount).toBe(1);
  });

  test('空数组返回零', () => {
    var result = summarizeStock([]);
    expect(result.base_qty).toBe(0);
    expect(result.delta_qty).toBe(0);
    expect(result.real_time_qty).toBe(0);
    expect(result.rowCount).toBe(0);
  });

  test('null/undefined 安全处理', () => {
    expect(summarizeStock(null).rowCount).toBe(0);
    expect(summarizeStock(undefined).base_qty).toBe(0);
  });

  test('非数字字段视为 0', () => {
    var data = [{ base_qty: 'abc', delta_qty: null, real_time_qty: undefined }];
    var result = summarizeStock(data);
    expect(result.base_qty).toBe(0);
    expect(result.delta_qty).toBe(0);
    expect(result.real_time_qty).toBe(0);
  });

  test('字符串数字正常转换', () => {
    var data = [{ base_qty: '10', delta_qty: '-3', real_time_qty: '7' }];
    var result = summarizeStock(data);
    expect(result.base_qty).toBe(10);
    expect(result.delta_qty).toBe(-3);
    expect(result.real_time_qty).toBe(7);
  });
});

// ============================================================================
// buildIcDetailRowsHtml — 盘点明细行 HTML 构建
// ============================================================================

describe('buildIcDetailRowsHtml — 盘点明细行 HTML', () => {
  const h = {
    escapeHtml: s => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    formatNumber: n => String(n),
    generateBarcodeUrl: (code, type) => '/barcode/' + code + '/' + type,
    formatDateTime: t => t || '-',
  };

  test('空数组返回空字符串', () => {
    expect(buildIcDetailRowsHtml([], h)).toBe('');
  });

  test('null/undefined 返回空字符串', () => {
    expect(buildIcDetailRowsHtml(null, h)).toBe('');
    expect(buildIcDetailRowsHtml(undefined, h)).toBe('');
  });

  test('单行正常渲染 6 列', () => {
    var lines = [{ item_code: 'A001', item_name: '测试物料', actual_qty: 5, bin_location: 'B01', updated_at: '2026-03-08' }];
    var html = buildIcDetailRowsHtml(lines, h);
    expect(html).toContain('<tr>');
    expect(html).toContain('A001');
    expect(html).toContain('测试物料');
    expect(html).toContain('5');
    expect(html).toContain('B01');
    expect(html).toContain('2026-03-08');
    // 6 列: item_code, barcode, item_name, qty, bin, time
    expect((html.match(/<td/g) || []).length).toBe(6);
  });

  test('多行返回多个 <tr>', () => {
    var lines = [
      { item_code: 'A001', actual_qty: 1, bin_location: '', updated_at: '' },
      { item_code: 'A002', actual_qty: 2, bin_location: 'B02', updated_at: '' },
    ];
    var html = buildIcDetailRowsHtml(lines, h);
    expect((html.match(/<tr>/g) || []).length).toBe(2);
  });

  test('条码 URL 正确嵌入', () => {
    var lines = [{ item_code: 'X123', actual_qty: 0, bin_location: '', updated_at: '' }];
    var html = buildIcDetailRowsHtml(lines, h);
    expect(html).toContain('/barcode/X123/qrcode');
  });

  test('item_name 缺失时显示 -', () => {
    var lines = [{ item_code: 'A001', actual_qty: 0, bin_location: '', updated_at: '' }];
    var html = buildIcDetailRowsHtml(lines, h);
    expect(html).toContain('>-</td>');
  });

  test('XSS 防护 — item_code 转义', () => {
    var lines = [{ item_code: '<b>XSS</b>', actual_qty: 0, bin_location: '', updated_at: '' }];
    var html = buildIcDetailRowsHtml(lines, h);
    expect(html).toContain('&lt;b&gt;XSS&lt;/b&gt;');
  });
});

// ============================================================================
// buildIcPendingRowsHtml — 盘点待提交行 HTML 构建
// ============================================================================

describe('buildIcPendingRowsHtml — 盘点待提交行 HTML', () => {
  const h = {
    escapeHtml: s => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    formatNumber: n => String(n),
    formatDateTime: t => t || '-',
  };

  test('空数组返回空字符串', () => {
    expect(buildIcPendingRowsHtml([], h)).toBe('');
  });

  test('null/undefined 返回空字符串', () => {
    expect(buildIcPendingRowsHtml(null, h)).toBe('');
    expect(buildIcPendingRowsHtml(undefined, h)).toBe('');
  });

  test('单行渲染包含删除按钮', () => {
    var pending = [{ itemCode: 'A001', qty: 10, bin: 'B01', addedAt: '2026-03-08' }];
    var html = buildIcPendingRowsHtml(pending, h);
    expect(html).toContain('A001');
    expect(html).toContain('10');
    expect(html).toContain('B01');
    expect(html).toContain('removePendingCount(0)');
  });

  test('多行索引正确递增', () => {
    var pending = [
      { itemCode: 'A001', qty: 1, bin: '', addedAt: '' },
      { itemCode: 'A002', qty: 2, bin: 'B02', addedAt: '' },
    ];
    var html = buildIcPendingRowsHtml(pending, h);
    expect(html).toContain('removePendingCount(0)');
    expect(html).toContain('removePendingCount(1)');
  });

  test('bin 为空时显示 -', () => {
    var pending = [{ itemCode: 'A001', qty: 1, bin: '', addedAt: '' }];
    var html = buildIcPendingRowsHtml(pending, h);
    expect(html).toContain('>-</td>');
  });
});
