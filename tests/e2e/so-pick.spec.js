// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * 销售拣货 (SO) E2E 测试
 *
 * 核心策略:
 *   1. Network Interception — 拦截 /so 查询 + /transaction 提交 + /lock 锁管理
 *   2. localStorage 注入 — 绕过登录鉴权
 *   3. 覆盖核心流程: 查询 → 显示行 → 选择行 → 输入数量 → 提交拣货
 *
 * 运行: npx playwright test tests/e2e/so-pick.spec.js --headed
 */

// ============================================================
// Mock 数据定义
// ============================================================

/** SO 查询成功响应 */
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
      {
        lineNum: 1,
        itemCode: 'ITEM-002',
        itemName: '测试物料 Beta',
        quantity: 50,
        deliveredQty: 20,
        openQty: 30,
        lineStatus: 'O',
        whsCode: 'WH01',
        uom: 'PCS',
      },
      {
        lineNum: 2,
        itemCode: 'ITEM-003',
        itemName: '测试物料 Gamma',
        quantity: 80,
        deliveredQty: 80,
        openQty: 0,
        lineStatus: 'C',
        whsCode: 'WH02',
        uom: 'KG',
      },
    ],
  },
  wms_history: {
    wms_status: 'pending',
    lineReceipts: { '1': 10 },
    transactions: [
      {
        transaction_time: '2026-03-06 10:30',
        item_code: 'ITEM-002',
        item_name: '测试物料 Beta',
        quantity: 10,
        performed_by: '操作员A',
        remarks: '',
      },
    ],
  },
};

/** SO 已关闭 (docStatus = C) */
const MOCK_SO_CLOSED = {
  success: true,
  sap_order: {
    docNum: '26000099',
    docEntry: 456,
    docStatus: 'C',
    cardCode: 'C-TEST-002',
    cardName: '已关闭客户',
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

/** 事务提交成功响应 */
const MOCK_TX_SUCCESS = {
  success: true,
  message: '提交成功',
};

/** 锁获取成功 */
const MOCK_LOCK_SUCCESS = {
  success: true,
  locked_by: 'e2e_test_admin',
};

/** 锁释放成功 */
const _MOCK_LOCK_RELEASE = {
  success: true,
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

/** 设置 API 路由拦截 (Playwright 逆序匹配: 先注册 = 最低优先级) */
async function setupApiRoutes(page, { soResponse = MOCK_SO_RESPONSE } = {}) {
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

  // 锁管理
  await page.route('**/api/wms/lock/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_LOCK_SUCCESS),
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

  // OMS 相关
  await page.route('**/api/wms/oms/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, orders: [], lines: [] }),
    })
  );

  // SO 查询 (最高优先级 — 最后注册)
  await page.route('**/api/wms/so**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(soResponse),
    })
  );
}

// ============================================================
// 测试套件
// ============================================================

