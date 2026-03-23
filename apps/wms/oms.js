/**
 * WMS OMS 订单管理页 (oms.html) 业务逻辑
 * 从 oms.html 内联 <script> 中抽离，原生 JS 部分 + Vue 看板桥接
 */
/* global checkDep, OmsKanban, OmsPrint */

// ============================================================
// 模块依赖契约 — 软失败降级
// ============================================================
if (typeof window !== 'undefined') {
    if (typeof checkDep === 'function') {
        if (!checkDep('oms-kanban.js', typeof OmsKanban !== 'undefined' ? OmsKanban : undefined)) {
            window.OmsKanban = { mountDDBoard: function() { return null; } };
        }
        if (!checkDep('oms-print.js', typeof OmsPrint !== 'undefined' ? OmsPrint : undefined)) {
            window.OmsPrint = {
                printBarcodes: function() { if (typeof showMessage === 'function') showMessage('打印模块未加载', 'error'); },
                printOrders: function() { if (typeof showMessage === 'function') showMessage('打印模块未加载', 'error'); },
                isLocked: function() { return false; }
            };
        }
    }
    console.debug('[OMS] modules loaded:', {
        kanban: typeof OmsKanban !== 'undefined' && !!OmsKanban.mountDDBoard,
        print: typeof OmsPrint !== 'undefined' && !!OmsPrint.printOrders
    });
}

// ============================================================
// OmsState — 页面级状态闭包
// ============================================================
var OmsState = (function() {
    var _s = {
        orders: [], selectedIds: new Set(), expandedIds: new Set(),
        page: 1, pageSize: 20, totalPages: 1, totalRecords: 0,
        loadingPromise: null, isCreatingDD: false
    };
    var saved = typeof localStorage !== 'undefined' && parseInt(localStorage.getItem('oms_page_size'));
    if (saved && [20, 50, 100].indexOf(saved) >= 0) _s.pageSize = saved;

    var _listeners = [];
    function _notify(key) {
        for (var i = 0; i < _listeners.length; i++) { _listeners[i](key, _s); }
    }

    var api = {
        subscribe: function(fn) { _listeners.push(fn); },
        getOrders: function() { return _s.orders; },
        getPage: function() { return _s.page; },
        getPageSize: function() { return _s.pageSize; },
        getTotalPages: function() { return _s.totalPages; },
        getTotalRecords: function() { return _s.totalRecords; },
        getSelectedIds: function() { return _s.selectedIds; },
        getExpandedIds: function() { return _s.expandedIds; },
        getLoadingPromise: function() { return _s.loadingPromise; },
        isCreatingDD: function() { return _s.isCreatingDD; },
        setOrders: function(v) { _s.orders = v; _notify('orders'); },
        setPage: function(v) { _s.page = v; _notify('page'); },
        setPageSize: function(v) { _s.pageSize = v; _notify('pageSize'); },
        setTotalPages: function(v) { _s.totalPages = v; },
        setTotalRecords: function(v) { _s.totalRecords = v; },
        setLoadingPromise: function(v) { _s.loadingPromise = v; },
        setCreatingDD: function(v) { _s.isCreatingDD = v; },
        toggleSelect: function(id) {
            _s.selectedIds.has(id) ? _s.selectedIds.delete(id) : _s.selectedIds.add(id);
            _notify('selectedIds');
        },
        clearSelection: function() { _s.selectedIds.clear(); _notify('selectedIds'); },
        selectAll: function() {
            _s.orders.forEach(function(o) { _s.selectedIds.add(o.id); });
            _notify('selectedIds');
        },
        deselectAll: function() { _s.selectedIds.clear(); _notify('selectedIds'); },
        toggleExpand: function(id) {
            _s.expandedIds.has(id) ? _s.expandedIds.delete(id) : _s.expandedIds.add(id);
            _notify('expandedIds');
            return _s.expandedIds.has(id);
        },
        expandAll: function() {
            _s.orders.forEach(function(o) { _s.expandedIds.add(o.id); });
            _notify('expandedIds');
        },
        clearExpanded: function() { _s.expandedIds.clear(); _notify('expandedIds'); },
        resetQuery: function() { _s.selectedIds.clear(); _s.expandedIds.clear(); _notify('reset'); },
        _getInternalState: function() {
            return { _orders: _s.orders, _selectedIds: _s.selectedIds,
                     _expandedIds: _s.expandedIds, _page: _s.page,
                     _pageSize: _s.pageSize, _totalPages: _s.totalPages,
                     _totalRecords: _s.totalRecords, _isCreatingDD: _s.isCreatingDD };
        },
        _setInternalState: function(st) {
            if (st._orders !== undefined) _s.orders = st._orders;
            if (st._page !== undefined) _s.page = st._page;
            if (st._pageSize !== undefined) _s.pageSize = st._pageSize;
            if (st._totalPages !== undefined) _s.totalPages = st._totalPages;
            if (st._totalRecords !== undefined) _s.totalRecords = st._totalRecords;
            if (st._selectedIds !== undefined) _s.selectedIds = st._selectedIds;
            if (st._expandedIds !== undefined) _s.expandedIds = st._expandedIds;
        }
    };

    return Object.freeze(api);
})();

