/**
 * lang.js 多语言引擎 — 变态级边界测试矩阵
 *
 * 测试分层:
 *   A. resolveTranslation — 纯字典寻址 + 降级匹配 (零 DOM)
 *   B. interpolate — 纯字符串插值 (零 DOM)
 *   C. t() — 对外翻译 API (委托纯引擎)
 *   D. tpl() — 模板翻译 API (委托 t + interpolate)
 *   E. setLang / getLang — 语言切换 + 持久化
 *   F. applyI18n — DOM 渲染层
 */

const {
  I18N,
  resolveTranslation,
  interpolate,
  t,
  tpl,
  getLang,
  setLang,
  applyI18n,
  createLangSwitcher,
} = require('../../../apps/wms/lang.js');

// ============================================================================
// A. resolveTranslation 纯引擎
// ============================================================================

describe('resolveTranslation (纯字典寻址)', () => {
  var dict = {
    'hello': { zh: '你好', en: 'Hello', th: 'สวัสดี', my: 'မင်္ဂလာပါ' },
    'only_zh': { zh: '仅中文' },
    'only_en': { en: 'English only' },
    'only_th': { th: 'ภาษาไทยเท่านั้น' },
    'zh_en': { zh: '中英', en: 'ZH-EN' },
    'empty_entry': {},
    'null_val': { zh: null, en: 'fallback-en' },
    'empty_str': { zh: '', en: '', th: 'ไทย' },
    'empty_zh_has_en': { 'zh-CN': '', zh: '', en: 'English FB' },
  };

  // — 完美匹配 —
  test('完美匹配 — 4 语言精确命中', () => {
    expect(resolveTranslation(dict, 'zh', 'hello')).toBe('你好');
    expect(resolveTranslation(dict, 'en', 'hello')).toBe('Hello');
    expect(resolveTranslation(dict, 'th', 'hello')).toBe('สวัสดี');
    expect(resolveTranslation(dict, 'my', 'hello')).toBe('မင်္ဂလာပါ');
  });

  // — 一层降级: region → base —
  test('一层降级 — zh-CN → zh', () => {
    expect(resolveTranslation(dict, 'zh-CN', 'hello')).toBe('你好');
  });

  test('一层降级 — en-US → en', () => {
    expect(resolveTranslation(dict, 'en-US', 'hello')).toBe('Hello');
  });

  test('一层降级 — th-TH → th', () => {
    expect(resolveTranslation(dict, 'th-TH', 'hello')).toBe('สวัสดี');
  });

  // — 二层降级: 目标+base 都不存在 → en —
  test('二层降级 — 目标语言和 base 都不存在 → en', () => {
    expect(resolveTranslation(dict, 'th', 'only_en')).toBe('English only');
  });

  test('二层降级 — fr-CA (无 fr 无此 lang entry) → en', () => {
    expect(resolveTranslation(dict, 'fr-CA', 'only_en')).toBe('English only');
  });

  test('二层降级 — 完全不匹配的语言 → en', () => {
    expect(resolveTranslation(dict, 'ja', 'zh_en')).toBe('ZH-EN');
  });

  // — 终极兜底: en 也没有 → key —
  test('终极兜底 — lang=en 但 entry 只有 th → 返回 key', () => {
    // only_th = { th: '...' }, lang='en': exact(en)=无 → base=无 → en fallback=无 → key
    expect(resolveTranslation(dict, 'en', 'only_th')).toBe('only_th');
  });

  test('终极兜底 — lang=th 但 entry 只有 zh → en 也无 → 返回 key', () => {
    // only_zh = { zh: '仅中文' }, lang='th': exact(th)=无 → base=无 → en=无 → key
    expect(resolveTranslation(dict, 'th', 'only_zh')).toBe('only_zh');
  });

  // — Key 不存在 —
  test('Key 完全不存在 → 返回 key 字符串', () => {
    expect(resolveTranslation(dict, 'zh', 'nonexistent.key')).toBe('nonexistent.key');
  });

  // — 字典异常 —
  test('dict 为 null → 返回 key', () => {
    expect(resolveTranslation(null, 'zh', 'hello')).toBe('hello');
  });

  test('dict 为 undefined → 返回 key', () => {
    expect(resolveTranslation(undefined, 'zh', 'hello')).toBe('hello');
  });

  test('dict 为空对象 {} → 返回 key', () => {
    expect(resolveTranslation({}, 'zh', 'hello')).toBe('hello');
  });

  test('dict 为非对象 (string) → 返回 key', () => {
    expect(resolveTranslation('not-a-dict', 'zh', 'hello')).toBe('hello');
  });

  test('dict 为非对象 (number) → 返回 key', () => {
    expect(resolveTranslation(42, 'zh', 'hello')).toBe('hello');
  });

  // — Entry 异常 —
  test('entry 为空对象 {} → 返回 key', () => {
    expect(resolveTranslation(dict, 'zh', 'empty_entry')).toBe('empty_entry');
  });

  test('entry 中某语言为 null → 跳过并降级', () => {
    // zh 为 null → 跳过 → en = 'fallback-en'
    expect(resolveTranslation(dict, 'zh', 'null_val')).toBe('fallback-en');
  });

  // — 空字符串翻译降级 (架构师补丁 #3) —
  test('空字符串翻译视为未翻译 → 跳过并继续降级', () => {
    // zh='' → en='' → th='ไทย' (但 th 不在降级链中)
    // 降级链: exact(zh='') → en(='') → 返回 key
    expect(resolveTranslation(dict, 'zh', 'empty_str')).toBe('empty_str');
    // th 直接命中
    expect(resolveTranslation(dict, 'th', 'empty_str')).toBe('ไทย');
  });

  test('zh-CN 空串 → zh 空串 → en 有值 → 返回 en', () => {
    expect(resolveTranslation(dict, 'zh-CN', 'empty_zh_has_en')).toBe('English FB');
  });

  // — lang 异常 —
  test('lang 为 null → 跳过精确匹配 → en 兜底', () => {
    expect(resolveTranslation(dict, null, 'only_en')).toBe('English only');
  });

  test('lang 为 undefined → en 兜底', () => {
    expect(resolveTranslation(dict, undefined, 'only_en')).toBe('English only');
  });

  test('lang 为空字符串 → en 兜底', () => {
    expect(resolveTranslation(dict, '', 'only_en')).toBe('English only');
  });

  // — key 异常 —
  test('key 为空字符串 → 返回空字符串', () => {
    expect(resolveTranslation(dict, 'zh', '')).toBe('');
  });

  test('key 为 null → 返回空字符串', () => {
    expect(resolveTranslation(dict, 'zh', null)).toBe('');
  });

  test('key 为 undefined → 返回空字符串', () => {
    expect(resolveTranslation(dict, 'zh', undefined)).toBe('');
  });

  // — 仅有非降级链语言 —
  test('仅有 th 翻译, lang=zh → en 也没有 → 返回 key', () => {
    expect(resolveTranslation(dict, 'zh', 'only_th')).toBe('only_th');
  });
});

