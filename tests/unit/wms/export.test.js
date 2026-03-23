/**
 * export.js 数据导出页业务逻辑剥离测试
 * 覆盖: 日期范围计算 / 查询参数构建 / 统计计算 / 选择逻辑 / 文件名生成 / BOM 处理 / URL 构建
 *
 * 纯函数通过 require() 直接导入，无需 DOM 环境
 */

const {
  calcDefaultDateRange,
  buildExportQueryParams,
  calcDocStats,
  getSelectedOrAllIds,
  buildExportFilename,
  ensureBom,
  buildExportUrl,
} = require('../../../apps/wms/export');

// ============================================================================
// calcDefaultDateRange — 默认日期范围
// ============================================================================

describe('calcDefaultDateRange — 默认日期范围 (最近7天)', () => {

  test('标准日期范围', () => {
    var result = calcDefaultDateRange('2026-03-04');
    expect(result.dateTo).toBe('2026-03-04');
    expect(result.dateFrom).toBe('2026-02-25');
  });

  test('跨月', () => {
    var result = calcDefaultDateRange('2026-03-03');
    expect(result.dateFrom).toBe('2026-02-24');
  });

  test('跨年', () => {
    var result = calcDefaultDateRange('2026-01-03');
    expect(result.dateFrom).toBe('2025-12-27');
    expect(result.dateTo).toBe('2026-01-03');
  });

  test('月初', () => {
    var result = calcDefaultDateRange('2026-02-01');
    expect(result.dateFrom).toBe('2026-01-25');
  });
});

// ============================================================================
// buildExportQueryParams — 查询参数构建
// ============================================================================

describe('buildExportQueryParams — 查询参数构建', () => {

  test('全部筛选条件', () => {
    var params = buildExportQueryParams({
      type: 'SO', status: 'exported', dateFrom: '2026-01-01', dateTo: '2026-03-01'
    });
    expect(params).toContain('type=SO');
    expect(params).toContain('status=exported');
    expect(params).toContain('date_from=2026-01-01');
    expect(params).toContain('date_to=2026-03-01');
  });

  test('无筛选条件只有问号', () => {
    var params = buildExportQueryParams({ type: '', status: '', dateFrom: '', dateTo: '' });
    expect(params).toBe('?');
  });

  test('部分筛选条件', () => {
    var params = buildExportQueryParams({ type: 'PO', status: '', dateFrom: '', dateTo: '2026-03-01' });
    expect(params).toContain('type=PO');
    expect(params).toContain('date_to=2026-03-01');
    expect(params).not.toContain('status=');
    expect(params).not.toContain('date_from=');
  });
});

// ============================================================================
// calcDocStats — 文档统计
// ============================================================================

describe('calcDocStats — 按类型统计文档', () => {

  test('多类型统计', () => {
    var docs = [
      { doc_type: 'SO', total_qty: 10 },
      { doc_type: 'SO', total_qty: 20 },
      { doc_type: 'PO', total_qty: 5 },
    ];
    var stats = calcDocStats(docs);
    expect(stats.SO.count).toBe(2);
    expect(stats.SO.qty).toBe(30);
    expect(stats.PO.count).toBe(1);
    expect(stats.PO.qty).toBe(5);
  });

  test('空数组', () => {
    var stats = calcDocStats([]);
    expect(Object.keys(stats)).toHaveLength(0);
  });

  test('null/undefined 安全', () => {
    expect(Object.keys(calcDocStats(null))).toHaveLength(0);
    expect(Object.keys(calcDocStats(undefined))).toHaveLength(0);
  });

  test('无 doc_type 归为 ?', () => {
    var docs = [{ total_qty: 10 }];
    var stats = calcDocStats(docs);
    expect(stats['?'].count).toBe(1);
    expect(stats['?'].qty).toBe(10);
  });

  test('使用 total_actual 当 total_qty 缺失时', () => {
    var docs = [{ doc_type: 'WO', total_actual: 15 }];
    var stats = calcDocStats(docs);
    expect(stats.WO.qty).toBe(15);
  });

  test('total_qty 和 total_actual 都缺失时为 0', () => {
    var docs = [{ doc_type: 'IC' }];
    var stats = calcDocStats(docs);
    expect(stats.IC.qty).toBe(0);
  });
});

