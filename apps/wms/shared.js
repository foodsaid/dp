/**
 * WMS - 公共JS模块
 * 提供API调用、扫码处理、音效、校验、格式化等公共功能
 */

// ============================================================================
// Tab ID（每个浏览器标签唯一，用于文档锁多标签隔离）
// ============================================================================

// Tab ID 使用 sessionStorage 固化，同一标签页内导航不重新生成，防返回后自我死锁
// sessionStorage 在标签页关闭时自动清除，但 F5/导航时保持不变
var currentTabId = (function() {
    try {
        var saved = sessionStorage.getItem('wms_tab_id');
        if (saved) return saved;
        var newId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
            ? crypto.randomUUID()
            : Math.random().toString(36).substring(2) + Date.now().toString(36);
        sessionStorage.setItem('wms_tab_id', newId);
        return newId;
    } catch (e) {
        // sessionStorage 不可用时降级为随机值
        return Math.random().toString(36).substring(2) + Date.now().toString(36);
    }
})();

// ============================================================================
// 配置 (V17.1: 从 env.js 读取，支持多环境部署)
// ============================================================================

var _env = window.__ENV || {};
const CONFIG = {
    n8nBaseUrl: _env.API_BASE_URL || '',
    qrServiceUrl: _env.QR_SERVICE_URL || '',
    appBaseUrl: _env.APP_BASE_URL || '',
    timezone: _env.SYSTEM_TIMEZONE || 'UTC',
    envName: _env.ENV_NAME || 'development',
    soundEnabled: _env.SOUND_ENABLED !== undefined ? _env.SOUND_ENABLED : true,
    autoFocusDelay: _env.AUTO_FOCUS_DELAY || 100,
    debug: _env.DEBUG || false,

    // v0.1.12: WMS 业务配置 (防御性读取, 未配置时使用内置默认值)
    wmsConfig: (function() {
        var raw = _env.WMS_CONFIG || {};
        return {
            DEFAULT_BIN_SUFFIX: raw.DEFAULT_BIN_SUFFIX || 'SYSTEM-BIN-LOCATION',
            BATCH_RULE: raw.BATCH_RULE || 'TODAY',
            PROD_DATE_RULE: raw.PROD_DATE_RULE || 'TODAY',
            ALLOW_OVERAGE: raw.ALLOW_OVERAGE !== undefined ? raw.ALLOW_OVERAGE : false,
            SYSTEM_BIN_FILTER: raw.SYSTEM_BIN_FILTER || 'SYSTEM-BIN',
            MODULES: raw.MODULES || {}
        };
    })()
};

// env.js 加载检测
if (!window.__ENV || !_env.API_BASE_URL) {
    console.error('[WMS] env.js 未加载或 API_BASE_URL 未配置');
}

// ---- 测试环境醒目标识 (红色固定顶栏) ----
if (typeof CONFIG !== 'undefined' && CONFIG.envName === 'testing') {
    document.addEventListener('DOMContentLoaded', function() {
        var banner = document.createElement('div');
        banner.id = 'test-env-banner';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;'
            + 'background:#e53e3e;color:#fff;text-align:center;padding:6px;'
            + 'font-size:14px;font-weight:bold;letter-spacing:2px;';
        banner.textContent = '\u26A0 \u6D4B\u8BD5\u73AF\u5883 \u2014 TEST ENVIRONMENT \u26A0';
        document.body.insertBefore(banner, document.body.firstChild);
        document.body.style.paddingTop = '36px';
    });
}

// ============================================================================
// API 调用
// ============================================================================

/** 默认 API 超时 (ms) — SAP 查询可能较慢 */
var API_TIMEOUT = 120000;

/**
 * 内部: 带超时的 fetch 封装
 */
function _fetchWithTimeout(url, options, timeoutMs) {
    var ms = timeoutMs || API_TIMEOUT;
    options = options || {};
    if (typeof AbortController !== 'undefined') {
        var controller = new AbortController();
        var timeoutId = setTimeout(function () { controller.abort(); }, ms);
        options.signal = controller.signal;
        return fetch(url, options).finally(function () { clearTimeout(timeoutId); });
    }
    return fetch(url, options);
}

/**
 * 内部: 解析并校验 API 响应
 */
async function _parseResponse(response) {
    if (!response.ok) {
        var errText = await response.text();
        throw new Error('HTTP ' + response.status + ': ' + (errText || response.statusText));
    }
    var text = await response.text();
    if (!text || text.trim() === '') {
        throw new Error('服务器返回空响应，请确认n8n工作流已激活');
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error('服务器返回非JSON响应: ' + text.substring(0, 100));
    }
}

/**
 * GET 请求 (带超时 + 空响应防护)
 */
async function apiGet(path) {
    var response = await _fetchWithTimeout(CONFIG.n8nBaseUrl + path, {
        credentials: 'include'
    });
    return _parseResponse(response);
}

/**
 * POST 请求 (带超时 + 空响应防护)
 */
async function apiPost(path, data) {
    var response = await _fetchWithTimeout(CONFIG.n8nBaseUrl + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
    });
    return _parseResponse(response);
}

// ============================================================================
// 扫码处理
// ============================================================================

/**
 * 设置扫码输入框 (Enter键触发回调)
 * @param {string} elementId - 输入框ID
 * @param {Function} callback - 回调函数, 参数为扫描值
 */
// V16.4: 全局焦点抑制标记，业务逻辑可暂时阻止扫码框抢焦点
var _suppressScanFocus = false;
function suppressScanFocus(ms) { _suppressScanFocus = true; setTimeout(function () { _suppressScanFocus = false; }, ms || 500); }

// V20: 移动端软键盘抑制 — 手持扫码枪 (USB HID) 不需要软键盘
var KB_TOGGLE_CLASS = 'kb-toggle-btn';

/**
 * 移动设备检测 — 触控 + 窄屏双重判断
 * 避免 Surface 等触屏笔电误判 (有 touch 但宽屏)
 * @returns {boolean}
 */
function isMobileDevice() {
    var hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    var isNarrow = window.innerWidth <= 768;
    return hasTouch && isNarrow;
}

/**
 * 注入软键盘切换按钮 — 绝对定位在 input 左侧
 * 不创建 wrapper，不移动 DOM，零布局跳动
 * @param {HTMLInputElement} input - 扫码输入框
 */
function _injectKeyboardToggle(input) {
    var btnId = 'kbToggle_' + (input.id || 'default');
    if (document.getElementById(btnId)) return;

    var parent = input.parentNode;
    parent.style.position = 'relative';
    input.classList.add('kb-enabled-input');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = btnId;
    btn.className = KB_TOGGLE_CLASS;
    btn.textContent = '\u2328';
    btn.title = (typeof t === 'function') ? t('keyboard.toggle', '切换软键盘') : '切换软键盘';
    btn.setAttribute('aria-label', '切换软键盘');

    btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var isHidden = input.getAttribute('inputmode') === 'none';
        if (isHidden) {
            input.removeAttribute('inputmode');
            btn.classList.add('kb-active');
            input.focus();
        } else {
            input.setAttribute('inputmode', 'none');
            btn.classList.remove('kb-active');
            input.blur();
            setTimeout(function () { input.focus(); }, 150);
        }
    });

    parent.insertBefore(btn, input);
}

// V17.1: 全局提交防抖 — 防止网络延迟导致重复提交
var _isSubmitting = false;

// V19.2: 单据加载锁 — loadOrder 期间阻止所有扫码
var _isLoadingDoc = false;

// V19.2: 扫码冷却 — 防止连续快速扫码(扫码枪双击)导致误操作
var _lastScanTime = 0;
var SCAN_COOLDOWN_MS = 800;


/**
 * V36: 重置扫码引擎内部状态 (页面切换/测试隔离)
 */
function _resetScannerState() {
    _lastScanTime = 0;
    _isSubmitting = false;
    _isLoadingDoc = false;
}

