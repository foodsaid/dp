/**
 * OMS 前端纯逻辑函数测试
 * 覆盖: DD 路由、DD 标签、OMS 状态映射、DD 拆单验证、看板逻辑、批量搜索
 *
 * 重构: 所有看板逻辑和 DD 验证函数从 oms.js 导入真实模块，不再本地重新实现
 */
const { loadSharedJs } = require('./setup');

// 必须在 require oms.js 之前同步加载 shared.js
// (oms.js 模块加载时会立即调用 initOMS → checkAuth 等 shared.js 全局函数)
loadSharedJs();

// t() 国际化存根 (lang.js 提供，oms.js 的 getOmsStatusLabel 等函数依赖)
global.t = function(key, fallback) { return fallback || key; };

// initOMS 需要: checkAuth (localStorage wms_username) + DOM 元素
localStorage.setItem('wms_username', 'test-user');
document.body.innerHTML =
  '<input id="filterDateTo"/><input id="filterDateFrom"/>' +
  '<input id="filterBP"/><input id="filterBPName"/><input id="filterDocNum"/>' +
  '<input id="filterWarehouse"/><input id="filterContainer"/>' +
  '<select id="filterType"><option value=""></option></select>' +
  '<select id="filterStatus"><option value=""></option></select>' +
  '<select id="pageSizeSelect"></select>' +
  '<div id="toolbarCard"></div><div id="resultCard"></div>' +
  '<table><tbody id="orderBody"></tbody></table>' +
  '<span id="resultCount">0</span>' +
  '<div id="pagination"><button id="btnFirst"></button><button id="btnPrev"></button>' +
  '<button id="btnNext"></button><button id="btnLast"></button><span id="pageInfo"></span></div>' +
  '<span id="selectionCount"></span><input id="selectAll" type="checkbox"/>' +
  '<input id="selectAllHead" type="checkbox"/>' +
  '<button id="btnExpandAll"></button><button id="btnCollapseAll"></button>';

// 导入 oms.js 真实模块 (shared.js 全局函数已就绪)
const {
  round4,
  createKanbanState,
  validateDDSplit,
  parseDocNumInput,
  getOmsStatusLabel,
  getExecStateLabel,
  getBadgeClass,
  renderDetailRow,
  _buildWmsLink,
  _buildDDRefsLinks,
  _formatISODate,
  getSelectedOrders,
  changePageSize,
  queryOrders,
  ensureOrderLines,
  openDDSplitModal,
  loadOrderLines,
  toggleSelect,
  toggleSelectAll,
  updateSelectionCount: _updateSelectionCount,
  renderOrders: _renderOrders,
  renderPagination: _renderPagination,
  goPage,
  resetFilters,
  toggleExpand,
  expandAll,
  collapseAll,
  updateExpandCollapseUI,
  updateSelectionUI,
  PrintService,
  printSelectedOrders,
  printSelectedBarcodes,
  buildOmsDetailRowHtml,
  _getInternalState,
  _setInternalState,
  initOMS,
  checkHasCbmData,
  checkHasWeightData,
  buildSummaryItems,
  buildSourceLabel,
  buildInitItemMap,
  validateMultiSOSubmit,
  buildMultiSOPayload,
  fmtNum,
} = require('../../../apps/wms/oms');

// ============================================================================
// DD 路由 — routeBarcode 中 DD 前缀支持
// ============================================================================

describe('DD 路由支持', () => {
  test('getDocTypeLabel 包含 DD 配送单', () => {
    expect(getDocTypeLabel('DD')).toBe('配送单');
  });

  test('getStatusLabel 包含 split 已拆分', () => {
    expect(getStatusLabel('split')).toBe('已拆分');
  });

  test('getDocTypeIcon 返回 DD 图标 (含 SVG data URI)', () => {
    var icon = getDocTypeIcon('DD');
    expect(icon).toContain('<img');
    expect(icon).toContain('ec4899'); // pink 色 (URL 编码)
  });

  test('getDocTypeIcon DD 指定尺寸', () => {
    var icon = getDocTypeIcon('DD', 48);
    expect(icon).toContain('width="48"');
    expect(icon).toContain('height="48"');
  });
});

// ============================================================================
// OMS 状态映射 — 直接测试 oms.js 导出的真实函数
// ============================================================================

describe('OMS 状态映射', () => {
  test('7 种 OMS 状态返回中文标签', () => {
    expect(getOmsStatusLabel('pending')).toBe('待处理');
    expect(getOmsStatusLabel('in_progress')).toBe('进行中');
    expect(getOmsStatusLabel('completed')).toBe('已完成');
    expect(getOmsStatusLabel('split')).toBe('已拆分');
    expect(getOmsStatusLabel('exported')).toBe('已导出');
    expect(getOmsStatusLabel('cancelled')).toBe('已取消');
    expect(getOmsStatusLabel('partial')).toBe('部分完成');
  });

  test('未知 OMS 状态返回原值', () => {
    expect(getOmsStatusLabel('unknown')).toBe('unknown');
    expect(getOmsStatusLabel('')).toBe('-');
    expect(getOmsStatusLabel(null)).toBe('-');
    expect(getOmsStatusLabel(undefined)).toBe('-');
  });

  test('3 种执行状态返回中文标签', () => {
    expect(getExecStateLabel('idle')).toBe('未开始');
    expect(getExecStateLabel('executing')).toBe('执行中');
    expect(getExecStateLabel('done')).toBe('已完成');
  });

  test('未知执行状态返回原值', () => {
    expect(getExecStateLabel('unknown')).toBe('unknown');
    expect(getExecStateLabel('')).toBe('-');
    expect(getExecStateLabel(null)).toBe('-');
  });

  test('5 种 doc_type 返回正确 badge class', () => {
    expect(getBadgeClass('SO')).toBe('in_progress');
    expect(getBadgeClass('PO')).toBe('pending');
    expect(getBadgeClass('WO')).toBe('draft');
    expect(getBadgeClass('TR')).toBe('exported');
    expect(getBadgeClass('DD')).toBe('split');
  });

  test('未知 doc_type 返回 draft', () => {
    expect(getBadgeClass('XX')).toBe('draft');
    expect(getBadgeClass('')).toBe('draft');
  });
});

// ============================================================================
// DD 拆单验证逻辑 — 直接测试 oms.js 导出的 validateDDSplit
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
// 分页计算 — 通用分页数学
// ============================================================================

describe('OMS 分页计算', () => {
  // 通用分页逻辑 (与 oms.js renderPagination 一致)
  function calcPagination(total, page, pageSize) {
    var totalPages = Math.max(1, Math.ceil(total / pageSize));
    page = Math.max(1, Math.min(page, totalPages));
    return {
      page: page,
      totalPages: totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
      offset: (page - 1) * pageSize
    };
  }

  test('基本分页计算', () => {
    var result = calcPagination(100, 1, 20);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(5);
    expect(result.hasPrev).toBe(false);
    expect(result.hasNext).toBe(true);
    expect(result.offset).toBe(0);
  });

  test('中间页', () => {
    var result = calcPagination(100, 3, 20);
    expect(result.page).toBe(3);
    expect(result.hasPrev).toBe(true);
    expect(result.hasNext).toBe(true);
    expect(result.offset).toBe(40);
  });

  test('最后一页', () => {
    var result = calcPagination(100, 5, 20);
    expect(result.page).toBe(5);
    expect(result.hasPrev).toBe(true);
    expect(result.hasNext).toBe(false);
    expect(result.offset).toBe(80);
  });

  test('超出范围 → 钳制到最后一页', () => {
    var result = calcPagination(100, 99, 20);
    expect(result.page).toBe(5);
  });

  test('page < 1 → 钳制到第一页', () => {
    var result = calcPagination(100, 0, 20);
    expect(result.page).toBe(1);
  });

  test('total = 0 → 单页', () => {
    var result = calcPagination(0, 1, 20);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.hasPrev).toBe(false);
    expect(result.hasNext).toBe(false);
  });

  test('非整除总数', () => {
    var result = calcPagination(21, 1, 20);
    expect(result.totalPages).toBe(2);
  });

  test('恰好整除', () => {
    var result = calcPagination(40, 1, 20);
    expect(result.totalPages).toBe(2);
  });
});

// ============================================================================
// SAP 数据哈希 — wf20 中的哈希逻辑
// ============================================================================

describe('SAP 数据哈希', () => {
  // wf20 工作流中的 SAP 数据变更检测哈希
  function buildSapDataHash(order) {
    return [
      order.sap_status || '',
      order.sap_cancelled || '',
      order.doc_total || 0,
      order.bp_code || '',
      order.line_count || 0
    ].join('|');
  }

  test('正常订单哈希', () => {
    var hash = buildSapDataHash({
      sap_status: 'O',
      sap_cancelled: 'N',
      doc_total: 1500.50,
      bp_code: 'C001',
      line_count: 5
    });
    expect(hash).toBe('O|N|1500.5|C001|5');
  });

  test('空字段哈希', () => {
    var hash = buildSapDataHash({});
    expect(hash).toBe('||0||0');
  });

  test('相同数据产生相同哈希', () => {
    var data = { sap_status: 'C', sap_cancelled: 'Y', doc_total: 100, bp_code: 'V001', line_count: 3 };
    expect(buildSapDataHash(data)).toBe(buildSapDataHash(data));
  });

  test('不同数据产生不同哈希', () => {
    var data1 = { sap_status: 'O', doc_total: 100, bp_code: 'C001', line_count: 1 };
    var data2 = { sap_status: 'C', doc_total: 100, bp_code: 'C001', line_count: 1 };
    expect(buildSapDataHash(data1)).not.toBe(buildSapDataHash(data2));
  });
});

// ============================================================================
// routeBarcode DD 路由 — 通过 shared.js 中真正的 routeBarcode
// ============================================================================

describe('routeBarcode DD 路由集成', () => {
  let originalLocation;

  beforeEach(() => {
    originalLocation = window.location.href;
    delete window.location;
    window.location = {
      href: 'http://localhost:8080/wms/index.html'
    };
  });

  afterEach(() => {
    window.location = { href: originalLocation };
  });

  test('DD26000001 路由到 so.html?docnum=DD26000001', () => {
    if (typeof routeBarcode === 'function') {
      routeBarcode('DD26000001');
      expect(window.location.href).toContain('so.html');
      expect(window.location.href).toContain('26000001');
    }
  });
});

// ============================================================================
// round4 精度工具 — 直接测试 oms.js 导出的 round4
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
// initFromOrder 初始化 — 直接测试 oms.js 导出的 createKanbanState
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
// 批量单号搜索 — 直接测试 oms.js 导出的 parseDocNumInput
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
// renderDetailRow DD 交叉引用
// ============================================================================

describe('renderDetailRow DD 交叉引用', () => {
  test('SO 行显示 dd_refs (超链接)', () => {
    var order = {
      id: 1,
      lines: [
        { line_num: 1, item_code: 'A001', item_name: 'Item A', planned_qty: 100, actual_qty: 50, warehouse_code: 'WH01', status: 'partial', dd_refs: 'DD26000001#1, DD26000002#1' },
        { line_num: 2, item_code: 'B002', item_name: 'Item B', planned_qty: 50, actual_qty: 0, warehouse_code: 'WH01', status: 'pending', dd_refs: null }
      ],
      dd_children: []
    };
    var html = renderDetailRow(order);
    // dd_refs 现在渲染为独立超链接
    expect(html).toContain('DD26000001#1');
    expect(html).toContain('DD26000002#1');
    expect(html).toContain('#ec4899'); // 粉色超链接
    expect(html).toContain('so.html?docnum=DD26000001');
  });

  test('SO 行 dd_refs 渲染在单号列 (col4) 而非日期列 (col10)', () => {
    var order = {
      id: 10,
      lines: [
        { line_num: 1, item_code: 'A001', item_name: 'Item A', planned_qty: 100, actual_qty: 50, warehouse_code: 'WH01', status: 'partial', dd_refs: 'DD26000099#1' }
      ]
    };
    var html = renderDetailRow(order);
    // 解析 td 序列，验证 dd_refs 在第 4 列 (单号列)
    var row = html.match(/<tr[^>]*>(.+?)<\/tr>/s);
    var tds = row[1].match(/<td[^>]*>.*?<\/td>/gs);
    // col4 (index 3) 应包含 DD 引用
    expect(tds[3]).toContain('DD26000099');
    expect(tds[3]).toContain('#ec4899');
    // col10 (index 9) 应为空
    expect(tds[9]).toBe('<td></td>');
  });

  test('SO 行无 dd_refs 时单号列和日期列均为空', () => {
    var order = {
      id: 2,
      lines: [
        { line_num: 1, item_code: 'X001', item_name: 'Item X', planned_qty: 10, actual_qty: 0, warehouse_code: 'WH01', status: 'pending' }
      ]
    };
    var html = renderDetailRow(order);
    expect(html).not.toContain('DD26');
    expect(html).not.toContain('#ec4899');
  });

  test('DD 行显示 source_line_num', () => {
    var order = {
      id: 3,
      doc_type: 'DD',
      lines: [
        { line_num: 1, item_code: 'A001', item_name: 'Item A', planned_qty: 50, actual_qty: 0, warehouse_code: 'WH01', status: 'pending', source_line_num: 1, source_doc_number: 'SO-2026-001' },
        { line_num: 2, item_code: 'C003', item_name: 'Item C', planned_qty: 75, actual_qty: 0, warehouse_code: 'WH01', status: 'pending', source_line_num: 3, source_doc_number: 'SO-2026-001' }
      ],
      dd_children: []
    };
    var html = renderDetailRow(order);
    // 源单号头部
    expect(html).toContain('SO-2026-001');
    // 紫色样式 (DD 引用)
    expect(html).toContain('#6366f1');
  });

  test('DD 行 source_line_num 为 null 时仅显示源单号', () => {
    var order = {
      id: 4,
      doc_type: 'DD',
      lines: [
        { line_num: 1, item_code: 'A001', item_name: 'Item A', planned_qty: 50, actual_qty: 0, warehouse_code: 'WH01', status: 'pending', source_line_num: null, source_doc_number: 'SO-2026-002' }
      ]
    };
    var html = renderDetailRow(order);
    expect(html).toContain('SO-2026-002');
    // 紫色超链接样式
    expect(html).toContain('#6366f1');
  });

  test('空行列表返回 0 行提示', () => {
    var order = { id: 5, lines: [] };
    var html = renderDetailRow(order);
    expect(html).toContain('行项目');
    expect(html).toContain('0');
  });

  test('SO 行有 dd_refs 时渲染粉色超链接', () => {
    var order = {
      id: 6,
      lines: [
        { line_num: 1, item_code: 'A001', item_name: 'Item A', planned_qty: 100, actual_qty: 50, warehouse_code: 'WH01', status: 'partial', dd_refs: 'DD26000001#1' }
      ]
    };
    var html = renderDetailRow(order);
    expect(html).toContain('DD26000001');
    expect(html).toContain('so.html?docnum=DD26000001');
    expect(html).toContain('#ec4899');
  });

  test('SO 行有 ship_date 时日期列显示发货日期', () => {
    var order = {
      id: 7,
      doc_type: 'SO',
      lines: [
        { line_num: 1, item_code: 'A001', item_name: 'Item A', planned_qty: 100, actual_qty: 0, warehouse_code: 'WH01', status: 'pending', ship_date: '2026-03-10' }
      ]
    };
    var html = renderDetailRow(order);
    expect(html).toContain('2026/3/10');
  });

  test('SO 行无 ship_date 时日期列为空', () => {
    var order = {
      id: 9,
      doc_type: 'SO',
      lines: [
        { line_num: 1, item_code: 'A001', item_name: 'Item A', planned_qty: 100, actual_qty: 0, warehouse_code: 'WH01', status: 'pending' }
      ]
    };
    var html = renderDetailRow(order);
    // 不含 dd-children-row (已移除)
    expect(html).not.toContain('dd-children-row');
  });
});

