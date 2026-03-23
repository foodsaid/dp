/**
 * WMS 库存查询页 (stock.html) 业务逻辑
 * 从 stock.html 内联 <script> 中抽离，纯函数 + DOM 绑定分层
 */

// ============================================================================
// 纯函数 — 数据处理（无 DOM 依赖，可单元测试）
// ============================================================================

/**
 * 按物料分组，生成 { item_code, item_name, uom, rows, subtotal }
 * V16.6: 支持多仓/多库位/多批次分组汇总
 * @param {Array} data - 原始库存行数据
 * @returns {Array} 分组后的数据
 */
function buildGroupedData(data) {
    var groups = {};
    var order = [];
    data.forEach(function (row) {
        var key = row.item_code || '_unknown';
        if (!groups[key]) {
            groups[key] = { item_code: key, item_name: row.item_name || '', uom: row.uom || '', rows: [] };
            order.push(key);
        }
        groups[key].rows.push(row);
    });
    // 计算小计
    order.forEach(function (key) {
        var g = groups[key];
        var sumSnap = 0, sumDelta = 0, sumRealtime = 0;
        g.rows.forEach(function (r) {
            sumSnap += Number(r.base_qty) || 0;
            sumDelta += Number(r.delta_qty) || 0;
            sumRealtime += Number(r.real_time_qty) || 0;
        });
        g.subtotal = { base_qty: sumSnap, delta_qty: sumDelta, real_time_qty: sumRealtime };
    });
    return order.map(function (k) { return groups[k]; });
}

/**
 * 生成 CSV 内容字符串
 * @param {Array} stockData - 原始库存数据
 * @returns {string} CSV 内容 (含 BOM)
 */
