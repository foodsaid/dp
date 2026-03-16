/**
 * WMS OMS 订单管理页 (oms.html) 业务逻辑
 * 从 oms.html 内联 <script> 中抽离，原生 JS 部分 + Vue 看板桥接
 */

// ============================================================
// 全局变量 (页面级状态)
// ============================================================
var _orders = [];
var _selectedIds = new Set();
var _expandedIds = new Set();
var _page = 1;
var _pageSize = (typeof localStorage !== 'undefined' && parseInt(localStorage.getItem('oms_page_size'))) || 20;
if ([20, 50, 100].indexOf(_pageSize) === -1) _pageSize = 20;
var _totalPages = 1;
var _totalRecords = 0;
var _loadingPromise = null;    // ensureOrderLines Promise 共享
var _isCreatingDD = false;     // DD 创建锁 (防 double click)

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
    if (sel) sel.value = _pageSize;
}

function _formatISODate(date) {
    return date.toLocaleDateString('sv-SE', { timeZone: CONFIG.timezone });
}

function resetFilters() {
    document.getElementById('filterType').value = '';
    document.getElementById('filterBP').value = '';
    document.getElementById('filterBPName').value = '';
    document.getElementById('filterDocNum').value = '';
    document.getElementById('filterWarehouse').value = '';
    document.getElementById('filterContainer').value = '';
    document.getElementById('filterStatus').value = '';
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
    _page = page;
    showLoading(true);

    try {
        var params = [];
        var type = document.getElementById('filterType').value;
        var bp = document.getElementById('filterBP').value.trim();
        var bpName = document.getElementById('filterBPName').value.trim();
        var docNum = document.getElementById('filterDocNum').value.trim();
        var warehouse = document.getElementById('filterWarehouse').value.trim();
        var container = document.getElementById('filterContainer').value.trim();
        var status = document.getElementById('filterStatus').value;
        var dateFrom = document.getElementById('filterDateFrom').value;
        var dateTo = document.getElementById('filterDateTo').value;

        if (type) params.push('doc_type=' + encodeURIComponent(type));
        if (bp) params.push('business_partner=' + encodeURIComponent(bp));
        if (bpName) params.push('bp_name=' + encodeURIComponent(bpName));
        if (warehouse) params.push('warehouse=' + encodeURIComponent(warehouse));
        if (container) params.push('container_no=' + encodeURIComponent(container));
        if (docNum) {
            // 空格分隔 → 去重 → 限制 ≤50
            var numsArr = docNum.split(/\s+/).filter(Boolean);
            var uniqueNums = [];
            var seen = {};
            numsArr.forEach(function(n) { if (!seen[n]) { seen[n] = true; uniqueNums.push(n); } });
            if (uniqueNums.length > 50) {
                showMessage('最多批量查询 50 个单号', 'warning');
                showLoading(false);
                return;
            }
            if (uniqueNums.length > 1) {
                // 多单号: 逐个查询合并 (兼容旧后端)
                if (status) params.push('oms_status=' + encodeURIComponent(status));
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
                        if (bd && bd.success && bd.orders) {
                            bd.orders.forEach(function(o) {
                                if (!seenIds[o.id]) { seenIds[o.id] = true; allOrders.push(o); }
                            });
                        }
                    } catch(ignore) {}
                }
                _orders = allOrders;
                _totalRecords = allOrders.length;
                _totalPages = 1;
                _page = 1;
                _selectedIds.clear();
                _expandedIds.clear();
                renderOrders();
                renderPagination();
                document.getElementById('toolbarCard').style.display = _orders.length > 0 ? '' : 'none';
                document.getElementById('resultCard').style.display = '';
                updateSelectionCount();
                return;
            }
            params.push('doc_num=' + encodeURIComponent(uniqueNums[0]));
        }
        if (status) params.push('oms_status=' + encodeURIComponent(status));
        if (dateFrom) params.push('date_from=' + encodeURIComponent(dateFrom));
        if (dateTo) params.push('date_to=' + encodeURIComponent(dateTo));
        params.push('page=' + _page);
        params.push('page_size=' + _pageSize);

        var url = '/oms/orders?' + params.join('&');
        var data = await apiGet(url);

        if (!data || !data.success) {
            throw new Error(data && data.message ? data.message : t('common.failed', '查询失败'));
        }

        _orders = data.orders || [];
        _totalRecords = data.total || _orders.length;
        _totalPages = Math.max(1, Math.ceil(_totalRecords / _pageSize));
        _selectedIds.clear();
        _expandedIds.clear();

        renderOrders();
        renderPagination();

        document.getElementById('toolbarCard').style.display = _orders.length > 0 ? '' : 'none';
        document.getElementById('resultCard').style.display = '';
        updateSelectionCount();
    } catch (e) {
        showMessage(t('common.failed', '查询失败') + ': ' + e.message, 'error');
        _orders = [];
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
        return '<tr class="detail-row" data-detail="' + order.id + '"><td colspan="11" style="text-align:center;padding:12px;color:#999;font-size:0.8rem;">行项目: 0</td></tr>';
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
    document.getElementById('resultCount').textContent = _totalRecords;

    if (_orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="no-data">' + t('export.no_match', '无匹配数据') + '</td></tr>';
        return;
    }

    var html = '';
    _orders.forEach(function(o) {
        var isSelected = _selectedIds.has(o.id);
        var isExpanded = _expandedIds.has(o.id);
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
    if (_expandedIds.has(id)) {
        _expandedIds.delete(id);
    } else {
        _expandedIds.add(id);
        var order = _orders.find(function(o) { return o.id === id; });
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
    _orders.forEach(function(o) {
        _expandedIds.add(o.id);
        if (!o.lines) needLoad.push(o.id);
    });
    if (needLoad.length > 0) {
        // 批量加载 (异步, 加载完会 renderOrders)
        needLoad.forEach(function(id) { loadOrderLines(id); });
    } else {
        renderOrders();
    }
    updateExpandCollapseUI();
}

function collapseAll() {
    _expandedIds.clear();
    renderOrders();
    updateExpandCollapseUI();
}

function updateExpandCollapseUI() {
    var btnExpand = document.getElementById('btnExpandAll');
    var btnCollapse = document.getElementById('btnCollapseAll');
    if (!btnExpand || !btnCollapse) return;
    var hasExpanded = _expandedIds.size > 0;
    var allExpanded = _orders.length > 0 && _expandedIds.size >= _orders.length;
    btnExpand.disabled = allExpanded;
    btnExpand.style.opacity = allExpanded ? '0.4' : '1';
    btnCollapse.disabled = !hasExpanded;
    btnCollapse.style.opacity = hasExpanded ? '1' : '0.4';
}

async function loadOrderLines(orderId) {
    try {
        var data = await apiGet('/oms/order-lines?order_id=' + orderId);
        if (data && data.success) {
            var order = _orders.find(function(o) { return o.id === orderId; });
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
    if (_selectedIds.has(id)) { _selectedIds.delete(id); }
    else { _selectedIds.add(id); }
    updateSelectionUI(id);
    updateSelectionCount();
}

function toggleSelectAll() {
    var checked = document.getElementById('selectAll').checked;
    if (document.getElementById('selectAllHead')) {
        document.getElementById('selectAllHead').checked = checked;
    }
    _orders.forEach(function(o) {
        if (checked) _selectedIds.add(o.id); else _selectedIds.delete(o.id);
    });
    renderOrders();
    updateSelectionCount();
}

function updateSelectionUI(id) {
    var row = document.querySelector('tr[data-oid="' + id + '"]');
    if (row) {
        if (_selectedIds.has(id)) row.classList.add('row-selected');
        else row.classList.remove('row-selected');
    }
}

function updateSelectionCount() {
    var el = document.getElementById('selectionCount');
    if (el) {
        el.textContent = _selectedIds.size > 0 ? (t('oms.col_select', '已选') + ' ' + _selectedIds.size) : '';
    }
    var sa = document.getElementById('selectAll');
    var sah = document.getElementById('selectAllHead');
    var allChecked = _orders.length > 0 && _selectedIds.size === _orders.length;
    if (sa) sa.checked = allChecked;
    if (sah) sah.checked = allChecked;
}

// ============================================================
// 分页
// ============================================================
function renderPagination() {
    var el = document.getElementById('pagination');
    if (_totalPages <= 1) { el.style.display = 'none'; return; }
    el.style.display = 'flex';

    document.getElementById('btnFirst').disabled = _page <= 1;
    document.getElementById('btnPrev').disabled = _page <= 1;
    document.getElementById('btnNext').disabled = _page >= _totalPages;
    document.getElementById('btnLast').disabled = _page >= _totalPages;

    var infoText = t('oms.page_info', '第 {0} / {1} 页').replace('{0}', _page).replace('{1}', _totalPages);
    document.getElementById('pageInfo').textContent = infoText;
}

function goPage(p) {
    if (p < 1 || p > _totalPages || p === _page) return;
    queryOrders(p);
}

// ============================================================
// 批量加载订单行 (纯数据函数, 不管 UI)
// ============================================================
async function ensureOrderLines(orders) {
    var retry = 0;
    while (retry < 2) {
        retry++;
        if (_loadingPromise) {
            await _loadingPromise;
            continue;
        }
        var needLoad = orders.filter(function(o) { return !o._linesLoaded; });
        if (needLoad.length === 0) return;
        needLoad.forEach(function(o) { delete o._loadError; });

        _loadingPromise = (async function() {
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
        })();

        try { await _loadingPromise; } finally { _loadingPromise = null; }
    }
}

// ============================================================
// 分页选择器
// ============================================================
function changePageSize(size) {
    _pageSize = parseInt(size) || 20;
    if ([20, 50, 100].indexOf(_pageSize) === -1) _pageSize = 20;
    try { localStorage.setItem('oms_page_size', _pageSize); } catch(e) {}
    queryOrders(1);
}

// ============================================================
// 打印服务 (IIFE 模块)
// ============================================================
function getSelectedOrders() {
    if (_selectedIds.size > 0) {
        return _orders.filter(function(o) { return _selectedIds.has(o.id); });
    }
    return [];
}

var PrintService = (function() {
    var _printLock = false;

    function safeClose(win) {
        try { if (win && !win.closed) win.close(); } catch(e) {}
    }

    async function generateBarcodesInChunks(items, cache, chunkSize, type) {
        chunkSize = chunkSize || 50;
        type = type || 'barcode';
        for (var i = 0; i < items.length; i += chunkSize) {
            var chunk = items.slice(i, i + chunkSize);
            chunk.forEach(function(item) {
                if (!cache[item.item_code]) {
                    cache[item.item_code] = generateBarcodeUrl(item.item_code, type);
                }
            });
            await new Promise(function(r) { setTimeout(r, 16); });
        }
    }

    // 打印物料条码 (去重+排序)
    async function printBarcodes(selected) {
        console.debug('[PrintBarcodes] selected:', selected.length, 'printLock:', _printLock);
        if (_printLock) return;
        _printLock = true;
        var newWin = null;
        try {
            if (selected.length === 0) {
                showMessage(t('oms.no_selection', '请先选择订单'), 'warning');
                return;
            }
            if (selected.length > 50) {
                showMessage('最多批量打印 50 个订单', 'warning');
                return;
            }

            // 同步打开窗口 (在 await 之前)
            newWin = window.open('', '_blank');
            if (!newWin) {
                showMessage('浏览器拦截了打印窗口。请在地址栏右侧点击"弹窗被拦截"图标，允许本网站弹窗后重试', 'error');
                return;
            }
            newWin.document.write('<html><body><p style="padding:20px;font-size:18px">' + t('common.loading', '加载中...') + '</p></body></html>');
            newWin.document.close();

            // 批量加载行数据
            showLoading(true);
            await ensureOrderLines(selected);
            showLoading(false);

            // 检查加载失败
            var failed = selected.filter(function(o) { return o._loadError; });
            if (failed.length > 0) {
                safeClose(newWin);
                showMessage(failed.length + ' 个订单数据加载失败，请重试', 'error');
                return;
            }

            // 合并所有行 → 提取 item_code + item_name → Map 去重 → 排序
            var totalLines = selected.reduce(function(sum, o) { return sum + (o.lines ? o.lines.length : 0); }, 0);
            if (totalLines > 5000) {
                safeClose(newWin);
                showMessage('物料行数过多 (' + totalLines + ')，请减少选择的订单数量', 'warning');
                return;
            }

            // 所有行 → Map 去重 → 排序 (所有类型统一处理)
            var itemMap = Object.create(null);
            var allItems = [];
            selected.forEach(function(o) {
                (o.lines || []).forEach(function(ln) {
                    if (ln.item_code && !itemMap[ln.item_code]) {
                        itemMap[ln.item_code] = true;
                        allItems.push({ item_code: ln.item_code, item_name: ln.item_name || '' });
                    }
                });
            });

            allItems.sort(function(a, b) { return a.item_code.localeCompare(b.item_code); });

            if (allItems.length === 0) {
                safeClose(newWin);
                showMessage(t('oms.no_lines', '该订单没有行项目'), 'warning');
                return;
            }

            // 生成 QR 码
            var barcodeCache = Object.create(null);
            await generateBarcodesInChunks(allItems, barcodeCache, 50, 'qrcode');

            var html = '<!DOCTYPE html><html><head><title>' + t('oms.print_barcode', '打印条码') + '</title>' +
                '<style>body{font-family:Arial;padding:4px;margin:0;font-size:12px;}' +
                '.items{display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-start;align-content:flex-start;}' +
                '.item-card{border:1px solid #ccc;padding:3px;text-align:center;width:calc(16.66% - 4px);min-width:85px;box-sizing:border-box;page-break-inside:avoid;}' +
                '.item-card img{width:76px;height:76px;}' +
                '.item-code{font-size:9px;word-break:break-all;font-weight:bold;margin-top:1px;}' +
                '.item-name{font-size:7px;color:#666;white-space:normal;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.2em;}' +
                '@media print{button{display:none;}@page{margin:3mm;}}</style></head><body>';

            html += '<div class="items">';
            allItems.forEach(function(item) {
                html += '<div class="item-card"><img src="' + (barcodeCache[item.item_code] || '') + '"><div class="item-code">' + escapeHtml(item.item_code) + '</div><div class="item-name">' + escapeHtml(item.item_name || '') + '</div></div>';
            });
            html += '</div>';

            html += '<br><button onclick="window.print()">打印</button></body></html>';

            newWin.document.open();
            newWin.document.write(html);
            newWin.document.close();

        } catch(e) {
            console.error('打印条码异常:', e);
            showMessage('打印失败: ' + e.message, 'error');
            safeClose(newWin);
        } finally {
            _printLock = false;
            showLoading(false);
        }
    }

    // 打印订单 (WMS 标准格式)
    async function printOrders(selected) {
        if (_printLock) return;
        _printLock = true;
        var newWin = null;
        try {
            if (selected.length === 0) {
                showMessage(t('oms.no_selection', '请先选择订单'), 'warning');
                return;
            }
            if (selected.length > 50) {
                showMessage('最多批量打印 50 个订单', 'warning');
                return;
            }

            // 同步打开窗口
            newWin = window.open('', '_blank');
            if (!newWin) {
                showMessage('浏览器拦截了打印窗口。请在地址栏右侧点击"弹窗被拦截"图标，允许本网站弹窗后重试', 'error');
                return;
            }
            newWin.document.write('<html><body><p style="padding:20px;font-size:18px">' + t('common.loading', '加载中...') + '</p></body></html>');
            newWin.document.close();

            // 批量加载行数据
            showLoading(true);
            await ensureOrderLines(selected);
            showLoading(false);

            // 检查加载失败
            var failed = selected.filter(function(o) { return o._loadError; });
            if (failed.length > 0) {
                safeClose(newWin);
                showMessage(failed.length + ' 个订单数据加载失败，请重试', 'error');
                return;
            }

            var totalLines = selected.reduce(function(sum, o) { return sum + (o.lines ? o.lines.length : 0); }, 0);
            if (totalLines > 5000) {
                safeClose(newWin);
                showMessage('物料行数过多 (' + totalLines + ')，请减少选择的订单数量', 'warning');
                return;
            }

            // 分离 WO 和非 WO
            var woOrders = selected.filter(function(o) { return o.doc_type === 'WO'; });
            var nonWoOrders = selected.filter(function(o) { return o.doc_type !== 'WO'; });

            // 收集所有物料并分块生成 QR (含 WO 抬头物料)
            var barcodeCache = Object.create(null);
            var allItems = [];
            selected.forEach(function(o) {
                if (o.item_code && !barcodeCache[o.item_code]) {
                    allItems.push({ item_code: o.item_code });
                    barcodeCache[o.item_code] = true;
                }
                (o.lines || []).forEach(function(ln) {
                    if (ln.item_code && !barcodeCache[ln.item_code]) {
                        allItems.push({ item_code: ln.item_code });
                        barcodeCache[ln.item_code] = true;
                    }
                });
            });
            Object.keys(barcodeCache).forEach(function(k) { delete barcodeCache[k]; });
            await generateBarcodesInChunks(allItems, barcodeCache, 50, 'qrcode');

            // 为所有订单生成 QR 码
            var qrCache = Object.create(null);
            selected.forEach(function(o) {
                var docNum = (o.doc_type === 'DD') ? (o.doc_number || o.sap_doc_num || '') : (o.sap_doc_num || o.doc_number || '');
                var key = (o.doc_type || '') + docNum;
                if (!qrCache[key]) {
                    qrCache[key] = generateBarcodeUrl(key, 'qrcode');
                }
            });

            // 拼接纯静态 HTML
            var html = '<!DOCTYPE html><html><head><title>' + t('oms.print_order', '打印订单') + '</title>';
            html += '<style>body{font-family:Arial,sans-serif;padding:10px;font-size:12px;}';
            html += '.order-block{page-break-after:always;margin-bottom:20px;}';
            html += '.order-block:last-child{page-break-after:auto;}';
            html += '.order-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px;border-bottom:2px solid #333;padding-bottom:8px;}';
            html += '.order-qr{width:80px;height:80px;margin-left:auto;}';
            html += '.order-info{flex:1;}';
            html += '.order-info h2{margin:0 0 4px;font-size:1.1rem;}';
            html += '.order-meta{font-size:0.8rem;color:#555;}';
            html += '.order-meta td{padding:2px 12px 2px 0;}';
            html += '.lines-table{width:100%;border-collapse:collapse;font-size:0.75rem;margin-top:6px;}';
            html += '.lines-table th{background:#f0f0f0;padding:4px 6px;border:1px solid #ccc;text-align:left;font-size:0.7rem;}';
            html += '.lines-table td{padding:3px 6px;border:1px solid #ddd;}';
            html += '.lines-table .bc-cell img{width:1.5cm;height:1.5cm;}';
            html += '.item-name-cell{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;word-break:break-all;}';
            // WO 专属样式: 抬头卡片网格 (6列) + BOM 明细表
            html += '.wo-cards{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px;}';
            html += '.wo-card{border:1px solid #ccc;padding:3px;text-align:center;width:calc(16.66% - 4px);min-width:85px;box-sizing:border-box;page-break-inside:avoid;}';
            html += '.wo-card img{width:1.5cm;height:1.5cm;}';
            html += '.wo-num{font-size:9px;font-weight:bold;margin-top:1px;}';
            html += '.wo-item{font-size:8px;color:#333;word-break:break-all;}';
            html += '.wo-wh{font-size:8px;color:#666;}';
            html += '.wo-sep{border-top:2px solid #333;margin:6px 0;}';
            html += '.wo-tbl{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:4px;}';
            html += '.wo-tbl th,.wo-tbl td{border:1px solid #ddd;padding:2px 4px;text-align:left;}';
            html += '.wo-tbl th{background:#f5f5f5;font-weight:bold;}';
            html += '.wo-tbl img{width:1.5cm;height:1.5cm;}.num{text-align:right;}';
            html += '@page{margin:5mm;}@media print{body{margin:0;}button{display:none;}}</style></head><body>';

            // === 非 WO 订单: 标准格式 (分页) ===
            nonWoOrders.forEach(function(o, idx) {
                var docNum = (o.doc_type === 'DD') ? (o.doc_number || o.sap_doc_num || '-') : (o.sap_doc_num || o.doc_number || '-');
                var lines = o.lines || [];

                html += '<div class="order-header">';
                html += '<div class="order-info">';
                html += '<h2>' + escapeHtml(o.doc_type) + ' #' + escapeHtml(docNum) + '</h2>';
                html += '<table class="order-meta"><tr>';
                html += '<td><strong>' + t('oms.search_bp', '客商') + ':</strong> ' + escapeHtml(o.bp_name || o.business_partner || '-') + '</td>';
                html += '<td><strong>' + t('oms.search_date_from', '日期') + ':</strong> ' + formatDate(o.doc_date) + '</td>';
                html += '<td><strong>' + t('oms.col_status', '状态') + ':</strong> ' + getOmsStatusLabel(o.oms_status) + (o.is_split && o.oms_status === 'split' ? ' ⚠' : '') + '</td>';
                html += '</tr><tr>';
                html += '<td><strong>' + t('oms.due_date', '交期') + ':</strong> ' + formatDate(o.due_date) + '</td>';
                if (o.container_no) {
                    html += '<td><strong>' + t('oms.col_container', '柜号') + ':</strong> ' + escapeHtml(o.container_no) + '</td>';
                } else {
                    html += '<td></td>';
                }
                html += '<td></td>';
                html += '</tr></table></div>';
                html += '<img class="order-qr" src="' + (qrCache[(o.doc_type || '') + docNum] || '') + '">';
                html += '</div>';

                if (lines.length > 0) {
                    var isDDPrint = o.doc_type === 'DD';
                    html += '<table class="lines-table"><thead><tr>';
                    html += '<th>#</th><th>' + t('oms.print_barcode', '条码') + '</th>';
                    html += '<th>' + t('oms.item_code', '物料编码') + '</th>';
                    html += '<th>' + t('oms.item_name', '物料名称') + '</th>';
                    if (isDDPrint) {
                        html += '<th style="text-align:left;font-size:0.65rem;">原单</th>';
                        html += '<th style="text-align:right;font-size:0.65rem;">原单数</th>';
                    }
                    html += '<th style="text-align:right;">' + t('oms.qty', '数量') + '</th>';
                    html += '<th>' + t('oms.warehouse', '仓库') + '</th>';
                    html += '</tr></thead><tbody>';
                    lines.forEach(function(ln) {
                        html += '<tr>';
                        html += '<td>' + ln.line_num + '</td>';
                        html += '<td class="bc-cell"><img src="' + (barcodeCache[ln.item_code] || '') + '"></td>';
                        html += '<td>' + escapeHtml(ln.item_code || '') + '</td>';
                        html += '<td><div class="item-name-cell">' + escapeHtml(ln.item_name || '') + '</div></td>';
                        if (isDDPrint) {
                            var srcRef = '';
                            if (ln.source_doc_number) {
                                srcRef = ln.source_doc_number;
                                if (ln.source_line_num != null) srcRef += ' L' + ln.source_line_num;
                            }
                            html += '<td style="font-size:0.65rem;">' + escapeHtml(srcRef) + '</td>';
                            html += '<td style="text-align:right;color:#999;">' + (ln.source_planned_qty != null ? Number(ln.source_planned_qty).toLocaleString() : '-') + '</td>';
                        }
                        html += '<td style="text-align:right;">' + Number(ln.planned_qty || ln.quantity || 0).toLocaleString() + '</td>';
                        html += '<td>' + escapeHtml(ln.warehouse_code || '') + '</td>';
                        html += '</tr>';
                    });
                    html += '</tbody></table>';
                } else {
                    html += '<p style="color:#c00;font-size:0.8rem;">⚠ ' + t('oms.no_lines', '该订单没有行项目') + '</p>';
                }

                if (idx < nonWoOrders.length - 1 || woOrders.length > 0) {
                    html += '<div style="page-break-after:always"></div>';
                }
            });

            // === WO 订单: 抬头 + 合并明细 (相同物料合并为一行) ===
            if (woOrders.length > 0) {
                // WO 抬头卡片 (6列网格，类似条码打印格式)
                html += '<div class="wo-cards">';
                woOrders.forEach(function(wo) {
                    var docNum = wo.sap_doc_num || wo.doc_number || '-';
                    var woKey = 'WO' + docNum;
                    html += '<div class="wo-card">';
                    if (qrCache[woKey]) html += '<img src="' + qrCache[woKey] + '">';
                    html += '<div class="wo-num">' + escapeHtml(docNum) + '</div>';
                    html += '<div class="wo-item">' + escapeHtml(wo.item_code || '-') + '</div>';
                    html += '<div class="wo-wh">' + escapeHtml(wo.warehouse_code || '-') + ' ' + formatNumber(wo.total_planned_qty || 0) + '</div>';
                    html += '</div>';
                });
                html += '</div>';
                html += '<div class="wo-sep"></div>';
                // 合并所有 WO BOM 行: 相同 (item_code + warehouse_code) 合并为一行
                var mergedMap = Object.create(null);
                woOrders.forEach(function(wo) {
                    (wo.lines || []).forEach(function(ln) {
                        var key = (ln.item_code || '') + '||' + (ln.warehouse_code || '');
                        if (!mergedMap[key]) mergedMap[key] = { item_code: ln.item_code || '', item_name: ln.item_name || '', warehouse_code: ln.warehouse_code || '', planned: 0, issued: 0 };
                        mergedMap[key].planned += Number(ln.planned_qty) || 0;
                        mergedMap[key].issued += Number(ln.actual_qty || ln.delivered_qty) || 0;
                    });
                });
                var mergedRows = Object.values(mergedMap).sort(function(a, b) { return a.item_code.localeCompare(b.item_code); });
                if (mergedRows.length > 0) {
                    html += '<table class="wo-tbl"><thead><tr><th>#</th><th>QR</th><th>' + t('oms.col_item_code', '物料号') + '</th><th>' + t('field.item_name', '名称') + '</th><th>' + t('field.planned_qty', '计划数') + '</th><th>' + t('oms.issued_qty', '已发数量') + '</th><th>' + t('field.warehouse', '仓库') + '</th></tr></thead><tbody>';
                    mergedRows.forEach(function(s, idx) {
                        html += '<tr><td>' + (idx + 1) + '</td>' +
                            '<td>' + (s.item_code && barcodeCache[s.item_code] ? '<img src="' + barcodeCache[s.item_code] + '">' : '') + '</td>' +
                            '<td>' + escapeHtml(s.item_code) + '</td><td>' + escapeHtml(s.item_name) + '</td>' +
                            '<td class="num">' + formatNumber(s.planned) + '</td>' +
                            '<td class="num">' + formatNumber(s.issued) + '</td>' +
                            '<td>' + escapeHtml(s.warehouse_code || '-') + '</td></tr>';
                    });
                    html += '</tbody></table>';
                }
            }

            html += '<br><button onclick="window.print()">打印</button>';
            html += '</body></html>';

            newWin.document.open();
            newWin.document.write(html);
            newWin.document.close();

        } catch(e) {
            console.error('打印订单异常:', e);
            showMessage('打印失败: ' + e.message, 'error');
            safeClose(newWin);
        } finally {
            _printLock = false;
            showLoading(false);
        }
    }

    return {
        printBarcodes: printBarcodes,
        printOrders: printOrders,
        isLocked: function() { return _printLock; }
    };
})();

async function printSelectedOrders() {
    try {
        await PrintService.printOrders(getSelectedOrders());
    } catch(e) {
        console.error('[PrintOrders] error:', e);
        showMessage('打印失败: ' + e.message, 'error');
    }
}

async function printSelectedBarcodes() {
    try {
        await PrintService.printBarcodes(getSelectedOrders());
    } catch(e) {
        console.error('[PrintBarcodes] error:', e);
        showMessage('打印失败: ' + e.message, 'error');
    }
}

// ============================================================
// DD 全屏看板 — 桥接 (原生 JS → Vue Store)
// ============================================================
async function openDDSplitModal() {
    if (_isCreatingDD) return;
    _isCreatingDD = true;
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
            showMessage('DD看板初始化失败，请刷新页面重试', 'error');
        }
    } catch(e) {
        console.error('DD创建异常:', e);
        showMessage(t('common.failed', '操作失败') + ': ' + e.message, 'error');
    } finally {
        _isCreatingDD = false;
    }
}

// ============================================================
// 页面加载
// ============================================================
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initOMS);
    } else {
        initOMS();
    }
}