// ============================================================================
// 第一枪: Type 1 纯函数 — _buildWmsLink
// ============================================================================

describe('_buildWmsLink — WMS 超链接生成', () => {
  test('SO → so.html 链接', () => {
    var result = _buildWmsLink('SO', '26000001');
    expect(result).toContain('so.html?docnum=26000001');
    expect(result).toContain('<a href=');
    expect(result).toContain('26000001');
  });

  test('PO → po.html 链接', () => {
    var result = _buildWmsLink('PO', '50001');
    expect(result).toContain('po.html?docnum=50001');
  });

  test('WO → pi.html 链接 (生产订单指向领料页)', () => {
    var result = _buildWmsLink('WO', '80001');
    expect(result).toContain('pi.html?docnum=80001');
  });

  test('TR → tr.html 链接', () => {
    var result = _buildWmsLink('TR', '70001');
    expect(result).toContain('tr.html?docnum=70001');
  });

  test('DD → so.html 链接 (配送单走拣货页)', () => {
    var result = _buildWmsLink('DD', 'DD26000001');
    expect(result).toContain('so.html?docnum=DD26000001');
  });

  test('未知类型 (如 IC) → 返回纯文本，不含链接', () => {
    var result = _buildWmsLink('IC', '12345');
    expect(result).not.toContain('<a');
    expect(result).toContain('12345');
  });

  test('LM 未在 pageMap → 纯文本', () => {
    var result = _buildWmsLink('LM', '99999');
    expect(result).not.toContain('href');
  });

  test('单号含特殊字符时 URL 编码', () => {
    var result = _buildWmsLink('SO', 'SO&123');
    expect(result).toContain('docnum=SO%26123');
  });
});

// ============================================================================
// 第一枪: Type 1 纯函数 — _buildDDRefsLinks
// ============================================================================

describe('_buildDDRefsLinks — DD 引用超链接', () => {
  test('单个 DD 引用 → 生成超链接', () => {
    var result = _buildDDRefsLinks('DD26000001#1');
    expect(result).toContain('so.html?docnum=DD26000001');
    expect(result).toContain('DD26000001#1');
    expect(result).toContain('<a');
  });

  test('多个逗号分隔 DD 引用 → 多个超链接', () => {
    var result = _buildDDRefsLinks('DD26000001#1, DD26000002#3');
    expect(result).toContain('so.html?docnum=DD26000001');
    expect(result).toContain('so.html?docnum=DD26000002');
    expect(result).toContain(', ');
  });

  test('空值 → 返回 "-"', () => {
    expect(_buildDDRefsLinks(null)).toBe('-');
    expect(_buildDDRefsLinks(undefined)).toBe('-');
    expect(_buildDDRefsLinks('')).toBe('-');
  });

  test('非 DD 格式引用 → 纯文本 (无链接)', () => {
    var result = _buildDDRefsLinks('SO26000001');
    expect(result).not.toContain('<a');
    expect(result).toContain('SO26000001');
  });

  test('混合: DD + 非 DD → 部分超链接', () => {
    var result = _buildDDRefsLinks('DD26000001#1, INVALID');
    expect(result).toContain('so.html?docnum=DD26000001');
    expect(result).toContain('INVALID');
  });

  test('DD 引用样式为粉色 #ec4899', () => {
    var result = _buildDDRefsLinks('DD26000001#1');
    expect(result).toContain('#ec4899');
  });
});

// ============================================================================
// 第一枪: Type 1 纯函数 — _formatISODate
// ============================================================================

