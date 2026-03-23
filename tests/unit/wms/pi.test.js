/**
 * pi.js 生产发货页纯函数单元测试
 * 覆盖: 已发数量 / 三变量待发计算 / 单据头关闭判定 / payload 构建 / 一键发料行过滤
 * 🚨 专项: PI 单据真实存在 0.00001 级别 BOM 用量，超高精度是核心防线
 *
 * 纯函数通过 require() 直接导入，无需 DOM 环境
 */

const {
  getPiLineIssued,
  calcPiLineOpen,
  isPiHeaderClosed,
  buildPiIssuePayload,
  buildPiOpenLines,
  buildPiLineRowHtml,
  buildPiHistoryRowsHtml,
} = require('../../../apps/wms/pi');

// ============================================================================
// getPiLineIssued — 获取行已发数量
// ============================================================================

describe('getPiLineIssued — 已发数量', () => {

  test('正常取值', () => {
    var wms = { lineReceipts: { 1: 5, 2: 10 } };
    expect(getPiLineIssued(wms, 1)).toBe(5);
    expect(getPiLineIssued(wms, 2)).toBe(10);
  });

  test('行号不存在返回 0', () => {
    expect(getPiLineIssued({ lineReceipts: {} }, 99)).toBe(0);
  });

  test('wms 为 null/undefined 返回 0', () => {
    expect(getPiLineIssued(null, 1)).toBe(0);
    expect(getPiLineIssued(undefined, 1)).toBe(0);
  });

  test('lineReceipts 缺失返回 0', () => {
    expect(getPiLineIssued({}, 1)).toBe(0);
  });

  // 🚨 超小值
  test('已发 0.00001 正常返回', () => {
    var wms = { lineReceipts: { 1: 0.00001 } };
    expect(getPiLineIssued(wms, 1)).toBe(0.00001);
  });
});

// ============================================================================
// calcPiLineOpen — 三变量待发数量 (baseQty - sapIssued - wmsIssued)
// ============================================================================

describe('calcPiLineOpen — 三变量待发数量', () => {

  test('标准: 100 - 30 - 20 = 50', () => {
    expect(calcPiLineOpen(100, 30, 20)).toBe(50);
  });

  test('全部完成: 100 - 60 - 40 = 0', () => {
    expect(calcPiLineOpen(100, 60, 40)).toBe(0);
  });

  test('超发: 100 - 80 - 30 = -10', () => {
    expect(calcPiLineOpen(100, 80, 30)).toBe(-10);
  });

  test('仅基准: 50 - 0 - 0 = 50', () => {
    expect(calcPiLineOpen(50, 0, 0)).toBe(50);
  });

  test('零基准: 0 - 0 - 0 = 0', () => {
    expect(calcPiLineOpen(0, 0, 0)).toBe(0);
  });

  test('null/undefined 安全', () => {
    expect(calcPiLineOpen(null, null, null)).toBe(0);
    expect(calcPiLineOpen(100, undefined, undefined)).toBe(100);
    expect(calcPiLineOpen(undefined, 50, undefined)).toBe(-50);
  });

  test('字符串数字转换', () => {
    expect(calcPiLineOpen('100', '30', '20')).toBe(50);
  });

  test('非数字字符串视为 0', () => {
    expect(calcPiLineOpen('abc', 'def', 'ghi')).toBe(0);
  });

  // 🚨 精度容差测试 — DB DECIMAL(18,4) vs SAP 6位小数
  // 差值 < 0.00005 时视为 0，避免 SAP 6位精度和 DB 4位精度差导致永远无法关单
  test('精度容差: 0.00003 - 0.00001 - 0.00001 = 0.00001 → 归零 (< 0.00005)', () => {
    var result = calcPiLineOpen(0.00003, 0.00001, 0.00001);
    expect(result).toBe(0); // DB 存不了 0.00001，容差内归零
  });

  test('精度容差: 0.00001 - 0 - 0 → 归零 (< 0.00005)', () => {
    var result = calcPiLineOpen(0.00001, 0, 0);
    expect(result).toBe(0); // DB DECIMAL(18,4) 无法存储此精度
  });

  test('精度容差: 0.00005 - 0.00002 - 0.00002 = 0.00001 → 归零', () => {
    var result = calcPiLineOpen(0.00005, 0.00002, 0.00002);
    expect(result).toBe(0);
  });

  test('精度边界: 0.0001 不被归零 (= 0.00005 阈值)', () => {
    var result = calcPiLineOpen(0.0001, 0, 0);
    expect(result).toBe(0.0001); // DB 最小可存精度，保留
  });

  test('真实场景: SAP 6位 0.018519 vs DB 4位 0.0185 → 差值 0.000019 归零', () => {
    var result = calcPiLineOpen(0.018519, 0, 0.0185);
    expect(result).toBe(0); // 精度截断差异，视为已完成
  });

  test('浮点精度: 1.3 - 0.1 - 0.2 = 1.0', () => {
    var result = calcPiLineOpen(1.3, 0.1, 0.2);
    expect(result).toBeCloseTo(1.0, 6);
  });

  test('六位小数: 1.123456 - 0.123456 - 0.5 = 0.5', () => {
    var result = calcPiLineOpen(1.123456, 0.123456, 0.5);
    expect(result).toBeCloseTo(0.5, 6);
  });

  test('大数减超小值: 999999.00002 - 999999 - 0.00001 → 归零 (< 0.00005)', () => {
    var result = calcPiLineOpen(999999.00002, 999999, 0.00001);
    expect(result).toBe(0); // 差值 0.00001 < 阈值
  });
});

