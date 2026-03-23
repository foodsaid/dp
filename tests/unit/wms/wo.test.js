/**
 * wo.js 生产收货页纯函数单元测试
 * 覆盖: 剩余数量计算 / 进度百分比 / WMS 状态判定 / payload 构建
 * 🚨 专项: 0.00001 超小值累加和精度保护
 *
 * 纯函数通过 require() 直接导入，无需 DOM 环境
 */

const {
  calcWoRemaining,
  calcWoProgress,
  determineWoWmsStatus,
  buildWoReceiptPayload,
  buildWoHistoryRowsHtml,
} = require('../../../apps/wms/wo');

// ============================================================================
// calcWoRemaining — 剩余数量计算 (planned - completed - wmsReceived)
// ============================================================================

describe('calcWoRemaining — 剩余数量计算', () => {

  test('标准场景: 100 - 30 - 20 = 50', () => {
    expect(calcWoRemaining(100, 30, 20)).toBe(50);
  });

  test('全部完成: 100 - 80 - 20 = 0', () => {
    expect(calcWoRemaining(100, 80, 20)).toBe(0);
  });

  test('超收: 100 - 50 - 60 = -10', () => {
    expect(calcWoRemaining(100, 50, 60)).toBe(-10);
  });

  test('零计划: 0 - 0 - 0 = 0', () => {
    expect(calcWoRemaining(0, 0, 0)).toBe(0);
  });

  test('仅计划: 100 - 0 - 0 = 100', () => {
    expect(calcWoRemaining(100, 0, 0)).toBe(100);
  });

  test('null/undefined 输入安全: 视为 0', () => {
    expect(calcWoRemaining(null, undefined, '')).toBe(0);
    expect(calcWoRemaining(100, null, null)).toBe(100);
  });

  test('字符串数字正常转换', () => {
    expect(calcWoRemaining('100', '30', '20')).toBe(50);
  });

  test('非数字字符串视为 0', () => {
    expect(calcWoRemaining('abc', 'def', 'ghi')).toBe(0);
  });

  // 🚨 超高精度浮点测试
  test('超小值 0.00001: 0.00003 - 0.00001 - 0.00001 = 0.00001', () => {
    var result = calcWoRemaining(0.00003, 0.00001, 0.00001);
    expect(result).toBeCloseTo(0.00001, 6);
    expect(result).not.toBe(0); // 确保不被抹零
  });

  test('超小值 0.00001 不被抹零', () => {
    var result = calcWoRemaining(0.00002, 0.00001, 0);
    expect(result).toBeCloseTo(0.00001, 6);
    expect(result).toBeGreaterThan(0);
  });

  test('精度保护: 0.1 + 0.2 级别浮点', () => {
    // 1.3 - 0.1 - 0.2 在 JS 中可能有浮点残留
    var result = calcWoRemaining(1.3, 0.1, 0.2);
    expect(result).toBeCloseTo(1.0, 6);
  });

  test('六位小数累加精度', () => {
    var result = calcWoRemaining(1.123456, 0.123456, 0.5);
    expect(result).toBeCloseTo(0.5, 6);
  });

  test('超大数字精度: 999999.00001 - 999999 - 0 = 0.00001', () => {
    var result = calcWoRemaining(999999.00001, 999999, 0);
    expect(result).toBeCloseTo(0.00001, 5);
  });
});

// ============================================================================
// calcWoProgress — 进度百分比计算
// ============================================================================

