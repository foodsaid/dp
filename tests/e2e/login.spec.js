// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * 登录页面 E2E 测试 (SSO 强制化)
 *
 * 核心策略:
 *   SSO 模式下 login.html 始终重定向到 Authelia (/auth/?rd=...)
 *   已登录用户访问 login.html 也会被重定向
 *
 * 运行: npx playwright test tests/e2e/login.spec.js --headed
 */

// ============================================================
// 工具函数
// ============================================================

/**
 * 设置 env.js 拦截
 */
async function setupEnvJs(page) {
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
}

/**
 * 设置基础 API 路由拦截
 */
async function setupBaseRoutes(page) {
  // env.js 返回空脚本 (addInitScript 已注入)
  await page.route('**/env.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '/* env.js intercepted by E2E */',
    })
  );

  // 通用 WMS API fallback
  await page.route('**/api/wms/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    })
  );

  // webhook-test fallback
  await page.route('**/api/webhook-test/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    })
  );
}

// ============================================================
// 测试套件
// ============================================================

test.describe('登录页面 E2E (SSO 强制)', () => {
  // ----------------------------------------------------------
  // 测试 1: login.html 重定向到 SSO
  // ----------------------------------------------------------
  test('访问登录页自动重定向到 Authelia SSO', async ({ page }) => {
    await setupEnvJs(page);
    await setupBaseRoutes(page);

    // 拦截 Authelia 重定向目标 (避免真正跳转到不存在的服务)
    await page.route('**/auth/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>Authelia Login</body></html>',
      })
    );

    await page.goto('/wms/login.html');

    // login.js 会立即重定向到 /auth/?rd=...
    await page.waitForURL('**/auth/**', { timeout: 10_000 });
    expect(page.url()).toContain('/auth/');
  });

  // ----------------------------------------------------------
  // 测试 2: 已登录用户访问登录页也重定向到 SSO
  // ----------------------------------------------------------
  test('已登录用户访问登录页也重定向到 SSO', async ({ page }) => {
    await setupEnvJs(page);
    await setupBaseRoutes(page);

    // 注入登录态
    await page.addInitScript(() => {
      localStorage.setItem('wms_username', 'e2e_admin');
      localStorage.setItem('wms_display_name', 'E2E 管理员');
      localStorage.setItem('wms_role', 'admin');
    });

    // 拦截 Authelia 重定向目标
    await page.route('**/auth/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>Authelia Login</body></html>',
      })
    );

    await page.goto('/wms/login.html');

    // 即使已登录，login.js 也会重定向到 SSO
    await page.waitForURL('**/auth/**', { timeout: 10_000 });
    expect(page.url()).toContain('/auth/');
  });
});
