/**
 * shared.js 库位历史 + initBinAutocomplete 测试
 * 覆盖: shared.js 行 1505-1619
 * - _getBinHistory / _saveBinHistory / _removeBinHistory
 * - initBinAutocomplete (DOM 交互: 标签点击、双击移除、blur 校验、form submit)
 */
const { loadSharedJs } = require('./setup');

loadSharedJs();

// 确保 t() 国际化存根可用
if (typeof global.t !== 'function') {
  global.t = function(key, fallback) { return fallback || key; };
}

const BIN_HISTORY_KEY = 'wms_recent_bins';

describe('_getBinHistory — 获取库位历史', () => {
  beforeEach(() => {
    localStorage.removeItem(BIN_HISTORY_KEY);
  });

  test('无历史数据时返回空数组', () => {
    expect(_getBinHistory()).toEqual([]);
  });

  test('有数据时返回解析后的数组', () => {
    localStorage.setItem(BIN_HISTORY_KEY, JSON.stringify(['A-01', 'B-02']));
    expect(_getBinHistory()).toEqual(['A-01', 'B-02']);
  });

  test('损坏的 JSON 返回空数组', () => {
    localStorage.setItem(BIN_HISTORY_KEY, '{invalid');
    expect(_getBinHistory()).toEqual([]);
  });
});

describe('_saveBinHistory — 保存库位历史', () => {
  beforeEach(() => {
    localStorage.removeItem(BIN_HISTORY_KEY);
  });

  test('保存新库位到历史', () => {
    _saveBinHistory('A-01');
    expect(_getBinHistory()).toEqual(['A-01']);
  });

  test('重复库位提升到最前', () => {
    _saveBinHistory('A-01');
    _saveBinHistory('B-02');
    _saveBinHistory('A-01');
    expect(_getBinHistory()).toEqual(['A-01', 'B-02']);
  });

  test('超出最大数量 (10) 时截断', () => {
    for (let i = 0; i < 15; i++) {
      _saveBinHistory('BIN-' + i);
    }
    expect(_getBinHistory().length).toBe(10);
    expect(_getBinHistory()[0]).toBe('BIN-14');
  });

  test('空值不保存', () => {
    _saveBinHistory('');
    expect(_getBinHistory()).toEqual([]);
  });

  test('null 不保存', () => {
    _saveBinHistory(null);
    expect(_getBinHistory()).toEqual([]);
  });
});

describe('_removeBinHistory — 移除库位历史', () => {
  beforeEach(() => {
    localStorage.removeItem(BIN_HISTORY_KEY);
  });

  test('移除存在的库位', () => {
    _saveBinHistory('A-01');
    _saveBinHistory('B-02');
    _removeBinHistory('A-01');
    expect(_getBinHistory()).toEqual(['B-02']);
  });

  test('移除不存在的库位 — 无副作用', () => {
    _saveBinHistory('A-01');
    _removeBinHistory('NOT-EXIST');
    expect(_getBinHistory()).toEqual(['A-01']);
  });

  test('空值不操作', () => {
    _saveBinHistory('A-01');
    _removeBinHistory('');
    expect(_getBinHistory()).toEqual(['A-01']);
  });

  test('null 不操作', () => {
    _saveBinHistory('A-01');
    _removeBinHistory(null);
    expect(_getBinHistory()).toEqual(['A-01']);
  });
});

describe('initBinAutocomplete — DOM 交互', () => {
  beforeEach(() => {
    localStorage.removeItem(BIN_HISTORY_KEY);
    document.body.innerHTML = '<form id="testForm"><input id="binInput" /><div id="binContainer"></div></form>';
  });

  test('输入框不存在时静默返回', () => {
    expect(() => initBinAutocomplete('nonexistent')).not.toThrow();
  });

  test('初始化后创建标签容器', () => {
    initBinAutocomplete('binInput');
    const tagBox = document.querySelector('.bin-recent-tags');
    expect(tagBox).not.toBeNull();
  });

  test('聚焦时显示历史标签', () => {
    _saveBinHistory('A-01');
    _saveBinHistory('B-02');
    initBinAutocomplete('binInput');

    const input = document.getElementById('binInput');
    input.dispatchEvent(new Event('focus'));

    const chips = document.querySelectorAll('.bin-recent-chip');
    expect(chips.length).toBe(2);
    expect(chips[0].getAttribute('data-bin')).toBe('B-02');
  });

  test('点击标签填入输入框', () => {
    _saveBinHistory('A-01');
    initBinAutocomplete('binInput');

    const input = document.getElementById('binInput');
    input.dispatchEvent(new Event('focus'));

    const chip = document.querySelector('.bin-recent-chip');
    chip.click();

    expect(input.value).toBe('A-01');
    expect(input.style.borderColor).toBe('#22c55e');
  });

  test('双击标签移除快捷库位', () => {
    _saveBinHistory('A-01');
    _saveBinHistory('B-02');
    initBinAutocomplete('binInput');

    const input = document.getElementById('binInput');
    input.dispatchEvent(new Event('focus'));

    const chips = document.querySelectorAll('.bin-recent-chip');
    const targetChip = chips[0]; // B-02 (最近的)
    const dblClickEvent = new MouseEvent('dblclick', { bubbles: true });
    targetChip.dispatchEvent(dblClickEvent);

    // B-02 应该被移除
    const remaining = _getBinHistory();
    expect(remaining).toEqual(['A-01']);
  });

  test('无历史时标签容器隐藏', () => {
    initBinAutocomplete('binInput');
    const input = document.getElementById('binInput');
    input.dispatchEvent(new Event('focus'));

    const tagBox = document.querySelector('.bin-recent-tags');
    expect(tagBox.style.display).toBe('none');
  });

  test('最多显示 5 个历史标签', () => {
    for (let i = 0; i < 8; i++) {
      _saveBinHistory('BIN-' + i);
    }
    initBinAutocomplete('binInput');
    const input = document.getElementById('binInput');
    input.dispatchEvent(new Event('focus'));

    const chips = document.querySelectorAll('.bin-recent-chip');
    expect(chips.length).toBe(5);
  });

  test('form submit 时保存非系统库位到历史', () => {
    initBinAutocomplete('binInput');
    const input = document.getElementById('binInput');
    input.value = 'A-01-SHELF';

    const form = document.getElementById('testForm');
    form.dispatchEvent(new Event('submit'));

    expect(_getBinHistory()).toContain('A-01-SHELF');
  });

  test('form submit 时系统库位不保存到历史', () => {
    initBinAutocomplete('binInput');
    const input = document.getElementById('binInput');
    // SYSTEM-BIN 是 isSystemBin 识别的系统库位
    input.value = 'SYSTEM-BIN-LOCATION';

    const form = document.getElementById('testForm');
    form.dispatchEvent(new Event('submit'));

    expect(_getBinHistory()).not.toContain('SYSTEM-BIN-LOCATION');
  });

  test('blur 事件触发校验 (空值不处理)', () => {
    initBinAutocomplete('binInput');
    const input = document.getElementById('binInput');
    input.value = '';
    input.dispatchEvent(new Event('blur'));
    // 不抛异常即通过
  });

  test('blur 事件触发校验 (有值时尝试纠正)', () => {
    initBinAutocomplete('binInput');
    const input = document.getElementById('binInput');
    input.value = 'some-bin';
    // validateBin 依赖 masterdata 缓存，测试环境无缓存，不会改变 value
    input.dispatchEvent(new Event('blur'));
    // 不抛异常即通过
  });
});
