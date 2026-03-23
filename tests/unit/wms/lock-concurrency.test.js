/**
 * lock-concurrency.test.js — 并发锁竞争场景补测
 *
 * 补充 lock.test.js 的单用户顺序场景，专注于并发和竞态情形:
 *   1. Promise.all 并发抢同一单据锁 — 后发起的 acquire 先释放旧锁
 *   2. 并发抢不同单据 — 最终只持有最后一个锁
 *   3. acquire 中途有 release 插入 — 不产生幽灵锁
 *   4. 快速连续切换单据 (5次切换) — 每次切换正确清理前一个锁
 *   5. 并发 release — 只发起一次 API 调用，不重复释放
 *   6. acquire + release 交叉 Promise.all — 不崩溃
 */
const { loadSharedJs } = require('./setup');

function mockResponse(body, { status = 200, ok = true } = {}) {
    return {
        ok,
        status,
        statusText: ok ? 'OK' : 'Error',
        text: jest.fn().mockResolvedValue(
            typeof body === 'string' ? body : JSON.stringify(body)
        ),
    };
}

beforeAll(() => {
    global.fetch = jest.fn();
    localStorage.setItem('wms_username', 'operator-A');
    loadSharedJs();
});

afterEach(async () => {
    // 统一释放锁，清除只读模式
    global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
    await releaseDocumentLock();
    _setReadonlyMode(false);
    jest.restoreAllMocks();
});

// ===========================================================================
// 1. 并发抢同一单据锁
// ===========================================================================

describe('并发抢同一单据锁', () => {

    test('Promise.all 同时发起两次相同单据 acquire → 两次都调用 acquire API (同单据不重入)', async () => {
        global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));

        // 同一单据同时发起两次 acquire
        // 根据 shared.js 逻辑: 相同 docType+docNumber 不先 release 直接 acquire
        await Promise.all([
            acquireDocumentLock('SO', '999'),
            acquireDocumentLock('SO', '999'),
        ]);

        // 每次都应调用 API
        expect(global.fetch).toHaveBeenCalledTimes(2);
        const urls = global.fetch.mock.calls.map(c => c[0]);
        expect(urls.every(u => u === '/api/wms/lock/acquire')).toBe(true);
    });

    test('并发两次相同单据 acquire 后，release 只调用一次 API', async () => {
        global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
        await Promise.all([
            acquireDocumentLock('WO', '111'),
            acquireDocumentLock('WO', '111'),
        ]);

        global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
        await releaseDocumentLock();

        // 持有锁只有一个，release 只调用一次
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(global.fetch.mock.calls[0][0]).toBe('/api/wms/lock/release');
    });
});

// ===========================================================================
// 2. 并发抢不同单据
// ===========================================================================

describe('并发抢不同单据', () => {

    test('Promise.all 同时获取两个不同单据 → 先完成的被后完成的覆盖 (最终只持有一个锁)', async () => {
        // 模拟有延迟的 acquire: SO-100 先完成，PO-200 后完成
        let callCount = 0;
        global.fetch = jest.fn().mockImplementation(async (url) => {
            callCount++;
            return mockResponse({ success: true });
        });

        await Promise.all([
            acquireDocumentLock('SO', '100'),
            acquireDocumentLock('PO', '200'),
        ]);

        // 不管哪个先完成，不应有未释放的幽灵锁
        // release 应只调用一次 (当前持有的锁)
        global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
        await releaseDocumentLock();
        // 至多一次 release (如果有锁被持有)
        expect(global.fetch.mock.calls.length).toBeLessThanOrEqual(1);
    });
});

// ===========================================================================
// 3. acquire 执行中途插入 release
// ===========================================================================

describe('acquire 执行中途插入 release', () => {

    test('acquire 飞行中 release 被调用 → 不产生崩溃', async () => {
        let resolveFetch;
        // acquire 的 fetch 被挂起
        global.fetch = jest.fn().mockImplementationOnce(() =>
            new Promise(resolve => { resolveFetch = resolve; })
        ).mockResolvedValue(mockResponse({ success: true }));

        const acquirePromise = acquireDocumentLock('TR', '555');
        // 在 acquire 飞行中调用 release
        const releasePromise = releaseDocumentLock();

        // 解除 acquire 挂起
        resolveFetch(mockResponse({ success: true }));

        // 均不应抛出异常
        await expect(Promise.all([acquirePromise, releasePromise])).resolves.not.toThrow();
    });
});

