/**
 * wf20a-batch-boundary.test.js — OMS 批次执行器边界场景补测
 *
 * wf20a 是 OMS 分批同步的核心批次执行器，关键逻辑:
 *   - 原子领取批次 (FOR UPDATE SKIP LOCKED)
 *   - 幂等性哈希跳过 (sap_data_hash 相同则 skip)
 *   - 多 doc_type 混合批次 (SO/PO/WO/TR 同时处理)
 *   - 批次边界 (恰好等于/刚超过分组大小)
 *
 * 本测试补充 wf20-oms-mapper.test.js 已覆盖的基础用例，专注:
 *   1. sap_data_hash 幂等性 (同输入→同hash，不同输入→不同hash)
 *   2. 大批量映射 (100+ 订单, 每单多行)
 *   3. 相同 sap_doc_entry 跨 doc_type 正确隔离 (分组键 = doc_type + sap_doc_entry)
 *   4. 全 doc_type 混批 (SO/PO/WO/TR 一次输入)
 *   5. 批次边界: 仅含 header 行 (item_code 全空) 的单订单
 *   6. wf-sync-helpers 批量 UPSERT 精确边界 (恰好 batchSize/batchSize+1 条)
 */

const {
    mapOmsOrderToWmsSchema,
    buildHashInput,
} = require('../../../apps/wf/lib/wf20-oms-mapper');

const {
    buildItemsUpsertBatches,
    buildBinsUpsertBatches,
    countBatchTotal,
} = require('../../../apps/wf/lib/wf-sync-helpers');

// ── 测试辅助 ──────────────────────────────────────────────────────────────

function makeSoRow(docEntry, lineNum, itemCode, overrides = {}) {
    return {
        doc_type: 'SO',
        sap_doc_entry: docEntry,
        sap_doc_num: `SO-${docEntry}`,
        business_partner: 'C001',
        bp_name: '客户A',
        doc_date: '2026-03-01',
        due_date: '2026-03-31',
        sap_status: 'O',
        sap_cancelled: 'N',
        doc_total: 1000,
        doc_currency: 'THB',
        sap_update_date: '2026-03-01',
        sap_update_time: '10:00:00',
        line_num: lineNum,
        item_code: itemCode,
        item_name: `物料${itemCode}`,
        quantity: 10,
        open_quantity: 10,
        warehouse_code: 'WH01',
        uom: 'EA',
        ship_date: '2026-03-15',
        ...overrides,
    };
}

function makeItem(index) {
    return {
        ItemCode: `ITEM-${String(index).padStart(4, '0')}`,
        ItemName: `物料${index}`,
        InvntryUom: 'PCS',
        ManBtchNum: index % 2 === 0 ? 'Y' : 'N',
    };
}

function makeBin(index) {
    return {
        bin_code: `BIN-${String(index).padStart(4, '0')}`,
        whs_code: `WH${index % 3 + 1}`,
        whs_name: `仓库${index % 3 + 1}`,
        bin_name: `${index}-1-1`,
        max_level: index % 10,
    };
}

// ── 1. sap_data_hash 幂等性 ────────────────────────────────────────────────

describe('wf20a: sap_data_hash 幂等性 (跳过判断的核心)', () => {

    test('相同字段输入 → 完全相同的 hash (幂等性保证)', () => {
        const order = {
            sap_status: 'O', sap_cancelled: 'N',
            doc_total: 5000, business_partner: 'C001',
            lines: [{ item_code: 'A001' }, { item_code: 'B002' }],
            header_item_code: null, header_planned_qty: null, header_actual_qty: null,
        };
        const hash1 = buildHashInput(order);
        const hash2 = buildHashInput(order);
        expect(hash1).toBe(hash2);
    });

    test('业务字段变化 → hash 变化 (触发 UPSERT 更新)', () => {
        const base = {
            sap_status: 'O', sap_cancelled: 'N',
            doc_total: 5000, business_partner: 'C001',
            lines: [{}],
            header_item_code: null, header_planned_qty: null, header_actual_qty: null,
        };
        const changed = { ...base, sap_status: 'C' }; // 状态变化
        expect(buildHashInput(base)).not.toBe(buildHashInput(changed));
    });

    test('行数变化 → hash 变化 (新增/删除行触发更新)', () => {
        const base = {
            sap_status: 'O', sap_cancelled: 'N', doc_total: 1000,
            business_partner: 'C001', lines: [{}],
            header_item_code: null, header_planned_qty: null, header_actual_qty: null,
        };
        const moreLines = { ...base, lines: [{}, {}] };
        expect(buildHashInput(base)).not.toBe(buildHashInput(moreLines));
    });

    test('doc_total 浮点精度变化 → hash 变化', () => {
        const a = { sap_status: 'O', sap_cancelled: 'N', doc_total: 1000.00, business_partner: 'C001', lines: [], header_item_code: null, header_planned_qty: null, header_actual_qty: null };
        const b = { ...a, doc_total: 1000.01 };
        expect(buildHashInput(a)).not.toBe(buildHashInput(b));
    });

    test('mapOmsOrderToWmsSchema 输出的 hash 具有确定性 (多次调用同输入→同输出)', () => {
        const data = [makeSoRow(9999, 1, 'A001')];
        const r1 = mapOmsOrderToWmsSchema(data);
        const r2 = mapOmsOrderToWmsSchema(data);
        expect(r1[0].sap_data_hash).toBe(r2[0].sap_data_hash);
    });
});

