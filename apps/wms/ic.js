/**
 * WMS 盘点页 (ic.html) 业务逻辑
 * 从 ic.html 内联 <script> 中抽离，纯函数 + DOM 绑定分层
 */

// ============================================================================
// 纯函数 — 数据处理（无 DOM 依赖，可单元测试）
// ============================================================================

/**
 * 合并交易记录 — 按 item_code + bin_location 分组，SUM(quantity) 得到最终数量
 * @param {Array} transactions - 交易记录数组
 * @returns {{ mergedMap: Object, mergedLines: Array, uniqueItemCount: number }}
 */
function mergeTransactions(transactions) {
    var mergedMap = {};
    (transactions || []).forEach(function (t) {
        var bin = t.bin_location || '';
        var key = (t.item_code || '') + '||' + bin;
        if (!mergedMap[key]) {
            mergedMap[key] = {
                item_code: t.item_code,
                item_name: t.item_name,
                actual_qty: 0,
                bin_location: bin,
                updated_at: t.transaction_time
            };
        }
        mergedMap[key].actual_qty += Number(t.quantity) || 0;
        if (t.transaction_time > mergedMap[key].updated_at) {
            mergedMap[key].updated_at = t.transaction_time;
            if (t.item_name) mergedMap[key].item_name = t.item_name;
        }
    });
    var mergedLines = Object.values(mergedMap);
    var uniqueItems = {};
    mergedLines.forEach(function (l) { if (l.item_code) uniqueItems[l.item_code] = true; });
    return {
        mergedMap: mergedMap,
        mergedLines: mergedLines,
        uniqueItemCount: Object.keys(uniqueItems).length
    };
}

/**
 * 格式化已盘品种统计文本
 * @param {number} uniqueItemCount - 去重物料数
 * @param {number} totalLines - 合并后总行数
 * @returns {string}
 */
function formatCountedText(uniqueItemCount, totalLines) {
    return uniqueItemCount + ' 种 / ' + totalLines + ' 行';
}

/**
 * 验证物料条码格式 — 防止两个条码被连续扫描合并
 * @param {string} code - 扫描到的条码
 * @returns {{ valid: boolean, error?: string }}
 */
function validateItemBarcode(code) {
    if (!code || typeof code !== 'string') {
        return { valid: false, error: '条码为空' };
    }
    var dashParts = code.split('-');
    if (dashParts.length > 2 && code.length > 15) {
        return { valid: false, error: '物料号异常 (可能两个条码被合并): ' + code };
    }
    return { valid: true };
}

/**
 * 从库存查询数据中过滤指定库位的行
 * @param {Array} stockData - 原始库存行 (来自 /stock API)
 * @param {string} bin - 库位代码 (空=不过滤)
 * @returns {Array} 过滤后的行
 */
function filterStockByBin(stockData, bin) {
    if (!bin || !stockData) return stockData || [];
    var upper = bin.toUpperCase();
    return stockData.filter(function(row) {
        var rowBin = (row.bin_code || row.bins || '').toUpperCase();
        return rowBin === upper || rowBin === '';
    });
}

/**
 * 汇总库存数据为一行摘要
 * @param {Array} stockData - 库存行数据
 * @returns {{ base_qty: number, delta_qty: number, real_time_qty: number, rowCount: number }}
 */
function summarizeStock(stockData) {
    var base = 0, delta = 0, realtime = 0;
    (stockData || []).forEach(function(r) {
        base += Number(r.base_qty) || 0;
        delta += Number(r.delta_qty) || 0;
        realtime += Number(r.real_time_qty) || 0;
    });
    return { base_qty: base, delta_qty: delta, real_time_qty: realtime, rowCount: (stockData || []).length };
}

/**
 * 查找待提交清单中的重复项索引
 * @param {Array} pendingCounts - 待提交清单
 * @param {string} itemCode - 物料编号
 * @param {string} bin - 库位
 * @returns {number} 索引，-1 表示未找到
 */
function findPendingIndex(pendingCounts, itemCode, bin) {
    return (pendingCounts || []).findIndex(function (p) {
        return p.itemCode === itemCode && p.bin === bin;
    });
}

/**
 * 准备盘点待提交条目 — 核心差异计算逻辑
 * 判断是新增、更新还是跳过，并计算发送给后端的 delta 数量
 *
 * @param {Array} pendingCounts - 当前待提交清单
 * @param {Object} mergedCounts - 后端已提交记录的合并映射 (item_code||bin → record)
 * @param {string} itemCode - 物料编号
 * @param {string} itemName - 物料名称
 * @param {number} qty - 用户输入的差异数量
 * @param {string} bin - 库位
 * @param {string} remark - 备注
 * @param {string} addedAt - 添加时间
 * @returns {{ action: 'skip'|'update'|'add', message?: string, needConfirm?: boolean, confirmMsg?: string, pendingIdx?: number, updates?: Object, entry?: Object }}
 */
