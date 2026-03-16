const { parseMasterdata } = require('../../../apps/wf/lib/wf11-masterdata-parser');

describe('wf11-masterdata-parser.js - 主数据解析', () => {

    test('正常解析 items/warehouses/bins 三种类型', () => {
        const rows = [
            { _type: 'items', _json: JSON.stringify([{ c: 'A001', n: '物料A', u: 'PC' }, { c: 'A002', n: '物料B', u: 'KG' }]) },
            { _type: 'whs', _json: JSON.stringify([{ c: 'WH01', n: '主仓' }]) },
            { _type: 'bins', _json: JSON.stringify([{ w: 'WH01', c: 'BIN-01' }, { w: 'WH01', c: 'BIN-02' }, { w: 'WH02', c: 'BIN-03' }]) }
        ];

        const result = parseMasterdata(rows);
        expect(result.success).toBe(true);
        expect(result.items.length).toBe(2);
        expect(result.items[0].item_code).toBe('A001');
        expect(result.items[0].item_name).toBe('物料A');
        expect(result.items[0].uom).toBe('PC');
        expect(result.warehouses.length).toBe(1);
        expect(result.warehouses[0].whs_code).toBe('WH01');
        expect(result.bins_map['WH01'].length).toBe(2);
        expect(result.bins_map['WH02'].length).toBe(1);
        expect(result.counts).toEqual({ items: 2, warehouses: 1, bins: 3 });
    });

    test('空 bins → bins_map 为空对象', () => {
        const rows = [
            { _type: 'items', _json: '[]' },
            { _type: 'whs', _json: '[]' },
            { _type: 'bins', _json: '[]' }
        ];
        const result = parseMasterdata(rows);
        expect(result.bins_map).toEqual({});
        expect(result.counts.bins).toBe(0);
    });

    test('bin 缺少 w 字段 → 归入 _ 默认仓', () => {
        const rows = [
            { _type: 'bins', _json: JSON.stringify([{ c: 'BIN-X' }]) }
        ];
        const result = parseMasterdata(rows);
        expect(result.bins_map['_']).toEqual(['BIN-X']);
    });

    test('JSON 解析失败 → 跳过该类型', () => {
        const rows = [
            { _type: 'items', _json: 'INVALID JSON' },
            { _type: 'whs', _json: JSON.stringify([{ c: 'WH01', n: '仓库' }]) }
        ];
        const result = parseMasterdata(rows);
        expect(result.items.length).toBe(0); // 解析失败，保持空
        expect(result.warehouses.length).toBe(1); // 正常解析
    });

    test('null _json → 默认空数组', () => {
        const rows = [{ _type: 'items', _json: null }];
        const result = parseMasterdata(rows);
        expect(result.items.length).toBe(0);
    });

    test('null 输入 → 返回空结果', () => {
        const result = parseMasterdata(null);
        expect(result.success).toBe(true);
        expect(result.items.length).toBe(0);
        expect(result.counts.items).toBe(0);
    });

    test('空数组输入', () => {
        const result = parseMasterdata([]);
        expect(result.success).toBe(true);
    });

    test('未知 _type 被忽略', () => {
        const rows = [{ _type: 'unknown', _json: '[]' }];
        const result = parseMasterdata(rows);
        expect(result.items.length).toBe(0);
        expect(result.warehouses.length).toBe(0);
    });
});