// ============================================================
// 纯函数 — 可测试的业务逻辑 (从 Vue IIFE 中提取)
// ============================================================

/**
 * 四位小数精度工具
 */
function round4(x) { return Math.round(x * 10000) / 10000; }

/**
 * 检查 itemMap 中是否有 CBM 数据
 * @param {Object} itemMapObj - 物料映射 { lineKey: { cbm, ... } }
 * @returns {boolean}
 */
function checkHasCbmData(itemMapObj) {
    var codes = Object.keys(itemMapObj || {});
    for (var i = 0; i < codes.length; i++) {
        if ((itemMapObj[codes[i]].cbm || 0) > 0) return true;
    }
    return false;
}

/**
 * 检查 itemMap 中是否有重量数据
 * @param {Object} itemMapObj - 物料映射 { lineKey: { grossWeight, ... } }
 * @returns {boolean}
 */
function checkHasWeightData(itemMapObj) {
    var codes = Object.keys(itemMapObj || {});
    for (var i = 0; i < codes.length; i++) {
        if ((itemMapObj[codes[i]].grossWeight || 0) > 0) return true;
    }
    return false;
}

/**
 * 构建汇总项列表 (从 Vue computed summaryItems 提取)
 * @param {Object} itemMapObj - 物料映射
 * @param {Function} getRemainingFn - 获取剩余数量函数 (lineKey) => number
 * @returns {Array} 汇总项数组
 */
