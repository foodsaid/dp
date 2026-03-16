/**
 * shared.js 数据验证函数测试
 * 覆盖: validateRequired, validateNumber, validateItem, validateWarehouse, validateBin
 */
const { loadSharedJs, setMockConfirm } = require('./setup');

beforeAll(() => {
  loadSharedJs();
});

// ============================================================================
// validateRequired — 必填字段校验 (所有提交表单的门卫)
// ============================================================================

describe('validateRequired', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('所有字段非空 → 返回 true', () => {
    document.body.innerHTML = '<input id="f1" value="abc" /><input id="f2" value="123" />';
    expect(validateRequired([
      { id: 'f1', name: '仓库' },
      { id: 'f2', name: '操作人' },
    ])).toBe(true);
  });

  test('第一个字段为空 → 返回 false', () => {
    document.body.innerHTML = '<input id="f1" value="" /><input id="f2" value="OK" />';
    expect(validateRequired([
      { id: 'f1', name: '仓库' },
      { id: 'f2', name: '操作人' },
    ])).toBe(false);
  });

  test('第二个字段为空 → 返回 false', () => {
    document.body.innerHTML = '<input id="f1" value="OK" /><input id="f2" value="" />';
    expect(validateRequired([
      { id: 'f1', name: '仓库' },
      { id: 'f2', name: '操作人' },
    ])).toBe(false);
  });

  test('纯空格值 → 视为空 (trim 后为空)', () => {
    document.body.innerHTML = '<input id="f1" value="   " />';
    expect(validateRequired([{ id: 'f1', name: '仓库' }])).toBe(false);
  });

  test('值为 "0" (合法数字字符串) → 返回 true (不误判)', () => {
    document.body.innerHTML = '<input id="f1" value="0" />';
    expect(validateRequired([{ id: 'f1', name: '数量' }])).toBe(true);
  });

  test('DOM 元素不存在 → 跳过该字段 (不报错)', () => {
    document.body.innerHTML = '<input id="f1" value="OK" />';
    expect(validateRequired([
      { id: 'nonexistent', name: '不存在' },
      { id: 'f1', name: '仓库' },
    ])).toBe(true);
  });

  test('空字段列表 → 返回 true', () => {
    expect(validateRequired([])).toBe(true);
  });

  test('空字段获得焦点', () => {
    document.body.innerHTML = '<input id="f1" value="" />';
    var input = document.getElementById('f1');
    var focusSpy = jest.spyOn(input, 'focus');
    validateRequired([{ id: 'f1', name: '仓库' }]);
    expect(focusSpy).toHaveBeenCalled();
  });
});

// ============================================================================
// validateNumber — 数字范围校验 (所有数量输入的门卫)
// ============================================================================

describe('validateNumber', () => {
  test('有效数字在范围内 → 返回 true', () => {
    expect(validateNumber('10', 1, 100, '数量')).toBe(true);
    expect(validateNumber('1', 1, 100, '数量')).toBe(true);
    expect(validateNumber('100', 1, 100, '数量')).toBe(true);
  });

  test('非数字 → 返回 false', () => {
    expect(validateNumber('abc', 1, 100, '数量')).toBe(false);
    expect(validateNumber('', 1, 100, '数量')).toBe(false);
  });

  test('小于最小值 → 返回 false', () => {
    expect(validateNumber('0', 1, 100, '数量')).toBe(false);
    expect(validateNumber('-5', 0, 100, '数量')).toBe(false);
  });

  test('大于最大值 → 返回 false', () => {
    expect(validateNumber('101', 1, 100, '数量')).toBe(false);
    expect(validateNumber('999', 1, 100, '数量')).toBe(false);
  });

  test('无最大值限制时只检查最小值', () => {
    expect(validateNumber('999999', 1, undefined, '数量')).toBe(true);
  });

  test('无最小值限制时只检查最大值', () => {
    expect(validateNumber('-10', undefined, 100, '数量')).toBe(true);
  });

  test('浮点数正常验证', () => {
    expect(validateNumber('1.5', 1, 10, '数量')).toBe(true);
    expect(validateNumber('0.5', 1, 10, '数量')).toBe(false);
  });
});

// ============================================================================
// 主数据缓存验证 — 三态返回值 (null/object/false)
// ============================================================================

