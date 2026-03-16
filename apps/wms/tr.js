/**
 * WMS 调拨申请页 (tr.html) 业务逻辑
 * 从 tr.html 内联 <script> 中抽离，纯函数 + DOM 绑定分层
 */

// ============================================================================
// 纯函数 — 数据处理（无 DOM 依赖，可单元测试）
// ============================================================================

/**
 * 获取 TR 行已调数量
 * @param {Object} wms - WMS 历史数据
 * @param {number} lineNum - 行号
 * @returns {number}
 */
function getTrLineMoved(wms, lineNum) {
    return (wms && wms.lineReceipts) ? (wms.lineReceipts[lineNum] || 0) : 0;
}

/**
 * 计算 TR 行待调数量 — 高精度浮点安全
 * @param {Object} line - 行项目
 * @param {number} moved - 已调数量
 * @returns {number} 待调数量
 */
function calcTrLineOpen(line, moved) {
    var base = Number(line.openQty !== undefined ? line.openQty : (line.quantity || 0));
    var m = Number(moved) || 0;
    return Number((base - m).toFixed(6));
}

/**
 * 判断 TR 行是否完成 — 使用 0.00001 阈值
 * TR 特有: 用阈值替代精确零值比较，防止浮点残留导致行无法关闭
 * @param {number} open - 待调数量
 * @returns {boolean}
 */
function isTrLineDone(open) {
    return open <= 0.00001;
}

/**
 * 判断 TR SAP 单据是否已关闭
 * TR 允许 O(Open) / R(Released) / P(Planned) 状态
 * @param {string} docStatus - SAP 单据状态
 * @returns {boolean}
 */
function isTrSapClosed(docStatus) {
    return docStatus !== 'O' && docStatus !== 'R' && docStatus !== 'P';
}

/**
 * 构建 TR 调拨 payload
 * @param {Object} order - SAP 订单数据
 * @param {Object} line - 行项目
 * @param {number} qty - 调拨数量
 * @param {string} user - 操作人
 * @param {string} remark - 备注
 * @returns {Object} API payload
 */
function buildTrTransferPayload(order, line, qty, user, remark) {
    return {
        doc_type: 'TR', doc_number: order.docNum, sap_doc_num: order.docNum,
        item_code: line.itemCode, item_name: line.itemName,
        line_num: line.lineNum,
        quantity: qty,
        from_warehouse: line.fromWhsCod, warehouse_code: line.whsCode,
        performed_by: user, action: 'move', remarks: remark,
        planned_qty: line.quantity
    };
}

/**
 * 构建 TR 一键调拨待处理行列表
 * @param {Array} lines - SAP 行项目
 * @param {Object} wms - WMS 历史数据
 * @returns {Array} 待调拨行 (含 _open 字段)
 */
function buildTrOpenLines(lines, wms) {
    return (lines || []).map(function (l) {
        var moved = getTrLineMoved(wms, l.lineNum);
        var open = calcTrLineOpen(l, moved);
        return {
            lineNum: l.lineNum, itemCode: l.itemCode, itemName: l.itemName || '',
            quantity: l.quantity, fromWhsCod: l.fromWhsCod || '', whsCode: l.whsCode || '',
            _open: Math.max(open, 0)
        };
    }).filter(function (l) { return l._open > 0; });
}

/**
 * 构建 TR 行项目 HTML — 纯函数，可单测
 * @param {Object} line - SAP 行数据
 * @param {Object} wms - WMS 历史 (lineReceipts)
 * @param {Object} h - { escapeHtml, formatNumber, generateBarcodeUrl }
 * @returns {{ html: string, lineDone: boolean }}
 */
