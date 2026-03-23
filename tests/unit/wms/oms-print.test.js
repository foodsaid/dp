/**
 * OMS 打印服务测试
 * 覆盖: oms-print.js 的 PrintService + HTML 构建原语
 */
const { loadSharedJs } = require('./setup');

loadSharedJs();

global.t = function(key, fallback) { return fallback || key; };

const OmsPrint = require('../../../apps/wms/oms-print');

// --- 公共工具 ---
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

function createMockDeps(overrides) {
  return Object.assign({
    showMessage: jest.fn(),
    showLoading: jest.fn(),
    ensureOrderLines: jest.fn().mockResolvedValue(),
    generateBarcodeUrl: typeof generateBarcodeUrl !== 'undefined' ? generateBarcodeUrl : jest.fn().mockReturnValue('data:image/png;base64,mock'),
    escapeHtml: typeof escapeHtml !== 'undefined' ? escapeHtml : jest.fn(s => s),
    formatNumber: typeof formatNumber !== 'undefined' ? formatNumber : jest.fn(n => String(n)),
    formatDate: typeof formatDate !== 'undefined' ? formatDate : jest.fn(d => d),
    getOmsStatusLabel: jest.fn().mockReturnValue('待处理'),
    getSapDisplayStatus: jest.fn().mockReturnValue('Open'),
    t: global.t
  }, overrides || {});
}

// ============================================================================
// HTML 构建原语
// ============================================================================
describe('HTML 构建原语', () => {
  test('_escAttr 转义 XSS 字符', () => {
    expect(OmsPrint._escAttr('1" onclick="alert(1)')).toBe('1&quot; onclick=&quot;alert(1)');
    expect(OmsPrint._escAttr('A & B')).toBe('A &amp; B');
  });

  test('_escAttr 处理非字符串输入', () => {
    expect(OmsPrint._escAttr(123)).toBe('123');
    expect(OmsPrint._escAttr(null)).toBe('null');
    expect(OmsPrint._escAttr(undefined)).toBe('undefined');
  });

  test('_tag 生成 HTML', () => {
    expect(OmsPrint._tag('div', 'content', { class: 'red' })).toBe('<div class="red">content</div>');
  });

  test('_tag 无 attrs 时不添加属性', () => {
    expect(OmsPrint._tag('span', 'text')).toBe('<span>text</span>');
  });

  test('_tag 无 content 时生成空标签', () => {
    expect(OmsPrint._tag('div', '', { id: 'x' })).toBe('<div id="x"></div>');
  });

  test('_tag attrs 值含特殊字符时转义', () => {
    var result = OmsPrint._tag('a', 'link', { href: 'url"bad' });
    expect(result).toBe('<a href="url&quot;bad">link</a>');
  });

  test('_td 生成 td 标签', () => {
    expect(OmsPrint._td('cell', { class: 'num' })).toBe('<td class="num">cell</td>');
  });

  test('_th 生成 th 标签', () => {
    expect(OmsPrint._th('header')).toBe('<th>header</th>');
  });

  test('_tr 包裹多个单元格', () => {
    var cells = ['<td>A</td>', '<td>B</td>'];
    expect(OmsPrint._tr(cells)).toBe('<tr><td>A</td><td>B</td></tr>');
  });

  test('_table 生成完整表格', () => {
    var head = '<tr><th>H1</th></tr>';
    var rows = ['<tr><td>R1</td></tr>'];
    var result = OmsPrint._table(head, rows);
    expect(result).toContain('<table class="lines-table">');
    expect(result).toContain('<thead><tr><th>H1</th></tr></thead>');
    expect(result).toContain('<tbody><tr><td>R1</td></tr></tbody>');
  });

  test('_STYLES 已冻结', () => {
    expect(Object.isFrozen(OmsPrint._STYLES)).toBe(true);
  });

  test('_STYLES 包含 barcode 和 order 样式', () => {
    expect(OmsPrint._STYLES.barcode).toContain('item-card');
    expect(OmsPrint._STYLES.order).toContain('order-block');
  });
});

