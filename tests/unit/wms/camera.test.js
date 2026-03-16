/**
 * camera-fallback.js 单元测试
 * 覆盖: 纯算法函数 (CameraFallbackCore) + 集成测试 (_test 钩子)
 * Issue: #57
 */

// Mock Html5Qrcode (必须在 require 之前)
const mockStop = jest.fn(() => Promise.resolve());
const mockStart = jest.fn(() => Promise.resolve());
const mockPause = jest.fn();
const mockResume = jest.fn();
const mockScanFile = jest.fn(() => Promise.resolve('SCANNED'));
const mockClear = jest.fn();
global.Html5Qrcode = jest.fn(function () {
  this.start = mockStart;
  this.stop = mockStop;
  this.pause = mockPause;
  this.resume = mockResume;
  this.scanFile = mockScanFile;
  this.clear = mockClear;
});
global.Html5QrcodeSupportedFormats = {
  QR_CODE: 0, CODE_128: 1, CODE_39: 2, EAN_13: 3, EAN_8: 4
};

// Mock showMessage (全局)
global.showMessage = jest.fn();

// Mock focusScanInput
global.focusScanInput = jest.fn();

// 加载模块 — 主 IIFE 的 init() 在 jsdom 中安全返回 (无匹配输入框)
const Core = require('../../../apps/wms/camera-fallback.js');

// ============================================================================
// 纯函数测试: checkFrameSimilarity
// ============================================================================
describe('checkFrameSimilarity', () => {
  test('空数组返回 false', () => {
    expect(Core.checkFrameSimilarity([])).toBe(false);
  });

  test('null 返回 false', () => {
    expect(Core.checkFrameSimilarity(null)).toBe(false);
  });

  test('单元素返回 false (不足 2 帧)', () => {
    expect(Core.checkFrameSimilarity(['ABC'])).toBe(false);
  });

  test('两帧相同返回 true', () => {
    expect(Core.checkFrameSimilarity(['ABC', 'ABC'])).toBe(true);
  });

  test('两帧不同返回 false', () => {
    expect(Core.checkFrameSimilarity(['ABC', 'DEF'])).toBe(false);
  });

  test('三帧全同返回 true', () => {
    expect(Core.checkFrameSimilarity(['X', 'X', 'X'])).toBe(true);
  });

  test('三帧中间不同返回 false', () => {
    expect(Core.checkFrameSimilarity(['X', 'Y', 'X'])).toBe(false);
  });
});

// ============================================================================
// 纯函数测试: updateScanSession (状态机)
// ============================================================================
describe('updateScanSession', () => {
  const T0 = 1000000;

  test('首帧 — 缓冲区长度为 1, 不接受', () => {
    var result = Core.updateScanSession(
      { buffer: [], timestamp: 0 }, 'ABC', T0, { confirmCount: 2 }
    );
    expect(result.accepted).toBe(false);
    expect(result.buffer).toEqual(['ABC']);
    expect(result.timestamp).toBe(T0);
  });

  test('连续 2 帧相同 — 接受', () => {
    var s1 = Core.updateScanSession(
      { buffer: [], timestamp: 0 }, 'ABC', T0, { confirmCount: 2 }
    );
    var s2 = Core.updateScanSession(
      { buffer: s1.buffer, timestamp: s1.timestamp }, 'ABC', T0 + 100, { confirmCount: 2 }
    );
    expect(s2.accepted).toBe(true);
    expect(s2.code).toBe('ABC');
    expect(s2.buffer).toEqual([]); // 接受后清空
  });

  test('场景 A (防误判): 2帧A + 1帧B → 重置, 不触发回调', () => {
    // 第1帧: A
    var s1 = Core.updateScanSession(
      { buffer: [], timestamp: 0 }, 'A', T0, { confirmCount: 3 }
    );
    expect(s1.accepted).toBe(false);
    // 第2帧: A
    var s2 = Core.updateScanSession(
      { buffer: s1.buffer, timestamp: s1.timestamp }, 'A', T0 + 50, { confirmCount: 3 }
    );
    expect(s2.accepted).toBe(false);
    expect(s2.buffer).toEqual(['A', 'A']);
    // 第3帧: B (不一致)
    var s3 = Core.updateScanSession(
      { buffer: s2.buffer, timestamp: s2.timestamp }, 'B', T0 + 100, { confirmCount: 3 }
    );
    expect(s3.accepted).toBe(false);
    expect(s3.code).toBeNull();
    // 缓冲区应保留最近 3 帧的滑动窗口
    expect(s3.buffer).toEqual(['A', 'A', 'B']);
  });

  test('confirmCount=3 需要连续 3 帧一致', () => {
    var s1 = Core.updateScanSession({ buffer: [], timestamp: 0 }, 'X', T0, { confirmCount: 3 });
    var s2 = Core.updateScanSession({ buffer: s1.buffer, timestamp: s1.timestamp }, 'X', T0 + 50, { confirmCount: 3 });
    expect(s2.accepted).toBe(false);
    var s3 = Core.updateScanSession({ buffer: s2.buffer, timestamp: s2.timestamp }, 'X', T0 + 100, { confirmCount: 3 });
    expect(s3.accepted).toBe(true);
    expect(s3.code).toBe('X');
  });

  test('超时清空 — 1500ms 后旧缓冲区被重置', () => {
    var s1 = Core.updateScanSession(
      { buffer: ['OLD'], timestamp: T0 }, 'NEW', T0 + 2000, { confirmCount: 2, timeoutMs: 1500 }
    );
    // 旧缓冲区被清空, NEW 成为第一帧
    expect(s1.buffer).toEqual(['NEW']);
    expect(s1.accepted).toBe(false);
  });

  test('未超时 — 保留旧缓冲区', () => {
    var s1 = Core.updateScanSession(
      { buffer: ['A'], timestamp: T0 }, 'A', T0 + 500, { confirmCount: 2, timeoutMs: 1500 }
    );
    expect(s1.accepted).toBe(true);
    expect(s1.code).toBe('A');
  });

  test('滑动窗口 — 超过 confirmCount 时移除最旧帧', () => {
    // confirmCount=2, 缓冲区 ['A'], 新帧 'B'
    var s1 = Core.updateScanSession(
      { buffer: ['A'], timestamp: T0 }, 'B', T0 + 50, { confirmCount: 2 }
    );
    expect(s1.buffer).toEqual(['A', 'B']);
    // 再来一帧 'C', 应移除 'A'
    var s2 = Core.updateScanSession(
      { buffer: s1.buffer, timestamp: s1.timestamp }, 'C', T0 + 100, { confirmCount: 2 }
    );
    expect(s2.buffer).toEqual(['B', 'C']);
    expect(s2.accepted).toBe(false);
  });
});