function buildCsvContent(stockData) {
    var groups = buildGroupedData(stockData);
    var csvContent = '\uFEFF'; // BOM for Excel UTF-8
    csvContent += '类型,物料号,物料名称,仓库,库位,批次,快照数,WMS变动,实时库存,单位\n';
    var esc = function(v) { var s = String(v || ''); return s.indexOf(',') >= 0 || s.indexOf('"') >= 0 ? '"' + s.replace(/"/g, '""') + '"' : s; };
    groups.forEach(function(g) {
        var sub = g.subtotal;
        var sd = sub.delta_qty;
        // 小计行
        csvContent += ['[小计]', esc(g.item_code), esc(g.item_name), '', '', '',
            sub.base_qty, (sd > 0 ? '+' : '') + sd, sub.real_time_qty, esc(g.uom)].join(',') + '\n';
        // 明细行
        g.rows.forEach(function(row) {
            var d = Number(row.delta_qty) || 0;
            csvContent += ['  明细', esc(row.item_code), esc(row.item_name),
                esc(row.whs_code || ''), esc(row.bin_code || row.bins || ''),
                esc(row.batch_number || row.batches || ''),
                row.base_qty || 0, (d > 0 ? '+' : '') + d,
                row.real_time_qty || 0, esc(row.uom || '')].join(',') + '\n';
        });
    });
    return csvContent;
}

/**
 * 构建查询 URL 参数字符串
 * V16.1: 只发送有值的参数，空参数直接丢弃
 * @param {string} itemCode - 物料代码
 * @param {string} whs - 仓库代码
 * @param {string} bin - 库位代码
 * @returns {string} 查询 URL (如 /stock?item=A001&whs=WH01)
 */
function buildStockQueryUrl(itemCode, whs, bin) {
    var params = [];
    if (itemCode) params.push('item=' + encodeURIComponent(itemCode));
    if (whs) params.push('whs=' + encodeURIComponent(whs));
    if (bin) params.push('bin=' + encodeURIComponent(bin));
    return '/stock?' + params.join('&');
}

/**
 * 构建浏览器地址栏 URL (用于 history.replaceState)
 * V17.1: 同步浏览器地址栏，使每次查询的URL可分享/刷新
 * @param {string} itemCode - 物料代码
 * @param {string} whs - 仓库代码
 * @param {string} bin - 库位代码
 * @returns {string} 浏览器地址栏 URL
 */
function buildBrowserUrl(itemCode, whs, bin) {
    var params = [];
    if (itemCode) params.push('item=' + encodeURIComponent(itemCode));
    if (whs) params.push('whs=' + encodeURIComponent(whs));
    if (bin) params.push('bin=' + encodeURIComponent(bin));
    return 'stock.html' + (params.length ? '?' + params.join('&') : '');
}

// ============================================================================
// 全局状态变量
// ============================================================================

var _masterDataRequested = false;
var currentStockData = [];
var currentPage = 1;
var pageSize = 50;
var _groupedData = [];

// ============================================================================
// DOM 绑定函数 — 依赖浏览器环境
// ============================================================================

/**
 * V19.13: 主数据延迟加载 — 99%查询只用物料，不需要每次下载3MB主数据
 * 仅在用户交互仓库/库位筛选时才触发加载
 */
function _ensureMasterData() {
    if (_masterDataRequested) return;
    _masterDataRequested = true;
    // 不强刷 (false)，TTL 4小时内直接复用 localStorage 缓存
    loadMasterDataCache().then(function() {
        loadWarehouseOptions();
    });
}

function initStock() {
    if (!checkAuth()) return;
    // V19.13: 移除强制刷新主数据 — 物料查询不需要仓库/库位字典
    setupBarcodeInput('scanInput', function (barcode) {
        playBeepSound();
        showBeepIndicator();
        handleStockBarcode(barcode);
    });
    document.getElementById('scanInput').focus();
    show('emptyState');
    loadSearchHistory();

    // V17.1: URL参数自动查询 — 从门户页跳转、或刷新恢复查询条件
    var urlItem = getUrlParam('item');
    var urlWhs = getUrlParam('whs');
    var urlBin = getUrlParam('bin');
    if (urlWhs) document.getElementById('whsFilter').value = urlWhs;
    if (urlBin) document.getElementById('binFilter').value = urlBin;
    // 有仓库/库位参数时才异步加载主数据
    if (urlWhs || urlBin) _ensureMasterData();
    if (urlItem || urlWhs || urlBin) {
        if (urlItem) document.getElementById('scanInput').value = urlItem;
        doQuery(urlItem || '');
    }

    // V19.13: 仓库/库位获焦时延迟加载主数据 + 填充下拉
    var whsEl = document.getElementById('whsFilter');
    var binEl = document.getElementById('binFilter');
    if (whsEl) {
        whsEl.addEventListener('focus', _ensureMasterData);
        whsEl.addEventListener('blur', function() {
            var raw = whsEl.value.trim();
            if (!raw) return;
            var result = validateWarehouse(raw);
            if (result === null) return;
            if (!result) {
                whsEl.style.borderColor = '#f59e0b';
                showMessage(t('msg.whs_not_in_cache', '仓库 {0} 不在主数据缓存中').replace('{0}', raw), 'warning');
            } else {
                whsEl.value = result.whs_code;
                whsEl.style.borderColor = '';
            }
        });
    }
    if (binEl) {
        binEl.addEventListener('focus', _ensureMasterData);
        binEl.addEventListener('blur', function() {
            var raw = binEl.value.trim();
            if (!raw) return;
            var result = validateBin(raw);
            if (result === null) return;
            if (!result) {
                binEl.style.borderColor = '#f59e0b';
                showMessage(t('msg.bin_not_in_cache', '库位 {0} 不在主数据缓存中').replace('{0}', raw), 'warning');
            } else {
                binEl.value = result.bin_code;
                binEl.style.borderColor = '';
            }
        });
    }
}

// V19.12: 从主数据缓存加载仓库选项 (不再调用不存在的 /warehouses API)
function loadWarehouseOptions() {
    var cache = _getMasterCache();
    if (!cache || !cache.warehouses || !cache.warehouses.length) return;
    var list = document.getElementById('whsList');
    if (!list) return;
    list.innerHTML = ''; // 清空旧选项
    cache.warehouses.forEach(function(w) {
        var opt = document.createElement('option');
        opt.value = w.whs_code || w.code || '';
        opt.label = (w.whs_code || w.code || '') + ' ' + (w.whs_name || w.name || '');
        list.appendChild(opt);
    });
}

// 搜索历史管理
function saveSearchHistory(code) {
    if (!code) return;
    try {
        var history = JSON.parse(localStorage.getItem('stock_search_history') || '[]');
        history = history.filter(function(h) { return h !== code; });
        history.unshift(code);
        if (history.length > 10) history = history.slice(0, 10);
        localStorage.setItem('stock_search_history', JSON.stringify(history));
    } catch(e) {}
}

function loadSearchHistory() {
    try {
        var history = JSON.parse(localStorage.getItem('stock_search_history') || '[]');
        if (history.length > 0) {
            var hint = document.querySelector('.form-hint');
            if (hint) {
                // 安全: 使用 data 属性 + 事件委托替代 onclick 内联 (防 XSS)
                hint.innerHTML = '最近查询: ' + history.slice(0, 5).map(function(h) {
                    return '<a href="#" class="history-link" data-code="' + escapeHtml(h) + '" style="color:var(--primary-color);text-decoration:underline;margin-right:6px;">' + escapeHtml(h) + '</a>';
                }).join('') + '<br>输入物料编码 (如 A-001)、批次号，或直接扫描物料条码';
                hint.querySelectorAll('.history-link').forEach(function(a) {
                    a.addEventListener('click', function(e) {
                        e.preventDefault();
                        quickSearch(this.getAttribute('data-code'));
                    });
                });
            }
        }
    } catch(e) {}
}

function quickSearch(code) {
    document.getElementById('scanInput').value = code;
    doQuery(code);
}

function handleStockBarcode(barcode) {
    var code = barcode.trim();
    if (!code) return;
    document.getElementById('scanInput').value = code;
    doQuery(code);
}

function handleSearch() {
    var code = document.getElementById('scanInput').value.trim();
    var whs = document.getElementById('whsFilter').value.trim();
    var bin = document.getElementById('binFilter').value.trim();
    if (!code && !whs && !bin) {
        showMessage(t('stock.input_hint', '请输入物料代码、仓库或库位'), 'warning');
        return;
    }
    doQuery(code);
}

function clearSearch() {
    document.getElementById('scanInput').value = '';
    document.getElementById('whsFilter').value = '';
    document.getElementById('binFilter').value = '';
    hide('tableSection');
    hide('resultContainer');
    currentStockData = [];
    currentPage = 1;
    show('emptyState');
    document.getElementById('scanInput').focus();
}

async function doQuery(itemCode) {
    showLoading(true);
    hide('emptyState');
    hide('tableSection');

    // 保存搜索历史
    if (itemCode) saveSearchHistory(itemCode);

    try {
        var whs = document.getElementById('whsFilter').value.trim();
        var bin = (document.getElementById('binFilter').value || '').trim();
        var url = buildStockQueryUrl(itemCode, whs, bin);

        // V17.1: 同步浏览器地址栏，使每次查询的URL可分享/刷新
        var browserUrl = buildBrowserUrl(itemCode, whs, bin);
        history.replaceState(null, '', browserUrl);

        var data = await apiGet(url);

        if (!data || !data.success || !data.data || data.data.length === 0) {
            var hintText = itemCode ? '物料代码: ' + escapeHtml(itemCode) : '仓库/库位: ' + escapeHtml(whs || bin || '全部');
            show('emptyState');
            document.getElementById('emptyState').innerHTML =
                '<div class="no-stock-message">' +
                '<div class="icon">&#128683;</div>' +
                '<div class="text">' + t('stock.no_result', '查无物料库存') + '</div>' +
                '<div class="hint">' + hintText + '<br>' + t('stock.no_result_hint', '请确认条件正确，或等待今晚22:00快照同步') + '</div>' +
                '</div>';
            playErrorSound();
            return;
        }

        currentStockData = Array.isArray(data.data) ? data.data : [data.data];
        currentPage = 1;
        renderTable(1);
        show('tableSection');
        playSuccessSound();
    } catch (e) {
        showMessage(t('msg.query_failed', '查询失败: {0}').replace('{0}', e.message), 'error');
        playErrorSound();
        show('emptyState');
        document.getElementById('emptyState').innerHTML =
            '<div class="no-stock-message"><div class="icon">&#10060;</div>' +
            '<div class="text">' + t('stock.query_error', '查询出错') + '</div>' +
            '<div class="hint">' + escapeHtml(e.message) + '</div></div>';
    } finally {
        showLoading(false);
        setTimeout(function () {
            var scanInput = document.getElementById('scanInput');
            if (scanInput) { scanInput.value = ''; scanInput.focus(); }
        }, 500);
    }
}

function renderTable(page) {
    var tbody = document.getElementById('stockTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    _groupedData = buildGroupedData(currentStockData);

    // 分页按分组数
    var totalPages = Math.max(1, Math.ceil(_groupedData.length / pageSize));
    page = Math.max(1, Math.min(page, totalPages));
    currentPage = page;

    var start = (page - 1) * pageSize;
    var end = Math.min(start + pageSize, _groupedData.length);
    var pageGroups = _groupedData.slice(start, end);

    var totalQty = currentStockData.reduce(function(sum, r) { return sum + (Number(r.real_time_qty) || 0); }, 0);
    var summaryEl = document.getElementById('summaryText');
    if (summaryEl) summaryEl.textContent = tpl('stock.summary', _groupedData.length, currentStockData.length, formatNumber(totalQty));

    var paginationEl = document.getElementById('paginationInfo');
    if (paginationEl) paginationEl.textContent = tpl('stock.page_info', page, totalPages);

    var btnPrev = document.getElementById('btnPrev');
    var btnNext = document.getElementById('btnNext');
    if (btnPrev) btnPrev.disabled = (page <= 1);
    if (btnNext) btnNext.disabled = (page >= totalPages);

    pageGroups.forEach(function(group, gIdx) {
        var gid = 'grp_' + (start + gIdx);
        var sub = group.subtotal;
        var hasMulti = group.rows.length > 1;
        var delta = sub.delta_qty;
        var deltaColor = delta > 0 ? '#16a34a' : (delta < 0 ? '#dc2626' : '#64748b');
        var deltaStr = (delta > 0 ? '+' : '') + formatNumber(delta);

        // === 小计行 ===
        var trSub = document.createElement('tr');
        trSub.style.cssText = 'background:#eef2ff;border-bottom:2px solid #c7d2fe;cursor:' + (hasMulti ? 'pointer' : 'default') + ';';
        trSub.setAttribute('data-gid', gid);
        if (hasMulti) trSub.onclick = function() { toggleGroup(gid); };
        trSub.innerHTML =
            '<td style="padding:8px 6px;text-align:center;font-size:1rem;color:#6366f1;">' + (hasMulti ? '<span id="icon_' + gid + '">&#8853;</span>' : '') + '</td>' +
            '<td style="padding:8px 12px;white-space:nowrap;font-weight:700;color:#1e40af;">' + escapeHtml(group.item_code) + '</td>' +
            '<td style="padding:8px 12px;color:#374151;font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(group.item_name) + '">' + escapeHtml(group.item_name) + '</td>' +
            '<td style="padding:8px 12px;color:#94a3b8;font-size:0.82rem;" colspan="3">' + (hasMulti ? tpl('stock.detail_rows', group.rows.length) : escapeHtml(group.rows[0].whs_code || '') + ' / ' + escapeHtml(group.rows[0].bin_code || group.rows[0].bins || '') + ' / ' + escapeHtml(group.rows[0].batch_number || group.rows[0].batches || '')) + '</td>' +
            '<td style="padding:8px 12px;text-align:right;font-weight:700;">' + formatNumber(sub.base_qty) + '</td>' +
            '<td style="padding:8px 12px;text-align:right;font-weight:700;color:' + deltaColor + ';">' + deltaStr + '</td>' +
            '<td style="padding:8px 12px;text-align:right;font-weight:700;color:#1e40af;">' + formatNumber(sub.real_time_qty) + '</td>' +
            '<td style="padding:8px 12px;font-size:0.82rem;color:#94a3b8;">' + escapeHtml(group.uom) + '</td>';
        tbody.appendChild(trSub);

        // === 明细行（默认隐藏, 仅多行时） ===
        if (hasMulti) {
            group.rows.forEach(function(row, rIdx) {
                var trDetail = document.createElement('tr');
                trDetail.className = 'detail_' + gid;
                trDetail.style.cssText = 'display:none;background:' + (rIdx % 2 === 0 ? '#fff' : '#f8fafc') + ';border-bottom:1px solid #f1f5f9;';
                var rd = Number(row.delta_qty) || 0;
                var rdc = rd > 0 ? '#16a34a' : (rd < 0 ? '#dc2626' : '#64748b');
                var rds = (rd > 0 ? '+' : '') + formatNumber(rd);
                var bin = row.bin_code || row.bins || '';
                var batch = row.batch_number || row.batches || '';
                trDetail.innerHTML =
                    '<td></td>' +
                    '<td style="padding:6px 12px;font-size:0.82rem;color:#94a3b8;">└</td>' +
                    '<td style="padding:6px 12px;font-size:0.82rem;color:#6b7280;">' + escapeHtml(row.item_name || '') + '</td>' +
                    '<td style="padding:6px 12px;white-space:nowrap;font-size:0.85rem;">' + escapeHtml(row.whs_code || '') + '</td>' +
                    '<td style="padding:6px 12px;white-space:nowrap;font-size:0.82rem;color:#64748b;">' + escapeHtml(bin) + '</td>' +
                    '<td style="padding:6px 12px;font-size:0.82rem;color:#64748b;">' + escapeHtml(batch) + '</td>' +
                    '<td style="padding:6px 12px;text-align:right;">' + formatNumber(row.base_qty) + '</td>' +
                    '<td style="padding:6px 12px;text-align:right;color:' + rdc + ';">' + rds + '</td>' +
                    '<td style="padding:6px 12px;text-align:right;font-weight:600;color:#1e40af;">' + formatNumber(row.real_time_qty) + '</td>' +
                    '<td style="padding:6px 12px;font-size:0.82rem;color:#94a3b8;">' + escapeHtml(row.uom || '') + '</td>';
                tbody.appendChild(trDetail);
            });
        }
    });
}

function toggleGroup(gid) {
    var details = document.querySelectorAll('.detail_' + gid);
    var icon = document.getElementById('icon_' + gid);
    if (!details.length) return;
    var isHidden = details[0].style.display === 'none';
    details.forEach(function(el) { el.style.display = isHidden ? '' : 'none'; });
    if (icon) icon.innerHTML = isHidden ? '&#8854;' : '&#8853;';
}

function prevPage() {
    if (currentPage > 1) renderTable(currentPage - 1);
}

function nextPage() {
    var totalPages = Math.max(1, Math.ceil(_groupedData.length / pageSize));
    if (currentPage < totalPages) renderTable(currentPage + 1);
}

function exportCSV() {
    if (currentStockData.length === 0) { showMessage(t('msg.no_data_to_export', '没有可导出的数据'), 'warning'); return; }
    var csvContent = buildCsvContent(currentStockData);
    var groups = buildGroupedData(currentStockData);
    var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', 'stock_export_' + getSystemToday() + '.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showMessage(t('result.exported', '已导出 {0} 种物料, {1} 条明细').replace('{0}', groups.length).replace('{1}', currentStockData.length), 'success');
}

function show(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); }
function hide(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); }

// ============================================================================
// 页面初始化 (仅浏览器环境，Node.js/Jest 跳过自动初始化)
// ============================================================================

if (typeof module === 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initStock);
    else initStock();
}

