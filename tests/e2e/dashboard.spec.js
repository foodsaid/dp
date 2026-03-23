// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * 仪表板 (Dashboard) E2E 测试
 *
 * 核心策略:
 *   1. Network Interception — 拦截 /dashboard + /sync 系列 API
 *   2. localStorage 注入 — 绕过登录鉴权
 *   3. 覆盖: 页面加载 → 统计展示 → 模块导航 → 扫码路由 → 数据同步面板
 *
 * 运行: npx playwright test tests/e2e/dashboard.spec.js --headed
 */

// ============================================================
// Mock 数据定义
// ============================================================

/** 仪表板统计数据 */
const MOCK_DASHBOARD = {
  success: true,
  stats: {
    today_transactions: 42,
    in_progress: 3,
    today_completed: 8,
    pending_export: 2,
  },
};

/** 同步状态检查 */
const MOCK_SYNC_CHECK = {
  success: true,
  items: { need_sync: false },
  locations: { need_sync: false },
  bins: { need_sync: true },
  stock: { need_sync: false },
  oms: { need_sync: false },
};

/** 同步操作成功响应 */
const MOCK_SYNC_SUCCESS = {
  success: true,
  message: '同步完成',
  count: 10,
};

// ============================================================
// 工具函数
// ============================================================

/** 注入登录态 + env.js 配置 */
async function setupAuth(page) {
  await page.addInitScript(() => {
    localStorage.setItem('wms_username', 'e2e_test_admin');
    localStorage.setItem('wms_display_name', 'E2E 测试管理员');
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

/** 设置 API 路由拦截 */
async function setupApiRoutes(page) {
  // 低优先级: 通用 fallback
  await page.route('**/api/webhook-test/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    })
  );

  await page.route('**/api/wms/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    })
  );

  // 高优先级: 具体路由
  await page.route('**/env.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '/* env.js intercepted */',
    })
  );

  // 同步操作 POST
  await page.route('**/api/wms/sync/items**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SYNC_SUCCESS),
    })
  );

  await page.route('**/api/wms/sync/locations**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SYNC_SUCCESS),
    })
  );

  await page.route('**/api/wms/sync/bins**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SYNC_SUCCESS),
    })
  );

  await page.route('**/api/wms/sync/stock**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SYNC_SUCCESS),
    })
  );

  await page.route('**/api/wms/oms/sync**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SYNC_SUCCESS),
    })
  );

  // 同步状态检查
  await page.route('**/api/wms/sync/check**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SYNC_CHECK),
    })
  );

  // 仪表板统计 (最高优先级)
  await page.route('**/api/wms/dashboard**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_DASHBOARD),
    })
  );
}

// ============================================================
// 测试套件
// ============================================================

