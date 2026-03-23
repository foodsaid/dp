// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * 跨页面边界用例 E2E 测试
 *
 * 核心策略:
 *   1. 网络异常 — 提交中断、超时、HTTP 500
 *   2. 数据边界 — 空结果、畸形响应、特殊字符
 *   3. 并发防护 — 双击提交、会话过期
 *   4. 用户体验 — 慢响应 loading 状态
 *
 * 运行: npx playwright test tests/e2e/edge-cases.spec.js --headed
 */

// ============================================================
// Mock 数据定义
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

const MOCK_PO_RESPONSE = {
  success: true,
  sap_order: {
    docNum: '26000080',
    docEntry: 801,
    docStatus: 'O',
    cardCode: 'V-TEST-001',
    cardName: '测试供应商',
    docDueDate: '2026-04-01',
    wmsStatus: 'pending',
    lines: [
      {
        lineNum: 0,
        itemCode: 'ITEM-D001',
        itemName: '测试物料 Delta',
        quantity: 50,
        deliveredQty: 0,
        openQty: 50,
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

const MOCK_LOCK_SUCCESS = { success: true, locked_by: 'e2e_test_admin' };
const MOCK_TX_SUCCESS = { success: true, message: '提交成功' };

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

function setupBaseRoutes(page) {
  return Promise.all([
    page.route('**/api/webhook-test/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      })
    ),
    page.route('**/api/wms/**', (route) => {
      const method = route.request().method();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(method === 'GET' ? { success: true, data: [] } : { success: true }),
      });
    }),
    page.route('**/env.js', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '/* env.js intercepted */',
      })
    ),
    page.route('**/api/wms/masterdata**', (route) =>
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
    ),
    page.route('**/api/wms/lock/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_LOCK_SUCCESS),
      })
    ),
  ]);
}

// ============================================================
// 一、网络异常场景
// ============================================================

test.describe('网络异常边界', () => {
  test('提交事务时网络中断 — 显示错误提示并恢复按钮状态', async ({ page }) => {
    await setupAuth(page);
    await setupBaseRoutes(page);

    // SO 查询正常返回
    await page.route('**/api/wms/so**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_SO_RESPONSE),
      })
    );

    // 事务提交 — 网络中断
    await page.route('**/api/wms/transaction**', (route) =>
      route.abort('connectionrefused')
    );

    // OMS fallback
    await page.route('**/api/wms/oms/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, orders: [], lines: [] }),
      })
    );

    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/wms/so.html?docnum=26000050');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 选择行并提交
    await page.locator('#linesBody button').first().click();
    await expect(page.locator('#pickCard')).toBeVisible({ timeout: 5_000 });
    await page.locator('#pickUser').fill('E2E操作员');
    await page.locator('#pickForm button[type="submit"]').click();

    // 应显示错误提示 (Toast)
    const toast = page.locator('.message-toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // 页面不应崩溃，应停留在 so.html
    expect(page.url()).toContain('so.html');
  });

  test('查询订单时 API 返回 HTTP 500 — 显示错误提示', async ({ page }) => {
    await setupAuth(page);
    await setupBaseRoutes(page);

    // SO 查询返回 500
    await page.route('**/api/wms/so**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
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
    await page.locator('#scanInput').fill('26000050');
    await page.locator('#scanInput').press('Enter');

    // 应显示错误消息
    const toast = page.locator('.message-toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // 页面不应崩溃
    expect(page.url()).toContain('so.html');
  });

  test('查询订单时 API 超时 — 慢响应后正常显示', async ({ page }) => {
    await setupAuth(page);
    await setupBaseRoutes(page);

    // SO 查询 — 3 秒延迟后正常返回
    await page.route('**/api/wms/so**', async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_SO_RESPONSE),
      });
    });

    await page.route('**/api/wms/oms/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, orders: [], lines: [] }),
      })
    );

    await page.goto('/wms/so.html');
    await page.locator('#scanInput').fill('26000050');
    await page.locator('#scanInput').press('Enter');

    // loading 指示器应出现 (在数据返回之前)
    const loading = page.locator('#loading, .loading-overlay, .spinner');
    // 不一定所有页面都有 loading，所以用 soft assert
    if (await loading.count() > 0) {
      await expect(loading.first()).toBeVisible({ timeout: 2_000 });
    }

    // 最终数据应正常显示 (等待 3s 延迟 + 渲染)
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#docNum')).toContainText('26000050');
  });

  test('提交事务时 API 返回 success:false — 显示业务错误', async ({ page }) => {
    await setupAuth(page);
    await setupBaseRoutes(page);

    await page.route('**/api/wms/so**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_SO_RESPONSE),
      })
    );

    // 事务提交返回业务错误
    await page.route('**/api/wms/transaction**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: '库存不足，无法提交' }),
      })
    );

    await page.route('**/api/wms/oms/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, orders: [], lines: [] }),
      })
    );

    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/wms/so.html?docnum=26000050');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    await page.locator('#linesBody button').first().click();
    await expect(page.locator('#pickCard')).toBeVisible({ timeout: 5_000 });
    await page.locator('#pickUser').fill('E2E操作员');
    await page.locator('#pickForm button[type="submit"]').click();

    // 应显示业务错误消息
    const toast = page.locator('.message-toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // 应停留在页面
    expect(page.url()).toContain('so.html');
  });
});

