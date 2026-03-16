const { validateTransaction, TX_TYPES } = require('../../../apps/wf/lib/wf02-tx-validator');

describe('wf02-tx-validator.js - 事务合法性校验引擎', () => {

    // ── 载荷基础校验 ──

    test('场景 1: null 载荷直接拒绝', () => {
        expect(() => validateTransaction(null)).toThrow('txPayload 不能为空');
    });

    test('场景 2: undefined 载荷直接拒绝', () => {
        expect(() => validateTransaction(undefined)).toThrow('txPayload 不能为空');
    });

    test('场景 3: 非对象载荷 (字符串) 直接拒绝', () => {
        expect(() => validateTransaction('bad')).toThrow('txPayload 不能为空');
    });

    test('场景 4: 非对象载荷 (数字) 直接拒绝', () => {
        expect(() => validateTransaction(123)).toThrow('txPayload 不能为空');
    });

    // ── tx_type 校验 ──

    test('场景 5: 缺少 tx_type 字段拒绝', () => {
        expect(() => validateTransaction({ qty: 10 })).toThrow('tx_type 为必填字段');
    });

    test('场景 6: tx_type 为空字符串拒绝', () => {
        expect(() => validateTransaction({ tx_type: '', qty: 10 })).toThrow('tx_type 为必填字段');
    });

    test('场景 7: tx_type 为非字符串拒绝', () => {
        expect(() => validateTransaction({ tx_type: 999, qty: 10 })).toThrow('tx_type 为必填字段');
    });

    test('场景 8: 未知事务类型抛出异常', () => {
        expect(() => validateTransaction({ tx_type: 'UNKNOWN_TYPE', qty: 10 })).toThrow('非法事务类型: UNKNOWN_TYPE');
    });

    // ── 数量校验 ──

    test('场景 9: qty <= 0 (零) 直接拒绝', () => {
        expect(() => validateTransaction({
            tx_type: 'IC_COUNT', qty: 0
        })).toThrow('数量不合法: qty=0');
    });

    test('场景 10: qty <= 0 (负数) 直接拒绝', () => {
        expect(() => validateTransaction({
            tx_type: 'IC_COUNT', qty: -5
        })).toThrow('数量不合法: qty=-5');
    });

    test('场景 11: qty 缺失拒绝', () => {
        expect(() => validateTransaction({
            tx_type: 'IC_COUNT'
        })).toThrow('qty 必须为数字');
    });

    test('场景 12: qty 为字符串拒绝', () => {
        expect(() => validateTransaction({
            tx_type: 'IC_COUNT', qty: 'abc'
        })).toThrow('qty 必须为数字');
    });

    test('场景 13: qty 为 NaN 拒绝', () => {
        expect(() => validateTransaction({
            tx_type: 'IC_COUNT', qty: NaN
        })).toThrow('qty 必须为数字');
    });

    test('场景 14: qty 为 null 拒绝', () => {
        expect(() => validateTransaction({
            tx_type: 'IC_COUNT', qty: null
        })).toThrow('qty 必须为数字');
    });

    // ── 入库方向校验 ──

    test('场景 15: 入库 (WO_RECEIVE) 无 to_location 拒绝', () => {
        expect(() => validateTransaction({
            tx_type: 'WO_RECEIVE', qty: 10
        })).toThrow('入库事务 (WO_RECEIVE) 必须提供目标储位 to_location');
    });

    test('场景 16: 入库 (PO_RECEIVE) 无 to_location 拒绝', () => {
        expect(() => validateTransaction({
            tx_type: 'PO_RECEIVE', qty: 5
        })).toThrow('入库事务 (PO_RECEIVE) 必须提供目标储位 to_location');
    });

    test('场景 17: 入库 (TR_IN) 无 to_location 拒绝', () => {
        expect(() => validateTransaction({
            tx_type: 'TR_IN', qty: 3
        })).toThrow('入库事务 (TR_IN) 必须提供目标储位 to_location');
    });

    test('场景 18: 入库 (WO_RECEIVE) 提供 to_location 放行', () => {
        const result = validateTransaction({
            tx_type: 'WO_RECEIVE', qty: 10, to_location: 'BIN-A01'
        });
        expect(result).toEqual({ valid: true, direction: 'INBOUND' });
    });

    // ── 出库方向校验 ──

    test('场景 19: 出库 (SO_PICK) 无 from_location 拒绝', () => {
        expect(() => validateTransaction({
            tx_type: 'SO_PICK', qty: 10
        })).toThrow('出库事务 (SO_PICK) 必须提供源储位 from_location');
    });

    test('场景 20: 出库 (PI_ISSUE) 无 from_location 拒绝', () => {
        expect(() => validateTransaction({
            tx_type: 'PI_ISSUE', qty: 2
        })).toThrow('出库事务 (PI_ISSUE) 必须提供源储位 from_location');
    });

    test('场景 21: 出库 (TR_OUT) 无 from_location 拒绝', () => {
        expect(() => validateTransaction({
            tx_type: 'TR_OUT', qty: 7
        })).toThrow('出库事务 (TR_OUT) 必须提供源储位 from_location');
    });

    test('场景 22: 出库 (DD_PICK) 无 from_location 拒绝', () => {
        expect(() => validateTransaction({
            tx_type: 'DD_PICK', qty: 1
        })).toThrow('出库事务 (DD_PICK) 必须提供源储位 from_location');
    });

    test('场景 23: 出库 (SO_PICK) 提供 from_location 放行', () => {
        const result = validateTransaction({
            tx_type: 'SO_PICK', qty: 10, from_location: 'BIN-B02'
        });
        expect(result).toEqual({ valid: true, direction: 'OUTBOUND' });
    });

    // ── 中性/内部方向校验 ──

    test('场景 24: 盘点 (IC_COUNT) 无需储位即可放行', () => {
        const result = validateTransaction({
            tx_type: 'IC_COUNT', qty: 100
        });
        expect(result).toEqual({ valid: true, direction: 'NEUTRAL' });
    });

    test('场景 25: 库位移动 (LM_MOVE) 无需储位即可放行', () => {
        const result = validateTransaction({
            tx_type: 'LM_MOVE', qty: 5
        });
        expect(result).toEqual({ valid: true, direction: 'INTERNAL' });
    });

    // ── TX_TYPES 导出校验 ──

    test('场景 26: TX_TYPES 包含全部 9 种事务类型', () => {
        expect(Object.keys(TX_TYPES).length).toBe(9);
        expect(TX_TYPES).toHaveProperty('SO_PICK', 'OUTBOUND');
        expect(TX_TYPES).toHaveProperty('WO_RECEIVE', 'INBOUND');
        expect(TX_TYPES).toHaveProperty('PO_RECEIVE', 'INBOUND');
        expect(TX_TYPES).toHaveProperty('TR_OUT', 'OUTBOUND');
        expect(TX_TYPES).toHaveProperty('TR_IN', 'INBOUND');
        expect(TX_TYPES).toHaveProperty('IC_COUNT', 'NEUTRAL');
        expect(TX_TYPES).toHaveProperty('LM_MOVE', 'INTERNAL');
        expect(TX_TYPES).toHaveProperty('PI_ISSUE', 'OUTBOUND');
        expect(TX_TYPES).toHaveProperty('DD_PICK', 'OUTBOUND');
    });

    // ── 小数精度边界 ──

    test('场景 27: 小数 qty 正常放行', () => {
        const result = validateTransaction({
            tx_type: 'IC_COUNT', qty: 0.001
        });
        expect(result.valid).toBe(true);
    });

    // ── 入库提供 to_location 为空字符串时拒绝 ──

    test('场景 28: 入库 to_location 为空字符串视为未提供', () => {
        expect(() => validateTransaction({
            tx_type: 'PO_RECEIVE', qty: 10, to_location: ''
        })).toThrow('入库事务 (PO_RECEIVE) 必须提供目标储位 to_location');
    });

    // ── 出库提供 from_location 为空字符串时拒绝 ──

    test('场景 29: 出库 from_location 为空字符串视为未提供', () => {
        expect(() => validateTransaction({
            tx_type: 'SO_PICK', qty: 10, from_location: ''
        })).toThrow('出库事务 (SO_PICK) 必须提供源储位 from_location');
    });
});