var _queryToken = 0; // queryOrders 请求去重令牌

// ============================================================
// 初始化
// ============================================================
function initOMS() {
    if (!checkAuth()) return;

    var todayStr = getSystemToday();
    var monthAgo = new Date(todayStr + 'T00:00:00');
    monthAgo.setDate(monthAgo.getDate() - 30);
    document.getElementById('filterDateTo').value = todayStr;
    document.getElementById('filterDateFrom').value = _formatISODate(monthAgo);

    var inputs = document.querySelectorAll('#filterBP, #filterBPName, #filterDocNum, #filterContainer');
    inputs.forEach(function(el) {
        el.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); queryOrders(); }
        });
    });

    // 同步分页选择器
    var sel = document.getElementById('pageSizeSelect');
    if (sel) sel.value = OmsState.getPageSize();

    // 初始化多选下拉 summary (applyI18n 已执行, span 文字已翻译)
    setTimeout(function() { updateSapSummary(); updateOmsSummary(); }, 50);
}

function _formatISODate(date) {
    return date.toLocaleDateString('sv-SE', { timeZone: CONFIG.timezone });
}

// SAP 状态多选下拉
var _sapDefaults = ['open', 'planned', 'released'];
var _sapLabelMap = { open: 'oms.sap_status_open', planned: 'oms.sap_status_planned', released: 'oms.sap_status_released', closed: 'oms.sap_status_closed', cancelled: 'oms.sap_status_cancelled' };
var _sapFallback = { open: '打开', planned: '计划', released: '已释放', closed: '已关闭', cancelled: '已取消' };

function toggleSapDropdown() {
    var el = document.getElementById('sapStatusSelect');
    el.classList.toggle('open');
}

// 点击外部关闭所有多选下拉
document.addEventListener('click', function(e) {
    ['sapStatusSelect', 'omsStatusSelect'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el && !el.contains(e.target)) el.classList.remove('open');
    });
});

// 语言切换后刷新多选下拉 summary (读 checkbox 旁已翻译的 span 文字)
document.addEventListener('i18nUpdated', function() {
    if (typeof updateSapSummary === 'function') updateSapSummary();
    if (typeof updateOmsSummary === 'function') updateOmsSummary();
});

function toggleSapAll(checked) {
    document.querySelectorAll('.sap-chk').forEach(function(cb) { cb.checked = checked; });
    updateSapSummary();
}

function onSapChkChange() {
    var boxes = document.querySelectorAll('.sap-chk');
    var allChecked = true;
    boxes.forEach(function(cb) { if (!cb.checked) allChecked = false; });
    document.getElementById('sapChkAll').checked = allChecked;
    updateSapSummary();
}

function updateSapSummary() {
    var el = document.getElementById('sapStatusSummary');
    if (!el) return;
    var checkedBoxes = document.querySelectorAll('.sap-chk:checked');
    if (checkedBoxes.length === 0) {
        el.textContent = t('oms.sap_status_none', '未选择');
    } else if (checkedBoxes.length === 5) {
        el.textContent = t('oms.sap_status_all', '全部');
    } else {
        // 从 checkbox 旁边的 span 读已翻译的文字
        var labels = [];
        checkedBoxes.forEach(function(cb) {
            var span = cb.parentElement.querySelector('span');
            labels.push(span ? span.textContent : cb.value);
        });
        el.textContent = labels.join(', ');
    }
}

function resetSapCheckboxes() {
    document.querySelectorAll('.sap-chk').forEach(function(cb) {
        cb.checked = _sapDefaults.indexOf(cb.value) >= 0;
    });
    var allChk = document.getElementById('sapChkAll');
    if (allChk) allChk.checked = false;
    updateSapSummary();
}

function onDocTypeChange(val) {
    var sapGroup = document.getElementById('sapStatusGroup');
    if (sapGroup) {
        if (val === 'DD') {
            sapGroup.style.opacity = '0.4';
            sapGroup.style.pointerEvents = 'none';
        } else {
            sapGroup.style.opacity = '';
            sapGroup.style.pointerEvents = '';
        }
    }
}

function getSelectedSapStatuses() {
    var selected = [];
    document.querySelectorAll('.sap-chk:checked').forEach(function(cb) {
        selected.push(cb.value);
    });
    return selected;
}

// OMS 状态多选下拉
function toggleOmsDropdown() {
    var el = document.getElementById('omsStatusSelect');
    el.classList.toggle('open');
}

function toggleOmsAll(checked) {
    document.querySelectorAll('.oms-chk').forEach(function(cb) { cb.checked = checked; });
    updateOmsSummary();
}

function onOmsChkChange() {
    var boxes = document.querySelectorAll('.oms-chk');
    var allChecked = true;
    boxes.forEach(function(cb) { if (!cb.checked) allChecked = false; });
    document.getElementById('omsChkAll').checked = allChecked;
    updateOmsSummary();
}

