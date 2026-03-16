/**
 * 通用单号参数提取器 (wf1a/1b/1d/1e 共享)
 * 从 Webhook 请求中提取并验证 SAP 单号 (纯数字)
 *
 * n8n Code 节点调用示例:
 * ───────────────────────
 * const { extractDocNum } = require('./lib/wf-doc-param-extractor');
 * const result = extractDocNum($input.item.json, { docType: 'wo', label: '生产订单号' });
 * return { json: result };
 * ───────────────────────
 */

/**
 * 从请求对象中提取并验证 SAP 单号
 * @param {Object} req - Webhook 请求对象 (含 query, headers, url)
 * @param {Object} opts - 配置选项
 * @param {string} opts.docType - 单据类型标识 (用于 URL 末段过滤, 如 'wo'/'po'/'tr'/'pi')
 * @param {string} opts.label - 单据中文名 (用于错误消息, 如 '生产订单号')
 * @param {RegExp} [opts.stripPrefix] - 可选前缀正则 (如 TR 单的 /^TR/i)
 * @returns {{ _error: boolean, docnum?: string, success?: boolean, message?: string }}
 */
function extractDocNum(req, opts) {
    if (!req || typeof req !== 'object') {
        return { _error: true, success: false, message: '请提供' + (opts && opts.label || '单号') };
    }

    const docType = (opts && opts.docType) || '';
    const label = (opts && opts.label) || '单号';

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

    // 2. 可选前缀去除 (如 TR 单号前缀)
    if (opts && opts.stripPrefix) {
        docnum = docnum.replace(opts.stripPrefix, '');
    }

    // 3. 空值校验
    if (!docnum || docnum === docType || docnum === 'undefined') {
        return { _error: true, success: false, message: '请提供' + label };
    }

    // 4. SAP DocNum 为 INT 类型，过滤非数字输入
    if (!/^\d+$/.test(docnum)) {
        return { _error: true, success: false, message: label + '必须为纯数字: ' + docnum };
    }

    // 5. 安全加固: 强制转为整数字符串，纵深防御
    docnum = String(parseInt(docnum, 10));
    if (docnum === 'NaN') {
        return { _error: true, success: false, message: '单号解析失败' };
    }

    return { _error: false, docnum: docnum };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { extractDocNum };
}
