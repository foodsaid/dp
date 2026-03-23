/**
 * so.js 销售拣货页纯函数单元测试
 * 覆盖: 已拣/待拣计算 / 总交付量 / 行完成检查 / payload 构建
 * 🚨 专项: 0.00001 超小值精度保护
 *
 * 纯函数通过 require() 直接导入，无需 DOM 环境
 */

const {
  getSoLinePicked,
  calcSoLineOpen,
  calcSoTotalDelivered,
  checkSoLineComplete,
  buildSoPickPayload,
  buildSoLineRowHtml,
  buildHistoryRowsHtml,
} = require('../../../apps/wms/so');

// ============================================================================
// getSoLinePicked — 获取行已拣数量
// ============================================================================

describe('getSoLinePicked — 已拣数量', () => {

  test('正常取值', () => {
    var wms = { lineReceipts: { 1: 10, 2: 5 } };
    expect(getSoLinePicked(wms, 1)).toBe(10);
    expect(getSoLinePicked(wms, 2)).toBe(5);
  });

  test('行号不存在返回 0', () => {
    expect(getSoLinePicked({ lineReceipts: {} }, 99)).toBe(0);
  });

  test('wms 为 null/undefined 返回 0', () => {
    expect(getSoLinePicked(null, 1)).toBe(0);
    expect(getSoLinePicked(undefined, 1)).toBe(0);
  });

  test('lineReceipts 缺失返回 0', () => {
    expect(getSoLinePicked({}, 1)).toBe(0);
  });

  // 🚨 超小值
  test('已拣 0.00001 正常返回', () => {
    var wms = { lineReceipts: { 1: 0.00001 } };
    expect(getSoLinePicked(wms, 1)).toBe(0.00001);
  });
});

// ============================================================================
// calcSoLineOpen — 行待拣数量
// ============================================================================

describe('calcSoLineOpen — 待拣数量', () => {

  test('标准: openQty=50, picked=20 → 30', () => {
    expect(calcSoLineOpen({ openQty: 50 }, 20)).toBe(30);
  });

  test('无 openQty 时使用 quantity', () => {
    expect(calcSoLineOpen({ quantity: 30 }, 10)).toBe(20);
  });

  test('openQty 为 0 优先使用', () => {
    expect(calcSoLineOpen({ openQty: 0, quantity: 30 }, 0)).toBe(0);
  });

  test('超拣返回负数', () => {
    expect(calcSoLineOpen({ openQty: 5 }, 10)).toBe(-5);
  });

  test('刚好完成', () => {
    expect(calcSoLineOpen({ openQty: 10 }, 10)).toBe(0);
  });

  // 🚨 超小值精度
  test('超小值: 0.00003 - 0.00002 = 0.00001', () => {
    var result = calcSoLineOpen({ openQty: 0.00003 }, 0.00002);
    expect(result).toBeCloseTo(0.00001, 6);
    expect(result).not.toBe(0);
  });

  test('超小值不被抹零', () => {
    var result = calcSoLineOpen({ openQty: 0.00001 }, 0);
    expect(result).toBe(0.00001);
  });

  test('浮点精度: 0.3 - 0.1 = 0.2', () => {
    var result = calcSoLineOpen({ openQty: 0.3 }, 0.1);
    expect(result).toBeCloseTo(0.2, 6);
  });

  test('openQty undefined + quantity 也为 0 → 基准 0', () => {
    expect(calcSoLineOpen({ quantity: 0 }, 0)).toBe(0);
  });

  test('openQty undefined + quantity undefined → 基准 0', () => {
    expect(calcSoLineOpen({}, 5)).toBe(-5);
  });
});

// ============================================================================
// calcSoTotalDelivered — 总交付量
// ============================================================================