function preparePendingEntry(pendingCounts, mergedCounts, itemCode, itemName, qty, bin, remark, addedAt) {
    // 1. 检查待提交清单中是否已有同物料+同库位
    var pendingIdx = findPendingIndex(pendingCounts, itemCode, bin);
    if (pendingIdx >= 0) {
        var oldP = pendingCounts[pendingIdx];
        if (qty === oldP.qty) {
            return { action: 'skip', message: '物料 ' + itemCode + ' 数量未变 (' + qty + ')，跳过' };
        }
        return {
            action: 'update',
            pendingIdx: pendingIdx,
            needConfirm: true,
            confirmMsg: '待提交清单中已有 ' + itemCode + (bin ? ' 库位 ' + bin : '') +
                ' (数量: ' + oldP.qty + ').\n是否覆盖为 ' + qty + '?',
            updates: { qty: qty, remark: remark, addedAt: addedAt }
        };
    }

    // 2. 检查后端已提交记录
    var key = (itemCode || '') + '||' + bin;
    var existLine = (mergedCounts || {})[key] || null;
    var sendQty = qty;

    if (existLine) {
        var oldQty = Number(existLine.actual_qty) || 0;
        if (qty === oldQty) {
            return { action: 'skip', message: '物料 ' + itemCode + ' 数量未变 (' + qty + ')，跳过' };
        }
        var overrideRemark = (remark ? remark + '; ' : '') + '覆盖: ' + oldQty + ' → ' + qty;
        return {
            action: 'add',
            needConfirm: true,
            confirmMsg: '物料 ' + itemCode + (bin ? ' 库位 ' + bin : '') +
                ' 已有盘点记录 (数量: ' + oldQty + ').\n是否覆盖为新数量 ' + qty + '?',
            entry: { itemCode: itemCode, itemName: itemName, qty: qty, bin: bin, remark: overrideRemark, sendQty: qty - oldQty, addedAt: addedAt }
        };
    }

    // 3. 全新条目
    return {
        action: 'add',
        needConfirm: false,
        entry: { itemCode: itemCode, itemName: itemName, qty: qty, bin: bin, remark: remark, sendQty: sendQty, addedAt: addedAt }
    };
}

/**
 * 构建盘点事务提交 payload
 * @param {string} docNumber - 盘点单号
 * @param {string} warehouseCode - 仓库代码
 * @param {string} createdBy - 盘点人
 * @param {Object} entry - 待提交条目
 * @returns {Object} API payload
 */
function buildCountPayload(docNumber, warehouseCode, createdBy, entry) {
    return {
        doc_type: 'IC',
        doc_number: docNumber,
        item_code: entry.itemCode,
        item_name: entry.itemName,
        quantity: entry.sendQty !== undefined ? entry.sendQty : entry.qty,
        warehouse_code: warehouseCode,
        bin_location: entry.bin,
        performed_by: createdBy,
        action: 'count',
        remarks: entry.remark,
        planned_qty: 0,
        transaction_time: entry.addedAt
    };
}

/**
 * 构建盘点明细行 HTML — 纯函数，无 DOM 依赖
 * @param {Array} mergedLines - mergeTransactions 返回的合并行
 * @param {Object} h - { escapeHtml, formatNumber, generateBarcodeUrl, formatDateTime }
 * @returns {string} HTML 行字符串
 */
function buildIcDetailRowsHtml(mergedLines, h) {
    if (!mergedLines || mergedLines.length === 0) return '';
    return mergedLines.map(function (l) {
        return '<tr><td>' + h.escapeHtml(l.item_code) + '</td><td class="line-barcode-col"><img src="' + h.generateBarcodeUrl(l.item_code, 'qrcode') + '"></td><td>' + h.escapeHtml(l.item_name || '-') + '</td><td>' + h.formatNumber(l.actual_qty) + '</td><td>' + h.escapeHtml(l.bin_location || '-') + '</td><td>' + h.formatDateTime(l.updated_at) + '</td></tr>';
    }).join('');
}

/**
 * 构建盘点待提交行 HTML — 纯函数，无 DOM 依赖
 * @param {Array} pendingCounts - 待提交清单
 * @param {Object} h - { escapeHtml, formatNumber, formatDateTime }
 * @returns {string} HTML 行字符串
 */
function buildIcPendingRowsHtml(pendingCounts, h) {
    if (!pendingCounts || pendingCounts.length === 0) return '';
    return pendingCounts.map(function (p, idx) {
        return '<tr><td>' + h.escapeHtml(p.itemCode) + '</td><td>' + h.formatNumber(p.qty) + '</td><td>' + h.escapeHtml(p.bin || '-') + '</td><td>' + h.formatDateTime(p.addedAt) + '</td><td class="no-print"><button class="btn btn-danger btn-sm" onclick="removePendingCount(' + idx + ')" style="padding:2px 8px;font-size:12px;">删</button></td></tr>';
    }).join('');
}

