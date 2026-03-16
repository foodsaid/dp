/**
 * po.js 采购收货页纯函数单元测试
 * 覆盖: 已收/待收计算 / 行完成判定 / payload 构建 / 一键收货行过滤
 * 🚨 专项: 0.00001 超小值精度保护
 *
 * 纯函数通过 require() 直接导入，无需 DOM 环境
 */

const {
  getPoLineReceived,
  calcPoLineOpen,
  isPoLineDone,
  buildPoReceiptPayload,
  buildPoOpenLines,
  buildPoLineRowHtml,
  buildPoHistoryRowsHtml,
} = require('../../../apps/wms/po');

// ============================================================================
// getPoLineReceived — 获取行已收数量
// ============================================================================

describe('getPoLineReceived — 已收数量', () => {

  test('正常取值', () => {
    var wms = { lineReceipts: { 1: 10, 2: 20 } };
    expect(getPoLineReceived(wms, 1)).toBe(10);
    expect(getPoLineReceived(wms, 2)).toBe(20);
  });

  test('行号不存在返回 0', () => {
    var wms = { lineReceipts: { 1: 10 } };
    expect(getPoLineReceived(wms, 99)).toBe(0);
  });

  test('lineReceipts 为空返回 0', () => {
    expect(getPoLineReceived({}, 1)).toBe(0);
    expect(getPoLineReceived({ lineReceipts: null }, 1)).toBe(0);
  });

  test('wms 为 null/undefined 返回 0', () => {
    expect(getPoLineReceived(null, 1)).toBe(0);
    expect(getPoLineReceived(undefined, 1)).toBe(0);
  });

  // 🚨 超小值
  test('已收 0.00001 正常返回', () => {
    var wms = { lineReceipts: { 1: 0.00001 } };
    expect(getPoLineReceived(wms, 1)).toBe(0.00001);
  });
});

// ============================================================================
// calcPoLineOpen — 行待收数量
// ============================================================================

describe('calcPoLineOpen — 待收数量', () => {

  test('标准: openQty=100, received=30 → 70', () => {
    expect(calcPoLineOpen({ openQty: 100 }, 30)).toBe(70);
  });

  test('无 openQty 时使用 quantity', () => {
    expect(calcPoLineOpen({ quantity: 50 }, 20)).toBe(30);
  });

  test('openQty 为 0 优先使用 (不回退到 quantity)', () => {
    expect(calcPoLineOpen({ openQty: 0, quantity: 50 }, 0)).toBe(0);
  });

  test('已收超量返回负数', () => {
    expect(calcPoLineOpen({ openQty: 10 }, 15)).toBe(-5);
  });

  test('刚好完成返回 0', () => {
    expect(calcPoLineOpen({ openQty: 10 }, 10)).toBe(0);
  });

  test('null/undefined 安全', () => {
    expect(calcPoLineOpen({}, null)).toBe(0);
    expect(calcPoLineOpen({ openQty: undefined, quantity: undefined }, undefined)).toBe(0);
  });

  // 🚨 超小值精度测试
  test('超小值: openQty=0.00003, received=0.00002 → 0.00001', () => {
    var result = calcPoLineOpen({ openQty: 0.00003 }, 0.00002);
    expect(result).toBeCloseTo(0.00001, 6);
    expect(result).not.toBe(0);
  });

  test('超小值不被抹零: 0.00001', () => {
    var result = calcPoLineOpen({ openQty: 0.00001 }, 0);
    expect(result).toBe(0.00001);
  });

  test('浮点精度: 0.3 - 0.1 = 0.2', () => {
    var result = calcPoLineOpen({ openQty: 0.3 }, 0.1);
    expect(result).toBeCloseTo(0.2, 6);
  });

  test('六位小数精度', () => {
    var result = calcPoLineOpen({ openQty: 1.123456 }, 0.123456);
    expect(result).toBeCloseTo(1.0, 6);
  });
});

