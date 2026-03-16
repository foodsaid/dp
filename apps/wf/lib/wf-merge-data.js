/**
 * 通用 SAP↔WMS 数据合并器 (wf1a/1b/1d/1e 共享)
 * 纯函数: 合并 SAP 查询结果和 WMS 事务历史
 *
 * n8n Code 节点调用示例:
 * ───────────────────────
 * const { mergeWoData, mergePoData, mergeTrData, mergePiData } = require('./lib/wf-merge-data');
 * const sapRows = $('SAP查询').all().map(r => r.json);
 * const wmsRows = $('PG WMS').all().map(r => r.json);
 * const result = mergeWoData(sapRows, wmsRows);
 * return { json: result };
 * ───────────────────────
 */

// ── 内部工具函数 ──

/**
 * 提取 WMS 事务历史 (所有类型通用)
 * @param {Object[]} wmsRows - WMS 事务查询结果
 * @returns {{ docWmsStatus: string, docId: number|null, totalReceived: number, lineReceipts: Object<string, number>, transactions: Object[] }}
 */
function _extractWmsHistory(wmsRows) {
    const lineReceipts = {};
    const transactions = [];
    let docWmsStatus = 'pending';
    let docId = null;
    let totalReceived = 0;

    for (const r of wmsRows) {
        if (r.doc_wms_status) docWmsStatus = r.doc_wms_status;
        if (r.id) {
            const qty = parseFloat(r.quantity || 0);
            totalReceived += qty;
            if (!docId) docId = r.document_id;
            const ln = r.line_num;
            if (ln !== null && ln !== undefined) {
                lineReceipts[ln] = (lineReceipts[ln] || 0) + qty;
            }
            transactions.push({
                transaction_time: r.transaction_time,
                item_code: r.item_code || '',
                item_name: r.item_name || '',
                quantity: qty,
                performed_by: r.performed_by,
                remarks: r.remarks || ''
            });
        }
    }

    return { docWmsStatus, docId, totalReceived, lineReceipts, transactions };
}

/**
 * 按 LineNum 去重 SAP 行
 * @param {Object[]} sapRows - SAP 查询结果
 * @returns {Object[]} 去重后的行数组
 */
function _dedup(sapRows) {
    const lineMap = {};
    sapRows.forEach(function (r) { if (r.LineNum != null) lineMap[r.LineNum] = r; });
    return Object.values(lineMap);
}

// ── WO: 生产收货 (wf1a, 单行) ──

/**
 * 合并 WO 生产收货数据 (SAP 单行 + WMS 事务)
 * @param {Object[]} sapRows - SAP 查询结果
 * @param {Object[]} wmsRows - WMS 事务查询结果
 * @returns {{ success: boolean, sap_order?: Object, wms_history?: Object, wms_document_id?: number, message?: string }}
 */
function mergeWoData(sapRows, wmsRows) {
    if (!sapRows || sapRows.length === 0 || !sapRows[0].DocNum) {
        return { success: false, message: '未在SAP中找到该生产订单' };
    }

    const sap = sapRows[0];
    const wms = _extractWmsHistory(wmsRows);

    return {
        success: true,
        sap_order: {
            docNum: String(sap.DocNum),
            docEntry: sap.DocEntry,
            itemCode: sap.ItemCode,
            itemName: sap.ItemName || '',
            plannedQty: parseFloat(sap.PlannedQty) || 0,
            completedQty: parseFloat(sap.completedQty) || 0,
            whsCode: sap.whsCode || '',
            whsName: sap.whsName || '',
            dueDate: sap.DueDate,
            uom: sap.uom || 'PC'
        },
        wms_history: {
            wms_status: wms.docWmsStatus,
            totalReceived: wms.totalReceived,
            transactions: wms.transactions
        },
        wms_document_id: wms.docId
    };
}

// ── PO: 采购收货 (wf1b, 多行) ──

/**
 * 合并 PO 采购收货数据 (SAP 多行 + WMS 事务)
 * @param {Object[]} sapRows - SAP 查询结果
 * @param {Object[]} wmsRows - WMS 事务查询结果
 * @returns {{ success: boolean, sap_order?: Object, wms_history?: Object, wms_document_id?: number, message?: string }}
 */
