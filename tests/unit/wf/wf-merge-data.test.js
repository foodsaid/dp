const { mergeWoData, mergePoData, mergeTrData, mergePiData, _extractWmsHistory, _dedup } = require('../../../apps/wf/lib/wf-merge-data');

// ── 内部工具函数 ──

describe('wf-merge-data.js - _dedup', () => {

    test('按 LineNum 去重', () => {
        const rows = [
            { LineNum: 0, ItemCode: 'A' },
            { LineNum: 0, ItemCode: 'A-dup' },
            { LineNum: 1, ItemCode: 'B' }
        ];
        const result = _dedup(rows);
        expect(result.length).toBe(2);
    });

    test('空数组', () => {
        expect(_dedup([]).length).toBe(0);
    });
});

describe('wf-merge-data.js - _extractWmsHistory', () => {

    test('提取事务历史和统计', () => {
        const wmsRows = [
            { doc_wms_status: 'in_progress', id: 1, document_id: 100, line_num: 0, quantity: 10, performed_by: 'admin', transaction_time: '2026-03-07' },
            { doc_wms_status: 'in_progress', id: 2, document_id: 100, line_num: 0, quantity: 20, performed_by: 'admin', transaction_time: '2026-03-07' }
        ];
        const result = _extractWmsHistory(wmsRows);
        expect(result.docWmsStatus).toBe('in_progress');
        expect(result.totalReceived).toBe(30);
        expect(result.lineReceipts[0]).toBe(30);
        expect(result.transactions.length).toBe(2);
        expect(result.docId).toBe(100);
    });

    test('空 WMS 行', () => {
        const result = _extractWmsHistory([]);
        expect(result.totalReceived).toBe(0);
        expect(result.docWmsStatus).toBe('pending');
    });
});

// ── WO: 生产收货 ──

describe('wf-merge-data.js - mergeWoData', () => {

    const sapRows = [{
        DocNum: 26000123, DocEntry: 456, ItemCode: 'PROD-001', ItemName: '产品A',
        PlannedQty: 100, completedQty: 50, whsCode: 'WH01', whsName: '主仓',
        DueDate: '2026-03-15', uom: 'PC'
    }];

    test('正常合并 SAP + WMS', () => {
        const wmsRows = [{ doc_wms_status: 'in_progress', id: 1, quantity: 30, performed_by: 'op1', transaction_time: 't1' }];
        const result = mergeWoData(sapRows, wmsRows);
        expect(result.success).toBe(true);
        expect(result.sap_order.docNum).toBe('26000123');
        expect(result.sap_order.plannedQty).toBe(100);
        expect(result.wms_history.totalReceived).toBe(30);
    });

    test('空 SAP 结果返回错误', () => {
        expect(mergeWoData([], []).success).toBe(false);
        expect(mergeWoData(null, []).success).toBe(false);
    });

    test('SAP 无 DocNum 返回错误', () => {
        expect(mergeWoData([{ ItemCode: 'X' }], []).success).toBe(false);
    });

    test('空 WMS 历史', () => {
        const result = mergeWoData(sapRows, []);
        expect(result.wms_history.totalReceived).toBe(0);
        expect(result.wms_document_id).toBeNull();
    });
});

// ── PO: 采购收货 ──

describe('wf-merge-data.js - mergePoData', () => {

    const sapRows = [
        { DocNum: 500, DocEntry: 501, CardCode: 'V001', CardName: '供应商A', DocDueDate: '2026-04-01', DocStatus: 'O', LineNum: 0, ItemCode: 'M001', ItemName: '原料A', Quantity: 100, OpenQty: 80, LineStatus: 'O', uom: 'KG', WhsCode: 'WH01' },
        { DocNum: 500, DocEntry: 501, CardCode: 'V001', CardName: '供应商A', DocDueDate: '2026-04-01', DocStatus: 'O', LineNum: 1, ItemCode: 'M002', ItemName: '原料B', Quantity: 50, OpenQty: 50, LineStatus: 'O', uom: 'PC', WhsCode: 'WH02' }
    ];

    test('多行 SAP 去重合并', () => {
        const result = mergePoData(sapRows, []);
        expect(result.success).toBe(true);
        expect(result.sap_order.lines.length).toBe(2);
        expect(result.sap_order.cardCode).toBe('V001');
    });

    test('WMS 行级收货统计', () => {
        const wmsRows = [
            { doc_wms_status: 'in_progress', id: 1, line_num: 0, quantity: 20, performed_by: 'op' },
            { doc_wms_status: 'in_progress', id: 2, line_num: 0, quantity: 10, performed_by: 'op' }
        ];
        const result = mergePoData(sapRows, wmsRows);
        expect(result.wms_history.lineReceipts[0]).toBe(30);
    });

    test('空 SAP', () => {
        expect(mergePoData([], []).success).toBe(false);
    });
});

// ── TR: 库存调拨 ──

describe('wf-merge-data.js - mergeTrData', () => {

    const sapRows = [
        { DocNum: 600, DocEntry: 601, DocStatus: 'O', Filler: 'V002', ToWhsCode: 'WH02', LineNum: 0, ItemCode: 'T001', ItemName: '调拨料', Quantity: 200, OpenQty: 200, FromWhsCod: 'WH01', WhsCode: 'WH02' }
    ];

    test('正常合并 TR', () => {
        const result = mergeTrData(sapRows, []);
        expect(result.success).toBe(true);
        expect(result.sap_order.toWhsCode).toBe('WH02');
        expect(result.sap_order.lines[0].fromWhsCod).toBe('WH01');
    });

    test('空 SAP', () => {
        expect(mergeTrData([], []).success).toBe(false);
    });
});

// ── PI: 生产领料 ──

describe('wf-merge-data.js - mergePiData', () => {

    const sapRows = [
        { DocNum: 700, DocEntry: 701, Status: 'R', productCode: 'FG-001', productName: '成品A', PlannedQty: 500, completedQty: 200, DueDate: '2026-05-01', uom: 'PC', whsCode: 'WH01', LineNum: 0, ItemCode: 'BOM-01', ItemName: 'BOM料1', BaseQty: 50, linePlannedQty: 50, IssuedQty: 20 },
        { DocNum: 700, DocEntry: 701, Status: 'R', productCode: 'FG-001', productName: '成品A', PlannedQty: 500, completedQty: 200, DueDate: '2026-05-01', uom: 'PC', whsCode: 'WH01', LineNum: 1, ItemCode: 'BOM-02', ItemName: 'BOM料2', BaseQty: 30, linePlannedQty: 30, IssuedQty: 30 }
    ];

    test('正常合并 PI + lineStatus 计算', () => {
        const result = mergePiData(sapRows, []);
        expect(result.success).toBe(true);
        expect(result.sap_order.lines[0].lineStatus).toBe('O'); // 20 < 50
        expect(result.sap_order.lines[1].lineStatus).toBe('C'); // 30 >= 30
    });

    test('产品信息映射', () => {
        const result = mergePiData(sapRows, []);
        expect(result.sap_order.productCode).toBe('FG-001');
        expect(result.sap_order.productName).toBe('成品A');
    });

    test('空 SAP', () => {
        expect(mergePiData([], []).success).toBe(false);
    });
});
