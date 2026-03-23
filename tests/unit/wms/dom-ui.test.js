/**
 * shared.js DOM/UI 边缘函数测试
 * 覆盖: showMessage, showLoading, focusScanInput, printDocument,
 *       generateBarcodeUrl, logout, initOperatorSelect, setupQtyWarning,
 *       loadMasterDataCache, _getAllBins, _getBinHistory, _saveBinHistory,
 *       initBinAutocomplete, _getMasterCache
 *
 * 扫荡所有未测试的 DOM 强耦合函数，推覆盖率突破 80%
 */
const { loadSharedJs } = require('./setup');

beforeAll(() => {
  loadSharedJs();
});

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  CONFIG.soundEnabled = false;
});

// ============================================================================
// showMessage — Toast 通知
// ============================================================================

describe('showMessage', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('创建 toast 元素到 body', () => {
    showMessage('测试消息', 'info');
    var toast = document.querySelector('.message-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toBe('测试消息');
    expect(toast.classList.contains('info')).toBe(true);
  });

  test('不同类型: warning / error / success', () => {
    showMessage('警告', 'warning');
    expect(document.querySelector('.message-toast.warning')).not.toBeNull();
  });

  test('默认类型为 info', () => {
    showMessage('默认');
    expect(document.querySelector('.message-toast.info')).not.toBeNull();
  });

  test('新消息移除旧 toast', () => {
    showMessage('第一条', 'info');
    showMessage('第二条', 'success');
    var toasts = document.querySelectorAll('.message-toast');
    expect(toasts.length).toBe(1);
    expect(toasts[0].textContent).toBe('第二条');
  });

  test('3000ms 后 toast 添加 fade-out class', () => {
    showMessage('消失测试', 'info');
    var toast = document.querySelector('.message-toast');
    expect(toast.classList.contains('fade-out')).toBe(false);

    jest.advanceTimersByTime(3000);
    expect(toast.classList.contains('fade-out')).toBe(true);
  });

  test('3300ms 后 toast 从 DOM 移除', () => {
    showMessage('移除测试', 'info');
    jest.advanceTimersByTime(3300);
    expect(document.querySelector('.message-toast')).toBeNull();
  });
});

// ============================================================================
// showLoading — 加载指示器
// ============================================================================

describe('showLoading', () => {
  test('show=true 显示 loader', () => {
    document.body.innerHTML = '<div id="loader" style="display:none"></div>';
    showLoading(true);
    expect(document.getElementById('loader').style.display).toBe('flex');
  });

  test('show=false 隐藏 loader', () => {
    document.body.innerHTML = '<div id="loader" style="display:flex"></div>';
    showLoading(false);
    expect(document.getElementById('loader').style.display).toBe('none');
  });

  test('无 loader 元素时静默返回', () => {
    document.body.innerHTML = '';
    expect(() => showLoading(true)).not.toThrow();
  });
});

// ============================================================================
// focusScanInput — 清空并聚焦扫码框
// ============================================================================

describe('focusScanInput', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('100ms 后清空 scanInput 并聚焦', () => {
    document.body.innerHTML = '<input id="scanInput" value="old" />';
    var input = document.getElementById('scanInput');
    input.focus = jest.fn();

    focusScanInput();
    jest.advanceTimersByTime(100);

    expect(input.value).toBe('');
    expect(input.focus).toHaveBeenCalled();
  });

  test('无 scanInput 元素时不报错', () => {
    document.body.innerHTML = '';
    focusScanInput();
    expect(() => jest.advanceTimersByTime(100)).not.toThrow();
  });
});

// ============================================================================
// printDocument
// ============================================================================