/**
 * V36-D2: IME 全角→半角清洗工具函数
 * 将全角字母、数字、符号 (U+FF01~U+FF5E) 转换为半角 (U+0021~U+007E)
 * 将全角空格 (U+3000) 转换为半角空格
 * @param {string} str - 可能包含全角字符的字符串
 * @returns {string} 清洗后的半角字符串
 */
function toHalfWidth(str) {
    if (!str) return '';
    return str.replace(/[\uFF01-\uFF5E]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    }).replace(/\u3000/g, ' ');
}

/**
 * 提交防抖包装器 — 在 async 操作期间阻止重复触发
 * @param {Function} fn - async 函数
 * @param {HTMLElement} [btn] - 可选的按钮元素，执行期间自动 disable
 * @returns {*} fn 的返回值，或 undefined（被防抖拦截时）
 */
async function withSubmitGuard(fn, btn) {
    if (_isSubmitting) return;
    _isSubmitting = true;
    var btnText = '';
    if (btn) { btnText = btn.textContent; btn.disabled = true; btn.textContent = t('common.processing', '处理中...'); }
    try {
        return await fn();
    } finally {
        _isSubmitting = false;
        if (btn) { btn.disabled = false; btn.textContent = btnText; }
    }
}

/**
 * V36: 工业级扫码引擎 — 三维度防御 (Buffer超时截断 + IME清洗 + 幽灵回车过滤)
 * @param {string} elementId - 扫码输入框 ID
 * @param {Function} callback - 回调函数, 参数为清洗后的条码值
 */
function setupBarcodeInput(elementId, callback) {
    var input = document.getElementById(elementId);
    if (!input) return;

    // V20: 移动端默认抑制软键盘 (硬件扫码枪作为 USB HID 不需要)
    if (isMobileDevice()) {
        input.setAttribute('inputmode', 'none');
        input.blur(); // 取消 autofocus 导致的键盘弹出
        if (input.classList.contains('scan-input')) {
            _injectKeyboardToggle(input);
        }
    }

    // V37: Edge IME 兼容 — Edge 在中文/泰文 IME 活跃时输入英文字母
    // 会被 IME composition 吃掉 (如 "WO" 被识别为拼音候选 → 取消后清空)。
    // 方案: compositionend 时将 IME 提交的文本追加回输入框，防止丢失。
    var _composingText = '';
    input.addEventListener('compositionstart', function () {
        // 记住 composition 开始前的已有内容
        _composingText = input.value;
    });
    input.addEventListener('compositionend', function (e) {
        // IME 结束后，如果输入框被清空但有 data，恢复内容
        var committed = e.data || '';
        if (committed && !input.value) {
            input.value = _composingText + committed;
        }
        _composingText = '';
    });

    // V36-D1: 每个输入框独立的按键时间戳 (闭包隔离，支持多输入框)
    var _lastKeyTime = 0;

    input.addEventListener('keydown', function (e) {
        var now = Date.now();

        // V36-D2: 忽略 IME 合成事件 (Process 键 / isComposing 状态)
        if (e.key === 'Process' || e.isComposing) return;

        if (e.key === 'Enter') {
            e.preventDefault();
            // V17.1: 提交中时忽略扫码回车，防止网络延迟期间重复扫码
            if (_isSubmitting) return;
            // V19.2: 单据加载中忽略扫码
            if (_isLoadingDoc) {
                input.value = '';
                showMessage('单据加载中，请稍候...', 'warning');
                return;
            }
            // V19.2: 扫码冷却 — 距上次扫码不足 800ms 时静默忽略
            if (now - _lastScanTime < SCAN_COOLDOWN_MS) {
                input.value = '';
                return;
            }
            // V36-D2: IME 全角→半角清洗
            var value = toHalfWidth(input.value).trim();
            // V36-D3: 幽灵回车过滤 — buffer 为空时直接忽略，绝不调用业务处理函数
            if (!value) return;

            _lastScanTime = now;
            callback(value);
            input.value = '';
            _lastKeyTime = 0;
            // V20: 移动端扫码完成后自动关闭软键盘
            if (isMobileDevice() && input.getAttribute('inputmode') !== 'none') {
                input.setAttribute('inputmode', 'none');
                var kbBtn = document.getElementById('kbToggle_' + input.id);
                if (kbBtn) kbBtn.classList.remove('kb-active');
            }
            // V16.4: 如果业务逻辑要求焦点转移到其他输入框，不抢焦点
            setTimeout(function () { if (!_suppressScanFocus) input.focus(); }, 100);
            return;
        }

        _lastKeyTime = now;
    });

    // 自动聚焦 (移动端用 inputmode=none 聚焦，不弹键盘)
    setTimeout(function () { input.focus(); }, CONFIG.autoFocusDelay);
}

/**
 * V19.2: 数量输入框防护 — 拦截扫码枪误扫入数量栏
 * 在数量输入框上监听 Enter，检查值是否合理（非零、不超阈值10倍）
 * @param {string} qtyInputId - 数量输入框 ID
 * @param {Function} getMaxFn - 返回当前行最大合理数量
 */
function setupQtyInputGuard(qtyInputId, getMaxFn) {
    var input = document.getElementById(qtyInputId);
    if (!input) return;
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            var val = parseFloat(input.value);
            var max = getMaxFn();
            // 如果值超过合理上限 10 倍，极可能是扫码枪误扫 → 拦截
            if (!isNaN(val) && max > 0 && val > max * 10) {
                e.preventDefault();
                e.stopPropagation();
                playErrorSound();
                showMessage('数量异常 (' + formatNumber(val) + ')，疑似扫码枪误触，已拦截', 'error');
                input.value = max;
                input.select();
                return false;
            }
        }
    });
}

/**
 * 扫码路由 - 根据条码前缀跳转到对应页面 (门户页用)
 * 新规则: 前缀直连数字(如PO26000178), 无连字符
 * @param {string} barcode - 条码值
 */
function routeBarcode(barcode) {
    var upper = barcode.toUpperCase();

    // DD 前缀: 保留完整单号 (so.js 需要 DD 前缀识别 DD 模式)
    if (upper.startsWith('DD') && /^\d+$/.test(barcode.substring(2))) {
        playSuccessSound();
        window.location.href = 'so.html?docnum=' + encodeURIComponent(upper);
        return true;
    }

    // 前缀直连数字: PO26000178, WO25001026, SO26000050, PI25001026
    var prefixes = {
        'WO': 'wo.html?docnum=', 'SO': 'so.html?docnum=',
        'PO': 'po.html?docnum=', 'TR': 'tr.html?docnum=',
        'PI': 'pi.html?docnum=',
        'IC': 'ic.html?id=', 'LM': 'lm.html?id='
    };
    for (var p in prefixes) {
        if (upper.startsWith(p) && /^\d+$/.test(barcode.substring(p.length))) {
            playSuccessSound();
            window.location.href = prefixes[p] + encodeURIComponent(barcode.substring(p.length));
            return true;
        }
    }

    // 旧格式警告: PO-xxx, WO-xxx, SO-xxx, TR-xxx, PI-xxx, IC-xxx, LM-xxx
    var oldPrefixes = ['WO-', 'SO-', 'PO-', 'TR-', 'PI-', 'IC-', 'LM-'];
    for (var i = 0; i < oldPrefixes.length; i++) {
        if (upper.startsWith(oldPrefixes[i])) {
            var typeName = oldPrefixes[i].replace('-', '');
            var num = barcode.substring(oldPrefixes[i].length);
            playWarningSound();
            showMessage('旧格式条码! 请使用新格式: ' + typeName + num + ' (无连字符)', 'warning');
            return false;
        }
    }

    // 纯数字
    if (/^\d+$/.test(barcode)) {
        playWarningSound();
        showMessage('纯数字条码，请使用前缀格式 (如 WO' + barcode + ', PO' + barcode + ')', 'warning');
        return false;
    }

    // 含-号或长度>8: 物料代码 → 跳转库存查询
    if (barcode.indexOf('-') >= 0 || barcode.length > 8) {
        playSuccessSound();
        window.location.href = 'stock.html?item=' + encodeURIComponent(barcode);
        return true;
    }

    // 无法识别
    playErrorSound();
    showMessage('无法识别条码: ' + escapeHtml(barcode), 'warning');
    return false;
}