// ============================================================================
// 纯函数测试: classifyStartError
// ============================================================================
describe('classifyStartError', () => {
  test('NotAllowedError → camera.denied', () => {
    var err = new Error('Permission denied');
    err.name = 'NotAllowedError';
    var result = Core.classifyStartError(err);
    expect(result.msgKey).toBe('camera.denied');
    expect(result.fallback).toContain('权限');
  });

  test('permission 关键字匹配 (无 name)', () => {
    var err = new Error('User denied permission');
    err.name = 'Error';
    var result = Core.classifyStartError(err);
    expect(result.msgKey).toBe('camera.denied');
  });

  test('NotFoundError → camera.notFound', () => {
    var err = new Error('No camera found');
    err.name = 'NotFoundError';
    var result = Core.classifyStartError(err);
    expect(result.msgKey).toBe('camera.notFound');
    expect(result.fallback).toContain('未检测');
  });

  test('"no camera" 消息匹配 (无 name)', () => {
    var err = new Error('no camera available');
    err.name = 'Error';
    var result = Core.classifyStartError(err);
    expect(result.msgKey).toBe('camera.notFound');
  });

  test('NotReadableError → camera.busy', () => {
    var err = new Error('Camera is busy');
    err.name = 'NotReadableError';
    var result = Core.classifyStartError(err);
    expect(result.msgKey).toBe('camera.busy');
    expect(result.fallback).toContain('占用');
  });

  test('未知错误 → camera.error', () => {
    var err = new Error('Something went wrong');
    var result = Core.classifyStartError(err);
    expect(result.msgKey).toBe('camera.error');
    expect(result.fallback).toContain('启动失败');
  });

  test('null 错误 → camera.error', () => {
    var result = Core.classifyStartError(null);
    expect(result.msgKey).toBe('camera.error');
  });
});

// ============================================================================
// 纯函数测试: detectPlatform
// ============================================================================
describe('detectPlatform', () => {
  test('iPhone → isIOS: true', () => {
    expect(Core.detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)').isIOS).toBe(true);
  });

  test('iPad → isIOS: true', () => {
    expect(Core.detectPlatform('Mozilla/5.0 (iPad; CPU OS 16_0)').isIOS).toBe(true);
  });

  test('Android → isIOS: false', () => {
    expect(Core.detectPlatform('Mozilla/5.0 (Linux; Android 13)').isIOS).toBe(false);
  });

  test('Desktop Chrome → isIOS: false', () => {
    expect(Core.detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64)').isIOS).toBe(false);
  });

  test('空字符串 → isIOS: false', () => {
    expect(Core.detectPlatform('').isIOS).toBe(false);
  });

  test('null → isIOS: false', () => {
    expect(Core.detectPlatform(null).isIOS).toBe(false);
  });
});

// ============================================================================
// 纯函数测试: buildScannerConfig
// ============================================================================
describe('buildScannerConfig', () => {
  test('iOS — 无 videoConstraints (最大兼容)', () => {
    var config = Core.buildScannerConfig(true);
    expect(config.fps).toBe(12);
    expect(config.disableFlip).toBe(true);
    expect(config.videoConstraints).toBeUndefined();
  });

  test('非 iOS — 含 1080p videoConstraints', () => {
    var config = Core.buildScannerConfig(false);
    expect(config.fps).toBe(12);
    expect(config.disableFlip).toBe(true);
    expect(config.videoConstraints).toEqual({
      facingMode: 'environment',
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    });
  });
});

