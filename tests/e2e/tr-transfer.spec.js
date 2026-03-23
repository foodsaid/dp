// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * 库存调拨 (TR) E2E 测试
 *
 * 核心策略:
 *   1. Network Interception — 拦截 /tr 查询 + /transaction 提交 + /lock 锁管理
 *   2. localStorage 注入 — 绕过登录鉴权
 *   3. 覆盖: 查询 → 行项目 → 调拨表单 → 提交 → 历史 → 一键调拨
 *
 * TR 特点: 多行物料 + 源仓/目标仓双仓库 + 一键调拨
 *
 * 运行: npx playwright test tests/e2e/tr-transfer.spec.js --headed
 */

// ============================================================
// Mock 数据定义
// ============================================================

/** TR 查询成功响应 — 多行物料 */
const MOCK_TR_RESPONSE = {
  success: true,
  sap_order: {
    docNum: '26000090',
    docEntry: 901,
    docStatus: 'O',
    fromWarehouse: 'WH01',
    toWarehouse: 'WH02',
    wmsStatus: 'in_progress',
    lines: [
      {
        lineNum: 0,
        itemCode: 'ITEM-B001',
        itemName: '调拨物料 Alpha',
        quantity: 200,
        deliveredQty: 0,
        openQty: 200,
        lineStatus: 'O',
        fromWhsCode: 'WH01',
        toWhsCode: 'WH02',
        uom: 'PCS',
      },
      {
        lineNum: 1,
        itemCode: 'ITEM-B002',
        itemName: '调拨物料 Beta',
        quantity: 100,
        deliveredQty: 40,
        openQty: 60,
        lineStatus: 'O',
        fromWhsCode: 'WH01',
        toWhsCode: 'WH03',
        uom: 'KG',
      },
      {
        lineNum: 2,
        itemCode: 'ITEM-B003',
        itemName: '调拨物料 Gamma (已完成)',
        quantity: 50,
        deliveredQty: 50,
        openQty: 0,
        lineStatus: 'C',
        fromWhsCode: 'WH01',
        toWhsCode: 'WH02',
        uom: 'PCS',
      },
    ],
  },
  wms_history: {
    wms_status: 'in_progress',
    lineReceipts: { '1': 20 },
    transactions: [
      {
        transaction_time: '2026-03-07 11:30',
        item_code: 'ITEM-B002',
        item_name: '调拨物料 Beta',
        quantity: 20,
        performed_by: '调拨操作员',
        remarks: '第一批调拨',
      },
    ],
  },
};

/** TR 已关闭 */
const MOCK_TR_CLOSED = {
  success: true,
  sap_order: {
    docNum: '26000091',
    docEntry: 902,
    docStatus: 'C',
    fromWarehouse: 'WH01',
    toWarehouse: 'WH02',
    wmsStatus: 'completed',
    lines: [],
  },
  wms_history: {
    wms_status: 'completed',
    lineReceipts: {},
    transactions: [],
  },
};

const MOCK_TX_SUCCESS = { success: true, message: '调拨提交成功' };
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

async function setupApiRoutes(page, { trResponse = MOCK_TR_RESPONSE } = {}) {
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
        warehouses: [
          { whsCode: 'WH01', whsName: '主仓库' },
          { whsCode: 'WH02', whsName: '备用仓' },
          { whsCode: 'WH03', whsName: '三号仓' },
        ],
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

  // TR 查询 (最高优先级)
  await page.route('**/api/wms/tr**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(trResponse),
    })
  );
}

// ============================================================
// 测试套件
// ============================================================