// ============================================================================
// B. interpolate 纯字符串插值
// ============================================================================

describe('interpolate (纯字符串插值)', () => {
  // — 正常替换 —
  test('正常替换 {0}, {1}, {2}', () => {
    expect(interpolate('共 {0} 种物料, {1} 条明细 | 合计: {2}', [5, 12, '100.00']))
      .toBe('共 5 种物料, 12 条明细 | 合计: 100.00');
  });

  test('单占位符 {0}', () => {
    expect(interpolate('Hello {0}!', ['World'])).toBe('Hello World!');
  });

  test('无占位符 → 原文返回', () => {
    expect(interpolate('No placeholders here', ['a', 'b'])).toBe('No placeholders here');
  });

  // — 全局替换 (架构师补丁 #1) —
  test('重复占位符 {0} 出现两次 → 全部替换', () => {
    expect(interpolate('{0} and {0}', ['X'])).toBe('X and X');
  });

  test('重复占位符 {1} 出现三次', () => {
    expect(interpolate('{0}: {1}/{1}/{1}', ['prefix', 'val']))
      .toBe('prefix: val/val/val');
  });

  // — args 长度不足 —
  test('args 长度不足 → 保留未匹配占位符', () => {
    expect(interpolate('{0} and {1}', ['a'])).toBe('a and {1}');
  });

  // — args 长度过多 —
  test('args 长度过多 → 忽略多余', () => {
    expect(interpolate('{0}', ['a', 'b', 'c'])).toBe('a');
  });

  // — Falsy 值类型安全 (架构师补丁 #2) —
  test('args 含 null → 替换为空字符串', () => {
    expect(interpolate('{0}', [null])).toBe('');
  });

  test('args 含 undefined → 替换为空字符串', () => {
    expect(interpolate('{0}', [undefined])).toBe('');
  });

  test('args 含数字 0 → 替换为 "0" (不是空字符串)', () => {
    expect(interpolate('库存: {0}', [0])).toBe('库存: 0');
  });

  test('args 含 false → 替换为 "false" (不是空字符串)', () => {
    expect(interpolate('状态: {0}', [false])).toBe('状态: false');
  });

  test('args 含空字符串 → 替换为空字符串', () => {
    expect(interpolate('[{0}]', [''])).toBe('[]');
  });

  // — text 异常 —
  test('text 为 null → 返回空字符串', () => {
    expect(interpolate(null, ['a'])).toBe('');
  });

  test('text 为 undefined → 返回空字符串', () => {
    expect(interpolate(undefined, ['a'])).toBe('');
  });

  test('text 为数字 → 返回空字符串', () => {
    expect(interpolate(42, ['a'])).toBe('');
  });

  test('text 为布尔值 → 返回空字符串', () => {
    expect(interpolate(true, ['a'])).toBe('');
  });

  // — args 异常 —
  test('args 为 null → 返回原文', () => {
    expect(interpolate('hello {0}', null)).toBe('hello {0}');
  });

  test('args 为 undefined → 返回原文', () => {
    expect(interpolate('hello {0}', undefined)).toBe('hello {0}');
  });

  test('args 非数组 (对象) → 返回原文', () => {
    expect(interpolate('hello {0}', { 0: 'a' })).toBe('hello {0}');
  });

  test('args 非数组 (字符串) → 返回原文', () => {
    expect(interpolate('hello {0}', 'a')).toBe('hello {0}');
  });

  test('args 为空数组 → 返回原文', () => {
    expect(interpolate('hello {0}', [])).toBe('hello {0}');
  });
});