// ============================================================================
// 纯函数测试: isGoodExposure
// ============================================================================
describe('isGoodExposure', () => {
  /** 构造 RGBA 像素数组 (每像素 4 字节) */
  function makePixels(r, g, b, count) {
    var data = new Uint8ClampedArray(count * 4);
    for (var i = 0; i < count; i++) {
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255; // alpha
    }
    return data;
  }

  test('全黑图像 → too_dark', () => {
    var pixels = makePixels(0, 0, 0, 100);
    var result = Core.isGoodExposure(pixels);
    expect(result.good).toBe(false);
    expect(result.reason).toBe('too_dark');
  });

  test('全白图像 → too_bright', () => {
    var pixels = makePixels(255, 255, 255, 100);
    var result = Core.isGoodExposure(pixels);
    expect(result.good).toBe(false);
    expect(result.reason).toBe('too_bright');
  });

  test('中等亮度 → good', () => {
    var pixels = makePixels(128, 128, 128, 100);
    var result = Core.isGoodExposure(pixels);
    expect(result.good).toBe(true);
    expect(result.reason).toBeNull();
  });

  test('无数据 → no_data', () => {
    var result = Core.isGoodExposure(null);
    expect(result.good).toBe(false);
    expect(result.reason).toBe('no_data');
  });

  test('空数组 → no_data', () => {
    var result = Core.isGoodExposure(new Uint8ClampedArray(0));
    expect(result.good).toBe(false);
    expect(result.reason).toBe('no_data');
  });

  test('自定义阈值 — 暗阈值提高到 100', () => {
    // 亮度约 50 (R=50,G=50,B=50), 默认不算暗, 但阈值提高到 100 后算暗
    var pixels = makePixels(50, 50, 50, 100);
    var result = Core.isGoodExposure(pixels, { darkThreshold: 100 });
    expect(result.good).toBe(false);
    expect(result.reason).toBe('too_dark');
  });

  test('混合亮度 — 一半暗一半亮 → good (各不超过 70%)', () => {
    var data = new Uint8ClampedArray(40); // 10 像素
    for (var i = 0; i < 5; i++) { // 5 暗像素
      data[i * 4] = 10; data[i * 4 + 1] = 10; data[i * 4 + 2] = 10; data[i * 4 + 3] = 255;
    }
    for (var j = 5; j < 10; j++) { // 5 亮像素
      data[j * 4] = 240; data[j * 4 + 1] = 240; data[j * 4 + 2] = 240; data[j * 4 + 3] = 255;
    }
    var result = Core.isGoodExposure(data);
    expect(result.good).toBe(true);
  });
});

// ============================================================================
// 集成测试: handleStartError (通过 _test 钩子)
// ============================================================================
describe('handleStartError 集成', () => {
  beforeEach(() => {
    global.showMessage.mockClear();
    Core._test.resetState();
  });

  test('场景 B: NotAllowedError → 显示权限被拒绝提示', () => {
    var err = new Error('Permission denied');
    err.name = 'NotAllowedError';
    Core._test.handleStartError(err);
    expect(global.showMessage).toHaveBeenCalledTimes(1);
    expect(global.showMessage.mock.calls[0][0]).toContain('权限');
    expect(global.showMessage.mock.calls[0][1]).toBe('error');
  });

  test('NotFoundError → 显示未检测到摄像头提示', () => {
    var err = new Error('not found');
    err.name = 'NotFoundError';
    Core._test.handleStartError(err);
    expect(global.showMessage).toHaveBeenCalledTimes(1);
    expect(global.showMessage.mock.calls[0][0]).toContain('未检测');
  });

  test('NotReadableError → 显示摄像头被占用提示', () => {
    var err = new Error('busy');
    err.name = 'NotReadableError';
    Core._test.handleStartError(err);
    expect(global.showMessage.mock.calls[0][0]).toContain('占用');
  });

  test('未知错误 → 显示启动失败提示', () => {
    Core._test.handleStartError(new Error('unknown'));
    expect(global.showMessage.mock.calls[0][0]).toContain('启动失败');
  });
});

// ============================================================================
// 集成测试: toggleCamera
// ============================================================================
describe('toggleCamera 集成', () => {
  beforeEach(() => {
    global.showMessage.mockClear();
    localStorage.clear();
  });

  test('启用 → localStorage 写入 true + showMessage', () => {
    localStorage.setItem('ENABLE_CAMERA_SCANNER', 'false');
    Core._test.toggleCamera();
    expect(localStorage.getItem('ENABLE_CAMERA_SCANNER')).toBe('true');
    expect(global.showMessage).toHaveBeenCalledTimes(1);
    expect(global.showMessage.mock.calls[0][1]).toBe('success');
  });

  test('禁用 → localStorage 写入 false + showMessage', () => {
    localStorage.setItem('ENABLE_CAMERA_SCANNER', 'true');
    Core._test.toggleCamera();
    expect(localStorage.getItem('ENABLE_CAMERA_SCANNER')).toBe('false');
    expect(global.showMessage).toHaveBeenCalledTimes(1);
    expect(global.showMessage.mock.calls[0][1]).toBe('info');
  });
});

// ============================================================================
// 集成测试: init
// ============================================================================
describe('init 集成', () => {
  test('无匹配输入框 → 安全返回 (不抛异常)', () => {
    expect(() => Core._test.init()).not.toThrow();
  });
});