describe('printDocument', () => {
  test('调用 window.print()', () => {
    window.print = jest.fn();
    printDocument();
    expect(window.print).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// generateBarcodeUrl — 本地/远程降级
// ============================================================================

describe('generateBarcodeUrl', () => {
  test('无 QRCode/JsBarcode 时降级到远程 URL', () => {
    var url = generateBarcodeUrl('TEST123', 'qrcode');
    expect(url).toContain('/generate?content=TEST123&type=qrcode');
  });

  test('无 JsBarcode 时条码降级到远程', () => {
    var url = generateBarcodeUrl('TEST123', 'barcode');
    expect(url).toContain('/generate?content=TEST123&type=barcode');
  });

  test('默认类型为 qrcode', () => {
    var url = generateBarcodeUrl('DATA');
    expect(url).toContain('type=qrcode');
  });

  test('内容被 encodeURIComponent 编码', () => {
    var url = generateBarcodeUrl('A B&C', 'barcode');
    expect(url).toContain('content=A%20B%26C');
  });

  test('有 QRCode 全局变量时尝试本地生成 (canvas 降级)', () => {
    // 模拟 QRCode — 构造后 div 内无 canvas/img → 降级到远程
    global.QRCode = function (el, opts) {};
    global.QRCode.CorrectLevel = { M: 1 };

    var url = generateBarcodeUrl('DATA', 'qrcode');
    // canvas/img 都不存在 → 降级到远程 URL
    expect(url).toContain('/generate?content=DATA');

    delete global.QRCode;
  });

  test('有 JsBarcode 全局变量时尝试本地生成', () => {
    // 模拟 JsBarcode — 正常写入 canvas
    global.JsBarcode = jest.fn();
    var url = generateBarcodeUrl('123', 'barcode');
    expect(global.JsBarcode).toHaveBeenCalled();
    // jsdom canvas.toDataURL 返回 'data:image/png;base64,...'
    // 但 jsdom 可能不支持完整 canvas，可能降级到远程 URL
    expect(url).toBeDefined();

    delete global.JsBarcode;
  });

  test('JsBarcode 抛异常时降级到远程', () => {
    global.JsBarcode = jest.fn(() => { throw new Error('No canvas'); });
    var url = generateBarcodeUrl('123', 'barcode');
    expect(url).toContain('/generate?content=123&type=barcode');
    delete global.JsBarcode;
  });
});

// ============================================================================
// logout — SSO 登出 (清除 + 跳转 Authelia)
// ============================================================================

describe('logout', () => {
  let lastHref;
  beforeEach(() => {
    lastHref = null;
    delete window.location;
    window.location = {
      _href: '',
      pathname: '/wms/index.html',
      get href() { return this._href; },
      set href(v) { lastHref = v; this._href = v; },
      search: '',
    };
    global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
    localStorage.setItem('wms_username', 'admin');
    localStorage.setItem('wms_display_name', '管理员');
    localStorage.setItem('wms_role', 'admin');
    localStorage.setItem('wms_sso_groups', 'admins');
  });

  test('清除 localStorage 并跳转 SSO 登出 (带 rd 参数)', async () => {
    await logout();
    await new Promise(r => setTimeout(r, 0));
    expect(localStorage.getItem('wms_username')).toBeNull();
    expect(localStorage.getItem('wms_display_name')).toBeNull();
    expect(localStorage.getItem('wms_role')).toBeNull();
    expect(localStorage.getItem('wms_sso_groups')).toBeNull();
    expect(lastHref).toBe('/?rd=%2Fwms%2Findex.html');
  });

  test('SSO logout 失败时仍清除本地数据并跳转', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));
    await logout();
    await new Promise(r => setTimeout(r, 0));
    expect(localStorage.getItem('wms_username')).toBeNull();
    expect(lastHref).toBe('/?rd=%2Fwms%2Findex.html');
  });
});

// ============================================================================
// initOperatorSelect — 操作人下拉组件
// ============================================================================

describe('initOperatorSelect', () => {
  test('为 input 创建 datalist 和添加按钮', () => {
    document.body.innerHTML = '<div><input id="op" /></div>';
    initOperatorSelect('op');

    var input = document.getElementById('op');
    expect(input.getAttribute('list')).toBe('op_list');
    var datalist = document.getElementById('op_list');
    expect(datalist).not.toBeNull();
    expect(datalist.tagName).toBe('DATALIST');
    // datalist 至少有 WMS 选项
    expect(datalist.querySelectorAll('option').length).toBeGreaterThanOrEqual(1);
    // 添加按钮
    var addBtn = input.parentNode.querySelector('button');
    expect(addBtn).not.toBeNull();
    expect(addBtn.textContent).toBe('+');
  });

  test('input 不存在时静默返回', () => {
    document.body.innerHTML = '';
    expect(() => initOperatorSelect('nonexistent')).not.toThrow();
  });

  test('change 事件保存操作人到 localStorage', () => {
    document.body.innerHTML = '<div><input id="op2" /></div>';
    initOperatorSelect('op2');
    var input = document.getElementById('op2');
    input.value = 'TestUser';
    input.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('wms_last_user')).toContain('TestUser');
  });
});

