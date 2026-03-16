/**
 * wf05 CSV 导出核心构建逻辑
 * 纯函数设计：输入行数据数组 + 配置选项，输出 CSV 字符串
 *
 * 在 n8n Code 节点中使用示例:
 * ─────────────────────────────
 * const { generateCsvString } = require('/data/wf-lib/wf05-csv-builder');
 * const rows = $input.all().map(r => r.json);
 * const csv = generateCsvString(rows, { bom: true });
 * return { json: { csv: csv.content, count: csv.dataCount } };
 * ─────────────────────────────
 *
 * 核心逻辑:
 * - RFC 4180 CSV 转义 (双引号内双引号 → "")
 * - LM/TR 借贷拆分 (出库负数 + 入库正数)
 * - UTF-8 BOM 标记 (Excel 中文兼容)
 * - null/undefined 安全回退
 */

/**
 * CSV 字段转义 (RFC 4180)
 * - null/undefined → 空字符串
 * - 内部双引号 → 双引号加倍
 * - 所有字段用双引号包裹
 * @param {*} value - 任意值
 * @returns {string} 双引号包裹的转义字符串
 */
function escapeCsvField(value) {
    if (value === null || value === undefined) return '""';
    return '"' + String(value).replace(/"/g, '""') + '"';
}

/**
 * 默认 CSV 表头
 */
const DEFAULT_HEADERS = [
    'doc_type', 'doc_number', 'sap_doc_num', 'warehouse_code',
    'wms_status', 'doc_date', 'created_by', 'line_num', 'item_code',
    'item_name', 'uom', 'planned_qty', 'actual_qty', 'bin_location',
    'direction', 'batch_number', 'serial_number', 'operator', 'transaction_time'
];

/**
 * 生成 CSV 字符串
 * @param {Array} data - 行数据数组 (来自 SQL 查询结果)
 * @param {Object} [options] - 配置选项
 * @param {boolean} [options.bom=true] - 是否添加 UTF-8 BOM 标记
 * @param {string[]} [options.headers] - 自定义表头 (默认使用 DEFAULT_HEADERS)
 * @returns {{ content: string, dataCount: number }} CSV 内容和数据行数
 */
function generateCsvString(data, options) {
    const opts = options || {};
    const bom = opts.bom !== false;
    const headers = opts.headers || DEFAULT_HEADERS;

    if (!Array.isArray(data)) {
        throw new Error('Invalid input: data must be an array');
    }

    const esc = escapeCsvField;
    const csvLines = [headers.join(',')];
    let dataCount = 0;

    for (const r of data) {
        if (!r || !r.doc_type) continue;

        // LM/TR 借贷拆分: 调拨/库位移动拆成出库(负数)+入库(正数)两行
        if ((r.doc_type === 'LM' || r.doc_type === 'TR') &&
            (r.tx_from_bin || r.tx_from_warehouse)) {

            const fromWhs = r.tx_from_warehouse || r.warehouse_code || '';
            const toWhs = r.tx_warehouse_code || r.warehouse_code || '';

            const base = [
                esc(r.doc_type),
                esc(r.doc_number),
                esc(r.sap_doc_num),
                esc(fromWhs),
                esc(r.wms_status),
                esc(r.doc_date),
                esc(r.created_by),
                esc(r.line_num),
                esc(r.item_code),
                esc(r.item_name),
                esc(r.uom),
                esc(r.planned_qty)
            ];

            const txQty = Number(r.tx_qty) || Number(r.actual_qty) || 0;

            // 贷行(出): 负数, 源库位
            csvLines.push([
                ...base,
                esc(-txQty),
                esc(r.tx_from_bin),
                esc('贷(出)'),
                esc(r.batch_number),
                esc(r.serial_number),
                esc(r.tx_operator || r.created_by),
                esc(r.transaction_time)
            ].join(','));
            dataCount++;

            // 借行(入): 正数, 目标库位
            csvLines.push([
                ...base.slice(0, 3),
                esc(toWhs),
                ...base.slice(4),
                esc(txQty),
                esc(r.tx_to_bin || r.bin_location || ''),
                esc('借(入)'),
                esc(r.batch_number),
                esc(r.serial_number),
                esc(r.tx_operator || r.created_by),
                esc(r.transaction_time)
            ].join(','));
            dataCount++;

        } else {
            // 非 LM/TR: 有 transaction 用 tx_qty, 无则用 actual_qty
            const qty = (r.tx_qty !== null && r.tx_qty !== undefined)
                ? r.tx_qty
                : r.actual_qty;

            csvLines.push([
                esc(r.doc_type),
                esc(r.doc_number),
                esc(r.sap_doc_num),
                esc(r.warehouse_code),
                esc(r.wms_status),
                esc(r.doc_date),
                esc(r.created_by),
                esc(r.line_num),
                esc(r.item_code),
                esc(r.item_name),
                esc(r.uom),
                esc(r.planned_qty),
                esc(qty),
                esc(r.bin_location),
                esc(''),
                esc(r.batch_number),
                esc(r.serial_number),
                esc(r.tx_operator || r.created_by),
                esc(r.transaction_time)
            ].join(','));
            dataCount++;
        }
    }

    const prefix = bom ? '\uFEFF' : '';
    return {
        content: prefix + csvLines.join('\n'),
        dataCount: dataCount
    };
}

// 导出模块，兼容 Node.js (Jest) 和 n8n Code 节点注入
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { generateCsvString, escapeCsvField, DEFAULT_HEADERS };
}