// ============================================================================
// isPiHeaderClosed — PI 单据头关闭判定
// ============================================================================

describe('isPiHeaderClosed — 单据头关闭判定', () => {

  test('R (Released) → 未关闭', () => {
    expect(isPiHeaderClosed('R')).toBe(false);
  });

  test('P (Planned) → 未关闭', () => {
    expect(isPiHeaderClosed('P')).toBe(false);
  });

  test('C (Closed) → 已关闭', () => {
    expect(isPiHeaderClosed('C')).toBe(true);
  });

  test('L (Cancelled) → 已关闭', () => {
    expect(isPiHeaderClosed('L')).toBe(true);
  });

  test('O → 已关闭 (PI 不使用 O 状态)', () => {
    expect(isPiHeaderClosed('O')).toBe(true);
  });

  test('undefined → 已关闭', () => {
    expect(isPiHeaderClosed(undefined)).toBe(true);
  });

  test('空字符串 → 已关闭', () => {
    expect(isPiHeaderClosed('')).toBe(true);
  });
});

// ============================================================================
// buildPiIssuePayload — 发料 payload 构建
// ============================================================================

describe('buildPiIssuePayload — payload 构建', () => {

  var mockOrder = { docNum: '400001', docEntry: 66 };
  var mockLine = {
    itemCode: 'RAW-001', itemName: '原料B',
    lineNum: 3, whsCode: 'WH04', baseQty: 100, uom: 'KG'
  };

  test('标准 payload', () => {
    var p = buildPiIssuePayload(mockOrder, mockLine, 50, '赵六', '生产领料');
    expect(p.doc_type).toBe('PI');
    expect(p.doc_number).toBe('400001');
    expect(p.sap_doc_entry).toBe(66);
    expect(p.item_code).toBe('RAW-001');
    expect(p.line_num).toBe(3);
    expect(p.quantity).toBe(50);
    expect(p.warehouse_code).toBe('WH04');
    expect(p.performed_by).toBe('赵六');
    expect(p.action).toBe('issue'); // PI 特有
    expect(p.planned_qty).toBe(100);
    expect(p.uom).toBe('KG');
  });

  test('优先使用 baseQty 作为 planned_qty', () => {
    var line = { itemCode: 'X', lineNum: 1, baseQty: 80, plannedQty: 100, whsCode: 'WH', uom: 'PCS' };
    var p = buildPiIssuePayload(mockOrder, line, 10, '赵六', '');
    expect(p.planned_qty).toBe(80); // baseQty 优先
  });

  test('baseQty 缺失时回退到 plannedQty', () => {
    var line = { itemCode: 'X', lineNum: 1, plannedQty: 60, whsCode: 'WH', uom: 'PCS' };
    var p = buildPiIssuePayload(mockOrder, line, 10, '赵六', '');
    expect(p.planned_qty).toBe(60);
  });

  test('都缺失时 planned_qty = 0', () => {
    var line = { itemCode: 'X', lineNum: 1, whsCode: 'WH', uom: 'PCS' };
    var p = buildPiIssuePayload(mockOrder, line, 10, '赵六', '');
    expect(p.planned_qty).toBe(0);
  });

  // 🚨 超小值
  test('超小数量 0.00001 正常传递', () => {
    var p = buildPiIssuePayload(mockOrder, mockLine, 0.00001, '赵六', '');
    expect(p.quantity).toBe(0.00001);
  });
});

