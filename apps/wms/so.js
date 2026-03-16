/**
 * WMS 销售拣货页 (so.html) 业务逻辑
 * 从 so.html 内联 <script> 中抽离，纯函数 + DOM 绑定分层
 */

// ============================================================================
// 纯函数 — 数据处理（无 DOM 依赖，可单元测试）
// ============================================================================

/**
 * 获取 SO 行已拣数量
 * @param {Object} wms - WMS 历史数据
 * @param {number} lineNum - 行号
 * @returns {number}
 */
function getSoLinePicked(wms, lineNum) {
    if (!wms || !wms.lineReceipts) return 0;
    return wms.lineReceipts[lineNum] || 0;
}

/**
 * 计算 SO 行待拣数量 — 高精度浮点安全
 * @param {Object} line - 行项目
 * @param {number} picked - 已拣数量
 * @returns {number} 待拣数量
 */
function calcSoLineOpen(line, picked) {
    var base = Number(line.openQty !== undefined ? line.openQty : (line.quantity || 0));
    var p = Number(picked) || 0;
    return Number((base - p).toFixed(6));
}

/**
 * 计算 SO 行总交付量 — 高精度浮点安全
 * @param {number} deliveredQty - SAP 已交付
 * @param {number} picked - WMS 已拣
 * @returns {number}
 */
function calcSoTotalDelivered(deliveredQty, picked) {
    return Number((Number(deliveredQty || 0) + Number(picked || 0)).toFixed(6));
}

/**
 * 检查 SO 行是否已完成 — 用于扫码防呆
 * @param {Object} line - 行项目
 * @param {Object} wms - WMS 历史数据
 * @returns {{ isComplete: boolean, remaining: number }}
 */
function checkSoLineComplete(line, wms) {
    if (!line) return { isComplete: false, remaining: 0 };
    var picked = getSoLinePicked(wms, line.lineNum);
    var open = calcSoLineOpen(line, picked);
    if (open <= 0) return { isComplete: true, remaining: 0 };
    return { isComplete: false, remaining: open };
}

/**
 * 构建 SO 拣货 payload
 * @param {Object} order - SAP 订单数据
 * @param {Object} line - 行项目
 * @param {number} qty - 拣货数量
 * @param {string} user - 操作人
 * @param {string} remark - 备注
 * @returns {Object} API payload
 */
function buildSoPickPayload(order, line, qty, user, remark) {
    var docType = order.docType || 'SO';
    return {
        doc_type: docType, doc_number: order.docNum, sap_doc_num: order.docNum,
        sap_doc_entry: order.docEntry,
        item_code: line.itemCode, item_name: line.itemName,
        line_num: line.lineNum,
        quantity: qty, warehouse_code: line.whsCode,
        performed_by: user, action: 'scan', remarks: remark,
        planned_qty: line.quantity, uom: line.uom
    };
}

/**
 * 构建 SO/DD 行项目 HTML 行 — 纯函数，可单测
 * @param {Object} line - SAP 行项目
 * @param {Object} wms - WMS 历史数据
 * @param {Object} opts - { isDD, headerClosed, wmsStatus, omsPickedMap }
 * @param {Object} h - 辅助函数 { escapeHtml, formatNumber, generateBarcodeUrl }
 * @returns {{ html: string, lineDone: boolean }}
 */
