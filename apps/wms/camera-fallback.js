/**
 * camera-fallback.js — 手机摄像头扫码兜底模块
 *
 * 非侵入式设计: 零修改 shared.js / 后端
 * 复活节彩蛋: 连点标题 5 次激活 📷 图标
 * 依赖: html5-qrcode.min.js (defer), lang.js (I18N), shared.js (showMessage)
 *
 * @version phase19.13
 */

// ========================================================================
// 可测试纯函数 (无 DOM/硬件依赖，安全导出供单元测试)
// ========================================================================
var CameraFallbackCore = (function () {
    'use strict';

    /** 多帧一致性检查 — 缓冲区所有条目是否完全一致 */
    function checkFrameSimilarity(buffer) {
        if (!buffer || buffer.length < 2) return false;
        for (var i = 1; i < buffer.length; i++) {
            if (buffer[i] !== buffer[0]) return false;
        }
        return true;
    }

    /**
     * 扫码会话状态机 — 多帧确认防误读
     * @param {{buffer: string[], timestamp: number}} session - 当前会话状态
     * @param {string} decodedText - 本帧解码结果
     * @param {number} now - 当前时间戳 (ms)
     * @param {{confirmCount?: number, timeoutMs?: number}} [options]
     * @returns {{buffer: string[], timestamp: number, accepted: boolean, code: string|null}}
     */
    function updateScanSession(session, decodedText, now, options) {
        var confirmCount = (options && options.confirmCount) || 2;
        var timeoutMs = (options && options.timeoutMs) || 1500;
        var buffer = (session.buffer || []).slice();
        var timestamp = session.timestamp || 0;

        // 超时清空 (避免残留旧码干扰)
        if (buffer.length > 0 && (now - timestamp) > timeoutMs) {
            buffer = [];
        }

        buffer.push(decodedText);
        if (buffer.length === 1) timestamp = now;
        if (buffer.length > confirmCount) buffer.shift();

        var accepted = false;
        var code = null;
        if (buffer.length >= confirmCount && checkFrameSimilarity(buffer)) {
            accepted = true;
            code = buffer[0];
            buffer = [];
        }

        return { buffer: buffer, timestamp: timestamp, accepted: accepted, code: code };
    }

    /** 启动错误分类 — 纯逻辑，不触碰 DOM */
    function classifyStartError(err) {
        var errMsg = (err && err.message) || '';
        var errName = (err && err.name) || '';

        if (errName === 'NotAllowedError' || /permission/i.test(errMsg)) {
            return { msgKey: 'camera.denied', fallback: '\u6444\u50cf\u5934\u6743\u9650\u88ab\u62d2\u7edd\uff0c\u8bf7\u5728\u6d4f\u89c8\u5668\u8bbe\u7f6e\u4e2d\u5141\u8bb8\uff0c\u6216\u7ee7\u7eed\u4f7f\u7528\u952e\u76d8\u5f55\u5165' };
        }
        if (errName === 'NotFoundError' || /no.*camera/i.test(errMsg)) {
            return { msgKey: 'camera.notFound', fallback: '\u672a\u68c0\u6d4b\u5230\u6444\u50cf\u5934\u8bbe\u5907\uff0c\u8bf7\u7ee7\u7eed\u4f7f\u7528\u952e\u76d8\u5f55\u5165' };
        }
        if (errName === 'NotReadableError') {
            return { msgKey: 'camera.busy', fallback: '\u6444\u50cf\u5934\u88ab\u5176\u4ed6\u5e94\u7528\u5360\u7528\uff0c\u8bf7\u5173\u95ed\u540e\u91cd\u8bd5' };
        }
        return { msgKey: 'camera.error', fallback: '\u6444\u50cf\u5934\u542f\u52a8\u5931\u8d25\uff0c\u8bf7\u7ee7\u7eed\u4f7f\u7528\u952e\u76d8\u5f55\u5165' };
    }

    /** 平台检测 — 纯逻辑 */
    function detectPlatform(userAgent) {
        return { isIOS: /iPad|iPhone|iPod/.test(userAgent || '') };
    }

    /** 构建扫码配置 — 纯逻辑 */
    function buildScannerConfig(isIOS) {
        var config = { fps: 12, disableFlip: true };
        if (!isIOS) {
            config.videoConstraints = {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            };
        }
        return config;
    }

    /**
     * 图像曝光质量检测 — 接收 RGBA 像素数据 (Uint8ClampedArray)
     * 通过亮度直方图判断过暗/过亮，用于扫码前环境预检
     */
    function isGoodExposure(pixelData, options) {
        if (!pixelData || pixelData.length < 4) return { good: false, reason: 'no_data' };
        var darkThresh = (options && options.darkThreshold) || 40;
        var brightThresh = (options && options.brightThreshold) || 220;
        var darkLimit = (options && options.darkRatio) || 0.7;
        var brightLimit = (options && options.brightRatio) || 0.7;
        var total = Math.floor(pixelData.length / 4);
        var darkCount = 0;
        var brightCount = 0;
        for (var i = 0; i < pixelData.length; i += 4) {
            // ITU-R BT.601 亮度公式
            var luma = 0.299 * pixelData[i] + 0.587 * pixelData[i + 1] + 0.114 * pixelData[i + 2];
            if (luma < darkThresh) darkCount++;
            if (luma > brightThresh) brightCount++;
        }
        if (darkCount / total > darkLimit) return { good: false, reason: 'too_dark' };
        if (brightCount / total > brightLimit) return { good: false, reason: 'too_bright' };
        return { good: true, reason: null };
    }

    /**
     * 高分辨率帧捕获 — 渐进增强
     * Level 3: ImageCapture.takePhoto() → 传感器原始分辨率 (12MP+, Android Chrome)
     * Level 1: canvas.drawImage(video) → 视频流分辨率 (iOS/所有浏览器兜底)
     * 照片数据仅在内存中短暂存在用于解码，不存储不上传
     * @param {HTMLVideoElement} video
     * @param {MediaStreamTrack|null} track
     * @returns {Promise<File>}
     */
    function captureHighResFrame(video, track) {
        // Level 3: ImageCapture.takePhoto — 全传感器分辨率 (Android Chrome 59+)
        if (typeof ImageCapture !== 'undefined' && track) {
            try {
                var ic = new ImageCapture(track);
                return ic.takePhoto().then(function (blob) {
                    return new File([blob], 'capture.jpg', { type: blob.type });
                });
            } catch (e) { /* ImageCapture 不可用 — 降级 */ }
        }
        // Level 1: canvas 抓帧 — iOS Safari / Firefox 通用兜底
        var canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        return new Promise(function (resolve) {
            canvas.toBlob(function (blob) {
                resolve(new File([blob], 'capture.png', { type: 'image/png' }));
                canvas = null; // 释放内存
            }, 'image/png');
        });
    }

    return {
        checkFrameSimilarity: checkFrameSimilarity,
        updateScanSession: updateScanSession,
        classifyStartError: classifyStartError,
        detectPlatform: detectPlatform,
        buildScannerConfig: buildScannerConfig,
        isGoodExposure: isGoodExposure,
        captureHighResFrame: captureHighResFrame
    };
})();

