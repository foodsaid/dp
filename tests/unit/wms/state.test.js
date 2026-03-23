/**
 * shared.js 状态管理 + 操作员管理 + 认证函数测试
 * 覆盖: saveState, loadState, clearState, getOperators, addOperator,
 *       getCurrentOperator, getLoginUser, getLoginUsername, checkAuth
 *
 * ADR-006 优先级 1 推荐: state.test.js
 */
const { loadSharedJs } = require('./setup');

beforeAll(() => {
  loadSharedJs();
});

// ============================================================================
// saveState / loadState / clearState — localStorage 状态管理
// ============================================================================

describe('saveState / loadState / clearState', () => {
  afterEach(() => {
    // 清除测试产生的 localStorage 项
    localStorage.removeItem('wms_test_key');
    localStorage.removeItem('wms_complex');
    localStorage.removeItem('wms_empty');
  });

  test('saveState + loadState 存取对象', () => {
    var data = { docNum: 'PO26000001', lines: [1, 2, 3] };
    saveState('test_key', data);
    var loaded = loadState('test_key');
    expect(loaded).toEqual(data);
  });

  test('saveState + loadState 存取数组', () => {
    var arr = ['WMS', 'admin', 'operator1'];
    saveState('test_key', arr);
    expect(loadState('test_key')).toEqual(arr);
  });

  test('saveState + loadState 存取简单字符串', () => {
    saveState('test_key', 'hello');
    expect(loadState('test_key')).toBe('hello');
  });

  test('saveState + loadState 存取数字', () => {
    saveState('test_key', 42);
    expect(loadState('test_key')).toBe(42);
  });

  test('saveState + loadState 存取布尔值', () => {
    saveState('test_key', true);
    expect(loadState('test_key')).toBe(true);
  });

  test('saveState + loadState 存取 null', () => {
    saveState('test_key', null);
    // JSON.stringify(null) = "null", JSON.parse("null") = null
    // 但 loadState 对 saved ? ... : null, "null" 是 truthy
    expect(loadState('test_key')).toBeNull();
  });

  test('loadState 不存在的 key 返回 null', () => {
    expect(loadState('nonexistent_key_12345')).toBeNull();
  });

  test('clearState 删除已存储的数据', () => {
    saveState('test_key', { a: 1 });
    expect(loadState('test_key')).toBeTruthy();
    clearState('test_key');
    expect(loadState('test_key')).toBeNull();
  });

  test('clearState 对不存在的 key 不报错', () => {
    expect(() => clearState('nonexistent_key')).not.toThrow();
  });

  test('key 自动添加 wms_ 前缀', () => {
    saveState('test_key', 'value');
    // 直接检查 localStorage 中的实际 key
    expect(localStorage.getItem('wms_test_key')).toBe('"value"');
    expect(localStorage.getItem('test_key')).toBeNull();
  });

  test('存取复杂嵌套对象', () => {
    var complex = {
      doc: { type: 'PO', num: '26000001' },
      lines: [
        { lineNum: 1, itemCode: 'A001', qty: 10.5 },
        { lineNum: 2, itemCode: 'B002', qty: 0 },
      ],
      meta: { locked: true, operator: 'admin' },
    };
    saveState('complex', complex);
    expect(loadState('complex')).toEqual(complex);
  });
});

// ============================================================================
// getOperators — 操作员列表管理
// ============================================================================

describe('getOperators', () => {
  afterEach(() => {
    localStorage.removeItem('wms_operators');
  });

  test('无缓存时返回默认列表 ["WMS"]', () => {
    var ops = getOperators();
    expect(ops).toEqual(['WMS']);
  });

  test('无缓存时自动保存默认列表到 localStorage', () => {
    getOperators();
    var saved = JSON.parse(localStorage.getItem('wms_operators'));
    expect(saved).toEqual(['WMS']);
  });

  test('已有操作员列表正常返回', () => {
    saveState('operators', ['WMS', 'admin', 'user1']);
    expect(getOperators()).toEqual(['WMS', 'admin', 'user1']);
  });

  test('列表中缺少 WMS 时自动补到开头', () => {
    saveState('operators', ['admin', 'user1']);
    var ops = getOperators();
    expect(ops[0]).toBe('WMS');
    expect(ops).toContain('admin');
    expect(ops).toContain('user1');
  });

  test('空数组时重置为默认列表', () => {
    saveState('operators', []);
    var ops = getOperators();
    expect(ops).toEqual(['WMS']);
  });

  test('非数组值时重置为默认列表', () => {
    saveState('operators', 'invalid');
    var ops = getOperators();
    expect(ops).toEqual(['WMS']);
  });
});

// ============================================================================
// addOperator — 添加操作员
// ============================================================================