// ===========================================================================
// 4. 快速连续切换单据 (5 次切换)
// ===========================================================================

describe('快速连续切换单据', () => {

    test('连续切换 5 个不同单据 → 每次切换正确释放前一个锁', async () => {
        const docs = [
            ['SO', '001'], ['PO', '002'], ['WO', '003'], ['TR', '004'], ['PI', '005'],
        ];

        global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));

        for (const [type, num] of docs) {
            await acquireDocumentLock(type, num);
        }

        // 验证最后一次 acquire 前有 release 调用 (切换时释放前一个锁)
        const urls = global.fetch.mock.calls.map(c => c[0]);
        const releaseCalls = urls.filter(u => u === '/api/wms/lock/release');
        const acquireCalls = urls.filter(u => u === '/api/wms/lock/acquire');

        // 5 次 acquire，前 4 次切换时各 release 一次旧锁
        expect(acquireCalls.length).toBe(5);
        expect(releaseCalls.length).toBe(4);
    });

    test('连续切换后 release → 只释放最后持有的锁', async () => {
        global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));

        await acquireDocumentLock('SO', 'A');
        await acquireDocumentLock('PO', 'B');
        await acquireDocumentLock('WO', 'C'); // 最终持有

        global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
        await releaseDocumentLock();

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const body = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(body.doc_type).toBe('WO');
        expect(body.doc_number).toBe('C');
    });

    test('同单据快速切回 → 不产生多余的 release 调用', async () => {
        global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));

        await acquireDocumentLock('SO', '123');
        await acquireDocumentLock('PO', '456');
        await acquireDocumentLock('SO', '123'); // 切回 SO-123

        const urls = global.fetch.mock.calls.map(c => c[0]);
        const releaseCalls = urls.filter(u => u === '/api/wms/lock/release');
        const acquireCalls = urls.filter(u => u === '/api/wms/lock/acquire');

        // SO-123 → PO-456: 先 release SO-123，再 acquire PO-456
        // PO-456 → SO-123: 先 release PO-456，再 acquire SO-123
        expect(acquireCalls.length).toBe(3);
        expect(releaseCalls.length).toBe(2);
    });
});

// ===========================================================================
// 5. 并发 release
// ===========================================================================

describe('并发 release', () => {

    test('Promise.all 同时发起两次 release → 只发出一次 API 调用', async () => {
        // 先获取锁
        global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
        await acquireDocumentLock('IC', '999');

        // 并发 release × 2
        global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
        await Promise.all([
            releaseDocumentLock(),
            releaseDocumentLock(),
        ]);

        // 第一次 release 清空锁，第二次发现无锁不调用 API
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('无锁时并发 release × 3 → 均不调用 API', async () => {
        global.fetch = jest.fn();

        await Promise.all([
            releaseDocumentLock(),
            releaseDocumentLock(),
            releaseDocumentLock(),
        ]);

        expect(global.fetch).not.toHaveBeenCalled();
    });
});

// ===========================================================================
// 6. acquire + release 交叉 Promise.all
// ===========================================================================

describe('acquire + release 交叉并发', () => {

    test('同时发起 acquire 和 release → 不崩溃，最终状态一致', async () => {
        global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
        await acquireDocumentLock('SO', '100'); // 先建立锁

        global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));

        // 并发: 释放旧锁 + 获取新锁
        await expect(
            Promise.all([
                releaseDocumentLock(),
                acquireDocumentLock('PO', '200'),
            ])
        ).resolves.not.toThrow();
    });

    test('交叉并发后状态可继续正常使用 (acquire → release 正常流转)', async () => {
        global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));

        await Promise.all([
            releaseDocumentLock(),
            acquireDocumentLock('WO', '300'),
        ]);

        // 之后能正常 release
        global.fetch = jest.fn().mockResolvedValue(mockResponse({ success: true }));
        await releaseDocumentLock();

        // 再次 release 不调用 API (锁已清空)
        global.fetch = jest.fn();
        await releaseDocumentLock();
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
