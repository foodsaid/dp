const { transformDDPayload } = require('../../../apps/wf/lib/wf22-mapper');

describe('wf22-mapper.js - DD 拆单核心转换逻辑', () => {

    test('场景 1: 正常的标准多柜拆单数据转换', () => {
        const payload = {
            source_order_id: 1001,
            dd_groups: [
                { container_no: 'CONT-A', lines: [{ item_code: 'A001', line_num: 1, qty: 50 }] },
                { container_no: 'CONT-B', lines: [{ item_code: 'A001', line_num: 1, qty: 50 }, { item_code: 'B002', line_num: 2, qty: 30 }] }
            ]
        };

        const result = transformDDPayload(payload);

        expect(result.length).toBe(2);
        expect(result[0].parent_order_id).toBe(1001);
        expect(result[0].container_no).toBe('CONT-A');
        expect(result[1].total_lines).toBe(2);

        // 验证 JSON 序列化是否正确
        const parsedLines = JSON.parse(result[1].lines_json);
        expect(parsedLines[0].item_code).toBe('A001');
    });

    test('场景 2: 拦截缺少源订单 ID 的异常请求', () => {
        expect(() => {
            transformDDPayload({ dd_groups: [{ container_no: 'C1', lines: [{}] }] });
        }).toThrow('Missing source_order_id');
    });

    test('场景 3: 拦截空的 dd_groups', () => {
        expect(() => {
            transformDDPayload({ source_order_id: 1002, dd_groups: [] });
        }).toThrow('dd_groups cannot be empty');
    });

    test('场景 4: 自动过滤没有任何明细行 (lines) 的空柜子', () => {
        const payload = {
            source_order_id: 1003,
            dd_groups: [
                { container_no: 'EMPTY', lines: [] },
                { container_no: 'VALID', lines: [{ item_code: 'X', line_num: 1, qty: 10 }] }
            ]
        };
        const result = transformDDPayload(payload);

        // 期望：自动丢弃空柜，只保留一个有效柜
        expect(result.length).toBe(1);
        expect(result[0].container_no).toBe('VALID');
    });
});

// ============================================================================
// wf22-mapper 边缘用例 — 输入校验 + 边界行为
// ============================================================================

describe('wf22-mapper.js - 边缘用例', () => {

    // --- 输入校验类 ---

    test('场景 5: null 输入 → 抛错', () => {
        expect(() => transformDDPayload(null)).toThrow();
    });

    test('场景 6: undefined 输入 → 抛错', () => {
        expect(() => transformDDPayload(undefined)).toThrow();
    });

    test('场景 7: 非对象输入 (字符串/数字) → 抛错', () => {
        expect(() => transformDDPayload('invalid')).toThrow();
        expect(() => transformDDPayload(123)).toThrow();
    });

    test('场景 8: dd_groups 未提供 (undefined) → 视为空数组 → 抛错', () => {
        expect(() => {
            transformDDPayload({ source_order_id: 2001 });
        }).toThrow(/empty/i);
    });

    test('场景 9: 所有柜子 lines 都为空 → 抛 No valid containers', () => {
        expect(() => {
            transformDDPayload({
                source_order_id: 2002,
                dd_groups: [
                    { container_no: 'C1', lines: [] },
                    { container_no: 'C2', lines: [] }
                ]
            });
        }).toThrow(/No valid/i);
    });

    // --- 单柜 + 默认值 ---

    test('场景 10: 单柜拆单 → dd_index 从 1 开始', () => {
        const result = transformDDPayload({
            source_order_id: 3001,
            dd_groups: [
                { container_no: 'ONLY', lines: [{ item_code: 'M001', qty: 100 }] }
            ]
        });
        expect(result.length).toBe(1);
        expect(result[0].dd_index).toBe(1);
        expect(result[0].parent_order_id).toBe(3001);
        expect(result[0].container_no).toBe('ONLY');
    });

    test('场景 11: container_no 为 null/undefined → 默认空字符串', () => {
        const result = transformDDPayload({
            source_order_id: 3002,
            dd_groups: [
                { container_no: null, lines: [{ item_code: 'A', qty: 1 }] },
                { lines: [{ item_code: 'B', qty: 2 }] } // container_no 完全缺失
            ]
        });
        expect(result[0].container_no).toBe('');
        expect(result[1].container_no).toBe('');
    });

    // --- dd_index 连续性 ---

    test('场景 12: 空柜跳过后 dd_index 保留原始数组位置 (非连续)', () => {
        // 源码: dd_index = index + 1 (forEach 的 index)
        // group[0]=valid, group[1]=empty(跳过), group[2]=valid
        // → dd_index = [1, 3] (不是 [1, 2])
        const result = transformDDPayload({
            source_order_id: 4001,
            dd_groups: [
                { container_no: 'C01', lines: [{ item_code: 'A', qty: 1 }] },
                { container_no: 'C02', lines: [] }, // 空柜子，被跳过
                { container_no: 'C03', lines: [{ item_code: 'B', qty: 2 }] }
            ]
        });
        expect(result.length).toBe(2);
        expect(result[0].dd_index).toBe(1); // index=0 → 0+1=1
        expect(result[0].container_no).toBe('C01');
        expect(result[1].dd_index).toBe(3); // index=2 → 2+1=3 (跳过了 index=1)
        expect(result[1].container_no).toBe('C03');
    });

    // --- 数据完整性 ---

    test('场景 13: lines_json 反序列化后关键字段完整', () => {
        const result = transformDDPayload({
            source_order_id: 5001,
            dd_groups: [{
                container_no: 'X1',
                lines: [
                    { item_code: 'SKU-001', line_num: 1, qty: 25, item_name: '物料A' },
                    { item_code: 'SKU-002', line_num: 2, qty: 10, item_name: '物料B' }
                ]
            }]
        });
        expect(result[0].total_lines).toBe(2);
        const lines = JSON.parse(result[0].lines_json);
        expect(lines.length).toBe(2);
        expect(lines[0].item_code).toBe('SKU-001');
        expect(lines[0].qty).toBe(25);
        expect(lines[1].item_code).toBe('SKU-002');
    });

    test('场景 14: 大量行数据 (20 行/柜 × 3 柜) → 正常处理', () => {
        const makeLine = (i) => ({ item_code: `ITEM-${i}`, line_num: i, qty: i * 10 });
        const makeGroup = (name, count) => ({
            container_no: name,
            lines: Array.from({ length: count }, (_, i) => makeLine(i + 1))
        });

        const result = transformDDPayload({
            source_order_id: 6001,
            dd_groups: [
                makeGroup('BIG-A', 20),
                makeGroup('BIG-B', 20),
                makeGroup('BIG-C', 20)
            ]
        });

        expect(result.length).toBe(3);
        expect(result[0].total_lines).toBe(20);
        expect(result[1].total_lines).toBe(20);
        expect(result[2].total_lines).toBe(20);

        // 验证 lines_json 反序列化后行数正确
        const linesA = JSON.parse(result[0].lines_json);
        expect(linesA.length).toBe(20);
        expect(linesA[19].item_code).toBe('ITEM-20');
    });
});
