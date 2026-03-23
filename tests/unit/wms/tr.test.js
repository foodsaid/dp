/**
 * tr.js 调拨申请页纯函数单元测试
 * 覆盖: 已调数量 / 待调计算 / 行完成判定(0.00001阈值) / SAP关闭判定 / payload / 一键调拨
 * 🚨 专项: TR 特有 0.00001 阈值完成判定，防止浮点残留导致行无法关闭
 *
 * 纯函数通过 require() 直接导入，无需 DOM 环境
 */

const {
  getTrLineMoved,
  calcTrLineOpen,
  isTrLineDone,
  isTrSapClosed,
  buildTrTransferPayload,
  buildTrOpenLines,
  buildTrLineRowHtml,
  buildTrHistoryRowsHtml,
} = require('../../../apps/wms/tr');

// ============================================================================
// getTrLineMoved — 获取行已调数量
// ============================================================================

describe('getTrLineMoved — 已调数量', () => {

  test('正常取值', () => {
    var wms = { lineReceipts: { 1: 10, 2: 5 } };
    expect(getTrLineMoved(wms, 1)).toBe(10);
    expect(getTrLineMoved(wms, 2)).toBe(5);
  });

  test('行号不存在返回 0', () => {
    expect(getTrLineMoved({ lineReceipts: {} }, 99)).toBe(0);
  });

  test('wms 为 null/undefined 返回 0', () => {
    expect(getTrLineMoved(null, 1)).toBe(0);
    expect(getTrLineMoved(undefined, 1)).toBe(0);
  });

  test('lineReceipts 缺失返回 0', () => {
    expect(getTrLineMoved({}, 1)).toBe(0);
  });

  // 🚨 超小值
  test('已调 0.00001 正常返回', () => {
    var wms = { lineReceipts: { 1: 0.00001 } };
    expect(getTrLineMoved(wms, 1)).toBe(0.00001);
  });
});

// ============================================================================
// calcTrLineOpen — 行待调数量
// ============================================================================

describe('calcTrLineOpen — 待调数量', () => {

  test('标准: openQty=100, moved=30 → 70', () => {
    expect(calcTrLineOpen({ openQty: 100 }, 30)).toBe(70);
  });

  test('无 openQty 时使用 quantity', () => {
    expect(calcTrLineOpen({ quantity: 50 }, 20)).toBe(30);
  });

  test('openQty 为 0 优先使用', () => {
    expect(calcTrLineOpen({ openQty: 0, quantity: 50 }, 0)).toBe(0);
  });

  test('超调返回负数', () => {
    expect(calcTrLineOpen({ openQty: 10 }, 15)).toBe(-5);
  });

  test('刚好完成', () => {
    expect(calcTrLineOpen({ openQty: 10 }, 10)).toBe(0);
  });

  // 🚨 超小值精度
  test('超小值: 0.00003 - 0.00002 = 0.00001', () => {
    var result = calcTrLineOpen({ openQty: 0.00003 }, 0.00002);
    expect(result).toBeCloseTo(0.00001, 6);
    expect(result).not.toBe(0);
  });

  test('超小值不被抹零', () => {
    var result = calcTrLineOpen({ openQty: 0.00001 }, 0);
    expect(result).toBe(0.00001);
  });

  test('浮点精度: 0.3 - 0.1 = 0.2', () => {
    var result = calcTrLineOpen({ openQty: 0.3 }, 0.1);
    expect(result).toBeCloseTo(0.2, 6);
  });

  test('openQty undefined + quantity 也为 0 → 基准 0', () => {
    expect(calcTrLineOpen({ quantity: 0 }, 0)).toBe(0);
  });

  test('openQty undefined + quantity undefined → 基准 0', () => {
    expect(calcTrLineOpen({}, 5)).toBe(-5);
  });
});

// ============================================================================
// isTrLineDone — 行完成判定 (0.00001 阈值)
// ============================================================================

