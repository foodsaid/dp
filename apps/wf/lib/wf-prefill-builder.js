/**
 * 通用 SAP→WMS 预填 SQL 构建器 (wf1a/1b/1d/1e 共享)
 * 纯函数: 根据合并后的 SAP 数据生成 CTE UPSERT SQL
 *
 * n8n Code 节点调用示例:
 * ───────────────────────
 * const { buildPrefillSql } = require('./lib/wf-prefill-builder');
 * const data = $('Merge Data').item.json;
 * const cc = $env.DP_COMPANY_CODE;
 * const user = ($('Webhook').item.json.query && $('Webhook').item.json.query.user) || 'SYSTEM';
 * const sql = buildPrefillSql.wo(data, cc, user);
 * return { json: { _prefillSql: sql } };
 * ───────────────────────
 */

/**
 * SQL 转义 (防注入)
 * @param {*} v - 任意值
 * @returns {string} SQL 安全字符串 (单引号包裹或 NULL)
 */
function esc(v) {
    if (v === null || v === undefined) return 'NULL';
    var s = String(v).substring(0, 500).replace(/\0/g, '');
    return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
}

/**
 * 日期转义为 YYYY-MM-DD 格式的 SQL 值
 * @param {*} v - 日期值
 * @returns {string} SQL 日期字符串 (单引号包裹或 NULL)
 */
function escDate(v) {
    if (!v) return 'NULL';
    var d = new Date(v);
    return isNaN(d.getTime()) ? 'NULL' : "'" + d.toISOString().slice(0, 10) + "'";
}

// ── WO: 生产收货 (单行) ──

/**
 * 构建 WO 预填 SQL (CTE UPSERT)
 * @param {Object} data - 合并后的 SAP+WMS 数据
 * @param {string} companyCode - 公司代码
 * @param {string} [user='SYSTEM'] - 操作用户
 * @returns {string} SQL 语句 (无数据时返回 'SELECT 1')
 */
function buildWoPrefillSql(data, companyCode, user) {
    if (!data || !data.success || !data.sap_order) {
        return 'SELECT 1';
    }
    if (!companyCode) {
        throw new Error('buildWoPrefillSql: companyCode is required');
    }
    var order = data.sap_order;
    if (!order.docNum || order.docEntry === null || order.docEntry === undefined) {
        return 'SELECT 1';
    }
    var cc = companyCode;
    var u = user || 'SYSTEM';

    return "WITH doc AS (\n" +
        "  INSERT INTO wms.wms_documents\n" +
        "    (company_code, doc_type, doc_number, sap_doc_num, sap_doc_entry,\n" +
        "     status, wms_status, business_partner, bp_name,\n" +
        "     warehouse_code, created_by, doc_date, due_date)\n" +
        "  VALUES (" + esc(cc) + ", 'WO', " + esc(order.docNum) + ", " + esc(order.docNum) + ", " + (order.docEntry || 0) + ",\n" +
        "     'draft', 'pending', " + esc(order.itemCode) + ", " + esc(order.itemName) + ",\n" +
        "     " + esc(order.whsCode) + ", " + esc(u) + ", CURRENT_DATE, " + escDate(order.dueDate) + ")\n" +
        "  ON CONFLICT (company_code, doc_type, doc_number) DO UPDATE SET\n" +
        "    sap_doc_entry = EXCLUDED.sap_doc_entry,\n" +
        "    created_by = CASE WHEN wms.wms_documents.created_by = 'SYSTEM' THEN EXCLUDED.created_by ELSE wms.wms_documents.created_by END,\n" +
        "    business_partner = EXCLUDED.business_partner,\n" +
        "    bp_name = EXCLUDED.bp_name,\n" +
        "    due_date = EXCLUDED.due_date,\n" +
        "    wms_status = wms.wms_documents.wms_status,\n" +
        "    status = wms.wms_documents.status\n" +
        "  RETURNING id\n" +
        ")\n" +
        "INSERT INTO wms.wms_document_lines\n" +
        "  (document_id, line_num, item_code, item_name, uom,\n" +
        "   planned_qty, actual_qty, warehouse_code, status, wms_status)\n" +
        "VALUES\n" +
        "  ((SELECT id FROM doc), 0, " + esc(order.itemCode) + ", " + esc(order.itemName) + ", " + esc(order.uom) + ",\n" +
        "   " + (order.plannedQty || 0) + ", 0, " + esc(order.whsCode) + ", 'pending', 'pending')\n" +
        "ON CONFLICT (document_id, line_num) DO UPDATE SET\n" +
        "  item_name = EXCLUDED.item_name,\n" +
        "  uom = EXCLUDED.uom,\n" +
        "  planned_qty = EXCLUDED.planned_qty,\n" +
        "  warehouse_code = EXCLUDED.warehouse_code;";
}