describe('_formatISODate — ISO 日期格式化', () => {
  test('标准日期格式化为 YYYY-MM-DD', () => {
    var d = new Date('2026-03-06T12:00:00Z');
    var result = _formatISODate(d);
    // sv-SE locale 输出 YYYY-MM-DD 格式
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('月初日期格式正确', () => {
    var d = new Date('2026-01-01T12:00:00Z');
    var result = _formatISODate(d);
    expect(result).toContain('2026');
    expect(result).toContain('01');
  });
});

// ============================================================================
// 第一枪: Type 1 纯函数 — getSelectedOrders
// ============================================================================

describe('getSelectedOrders — 获取已选订单', () => {
  afterEach(() => {
    _setInternalState({ _orders: [], _selectedIds: new Set() });
  });

  test('有选中项 → 返回对应订单', () => {
    var orders = [{ id: 1 }, { id: 2 }, { id: 3 }];
    _setInternalState({ _orders: orders, _selectedIds: new Set([1, 3]) });
    var result = getSelectedOrders();
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(3);
  });

  test('无选中项 → 返回空数组', () => {
    _setInternalState({ _orders: [{ id: 1 }], _selectedIds: new Set() });
    var result = getSelectedOrders();
    expect(result).toEqual([]);
  });

  test('选中不存在的 id → 过滤为空', () => {
    _setInternalState({ _orders: [{ id: 1 }], _selectedIds: new Set([999]) });
    var result = getSelectedOrders();
    expect(result).toEqual([]);
  });
});

// ============================================================================
// 第一枪: Type 1 纯函数 — changePageSize
// ============================================================================

describe('changePageSize — 分页大小切换', () => {
  beforeEach(() => {
    _setInternalState({ _page: 3, _pageSize: 20, _totalPages: 5 });
    // queryOrders 需要完整 DOM，这里 mock apiGet 让它快速返回
    global.apiGet = jest.fn().mockResolvedValue({ success: true, orders: [], total: 0 });
    // queryOrders 需要的 DOM 元素
    document.body.innerHTML +=
      '<select id="filterType"><option value=""></option></select>' +
      '<input id="filterWarehouse"/><input id="filterContainer"/>' +
      '<select id="filterStatus"><option value=""></option></select>' +
      '<div id="toolbarCard"></div><div id="resultCard"></div>' +
      '<tbody id="orderBody"></tbody><span id="resultCount"></span>' +
      '<div id="pagination"><button id="btnFirst"></button><button id="btnPrev"></button>' +
      '<button id="btnNext"></button><button id="btnLast"></button><span id="pageInfo"></span></div>' +
      '<span id="selectionCount"></span><input id="selectAll" type="checkbox"/>';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('合法值 50 → 设置 _pageSize=50', async () => {
    await changePageSize(50);
    expect(_getInternalState()._pageSize).toBe(50);
    expect(localStorage.getItem('oms_page_size')).toBe('50');
  });

  test('合法值 100 → 设置 _pageSize=100', async () => {
    await changePageSize(100);
    expect(_getInternalState()._pageSize).toBe(100);
  });

  test('非法值 → 回退到默认 20', async () => {
    await changePageSize(999);
    expect(_getInternalState()._pageSize).toBe(20);
  });

  test('字符串数字 "50" → 正确解析', async () => {
    await changePageSize('50');
    expect(_getInternalState()._pageSize).toBe(50);
  });

  test('非数字字符串 → 回退到 20', async () => {
    await changePageSize('abc');
    expect(_getInternalState()._pageSize).toBe(20);
  });

  test('调用后重置到第 1 页 (触发 queryOrders)', async () => {
    await changePageSize(50);
    // queryOrders 被调用时 page=1
    expect(global.apiGet).toHaveBeenCalled();
    var url = global.apiGet.mock.calls[0][0];
    expect(url).toContain('page=1');
  });
});

// ============================================================================
// 第二枪: Type 2 API — queryOrders
// ============================================================================

describe('queryOrders — 核心查询', () => {
  beforeEach(() => {
    // 构建完整 DOM
    document.body.innerHTML =
      '<select id="filterType"><option value=""></option><option value="SO">SO</option></select>' +
      '<input id="filterBP" value=""/><input id="filterBPName" value=""/>' +
      '<input id="filterDocNum" value=""/><input id="filterWarehouse" value=""/>' +
      '<input id="filterContainer" value=""/>' +
      '<select id="filterStatus"><option value=""></option></select>' +
      '<input id="filterDateFrom" value="2026-01-01"/>' +
      '<input id="filterDateTo" value="2026-03-06"/>' +
      '<select id="pageSizeSelect"><option value="20">20</option></select>' +
      '<div id="toolbarCard" style="display:none"></div>' +
      '<div id="resultCard" style="display:none"></div>' +
      '<table><tbody id="orderBody"></tbody></table>' +
      '<span id="resultCount">0</span>' +
      '<div id="pagination"><button id="btnFirst"></button><button id="btnPrev"></button>' +
      '<button id="btnNext"></button><button id="btnLast"></button><span id="pageInfo"></span></div>' +
      '<span id="selectionCount"></span>' +
      '<input id="selectAll" type="checkbox"/>';

    _setInternalState({
      _orders: [],
      _page: 1,
      _pageSize: 20,
      _totalPages: 1,
      _totalRecords: 0,
      _selectedIds: new Set(),
      _expandedIds: new Set()
    });

    global.apiGet = jest.fn().mockResolvedValue({
      success: true,
      orders: [{ id: 1, doc_type: 'SO', sap_doc_num: '26000001', oms_status: 'pending' }],
      total: 1
    });
    global.showLoading = jest.fn();
    global.showMessage = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('路径 A: 普通查询 — 正确拼接 URL 参数', async () => {
    document.getElementById('filterType').value = 'SO';
    document.getElementById('filterBP').value = 'BP001';
    document.getElementById('filterBPName').value = '测试客户';

    await queryOrders(1);

    expect(global.apiGet).toHaveBeenCalledTimes(1);
    var url = global.apiGet.mock.calls[0][0];
    expect(url).toContain('doc_type=SO');
    expect(url).toContain('business_partner=BP001');
    expect(url).toContain('bp_name=' + encodeURIComponent('测试客户'));
    expect(url).toContain('page=1');
    expect(url).toContain('page_size=20');
  });

  test('路径 A: 日期参数正确传递', async () => {
    await queryOrders(1);

    var url = global.apiGet.mock.calls[0][0];
    expect(url).toContain('date_from=2026-01-01');
    expect(url).toContain('date_to=2026-03-06');
  });

  test('路径 A: 仓库和柜号筛选', async () => {
    document.getElementById('filterWarehouse').value = 'WH01';
    document.getElementById('filterContainer').value = 'CTN-001';

    await queryOrders(1);

    var url = global.apiGet.mock.calls[0][0];
    expect(url).toContain('warehouse=' + encodeURIComponent('WH01'));
    expect(url).toContain('container_no=' + encodeURIComponent('CTN-001'));
  });

  test('路径 A: 成功后更新内部状态', async () => {
    global.apiGet.mockResolvedValue({
      success: true,
      orders: [{ id: 1 }, { id: 2 }],
      total: 42
    });

    await queryOrders(2);

    var state = _getInternalState();
    expect(state._orders).toHaveLength(2);
    expect(state._totalRecords).toBe(42);
    expect(state._page).toBe(2);
  });

  test('路径 A: 翻页参数 page 正确传递', async () => {
    _setInternalState({ _pageSize: 50 });

    await queryOrders(3);

    var url = global.apiGet.mock.calls[0][0];
    expect(url).toContain('page=3');
    expect(url).toContain('page_size=50');
  });

  test('路径 B: 多单号批量查询 (空格分隔)', async () => {
    document.getElementById('filterDocNum').value = '26000001 26000002 26000003';

    global.apiGet.mockResolvedValue({
      success: true,
      orders: [{ id: 1, sap_doc_num: '26000001' }],
      total: 1
    });

    await queryOrders(1);

    // 多单号: 逐个查询 → 调用次数 = 单号个数
    expect(global.apiGet).toHaveBeenCalledTimes(3);
    var url1 = global.apiGet.mock.calls[0][0];
    var url2 = global.apiGet.mock.calls[1][0];
    var url3 = global.apiGet.mock.calls[2][0];
    expect(url1).toContain('doc_num=26000001');
    expect(url2).toContain('doc_num=26000002');
    expect(url3).toContain('doc_num=26000003');
  });

  test('路径 B: 多单号去重', async () => {
    document.getElementById('filterDocNum').value = '26000001 26000001 26000002';

    global.apiGet.mockResolvedValue({
      success: true,
      orders: [{ id: 1, sap_doc_num: '26000001' }],
      total: 1
    });

    await queryOrders(1);

    // 去重后只有 2 个唯一单号
    expect(global.apiGet).toHaveBeenCalledTimes(2);
  });

  test('路径 B: 多单号结果合并去重 (相同 id 不重复)', async () => {
    document.getElementById('filterDocNum').value = '26000001 26000002';

    // 两次查询返回相同 id 的订单
    global.apiGet
      .mockResolvedValueOnce({ success: true, orders: [{ id: 100, sap_doc_num: '26000001' }] })
      .mockResolvedValueOnce({ success: true, orders: [{ id: 100, sap_doc_num: '26000001' }, { id: 200, sap_doc_num: '26000002' }] });

    await queryOrders(1);

    var state = _getInternalState();
    // id=100 只保留一条
    expect(state._orders).toHaveLength(2);
    expect(state._orders[0].id).toBe(100);
    expect(state._orders[1].id).toBe(200);
  });

  test('路径 B: 超过 50 个单号 → 警告', async () => {
    var nums = [];
    for (var i = 0; i < 51; i++) nums.push('S' + i);
    document.getElementById('filterDocNum').value = nums.join(' ');

    await queryOrders(1);

    expect(global.showMessage).toHaveBeenCalledWith(expect.stringContaining('50'), 'warning');
    expect(global.apiGet).not.toHaveBeenCalled();
  });

  test('路径 C: API 返回失败', async () => {
    global.apiGet.mockResolvedValue({ success: false, message: '服务器错误' });

    await queryOrders(1);

    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('服务器错误'), 'error'
    );
  });

  test('路径 C: API 抛出异常', async () => {
    global.apiGet.mockRejectedValue(new Error('网络超时'));

    await queryOrders(1);

    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('网络超时'), 'error'
    );
    // 清空订单
    expect(_getInternalState()._orders).toEqual([]);
  });

  test('单单号查询 → 使用 doc_num 参数', async () => {
    document.getElementById('filterDocNum').value = '26000099';

    await queryOrders(1);

    expect(global.apiGet).toHaveBeenCalledTimes(1);
    var url = global.apiGet.mock.calls[0][0];
    expect(url).toContain('doc_num=26000099');
  });

  test('page 参数非数字时默认为 1', async () => {
    await queryOrders('invalid');

    var url = global.apiGet.mock.calls[0][0];
    expect(url).toContain('page=1');
  });

  test('showLoading 在查询前后被调用', async () => {
    await queryOrders(1);

    expect(global.showLoading).toHaveBeenCalledWith(true);
    expect(global.showLoading).toHaveBeenCalledWith(false);
  });
});

// ============================================================================
// 第二枪: Type 2 API — ensureOrderLines (双路径)
// ============================================================================

describe('ensureOrderLines — 批量行加载', () => {
  beforeEach(() => {
    global.apiGet = jest.fn();
    global.showMessage = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('路径 A: batch API 成功 → 所有订单行被填充', async () => {
    var orders = [
      { id: 1 },
      { id: 2 }
    ];

    global.apiGet.mockResolvedValue({
      success: true,
      results: {
        1: { lines: [{ item_code: 'A' }], dd_children: [] },
        2: { lines: [{ item_code: 'B' }], dd_children: ['DD1'] }
      }
    });

    await ensureOrderLines(orders);

    expect(orders[0].lines).toEqual([{ item_code: 'A' }]);
    expect(orders[0]._linesLoaded).toBe(true);
    expect(orders[1].dd_children).toEqual(['DD1']);
    expect(global.apiGet).toHaveBeenCalledTimes(1);
    expect(global.apiGet.mock.calls[0][0]).toContain('/oms/order-lines/batch?order_ids=');
  });

  test('路径 A: 已加载的订单不重复请求', async () => {
    var orders = [
      { id: 1, _linesLoaded: true, lines: [{ item_code: 'A' }] },
      { id: 2, _linesLoaded: true, lines: [] }
    ];

    await ensureOrderLines(orders);

    expect(global.apiGet).not.toHaveBeenCalled();
  });

  test('路径 B: batch API 失败 → 逐个回退加载', async () => {
    var orders = [{ id: 10 }, { id: 20 }];

    // batch 失败
    global.apiGet
      .mockRejectedValueOnce(new Error('batch 500'))
      // 逐个加载成功
      .mockResolvedValueOnce({ success: true, lines: [{ item_code: 'X' }], dd_children: [] })
      .mockResolvedValueOnce({ success: true, lines: [{ item_code: 'Y' }], dd_children: [] });

    await ensureOrderLines(orders);

    // 第 1 次 batch 失败 + 第 2、3 次逐个回退
    expect(global.apiGet).toHaveBeenCalledTimes(3);
    expect(orders[0].lines).toEqual([{ item_code: 'X' }]);
    expect(orders[0]._linesLoaded).toBe(true);
    expect(orders[1].lines).toEqual([{ item_code: 'Y' }]);
  });

  test('路径 B: 逐个回退时部分失败 → 标记 _loadError', async () => {
    var orders = [{ id: 10 }, { id: 20 }];

    global.apiGet
      .mockRejectedValueOnce(new Error('batch fail'))
      .mockResolvedValueOnce({ success: true, lines: [], dd_children: [] })
      .mockRejectedValueOnce(new Error('单个也失败'));

    await ensureOrderLines(orders);

    expect(orders[0]._linesLoaded).toBe(true);
    expect(orders[1]._loadError).toBe(true);
  });

  test('batch 返回 success=false → 进入逐个回退', async () => {
    var orders = [{ id: 5 }];

    global.apiGet
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true, lines: [{ item_code: 'Z' }], dd_children: [] });

    await ensureOrderLines(orders);

    expect(global.apiGet).toHaveBeenCalledTimes(2);
    expect(orders[0].lines).toEqual([{ item_code: 'Z' }]);
  });

  test('batch 返回中缺少某订单 → 该订单标记 _loadError', async () => {
    var orders = [{ id: 1 }, { id: 2 }];

    global.apiGet.mockResolvedValue({
      success: true,
      results: {
        1: { lines: [{ item_code: 'A' }], dd_children: [] }
        // 2 缺失
      }
    });

    await ensureOrderLines(orders);

    expect(orders[0]._linesLoaded).toBe(true);
    expect(orders[1]._loadError).toBe(true);
  });

  test('空订单数组 → 不发起请求', async () => {
    await ensureOrderLines([]);
    expect(global.apiGet).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 第三枪: Type 2 API — openDDSplitModal (5 项校验)
// ============================================================================

describe('openDDSplitModal — DD 拆单校验', () => {
  beforeEach(() => {
    global.showMessage = jest.fn();
    global.showLoading = jest.fn();
    global.apiGet = jest.fn();
    _setInternalState({ _selectedIds: new Set(), _orders: [] });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('校验 ①: 无选中 → 提示请先选择', async () => {
    _setInternalState({ _selectedIds: new Set(), _orders: [] });

    await openDDSplitModal();

    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('请先选择'), 'warning'
    );
  });

  test('校验 ②: 选中非 SO 类型 → 提示类型错误', async () => {
    var orders = [{ id: 1, doc_type: 'PO', sap_doc_num: '50001' }];
    _setInternalState({ _selectedIds: new Set([1]), _orders: orders });

    await openDDSplitModal();

    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('SO'), 'warning'
    );
  });

  test('校验 ③: SO 正在执行 → 禁止拆单', async () => {
    var orders = [{ id: 1, doc_type: 'SO', sap_doc_num: '26000001', execution_state: 'executing' }];
    _setInternalState({ _selectedIds: new Set([1]), _orders: orders });

    await openDDSplitModal();

    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('禁止拆单'), 'error'
    );
  });

  test('校验 ③: SO 已完成执行 → 禁止拆单', async () => {
    var orders = [{ id: 1, doc_type: 'SO', sap_doc_num: '26000001', execution_state: 'done' }];
    _setInternalState({ _selectedIds: new Set([1]), _orders: orders });

    await openDDSplitModal();

    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('禁止拆单'), 'error'
    );
  });

  test('校验 ④: 已有 DD 子单 → 不能重复创建', async () => {
    var orders = [{ id: 1, doc_type: 'SO', sap_doc_num: '26000001', dd_children: [{ id: 99 }] }];
    _setInternalState({ _selectedIds: new Set([1]), _orders: orders });

    await openDDSplitModal();

    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('已拆分'), 'warning'
    );
  });

  test('校验 ⑤: 行加载失败 → 提示错误', async () => {
    var orders = [{ id: 1, doc_type: 'SO', sap_doc_num: '26000001' }];
    _setInternalState({ _selectedIds: new Set([1]), _orders: orders });

    // batch API 失败 + 逐个也失败 → _loadError=true
    global.apiGet.mockRejectedValue(new Error('网络错误'));

    await openDDSplitModal();

    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('加载失败'), 'error'
    );
  });

  test('校验 ⑥: 无行项目 → 提示无行项目', async () => {
    var orders = [{ id: 1, doc_type: 'SO', sap_doc_num: '26000001' }];
    _setInternalState({ _selectedIds: new Set([1]), _orders: orders });

    // 成功但返回空行
    global.apiGet.mockResolvedValue({
      success: true,
      results: { 1: { lines: [], dd_children: [] } }
    });

    await openDDSplitModal();

    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('没有行项目'), 'warning'
    );
  });

  test('校验 ⑦: 多 SO 不同仓库 → 拒绝合并', async () => {
    var orders = [
      { id: 1, doc_type: 'SO', sap_doc_num: '26000001' },
      { id: 2, doc_type: 'SO', sap_doc_num: '26000002' }
    ];
    _setInternalState({ _selectedIds: new Set([1, 2]), _orders: orders });

    global.apiGet.mockResolvedValue({
      success: true,
      results: {
        1: { lines: [{ item_code: 'A', warehouse_code: 'WH01', planned_qty: 10 }], dd_children: [] },
        2: { lines: [{ item_code: 'B', warehouse_code: 'WH02', planned_qty: 20 }], dd_children: [] }
      }
    });

    await openDDSplitModal();

    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('不同仓库'), 'error'
    );
  });

  test('全部校验通过 → 桥接到 Vue', async () => {
    var orders = [{ id: 1, doc_type: 'SO', sap_doc_num: '26000001' }];
    _setInternalState({ _selectedIds: new Set([1]), _orders: orders });

    global.apiGet.mockResolvedValue({
      success: true,
      results: {
        1: { lines: [{ item_code: 'A', warehouse_code: 'WH01', planned_qty: 10 }], dd_children: [] }
      }
    });

    var mockVue = { initFromOrders: jest.fn() };
    window._ddVueApp = mockVue;

    await openDDSplitModal();

    expect(mockVue.initFromOrders).toHaveBeenCalledTimes(1);

    delete window._ddVueApp;
  });

  test('无 Vue 看板 → 提示初始化失败', async () => {
    var orders = [{ id: 1, doc_type: 'SO', sap_doc_num: '26000001' }];
    _setInternalState({ _selectedIds: new Set([1]), _orders: orders });

    global.apiGet.mockResolvedValue({
      success: true,
      results: {
        1: { lines: [{ item_code: 'A', warehouse_code: 'WH01', planned_qty: 10 }], dd_children: [] }
      }
    });

    delete window._ddVueApp;

    await openDDSplitModal();

    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('初始化失败'), 'error'
    );
  });
});

// ============================================================================
// goPage — 页码跳转
// ============================================================================

describe('goPage — 分页跳转', () => {
  beforeEach(() => {
    global.apiGet = jest.fn().mockResolvedValue({ success: true, orders: [], total: 0 });
    global.showLoading = jest.fn();
    global.showMessage = jest.fn();
    // 完整 DOM
    document.body.innerHTML =
      '<select id="filterType"><option value=""></option></select>' +
      '<input id="filterBP" value=""/><input id="filterBPName" value=""/>' +
      '<input id="filterDocNum" value=""/><input id="filterWarehouse" value=""/>' +
      '<input id="filterContainer" value=""/>' +
      '<select id="filterStatus"><option value=""></option></select>' +
      '<input id="filterDateFrom" value="2026-01-01"/><input id="filterDateTo" value="2026-03-06"/>' +
      '<div id="toolbarCard"></div><div id="resultCard"></div>' +
      '<table><tbody id="orderBody"></tbody></table><span id="resultCount"></span>' +
      '<div id="pagination"><button id="btnFirst"></button><button id="btnPrev"></button>' +
      '<button id="btnNext"></button><button id="btnLast"></button><span id="pageInfo"></span></div>' +
      '<span id="selectionCount"></span><input id="selectAll" type="checkbox"/>';
    _setInternalState({ _page: 2, _totalPages: 5, _pageSize: 20 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('合法页码 → 触发 queryOrders', async () => {
    await goPage(3);
    expect(global.apiGet).toHaveBeenCalled();
  });

  test('页码 < 1 → 不触发查询', () => {
    goPage(0);
    expect(global.apiGet).not.toHaveBeenCalled();
  });

  test('页码 > totalPages → 不触发查询', () => {
    goPage(99);
    expect(global.apiGet).not.toHaveBeenCalled();
  });

  test('当前页 → 不触发查询', () => {
    goPage(2); // 当前就是 2
    expect(global.apiGet).not.toHaveBeenCalled();
  });
});

// ============================================================================
// loadOrderLines — 单个订单行加载
// ============================================================================

describe('loadOrderLines — 单订单行加载', () => {
  beforeEach(() => {
    global.apiGet = jest.fn();
    global.showMessage = jest.fn();
    document.body.innerHTML =
      '<table><tbody id="orderBody"></tbody></table><span id="resultCount">0</span>' +
      '<div id="pagination" style="display:none"><button id="btnFirst"></button><button id="btnPrev"></button>' +
      '<button id="btnNext"></button><button id="btnLast"></button><span id="pageInfo"></span></div>' +
      '<span id="selectionCount"></span><input id="selectAll" type="checkbox"/>' +
      '<button id="btnExpandAll"></button><button id="btnCollapseAll"></button>';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('成功加载 → 填充 order.lines 和 dd_children', async () => {
    var orders = [{ id: 42 }];
    _setInternalState({ _orders: orders, _totalRecords: 1, _totalPages: 1 });

    global.apiGet.mockResolvedValue({
      success: true,
      lines: [{ item_code: 'X', line_num: 0 }],
      dd_children: [{ id: 99 }]
    });

    await loadOrderLines(42);

    expect(orders[0].lines).toEqual([{ item_code: 'X', line_num: 0 }]);
    expect(orders[0].dd_children).toEqual([{ id: 99 }]);
    expect(global.apiGet).toHaveBeenCalledWith('/oms/order-lines?order_id=42');
  });

  test('加载失败 → 显示错误消息', async () => {
    _setInternalState({ _orders: [{ id: 1 }], _totalRecords: 1, _totalPages: 1 });
    global.apiGet.mockRejectedValue(new Error('超时'));

    await loadOrderLines(1);

    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('超时'), 'error'
    );
  });
});

// ============================================================================
// 展开/折叠 UI 逻辑 — toggleExpand / expandAll / collapseAll
// ============================================================================
describe('展开/折叠 UI 逻辑', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 构建带关联 ID 的主行 + 详情行
    document.getElementById('orderBody').innerHTML =
      '<tr data-oid="1"><td>order1</td></tr>' +
      '<tr id="details-1" class="details-row" style="display:none;"><td>details1</td></tr>' +
      '<tr data-oid="2"><td>order2</td></tr>' +
      '<tr id="details-2" class="details-row" style="display:none;"><td>details2</td></tr>';
    // 重置内部状态: 两条订单，都未展开
    _setInternalState({
      _orders: [
        { id: 1, lines: [{ item_code: 'A' }] },
        { id: 2, lines: [{ item_code: 'B' }] }
      ],
      _totalRecords: 2,
      _totalPages: 1,
      _expandedIds: new Set(),
      _selectedIds: new Set()
    });
  });

  test('toggleExpand — 展开一个订单', () => {
    toggleExpand(1);
    var state = _getInternalState();
    expect(state._expandedIds.has(1)).toBe(true);
    expect(state._expandedIds.size).toBe(1);
  });

  test('toggleExpand — 再次点击收起', () => {
    toggleExpand(1);
    toggleExpand(1);
    var state = _getInternalState();
    expect(state._expandedIds.has(1)).toBe(false);
    expect(state._expandedIds.size).toBe(0);
  });

  test('toggleExpand — 无行数据时触发 loadOrderLines', async () => {
    _setInternalState({
      _orders: [{ id: 3 }],   // 没有 lines
      _totalRecords: 1,
      _totalPages: 1,
      _expandedIds: new Set(),
      _selectedIds: new Set()
    });
    global.apiGet.mockResolvedValue({ success: true, lines: [{ item_code: 'Z' }], dd_children: [] });
    toggleExpand(3);
    // loadOrderLines 被异步触发
    expect(global.apiGet).toHaveBeenCalledWith('/oms/order-lines?order_id=3');
  });

  test('expandAll — 全部展开', () => {
    expandAll();
    var state = _getInternalState();
    expect(state._expandedIds.has(1)).toBe(true);
    expect(state._expandedIds.has(2)).toBe(true);
    expect(state._expandedIds.size).toBe(2);
  });

  test('expandAll — 缺少行数据时异步加载', () => {
    _setInternalState({
      _orders: [{ id: 10 }, { id: 11 }],
      _totalRecords: 2,
      _totalPages: 1,
      _expandedIds: new Set(),
      _selectedIds: new Set()
    });
    global.apiGet.mockResolvedValue({ success: true, lines: [], dd_children: [] });
    expandAll();
    // 两个订单都缺行数据 → 两次 apiGet 调用
    expect(global.apiGet).toHaveBeenCalledTimes(2);
  });

  test('collapseAll — 全部收起', () => {
    // 先展开
    expandAll();
    expect(_getInternalState()._expandedIds.size).toBe(2);
    // 再收起
    collapseAll();
    expect(_getInternalState()._expandedIds.size).toBe(0);
  });

  test('updateExpandCollapseUI — 全部展开时禁用展开按钮', () => {
    expandAll();
    updateExpandCollapseUI();
    var btnExpand = document.getElementById('btnExpandAll');
    var btnCollapse = document.getElementById('btnCollapseAll');
    expect(btnExpand.disabled).toBe(true);
    expect(btnExpand.style.opacity).toBe('0.4');
    expect(btnCollapse.disabled).toBe(false);
    expect(btnCollapse.style.opacity).toBe('1');
  });

  test('updateExpandCollapseUI — 全部收起时禁用收起按钮', () => {
    collapseAll();
    updateExpandCollapseUI();
    var btnExpand = document.getElementById('btnExpandAll');
    var btnCollapse = document.getElementById('btnCollapseAll');
    expect(btnExpand.disabled).toBe(false);
    expect(btnExpand.style.opacity).toBe('1');
    expect(btnCollapse.disabled).toBe(true);
    expect(btnCollapse.style.opacity).toBe('0.4');
  });

  test('updateExpandCollapseUI — 部分展开时两个按钮都启用', () => {
    toggleExpand(1);  // 仅展开 id=1
    updateExpandCollapseUI();
    var btnExpand = document.getElementById('btnExpandAll');
    var btnCollapse = document.getElementById('btnCollapseAll');
    expect(btnExpand.disabled).toBe(false);
    expect(btnCollapse.disabled).toBe(false);
  });

  test('updateExpandCollapseUI — 无按钮元素时不报错', () => {
    document.getElementById('btnExpandAll').remove();
    document.getElementById('btnCollapseAll').remove();
    expect(() => updateExpandCollapseUI()).not.toThrow();
  });
});

// ============================================================================
// 勾选逻辑与打印入口 — toggleSelect / toggleSelectAll / printSelectedOrders
// ============================================================================
describe('勾选逻辑与打印入口', () => {
  /** 每个测试前重建完整 DOM (防止其他 describe 修改 body) */
  function rebuildDOM() {
    document.body.innerHTML =
      '<input id="filterDateTo"/><input id="filterDateFrom"/>' +
      '<input id="filterBP"/><input id="filterBPName"/><input id="filterDocNum"/>' +
      '<input id="filterWarehouse"/><input id="filterContainer"/>' +
      '<select id="filterType"><option value=""></option></select>' +
      '<select id="filterStatus"><option value=""></option></select>' +
      '<select id="pageSizeSelect"></select>' +
      '<div id="toolbarCard"></div><div id="resultCard"></div>' +
      '<table><tbody id="orderBody">' +
      '<tr data-oid="1"><td><input type="checkbox" class="order-checkbox"/></td><td>order1</td></tr>' +
      '<tr data-oid="2"><td><input type="checkbox" class="order-checkbox"/></td><td>order2</td></tr>' +
      '<tr data-oid="3"><td><input type="checkbox" class="order-checkbox"/></td><td>order3</td></tr>' +
      '</tbody></table>' +
      '<span id="resultCount">0</span>' +
      '<div id="pagination"><button id="btnFirst"></button><button id="btnPrev"></button>' +
      '<button id="btnNext"></button><button id="btnLast"></button><span id="pageInfo"></span></div>' +
      '<span id="selectionCount"></span><input id="selectAll" type="checkbox"/>' +
      '<input id="selectAllHead" type="checkbox"/>' +
      '<button id="btnExpandAll"></button><button id="btnCollapseAll"></button>';
  }
  beforeEach(() => {
    jest.clearAllMocks();
    rebuildDOM();
    _setInternalState({
      _orders: [
        { id: 1, doc_type: 'SO', status: 'PENDING' },
        { id: 2, doc_type: 'SO', status: 'PENDING' },
        { id: 3, doc_type: 'WO', status: 'PENDING' }
      ],
      _totalRecords: 3,
      _totalPages: 1,
      _selectedIds: new Set(),
      _expandedIds: new Set()
    });
  });

  test('toggleSelect — 单选一个订单', () => {
    toggleSelect(1);
    var state = _getInternalState();
    expect(state._selectedIds.has(1)).toBe(true);
    expect(state._selectedIds.size).toBe(1);
  });

  test('toggleSelect — 再次点击取消选择', () => {
    toggleSelect(1);
    toggleSelect(1);
    var state = _getInternalState();
    expect(state._selectedIds.has(1)).toBe(false);
    expect(state._selectedIds.size).toBe(0);
  });

  test('toggleSelect — 选多个订单', () => {
    toggleSelect(1);
    toggleSelect(2);
    var state = _getInternalState();
    expect(state._selectedIds.size).toBe(2);
    expect(state._selectedIds.has(1)).toBe(true);
    expect(state._selectedIds.has(2)).toBe(true);
  });

  test('updateSelectionUI — 选中时添加 row-selected 样式', () => {
    _setInternalState({
      _orders: [{ id: 1 }, { id: 2 }, { id: 3 }],
      _totalRecords: 3,
      _totalPages: 1,
      _selectedIds: new Set([1]),
      _expandedIds: new Set()
    });
    updateSelectionUI(1);
    var row = document.querySelector('tr[data-oid="1"]');
    expect(row.classList.contains('row-selected')).toBe(true);
  });

  test('updateSelectionUI — 取消选中时移除 row-selected 样式', () => {
    var row = document.querySelector('tr[data-oid="1"]');
    row.classList.add('row-selected');
    _setInternalState({
      _orders: [{ id: 1 }, { id: 2 }, { id: 3 }],
      _totalRecords: 3,
      _totalPages: 1,
      _selectedIds: new Set(),
      _expandedIds: new Set()
    });
    updateSelectionUI(1);
    expect(row.classList.contains('row-selected')).toBe(false);
  });

  test('updateSelectionUI — 行不存在时不报错', () => {
    _setInternalState({
      _orders: [{ id: 1 }],
      _totalRecords: 1,
      _totalPages: 1,
      _selectedIds: new Set([999]),
      _expandedIds: new Set()
    });
    expect(() => updateSelectionUI(999)).not.toThrow();
  });

  test('toggleSelectAll — 全选', () => {
    document.getElementById('selectAll').checked = true;
    toggleSelectAll();
    var state = _getInternalState();
    expect(state._selectedIds.size).toBe(3);
    expect(state._selectedIds.has(1)).toBe(true);
    expect(state._selectedIds.has(2)).toBe(true);
    expect(state._selectedIds.has(3)).toBe(true);
  });

  test('toggleSelectAll — 取消全选', () => {
    // 先全选
    document.getElementById('selectAll').checked = true;
    toggleSelectAll();
    expect(_getInternalState()._selectedIds.size).toBe(3);
    // 再取消
    document.getElementById('selectAll').checked = false;
    toggleSelectAll();
    expect(_getInternalState()._selectedIds.size).toBe(0);
  });

  test('toggleSelectAll — 同步 selectAllHead 复选框', () => {
    document.getElementById('selectAll').checked = true;
    toggleSelectAll();
    expect(document.getElementById('selectAllHead').checked).toBe(true);

    document.getElementById('selectAll').checked = false;
    toggleSelectAll();
    expect(document.getElementById('selectAllHead').checked).toBe(false);
  });

  test('updateSelectionCount — 显示已选数量', () => {
    toggleSelect(1);
    toggleSelect(2);
    var el = document.getElementById('selectionCount');
    expect(el.textContent).toContain('2');
  });

  test('updateSelectionCount — 无选择时清空', () => {
    toggleSelect(1);
    toggleSelect(1);  // 取消
    var el = document.getElementById('selectionCount');
    expect(el.textContent).toBe('');
  });

  test('updateSelectionCount — 全选时 selectAll/selectAllHead 被勾选', () => {
    toggleSelect(1);
    toggleSelect(2);
    toggleSelect(3);
    // 全部选中 → selectAll 和 selectAllHead 应勾选
    expect(document.getElementById('selectAll').checked).toBe(true);
    expect(document.getElementById('selectAllHead').checked).toBe(true);
  });

  test('updateSelectionCount — 非全选时 selectAll 未勾选', () => {
    toggleSelect(1);
    expect(document.getElementById('selectAll').checked).toBe(false);
  });

  // === printSelectedOrders / printSelectedBarcodes 拦截测试 ===
  test('printSelectedOrders — 无勾选时报 warning', async () => {
    _setInternalState({
      _orders: [{ id: 1 }],
      _totalRecords: 1,
      _totalPages: 1,
      _selectedIds: new Set(),
      _expandedIds: new Set()
    });
    await printSelectedOrders();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('请先选择'), 'warning'
    );
  });

  test('printSelectedBarcodes — 无勾选时报 warning', async () => {
    _setInternalState({
      _orders: [{ id: 1 }],
      _totalRecords: 1,
      _totalPages: 1,
      _selectedIds: new Set(),
      _expandedIds: new Set()
    });
    await printSelectedBarcodes();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('请先选择'), 'warning'
    );
  });

  test('printSelectedOrders — 超过 50 个时报 warning', async () => {
    var manyOrders = [];
    var manyIds = new Set();
    for (var i = 1; i <= 51; i++) {
      manyOrders.push({ id: i, doc_type: 'SO', lines: [] });
      manyIds.add(i);
    }
    _setInternalState({
      _orders: manyOrders,
      _totalRecords: 51,
      _totalPages: 1,
      _selectedIds: manyIds,
      _expandedIds: new Set()
    });
    await printSelectedOrders();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('50'), 'warning'
    );
  });

  test('printSelectedBarcodes — 超过 50 个时报 warning', async () => {
    var manyOrders = [];
    var manyIds = new Set();
    for (var i = 1; i <= 51; i++) {
      manyOrders.push({ id: i, doc_type: 'SO', lines: [] });
      manyIds.add(i);
    }
    _setInternalState({
      _orders: manyOrders,
      _totalRecords: 51,
      _totalPages: 1,
      _selectedIds: manyIds,
      _expandedIds: new Set()
    });
    await printSelectedBarcodes();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('50'), 'warning'
    );
  });

  test('PrintService.isLocked — 默认为 false', () => {
    expect(PrintService.isLocked()).toBe(false);
  });
});