// ============================================================================
// C. t() 对外翻译 API
// ============================================================================

describe('t() 翻译 API', () => {
  beforeEach(() => {
    setLang('zh');
  });

  test('存在的 key → 返回当前语言翻译', () => {
    expect(t('app.title')).toBe(I18N['app.title'].zh);
  });

  test('切换语言后 → 返回新语言翻译', () => {
    setLang('en');
    expect(t('app.title')).toBe(I18N['app.title'].en);
  });

  test('不存在 key + 有 fallback → 返回 fallback', () => {
    expect(t('totally.missing.key', '默认文本')).toBe('默认文本');
  });

  test('不存在 key + 无 fallback → 返回 key 字符串', () => {
    expect(t('totally.missing.key')).toBe('totally.missing.key');
  });

  test('切换到 th → 返回泰语', () => {
    setLang('th');
    expect(t('app.title')).toBe(I18N['app.title'].th);
  });

  test('切换到 my → 返回缅甸语', () => {
    setLang('my');
    expect(t('app.title')).toBe(I18N['app.title'].my);
  });

  test('I18N 字典确保有 app.title 的 4 语言条目', () => {
    var entry = I18N['app.title'];
    expect(entry).toBeDefined();
    expect(entry.zh).toBeTruthy();
    expect(entry.en).toBeTruthy();
    expect(entry.th).toBeTruthy();
    expect(entry.my).toBeTruthy();
  });
});

// ============================================================================
// D. tpl() 模板翻译 API
// ============================================================================