// ── PO: 采购收货 (多行) ──

/**
 * 构建 PO 预填 SQL (CTE UPSERT, 多行)
 * @param {Object} data - 合并后的 SAP+WMS 数据
 * @param {string} companyCode - 公司代码
 * @param {string} [user='SYSTEM'] - 操作用户
 * @returns {string} SQL 语句
 */
function buildPoPrefillSql(data, companyCode, user) {
    if (!data || !data.success || !data.sap_order || !data.sap_order.lines || data.sap_order.lines.length === 0) {
        return 'SELECT 1';
    }
    if (!companyCode) {
        throw new Error('buildPoPrefillSql: companyCode is required');
    }
    var order = data.sap_order;
    if (!order.docNum || order.docEntry === null || order.docEntry === undefined) {
        return 'SELECT 1';
    }
    var cc = companyCode;
    var u = user || 'SYSTEM';
    var whsCode = order.lines[0].whsCode || '';

    var lineVals = order.lines.map(function (l) {
        return '((SELECT id FROM doc), ' + l.lineNum + ', ' +
            esc(l.itemCode) + ', ' + esc(l.itemName) + ', ' + esc(l.uom) + ', ' +
            (parseFloat(l.openQty) || 0) + ", 0, " + esc(l.whsCode) + ", 'pending', 'pending')";
    }).join(',\n  ');

    return "WITH doc AS (\n" +
        "  INSERT INTO wms.wms_documents\n" +
        "    (company_code, doc_type, doc_number, sap_doc_num, sap_doc_entry,\n" +
        "     status, wms_status, business_partner, bp_name,\n" +
        "     warehouse_code, created_by, doc_date, due_date)\n" +
        "  VALUES (" + esc(cc) + ", 'PO', " + esc(order.docNum) + ", " + esc(order.docNum) + ", " + (order.docEntry || 0) + ",\n" +
        "     'draft', 'pending', " + esc(order.cardCode) + ", " + esc(order.cardName) + ",\n" +
        "     " + esc(whsCode) + ", " + esc(u) + ", CURRENT_DATE, " + escDate(order.docDueDate) + ")\n" +
        "  ON CONFLICT (company_code, doc_type, doc_number) DO UPDATE SET\n" +
        "    sap_doc_entry = EXCLUDED.sap_doc_entry,\n" +
        "    created_by = CASE WHEN wms.wms_documents.created_by = 'SYSTEM' THEN EXCLUDED.created_by ELSE wms.wms_documents.created_by END,\n" +
        "    business_partner = EXCLUDED.business_partner,\n" +
        "    bp_name = EXCLUDED.bp_name,\n" +
        "    due_date = EXCLUDED.due_date,\n" +
        "    wms_status = wms.wms_documents.wms_status,\n" +
        "    status = wms.wms_documents.status\n" +
        "  RETURNING id\n" +
        ")\n" +
        "INSERT INTO wms.wms_document_lines\n" +
        "  (document_id, line_num, item_code, item_name, uom,\n" +
        "   planned_qty, actual_qty, warehouse_code, status, wms_status)\n" +
        "VALUES\n  " + lineVals + "\n" +
        "ON CONFLICT (document_id, line_num) DO UPDATE SET\n" +
        "  item_name = EXCLUDED.item_name,\n" +
        "  uom = EXCLUDED.uom,\n" +
        "  planned_qty = EXCLUDED.planned_qty,\n" +
        "  warehouse_code = EXCLUDED.warehouse_code;";
}

