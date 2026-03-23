// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * 生产领料 (PI) E2E 测试
 *
 * 核心策略:
 *   1. Network Interception — 拦截 /pi 查询 + /transaction 提交 + /lock 锁管理
 *   2. localStorage 注入 — 绕过登录鉴权
 *   3. 覆盖: 查询 → BOM 行显示 → 选择行 → 填写发料 → 提交 → 历史 → 一键发料
 *
 * 运行: npx playwright test tests/e2e/pi-issue.spec.js --headed
 */

// ============================================================
// Mock 数据定义
// ============================================================

const MOCK_PI_RESPONSE = {
  success: true,
  sap_order: {
    docNum: '36000010',
    docEntry: 1001,
    status: 'R',
    productCode: 'FG-001',
    productName: 'E2E 测试成品',
    plannedQty: 500,
    completedQty: 100,
    wmsStatus: 'in_progress',
    lines: [
      {
        lineNum: 0,
        itemCode: 'ITEM-G001',
        itemName: 'BOM 原料 Alpha',
        baseQty: 200,
        plannedQty: 200,
        issuedQty: 0,
        whsCode: 'WH01',
        uom: 'KG',
      },
      {
        lineNum: 1,
        itemCode: 'ITEM-G002',
        itemName: 'BOM 原料 Beta',
        baseQty: 100,
        plannedQty: 100,
        issuedQty: 50,
        whsCode: 'WH01',
        uom: 'PCS',
      },
      {
        lineNum: 2,
        itemCode: 'ITEM-G003',
        itemName: 'BOM 原料 Gamma (已完成)',
        baseQty: 80,
        plannedQty: 80,
        issuedQty: 80,
        whsCode: 'WH02',
        uom: 'PCS',
      },
    ],
  },
  wms_history: {
    wms_status: 'in_progress',
    lineReceipts: { '1': 30 },
    transactions: [
      {
        transaction_time: '2026-03-08 09:00',
        item_code: 'ITEM-G002',
        item_name: 'BOM 原料 Beta',
        quantity: 30,
        performed_by: '仓库操作员',
        remarks: '第一批发料',
      },
    ],
  },
};

const MOCK_PI_CLOSED = {
  success: true,
  sap_order: {
    docNum: '36000011',
    docEntry: 1002,
    status: 'C',
    productCode: 'FG-002',
    productName: '已关闭成品',
    plannedQty: 100,
    completedQty: 100,
    wmsStatus: 'completed',
    lines: [
      {
        lineNum: 0,
        itemCode: 'ITEM-G001',
        itemName: 'BOM 原料 Alpha',
        baseQty: 50,
        plannedQty: 50,
        issuedQty: 50,
        whsCode: 'WH01',
        uom: 'KG',
      },
    ],
  },
  wms_history: {
    wms_status: 'completed',
    lineReceipts: { '0': 0 },
    transactions: [],
  },
};

const MOCK_TX_SUCCESS = { success: true, message: '发料提交成功' };
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

async function setupApiRoutes(page, { piResponse = MOCK_PI_RESPONSE } = {}) {
  // 低优先级 fallback
  await page.route('**/api/webhook-test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":[]}' })
  );
  await page.route('**/api/wms/**', (route) => {
    const method = route.request().method();
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(method === 'GET' ? { success: true, data: [] } : { success: true }),
    });
  });

  // 高优先级路由
  await page.route('**/env.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* env.js intercepted */' })
  );

  await page.route('**/api/wms/masterdata**', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        success: true, items: [],
        warehouses: [{ whsCode: 'WH01', whsName: '主仓库' }, { whsCode: 'WH02', whsName: '备用仓' }],
        bins: [],
      }),
    })
  );

  await page.route('**/api/wms/lock/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LOCK_SUCCESS) })
  );

  await page.route('**/api/wms/transaction**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TX_SUCCESS) })
  );

  await page.route('**/api/wms/oms/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"orders":[],"lines":[]}' })
  );

  // PI 查询 (最高优先级)
  await page.route('**/api/wms/pi**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(piResponse) })
  );
}

// ============================================================
// 测试套件
// ============================================================