// ============================================================================
// isPoLineDone — 行完成判定
// ============================================================================

describe('isPoLineDone — 行完成判定', () => {

  test('headerClosed=true → 完成', () => {
    expect(isPoLineDone(true, 'O', 10)).toBe(true);
  });

  test('lineStatus=C → 完成', () => {
    expect(isPoLineDone(false, 'C', 10)).toBe(true);
  });

  test('open <= 0 → 完成', () => {
    expect(isPoLineDone(false, 'O', 0)).toBe(true);
    expect(isPoLineDone(false, 'O', -1)).toBe(true);
  });

  test('正常未完成', () => {
    expect(isPoLineDone(false, 'O', 10)).toBe(false);
  });

  // 🚨 超小值边界
  test('open = 0.00001 → 未完成', () => {
    expect(isPoLineDone(false, 'O', 0.00001)).toBe(false);
  });

  test('open = -0.00001 → 完成', () => {
    expect(isPoLineDone(false, 'O', -0.00001)).toBe(true);
  });
});

// ============================================================================
// buildPoReceiptPayload — 收货 payload 构建
// ============================================================================

describe('buildPoReceiptPayload — payload 构建', () => {

  var mockOrder = { docNum: '200001', docEntry: 88 };
  var mockLine = {
    itemCode: 'MAT-001', itemName: '原料A',
    lineNum: 1, whsCode: 'WH02', quantity: 100, uom: 'PCS'
  };

  test('标准 payload', () => {
    var p = buildPoReceiptPayload(mockOrder, mockLine, 50, '李四', '正常', 'BIN-B01');
    expect(p.doc_type).toBe('PO');
    expect(p.doc_number).toBe('200001');
    expect(p.sap_doc_entry).toBe(88);
    expect(p.item_code).toBe('MAT-001');
    expect(p.line_num).toBe(1);
    expect(p.quantity).toBe(50);
    expect(p.warehouse_code).toBe('WH02');
    expect(p.bin_location).toBe('BIN-B01');
    expect(p.performed_by).toBe('李四');
    expect(p.action).toBe('receipt');
    expect(p.planned_qty).toBe(100);
    expect(p.uom).toBe('PCS');
  });

  test('库位为空回退到 {仓库}-SYSTEM-BIN-LOCATION', () => {
    var p = buildPoReceiptPayload(mockOrder, mockLine, 10, '李四', '', '');
    expect(p.bin_location).toBe('WH02-SYSTEM-BIN-LOCATION');
  });

  test('defaultBin 参数优先于硬编码 fallback', () => {
    var p = buildPoReceiptPayload(mockOrder, mockLine, 10, '李四', '', '', '', '', 'WH02-RECEIVING-BIN');
    expect(p.bin_location).toBe('WH02-RECEIVING-BIN');
  });

  test('binVal 优先于 defaultBin', () => {
    var p = buildPoReceiptPayload(mockOrder, mockLine, 10, '李四', '', 'BIN-B01', '', '', 'WH02-RECEIVING-BIN');
    expect(p.bin_location).toBe('BIN-B01');
  });

  test('defaultBin 未传时仍走硬编码 fallback (向后兼容)', () => {
    var p = buildPoReceiptPayload(mockOrder, mockLine, 10, '李四', '', '');
    expect(p.bin_location).toBe('WH02-SYSTEM-BIN-LOCATION');
  });

  test('含批次信息', () => {
    var p = buildPoReceiptPayload(mockOrder, mockLine, 10, '李四', '', 'BIN-B01', 'BAT001', '20260301');
    expect(p.batch_number).toBe('BAT001');
    expect(p.production_date).toBe('20260301');
  });

  test('无批次时不含 batch_number 字段', () => {
    var p = buildPoReceiptPayload(mockOrder, mockLine, 10, '李四', '', 'BIN-B01', '', '');
    expect(p).not.toHaveProperty('batch_number');
    expect(p).not.toHaveProperty('production_date');
  });

  // 🚨 超小值
  test('超小数量 0.00001 正常传递', () => {
    var p = buildPoReceiptPayload(mockOrder, mockLine, 0.00001, '李四', '', 'BIN');
    expect(p.quantity).toBe(0.00001);
  });
});

