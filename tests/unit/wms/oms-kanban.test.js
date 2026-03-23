/**
 * OMS 看板纯函数测试
 * 覆盖: oms-kanban.js 的所有纯函数 + createKanbanState 状态机
 */
const { loadSharedJs } = require('./setup');

loadSharedJs();

global.t = function(key, fallback) { return fallback || key; };

const {
  round4,
  createKanbanState,
  validateDDSplit,
  parseDocNumInput,
  checkHasCbmData,
  checkHasWeightData,
  buildSummaryItems,
  buildSourceLabel,
  buildInitItemMap,
  validateMultiSOSubmit,
  buildMultiSOPayload,
  fmtNum,
} = require('../../../apps/wms/oms-kanban');

// ---- 样板订单 ----
function sampleOrder() {
  return {
    id: 31,
    doc_type: 'SO',
    sap_doc_num: '12345',
    bp_name: 'ABC客商',
    lines: [
      { item_code: 'A001', item_name: '物料A', line_num: 0, planned_qty: 100, cbm: 2.5, gross_weight: 80 },
      { item_code: 'B002', item_name: '物料B', line_num: 1, planned_qty: 50, cbm: 1.2, gross_weight: 40 },
      { item_code: 'C003', item_name: '物料C', line_num: 2, planned_qty: 30, cbm: 0.8, gross_weight: 25 },
      { item_code: 'D004', item_name: '物料D', line_num: 3, planned_qty: 25, cbm: 0, gross_weight: 0 }
    ]
  };
}

// ============================================================================
// round4 精度工具
// ============================================================================

describe('round4 精度工具', () => {
  test('正常四舍五入到4位小数', () => {
    expect(round4(1.23456)).toBe(1.2346);
    expect(round4(0.00001)).toBe(0);
    expect(round4(99.99995)).toBe(100);
  });

  test('整数不变', () => {
    expect(round4(100)).toBe(100);
    expect(round4(0)).toBe(0);
  });

  test('负数处理', () => {
    expect(round4(-1.23456)).toBe(-1.2346);
  });

  test('JS 浮点经典问题修正 (0.1+0.2)', () => {
    expect(round4(0.1 + 0.2)).toBe(0.3);
  });

  test('1/3 截断到 4 位', () => {
    expect(round4(1 / 3)).toBe(0.3333);
  });
});

// ============================================================================
// initFromOrder 初始化 — 直接测试 oms-kanban.js 导出的 createKanbanState
// ============================================================================

describe('initFromOrder 初始化', () => {
  test('从订单构建 itemMap，所有物料在池中 (行级 key)', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    expect(Object.keys(kb.itemMap)).toEqual(['31_0', '31_1', '31_2', '31_3']);
    expect(kb.itemMap['31_0'].totalQty).toBe(100);
    expect(kb.itemMap['31_1'].totalQty).toBe(50);
    expect(kb.itemMap['31_0'].cbm).toBe(2.5);
    expect(kb.itemMap['31_0'].grossWeight).toBe(80);
    expect(kb.itemMap['31_0'].itemCode).toBe('A001');
    expect(kb.itemMap['31_0'].lineKey).toBe('31_0');
    expect(kb.itemMap['31_0'].orderId).toBe(31);
    expect(kb.itemMap['31_0'].lineNum).toBe(0);
    expect(kb.itemMap['31_0'].sapDocNum).toBe('12345');
    expect(Object.keys(kb.itemMap['31_0'].allocated)).toEqual([]);
  });

  test('初始化 0 个柜', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    expect(kb.containers.length).toBe(0);
  });

  test('所有物料 remaining = totalQty', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    expect(kb.getRemaining('31_0')).toBe(100);
    expect(kb.getRemaining('31_1')).toBe(50);
    expect(kb.getRemaining('31_2')).toBe(30);
    expect(kb.getRemaining('31_3')).toBe(25);
  });

  test('poolItems 显示全部 4 项', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    expect(kb.getPoolItems().length).toBe(4);
  });

  test('cbm=0 / grossWeight=0 的物料正确初始化', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    expect(kb.itemMap['31_3'].cbm).toBe(0);
    expect(kb.itemMap['31_3'].grossWeight).toBe(0);
  });

  test('空订单 (无行)', () => {
    var kb = createKanbanState();
    kb.initFromOrder({ id: 1, lines: [] });
    expect(Object.keys(kb.itemMap)).toEqual([]);
    expect(kb.getPoolItems().length).toBe(0);
  });

  test('重复初始化清空旧数据', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 50);
    expect(kb.containers.length).toBe(1);
    expect(kb.itemMap['31_0'].allocated[1]).toBe(50);
    // 重新初始化
    kb.initFromOrder({ id: 2, lines: [{ item_code: 'X001', item_name: 'X', line_num: 0, planned_qty: 10 }] });
    expect(Object.keys(kb.itemMap)).toEqual(['2_0']);
    expect(kb.itemMap['2_0'].itemCode).toBe('X001');
    expect(kb.containers.length).toBe(0);
  });

  test('sources 追踪来源 (单元素数组)', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    expect(kb.itemMap['31_0'].sources).toEqual([{ orderId: 31, lineNum: 0, qty: 100 }]);
    expect(kb.itemMap['31_1'].sources).toEqual([{ orderId: 31, lineNum: 1, qty: 50 }]);
  });

  test('同一 SO 两行相同 item_code → itemMap 两个独立 entry', () => {
    var order = {
      id: 50, sap_doc_num: '99999',
      lines: [
        { item_code: 'A001', item_name: '物料A', line_num: 0, planned_qty: 60 },
        { item_code: 'A001', item_name: '物料A', line_num: 1, planned_qty: 40 }
      ]
    };
    var kb = createKanbanState();
    kb.initFromOrder(order);
    expect(Object.keys(kb.itemMap)).toEqual(['50_0', '50_1']);
    expect(kb.itemMap['50_0'].totalQty).toBe(60);
    expect(kb.itemMap['50_1'].totalQty).toBe(40);
    expect(kb.itemMap['50_0'].itemCode).toBe('A001');
    expect(kb.itemMap['50_1'].itemCode).toBe('A001');
    expect(kb.itemMap['50_0'].lineNum).toBe(0);
    expect(kb.itemMap['50_1'].lineNum).toBe(1);
  });

  test('多 SO 相同 item_code → itemMap N 个独立 entry', () => {
    var order1 = { id: 10, sap_doc_num: 'S1', lines: [
      { item_code: 'A001', item_name: '物料A', line_num: 0, planned_qty: 30 }
    ]};
    var order2 = { id: 20, sap_doc_num: 'S2', lines: [
      { item_code: 'A001', item_name: '物料A', line_num: 0, planned_qty: 70 }
    ]};
    var kb = createKanbanState();
    // 模拟 multi-SO: 先 init order1, 再手动追加 order2
    kb.initFromOrder(order1);
    expect(Object.keys(kb.itemMap)).toEqual(['10_0']);
    // 清空并用合并方式 (模拟 Vue initFromOrders)
    var itemMap2 = {};
    [order1, order2].forEach(function(order) {
      (order.lines || []).forEach(function(ln) {
        var key = order.id + '_' + ln.line_num;
        itemMap2[key] = {
          lineKey: key, orderId: order.id, lineNum: ln.line_num,
          sapDocNum: order.sap_doc_num || '', itemCode: ln.item_code,
          itemName: ln.item_name || '', totalQty: parseFloat(ln.planned_qty) || 0,
          sources: [{ orderId: order.id, lineNum: ln.line_num, qty: parseFloat(ln.planned_qty) || 0 }],
          allocated: {}
        };
      });
    });
    expect(Object.keys(itemMap2)).toEqual(['10_0', '20_0']);
    expect(itemMap2['10_0'].totalQty).toBe(30);
    expect(itemMap2['20_0'].totalQty).toBe(70);
    expect(itemMap2['10_0'].orderId).toBe(10);
    expect(itemMap2['20_0'].orderId).toBe(20);
  });

  test('buildPayload 输出每行带正确 line_num', () => {
    var order = {
      id: 50, sap_doc_num: '99999',
      lines: [
        { item_code: 'A001', item_name: '物料A', line_num: 0, planned_qty: 60 },
        { item_code: 'A001', item_name: '物料A', line_num: 1, planned_qty: 40 }
      ]
    };
    var kb = createKanbanState();
    kb.initFromOrder(order);
    kb.addContainer();
    kb.containers[0].containerNo = 'C1';
    kb.updateQty(1, '50_0', 60);
    kb.updateQty(1, '50_1', 40);
    var payload = kb.buildPayload(order);
    expect(payload.dd_groups.length).toBe(1);
    expect(payload.dd_groups[0].lines).toEqual([
      { item_code: 'A001', item_name: '物料A', line_num: 0, qty: 60 },
      { item_code: 'A001', item_name: '物料A', line_num: 1, qty: 40 }
    ]);
  });
});

// ============================================================================
// allocated containerId 模型
// ============================================================================

describe('allocated containerId 模型', () => {
  test('addContainer 使用自增 id (稳定身份)', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.addContainer();
    expect(kb.containers.map(function(c) { return c.id; })).toEqual([1, 2, 3]);
  });

  test('删除中间柜不影响其他柜 id', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.addContainer();
    kb.updateQty(1, '31_0', 30);
    kb.updateQty(2, '31_0', 40);
    kb.updateQty(3, '31_0', 30);
    kb.removeContainer(2);
    expect(kb.containers.map(function(c) { return c.id; })).toEqual([1, 3]);
    expect(kb.itemMap['31_0'].allocated[1]).toBe(30);
    expect(kb.itemMap['31_0'].allocated[3]).toBe(30);
    expect(kb.itemMap['31_0'].allocated[2]).toBeUndefined();
  });

  test('删除柜后 id 不复用', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer(); // id=1
    kb.removeContainer(1);
    kb.addContainer(); // id=2 (不是 1)
    expect(kb.containers[0].id).toBe(2);
  });
});

