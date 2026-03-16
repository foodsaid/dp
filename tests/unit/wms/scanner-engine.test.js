/**
 * V36: 工业级扫码引擎测试
 * 覆盖: setupBarcodeInput 三维度防御 + toHalfWidth IME 清洗
 *
 * 使用 jest.useFakeTimers() 精确控制时间轴，模拟扫码枪/人类输入的时序差异
 *
 * 重要: 模拟遵循真实浏览器事件顺序 — keydown 在字符插入之前触发
 */
const { loadSharedJs } = require('./setup');

beforeAll(() => {
  loadSharedJs();
});

// ============================================================================
// 测试工具：模拟键盘事件
// ============================================================================

/**
 * 模拟 keydown 事件
 * @param {HTMLInputElement} input - 输入框元素
 * @param {string} key - 按键名称
 * @param {object} [opts] - 额外事件属性 (isComposing 等)
 */
function fireKeydown(input, key, opts) {
  var event = new KeyboardEvent('keydown', Object.assign({
    key: key,
    bubbles: true,
    cancelable: true,
  }, opts || {}));
  input.dispatchEvent(event);
}

/**
 * 模拟扫码枪快速输入一串字符 (每字符间隔 10ms，远小于 50ms 阈值)
 * 遵循浏览器事件顺序: keydown → 字符插入 (先 fire 事件，再修改 value)
 * @param {HTMLInputElement} input - 输入框元素
 * @param {string} chars - 要输入的字符序列
 */
function simulateScannerBurst(input, chars) {
  for (var i = 0; i < chars.length; i++) {
    if (i > 0) jest.advanceTimersByTime(10);
    // 浏览器行为: keydown 先触发 (此时 handler 可检查/清空 buffer)
    fireKeydown(input, chars[i]);
    // 然后字符插入 input
    input.value += chars[i];
  }
}

// ============================================================================
// toHalfWidth — IME 全角→半角清洗工具函数
// ============================================================================

describe('toHalfWidth - IME 全角→半角清洗', () => {
  test('全角数字转半角: ＰＯ２６０００１７８ → PO26000178', () => {
    expect(toHalfWidth('ＰＯ２６０００１７８')).toBe('PO26000178');
  });

  test('全角字母转半角: ＡＢＣＤ → ABCD', () => {
    expect(toHalfWidth('ＡＢＣＤ')).toBe('ABCD');
  });

  test('全角小写字母转半角: ａｂｃｄ → abcd', () => {
    expect(toHalfWidth('ａｂｃｄ')).toBe('abcd');
  });

  test('全角空格转半角: "　" → " "', () => {
    expect(toHalfWidth('\u3000')).toBe(' ');
  });

  test('混合全角半角: Ｗ0２5001026 → W025001026', () => {
    expect(toHalfWidth('Ｗ0２5001026')).toBe('W025001026');
  });

  test('纯半角不变: PO26000178 → PO26000178', () => {
    expect(toHalfWidth('PO26000178')).toBe('PO26000178');
  });

  test('空字符串: "" → ""', () => {
    expect(toHalfWidth('')).toBe('');
  });

  test('null/undefined 安全: null → ""', () => {
    expect(toHalfWidth(null)).toBe('');
    expect(toHalfWidth(undefined)).toBe('');
  });

  test('全角符号转半角: ＃１２３ → #123', () => {
    expect(toHalfWidth('＃１２３')).toBe('#123');
  });

  test('全角连字符转半角: ＡＢ－００１ → AB-001', () => {
    expect(toHalfWidth('ＡＢ－００１')).toBe('AB-001');
  });
});

// ============================================================================
// setupBarcodeInput — 三维度防御引擎测试 (Fake Timers)
// ============================================================================