function mergePoData(sapRows, wmsRows) {
    if (!sapRows || sapRows.length === 0 || !sapRows[0].DocNum) {
        return { success: false, message: '未在SAP中找到该采购订单' };
    }

    const first = sapRows[0];
    const dedupedRows = _dedup(sapRows);
    const lines = dedupedRows.map(function (r) {
        return {
            lineNum: r.LineNum,
            itemCode: r.ItemCode,
            itemName: r.ItemName || '',
            quantity: parseFloat(r.Quantity) || 0,
            openQty: parseFloat(r.OpenQty) || 0,
            lineStatus: r.LineStatus || 'O',
            uom: r.uom || '',
            whsCode: r.WhsCode || '',
            manBtchNum: r.ManBtchNum || 'N'
        };
    });

    const wms = _extractWmsHistory(wmsRows);

    return {
        success: true,
        sap_order: {
            docNum: String(first.DocNum),
            docEntry: first.DocEntry,
            cardCode: first.CardCode || '',
            cardName: first.CardName || '',
            docDueDate: first.DocDueDate,
            docStatus: first.DocStatus || 'O',
            lines: lines
        },
        wms_history: {
            wms_status: wms.docWmsStatus,
            lineReceipts: wms.lineReceipts,
            transactions: wms.transactions
        }
    };
}

// ── TR: 库存调拨 (wf1d, 多行) ──

/**
 * 合并 TR 库存调拨数据 (SAP 多行 + WMS 事务)
 * @param {Object[]} sapRows - SAP 查询结果
 * @param {Object[]} wmsRows - WMS 事务查询结果
 * @returns {{ success: boolean, sap_order?: Object, wms_history?: Object, wms_document_id?: number, message?: string }}
 */
function mergeTrData(sapRows, wmsRows) {
    if (!sapRows || sapRows.length === 0 || !sapRows[0].DocNum) {
        return { success: false, message: '未在SAP中找到该转储申请' };
    }

    const first = sapRows[0];
    const dedupedRows = _dedup(sapRows);
    const lines = dedupedRows.map(function (r) {
        return {
            lineNum: r.LineNum,
            itemCode: r.ItemCode,
            itemName: r.ItemName || '',
            quantity: parseFloat(r.Quantity) || 0,
            openQty: parseFloat(r.OpenQty) || 0,
            fromWhsCod: r.FromWhsCod || '',
            whsCode: r.WhsCode || ''
        };
    });

    const wms = _extractWmsHistory(wmsRows);

    return {
        success: true,
        sap_order: {
            docNum: String(first.DocNum),
            docEntry: first.DocEntry,
            docStatus: first.DocStatus || 'O',
            filler: first.Filler || '',
            toWhsCode: first.ToWhsCode || '',
            lines: lines
        },
        wms_history: {
            wms_status: wms.docWmsStatus,
            lineReceipts: wms.lineReceipts,
            transactions: wms.transactions
        }
    };
}

// ── PI: 生产领料 (wf1e, 多行 BOM) ──

/**
 * 合并 PI 生产领料数据 (SAP 多行 BOM + WMS 事务)
 * @param {Object[]} sapRows - SAP 查询结果
 * @param {Object[]} wmsRows - WMS 事务查询结果
 * @returns {{ success: boolean, sap_order?: Object, wms_history?: Object, wms_document_id?: number, message?: string }}
 */
function mergePiData(sapRows, wmsRows) {
    if (!sapRows || sapRows.length === 0 || !sapRows[0].DocNum) {
        return { success: false, message: '未在SAP中找到该生产订单' };
    }

    const first = sapRows[0];
    const dedupedRows = _dedup(sapRows);
    const lines = dedupedRows.map(function (r) {
        return {
            lineNum: r.LineNum,
            itemCode: r.ItemCode,
            itemName: r.ItemName || '',
            baseQty: parseFloat(r.BaseQty) || 0,
            plannedQty: parseFloat(r.linePlannedQty) || 0,
            issuedQty: parseFloat(r.IssuedQty) || 0,
            lineStatus: (parseFloat(r.IssuedQty) || 0) >= (parseFloat(r.linePlannedQty) || 0) ? 'C' : 'O',
            whsCode: r.whsCode || '',
            uom: r.uom || ''
        };
    });

    const wms = _extractWmsHistory(wmsRows);

    return {
        success: true,
        sap_order: {
            docNum: String(first.DocNum),
            docEntry: first.DocEntry,
            status: first.Status,
            productCode: first.productCode || '',
            productName: first.productName || '',
            plannedQty: parseFloat(first.PlannedQty) || 0,
            completedQty: parseFloat(first.completedQty) || 0,
            dueDate: first.DueDate,
            uom: first.uom || '',
            whsCode: first.whsCode || '',
            lines: lines
        },
        wms_history: {
            wms_status: wms.docWmsStatus,
            lineReceipts: wms.lineReceipts,
            transactions: wms.transactions
        }
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { mergeWoData, mergePoData, mergeTrData, mergePiData, _extractWmsHistory, _dedup };
}