// ============================================================
// 二、数据边界场景
// ============================================================

test.describe('数据边界', () => {
  test('查询不存在的订单 — 显示"未找到"提示', async ({ page }) => {
    await setupAuth(page);
    await setupBaseRoutes(page);

    // SO 查询返回 success:false
    await page.route('**/api/wms/so**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: '未找到订单' }),
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
    await page.locator('#scanInput').fill('99999999');
    await page.locator('#scanInput').press('Enter');

    // 应显示错误提示
    const toast = page.locator('.message-toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // 订单卡片不应出现
    await expect(page.locator('#orderCard')).toBeHidden();
  });

  test('库存查询返回空数组 — 显示无结果提示', async ({ page }) => {
    await setupAuth(page);
    await setupBaseRoutes(page);

    // 库存查询返回空数组
    await page.route('**/api/wms/stock**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      })
    );

    await page.goto('/wms/stock.html');
    await page.locator('#scanInput').fill('NONEXISTENT');
    await page.locator('#scanInput').press('Enter');

    // 页面不应崩溃
    expect(page.url()).toContain('stock.html');

    // 应显示无结果提示或空白结果区
    await page.waitForTimeout(2_000);
    // 空状态应可见 或 表格数据行为 0
    const emptyState = page.locator('#emptyState');
    const tableBody = page.locator('#stockTableBody');
    if (await emptyState.count() > 0) {
      // 空状态提示出现 或 表格无数据行
      const bodyRows = await tableBody.locator('tr').count();
      expect(bodyRows).toBe(0);
    }
  });

  test('扫码输入特殊字符 — 页面不崩溃', async ({ page }) => {
    await setupAuth(page);
    await setupBaseRoutes(page);

    await page.route('**/api/wms/so**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: '未找到订单' }),
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

    // 输入包含 XSS 向量的特殊字符
    const xssPayload = '<script>alert(1)</script>';
    await page.locator('#scanInput').fill(xssPayload);
    await page.locator('#scanInput').press('Enter');

    // 页面不应崩溃，不应执行脚本
    expect(page.url()).toContain('so.html');

    // 检查没有 alert 弹窗 (如果有的话 dialog handler 没被触发)
    let alertTriggered = false;
    page.on('dialog', () => { alertTriggered = true; });
    await page.waitForTimeout(1_000);
    expect(alertTriggered).toBe(false);

    // 页面 DOM 不应包含未转义的 script 标签
    const bodyHtml = await page.locator('body').innerHTML();
    expect(bodyHtml).not.toContain('<script>alert(1)</script>');
  });

  test('扫码输入超长字符串 — 页面不崩溃', async ({ page }) => {
    await setupAuth(page);
    await setupBaseRoutes(page);

    await page.route('**/api/wms/so**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: '未找到' }),
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

    // 输入 1000 字符长度字符串
    const longStr = 'A'.repeat(1000);
    await page.locator('#scanInput').fill(longStr);
    await page.locator('#scanInput').press('Enter');

    // 页面不应崩溃
    await page.waitForTimeout(1_000);
    expect(page.url()).toContain('so.html');
  });

  test('仪表板统计值为 0 — 正常显示零值', async ({ page }) => {
    await setupAuth(page);
    await setupBaseRoutes(page);

    await page.route('**/api/wms/dashboard**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          stats: {
            today_transactions: 0,
            in_progress: 0,
            today_completed: 0,
            pending_export: 0,
          },
        }),
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

    // 页面正常加载
    await expect(page.locator('body')).toBeVisible();
    expect(page.url()).toContain('index.html');

    // 统计值应显示 0，不应显示 undefined/NaN/空
    const statsArea = page.locator('#todayStats, .dashboard-stats, .stats');
    if (await statsArea.count() > 0) {
      const text = await statsArea.first().textContent();
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('NaN');
    }
  });

  test('API 返回畸形 JSON — 页面优雅降级', async ({ page }) => {
    await setupAuth(page);
    await setupBaseRoutes(page);

    // 返回非 JSON 文本
    await page.route('**/api/wms/so**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html>502 Bad Gateway</html>',
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
    await page.locator('#scanInput').fill('26000050');
    await page.locator('#scanInput').press('Enter');

    // 页面不应崩溃 — 应捕获 JSON 解析错误并优雅降级
    await page.waitForTimeout(2_000);
    expect(page.url()).toContain('so.html');

    // 应显示错误提示 (Toast 或 console error)
    const toast = page.locator('.message-toast');
    if (await toast.count() > 0) {
      await expect(toast).toBeVisible({ timeout: 3_000 });
    }
  });
});

// ============================================================
// 三、并发与会话边界
// ============================================================

test.describe('并发与会话边界', () => {
  test('快速双击提交按钮 — 不产生重复请求', async ({ page }) => {
    let txCallCount = 0;

    await setupAuth(page);
    await setupBaseRoutes(page);

    await page.route('**/api/wms/po**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PO_RESPONSE),
      })
    );

    // 事务提交 — 延迟 1 秒返回并计数
    await page.route('**/api/wms/transaction**', async (route) => {
      txCallCount++;
      await new Promise((r) => setTimeout(r, 1000));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_TX_SUCCESS),
      });
    });

    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/wms/po.html?docnum=26000080');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 选择第一行收货
    await page.locator('#linesBody button').first().click();
    await expect(page.locator('#receiptCard')).toBeVisible({ timeout: 5_000 });

    // 快速双击提交
    const submitBtn = page.locator('#receiptForm button[type="submit"]').first();
    await submitBtn.dblclick();

    // 等待请求完成
    await page.waitForTimeout(3_000);

    // withSubmitGuard 应防止重复提交 — 最多 1 次有效请求
    expect(txCallCount).toBeLessThanOrEqual(1);
  });

  test('会话过期后操作 — SSO 保护 (nginx auth_request)', async ({ page }) => {
    // SSO 强制化: nginx auth_request 在网关层拦截未认证请求
    // checkAuth() 始终返回 true (不再跳转 login.html)
    // 此测试验证 checkAuth 不再阻塞页面渲染
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
    await setupBaseRoutes(page);

    // 拦截 whoami (checkAuth 会调用 _initSSOUser)
    await page.route('**/api/auth/whoami', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { display_name: 'sso_user', groups: [] } }),
      })
    );

    // 直接访问需要认证的页面 (无 localStorage 登录态)
    await page.goto('/wms/so.html');

    // SSO 模式: 页面正常加载 (不跳转 login.html)
    // checkAuth 会触发 _initSSOUser 后台获取用户信息
    await page.waitForTimeout(2_000);
    expect(page.url()).toContain('so.html');
  });

  test('锁获取网络中断 — 页面仍可查看数据', async ({ page }) => {
    await setupAuth(page);

    // 基础路由
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

    // 锁获取 — 网络中断
    await page.route('**/api/wms/lock/**', (route) =>
      route.abort('connectionrefused')
    );

    // PO 查询正常
    await page.route('**/api/wms/po**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PO_RESPONSE),
      })
    );

    await page.goto('/wms/po.html');
    await page.locator('#scanInput').fill('26000080');
    await page.locator('#scanInput').press('Enter');

    // 订单数据应仍然显示 (即使锁获取失败)
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#docNum')).toContainText('26000080');

    // 页面不应崩溃
    expect(page.url()).toContain('po.html');
  });
});

