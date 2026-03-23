/**
 * 缓存同步共享工具测试 (wf06 物料 / wf07 仓库 / wf10 库位)
 * 覆盖: SQL 转义、日期格式化、UPSERT 生成、批次统计
 * v0.5: 所有 UPSERT 函数新增 companyCode 参数
 */
const {
  escapeValue,
  safeNum,
  formatSyncAnchor,
  buildSyncAnchor,
  buildItemsUpsertBatches,
  buildLocationsUpsert,
  buildBinsUpsertBatches,
  countBatchTotal,
} = require('../../../apps/wf/lib/wf-sync-helpers');

// ============================================================================
// escapeValue — SQL 字符串转义
// ============================================================================

describe('escapeValue — SQL 字符串转义', () => {
  test('null → 空字符串', () => {
    expect(escapeValue(null)).toBe('');
  });

  test('undefined → 空字符串', () => {
    expect(escapeValue(undefined)).toBe('');
  });

  test('普通字符串原样返回', () => {
    expect(escapeValue('hello')).toBe('hello');
  });

  test('单引号被双转义', () => {
    expect(escapeValue("it's")).toBe("it''s");
  });

  test('反斜杠被转义', () => {
    expect(escapeValue('a\\b')).toBe('a\\\\b');
  });

  test('null bytes 被移除', () => {
    expect(escapeValue('ab\u0000cd')).toBe('abcd');
  });

  test('超长字符串被截断 (默认 500)', () => {
    var long = 'x'.repeat(600);
    expect(escapeValue(long).length).toBe(500);
  });

  test('自定义最大长度', () => {
    expect(escapeValue('abcdef', 3)).toBe('abc');
  });

  test('数值自动转字符串', () => {
    expect(escapeValue(123)).toBe('123');
  });

  test('组合: 单引号 + 反斜杠 + null byte', () => {
    expect(escapeValue("a'\\b\u0000c")).toBe("a''\\\\bc");
  });
});

// ============================================================================
// safeNum — 安全数值转换
// ============================================================================

describe('safeNum — 安全数值转换', () => {
  test('正常数值', () => { expect(safeNum(42)).toBe(42); });
  test('字符串数值', () => { expect(safeNum('3.14')).toBe(3.14); });
  test('null → 0', () => { expect(safeNum(null)).toBe(0); });
  test('undefined → 0', () => { expect(safeNum(undefined)).toBe(0); });
  test('非数值字符串 → 0', () => { expect(safeNum('abc')).toBe(0); });
  test('NaN → 0', () => { expect(safeNum(NaN)).toBe(0); });
});

// ============================================================================
// formatSyncAnchor — 同步锚点日期格式化
// ============================================================================

