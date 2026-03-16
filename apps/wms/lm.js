/**
 * WMS 移库页 (lm.html) 业务逻辑
 * 从 lm.html 内联 <script> 中抽离，纯函数 + DOM 绑定分层
 */

// ============================================================================
// 纯函数 — 数据处理（无 DOM 依赖，可单元测试）
// ============================================================================

/**
 * 校验移库参数 — 纯函数，无 DOM 依赖
 * 业务规则: 数量弹性 — qty > maxQty 不报错，仅返回 warning 供未来使用
 *
 * @param {string} fromBin - 源库位
 * @param {string} toBin - 目标库位
 * @param {number|string} qty - 移动数量（可能来自 DOM，需强制转换）
 * @param {number|string} [maxQty] - 最大可用数量（可选，仅用于警告）
 * @returns {{ valid: boolean, error?: string, warning?: string }}
 */
function validateMoveParams(fromBin, toBin, qty, maxQty) {
    // 防御性格式化: trim + 大写，防止工人多敲空格或大小写差异
    var from = (fromBin && typeof fromBin === 'string') ? fromBin.trim().toUpperCase() : '';
    var to = (toBin && typeof toBin === 'string') ? toBin.trim().toUpperCase() : '';

    if (!from || !to) {
        return { valid: false, error: '请输入源库位和目标库位' };
    }
    if (from === to) {
        return { valid: false, error: '源库位和目标库位不能相同' };
    }

    // 切断字符串比较炸弹: 强制类型转换后再做算术比较
    var numQty = Number(qty);
    if (isNaN(numQty) || numQty <= 0) {
        return { valid: false, error: '请输入有效数量' };
    }

    // 数量弹性: qty > maxQty 不报错，仅附带 warning
    var result = { valid: true };
    var numMax = Number(maxQty);
    if (!isNaN(numMax) && numMax > 0 && numQty > numMax) {
        result.warning = '移动数量 (' + numQty + ') 超过可用数量 (' + numMax + ')';
    }
    return result;
}

/**
 * 构建移库行 payload — 纯函数，无 DOM 依赖
 * 批次弹性: batch 为空时 batch_number 为空字符串，底层数据结构始终支持
 *
 * @param {string} itemCode - 物料编号
 * @param {string} fromBin - 源库位
 * @param {string} toBin - 目标库位
 * @param {number} qty - 移动数量
 * @param {string} [batch=''] - 批次号（可选）
 * @returns {Object} 移库行数据结构
 */
function buildMovePayload(itemCode, fromBin, toBin, qty, batch) {
    return {
        item_code: itemCode,
        from_bin: fromBin,
        bin_location: toBin,
        quantity: qty,
        batch_number: batch || ''
    };
}

/**
 * 合并移库交易记录 — 按 item_code + from_bin + to_bin 分组，SUM(quantity)
 * 借贷模式: 每次移库生成两行 (源库位-贷/负, 目标库位-借/正)
 *
 * @param {Array} transactions - 交易记录数组
 * @returns {{ mergedRows: Array, uniqueItemCount: number }}
 */
function mergeMoveTx(transactions) {
    var mergedMap = {};
    (transactions || []).forEach(function (t) {
        var fromBin = t.from_bin || t.from_warehouse || '-';
        var toBin = t.to_bin || t.bin_location || '-';
        var key = (t.item_code || '') + '|' + fromBin + '|' + toBin;
        if (!mergedMap[key]) {
            mergedMap[key] = {
                item_code: t.item_code || '',
                item_name: t.item_name || '',
                quantity: 0,
                from_bin: fromBin,
                to_bin: toBin,
                transaction_time: t.transaction_time
            };
        }
        mergedMap[key].quantity += Number(t.quantity) || 0;
        if (t.item_name && !mergedMap[key].item_name) mergedMap[key].item_name = t.item_name;
        if (t.transaction_time > mergedMap[key].transaction_time) {
            mergedMap[key].transaction_time = t.transaction_time;
        }
    });
    var mergedRows = Object.values(mergedMap);
    mergedRows.sort(function (a, b) {
        return (a.item_code || '').localeCompare(b.item_code || '') ||
               (a.from_bin || '').localeCompare(b.from_bin || '');
    });
    var uniqueItems = {};
    mergedRows.forEach(function (r) { if (r.item_code) uniqueItems[r.item_code] = true; });
    return {
        mergedRows: mergedRows,
        uniqueItemCount: Object.keys(uniqueItems).length
    };
}