/**
 * 子页面条码处理 - 智能路由 + 物料代码过滤
 * @param {string} barcode - 扫描到的条码
 * @param {string} currentPrefix - 当前页面前缀 (如 'SO', 'PO', 'WO', 'TR', 'PI', 'IC', 'LM')
 * @param {Function} loadFn - 当前页面的加载函数 (传入纯单号)
 * @param {Function} [filterFn] - 行项目物料过滤函数 (传入物料代码)
 */
var _mismatchBarcode = null;

function handleSubpageBarcode(barcode, currentPrefix, loadFn, filterFn) {
    var upper = barcode.toUpperCase();
    var currentUpper = currentPrefix.toUpperCase();

    // === SAP单据前缀(无连字符): PO26000178, WO25001026 ===
    var sapPrefixes = {
        'WO': 'wo.html?docnum=', 'SO': 'so.html?docnum=',
        'PO': 'po.html?docnum=', 'TR': 'tr.html?docnum=',
        'PI': 'pi.html?docnum=', 'DD': 'so.html?docnum=',
        'IC': 'ic.html?id=', 'LM': 'lm.html?id='
    };

    // DD 前缀特殊处理: 保留完整单号 (DD26000001 不剥离前缀, wf1c 需要 DD 前缀触发 OMS 模式)
    var keepPrefixTypes = { 'DD': true };

    // 当前前缀直连数字匹配 → 剥离前缀加载 (DD 保留完整单号)
    if (upper.startsWith(currentUpper) && /^\d+$/.test(barcode.substring(currentUpper.length))
        && sapPrefixes[currentUpper]) {
        _mismatchBarcode = null;
        loadFn(keepPrefixTypes[currentUpper] ? barcode : barcode.substring(currentUpper.length));
        return;
    }

    // 其他前缀直连数字 → 第一次警告，第二次跳转
    for (var p in sapPrefixes) {
        if (p !== currentUpper && upper.startsWith(p) && /^\d+$/.test(barcode.substring(p.length))) {
            if (_mismatchBarcode !== barcode) {
                _mismatchBarcode = barcode;
                playWarningSound();
                showMessage('单据不匹配! 当前' + currentPrefix + ', 条码是' + p + '。再次回车跳转', 'warning');
                return;
            }
            _mismatchBarcode = null;
            // DD 保留完整单号, 其他剥离前缀
            var navParam = keepPrefixTypes[p] ? barcode : barcode.substring(p.length);
            window.location.href = sapPrefixes[p] + encodeURIComponent(navParam);
            return;
        }
    }

    // 旧格式警告: WO-xxx, PO-xxx, SO-xxx, TR-xxx, PI-xxx, IC-xxx, LM-xxx
    var oldPrefixes = ['WO-', 'SO-', 'PO-', 'TR-', 'PI-', 'IC-', 'LM-'];
    for (var oi = 0; oi < oldPrefixes.length; oi++) {
        if (upper.startsWith(oldPrefixes[oi])) {
            var typeName2 = oldPrefixes[oi].replace('-', '');
            var num2 = barcode.substring(oldPrefixes[oi].length);
            _mismatchBarcode = null;
            showMessage('旧格式条码! 请使用新格式: ' + typeName2 + num2 + ' (无连字符)', 'warning');
            playWarningSound();
            return;
        }
    }

    // 含-号或长度>8 → 行项目物料代码
    if (barcode.indexOf('-') >= 0 || barcode.length > 8) {
        _mismatchBarcode = null;
        if (typeof filterFn === 'function') {
            filterFn(barcode);
        } else {
            playWarningSound();
            showMessage('物料代码: ' + escapeHtml(barcode) + '，当前页面不支持物料过滤', 'warning');
        }
        return;
    }

    // 纯数字/短字符串 → 当前页面加载单据号
    _mismatchBarcode = null;
    loadFn(barcode);
}

/**
 * 在已加载行项目中按物料代码过滤 (智能免弹窗版)
 *
 * 规则 1 — 防子串越权: 仅精确匹配 (忽略大小写)，扫 ITEM-1 绝不命中 ITEM-10
 * 规则 2 — 多行智能过滤:
 *   场景 A (全完成): 非阻断警告 "该物料已全部作业完毕"，不弹窗
 *   场景 B (剩 1 行): 自动选中，不弹窗
 *   场景 C (剩 >=2 行): 仅传未完成行给选择弹窗
 * 规则 3 — 单据状态前置: docStatus='completed' 时直接拦截
 *
 * @param {string} scannedCode - 扫描的物料代码
 * @param {Array} lines - 行项目数组 (每项需有 itemCode, lineNum, itemName)
 * @param {Function} selectLineFn - 选中行的回调 selectLine(lineNum)
 * @param {Function} [checkCompleteFn] - 可选的完成检查函数,返回 {isComplete: boolean, remaining: number}
 * @param {Object} [options] - 扩展选项
 * @param {string} [options.docStatus] - 单据头状态 ('completed' 时拦截扫码)
 */
function filterLineByItemCode(scannedCode, lines, selectLineFn, checkCompleteFn, options) {
    // 规则 3: 单据状态前置 — 主单据已完成时直接拦截
    if (options && options.docStatus === 'completed') {
        playWarningSound();
        showMessage('当前单据已完成，无法继续扫码作业', 'warning');
        focusScanInput();
        return;
    }

    if (!lines || lines.length === 0) {
        showMessage('请先加载单据', 'warning');
        return;
    }
    var upper = scannedCode.toUpperCase();

    // 规则 1: 精确匹配 (忽略大小写)，禁止子串/部分匹配
    var matched = lines.filter(function (l) {
        return l.itemCode && l.itemCode.toUpperCase() === upper;
    });

    // 无匹配
    if (matched.length === 0) {
        showMessage('当前单据不包含物料: ' + escapeHtml(scannedCode), 'error');
        playErrorSound();
        focusScanInput();
        return;
    }

    // 单行匹配 — 直接选中 (保留溢出软确认)
    if (matched.length === 1) {
        if (typeof checkCompleteFn === 'function') {
            var checkResult = checkCompleteFn(matched[0].lineNum);
            if (checkResult && checkResult.isComplete) {
                playErrorSound();
                if (!confirm('该行已完成 (剩余: ' + formatNumber(checkResult.remaining) + ')，是否继续录入？')) {
                    focusScanInput();
                    return;
                }
            }
        }
        playSuccessSound();
        selectLineFn(matched[0].lineNum);
        return;
    }

    // 规则 2: 多行智能过滤 — 先筛出尚未作业完成的行
    var actionable = matched;
    if (typeof checkCompleteFn === 'function') {
        actionable = matched.filter(function (l) {
            var cr = checkCompleteFn(l.lineNum);
            return !cr || !cr.isComplete;
        });
    }

    // 场景 A: 全部完成 → 非阻断警告，不弹窗
    if (actionable.length === 0) {
        playWarningSound();
        showMessage('该物料已全部作业完毕', 'warning');
        focusScanInput();
        return;
    }

    // 场景 B: 仅剩 1 行 → 自动选中，不弹窗
    if (actionable.length === 1) {
        playSuccessSound();
        selectLineFn(actionable[0].lineNum);
        return;
    }

    // 场景 C: 剩 >=2 行 → 仅传未完成行给弹窗
    showLineSelectionModal(scannedCode, actionable, function (lineNum) {
        playSuccessSound();
        selectLineFn(lineNum);
    });
}

/**
 * 显示行项目选择模态框
 */
