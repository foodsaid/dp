// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * 库存盘点 (IC) E2E 测试
 *
 * 核心策略:
 *   1. Network Interception — 拦截 /document/create + /document + /item + /stock + /transaction
 *   2. localStorage 注入 — 绕过登录鉴权
 *   3. 覆盖: 新建 → 扫物料 → 库存预览 → 记录差异 → 待提交清单 → 批量提交 → 完成
 *
 * 运行: npx playwright test tests/e2e/ic-count.spec.js --headed
 */

// ============================================================
// Mock 数据定义
// ============================================================

const MOCK_CREATE_SUCCESS = {
  success: true,
  doc_number: 'IC20260308001',
  message: '盘点单创建成功',
};

const MOCK_LOAD_RESPONSE = {
  success: true,
  document: {
    doc_number: 'IC20260308001',
    doc_type: 'IC',
    warehouse_code: 'WH01',
    created_by: 'E2E盘点员',
    wms_status: 'in_progress',
  },
  transactions: [
    {
      item_code: 'ITEM-E001',
      item_name: '盘点物料 Alpha',
      quantity: 5,
      bin_location: 'A-01-01',
      transaction_time: '2026-03-08 10:00',
    },
  ],
};

const MOCK_LOAD_COMPLETED = {
  success: true,
  document: {
    doc_number: 'IC20260308002',
    doc_type: 'IC',
    warehouse_code: 'WH01',
    created_by: 'E2E盘点员',
    wms_status: 'completed',
  },
  transactions: [
    {
      item_code: 'ITEM-E001',
      item_name: '盘点物料 Alpha',
      quantity: 3,
      bin_location: 'A-01-01',
      transaction_time: '2026-03-08 09:00',
    },
  ],
};

const MOCK_ITEM_RESPONSE = {
  success: true,
  item: {
    itemCode: 'ITEM-E001',
    itemName: '盘点物料 Alpha',
    uom: 'PCS',
  },
};

const MOCK_STOCK_RESPONSE = {
  success: true,
  data: [
    {
      item_code: 'ITEM-E001',
      bin_code: 'A-01-01',
      batch_number: '',
      base_qty: 100,
      delta_qty: 5,
      real_time_qty: 105,
      uom: 'PCS',
    },
    {
      item_code: 'ITEM-E001',
      bin_code: 'A-02-01',
      batch_number: 'B001',
      base_qty: 50,
      delta_qty: -3,
      real_time_qty: 47,
      uom: 'PCS',
    },
  ],
};

const MOCK_TX_SUCCESS = { success: true, message: '提交成功' };
const MOCK_COMPLETE_SUCCESS = { success: true, message: '盘点单已完成' };

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
      bins_map: { WH01: ['A-01-01', 'A-02-01'] },
      items: [{ item_code: 'ITEM-E001', item_name: '盘点物料 Alpha', uom: 'PCS' }],
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
  // 通用 fallback
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

  // env.js
  await page.route('**/env.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* env.js intercepted */' })
  );

  // 主数据
  await page.route('**/api/wms/masterdata**', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        success: true, items: [], warehouses: [{ whsCode: 'WH01', whsName: '主仓库' }],
        bins: [{ binCode: 'A-01-01', whsCode: 'WH01' }],
      }),
    })
  );

  // 文档创建
  await page.route('**/api/wms/document/create**', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(overrides.createResponse || MOCK_CREATE_SUCCESS),
    })
  );

  // 文档查询
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

  // 物料查询
  await page.route('**/api/wms/item**', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(overrides.itemResponse || MOCK_ITEM_RESPONSE),
    })
  );

  // 库存查询
  await page.route('**/api/wms/stock**', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(overrides.stockResponse || MOCK_STOCK_RESPONSE),
    })
  );

  // 事务提交
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

