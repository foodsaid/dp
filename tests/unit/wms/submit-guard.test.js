/**
 * withSubmitGuard() 防重复提交装饰器测试
 * 覆盖: 首次提交执行 / 重复点击拦截 / 完成后恢复 / 异常后恢复 / 按钮状态管理
 *
 * 核心逻辑:
 *   withSubmitGuard(fn, btn)
 *   - 首次调用 → 设置 _isSubmitting=true，执行 fn()，完成后恢复
 *   - 执行期间再次调用 → 静默忽略 (返回 undefined)
 *   - fn() 抛异常 → finally 确保 _isSubmitting 恢复为 false
 *   - btn 提供时 → 自动 disable + 文案切换 → 完成后恢复
 */
const { loadSharedJs } = require('./setup');

beforeAll(() => {
  global.fetch = jest.fn();
  // withSubmitGuard 使用 t() (来自 lang.js)，测试环境需提供 mock
  global.t = function (key, fallback) { return fallback || key; };
  loadSharedJs();
});

afterEach(() => {
  // 重置扫码引擎状态 (包括 _isSubmitting)
  _resetScannerState();
});

// ============================================================================
// 场景 1: 正常提交 — fn 成功执行并返回结果
// ============================================================================

describe('withSubmitGuard — 正常提交', () => {
  test('首次调用 → 执行回调并返回其返回值', async () => {
    var fn = jest.fn().mockResolvedValue('ok');

    var result = await withSubmitGuard(fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe('ok');
  });

  test('同步回调同样支持', async () => {
    var fn = jest.fn().mockReturnValue(42);

    var result = await withSubmitGuard(fn);

    expect(result).toBe(42);
  });
});

// ============================================================================
// 场景 2: 重复点击拦截 — 执行期间再次调用被忽略
// ============================================================================

describe('withSubmitGuard — 重复点击拦截', () => {
  test('执行期间再次调用 → 返回 undefined，不执行第二次', async () => {
    // 创建一个不立即 resolve 的 Promise，模拟耗时操作
    var resolveFirst;
    var fn = jest.fn().mockImplementation(() => {
      return new Promise(function (resolve) { resolveFirst = resolve; });
    });

    // 第一次调用 (不 await，让它挂起)
    var firstCall = withSubmitGuard(fn);

    // 第二次调用 (应被拦截)
    var secondResult = await withSubmitGuard(fn);

    expect(secondResult).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);

    // 让第一次完成
    resolveFirst('done');
    await firstCall;
  });
});

// ============================================================================
// 场景 3: 异常恢复 — fn 抛异常后 _isSubmitting 恢复为 false
// ============================================================================

describe('withSubmitGuard — 异常恢复', () => {
  test('fn 抛异常 → 后续调用不被阻断', async () => {
    var failFn = jest.fn().mockRejectedValue(new Error('网络断开'));
    var successFn = jest.fn().mockResolvedValue('recovered');

    // 第一次调用: 抛异常
    await withSubmitGuard(failFn).catch(function () {});

    // 第二次调用: 应可以正常执行 (不被 _isSubmitting 阻断)
    var result = await withSubmitGuard(successFn);

    expect(successFn).toHaveBeenCalledTimes(1);
    expect(result).toBe('recovered');
  });
});

// ============================================================================
// 场景 4: 按钮状态管理 — btn 参数存在时自动 disable/恢复
// ============================================================================

describe('withSubmitGuard — 按钮状态管理', () => {
  test('执行期间按钮 disabled + 文案变为处理中，完成后恢复', async () => {
    var btn = document.createElement('button');
    btn.textContent = '提交';
    document.body.appendChild(btn);

    var fn = jest.fn().mockResolvedValue('ok');

    await withSubmitGuard(fn, btn);

    // 完成后按钮恢复
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('提交');

    document.body.innerHTML = '';
  });

  test('fn 抛异常后按钮同样恢复 (finally 保障)', async () => {
    var btn = document.createElement('button');
    btn.textContent = '确认';
    document.body.appendChild(btn);

    var fn = jest.fn().mockRejectedValue(new Error('失败'));

    await withSubmitGuard(fn, btn).catch(function () {});

    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('确认');

    document.body.innerHTML = '';
  });

  test('无按钮参数 → 不报错', async () => {
    var fn = jest.fn().mockResolvedValue('ok');
    await expect(withSubmitGuard(fn)).resolves.toBe('ok');
  });
});
