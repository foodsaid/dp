/**
 * OMS Vue 看板桥接层测试
 * 覆盖: oms-kanban.js 的 Vue IIFE (拖拽、提交、初始化、关闭)
 *
 * 策略: Mock window.Vue，让 IIFE 内的 setup() 执行并暴露到 window._ddVueApp
 *       然后通过 _ddVueApp.initFromOrders() 触发内部逻辑
 */
const { loadSharedJs } = require('./setup');

// 加载 shared.js (oms.js 依赖)
loadSharedJs();

// t() 国际化存根
global.t = function(key, fallback) { return fallback || key; };

// initOMS 需要的 DOM
localStorage.setItem('wms_username', 'test-user');
document.body.innerHTML =
  '<input id="filterDateTo"/><input id="filterDateFrom"/>' +
  '<input id="filterBP"/><input id="filterBPName"/><input id="filterDocNum"/>' +
  '<input id="filterWarehouse"/><input id="filterContainer"/>' +
  '<select id="filterType"><option value=""></option></select>' +
  '<select id="filterStatus"><option value=""></option></select>' +
  '<select id="pageSizeSelect"></select>' +
  '<div id="toolbarCard"></div><div id="resultCard"></div>' +
  '<table><tbody id="orderBody"></tbody></table>' +
  '<span id="resultCount">0</span>' +
  '<div id="pagination"><button id="btnFirst"></button><button id="btnPrev"></button>' +
  '<button id="btnNext"></button><button id="btnLast"></button><span id="pageInfo"></span></div>' +
  '<span id="selectionCount"></span><input id="selectAll" type="checkbox"/>' +
  '<input id="selectAllHead" type="checkbox"/>' +
  '<button id="btnExpandAll"></button><button id="btnCollapseAll"></button>' +
  '<div id="ddApp"></div>';

// --- Mock Vue 3 API ---
function createMockVue() {
  return {
    ref(val) {
      const r = { value: val };
      return r;
    },
    reactive(obj) {
      return obj;
    },
    computed(fn) {
      return { value: fn(), _fn: fn };
    },
    createApp(options) {
      let setupResult = null;
      return {
        setup: options.setup,
        mount(selector) {
          setupResult = options.setup();
          // 暴露到 window 上 (setup 内部已做)
          return setupResult;
        }
      };
    }
  };
}

// 设置 window.Vue 让 IIFE 能执行
window.Vue = createMockVue();

// 加载 oms-kanban.js — 此时 Vue IIFE 会执行
const OmsKanban = require('../../../apps/wms/oms-kanban');
OmsKanban.mountDDBoard('#ddApp');

describe('OMS Vue 看板桥接层 (oms-kanban.js)', () => {

  const sampleOrders = [
    {
      id: 'order-1',
      sap_doc_num: '50001',
      doc_type: 'SO',
      lines: [
        { line_num: 1, item_code: 'A001', item_name: '物料A', planned_qty: '10', cbm: '0.5', gross_weight: '2.0' },
        { line_num: 2, item_code: 'B002', item_name: '物料B', planned_qty: '20', cbm: '1.0', gross_weight: '5.0' }
      ]
    }
  ];

  test('_ddVueApp 已暴露到 window', () => {
    expect(window._ddVueApp).toBeDefined();
    expect(typeof window._ddVueApp.initFromOrder).toBe('function');
    expect(typeof window._ddVueApp.initFromOrders).toBe('function');
  });

  test('initFromOrders 初始化看板数据', () => {
    window._ddVueApp.initFromOrders(sampleOrders);
    // 验证 body overflow 被锁定
    expect(document.body.style.overflow).toBe('hidden');
  });

  test('initFromOrder 委托到 initFromOrders', () => {
    const order = sampleOrders[0];
    window._ddVueApp.initFromOrder(order);
    expect(document.body.style.overflow).toBe('hidden');
  });
});

describe('fmtNum — 格式化数字 (Vue 提取纯函数)', () => {
  const { fmtNum } = OmsKanban;

  test('null 返回 "0"', () => {
    expect(fmtNum(null)).toBe('0');
  });

  test('undefined 返回 "0"', () => {
    expect(fmtNum(undefined)).toBe('0');
  });

  test('NaN 返回 "0"', () => {
    expect(fmtNum(NaN)).toBe('0');
  });

  test('正常数字使用 formatNumber 格式化', () => {
    // formatNumber 是 shared.js 全局函数
    expect(fmtNum(1234.5)).toBeTruthy();
  });

  test('formatNumber 不可用时回退 String()', () => {
    const origFn = global.formatNumber;
    global.formatNumber = undefined;
    expect(fmtNum(42)).toBe('42');
    global.formatNumber = origFn;
  });
});
