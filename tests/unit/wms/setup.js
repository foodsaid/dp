/**
 * 测试环境初始化 — 在 jsdom 中加载 shared.js
 * 模拟 env.js 注入的 window.__ENV，在 global 作用域执行 shared.js
 * Istanbul 手动插桩: vm.Script 不被 Jest 自动追踪，需手动 instrument + 回写 __coverage__
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Istanbul 插桩器 (jest 内置依赖)
let _instrumenter = null;
try {
  const { createInstrumenter } = require('istanbul-lib-instrument');
  _instrumenter = createInstrumenter({ compact: false, esModules: false });
} catch (_) { /* 无 istanbul 时降级为无覆盖率 */ }

// confirm 模拟返回值 (闭包变量，可通过 setMockConfirm 动态切换)
let _mockConfirmResult = true;

function setMockConfirm(value) {
  _mockConfirmResult = value;
}

function loadSharedJs() {
  // 模拟 env.js 注入
  window.__ENV = {
    API_BASE_URL: '/api/wms',
    APP_BASE_URL: 'http://localhost:8080',
    SYSTEM_TIMEZONE: 'UTC',
    SOUND_ENABLED: false,
    AUTO_FOCUS_DELAY: 100,
    DEBUG: false,
    ENV_NAME: 'test',
  };

  // 模拟 AudioContext (jsdom 不提供)
  window.AudioContext = class {
    createOscillator() { return { connect() {}, start() {}, stop() {}, frequency: {} }; }
    createGain() { return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
    get currentTime() { return 0; }
  };

  // 模拟 navigator.sendBeacon
  if (!navigator.sendBeacon) {
    navigator.sendBeacon = function () { return true; };
  }

  // 模拟 Audio 构造函数
  if (typeof Audio === 'undefined') {
    global.Audio = class { play() { return Promise.resolve(); } };
  }

  const code = fs.readFileSync(
    path.join(__dirname, '../../../apps/wms/shared.js'),
    'utf-8'
  );

  // shared.js 使用 const CONFIG，需要改为 var 以便全局注册
  const patched = code.replace(/^const CONFIG/m, 'var CONFIG');

  // Istanbul 手动插桩 — 让 vm.Script 内的执行也计入覆盖率
  const absPath = path.resolve(__dirname, '../../../apps/wms/shared.js');
  const execCode = _instrumenter
    ? _instrumenter.instrumentSync(patched, absPath)
    : patched;

  // 构建 sandbox: 以 global 为原型，确保 window/document/localStorage 可用
  // 同时让 function 声明注册到 sandbox 上，然后复制回 global
  const sandbox = Object.create(global);
  sandbox.window = sandbox;        // shared.js 中 window.__ENV
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  // 将 jsdom 常用对象显式传入
  sandbox.document = document;
  sandbox.navigator = navigator;
  sandbox.localStorage = localStorage;
  sandbox.sessionStorage = sessionStorage;
  sandbox.console = console;
  // 计时器和 Date 使用动态委托 — 确保 jest.useFakeTimers() 能影响 sandbox 内代码
  Object.defineProperty(sandbox, 'setTimeout', { get: function() { return global.setTimeout; }, configurable: true, enumerable: true });
  Object.defineProperty(sandbox, 'setInterval', { get: function() { return global.setInterval; }, configurable: true, enumerable: true });
  Object.defineProperty(sandbox, 'clearTimeout', { get: function() { return global.clearTimeout; }, configurable: true, enumerable: true });
  Object.defineProperty(sandbox, 'clearInterval', { get: function() { return global.clearInterval; }, configurable: true, enumerable: true });
  Object.defineProperty(sandbox, 'Date', { get: function() { return global.Date; }, configurable: true, enumerable: true });
  sandbox.Math = Math;
  sandbox.JSON = JSON;
  sandbox.Array = Array;
  sandbox.Object = Object;
  sandbox.String = String;
  sandbox.Number = Number;
  sandbox.RegExp = RegExp;
  sandbox.Error = Error;
  sandbox.TypeError = TypeError;
  sandbox.RangeError = RangeError;
  sandbox.encodeURIComponent = encodeURIComponent;
  sandbox.decodeURIComponent = decodeURIComponent;
  sandbox.parseInt = parseInt;
  sandbox.parseFloat = parseFloat;
  sandbox.isNaN = isNaN;
  sandbox.isFinite = isFinite;
  // AudioContext / Audio 使用动态委托 — 允许测试用例通过 global.AudioContext = jest.fn() 动态替换
  Object.defineProperty(sandbox, 'AudioContext', { get: function() { return global.AudioContext; }, configurable: true, enumerable: true });
  Object.defineProperty(sandbox, 'Audio', { get: function() { return global.Audio; }, configurable: true, enumerable: true });
  // fetch 委托: 始终转发到 global.fetch，允许测试用例通过 global.fetch = jest.fn() 动态替换
  sandbox.fetch = function (...args) { return global.fetch(...args); };
  sandbox.Blob = typeof Blob !== 'undefined' ? Blob : class Blob { constructor(p, o) { this._parts = p; this._options = o; } };
  sandbox.crypto = typeof crypto !== 'undefined' ? crypto : { randomUUID: () => 'test-uuid' };
  sandbox.URL = typeof URL !== 'undefined' ? URL : undefined;
  sandbox.URLSearchParams = typeof URLSearchParams !== 'undefined' ? URLSearchParams : undefined;
  // confirm/alert 使用闭包变量，允许测试用例通过 setMockConfirm() 动态切换返回值
  sandbox.confirm = function () { return _mockConfirmResult; };
  sandbox.alert = function () {};

  vm.createContext(sandbox);
  const script = new vm.Script(execCode, { filename: absPath });
  script.runInContext(sandbox);

  // 将 Istanbul 覆盖率数据从 VM sandbox 回写到 global (Jest 从 global.__coverage__ 收集)
  if (sandbox.__coverage__) {
    if (!global.__coverage__) global.__coverage__ = {};
    Object.assign(global.__coverage__, sandbox.__coverage__);
  }

  // 将 shared.js 声明的函数/变量复制到 global，使 test 文件能访问
  const ownKeys = Object.getOwnPropertyNames(sandbox);
  for (const key of ownKeys) {
    if (key === 'window' || key === 'self' || key === 'globalThis') continue;
    if (!(key in global) || typeof sandbox[key] === 'function') {
      try { global[key] = sandbox[key]; } catch (e) { /* readonly */ }
    }
  }
}

module.exports = { loadSharedJs, setMockConfirm };
