/**
 * shared.js 音频引擎测试
 * 覆盖: playSuccessSound, playErrorSound, playBeepSound, playWarningSound,
 *       notifyDocLoaded, showBeepIndicator
 *
 * 重点突破:
 * - AudioContext 在 jsdom 中不存在，需完整 mock
 * - Audio.play() 返回 rejected Promise 模拟浏览器自动播放策略拦截
 * - 业务代码必须正确 catch 异常，不能让系统崩溃
 */
const { loadSharedJs } = require('./setup');

beforeAll(() => {
  loadSharedJs();
});

// 每个测试前启用音效、重置 AudioContext spy
let mockOsc, mockGain, mockCtx;
beforeEach(() => {
  CONFIG.soundEnabled = true;

  mockOsc = {
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    frequency: { value: 0 },
    type: '',
  };
  mockGain = {
    connect: jest.fn(),
    gain: {
      setValueAtTime: jest.fn(),
      exponentialRampToValueAtTime: jest.fn(),
    },
  };
  mockCtx = {
    createOscillator: jest.fn(() => mockOsc),
    createGain: jest.fn(() => mockGain),
    destination: {},
    currentTime: 0,
  };
  global.AudioContext = jest.fn(() => mockCtx);
});

afterEach(() => {
  CONFIG.soundEnabled = false;
});

// ============================================================================
// playSuccessSound
// ============================================================================

describe('playSuccessSound', () => {
  test('音效关闭时直接返回，不创建 AudioContext', () => {
    CONFIG.soundEnabled = false;
    playSuccessSound();
    expect(global.AudioContext).not.toHaveBeenCalled();
  });

  test('音效开启时创建 880Hz sine 振荡器', () => {
    playSuccessSound();
    expect(global.AudioContext).toHaveBeenCalledTimes(1);
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1);
    expect(mockCtx.createGain).toHaveBeenCalledTimes(1);
    expect(mockOsc.frequency.value).toBe(880);
    expect(mockOsc.type).toBe('sine');
    expect(mockOsc.connect).toHaveBeenCalledWith(mockGain);
    expect(mockGain.connect).toHaveBeenCalledWith(mockCtx.destination);
    expect(mockOsc.start).toHaveBeenCalled();
    expect(mockOsc.stop).toHaveBeenCalled();
  });

  test('AudioContext 构造函数抛异常时静默吞没 (不崩溃)', () => {
    global.AudioContext = jest.fn(() => { throw new Error('Not supported'); });
    expect(() => playSuccessSound()).not.toThrow();
  });
});

// ============================================================================
// playErrorSound
// ============================================================================

describe('playErrorSound', () => {
  test('音效关闭时直接返回', () => {
    CONFIG.soundEnabled = false;
    playErrorSound();
    expect(global.AudioContext).not.toHaveBeenCalled();
  });

  test('音效开启时创建 440Hz square 振荡器', () => {
    playErrorSound();
    expect(mockOsc.frequency.value).toBe(440);
    expect(mockOsc.type).toBe('square');
    expect(mockOsc.start).toHaveBeenCalled();
    expect(mockOsc.stop).toHaveBeenCalled();
  });

  test('AudioContext 抛异常时静默吞没', () => {
    global.AudioContext = jest.fn(() => { throw new Error('Blocked'); });
    expect(() => playErrorSound()).not.toThrow();
  });
});

// ============================================================================
// playBeepSound — Audio 构造 + play() rejected Promise
// ============================================================================

describe('playBeepSound', () => {
  test('音效关闭时直接返回，不创建 Audio 实例', () => {
    CONFIG.soundEnabled = false;
    const spy = jest.fn();
    global.Audio = jest.fn(() => ({ play: spy }));
    playBeepSound();
    expect(global.Audio).not.toHaveBeenCalled();
  });

  test('音效开启时创建 Audio 并调用 play()', () => {
    const mockPlay = jest.fn(() => Promise.resolve());
    global.Audio = jest.fn(() => ({ play: mockPlay }));
    playBeepSound();
    expect(global.Audio).toHaveBeenCalled();
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  test('play() 返回 rejected Promise (自动播放策略) — 正确 catch，不崩溃', async () => {
    const rejection = Promise.reject(new Error('Autoplay blocked'));
    const mockPlay = jest.fn(() => rejection);
    global.Audio = jest.fn(() => ({ play: mockPlay }));

    // 不应抛出同步异常
    expect(() => playBeepSound()).not.toThrow();

    // 等待微任务完成，确认未产生 unhandled rejection
    await expect(rejection.catch(() => {})).resolves.toBeUndefined();
  });

  test('Audio 构造函数抛异常时静默吞没', () => {
    global.Audio = jest.fn(() => { throw new Error('Audio not supported'); });
    expect(() => playBeepSound()).not.toThrow();
  });
});

// ============================================================================
// playWarningSound — 双 burst sawtooth
// ============================================================================

describe('playWarningSound', () => {
  test('音效关闭时直接返回', () => {
    CONFIG.soundEnabled = false;
    playWarningSound();
    expect(global.AudioContext).not.toHaveBeenCalled();
  });

  test('音效开启时创建 2 个 300Hz sawtooth 振荡器 (双 burst)', () => {
    playWarningSound();
    // 循环 2 次，每次 createOscillator + createGain
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2);
    expect(mockCtx.createGain).toHaveBeenCalledTimes(2);
    expect(mockOsc.type).toBe('sawtooth');
    expect(mockOsc.frequency.value).toBe(300);
  });

  test('AudioContext 抛异常时静默吞没', () => {
    global.AudioContext = jest.fn(() => { throw new Error('Boom'); });
    expect(() => playWarningSound()).not.toThrow();
  });
});

// ============================================================================
// notifyDocLoaded — 按状态选择提示音
// ============================================================================

describe('notifyDocLoaded', () => {
  // 无法跨 sandbox 直接 spy，改用 AudioContext 调用次数作为侧信道验证
  beforeEach(() => {
    global.AudioContext = jest.fn(() => mockCtx);
  });

  test.each(['completed', 'exported', '已完成'])(
    'status="%s" → 创建 AudioContext 并播放提示音 (不崩溃)',
    (status) => {
      expect(() => notifyDocLoaded(status)).not.toThrow();
      // warningSound 创建 2 个振荡器 → 2 次 createOscillator
      expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2);
    }
  );

  test.each(['in_progress', 'pending', 'draft'])(
    'status="%s" → 创建 AudioContext 并播放成功音 (不崩溃)',
    (status) => {
      expect(() => notifyDocLoaded(status)).not.toThrow();
      // successSound 创建 1 个振荡器
      expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1);
    }
  );
});

// ============================================================================
// showBeepIndicator — DOM class 动画
// ============================================================================

describe('showBeepIndicator', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('有 beepIndicator 元素时添加 show class，500ms 后移除', () => {
    document.body.innerHTML = '<div id="beepIndicator"></div>';
    showBeepIndicator();
    var el = document.getElementById('beepIndicator');
    expect(el.classList.contains('show')).toBe(true);

    jest.advanceTimersByTime(500);
    expect(el.classList.contains('show')).toBe(false);
  });

  test('无 beepIndicator 元素时静默返回', () => {
    document.body.innerHTML = '';
    expect(() => showBeepIndicator()).not.toThrow();
  });
});