function buildSummaryItems(itemMapObj, getRemainingFn) {
    var result = [];
    var codes = Object.keys(itemMapObj || {});
    for (var i = 0; i < codes.length; i++) {
        var item = itemMapObj[codes[i]];
        var rem = getRemainingFn(item.lineKey);
        var statusClass, statusIcon;
        if (Math.abs(rem) < 0.0001) {
            statusClass = 'dd-status-ok'; statusIcon = '\u2713';
        } else if (rem < 0) {
            statusClass = 'dd-status-err'; statusIcon = '\u2717';
        } else {
            statusClass = 'dd-status-warn'; statusIcon = '\u26A0';
        }
        result.push({
            lineKey: item.lineKey, itemCode: item.itemCode,
            sapDocNum: item.sapDocNum, lineNum: item.lineNum,
            totalQty: item.totalQty,
            statusClass: statusClass, statusIcon: statusIcon
        });
    }
    return result;
}

/**
 * 构建源单标签文本 (从 Vue computed sourceLabel 提取)
 * @param {Array} sourceOrders - 源订单数组
 * @param {number} itemCount - 物料项数
 * @param {Function} [tFn] - 翻译函数
 * @returns {string}
 */
function buildSourceLabel(sourceOrders, itemCount, tFn) {
    var _t = tFn || function(k, d) { return d || k; };
    if (!sourceOrders || sourceOrders.length === 0) return '';
    var labels = sourceOrders.map(function(o) {
        return (o.doc_type || 'SO') + '#' + (o.sap_doc_num || o.doc_number || '');
    });
    return labels.join(' + ') + ' | ' + itemCount + _t('oms.items_unit', '项');
}

