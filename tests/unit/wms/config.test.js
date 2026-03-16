/**
 * WMS 配置感知函数单元测试
 * 覆盖: getModuleConfig / getDefaultBin / getDefaultBatch / getDefaultProdDate / getReceiptDefaults / isSystemBin
 * 策略: 每组测试前修改 CONFIG.wmsConfig 模拟不同配置场景，测试后恢复
 */

const { loadSharedJs } = require('./setup');

beforeAll(() => {
  loadSharedJs();
});

// 保存原始配置，每个 test 后恢复
let originalWmsConfig;
beforeEach(() => {
  originalWmsConfig = JSON.parse(JSON.stringify(CONFIG.wmsConfig));
});
afterEach(() => {
  CONFIG.wmsConfig = originalWmsConfig;
});

// ============================================================================
// getModuleConfig — 模块级配置读取
// ============================================================================

describe('getModuleConfig — 模块级配置', () => {

  test('无模块覆盖时返回全局值', () => {
    expect(getModuleConfig('PO', 'DEFAULT_BIN_SUFFIX')).toBe('SYSTEM-BIN-LOCATION');
    expect(getModuleConfig('WO', 'BATCH_RULE')).toBe('TODAY');
  });

  test('模块覆盖时返回模块值', () => {
    CONFIG.wmsConfig.MODULES = { PO: { BATCH_RULE: 'REF_NUM' } };
    expect(getModuleConfig('PO', 'BATCH_RULE')).toBe('REF_NUM');
  });

  test('模块部分覆盖时，未覆盖字段仍用全局值', () => {
    CONFIG.wmsConfig.MODULES = { PO: { BATCH_RULE: 'REF_NUM' } };
    expect(getModuleConfig('PO', 'DEFAULT_BIN_SUFFIX')).toBe('SYSTEM-BIN-LOCATION');
  });

  test('MODULES 为空对象时返回全局值', () => {
    CONFIG.wmsConfig.MODULES = {};
    expect(getModuleConfig('PO', 'BATCH_RULE')).toBe('TODAY');
  });

  test('不存在的模块返回全局值', () => {
    expect(getModuleConfig('XX', 'BATCH_RULE')).toBe('TODAY');
  });

  test('模块覆盖值为 false 时正确返回 (不被全局值覆盖)', () => {
    CONFIG.wmsConfig.MODULES = { PO: { ALLOW_OVERAGE: false } };
    CONFIG.wmsConfig.ALLOW_OVERAGE = true;
    expect(getModuleConfig('PO', 'ALLOW_OVERAGE')).toBe(false);
  });

  test('不存在的 key 返回 undefined', () => {
    expect(getModuleConfig('PO', 'NO_SUCH_KEY')).toBeUndefined();
  });
});

// ============================================================================
// getDefaultBin — 默认库位
// ============================================================================

describe('getDefaultBin — 默认库位', () => {

  test('标准: whsCode + 后缀', () => {
    expect(getDefaultBin('WH01', 'WO')).toBe('WH01-SYSTEM-BIN-LOCATION');
  });

  test('whsCode 为空回退到 SYSTEM', () => {
    expect(getDefaultBin('', 'PO')).toBe('SYSTEM-SYSTEM-BIN-LOCATION');
  });

  test('whsCode 为 null 回退到 SYSTEM', () => {
    expect(getDefaultBin(null, 'WO')).toBe('SYSTEM-SYSTEM-BIN-LOCATION');
  });

  test('自定义后缀', () => {
    CONFIG.wmsConfig.DEFAULT_BIN_SUFFIX = 'RECEIVING-BIN';
    expect(getDefaultBin('WH01', 'PO')).toBe('WH01-RECEIVING-BIN');
  });

  test('模块级后缀覆盖', () => {
    CONFIG.wmsConfig.MODULES = { PO: { DEFAULT_BIN_SUFFIX: 'PO-BIN' } };
    expect(getDefaultBin('WH01', 'PO')).toBe('WH01-PO-BIN');
    // WO 仍用全局值
    expect(getDefaultBin('WH01', 'WO')).toBe('WH01-SYSTEM-BIN-LOCATION');
  });
});

// ============================================================================
// getDefaultBatch — 默认批次号
// ============================================================================

describe('getDefaultBatch — 默认批次号', () => {

  test('TODAY 模式返回 YYYYMMDD', () => {
    var result = getDefaultBatch('WO');
    expect(result).toMatch(/^\d{8}$/);
  });

  test('REF_NUM 模式返回单据号', () => {
    CONFIG.wmsConfig.BATCH_RULE = 'REF_NUM';
    expect(getDefaultBatch('WO', 'PO-12345')).toBe('PO-12345');
  });

  test('REF_NUM 模式无单号时兜底返回 YYYYMMDD', () => {
    CONFIG.wmsConfig.BATCH_RULE = 'REF_NUM';
    var result = getDefaultBatch('WO', '');
    expect(result).toMatch(/^\d{8}$/);
  });

  test('EMPTY 模式返回空字符串', () => {
    CONFIG.wmsConfig.BATCH_RULE = 'EMPTY';
    expect(getDefaultBatch('WO')).toBe('');
  });

  test('未知规则兜底走 TODAY', () => {
    CONFIG.wmsConfig.BATCH_RULE = 'UNKNOWN';
    var result = getDefaultBatch('WO');
    expect(result).toMatch(/^\d{8}$/);
  });

  test('模块级覆盖: PO 用 REF_NUM，WO 用 TODAY', () => {
    CONFIG.wmsConfig.MODULES = { PO: { BATCH_RULE: 'REF_NUM' } };
    expect(getDefaultBatch('PO', 'PO-999')).toBe('PO-999');
    var woResult = getDefaultBatch('WO');
    expect(woResult).toMatch(/^\d{8}$/);
  });
});