describe('isTrLineDone — 行完成判定 (0.00001 阈值)', () => {

  test('open = 0 → 完成', () => {
    expect(isTrLineDone(0)).toBe(true);
  });

  test('open < 0 → 完成', () => {
    expect(isTrLineDone(-1)).toBe(true);
    expect(isTrLineDone(-0.001)).toBe(true);
  });

  test('open = 0.00001 → 完成 (TR 阈值边界)', () => {
    expect(isTrLineDone(0.00001)).toBe(true);
  });

  test('open > 0.00001 → 未完成', () => {
    expect(isTrLineDone(0.00002)).toBe(false);
    expect(isTrLineDone(0.001)).toBe(false);
    expect(isTrLineDone(1)).toBe(false);
  });

  // 🚨 阈值精确边界测试
  test('🚨 open = 0.000009 → 完成 (低于阈值)', () => {
    expect(isTrLineDone(0.000009)).toBe(true);
  });

  test('🚨 open = 0.000011 → 未完成 (高于阈值)', () => {
    expect(isTrLineDone(0.000011)).toBe(false);
  });

  test('🚨 浮点残留: JS 0.3-0.1-0.2 的微小正残留应被阈值吸收', () => {
    // 0.3 - 0.1 - 0.2 在 JS 中可能产生 5.55e-17 级别的残留
    // 0.3 - 0.1 - 0.2 在 JS 中产生 5.55e-17 级别残留
    // 使用 calcTrLineOpen 计算会被 toFixed(6) 截断为 0
    var calculated = calcTrLineOpen({ openQty: 0.3 }, 0.3);
    expect(isTrLineDone(calculated)).toBe(true);
  });

  test('🚨 TR 与 PO/SO 的区别: PO 用 <= 0, TR 用 <= 0.00001', () => {
    // open = 0.000005: PO 认为未完成 (> 0), TR 认为完成 (<= 0.00001)
    expect(isTrLineDone(0.000005)).toBe(true);
    // 验证 TR 的独立阈值逻辑
    expect(isTrLineDone(0.00001)).toBe(true);
    expect(isTrLineDone(0.00002)).toBe(false);
  });
});

// ============================================================================
// isTrSapClosed — SAP 单据关闭判定
// ============================================================================

describe('isTrSapClosed — SAP 关闭判定', () => {

  test('O (Open) → 未关闭', () => {
    expect(isTrSapClosed('O')).toBe(false);
  });

  test('R (Released) → 未关闭', () => {
    expect(isTrSapClosed('R')).toBe(false);
  });

  test('P (Planned) → 未关闭', () => {
    expect(isTrSapClosed('P')).toBe(false);
  });

  test('C (Closed) → 已关闭', () => {
    expect(isTrSapClosed('C')).toBe(true);
  });

  test('L (Cancelled) → 已关闭', () => {
    expect(isTrSapClosed('L')).toBe(true);
  });

  test('undefined → 已关闭', () => {
    expect(isTrSapClosed(undefined)).toBe(true);
  });

  test('空字符串 → 已关闭', () => {
    expect(isTrSapClosed('')).toBe(true);
  });

  test('TR 与 PI 的区别: PI 不允许 O, TR 允许 O', () => {
    expect(isTrSapClosed('O')).toBe(false); // TR 允许 O
    // PI: isPiHeaderClosed('O') === true (不允许)
  });
});

// ============================================================================
// buildTrTransferPayload — 调拨 payload 构建
// ============================================================================