// ============================================================================
// buildPiOpenLines — 一键发料行过滤
// ============================================================================

describe('buildPiOpenLines — 一键发料行过滤', () => {

  test('过滤出待发行', () => {
    var lines = [
      { lineNum: 1, itemCode: 'A', baseQty: 10, issuedQty: 5, itemName: 'ItemA', whsCode: 'WH', uom: 'PCS' },
      { lineNum: 2, itemCode: 'B', baseQty: 10, issuedQty: 10, itemName: 'ItemB', whsCode: 'WH', uom: 'PCS' },
    ];
    var wms = { lineReceipts: {} };
    var result = buildPiOpenLines(lines, wms);
    expect(result).toHaveLength(1);
    expect(result[0].itemCode).toBe('A');
    expect(result[0]._open).toBe(5);
  });

  test('WMS 已发部分扣减', () => {
    var lines = [{ lineNum: 1, itemCode: 'A', baseQty: 20, issuedQty: 5, itemName: '' }];
    var wms = { lineReceipts: { 1: 10 } };
    var result = buildPiOpenLines(lines, wms);
    expect(result).toHaveLength(1);
    expect(result[0]._open).toBe(5); // 20 - 5 - 10
  });

  test('空行列表返回空', () => {
    expect(buildPiOpenLines([], {})).toEqual([]);
    expect(buildPiOpenLines(null, {})).toEqual([]);
  });

  // 🚨 超小值
  test('精度容差: 0.00001 待发行被归零后过滤掉', () => {
    var lines = [{ lineNum: 1, itemCode: 'A', baseQty: 0.00001, issuedQty: 0, itemName: '', whsCode: 'WH', uom: 'PCS' }];
    var result = buildPiOpenLines(lines, {});
    expect(result).toHaveLength(0); // < 0.00005 阈值，视为已完成
  });

  test('精度容差: SAP 6位 vs DB 4位截断残留被过滤', () => {
    var lines = [{ lineNum: 1, itemCode: 'A', baseQty: 0.018519, issuedQty: 0, itemName: '', whsCode: 'WH', uom: 'PCS' }];
    var wms = { lineReceipts: { 1: 0.0185 } };
    var result = buildPiOpenLines(lines, wms);
    expect(result).toHaveLength(0); // 差值 0.000019 < 阈值
  });

  test('精度边界: 0.0001 待发行保留不被过滤', () => {
    var lines = [{ lineNum: 1, itemCode: 'A', baseQty: 0.0001, issuedQty: 0, itemName: '', whsCode: 'WH', uom: 'PCS' }];
    var result = buildPiOpenLines(lines, {});
    expect(result).toHaveLength(1);
    expect(result[0]._open).toBe(0.0001);
  });

  test('全部发完后过滤为空', () => {
    var lines = [{ lineNum: 1, itemCode: 'A', baseQty: 0.00003, issuedQty: 0.00001, itemName: '' }];
    var wms = { lineReceipts: { 1: 0.00002 } };
    var result = buildPiOpenLines(lines, wms);
    expect(result).toHaveLength(0); // 0.00003 - 0.00001 - 0.00002 = 0
  });
});