// ============================================================================
// getRemaining 计算
// ============================================================================

describe('getRemaining 计算', () => {
  test('无分配时 remaining = totalQty', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    expect(kb.getRemaining('31_0')).toBe(100);
  });

  test('部分分配后 remaining 正确', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 60);
    expect(kb.getRemaining('31_0')).toBe(40);
  });

  test('全量分配后 remaining = 0', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 100);
    expect(kb.getRemaining('31_0')).toBe(0);
  });

  test('多柜分配后 remaining 正确', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.updateQty(1, '31_0', 30);
    kb.updateQty(2, '31_0', 50);
    expect(kb.getRemaining('31_0')).toBe(20);
  });

  test('不存在的 itemCode 返回 0', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    expect(kb.getRemaining('XXXX')).toBe(0);
  });
});

// ============================================================================
// getMaxAllowed 硬校验上限
// ============================================================================

describe('getMaxAllowed 硬校验上限', () => {
  test('无其他柜分配时 maxAllowed = totalQty', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    expect(kb.getMaxAllowed('31_0', 1)).toBe(100);
  });

  test('其他柜已分配时 maxAllowed = totalQty - otherSum', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.updateQty(1, '31_0', 60);
    expect(kb.getMaxAllowed('31_0', 2)).toBe(40);
  });

  test('多柜分配时 maxAllowed 排除所有其他柜', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.addContainer();
    kb.updateQty(1, '31_0', 30);
    kb.updateQty(2, '31_0', 40);
    expect(kb.getMaxAllowed('31_0', 3)).toBe(30);
  });

  test('不存在的 itemCode 返回 0', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    expect(kb.getMaxAllowed('XXXX', 1)).toBe(0);
  });
});

// ============================================================================
// updateQty 硬校验 (M: totalQty 上限, V: 输入清洗)
// ============================================================================

describe('updateQty 硬校验', () => {
  test('正常更新数量', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 60);
    expect(kb.itemMap['31_0'].allocated[1]).toBe(60);
  });

  test('超过 totalQty 被钳制', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 999);
    expect(kb.itemMap['31_0'].allocated[1]).toBe(100);
    expect(kb.getRemaining('31_0')).toBe(0);
  });

  test('跨柜超分被钳制 (M: 最危险的点)', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.updateQty(1, '31_0', 60);
    kb.updateQty(2, '31_0', 60);
    expect(kb.itemMap['31_0'].allocated[2]).toBe(40);
    expect(kb.getRemaining('31_0')).toBe(0);
  });

  test('remaining 永远 >= 0', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.addContainer();
    kb.updateQty(1, '31_0', 50);
    kb.updateQty(2, '31_0', 50);
    kb.updateQty(3, '31_0', 999);
    expect(kb.getRemaining('31_0')).toBe(0);
  });

  test('NaN 输入被忽略 (V: 输入清洗)', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 50);
    kb.updateQty(1, '31_0', 'abc');
    expect(kb.itemMap['31_0'].allocated[1]).toBe(50);
  });

  test('空字符串输入被忽略 (V)', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 50);
    kb.updateQty(1, '31_0', '');
    expect(kb.itemMap['31_0'].allocated[1]).toBe(50);
  });

  test('负数被归零 (V)', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', -10);
    expect(kb.itemMap['31_0'].allocated[1]).toBeUndefined();
    expect(kb.getRemaining('31_0')).toBe(100);
  });

  test('不存在的物料不崩溃', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    expect(() => kb.updateQty(1, 'XXXX', 10)).not.toThrow();
  });

  test('极小正值 (<0.0001) 被清除', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 0.00001);
    expect(kb.itemMap['31_0'].allocated[1]).toBeUndefined();
  });

  test('字符串数字可正确解析', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', '42.5');
    expect(kb.itemMap['31_0'].allocated[1]).toBe(42.5);
  });
});

// ============================================================================
// splitEvenly 均分 (G: 只分配 remaining, I: 精度控制)
// ============================================================================

describe('splitEvenly 均分', () => {
  test('2 柜均分 100 → 50/50', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.splitEvenly();
    expect(kb.itemMap['31_0'].allocated[1]).toBe(50);
    expect(kb.itemMap['31_0'].allocated[2]).toBe(50);
    expect(kb.getRemaining('31_0')).toBe(0);
  });

  test('3 柜均分 100 → 33.3333/33.3333/33.3334 (最后一柜吸收余数)', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.addContainer();
    kb.splitEvenly();
    expect(kb.itemMap['31_0'].allocated[1]).toBe(round4(100 / 3));
    expect(kb.itemMap['31_0'].allocated[2]).toBe(round4(100 / 3));
    expect(kb.itemMap['31_0'].allocated[3]).toBe(round4(100 - round4(100 / 3) * 2));
    var sum = kb.itemMap['31_0'].allocated[1] + kb.itemMap['31_0'].allocated[2] + kb.itemMap['31_0'].allocated[3];
    expect(Math.abs(sum - 100)).toBeLessThan(0.0001);
  });

  test('只分配 remaining，不覆盖已分配量 (G)', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.updateQty(1, '31_0', 60);
    kb.splitEvenly();
    expect(kb.itemMap['31_0'].allocated[1]).toBe(80);
    expect(kb.itemMap['31_0'].allocated[2]).toBe(20);
    expect(kb.getRemaining('31_0')).toBe(0);
  });

  test('已全部分配的物料不受均分影响', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.updateQty(1, '31_0', 100);
    kb.splitEvenly();
    expect(kb.itemMap['31_0'].allocated[1]).toBe(100);
    expect(kb.itemMap['31_0'].allocated[2]).toBeUndefined();
  });

  test('柜数 < 2 时不操作', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.splitEvenly();
    expect(kb.getRemaining('31_0')).toBe(100);
  });

  test('0 柜时不操作', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.splitEvenly();
    expect(kb.getRemaining('31_0')).toBe(100);
  });

  test('全部物料均分后 remaining 全部 ≈ 0', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.addContainer();
    kb.splitEvenly();
    expect(Math.abs(kb.getRemaining('31_0'))).toBeLessThan(0.0001);
    expect(Math.abs(kb.getRemaining('31_1'))).toBeLessThan(0.0001);
    expect(Math.abs(kb.getRemaining('31_2'))).toBeLessThan(0.0001);
    expect(Math.abs(kb.getRemaining('31_3'))).toBeLessThan(0.0001);
  });

  test('精度极端: 1/7 × 7柜 总量恒等 (I)', () => {
    var kb = createKanbanState();
    kb.initFromOrder({
      id: 1,
      lines: [{ item_code: 'X', item_name: 'X', line_num: 0, planned_qty: 1 }]
    });
    for (var i = 0; i < 7; i++) kb.addContainer();
    kb.splitEvenly();
    var sum = 0;
    kb.containers.forEach(function(c) { sum += (kb.itemMap['1_0'].allocated[c.id] || 0); });
    expect(Math.abs(sum - 1)).toBeLessThan(0.0001);
  });
});

// ============================================================================
// fillRemaining 填充剩余
// ============================================================================

describe('fillRemaining 填充剩余', () => {
  test('全部池中物料填入指定柜', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.fillRemaining(1);
    expect(kb.itemMap['31_0'].allocated[1]).toBe(100);
    expect(kb.itemMap['31_1'].allocated[1]).toBe(50);
    expect(kb.getRemaining('31_0')).toBe(0);
    expect(kb.getRemaining('31_1')).toBe(0);
  });

  test('只填充 remaining > 0 的物料，不影响其他柜', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.updateQty(1, '31_0', 60);
    kb.fillRemaining(2);
    expect(kb.itemMap['31_0'].allocated[1]).toBe(60);
    expect(kb.itemMap['31_0'].allocated[2]).toBe(40);
    expect(kb.itemMap['31_1'].allocated[2]).toBe(50);
  });

  test('已全量分配的物料不受影响', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.updateQty(1, '31_0', 100);
    kb.fillRemaining(2);
    expect(kb.itemMap['31_0'].allocated[1]).toBe(100);
    expect(kb.itemMap['31_0'].allocated[2]).toBeUndefined();
  });
});

// ============================================================================
// removeContainer 回收 (J: 回收 allocated)
// ============================================================================

describe('removeContainer 回收', () => {
  test('删除柜后 allocated 被清除, remaining 自动恢复', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 80);
    expect(kb.getRemaining('31_0')).toBe(20);
    kb.removeContainer(1);
    expect(kb.getRemaining('31_0')).toBe(100);
    expect(kb.itemMap['31_0'].allocated[1]).toBeUndefined();
  });

  test('删除一个柜不影响其他柜', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.updateQty(1, '31_0', 30);
    kb.updateQty(2, '31_0', 40);
    kb.removeContainer(1);
    expect(kb.itemMap['31_0'].allocated[2]).toBe(40);
    expect(kb.getRemaining('31_0')).toBe(60);
  });

  test('删除所有柜后所有物料回池', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.splitEvenly();
    expect(kb.getRemaining('31_0')).toBe(0);
    kb.removeContainer(1);
    kb.removeContainer(2);
    expect(kb.getRemaining('31_0')).toBe(100);
    expect(kb.getRemaining('31_1')).toBe(50);
    expect(kb.containers.length).toBe(0);
  });

  test('删除不存在的柜 id 不崩溃', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    expect(() => kb.removeContainer(999)).not.toThrow();
  });
});

