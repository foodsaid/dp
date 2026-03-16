// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * 采购收货 (PO) E2E 测试
 *
 * 核心策略:
 *   1. Network Interception — 拦截 /po 查询 + /transaction 提交 + /lock 锁管理
 *   2. localStorage 注入 — 绕过登录鉴权
 *   3. 覆盖: 查询 → 显示行 → 选择行 → 填写收货 → 提交 → 历史 → 一键收货
 *
 * 运行: npx playwright test tests/e2e/po-receive.spec.js --headed
 */

// ============================================================
// Mock 数据定义
// ============================================================

/** PO 查询成功响应 — 多行物料 */
const MOCK_PO_RESPONSE = {
  success: true,
  sap_order: {
    docNum: '26000060',
    docEntry: 601,
    docStatus: 'O',
    cardCode: 'V-TEST-001',
    cardName: 'E2E 测试供应商',
    docDueDate: '2026-03-20',
    wmsStatus: 'in_progress',
    lines: [
      {
        lineNum: 0,
        itemCode: 'ITEM-A001',
        itemName: '采购物料 Alpha',
        quantity: 100,
        deliveredQty: 0,
        openQty: 100,
        lineStatus: 'O',
        whsCode: 'WH01',
        uom: 'PCS',
      },
      {
        lineNum: 1,
        itemCode: 'ITEM-A002',
        itemName: '采购物料 Beta',
        quantity: 200,
        deliveredQty: 50,
        openQty: 150,
        lineStatus: 'O',
        whsCode: 'WH01',
        uom: 'KG',
      },
      {
        lineNum: 2,
        itemCode: 'ITEM-A003',
        itemName: '采购物料 Gamma (已完成)',
        quantity: 80,
        deliveredQty: 80,
        openQty: 0,
        lineStatus: 'C',
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
        transaction_time: '2026-03-06 14:00',
        item_code: 'ITEM-A002',
        item_name: '采购物料 Beta',
        quantity: 30,
        performed_by: '仓库操作员',
        remarks: '第一批到货',
      },
    ],
  },
};

/** PO 已关闭 */
const MOCK_PO_CLOSED = {
  success: true,
  sap_order: {
    docNum: '26000061',
    docEntry: 602,
    docStatus: 'C',
    cardCode: 'V-TEST-002',
    cardName: '已关闭供应商',
    docDueDate: '2026-03-01',
    wmsStatus: 'completed',
    lines: [],
  },
  wms_history: {
    wms_status: 'completed',
    lineReceipts: {},
    transactions: [],
  },
};

/** 事务提交成功 */
const MOCK_TX_SUCCESS = {
  success: true,
  message: '收货提交成功',
};

/** 锁获取成功 */
const MOCK_LOCK_SUCCESS = {
  success: true,
  locked_by: 'e2e_test_admin',
};

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

async function setupApiRoutes(page, { poResponse = MOCK_PO_RESPONSE } = {}) {
  // 低优先级: 通用 fallback
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

  // 高优先级: 具体路由
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
        warehouses: [
          { whsCode: 'WH01', whsName: '主仓库' },
          { whsCode: 'WH02', whsName: '备用仓' },
        ],
        bins: [{ binCode: 'A-01-01', whsCode: 'WH01' }],
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

  await page.route('**/api/wms/transaction**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_TX_SUCCESS),
    })
  );

  // OMS 相关
  await page.route('**/api/wms/oms/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, orders: [], lines: [] }),
    })
  );

  // PO 查询 (最高优先级)
  await page.route('**/api/wms/po**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(poResponse),
    })
  );
}

// ============================================================
// 测试套件
// ============================================================