function buildSoLineRowHtml(line, wms, opts, h) {
    var picked = getSoLinePicked(wms, line.lineNum);
    var open = calcSoLineOpen(line, picked);
    var totalDelivered = calcSoTotalDelivered(line.deliveryQty || line.deliveredQty, picked);
    var lineDone = opts.headerClosed || line.lineStatus === 'C' || open <= 0;

    if (opts.isDD) {
        var srcRef = '';
        if (line.sourceDocNumber) {
            var srcLabel = 'SO' + h.escapeHtml(line.sourceDocNumber) + ' L' + (line.sourceLineNum != null ? line.sourceLineNum : '-');
            srcRef = '<a href="so.html?docnum=' + encodeURIComponent(line.sourceDocNumber) + '" style="color:var(--primary-color);text-decoration:none;font-size:0.78rem;" title="查看源单">' + srcLabel + '</a>';
        }
        var srcPlannedQty = line.sourcePlannedQty != null ? h.formatNumber(line.sourcePlannedQty) : '-';
        var rowHtml = '<tr class="' + (lineDone ? 'line-done' : '') + '" data-line="' + line.lineNum + '">' +
            '<td class="col-line">' + line.lineNum + '</td>' +
            '<td>' + (srcRef || '-') + '</td>' +
            '<td class="col-item">' + h.escapeHtml(line.itemCode) + '</td>' +
            '<td class="col-name">' + h.escapeHtml(line.itemName || '') + '</td>' +
            '<td class="col-qty" style="color:#9ca3af;">' + srcPlannedQty + '</td>' +
            '<td class="col-qty">' + h.formatNumber(line.quantity) + '</td>' +
            '<td class="col-qty">' + h.formatNumber(totalDelivered) + '</td>' +
            '<td class="col-qty">' + h.formatNumber(Math.max(open, 0)) + '</td>' +
            '<td class="col-whs">' + h.escapeHtml(line.whsCode || '') + '</td>' +
            '<td class="col-barcode line-barcode-col"><img src="' + h.generateBarcodeUrl(line.itemCode, 'qrcode') + '"></td>' +
            '<td class="action-col no-print">' + (lineDone ? '<span class="badge badge-completed">已完成</span>' : '<button class="btn btn-primary" style="padding:4px 12px;font-size:0.8rem;" onclick="selectLine(' + line.lineNum + ')">拣货</button>') + '</td></tr>';
        return { html: rowHtml, lineDone: lineDone };
    }

    // SO 模式
    var displayDelivered = totalDelivered;
    var displayOpen = Math.max(open, 0);
    if (opts.wmsStatus === 'split' && opts.omsPickedMap) {
        var omsPicked = opts.omsPickedMap[line.lineNum] || 0;
        displayDelivered = omsPicked;
        displayOpen = Math.max(Number(((line.quantity || 0) - omsPicked).toFixed(6)), 0);
    }
    var soRowHtml = '<tr class="' + (lineDone ? 'line-done' : '') + '" data-line="' + line.lineNum + '"><td class="col-line">' + line.lineNum + '</td><td class="col-item">' + h.escapeHtml(line.itemCode) + '</td><td class="col-name">' + h.escapeHtml(line.itemName || '') + '</td><td class="col-qty">' + h.formatNumber(line.quantity) + '</td><td class="col-qty">' + h.formatNumber(displayDelivered) + '</td><td class="col-qty">' + h.formatNumber(displayOpen) + '</td><td class="col-whs">' + h.escapeHtml(line.whsCode || '') + '</td><td class="col-barcode line-barcode-col"><img src="' + h.generateBarcodeUrl(line.itemCode, 'qrcode') + '"></td><td class="action-col no-print">' + (lineDone ? '<span class="badge badge-completed">已完成</span>' : '<button class="btn btn-primary" style="padding:4px 12px;font-size:0.8rem;" onclick="selectLine(' + line.lineNum + ')">拣货</button>') + '</td></tr>';
    return { html: soRowHtml, lineDone: lineDone };
}

/**
 * 构建事务历史 HTML 行 — 通用纯函数，可单测
 * @param {Array} transactions - 事务记录数组
 * @param {Object} h - { escapeHtml, formatNumber, formatDateTime }
 * @returns {string} tbody innerHTML
 */