function showLineSelectionModal(code, matchedLines, selectLineFn) {
    var existing = document.getElementById('lineSelectModal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'lineSelectModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';

    var container = document.createElement('div');
    container.style.cssText = 'background:#fff;border-radius:12px;padding:20px;max-width:400px;width:90%;max-height:70vh;overflow-y:auto;';

    var title = document.createElement('h3');
    title.style.cssText = 'margin:0 0 12px;font-size:1rem;';
    title.textContent = '物料 ' + code + ' 匹配多行';
    container.appendChild(title);

    matchedLines.forEach(function (l) {
        var safeLineNum = parseInt(l.lineNum, 10) || 0;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.style.cssText = 'display:block;width:100%;padding:12px;margin:6px 0;border:1px solid #ddd;border-radius:8px;background:#f8f9fa;cursor:pointer;text-align:left;font-size:0.95rem;';
        btn.textContent = '行 ' + safeLineNum + ': ' + (l.itemCode || '') + ' - ' + (l.itemName || '');
        btn.addEventListener('click', function () {
            modal.remove();
            selectLineFn(safeLineNum);
        });
        container.appendChild(btn);
    });

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.style.cssText = 'display:block;width:100%;padding:10px;margin-top:12px;border:none;background:#e74c3c;color:#fff;border-radius:8px;cursor:pointer;';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', function () {
        modal.remove();
        focusScanInput();
    });
    container.appendChild(cancelBtn);

    modal.appendChild(container);
    document.body.appendChild(modal);
}

/**
 * 生成条码/二维码图片URL
 * 优先使用本地JS库生成 (离线可用), 降级到远程服务
 */
function generateBarcodeUrl(content, type) {
    type = type || 'qrcode';

    // 尝试本地生成 (JsBarcode / QRCode)
    if (type === 'qrcode' && typeof QRCode !== 'undefined') {
        return _generateLocalQR(content);
    }
    if (type === 'barcode' && typeof JsBarcode !== 'undefined') {
        return _generateLocalBarcode(content);
    }

    // 降级: 远程服务
    return CONFIG.qrServiceUrl + '/generate?content=' + encodeURIComponent(content) + '&type=' + type;
}

// 本地QR码生成 (返回 data:image URL)
function _generateLocalQR(content) {
    try {
        var div = document.createElement('div');
        new QRCode(div, {
            text: content || '',
            width: 128,
            height: 128,
            correctLevel: QRCode.CorrectLevel.M
        });
        var img = div.querySelector('img');
        var canvas = div.querySelector('canvas');
        if (canvas) return canvas.toDataURL('image/png');
        if (img && img.src) return img.src;
    } catch (e) {
        console.warn('本地QR生成失败:', e);
    }
    return CONFIG.qrServiceUrl + '/generate?content=' + encodeURIComponent(content) + '&type=qrcode';
}

// 本地条码生成 (返回 data:image URL)
function _generateLocalBarcode(content) {
    try {
        var canvas = document.createElement('canvas');
        JsBarcode(canvas, content || '', {
            format: 'CODE128',
            width: 2,
            height: 60,
            displayValue: true,
            fontSize: 12,
            margin: 5
        });
        return canvas.toDataURL('image/png');
    } catch (e) {
        console.warn('本地条码生成失败:', e);
    }
    return CONFIG.qrServiceUrl + '/generate?content=' + encodeURIComponent(content) + '&type=barcode';
}

// ============================================================================
// UI 反馈
// ============================================================================

/**
 * 显示Toast消息
 */
function showMessage(message, type) {
    type = type || 'info';
    // 移除现有消息
    document.querySelectorAll('.message-toast').forEach(function (el) { el.remove(); });

    var toast = document.createElement('div');
    toast.className = 'message-toast ' + type;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(function () {
        toast.classList.add('fade-out');
        setTimeout(function () { toast.remove(); }, 300);
    }, 3000);
}

/**
 * 显示/隐藏加载指示器
 */
function showLoading(show) {
    var loader = document.getElementById('loader');
    if (loader) {
        loader.style.display = show ? 'flex' : 'none';
    }
}

/**
 * 显示扫码成功指示器
 */
function showBeepIndicator() {
    var indicator = document.getElementById('beepIndicator');
    if (!indicator) return;
    indicator.classList.add('show');
    setTimeout(function () { indicator.classList.remove('show'); }, 500);
}

// ============================================================================
// 音效
// ============================================================================

function playBeepSound() {
    if (!CONFIG.soundEnabled) return;
    try {
        var audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBjKM0fPTgjMGHm7A7+OZSA0PVKvm7bFgGQg+mNryzn0pBSp+zPLaizsIGGS26eWcTQ0OUKXi8LViFQc4jtTxzXwqBSp9y/HakDoIGGO16OSbTgwPUqTi8LVhFgc5j9Txzn4rBSl+yvHajzsIF2K06OScTQwPUqTh77RhFgc5jtTyz34rBSh+yvDajzsIF2K06OObTgwOUqPi8LVhFgc4jtTxz34qBSl+yvHajDsIGGO16OScTQwOUqPh8LVhFgc5jtPxz34rBSl+yvHajDsIF2K06OSbTgwOUqPh8LVhFgc5jtPyz34qBSl+yvHajTsIF2O16OSbTgwOUqPi8LVhFgc4jtTyz34rBSh+yvHajTsIF2O16OSbTgwOUqPh8LVhFgc4jtTxz34qBSh+yvHajDsIGGK06OWbTwwOUqPi8LVhFgc4jtPyz4ArBSh+yvHbjDsIF2K06OWbTwwOUqPi8LVhFgc4jtPyz4AqBSh+yvHbjDsIF2K06OWbTwwOUqLi8LVhFgc4jtPyz4AqBSh+yvHbjDsIF2K06OWbTwwOUqLi8LVhFgc4jtPyz4AqBSh+yvHbjDsIF2K06OWbTwwNU6Li8LVhFgc4jtPyz4AqBSh+yvHbjDsIF2K06OWbTwwNU6Li8LVhFgc4jtPyz4AqBSh+yvHbjDsI');
        audio.play().catch(function () { });
    } catch (e) { }
}

function playSuccessSound() {
    if (!CONFIG.soundEnabled) return;
    try {
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
    } catch (e) { }
}

/**
 * 将焦点归还到扫码输入框 (错误/取消后恢复扫码状态)
 */
function focusScanInput() {
    setTimeout(function () {
        var el = document.getElementById('scanInput');
        if (el) { el.value = ''; el.focus(); }
    }, 100);
}

function playErrorSound() {
    if (!CONFIG.soundEnabled) return;
    try {
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 440;
        osc.type = 'square';
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
    } catch (e) { }
}

// ============================================================================
// localStorage 状态管理
// ============================================================================

function saveState(key, data) {
    try {
        localStorage.setItem('wms_' + key, JSON.stringify(data));
    } catch (e) {
        console.error('保存状态失败:', e);
    }
}

function loadState(key) {
    try {
        var saved = localStorage.getItem('wms_' + key);
        return saved ? JSON.parse(saved) : null;
    } catch (e) {
        console.error('加载状态失败:', e);
        return null;
    }
}

function clearState(key) {
    try {
        localStorage.removeItem('wms_' + key);
    } catch (e) { }
}

// ============================================================================
// 数据校验
// ============================================================================

/**
 * 校验必填字段
 */
function validateRequired(fields) {
    for (var i = 0; i < fields.length; i++) {
        var el = document.getElementById(fields[i].id);
        if (!el) continue;
        var val = el.value.trim();
        if (!val) {
            showMessage('请填写: ' + fields[i].name, 'error');
            el.focus();
            return false;
        }
    }
    return true;
}

/**
 * 校验数字范围
 */
function validateNumber(value, min, max, fieldName) {
    var num = parseFloat(value);
    if (isNaN(num)) {
        showMessage(fieldName + ' 必须是数字', 'error');
        return false;
    }
    if (min !== undefined && num < min) {
        showMessage(fieldName + ' 不能小于 ' + min, 'error');
        return false;
    }
    if (max !== undefined && num > max) {
        showMessage(fieldName + ' 不能大于 ' + formatNumber(max), 'error');
        return false;
    }
    return true;
}

// ============================================================================
// 格式化
// ============================================================================

function formatNumber(num) {
    if (num === null || num === undefined) return '-';
    return parseFloat(num).toLocaleString('zh-CN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 4
    });
}

/**
 * 数量精度修正 - 消除浮点误差
 * 小于 0.001 的值视为 0 (SAP UOM精度最多4位小数)
 */
