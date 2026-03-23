const { esc, escDate, buildWoPrefillSql, buildPoPrefillSql, buildTrPrefillSql, buildPiPrefillSql } = require('../../../apps/wf/lib/wf-prefill-builder');

// ── SQL 转义工具 ──

describe('wf-prefill-builder.js - esc/escDate', () => {

    test('esc: 普通字符串', () => {
        expect(esc('hello')).toBe("'hello'");
    });

    test('esc: 含单引号 → 双重转义', () => {
        expect(esc("it's")).toBe("'it''s'");
    });

    test('esc: 含反斜杠', () => {
        expect(esc('a\\b')).toBe("'a\\\\b'");
    });

    test('esc: null → NULL', () => {
        expect(esc(null)).toBe('NULL');
    });

    test('esc: undefined → NULL', () => {
        expect(esc(undefined)).toBe('NULL');
    });

    test('esc: 截断超长字符串 (>500)', () => {
        const long = 'x'.repeat(600);
        const result = esc(long);
        // 500 chars + 2 quotes
        expect(result.length).toBe(502);
    });

    test('esc: 去除 null 字节', () => {
        expect(esc('a\0b')).toBe("'ab'");
    });

    test('escDate: 有效日期', () => {
        expect(escDate('2026-03-07')).toBe("'2026-03-07'");
    });

    test('escDate: null → NULL', () => {
        expect(escDate(null)).toBe('NULL');
    });

    test('escDate: 空字符串 → NULL', () => {
        expect(escDate('')).toBe('NULL');
    });

    test('escDate: 无效日期 → NULL', () => {
        expect(escDate('not-a-date')).toBe('NULL');
    });
});

// ── WO Prefill ──

describe('wf-prefill-builder.js - buildWoPrefillSql', () => {

    const validData = {
        success: true,
        sap_order: {
            docNum: '26000123', docEntry: 456, itemCode: 'PROD-001', itemName: '产品A',
            plannedQty: 100, whsCode: 'WH01', dueDate: '2026-03-15', uom: 'PC'
        }
    };

    test('生成有效 CTE SQL', () => {
        const sql = buildWoPrefillSql(validData, 'COMP01', 'admin');
        expect(sql).toContain('WITH doc AS');
        expect(sql).toContain("'WO'");
        expect(sql).toContain("'26000123'");
        expect(sql).toContain("'COMP01'");
        expect(sql).toContain("'admin'");
        expect(sql).toContain('ON CONFLICT');
    });

    test('失败数据 → SELECT 1', () => {
        expect(buildWoPrefillSql({ success: false }, 'C', 'u')).toBe('SELECT 1');
    });

    test('null 数据 → SELECT 1', () => {
        expect(buildWoPrefillSql(null, 'C', 'u')).toBe('SELECT 1');
    });

    test('默认 user 为 SYSTEM', () => {
        const sql = buildWoPrefillSql(validData, 'C');
        expect(sql).toContain("'SYSTEM'");
    });

    test('缺少 companyCode 时抛出错误', () => {
        expect(() => buildWoPrefillSql(validData, '')).toThrow('companyCode is required');
        expect(() => buildWoPrefillSql(validData, null)).toThrow('companyCode is required');
        expect(() => buildWoPrefillSql(validData, undefined)).toThrow('companyCode is required');
    });

    test('缺少 docNum → SELECT 1', () => {
        const data = { success: true, sap_order: { docEntry: 1, itemCode: 'X' } };
        expect(buildWoPrefillSql(data, 'C', 'u')).toBe('SELECT 1');
    });

    test('docEntry 为 null → SELECT 1', () => {
        const data = { success: true, sap_order: { docNum: '1', docEntry: null } };
        expect(buildWoPrefillSql(data, 'C', 'u')).toBe('SELECT 1');
    });

    test('docEntry 为 undefined → SELECT 1', () => {
        const data = { success: true, sap_order: { docNum: '1' } };
        expect(buildWoPrefillSql(data, 'C', 'u')).toBe('SELECT 1');
    });

    test('缺少 sap_order → SELECT 1', () => {
        expect(buildWoPrefillSql({ success: true }, 'C', 'u')).toBe('SELECT 1');
    });

    test('dueDate 为 null → SQL 中出现 NULL', () => {
        const data = { success: true, sap_order: { docNum: '1', docEntry: 1, itemCode: 'X' } };
        const sql = buildWoPrefillSql(data, 'C', 'u');
        expect(sql).toContain('NULL');
    });

    test('SAP 可选字段全缺时 SQL 安全生成 (触发 || 默认分支)', () => {
        // 仅保留必填的 docNum + docEntry，其余字段全部缺失
        const data = { success: true, sap_order: { docNum: '99', docEntry: 1 } };
        const sql = buildWoPrefillSql(data, 'C', 'u');
        expect(sql).toContain('WITH doc AS');
        expect(sql).toContain("'WO'");
        // plannedQty || 0 → 0
        expect(sql).toContain(', 0,');
    });

    test('WO 单行 line_num 固定为 0 (SAP B1 行项目 ID 从 0 开始)', () => {
        const sql = buildWoPrefillSql(validData, 'C', 'u');
        // WO 是单行工单，行号固定写 0
        expect(sql).toContain(', 0,');
    });
});