/**
 * 创建看板纯逻辑状态 (无 Vue 依赖)
 * @param {Object} [extItemMap] - 外部 itemMap (Vue.reactive 或普通对象)
 * @param {Array} [extContainers] - 外部 containers (Vue.reactive 或普通数组)
 * @param {Function} [getSearchTermFn] - searchTerm 获取函数 (Vue ref 或闭包)
 * @returns {Object} 看板方法集合
 */
function createKanbanState(extItemMap, extContainers, getSearchTermFn) {
    var itemMap = extItemMap || {};
    var containers = extContainers || [];
    var _nextId = 1;
    var _searchTerm = '';
    var _getSearchTerm = getSearchTermFn || function() { return _searchTerm; };

    function getRemaining(lineKey) {
        var item = itemMap[lineKey];
        if (!item) return 0;
        var sum = 0;
        var keys = Object.keys(item.allocated);
        for (var i = 0; i < keys.length; i++) { sum += (item.allocated[keys[i]] || 0); }
        return round4(item.totalQty - sum);
    }

    function getMaxAllowed(lineKey, cid) {
        var item = itemMap[lineKey];
        if (!item) return 0;
        var otherSum = 0;
        var keys = Object.keys(item.allocated);
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (String(k) !== String(cid)) { otherSum += (item.allocated[k] || 0); }
        }
        return round4(item.totalQty - otherSum);
    }

    function matchesSearch(item) {
        var term = _getSearchTerm().toLowerCase();
        if (!term) return true;
        return item.itemCode.toLowerCase().indexOf(term) >= 0 ||
               item.itemName.toLowerCase().indexOf(term) >= 0;
    }

    function getPoolItems() {
        var term = _getSearchTerm().toLowerCase();
        var result = [];
        var codes = Object.keys(itemMap);
        for (var i = 0; i < codes.length; i++) {
            var item = itemMap[codes[i]];
            if (term) {
                if (matchesSearch(item)) result.push(item);
            } else {
                if (getRemaining(item.lineKey) > 0.0001) result.push(item);
            }
        }
        return result;
    }

    function getContainerItems(cid) {
        var term = _getSearchTerm().toLowerCase();
        var result = [];
        var codes = Object.keys(itemMap);
        for (var i = 0; i < codes.length; i++) {
            var item = itemMap[codes[i]];
            if (term) {
                if (matchesSearch(item)) result.push(item);
            } else {
                if ((item.allocated[cid] || 0) > 0.0001) result.push(item);
            }
        }
        return result;
    }

    function getContainerItemCount(cid) {
        var count = 0;
        var codes = Object.keys(itemMap);
        for (var i = 0; i < codes.length; i++) {
            if ((itemMap[codes[i]].allocated[cid] || 0) > 0.0001) count++;
        }
        return count;
    }

    function getContainerTotalQty(cid) {
        var total = 0;
        var codes = Object.keys(itemMap);
        for (var i = 0; i < codes.length; i++) { total += (itemMap[codes[i]].allocated[cid] || 0); }
        return round4(total);
    }

    function getContainerCbm(cid) {
        var total = 0;
        var codes = Object.keys(itemMap);
        for (var i = 0; i < codes.length; i++) {
            var item = itemMap[codes[i]];
            var qty = item.allocated[cid] || 0;
            if (qty > 0 && item.totalQty > 0) {
                total += round4(qty / item.totalQty * (item.cbm || 0));
            }
        }
        return round4(total);
    }

    function getContainerWeight(cid) {
        var total = 0;
        var codes = Object.keys(itemMap);
        for (var i = 0; i < codes.length; i++) {
            var item = itemMap[codes[i]];
            var qty = item.allocated[cid] || 0;
            if (qty > 0 && item.totalQty > 0) {
                total += round4(qty / item.totalQty * (item.grossWeight || 0));
            }
        }
        return round4(total);
    }

    function initFromOrder(order) {
        Object.keys(itemMap).forEach(function(k) { delete itemMap[k]; });
        containers.splice(0, containers.length);
        _nextId = 1;
        _searchTerm = '';
        var lines = order.lines || [];
        for (var j = 0; j < lines.length; j++) {
            var ln = lines[j];
            var lineKey = order.id + '_' + ln.line_num;
            itemMap[lineKey] = {
                lineKey: lineKey,
                orderId: order.id,
                lineNum: ln.line_num,
                sapDocNum: order.sap_doc_num || '',
                itemCode: ln.item_code,
                itemName: ln.item_name || '',
                totalQty: parseFloat(ln.planned_qty) || 0,
                cbm: parseFloat(ln.cbm) || 0,
                grossWeight: parseFloat(ln.gross_weight) || 0,
                sources: [{ orderId: order.id, lineNum: ln.line_num, qty: parseFloat(ln.planned_qty) || 0 }],
                allocated: {}
            };
        }
    }

    function updateQty(cid, lineKey, newVal) {
        var item = itemMap[lineKey];
        if (!item) return;
        var val = parseFloat(newVal);
        if (isNaN(val)) return;
        if (val < 0) val = 0;
        var otherSum = 0;
        var keys = Object.keys(item.allocated);
        for (var i = 0; i < keys.length; i++) {
            if (String(keys[i]) !== String(cid)) otherSum += (item.allocated[keys[i]] || 0);
        }
        var maxAllowed = round4(item.totalQty - otherSum);
        var clamped = Math.min(round4(val), maxAllowed);
        clamped = Math.max(0, clamped);
        if (clamped > 0.0001) {
            item.allocated[cid] = clamped;
        } else {
            delete item.allocated[cid];
        }
    }

    function splitEvenly() {
        var n = containers.length;
        if (n < 2) return;
        var codes = Object.keys(itemMap);
        for (var i = 0; i < codes.length; i++) {
            var item = itemMap[codes[i]];
            var rem = getRemaining(item.lineKey);
            if (rem < 0.0001) continue;
            var perDD = round4(rem / n);
            var assigned = 0;
            for (var j = 0; j < n; j++) {
                var cid = containers[j].id;
                var existing = item.allocated[cid] || 0;
                if (j < n - 1) {
                    item.allocated[cid] = round4(existing + perDD);
                    assigned += perDD;
                } else {
                    item.allocated[cid] = round4(existing + (rem - assigned));
                }
            }
        }
    }

    function fillRemaining(cid) {
        var codes = Object.keys(itemMap);
        for (var i = 0; i < codes.length; i++) {
            var item = itemMap[codes[i]];
            var rem = getRemaining(item.lineKey);
            if (rem > 0.0001) {
                var existing = item.allocated[cid] || 0;
                item.allocated[cid] = round4(existing + rem);
            }
        }
    }

    function addContainer() {
        containers.push({ id: _nextId++, containerNo: '' });
    }

    function removeContainer(cid) {
        var codes = Object.keys(itemMap);
        for (var i = 0; i < codes.length; i++) {
            delete itemMap[codes[i]].allocated[cid];
        }
        var idx = containers.findIndex(function(c) { return c.id === cid; });
        if (idx >= 0) containers.splice(idx, 1);
    }

    function onDropToPool(fromCid, lineKey) {
        if (fromCid === 'pool') return;
        var item = itemMap[lineKey];
        if (item) { delete item.allocated[fromCid]; }
    }

    function onDropToContainer(targetCid, fromCid, lineKey) {
        var item = itemMap[lineKey];
        if (!item) return;
        if (fromCid === 'pool') {
            var rem = getRemaining(item.lineKey);
            if (rem > 0.0001) {
                var existing = item.allocated[targetCid] || 0;
                item.allocated[targetCid] = round4(existing + rem);
            }
        } else if (String(fromCid) !== String(targetCid)) {
            var srcQty = item.allocated[fromCid] || 0;
            if (srcQty > 0.0001) {
                var existTarget = item.allocated[targetCid] || 0;
                item.allocated[targetCid] = round4(existTarget + srcQty);
                delete item.allocated[fromCid];
            }
        }
    }

    function isAllAllocated() {
        var codes = Object.keys(itemMap);
        if (codes.length === 0) return false;
        for (var i = 0; i < codes.length; i++) {
            if (Math.abs(getRemaining(codes[i])) >= 0.0001) return false;
        }
        return true;
    }

    function validateSubmit() {
        if (containers.length === 0) return '请至少创建一个DD';
        var hasAnyAlloc = false;
        for (var ci = 0; ci < containers.length; ci++) {
            if (getContainerItemCount(containers[ci].id) > 0) { hasAnyAlloc = true; break; }
        }
        if (!hasAnyAlloc) return '没有任何已分配物料';
        var nos = [];
        for (var ci2 = 0; ci2 < containers.length; ci2++) {
            var no = containers[ci2].containerNo.trim();
            if (!no) return '请填写所有DD的柜号';
            nos.push(no.toUpperCase());
        }
        if (new Set(nos).size !== nos.length) return '柜号不能重复';
        return null;
    }

    function buildPayload(sourceOrder) {
        var payload = { source_order_id: sourceOrder.id, dd_groups: [] };
        for (var pi = 0; pi < containers.length; pi++) {
            var c = containers[pi];
            var ddLines = [];
            var allKeys = Object.keys(itemMap);
            for (var ki = 0; ki < allKeys.length; ki++) {
                var entry = itemMap[allKeys[ki]];
                if (entry.orderId !== sourceOrder.id) continue;
                var allocQty = entry.allocated[c.id] || 0;
                if (allocQty > 0.0001) {
                    ddLines.push({
                        item_code: entry.itemCode,
                        item_name: entry.itemName,
                        line_num: entry.lineNum,
                        qty: round4(allocQty)
                    });
                }
            }
            if (ddLines.length > 0) {
                payload.dd_groups.push({ container_no: c.containerNo.trim(), lines: ddLines });
            }
        }
        return payload;
    }

    return {
        itemMap: itemMap,
        containers: containers,
        getRemaining: getRemaining,
        getMaxAllowed: getMaxAllowed,
        getPoolItems: getPoolItems,
        getContainerItems: getContainerItems,
        getContainerItemCount: getContainerItemCount,
        getContainerTotalQty: getContainerTotalQty,
        getContainerCbm: getContainerCbm,
        getContainerWeight: getContainerWeight,
        initFromOrder: initFromOrder,
        updateQty: updateQty,
        splitEvenly: splitEvenly,
        fillRemaining: fillRemaining,
        addContainer: addContainer,
        removeContainer: removeContainer,
        onDropToPool: onDropToPool,
        onDropToContainer: onDropToContainer,
        isAllAllocated: isAllAllocated,
        validateSubmit: validateSubmit,
        buildPayload: buildPayload,
        setSearchTerm: function(v) { _searchTerm = v; },
        _resetState: function() { _nextId = 1; _searchTerm = ''; }
    };
}