function roundQty(val) {
    if (typeof val !== 'number' || isNaN(val)) return 0;
    return Math.abs(val) < 0.001 ? 0 : Math.round(val * 10000) / 10000;
}

/**
 * 系统时区时间 "YYYY-MM-DD HH:MM:SS" (sv-SE locale 天然输出 ISO 格式)
 * 时区来源: CONFIG.timezone ← env.js SYSTEM_TIMEZONE ← .env
 */
function getSystemDateTime() {
    return new Date().toLocaleString('sv-SE', { timeZone: CONFIG.timezone });
}

/** 系统时区日期 "YYYY-MM-DD" */
function getSystemToday() {
    return new Date().toLocaleString('sv-SE', { timeZone: CONFIG.timezone }).slice(0, 10);
}

/** 系统时区日期 "YYYYMMDD" (批次号用) */
function getSystemYYYYMMDD() {
    return getSystemToday().replace(/-/g, '');
}

// ============================================================================
// WMS 业务配置函数 (v0.1.12: 配置感知, 支持多公司部署)
// ============================================================================

/** 获取模块级配置 (模块覆盖 > 全局默认) */
function getModuleConfig(docType, key) {
    var wc = CONFIG.wmsConfig;
    var mod = (wc.MODULES && wc.MODULES[docType]) || {};
    return mod[key] !== undefined ? mod[key] : wc[key];
}

/** 获取默认库位: {whsCode}-{suffix} */
function getDefaultBin(whsCode, docType) {
    var suffix = getModuleConfig(docType, 'DEFAULT_BIN_SUFFIX');
    return (whsCode || 'SYSTEM') + '-' + suffix;
}

/** 获取默认批次号 (TODAY→YYYYMMDD / REF_NUM→单据号 / EMPTY→空) */
function getDefaultBatch(docType, refNum) {
    var rule = getModuleConfig(docType, 'BATCH_RULE');
    switch (rule) {
        case 'REF_NUM': return refNum || getSystemYYYYMMDD();
        case 'EMPTY':   return '';
        case 'TODAY':
        default:         return getSystemYYYYMMDD();
    }
}

/** 获取默认生产日期 (TODAY→YYYYMMDD / EMPTY→空) */
function getDefaultProdDate(docType) {
    var rule = getModuleConfig(docType, 'PROD_DATE_RULE');
    switch (rule) {
        case 'EMPTY': return '';
        case 'TODAY':
        default:       return getSystemYYYYMMDD();
    }
}

/** 收货默认值聚合 */
function getReceiptDefaults(whsCode, docType, refNum) {
    return {
        bin: getDefaultBin(whsCode, docType),
        batch: getDefaultBatch(docType, refNum),
        prodDate: getDefaultProdDate(docType)
    };
}

/** 判断是否为系统默认库位 (库位历史过滤用) */
function isSystemBin(binValue) {
    if (!binValue) return false;
    var filter = CONFIG.wmsConfig.SYSTEM_BIN_FILTER;
    return binValue.indexOf(filter) !== -1;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    var date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', { timeZone: CONFIG.timezone });
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    var date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
        timeZone: CONFIG.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================================
// 状态文本映射
// ============================================================================

var DOC_TYPE_LABELS = {
    'SO': '销售订单',
    'WO': '生产订单',
    'PO': '采购订单',
    'DD': '配送单',
    'TR': '调拨申请',
    'IC': '库存盘点',
    'LM': '库位移动',
    'PI': '生产发货'
};

var STATUS_LABELS = {
    'pending': '待处理',
    'draft': '草稿',
    'in_progress': '执行中',
    'split': '已拆分',
    'completed': '已完成',
    'cancelled': '已取消',
    'exported': '已导出'
};

function getDocTypeLabel(type) {
    return DOC_TYPE_LABELS[type] || type;
}

function getStatusLabel(status) {
    return STATUS_LABELS[status] || status;
}

/**
 * 渲染单据头状态 - SAP状态和WMS状态独立显示
 * @param {string} sapStatus - SAP单据状态 (O=未清, C=已关闭, R=Released, P=Planned, L=已关闭)
 * @param {string} wmsStatus - WMS状态 (pending, in_progress, completed, exported)
 * @param {string} sapElId - SAP状态DOM元素ID
 * @param {string} [wmsElId] - WMS状态DOM元素ID (可选,兼容旧调用)
 */
function renderHeaderStatus(sapStatus, wmsStatus, sapElId, wmsElId) {
    var sapLabel = (sapStatus === 'O') ? '未清' :
                   (sapStatus === 'C') ? '已关闭' :
                   (sapStatus === 'R') ? '已下达' :
                   (sapStatus === 'P') ? '已计划' :
                   (sapStatus === 'L') ? '已关闭' :
                   sapStatus || '-';
    var sapClosed = (sapStatus !== 'O' && sapStatus !== 'R' && sapStatus !== 'P');

    var sapEl = document.getElementById(sapElId);
    if (sapEl) {
        sapEl.textContent = sapLabel;
        sapEl.style.color = sapClosed ? '#e74c3c' : '';
    }

    // WMS状态独立显示
    var wmsEl = wmsElId ? document.getElementById(wmsElId) : null;
    if (wmsEl) {
        var wmsLabel = getStatusLabel(wmsStatus);
        wmsEl.textContent = wmsLabel;
        // WMS状态颜色
        wmsEl.style.color = (wmsStatus === 'completed') ? '#16a34a' :
                            (wmsStatus === 'in_progress') ? '#2563eb' :
                            (wmsStatus === 'exported') ? '#9333ea' :
                            (wmsStatus === 'split') ? '#9d174d' : '';
    } else if (sapEl) {
        // 兼容: 没有独立WMS元素时,附加在SAP元素后 (安全: 使用 DOM API 防 XSS)
        sapEl.textContent = '';
        sapEl.appendChild(document.createTextNode(sapLabel + ' '));
        var wmsSpan = document.createElement('span');
        wmsSpan.style.cssText = 'font-size:0.8em;color:#666';
        wmsSpan.textContent = '(' + getStatusLabel(wmsStatus) + ')';
        sapEl.appendChild(wmsSpan);
        sapEl.style.color = sapClosed ? '#e74c3c' : '';
    }
}

// ============================================================================
// 单据类型 SVG 图标
// ============================================================================

function getDocTypeIcon(type, size) {
    size = size || 40;
    var icons = {
        'PO': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="#2563eb"/><path d="M12 28 L12 16 L18 16 L22 12 L28 12 L28 24 L22 24 L22 28 Z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M15 20 L25 20 M15 24 L22 24" stroke="#fff" stroke-width="1.5"/><path d="M28 18 L32 14" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity="0.7"/></svg>',
        'WO': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="#7c3aed"/><circle cx="20" cy="20" r="8" fill="none" stroke="#fff" stroke-width="2"/><circle cx="20" cy="20" r="3" fill="#fff"/><path d="M20 9 L20 12 M20 28 L20 31 M9 20 L12 20 M28 20 L31 20" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
        'PI': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="#a855f7"/><circle cx="16" cy="18" r="5" fill="none" stroke="#fff" stroke-width="1.5"/><circle cx="16" cy="18" r="2" fill="#fff"/><path d="M22 18 L30 18 M26 14 L30 18 L26 22" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 26 L26 26" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/></svg>',
        'SO': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="#10b981"/><rect x="12" y="11" width="16" height="20" rx="2" fill="none" stroke="#fff" stroke-width="2"/><path d="M16 16 L24 16 M16 20 L24 20 M16 24 L20 24" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><path d="M26 15 L30 11" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity="0.7"/></svg>',
        'TR': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="#f59e0b"/><path d="M10 20 L17 20 M23 20 L30 20" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><path d="M14 16 L10 20 L14 24" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M26 16 L30 20 L26 24" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="17" y="15" width="6" height="10" rx="1" fill="none" stroke="#fff" stroke-width="1.5"/></svg>',
        'LM': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="#06b6d4"/><path d="M20 10 L28 18 L20 30 L12 18 Z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><circle cx="20" cy="19" r="4" fill="#fff" opacity="0.9"/><circle cx="20" cy="19" r="2" fill="#06b6d4"/></svg>',
        'IC': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="#6b7280"/><rect x="12" y="9" width="16" height="22" rx="2" fill="none" stroke="#fff" stroke-width="2"/><path d="M16 9 L16 12 L24 12 L24 9" stroke="#fff" stroke-width="2"/><path d="M15 17 L18 20 L25 13" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 25 L25 25" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/></svg>',
        'DD': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="#ec4899"/><path d="M11 14 L25 14 L29 20 L25 26 L11 26 Z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M15 18 L23 18 M15 22 L21 22" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><circle cx="29" cy="20" r="2" fill="#fff"/></svg>'
    };
    var svg = icons[type] || icons['IC'];
    return '<img src="data:image/svg+xml,' + encodeURIComponent(svg) + '" width="' + size + '" height="' + size + '" alt="' + type + '" style="vertical-align:middle;">';
}


// ============================================================================
// URL参数解析
// ============================================================================

function getUrlParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name);
}

