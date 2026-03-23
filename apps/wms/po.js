/**
 * WMS 采购收货页 (po.html) 业务逻辑
 * 从 po.html 内联 <script> 中抽离，纯函数 + DOM 绑定分层
 */

// ============================================================================
// 纯函数 — 数据处理（无 DOM 依赖，可单元测试）
// ============================================================================

/**
 * 获取 PO 行已收数量
 * @param {Object} wms - WMS 历史数据
 * @param {number} lineNum - 行号
 * @returns {number}
 */
function getPoLineReceived(wms, lineNum) {
    if (!wms || !wms.lineReceipts) return 0;
    return wms.lineReceipts[lineNum] || 0;
}

/**
 * 计算 PO 行待收数量 — 高精度浮点安全
 * @param {Object} line - 行项目
 * @param {number} received - 已收数量
 * @returns {number} 待收数量
 */
function calcPoLineOpen(line, received) {
    var base = Number(line.openQty !== undefined ? line.openQty : (line.quantity || 0));
    var recv = Number(received) || 0;
    return Number((base - recv).toFixed(6));
}

/**
 * 判断 PO 行是否完成
 * @param {boolean} headerClosed - 单据头是否已关闭
 * @param {string} lineStatus - 行状态
 * @param {number} open - 待收数量
 * @returns {boolean}
 */
function isPoLineDone(headerClosed, lineStatus, open) {
    return headerClosed || lineStatus === 'C' || open <= 0;
}

/**
 * 构建 PO 收货 payload
 * @param {Object} order - SAP 订单数据
 * @param {Object} line - 行项目
 * @param {number} qty - 收货数量
 * @param {string} user - 操作人
 * @param {string} remark - 备注
 * @param {string} binVal - 库位
 * @param {string} [batchNumber] - 批次号
 * @param {string} [productionDate] - 生产日期
 * @param {string} [defaultBin] - 配置化默认库位 (调用方通过 getDefaultBin 获取)
 * @returns {Object} API payload
 */
function buildPoReceiptPayload(order, line, qty, user, remark, binVal, batchNumber, productionDate, defaultBin) {
    var payload = {
        doc_type: 'PO', doc_number: order.docNum, sap_doc_num: order.docNum,
        sap_doc_entry: order.docEntry,
        item_code: line.itemCode, item_name: line.itemName,
        line_num: line.lineNum,
        quantity: qty, warehouse_code: line.whsCode,
        bin_location: binVal || defaultBin || ((line.whsCode || 'SYSTEM') + '-SYSTEM-BIN-LOCATION'),
        performed_by: user, action: 'receipt', remarks: remark,
        planned_qty: line.quantity, uom: line.uom
    };
    if (batchNumber) payload.batch_number = batchNumber;
    if (productionDate) payload.production_date = productionDate;
    return payload;
}

/**
 * 构建 PO 一键收货待处理行列表
 * @param {Array} lines - SAP 行项目
 * @param {Object} wms - WMS 历史数据
 * @returns {Array} 待收货行 (含 _open 字段)
 */
function buildPoOpenLines(lines, wms) {
    return (lines || []).map(function (l) {
        var received = getPoLineReceived(wms, l.lineNum);
        var open = calcPoLineOpen(l, received);
        return {
            lineNum: l.lineNum, itemCode: l.itemCode, itemName: l.itemName || '',
            quantity: l.quantity, whsCode: l.whsCode || '', uom: l.uom || '',
            lineStatus: l.lineStatus || 'O', _open: Math.max(open, 0)
        };
    }).filter(function (l) { return l._open > 0 && l.lineStatus !== 'C'; });
}

/**
 * 构建 PO 行项目 HTML — 纯函数，可单测
 * @param {Object} line - SAP 行数据
 * @param {Object} wms - WMS 历史 (lineReceipts)
 * @param {Object} opts - { headerClosed }
 * @param {Object} h - { escapeHtml, formatNumber, generateBarcodeUrl }
 * @returns {{ html: string, lineDone: boolean }}
 */