describe('setupBarcodeInput - 工业级扫码引擎', () => {
  let input, callbackFn;

  beforeEach(() => {
    jest.useFakeTimers();
    // 创建输入框并绑定扫码引擎
    document.body.innerHTML = '<input id="testScan" />';
    input = document.getElementById('testScan');
    callbackFn = jest.fn();
    setupBarcodeInput('testScan', callbackFn);
    // 推进自动聚焦 timer
    jest.advanceTimersByTime(200);
    // 重置扫码引擎内部状态 (sandbox 作用域，确保测试隔离)
    _resetScannerState();
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  // --------------------------------------------------------------------------
  // 维度 1: 手动输入兼容 (允许键盘输入单据号)
  // --------------------------------------------------------------------------

  describe('维度 1: 手动输入兼容 (允许键盘输入单据号)', () => {
    test('扫码枪快速输入 (<50ms 间隔) → buffer 保持完整，回车后回调正确值', () => {
      simulateScannerBurst(input, 'PO26000178');
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Enter');

      expect(callbackFn).toHaveBeenCalledTimes(1);
      expect(callbackFn).toHaveBeenCalledWith('PO26000178');
      expect(input.value).toBe('');
    });

    test('人类缓慢输入 (>50ms 间隔) → buffer 完整保留，允许手动输入', () => {
      // 浏览器行为: keydown → 字符插入
      fireKeydown(input, 'A');
      input.value += 'A';
      jest.advanceTimersByTime(100);
      fireKeydown(input, 'B');
      input.value += 'B';
      jest.advanceTimersByTime(100);
      fireKeydown(input, 'C');
      input.value += 'C';

      jest.advanceTimersByTime(10);
      fireKeydown(input, 'Enter');

      // 手动输入完整保留，回调收到 'ABC'
      expect(callbackFn).toHaveBeenCalledTimes(1);
      expect(callbackFn).toHaveBeenCalledWith('ABC');
    });

    test('两段输入间有间隔 → 全部保留', () => {
      // 第一段快速扫入
      simulateScannerBurst(input, 'OLD');
      // 等待 60ms
      jest.advanceTimersByTime(60);
      // 第二段快速扫入
      simulateScannerBurst(input, 'NEW123');
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Enter');

      expect(callbackFn).toHaveBeenCalledTimes(1);
      // 两段输入全部保留
      expect(callbackFn).toHaveBeenCalledWith('OLDNEW123');
    });

    test('慢速输入完整单据号 → 回调收到完整值', () => {
      // 模拟人类手动输入 TR26000001
      var chars = 'TR26000001'.split('');
      chars.forEach(function(ch) {
        fireKeydown(input, ch);
        input.value += ch;
        jest.advanceTimersByTime(150);  // 人类打字速度
      });
      fireKeydown(input, 'Enter');

      expect(callbackFn).toHaveBeenCalledTimes(1);
      expect(callbackFn).toHaveBeenCalledWith('TR26000001');
    });
  });

  // --------------------------------------------------------------------------
  // 维度 2: IME 全角→半角清洗
  // --------------------------------------------------------------------------

  describe('维度 2: IME 全角→半角清洗', () => {
    test('全角条码 ＰＯ２６０００１７８ → 回调收到半角 PO26000178', () => {
      simulateScannerBurst(input, 'ＰＯ２６０００１７８');
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Enter');

      expect(callbackFn).toHaveBeenCalledTimes(1);
      expect(callbackFn).toHaveBeenCalledWith('PO26000178');
    });

    test('混合全角半角 Ｗ0２5001026 → 回调收到纯半角 W025001026', () => {
      simulateScannerBurst(input, 'Ｗ0２5001026');
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Enter');

      expect(callbackFn).toHaveBeenCalledTimes(1);
      expect(callbackFn).toHaveBeenCalledWith('W025001026');
    });

    test('IME Process 键 → 完全忽略不影响 buffer', () => {
      simulateScannerBurst(input, 'PO123');
      // Process 键: handler 直接 return，不更新 _lastKeyTime
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Process');
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Enter');

      expect(callbackFn).toHaveBeenCalledTimes(1);
      expect(callbackFn).toHaveBeenCalledWith('PO123');
    });

    test('isComposing=true 的事件 → 完全忽略', () => {
      simulateScannerBurst(input, 'TR100');
      // isComposing 事件: handler 直接 return
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'a', { isComposing: true });
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Enter');

      expect(callbackFn).toHaveBeenCalledTimes(1);
      expect(callbackFn).toHaveBeenCalledWith('TR100');
    });

    test('isComposing 的 Enter → 被忽略 (不触发回调)', () => {
      simulateScannerBurst(input, 'SO200');
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Enter', { isComposing: true });

      expect(callbackFn).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // 维度 3: 幽灵回车过滤
  // --------------------------------------------------------------------------

  describe('维度 3: 幽灵回车过滤', () => {
    test('空 buffer + Enter → 不调用回调', () => {
      fireKeydown(input, 'Enter');

      expect(callbackFn).not.toHaveBeenCalled();
    });

    test('纯空格 + Enter → 不调用回调 (trim 后为空)', () => {
      input.value = '   ';
      fireKeydown(input, 'Enter');

      expect(callbackFn).not.toHaveBeenCalled();
    });

    test('全角空格 + Enter → 不调用回调 (全角空格→半角→trim 后为空)', () => {
      input.value = '\u3000\u3000';
      fireKeydown(input, 'Enter');

      expect(callbackFn).not.toHaveBeenCalled();
    });

    test('连续两次空回车 → 都不调用回调', () => {
      fireKeydown(input, 'Enter');
      jest.advanceTimersByTime(100);
      fireKeydown(input, 'Enter');

      expect(callbackFn).not.toHaveBeenCalled();
    });

    test('幽灵回车后正常扫码 → 回调正常触发', () => {
      // 先一次幽灵回车
      fireKeydown(input, 'Enter');
      expect(callbackFn).not.toHaveBeenCalled();

      // 然后正常扫码
      jest.advanceTimersByTime(100);
      simulateScannerBurst(input, 'WO25001');
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Enter');

      expect(callbackFn).toHaveBeenCalledTimes(1);
      expect(callbackFn).toHaveBeenCalledWith('WO25001');
    });
  });

  // --------------------------------------------------------------------------
  // 防双击 (扫码冷却)
  // --------------------------------------------------------------------------

  describe('防双击 (扫码冷却 SCAN_COOLDOWN_MS=800)', () => {
    test('800ms 内连续扫同一条码 → 第二次被静默忽略', () => {
      // 第一次扫码
      simulateScannerBurst(input, 'PO26000178');
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Enter');
      expect(callbackFn).toHaveBeenCalledTimes(1);

      // 300ms 后第二次扫码 (仍在冷却期)
      jest.advanceTimersByTime(300);
      simulateScannerBurst(input, 'PO26000178');
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Enter');

      // 第二次被冷却拦截
      expect(callbackFn).toHaveBeenCalledTimes(1);
    });

    test('超过 800ms 后扫码 → 正常触发', () => {
      // 第一次扫码
      simulateScannerBurst(input, 'WO100');
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Enter');
      expect(callbackFn).toHaveBeenCalledTimes(1);

      // 等待 850ms (超过冷却期)
      jest.advanceTimersByTime(850);
      simulateScannerBurst(input, 'WO200');
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Enter');

      expect(callbackFn).toHaveBeenCalledTimes(2);
      expect(callbackFn).toHaveBeenLastCalledWith('WO200');
    });

    test('800ms 内扫不同条码 → 仍然被冷却拦截 (硬件防抖优先)', () => {
      simulateScannerBurst(input, 'SO001');
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Enter');
      expect(callbackFn).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(200);
      simulateScannerBurst(input, 'SO002');
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Enter');

      // 冷却期内，即使条码不同也被拦截
      expect(callbackFn).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // 综合场景
  // --------------------------------------------------------------------------

  describe('综合场景', () => {
    test('IME 全角扫码 + 手动输入混合 → 全部保留并转半角', () => {
      // 人类慢速输入一个字符
      fireKeydown(input, 'X');
      input.value = 'X';
      jest.advanceTimersByTime(200);

      // 扫码枪快速输入全角字符
      simulateScannerBurst(input, 'ＳＯ２６００００５０');
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Enter');

      expect(callbackFn).toHaveBeenCalledTimes(1);
      // 所有输入保留，全角转半角
      expect(callbackFn).toHaveBeenCalledWith('XSO26000050');
    });

    test('Process 键不重置超时计时器 (IME 不影响 buffer 时序)', () => {
      simulateScannerBurst(input, 'TR');
      // Process 键: handler 直接 return，不更新 _lastKeyTime
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Process');
      // 从最后一个有效键 ('R') 到下一个有效键的总间隔 = 5+30 = 35ms < 50ms
      jest.advanceTimersByTime(30);
      simulateScannerBurst(input, '001');
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Enter');

      expect(callbackFn).toHaveBeenCalledTimes(1);
      expect(callbackFn).toHaveBeenCalledWith('TR001');
    });

    test('setupBarcodeInput 对不存在的元素 → 静默返回不报错', () => {
      expect(() => {
        setupBarcodeInput('nonexistent', jest.fn());
      }).not.toThrow();
    });

    test('提交防抖期间回车 → 被忽略', () => {
      // 通过 withSubmitGuard 模拟提交中状态 (sandbox 作用域)
      // 直接调用 _resetScannerState 确保初始状态, 然后手动设 _isSubmitting
      _resetScannerState();
      // 设置提交中标志 (需通过 sandbox 作用域函数)
      withSubmitGuard(function() {
        // 在 guard 期间尝试扫码
        simulateScannerBurst(input, 'PO999');
        jest.advanceTimersByTime(5);
        fireKeydown(input, 'Enter');
        return Promise.resolve();
      });

      expect(callbackFn).not.toHaveBeenCalled();
    });

    test('回调触发后 input.value 被清空 + _lastKeyTime 被重置', () => {
      simulateScannerBurst(input, 'IC001');
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Enter');

      expect(callbackFn).toHaveBeenCalledTimes(1);
      expect(input.value).toBe('');

      // 等待超过冷却期后再次扫码 — _lastKeyTime 已重置，不会误截断
      jest.advanceTimersByTime(900);
      simulateScannerBurst(input, 'IC002');
      jest.advanceTimersByTime(5);
      fireKeydown(input, 'Enter');

      expect(callbackFn).toHaveBeenCalledTimes(2);
      expect(callbackFn).toHaveBeenLastCalledWith('IC002');
    });
  });

  // --------------------------------------------------------------------------
  // V37: Edge IME compositionstart/compositionend 恢复机制测试
  // --------------------------------------------------------------------------

  describe('V37: IME Composition 恢复机制 (Edge 浏览器兼容)', () => {

    test('compositionend + data: IME 吞掉输入后恢复内容', () => {
      // 模拟: 输入框有前缀 → compositionstart 记录 → IME 清空输入框 → compositionend 恢复
      input.value = 'WO';
      input.dispatchEvent(new Event('compositionstart'));

      // IME 吞掉了输入框内容
      input.value = '';

      // compositionend 携带 data
      var compEvent = new CompositionEvent('compositionend', { data: '12' });
      input.dispatchEvent(compEvent);

      // 应恢复为: 之前的内容 + data
      expect(input.value).toBe('WO12');
    });

    test('compositionend 无 data 且输入框有值: 不修改', () => {
      input.value = 'PO001';
      input.dispatchEvent(new Event('compositionstart'));

      // compositionend 但 data 为空
      var compEvent = new CompositionEvent('compositionend', { data: '' });
      input.dispatchEvent(compEvent);

      expect(input.value).toBe('PO001');
    });

    test('compositionend + data 但输入框未被清空: 不覆盖', () => {
      input.value = 'SO';
      input.dispatchEvent(new Event('compositionstart'));

      // IME 没有清空输入框 (正常结束)
      // input.value 仍然是 'SO'

      var compEvent = new CompositionEvent('compositionend', { data: '100' });
      input.dispatchEvent(compEvent);

      // 输入框未被清空，所以不触发恢复
      expect(input.value).toBe('SO');
    });

    test('空输入框 + compositionstart + compositionend: 只追加 data', () => {
      input.value = '';
      input.dispatchEvent(new Event('compositionstart'));

      // 输入框本来就为空，compositionend 后仍为空但有 data
      var compEvent = new CompositionEvent('compositionend', { data: 'WO' });
      input.dispatchEvent(compEvent);

      // _composingText 为 '' + data 'WO' = 'WO'
      expect(input.value).toBe('WO');
    });

    test('连续两次 composition 互不干扰', () => {
      // 第一次 composition
      input.value = 'A';
      input.dispatchEvent(new Event('compositionstart'));
      input.value = '';
      input.dispatchEvent(new CompositionEvent('compositionend', { data: 'B' }));
      expect(input.value).toBe('AB');

      // 第二次 composition (在第一次恢复后的基础上)
      input.dispatchEvent(new Event('compositionstart'));
      input.value = '';
      input.dispatchEvent(new CompositionEvent('compositionend', { data: 'C' }));
      expect(input.value).toBe('ABC');
    });
  });
});