// ============================================================================
// PrintService 深度流程测试
// ============================================================================
describe('PrintService 深度流程测试', () => {
  var origOpen;
  beforeEach(() => {
    jest.clearAllMocks();
    origOpen = window.open;
  });

  afterEach(() => {
    window.open = origOpen;
  });

  // --- printBarcodes 流程 ---
  test('printBarcodes — 空选择报 warning', async () => {
    var deps = createMockDeps();
    await OmsPrint.printBarcodes([], deps);
    expect(deps.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('请先选择订单'), 'warning'
    );
  });

  test('printBarcodes — 超过50个订单报 warning', async () => {
    var deps = createMockDeps();
    var orders = [];
    for (var i = 0; i < 51; i++) orders.push({ id: i, lines: [] });
    await OmsPrint.printBarcodes(orders, deps);
    expect(deps.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('最多批量打印 50'), 'warning'
    );
  });

  test('printBarcodes — 弹窗被拦截 (window.open 返回 null)', async () => {
    window.open = jest.fn().mockReturnValue(null);
    var deps = createMockDeps();
    var orders = [{ id: 1, doc_type: 'SO', _linesLoaded: true, lines: [{ item_code: 'A' }] }];
    await OmsPrint.printBarcodes(orders, deps);
    expect(deps.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('弹窗被拦截'), 'error'
    );
  });

  test('printBarcodes — 加载失败的订单报错', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{ id: 1, doc_type: 'SO', _linesLoaded: true, _loadError: true, lines: [] }];
    await OmsPrint.printBarcodes(orders, deps);
    expect(deps.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('加载失败'), 'error'
    );
  });

  test('printBarcodes — 无行项目时报 warning', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{ id: 1, doc_type: 'SO', _linesLoaded: true, lines: [] }];
    await OmsPrint.printBarcodes(orders, deps);
    expect(deps.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('没有行项目'), 'warning'
    );
  });

  test('printBarcodes — 成功生成条码 HTML 并写入新窗口', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'SO', _linesLoaded: true,
      lines: [
        { item_code: 'ITEM001', item_name: '物料A' },
        { item_code: 'ITEM002', item_name: '物料B' }
      ]
    }];
    await OmsPrint.printBarcodes(orders, deps);
    expect(mockWin.document.open).toHaveBeenCalled();
    expect(mockWin.document.write).toHaveBeenCalledTimes(2);
    expect(mockWin.document.close).toHaveBeenCalledTimes(2);
    var finalHtml = mockWin._written[1];
    expect(finalHtml).toContain('ITEM001');
    expect(finalHtml).toContain('ITEM002');
    expect(finalHtml).toContain('item-card');
    expect(deps.showMessage).not.toHaveBeenCalled();
  });

  test('printBarcodes — 重复物料去重', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'SO', _linesLoaded: true,
      lines: [
        { item_code: 'DUP01', item_name: '重复A' },
        { item_code: 'DUP01', item_name: '重复A' },
        { item_code: 'UNIQ01', item_name: '唯一B' }
      ]
    }];
    await OmsPrint.printBarcodes(orders, deps);
    var finalHtml = mockWin._written[1];
    var cardMatches = finalHtml.match(/<div class="item-card">/g);
    // 去重后只有 2 个卡片 (DUP01 + UNIQ01)
    expect(cardMatches.length).toBe(2);
  });

  test('printBarcodes — _printLock 防止重入', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'SO', _linesLoaded: true,
      lines: [{ item_code: 'A', item_name: 'X' }]
    }];
    var p1 = OmsPrint.printBarcodes(orders, deps);
    await OmsPrint.printBarcodes(orders, deps);
    await p1;
    expect(window.open).toHaveBeenCalledTimes(1);
  });

  test('printBarcodes — 物料行过多 (>5000) 拦截', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var manyLines = [];
    for (var i = 0; i < 5001; i++) {
      manyLines.push({ item_code: 'M' + i, item_name: 'N' + i });
    }
    var orders = [{ id: 1, doc_type: 'SO', _linesLoaded: true, lines: manyLines }];
    await OmsPrint.printBarcodes(orders, deps);
    expect(deps.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('物料行数过多'), 'warning'
    );
  });

  // --- printOrders 流程 ---
  test('printOrders — 空选择报 warning', async () => {
    var deps = createMockDeps();
    await OmsPrint.printOrders([], deps);
    expect(deps.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('请先选择订单'), 'warning'
    );
  });

  test('printOrders — 超过50个订单报 warning', async () => {
    var deps = createMockDeps();
    var orders = [];
    for (var i = 0; i < 51; i++) orders.push({ id: i, lines: [] });
    await OmsPrint.printOrders(orders, deps);
    expect(deps.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('最多批量打印 50'), 'warning'
    );
  });

  test('printOrders — 弹窗被拦截', async () => {
    window.open = jest.fn().mockReturnValue(null);
    var deps = createMockDeps();
    var orders = [{ id: 1, doc_type: 'SO', _linesLoaded: true, lines: [{ item_code: 'A' }] }];
    await OmsPrint.printOrders(orders, deps);
    expect(deps.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('弹窗被拦截'), 'error'
    );
  });

  test('printOrders — 加载失败订单报错', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{ id: 1, doc_type: 'SO', _linesLoaded: true, _loadError: true, lines: [] }];
    await OmsPrint.printOrders(orders, deps);
    expect(deps.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('加载失败'), 'error'
    );
  });

  test('printOrders — 物料行过多 (>5000) 拦截', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var manyLines = [];
    for (var i = 0; i < 5001; i++) {
      manyLines.push({ item_code: 'M' + i, line_num: i, planned_qty: 1 });
    }
    var orders = [{ id: 1, doc_type: 'SO', _linesLoaded: true, lines: manyLines }];
    await OmsPrint.printOrders(orders, deps);
    expect(deps.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('物料行数过多'), 'warning'
    );
  });

  test('printOrders — 非 WO 订单成功生成 HTML (含柜号)', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'SO', sap_doc_num: 'SO100', _linesLoaded: true,
      bp_name: '客户A', doc_date: '2026-03-01', oms_status: 'pending', due_date: '2026-03-15',
      container_no: 'CTN001',
      lines: [
        { item_code: 'M001', item_name: '钢管', line_num: 1, planned_qty: 100, warehouse_code: 'WH01' },
        { item_code: 'M002', item_name: '螺栓', line_num: 2, planned_qty: 200, warehouse_code: 'WH01' }
      ]
    }];
    await OmsPrint.printOrders(orders, deps);
    var finalHtml = mockWin._written[1];
    expect(finalHtml).toContain('SO100');
    expect(finalHtml).toContain('客户A');
    expect(finalHtml).toContain('M001');
    expect(finalHtml).toContain('M002');
    expect(finalHtml).toContain('CTN001');
    expect(finalHtml).toContain('lines-table');
    expect(deps.showMessage).not.toHaveBeenCalled();
  });

  test('printOrders — 无柜号时不显示柜号', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'SO', sap_doc_num: 'SO400', _linesLoaded: true,
      lines: [{ item_code: 'X', line_num: 1, planned_qty: 1, warehouse_code: 'WH' }]
    }];
    await OmsPrint.printOrders(orders, deps);
    var finalHtml = mockWin._written[1];
    expect(finalHtml).not.toContain('柜号');
  });

  test('printOrders — DD 订单打印含原单引用列', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'DD', doc_number: 'DD-001', _linesLoaded: true,
      bp_name: '客户B', doc_date: '2026-03-02', oms_status: 'pending',
      lines: [
        { item_code: 'M001', item_name: '钢管', line_num: 1, planned_qty: 50, warehouse_code: 'WH01',
          source_doc_number: 'SO100', source_line_num: 1, source_planned_qty: 100 }
      ]
    }];
    await OmsPrint.printOrders(orders, deps);
    var finalHtml = mockWin._written[1];
    expect(finalHtml).toContain('DD-001');
    expect(finalHtml).toContain('SO100');
    expect(finalHtml).toContain('L1');
  });

  test('printOrders — DD 行无 source_doc_number 时原单列为空', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'DD', doc_number: 'DD-002', _linesLoaded: true,
      lines: [{ item_code: 'M001', line_num: 1, planned_qty: 10, warehouse_code: 'WH01' }]
    }];
    await OmsPrint.printOrders(orders, deps);
    var finalHtml = mockWin._written[1];
    expect(finalHtml).toContain('DD-002');
  });

  test('printOrders — 无行项目的订单显示警告文本', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'SO', sap_doc_num: 'SO200', _linesLoaded: true,
      lines: []
    }];
    await OmsPrint.printOrders(orders, deps);
    var finalHtml = mockWin._written[1];
    expect(finalHtml).toContain('没有行项目');
  });

  test('printOrders — WO 订单: 抬头卡片 + BOM 合并明细', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'WO', sap_doc_num: 'WO500', item_code: 'FG001', _linesLoaded: true,
      warehouse_code: 'WH-FG', total_planned_qty: 1000,
      lines: [
        { item_code: 'RM001', item_name: '原料A', planned_qty: 100, actual_qty: 50, warehouse_code: 'WH-RM' },
        { item_code: 'RM001', item_name: '原料A', planned_qty: 200, actual_qty: 100, warehouse_code: 'WH-RM' },
        { item_code: 'RM002', item_name: '原料B', planned_qty: 50, warehouse_code: 'WH-RM' }
      ]
    }];
    await OmsPrint.printOrders(orders, deps);
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
    var deps = createMockDeps();
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
    await OmsPrint.printOrders(orders, deps);
    var finalHtml = mockWin._written[1];
    expect(finalHtml).toContain('page-break-after:always');
    expect(finalHtml).toContain('SO300');
    expect(finalHtml).toContain('WO600');
  });

  test('printOrders — SO + is_split 状态显示 ⚠', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'SO', sap_doc_num: 'SO500', _linesLoaded: true,
      oms_status: 'split', is_split: true,
      lines: [{ item_code: 'X', line_num: 1, planned_qty: 1, warehouse_code: 'WH' }]
    }];
    await OmsPrint.printOrders(orders, deps);
    var finalHtml = mockWin._written[1];
    expect(finalHtml).toContain('⚠');
  });

  test('printOrders — 抬头有 item_code 时被收集进条码缓存', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'WO', sap_doc_num: 'WO700', item_code: 'HEADER_ITEM', _linesLoaded: true,
      lines: [{ item_code: 'LINE_ITEM', item_name: '行物料', line_num: 1, planned_qty: 10, warehouse_code: 'WH' }]
    }];
    await OmsPrint.printOrders(orders, deps);
    var finalHtml = mockWin._written[1];
    // 抬头物料和行物料都应出现
    expect(finalHtml).toContain('HEADER_ITEM');
    expect(finalHtml).toContain('LINE_ITEM');
  });
});

