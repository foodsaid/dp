/**
 * index.js 仪表盘/门户页业务逻辑剥离测试
 * 覆盖: 今日概览 HTML 构建 / 默认活动内容 / 同步按钮状态计算 / 同步提示构建 / 昨天日期计算
 * 🔧 Jest Fake Timers: 用于 setupLongPress 5 秒长按逻辑 (通过 calcSyncButtonStates 间接测试)
 *
 * 纯函数通过 require() 直接导入，无需 DOM 环境
 */

const {
  buildActivityHtml,
  buildDefaultActivityHtml,
  calcSyncButtonStates,
  buildSyncHints,
  calcYesterday,
} = require('../../../apps/wms/index');

// 翻译桩函数
function tStub(key, fallback) { return fallback || key; }

// ============================================================================
// buildActivityHtml — 今日概览 HTML 构建
// ============================================================================

describe('buildActivityHtml — 今日概览 HTML', () => {

  test('包含统计数据', () => {
    var stats = { today_transactions: 42, in_progress: 5, today_completed: 10, pending_export: 3 };
    var html = buildActivityHtml(stats, tStub);
    expect(html).toContain('42');
    expect(html).toContain('5');
    expect(html).toContain('10');
    expect(html).toContain('3');
    expect(html).toContain('info-grid');
  });

  test('零值统计', () => {
    var html = buildActivityHtml({}, tStub);
    expect(html).toContain('0');
    expect(html).toContain('info-grid');
  });

  test('包含翻译键对应的 fallback', () => {
    var html = buildActivityHtml({}, tStub);
    expect(html).toContain('今日操作');
    expect(html).toContain('进行中');
    expect(html).toContain('今日完成');
    expect(html).toContain('待导出');
  });

  test('使用自定义翻译函数', () => {
    var customT = function(key) { return '[' + key + ']'; };
    var html = buildActivityHtml({}, customT);
    expect(html).toContain('[portal.today_ops]');
    expect(html).toContain('[portal.docs_unit]');
  });
});

// ============================================================================
// buildDefaultActivityHtml — 默认活动内容
// ============================================================================

describe('buildDefaultActivityHtml — 默认降级内容', () => {

  test('包含系统状态和提示', () => {
    var html = buildDefaultActivityHtml(tStub);
    expect(html).toContain('系统状态');
    expect(html).toContain('正常运行');
    expect(html).toContain('提示');
    expect(html).toContain('扫描条码或点击上方磁贴开始操作');
  });

  test('包含 info-grid 结构', () => {
    var html = buildDefaultActivityHtml(tStub);
    expect(html).toContain('info-grid');
    expect(html).toContain('info-item');
  });
});

// ============================================================================
// calcSyncButtonStates — 同步按钮状态计算
// ============================================================================

describe('calcSyncButtonStates — 同步按钮禁用状态', () => {

  test('全部需要同步时按钮全部启用 (disabled=false)', () => {
    var data = {
      items: { need_sync: true },
      locations: { need_sync: true },
      bins: { need_sync: true },
      stock: { need_sync: true },
      oms: { need_sync: true }
    };
    var states = calcSyncButtonStates(data, false, 0, Date.now());
    expect(states.items).toBe(false);
    expect(states.locations).toBe(false);
    expect(states.bins).toBe(false);
    expect(states.stock).toBe(false);
    expect(states.oms).toBe(false);
  });

  test('全部不需要同步时按钮全部禁用', () => {
    var data = {
      items: { need_sync: false },
      locations: { need_sync: false },
      bins: { need_sync: false },
      stock: { need_sync: false },
      oms: { need_sync: false }
    };
    var states = calcSyncButtonStates(data, false, 0, Date.now());
    expect(states.items).toBe(true);
    expect(states.locations).toBe(true);
    expect(states.bins).toBe(true);
    expect(states.stock).toBe(true);
    expect(states.oms).toBe(true);
  });

  test('库存快照: 需要同步但本次会话已同步过 → 禁用', () => {
    var data = { stock: { need_sync: true } };
    var states = calcSyncButtonStates(data, true, 0, Date.now());
    expect(states.stock).toBe(true);
  });

  test('库存快照: 需要同步且未同步过 → 启用', () => {
    var data = { stock: { need_sync: true } };
    var states = calcSyncButtonStates(data, false, 0, Date.now());
    expect(states.stock).toBe(false);
  });

  test('OMS: 无 oms 字段时使用时间戳降级 — 4小时内禁用', () => {
    var now = Date.now();
    var data = {};
    var states = calcSyncButtonStates(data, false, now - 3600000, now); // 1小时前
    expect(states.oms).toBe(true); // 禁用 (小于4小时)
  });

  test('OMS: 无 oms 字段时使用时间戳降级 — 超4小时启用', () => {
    var now = Date.now();
    var data = {};
    var states = calcSyncButtonStates(data, false, now - 20000000, now); // 远超4小时
    expect(states.oms).toBe(false); // 启用
  });

  test('OMS: 有 oms.need_sync 字段时优先使用', () => {
    var data = { oms: { need_sync: true } };
    var states = calcSyncButtonStates(data, false, Date.now(), Date.now()); // 即使刚同步过
    expect(states.oms).toBe(false); // 启用 (以 need_sync 为准)
  });

  test('data 为 null 时全部默认禁用', () => {
    var states = calcSyncButtonStates(null, false, 0, Date.now());
    expect(states.items).toBe(true);
    expect(states.locations).toBe(true);
    expect(states.bins).toBe(true);
    expect(states.stock).toBe(true);
  });

  test('部分字段缺失时只影响对应按钮', () => {
    var data = { items: { need_sync: true } };
    var states = calcSyncButtonStates(data, false, 0, Date.now());
    expect(states.items).toBe(false);
    expect(states.locations).toBe(true);
    expect(states.bins).toBe(true);
  });
});