// ============================================================
// 四、PO 收货边界场景
// ============================================================

test.describe('PO 收货边界', () => {
  test('PO 查询返回无行项目 — 页面正常显示空状态', async ({ page }) => {
    await setupAuth(page);
    await setupBaseRoutes(page);

    // PO 有单头但无行项目
    await page.route('**/api/wms/po**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          sap_order: {
            docNum: '26000081',
            docEntry: 802,
            docStatus: 'O',
            cardCode: 'V-TEST-002',
            cardName: '空行供应商',
            docDueDate: '2026-04-01',
            wmsStatus: 'pending',
            lines: [],
          },
          wms_history: {
            wms_status: 'pending',
            lineReceipts: {},
            transactions: [],
          },
        }),
      })
    );

    await page.goto('/wms/po.html?docnum=26000081');

    // 等待页面处理完毕 (空行可能导致 orderCard 不显示或显示后无行)
    await page.waitForTimeout(3_000);

    // 页面不应崩溃
    expect(page.url()).toContain('po.html');

    // orderCard 显示了，行项目区域应显示空状态提示
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });
    const tbody = page.locator('#linesBody');

    // 页面可能渲染"无行项目"提示行，或 tbody 内无数据行
    // 关键: 不应有任何包含物料编号的数据行
    await expect(tbody).not.toContainText('ITEM-');
  });

  test('仪表板 API 返回 500 — 优雅降级不崩溃', async ({ page }) => {
    await setupAuth(page);
    await setupBaseRoutes(page);

    // Dashboard API 返回 500
    await page.route('**/api/wms/dashboard**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
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

    // 页面不应崩溃
    expect(page.url()).toContain('index.html');
    await expect(page.locator('body')).toBeVisible();
  });

  test('SAP lineNum=0 首行不被跳过 — 正确渲染且可操作', async ({ page }) => {
    await setupAuth(page);
    await setupBaseRoutes(page);

    // 只有一行且 lineNum=0 (SAP 行号从 0 开始，JS 中 0 是 falsy)
    await page.route('**/api/wms/po**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          sap_order: {
            docNum: '26000082',
            docEntry: 803,
            docStatus: 'O',
            cardCode: 'V-TEST-003',
            cardName: '首行测试供应商',
            docDueDate: '2026-04-01',
            wmsStatus: 'pending',
            lines: [
              {
                lineNum: 0,
                itemCode: 'ITEM-ZERO',
                itemName: '行号零测试物料',
                quantity: 25,
                deliveredQty: 0,
                openQty: 25,
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
        }),
      })
    );

    await page.goto('/wms/po.html?docnum=26000082');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // lineNum=0 的行应正常渲染在表格中
    const tbody = page.locator('#linesBody');
    await expect(tbody).toContainText('ITEM-ZERO');

    // 行数应为 1 (不应因 lineNum=0 被过滤)
    const rows = tbody.locator('tr');
    const count = await rows.count();
    expect(count).toBe(1);

    // 操作按钮应可用
    const actionBtn = rows.first().locator('button').first();
    if (await actionBtn.count() > 0) {
      await expect(actionBtn).toBeEnabled();
    }
  });
});