describe('calcSoTotalDelivered — 总交付量', () => {

  test('标准累加', () => {
    expect(calcSoTotalDelivered(30, 20)).toBe(50);
  });

  test('null/undefined 安全', () => {
    expect(calcSoTotalDelivered(null, 10)).toBe(10);
    expect(calcSoTotalDelivered(20, null)).toBe(20);
    expect(calcSoTotalDelivered(null, null)).toBe(0);
  });

  test('零值', () => {
    expect(calcSoTotalDelivered(0, 0)).toBe(0);
  });

  // 🚨 超小值精度
  test('超小值累加: 0.00001 + 0.00002 = 0.00003', () => {
    var result = calcSoTotalDelivered(0.00001, 0.00002);
    expect(result).toBeCloseTo(0.00003, 6);
  });

  test('浮点精度: 0.1 + 0.2 = 0.3', () => {
    var result = calcSoTotalDelivered(0.1, 0.2);
    expect(result).toBeCloseTo(0.3, 6);
  });

  test('大数 + 超小值精度', () => {
    var result = calcSoTotalDelivered(999999, 0.00001);
    expect(result).toBeCloseTo(999999.00001, 5);
  });
});

// ============================================================================
// checkSoLineComplete — 行完成检查 (扫码防呆)
// ============================================================================

describe('checkSoLineComplete — 行完成检查', () => {

  test('未完成行: 返回 isComplete=false + remaining', () => {
    var line = { lineNum: 1, openQty: 10 };
    var wms = { lineReceipts: { 1: 3 } };
    var result = checkSoLineComplete(line, wms);
    expect(result.isComplete).toBe(false);
    expect(result.remaining).toBe(7);
  });

  test('已完成行: remaining=0', () => {
    var line = { lineNum: 1, openQty: 10 };
    var wms = { lineReceipts: { 1: 10 } };
    var result = checkSoLineComplete(line, wms);
    expect(result.isComplete).toBe(true);
    expect(result.remaining).toBe(0);
  });

  test('超拣行: remaining=0, isComplete=true', () => {
    var line = { lineNum: 1, openQty: 10 };
    var wms = { lineReceipts: { 1: 15 } };
    var result = checkSoLineComplete(line, wms);
    expect(result.isComplete).toBe(true);
    expect(result.remaining).toBe(0);
  });

  test('line 为 null 安全处理', () => {
    var result = checkSoLineComplete(null, {});
    expect(result.isComplete).toBe(false);
    expect(result.remaining).toBe(0);
  });

  // 🚨 超小值
  test('超小剩余 0.00001 → 未完成', () => {
    var line = { lineNum: 1, openQty: 0.00003 };
    var wms = { lineReceipts: { 1: 0.00002 } };
    var result = checkSoLineComplete(line, wms);
    expect(result.isComplete).toBe(false);
    expect(result.remaining).toBeCloseTo(0.00001, 6);
  });
});

// ============================================================================
// buildSoPickPayload — 拣货 payload 构建
// ============================================================================

describe('buildSoPickPayload — payload 构建', () => {

  var mockOrder = { docNum: '300001', docEntry: 77 };
  var mockLine = {
    itemCode: 'SKU-001', itemName: '商品A',
    lineNum: 2, whsCode: 'WH03', quantity: 50, uom: 'PCS'
  };

  test('标准 payload', () => {
    var p = buildSoPickPayload(mockOrder, mockLine, 25, '王五', '正常拣货');
    expect(p.doc_type).toBe('SO');
    expect(p.doc_number).toBe('300001');
    expect(p.sap_doc_entry).toBe(77);
    expect(p.item_code).toBe('SKU-001');
    expect(p.line_num).toBe(2);
    expect(p.quantity).toBe(25);
    expect(p.warehouse_code).toBe('WH03');
    expect(p.performed_by).toBe('王五');
    expect(p.action).toBe('scan'); // SO 特有: action = scan
    expect(p.planned_qty).toBe(50);
    expect(p.uom).toBe('PCS');
  });

  test('SO action 始终为 scan', () => {
    var p = buildSoPickPayload(mockOrder, mockLine, 1, '王五', '');
    expect(p.action).toBe('scan');
  });

  // 🚨 超小值
  test('超小数量 0.00001 正常传递', () => {
    var p = buildSoPickPayload(mockOrder, mockLine, 0.00001, '王五', '');
    expect(p.quantity).toBe(0.00001);
  });
});

// ============================================================================
// 集成场景 — SO 拣货流程
// ============================================================================