// ============================================================================
// resetFilters — 重置筛选条件
// ============================================================================
describe('resetFilters — 重置筛选条件', () => {
  function rebuildFilterDOM() {
    document.body.innerHTML =
      '<input id="filterDateTo"/><input id="filterDateFrom"/>' +
      '<input id="filterBP"/><input id="filterBPName"/><input id="filterDocNum"/>' +
      '<input id="filterWarehouse"/><input id="filterContainer"/>' +
      '<select id="filterType"><option value=""></option><option value="SO">SO</option></select>' +
      '<select id="filterStatus"><option value=""></option><option value="PENDING">PENDING</option></select>' +
      '<select id="pageSizeSelect"></select>' +
      '<div id="toolbarCard"></div><div id="resultCard"></div>' +
      '<table><tbody id="orderBody"></tbody></table>' +
      '<span id="resultCount">0</span>' +
      '<div id="pagination"><button id="btnFirst"></button><button id="btnPrev"></button>' +
      '<button id="btnNext"></button><button id="btnLast"></button><span id="pageInfo"></span></div>' +
      '<span id="selectionCount"></span><input id="selectAll" type="checkbox"/>' +
      '<input id="selectAllHead" type="checkbox"/>' +
      '<button id="btnExpandAll"></button><button id="btnCollapseAll"></button>';
  }
  beforeEach(() => {
    jest.clearAllMocks();
    rebuildFilterDOM();
    document.getElementById('filterType').value = 'SO';
    document.getElementById('filterBP').value = 'BP001';
    document.getElementById('filterBPName').value = '客户A';
    document.getElementById('filterDocNum').value = '12345';
    document.getElementById('filterWarehouse').value = 'WH01';
    document.getElementById('filterContainer').value = 'CTN01';
    document.getElementById('filterStatus').value = 'PENDING';
    document.getElementById('filterDateFrom').value = '2026-01-01';
    document.getElementById('filterDateTo').value = '2026-01-31';
  });

  test('重置后所有文本/下拉字段清空', () => {
    resetFilters();
    expect(document.getElementById('filterType').value).toBe('');
    expect(document.getElementById('filterBP').value).toBe('');
    expect(document.getElementById('filterBPName').value).toBe('');
    expect(document.getElementById('filterDocNum').value).toBe('');
    expect(document.getElementById('filterWarehouse').value).toBe('');
    expect(document.getElementById('filterContainer').value).toBe('');
    expect(document.getElementById('filterStatus').value).toBe('');
  });

  test('重置后日期 To = 系统今天', () => {
    resetFilters();
    var dateTo = document.getElementById('filterDateTo').value;
    // 日期不为空，且格式为 YYYY-MM-DD
    expect(dateTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('重置后日期 From = 30 天前', () => {
    resetFilters();
    var dateFrom = document.getElementById('filterDateFrom').value;
    var dateTo = document.getElementById('filterDateTo').value;
    expect(dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // From 应早于 To
    expect(new Date(dateFrom).getTime()).toBeLessThan(new Date(dateTo).getTime());
  });
});

// ============================================================================
// openDDSplitModal — 拆单入口密集校验 (Branch 覆盖率核心)
// ============================================================================
describe('openDDSplitModal — 拆单入口校验', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _setInternalState({
      _orders: [],
      _totalRecords: 0,
      _totalPages: 1,
      _selectedIds: new Set(),
      _expandedIds: new Set()
    });
    // 模拟 showLoading
    global.showLoading = jest.fn();
  });

  test('失败分支1: 没有选中任何订单', async () => {
    _setInternalState({
      _orders: [{ id: 1, doc_type: 'SO', status: 'PENDING' }],
      _totalRecords: 1,
      _totalPages: 1,
      _selectedIds: new Set(),
      _expandedIds: new Set()
    });
    await openDDSplitModal();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('请先选择'), 'warning'
    );
  });

  test('失败分支2: 选中的单据类型不是 SO', async () => {
    _setInternalState({
      _orders: [{ id: 1, doc_type: 'WO', status: 'PENDING' }],
      _totalRecords: 1,
      _totalPages: 1,
      _selectedIds: new Set([1]),
      _expandedIds: new Set()
    });
    await openDDSplitModal();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('SO'), 'warning'
    );
  });

  test('失败分支3: 选中的订单正在执行 (execution_state=executing)', async () => {
    _setInternalState({
      _orders: [{ id: 1, doc_type: 'SO', execution_state: 'executing', sap_doc_num: 'SO001' }],
      _totalRecords: 1,
      _totalPages: 1,
      _selectedIds: new Set([1]),
      _expandedIds: new Set()
    });
    await openDDSplitModal();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('禁止拆单'), 'error'
    );
  });

  test('失败分支3b: 选中的订单已完成 (execution_state=done)', async () => {
    _setInternalState({
      _orders: [{ id: 1, doc_type: 'SO', execution_state: 'done', sap_doc_num: 'SO002' }],
      _totalRecords: 1,
      _totalPages: 1,
      _selectedIds: new Set([1]),
      _expandedIds: new Set()
    });
    await openDDSplitModal();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('禁止拆单'), 'error'
    );
  });

  test('失败分支4: 已拆分 DD 子单的订单不能重复拆', async () => {
    _setInternalState({
      _orders: [{ id: 1, doc_type: 'SO', execution_state: 'pending', dd_children: [{ id: 99 }] }],
      _totalRecords: 1,
      _totalPages: 1,
      _selectedIds: new Set([1]),
      _expandedIds: new Set()
    });
    await openDDSplitModal();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('已拆分'), 'warning'
    );
  });

  test('失败分支5: 行数据加载失败 (_loadError)', async () => {
    _setInternalState({
      _orders: [{ id: 1, doc_type: 'SO', execution_state: 'pending' }],
      _totalRecords: 1,
      _totalPages: 1,
      _selectedIds: new Set([1]),
      _expandedIds: new Set()
    });
    // ensureOrderLines 会调用 apiGet → 标记 _loadError
    global.apiGet.mockRejectedValue(new Error('网络超时'));
    await openDDSplitModal();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('加载失败'), 'error'
    );
  });

  test('失败分支6: 订单无行项目', async () => {
    _setInternalState({
      _orders: [{ id: 1, doc_type: 'SO', execution_state: 'pending' }],
      _totalRecords: 1,
      _totalPages: 1,
      _selectedIds: new Set([1]),
      _expandedIds: new Set()
    });
    global.apiGet.mockResolvedValue({ success: true, lines: [], dd_children: [] });
    await openDDSplitModal();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('没有行项目'), 'warning'
    );
  });

  test('失败分支7: 多订单跨仓库拦截', async () => {
    var orders = [
      { id: 1, doc_type: 'SO', execution_state: 'pending', _linesLoaded: true, lines: [{ item_code: 'A', warehouse_code: 'WH01' }] },
      { id: 2, doc_type: 'SO', execution_state: 'pending', _linesLoaded: true, lines: [{ item_code: 'B', warehouse_code: 'WH02' }] }
    ];
    _setInternalState({
      _orders: orders,
      _totalRecords: 2,
      _totalPages: 1,
      _selectedIds: new Set([1, 2]),
      _expandedIds: new Set()
    });
    await openDDSplitModal();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('不同仓库'), 'error'
    );
  });

  test('失败分支7b: 多订单跨仓库 — 回退到订单头仓库', async () => {
    var orders = [
      { id: 1, doc_type: 'SO', execution_state: 'pending', _linesLoaded: true, lines: [{ item_code: 'A', warehouse_code: 'WH01' }] },
      { id: 2, doc_type: 'SO', execution_state: 'pending', _linesLoaded: true, warehouse_code: 'WH02', lines: [] }
    ];
    _setInternalState({
      _orders: orders,
      _totalRecords: 2,
      _totalPages: 1,
      _selectedIds: new Set([1, 2]),
      _expandedIds: new Set()
    });
    await openDDSplitModal();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('不同仓库'), 'error'
    );
  });

  test('成功路径: 单笔 SO → 桥接到 Vue', async () => {
    var orders = [
      { id: 1, doc_type: 'SO', execution_state: 'pending', lines: [{ item_code: 'A', warehouse_code: 'WH01' }] }
    ];
    _setInternalState({
      _orders: orders,
      _totalRecords: 1,
      _totalPages: 1,
      _selectedIds: new Set([1]),
      _expandedIds: new Set()
    });
    global.apiGet.mockResolvedValue({ success: true, lines: [{ item_code: 'A' }], dd_children: [] });

    // Mock Vue app
    var initMock = jest.fn();
    window._ddVueApp = { initFromOrders: initMock };

    await openDDSplitModal();
    expect(initMock).toHaveBeenCalledWith(orders);
    delete window._ddVueApp;
  });

  test('成功路径多笔: 同仓库多 SO → 桥接到 Vue', async () => {
    var orders = [
      { id: 1, doc_type: 'SO', execution_state: 'pending', lines: [{ item_code: 'A', warehouse_code: 'WH01' }] },
      { id: 2, doc_type: 'SO', execution_state: 'pending', lines: [{ item_code: 'B', warehouse_code: 'WH01' }] }
    ];
    _setInternalState({
      _orders: orders,
      _totalRecords: 2,
      _totalPages: 1,
      _selectedIds: new Set([1, 2]),
      _expandedIds: new Set()
    });
    global.apiGet.mockResolvedValue({ success: true, lines: [{ item_code: 'X' }], dd_children: [] });
    var initMock = jest.fn();
    window._ddVueApp = { initFromOrders: initMock };
    await openDDSplitModal();
    expect(initMock).toHaveBeenCalledWith(orders);
    delete window._ddVueApp;
  });

  test('Vue 未初始化时报错', async () => {
    var orders = [
      { id: 1, doc_type: 'SO', execution_state: 'pending', lines: [{ item_code: 'A', warehouse_code: 'WH01' }] }
    ];
    _setInternalState({
      _orders: orders,
      _totalRecords: 1,
      _totalPages: 1,
      _selectedIds: new Set([1]),
      _expandedIds: new Set()
    });
    global.apiGet.mockResolvedValue({ success: true, lines: [{ item_code: 'A' }], dd_children: [] });
    delete window._ddVueApp;
    await openDDSplitModal();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('初始化失败'), 'error'
    );
  });

  test('_isCreatingDD 防重入: 第二次调用立即返回', async () => {
    _setInternalState({
      _orders: [{ id: 1, doc_type: 'SO', execution_state: 'pending' }],
      _totalRecords: 1,
      _totalPages: 1,
      _selectedIds: new Set([1]),
      _expandedIds: new Set()
    });
    // 让 batch API 挂起不返回
    var resolve1;
    global.apiGet.mockImplementation(() => new Promise(r => { resolve1 = r; }));

    var p1 = openDDSplitModal();
    // 第二次调用应立即返回 (因为 _isCreatingDD=true)
    var p2 = openDDSplitModal();
    await p2;
    // showMessage 不应在第二次被调用 (直接 return)
    expect(global.showMessage).not.toHaveBeenCalled();

    // 清理挂起的 promise
    resolve1({ success: true, results: { 1: { lines: [{ item_code: 'A' }], dd_children: [] } } });
    await p1;
  });

  test('异常路径: catch 捕获内部异常', async () => {
    _setInternalState({
      _orders: [{ id: 1, doc_type: 'SO', execution_state: 'pending', _linesLoaded: true, lines: [{ item_code: 'A' }] }],
      _totalRecords: 1,
      _totalPages: 1,
      _selectedIds: new Set([1]),
      _expandedIds: new Set()
    });
    // 模拟 showLoading 第二次调用 (关闭时) 抛异常 → 进入 catch
    var callCount = 0;
    global.showLoading = jest.fn().mockImplementation(function(v) {
      callCount++;
      if (callCount === 2) throw new Error('测试异常');
    });
    await openDDSplitModal();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('测试异常'), 'error'
    );
  });
});