function updateOmsSummary() {
    var el = document.getElementById('omsStatusSummary');
    if (!el) return;
    var checkedBoxes = document.querySelectorAll('.oms-chk:checked');
    var total = document.querySelectorAll('.oms-chk').length;
    if (checkedBoxes.length === 0) {
        el.textContent = t('oms.sap_status_none', '未选择');
    } else if (checkedBoxes.length === total) {
        el.textContent = t('oms.status_all', '全部状态');
    } else {
        var labels = [];
        checkedBoxes.forEach(function(cb) {
            var span = cb.parentElement.querySelector('span');
            labels.push(span ? span.textContent : cb.value);
        });
        el.textContent = labels.join(', ');
    }
}

function resetOmsCheckboxes() {
    document.querySelectorAll('.oms-chk').forEach(function(cb) { cb.checked = true; });
    var allChk = document.getElementById('omsChkAll');
    if (allChk) allChk.checked = true;
    updateOmsSummary();
}

function getSelectedOmsStatuses() {
    var selected = [];
    document.querySelectorAll('.oms-chk:checked').forEach(function(cb) {
        selected.push(cb.value);
    });
    return selected;
}

function resetFilters() {
    document.getElementById('filterType').value = '';
    document.getElementById('filterBP').value = '';
    document.getElementById('filterBPName').value = '';
    document.getElementById('filterDocNum').value = '';
    document.getElementById('filterWarehouse').value = '';
    document.getElementById('filterContainer').value = '';
    resetOmsCheckboxes();
    resetSapCheckboxes();
    onDocTypeChange('');
    var todayStr = getSystemToday();
    var monthAgo = new Date(todayStr + 'T00:00:00');
    monthAgo.setDate(monthAgo.getDate() - 30);
    document.getElementById('filterDateFrom').value = _formatISODate(monthAgo);
    document.getElementById('filterDateTo').value = todayStr;
}

// ============================================================
// 查询订单
// ============================================================
async function queryOrders(page) {
    if (typeof page !== 'number') page = 1;
    var token = ++_queryToken;
    OmsState.setPage(page);
    showLoading(true);

    try {
        var params = [];
        var type = document.getElementById('filterType').value;
        var bp = document.getElementById('filterBP').value.trim();
        var bpName = document.getElementById('filterBPName').value.trim();
        var docNum = document.getElementById('filterDocNum').value.trim();
        var warehouse = document.getElementById('filterWarehouse').value.trim();
        var container = document.getElementById('filterContainer').value.trim();
        var omsStatuses = getSelectedOmsStatuses();
        var sapStatuses = getSelectedSapStatuses();
        var dateFrom = document.getElementById('filterDateFrom').value;
        var dateTo = document.getElementById('filterDateTo').value;

        if (type) params.push('doc_type=' + encodeURIComponent(type));
        if (bp) params.push('business_partner=' + encodeURIComponent(bp));
        if (bpName) params.push('bp_name=' + encodeURIComponent(bpName));
        if (warehouse) params.push('warehouse=' + encodeURIComponent(warehouse));
        if (container) params.push('container_no=' + encodeURIComponent(container));
        // SAP 状态标签 (DD 不参与 SAP 过滤; 非全选时才传参)
        if (type !== 'DD' && sapStatuses.length > 0 && sapStatuses.length < 5) {
            params.push('sap_display_status=' + encodeURIComponent(sapStatuses.join(',')));
        }
        if (docNum) {
            // 空格分隔 → 去重 → 限制 ≤50
            var numsArr = docNum.split(/\s+/).filter(Boolean);
            var uniqueNums = [];
            var seen = {};
            numsArr.forEach(function(n) { if (!seen[n]) { seen[n] = true; uniqueNums.push(n); } });
            if (uniqueNums.length > 50) {
                showMessage(t('msg.max_batch_query_50', '最多批量查询 50 个单号'), 'warning');
                showLoading(false);
                return;
            }
            if (uniqueNums.length > 1) {
                // 多单号: 逐个查询合并 (兼容旧后端)
                if (omsStatuses.length > 0 && omsStatuses.length < 6) params.push('oms_status=' + encodeURIComponent(omsStatuses.join(',')));
                if (dateFrom) params.push('date_from=' + encodeURIComponent(dateFrom));
                if (dateTo) params.push('date_to=' + encodeURIComponent(dateTo));
                var allOrders = [];
                var seenIds = {};
                for (var ni = 0; ni < uniqueNums.length; ni++) {
                    try {
                        var bp2 = params.slice();
                        bp2.push('doc_num=' + encodeURIComponent(uniqueNums[ni]));
                        bp2.push('page=1&page_size=100');
                        var bd = await apiGet('/oms/orders?' + bp2.join('&'));
                        if (_queryToken !== token) return; // 丢弃过期响应
                        if (bd && bd.success && bd.orders) {
                            bd.orders.forEach(function(o) {
                                if (!seenIds[o.id]) { seenIds[o.id] = true; allOrders.push(o); }
                            });
                        }
                    } catch(ignore) {}
                }
                if (_queryToken !== token) return; // 丢弃过期响应
                OmsState.setOrders(allOrders);
                OmsState.setTotalRecords(allOrders.length);
                OmsState.setTotalPages(1);
                OmsState.setPage(1);
                OmsState.resetQuery();
                renderOrders();
                renderPagination();
                document.getElementById('toolbarCard').style.display = OmsState.getOrders().length > 0 ? '' : 'none';
                document.getElementById('resultCard').style.display = '';
                updateSelectionCount();
                return;
            }
            params.push('doc_num=' + encodeURIComponent(uniqueNums[0]));
        }
        if (omsStatuses.length > 0 && omsStatuses.length < 6) params.push('oms_status=' + encodeURIComponent(omsStatuses.join(',')));
        if (dateFrom) params.push('date_from=' + encodeURIComponent(dateFrom));
        if (dateTo) params.push('date_to=' + encodeURIComponent(dateTo));
        params.push('page=' + OmsState.getPage());
        params.push('page_size=' + OmsState.getPageSize());

        var url = '/oms/orders?' + params.join('&');
        var data = await apiGet(url);

        if (_queryToken !== token) return; // 丢弃过期响应

        if (!data || !data.success) {
            throw new Error(data && data.message ? data.message : t('common.failed', '查询失败'));
        }

        OmsState.setOrders(data.orders || []);
        OmsState.setTotalRecords(data.total || OmsState.getOrders().length);
        OmsState.setTotalPages(Math.max(1, Math.ceil(OmsState.getTotalRecords() / OmsState.getPageSize())));
        OmsState.resetQuery();

        renderOrders();
        renderPagination();

        document.getElementById('toolbarCard').style.display = OmsState.getOrders().length > 0 ? '' : 'none';
        document.getElementById('resultCard').style.display = '';
        updateSelectionCount();
    } catch (e) {
        if (_queryToken !== token) return; // 丢弃过期响应
        showMessage(t('common.failed', '查询失败') + ': ' + e.message, 'error');
        OmsState.setOrders([]);
        renderOrders();
    } finally {
        showLoading(false);
    }
}

