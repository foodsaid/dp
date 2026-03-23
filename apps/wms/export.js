/**
 * WMS 数据导出页 (export.html) 业务逻辑
 * 从 export.html 内联 <script> 中抽离，纯函数 + DOM 绑定分层
 */

// ============================================================================
// 纯函数 — 数据处理（无 DOM 依赖，可单元测试）
// ============================================================================

/**
 * 格式化 ISO 日期 (YYYY-MM-DD)
 * @param {Date} date - 日期对象
 * @param {string} timezone - 时区
 * @returns {string}
 */
function formatISODate(date, timezone) {
    return date.toLocaleDateString('sv-SE', { timeZone: timezone });
}

/**
 * 计算默认日期范围 (最近7天)
 * @param {string} todayStr - 今天日期字符串 (YYYY-MM-DD)
 * @returns {{ dateFrom: string, dateTo: string }}
 */
function calcDefaultDateRange(todayStr) {
    var weekAgo = new Date(todayStr + 'T00:00:00');
    weekAgo.setDate(weekAgo.getDate() - 7);
    var y = weekAgo.getFullYear();
    var m = String(weekAgo.getMonth() + 1).padStart(2, '0');
    var d = String(weekAgo.getDate()).padStart(2, '0');
    return { dateFrom: y + '-' + m + '-' + d, dateTo: todayStr };
}

/**
 * 构建查询参数字符串
 * @param {Object} filters - { type, status, dateFrom, dateTo }
 * @returns {string}
 */
function buildExportQueryParams(filters) {
    var params = '?';
    if (filters.type) params += 'type=' + filters.type + '&';
    if (filters.status) params += 'status=' + filters.status + '&';
    if (filters.dateFrom) params += 'date_from=' + filters.dateFrom + '&';
    if (filters.dateTo) params += 'date_to=' + filters.dateTo + '&';
    return params;
}

/**
 * 按类型统计文档
 * @param {Array} documents - 文档列表
 * @returns {Object} { type: { count, qty } }
 */
function calcDocStats(documents) {
    var stats = {};
    (documents || []).forEach(function(d) {
        var type = d.doc_type || '?';
        if (!stats[type]) stats[type] = { count: 0, qty: 0 };
        stats[type].count++;
        stats[type].qty += (d.total_qty || d.total_actual || 0);
    });
    return stats;
}

/**
 * 从选中集合或全部文档中获取 ID 列表
 * @param {Set} selectedIds - 已选中的 ID 集合
 * @param {Array} documents - 全部文档列表
 * @returns {Array<number>}
 */
function getSelectedOrAllIds(selectedIds, documents) {
    if (selectedIds && selectedIds.size > 0) return Array.from(selectedIds);
    return (documents || []).map(function(d) { return d.id; });
}

/**
 * 构建 CSV 导出文件名
 * @param {string} type - 文档类型
 * @param {string} statusLabel - 状态标签
 * @param {Date} now - 当前时间
 * @param {string} timezone - 时区
 * @returns {string}
 */
function buildExportFilename(type, statusLabel, now, timezone) {
    var hms = ('0' + now.getHours()).slice(-2) + ('0' + now.getMinutes()).slice(-2) + ('0' + now.getSeconds()).slice(-2);
    var dateStr = formatISODate(now, timezone).replace(/-/g, '');
    return 'WMS_' + type + '_' + statusLabel + '_' + dateStr + '_' + hms + '.csv';
}

/**
 * 确保 CSV 文本有 BOM 头 (Excel 需要 BOM 才能正确识别 UTF-8)
 * @param {string} csvText - CSV 文本
 * @returns {string}
 */
function ensureBom(csvText) {
    if (csvText.charCodeAt(0) !== 0xFEFF) {
        return '\uFEFF' + csvText;
    }
    return csvText;
}

/**
 * 构建导出 URL
 * @param {string} type - 文档类型
 * @param {Array<number>} ids - 文档 ID 列表
 * @returns {string}
 */
function buildExportUrl(type, ids) {
    return '/export?type=' + encodeURIComponent(type) + '&ids=' + ids.join(',');
}

// ============================================================================
// DOM 绑定 — 浏览器环境（依赖 shared.js 全局函数）
// ============================================================================

