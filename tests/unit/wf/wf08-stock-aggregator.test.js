const { aggregateStock } = require('../../../apps/wf/lib/wf08-stock-aggregator');

describe('wf08-stock-aggregator.js - 4维库存聚合算法', () => {

    test('场景 1: 完全相同的 4 维度记录应该正确累加', () => {
        const records = [
            { item_code: 'A001', batch_number: 'B1', whs_code: 'W1', bin_code: 'L1', qty: 10 },
            { item_code: 'A001', batch_number: 'B1', whs_code: 'W1', bin_code: 'L1', qty: 15.5 }
        ];
        const result = aggregateStock(records);
        expect(result.length).toBe(1);
        expect(result[0].qty).toBe(25.5);
    });

    test('场景 2: 任何一个维度不同，都应该拆分为不同记录', () => {
        const records = [
            { item_code: 'A001', batch_number: 'B1', whs_code: 'W1', bin_code: 'L1', qty: 10 },
            { item_code: 'A001', batch_number: 'B2', whs_code: 'W1', bin_code: 'L1', qty: 10 }, // 批次不同
            { item_code: 'A001', batch_number: 'B1', whs_code: 'W2', bin_code: 'L1', qty: 10 }  // 仓库不同
        ];
        const result = aggregateStock(records);
        expect(result.length).toBe(3);
    });

    test('场景 3: 浮点数精度处理 (防 0.1 + 0.2 = 0.30000004)', () => {
        const records = [
            { item_code: 'A001', qty: 0.1 },
            { item_code: 'A001', qty: 0.2 }
        ];
        const result = aggregateStock(records);
        expect(result[0].qty).toBe(0.3);
    });

    test('场景 4: 正负冲销后库存为 0 时，自动过滤该记录', () => {
        const records = [
            { item_code: 'A001', whs_code: 'W1', qty: 100 },
            { item_code: 'A001', whs_code: 'W1', qty: -100 }
        ];
        const result = aggregateStock(records);
        expect(result.length).toBe(0);
    });

    test('场景 5: 缺失维度属性时自动补充默认值', () => {
        const records = [{ qty: 50 }];
        const result = aggregateStock(records);
        expect(result[0].item_code).toBe('UNKNOWN');
        expect(result[0].batch_number).toBe('');
        expect(result[0].whs_code).toBe('');
        expect(result[0].bin_code).toBe('');
    });

    test('场景 6: 空数组输入返回空数组', () => {
        const result = aggregateStock([]);
        expect(result).toEqual([]);
    });

    test('场景 7: 非数组输入抛出异常', () => {
        expect(() => aggregateStock(null)).toThrow('Invalid input: records must be an array');
        expect(() => aggregateStock('string')).toThrow('Invalid input: records must be an array');
        expect(() => aggregateStock(123)).toThrow('Invalid input: records must be an array');
    });

    test('场景 8: qty 为 0 的记录直接跳过，不参与聚合', () => {
        const records = [
            { item_code: 'A001', whs_code: 'W1', qty: 0 },
            { item_code: 'A001', whs_code: 'W1', qty: 10 }
        ];
        const result = aggregateStock(records);
        expect(result.length).toBe(1);
        expect(result[0].qty).toBe(10);
    });

    test('场景 9: qty 为非法字符串时视为 0 并跳过', () => {
        const records = [
            { item_code: 'A001', qty: 'abc' },
            { item_code: 'A001', qty: 5 }
        ];
        const result = aggregateStock(records);
        expect(result.length).toBe(1);
        expect(result[0].qty).toBe(5);
    });

    test('场景 10: 多轮浮点累加不漂移', () => {
        const records = [];
        for (let i = 0; i < 100; i++) {
            records.push({ item_code: 'A001', qty: 0.01 });
        }
        const result = aggregateStock(records);
        expect(result[0].qty).toBe(1);
    });

    test('场景 11: 负数库存保留（允许欠库存场景）', () => {
        const records = [
            { item_code: 'A001', whs_code: 'W1', qty: -50 }
        ];
        const result = aggregateStock(records);
        expect(result.length).toBe(1);
        expect(result[0].qty).toBe(-50);
    });

    test('场景 12: 极小数量接近 0 但不为 0 时保留', () => {
        const records = [
            { item_code: 'A001', qty: 0.001 }
        ];
        const result = aggregateStock(records);
        expect(result.length).toBe(1);
        expect(result[0].qty).toBe(0.001);
    });

    test('场景 13: 极小数量冲销后低于精度阈值时过滤', () => {
        const records = [
            { item_code: 'A001', qty: 1.0001 },
            { item_code: 'A001', qty: -1.0001 }
        ];
        const result = aggregateStock(records);
        expect(result.length).toBe(0);
    });

    test('场景 14: 复合键中管道符不会产生碰撞', () => {
        const records = [
            { item_code: 'A|B', batch_number: '', whs_code: 'W1', bin_code: 'L1', qty: 10 },
            { item_code: 'A', batch_number: 'B', whs_code: 'W1', bin_code: 'L1', qty: 20 }
        ];
        const result = aggregateStock(records);
        expect(result.length).toBe(2);
    });

    test('场景 15: 聚合后透传附加字段 (item_name/whs_name/avg_price 等)', () => {
        const records = [
            { item_code: 'A001', item_name: '测试物料', whs_code: 'W1', whs_name: '主仓', batch_number: 'B1', bin_code: 'L1', qty: 10, avg_price: 7.25, stock_value: 72.5, total_on_hand: 100, committed_qty: 20, ordered_qty: 5, snapshot_date: '2026-03-04' }
        ];
        const result = aggregateStock(records);
        expect(result[0].item_name).toBe('测试物料');
        expect(result[0].whs_name).toBe('主仓');
        expect(result[0].avg_price).toBe(7.25);
        expect(result[0].stock_value).toBe(72.5);
        expect(result[0].total_on_hand).toBe(100);
        expect(result[0].committed_qty).toBe(20);
        expect(result[0].ordered_qty).toBe(5);
        expect(result[0].snapshot_date).toBe('2026-03-04');
    });

    // --- 边缘用例补充 ---

    test('场景 16: qty 为字符串数字 "10.5" → parseFloat 正确解析', () => {
        const records = [
            { item_code: 'A001', qty: '10.5' },
            { item_code: 'A001', qty: '4.5' }
        ];
        const result = aggregateStock(records);
        expect(result.length).toBe(1);
        expect(result[0].qty).toBe(15);
    });

    test('场景 17: 同 key 多条记录 → 附加字段取首条值 (后续不覆盖)', () => {
        const records = [
            { item_code: 'A001', whs_code: 'W1', item_name: '首条名称', qty: 10 },
            { item_code: 'A001', whs_code: 'W1', item_name: '后续名称', qty: 20 }
        ];
        const result = aggregateStock(records);
        expect(result.length).toBe(1);
        expect(result[0].qty).toBe(30);
        // 聚合时只在首次 set 时记录 item_name，后续累加不覆盖
        expect(result[0].item_name).toBe('首条名称');
    });

    test('场景 18: records 含 null 元素 → 访问属性时抛 TypeError', () => {
        // 源码 forEach 直接访问 record.item_code，null 会 crash
        expect(() => aggregateStock([null, { item_code: 'A', qty: 5 }])).toThrow();
    });
});