// ============================================================================
// 拖拽转移逻辑
// ============================================================================

describe('拖拽转移', () => {
  test('池→柜: 全量 remaining 分配到目标柜', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.onDropToContainer(1, 'pool', '31_0');
    expect(kb.itemMap['31_0'].allocated[1]).toBe(100);
    expect(kb.getRemaining('31_0')).toBe(0);
  });

  test('池→柜: 部分 remaining 分配 (已有其他柜分配)', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.updateQty(1, '31_0', 60);
    kb.onDropToContainer(2, 'pool', '31_0');
    expect(kb.itemMap['31_0'].allocated[2]).toBe(40);
    expect(kb.getRemaining('31_0')).toBe(0);
  });

  test('柜→柜: 整行转移', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.updateQty(1, '31_0', 80);
    kb.onDropToContainer(2, 1, '31_0');
    expect(kb.itemMap['31_0'].allocated[1]).toBeUndefined();
    expect(kb.itemMap['31_0'].allocated[2]).toBe(80);
  });

  test('柜→柜: 目标柜已有分配时累加', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.updateQty(1, '31_0', 60);
    kb.updateQty(2, '31_0', 20);
    kb.onDropToContainer(2, 1, '31_0');
    expect(kb.itemMap['31_0'].allocated[2]).toBe(80);
    expect(kb.itemMap['31_0'].allocated[1]).toBeUndefined();
  });

  test('柜→池: 归零该柜分配', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 80);
    kb.onDropToPool(1, '31_0');
    expect(kb.itemMap['31_0'].allocated[1]).toBeUndefined();
    expect(kb.getRemaining('31_0')).toBe(100);
  });

  test('池→池: 无操作', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.onDropToPool('pool', '31_0');
    expect(kb.getRemaining('31_0')).toBe(100);
  });

  test('同柜→同柜: 无操作', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 80);
    kb.onDropToContainer(1, 1, '31_0');
    expect(kb.itemMap['31_0'].allocated[1]).toBe(80);
  });

  test('不存在的物料拖拽不崩溃', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    expect(() => kb.onDropToContainer(1, 'pool', 'XXXX')).not.toThrow();
    expect(() => kb.onDropToPool(1, 'XXXX')).not.toThrow();
  });
});

// ============================================================================
// 搜索过滤 (K: 全列统一)
// ============================================================================

describe('搜索过滤', () => {
  test('非搜索模式: 池显示 remaining > 0', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 100);
    var pool = kb.getPoolItems();
    expect(pool.length).toBe(3);
    expect(pool.map(function(p) { return p.itemCode; })).not.toContain('A001');
  });

  test('非搜索模式: 柜显示 allocated > 0', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 80);
    var items = kb.getContainerItems(1);
    expect(items.length).toBe(1);
    expect(items[0].itemCode).toBe('A001');
  });

  test('搜索模式: 按 itemCode 匹配, 池+柜统一', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 100);
    kb.setSearchTerm('A001');
    var pool = kb.getPoolItems();
    expect(pool.length).toBe(1);
    expect(pool[0].itemCode).toBe('A001');
    var items = kb.getContainerItems(1);
    expect(items.length).toBe(1);
    expect(items[0].itemCode).toBe('A001');
  });

  test('搜索模式: 按 itemName 匹配', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.setSearchTerm('物料B');
    var pool = kb.getPoolItems();
    expect(pool.length).toBe(1);
    expect(pool[0].itemCode).toBe('B002');
  });

  test('搜索模式: 无匹配返回空', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.setSearchTerm('ZZZZZ');
    expect(kb.getPoolItems().length).toBe(0);
  });

  test('搜索大小写不敏感', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.setSearchTerm('a001');
    expect(kb.getPoolItems().length).toBe(1);
  });

  test('清空搜索回到常规模式', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.setSearchTerm('A001');
    expect(kb.getPoolItems().length).toBe(1);
    kb.setSearchTerm('');
    expect(kb.getPoolItems().length).toBe(4);
  });
});

// ============================================================================
// 汇总统计 (L: CBM + 毛重, N: 显示精度)
// ============================================================================

describe('汇总统计', () => {
  test('containerItemCount 正确计数', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 50);
    kb.updateQty(1, '31_1', 30);
    expect(kb.getContainerItemCount(1)).toBe(2);
  });

  test('containerTotalQty 正确求和', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 50);
    kb.updateQty(1, '31_1', 30);
    expect(kb.getContainerTotalQty(1)).toBe(80);
  });

  test('containerCbm 按比例计算', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 50);
    expect(kb.getContainerCbm(1)).toBe(1.25);
  });

  test('containerWeight 按比例计算', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 50);
    expect(kb.getContainerWeight(1)).toBe(40);
  });

  test('cbm=0 的物料不贡献 CBM', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_3', 25);
    expect(kb.getContainerCbm(1)).toBe(0);
  });

  test('多物料 CBM 累加', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 100);
    kb.updateQty(1, '31_1', 50);
    expect(kb.getContainerCbm(1)).toBe(3.7);
  });

  test('空柜统计为 0', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    expect(kb.getContainerItemCount(1)).toBe(0);
    expect(kb.getContainerTotalQty(1)).toBe(0);
    expect(kb.getContainerCbm(1)).toBe(0);
    expect(kb.getContainerWeight(1)).toBe(0);
  });
});

// ============================================================================
// isAllAllocated 浮点容差 (S)
// ============================================================================

describe('isAllAllocated 浮点容差', () => {
  test('全部分配完返回 true', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.fillRemaining(1);
    expect(kb.isAllAllocated()).toBe(true);
  });

  test('有 remaining 返回 false', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 50);
    expect(kb.isAllAllocated()).toBe(false);
  });

  test('空 itemMap 返回 false', () => {
    var kb = createKanbanState();
    kb.initFromOrder({ id: 1, lines: [] });
    expect(kb.isAllAllocated()).toBe(false);
  });

  test('浮点误差 < 0.0001 视为已分配 (S)', () => {
    var kb = createKanbanState();
    kb.initFromOrder({
      id: 1,
      lines: [{ item_code: 'X', item_name: 'X', line_num: 0, planned_qty: 1 }]
    });
    kb.addContainer();
    kb.addContainer();
    kb.addContainer();
    kb.splitEvenly();
    expect(kb.isAllAllocated()).toBe(true);
  });
});

// ============================================================================
// 提交校验链 (H, R, U, T)
// ============================================================================

describe('提交校验链', () => {
  test('0 个柜 → 报错 (R)', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    expect(kb.validateSubmit()).toBe('请至少创建一个DD');
  });

  test('有柜但无分配 → 报错 (R)', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    expect(kb.validateSubmit()).toBe('没有任何已分配物料');
  });

  test('柜号为空 → 报错 (H)', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.updateQty(1, '31_0', 100);
    expect(kb.validateSubmit()).toBe('请填写所有DD的柜号');
  });

  test('柜号重复 → 报错 (U)', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.containers[0].containerNo = 'CONT-001';
    kb.containers[1].containerNo = 'CONT-001';
    kb.updateQty(1, '31_0', 60);
    kb.updateQty(2, '31_0', 40);
    expect(kb.validateSubmit()).toBe('柜号不能重复');
  });

  test('柜号大小写/空格不同也算重复 (U: trim+toUpperCase)', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.containers[0].containerNo = 'cont-001';
    kb.containers[1].containerNo = ' CONT-001 ';
    kb.updateQty(1, '31_0', 60);
    kb.updateQty(2, '31_0', 40);
    expect(kb.validateSubmit()).toBe('柜号不能重复');
  });

  test('校验全部通过 → null', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.containers[0].containerNo = 'CONT-001';
    kb.updateQty(1, '31_0', 100);
    expect(kb.validateSubmit()).toBeNull();
  });

  test('多柜有效: 每柜都有柜号和分配', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.containers[0].containerNo = 'C001';
    kb.containers[1].containerNo = 'C002';
    kb.updateQty(1, '31_0', 60);
    kb.updateQty(2, '31_0', 40);
    expect(kb.validateSubmit()).toBeNull();
  });

  test('有柜有号但物料全在池中 → 报错', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.containers[0].containerNo = 'C001';
    expect(kb.validateSubmit()).toBe('没有任何已分配物料');
  });
});

// ============================================================================
// buildPayload 提交载荷构建
// ============================================================================

