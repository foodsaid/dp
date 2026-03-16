/**
 * setupQtyInputGuard — 扫码枪误扫数量栏防护测试
 *
 * 扫码枪本质上是极速键盘模拟器，最容易触发的 BUG:
 * - 条码数值直接灌入数量输入框后附带 Enter → 触发提交
 * - IME 组合事件干扰数字解析
 * - 毫秒级连续回车导致重复提交
 *
 * setupQtyInputGuard 的防护逻辑:
 *   监听 Enter → parseFloat(value) → 若 val > max * 10 → 拦截 + 报错 + 重置为 max
 */

const { loadSharedJs } = require('./setup');

beforeAll(() => {
  loadSharedJs();
});

beforeEach(() => {
  document.body.innerHTML = '';
  CONFIG.soundEnabled = false;
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ============================================================================
// 基础行为
// ============================================================================

describe('setupQtyInputGuard — 基础行为', () => {
  test('input 元素不存在时静默返回，不抛异常', () => {
    document.body.innerHTML = '';
    expect(() => setupQtyInputGuard('nonexistent', () => 10)).not.toThrow();
  });

  test('正常数量按 Enter 不被拦截 (val <= max * 10)', () => {
    document.body.innerHTML = '<input id="qty" />';
    setupQtyInputGuard('qty', () => 10);

    var input = document.getElementById('qty');
    input.value = '8';

    var e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(e);

    // 未被拦截
    expect(e.defaultPrevented).toBe(false);
    // 值未被重置
    expect(input.value).toBe('8');
  });

  test('非 Enter 键不触发防护逻辑', () => {
    document.body.innerHTML = '<input id="qty" />';
    setupQtyInputGuard('qty', () => 5);

    var input = document.getElementById('qty');
    input.value = '99999';

    var keys = ['5', 'a', 'Backspace', 'Tab', 'ArrowLeft', 'ArrowRight', 'Delete', ' '];
    keys.forEach(function (key) {
      var e = new KeyboardEvent('keydown', { key: key, cancelable: true, bubbles: true });
      input.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false);
    });
  });
});

// ============================================================================
// 扫码枪误扫拦截 (核心场景)
// ============================================================================

describe('setupQtyInputGuard — 扫码枪误扫拦截', () => {
  test('场景: 条码数值灌入数量框 (val > max * 10) → 拦截 Enter + 重置值', () => {
    document.body.innerHTML = '<input id="qty" />';
    setupQtyInputGuard('qty', () => 50);

    var input = document.getElementById('qty');
    // 模拟扫码枪将条码 "4901234567890" 灌入数量输入框
    input.value = '4901234567890';

    var e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(e);

    // Enter 默认行为被阻止
    expect(e.defaultPrevented).toBe(true);
    // 输入框值被重置为 max
    expect(input.value).toBe('50');
  });

  test('拦截时显示错误消息 (showMessage)', () => {
    document.body.innerHTML = '<input id="qty" />';
    setupQtyInputGuard('qty', () => 10);

    var input = document.getElementById('qty');
    input.value = '999';

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true }));

    // showMessage 创建 .message-toast 元素
    var toast = document.querySelector('.message-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toContain('数量异常');
    expect(toast.textContent).toContain('扫码枪误触');
  });

  test('拦截时播放错误提示音 (playErrorSound)', () => {
    document.body.innerHTML = '<input id="qty" />';
    CONFIG.soundEnabled = true;

    // 跟踪 AudioContext 创建
    var oscillatorStarted = false;
    global.AudioContext = class {
      createOscillator() {
        return {
          connect() {},
          start() { oscillatorStarted = true; },
          stop() {},
          frequency: {},
          type: 'square',
        };
      }
      createGain() {
        return {
          connect() {},
          gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        };
      }
      get currentTime() { return 0; }
      get destination() { return {}; }
    };

    setupQtyInputGuard('qty', () => 5);
    var input = document.getElementById('qty');
    input.value = '9999';

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true }));

    expect(oscillatorStarted).toBe(true);
    CONFIG.soundEnabled = false;
  });

  test('拦截后 input.select() 被调用 (方便用户覆盖输入)', () => {
    document.body.innerHTML = '<input id="qty" />';
    setupQtyInputGuard('qty', () => 10);

    var input = document.getElementById('qty');
    input.select = jest.fn();
    input.value = '500';

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true }));

    expect(input.select).toHaveBeenCalledTimes(1);
  });

  test('stopPropagation 阻止事件冒泡 (防止父级监听器误处理)', () => {
    document.body.innerHTML = '<div id="parent"><input id="qty" /></div>';
    setupQtyInputGuard('qty', () => 10);

    var parentHandler = jest.fn();
    document.getElementById('parent').addEventListener('keydown', parentHandler);

    var input = document.getElementById('qty');
    input.value = '500';

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true }));

    // stopPropagation 阻止冒泡到父级
    expect(parentHandler).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 边界条件 (10 倍阈值)
