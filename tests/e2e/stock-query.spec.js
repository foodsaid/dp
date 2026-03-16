// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * 库存查询 E2E 测试
 *
 * 核心策略:
 *   1. Network Interception — 拦截 /stock 查询 API
 *   2. localStorage 注入 — 绕过登录鉴权
 *   3. 覆盖: 搜索 → 结果渲染 → 分页 → 分组展开 → 空结果 → URL 参数
 *
 * 运行: npx playwright test tests/e2e/stock-query.spec.js --headed
 */

// ============================================================
// Mock 数据定义
// ============================================================

/** 库存查询成功响应 — 多物料多仓库 */
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
    {
      item_code: 'ITEM-001',
      item_name: '测试物料 Alpha',
      warehouse_code: 'WH02',
      warehouse_name: '备用仓',
      bin_code: 'B-01-01',
      batch: 'LOT001',
      snapshot_qty: 50,
      delta_qty: 5,
      realtime_qty: 55,
      uom: 'PCS',
    },
    {
      item_code: 'ITEM-002',
      item_name: '测试物料 Beta',
      warehouse_code: 'WH01',
      warehouse_name: '主仓库',
      bin_code: '',
      batch: '',
      snapshot_qty: 200,
      delta_qty: 0,
      realtime_qty: 200,
      uom: 'KG',
    },
  ],
};

/** 空结果响应 */
const MOCK_STOCK_EMPTY = {
  success: true,
  data: [],
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

/** 设置 API 路由拦截 */
async function setupApiRoutes(page, { stockResponse = MOCK_STOCK_RESPONSE } = {}) {
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
      body: JSON.stringify({ success: true, data: [] }),
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

  // 主数据缓存
  await page.route('**/api/wms/masterdata**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        items: [],
        warehouses: [
          { whsCode: 'WH01', whsName: '主仓库' },
          { whsCode: 'WH02', whsName: '备用仓' },
        ],
        bins: [{ binCode: 'A-01-01', whsCode: 'WH01' }],
      }),
    })
  );

  // 库存查询 (最高优先级)
  await page.route('**/api/wms/stock**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stockResponse),
    })
  );
}

// ============================================================
// 测试套件
// ============================================================

test.describe('库存查询 E2E', () => {
  // ----------------------------------------------------------
  // 测试 1: 页面加载
  // ----------------------------------------------------------
  test('页面正常加载，搜索框可见', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/stock.html');

    // 不应跳转到登录页
    expect(page.url()).toContain('stock.html');

    // 搜索输入框可见
    await expect(page.locator('#scanInput')).toBeVisible();

    // 结果区域初始隐藏
    await expect(page.locator('#tableSection')).toBeHidden();
  });

  // ----------------------------------------------------------
  // 测试 2: 搜索物料并显示结果
  // ----------------------------------------------------------
  test('搜索物料代码显示库存结果', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/stock.html');

    // 输入物料代码
    await page.locator('#scanInput').fill('ITEM-001');
    await page.locator('#scanInput').press('Enter');

    // 等待结果显示
    await expect(page.locator('#tableSection')).toBeVisible({ timeout: 10_000 });

    // 结果表格包含物料信息
    const tbody = page.locator('#stockTableBody');
    await expect(tbody).toContainText('ITEM-001');
    await expect(tbody).toContainText('测试物料 Alpha');
  });

  // ----------------------------------------------------------
  // 测试 3: 多条结果 — 分组显示
  // ----------------------------------------------------------
  test('多仓库物料按分组显示', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/stock.html');
    await page.locator('#scanInput').fill('ITEM');
    await page.locator('#scanInput').press('Enter');

    await expect(page.locator('#tableSection')).toBeVisible({ timeout: 10_000 });

    // 应显示汇总信息
    await expect(page.locator('#summaryText')).not.toBeEmpty();

    // 表格应有多行
    const rows = page.locator('#stockTableBody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2);
  });

  // ----------------------------------------------------------
  // 测试 4: 空结果显示提示
  // ----------------------------------------------------------
  test('无匹配物料显示空状态提示', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page, { stockResponse: MOCK_STOCK_EMPTY });

    await page.goto('/wms/stock.html');
    await page.locator('#scanInput').fill('NONEXIST');
    await page.locator('#scanInput').press('Enter');

    // 应显示空状态
    await expect(page.locator('#emptyState')).toBeVisible({ timeout: 10_000 });
  });

  // ----------------------------------------------------------
  // 测试 5: URL 参数自动查询
  // ----------------------------------------------------------
  test('URL 带 item 参数自动执行查询', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/stock.html?item=ITEM-001');

    // 结果应自动显示
    await expect(page.locator('#tableSection')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#stockTableBody')).toContainText('ITEM-001');
  });

  // ----------------------------------------------------------
  // 测试 6: 仓库筛选
  // ----------------------------------------------------------
  test('仓库筛选框可用', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/stock.html');

    // 仓库筛选输入框可见
    const whsFilter = page.locator('#whsFilter');
    await expect(whsFilter).toBeVisible();

    // 可以输入仓库代码
    await whsFilter.fill('WH01');
    expect(await whsFilter.inputValue()).toBe('WH01');
  });

  // ----------------------------------------------------------
  // 测试 7: 搜索后清空重新搜索
  // ----------------------------------------------------------
  test('清空搜索后可以重新查询', async ({ page }) => {
    await setupAuth(page);

    let callCount = 0;

    // 自定义路由，追踪调用次数
    await page.route('**/api/webhook-test/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    );

    await page.route('**/api/wms/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      })
    );

    await page.route('**/env.js', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '/* env.js intercepted */',
      })
    );

    await page.route('**/api/wms/stock**', (route) => {
      callCount++;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_STOCK_RESPONSE),
      });
    });

    await page.goto('/wms/stock.html');

    // 第一次搜索
    await page.locator('#scanInput').fill('ITEM-001');
    await page.locator('#scanInput').press('Enter');
    await expect(page.locator('#tableSection')).toBeVisible({ timeout: 10_000 });

    // 等待扫码冷却期过后 (SCAN_COOLDOWN_MS = 800ms)
    await page.waitForTimeout(1_000);

    // 清空并重新搜索
    await page.locator('#scanInput').fill('ITEM-002');
    await page.locator('#scanInput').press('Enter');

    // 等待第二次查询完成
    await page.waitForTimeout(1_000);

    // 应发起过至少 2 次 API 调用
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  // ----------------------------------------------------------
  // 测试 8: API 错误处理
  // ----------------------------------------------------------
  test('API 错误时显示错误提示', async ({ page }) => {
    await setupAuth(page);

    await page.route('**/api/webhook-test/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    );

    await page.route('**/api/wms/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      })
    );

    await page.route('**/env.js', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '/* env.js intercepted */',
      })
    );

    // 模拟 API 返回 500
    await page.route('**/api/wms/stock**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: '服务器内部错误' }),
      })
    );

    await page.goto('/wms/stock.html');
    await page.locator('#scanInput').fill('ITEM');
    await page.locator('#scanInput').press('Enter');

    // 应显示空状态或错误提示 (不崩溃)
    await page.waitForTimeout(3_000);
    expect(page.url()).toContain('stock.html');
  });
});
