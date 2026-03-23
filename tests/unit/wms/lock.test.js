/**
 * 文档并发锁机制测试 (Fetch Mock)
 * 覆盖: acquireDocumentLock, releaseDocumentLock, _setReadonlyMode
 *
 * 场景 1: 正常流转 — 成功获取锁 → 成功释放锁
 * 场景 2: 排他拦截 — API 返回 423 / 业务层拒绝，前端进入只读模式
 * 场景 3: 同用户重入 — 浏览器刷新后原锁持有者可重新获取
 * 场景 4: 防泄漏/锁超时 — 超时后其他用户可强制接管
 *
 * 注意: _currentLock 是 sandbox 作用域变量，测试通过行为验证
 * (API 调用模式 + DOM 副作用) 而非直接访问内部状态
 */
const { loadSharedJs } = require('./setup');

// ============================================================================
// 辅助: 构造 Response Mock
// ============================================================================

function mockResponse(body, { status = 200, ok = true } = {}) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Locked',
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// ============================================================================
// 环境初始化
// ============================================================================

beforeAll(() => {
  global.fetch = jest.fn();
  localStorage.setItem('wms_username', 'operator-A');
  loadSharedJs();
});

afterEach(() => {
  jest.restoreAllMocks();
  // 通过调用 releaseDocumentLock 清除锁状态 (而非直接设置 _currentLock)
  global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
  // 同步释放 — 让内部 _currentLock 归零
  releaseDocumentLock();
  // 清除只读模式
  _setReadonlyMode(false);
});

// ============================================================================
// 场景 1: 正常流转 — 成功获取锁 → 成功释放锁
// ============================================================================

describe('场景 1: 正常锁流转 (获取 → 释放)', () => {
  test('acquireDocumentLock 成功 → 正确调用 acquire API', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse({ success: true })
    );

    await acquireDocumentLock('SO', '12345');

    // 验证 API 调用参数
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const callArgs = global.fetch.mock.calls[0];
    expect(callArgs[0]).toBe('/api/wms/lock/acquire');
    const body = JSON.parse(callArgs[1].body);
    expect(body.doc_type).toBe('SO');
    expect(body.doc_number).toBe('12345');
    expect(body.username).toBe('operator-A');
    expect(body.tab_id).toBeDefined();
  });

  test('acquireDocumentLock 成功后，releaseDocumentLock 调用 release API (证明锁已建立)', async () => {
    // 先获取锁
    global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
    await acquireDocumentLock('SO', '12345');

    // 再释放锁
    global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
    await releaseDocumentLock();

    // 验证 release API 被调用
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const callArgs = global.fetch.mock.calls[0];
    expect(callArgs[0]).toBe('/api/wms/lock/release');
    const body = JSON.parse(callArgs[1].body);
    expect(body.doc_type).toBe('SO');
    expect(body.doc_number).toBe('12345');
  });

  test('releaseDocumentLock 后再次调用 → 不发起 API 请求 (证明锁已清空)', async () => {
    // 先获取锁
    global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
    await acquireDocumentLock('PO', '100');

    // 第一次释放
    global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
    await releaseDocumentLock();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // 第二次释放 — 无锁可释放
    global.fetch = jest.fn();
    await releaseDocumentLock();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('获取新锁前自动释放旧锁 (防幽灵锁)', async () => {
    // 先获取 SO-111
    global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
    await acquireDocumentLock('SO', '111');

    // 再获取不同单据 PO-222 → 应先 release 旧锁再 acquire 新锁
    global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
    await acquireDocumentLock('PO', '222');

    // 应有 2 次调用: release SO-111 + acquire PO-222
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // 第一次: 释放旧锁
    const releaseUrl = global.fetch.mock.calls[0][0];
    expect(releaseUrl).toBe('/api/wms/lock/release');
    const releaseBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(releaseBody.doc_type).toBe('SO');
    expect(releaseBody.doc_number).toBe('111');

    // 第二次: 获取新锁
    const acquireUrl = global.fetch.mock.calls[1][0];
    expect(acquireUrl).toBe('/api/wms/lock/acquire');
    const acquireBody = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(acquireBody.doc_type).toBe('PO');
    expect(acquireBody.doc_number).toBe('222');
  });
});