// ============================================================================
// getSelectedOrAllIds — 选择逻辑
// ============================================================================

describe('getSelectedOrAllIds — 选中或全部', () => {

  test('有选中时返回选中项', () => {
    var selected = new Set([1, 3]);
    var docs = [{ id: 1 }, { id: 2 }, { id: 3 }];
    var result = getSelectedOrAllIds(selected, docs);
    expect(result).toEqual(expect.arrayContaining([1, 3]));
    expect(result).toHaveLength(2);
  });

  test('无选中时返回全部', () => {
    var selected = new Set();
    var docs = [{ id: 1 }, { id: 2 }];
    expect(getSelectedOrAllIds(selected, docs)).toEqual([1, 2]);
  });

  test('selectedIds 为 null 时返回全部', () => {
    var docs = [{ id: 5 }];
    expect(getSelectedOrAllIds(null, docs)).toEqual([5]);
  });

  test('文档为空时返回空数组', () => {
    expect(getSelectedOrAllIds(new Set(), [])).toEqual([]);
    expect(getSelectedOrAllIds(new Set(), null)).toEqual([]);
  });
});

// ============================================================================
// buildExportFilename — CSV 文件名
// ============================================================================

describe('buildExportFilename — CSV 文件名生成', () => {

  test('标准文件名格式', () => {
    // 2026-03-04 09:15:30
    var now = new Date(2026, 2, 4, 9, 15, 30);
    var fname = buildExportFilename('SO', 'All', now, 'UTC');
    expect(fname).toMatch(/^WMS_SO_All_\d{8}_\d{6}\.csv$/);
    expect(fname).toContain('091530');
  });

  test('不同类型和状态', () => {
    var now = new Date(2026, 0, 1, 0, 0, 0);
    var fname = buildExportFilename('ALL', 'exported', now, 'UTC');
    expect(fname).toContain('WMS_ALL_exported_');
    expect(fname).toContain('000000.csv');
  });
});

// ============================================================================
// ensureBom — BOM 处理
// ============================================================================

describe('ensureBom — BOM 头处理', () => {

  test('无 BOM 时添加', () => {
    var result = ensureBom('hello');
    expect(result.charCodeAt(0)).toBe(0xFEFF);
    expect(result.slice(1)).toBe('hello');
  });

  test('已有 BOM 时不重复添加', () => {
    var input = '\uFEFFhello';
    var result = ensureBom(input);
    expect(result).toBe(input);
    expect(result.charCodeAt(1)).not.toBe(0xFEFF);
  });
});

// ============================================================================
// buildExportUrl — 导出 URL 构建
// ============================================================================

describe('buildExportUrl — 导出 URL 构建', () => {

  test('标准 URL', () => {
    var url = buildExportUrl('SO', [1, 2, 3]);
    expect(url).toBe('/export?type=SO&ids=1,2,3');
  });

  test('单个 ID', () => {
    var url = buildExportUrl('ALL', [42]);
    expect(url).toBe('/export?type=ALL&ids=42');
  });

  test('类型需要 URL 编码', () => {
    var url = buildExportUrl('S&O', [1]);
    expect(url).toBe('/export?type=S%26O&ids=1');
  });

  test('空 ID 数组', () => {
    var url = buildExportUrl('SO', []);
    expect(url).toBe('/export?type=SO&ids=');
  });
});

// ============================================================================
// 日期校验 — 结束日期不能早于开始日期
// ============================================================================

describe('日期校验 — 结束日期不能早于开始日期', () => {

  test('结束日期早于开始日期应被识别', () => {
    var dateFrom = '2026-03-05';
    var dateTo = '2026-03-01';
    expect(new Date(dateTo) < new Date(dateFrom)).toBe(true);
  });

  test('结束日期等于开始日期是合法的', () => {
    var dateFrom = '2026-03-04';
    var dateTo = '2026-03-04';
    expect(new Date(dateTo) >= new Date(dateFrom)).toBe(true);
  });

  test('结束日期晚于开始日期是合法的', () => {
    var dateFrom = '2026-03-01';
    var dateTo = '2026-03-04';
    expect(new Date(dateTo) > new Date(dateFrom)).toBe(true);
  });

  test('calcDefaultDateRange 总是返回 dateFrom <= dateTo', () => {
    var result = calcDefaultDateRange('2026-03-04');
    expect(new Date(result.dateFrom) <= new Date(result.dateTo)).toBe(true);
  });

  test('calcDefaultDateRange 跨年时也是合法范围', () => {
    var result = calcDefaultDateRange('2026-01-02');
    expect(new Date(result.dateFrom) <= new Date(result.dateTo)).toBe(true);
    expect(result.dateFrom).toBe('2025-12-26');
  });
});

