/**
 * wf04 单据查询辅助函数
 * 纯函数: 查询参数构建、列表格式化、单据参数提取、明细合并
 *
 * n8n Code 节点调用示例:
 * ───────────────────────
 * const { buildQuery, formatList, extractDocParams, mergeDetail } = require('./lib/wf04-doc-query');
 * ───────────────────────
 */

/**
 * 从请求中提取查询参数
 * 空字符串表示"不过滤"; SQL 侧用 NULLIF($N, '')::date 兜底防止空串转 date 报错
 * @param {Object} req - Webhook 请求对象
 * @returns {{ type: string, status: string, date_from: string, date_to: string }}
 */
function buildQuery(req) {
    const params = (req && req.query) || {};
    return {
        type: params.type || '',
        status: params.status || '',
        date_from: params.date_from || '',
        date_to: params.date_to || ''
    };
}

/**
 * 格式化单据列表查询结果
 * @param {Array} rows - PG 查询结果行 (每行含 .json 属性, 或直接对象)
 * @returns {{ success: boolean, documents: Object[] }}
 */
function formatList(rows) {
    if (!rows || !Array.isArray(rows)) {
        return { success: true, documents: [] };
    }
    const documents = rows
        .filter(function (r) {
            const data = r.json || r;
            return data && data.id;
        })
        .map(function (r) { return r.json || r; });
    return { success: true, documents: documents };
}

/**
 * 从请求中提取单据 ID 和类型
 * @param {Object} req - Webhook 请求对象
 * @returns {{ _error: boolean, docId?: string, docType?: string, success?: boolean, message?: string }}
 */
function extractDocParams(req) {
    if (!req || typeof req !== 'object') {
        return { _error: true, success: false, message: '请提供单据编号' };
    }

    let docId;
    if (req.query && req.query.id) {
        docId = req.query.id;
    } else {
        const url = (req.headers && req.headers['x-original-url'])
            ? req.headers['x-original-url']
            : (req.url || '');
        const parts = url.split('/');
        const lastPart = parts[parts.length - 1];
        docId = lastPart ? lastPart.split('?')[0] : '';
    }
    const docType = (req.query && req.query.type) ? req.query.type : '';

    if (!docId || docId === 'document' || docId === 'undefined') {
        return { _error: true, success: false, message: '请提供单据编号' };
    }

    return { _error: false, docId: docId, docType: docType };
}

/**
 * 合并单据头、行项目和事务明细
 * @param {Array} headerRows - 单据头+行查询结果 (每行含 .json)
 * @param {Array} txRows - 事务查询结果 (每行含 .json)
 * @returns {{ success: boolean, document?: Object, lines?: Object[], transactions?: Object[], message?: string }}
 */
function mergeDetail(headerRows, txRows) {
    if (!headerRows || headerRows.length === 0) {
        return { success: false, message: '未找到该单据' };
    }

    const first = headerRows[0].json || headerRows[0];
    if (!first || !first.id) {
        return { success: false, message: '未找到该单据' };
    }

    const document = {
        id: first.id,
        doc_type: first.doc_type,
        doc_number: first.doc_number,
        sap_doc_num: first.sap_doc_num || '',
        status: first.status,
        wms_status: first.wms_status || first.status,
        warehouse_code: first.warehouse_code || '',
        business_partner: first.business_partner || '',
        bp_name: first.bp_name || '',
        doc_date: first.doc_date,
        created_by: first.created_by || '',
        remarks: first.remarks || '',
        created_at: first.created_at,
        exported_at: first.exported_at
    };

    const lines = [];
    const seenLines = {};
    for (const r of headerRows) {
        const data = r.json || r;
        if (data.line_id && !seenLines[data.line_id]) {
            seenLines[data.line_id] = true;
            lines.push({
                id: data.line_id,
                line_num: data.line_num,
                item_code: data.item_code || '',
                item_name: data.item_name || '',
                uom: data.uom || '',
                planned_qty: parseFloat(data.planned_qty) || 0,
                actual_qty: parseFloat(data.actual_qty) || 0,
                warehouse_code: data.line_whs || '',
                bin_location: data.bin_location || '',
                from_warehouse: data.from_warehouse || '',
                from_bin: data.from_bin || '',
                to_warehouse: data.to_warehouse || '',
                to_bin: data.to_bin || '',
                status: data.line_status || '',
                wms_status: data.line_wms_status || data.line_status || '',
                updated_at: data.created_at
            });
        }
    }

    // 去重: n8n 多行输入会导致 Query Doc Transactions 重复执行, 按 id 去重
    const seenTx = {};
    const transactions = [];
    const safeTxRows = txRows || [];
    for (const r of safeTxRows) {
        const data = r.json || r;
        if (data.id && !seenTx[data.id]) {
            seenTx[data.id] = true;
            transactions.push({
                id: data.id,
                action: data.action,
                item_code: data.item_code,
                quantity: parseFloat(data.quantity),
                warehouse_code: data.warehouse_code || '',
                bin_location: data.bin_location || '',
                from_bin: data.from_bin || '',
                to_bin: data.to_bin || data.bin_location || '',
                item_name: data.item_name || '',
                performed_by: data.performed_by || '',
                remarks: data.remarks || '',
                transaction_time: data.transaction_time
            });
        }
    }

    return { success: true, document: document, lines: lines, transactions: transactions };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildQuery, formatList, extractDocParams, mergeDetail };
}
