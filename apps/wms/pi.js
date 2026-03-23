/**
 * WMS 生产发货页 (pi.html) 业务逻辑
 * 从 pi.html 内联 <script> 中抽离，纯函数 + DOM 绑定分层
 *
 * 🚨 超高精度警戒: PI 单据真实存在 0.00001 级别的 BOM 用量，
 *    所有数量计算必须使用 Number().toFixed(6) 确保精度不丢失
 */

// DB DECIMAL(18,4) vs SAP 6 位小数的精度容差阈值
var PI_PRECISION_TOLERANCE = 0.00005;

// ============================================================================
// 纯函数 — 数据处理（无 DOM 依赖，可单元测试）
// ============================================================================

/**
 * 获取 PI 行已发数量
 * @param {Object} wms - WMS 历史数据
 * @param {number} lineNum - 行号
 * @returns {number}
 */
function getPiLineIssued(wms, lineNum) {
    if (!wms || !wms.lineReceipts) return 0;
    return wms.lineReceipts[lineNum] || 0;
}

/**
 * 计算 PI 行待发数量 — 三变量减法，超高精度
 * 公式: 基准用量 - SAP已发 - WMS已发
 * @param {number} baseQty - 基准用量 (baseQty || plannedQty)
 * @param {number} sapIssued - SAP 已发数量 (issuedQty)
 * @param {number} wmsIssued - WMS 已发数量
 * @returns {number} 待发数量 (6位小数精度)
 */
function calcPiLineOpen(baseQty, sapIssued, wmsIssued) {
    var b = Number(baseQty) || 0;
    var s = Number(sapIssued) || 0;
    var w = Number(wmsIssued) || 0;
    var result = Number((b - s - w).toFixed(6));
    // DB 精度 DECIMAL(18,4)，SAP baseQty 可达 6 位小数
    // 差值 < 0.00005 时视为已完成，避免精度截断导致永远无法关单
    return Math.abs(result) < PI_PRECISION_TOLERANCE ? 0 : result;
}

/**
 * 判断 PI 单据头是否已关闭
 * PI 使用 status 字段 (非 docStatus)，允许 R(Released) 和 P(Planned)
 * @param {string} status - 订单状态
 * @returns {boolean}
 */
function isPiHeaderClosed(status) {
    return status !== 'R' && status !== 'P';
}

/**
 * 构建 PI 发料 payload
 * @param {Object} order - SAP 订单数据
 * @param {Object} line - 行项目
 * @param {number} qty - 发料数量
 * @param {string} user - 操作人
 * @param {string} remark - 备注
 * @returns {Object} API payload
 */
function buildPiIssuePayload(order, line, qty, user, remark) {
    var baseQty = Number(line.baseQty || line.plannedQty || 0);
    return {
        doc_type: 'PI', doc_number: order.docNum, sap_doc_num: order.docNum,
        sap_doc_entry: order.docEntry,
        item_code: line.itemCode, item_name: line.itemName,
        line_num: line.lineNum,
        quantity: qty, warehouse_code: line.whsCode,
        performed_by: user, action: 'issue', remarks: remark,
        planned_qty: baseQty, uom: line.uom
    };
}

/**
 * 构建 PI 一键发料待处理行列表
 * @param {Array} lines - SAP BOM 行项目
 * @param {Object} wms - WMS 历史数据
 * @returns {Array} 待发料行 (含 _open 字段)
 */
function buildPiOpenLines(lines, wms) {
    return (lines || []).map(function (l) {
        var issued = getPiLineIssued(wms, l.lineNum);
        var baseQty = Number(l.baseQty || l.plannedQty || 0);
        var sapIssued = Number(l.issuedQty || 0);
        var open = calcPiLineOpen(baseQty, sapIssued, issued);
        return {
            lineNum: l.lineNum, itemCode: l.itemCode, itemName: l.itemName || '',
            quantity: baseQty, whsCode: l.whsCode || '', uom: l.uom || '',
            _open: Math.max(open, 0)
        };
    }).filter(function (l) { return l._open > 0; });
}

/**
 * 构建 PI 行项目 HTML — 纯函数，可单测
 * @param {Object} line - SAP BOM 行数据
 * @param {Object} wms - WMS 历史 (lineReceipts)
 * @param {Object} opts - { headerClosed }
 * @param {Object} h - { escapeHtml, formatNumber, generateBarcodeUrl }
 * @returns {{ html: string, lineDone: boolean }}
 */
