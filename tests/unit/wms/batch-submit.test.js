/**
 * batchSubmitAll() 批量提交测试
 * 覆盖: 全部成功 / 部分失败熔断 / 空列表兜底
 *
 * 核心逻辑:
 *   batchSubmitAll(openLines, buildPayloadFn, actionLabel)
 *   - 逐行调用 apiPost('/transaction', payload) 提交
 *   - 业务错误 (result.success===false) → 记录错误，继续下一行
 *   - 异常 (HTTP 500 / 网络断开) → 记录错误，立刻熔断 (不再请求后续行)
 *   - 空列表 → 直接返回 false，不发任何请求
 */
const { loadSharedJs, setMockConfirm } = require('./setup');

beforeAll(() => {
  global.fetch = jest.fn();
  loadSharedJs();
});

afterEach(() => {
  jest.restoreAllMocks();
  setMockConfirm(true);
});

// ============================================================================
// 辅助: 构造 Response Mock (与 api.test.js 保持一致)
// ============================================================================

function mockResponse(body, { status = 200, ok = true } = {}) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Server Error',
    text: jest.fn().mockResolvedValue(
      typeof body === 'string' ? body : JSON.stringify(body)
    ),
  };
}

// 辅助: 构造待提交行项目
function makeOpenLines(count) {
  return Array.from({ length: count }, (_, i) => ({
    itemCode: 'ITEM-' + String(i + 1).padStart(3, '0'),
    _open: (i + 1) * 10,
  }));
}

// 辅助: 构建 payload (模拟业务页面传入的 buildPayloadFn)
function buildPayload(line) {
  return {
    item_code: line.itemCode,
    quantity: line._open,
    action: 'submit',
  };
}

// ============================================================================
// 场景 1: 完全成功 — 3 个待提交项，API 全部返回 200
// ============================================================================

describe('batchSubmitAll — 场景1: 完全成功', () => {
  test('3 个行项目全部成功提交，函数返回 true，发出 3 次请求', async () => {
    const openLines = makeOpenLines(3);
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse({ success: true, id: 1 })
    );

    const result = await batchSubmitAll(openLines, buildPayload, '拣货');

    // 函数返回 true 表示批量流程完成
    expect(result).toBe(true);
    // 3 个行项目 → 3 次 apiPost → 3 次 fetch
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('每次请求携带正确的 URL 和 payload', async () => {
    const openLines = makeOpenLines(3);
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse({ success: true, id: 1 })
    );

    await batchSubmitAll(openLines, buildPayload, '拣货');

    // 验证每次请求的 URL 和 body
    for (let i = 0; i < 3; i++) {
      const [url, options] = global.fetch.mock.calls[i];
      expect(url).toBe('/api/wms/transaction');
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body);
      expect(body.item_code).toBe(openLines[i].itemCode);
      expect(body.quantity).toBe(openLines[i]._open);
    }
  });
});

// ============================================================================
// 场景 2: 部分失败 / 熔断 — 第 1 个成功，第 2 个 HTTP 500，第 3 个不请求
// ============================================================================

describe('batchSubmitAll — 场景2: 部分失败熔断', () => {
  test('第 2 个 API 返回 500 后立刻熔断，第 3 个不再请求', async () => {
    const openLines = makeOpenLines(3);
    global.fetch = jest.fn()
      // #1: 成功
      .mockResolvedValueOnce(mockResponse({ success: true, id: 1 }))
      // #2: HTTP 500 → apiPost 抛出异常
      .mockResolvedValueOnce(
        mockResponse('数据库连接失败', { status: 500, ok: false })
      )
      // #3: 准备了 mock 但不应被调用
      .mockResolvedValueOnce(mockResponse({ success: true, id: 3 }));

    const result = await batchSubmitAll(openLines, buildPayload, '拣货');

    // 熔断: 仅发出 2 次请求，第 3 个绝对不调用
    expect(global.fetch).toHaveBeenCalledTimes(2);
    // 函数仍然完成 (不向调用方抛异常)，返回 true
    expect(result).toBe(true);
  });

  test('网络异常同样触发熔断', async () => {
    const openLines = makeOpenLines(3);
    global.fetch = jest.fn()
      // #1: 成功
      .mockResolvedValueOnce(mockResponse({ success: true, id: 1 }))
      // #2: 网络断开 → fetch 本身 reject
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      // #3: 不应被调用
      .mockResolvedValueOnce(mockResponse({ success: true, id: 3 }));

    const result = await batchSubmitAll(openLines, buildPayload, '拣货');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result).toBe(true);
  });
});

// ============================================================================
// 场景 3: 边界兜底 — 空数组 / 空列表
// ============================================================================

describe('batchSubmitAll — 场景3: 边界兜底', () => {
  test('传入空数组，不发起任何 fetch 请求，返回 false', async () => {
    global.fetch = jest.fn();

    const result = await batchSubmitAll([], buildPayload, '拣货');

    expect(result).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