// ============================================================================
// DOM 绑定 — 浏览器环境（依赖 shared.js 全局函数）
// ============================================================================

/* istanbul ignore next */
if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof CONFIG !== 'undefined') {

    var currentDoc = null;
    var pendingCounts = [];
    var _currentStockData = []; // 当前扫描物料的库存原始数据
    var _stockPreviewExpanded = true; // 库存预览是否展开

    function initIC() {
        if (!checkAuth()) return;
        document.getElementById('pageBadge').innerHTML = getDocTypeIcon('IC', 36);
        var savedUser = getLoginUsername() !== 'unknown' ? getLoginUsername() : loadState('last_user');
        if (savedUser) document.getElementById('createUser').value = savedUser;

        loadMasterDataCache();
        initBinAutocomplete('countBin');

        // V19.5: 聚焦链 — countBin → countQty (Enter 键跳转)
        var countBinForFocus = document.getElementById('countBin');
        var countQtyForFocus = document.getElementById('countQty');
        if (countBinForFocus) {
            countBinForFocus.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (countQtyForFocus) { countQtyForFocus.focus(); countQtyForFocus.select(); }
                }
            });
        }

        // blur 校验：仓库/库位输入离焦时验证是否在主数据缓存中
        var createWhsEl = document.getElementById('createWhs');
        var countBinEl = document.getElementById('countBin');
        if (createWhsEl) {
            createWhsEl.addEventListener('blur', async function() {
                var raw = createWhsEl.value.trim();
                if (!raw) return;
                var result = validateWarehouse(raw);
                if (result === null) {
                    await loadMasterDataCache(true);
                    result = validateWarehouse(raw);
                }
                if (result === null) {
                    createWhsEl.style.borderColor = '#f59e0b';
                    return;
                }
                if (result === false) {
                    createWhsEl.style.borderColor = '#ef4444';
                    createWhsEl.value = '';
                    showMessage(t('msg.whs_cleared_not_in_master', '仓库代码 [{0}] 不在主数据中，已清空，请重新输入').replace('{0}', raw), 'error');
                } else {
                    // 自动纠正为字典值 (PG 大小写敏感)
                    createWhsEl.value = result.whs_code;
                    createWhsEl.style.borderColor = '#22c55e';
                }
            });
        }
        if (countBinEl) {
            countBinEl.addEventListener('blur', async function() {
                var raw = countBinEl.value.trim();
                // 库位变化时重新渲染库存预览 (过滤)
                renderStockPreview(_currentStockData, raw);
                if (!raw) return;
                var result = validateBin(raw);
                if (result === null) {
                    await loadMasterDataCache(true);
                    result = validateBin(raw);
                }
                if (result === null) {
                    countBinEl.style.borderColor = '#f59e0b';
                    return;
                }
                if (result === false) {
                    // 标红但不清空 — 用户可能要通过 + 按钮新增此库位
                    countBinEl.style.borderColor = '#ef4444';
                } else {
                    // 自动纠正为字典值 (保证与数据库一致，PG 大小写敏感)
                    countBinEl.value = result.bin_code;
                    countBinEl.style.borderColor = '#22c55e';
                }
            });
        }

        var id = getUrlParam('id');
        if (id) loadCount(id);
    }

    // V18.4: 新增库位到字典
    var addBinToDict = async function(inputId) {
        var el = document.getElementById(inputId);
        var code = el.value.trim().toUpperCase();
        if (!code) { showMessage(t('msg.enter_bin_first', '请先输入库位代码'), 'error'); el.focus(); return; }
        var existing = validateBin(code);
        if (existing && existing !== false) { showMessage(t('msg.bin_already_in_dict', '库位 [{0}] 已在字典中').replace('{0}', code), 'info'); el.style.borderColor = '#22c55e'; return; }
        var whs = '';
        if (currentDoc && currentDoc.document) whs = currentDoc.document.warehouse_code || '';
        if (!confirm(t('confirm.add_bin_to_dict', '添加库位 [{0}] 到字典？').replace('{0}', code))) return;
        try {
            var r = await apiPost('/bin/add', { bin_code: code, whs_code: whs });
            if (r && r.success) {
                try {
                    var raw = localStorage.getItem('wms_masterdata');
                    if (raw) {
                        var cache = JSON.parse(raw);
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
                showMessage(t('msg.bin_added_to_dict', '库位 [{0}] 已添加到字典').replace('{0}', code), 'success');
            } else {
                throw new Error(r && r.message ? r.message : '添加失败');
            }
        } catch (e) { showMessage(t('msg.bin_add_failed', '添加库位失败: {0}').replace('{0}', e.message), 'error'); }
    }

    function showCreateForm() { hide('modeCard'); show('createCard'); }
    function showLoadForm() {
        hide('modeCard'); show('loadCard');
        setupBarcodeInput('loadInput', function (val) {
            playBeepSound(); showBeepIndicator();
            handleSubpageBarcode(val, 'IC', loadCount);
        });
    }
    function backToMode() {
        ['createCard', 'loadCard', 'countCard', 'scanCard', 'pendingCard', 'detailCard', 'actionCard'].forEach(hide);
        show('modeCard'); currentDoc = null; pendingCounts = [];
    }

    var handleCreate = async function(event) {
        event.preventDefault();
        if (_isSubmitting) return;
        var whs = document.getElementById('createWhs').value.trim();
        var user = document.getElementById('createUser').value.trim();
        var remark = document.getElementById('createRemark').value.trim();
        if (!whs || !user) { showMessage(t('msg.fill_whs_and_counter', '请填写仓库和盘点人'), 'error'); return; }

        var whsResult = validateWarehouse(whs);
        if (whsResult === null) { await loadMasterDataCache(true); whsResult = validateWarehouse(whs); }
        if (whsResult === false) {
            document.getElementById('createWhs').value = '';
            document.getElementById('createWhs').style.borderColor = '#ef4444';
            showMessage(t('msg.whs_not_in_master', '仓库代码 [{0}] 不在主数据中，请重新输入').replace('{0}', whs), 'error');
            return;
        }
        if (whsResult && whsResult.whs_code) {
            whs = whsResult.whs_code;
        }

        _isSubmitting = true; showLoading(true);
        try {
            var result = await apiPost('/document/create', {
                doc_type: 'IC', warehouse_code: whs, created_by: user, remarks: remark
            });
            if (!result || !result.success) throw new Error(result && result.message ? result.message : '创建失败');
            showMessage(t('result.ic_doc_created', '盘点单创建成功: {0}').replace('{0}', result.doc_number), 'success');
            saveState('last_user', user);
            hide('createCard');
            loadCount(result.doc_number);
        } catch (e) { showMessage(t('msg.create_failed', '创建失败: {0}').replace('{0}', e.message), 'error'); }
        finally { _isSubmitting = false; showLoading(false); }
    }

    var loadCount = async function(docNumOrId) {
        if (/^\d{8,}$/.test(docNumOrId)) {
            docNumOrId = 'IC' + docNumOrId;
        }
        showLoading(true);
        try {
            var data = await apiGet('/document?id=' + encodeURIComponent(docNumOrId) + '&type=IC');
            if (!data || !data.success) throw new Error(data && data.message ? data.message : '未找到盘点单');
            currentDoc = data;
            renderCount(data);
            notifyDocLoaded((data.document || {}).wms_status || '');
        } catch (e) { showMessage(t('msg.load_failed', '加载失败: {0}').replace('{0}', e.message), 'error'); playErrorSound(); }
        finally { showLoading(false); }
    }

    function renderCount(data) {
        var doc = data.document || {};
        setText('docNum', doc.doc_number || '-');
        // 从缓存补齐仓库名称
        var whsDisplay = doc.warehouse_code || '-';
        if (doc.warehouse_code) {
            var whsInfo = validateWarehouse(doc.warehouse_code);
            if (whsInfo && whsInfo.whs_name) {
                whsDisplay = doc.warehouse_code + ' - ' + whsInfo.whs_name;
            }
        }
        setText('warehouse', whsDisplay);
        setText('countUser', doc.created_by || '-');

        // 调用纯函数合并交易记录
        var merged = mergeTransactions(data.transactions);
        currentDoc._mergedCounts = merged.mergedMap;
        setText('countedItems', formatCountedText(merged.uniqueItemCount, merged.mergedLines.length));

        var tbody = document.getElementById('detailBody');
        if (merged.mergedLines.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data">尚未盘点任何物料</td></tr>';
        } else {
            var detailHelpers = { escapeHtml: escapeHtml, formatNumber: formatNumber, generateBarcodeUrl: generateBarcodeUrl, formatDateTime: formatDateTime };
            tbody.innerHTML = buildIcDetailRowsHtml(merged.mergedLines, detailHelpers);
        }

        var isComplete = doc.wms_status === 'completed' || doc.status === 'completed';
        ['loadCard', 'modeCard'].forEach(hide);
        show('countCard'); show('detailCard'); show('actionCard');

        if (isComplete) {
            document.getElementById('countCard').classList.add('status-closed');
            document.getElementById('detailCard').classList.add('status-closed');
            hide('scanCard'); hide('pendingCard');
            var completeBtn = document.querySelector('button.btn-success');
            if (completeBtn) { completeBtn.disabled = true; completeBtn.textContent = '已完成'; }
        } else {
            document.getElementById('countCard').classList.remove('status-closed');
            document.getElementById('detailCard').classList.remove('status-closed');
            show('scanCard'); show('pendingCard'); renderPendingCounts();
            var completeBtn2 = document.querySelector('button.btn-success');
            if (completeBtn2) { completeBtn2.disabled = false; completeBtn2.textContent = '完成盘点'; }
        }

        setupBarcodeInput('itemScan', function (code) {
            playBeepSound(); showBeepIndicator(); lookupItem(code);
        });

        document.getElementById('printQr').innerHTML = '<img src="' + generateBarcodeUrl('IC' + doc.doc_number, 'qrcode') + '" style="width:80px;height:80px;">';
    }

    var lookupItem = async function(code) {
        // 调用纯函数验证条码格式
        var barcodeCheck = validateItemBarcode(code);
        if (!barcodeCheck.valid) {
            showMessage(escapeHtml(barcodeCheck.error) + '\n请重新扫描单个物料', 'error');
            playErrorSound();
            return;
        }

        var itemCode = code;
        var itemName = '';
        var itemUom = '';

        // 先从缓存或 API 获取物料信息
        var cached = validateItem(code);
        if (cached) {
            itemCode = cached.item_code || code;
            itemName = cached.item_name || '-';
            itemUom = cached.uom || '';
        } else {
            try {
                var data = await apiGet('/item?code=' + encodeURIComponent(code));
                if (data && data.success && data.item) {
                    itemCode = data.item.itemCode || code;
                    itemName = data.item.itemName || '-';
                    itemUom = data.item.uom || data.item.InvntryUom || '';
                } else {
                    setText('scanItemCode', code);
                    setText('scanItemName', '');
                    hide('itemInfo');
                    _currentStockData = [];
                    var itemMsg = (data && data.error_type === 'item_not_cached')
                        ? t('msg.item_not_cached', '物料 {0} 未在缓存中找到，请等待同步').replace('{0}', escapeHtml(code))
                        : t('msg.item_not_in_sap_ic', '物料 {0} 未在SAP中找到，不允许盘点').replace('{0}', escapeHtml(code));
                    showMessage(itemMsg, 'error');
                    playErrorSound();
                    return;
                }
            } catch (e) {
                setText('scanItemCode', code);
                setText('scanItemName', '');
                hide('itemInfo');
                _currentStockData = [];
                showMessage(t('msg.item_query_failed', '物料 {0} 查询失败，请检查网络后重试').replace('{0}', escapeHtml(code)), 'error');
                playErrorSound();
                return;
            }
        }

        setText('scanItemCode', itemCode);
        setText('scanItemName', itemName);
        show('itemInfo');
        document.getElementById('countQty').value = '';
        document.getElementById('countBin').value = '';

        // 查询该物料在当前仓库的库存 (仓库为必传条件，统一大写)
        _currentStockData = [];
        _stockPreviewExpanded = false;
        var whs = (currentDoc && currentDoc.document) ? (currentDoc.document.warehouse_code || '').toUpperCase() : '';
        console.debug('[IC] 库存查询参数: item=' + itemCode + ', whs=' + whs);
        renderStockPreviewLoading();
        try {
            var stockUrl = '/stock?item=' + encodeURIComponent(itemCode);
            if (whs) stockUrl += '&whs=' + encodeURIComponent(whs);
            var stockResult = await apiGet(stockUrl);
            console.debug('[IC] 库存查询结果:', stockResult && stockResult.success ? (stockResult.data || []).length + '行' : '失败', stockResult);
            if (stockResult && stockResult.success && stockResult.data && stockResult.data.length > 0) {
                _currentStockData = stockResult.data;
                // 用物料主数据 uom 补全库存行中缺失的单位
                if (itemUom) {
                    _currentStockData.forEach(function(row) {
                        if (!row.uom) row.uom = itemUom;
                    });
                }
            }
        } catch (e) {
            console.debug('[IC] 库存查询异常:', e.message);
            // 库存查询失败不阻断盘点流程
        }
        renderStockPreview(_currentStockData, '');

        suppressScanFocus(500);
        setTimeout(function() { document.getElementById('countBin').focus(); }, 100);
    }

    function renderStockPreviewLoading() {
        var body = document.getElementById('icStockBody');
        var tog = document.getElementById('icToggle');
        if (body) body.innerHTML = '<div class="ic-stock-empty" style="color:#6366f1;">正在查询库存...</div>';
        if (tog) tog.textContent = '';
    }

    /**
     * 渲染库存预览: 汇总行 + 明细行 (可折叠)
     * 列: 物料 | 名称 | 仓库 | 库位 | 批次 | SAP快照 | WMS变动 | 实时库存 | 单位
     */
    function renderStockPreview(stockData, binFilter) {
        var body = document.getElementById('icStockBody');
        var tog = document.getElementById('icToggle');
        if (!body) return;

        var filtered = filterStockByBin(stockData, binFilter);
        var summary = summarizeStock(filtered);

        // 无数据 — 显示醒目警告
        if (!stockData || stockData.length === 0) {
            body.innerHTML = '<div class="ic-stock-empty" style="color:#dc2626;font-weight:600;background:#fef2f2;padding:14px;border-radius:6px;">⚠ 该物料系统库存为 0，盘点需特别小心！<br><span style="font-weight:400;font-size:0.78rem;color:#6b7280;">快照未同步或确实无库存，请核实实物后再录入差异</span></div>';
            if (tog) tog.textContent = '';
            return;
        }
        if (filtered.length === 0) {
            body.innerHTML = '<div class="ic-stock-empty" style="color:#dc2626;font-weight:600;background:#fef2f2;padding:14px;border-radius:6px;">⚠ 当前库位无该物料库存，盘点需特别小心！</div>';
            if (tog) tog.textContent = '';
            return;
        }

        var hasMulti = filtered.length > 1;
        // 默认折叠: + 表示可展开, ➖ 表示已展开; 单行无图标
        if (tog) tog.textContent = hasMulti ? (_stockPreviewExpanded ? '\u2796' : '+') : '';

        var itemCode = document.getElementById('scanItemCode').textContent || '';
        var itemName = document.getElementById('scanItemName').textContent || '';

        // delta 样式
        function dc(v) { return v > 0 ? 'dp' : (v < 0 ? 'dn' : 'dz'); }
        function ds(v) { return (v > 0 ? '+' : '') + formatNumber(v); }

        // 紧凑列: 库位|批次 合并, 手机友好
        var h = '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;"><table>' +
            '<colgroup><col class="c-item"><col class="c-bin"><col class="c-batch">' +
            '<col class="c-num"><col class="c-num"><col class="c-num"><col class="c-uom"></colgroup>' +
            '<thead><tr><th>物料</th><th>库位</th><th>批次</th>' +
            '<th class="r">快照</th><th class="r">变动</th><th class="r">实时</th><th>单位</th></tr></thead><tbody>';

        // 汇总行 (始终可见)
        var sd = summary.delta_qty;
        h += '<tr class="sum">' +
            '<td>' + escapeHtml(itemCode) + '<br><span style="font-weight:400;color:#64748b;font-size:0.72rem;">' + escapeHtml(itemName) + '</span></td>' +
            '<td>' + (hasMulti ? '<span style="color:#6366f1;">(' + filtered.length + '行)</span>' : escapeHtml(filtered[0].bin_code || filtered[0].bins || '-')) + '</td>' +
            '<td>' + (hasMulti ? '' : escapeHtml(filtered[0].batch_number || filtered[0].batches || '')) + '</td>' +
            '<td class="r">' + formatNumber(summary.base_qty) + '</td>' +
            '<td class="r ' + dc(sd) + '">' + ds(sd) + '</td>' +
            '<td class="r rt">' + formatNumber(summary.real_time_qty) + '</td>' +
            '<td>' + escapeHtml(filtered[0].uom || '') + '</td></tr>';

        // 明细行 (默认折叠隐藏)
        if (hasMulti) {
            var disp = _stockPreviewExpanded ? '' : 'display:none;';
            filtered.forEach(function(row) {
                var rd = Number(row.delta_qty) || 0;
                h += '<tr class="det ic-det" style="' + disp + '">' +
                    '<td>' + escapeHtml(row.item_code || '') + '</td>' +
                    '<td>' + escapeHtml(row.bin_code || row.bins || '-') + '</td>' +
                    '<td>' + escapeHtml(row.batch_number || row.batches || '') + '</td>' +
                    '<td class="r">' + formatNumber(row.base_qty) + '</td>' +
                    '<td class="r ' + dc(rd) + '">' + ds(rd) + '</td>' +
                    '<td class="r" style="color:#1e40af;font-weight:600;">' + formatNumber(row.real_time_qty) + '</td>' +
                    '<td>' + escapeHtml(row.uom || '') + '</td></tr>';
            });
        }

        h += '</tbody></table></div>';
        body.innerHTML = h;
    }

    function toggleStockDetail() {
        _stockPreviewExpanded = !_stockPreviewExpanded;
        var tog = document.getElementById('icToggle');
        if (tog) tog.textContent = _stockPreviewExpanded ? '\u2796' : '+';
        var rows = document.querySelectorAll('.ic-det');
        rows.forEach(function(el) { el.style.display = _stockPreviewExpanded ? '' : 'none'; });
    }

    function skipItem() {
        showMessage(t('msg.stock_consistent_skip', '库存一致，跳过'), 'info');
        hide('itemInfo');
        _currentStockData = [];
        document.getElementById('countQty').value = '';
        document.getElementById('countBin').value = '';
        document.getElementById('countRemark').value = '';
        setText('scanItemCode', '-'); setText('scanItemName', '-');
        document.getElementById('itemScan').value = '';
        document.getElementById('itemScan').focus();
    }

    var handleCount = async function(event) {
        event.preventDefault();
        var itemCode = document.getElementById('scanItemCode').textContent;
        var itemName = document.getElementById('scanItemName').textContent;
        var qty = parseFloat(document.getElementById('countQty').value);
        var bin = document.getElementById('countBin').value.trim();
        var remark = document.getElementById('countRemark').value.trim();

        if (isNaN(qty)) { showMessage(t('msg.enter_valid_qty', '请输入有效数量'), 'error'); return; }

        // V17.1: 提交前校验库位 (自动纠正为字典值，PG 大小写敏感)
        if (bin) {
            var binResult = validateBin(bin);
            if (binResult === null) { await loadMasterDataCache(true); binResult = validateBin(bin); }
            if (binResult === false) {
                document.getElementById('countBin').value = '';
                document.getElementById('countBin').style.borderColor = '#ef4444';
                showMessage(t('msg.bin_not_in_master', '库位代码 [{0}] 不在主数据中，请重新输入').replace('{0}', bin), 'error');
                return;
            }
            if (binResult === null) {
                showMessage(t('msg.bin_dict_not_loaded', '库位字典未加载，无法校验库位 [{0}]，请刷新页面').replace('{0}', bin), 'error');
                return;
            }
            // 纠正为字典实际值
            bin = binResult.bin_code;
        }

        // 调用纯函数准备待提交条目
        var mergedCounts = (currentDoc && currentDoc._mergedCounts) || {};
        var decision = preparePendingEntry(pendingCounts, mergedCounts, itemCode, itemName, qty, bin, remark, getSystemDateTime());

        if (decision.action === 'skip') {
            showMessage(decision.message, 'info');
            return;
        }
        if (decision.needConfirm && !confirm(decision.confirmMsg)) return;

        if (decision.action === 'update') {
            pendingCounts[decision.pendingIdx].qty = decision.updates.qty;
            pendingCounts[decision.pendingIdx].remark = decision.updates.remark;
            pendingCounts[decision.pendingIdx].addedAt = decision.updates.addedAt;
        } else {
            pendingCounts.push(decision.entry);
        }

        renderPendingCounts();
        showMessage(t('result.ic_line_added', '已添加: {0} x {1}').replace('{0}', itemCode).replace('{1}', formatNumber(qty) + (bin ? ' @ ' + bin : '')), 'success');
        playSuccessSound();

        hide('itemInfo');
        _currentStockData = [];
        document.getElementById('countQty').value = '';
        document.getElementById('countBin').value = '';
        document.getElementById('countRemark').value = '';
        setText('scanItemCode', '-'); setText('scanItemName', '-');
        document.getElementById('itemScan').value = '';
        document.getElementById('itemScan').focus();
    }

    function renderPendingCounts() {
        var tbody = document.getElementById('pendingBody');
        var countEl = document.getElementById('pendingCount');
        if (!pendingCounts.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="no-data">' + t('msg.no_pending', '暂无待提交记录') + '</td></tr>';
            countEl.textContent = '(0)';
            return;
        }
        countEl.textContent = '(' + pendingCounts.length + ')';
        var pendingHelpers = { escapeHtml: escapeHtml, formatNumber: formatNumber, formatDateTime: formatDateTime };
        tbody.innerHTML = buildIcPendingRowsHtml(pendingCounts, pendingHelpers);
    }

    function removePendingCount(idx) {
        var p = pendingCounts[idx];
        if (p && confirm(t('confirm.delete_item', '删除: {0}?').replace('{0}', p.itemCode + (p.bin ? ' @ ' + p.bin : '')))) {
            pendingCounts.splice(idx, 1);
            renderPendingCounts();
        }
    }

    function clearPending() {
        if (!pendingCounts.length) return;
        if (!confirm(t('confirm.clear_pending', '确定清空所有待提交记录 ({0} 行)?').replace('{0}', pendingCounts.length))) return;
        pendingCounts = [];
        renderPendingCounts();
    }

    var submitAllCounts = async function() {
        if (!pendingCounts.length) { showMessage(t('msg.empty_pending', '暂存清单为空，请先添加记录'), 'error'); return; }
        if (!currentDoc || _isSubmitting) return;
        var doc = currentDoc.document || {};
        if (!confirm(t('confirm.submit_rows', '确认提交 {0} 行{1}记录?').replace('{0}', pendingCounts.length).replace('{1}', t('ic.title_short', '盘点')))) return;

        _isSubmitting = true; showLoading(true);
        var successCount = 0, errors = [], succeeded = [];
        try {
            for (var i = 0; i < pendingCounts.length; i++) {
                var p = pendingCounts[i];
                try {
                    // 调用纯函数构建 payload
                    var payload = buildCountPayload(doc.doc_number, doc.warehouse_code, doc.created_by, p);
                    var result = await apiPost('/transaction', payload);
                    if (!result || !result.success) throw new Error(result && result.message ? result.message : t('result.submit_failed', '提交失败'));
                    successCount++;
                    succeeded.push(i);
                } catch (e) { errors.push(p.itemCode + ': ' + e.message); }
            }
            for (var j = succeeded.length - 1; j >= 0; j--) {
                pendingCounts.splice(succeeded[j], 1);
            }
            renderPendingCounts();
            if (errors.length === 0) {
                showMessage(t('result.submit_all_ok', '全部提交成功: {0} 行').replace('{0}', successCount), 'success'); playSuccessSound();
            } else {
                showMessage(t('result.submit_partial', '提交完成: {0} 成功, {1} 失败').replace('{0}', successCount).replace('{1}', errors.length) + '\n' + errors.join('\n'), 'error'); playErrorSound();
            }
            loadCount(doc.doc_number);
        } catch (e) { showMessage(t('result.submit_error', '提交异常') + ': ' + e.message, 'error'); playErrorSound(); }
        finally { _isSubmitting = false; showLoading(false); }
    }

    var completeCount = async function() {
        if (!currentDoc || _isSubmitting) return;
        var doc = currentDoc.document || {};

        var completeBtn = document.querySelector('button.btn-success');

        if (pendingCounts.length > 0) {
            if (!confirm(t('confirm.pending_then_complete', '有 {0} 行待提交记录，将先提交后完成{1} {2}。继续？').replace('{0}', pendingCounts.length).replace('{1}', t('ic.title_short', '盘点') + t('common.doc', '单')).replace('{2}', doc.doc_number))) return;
            if (completeBtn) { completeBtn.disabled = true; completeBtn.textContent = t('label.processing', '处理中...'); }
            showLoading(true);
            var errors = [];
            var succeeded = [];
            for (var i = 0; i < pendingCounts.length; i++) {
                var p = pendingCounts[i];
                try {
                    // 调用纯函数构建 payload
                    var payload = buildCountPayload(doc.doc_number, doc.warehouse_code, doc.created_by, p);
                    var r = await apiPost('/transaction', payload);
                    if (!r || !r.success) throw new Error(r && r.message ? r.message : t('result.submit_failed', '提交失败'));
                    succeeded.push(i);
                } catch (e) { errors.push(p.itemCode + ': ' + e.message); }
            }
            for (var j = succeeded.length - 1; j >= 0; j--) { pendingCounts.splice(succeeded[j], 1); }
            renderPendingCounts();
            if (errors.length > 0) {
                showMessage(t('result.partial_failed', '部分提交失败 ({0} 行)').replace('{0}', errors.length) + ':\n' + errors.join('\n'), 'error');
                playErrorSound(); showLoading(false);
                if (completeBtn) { completeBtn.disabled = false; completeBtn.textContent = t('ic.complete', '完成盘点'); }
                return;
            }
        } else {
            if (!confirm(t('confirm.complete_no_more', '确认完成{0} {1}? 完成后不可再添加记录。').replace('{0}', t('ic.title_short', '盘点') + t('common.doc', '单')).replace('{1}', doc.doc_number))) return;
            if (completeBtn) { completeBtn.disabled = true; completeBtn.textContent = t('label.processing', '处理中...'); }
            showLoading(true);
        }

        try {
            var result = await apiPost('/document/complete', { doc_number: doc.doc_number, doc_type: 'IC' });
            if (!result || !result.success) throw new Error(result && result.message ? result.message : t('common.failed', '操作失败'));
            showMessage(t('result.doc_completed', '{0}已完成').replace('{0}', t('ic.title_short', '盘点') + t('common.doc', '单')), 'success'); playSuccessSound();
            loadCount(doc.doc_number);
        } catch (e) {
            showMessage(t('common.failed', '操作失败') + ': ' + e.message, 'error');
            if (completeBtn) { completeBtn.disabled = false; completeBtn.textContent = t('ic.complete', '完成盘点'); }
        }
        finally { showLoading(false); }
    }

    function setText(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }
    function show(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); }
    function hide(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); }

    // var 声明的 async 函数需显式挂到 window，确保 HTML onclick/onsubmit 可访问
    window.addBinToDict = addBinToDict;
    window.handleCreate = handleCreate;
    window.handleCount = handleCount;
    window.submitAllCounts = submitAllCounts;
    window.completeCount = completeCount;

    document.getElementById('printTime').textContent = new Date().toLocaleString('zh-CN', { timeZone: CONFIG.timezone });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initIC);
    else initIC();
}

// ============================================================================
// 兼容性导出 — Jest 单元测试引用（不影响浏览器环境）
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        mergeTransactions: mergeTransactions,
        formatCountedText: formatCountedText,
        validateItemBarcode: validateItemBarcode,
        findPendingIndex: findPendingIndex,
        preparePendingEntry: preparePendingEntry,
        buildCountPayload: buildCountPayload,
        filterStockByBin: filterStockByBin,
        summarizeStock: summarizeStock,
        buildIcDetailRowsHtml: buildIcDetailRowsHtml,
        buildIcPendingRowsHtml: buildIcPendingRowsHtml
    };
}
