// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * OMS DD 拆单 (拖拽看板) E2E 测试
 *
 * 核心策略:
 *   1. Network Interception — 完全拦截后端 API，注入假数据
 *   2. localStorage 注入 — 绕过登录鉴权
 *   3. 拖拽模拟 — Playwright dragAndDrop 测试 Vue 看板
 *
 * 运行: npx playwright test tests/e2e/oms-dd-split.spec.js --headed
 */

// ============================================================
// Mock 数据定义
// ============================================================

/** 假订单数据: 1 个 PENDING 的 SO，包含 3 个明细行 */
const MOCK_ORDERS_RESPONSE = {
  success: true,
  orders: [
    {
      id: 9001,
      doc_type: 'SO',
      doc_number: 'SO26-TEST-001',
      sap_doc_num: 'SO26-TEST-001',
      business_partner: 'C-MOCK-BP01',
      bp_name: 'E2E 测试客户',
      total_planned_qty: 300,
      total_actual_qty: 0,
      warehouse_code: 'WH-TEST',
      doc_date: '2026-03-06',
      ship_date: '2026-03-15',
      container_no: null,
      oms_status: 'pending',
      execution_state: 'idle',
      is_split: false,
      dd_children: [],
      line_count: 3,
      completion_rate: 0,
      lines: [
        {
          id: 90011,
          item_code: 'ITEM-ALPHA-001',
          item_name: 'E2E 测试物料 Alpha',
          line_num: 1,
          planned_qty: 100,
          actual_qty: 0,
          picked_qty: 0,
          warehouse_code: 'WH-TEST',
          ship_date: '2026-03-15',
          source_doc_number: null,
          source_line_num: null,
          dd_refs: null,
        },
        {
          id: 90012,
          item_code: 'ITEM-BETA-002',
          item_name: 'E2E 测试物料 Beta',
          line_num: 2,
          planned_qty: 120,
          actual_qty: 0,
          picked_qty: 0,
          warehouse_code: 'WH-TEST',
          ship_date: '2026-03-15',
          source_doc_number: null,
          source_line_num: null,
          dd_refs: null,
        },
        {
          id: 90013,
          item_code: 'ITEM-GAMMA-003',
          item_name: 'E2E 测试物料 Gamma',
          line_num: 3,
          planned_qty: 80,
          actual_qty: 0,
          picked_qty: 0,
          warehouse_code: 'WH-TEST',
          ship_date: '2026-03-15',
          source_doc_number: null,
          source_line_num: null,
          dd_refs: null,
        },
      ],
    },
  ],
  total: 1,
  page: 1,
  page_size: 20,
};

/** 订单明细行 (展开时单独请求) */
const MOCK_ORDER_LINES_RESPONSE = {
  success: true,
  lines: MOCK_ORDERS_RESPONSE.orders[0].lines,
};

/** DD 拆单提交成功响应 */
const MOCK_SPLIT_SUCCESS = {
  success: true,
  dd_count: 2,
  message: 'DD 创建成功',
};

// ============================================================
// 工具函数
// ============================================================

/**
 * 注入登录态 + env.js 配置，绕过鉴权
 */
