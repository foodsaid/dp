# Playwright E2E 测试 SOP

> 版本: v1.0 | 创建: 2026-03-06 | 来源: OMS DD 拆单看板首轮实战

---

## 1. 环境配置

### 安装 (WSL 环境)
```bash
# 安装包
npm install -D @playwright/test

# 安装浏览器 + 系统依赖 (WSL 必须两步)
npx playwright install chromium
sudo npx playwright install-deps chromium   # 安装 libnspr4 等系统库
```

### 运行命令
```bash
# 必须在 WSL 中运行 (Windows 侧 node_modules 路径不兼容)
E2E_BASE_URL=http://localhost:8080 node_modules/.bin/playwright test
# 或
E2E_BASE_URL=http://localhost:8080 npm run test:e2e

# 稳定性验证 (跑 2 轮)
node_modules/.bin/playwright test --repeat-each=2
```

### 关键教训: WSL + Windows 路径陷阱
- `npm install -D @playwright/test` 在 Windows 和 WSL 中需要分别执行
- Windows 侧的 `node_modules` 在 WSL 中可能找不到 `@playwright/test`
- **始终用 `wsl -d Ubuntu-24.04 -- bash -c '...'` 在 WSL 中运行测试**
- `npx playwright test` 可能使用 npx 缓存中的旧版本，用 `node_modules/.bin/playwright test` 更可靠

---

## 2. 鉴权绕过

WMS 前端鉴权检查: `shared.js` 的 `checkAuth()` 检测 `localStorage.wms_username`。

```javascript
await page.addInitScript(() => {
  localStorage.setItem('wms_username', 'e2e_test_admin');
  localStorage.setItem('wms_display_name', 'E2E 测试管理员');
  localStorage.setItem('wms_role', 'admin');
});
```

`addInitScript` 在页面所有脚本之前执行，完美绕过鉴权。

---

## 3. env.js 拦截与注入

### 原理
WMS 前端通过 `env.js` 注入 `window.__ENV` 配置（Docker 容器启动时生成）。
E2E 测试中需要：
1. `addInitScript` 预设 `window.__ENV`
2. `page.route` 拦截真实 `env.js` 返回空脚本

### 关键参数
```javascript
window.__ENV = {
  ENV_NAME: 'e2e',           // ⚠️ 不要用 'testing'！
  API_BASE_URL: '/api/wms',  // ⚠️ 必须用相对路径！
  SOUND_ENABLED: false,
  // ...
};
```

### 教训 1: ENV_NAME 不能用 'testing'
`shared.js` 在 `ENV_NAME === 'testing'` 时会生成一个 `position:fixed; z-index:99999` 的红色测试横幅。
这个横幅会**遮挡看板顶栏按钮的 pointer events**，导致所有看板内的 click 操作失败：
```
<div id="test-env-banner">⚠ 测试环境 — TEST ENVIRONMENT ⚠</div> intercepts pointer events
```
**解决**: 用 `'e2e'` 或 `'development'` 避免触发横幅。

### 教训 2: API_BASE_URL 必须是 '/api/wms' 相对路径
真实环境的 `env.js` 中 `API_BASE_URL: '/api/wms'`（相对路径）。
`shared.js` 中 `CONFIG.n8nBaseUrl = API_BASE_URL`，`apiGet(path)` → `fetch(CONFIG.n8nBaseUrl + path)`。
- 正确: `/api/wms` + `/oms/orders` = `/api/wms/oms/orders`
- 错误: `http://localhost:8080` + `/oms/orders` = `http://localhost:8080/oms/orders`（绕过了网关 `/api/wms/` 前缀）

---

## 4. Network Interception 路由规则

### 核心原则: Playwright 路由匹配是**逆序**的
**后注册的路由优先匹配！** 这与直觉相反。

```
注册顺序:     通用 catch-all → 具体路由
匹配优先级:   具体路由（后注册）> 通用 catch-all（先注册）
```

