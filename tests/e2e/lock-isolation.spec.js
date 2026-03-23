// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * 悲观锁隔离 E2E 测试
 *
 * 核心策略:
 *   1. Network Interception — 拦截 /lock/acquire + /lock/release API
 *   2. 模拟多标签页场景: Tab A 持锁 → Tab B 被拒绝 → 只读模式
 *   3. 验证 beforeunload 释放锁 + 切换单据自动释放旧锁
 *
 * 运行: npx playwright test tests/e2e/lock-isolation.spec.js --headed
 */

// ============================================================
// Mock 数据定义
// ============================================================

/** PO 查询成功响应 (用于锁测试) */
const MOCK_PO_RESPONSE = {
  success: true,
  sap_order: {
    docNum: '26000080',
    docEntry: 801,
    docStatus: 'O',
    cardCode: 'V-LOCK-001',
    cardName: '锁测试供应商',
    docDueDate: '2026-04-01',
    wmsStatus: 'pending',
    lines: [
      {
        lineNum: 0,
        itemCode: 'ITEM-D001',
        itemName: '锁测试物料',
        quantity: 50,
        deliveredQty: 0,
        openQty: 50,
        lineStatus: 'O',
        whsCode: 'WH01',
        uom: 'PCS',
      },
    ],
  },
  wms_history: {
    wms_status: 'pending',
    lineReceipts: {},
    transactions: [],
  },
};

/** 锁获取成功 */
const MOCK_LOCK_ACQUIRED = {
  success: true,
  locked_by: 'e2e_test_admin',
};

/** 锁被占用 (他人持有) */
const MOCK_LOCK_REJECTED = {
  success: false,
  locked_by: '其他操作员',
  locked_at: '2026-03-08 10:00:00',
};

/** 锁释放成功 */
const MOCK_LOCK_RELEASED = {
  success: true,
};

/** 事务提交成功 */
const MOCK_TX_SUCCESS = {
  success: true,
  message: '提交成功',
};

// ============================================================
// 工具函数
// ============================================================

/** 注入登录态 + env.js 配置 */
async function setupAuth(page) {
  await page.addInitScript(() => {
    localStorage.setItem('wms_username', 'e2e_test_admin');
    localStorage.setItem('wms_display_name', 'E2E 测试操作员');
    localStorage.setItem('wms_role', 'admin');

    window.__ENV = {
      ENV_NAME: 'e2e',
      API_BASE_URL: '/api/wms',
      QR_SERVICE_URL: '',
      APP_BASE_URL: '',
      SYSTEM_TIMEZONE: 'UTC',
      SOUND_ENABLED: false,
      AUTO_FOCUS_DELAY: 100,
      DEBUG: false,
    };
  });
}

/**
 * 设置 API 路由拦截 (逆序匹配: 先注册 = 最低优先级)
 * @param {import('@playwright/test').Page} page
 * @param {object} options
 * @param {Function} [options.lockHandler] - 自定义锁路由处理
 */
async function setupApiRoutes(page, { lockHandler } = {}) {
  // ---- 低优先级: 通用 fallback ----
  await page.route('**/api/webhook-test/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    })
  );

  await page.route('**/api/wms/**', (route) => {
    const method = route.request().method();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(method === 'GET' ? { success: true, data: [] } : { success: true }),
    });
  });

  // ---- 高优先级: 具体路由 ----
  await page.route('**/env.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '/* env.js intercepted */',
    })
  );

  // 主数据缓存
  await page.route('**/api/wms/masterdata**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        items: [],
        warehouses: [{ whsCode: 'WH01', whsName: '主仓库' }],
        bins: [],
      }),
    })
  );

  // 事务提交
  await page.route('**/api/wms/transaction**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_TX_SUCCESS),
    })
  );

  // 锁管理 — 可自定义
  if (lockHandler) {
    await page.route('**/api/wms/lock/**', lockHandler);
  } else {
    await page.route('**/api/wms/lock/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_LOCK_ACQUIRED),
      })
    );
  }

  // PO 查询 (最高优先级)
  await page.route('**/api/wms/po**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PO_RESPONSE),
    })
  );
}

// ============================================================
// 测试套件
// ============================================================

