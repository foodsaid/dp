/**
 * WMS 仪表盘/门户页 (index.html) 业务逻辑
 * 从 index.html 内联 <script> 中抽离，纯函数 + DOM 绑定分层
 */

// ============================================================================
// 纯函数 — 数据处理（无 DOM 依赖，可单元测试）
// ============================================================================

/**
 * 构建今日概览 HTML
 * @param {Object} stats - { today_transactions, in_progress, today_completed, pending_export }
 * @param {Function} tFn - 翻译函数
 * @returns {string} HTML 字符串
 */
function buildActivityHtml(stats, tFn) {
    var unit = tFn('portal.docs_unit', ' 单');
    return '<div class="info-grid">' +
        '<div class="info-item">' +
        '<span class="info-label">' + tFn('portal.today_ops', '今日操作') + '</span>' +
        '<span class="info-value highlight">' + (stats.today_transactions || 0) + '</span>' +
        '</div>' +
        '<div class="info-item">' +
        '<span class="info-label">' + tFn('portal.in_progress_count', '进行中') + '</span>' +
        '<span class="info-value">' + (stats.in_progress || 0) + unit + '</span>' +
        '</div>' +
        '<div class="info-item">' +
        '<span class="info-label">' + tFn('portal.today_completed', '今日完成') + '</span>' +
        '<span class="info-value">' + (stats.today_completed || 0) + unit + '</span>' +
        '</div>' +
        '<div class="info-item">' +
        '<span class="info-label">' + tFn('portal.pending_export_label', '待导出') + '</span>' +
        '<span class="info-value">' + (stats.pending_export || 0) + unit + '</span>' +
        '</div>' +
        '</div>';
}

/**
 * 构建默认活动内容 HTML (API 出错时的降级内容)
 * @param {Function} tFn - 翻译函数
 * @returns {string} HTML 字符串
 */
function buildDefaultActivityHtml(tFn) {
    return '<div class="info-grid">' +
        '<div class="info-item">' +
        '<span class="info-label">' + tFn('portal.system_status', '系统状态') + '</span>' +
        '<span class="info-value text-success">' + tFn('portal.system_ok', '正常运行') + '</span>' +
        '</div>' +
        '<div class="info-item">' +
        '<span class="info-label">' + tFn('portal.hint_label', '提示') + '</span>' +
        '<span class="info-value" style="font-size:0.875rem;">' + tFn('portal.hint_text', '扫描条码或点击上方磁贴开始操作') + '</span>' +
        '</div>' +
        '</div>';
}

/**
 * 根据同步检查结果计算按钮禁用状态
 * @param {Object} data - /sync/check 返回数据
 * @param {boolean} stockSyncedInSession - 本次会话是否已同步过库存
 * @param {number} omsLastSyncTime - OMS 上次同步时间戳
 * @param {number} now - 当前时间戳
 * @returns {Object} { items, locations, bins, stock, oms } 各按钮是否禁用
 */
function calcSyncButtonStates(data, stockSyncedInSession, omsLastSyncTime, now) {
    var result = {
        items: true, locations: true, bins: true, stock: true, oms: true
    };

    if (data && data.items) result.items = !data.items.need_sync;
    if (data && data.locations) result.locations = !data.locations.need_sync;
    if (data && data.bins) result.bins = !data.bins.need_sync;

    // 库存快照: 需要同步 + 本次会话未同步过
    if (data && data.stock) result.stock = !data.stock.need_sync || stockSyncedInSession;

    // OMS 订单同步: 优先真实检测，降级时间戳
    if (data && data.oms && typeof data.oms.need_sync !== 'undefined') {
        result.oms = !data.oms.need_sync;
    } else {
        result.oms = (now - (omsLastSyncTime || 0)) < 14400000;
    }

    return result;
}

/**
 * 根据同步检查结果构建提示信息
 * @param {Object} data - /sync/check 返回数据
 * @param {boolean} stockSyncedInSession - 本次会话是否已同步过库存
 * @param {boolean} omsEnabled - OMS 按钮是否可用
 * @param {Function} tFn - 翻译函数
 * @returns {string[]} 提示信息数组
 */