test.describe('生产领料 (PI) E2E', () => {
  // 测试 1: 页面加载
  test('页面正常加载，扫码输入框可见', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/pi.html');

    expect(page.url()).toContain('pi.html');
    await expect(page.locator('#scanInput')).toBeVisible();
    await expect(page.locator('#orderCard')).toBeHidden();
  });

  // 测试 2: 输入 PI 单号查询
  test('输入 PI 单号查询并显示订单信息', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/pi.html');

    await page.locator('#scanInput').fill('36000010');
    await page.locator('#scanInput').press('Enter');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#docNum')).toContainText('36000010');
    await expect(page.locator('#productCode')).toContainText('FG-001');
    await expect(page.locator('#productName')).toContainText('E2E 测试成品');
  });

  // 测试 3: URL 参数自动加载
  test('URL 带 docnum 参数自动加载订单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/pi.html?docnum=36000010');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#docNum')).toContainText('36000010');
  });

  // 测试 4: BOM 行项目显示
  test('BOM 物料清单正确显示多行', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/pi.html?docnum=36000010');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    const tbody = page.locator('#linesBody');
    await expect(tbody).toContainText('ITEM-G001');
    await expect(tbody).toContainText('ITEM-G002');
    await expect(tbody).toContainText('ITEM-G003');
  });

  // 测试 5: 点击发料按钮打开发料表单
  test('点击发料按钮弹出发料表单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/pi.html?docnum=36000010');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 点击第一行发料按钮
    const issueBtn = page.locator('#linesBody button').first();
    await issueBtn.click();

    await expect(page.locator('#issueCard')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#issueQty')).toBeVisible();
    await expect(page.locator('#issueUser')).toBeVisible();
  });

  // 测试 6: 提交发料 — 成功流程
  test('填写发料信息并成功提交', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/pi.html?docnum=36000010');

    page.on('dialog', (dialog) => dialog.accept());

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    const issueBtn = page.locator('#linesBody button').first();
    await issueBtn.click();
    await expect(page.locator('#issueCard')).toBeVisible({ timeout: 5_000 });

    // 数量应已预填
    const qtyValue = await page.locator('#issueQty').inputValue();
    expect(Number(qtyValue)).toBeGreaterThan(0);

    // 填写操作人
    await page.locator('#issueUser').fill('E2E发料员');

    // 提交
    await page.locator('#issueForm button[type="submit"]').click();

    // 成功 Toast
    const toast = page.locator('.message-toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // 发料表单应关闭
    await expect(page.locator('#issueCard')).toBeHidden({ timeout: 5_000 });
  });

  // 测试 7: 取消发料 — 关闭表单
  test('点击取消关闭发料表单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/pi.html?docnum=36000010');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    await page.locator('#linesBody button').first().click();
    await expect(page.locator('#issueCard')).toBeVisible({ timeout: 5_000 });

    await page.locator('button', { hasText: /取消/ }).click();
    await expect(page.locator('#issueCard')).toBeHidden({ timeout: 5_000 });
  });

  // 测试 8: 发料历史记录
  test('发料历史表格正确显示操作记录', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/pi.html?docnum=36000010');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#historyCard')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#historyBody')).toContainText('ITEM-G002');
    await expect(page.locator('#historyBody')).toContainText('仓库操作员');
  });

  // 测试 9: 一键发料按钮可见
  test('有待发行时显示一键发料按钮', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/pi.html?docnum=36000010');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#batchCard')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.btn-oneclick')).toContainText('一键发料');
  });

  // 测试 10: 已关闭订单
  test('已关闭订单正常显示不崩溃', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page, { piResponse: MOCK_PI_CLOSED });
    await page.goto('/wms/pi.html?docnum=36000011');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });
    // 一键发料应隐藏
    await expect(page.locator('#batchCard')).toBeHidden();
    expect(page.url()).toContain('pi.html');
  });

  // 测试 11: 扫物料码定位 BOM 行
  test('扫物料条码自动选中对应 BOM 行', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/pi.html?docnum=36000010');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 等待扫码冷却期
    await page.waitForTimeout(1_000);

    await page.locator('#scanInput').fill('ITEM-G001');
    await page.locator('#scanInput').press('Enter');

    // 应打开发料表单
    await expect(page.locator('#issueCard')).toBeVisible({ timeout: 5_000 });
  });

  // 测试 12: 重新查询
  test('重新查询清空当前订单状态', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/pi.html?docnum=36000010');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    const resetBtn = page.locator('button', { hasText: /重新查询/ });
    if (await resetBtn.count() > 0) {
      await resetBtn.first().click();
      await expect(page.locator('#orderCard')).toBeHidden({ timeout: 5_000 });
    }
  });

  // 测试 13: API 查询失败不崩溃
  test('API 返回失败时不崩溃', async ({ page }) => {
    await setupAuth(page);

    await page.route('**/api/webhook-test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' })
    );
    await page.route('**/api/wms/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":[]}' })
    );
    await page.route('**/env.js', (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* */' })
    );
    await page.route('**/api/wms/lock/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LOCK_SUCCESS) })
    );
    await page.route('**/api/wms/pi**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"服务器错误"}' })
    );

    await page.goto('/wms/pi.html');
    await page.locator('#scanInput').fill('36000010');
    await page.locator('#scanInput').press('Enter');

    await page.waitForTimeout(3_000);
    expect(page.url()).toContain('pi.html');
  });
});