// ── PO Prefill ──

describe('wf-prefill-builder.js - buildPoPrefillSql', () => {

    const validData = {
        success: true,
        sap_order: {
            docNum: '500', docEntry: 501, cardCode: 'V001', cardName: '供应商A',
            docDueDate: '2026-04-01',
            lines: [
                { lineNum: 0, itemCode: 'M001', itemName: '原料A', uom: 'KG', openQty: 80, whsCode: 'WH01' },
                { lineNum: 1, itemCode: 'M002', itemName: '原料B', uom: 'PC', openQty: 50, whsCode: 'WH02' }
            ]
        }
    };

    test('多行 PO SQL', () => {
        const sql = buildPoPrefillSql(validData, 'COMP01', 'admin');
        expect(sql).toContain("'PO'");
        expect(sql).toContain("'M001'");
        expect(sql).toContain("'M002'");
        expect(sql).toContain("'V001'");
    });

    test('无行数据 → SELECT 1', () => {
        const data = { success: true, sap_order: { lines: [] } };
        expect(buildPoPrefillSql(data, 'C', 'u')).toBe('SELECT 1');
    });

    test('缺少 companyCode 时抛出错误', () => {
        expect(() => buildPoPrefillSql(validData, '')).toThrow('companyCode is required');
        expect(() => buildPoPrefillSql(validData, null)).toThrow('companyCode is required');
    });

    test('缺少 docNum → SELECT 1', () => {
        const data = { success: true, sap_order: { docEntry: 1, lines: [{ lineNum: 0 }] } };
        expect(buildPoPrefillSql(data, 'C', 'u')).toBe('SELECT 1');
    });

    test('docEntry 为 null → SELECT 1', () => {
        const data = { success: true, sap_order: { docNum: '1', docEntry: null, lines: [{ lineNum: 0 }] } };
        expect(buildPoPrefillSql(data, 'C', 'u')).toBe('SELECT 1');
    });

    test('docEntry 为 undefined → SELECT 1', () => {
        const data = { success: true, sap_order: { docNum: '1', lines: [{ lineNum: 0 }] } };
        expect(buildPoPrefillSql(data, 'C', 'u')).toBe('SELECT 1');
    });

    test('缺少 lines 属性 → SELECT 1', () => {
        expect(buildPoPrefillSql({ success: true, sap_order: { docNum: '1', docEntry: 1 } }, 'C', 'u')).toBe('SELECT 1');
    });

    test('默认 user 为 SYSTEM', () => {
        const sql = buildPoPrefillSql(validData, 'C');
        expect(sql).toContain("'SYSTEM'");
    });

    test('行字段全缺时 SQL 使用安全默认值 (触发 || 分支)', () => {
        const data = {
            success: true,
            sap_order: {
                docNum: '1', docEntry: 1,
                lines: [{ lineNum: 0, itemCode: 'A' }]
            }
        };
        const sql = buildPoPrefillSql(data, 'C', 'u');
        expect(sql).toContain("'PO'");
        // openQty || 0 → 0
        expect(sql).toContain(', 0,');
    });

    test('SAP B1 LineNum=0 作为合法第一行写入 SQL (对账一致性)', () => {
        // SAP B1 10.0 MS SQL 行项目 LineNum 从 0 开始
        const data = {
            success: true,
            sap_order: {
                docNum: '500', docEntry: 501, cardCode: 'V001',
                lines: [
                    { lineNum: 0, itemCode: 'M001', itemName: '原料A', openQty: 80, whsCode: 'WH01' },
                    { lineNum: 1, itemCode: 'M002', itemName: '原料B', openQty: 50, whsCode: 'WH02' }
                ]
            }
        };
        const sql = buildPoPrefillSql(data, 'C', 'u');
        // 验证 LineNum=0 出现在 SQL VALUES 中 (不能被跳过)
        expect(sql).toMatch(/\(SELECT id FROM doc\), 0,/);
        expect(sql).toMatch(/\(SELECT id FROM doc\), 1,/);
    });
});