describe('validateItem / validateWarehouse / validateBin', () => {
  afterEach(() => {
    // 清除 masterdata 缓存
    localStorage.removeItem('wms_masterdata');
  });

  test('无缓存时返回 null (放行)', () => {
    expect(validateItem('A001')).toBeNull();
    expect(validateWarehouse('WH01')).toBeNull();
    expect(validateBin('BIN01')).toBeNull();
  });

  test('有缓存但找不到 → 返回 false (阻断)', () => {
    localStorage.setItem('wms_masterdata', JSON.stringify({
      items: [{ item_code: 'A001' }],
      warehouses: [{ whs_code: 'WH01' }],
      bins: [{ bin_code: 'BIN01' }],
    }));

    expect(validateItem('NOTEXIST')).toBe(false);
    expect(validateWarehouse('NOTEXIST')).toBe(false);
    expect(validateBin('NOTEXIST')).toBe(false);
  });

  test('有缓存且找到 → 返回对象', () => {
    localStorage.setItem('wms_masterdata', JSON.stringify({
      items: [{ item_code: 'A001', item_name: '测试物料' }],
      warehouses: [{ whs_code: 'WH01', whs_name: '主仓库' }],
      bins: [{ bin_code: 'BIN01', bin_name: '库位1' }],
    }));

    var item = validateItem('A001');
    expect(item).toBeTruthy();
    expect(item.item_code).toBe('A001');

    var whs = validateWarehouse('WH01');
    expect(whs).toBeTruthy();
    expect(whs.whs_code).toBe('WH01');

    var bin = validateBin('BIN01');
    expect(bin).toBeTruthy();
    expect(bin.bin_code).toBe('BIN01');
  });

  test('大小写不敏感匹配', () => {
    localStorage.setItem('wms_masterdata', JSON.stringify({
      items: [{ item_code: 'A001' }],
      warehouses: [{ whs_code: 'WH01' }],
      bins: [{ bin_code: 'BIN-01' }],
    }));

    expect(validateItem('a001')).toBeTruthy();
    expect(validateWarehouse('wh01')).toBeTruthy();
    expect(validateBin('bin-01')).toBeTruthy();
  });
});

// ============================================================================
// validateOverQty — 超量校验 (关键: 直接影响库存准确性)
// ============================================================================

describe('validateOverQty', () => {
  beforeEach(() => {
    // 创建备注输入框
    document.body.innerHTML = '<input id="testRemark" value="" />';
    // confirm 默认返回 true (setup.js 已设置)
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('数量未超过剩余 + confirm 确认 → 返回 true', () => {
    // qty=5, remaining=10, confirm 默认 true
    expect(validateOverQty(5, 10, '', 'testRemark', '确认提交?')).toBe(true);
  });

  test('数量等于剩余 + confirm 确认 → 返回 true', () => {
    expect(validateOverQty(10, 10, '', 'testRemark', '确认提交?')).toBe(true);
  });

  test('超量但无备注 → 返回 false (要求填写原因)', () => {
    expect(validateOverQty(15, 10, '', 'testRemark', '确认提交?')).toBe(false);
  });

  test('超量且有备注 + confirm 确认 → 返回 true', () => {
    expect(validateOverQty(15, 10, '客户同意超收', 'testRemark', '确认提交?')).toBe(true);
  });

  test('超量且有备注 + confirm 拒绝 → 返回 false', () => {
    setMockConfirm(false);
    expect(validateOverQty(15, 10, '客户同意', 'testRemark', '确认提交?')).toBe(false);
    setMockConfirm(true);
  });

  test('正常数量 + confirm 拒绝 → 返回 false', () => {
    setMockConfirm(false);
    expect(validateOverQty(5, 10, '', 'testRemark', '确认提交?')).toBe(false);
    setMockConfirm(true);
  });

  test('剩余为 0 时不触发超量逻辑', () => {
    // remaining=0 时 qty>remaining 但 remaining<=0，不走超量分支
    expect(validateOverQty(5, 0, '', 'testRemark', '确认提交?')).toBe(true);
  });

  test('浮点精度: roundQty 修正后不超量', () => {
    // 0.1+0.2=0.30000000000000004 → roundQty 修正为 0.3
    expect(validateOverQty(0.3, 0.1 + 0.2, '', 'testRemark', '确认?')).toBe(true);
  });

  test('超量且无备注时: 备注输入框获得焦点', () => {
    document.body.innerHTML = '<input id="remarkFocus" />';
    var el = document.getElementById('remarkFocus');
    var spy = jest.spyOn(el, 'focus');
    validateOverQty(15, 10, '', 'remarkFocus', '确认?');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  test('超量且无备注时: 备注元素不存在也不报错', () => {
    document.body.innerHTML = '';
    expect(() => validateOverQty(15, 10, '', 'noSuchId', '确认?')).not.toThrow();
  });

  test('负数剩余视为 ≤ 0: 不走超量分支', () => {
    expect(validateOverQty(5, -1, '', 'testRemark', '确认?')).toBe(true);
  });
});