// ============================================================================

describe('setupQtyInputGuard — 10 倍阈值边界', () => {
  test('val == max * 10 (恰好等于阈值) → 不拦截', () => {
    document.body.innerHTML = '<input id="qty" />';
    setupQtyInputGuard('qty', () => 10);

    var input = document.getElementById('qty');
    input.value = '100'; // 10 * 10 = 100，不大于

    var e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(e);

    expect(e.defaultPrevented).toBe(false);
    expect(input.value).toBe('100');
  });

  test('val == max * 10 + 0.01 (刚超过阈值) → 拦截', () => {
    document.body.innerHTML = '<input id="qty" />';
    setupQtyInputGuard('qty', () => 10);

    var input = document.getElementById('qty');
    input.value = '100.01';

    var e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(e);

    expect(e.defaultPrevented).toBe(true);
    expect(input.value).toBe('10');
  });

  test('val == max * 9.99 (略低于阈值) → 不拦截', () => {
    document.body.innerHTML = '<input id="qty" />';
    setupQtyInputGuard('qty', () => 10);

    var input = document.getElementById('qty');
    input.value = '99.9';

    var e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(e);

    expect(e.defaultPrevented).toBe(false);
    expect(input.value).toBe('99.9');
  });

  test('小数 max: max=0.5, val=6 (> 0.5 * 10 = 5) → 拦截', () => {
    document.body.innerHTML = '<input id="qty" />';
    setupQtyInputGuard('qty', () => 0.5);

    var input = document.getElementById('qty');
    input.value = '6';

    var e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(e);

    expect(e.defaultPrevented).toBe(true);
    expect(input.value).toBe('0.5');
  });
});

// ============================================================================
// 异常输入处理 (NaN / max <= 0 / 空值)
// ============================================================================

describe('setupQtyInputGuard — 异常输入处理', () => {
  test('空输入框按 Enter → 不拦截 (isNaN 分支)', () => {
    document.body.innerHTML = '<input id="qty" />';
    setupQtyInputGuard('qty', () => 10);

    var input = document.getElementById('qty');
    input.value = '';

    var e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(e);

    expect(e.defaultPrevented).toBe(false);
  });

  test('非数字输入按 Enter → 不拦截 (isNaN 分支)', () => {
    document.body.innerHTML = '<input id="qty" />';
    setupQtyInputGuard('qty', () => 10);

    var input = document.getElementById('qty');
    input.value = 'abc';

    var e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(e);

    expect(e.defaultPrevented).toBe(false);
  });

  test('max == 0 时 → 不拦截 (max > 0 条件不满足)', () => {
    document.body.innerHTML = '<input id="qty" />';
    setupQtyInputGuard('qty', () => 0);

    var input = document.getElementById('qty');
    input.value = '999999';

    var e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(e);

    expect(e.defaultPrevented).toBe(false);
  });

  test('max 为负数时 → 不拦截 (max > 0 条件不满足)', () => {
    document.body.innerHTML = '<input id="qty" />';
    setupQtyInputGuard('qty', () => -5);

    var input = document.getElementById('qty');
    input.value = '100';

    var e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(e);

    expect(e.defaultPrevented).toBe(false);
  });

  test('负数输入 → 不拦截 (负值 < max * 10)', () => {
    document.body.innerHTML = '<input id="qty" />';
    setupQtyInputGuard('qty', () => 10);

    var input = document.getElementById('qty');
    input.value = '-50';

    var e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(e);

    expect(e.defaultPrevented).toBe(false);
  });
});