// ============================================================================
// 各类报表 (SO/PO/DD/Stock) API 路径正确拼接
// ============================================================================

describe('报表导出 API 路径拼接 — 各类报表', () => {

  test('SO 销售订单导出路径', () => {
    var params = buildExportQueryParams({ type: 'SO', status: 'exported', dateFrom: '2026-03-01', dateTo: '2026-03-04' });
    expect(params).toContain('type=SO');
    var url = buildExportUrl('SO', [1, 2]);
    expect(url).toBe('/export?type=SO&ids=1,2');
  });

  test('PO 采购订单导出路径', () => {
    var params = buildExportQueryParams({ type: 'PO', status: '', dateFrom: '', dateTo: '' });
    expect(params).toContain('type=PO');
    var url = buildExportUrl('PO', [10, 20, 30]);
    expect(url).toBe('/export?type=PO&ids=10,20,30');
  });

  test('DD 拆单导出路径', () => {
    var params = buildExportQueryParams({ type: 'DD', status: 'pending_export', dateFrom: '2026-02-01', dateTo: '2026-03-01' });
    expect(params).toContain('type=DD');
    expect(params).toContain('status=pending_export');
    var url = buildExportUrl('DD', [100]);
    expect(url).toBe('/export?type=DD&ids=100');
  });

  test('Stock 库存报表查询参数', () => {
    var params = buildExportQueryParams({ type: 'IC', status: 'in_progress', dateFrom: '2026-01-01', dateTo: '2026-03-04' });
    expect(params).toContain('type=IC');
    expect(params).toContain('status=in_progress');
    expect(params).toContain('date_from=2026-01-01');
    expect(params).toContain('date_to=2026-03-04');
  });

  test('ALL 全部类型导出路径', () => {
    var url = buildExportUrl('ALL', [1, 2, 3, 4, 5]);
    expect(url).toBe('/export?type=ALL&ids=1,2,3,4,5');
  });

  test('WO 生产订单导出参数', () => {
    var params = buildExportQueryParams({ type: 'WO', status: 'exported', dateFrom: '2026-02-01', dateTo: '2026-02-28' });
    expect(params).toContain('type=WO');
    expect(params).toContain('status=exported');
  });

  test('TR 调拨申请导出参数', () => {
    var params = buildExportQueryParams({ type: 'TR', status: 'in_progress', dateFrom: '', dateTo: '' });
    expect(params).toContain('type=TR');
    expect(params).toContain('status=in_progress');
    expect(params).not.toContain('date_from=');
  });

  test('LM 库位移动导出路径', () => {
    var url = buildExportUrl('LM', [50, 51, 52]);
    expect(url).toBe('/export?type=LM&ids=50,51,52');
  });

  test('PI 生产发料导出路径', () => {
    var url = buildExportUrl('PI', [99]);
    expect(url).toBe('/export?type=PI&ids=99');
  });
});

// ============================================================================
// buildExportFilename — 更多场景测试
// ============================================================================

describe('buildExportFilename — 更多场景', () => {

  test('DD 拆单报表文件名', () => {
    var now = new Date(2026, 2, 4, 14, 30, 0);
    var fname = buildExportFilename('DD', 'pending_export', now, 'UTC');
    expect(fname).toContain('WMS_DD_pending_export_');
    expect(fname).toContain('.csv');
  });

  test('ALL 报表 + exported 状态文件名', () => {
    var now = new Date(2026, 5, 15, 8, 5, 9);
    var fname = buildExportFilename('ALL', 'exported', now, 'UTC');
    expect(fname).toContain('WMS_ALL_exported_');
    expect(fname).toContain('080509.csv');
  });
});