function buildPiLineRowHtml(line, wms, opts, h) {
    var issued = getPiLineIssued(wms, line.lineNum);
    var baseQty = Number(line.baseQty || line.plannedQty || 0);
    var sapIssued = Number(line.issuedQty || 0);
    var open = calcPiLineOpen(baseQty, sapIssued, issued);
    var lineDone = opts.headerClosed || open <= 0;
    var _badgeCompleted = typeof t === 'function' ? t('badge.completed', '已完成') : '已完成';
    var _btnIssue = typeof t === 'function' ? t('btn.issue', '发料') : '发料';
    var rowHtml = '<tr class="' + (lineDone ? 'line-done' : '') + '" data-line="' + line.lineNum + '"><td class="col-line">' + line.lineNum + '</td><td class="col-item">' + h.escapeHtml(line.itemCode) + '</td><td class="col-name">' + h.escapeHtml(line.itemName || '') + '</td><td class="col-qty">' + h.formatNumber(baseQty) + '</td><td class="col-qty">' + h.formatNumber(Number((sapIssued + issued).toFixed(6))) + '</td><td class="col-qty">' + h.formatNumber(Math.max(open, 0)) + '</td><td class="col-whs">' + h.escapeHtml(line.whsCode || '') + '</td><td class="col-barcode line-barcode-col"><img src="' + h.generateBarcodeUrl(line.itemCode, 'qrcode') + '"></td><td class="action-col no-print">' + (lineDone ? '<span class="badge badge-completed">' + _badgeCompleted + '</span>' : '<button class="btn btn-primary" style="padding:4px 12px;font-size:0.8rem;" onclick="selectLine(' + line.lineNum + ')">' + _btnIssue + '</button>') + '</td></tr>';
    return { html: rowHtml, lineDone: lineDone };
}

/**
 * 构建事务历史 HTML 行 — 通用纯函数，可单测
 * @param {Array} transactions - 事务记录数组
 * @param {Object} h - { escapeHtml, formatNumber, formatDateTime }
 * @returns {string} tbody innerHTML
 */
function buildPiHistoryRowsHtml(transactions, h) {
    if (!transactions || transactions.length === 0) return '';
    return transactions.map(function (tx) {
        return '<tr><td>' + h.formatDateTime(tx.transaction_time) + '</td><td>' + h.escapeHtml(tx.item_code) + '</td><td>' + h.escapeHtml(tx.item_name || '-') + '</td><td>' + h.formatNumber(tx.quantity) + '</td><td>' + h.escapeHtml(tx.performed_by) + '</td><td>' + h.escapeHtml(tx.remarks || '-') + '</td></tr>';
    }).join('');
}

// ============================================================================
// DOM 绑定 — 浏览器环境（依赖 shared.js 全局函数）
// ============================================================================