describe('tpl() 模板翻译', () => {
  beforeEach(() => {
    setLang('zh');
  });

  test('带占位符 key + 参数 → 正确替换', () => {
    // stock.summary: '共 {0} 种物料, {1} 条明细 | 合计实时库存: {2}'
    var result = tpl('stock.summary', 5, 12, '100.00');
    expect(result).toContain('5');
    expect(result).toContain('12');
    expect(result).toContain('100.00');
    expect(result).not.toContain('{0}');
    expect(result).not.toContain('{1}');
    expect(result).not.toContain('{2}');
  });

  test('无占位符 key + 多余参数 → 返回翻译原文', () => {
    var plain = t('app.title');
    expect(tpl('app.title', 'extra1', 'extra2')).toBe(plain);
  });

  test('不存在 key + 参数 → 返回 key 字符串 (占位符无效)', () => {
    expect(tpl('missing.tpl.key', 'a', 'b')).toBe('missing.tpl.key');
  });

  test('切换英语后 tpl 使用英语模板', () => {
    setLang('en');
    var result = tpl('stock.summary', 3, 7, '50.00');
    expect(result).toContain('3');
    expect(result).toContain('7');
    expect(result).toContain('50.00');
  });

  test('tpl 传入 0 和 false 作为参数 → 正确替换', () => {
    setLang('zh');
    // stock.page_info: '第 {0} / {1} 页'
    var result = tpl('stock.page_info', 0, false);
    expect(result).toContain('0');
    expect(result).toContain('false');
  });
});

// ============================================================================
// E. setLang / getLang
// ============================================================================

describe('setLang / getLang', () => {
  afterEach(() => {
    setLang('zh'); // 复位
  });

  test('setLang 支持的语言 → getLang 返回新值', () => {
    setLang('en');
    expect(getLang()).toBe('en');
    setLang('th');
    expect(getLang()).toBe('th');
    setLang('my');
    expect(getLang()).toBe('my');
  });

  test('setLang 不支持语言 → 回退 zh', () => {
    setLang('ja');
    expect(getLang()).toBe('zh');
    setLang('nonsense');
    expect(getLang()).toBe('zh');
  });

  test('setLang 更新 localStorage', () => {
    setLang('en');
    expect(localStorage.getItem('wms_lang')).toBe('en');
    setLang('th');
    expect(localStorage.getItem('wms_lang')).toBe('th');
  });

  test('setLang 更新 document.documentElement.lang', () => {
    setLang('zh');
    expect(document.documentElement.lang).toBe('zh-CN');
    setLang('en');
    expect(document.documentElement.lang).toBe('en');
    setLang('th');
    expect(document.documentElement.lang).toBe('th');
    setLang('my');
    expect(document.documentElement.lang).toBe('my');
  });

  test('setLang 空字符串 → 回退 zh', () => {
    setLang('');
    expect(getLang()).toBe('zh');
  });
});

// ============================================================================
// F. applyI18n DOM 渲染
// ============================================================================