// ============================================================================
// 打印
// ============================================================================

function printDocument() {
    window.print();
}

// ============================================================================
// 警告音效
// ============================================================================

function playWarningSound() {
    if (!CONFIG.soundEnabled) return;
    try {
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        for (var i = 0; i < 2; i++) {
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 300;
            osc.type = 'sawtooth';
            gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.2);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.2 + 0.15);
            osc.start(ctx.currentTime + i * 0.2);
            osc.stop(ctx.currentTime + i * 0.2 + 0.15);
        }
    } catch (e) { }
}

/**
 * V18.5: 单据加载后声音反馈
 * - 已完成/已导出 → 提醒音 (非错误音)
 * - 正常加载 → 成功音
 */
function notifyDocLoaded(status) {
    if (status === 'completed' || status === 'exported' || status === '已完成') {
        playWarningSound();
    } else {
        playSuccessSound();
    }
}

// ============================================================================
// 操作人管理
// ============================================================================

function getOperators() {
    var ops = loadState('operators');
    if (!ops || !Array.isArray(ops) || ops.length === 0) {
        ops = ['WMS'];
        saveState('operators', ops);
    }
    if (ops.indexOf('WMS') < 0) {
        ops.unshift('WMS');
        saveState('operators', ops);
    }
    return ops;
}

function addOperator(name) {
    if (!name) return;
    var ops = getOperators();
    if (ops.indexOf(name) < 0) {
        ops.push(name);
        saveState('operators', ops);
    }
}

function getCurrentOperator() {
    // 优先使用登录用户名(wms_users.username)，兼容旧的last_user
    var loginUser = typeof getLoginUsername === 'function' ? getLoginUsername() : null;
    if (loginUser && loginUser !== 'unknown') return loginUser;
    var saved = loadState('last_user');
    return saved || 'WMS';
}

function initOperatorSelect(inputId) {
    var input = document.getElementById(inputId);
    if (!input) return;

    var listId = inputId + '_list';
    var datalist = document.createElement('datalist');
    datalist.id = listId;
    input.parentNode.appendChild(datalist);
    input.setAttribute('list', listId);

    function refreshOptions() {
        datalist.innerHTML = '';
        getOperators().forEach(function (op) {
            var opt = document.createElement('option');
            opt.value = op;
            datalist.appendChild(opt);
        });
    }
    refreshOptions();
    input.value = getCurrentOperator();

    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '+';
    addBtn.className = 'btn btn-outline';
    addBtn.style.cssText = 'padding:6px 14px;margin-left:8px;font-size:1.1rem;vertical-align:middle;flex-shrink:0;';
    addBtn.title = '添加新操作人';
    addBtn.onclick = function () {
        var name = prompt('输入新操作人名称:');
        if (name && name.trim()) {
            name = name.trim();
            addOperator(name);
            refreshOptions();
            input.value = name;
        }
    };

    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;align-items:center;';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);
    wrapper.appendChild(addBtn);

    input.addEventListener('change', function () {
        if (input.value.trim()) {
            saveState('last_user', input.value.trim());
            addOperator(input.value.trim());
            refreshOptions();
        }
    });
}

// ============================================================================
// 数量超限实时警告
// ============================================================================

function setupQtyWarning(qtyInputId, getMaxFn) {
    var input = document.getElementById(qtyInputId);
    if (!input) return;

    var warningThrottle = 0;
    input.addEventListener('input', function () {
        var val = parseFloat(input.value);
        var max = getMaxFn();
        if (!isNaN(val) && val > max && max > 0) {
            input.style.borderColor = 'var(--error-color, #ef4444)';
            input.style.background = '#fff0f0';
            var now = Date.now();
            if (now - warningThrottle > 2000) {
                warningThrottle = now;
                playWarningSound();
                showMessage('数量 ' + formatNumber(val) + ' 超过剩余 ' + formatNumber(max) + '!', 'warning');
            }
        } else {
            input.style.borderColor = '';
            input.style.background = '';
        }
    });
}

function validateOverQty(qty, remaining, remark, remarkInputId, confirmMsg) {
    qty = roundQty(qty);
    remaining = roundQty(remaining);
    if (qty > remaining && remaining > 0) {
        if (!remark) {
            playWarningSound();
            showMessage('数量超过剩余! 如需超收/超发, 请在备注中填写原因', 'error');
            var remarkEl = document.getElementById(remarkInputId);
            if (remarkEl) remarkEl.focus();
            return false;
        }
        if (!confirm('⚠ 数量 ' + formatNumber(qty) + ' 超过剩余 ' + formatNumber(remaining) + '!\n备注: ' + remark + '\n确认继续?')) {
            return false;
        }
        return true;
    }
    if (!confirm(confirmMsg)) return false;
    return true;
}

// ============================================================================
// 一键批量提交
// ============================================================================

async function batchSubmitAll(openLines, buildPayloadFn, actionLabel) {
    if (openLines.length === 0) {
        showMessage('没有待处理的行项目', 'warning');
        return false;
    }
    // V17.1: 防止一键按钮重复点击
    if (_isSubmitting) return false;

    var summary = openLines.map(function (l) {
        return l.itemCode + ' x ' + formatNumber(l._open);
    }).join('\n');

    if (!confirm(actionLabel + ' 以下所有行项目的剩余数量?\n\n' + summary)) {
        return false;
    }

    _isSubmitting = true;
    showLoading(true);
    var successCount = 0;
    var errors = [];

    try {
        for (var i = 0; i < openLines.length; i++) {
            try {
                var payload = buildPayloadFn(openLines[i]);
                var result = await apiPost('/transaction', payload);
                if (result && result.success) {
                    successCount++;
                } else {
                    errors.push(openLines[i].itemCode + ': ' + (result && result.message ? result.message : '未知错误'));
                }
            } catch (e) {
                errors.push(openLines[i].itemCode + ': ' + e.message);
                break; // 熔断: 网络/服务器异常立刻停止，避免连续无效请求
            }
        }
    } finally {
        _isSubmitting = false;
        showLoading(false);
    }

    if (errors.length > 0) {
        showMessage('完成 ' + successCount + '/' + openLines.length + ', 失败: ' + errors.join('; '), 'warning');
        playErrorSound();
    } else {
        showMessage(actionLabel + '成功! 共 ' + successCount + ' 行', 'success');
        playSuccessSound();
    }
    // V16.4: 一键操作完成后释放锁，防止"幽灵锁"阻断下一单
    await releaseDocumentLock();
    return true;
}

// ============================================================================
// 主数据缓存验证 (V15.4)
// ============================================================================

/**
 * 从服务器加载主数据到 localStorage（每24小时自动刷新）
 * 在 ic.html / lm.html 的 initXxx() 中调用
 */