// ============================================================================
// IME 组合事件场景 (输入法干扰)
// ============================================================================

describe('setupQtyInputGuard — IME 输入法场景', () => {
  test('IME 组合期间 key=Process 不触发防护 (非 Enter)', () => {
    document.body.innerHTML = '<input id="qty" />';
    setupQtyInputGuard('qty', () => 10);

    var input = document.getElementById('qty');
    input.value = '999';

    // 模拟 IME 组合过程
    input.dispatchEvent(new Event('compositionstart'));
    var e = new KeyboardEvent('keydown', { key: 'Process', cancelable: true, bubbles: true });
    input.dispatchEvent(e);

    // key=Process 不是 Enter，不触发防护
    expect(e.defaultPrevented).toBe(false);
    input.dispatchEvent(new Event('compositionend'));
  });

  test('IME 组合结束后的 Enter 仍受防护 (正常拦截)', () => {
    document.body.innerHTML = '<input id="qty" />';
    setupQtyInputGuard('qty', () => 5);

    var input = document.getElementById('qty');

    // IME 组合结束
    input.dispatchEvent(new Event('compositionstart'));
    input.dispatchEvent(new Event('compositionend'));

    // 组合结束后输入了异常值
    input.value = '88888';
    var e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(e);

    expect(e.defaultPrevented).toBe(true);
    expect(input.value).toBe('5');
  });
});

// ============================================================================
// 连续回车场景 (扫码枪快速连发)
// ============================================================================

describe('setupQtyInputGuard — 连续回车防护', () => {
  test('第一次 Enter 拦截后值被重置为 max，第二次 Enter 不再拦截', () => {
    document.body.innerHTML = '<input id="qty" />';
    setupQtyInputGuard('qty', () => 10);

    var input = document.getElementById('qty');
    input.value = '99999';

    // 第一次 Enter: 拦截并重置
    var e1 = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(e1);
    expect(e1.defaultPrevented).toBe(true);
    expect(input.value).toBe('10');

    // 第二次 Enter: 值已被重置为 max=10，10 <= 10*10=100 → 不拦截
    var e2 = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(false);
  });

  test('多次异常值连续 Enter，每次都被拦截并重置', () => {
    document.body.innerHTML = '<input id="qty" />';
    setupQtyInputGuard('qty', () => 5);

    var input = document.getElementById('qty');

    for (var i = 0; i < 3; i++) {
      input.value = '999999'; // 重新设置异常值
      var e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
      input.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
      expect(input.value).toBe('5');
    }
  });
});

// ============================================================================
// 与 setupQtyWarning 协同
// ============================================================================

describe('setupQtyInputGuard + setupQtyWarning 协同', () => {
  test('两个防护函数同时绑定在同一 input 上不冲突', () => {
    document.body.innerHTML = '<input id="qty" />';
    setupQtyWarning('qty', () => 10);
    setupQtyInputGuard('qty', () => 10);

    var input = document.getElementById('qty');

    // 中等超量 (15 > max=10 → Warning 触发样式，但 15 < 100=max*10 → Guard 不拦截)
    input.value = '15';
    input.dispatchEvent(new Event('input'));
    expect(input.style.background).toContain('255, 240, 240');

    var e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false); // Guard 不拦截

    // 超大异常值 (99999 > max*10=100 → Guard 拦截)
    input.value = '99999';
    var e2 = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(true); // Guard 拦截
    expect(input.value).toBe('10'); // 重置为 max
  });
});

// ============================================================================
// 动态 max 回调
// ============================================================================

describe('setupQtyInputGuard — 动态 max 回调', () => {
  test('getMaxFn 返回值随业务状态变化 → 防护阈值动态调整', () => {
    document.body.innerHTML = '<input id="qty" />';
    var currentMax = 100;
    setupQtyInputGuard('qty', () => currentMax);

    var input = document.getElementById('qty');

    // max=100, 阈值=1000, 输入 500 → 不拦截
    input.value = '500';
    var e1 = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(e1);
    expect(e1.defaultPrevented).toBe(false);

    // 切换行: max 变为 2
    currentMax = 2;
    input.value = '500';
    var e2 = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(true);
    expect(input.value).toBe('2');
  });
});