/**
 * DD 拆单前置校验
 */
function validateDDSplit(sourceOrder, ddGroups) {
    var errors = [];
    if (!sourceOrder) {
        errors.push('源订单不存在');
        return errors;
    }
    if (sourceOrder.doc_type !== 'SO') {
        errors.push('DD 拆单仅支持 SO 类型');
    }
    if (sourceOrder.execution_state === 'executing' || sourceOrder.execution_state === 'done') {
        errors.push('该订单已在 WMS 执行中');
    }
    if (!Array.isArray(ddGroups) || ddGroups.length === 0) {
        errors.push('缺少 DD 组');
        return errors;
    }
    var sourceLines = sourceOrder.lines || [];
    var hasAllocation = false;
    for (var li = 0; li < sourceLines.length; li++) {
        var totalAllocated = 0;
        ddGroups.forEach(function(g) {
            if (g.lines && g.lines[li]) {
                totalAllocated += (parseFloat(g.lines[li].allocated_qty) || 0);
            }
        });
        if (totalAllocated > 0) hasAllocation = true;
        if (Math.abs(totalAllocated - (sourceLines[li].planned_qty || 0)) > 0.001) {
            errors.push('分配数量不匹配: ' + sourceLines[li].item_code);
        }
    }
    if (!hasAllocation) {
        errors.push('请至少分配一个物料');
    }
    return errors;
}