// ============================================================================
// 集成测试: onRawScanResult (状态机委托验证)
// ============================================================================
describe('onRawScanResult 集成', () => {
  beforeEach(() => {
    Core._test.resetState();
    mockStop.mockClear();
  });

  test('单帧不触发回调', () => {
    Core._test.onRawScanResult('ABC');
    var state = Core._test.getState();
    expect(state.hasScanned).toBe(false);
    expect(state.confirmBuffer).toEqual(['ABC']);
  });

  test('连续 2 帧相同 → 触发 onScanSuccess (hasScanned=true)', () => {
    // 需要设置 targetInput 以避免 onScanSuccess 中 targetInput 为 null 报错
    var input = document.createElement('input');
    input.id = 'scanInput';
    document.body.appendChild(input);

    // 注入 mock scanner 使 safeStop 不报错
    Core._test.resetState();

    Core._test.onRawScanResult('ABC');
    Core._test.onRawScanResult('ABC');

    // safeStop 返回 Promise, hasScanned 在 onScanSuccess 开头设置
    var state = Core._test.getState();
    expect(state.hasScanned).toBe(true);

    document.body.removeChild(input);
  });
});

// ============================================================================
// 模块导出验证
// ============================================================================
describe('模块导出', () => {
  test('CameraFallbackCore 导出所有纯函数', () => {
    expect(typeof Core.checkFrameSimilarity).toBe('function');
    expect(typeof Core.updateScanSession).toBe('function');
    expect(typeof Core.classifyStartError).toBe('function');
    expect(typeof Core.detectPlatform).toBe('function');
    expect(typeof Core.buildScannerConfig).toBe('function');
    expect(typeof Core.isGoodExposure).toBe('function');
  });

  test('_test 钩子暴露内部函数', () => {
    expect(typeof Core._test.openScanner).toBe('function');
    expect(typeof Core._test.closeScanner).toBe('function');
    expect(typeof Core._test.handleStartError).toBe('function');
    expect(typeof Core._test.onRawScanResult).toBe('function');
    expect(typeof Core._test.toggleCamera).toBe('function');
    expect(typeof Core._test.init).toBe('function');
    expect(typeof Core._test.getState).toBe('function');
    expect(typeof Core._test.resetState).toBe('function');
  });
});

// ============================================================================
// 集成测试: injectStyles
// ============================================================================
describe('injectStyles 集成', () => {
  afterEach(() => {
    var style = document.getElementById('camera-fallback-styles');
    if (style) style.parentNode.removeChild(style);
  });

  test('注入样式到 head (首次)', () => {
    Core._test.injectStyles();
    var style = document.getElementById('camera-fallback-styles');
    expect(style).not.toBeNull();
    expect(style.tagName).toBe('STYLE');
    expect(style.textContent).toContain('camera-scan-btn');
    expect(style.textContent).toContain('camera-scanner-modal');
  });

  test('重复调用不创建多个 style (幂等)', () => {
    Core._test.injectStyles();
    Core._test.injectStyles();
    var styles = document.querySelectorAll('#camera-fallback-styles');
    expect(styles.length).toBe(1);
  });
});

// ============================================================================
// 集成测试: detectAllInputs
// ============================================================================
describe('detectAllInputs 集成', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('找到 scanInput', () => {
    var input = document.createElement('input');
    input.id = 'scanInput';
    document.body.appendChild(input);
    var result = Core._test.detectAllInputs();
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('scanInput');
  });

  test('找到多个输入框 (scanInput + fromBin)', () => {
    ['scanInput', 'fromBin'].forEach(function (id) {
      var input = document.createElement('input');
      input.id = id;
      document.body.appendChild(input);
    });
    var result = Core._test.detectAllInputs();
    expect(result.length).toBe(2);
  });

  test('无匹配时 fallback 到 .scan-input', () => {
    var input = document.createElement('input');
    input.className = 'scan-input';
    document.body.appendChild(input);
    var result = Core._test.detectAllInputs();
    expect(result.length).toBe(1);
  });

  test('无任何匹配 → 空数组', () => {
    var result = Core._test.detectAllInputs();
    expect(result.length).toBe(0);
  });
});