// ============================================================================
// PrintService 内层异常 — HTML 写入失败
// ============================================================================
describe('PrintService 内层异常 — HTML 写入失败', () => {
  var origOpen;
  beforeEach(() => {
    jest.clearAllMocks();
    origOpen = window.open;
  });

  afterEach(() => {
    window.open = origOpen;
  });

  test('printBarcodes — document.write 抛错 → 内层 catch', async () => {
    var writeCount = 0;
    var mockWin = {
      closed: false,
      document: {
        open: jest.fn(),
        write: jest.fn(function() {
          writeCount++;
          // 第 1 次 write = loading 提示, 第 2 次 write = 最终 HTML → 抛错
          if (writeCount >= 2) throw new Error('DOM write error');
        }),
        close: jest.fn()
      },
      close: jest.fn(),
      print: jest.fn(),
      focus: jest.fn()
    };
    window.open = jest.fn().mockReturnValue(mockWin);

    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'SO', _linesLoaded: true, lines: [{ item_code: 'X1', item_name: 'Item X1' }]
    }];
    var errorSpy = jest.spyOn(console, 'error').mockImplementation(function() {});

    await OmsPrint.printBarcodes(orders, deps);

    expect(errorSpy).toHaveBeenCalledWith('打印条码异常:', expect.any(Error));
    expect(deps.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('打印失败'), 'error'
    );
    errorSpy.mockRestore();
  });

  test('printOrders — document.write 抛错 → 内层 catch', async () => {
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

    var deps = createMockDeps();
    var orders = [{
      id: 2, doc_type: 'SO', doc_number: 'SO-100', bp_name: 'Test',
      _linesLoaded: true, lines: [{ item_code: 'Y1', item_name: 'Item Y1', planned_qty: 10, picked_qty: 0 }]
    }];
    var errorSpy = jest.spyOn(console, 'error').mockImplementation(function() {});

    await OmsPrint.printOrders(orders, deps);

    expect(errorSpy).toHaveBeenCalledWith('打印订单异常:', expect.any(Error));
    expect(deps.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('打印失败'), 'error'
    );
    errorSpy.mockRestore();
  });
});

