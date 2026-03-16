/**
 * login.js 登录页业务逻辑剥离测试
 * 覆盖: 输入校验 / 密码哈希 / HTTPS 重定向检测 / 已登录跳转检测
 *
 * SSO 强制化后: parseLoginResponse / isSSOMode / doLogin / showError 已移除
 * 纯函数通过 require() 直接导入，无需 DOM 环境
 */

const {
  validateLoginInput,
  needsHttpsRedirect,
  isAlreadyLoggedIn,
  getLoginEnv,
  hashPassword,
} = require('../../../apps/wms/login');

// ============================================================================
// validateLoginInput — 登录表单校验
// ============================================================================

describe('validateLoginInput — 登录表单校验', () => {

  test('用户名和密码都有值时通过', () => {
    var result = validateLoginInput('admin', '123456');
    expect(result.valid).toBe(true);
  });

  test('用户名为空时不通过', () => {
    var result = validateLoginInput('', '123456');
    expect(result.valid).toBe(false);
    expect(result.message).toBeDefined();
  });

  test('密码为空时不通过', () => {
    var result = validateLoginInput('admin', '');
    expect(result.valid).toBe(false);
    expect(result.message).toBeDefined();
  });

  test('用户名和密码都为空时不通过', () => {
    var result = validateLoginInput('', '');
    expect(result.valid).toBe(false);
  });

  test('null/undefined 也不通过', () => {
    expect(validateLoginInput(null, '123').valid).toBe(false);
    expect(validateLoginInput('admin', null).valid).toBe(false);
    expect(validateLoginInput(undefined, undefined).valid).toBe(false);
  });

  test('数字 0 和 false 视为无效输入 (falsy)', () => {
    expect(validateLoginInput(0, '123').valid).toBe(false);
    expect(validateLoginInput('admin', 0).valid).toBe(false);
    expect(validateLoginInput(false, false).valid).toBe(false);
  });

  test('有效输入时 message 字段不存在', () => {
    var result = validateLoginInput('admin', 'secret');
    expect(result.valid).toBe(true);
    expect(result.message).toBeUndefined();
  });
});

// ============================================================================
// needsHttpsRedirect — HTTPS 检测
// ============================================================================

describe('needsHttpsRedirect — HTTPS 重定向检测', () => {

  test('http + 非本地域名需要重定向', () => {
    expect(needsHttpsRedirect('http:', 'example.com')).toBe(true);
  });

  test('http + localhost 不需要重定向', () => {
    expect(needsHttpsRedirect('http:', 'localhost')).toBe(false);
  });

  test('http + 127.0.0.1 不需要重定向', () => {
    expect(needsHttpsRedirect('http:', '127.0.0.1')).toBe(false);
  });

  test('https 不需要重定向', () => {
    expect(needsHttpsRedirect('https:', 'example.com')).toBe(false);
  });

  test('https + localhost 不需要重定向', () => {
    expect(needsHttpsRedirect('https:', 'localhost')).toBe(false);
  });

  test('http + 子域名需要重定向', () => {
    expect(needsHttpsRedirect('http:', 'wms.company.com')).toBe(true);
    expect(needsHttpsRedirect('http:', '192.168.1.100')).toBe(true);
  });
});

// ============================================================================
// isAlreadyLoggedIn — 已登录检测
// ============================================================================

describe('isAlreadyLoggedIn — 已登录跳转检测', () => {

  test('有用户名且无 relogin 参数时已登录', () => {
    expect(isAlreadyLoggedIn('admin', '')).toBe(true);
  });

  test('有用户名但有 relogin 参数时不算已登录', () => {
    expect(isAlreadyLoggedIn('admin', '?relogin')).toBe(false);
    expect(isAlreadyLoggedIn('admin', '?relogin=1')).toBe(false);
  });

  test('无用户名时不算已登录', () => {
    expect(isAlreadyLoggedIn(null, '')).toBe(false);
    expect(isAlreadyLoggedIn('', '')).toBe(false);
  });

  test('relogin 嵌在其他参数中也能识别', () => {
    expect(isAlreadyLoggedIn('admin', '?foo=1&relogin=true')).toBe(false);
    expect(isAlreadyLoggedIn('admin', '?from=page&relogin')).toBe(false);
  });

  test('search 含无关参数时算已登录', () => {
    expect(isAlreadyLoggedIn('admin', '?lang=zh')).toBe(true);
    expect(isAlreadyLoggedIn('admin', '?debug=1')).toBe(true);
  });
});