// ============================================================================
// 场景 2: 排他拦截 — 已被他人锁定
// ============================================================================

describe('场景 2: 排他拦截 (锁已被占用)', () => {
  test('API 返回 200 + locked_by → 进入只读模式 + 显示占用提示', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse({ success: false, locked_by: 'user-B' })
    );
    document.body.innerHTML = '<div class="container"><div class="card"><button type="submit">提交</button></div></div>';

    await acquireDocumentLock('WO', '999');

    // 验证按钮被禁用 (只读模式)
    const btn = document.querySelector('button[type="submit"]');
    expect(btn.disabled).toBe(true);

    // 验证锁横幅显示占用者
    const banner = document.getElementById('lockBanner');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('user-B');

    // 验证锁未建立: 释放时不应调用 API
    global.fetch = jest.fn();
    await releaseDocumentLock();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('API 返回 HTTP 423 (Locked) → 进入只读模式', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse('单据已被锁定', { status: 423, ok: false })
    );
    document.body.innerHTML = '<div class="container"><div class="card"><button type="submit">提交</button></div></div>';

    await acquireDocumentLock('TR', '777');

    // 验证按钮被禁用 (只读模式)
    const btn = document.querySelector('button[type="submit"]');
    expect(btn.disabled).toBe(true);

    // 验证锁横幅显示
    const banner = document.getElementById('lockBanner');
    expect(banner).not.toBeNull();

    // 验证锁未建立
    global.fetch = jest.fn();
    await releaseDocumentLock();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('锁被占用后再次获取其他单据 → 先清除只读模式', async () => {
    document.body.innerHTML = '<div class="container"><div class="card"><button type="submit">提交</button></div></div>';

    // 第一次: 被占用 → 只读
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse({ success: false, locked_by: 'user-X' })
    );
    await acquireDocumentLock('SO', '100');
    expect(document.querySelector('button[type="submit"]').disabled).toBe(true);

    // 第二次: 获取新单据成功 → 应清除只读模式
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse({ success: true })
    );
    await acquireDocumentLock('SO', '200');
    expect(document.querySelector('button[type="submit"]').disabled).toBe(false);
    expect(document.getElementById('lockBanner')).toBeNull();
  });
});

// ============================================================================
// 场景 3: 同用户重入 — 浏览器刷新后原持有者可重新获取
// ============================================================================

describe('场景 3: 同用户重入 (浏览器刷新)', () => {
  test('同用户同单据再次获取锁 → 不触发旧锁释放', async () => {
    // 第一次获取
    global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
    await acquireDocumentLock('SO', '555');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // 第二次获取同一单据 — 不应先 release 再 acquire
    global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
    await acquireDocumentLock('SO', '555');

    // 只应有 1 次 acquire 调用，没有额外的 release
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const url = global.fetch.mock.calls[0][0];
    expect(url).toBe('/api/wms/lock/acquire');
  });

  test('同用户重入后锁仍有效 → release 能正常调用', async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
    await acquireDocumentLock('WO', '333');

    // 重入
    global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
    await acquireDocumentLock('WO', '333');

    // 释放 — 应能正常调用 release API
    global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
    await releaseDocumentLock();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('/api/wms/lock/release');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.doc_type).toBe('WO');
    expect(body.doc_number).toBe('333');
  });

  test('同用户重入携带正确的 tab_id', async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
    await acquireDocumentLock('PI', '444');

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.tab_id).toBe(currentTabId);
    expect(body.tab_id).toBeTruthy();
  });
});

// ============================================================================
// 场景 4: 防泄漏/锁超时 — 超时后其他用户可接管
// ============================================================================