test.describe('库存调拨 (TR) E2E', () => {
  // ----------------------------------------------------------
  // 测试 1: 页面加载
  // ----------------------------------------------------------
  test('页面正常加载，扫码输入框可见', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/tr.html');

    expect(page.url()).toContain('tr.html');
    await expect(page.locator('#scanInput')).toBeVisible();
    await expect(page.locator('#orderCard')).toBeHidden();
  });

  // ----------------------------------------------------------
  // 测试 2: 查询 TR 并显示调拨信息
  // ----------------------------------------------------------
  test('输入 TR 单号查询并显示调拨信息', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/tr.html');
    await page.locator('#scanInput').fill('26000090');
    await page.locator('#scanInput').press('Enter');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#docNum')).toContainText('26000090');

    // TR 特有: 源仓/目标仓
    await expect(page.locator('#fromWhs')).not.toBeEmpty();
    await expect(page.locator('#toWhs')).not.toBeEmpty();

    await expect(page.locator('#linesCard')).toBeVisible();
  });

  // ----------------------------------------------------------
  // 测试 3: URL 参数自动加载
  // ----------------------------------------------------------
  test('URL 带 docnum 参数自动加载', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/tr.html?docnum=26000090');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#docNum')).toContainText('26000090');
  });

  // ----------------------------------------------------------
  // 测试 4: 行项目显示
  // ----------------------------------------------------------
  test('行项目表格正确显示多行物料', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/tr.html?docnum=26000090');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    const tbody = page.locator('#linesBody');
    await expect(tbody).toContainText('ITEM-B001');
    await expect(tbody).toContainText('ITEM-B002');
    await expect(tbody).toContainText('ITEM-B003');

    const rows = page.locator('#linesBody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2);
  });

  // ----------------------------------------------------------
  // 测试 5: 点击调拨按钮打开表单
  // ----------------------------------------------------------
  test('点击调拨按钮弹出调拨表单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/tr.html?docnum=26000090');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    const moveBtn = page.locator('#linesBody button').first();
    await moveBtn.click();

    await expect(page.locator('#moveCard')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#moveQty')).toBeVisible();
    await expect(page.locator('#moveUser')).toBeVisible();
  });

  // ----------------------------------------------------------
  // 测试 6: 提交调拨 — 成功流程
  // ----------------------------------------------------------
  test('填写调拨信息并成功提交', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/wms/tr.html?docnum=26000090');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 选择第一行调拨
    await page.locator('#linesBody button').first().click();
    await expect(page.locator('#moveCard')).toBeVisible({ timeout: 5_000 });

    // 数量应已预填
    const qtyValue = await page.locator('#moveQty').inputValue();
    expect(Number(qtyValue)).toBeGreaterThan(0);

    // 填写操作人
    await page.locator('#moveUser').fill('E2E调拨员');

    // 提交
    await page.locator('#moveForm button[type="submit"]').click();

    // 成功 Toast
    const toast = page.locator('.message-toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // 调拨表单应关闭
    await expect(page.locator('#moveCard')).toBeHidden({ timeout: 5_000 });
  });

  // ----------------------------------------------------------
  // 测试 7: 取消调拨 — 关闭表单
  // ----------------------------------------------------------
  test('点击取消关闭调拨表单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/tr.html?docnum=26000090');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    await page.locator('#linesBody button').first().click();
    await expect(page.locator('#moveCard')).toBeVisible({ timeout: 5_000 });

    const cancelBtn = page.locator('#moveCard button', { hasText: /取消|关闭/ });
    if (await cancelBtn.count() > 0) {
      await cancelBtn.first().click();
    } else {
      await page.locator('#moveCard .btn-outline').first().click();
    }

    await expect(page.locator('#moveCard')).toBeHidden({ timeout: 5_000 });
  });

  // ----------------------------------------------------------
  // 测试 8: 调拨历史
  // ----------------------------------------------------------
  test('调拨历史表格正确显示', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/tr.html?docnum=26000090');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#historyCard')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#historyBody')).toContainText('ITEM-B002');
    await expect(page.locator('#historyBody')).toContainText('调拨操作员');
  });

  // ----------------------------------------------------------
  // 测试 9: 已关闭单据
  // ----------------------------------------------------------
  test('已关闭单据正常显示不崩溃', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page, { trResponse: MOCK_TR_CLOSED });

    await page.goto('/wms/tr.html?docnum=26000091');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });
    expect(page.url()).toContain('tr.html');
  });

  // ----------------------------------------------------------
  // 测试 10: 扫物料码定位行
  // ----------------------------------------------------------
  test('扫物料条码自动选中对应行', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/tr.html?docnum=26000090');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 等待扫码冷却期
    await page.waitForTimeout(1_000);

    // 输入物料条码 (含 - 触发物料码路由，非 SAP 前缀不会触发旧格式警告)
    await page.locator('#scanInput').fill('ITEM-B001');
    await page.locator('#scanInput').press('Enter');

    // 精确匹配行项目 → selectLine → 打开调拨表单
    await expect(page.locator('#moveCard')).toBeVisible({ timeout: 5_000 });
  });

  // ----------------------------------------------------------
  // 测试 11: 重新查询
  // ----------------------------------------------------------
  test('重新查询清空当前单据状态', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/tr.html?docnum=26000090');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    const resetBtn = page.locator('button', { hasText: /重新查询/ });
    if (await resetBtn.count() > 0) {
      await resetBtn.first().click();
      await expect(page.locator('#orderCard')).toBeHidden({ timeout: 5_000 });
    }
  });

  // ----------------------------------------------------------
  // 测试 12: API 错误处理
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
    await page.route('**/api/wms/tr**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"服务器内部错误"}' })
    );

    await page.goto('/wms/tr.html');
    await page.locator('#scanInput').fill('26000090');
    await page.locator('#scanInput').press('Enter');

    await page.waitForTimeout(3_000);
    expect(page.url()).toContain('tr.html');
  });
});