describe('集成场景 — SO 拣货流程', () => {

  test('场景: 拣货 + 扫码防呆', () => {
    var line = { lineNum: 1, openQty: 10, itemCode: 'SKU-001', itemName: '商品A', whsCode: 'WH', quantity: 10, uom: 'PCS' };
    var wms = { lineReceipts: {} };

    // 第一次拣 7
    var check1 = checkSoLineComplete(line, wms);
    expect(check1.isComplete).toBe(false);
    expect(check1.remaining).toBe(10);

    // 模拟已拣 7
    wms = { lineReceipts: { 1: 7 } };
    var check2 = checkSoLineComplete(line, wms);
    expect(check2.isComplete).toBe(false);
    expect(check2.remaining).toBe(3);

    // 拣满 10
    wms = { lineReceipts: { 1: 10 } };
    var check3 = checkSoLineComplete(line, wms);
    expect(check3.isComplete).toBe(true);
  });

  test('场景: 超小值逐步拣满', () => {
    var line = { lineNum: 1, openQty: 0.00005 };
    var total = 0;
    for (var i = 0; i < 5; i++) {
      total = Number((total + 0.00001).toFixed(6));
    }
    var wms = { lineReceipts: { 1: total } };
    var result = checkSoLineComplete(line, wms);
    expect(result.isComplete).toBe(true);
  });

  test('场景: 总交付量累加精度', () => {
    // SAP 已交付 99.99999, WMS 再拣 0.00001
    var total = calcSoTotalDelivered(99.99999, 0.00001);
    expect(total).toBeCloseTo(100, 5);
  });
});

// ============================================================================
// buildSoLineRowHtml — 行项目 HTML 构建 (纯函数)
// ============================================================================