describe('addOperator', () => {
  afterEach(() => {
    localStorage.removeItem('wms_operators');
  });

  test('添加新操作员', () => {
    addOperator('newuser');
    var ops = getOperators();
    expect(ops).toContain('newuser');
  });

  test('不重复添加已存在的操作员', () => {
    addOperator('admin');
    addOperator('admin');
    var ops = getOperators();
    var count = ops.filter(function (o) { return o === 'admin'; }).length;
    expect(count).toBe(1);
  });

  test('空名称不添加', () => {
    var before = getOperators().length;
    addOperator('');
    addOperator(null);
    addOperator(undefined);
    expect(getOperators().length).toBe(before);
  });

  test('WMS 始终存在于列表中', () => {
    addOperator('user1');
    addOperator('user2');
    var ops = getOperators();
    expect(ops[0]).toBe('WMS');
  });
});

// ============================================================================
// getCurrentOperator — 当前操作员回退逻辑
// ============================================================================

describe('getCurrentOperator', () => {
  afterEach(() => {
    localStorage.removeItem('wms_operators');
    localStorage.removeItem('wms_last_user');
    localStorage.removeItem('wms_username');
    localStorage.removeItem('wms_display_name');
  });

  test('无任何记录时回退到 "WMS"', () => {
    expect(getCurrentOperator()).toBe('WMS');
  });

  test('有 last_user 时返回 last_user', () => {
    saveState('last_user', 'operator1');
    expect(getCurrentOperator()).toBe('operator1');
  });

  test('有登录用户时优先返回登录用户名', () => {
    localStorage.setItem('wms_username', 'admin');
    saveState('last_user', 'operator1');
    expect(getCurrentOperator()).toBe('admin');
  });

  test('登录用户为 "unknown" 时回退到 last_user', () => {
    localStorage.setItem('wms_username', 'unknown');
    saveState('last_user', 'operator1');
    // getLoginUsername 返回 'unknown' 时, getCurrentOperator 应跳过
    expect(getCurrentOperator()).toBe('operator1');
  });
});

// ============================================================================
// getLoginUser — 获取显示用户名 (界面显示)
// ============================================================================

describe('getLoginUser', () => {
  afterEach(() => {
    localStorage.removeItem('wms_display_name');
    localStorage.removeItem('wms_username');
  });

  test('有 display_name 时优先返回', () => {
    localStorage.setItem('wms_display_name', '张三');
    localStorage.setItem('wms_username', 'zhangsan');
    expect(getLoginUser()).toBe('张三');
  });

  test('无 display_name 时回退到 username', () => {
    localStorage.setItem('wms_username', 'zhangsan');
    expect(getLoginUser()).toBe('zhangsan');
  });

  test('都没有时返回 "unknown"', () => {
    expect(getLoginUser()).toBe('unknown');
  });
});

// ============================================================================
// getLoginUsername — 获取用户名 (数据字段 performed_by)
// ============================================================================

describe('getLoginUsername', () => {
  afterEach(() => {
    localStorage.removeItem('wms_display_name');
    localStorage.removeItem('wms_username');
  });

  test('有 username 时优先返回', () => {
    localStorage.setItem('wms_username', 'zhangsan');
    localStorage.setItem('wms_display_name', '张三');
    expect(getLoginUsername()).toBe('zhangsan');
  });

  test('无 username 时回退到 display_name', () => {
    localStorage.setItem('wms_display_name', '张三');
    expect(getLoginUsername()).toBe('张三');
  });

  test('都没有时返回 "unknown"', () => {
    expect(getLoginUsername()).toBe('unknown');
  });
});

// ============================================================================
// checkAuth — SSO 强制认证 (始终返回 true, nginx auth_request 保护)
// ============================================================================

describe('checkAuth', () => {

  beforeEach(() => {
    document.body.className = '';
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ data: { display_name: 'user', groups: [] } })
    });
  });

  afterEach(() => {
    localStorage.removeItem('wms_username');
    document.body.className = '';
    jest.restoreAllMocks();
  });

  test('始终返回 true (SSO 强制)', () => {
    var result = checkAuth();
    expect(result).toBe(true);
  });

  test('已登录时返回 true', () => {
    localStorage.setItem('wms_username', 'admin');
    var result = checkAuth();
    expect(result).toBe(true);
  });

  test('已登录时添加 authed class (防闪屏)', () => {
    localStorage.setItem('wms_username', 'admin');
    checkAuth();
    expect(document.body.classList.contains('authed')).toBe(true);
  });

  test('未登录时也添加 authed class (SSO 已保护)', () => {
    checkAuth();
    expect(document.body.classList.contains('authed')).toBe(true);
  });
});