// ============================================================================
// 集成场景 — PI 发料流程
// ============================================================================

describe('集成场景 — PI 发料流程', () => {

  test('场景: BOM 多行逐步发料', () => {
    var lines = [
      { lineNum: 1, itemCode: 'RAW-A', baseQty: 10, issuedQty: 0, itemName: 'A' },
      { lineNum: 2, itemCode: 'RAW-B', baseQty: 20, issuedQty: 5, itemName: 'B' },
      { lineNum: 3, itemCode: 'RAW-C', baseQty: 5, issuedQty: 5, itemName: 'C' },
    ];
    var wms = { lineReceipts: { 1: 8, 3: 0 } };

    // 行 1: 剩余 10 - 0 - 8 = 2
    expect(calcPiLineOpen(10, 0, getPiLineIssued(wms, 1))).toBe(2);

    // 行 2: 剩余 20 - 5 - 0 = 15
    expect(calcPiLineOpen(20, 5, getPiLineIssued(wms, 2))).toBe(15);

    // 行 3: 已完成 5 - 5 - 0 = 0
    expect(calcPiLineOpen(5, 5, getPiLineIssued(wms, 3))).toBe(0);

    // 一键发料: 只有行1和行2
    var openLines = buildPiOpenLines(lines, wms);
    expect(openLines).toHaveLength(2);
    expect(openLines[0].itemCode).toBe('RAW-A');
    expect(openLines[1].itemCode).toBe('RAW-B');
  });

  test('场景: DB 4位精度 BOM 用量逐次发料至零', () => {
    // 真实场景: BOM 用量 0.0048 (DB 可存)，逐次发 0.0012
    var baseQty = 0.0048;
    var sapIssued = 0;
    var wmsTotal = 0;

    for (var i = 0; i < 3; i++) {
      var remaining = calcPiLineOpen(baseQty, sapIssued, wmsTotal);
      expect(remaining).toBeGreaterThan(0);
      wmsTotal = Number((wmsTotal + 0.0012).toFixed(4));
    }
    // 第3次后 wmsTotal = 0.0036, remaining = 0.0012
    expect(calcPiLineOpen(baseQty, sapIssued, wmsTotal)).toBeCloseTo(0.0012, 4);

    wmsTotal = Number((wmsTotal + 0.0012).toFixed(4)); // 0.0048
    var final_val = calcPiLineOpen(baseQty, sapIssued, wmsTotal);
    expect(final_val).toBe(0);
  });

  test('场景: PI headerClosed 与 PO 的区别', () => {
    // PI 使用 status 字段, 允许 R/P
    expect(isPiHeaderClosed('R')).toBe(false);
    expect(isPiHeaderClosed('P')).toBe(false);
    // 而 PO 使用 docStatus, 只允许 O
    // 这验证了两个模块的业务隔离
    expect(isPiHeaderClosed('O')).toBe(true); // PI 中 O 视为已关闭
  });
});

// ============================================================================
// buildPiLineRowHtml — PI 行项目 HTML 构建 (纯函数)
// ============================================================================