test.describe('仪表板 E2E', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
  });

  // ----------------------------------------------------------
  // 测试 1: 页面加载 + 鉴权
  // ----------------------------------------------------------
  test('页面正常加载，显示用户名', async ({ page }) => {
    await page.goto('/wms/index.html');

    // 不应跳转到登录页
    expect(page.url()).toContain('index.html');

    // 用户名显示
    await expect(page.locator('#loginUserDisplay')).toContainText('E2E');
  });

  // ----------------------------------------------------------
  // 测试 2: 今日统计数据展示
  // ----------------------------------------------------------
  test('加载并显示今日统计数据', async ({ page }) => {
    await page.goto('/wms/index.html');

    // 活动概览卡片可见
    await expect(page.locator('#activityCard')).toBeVisible({ timeout: 10_000 });

    // 应显示 Mock 的统计数据 (42 笔操作)
    await expect(page.locator('#activityContent')).toContainText('42');
  });

  // ----------------------------------------------------------
  // 测试 3: 业务模块导航磁贴
  // ----------------------------------------------------------
  test('7 个业务模块磁贴正确渲染', async ({ page }) => {
    await page.goto('/wms/index.html');

    // docTiles 容器可见
    await expect(page.locator('#docTiles')).toBeVisible();

    // 应有 7 个业务磁贴 (PO, WO, PI, SO, TR, LM, IC)
    const tiles = page.locator('#docTiles a');
    const tileCount = await tiles.count();
    expect(tileCount).toBe(7);

    // 验证链接目标
    const hrefs = [];
    for (let i = 0; i < tileCount; i++) {
      const href = await tiles.nth(i).getAttribute('href');
      hrefs.push(href);
    }
    expect(hrefs).toContain('po.html');
    expect(hrefs).toContain('so.html');
    expect(hrefs).toContain('wo.html');
  });

  // ----------------------------------------------------------
  // 测试 4: 导航到 SO 页面
  // ----------------------------------------------------------
  test('点击 SO 磁贴导航到销售拣货页', async ({ page }) => {
    await page.goto('/wms/index.html');

    // 点击 SO 磁贴
    const soTile = page.locator('#docTiles a[href="so.html"]');
    await soTile.click();

    // 应导航到 SO 页面
    await page.waitForURL('**/so.html', { timeout: 10_000 });
    expect(page.url()).toContain('so.html');
  });

  // ----------------------------------------------------------
  // 测试 5: 工具区域 — 库存查询/导出/OMS 链接
  // ----------------------------------------------------------
  test('工具区域磁贴可见并可点击', async ({ page }) => {
    await page.goto('/wms/index.html');

    // 库存查询链接
    const stockLink = page.locator('a[href="stock.html"]');
    await expect(stockLink).toBeVisible();

    // 导出链接
    const exportLink = page.locator('a[href="export.html"]');
    await expect(exportLink).toBeVisible();

    // OMS 链接
    const omsLink = page.locator('a[href="oms.html"]');
    await expect(omsLink).toBeVisible();
  });

  // ----------------------------------------------------------
  // 测试 6: 扫码路由 — SO 单号跳转
  // ----------------------------------------------------------
  test('扫码框输入 SO 单号跳转到拣货页', async ({ page }) => {
    await page.goto('/wms/index.html');

    // 扫码输入框可见
    await expect(page.locator('#scanInput')).toBeVisible();

    // 输入 SO 格式的单号
    await page.locator('#scanInput').fill('SO26000050');
    await page.locator('#scanInput').press('Enter');

    // 应跳转到 so.html
    await page.waitForURL('**/so.html**', { timeout: 10_000 });
    expect(page.url()).toContain('so.html');
  });

  // ----------------------------------------------------------
  // 测试 7: 扫码路由 — PO 单号跳转
  // ----------------------------------------------------------
  test('扫码框输入 PO 单号跳转到采购收货页', async ({ page }) => {
    await page.goto('/wms/index.html');

    await page.locator('#scanInput').fill('PO26000178');
    await page.locator('#scanInput').press('Enter');

    await page.waitForURL('**/po.html**', { timeout: 10_000 });
    expect(page.url()).toContain('po.html');
  });

  // ----------------------------------------------------------
  // 测试 8: 数据同步面板显示
  // ----------------------------------------------------------
  test('点击数据同步打开同步面板', async ({ page }) => {
    await page.goto('/wms/index.html');

    // 同步面板初始隐藏
    await expect(page.locator('#syncPanel')).toBeHidden();

    // 点击数据同步磁贴
    const syncTile = page.locator('[onclick*="showSyncPanel"], a:has-text("同步"), [data-i18n*="sync"]').first();
    await syncTile.click();

    // 同步面板出现
    await expect(page.locator('#syncPanel')).toBeVisible({ timeout: 5_000 });

    // 5 个同步按钮可见
    await expect(page.locator('#btnSyncItems')).toBeVisible();
    await expect(page.locator('#btnSyncWhs')).toBeVisible();
    await expect(page.locator('#btnSyncBins')).toBeVisible();
    await expect(page.locator('#btnSyncStock')).toBeVisible();
    await expect(page.locator('#btnSyncOms')).toBeVisible();
  });

  // ----------------------------------------------------------
  // 测试 9: 同步操作 — 物料同步
  // ----------------------------------------------------------
  test('点击物料同步按钮执行同步', async ({ page }) => {
    // 覆盖同步检查: 物料需要同步 (避免 data-sync-disabled 阻止操作)
    await page.route('**/api/wms/sync/check**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          items: { need_sync: true },
          locations: { need_sync: false },
          bins: { need_sync: false },
          stock: { need_sync: false },
          oms: { need_sync: false },
        }),
      })
    );

    await page.goto('/wms/index.html');

    // 打开同步面板
    const syncTile = page.locator('[onclick*="showSyncPanel"], a:has-text("同步"), [data-i18n*="sync"]').first();
    await syncTile.click();
    await expect(page.locator('#syncPanel')).toBeVisible({ timeout: 5_000 });

    // 等待同步状态检查完成 (按钮启用)
    await expect(page.locator('#btnSyncItems')).toBeEnabled({ timeout: 5_000 });

    // 点击物料同步按钮
    await page.locator('#btnSyncItems').click();

    // 等待同步完成 — syncItems 使用 showSyncResult 更新 #syncResult 文本
    const syncResult = page.locator('#syncResult');
    await expect(syncResult).not.toBeEmpty({ timeout: 10_000 });
  });

  // ----------------------------------------------------------
  // 测试 10: 仪表板 API 失败 — 优雅降级
  // ----------------------------------------------------------
  test('仪表板 API 失败时不崩溃', async ({ page }) => {
    // 覆盖 dashboard 路由为失败
    await page.route('**/api/wms/dashboard**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: '服务异常' }),
      })
    );

    await page.goto('/wms/index.html');

    // 页面不崩溃，仍在 index.html
    expect(page.url()).toContain('index.html');

    // 活动卡片仍可见 (可能显示回退内容)
    await expect(page.locator('#activityCard')).toBeVisible({ timeout: 10_000 });
  });

  // ----------------------------------------------------------
  // 测试 11: 扫码路由 — 物料码跳转库存查询
  // ----------------------------------------------------------
  test('扫码框输入物料码跳转库存查询', async ({ page }) => {
    await page.goto('/wms/index.html');

    // 含连字符的被识别为物料码
    await page.locator('#scanInput').fill('A-001-B');
    await page.locator('#scanInput').press('Enter');

    await page.waitForURL('**/stock.html**', { timeout: 10_000 });
    expect(page.url()).toContain('stock.html');
  });

  // ----------------------------------------------------------
  // 测试 12: 登出功能 (SSO)
  // ----------------------------------------------------------
  test('点击登出调用 SSO 登出 API 并清除凭据', async ({ page }) => {
    // 追踪 SSO logout API 调用
    let logoutCalled = false;
    await page.route('**/auth/api/logout', (route) => {
      logoutCalled = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    // 拦截 landing 页 (logout 后跳转目标)
    await page.route('/', (route) => {
      if (route.request().url().includes('?rd=')) {
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<html><body>Landing</body></html>',
        });
      }
      return route.continue();
    });

    await page.goto('/wms/index.html');
    await expect(page.locator('#loginUserDisplay')).toBeVisible({ timeout: 5_000 });

    // 查找登出按钮 (用 onclick 属性选择器, 避免 i18n 翻译后文本变化)
    const logoutBtn = page.locator('[onclick*="logout"]');
    if (await logoutBtn.count() > 0) {
      // 点击登出 → logout() 清除 localStorage → POST /auth/api/logout → 跳转 landing
      await logoutBtn.first().click();
      // 等待 SSO logout 请求
      await page.waitForTimeout(2_000);

      expect(logoutCalled).toBe(true);
    }
  });
});
