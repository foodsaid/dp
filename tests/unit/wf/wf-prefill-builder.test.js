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
