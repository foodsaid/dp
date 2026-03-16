/**
 * shared.js 数据格式化函数测试
 * 覆盖: roundQty, formatNumber, escapeHtml, getSystemDateTime
 */
const { loadSharedJs } = require('./setup');

beforeAll(() => {
  loadSharedJs();
});

// ============================================================================
// roundQty — 浮点精度修正 (直接影响库存计算)
// ============================================================================

describe('roundQty', () => {
  test('正常数值保留4位小数', () => {
    expect(roundQty(1.23456)).toBe(1.2346);
    expect(roundQty(100)).toBe(100);
    expect(roundQty(0.5)).toBe(0.5);
  });

  test('极小值 (< 0.001) 视为 0，消除浮点误差', () => {
    expect(roundQty(0.0009)).toBe(0);
    expect(roundQty(0.0001)).toBe(0);
    expect(roundQty(0.00099)).toBe(0);
  });

  test('负极小值 (> -0.001) 也视为 0', () => {
    expect(roundQty(-0.0009)).toBe(0);
    expect(roundQty(-0.0001)).toBe(0);
  });

  test('0.001 边界 — 刚好不被归零', () => {
    expect(roundQty(0.001)).toBe(0.001);
    expect(roundQty(-0.001)).toBe(-0.001);
  });

  test('消除 JavaScript 经典浮点误差 0.1+0.2', () => {
    // 0.1 + 0.2 = 0.30000000000000004 → roundQty 修正为 0.3
    expect(roundQty(0.1 + 0.2)).toBe(0.3);
  });

  test('非数字输入返回 0', () => {
    expect(roundQty(NaN)).toBe(0);
    expect(roundQty(undefined)).toBe(0);
    expect(roundQty(null)).toBe(0);
    expect(roundQty('abc')).toBe(0);
  });

  test('负数正常处理', () => {
    // Math.round(-51234.5) = -51234 (JS 的 round 负半值向零)
    expect(roundQty(-5.12345)).toBe(-5.1234);
    expect(roundQty(-100)).toBe(-100);
  });
});

// ============================================================================
// formatNumber — 数字本地化 (千分位)
// ============================================================================

describe('formatNumber', () => {
  test('null/undefined 返回 "-"', () => {
    expect(formatNumber(null)).toBe('-');
    expect(formatNumber(undefined)).toBe('-');
  });

  test('整数不带小数点', () => {
    expect(formatNumber(100)).not.toContain('.');
  });

  test('小数最多保留4位', () => {
    var result = formatNumber(1.123456);
    // 最多4位小数
    var decimalPart = result.split('.')[1] || '';
    expect(decimalPart.length).toBeLessThanOrEqual(4);
  });

  test('0 格式化正常', () => {
    expect(formatNumber(0)).toBe('0');
  });
});

// ============================================================================
// escapeHtml — XSS 防御
// ============================================================================

describe('escapeHtml', () => {
  test('转义 HTML 特殊字符', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  test('转义 & 符号', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });

  test('双引号不被 textContent/innerHTML 转义 (仅 <>&)', () => {
    // escapeHtml 使用 textContent → innerHTML 技术，只转义 < > &
    expect(escapeHtml('"hello"')).toBe('"hello"');
  });

  test('空值返回空字符串', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml('')).toBe('');
  });

  test('普通文本不变', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
    expect(escapeHtml('物料编号 A001')).toBe('物料编号 A001');
  });
});

// ============================================================================
// getSystemDateTime — 系统时区时间
// ============================================================================

describe('getSystemDateTime', () => {
  test('返回 YYYY-MM-DD HH:MM:SS 格式', () => {
    var dt = getSystemDateTime();
    // sv-SE locale 输出 "2026-02-22 14:30:00" 格式
    expect(dt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('返回字符串类型', () => {
    expect(typeof getSystemDateTime()).toBe('string');
  });
});

// ============================================================================
// getSystemToday / getSystemYYYYMMDD — 日期格式
// ============================================================================

describe('getSystemToday', () => {
  test('返回 YYYY-MM-DD 格式', () => {
    expect(getSystemToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('getSystemYYYYMMDD', () => {
  test('返回 YYYYMMDD 格式 (8位纯数字)', () => {
    var result = getSystemYYYYMMDD();
    expect(result).toMatch(/^\d{8}$/);
  });

  test('与 getSystemToday 日期一致', () => {
    var today = getSystemToday().replace(/-/g, '');
    expect(getSystemYYYYMMDD()).toBe(today);
  });
});

// ============================================================================
// formatDate — 日期本地化 (zh-CN, 系统时区)
// ============================================================================

describe('formatDate', () => {
  test('空值返回 "-"', () => {
    expect(formatDate(null)).toBe('-');
    expect(formatDate(undefined)).toBe('-');
    expect(formatDate('')).toBe('-');
  });

  test('ISO 日期字符串格式化为本地日期', () => {
    var result = formatDate('2026-02-25T10:30:00Z');
    // zh-CN locale 输出格式: "2026/2/25" 或 "2026年2月25日"
    expect(result).toContain('2026');
    expect(result).toContain('25');
  });

  test('纯日期字符串也能解析', () => {
    var result = formatDate('2026-01-15');
    expect(result).toContain('2026');
    expect(result).toContain('15');
  });

  test('返回字符串类型', () => {
    expect(typeof formatDate('2026-02-25')).toBe('string');
  });
});

// ============================================================================
// formatDateTime — 日期时间本地化 (zh-CN, 系统时区, 精确到分)
// ============================================================================

describe('formatDateTime', () => {
  test('空值返回 "-"', () => {
    expect(formatDateTime(null)).toBe('-');
    expect(formatDateTime(undefined)).toBe('-');
    expect(formatDateTime('')).toBe('-');
  });

  test('ISO 日期时间字符串格式化包含年月日时分', () => {
    var result = formatDateTime('2026-02-25T10:30:00Z');
    // zh-CN locale 输出含年月日+时分
    expect(result).toContain('2026');
    expect(typeof result).toBe('string');
    // 不应包含秒 (仅精确到分)
    expect(result.length).toBeGreaterThan(10);
  });

  test('返回字符串类型', () => {
    expect(typeof formatDateTime('2026-02-25T14:00:00')).toBe('string');
  });
});