/* istanbul ignore next */
if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof CONFIG !== 'undefined') {

    var documents = [];
    var selectedIds = new Set();

    function initExport() {
        if (!checkAuth()) return;
        var todayStr = getSystemToday();
        var range = calcDefaultDateRange(todayStr);
        document.getElementById('filterDateTo').value = range.dateTo;
        document.getElementById('filterDateFrom').value = range.dateFrom;

        loadDocuments();
    }

    window.loadDocuments = loadDocuments;
    window.exportCSV = exportCSV;
    window.markExported = markExported;
    window.toggleAll = toggleAll;
    window.toggleSelect = toggleSelect;

    async function loadDocuments() {
        showLoading(true);
        try {
            var filters = {
                type: document.getElementById('filterType').value,
                status: document.getElementById('filterStatus').value,
                dateFrom: document.getElementById('filterDateFrom').value,
                dateTo: document.getElementById('filterDateTo').value
            };
            var params = buildExportQueryParams(filters);

            var data = await apiGet('/documents' + params);
            if (!data || !data.success) throw new Error(data && data.message ? data.message : '查询失败');

            documents = data.documents || [];
            selectedIds.clear();
            renderDocuments();
            renderStats();
        } catch (e) {
            showMessage(t('msg.query_failed', '查询失败: {0}').replace('{0}', e.message), 'error');
            documents = [];
            renderDocuments();
        } finally {
            showLoading(false);
        }
    }

    function renderDocuments() {
        var tbody = document.getElementById('resultBody');
        setText('resultCount', documents.length);

        if (documents.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="no-data">' + t('export.no_match', '无匹配数据') + '</td></tr>';
            return;
        }

        tbody.innerHTML = documents.map(function(d) {
            return '<tr>' +
                '<td><input type="checkbox" class="doc-check" value="' + d.id + '" onchange="toggleSelect(' + d.id + ')"></td>' +
                '<td><span class="badge badge-' + (d.doc_type === 'WO' ? 'in_progress' : 'draft') + '">' + getDocTypeLabel(d.doc_type) + '</span></td>' +
                '<td>' + escapeHtml(d.doc_number) + '</td>' +
                '<td>' + escapeHtml(d.sap_doc_num || '-') + '</td>' +
                '<td>' + escapeHtml(d.warehouse_code || '-') + '</td>' +
                '<td>' + (d.line_count || 0) + '</td>' +
                '<td>' + formatNumber(d.total_qty || d.total_actual || 0) + '</td>' +
                '<td><span class="badge badge-' + (d.wms_status || d.status || 'draft') + '">' + getStatusLabel(d.wms_status || d.status) + '</span></td>' +
                '<td>' + formatDate(d.doc_date) + '</td>' +
                '</tr>';
        }).join('');
    }

    function renderStats() {
        if (documents.length === 0) { hide('statsCard'); return; }

        var stats = calcDocStats(documents);
        var html = '';
        for (var type in stats) {
            html += '<div class="info-item"><span class="info-label">' + getDocTypeLabel(type) + '</span><span class="info-value">' + stats[type].count + ' 单 / ' + formatNumber(stats[type].qty) + '</span></div>';
        }

        document.getElementById('statsGrid').innerHTML = html;
        show('statsCard');
    }

    function toggleAll() {
        var checked = document.getElementById('selectAll').checked;
        document.querySelectorAll('.doc-check').forEach(function(cb) {
            cb.checked = checked;
            var id = parseInt(cb.value);
            if (checked) selectedIds.add(id); else selectedIds.delete(id);
        });
    }

    function toggleSelect(id) {
        if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
    }

    async function exportCSV() {
        var ids = getSelectedOrAllIds(selectedIds, documents);
        if (ids.length === 0) { showMessage(t('msg.no_data_to_export', '没有可导出的数据'), 'warning'); return; }

        showLoading(true);
        try {
            var type = document.getElementById('filterType').value || 'ALL';
            var url = buildExportUrl(type, ids);
            var data = await apiGet(url);

            if (!data || !data.success || !data.csv) {
                throw new Error('导出数据为空，请确认: 1) n8n导出工作流已激活 2) 筛选条件下有对应数据');
            }

            var csvText = ensureBom(data.csv);
            var blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
            var link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            var statusLabel = document.getElementById('filterStatus').value || 'All';
            var fname = buildExportFilename(type, statusLabel, new Date(), CONFIG.timezone);
            link.download = fname;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);

            showMessage(t('result.export_rows', '已导出 {0} 行数据').replace('{0}', data.count || 0), 'success');
        } catch (e) {
            showMessage(t('msg.export_failed', '导出失败: {0}').replace('{0}', e.message), 'error');
        } finally {
            showLoading(false);
        }
    }

    async function markExported() {
        if (_isSubmitting) return;
        var ids = getSelectedOrAllIds(selectedIds, documents);
        if (ids.length === 0) { showMessage(t('msg.no_data_to_mark', '没有数据可标记'), 'warning'); return; }
        if (!confirm(t('confirm.mark_exported', '确认将 {0} 条记录标记为"已导出"?').replace('{0}', ids.length))) return;

        _isSubmitting = true; showLoading(true);
        try {
            var result = await apiPost('/document/mark-exported', { ids: ids });
            if (!result || !result.success) throw new Error(result && result.message ? result.message : t('common.failed', '操作失败'));
            ids.forEach(function(id) {
                var cb = document.querySelector('.doc-check[value="' + id + '"]');
                if (cb) {
                    var row = cb.closest('tr');
                    if (row) row.style.opacity = '0.3';
                    cb.disabled = true;
                }
            });
            documents = documents.filter(function(d) { return ids.indexOf(d.id) === -1; });
            selectedIds.clear();
            document.getElementById('selectAll').checked = false;
            setText('resultCount', documents.length);
            showMessage(t('result.marked_exported', '已标记 {0} 条记录为已导出').replace('{0}', ids.length), 'success');
        } catch (e) {
            showMessage(t('common.failed', '操作失败') + ': ' + e.message, 'error');
        } finally {
            _isSubmitting = false; showLoading(false);
        }
    }

    function setText(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }
    function show(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); }
    function hide(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initExport);
    else initExport();
}

// ============================================================================
// 兼容性导出 — Jest 单元测试引用（不影响浏览器环境）
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        formatISODate: formatISODate,
        calcDefaultDateRange: calcDefaultDateRange,
        buildExportQueryParams: buildExportQueryParams,
        calcDocStats: calcDocStats,
        getSelectedOrAllIds: getSelectedOrAllIds,
        buildExportFilename: buildExportFilename,
        ensureBom: ensureBom,
        buildExportUrl: buildExportUrl
    };
}