// ========================================================================
// 主模块 (DOM 依赖, 浏览器运行时)
// ========================================================================
(function () {
    'use strict';

    // ========================================================================
    // 常量
    // ========================================================================
    var STORAGE_KEY = 'ENABLE_CAMERA_SCANNER';
    var TAP_COUNT = 5;
    var TAP_WINDOW_MS = 2000;
    var STYLE_ID = 'camera-fallback-styles';
    var MODAL_ID = 'camera-scanner-modal';
    var REGION_ID = 'camera-scanner-region';
    var Z_INDEX = 100050;

    // ========================================================================
    // 模块级状态 (单例)
    // ========================================================================
    var scanner = null;       // Html5Qrcode 单例
    var hasScanned = false;   // onSuccess 防抖
    var isTorchOn = false;    // 闪光灯状态
    var targetInput = null;   // 当前页面的主扫码输入框
    var currentZoom = 1;      // 当前缩放倍数
    var zoomMin = 1;          // 硬件最小缩放
    var zoomMax = 1;          // 硬件最大缩放
    var zoomStep = 0.5;       // 每次缩放步进

    // V19.12: 多帧确认 — 连续 N 帧相同结果才接受 (过滤误读)
    var CONFIRM_COUNT = 2;     // 需要连续 2 次相同结果
    var confirmBuffer = [];    // 确认缓冲区
    var confirmTimestamp = 0;  // 首次匹配的时间戳
    var _isCapturing = false;  // 拍照解码进行中标记
    var _captureFailCount = 0; // 连续拍照失败计数 (达到 3 次自动关闭摄像头)
    var CAPTURE_FAIL_LIMIT = 3;

    // ========================================================================
    // 辅助函数
    // ========================================================================

    /** 安全翻译 — 兼容 lang.js 未加载场景 */
    function tr(key, fallback) {
        return (typeof t === 'function') ? t(key, fallback) : fallback || key;
    }

    /** 检测所有扫码输入框 (返回数组, 支持全模块物料+库位扫码) */
    function detectAllInputs() {
        // 物料扫码 + 库位扫码 (PO/WO: binLocation, LM: fromBin/toBin, IC: countBin)
        var ids = ['scanInput', 'itemScan', 'loadInput',
                   'fromBin', 'toBin', 'countBin', 'binLocation'];
        var inputs = [];
        ids.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) inputs.push(el);
        });
        // 兜底: 未命中的 .scan-input
        if (inputs.length === 0) {
            var fallback = document.querySelector('.scan-input');
            if (fallback) inputs.push(fallback);
        }
        return inputs;
    }

    // ========================================================================
    // 1. CSS 样式注入 (唯一 ID 防重复)
    // ========================================================================
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            /* 📷 按钮包装器 — 包裹输入框, 确保按钮精确对齐 (不受 label 影响) */
            '.camera-input-wrapper{position:relative;display:block}',
            /* 📷 按钮 — 绝对定位在输入框内右侧 */
            '.camera-scan-btn{',
            '  position:absolute;right:8px;top:50%;transform:translateY(-50%);',
            '  background:none;border:none;font-size:22px;cursor:pointer;',
            '  padding:4px 6px;line-height:1;z-index:2;opacity:0.7;',
            '  transition:opacity .2s}',
            '.camera-scan-btn:active{opacity:1}',
            /* 输入框让出右侧空间 */
            '.camera-enabled-input{padding-right:44px!important}',
            /* Modal 遮罩 */
            '#' + MODAL_ID + '{',
            '  position:fixed;top:0;left:0;width:100%;height:100%;',
            '  background:rgba(0,0,0,.85);z-index:' + Z_INDEX + ';',
            '  display:flex;flex-direction:column;align-items:center;',
            '  justify-content:center}',
            /* 扫描区域 — 横向矩形, 适配条形码 (宽>高) + QR码兼容 */
            '#' + REGION_ID + '{',
            '  width:min(88vw,360px);height:min(60vw,240px);',
            '  border-radius:12px;overflow:hidden}',
            /* 提示文字 */
            '.camera-hint{color:#fff;margin-top:12px;font-size:13px;text-align:center}',
            /* 缩放控制栏 */
            '.camera-zoom-bar{display:none;align-items:center;gap:10px;margin-top:12px;color:#fff}',
            '.camera-zoom-btn{',
            '  width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.4);',
            '  background:rgba(255,255,255,.15);color:#fff;font-size:22px;line-height:1;',
            '  cursor:pointer;display:flex;align-items:center;justify-content:center}',
            '.camera-zoom-btn:active{background:rgba(255,255,255,.35)}',
            '.camera-zoom-label{font-size:14px;min-width:40px;text-align:center}',
            /* 按钮栏 */
            '.camera-btn-bar{display:flex;gap:12px;margin-top:16px}',
            '.camera-btn{',
            '  background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);',
            '  border-radius:8px;padding:10px 20px;font-size:15px;cursor:pointer;',
            '  transition:background .2s}',
            '.camera-btn:active{background:rgba(255,255,255,.3)}',
            '.camera-torch-btn{display:none}',
            /* 拍照解码按钮 — 高亮区分 */
            '.camera-capture-btn{background:rgba(255,255,255,.25);font-weight:600}',
            '.camera-capture-btn:active{background:rgba(255,255,255,.45)}',
            /* 快门闪白动画 */
            '#camera-capture-flash{',
            '  position:absolute;top:0;left:0;width:100%;height:100%;',
            '  background:#fff;opacity:0;pointer-events:none;z-index:1;',
            '  animation:captureFlash .3s ease-out forwards}',
            '@keyframes captureFlash{0%{opacity:.7}100%{opacity:0}}'
        ].join('\n');
        document.head.appendChild(style);
    }

    // ========================================================================
    // 2. 复活节彩蛋: 5 连击切换
    // ========================================================================
    function setupEasterEgg() {
        var header = document.querySelector('.header-nav h1');
        if (!header) return;
        var taps = [];
        header.addEventListener('click', function () {
            var now = Date.now();
            taps.push(now);
            if (taps.length > TAP_COUNT) taps.shift();
            if (taps.length === TAP_COUNT && (now - taps[0]) <= TAP_WINDOW_MS) {
                taps = [];
                toggleCamera();
            }
        }, { passive: true });
    }

    function toggleCamera() {
        var enabled = localStorage.getItem(STORAGE_KEY) === 'true';
        enabled = !enabled;
        localStorage.setItem(STORAGE_KEY, String(enabled));
        if (enabled) {
            showCameraButton();
            if (typeof showMessage === 'function') {
                showMessage(tr('camera.enabled', '\ud83d\udcf7 \u6444\u50cf\u5934\u626b\u7801\u5df2\u5f00\u542f'), 'success');
            }
        } else {
            removeCameraButton();
            if (typeof showMessage === 'function') {
                showMessage(tr('camera.disabled', '\ud83d\udcf7 \u6444\u50cf\u5934\u626b\u7801\u5df2\u5173\u95ed'), 'info');
            }
        }
    }

    // ========================================================================
    // 3. UI 注入: 📷 图标 (支持多输入框)
    // ========================================================================
    function showCameraButton() {
        var inputs = detectAllInputs();
        inputs.forEach(function (input) {
            var btnId = 'cameraScanBtn_' + (input.id || 'fallback');
            if (document.getElementById(btnId)) return; // 已有按钮

            // 库位输入框 (fromBin/toBin/countBin) 在 flex 容器内 (有+按钮)
            // 需要在 flex 容器外层包装, 不破坏原有 flex 布局
            var parent = input.parentNode;
            var isFlexChild = parent && parent.style && parent.style.display === 'flex';

            var wrapper = document.createElement('div');
            wrapper.className = 'camera-input-wrapper';

            if (isFlexChild) {
                // 库位 flex 容器场景: wrapper 替换 input 在 flex 中的位置
                wrapper.style.flex = '1';
                wrapper.style.position = 'relative';
                parent.insertBefore(wrapper, input);
                wrapper.appendChild(input);
                // 移除 input 上的 flex:1 (已转移到 wrapper)
                input.style.flex = '';
            } else {
                parent.insertBefore(wrapper, input);
                wrapper.appendChild(input);
            }

            input.classList.add('camera-enabled-input');

            var btn = document.createElement('button');
            btn.type = 'button';
            btn.id = btnId;
            btn.className = 'camera-scan-btn';
            btn.textContent = '\ud83d\udcf7';
            btn.title = tr('camera.scanHint', '\u5c06\u6761\u7801/\u4e8c\u7ef4\u7801\u5bf9\u51c6\u6846\u5185');
            btn.addEventListener('click', function () {
                targetInput = input; // 点击时绑定对应输入框
                openScanner();
            }, { passive: true });
            wrapper.appendChild(btn);
        });
    }

    function removeCameraButton() {
        var btns = document.querySelectorAll('.camera-scan-btn');
        btns.forEach(function (btn) { btn.parentNode.removeChild(btn); });
        // 解除包装器, 将 input 还原到原始位置
        var wrappers = document.querySelectorAll('.camera-input-wrapper');
        wrappers.forEach(function (w) {
            var input = w.querySelector('.camera-enabled-input');
            if (input) {
                input.classList.remove('camera-enabled-input');
                // 库位 flex 容器: 还原 input 的 flex:1
                var parent = w.parentNode;
                if (parent && parent.style && parent.style.display === 'flex') {
                    input.style.flex = '1';
                }
                parent.insertBefore(input, w);
            }
            w.parentNode.removeChild(w);
        });
    }

    // ========================================================================
    // 4. Modal 创建
    // ========================================================================
    function createModal() {
        // 移除已有 Modal (防重复)
        removeModal();

        var modal = document.createElement('div');
        modal.id = MODAL_ID;

        // 扫描区域
        var region = document.createElement('div');
        region.id = REGION_ID;
        modal.appendChild(region);

        // 提示文字
        var hint = document.createElement('div');
        hint.className = 'camera-hint';
        hint.textContent = tr('camera.scanHint', '\u5c06\u6761\u7801/\u4e8c\u7ef4\u7801\u5bf9\u51c6\u6846\u5185');
        modal.appendChild(hint);

        // 缩放控制栏 (默认隐藏, 检测到硬件 zoom 后显示)
        var zoomBar = document.createElement('div');
        zoomBar.className = 'camera-zoom-bar';
        zoomBar.id = 'cameraZoomBar';
        var zoomOutBtn = document.createElement('button');
        zoomOutBtn.type = 'button';
        zoomOutBtn.className = 'camera-zoom-btn';
        zoomOutBtn.textContent = '\u2212'; // −
        zoomOutBtn.addEventListener('click', function () { adjustZoom(-zoomStep); });
        zoomBar.appendChild(zoomOutBtn);
        var zoomLabel = document.createElement('span');
        zoomLabel.className = 'camera-zoom-label';
        zoomLabel.id = 'cameraZoomLabel';
        zoomLabel.textContent = '1.0x';
        zoomBar.appendChild(zoomLabel);
        var zoomInBtn = document.createElement('button');
        zoomInBtn.type = 'button';
        zoomInBtn.className = 'camera-zoom-btn';
        zoomInBtn.textContent = '+';
        zoomInBtn.addEventListener('click', function () { adjustZoom(zoomStep); });
        zoomBar.appendChild(zoomInBtn);
        modal.appendChild(zoomBar);

        // 按钮栏
        var bar = document.createElement('div');
        bar.className = 'camera-btn-bar';

        // 闪光灯按钮 (默认隐藏)
        var torchBtn = document.createElement('button');
        torchBtn.type = 'button';
        torchBtn.id = 'cameraTorchBtn';
        torchBtn.className = 'camera-btn camera-torch-btn';
        torchBtn.textContent = tr('camera.torchOff', '\ud83d\udd26 \u5f00\u706f');
        torchBtn.addEventListener('click', toggleTorch);
        bar.appendChild(torchBtn);

        // 拍照解码按钮 (高亮样式, 始终可见)
        var captureBtn = document.createElement('button');
        captureBtn.type = 'button';
        captureBtn.id = 'cameraCaptureBtn';
        captureBtn.className = 'camera-btn camera-capture-btn';
        captureBtn.textContent = tr('camera.capture', '\ud83d\udcf7 \u62cd\u7167');
        captureBtn.addEventListener('click', captureAndDecode);
        bar.appendChild(captureBtn);

        // 关闭按钮
        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'camera-btn';
        closeBtn.textContent = tr('camera.close', '\u5173\u95ed');
        closeBtn.addEventListener('click', closeScanner);
        bar.appendChild(closeBtn);

        modal.appendChild(bar);
        document.body.appendChild(modal);
        return modal;
    }

    function removeModal() {
        var modal = document.getElementById(MODAL_ID);
        if (modal) modal.parentNode.removeChild(modal);
        hasScanned = false;
    }

    // ========================================================================
    // 5. 扫码核心
    // ========================================================================
    function openScanner() {
        // 库加载检查
        if (typeof Html5Qrcode === 'undefined') {
            if (typeof showMessage === 'function') {
                showMessage(tr('camera.libNotReady', '\u626b\u7801\u5e93\u672a\u52a0\u8f7d\uff0c\u8bf7\u5237\u65b0\u9875\u9762'), 'error');
            }
            return;
        }

        // HTTPS 检查 (localhost 除外, 浏览器层面 getUserMedia 要求 HTTPS)
        var hostname = location.hostname;
        if (location.protocol !== 'https:'
            && hostname !== 'localhost'
            && hostname !== '127.0.0.1') {
            if (typeof showMessage === 'function') {
                showMessage(tr('camera.requireHttps', '\u6444\u50cf\u5934\u9700\u8981 HTTPS \u73af\u5883'), 'error');
            }
            return;
        }

        // 创建 Modal
        createModal();

        // 重置状态
        hasScanned = false;
        isTorchOn = false;
        confirmBuffer = [];
        confirmTimestamp = 0;
        _captureFailCount = 0;

        // V19.14: Scanner 单例 — formatsToSupport 必须在构造函数中!
        // (传给 start() config 会被静默忽略, 参考 html5-qrcode #345)
        // 恢复原生 BarcodeDetector (硬件加速, 快) + 多帧确认兜底防误读
        if (!scanner) {
            var scannerOpts = {};
            if (typeof Html5QrcodeSupportedFormats !== 'undefined') {
                scannerOpts.formatsToSupport = [
                    Html5QrcodeSupportedFormats.QR_CODE,
                    Html5QrcodeSupportedFormats.CODE_128,
                    Html5QrcodeSupportedFormats.CODE_39,
                    Html5QrcodeSupportedFormats.EAN_13,
                    Html5QrcodeSupportedFormats.EAN_8
                ];
            }
            scanner = new Html5Qrcode(REGION_ID, scannerOpts);
        }

        // 平台检测 + 配置构建 (委托 CameraFallbackCore 纯函数)
        var platform = CameraFallbackCore.detectPlatform(navigator.userAgent);
        var config = CameraFallbackCore.buildScannerConfig(platform.isIOS);

        // 启动摄像头 (videoConstraints 覆盖第一参数, 两处都声明 facingMode 确保兼容)
        scanner.start(
            { facingMode: 'environment' },
            config,
            onRawScanResult,
            function () { /* onScanFailure — 静默 (每帧调用) */ }
        ).then(function () {
            // 启动成功 — 检测硬件能力 (闪光灯/缩放)
            detectTorch();
            // V19.10: 摄像头预热后 → 自动对焦 + 自动放大 2x (小码关键!)
            setTimeout(function () {
                var track = _getNativeTrack();
                if (!track) return;
                try {
                    var cap = track.getCapabilities ? track.getCapabilities() : {};
                    var adv = [];
                    // 持续自动对焦
                    if (cap.focusMode && cap.focusMode.indexOf('continuous') !== -1) {
                        adv.push({ focusMode: 'continuous' });
                    }
                    // 自动放大 2x (平衡: 小码需要放大, 但 3x 导致卡顿)
                    if (cap.zoom && cap.zoom.max >= 2) {
                        var autoZoom = Math.min(2, cap.zoom.max);
                        adv.push({ zoom: autoZoom });
                        currentZoom = autoZoom;
                        zoomMin = cap.zoom.min || 1;
                        zoomMax = cap.zoom.max || 1;
                        zoomStep = cap.zoom.step || 0.5;
                        if (zoomStep < 0.1) zoomStep = 0.5;
                        updateZoomLabel();
                    }
                    if (adv.length > 0) {
                        track.applyConstraints({ advanced: adv });
                    }
                } catch (e) { /* 设备不支持 — 静默 */ }
            }, 800);
        }).catch(handleStartError);
    }

    /** 库位输入框 ID 集合 — 扫码后不派发 Enter, 改为触发 change+blur */
    var BIN_INPUT_IDS = ['fromBin', 'toBin', 'countBin', 'binLocation'];

    /**
     * V19.12: 多帧确认 — 原始扫码回调 (委托 CameraFallbackCore.updateScanSession 状态机)
     * 彻底过滤 ZXing 单帧误读 (Code128 混合字符尤为严重)。
     */
    function onRawScanResult(decodedText) {
        if (hasScanned) return;
        var result = CameraFallbackCore.updateScanSession(
            { buffer: confirmBuffer, timestamp: confirmTimestamp },
            decodedText, Date.now(),
            { confirmCount: CONFIRM_COUNT, timeoutMs: 1500 }
        );
        confirmBuffer = result.buffer;
        confirmTimestamp = result.timestamp;
        if (result.accepted) onScanSuccess(result.code);
    }

    /** 扫码成功回调 (含防抖) — 经过多帧确认后才到达此处 */
    function onScanSuccess(decodedText) {
        if (hasScanned) return;
        hasScanned = true;

        safeStop().then(function () {
            removeModal();

            if (!targetInput) return;
            targetInput.value = decodedText;
            targetInput.focus();

            // iOS Safari 兼容
            try {
                targetInput.setSelectionRange(
                    targetInput.value.length,
                    targetInput.value.length
                );
            } catch (e) { /* 部分 input type 不支持 */ }

            var inputId = targetInput.id || '';
            var isBinInput = BIN_INPUT_IDS.indexOf(inputId) !== -1;

            if (isBinInput) {
                // 库位输入: 仅派发 change + blur (触发校验), 不发 Enter (避免提交表单)
                targetInput.dispatchEvent(new Event('change', { bubbles: true }));
                targetInput.dispatchEvent(new Event('blur', { bubbles: true }));
                // 自动聚焦到下一个字段 (配合 LM/IC 的聚焦链)
                var nextMap = { 'fromBin': 'toBin', 'toBin': 'moveQty', 'countBin': 'countQty' };
                var nextId = nextMap[inputId];
                if (nextId) {
                    var nextEl = document.getElementById(nextId);
                    if (nextEl) {
                        setTimeout(function () { nextEl.focus(); nextEl.select(); }, 150);
                    }
                }
            } else {
                // 物料扫码: 派发 keydown Enter (shared.js:221 setupBarcodeInput 监听此事件)
                // 同时补发 change 事件以兼容其他可能的监听器
                targetInput.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter', code: 'Enter',
                    keyCode: 13, which: 13, bubbles: true
                }));
                targetInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
    }

    // ========================================================================
    // 拍照解码 — 小码/多码叠放高清识别
    // ========================================================================

    /**
     * 拍照解码: 暂停连续扫描 → 抓取高分辨率帧 → scanFile 解码 → 返回结果
     * 照片数据仅在内存中短暂存在，不存储不上传
     */
    function captureAndDecode() {
        if (hasScanned || _isCapturing || _captureFailCount >= CAPTURE_FAIL_LIMIT) return;
        _isCapturing = true;

        // 1. 快门闪白动画 (300ms 自动消失)
        var modal = document.getElementById(MODAL_ID);
        var flash = document.createElement('div');
        flash.id = 'camera-capture-flash';
        if (modal) modal.appendChild(flash);
        setTimeout(function () { if (flash.parentNode) flash.parentNode.removeChild(flash); }, 300);

        // 2. 提示文字切换为 "解析中..."
        var hint = modal && modal.querySelector('.camera-hint');
        var origHint = hint ? hint.textContent : '';
        if (hint) hint.textContent = tr('camera.processing', '解析中...');

        // 3. 暂停连续扫描 (保留视频预览画面)
        try { scanner.pause(false); } catch (e) { /* 未运行时忽略 */ }

        // 4. 抓取高分辨率帧 (ImageCapture.takePhoto 渐进增强 → canvas 兜底)
        var video = document.querySelector('#' + REGION_ID + ' video');
        var track = _getNativeTrack();
        if (!video) { _recoverCapture(hint, origHint); return; }

        CameraFallbackCore.captureHighResFrame(video, track)
            .then(function (file) {
                // 5. scanFile 全分辨率解码 (showImage=false: 不渲染到 DOM, 纯性能)
                var decoderId = '_capture_decoder_' + Date.now();
                var tempDiv = document.createElement('div');
                tempDiv.id = decoderId;
                tempDiv.style.display = 'none';
                document.body.appendChild(tempDiv);
                var decoder = new Html5Qrcode(decoderId);
                return decoder.scanFile(file, /* showImage */ false).then(function (text) {
                    decoder.clear();
                    if (tempDiv.parentNode) tempDiv.parentNode.removeChild(tempDiv);
                    return text;
                }).catch(function (err) {
                    decoder.clear();
                    if (tempDiv.parentNode) tempDiv.parentNode.removeChild(tempDiv);
                    throw err;
                });
            })
            .then(function (decodedText) {
                // 6. 解码成功 → 重置失败计数, 走正常 onScanSuccess 流程
                _isCapturing = false;
                _captureFailCount = 0;
                onScanSuccess(decodedText);
            })
            .catch(function () {
                // 7. 解码失败 → 恢复连续扫描
                _recoverCapture(hint, origHint);
            });
    }

    /** 拍照解码失败恢复 — 累加失败计数, 达 3 次自动关闭摄像头 */
    function _recoverCapture(hint, origHint) {
        _isCapturing = false;
        _captureFailCount++;
        if (_captureFailCount >= CAPTURE_FAIL_LIMIT) {
            // 连续失败达上限 → 关闭摄像头, 释放资源
            // 不重置 _captureFailCount — 阻止 closeScanner 异步期间再次点击
            // 计数器在下次 openScanner 时重置
            closeScanner();
            if (typeof showMessage === 'function') {
                showMessage(tr('camera.captureGiveUp', '多次未识别，已关闭摄像头'), 'warning');
            }
            return;
        }
        if (hint) hint.textContent = origHint;
        try { scanner.resume(); } catch (e) { /* 未暂停时忽略 */ }
        if (typeof showMessage === 'function') {
            showMessage(tr('camera.captureFailed', '未识别到条码，请调整角度/距离后重试 (' + _captureFailCount + '/' + CAPTURE_FAIL_LIMIT + ')'), 'warning');
        }
    }

    /** 手动关闭 */
    function closeScanner() {
        safeStop().then(function () {
            removeModal();
            // 延迟归焦，避免 Android 软键盘闪弹
            if (targetInput && typeof focusScanInput === 'function') {
                focusScanInput();
            } else if (targetInput) {
                requestAnimationFrame(function () {
                    targetInput.focus({ preventScroll: true });
                });
            }
        });
    }

    // ========================================================================
    // 6. 闪光灯
    // ========================================================================
    /** 获取原生 MediaStreamTrack (绕过 html5-qrcode 封装) */
    function _getNativeTrack() {
        try {
            var video = document.querySelector('#' + REGION_ID + ' video');
            if (video && video.srcObject) {
                var tracks = video.srcObject.getVideoTracks();
                if (tracks.length > 0) return tracks[0];
            }
        } catch (e) {}
        return null;
    }

    function detectTorch() {
        try {
            var track = _getNativeTrack();
            if (!track || typeof track.getCapabilities !== 'function') return;
            var capabilities = track.getCapabilities();
            if (capabilities.torch) {
                var btn = document.getElementById('cameraTorchBtn');
                if (btn) btn.style.display = 'inline-block';
            }
            // V19.6: 检测硬件 zoom 能力, 显示缩放控制 (用原生 MediaStreamTrack)
            if (capabilities.zoom) {
                zoomMin = capabilities.zoom.min || 1;
                zoomMax = capabilities.zoom.max || 1;
                zoomStep = capabilities.zoom.step || 0.5;
                if (zoomStep < 0.1) zoomStep = 0.5; // 步进太小时用默认值
                currentZoom = 1;
                if (zoomMax > zoomMin) {
                    var zoomBarEl = document.getElementById('cameraZoomBar');
                    if (zoomBarEl) zoomBarEl.style.display = 'flex';
                    updateZoomLabel();
                }
            }
        } catch (e) {
            // 设备不支持闪光灯/缩放 — 静默
        }
    }

    /** V19.6: 调整摄像头缩放倍数 (用原生 MediaStreamTrack.applyConstraints) */
    function adjustZoom(delta) {
        if (zoomMax <= zoomMin) return;
        var track = _getNativeTrack();
        if (!track) return;
        try {
            currentZoom = Math.min(zoomMax, Math.max(zoomMin, currentZoom + delta));
            track.applyConstraints({ advanced: [{ zoom: currentZoom }] });
            updateZoomLabel();
        } catch (e) {
            // 缩放失败 — 静默
        }
    }

    function updateZoomLabel() {
        var label = document.getElementById('cameraZoomLabel');
        if (label) label.textContent = currentZoom.toFixed(1) + 'x';
    }

    function toggleTorch() {
        try {
            var track = _getNativeTrack();
            if (!track || typeof track.getCapabilities !== 'function') throw new Error('no track');
            var capabilities = track.getCapabilities();
            if (!capabilities.torch) {
                if (typeof showMessage === 'function') {
                    showMessage(tr('camera.torchUnsupported', '\u5f53\u524d\u8bbe\u5907\u4e0d\u652f\u6301\u63a7\u5236\u95ea\u5149\u706f'), 'warning');
                }
                return;
            }
            isTorchOn = !isTorchOn;
            track.applyConstraints({ advanced: [{ torch: isTorchOn }] });
            var btn = document.getElementById('cameraTorchBtn');
            if (btn) {
                btn.textContent = isTorchOn
                    ? tr('camera.torchOn', '\ud83d\udd26 \u5173\u706f')
                    : tr('camera.torchOff', '\ud83d\udd26 \u5f00\u706f');
            }
        } catch (e) {
            if (typeof showMessage === 'function') {
                showMessage(tr('camera.torchUnsupported', '\u5f53\u524d\u8bbe\u5907\u4e0d\u652f\u6301\u63a7\u5236\u95ea\u5149\u706f'), 'warning');
            }
        }
    }

    // ========================================================================
    // 7. 异常拦截与优雅降级
    // ========================================================================
    function handleStartError(err) {
        var classified = CameraFallbackCore.classifyStartError(err);
        if (typeof showMessage === 'function') {
            showMessage(tr(classified.msgKey, classified.fallback), 'error');
        }
        // 安全关闭 Modal (scanner 单例保留)
        removeModal();
    }

    /** 安全停止摄像头 (Promise 化) */
    function safeStop() {
        if (!scanner) return Promise.resolve();
        return scanner.stop().catch(function () { /* 已停止时忽略 */ });
    }

    // ========================================================================
    // 初始化
    // ========================================================================

    /**
     * 监听 DOM 可见性变化 (卡片 hidden→visible 切换)
     * LM/IC 页面: itemScan 在隐藏的 inputCard/scanCard 中,
     * 创建单据后卡片才显示, 需要此时重新注入按钮。
     */
    var _refreshTimer = null;
    function observeCardVisibility() {
        if (typeof MutationObserver === 'undefined') return;
        var observer = new MutationObserver(function () {
            if (_refreshTimer) return;
            _refreshTimer = setTimeout(function () {
                _refreshTimer = null;
                if (localStorage.getItem(STORAGE_KEY) === 'true') {
                    showCameraButton();
                }
            }, 150);
        });
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class'],
            subtree: true
        });
    }

    function init() {
        var inputs = detectAllInputs();
        if (inputs.length === 0) return; // 当前页面无扫码输入框 (login/export)
        targetInput = inputs[0]; // 默认目标 (点击按钮时会动态更新)

        injectStyles();
        setupEasterEgg();

        // 如果之前已启用，直接显示 📷 按钮
        if (localStorage.getItem(STORAGE_KEY) === 'true') {
            showCameraButton();
        }

        // 监听卡片可见性变化, 自动为新显示的输入框注入按钮
        observeCardVisibility();
    }

    // DOM Ready 后执行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 测试钩子 — 暴露内部函数供集成测试 (仅 Node.js 环境)
    if (typeof module !== 'undefined') {
        CameraFallbackCore._test = {
            // 集成入口
            openScanner: openScanner,
            closeScanner: closeScanner,
            handleStartError: handleStartError,
            onRawScanResult: onRawScanResult,
            onScanSuccess: onScanSuccess,
            toggleCamera: toggleCamera,
            init: init,
            // DOM 操作
            injectStyles: injectStyles,
            showCameraButton: showCameraButton,
            removeCameraButton: removeCameraButton,
            createModal: createModal,
            removeModal: removeModal,
            detectAllInputs: detectAllInputs,
            setupEasterEgg: setupEasterEgg,
            observeCardVisibility: observeCardVisibility,
            // 硬件控制
            safeStop: safeStop,
            detectTorch: detectTorch,
            adjustZoom: adjustZoom,
            updateZoomLabel: updateZoomLabel,
            toggleTorch: toggleTorch,
            _getNativeTrack: _getNativeTrack,
            // 拍照解码
            captureAndDecode: captureAndDecode,
            _recoverCapture: _recoverCapture,
            // 状态访问
            getState: function () {
                return {
                    hasScanned: hasScanned,
                    confirmBuffer: confirmBuffer,
                    confirmTimestamp: confirmTimestamp,
                    scanner: scanner,
                    targetInput: targetInput,
                    isTorchOn: isTorchOn,
                    currentZoom: currentZoom,
                    zoomMin: zoomMin,
                    zoomMax: zoomMax,
                    zoomStep: zoomStep,
                    _isCapturing: _isCapturing
                };
            },
            resetState: function () {
                hasScanned = false;
                confirmBuffer = [];
                confirmTimestamp = 0;
                scanner = null;
                targetInput = null;
                isTorchOn = false;
                currentZoom = 1;
                zoomMin = 1;
                zoomMax = 1;
                zoomStep = 0.5;
                _isCapturing = false;
                _captureFailCount = 0;
            },
            setScanner: function (s) { scanner = s; },
            setTargetInput: function (el) { targetInput = el; }
        };
    }
})();

// Node.js/测试环境安全导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CameraFallbackCore;
}