// ============================================================================
// buildPoOpenLines — 一键收货行过滤
// ============================================================================

describe('buildPoOpenLines — 一键收货行过滤', () => {

  test('过滤出待收行', () => {
    var lines = [
      { lineNum: 1, itemCode: 'A', openQty: 10, lineStatus: 'O', whsCode: 'WH', uom: 'PCS', quantity: 10, itemName: 'ItemA' },
      { lineNum: 2, itemCode: 'B', openQty: 0, lineStatus: 'O', whsCode: 'WH', uom: 'PCS', quantity: 5, itemName: 'ItemB' },
      { lineNum: 3, itemCode: 'C', openQty: 5, lineStatus: 'C', whsCode: 'WH', uom: 'PCS', quantity: 5, itemName: 'ItemC' },
    ];
    var wms = { lineReceipts: { 2: 0 } };
    var result = buildPoOpenLines(lines, wms);
    expect(result).toHaveLength(1);
    expect(result[0].itemCode).toBe('A');
    expect(result[0]._open).toBe(10);
  });

  test('部分已收的行正确计算 _open', () => {
    var lines = [{ lineNum: 1, itemCode: 'A', openQty: 10, lineStatus: 'O', whsCode: 'WH', uom: 'PCS', quantity: 10, itemName: '' }];
    var wms = { lineReceipts: { 1: 7 } };
    var result = buildPoOpenLines(lines, wms);
    expect(result).toHaveLength(1);
    expect(result[0]._open).toBe(3);
  });

  test('空行列表返回空', () => {
    expect(buildPoOpenLines([], {})).toEqual([]);
    expect(buildPoOpenLines(null, {})).toEqual([]);
  });

  test('wms 为 null 安全处理', () => {
    var lines = [{ lineNum: 1, itemCode: 'A', openQty: 5, lineStatus: 'O', quantity: 5, itemName: '' }];
    var result = buildPoOpenLines(lines, null);
    expect(result).toHaveLength(1);
    expect(result[0]._open).toBe(5);
  });

  // 🚨 超小值
  test('超小值 0.00001 待收行不被过滤', () => {
    var lines = [{ lineNum: 1, itemCode: 'A', openQty: 0.00001, lineStatus: 'O', quantity: 0.00001, itemName: '' }];
    var result = buildPoOpenLines(lines, {});
    expect(result).toHaveLength(1);
    expect(result[0]._open).toBeCloseTo(0.00001, 6);
  });

  test('超小差值 0.00001 残留行保留', () => {
    var lines = [{ lineNum: 1, itemCode: 'A', openQty: 0.00003, lineStatus: 'O', quantity: 0.00003, itemName: '' }];
    var wms = { lineReceipts: { 1: 0.00002 } };
    var result = buildPoOpenLines(lines, wms);
    expect(result).toHaveLength(1);
    expect(result[0]._open).toBeCloseTo(0.00001, 6);
  });
});

// ============================================================================
// 集成场景 — PO 收货流程
// ============================================================================