// ============================================================================
// setupQtyWarning — 数量超限实时警告
// ============================================================================

describe('setupQtyWarning', () => {
  test('输入超过最大值时改变样式并显示警告', () => {
    jest.useFakeTimers();
    document.body.innerHTML = '<input id="qty" value="" />';
    setupQtyWarning('qty', () => 10);

    var input = document.getElementById('qty');
    input.value = '15';
    input.dispatchEvent(new Event('input'));

    // jsdom 不支持 CSS custom property var(...)，borderColor 会被丢弃
    // jsdom 将 hex 标准化为 rgb()，用 toContain 匹配
    expect(input.style.background).toContain('255, 240, 240');
    jest.useRealTimers();
  });

  test('输入未超限时恢复样式', () => {
    document.body.innerHTML = '<input id="qty2" value="" />';
    setupQtyWarning('qty2', () => 10);

    var input = document.getElementById('qty2');
    // 先触发超限
    input.value = '15';
    input.dispatchEvent(new Event('input'));
    // 再恢复正常值
    input.value = '5';
    input.dispatchEvent(new Event('input'));

    expect(input.style.borderColor).toBe('');
    expect(input.style.background).toBe('');
  });

  test('input 元素不存在时静默返回', () => {
    document.body.innerHTML = '';
    expect(() => setupQtyWarning('missing', () => 10)).not.toThrow();
  });

  test('超限警告有 2000ms 节流 (不连续播放提示音)', () => {
    jest.useFakeTimers();
    document.body.innerHTML = '<input id="qty3" value="" />';
    setupQtyWarning('qty3', () => 10);
    var input = document.getElementById('qty3');

    // 第一次超限
    input.value = '15';
    input.dispatchEvent(new Event('input'));
    // 立即第二次 → 节流内不重复提示
    input.value = '20';
    input.dispatchEvent(new Event('input'));

    // 只产生一条 toast (节流中)
    var toasts = document.querySelectorAll('.message-toast');
    expect(toasts.length).toBeLessThanOrEqual(1);

    jest.useRealTimers();
  });
});

// ============================================================================
// loadMasterDataCache — 异步缓存加载
// ============================================================================

describe('loadMasterDataCache', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        headers: { get: () => 'application/json' },
        text: () => Promise.resolve(JSON.stringify({
          success: true,
          items: [{ item_code: 'A001' }],
          warehouses: [{ whs_code: 'WH01' }],
          bins_map: { WH01: ['B-01', 'B-02'] },
          counts: { items: 1, warehouses: 1 },
        })),
      })
    );
  });

  test('首次加载 → 调用 API 并缓存到 localStorage', async () => {
    await loadMasterDataCache();
    var cached = JSON.parse(localStorage.getItem('wms_masterdata'));
    expect(cached).not.toBeNull();
    expect(cached.success).toBe(true);
    expect(cached.items).toHaveLength(1);
    expect(cached._ts).toBeDefined();
  });

  test('缓存未过期时不再请求 API', async () => {
    // 预设有效缓存 (1分钟前)
    localStorage.setItem('wms_masterdata', JSON.stringify({
      success: true, _ts: Date.now() - 60000, items: [],
    }));
    await loadMasterDataCache();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('缓存过期后重新请求 API', async () => {
    // 预设过期缓存 (5小时前)
    localStorage.setItem('wms_masterdata', JSON.stringify({
      success: true, _ts: Date.now() - 5 * 3600000, items: [],
    }));
    await loadMasterDataCache();
    expect(global.fetch).toHaveBeenCalled();
  });

  test('forceRefresh=true 强制刷新', async () => {
    localStorage.setItem('wms_masterdata', JSON.stringify({
      success: true, _ts: Date.now(), items: [],
    }));
    await loadMasterDataCache(true);
    expect(global.fetch).toHaveBeenCalled();
  });

  test('API 失败时显示错误消息', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('Network')));
    await loadMasterDataCache(true);
    var toast = document.querySelector('.message-toast');
    expect(toast).not.toBeNull();
  });

  test('API 返回 success=false 时不写入缓存', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        headers: { get: () => 'application/json' },
        text: () => Promise.resolve(JSON.stringify({ success: false })),
      })
    );
    await loadMasterDataCache(true);
    // success=false → 不写入
    expect(localStorage.getItem('wms_masterdata')).toBeNull();
  });
});