/* istanbul ignore next */
if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof CONFIG !== 'undefined') {

    var currentOrder = null;
    var selectedLineData = null;
    var currentLineOpen = 0;

    function initPI() {
        if (!checkAuth()) return;
        document.getElementById('pageBadge').innerHTML = getDocTypeIcon('PI', 36);
        initOperatorSelect('issueUser');
        setupQtyWarning('issueQty', function () { return currentLineOpen; });
        setupQtyInputGuard('issueQty', function () { return currentLineOpen; });

        setupBarcodeInput('scanInput', function (barcode) {
            playBeepSound(); showBeepIndicator();
            handleSubpageBarcode(barcode, 'PI', loadOrder, function (code) {
                if (!currentOrder) { showMessage(t('msg.load_order_first', '请先加载订单'), 'warning'); document.getElementById('scanInput').focus(); return; }
                var lines = (currentOrder.sap_order || {}).lines || [];
                filterLineByItemCode(code, lines, selectLine);
                setTimeout(function() {
                    if (document.getElementById('issueCard').classList.contains('hidden')) {
                        document.getElementById('scanInput').focus();
                    }
                }, 200);
            });
        });

        var docnum = getUrlParam('docnum');
        if (docnum) { loadOrder(docnum); }
    }

    var loadOrder = async function(docnum) {
        if (_isLoadingDoc) return;
        _isLoadingDoc = true;
        showLoading(true);
        try {
            var data = await apiGet('/pi?docnum=' + encodeURIComponent(docnum) + '&user=' + encodeURIComponent(getLoginUsername()));
            if (!data || !data.success) throw new Error(data && data.message ? data.message : '未找到订单');
            currentOrder = data;
            var finalStatus = renderOrder(data);
            if (finalStatus === 'completed' || finalStatus === '已完成') {
                _setReadonlyMode(true);
                notifyDocLoaded(finalStatus);
                return;
            }
            acquireDocumentLock('PI', docnum);
            notifyDocLoaded(finalStatus);
        } catch (e) {
            showMessage(t('msg.load_failed', '加载失败: {0}').replace('{0}', e.message), 'error'); playErrorSound();
        } finally { _isLoadingDoc = false; showLoading(false); }
    }

    function renderOrder(data) {
        var order = data.sap_order || {};
        var headerClosed = isPiHeaderClosed(order.status);
        setText('docNum', order.docNum || '-');
        setText('productCode', order.productCode || '-');
        setText('productName', order.productName || '-');
        setText('plannedQty', formatNumber(order.plannedQty));
        setText('completedQty', formatNumber(order.completedQty || 0));

        var wms = data.wms_history || {};
        var wmsStatus = order.wmsStatus || wms.wms_status || 'pending';

        show('orderCard');

        var lines = order.lines || [];
        var tbody = document.getElementById('linesBody');
        var hasOpenLines = false;
        if (lines.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="no-data">无BOM物料行</td></tr>';
        } else {
            var rowOpts = { headerClosed: headerClosed };
            var rowHelpers = { escapeHtml: escapeHtml, formatNumber: formatNumber, generateBarcodeUrl: generateBarcodeUrl };
            tbody.innerHTML = lines.map(function (l) {
                var result = buildPiLineRowHtml(l, wms, rowOpts, rowHelpers);
                if (!result.lineDone) hasOpenLines = true;
                return result.html;
            }).join('');
        }

        show('linesCard');
        if (!hasOpenLines && lines.length > 0 && wmsStatus !== 'completed') {
            wmsStatus = 'completed';
        }
        renderHeaderStatus(order.status, wmsStatus, 'docStatus', 'wmsStatus');
        if (hasOpenLines && !headerClosed) { show('batchCard'); } else { hide('batchCard'); }
        show('historyCard'); show('actionCard');
        var orderCardEl = document.getElementById('orderCard');
        var linesCardEl = document.getElementById('linesCard');
        if (headerClosed || !hasOpenLines) {
            if (orderCardEl) orderCardEl.classList.add('status-closed');
            if (linesCardEl) linesCardEl.classList.add('status-closed');
        } else {
            if (orderCardEl) orderCardEl.classList.remove('status-closed');
            if (linesCardEl) linesCardEl.classList.remove('status-closed');
        }
        var existingBanner = document.getElementById('completedBanner');
        if (existingBanner) existingBanner.remove();
        if (headerClosed || !hasOpenLines) {
            var banner = document.createElement('div');
            banner.id = 'completedBanner';
            banner.className = 'card';
            banner.style.cssText = 'background:#f0fdf4;border:2px solid #16a34a;text-align:center;padding:16px;';
            banner.innerHTML = '<span style="font-size:1.3rem;color:#16a34a;font-weight:bold;">&#10003; ' + t('banner.all_issued', '该订单已全部完成发料') + '</span>';
            var linesCardEl2 = document.getElementById('linesCard');
            if (linesCardEl2 && linesCardEl2.nextSibling) {
                linesCardEl2.parentNode.insertBefore(banner, linesCardEl2.nextSibling);
            }
        }

        renderHistory(wms.transactions || []);
        document.getElementById('printQr').innerHTML = '<img src="' + generateBarcodeUrl('PI' + order.docNum, 'qrcode') + '" style="width:80px;height:80px;">';
        return wmsStatus;
    }

    function selectLine(lineNum) {
        var order = currentOrder.sap_order || {};
        if (isPiHeaderClosed(order.status)) { showMessage(t('msg.order_closed', '订单已关闭，无法作业'), 'error'); playErrorSound(); focusScanInput(); return; }
        var line = (order.lines || []).find(function (l) { return l.lineNum === lineNum; });
        if (!line) { focusScanInput(); return; }
        var wms = currentOrder.wms_history || {};
        var issued = getPiLineIssued(wms, lineNum);
        var baseQty = Number(line.baseQty || line.plannedQty || 0);
        var sapIssued = Number(line.issuedQty || 0);
        var open = calcPiLineOpen(baseQty, sapIssued, issued);
        if (open <= 0) { showMessage(t('msg.line_completed', '该行已完成，无法作业'), 'error'); playErrorSound(); focusScanInput(); return; }

        var rowEl = document.querySelector('tr[data-line="' + lineNum + '"]');
        if (rowEl) rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

        selectedLineData = line;
        document.getElementById('selectedLine').value = lineNum;
        setText('issueItemCode', line.itemCode + ' ' + (line.itemName || ''));
        currentLineOpen = Math.max(open, 0);
        var qtyInput = document.getElementById('issueQty');
        qtyInput.removeAttribute('max'); qtyInput.placeholder = '最大: ' + formatNumber(currentLineOpen); qtyInput.value = currentLineOpen;
        document.getElementById('issueRemark').value = '';
        show('issueCard');
        suppressScanFocus(500);
        setTimeout(function() {
            var card = document.getElementById('issueCard');
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(function() { qtyInput.focus(); qtyInput.select(); }, 200);
        }, 100);
    }

    function cancelIssue() { hide('issueCard'); selectedLineData = null; }

    var handleSubmit = async function(event) {
        event.preventDefault();
        if (_isSubmitting) return;
        var qty = parseFloat(document.getElementById('issueQty').value);
        var user = document.getElementById('issueUser').value.trim();
        var remark = document.getElementById('issueRemark').value.trim();
        if (!qty || qty <= 0) { showMessage(t('msg.enter_valid_qty', '请输入有效数量'), 'error'); return; }
        if (!user) { showMessage(t('msg.enter_operator', '请输入操作人'), 'error'); return; }

        var wmsH = currentOrder.wms_history || {};
        var issued = getPiLineIssued(wmsH, selectedLineData.lineNum);
        var baseQty = Number(selectedLineData.baseQty || selectedLineData.plannedQty || 0);
        var sapIssued = Number(selectedLineData.issuedQty || 0);
        var lineOpen = calcPiLineOpen(baseQty, sapIssued, issued);
        var confirmMsg = t('confirm.issue', '确认发料 {0} {1}?').replace('{0}', formatNumber(qty)).replace('{1}', escapeHtml(selectedLineData.itemCode));
        if (!validateOverQty(qty, lineOpen, remark, 'issueRemark', confirmMsg)) return;

        _isSubmitting = true; showLoading(true);
        try {
            var order = currentOrder.sap_order || {};
            var payload = buildPiIssuePayload(order, selectedLineData, qty, user, remark);
            var result = await apiPost('/transaction', payload);
            if (!result || !result.success) throw new Error(result && result.message ? result.message : t('result.submit_failed', '提交失败'));
            showMessage(t('result.issue_ok', '发料成功!'), 'success'); playSuccessSound();
            saveState('last_user', user); hide('issueCard');
            setTimeout(function () {
                loadOrder(order.docNum);
                setTimeout(function () {
                    var scanInput = document.getElementById('scanInput');
                    if (scanInput) { scanInput.focus(); }
                }, 300);
            }, 800);
        } catch (e) {
            showMessage(t('result.submit_failed', '提交失败') + ': ' + e.message, 'error'); playErrorSound();
        } finally { _isSubmitting = false; showLoading(false); }
    }

    function renderHistory(transactions) {
        var tbody = document.getElementById('historyBody');
        if (!transactions || transactions.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="no-data">' + t('common.no_data', '暂无记录') + '</td></tr>'; return; }
        var histHelpers = { escapeHtml: escapeHtml, formatNumber: formatNumber, formatDateTime: formatDateTime };
        tbody.innerHTML = buildPiHistoryRowsHtml(transactions, histHelpers);
    }

    function printBarcode() {
        if (!currentOrder || !currentOrder.sap_order) return;
        var order = currentOrder.sap_order;
        var d = order.docNum;
        var lines = order.lines || [];
        var html = '<html><head><title>条码标签 - PI' + escapeHtml(d) + '</title>' +
            '<style>body{font-family:Arial;padding:10px;font-size:12px;}' +
            '.doc-header{text-align:center;margin-bottom:10px;border-bottom:2px solid #333;padding-bottom:8px;}' +
            '.items{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-start;}' +
            '.item-card{border:1px solid #ccc;padding:4px;text-align:center;width:calc(16.66% - 6px);min-width:90px;box-sizing:border-box;page-break-inside:avoid;}' +
            '.item-card img{width:76px;height:76px;}' +
            '.item-code{font-size:9px;word-break:break-all;font-weight:bold;margin-top:2px;}' +
            '.item-name{font-size:7px;color:#666;white-space:normal;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;line-height:1.3em;}' +
            '@media print{button{display:none;}@page{margin:5mm;}}</style></head><body>' +
            '<div class="doc-header"><img src="' + generateBarcodeUrl('PI' + d, 'qrcode') + '" style="width:80px;height:80px;padding:4px;background:#fff;"><br><strong>PI' + escapeHtml(d) + '</strong></div>';
        if (lines.length > 0) {
            html += '<div class="items">';
            lines.forEach(function (l) {
                html += '<div class="item-card"><img src="' + generateBarcodeUrl(l.itemCode, 'qrcode') + '"><div class="item-code">' + escapeHtml(l.itemCode) + '</div><div class="item-name">' + escapeHtml(l.itemName || '') + '</div></div>';
            });
            html += '</div>';
        }
        html += '<br><button onclick="window.print()">打印</button></body></html>';
        var w = window.open('', '_blank', 'width=700,height=500');
        w.document.write(html);
    }

    var oneClickIssueAll = async function() {
        if (!currentOrder) return;
        var order = currentOrder.sap_order || {};
        if (isPiHeaderClosed(order.status)) { showMessage(t('msg.order_closed_no_issue', '订单已关闭，无法发料'), 'error'); return; }
        var wms = currentOrder.wms_history || {};
        var user = document.getElementById('issueUser').value.trim() || getLoginUsername();

        var openLines = buildPiOpenLines(order.lines, wms);

        var done = await batchSubmitAll(openLines, function (l) {
            return {
                doc_type: 'PI', doc_number: order.docNum, sap_doc_num: order.docNum,
                sap_doc_entry: order.docEntry,
                item_code: l.itemCode, item_name: l.itemName,
                line_num: l.lineNum, quantity: l._open,
                warehouse_code: l.whsCode, performed_by: user,
                action: 'issue', remarks: t('remark.one_click_issue', '一键发料'),
                planned_qty: l.quantity, uom: l.uom
            };
        }, t('remark.one_click_issue', '一键发料'));

        if (done) {
            saveState('last_user', user);
            setTimeout(function () {
                loadOrder(order.docNum);
                setTimeout(function () {
                    var si = document.getElementById('scanInput');
                    if (si) si.focus();
                }, 300);
            }, 800);
        }
    }

    function resetPage() {
        currentOrder = null; selectedLineData = null; currentLineOpen = 0;
        ['orderCard', 'linesCard', 'issueCard', 'batchCard', 'historyCard', 'actionCard'].forEach(hide);
        document.getElementById('scanInput').value = ''; document.getElementById('scanInput').focus();
        if (window.history.replaceState) window.history.replaceState({}, document.title, 'pi.html');
    }

    function setText(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }
    function show(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); }
    function hide(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); }

    // var 声明的 async 函数需显式挂到 window，确保 HTML onclick/onsubmit 可访问
    window.loadOrder = loadOrder;
    window.handleSubmit = handleSubmit;
    window.oneClickIssueAll = oneClickIssueAll;

    document.getElementById('printTime').textContent = new Date().toLocaleString('zh-CN', { timeZone: CONFIG.timezone });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPI);
    else initPI();
}

// ============================================================================
// 兼容性导出 — Jest 单元测试引用（不影响浏览器环境）
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getPiLineIssued: getPiLineIssued,
        calcPiLineOpen: calcPiLineOpen,
        isPiHeaderClosed: isPiHeaderClosed,
        buildPiIssuePayload: buildPiIssuePayload,
        buildPiOpenLines: buildPiOpenLines,
        buildPiLineRowHtml: buildPiLineRowHtml,
        buildPiHistoryRowsHtml: buildPiHistoryRowsHtml
    };
}