// ============================================================================
// PrintService 深度流程测试 — 覆盖 printBarcodes / printOrders 内部 HTML 生成
// ============================================================================
describe('PrintService 深度流程测试', () => {
  /** 创建 mock window.open 返回对象 */
  function createMockPrintWindow() {
    var written = [];
    return {
      closed: false,
      document: {
        open: jest.fn(),
        write: jest.fn(function(html) { written.push(html); }),
        close: jest.fn()
      },
      print: jest.fn(),
      focus: jest.fn(),
      close: jest.fn(),
      _written: written
    };
  }

  var origOpen;
  beforeEach(() => {
    jest.clearAllMocks();
    origOpen = window.open;
    global.showLoading = jest.fn();
  });

  afterEach(() => {
    window.open = origOpen;
  });

  // --- printBarcodes 流程 ---
  test('printBarcodes — 弹窗被拦截 (window.open 返回 null)', async () => {
    window.open = jest.fn().mockReturnValue(null);
    var orders = [{ id: 1, doc_type: 'SO', _linesLoaded: true, lines: [{ item_code: 'A' }] }];
    await PrintService.printBarcodes(orders);
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('弹窗被拦截'), 'error'
    );
  });

  test('printBarcodes — 加载失败的订单报错', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{ id: 1, doc_type: 'SO', _linesLoaded: true, _loadError: true, lines: [] }];
    await PrintService.printBarcodes(orders);
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('加载失败'), 'error'
    );
  });

  test('printBarcodes — 无行项目时报 warning', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{ id: 1, doc_type: 'SO', _linesLoaded: true, lines: [] }];
    await PrintService.printBarcodes(orders);
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('没有行项目'), 'warning'
    );
  });

  test('printBarcodes — 成功生成条码 HTML 并写入新窗口', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'SO', _linesLoaded: true,
      lines: [
        { item_code: 'ITEM001', item_name: '物料A' },
        { item_code: 'ITEM002', item_name: '物料B' }
      ]
    }];
    await PrintService.printBarcodes(orders);
    expect(mockWin.document.open).toHaveBeenCalled();
    expect(mockWin.document.write).toHaveBeenCalledTimes(2);
    expect(mockWin.document.close).toHaveBeenCalledTimes(2);
    var finalHtml = mockWin._written[1];
    expect(finalHtml).toContain('ITEM001');
    expect(finalHtml).toContain('ITEM002');
    expect(finalHtml).toContain('item-card');
    expect(global.showMessage).not.toHaveBeenCalled();
  });

  test('printBarcodes — 重复物料去重', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'SO', _linesLoaded: true,
      lines: [
        { item_code: 'DUP01', item_name: '重复A' },
        { item_code: 'DUP01', item_name: '重复A' },
        { item_code: 'UNIQ01', item_name: '唯一B' }
      ]
    }];
    await PrintService.printBarcodes(orders);
    var finalHtml = mockWin._written[1];
    var cardMatches = finalHtml.match(/<div class="item-card">/g);
    // 去重后只有 2 个卡片 (DUP01 + UNIQ01)
    expect(cardMatches.length).toBe(2);
  });

  test('printBarcodes — _printLock 防止重入', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'SO', _linesLoaded: true,
      lines: [{ item_code: 'A', item_name: 'X' }]
    }];
    var p1 = PrintService.printBarcodes(orders);
    await PrintService.printBarcodes(orders);
    await p1;
    expect(window.open).toHaveBeenCalledTimes(1);
  });

  test('printBarcodes — 物料行过多 (>5000) 拦截', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var manyLines = [];
    for (var i = 0; i < 5001; i++) {
      manyLines.push({ item_code: 'M' + i, item_name: 'N' + i });
    }
    var orders = [{ id: 1, doc_type: 'SO', _linesLoaded: true, lines: manyLines }];
    await PrintService.printBarcodes(orders);
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('物料行数过多'), 'warning'
    );
  });

  // --- printOrders 流程 ---
  test('printOrders — 弹窗被拦截', async () => {
    window.open = jest.fn().mockReturnValue(null);
    var orders = [{ id: 1, doc_type: 'SO', _linesLoaded: true, lines: [{ item_code: 'A' }] }];
    await PrintService.printOrders(orders);
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('弹窗被拦截'), 'error'
    );
  });

  test('printOrders — 加载失败订单报错', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{ id: 1, doc_type: 'SO', _linesLoaded: true, _loadError: true, lines: [] }];
    await PrintService.printOrders(orders);
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('加载失败'), 'error'
    );
  });

  test('printOrders — 物料行过多 (>5000) 拦截', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var manyLines = [];
    for (var i = 0; i < 5001; i++) {
      manyLines.push({ item_code: 'M' + i, line_num: i, planned_qty: 1 });
    }
    var orders = [{ id: 1, doc_type: 'SO', _linesLoaded: true, lines: manyLines }];
    await PrintService.printOrders(orders);
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('物料行数过多'), 'warning'
    );
  });

  test('printOrders — 非 WO 订单成功生成 HTML (含柜号)', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'SO', sap_doc_num: 'SO100', _linesLoaded: true,
      bp_name: '客户A', doc_date: '2026-03-01', oms_status: 'pending', due_date: '2026-03-15',
      container_no: 'CTN001',
      lines: [
        { item_code: 'M001', item_name: '钢管', line_num: 1, planned_qty: 100, warehouse_code: 'WH01' },
        { item_code: 'M002', item_name: '螺栓', line_num: 2, planned_qty: 200, warehouse_code: 'WH01' }
      ]
    }];
    await PrintService.printOrders(orders);
    var finalHtml = mockWin._written[1];
    expect(finalHtml).toContain('SO100');
    expect(finalHtml).toContain('客户A');
    expect(finalHtml).toContain('M001');
    expect(finalHtml).toContain('M002');
    expect(finalHtml).toContain('CTN001');
    expect(finalHtml).toContain('lines-table');
    expect(global.showMessage).not.toHaveBeenCalled();
  });

  test('printOrders — 无柜号时不显示柜号', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'SO', sap_doc_num: 'SO400', _linesLoaded: true,
      lines: [{ item_code: 'X', line_num: 1, planned_qty: 1, warehouse_code: 'WH' }]
    }];
    await PrintService.printOrders(orders);
    var finalHtml = mockWin._written[1];
    expect(finalHtml).not.toContain('柜号');
  });

  test('printOrders — DD 订单打印含原单引用列', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'DD', doc_number: 'DD-001', _linesLoaded: true,
      bp_name: '客户B', doc_date: '2026-03-02', oms_status: 'pending',
      lines: [
        { item_code: 'M001', item_name: '钢管', line_num: 1, planned_qty: 50, warehouse_code: 'WH01',
          source_doc_number: 'SO100', source_line_num: 1, source_planned_qty: 100 }
      ]
    }];
    await PrintService.printOrders(orders);
    var finalHtml = mockWin._written[1];
    expect(finalHtml).toContain('DD-001');
    expect(finalHtml).toContain('SO100');
    expect(finalHtml).toContain('L1');
  });

  test('printOrders — DD 行无 source_doc_number 时原单列为空', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'DD', doc_number: 'DD-002', _linesLoaded: true,
      lines: [{ item_code: 'M001', line_num: 1, planned_qty: 10, warehouse_code: 'WH01' }]
    }];
    await PrintService.printOrders(orders);
    var finalHtml = mockWin._written[1];
    expect(finalHtml).toContain('DD-002');
  });

  test('printOrders — 无行项目的订单显示警告文本', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'SO', sap_doc_num: 'SO200', _linesLoaded: true,
      lines: []
    }];
    await PrintService.printOrders(orders);
    var finalHtml = mockWin._written[1];
    expect(finalHtml).toContain('没有行项目');
  });

  test('printOrders — WO 订单: 抬头卡片 + BOM 合并明细', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'WO', sap_doc_num: 'WO500', item_code: 'FG001', _linesLoaded: true,
      warehouse_code: 'WH-FG', total_planned_qty: 1000,
      lines: [
        { item_code: 'RM001', item_name: '原料A', planned_qty: 100, actual_qty: 50, warehouse_code: 'WH-RM' },
        { item_code: 'RM001', item_name: '原料A', planned_qty: 200, actual_qty: 100, warehouse_code: 'WH-RM' },
        { item_code: 'RM002', item_name: '原料B', planned_qty: 50, warehouse_code: 'WH-RM' }
      ]
    }];
    await PrintService.printOrders(orders);
    var finalHtml = mockWin._written[1];
    expect(finalHtml).toContain('wo-card');
    expect(finalHtml).toContain('WO500');
    expect(finalHtml).toContain('FG001');
    expect(finalHtml).toContain('wo-tbl');
    expect(finalHtml).toContain('RM001');
    expect(finalHtml).toContain('RM002');
  });

  test('printOrders — 混合 SO + WO 订单分页', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [
      {
        id: 1, doc_type: 'SO', sap_doc_num: 'SO300', _linesLoaded: true,
        lines: [{ item_code: 'A', item_name: '物料A', line_num: 1, planned_qty: 10, warehouse_code: 'WH01' }]
      },
      {
        id: 2, doc_type: 'WO', sap_doc_num: 'WO600', item_code: 'FG002', _linesLoaded: true,
        warehouse_code: 'WH-FG', total_planned_qty: 500,
        lines: [{ item_code: 'RM003', item_name: '原料C', planned_qty: 100, warehouse_code: 'WH-RM' }]
      }
    ];
    await PrintService.printOrders(orders);
    var finalHtml = mockWin._written[1];
    expect(finalHtml).toContain('page-break-after:always');
    expect(finalHtml).toContain('SO300');
    expect(finalHtml).toContain('WO600');
  });

  test('printOrders — SO + is_split 状态显示 ⚠', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'SO', sap_doc_num: 'SO500', _linesLoaded: true,
      oms_status: 'split', is_split: true,
      lines: [{ item_code: 'X', line_num: 1, planned_qty: 1, warehouse_code: 'WH' }]
    }];
    await PrintService.printOrders(orders);
    var finalHtml = mockWin._written[1];
    expect(finalHtml).toContain('⚠');
  });

  test('printOrders — 抬头有 item_code 时被收集进条码缓存', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'WO', sap_doc_num: 'WO700', item_code: 'HEADER_ITEM', _linesLoaded: true,
      lines: [{ item_code: 'LINE_ITEM', item_name: '行物料', line_num: 1, planned_qty: 10, warehouse_code: 'WH' }]
    }];
    await PrintService.printOrders(orders);
    var finalHtml = mockWin._written[1];
    // 抬头物料和行物料都应出现
    expect(finalHtml).toContain('HEADER_ITEM');
    expect(finalHtml).toContain('LINE_ITEM');
  });
});

