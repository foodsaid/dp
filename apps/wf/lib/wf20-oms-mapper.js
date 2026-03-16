/**
 * wf20 OMS 订单数据映射核心逻辑
 * 纯函数设计：SAP 原始数据 → OMS Schema 标准化结构
 *
 * 在 n8n Code 节点中使用示例:
 * ─────────────────────────────
 * const { mapOmsOrderToWmsSchema } = require('/data/wf-lib/wf20-oms-mapper');
 * const rows = $input.all().map(r => r.json);
 * const orders = mapOmsOrderToWmsSchema(rows);
 * return orders.map(o => ({ json: o }));
 * ─────────────────────────────
 *
 * 核心逻辑:
 * - SAP 行数据按 doc_type + sap_doc_entry 分组为订单头+行
 * - WO 特殊字段映射 (header_item_code/header_planned_qty 等)
 * - sap_data_hash 幂等性校验 (关键字段变化检测)
 * - 类型安全转换 (字符串→数字, 日期解析)
 * - 脏字段自动过滤 (只保留白名单字段)
 */

/** 订单头白名单字段 */
const ORDER_FIELDS = [
    'doc_type', 'sap_doc_entry', 'sap_doc_num', 'doc_number',
    'business_partner', 'bp_name', 'doc_date', 'due_date',
    'sap_status', 'sap_cancelled', 'doc_total', 'doc_currency',
    'sap_update_date', 'sap_update_time',
    'header_item_code', 'header_item_name',
    'header_planned_qty', 'header_actual_qty', 'header_warehouse',
    'sap_data_hash', 'lines'
];

/** 行项目白名单字段 */
const LINE_FIELDS = [
    'line_num', 'item_code', 'item_name',
    'quantity', 'open_quantity', 'warehouse_code', 'uom', 'ship_date'
];

/**
 * 安全转换为数字
 * @param {*} value - 原始值
 * @param {number|null} [fallback=0] - 回退值 (null 表示允许返回 null)
 * @returns {number|null}
 */
function toNumber(value, fallback) {
    if (value === null || value === undefined) {
        return fallback === undefined ? 0 : fallback;
    }
    const n = Number(value);
    return isNaN(n) ? (fallback === undefined ? 0 : fallback) : n;
}

/**
 * 安全转换为字符串
 * @param {*} value - 原始值
 * @returns {string}
 */
function toStr(value) {
    if (value === null || value === undefined) return '';
    return String(value);
}

/**
 * 安全解析日期为 YYYY-MM-DD 格式
 * @param {*} value - 原始日期值
 * @returns {string|null} YYYY-MM-DD 或 null
 */
function parseDate(value) {
    if (!value) return null;
    const s = String(value);
    // 尝试匹配 YYYY-MM-DD 格式
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    // 尝试解析其他日期格式
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
}

/**
 * 生成 sap_data_hash 的源字符串
 * 仅包含关键业务字段，变化时触发 UPSERT 更新
 * @param {Object} order - 订单对象
 * @returns {string} 管道分隔的哈希源字符串
 */
function buildHashInput(order) {
    return [
        toStr(order.sap_status),
        toStr(order.sap_cancelled),
        toNumber(order.doc_total),
        toStr(order.business_partner),
        (order.lines || []).length,
        toStr(order.header_item_code),
        order.header_planned_qty != null ? order.header_planned_qty : '',
        order.header_actual_qty != null ? order.header_actual_qty : ''
    ].join('|');
}

/**
 * 只保留白名单字段，过滤脏数据
 * @param {Object} obj - 源对象
 * @param {string[]} whitelist - 允许的字段名数组
 * @returns {Object} 过滤后的对象
 */
function filterFields(obj, whitelist) {
    const result = {};
    whitelist.forEach(key => {
        if (key in obj) {
            result[key] = obj[key];
        }
    });
    return result;
}