/**
 * 构建移库明细行 HTML (借贷双行) — 纯函数，无 DOM 依赖
 * @param {Array} mergedRows - mergeMoveTx 返回的合并行
 * @param {Object} h - { escapeHtml, formatNumber, generateBarcodeUrl, formatDateTime }
 * @returns {string} HTML 行字符串 (每条记录生成贷+借两行)
 */
function buildLmDetailRowsHtml(mergedRows, h) {
    if (!mergedRows || mergedRows.length === 0) return '';
    var html = '';
    mergedRows.forEach(function (t) {
        var qtyNum = Number(t.quantity) || 0;
        var nameHtml = h.escapeHtml(t.item_name || '-');
        // 贷行: 源库位 (红色负数)
        html += '<tr style="color:#dc2626;"><td>' + h.escapeHtml(t.item_code) + '</td><td>' + nameHtml + '</td><td class="line-barcode-col"><img src="' + h.generateBarcodeUrl(t.item_code, 'qrcode') + '"></td><td>-' + h.formatNumber(qtyNum) + '</td><td>' + h.escapeHtml(t.from_bin) + '</td><td style="color:#999;">贷(出)</td><td>' + h.formatDateTime(t.transaction_time) + '</td></tr>';
        // 借行: 目标库位 (绿色正数)
        html += '<tr style="color:#16a34a;"><td>' + h.escapeHtml(t.item_code) + '</td><td>' + nameHtml + '</td><td class="line-barcode-col"><img src="' + h.generateBarcodeUrl(t.item_code, 'qrcode') + '"></td><td>+' + h.formatNumber(qtyNum) + '</td><td>' + h.escapeHtml(t.to_bin) + '</td><td style="color:#999;">借(入)</td><td>' + h.formatDateTime(t.transaction_time) + '</td></tr>';
    });
    return html;
}

/**
 * 构建移库待提交行 HTML — 纯函数，无 DOM 依赖
 * @param {Array} pendingMoves - 待提交队列
 * @param {Object} h - { escapeHtml, formatNumber, formatDateTime }
 * @returns {string} HTML 行字符串
 */
function buildLmPendingRowsHtml(pendingMoves, h) {
    if (!pendingMoves || pendingMoves.length === 0) return '';
    var html = '';
    pendingMoves.forEach(function (m, idx) {
        html += '<tr><td>' + h.escapeHtml(m.itemCode) + '</td><td>' + h.formatNumber(m.qty) + '</td><td>' + h.escapeHtml(m.fromBin) + '</td><td>' + h.escapeHtml(m.toBin) + '</td><td>' + h.formatDateTime(m.addedAt) + '</td><td class="no-print"><button class="btn btn-danger btn-sm" onclick="removePending(' + idx + ')" style="padding:2px 8px;font-size:12px;">删</button></td></tr>';
    });
    return html;
}

// ============================================================================
// DOM 绑定 — 浏览器环境（依赖 shared.js 全局函数）
// ============================================================================

