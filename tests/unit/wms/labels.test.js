/**
 * shared.js 标签映射 + URL 工具函数测试
 * 覆盖: getDocTypeLabel, getStatusLabel, getUrlParam, getDocTypeIcon, renderHeaderStatus
 */
const { loadSharedJs } = require('./setup');

beforeAll(() => {
  loadSharedJs();
});

// ============================================================================
// getDocTypeLabel — 单据类型中文标签 (7 种)
// ============================================================================

describe('getDocTypeLabel', () => {
  test('7 种标准单据类型返回中文标签', () => {
    expect(getDocTypeLabel('SO')).toBe('销售订单');
    expect(getDocTypeLabel('WO')).toBe('生产订单');
    expect(getDocTypeLabel('PO')).toBe('采购订单');
    expect(getDocTypeLabel('TR')).toBe('调拨申请');
    expect(getDocTypeLabel('IC')).toBe('库存盘点');
    expect(getDocTypeLabel('LM')).toBe('库位移动');
    expect(getDocTypeLabel('PI')).toBe('生产发货');
  });

  test('未知类型返回原始值', () => {
    expect(getDocTypeLabel('XX')).toBe('XX');
    expect(getDocTypeLabel('UNKNOWN')).toBe('UNKNOWN');
  });

  test('空值/undefined 返回原始值', () => {
    expect(getDocTypeLabel('')).toBe('');
    expect(getDocTypeLabel(undefined)).toBe(undefined);
    expect(getDocTypeLabel(null)).toBe(null);
  });
});

// ============================================================================
// getStatusLabel — 单据状态中文标签 (6 种)
// ============================================================================

describe('getStatusLabel', () => {
  test('6 种标准状态返回中文标签', () => {
    expect(getStatusLabel('pending')).toBe('待处理');
    expect(getStatusLabel('draft')).toBe('草稿');
    expect(getStatusLabel('in_progress')).toBe('执行中');
    expect(getStatusLabel('completed')).toBe('已完成');
    expect(getStatusLabel('cancelled')).toBe('已取消');
    expect(getStatusLabel('exported')).toBe('已导出');
  });

  test('未知状态返回原始值', () => {
    expect(getStatusLabel('unknown')).toBe('unknown');
    expect(getStatusLabel('closed')).toBe('closed');
  });

  test('空值/undefined 返回原始值', () => {
    expect(getStatusLabel('')).toBe('');
    expect(getStatusLabel(undefined)).toBe(undefined);
  });
});

// ============================================================================
// getDocTypeIcon — 单据类型 SVG 图标
// ============================================================================

describe('getDocTypeIcon', () => {
  test('已知类型返回包含 SVG 的 img 标签', () => {
    var icon = getDocTypeIcon('PO');
    expect(icon).toContain('<img src="data:image/svg+xml,');
    expect(icon).toContain('alt="PO"');
  });

  test('默认尺寸为 40', () => {
    var icon = getDocTypeIcon('SO');
    expect(icon).toContain('width="40"');
    expect(icon).toContain('height="40"');
  });

  test('自定义尺寸', () => {
    var icon = getDocTypeIcon('WO', 24);
    expect(icon).toContain('width="24"');
    expect(icon).toContain('height="24"');
  });

  test('未知类型回退到 IC 图标', () => {
    var knownIcon = getDocTypeIcon('IC');
    var unknownIcon = getDocTypeIcon('UNKNOWN');
    // 回退到 IC 图标，但 alt 不同
    expect(unknownIcon).toContain('alt="UNKNOWN"');
    // 两者使用相同的 SVG 内容 (IC 图标)
    var extractSvg = (html) => html.match(/src="([^"]+)"/)[1];
    expect(extractSvg(unknownIcon)).toBe(extractSvg(knownIcon));
  });

  test('所有 7 种类型都有图标', () => {
    var types = ['SO', 'WO', 'PO', 'TR', 'IC', 'LM', 'PI'];
    types.forEach((type) => {
      var icon = getDocTypeIcon(type);
      expect(icon).toContain('alt="' + type + '"');
      expect(icon).toContain('data:image/svg+xml,');
    });
  });
});

// ============================================================================
// renderHeaderStatus — SAP/WMS 双状态渲染
// ============================================================================

