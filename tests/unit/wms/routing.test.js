/**
 * shared.js 跨页面路由测试
 * 覆盖: handleSubpageBarcode (子页面条码智能路由)
 *
 * 重点突破:
 * - window.location 在 jsdom/Jest 中不可直接赋值，使用 delete + 重建 hack
 * - 条码前缀匹配 → 剥离前缀调用 loadFn
 * - 不匹配前缀 → 第一次警告、第二次跳转 (双击确认模式)
 * - 旧格式带连字符 → 提示新格式
 * - 物料代码 (含-号或长字符串) → 调用 filterFn
 */
const { loadSharedJs } = require('./setup');

beforeAll(() => {
  loadSharedJs();
});

let lastHref = null;
let loadFn, filterFn;

beforeEach(() => {
  lastHref = null;
  // 标准 hack: 替换 window.location 以捕获 href 赋值
  delete window.location;
  window.location = {
    _href: '',
    get href() { return this._href; },
    set href(v) { lastHref = v; this._href = v; },
    search: '',
    pathname: '',
    assign: jest.fn(),
  };
  loadFn = jest.fn();
  filterFn = jest.fn();
  // 重置 _mismatchBarcode 状态: 此变量在 sandbox 闭包内，
  // 通过扫一个当前前缀码触发 _mismatchBarcode = null 代码路径
  var dummyLoad = jest.fn();
  handleSubpageBarcode('PO00001', 'PO', dummyLoad);
  // 关闭音效避免干扰
  CONFIG.soundEnabled = false;
});

// ============================================================================
// 当前前缀匹配 — 剥离前缀加载
// ============================================================================

describe('handleSubpageBarcode - 当前前缀匹配', () => {
  test.each([
    ['PO', 'PO26000178', '26000178'],
    ['WO', 'WO25001026', '25001026'],
    ['SO', 'SO26000050', '26000050'],
    ['TR', 'TR26000001', '26000001'],
    ['PI', 'PI25001026', '25001026'],
    ['IC', 'IC20260208', '20260208'],
    ['LM', 'LM20260208', '20260208'],
  ])('当前页 %s, 扫 "%s" → loadFn(%s)', (prefix, barcode, expected) => {
    handleSubpageBarcode(barcode, prefix, loadFn, filterFn);
    expect(loadFn).toHaveBeenCalledWith(expected);
    expect(lastHref).toBeNull();
  });

  test('大小写不敏感: 当前页 PO, 扫 "po26000178"', () => {
    handleSubpageBarcode('po26000178', 'PO', loadFn, filterFn);
    expect(loadFn).toHaveBeenCalledWith('26000178');
  });
});

// ============================================================================
// 不匹配前缀 — 第一次警告 + 第二次跳转 (双击确认模式)
// ============================================================================

describe('handleSubpageBarcode - 不匹配前缀 (双击确认)', () => {
  test('当前页 PO, 第一次扫 WO25001026 → 警告不跳转', () => {
    handleSubpageBarcode('WO25001026', 'PO', loadFn, filterFn);
    expect(loadFn).not.toHaveBeenCalled();
    expect(lastHref).toBeNull();
  });

  test('当前页 PO, 连续两次扫同一 WO25001026 → 第二次跳转', () => {
    handleSubpageBarcode('WO25001026', 'PO', loadFn, filterFn);
    expect(lastHref).toBeNull();

    // 第二次 — 确认跳转
    handleSubpageBarcode('WO25001026', 'PO', loadFn, filterFn);
    expect(lastHref).toBe('wo.html?docnum=25001026');
  });

  test('当前页 SO, 扫 TR26000001 两次 → 第二次跳转', () => {
    handleSubpageBarcode('TR26000001', 'SO', loadFn, filterFn);
    handleSubpageBarcode('TR26000001', 'SO', loadFn, filterFn);
    expect(lastHref).toBe('tr.html?docnum=26000001');
  });

  test('扫不同不匹配条码 → 每次都只是警告，不跳转', () => {
    handleSubpageBarcode('WO25001026', 'PO', loadFn, filterFn);
    expect(lastHref).toBeNull();
    handleSubpageBarcode('SO26000050', 'PO', loadFn, filterFn);
    expect(lastHref).toBeNull(); // 换了条码，重新计数
  });
});

// ============================================================================
// 旧格式 (带连字符) — 警告用户使用新格式
// ============================================================================

describe('handleSubpageBarcode - 旧格式拒绝', () => {
  test.each([
    'WO-25001026', 'SO-26000050', 'PO-26000178',
    'TR-001', 'PI-001', 'IC-001', 'LM-001',
  ])('扫 "%s" → 提示旧格式，不跳转', (barcode) => {
    handleSubpageBarcode(barcode, 'PO', loadFn, filterFn);
    expect(loadFn).not.toHaveBeenCalled();
    expect(lastHref).toBeNull();
  });
});

// ============================================================================
// 物料代码 (含-号或长字符串) → 调用 filterFn
// ============================================================================

describe('handleSubpageBarcode - 物料代码路由', () => {
  test('含连字符 "A-001-B" → 调用 filterFn', () => {
    handleSubpageBarcode('A-001-B', 'PO', loadFn, filterFn);
    expect(filterFn).toHaveBeenCalledWith('A-001-B');
    expect(loadFn).not.toHaveBeenCalled();
  });

  test('长字符串 "ITEM00001" (>8字符) → 调用 filterFn', () => {
    handleSubpageBarcode('ITEM00001', 'PO', loadFn, filterFn);
    expect(filterFn).toHaveBeenCalledWith('ITEM00001');
  });

  test('无 filterFn 时物料代码 → 显示警告消息', () => {
    handleSubpageBarcode('A-001-B', 'PO', loadFn);
    expect(loadFn).not.toHaveBeenCalled();
    // 没有 filterFn，应显示 "不支持物料过滤" 的消息
    var toast = document.querySelector('.message-toast');
    expect(toast).not.toBeNull();
  });
});

// ============================================================================
// 纯数字/短字符串 → 当前页面加载单据号
// ============================================================================

describe('handleSubpageBarcode - 纯数字/短字符串', () => {
  test('纯数字 "26000178" → 调用 loadFn (非前缀匹配，作为单据号)', () => {
    handleSubpageBarcode('26000178', 'PO', loadFn, filterFn);
    expect(loadFn).toHaveBeenCalledWith('26000178');
  });

  test('短字符串 "ABC" (≤8且无-号) → 调用 loadFn', () => {
    handleSubpageBarcode('ABC', 'PO', loadFn, filterFn);
    expect(loadFn).toHaveBeenCalledWith('ABC');
  });
});