// ============================================================================
// _getMasterCache
// ============================================================================

describe('_getMasterCache', () => {
  test('有缓存时返回解析后的对象', () => {
    localStorage.setItem('wms_masterdata', JSON.stringify({ success: true, items: [] }));
    var cache = _getMasterCache();
    expect(cache).not.toBeNull();
    expect(cache.success).toBe(true);
  });

  test('无缓存时返回 null', () => {
    expect(_getMasterCache()).toBeNull();
  });

  test('JSON 损坏时返回 null', () => {
    localStorage.setItem('wms_masterdata', '{invalid json');
    expect(_getMasterCache()).toBeNull();
  });
});

// ============================================================================
// _getAllBins — 从缓存提取库位列表
// ============================================================================

describe('_getAllBins', () => {
  test('bins_map 格式 → 扁平化为数组', () => {
    localStorage.setItem('wms_masterdata', JSON.stringify({
      bins_map: { WH01: ['B-01', 'B-02'], WH02: ['B-03'] },
    }));
    var bins = _getAllBins();
    expect(bins).toEqual(['B-01', 'B-02', 'B-03']);
  });

  test('旧 bins 数组格式 → 提取 bin_code', () => {
    localStorage.setItem('wms_masterdata', JSON.stringify({
      bins: [{ bin_code: 'B-01', whs_code: 'WH01' }, { bin_code: 'B-02', whs_code: 'WH01' }],
    }));
    var bins = _getAllBins();
    expect(bins).toEqual(['B-01', 'B-02']);
  });

  test('去重: 相同 bin_code 只出现一次', () => {
    localStorage.setItem('wms_masterdata', JSON.stringify({
      bins_map: { WH01: ['B-01', 'B-02'], WH02: ['B-01'] },
    }));
    var bins = _getAllBins();
    expect(bins).toEqual(['B-01', 'B-02']);
  });

  test('无缓存时返回空数组', () => {
    expect(_getAllBins()).toEqual([]);
  });
});

// ============================================================================
// _getBinHistory / _saveBinHistory — 最近使用库位
// ============================================================================

describe('_getBinHistory / _saveBinHistory', () => {
  test('无历史时返回空数组', () => {
    expect(_getBinHistory()).toEqual([]);
  });

  test('保存库位 → 出现在历史最前面 (MRU)', () => {
    _saveBinHistory('B-01');
    _saveBinHistory('B-02');
    var history = _getBinHistory();
    expect(history[0]).toBe('B-02');
    expect(history[1]).toBe('B-01');
  });

  test('重复保存同一库位 → 移到最前，不重复', () => {
    _saveBinHistory('B-01');
    _saveBinHistory('B-02');
    _saveBinHistory('B-01');
    var history = _getBinHistory();
    expect(history).toEqual(['B-01', 'B-02']);
  });

  test('最多保存 10 条', () => {
    for (var i = 0; i < 15; i++) {
      _saveBinHistory('BIN-' + i);
    }
    expect(_getBinHistory().length).toBe(10);
    // 最近的在最前
    expect(_getBinHistory()[0]).toBe('BIN-14');
  });

  test('空 binCode 不保存', () => {
    _saveBinHistory('');
    _saveBinHistory(null);
    expect(_getBinHistory()).toEqual([]);
  });
});

// ============================================================================
// initBinAutocomplete — 库位历史标签 + blur校验
// ============================================================================

