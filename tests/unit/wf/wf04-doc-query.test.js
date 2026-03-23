const { buildQuery, formatList, extractDocParams, mergeDetail } = require('../../../apps/wf/lib/wf04-doc-query');

describe('wf04-doc-query.js - buildQuery', () => {

    test('提取所有查询参数', () => {
        const req = { query: { type: 'SO', status: 'completed', date_from: '2026-01-01', date_to: '2026-03-07' } };
        const result = buildQuery(req);
        expect(result.type).toBe('SO');
        expect(result.status).toBe('completed');
        expect(result.date_from).toBe('2026-01-01');
        expect(result.date_to).toBe('2026-03-07');
    });

    test('缺少参数默认为空字符串', () => {
        const result = buildQuery({ query: {} });
        expect(result.type).toBe('');
        expect(result.status).toBe('');
    });

    test('null 请求', () => {
        const result = buildQuery(null);
        expect(result.type).toBe('');
    });
});

describe('wf04-doc-query.js - formatList', () => {

    test('格式化含 json 属性的行', () => {
        const rows = [
            { json: { id: 1, doc_number: 'IC001' } },
            { json: { id: 2, doc_number: 'IC002' } }
        ];
        const result = formatList(rows);
        expect(result.success).toBe(true);
        expect(result.documents.length).toBe(2);
    });

    test('过滤无 id 的行', () => {
        const rows = [
            { json: { id: 1 } },
            { json: {} },
            { json: { id: 3 } }
        ];
        expect(formatList(rows).documents.length).toBe(2);
    });

    test('空数组', () => {
        expect(formatList([]).documents.length).toBe(0);
    });

    test('null 输入', () => {
        expect(formatList(null).documents.length).toBe(0);
    });

    test('直接对象 (无 json 包装)', () => {
        const rows = [{ id: 1 }, { id: 2 }];
        expect(formatList(rows).documents.length).toBe(2);
    });
});

describe('wf04-doc-query.js - extractDocParams', () => {

    test('从 query.id 提取', () => {
        const req = { query: { id: 'DOC001', type: 'SO' } };
        const result = extractDocParams(req);
        expect(result._error).toBe(false);
        expect(result.docId).toBe('DOC001');
        expect(result.docType).toBe('SO');
    });

    test('从 URL 路径提取', () => {
        const req = { url: '/api/document/DOC002', headers: {} };
        const result = extractDocParams(req);
        expect(result._error).toBe(false);
        expect(result.docId).toBe('DOC002');
    });

    test('document 关键字视为空', () => {
        const req = { url: '/api/document/document' };
        expect(extractDocParams(req)._error).toBe(true);
    });

    test('空 docId', () => {
        const req = { query: {} };
        expect(extractDocParams(req)._error).toBe(true);
    });

    test('null 请求', () => {
        expect(extractDocParams(null)._error).toBe(true);
    });

    test('无 type 参数默认空字符串', () => {
        const req = { query: { id: 'X1' } };
        expect(extractDocParams(req).docType).toBe('');
    });
});

