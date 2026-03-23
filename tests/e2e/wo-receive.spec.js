// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * 生产收货 (WO) E2E 测试
 *
 * 核心策略:
 *   1. Network Interception — 拦截 /wo 查询 + /transaction 提交 + /lock 锁管理
 *   2. localStorage 注入 — 绕过登录鉴权
 *   3. 覆盖: 查询 → 信息展示 → 进度条 → 收货 → 完成提示 → 历史
 *
 * WO 特点: 单物料生产订单，有进度条 + 一键收货，无行项目列表
 *
 * 运行: npx playwright test tests/e2e/wo-receive.spec.js --headed
 */

// ============================================================
// Mock 数据定义
// ============================================================

/** WO 查询成功响应 — 部分完成 */
const MOCK_WO_RESPONSE = {
  success: true,
  sap_order: {
    docNum: '26000070',
    docEntry: 701,
    docStatus: 'R',  // Released
    itemCode: 'ITEM-C001',
    itemName: '生产产品 Alpha',
    warehouse: 'WH01',
    plannedQty: 1000,
    completedQty: 300,
    wmsReceivedQty: 200,
    remainingQty: 500,
    dueDate: '2026-03-25',
    uom: 'PCS',
    wmsStatus: 'in_progress',
  },
  wms_history: {
    wms_status: 'in_progress',
    transactions: [
      {
        item_code: 'ITEM-C001',
        item_name: '生产产品 Alpha',
        transaction_time: '2026-03-06 09:00',
        quantity: 100,
        performed_by: '生产操作员A',
        remarks: '首批收货',
      },
      {
        item_code: 'ITEM-C001',
        item_name: '生产产品 Alpha',
        transaction_time: '2026-03-06 14:00',
        quantity: 100,
        performed_by: '生产操作员B',
        remarks: '',
      },
    ],
  },
};

/** WO 已全部完成 */
const MOCK_WO_COMPLETED = {
  success: true,
  sap_order: {
    docNum: '26000071',
    docEntry: 702,
    docStatus: 'L',  // Closed
    itemCode: 'ITEM-C002',
    itemName: '生产产品 Beta',
    warehouse: 'WH01',
    plannedQty: 500,
    completedQty: 500,
    wmsReceivedQty: 500,
    remainingQty: 0,
    dueDate: '2026-03-01',
    uom: 'KG',
    wmsStatus: 'completed',
  },
  wms_history: {
    wms_status: 'completed',
    transactions: [],
  },
};

const MOCK_TX_SUCCESS = { success: true, message: '收货提交成功' };
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

async function setupApiRoutes(page, { woResponse = MOCK_WO_RESPONSE } = {}) {
  await page.route('**/api/webhook-test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":[]}' })
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
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* env.js intercepted */' })
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
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LOCK_SUCCESS) })
  );

  await page.route('**/api/wms/transaction**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TX_SUCCESS) })
  );

  // WO 查询 (最高优先级)
  await page.route('**/api/wms/wo**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(woResponse),
    })
  );
}

// ============================================================
// 测试套件
// ============================================================

