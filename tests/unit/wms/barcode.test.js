/**
 * shared.js 条码路由函数测试
 * 覆盖: routeBarcode (门户页扫码路由逻辑)
 */
const { loadSharedJs } = require('./setup');

beforeAll(() => {
  loadSharedJs();
});

// 捕获 window.location.href 赋值 (jsdom 中不会真跳转)
let lastHref = null;
beforeEach(() => {
  lastHref = null;
  delete window.location;
  window.location = { set href(v) { lastHref = v; }, get href() { return lastHref || ''; } };
});

// ============================================================================
// routeBarcode — 前缀直连数字 (新格式)
// ============================================================================

describe('routeBarcode - 新格式前缀路由', () => {
  test.each([
    ['PO26000178', 'po.html?docnum=26000178'],
    ['WO25001026', 'wo.html?docnum=25001026'],
    ['SO26000050', 'so.html?docnum=26000050'],
    ['TR26000001', 'tr.html?docnum=26000001'],
    ['PI25001026', 'pi.html?docnum=25001026'],
    ['IC20260208', 'ic.html?id=20260208'],
    ['LM20260208', 'lm.html?id=20260208'],
  ])('"%s" → 跳转到 %s', (barcode, expected) => {
    var result = routeBarcode(barcode);
    expect(result).toBe(true);
    expect(lastHref).toBe(expected);
  });

  test('前缀大小写不敏感 — po26000178 同样识别', () => {
    var result = routeBarcode('po26000178');
    expect(result).toBe(true);
    // 注意: substring 取的是原始 barcode，所以数字部分保持原样
    expect(lastHref).toBe('po.html?docnum=26000178');
  });
});

// ============================================================================
// routeBarcode — 旧格式 (带连字符) 应拒绝
// ============================================================================

describe('routeBarcode - 旧格式拒绝', () => {
  test.each([
    'PO-26000178', 'WO-25001026', 'SO-26000050',
    'TR-001', 'PI-001', 'IC-001', 'LM-001',
  ])('旧格式 "%s" → 返回 false (警告用户)', (barcode) => {
    var result = routeBarcode(barcode);
    expect(result).toBe(false);
    expect(lastHref).toBeNull(); // 不跳转
  });
});

// ============================================================================
// routeBarcode — 纯数字
// ============================================================================

describe('routeBarcode - 纯数字', () => {
  test('纯数字 "26000178" → 返回 false (提示加前缀)', () => {
    var result = routeBarcode('26000178');
    expect(result).toBe(false);
    expect(lastHref).toBeNull();
  });
});

// ============================================================================
// routeBarcode — 物料代码 (含连字符或长字符串)
// ============================================================================

describe('routeBarcode - 物料代码识别', () => {
  test('含连字符 "A-001-B" → 跳转库存查询', () => {
    var result = routeBarcode('A-001-B');
    expect(result).toBe(true);
    expect(lastHref).toBe('stock.html?item=A-001-B');
  });

  test('长字符串 "ITEM00001" (>8字符) → 跳转库存查询', () => {
    var result = routeBarcode('ITEM00001');
    expect(result).toBe(true);
    expect(lastHref).toBe('stock.html?item=ITEM00001');
  });
});

// ============================================================================
// routeBarcode — 无法识别
// ============================================================================

describe('routeBarcode - 无法识别', () => {
  test('短字符串 "ABC" → 返回 false', () => {
    var result = routeBarcode('ABC');
    expect(result).toBe(false);
    expect(lastHref).toBeNull();
  });
});