async function loadMasterDataCache(forceRefresh) {
    var CACHE_KEY = 'wms_masterdata';
    var CACHE_TTL = 4 * 60 * 60 * 1000; // V16.1: 缩短为4小时，确保主数据及时更新
    try {
        if (!forceRefresh) {
            var cached = localStorage.getItem(CACHE_KEY);
            if (cached) {
                var obj = JSON.parse(cached);
                if (obj._ts && (Date.now() - obj._ts) < CACHE_TTL) {
                    return; // 缓存未过期，跳过
                }
            }
        }
        var data = await apiGet('/masterdata');
        if (data && data.success) {
            data._ts = Date.now();
            // V19.12: 先清旧缓存再存 (iOS localStorage 限 5MB, 主数据 ~3MB)
            localStorage.removeItem(CACHE_KEY);
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify(data));
            } catch (quotaErr) {
                // QuotaExceededError: 存不下完整数据 → 精简版 (仅仓库+库位, 跳过物料)
                console.warn('localStorage 容量不足, 存储精简版主数据 (无物料列表)');
                var lite = {
                    success: true, _ts: data._ts,
                    warehouses: data.warehouses || [],
                    bins_map: data.bins_map || {},
                    items: [],
                    counts: data.counts || {}
                };
                try {
                    localStorage.setItem(CACHE_KEY, JSON.stringify(lite));
                } catch (e2) {
                    console.warn('精简版也存不下:', e2.message);
                }
            }
        }
    } catch (e) {
        console.warn('主数据缓存加载失败:', e.message);
        showMessage('⚠ 主数据加载失败，仓库/库位校验不可用，请联系管理员', 'error');
    }
}

