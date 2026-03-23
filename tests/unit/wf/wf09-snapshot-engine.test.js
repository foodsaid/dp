const { buildSnapshotPayload, calculateDiff, safeNum, safeStr, dedupeKey } = require('../../../apps/wf/lib/wf09-snapshot-engine');

describe('wf09-snapshot-engine.js - 库存快照核心引擎', () => {

    // ========== 辅助函数 ==========

    describe('safeNum - 安全数值转换', () => {

        test('正常数值直接返回', () => {
            expect(safeNum(42)).toBe(42);
            expect(safeNum(3.14)).toBe(3.14);
            expect(safeNum(-10)).toBe(-10);
        });

        test('字符串数字正确转换', () => {
            expect(safeNum('100')).toBe(100);
            expect(safeNum('3.14')).toBe(3.14);
        });

        test('null 回退为 0', () => {
            expect(safeNum(null)).toBe(0);
        });

        test('undefined 回退为 0', () => {
            expect(safeNum(undefined)).toBe(0);
        });

        test('NaN 字符串回退为 0', () => {
            expect(safeNum('abc')).toBe(0);
            expect(safeNum('')).toBe(0);
        });

        test('0 正确返回 0', () => {
            expect(safeNum(0)).toBe(0);
        });
    });

    describe('safeStr - 安全字符串转换', () => {

        test('正常字符串直接返回', () => {
            expect(safeStr('hello')).toBe('hello');
        });

        test('null 回退为空字符串', () => {
            expect(safeStr(null)).toBe('');
        });

        test('undefined 回退为空字符串', () => {
            expect(safeStr(undefined)).toBe('');
        });

        test('数值转为字符串', () => {
            expect(safeStr(42)).toBe('42');
        });
    });

    describe('dedupeKey - 四元组去重键', () => {

        test('正常记录生成复合键', () => {
            const key = dedupeKey({ item_code: 'A001', whs_code: 'W1', bin_code: 'B1', batch_number: 'BT1' });
            expect(key).toBe('A001|W1|B1|BT1');
        });

        test('缺失字段回退为空字符串', () => {
            const key = dedupeKey({ item_code: 'A001' });
            expect(key).toBe('A001|||');
        });

        test('全空记录', () => {
            const key = dedupeKey({});
            expect(key).toBe('|||');
        });

        test('null 字段回退为空字符串', () => {
            const key = dedupeKey({ item_code: null, whs_code: null, bin_code: null, batch_number: null });
            expect(key).toBe('|||');
        });
    });

    // ========== buildSnapshotPayload ==========

    describe('buildSnapshotPayload - 构建快照数据载荷', () => {

        test('非数组输入抛出异常', () => {
            expect(() => buildSnapshotPayload(null)).toThrow('Invalid input: currentData must be an array');
            expect(() => buildSnapshotPayload('string')).toThrow('Invalid input: currentData must be an array');
            expect(() => buildSnapshotPayload(123)).toThrow('Invalid input: currentData must be an array');
            expect(() => buildSnapshotPayload(undefined)).toThrow('Invalid input: currentData must be an array');
        });

        test('空数组返回 skipped 状态', () => {
            const result = buildSnapshotPayload([]);
            expect(result.skipped).toBe(true);
            expect(result.totalRows).toBe(0);
            expect(result.records).toEqual([]);
            expect(result.message).toContain('保留旧快照');
        });

        test('所有行 item_code 为空时返回 skipped', () => {
            const data = [
                { item_code: '', whs_code: 'W1' },
                { item_code: null, whs_code: 'W2' },
                { item_code: '   ', whs_code: 'W3' },
                { whs_code: 'W4' }
            ];
            const result = buildSnapshotPayload(data);
            expect(result.skipped).toBe(true);
            expect(result.totalRows).toBe(0);
        });

        test('正常数据标准化处理', () => {
            const data = [{
                item_code: 'A001', item_name: '测试物料', foreign_name: 'Test',
                item_group: 'G1', uom: 'EA', whs_code: 'W1', whs_name: '主仓',
                bin_code: 'B01', bin_enabled: 'Y', batch_managed: 'N',
                batch_number: 'BT1', mfr_batch: 'MFR1', lot_number: 'LOT1',
                mfr_date: '2026-01-01', exp_date: '2027-01-01', in_date: '2026-02-01',
                on_hand: 100, bin_qty: 50, batch_qty: 100,
                bin_max_level: 200, avg_price: 10.5, stock_value: 1050,
                total_on_hand: 100, committed_qty: 20, ordered_qty: 30
            }];
            const result = buildSnapshotPayload(data);
            expect(result.skipped).toBe(false);
            expect(result.totalRows).toBe(1);
            expect(result.records[0].item_code).toBe('A001');
            expect(result.records[0].on_hand).toBe(100);
            expect(result.records[0].avg_price).toBe(10.5);
            expect(result.records[0].mfr_date).toBe('2026-01-01');
        });

        test('四元组去重: 相同维度只保留第一条', () => {
            const data = [
                { item_code: 'A001', whs_code: 'W1', bin_code: 'B1', batch_number: 'BT1', on_hand: 100 },
                { item_code: 'A001', whs_code: 'W1', bin_code: 'B1', batch_number: 'BT1', on_hand: 200 }  // 重复
            ];
            const result = buildSnapshotPayload(data);
            expect(result.totalRows).toBe(1);
            expect(result.records[0].on_hand).toBe(100);
        });

        test('不同四元组保留为独立记录', () => {
            const data = [
                { item_code: 'A001', whs_code: 'W1', bin_code: 'B1', batch_number: '', on_hand: 100 },
                { item_code: 'A001', whs_code: 'W2', bin_code: 'B1', batch_number: '', on_hand: 50 }
            ];
            const result = buildSnapshotPayload(data);
            expect(result.totalRows).toBe(2);
        });

        test('数值字段为非法值时安全回退为 0', () => {
            const data = [{ item_code: 'A001', on_hand: 'abc', bin_qty: null, avg_price: undefined }];
            const result = buildSnapshotPayload(data);
            expect(result.records[0].on_hand).toBe(0);
            expect(result.records[0].bin_qty).toBe(0);
            expect(result.records[0].avg_price).toBe(0);
        });

        test('字符串字段为 null/undefined 时安全回退', () => {
            const data = [{ item_code: 'A001', item_name: null, whs_name: undefined, uom: '' }];
            const result = buildSnapshotPayload(data);
            expect(result.records[0].item_name).toBe('');
            expect(result.records[0].whs_name).toBe('');
            expect(result.records[0].uom).toBe('');
        });

        test('日期字段为空时回退为 null', () => {
            const data = [{ item_code: 'A001', mfr_date: null, exp_date: '', in_date: undefined }];
            const result = buildSnapshotPayload(data);
            expect(result.records[0].mfr_date).toBeNull();
            expect(result.records[0].exp_date).toBeNull();
            expect(result.records[0].in_date).toBeNull();
        });

        test('日期字段有值时保留原值', () => {
            const data = [{ item_code: 'A001', mfr_date: '2026-01-01' }];
            const result = buildSnapshotPayload(data);
            expect(result.records[0].mfr_date).toBe('2026-01-01');
        });

        test('消息格式正确包含行数', () => {
            const data = [
                { item_code: 'A001', whs_code: 'W1' },
                { item_code: 'A002', whs_code: 'W1' }
            ];
            const result = buildSnapshotPayload(data);
            expect(result.message).toBe('SAP 2行 准备写入PG');
        });

        test('包含 null 元素的数组安全处理', () => {
            const data = [null, { item_code: 'A001' }, undefined, { item_code: 'A002' }];
            const result = buildSnapshotPayload(data);
            expect(result.totalRows).toBe(2);
        });
    });

    // ========== calculateDiff ==========

    describe('calculateDiff - 快照差异计算', () => {

        test('current 非数组抛出异常', () => {
            expect(() => calculateDiff(null, [])).toThrow('Invalid input: current must be an array');
            expect(() => calculateDiff('string', [])).toThrow('Invalid input: current must be an array');
            expect(() => calculateDiff(undefined, [])).toThrow('Invalid input: current must be an array');
        });

        test('previous 为 null 时: 首次快照，全部视为新增', () => {
            const current = [
                { item_code: 'A001', whs_code: 'W1', on_hand: 100 },
                { item_code: 'A002', whs_code: 'W1', on_hand: 50 }
            ];
            const diff = calculateDiff(current, null);
            expect(diff.added.length).toBe(2);
            expect(diff.removed.length).toBe(0);
            expect(diff.changed.length).toBe(0);
            expect(diff.unchanged).toBe(0);
        });

        test('previous 为 undefined 时: 同 null 处理', () => {
            const current = [{ item_code: 'A001', on_hand: 100 }];
            const diff = calculateDiff(current, undefined);
            expect(diff.added.length).toBe(1);
        });

        test('previous 为非数组时: 同 null 处理', () => {
            const current = [{ item_code: 'A001', on_hand: 100 }];
            const diff = calculateDiff(current, 'not-array');
            expect(diff.added.length).toBe(1);
        });

        test('两次快照完全相同: 全部 unchanged', () => {
            const snapshot = [
                { item_code: 'A001', whs_code: 'W1', bin_code: 'B1', batch_number: '', on_hand: 100, bin_qty: 50 }
            ];
            const diff = calculateDiff(snapshot, snapshot);
            expect(diff.added.length).toBe(0);
            expect(diff.removed.length).toBe(0);
            expect(diff.changed.length).toBe(0);
            expect(diff.unchanged).toBe(1);
        });

        test('新增记录: current 有而 previous 没有', () => {
            const prev = [{ item_code: 'A001', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 100 }];
            const curr = [
                { item_code: 'A001', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 100 },
                { item_code: 'A002', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 50 }
            ];
            const diff = calculateDiff(curr, prev);
            expect(diff.added.length).toBe(1);
            expect(diff.added[0].item_code).toBe('A002');
            expect(diff.unchanged).toBe(1);
        });

        test('删除记录: previous 有而 current 没有', () => {
            const prev = [
                { item_code: 'A001', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 100 },
                { item_code: 'A002', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 50 }
            ];
            const curr = [{ item_code: 'A001', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 100 }];
            const diff = calculateDiff(curr, prev);
            expect(diff.removed.length).toBe(1);
            expect(diff.removed[0].item_code).toBe('A002');
        });

        test('数量变更: on_hand 变化触发 changed', () => {
            const prev = [{ item_code: 'A001', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 100, bin_qty: 50 }];
            const curr = [{ item_code: 'A001', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 120, bin_qty: 50 }];
            const diff = calculateDiff(curr, prev);
            expect(diff.changed.length).toBe(1);
            expect(diff.changed[0].on_hand_diff).toBe(20);
            expect(diff.changed[0].bin_qty_diff).toBe(0);
        });

        test('bin_qty 变更触发 changed', () => {
            const prev = [{ item_code: 'A001', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 100, bin_qty: 50 }];
            const curr = [{ item_code: 'A001', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 100, bin_qty: 30 }];
            const diff = calculateDiff(curr, prev);
            expect(diff.changed.length).toBe(1);
            expect(diff.changed[0].bin_qty_diff).toBe(-20);
        });

        test('浮点精度: 差异计算不漂移', () => {
            const prev = [{ item_code: 'A001', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 0.1 }];
            const curr = [{ item_code: 'A001', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 0.3 }];
            const diff = calculateDiff(curr, prev);
            expect(diff.changed[0].on_hand_diff).toBe(0.2);
        });

        test('混合场景: 同时有新增、删除、变更、不变', () => {
            const prev = [
                { item_code: 'A001', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 100, bin_qty: 50 },   // 不变
                { item_code: 'A002', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 200, bin_qty: 100 },  // 将被删除
                { item_code: 'A003', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 50, bin_qty: 25 }     // 将变更
            ];
            const curr = [
                { item_code: 'A001', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 100, bin_qty: 50 },   // 不变
                { item_code: 'A003', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 80, bin_qty: 25 },    // 变更
                { item_code: 'A004', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 30, bin_qty: 10 }     // 新增
            ];
            const diff = calculateDiff(curr, prev);
            expect(diff.unchanged).toBe(1);
            expect(diff.added.length).toBe(1);
            expect(diff.added[0].item_code).toBe('A004');
            expect(diff.removed.length).toBe(1);
            expect(diff.removed[0].item_code).toBe('A002');
            expect(diff.changed.length).toBe(1);
            expect(diff.changed[0].on_hand_diff).toBe(30);
        });

        test('空 current + 非空 previous: 全部删除', () => {
            const prev = [{ item_code: 'A001', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 100 }];
            const diff = calculateDiff([], prev);
            expect(diff.removed.length).toBe(1);
            expect(diff.added.length).toBe(0);
        });

        test('两个空数组: 无任何变化', () => {
            const diff = calculateDiff([], []);
            expect(diff.added.length).toBe(0);
            expect(diff.removed.length).toBe(0);
            expect(diff.changed.length).toBe(0);
            expect(diff.unchanged).toBe(0);
        });

        test('on_hand 属性缺失时防崩溃 (回退为 0)', () => {
            const prev = [{ item_code: 'A001', whs_code: 'W1', bin_code: '', batch_number: '' }];
            const curr = [{ item_code: 'A001', whs_code: 'W1', bin_code: '', batch_number: '' }];
            const diff = calculateDiff(curr, prev);
            expect(diff.unchanged).toBe(1);
        });

        test('null 元素在 previous 和 current 中被安全跳过', () => {
            const prev = [null, { item_code: 'A001', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 100 }];
            const curr = [{ item_code: 'A001', whs_code: 'W1', bin_code: '', batch_number: '', on_hand: 100 }, null];
            const diff = calculateDiff(curr, prev);
            expect(diff.unchanged).toBe(1);
            expect(diff.added.length).toBe(0);
            expect(diff.removed.length).toBe(0);
        });

        test('首次快照返回 current 的浅拷贝 (不修改原数组)', () => {
            const current = [{ item_code: 'A001', on_hand: 100 }];
            const diff = calculateDiff(current, null);
            expect(diff.added).not.toBe(current);
            expect(diff.added).toEqual(current);
        });
    });
});
