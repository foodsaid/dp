const { generateCsvString, escapeCsvField, DEFAULT_HEADERS } = require('../../../apps/wf/lib/wf05-csv-builder');

describe('wf05-csv-builder.js - CSV 导出核心构建逻辑', () => {

    // ========== escapeCsvField 转义函数 ==========

    describe('escapeCsvField - RFC 4180 转义', () => {

        test('null 值回退为空双引号', () => {
            expect(escapeCsvField(null)).toBe('""');
        });

        test('undefined 值回退为空双引号', () => {
            expect(escapeCsvField(undefined)).toBe('""');
        });

        test('普通字符串用双引号包裹', () => {
            expect(escapeCsvField('hello')).toBe('"hello"');
        });

        test('含逗号的字符串安全包裹', () => {
            expect(escapeCsvField('hello,world')).toBe('"hello,world"');
        });

        test('含双引号的恶意文本正确转义 (双引号加倍)', () => {
            expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
        });

        test('同时含逗号和双引号的复杂恶意文本', () => {
            expect(escapeCsvField('a,"b",c')).toBe('"a,""b"",c"');
        });

        test('含换行符的字段安全包裹', () => {
            expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
        });

        test('数值类型自动转为字符串', () => {
            expect(escapeCsvField(42)).toBe('"42"');
        });

        test('布尔类型自动转为字符串', () => {
            expect(escapeCsvField(true)).toBe('"true"');
        });

        test('空字符串输出双引号包裹', () => {
            expect(escapeCsvField('')).toBe('""');
        });
    });

    // ========== DEFAULT_HEADERS 表头 ==========

    describe('DEFAULT_HEADERS - 默认表头', () => {

        test('包含 19 个标准列', () => {
            expect(DEFAULT_HEADERS.length).toBe(19);
        });

        test('包含关键列名', () => {
            expect(DEFAULT_HEADERS).toContain('doc_type');
            expect(DEFAULT_HEADERS).toContain('direction');
            expect(DEFAULT_HEADERS).toContain('transaction_time');
        });
    });

    // ========== generateCsvString 主函数 ==========

    describe('generateCsvString - CSV 生成核心', () => {

        test('非数组输入抛出异常', () => {
            expect(() => generateCsvString(null)).toThrow('Invalid input: data must be an array');
            expect(() => generateCsvString('string')).toThrow('Invalid input: data must be an array');
            expect(() => generateCsvString(123)).toThrow('Invalid input: data must be an array');
            expect(() => generateCsvString(undefined)).toThrow('Invalid input: data must be an array');
        });

        test('空数组返回仅表头的 CSV (含 BOM)', () => {
            const result = generateCsvString([]);
            expect(result.dataCount).toBe(0);
            expect(result.content.startsWith('\uFEFF')).toBe(true);
            // 只有表头行
            const lines = result.content.replace('\uFEFF', '').split('\n');
            expect(lines.length).toBe(1);
            expect(lines[0]).toBe(DEFAULT_HEADERS.join(','));
        });

        test('空数组 + bom=false 无 BOM 前缀', () => {
            const result = generateCsvString([], { bom: false });
            expect(result.content.startsWith('\uFEFF')).toBe(false);
            expect(result.content.startsWith('doc_type')).toBe(true);
        });

        test('bom 选项默认为 true', () => {
            const result = generateCsvString([]);
            expect(result.content.charCodeAt(0)).toBe(0xFEFF);
        });

        test('跳过 doc_type 为空的无效行', () => {
            const data = [
                { doc_type: '', item_code: 'A001' },
                { item_code: 'A002' },
                null,
                { doc_type: 'SO', doc_number: 'D001', item_code: 'A003', actual_qty: 5 }
            ];
            const result = generateCsvString(data);
            expect(result.dataCount).toBe(1);
        });

        test('标准 SO 行正确生成 CSV', () => {
            const data = [{
                doc_type: 'SO', doc_number: 'SO001', sap_doc_num: '12345',
                warehouse_code: 'W01', wms_status: 'completed', doc_date: '2026-03-01',
                created_by: 'admin', line_num: 1, item_code: 'A001',
                item_name: '测试物料', uom: 'EA', planned_qty: 10,
                actual_qty: 8, bin_location: 'B01', batch_number: 'BT01',
                serial_number: 'SN01', tx_operator: null, transaction_time: '2026-03-01 10:00:00'
            }];
            const result = generateCsvString(data, { bom: false });
            expect(result.dataCount).toBe(1);
            const lines = result.content.split('\n');
            expect(lines.length).toBe(2);
            // 验证 direction 为空
            expect(lines[1]).toContain('""');
            // operator 回退到 created_by
            expect(lines[1]).toContain('"admin"');
        });

        test('有 tx_qty 时使用 tx_qty 而非 actual_qty', () => {
            const data = [{
                doc_type: 'SO', doc_number: 'SO001',
                tx_qty: 5, actual_qty: 100, item_code: 'A001'
            }];
            const result = generateCsvString(data, { bom: false });
            const lines = result.content.split('\n');
            // tx_qty=5 应被使用
            expect(lines[1]).toContain('"5"');
        });

        test('tx_qty 为 null 时回退到 actual_qty', () => {
            const data = [{
                doc_type: 'PO', doc_number: 'PO001',
                tx_qty: null, actual_qty: 20, item_code: 'A001'
            }];
            const result = generateCsvString(data, { bom: false });
            expect(result.content).toContain('"20"');
        });

        test('tx_qty 为 undefined 时回退到 actual_qty', () => {
            const data = [{
                doc_type: 'WO', doc_number: 'WO001',
                actual_qty: 15, item_code: 'A001'
            }];
            const result = generateCsvString(data, { bom: false });
            expect(result.content).toContain('"15"');
        });

        test('tx_qty 为 0 时使用 0 (不回退到 actual_qty)', () => {
            const data = [{
                doc_type: 'SO', doc_number: 'SO001',
                tx_qty: 0, actual_qty: 100, item_code: 'A001'
            }];
            const result = generateCsvString(data, { bom: false });
            const lines = result.content.split('\n');
            // tx_qty=0 应被使用 (0 不是 null/undefined)
            expect(lines[1]).toContain('"0"');
        });

        test('自定义 headers 选项', () => {
            const result = generateCsvString([], { bom: false, headers: ['col1', 'col2'] });
            expect(result.content).toBe('col1,col2');
        });

        test('options 为 undefined 时使用默认值', () => {
            const result = generateCsvString([]);
            expect(result.content.startsWith('\uFEFF')).toBe(true);
        });

        test('tx_operator 存在时优先使用', () => {
            const data = [{
                doc_type: 'SO', doc_number: 'SO001', item_code: 'A001',
                created_by: 'admin', tx_operator: 'picker1', actual_qty: 1
            }];
            const result = generateCsvString(data, { bom: false });
            expect(result.content).toContain('"picker1"');
        });
    });

    // ========== LM/TR 借贷拆分 ==========

    describe('LM/TR 借贷拆分逻辑', () => {

        test('LM 类型: 有 tx_from_bin 时拆分为借贷两行', () => {
            const data = [{
                doc_type: 'LM', doc_number: 'LM001', sap_doc_num: '',
                warehouse_code: 'W01', wms_status: 'completed', doc_date: '2026-03-01',
                created_by: 'admin', line_num: 1, item_code: 'A001',
                item_name: '物料A', uom: 'EA', planned_qty: 10,
                actual_qty: 10, tx_qty: 10,
                tx_from_bin: 'B01', tx_to_bin: 'B02',
                batch_number: '', serial_number: '',
                tx_operator: 'worker1', transaction_time: '2026-03-01 10:00:00'
            }];
            const result = generateCsvString(data, { bom: false });
            expect(result.dataCount).toBe(2);
            const lines = result.content.split('\n');
            expect(lines.length).toBe(3); // 表头 + 贷行 + 借行
            expect(lines[1]).toContain('"贷(出)"');
            expect(lines[1]).toContain('"-10"'); // 负数
            expect(lines[2]).toContain('"借(入)"');
            expect(lines[2]).toContain('"10"'); // 正数
        });

        test('TR 类型: 有 tx_from_warehouse 时正确使用源/目标仓库', () => {
            const data = [{
                doc_type: 'TR', doc_number: 'TR001',
                warehouse_code: 'W01',
                tx_from_warehouse: 'W-FROM', tx_warehouse_code: 'W-TO',
                tx_from_bin: 'B-SRC', tx_to_bin: 'B-DST',
                item_code: 'A001', line_num: 1,
                actual_qty: 5, tx_qty: 5,
                created_by: 'admin'
            }];
            const result = generateCsvString(data, { bom: false });
            expect(result.dataCount).toBe(2);
            const lines = result.content.split('\n');
            // 贷行使用源仓库 W-FROM
            expect(lines[1]).toContain('"W-FROM"');
            // 借行使用目标仓库 W-TO
            expect(lines[2]).toContain('"W-TO"');
        });

        test('LM 无 tx_from_bin 也无 tx_from_warehouse 时不拆分', () => {
            const data = [{
                doc_type: 'LM', doc_number: 'LM001', item_code: 'A001',
                actual_qty: 10, created_by: 'admin'
            }];
            const result = generateCsvString(data, { bom: false });
            expect(result.dataCount).toBe(1);
            const lines = result.content.split('\n');
            expect(lines.length).toBe(2); // 表头 + 1行
        });

        test('LM tx_qty 为 NaN 时回退到 actual_qty', () => {
            const data = [{
                doc_type: 'LM', doc_number: 'LM001', item_code: 'A001',
                tx_from_bin: 'B01', tx_qty: 'abc', actual_qty: 7,
                created_by: 'admin'
            }];
            const result = generateCsvString(data, { bom: false });
            expect(result.dataCount).toBe(2);
            expect(result.content).toContain('"-7"');
            expect(result.content).toContain('"7"');
        });

        test('TR tx_qty 和 actual_qty 都无效时使用 0', () => {
            const data = [{
                doc_type: 'TR', doc_number: 'TR001', item_code: 'A001',
                tx_from_bin: 'B01', tx_qty: null, actual_qty: null,
                created_by: 'admin'
            }];
            const result = generateCsvString(data, { bom: false });
            expect(result.dataCount).toBe(2);
            // -0 === 0，所以贷行和借行都显示 "0"
            const lines = result.content.split('\n');
            expect(lines[1]).toContain('"0"');
            expect(lines[1]).toContain('"贷(出)"');
            expect(lines[2]).toContain('"0"');
            expect(lines[2]).toContain('"借(入)"');
        });

        test('LM 借行无 tx_to_bin 时回退到 bin_location', () => {
            const data = [{
                doc_type: 'LM', doc_number: 'LM001', item_code: 'A001',
                tx_from_bin: 'B-SRC', bin_location: 'B-FALLBACK',
                actual_qty: 3, created_by: 'admin'
            }];
            const result = generateCsvString(data, { bom: false });
            const lines = result.content.split('\n');
            // 借行的 bin_location 应回退到 bin_location 字段
            expect(lines[2]).toContain('"B-FALLBACK"');
        });

        test('TR tx_from_warehouse 为空但 tx_from_bin 存在时仍拆分', () => {
            const data = [{
                doc_type: 'TR', doc_number: 'TR001', item_code: 'A001',
                warehouse_code: 'W01', tx_from_bin: 'B01',
                tx_from_warehouse: '', tx_warehouse_code: '',
                actual_qty: 10, created_by: 'admin'
            }];
            const result = generateCsvString(data, { bom: false });
            expect(result.dataCount).toBe(2);
        });

        test('LM 贷行使用 tx_from_bin 作为 bin_location', () => {
            const data = [{
                doc_type: 'LM', doc_number: 'LM001', item_code: 'A001',
                tx_from_bin: 'SRC-BIN', tx_to_bin: 'DST-BIN',
                actual_qty: 5, created_by: 'admin'
            }];
            const result = generateCsvString(data, { bom: false });
            const lines = result.content.split('\n');
            expect(lines[1]).toContain('"SRC-BIN"');
            expect(lines[2]).toContain('"DST-BIN"');
        });
    });

    // ========== 恶意数据/边界条件 ==========

    describe('恶意数据和边界条件', () => {

        test('含中文逗号和特殊字符的字段名正确转义', () => {
            const data = [{
                doc_type: 'SO', doc_number: 'SO001', item_code: 'A001',
                item_name: '测试，物料"名称"', actual_qty: 1, created_by: 'admin'
            }];
            const result = generateCsvString(data, { bom: false });
            expect(result.content).toContain('"测试，物料""名称"""');
        });

        test('所有字段为 null/undefined 的行被跳过 (无 doc_type)', () => {
            const data = [
                { doc_type: null },
                { doc_type: undefined },
                {}
            ];
            const result = generateCsvString(data, { bom: false });
            expect(result.dataCount).toBe(0);
        });

        test('多行混合数据正确计数', () => {
            const data = [
                { doc_type: 'SO', doc_number: 'S1', item_code: 'A', actual_qty: 1 },
                { doc_type: 'PO', doc_number: 'P1', item_code: 'B', actual_qty: 2 },
                null,
                { doc_type: 'WO', doc_number: 'W1', item_code: 'C', actual_qty: 3 }
            ];
            const result = generateCsvString(data, { bom: false });
            expect(result.dataCount).toBe(3);
        });
    });
});