// ── TR: 库存调拨 (多行, 含 from_warehouse) ──

/**
 * 构建 TR 预填 SQL (CTE UPSERT, 多行, 含 from_warehouse)
 * @param {Object} data - 合并后的 SAP+WMS 数据
 * @param {string} companyCode - 公司代码
 * @param {string} [user='SYSTEM'] - 操作用户
 * @returns {string} SQL 语句
 */
function buildTrPrefillSql(data, companyCode, user) {
    if (!data || !data.success || !data.sap_order || !data.sap_order.lines || data.sap_order.lines.length === 0) {
        return 'SELECT 1';
    }
    if (!companyCode) {
        throw new Error('buildTrPrefillSql: companyCode is required');
    }
    var order = data.sap_order;
    if (!order.docNum || order.docEntry === null || order.docEntry === undefined) {
        return 'SELECT 1';
    }
    var cc = companyCode;
    var u = user || 'SYSTEM';
    var toWhs = order.toWhsCode || '';
    var fromWhs = order.lines[0].fromWhsCod || '';

    var lineVals = order.lines.map(function (l) {
        return '((SELECT id FROM doc), ' + l.lineNum + ', ' +
            esc(l.itemCode) + ', ' + esc(l.itemName) + ", '', " +
            (parseFloat(l.openQty) || 0) + ", 0, " + esc(l.whsCode) +
            ', ' + esc(l.fromWhsCod) + ", 'pending', 'pending')";
    }).join(',\n  ');

    return "WITH doc AS (\n" +
        "  INSERT INTO wms.wms_documents\n" +
        "    (company_code, doc_type, doc_number, sap_doc_num, sap_doc_entry,\n" +
        "     status, wms_status, business_partner,\n" +
        "     warehouse_code, from_warehouse, to_warehouse,\n" +
        "     created_by, doc_date)\n" +
        "  VALUES (" + esc(cc) + ", 'TR', " + esc(order.docNum) + ", " + esc(order.docNum) + ", " + (order.docEntry || 0) + ",\n" +
        "     'draft', 'pending', " + esc(order.filler || '') + ",\n" +
        "     " + esc(toWhs) + ", " + esc(fromWhs) + ", " + esc(toWhs) + ",\n" +
        "     " + esc(u) + ", CURRENT_DATE)\n" +
        "  ON CONFLICT (company_code, doc_type, doc_number) DO UPDATE SET\n" +
        "    sap_doc_entry = EXCLUDED.sap_doc_entry,\n" +
        "    created_by = CASE WHEN wms.wms_documents.created_by = 'SYSTEM' THEN EXCLUDED.created_by ELSE wms.wms_documents.created_by END,\n" +
        "    business_partner = EXCLUDED.business_partner,\n" +
        "    from_warehouse = EXCLUDED.from_warehouse,\n" +
        "    to_warehouse = EXCLUDED.to_warehouse,\n" +
        "    wms_status = wms.wms_documents.wms_status,\n" +
        "    status = wms.wms_documents.status\n" +
        "  RETURNING id\n" +
        ")\n" +
        "INSERT INTO wms.wms_document_lines\n" +
        "  (document_id, line_num, item_code, item_name, uom,\n" +
        "   planned_qty, actual_qty, warehouse_code, from_warehouse, status, wms_status)\n" +
        "VALUES\n  " + lineVals + "\n" +
        "ON CONFLICT (document_id, line_num) DO UPDATE SET\n" +
        "  item_name = EXCLUDED.item_name,\n" +
        "  planned_qty = EXCLUDED.planned_qty,\n" +
        "  warehouse_code = EXCLUDED.warehouse_code,\n" +
        "  from_warehouse = EXCLUDED.from_warehouse;";
}