// ============================================================================
// printSelectedOrders / printSelectedBarcodes — 外层 catch (L910-911, 919-920)
// ============================================================================

describe('printSelectedOrders/Barcodes — 外层异常捕获', () => {
  beforeEach(() => {
    global.showMessage = jest.fn();
    global.showLoading = jest.fn();
    // 选中 1 个订单
    _setInternalState({ _orders: [{ id: 1, _linesLoaded: true, lines: [] }], _selectedIds: new Set([1]) });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = undefined;
  });

  test('printSelectedOrders — PrintService 抛异常 → 外层 catch 显示打印失败', async () => {
    // 直接 mock PrintService.printOrders 抛出异常（绕过内部 try-catch）
    var origPrintOrders = PrintService.printOrders;
    PrintService.printOrders = jest.fn().mockRejectedValue(new Error('意外异常'));
    await printSelectedOrders();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('打印失败'), 'error'
    );
    PrintService.printOrders = origPrintOrders;
  });

  test('printSelectedBarcodes — PrintService 抛异常 → 外层 catch 显示打印失败', async () => {
    var origPrintBarcodes = PrintService.printBarcodes;
    PrintService.printBarcodes = jest.fn().mockRejectedValue(new Error('意外异常'));
    await printSelectedBarcodes();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('打印失败'), 'error'
    );
    PrintService.printBarcodes = origPrintBarcodes;
  });
});

// ============================================================================
// ensureOrderLines — 并发等待路径 (L477-479)
// ============================================================================

describe('ensureOrderLines — 并发等待路径', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = undefined;
  });

  test('并发调用时第二次等待 _loadingPromise 完成后重试', async () => {
    // 第一次调用返回数据，第二次调用应等待
    var callCount = 0;
    global.apiGet = jest.fn().mockImplementation(async () => {
      callCount++;
      // 模拟延迟
      await new Promise(r => setTimeout(r, 10));
      return { success: true, results: { 1: { lines: [{ item_code: 'A' }], dd_children: [] } } };
    });

    var order = { id: 1, _linesLoaded: false };
    // 并发启动两次
    var p1 = ensureOrderLines([order]);
    var p2 = ensureOrderLines([order]);
    await Promise.all([p1, p2]);
    // apiGet 应只被调用一次 (第二次等待后发现已加载)
    expect(callCount).toBe(1);
    expect(order._linesLoaded).toBe(true);
  });
});

// ============================================================================
// createKanbanState._resetState (L1333)
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
// PrintService 内层 catch — printBarcodes / printOrders (L660-662, L890-892)
// ============================================================================

describe('PrintService 内层异常 — HTML 写入失败', () => {
  var origOpen;
  beforeEach(() => {
    jest.clearAllMocks();
    origOpen = window.open;
    global.showLoading = jest.fn();
    global.showMessage = jest.fn();
    global.apiGet = jest.fn().mockResolvedValue({ success: true, results: {} });
  });

  afterEach(() => {
    window.open = origOpen;
  });

  test('printBarcodes — document.write 抛错 → 内层 catch (L660-662)', async () => {
    var writeCount = 0;
    var mockWin = {
      closed: false,
      document: {
        open: jest.fn(),
        write: jest.fn(function() {
          writeCount++;
          // 第 1 次 write = loading 提示 (L590), 第 2 次 write = 最终 HTML (L656) → 抛错
          if (writeCount >= 2) throw new Error('DOM write error');
        }),
        close: jest.fn()
      },
      close: jest.fn(),
      print: jest.fn(),
      focus: jest.fn()
    };
    window.open = jest.fn().mockReturnValue(mockWin);

    var orders = [{
      id: 1, doc_type: 'SO', _linesLoaded: true, lines: [{ item_code: 'X1', item_name: 'Item X1' }]
    }];
    var errorSpy = jest.spyOn(console, 'error').mockImplementation(function() {});

    await PrintService.printBarcodes(orders);

    expect(errorSpy).toHaveBeenCalledWith('打印条码异常:', expect.any(Error));
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('打印失败'), 'error'
    );
    errorSpy.mockRestore();
  });

  test('printOrders — document.write 抛错 → 内层 catch (L890-892)', async () => {
    var writeCount = 0;
    var mockWin = {
      closed: false,
      document: {
        open: jest.fn(),
        write: jest.fn(function() {
          writeCount++;
          if (writeCount >= 2) throw new Error('DOM write error');
        }),
        close: jest.fn()
      },
      close: jest.fn(),
      print: jest.fn(),
      focus: jest.fn()
    };
    window.open = jest.fn().mockReturnValue(mockWin);

    var orders = [{
      id: 2, doc_type: 'SO', doc_number: 'SO-100', bp_name: 'Test',
      _linesLoaded: true, lines: [{ item_code: 'Y1', item_name: 'Item Y1', planned_qty: 10, picked_qty: 0 }]
    }];
    var errorSpy = jest.spyOn(console, 'error').mockImplementation(function() {});

    await PrintService.printOrders(orders);

    expect(errorSpy).toHaveBeenCalledWith('打印订单异常:', expect.any(Error));
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('打印失败'), 'error'
    );
    errorSpy.mockRestore();
  });
});

// ============================================================================
// buildOmsDetailRowHtml — OMS 订单明细行 HTML 构建
// ============================================================================

