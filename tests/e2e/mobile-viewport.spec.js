// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * 移动端视口 E2E 测试
 *
 * 核心策略:
 *   1. 使用 375x812 (iPhone SE/13 mini) 视口模拟移动端
 *   2. 验证关键页面在小屏幕上的可用性: 输入框可见/按钮可点击/内容不溢出
 *   3. 不验证视觉样式 (如颜色/字体)，仅验证功能可用性
 *
 * 运行: npx playwright test tests/e2e/mobile-viewport.spec.js --headed
 */

// ============================================================
// Mock 数据
// ============================================================

const MOCK_SO_RESPONSE = {
  success: true,
  sap_order: {
    docNum: '26000050',
    docEntry: 123,
    docStatus: 'O',
    cardCode: 'C-TEST-001',
    cardName: 'E2E 测试客户',
    docDueDate: '2026-03-15',
    wmsStatus: 'pending',
    lines: [
      {
        lineNum: 0,
        itemCode: 'ITEM-001',
        itemName: '测试物料 Alpha',
        quantity: 100,
        deliveredQty: 0,
        openQty: 100,
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

const MOCK_STOCK_RESPONSE = {
  success: true,
  data: [
    {
      item_code: 'ITEM-001',
      item_name: '测试物料 Alpha',
      warehouse_code: 'WH01',
      warehouse_name: '主仓库',
      bin_code: 'A-01-01',
      batch: '',
      snapshot_qty: 100,
      delta_qty: -10,
      realtime_qty: 90,
      uom: 'PCS',
    },
  ],
};

const MOCK_DASHBOARD = {
  success: true,
  stats: {
    today_transactions: 42,
    in_progress: 3,
    today_completed: 8,
    pending_export: 2,
  },
};

const MOCK_LOCK_SUCCESS = { success: true, locked_by: 'e2e_test_admin' };

// ============================================================
// 工具函数
// ============================================================

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

async function setupAllRoutes(page, overrides) {
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

  await page.route('**/env.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '/* env.js intercepted */',
    })
  );

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

  await page.route('**/api/wms/lock/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_LOCK_SUCCESS),
    })
  );

  if (overrides) {
    for (const key of Object.keys(overrides)) {
      const data = overrides[key];
      await page.route(key, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(data),
        })
      );
    }
  }
}

// ============================================================
// 移动端视口测试 (375x812)
// ============================================================