describe('buildSoLineRowHtml — 行 HTML 构建', () => {
  var mockHelpers = {
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    formatNumber: (n) => String(n),
    generateBarcodeUrl: (code, type) => '/barcode/' + code + '/' + type,
  };

  var baseLine = {
    lineNum: 0, itemCode: 'ITEM-001', itemName: '测试物料',
    quantity: 100, deliveredQty: 0, openQty: 100,
    lineStatus: 'O', whsCode: 'WH01', uom: 'PCS',
  };

  var baseWms = { lineReceipts: {} };
  var baseOpts = { isDD: false, headerClosed: false, wmsStatus: 'pending', omsPickedMap: null };

  test('SO 模式: 开放行渲染拣货按钮', () => {
    var result = buildSoLineRowHtml(baseLine, baseWms, baseOpts, mockHelpers);
    expect(result.lineDone).toBe(false);
    expect(result.html).toContain('ITEM-001');
    expect(result.html).toContain('selectLine(0)');
    expect(result.html).toContain('拣货');
    expect(result.html).not.toContain('line-done');
  });

  test('SO 模式: 已完成行渲染已完成标签', () => {
    var doneLine = Object.assign({}, baseLine, { lineStatus: 'C' });
    var result = buildSoLineRowHtml(doneLine, baseWms, baseOpts, mockHelpers);
    expect(result.lineDone).toBe(true);
    expect(result.html).toContain('line-done');
    expect(result.html).toContain('已完成');
    expect(result.html).not.toContain('selectLine');
  });

  test('SO 模式: headerClosed 标记所有行完成', () => {
    var result = buildSoLineRowHtml(baseLine, baseWms, { ...baseOpts, headerClosed: true }, mockHelpers);
    expect(result.lineDone).toBe(true);
    expect(result.html).toContain('已完成');
  });

  test('SO 模式: 部分拣货后 open 减少', () => {
    var wms = { lineReceipts: { 0: 60 } };
    var result = buildSoLineRowHtml(baseLine, wms, baseOpts, mockHelpers);
    expect(result.lineDone).toBe(false);
    expect(result.html).toContain('40'); // open = 100 - 60
  });

  test('SO 模式: 拣满后 lineDone=true', () => {
    var wms = { lineReceipts: { 0: 100 } };
    var result = buildSoLineRowHtml(baseLine, wms, baseOpts, mockHelpers);
    expect(result.lineDone).toBe(true);
    expect(result.html).toContain('已完成');
  });

  test('SO 模式: split 状态使用 omsPickedMap 覆盖显示', () => {
    var opts = { ...baseOpts, wmsStatus: 'split', omsPickedMap: { 0: 30 } };
    var result = buildSoLineRowHtml(baseLine, baseWms, opts, mockHelpers);
    expect(result.html).toContain('30');  // omsPickedMap 覆盖 delivered
    expect(result.html).toContain('70');  // open = 100 - 30
  });

  test('DD 模式: 11 列含源单链接', () => {
    var ddLine = Object.assign({}, baseLine, {
      sourceDocNumber: '26000001', sourceLineNum: 0, sourcePlannedQty: 200,
    });
    var ddOpts = { ...baseOpts, isDD: true };
    var result = buildSoLineRowHtml(ddLine, baseWms, ddOpts, mockHelpers);
    expect(result.lineDone).toBe(false);
    expect(result.html).toContain('SO26000001');
    expect(result.html).toContain('so.html?docnum=26000001');
    expect(result.html).toContain('200'); // sourcePlannedQty
  });

  test('DD 模式: 无源单号显示 -', () => {
    var ddOpts = { ...baseOpts, isDD: true };
    var result = buildSoLineRowHtml(baseLine, baseWms, ddOpts, mockHelpers);
    expect(result.html).toMatch(/<td>-<\/td>/);
  });

  test('DD 模式: 有源单号但 sourceLineNum 为 null → 显示 L-', () => {
    var ddLine = Object.assign({}, baseLine, {
      sourceDocNumber: '26000099', sourceLineNum: null, sourcePlannedQty: 50,
    });
    var ddOpts = { ...baseOpts, isDD: true };
    var result = buildSoLineRowHtml(ddLine, baseWms, ddOpts, mockHelpers);
    expect(result.html).toContain('SO26000099');
    expect(result.html).toContain('L-');
  });

  test('DD 模式: sourcePlannedQty 为 null → 显示 -', () => {
    var ddLine = Object.assign({}, baseLine, {
      sourceDocNumber: '26000099', sourceLineNum: 1, sourcePlannedQty: null,
    });
    var ddOpts = { ...baseOpts, isDD: true };
    var result = buildSoLineRowHtml(ddLine, baseWms, ddOpts, mockHelpers);
    expect(result.html).toContain('color:#9ca3af');
    expect(result.html).toMatch(/>-<\/td>/);
  });

  test('DD 模式: sourcePlannedQty 为 undefined → 显示 -', () => {
    var ddLine = Object.assign({}, baseLine, {
      sourceDocNumber: '26000099', sourceLineNum: 2,
    });
    var ddOpts = { ...baseOpts, isDD: true };
    var result = buildSoLineRowHtml(ddLine, baseWms, ddOpts, mockHelpers);
    expect(result.html).toMatch(/>-<\/td>/);
  });

  test('DD 模式: 物料名/仓库为空安全处理', () => {
    var ddLine = Object.assign({}, baseLine, { itemName: '', whsCode: '' });
    var ddOpts = { ...baseOpts, isDD: true };
    var result = buildSoLineRowHtml(ddLine, baseWms, ddOpts, mockHelpers);
    expect(result.html).toContain('ITEM-001');
  });

  test('SO 模式: split 但 omsPickedMap 中无匹配行号 → 默认 0', () => {
    var opts = { ...baseOpts, wmsStatus: 'split', omsPickedMap: { 99: 50 } };
    var result = buildSoLineRowHtml(baseLine, baseWms, opts, mockHelpers);
    expect(result.html).toContain('0');
    expect(result.html).toContain('100');
  });

  test('SO 模式: split + quantity 为 0 → displayOpen 不为负', () => {
    var zeroLine = Object.assign({}, baseLine, { quantity: 0 });
    var opts = { ...baseOpts, wmsStatus: 'split', omsPickedMap: { 0: 5 } };
    var result = buildSoLineRowHtml(zeroLine, baseWms, opts, mockHelpers);
    expect(result.html).toContain('0');
  });

  test('DD 模式: 已完成行', () => {
    var ddLine = Object.assign({}, baseLine, { lineStatus: 'C' });
    var ddOpts = { ...baseOpts, isDD: true };
    var result = buildSoLineRowHtml(ddLine, baseWms, ddOpts, mockHelpers);
    expect(result.lineDone).toBe(true);
    expect(result.html).toContain('已完成');
  });

  test('条码图片链接正确生成', () => {
    var result = buildSoLineRowHtml(baseLine, baseWms, baseOpts, mockHelpers);
    expect(result.html).toContain('/barcode/ITEM-001/qrcode');
  });

  test('物料名称为空安全处理', () => {
    var noName = Object.assign({}, baseLine, { itemName: '' });
    var result = buildSoLineRowHtml(noName, baseWms, baseOpts, mockHelpers);
    expect(result.html).toContain('ITEM-001');
    // 不应崩溃
  });

  test('escapeHtml 被正确调用 (文本列)', () => {
    var xssLine = Object.assign({}, baseLine, { itemCode: '<b>XSS</b>' });
    var result = buildSoLineRowHtml(xssLine, baseWms, baseOpts, mockHelpers);
    // 文本列已转义
    expect(result.html).toContain('&lt;b&gt;XSS&lt;/b&gt;');
  });
});