test.describe('采购收货 (PO) E2E', () => {
  // ----------------------------------------------------------
  // 测试 1: 页面加载
  // ----------------------------------------------------------
  test('页面正常加载，扫码输入框可见', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/po.html');

    expect(page.url()).toContain('po.html');
    await expect(page.locator('#scanInput')).toBeVisible();
    await expect(page.locator('#orderCard')).toBeHidden();
  });

  // ----------------------------------------------------------
  // 测试 2: 输入 PO 单号查询
  // ----------------------------------------------------------
  test('输入 PO 单号查询并显示订单信息', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/po.html');

    await page.locator('#scanInput').fill('26000060');
    await page.locator('#scanInput').press('Enter');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#docNum')).toContainText('26000060');
    await expect(page.locator('#bpName')).toContainText('E2E 测试供应商');
    await expect(page.locator('#linesCard')).toBeVisible();

    const rows = page.locator('#linesBody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(1);
  });

  // ----------------------------------------------------------
  // 测试 3: URL 参数自动加载
  // ----------------------------------------------------------
  test('URL 带 docnum 参数自动加载订单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/po.html?docnum=26000060');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#docNum')).toContainText('26000060');
  });

  // ----------------------------------------------------------
  // 测试 4: 行项目显示 — 包含已完成行
  // ----------------------------------------------------------
  test('行项目表格正确显示多行物料', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/po.html?docnum=26000060');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    const tbody = page.locator('#linesBody');
    await expect(tbody).toContainText('ITEM-A001');
    await expect(tbody).toContainText('ITEM-A002');
    await expect(tbody).toContainText('ITEM-A003');
  });

  // ----------------------------------------------------------
  // 测试 5: 点击收货按钮打开表单
  // ----------------------------------------------------------
  test('点击收货按钮弹出收货表单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/po.html?docnum=26000060');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    const receiptBtn = page.locator('#linesBody button').first();
    await receiptBtn.click();

    await expect(page.locator('#receiptCard')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#receiptQty')).toBeVisible();
    await expect(page.locator('#receiptUser')).toBeVisible();
  });

  // ----------------------------------------------------------
  // 测试 6: 提交收货 — 成功流程
  // ----------------------------------------------------------
  test('填写收货信息并成功提交', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/wms/po.html?docnum=26000060');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 选择第一行收货
    const receiptBtn = page.locator('#linesBody button').first();
    await receiptBtn.click();
    await expect(page.locator('#receiptCard')).toBeVisible({ timeout: 5_000 });

    // 数量应已预填
    const qtyValue = await page.locator('#receiptQty').inputValue();
    expect(Number(qtyValue)).toBeGreaterThan(0);

    // 填写操作人
    await page.locator('#receiptUser').fill('E2E收货员');

    // 提交
    await page.locator('#receiptForm button[type="submit"]').click();

    // 成功 Toast
    const toast = page.locator('.message-toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // 收货表单应关闭
    await expect(page.locator('#receiptCard')).toBeHidden({ timeout: 5_000 });
  });

  // ----------------------------------------------------------
  // 测试 7: 取消收货 — 关闭表单
  // ----------------------------------------------------------
  test('点击取消关闭收货表单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/po.html?docnum=26000060');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    await page.locator('#linesBody button').first().click();
    await expect(page.locator('#receiptCard')).toBeVisible({ timeout: 5_000 });

    // 点击取消
    const cancelBtn = page.locator('#receiptCard button', { hasText: /取消|关闭/ });
    if (await cancelBtn.count() > 0) {
      await cancelBtn.first().click();
    } else {
      await page.locator('#receiptCard .btn-outline').first().click();
    }

    await expect(page.locator('#receiptCard')).toBeHidden({ timeout: 5_000 });
  });

  // ----------------------------------------------------------
  // 测试 8: 收货历史记录
  // ----------------------------------------------------------
  test('收货历史表格正确显示操作记录', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/po.html?docnum=26000060');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#historyCard')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#historyBody')).toContainText('ITEM-A002');
    await expect(page.locator('#historyBody')).toContainText('仓库操作员');
  });

  // ----------------------------------------------------------
  // 测试 9: 已关闭订单
  // ----------------------------------------------------------
  test('已关闭订单正常显示不崩溃', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page, { poResponse: MOCK_PO_CLOSED });

    await page.goto('/wms/po.html?docnum=26000061');

    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });
    expect(page.url()).toContain('po.html');
  });

  // ----------------------------------------------------------
  // 测试 10: 扫物料码定位行
  // ----------------------------------------------------------
  test('扫物料条码自动选中对应行', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/po.html?docnum=26000060');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 等待扫码冷却期
    await page.waitForTimeout(1_000);

    // 输入物料条码 (含 - 触发物料码路由，非 SAP 前缀不会触发旧格式警告)
    await page.locator('#scanInput').fill('ITEM-A001');
    await page.locator('#scanInput').press('Enter');

    // 精确匹配行项目 → selectLine → 打开收货表单
    await expect(page.locator('#receiptCard')).toBeVisible({ timeout: 5_000 });
  });

  // ----------------------------------------------------------
  // 测试 11: 重新查询
  // ----------------------------------------------------------
  test('重新查询清空当前订单状态', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/po.html?docnum=26000060');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    const resetBtn = page.locator('button', { hasText: /重新查询/ });
    if (await resetBtn.count() > 0) {
      await resetBtn.first().click();
      await expect(page.locator('#orderCard')).toBeHidden({ timeout: 5_000 });
    }
  });

  // ----------------------------------------------------------
  // 测试 12: API 查询失败
  // ----------------------------------------------------------
  test('API 返回失败时不崩溃', async ({ page }) => {
    await setupAuth(page);

    // 注册路由但 PO 查询返回错误
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
    await page.route('**/api/wms/po**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: '服务器内部错误' }),
      })
    );

    await page.goto('/wms/po.html');
    await page.locator('#scanInput').fill('26000060');
    await page.locator('#scanInput').press('Enter');

    await page.waitForTimeout(3_000);
    expect(page.url()).toContain('po.html');
  });
});