/**
 * 批量单号输入解析 (去重 + 上限 50)
 */
function parseDocNumInput(input) {
    if (!input || !input.trim()) return { nums: [], error: null };
    var docNum = input.trim();
    var numsArr = docNum.split(/\s+/).filter(Boolean);
    var uniqueNums = [];
    var seen = {};
    numsArr.forEach(function(n) { if (!seen[n]) { seen[n] = true; uniqueNums.push(n); } });
    if (uniqueNums.length > 50) {
        return { nums: [], error: '最多批量查询 50 个单号' };
    }
    return { nums: uniqueNums, error: null };
}

/**
 * 从多个 SO 订单构建 itemMap 数据结构 (纯函数，无 Vue 依赖)
 * @param {Array} orders - 源订单数组
 * @returns {Object} itemMap — { lineKey: { lineKey, orderId, lineNum, sapDocNum, itemCode, itemName, warehouseCode, totalQty, cbm, grossWeight, sources, allocated } }
 */
function buildInitItemMap(orders) {
    var itemMap = {};
    for (var oi = 0; oi < orders.length; oi++) {
        var order = orders[oi];
        var lines = order.lines || [];
        for (var j = 0; j < lines.length; j++) {
            var ln = lines[j];
            var lineKey = order.id + '_' + ln.line_num;
            itemMap[lineKey] = {
                lineKey: lineKey,
                orderId: order.id,
                lineNum: ln.line_num,
                sapDocNum: order.sap_doc_num || '',
                itemCode: ln.item_code,
                itemName: ln.item_name || '',
                warehouseCode: ln.warehouse_code || order.warehouse_code || '',
                totalQty: parseFloat(ln.planned_qty) || 0,
                cbm: parseFloat(ln.cbm) || 0,
                grossWeight: parseFloat(ln.gross_weight) || 0,
                sources: [{ orderId: order.id, lineNum: ln.line_num, qty: parseFloat(ln.planned_qty) || 0 }],
                allocated: {}
            };
        }
    }
    return itemMap;
}

/**
 * 多 SO 提交校验 (纯函数，5 项校验)
 * @param {Object} itemMap - 物料映射
 * @param {Array} containers - 容器数组
 * @param {Function} getContainerItemCountFn - 获取容器物料数函数
 * @param {number} [sourceOrderCount] - 源订单数
 * @returns {Object} { valid: boolean, error: string|null, validCount: number }
 */