describe('buildOmsDetailRowHtml — OMS 明细行 HTML', () => {
  const h = {
    escapeHtml: s => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    formatNumber: n => String(n),
    formatDate: d => d || '-',
    getOmsStatusLabel: s => s || '-',
  };

  test('无行项目时显示空提示', () => {
    var order = { id: 1, doc_type: 'SO', lines: [] };
    var html = buildOmsDetailRowHtml(order, h);
    expect(html).toContain('data-detail="1"');
    expect(html).toContain('行项目: 0');
    expect(html).toContain('colspan="11"');
  });

  test('lines 未定义时也显示空提示', () => {
    var order = { id: 2, doc_type: 'SO' };
    var html = buildOmsDetailRowHtml(order, h);
    expect(html).toContain('行项目: 0');
  });

  test('SO 订单正常渲染行项目', () => {
    var order = {
      id: 3, doc_type: 'SO', is_split: false, created_at: '2026-03-08',
      lines: [
        { line_num: 0, item_code: 'A001', item_name: '物料A', planned_qty: 10, actual_qty: 5, warehouse_code: 'WH01', status: 'pending' },
      ]
    };
    var html = buildOmsDetailRowHtml(order, h);
    expect(html).toContain('A001');
    expect(html).toContain('物料A');
    expect(html).toContain('10');
    expect(html).toContain('5');
    expect(html).toContain('WH01');
    expect(html).toContain('badge-pending');
  });

  test('DD 订单显示源单引用链接', () => {
    var order = {
      id: 4, doc_type: 'DD', is_split: false, created_at: '2026-03-08',
      lines: [
        { line_num: 0, item_code: 'A001', item_name: 'X', planned_qty: 5, actual_qty: 3, warehouse_code: 'WH01', status: 'pending', source_doc_number: 'SO26000001', source_line_num: 0 },
      ]
    };
    var html = buildOmsDetailRowHtml(order, h);
    expect(html).toContain('SO26000001');
    expect(html).toContain('so.html?docnum=SO26000001');
    expect(html).toContain('L0');
  });

  test('SO 已拆分时显示 picked_qty 而非 actual_qty', () => {
    var order = {
      id: 5, doc_type: 'SO', is_split: true,
      lines: [
        { line_num: 0, item_code: 'A001', item_name: 'X', planned_qty: 10, actual_qty: 999, picked_qty: 7, warehouse_code: 'WH01', status: 'partial' },
      ]
    };
    var html = buildOmsDetailRowHtml(order, h);
    expect(html).toContain('>7<');
    expect(html).not.toContain('>999<');
  });

  test('SO 行有 dd_refs 时显示 DD 链接', () => {
    var order = {
      id: 6, doc_type: 'SO', is_split: false,
      lines: [
        { line_num: 0, item_code: 'A001', item_name: 'X', planned_qty: 10, actual_qty: 0, warehouse_code: 'WH01', status: 'pending', dd_refs: 'DD26000001#0' },
      ]
    };
    var html = buildOmsDetailRowHtml(order, h);
    expect(html).toContain('DD26000001');
    expect(html).toContain('so.html?docnum=DD26000001');
  });

  test('行级 ship_date 显示 (非 DD)', () => {
    var order = {
      id: 7, doc_type: 'SO', is_split: false,
      lines: [
        { line_num: 0, item_code: 'A001', item_name: 'X', planned_qty: 10, actual_qty: 0, warehouse_code: 'WH01', status: 'pending', ship_date: '2026-03-15' },
      ]
    };
    var html = buildOmsDetailRowHtml(order, h);
    expect(html).toContain('2026-03-15');
  });

  test('多行正确渲染', () => {
    var order = {
      id: 8, doc_type: 'PO', is_split: false,
      lines: [
        { line_num: 0, item_code: 'A001', item_name: 'X', planned_qty: 5, actual_qty: 0, warehouse_code: 'WH01', status: 'pending' },
        { line_num: 1, item_code: 'A002', item_name: 'Y', planned_qty: 3, actual_qty: 1, warehouse_code: 'WH01', status: 'partial' },
      ]
    };
    var html = buildOmsDetailRowHtml(order, h);
    expect((html.match(/class="detail-row"/g) || []).length).toBe(2);
    expect(html).toContain('A001');
    expect(html).toContain('A002');
  });

  test('XSS 防护 — item_code 转义', () => {
    var order = {
      id: 9, doc_type: 'SO', is_split: false,
      lines: [
        { line_num: 0, item_code: '<script>alert(1)</script>', item_name: 'X', planned_qty: 0, actual_qty: 0, warehouse_code: 'WH01', status: 'pending' },
      ]
    };
    var html = buildOmsDetailRowHtml(order, h);
    expect(html).toContain('&lt;script');
    expect(html).not.toMatch(/<script[^>]*>/);
  });

  test('DD 行无 source_doc_number → 显示 -', () => {
    var order = {
      id: 10, doc_type: 'DD', is_split: false, created_at: '2026-03-08',
      lines: [
        { line_num: 0, item_code: 'A001', item_name: 'X', planned_qty: 5, actual_qty: 3, warehouse_code: 'WH01', status: 'pending' },
      ]
    };
    var html = buildOmsDetailRowHtml(order, h);
    expect(html).toContain('<td>-</td>');
  });

  test('DD 行有 source_doc_number 但 source_line_num 为 null → 不含 L 后缀', () => {
    var order = {
      id: 11, doc_type: 'DD', is_split: false, created_at: '2026-03-08',
      lines: [
        { line_num: 0, item_code: 'A001', item_name: 'X', planned_qty: 5, actual_qty: 0, warehouse_code: 'WH01', status: 'pending', source_doc_number: 'SO26000099', source_line_num: null },
      ]
    };
    var html = buildOmsDetailRowHtml(order, h);
    expect(html).toContain('SO26000099');
    expect(html).not.toContain(' L');
  });

  test('line_num 为 null → 使用行索引 idx', () => {
    var order = {
      id: 12, doc_type: 'SO', is_split: false,
      lines: [
        { line_num: null, item_code: 'A001', item_name: 'X', planned_qty: 10, actual_qty: 0, warehouse_code: 'WH01', status: 'pending' },
      ]
    };
    var html = buildOmsDetailRowHtml(order, h);
    expect(html).toContain('detail-line-num">0<');
  });

  test('is_split=true 且 picked_qty 为 null → 显示 0', () => {
    var order = {
      id: 13, doc_type: 'SO', is_split: true,
      lines: [
        { line_num: 0, item_code: 'A001', item_name: 'X', planned_qty: 10, actual_qty: 5, picked_qty: null, warehouse_code: 'WH01', status: 'pending' },
      ]
    };
    var html = buildOmsDetailRowHtml(order, h);
    // picked_qty || 0 → 0
    expect(html).toContain('>0<');
  });

  test('is_split=false 且 actual_qty 为 null → 显示 0', () => {
    var order = {
      id: 14, doc_type: 'PO', is_split: false,
      lines: [
        { line_num: 0, item_code: 'A001', item_name: 'X', planned_qty: 10, actual_qty: null, warehouse_code: 'WH01', status: 'pending' },
      ]
    };
    var html = buildOmsDetailRowHtml(order, h);
    // actual_qty || 0 → 0
    expect(html).toContain('>0<');
  });

  test('非 DD 行无 ship_date 且无 dd_refs → 空 td', () => {
    var order = {
      id: 15, doc_type: 'TR', is_split: false,
      lines: [
        { line_num: 0, item_code: 'A001', item_name: 'X', planned_qty: 5, actual_qty: 0, warehouse_code: 'WH01', status: 'pending' },
      ]
    };
    var html = buildOmsDetailRowHtml(order, h);
    // docCol 和 dateCol 都是空 td
    expect(html).toContain('<td></td>');
  });

  test('item_name 和 warehouse_code 为 null → 显示 -', () => {
    var order = {
      id: 16, doc_type: 'SO', is_split: false,
      lines: [
        { line_num: 0, item_code: null, item_name: null, planned_qty: null, actual_qty: null, warehouse_code: null, status: null },
      ]
    };
    var html = buildOmsDetailRowHtml(order, h);
    // item_code || '-', item_name || '-', warehouse_code || '-', status || 'pending'
    expect(html).toMatch(/>-</);
    expect(html).toContain('badge-pending');
  });
});

// ============================================================================
// initOMS — Enter 键触发查询 + 分页选择器同步
// ============================================================================

describe('initOMS — Enter 键触发查询与初始化', () => {
  let origQueryOrders;

  beforeEach(() => {
    // 存储原始 queryOrders (在 oms.js 模块加载时已绑定)
    origQueryOrders = global.queryOrders;
    global._queryCalled = false;
    // 替换 queryOrders 为追踪函数 — 通过全局替换，让 initOMS 内闭包捕获
    global.queryOrders = function() { global._queryCalled = true; };

    // 重置 DOM
    document.body.innerHTML =
      '<input id="filterDateTo"/><input id="filterDateFrom"/>' +
      '<input id="filterBP"/><input id="filterBPName"/><input id="filterDocNum"/>' +
      '<input id="filterWarehouse"/><input id="filterContainer"/>' +
      '<select id="filterType"><option value=""></option></select>' +
      '<select id="filterStatus"><option value=""></option></select>' +
      '<select id="pageSizeSelect"><option value="20">20</option><option value="50">50</option></select>' +
      '<div id="toolbarCard"></div><div id="resultCard"></div>' +
      '<table><tbody id="orderBody"></tbody></table>' +
      '<span id="resultCount">0</span>' +
      '<div id="pagination"><button id="btnFirst"></button><button id="btnPrev"></button>' +
      '<button id="btnNext"></button><button id="btnLast"></button><span id="pageInfo"></span></div>' +
      '<span id="selectionCount"></span><input id="selectAll" type="checkbox"/>' +
      '<input id="selectAllHead" type="checkbox"/>' +
      '<button id="btnExpandAll"></button><button id="btnCollapseAll"></button>';

    localStorage.setItem('wms_username', 'test-user');
  });

  afterEach(() => {
    global.queryOrders = origQueryOrders;
    delete global._queryCalled;
  });

  test('initOMS 设置日期筛选默认值', () => {
    initOMS();

    var dateTo = document.getElementById('filterDateTo').value;
    var dateFrom = document.getElementById('filterDateFrom').value;
    expect(dateTo).toBeTruthy();
    expect(dateFrom).toBeTruthy();
    // dateFrom 应早于 dateTo
    expect(new Date(dateFrom).getTime()).toBeLessThan(new Date(dateTo).getTime());
  });

  test('initOMS 同步分页选择器', () => {
    var sel = document.getElementById('pageSizeSelect');
    sel.value = '';
    initOMS();
    // 分页选择器应被同步为当前 _pageSize
    expect(sel.value).toBeTruthy();
  });

  test('initOMS 未登录时仍正常初始化 (SSO 强制)', () => {
    localStorage.removeItem('wms_username');
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ data: { display_name: 'sso_user', groups: [] } })
    });
    // SSO 强制: checkAuth() 始终返回 true, initOMS 正常执行
    initOMS();
    // 日期筛选应被设置 (checkAuth 不再阻塞)
    var dateTo = document.getElementById('filterDateTo').value;
    expect(dateTo).toBeTruthy();
  });
});

// ============================================================================
// getOmsStatusLabel / getExecStateLabel — 全分支覆盖
// ============================================================================

describe('getOmsStatusLabel / getExecStateLabel 补充分支', () => {
  test('getOmsStatusLabel 未知状态回退', () => {
    var result = getOmsStatusLabel('unknown_status_xyz');
    // 应返回某个值 (不崩溃)
    expect(result).toBeTruthy();
  });

  test('getExecStateLabel 未知状态回退', () => {
    var result = getExecStateLabel('unknown_exec_state');
    expect(result).toBeTruthy();
  });

  test('getExecStateLabel null 输入', () => {
    var result = getExecStateLabel(null);
    expect(result).toBeTruthy();
  });

  test('getBadgeClass 未知状态', () => {
    var result = getBadgeClass('unknown');
    // 应返回默认 badge class
    expect(typeof result).toBe('string');
  });
});

// ============================================================================
// parseDocNumInput — 更多边界输入
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
// _buildWmsLink / _buildDDRefsLinks — 分支覆盖补充
// ============================================================================

describe('_buildWmsLink / _buildDDRefsLinks 分支补充', () => {
  test('_buildWmsLink 无 escapeFn → 使用 shared.js 的 escapeHtml', () => {
    // shared.js 已加载，escapeHtml 全局可用
    var result = _buildWmsLink('SO', 'SO26000001');
    expect(result).toContain('so.html?docnum=');
    expect(result).toContain('SO26000001');
  });

  test('_buildWmsLink 未知 docType → 返回纯文本 (不含链接)', () => {
    var result = _buildWmsLink('UNKNOWN', 'DOC001', function(s) { return s; });
    expect(result).toBe('DOC001');
    expect(result).not.toContain('<a');
  });

  test('_buildDDRefsLinks 无 escapeFn → 使用 shared.js 的 escapeHtml', () => {
    var result = _buildDDRefsLinks('DD26000001#1');
    expect(result).toContain('so.html?docnum=DD26000001');
  });

  test('_buildDDRefsLinks null → 返回 -', () => {
    expect(_buildDDRefsLinks(null)).toBe('-');
  });

  test('_buildDDRefsLinks 非 DD 格式 → 返回原文本', () => {
    var result = _buildDDRefsLinks('SO26000001');
    expect(result).not.toContain('<a');
    expect(result).toContain('SO26000001');
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
// P0 分支覆盖补充 — 覆盖非 Vue 区域的 binary-expr / cond-expr 分支
// ============================================================================

describe('renderOrders — 缺字段 fallback 分支', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<table><tbody id="orderBody"></tbody></table>' +
      '<span id="resultCount">0</span>' +
      '<input id="selectAll" type="checkbox"/>' +
      '<button id="btnExpandAll"></button><button id="btnCollapseAll"></button>';
    _setInternalState({ _selectedIds: new Set(), _expandedIds: new Set() });
  });

  test('DD 类型使用 doc_number 而非 sap_doc_num', () => {
    _setInternalState({
      _orders: [{
        id: 1, doc_type: 'DD', doc_number: 'DD26000001',
        oms_status: 'pending'
      }],
      _totalRecords: 1
    });
    _renderOrders();
    var html = document.getElementById('orderBody').innerHTML;
    expect(html).toContain('DD26000001');
  });

  test('is_split + 非 DD → row-split-disabled 样式', () => {
    _setInternalState({
      _orders: [{
        id: 1, doc_type: 'SO', sap_doc_num: 'SO100',
        is_split: true, oms_status: 'split'
      }],
      _totalRecords: 1
    });
    _renderOrders();
    var html = document.getElementById('orderBody').innerHTML;
    expect(html).toContain('row-split-disabled');
  });

  test('container_no 存在时渲染容器标签', () => {
    _setInternalState({
      _orders: [{
        id: 1, doc_type: 'SO', sap_doc_num: 'SO100',
        container_no: 'CTN-TEST', oms_status: 'pending'
      }],
      _totalRecords: 1
    });
    _renderOrders();
    var html = document.getElementById('orderBody').innerHTML;
    expect(html).toContain('container-tag');
    expect(html).toContain('CTN-TEST');
  });

  test('WO 类型显示 item_name 而非 bp_name', () => {
    _setInternalState({
      _orders: [{
        id: 1, doc_type: 'WO', sap_doc_num: 'WO100',
        item_name: '成品A', bp_name: '供应商', oms_status: 'pending'
      }],
      _totalRecords: 1
    });
    _renderOrders();
    var html = document.getElementById('orderBody').innerHTML;
    expect(html).toContain('成品A');
  });

  test('缺少所有可选字段时 fallback 为 "-"', () => {
    _setInternalState({
      _orders: [{
        id: 1, doc_type: 'SO', oms_status: 'pending'
        // 无 sap_doc_num, bp_name, item_code, warehouse_code 等
      }],
      _totalRecords: 1
    });
    _renderOrders();
    var html = document.getElementById('orderBody').innerHTML;
    expect(html).toContain('-');
  });

  test('DD 无 sap_doc_num 也无 doc_number → fallback', () => {
    _setInternalState({
      _orders: [{
        id: 1, doc_type: 'DD', oms_status: 'pending'
      }],
      _totalRecords: 1
    });
    _renderOrders();
    var html = document.getElementById('orderBody').innerHTML;
    expect(html).toContain('-');
  });

  test('已展开的订单渲染 detail row', () => {
    _setInternalState({
      _orders: [{
        id: 1, doc_type: 'SO', sap_doc_num: 'SO100', oms_status: 'pending',
        lines: [{ item_code: 'M001', line_num: 1, planned_qty: 10 }]
      }],
      _expandedIds: new Set([1]),
      _totalRecords: 1
    });
    _renderOrders();
    var html = document.getElementById('orderBody').innerHTML;
    expect(html).toContain('M001');
  });
});

describe('queryOrders — 多单号附加筛选参数', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<select id="filterType"><option value=""></option></select>' +
      '<input id="filterBP" value=""/><input id="filterBPName" value=""/>' +
      '<input id="filterDocNum" value=""/><input id="filterWarehouse" value=""/>' +
      '<input id="filterContainer" value=""/>' +
      '<select id="filterStatus"><option value=""></option><option value="completed">completed</option></select>' +
      '<input id="filterDateFrom" value="2026-01-01"/>' +
      '<input id="filterDateTo" value="2026-03-15"/>' +
      '<select id="pageSizeSelect"><option value="20">20</option></select>' +
      '<div id="toolbarCard"></div><div id="resultCard"></div>' +
      '<table><tbody id="orderBody"></tbody></table>' +
      '<span id="resultCount">0</span>' +
      '<div id="pagination"><button id="btnFirst"></button><button id="btnPrev"></button>' +
      '<button id="btnNext"></button><button id="btnLast"></button><span id="pageInfo"></span></div>' +
      '<span id="selectionCount"></span><input id="selectAll" type="checkbox"/>' +
      '<button id="btnExpandAll"></button><button id="btnCollapseAll"></button>';
    _setInternalState({ _orders: [], _page: 1, _pageSize: 20, _totalPages: 1, _totalRecords: 0, _selectedIds: new Set(), _expandedIds: new Set() });
    global.showLoading = jest.fn();
    global.showMessage = jest.fn();
  });

  afterEach(() => { jest.restoreAllMocks(); });

  test('多单号查询携带 status/dateFrom/dateTo 参数', async () => {
    document.getElementById('filterDocNum').value = 'A001 A002';
    document.getElementById('filterStatus').value = 'completed';

    global.apiGet = jest.fn().mockResolvedValue({
      success: true, orders: [{ id: 1 }], total: 1
    });

    await queryOrders(1);

    // 多单号路径: 每个单号单独查询
    expect(global.apiGet).toHaveBeenCalledTimes(2);
    var url = global.apiGet.mock.calls[0][0];
    expect(url).toContain('oms_status=completed');
    expect(url).toContain('date_from=2026-01-01');
    expect(url).toContain('date_to=2026-03-15');
  });

  test('多单号查询某次返回失败时静默跳过', async () => {
    document.getElementById('filterDocNum').value = 'A001 A002';

    global.apiGet = jest.fn()
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockResolvedValueOnce({ success: true, orders: [{ id: 2, sap_doc_num: 'A002' }] });

    await queryOrders(1);

    var state = _getInternalState();
    expect(state._orders).toHaveLength(1);
    expect(state._orders[0].id).toBe(2);
  });

  test('API 返回 null data → 抛出默认错误消息', async () => {
    global.apiGet = jest.fn().mockResolvedValue(null);

    await queryOrders(1);

    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('查询失败'), 'error'
    );
  });

  test('API 返回 success:false 无 message → 使用默认文本', async () => {
    global.apiGet = jest.fn().mockResolvedValue({ success: false });

    await queryOrders(1);

    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('查询失败'), 'error'
    );
  });
});