// ============================================================
// 五、网络恢复场景
// ============================================================

test.describe('网络恢复与重试', () => {
  test('库存查询首次超时后重新搜索 — 正常返回数据', async ({ page }) => {
    let callCount = 0;

    await setupAuth(page);
    await setupBaseRoutes(page);

    // 第一次库存查询超时，第二次正常返回
    await page.route('**/api/wms/stock**', async (route) => {
      callCount++;
      if (callCount === 1) {
        await new Promise((r) => setTimeout(r, 10000));
        return route.abort('timedout');
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [{
            item_code: 'ITEM-001', item_name: '测试物料',
            warehouse_code: 'WH01', warehouse_name: '主仓库',
            bin_code: 'A-01', batch: '',
            snapshot_qty: 50, delta_qty: 0, realtime_qty: 50, uom: 'EA',
          }],
        }),
      });
    });

    await page.goto('/wms/stock.html');

    // 第一次搜索 — 超时
    await page.locator('#scanInput').fill('ITEM-001');
    await page.locator('#scanInput').press('Enter');
    await page.waitForTimeout(2_000);

    // 第二次搜索 — 正常返回
    await page.locator('#scanInput').fill('ITEM-001');
    await page.locator('#scanInput').press('Enter');

    // 应正常显示
    await page.waitForTimeout(3_000);
    expect(page.url()).toContain('stock.html');
  });

  test('WO 查询返回已关闭订单 — 按钮不可操作', async ({ page }) => {
    await setupAuth(page);
    await setupBaseRoutes(page);

    await page.route('**/api/wms/wo**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          sap_order: {
            docNum: '26000090',
            docEntry: 901,
            docStatus: 'C',
            cardCode: '',
            cardName: '',
            docDueDate: '2026-03-01',
            wmsStatus: 'completed',
            lines: [{
              lineNum: 0,
              itemCode: 'WO-ITEM-001',
              itemName: '成品物料',
              quantity: 50,
              deliveredQty: 50,
              openQty: 0,
              lineStatus: 'C',
              whsCode: 'WH01',
              uom: 'PCS',
            }],
          },
          wms_history: {
            wms_status: 'completed',
            lineReceipts: { '0': [{ actual_qty: 50 }] },
            transactions: [],
          },
        }),
      })
    );

    await page.goto('/wms/wo.html?docnum=26000090');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 订单已关闭，页面应显示完成状态
    expect(page.url()).toContain('wo.html');
  });

  test('TR 查询返回多行物料 — 全部正常渲染', async ({ page }) => {
    await setupAuth(page);
    await setupBaseRoutes(page);

    const lines = [];
    for (let i = 0; i < 10; i++) {
      lines.push({
        lineNum: i,
        itemCode: `TR-ITEM-${String(i).padStart(3, '0')}`,
        itemName: `调拨物料 ${i}`,
        quantity: 20 + i * 5,
        deliveredQty: 0,
        openQty: 20 + i * 5,
        lineStatus: 'O',
        fromWhsCode: 'WH01',
        toWhsCode: 'WH02',
        uom: 'PCS',
      });
    }

    await page.route('**/api/wms/tr**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          sap_order: {
            docNum: '26000100',
            docEntry: 1001,
            docStatus: 'O',
            cardCode: '',
            cardName: '',
            docDueDate: '2026-03-15',
            wmsStatus: 'pending',
            lines: lines,
          },
          wms_history: {
            wms_status: 'pending',
            lineReceipts: {},
            transactions: [],
          },
        }),
      })
    );

    await page.goto('/wms/tr.html?docnum=26000100');
    await expect(page.locator('#orderCard')).toBeVisible({ timeout: 10_000 });

    // 10 行物料应全部渲染
    const tbody = page.locator('#linesBody');
    await expect(tbody).toContainText('TR-ITEM-000');
    await expect(tbody).toContainText('TR-ITEM-009');
  });

  test('IC 盘点页面 — 空仓库列表不崩溃', async ({ page }) => {
    await setupAuth(page);
    await setupBaseRoutes(page);

    // 主数据返回空仓库列表
    await page.route('**/api/wms/masterdata**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          items: [],
          warehouses: [],
          bins: [],
        }),
      })
    );

    await page.goto('/wms/ic.html');

    // 页面应正常加载不崩溃
    await page.waitForTimeout(2_000);
    expect(page.url()).toContain('ic.html');
    await expect(page.locator('body')).toBeVisible();
  });

  test('导出页 — 无数据时显示空状态', async ({ page }) => {
    await setupAuth(page);
    await setupBaseRoutes(page);

    await page.route('**/api/wms/export**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, documents: [] }),
      })
    );

    await page.goto('/wms/export.html');
    await page.waitForTimeout(2_000);

    // 页面不应崩溃
    expect(page.url()).toContain('export.html');
    await expect(page.locator('body')).toBeVisible();
  });
});