function validateMultiSOSubmit(itemMap, containers, getContainerItemCountFn, sourceOrderCount) {
    // ① 柜数 > 0
    if (containers.length === 0) {
        return { valid: false, error: 'no_container', validCount: 0 };
    }

    // ② 有分配物料的柜 > 0
    var hasAnyAlloc = false;
    for (var ci = 0; ci < containers.length; ci++) {
        if (getContainerItemCountFn(containers[ci].id) > 0) { hasAnyAlloc = true; break; }
    }
    if (!hasAnyAlloc) {
        return { valid: false, error: 'no_alloc', validCount: 0 };
    }

    // ③ containerNo 不重复 (非必填，仅校验非空柜号)
    var nos = [];
    for (var ci2 = 0; ci2 < containers.length; ci2++) {
        var no = containers[ci2].containerNo.trim();
        if (no) nos.push(no.toUpperCase());
    }
    if (nos.length > 0 && new Set(nos).size !== nos.length) {
        return { valid: false, error: 'container_dup', validCount: 0 };
    }

    // ④ 所有物料必须全部分配完
    var unallocated = [];
    var allKeys = Object.keys(itemMap);
    for (var ui = 0; ui < allKeys.length; ui++) {
        var chkItem = itemMap[allKeys[ui]];
        var totalAlloc = 0;
        var akeys = Object.keys(chkItem.allocated);
        for (var ai = 0; ai < akeys.length; ai++) {
            totalAlloc += (chkItem.allocated[akeys[ai]] || 0);
        }
        if (Math.abs(round4(totalAlloc) - round4(chkItem.totalQty)) >= 0.0001) {
            unallocated.push((chkItem.sapDocNum ? chkItem.sapDocNum + ' ' : '') + 'L' + chkItem.lineNum + ': ' + chkItem.itemCode);
        }
    }
    if (unallocated.length > 0) {
        return { valid: false, error: 'unallocated', unallocated: unallocated, validCount: 0 };
    }

    // ⑤ 拦截无意义拆单
    var validCount = 0;
    for (var vc = 0; vc < containers.length; vc++) {
        if (getContainerItemCountFn(containers[vc].id) > 0) validCount++;
    }
    var soCount = sourceOrderCount || 1;
    if (validCount === 1 && soCount <= 1) {
        return { valid: false, error: 'single_no_change', validCount: validCount };
    }

    return { valid: true, error: null, validCount: validCount, soCount: soCount };
}

/**
 * 构建多 SO 提交 payload (纯函数)
 * @param {Object} itemMap - 物料映射
 * @param {Array} containers - 容器数组
 * @param {Array} sourceOrders - 源订单数组
 * @returns {Object} { source_order_ids: [], dd_groups: [] }
 */
function buildMultiSOPayload(itemMap, containers, sourceOrders) {
    var ddGroups = [];
    var allSourceIds = new Set();

    for (var pi = 0; pi < containers.length; pi++) {
        var c = containers[pi];
        var cno = c.containerNo.trim() || ('DD-' + (pi + 1));
        var ddLines = [];
        var keys = Object.keys(itemMap);
        for (var ci3 = 0; ci3 < keys.length; ci3++) {
            var item = itemMap[keys[ci3]];
            var allocQty = item.allocated[c.id] || 0;
            if (allocQty < 0.0001) continue;

            allSourceIds.add(item.orderId);
            var srcOrder = sourceOrders.find(function(o) { return o.id === item.orderId; });
            ddLines.push({
                item_code: item.itemCode,
                item_name: item.itemName,
                line_num: item.lineNum,
                qty: round4(allocQty),
                warehouse_code: item.warehouseCode || '',
                source_order_id: item.orderId,
                source_doc_num: srcOrder ? (srcOrder.sap_doc_num || srcOrder.doc_number || '') : ''
            });
        }
        if (ddLines.length > 0) {
            ddGroups.push({ container_no: cno, lines: ddLines });
        }
    }

    return {
        source_order_ids: Array.from(allSourceIds),
        dd_groups: ddGroups
    };
}

/**
 * 格式化数字 (从 Vue 方法提取)
 */
function fmtNum(val) {
    if (val == null || isNaN(val)) return '0';
    return typeof formatNumber === 'function' ? formatNumber(val) : String(val);
}