### 正确的注册顺序
```javascript
// 1. 最低优先级 — 先注册
await page.route('**/api/wms/**', genericHandler);        // catch-all

// 2. 中优先级
await page.route('**/api/wms/oms/sync**', syncHandler);
await page.route('**/api/wms/oms/dd/split**', splitHandler);
await page.route('**/api/wms/oms/order-lines**', linesHandler);

// 3. 最高优先级 — 最后注册
await page.route('**/api/wms/oms/orders**', ordersHandler);
```

### 教训 3: 路由顺序反了会导致数据格式不匹配
如果通用 `**/api/wms/**` 在具体路由之后注册（最高优先级），它会返回 `{ success: true, data: [] }`，
而 `queryOrders()` 期望的是 `{ success: true, orders: [...] }`，导致表格显示 "无匹配数据"。

### WMS API 路径映射
| 前端调用 | 实际 URL | 用途 |
|---------|---------|------|
| `apiGet('/oms/orders?...')` | `/api/wms/oms/orders?...` | 订单查询 |
| `apiGet('/oms/order-lines?order_id=X')` | `/api/wms/oms/order-lines?order_id=X` | 订单行明细 |
| `apiPost('/oms/dd/split', body)` | `/api/wms/oms/dd/split` | DD 拆单提交 |
| `apiGet('/oms/sync/check')` | `/api/wms/oms/sync/check` | 同步检查 |

---

## 5. Mock 数据格式

### 订单查询响应
```javascript
{
  success: true,
  orders: [{
    id: 9001,
    doc_type: 'SO',
    doc_number: 'SO26-TEST-001',
    sap_doc_num: 'SO26-TEST-001',
    business_partner: 'C-MOCK-BP01',
    bp_name: '测试客户',
    total_planned_qty: 300,
    total_actual_qty: 0,
    warehouse_code: 'WH-TEST',
    doc_date: '2026-03-06',
    oms_status: 'pending',
    execution_state: 'idle',
    is_split: false,
    dd_children: [],
    line_count: 3,
    lines: [
      { id: 90011, item_code: 'ITEM-001', item_name: '物料A', line_num: 1,
        planned_qty: 100, actual_qty: 0, picked_qty: 0, warehouse_code: 'WH-TEST' },
      // ...更多行
    ]
  }],
  total: 1,
  page: 1,
  page_size: 20
}
```

### DD 拆单成功响应
```javascript
{ success: true, dd_count: 2, message: 'DD 创建成功' }
```

---

## 6. DOM 选择器速查

### OMS 页面核心元素
| 选择器 | 说明 |
|-------|------|
| `#resultCard` | 结果表格卡片 (默认 `display:none`) |
| `#resultCount` | 匹配记录数文本 |
| `#orderBody` | 订单 tbody |
| `#orderBody input[type="checkbox"]` | 订单行 checkbox |
| `#toolbarCard` | 操作工具栏 (默认 `display:none`) |
| `#selectionCount` | 选中计数文本 |
| `button[onclick="queryOrders()"]` 或 `button:has-text("查询")` | 查询按钮 |
| `button[onclick="openDDSplitModal()"]` 或 `button:has-text("创建DD")` | 创建 DD 按钮 |

### DD 看板核心元素
| 选择器 | 说明 |
|-------|------|
| `.dd-fullscreen` | 看板全屏容器 (Vue `v-if="showBoard"`) |
| `.dd-pool` | 待分配物料池 |
| `.dd-pool .dd-item-row` | 池中物料行 |
| `.dd-column:not(.dd-pool):not(.dd-column-add)` | 柜子列 |
| `.dd-column-add` | "+DD" 添加柜按钮 |
| `.dd-topbar-actions button:has-text("均分")` | 均分按钮 (文本可能是 "均分到各DD") |
| `.dd-topbar-actions button:has-text("取消")` | 取消按钮 |
| `.dd-topbar-actions button.btn-submit` | 提交拆单按钮 |
| `.dd-search-box input` | 物料搜索框 |
| `.dd-col-header input` | 柜号输入框 |
| `.dd-col-actions button.btn-danger` | 删除柜按钮 (✕) |
| `.dd-bottombar` | 底栏汇总 |
| `.dd-summary-item` | 汇总项 |
| `.dd-empty-hint` | 空提示 ("所有物料已分配" / "拖拽物料到此柜") |
| `.message-toast` | showMessage Toast 提示 |