describe('集成场景 — PO 收货流程', () => {

  test('场景: 多行收货到完成', () => {
    var lines = [
      { lineNum: 1, itemCode: 'A', openQty: 10, lineStatus: 'O', quantity: 10, itemName: 'ItemA' },
      { lineNum: 2, itemCode: 'B', openQty: 20, lineStatus: 'O', quantity: 20, itemName: 'ItemB' },
    ];
    var wms = { lineReceipts: { 1: 10, 2: 15 } };

    // A 行已完成
    var openA = calcPoLineOpen(lines[0], getPoLineReceived(wms, 1));
    expect(openA).toBe(0);
    expect(isPoLineDone(false, 'O', openA)).toBe(true);

    // B 行还剩 5
    var openB = calcPoLineOpen(lines[1], getPoLineReceived(wms, 2));
    expect(openB).toBe(5);
    expect(isPoLineDone(false, 'O', openB)).toBe(false);

    // 一键收货只找到 B
    var openLines = buildPoOpenLines(lines, wms);
    expect(openLines).toHaveLength(1);
    expect(openLines[0].itemCode).toBe('B');
  });

  test('场景: 超小值累加精度验证', () => {
    // 模拟 5 次 0.00001 的收货
    var total = 0;
    for (var i = 0; i < 5; i++) {
      total = Number((total + 0.00001).toFixed(6));
    }
    var result = calcPoLineOpen({ openQty: 0.00005 }, total);
    expect(result).toBeCloseTo(0, 6);
  });
});

// ============================================================================
// buildPoLineRowHtml — PO 行项目 HTML 构建 (纯函数)
// ============================================================================

describe('buildPoLineRowHtml — PO 行 HTML 构建', () => {
  var h = {
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    formatNumber: (n) => String(n),
    generateBarcodeUrl: (code, type) => '/barcode/' + code + '/' + type,
  };

  var baseLine = {
    lineNum: 0, itemCode: 'PO-ITEM-001', itemName: '采购物料',
    quantity: 100, openQty: 100, lineStatus: 'O', whsCode: 'WH01',
  };
  var baseWms = { lineReceipts: {} };

  test('开放行渲染收货按钮', () => {
    var result = buildPoLineRowHtml(baseLine, baseWms, { headerClosed: false }, h);
    expect(result.lineDone).toBe(false);
    expect(result.html).toContain('PO-ITEM-001');
    expect(result.html).toContain('收货');
    expect(result.html).toContain('selectLine(0)');
  });

  test('已完成行渲染已完成标签', () => {
    var wms = { lineReceipts: { 0: 100 } };
    var result = buildPoLineRowHtml(baseLine, wms, { headerClosed: false }, h);
    expect(result.lineDone).toBe(true);
    expect(result.html).toContain('已完成');
    expect(result.html).toContain('line-done');
  });

  test('headerClosed 标记所有行完成', () => {
    var result = buildPoLineRowHtml(baseLine, baseWms, { headerClosed: true }, h);
    expect(result.lineDone).toBe(true);
    expect(result.html).toContain('已完成');
  });

  test('行状态 C 标记完成', () => {
    var closedLine = Object.assign({}, baseLine, { lineStatus: 'C' });
    var result = buildPoLineRowHtml(closedLine, baseWms, { headerClosed: false }, h);
    expect(result.lineDone).toBe(true);
  });

  test('部分收货显示正确数量', () => {
    var wms = { lineReceipts: { 0: 40 } };
    var result = buildPoLineRowHtml(baseLine, wms, { headerClosed: false }, h);
    expect(result.html).toContain('40');  // received
    expect(result.html).toContain('60');  // open
  });

  test('条码图片 URL 正确', () => {
    var result = buildPoLineRowHtml(baseLine, baseWms, { headerClosed: false }, h);
    expect(result.html).toContain('/barcode/PO-ITEM-001/qrcode');
  });
});

// ============================================================================
// buildPoHistoryRowsHtml — PO 事务历史 HTML 构建 (纯函数)
// ============================================================================