// ============================================================================
// getLoginEnv — 环境变量读取
// ============================================================================

describe('getLoginEnv — 环境变量读取', () => {

  test('window.__ENV 存在时读取 API_BASE_URL', () => {
    window.__ENV = { API_BASE_URL: '/api/wms' };
    var env = getLoginEnv();
    expect(env.N8N_BASE).toBe('/api/wms');
  });

  test('window.__ENV 不存在时返回空字符串', () => {
    delete window.__ENV;
    var env = getLoginEnv();
    expect(env.N8N_BASE).toBe('');
  });

  test('window.__ENV 存在但无 API_BASE_URL 时返回空字符串', () => {
    window.__ENV = { OTHER_KEY: 'value' };
    var env = getLoginEnv();
    expect(env.N8N_BASE).toBe('');
  });

  test('window.__ENV 为空对象时返回空字符串', () => {
    window.__ENV = {};
    var env = getLoginEnv();
    expect(env.N8N_BASE).toBe('');
  });

  afterEach(() => {
    // 恢复
    window.__ENV = { API_BASE_URL: '/api/wms' };
  });
});

// ============================================================================
// hashPassword — SHA-256 哈希 (Web Crypto API)
// ============================================================================

describe('hashPassword — SHA-256 密码哈希', () => {

  // jsdom 的 crypto.subtle 为 undefined，需要补充 mock
  // 补充而非覆盖 — 保留 Node 20 原生 crypto 其他属性
  var _origSubtle;

  beforeAll(() => {
    _origSubtle = globalThis.crypto ? globalThis.crypto.subtle : undefined;
    if (!globalThis.crypto) {
      Object.defineProperty(globalThis, 'crypto', {
        value: {},
        configurable: true
      });
    }
    if (!globalThis.crypto.subtle) {
      // 真实 SHA-256 实现 (Node.js built-in)
      var nodeCrypto = require('crypto');
      globalThis.crypto.subtle = {
        digest: function(algo, data) {
          var hash = nodeCrypto.createHash('sha256');
          hash.update(Buffer.from(data));
          return Promise.resolve(hash.digest().buffer);
        }
      };
    }
    // jsdom 可能没有 TextEncoder/Uint8Array 全局
    if (typeof globalThis.TextEncoder === 'undefined') {
      var { TextEncoder } = require('util');
      globalThis.TextEncoder = TextEncoder;
    }
  });

  afterAll(() => {
    // 恢复原始状态，防止 mock 泄漏到其他测试文件
    if (_origSubtle === undefined && globalThis.crypto) {
      delete globalThis.crypto.subtle;
    }
  });

  test('返回 64 字符十六进制字符串', async () => {
    var hash = await hashPassword('test123');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('相同密码产生相同哈希', async () => {
    var hash1 = await hashPassword('admin');
    var hash2 = await hashPassword('admin');
    expect(hash1).toBe(hash2);
  });

  test('不同密码产生不同哈希', async () => {
    var hash1 = await hashPassword('password1');
    var hash2 = await hashPassword('password2');
    expect(hash1).not.toBe(hash2);
  });

  test('空字符串也能产生有效哈希', async () => {
    var hash = await hashPassword('');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('中文密码产生有效哈希', async () => {
    var hash = await hashPassword('密码测试');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('crypto.subtle 不可用时抛出 HTTPS_REQUIRED', async () => {
    var origCrypto = global.crypto;
    Object.defineProperty(global, 'crypto', {
      value: { subtle: null },
      configurable: true
    });
    await expect(hashPassword('test')).rejects.toThrow('HTTPS_REQUIRED');
    Object.defineProperty(global, 'crypto', {
      value: origCrypto,
      configurable: true
    });
  });
});