// ============================================================================
// getDefaultProdDate — 默认生产日期
// ============================================================================

describe('getDefaultProdDate — 默认生产日期', () => {

  test('TODAY 模式返回 YYYYMMDD', () => {
    var result = getDefaultProdDate('WO');
    expect(result).toMatch(/^\d{8}$/);
  });

  test('EMPTY 模式返回空字符串', () => {
    CONFIG.wmsConfig.PROD_DATE_RULE = 'EMPTY';
    expect(getDefaultProdDate('WO')).toBe('');
  });

  test('未知规则兜底走 TODAY', () => {
    CONFIG.wmsConfig.PROD_DATE_RULE = 'UNKNOWN';
    var result = getDefaultProdDate('WO');
    expect(result).toMatch(/^\d{8}$/);
  });

  test('模块级覆盖: WO 用 TODAY，PO 用 EMPTY', () => {
    CONFIG.wmsConfig.MODULES = { PO: { PROD_DATE_RULE: 'EMPTY' } };
    expect(getDefaultProdDate('PO')).toBe('');
    var woResult = getDefaultProdDate('WO');
    expect(woResult).toMatch(/^\d{8}$/);
  });
});

// ============================================================================
// getReceiptDefaults — 收货默认值聚合
// ============================================================================

describe('getReceiptDefaults — 聚合函数', () => {

  test('全默认配置: bin/batch/prodDate 全有值', () => {
    var d = getReceiptDefaults('WH01', 'WO', 'WO-100');
    expect(d.bin).toBe('WH01-SYSTEM-BIN-LOCATION');
    expect(d.batch).toMatch(/^\d{8}$/);
    expect(d.prodDate).toMatch(/^\d{8}$/);
  });

  test('混合配置: PO PROD_DATE=EMPTY', () => {
    CONFIG.wmsConfig.MODULES = { PO: { PROD_DATE_RULE: 'EMPTY' } };
    var d = getReceiptDefaults('WH02', 'PO', 'PO-200');
    expect(d.bin).toBe('WH02-SYSTEM-BIN-LOCATION');
    expect(d.batch).toMatch(/^\d{8}$/);
    expect(d.prodDate).toBe('');
  });

  test('BATCH_RULE=REF_NUM + 传入 refNum', () => {
    CONFIG.wmsConfig.BATCH_RULE = 'REF_NUM';
    var d = getReceiptDefaults('WH01', 'WO', 'WO-555');
    expect(d.batch).toBe('WO-555');
  });
});

// ============================================================================
// isSystemBin — 系统库位判断
// ============================================================================

describe('isSystemBin — 系统库位过滤', () => {

  test('包含 SYSTEM-BIN 返回 true', () => {
    expect(isSystemBin('WH01-SYSTEM-BIN-LOCATION')).toBe(true);
  });

  test('精确匹配 SYSTEM-BIN 返回 true', () => {
    expect(isSystemBin('SYSTEM-BIN')).toBe(true);
  });

  test('不包含 SYSTEM-BIN 返回 false', () => {
    expect(isSystemBin('BIN-A01')).toBe(false);
  });

  test('空值返回 false', () => {
    expect(isSystemBin('')).toBe(false);
    expect(isSystemBin(null)).toBe(false);
    expect(isSystemBin(undefined)).toBe(false);
  });

  test('自定义过滤词', () => {
    CONFIG.wmsConfig.SYSTEM_BIN_FILTER = 'DEFAULT-BIN';
    expect(isSystemBin('WH01-DEFAULT-BIN')).toBe(true);
    expect(isSystemBin('WH01-SYSTEM-BIN-LOCATION')).toBe(false);
  });
});

// ============================================================================
// 向后兼容场景 — WMS_CONFIG 未配置时
// ============================================================================

describe('向后兼容 — 默认配置与 v0.1.11 一致', () => {

  test('默认 CONFIG.wmsConfig 属性值', () => {
    expect(CONFIG.wmsConfig.DEFAULT_BIN_SUFFIX).toBe('SYSTEM-BIN-LOCATION');
    expect(CONFIG.wmsConfig.BATCH_RULE).toBe('TODAY');
    expect(CONFIG.wmsConfig.PROD_DATE_RULE).toBe('TODAY');
    expect(CONFIG.wmsConfig.ALLOW_OVERAGE).toBe(false);
    expect(CONFIG.wmsConfig.SYSTEM_BIN_FILTER).toBe('SYSTEM-BIN');
    expect(CONFIG.wmsConfig.MODULES).toEqual({});
  });

  test('getDefaultBin 与 v0.1.11 硬编码等价', () => {
    // v0.1.11: (whsCode || 'SYSTEM') + '-SYSTEM-BIN-LOCATION'
    expect(getDefaultBin('1FG', 'WO')).toBe('1FG-SYSTEM-BIN-LOCATION');
    expect(getDefaultBin('', 'PO')).toBe('SYSTEM-SYSTEM-BIN-LOCATION');
  });

  test('getDefaultBatch 与 v0.1.11 getSystemYYYYMMDD 等价', () => {
    var batch = getDefaultBatch('WO');
    var yyyymmdd = getSystemYYYYMMDD();
    expect(batch).toBe(yyyymmdd);
  });

  test('getDefaultProdDate 与 v0.1.11 getSystemYYYYMMDD 等价', () => {
    var prodDate = getDefaultProdDate('WO');
    var yyyymmdd = getSystemYYYYMMDD();
    expect(prodDate).toBe(yyyymmdd);
  });
});