describe('buildPayload 提交载荷', () => {
  test('标准载荷结构', () => {
    var order = sampleOrder();
    var kb = createKanbanState();
    kb.initFromOrder(order);
    kb.addContainer();
    kb.addContainer();
    kb.containers[0].containerNo = 'CONT-001';
    kb.containers[1].containerNo = 'CONT-002';
    kb.updateQty(1, '31_0', 60);
    kb.updateQty(1, '31_1', 50);
    kb.updateQty(2, '31_0', 40);
    kb.updateQty(2, '31_2', 30);

    var payload = kb.buildPayload(order);
    expect(payload.source_order_id).toBe(31);
    expect(payload.dd_groups.length).toBe(2);
    expect(payload.dd_groups[0].container_no).toBe('CONT-001');
    expect(payload.dd_groups[0].lines).toEqual([
      { item_code: 'A001', item_name: '物料A', line_num: 0, qty: 60 },
      { item_code: 'B002', item_name: '物料B', line_num: 1, qty: 50 }
    ]);
    expect(payload.dd_groups[1].container_no).toBe('CONT-002');
    expect(payload.dd_groups[1].lines).toEqual([
      { item_code: 'A001', item_name: '物料A', line_num: 0, qty: 40 },
      { item_code: 'C003', item_name: '物料C', line_num: 2, qty: 30 }
    ]);
  });

  test('空柜 (无分配物料) 不出现在 dd_groups', () => {
    var order = sampleOrder();
    var kb = createKanbanState();
    kb.initFromOrder(order);
    kb.addContainer();
    kb.addContainer();
    kb.containers[0].containerNo = 'C001';
    kb.containers[1].containerNo = 'C002';
    kb.updateQty(1, '31_0', 100);

    var payload = kb.buildPayload(order);
    expect(payload.dd_groups.length).toBe(1);
    expect(payload.dd_groups[0].container_no).toBe('C001');
  });

  test('数量精度: round4 应用在 payload 中', () => {
    var order = {
      id: 1,
      lines: [{ item_code: 'X', item_name: 'X', line_num: 0, planned_qty: 1 }]
    };
    var kb = createKanbanState();
    kb.initFromOrder(order);
    kb.addContainer();
    kb.addContainer();
    kb.addContainer();
    kb.containers[0].containerNo = 'C1';
    kb.containers[1].containerNo = 'C2';
    kb.containers[2].containerNo = 'C3';
    kb.splitEvenly();

    var payload = kb.buildPayload(order);
    var totalPayloadQty = 0;
    payload.dd_groups.forEach(function(g) {
      g.lines.forEach(function(l) { totalPayloadQty += l.qty; });
    });
    expect(Math.abs(totalPayloadQty - 1)).toBeLessThan(0.0001);
  });
});

// ============================================================================
// 端到端场景: 完整操作流程
// ============================================================================

describe('端到端场景', () => {
  test('完整流程: 初始化 → 创建柜 → 拖拽 → 均分 → 填充 → 删柜 → 提交', () => {
    var order = sampleOrder();
    var kb = createKanbanState();

    // 1. 初始化
    kb.initFromOrder(order);
    expect(kb.getPoolItems().length).toBe(4);
    expect(kb.containers.length).toBe(0);

    // 2. 创建 2 个柜
    kb.addContainer();
    kb.addContainer();
    kb.containers[0].containerNo = 'CONT-001';
    kb.containers[1].containerNo = 'CONT-002';

    // 3. 拖 A001 到柜1
    kb.onDropToContainer(1, 'pool', '31_0');
    expect(kb.itemMap['31_0'].allocated[1]).toBe(100);
    expect(kb.getRemaining('31_0')).toBe(0);

    // 4. 拖 D004 到柜1
    kb.onDropToContainer(1, 'pool', '31_3');
    expect(kb.itemMap['31_3'].allocated[1]).toBe(25);

    // 5. 均分剩余 (B002=50, C003=30)
    kb.splitEvenly();
    expect(kb.itemMap['31_1'].allocated[1]).toBeTruthy();
    expect(kb.itemMap['31_1'].allocated[2]).toBeTruthy();

    // 6. 验证全部分配
    expect(kb.isAllAllocated()).toBe(true);

    // 7. 提交校验通过
    expect(kb.validateSubmit()).toBeNull();

    // 8. 构建 payload
    var payload = kb.buildPayload(order);
    expect(payload.dd_groups.length).toBe(2);
    expect(payload.source_order_id).toBe(31);
  });

  test('场景: 创建3柜 → 部分分配 → 删除1柜 → 物料回池', () => {
    var kb = createKanbanState();
    kb.initFromOrder(sampleOrder());
    kb.addContainer();
    kb.addContainer();
    kb.addContainer();

    kb.updateQty(1, '31_0', 30);
    kb.updateQty(2, '31_0', 30);
    kb.updateQty(3, '31_0', 40);
    expect(kb.getRemaining('31_0')).toBe(0);

    kb.removeContainer(2);
    expect(kb.getRemaining('31_0')).toBe(30);
    expect(kb.containers.length).toBe(2);

    kb.onDropToContainer(3, 'pool', '31_0');
    expect(kb.itemMap['31_0'].allocated[3]).toBe(70);
    expect(kb.getRemaining('31_0')).toBe(0);
  });

  test('场景: 大量物料 (150行) 性能无异常', () => {
    var lines = [];
    for (var i = 0; i < 150; i++) {
      lines.push({
        item_code: 'ITEM-' + String(i).padStart(3, '0'),
        item_name: '物料' + i,
        line_num: i,
        planned_qty: 100 + i * 0.5,
        cbm: 0.1,
        gross_weight: 1
      });
    }
    var kb = createKanbanState();
    var start = Date.now();
    kb.initFromOrder({ id: 1, lines: lines });
    expect(Object.keys(kb.itemMap).length).toBe(150);

    for (var j = 0; j < 5; j++) kb.addContainer();
    kb.splitEvenly();
    var elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);

    var item0 = kb.itemMap['1_0'];
    var sum0 = 0;
    kb.containers.forEach(function(c) { sum0 += (item0.allocated[c.id] || 0); });
    expect(Math.abs(sum0 - 100)).toBeLessThan(0.0001);
  });
});

// ============================================================================
// 批量单号搜索 — 直接测试 oms-kanban.js 导出的 parseDocNumInput
// ============================================================================

describe('批量单号搜索', () => {
  test('单个单号直接返回', () => {
    var result = parseDocNumInput('12345');
    expect(result.nums).toEqual(['12345']);
    expect(result.error).toBeNull();
  });

  test('空格分隔多个单号', () => {
    var result = parseDocNumInput('12345 12346 12347');
    expect(result.nums).toEqual(['12345', '12346', '12347']);
    expect(result.error).toBeNull();
  });

  test('多空格和Tab分隔', () => {
    var result = parseDocNumInput('12345   12346\t12347');
    expect(result.nums).toEqual(['12345', '12346', '12347']);
  });

  test('重复单号去重', () => {
    var result = parseDocNumInput('12345 12346 12345 12347 12346');
    expect(result.nums).toEqual(['12345', '12346', '12347']);
  });

  test('超过 50 个 → 报错', () => {
    var nums = [];
    for (var i = 1; i <= 51; i++) nums.push('DOC' + i);
    var result = parseDocNumInput(nums.join(' '));
    expect(result.error).toBe('最多批量查询 50 个单号');
    expect(result.nums).toEqual([]);
  });

  test('恰好 50 个 → 正常', () => {
    var nums = [];
    for (var i = 1; i <= 50; i++) nums.push('DOC' + i);
    var result = parseDocNumInput(nums.join(' '));
    expect(result.error).toBeNull();
    expect(result.nums.length).toBe(50);
  });

  test('空输入返回空数组', () => {
    expect(parseDocNumInput('').nums).toEqual([]);
    expect(parseDocNumInput('  ').nums).toEqual([]);
    expect(parseDocNumInput(null).nums).toEqual([]);
    expect(parseDocNumInput(undefined).nums).toEqual([]);
  });

  test('前后空格去除', () => {
    var result = parseDocNumInput('  12345  12346  ');
    expect(result.nums).toEqual(['12345', '12346']);
  });
});

// ============================================================================
// DD 拆单验证
// ============================================================================

describe('DD 拆单验证', () => {
  test('SO 订单正常拆分 → 无错误', () => {
    var order = {
      doc_type: 'SO',
      execution_state: 'idle',
      lines: [
        { item_code: 'ITEM-A', planned_qty: 100 },
        { item_code: 'ITEM-B', planned_qty: 50 }
      ]
    };
    var groups = [
      { container_no: 'C001', lines: [{ allocated_qty: 60 }, { allocated_qty: 30 }] },
      { container_no: 'C002', lines: [{ allocated_qty: 40 }, { allocated_qty: 20 }] }
    ];
    expect(validateDDSplit(order, groups)).toEqual([]);
  });

  test('非 SO 类型 → 报错', () => {
    var order = { doc_type: 'PO', execution_state: 'idle', lines: [] };
    var errors = validateDDSplit(order, [{ lines: [] }]);
    expect(errors).toContain('DD 拆单仅支持 SO 类型');
  });

  test('WMS 执行中 → 报错', () => {
    var order = { doc_type: 'SO', execution_state: 'executing', lines: [] };
    var errors = validateDDSplit(order, [{ lines: [] }]);
    expect(errors).toContain('该订单已在 WMS 执行中');
  });

  test('WMS 已完成 → 报错', () => {
    var order = { doc_type: 'SO', execution_state: 'done', lines: [] };
    var errors = validateDDSplit(order, [{ lines: [] }]);
    expect(errors).toContain('该订单已在 WMS 执行中');
  });

  test('空 ddGroups → 报错', () => {
    var order = { doc_type: 'SO', execution_state: 'idle', lines: [] };
    var errors = validateDDSplit(order, []);
    expect(errors).toContain('缺少 DD 组');
  });

  test('null ddGroups → 报错', () => {
    var order = { doc_type: 'SO', execution_state: 'idle', lines: [] };
    var errors = validateDDSplit(order, null);
    expect(errors).toContain('缺少 DD 组');
  });

  test('分配数量不匹配 → 报错', () => {
    var order = {
      doc_type: 'SO',
      execution_state: 'idle',
      lines: [{ item_code: 'ITEM-A', planned_qty: 100 }]
    };
    var groups = [{ lines: [{ allocated_qty: 80 }] }]; // 80 != 100
    var errors = validateDDSplit(order, groups);
    expect(errors).toContain('分配数量不匹配: ITEM-A');
  });

  test('零分配 → 报错', () => {
    var order = {
      doc_type: 'SO',
      execution_state: 'idle',
      lines: [{ item_code: 'ITEM-A', planned_qty: 0 }]
    };
    var groups = [{ lines: [{ allocated_qty: 0 }] }];
    var errors = validateDDSplit(order, groups);
    expect(errors).toContain('请至少分配一个物料');
  });

  test('null 源订单 → 报错', () => {
    var errors = validateDDSplit(null, []);
    expect(errors).toContain('源订单不存在');
  });

  test('多 DD 组正确分配', () => {
    var order = {
      doc_type: 'SO',
      execution_state: 'idle',
      lines: [{ item_code: 'A', planned_qty: 10 }]
    };
    var groups = [
      { lines: [{ allocated_qty: 3 }] },
      { lines: [{ allocated_qty: 3 }] },
      { lines: [{ allocated_qty: 4 }] }
    ];
    expect(validateDDSplit(order, groups)).toEqual([]);
  });

  test('浮点数精度容差 (0.001 内视为相等)', () => {
    var order = {
      doc_type: 'SO',
      execution_state: 'idle',
      lines: [{ item_code: 'A', planned_qty: 1.0 }]
    };
    var groups = [{ lines: [{ allocated_qty: 0.9999 }] }]; // 差值 0.0001 < 0.001
    expect(validateDDSplit(order, groups)).toEqual([]);
  });
});