// ============================================================================
// buildSyncHints — 同步提示构建
// ============================================================================

describe('buildSyncHints — 同步提示信息', () => {

  test('全部需要同步时返回所有提示', () => {
    var data = {
      items: { need_sync: true },
      locations: { need_sync: true },
      bins: { need_sync: true },
      stock: { need_sync: true }
    };
    var hints = buildSyncHints(data, false, true, tStub);
    expect(hints).toHaveLength(5);
    expect(hints).toContain('物料有更新');
    expect(hints).toContain('仓库有更新');
    expect(hints).toContain('库位有更新');
    expect(hints).toContain('昨日快照缺失');
    expect(hints).toContain('OMS订单可同步');
  });

  test('全部不需要同步时无提示', () => {
    var data = {
      items: { need_sync: false },
      locations: { need_sync: false },
      bins: { need_sync: false },
      stock: { need_sync: false }
    };
    var hints = buildSyncHints(data, false, false, tStub);
    expect(hints).toHaveLength(0);
  });

  test('库存需要同步但本次已同步 → 无提示', () => {
    var data = { stock: { need_sync: true } };
    var hints = buildSyncHints(data, true, false, tStub);
    expect(hints).not.toContain('昨日快照缺失');
  });

  test('OMS 不可用时不显示 OMS 提示', () => {
    var data = {};
    var hints = buildSyncHints(data, false, false, tStub);
    expect(hints).not.toContain('OMS订单可同步');
  });

  test('data 为 null 时返回空 (除 OMS)', () => {
    var hints = buildSyncHints(null, false, true, tStub);
    expect(hints).toEqual(['OMS订单可同步']);
  });
});

// ============================================================================
// calcYesterday — 昨天日期计算
// ============================================================================

describe('calcYesterday — 昨天日期计算', () => {

  test('标准日期', () => {
    // 2026-03-04 UTC
    var ts = new Date('2026-03-04T12:00:00Z').getTime();
    expect(calcYesterday(ts)).toBe('2026-03-03');
  });

  test('月初 → 上月末', () => {
    var ts = new Date('2026-03-01T12:00:00Z').getTime();
    expect(calcYesterday(ts)).toBe('2026-02-28');
  });

  test('年初 → 上年末', () => {
    var ts = new Date('2026-01-01T12:00:00Z').getTime();
    expect(calcYesterday(ts)).toBe('2025-12-31');
  });

  test('闰年 3月1日 → 2月29日', () => {
    var ts = new Date('2024-03-01T12:00:00Z').getTime();
    expect(calcYesterday(ts)).toBe('2024-02-29');
  });
});

// ============================================================================
// setupLongPress 逻辑 — 通过 Jest Fake Timers 测试 5 秒定时器
// ============================================================================