// ============================================================================
// 集成测试: showCameraButton / removeCameraButton
// ============================================================================
describe('showCameraButton / removeCameraButton 集成', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Core._test.resetState();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('为 scanInput 注入 📷 按钮', () => {
    var input = document.createElement('input');
    input.id = 'scanInput';
    document.body.appendChild(input);
    Core._test.showCameraButton();
    var btn = document.getElementById('cameraScanBtn_scanInput');
    expect(btn).not.toBeNull();
    expect(btn.classList.contains('camera-scan-btn')).toBe(true);
    // input 被包装
    var wrapper = input.parentNode;
    expect(wrapper.classList.contains('camera-input-wrapper')).toBe(true);
    expect(input.classList.contains('camera-enabled-input')).toBe(true);
  });

  test('重复调用不创建重复按钮', () => {
    var input = document.createElement('input');
    input.id = 'scanInput';
    document.body.appendChild(input);
    Core._test.showCameraButton();
    Core._test.showCameraButton();
    var btns = document.querySelectorAll('.camera-scan-btn');
    expect(btns.length).toBe(1);
  });

  test('为 flex 容器中的库位输入框注入按钮', () => {
    var container = document.createElement('div');
    container.style.display = 'flex';
    var input = document.createElement('input');
    input.id = 'fromBin';
    input.style.flex = '1';
    container.appendChild(input);
    document.body.appendChild(container);
    Core._test.showCameraButton();
    var wrapper = input.parentNode;
    expect(wrapper.classList.contains('camera-input-wrapper')).toBe(true);
    expect(wrapper.style.flex).toBe('1');
  });

  test('removeCameraButton 清理按钮和包装器', () => {
    var input = document.createElement('input');
    input.id = 'scanInput';
    document.body.appendChild(input);
    Core._test.showCameraButton();
    expect(document.querySelector('.camera-scan-btn')).not.toBeNull();
    Core._test.removeCameraButton();
    expect(document.querySelector('.camera-scan-btn')).toBeNull();
    expect(document.querySelector('.camera-input-wrapper')).toBeNull();
    expect(input.classList.contains('camera-enabled-input')).toBe(false);
  });
});

// ============================================================================
// 集成测试: createModal / removeModal
// ============================================================================
describe('createModal / removeModal 集成', () => {
  afterEach(() => {
    Core._test.removeModal();
  });

  test('创建 Modal DOM', () => {
    Core._test.createModal();
    var modal = document.getElementById('camera-scanner-modal');
    expect(modal).not.toBeNull();
    var region = document.getElementById('camera-scanner-region');
    expect(region).not.toBeNull();
    // 关闭按钮
    var btns = modal.querySelectorAll('.camera-btn');
    expect(btns.length).toBeGreaterThanOrEqual(1);
    // 缩放控制
    var zoomBar = document.getElementById('cameraZoomBar');
    expect(zoomBar).not.toBeNull();
    // 提示文字
    var hint = modal.querySelector('.camera-hint');
    expect(hint).not.toBeNull();
  });

  test('重复创建先移除旧 Modal', () => {
    Core._test.createModal();
    Core._test.createModal();
    var modals = document.querySelectorAll('#camera-scanner-modal');
    expect(modals.length).toBe(1);
  });

  test('removeModal 清理 DOM', () => {
    Core._test.createModal();
    Core._test.removeModal();
    expect(document.getElementById('camera-scanner-modal')).toBeNull();
  });
});

// ============================================================================
// 集成测试: openScanner (完整链路)
// ============================================================================
describe('openScanner 集成', () => {
  beforeEach(() => {
    Core._test.resetState();
    global.Html5Qrcode.mockClear();
    mockStart.mockClear();
    mockStop.mockClear();
    global.showMessage.mockClear();
    mockStart.mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    Core._test.removeModal();
  });

  test('Html5Qrcode 未定义 → 显示库未加载错误', () => {
    var saved = global.Html5Qrcode;
    delete global.Html5Qrcode;
    Core._test.openScanner();
    expect(global.showMessage).toHaveBeenCalledTimes(1);
    expect(global.showMessage.mock.calls[0][1]).toBe('error');
    global.Html5Qrcode = saved;
  });

  test('非 HTTPS 非 localhost → 显示 HTTPS 要求', () => {
    var origProtocol = window.location.protocol;
    var origHostname = window.location.hostname;
    // jsdom location 是只读的，用 defineProperty 覆写
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:', hostname: '192.168.1.100' },
      writable: true, configurable: true
    });
    Core._test.openScanner();
    expect(global.showMessage).toHaveBeenCalledTimes(1);
    expect(global.showMessage.mock.calls[0][0]).toContain('HTTPS');
    // 还原
    Object.defineProperty(window, 'location', {
      value: { protocol: origProtocol, hostname: origHostname || 'localhost' },
      writable: true, configurable: true
    });
  });

  test('正常启动 → 创建 Modal + 调用 scanner.start', async () => {
    Core._test.openScanner();
    // Modal 应被创建
    expect(document.getElementById('camera-scanner-modal')).not.toBeNull();
    // Html5Qrcode 应被实例化
    expect(global.Html5Qrcode).toHaveBeenCalled();
    // start 应被调用
    expect(mockStart).toHaveBeenCalledTimes(1);
    // flush microtask
    await Promise.resolve();
  });

  test('scanner.start 失败 → 调用 handleStartError', async () => {
    var err = new Error('camera denied');
    err.name = 'NotAllowedError';
    mockStart.mockImplementation(() => Promise.reject(err));
    Core._test.openScanner();
    // flush rejection
    await new Promise(r => setTimeout(r, 10));
    expect(global.showMessage).toHaveBeenCalled();
    expect(global.showMessage.mock.calls[0][0]).toContain('权限');
  });
});

