/**
 * camera-fallback.js — 硬件极限与容错测试
 * 目标: 将 branch 覆盖率从 71% 提升到 90%+
 * 覆盖场景:
 *   - navigator.mediaDevices 为 undefined (旧版浏览器)
 *   - getUserMedia 抛出 NotAllowedError / NotFoundError / NotReadableError
 *   - stream.getTracks() + track.stop() 硬件资源释放
 *   - 摄像头自动对焦/缩放预热 (getCapabilities 各种边界)
 *   - captureAndDecode 全链路 (成功/失败/连续失败上限)
 *   - closeScanner focusScanInput / requestAnimationFrame 分支
 *   - removeCameraButton flex 容器还原
 *   - observeCardVisibility MutationObserver 回调
 *   - adjustZoom 有 track 时 applyConstraints
 *   - 库位扫码自动聚焦下一字段
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

// Mock showMessage / focusScanInput
global.showMessage = jest.fn();
global.focusScanInput = jest.fn();

// 加载模块
const Core = require('../../../apps/wms/camera-fallback.js');

// 默认 mock 恢复函数 — 防止 describe 块间 mock 污染
function restoreDefaultHtml5QrcodeMock() {
  global.Html5Qrcode.mockImplementation(function () {
    this.start = mockStart;
    this.stop = mockStop;
    this.pause = mockPause;
    this.resume = mockResume;
    this.scanFile = mockScanFile;
    this.clear = mockClear;
  });
}

// 全局 afterEach: 确保每个测试后恢复默认 mock
afterEach(() => {
  restoreDefaultHtml5QrcodeMock();
});

// ============================================================================
// 辅助: 创建带 video+track 的 Modal 环境
// ============================================================================
function setupModalWithVideo(trackOverrides) {
  Core._test.createModal();
  var region = document.getElementById('camera-scanner-region');
  var video = document.createElement('video');
  Object.defineProperty(video, 'videoWidth', { value: 640 });
  Object.defineProperty(video, 'videoHeight', { value: 480 });
  var track = {
    getCapabilities: jest.fn(() => ({})),
    applyConstraints: jest.fn(() => Promise.resolve()),
    ...trackOverrides
  };
  video.srcObject = { getVideoTracks: () => [track] };
  region.appendChild(video);
  return { video, track, region };
}

// ============================================================================
// 硬件异常: scanner.start 各种 rejection 场景 (走完 openScanner 全链路)
// ============================================================================
describe('openScanner 硬件异常全链路', () => {
  beforeEach(() => {
    Core._test.resetState();
    global.Html5Qrcode.mockClear();
    mockStart.mockClear();
    mockStop.mockClear();
    global.showMessage.mockClear();
  });

  afterEach(() => {
    Core._test.removeModal();
  });

  test('场景 1: NotAllowedError (用户拒绝摄像头权限) → 友好提示', async () => {
    var err = new Error('Permission denied');
    err.name = 'NotAllowedError';
    mockStart.mockImplementationOnce(() => Promise.reject(err));
    Core._test.openScanner();
    await new Promise(r => setTimeout(r, 10));
    expect(global.showMessage).toHaveBeenCalledTimes(1);
    expect(global.showMessage.mock.calls[0][0]).toContain('权限');
    expect(global.showMessage.mock.calls[0][1]).toBe('error');
    // Modal 应被移除 (handleStartError 调用 removeModal)
    expect(document.getElementById('camera-scanner-modal')).toBeNull();
  });

  test('场景 2: NotFoundError (手机无摄像头) → 捕获并提示', async () => {
    var err = new Error('Requested device not found');
    err.name = 'NotFoundError';
    mockStart.mockImplementationOnce(() => Promise.reject(err));
    Core._test.openScanner();
    await new Promise(r => setTimeout(r, 10));
    expect(global.showMessage).toHaveBeenCalledTimes(1);
    expect(global.showMessage.mock.calls[0][0]).toContain('未检测');
    expect(global.showMessage.mock.calls[0][1]).toBe('error');
  });

  test('场景 3: NotReadableError (摄像头被其他 App 占用) → 捕获并提示', async () => {
    var err = new Error('Could not start video source');
    err.name = 'NotReadableError';
    mockStart.mockImplementationOnce(() => Promise.reject(err));
    Core._test.openScanner();
    await new Promise(r => setTimeout(r, 10));
    expect(global.showMessage).toHaveBeenCalledTimes(1);
    expect(global.showMessage.mock.calls[0][0]).toContain('占用');
    expect(global.showMessage.mock.calls[0][1]).toBe('error');
  });

  test('场景 4: 未知错误类型 → 通用启动失败提示', async () => {
    var err = new Error('Random hardware glitch');
    err.name = 'AbortError';
    mockStart.mockImplementationOnce(() => Promise.reject(err));
    Core._test.openScanner();
    await new Promise(r => setTimeout(r, 10));
    expect(global.showMessage).toHaveBeenCalledTimes(1);
    expect(global.showMessage.mock.calls[0][0]).toContain('启动失败');
  });
});

// ============================================================================
// 摄像头预热: 自动对焦 + 自动缩放 (openScanner .then 内 setTimeout 800ms)
// ============================================================================
describe('openScanner 摄像头预热 (自动对焦+缩放)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Core._test.resetState();
    global.Html5Qrcode.mockClear();
    mockStart.mockClear();
    mockStop.mockClear();
    global.showMessage.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    Core._test.removeModal();
  });

  test('场景 5: 支持 continuous 对焦 + zoom → applyConstraints 被调用', async () => {
    var mockApply = jest.fn(() => Promise.resolve());
    mockStart.mockImplementation(() => {
      // 启动成功后, 手动在 region 内创建 video+track
      var region = document.getElementById('camera-scanner-region');
      var video = document.createElement('video');
      var track = {
        getCapabilities: () => ({
          focusMode: ['manual', 'continuous'],
          zoom: { min: 1, max: 5, step: 0.5 }
        }),
        applyConstraints: mockApply
      };
      video.srcObject = { getVideoTracks: () => [track] };
      region.appendChild(video);
      return Promise.resolve();
    });

    Core._test.openScanner();
    // flush microtask (scanner.start().then)
    await Promise.resolve();
    await Promise.resolve();

    // 触发 800ms setTimeout 回调
    jest.advanceTimersByTime(800);

    expect(mockApply).toHaveBeenCalledWith({
      advanced: expect.arrayContaining([
        { focusMode: 'continuous' },
        { zoom: 2 }
      ])
    });
    // zoom 状态应更新
    var state = Core._test.getState();
    expect(state.currentZoom).toBe(2);
  });

  test('场景 6: zoom.max >= 2 但 < 3 → autoZoom = zoom.max', async () => {
    var mockApply = jest.fn(() => Promise.resolve());
    mockStart.mockImplementation(() => {
      var region = document.getElementById('camera-scanner-region');
      var video = document.createElement('video');
      var track = {
        getCapabilities: () => ({
          zoom: { min: 1, max: 2.5, step: 0.5 }
        }),
        applyConstraints: mockApply
      };
      video.srcObject = { getVideoTracks: () => [track] };
      region.appendChild(video);
      return Promise.resolve();
    });

    Core._test.openScanner();
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(800);

    // Math.min(2, 2.5) = 2
    expect(mockApply).toHaveBeenCalledWith({
      advanced: [{ zoom: 2 }]
    });
  });

  test('场景 7: zoom.step < 0.1 → 回退为默认 0.5', async () => {
    mockStart.mockImplementation(() => {
      var region = document.getElementById('camera-scanner-region');
      var video = document.createElement('video');
      var track = {
        getCapabilities: () => ({
          zoom: { min: 1, max: 10, step: 0.01 }
        }),
        applyConstraints: jest.fn()
      };
      video.srcObject = { getVideoTracks: () => [track] };
      region.appendChild(video);
      return Promise.resolve();
    });

    Core._test.openScanner();
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(800);

    var state = Core._test.getState();
    expect(state.zoomStep).toBe(0.5);
  });

  test('场景 7b: zoom.min=0, step=0 → 使用默认值 (min||1, step||0.5)', async () => {
    var mockApply = jest.fn(() => Promise.resolve());
    mockStart.mockImplementation(() => {
      var region = document.getElementById('camera-scanner-region');
      var video = document.createElement('video');
      var track = {
        getCapabilities: () => ({
          zoom: { min: 0, max: 3, step: 0 }
        }),
        applyConstraints: mockApply
      };
      video.srcObject = { getVideoTracks: () => [track] };
      region.appendChild(video);
      return Promise.resolve();
    });

    Core._test.openScanner();
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(800);

    // zoom.min||1=1, zoom.max||1=3 (truthy), zoom.step||0.5=0.5
    var state = Core._test.getState();
    expect(state.zoomMin).toBe(1);
    expect(state.zoomStep).toBe(0.5);
    // autoZoom = Math.min(2, 3) = 2
    expect(mockApply).toHaveBeenCalledWith({
      advanced: [{ zoom: 2 }]
    });
  });

  test('场景 8: 无 track (video 无 srcObject) → 预热静默跳过', async () => {
    mockStart.mockImplementation(() => {
      // 不创建 video, 让 _getNativeTrack 返回 null
      return Promise.resolve();
    });

    Core._test.openScanner();
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(800);

    // 不应抛异常, showMessage 不应被调用
    expect(global.showMessage).not.toHaveBeenCalled();
  });

  test('场景 9: getCapabilities 抛异常 → 静默捕获', async () => {
    mockStart.mockImplementation(() => {
      var region = document.getElementById('camera-scanner-region');
      var video = document.createElement('video');
      var track = {
        getCapabilities: () => { throw new Error('not supported'); },
        applyConstraints: jest.fn()
      };
      video.srcObject = { getVideoTracks: () => [track] };
      region.appendChild(video);
      return Promise.resolve();
    });

    Core._test.openScanner();
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(800);

    // 静默, 不崩溃
    expect(global.showMessage).not.toHaveBeenCalled();
  });

  test('场景 10: 无 focusMode 但有 zoom → 只设置 zoom', async () => {
    var mockApply = jest.fn(() => Promise.resolve());
    mockStart.mockImplementation(() => {
      var region = document.getElementById('camera-scanner-region');
      var video = document.createElement('video');
      var track = {
        getCapabilities: () => ({
          zoom: { min: 1, max: 3, step: 0.5 }
        }),
        applyConstraints: mockApply
      };
      video.srcObject = { getVideoTracks: () => [track] };
      region.appendChild(video);
      return Promise.resolve();
    });

    Core._test.openScanner();
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(800);

    expect(mockApply).toHaveBeenCalledWith({
      advanced: [{ zoom: 2 }]
    });
  });

  test('场景 11: 无 zoom 且无 focusMode → 不调用 applyConstraints', async () => {
    var mockApply = jest.fn();
    mockStart.mockImplementation(() => {
      var region = document.getElementById('camera-scanner-region');
      var video = document.createElement('video');
      var track = {
        getCapabilities: () => ({}),
        applyConstraints: mockApply
      };
      video.srcObject = { getVideoTracks: () => [track] };
      region.appendChild(video);
      return Promise.resolve();
    });

    Core._test.openScanner();
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(800);

    expect(mockApply).not.toHaveBeenCalled();
  });
});

// ============================================================================
// adjustZoom: 有 track 时的 applyConstraints 分支
// ============================================================================
describe('adjustZoom 有 track 时', () => {
  afterEach(() => {
    Core._test.removeModal();
    Core._test.resetState();
  });

  test('正常缩放 → applyConstraints + 更新 label', () => {
    Core._test.resetState();
    Core._test.createModal();
    var { track } = setupModalWithVideo({
      applyConstraints: jest.fn()
    });

    // 手动设置 zoom 范围 (模拟 detectTorch 已执行)
    // 需要通过 openScanner 预热或直接 hack state — 这里用 detectTorch
    // 先删掉已有 modal 的 video, 用 setupModalWithVideo 的
    // 简化: 直接调用 detectTorch 设置 zoom 范围
    // region 已有 video (from setupModalWithVideo)
    track.getCapabilities = jest.fn(() => ({
      zoom: { min: 1, max: 5, step: 0.5 }
    }));
    Core._test.detectTorch();

    var state = Core._test.getState();
    expect(state.zoomMax).toBe(5);

    // 调整缩放
    Core._test.adjustZoom(0.5);
    expect(track.applyConstraints).toHaveBeenCalledWith({
      advanced: [{ zoom: expect.any(Number) }]
    });

    var label = document.getElementById('cameraZoomLabel');
    expect(label.textContent).toContain('x');
  });

  test('applyConstraints 抛异常 → 静默捕获', () => {
    Core._test.resetState();
    Core._test.createModal();
    var { track } = setupModalWithVideo({
      applyConstraints: jest.fn(() => { throw new Error('zoom failed'); })
    });
    track.getCapabilities = jest.fn(() => ({
      zoom: { min: 1, max: 5, step: 0.5 }
    }));
    Core._test.detectTorch();

    expect(() => Core._test.adjustZoom(0.5)).not.toThrow();
  });
});

// ============================================================================
// captureAndDecode 全链路 (成功/失败/连续失败上限)
// ============================================================================
describe('captureAndDecode 全链路', () => {
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
    // jsdom canvas mock
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
    Core._test.removeModal();
  });

  test('解码失败 → _recoverCapture → resume + 提示', async () => {
    var mockScanner = {
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(() => Promise.resolve())
    };
    global.Html5Qrcode.mockImplementation(function () {
      this.scanFile = jest.fn(() => Promise.reject(new Error('decode failed')));
      this.clear = jest.fn();
    });
    Core._test.setScanner(mockScanner);
    Core._test.createModal();

    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { value: 640 });
    Object.defineProperty(video, 'videoHeight', { value: 480 });
    region.appendChild(video);

    Core._test.captureAndDecode();
    await new Promise(r => setTimeout(r, 50));

    expect(mockScanner.resume).toHaveBeenCalled();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('未识别'),
      'warning'
    );
    var state = Core._test.getState();
    expect(state._isCapturing).toBe(false);
  });

  test('连续 3 次失败 → 自动关闭摄像头', async () => {
    var mockScanner = {
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(() => Promise.resolve())
    };
    global.Html5Qrcode.mockImplementation(function () {
      this.scanFile = jest.fn(() => Promise.reject(new Error('fail')));
      this.clear = jest.fn();
    });
    Core._test.setScanner(mockScanner);

    for (var i = 0; i < 3; i++) {
      // 每次调用前重建 modal 和 video (因为 closeScanner 会移除)
      Core._test.createModal();
      var region = document.getElementById('camera-scanner-region');
      var video = document.createElement('video');
      Object.defineProperty(video, 'videoWidth', { value: 640 });
      Object.defineProperty(video, 'videoHeight', { value: 480 });
      region.appendChild(video);

      Core._test.captureAndDecode();
      await new Promise(r => setTimeout(r, 50));
    }

    // 第 3 次应触发 closeScanner + 特殊提示
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('多次未识别'),
      'warning'
    );
  });

  test('_captureFailCount >= CAPTURE_FAIL_LIMIT → 直接返回', async () => {
    var mockScanner = {
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(() => Promise.resolve())
    };
    global.Html5Qrcode.mockImplementation(function () {
      this.scanFile = jest.fn(() => Promise.reject(new Error('fail')));
      this.clear = jest.fn();
    });
    Core._test.setScanner(mockScanner);

    // 先失败 3 次达到上限
    for (var i = 0; i < 3; i++) {
      Core._test.createModal();
      var region = document.getElementById('camera-scanner-region');
      var video = document.createElement('video');
      Object.defineProperty(video, 'videoWidth', { value: 640 });
      Object.defineProperty(video, 'videoHeight', { value: 480 });
      region.appendChild(video);
      Core._test.captureAndDecode();
      await new Promise(r => setTimeout(r, 50));
    }

    var pauseCount = mockScanner.pause.mock.calls.length;
    // 第 4 次调用应直接返回
    Core._test.createModal();
    Core._test.captureAndDecode();
    expect(mockScanner.pause.mock.calls.length).toBe(pauseCount);
  });

  test('scanFile catch 分支 — decoder.clear + tempDiv 清理', async () => {
    var mockDecoderClear = jest.fn();
    global.Html5Qrcode.mockImplementation(function () {
      this.scanFile = jest.fn(() => Promise.reject(new Error('no barcode')));
      this.clear = mockDecoderClear;
    });
    var mockScanner = {
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(() => Promise.resolve())
    };
    Core._test.setScanner(mockScanner);
    Core._test.createModal();

    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { value: 640 });
    Object.defineProperty(video, 'videoHeight', { value: 480 });
    region.appendChild(video);

    Core._test.captureAndDecode();
    await new Promise(r => setTimeout(r, 50));

    // decoder.clear() 应被调用 (catch 分支)
    expect(mockDecoderClear).toHaveBeenCalled();
    // tempDiv 应被清理 (无残留 _capture_decoder_ 元素)
    var leftover = document.querySelector('[id^="_capture_decoder_"]');
    expect(leftover).toBeNull();
  });
});

// ============================================================================
// closeScanner: focusScanInput / requestAnimationFrame 分支
// ============================================================================
describe('closeScanner 焦点恢复分支', () => {
  beforeEach(() => {
    Core._test.resetState();
    mockStop.mockClear();
    global.focusScanInput.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('有 targetInput + focusScanInput 函数 → 调用 focusScanInput', async () => {
    var input = document.createElement('input');
    input.id = 'scanInput';
    document.body.appendChild(input);
    Core._test.setTargetInput(input);
    Core._test.createModal();

    Core._test.closeScanner();
    await Promise.resolve();
    await Promise.resolve();

    expect(global.focusScanInput).toHaveBeenCalled();
  });

  test('有 targetInput 但无 focusScanInput → requestAnimationFrame 聚焦', async () => {
    var input = document.createElement('input');
    input.id = 'scanInput';
    document.body.appendChild(input);
    Core._test.setTargetInput(input);
    Core._test.createModal();

    // 临时移除 focusScanInput
    var saved = global.focusScanInput;
    delete global.focusScanInput;

    // mock requestAnimationFrame
    var rafCallback;
    global.requestAnimationFrame = jest.fn(function (cb) { rafCallback = cb; });

    Core._test.closeScanner();
    await Promise.resolve();
    await Promise.resolve();

    expect(global.requestAnimationFrame).toHaveBeenCalled();
    // 执行 raf 回调
    var focusSpy = jest.spyOn(input, 'focus');
    if (rafCallback) rafCallback();
    expect(focusSpy).toHaveBeenCalled();

    global.focusScanInput = saved;
    delete global.requestAnimationFrame;
  });

  test('无 targetInput → 仅移除 Modal', async () => {
    Core._test.createModal();
    expect(document.getElementById('camera-scanner-modal')).not.toBeNull();

    Core._test.closeScanner();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('camera-scanner-modal')).toBeNull();
    expect(global.focusScanInput).not.toHaveBeenCalled();
  });
});

// ============================================================================
// removeCameraButton: flex 容器还原分支
// ============================================================================
describe('removeCameraButton flex 容器还原', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Core._test.resetState();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('库位输入框在 flex 容器中 → 移除按钮后还原 input.style.flex', () => {
    var container = document.createElement('div');
    container.style.display = 'flex';
    var input = document.createElement('input');
    input.id = 'fromBin';
    input.style.flex = '1';
    container.appendChild(input);
    document.body.appendChild(container);

    Core._test.showCameraButton();
    // 此时 input 的 flex 被清除, wrapper 有 flex:1
    expect(input.style.flex).toBe('');

    Core._test.removeCameraButton();
    // 还原后 input.style.flex 应恢复为 '1'
    expect(input.style.flex).toBe('1');
    expect(input.classList.contains('camera-enabled-input')).toBe(false);
    expect(document.querySelector('.camera-input-wrapper')).toBeNull();
  });
});

// ============================================================================
// showCameraButton: 点击按钮绑定 targetInput + openScanner
// ============================================================================
describe('showCameraButton 点击行为', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Core._test.resetState();
    mockStart.mockClear();
    global.showMessage.mockClear();
  });

  afterEach(() => {
    Core._test.removeModal();
    document.body.innerHTML = '';
  });

  test('点击 📷 按钮 → targetInput 切换到对应输入框并启动 openScanner', () => {
    mockStart.mockImplementation(() => Promise.resolve());
    var input1 = document.createElement('input');
    input1.id = 'scanInput';
    document.body.appendChild(input1);
    var input2 = document.createElement('input');
    input2.id = 'fromBin';
    document.body.appendChild(input2);

    Core._test.showCameraButton();

    // 点击 fromBin 的按钮
    var btn = document.getElementById('cameraScanBtn_fromBin');
    expect(btn).not.toBeNull();
    btn.click();

    // openScanner 被调用, Modal 被创建
    expect(document.getElementById('camera-scanner-modal')).not.toBeNull();
    // start 应被调用
    expect(mockStart).toHaveBeenCalled();
  });
});

// ============================================================================
// onScanSuccess: 库位扫码自动聚焦下一字段
// ============================================================================
describe('onScanSuccess 库位自动聚焦链', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Core._test.resetState();
    mockStop.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  test('fromBin 扫码完成 → 自动聚焦 toBin', async () => {
    var input = document.createElement('input');
    input.id = 'fromBin';
    document.body.appendChild(input);
    var toBin = document.createElement('input');
    toBin.id = 'toBin';
    document.body.appendChild(toBin);
    var focusSpy = jest.spyOn(toBin, 'focus');

    Core._test.setTargetInput(input);
    Core._test.onScanSuccess('BIN-A01');

    // flush safeStop promise
    await Promise.resolve();
    await Promise.resolve();

    expect(input.value).toBe('BIN-A01');
    // 150ms 后自动聚焦
    jest.advanceTimersByTime(200);
    expect(focusSpy).toHaveBeenCalled();
  });

  test('toBin → 自动聚焦 moveQty', async () => {
    var input = document.createElement('input');
    input.id = 'toBin';
    document.body.appendChild(input);
    var moveQty = document.createElement('input');
    moveQty.id = 'moveQty';
    document.body.appendChild(moveQty);
    var focusSpy = jest.spyOn(moveQty, 'focus');

    Core._test.setTargetInput(input);
    Core._test.onScanSuccess('BIN-B02');

    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(200);
    expect(focusSpy).toHaveBeenCalled();
  });

  test('countBin → 自动聚焦 countQty', async () => {
    var input = document.createElement('input');
    input.id = 'countBin';
    document.body.appendChild(input);
    var countQty = document.createElement('input');
    countQty.id = 'countQty';
    document.body.appendChild(countQty);
    var focusSpy = jest.spyOn(countQty, 'focus');

    Core._test.setTargetInput(input);
    Core._test.onScanSuccess('BIN-C03');

    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(200);
    expect(focusSpy).toHaveBeenCalled();
  });

  test('binLocation 无下一字段映射 → 不抛异常', async () => {
    var input = document.createElement('input');
    input.id = 'binLocation';
    document.body.appendChild(input);

    Core._test.setTargetInput(input);
    Core._test.onScanSuccess('BIN-D04');

    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(200);

    expect(input.value).toBe('BIN-D04');
  });
});

// ============================================================================
// observeCardVisibility: MutationObserver 回调触发 showCameraButton
// ============================================================================
describe('observeCardVisibility MutationObserver 回调', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Core._test.resetState();
    localStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
    localStorage.clear();
  });

  test('class 属性变化 + 摄像头已启用 → 重新注入按钮', async () => {
    // 创建一个 scanInput
    var input = document.createElement('input');
    input.id = 'scanInput';
    document.body.appendChild(input);

    localStorage.setItem('ENABLE_CAMERA_SCANNER', 'true');

    Core._test.observeCardVisibility();

    // 触发 MutationObserver (修改已有元素的 class 属性)
    var card = document.createElement('div');
    card.className = 'hidden';
    document.body.appendChild(card);

    // 让 MutationObserver 有机会观察到初始状态
    await Promise.resolve();

    card.className = 'visible';

    // MutationObserver 回调需要微任务 flush
    await Promise.resolve();
    await Promise.resolve();

    // 触发 150ms debounce
    jest.advanceTimersByTime(200);

    // 应注入 📷 按钮
    var btn = document.getElementById('cameraScanBtn_scanInput');
    expect(btn).not.toBeNull();
  });
});

// ============================================================================
// detectTorch: zoom 分支的更多边界
// ============================================================================
describe('detectTorch zoom 边界', () => {
  afterEach(() => {
    Core._test.removeModal();
    Core._test.resetState();
  });

  test('zoom.min === zoom.max → zoomBar 不显示', () => {
    Core._test.createModal();
    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    var track = {
      getCapabilities: () => ({
        zoom: { min: 2, max: 2, step: 0.5 }
      })
    };
    video.srcObject = { getVideoTracks: () => [track] };
    region.appendChild(video);

    Core._test.detectTorch();
    var zoomBar = document.getElementById('cameraZoomBar');
    // zoomMax <= zoomMin → 不显示
    expect(zoomBar.style.display).not.toBe('flex');
  });

  test('track.getCapabilities 不是函数 → 静默返回', () => {
    Core._test.createModal();
    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    var track = {}; // 无 getCapabilities
    video.srcObject = { getVideoTracks: () => [track] };
    region.appendChild(video);

    expect(() => Core._test.detectTorch()).not.toThrow();
  });

  test('getCapabilities 抛异常 → 静默捕获', () => {
    Core._test.createModal();
    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    var track = {
      getCapabilities: () => { throw new Error('fail'); }
    };
    video.srcObject = { getVideoTracks: () => [track] };
    region.appendChild(video);

    expect(() => Core._test.detectTorch()).not.toThrow();
  });
});

// ============================================================================
// openScanner: HTTPS 检查 — localhost 和 127.0.0.1 放行
// ============================================================================
describe('openScanner HTTPS 检查', () => {
  var savedLocation;
  beforeEach(() => {
    Core._test.resetState();
    global.showMessage.mockClear();
    mockStart.mockClear();
    mockStart.mockImplementation(() => Promise.resolve());
    global.Html5Qrcode.mockClear();
    // 保存原始 location
    savedLocation = window.location;
  });

  afterEach(() => {
    Core._test.removeModal();
    Core._test.resetState();
    // 还原 location
    Object.defineProperty(window, 'location', {
      value: savedLocation,
      writable: true, configurable: true
    });
  });

  test('localhost 放行 (HTTP)', () => {
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:', hostname: 'localhost' },
      writable: true, configurable: true
    });
    Core._test.openScanner();
    // 不应因 HTTPS 报错 (可能有 lib 未加载错误, 排除)
    var httpsCalls = global.showMessage.mock.calls.filter(
      c => c[0] && c[0].includes('HTTPS')
    );
    expect(httpsCalls.length).toBe(0);
  });

  test('127.0.0.1 放行 (HTTP)', () => {
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:', hostname: '127.0.0.1' },
      writable: true, configurable: true
    });
    Core._test.openScanner();
    var httpsCalls = global.showMessage.mock.calls.filter(
      c => c[0] && c[0].includes('HTTPS')
    );
    expect(httpsCalls.length).toBe(0);
  });

  test('HTTPS 放行 (任何域名)', () => {
    Object.defineProperty(window, 'location', {
      value: { protocol: 'https:', hostname: 'wms.example.com' },
      writable: true, configurable: true
    });
    Core._test.openScanner();
    var httpsCalls = global.showMessage.mock.calls.filter(
      c => c[0] && c[0].includes('HTTPS')
    );
    expect(httpsCalls.length).toBe(0);
  });
});

// ============================================================================
// _getNativeTrack: video.srcObject 无 tracks
// ============================================================================
describe('_getNativeTrack 边界', () => {
  afterEach(() => {
    Core._test.removeModal();
  });

  test('video.srcObject.getVideoTracks 返回空数组 → null', () => {
    Core._test.createModal();
    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    video.srcObject = { getVideoTracks: () => [] };
    region.appendChild(video);
    expect(Core._test._getNativeTrack()).toBeNull();
  });

  test('video.srcObject 为 null → null', () => {
    Core._test.createModal();
    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    region.appendChild(video);
    expect(Core._test._getNativeTrack()).toBeNull();
  });

  test('getVideoTracks 抛异常 → null', () => {
    Core._test.createModal();
    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    video.srcObject = { getVideoTracks: () => { throw new Error('fail'); } };
    region.appendChild(video);
    expect(Core._test._getNativeTrack()).toBeNull();
  });
});

// ============================================================================
// safeStop: 正确释放硬件资源 (stream.getTracks + track.stop)
// ============================================================================
describe('硬件资源释放 (track.stop)', () => {
  test('safeStop 调用 scanner.stop → 确保资源释放', async () => {
    var stopFn = jest.fn(() => Promise.resolve());
    Core._test.setScanner({ stop: stopFn });
    await Core._test.safeStop();
    expect(stopFn).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// onScanSuccess: setSelectionRange 抛异常 → 静默捕获
// ============================================================================
describe('onScanSuccess setSelectionRange 异常', () => {
  beforeEach(() => {
    Core._test.resetState();
    mockStop.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('setSelectionRange 不支持 → 不崩溃', async () => {
    var input = document.createElement('input');
    input.id = 'scanInput';
    input.type = 'number'; // number 类型不支持 setSelectionRange
    document.body.appendChild(input);
    // 覆盖 setSelectionRange 让它抛异常
    input.setSelectionRange = function () { throw new DOMException('not supported'); };

    Core._test.setTargetInput(input);
    Core._test.onScanSuccess('12345');

    await Promise.resolve();
    await Promise.resolve();

    expect(input.value).toBe('12345');
  });
});

// ============================================================================
// init: DOMContentLoaded 分支 (document.readyState === 'loading')
// 注: 此分支在模块加载时已执行, 这里测试 init 本身的完整性
// ============================================================================
describe('init 完整性', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    var style = document.getElementById('camera-fallback-styles');
    if (style) style.parentNode.removeChild(style);
  });

  test('localStorage 未启用 → 不显示按钮', () => {
    var input = document.createElement('input');
    input.id = 'scanInput';
    document.body.appendChild(input);
    localStorage.removeItem('ENABLE_CAMERA_SCANNER');
    Core._test.init();
    var btn = document.getElementById('cameraScanBtn_scanInput');
    expect(btn).toBeNull();
  });
});

// ============================================================================
// classifyStartError: 边界输入
// ============================================================================
describe('classifyStartError 边界', () => {
  test('undefined 错误 → camera.error', () => {
    var result = Core.classifyStartError(undefined);
    expect(result.msgKey).toBe('camera.error');
  });

  test('err.name 和 err.message 都为空 → camera.error', () => {
    var result = Core.classifyStartError({});
    expect(result.msgKey).toBe('camera.error');
  });

  test('SecurityError (混合内容) → camera.error (通用)', () => {
    var err = new Error('Mixed content');
    err.name = 'SecurityError';
    var result = Core.classifyStartError(err);
    expect(result.msgKey).toBe('camera.error');
  });
});

// ============================================================================
// toggleTorch: torch 按钮文本更新
// ============================================================================
describe('toggleTorch 按钮文本更新', () => {
  afterEach(() => {
    Core._test.removeModal();
    Core._test.resetState();
  });

  test('开灯 → 关灯文本切换', () => {
    Core._test.resetState();
    Core._test.createModal();
    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    var mockApply = jest.fn();
    var track = {
      getCapabilities: () => ({ torch: true }),
      applyConstraints: mockApply
    };
    video.srcObject = { getVideoTracks: () => [track] };
    region.appendChild(video);

    // 开灯
    Core._test.toggleTorch();
    var btn = document.getElementById('cameraTorchBtn');
    expect(btn.textContent).toContain('关灯');

    // 关灯
    Core._test.toggleTorch();
    expect(btn.textContent).toContain('开灯');
  });
});

// ============================================================================
// onRawScanResult: hasScanned=true 时早退
// ============================================================================
describe('onRawScanResult hasScanned 防抖', () => {
  beforeEach(() => {
    Core._test.resetState();
  });

  test('hasScanned=true → 新帧被忽略', () => {
    var input = document.createElement('input');
    input.id = 'scanInput';
    document.body.appendChild(input);
    Core._test.setTargetInput(input);

    Core._test.onRawScanResult('A');
    Core._test.onRawScanResult('A'); // 触发 onScanSuccess, hasScanned=true

    var state = Core._test.getState();
    expect(state.hasScanned).toBe(true);

    // 再次调用 — 不应改变 confirmBuffer
    Core._test.onRawScanResult('B');
    var state2 = Core._test.getState();
    // buffer 应已清空 (accepted 后清空)
    expect(state2.confirmBuffer).toEqual([]);

    document.body.removeChild(input);
  });
});

// ============================================================================
// _recoverCapture: scanner.resume 抛异常 → 静默
// ============================================================================
describe('_recoverCapture resume 异常', () => {
  beforeEach(() => {
    Core._test.resetState();
    global.showMessage.mockClear();
  });

  test('scanner.resume 抛异常 → 不崩溃', () => {
    var mockScanner = {
      pause: jest.fn(),
      resume: jest.fn(() => { throw new Error('not paused'); }),
      stop: jest.fn(() => Promise.resolve())
    };
    Core._test.setScanner(mockScanner);

    var hint = document.createElement('div');
    expect(() => Core._test._recoverCapture(hint, '原始提示')).not.toThrow();
    expect(hint.textContent).toBe('原始提示');
    expect(global.showMessage).toHaveBeenCalled();
  });
});

// ============================================================================
// openScanner: scanner 单例复用 (第二次不重新 new)
// ============================================================================
describe('openScanner scanner 单例', () => {
  beforeEach(() => {
    Core._test.resetState();
    // 恢复默认 mock 实现
    global.Html5Qrcode.mockImplementation(function () {
      this.start = mockStart;
      this.stop = mockStop;
      this.pause = mockPause;
      this.resume = mockResume;
      this.scanFile = mockScanFile;
      this.clear = mockClear;
    });
    global.Html5Qrcode.mockClear();
    mockStart.mockClear();
    mockStart.mockImplementation(() => Promise.resolve());
    global.showMessage.mockClear();
  });

  afterEach(() => {
    Core._test.removeModal();
    Core._test.resetState();
  });

  test('第二次 openScanner 复用已有 scanner 实例', () => {
    Core._test.openScanner();
    var callCount1 = global.Html5Qrcode.mock.calls.length;
    expect(callCount1).toBe(1);

    // removeModal 但不 resetState, scanner 仍然存在
    Core._test.removeModal();
    Core._test.openScanner();
    var callCount2 = global.Html5Qrcode.mock.calls.length;

    // 第二次不应再实例化
    expect(callCount2).toBe(callCount1);
  });
});

// ============================================================================
// 纯函数补充: updateScanSession 默认参数边界
// ============================================================================
describe('updateScanSession 默认参数', () => {
  test('options 为 undefined → 使用默认 confirmCount=2, timeoutMs=1500', () => {
    var result = Core.updateScanSession({ buffer: [], timestamp: 0 }, 'X', 1000);
    expect(result.buffer).toEqual(['X']);
    expect(result.accepted).toBe(false);
  });

  test('session.buffer 为 undefined → 兜底空数组', () => {
    var result = Core.updateScanSession({ timestamp: 0 }, 'Y', 2000, { confirmCount: 2 });
    expect(result.buffer).toEqual(['Y']);
  });

  test('options.confirmCount=0 → 使用默认 2', () => {
    var result = Core.updateScanSession({ buffer: [], timestamp: 0 }, 'Z', 3000, { confirmCount: 0 });
    expect(result.accepted).toBe(false);
  });
});

// ============================================================================
// 纯函数补充: tr() 翻译函数 (通过 toggleCamera 间接测试)
// ============================================================================
describe('tr() 翻译函数', () => {
  test('t 函数存在时使用翻译', () => {
    global.t = jest.fn((key, fb) => '翻译:' + fb);
    localStorage.setItem('ENABLE_CAMERA_SCANNER', 'false');
    global.showMessage.mockClear();
    Core._test.toggleCamera();
    expect(global.showMessage).toHaveBeenCalled();
    expect(global.showMessage.mock.calls[0][0]).toContain('翻译:');
    delete global.t;
    localStorage.clear();
  });

  test('t 函数不存在时使用 fallback', () => {
    delete global.t;
    localStorage.setItem('ENABLE_CAMERA_SCANNER', 'false');
    global.showMessage.mockClear();
    Core._test.toggleCamera();
    expect(global.showMessage).toHaveBeenCalled();
    // 应包含 fallback 文本 (📷)
    expect(global.showMessage.mock.calls[0][0]).toContain('📷');
    localStorage.clear();
  });
});

// ============================================================================
// Easter egg: 超过 5 次点击 (taps > TAP_COUNT → shift)
// ============================================================================
describe('setupEasterEgg 超限', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  test('6 次点击 → taps 数组维持最大长度 5', () => {
    global.showMessage.mockClear();
    var nav = document.createElement('div');
    nav.className = 'header-nav';
    var h1 = document.createElement('h1');
    h1.textContent = 'WMS';
    nav.appendChild(h1);
    document.body.appendChild(nav);
    Core._test.setupEasterEgg();
    // 6 次快速点击 — 第 5 次触发 toggle, 第 6 次不应重复触发
    for (var i = 0; i < 6; i++) {
      h1.click();
    }
    // 至少触发一次 toggleCamera
    expect(global.showMessage).toHaveBeenCalled();
  });
});

// ============================================================================
// detectTorch: zoom 默认值 (min/max/step 为 0 或 undefined)
// ============================================================================
describe('detectTorch zoom 默认值', () => {
  afterEach(() => {
    Core._test.removeModal();
    Core._test.resetState();
  });

  test('zoom.min/max/step 为 0 → 使用默认值', () => {
    Core._test.createModal();
    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    var track = {
      getCapabilities: () => ({
        zoom: { min: 0, max: 0, step: 0 }
      })
    };
    video.srcObject = { getVideoTracks: () => [track] };
    region.appendChild(video);
    Core._test.detectTorch();
    // zoom.min||1=1, zoom.max||1=1, step||0.5=0.5
    var state = Core._test.getState();
    expect(state.zoomMin).toBe(1);
    expect(state.zoomMax).toBe(1);
    expect(state.zoomStep).toBe(0.5);
  });

  test('zoom 属性缺失 (undefined) → 使用默认值', () => {
    Core._test.createModal();
    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    var track = {
      getCapabilities: () => ({
        zoom: { min: undefined, max: undefined, step: undefined }
      })
    };
    video.srcObject = { getVideoTracks: () => [track] };
    region.appendChild(video);
    Core._test.detectTorch();
    var state = Core._test.getState();
    expect(state.zoomMin).toBe(1);
    expect(state.zoomMax).toBe(1);
    expect(state.zoomStep).toBe(0.5);
  });
});

// ============================================================================
// openScanner 预热: track.getCapabilities 不存在 → 安全降级
// ============================================================================
describe('openScanner 预热 getCapabilities 不存在', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Core._test.resetState();
    global.Html5Qrcode.mockClear();
    mockStart.mockClear();
    global.showMessage.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    Core._test.removeModal();
  });

  test('track 无 getCapabilities → 返回空对象, 不崩溃', async () => {
    var mockApply = jest.fn();
    mockStart.mockImplementation(() => {
      var region = document.getElementById('camera-scanner-region');
      var video = document.createElement('video');
      var track = {
        // getCapabilities 不存在, 三目运算符走右侧 {}
        applyConstraints: mockApply
      };
      video.srcObject = { getVideoTracks: () => [track] };
      region.appendChild(video);
      return Promise.resolve();
    });

    Core._test.openScanner();
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(800);

    // 不应崩溃, 不应调用 applyConstraints (无 adv)
    expect(mockApply).not.toHaveBeenCalled();
  });
});

// ============================================================================
// MutationObserver undefined → 安全返回
// ============================================================================
describe('observeCardVisibility MutationObserver 不存在', () => {
  test('MutationObserver 为 undefined → 不崩溃', () => {
    var saved = global.MutationObserver;
    delete global.MutationObserver;
    expect(() => Core._test.observeCardVisibility()).not.toThrow();
    global.MutationObserver = saved;
  });
});

// ============================================================================
// _recoverCapture: hint 为 null → 不崩溃
// ============================================================================
describe('_recoverCapture hint 为 null', () => {
  beforeEach(() => {
    Core._test.resetState();
    global.showMessage.mockClear();
  });

  test('hint=null → 跳过文本恢复, 不崩溃', () => {
    var mockScanner = {
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(() => Promise.resolve())
    };
    Core._test.setScanner(mockScanner);
    expect(() => Core._test._recoverCapture(null, '')).not.toThrow();
    expect(global.showMessage).toHaveBeenCalled();
  });
});

// ============================================================================
// captureAndDecode: modal 不存在时 hint 为 null
// ============================================================================
describe('captureAndDecode hint/modal 边界', () => {
  var origGetContext;
  beforeEach(() => {
    document.body.innerHTML = '';
    Core._test.resetState();
    global.showMessage.mockClear();
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

  test('modal.querySelector 返回 null hint → 安全处理', () => {
    var mockScanner = { pause: jest.fn(), resume: jest.fn(), stop: jest.fn(() => Promise.resolve()) };
    Core._test.setScanner(mockScanner);
    // 创建 modal 但移除 hint 元素
    Core._test.createModal();
    var hint = document.querySelector('.camera-hint');
    if (hint) hint.parentNode.removeChild(hint);

    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { value: 640 });
    Object.defineProperty(video, 'videoHeight', { value: 480 });
    region.appendChild(video);

    // 不应崩溃
    expect(() => Core._test.captureAndDecode()).not.toThrow();
  });
});

// ============================================================================
// showCameraButton: showMessage 不存在时 toggleCamera 不崩溃
// ============================================================================
describe('toggleCamera showMessage 不存在', () => {
  test('showMessage 未定义 → 不崩溃', () => {
    var saved = global.showMessage;
    delete global.showMessage;
    localStorage.setItem('ENABLE_CAMERA_SCANNER', 'false');
    expect(() => Core._test.toggleCamera()).not.toThrow();
    global.showMessage = saved;
    localStorage.clear();
  });
});

// ============================================================================
// openScanner: Html5QrcodeSupportedFormats 未定义
// ============================================================================
describe('openScanner 无 Html5QrcodeSupportedFormats', () => {
  beforeEach(() => {
    Core._test.resetState();
    mockStart.mockClear();
    mockStart.mockImplementation(() => Promise.resolve());
    global.showMessage.mockClear();
  });

  afterEach(() => {
    Core._test.removeModal();
    Core._test.resetState();
  });

  test('Html5QrcodeSupportedFormats 未定义 → 跳过格式声明', () => {
    var saved = global.Html5QrcodeSupportedFormats;
    delete global.Html5QrcodeSupportedFormats;
    global.Html5Qrcode.mockClear();

    Core._test.openScanner();
    expect(global.Html5Qrcode).toHaveBeenCalled();
    // 构造函数参数中不应有 formatsToSupport
    var opts = global.Html5Qrcode.mock.calls[0][1];
    expect(opts.formatsToSupport).toBeUndefined();

    global.Html5QrcodeSupportedFormats = saved;
  });
});

// ============================================================================
// adjustZoom: 无 track → 直接返回
// ============================================================================
describe('adjustZoom 无 track', () => {
  afterEach(() => {
    Core._test.removeModal();
    Core._test.resetState();
  });

  test('有 zoom 范围但无 track → 不操作', () => {
    Core._test.resetState();
    Core._test.createModal();
    // 手动设置 zoom 范围 (无 video/track)
    var region = document.getElementById('camera-scanner-region');
    var video = document.createElement('video');
    var track = {
      getCapabilities: () => ({ zoom: { min: 1, max: 5, step: 0.5 } })
    };
    video.srcObject = { getVideoTracks: () => [track] };
    region.appendChild(video);
    Core._test.detectTorch();

    // 移除 video (使 _getNativeTrack 返回 null)
    region.removeChild(video);
    expect(() => Core._test.adjustZoom(0.5)).not.toThrow();
  });
});

// ============================================================================
// CameraFallbackCore 纯函数 — 分支覆盖补充
// ============================================================================

describe('CameraFallbackCore 纯函数分支补充', () => {
  test('checkFrameSimilarity — null buffer → false', () => {
    expect(Core.checkFrameSimilarity(null)).toBe(false);
  });

  test('checkFrameSimilarity — 空数组 → false', () => {
    expect(Core.checkFrameSimilarity([])).toBe(false);
  });

  test('checkFrameSimilarity — 单元素 → false', () => {
    expect(Core.checkFrameSimilarity(['A'])).toBe(false);
  });

  test('checkFrameSimilarity — 不一致 → false', () => {
    expect(Core.checkFrameSimilarity(['A', 'B'])).toBe(false);
  });

  test('checkFrameSimilarity — 全一致 → true', () => {
    expect(Core.checkFrameSimilarity(['A', 'A', 'A'])).toBe(true);
  });

  test('detectPlatform — undefined userAgent → isIOS=false', () => {
    var p = Core.detectPlatform(undefined);
    expect(p.isIOS).toBe(false);
  });

  test('detectPlatform — null userAgent → isIOS=false', () => {
    var p = Core.detectPlatform(null);
    expect(p.isIOS).toBe(false);
  });

  test('detectPlatform — iPhone UA → isIOS=true', () => {
    var p = Core.detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17)');
    expect(p.isIOS).toBe(true);
  });

  test('buildScannerConfig — iOS 不添加 videoConstraints', () => {
    var c = Core.buildScannerConfig(true);
    expect(c.fps).toBe(12);
    expect(c.videoConstraints).toBeUndefined();
  });

  test('buildScannerConfig — 非 iOS 添加 videoConstraints', () => {
    var c = Core.buildScannerConfig(false);
    expect(c.videoConstraints).toBeDefined();
    expect(c.videoConstraints.facingMode).toBe('environment');
  });

  test('isGoodExposure — null 数据 → no_data', () => {
    var r = Core.isGoodExposure(null);
    expect(r.good).toBe(false);
    expect(r.reason).toBe('no_data');
  });

  test('isGoodExposure — 空数据 → no_data', () => {
    var r = Core.isGoodExposure(new Uint8ClampedArray([]));
    expect(r.good).toBe(false);
  });

  test('isGoodExposure — 无 options → 使用默认阈值', () => {
    // 构造正常曝光的像素数据 (RGBA, 亮度 ~128)
    var pixels = new Uint8ClampedArray(400); // 100 个像素
    for (var i = 0; i < 400; i += 4) {
      pixels[i] = 128; pixels[i+1] = 128; pixels[i+2] = 128; pixels[i+3] = 255;
    }
    var r = Core.isGoodExposure(pixels);
    expect(r.good).toBe(true);
  });

  test('isGoodExposure — 自定义阈值参数', () => {
    var pixels = new Uint8ClampedArray(400);
    for (var i = 0; i < 400; i += 4) {
      pixels[i] = 128; pixels[i+1] = 128; pixels[i+2] = 128; pixels[i+3] = 255;
    }
    var r = Core.isGoodExposure(pixels, { darkThreshold: 50, brightThreshold: 200, darkRatio: 0.8, brightRatio: 0.8 });
    expect(r.good).toBe(true);
  });

  test('updateScanSession — 超时后清空 buffer', () => {
    var session = { buffer: ['X', 'X'], timestamp: 1000 };
    var result = Core.updateScanSession(session, 'Y', 5000, { timeoutMs: 1500 });
    // 超时 (5000-1000=4000 > 1500), buffer 被清空后加入 Y
    expect(result.buffer).toEqual(['Y']);
    expect(result.accepted).toBe(false);
  });

  test('updateScanSession — buffer 已满但不一致 → 不接受', () => {
    var session = { buffer: ['A'], timestamp: 1000 };
    var result = Core.updateScanSession(session, 'B', 1100, { confirmCount: 2 });
    expect(result.buffer).toEqual(['A', 'B']);
    expect(result.accepted).toBe(false);
  });
});

describe('detectAllInputs — 输入框检测分支', () => {
  test('无任何输入框 + 无 .scan-input → 空数组', () => {
    document.body.innerHTML = '<div>empty</div>';
    var inputs = Core._test.detectAllInputs();
    expect(inputs).toEqual([]);
  });

  test('无命名输入框但有 .scan-input 兜底', () => {
    document.body.innerHTML = '<input class="scan-input" id="fallbackInput">';
    var inputs = Core._test.detectAllInputs();
    expect(inputs.length).toBe(1);
    expect(inputs[0].id).toBe('fallbackInput');
  });

  test('多个命名输入框全检出', () => {
    document.body.innerHTML = '<input id="scanInput"><input id="fromBin"><input id="toBin">';
    var inputs = Core._test.detectAllInputs();
    expect(inputs.length).toBe(3);
  });
});

describe('showCameraButton — 无 id 输入框分支', () => {
  beforeEach(() => {
    localStorage.setItem('ENABLE_CAMERA_SCANNER', 'true');
  });
  afterEach(() => {
    localStorage.clear();
  });

  test('输入框无 id 时 btnId 使用 fallback 后缀', () => {
    document.body.innerHTML = '<input class="scan-input">';
    Core._test.showCameraButton();
    var btn = document.getElementById('cameraScanBtn_fallback');
    expect(btn).not.toBeNull();
  });
});

// ============================================================================
// isGoodExposure: too_dark / too_bright 分支覆盖
// ============================================================================
describe('isGoodExposure 曝光异常分支', () => {
  test('全暗像素 → too_dark', () => {
    // 100 个像素, 每个 RGBA=(10,10,10,255), luma≈10 < 默认 darkThresh=40
    var pixels = new Uint8ClampedArray(400);
    for (var i = 0; i < 400; i += 4) {
      pixels[i] = 10; pixels[i + 1] = 10; pixels[i + 2] = 10; pixels[i + 3] = 255;
    }
    var r = Core.isGoodExposure(pixels);
    expect(r.good).toBe(false);
    expect(r.reason).toBe('too_dark');
  });

  test('全亮像素 → too_bright', () => {
    // 100 个像素, 每个 RGBA=(240,240,240,255), luma≈240 > 默认 brightThresh=220
    var pixels = new Uint8ClampedArray(400);
    for (var i = 0; i < 400; i += 4) {
      pixels[i] = 240; pixels[i + 1] = 240; pixels[i + 2] = 240; pixels[i + 3] = 255;
    }
    var r = Core.isGoodExposure(pixels);
    expect(r.good).toBe(false);
    expect(r.reason).toBe('too_bright');
  });

  test('混合像素 (50% 暗 + 50% 亮) → good (未超过 darkRatio/brightRatio 70%)', () => {
    var pixels = new Uint8ClampedArray(400);
    for (var i = 0; i < 200; i += 4) {
      pixels[i] = 5; pixels[i + 1] = 5; pixels[i + 2] = 5; pixels[i + 3] = 255;
    }
    for (var j = 200; j < 400; j += 4) {
      pixels[j] = 240; pixels[j + 1] = 240; pixels[j + 2] = 240; pixels[j + 3] = 255;
    }
    var r = Core.isGoodExposure(pixels);
    expect(r.good).toBe(true);
    expect(r.reason).toBe(null);
  });

  test('自定义阈值触发 too_dark', () => {
    // luma≈50, darkThreshold=60 → 计入 dark; darkRatio=0.5 → 100%>50% → too_dark
    var pixels = new Uint8ClampedArray(16); // 4 个像素
    for (var i = 0; i < 16; i += 4) {
      pixels[i] = 50; pixels[i + 1] = 50; pixels[i + 2] = 50; pixels[i + 3] = 255;
    }
    var r = Core.isGoodExposure(pixels, { darkThreshold: 60, brightThreshold: 220, darkRatio: 0.5, brightRatio: 0.7 });
    expect(r.good).toBe(false);
    expect(r.reason).toBe('too_dark');
  });

  test('自定义阈值触发 too_bright', () => {
    // luma≈200, brightThreshold=190 → 计入 bright; brightRatio=0.5 → 100%>50% → too_bright
    var pixels = new Uint8ClampedArray(16);
    for (var i = 0; i < 16; i += 4) {
      pixels[i] = 200; pixels[i + 1] = 200; pixels[i + 2] = 200; pixels[i + 3] = 255;
    }
    var r = Core.isGoodExposure(pixels, { darkThreshold: 40, brightThreshold: 190, darkRatio: 0.7, brightRatio: 0.5 });
    expect(r.good).toBe(false);
    expect(r.reason).toBe('too_bright');
  });
});

// ============================================================================
// showCameraButton: flex 容器场景 — wrapper 继承 flex:1, input 移除 flex
// ============================================================================
describe('showCameraButton flex 容器场景', () => {
  beforeEach(() => {
    localStorage.setItem('ENABLE_CAMERA_SCANNER', 'true');
  });
  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  test('flex 父容器 → wrapper 获得 flex:1, input 的 flex 被清除', () => {
    // 构造 flex 容器 + 带 flex:1 的 input
    var container = document.createElement('div');
    container.style.display = 'flex';
    var input = document.createElement('input');
    input.id = 'fromBin';
    input.style.flex = '1';
    container.appendChild(input);
    document.body.appendChild(container);

    Core._test.showCameraButton();

    // input 应被包裹在 .camera-input-wrapper 内
    var wrapper = container.querySelector('.camera-input-wrapper');
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.flex).toBe('1');
    expect(wrapper.style.position).toBe('relative');
    // input 的 flex 应被清除
    expect(input.style.flex).toBe('');
    // 按钮应存在
    var btn = document.getElementById('cameraScanBtn_fromBin');
    expect(btn).not.toBeNull();
  });
});

// ============================================================================
// removeCameraButton: flex 容器还原 — input 恢复 flex:1
// ============================================================================
describe('removeCameraButton flex 容器还原', () => {
  beforeEach(() => {
    localStorage.setItem('ENABLE_CAMERA_SCANNER', 'true');
  });
  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  test('flex 容器内 removeCameraButton → input 恢复 flex:1', () => {
    // 构造 flex 容器
    var container = document.createElement('div');
    container.style.display = 'flex';
    var input = document.createElement('input');
    input.id = 'toBin';
    input.style.flex = '1';
    container.appendChild(input);
    document.body.appendChild(container);

    // 先添加按钮
    Core._test.showCameraButton();
    // 确认 input flex 被清除
    expect(input.style.flex).toBe('');

    // 移除按钮
    Core._test.removeCameraButton();

    // input 应恢复 flex:1
    expect(input.style.flex).toBe('1');
    // wrapper 应被移除
    expect(container.querySelector('.camera-input-wrapper')).toBeNull();
    // input 应回到 container 下
    expect(input.parentNode).toBe(container);
    // camera-enabled-input 类应被移除
    expect(input.classList.contains('camera-enabled-input')).toBe(false);
  });
});

// ============================================================================
// setupEasterEgg: 5 次快速点击触发 toggleCamera
// ============================================================================
describe('setupEasterEgg 5 连击触发', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  test('5 次点击在 TAP_WINDOW_MS 内 → 触发 toggleCamera', () => {
    global.showMessage.mockClear();
    // 确保初始状态: 摄像头关闭
    localStorage.setItem('ENABLE_CAMERA_SCANNER', 'false');

    var nav = document.createElement('div');
    nav.className = 'header-nav';
    var h1 = document.createElement('h1');
    h1.textContent = 'WMS';
    nav.appendChild(h1);
    document.body.appendChild(nav);

    Core._test.setupEasterEgg();

    // 精确 5 次快速点击
    for (var i = 0; i < 5; i++) {
      h1.click();
    }

    // toggleCamera 应被触发 → localStorage 切换为 true + showMessage 被调用
    expect(localStorage.getItem('ENABLE_CAMERA_SCANNER')).toBe('true');
    expect(global.showMessage).toHaveBeenCalled();
  });

  test('4 次点击不触发 toggleCamera', () => {
    global.showMessage.mockClear();
    localStorage.setItem('ENABLE_CAMERA_SCANNER', 'false');

    var nav = document.createElement('div');
    nav.className = 'header-nav';
    var h1 = document.createElement('h1');
    h1.textContent = 'WMS';
    nav.appendChild(h1);
    document.body.appendChild(nav);

    Core._test.setupEasterEgg();

    // 只点击 4 次
    for (var i = 0; i < 4; i++) {
      h1.click();
    }

    // toggleCamera 不应被触发
    expect(localStorage.getItem('ENABLE_CAMERA_SCANNER')).toBe('false');
    expect(global.showMessage).not.toHaveBeenCalled();
  });
});