describe('wf04-doc-query.js - mergeDetail', () => {

    const makeHeader = (overrides) => ({
        json: {
            id: 100, doc_type: 'SO', doc_number: 'SO001', status: 'completed',
            wms_status: 'completed', warehouse_code: 'WH01', doc_date: '2026-03-07',
            line_id: 1, line_num: 0, item_code: 'A001', item_name: '物料A',
            planned_qty: 50, actual_qty: 50, line_status: 'completed',
            ...overrides
        }
    });

    test('正常合并单头+行+事务', () => {
        const headers = [makeHeader(), makeHeader({ line_id: 2, line_num: 1, item_code: 'A002' })];
        const txs = [{ json: { id: 10, action: 'scan', item_code: 'A001', quantity: 50 } }];
        const result = mergeDetail(headers, txs);
        expect(result.success).toBe(true);
        expect(result.document.id).toBe(100);
        expect(result.lines.length).toBe(2);
        expect(result.transactions.length).toBe(1);
    });

    test('行去重 (相同 line_id 只保留一个)', () => {
        const headers = [makeHeader(), makeHeader()]; // 相同 line_id=1
        const result = mergeDetail(headers, []);
        expect(result.lines.length).toBe(1);
    });

    test('事务去重 (相同 id 只保留一个)', () => {
        const tx = { json: { id: 10, action: 'scan', quantity: 50 } };
        const result = mergeDetail([makeHeader()], [tx, tx]);
        expect(result.transactions.length).toBe(1);
    });

    test('空 headerRows 返回错误', () => {
        expect(mergeDetail([], []).success).toBe(false);
    });

    test('null headerRows 返回错误', () => {
        expect(mergeDetail(null, []).success).toBe(false);
    });

    test('null txRows 安全处理', () => {
        const result = mergeDetail([makeHeader()], null);
        expect(result.success).toBe(true);
        expect(result.transactions.length).toBe(0);
    });

    test('文档默认字段处理', () => {
        const result = mergeDetail([makeHeader({ sap_doc_num: null, bp_name: null })], []);
        expect(result.document.sap_doc_num).toBe('');
        expect(result.document.bp_name).toBe('');
    });

    test('SAP B1 SO line_num=0 作为合法第一行正确透传 (对账一致性)', () => {
        // SAP B1 10.0 MS SQL SO 行项目 LineNum 从 0 开始
        const headers = [
            makeHeader({ line_id: 1, line_num: 0, item_code: 'SO-ITEM-1', planned_qty: 100 }),
            makeHeader({ line_id: 2, line_num: 1, item_code: 'SO-ITEM-2', planned_qty: 50 })
        ];
        const result = mergeDetail(headers, []);
        expect(result.lines.length).toBe(2);
        expect(result.lines[0].line_num).toBe(0);
        expect(result.lines[0].item_code).toBe('SO-ITEM-1');
        expect(result.lines[1].line_num).toBe(1);
        expect(result.lines[1].item_code).toBe('SO-ITEM-2');
    });

    test('SAP B1 DD 拆单后 line_num=0 正确保留 (OMS→WMS 对账)', () => {
        // DD 拆单继承原 SO 的行号结构，第一行 line_num=0
        const headers = [
            makeHeader({ doc_type: 'DD', doc_number: 'DD260001', line_id: 10, line_num: 0, item_code: 'DD-ITEM-1' })
        ];
        const result = mergeDetail(headers, []);
        expect(result.document.doc_type).toBe('DD');
        expect(result.lines[0].line_num).toBe(0);
    });

    test('headerRows 第一条无 id 时返回错误', () => {
        const headers = [{ json: { doc_type: 'SO', doc_number: 'SO001' } }]; // 无 id
        const result = mergeDetail(headers, []);
        expect(result.success).toBe(false);
        expect(result.message).toContain('未找到该单据');
    });

    test('headerRows 直接对象 (无 json 包装)', () => {
        const headers = [{
            id: 100, doc_type: 'SO', doc_number: 'SO001', status: 'completed',
            line_id: 1, line_num: 0, item_code: 'A001', planned_qty: 50
        }];
        const result = mergeDetail(headers, []);
        expect(result.success).toBe(true);
        expect(result.lines[0].line_num).toBe(0);
    });

    test('行项目可选字段缺失时使用默认值', () => {
        const headers = [makeHeader({
            item_name: null, uom: null, line_whs: null, bin_location: null,
            from_warehouse: null, from_bin: null, to_warehouse: null, to_bin: null,
            line_status: null, line_wms_status: null
        })];
        const result = mergeDetail(headers, []);
        const line = result.lines[0];
        expect(line.item_name).toBe('');
        expect(line.uom).toBe('');
        expect(line.warehouse_code).toBe('');
        expect(line.bin_location).toBe('');
        expect(line.from_warehouse).toBe('');
        expect(line.to_warehouse).toBe('');
        expect(line.status).toBe('');
        expect(line.wms_status).toBe('');
    });

    test('事务可选字段缺失时使用默认值', () => {
        const txs = [{ json: {
            id: 10, action: 'scan', item_code: 'A001', quantity: 50,
            warehouse_code: null, bin_location: null, from_bin: null, to_bin: null,
            item_name: null, performed_by: null, remarks: null
        }}];
        const result = mergeDetail([makeHeader()], txs);
        const tx = result.transactions[0];
        expect(tx.warehouse_code).toBe('');
        expect(tx.bin_location).toBe('');
        expect(tx.from_bin).toBe('');
        expect(tx.item_name).toBe('');
        expect(tx.performed_by).toBe('');
        expect(tx.remarks).toBe('');
    });

    test('事务 to_bin 缺失时 fallback 到 bin_location', () => {
        const txs = [{ json: {
            id: 10, action: 'scan', item_code: 'A', quantity: 1,
            bin_location: 'BIN-01'
        }}];
        const result = mergeDetail([makeHeader()], txs);
        expect(result.transactions[0].to_bin).toBe('BIN-01');
    });

    test('事务直接对象 (无 json 包装) 正确解析', () => {
        const txs = [{ id: 10, action: 'scan', item_code: 'A', quantity: 1, warehouse_code: 'WH01' }];
        const result = mergeDetail([makeHeader()], txs);
        expect(result.transactions.length).toBe(1);
        expect(result.transactions[0].warehouse_code).toBe('WH01');
    });

    test('行 planned_qty/actual_qty 为非数字时默认 0', () => {
        const headers = [makeHeader({ planned_qty: 'abc', actual_qty: null })];
        const result = mergeDetail(headers, []);
        expect(result.lines[0].planned_qty).toBe(0);
        expect(result.lines[0].actual_qty).toBe(0);
    });

    test('无 line_id 的行被跳过', () => {
        const headers = [
            makeHeader({ line_id: null }),
            makeHeader({ line_id: 2, line_num: 1, item_code: 'B' })
        ];
        const result = mergeDetail(headers, []);
        expect(result.lines.length).toBe(1);
        expect(result.lines[0].item_code).toBe('B');
    });

    test('无 id 的事务被跳过', () => {
        const txs = [
            { json: { action: 'scan', item_code: 'A', quantity: 1 } },
            { json: { id: 20, action: 'pick', item_code: 'B', quantity: 2 } }
        ];
        const result = mergeDetail([makeHeader()], txs);
        expect(result.transactions.length).toBe(1);
        expect(result.transactions[0].item_code).toBe('B');
    });
});