describe('场景 4: 防泄漏/锁超时', () => {
  test('锁超时后获取 → API 返回 success (强制接管) → 前端正常持有锁', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse({ success: true, force_acquired: true, previous_owner: 'user-C' })
    );
    document.body.innerHTML = '<div class="container"><div class="card"><button type="submit">提交</button></div></div>';

    await acquireDocumentLock('PO', '666');

    // 验证按钮未被禁用 (非只读模式 — 接管成功)
    const btn = document.querySelector('button[type="submit"]');
    expect(btn.disabled).toBe(false);

    // 验证锁已建立: 释放时应调用 API
    global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
    await releaseDocumentLock();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('/api/wms/lock/release');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.doc_type).toBe('PO');
    expect(body.doc_number).toBe('666');
  });

  test('releaseDocumentLock 网络失败 → 不抛异常 + 锁仍被清空', async () => {
    // 先获取锁
    global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
    await acquireDocumentLock('SO', '100');

    // 释放时网络失败
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network error'));
    await expect(releaseDocumentLock()).resolves.toBeUndefined();

    // 验证锁已清空: 再次释放不触发 API
    global.fetch = jest.fn();
    await releaseDocumentLock();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('acquireDocumentLock 网络失败 → 不抛异常 + 不设置锁', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(acquireDocumentLock('IC', '001')).resolves.toBeUndefined();

    // 验证锁未建立: 释放时不调用 API
    global.fetch = jest.fn();
    await releaseDocumentLock();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('beforeunload 事件 → sendBeacon 释放锁 (防页面关闭泄漏)', async () => {
    // 先获取锁 (让内部 _currentLock 有值)
    global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
    await acquireDocumentLock('TR', '444');

    // 模拟 sendBeacon
    const beaconSpy = jest.fn().mockReturnValue(true);
    navigator.sendBeacon = beaconSpy;

    // 触发 beforeunload
    window.dispatchEvent(new Event('beforeunload'));

    // 验证 sendBeacon 被调用
    expect(beaconSpy).toHaveBeenCalledTimes(1);
    const url = beaconSpy.mock.calls[0][0];
    expect(url).toBe('/api/wms/lock/release');

    // 验证 payload 是 Blob
    const blob = beaconSpy.mock.calls[0][1];
    expect(blob).toBeInstanceOf(Blob);
  });
});

// ============================================================================
// _setReadonlyMode 单元测试
// ============================================================================

describe('_setReadonlyMode 只读模式控制', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="container">
        <div class="card">
          <button type="submit">提交</button>
          <button class="btn-primary">确认</button>
          <input type="text" id="scanInput" />
          <input type="text" id="qty" />
          <select id="warehouse"><option>W1</option></select>
        </div>
      </div>
    `;
  });

  test('开启只读 → 禁用按钮和输入框 (scanInput 除外) + 显示横幅', () => {
    _setReadonlyMode(true, '被用户X锁定');

    const submitBtn = document.querySelector('button[type="submit"]');
    const primaryBtn = document.querySelector('.btn-primary');
    const scanInput = document.getElementById('scanInput');
    const qtyInput = document.getElementById('qty');
    const select = document.querySelector('select');

    expect(submitBtn.disabled).toBe(true);
    expect(primaryBtn.disabled).toBe(true);
    expect(scanInput.disabled).toBe(false); // scanInput 豁免
    expect(qtyInput.disabled).toBe(true);
    expect(select.disabled).toBe(true);

    const banner = document.getElementById('lockBanner');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toBe('被用户X锁定');
  });

  test('关闭只读 → 恢复按钮和输入框 + 移除横幅', () => {
    _setReadonlyMode(true, '测试锁定');
    _setReadonlyMode(false);

    const submitBtn = document.querySelector('button[type="submit"]');
    const qtyInput = document.getElementById('qty');
    expect(submitBtn.disabled).toBe(false);
    expect(qtyInput.disabled).toBe(false);

    const banner = document.getElementById('lockBanner');
    expect(banner).toBeNull();
  });
});