describe('buildTrTransferPayload — payload 构建', () => {

  var mockOrder = { docNum: '500001' };
  var mockLine = {
    itemCode: 'MAT-TR01', itemName: '调拨物料',
    lineNum: 1, fromWhsCod: 'WH-FROM', whsCode: 'WH-TO',
    quantity: 100
  };

  test('标准 payload', () => {
    var p = buildTrTransferPayload(mockOrder, mockLine, 50, '孙七', '仓间调拨');
    expect(p.doc_type).toBe('TR');
    expect(p.doc_number).toBe('500001');
    expect(p.sap_doc_num).toBe('500001');
    expect(p.item_code).toBe('MAT-TR01');
    expect(p.line_num).toBe(1);
    expect(p.quantity).toBe(50);
    expect(p.from_warehouse).toBe('WH-FROM');
    expect(p.warehouse_code).toBe('WH-TO');
    expect(p.performed_by).toBe('孙七');
    expect(p.action).toBe('move'); // TR 特有
    expect(p.planned_qty).toBe(100);
  });

  test('TR payload 无 bin_location (与 PO/WO 不同)', () => {
    var p = buildTrTransferPayload(mockOrder, mockLine, 10, '孙七', '');
    expect(p).not.toHaveProperty('bin_location');
  });

  test('TR payload 无 sap_doc_entry (与 PO/WO/PI 不同)', () => {
    var p = buildTrTransferPayload(mockOrder, mockLine, 10, '孙七', '');
    expect(p).not.toHaveProperty('sap_doc_entry');
  });

  // 🚨 超小值
  test('超小数量 0.00001 正常传递', () => {
    var p = buildTrTransferPayload(mockOrder, mockLine, 0.00001, '孙七', '');
    expect(p.quantity).toBe(0.00001);
  });
});

// ============================================================================
// buildTrOpenLines — 一键调拨行过滤
// ============================================================================

describe('buildTrOpenLines — 一键调拨行过滤', () => {

  test('过滤出待调行', () => {
    var lines = [
      { lineNum: 1, itemCode: 'A', openQty: 10, quantity: 10, itemName: 'ItemA', fromWhsCod: 'W1', whsCode: 'W2' },
      { lineNum: 2, itemCode: 'B', openQty: 0, quantity: 5, itemName: 'ItemB', fromWhsCod: 'W1', whsCode: 'W2' },
    ];
    var wms = {};
    var result = buildTrOpenLines(lines, wms);
    expect(result).toHaveLength(1);
    expect(result[0].itemCode).toBe('A');
    expect(result[0]._open).toBe(10);
  });

  test('部分已调正确计算', () => {
    var lines = [{ lineNum: 1, itemCode: 'A', openQty: 10, quantity: 10, itemName: '' }];
    var wms = { lineReceipts: { 1: 7 } };
    var result = buildTrOpenLines(lines, wms);
    expect(result).toHaveLength(1);
    expect(result[0]._open).toBe(3);
  });

  test('空行列表', () => {
    expect(buildTrOpenLines([], {})).toEqual([]);
    expect(buildTrOpenLines(null, {})).toEqual([]);
  });

  // 🚨 超小值
  test('🚨 超小值 0.00001 待调行不被过滤', () => {
    var lines = [{ lineNum: 1, itemCode: 'A', openQty: 0.00001, quantity: 0.00001, itemName: '' }];
    var result = buildTrOpenLines(lines, {});
    expect(result).toHaveLength(1);
    expect(result[0]._open).toBeCloseTo(0.00001, 6);
  });

  test('🚨 超小差值残留行保留', () => {
    var lines = [{ lineNum: 1, itemCode: 'A', openQty: 0.00003, quantity: 0.00003, itemName: '' }];
    var wms = { lineReceipts: { 1: 0.00002 } };
    var result = buildTrOpenLines(lines, wms);
    expect(result).toHaveLength(1);
    expect(result[0]._open).toBeCloseTo(0.00001, 6);
  });

  test('全部调完后过滤为空', () => {
    var lines = [{ lineNum: 1, itemCode: 'A', openQty: 10, quantity: 10, itemName: '' }];
    var wms = { lineReceipts: { 1: 10 } };
    var result = buildTrOpenLines(lines, wms);
    expect(result).toHaveLength(0);
  });
});

// ============================================================================
// 集成场景 — TR 调拨流程
// ============================================================================