function _getMasterCache() {
    try {
        var raw = localStorage.getItem('wms_masterdata');
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

/**
 * 从缓存中验证物料代码
 * @returns {object} 物料对象（找到）| false（有缓存但找不到，需阻断）| null（无缓存，放行）
 */
function validateItem(code) {
    var cache = _getMasterCache();
    if (!cache || !cache.items || !cache.items.length) return null;
    var upper = (code || '').toUpperCase();
    var found = cache.items.find(function (i) {
        return (i.item_code || '').toUpperCase() === upper;
    });
    return found || false;
}

/**
 * 从缓存中验证仓库代码
 * @returns {object} 仓库对象（找到）| false（有缓存但找不到，需阻断）| null（无缓存，放行）
 */
function validateWarehouse(code) {
    var cache = _getMasterCache();
    if (!cache || !cache.warehouses || !cache.warehouses.length) return null;
    var upper = (code || '').toUpperCase();
    var found = cache.warehouses.find(function (w) {
        return (w.whs_code || '').toUpperCase() === upper;
    });
    return found || false;
}

/**
 * 从缓存中验证库位代码
 * V17.0: 支持 bins_map 格式 { whs_code: [bin1, bin2, ...] } (压缩70K→~1MB)
 * 同时兼容旧 bins 数组格式 [{ bin_code, whs_code }, ...]
 * @returns {object} 库位对象（找到）| false（有缓存但找不到，需阻断）| null（无缓存，放行）
 */
function validateBin(code) {
    var cache = _getMasterCache();
    if (!cache) return null;
    var upper = (code || '').toUpperCase();

    // V17.0: 新格式 bins_map { whs_code: [bin_code, ...] }
    if (cache.bins_map) {
        var keys = Object.keys(cache.bins_map);
        if (keys.length === 0) return null;
        for (var i = 0; i < keys.length; i++) {
            var whs = keys[i];
            var arr = cache.bins_map[whs];
            if (!arr) continue;
            for (var j = 0; j < arr.length; j++) {
                if ((arr[j] || '').toUpperCase() === upper) {
                    return { bin_code: arr[j], whs_code: whs };
                }
            }
        }
        return false;
    }

    // 旧格式兼容: bins 数组
    if (!cache.bins || !cache.bins.length) return null;
    var found = cache.bins.find(function (b) {
        return (b.bin_code || '').toUpperCase() === upper;
    });
    return found || false;
}

// ============================================================================
// 库位自动补全 + 历史记录 (V18.2)
// ============================================================================

var _BIN_HISTORY_KEY = 'wms_recent_bins';
var _BIN_HISTORY_MAX = 10;

/**
 * 获取所有库位列表 (从 wms_masterdata bins_map)
 * @returns {string[]} 库位代码数组
 */
function _getAllBins() {
    var cache = _getMasterCache();
    if (!cache) return [];
    var bins = [];
    if (cache.bins_map) {
        var keys = Object.keys(cache.bins_map);
        for (var i = 0; i < keys.length; i++) {
            var arr = cache.bins_map[keys[i]];
            if (arr) {
                for (var j = 0; j < arr.length; j++) {
                    if (arr[j] && bins.indexOf(arr[j]) === -1) bins.push(arr[j]);
                }
            }
        }
    } else if (cache.bins) {
        for (var k = 0; k < cache.bins.length; k++) {
            var bc = cache.bins[k].bin_code;
            if (bc && bins.indexOf(bc) === -1) bins.push(bc);
        }
    }
    return bins;
}

/**
 * 获取最近使用的库位历史
 * @returns {string[]}
 */
function _getBinHistory() {
    try {
        var raw = localStorage.getItem(_BIN_HISTORY_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
}

/**
 * 保存库位到最近使用历史
 * @param {string} binCode
 */
function _saveBinHistory(binCode) {
    if (!binCode) return;
    try {
        var history = _getBinHistory();
        var idx = history.indexOf(binCode);
        if (idx !== -1) history.splice(idx, 1);
        history.unshift(binCode);
        if (history.length > _BIN_HISTORY_MAX) history = history.slice(0, _BIN_HISTORY_MAX);
        localStorage.setItem(_BIN_HISTORY_KEY, JSON.stringify(history));
    } catch (e) {}
}

/**
 * 从最近使用历史中移除库位
 * @param {string} binCode
 */
function _removeBinHistory(binCode) {
    if (!binCode) return;
    try {
        var history = _getBinHistory();
        var idx = history.indexOf(binCode);
        if (idx !== -1) {
            history.splice(idx, 1);
            localStorage.setItem(_BIN_HISTORY_KEY, JSON.stringify(history));
        }
    } catch (e) {}
}

/**
 * V18.4: 初始化库位输入 — 仅显示最近历史标签 + blur校验 (轻量版，不卡顿)
 * @param {string} inputId - 输入框 DOM id
 */
function initBinAutocomplete(inputId) {
    var input = document.getElementById(inputId);
    if (!input) return;
    try {
        // 历史标签容器
        var tagBox = document.createElement('div');
        tagBox.className = 'bin-recent-tags';
        input.parentNode.appendChild(tagBox);

        function renderTags() {
            var history = _getBinHistory();
            if (history.length === 0) { tagBox.style.display = 'none'; return; }
            var html = '<span class="bin-recent-label">★ </span>';
            for (var i = 0; i < Math.min(history.length, 5); i++) {
                html += '<span class="bin-recent-chip" data-bin="' + escapeHtml(history[i]) + '">' +
                        escapeHtml(history[i]) + '</span>';
            }
            tagBox.innerHTML = html;
            tagBox.style.display = 'flex';
        }

        // 点击标签快速填入
        tagBox.addEventListener('click', function (e) {
            var chip = e.target.closest('.bin-recent-chip');
            if (chip) {
                input.value = chip.getAttribute('data-bin');
                input.style.borderColor = '#22c55e';
                _saveBinHistory(input.value);
            }
        });

        // 双击标签移除快捷引用
        tagBox.addEventListener('dblclick', function (e) {
            var chip = e.target.closest('.bin-recent-chip');
            if (chip) {
                e.preventDefault();
                var binCode = chip.getAttribute('data-bin');
                _removeBinHistory(binCode);
                renderTags();
                if (typeof showMessage === 'function') showMessage('已移除快捷库位 [' + binCode + ']', 'info');
            }
        });

        // blur 时自动纠正为字典值 (PG 大小写敏感，避免因大小写浪费输入)
        input.addEventListener('blur', function () {
            var raw = input.value.trim();
            if (!raw) return;
            var result = validateBin(raw);
            if (result && result.bin_code) {
                input.value = result.bin_code;
                input.style.borderColor = '#22c55e';
            }
        });

        // 聚焦时显示历史标签
        input.addEventListener('focus', function () { renderTags(); });

        // 提交表单时保存历史
        var form = input.closest('form');
        if (form) {
            form.addEventListener('submit', function () {
                var val = input.value.trim();
                if (val && !isSystemBin(val)) _saveBinHistory(val);
                renderTags();
            });
        }

        // 初始渲染
        renderTags();
    } catch (e) {
        console.error('[WMS] 库位历史初始化失败:', e);
    }
}

// ============================================================================
// 单据并发锁 (V15.4)
// ============================================================================

var _currentLock = null;

/**
 * 进入单据详情页时获取锁
 * @param {string} docType - 单据类型 (PO/SO/WO/TR/PI)
 * @param {string} docNumber - 单据编号
 */
async function acquireDocumentLock(docType, docNumber) {
    // V16.4: 切换单据前，先释放旧锁，防止"幽灵锁"感染新单据
    if (_currentLock && (_currentLock.docNumber !== String(docNumber) || _currentLock.docType !== docType)) {
        await releaseDocumentLock();
    }
    // V16.4: 清除上一单的只读模式和锁横幅
    _setReadonlyMode(false);
    var username = getCurrentOperator();
    try {
        var result = await apiPost('/lock/acquire', {
            doc_type: docType,
            doc_number: String(docNumber),
            username: username,
            tab_id: currentTabId
        });
        if (result && result.success) {
            _currentLock = { docType: docType, docNumber: docNumber, username: username, tab_id: currentTabId };
        } else if (result && !result.success && result.locked_by) {
            // V15.9: 被占用单据 → error级硬阻断
            var lockedMsg = (result.locked_by || '其他用户') + ' 正在操作此单据，请等待对方完成后再试';
            showMessage(lockedMsg, 'error');
            playErrorSound();
            _setReadonlyMode(true, lockedMsg);
        }
    } catch (e) {
        console.warn('获取单据锁失败:', e.message);
        // HTTP 423 (Locked) 表示单据已被他人锁定，必须进入只读模式阻止操作
        if (e.message && e.message.indexOf('HTTP 423') !== -1) {
            var lockMsg = '单据已被其他用户锁定，请等待对方完成后再试';
            showMessage(lockMsg, 'error');
            playErrorSound();
            _setReadonlyMode(true, lockMsg);
        }
    }
}

/**
 * 释放当前持有的单据锁
 */
async function releaseDocumentLock() {
    if (!_currentLock) return;
    var lock = _currentLock;
    _currentLock = null;
    try {
        await apiPost('/lock/release', {
            doc_type: lock.docType,
            doc_number: String(lock.docNumber),
            username: lock.username,
            tab_id: lock.tab_id
        });
    } catch (e) {
        console.warn('释放单据锁失败:', e.message);
    }
}

// 全局 beforeunload：页面销毁时用 sendBeacon 可靠释放锁（比 async fetch 更可靠）
window.addEventListener('beforeunload', function () {
    if (!_currentLock || !_currentLock.docNumber) return;
    var payload = JSON.stringify({
        doc_type: _currentLock.docType,
        doc_number: String(_currentLock.docNumber),
        username: _currentLock.username,
        tab_id: _currentLock.tab_id
    });
    var url = CONFIG.n8nBaseUrl + '/lock/release';
    if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
    }
});

/**
 * 设置页面只读模式
 * @param {boolean} readonly - 是否只读
 * @param {string} [reason] - 锁定原因（被占用时显示横幅）
 */
function _setReadonlyMode(readonly, reason) {
    var btns = document.querySelectorAll('button[type="submit"], .btn-primary, .btn-success, .btn-danger, .btn-oneclick');
    btns.forEach(function (btn) {
        btn.disabled = readonly;
        if (readonly) btn.title = reason || '只读模式';
    });
    var inputs = document.querySelectorAll('input, textarea, select');
    inputs.forEach(function (inp) {
        if (inp.id !== 'scanInput') inp.disabled = readonly;
    });
    // V15.9: 被占用时显示醒目横幅
    var existingBanner = document.getElementById('lockBanner');
    if (existingBanner) existingBanner.remove();
    if (readonly && reason) {
        var banner = document.createElement('div');
        banner.id = 'lockBanner';
        banner.style.cssText = 'background:#fef2f2;border:2px solid #ef4444;color:#dc2626;text-align:center;padding:12px 16px;border-radius:10px;margin:8px 0;font-weight:600;font-size:0.95rem;';
        banner.textContent = reason;
        var container = document.querySelector('.container');
        var firstCard = container ? container.querySelector('.card') : null;
        if (firstCard) container.insertBefore(banner, firstCard);
    }
}

// ============================================================================
// 登录鉴权 (V16.0 → V17.0: SSO 强制化，非 SSO 代码已移除)
// ============================================================================

/**
 * SSO 用户信息初始化 (async, 后台执行)
 * 从 Authelia /api/auth/whoami 获取用户信息并存入 localStorage
 * nginx 已通过 auth_request 保证到达此页面的用户已认证
 */
function _initSSOUser() {
    fetch('/api/auth/whoami', { credentials: 'include' })
        .then(function(res) {
            if (res.status === 200) return res.json();
            return null;
        })
        .then(function(json) {
            if (!json) return;
            // Authelia /api/user/info 响应: { status: "OK", data: { display_name, groups, emails } }
            var data = json.data || json;
            var displayName = data.display_name || '';
            // SSO 模式: display_name 同时作为 username (管理脚本保证唯一性)
            localStorage.setItem('wms_username', displayName);
            localStorage.setItem('wms_display_name', displayName);
            // 角色映射: Authelia groups → WMS role
            var groups = Array.isArray(data.groups) ? data.groups : [];
            var role = 'operator';
            if (groups.indexOf('admins') >= 0) role = 'admin';
            else if (groups.indexOf('qm') >= 0) role = 'qm';
            localStorage.setItem('wms_role', role);
            localStorage.setItem('wms_sso_groups', groups.join(','));
            // 更新页面上已渲染的用户名 (如果页面已加载完)
            _refreshDisplayedUsername(displayName);
        })
        .catch(function(e) {
            if (typeof console !== 'undefined') {
                console.warn('[WMS-SSO] whoami 获取失败:', e.message);
            }
        });
}

/**
 * 更新页面上显示的用户名 (SSO 首次加载时 localStorage 为空, whoami 返回后刷新)
 */
function _refreshDisplayedUsername(name) {
    // 常见的用户名显示元素
    var els = document.querySelectorAll('[data-username], .username-display, #currentUser');
    for (var i = 0; i < els.length; i++) {
        els[i].textContent = name;
    }
}

/**
 * 检查登录状态 (SSO 强制)
 * nginx auth_request 已保护页面, 此函数只做 localStorage 填充
 * @returns {boolean} true=已认证
 */
function checkAuth() {
    // SSO: nginx auth_request 已验证, 用户一定已认证
    if (!localStorage.getItem('wms_username')) {
        // 首次访问: 后台获取 SSO 用户信息
        _initSSOUser();
    }
    document.body.classList.add('authed');
    return true;
}

/**
 * 退出登录 (SSO 强制)
 * 清除本地数据 → 跳转 Authelia 登出
 */
async function logout() {
    localStorage.removeItem('wms_username');
    localStorage.removeItem('wms_display_name');
    localStorage.removeItem('wms_role');
    localStorage.removeItem('wms_sso_groups');

    var currentPath = window.location.pathname;
    fetch('/auth/api/logout', { method: 'POST', credentials: 'same-origin' })
        .catch(function () { /* SSO logout 失败不阻塞跳转 */ })
        .finally(function () {
            window.location.href = '/?rd=' + encodeURIComponent(currentPath);
        });
}

/**
 * 获取当前登录用户的display_name（用于界面显示）
 */
function getLoginUser() {
    return localStorage.getItem('wms_display_name') || localStorage.getItem('wms_username') || 'unknown';
}

/**
 * 获取当前登录用户的username（用于performed_by等数据字段，对应wms_users.username）
 */
function getLoginUsername() {
    return localStorage.getItem('wms_username') || localStorage.getItem('wms_display_name') || 'unknown';
}