// ============================================================
// DD 全屏看板 — Vue 3 Composition API
// ============================================================
(function() {
    var Vue = typeof window !== 'undefined' && window.Vue;
    if (!Vue) { return; }

    var app = Vue.createApp({
        setup: function() {
            // ---- 响应式状态 ----
            var showBoard = Vue.ref(false);
            var searchTerm = Vue.ref('');
            var isSubmitting = Vue.ref(false);
            var dragOverTarget = Vue.ref(null);
            var _dragSource = Vue.ref(null);

            var itemMap = Vue.reactive({});
            var containers = Vue.reactive([]);
            var _sourceOrders = null;
            var _savedOverflow = '';

            // ---- 委托纯逻辑到 createKanbanState ----
            var kb = createKanbanState(itemMap, containers, function() { return searchTerm.value; });
            var getRemaining = kb.getRemaining;
            var getMaxAllowed = kb.getMaxAllowed;
            var getContainerItems = kb.getContainerItems;
            var getContainerItemCount = kb.getContainerItemCount;
            var getContainerTotalQty = kb.getContainerTotalQty;
            var getContainerCbm = kb.getContainerCbm;
            var getContainerWeight = kb.getContainerWeight;
            var updateQty = kb.updateQty;
            var splitEvenly = kb.splitEvenly;
            var fillRemaining = kb.fillRemaining;
            var addContainer = kb.addContainer;
            var removeContainer = kb.removeContainer;

            // ---- Vue computed ----
            var poolItems = Vue.computed(function() { return kb.getPoolItems(); });

            var hasCbmData = Vue.computed(function() { return checkHasCbmData(itemMap); });

            var hasWeightData = Vue.computed(function() { return checkHasWeightData(itemMap); });

            var summaryItems = Vue.computed(function() { return buildSummaryItems(itemMap, getRemaining); });

            var isAllAllocated = Vue.computed(function() { return kb.isAllAllocated(); });

            var sourceLabel = Vue.computed(function() {
                return buildSourceLabel(_sourceOrders, Object.keys(itemMap).length, typeof t === 'function' ? t : undefined);
            });

            // ---- Actions: initFromOrders (多 SO 合并 + UI) ----
            function initFromOrders(orders) {
                _sourceOrders = orders;
                // 清空
                var oldKeys = Object.keys(itemMap);
                for (var i = 0; i < oldKeys.length; i++) { delete itemMap[oldKeys[i]]; }
                containers.splice(0, containers.length);
                kb._resetState();
                searchTerm.value = '';
                isSubmitting.value = false;

                // 委托纯函数构建 itemMap 数据
                var built = buildInitItemMap(orders);
                var builtKeys = Object.keys(built);
                for (var bi = 0; bi < builtKeys.length; bi++) {
                    itemMap[builtKeys[bi]] = Vue.reactive(built[builtKeys[bi]]);
                }

                // 默认创建 1 个柜
                addContainer();

                // 打开全屏 + body scroll lock
                _savedOverflow = document.body.style.overflow;
                document.body.style.overflow = 'hidden';
                showBoard.value = true;
            }

            function initFromOrder(order) {
                initFromOrders([order]);
            }

            // ---- Drag & Drop ----
            function onDragStart(ev, from, lineKey) {
                _dragSource.value = { from: from, lineKey: lineKey };
                if (ev && ev.dataTransfer) {
                    ev.dataTransfer.effectAllowed = 'move';
                    ev.dataTransfer.setData('text/plain', lineKey);
                }
            }

            function onDragEnd() {
                _dragSource.value = null;
                dragOverTarget.value = null;
            }

            function onPoolLeave(ev) {
                if (ev.currentTarget && !ev.currentTarget.contains(ev.relatedTarget)) {
                    if (dragOverTarget.value === 'pool') dragOverTarget.value = null;
                }
            }

            function onColLeave(ev, cid) {
                if (ev.currentTarget && !ev.currentTarget.contains(ev.relatedTarget)) {
                    if (dragOverTarget.value === cid) dragOverTarget.value = null;
                }
            }

            function onDropToPool() {
                dragOverTarget.value = null;
                if (!_dragSource.value) return;
                var src = _dragSource.value;
                kb.onDropToPool(src.from, src.lineKey);
                _dragSource.value = null;
            }

            function onDropToContainer(targetCid) {
                dragOverTarget.value = null;
                if (!_dragSource.value) return;
                var src = _dragSource.value;
                kb.onDropToContainer(targetCid, src.from, src.lineKey);
                _dragSource.value = null;
            }

            // ---- Actions: submit (行级直接映射, 支持多 SO) ----
            async function submitDD() {
                if (isSubmitting.value) return;

                // 委托纯函数校验
                var soCount = _sourceOrders ? _sourceOrders.length : 1;
                var vResult = validateMultiSOSubmit(itemMap, containers, getContainerItemCount, soCount);

                if (!vResult.valid) {
                    var errMsgs = {
                        no_container: t('oms.dd_no_container', '请至少创建一个DD'),
                        no_alloc: t('oms.dd_no_alloc', '没有任何已分配物料'),
                        container_dup: t('oms.dd_container_dup', '柜号不能重复'),
                        unallocated: t('oms.dd_unallocated', '以下物料未完全分配: ') + (vResult.unallocated || []).join(', '),
                        single_no_change: t('oms.dd_single_no_change', '只有一个柜子且数量未删减，无需拆单，请直接使用SO作业')
                    };
                    if (vResult.error === 'single_no_change') {
                        alert(errMsgs[vResult.error]);
                    } else {
                        showMessage(errMsgs[vResult.error] || vResult.error, vResult.error === 'unallocated' ? 'warning' : 'warning');
                    }
                    return;
                }

                if (!confirm(t('oms.dd_confirm', '确认拆分为 {0} 个DD?').replace('{0}', vResult.validCount) +
                    (vResult.soCount > 1 ? ' (' + vResult.soCount + ' SO)' : ''))) return;

                isSubmitting.value = true;
                showLoading(true);

                try {
                    // 委托纯函数构建 payload
                    var payload = buildMultiSOPayload(itemMap, containers, _sourceOrders || []);

                    if (payload.dd_groups.length === 0) {
                        showMessage(t('oms.dd_no_items', '没有分配物料到容器'), 'error');
                        return;
                    }

                    // 单次 API 调用, 所有容器一并提交
                    var result = await apiPost('/oms/dd/split', payload);

                    if (result && result.success) {
                        showMessage('DD ' + t('common.success', '成功') + ': ' + (result.dd_count || payload.dd_groups.length) + ' DD', 'success');
                    } else {
                        showMessage(t('common.failed', '失败') + ': ' + (result && result.message || ''), 'error');
                    }
                    closeBoard();
                    queryOrders(_page);
                } catch (e) {
                    showMessage(t('common.failed', '操作失败') + ': ' + e.message, 'error');
                } finally {
                    isSubmitting.value = false;
                    showLoading(false);
                }
            }

            // ---- Actions: close ----
            function closeBoard() {
                showBoard.value = false;
                document.body.style.overflow = _savedOverflow || '';
                _sourceOrders = null;
                searchTerm.value = '';
                dragOverTarget.value = null;
                _dragSource.value = null;
            }

            // ---- 暴露到 window 供原生 JS 桥接 ----
            window._ddVueApp = {
                initFromOrder: initFromOrder,
                initFromOrders: initFromOrders
            };

            // ---- return 给模板 ----
            return {
                showBoard: showBoard,
                searchTerm: searchTerm,
                isSubmitting: isSubmitting,
                dragOverTarget: dragOverTarget,
                itemMap: itemMap,
                containers: containers,
                poolItems: poolItems,
                summaryItems: summaryItems,
                isAllAllocated: isAllAllocated,
                sourceLabel: sourceLabel,
                hasCbmData: hasCbmData,
                hasWeightData: hasWeightData,
                getRemaining: getRemaining,
                getMaxAllowed: getMaxAllowed,
                getContainerItems: getContainerItems,
                getContainerItemCount: getContainerItemCount,
                getContainerTotalQty: getContainerTotalQty,
                getContainerCbm: getContainerCbm,
                getContainerWeight: getContainerWeight,
                initFromOrder: initFromOrder,
                updateQty: updateQty,
                splitEvenly: splitEvenly,
                fillRemaining: fillRemaining,
                addContainer: addContainer,
                removeContainer: removeContainer,
                onDragStart: onDragStart,
                onDragEnd: onDragEnd,
                onPoolLeave: onPoolLeave,
                onColLeave: onColLeave,
                onDropToPool: onDropToPool,
                onDropToContainer: onDropToContainer,
                submitDD: submitDD,
                closeBoard: closeBoard,
                fmtNum: fmtNum,
                t: typeof t === 'function' ? t : function(k, d) { return d || k; }
            };
        }
    });

    if (typeof document !== 'undefined' && document.getElementById('ddApp')) {
        app.mount('#ddApp');
    }
})();

// ==========================================
// Node.js (Jest) 导出适配器
// ==========================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        // 纯函数 (从 Vue IIFE 提取，可直接单测)
        round4: round4,
        checkHasCbmData: checkHasCbmData,
        checkHasWeightData: checkHasWeightData,
        buildSummaryItems: buildSummaryItems,
        buildSourceLabel: buildSourceLabel,
        createKanbanState: createKanbanState,
        validateDDSplit: validateDDSplit,
        parseDocNumInput: parseDocNumInput,
        // v0.1.21: 多 SO 纯函数提取
        buildInitItemMap: buildInitItemMap,
        validateMultiSOSubmit: validateMultiSOSubmit,
        buildMultiSOPayload: buildMultiSOPayload,
        fmtNum: fmtNum,
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
        // 打印
        PrintService: PrintService,
        printSelectedOrders: printSelectedOrders,
        printSelectedBarcodes: printSelectedBarcodes,
        // DD 桥接
        openDDSplitModal: openDDSplitModal,
        // 初始化
        initOMS: initOMS,
        _formatISODate: _formatISODate,
        // 辅助链接
        _buildWmsLink: _buildWmsLink,
        _buildDDRefsLinks: _buildDDRefsLinks,
        // 暴露内部状态供测试断言
        _getInternalState: function() {
            return {
                _orders: _orders,
                _selectedIds: _selectedIds,
                _expandedIds: _expandedIds,
                _page: _page,
                _pageSize: _pageSize,
                _totalPages: _totalPages,
                _totalRecords: _totalRecords,
                _isCreatingDD: _isCreatingDD
            };
        },
        _setInternalState: function(state) {
            if (state._orders !== undefined) _orders = state._orders;
            if (state._page !== undefined) _page = state._page;
            if (state._pageSize !== undefined) _pageSize = state._pageSize;
            if (state._totalPages !== undefined) _totalPages = state._totalPages;
            if (state._totalRecords !== undefined) _totalRecords = state._totalRecords;
            if (state._selectedIds !== undefined) _selectedIds = state._selectedIds;
            if (state._expandedIds !== undefined) _expandedIds = state._expandedIds;
        }
    };
}
