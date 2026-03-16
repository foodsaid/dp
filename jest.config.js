/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
  // shared.js 依赖 window.__ENV、sessionStorage 等浏览器 API，
  // jsdom 已提供这些全局对象，无需额外 polyfill

  // 覆盖率: shared.js 通过 vm.Script 加载，setup.js 中 istanbul-lib-instrument 手动插桩
  // 此处声明目标文件，让 Jest reporter 输出该文件的覆盖率数据
  collectCoverageFrom: ['apps/wms/shared.js', 'apps/wms/lang.js', 'apps/wms/camera-fallback.js', 'apps/wms/ic.js', 'apps/wms/lm.js', 'apps/wms/wo.js', 'apps/wms/po.js', 'apps/wms/so.js', 'apps/wms/pi.js', 'apps/wms/tr.js', 'apps/wms/stock.js', 'apps/wms/login.js', 'apps/wms/export.js', 'apps/wms/index.js', 'apps/wms/oms.js'],
  collectCoverage: true,

  // 覆盖率门禁: 全局底线 80% + 核心库 shared.js 独立锁定
  // 防止覆盖率回退，任何 PR 低于阈值将导致测试失败
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 85,
      functions: 85,
      lines: 85,
    },
    './apps/wms/shared.js': {
      statements: 90,
      branches: 80,
      functions: 85,
      lines: 90,
    },
  },
};