// ============================================================
// 辅助: WMS 超链接生成 (纯函数版本)
// ============================================================

/**
 * 根据单据类型生成 WMS 页面超链接 — 纯函数，无 DOM 依赖
 * WO 指向 PI (生产领料), DD 指向 SO (拣货), 其余同名
 * @param {string} docType - 单据类型
 * @param {string} docDisplay - 显示文本
 * @param {Function} escapeFn - escapeHtml 函数
 * @returns {string} HTML 超链接
 */
function _buildWmsLink(docType, docDisplay, escapeFn) {
    var esc = escapeFn || (typeof escapeHtml !== 'undefined' ? escapeHtml : function(s) { return s; });
    var pageMap = { 'SO': 'so', 'PO': 'po', 'WO': 'pi', 'TR': 'tr', 'DD': 'so' };
    var page = pageMap[docType];
    if (!page) return esc(docDisplay);
    // DD 类型传完整单号 (DD26000001), 其他传纯数字
    var param = (docType === 'DD') ? docDisplay : docDisplay;
    return '<a href="' + page + '.html?docnum=' + encodeURIComponent(param) + '" style="color:var(--primary-color);text-decoration:none;" title="在WMS中打开">' + esc(docDisplay) + '</a>';
}

/**
 * 将 dd_refs 字符串 (如 "DD26000001#1, DD26000002#1") 转为超链接 — 纯函数
 * @param {string} ddRefs - DD 引用字符串
 * @param {Function} escapeFn - escapeHtml 函数
 * @returns {string} HTML 超链接
 */
function _buildDDRefsLinks(ddRefs, escapeFn) {
    var esc = escapeFn || (typeof escapeHtml !== 'undefined' ? escapeHtml : function(s) { return s; });
    if (!ddRefs) return '-';
    return ddRefs.split(',').map(function(ref) {
        ref = ref.trim();
        // 格式: DD26000001#1 → 提取 DD26000001
        var match = ref.match(/^(DD\d+)/i);
        if (match) {
            var ddNum = match[1];
            return '<a href="so.html?docnum=' + encodeURIComponent(ddNum) + '" style="color:#ec4899;text-decoration:none;" title="在WMS中打开">' + esc(ref) + '</a>';
        }
        return esc(ref);
    }).join(', ');
}

/**
 * 构建 OMS 订单明细行 HTML — 纯函数，无 DOM 依赖
 * @param {Object} order - 订单对象 (含 lines, doc_type, is_split, created_at)
 * @param {Object} h - { escapeHtml, formatNumber, formatDate, getOmsStatusLabel }
 * @returns {string} HTML 行字符串
 */