async function setupAuth(page) {
  // 先导航到目标域，然后注入 localStorage (Playwright 要求 domain 匹配)
  // 使用 addInitScript 在页面加载前注入
  await page.addInitScript(() => {
    // 模拟登录态
    localStorage.setItem('wms_username', 'e2e_test_admin');
    localStorage.setItem('wms_display_name', 'E2E 测试管理员');
    localStorage.setItem('wms_role', 'admin');

    // 注入 env.js 配置 — API_BASE_URL 必须用 '/api/wms' 相对路径 (与真实环境一致)
    // ENV_NAME 用 'e2e' 而非 'testing'，避免 shared.js 生成 fixed 测试横幅遮挡看板按钮
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

/**
 * 设置所有 API 路由拦截
 *
 * 重要: Playwright 路由匹配是 **逆序** 的 (后注册优先匹配)
 * 所以: 通用 catch-all 先注册 (最低优先级)，具体路由后注册 (最高优先级)
 *
 * @param {import('@playwright/test').Page} page
 */
async function setupApiRoutes(page) {
  // ---- 最低优先级: 通用 catch-all (先注册) ----

  // 1. 拦截 webhook-test 路径 (开发环境)
  await page.route('**/api/webhook-test/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    })
  );

  // 2. 拦截其他 WMS webhook 调用 (通用 fallback)
  await page.route('**/api/wms/**', (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });

  // ---- 高优先级: 具体路由 (后注册，优先匹配) ----

  // 3. 拦截 env.js — 返回空脚本 (addInitScript 已注入 __ENV)
  await page.route('**/env.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '/* env.js intercepted by E2E */',
    })
  );

  // 4. 拦截 OMS 同步检查
  await page.route('**/api/wms/oms/sync**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'mock sync ok' }),
    })
  );

  // 5. 拦截 DD 拆单提交 API
  await page.route('**/api/wms/oms/dd/split**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SPLIT_SUCCESS),
    })
  );

  // 6. 拦截订单行明细 API (order-lines)
  await page.route('**/api/wms/oms/order-lines**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_ORDER_LINES_RESPONSE),
    })
  );

  // 7. 拦截订单查询 API (最高优先级 — 最后注册)
  await page.route('**/api/wms/oms/orders**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_ORDERS_RESPONSE),
    })
  );
}

// ============================================================
// 测试套件
// ============================================================