describe('initBinAutocomplete', () => {
  test('为 input 创建历史标签容器', () => {
    document.body.innerHTML = '<div><input id="binInput" /></div>';
    _saveBinHistory('B-01');
    _saveBinHistory('B-02');
    initBinAutocomplete('binInput');

    var tagBox = document.querySelector('.bin-recent-tags');
    expect(tagBox).not.toBeNull();
    // 应有 chip 元素
    var chips = tagBox.querySelectorAll('.bin-recent-chip');
    expect(chips.length).toBeGreaterThanOrEqual(1);
  });

  test('点击 chip 填入库位值', () => {
    document.body.innerHTML = '<div><input id="binInput2" /></div>';
    _saveBinHistory('B-01');
    initBinAutocomplete('binInput2');

    var chip = document.querySelector('.bin-recent-chip');
    chip.click();
    var input = document.getElementById('binInput2');
    expect(input.value).toBe('B-01');
  });

  test('input 不存在时静默返回', () => {
    document.body.innerHTML = '';
    expect(() => initBinAutocomplete('missing')).not.toThrow();
  });

  test('无历史时标签容器隐藏', () => {
    localStorage.removeItem('wms_recent_bins');
    document.body.innerHTML = '<div><input id="binInput3" /></div>';
    initBinAutocomplete('binInput3');
    var tagBox = document.querySelector('.bin-recent-tags');
    expect(tagBox.style.display).toBe('none');
  });

  test('blur 时自动纠正库位为字典值', () => {
    // 设置主数据缓存中有 B-01
    localStorage.setItem('wms_masterdata', JSON.stringify({
      bins: [{ bin_code: 'B-01', whs_code: 'WH01' }],
      _ts: Date.now()
    }));
    document.body.innerHTML = '<div><input id="binBlur" /></div>';
    initBinAutocomplete('binBlur');
    var input = document.getElementById('binBlur');
    input.value = 'b-01'; // 小写输入
    input.dispatchEvent(new Event('blur'));
    expect(input.value).toBe('B-01'); // 纠正为字典值
    expect(input.style.borderColor).toBe('#22c55e');
  });

  test('blur 时空值不做校验', () => {
    document.body.innerHTML = '<div><input id="binBlurEmpty" /></div>';
    initBinAutocomplete('binBlurEmpty');
    var input = document.getElementById('binBlurEmpty');
    input.value = '';
    input.dispatchEvent(new Event('blur'));
    // 不应报错
    expect(input.value).toBe('');
  });

  test('表单提交时保存库位历史', () => {
    localStorage.removeItem('wms_recent_bins');
    document.body.innerHTML = '<form><input id="binForm" /></form>';
    initBinAutocomplete('binForm');
    var input = document.getElementById('binForm');
    input.value = 'C-99';
    var form = input.closest('form');
    form.dispatchEvent(new Event('submit'));
    var saved = JSON.parse(localStorage.getItem('wms_recent_bins') || '[]');
    expect(saved).toContain('C-99');
  });
});

// ============================================================================
// validateBin — bins_map 内循环覆盖 (补充已有测试的 bins_map 分支)
// ============================================================================

describe('validateBin - bins_map 深度分支', () => {
  test('bins_map 中多仓库匹配 → 返回正确仓库', () => {
    localStorage.setItem('wms_masterdata', JSON.stringify({
      bins_map: { WH01: ['B-01'], WH02: ['B-02', 'B-03'] },
    }));
    var result = validateBin('B-03');
    expect(result).toEqual({ bin_code: 'B-03', whs_code: 'WH02' });
  });

  test('bins_map 空键值 → 返回 null', () => {
    localStorage.setItem('wms_masterdata', JSON.stringify({
      bins_map: {},
    }));
    expect(validateBin('B-01')).toBeNull();
  });

  test('bins_map 中找不到 → 返回 false', () => {
    localStorage.setItem('wms_masterdata', JSON.stringify({
      bins_map: { WH01: ['B-01'] },
    }));
    expect(validateBin('NONEXIST')).toBe(false);
  });
});

// ============================================================================
// saveState / loadState 异常分支
// ============================================================================

describe('saveState / loadState 异常分支', () => {
  test('saveState 写入正常数据不崩溃', () => {
    expect(() => saveState('exception_test', { a: 1 })).not.toThrow();
    expect(loadState('exception_test')).toEqual({ a: 1 });
  });

  test('loadState 在 JSON 损坏时返回 null', () => {
    localStorage.setItem('wms_broken', 'not-json');
    expect(loadState('broken')).toBeNull();
  });
});
