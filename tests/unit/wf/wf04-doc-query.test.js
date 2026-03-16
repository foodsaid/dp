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
});