// ============================================================================
// Node.js (Jest) 导出适配器 — 不影响浏览器环境
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        // 纯函数 (可直接单测)
        buildGroupedData: buildGroupedData,
        buildCsvContent: buildCsvContent,
        buildStockQueryUrl: buildStockQueryUrl,
        buildBrowserUrl: buildBrowserUrl,
        // DOM 绑定函数 (需 JSDOM 环境)
        clearSearch: clearSearch,
        handleSearch: handleSearch,
        handleStockBarcode: handleStockBarcode,
        quickSearch: quickSearch,
        saveSearchHistory: saveSearchHistory,
        loadWarehouseOptions: loadWarehouseOptions,
        renderTable: renderTable,
        toggleGroup: toggleGroup,
        prevPage: prevPage,
        nextPage: nextPage,
        exportCSV: exportCSV,
        doQuery: doQuery,
        initStock: initStock,
        // 内部状态后门，专供测试断言
        _getInternalState: function() {
            return {
                _masterDataRequested: _masterDataRequested,
                currentStockData: currentStockData,
                currentPage: currentPage,
                pageSize: pageSize,
                _groupedData: _groupedData
            };
        },
        _setInternalState: function(state) {
            if (state._masterDataRequested !== undefined) _masterDataRequested = state._masterDataRequested;
            if (state.currentStockData !== undefined) currentStockData = state.currentStockData;
            if (state.currentPage !== undefined) currentPage = state.currentPage;
            if (state.pageSize !== undefined) pageSize = state.pageSize;
            if (state._groupedData !== undefined) _groupedData = state._groupedData;
        }
    };
}
