/**
 * WMS 生产收货页 (wo.html) 业务逻辑
 * 从 wo.html 内联 <script> 中抽离，纯函数 + DOM 绑定分层
 */

// ============================================================================
// 纯函数 — 数据处理（无 DOM 依赖，可单元测试）
// ============================================================================

/**
 * 计算 WO 剩余数量 — 高精度浮点安全
 * 公式: 计划 - SAP已完成 - WMS已收
 * @param {number} plannedQty - 计划数量
 * @param {number} completedQty - SAP 已完成数量
 * @param {number} wmsReceived - WMS 已收数量
 * @returns {number} 剩余数量 (可为负，表示超收)
 */
function calcWoRemaining(plannedQty, completedQty, wmsReceived) {
    var p = Number(plannedQty) || 0;
    var c = Number(completedQty) || 0;
    var w = Number(wmsReceived) || 0;
    return Number((p - c - w).toFixed(6));
}

/**
 * 计算 WO 进度百分比
 * @param {number} completedQty - SAP 已完成数量
 * @param {number} wmsReceived - WMS 已收数量
 * @param {number} plannedQty - 计划数量
 * @returns {number} 0-100 的百分比值
 */
function calcWoProgress(completedQty, wmsReceived, plannedQty) {
    var totalDone = Number((Number(completedQty || 0) + Number(wmsReceived || 0)).toFixed(6));
    var planned = Number(plannedQty) || 0;
    if (planned <= 0) return 0;
    return Math.min((totalDone / planned) * 100, 100);
}

/**
 * 确定 WO WMS 状态 (前端聚合逻辑)
 * 当剩余 <= 0 且计划 > 0 时，状态自动变为 completed
 * @param {string} currentStatus - 当前 WMS 状态
 * @param {number} remaining - 剩余数量 (未夹紧，可为负)
 * @param {number} plannedQty - 计划数量
 * @returns {string} 最终 WMS 状态
 */
function determineWoWmsStatus(currentStatus, remaining, plannedQty) {
    if (remaining <= 0 && (Number(plannedQty) || 0) > 0 && currentStatus !== 'completed') {
        return 'completed';
    }
    return currentStatus;
}

/**
 * 构建 WO 收货 payload
 * @param {Object} order - SAP 订单数据
 * @param {number} qty - 收货数量
 * @param {string} user - 操作人
 * @param {string} remark - 备注
 * @param {string} binVal - 库位
 * @param {string} [batchNumber] - 批次号
 * @param {string} [productionDate] - 生产日期
 * @param {string} [defaultBin] - 配置化默认库位 (调用方通过 getDefaultBin 获取)
 * @returns {Object} API payload
 */
function buildWoReceiptPayload(order, qty, user, remark, binVal, batchNumber, productionDate, defaultBin) {
    var payload = {
        doc_type: 'WO',
        doc_number: order.docNum,
        sap_doc_num: order.docNum,
        sap_doc_entry: order.docEntry,
        item_code: order.itemCode,
        item_name: order.itemName,
        quantity: qty,
        warehouse_code: order.whsCode,
        bin_location: binVal || defaultBin || ((order.whsCode || 'SYSTEM') + '-SYSTEM-BIN-LOCATION'),
        performed_by: user,
        action: 'receipt',
        remarks: remark,
        planned_qty: order.plannedQty,
        uom: order.uom
    };
    if (batchNumber) payload.batch_number = batchNumber;
    if (productionDate) payload.production_date = productionDate;
    return payload;
}

/**
 * 构建 WO 事务历史 HTML 行 — 纯函数，可单测
 * 注意: WO 列顺序为 item_code, item_name, time, qty, user, remarks (与其他模块不同)
 * @param {Array} transactions - 事务记录数组
 * @param {Object} h - { escapeHtml, formatNumber, formatDateTime }
 * @returns {string} tbody innerHTML
 */
function buildWoHistoryRowsHtml(transactions, h) {
    if (!transactions || transactions.length === 0) return '';
    return transactions.map(function (tx) {
        return '<tr>' +
            '<td>' + h.escapeHtml(tx.item_code || '-') + '</td>' +
            '<td>' + h.escapeHtml(tx.item_name || '-') + '</td>' +
            '<td>' + h.formatDateTime(tx.transaction_time) + '</td>' +
            '<td>' + h.formatNumber(tx.quantity) + '</td>' +
            '<td>' + h.escapeHtml(tx.performed_by) + '</td>' +
            '<td>' + h.escapeHtml(tx.remarks || '-') + '</td>' +
            '</tr>';
    }).join('');
}