// ── 2. 大批量映射 ──────────────────────────────────────────────────────────

describe('wf20a: 大批量映射 (100 订单 × 5 行)', () => {

    test('100 个不同 sap_doc_entry → 100 个独立订单', () => {
        const data = [];
        for (let doc = 1; doc <= 100; doc++) {
            for (let line = 1; line <= 5; line++) {
                data.push(makeSoRow(doc, line, `ITEM-${doc}-${line}`));
            }
        }
        const orders = mapOmsOrderToWmsSchema(data);
        expect(orders.length).toBe(100);
    });

    test('100 × 5 批量结果每单精确包含 5 行', () => {
        const data = [];
        for (let doc = 1; doc <= 100; doc++) {
            for (let line = 1; line <= 5; line++) {
                data.push(makeSoRow(doc, line, `ITEM-${doc}-${line}`));
            }
        }
        const orders = mapOmsOrderToWmsSchema(data);
        orders.forEach((order, i) => {
            expect(order.lines.length).toBe(5);
        });
    });

    test('500 行输入不丢失任何行 (总 lines = 500)', () => {
        const data = [];
        for (let doc = 1; doc <= 100; doc++) {
            for (let line = 1; line <= 5; line++) {
                data.push(makeSoRow(doc, line, `ITEM-${doc}-${line}`));
            }
        }
        const orders = mapOmsOrderToWmsSchema(data);
        const totalLines = orders.reduce((sum, o) => sum + o.lines.length, 0);
        expect(totalLines).toBe(500);
    });
});

// ── 3. 相同 sap_doc_entry 跨 doc_type 隔离 ────────────────────────────────

describe('wf20a: 分组键 = doc_type + sap_doc_entry (跨类型隔离)', () => {

    test('SO sap_doc_entry=1 与 PO sap_doc_entry=1 是不同订单', () => {
        const data = [
            { ...makeSoRow(1, 1, 'A001'), doc_type: 'SO', sap_doc_num: 'SO-1' },
            { ...makeSoRow(1, 1, 'B001'), doc_type: 'PO', sap_doc_num: 'PO-1' },
        ];
        const orders = mapOmsOrderToWmsSchema(data);
        expect(orders.length).toBe(2);
        const so = orders.find(o => o.doc_type === 'SO');
        const po = orders.find(o => o.doc_type === 'PO');
        expect(so).toBeDefined();
        expect(po).toBeDefined();
    });

    test('同 doc_type + 同 sap_doc_entry 合并为 1 个订单 (正常分组)', () => {
        const data = [
            makeSoRow(42, 1, 'A001'),
            makeSoRow(42, 2, 'A002'),
            makeSoRow(42, 3, 'A003'),
        ];
        const orders = mapOmsOrderToWmsSchema(data);
        expect(orders.length).toBe(1);
        expect(orders[0].lines.length).toBe(3);
    });
});

// ── 4. 全 doc_type 混批 ────────────────────────────────────────────────────

describe('wf20a: 全 doc_type 混批 (SO/PO/WO/TR 一次输入)', () => {

    function makeRow(docType, docEntry, lineNum, itemCode, extras = {}) {
        return {
            doc_type: docType,
            sap_doc_entry: docEntry,
            sap_doc_num: `${docType}-${docEntry}`,
            line_num: lineNum,
            item_code: itemCode,
            quantity: 5,
            open_quantity: 5,
            warehouse_code: 'WH01',
            uom: 'EA',
            ...extras,
        };
    }

    test('SO/PO/WO/TR 四种类型各 1 订单正确分组为 4 个', () => {
        const data = [
            makeRow('SO', 1, 1, 'S001'),
            makeRow('PO', 2, 1, 'P001'),
            makeRow('WO', 3, 1, 'W001', { header_item_code: 'FG-001', header_planned_qty: 100, header_actual_qty: 50 }),
            makeRow('TR', 4, 1, 'T001'),
        ];
        const orders = mapOmsOrderToWmsSchema(data);
        expect(orders.length).toBe(4);
        const types = orders.map(o => o.doc_type).sort();
        expect(types).toEqual(['PO', 'SO', 'TR', 'WO']);
    });

    test('WO 订单 header 字段在混批中正确保留', () => {
        const data = [
            makeRow('SO', 1, 1, 'S001'),
            makeRow('WO', 2, 1, 'W001', {
                header_item_code: 'FG-WO',
                header_planned_qty: 200,
                header_actual_qty: 100,
                header_warehouse: 'WH-PROD',
            }),
        ];
        const orders = mapOmsOrderToWmsSchema(data);
        const wo = orders.find(o => o.doc_type === 'WO');
        expect(wo.header_item_code).toBe('FG-WO');
        expect(wo.header_planned_qty).toBe(200);
        expect(wo.header_warehouse).toBe('WH-PROD');
    });

    test('SO 订单 header 特殊字段为 null (非 WO 类型)', () => {
        const data = [makeRow('SO', 1, 1, 'S001')];
        const orders = mapOmsOrderToWmsSchema(data);
        expect(orders[0].header_item_code).toBeNull();
        expect(orders[0].header_planned_qty).toBeNull();
    });
});