describe('buildPiLineRowHtml — PI 行 HTML 构建', () => {
  var h = {
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    formatNumber: (n) => String(n),
    generateBarcodeUrl: (code, type) => '/barcode/' + code + '/' + type,
  };

  var baseLine = {
    lineNum: 0, itemCode: 'BOM-001', itemName: 'BOM物料',
    baseQty: 100, issuedQty: 0, whsCode: 'WH01',
  };
  var baseWms = { lineReceipts: {} };

  test('开放行渲染发料按钮', () => {
    var result = buildPiLineRowHtml(baseLine, baseWms, { headerClosed: false }, h);
    expect(result.lineDone).toBe(false);
    expect(result.html).toContain('BOM-001');
    expect(result.html).toContain('发料');
    expect(result.html).toContain('selectLine(0)');
  });

  test('已完成行渲染已完成标签', () => {
    var wms = { lineReceipts: { 0: 100 } };
    var result = buildPiLineRowHtml(baseLine, wms, { headerClosed: false }, h);
    expect(result.lineDone).toBe(true);
    expect(result.html).toContain('已完成');
  });

  test('headerClosed 标记所有行完成', () => {
    var result = buildPiLineRowHtml(baseLine, baseWms, { headerClosed: true }, h);
    expect(result.lineDone).toBe(true);
    expect(result.html).toContain('已完成');
  });

  test('三变量计算: baseQty=100, sapIssued=30, wmsIssued=20', () => {
    var line = Object.assign({}, baseLine, { issuedQty: 30 });
    var wms = { lineReceipts: { 0: 20 } };
    var result = buildPiLineRowHtml(line, wms, { headerClosed: false }, h);
    expect(result.html).toContain('50');  // sapIssued + wmsIssued
    expect(result.lineDone).toBe(false);
  });

  test('plannedQty 回退 (无 baseQty)', () => {
    var line = { lineNum: 0, itemCode: 'X', plannedQty: 80, whsCode: 'WH' };
    var result = buildPiLineRowHtml(line, baseWms, { headerClosed: false }, h);
    expect(result.html).toContain('80');
  });

  test('9 列结构', () => {
    var result = buildPiLineRowHtml(baseLine, baseWms, { headerClosed: false }, h);
    var tdCount = (result.html.match(/<td/g) || []).length;
    expect(tdCount).toBe(9);
  });
});

// ============================================================================
// buildPiHistoryRowsHtml — PI 事务历史 HTML 构建 (纯函数)
// ============================================================================

describe('buildPiHistoryRowsHtml — PI 历史行 HTML 构建', () => {
  var h = {
    escapeHtml: (s) => String(s),
    formatNumber: (n) => String(n),
    formatDateTime: (dt) => dt || '-',
  };

  test('空数组返回空字符串', () => {
    expect(buildPiHistoryRowsHtml([], h)).toBe('');
  });

  test('null 返回空字符串', () => {
    expect(buildPiHistoryRowsHtml(null, h)).toBe('');
  });

  test('单条记录渲染正确', () => {
    var txs = [{
      transaction_time: '2026-03-06', item_code: 'BOM', item_name: 'N',
      quantity: 5, performed_by: 'Op', remarks: '',
    }];
    var html = buildPiHistoryRowsHtml(txs, h);
    expect(html).toContain('BOM');
    expect(html).toContain('5');
  });
});

// ============================================================================
// 分支覆盖补充 — pi.js 边缘场景
// ============================================================================