// ============================================================================
// 集成测试: onScanSuccess
// ============================================================================
describe('onScanSuccess 集成', () => {
  beforeEach(() => {
    Core._test.resetState();
    mockStop.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('设置 targetInput 值并派发 Enter 事件 (物料扫码)', async () => {
    var input = document.createElement('input');
    input.id = 'scanInput';
    document.body.appendChild(input);
    var events = [];
    input.addEventListener('keydown', function (e) { events.push(e.key); });
    input.addEventListener('change', function () { events.push('change'); });

    Core._test.setTargetInput(input);
    Core._test.onScanSuccess('ITEM001');

    var state = Core._test.getState();
    expect(state.hasScanned).toBe(true);

    // flush safeStop promise
    await Promise.resolve();
    await Promise.resolve();

    expect(input.value).toBe('ITEM001');
    expect(events).toContain('Enter');
    expect(events).toContain('change');
  });

  test('库位输入框 → 派发 change+blur 而非 Enter', async () => {
    var input = document.createElement('input');
    input.id = 'fromBin';
    document.body.appendChild(input);
    var events = [];
    input.addEventListener('keydown', function (e) { events.push('keydown'); });
    input.addEventListener('change', function () { events.push('change'); });
    input.addEventListener('blur', function () { events.push('blur'); });

    Core._test.setTargetInput(input);
    Core._test.onScanSuccess('BIN-001');

    await Promise.resolve();
    await Promise.resolve();

    expect(input.value).toBe('BIN-001');
    expect(events).toContain('change');
    expect(events).toContain('blur');
    expect(events).not.toContain('keydown');
  });

  test('hasScanned=true 时不重复执行 (防抖)', async () => {
    var input = document.createElement('input');
    input.id = 'scanInput';
    document.body.appendChild(input);
    Core._test.setTargetInput(input);
    // 同步连续调用 — 模拟极短时间内双重触发 (promise 未解析前 hasScanned=true)
    Core._test.onScanSuccess('A');
    Core._test.onScanSuccess('B'); // hasScanned=true, 被防抖
    // 等待 safeStop promise 链解析
    await Promise.resolve();
    await Promise.resolve();
    expect(input.value).toBe('A'); // 只有 A 被写入
  });
});

// ============================================================================
// 集成测试: closeScanner
// ============================================================================
describe('closeScanner 集成', () => {
  beforeEach(() => {
    Core._test.resetState();
    mockStop.mockClear();
  });

  test('关闭后移除 Modal', async () => {
    Core._test.createModal();
    expect(document.getElementById('camera-scanner-modal')).not.toBeNull();
    Core._test.closeScanner();
    await Promise.resolve();
    expect(document.getElementById('camera-scanner-modal')).toBeNull();
  });
});

// ============================================================================
// 集成测试: safeStop
// ============================================================================
describe('safeStop 集成', () => {
  test('无 scanner → 直接 resolve', async () => {
    Core._test.resetState();
    await expect(Core._test.safeStop()).resolves.toBeUndefined();
  });

  test('有 scanner → 调用 stop()', async () => {
    mockStop.mockClear();
    Core._test.setScanner({ stop: mockStop });
    await Core._test.safeStop();
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  test('stop 失败 → 静默吞没', async () => {
    Core._test.setScanner({ stop: jest.fn(() => Promise.reject(new Error('fail'))) });
    await expect(Core._test.safeStop()).resolves.toBeUndefined();
  });
});

// ============================================================================
// 集成测试: _getNativeTrack
// ============================================================================
describe('_getNativeTrack 集成', () => {
  afterEach(() => {
    Core._test.removeModal();
  });

  test('无 video 元素 → 返回 null', () => {
    expect(Core._test._getNativeTrack()).toBeNull();
  });

  test('有 video + srcObject → 返回 track', () => {
    Core._test.createModal();
    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    var mockTrack = { kind: 'video', applyConstraints: jest.fn() };
    video.srcObject = { getVideoTracks: () => [mockTrack] };
    region.appendChild(video);
    expect(Core._test._getNativeTrack()).toBe(mockTrack);
  });
});

// ============================================================================
// 集成测试: detectTorch
// ============================================================================
describe('detectTorch 集成', () => {
  afterEach(() => {
    Core._test.removeModal();
  });

  test('有 torch 能力 → 显示闪光灯按钮', () => {
    Core._test.createModal();
    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    var mockTrack = {
      getCapabilities: () => ({ torch: true, zoom: { min: 1, max: 5, step: 0.5 } })
    };
    video.srcObject = { getVideoTracks: () => [mockTrack] };
    region.appendChild(video);
    Core._test.detectTorch();
    var torchBtn = document.getElementById('cameraTorchBtn');
    expect(torchBtn.style.display).toBe('inline-block');
    // zoom bar 也应显示
    var zoomBar = document.getElementById('cameraZoomBar');
    expect(zoomBar.style.display).toBe('flex');
  });

  test('无 track → 静默返回', () => {
    expect(() => Core._test.detectTorch()).not.toThrow();
  });
});

// ============================================================================
// 集成测试: adjustZoom / updateZoomLabel
// ============================================================================
describe('adjustZoom / updateZoomLabel 集成', () => {
  afterEach(() => {
    Core._test.removeModal();
  });

  test('updateZoomLabel 更新文本', () => {
    Core._test.createModal();
    Core._test.resetState();
    Core._test.updateZoomLabel();
    var label = document.getElementById('cameraZoomLabel');
    expect(label.textContent).toBe('1.0x');
  });

  test('zoomMax <= zoomMin → 不操作', () => {
    Core._test.resetState(); // zoomMax=1, zoomMin=1
    expect(() => Core._test.adjustZoom(0.5)).not.toThrow();
  });
});

// ============================================================================
// 集成测试: toggleTorch
// ============================================================================
describe('toggleTorch 集成', () => {
  beforeEach(() => {
    global.showMessage.mockClear();
  });

  afterEach(() => {
    Core._test.removeModal();
  });

  test('无 track → 显示不支持提示', () => {
    Core._test.toggleTorch();
    expect(global.showMessage).toHaveBeenCalledTimes(1);
    expect(global.showMessage.mock.calls[0][1]).toBe('warning');
  });

  test('有 torch 能力 → 切换状态', () => {
    Core._test.createModal();
    Core._test.resetState();
    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    var mockApply = jest.fn();
    var mockTrack = {
      getCapabilities: () => ({ torch: true }),
      applyConstraints: mockApply
    };
    video.srcObject = { getVideoTracks: () => [mockTrack] };
    region.appendChild(video);
    Core._test.toggleTorch();
    expect(mockApply).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    var state = Core._test.getState();
    expect(state.isTorchOn).toBe(true);
    // 再切换一次
    Core._test.toggleTorch();
    expect(mockApply).toHaveBeenCalledWith({ advanced: [{ torch: false }] });
  });

  test('无 torch 能力 → 显示不支持', () => {
    Core._test.createModal();
    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    var mockTrack = {
      getCapabilities: () => ({ torch: false }),
      applyConstraints: jest.fn()
    };
    video.srcObject = { getVideoTracks: () => [mockTrack] };
    region.appendChild(video);
    Core._test.toggleTorch();
    expect(global.showMessage).toHaveBeenCalled();
    expect(global.showMessage.mock.calls[0][1]).toBe('warning');
  });
});

// ============================================================================
// 集成测试: setupEasterEgg
// ============================================================================
describe('setupEasterEgg 集成', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  test('无 .header-nav h1 → 安全返回', () => {
    expect(() => Core._test.setupEasterEgg()).not.toThrow();
  });

  test('5 次快速点击 → 切换摄像头模式', () => {
    global.showMessage.mockClear();
    var nav = document.createElement('div');
    nav.className = 'header-nav';
    var h1 = document.createElement('h1');
    h1.textContent = 'WMS';
    nav.appendChild(h1);
    document.body.appendChild(nav);
    Core._test.setupEasterEgg();
    // 模拟 5 次点击
    for (var i = 0; i < 5; i++) {
      h1.click();
    }
    expect(global.showMessage).toHaveBeenCalled();
  });
});

// ============================================================================
// 集成测试: observeCardVisibility
// ============================================================================
describe('observeCardVisibility 集成', () => {
  test('调用不抛异常', () => {
    expect(() => Core._test.observeCardVisibility()).not.toThrow();
  });
});

// ============================================================================
// 集成测试: init (有输入框场景)
// ============================================================================
describe('init 有输入框场景', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    // 清理注入的 style
    var style = document.getElementById('camera-fallback-styles');
    if (style) style.parentNode.removeChild(style);
  });

  test('有 scanInput 时完整初始化', () => {
    var input = document.createElement('input');
    input.id = 'scanInput';
    document.body.appendChild(input);
    Core._test.init();
    // 应注入样式
    expect(document.getElementById('camera-fallback-styles')).not.toBeNull();
  });

  test('localStorage 已启用 → 自动显示按钮', () => {
    var input = document.createElement('input');
    input.id = 'scanInput';
    document.body.appendChild(input);
    localStorage.setItem('ENABLE_CAMERA_SCANNER', 'true');
    Core._test.init();
    var btn = document.getElementById('cameraScanBtn_scanInput');
    expect(btn).not.toBeNull();
  });
});