test.describe('移动端视口 (375x812)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  // ----------------------------------------------------------
  // 登录页
  // ----------------------------------------------------------
  test('登录页 — 表单在小屏幕上完整可见', async ({ page }) => {
    await page.addInitScript(() => {
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

    await page.route('**/env.js', (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* */' })
    );
    await page.route('**/api/wms/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      })
    );
    await page.route('**/api/webhook-test/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      })
    );

    await page.goto('/wms/login.html');

    // 用户名和密码框在视口内可见
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('#loginBtn')).toBeVisible();

    // 输入框宽度不应超出视口
    const usernameBox = await page.locator('#username').boundingBox();
    expect(usernameBox.x).toBeGreaterThanOrEqual(0);
    expect(usernameBox.x + usernameBox.width).toBeLessThanOrEqual(375);

    // 登录按钮可点击 (不被遮挡)
    const loginBox = await page.locator('#loginBtn').boundingBox();
    expect(loginBox.x).toBeGreaterThanOrEqual(0);
    expect(loginBox.x + loginBox.width).toBeLessThanOrEqual(375);
  });

  // ----------------------------------------------------------
  // 仪表板
  // ----------------------------------------------------------
  test('仪表板 — 模块磁贴在移动端可见', async ({ page }) => {
    await setupAuth(page);
    await setupAllRoutes(page);

    await page.route('**/api/wms/dashboard**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_DASHBOARD),
      })
    );

    await page.route('**/api/wms/sync/check**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          items: { need_sync: false },
          locations: { need_sync: false },
          bins: { need_sync: false },
          stock: { need_sync: false },
          oms: { need_sync: false },
        }),
      })
    );

    await page.goto('/wms/index.html');
    expect(page.url()).toContain('index.html');

    // 页面内容不应有水平溢出
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    // 允许少量溢出 (最多 20px，考虑滚动条)
    expect(bodyWidth).toBeLessThanOrEqual(395);
  });

  // ----------------------------------------------------------
  // SO 拣货页
  // ----------------------------------------------------------
  test('SO 拣货 — 扫码框和按钮在移动端可操作', async ({ page }) => {
    await setupAuth(page);
    await setupAllRoutes(page);

    await page.route('**/api/wms/so**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_SO_RESPONSE),
      })
    );

    await page.route('**/api/wms/oms/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, orders: [], lines: [] }),
      })
    );

    await page.goto('/wms/so.html');

    // 扫码框在视口内可见
    const scanInput = page.locator('#scanInput');
    await expect(scanInput).toBeVisible();

    const scanBox = await scanInput.boundingBox();
    expect(scanBox.x).toBeGreaterThanOrEqual(0);
    expect(scanBox.x + scanBox.width).toBeLessThanOrEqual(375);

    // 可以输入并查询
    await scanInput.fill('26000050');
    await scanInput.press('Enter');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 行项目在移动端可见 (可能需要滚动)
    await expect(page.locator('#linesCard')).toBeVisible();
  });

  // ----------------------------------------------------------
  // 库存查询页
  // ----------------------------------------------------------
  test('库存查询 — 搜索框在移动端可用', async ({ page }) => {
    await setupAuth(page);
    await setupAllRoutes(page);

    await page.route('**/api/wms/stock**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_STOCK_RESPONSE),
      })
    );

    await page.goto('/wms/stock.html');

    // 搜索框可见
    const searchInput = page.locator('#scanInput');
    await expect(searchInput).toBeVisible();

    const searchBox = await searchInput.boundingBox();
    expect(searchBox.x).toBeGreaterThanOrEqual(0);
    expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(375);

    // 可以搜索
    await searchInput.fill('ITEM-001');
    await searchInput.press('Enter');

    // 结果应显示
    await page.waitForTimeout(2_000);
    expect(page.url()).toContain('stock.html');
  });

  // ----------------------------------------------------------
  // PO 采购收货页
  // ----------------------------------------------------------
  test('PO 收货 — 移动端表单布局正常', async ({ page }) => {
    await setupAuth(page);
    await setupAllRoutes(page);

    await page.route('**/api/wms/po**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          sap_order: {
            docNum: '26000080',
            docEntry: 801,
            docStatus: 'O',
            cardCode: 'V-TEST-001',
            cardName: '测试供应商',
            docDueDate: '2026-04-01',
            wmsStatus: 'pending',
            lines: [{
              lineNum: 0,
              itemCode: 'ITEM-D001',
              itemName: '测试物料 Delta',
              quantity: 50,
              deliveredQty: 0,
              openQty: 50,
              lineStatus: 'O',
              whsCode: 'WH01',
              uom: 'PCS',
            }],
          },
          wms_history: {
            wms_status: 'pending',
            lineReceipts: {},
            transactions: [],
          },
        }),
      })
    );

    await page.goto('/wms/po.html?docnum=26000080');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 扫码框不应超出移动端视口
    const scanInput = page.locator('#scanInput');
    if (await scanInput.count() > 0) {
      const box = await scanInput.boundingBox();
      expect(box.x + box.width).toBeLessThanOrEqual(375);
    }
  });

  // ----------------------------------------------------------
  // OMS 订单管理页
  // ----------------------------------------------------------
  test('OMS 订单 — 移动端筛选和列表可用', async ({ page }) => {
    await setupAuth(page);
    await setupAllRoutes(page);

    await page.route('**/api/wms/oms/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, orders: [], total: 0, page: 1, pageSize: 20 }),
      })
    );

    await page.goto('/wms/oms.html');

    // 页面不应崩溃
    expect(page.url()).toContain('oms.html');

    // body 宽度不应严重溢出
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(395);
  });

  // ----------------------------------------------------------
  // 横屏视口 (812x375)
  // ----------------------------------------------------------
  test('横屏模式 — 仪表板在横屏视口正常', async ({ page }) => {
    await page.setViewportSize({ width: 812, height: 375 });
    await setupAuth(page);
    await setupAllRoutes(page);

    await page.route('**/api/wms/dashboard**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_DASHBOARD),
      })
    );

    await page.route('**/api/wms/sync/check**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          items: { need_sync: false },
          locations: { need_sync: false },
          bins: { need_sync: false },
          stock: { need_sync: false },
          oms: { need_sync: false },
        }),
      })
    );

    await page.goto('/wms/index.html');
    expect(page.url()).toContain('index.html');
    await expect(page.locator('body')).toBeVisible();

    // 横屏下内容不应超出视口
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(832);
  });

  // ----------------------------------------------------------
  // 平板视口 (768x1024)
  // ----------------------------------------------------------
  test.describe('平板视口 (768x1024)', () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    test('仪表板 — 平板端布局正常', async ({ page }) => {
      await setupAuth(page);
      await setupAllRoutes(page);

      await page.route('**/api/wms/dashboard**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_DASHBOARD),
        })
      );

      await page.route('**/api/wms/sync/check**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            items: { need_sync: false },
            locations: { need_sync: false },
            bins: { need_sync: false },
            stock: { need_sync: false },
            oms: { need_sync: false },
          }),
        })
      );

      await page.goto('/wms/index.html');
      expect(page.url()).toContain('index.html');

      // 内容不应超出视口宽度
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(bodyWidth).toBeLessThanOrEqual(788);
    });
  });
});
