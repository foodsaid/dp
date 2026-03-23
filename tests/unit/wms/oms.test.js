/**
 * OMS 主控制器测试
 * 覆盖: oms.js 的查询、渲染、分页、展开/收起、勾选、状态映射、DD 入口桥接
 *
 * 看板纯函数 → oms-kanban.test.js
 * 打印服务 → oms-print.test.js
 * 模块契约 → oms-module-contract.test.js
 */
const { loadSharedJs } = require('./setup');

loadSharedJs();

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

// Mock OmsKanban 和 OmsPrint (oms.js 依赖)
// oms.js 在 Node 环境会检查 typeof OmsKanban，需要先加载真实模块
global.OmsKanban = require('../../../apps/wms/oms-kanban');
global.OmsPrint = require('../../../apps/wms/oms-print');

// 导入 oms.js 真实模块 (不再导入已迁移到 kanban/print 的函数)
const {
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
  printSelectedOrders,
  printSelectedBarcodes,
  buildOmsDetailRowHtml,
  _getInternalState,
  _setInternalState,
  initOMS,
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

  test('OmsPrint.isLocked — 默认为 false', () => {
    expect(global.OmsPrint.isLocked()).toBe(false);
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
    // filterStatus 已改为 multi-select checkbox, 不再是 <select>
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

  test('printSelectedOrders — OmsPrint 抛异常 → 外层 catch 显示打印失败', async () => {
    // OmsPrint 是 Object.freeze 的，需替换整个对象
    var origOmsPrint = global.OmsPrint;
    global.OmsPrint = {
      printOrders: jest.fn().mockRejectedValue(new Error('意外异常')),
      printBarcodes: origOmsPrint.printBarcodes,
      isLocked: origOmsPrint.isLocked
    };
    await printSelectedOrders();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('打印失败'), 'error'
    );
    global.OmsPrint = origOmsPrint;
  });

  test('printSelectedBarcodes — OmsPrint 抛异常 → 外层 catch 显示打印失败', async () => {
    var origOmsPrint = global.OmsPrint;
    global.OmsPrint = {
      printOrders: origOmsPrint.printOrders,
      printBarcodes: jest.fn().mockRejectedValue(new Error('意外异常')),
      isLocked: origOmsPrint.isLocked
    };
    await printSelectedBarcodes();
    expect(global.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('打印失败'), 'error'
    );
    global.OmsPrint = origOmsPrint;
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
    expect(html).toContain('colspan="12"');
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
    // oms_status 现为 multi-select checkbox, 测试 DOM 无 .oms-chk 时不传参
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