---

## 7. 常用交互模式

### 拖拽 (HTML5 Drag & Drop)
```javascript
const source = page.locator('.dd-pool .dd-item-row').first();
const target = page.locator('.dd-column:not(.dd-pool):not(.dd-column-add) .dd-col-body').first();
await source.dragTo(target);
await page.waitForTimeout(500);  // 给 Vue 响应时间
```

### confirm() 弹窗处理
```javascript
page.on('dialog', async (dialog) => {
  await dialog.accept();  // 自动接受确认弹窗
});
```

### 等待 Vue 看板出现
```javascript
await expect(page.locator('.dd-fullscreen')).toBeVisible({ timeout: 10_000 });
```

---

## 8. 测试用例模板

### 完整拆单流程
```javascript
test('完整拆单流程', async ({ page }) => {
  page.on('dialog', d => d.accept());
  await page.goto('/wms/oms.html');

  // 查询
  await page.locator('button', { hasText: /查询/ }).click();
  await expect(page.locator('#resultCard')).toBeVisible();

  // 选中
  await page.locator('#orderBody input[type="checkbox"]').first().check();

  // 创建 DD → 看板弹出
  await page.locator('button', { hasText: /创建DD|DD/ }).last().click();
  await expect(page.locator('.dd-fullscreen')).toBeVisible({ timeout: 10_000 });

  // 添加柜 + 均分
  const cols = page.locator('.dd-column:not(.dd-pool):not(.dd-column-add)');
  while ((await cols.count()) < 2) await page.locator('.dd-column-add').click();
  await page.locator('.dd-topbar-actions button', { hasText: /均分/ }).click();
  await page.waitForTimeout(500);
  await expect(page.locator('.dd-pool .dd-empty-hint')).toBeVisible({ timeout: 3_000 });

  // 提交
  await page.locator('.dd-topbar-actions button.btn-submit').click();
  await expect(page.locator('.dd-fullscreen')).toBeHidden({ timeout: 10_000 });
  await expect(page.locator('.message-toast')).toBeVisible({ timeout: 5_000 });
});
```

---

## 9. 故障排查清单

| 现象 | 原因 | 解决 |
|------|------|------|
| `Cannot find module '@playwright/test'` | WSL 和 Windows node_modules 不共享 | 在 WSL 中重新 `npm install -D @playwright/test` |
| `libnspr4.so: cannot open shared object` | WSL 缺少 Chromium 系统依赖 | `sudo npx playwright install-deps chromium` |
| `#resultCard` 不可见，表格不渲染 | API 路由拦截未匹配 | 检查路由注册顺序（逆序匹配）+ API_BASE_URL 路径 |
| `resultCount = 0` / "无匹配数据" | Mock 数据格式不匹配 | 确保返回 `{ success: true, orders: [...] }` 而非 `{ data: [] }` |
| `intercepts pointer events` | 固定定位元素遮挡按钮 | ENV_NAME 不用 'testing'；或 `{ force: true }` 强制点击 |
| dragTo 无效果 | Vue 未及时响应 | 加 `waitForTimeout(500)` 等 Vue 状态更新 |
| `No tests found` | 路径解析问题 (WSL ↔ Windows) | 不指定文件路径，让 config 中 `testDir` 自动发现 |

---

## 10. playwright.config.js 要点

```javascript
module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,            // OMS 有状态依赖，串行更稳
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:8080',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: { browserName: 'chromium', viewport: { width: 1440, height: 900 }, locale: 'zh-CN' },
  }],
});
```