function buildOmsDetailRowHtml(order, h) {
    var lines = order.lines || [];
    if (lines.length === 0) {
        return '<tr class="detail-row" data-detail="' + order.id + '"><td colspan="12" style="text-align:center;padding:12px;color:#999;font-size:0.8rem;">行项目: 0</td></tr>';
    }

    var isDDOrder = order.doc_type === 'DD';
    var html = '';

    lines.forEach(function(ln, idx) {
        var docCol = '';
        if (isDDOrder) {
            var srcLabel = '';
            var srcLink = '';
            if (ln.source_doc_number) {
                srcLabel = ln.source_doc_number;
                if (ln.source_line_num != null) srcLabel += ' L' + ln.source_line_num;
                srcLink = '<a href="so.html?docnum=' + encodeURIComponent(ln.source_doc_number) + '" style="color:#6366f1;text-decoration:none;font-size:0.75rem;" title="查看源单">' + h.escapeHtml(srcLabel) + '</a>';
            }
            docCol = '<td>' + (srcLink || '-') + '</td>';
        } else if (ln.dd_refs) {
            docCol = '<td style="font-size:0.75rem;">' + _buildDDRefsLinks(ln.dd_refs, h.escapeHtml) + '</td>';
        } else {
            docCol = '<td></td>';
        }

        var dateCol = '';
        if (isDDOrder) {
            dateCol = '<td>' + h.formatDate(order.created_at) + '</td>';
        } else if (ln.ship_date) {
            dateCol = '<td>' + h.formatDate(ln.ship_date) + '</td>';
        } else {
            dateCol = '<td></td>';
        }

        html += '<tr class="detail-row" data-detail="' + order.id + '">' +
            '<td></td>' +
            '<td></td>' +
            '<td class="detail-line-num">' + (ln.line_num != null ? ln.line_num : idx) + '</td>' +
            docCol +
            '<td>' + h.escapeHtml(ln.item_code || '-') + '</td>' +
            '<td>' + h.escapeHtml(ln.item_name || '-') + '</td>' +
            '<td style="text-align:right;">' + h.formatNumber(ln.planned_qty || 0) + '</td>' +
            '<td style="text-align:right;">' + h.formatNumber(order.is_split ? (ln.picked_qty || 0) : (ln.actual_qty || 0)) + '</td>' +
            '<td>' + h.escapeHtml(ln.warehouse_code || '-') + '</td>' +
            dateCol +
            '<td><span class="badge badge-' + (ln.status || 'pending') + '">' + h.getOmsStatusLabel(ln.status) + '</span></td>' +
            '</tr>';
    });

    return html;
}

// ============================================================
// 渲染订单表格
// ============================================================
function renderOrders() {
    var tbody = document.getElementById('orderBody');
    document.getElementById('resultCount').textContent = OmsState.getTotalRecords() + ' ' + t('oms.total_records', '条');

    if (OmsState.getOrders().length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="no-data">' + t('export.no_match', '无匹配数据') + '</td></tr>';
        return;
    }

    var html = '';
    OmsState.getOrders().forEach(function(o) {
        var isSelected = OmsState.getSelectedIds().has(o.id);
        var isExpanded = OmsState.getExpandedIds().has(o.id);
        // 已拆分的 SO 变灰 (不可在 WMS 作业，DD 才是真正作业单)
        var isSplitSO = o.is_split && o.doc_type !== 'DD';
        var rowClass = (isSelected ? 'row-selected' : '') + (isSplitSO ? ' row-split-disabled' : '');

        // 单号超链接: SO→so, PO→po, WO→pi, TR→tr, DD→so
        var docDisplay = (o.doc_type === 'DD') ? (o.doc_number || o.sap_doc_num || '-') : (o.sap_doc_num || o.doc_number || '-');
        var docLink = _buildWmsLink(o.doc_type, docDisplay);

        html += '<tr class="' + rowClass + '" data-oid="' + o.id + '">' +
            '<td><input type="checkbox" class="order-check" value="' + o.id + '" ' + (isSelected ? 'checked' : '') + ' onchange="toggleSelect(' + o.id + ')"></td>' +
            '<td><span class="expand-btn" onclick="toggleExpand(' + o.id + ')">' + (isExpanded ? '－' : '＋') + '</span></td>' +
            '<td><span class="badge badge-' + getBadgeClass(o.doc_type) + '">' + escapeHtml(o.doc_type) + '</span></td>' +
            '<td>' + docLink + (o.container_no ? ' <span class="container-tag" title="' + escapeHtml(o.container_no) + '">📦' + escapeHtml(o.container_no) + '</span>' : '') + '</td>' +
            '<td>' + escapeHtml(o.item_code || '-') + '</td>' +
            '<td>' + escapeHtml(o.doc_type === 'WO' && o.item_name ? o.item_name : (o.bp_name || o.business_partner || '-')) + '</td>' +
            '<td style="text-align:right;">' + formatNumber(o.total_planned_qty || 0) + '</td>' +
            '<td style="text-align:right;">' + formatNumber(o.total_actual_qty || 0) + '</td>' +
            '<td>' + escapeHtml(o.warehouse_code || '-') + '</td>' +
            '<td>' + formatDate(o.doc_date || o.created_at) + '</td>' +
            (function() { var s = getSapDisplayStatus(o.sap_status, o.sap_cancelled); return '<td><span class="badge badge-' + s.badge + '">' + s.label + '</span></td>'; })() +
            '<td><span class="badge badge-' + (o.oms_status || 'pending') + '">' + getOmsStatusLabel(o.oms_status) + '</span></td>' +
            '</tr>';

        if (isExpanded) {
            html += renderDetailRow(o);
        }
    });
    tbody.innerHTML = html;
    updateExpandCollapseUI();
}

function renderDetailRow(order) {
    var detailHelpers = { escapeHtml: escapeHtml, formatNumber: formatNumber, formatDate: formatDate, getOmsStatusLabel: getOmsStatusLabel };
    return buildOmsDetailRowHtml(order, detailHelpers);
}