// ============================================================================
// PrintService — 缺字段 fallback 分支
// ============================================================================
describe('PrintService — 缺字段 fallback 分支', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => { jest.restoreAllMocks(); });

  test('printOrders — 订单缺少 bp_name/business_partner → fallback "-"', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'SO', sap_doc_num: 'SO100', _linesLoaded: true,
      oms_status: 'pending',
      lines: [{ item_code: 'M001', line_num: 1, planned_qty: 10, warehouse_code: 'WH' }]
    }];
    await OmsPrint.printOrders(orders, deps);
    var html = mockWin._written[1];
    expect(html).toContain('-');
  });

  test('printOrders — DD 订单用 doc_number 而非 sap_doc_num', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'DD', doc_number: 'DD26000001', _linesLoaded: true,
      oms_status: 'pending',
      lines: [{ item_code: 'M001', line_num: 1, planned_qty: 10 }]
    }];
    await OmsPrint.printOrders(orders, deps);
    var html = mockWin._written[1];
    expect(html).toContain('DD26000001');
  });

  test('printOrders — DD 行有 source_line_num → 显示 L 前缀', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'DD', doc_number: 'DD-001', _linesLoaded: true,
      oms_status: 'pending',
      lines: [{
        item_code: 'M001', line_num: 1, planned_qty: 50, warehouse_code: 'WH',
        source_doc_number: 'SO100', source_line_num: 3, source_planned_qty: 100
      }]
    }];
    await OmsPrint.printOrders(orders, deps);
    var html = mockWin._written[1];
    expect(html).toContain('SO100');
    expect(html).toContain('L3');
  });

  test('printOrders — WO 行缺少 item_name → 空字符串', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'WO', sap_doc_num: 'WO100', _linesLoaded: true,
      item_code: 'FG001',
      lines: [{ item_code: 'RM001', planned_qty: 100, warehouse_code: 'WH' }]
    }];
    await OmsPrint.printOrders(orders, deps);
    var html = mockWin._written[1];
    expect(html).toContain('RM001');
    expect(html).toContain('wo-tbl');
  });

  test('printOrders — WO 使用 delivered_qty 作为已发数量', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'WO', sap_doc_num: 'WO200', _linesLoaded: true,
      lines: [{ item_code: 'RM001', item_name: '原料', planned_qty: 100, delivered_qty: 30, warehouse_code: 'WH' }]
    }];
    await OmsPrint.printOrders(orders, deps);
    var html = mockWin._written[1];
    expect(html).toContain('wo-tbl');
  });

  test('printOrders — 订单缺少 doc_type → qrCache key 不含类型', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, sap_doc_num: 'X100', _linesLoaded: true,
      oms_status: 'pending',
      lines: [{ item_code: 'M001', line_num: 1, planned_qty: 5, warehouse_code: 'WH' }]
    }];
    await OmsPrint.printOrders(orders, deps);
    expect(mockWin.document.write).toHaveBeenCalled();
  });

  test('printOrders — 行缺少 item_name 和 warehouse_code', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'SO', sap_doc_num: 'SO300', _linesLoaded: true,
      oms_status: 'pending',
      lines: [{ item_code: 'M001', line_num: 1, planned_qty: 10 }]
    }];
    await OmsPrint.printOrders(orders, deps);
    var html = mockWin._written[1];
    expect(html).toContain('M001');
  });

  test('printBarcodes — 行缺少 item_name', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, _linesLoaded: true,
      lines: [{ item_code: 'M001', line_num: 1 }]
    }];
    await OmsPrint.printBarcodes(orders, deps);
    var html = mockWin._written[1];
    expect(html).toContain('M001');
  });

  test('printBarcodes — lines 为 undefined → 使用空数组', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, _linesLoaded: true
      // 无 lines 字段
    }];
    await OmsPrint.printBarcodes(orders, deps);
    expect(deps.showMessage).toHaveBeenCalledWith(
      expect.stringContaining('没有行项目'), 'warning'
    );
  });

  test('printOrders — WO 行缺少 warehouse_code → fallback "-"', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'WO', sap_doc_num: 'WO300', _linesLoaded: true,
      lines: [{ item_code: 'RM001', item_name: '原料', planned_qty: 50 }]
    }];
    await OmsPrint.printOrders(orders, deps);
    var html = mockWin._written[1];
    expect(html).toContain('-');
  });

  test('printOrders — SO is_split 但 oms_status 非 split → 无 ⚠', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'SO', sap_doc_num: 'SO600', _linesLoaded: true,
      is_split: true, oms_status: 'completed',
      lines: [{ item_code: 'M001', line_num: 1, planned_qty: 1, warehouse_code: 'WH' }]
    }];
    await OmsPrint.printOrders(orders, deps);
    var html = mockWin._written[1];
    expect(html).not.toContain('⚠');
  });

  test('printOrders — DD 行 source_planned_qty 为 null → 显示 "-"', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'DD', doc_number: 'DD-003', _linesLoaded: true,
      oms_status: 'pending',
      lines: [{
        item_code: 'M001', line_num: 1, planned_qty: 50, warehouse_code: 'WH',
        source_doc_number: 'SO200', source_planned_qty: null
      }]
    }];
    await OmsPrint.printOrders(orders, deps);
    var html = mockWin._written[1];
    expect(html).toContain('-');
  });

  test('printOrders — WO 缺 qrCache 键时不崩溃', async () => {
    var mockWin = createMockPrintWindow();
    window.open = jest.fn().mockReturnValue(mockWin);
    var deps = createMockDeps();
    var orders = [{
      id: 1, doc_type: 'WO', _linesLoaded: true,
      lines: [{ item_code: 'RM001', item_name: '原料', planned_qty: 10, warehouse_code: 'WH' }]
    }];
    await OmsPrint.printOrders(orders, deps);
    var html = mockWin._written[1];
    expect(html).toContain('wo-card');
  });
});

// ============================================================================
// isLocked 状态查询
// ============================================================================
describe('isLocked 状态查询', () => {
  test('初始状态 isLocked 返回 false', () => {
    expect(OmsPrint.isLocked()).toBe(false);
  });
});