describe('renderHeaderStatus', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('SAP 状态 "O" (未清) 显示 "未清" 且无红色', () => {
    document.body.innerHTML = '<span id="sap"></span>';
    renderHeaderStatus('O', null, 'sap', null);
    var el = document.getElementById('sap');
    expect(el.textContent).toContain('未清');
    expect(el.style.color).not.toBe('rgb(231, 76, 60)');
  });

  test('SAP 状态 "C" (已关闭) 显示红色', () => {
    document.body.innerHTML = '<span id="sap"></span>';
    renderHeaderStatus('C', null, 'sap', null);
    var el = document.getElementById('sap');
    expect(el.textContent).toContain('已关闭');
    // jsdom 将 hex 转为 rgb 格式
    expect(el.style.color).toBe('rgb(231, 76, 60)');
  });

  test('SAP 状态 "R" (已下达) 显示 "已下达" 且无红色', () => {
    document.body.innerHTML = '<span id="sap"></span>';
    renderHeaderStatus('R', null, 'sap', null);
    var el = document.getElementById('sap');
    expect(el.textContent).toContain('已下达');
    expect(el.style.color).not.toBe('rgb(231, 76, 60)');
  });

  test('SAP 状态 "P" (已计划) 显示 "已计划" 且无红色', () => {
    document.body.innerHTML = '<span id="sap"></span>';
    renderHeaderStatus('P', null, 'sap', null);
    var el = document.getElementById('sap');
    expect(el.textContent).toContain('已计划');
    expect(el.style.color).not.toBe('rgb(231, 76, 60)');
  });

  test('未知 SAP 状态显示原始值', () => {
    document.body.innerHTML = '<span id="sap"></span>';
    renderHeaderStatus('X', null, 'sap', null);
    var el = document.getElementById('sap');
    expect(el.textContent).toContain('X');
  });

  test('SAP + WMS 独立元素: WMS completed 显示绿色', () => {
    document.body.innerHTML = '<span id="sap"></span><span id="wms"></span>';
    renderHeaderStatus('O', 'completed', 'sap', 'wms');
    var wmsEl = document.getElementById('wms');
    expect(wmsEl.textContent).toBe('已完成');
    expect(wmsEl.style.color).toBe('rgb(22, 163, 74)');
  });

  test('SAP + WMS 独立元素: WMS in_progress 显示蓝色', () => {
    document.body.innerHTML = '<span id="sap"></span><span id="wms"></span>';
    renderHeaderStatus('O', 'in_progress', 'sap', 'wms');
    var wmsEl = document.getElementById('wms');
    expect(wmsEl.textContent).toBe('执行中');
    expect(wmsEl.style.color).toBe('rgb(37, 99, 235)');
  });

  test('SAP + WMS 独立元素: WMS exported 显示紫色', () => {
    document.body.innerHTML = '<span id="sap"></span><span id="wms"></span>';
    renderHeaderStatus('O', 'exported', 'sap', 'wms');
    var wmsEl = document.getElementById('wms');
    expect(wmsEl.textContent).toBe('已导出');
    expect(wmsEl.style.color).toBe('rgb(147, 51, 234)');
  });

  test('无独立 WMS 元素: WMS 状态附加在 SAP 元素后', () => {
    document.body.innerHTML = '<span id="sap"></span>';
    renderHeaderStatus('O', 'in_progress', 'sap', null);
    var el = document.getElementById('sap');
    // SAP 标签 + WMS 状态用 span 括号附加
    expect(el.textContent).toContain('未清');
    expect(el.textContent).toContain('(执行中)');
    // WMS 附加 span 存在
    var spans = el.querySelectorAll('span');
    expect(spans.length).toBe(1);
  });

  test('SAP 元素不存在 → 不报错', () => {
    document.body.innerHTML = '';
    expect(() => renderHeaderStatus('O', 'pending', 'nonexistent', null)).not.toThrow();
  });
});

// ============================================================================
// getUrlParam — URL 参数提取
// ============================================================================

describe('getUrlParam', () => {
  var originalLocation;

  beforeEach(() => {
    // 保存原始 location
    originalLocation = window.location;
  });

  afterEach(() => {
    // 恢复原始 location
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
  });

  test('提取存在的参数', () => {
    delete window.location;
    window.location = new URL('http://localhost/wms/so.html?doc=SO-20260225-001');
    expect(getUrlParam('doc')).toBe('SO-20260225-001');
  });

  test('参数不存在返回 null', () => {
    delete window.location;
    window.location = new URL('http://localhost/wms/so.html?doc=SO-001');
    expect(getUrlParam('notexist')).toBeNull();
  });

  test('无查询参数返回 null', () => {
    delete window.location;
    window.location = new URL('http://localhost/wms/so.html');
    expect(getUrlParam('doc')).toBeNull();
  });

  test('多个参数提取正确', () => {
    delete window.location;
    window.location = new URL('http://localhost/wms/stock.html?item=A001&whs=WH01');
    expect(getUrlParam('item')).toBe('A001');
    expect(getUrlParam('whs')).toBe('WH01');
  });

  test('URL 编码参数正确解码', () => {
    delete window.location;
    window.location = new URL('http://localhost/wms/so.html?name=%E6%B5%8B%E8%AF%95');
    expect(getUrlParam('name')).toBe('测试');
  });
});