// ============================================================================
// DOM 绑定 — 浏览器环境（依赖 shared.js 全局函数）
// ============================================================================

/* istanbul ignore next */
if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof CONFIG !== 'undefined') {

    var currentOrder = null;
    var currentDocId = null;
    var currentRemaining = 0;

    function initWO() {
        if (!checkAuth()) return;
        document.getElementById('pageBadge').innerHTML = getDocTypeIcon('WO', 36);
        initOperatorSelect('receiptUser');
        initBinAutocomplete('binLocation');

        setupQtyWarning('receiptQty', function () { return currentRemaining; });
        setupQtyInputGuard('receiptQty', function () { return currentRemaining; });

        setupBarcodeInput('scanInput', function (barcode) {
            playBeepSound(); showBeepIndicator();
            handleSubpageBarcode(barcode, 'WO', loadOrder, function (code) {
                if (!currentOrder) { showMessage(t('msg.load_order_first', '请先加载订单'), 'warning'); return; }
                var order = currentOrder.sap_order || {};
                if (order.itemCode && order.itemCode.toUpperCase() === code.toUpperCase()) {
                    showMessage(t('msg.item_match', '物料匹配: {0}').replace('{0}', escapeHtml(order.itemCode)), 'success');
                    playSuccessSound();
                    suppressScanFocus(500);
                    var qtyInput = document.getElementById('receiptQty');
                    if (qtyInput) { qtyInput.focus(); qtyInput.select(); }
                } else {
                    showMessage(t('msg.item_mismatch', '物料不匹配! 当前订单: {0}, 扫描: {1}').replace('{0}', escapeHtml(order.itemCode || '-')).replace('{1}', escapeHtml(code)), 'error');
                    playErrorSound();
                }
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
            var data = await apiGet('/wo?docnum=' + encodeURIComponent(docnum) + '&user=' + encodeURIComponent(getLoginUsername()));

            if (!data || !data.success) {
                throw new Error(data && data.message ? data.message : '未找到订单');
            }

            currentOrder = data;
            var finalStatus = renderOrder(data);
            if (finalStatus === 'completed' || finalStatus === '已完成') {
                _setReadonlyMode(true);
                notifyDocLoaded(finalStatus);
                return;
            }
            acquireDocumentLock('WO', docnum);
            notifyDocLoaded(finalStatus);

        } catch (e) {
            console.error('加载订单失败:', e);
            showMessage(t('msg.load_failed', '加载失败: {0}').replace('{0}', e.message), 'error');
            playErrorSound();
        } finally {
            _isLoadingDoc = false;
            showLoading(false);
        }
    }

    function renderOrder(data) {
        var order = data.sap_order || {};
        var wms = data.wms_history || {};

        setText('docNum', order.docNum || '-');
        setText('itemCode', order.itemCode || '-');
        setText('itemName', order.itemName || '-');
        setText('warehouse', order.whsCode || '-');
        setText('plannedQty', formatNumber(order.plannedQty));
        setText('completedQty', formatNumber(order.completedQty || 0));
        setText('wmsReceivedQty', formatNumber(wms.totalReceived || 0));
        setText('uom', order.uom || '-');
        setText('dueDate', formatDate(order.dueDate));

        var remaining = calcWoRemaining(order.plannedQty, order.completedQty, wms.totalReceived);
        currentRemaining = Math.max(remaining, 0);

        var wmsStatus = wms.wms_status || 'pending';
        wmsStatus = determineWoWmsStatus(wmsStatus, remaining, order.plannedQty);
        renderHeaderStatus(order.status || order.docStatus, wmsStatus, 'docStatus', 'wmsStatus');
        setText('remainingQty', formatNumber(currentRemaining));

        var pct = calcWoProgress(order.completedQty, wms.totalReceived, order.plannedQty);
        var bar = document.getElementById('progressBar');
        bar.style.width = pct + '%';
        setText('progressText', Math.round(pct) + '%');

        bar.className = 'progress-bar';
        if (pct >= 100) bar.classList.add('complete');
        else if (pct >= 80) bar.classList.add('warning');

        show('orderCard');
        show('historyCard');
        show('actionCard');

        if (remaining > 0) {
            show('receiptCard');
            show('oneClickDiv');
            hide('completeCard');
            var qtyInput = document.getElementById('receiptQty');
            qtyInput.removeAttribute('max');
            qtyInput.placeholder = '最大: ' + formatNumber(currentRemaining);
            qtyInput.value = currentRemaining;
            var binEl = document.getElementById('binLocation');
            var _defaults = getReceiptDefaults(order.whsCode, 'WO', order.docNum);
            if (binEl && !binEl.value) binEl.placeholder = _defaults.bin;
            var batchEl = document.getElementById('batchNumber');
            if (batchEl && !batchEl.value) batchEl.value = _defaults.batch;
            var prodDateEl = document.getElementById('productionDate');
            if (prodDateEl) prodDateEl.value = _defaults.prodDate;
            suppressScanFocus(500);
            setTimeout(function() { qtyInput.focus(); qtyInput.select(); }, 200);
        } else {
            hide('receiptCard');
            hide('oneClickDiv');
            show('completeCard');
            var orderCardEl = document.getElementById('orderCard');
            if (orderCardEl) orderCardEl.classList.add('status-closed');
        }

        var qrDiv = document.getElementById('printQr');
        qrDiv.innerHTML = '<img src="' + generateBarcodeUrl('WO' + order.docNum, 'qrcode') +
            '" alt="QR" style="width:80px;height:80px;">' +
            '<br><img src="' + generateBarcodeUrl(order.itemCode, 'qrcode') + '" style="width:60px;height:60px;">' +
            '<br><small style="font-size:8pt;">' + escapeHtml(order.itemCode) + '</small>';

        currentDocId = data.wms_document_id || null;
        renderHistory(wms.transactions || []);
        return wmsStatus;
    }

    function renderHistory(transactions) {
        var tbody = document.getElementById('historyBody');
        if (!transactions || transactions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data">' + t('msg.no_receipt_history', '暂无收货记录') + '</td></tr>';
            return;
        }
        var histHelpers = { escapeHtml: escapeHtml, formatNumber: formatNumber, formatDateTime: formatDateTime };
        tbody.innerHTML = buildWoHistoryRowsHtml(transactions, histHelpers);
    }

    var handleSubmit = async function(event) {
        event.preventDefault();
        if (_isSubmitting) return;

        var qty = parseFloat(document.getElementById('receiptQty').value);
        var user = document.getElementById('receiptUser').value.trim();
        var remark = document.getElementById('receiptRemark').value.trim();

        if (!qty || qty <= 0) {
            showMessage(t('msg.enter_valid_receipt_qty', '请输入有效的收货数量'), 'error');
            return;
        }
        if (!user) {
            showMessage(t('msg.enter_operator', '请输入操作人'), 'error');
            document.getElementById('receiptUser').focus();
            return;
        }

        var order = currentOrder.sap_order || {};
        var wms = currentOrder.wms_history || {};
        var remaining = calcWoRemaining(order.plannedQty, order.completedQty, wms.totalReceived);

        var confirmMsg = t('confirm.receipt', '确认收货 {0} {1}?').replace('{0}', formatNumber(qty)).replace('{1}', ((order.uom || '') + ' ' + (order.itemCode || '')).trim());
        if (!validateOverQty(qty, remaining, remark, 'receiptRemark', confirmMsg)) {
            return;
        }

        _isSubmitting = true; showLoading(true);
        try {
            var binVal = (document.getElementById('binLocation').value || '').trim();
            var batchEl = document.getElementById('batchNumber');
            var prodDateEl = document.getElementById('productionDate');
            var batchNumber = (batchEl && batchEl.value.trim()) ? batchEl.value.trim() : '';
            var productionDate = (prodDateEl && prodDateEl.value) ? prodDateEl.value : '';

            var payload = buildWoReceiptPayload(order, qty, user, remark, binVal, batchNumber, productionDate, getDefaultBin(order.whsCode, 'WO'));

            var result = await apiPost('/transaction', payload);

            if (!result || !result.success) {
                throw new Error(result && result.message ? result.message : t('result.submit_failed', '提交失败'));
            }

            showMessage(t('result.receipt_ok', '收货成功!'), 'success');
            playSuccessSound();

            saveState('last_user', user);

            document.getElementById('receiptQty').value = '';
            document.getElementById('receiptRemark').value = '';
            if (batchEl) batchEl.value = '';

            setTimeout(function () {
                loadOrder(order.docNum);
                setTimeout(function() {
                    var si = document.getElementById('scanInput');
                    if (si) si.focus();
                }, 400);
            }, 800);

        } catch (e) {
            console.error('提交失败:', e);
            showMessage(t('result.submit_failed', '提交失败') + ': ' + e.message, 'error');
            playErrorSound();
        } finally {
            _isSubmitting = false; showLoading(false);
        }
    }

    function printBarcode() {
        if (!currentOrder || !currentOrder.sap_order) return;
        var docNum = currentOrder.sap_order.docNum;
        var barcodeUrl = generateBarcodeUrl('WO' + docNum, 'barcode');
        var qrUrl = generateBarcodeUrl('WO' + docNum, 'qrcode');

        var win = window.open('', '_blank', 'width=400,height=300');
        win.document.write(
            '<html><head><title>条码标签</title>' +
            '<style>body{font-family:Arial;text-align:center;padding:20px;}' +
            '@media print{@page{size:60mm 40mm;margin:2mm;}}</style></head>' +
            '<body>' +
            '<img src="' + barcodeUrl + '" style="max-width:200px;"><br>' +
            '<strong>WO' + escapeHtml(docNum) + '</strong><br>' +
            '<img src="' + qrUrl + '" style="width:60px;height:60px;margin-top:5px;"><br>' +
            '<button onclick="window.print()" style="margin-top:10px;">打印</button>' +
            '</body></html>'
        );
    }

    var oneClickReceive = async function() {
        if (!currentOrder || _isSubmitting) return;
        var order = currentOrder.sap_order || {};
        var wms = currentOrder.wms_history || {};
        var remaining = calcWoRemaining(order.plannedQty, order.completedQty, wms.totalReceived);
        if (remaining <= 0) { showMessage(t('msg.no_remaining', '没有剩余数量'), 'warning'); return; }
        var user = document.getElementById('receiptUser').value.trim() || getLoginUsername();
        if (!confirm(t('confirm.one_click_receipt', '一键收货: {0} x {1} ({2})?\n操作人: {3}').replace('{0}', order.itemCode).replace('{1}', formatNumber(remaining)).replace('{2}', order.uom || '').replace('{3}', user))) return;

        _isSubmitting = true; showLoading(true);
        try {
            var oneClickBin = (document.getElementById('binLocation').value || '').trim();
            var _defaults = getReceiptDefaults(order.whsCode, 'WO', order.docNum);
            var payload = buildWoReceiptPayload(order, remaining, user, t('msg.one_click_remark', '一键收货'), oneClickBin, _defaults.batch, _defaults.prodDate, _defaults.bin);

            var result = await apiPost('/transaction', payload);
            if (!result || !result.success) throw new Error(result && result.message ? result.message : t('result.submit_failed', '提交失败'));
            showMessage(t('msg.one_click_receipt_ok', '一键收货成功!'), 'success');
            playSuccessSound();
            saveState('last_user', user);
            await releaseDocumentLock();
            setTimeout(function () {
                loadOrder(order.docNum);
                setTimeout(function () {
                    var si = document.getElementById('scanInput');
                    if (si) si.focus();
                }, 300);
            }, 800);
        } catch (e) {
            showMessage(t('msg.one_click_receipt_fail', '一键收货失败: {0}').replace('{0}', e.message), 'error');
            playErrorSound();
        } finally { _isSubmitting = false; showLoading(false); }
    }

    function resetPage() {
        currentOrder = null;
        currentDocId = null;
        currentRemaining = 0;
        hide('orderCard');
        hide('receiptCard');
        hide('completeCard');
        hide('historyCard');
        hide('actionCard');
        hide('oneClickDiv');
        document.getElementById('scanInput').value = '';
        document.getElementById('scanInput').focus();
        if (window.history.replaceState) {
            window.history.replaceState({}, document.title, 'wo.html');
        }
    }

    function setText(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    }
    function show(id) {
        var el = document.getElementById(id);
        if (el) el.classList.remove('hidden');
    }
    function hide(id) {
        var el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    }

    // var 声明的 async 函数需显式挂到 window，确保 HTML onclick/onsubmit 可访问
    window.loadOrder = loadOrder;
    window.handleSubmit = handleSubmit;
    window.oneClickReceive = oneClickReceive;

    document.getElementById('printTime').textContent = new Date().toLocaleString('zh-CN', { timeZone: CONFIG.timezone });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWO);
    } else {
        initWO();
    }
}

// ============================================================================
// 兼容性导出 — Jest 单元测试引用（不影响浏览器环境）
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calcWoRemaining: calcWoRemaining,
        calcWoProgress: calcWoProgress,
        determineWoWmsStatus: determineWoWmsStatus,
        buildWoReceiptPayload: buildWoReceiptPayload,
        buildWoHistoryRowsHtml: buildWoHistoryRowsHtml
    };
}