function buildPoLineRowHtml(line, wms, opts, h) {
    var received = getPoLineReceived(wms, line.lineNum);
    var open = calcPoLineOpen(line, received);
    var lineDone = isPoLineDone(opts.headerClosed, line.lineStatus, open);
    var rowHtml = '<tr class="' + (lineDone ? 'line-done' : '') + '" data-line="' + line.lineNum + '">' +
        '<td class="col-line">' + line.lineNum + '</td>' +
        '<td class="col-item">' + h.escapeHtml(line.itemCode) + '</td>' +
        '<td class="col-name">' + h.escapeHtml(line.itemName || '') + '</td>' +
        '<td class="col-qty">' + h.formatNumber(line.quantity) + '</td>' +
        '<td class="col-qty">' + h.formatNumber(received) + '</td>' +
        '<td class="col-qty">' + h.formatNumber(Math.max(open, 0)) + '</td>' +
        '<td class="col-whs">' + h.escapeHtml(line.whsCode || '') + '</td>' +
        '<td class="col-barcode line-barcode-col"><img src="' + h.generateBarcodeUrl(line.itemCode, 'qrcode') + '"></td>' +
        '<td class="action-col no-print">' + (lineDone ? '<span class="badge badge-completed">' + (typeof t === 'function' ? t('badge.completed', '已完成') : '已完成') + '</span>' : '<button class="btn btn-primary" style="padding:4px 12px;font-size:0.8rem;" onclick="selectLine(' + line.lineNum + ')">' + (typeof t === 'function' ? t('btn.receipt', '收货') : '收货') + '</button>') + '</td>' +
        '</tr>';
    return { html: rowHtml, lineDone: lineDone };
}

/**
 * 构建事务历史 HTML 行 — 通用纯函数，可单测
 * @param {Array} transactions - 事务记录数组
 * @param {Object} h - { escapeHtml, formatNumber, formatDateTime }
 * @returns {string} tbody innerHTML
 */