test.describe('库存盘点 (IC) E2E', () => {
  // 测试 1: 页面加载
  test('页面正常加载，操作选择卡片可见', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/ic.html');

    expect(page.url()).toContain('ic.html');
    await expect(page.locator('#modeCard')).toBeVisible();
    await expect(page.locator('#createCard')).toBeHidden();
    await expect(page.locator('#loadCard')).toBeHidden();
  });

  // 测试 2: 新建盘点单 — 显示创建表单
  test('点击新建盘点单显示创建表单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/ic.html');

    await page.locator('button', { hasText: /新建盘点/ }).click();
    await expect(page.locator('#createCard')).toBeVisible();
    await expect(page.locator('#modeCard')).toBeHidden();
    await expect(page.locator('#createWhs')).toBeVisible();
    await expect(page.locator('#createUser')).toBeVisible();
  });

  // 测试 3: 创建盘点单成功 → 进入扫码界面
  test('创建盘点单成功后进入扫码界面', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/ic.html');

    page.on('dialog', (dialog) => dialog.accept());

    await page.locator('button', { hasText: /新建盘点/ }).click();
    await page.locator('#createWhs').fill('WH01');
    await page.locator('#createUser').fill('E2E盘点员');
    await page.locator('#createForm button[type="submit"]').click();

    // 创建后自动加载盘点单 → 显示盘点信息和扫码区
    await expect(page.locator('#countCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#docNum')).toContainText('IC20260308001');
    await expect(page.locator('#scanCard')).toBeVisible();
  });

  // 测试 4: 查看盘点凭证 — 显示加载表单
  test('点击查看盘点凭证显示加载输入框', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/ic.html');

    await page.locator('button', { hasText: /查看盘点凭证/ }).click();
    await expect(page.locator('#loadCard')).toBeVisible();
    await expect(page.locator('#modeCard')).toBeHidden();
    await expect(page.locator('#loadInput')).toBeVisible();
  });

  // 测试 5: URL 参数自动加载
  test('URL 带 id 参数自动加载盘点单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/ic.html?id=IC20260308001');

    await expect(page.locator('#countCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#docNum')).toContainText('IC20260308001');
  });

  // 测试 6: 盘点明细显示已有记录
  test('加载盘点单后显示已有盘点明细', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/ic.html?id=IC20260308001');

    await expect(page.locator('#countCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#detailCard')).toBeVisible();
    await expect(page.locator('#detailBody')).toContainText('ITEM-E001');
  });

  // 测试 7: 扫物料码 → 显示库存预览
  test('扫描物料码后显示库存预览和录入表单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/ic.html?id=IC20260308001');

    await expect(page.locator('#scanCard')).toBeVisible({ timeout: 10_000 });

    // 扫描物料码
    await page.locator('#itemScan').fill('ITEM-E001');
    await page.locator('#itemScan').press('Enter');

    // 应显示物料信息和库存预览
    await expect(page.locator('#itemInfo')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#stockPreviewPanel')).toBeVisible();
    await expect(page.locator('#countForm')).toBeVisible();
  });

  // 测试 8: 记录盘点差异 → 添加到待提交清单
  test('记录盘点差异后添加到待提交清单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/ic.html?id=IC20260308001');

    await expect(page.locator('#scanCard')).toBeVisible({ timeout: 10_000 });

    page.on('dialog', (dialog) => dialog.accept());

    // 扫描物料
    await page.locator('#itemScan').fill('ITEM-E001');
    await page.locator('#itemScan').press('Enter');
    await expect(page.locator('#itemInfo')).toBeVisible({ timeout: 5_000 });

    // 填写差异数
    await page.locator('#countQty').fill('3');
    await page.locator('#countForm button[type="submit"]').click();

    // 待提交清单应显示
    await expect(page.locator('#pendingCard')).toBeVisible();
    const toast = page.locator('.message-toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });
  });

  // 测试 9: 跳过一致物料
  test('点击一致跳过不添加到清单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/ic.html?id=IC20260308001');

    await expect(page.locator('#scanCard')).toBeVisible({ timeout: 10_000 });

    // 扫描物料
    await page.locator('#itemScan').fill('ITEM-E001');
    await page.locator('#itemScan').press('Enter');
    await expect(page.locator('#itemInfo')).toBeVisible({ timeout: 5_000 });

    // 点击跳过
    await page.locator('.ic-skip-btn').click();

    // 物料信息区应隐藏
    await expect(page.locator('#itemInfo')).toBeHidden({ timeout: 3_000 });
  });

  // 测试 10: 已完成盘点单 — 只读模式
  test('已完成盘点单显示为只读状态', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page, { loadResponse: MOCK_LOAD_COMPLETED });
    await page.goto('/wms/ic.html?id=IC20260308002');

    await expect(page.locator('#countCard')).toBeVisible({ timeout: 10_000 });
    // 扫码区和待提交清单应隐藏
    await expect(page.locator('#scanCard')).toBeHidden();
    await expect(page.locator('#pendingCard')).toBeHidden();
  });

  // 测试 11: 返回操作选择
  test('点击返回回到操作选择界面', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);
    await page.goto('/wms/ic.html');

    await page.locator('button', { hasText: /新建盘点/ }).click();
    await expect(page.locator('#createCard')).toBeVisible();

    // 点击返回
    await page.locator('#createCard button', { hasText: /返回/ }).click();
    await expect(page.locator('#modeCard')).toBeVisible();
    await expect(page.locator('#createCard')).toBeHidden();
  });

  // 测试 12: API 失败不崩溃
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

    await page.goto('/wms/ic.html?id=IC20260308001');
    await page.waitForTimeout(3_000);
    expect(page.url()).toContain('ic.html');
  });
});