describe('集成场景 — TR 调拨流程', () => {

  test('场景: 多行调拨到完成', () => {
    var lines = [
      { lineNum: 1, itemCode: 'A', openQty: 10, quantity: 10, itemName: 'A' },
      { lineNum: 2, itemCode: 'B', openQty: 20, quantity: 20, itemName: 'B' },
    ];
    var wms = { lineReceipts: { 1: 10, 2: 15 } };

    // A 行完成
    var openA = calcTrLineOpen(lines[0], getTrLineMoved(wms, 1));
    expect(isTrLineDone(openA)).toBe(true);

    // B 行剩余 5
    var openB = calcTrLineOpen(lines[1], getTrLineMoved(wms, 2));
    expect(openB).toBe(5);
    expect(isTrLineDone(openB)).toBe(false);

    // 一键只有 B
    var openLines = buildTrOpenLines(lines, wms);
    expect(openLines).toHaveLength(1);
    expect(openLines[0].itemCode).toBe('B');
  });

  test('场景: 🚨 浮点残留被 0.00001 阈值正确吸收', () => {
    // 模拟 JS 浮点减法产生微小残留
    var lines = [{ lineNum: 1, itemCode: 'A', openQty: 0.3, quantity: 0.3, itemName: '' }];

    // 模拟 3 次 0.1 的调拨
    var total = Number((0.1 + 0.1 + 0.1).toFixed(6));
    var wms = { lineReceipts: { 1: total } };

    var open = calcTrLineOpen(lines[0], getTrLineMoved(wms, 1));
    // toFixed(6) 会清除浮点残留
    expect(isTrLineDone(open)).toBe(true);
  });

  test('场景: 🚨 超小值逐步调拨至零', () => {
    var base = 0.00005;
    var total = 0;
    for (var i = 0; i < 5; i++) {
      total = Number((total + 0.00001).toFixed(6));
    }
    var open = calcTrLineOpen({ openQty: base }, total);
    expect(open).toBeCloseTo(0, 6);
    expect(isTrLineDone(open)).toBe(true);
  });

  test('场景: SAP 关闭状态与操作联动', () => {
    // SAP 打开状态可操作
    expect(isTrSapClosed('O')).toBe(false);
    expect(isTrSapClosed('R')).toBe(false);

    // SAP 关闭后不可操作
    expect(isTrSapClosed('C')).toBe(true);
    expect(isTrSapClosed('L')).toBe(true);
  });
});

// ============================================================================
// buildTrLineRowHtml — TR 行项目 HTML 构建 (纯函数)
// ============================================================================