// ── PI: 生产领料 (多行 BOM) ──

/**
 * 构建 PI 预填 SQL (CTE UPSERT, 多行 BOM)
 * @param {Object} data - 合并后的 SAP+WMS 数据
 * @param {string} companyCode - 公司代码
 * @param {string} [user='SYSTEM'] - 操作用户
 * @returns {string} SQL 语句
 */
function buildPiPrefillSql(data, companyCode, user) {
    if (!data || !data.success || !data.sap_order || !data.sap_order.lines || data.sap_order.lines.length === 0) {
        return 'SELECT 1';
    }
    if (!companyCode) {
        throw new Error('buildPiPrefillSql: companyCode is required');
    }
    var order = data.sap_order;
    if (!order.docNum || order.docEntry === null || order.docEntry === undefined) {
        return 'SELECT 1';
    }
    var cc = companyCode;
    var u = user || 'SYSTEM';
    var whsCode = order.whsCode || (order.lines[0].whsCode || '');

    var lineVals = order.lines.map(function (l) {
        return '((SELECT id FROM doc), ' + l.lineNum + ', ' +
            esc(l.itemCode) + ', ' + esc(l.itemName) + ', ' + esc(l.uom) + ', ' +
            (parseFloat(l.baseQty) || 0) + ", 0, " + esc(l.whsCode) + ", 'pending', 'pending')";
    }).join(',\n  ');

    return "WITH doc AS (\n" +
        "  INSERT INTO wms.wms_documents\n" +
        "    (company_code, doc_type, doc_number, sap_doc_num, sap_doc_entry,\n" +
        "     status, wms_status, business_partner, bp_name,\n" +
        "     warehouse_code, created_by, doc_date, due_date)\n" +
        "  VALUES (" + esc(cc) + ", 'PI', " + esc(order.docNum) + ", " + esc(order.docNum) + ", " + (order.docEntry || 0) + ",\n" +
        "     'draft', 'pending', " + esc(order.productCode) + ", " + esc(order.productName) + ",\n" +
        "     " + esc(whsCode) + ", " + esc(u) + ", CURRENT_DATE, " + escDate(order.dueDate) + ")\n" +
        "  ON CONFLICT (company_code, doc_type, doc_number) DO UPDATE SET\n" +
        "    sap_doc_entry = EXCLUDED.sap_doc_entry,\n" +
        "    created_by = CASE WHEN wms.wms_documents.created_by = 'SYSTEM' THEN EXCLUDED.created_by ELSE wms.wms_documents.created_by END,\n" +
        "    business_partner = EXCLUDED.business_partner,\n" +
        "    bp_name = EXCLUDED.bp_name,\n" +
        "    due_date = EXCLUDED.due_date,\n" +
        "    wms_status = wms.wms_documents.wms_status,\n" +
        "    status = wms.wms_documents.status\n" +
        "  RETURNING id\n" +
        ")\n" +
        "INSERT INTO wms.wms_document_lines\n" +
        "  (document_id, line_num, item_code, item_name, uom,\n" +
        "   planned_qty, actual_qty, warehouse_code, status, wms_status)\n" +
        "VALUES\n  " + lineVals + "\n" +
        "ON CONFLICT (document_id, line_num) DO UPDATE SET\n" +
        "  item_name = EXCLUDED.item_name,\n" +
        "  uom = EXCLUDED.uom,\n" +
        "  planned_qty = EXCLUDED.planned_qty,\n" +
        "  warehouse_code = EXCLUDED.warehouse_code;";
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        esc, escDate,
        buildWoPrefillSql, buildPoPrefillSql, buildTrPrefillSql, buildPiPrefillSql
    };
}
