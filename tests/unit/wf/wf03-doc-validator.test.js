const { validateCreate, buildDocNumber, validateComplete, validateExport } = require('../../../apps/wf/lib/wf03-doc-validator');

describe('wf03-doc-validator.js - validateCreate', () => {

    test('有效 IC 请求返回正确前缀', () => {
        const body = { doc_type: 'IC', warehouse_code: 'WH01', created_by: 'admin' };
        const result = validateCreate(body, new Date(2026, 2, 7)); // 2026-03-07
        expect(result._error).toBe(false);
        expect(result.type).toBe('IC');
        expect(result.prefix).toBe('IC20260307');
        expect(result.warehouse).toBe('WH01');
        expect(result.user).toBe('admin');
    });

    test('有效 LM 请求', () => {
        const body = { doc_type: 'LM', warehouse_code: 'WH02', created_by: 'user1', remarks: '测试' };
        const result = validateCreate(body, new Date(2026, 0, 15));
        expect(result._error).toBe(false);
        expect(result.prefix).toBe('LM20260115');
        expect(result.remarks).toBe('测试');
    });

    test('缺少 doc_type 返回错误', () => {
        const body = { warehouse_code: 'WH01', created_by: 'admin' };
        const result = validateCreate(body);
        expect(result._error).toBe(true);
        expect(result.message).toContain('必要字段');
    });

    test('缺少 warehouse_code 返回错误', () => {
        const body = { doc_type: 'IC', created_by: 'admin' };
        const result = validateCreate(body);
        expect(result._error).toBe(true);
    });

    test('非 IC/LM 类型拒绝', () => {
        const body = { doc_type: 'SO', warehouse_code: 'WH01', created_by: 'admin' };
        const result = validateCreate(body);
        expect(result._error).toBe(true);
        expect(result.message).toContain('IC和LM');
    });

    test('null body 返回错误', () => {
        expect(validateCreate(null)._error).toBe(true);
    });

    test('默认 remarks 为空字符串', () => {
        const body = { doc_type: 'IC', warehouse_code: 'WH01', created_by: 'admin' };
        const result = validateCreate(body);
        expect(result.remarks).toBe('');
    });

    test('月份个位数补零', () => {
        const body = { doc_type: 'IC', warehouse_code: 'WH01', created_by: 'a' };
        const result = validateCreate(body, new Date(2026, 0, 5)); // 2026-01-05
        expect(result.prefix).toBe('IC20260105');
    });
});

describe('wf03-doc-validator.js - buildDocNumber', () => {

    test('标准序列号 001', () => {
        expect(buildDocNumber('IC20260307', 1)).toBe('IC20260307001');
    });

    test('序列号 99 补零为 099', () => {
        expect(buildDocNumber('LM20260101', 99)).toBe('LM20260101099');
    });

    test('序列号 100 无补零', () => {
        expect(buildDocNumber('IC20260307', 100)).toBe('IC20260307100');
    });

    test('null 序列号默认为 1', () => {
        expect(buildDocNumber('IC20260307', null)).toBe('IC20260307001');
    });

    test('0 序列号默认为 1', () => {
        expect(buildDocNumber('IC20260307', 0)).toBe('IC20260307001');
    });
});

describe('wf03-doc-validator.js - validateComplete', () => {

    test('有效请求', () => {
        const result = validateComplete({ doc_number: 'IC20260307001', doc_type: 'IC', performed_by: 'admin' });
        expect(result._error).toBe(false);
        expect(result.doc_number).toBe('IC20260307001');
    });

    test('缺少 doc_number', () => {
        expect(validateComplete({ doc_type: 'IC' })._error).toBe(true);
    });

    test('缺少 doc_type', () => {
        expect(validateComplete({ doc_number: 'IC001' })._error).toBe(true);
    });

    test('performed_by 默认空字符串', () => {
        const result = validateComplete({ doc_number: 'IC001', doc_type: 'IC' });
        expect(result.performed_by).toBe('');
    });

    test('null body', () => {
        expect(validateComplete(null)._error).toBe(true);
    });
});

describe('wf03-doc-validator.js - validateExport', () => {

    test('有效 ids 数组', () => {
        const result = validateExport({ ids: [1, 2, 3] });
        expect(result._error).toBe(false);
        expect(result.ids).toEqual([1, 2, 3]);
        expect(result.idList).toBe('1,2,3');
    });

    test('字符串 ids 被正确转为整数', () => {
        const result = validateExport({ ids: ['10', '20', '30'] });
        expect(result.ids).toEqual([10, 20, 30]);
    });

    test('过滤无效 ids', () => {
        const result = validateExport({ ids: ['abc', 5, null, '10'] });
        expect(result.ids).toEqual([5, 10]);
    });

    test('全部无效 ids 返回错误', () => {
        const result = validateExport({ ids: ['abc', 'def'] });
        expect(result._error).toBe(true);
        expect(result.message).toContain('有效的数字');
    });

    test('空数组返回错误', () => {
        expect(validateExport({ ids: [] })._error).toBe(true);
    });

    test('缺少 ids 字段', () => {
        expect(validateExport({})._error).toBe(true);
    });

    test('ids 不是数组', () => {
        expect(validateExport({ ids: '123' })._error).toBe(true);
    });

    test('null body', () => {
        expect(validateExport(null)._error).toBe(true);
    });
});
