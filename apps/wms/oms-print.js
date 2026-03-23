/**
 * OMS 打印服务
 * exports: OmsPrint (printBarcodes, printOrders, isLocked)
 * requires: shared.js (escapeHtml, generateBarcodeUrl)
 */
/* global checkDep, escapeHtml, OmsPrint */
if (typeof checkDep === 'function') {
    checkDep('shared.js', typeof escapeHtml !== 'undefined' ? escapeHtml : undefined);
}

window.OmsPrint = (function() {
    'use strict';

    // --- CSS 常量 (冻结防篡改) ---
    var STYLES = Object.freeze({
        barcode: 'body{font-family:Arial;padding:4px;margin:0;font-size:12px;}' +
            '.items{display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-start;align-content:flex-start;}' +
            '.item-card{border:1px solid #ccc;padding:3px;text-align:center;width:calc(16.66% - 4px);min-width:85px;box-sizing:border-box;page-break-inside:avoid;}' +
            '.item-card img{width:76px;height:76px;}' +
            '.item-code{font-size:9px;word-break:break-all;font-weight:bold;margin-top:1px;}' +
            '.item-name{font-size:7px;color:#666;white-space:normal;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.2em;}' +
            '@media print{button{display:none;}@page{margin:3mm;}}',
        order: 'body{font-family:Arial,sans-serif;padding:10px;font-size:12px;}' +
            '.order-block{page-break-after:always;margin-bottom:20px;}' +
            '.order-block:last-child{page-break-after:auto;}' +
            '.order-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px;border-bottom:2px solid #333;padding-bottom:8px;}' +
            '.order-qr{width:80px;height:80px;margin-left:auto;}' +
            '.order-info{flex:1;}' +
            '.order-info h2{margin:0 0 4px;font-size:1.1rem;}' +
            '.order-meta{font-size:0.8rem;color:#555;}' +
            '.order-meta td{padding:2px 12px 2px 0;}' +
            '.lines-table{width:100%;border-collapse:collapse;font-size:0.75rem;margin-top:6px;}' +
            '.lines-table th{background:#f0f0f0;padding:4px 6px;border:1px solid #ccc;text-align:left;font-size:0.7rem;}' +
            '.lines-table td{padding:3px 6px;border:1px solid #ddd;}' +
            '.lines-table .bc-cell img{width:1.5cm;height:1.5cm;}' +
            '.item-name-cell{word-break:break-all;}' +
            '.wo-cards{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px;}' +
            '.wo-card{border:1px solid #ccc;padding:3px;text-align:center;width:calc(16.66% - 4px);min-width:85px;box-sizing:border-box;page-break-inside:avoid;}' +
            '.wo-card img{width:1.5cm;height:1.5cm;}' +
            '.wo-num{font-size:9px;font-weight:bold;margin-top:1px;}' +
            '.wo-item{font-size:8px;color:#333;word-break:break-all;}' +
            '.wo-wh{font-size:8px;color:#666;}' +
            '.wo-sep{border-top:2px solid #333;margin:6px 0;}' +
            '.wo-tbl{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:4px;}' +
            '.wo-tbl th,.wo-tbl td{border:1px solid #ddd;padding:2px 4px;text-align:left;}' +
            '.wo-tbl th{background:#f5f5f5;font-weight:bold;}' +
            '.wo-tbl img{width:1.5cm;height:1.5cm;}.num{text-align:right;}' +
            '@page{margin:5mm;}@media print{body{margin:0;}button{display:none;}}'
    });

    // --- HTML 构建原语 (attrs 转义防 XSS) ---
    function escAttr(s) {
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    }

    function tag(name, content, attrs) {
        var a = '';
        if (attrs) {
            Object.keys(attrs).forEach(function(k) {
                a += ' ' + k + '="' + escAttr(attrs[k]) + '"';
            });
        }
        return '<' + name + a + '>' + (content || '') + '</' + name + '>';
    }
    function td(content, attrs) { return tag('td', content, attrs); }
    function th(content, attrs) { return tag('th', content, attrs); }
    function tr(cells) { return tag('tr', cells.join('')); }
    function table(head, bodyRows) {
        return '<table class="lines-table"><thead>' + head + '</thead><tbody>' + bodyRows.join('') + '</tbody></table>';
    }

    // --- Core logic ---
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
                    cache[item.item_code] = _generateBarcodeUrl(item.item_code, type);
                }
            });
            await new Promise(function(r) { setTimeout(r, 16); });
        }
    }

    // 内部引用: 由 printBarcodes/printOrders 的 deps 注入
    var _generateBarcodeUrl = null;

    // 打印物料条码 (去重+排序)
    async function printBarcodes(selected, deps) {
        console.debug('[PrintBarcodes] selected:', selected.length, 'printLock:', _printLock);
        if (_printLock) return;
        _printLock = true;
        _generateBarcodeUrl = deps.generateBarcodeUrl;
        var newWin = null;
        try {
            if (selected.length === 0) {
                deps.showMessage(deps.t('oms.no_selection', '请先选择订单'), 'warning');
                return;
            }
            if (selected.length > 50) {
                deps.showMessage(deps.t('msg.max_batch_print_50', '最多批量打印 50 个订单'), 'warning');
                return;
            }

            // 同步打开窗口 (在 await 之前)
            newWin = window.open('', '_blank');
            if (!newWin) {
                deps.showMessage(deps.t('msg.popup_blocked', '浏览器拦截了打印窗口。请在地址栏右侧点击"弹窗被拦截"图标，允许本网站弹窗后重试'), 'error');
                return;
            }
            newWin.document.write('<html><body><p style="padding:20px;font-size:18px">' + deps.t('common.loading', '加载中...') + '</p></body></html>');
            newWin.document.close();

            // 批量加载行数据
            deps.showLoading(true);
            await deps.ensureOrderLines(selected);
            deps.showLoading(false);

            // 检查加载失败
            var failed = selected.filter(function(o) { return o._loadError; });
            if (failed.length > 0) {
                safeClose(newWin);
                deps.showMessage(failed.length + ' 个订单数据加载失败，请重试', 'error');
                return;
            }

            // 合并所有行 → 提取 item_code + item_name → Map 去重 → 排序
            var totalLines = selected.reduce(function(sum, o) { return sum + (o.lines ? o.lines.length : 0); }, 0);
            if (totalLines > 5000) {
                safeClose(newWin);
                deps.showMessage(deps.t('msg.too_many_lines', '物料行数过多 ({0})，请减少选择的订单数量').replace('{0}', totalLines), 'warning');
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
                deps.showMessage(deps.t('oms.no_lines', '该订单没有行项目'), 'warning');
                return;
            }

            // 生成 QR 码
            var barcodeCache = Object.create(null);
            await generateBarcodesInChunks(allItems, barcodeCache, 50, 'qrcode');

            var html = '<!DOCTYPE html><html><head><title>' + deps.t('oms.print_barcode', '打印条码') + '</title>' +
                '<style>' + STYLES.barcode + '</style></head><body>';

            html += '<div class="items">';
            allItems.forEach(function(item) {
                html += '<div class="item-card"><img src="' + (barcodeCache[item.item_code] || '') + '"><div class="item-code">' + deps.escapeHtml(item.item_code) + '</div><div class="item-name">' + deps.escapeHtml(item.item_name || '') + '</div></div>';
            });
            html += '</div>';

            html += '<br><button onclick="window.print()">打印</button></body></html>';

            newWin.document.open();
            newWin.document.write(html);
            newWin.document.close();

        } catch(e) {
            console.error('打印条码异常:', e);
            deps.showMessage(deps.t('msg.print_failed', '打印失败: {0}').replace('{0}', e.message), 'error');
            safeClose(newWin);
        } finally {
            _printLock = false;
            deps.showLoading(false);
        }
    }

    // 打印订单 (WMS 标准格式)
    async function printOrders(selected, deps) {
        if (_printLock) return;
        _printLock = true;
        _generateBarcodeUrl = deps.generateBarcodeUrl;
        var newWin = null;
        try {
            if (selected.length === 0) {
                deps.showMessage(deps.t('oms.no_selection', '请先选择订单'), 'warning');
                return;
            }
            if (selected.length > 50) {
                deps.showMessage(deps.t('msg.max_batch_print_50', '最多批量打印 50 个订单'), 'warning');
                return;
            }

            // 同步打开窗口
            newWin = window.open('', '_blank');
            if (!newWin) {
                deps.showMessage(deps.t('msg.popup_blocked', '浏览器拦截了打印窗口。请在地址栏右侧点击"弹窗被拦截"图标，允许本网站弹窗后重试'), 'error');
                return;
            }
            newWin.document.write('<html><body><p style="padding:20px;font-size:18px">' + deps.t('common.loading', '加载中...') + '</p></body></html>');
            newWin.document.close();

            // 批量加载行数据
            deps.showLoading(true);
            await deps.ensureOrderLines(selected);
            deps.showLoading(false);

            // 检查加载失败
            var failed = selected.filter(function(o) { return o._loadError; });
            if (failed.length > 0) {
                safeClose(newWin);
                deps.showMessage(failed.length + ' 个订单数据加载失败，请重试', 'error');
                return;
            }

            var totalLines = selected.reduce(function(sum, o) { return sum + (o.lines ? o.lines.length : 0); }, 0);
            if (totalLines > 5000) {
                safeClose(newWin);
                deps.showMessage(deps.t('msg.too_many_lines', '物料行数过多 ({0})，请减少选择的订单数量').replace('{0}', totalLines), 'warning');
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
                    qrCache[key] = deps.generateBarcodeUrl(key, 'qrcode');
                }
            });

            // 拼接纯静态 HTML
            var html = '<!DOCTYPE html><html><head><title>' + deps.t('oms.print_order', '打印订单') + '</title>';
            html += '<style>' + STYLES.order + '</style></head><body>';

            // === 非 WO 订单: 标准格式 (分页) ===
            nonWoOrders.forEach(function(o, idx) {
                var docNum = (o.doc_type === 'DD') ? (o.doc_number || o.sap_doc_num || '-') : (o.sap_doc_num || o.doc_number || '-');
                var lines = o.lines || [];

                html += '<div class="order-header">';
                html += '<div class="order-info">';
                html += '<h2>' + deps.escapeHtml(o.doc_type) + ' #' + deps.escapeHtml(docNum) + '</h2>';
                html += '<table class="order-meta"><tr>';
                html += '<td><strong>' + deps.t('oms.search_bp', '客商') + ':</strong> ' + deps.escapeHtml(o.bp_name || o.business_partner || '-') + '</td>';
                html += '<td><strong>' + deps.t('oms.search_date_from', '日期') + ':</strong> ' + deps.formatDate(o.doc_date) + '</td>';
                html += '<td><strong>' + deps.t('oms.col_status', '状态') + ':</strong> ' + deps.getOmsStatusLabel(o.oms_status) + (o.is_split && o.oms_status === 'split' ? ' ⚠' : '') + '</td>';
                html += '</tr><tr>';
                html += '<td><strong>' + deps.t('oms.due_date', '交期') + ':</strong> ' + deps.formatDate(o.due_date) + '</td>';
                if (o.container_no) {
                    html += '<td><strong>' + deps.t('oms.col_container', '柜号') + ':</strong> ' + deps.escapeHtml(o.container_no) + '</td>';
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
                    html += '<th>#</th><th>' + deps.t('oms.print_barcode', '条码') + '</th>';
                    html += '<th>' + deps.t('oms.item_code', '物料编码') + '</th>';
                    html += '<th>' + deps.t('oms.item_name', '物料名称') + '</th>';
                    if (isDDPrint) {
                        html += '<th style="text-align:left;font-size:0.65rem;">原单</th>';
                        html += '<th style="text-align:right;font-size:0.65rem;">原单数</th>';
                    }
                    html += '<th style="text-align:right;">' + deps.t('oms.qty', '数量') + '</th>';
                    html += '<th>' + deps.t('oms.warehouse', '仓库') + '</th>';
                    html += '</tr></thead><tbody>';
                    lines.forEach(function(ln) {
                        html += '<tr>';
                        html += '<td>' + ln.line_num + '</td>';
                        html += '<td class="bc-cell"><img src="' + (barcodeCache[ln.item_code] || '') + '"></td>';
                        html += '<td>' + deps.escapeHtml(ln.item_code || '') + '</td>';
                        html += '<td><div class="item-name-cell">' + deps.escapeHtml(ln.item_name || '') + '</div></td>';
                        if (isDDPrint) {
                            var srcRef = '';
                            if (ln.source_doc_number) {
                                srcRef = ln.source_doc_number;
                                if (ln.source_line_num != null) srcRef += ' L' + ln.source_line_num;
                            }
                            html += '<td style="font-size:0.65rem;">' + deps.escapeHtml(srcRef) + '</td>';
                            html += '<td style="text-align:right;color:#999;">' + (ln.source_planned_qty != null ? Number(ln.source_planned_qty).toLocaleString() : '-') + '</td>';
                        }
                        html += '<td style="text-align:right;">' + Number(ln.planned_qty || ln.quantity || 0).toLocaleString() + '</td>';
                        html += '<td>' + deps.escapeHtml(ln.warehouse_code || '') + '</td>';
                        html += '</tr>';
                    });
                    html += '</tbody></table>';
                } else {
                    html += '<p style="color:#c00;font-size:0.8rem;">⚠ ' + deps.t('oms.no_lines', '该订单没有行项目') + '</p>';
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
                    html += '<div class="wo-num">' + deps.escapeHtml(docNum) + '</div>';
                    html += '<div class="wo-item">' + deps.escapeHtml(wo.item_code || '-') + '</div>';
                    html += '<div class="wo-wh">' + deps.escapeHtml(wo.warehouse_code || '-') + ' ' + deps.formatNumber(wo.total_planned_qty || 0) + '</div>';
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
                    html += '<table class="wo-tbl"><thead><tr><th>#</th><th>QR</th><th>' + deps.t('oms.col_item_code', '物料号') + '</th><th>' + deps.t('field.item_name', '名称') + '</th><th>' + deps.t('field.planned_qty', '计划数') + '</th><th>' + deps.t('oms.issued_qty', '已发数量') + '</th><th>' + deps.t('field.warehouse', '仓库') + '</th></tr></thead><tbody>';
                    mergedRows.forEach(function(s, idx) {
                        html += '<tr><td>' + (idx + 1) + '</td>' +
                            '<td>' + (s.item_code && barcodeCache[s.item_code] ? '<img src="' + barcodeCache[s.item_code] + '">' : '') + '</td>' +
                            '<td>' + deps.escapeHtml(s.item_code) + '</td><td>' + deps.escapeHtml(s.item_name) + '</td>' +
                            '<td class="num">' + deps.formatNumber(s.planned) + '</td>' +
                            '<td class="num">' + deps.formatNumber(s.issued) + '</td>' +
                            '<td>' + deps.escapeHtml(s.warehouse_code || '-') + '</td></tr>';
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
            deps.showMessage(deps.t('msg.print_failed', '打印失败: {0}').replace('{0}', e.message), 'error');
            safeClose(newWin);
        } finally {
            _printLock = false;
            deps.showLoading(false);
        }
    }

    return Object.freeze({
        printBarcodes: printBarcodes,
        printOrders: printOrders,
        isLocked: function() { return _printLock; },
        _escAttr: escAttr, _tag: tag, _td: td, _th: th, _tr: tr, _table: table,
        _STYLES: STYLES
    });
})();

var _omsPrintExport = (typeof OmsPrint !== 'undefined') ? OmsPrint : {};
if (typeof module !== 'undefined' && module.exports) {
    module.exports = _omsPrintExport;
}