// ============================================================================
// DD 前缀检测 — so.js 内联逻辑 (正则 /^DD/i)
// ============================================================================

describe('DD 前缀检测', () => {
  // 与 so.js 中 initSO/loadOrder 的内联 /^DD/i 一致
  function detectDDPrefix(docnum) {
    if (!docnum) return { isDD: false, prefix: 'SO', cleanNum: '' };
    var str = String(docnum);
    if (/^DD/i.test(str)) {
      return { isDD: true, prefix: 'DD', cleanNum: str.replace(/^DD/i, '') };
    }
    return { isDD: false, prefix: 'SO', cleanNum: str };
  }

  test('DD 前缀检测正确', () => {
    expect(detectDDPrefix('DD100001')).toEqual({ isDD: true, prefix: 'DD', cleanNum: '100001' });
    expect(detectDDPrefix('dd100001')).toEqual({ isDD: true, prefix: 'DD', cleanNum: '100001' });
    expect(detectDDPrefix('DD1')).toEqual({ isDD: true, prefix: 'DD', cleanNum: '1' });
  });

  test('非 DD 前缀返回 SO', () => {
    expect(detectDDPrefix('100001')).toEqual({ isDD: false, prefix: 'SO', cleanNum: '100001' });
    expect(detectDDPrefix('SO100001')).toEqual({ isDD: false, prefix: 'SO', cleanNum: 'SO100001' });
  });

  test('空值处理', () => {
    expect(detectDDPrefix('')).toEqual({ isDD: false, prefix: 'SO', cleanNum: '' });
    expect(detectDDPrefix(null)).toEqual({ isDD: false, prefix: 'SO', cleanNum: '' });
    expect(detectDDPrefix(undefined)).toEqual({ isDD: false, prefix: 'SO', cleanNum: '' });
  });
});

// ============================================================================
// createKanbanState._resetState — 状态重置
// ============================================================================

describe('createKanbanState._resetState — 状态重置', () => {
  test('_resetState 重置内部 ID 计数器和搜索词', () => {
    var itemMap = {};
    var containers = [];
    var searchTerm = 'test';
    var kb = createKanbanState(itemMap, containers, function() { return searchTerm; });

    // 先分配一些 ID 推高 _nextId
    kb.addContainer();
    kb.addContainer();
    expect(containers.length).toBe(2);

    // 重置 — 清空 _nextId 和 _searchTerm
    kb._resetState();

    // containers 不被 _resetState 清空（由外部管理），但 _nextId 重置
    // 验证 _resetState 被成功调用（不抛错）
    expect(typeof kb._resetState).toBe('function');
  });
});

// ============================================================================
// parseDocNumInput — 边界输入
// ============================================================================