// ── TR Prefill ──

describe('wf-prefill-builder.js - buildTrPrefillSql', () => {

    const validData = {
        success: true,
        sap_order: {
            docNum: '600', docEntry: 601, filler: 'V002', toWhsCode: 'WH02',
            lines: [
                { lineNum: 0, itemCode: 'T001', itemName: '调拨料', openQty: 200, whsCode: 'WH02', fromWhsCod: 'WH01' }
            ]
        }
    };

    test('TR SQL 含 from_warehouse/to_warehouse', () => {
        const sql = buildTrPrefillSql(validData, 'COMP01', 'admin');
        expect(sql).toContain("'TR'");
        expect(sql).toContain('from_warehouse');
        expect(sql).toContain("'WH01'");
        expect(sql).toContain("'WH02'");
    });

    test('null → SELECT 1', () => {
        expect(buildTrPrefillSql(null, 'C', 'u')).toBe('SELECT 1');
    });

    test('缺少 companyCode 时抛出错误', () => {
        expect(() => buildTrPrefillSql(validData, '')).toThrow('companyCode is required');
        expect(() => buildTrPrefillSql(validData, null)).toThrow('companyCode is required');
    });

    test('缺少 docNum → SELECT 1', () => {
        const data = { success: true, sap_order: { docEntry: 1, lines: [{ lineNum: 0 }] } };
        expect(buildTrPrefillSql(data, 'C', 'u')).toBe('SELECT 1');
    });

    test('docEntry 为 null → SELECT 1', () => {
        const data = { success: true, sap_order: { docNum: '1', docEntry: null, lines: [{ lineNum: 0 }] } };
        expect(buildTrPrefillSql(data, 'C', 'u')).toBe('SELECT 1');
    });

    test('docEntry 为 undefined → SELECT 1', () => {
        const data = { success: true, sap_order: { docNum: '1', lines: [{ lineNum: 0 }] } };
        expect(buildTrPrefillSql(data, 'C', 'u')).toBe('SELECT 1');
    });

    test('缺少 lines → SELECT 1', () => {
        expect(buildTrPrefillSql({ success: true, sap_order: { docNum: '1', docEntry: 1 } }, 'C', 'u')).toBe('SELECT 1');
    });

    test('默认 user 为 SYSTEM', () => {
        const sql = buildTrPrefillSql(validData, 'C');
        expect(sql).toContain("'SYSTEM'");
    });

    test('filler 缺失时 SQL 使用空字符串', () => {
        const data = {
            success: true,
            sap_order: {
                docNum: '600', docEntry: 601,
                lines: [{ lineNum: 0, itemCode: 'T001', openQty: 10, whsCode: 'WH02', fromWhsCod: 'WH01' }]
            }
        };
        const sql = buildTrPrefillSql(data, 'C', 'u');
        expect(sql).toContain("'TR'");
        expect(sql).toContain('from_warehouse');
    });

    test('行字段全缺时 SQL 使用安全默认值 (触发 || 分支)', () => {
        const data = {
            success: true,
            sap_order: {
                docNum: '1', docEntry: 1,
                lines: [{ lineNum: 0, itemCode: 'A' }]
            }
        };
        const sql = buildTrPrefillSql(data, 'C', 'u');
        expect(sql).toContain("'TR'");
        expect(sql).toContain('from_warehouse');
        // openQty || 0 → 0
        expect(sql).toContain(', 0,');
    });

    test('SAP B1 LineNum=0 作为合法第一行写入 SQL (对账一致性)', () => {
        const sql = buildTrPrefillSql(validData, 'C', 'u');
        // LineNum=0 必须出现在 VALUES 中
        expect(sql).toMatch(/\(SELECT id FROM doc\), 0,/);
    });
});

// ── PI Prefill ──

