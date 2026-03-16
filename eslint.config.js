// ESLint Flat Config — Digital Platform
// 三类环境:
//   1. apps/wms/ — 浏览器原生 JS (全局函数, var/const 混用)
//   2. apps/wf/lib/ + scripts/ — Node.js CommonJS
//   3. tests/ — Jest + CommonJS
const js = require('@eslint/js');
const globals = require('globals');

// shared.js 导出的全局变量 (94 个，按功能分组)
const sharedGlobals = {
  // 配置
  CONFIG: 'readonly',
  currentTabId: 'readonly',
  // API
  apiGet: 'readonly',
  apiPost: 'readonly',
  // UI 反馈
  showMessage: 'readonly',
  showLoading: 'readonly',
  hideLoading: 'readonly',
  showConfirmDialog: 'readonly',
  showBeepIndicator: 'readonly',
  showLineSelectionModal: 'readonly',
  // 音频
  playBeepSound: 'readonly',
  playErrorSound: 'readonly',
  playSuccessSound: 'readonly',
  playWarningSound: 'readonly',
  // 认证
  getLoginUser: 'readonly',
  getLoginUsername: 'readonly',
  checkLogin: 'readonly',
  checkAuth: 'readonly',
  logout: 'readonly',
  // 格式化
  formatDate: 'readonly',
  formatDateTime: 'readonly',
  formatNumber: 'readonly',
  escapeHtml: 'readonly',
  toHalfWidth: 'readonly',
  roundQty: 'readonly',
  parseQty: 'readonly',
  // 文档
  getCurrentCompanyCode: 'readonly',
  getDocTypeName: 'readonly',
  getDocTypeLabel: 'readonly',
  getDocTypeIcon: 'readonly',
  getStatusLabel: 'readonly',
  buildDetailUrl: 'readonly',
  goToDetail: 'readonly',
  getUrlParam: 'readonly',
  autoCompleteDocument: 'readonly',
  notifyDocLoaded: 'readonly',
  printDocument: 'readonly',
  toggleGroup: 'readonly',
  // 扫码
  routeBarcode: 'readonly',
  setupBarcodeInput: 'readonly',
  createScannerEngine: 'readonly',
  focusScanInput: 'readonly',
  suppressScanFocus: 'readonly',
  addScanInputGuard: 'readonly',
  // 条码生成
  generateBarcodeUrl: 'readonly',
  // 验证
  validateTransaction: 'readonly',
  validateNumber: 'readonly',
  validateItem: 'readonly',
  validateWarehouse: 'readonly',
  validateBin: 'readonly',
  validateOverQty: 'readonly',
  validateRequired: 'readonly',
  // 提交
  submitBatch: 'readonly',
  batchSubmitAll: 'readonly',
  withSubmitGuard: 'readonly',
  // 状态管理
  saveState: 'readonly',
  loadState: 'readonly',
  clearState: 'readonly',
  _isSubmitting: 'writable',
  _isLoadingDoc: 'writable',
  _setReadonlyMode: 'readonly',
  _resetScannerState: 'readonly',
  // 主数据
  loadMasterDataCache: 'readonly',
  _getMasterCache: 'readonly',
  // 过滤与搜索
  setupSmartFilter: 'readonly',
  resetSmartFilter: 'readonly',
  filterLineByItemCode: 'readonly',
  setupPullRefresh: 'readonly',
  initCommonPageEvents: 'readonly',
  // 数量输入
  setupQtyInputGuard: 'readonly',
  setupQtyWarning: 'readonly',
  // 库位
  initBinAutocomplete: 'readonly',
  initBinHistory: 'readonly',
  _saveBinHistory: 'readonly',
  _getBinHistory: 'readonly',
  _getAllBins: 'readonly',
  isSystemBin: 'readonly',
  getDefaultBin: 'readonly',
  // 操作员
  initOperatorSelect: 'readonly',
  addOperator: 'readonly',
  getOperators: 'readonly',
  getCurrentOperator: 'readonly',
  // 锁管理
  acquireDocumentLock: 'readonly',
  releaseDocumentLock: 'readonly',
  // 页面配置
  getModuleConfig: 'readonly',
  getReceiptDefaults: 'readonly',
  getDefaultBatch: 'readonly',
  getDefaultProdDate: 'readonly',
  // 系统
  getSystemToday: 'readonly',
  getSystemDateTime: 'readonly',
  getSystemYYYYMMDD: 'readonly',
  // 子页面
  handleSubpageBarcode: 'readonly',
  renderHeaderStatus: 'readonly',
  selectLine: 'readonly',
  // SSO
  _initSSOUser: 'readonly',
  _refreshDisplayedUsername: 'readonly',
};