// ============================================================================
// 纯函数测试: captureHighResFrame
// ============================================================================
describe('captureHighResFrame', () => {
  test('canvas 兜底 — 返回 File 对象', async () => {
    // 模拟 video 元素
    var video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { value: 640 });
    Object.defineProperty(video, 'videoHeight', { value: 480 });

    // jsdom 不完全支持 canvas，mock getContext
    var mockDrawImage = jest.fn();
    var origCreate = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation(function (tag) {
      var el = origCreate(tag);
      if (tag === 'canvas') {
        el.getContext = jest.fn(() => ({ drawImage: mockDrawImage }));
        el.toBlob = jest.fn(function (cb) {
          cb(new Blob(['fake'], { type: 'image/png' }));
        });
      }
      return el;
    });

    var file = await Core.captureHighResFrame(video, null);
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('capture.png');
    expect(file.type).toBe('image/png');
    expect(mockDrawImage).toHaveBeenCalledWith(video, 0, 0);

    document.createElement.mockRestore();
  });

  test('ImageCapture 可用时优先使用 takePhoto', async () => {
    var video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { value: 640 });
    Object.defineProperty(video, 'videoHeight', { value: 480 });

    var fakeBlob = new Blob(['hi-res'], { type: 'image/jpeg' });
    var mockTakePhoto = jest.fn(() => Promise.resolve(fakeBlob));
    global.ImageCapture = jest.fn(function () {
      this.takePhoto = mockTakePhoto;
    });

    var mockTrack = { id: 'track1' };
    var file = await Core.captureHighResFrame(video, mockTrack);
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('capture.jpg');
    expect(file.type).toBe('image/jpeg');
    expect(global.ImageCapture).toHaveBeenCalledWith(mockTrack);

    delete global.ImageCapture;
  });

  test('ImageCapture.takePhoto 失败时降级到 canvas', async () => {
    var video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { value: 640 });
    Object.defineProperty(video, 'videoHeight', { value: 480 });

    // ImageCapture 构造函数抛异常
    global.ImageCapture = jest.fn(function () {
      throw new Error('not supported');
    });

    var origCreate = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation(function (tag) {
      var el = origCreate(tag);
      if (tag === 'canvas') {
        el.getContext = jest.fn(() => ({ drawImage: jest.fn() }));
        el.toBlob = jest.fn(function (cb) {
          cb(new Blob(['fallback'], { type: 'image/png' }));
        });
      }
      return el;
    });

    var file = await Core.captureHighResFrame(video, { id: 'track' });
    expect(file.name).toBe('capture.png');

    delete global.ImageCapture;
    document.createElement.mockRestore();
  });
});