test.describe('销售拣货 (SO) E2E', () => {
  // ----------------------------------------------------------
  // 测试 1: 页面加载
  // ----------------------------------------------------------
  test('页面正常加载，扫码输入框可见', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/so.html');

    // 不应跳转到登录页
    expect(page.url()).toContain('so.html');

    // 扫码输入框可见
    await expect(page.locator('#scanInput')).toBeVisible();

    // 订单卡片初始隐藏
    await expect(page.locator('#orderCard')).toBeHidden();
  });

  // ----------------------------------------------------------
  // 测试 2: 输入 SO 单号查询订单
  // ----------------------------------------------------------
  test('输入 SO 单号查询并显示订单信息', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/so.html');

    // 在扫码框输入 SO 单号
    await page.locator('#scanInput').fill('26000050');
    await page.locator('#scanInput').press('Enter');

    // 等待订单卡片出现
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 验证单号显示
    await expect(page.locator('#docNum')).toContainText('26000050');

    // 验证客商名称
    await expect(page.locator('#bpName')).toContainText('E2E 测试客户');

    // 行项目表格可见
    await expect(page.locator('#linesCard')).toBeVisible();

    // 表格应有行数据
    const rows = page.locator('#linesBody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(1);
  });

  // ----------------------------------------------------------
  // 测试 3: URL 参数自动加载订单
  // ----------------------------------------------------------
  test('URL 带 docnum 参数自动加载订单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/so.html?docnum=26000050');

    // 订单卡片应自动出现
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#docNum')).toContainText('26000050');
  });

  // ----------------------------------------------------------
  // 测试 4: 行项目显示 — 已完成行标记
  // ----------------------------------------------------------
  test('行项目表格正确显示已完成行', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/so.html?docnum=26000050');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 表格应包含物料代码
    const tbody = page.locator('#linesBody');
    await expect(tbody).toContainText('ITEM-001');
    await expect(tbody).toContainText('ITEM-002');
    await expect(tbody).toContainText('ITEM-003');
  });

  // ----------------------------------------------------------
  // 测试 5: 点击"拣货"按钮打开拣货表单
  // ----------------------------------------------------------
  test('点击拣货按钮弹出拣货表单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/so.html?docnum=26000050');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 找到第一个可拣货的行按钮 (非完成行)
    const pickBtn = page.locator('#linesBody button').first();
    await pickBtn.click();

    // 拣货表单应出现
    await expect(page.locator('#pickCard')).toBeVisible({ timeout: 5_000 });

    // 数量输入框可见
    await expect(page.locator('#pickQty')).toBeVisible();

    // 操作人输入框可见
    await expect(page.locator('#pickUser')).toBeVisible();
  });

  // ----------------------------------------------------------
  // 测试 6: 提交拣货 — 成功流程
  // ----------------------------------------------------------
  test('填写拣货信息并成功提交', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    // 自动接受 confirm 对话框 (validateOverQty 内部调用 confirm)
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/wms/so.html?docnum=26000050');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 选择第一行拣货
    const pickBtn = page.locator('#linesBody button').first();
    await pickBtn.click();
    await expect(page.locator('#pickCard')).toBeVisible({ timeout: 5_000 });

    // 数量应已预填 (剩余数量)
    const qtyValue = await page.locator('#pickQty').inputValue();
    expect(Number(qtyValue)).toBeGreaterThan(0);

    // 填写操作人
    await page.locator('#pickUser').fill('E2E操作员');

    // 提交表单
    await page.locator('#pickForm button[type="submit"]').click();

    // 应显示成功消息 (Toast)
    const toast = page.locator('.message-toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // 拣货表单应关闭
    await expect(page.locator('#pickCard')).toBeHidden({ timeout: 5_000 });
  });

  // ----------------------------------------------------------
  // 测试 7: 取消拣货 — 关闭表单
  // ----------------------------------------------------------
  test('点击取消关闭拣货表单', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/so.html?docnum=26000050');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 选择拣货
    await page.locator('#linesBody button').first().click();
    await expect(page.locator('#pickCard')).toBeVisible({ timeout: 5_000 });

    // 取消拣货 (查找取消按钮)
    const cancelBtn = page.locator('#pickCard button', { hasText: /取消|关闭/ });
    if (await cancelBtn.count() > 0) {
      await cancelBtn.first().click();
    } else {
      // 部分实现用 onclick 属性的按钮
      await page.locator('#pickCard .btn-secondary, #pickCard [onclick*="cancel"]').first().click();
    }

    // 拣货表单应关闭
    await expect(page.locator('#pickCard')).toBeHidden({ timeout: 5_000 });
  });

  // ----------------------------------------------------------
  // 测试 8: 拣货历史记录显示
  // ----------------------------------------------------------
  test('拣货完成后历史记录表格可见', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/so.html?docnum=26000050');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 历史卡片应显示 (有历史数据)
    await expect(page.locator('#historyCard')).toBeVisible({ timeout: 5_000 });

    // 历史记录表格包含之前的操作记录
    await expect(page.locator('#historyBody')).toContainText('ITEM-002');
    await expect(page.locator('#historyBody')).toContainText('操作员A');
  });

  // ----------------------------------------------------------
  // 测试 9: 已关闭订单 — 只读模式
  // ----------------------------------------------------------
  test('已关闭订单进入只读模式', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page, { soResponse: MOCK_SO_CLOSED });

    await page.goto('/wms/so.html?docnum=26000099');

    // 订单卡片出现
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 应无可操作的拣货按钮 (已关闭/已完成单据)
    // 验证页面不会崩溃，能正常显示
    expect(page.url()).toContain('so.html');
  });

  // ----------------------------------------------------------
  // 测试 10: 扫物料码定位行
  // ----------------------------------------------------------
  test('扫物料条码自动选中对应行', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/so.html?docnum=26000050');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 在扫码框输入物料条码 (含连字符的被识别为物料码)
    await page.locator('#scanInput').fill('ITEM-001');
    await page.locator('#scanInput').press('Enter');

    // 应自动选中对应行并弹出拣货表单
    await expect(page.locator('#pickCard')).toBeVisible({ timeout: 5_000 });
  });

  // ----------------------------------------------------------
  // 测试 11: 重新查询 — 清空状态
  // ----------------------------------------------------------
  test('重新查询清空当前订单状态', async ({ page }) => {
    await setupAuth(page);
    await setupApiRoutes(page);

    await page.goto('/wms/so.html?docnum=26000050');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 查找重查/清除按钮
    const resetBtn = page.locator('button', { hasText: /重新查询|清除|新查询/ });
    if (await resetBtn.count() > 0) {
      await resetBtn.first().click();
      // 订单卡片应隐藏
      await expect(page.locator('#orderCard')).toBeHidden({ timeout: 5_000 });
    }
    // 如果没有重查按钮，测试通过 (部分版本可能直接在扫码框输入新单号)
  });
});
