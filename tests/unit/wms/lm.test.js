/**
 * lm.js 移库页纯函数单元测试
 * 覆盖: 移库参数校验 / payload 构建 / 交易合并
 *
 * 纯函数通过 require() 直接导入，无需 DOM 环境
 */

const {
  validateMoveParams,
  buildMovePayload,
  mergeMoveTx,
  buildLmDetailRowsHtml,
  buildLmPendingRowsHtml,
} = require('../../../apps/wms/lm');

// ============================================================================
// validateMoveParams — 移库参数校验
// ============================================================================

describe('validateMoveParams — 移库参数校验', () => {

  // --- 正常通过场景 ---

  test('正常移库 (不同库位, qty > 0) → valid', () => {
    var result = validateMoveParams('A01', 'B01', 10);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.warning).toBeUndefined();
  });

  test('正常移库 + maxQty 未超限 → valid 无 warning', () => {
    var result = validateMoveParams('A01', 'B01', 5, 10);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  test('小数数量正常通过', () => {
    var result = validateMoveParams('A01', 'B01', 0.5);
    expect(result.valid).toBe(true);
  });

  test('qty = maxQty 时无 warning (边界)', () => {
    var result = validateMoveParams('A01', 'B01', 10, 10);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  // --- 核心业务规则: 数量弹性 (qty > maxQty 允许通过) ---

  test('qty > maxQty → valid: true + warning (数量弹性核心规则)', () => {
    var result = validateMoveParams('A01', 'B01', 100, 50);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('100');
    expect(result.warning).toContain('50');
  });

  test('qty 大幅超过 maxQty → 仍然通过', () => {
    var result = validateMoveParams('A01', 'B01', 9999, 1);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeDefined();
  });

  test('浮点 qty > maxQty → valid + warning', () => {
    var result = validateMoveParams('A01', 'B01', 10.5, 10);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeDefined();
  });

  test('maxQty = 0 时不触发 warning', () => {
    var result = validateMoveParams('A01', 'B01', 10, 0);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  test('maxQty = undefined 时不触发 warning', () => {
    var result = validateMoveParams('A01', 'B01', 10, undefined);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  test('maxQty = null 时不触发 warning', () => {
    var result = validateMoveParams('A01', 'B01', 10, null);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  test('maxQty 为负数时不触发 warning', () => {
    var result = validateMoveParams('A01', 'B01', 10, -5);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  // --- 库位校验 ---

  test('fromBin 为空 → invalid', () => {
    var result = validateMoveParams('', 'B01', 10);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('源库位和目标库位');
  });

  test('toBin 为空 → invalid', () => {
    var result = validateMoveParams('A01', '', 10);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('源库位和目标库位');
  });

  test('两者都为空 → invalid', () => {
    var result = validateMoveParams('', '', 10);
    expect(result.valid).toBe(false);
  });

  test('fromBin 为 null → invalid', () => {
    var result = validateMoveParams(null, 'B01', 10);
    expect(result.valid).toBe(false);
  });

  test('toBin 为 undefined → invalid', () => {
    var result = validateMoveParams('A01', undefined, 10);
    expect(result.valid).toBe(false);
  });

  test('fromBin === toBin → invalid', () => {
    var result = validateMoveParams('A01', 'A01', 10);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('不能相同');
  });

  // --- 防御性格式化: trim + toUpperCase ---

  test('大小写不同但实际相同的库位 → invalid (防御性格式化)', () => {
    var result = validateMoveParams('a01', 'A01', 10);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('不能相同');
  });

  test('带前后空格的相同库位 → invalid (防御性 trim)', () => {
    var result = validateMoveParams('  A01  ', 'A01', 10);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('不能相同');
  });

  test('带前后空格的不同库位 → valid', () => {
    var result = validateMoveParams('  A01  ', '  B01  ', 10);
    expect(result.valid).toBe(true);
  });

  test('纯空格视为空 → invalid', () => {
    var result = validateMoveParams('   ', 'B01', 10);
    expect(result.valid).toBe(false);
  });

  // --- 数量校验 ---

  test('qty = 0 → invalid', () => {
    var result = validateMoveParams('A01', 'B01', 0);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('有效数量');
  });

  test('qty < 0 → invalid', () => {
    var result = validateMoveParams('A01', 'B01', -5);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('有效数量');
  });

  test('qty = NaN → invalid', () => {
    var result = validateMoveParams('A01', 'B01', NaN);
    expect(result.valid).toBe(false);
  });

  test('qty = null → invalid', () => {
    var result = validateMoveParams('A01', 'B01', null);
    expect(result.valid).toBe(false);
  });

  test('qty = undefined → invalid', () => {
    var result = validateMoveParams('A01', 'B01', undefined);
    expect(result.valid).toBe(false);
  });

  // --- 切断字符串比较炸弹: Number() 强制转换 ---

  test('qty 为字符串 "10" → 正常转换通过', () => {
    var result = validateMoveParams('A01', 'B01', '10');
    expect(result.valid).toBe(true);
  });

  test('qty 为字符串 "0" → invalid (转换后为 0)', () => {
    var result = validateMoveParams('A01', 'B01', '0');
    expect(result.valid).toBe(false);
  });

  test('qty 为字符串 "abc" → invalid (转换后为 NaN)', () => {
    var result = validateMoveParams('A01', 'B01', 'abc');
    expect(result.valid).toBe(false);
  });

  test('qty 为字符串, maxQty 为字符串 → 正确数值比较', () => {
    // "9" > "50" 在字符串比较中为 true (按字典序), 但数值上 9 < 50
    var result = validateMoveParams('A01', 'B01', '9', '50');
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined(); // 9 < 50, 不应有 warning
  });

  test('字符串 qty > 字符串 maxQty → 正确触发 warning', () => {
    var result = validateMoveParams('A01', 'B01', '100', '50');
    expect(result.valid).toBe(true);
    expect(result.warning).toBeDefined();
  });

  // --- 非字符串类型库位 (typeof 检查覆盖) ---

  test('fromBin 为数字类型 → 视为空 (typeof !== string)', () => {
    var result = validateMoveParams(123, 'B01', 10);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('源库位和目标库位');
  });

  test('toBin 为数字类型 → 视为空 (typeof !== string)', () => {
    var result = validateMoveParams('A01', 456, 10);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('源库位和目标库位');
  });

  test('fromBin 为布尔 true → 视为空 (typeof !== string)', () => {
    var result = validateMoveParams(true, 'B01', 10);
    expect(result.valid).toBe(false);
  });

  test('maxQty 为 NaN 字符串 → 不触发 warning', () => {
    var result = validateMoveParams('A01', 'B01', 10, 'abc');
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });
});

// ============================================================================
// buildMovePayload — 移库行 payload 构建
// ============================================================================

describe('buildMovePayload — payload 构建', () => {

  test('标准 payload 构建 (所有字段正确映射)', () => {
    var payload = buildMovePayload('ITEM-001', 'A01', 'B01', 10, 'BATCH001');
    expect(payload).toEqual({
      item_code: 'ITEM-001',
      from_bin: 'A01',
      bin_location: 'B01',
      quantity: 10,
      batch_number: 'BATCH001'
    });
  });

  test('无批次时 batch_number 为空字符串 (批次弹性核心规则)', () => {
    var payload = buildMovePayload('ITEM-001', 'A01', 'B01', 10);
    expect(payload.batch_number).toBe('');
    // 验证 payload 结构完整
    expect(payload).toHaveProperty('item_code');
    expect(payload).toHaveProperty('from_bin');
    expect(payload).toHaveProperty('bin_location');
    expect(payload).toHaveProperty('quantity');
    expect(payload).toHaveProperty('batch_number');
  });

  test('batch 显式传空字符串 → batch_number 为空', () => {
    var payload = buildMovePayload('ITEM-001', 'A01', 'B01', 10, '');
    expect(payload.batch_number).toBe('');
  });

  test('batch 为 null → batch_number 为空', () => {
    var payload = buildMovePayload('ITEM-001', 'A01', 'B01', 10, null);
    expect(payload.batch_number).toBe('');
  });

  test('batch 为 undefined → batch_number 为空', () => {
    var payload = buildMovePayload('ITEM-001', 'A01', 'B01', 10, undefined);
    expect(payload.batch_number).toBe('');
  });

  test('字段映射: fromBin → from_bin, toBin → bin_location', () => {
    var payload = buildMovePayload('X', 'SRC-01', 'DST-02', 1);
    expect(payload.from_bin).toBe('SRC-01');
    expect(payload.bin_location).toBe('DST-02');
  });

  test('浮点数量精确传递', () => {
    var payload = buildMovePayload('ITEM-001', 'A01', 'B01', 0.0001);
    expect(payload.quantity).toBe(0.0001);
  });

  test('qty = 0 正常传递', () => {
    var payload = buildMovePayload('ITEM-001', 'A01', 'B01', 0);
    expect(payload.quantity).toBe(0);
  });

  test('空字符串字段安全传递', () => {
    var payload = buildMovePayload('', '', '', 0, '');
    expect(payload.item_code).toBe('');
    expect(payload.from_bin).toBe('');
    expect(payload.bin_location).toBe('');
    expect(payload.batch_number).toBe('');
  });

  test('大数量正常传递', () => {
    var payload = buildMovePayload('ITEM-001', 'A01', 'B01', 999999.99);
    expect(payload.quantity).toBe(999999.99);
  });
});

// ============================================================================
// mergeMoveTx — 移库交易合并
// ============================================================================

describe('mergeMoveTx — 交易合并', () => {

  test('空数组返回空结果', () => {
    var result = mergeMoveTx([]);
    expect(result.mergedRows).toEqual([]);
    expect(result.uniqueItemCount).toBe(0);
  });

  test('null 安全处理', () => {
    var result = mergeMoveTx(null);
    expect(result.mergedRows).toEqual([]);
    expect(result.uniqueItemCount).toBe(0);
  });

  test('undefined 安全处理', () => {
    var result = mergeMoveTx(undefined);
    expect(result.mergedRows).toEqual([]);
    expect(result.uniqueItemCount).toBe(0);
  });

  test('单条交易正常合并', () => {
    var txns = [{
      item_code: 'ITEM-001', item_name: '螺丝', quantity: 5,
      from_bin: 'A01', to_bin: 'B01',
      transaction_time: '2026-03-01 10:00:00'
    }];
    var result = mergeMoveTx(txns);
    expect(result.mergedRows).toHaveLength(1);
    expect(result.mergedRows[0].item_code).toBe('ITEM-001');
    expect(result.mergedRows[0].quantity).toBe(5);
    expect(result.mergedRows[0].from_bin).toBe('A01');
    expect(result.mergedRows[0].to_bin).toBe('B01');
    expect(result.uniqueItemCount).toBe(1);
  });

  test('同路线(item+from+to)多条交易 SUM 累加', () => {
    var txns = [
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 5, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 3, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 10:05:00' },
    ];
    var result = mergeMoveTx(txns);
    expect(result.mergedRows).toHaveLength(1);
    expect(result.mergedRows[0].quantity).toBe(8); // 5 + 3
  });

  test('不同路线分开统计', () => {
    var txns = [
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 5, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 3, from_bin: 'A01', to_bin: 'C01', transaction_time: '2026-03-01 10:00:00' },
    ];
    var result = mergeMoveTx(txns);
    expect(result.mergedRows).toHaveLength(2);
    expect(result.uniqueItemCount).toBe(1); // 同一物料，去重后 1 种
  });

  test('不同物料分开统计', () => {
    var txns = [
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 5, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'ITEM-002', item_name: '螺母', quantity: 10, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 10:00:00' },
    ];
    var result = mergeMoveTx(txns);
    expect(result.mergedRows).toHaveLength(2);
    expect(result.uniqueItemCount).toBe(2);
  });

  test('排序: 按 item_code 然后 from_bin', () => {
    var txns = [
      { item_code: 'ITEM-002', quantity: 1, from_bin: 'B01', to_bin: 'C01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'ITEM-001', quantity: 1, from_bin: 'A02', to_bin: 'B01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'ITEM-001', quantity: 1, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 10:00:00' },
    ];
    var result = mergeMoveTx(txns);
    expect(result.mergedRows[0].item_code).toBe('ITEM-001');
    expect(result.mergedRows[0].from_bin).toBe('A01');
    expect(result.mergedRows[1].item_code).toBe('ITEM-001');
    expect(result.mergedRows[1].from_bin).toBe('A02');
    expect(result.mergedRows[2].item_code).toBe('ITEM-002');
  });

  test('quantity 非数字时视为 0', () => {
    var txns = [
      { item_code: 'ITEM-001', quantity: 'abc', from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'ITEM-001', quantity: 5, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 10:05:00' },
    ];
    var result = mergeMoveTx(txns);
    expect(result.mergedRows[0].quantity).toBe(5); // NaN → 0, 0 + 5 = 5
  });

  test('保留最新 transaction_time', () => {
    var txns = [
      { item_code: 'ITEM-001', quantity: 5, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 08:00:00' },
      { item_code: 'ITEM-001', quantity: 3, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 12:00:00' },
    ];
    var result = mergeMoveTx(txns);
    expect(result.mergedRows[0].transaction_time).toBe('2026-03-01 12:00:00');
  });

  test('item_name 首次有值时填充', () => {
    var txns = [
      { item_code: 'ITEM-001', item_name: '', quantity: 5, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 3, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 10:05:00' },
    ];
    var result = mergeMoveTx(txns);
    expect(result.mergedRows[0].item_name).toBe('螺丝');
  });

  test('fallback 字段: from_warehouse → from_bin', () => {
    var txns = [
      { item_code: 'ITEM-001', quantity: 5, from_warehouse: 'WH01', bin_location: 'B01', transaction_time: '2026-03-01 10:00:00' },
    ];
    var result = mergeMoveTx(txns);
    expect(result.mergedRows[0].from_bin).toBe('WH01');
    expect(result.mergedRows[0].to_bin).toBe('B01');
  });

  test('无 from/to 字段时 fallback 为 "-"', () => {
    var txns = [
      { item_code: 'ITEM-001', quantity: 5, transaction_time: '2026-03-01 10:00:00' },
    ];
    var result = mergeMoveTx(txns);
    expect(result.mergedRows[0].from_bin).toBe('-');
    expect(result.mergedRows[0].to_bin).toBe('-');
  });

  test('大量交易记录性能合并', () => {
    var txns = [];
    for (var i = 0; i < 100; i++) {
      txns.push({
        item_code: 'ITEM-' + String(i % 10).padStart(3, '0'),
        item_name: 'Item ' + (i % 10),
        quantity: 1,
        from_bin: 'A' + String(i % 3).padStart(2, '0'),
        to_bin: 'B' + String(i % 2).padStart(2, '0'),
        transaction_time: '2026-03-01 10:' + String(i % 60).padStart(2, '0') + ':00'
      });
    }
    var result = mergeMoveTx(txns);
    // 10 物料 × 3 源 × 2 目标 = 最多 60 行
    expect(result.mergedRows.length).toBeLessThanOrEqual(60);
    expect(result.uniqueItemCount).toBe(10);
  });

  test('item_code 为 null/undefined 时 fallback 为空字符串', () => {
    var txns = [
      { item_code: null, item_name: '未知', quantity: 3, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: undefined, item_name: '未知2', quantity: 2, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 10:05:00' },
    ];
    var result = mergeMoveTx(txns);
    // 两条记录 item_code 都为 falsy, fallback 为 '', 同路线合并为一条
    expect(result.mergedRows).toHaveLength(1);
    expect(result.mergedRows[0].item_code).toBe('');
    expect(result.mergedRows[0].quantity).toBe(5); // 3 + 2
    // item_code 为空不计入 uniqueItemCount
    expect(result.uniqueItemCount).toBe(0);
  });

  test('item_name 已有值时不被后续空 item_name 覆盖', () => {
    var txns = [
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 5, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'ITEM-001', item_name: '', quantity: 3, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 10:05:00' },
    ];
    var result = mergeMoveTx(txns);
    // 第二条记录时间更新，但 item_name 为空不应覆盖已有名称
    expect(result.mergedRows[0].item_name).toBe('螺丝');
  });

  test('transaction_time 相同或更早时不更新时间戳', () => {
    var txns = [
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 5, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 12:00:00' },
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 3, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 08:00:00' },
    ];
    var result = mergeMoveTx(txns);
    // 第二条记录时间更早，不应更新 transaction_time
    expect(result.mergedRows[0].transaction_time).toBe('2026-03-01 12:00:00');
  });

  test('排序: 同 item_code 不同 from_bin 时按 from_bin 二级排序', () => {
    // 触发排序函数的 || 分支: item_code 相同 (localeCompare 返回 0) 时进入 from_bin 比较
    var txns = [
      { item_code: 'ITEM-001', quantity: 1, from_bin: 'Z01', to_bin: 'B01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'ITEM-001', quantity: 2, from_bin: 'A01', to_bin: 'C01', transaction_time: '2026-03-01 10:05:00' },
    ];
    var result = mergeMoveTx(txns);
    // 两条 item_code 相同但 to_bin 不同 → 不合并 → 2 行
    expect(result.mergedRows).toHaveLength(2);
    // 排序: 同 item_code → 按 from_bin 排, A01 < Z01
    expect(result.mergedRows[0].from_bin).toBe('A01');
    expect(result.mergedRows[1].from_bin).toBe('Z01');
  });

  test('排序: from_bin 为 falsy 时 fallback 空字符串排序不崩溃', () => {
    var txns = [
      { item_code: 'ITEM-001', quantity: 1, to_bin: 'B01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'ITEM-001', quantity: 2, from_bin: 'A01', to_bin: 'C01', transaction_time: '2026-03-01 10:05:00' },
    ];
    var result = mergeMoveTx(txns);
    expect(result.mergedRows).toHaveLength(2);
    // from_bin 缺失 → '-' (fallback), '-' < 'A01' 按字典序
    expect(result.mergedRows[0].from_bin).toBe('-');
    expect(result.mergedRows[1].from_bin).toBe('A01');
  });

  test('排序: item_code 为空字符串时 fallback 排序', () => {
    // 构造合并后 item_code 为 '' 的记录与正常记录混排
    var txns = [
      { item_code: 'ITEM-002', quantity: 1, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: null, quantity: 1, from_bin: 'C01', to_bin: 'B01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: undefined, quantity: 1, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 10:00:00' },
    ];
    var result = mergeMoveTx(txns);
    // '' 排在 'ITEM-002' 前面
    expect(result.mergedRows[0].item_code).toBe('');
    expect(result.mergedRows.length).toBeGreaterThanOrEqual(2);
  });

  test('fromBin 为非字符串类型时 fallback 为 "-"', () => {
    var txns = [
      { item_code: 'ITEM-001', quantity: 5, from_bin: 0, to_bin: '', transaction_time: '2026-03-01 10:00:00' },
    ];
    var result = mergeMoveTx(txns);
    // from_bin=0 是 falsy, fallback 链: t.from_bin || t.from_warehouse || '-'
    // 0 || undefined || '-' = '-'
    expect(result.mergedRows[0].from_bin).toBe('-');
    expect(result.mergedRows[0].to_bin).toBe('-');
  });

  test('mergedMap key 使用 item_code|from_bin|to_bin 三段式', () => {
    var txns = [
      { item_code: 'ITEM-001', quantity: 5, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'ITEM-001', quantity: 3, from_bin: 'B01', to_bin: 'A01', transaction_time: '2026-03-01 10:05:00' },
    ];
    var result = mergeMoveTx(txns);
    // A01→B01 和 B01→A01 是不同路线
    expect(result.mergedRows).toHaveLength(2);
  });
});

// ============================================================================
// 集成场景 — 完整移库流程纯函数串联
// ============================================================================

describe('集成场景 — 移库流程', () => {

  test('场景: validate → build 全链路 (正常移库)', () => {
    // 1. 校验参数
    var validation = validateMoveParams('A01', 'B01', 10);
    expect(validation.valid).toBe(true);

    // 2. 构建 payload
    var payload = buildMovePayload('ITEM-001', 'A01', 'B01', 10);
    expect(payload.item_code).toBe('ITEM-001');
    expect(payload.from_bin).toBe('A01');
    expect(payload.bin_location).toBe('B01');
    expect(payload.quantity).toBe(10);
    expect(payload.batch_number).toBe('');
  });

  test('场景: 数量超限全链路 (弹性放行)', () => {
    // 1. 校验: qty=100 > maxQty=50 → valid + warning
    var validation = validateMoveParams('A01', 'B01', 100, 50);
    expect(validation.valid).toBe(true);
    expect(validation.warning).toBeDefined();

    // 2. 因为 valid===true, 继续构建 payload (不被 warning 阻断)
    var payload = buildMovePayload('ITEM-001', 'A01', 'B01', 100);
    expect(payload.quantity).toBe(100);
  });

  test('场景: 带批次全链路', () => {
    var validation = validateMoveParams('A01', 'B01', 5);
    expect(validation.valid).toBe(true);

    var payload = buildMovePayload('ITEM-001', 'A01', 'B01', 5, 'BATCH-2026-001');
    expect(payload.batch_number).toBe('BATCH-2026-001');
    expect(payload.quantity).toBe(5);
  });

  test('场景: 合并后统计 (merge)', () => {
    var txns = [
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 5, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 10:00:00' },
      { item_code: 'ITEM-001', item_name: '螺丝', quantity: 3, from_bin: 'A01', to_bin: 'B01', transaction_time: '2026-03-01 10:05:00' },
      { item_code: 'ITEM-002', item_name: '螺母', quantity: 10, from_bin: 'A01', to_bin: 'C01', transaction_time: '2026-03-01 10:10:00' },
    ];
    var result = mergeMoveTx(txns);
    expect(result.mergedRows).toHaveLength(2);
    expect(result.uniqueItemCount).toBe(2);
    // ITEM-001 累加: 5 + 3 = 8
    var item001 = result.mergedRows.find(function(r) { return r.item_code === 'ITEM-001'; });
    expect(item001.quantity).toBe(8);
  });

  test('场景: 字符串型 qty 不影响校验结果 (防字符串比较炸弹)', () => {
    // "9" > "50" 在字符串比较中为 true, 但 Number(9) < Number(50)
    var result = validateMoveParams('A01', 'B01', '9', '50');
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined(); // 数值 9 < 50, 不应有 warning

    // 反向验证: "51" > "50" 在数值上也成立
    var result2 = validateMoveParams('A01', 'B01', '51', '50');
    expect(result2.valid).toBe(true);
    expect(result2.warning).toBeDefined(); // 数值 51 > 50, 应有 warning
  });
});

// ============================================================================
// buildLmDetailRowsHtml — 移库明细行 HTML 构建 (借贷双行)
// ============================================================================

describe('buildLmDetailRowsHtml — 移库明细行 HTML', () => {
  const h = {
    escapeHtml: s => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    formatNumber: n => String(n),
    generateBarcodeUrl: (code, type) => '/barcode/' + code + '/' + type,
    formatDateTime: t => t || '-',
  };

  test('空数组返回空字符串', () => {
    expect(buildLmDetailRowsHtml([], h)).toBe('');
  });

  test('null/undefined 返回空字符串', () => {
    expect(buildLmDetailRowsHtml(null, h)).toBe('');
    expect(buildLmDetailRowsHtml(undefined, h)).toBe('');
  });

  test('单条记录生成借贷两行', () => {
    var rows = [{ item_code: 'A001', item_name: '物料A', quantity: 5, from_bin: 'B01', to_bin: 'B02', transaction_time: '2026-03-08' }];
    var html = buildLmDetailRowsHtml(rows, h);
    expect((html.match(/<tr/g) || []).length).toBe(2);
    // 贷行: 红色负数
    expect(html).toContain('color:#dc2626');
    expect(html).toContain('-5');
    expect(html).toContain('B01');
    expect(html).toContain('贷(出)');
    // 借行: 绿色正数
    expect(html).toContain('color:#16a34a');
    expect(html).toContain('+5');
    expect(html).toContain('B02');
    expect(html).toContain('借(入)');
  });

  test('多条记录生成 2n 行', () => {
    var rows = [
      { item_code: 'A001', item_name: '', quantity: 1, from_bin: 'B01', to_bin: 'B02', transaction_time: '' },
      { item_code: 'A002', item_name: '', quantity: 2, from_bin: 'C01', to_bin: 'C02', transaction_time: '' },
    ];
    var html = buildLmDetailRowsHtml(rows, h);
    expect((html.match(/<tr/g) || []).length).toBe(4);
  });

  test('7 列结构 (每行)', () => {
    var rows = [{ item_code: 'A001', item_name: 'X', quantity: 1, from_bin: 'B01', to_bin: 'B02', transaction_time: '' }];
    var html = buildLmDetailRowsHtml(rows, h);
    // 每行 7 个 <td>, 2 行 = 14
    expect((html.match(/<td/g) || []).length).toBe(14);
  });

  test('条码 URL 正确嵌入', () => {
    var rows = [{ item_code: 'X123', item_name: '', quantity: 1, from_bin: 'A', to_bin: 'B', transaction_time: '' }];
    var html = buildLmDetailRowsHtml(rows, h);
    expect(html).toContain('/barcode/X123/qrcode');
  });
});

// ============================================================================
// buildLmPendingRowsHtml — 移库待提交行 HTML 构建
// ============================================================================

describe('buildLmPendingRowsHtml — 移库待提交行 HTML', () => {
  const h = {
    escapeHtml: s => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    formatNumber: n => String(n),
    formatDateTime: t => t || '-',
  };

  test('空数组返回空字符串', () => {
    expect(buildLmPendingRowsHtml([], h)).toBe('');
  });

  test('null/undefined 返回空字符串', () => {
    expect(buildLmPendingRowsHtml(null, h)).toBe('');
    expect(buildLmPendingRowsHtml(undefined, h)).toBe('');
  });

  test('单行渲染 6 列含删除按钮', () => {
    var pending = [{ itemCode: 'A001', qty: 3, fromBin: 'B01', toBin: 'B02', addedAt: '2026-03-08' }];
    var html = buildLmPendingRowsHtml(pending, h);
    expect(html).toContain('A001');
    expect(html).toContain('3');
    expect(html).toContain('B01');
    expect(html).toContain('B02');
    expect(html).toContain('removePending(0)');
    expect((html.match(/<td/g) || []).length).toBe(6);
  });

  test('多行索引正确', () => {
    var pending = [
      { itemCode: 'A001', qty: 1, fromBin: 'A', toBin: 'B', addedAt: '' },
      { itemCode: 'A002', qty: 2, fromBin: 'C', toBin: 'D', addedAt: '' },
    ];
    var html = buildLmPendingRowsHtml(pending, h);
    expect(html).toContain('removePending(0)');
    expect(html).toContain('removePending(1)');
  });
});

// ============================================================================
// 分支覆盖补充 — buildLmDetailRowsHtml 边界
// ============================================================================

describe('buildLmDetailRowsHtml — 分支覆盖补充', () => {
  var h = {
    escapeHtml: function(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); },
    formatNumber: function(n) { return Number(n).toLocaleString(); },
    formatDateTime: function(d) { return d || '-'; },
    generateBarcodeUrl: function() { return 'data:image/png;base64,mock'; },
  };

  test('quantity 为非数字字符串 → Number 回退为 0 (L120)', () => {
    var rows = [{ item_code: 'A', item_name: 'X', quantity: 'abc', from_bin: 'B1', to_bin: 'B2', transaction_time: '2026-01-01' }];
    var html = buildLmDetailRowsHtml(rows, h);
    expect(html).toContain('-0');
    expect(html).toContain('+0');
  });

  test('quantity 为 null → Number 回退为 0', () => {
    var rows = [{ item_code: 'A', item_name: 'X', quantity: null, from_bin: 'B1', to_bin: 'B2', transaction_time: '2026-01-01' }];
    var html = buildLmDetailRowsHtml(rows, h);
    expect(html).toContain('-0');
  });

  test('item_name 为 null → 显示 -', () => {
    var rows = [{ item_code: 'A', item_name: null, quantity: 5, from_bin: 'B1', to_bin: 'B2', transaction_time: '2026-01-01' }];
    var html = buildLmDetailRowsHtml(rows, h);
    expect(html).toContain('-');
  });
});