// ── 5. Header-only 行边界 ──────────────────────────────────────────────────

describe('wf20a: 混合 header-only 行与有效行', () => {

    test('header-only 行(item_code 空)不加入 lines，但订单头存在', () => {
        const data = [
            // 第一行是 header 信息行，无 item_code
            makeSoRow(5001, 0, '', { item_code: '' }),
            // 后续行有 item_code
            makeSoRow(5001, 1, 'A001'),
            makeSoRow(5001, 2, 'B002'),
        ];
        const orders = mapOmsOrderToWmsSchema(data);
        expect(orders.length).toBe(1);
        // 只有有效行 (A001, B002) 进入 lines
        expect(orders[0].lines.length).toBe(2);
        expect(orders[0].lines.map(l => l.item_code)).toEqual(['A001', 'B002']);
    });

    test('SAP 返回单订单 1 行有效数据 → lines 长度精确为 1', () => {
        const data = [makeSoRow(7001, 1, 'SINGLE-ITEM')];
        const orders = mapOmsOrderToWmsSchema(data);
        expect(orders[0].lines.length).toBe(1);
    });
});

// ── 6. wf-sync-helpers 精确批次边界 ──────────────────────────────────────

describe('wf20a: wf-sync-helpers 精确批次边界 (防止批次分割错误)', () => {

    const CC = 'DEFAULT';

    test('物料: 恰好 batchSize 条 → 1 批次 (不应分成 2)', () => {
        const items = Array.from({ length: 200 }, (_, i) => makeItem(i));
        const result = buildItemsUpsertBatches(items, CC, 200);
        expect(result.length).toBe(1);
        expect(result[0].count).toBe(200);
        expect(result[0].batch_num).toBe(1);
    });

    test('物料: batchSize+1 条 → 2 批次 (第二批 1 条)', () => {
        const items = Array.from({ length: 201 }, (_, i) => makeItem(i));
        const result = buildItemsUpsertBatches(items, CC, 200);
        expect(result.length).toBe(2);
        expect(result[0].count).toBe(200);
        expect(result[1].count).toBe(1);
        expect(result[1].batch_num).toBe(2);
    });

    test('物料: 1 条 → 1 批次 (最小批次)', () => {
        const items = [makeItem(0)];
        const result = buildItemsUpsertBatches(items, CC, 200);
        expect(result.length).toBe(1);
        expect(result[0].count).toBe(1);
    });

    test('库位: 恰好 batchSize 条 → 1 批次', () => {
        const bins = Array.from({ length: 200 }, (_, i) => makeBin(i));
        const result = buildBinsUpsertBatches(bins, CC, 200);
        expect(result.length).toBe(1);
        expect(result[0].count).toBe(200);
    });

    test('库位: batchSize+1 条 → 2 批次', () => {
        const bins = Array.from({ length: 201 }, (_, i) => makeBin(i));
        const result = buildBinsUpsertBatches(bins, CC, 200);
        expect(result.length).toBe(2);
        expect(result[0].count).toBe(200);
        expect(result[1].count).toBe(1);
    });

    test('批次号从 1 开始，连续递增 (用于日志定位)', () => {
        const items = Array.from({ length: 5 }, (_, i) => makeItem(i));
        const result = buildItemsUpsertBatches(items, CC, 2);
        const batchNums = result.map(b => b.batch_num);
        expect(batchNums).toEqual([1, 2, 3]);
    });

    test('countBatchTotal 大批量求和正确', () => {
        const batches = Array.from({ length: 50 }, (_, i) => ({ count: i + 1 }));
        const total = countBatchTotal(batches);
        // 1+2+...+50 = 1275
        expect(total).toBe(1275);
    });

    test('countBatchTotal 处理 count=0 的批次 (空批次占位)', () => {
        const batches = [
            { count: 100 },
            { count: 0 },  // 空批次占位
            { count: 50 },
        ];
        expect(countBatchTotal(batches)).toBe(150);
    });
});