describe('formatSyncAnchor — 同步锚点日期格式化', () => {
  test('有效 ISO 日期 → YYYY-MM-DD HH:MM:SS', () => {
    var result = formatSyncAnchor('2026-03-08T10:30:00.000Z');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('null → 使用当前时间减 1 小时 (不抛异常)', () => {
    var result = formatSyncAnchor(null);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('空字符串 → 使用当前时间减 1 小时', () => {
    var result = formatSyncAnchor('');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('无效日期 → 抛异常', () => {
    expect(() => formatSyncAnchor('not-a-date')).toThrow('无效日期');
  });

  test('SQL 注入尝试被阻止', () => {
    // 无效的日期字符串不会通过正则
    expect(() => formatSyncAnchor("'; DROP TABLE--")).toThrow('无效日期');
  });
});

// ============================================================================
// buildSyncAnchor — 增量查询锚点 (wf10)
// ============================================================================

describe('buildSyncAnchor — 增量查询锚点', () => {
  test('正常日期截取前 19 字符', () => {
    expect(buildSyncAnchor('2026-03-08T10:30:00.000Z')).toBe('2026-03-08T10:30:00');
  });

  test('null → 默认 2000-01-01', () => {
    expect(buildSyncAnchor(null)).toBe('2000-01-01');
  });

  test('空字符串 → 默认 2000-01-01', () => {
    expect(buildSyncAnchor('')).toBe('2000-01-01');
  });

  test('非日期格式 → 抛异常', () => {
    expect(() => buildSyncAnchor('invalid')).toThrow('增量锚点格式异常');
  });
});

// ============================================================================
// buildItemsUpsertBatches — 物料批量 UPSERT (wf06)
// v0.5: 新增 companyCode 必填参数
// ============================================================================

describe('buildItemsUpsertBatches — 物料 UPSERT', () => {
  var CC = 'DEFAULT';

  test('单条物料 → 1 批次 (含 company_code)', () => {
    var items = [{ ItemCode: 'A001', ItemName: '物料A', InvntryUom: 'PCS', ManBtchNum: 'Y' }];
    var result = buildItemsUpsertBatches(items, CC);
    expect(result).toHaveLength(1);
    expect(result[0].sql).toContain('INSERT INTO wms.wms_items_cache');
    expect(result[0].sql).toContain('company_code');
    expect(result[0].sql).toContain("'" + CC + "'");
    expect(result[0].sql).toContain("'A001'");
    expect(result[0].sql).toContain('ON CONFLICT (company_code, item_code) DO UPDATE');
    expect(result[0].batch_num).toBe(1);
    expect(result[0].count).toBe(1);
  });

  test('空数组 → SELECT 1 占位', () => {
    var result = buildItemsUpsertBatches([], CC);
    expect(result).toHaveLength(1);
    expect(result[0].sql).toBe('SELECT 1');
    expect(result[0].count).toBe(0);
  });

  test('超过 batchSize → 多批次', () => {
    var items = [];
    for (var i = 0; i < 5; i++) {
      items.push({ ItemCode: 'ITEM-' + i, ItemName: 'N' + i, InvntryUom: 'PCS', ManBtchNum: 'N' });
    }
    var result = buildItemsUpsertBatches(items, CC, 2);
    expect(result).toHaveLength(3); // 2+2+1
    expect(result[0].count).toBe(2);
    expect(result[1].count).toBe(2);
    expect(result[2].count).toBe(1);
    expect(result[0].batch_num).toBe(1);
    expect(result[2].batch_num).toBe(3);
  });

  test('ManBtchNum 为 null → 默认 N', () => {
    var items = [{ ItemCode: 'X', ItemName: '', InvntryUom: '', ManBtchNum: null }];
    var result = buildItemsUpsertBatches(items, CC);
    expect(result[0].sql).toContain("'N'");
  });

  test('SQL 注入防护 — 单引号被转义', () => {
    var items = [{ ItemCode: "A'B", ItemName: "it's", InvntryUom: 'PCS', ManBtchNum: 'N' }];
    var result = buildItemsUpsertBatches(items, CC);
    expect(result[0].sql).toContain("A''B");
    expect(result[0].sql).toContain("it''s");
    expect(result[0].sql).not.toContain("A'B");
  });

  test('缺少 companyCode → 抛异常', () => {
    var items = [{ ItemCode: 'A001', ItemName: '', InvntryUom: '', ManBtchNum: 'N' }];
    expect(() => buildItemsUpsertBatches(items)).toThrow('companyCode 不能为空');
    expect(() => buildItemsUpsertBatches(items, '')).toThrow('companyCode 不能为空');
    expect(() => buildItemsUpsertBatches(items, null)).toThrow('companyCode 不能为空');
    expect(() => buildItemsUpsertBatches(items, '  ')).toThrow('companyCode 不能为空');
  });

  test('companyCode 含特殊字符被转义', () => {
    var items = [{ ItemCode: 'A001', ItemName: '', InvntryUom: '', ManBtchNum: 'N' }];
    var result = buildItemsUpsertBatches(items, "CO'MP");
    expect(result[0].sql).toContain("CO''MP");
  });
});

// ============================================================================
// buildLocationsUpsert — 仓库 UPSERT (wf07)
// v0.5: 新增 companyCode 必填参数
// ============================================================================

describe('buildLocationsUpsert — 仓库 UPSERT', () => {
  var CC = 'DEFAULT';

  test('正常仓库数据 (含 company_code)', () => {
    var items = [
      { WhsCode: 'WH01', WhsName: '主仓' },
      { WhsCode: 'WH02', WhsName: '副仓' }
    ];
    var result = buildLocationsUpsert(items, CC);
    expect(result.sql).toContain('INSERT INTO wms.wms_locations_cache');
    expect(result.sql).toContain('company_code');
    expect(result.sql).toContain("'" + CC + "'");
    expect(result.sql).toContain("'WH01'");
    expect(result.sql).toContain("'WH02'");
    expect(result.sql).toContain('ON CONFLICT (company_code, whs_code) DO UPDATE');
    expect(result.count).toBe(2);
  });

  test('空数组 → SELECT 1', () => {
    var result = buildLocationsUpsert([], CC);
    expect(result.sql).toBe('SELECT 1');
    expect(result.count).toBe(0);
  });

  test('null → SELECT 1', () => {
    var result = buildLocationsUpsert(null, CC);
    expect(result.sql).toBe('SELECT 1');
    expect(result.count).toBe(0);
  });

  test('SQL 注入防护', () => {
    var items = [{ WhsCode: "W'H", WhsName: "test\\name" }];
    var result = buildLocationsUpsert(items, CC);
    expect(result.sql).toContain("W''H");
    expect(result.sql).toContain("test\\\\name");
  });

  test('缺少 companyCode → 抛异常', () => {
    var items = [{ WhsCode: 'WH01', WhsName: '主仓' }];
    expect(() => buildLocationsUpsert(items)).toThrow('companyCode 不能为空');
    expect(() => buildLocationsUpsert(items, '')).toThrow('companyCode 不能为空');
    expect(() => buildLocationsUpsert(items, null)).toThrow('companyCode 不能为空');
  });
});

// ============================================================================
// buildBinsUpsertBatches — 库位批量 UPSERT (wf10)
// v0.5: 新增 companyCode 必填参数
// ============================================================================

describe('buildBinsUpsertBatches — 库位 UPSERT', () => {
  var CC = 'DEFAULT';

  test('正常库位数据 (含 company_code)', () => {
    var items = [{ bin_code: 'BIN-001', whs_code: 'WH01', whs_name: '主仓', bin_name: '1-1-1', max_level: 5 }];
    var result = buildBinsUpsertBatches(items, CC);
    expect(result).toHaveLength(1);
    expect(result[0].sql).toContain('INSERT INTO wms.wms_bins_cache');
    expect(result[0].sql).toContain('company_code');
    expect(result[0].sql).toContain("'" + CC + "'");
    expect(result[0].sql).toContain("'BIN-001'");
    expect(result[0].sql).toContain(',5,');
    expect(result[0].sql).toContain('ON CONFLICT (company_code, bin_code) DO UPDATE');
    expect(result[0].count).toBe(1);
  });

  test('空数组 → SELECT 1 占位', () => {
    var result = buildBinsUpsertBatches([], CC);
    expect(result).toHaveLength(1);
    expect(result[0].sql).toBe('SELECT 1');
    expect(result[0].count).toBe(0);
  });

  test('超过 batchSize → 多批次', () => {
    var items = [];
    for (var i = 0; i < 5; i++) {
      items.push({ bin_code: 'B' + i, whs_code: 'W', whs_name: '', bin_name: '', max_level: i });
    }
    var result = buildBinsUpsertBatches(items, CC, 3);
    expect(result).toHaveLength(2);
    expect(result[0].count).toBe(3);
    expect(result[1].count).toBe(2);
  });

  test('max_level 非数值 → 默认 0', () => {
    var items = [{ bin_code: 'B1', whs_code: 'W', whs_name: '', bin_name: '', max_level: 'abc' }];
    var result = buildBinsUpsertBatches(items, CC);
    expect(result[0].sql).toContain(',0,');
  });

  test('SQL 注入防护', () => {
    var items = [{ bin_code: "B'IN", whs_code: 'W', whs_name: "n\u0000ull", bin_name: '', max_level: 0 }];
    var result = buildBinsUpsertBatches(items, CC);
    expect(result[0].sql).toContain("B''IN");
    expect(result[0].sql).toContain("null"); // null byte removed
    expect(result[0].sql).not.toContain('\u0000');
  });

  test('缺少 companyCode → 抛异常', () => {
    var items = [{ bin_code: 'B1', whs_code: 'W', whs_name: '', bin_name: '', max_level: 0 }];
    expect(() => buildBinsUpsertBatches(items)).toThrow('companyCode 不能为空');
    expect(() => buildBinsUpsertBatches(items, '')).toThrow('companyCode 不能为空');
    expect(() => buildBinsUpsertBatches(items, null)).toThrow('companyCode 不能为空');
  });
});

// ============================================================================
// countBatchTotal — 批次总行数统计
// ============================================================================

describe('countBatchTotal — 批次统计', () => {
  test('正常批次 → 总和', () => {
    expect(countBatchTotal([{ count: 10 }, { count: 20 }, { count: 5 }])).toBe(35);
  });

  test('空数组 → 0', () => {
    expect(countBatchTotal([])).toBe(0);
  });

  test('缺少 count → 按 0 计', () => {
    expect(countBatchTotal([{ count: 10 }, {}])).toBe(10);
  });
});