// ============================================================================
// 集成测试: captureAndDecode
// ============================================================================
describe('captureAndDecode', () => {
  var origGetContext;
  beforeEach(() => {
    document.body.innerHTML = '';
    Core._test.resetState();
    mockPause.mockClear();
    mockResume.mockClear();
    mockScanFile.mockClear();
    mockClear.mockClear();
    global.showMessage.mockClear();
    global.Html5Qrcode.mockClear();
    // jsdom 不支持 canvas.getContext('2d') — 全局 mock
    origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = jest.fn(function () {
      return { drawImage: jest.fn() };
    });
    HTMLCanvasElement.prototype.toBlob = jest.fn(function (cb) {
      cb(new Blob(['test'], { type: 'image/png' }));
    });
  });
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = origGetContext;
    delete HTMLCanvasElement.prototype.toBlob;
  });

  test('hasScanned=true 时不执行', () => {
    // 先设 hasScanned
    var input = document.createElement('input');
    input.id = 'scanInput';
    document.body.appendChild(input);
    Core._test.setTargetInput(input);
    Core._test.onScanSuccess('X'); // sets hasScanned=true
    var state = Core._test.getState();
    expect(state.hasScanned).toBe(true);
    // captureAndDecode 应直接返回
    Core._test.captureAndDecode();
    expect(state._isCapturing).toBeFalsy();
  });

  test('_isCapturing=true 时不重复执行', async () => {
    // 设置 scanner 和 modal
    var mockScanner = { pause: jest.fn(), resume: jest.fn(), stop: jest.fn(() => Promise.resolve()) };
    Core._test.setScanner(mockScanner);
    Core._test.createModal();

    // 创建 video 元素
    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { value: 640 });
    Object.defineProperty(video, 'videoHeight', { value: 480 });
    region.appendChild(video);

    // 第一次调用
    Core._test.captureAndDecode();
    var state1 = Core._test.getState();
    expect(state1._isCapturing).toBe(true);

    // 第二次调用 — 应该被拦截
    var pauseCountBefore = mockScanner.pause.mock.calls.length;
    Core._test.captureAndDecode();
    // pause 不应被再次调用
    expect(mockScanner.pause.mock.calls.length).toBe(pauseCountBefore);
  });

  test('无 video 元素时恢复并提示', () => {
    var mockScanner = { pause: jest.fn(), resume: jest.fn(), stop: jest.fn(() => Promise.resolve()) };
    Core._test.setScanner(mockScanner);
    Core._test.createModal();
    // 不创建 video — region 内为空

    Core._test.captureAndDecode();
    // 应恢复 _isCapturing
    var state = Core._test.getState();
    expect(state._isCapturing).toBe(false);
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('未识别'),
      'warning'
    );
  });

  test('快门闪白 DOM 元素被创建', () => {
    var mockScanner = { pause: jest.fn(), resume: jest.fn(), stop: jest.fn(() => Promise.resolve()) };
    Core._test.setScanner(mockScanner);
    Core._test.createModal();

    // 添加 video
    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { value: 640 });
    Object.defineProperty(video, 'videoHeight', { value: 480 });
    region.appendChild(video);

    Core._test.captureAndDecode();
    var flash = document.getElementById('camera-capture-flash');
    expect(flash).not.toBeNull();
  });

  test('hint 文字切换为解析中', () => {
    var mockScanner = { pause: jest.fn(), resume: jest.fn(), stop: jest.fn(() => Promise.resolve()) };
    Core._test.setScanner(mockScanner);
    Core._test.createModal();

    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { value: 640 });
    Object.defineProperty(video, 'videoHeight', { value: 480 });
    region.appendChild(video);

    var hint = document.querySelector('.camera-hint');
    expect(hint.textContent).not.toBe('解析中...');

    Core._test.captureAndDecode();
    expect(hint.textContent).toBe('解析中...');
  });
});