describe('applyI18n (DOM 渲染)', () => {
  beforeEach(() => {
    setLang('zh');
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('data-i18n → textContent', () => {
    document.body.innerHTML = '<span data-i18n="app.title"></span>';
    applyI18n();
    var el = document.querySelector('[data-i18n="app.title"]');
    expect(el.textContent).toBe(I18N['app.title'].zh);
  });

  test('data-i18n-placeholder → placeholder', () => {
    document.body.innerHTML = '<input data-i18n-placeholder="login.username_placeholder" />';
    applyI18n();
    var el = document.querySelector('[data-i18n-placeholder]');
    expect(el.placeholder).toBe(I18N['login.username_placeholder'].zh);
  });

  test('data-i18n-title → title', () => {
    document.body.innerHTML = '<span data-i18n-title="app.title"></span>';
    applyI18n();
    var el = document.querySelector('[data-i18n-title]');
    expect(el.title).toBe(I18N['app.title'].zh);
  });

  test('data-i18n-html → innerHTML', () => {
    document.body.innerHTML = '<div data-i18n-html="app.title"></div>';
    applyI18n();
    var el = document.querySelector('[data-i18n-html]');
    expect(el.innerHTML).toBe(I18N['app.title'].zh);
  });

  test('lang-btn active 状态匹配当前语言', () => {
    document.body.innerHTML =
      '<button class="lang-btn" data-lang="zh"></button>' +
      '<button class="lang-btn" data-lang="en"></button>';
    applyI18n();
    var zhBtn = document.querySelector('[data-lang="zh"]');
    var enBtn = document.querySelector('[data-lang="en"]');
    expect(zhBtn.classList.contains('active')).toBe(true);
    expect(enBtn.classList.contains('active')).toBe(false);
  });

  test('切换语言后 active 状态更新', () => {
    document.body.innerHTML =
      '<button class="lang-btn" data-lang="zh"></button>' +
      '<button class="lang-btn" data-lang="en"></button>';
    setLang('en');
    var zhBtn = document.querySelector('[data-lang="zh"]');
    var enBtn = document.querySelector('[data-lang="en"]');
    expect(zhBtn.classList.contains('active')).toBe(false);
    expect(enBtn.classList.contains('active')).toBe(true);
  });

  test('无 data-i18n 元素 → 不报错', () => {
    document.body.innerHTML = '<div>plain text</div>';
    expect(() => applyI18n()).not.toThrow();
  });

  test('data-i18n 值为空字符串 → 不修改 textContent', () => {
    document.body.innerHTML = '<span data-i18n="">原文</span>';
    applyI18n();
    var el = document.querySelector('[data-i18n]');
    expect(el.textContent).toBe('原文');
  });
});

// ============================================================================
// G. createLangSwitcher
// ============================================================================

describe('createLangSwitcher', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('创建 fixed 版语言切换器', () => {
    var fixed = createLangSwitcher();
    expect(fixed).toBeTruthy();
    expect(fixed.id).toBe('langSwitcherFixed');
    var btns = fixed.querySelectorAll('.lang-btn');
    expect(btns.length).toBe(4);
  });

  test('有 #login-lang-switcher → 渲染登录版并隐藏 fixed', () => {
    document.body.innerHTML = '<div id="login-lang-switcher"></div>';
    var fixed = createLangSwitcher();
    var loginSlot = document.getElementById('login-lang-switcher');
    expect(loginSlot.querySelectorAll('.lang-btn').length).toBe(4);
    expect(fixed.style.display).toBe('none');
  });

  test('有 .header-nav + .btn-logout → 在 logout 前插入内联切换器并移除 fixed', () => {
    document.body.innerHTML = '<div class="header-nav"><button class="btn-logout">退出</button></div>';
    createLangSwitcher();
    var headerNav = document.querySelector('.header-nav');
    var inline = headerNav.querySelector('.lang-switcher');
    expect(inline).toBeTruthy();
    expect(inline.querySelectorAll('.lang-btn').length).toBe(4);
    // 内联版插入到 logout 按钮前
    var logoutBtn = headerNav.querySelector('.btn-logout');
    expect(logoutBtn.previousSibling).toBe(inline);
    // fixed 版已移除
    expect(document.getElementById('langSwitcherFixed')).toBeNull();
  });

  test('有 .header-nav 但无 .btn-logout → 追加到 header-nav 末尾', () => {
    document.body.innerHTML = '<div class="header-nav"><span>导航栏</span></div>';
    createLangSwitcher();
    var headerNav = document.querySelector('.header-nav');
    var inline = headerNav.querySelector('.lang-switcher');
    expect(inline).toBeTruthy();
    expect(headerNav.lastChild).toBe(inline);
    // fixed 版已移除
    expect(document.getElementById('langSwitcherFixed')).toBeNull();
  });
});

// ============================================================================
// G2. initI18n IIFE — 模块加载时行为
// ============================================================================

describe('initI18n IIFE', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.removeItem('wms_lang');
  });

  test('localStorage 有保存的语言 → 恢复 _currentLang', () => {
    localStorage.setItem('wms_lang', 'en');
    jest.isolateModules(() => {
      var mod = require('../../../apps/wms/lang.js');
      expect(mod.getLang()).toBe('en');
    });
  });

  test('localStorage 有无效语言 → 保持默认 zh', () => {
    localStorage.setItem('wms_lang', 'xx');
    jest.isolateModules(() => {
      var mod = require('../../../apps/wms/lang.js');
      expect(mod.getLang()).toBe('zh');
    });
  });

  test('document.readyState = loading → 注册 DOMContentLoaded', () => {
    var origReadyState = Object.getOwnPropertyDescriptor(Document.prototype, 'readyState') ||
                          Object.getOwnPropertyDescriptor(document, 'readyState');
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    var addSpy = jest.spyOn(document, 'addEventListener');
    jest.isolateModules(() => {
      require('../../../apps/wms/lang.js');
    });
    expect(addSpy).toHaveBeenCalledWith('DOMContentLoaded', expect.any(Function));
    addSpy.mockRestore();
    if (origReadyState) {
      Object.defineProperty(document, 'readyState', origReadyState);
    } else {
      delete document.readyState;
    }
  });
});