// ============================================================
// 状态标签
// ============================================================
function getOmsStatusLabel(status) {
    var map = {
        'pending': t('oms.status_pending', '待处理'),
        'in_progress': t('oms.status_in_progress', '进行中'),
        'partial': t('oms.line_partial', '部分完成'),
        'completed': t('oms.status_completed', '已完成'),
        'split': t('oms.status_split', '已拆分'),
        'exported': t('oms.status_exported', '已导出'),
        'cancelled': t('oms.status_cancelled', '已取消')
    };
    return map[status] || status || '-';
}

// SAP 状态组合判断 → 显示状态
function getSapDisplayStatus(sapStatus, sapCancelled) {
    if (sapCancelled === 'Y') return { key: 'cancelled', badge: 'cancelled', label: t('oms.sap_status_cancelled', '已取消') };
    switch (sapStatus) {
        case 'O': return { key: 'open', badge: 'pending', label: t('oms.sap_status_open', '打开') };
        case 'P': return { key: 'planned', badge: 'idle', label: t('oms.sap_status_planned', '计划') };
        case 'R': return { key: 'released', badge: 'executing', label: t('oms.sap_status_released', '已释放') };
        case 'C': return { key: 'closed', badge: 'done', label: t('oms.sap_status_closed', '已关闭') };
        case 'L': return { key: 'closed', badge: 'done', label: t('oms.sap_status_closed', '已关闭') };
        default: return { key: 'open', badge: 'pending', label: sapStatus || '-' };
    }
}

function getExecStateLabel(state) {
    var map = {
        'idle': t('oms.exec_idle', '未开始'),
        'executing': t('oms.exec_executing', '执行中'),
        'done': t('oms.exec_done', '已完成')
    };
    return map[state] || state || '-';
}

function getBadgeClass(docType) {
    var map = { 'SO':'in_progress', 'PO':'pending', 'WO':'draft', 'TR':'exported', 'DD':'split' };
    return map[docType] || 'draft';
}

// ============================================================
// 展开/收起
// ============================================================
function toggleExpand(id) {
    var wasExpanded = OmsState.getExpandedIds().has(id);
    OmsState.toggleExpand(id);
    if (!wasExpanded) {
        var order = OmsState.getOrders().find(function(o) { return o.id === id; });
        if (order && !order.lines) {
            loadOrderLines(id);
            return;
        }
    }
    renderOrders();
    updateExpandCollapseUI();
}

function expandAll() {
    var needLoad = [];
    OmsState.getOrders().forEach(function(o) {
        if (!o.lines) needLoad.push(o.id);
    });
    OmsState.expandAll();
    if (needLoad.length > 0) {
        // 批量加载 (异步, 加载完会 renderOrders)
        needLoad.forEach(function(id) { loadOrderLines(id); });
    } else {
        renderOrders();
    }
    updateExpandCollapseUI();
}

function collapseAll() {
    OmsState.clearExpanded();
    renderOrders();
    updateExpandCollapseUI();
}

function updateExpandCollapseUI() {
    var btnExpand = document.getElementById('btnExpandAll');
    var btnCollapse = document.getElementById('btnCollapseAll');
    if (!btnExpand || !btnCollapse) return;
    var hasExpanded = OmsState.getExpandedIds().size > 0;
    var allExpanded = OmsState.getOrders().length > 0 && OmsState.getExpandedIds().size >= OmsState.getOrders().length;
    btnExpand.disabled = allExpanded;
    btnExpand.style.opacity = allExpanded ? '0.4' : '1';
    btnCollapse.disabled = !hasExpanded;
    btnCollapse.style.opacity = hasExpanded ? '1' : '0.4';
}

async function loadOrderLines(orderId) {
    try {
        var data = await apiGet('/oms/order-lines?order_id=' + orderId);
        if (data && data.success) {
            var order = OmsState.getOrders().find(function(o) { return o.id === orderId; });
            if (order) {
                order.lines = data.lines || [];
                order.dd_children = data.dd_children || [];
            }
        }
    } catch (e) {
        showMessage(t('common.failed', '加载失败') + ': ' + e.message, 'error');
    }
    renderOrders();
}

// ============================================================
// 选择
// ============================================================
function toggleSelect(id) {
    OmsState.toggleSelect(id);
    updateSelectionUI(id);
    updateSelectionCount();
}

function toggleSelectAll() {
    var checked = document.getElementById('selectAll').checked;
    if (document.getElementById('selectAllHead')) {
        document.getElementById('selectAllHead').checked = checked;
    }
    if (checked) { OmsState.selectAll(); } else { OmsState.deselectAll(); }
    renderOrders();
    updateSelectionCount();
}

function updateSelectionUI(id) {
    var row = document.querySelector('tr[data-oid="' + id + '"]');
    if (row) {
        if (OmsState.getSelectedIds().has(id)) row.classList.add('row-selected');
        else row.classList.remove('row-selected');
    }
}

function updateSelectionCount() {
    var el = document.getElementById('selectionCount');
    if (el) {
        el.textContent = OmsState.getSelectedIds().size > 0 ? (t('oms.col_select', '已选') + ' ' + OmsState.getSelectedIds().size) : '';
    }
    var sa = document.getElementById('selectAll');
    var sah = document.getElementById('selectAllHead');
    var allChecked = OmsState.getOrders().length > 0 && OmsState.getSelectedIds().size === OmsState.getOrders().length;
    if (sa) sa.checked = allChecked;
    if (sah) sah.checked = allChecked;
}