describe('pi.js 分支覆盖补充', () => {

  test('buildPiOpenLines: baseQty=0, plannedQty 有值 → 使用 plannedQty', () => {
    var lines = [{ lineNum: 1, itemCode: 'A', baseQty: 0, plannedQty: 10, issuedQty: 0, itemName: '', whsCode: 'WH', uom: 'PCS' }];
    var result = buildPiOpenLines(lines, {});
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(10);
    expect(result[0]._open).toBe(10);
  });

  test('buildPiOpenLines: baseQty undefined, plannedQty 有值 → 使用 plannedQty', () => {
    var lines = [{ lineNum: 1, itemCode: 'A', plannedQty: 8, issuedQty: 0, itemName: '', whsCode: 'WH', uom: 'PCS' }];
    var result = buildPiOpenLines(lines, {});
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(8);
  });

  test('buildPiOpenLines: baseQty 和 plannedQty 都为 0 → 过滤掉', () => {
    var lines = [{ lineNum: 1, itemCode: 'A', baseQty: 0, plannedQty: 0, issuedQty: 0, itemName: '' }];
    var result = buildPiOpenLines(lines, {});
    expect(result).toHaveLength(0);
  });

  test('buildPiLineRowHtml: baseQty=0, plannedQty 有值 → 使用 plannedQty', () => {
    var h = {
      escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
      formatNumber: (n) => String(n),
      generateBarcodeUrl: (code, type) => '/barcode/' + code + '/' + type,
    };
    var line = { lineNum: 1, itemCode: 'PI-001', itemName: '物料', baseQty: 0, plannedQty: 20, issuedQty: 5, whsCode: 'WH' };
    var result = buildPiLineRowHtml(line, {}, { headerClosed: false }, h);
    expect(result.html).toContain('20');
    expect(result.lineDone).toBe(false);
  });

  test('buildPiLineRowHtml: issuedQty 缺失 → 默认 0', () => {
    var h = {
      escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
      formatNumber: (n) => String(n),
      generateBarcodeUrl: (code, type) => '/barcode/' + code + '/' + type,
    };
    var line = { lineNum: 1, itemCode: 'PI-002', itemName: '', baseQty: 10, whsCode: 'WH' };
    var result = buildPiLineRowHtml(line, {}, { headerClosed: false }, h);
    expect(result.html).toContain('10');
    expect(result.lineDone).toBe(false);
  });

  test('buildPiLineRowHtml: 物料名和仓库都为空 → 安全回退', () => {
    var h = {
      escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
      formatNumber: (n) => String(n),
      generateBarcodeUrl: (code, type) => '/barcode/' + code + '/' + type,
    };
    var line = { lineNum: 1, itemCode: 'PI-003', itemName: null, baseQty: 5, whsCode: null };
    var result = buildPiLineRowHtml(line, {}, { headerClosed: false }, h);
    expect(result.html).toContain('PI-003');
  });

  test('baseQty 和 plannedQty 均为 null → 回退 0 (L101 内层 || 链)', () => {
    var h = {
      escapeHtml: (s) => String(s),
      formatNumber: (n) => String(n),
      generateBarcodeUrl: (code, type) => '/barcode/' + code + '/' + type,
    };
    var line = { lineNum: 1, itemCode: 'PI-004', itemName: 'X', baseQty: null, plannedQty: null, whsCode: 'WH01' };
    var result = buildPiLineRowHtml(line, {}, { headerClosed: false }, h);
    expect(result.html).toContain('0'); // baseQty 回退到 0
  });

  test('baseQty 为 0 但 plannedQty 有值 → 使用 plannedQty (L101 中间 || 分支)', () => {
    var h = {
      escapeHtml: (s) => String(s),
      formatNumber: (n) => String(n),
      generateBarcodeUrl: (code, type) => '/barcode/' + code + '/' + type,
    };
    var line = { lineNum: 1, itemCode: 'PI-005', itemName: 'X', baseQty: 0, plannedQty: 25, whsCode: 'WH01' };
    var result = buildPiLineRowHtml(line, {}, { headerClosed: false }, h);
    expect(result.html).toContain('25');
  });
});

// ============================================================================
// buildPiHistoryRowsHtml — 分支覆盖补充
// ============================================================================

describe('buildPiHistoryRowsHtml — 分支覆盖补充', () => {
  test('item_name 为 null → 显示 -', () => {
    var h = {
      escapeHtml: (s) => String(s),
      formatNumber: (n) => String(n),
      formatDateTime: (d) => d || '-',
    };
    var txns = [{ transaction_time: '2026-01-01', item_code: 'A', item_name: null, quantity: 5, performed_by: 'user', remarks: null }];
    var html = buildPiHistoryRowsHtml(txns, h);
    expect(html).toContain('>-<');
  });
});