// ============================================================================
// H. I18N 字典完整性检查
// ============================================================================

describe('I18N 字典完整性', () => {
  test('I18N 是一个非空对象', () => {
    expect(typeof I18N).toBe('object');
    expect(Object.keys(I18N).length).toBeGreaterThan(100);
  });

  test('所有 entry 都包含 zh 和 en', () => {
    var keys = Object.keys(I18N);
    keys.forEach(function (key) {
      var entry = I18N[key];
      expect(entry.zh).toBeTruthy();
      expect(entry.en).toBeTruthy();
    });
  });
});

// ============================================================================
// G. 分支覆盖补充 — resolveTranslation/t/setLang/applyI18n 边界
// ============================================================================

describe('resolveTranslation — falsy key 边界', () => {
  test('dict 为 null + key 为 null → 返回空字符串 (L580 branch)', () => {
    expect(resolveTranslation(null, 'zh', null)).toBe('');
  });

  test('dict 为 null + key 为空字符串 → 返回空字符串', () => {
    expect(resolveTranslation(null, 'zh', '')).toBe('');
  });

  test('dict 有效但所有降级失败 + key 为空字符串 → 返回空字符串 (L597 branch)', () => {
    var dict = { '': { th: '泰语' } }; // key='' 有 entry，但 lang='xx' 无匹配，en 也没有
    expect(resolveTranslation(dict, 'xx', '')).toBe('');
  });

  test('dict 有效 + key 存在 + 所有语言空串 → 返回 key (L597 终极兜底)', () => {
    var dict = { 'test.key': { zh: '', en: '', th: '' } };
    expect(resolveTranslation(dict, 'zh', 'test.key')).toBe('test.key');
  });
});

describe('t() — 回退链补充', () => {
  beforeEach(() => { setLang('zh'); });

  test('key 存在但翻译为空串 → resolveTranslation 返回 key 本身', () => {
    I18N['_test_empty'] = { zh: '', en: '', th: '', my: '' };
    // resolveTranslation 所有语言空串后回退到 key 本身
    expect(t('_test_empty', '默认文本')).toBe('_test_empty');
    delete I18N['_test_empty'];
  });

  test('key 不在 I18N + 有 fallback → 返回 fallback', () => {
    expect(t('__nonexist__', '兜底')).toBe('兜底');
  });

  test('key 不在 I18N + 无 fallback → 返回 key', () => {
    expect(t('__nonexist__')).toBe('__nonexist__');
  });
});

describe('setLang — 非标准语言的 langMap 回退 (L665)', () => {
  afterEach(() => { setLang('zh'); });

  test('setLang("de") → document.documentElement.lang = "de" (非 langMap 键)', () => {
    setLang('de');
    // de 不在 supported 里，会回退到 zh，但 langMap 不含 de
    // setLang 会先检查 supported，de 不在内会回退 zh
    // 所以实际 lang 应该是 zh-CN
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});

describe('applyI18n — 空 key 属性分支 (L680/685/690)', () => {
  beforeEach(() => { setLang('zh'); });

  test('data-i18n-placeholder 为空字符串时不修改 placeholder', () => {
    document.body.innerHTML = '<input data-i18n-placeholder="" placeholder="原始">';
    applyI18n();
    expect(document.querySelector('input').placeholder).toBe('原始');
  });

  test('data-i18n-title 为空字符串时不修改 title', () => {
    document.body.innerHTML = '<div data-i18n-title="" title="原始">text</div>';
    applyI18n();
    expect(document.querySelector('div').title).toBe('原始');
  });

  test('data-i18n-html 为空字符串时不修改 innerHTML', () => {
    document.body.innerHTML = '<div data-i18n-html="">原始内容</div>';
    applyI18n();
    expect(document.querySelector('div').innerHTML).toBe('原始内容');
  });
});