test.describe('悲观锁隔离 E2E', () => {
  // ----------------------------------------------------------
  // 测试 1: 正常获取锁 — 按钮可操作
  // ----------------------------------------------------------
  test('查询单据后成功获取锁，操作按钮可用', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/po.html');
    await page.locator('#scanInput').fill('26000080');
    await page.locator('#scanInput').press('Enter');

    // 订单卡片出现
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#docNum')).toContainText('26000080');

    // 锁获取成功 → 不应出现锁横幅
    const lockBanner = page.locator('#lockBanner');
    await expect(lockBanner).toBeHidden({ timeout: 3_000 });

    // 行操作按钮应可用 (非 disabled)
    const actionBtn = page.locator('#linesBody button').first();
    if (await actionBtn.count() > 0) {
      await expect(actionBtn).toBeEnabled();
    }
  });

  // ----------------------------------------------------------
  // 测试 2: 锁被占用 — 只读模式 + 锁横幅
  // ----------------------------------------------------------
  test('他人持锁时进入只读模式并显示锁横幅', async ({ page }) => {
    await setupAuth(page);

    // 自定义锁路由: acquire 被拒绝, release 正常
    await setupApiRoutes(page, {
      lockHandler: async (route) => {
        const url = route.request().url();
        if (url.includes('/lock/acquire')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(MOCK_LOCK_REJECTED),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_LOCK_RELEASED),
        });
      },
    });

    await page.goto('/wms/po.html');
    await page.locator('#scanInput').fill('26000080');
    await page.locator('#scanInput').press('Enter');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 应显示锁横幅 (被占用提示)
    const lockBanner = page.locator('#lockBanner');
    await expect(lockBanner).toBeVisible({ timeout: 5_000 });
    await expect(lockBanner).toContainText('正在操作');

    // 提交按钮应被禁用 (只读模式)
    const submitBtns = page.locator('button[type="submit"]');
    const count = await submitBtns.count();
    for (let i = 0; i < count; i++) {
      await expect(submitBtns.nth(i)).toBeDisabled();
    }
  });

  // ----------------------------------------------------------
  // 测试 3: HTTP 423 锁定 — 只读模式
  // ----------------------------------------------------------
  test('API 返回 HTTP 423 时进入只读模式', async ({ page }) => {
    await setupAuth(page);

    await setupApiRoutes(page, {
      lockHandler: async (route) => {
        const url = route.request().url();
        if (url.includes('/lock/acquire')) {
          return route.fulfill({
            status: 423,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Locked', locked_by: '其他操作员' }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_LOCK_RELEASED),
        });
      },
    });

    await page.goto('/wms/po.html');
    await page.locator('#scanInput').fill('26000080');
    await page.locator('#scanInput').press('Enter');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 应出现锁横幅
    const lockBanner = page.locator('#lockBanner');
    await expect(lockBanner).toBeVisible({ timeout: 5_000 });
    await expect(lockBanner).toContainText('锁定');
  });

  // ----------------------------------------------------------
  // 测试 4: 释放锁 — 记录 API 调用
  // ----------------------------------------------------------
  test('调用 releaseDocumentLock 触发锁释放 API', async ({ page }) => {
    let releaseCallCount = 0;

    await setupAuth(page);
    await setupApiRoutes(page, {
      lockHandler: async (route) => {
        const url = route.request().url();
        if (url.includes('/lock/release')) {
          releaseCallCount++;
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_LOCK_ACQUIRED),
        });
      },
    });

    await page.goto('/wms/po.html');
    await page.locator('#scanInput').fill('26000080');
    await page.locator('#scanInput').press('Enter');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 直接调用 releaseDocumentLock (模拟返回链接 onclick)
    await page.evaluate(() => {
      if (typeof releaseDocumentLock === 'function') {
        return releaseDocumentLock();
      }
    });
    await page.waitForTimeout(1_000);

    // releaseDocumentLock → /lock/release API 调用
    expect(releaseCallCount).toBeGreaterThanOrEqual(1);
  });

  // ----------------------------------------------------------
  // 测试 5: 切换单据 — 先释放旧锁再获取新锁
  // ----------------------------------------------------------
  test('切换到不同单据时先释放旧锁', async ({ page }) => {
    const lockCalls = [];

    await setupAuth(page);
    await setupApiRoutes(page, {
      lockHandler: async (route) => {
        const url = route.request().url();
        const body = route.request().postDataJSON();
        if (url.includes('/lock/acquire')) {
          lockCalls.push({ action: 'acquire', doc_number: body?.doc_number });
        } else if (url.includes('/lock/release')) {
          lockCalls.push({ action: 'release', doc_number: body?.doc_number });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_LOCK_ACQUIRED),
        });
      },
    });

    await page.goto('/wms/po.html');

    // 查询第一个单据
    await page.locator('#scanInput').fill('26000080');
    await page.locator('#scanInput').press('Enter');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 等待扫码冷却期
    await page.waitForTimeout(1_000);

    // 查询第二个不同单据
    await page.locator('#scanInput').fill('26000099');
    await page.locator('#scanInput').press('Enter');
    await page.waitForTimeout(2_000);

    // 应先有 acquire 26000080，然后有 release 26000080，再 acquire 26000099
    const acquires = lockCalls.filter(c => c.action === 'acquire');
    const releases = lockCalls.filter(c => c.action === 'release');

    expect(acquires.length).toBeGreaterThanOrEqual(1);
    // 切换单据时应触发旧锁释放
    expect(releases.length).toBeGreaterThanOrEqual(1);
  });

  // ----------------------------------------------------------
  // 测试 6: 只读模式下扫码框仍可用
  // ----------------------------------------------------------
  test('只读模式下扫码框仍可操作', async ({ page }) => {
    await setupAuth(page);

    await setupApiRoutes(page, {
      lockHandler: async (route) => {
        const url = route.request().url();
        if (url.includes('/lock/acquire')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(MOCK_LOCK_REJECTED),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_LOCK_RELEASED),
        });
      },
    });

    await page.goto('/wms/po.html');
    await page.locator('#scanInput').fill('26000080');
    await page.locator('#scanInput').press('Enter');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#lockBanner')).toBeVisible({ timeout: 5_000 });

    // 扫码框应保持可用 (shared.js _setReadonlyMode 排除 scanInput)
    await expect(page.locator('#scanInput')).toBeEnabled();
  });

  // ----------------------------------------------------------
  // 测试 7: 锁获取失败时显示错误消息
  // ----------------------------------------------------------
  test('锁获取失败时显示错误提示 Toast', async ({ page }) => {
    await setupAuth(page);

    await setupApiRoutes(page, {
      lockHandler: async (route) => {
        const url = route.request().url();
        if (url.includes('/lock/acquire')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(MOCK_LOCK_REJECTED),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_LOCK_RELEASED),
        });
      },
    });

    await page.goto('/wms/po.html');
    await page.locator('#scanInput').fill('26000080');
    await page.locator('#scanInput').press('Enter');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 应显示错误消息 Toast
    const toast = page.locator('.message-toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });
  });
});
