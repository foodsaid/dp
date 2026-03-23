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

    test('LineNum 为 null 的行被跳过', () => {
        const rows = [
            { LineNum: null, ItemCode: 'X' },
            { LineNum: 0, ItemCode: 'A' }
        ];
        const result = _dedup(rows);
        expect(result.length).toBe(1);
        expect(result[0].ItemCode).toBe('A');
    });

    test('LineNum 为 undefined 的行被跳过', () => {
        const rows = [
            { ItemCode: 'X' },
            { LineNum: 0, ItemCode: 'A' }
        ];
        const result = _dedup(rows);
        expect(result.length).toBe(1);
    });

    test('后出现的同 LineNum 行覆盖前者', () => {
        const rows = [
            { LineNum: 0, ItemCode: 'OLD' },
            { LineNum: 0, ItemCode: 'NEW' }
        ];
        const result = _dedup(rows);
        expect(result[0].ItemCode).toBe('NEW');
    });

    test('SAP B1 LineNum=0 作为合法第一行被正确保留', () => {
        // SAP B1 10.0 MS SQL 行项目 ID 从 0 开始
        const rows = [
            { LineNum: 0, ItemCode: 'FIRST-LINE' },
            { LineNum: 1, ItemCode: 'SECOND-LINE' },
            { LineNum: 2, ItemCode: 'THIRD-LINE' }
        ];
        const result = _dedup(rows);
        expect(result.length).toBe(3);
        expect(result.find(r => r.LineNum === 0).ItemCode).toBe('FIRST-LINE');
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

    test('行无 doc_wms_status 时保持默认 pending', () => {
        const wmsRows = [{ id: 1, quantity: 5, performed_by: 'op' }];
        const result = _extractWmsHistory(wmsRows);
        expect(result.docWmsStatus).toBe('pending');
    });

    test('行无 id 时不计入事务 (仅状态行)', () => {
        const wmsRows = [{ doc_wms_status: 'completed' }];
        const result = _extractWmsHistory(wmsRows);
        expect(result.docWmsStatus).toBe('completed');
        expect(result.totalReceived).toBe(0);
        expect(result.transactions.length).toBe(0);
        expect(result.docId).toBeNull();
    });

    test('行无 quantity 时按 0 计算', () => {
        const wmsRows = [{ id: 1, document_id: 50, performed_by: 'op' }];
        const result = _extractWmsHistory(wmsRows);
        expect(result.totalReceived).toBe(0);
        expect(result.transactions[0].quantity).toBe(0);
    });

    test('docId 仅取第一条有效事务的 document_id', () => {
        const wmsRows = [
            { id: 1, document_id: 100, quantity: 1, performed_by: 'op' },
            { id: 2, document_id: 200, quantity: 2, performed_by: 'op' }
        ];
        const result = _extractWmsHistory(wmsRows);
        expect(result.docId).toBe(100);
    });

    test('line_num 为 null 时不计入 lineReceipts', () => {
        const wmsRows = [{ id: 1, document_id: 50, line_num: null, quantity: 10, performed_by: 'op' }];
        const result = _extractWmsHistory(wmsRows);
        expect(Object.keys(result.lineReceipts).length).toBe(0);
        expect(result.totalReceived).toBe(10);
    });

    test('line_num 为 undefined 时不计入 lineReceipts', () => {
        const wmsRows = [{ id: 1, document_id: 50, quantity: 10, performed_by: 'op' }];
        const result = _extractWmsHistory(wmsRows);
        expect(Object.keys(result.lineReceipts).length).toBe(0);
    });

    test('事务字段缺失时使用默认值', () => {
        const wmsRows = [{ id: 1, document_id: 50, quantity: 5, performed_by: 'op' }];
        const result = _extractWmsHistory(wmsRows);
        const tx = result.transactions[0];
        expect(tx.item_code).toBe('');
        expect(tx.item_name).toBe('');
        expect(tx.remarks).toBe('');
    });

    test('多行不同 line_num 分别累计', () => {
        const wmsRows = [
            { id: 1, document_id: 50, line_num: 0, quantity: 10, performed_by: 'op' },
            { id: 2, document_id: 50, line_num: 1, quantity: 20, performed_by: 'op' },
            { id: 3, document_id: 50, line_num: 0, quantity: 5, performed_by: 'op' }
        ];
        const result = _extractWmsHistory(wmsRows);
        expect(result.lineReceipts[0]).toBe(15);
        expect(result.lineReceipts[1]).toBe(20);
        expect(result.totalReceived).toBe(35);
    });

    test('SAP B1 line_num=0 作为合法第一行被正确累计到 lineReceipts', () => {
        // SAP B1 10.0 行项目 ID 从 0 开始，line_num=0 不能被当作 falsy 跳过
        const wmsRows = [
            { id: 1, document_id: 50, line_num: 0, quantity: 10, performed_by: 'op', item_code: 'A' },
            { id: 2, document_id: 50, line_num: 0, quantity: 5, performed_by: 'op', item_code: 'A' }
        ];
        const result = _extractWmsHistory(wmsRows);
        expect(result.lineReceipts[0]).toBe(15);
        expect(result.lineReceipts).toHaveProperty('0');
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

    test('SAP 缺少可选字段时使用默认值', () => {
        const minimalSap = [{ DocNum: 1, DocEntry: 2, ItemCode: 'X' }];
        const result = mergeWoData(minimalSap, []);
        expect(result.success).toBe(true);
        expect(result.sap_order.itemName).toBe('');
        expect(result.sap_order.plannedQty).toBe(0);
        expect(result.sap_order.completedQty).toBe(0);
        expect(result.sap_order.whsCode).toBe('');
        expect(result.sap_order.whsName).toBe('');
        expect(result.sap_order.uom).toBe('PC');
    });

    test('SAP PlannedQty/completedQty 为非数字字符串时默认 0', () => {
        const sap = [{ DocNum: 1, DocEntry: 2, ItemCode: 'X', PlannedQty: 'abc', completedQty: null }];
        const result = mergeWoData(sap, []);
        expect(result.sap_order.plannedQty).toBe(0);
        expect(result.sap_order.completedQty).toBe(0);
    });

    test('undefined sapRows 返回错误', () => {
        expect(mergeWoData(undefined, []).success).toBe(false);
    });

    test('SAP B1 WO 单行工单 WMS 事务 line_num=0 正确累计 (对账一致性)', () => {
        // WO 虽然是单行工单，但 WMS 事务中 line_num 仍遵循 SAP B1 从 0 开始的设计
        const wmsRows = [
            { doc_wms_status: 'in_progress', id: 1, document_id: 100, line_num: 0, quantity: 30, performed_by: 'op1', transaction_time: '2026-03-07', item_code: 'PROD-001' },
            { doc_wms_status: 'in_progress', id: 2, document_id: 100, line_num: 0, quantity: 20, performed_by: 'op2', transaction_time: '2026-03-08', item_code: 'PROD-001' }
        ];
        const result = mergeWoData(sapRows, wmsRows);
        expect(result.success).toBe(true);
        expect(result.wms_history.totalReceived).toBe(50);
        // line_num=0 的事务应正确记录在 transactions 中
        expect(result.wms_history.transactions.length).toBe(2);
        expect(result.wms_history.transactions[0].item_code).toBe('PROD-001');
        expect(result.wms_document_id).toBe(100);
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

    test('null sapRows', () => {
        expect(mergePoData(null, []).success).toBe(false);
    });

    test('undefined sapRows', () => {
        expect(mergePoData(undefined, []).success).toBe(false);
    });

    test('SAP 无 DocNum', () => {
        expect(mergePoData([{ ItemCode: 'X' }], []).success).toBe(false);
    });

    test('SAP 行缺少可选字段时使用默认值', () => {
        const minSap = [{ DocNum: 1, DocEntry: 2, LineNum: 0, ItemCode: 'A' }];
        const result = mergePoData(minSap, []);
        expect(result.success).toBe(true);
        const line = result.sap_order.lines[0];
        expect(line.itemName).toBe('');
        expect(line.quantity).toBe(0);
        expect(line.openQty).toBe(0);
        expect(line.lineStatus).toBe('O');
        expect(line.uom).toBe('');
        expect(line.whsCode).toBe('');
        expect(line.manBtchNum).toBe('N');
    });

    test('SAP header 缺少可选字段时使用默认值', () => {
        const minSap = [{ DocNum: 1, DocEntry: 2, LineNum: 0, ItemCode: 'A' }];
        const result = mergePoData(minSap, []);
        expect(result.sap_order.cardCode).toBe('');
        expect(result.sap_order.cardName).toBe('');
        expect(result.sap_order.docStatus).toBe('O');
    });

    test('SAP Quantity/OpenQty 为非数字时默认 0', () => {
        const sap = [{ DocNum: 1, DocEntry: 2, LineNum: 0, ItemCode: 'A', Quantity: 'abc', OpenQty: null }];
        const result = mergePoData(sap, []);
        expect(result.sap_order.lines[0].quantity).toBe(0);
        expect(result.sap_order.lines[0].openQty).toBe(0);
    });

    test('重复 LineNum 去重后只保留最后一行', () => {
        const sap = [
            { DocNum: 1, DocEntry: 2, LineNum: 0, ItemCode: 'OLD', Quantity: 10 },
            { DocNum: 1, DocEntry: 2, LineNum: 0, ItemCode: 'NEW', Quantity: 20 }
        ];
        const result = mergePoData(sap, []);
        expect(result.sap_order.lines.length).toBe(1);
        expect(result.sap_order.lines[0].itemCode).toBe('NEW');
    });

    test('SAP B1 LineNum=0 作为合法第一行映射到 lines[].lineNum (对账一致性)', () => {
        // SAP B1 10.0 MS SQL 行项目 ID 从 0 开始
        const sap = [
            { DocNum: 500, DocEntry: 501, LineNum: 0, ItemCode: 'M001', Quantity: 100, OpenQty: 80 },
            { DocNum: 500, DocEntry: 501, LineNum: 1, ItemCode: 'M002', Quantity: 50, OpenQty: 50 }
        ];
        const result = mergePoData(sap, []);
        expect(result.sap_order.lines[0].lineNum).toBe(0);
        expect(result.sap_order.lines[1].lineNum).toBe(1);
    });

    test('WMS lineReceipts 按 SAP B1 LineNum=0 正确对应', () => {
        const sap = [{ DocNum: 500, DocEntry: 501, LineNum: 0, ItemCode: 'M001' }];
        const wmsRows = [
            { doc_wms_status: 'in_progress', id: 1, line_num: 0, quantity: 20, performed_by: 'op' }
        ];
        const result = mergePoData(sap, wmsRows);
        // line_num=0 的收货量必须正确累计到 lineReceipts[0]
        expect(result.wms_history.lineReceipts[0]).toBe(20);
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

    test('null/undefined sapRows', () => {
        expect(mergeTrData(null, []).success).toBe(false);
        expect(mergeTrData(undefined, []).success).toBe(false);
    });

    test('SAP 无 DocNum', () => {
        expect(mergeTrData([{ ItemCode: 'X' }], []).success).toBe(false);
    });

    test('SAP 行缺少可选字段时使用默认值', () => {
        const minSap = [{ DocNum: 1, DocEntry: 2, LineNum: 0, ItemCode: 'A' }];
        const result = mergeTrData(minSap, []);
        expect(result.success).toBe(true);
        const line = result.sap_order.lines[0];
        expect(line.itemName).toBe('');
        expect(line.quantity).toBe(0);
        expect(line.openQty).toBe(0);
        expect(line.fromWhsCod).toBe('');
        expect(line.whsCode).toBe('');
    });

    test('SAP header 缺少可选字段时使用默认值', () => {
        const minSap = [{ DocNum: 1, DocEntry: 2, LineNum: 0, ItemCode: 'A' }];
        const result = mergeTrData(minSap, []);
        expect(result.sap_order.docStatus).toBe('O');
        expect(result.sap_order.filler).toBe('');
        expect(result.sap_order.toWhsCode).toBe('');
    });

    test('SAP Quantity/OpenQty 为非数字时默认 0', () => {
        const sap = [{ DocNum: 1, DocEntry: 2, LineNum: 0, ItemCode: 'A', Quantity: 'x', OpenQty: undefined }];
        const result = mergeTrData(sap, []);
        expect(result.sap_order.lines[0].quantity).toBe(0);
        expect(result.sap_order.lines[0].openQty).toBe(0);
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

    test('null/undefined sapRows', () => {
        expect(mergePiData(null, []).success).toBe(false);
        expect(mergePiData(undefined, []).success).toBe(false);
    });

    test('SAP 无 DocNum', () => {
        expect(mergePiData([{ ItemCode: 'X' }], []).success).toBe(false);
    });

    test('SAP 行缺少可选字段时使用默认值', () => {
        const minSap = [{ DocNum: 1, DocEntry: 2, LineNum: 0, ItemCode: 'A' }];
        const result = mergePiData(minSap, []);
        expect(result.success).toBe(true);
        const line = result.sap_order.lines[0];
        expect(line.itemName).toBe('');
        expect(line.baseQty).toBe(0);
        expect(line.plannedQty).toBe(0);
        expect(line.issuedQty).toBe(0);
        expect(line.whsCode).toBe('');
        expect(line.uom).toBe('');
    });

    test('SAP header 缺少可选字段时使用默认值', () => {
        const minSap = [{ DocNum: 1, DocEntry: 2, LineNum: 0, ItemCode: 'A' }];
        const result = mergePiData(minSap, []);
        expect(result.sap_order.productCode).toBe('');
        expect(result.sap_order.productName).toBe('');
        expect(result.sap_order.plannedQty).toBe(0);
        expect(result.sap_order.completedQty).toBe(0);
        expect(result.sap_order.uom).toBe('');
        expect(result.sap_order.whsCode).toBe('');
    });

    test('lineStatus: IssuedQty < linePlannedQty → O', () => {
        const sap = [{ DocNum: 1, DocEntry: 2, LineNum: 0, ItemCode: 'A', IssuedQty: 5, linePlannedQty: 10 }];
        const result = mergePiData(sap, []);
        expect(result.sap_order.lines[0].lineStatus).toBe('O');
    });

    test('lineStatus: IssuedQty >= linePlannedQty → C', () => {
        const sap = [{ DocNum: 1, DocEntry: 2, LineNum: 0, ItemCode: 'A', IssuedQty: 10, linePlannedQty: 10 }];
        const result = mergePiData(sap, []);
        expect(result.sap_order.lines[0].lineStatus).toBe('C');
    });

    test('lineStatus: 缺少 IssuedQty/linePlannedQty 时按 0 计算 → C (0>=0)', () => {
        const sap = [{ DocNum: 1, DocEntry: 2, LineNum: 0, ItemCode: 'A' }];
        const result = mergePiData(sap, []);
        expect(result.sap_order.lines[0].lineStatus).toBe('C');
    });

    test('lineStatus: 非数字字段按 0 计算', () => {
        const sap = [{ DocNum: 1, DocEntry: 2, LineNum: 0, ItemCode: 'A', IssuedQty: 'abc', linePlannedQty: 'xyz' }];
        const result = mergePiData(sap, []);
        expect(result.sap_order.lines[0].lineStatus).toBe('C');
        expect(result.sap_order.lines[0].issuedQty).toBe(0);
        expect(result.sap_order.lines[0].plannedQty).toBe(0);
    });

    test('SAP B1 BOM LineNum=0 作为合法第一行映射到 lines[].lineNum (对账一致性)', () => {
        const sap = [
            { DocNum: 700, DocEntry: 701, Status: 'R', LineNum: 0, ItemCode: 'BOM-01', BaseQty: 50, linePlannedQty: 50, IssuedQty: 20 },
            { DocNum: 700, DocEntry: 701, Status: 'R', LineNum: 1, ItemCode: 'BOM-02', BaseQty: 30, linePlannedQty: 30, IssuedQty: 30 }
        ];
        const result = mergePiData(sap, []);
        expect(result.sap_order.lines[0].lineNum).toBe(0);
        expect(result.sap_order.lines[1].lineNum).toBe(1);
    });

    test('WMS 历史与 SAP 数据正确合并', () => {
        const sap = [{ DocNum: 700, DocEntry: 701, Status: 'R', LineNum: 0, ItemCode: 'BOM-01', BaseQty: 50, linePlannedQty: 50, IssuedQty: 20 }];
        const wmsRows = [
            { doc_wms_status: 'in_progress', id: 1, document_id: 88, line_num: 0, quantity: 15, performed_by: 'op', item_code: 'BOM-01', item_name: 'BOM料1' }
        ];
        const result = mergePiData(sap, wmsRows);
        expect(result.wms_history.wms_status).toBe('in_progress');
        expect(result.wms_history.lineReceipts[0]).toBe(15);
        expect(result.wms_history.transactions[0].item_code).toBe('BOM-01');
    });
});