/**
 * 将 SAP 原始行数据映射为 OMS Schema 订单结构
 * 按 doc_type + sap_doc_entry 分组为订单头，聚合行项目
 *
 * @param {Array} rawOmsData - SAP 查询返回的扁平行数据
 * @returns {Array} 标准化的订单对象数组 (含 lines 子数组)
 * @throws {Error} 缺少 doc_number 或 items 时抛出
 */
function mapOmsOrderToWmsSchema(rawOmsData) {
    if (!Array.isArray(rawOmsData)) {
        throw new Error('Invalid input: rawOmsData must be an array');
    }

    if (rawOmsData.length === 0) {
        return [];
    }

    // 验证: 每行必须有 doc_type
    const invalidRows = rawOmsData.filter(r => r && !r.doc_type);
    if (invalidRows.length > 0) {
        throw new Error('Invalid data: doc_type is required for all rows');
    }

    // 验证: 每行必须有 sap_doc_entry (用作分组键和 doc_number)
    const missingDocNum = rawOmsData.filter(r => r && (r.sap_doc_entry === null || r.sap_doc_entry === undefined));
    if (missingDocNum.length > 0) {
        throw new Error('Invalid data: sap_doc_entry (doc_number) is required for all rows');
    }

    // 验证: 至少一行有 item_code (行项目数据)
    const hasItems = rawOmsData.some(r => r && r.item_code);
    if (!hasItems) {
        throw new Error('Invalid data: at least one row must have item_code (items)');
    }

    // 按 doc_type + sap_doc_entry 分组
    const orderMap = new Map();

    rawOmsData.forEach(r => {
        if (!r) return;

        const key = toStr(r.doc_type) + '_' + toNumber(r.sap_doc_entry);

        if (!orderMap.has(key)) {
            orderMap.set(key, {
                doc_type: toStr(r.doc_type),
                sap_doc_entry: toNumber(r.sap_doc_entry),
                sap_doc_num: toStr(r.sap_doc_num),
                doc_number: toStr(r.sap_doc_num),
                business_partner: toStr(r.business_partner),
                bp_name: toStr(r.bp_name),
                doc_date: parseDate(r.doc_date),
                due_date: parseDate(r.due_date),
                sap_status: toStr(r.sap_status) || 'O',
                sap_cancelled: toStr(r.sap_cancelled) || 'N',
                doc_total: toNumber(r.doc_total),
                doc_currency: toStr(r.doc_currency),
                sap_update_date: parseDate(r.sap_update_date),
                sap_update_time: toStr(r.sap_update_time) || '00:00:00',
                header_item_code: r.header_item_code != null ? toStr(r.header_item_code) : null,
                header_item_name: r.header_item_name != null ? toStr(r.header_item_name) : null,
                header_planned_qty: r.header_planned_qty != null ? toNumber(r.header_planned_qty) : null,
                header_actual_qty: r.header_actual_qty != null ? toNumber(r.header_actual_qty) : null,
                header_warehouse: r.header_warehouse != null ? toStr(r.header_warehouse) : null,
                lines: []
            });
        }

        // 添加行项目 (只有有 item_code 的行才算有效行)
        if (r.item_code) {
            orderMap.get(key).lines.push({
                line_num: toNumber(r.line_num),
                item_code: toStr(r.item_code),
                item_name: toStr(r.item_name),
                quantity: toNumber(r.quantity),
                open_quantity: toNumber(r.open_quantity),
                warehouse_code: toStr(r.warehouse_code),
                uom: toStr(r.uom),
                ship_date: parseDate(r.ship_date)
            });
        }
    });

    // 生成 hash + 过滤脏字段
    const orders = Array.from(orderMap.values()).map(order => {
        order.sap_data_hash = buildHashInput(order);
        return filterFields(order, ORDER_FIELDS);
    });

    return orders;
}

// 导出模块，兼容 Node.js (Jest) 和 n8n Code 节点注入
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        mapOmsOrderToWmsSchema,
        toNumber,
        toStr,
        parseDate,
        buildHashInput,
        filterFields,
        ORDER_FIELDS,
        LINE_FIELDS
    };
}