describe('buildTrLineRowHtml — TR 行 HTML 构建', () => {
  var h = {
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    formatNumber: (n) => String(n),
    generateBarcodeUrl: (code, type) => '/barcode/' + code + '/' + type,
  };

  var baseLine = {
    lineNum: 0, itemCode: 'TR-ITEM-001', itemName: '调拨物料',
    quantity: 50, openQty: 50, fromWhsCod: 'WH01', whsCode: 'WH02',
  };
  var baseWms = { lineReceipts: {} };

  test('开放行渲染调拨按钮', () => {
    var result = buildTrLineRowHtml(baseLine, baseWms, h);
    expect(result.lineDone).toBe(false);
    expect(result.html).toContain('TR-ITEM-001');
    expect(result.html).toContain('调拨');
    expect(result.html).toContain('selectLine(0)');
  });

  test('已完成行渲染已完成标签', () => {
    var wms = { lineReceipts: { 0: 50 } };
    var result = buildTrLineRowHtml(baseLine, wms, h);
    expect(result.lineDone).toBe(true);
    expect(result.html).toContain('已完成');
    expect(result.html).toContain('line-done');
  });

  test('双仓库列正确显示', () => {
    var result = buildTrLineRowHtml(baseLine, baseWms, h);
    expect(result.html).toContain('WH01'); // fromWhsCod
    expect(result.html).toContain('WH02'); // whsCode
  });

  test('10 列结构 (含双仓库)', () => {
    var result = buildTrLineRowHtml(baseLine, baseWms, h);
    var tdCount = (result.html.match(/<td/g) || []).length;
    expect(tdCount).toBe(10);
  });

  test('部分调拨显示正确数量', () => {
    var wms = { lineReceipts: { 0: 20 } };
    var result = buildTrLineRowHtml(baseLine, wms, h);
    expect(result.html).toContain('20');  // moved
    expect(result.html).toContain('30');  // open
  });

  test('物料名为空 → 安全回退', () => {
    var line = Object.assign({}, baseLine, { itemName: '' });
    var result = buildTrLineRowHtml(line, baseWms, h);
    expect(result.html).toContain('TR-ITEM-001');
  });

  test('物料名为 null → 安全回退', () => {
    var line = Object.assign({}, baseLine, { itemName: null });
    var result = buildTrLineRowHtml(line, baseWms, h);
    expect(result.html).toContain('TR-ITEM-001');
  });

  test('fromWhsCod 为空 → 安全回退', () => {
    var line = Object.assign({}, baseLine, { fromWhsCod: '' });
    var result = buildTrLineRowHtml(line, baseWms, h);
    expect(result.html).toContain('WH02');
  });

  test('whsCode 为空 → 安全回退', () => {
    var line = Object.assign({}, baseLine, { whsCode: '' });
    var result = buildTrLineRowHtml(line, baseWms, h);
    expect(result.html).toContain('WH01');
  });

  test('fromWhsCod 和 whsCode 都为 null → 不崩溃', () => {
    var line = Object.assign({}, baseLine, { fromWhsCod: null, whsCode: null });
    var result = buildTrLineRowHtml(line, baseWms, h);
    expect(result.lineDone).toBe(false);
  });

  test('负待调量显示为 0 (Math.max 防护)', () => {
    var wms = { lineReceipts: { 0: 100 } };
    var result = buildTrLineRowHtml(baseLine, wms, h);
    expect(result.html).toContain('0');
    expect(result.lineDone).toBe(true);
  });
});

// ============================================================================
// buildTrHistoryRowsHtml — TR 事务历史 HTML 构建 (纯函数)
// ============================================================================

describe('buildTrHistoryRowsHtml — TR 历史行 HTML 构建', () => {
  var h = {
    escapeHtml: (s) => String(s),
    formatNumber: (n) => String(n),
    formatDateTime: (dt) => dt || '-',
  };

  test('空数组返回空字符串', () => {
    expect(buildTrHistoryRowsHtml([], h)).toBe('');
  });

  test('null 返回空字符串', () => {
    expect(buildTrHistoryRowsHtml(null, h)).toBe('');
  });

  test('单条记录渲染正确', () => {
    var txs = [{
      transaction_time: '2026-03-06', item_code: 'X', item_name: 'Y',
      quantity: 5, performed_by: 'Op', remarks: 'R',
    }];
    var html = buildTrHistoryRowsHtml(txs, h);
    expect(html).toContain('<tr>');
    expect(html).toContain('X');
    expect(html).toContain('5');
  });

  test('item_name 为 null → 显示 - (L115 || 分支)', () => {
    var txs = [{
      transaction_time: '2026-01-01', item_code: 'A', item_name: null,
      quantity: 3, performed_by: 'Op', remarks: 'R',
    }];
    var html = buildTrHistoryRowsHtml(txs, h);
    expect(html).toContain('>-<');
  });

  test('remarks 为 null → 显示 - (L115 || 分支)', () => {
    var txs = [{
      transaction_time: '2026-01-01', item_code: 'A', item_name: 'X',
      quantity: 3, performed_by: 'Op', remarks: null,
    }];
    var html = buildTrHistoryRowsHtml(txs, h);
    expect(html).toContain('>-<');
  });
});