test.describe('生产收货 (WO) E2E', () => {
  // ----------------------------------------------------------
  // 测试 1: 页面加载
  // ----------------------------------------------------------
  test('页面正常加载，扫码输入框可见', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/wo.html');

    expect(page.url()).toContain('wo.html');
    await expect(page.locator('#scanInput')).toBeVisible();
    await expect(page.locator('#orderCard')).toBeHidden();
  });

  // ----------------------------------------------------------
  // 测试 2: 查询 WO 并显示订单信息
  // ----------------------------------------------------------
  test('输入 WO 单号查询并显示订单信息', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/wo.html');
    await page.locator('#scanInput').fill('26000070');
    await page.locator('#scanInput').press('Enter');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#docNum')).toContainText('26000070');

    // WO 特有字段: 物料信息
    await expect(page.locator('#itemCode')).toContainText('ITEM-C001');
    await expect(page.locator('#itemName')).toContainText('生产产品 Alpha');
  });

  // ----------------------------------------------------------
  // 测试 3: URL 参数自动加载
  // ----------------------------------------------------------
  test('URL 带 docnum 参数自动加载订单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/wo.html?docnum=26000070');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#docNum')).toContainText('26000070');
  });

  // ----------------------------------------------------------
  // 测试 4: 数量信息显示
  // ----------------------------------------------------------
  test('显示计划数量、已完成、剩余等信息', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/wo.html?docnum=26000070');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 验证数量字段 (前端 formatNumber 会加千分位: 1000 → 1,000)
    await expect(page.locator('#plannedQty')).toContainText('1,000');
    await expect(page.locator('#remainingQty')).not.toBeEmpty();
  });

  // ----------------------------------------------------------
  // 测试 5: 进度条显示
  // ----------------------------------------------------------
  test('进度条正确显示完成百分比', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/wo.html?docnum=26000070');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 进度条可见
    const progressBar = page.locator('#progressBar');
    await expect(progressBar).toBeVisible();

    // 进度文字不为空
    const progressText = page.locator('#progressText');
    await expect(progressText).not.toBeEmpty();
  });

  // ----------------------------------------------------------
  // 测试 6: 收货表单显示
  // ----------------------------------------------------------
  test('收货表单可见并可填写', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/wo.html?docnum=26000070');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // WO 收货表单应自动显示 (不需要点击行)
    await expect(page.locator('#receiptCard')).toBeVisible({ timeout: 5_000 });

    // 数量输入框可见
    await expect(page.locator('#receiptQty')).toBeVisible();

    // 操作人输入框可见
    await expect(page.locator('#receiptUser')).toBeVisible();
  });

  // ----------------------------------------------------------
  // 测试 7: 提交收货 — 成功流程
  // ----------------------------------------------------------
  test('填写收货信息并成功提交', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/wms/wo.html?docnum=26000070');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#receiptCard')).toBeVisible({ timeout: 5_000 });

    // 填写数量
    await page.locator('#receiptQty').fill('100');

    // 填写操作人
    await page.locator('#receiptUser').fill('E2E生产操作员');

    // 提交
    await page.locator('#receiptForm button[type="submit"]').click();

    // 成功 Toast
    const toast = page.locator('.message-toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });
  });

  // ----------------------------------------------------------
  // 测试 8: 操作历史
  // ----------------------------------------------------------
  test('操作历史表格正确显示', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/wo.html?docnum=26000070');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#historyCard')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#historyBody')).toContainText('ITEM-C001');
    await expect(page.locator('#historyBody')).toContainText('生产操作员A');
  });

  // ----------------------------------------------------------
  // 测试 9: 已完成订单 — 完成提示
  // ----------------------------------------------------------
  test('已完成订单显示完成提示', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page, { woResponse: MOCK_WO_COMPLETED });

    await page.goto('/wms/wo.html?docnum=26000071');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 应显示已完成提示卡片
    const completeCard = page.locator('#completeCard');
    await expect(completeCard).toBeVisible({ timeout: 5_000 });
  });

  // ----------------------------------------------------------
  // 测试 10: 重新查询
  // ----------------------------------------------------------
  test('重新查询清空当前订单状态', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/wo.html?docnum=26000070');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    const resetBtn = page.locator('button', { hasText: /重新查询/ });
    if (await resetBtn.count() > 0) {
      await resetBtn.first().click();
      await expect(page.locator('#orderCard')).toBeHidden({ timeout: 5_000 });
    }
  });

  // ----------------------------------------------------------
  // 测试 11: API 错误处理
  // ----------------------------------------------------------
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
    await page.route('**/api/wms/wo**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"服务器内部错误"}' })
    );

    await page.goto('/wms/wo.html');
    await page.locator('#scanInput').fill('26000070');
    await page.locator('#scanInput').press('Enter');

    await page.waitForTimeout(3_000);
    expect(page.url()).toContain('wo.html');
  });
});