// ============================================================
// 分页
// ============================================================
function renderPagination() {
    var el = document.getElementById('pagination');
    if (OmsState.getTotalPages() <= 1) { el.style.display = 'none'; return; }
    el.style.display = 'flex';

    document.getElementById('btnFirst').disabled = OmsState.getPage() <= 1;
    document.getElementById('btnPrev').disabled = OmsState.getPage() <= 1;
    document.getElementById('btnNext').disabled = OmsState.getPage() >= OmsState.getTotalPages();
    document.getElementById('btnLast').disabled = OmsState.getPage() >= OmsState.getTotalPages();

    var infoText = t('oms.page_info', '第 {0} / {1} 页').replace('{0}', OmsState.getPage()).replace('{1}', OmsState.getTotalPages());
    document.getElementById('pageInfo').textContent = infoText;
}

function goPage(p) {
    if (p < 1 || p > OmsState.getTotalPages() || p === OmsState.getPage()) return;
    queryOrders(p);
}

// ============================================================
// 批量加载订单行 (纯数据函数, 不管 UI)
// ============================================================
async function ensureOrderLines(orders) {
    var retry = 0;
    while (retry < 2) {
        retry++;
        if (OmsState.getLoadingPromise()) {
            await OmsState.getLoadingPromise();
            continue;
        }
        var needLoad = orders.filter(function(o) { return !o._linesLoaded; });
        if (needLoad.length === 0) return;
        needLoad.forEach(function(o) { delete o._loadError; });

        OmsState.setLoadingPromise((async function() {
            try {
                var ids = needLoad.map(function(o) { return o.id; }).join(',');
                var data = await apiGet('/oms/order-lines/batch?order_ids=' + encodeURIComponent(ids));
                if (data && data.success && data.results) {
                    needLoad.forEach(function(o) {
                        var r = data.results[o.id];
                        if (r) {
                            o.lines = r.lines || [];
                            o.dd_children = r.dd_children || [];
                            o._linesLoaded = true;
                        } else {
                            o._loadError = true;
                        }
                    });
                } else {
                    throw new Error('batch API failed');
                }
            } catch (e) {
                // 回退: 逐个加载 (兼容 batch API 未部署)
                for (var i = 0; i < needLoad.length; i++) {
                    var o = needLoad[i];
                    try {
                        var d = await apiGet('/oms/order-lines?order_id=' + o.id);
                        if (d && d.success) {
                            o.lines = d.lines || [];
                            o.dd_children = d.dd_children || [];
                            o._linesLoaded = true;
                        } else {
                            o._loadError = true;
                        }
                    } catch(e2) {
                        o._loadError = true;
                    }
                }
            }
        })());

        try { await OmsState.getLoadingPromise(); } finally { OmsState.setLoadingPromise(null); }
    }
}

// ============================================================
// 分页选择器
// ============================================================
function changePageSize(size) {
    var newSize = parseInt(size) || 20;
    if ([20, 50, 100].indexOf(newSize) === -1) newSize = 20;
    OmsState.setPageSize(newSize);
    try { localStorage.setItem('oms_page_size', newSize); } catch(e) {}
    queryOrders(1);
}

// ============================================================
// 打印服务 (IIFE 模块)
// ============================================================
function getSelectedOrders() {
    if (OmsState.getSelectedIds().size > 0) {
        return OmsState.getOrders().filter(function(o) { return OmsState.getSelectedIds().has(o.id); });
    }
    return [];
}

// ============================================================
// 打印桥接 (逻辑已移至 oms-print.js → OmsPrint)
// ============================================================
var PrintDeps = null;
function _getPrintDeps() {
    if (!PrintDeps) {
        PrintDeps = Object.freeze({
            showMessage: showMessage, showLoading: showLoading,
            ensureOrderLines: ensureOrderLines,
            generateBarcodeUrl: generateBarcodeUrl,
            escapeHtml: escapeHtml, formatNumber: formatNumber,
            formatDate: formatDate, getOmsStatusLabel: getOmsStatusLabel,
            getSapDisplayStatus: getSapDisplayStatus, t: t
        });
    }
    return PrintDeps;
}

async function printSelectedOrders() {
    try {
        await OmsPrint.printOrders(getSelectedOrders(), _getPrintDeps());
    } catch(e) {
        console.error('[PrintOrders] error:', e);
        showMessage(t('msg.print_failed', '打印失败: {0}').replace('{0}', e.message), 'error');
    }
}

async function printSelectedBarcodes() {
    try {
        await OmsPrint.printBarcodes(getSelectedOrders(), _getPrintDeps());
    } catch(e) {
        console.error('[PrintBarcodes] error:', e);
        showMessage(t('msg.print_failed', '打印失败: {0}').replace('{0}', e.message), 'error');
    }
}

