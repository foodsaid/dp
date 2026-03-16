// @ts-check
const { defineConfig } = require('@playwright/test');

/**
 * Playwright E2E 测试配置
 *
 * 运行方式:
 *   npx playwright test                    # 全部 E2E 测试
 *   npx playwright test --headed           # 有界面模式 (调试)
 *   npx playwright test --ui               # 交互式 UI 模式
 *   npx playwright test tests/e2e/oms-dd-split.spec.js  # 单个文件
 */
module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,            // OMS 测试有状态依赖，串行更稳定
  forbidOnly: !!process.env.CI,    // CI 环境禁止 .only
  retries: process.env.CI ? 1 : 0, // CI 失败重试 1 次
  workers: 1,                      // 单 worker，避免并发冲突
  reporter: [
    ['html', { open: 'never' }],   // HTML 报告 (不自动打开)
    ['list'],                      // 终端列表输出
  ],

  use: {
    /* 默认指向网关端口 (docker compose dev 环境) */
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:8080',

    /* 截图 & 视频：仅失败时保留 */
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',

    /* 超时 */
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  timeout: 60_000,                 // 单个测试最长 60 秒

  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
        locale: 'zh-CN',
      },
    },
  ],
});