function buildTrLineRowHtml(line, wms, h) {
    var moved = getTrLineMoved(wms, line.lineNum);
    var open = calcTrLineOpen(line, moved);
    var done = isTrLineDone(open);
    var rowHtml = '<tr class="' + (done ? 'line-done' : '') + '" data-line="' + line.lineNum + '"><td class="col-line">' + line.lineNum + '</td><td class="col-item">' + h.escapeHtml(line.itemCode) + '</td><td class="col-name">' + h.escapeHtml(line.itemName || '') + '</td><td class="col-qty">' + h.formatNumber(line.quantity) + '</td><td class="col-qty">' + h.formatNumber(moved) + '</td><td class="col-qty">' + h.formatNumber(Math.max(open, 0)) + '</td><td class="col-whs">' + h.escapeHtml(line.fromWhsCod || '') + '</td><td class="col-whs">' + h.escapeHtml(line.whsCode || '') + '</td><td class="col-barcode line-barcode-col"><img src="' + h.generateBarcodeUrl(line.itemCode, 'qrcode') + '"></td><td class="action-col no-print">' + (open > 0 ? '<button class="btn btn-primary" style="padding:4px 12px;font-size:0.8rem;" onclick="selectLine(' + line.lineNum + ')">调拨</button>' : '<span class="badge badge-completed">已完成</span>') + '</td></tr>';
    return { html: rowHtml, lineDone: done };
}

/**
 * 构建事务历史 HTML 行 — 通用纯函数，可单测
 * @param {Array} transactions - 事务记录数组
 * @param {Object} h - { escapeHtml, formatNumber, formatDateTime }
 * @returns {string} tbody innerHTML
 */