function buildPoHistoryRowsHtml(transactions, h) {
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

    function initPO() {
        if (!checkAuth()) return;
        document.getElementById('pageBadge').innerHTML = getDocTypeIcon('PO', 36);
        initOperatorSelect('receiptUser');
        initBinAutocomplete('binLocation');
        setupQtyWarning('receiptQty', function () { return currentLineOpen; });
        setupQtyInputGuard('receiptQty', function () { return currentLineOpen; });

        setupBarcodeInput('scanInput', function (barcode) {
            playBeepSound(); showBeepIndicator();
            handleSubpageBarcode(barcode, 'PO', loadOrder, function (code) {
                if (!currentOrder) { showMessage(t('msg.load_order_first', '请先加载订单'), 'warning'); document.getElementById('scanInput').focus(); return; }
                var lines = (currentOrder.sap_order || {}).lines || [];
                filterLineByItemCode(code, lines, selectLine);
                setTimeout(function() {
                    if (document.getElementById('receiptCard').classList.contains('hidden')) {
                        document.getElementById('scanInput').focus();
                    }
                }, 200);
            });
        });

        var docnum = getUrlParam('docnum');
        if (docnum) {
            loadOrder(docnum);
        }
    }

    var loadOrder = async function(docnum) {
        if (_isLoadingDoc) return;
        _isLoadingDoc = true;
        showLoading(true);
        try {
            var data = await apiGet('/po?docnum=' + encodeURIComponent(docnum) + '&user=' + encodeURIComponent(getLoginUsername()));
            if (!data || !data.success) throw new Error(data && data.message ? data.message : '未找到订单');
            currentOrder = data;
            var finalStatus = renderOrder(data);
            if (finalStatus === 'completed' || finalStatus === '已完成') {
                _setReadonlyMode(true);
                notifyDocLoaded(finalStatus);
                return;
            }
            acquireDocumentLock('PO', docnum);
            notifyDocLoaded(finalStatus);
        } catch (e) {
            showMessage(t('msg.load_failed', '加载失败: {0}').replace('{0}', e.message), 'error');
            playErrorSound();
        } finally {
            _isLoadingDoc = false;
            showLoading(false);
        }
    }

    function renderOrder(data) {
        var order = data.sap_order || {};
        var headerClosed = (order.docStatus !== 'O');
        setText('docNum', order.docNum || '-');
        setText('bpName', (order.cardCode || '') + ' ' + (order.cardName || ''));
        setText('dueDate', formatDate(order.docDueDate));

        var wms = data.wms_history || {};
        var wmsStatus = order.wmsStatus || wms.wms_status || 'pending';

        show('orderCard');

        var lines = order.lines || [];
        var tbody = document.getElementById('linesBody');
        var hasOpenLines = false;

        if (lines.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="no-data">无行项目</td></tr>';
        } else {
            var rowOpts = { headerClosed: headerClosed };
            var rowHelpers = { escapeHtml: escapeHtml, formatNumber: formatNumber, generateBarcodeUrl: generateBarcodeUrl };
            tbody.innerHTML = lines.map(function (l) {
                var result = buildPoLineRowHtml(l, wms, rowOpts, rowHelpers);
                if (!result.lineDone) hasOpenLines = true;
                return result.html;
            }).join('');
        }
        show('linesCard');
        if (!hasOpenLines && lines.length > 0 && wmsStatus !== 'completed') {
            wmsStatus = 'completed';
        }
        renderHeaderStatus(order.docStatus, wmsStatus, 'docStatus', 'wmsStatus');
        if (hasOpenLines && !headerClosed) { show('batchCard'); } else { hide('batchCard'); }
        show('historyCard');
        show('actionCard');

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
            banner.innerHTML = '<span style="font-size:1.3rem;color:#16a34a;font-weight:bold;">&#10003; ' + t('banner.all_received', '该订单已全部完成收货') + '</span>';
            var linesCardEl2 = document.getElementById('linesCard');
            if (linesCardEl2 && linesCardEl2.nextSibling) {
                linesCardEl2.parentNode.insertBefore(banner, linesCardEl2.nextSibling);
            }
        }

        renderHistory(wms.transactions || []);
        document.getElementById('printQr').innerHTML = '<img src="' + generateBarcodeUrl('PO' + order.docNum, 'qrcode') + '" style="width:80px;height:80px;">';
        return wmsStatus;
    }

    function selectLine(lineNum) {
        var order = currentOrder.sap_order || {};
        if (order.docStatus !== 'O') { showMessage(t('msg.order_closed', '订单已关闭，无法作业'), 'error'); playErrorSound(); focusScanInput(); return; }
        var line = (order.lines || []).find(function (l) { return l.lineNum === lineNum; });
        if (!line) { focusScanInput(); return; }
        if (line.lineStatus === 'C') { showMessage(t('msg.line_closed', '该行已关闭，无法作业'), 'error'); playErrorSound(); focusScanInput(); return; }
        var wms = currentOrder.wms_history || {};
        var received = getPoLineReceived(wms, lineNum);
        var open = calcPoLineOpen(line, received);
        if (open <= 0) { showMessage(t('msg.line_completed', '该行已完成，无法作业'), 'error'); playErrorSound(); focusScanInput(); return; }

        selectedLineData = line;
        document.getElementById('selectedLine').value = lineNum;
        setText('receiptItemCode', line.itemCode + ' ' + (line.itemName || ''));
        currentLineOpen = Math.max(open, 0);
        var qtyInput = document.getElementById('receiptQty');
        qtyInput.removeAttribute('max');
        qtyInput.placeholder = '最大: ' + formatNumber(currentLineOpen);
        qtyInput.value = currentLineOpen;
        document.getElementById('receiptRemark').value = '';
        var binEl = document.getElementById('binLocation');
        var _defaults = getReceiptDefaults(line.whsCode, 'PO', order.docNum);
        if (binEl && !binEl.value) binEl.placeholder = _defaults.bin;

        var batchSection = document.getElementById('batchSection');
        if (line.manBtchNum === 'Y' || (order.lines && line.manBtchNum === 'Y')) {
            show('batchSection');
            document.getElementById('productionDate').value = _defaults.prodDate;
            document.getElementById('batchNumber').value = _defaults.batch;
        } else {
            hide('batchSection');
        }

        show('receiptCard');
        suppressScanFocus(500);
        setTimeout(function() {
            var card = document.getElementById('receiptCard');
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(function() { qtyInput.focus(); qtyInput.select(); }, 200);
        }, 100);
    }

    function cancelReceipt() {
        hide('receiptCard');
        selectedLineData = null;
    }

    var handleSubmit = async function(event) {
        event.preventDefault();
        if (_isSubmitting) return;
        var qty = parseFloat(document.getElementById('receiptQty').value);
        var user = document.getElementById('receiptUser').value.trim();
        var remark = document.getElementById('receiptRemark').value.trim();

        if (!qty || qty <= 0) { showMessage(t('msg.enter_valid_qty', '请输入有效数量'), 'error'); return; }
        if (!user) { showMessage(t('msg.enter_operator', '请输入操作人'), 'error'); return; }

        var order = currentOrder.sap_order || {};
        var wms = currentOrder.wms_history || {};
        var received = getPoLineReceived(wms, selectedLineData.lineNum);
        var lineOpen = calcPoLineOpen(selectedLineData, received);
        var confirmMsg = t('confirm.receipt', '确认收货 {0} {1}?').replace('{0}', formatNumber(qty)).replace('{1}', escapeHtml(selectedLineData.itemCode));
        if (!validateOverQty(qty, lineOpen, remark, 'receiptRemark', confirmMsg)) return;

        _isSubmitting = true; showLoading(true);
        try {
            var binVal = (document.getElementById('binLocation').value || '').trim();
            var batchEl = document.getElementById('batchNumber');
            var prodDateEl = document.getElementById('productionDate');
            var batchNumber = (batchEl && batchEl.value.trim()) ? batchEl.value.trim() : '';
            var productionDate = (prodDateEl && prodDateEl.value) ? prodDateEl.value : '';

            var payload = buildPoReceiptPayload(order, selectedLineData, qty, user, remark, binVal, batchNumber, productionDate, getDefaultBin(selectedLineData.whsCode, 'PO'));

            var result = await apiPost('/transaction', payload);
            if (!result || !result.success) throw new Error(result && result.message ? result.message : t('result.submit_failed', '提交失败'));
            showMessage(t('result.receipt_ok', '收货成功!'), 'success');
            playSuccessSound();
            saveState('last_user', user);
            hide('receiptCard');
            hide('batchSection');
            setTimeout(function () {
                loadOrder(order.docNum);
                setTimeout(function() {
                    var si = document.getElementById('scanInput');
                    if (si) si.focus();
                }, 400);
            }, 800);
        } catch (e) {
            showMessage(t('result.submit_failed', '提交失败') + ': ' + e.message, 'error');
            playErrorSound();
        } finally {
            _isSubmitting = false; showLoading(false);
        }
    }

    function renderHistory(transactions) {
        var tbody = document.getElementById('historyBody');
        if (!transactions || transactions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data">' + t('common.no_data', '暂无记录') + '</td></tr>';
            return;
        }
        var histHelpers = { escapeHtml: escapeHtml, formatNumber: formatNumber, formatDateTime: formatDateTime };
        tbody.innerHTML = buildPoHistoryRowsHtml(transactions, histHelpers);
    }

    function printBarcode() {
        if (!currentOrder || !currentOrder.sap_order) return;
        var order = currentOrder.sap_order;
        var docNum = order.docNum;
        var lines = order.lines || [];
        var html = '<html><head><title>条码标签 - PO' + escapeHtml(docNum) + '</title>' +
            '<style>body{font-family:Arial;padding:10px;font-size:12px;}' +
            '.doc-header{text-align:center;margin-bottom:10px;border-bottom:2px solid #333;padding-bottom:8px;}' +
            '.items{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-start;}' +
            '.item-card{border:1px solid #ccc;padding:4px;text-align:center;width:calc(16.66% - 6px);min-width:90px;box-sizing:border-box;page-break-inside:avoid;}' +
            '.item-card img{width:76px;height:76px;}' +
            '.item-code{font-size:9px;word-break:break-all;font-weight:bold;margin-top:2px;}' +
            '.item-name{font-size:7px;color:#666;white-space:normal;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;line-height:1.3em;}' +
            '@media print{button{display:none;}@page{margin:5mm;}}</style></head><body>' +
            '<div class="doc-header"><img src="' + generateBarcodeUrl('PO' + docNum, 'qrcode') + '" style="width:80px;height:80px;padding:4px;background:#fff;"><br><strong>PO' + escapeHtml(docNum) + '</strong></div>';
        if (lines.length > 0) {
            html += '<div class="items">';
            lines.forEach(function (l) {
                html += '<div class="item-card"><img src="' + generateBarcodeUrl(l.itemCode, 'qrcode') + '"><div class="item-code">' + escapeHtml(l.itemCode) + '</div><div class="item-name">' + escapeHtml(l.itemName || '') + '</div></div>';
            });
            html += '</div>';
        }
        html += '<br><button onclick="window.print()">打印</button></body></html>';
        var win = window.open('', '_blank', 'width=700,height=500');
        win.document.write(html);
    }

    var oneClickReceiveAll = async function() {
        if (!currentOrder) return;
        var order = currentOrder.sap_order || {};
        if (order.docStatus !== 'O') { showMessage(t('msg.order_closed_no_receipt', '订单已关闭，无法收货'), 'error'); return; }
        var wms = currentOrder.wms_history || {};
        var user = document.getElementById('receiptUser').value.trim() || getLoginUsername();

        var openLines = buildPoOpenLines(order.lines, wms);

        var oneClickBin = (document.getElementById('binLocation').value || '').trim();
        var done = await batchSubmitAll(openLines, function (l) {
            var _defaults = getReceiptDefaults(l.whsCode, 'PO', order.docNum);
            return {
                doc_type: 'PO', doc_number: order.docNum, sap_doc_num: order.docNum,
                sap_doc_entry: order.docEntry,
                item_code: l.itemCode, item_name: l.itemName,
                line_num: l.lineNum, quantity: l._open,
                warehouse_code: l.whsCode,
                bin_location: oneClickBin || _defaults.bin,
                performed_by: user,
                action: 'receipt', remarks: t('msg.one_click_remark', '一键收货'),
                planned_qty: l.quantity, uom: l.uom,
                batch_number: _defaults.batch,
                production_date: _defaults.prodDate
            };
        }, t('msg.one_click_remark', '一键收货'));

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
        ['orderCard', 'linesCard', 'receiptCard', 'batchCard', 'historyCard', 'actionCard'].forEach(hide);
        document.getElementById('scanInput').value = '';
        document.getElementById('scanInput').focus();
        if (window.history.replaceState) window.history.replaceState({}, document.title, 'po.html');
    }

    function setText(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }
    function show(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); }
    function hide(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); }

    // var 声明的 async 函数需显式挂到 window，确保 HTML onclick/onsubmit 可访问
    window.loadOrder = loadOrder;
    window.handleSubmit = handleSubmit;
    window.oneClickReceiveAll = oneClickReceiveAll;

    document.getElementById('printTime').textContent = new Date().toLocaleString('zh-CN', { timeZone: CONFIG.timezone });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPO);
    else initPO();
}

// ============================================================================
// 兼容性导出 — Jest 单元测试引用（不影响浏览器环境）
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getPoLineReceived: getPoLineReceived,
        calcPoLineOpen: calcPoLineOpen,
        isPoLineDone: isPoLineDone,
        buildPoReceiptPayload: buildPoReceiptPayload,
        buildPoOpenLines: buildPoOpenLines,
        buildPoLineRowHtml: buildPoLineRowHtml,
        buildPoHistoryRowsHtml: buildPoHistoryRowsHtml
    };
}
