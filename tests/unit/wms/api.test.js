/**
 * shared.js API 请求函数测试 (Fetch Mock)
 * 覆盖: apiGet, apiPost
 * 场景: 成功返回 / 业务错误 / 网络异常 / 空响应 / 非JSON响应
 */
const { loadSharedJs } = require('./setup');

beforeAll(() => {
  // 提供初始 fetch (loadSharedJs 需要 sandbox.fetch 可用)
  global.fetch = jest.fn();
  loadSharedJs();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ============================================================================
// 辅助: 构造 Response Mock
// ============================================================================

function mockResponse(body, { status = 200, ok = true } = {}) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Server Error',
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// ============================================================================
// apiGet — GET 请求
// ============================================================================

describe('apiGet', () => {
  test('场景A: HTTP 200 + 正常 JSON → 返回解析后的数据', async () => {
    const data = { success: true, items: [{ id: 1, name: '物料A' }] };
    global.fetch = jest.fn().mockResolvedValue(mockResponse(data));

    const result = await apiGet('/items');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    // 验证 URL 拼接: CONFIG.n8nBaseUrl (/api/wms) + path
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/wms/items',
      expect.objectContaining({ credentials: 'include' })
    );
    expect(result).toEqual(data);
  });

  test('场景B-1: HTTP 400 业务错误 → 抛出含状态码和错误文本的异常', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse('参数缺失: company_code', { status: 400, ok: false })
    );

    await expect(apiGet('/items')).rejects.toThrow('HTTP 400');
    await expect(apiGet('/items')).rejects.toThrow('参数缺失: company_code');
  });

  test('场景B-2: HTTP 500 服务器错误 → 抛出含状态码的异常', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse('Internal Server Error', { status: 500, ok: false })
    );

    await expect(apiGet('/items')).rejects.toThrow('HTTP 500');
  });

  test('场景B-3: HTTP 错误 + 空错误文本 → 回退使用 statusText', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: jest.fn().mockResolvedValue(''),
    });

    await expect(apiGet('/items')).rejects.toThrow('HTTP 502: Bad Gateway');
  });

  test('场景C: 网络异常 (fetch 抛出) → 异常向上传播', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(apiGet('/items')).rejects.toThrow('Failed to fetch');
  });

  test('空响应 → 抛出"服务器返回空响应"', async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse(''));

    await expect(apiGet('/items')).rejects.toThrow('服务器返回空响应');
  });

  test('纯空白响应 → 抛出"服务器返回空响应"', async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse('   '));

    await expect(apiGet('/items')).rejects.toThrow('服务器返回空响应');
  });

  test('非JSON响应 → 抛出"服务器返回非JSON响应"', async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse('<html>Error</html>'));

    await expect(apiGet('/items')).rejects.toThrow('服务器返回非JSON响应');
  });
});


// ============================================================================
// apiPost — POST 请求
// ============================================================================

describe('apiPost', () => {
  test('场景A: HTTP 200 + 正常 JSON → 返回解析后的数据', async () => {
    const reqData = { item_code: 'ITEM-01', quantity: 10 };
    const resData = { success: true, id: 42 };
    global.fetch = jest.fn().mockResolvedValue(mockResponse(resData));

    const result = await apiPost('/transaction', reqData);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/wms/transaction',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(reqData),
      })
    );
    expect(result).toEqual(resData);
  });

  test('场景B-1: HTTP 400 业务错误 → 抛出含状态码和错误文本的异常', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse('数量超出计划', { status: 400, ok: false })
    );

    await expect(apiPost('/transaction', {})).rejects.toThrow('HTTP 400');
    await expect(apiPost('/transaction', {})).rejects.toThrow('数量超出计划');
  });

  test('场景B-2: HTTP 500 服务器错误 → 抛出含状态码的异常', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse('数据库连接失败', { status: 500, ok: false })
    );

    await expect(apiPost('/transaction', {})).rejects.toThrow('HTTP 500');
  });

  test('场景C: 网络异常 (fetch 抛出) → 异常向上传播', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    await expect(apiPost('/transaction', {})).rejects.toThrow('Network request failed');
  });

  test('空响应 → 抛出"服务器返回空响应"', async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse(''));

    await expect(apiPost('/transaction', {})).rejects.toThrow('服务器返回空响应');
  });

  test('非JSON响应 → 抛出"服务器返回非JSON响应"', async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse('OK'));

    await expect(apiPost('/transaction', {})).rejects.toThrow('服务器返回非JSON响应');
  });

  test('POST body 序列化验证 — 嵌套对象正确传递', async () => {
    const complexData = {
      company_code: 'TEST',
      lines: [
        { item_code: 'A', qty: 5 },
        { item_code: 'B', qty: 3 },
      ],
    };
    global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));

    await apiPost('/submit', complexData);

    const callArgs = global.fetch.mock.calls[0];
    expect(JSON.parse(callArgs[1].body)).toEqual(complexData);
  });
});