function buildTrHistoryRowsHtml(transactions, h) {
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

    var currentOrder = null, selectedLineData = null;
    var currentLineOpen = 0;

    function initTR() {
        if (!checkAuth()) return;
        document.getElementById('pageBadge').innerHTML = getDocTypeIcon('TR', 36);
        initOperatorSelect('moveUser');
        setupQtyWarning('moveQty', function () { return currentLineOpen; });
        setupQtyInputGuard('moveQty', function () { return currentLineOpen; });
        setupBarcodeInput('scanInput', function (barcode) {
            playBeepSound(); showBeepIndicator();
            handleSubpageBarcode(barcode, 'TR', loadOrder, function (code) {
                if (!currentOrder) { showMessage('请先加载单据', 'warning'); return; }
                var lines = (currentOrder.sap_order || {}).lines || [];
                filterLineByItemCode(code, lines, selectLine);
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
            var data = await apiGet('/tr?docnum=' + encodeURIComponent(docnum) + '&user=' + encodeURIComponent(getLoginUsername()));
            if (!data || !data.success) throw new Error(data && data.message ? data.message : '未找到单据');
            currentOrder = data;
            var finalStatus = renderOrder(data);
            if (finalStatus === 'completed' || finalStatus === '已完成') {
                _setReadonlyMode(true);
                notifyDocLoaded(finalStatus);
                return;
            }
            acquireDocumentLock('TR', docnum);
            notifyDocLoaded(finalStatus);
        } catch (e) { showMessage('加载失败: ' + e.message, 'error'); playErrorSound(); }
        finally { _isLoadingDoc = false; showLoading(false); }
    }

    function renderOrder(data) {
        var order = data.sap_order || {};
        setText('docNum', order.docNum || '-');
        setText('fromWhs', order.filler || '-');
        setText('toWhs', order.toWhsCode || '-');

        var wms = data.wms_history || {};
        var wmsStatus = order.wmsStatus || wms.wms_status || 'pending';

        show('orderCard');

        var lines = order.lines || [];
        var tbody = document.getElementById('linesBody');
        var rowHelpers = { escapeHtml: escapeHtml, formatNumber: formatNumber, generateBarcodeUrl: generateBarcodeUrl };
        tbody.innerHTML = lines.length === 0
            ? '<tr><td colspan="10" class="no-data">无行项目</td></tr>'
            : lines.map(function (l) {
                return buildTrLineRowHtml(l, wms, rowHelpers).html;
            }).join('');
        show('linesCard'); show('historyCard'); show('actionCard');

        var sapClosed = isTrSapClosed(order.docStatus);
        var allDone = lines.length > 0 && lines.every(function (l) {
            var moved = getTrLineMoved(wms, l.lineNum);
            var open = calcTrLineOpen(l, moved);
            return isTrLineDone(open);
        });
        if (allDone && lines.length > 0 && wmsStatus !== 'completed') {
            wmsStatus = 'completed';
        }
        renderHeaderStatus(order.docStatus, wmsStatus, 'docStatus', 'wmsStatus');
        if (sapClosed || allDone) {
            document.getElementById('orderCard').classList.add('status-closed');
            document.getElementById('linesCard').classList.add('status-closed');
            hide('batchCard');
        } else {
            document.getElementById('orderCard').classList.remove('status-closed');
            document.getElementById('linesCard').classList.remove('status-closed');
            show('batchCard');
        }

        renderHistory(wms.transactions || []);
        document.getElementById('printQr').innerHTML = '<img src="' + generateBarcodeUrl('TR' + order.docNum, 'qrcode') + '" style="width:80px;height:80px;">';
        return wmsStatus;
    }

    function selectLine(lineNum) {
        var line = ((currentOrder.sap_order || {}).lines || []).find(function (l) { return l.lineNum === lineNum; });
        if (!line) { focusScanInput(); return; }
        var open = calcTrLineOpen(line, getTrLineMoved(currentOrder.wms_history || {}, lineNum));
        if (isTrLineDone(open)) {
            showMessage('该行已完成，无法作业', 'error');
            playErrorSound();
            focusScanInput();
            return;
        }
        selectedLineData = line;
        document.getElementById('selectedLine').value = lineNum;
        setText('moveItemCode', line.itemCode + ' ' + (line.itemName || ''));
        currentLineOpen = Math.max(open, 0);
        var q = document.getElementById('moveQty');
        q.removeAttribute('max'); q.placeholder = '最大: ' + formatNumber(currentLineOpen); q.value = currentLineOpen;
        document.getElementById('moveRemark').value = '';
        show('moveCard');
        suppressScanFocus(500);
        setTimeout(function () { q.focus(); q.select(); }, 100);
    }

    function cancelMove() { hide('moveCard'); selectedLineData = null; }

    var handleSubmit = async function(event) {
        event.preventDefault();
        if (_isSubmitting) return;
        var qty = parseFloat(document.getElementById('moveQty').value);
        var user = document.getElementById('moveUser').value.trim();
        var remark = document.getElementById('moveRemark').value.trim();
        if (!qty || qty <= 0) { showMessage(t('msg.enter_valid_qty', '请输入有效数量'), 'error'); return; }
        if (!user) { showMessage(t('msg.enter_operator', '请输入操作人'), 'error'); return; }

        var wmsH = currentOrder.wms_history || {};
        var moved = getTrLineMoved(wmsH, selectedLineData.lineNum);
        var lineOpen = calcTrLineOpen(selectedLineData, moved);
        var confirmMsg = t('confirm.transfer', '确认调拨 {0} {1}?').replace('{0}', formatNumber(qty)).replace('{1}', escapeHtml(selectedLineData.itemCode));
        if (!validateOverQty(qty, lineOpen, remark, 'moveRemark', confirmMsg)) return;

        _isSubmitting = true; showLoading(true);
        try {
            var order = currentOrder.sap_order || {};
            var payload = buildTrTransferPayload(order, selectedLineData, qty, user, remark);
            var result = await apiPost('/transaction', payload);
            if (!result || !result.success) throw new Error(result && result.message ? result.message : t('result.submit_failed', '提交失败'));
            showMessage(t('result.transfer_ok', '调拨成功!'), 'success'); playSuccessSound();
            saveState('last_user', user); hide('moveCard');
            setTimeout(function () {
                loadOrder(order.docNum);
                setTimeout(function () {
                    var scanInput = document.getElementById('scanInput');
                    if (scanInput) { scanInput.focus(); }
                }, 300);
            }, 800);
        } catch (e) { showMessage(t('result.submit_failed', '提交失败') + ': ' + e.message, 'error'); playErrorSound(); }
        finally { _isSubmitting = false; showLoading(false); }
    }

    function renderHistory(t) {
        var b = document.getElementById('historyBody');
        if (!t || !t.length) { b.innerHTML = '<tr><td colspan="6" class="no-data">' + window.t('common.no_data', '暂无记录') + '</td></tr>'; return; }
        var histHelpers = { escapeHtml: escapeHtml, formatNumber: formatNumber, formatDateTime: formatDateTime };
        b.innerHTML = buildTrHistoryRowsHtml(t, histHelpers);
    }

    function printBarcode() {
        if (!currentOrder || !currentOrder.sap_order) return;
        var order = currentOrder.sap_order;
        var d = order.docNum;
        var lines = order.lines || [];
        var html = '<html><head><title>条码标签 - TR' + escapeHtml(d) + '</title>' +
            '<style>body{font-family:Arial;padding:10px;font-size:12px;}' +
            '.doc-header{text-align:center;margin-bottom:10px;border-bottom:2px solid #333;padding-bottom:8px;}' +
            '.items{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-start;}' +
            '.item-card{border:1px solid #ccc;padding:4px;text-align:center;width:calc(16.66% - 6px);min-width:90px;box-sizing:border-box;page-break-inside:avoid;}' +
            '.item-card img{width:76px;height:76px;}' +
            '.item-code{font-size:9px;word-break:break-all;font-weight:bold;margin-top:2px;}' +
            '.item-name{font-size:7px;color:#666;white-space:normal;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;line-height:1.3em;}' +
            '@media print{button{display:none;}@page{margin:5mm;}}</style></head><body>' +
            '<div class="doc-header"><img src="' + generateBarcodeUrl('TR' + d, 'qrcode') + '" style="width:80px;height:80px;padding:4px;background:#fff;"><br><strong>TR' + escapeHtml(d) + '</strong></div>';
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

    var oneClickTransferAll = async function() {
        if (!currentOrder) return;
        var order = currentOrder.sap_order || {};
        var wms = currentOrder.wms_history || {};
        var user = document.getElementById('moveUser').value.trim() || getLoginUsername();

        var openLines = buildTrOpenLines(order.lines, wms);

        var done = await batchSubmitAll(openLines, function (l) {
            return {
                doc_type: 'TR', doc_number: order.docNum, sap_doc_num: order.docNum,
                item_code: l.itemCode, item_name: l.itemName,
                line_num: l.lineNum, quantity: l._open,
                from_warehouse: l.fromWhsCod, warehouse_code: l.whsCode,
                performed_by: user, action: 'move', remarks: '一键调拨',
                planned_qty: l.quantity
            };
        }, '一键调拨');

        if (done) {
            saveState('last_user', user);
            setTimeout(function () {
                loadOrder(order.docNum);
                setTimeout(function () {
                    var scanInput = document.getElementById('scanInput');
                    if (scanInput) { scanInput.focus(); }
                }, 300);
            }, 800);
        }
    }

    function resetPage() {
        currentOrder = null; selectedLineData = null; currentLineOpen = 0;
        ['orderCard', 'linesCard', 'moveCard', 'batchCard', 'historyCard', 'actionCard'].forEach(hide);
        document.getElementById('scanInput').value = ''; document.getElementById('scanInput').focus();
        if (window.history.replaceState) window.history.replaceState({}, document.title, 'tr.html');
    }

    function setText(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }
    function show(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); }
    function hide(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); }

    // var 声明的 async 函数需显式挂到 window，确保 HTML onclick/onsubmit 可访问
    window.loadOrder = loadOrder;
    window.handleSubmit = handleSubmit;
    window.oneClickTransferAll = oneClickTransferAll;

    document.getElementById('printTime').textContent = new Date().toLocaleString('zh-CN', { timeZone: CONFIG.timezone });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTR);
    else initTR();
}

// ============================================================================
// 兼容性导出 — Jest 单元测试引用（不影响浏览器环境）
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getTrLineMoved: getTrLineMoved,
        calcTrLineOpen: calcTrLineOpen,
        isTrLineDone: isTrLineDone,
        isTrSapClosed: isTrSapClosed,
        buildTrTransferPayload: buildTrTransferPayload,
        buildTrOpenLines: buildTrOpenLines,
        buildTrLineRowHtml: buildTrLineRowHtml,
        buildTrHistoryRowsHtml: buildTrHistoryRowsHtml
    };
}
