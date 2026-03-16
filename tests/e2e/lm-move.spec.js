// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * 库位移动 (LM) E2E 测试
 *
 * 核心策略:
 *   1. Network Interception — 拦截 /document/create + /document + /item + /transaction
 *   2. localStorage 注入 — 绕过登录鉴权
 *   3. 覆盖: 新建 → 扫物料 → 填写源/目标库位 → 待提交 → 批量提交 → 明细借贷
 *
 * 运行: npx playwright test tests/e2e/lm-move.spec.js --headed
 */

// ============================================================
// Mock 数据定义
// ============================================================

const MOCK_CREATE_SUCCESS = {
  success: true,
  doc_number: 'LM20260308001',
  message: '移库单创建成功',
};

const MOCK_LOAD_RESPONSE = {
  success: true,
  document: {
    doc_number: 'LM20260308001',
    doc_type: 'LM',
    warehouse_code: 'WH01',
    created_by: 'E2E操作员',
    wms_status: 'in_progress',
  },
  transactions: [
    {
      item_code: 'ITEM-F001',
      item_name: '移库物料 Alpha',
      quantity: 20,
      from_bin: 'A-01-01',
      bin_location: 'B-02-01',
      transaction_time: '2026-03-08 11:00',
    },
  ],
};

const MOCK_LOAD_COMPLETED = {
  success: true,
  document: {
    doc_number: 'LM20260308002',
    doc_type: 'LM',
    warehouse_code: 'WH01',
    created_by: 'E2E操作员',
    wms_status: 'completed',
  },
  transactions: [
    {
      item_code: 'ITEM-F001',
      item_name: '移库物料 Alpha',
      quantity: 10,
      from_bin: 'A-01-01',
      bin_location: 'B-02-01',
      transaction_time: '2026-03-08 10:00',
    },
  ],
};

const MOCK_ITEM_RESPONSE = {
  success: true,
  item: {
    itemCode: 'ITEM-F001',
    itemName: '移库物料 Alpha',
    uom: 'PCS',
  },
};

const MOCK_TX_SUCCESS = { success: true, message: '提交成功' };
const MOCK_COMPLETE_SUCCESS = { success: true, message: '移库单已完成' };

// ============================================================
// 工具函数
// ============================================================

async function setupAuth(page) {
  await page.addInitScript(() => {
    localStorage.setItem('wms_username', 'e2e_test_admin');
    localStorage.setItem('wms_display_name', 'E2E 测试操作员');
    localStorage.setItem('wms_role', 'admin');
    localStorage.setItem('wms_masterdata', JSON.stringify({
      _ts: Date.now(),
      warehouses: [{ whs_code: 'WH01', whs_name: '主仓库' }],
      bins_map: { WH01: ['A-01-01', 'A-02-01', 'B-02-01'] },
      items: [{ item_code: 'ITEM-F001', item_name: '移库物料 Alpha', uom: 'PCS' }],
    }));

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

async function setupApiRoutes(page, overrides = {}) {
  await page.route('**/api/webhook-test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' })
  );
  await page.route('**/api/wms/**', (route) => {
    const method = route.request().method();
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(method === 'GET' ? { success: true, data: [] } : { success: true }),
    });
  });

  await page.route('**/env.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* env.js intercepted */' })
  );

  await page.route('**/api/wms/masterdata**', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        success: true, items: [], warehouses: [{ whsCode: 'WH01', whsName: '主仓库' }],
        bins: [{ binCode: 'A-01-01', whsCode: 'WH01' }, { binCode: 'B-02-01', whsCode: 'WH01' }],
      }),
    })
  );

  await page.route('**/api/wms/document/create**', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(overrides.createResponse || MOCK_CREATE_SUCCESS),
    })
  );

  await page.route('**/api/wms/document**', (route) => {
    const url = route.request().url();
    if (url.includes('complete')) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(MOCK_COMPLETE_SUCCESS),
      });
    }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(overrides.loadResponse || MOCK_LOAD_RESPONSE),
    });
  });

  await page.route('**/api/wms/item**', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(overrides.itemResponse || MOCK_ITEM_RESPONSE),
    })
  );

  await page.route('**/api/wms/transaction**', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(MOCK_TX_SUCCESS),
    })
  );
}

// ============================================================
// 测试套件
// ============================================================

