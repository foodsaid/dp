const {
    mapOmsOrderToWmsSchema,
    toNumber, toStr, parseDate,
    buildHashInput, filterFields,
    ORDER_FIELDS, LINE_FIELDS
} = require('../../../apps/wf/lib/wf20-oms-mapper');

describe('wf20-oms-mapper.js - OMS 订单数据映射核心逻辑', () => {

    // ========== 辅助函数 ==========

    describe('toNumber - 类型安全数值转换', () => {

        test('正常数值直接返回', () => {
            expect(toNumber(42)).toBe(42);
            expect(toNumber(3.14)).toBe(3.14);
            expect(toNumber(-10)).toBe(-10);
        });

        test('字符串数字正确转换', () => {
            expect(toNumber('100')).toBe(100);
            expect(toNumber('3.14')).toBe(3.14);
        });

        test('null 使用默认 fallback 0', () => {
            expect(toNumber(null)).toBe(0);
        });

        test('undefined 使用默认 fallback 0', () => {
            expect(toNumber(undefined)).toBe(0);
        });

        test('NaN 字符串使用默认 fallback 0', () => {
            expect(toNumber('abc')).toBe(0);
        });

        test('自定义 fallback 为 null', () => {
            expect(toNumber(null, null)).toBeNull();
            expect(toNumber(undefined, null)).toBeNull();
            expect(toNumber('abc', null)).toBeNull();
        });

        test('有效值忽略 fallback', () => {
            expect(toNumber(42, null)).toBe(42);
            expect(toNumber('100', null)).toBe(100);
        });

        test('0 正确返回 0', () => {
            expect(toNumber(0)).toBe(0);
            expect(toNumber('0')).toBe(0);
        });
    });

    describe('toStr - 字符串安全转换', () => {

        test('正常字符串直接返回', () => {
            expect(toStr('hello')).toBe('hello');
        });

        test('null 回退为空字符串', () => {
            expect(toStr(null)).toBe('');
        });

        test('undefined 回退为空字符串', () => {
            expect(toStr(undefined)).toBe('');
        });

        test('数值转为字符串', () => {
            expect(toStr(42)).toBe('42');
        });
    });

    describe('parseDate - 日期解析', () => {

        test('标准 YYYY-MM-DD 格式直接返回', () => {
            expect(parseDate('2026-03-01')).toBe('2026-03-01');
        });

        test('带时间的 ISO 格式提取日期部分', () => {
            expect(parseDate('2026-03-01T10:00:00Z')).toBe('2026-03-01');
        });

        test('null 返回 null', () => {
            expect(parseDate(null)).toBeNull();
        });

        test('undefined 返回 null', () => {
            expect(parseDate(undefined)).toBeNull();
        });

        test('空字符串返回 null', () => {
            expect(parseDate('')).toBeNull();
        });

        test('0 (falsy) 返回 null', () => {
            expect(parseDate(0)).toBeNull();
        });

        test('无法解析的字符串返回 null', () => {
            expect(parseDate('not-a-date')).toBeNull();
        });

        test('Date 对象的 toString 格式可解析', () => {
            // new Date('2026-06-15') → 'Mon Jun 15 2026 ...'
            const result = parseDate(new Date('2026-06-15').toString());
            expect(result).toBe('2026-06-15');
        });
    });

    describe('buildHashInput - 哈希源字符串构建', () => {

        test('包含所有关键字段', () => {
            const order = {
                sap_status: 'O', sap_cancelled: 'N',
                doc_total: 1000, business_partner: 'C001',
                lines: [{}, {}],
                header_item_code: 'WO-ITEM',
                header_planned_qty: 100, header_actual_qty: 50
            };
            const hash = buildHashInput(order);
            expect(hash).toBe('O|N|1000|C001|2|WO-ITEM|100|50');
        });

        test('WO 特有字段为 null 时使用空字符串', () => {
            const order = {
                sap_status: 'C', sap_cancelled: 'Y',
                doc_total: 0, business_partner: '',
                lines: [],
                header_item_code: null,
                header_planned_qty: null, header_actual_qty: null
            };
            const hash = buildHashInput(order);
            expect(hash).toBe('C|Y|0||0|||');
        });

        test('lines 缺失时长度为 0', () => {
            const order = { sap_status: 'O' };
            const hash = buildHashInput(order);
            expect(hash).toContain('|0|');
        });
    });

    describe('filterFields - 白名单字段过滤', () => {

        test('只保留白名单字段', () => {
            const obj = { a: 1, b: 2, c: 3, d: 4 };
            const result = filterFields(obj, ['a', 'c']);
            expect(result).toEqual({ a: 1, c: 3 });
        });

        test('白名单中不存在的字段不包含', () => {
            const obj = { a: 1 };
            const result = filterFields(obj, ['a', 'b', 'c']);
            expect(result).toEqual({ a: 1 });
        });

        test('空对象返回空对象', () => {
            expect(filterFields({}, ['a', 'b'])).toEqual({});
        });

        test('空白名单返回空对象', () => {
            expect(filterFields({ a: 1, b: 2 }, [])).toEqual({});
        });
    });

    describe('ORDER_FIELDS / LINE_FIELDS 白名单', () => {

        test('ORDER_FIELDS 包含关键字段', () => {
            expect(ORDER_FIELDS).toContain('doc_type');
            expect(ORDER_FIELDS).toContain('sap_doc_entry');
            expect(ORDER_FIELDS).toContain('lines');
            expect(ORDER_FIELDS).toContain('sap_data_hash');
            expect(ORDER_FIELDS).toContain('header_item_code');
        });

        test('LINE_FIELDS 包含关键字段', () => {
            expect(LINE_FIELDS).toContain('line_num');
            expect(LINE_FIELDS).toContain('item_code');
            expect(LINE_FIELDS).toContain('quantity');
            expect(LINE_FIELDS).toContain('ship_date');
        });
    });

    // ========== mapOmsOrderToWmsSchema 主函数 ==========

    describe('mapOmsOrderToWmsSchema - 订单映射核心', () => {

        test('非数组输入抛出异常', () => {
            expect(() => mapOmsOrderToWmsSchema(null)).toThrow('Invalid input: rawOmsData must be an array');
            expect(() => mapOmsOrderToWmsSchema('string')).toThrow('Invalid input: rawOmsData must be an array');
            expect(() => mapOmsOrderToWmsSchema(123)).toThrow('Invalid input: rawOmsData must be an array');
            expect(() => mapOmsOrderToWmsSchema(undefined)).toThrow('Invalid input: rawOmsData must be an array');
        });

        test('空数组返回空数组', () => {
            expect(mapOmsOrderToWmsSchema([])).toEqual([]);
        });

        test('缺少 doc_type 的行抛出异常', () => {
            const data = [{ sap_doc_entry: 1, item_code: 'A001' }];
            expect(() => mapOmsOrderToWmsSchema(data)).toThrow('doc_type is required');
        });

        test('缺少 sap_doc_entry (doc_number) 的行抛出异常', () => {
            const data = [{ doc_type: 'SO', item_code: 'A001', sap_doc_entry: null }];
            expect(() => mapOmsOrderToWmsSchema(data)).toThrow('sap_doc_entry (doc_number) is required');
        });

        test('所有行缺少 item_code 时抛出异常', () => {
            const data = [{ doc_type: 'SO', sap_doc_entry: 1 }];
            expect(() => mapOmsOrderToWmsSchema(data)).toThrow('at least one row must have item_code');
        });

        test('标准 SO 订单正确映射', () => {
            const data = [
                {
                    doc_type: 'SO', sap_doc_entry: 1001, sap_doc_num: '5001',
                    business_partner: 'C001', bp_name: '客户A',
                    doc_date: '2026-03-01', due_date: '2026-03-15',
                    sap_status: 'O', sap_cancelled: 'N',
                    doc_total: 5000, doc_currency: 'THB',
                    sap_update_date: '2026-03-01', sap_update_time: '10:00:00',
                    line_num: 1, item_code: 'A001', item_name: '物料A',
                    quantity: 100, open_quantity: 80, warehouse_code: 'W01',
                    uom: 'EA', ship_date: '2026-03-10'
                },
                {
                    doc_type: 'SO', sap_doc_entry: 1001, sap_doc_num: '5001',
                    business_partner: 'C001', bp_name: '客户A',
                    doc_date: '2026-03-01', due_date: '2026-03-15',
                    sap_status: 'O', sap_cancelled: 'N',
                    doc_total: 5000, doc_currency: 'THB',
                    sap_update_date: '2026-03-01', sap_update_time: '10:00:00',
                    line_num: 2, item_code: 'B002', item_name: '物料B',
                    quantity: 50, open_quantity: 50, warehouse_code: 'W01',
                    uom: 'KG', ship_date: '2026-03-10'
                }
            ];
            const orders = mapOmsOrderToWmsSchema(data);
            expect(orders.length).toBe(1);
            expect(orders[0].doc_type).toBe('SO');
            expect(orders[0].sap_doc_entry).toBe(1001);
            expect(orders[0].doc_number).toBe('5001');
            expect(orders[0].lines.length).toBe(2);
            expect(orders[0].lines[0].item_code).toBe('A001');
            expect(orders[0].lines[1].quantity).toBe(50);
        });

        test('WO 订单映射 header 特殊字段', () => {
            const data = [{
                doc_type: 'WO', sap_doc_entry: 2001, sap_doc_num: '6001',
                header_item_code: 'FG-001', header_item_name: '成品A',
                header_planned_qty: 1000, header_actual_qty: 500,
                header_warehouse: 'W-PROD',
                line_num: 1, item_code: 'RM-001', item_name: '原料A',
                quantity: 500, open_quantity: 250, warehouse_code: 'W-RAW', uom: 'KG'
            }];
            const orders = mapOmsOrderToWmsSchema(data);
            expect(orders[0].header_item_code).toBe('FG-001');
            expect(orders[0].header_planned_qty).toBe(1000);
            expect(orders[0].header_actual_qty).toBe(500);
            expect(orders[0].header_warehouse).toBe('W-PROD');
        });

        test('header 特殊字段为 null 时保持 null (非空字符串)', () => {
            const data = [{
                doc_type: 'SO', sap_doc_entry: 3001, sap_doc_num: '7001',
                line_num: 1, item_code: 'A001', quantity: 10
            }];
            const orders = mapOmsOrderToWmsSchema(data);
            expect(orders[0].header_item_code).toBeNull();
            expect(orders[0].header_planned_qty).toBeNull();
            expect(orders[0].header_actual_qty).toBeNull();
            expect(orders[0].header_warehouse).toBeNull();
        });

        test('字符串→数字类型安全转换', () => {
            const data = [{
                doc_type: 'PO', sap_doc_entry: '4001', sap_doc_num: '8001',
                doc_total: '12345.67',
                line_num: '1', item_code: 'A001',
                quantity: '100', open_quantity: '80',
                warehouse_code: 'W01', uom: 'EA'
            }];
            const orders = mapOmsOrderToWmsSchema(data);
            expect(orders[0].sap_doc_entry).toBe(4001);
            expect(orders[0].doc_total).toBe(12345.67);
            expect(orders[0].lines[0].line_num).toBe(1);
            expect(orders[0].lines[0].quantity).toBe(100);
        });

        test('日期字段正确解析', () => {
            const data = [{
                doc_type: 'SO', sap_doc_entry: 5001, sap_doc_num: '9001',
                doc_date: '2026-03-01T08:00:00Z', due_date: '2026-03-31',
                sap_update_date: '2026-03-01',
                line_num: 1, item_code: 'A001', ship_date: '2026-03-15T00:00:00'
            }];
            const orders = mapOmsOrderToWmsSchema(data);
            expect(orders[0].doc_date).toBe('2026-03-01');
            expect(orders[0].due_date).toBe('2026-03-31');
            expect(orders[0].lines[0].ship_date).toBe('2026-03-15');
        });

        test('脏字段自动过滤 (只保留白名单)', () => {
            const data = [{
                doc_type: 'SO', sap_doc_entry: 6001, sap_doc_num: '10001',
                line_num: 1, item_code: 'A001',
                dirty_field_1: 'should be removed',
                _internal: true,
                extra_data: { nested: true }
            }];
            const orders = mapOmsOrderToWmsSchema(data);
            expect(orders[0].dirty_field_1).toBeUndefined();
            expect(orders[0]._internal).toBeUndefined();
            expect(orders[0].extra_data).toBeUndefined();
        });

        test('sap_data_hash 正确生成', () => {
            const data = [{
                doc_type: 'SO', sap_doc_entry: 7001, sap_doc_num: '11001',
                sap_status: 'O', sap_cancelled: 'N',
                doc_total: 1000, business_partner: 'C001',
                line_num: 1, item_code: 'A001', quantity: 10
            }];
            const orders = mapOmsOrderToWmsSchema(data);
            expect(orders[0].sap_data_hash).toBe('O|N|1000|C001|1|||');
        });

        test('多个不同订单正确分组', () => {
            const data = [
                { doc_type: 'SO', sap_doc_entry: 1, sap_doc_num: 'S1', line_num: 1, item_code: 'A001' },
                { doc_type: 'SO', sap_doc_entry: 1, sap_doc_num: 'S1', line_num: 2, item_code: 'A002' },
                { doc_type: 'PO', sap_doc_entry: 2, sap_doc_num: 'P1', line_num: 1, item_code: 'B001' },
                { doc_type: 'WO', sap_doc_entry: 3, sap_doc_num: 'W1', line_num: 1, item_code: 'C001' }
            ];
            const orders = mapOmsOrderToWmsSchema(data);
            expect(orders.length).toBe(3);
            expect(orders[0].lines.length).toBe(2);
            expect(orders[1].lines.length).toBe(1);
            expect(orders[2].lines.length).toBe(1);
        });

        test('sap_status 默认值为 O', () => {
            const data = [{
                doc_type: 'SO', sap_doc_entry: 8001, sap_doc_num: '12001',
                line_num: 1, item_code: 'A001'
            }];
            const orders = mapOmsOrderToWmsSchema(data);
            expect(orders[0].sap_status).toBe('O');
        });

        test('sap_cancelled 默认值为 N', () => {
            const data = [{
                doc_type: 'SO', sap_doc_entry: 9001, sap_doc_num: '13001',
                line_num: 1, item_code: 'A001'
            }];
            const orders = mapOmsOrderToWmsSchema(data);
            expect(orders[0].sap_cancelled).toBe('N');
        });

        test('sap_update_time 默认值为 00:00:00', () => {
            const data = [{
                doc_type: 'SO', sap_doc_entry: 10001, sap_doc_num: '14001',
                line_num: 1, item_code: 'A001'
            }];
            const orders = mapOmsOrderToWmsSchema(data);
            expect(orders[0].sap_update_time).toBe('00:00:00');
        });

        test('null 元素在输入数组中被安全跳过', () => {
            const data = [
                null,
                { doc_type: 'SO', sap_doc_entry: 11001, sap_doc_num: '15001', line_num: 1, item_code: 'A001' },
                null
            ];
            const orders = mapOmsOrderToWmsSchema(data);
            expect(orders.length).toBe(1);
        });

        test('无 item_code 的行不计入 lines (但不影响订单头)', () => {
            const data = [
                { doc_type: 'SO', sap_doc_entry: 12001, sap_doc_num: '16001', line_num: 1, item_code: 'A001' },
                { doc_type: 'SO', sap_doc_entry: 12001, sap_doc_num: '16001', line_num: 2, item_code: '' }
            ];
            const orders = mapOmsOrderToWmsSchema(data);
            expect(orders[0].lines.length).toBe(1);
        });

        test('sap_doc_entry 为 undefined 时抛出异常', () => {
            const data = [{ doc_type: 'SO', item_code: 'A001' }];
            expect(() => mapOmsOrderToWmsSchema(data)).toThrow('sap_doc_entry (doc_number) is required');
        });

        test('ship_date 为 null 时正确返回 null', () => {
            const data = [{
                doc_type: 'SO', sap_doc_entry: 13001, sap_doc_num: '17001',
                line_num: 1, item_code: 'A001', ship_date: null
            }];
            const orders = mapOmsOrderToWmsSchema(data);
            expect(orders[0].lines[0].ship_date).toBeNull();
        });

        test('doc_date/due_date 为 null 时正确返回 null', () => {
            const data = [{
                doc_type: 'SO', sap_doc_entry: 14001, sap_doc_num: '18001',
                doc_date: null, due_date: null,
                line_num: 1, item_code: 'A001'
            }];
            const orders = mapOmsOrderToWmsSchema(data);
            expect(orders[0].doc_date).toBeNull();
            expect(orders[0].due_date).toBeNull();
        });
    });
});
