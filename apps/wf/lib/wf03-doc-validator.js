/**
 * wf03 单据管理验证器
 * 纯函数: 创建/完成/导出验证 + 单号生成
 *
 * n8n Code 节点调用示例:
 * ───────────────────────
 * const { validateCreate, buildDocNumber, validateComplete, validateExport } = require('./lib/wf03-doc-validator');
 * ───────────────────────
 */

/**
 * 验证创建单据请求
 * @param {Object} body - 请求体
 * @param {Date} [now] - 当前时间 (可注入，便于测试)
 * @returns {{ _error: boolean, type?: string, prefix?: string, warehouse?: string, user?: string, remarks?: string, success?: boolean, message?: string }}
 */
function validateCreate(body, now) {
    if (!body || !body.doc_type || !body.warehouse_code || !body.created_by) {
        return { _error: true, success: false, message: '缺少必要字段: doc_type, warehouse_code, created_by' };
    }
    const type = body.doc_type;
    if (type !== 'IC' && type !== 'LM') {
        return { _error: true, success: false, message: '只有IC和LM类型可以在WMS中创建' };
    }
    const d = now || new Date();
    const dateStr = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const prefix = type + dateStr;
    return { _error: false, type: type, prefix: prefix, warehouse: body.warehouse_code, user: body.created_by, remarks: body.remarks || '' };
}

/**
 * 根据前缀和序列号构建单号
 * @param {string} prefix - 单号前缀 (如 IC20260307)
 * @param {number} seqNum - 序列号
 * @returns {string} 完整单号 (如 IC20260307001)
 */
function buildDocNumber(prefix, seqNum) {
    const num = seqNum || 1;
    return prefix + String(num).padStart(3, '0');
}

/**
 * 验证完成单据请求
 * @param {Object} body - 请求体
 * @returns {{ _error: boolean, doc_number?: string, doc_type?: string, performed_by?: string, success?: boolean, message?: string }}
 */
function validateComplete(body) {
    if (!body || !body.doc_number || !body.doc_type) {
        return { _error: true, success: false, message: '缺少doc_number或doc_type' };
    }
    return { _error: false, doc_number: body.doc_number, doc_type: body.doc_type, performed_by: body.performed_by || '' };
}

/**
 * 验证导出请求
 * @param {Object} body - 请求体
 * @returns {{ _error: boolean, ids?: number[], idList?: string, success?: boolean, message?: string }}
 */
function validateExport(body) {
    if (!body || !body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
        return { _error: true, success: false, message: '缺少ids数组' };
    }
    const ids = body.ids.map(function (id) { return parseInt(id); }).filter(function (id) { return !isNaN(id); });
    if (ids.length === 0) {
        return { _error: true, success: false, message: 'ids必须包含有效的数字ID' };
    }
    return { _error: false, ids: ids, idList: ids.join(',') };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validateCreate, buildDocNumber, validateComplete, validateExport };
}