/* istanbul ignore next */
if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof CONFIG !== 'undefined') {

    var currentDoc = null;
    var pendingMoves = []; // 暂存队列: [{itemCode, itemName, fromBin, toBin, qty, remark, addedAt}, ...]

    function initLM() {
        if (!checkAuth()) return;
        document.getElementById('pageBadge').innerHTML = getDocTypeIcon('LM', 36);
        var savedUser = getLoginUsername() !== 'unknown' ? getLoginUsername() : loadState('last_user');
        if (savedUser) document.getElementById('createUser').value = savedUser;

        loadMasterDataCache(); // 静默后台更新主数据缓存
        // V18.3: 库位自动补全
        initBinAutocomplete('fromBin');
        initBinAutocomplete('toBin');

        // V19.5: 聚焦链 — fromBin → toBin → moveQty (Enter 键自动跳转)
        var fromBinEl = document.getElementById('fromBin');
        var toBinEl = document.getElementById('toBin');
        var moveQtyEl = document.getElementById('moveQty');
        if (fromBinEl) {
            fromBinEl.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (fromBinEl.value.trim() && toBinEl) { toBinEl.focus(); toBinEl.select(); }
                }
            });
        }
        if (toBinEl) {
            toBinEl.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (toBinEl.value.trim() && moveQtyEl) { moveQtyEl.focus(); moveQtyEl.select(); }
                }
            });
        }
        if (moveQtyEl) {
            moveQtyEl.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    // 数量回车 → 提交表单 (默认行为, 不阻止)
                }
            });
        }

        // blur 校验：库位输入离焦时验证是否在主数据缓存中
        async function validateBinInput(el) {
            var raw = el.value.trim();
            if (!raw) return;
            var result = validateBin(raw);
            if (result === null) {
                await loadMasterDataCache(true);
                result = validateBin(raw);
            }
            if (result === null) {
                el.style.borderColor = '#f59e0b';
                return;
            }
            if (result === false) {
                // 标红但不清空 — 用户可能要通过 + 按钮新增此库位
                el.style.borderColor = '#ef4444';
            } else {
                // 自动纠正为字典值
                el.value = result.bin_code;
                el.style.borderColor = '#22c55e';
            }
        }
        if (fromBinEl) fromBinEl.addEventListener('blur', function() { validateBinInput(fromBinEl); });
        if (toBinEl) toBinEl.addEventListener('blur', function() { validateBinInput(toBinEl); });

        var id = getUrlParam('id');
        if (id) loadDoc(id);
    }

    // V18.4: 新增库位到字典（直接取输入框值，一步确认）
    var addBinToDict = async function(inputId) {
        var el = document.getElementById(inputId);
        var code = el.value.trim().toUpperCase();
        if (!code) { showMessage('请先输入库位代码', 'error'); el.focus(); return; }
        var existing = validateBin(code);
        if (existing && existing !== false) { showMessage('库位 [' + code + '] 已在字典中', 'info'); el.style.borderColor = '#22c55e'; return; }
        var whs = '';
        if (currentDoc && currentDoc.document) whs = currentDoc.document.warehouse_code || '';
        if (!confirm('添加库位 [' + code + '] 到字典？')) return;
        try {
            var r = await apiPost('/bin/add', { bin_code: code, whs_code: whs });
            if (r && r.success) {
                // 同时更新本地缓存
                try {
                    var raw = localStorage.getItem('wms_masterdata');
                    if (raw) {
                        var cache = JSON.parse(raw);
                        // V17.0: 适配 bins_map 格式
                        if (cache.bins_map) {
                            if (!cache.bins_map[whs]) cache.bins_map[whs] = [];
                            cache.bins_map[whs].push(code);
                        } else {
                            if (!cache.bins) cache.bins = [];
                            cache.bins.push({ bin_code: code, whs_code: whs });
                        }
                        cache._ts = Date.now();
                        localStorage.setItem('wms_masterdata', JSON.stringify(cache));
                    }
                } catch (e) {}
                el.value = code;
                el.style.borderColor = '#22c55e';
                showMessage('库位 [' + code + '] 已添加到字典', 'success');
            } else {
                throw new Error(r && r.message ? r.message : '添加失败');
            }
        } catch (e) { showMessage('添加库位失败: ' + e.message, 'error'); }
    }

    function showCreateForm() { hide('modeCard'); show('createCard'); }
    function showLoadForm() {
        hide('modeCard'); show('loadCard');
        setupBarcodeInput('loadInput', function (val) {
            playBeepSound(); showBeepIndicator();
            handleSubpageBarcode(val, 'LM', loadDoc);
        });
    }
    function backToMode() {
        ['createCard', 'loadCard', 'moveCard', 'inputCard', 'pendingCard', 'detailCard', 'actionCard'].forEach(hide);
        show('modeCard'); currentDoc = null; pendingMoves = [];
    }

    var handleCreate = async function(event) {
        event.preventDefault();
        if (_isSubmitting) return; // V17.1: 防重复提交
        var whs = document.getElementById('createWhs').value.trim();
        var user = document.getElementById('createUser').value.trim();
        var remark = document.getElementById('createRemark').value.trim();
        if (!whs || !user) { showMessage('请填写仓库和操作人', 'error'); return; }

        // 提交前二次校验主数据（防用户未触发blur直接提交）
        var whsResult = validateWarehouse(whs);
        if (whsResult === null) { await loadMasterDataCache(true); whsResult = validateWarehouse(whs); }
        if (whsResult === false) {
            document.getElementById('createWhs').value = '';
            document.getElementById('createWhs').style.borderColor = '#ef4444';
            showMessage('仓库代码 [' + whs + '] 不在主数据中，请重新输入', 'error');
            return;
        }
        if (whsResult && whsResult.whs_code) { whs = whsResult.whs_code; }

        _isSubmitting = true; showLoading(true);
        try {
            var result = await apiPost('/document/create', {
                doc_type: 'LM', warehouse_code: whs, created_by: user, remarks: remark
            });
            if (!result || !result.success) throw new Error(result && result.message ? result.message : '创建失败');
            showMessage('移库单创建成功: ' + result.doc_number, 'success');
            saveState('last_user', user); hide('createCard');
            loadDoc(result.doc_number);
        } catch (e) { showMessage('创建失败: ' + e.message, 'error'); }
        finally { _isSubmitting = false; showLoading(false); }
    }

    var loadDoc = async function(docNumOrId) {
        // 如果传入的是纯数字且像日期序号(8+位)，补回LM前缀
        if (/^\d{8,}$/.test(docNumOrId)) {
            docNumOrId = 'LM' + docNumOrId;
        }
        showLoading(true);
        try {
            var data = await apiGet('/document?id=' + encodeURIComponent(docNumOrId) + '&type=LM');
            if (!data || !data.success) throw new Error(data && data.message ? data.message : '未找到移库单');
            currentDoc = data; renderDoc(data);
            notifyDocLoaded((data.document || {}).wms_status || '');
        } catch (e) { showMessage('加载失败: ' + e.message, 'error'); playErrorSound(); }
        finally { showLoading(false); }
    }

    function renderDoc(data) {
        var doc = data.document || {};
        setText('docNum', doc.doc_number || '-');
        setText('warehouse', doc.warehouse_code || '-');
        setText('moveUser', doc.created_by || '-');

        // 调用纯函数合并交易记录
        var merged = mergeMoveTx(data.transactions);
        var mergedRows = merged.mergedRows;
        setText('movedItems', merged.uniqueItemCount + ' 种');

        var tbody = document.getElementById('detailBody');
        if (mergedRows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="no-data">尚未执行移库操作</td></tr>';
        } else {
            var detailHelpers = { escapeHtml: escapeHtml, formatNumber: formatNumber, generateBarcodeUrl: generateBarcodeUrl, formatDateTime: formatDateTime };
            tbody.innerHTML = buildLmDetailRowsHtml(mergedRows, detailHelpers);
        }

        // 完成状态: 灰色
        var isComplete = doc.wms_status === 'completed' || doc.status === 'completed';
        ['loadCard', 'modeCard'].forEach(hide);
        show('moveCard'); show('detailCard'); show('actionCard');
        if (isComplete) {
            document.getElementById('moveCard').classList.add('status-closed');
            document.getElementById('detailCard').classList.add('status-closed');
            hide('inputCard'); hide('pendingCard');
            // 隐藏"完成移库"按钮, 仅保留打印和返回
            var completeBtn = document.querySelector('button.btn-success');
            if (completeBtn) { completeBtn.disabled = true; completeBtn.textContent = '已完成'; }
        } else {
            document.getElementById('moveCard').classList.remove('status-closed');
            document.getElementById('detailCard').classList.remove('status-closed');
            show('inputCard'); show('pendingCard'); renderPending();
            var completeBtn2 = document.querySelector('button.btn-success');
            if (completeBtn2) { completeBtn2.disabled = false; completeBtn2.textContent = '完成移库'; }
        }

        setupBarcodeInput('itemScan', function (code) {
            playBeepSound(); showBeepIndicator(); lookupItem(code);
        });

        var barcodeContent = doc.doc_number.startsWith('LM') ? doc.doc_number : ('LM' + doc.doc_number);
        document.getElementById('printQr').innerHTML = '<img src="' + generateBarcodeUrl(barcodeContent, 'qrcode') + '" style="width:80px;height:80px;">';
    }

    var lookupItem = async function(code) {
        // 物料号格式校验: 防止两个条码被连续扫描合并
        var dashParts = code.split('-');
        if (dashParts.length > 2 && code.length > 15) {
            showMessage('物料号异常 (可能两个条码被合并): ' + escapeHtml(code) + '\n请重新扫描单个物料', 'error');
            playErrorSound();
            return;
        }
        try {
            var data = await apiGet('/item?code=' + encodeURIComponent(code));
            if (data && data.success && data.item) {
                setText('scanItemCode', data.item.itemCode || code);
                setText('scanItemName', data.item.itemName || '-');
                show('moveFields');
                // V19.5: 抑制 scanInput 抢焦点, 自动聚焦到源库位
                suppressScanFocus(500);
                setTimeout(function() { document.getElementById('fromBin').focus(); }, 100);
            } else {
                setText('scanItemCode', code);
                setText('scanItemName', '');
                hide('moveFields');
                showMessage('物料 ' + escapeHtml(code) + ' 未在SAP中找到，不允许移库', 'error');
                playErrorSound();
            }
        } catch (e) {
            setText('scanItemCode', code);
            setText('scanItemName', '');
            hide('moveFields');
            showMessage('物料 ' + escapeHtml(code) + ' 查询失败，请检查网络后重试', 'error');
            playErrorSound();
        }
    }

    var handleMove = async function(event) {
        event.preventDefault();
        var itemCode = document.getElementById('scanItemCode').textContent;
        var itemName = document.getElementById('scanItemName').textContent;
        var fromBin = document.getElementById('fromBin').value.trim();
        var toBin = document.getElementById('toBin').value.trim();
        var qty = parseFloat(document.getElementById('moveQty').value);
        var remark = document.getElementById('moveRemark').value.trim();

        if (!itemCode || itemCode === '-') { showMessage('请先扫描物料条码', 'error'); return; }

        // 调用纯函数校验移库参数
        var validation = validateMoveParams(fromBin, toBin, qty);
        if (!validation.valid) { showMessage(validation.error, 'error'); return; }
        // Warning 绝对放行: valid === true 时无条件继续，warning 仅记录不阻断
        if (validation.warning) {
            console.warn('[LM] ' + validation.warning);
        }

        // V17.1: 提交前校验库位（异步加载缓存+重试, 缓存不可用时也阻断）
        var fromResult = validateBin(fromBin);
        if (fromResult === null) { await loadMasterDataCache(true); fromResult = validateBin(fromBin); }
        if (fromResult === false) {
            document.getElementById('fromBin').value = '';
            document.getElementById('fromBin').style.borderColor = '#ef4444';
            showMessage('源库位代码 [' + fromBin + '] 不在主数据中，请重新输入', 'error');
            return;
        }
        if (fromResult === null) {
            showMessage('库位字典未加载，无法校验源库位 [' + fromBin + ']，请刷新页面', 'error');
            return;
        }
        fromBin = fromResult.bin_code;
        var toResult = validateBin(toBin);
        if (toResult === null) { await loadMasterDataCache(true); toResult = validateBin(toBin); }
        if (toResult === false) {
            document.getElementById('toBin').value = '';
            document.getElementById('toBin').style.borderColor = '#ef4444';
            showMessage('目标库位代码 [' + toBin + '] 不在主数据中，请重新输入', 'error');
            return;
        }
        if (toResult === null) {
            showMessage('库位字典未加载，无法校验目标库位 [' + toBin + ']，请刷新页面', 'error');
            return;
        }
        toBin = toResult.bin_code;

        // 防重复: 检查暂存队列和已提交记录
        var existInPending = pendingMoves.find(function (m) {
            return m.itemCode === itemCode && m.fromBin === fromBin && m.toBin === toBin;
        });
        if (existInPending) {
            if (!confirm('待提交清单中已有 ' + itemCode + ' ' + fromBin + ' → ' + toBin + ' (数量: ' + formatNumber(existInPending.qty) + ')\n是否继续追加一行?')) return;
        }
        var existingTx = (currentDoc.transactions || []).find(function (t) {
            return t.item_code === itemCode &&
                (t.from_bin || t.from_warehouse || '') === fromBin &&
                (t.to_bin || t.bin_location || '') === toBin;
        });
        if (existingTx) {
            if (!confirm('已有提交记录: ' + itemCode + ' ' + fromBin + ' → ' + toBin + ' (数量: ' + formatNumber(existingTx.quantity) + ')\n是否继续追加?')) return;
        }

        // 添加到暂存队列（不提交后端），记录当前时间
        pendingMoves.push({ itemCode: itemCode, itemName: itemName, fromBin: fromBin, toBin: toBin, qty: qty, remark: remark, addedAt: getSystemDateTime() });
        renderPending();
        showMessage('已添加: ' + itemCode + ' ' + fromBin + ' → ' + toBin + ' × ' + formatNumber(qty), 'success');
        playSuccessSound();

        // 清空表单，准备下一行
        hide('moveFields');
        setText('scanItemCode', '-'); setText('scanItemName', '-');
        document.getElementById('fromBin').value = '';
        document.getElementById('toBin').value = '';
        document.getElementById('moveQty').value = '';
        document.getElementById('moveRemark').value = '';
        document.getElementById('itemScan').value = '';
        document.getElementById('itemScan').focus();
    }

    function renderPending() {
        var tbody = document.getElementById('pendingBody');
        var countEl = document.getElementById('pendingCount');
        if (!pendingMoves.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data">' + t('msg.no_pending', '暂无待提交记录') + '</td></tr>';
            countEl.textContent = '(0)';
            return;
        }
        countEl.textContent = '(' + pendingMoves.length + ')';
        var pendingHelpers = { escapeHtml: escapeHtml, formatNumber: formatNumber, formatDateTime: formatDateTime };
        tbody.innerHTML = buildLmPendingRowsHtml(pendingMoves, pendingHelpers);
    }

    function removePending(idx) {
        var m = pendingMoves[idx];
        if (m && confirm(t('confirm.delete_item', '删除: {0}?').replace('{0}', m.itemCode + ' ' + m.fromBin + ' → ' + m.toBin))) {
            pendingMoves.splice(idx, 1);
            renderPending();
        }
    }

    function clearPending() {
        if (!pendingMoves.length) return;
        if (!confirm(t('confirm.clear_pending', '确定清空所有待提交记录 ({0} 行)?').replace('{0}', pendingMoves.length))) return;
        pendingMoves = [];
        renderPending();
    }

    var submitAllMoves = async function() {
        if (!pendingMoves.length) { showMessage(t('msg.empty_pending', '暂存清单为空，请先添加记录'), 'error'); return; }
        if (!currentDoc || _isSubmitting) return; // V17.1: 防重复提交
        var doc = currentDoc.document || {};
        if (!confirm(t('confirm.submit_rows', '确认提交 {0} 行{1}记录?').replace('{0}', pendingMoves.length).replace('{1}', t('lm.title_short', '移库')))) return;

        _isSubmitting = true; showLoading(true);
        var successCount = 0;
        var errors = [];
        var succeeded = []; // V16.5: 记录成功索引
        try {
            for (var i = 0; i < pendingMoves.length; i++) {
                var m = pendingMoves[i];
                try {
                    // 调用纯函数构建移库行 payload，再合并文档上下文
                    var linePayload = buildMovePayload(m.itemCode, m.fromBin, m.toBin, m.qty);
                    var result = await apiPost('/transaction', {
                        doc_type: 'LM', doc_number: doc.doc_number,
                        item_code: linePayload.item_code, item_name: m.itemName,
                        quantity: linePayload.quantity, warehouse_code: doc.warehouse_code,
                        from_bin: linePayload.from_bin, bin_location: linePayload.bin_location,
                        performed_by: doc.created_by, action: 'move', remarks: m.remark,
                        batch_number: linePayload.batch_number,
                        planned_qty: 0, transaction_time: m.addedAt
                    });
                    if (!result || !result.success) throw new Error(result && result.message ? result.message : t('result.submit_failed', '提交失败'));
                    successCount++;
                    succeeded.push(i);
                } catch (e) {
                    errors.push(m.itemCode + '(' + m.fromBin + '→' + m.toBin + '): ' + e.message);
                }
            }
            // V16.5: 只移除成功的行，保留失败行
            for (var j = succeeded.length - 1; j >= 0; j--) {
                pendingMoves.splice(succeeded[j], 1);
            }
            renderPending();
            if (errors.length === 0) {
                showMessage(t('result.submit_all_ok', '全部提交成功: {0} 行').replace('{0}', successCount), 'success');
                playSuccessSound();
            } else {
                showMessage(t('result.submit_partial', '提交完成: {0} 成功, {1} 失败').replace('{0}', successCount).replace('{1}', errors.length) + '\n' + errors.join('\n'), 'error');
                playErrorSound();
            }
            loadDoc(doc.doc_number);
        } catch (e) { showMessage(t('result.submit_error', '提交异常') + ': ' + e.message, 'error'); playErrorSound(); }
        finally { _isSubmitting = false; showLoading(false); }
    }

    var completeMove = async function() {
        if (!currentDoc || _isSubmitting) return; // V17.1: 防重复提交
        var doc = currentDoc.document || {};

        // V16.5: 有待提交行时，先批量提交再完成（每行独立时间戳）
        if (pendingMoves.length > 0) {
            if (!confirm(t('confirm.pending_then_complete', '有 {0} 行待提交记录，将先提交后完成{1} {2}。继续？').replace('{0}', pendingMoves.length).replace('{1}', t('lm.title_short', '移库') + t('common.doc', '单')).replace('{2}', doc.doc_number))) return;
            showLoading(true);
            var errors = [];
            var succeeded = [];
            for (var i = 0; i < pendingMoves.length; i++) {
                var m = pendingMoves[i];
                try {
                    // 调用纯函数构建移库行 payload，再合并文档上下文
                    var linePayload = buildMovePayload(m.itemCode, m.fromBin, m.toBin, m.qty);
                    var r = await apiPost('/transaction', {
                        doc_type: 'LM', doc_number: doc.doc_number,
                        item_code: linePayload.item_code, item_name: m.itemName,
                        quantity: linePayload.quantity, warehouse_code: doc.warehouse_code,
                        from_bin: linePayload.from_bin, bin_location: linePayload.bin_location,
                        performed_by: doc.created_by, action: 'move', remarks: m.remark,
                        batch_number: linePayload.batch_number,
                        planned_qty: 0, transaction_time: m.addedAt
                    });
                    if (!r || !r.success) throw new Error(r && r.message ? r.message : t('result.submit_failed', '提交失败'));
                    succeeded.push(i);
                } catch (e) { errors.push(m.itemCode + ': ' + e.message); }
            }
            // 只移除成功行
            for (var j = succeeded.length - 1; j >= 0; j--) { pendingMoves.splice(succeeded[j], 1); }
            renderPending();
            if (errors.length > 0) {
                showMessage(t('result.partial_failed', '部分提交失败 ({0} 行)').replace('{0}', errors.length) + ':\n' + errors.join('\n'), 'error');
                playErrorSound(); showLoading(false); return;
            }
        } else {
            if (!confirm(t('confirm.complete_doc', '确认完成{0} {1}?').replace('{0}', t('lm.title_short', '移库') + t('common.doc', '单')).replace('{1}', doc.doc_number))) return;
            showLoading(true);
        }

        try {
            var result = await apiPost('/document/complete', { doc_number: doc.doc_number, doc_type: 'LM' });
            if (!result || !result.success) throw new Error(result && result.message ? result.message : t('common.failed', '操作失败'));
            showMessage(t('result.doc_completed', '{0}已完成').replace('{0}', t('lm.title_short', '移库') + t('common.doc', '单')), 'success'); playSuccessSound();
            loadDoc(doc.doc_number);
        } catch (e) { showMessage(t('common.failed', '操作失败') + ': ' + e.message, 'error'); }
        finally { showLoading(false); }
    }

    function setText(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }
    function show(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); }
    function hide(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); }

    // var 声明的 async 函数需显式挂到 window，确保 HTML onclick/onsubmit 可访问
    window.addBinToDict = addBinToDict;
    window.handleCreate = handleCreate;
    window.handleMove = handleMove;
    window.submitAllMoves = submitAllMoves;
    window.completeMove = completeMove;

    document.getElementById('printTime').textContent = new Date().toLocaleString('zh-CN', { timeZone: CONFIG.timezone });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLM);
    else initLM();
}

// ============================================================================
// 兼容性导出 — Jest 单元测试引用（不影响浏览器环境）
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        validateMoveParams: validateMoveParams,
        buildMovePayload: buildMovePayload,
        mergeMoveTx: mergeMoveTx,
        buildLmDetailRowsHtml: buildLmDetailRowsHtml,
        buildLmPendingRowsHtml: buildLmPendingRowsHtml
    };
}