describe('buildPoHistoryRowsHtml — PO 历史行 HTML 构建', () => {
  var h = {
    escapeHtml: (s) => String(s),
    formatNumber: (n) => String(n),
    formatDateTime: (dt) => dt || '-',
  };

  test('空数组返回空字符串', () => {
    expect(buildPoHistoryRowsHtml([], h)).toBe('');
  });

  test('null 返回空字符串', () => {
    expect(buildPoHistoryRowsHtml(null, h)).toBe('');
  });

  test('单条记录渲染正确', () => {
    var txs = [{
      transaction_time: '2026-03-06 10:30', item_code: 'ITEM-001',
      item_name: '物料A', quantity: 10, performed_by: '操作员', remarks: '备注',
    }];
    var html = buildPoHistoryRowsHtml(txs, h);
    expect(html).toContain('ITEM-001');
    expect(html).toContain('2026-03-06 10:30');
    expect(html).toContain('10');
  });

  test('多条记录生成多行', () => {
    var txs = [
      { transaction_time: '', item_code: 'A', item_name: '', quantity: 1, performed_by: 'U1', remarks: '' },
      { transaction_time: '', item_code: 'B', item_name: '', quantity: 2, performed_by: 'U2', remarks: '' },
    ];
    var html = buildPoHistoryRowsHtml(txs, h);
    expect((html.match(/<tr>/g) || []).length).toBe(2);
  });
});

// ============================================================================
// 分支覆盖补充 — po.js 边缘场景
// ============================================================================

describe('po.js 分支覆盖补充', () => {

  test('calcPoLineOpen: openQty undefined + quantity 也为 0 → 基准 0', () => {
    expect(calcPoLineOpen({ quantity: 0 }, 0)).toBe(0);
  });

  test('calcPoLineOpen: openQty undefined + quantity undefined → 基准 0', () => {
    expect(calcPoLineOpen({}, 3)).toBe(-3);
  });

  test('buildPoReceiptPayload: whsCode 缺失时回退 SYSTEM', () => {
    var order = { docNum: '200001', docEntry: 88 };
    var line = { itemCode: 'MAT', itemName: 'A', lineNum: 1, quantity: 10, uom: 'PCS' };
    var p = buildPoReceiptPayload(order, line, 5, '李四', '', '');
    expect(p.bin_location).toBe('SYSTEM-SYSTEM-BIN-LOCATION');
  });

  test('buildPoReceiptPayload: 仅 productionDate 无 batchNumber → 仅含 production_date', () => {
    var order = { docNum: '200001', docEntry: 88 };
    var line = { itemCode: 'MAT', itemName: 'A', lineNum: 1, whsCode: 'WH', quantity: 10, uom: 'PCS' };
    var p = buildPoReceiptPayload(order, line, 5, '李四', '', 'BIN', '', '20260301');
    expect(p).not.toHaveProperty('batch_number');
    expect(p.production_date).toBe('20260301');
  });

  test('buildPoLineRowHtml: 物料名为空安全回退', () => {
    var h = {
      escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
      formatNumber: (n) => String(n),
      generateBarcodeUrl: (code, type) => '/barcode/' + code + '/' + type,
    };
    var line = { lineNum: 1, itemCode: 'PO-001', itemName: '', quantity: 10, openQty: 10, whsCode: 'WH', lineStatus: 'O' };
    var result = buildPoLineRowHtml(line, {}, { headerClosed: false }, h);
    expect(result.html).toContain('PO-001');
    expect(result.lineDone).toBe(false);
  });

  test('buildPoLineRowHtml: 物料名和仓库都为 null → 不崩溃', () => {
    var h = {
      escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
      formatNumber: (n) => String(n),
      generateBarcodeUrl: (code, type) => '/barcode/' + code + '/' + type,
    };
    var line = { lineNum: 1, itemCode: 'PO-002', itemName: null, quantity: 5, openQty: 5, whsCode: null, lineStatus: 'O' };
    var result = buildPoLineRowHtml(line, {}, { headerClosed: false }, h);
    expect(result.html).toContain('PO-002');
  });

  test('buildPoOpenLines: lineStatus=C 的行即使有 open 数量也被过滤', () => {
    var lines = [
      { lineNum: 1, itemCode: 'A', openQty: 10, quantity: 10, lineStatus: 'C' },
      { lineNum: 2, itemCode: 'B', openQty: 5, quantity: 5, lineStatus: 'O' },
    ];
    var result = buildPoOpenLines(lines, {});
    expect(result).toHaveLength(1);
    expect(result[0].itemCode).toBe('B');
  });
});