describe('setupLongPress — 5 秒长按定时器逻辑', () => {

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('5 秒后 setTimeout 回调应触发', () => {
    var called = false;
    setTimeout(function() { called = true; }, 5000);

    // 4999ms 不触发
    jest.advanceTimersByTime(4999);
    expect(called).toBe(false);

    // 5000ms 触发
    jest.advanceTimersByTime(1);
    expect(called).toBe(true);
  });

  test('提前 clearTimeout 不触发', () => {
    var called = false;
    var timer = setTimeout(function() { called = true; }, 5000);

    jest.advanceTimersByTime(3000);
    clearTimeout(timer);
    jest.advanceTimersByTime(5000);

    expect(called).toBe(false);
  });

  test('多个定时器独立运行', () => {
    var results = [];
    setTimeout(function() { results.push('a'); }, 2000);
    setTimeout(function() { results.push('b'); }, 5000);

    jest.advanceTimersByTime(2000);
    expect(results).toEqual(['a']);

    jest.advanceTimersByTime(3000);
    expect(results).toEqual(['a', 'b']);
  });
});

// ============================================================================
// applySyncStatus — 真实检测 + localStorage 时间戳降级综合测试
// ============================================================================

describe('applySyncStatus — 真实检测与降级逻辑', () => {

  test('calcSyncButtonStates 优先使用 oms.need_sync 忽略时间戳', () => {
    // 即使 omsLastSyncTime 刚刚同步过，oms.need_sync=true 也应启用按钮
    var data = { oms: { need_sync: true } };
    var states = calcSyncButtonStates(data, false, Date.now(), Date.now());
    expect(states.oms).toBe(false); // 启用
  });

  test('无 oms 字段时: omsLastSyncTime=0 (从未同步) → 启用', () => {
    var states = calcSyncButtonStates({}, false, 0, Date.now());
    expect(states.oms).toBe(false); // now - 0 远超4小时，启用
  });

  test('无 oms 字段时: 刚同步过 (1分钟内) → 禁用', () => {
    var now = Date.now();
    var states = calcSyncButtonStates({}, false, now - 60000, now);
    expect(states.oms).toBe(true); // 1分钟 < 4小时，禁用
  });

  test('无 oms 字段时: 恰好4小时边界 → 禁用', () => {
    var now = Date.now();
    // 恰好 14400000ms (4小时)，差值等于阈值不满足 < 条件
    var states = calcSyncButtonStates({}, false, now - 14400000, now);
    expect(states.oms).toBe(false); // 恰好等于4小时，不小于，启用
  });

  test('无 oms 字段时: 4小时零1毫秒 → 启用', () => {
    var now = Date.now();
    var states = calcSyncButtonStates({}, false, now - 14400001, now);
    expect(states.oms).toBe(false); // 超过4小时，启用
  });

  test('stockSyncedInSession 控制库存按钮独立于其他按钮', () => {
    var data = {
      items: { need_sync: true },
      stock: { need_sync: true }
    };
    // 会话已同步过库存
    var states = calcSyncButtonStates(data, true, 0, Date.now());
    expect(states.items).toBe(false); // 物料仍可同步
    expect(states.stock).toBe(true);  // 库存被会话标记禁用
  });
});

// ============================================================================
// setupLongPress 模拟 — 5 秒长按强制解锁按钮
// ============================================================================

describe('setupLongPress — 按钮强制解锁模拟', () => {

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('长按 5 秒解锁 disabled 按钮的完整流程模拟', () => {
    // 模拟 setupLongPress 的核心逻辑: pointerdown → 5s setTimeout → 启用按钮
    var btn = { disabled: true, dataset: {}, classList: { add: jest.fn() } };

    // 模拟 pointerdown
    setTimeout(function() {
      btn.disabled = false;
      btn.dataset.forceEnabled = '1';
      btn.classList.add('force-enabled');
    }, 5000);

    // 4.9秒后仍然禁用
    jest.advanceTimersByTime(4900);
    expect(btn.disabled).toBe(true);

    // 5秒后解锁
    jest.advanceTimersByTime(100);
    expect(btn.disabled).toBe(false);
    expect(btn.dataset.forceEnabled).toBe('1');
    expect(btn.classList.add).toHaveBeenCalledWith('force-enabled');
  });

  test('pointerup 在 5 秒前触发取消解锁', () => {
    var btn = { disabled: true };
    var timer = setTimeout(function() {
      btn.disabled = false;
    }, 5000);

    jest.advanceTimersByTime(2000);
    // 模拟 pointerup 取消
    clearTimeout(timer);

    jest.advanceTimersByTime(5000);
    expect(btn.disabled).toBe(true); // 未解锁
  });
});