describe('wf-prefill-builder.js - buildPiPrefillSql', () => {

    const validData = {
        success: true,
        sap_order: {
            docNum: '700', docEntry: 701, productCode: 'FG-001', productName: '成品A',
            whsCode: 'WH01', dueDate: '2026-05-01',
            lines: [
                { lineNum: 0, itemCode: 'BOM-01', itemName: 'BOM料1', uom: 'PC', baseQty: 50, whsCode: 'WH01' },
                { lineNum: 1, itemCode: 'BOM-02', itemName: 'BOM料2', uom: 'KG', baseQty: 30, whsCode: 'WH01' }
            ]
        }
    };

    test('PI SQL 使用 baseQty', () => {
        const sql = buildPiPrefillSql(validData, 'COMP01', 'admin');
        expect(sql).toContain("'PI'");
        expect(sql).toContain("'BOM-01'");
        expect(sql).toContain('50');
        expect(sql).toContain('30');
    });

    test('无行 → SELECT 1', () => {
        const data = { success: true, sap_order: { lines: [] } };
        expect(buildPiPrefillSql(data, 'C', 'u')).toBe('SELECT 1');
    });

    test('缺少 companyCode 时抛出错误', () => {
        expect(() => buildPiPrefillSql(validData, '')).toThrow('companyCode is required');
        expect(() => buildPiPrefillSql(validData, null)).toThrow('companyCode is required');
    });

    test('缺少 docNum → SELECT 1', () => {
        const data = { success: true, sap_order: { docEntry: 1, lines: [{ lineNum: 0 }] } };
        expect(buildPiPrefillSql(data, 'C', 'u')).toBe('SELECT 1');
    });

    test('docEntry 为 null → SELECT 1', () => {
        const data = { success: true, sap_order: { docNum: '1', docEntry: null, lines: [{ lineNum: 0 }] } };
        expect(buildPiPrefillSql(data, 'C', 'u')).toBe('SELECT 1');
    });

    test('docEntry 为 undefined → SELECT 1', () => {
        const data = { success: true, sap_order: { docNum: '1', lines: [{ lineNum: 0 }] } };
        expect(buildPiPrefillSql(data, 'C', 'u')).toBe('SELECT 1');
    });

    test('缺少 lines → SELECT 1', () => {
        expect(buildPiPrefillSql({ success: true, sap_order: { docNum: '1', docEntry: 1 } }, 'C', 'u')).toBe('SELECT 1');
    });

    test('默认 user 为 SYSTEM', () => {
        const sql = buildPiPrefillSql(validData, 'C');
        expect(sql).toContain("'SYSTEM'");
    });

    test('order.whsCode 缺失时 fallback 到 lines[0].whsCode', () => {
        const data = {
            success: true,
            sap_order: {
                docNum: '700', docEntry: 701,
                lines: [{ lineNum: 0, itemCode: 'BOM-01', baseQty: 50, whsCode: 'WH-LINE' }]
            }
        };
        const sql = buildPiPrefillSql(data, 'C', 'u');
        expect(sql).toContain("'WH-LINE'");
    });

    test('行字段全缺时 SQL 使用安全默认值 (触发 || 分支)', () => {
        const data = {
            success: true,
            sap_order: {
                docNum: '1', docEntry: 1,
                lines: [{ lineNum: 0, itemCode: 'A' }]
            }
        };
        const sql = buildPiPrefillSql(data, 'C', 'u');
        expect(sql).toContain("'PI'");
        // baseQty || 0 → 0
        expect(sql).toContain(', 0,');
    });

    test('order 和 lines 都缺 whsCode 时使用空字符串', () => {
        const data = {
            success: true,
            sap_order: {
                docNum: '1', docEntry: 1,
                lines: [{ lineNum: 0, itemCode: 'A' }]
            }
        };
        const sql = buildPiPrefillSql(data, 'C', 'u');
        expect(sql).toContain("''"); // 空字符串
    });

    test('SAP B1 LineNum=0 作为合法 BOM 第一行写入 SQL (对账一致性)', () => {
        // SAP B1 10.0 MS SQL 行项目 LineNum 从 0 开始，BOM 行也遵循此规则
        const sql = buildPiPrefillSql(validData, 'C', 'u');
        expect(sql).toMatch(/\(SELECT id FROM doc\), 0,/);
        expect(sql).toMatch(/\(SELECT id FROM doc\), 1,/);
    });

    test('SQL 注入防护: 单引号转义', () => {
        const data = {
            success: true,
            sap_order: {
                docNum: '800', docEntry: 801, productCode: "O'Malley", productName: "Test'Name",
                whsCode: 'WH01', dueDate: '2026-05-01',
                lines: [{ lineNum: 0, itemCode: "A'B", itemName: 'X', uom: 'PC', baseQty: 10, whsCode: 'WH01' }]
            }
        };
        const sql = buildPiPrefillSql(data, 'COMP01', 'admin');
        expect(sql).toContain("'O''Malley'");
        expect(sql).toContain("'A''B'");
        expect(sql).not.toContain("O'Malley'"); // 未转义的单引号不应出现
    });
});