describe('calcWoProgress — 进度百分比', () => {

  test('50% 进度', () => {
    expect(calcWoProgress(30, 20, 100)).toBe(50);
  });

  test('0% 进度', () => {
    expect(calcWoProgress(0, 0, 100)).toBe(0);
  });

  test('100% 进度', () => {
    expect(calcWoProgress(80, 20, 100)).toBe(100);
  });

  test('超 100% 封顶为 100', () => {
    expect(calcWoProgress(80, 30, 100)).toBe(100);
  });

  test('计划为 0 时返回 0', () => {
    expect(calcWoProgress(10, 5, 0)).toBe(0);
  });

  test('计划为负数时返回 0', () => {
    expect(calcWoProgress(10, 5, -10)).toBe(0);
  });

  test('null/undefined 输入安全', () => {
    expect(calcWoProgress(null, null, 100)).toBe(0);
    expect(calcWoProgress(50, undefined, 100)).toBe(50);
  });

  // 🚨 超小值精度
  test('超小进度: 0.00001 / 1 = 0.001%', () => {
    var result = calcWoProgress(0, 0.00001, 1);
    expect(result).toBeCloseTo(0.001, 3);
    expect(result).toBeGreaterThan(0);
  });

  test('浮点精度: 0.1 + 0.2 累加', () => {
    var result = calcWoProgress(0.1, 0.2, 1);
    expect(result).toBeCloseTo(30, 1);
  });
});

// ============================================================================
// determineWoWmsStatus — WMS 状态判定
// ============================================================================

describe('determineWoWmsStatus — 状态判定', () => {

  test('剩余 > 0 保持原状态', () => {
    expect(determineWoWmsStatus('pending', 10, 100)).toBe('pending');
    expect(determineWoWmsStatus('in_progress', 5, 100)).toBe('in_progress');
  });

  test('剩余 = 0 且计划 > 0 → completed', () => {
    expect(determineWoWmsStatus('pending', 0, 100)).toBe('completed');
    expect(determineWoWmsStatus('in_progress', 0, 100)).toBe('completed');
  });

  test('剩余 < 0 (超收) → completed', () => {
    expect(determineWoWmsStatus('in_progress', -5, 100)).toBe('completed');
  });

  test('已经是 completed 保持不变', () => {
    expect(determineWoWmsStatus('completed', 0, 100)).toBe('completed');
    expect(determineWoWmsStatus('completed', 10, 100)).toBe('completed');
  });

  test('计划 = 0 不触发 completed', () => {
    expect(determineWoWmsStatus('pending', 0, 0)).toBe('pending');
  });

  test('计划 null 不触发 completed', () => {
    expect(determineWoWmsStatus('pending', 0, null)).toBe('pending');
  });

  // 🚨 超小值边界
  test('剩余 = 0.00001 不触发 completed', () => {
    expect(determineWoWmsStatus('pending', 0.00001, 100)).toBe('pending');
  });

  test('剩余 = -0.00001 触发 completed', () => {
    expect(determineWoWmsStatus('pending', -0.00001, 100)).toBe('completed');
  });
});

// ============================================================================
// buildWoReceiptPayload — 收货 payload 构建
// ============================================================================

