const { extractDocParams } = require('../../../apps/wf/lib/wf1c-so-parser');

describe('wf1c-so-parser.js - SO/DD 单号解析器', () => {

    // ========== 正常 SAP 单号 ==========

    describe('SAP 纯数字单号', () => {
        test('场景 1: query.docnum 纯数字 → SAP 源', () => {
            const result = extractDocParams({ query: { docnum: '123456' } });
            expect(result._error).toBe(false);
            expect(result.docnum).toBe('123456');
            expect(result.doc_source).toBe('sap');
        });

        test('场景 2: 前导零自动去除 → "007" → "7"', () => {
            const result = extractDocParams({ query: { docnum: '007' } });
            expect(result._error).toBe(false);
            expect(result.docnum).toBe('7');
            expect(result.doc_source).toBe('sap');
        });

        test('场景 3: 大数字不溢出', () => {
            const result = extractDocParams({ query: { docnum: '9999999' } });
            expect(result._error).toBe(false);
            expect(result.docnum).toBe('9999999');
        });
    });

    // ========== DD 前缀 (OMS) ==========

    describe('DD 前缀 OMS 单号', () => {
        test('场景 4: DD+数字 → OMS 源, 大写化', () => {
            const result = extractDocParams({ query: { docnum: 'DD260001' } });
            expect(result._error).toBe(false);
            expect(result.docnum).toBe('DD260001');
            expect(result.doc_source).toBe('oms');
        });

        test('场景 5: 小写 dd → 自动大写', () => {
            const result = extractDocParams({ query: { docnum: 'dd100' } });
            expect(result._error).toBe(false);
            expect(result.docnum).toBe('DD100');
            expect(result.doc_source).toBe('oms');
        });

        test('场景 6: 混合大小写 Dd → 大写', () => {
            const result = extractDocParams({ query: { docnum: 'Dd999' } });
            expect(result._error).toBe(false);
            expect(result.docnum).toBe('DD999');
            expect(result.doc_source).toBe('oms');
        });
    });

    // ========== URL 路径提取 ==========

    describe('从 URL 路径提取单号', () => {
        test('场景 7: x-original-url 路径末段', () => {
            const result = extractDocParams({
                headers: { 'x-original-url': '/webhook/wms/so/789' }
            });
            expect(result._error).toBe(false);
            expect(result.docnum).toBe('789');
            expect(result.doc_source).toBe('sap');
        });

        test('场景 8: url 属性回退', () => {
            const result = extractDocParams({ url: '/api/wms/so/DD500' });
            expect(result._error).toBe(false);
            expect(result.docnum).toBe('DD500');
            expect(result.doc_source).toBe('oms');
        });

        test('场景 9: URL 含查询字符串 → 正确剥离', () => {
            const result = extractDocParams({
                url: '/api/wms/so/12345?user=admin'
            });
            expect(result._error).toBe(false);
            expect(result.docnum).toBe('12345');
        });

        test('场景 10: query.docnum 优先于 URL', () => {
            const result = extractDocParams({
                query: { docnum: '111' },
                url: '/api/wms/so/222'
            });
            expect(result.docnum).toBe('111');
        });
    });

    // ========== 异常输入 ==========

    describe('异常输入防御', () => {
        test('场景 11: null 输入 → 错误提示', () => {
            const result = extractDocParams(null);
            expect(result._error).toBe(true);
            expect(result.message).toContain('请提供销售订单号');
        });

        test('场景 12: undefined 输入 → 错误提示', () => {
            const result = extractDocParams(undefined);
            expect(result._error).toBe(true);
        });

        test('场景 13: 空对象 (无 query/url) → 错误提示', () => {
            const result = extractDocParams({});
            expect(result._error).toBe(true);
            expect(result.message).toContain('请提供销售订单号');
        });

        test('场景 14: docnum = "so" → 拦截 (路由名误传)', () => {
            const result = extractDocParams({ query: { docnum: 'so' } });
            expect(result._error).toBe(true);
        });

        test('场景 15: docnum = "undefined" → 拦截', () => {
            const result = extractDocParams({ query: { docnum: 'undefined' } });
            expect(result._error).toBe(true);
        });

        test('场景 16: 非数字非 DD 前缀 → 格式无效', () => {
            const result = extractDocParams({ query: { docnum: 'ABC123' } });
            expect(result._error).toBe(true);
            expect(result.message).toContain('单号格式无效');
        });

        test('场景 17: 纯字母 → 格式无效', () => {
            const result = extractDocParams({ query: { docnum: 'hello' } });
            expect(result._error).toBe(true);
            expect(result.message).toContain('单号格式无效');
        });

        test('场景 18: DD 后无数字 → 格式无效', () => {
            const result = extractDocParams({ query: { docnum: 'DD' } });
            expect(result._error).toBe(true);
            expect(result.message).toContain('单号格式无效');
        });

        test('场景 19: 非对象输入 (字符串) → 错误提示', () => {
            const result = extractDocParams('not-an-object');
            expect(result._error).toBe(true);
        });

        test('场景 20: 空字符串 docnum → 错误提示', () => {
            const result = extractDocParams({ query: { docnum: '' } });
            expect(result._error).toBe(true);
        });
    });
});