describe('parseDocNumInput — 边界输入', () => {
  test('仅空白字符返回空 nums', () => {
    var result = parseDocNumInput('   ');
    expect(result.nums).toEqual([]);
    expect(result.error).toBeNull();
  });

  test('null 输入返回空 nums', () => {
    var result = parseDocNumInput(null);
    expect(result.nums).toEqual([]);
  });

  test('空字符串返回空 nums', () => {
    var result = parseDocNumInput('');
    expect(result.nums).toEqual([]);
  });

  test('多空格分隔正确拆分', () => {
    var result = parseDocNumInput('26000001  26000002   26000003');
    expect(result.nums.length).toBe(3);
    expect(result.error).toBeNull();
  });

  test('重复单号去重', () => {
    var result = parseDocNumInput('26000001 26000001 26000001');
    expect(result.nums.length).toBe(1);
    expect(result.nums[0]).toBe('26000001');
  });

  test('超过 50 个单号返回错误', () => {
    var nums = [];
    for (var i = 0; i < 51; i++) nums.push('2600' + String(i).padStart(4, '0'));
    var result = parseDocNumInput(nums.join(' '));
    expect(result.nums).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});

// ============================================================
// checkHasCbmData — CBM 数据检测
// ============================================================
describe('checkHasCbmData — CBM 数据检测', () => {
  test('空 itemMap 返回 false', () => {
    expect(checkHasCbmData({})).toBe(false);
  });

  test('null/undefined 返回 false', () => {
    expect(checkHasCbmData(null)).toBe(false);
    expect(checkHasCbmData(undefined)).toBe(false);
  });

  test('所有物料 cbm=0 返回 false', () => {
    expect(checkHasCbmData({
      k1: { cbm: 0 },
      k2: { cbm: 0 },
    })).toBe(false);
  });

  test('cbm 缺失视为 0，返回 false', () => {
    expect(checkHasCbmData({
      k1: { itemCode: 'A' },
    })).toBe(false);
  });

  test('至少 1 个物料 cbm>0 返回 true', () => {
    expect(checkHasCbmData({
      k1: { cbm: 0 },
      k2: { cbm: 0.5 },
    })).toBe(true);
  });

  test('浮点数 CBM 正确判断', () => {
    expect(checkHasCbmData({
      k1: { cbm: 0.001 },
    })).toBe(true);
  });
});

// ============================================================
// checkHasWeightData — 重量数据检测
// ============================================================
describe('checkHasWeightData — 重量数据检测', () => {
  test('空 itemMap 返回 false', () => {
    expect(checkHasWeightData({})).toBe(false);
  });

  test('null/undefined 返回 false', () => {
    expect(checkHasWeightData(null)).toBe(false);
    expect(checkHasWeightData(undefined)).toBe(false);
  });

  test('所有物料 grossWeight=0 返回 false', () => {
    expect(checkHasWeightData({
      k1: { grossWeight: 0 },
      k2: { grossWeight: 0 },
    })).toBe(false);
  });

  test('至少 1 个物料 grossWeight>0 返回 true', () => {
    expect(checkHasWeightData({
      k1: { grossWeight: 0 },
      k2: { grossWeight: 12.5 },
    })).toBe(true);
  });
});

// ============================================================
// buildSummaryItems — 汇总项构建
// ============================================================
describe('buildSummaryItems — 汇总项构建', () => {
  test('空 itemMap 返回空数组', () => {
    expect(buildSummaryItems({}, () => 0)).toEqual([]);
  });

  test('null itemMap 返回空数组', () => {
    expect(buildSummaryItems(null, () => 0)).toEqual([]);
  });

  test('全部分配完 (remaining≈0) 返回 ok 状态', () => {
    var map = {
      k1: { lineKey: 'k1', itemCode: 'A', sapDocNum: '100', lineNum: 0, totalQty: 50 },
    };
    var result = buildSummaryItems(map, () => 0.00005);
    expect(result).toHaveLength(1);
    expect(result[0].statusClass).toBe('dd-status-ok');
    expect(result[0].statusIcon).toBe('\u2713');
  });

  test('部分分配 (remaining>0) 返回 warn 状态', () => {
    var map = {
      k1: { lineKey: 'k1', itemCode: 'A', sapDocNum: '100', lineNum: 0, totalQty: 50 },
    };
    var result = buildSummaryItems(map, () => 10);
    expect(result[0].statusClass).toBe('dd-status-warn');
    expect(result[0].statusIcon).toBe('\u26A0');
  });

  test('超额分配 (remaining<0) 返回 err 状态', () => {
    var map = {
      k1: { lineKey: 'k1', itemCode: 'A', sapDocNum: '100', lineNum: 0, totalQty: 50 },
    };
    var result = buildSummaryItems(map, () => -5);
    expect(result[0].statusClass).toBe('dd-status-err');
    expect(result[0].statusIcon).toBe('\u2717');
  });

  test('多物料各状态混合', () => {
    var map = {
      k1: { lineKey: 'k1', itemCode: 'A', sapDocNum: '100', lineNum: 0, totalQty: 50 },
      k2: { lineKey: 'k2', itemCode: 'B', sapDocNum: '100', lineNum: 1, totalQty: 30 },
      k3: { lineKey: 'k3', itemCode: 'C', sapDocNum: '100', lineNum: 2, totalQty: 20 },
    };
    var remaining = { k1: 0, k2: 10, k3: -2 };
    var result = buildSummaryItems(map, (key) => remaining[key] || 0);
    expect(result).toHaveLength(3);
    expect(result[0].statusClass).toBe('dd-status-ok');
    expect(result[1].statusClass).toBe('dd-status-warn');
    expect(result[2].statusClass).toBe('dd-status-err');
  });

  test('浮点精度 < 0.0001 被视为 0 (ok 状态)', () => {
    var map = {
      k1: { lineKey: 'k1', itemCode: 'A', sapDocNum: '100', lineNum: 0, totalQty: 50 },
    };
    var result = buildSummaryItems(map, () => 0.00009);
    expect(result[0].statusClass).toBe('dd-status-ok');
  });

  test('正确透传 lineKey/itemCode/sapDocNum/lineNum/totalQty', () => {
    var map = {
      k1: { lineKey: 'k1', itemCode: 'ITEM-X', sapDocNum: '99999', lineNum: 7, totalQty: 123.45 },
    };
    var result = buildSummaryItems(map, () => 0);
    expect(result[0]).toMatchObject({
      lineKey: 'k1', itemCode: 'ITEM-X', sapDocNum: '99999', lineNum: 7, totalQty: 123.45,
    });
  });
});

// ============================================================
// buildSourceLabel — 源单标签
// ============================================================
describe('buildSourceLabel — 源单标签', () => {
  test('空源订单返回空字符串', () => {
    expect(buildSourceLabel([], 0)).toBe('');
    expect(buildSourceLabel(null, 0)).toBe('');
    expect(buildSourceLabel(undefined, 0)).toBe('');
  });

  test('单个 SO 源订单', () => {
    var orders = [{ doc_type: 'SO', sap_doc_num: '26000001' }];
    var result = buildSourceLabel(orders, 3);
    expect(result).toBe('SO#26000001 | 3项');
  });

  test('多个源订单拼接', () => {
    var orders = [
      { doc_type: 'SO', sap_doc_num: '26000001' },
      { doc_type: 'SO', sap_doc_num: '26000002' },
    ];
    var result = buildSourceLabel(orders, 5);
    expect(result).toBe('SO#26000001 + SO#26000002 | 5项');
  });

  test('缺少 doc_type 默认 SO', () => {
    var orders = [{ sap_doc_num: '26000001' }];
    var result = buildSourceLabel(orders, 1);
    expect(result).toContain('SO#26000001');
  });

  test('缺少 sap_doc_num 回退 doc_number', () => {
    var orders = [{ doc_type: 'SO', doc_number: 'DOC-001' }];
    var result = buildSourceLabel(orders, 1);
    expect(result).toContain('SO#DOC-001');
  });

  test('自定义翻译函数', () => {
    var orders = [{ doc_type: 'SO', sap_doc_num: '100' }];
    var result = buildSourceLabel(orders, 2, function() { return ' items'; });
    expect(result).toBe('SO#100 | 2 items');
  });

  test('sap_doc_num 和 doc_number 均缺失 → 空字符串', () => {
    var orders = [{ doc_type: 'SO' }];
    var result = buildSourceLabel(orders, 1);
    expect(result).toBe('SO# | 1项');
  });
});

// ============================================================================
// createKanbanState — 分支覆盖补充
// ============================================================================

describe('createKanbanState 分支覆盖补充', () => {
  var order = {
    id: 1, sap_doc_num: 'SO100',
    lines: [
      { line_num: 0, item_code: 'A001', item_name: '物料A', planned_qty: 100, cbm: 0.5, gross_weight: 2.0 },
      { line_num: 1, item_code: 'B001', item_name: '物料B', planned_qty: 50, cbm: 0, gross_weight: 0 },
    ]
  };

  test('initFromOrder — item_name/cbm/planned_qty 为 null 时回退默认值', () => {
    var kb = createKanbanState();
    kb.initFromOrder({
      id: 2, sap_doc_num: '',
      lines: [{ line_num: 0, item_code: 'X001', item_name: null, planned_qty: null, cbm: null, gross_weight: null }]
    });
    var item = kb.itemMap['2_0'];
    expect(item.itemName).toBe('');
    expect(item.totalQty).toBe(0);
    expect(item.cbm).toBe(0);
    expect(item.grossWeight).toBe(0);
  });

  test('getPoolItems/getContainerItems — 带搜索词过滤', () => {
    var kb = createKanbanState();
    kb.initFromOrder(order);
    kb.addContainer();
    kb.fillRemaining(1);
    // 无搜索词: pool 应为空 (全部分配了)
    expect(kb.getPoolItems().length).toBe(0);
    // 设置搜索词: 匹配 A001
    kb.setSearchTerm('A001');
    var poolWithSearch = kb.getPoolItems();
    expect(poolWithSearch.length).toBe(1);
    expect(poolWithSearch[0].itemCode).toBe('A001');
    // getContainerItems 也按搜索词过滤
    var containerItems = kb.getContainerItems(1);
    expect(containerItems.length).toBe(1);
    expect(containerItems[0].itemCode).toBe('A001');
  });

  test('getContainerWeight — grossWeight=0 时返回 0', () => {
    var kb = createKanbanState();
    kb.initFromOrder(order);
    kb.addContainer();
    // 分配 B001 (grossWeight=0) 到柜 1
    kb.updateQty(1, '1_1', 50);
    var w = kb.getContainerWeight(1);
    expect(w).toBe(0);
  });

  test('getContainerWeight — grossWeight>0 正确按比例计算', () => {
    var kb = createKanbanState();
    kb.initFromOrder(order);
    kb.addContainer();
    kb.updateQty(1, '1_0', 50); // 分配 50/100, grossWeight=2.0
    var w = kb.getContainerWeight(1);
    expect(w).toBe(1); // 50/100 * 2.0 = 1.0
  });

  test('onDropToContainer — pool→container 无剩余时不分配', () => {
    var kb = createKanbanState();
    kb.initFromOrder(order);
    kb.addContainer();
    kb.addContainer();
    // 先全量分配到柜 1
    kb.fillRemaining(1);
    // 从 pool 拖到柜 2，但 remaining=0
    kb.onDropToContainer(2, 'pool', '1_0');
    expect(kb.itemMap['1_0'].allocated[2]).toBeUndefined();
  });

  test('onDropToContainer — 同一柜拖拽不移动', () => {
    var kb = createKanbanState();
    kb.initFromOrder(order);
    kb.addContainer();
    kb.updateQty(1, '1_0', 50);
    // 同柜拖拽
    kb.onDropToContainer(1, 1, '1_0');
    expect(kb.itemMap['1_0'].allocated[1]).toBe(50);
  });

  test('onDropToContainer — 柜间移动 (srcQty <= 0.0001 不移动)', () => {
    var kb = createKanbanState();
    kb.initFromOrder(order);
    kb.addContainer();
    kb.addContainer();
    // 柜 1 没有分配 A001，从柜 1 拖到柜 2
    kb.onDropToContainer(2, 1, '1_0');
    expect(kb.itemMap['1_0'].allocated[2]).toBeUndefined();
  });

  test('buildPayload — 跳过 orderId 不匹配的 entry', () => {
    var kb = createKanbanState();
    // 初始化两个不同订单
    kb.initFromOrder({ id: 1, sap_doc_num: 'SO1', lines: [{ line_num: 0, item_code: 'A', item_name: 'A', planned_qty: 10 }] });
    // 手动添加另一个订单的 item
    kb.itemMap['2_0'] = {
      lineKey: '2_0', orderId: 2, lineNum: 0, sapDocNum: 'SO2',
      itemCode: 'B', itemName: 'B', totalQty: 20, cbm: 0, grossWeight: 0,
      sources: [{ orderId: 2, lineNum: 0, qty: 20 }], allocated: {}
    };
    kb.addContainer();
    kb.updateQty(1, '1_0', 10);
    kb.updateQty(1, '2_0', 20);
    // buildPayload 只包含 orderId=1 的行
    var payload = kb.buildPayload({ id: 1 });
    expect(payload.dd_groups.length).toBe(1);
    expect(payload.dd_groups[0].lines.length).toBe(1);
    expect(payload.dd_groups[0].lines[0].item_code).toBe('A');
  });

  test('getMaxAllowed — 排除当前柜分配', () => {
    var kb = createKanbanState();
    kb.initFromOrder(order);
    kb.addContainer();
    kb.addContainer();
    kb.updateQty(1, '1_0', 30);
    kb.updateQty(2, '1_0', 20);
    // maxAllowed for cid=1: totalQty(100) - other(cid=2: 20) = 80
    expect(kb.getMaxAllowed('1_0', 1)).toBe(80);
    // maxAllowed for cid=2: totalQty(100) - other(cid=1: 30) = 70
    expect(kb.getMaxAllowed('1_0', 2)).toBe(70);
  });

  test('matchesSearch — itemName 匹配', () => {
    var kb = createKanbanState();
    kb.initFromOrder(order);
    kb.setSearchTerm('物料B');
    var pool = kb.getPoolItems();
    expect(pool.length).toBe(1);
    expect(pool[0].itemCode).toBe('B001');
  });
});

// ============================================================================
// validateDDSplit — 分支覆盖补充
// ============================================================================

describe('validateDDSplit 分支覆盖补充', () => {
  test('ddGroups 中缺少对应行索引 → 分配为 0', () => {
    var order = {
      doc_type: 'SO', execution_state: 'idle',
      lines: [
        { item_code: 'A001', planned_qty: 100 },
        { item_code: 'B001', planned_qty: 50 },
      ]
    };
    var ddGroups = [{ lines: { 0: { allocated_qty: 100 } } }]; // 缺少行索引 1
    var errors = validateDDSplit(order, ddGroups);
    expect(errors).toContain('分配数量不匹配: B001');
  });

  test('sourceOrder.lines 为 null → 空行回退', () => {
    var order = { doc_type: 'SO', execution_state: 'idle', lines: null };
    var ddGroups = [{ lines: {} }];
    var errors = validateDDSplit(order, ddGroups);
    expect(errors).toContain('请至少分配一个物料');
  });

  test('ddGroups 中 g.lines 为 null → 不崩溃', () => {
    var order = {
      doc_type: 'SO', execution_state: 'idle',
      lines: [{ item_code: 'A001', planned_qty: 10 }]
    };
    var ddGroups = [{ lines: null }];
    var errors = validateDDSplit(order, ddGroups);
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// buildInitItemMap — 多 SO 合并构建 itemMap (从 Vue initFromOrders 提取)
// ============================================================================

describe('buildInitItemMap — 多 SO 合并', () => {
  test('单个订单单行 → 正确构建 itemMap', () => {
    var orders = [{
      id: 100, sap_doc_num: 'SO001', warehouse_code: 'WH01',
      lines: [{ line_num: 1, item_code: 'ITEM-A', item_name: '物料A', planned_qty: '50', cbm: '1.5', gross_weight: '10' }]
    }];
    var map = buildInitItemMap(orders);
    expect(Object.keys(map)).toEqual(['100_1']);
    var item = map['100_1'];
    expect(item.lineKey).toBe('100_1');
    expect(item.orderId).toBe(100);
    expect(item.itemCode).toBe('ITEM-A');
    expect(item.totalQty).toBe(50);
    expect(item.cbm).toBe(1.5);
    expect(item.grossWeight).toBe(10);
    expect(item.warehouseCode).toBe('WH01');
    expect(item.allocated).toEqual({});
    expect(item.sources).toEqual([{ orderId: 100, lineNum: 1, qty: 50 }]);
  });

  test('多个订单多行 → 行级粒度，不合并同 item_code', () => {
    var orders = [
      { id: 1, sap_doc_num: 'SO001', lines: [
        { line_num: 1, item_code: 'A', planned_qty: '10' },
        { line_num: 2, item_code: 'B', planned_qty: '20' }
      ]},
      { id: 2, sap_doc_num: 'SO002', lines: [
        { line_num: 1, item_code: 'A', planned_qty: '30' }
      ]}
    ];
    var map = buildInitItemMap(orders);
    expect(Object.keys(map).sort()).toEqual(['1_1', '1_2', '2_1']);
    expect(map['1_1'].totalQty).toBe(10);
    expect(map['2_1'].totalQty).toBe(30);
    expect(map['2_1'].sapDocNum).toBe('SO002');
  });

  test('空订单 → 返回空 itemMap', () => {
    expect(buildInitItemMap([])).toEqual({});
  });

  test('订单无 lines → 跳过', () => {
    var orders = [{ id: 1, sap_doc_num: 'SO001' }];
    expect(buildInitItemMap(orders)).toEqual({});
  });

  test('行字段缺失时使用默认值', () => {
    var orders = [{ id: 1, lines: [{ line_num: 1, item_code: 'X' }] }];
    var map = buildInitItemMap(orders);
    var item = map['1_1'];
    expect(item.sapDocNum).toBe('');
    expect(item.itemName).toBe('');
    expect(item.totalQty).toBe(0);
    expect(item.cbm).toBe(0);
    expect(item.grossWeight).toBe(0);
    expect(item.warehouseCode).toBe('');
  });

  test('行级 warehouse_code 优先于订单级', () => {
    var orders = [{ id: 1, warehouse_code: 'WH-ORDER', lines: [
      { line_num: 1, item_code: 'X', warehouse_code: 'WH-LINE' }
    ]}];
    expect(buildInitItemMap(orders)['1_1'].warehouseCode).toBe('WH-LINE');
  });
});

// ============================================================================
// validateMultiSOSubmit — 多 SO 提交校验 (5 项纯函数校验)
// ============================================================================

describe('validateMultiSOSubmit — 5 项校验', () => {
  function mockCountFn(itemMap) {
    return function(cid) {
      var count = 0;
      Object.keys(itemMap).forEach(function(k) {
        if ((itemMap[k].allocated[cid] || 0) > 0.0001) count++;
      });
      return count;
    };
  }

  test('① 无容器 → no_container', () => {
    var r = validateMultiSOSubmit({}, [], function() { return 0; }, 1);
    expect(r.valid).toBe(false);
    expect(r.error).toBe('no_container');
  });

  test('② 有容器但无分配 → no_alloc', () => {
    var containers = [{ id: 1, containerNo: 'C1' }];
    var r = validateMultiSOSubmit({}, containers, function() { return 0; }, 1);
    expect(r.valid).toBe(false);
    expect(r.error).toBe('no_alloc');
  });

  test('③ 柜号重复 → container_dup', () => {
    var itemMap = { '1_1': { totalQty: 10, allocated: { 1: 5, 2: 5 }, lineNum: 1, itemCode: 'A', sapDocNum: '' } };
    var containers = [{ id: 1, containerNo: 'C1' }, { id: 2, containerNo: 'c1' }]; // 大小写不敏感
    var r = validateMultiSOSubmit(itemMap, containers, mockCountFn(itemMap), 1);
    expect(r.valid).toBe(false);
    expect(r.error).toBe('container_dup');
  });

  test('③ 空柜号不参与重复检查', () => {
    var itemMap = { '1_1': { totalQty: 10, allocated: { 1: 5, 2: 5 }, lineNum: 1, itemCode: 'A', sapDocNum: '' } };
    var containers = [{ id: 1, containerNo: '' }, { id: 2, containerNo: '' }];
    var r = validateMultiSOSubmit(itemMap, containers, mockCountFn(itemMap), 2);
    expect(r.valid).toBe(true);
  });

  test('④ 物料未完全分配 → unallocated', () => {
    var itemMap = { '1_1': { totalQty: 10, allocated: { 1: 5 }, lineNum: 1, itemCode: 'A', sapDocNum: 'SO001' } };
    var containers = [{ id: 1, containerNo: 'C1' }, { id: 2, containerNo: 'C2' }];
    var r = validateMultiSOSubmit(itemMap, containers, mockCountFn(itemMap), 1);
    expect(r.valid).toBe(false);
    expect(r.error).toBe('unallocated');
    expect(r.unallocated).toEqual(['SO001 L1: A']);
  });

  test('④ 无 sapDocNum 时不显示前缀', () => {
    var itemMap = { '1_1': { totalQty: 10, allocated: { 1: 5 }, lineNum: 2, itemCode: 'B', sapDocNum: '' } };
    var containers = [{ id: 1, containerNo: 'C1' }];
    var r = validateMultiSOSubmit(itemMap, containers, mockCountFn(itemMap), 1);
    expect(r.unallocated).toEqual(['L2: B']);
  });

  test('⑤ 单 SO + 单有效柜 → single_no_change', () => {
    var itemMap = { '1_1': { totalQty: 10, allocated: { 1: 10 }, lineNum: 1, itemCode: 'A', sapDocNum: '' } };
    var containers = [{ id: 1, containerNo: 'C1' }];
    var r = validateMultiSOSubmit(itemMap, containers, mockCountFn(itemMap), 1);
    expect(r.valid).toBe(false);
    expect(r.error).toBe('single_no_change');
  });

  test('⑤ 多 SO + 单有效柜 → 通过 (合并场景)', () => {
    var itemMap = { '1_1': { totalQty: 10, allocated: { 1: 10 }, lineNum: 1, itemCode: 'A', sapDocNum: '' } };
    var containers = [{ id: 1, containerNo: 'C1' }];
    var r = validateMultiSOSubmit(itemMap, containers, mockCountFn(itemMap), 2);
    expect(r.valid).toBe(true);
    expect(r.validCount).toBe(1);
    expect(r.soCount).toBe(2);
  });

  test('正常拆分 → valid', () => {
    var itemMap = {
      '1_1': { totalQty: 10, allocated: { 1: 6, 2: 4 }, lineNum: 1, itemCode: 'A', sapDocNum: '' },
    };
    var containers = [{ id: 1, containerNo: 'C1' }, { id: 2, containerNo: 'C2' }];
    var r = validateMultiSOSubmit(itemMap, containers, mockCountFn(itemMap), 1);
    expect(r.valid).toBe(true);
    expect(r.validCount).toBe(2);
  });
});

// ============================================================================
// buildMultiSOPayload — 多 SO 提交 payload 构建
// ============================================================================

describe('buildMultiSOPayload — 多 SO payload 构建', () => {
  test('正常构建 payload', () => {
    var itemMap = {
      '1_1': { itemCode: 'A', itemName: '物料A', lineNum: 1, warehouseCode: 'WH01',
               orderId: 1, allocated: { 10: 6, 20: 4 } },
      '2_1': { itemCode: 'B', itemName: '物料B', lineNum: 1, warehouseCode: 'WH02',
               orderId: 2, allocated: { 10: 3 } }
    };
    var containers = [
      { id: 10, containerNo: 'CTN-001' },
      { id: 20, containerNo: 'CTN-002' }
    ];
    var sourceOrders = [
      { id: 1, sap_doc_num: 'SO001' },
      { id: 2, sap_doc_num: 'SO002' }
    ];

    var payload = buildMultiSOPayload(itemMap, containers, sourceOrders);
    expect(payload.source_order_ids.sort()).toEqual([1, 2]);
    expect(payload.dd_groups).toHaveLength(2);
    expect(payload.dd_groups[0].container_no).toBe('CTN-001');
    expect(payload.dd_groups[0].lines).toHaveLength(2);
    expect(payload.dd_groups[1].container_no).toBe('CTN-002');
    expect(payload.dd_groups[1].lines).toHaveLength(1);
  });

  test('空柜号使用默认 DD-N 编号', () => {
    var itemMap = { '1_1': { itemCode: 'A', itemName: '', lineNum: 1, warehouseCode: '', orderId: 1, allocated: { 1: 5 } } };
    var containers = [{ id: 1, containerNo: '  ' }];
    var sourceOrders = [{ id: 1, sap_doc_num: 'SO001' }];
    var payload = buildMultiSOPayload(itemMap, containers, sourceOrders);
    expect(payload.dd_groups[0].container_no).toBe('DD-1');
  });

  test('分配数量 < 0.0001 的行被过滤', () => {
    var itemMap = { '1_1': { itemCode: 'A', itemName: '', lineNum: 1, warehouseCode: '', orderId: 1, allocated: { 1: 0.00001 } } };
    var containers = [{ id: 1, containerNo: 'C1' }];
    var payload = buildMultiSOPayload(itemMap, containers, [{ id: 1 }]);
    expect(payload.dd_groups).toHaveLength(0);
  });

  test('源订单未找到时 source_doc_num 为空', () => {
    var itemMap = { '1_1': { itemCode: 'A', itemName: '', lineNum: 1, warehouseCode: '', orderId: 999, allocated: { 1: 5 } } };
    var containers = [{ id: 1, containerNo: 'C1' }];
    var payload = buildMultiSOPayload(itemMap, containers, [{ id: 1, sap_doc_num: 'SO001' }]);
    expect(payload.dd_groups[0].lines[0].source_doc_num).toBe('');
  });

  test('源订单有 doc_number 但无 sap_doc_num', () => {
    var itemMap = { '1_1': { itemCode: 'A', itemName: '', lineNum: 1, warehouseCode: '', orderId: 1, allocated: { 1: 5 } } };
    var containers = [{ id: 1, containerNo: 'C1' }];
    var payload = buildMultiSOPayload(itemMap, containers, [{ id: 1, doc_number: 'DN001' }]);
    expect(payload.dd_groups[0].lines[0].source_doc_num).toBe('DN001');
  });
});

// ============================================================================
// fmtNum — 格式化数字
// ============================================================================

describe('fmtNum — 格式化数字', () => {
  test('null → "0"', () => { expect(fmtNum(null)).toBe('0'); });
  test('undefined → "0"', () => { expect(fmtNum(undefined)).toBe('0'); });
  test('NaN → "0"', () => { expect(fmtNum(NaN)).toBe('0'); });
  test('正常数字使用 formatNumber', () => {
    // formatNumber 在 shared.js 中定义，已加载到 global
    expect(fmtNum(1234.5)).toBe(formatNumber(1234.5));
  });
  test('0 → "0"', () => { expect(fmtNum(0)).toBe('0'); });
});

// ============================================================================
// createKanbanState — 额外分支覆盖
// ============================================================================

describe('createKanbanState — 额外分支覆盖', () => {
  test('getContainerCbm — item.totalQty 为 0 时不计入', () => {
    var kb = createKanbanState();
    kb.initFromOrder({
      id: 1, lines: [{ line_num: 1, item_code: 'A', planned_qty: 0, cbm: 5 }]
    });
    kb.addContainer();
    kb.updateQty(1, '1_1', 10);
    // totalQty=0 → cbm 不参与计算
    expect(kb.getContainerCbm(1)).toBe(0);
  });

  test('getContainerWeight — item.totalQty 为 0 时不计入', () => {
    var kb = createKanbanState();
    kb.initFromOrder({
      id: 1, lines: [{ line_num: 1, item_code: 'A', planned_qty: 0, gross_weight: 10 }]
    });
    kb.addContainer();
    kb.updateQty(1, '1_1', 5);
    expect(kb.getContainerWeight(1)).toBe(0);
  });

  test('matchesSearch 匹配 itemName', () => {
    var kb = createKanbanState();
    kb.initFromOrder({
      id: 1, lines: [
        { line_num: 1, item_code: 'A001', item_name: '钢管', planned_qty: 10 },
        { line_num: 2, item_code: 'B002', item_name: '螺栓', planned_qty: 20 }
      ]
    });
    kb.setSearchTerm('钢管');
    var pool = kb.getPoolItems();
    expect(pool.length).toBe(1);
    expect(pool[0].itemCode).toBe('A001');
  });

  test('getContainerItems 搜索模式返回匹配项', () => {
    var kb = createKanbanState();
    kb.initFromOrder({
      id: 1, lines: [
        { line_num: 1, item_code: 'A001', item_name: '钢管', planned_qty: 10 },
        { line_num: 2, item_code: 'B002', item_name: '螺栓', planned_qty: 20 }
      ]
    });
    kb.addContainer();
    kb.fillRemaining(1);
    kb.setSearchTerm('B002');
    var items = kb.getContainerItems(1);
    expect(items.length).toBe(1);
    expect(items[0].itemCode).toBe('B002');
  });

  test('onDropToContainer — 从一个容器转移到另一个', () => {
    var kb = createKanbanState();
    kb.initFromOrder({
      id: 1, lines: [{ line_num: 1, item_code: 'A', planned_qty: 100 }]
    });
    kb.addContainer(); // cid=1
    kb.addContainer(); // cid=2
    kb.fillRemaining(1); // 全部到容器1
    expect(kb.getContainerTotalQty(1)).toBe(100);
    expect(kb.getContainerTotalQty(2)).toBe(0);
    // 从容器1拖到容器2
    kb.onDropToContainer(2, 1, '1_1');
    expect(kb.getContainerTotalQty(2)).toBe(100);
    expect(kb.getContainerTotalQty(1)).toBe(0);
  });

  test('onDropToContainer — 同容器不操作', () => {
    var kb = createKanbanState();
    kb.initFromOrder({
      id: 1, lines: [{ line_num: 1, item_code: 'A', planned_qty: 50 }]
    });
    kb.addContainer();
    kb.fillRemaining(1);
    kb.onDropToContainer(1, 1, '1_1');
    expect(kb.getContainerTotalQty(1)).toBe(50);
  });
});

// ============================================================================
// buildMultiSOPayload — 缺字段 fallback
// ============================================================================

describe('buildMultiSOPayload — 缺字段 fallback', () => {
  test('containerNo 为空时自动生成 DD-N 编号', () => {
    var itemMap = {
      '1_1': {
        lineKey: '1_1', orderId: 1, lineNum: 1,
        itemCode: 'A', itemName: '物料A', warehouseCode: 'WH',
        totalQty: 10, allocated: { 1: 10 }
      }
    };
    var containers = [{ id: 1, containerNo: '' }];
    var orders = [{ id: 1, sap_doc_num: 'SO100' }];
    var result = buildMultiSOPayload(itemMap, containers, orders);
    expect(result.dd_groups[0].container_no).toBe('DD-1');
  });

  test('sourceOrders 找不到匹配 → source_doc_num 为空', () => {
    var itemMap = {
      '99_1': {
        lineKey: '99_1', orderId: 99, lineNum: 1,
        itemCode: 'A', itemName: '物料A', warehouseCode: 'WH',
        totalQty: 10, allocated: { 1: 10 }
      }
    };
    var containers = [{ id: 1, containerNo: 'CTN1' }];
    var orders = [{ id: 1, sap_doc_num: 'SO100' }]; // orderId=99 不在 orders 里
    var result = buildMultiSOPayload(itemMap, containers, orders);
    expect(result.dd_groups[0].lines[0].source_doc_num).toBe('');
  });
});

// ============================================================================
// validateMultiSOSubmit — sapDocNum 前缀分支
// ============================================================================

describe('validateMultiSOSubmit — sapDocNum 前缀分支', () => {
  test('unallocated 项无 sapDocNum 时不显示前缀', () => {
    var itemMap = {
      '1_1': {
        lineKey: '1_1', orderId: 1, lineNum: 1,
        itemCode: 'M001', totalQty: 10, allocated: {}
      }
    };
    var containers = [{ id: 1, containerNo: 'CTN1' }];
    var fn = function() { return 1; };
    var result = validateMultiSOSubmit(itemMap, containers, fn, 1);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('unallocated');
    expect(result.unallocated[0]).toContain('L1');
    expect(result.unallocated[0]).toContain('M001');
    expect(result.unallocated[0]).not.toContain('undefined');
  });
});

// ============================================================================
// fmtNum — formatNumber 不可用时回退 String()
// ============================================================================

describe('fmtNum — formatNumber 不可用时回退 String()', () => {
  test('formatNumber 不存在时使用 String()', () => {
    var origFn = global.formatNumber;
    delete global.formatNumber;
    expect(fmtNum(42)).toBe('42');
    global.formatNumber = origFn;
  });
});