// ============================================================================
// buildHistoryRowsHtml — 事务历史 HTML 构建 (纯函数)
// ============================================================================

describe('buildHistoryRowsHtml — 历史行 HTML 构建', () => {
  var mockHelpers = {
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    formatNumber: (n) => String(n),
    formatDateTime: (dt) => dt || '-',
  };

  test('空数组返回空字符串', () => {
    expect(buildHistoryRowsHtml([], mockHelpers)).toBe('');
  });

  test('null 返回空字符串', () => {
    expect(buildHistoryRowsHtml(null, mockHelpers)).toBe('');
  });

  test('undefined 返回空字符串', () => {
    expect(buildHistoryRowsHtml(undefined, mockHelpers)).toBe('');
  });

  test('单条记录渲染正确', () => {
    var txs = [{
      transaction_time: '2026-03-06 10:30',
      item_code: 'ITEM-001',
      item_name: '测试物料',
      quantity: 10,
      performed_by: '操作员A',
      remarks: '正常拣货',
    }];
    var html = buildHistoryRowsHtml(txs, mockHelpers);
    expect(html).toContain('<tr>');
    expect(html).toContain('2026-03-06 10:30');
    expect(html).toContain('ITEM-001');
    expect(html).toContain('测试物料');
    expect(html).toContain('10');
    expect(html).toContain('操作员A');
    expect(html).toContain('正常拣货');
  });

  test('多条记录拼接', () => {
    var txs = [
      { transaction_time: 'T1', item_code: 'A', item_name: '', quantity: 1, performed_by: 'U1', remarks: '' },
      { transaction_time: 'T2', item_code: 'B', item_name: '', quantity: 2, performed_by: 'U2', remarks: '' },
    ];
    var html = buildHistoryRowsHtml(txs, mockHelpers);
    var trCount = (html.match(/<tr>/g) || []).length;
    expect(trCount).toBe(2);
  });

  test('item_name 为空显示 -', () => {
    var txs = [{ transaction_time: '', item_code: 'X', item_name: '', quantity: 0, performed_by: 'U', remarks: '' }];
    var html = buildHistoryRowsHtml(txs, mockHelpers);
    expect(html).toContain('-');
  });

  test('remarks 为空显示 -', () => {
    var txs = [{ transaction_time: '', item_code: 'X', item_name: 'N', quantity: 0, performed_by: 'U', remarks: '' }];
    var html = buildHistoryRowsHtml(txs, mockHelpers);
    // remarks '' || '-' → '-'
    expect(html).toContain('-');
  });

  test('XSS 防护', () => {
    var txs = [{
      transaction_time: '', item_code: '<img onerror=alert(1)>',
      item_name: '', quantity: 0, performed_by: '', remarks: '',
    }];
    var html = buildHistoryRowsHtml(txs, mockHelpers);
    expect(html).toContain('&lt;img onerror=alert(1)&gt;');
    expect(html).not.toContain('<img onerror');
  });
});