test.describe('库位移动 (LM) E2E', () => {
  // 测试 1: 页面加载
  test('页面正常加载，操作选择卡片可见', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/lm.html');

    expect(page.url()).toContain('lm.html');
    await expect(page.locator('#modeCard')).toBeVisible();
    await expect(page.locator('#createCard')).toBeHidden();
  });

  // 测试 2: 新建移库单 — 显示创建表单
  test('点击新建移库单显示创建表单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/lm.html');

    await page.locator('button', { hasText: /新建移库/ }).click();
    await expect(page.locator('#createCard')).toBeVisible();
    await expect(page.locator('#modeCard')).toBeHidden();
    await expect(page.locator('#createWhs')).toBeVisible();
    await expect(page.locator('#createUser')).toBeVisible();
  });

  // 测试 3: 创建移库单成功 → 进入移库界面
  test('创建移库单成功后进入录入界面', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/lm.html');

    page.on('dialog', (dialog) => dialog.accept());

    await page.locator('button', { hasText: /新建移库/ }).click();
    await page.locator('#createWhs').fill('WH01');
    await page.locator('#createUser').fill('E2E操作员');
    await page.locator('#createForm button[type="submit"]').click();

    await expect(page.locator('#moveCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#docNum')).toContainText('LM20260308001');
    await expect(page.locator('#inputCard')).toBeVisible();
  });

  // 测试 4: 查看移库凭证 — 显示加载表单
  test('点击查看移库凭证显示加载输入框', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/lm.html');

    await page.locator('button', { hasText: /查看移库凭证/ }).click();
    await expect(page.locator('#loadCard')).toBeVisible();
    await expect(page.locator('#loadInput')).toBeVisible();
  });

  // 测试 5: URL 参数自动加载
  test('URL 带 id 参数自动加载移库单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/lm.html?id=LM20260308001');

    await expect(page.locator('#moveCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#docNum')).toContainText('LM20260308001');
  });

  // 测试 6: 移库明细显示借贷双行
  test('加载后明细表格显示已有移库记录', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/lm.html?id=LM20260308001');

    await expect(page.locator('#moveCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#detailCard')).toBeVisible();
    // 应有借贷双行
    await expect(page.locator('#detailBody')).toContainText('ITEM-F001');
    await expect(page.locator('#detailBody')).toContainText('贷(出)');
    await expect(page.locator('#detailBody')).toContainText('借(入)');
  });

  // 测试 7: 扫物料码 → 显示库位填写区
  test('扫描物料码后显示源/目标库位填写区', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/lm.html?id=LM20260308001');

    await expect(page.locator('#inputCard')).toBeVisible({ timeout: 10_000 });

    await page.locator('#itemScan').fill('ITEM-F001');
    await page.locator('#itemScan').press('Enter');

    await expect(page.locator('#moveFields')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#scanItemCode')).toContainText('ITEM-F001');
    await expect(page.locator('#fromBin')).toBeVisible();
    await expect(page.locator('#toBin')).toBeVisible();
  });

  // 测试 8: 已完成移库单 — 只读模式
  test('已完成移库单不显示录入区和待提交清单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page, { loadResponse: MOCK_LOAD_COMPLETED });
    await page.goto('/wms/lm.html?id=LM20260308002');

    await expect(page.locator('#moveCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#inputCard')).toBeHidden();
    await expect(page.locator('#pendingCard')).toBeHidden();
    await expect(page.locator('#detailCard')).toBeVisible();
  });

  // 测试 9: 返回操作选择
  test('点击返回回到操作选择界面', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/lm.html');

    await page.locator('button', { hasText: /新建移库/ }).click();
    await expect(page.locator('#createCard')).toBeVisible();

    await page.locator('#createCard button', { hasText: /返回/ }).click();
    await expect(page.locator('#modeCard')).toBeVisible();
    await expect(page.locator('#createCard')).toBeHidden();
  });

  // 测试 10: API 查询失败不崩溃
  test('API 返回失败时页面不崩溃', async ({ page }) => {
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
    await page.route('**/api/wms/document**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"服务器错误"}' })
    );

    await page.goto('/wms/lm.html?id=LM20260308001');
    await page.waitForTimeout(3_000);
    expect(page.url()).toContain('lm.html');
  });
});