describe('buildWoReceiptPayload — payload 构建', () => {

  var mockOrder = {
    docNum: '100001', docEntry: 99,
    itemCode: 'FG-001', itemName: '成品A',
    whsCode: 'WH01', plannedQty: 100, uom: 'KG'
  };

  test('标准 payload', () => {
    var p = buildWoReceiptPayload(mockOrder, 50, '张三', '正常收货', 'BIN-A01');
    expect(p.doc_type).toBe('WO');
    expect(p.doc_number).toBe('100001');
    expect(p.sap_doc_entry).toBe(99);
    expect(p.item_code).toBe('FG-001');
    expect(p.quantity).toBe(50);
    expect(p.warehouse_code).toBe('WH01');
    expect(p.bin_location).toBe('BIN-A01');
    expect(p.performed_by).toBe('张三');
    expect(p.action).toBe('receipt');
    expect(p.remarks).toBe('正常收货');
    expect(p.planned_qty).toBe(100);
    expect(p.uom).toBe('KG');
  });

  test('库位为空回退到 {仓库}-SYSTEM-BIN-LOCATION', () => {
    var p = buildWoReceiptPayload(mockOrder, 10, '张三', '', '');
    expect(p.bin_location).toBe('WH01-SYSTEM-BIN-LOCATION');
  });

  test('库位为 null 回退到 {仓库}-SYSTEM-BIN-LOCATION', () => {
    var p = buildWoReceiptPayload(mockOrder, 10, '张三', '', null);
    expect(p.bin_location).toBe('WH01-SYSTEM-BIN-LOCATION');
  });

  test('defaultBin 参数优先于硬编码 fallback', () => {
    var p = buildWoReceiptPayload(mockOrder, 10, '张三', '', '', '', '', 'WH01-RECEIVING-BIN');
    expect(p.bin_location).toBe('WH01-RECEIVING-BIN');
  });

  test('binVal 优先于 defaultBin', () => {
    var p = buildWoReceiptPayload(mockOrder, 10, '张三', '', 'BIN-A01', '', '', 'WH01-RECEIVING-BIN');
    expect(p.bin_location).toBe('BIN-A01');
  });

  test('defaultBin 未传时仍走硬编码 fallback (向后兼容)', () => {
    var p = buildWoReceiptPayload(mockOrder, 10, '张三', '', '');
    expect(p.bin_location).toBe('WH01-SYSTEM-BIN-LOCATION');
  });

  test('含批次号和生产日期', () => {
    var p = buildWoReceiptPayload(mockOrder, 10, '张三', '', 'BIN-A01', 'BAT20260301', '20260301');
    expect(p.batch_number).toBe('BAT20260301');
    expect(p.production_date).toBe('20260301');
  });

  test('无批次号时不含 batch_number 字段', () => {
    var p = buildWoReceiptPayload(mockOrder, 10, '张三', '', 'BIN-A01', '', '');
    expect(p).not.toHaveProperty('batch_number');
    expect(p).not.toHaveProperty('production_date');
  });

  // 🚨 超小值
  test('超小数量 0.00001 正常传递', () => {
    var p = buildWoReceiptPayload(mockOrder, 0.00001, '张三', '', 'BIN-A01');
    expect(p.quantity).toBe(0.00001);
  });

  test('whsCode 为空 → 回退 SYSTEM-SYSTEM-BIN-LOCATION', () => {
    var noWhsOrder = { docNum: '100001', docEntry: 99, itemCode: 'FG-001', itemName: '成品A', whsCode: '', plannedQty: 100, uom: 'KG' };
    var p = buildWoReceiptPayload(noWhsOrder, 10, '张三', '', '', '', '');
    expect(p.bin_location).toBe('SYSTEM-SYSTEM-BIN-LOCATION');
    expect(p.warehouse_code).toBe('');
  });

  test('whsCode 为 null/undefined → 回退 SYSTEM-SYSTEM-BIN-LOCATION', () => {
    var noWhsOrder = { docNum: '100001', docEntry: 99, itemCode: 'FG-001', whsCode: null, plannedQty: 100, uom: 'KG' };
    var p = buildWoReceiptPayload(noWhsOrder, 10, '张三', '', null);
    expect(p.bin_location).toBe('SYSTEM-SYSTEM-BIN-LOCATION');
  });

  test('仅 batchNumber 有值、productionDate 为空 → 含 batch_number 不含 production_date', () => {
    var p = buildWoReceiptPayload(mockOrder, 10, '张三', '', 'BIN-A01', 'BAT001', '');
    expect(p.batch_number).toBe('BAT001');
    expect(p).not.toHaveProperty('production_date');
  });

  test('仅 productionDate 有值、batchNumber 为空 → 含 production_date 不含 batch_number', () => {
    var p = buildWoReceiptPayload(mockOrder, 10, '张三', '', 'BIN-A01', '', '20260301');
    expect(p).not.toHaveProperty('batch_number');
    expect(p.production_date).toBe('20260301');
  });
});

// ============================================================================
// 集成场景 — 完整收货流程纯函数串联
// ============================================================================