// lang.js 导出的全局函数
const langGlobals = {
  t: 'readonly',
  tpl: 'readonly',
  getLang: 'readonly',
  setLang: 'readonly',
  applyI18n: 'readonly',
  I18N: 'readonly',
  createLangSwitcher: 'readonly',
};

// camera-fallback.js 导出
const cameraGlobals = {
  CameraFallbackCore: 'readonly',
};

// 第三方库
const vendorGlobals = {
  Vue: 'readonly',
  JsBarcode: 'readonly',
  QRCode: 'readonly',
  Html5Qrcode: 'readonly',
  Html5QrcodeSupportedFormats: 'readonly',
  BarcodeDetector: 'readonly',
};

module.exports = [
  // ── 全局忽略 ─────────────────────────────────────
  {
    ignores: [
      'node_modules/**',
      'apps/wms/vendor/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      '**/*.min.js',
    ],
  },

  // ── 1. WMS 前端 (浏览器环境) ──────────────────────
  {
    files: ['apps/wms/**/*.js'],
    ignores: ['apps/wms/vendor/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',        // 非 ES Module, 全局作用域
      globals: {
        ...globals.browser,
        ...sharedGlobals,
        ...langGlobals,
        ...cameraGlobals,
        ...vendorGlobals,
        module: 'readonly',        // typeof module 检测 (CommonJS 导出兼容)
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': 'off',     // WMS: HTML onclick 调用无法追踪, 误报过多
      'no-undef': 'error',         // 未声明变量 — 关键错误检测
      'no-redeclare': ['warn', { builtinGlobals: false }], // 源文件定义全局函数非误报
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': 'warn',
      'no-debugger': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-extra-semi': 'warn',
      'no-unreachable': 'warn',
      'eqeqeq': ['warn', 'smart'], // == 允许 null 比较
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-var': 'off',             // 现有代码大量 var, 不强制
      'prefer-const': 'off',
      'no-useless-assignment': 'off',  // WMS: var x = ''; if(...) x = ... 初始化模式普遍
      'preserve-caught-error': 'off',  // 自定义 throw 不需要 cause
    },
  },

  // ── 2. n8n 纯函数库 + 脚本 (Node.js) ─────────────
  {
    files: ['apps/wf/lib/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', {
        args: 'none',
        caughtErrors: 'none',
      }],
      'no-undef': 'error',
      'eqeqeq': ['warn', 'smart'],
      'no-eval': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-assignment': 'warn',
    },
  },

  // ── 3. 测试文件 (Jest + jsdom) ──────────────────
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.browser,        // document/window/HTMLElement 等
        ...globals.jest,           // describe/test/expect/beforeEach 等
        ...sharedGlobals,
        ...langGlobals,
        ...cameraGlobals,
        ...vendorGlobals,
        KeyboardEvent: 'readonly',
        HTMLCanvasElement: 'readonly',
        CompositionEvent: 'readonly',
        Document: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', {
        args: 'none',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'no-undef': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'eqeqeq': 'off',           // 测试中常用松散比较
    },
  },
];
