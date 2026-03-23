const { extractDocNum } = require('../../../apps/wf/lib/wf-doc-param-extractor');

describe('wf-doc-param-extractor.js - 通用单号参数提取', () => {

    const woOpts = { docType: 'wo', label: '生产订单号' };
    const poOpts = { docType: 'po', label: '采购订单号' };
    const trOpts = { docType: 'tr', label: '转储申请单号', stripPrefix: /^TR/i };

    // ── 基础提取 ──

    test('从 query 参数提取单号', () => {
        const req = { query: { docnum: '12345' } };
        const result = extractDocNum(req, woOpts);
        expect(result._error).toBe(false);
        expect(result.docnum).toBe('12345');
    });

    test('从 URL 路径末段提取单号', () => {
        const req = { url: '/webhook/wms/wo/67890', headers: {} };
        const result = extractDocNum(req, woOpts);
        expect(result._error).toBe(false);
        expect(result.docnum).toBe('67890');
    });

    test('从 x-original-url 头部提取单号', () => {
        const req = { headers: { 'x-original-url': '/api/wms/po/99999' } };
        const result = extractDocNum(req, poOpts);
        expect(result._error).toBe(false);
        expect(result.docnum).toBe('99999');
    });

    test('URL 末段含查询参数时正确截断', () => {
        const req = { url: '/webhook/wms/wo/12345?user=admin' };
        const result = extractDocNum(req, woOpts);
        expect(result._error).toBe(false);
        expect(result.docnum).toBe('12345');
    });

    // ── 前缀去除 (TR 特有) ──

    test('TR 单去除 TR 前缀', () => {
        const req = { query: { docnum: 'TR100' } };
        const result = extractDocNum(req, trOpts);
        expect(result._error).toBe(false);
        expect(result.docnum).toBe('100');
    });

    test('TR 单去除小写 tr 前缀', () => {
        const req = { url: '/webhook/wms/tr/tr200' };
        const result = extractDocNum(req, trOpts);
        expect(result._error).toBe(false);
        expect(result.docnum).toBe('200');
    });

    // ── 空值校验 ──

    test('空单号返回错误', () => {
        const req = { query: {} };
        const result = extractDocNum(req, woOpts);
        expect(result._error).toBe(true);
        expect(result.message).toContain('生产订单号');
    });

    test('单号等于 docType 名称时视为空', () => {
        const req = { url: '/webhook/wms/po/po' };
        const result = extractDocNum(req, poOpts);
        expect(result._error).toBe(true);
    });

    test('单号为 undefined 字符串时视为空', () => {
        const req = { query: { docnum: 'undefined' } };
        const result = extractDocNum(req, woOpts);
        expect(result._error).toBe(true);
    });

    // ── 非数字校验 ──

    test('非数字单号返回错误', () => {
        const req = { query: { docnum: 'ABC123' } };
        const result = extractDocNum(req, poOpts);
        expect(result._error).toBe(true);
        expect(result.message).toContain('纯数字');
    });

    test('含特殊字符的单号返回错误', () => {
        const req = { query: { docnum: '123;DROP TABLE' } };
        const result = extractDocNum(req, woOpts);
        expect(result._error).toBe(true);
    });

    // ── 安全加固 ──

    test('前导零正确处理 (parseInt 安全转换)', () => {
        const req = { query: { docnum: '00789' } };
        const result = extractDocNum(req, woOpts);
        expect(result._error).toBe(false);
        expect(result.docnum).toBe('789');
    });

    // ── 异常输入 ──

    test('null 请求对象返回错误', () => {
        const result = extractDocNum(null, woOpts);
        expect(result._error).toBe(true);
    });

    test('无 opts 时使用默认标签', () => {
        const req = { query: {} };
        const result = extractDocNum(req);
        expect(result._error).toBe(true);
        expect(result.message).toContain('单号');
    });

    // ── 不同单据类型标签 ──

    test('PO 错误消息包含采购订单号', () => {
        const req = { query: { docnum: 'abc' } };
        const result = extractDocNum(req, poOpts);
        expect(result.message).toContain('采购订单号');
    });

    test('TR 错误消息包含转储申请单号', () => {
        const req = { query: {} };
        const result = extractDocNum(req, trOpts);
        expect(result.message).toContain('转储申请单号');
    });
});
