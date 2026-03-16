/**
 * wf1c SO/DD 单号解析器
 * 纯函数设计：从请求对象中提取并验证单号，判定数据源 (SAP/OMS)
 *
 * n8n Code 节点调用示例:
 * ───────────────────────
 * const { extractDocParams } = require('./lib/wf1c-so-parser');
 * const req = $input.item.json;
 * const result = extractDocParams(req);
 * return { json: result };
 * ───────────────────────
 */

/**
 * 从请求对象中提取单号并判定数据源
 * @param {Object} req - 请求对象 (含 query, headers, url)
 * @returns {{ _error: boolean, docnum?: string, doc_source?: string, message?: string }}
 */
function extractDocParams(req) {
    if (!req || typeof req !== 'object') {
        return { _error: true, success: false, message: '请提供销售订单号' };
    }

    // 1. 提取 docnum: 优先 query 参数，其次 URL 路径末段
    let docnum;
    if (req.query && req.query.docnum) {
        docnum = req.query.docnum;
    } else {
        const url = (req.headers && req.headers['x-original-url'])
            ? req.headers['x-original-url']
            : (req.url || '');
        const parts = url.split('/');
        const lastPart = parts[parts.length - 1];
        docnum = lastPart ? lastPart.split('?')[0] : '';
    }

    // 2. 空值校验
    if (!docnum || docnum === 'so' || docnum === 'undefined') {
        return { _error: true, success: false, message: '请提供销售订单号' };
    }

    // 3. 判定数据源: DD 前缀 → OMS, 纯数字 → SAP
    let doc_source = 'sap';
    if (/^[Dd]{2}\d+$/.test(docnum)) {
        doc_source = 'oms';
        docnum = docnum.toUpperCase();
    } else if (/^\d+$/.test(docnum)) {
        docnum = String(parseInt(docnum, 10));
        if (docnum === 'NaN') {
            return { _error: true, success: false, message: '单号解析失败' };
        }
    } else {
        return { _error: true, success: false, message: '单号格式无效: ' + docnum + ' (纯数字或DD+数字)' };
    }

    return { _error: false, docnum: docnum, doc_source: doc_source };
}

// 导出模块，兼容 Node.js (Jest) 和 n8n 环境
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { extractDocParams };
}