test.describe('OMS DD 拆单看板 E2E', () => {
  test.beforeEach(async ({ page }) => {
    // 每个测试前设置鉴权 + API 拦截
    await setupAuth(page);
    await setupApiRoutes(page);
  });

  // ----------------------------------------------------------
  // 测试 1: 页面加载 + 鉴权绕过
  // ----------------------------------------------------------
  test('页面正常加载，无登录跳转', async ({ page }) => {
    await page.goto('/wms/oms.html');

    // 标题应显示 OMS 订单管理
    await expect(page.locator('h1')).toContainText('OMS');

    // 不应跳转到 login.html
    expect(page.url()).toContain('oms.html');

    // 查询按钮可见
    await expect(
      page.locator('button', { hasText: /查询/ })
    ).toBeVisible();
  });

  // ----------------------------------------------------------
  // 测试 2: 查询订单 + 表格渲染
  // ----------------------------------------------------------
  test('查询订单并渲染 Mock 数据', async ({ page }) => {
    await page.goto('/wms/oms.html');

    // 点击查询按钮
    await page.locator('button', { hasText: /查询/ }).click();

    // 等待结果区域出现
    await expect(page.locator('#resultCard')).toBeVisible();

    // 验证结果计数
    await expect(page.locator('#resultCount')).toHaveText('1');

    // 验证表格中渲染了 Mock 单号
    await expect(page.locator('#orderBody')).toContainText('SO26-TEST-001');

    // 验证客商名称
    await expect(page.locator('#orderBody')).toContainText('E2E 测试客户');

    // 验证操作工具栏出现
    await expect(page.locator('#toolbarCard')).toBeVisible();
  });

  // ----------------------------------------------------------
  // 测试 3: 选中订单 + Checkbox 联动
  // ----------------------------------------------------------
  test('Checkbox 选中订单并显示选中计数', async ({ page }) => {
    await page.goto('/wms/oms.html');
    await page.locator('button', { hasText: /查询/ }).click();
    await expect(page.locator('#resultCard')).toBeVisible();

    // 点击订单行的 checkbox (data-oid 属性定位)
    const rowCheckbox = page.locator('#orderBody input[type="checkbox"]').first();
    await rowCheckbox.check();

    // 验证选中计数文本出现
    await expect(page.locator('#selectionCount')).not.toBeEmpty();
  });

  // ----------------------------------------------------------
  // 测试 4: 打开 DD 拆单看板
  // ----------------------------------------------------------
  test('选中 SO 后点击创建 DD，看板弹出', async ({ page }) => {
    await page.goto('/wms/oms.html');
    await page.locator('button', { hasText: /查询/ }).click();
    await expect(page.locator('#resultCard')).toBeVisible();

    // 选中订单
    const rowCheckbox = page.locator('#orderBody input[type="checkbox"]').first();
    await rowCheckbox.check();

    // 点击 "创建DD" 按钮
    const ddBtn = page.locator('button', { hasText: /创建DD|DD/ }).last();
    await ddBtn.click();

    // 等待 Vue 看板全屏弹出 (dd-fullscreen 出现)
    const board = page.locator('.dd-fullscreen');
    await expect(board).toBeVisible({ timeout: 10_000 });

    // 验证顶栏显示了源单信息
    await expect(page.locator('.dd-topbar-source')).not.toBeEmpty();

    // 验证待分配池 (dd-pool) 存在
    await expect(page.locator('.dd-pool')).toBeVisible();

    // 验证池中有物料行 (至少 1 个 dd-item-row)
    const poolItems = page.locator('.dd-pool .dd-item-row');
    await expect(poolItems.first()).toBeVisible({ timeout: 5_000 });
    const itemCount = await poolItems.count();
    expect(itemCount).toBeGreaterThanOrEqual(1);
  });

  // ----------------------------------------------------------
  // 测试 5: 添加柜子 (Container)
  // ----------------------------------------------------------
  test('点击 +DD 按钮添加新柜子', async ({ page }) => {
    await page.goto('/wms/oms.html');
    await page.locator('button', { hasText: /查询/ }).click();
    await expect(page.locator('#resultCard')).toBeVisible();

    // 选中 → 创建 DD
    await page.locator('#orderBody input[type="checkbox"]').first().check();
    await page.locator('button', { hasText: /创建DD|DD/ }).last().click();
    await expect(page.locator('.dd-fullscreen')).toBeVisible({ timeout: 10_000 });

    // 记录当前柜子数量
    const initialCount = await page.locator('.dd-column:not(.dd-pool):not(.dd-column-add)').count();

    // 点击 "+DD" 按钮添加柜
    await page.locator('.dd-column-add').click();

    // 验证柜子数量增加了 1
    const newCount = await page.locator('.dd-column:not(.dd-pool):not(.dd-column-add)').count();
    expect(newCount).toBe(initialCount + 1);
  });

  // ----------------------------------------------------------
  // 测试 6: 拖拽物料到柜子 (核心交互)
  // ----------------------------------------------------------
  test('拖拽物料从待分配池到柜子', async ({ page }) => {
    await page.goto('/wms/oms.html');
    await page.locator('button', { hasText: /查询/ }).click();
    await expect(page.locator('#resultCard')).toBeVisible();

    // 选中 → 创建 DD → 等看板
    await page.locator('#orderBody input[type="checkbox"]').first().check();
    await page.locator('button', { hasText: /创建DD|DD/ }).last().click();
    await expect(page.locator('.dd-fullscreen')).toBeVisible({ timeout: 10_000 });

    // 确保至少有一个柜子 (默认创建 1 个)；如果没有则添加
    let containerCols = page.locator('.dd-column:not(.dd-pool):not(.dd-column-add)');
    if ((await containerCols.count()) === 0) {
      await page.locator('.dd-column-add').click();
      await expect(containerCols.first()).toBeVisible();
    }

    // 记录池中物料初始数量
    const poolItemsBefore = await page.locator('.dd-pool .dd-item-row').count();
    expect(poolItemsBefore).toBeGreaterThanOrEqual(1);

    // 执行拖拽: 池中第一个物料 → 第一个柜子的 body 区域
    const sourceItem = page.locator('.dd-pool .dd-item-row').first();
    const targetContainer = page.locator('.dd-column:not(.dd-pool):not(.dd-column-add) .dd-col-body').first();

    await sourceItem.dragTo(targetContainer);

    // 给 Vue 响应时间
    await page.waitForTimeout(500);

    // 验证: 柜子内出现了至少 1 个物料行
    const containerItems = page.locator(
      '.dd-column:not(.dd-pool):not(.dd-column-add) .dd-item-row'
    );
    await expect(containerItems.first()).toBeVisible({ timeout: 5_000 });
  });

  // ----------------------------------------------------------
  // 测试 7: "均分" 按钮功能
  // ----------------------------------------------------------
  test('均分按钮将物料平均分配到所有柜子', async ({ page }) => {
    await page.goto('/wms/oms.html');
    await page.locator('button', { hasText: /查询/ }).click();
    await expect(page.locator('#resultCard')).toBeVisible();

    await page.locator('#orderBody input[type="checkbox"]').first().check();
    await page.locator('button', { hasText: /创建DD|DD/ }).last().click();
    await expect(page.locator('.dd-fullscreen')).toBeVisible({ timeout: 10_000 });

    // 确保有 >= 2 个柜子 (均分至少需要 2 个)
    const containerCols = page.locator('.dd-column:not(.dd-pool):not(.dd-column-add)');
    while ((await containerCols.count()) < 2) {
      await page.locator('.dd-column-add').click();
      await page.waitForTimeout(200);
    }
    expect(await containerCols.count()).toBeGreaterThanOrEqual(2);

    // 点击 "均分" 按钮
    const splitEvenBtn = page.locator('.dd-topbar-actions button', { hasText: /均分/ });
    await expect(splitEvenBtn).toBeVisible();
    await splitEvenBtn.click();

    // 给 Vue 状态更新时间
    await page.waitForTimeout(500);

    // 验证: 每个柜子都应该有物料 (footer 显示非零物料数)
    const footerTexts = page.locator('.dd-column:not(.dd-pool):not(.dd-column-add) .dd-col-footer');
    const footerCount = await footerTexts.count();
    for (let i = 0; i < footerCount; i++) {
      const text = await footerTexts.nth(i).textContent();
      // footer 格式: "物料: N 总量: X"
      // 验证不全为 0
      expect(text).toBeTruthy();
    }

    // 验证: 池应该为空 (所有物料已分配) — 显示 "所有物料已分配"
    await expect(page.locator('.dd-pool .dd-empty-hint')).toBeVisible({ timeout: 3_000 });
  });

  // ----------------------------------------------------------
  // 测试 8: 柜号输入
  // ----------------------------------------------------------
  test('可以为柜子输入自定义柜号', async ({ page }) => {
    await page.goto('/wms/oms.html');
    await page.locator('button', { hasText: /查询/ }).click();
    await expect(page.locator('#resultCard')).toBeVisible();

    await page.locator('#orderBody input[type="checkbox"]').first().check();
    await page.locator('button', { hasText: /创建DD|DD/ }).last().click();
    await expect(page.locator('.dd-fullscreen')).toBeVisible({ timeout: 10_000 });

    // 确保至少一个柜子
    let containerCols = page.locator('.dd-column:not(.dd-pool):not(.dd-column-add)');
    if ((await containerCols.count()) === 0) {
      await page.locator('.dd-column-add').click();
    }

    // 找到柜号输入框 (dd-col-header 中的 input)
    const containerInput = page.locator(
      '.dd-column:not(.dd-pool):not(.dd-column-add) .dd-col-header input'
    ).first();
    await expect(containerInput).toBeVisible();

    // 填入柜号
    await containerInput.fill('CTN-E2E-001');

    // 验证输入值
    await expect(containerInput).toHaveValue('CTN-E2E-001');
  });

  // ----------------------------------------------------------
  // 测试 9: 完整流程 — 拆单并提交
  // ----------------------------------------------------------
  test('完整拆单流程: 查询 → 选中 → 看板 → 均分 → 填柜号 → 提交', async ({ page }) => {
    // 用 page.on('dialog') 处理 confirm 弹窗
    page.on('dialog', async (dialog) => {
      // 自动接受确认弹窗 (如 "确认拆分为 N 个DD?")
      await dialog.accept();
    });

    await page.goto('/wms/oms.html');

    // Step 1: 查询
    await page.locator('button', { hasText: /查询/ }).click();
    await expect(page.locator('#resultCard')).toBeVisible();
    await expect(page.locator('#orderBody')).toContainText('SO26-TEST-001');

    // Step 2: 选中订单
    await page.locator('#orderBody input[type="checkbox"]').first().check();

    // Step 3: 打开看板
    await page.locator('button', { hasText: /创建DD|DD/ }).last().click();
    await expect(page.locator('.dd-fullscreen')).toBeVisible({ timeout: 10_000 });

    // Step 4: 添加第二个柜子
    const containerCols = page.locator('.dd-column:not(.dd-pool):not(.dd-column-add)');
    while ((await containerCols.count()) < 2) {
      await page.locator('.dd-column-add').click();
      await page.waitForTimeout(200);
    }

    // Step 5: 填写柜号
    const containerInputs = page.locator(
      '.dd-column:not(.dd-pool):not(.dd-column-add) .dd-col-header input'
    );
    const inputCount = await containerInputs.count();
    for (let i = 0; i < inputCount; i++) {
      await containerInputs.nth(i).fill(`CTN-E2E-${String(i + 1).padStart(3, '0')}`);
    }

    // Step 6: 均分 (自动把所有物料平均到 2 个柜)
    const splitEvenBtn = page.locator('.dd-topbar-actions button', { hasText: /均分/ });
    await splitEvenBtn.click();
    await page.waitForTimeout(500);

    // 验证池空了 (全部分配)
    await expect(page.locator('.dd-pool .dd-empty-hint')).toBeVisible({ timeout: 3_000 });

    // Step 7: 点击 "提交拆单"
    const submitBtn = page.locator('.dd-topbar-actions button.btn-submit');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Step 8: 验证 — 看板关闭，回到订单列表
    // 成功提交后看板应隐藏，页面回到订单表格
    await expect(page.locator('.dd-fullscreen')).toBeHidden({ timeout: 10_000 });

    // 验证 Toast 提示 (showMessage 创建 .message-toast)
    const toast = page.locator('.message-toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });
  });

  // ----------------------------------------------------------
  // 测试 10: 取消看板
  // ----------------------------------------------------------
  test('点击取消按钮关闭看板', async ({ page }) => {
    await page.goto('/wms/oms.html');
    await page.locator('button', { hasText: /查询/ }).click();
    await expect(page.locator('#resultCard')).toBeVisible();

    await page.locator('#orderBody input[type="checkbox"]').first().check();
    await page.locator('button', { hasText: /创建DD|DD/ }).last().click();
    await expect(page.locator('.dd-fullscreen')).toBeVisible({ timeout: 10_000 });

    // 点击 "取消" 按钮
    const cancelBtn = page.locator('.dd-topbar-actions button', { hasText: /取消/ });
    await cancelBtn.click();

    // 看板应消失
    await expect(page.locator('.dd-fullscreen')).toBeHidden({ timeout: 5_000 });
  });

  // ----------------------------------------------------------
  // 测试 11: 搜索物料过滤
  // ----------------------------------------------------------
  test('看板中搜索物料可过滤显示', async ({ page }) => {
    await page.goto('/wms/oms.html');
    await page.locator('button', { hasText: /查询/ }).click();
    await expect(page.locator('#resultCard')).toBeVisible();

    await page.locator('#orderBody input[type="checkbox"]').first().check();
    await page.locator('button', { hasText: /创建DD|DD/ }).last().click();
    await expect(page.locator('.dd-fullscreen')).toBeVisible({ timeout: 10_000 });

    // 池中应有多个物料
    const poolItems = page.locator('.dd-pool .dd-item-row');
    const beforeCount = await poolItems.count();
    expect(beforeCount).toBeGreaterThan(1);

    // 输入搜索词 — 只匹配 "ALPHA"
    const searchInput = page.locator('.dd-search-box input');
    await searchInput.fill('ALPHA');
    await page.waitForTimeout(300);

    // 池中应只显示匹配的物料
    const afterCount = await poolItems.count();
    expect(afterCount).toBeLessThan(beforeCount);

    // 验证可见物料包含 ALPHA
    await expect(poolItems.first()).toContainText('ALPHA');

    // 清空搜索 — 点击 × 按钮
    const clearBtn = page.locator('.dd-search-box button');
    await clearBtn.click();
    await page.waitForTimeout(300);

    // 恢复全部显示
    const restoredCount = await poolItems.count();
    expect(restoredCount).toBe(beforeCount);
  });

  // ----------------------------------------------------------
  // 测试 12: 防护 — 未选择订单时点击创建 DD 应提示错误
  // ----------------------------------------------------------
  test('未选择订单时创建 DD 应显示错误提示', async ({ page }) => {
    await page.goto('/wms/oms.html');
    await page.locator('button', { hasText: /查询/ }).click();
    await expect(page.locator('#resultCard')).toBeVisible();

    // 不选中任何订单，直接点击创建 DD
    await page.locator('button', { hasText: /创建DD|DD/ }).last().click();

    // 应显示错误 Toast: "请先选择订单"
    const toast = page.locator('.message-toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });
  });

  // ----------------------------------------------------------
  // 测试 13: 删除柜子
  // ----------------------------------------------------------
  test('可以删除已添加的柜子', async ({ page }) => {
    await page.goto('/wms/oms.html');
    await page.locator('button', { hasText: /查询/ }).click();
    await expect(page.locator('#resultCard')).toBeVisible();

    await page.locator('#orderBody input[type="checkbox"]').first().check();
    await page.locator('button', { hasText: /创建DD|DD/ }).last().click();
    await expect(page.locator('.dd-fullscreen')).toBeVisible({ timeout: 10_000 });

    // 添加 2 个柜子
    while (
      (await page.locator('.dd-column:not(.dd-pool):not(.dd-column-add)').count()) < 2
    ) {
      await page.locator('.dd-column-add').click();
      await page.waitForTimeout(200);
    }
    const before = await page.locator('.dd-column:not(.dd-pool):not(.dd-column-add)').count();
    expect(before).toBeGreaterThanOrEqual(2);

    // 点击第一个柜的删除按钮 (✕)
    const deleteBtn = page
      .locator('.dd-column:not(.dd-pool):not(.dd-column-add) .dd-col-actions button.btn-danger')
      .first();
    await deleteBtn.click();
    await page.waitForTimeout(300);

    // 柜子数量应减少 1
    const after = await page.locator('.dd-column:not(.dd-pool):not(.dd-column-add)').count();
    expect(after).toBe(before - 1);
  });

  // ----------------------------------------------------------
  // 测试 14: 底栏汇总信息
  // ----------------------------------------------------------
  test('底栏显示物料分配汇总', async ({ page }) => {
    await page.goto('/wms/oms.html');
    await page.locator('button', { hasText: /查询/ }).click();
    await expect(page.locator('#resultCard')).toBeVisible();

    await page.locator('#orderBody input[type="checkbox"]').first().check();
    await page.locator('button', { hasText: /创建DD|DD/ }).last().click();
    await expect(page.locator('.dd-fullscreen')).toBeVisible({ timeout: 10_000 });

    // 底栏应可见
    const bottomBar = page.locator('.dd-bottombar');
    await expect(bottomBar).toBeVisible();

    // 应有汇总项 (每个物料一个)
    const summaryItems = page.locator('.dd-summary-item');
    const count = await summaryItems.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // 物料代码应出现在汇总中
    await expect(bottomBar).toContainText('ITEM-');
  });
});