function buildHistoryRowsHtml(transactions, h) {
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

    // 检测当前是 DD 还是 SO 模式
    var _soPageDocType = 'SO';
    var _soPagePrefix = 'SO';

    function initSO() {
        if (!checkAuth()) return;

        // DD 模式检测: URL 参数或加载后判断
        var docnum = getUrlParam('docnum');
        if (docnum && /^DD/i.test(docnum)) {
            _soPageDocType = 'DD';
            _soPagePrefix = 'DD';
        }

        document.getElementById('pageBadge').innerHTML = getDocTypeIcon(_soPageDocType, 36);

        // DD 模式切换页面标题
        if (_soPageDocType === 'DD') {
            var h1 = document.querySelector('h1[data-i18n="so.title"]');
            if (h1) { h1.setAttribute('data-i18n', 'so.dd_title'); h1.textContent = t('so.dd_title', '配送单拣货 (DD)'); }
            var sub = document.querySelector('p[data-i18n="so.subtitle"]');
            if (sub) { sub.setAttribute('data-i18n', 'so.dd_subtitle'); sub.textContent = t('so.dd_subtitle', '扫描或输入配送单号，执行拣货操作'); }
        }

        initOperatorSelect('pickUser');
        setupQtyWarning('pickQty', function () { return currentLineOpen; });
        setupQtyInputGuard('pickQty', function () { return currentLineOpen; });

        setupBarcodeInput('scanInput', function (barcode) {
            playBeepSound(); showBeepIndicator();
            handleSubpageBarcode(barcode, _soPagePrefix, loadOrder, function (code) {
                if (!currentOrder) { showMessage('请先加载订单', 'warning'); document.getElementById('scanInput').focus(); return; }
                var lines = (currentOrder.sap_order || {}).lines || [];
                filterLineByItemCode(code, lines, selectLine, checkLineComplete);
                setTimeout(function() {
                    if (document.getElementById('pickCard').classList.contains('hidden')) {
                        document.getElementById('scanInput').focus();
                    }
                }, 200);
            });
        });

        if (docnum) { loadOrder(docnum); }
    }

    var loadOrder = async function(docnum) {
        if (_isLoadingDoc) return;
        _isLoadingDoc = true;
        showLoading(true);
        try {
            // DD 前缀自动识别: DD 开头的单号使用 DD 模式
            var isDD = /^DD/i.test(String(docnum));
            if (isDD) {
                _soPageDocType = 'DD';
                _soPagePrefix = 'DD';
                document.getElementById('pageBadge').innerHTML = getDocTypeIcon('DD', 36);
                var h1 = document.querySelector('h1[data-i18n="so.title"], h1[data-i18n="so.dd_title"]');
                if (h1) { h1.setAttribute('data-i18n', 'so.dd_title'); h1.textContent = t('so.dd_title', '配送单拣货 (DD)'); }
            }
            var data = await apiGet('/so?docnum=' + encodeURIComponent(docnum) + '&user=' + encodeURIComponent(getLoginUsername()));
            if (!data || !data.success) throw new Error(data && data.message ? data.message : '未找到订单');
            currentOrder = data;
            // 标记 docType 供 buildSoPickPayload 使用
            if (isDD && currentOrder.sap_order) { currentOrder.sap_order.docType = 'DD'; }
            // 已拆分的 SO: 预取 OMS picked_qty 供 renderOrder 使用
            var preWmsStatus = (data.sap_order || {}).wmsStatus || (data.wms_history || {}).wms_status || 'pending';
            if (preWmsStatus === 'split' && !isDD) {
                try {
                    var omsRes = await apiGet('/oms/orders?doc_num=' + encodeURIComponent(docnum) + '&doc_type=SO&page_size=1');
                    if (omsRes && omsRes.success && omsRes.orders && omsRes.orders.length > 0) {
                        var omsOrd = omsRes.orders[0];
                        var omsLines = await apiGet('/oms/order-lines?order_id=' + omsOrd.id + '&company_code=' + encodeURIComponent(omsOrd.company_code || ''));
                        if (omsLines && omsLines.success && omsLines.lines) {
                            data._omsPickedMap = {};
                            omsLines.lines.forEach(function(ln) {
                                data._omsPickedMap[ln.line_num] = parseFloat(ln.picked_qty) || 0;
                            });
                        }
                    }
                } catch(ignore) {}
            }
            var finalStatus = renderOrder(data);
            if (finalStatus === 'completed' || finalStatus === '已完成') {
                _setReadonlyMode(true);
                notifyDocLoaded(finalStatus);
                return;
            }
            // 已拆分的 SO 不允许作业 (需使用 DD 单号)
            if (finalStatus === 'split') {
                _setReadonlyMode(true, '该订单已拆分为DD，请使用DD单号进行拣货作业');
                notifyDocLoaded(finalStatus);
                return;
            }
            acquireDocumentLock(_soPageDocType, docnum);
            notifyDocLoaded(finalStatus);
        } catch (e) {
            showMessage('加载失败: ' + e.message, 'error'); playErrorSound();
        } finally { _isLoadingDoc = false; showLoading(false); }
    }

    function renderOrder(data) {
        var order = data.sap_order || {};
        var headerClosed = (order.docStatus !== 'O');
        var docNumDisplay = order.docNum || '-';
        var isDD = _soPageDocType === 'DD';

        // DD原单号: 独立字段显示 (超链接)
        var ddSourceItem = document.getElementById('ddSourceDocItem');
        if (isDD && order.sourceDocs && order.sourceDocs.length > 0) {
            if (ddSourceItem) {
                ddSourceItem.classList.remove('hidden');
                var linksHtml = order.sourceDocs.map(function(s) {
                    return '<a href="so.html?docnum=' + encodeURIComponent(s) + '" style="color:var(--primary-color);text-decoration:none;font-weight:500;">SO' + escapeHtml(s) + '</a>';
                }).join(', ');
                document.getElementById('ddSourceDocs').innerHTML = linksHtml;
            }
        } else {
            if (ddSourceItem) ddSourceItem.classList.add('hidden');
        }

        setText('docNum', docNumDisplay);
        setText('bpName', (order.cardCode || '') + ' ' + (order.cardName || ''));
        setText('dueDate', formatDate(order.docDueDate));
        var wms = data.wms_history || {};
        var wmsStatus = order.wmsStatus || wms.wms_status || 'pending';
        show('orderCard');

        // DD 模式: 动态修改表头 (增加 源单/源计划数 列)
        var thead = document.querySelector('#linesCard thead tr');
        if (thead && isDD) {
            thead.innerHTML = '<th class="col-line" data-i18n="field.line_num">行</th>' +
                '<th style="min-width:90px;">源单</th>' +
                '<th class="col-item" data-i18n="field.item_code">物料</th>' +
                '<th class="col-name" data-i18n="field.item_name">名称</th>' +
                '<th class="col-qty" style="color:#9ca3af;">源计划数</th>' +
                '<th class="col-qty">DD数量</th>' +
                '<th class="col-qty" data-i18n="so.delivered">已拣</th>' +
                '<th class="col-qty" data-i18n="so.pending_pick">待拣</th>' +
                '<th class="col-whs" data-i18n="field.warehouse">仓库</th>' +
                '<th class="col-barcode" data-i18n="field.barcode">条码</th>' +
                '<th class="action-col no-print">操作</th>';
        } else if (thead && !isDD) {
            var isSplit = wmsStatus === 'split';
            thead.innerHTML = '<th class="col-line" data-i18n="field.line_num">行</th>' +
                '<th class="col-item" data-i18n="field.item_code">物料</th>' +
                '<th class="col-name" data-i18n="field.item_name">名称</th>' +
                '<th class="col-qty" data-i18n="field.planned_qty">订单数</th>' +
                '<th class="col-qty">' + (isSplit ? 'DD已拣' : t('so.delivered', '已发')) + '</th>' +
                '<th class="col-qty">' + (isSplit ? 'DD待拣' : t('so.pending_pick', '待拣')) + '</th>' +
                '<th class="col-whs" data-i18n="field.warehouse">仓库</th>' +
                '<th class="col-barcode" data-i18n="field.barcode">条码</th>' +
                '<th class="action-col no-print">操作</th>';
        }

        var lines = order.lines || [];
        var tbody = document.getElementById('linesBody');
        var hasOpenLines = false;
        var colSpan = isDD ? 11 : 9;
        var rowOpts = { isDD: isDD, headerClosed: headerClosed, wmsStatus: wmsStatus, omsPickedMap: data._omsPickedMap };
        var rowHelpers = { escapeHtml: escapeHtml, formatNumber: formatNumber, generateBarcodeUrl: generateBarcodeUrl };
        if (lines.length === 0) {
            tbody.innerHTML = '<tr><td colspan="' + colSpan + '" class="no-data">无行项目</td></tr>';
        } else {
            tbody.innerHTML = lines.map(function (l) {
                var result = buildSoLineRowHtml(l, wms, rowOpts, rowHelpers);
                if (!result.lineDone) hasOpenLines = true;
                return result.html;
            }).join('');
        }

        show('linesCard');
        if (!hasOpenLines && lines.length > 0 && wmsStatus !== 'completed') {
            wmsStatus = 'completed';
        }
        renderHeaderStatus(order.docStatus, wmsStatus, 'docStatus', 'wmsStatus');
        if (hasOpenLines && !headerClosed && wmsStatus !== 'split') { show('batchCard'); } else { hide('batchCard'); }
        show('historyCard'); show('actionCard');
        var orderCardEl = document.getElementById('orderCard');
        var linesCardEl = document.getElementById('linesCard');
        if (headerClosed || !hasOpenLines || wmsStatus === 'split') {
            if (orderCardEl) orderCardEl.classList.add('status-closed');
            if (linesCardEl) linesCardEl.classList.add('status-closed');
        } else {
            if (orderCardEl) orderCardEl.classList.remove('status-closed');
            if (linesCardEl) linesCardEl.classList.remove('status-closed');
        }
        var existingBanner = document.getElementById('completedBanner');
        if (existingBanner) existingBanner.remove();
        if (wmsStatus === 'split') {
            var splitBanner = document.createElement('div');
            splitBanner.id = 'completedBanner';
            splitBanner.className = 'card';
            splitBanner.style.cssText = 'background:#fdf2f8;border:2px solid #9d174d;text-align:center;padding:16px;';
            splitBanner.innerHTML = '<span style="font-size:1.3rem;color:#9d174d;font-weight:bold;">&#9888; 该订单已拆分为DD，请使用DD单号进行拣货作业</span>';
            var lc = document.getElementById('linesCard');
            if (lc && lc.nextSibling) { lc.parentNode.insertBefore(splitBanner, lc.nextSibling); }
        } else if (headerClosed || !hasOpenLines) {
            var banner = document.createElement('div');
            banner.id = 'completedBanner';
            banner.className = 'card';
            banner.style.cssText = 'background:#f0fdf4;border:2px solid #16a34a;text-align:center;padding:16px;';
            banner.innerHTML = '<span style="font-size:1.3rem;color:#16a34a;font-weight:bold;">&#10003; 该订单已全部完成拣货</span>';
            var linesCardEl2 = document.getElementById('linesCard');
            if (linesCardEl2 && linesCardEl2.nextSibling) {
                linesCardEl2.parentNode.insertBefore(banner, linesCardEl2.nextSibling);
            }
        }

        renderHistory(wms.transactions || []);
        document.getElementById('printQr').innerHTML = '<img src="' + generateBarcodeUrl(_soPagePrefix + order.docNum, 'qrcode') + '" style="width:80px;height:80px;">';
        return wmsStatus;
    }

    // Phase 15.0: 检查行是否已完成 (委托给纯函数)
    function checkLineComplete(lineNum) {
        var line = ((currentOrder.sap_order || {}).lines || []).find(function (l) { return String(l.lineNum) === String(lineNum); });
        return checkSoLineComplete(line, currentOrder.wms_history || {});
    }

    function selectLine(lineNum) {
        if ((currentOrder.sap_order || {}).docStatus !== 'O') { showMessage('订单已关闭，无法作业', 'error'); playErrorSound(); focusScanInput(); return; }
        var line = ((currentOrder.sap_order || {}).lines || []).find(function (l) { return String(l.lineNum) === String(lineNum); });
        if (!line) { focusScanInput(); return; }
        if (line.lineStatus === 'C') { showMessage('该行已关闭，无法作业', 'error'); playErrorSound(); focusScanInput(); return; }
        var wms = currentOrder.wms_history || {};
        var picked = getSoLinePicked(wms, lineNum);
        var open = calcSoLineOpen(line, picked);
        if (open <= 0) { showMessage('该行已完成，无法作业', 'error'); playErrorSound(); focusScanInput(); return; }

        var rowEl = document.querySelector('tr[data-line="' + lineNum + '"]');
        if (rowEl) rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

        selectedLineData = line;
        document.getElementById('selectedLine').value = lineNum;
        setText('pickItemCode', line.itemCode + ' ' + (line.itemName || ''));
        currentLineOpen = Math.max(open, 0);

        var qtyInput = document.getElementById('pickQty');
        qtyInput.removeAttribute('max'); qtyInput.placeholder = '最大: ' + formatNumber(currentLineOpen); qtyInput.value = currentLineOpen;
        document.getElementById('pickRemark').value = '';
        show('pickCard');
        suppressScanFocus(500);
        setTimeout(function() {
            var card = document.getElementById('pickCard');
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(function() { qtyInput.focus(); qtyInput.select(); }, 200);
        }, 100);
    }

    function cancelPick() {
        hide('pickCard');
        selectedLineData = null;
        setTimeout(function () {
            var scanInput = document.getElementById('scanInput');
            if (scanInput) scanInput.focus();
        }, 100);
    }

    var handleSubmit = async function(event) {
        event.preventDefault();
        if (_isSubmitting) return;
        var qty = parseFloat(document.getElementById('pickQty').value);
        var user = document.getElementById('pickUser').value.trim();
        var remark = document.getElementById('pickRemark').value.trim();
        if (!qty || qty <= 0) { showMessage(t('msg.enter_valid_qty', '请输入有效数量'), 'error'); return; }
        if (!user) { showMessage(t('msg.enter_operator', '请输入操作人'), 'error'); return; }

        var wmsH = currentOrder.wms_history || {};
        var picked = getSoLinePicked(wmsH, selectedLineData.lineNum);
        var lineOpen = calcSoLineOpen(selectedLineData, picked);
        var confirmMsg = t('confirm.pick', '确认拣货 {0} {1}?').replace('{0}', formatNumber(qty)).replace('{1}', escapeHtml(selectedLineData.itemCode));
        if (!validateOverQty(qty, lineOpen, remark, 'pickRemark', confirmMsg)) return;

        _isSubmitting = true; showLoading(true);
        try {
            var order = currentOrder.sap_order || {};
            var payload = buildSoPickPayload(order, selectedLineData, qty, user, remark);
            var result = await apiPost('/transaction', payload);
            if (!result || !result.success) throw new Error(result && result.message ? result.message : t('result.submit_failed', '提交失败'));
            showMessage(t('result.pick_ok', '拣货成功!'), 'success'); playSuccessSound();
            saveState('last_user', user); hide('pickCard');
            setTimeout(function () {
                loadOrder(order.docNum);
                var scanInput = document.getElementById('scanInput');
                if (scanInput) scanInput.focus();
            }, 800);
        } catch (e) {
            showMessage(t('result.submit_failed', '提交失败') + ': ' + e.message, 'error'); playErrorSound();
        } finally { _isSubmitting = false; showLoading(false); }
    }

    function renderHistory(transactions) {
        var tbody = document.getElementById('historyBody');
        if (!transactions || transactions.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="no-data">' + t('common.no_data', '暂无记录') + '</td></tr>'; return; }
        var histHelpers = { escapeHtml: escapeHtml, formatNumber: formatNumber, formatDateTime: formatDateTime };
        tbody.innerHTML = buildHistoryRowsHtml(transactions, histHelpers);
    }

    function printBarcode() {
        if (!currentOrder || !currentOrder.sap_order) return;
        var order = currentOrder.sap_order;
        var d = order.docNum;
        var lines = order.lines || [];
        var html = '<html><head><title>条码标签 - ' + _soPagePrefix + escapeHtml(d) + '</title>' +
            '<style>body{font-family:Arial;padding:10px;font-size:12px;}' +
            '.doc-header{text-align:center;margin-bottom:10px;border-bottom:2px solid #333;padding-bottom:8px;}' +
            '.items{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-start;}' +
            '.item-card{border:1px solid #ccc;padding:4px;text-align:center;width:calc(16.66% - 6px);min-width:90px;box-sizing:border-box;page-break-inside:avoid;}' +
            '.item-card img{width:76px;height:76px;}' +
            '.item-code{font-size:9px;word-break:break-all;font-weight:bold;margin-top:2px;}' +
            '.item-name{font-size:7px;color:#666;white-space:normal;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;line-height:1.3em;}' +
            '@media print{button{display:none;}@page{margin:5mm;}}</style></head><body>' +
            '<div class="doc-header"><img src="' + generateBarcodeUrl(_soPagePrefix + d, 'qrcode') + '" style="width:80px;height:80px;padding:4px;background:#fff;"><br><strong>' + _soPagePrefix + escapeHtml(d) + '</strong></div>';
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

    var oneClickPickAll = async function() {
        if (!currentOrder) return;
        var order = currentOrder.sap_order || {};
        if (order.docStatus !== 'O') { showMessage('订单已关闭，无法拣货', 'error'); return; }
        var wms = currentOrder.wms_history || {};
        var user = document.getElementById('pickUser').value.trim() || getLoginUsername();

        var openLines = (order.lines || []).map(function (l) {
            var picked = getSoLinePicked(wms, l.lineNum);
            var open = calcSoLineOpen(l, picked);
            return {
                lineNum: l.lineNum, itemCode: l.itemCode, itemName: l.itemName || '',
                quantity: l.quantity, whsCode: l.whsCode || '', uom: l.uom || '',
                lineStatus: l.lineStatus || 'O', _open: Math.max(open, 0)
            };
        }).filter(function (l) { return l._open > 0 && l.lineStatus !== 'C'; });

        var done = await batchSubmitAll(openLines, function (l) {
            return {
                doc_type: _soPageDocType, doc_number: order.docNum, sap_doc_num: order.docNum,
                sap_doc_entry: order.docEntry,
                item_code: l.itemCode, item_name: l.itemName,
                line_num: l.lineNum, quantity: l._open,
                warehouse_code: l.whsCode, performed_by: user,
                action: 'scan', remarks: '一键拣货',
                planned_qty: l.quantity, uom: l.uom
            };
        }, '一键拣货');

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
        ['orderCard', 'linesCard', 'pickCard', 'batchCard', 'historyCard', 'actionCard'].forEach(hide);
        document.getElementById('scanInput').value = ''; document.getElementById('scanInput').focus();
        if (window.history.replaceState) window.history.replaceState({}, document.title, 'so.html');
    }

    function setText(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }
    function show(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); }
    function hide(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); }

    // var 声明的 async 函数需显式挂到 window，确保 HTML onclick/onsubmit 可访问
    window.loadOrder = loadOrder;
    window.handleSubmit = handleSubmit;
    window.oneClickPickAll = oneClickPickAll;

    document.getElementById('printTime').textContent = new Date().toLocaleString('zh-CN', { timeZone: CONFIG.timezone });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSO);
    else initSO();
}

// ============================================================================
// 兼容性导出 — Jest 单元测试引用（不影响浏览器环境）
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getSoLinePicked: getSoLinePicked,
        calcSoLineOpen: calcSoLineOpen,
        calcSoTotalDelivered: calcSoTotalDelivered,
        checkSoLineComplete: checkSoLineComplete,
        buildSoPickPayload: buildSoPickPayload,
        buildSoLineRowHtml: buildSoLineRowHtml,
        buildHistoryRowsHtml: buildHistoryRowsHtml
    };
}