describe('集成场景 — WO 收货流程', () => {

  test('场景: 多次收货累加至完成', () => {
    // 第一次收货 50
    var r1 = calcWoRemaining(100, 0, 50);
    expect(r1).toBe(50);
    expect(determineWoWmsStatus('pending', r1, 100)).toBe('pending');

    // 第二次收货 50
    var r2 = calcWoRemaining(100, 0, 100);
    expect(r2).toBe(0);
    expect(determineWoWmsStatus('in_progress', r2, 100)).toBe('completed');
  });

  test('场景: 超小值逐步累加至零', () => {
    // 计划 0.00005，分 5 次每次 0.00001
    var total = 0;
    for (var i = 0; i < 5; i++) {
      total = Number((total + 0.00001).toFixed(6));
    }
    var remaining = calcWoRemaining(0.00005, 0, total);
    expect(remaining).toBeCloseTo(0, 6);
    expect(determineWoWmsStatus('in_progress', remaining, 0.00005)).toBe('completed');
  });

  test('场景: 进度条从 0% 到 100%', () => {
    expect(calcWoProgress(0, 0, 100)).toBe(0);
    expect(calcWoProgress(0, 50, 100)).toBe(50);
    expect(calcWoProgress(0, 100, 100)).toBe(100);
    expect(calcWoProgress(0, 110, 100)).toBe(100); // 封顶
  });
});

// ============================================================================
// buildWoHistoryRowsHtml — WO 事务历史 HTML 构建 (纯函数)
// ============================================================================

describe('buildWoHistoryRowsHtml — WO 历史行 HTML 构建', () => {
  var h = {
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    formatNumber: (n) => String(n),
    formatDateTime: (dt) => dt || '-',
  };

  test('空数组返回空字符串', () => {
    expect(buildWoHistoryRowsHtml([], h)).toBe('');
  });

  test('null 返回空字符串', () => {
    expect(buildWoHistoryRowsHtml(null, h)).toBe('');
  });

  test('undefined 返回空字符串', () => {
    expect(buildWoHistoryRowsHtml(undefined, h)).toBe('');
  });

  test('单条记录渲染正确', () => {
    var txs = [{
      transaction_time: '2026-03-06 14:00', item_code: 'WO-ITEM',
      item_name: '生产物料', quantity: 20, performed_by: '操作员B', remarks: '收货',
    }];
    var html = buildWoHistoryRowsHtml(txs, h);
    expect(html).toContain('WO-ITEM');
    expect(html).toContain('生产物料');
    expect(html).toContain('2026-03-06 14:00');
    expect(html).toContain('20');
    expect(html).toContain('操作员B');
    expect(html).toContain('收货');
  });

  test('WO 列顺序: item_code 在 time 之前', () => {
    var txs = [{
      transaction_time: 'T1', item_code: 'CODE', item_name: 'NAME',
      quantity: 1, performed_by: 'U', remarks: '',
    }];
    var html = buildWoHistoryRowsHtml(txs, h);
    // WO 特有列顺序: item_code, item_name, time (与其他模块 time, item_code, item_name 不同)
    var codeIdx = html.indexOf('CODE');
    var timeIdx = html.indexOf('T1');
    expect(codeIdx).toBeLessThan(timeIdx);
  });

  test('多条记录拼接', () => {
    var txs = [
      { transaction_time: '', item_code: 'A', item_name: '', quantity: 1, performed_by: '', remarks: '' },
      { transaction_time: '', item_code: 'B', item_name: '', quantity: 2, performed_by: '', remarks: '' },
    ];
    var html = buildWoHistoryRowsHtml(txs, h);
    expect((html.match(/<tr>/g) || []).length).toBe(2);
  });

  test('item_code 为空显示 -', () => {
    var txs = [{ transaction_time: '', item_code: '', item_name: '', quantity: 0, performed_by: 'U', remarks: '' }];
    var html = buildWoHistoryRowsHtml(txs, h);
    expect(html).toContain('-');
  });

  test('XSS 防护', () => {
    var txs = [{
      transaction_time: '', item_code: '<script>',
      item_name: '', quantity: 0, performed_by: '', remarks: '',
    }];
    var html = buildWoHistoryRowsHtml(txs, h);
    // escapeHtml mock 仅转义 < 和 &，验证 < 被转义即可
    expect(html).toContain('&lt;script');
    expect(html).not.toMatch(/<script[^>]*>/);
  });
});