// ============================================================
// DD 全屏看板 — 桥接 (原生 JS → Vue Store)
// ============================================================
async function openDDSplitModal() {
    if (OmsState.isCreatingDD()) return;
    OmsState.setCreatingDD(true);
    try {
        var selected = getSelectedOrders();
        if (selected.length === 0) {
            showMessage(t('oms.no_selection', '请先选择订单'), 'warning');
            return;
        }

        // 校验: 所有选中必须是 SO + 非 executing/done
        for (var vi = 0; vi < selected.length; vi++) {
            var o = selected[vi];
            if (o.doc_type !== 'SO') {
                showMessage('DD ' + t('oms.dd_title', '拆单') + ': ' + t('oms.search_type', '类型') + ' = SO (' + (o.sap_doc_num || o.doc_number) + ')', 'warning');
                return;
            }
            if (o.execution_state === 'executing' || o.execution_state === 'done') {
                showMessage(t('oms.dd_locked', '该订单仓库已开始作业，禁止拆单') + ' (' + (o.sap_doc_num || o.doc_number) + ')', 'error');
                return;
            }
            if (o.dd_children && o.dd_children.length > 0) {
                showMessage(t('oms.dd_already_split', '该订单已拆分DD，不能重复创建') + ' (' + (o.sap_doc_num || o.doc_number) + ')', 'warning');
                return;
            }
        }

        // 批量加载行数据
        showLoading(true);
        await ensureOrderLines(selected);
        showLoading(false);

        // 检查加载失败
        var failed = selected.filter(function(o) { return o._loadError; });
        if (failed.length > 0) {
            showMessage(t('common.failed', '加载失败') + ': ' + failed.length + ' 个订单数据加载异常', 'error');
            return;
        }

        // 检查无行项目
        var emptyOrders = selected.filter(function(o) { return !o.lines || o.lines.length === 0; });
        if (emptyOrders.length === selected.length) {
            showMessage(t('oms.no_lines', '该订单没有行项目'), 'warning');
            return;
        }

        // 校验: 不同仓库的 SO 不允许合并创建 DD
        if (selected.length > 1) {
            var warehouses = new Set();
            selected.forEach(function(o) {
                (o.lines || []).forEach(function(ln) {
                    if (ln.warehouse_code) warehouses.add(ln.warehouse_code);
                });
                // 回退到订单头仓库
                if ((!o.lines || o.lines.length === 0) && o.warehouse_code) {
                    warehouses.add(o.warehouse_code);
                }
            });
            if (warehouses.size > 1) {
                showMessage(t('oms.dd_warehouse_mismatch', '不同仓库的SO不允许合并创建DD') + ' (' + Array.from(warehouses).join(', ') + ')', 'error');
                return;
            }
        }

        // 桥接到 Vue
        if (window._ddVueApp) {
            window._ddVueApp.initFromOrders(selected);
        } else {
            showMessage(t('msg.dd_init_failed', 'DD看板初始化失败，请刷新页面重试'), 'error');
        }
    } catch(e) {
        console.error('DD创建异常:', e);
        showMessage(t('common.failed', '操作失败') + ': ' + e.message, 'error');
    } finally {
        OmsState.setCreatingDD(false);
    }
}

// ============================================================
// 页面加载
// ============================================================
if (typeof document !== 'undefined') {
    function _boot() {
        initOMS();
        if (typeof OmsKanban !== 'undefined' && OmsKanban.mountDDBoard) {
            OmsKanban.mountDDBoard('#ddApp');
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _boot);
    } else {
        _boot();
    }
}

// ==========================================
// Node.js (Jest) 导出适配器
// ==========================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        // 状态标签
        getOmsStatusLabel: getOmsStatusLabel,
        getExecStateLabel: getExecStateLabel,
        getBadgeClass: getBadgeClass,
        // 查询与渲染
        queryOrders: queryOrders,
        resetFilters: resetFilters,
        renderOrders: renderOrders,
        renderDetailRow: renderDetailRow,
        buildOmsDetailRowHtml: buildOmsDetailRowHtml,
        renderPagination: renderPagination,
        goPage: goPage,
        changePageSize: changePageSize,
        // 选择
        toggleSelect: toggleSelect,
        toggleSelectAll: toggleSelectAll,
        updateSelectionCount: updateSelectionCount,
        getSelectedOrders: getSelectedOrders,
        // 展开/收起
        toggleExpand: toggleExpand,
        expandAll: expandAll,
        collapseAll: collapseAll,
        updateExpandCollapseUI: updateExpandCollapseUI,
        updateSelectionUI: updateSelectionUI,
        loadOrderLines: loadOrderLines,
        // 批量加载
        ensureOrderLines: ensureOrderLines,
        // 打印 (逻辑已移至 oms-print.js)
        printSelectedOrders: printSelectedOrders,
        printSelectedBarcodes: printSelectedBarcodes,
        _getPrintDeps: _getPrintDeps,
        // DD 桥接
        openDDSplitModal: openDDSplitModal,
        // 初始化
        initOMS: initOMS,
        _formatISODate: _formatISODate,
        // 辅助链接
        _buildWmsLink: _buildWmsLink,
        _buildDDRefsLinks: _buildDDRefsLinks,
        // 暴露内部状态供测试断言
        _getInternalState: function() { return OmsState._getInternalState(); },
        _setInternalState: function(state) { OmsState._setInternalState(state); }
    };
}