function buildSyncHints(data, stockSyncedInSession, omsEnabled, tFn) {
    var hints = [];
    if (data && data.items && data.items.need_sync) hints.push(tFn('sync.items_hint', '物料有更新'));
    if (data && data.locations && data.locations.need_sync) hints.push(tFn('sync.locations_hint', '仓库有更新'));
    if (data && data.bins && data.bins.need_sync) hints.push(tFn('sync.bins_hint', '库位有更新'));
    if (data && data.stock && data.stock.need_sync && !stockSyncedInSession) hints.push(tFn('sync.stock_hint', '昨日快照缺失'));
    if (omsEnabled) hints.push(tFn('sync.oms_hint', 'OMS订单可同步'));
    return hints;
}

/**
 * 计算昨天的日期字符串 (YYYY-MM-DD)
 * @param {number} nowMs - 当前时间戳毫秒
 * @returns {string}
 */
function calcYesterday(nowMs) {
    return new Date(nowMs - 86400000).toISOString().split('T')[0];
}

// ============================================================================
// DOM 绑定 — 浏览器环境（依赖 shared.js 全局函数）
// ============================================================================

/* istanbul ignore next */
if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof CONFIG !== 'undefined') {

    // 初始化门户页
    function initPortal() {
        if (!checkAuth()) return;
        var displayEl = document.getElementById('loginUserDisplay');
        if (displayEl) displayEl.textContent = localStorage.getItem('wms_display_name') || '';
        // SVG图标初始化
        document.querySelectorAll('.tile[data-type]').forEach(function (tile) {
            var type = tile.getAttribute('data-type');
            var iconSpan = tile.querySelector('.tile-icon');
            if (iconSpan && type) iconSpan.innerHTML = getDocTypeIcon(type, 48);
        });

        // 设置扫码输入
        setupBarcodeInput('scanInput', function (barcode) {
            playBeepSound();
            showBeepIndicator();
            routeBarcode(barcode);
        });

        // 加载今日概览
        loadActivity();
    }

    // 加载今日活动
    async function loadActivity() {
        var content = document.getElementById('activityContent');
        try {
            var data = await apiGet('/dashboard');
            renderActivity(data);
        } catch (e) {
            content.innerHTML = buildDefaultActivityHtml(t);
        }
    }

    function renderActivity(data) {
        var content = document.getElementById('activityContent');
        if (!data || !data.success) {
            content.innerHTML = '<div class="text-center text-muted">' + t('portal.no_data', '暂无数据') + '</div>';
            return;
        }
        content.innerHTML = buildActivityHtml(data.stats || {}, t);
    }

    // ============================================================
    // 数据同步面板: SAP 日期比较 + 智能按钮交互
    // ============================================================

    var _syncChecked = false;
    function showSyncPanel() {
        var panel = document.getElementById('syncPanel');
        if (panel.classList.contains('hidden')) {
            panel.classList.remove('hidden');
            if (!_syncChecked) { checkSyncStatus(); _syncChecked = true; }
        } else {
            panel.classList.add('hidden');
        }
    }

    async function checkSyncStatus() {
        var msgEl = document.getElementById('syncStatusMsg');
        msgEl.textContent = t('sync.checking', '正在检查 SAP 数据更新状态...');
        msgEl.style.color = '#999';
        try {
            var data = await apiGet('/sync/check');
            if (data && data.success) {
                applySyncStatus(data);
                applyOmsBtnStates();
            } else {
                // 检查失败: 保留按钮禁用状态，允许重试
                _syncChecked = false;
                msgEl.textContent = t('sync.check_failed_retry', '状态检查失败，点击面板标题重试');
                msgEl.style.color = '#faad14';
            }
        } catch (e) {
            // 网络异常 (手机端常见): 保留按钮禁用状态，允许重试
            _syncChecked = false;
            msgEl.textContent = t('sync.check_failed_retry', '状态检查失败，点击面板标题重试');
            msgEl.style.color = '#faad14';
        }
    }

    function applySyncStatus(data) {
        var btnItems = document.getElementById('btnSyncItems');
        var btnWhs = document.getElementById('btnSyncWhs');
        var btnBins = document.getElementById('btnSyncBins');
        var btnStock = document.getElementById('btnSyncStock');
        var msgEl = document.getElementById('syncStatusMsg');

        var yesterday = calcYesterday(Date.now());
        var stockSyncedInSession = sessionStorage.getItem('stock_synced_' + yesterday) === 'true';
        var omsLastSyncTime = parseInt(localStorage.getItem('oms_last_sync_time')) || 0;

        var states = calcSyncButtonStates(data, stockSyncedInSession, omsLastSyncTime, Date.now());
        // 不用 HTML disabled (部分浏览器不触发 pointerdown)，改用 data 属性 + CSS 视觉禁用
        var allBtns = [
            [btnItems, states.items],
            [btnWhs, states.locations],
            [btnBins, states.bins],
            [btnStock, states.stock]
        ];
        allBtns.forEach(function(pair) {
            var b = pair[0], shouldDisable = pair[1];
            if (!b) return;
            // 强制启用的按钮保持亮着，不覆盖
            if (b.dataset.forceEnabled === '1') { b.disabled = false; return; }
            if (shouldDisable) {
                b.dataset.syncDisabled = '1';
                b.disabled = false;
            } else {
                delete b.dataset.syncDisabled;
                b.disabled = false;
            }
        });

        // OMS 按钮: 异步查 sync_progress 状态，完成的灰显
        applyOmsBtnStates();

        var hints = buildSyncHints(data, stockSyncedInSession, false, t);

        if (hints.length > 0) {
            msgEl.textContent = hints.join(' | ');
            msgEl.style.color = '#1890ff';
            // 3 秒后自动消失
            setTimeout(function() { if (msgEl.textContent === hints.join(' | ')) msgEl.textContent = ''; }, 3000);
        } else {
            msgEl.textContent = '';
        }

        setupLongPress();
    }

    // 长按 3 秒强制启用"无需同步"按钮 (用 data-sync-disabled 而非 HTML disabled)
    function setupLongPress() {
        var group = document.getElementById('syncBtnGroup');
        if (!group || group.dataset.longPressSetup === '1') return;
        group.dataset.longPressSetup = '1';
        var timer = null;
        var activeBtn = null;

        // 阻止长按右键菜单 (移动端/触屏)
        group.addEventListener('contextmenu', function(e) {
            if (activeBtn) e.preventDefault();
        });

        var start = function(e) {
            var btn = e.target.closest('button[data-sync-disabled]');
            if (!btn) return;
            // 防止 touchstart + pointerdown 双触发导致定时器泄漏
            if (timer) { clearTimeout(timer); timer = null; }
            activeBtn = btn;
            // 视觉反馈: 按住时透明度从 0.5 渐变到 1
            btn.style.transition = 'opacity 3s linear';
            btn.style.opacity = '1';
            timer = setTimeout(function() {
                // 先显示视觉变化 + 提示，但保留 syncDisabled 防止松手误触
                btn.dataset.forceEnabled = '1';
                btn.classList.add('force-enabled');
                btn.style.transition = ''; btn.style.opacity = '';
                activeBtn = null;
                var msgEl = document.getElementById('syncStatusMsg');
                if (msgEl) msgEl.textContent = '';
                showMessage(t('sync.force_enabled', '已强制启用'), 'success');
                // 延迟 500ms 后才真正解除禁用 (防止松手瞬间误触)
                setTimeout(function() { delete btn.dataset.syncDisabled; }, 500);
            }, 3000);
        };
        var end = function() {
            if (timer) { clearTimeout(timer); timer = null; }
            if (activeBtn) {
                activeBtn.style.transition = ''; activeBtn.style.opacity = '';
                activeBtn = null;
            }
        };
        group.addEventListener('pointerdown', start);
        group.addEventListener('touchstart', start, {passive: true});
        ['pointerup', 'pointercancel', 'pointerleave', 'touchend', 'touchcancel'].forEach(function(ev) { group.addEventListener(ev, end); });
    }

    function enableAllSyncButtons() {
        ['btnSyncItems', 'btnSyncWhs', 'btnSyncBins', 'btnSyncStock', 'btnSyncOmsSo', 'btnSyncOmsPo', 'btnSyncOmsWo', 'btnSyncOmsTr'].forEach(function(id) {
            var b = document.getElementById(id);
            if (b) { b.disabled = false; delete b.dataset.syncDisabled; }
        });
    }

    // ============================================================
    // 同步操作函数 (成功→禁用+刷新, 出错→恢复可点击)
    // ============================================================

    async function syncItems() {
        var btn = document.getElementById('btnSyncItems');
        if (btn.dataset.syncDisabled) return;
        btn.disabled = true; btn.textContent = t('portal.syncing', '同步中...');
        try {
            var r = await apiPost('/sync/items', {});
            var ok = r && r.success;
            var msg = ok ? (r.message || t('portal.sync_items_done', '物料同步完成') + ': ' + (r.count || 0)) : t('common.failed', '同步失败');
            showSyncResult(msg);
            showMessage(msg, ok ? 'success' : 'error');
            if (ok) { btn.disabled = true; refreshSyncCheck('btnSyncItems'); }
            else { btn.disabled = false; }
        } catch (e) {
            showMessage(t('common.failed', '同步失败') + ': ' + (e.message || ''), 'error');
            showSyncResult(t('common.failed', '失败') + ': ' + (e.message || ''));
            btn.disabled = false;
        }
        finally { btn.textContent = t('sync.items_btn', '\u{1F4E6} 同步物料'); }
    }

    async function syncWarehouses() {
        var btn = document.getElementById('btnSyncWhs');
        if (btn.dataset.syncDisabled) return;
        btn.disabled = true; btn.textContent = t('portal.syncing', '同步中...');
        try {
            var r = await apiPost('/sync/locations', {});
            var ok = r && r.success;
            var msg = ok ? (r.message || t('portal.sync_whs_done', '仓库同步完成') + ': ' + (r.count || 0)) : t('common.failed', '同步失败');
            showSyncResult(msg);
            showMessage(msg, ok ? 'success' : 'error');
            if (ok) { btn.disabled = true; refreshSyncCheck('btnSyncWhs'); }
            else { btn.disabled = false; }
        } catch (e) {
            showMessage(t('common.failed', '同步失败') + ': ' + (e.message || ''), 'error');
            showSyncResult(t('common.failed', '失败') + ': ' + (e.message || ''));
            btn.disabled = false;
        }
        finally { btn.textContent = t('sync.whs_btn', '\u{1F3E2} 同步仓库'); }
    }

    async function syncBins() {
        var btn = document.getElementById('btnSyncBins');
        if (btn.dataset.syncDisabled) return;
        btn.disabled = true; btn.textContent = t('portal.syncing', '同步中...');
        try {
            var r = await apiPost('/sync/bins', {});
            var ok = r && r.success;
            var msg = ok ? (r.message || t('portal.sync_bins_done', '库位同步完成') + ': ' + (r.count || 0)) : t('common.failed', '同步失败');
            showSyncResult(msg);
            showMessage(msg, ok ? 'success' : 'error');
            if (ok) { btn.disabled = true; refreshSyncCheck('btnSyncBins'); }
            else { btn.disabled = false; }
        } catch (e) {
            showMessage(t('common.failed', '同步失败') + ': ' + (e.message || ''), 'error');
            showSyncResult(t('common.failed', '失败') + ': ' + (e.message || ''));
            btn.disabled = false;
        }
        finally { btn.textContent = t('sync.bins_btn', '\u{1F5C3} 同步库位'); }
    }

    async function syncStockSnapshot() {
        var btn = document.getElementById('btnSyncStock');
        if (btn.dataset.syncDisabled) return;
        btn.disabled = true; btn.textContent = t('portal.syncing', '同步中...');
        showSyncResult(t('portal.sync_stock_hint', '库存快照同步中，可能需要几分钟...'));
        try {
            var r = await apiPost('/sync/stock', {});
            var ok = r && r.success;
            var msg = ok ? t('portal.sync_stock_done', '库存快照同步完成') + ': SAP ' + (r.total_rows || 0) : t('common.failed', '同步失败');
            showSyncResult(msg);
            showMessage(msg, ok ? 'success' : 'error');
            if (ok) {
                var yesterday = calcYesterday(Date.now());
                sessionStorage.setItem('stock_synced_' + yesterday, 'true');
                btn.disabled = true;
                refreshSyncCheck('btnSyncStock');
            } else {
                btn.disabled = false;
            }
        } catch (e) {
            showMessage(t('common.failed', '同步失败') + ': ' + (e.message || ''), 'error');
            showSyncResult(t('common.failed', '失败') + ': ' + (e.message || ''));
            btn.disabled = false;
        }
        finally { btn.textContent = t('sync.stock_btn', '\u{1F4C8} 同步昨日库存'); }
    }

    // 同步版: 直接用已有数据设 OMS 按钮状态 (无异步，无竞争)
    function setOmsBtnStatesDirect(progress) {
        var typeMap = { SO: 'btnSyncOmsSo', PO: 'btnSyncOmsPo', WO: 'btnSyncOmsWo', TR: 'btnSyncOmsTr' };
        var completedTypes = {};
        (progress || []).forEach(function(p) {
            if (p.total > 0 && p.completed === p.total && p.pending === 0 && p.running === 0) {
                completedTypes[p.doc_type] = true;
            }
        });
        Object.keys(typeMap).forEach(function(dt) {
            var btn = document.getElementById(typeMap[dt]);
            if (!btn) return;
            if (completedTypes[dt]) {
                btn.dataset.syncDisabled = '1';
                delete btn.dataset.forceEnabled;
                btn.classList.remove('force-enabled');
                btn.disabled = false;
            } else {
                delete btn.dataset.syncDisabled;
                delete btn.dataset.forceEnabled;
                btn.classList.remove('force-enabled');
                btn.disabled = false;
            }
        });
        if (typeof applyI18n === 'function') applyI18n();
    }

    // 异步版: 页面加载时查 API 设按钮状态
    async function applyOmsBtnStates() {
        var typeMap = { SO: 'btnSyncOmsSo', PO: 'btnSyncOmsPo', WO: 'btnSyncOmsWo', TR: 'btnSyncOmsTr' };
        try {
            var status = await apiGet('/oms/sync/status');
            if (!status || !status.success) return;
            var completedTypes = {};
            var syncingTypes = {};
            (status.progress || []).forEach(function(p) {
                if (p.total > 0 && p.completed === p.total && p.pending === 0 && p.running === 0) {
                    completedTypes[p.doc_type] = true;
                }
                if (p.running > 0 || p.pending > 0) {
                    syncingTypes[p.doc_type] = true;
                }
            });
            // 对每个 OMS 按钮: 完成或进行中 → data-sync-disabled，否则清除
            Object.keys(typeMap).forEach(function(dt) {
                var btn = document.getElementById(typeMap[dt]);
                if (!btn) return;
                if (btn.dataset.forceEnabled === '1') { btn.disabled = false; return; }
                if (completedTypes[dt] || syncingTypes[dt]) {
                    btn.dataset.syncDisabled = '1';
                    delete btn.dataset.forceEnabled;
                    btn.classList.remove('force-enabled');
                    btn.disabled = false;
                } else {
                    delete btn.dataset.syncDisabled;
                    btn.disabled = false;
                }
            });
            // 有正在同步的 → 启动轮询
            if (Object.keys(syncingTypes).length > 0) startOmsPoll();
        } catch(e) { /* 静默 */ }
    }

    // OMS 同步轮询定时器 (全局，多按钮共享)
    var _omsPollTimer = null;

    async function syncOmsType(type) {
        var btnId = 'btnSyncOms' + type.charAt(0).toUpperCase() + type.slice(1);
        var btn = document.getElementById(btnId);
        if (!btn || btn.disabled) return;
        if (btn.dataset.syncDisabled) return;
        btn.disabled = true;
        var origText = btn.textContent;
        btn.textContent = t('portal.syncing', '同步中...');
        showSyncResult(type.toUpperCase() + ' ' + t('sync.oms_syncing', '同步启动中...'));
        try {
            var r = await apiPost('/oms/sync/' + type, {});
            if (!r || !r.success) {
                showMessage(r && r.message || t('common.failed', '启动失败'), 'error');
                showSyncResult(r && r.message || t('common.failed', '启动失败'));
                btn.disabled = false;
                btn.textContent = origText;
                return;
            }
            showMessage(r.message || type.toUpperCase() + ' 同步已加入队列', 'success');
            // 启动全局轮询 (如果没有在跑)
            startOmsPoll();
        } catch (e) {
            showMessage(t('common.failed', '启动失败') + ': ' + (e.message || ''), 'error');
            showSyncResult(t('common.failed', '失败') + ': ' + (e.message || ''));
            btn.disabled = false;
            btn.textContent = origText;
        }
    }

    function startOmsPoll() {
        if (_omsPollTimer) return; // 已在轮询
        _omsPollTimer = setInterval(async function() {
            try {
                var status = await apiGet('/oms/sync/status');
                if (!status || !status.success) return;
                // 只显示正在同步的类型 (不显示已完成的)
                var activeParts = (status.progress || []).filter(function(p) {
                    return p.running > 0 || p.pending > 0 || p.failed > 0;
                }).map(function(p) {
                    if (p.running > 0) return p.doc_type + ': ' + p.completed + '/' + p.total + ' ...';
                    if (p.failed > 0) return p.doc_type + ': ' + p.completed + '/' + p.total + ' \u2717';
                    if (p.pending > 0) return p.doc_type + ': ' + p.completed + '/' + p.total;
                    return '';
                }).filter(function(s) { return s; });
                if (activeParts.length > 0) {
                    showOmsProgress(activeParts.join(' | '));
                }

                // 同步完成 (无 running 和 pending)
                if (!status.syncing) {
                    clearInterval(_omsPollTimer);
                    _omsPollTimer = null;
                    hideOmsProgress();
                    var hasFailure = (status.progress || []).some(function(p) { return p.failed > 0; });
                    if (hasFailure) {
                        showMessage('OMS 同步部分失败: ' + (status.last_error || '请查看日志'), 'error');
                    } else {
                        showMessage(t('sync.oms_done', 'OMS订单同步完成'), 'success');
                        localStorage.setItem('oms_last_sync_time', String(Date.now()));
                    }
                    // 同步设按钮状态 (用已有数据，不再异步请求)
                    setOmsBtnStatesDirect(status.progress);
                }
            } catch(e) { /* 静默，继续轮询 */ }
        }, 5000);
        // 安全超时: 30 分钟后强制停止
        setTimeout(function() {
            if (_omsPollTimer) { clearInterval(_omsPollTimer); _omsPollTimer = null; hideOmsProgress(); resetOmsButtons(); }
        }, 1800000);
    }

    function showOmsProgress(msg) {
        var wrap = document.getElementById('omsSyncProgress');
        var el = document.getElementById('omsSyncText');
        if (wrap) wrap.style.display = 'flex';
        if (el) el.textContent = msg;
    }

    function hideOmsProgress() {
        var wrap = document.getElementById('omsSyncProgress');
        if (wrap) wrap.style.display = 'none';
    }

    async function stopOmsSync() {
        if (_omsPollTimer) { clearInterval(_omsPollTimer); _omsPollTimer = null; }
        try {
            var r = await apiPost('/oms/sync/stop', {});
            showMessage(r && r.message || 'OMS 同步已停止', 'success');
        } catch(e) {
            showMessage('停止失败: ' + (e.message || ''), 'error');
        }
        hideOmsProgress();
        resetOmsButtons();
    }

    function resetOmsButtons() {
        hideOmsProgress();
        // 恢复所有 OMS 按钮到默认可点击状态 (异步 applyOmsBtnStates 会再设灰显)
        ['btnSyncOmsSo', 'btnSyncOmsPo', 'btnSyncOmsWo', 'btnSyncOmsTr'].forEach(function(id) {
            var btn = document.getElementById(id);
            if (!btn) return;
            delete btn.dataset.forceEnabled;
            btn.classList.remove('force-enabled');
            btn.disabled = false;
        });
        if (typeof applyI18n === 'function') applyI18n();
    }

    // 同步结果文字 3 秒后自动消失
    function showSyncResult(msg) {
        var el = document.getElementById('syncResult');
        el.textContent = msg;
        setTimeout(function() { if (el.textContent === msg) el.textContent = ''; }, 3000);
    }

    async function refreshSyncCheck(triggeredBtnId) {
        // 只清除触发同步的那个按钮的强制启用标记，其余保留
        if (triggeredBtnId) {
            var b = document.getElementById(triggeredBtnId);
            if (b && b.dataset.forceEnabled === '1') {
                delete b.dataset.forceEnabled;
                b.classList.remove('force-enabled');
            }
        }
        try {
            var data = await apiGet('/sync/check');
            if (data && data.success) applySyncStatus(data);
        } catch(e) { /* 静默失败 */ }
    }

    window.showSyncPanel = showSyncPanel;
    window.syncItems = syncItems;
    window.syncWarehouses = syncWarehouses;
    window.syncBins = syncBins;
    window.syncStockSnapshot = syncStockSnapshot;
    window.syncOmsType = syncOmsType;
    window.stopOmsSync = stopOmsSync;

    // 页面加载
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPortal);
    } else {
        initPortal();
    }
}

// ============================================================================
// 兼容性导出 — Jest 单元测试引用（不影响浏览器环境）
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        buildActivityHtml: buildActivityHtml,
        buildDefaultActivityHtml: buildDefaultActivityHtml,
        calcSyncButtonStates: calcSyncButtonStates,
        buildSyncHints: buildSyncHints,
        calcYesterday: calcYesterday
    };
}