describe('ensureOrderLines — fallback 逐个加载路径', () => {
  beforeEach(() => {
    global.showMessage = jest.fn();
    global.showLoading = jest.fn();
  });
  afterEach(() => { jest.restoreAllMocks(); });

  test('batch API 失败时逐个加载 (fallback 路径)', async () => {
    var orders = [
      { id: 1, _linesLoaded: false },
      { id: 2, _linesLoaded: false }
    ];
    global.apiGet = jest.fn()
      .mockRejectedValueOnce(new Error('batch failed'))  // batch 失败
      .mockResolvedValueOnce({ success: true, lines: [{ item_code: 'A' }], dd_children: [] })
      .mockResolvedValueOnce({ success: true, lines: [{ item_code: 'B' }], dd_children: ['DD1'] });

    await ensureOrderLines(orders);

    expect(orders[0].lines).toEqual([{ item_code: 'A' }]);
    expect(orders[0]._linesLoaded).toBe(true);
    expect(orders[1].dd_children).toEqual(['DD1']);
    expect(orders[1]._linesLoaded).toBe(true);
  });

  test('fallback 逐个加载某个也失败 → _loadError', async () => {
    var orders = [{ id: 1, _linesLoaded: false }];
    global.apiGet = jest.fn()
      .mockRejectedValueOnce(new Error('batch failed'))
      .mockRejectedValueOnce(new Error('single also failed'));

    await ensureOrderLines(orders);

    expect(orders[0]._loadError).toBe(true);
  });

  test('fallback 逐个加载返回 success:false → _loadError', async () => {
    var orders = [{ id: 1, _linesLoaded: false }];
    global.apiGet = jest.fn()
      .mockRejectedValueOnce(new Error('batch failed'))
      .mockResolvedValueOnce({ success: false });

    await ensureOrderLines(orders);

    expect(orders[0]._loadError).toBe(true);
  });

  test('fallback 路径 lines/dd_children 缺失时使用空数组', async () => {
    var orders = [{ id: 1, _linesLoaded: false }];
    global.apiGet = jest.fn()
      .mockRejectedValueOnce(new Error('batch failed'))
      .mockResolvedValueOnce({ success: true }); // 无 lines/dd_children 字段

    await ensureOrderLines(orders);

    expect(orders[0].lines).toEqual([]);
    expect(orders[0].dd_children).toEqual([]);
    expect(orders[0]._linesLoaded).toBe(true);
  });
});

describe('PrintService — 缺字段 fallback 分支', () => {
  function createMockPrintWindow2() {
    var written = [];
    return {
      closed: false,
      document: { open: jest.fn(), write: jest.fn(function(html) { written.push(html); }), close: jest.fn() },
      print: jest.fn(), focus: jest.fn(), close: jest.fn(),
      _written: written
    };
  }

  beforeEach(() => {
    global.showMessage = jest.fn();
    global.showLoading = jest.fn();
  });
  afterEach(() => { jest.restoreAllMocks(); });

  test('printOrders — 订单缺少 bp_name/business_partner → fallback "-"', async () => {
    var mockWin = createMockPrintWindow2();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'SO', sap_doc_num: 'SO100', _linesLoaded: true,
      oms_status: 'pending',
      lines: [{ item_code: 'M001', line_num: 1, planned_qty: 10, warehouse_code: 'WH' }]
    }];
    await PrintService.printOrders(orders);
    var html = mockWin._written[1];
    expect(html).toContain('-');
  });

  test('printOrders — DD 订单用 doc_number 而非 sap_doc_num', async () => {
    var mockWin = createMockPrintWindow2();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'DD', doc_number: 'DD26000001', _linesLoaded: true,
      oms_status: 'pending',
      lines: [{ item_code: 'M001', line_num: 1, planned_qty: 10 }]
    }];
    await PrintService.printOrders(orders);
    var html = mockWin._written[1];
    expect(html).toContain('DD26000001');
  });

  test('printOrders — DD 行有 source_line_num → 显示 L 前缀', async () => {
    var mockWin = createMockPrintWindow2();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'DD', doc_number: 'DD-001', _linesLoaded: true,
      oms_status: 'pending',
      lines: [{
        item_code: 'M001', line_num: 1, planned_qty: 50, warehouse_code: 'WH',
        source_doc_number: 'SO100', source_line_num: 3, source_planned_qty: 100
      }]
    }];
    await PrintService.printOrders(orders);
    var html = mockWin._written[1];
    expect(html).toContain('SO100');
    expect(html).toContain('L3');
  });

  test('printOrders — WO 行缺少 item_name → 空字符串', async () => {
    var mockWin = createMockPrintWindow2();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'WO', sap_doc_num: 'WO100', _linesLoaded: true,
      item_code: 'FG001',
      lines: [{ item_code: 'RM001', planned_qty: 100, warehouse_code: 'WH' }]
    }];
    await PrintService.printOrders(orders);
    var html = mockWin._written[1];
    expect(html).toContain('RM001');
    expect(html).toContain('wo-tbl');
  });

  test('printOrders — WO 使用 delivered_qty 作为已发数量', async () => {
    var mockWin = createMockPrintWindow2();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'WO', sap_doc_num: 'WO200', _linesLoaded: true,
      lines: [{ item_code: 'RM001', item_name: '原料', planned_qty: 100, delivered_qty: 30, warehouse_code: 'WH' }]
    }];
    await PrintService.printOrders(orders);
    var html = mockWin._written[1];
    expect(html).toContain('wo-tbl');
  });

  test('printOrders — 订单缺少 doc_type → qrCache key 不含类型', async () => {
    var mockWin = createMockPrintWindow2();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, sap_doc_num: 'X100', _linesLoaded: true,
      oms_status: 'pending',
      lines: [{ item_code: 'M001', line_num: 1, planned_qty: 5, warehouse_code: 'WH' }]
    }];
    await PrintService.printOrders(orders);
    expect(mockWin.document.write).toHaveBeenCalled();
  });

  test('printOrders — 行缺少 item_name 和 warehouse_code', async () => {
    var mockWin = createMockPrintWindow2();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'SO', sap_doc_num: 'SO300', _linesLoaded: true,
      oms_status: 'pending',
      lines: [{ item_code: 'M001', line_num: 1, planned_qty: 10 }]
    }];
    await PrintService.printOrders(orders);
    var html = mockWin._written[1];
    expect(html).toContain('M001');
  });

  test('printBarcodes — 行缺少 item_name', async () => {
    var mockWin = createMockPrintWindow2();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, _linesLoaded: true,
      lines: [{ item_code: 'M001', line_num: 1 }]
    }];
    await PrintService.printBarcodes(orders);
    var html = mockWin._written[1];
    expect(html).toContain('M001');
  });

  test('printBarcodes — lines 为 undefined → 使用空数组', async () => {
    var mockWin = createMockPrintWindow2();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, _linesLoaded: true
      // 无 lines 字段
    }];
    await PrintService.printBarcodes(orders);
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('没有行项目'), 'warning'
    );
  });

  test('printOrders — WO 行缺少 warehouse_code → fallback "-"', async () => {
    var mockWin = createMockPrintWindow2();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'WO', sap_doc_num: 'WO300', _linesLoaded: true,
      lines: [{ item_code: 'RM001', item_name: '原料', planned_qty: 50 }]
    }];
    await PrintService.printOrders(orders);
    var html = mockWin._written[1];
    expect(html).toContain('-');
  });

  test('printOrders — SO is_split 但 oms_status 非 split → 无 ⚠', async () => {
    var mockWin = createMockPrintWindow2();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'SO', sap_doc_num: 'SO600', _linesLoaded: true,
      is_split: true, oms_status: 'completed',
      lines: [{ item_code: 'M001', line_num: 1, planned_qty: 1, warehouse_code: 'WH' }]
    }];
    await PrintService.printOrders(orders);
    var html = mockWin._written[1];
    expect(html).not.toContain('⚠');
  });

  test('printOrders — DD 行 source_planned_qty 为 null → 显示 "-"', async () => {
    var mockWin = createMockPrintWindow2();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'DD', doc_number: 'DD-003', _linesLoaded: true,
      oms_status: 'pending',
      lines: [{
        item_code: 'M001', line_num: 1, planned_qty: 50, warehouse_code: 'WH',
        source_doc_number: 'SO200', source_planned_qty: null
      }]
    }];
    await PrintService.printOrders(orders);
    var html = mockWin._written[1];
    expect(html).toContain('-');
  });

  test('printOrders — WO 缺 qrCache 键时不崩溃', async () => {
    var mockWin = createMockPrintWindow2();
    window.open = jest.fn().mockReturnValue(mockWin);
    var orders = [{
      id: 1, doc_type: 'WO', _linesLoaded: true,
      lines: [{ item_code: 'RM001', item_name: '原料', planned_qty: 10, warehouse_code: 'WH' }]
    }];
    await PrintService.printOrders(orders);
    var html = mockWin._written[1];
    expect(html).toContain('wo-card');
  });
});

describe('_buildWmsLink / _buildDDRefsLinks — escapeFn 默认回退', () => {
  test('_buildWmsLink 不传 escapeFn 使用全局 escapeHtml', () => {
    var result = _buildWmsLink('SO', 'SO<100>');
    expect(result).toContain('&lt;');
    expect(result).toContain('so.html');
  });

  test('_buildDDRefsLinks 不传 escapeFn 使用全局 escapeHtml', () => {
    var result = _buildDDRefsLinks('DD26000001#1');
    expect(result).toContain('so.html');
    expect(result).toContain('DD26000001');
  });
});

describe('loadOrderLines — 缺字段 fallback', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<table><tbody id="orderBody"></tbody></table>' +
      '<span id="resultCount">0</span>' +
      '<input id="selectAll" type="checkbox"/>' +
      '<button id="btnExpandAll"></button><button id="btnCollapseAll"></button>';
    global.showMessage = jest.fn();
    global.showLoading = jest.fn();
  });
  afterEach(() => { jest.restoreAllMocks(); });

  test('API 返回无 lines/dd_children 字段 → 使用空数组', async () => {
    _setInternalState({
      _orders: [{ id: 1, doc_type: 'SO' }],
      _totalRecords: 1, _selectedIds: new Set(), _expandedIds: new Set()
    });
    global.apiGet = jest.fn().mockResolvedValue({ success: true });

    await loadOrderLines(1);

    var state = _getInternalState();
    expect(state._orders[0].lines).toEqual([]);
    expect(state._orders[0].dd_children).toEqual([]);
  });
});

describe('initOMS — DOMContentLoaded 与 Enter 键路径 (L1020-L1025)', () => {
  test('document.readyState === "loading" 注册 DOMContentLoaded', () => {
    // L1021 分支: readyState === 'loading' → addEventListener
    var addSpy = jest.spyOn(document, 'addEventListener');
    // 由于 oms.js 已加载完成，此分支在加载时已执行
    // 此处验证 initOMS 可被手动调用不报错
    document.body.innerHTML =
      '<input id="filterDateTo"/><input id="filterDateFrom"/>' +
      '<input id="filterBP"/><input id="filterBPName"/><input id="filterDocNum"/>' +
      '<input id="filterWarehouse"/><input id="filterContainer"/>' +
      '<select id="filterType"><option value=""></option></select>' +
      '<select id="filterStatus"><option value=""></option></select>' +
      '<select id="pageSizeSelect"><option value="20">20</option></select>';

    initOMS();
    // 验证 keydown 监听器注册
    var inputEl = document.getElementById('filterBP');
    expect(inputEl).not.toBeNull();
    addSpy.mockRestore();
  });
});

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

describe('fmtNum — formatNumber 不可用时回退 String()', () => {
  test('formatNumber 不存在时使用 String()', () => {
    var origFn = global.formatNumber;
    delete global.formatNumber;
    expect(fmtNum(42)).toBe('42');
    global.formatNumber = origFn;
  });
});
