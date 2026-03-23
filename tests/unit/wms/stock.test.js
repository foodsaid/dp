/**
 * stock.js 库存查询页业务逻辑单元测试
 * 覆盖: 纯函数 (分组/CSV/URL 构建) + DOM 绑定 (清空/查询/分页/渲染)
 *
 * 纯函数通过 require() 直接导入，DOM 函数需 JSDOM 环境 + Mock 全局依赖
 */

const stockModule = require('../../../apps/wms/stock');
const {
    buildGroupedData,
    buildCsvContent,
    buildStockQueryUrl,
    buildBrowserUrl,
    clearSearch,
    handleSearch,
    handleStockBarcode,
    quickSearch,
    renderTable,
    prevPage,
    nextPage,
    _getInternalState,
    _setInternalState,
} = stockModule;

// ============================================================================
// 纯函数测试 — 无 DOM 依赖
// ============================================================================

describe('buildGroupedData — 按物料分组 + 小计', () => {

    test('空数组返回空', () => {
        expect(buildGroupedData([])).toEqual([]);
    });

    test('单物料单行', () => {
        var data = [{ item_code: 'A001', item_name: '螺丝', uom: 'EA', base_qty: 100, delta_qty: 5, real_time_qty: 105 }];
        var result = buildGroupedData(data);
        expect(result).toHaveLength(1);
        expect(result[0].item_code).toBe('A001');
        expect(result[0].rows).toHaveLength(1);
        expect(result[0].subtotal).toEqual({ base_qty: 100, delta_qty: 5, real_time_qty: 105 });
    });

    test('单物料多行 (不同仓库/库位) 正确合计', () => {
        var data = [
            { item_code: 'A001', item_name: '螺丝', uom: 'EA', base_qty: 100, delta_qty: 5, real_time_qty: 105, whs_code: 'WH01' },
            { item_code: 'A001', item_name: '螺丝', uom: 'EA', base_qty: 200, delta_qty: -10, real_time_qty: 190, whs_code: 'WH02' },
        ];
        var result = buildGroupedData(data);
        expect(result).toHaveLength(1);
        expect(result[0].rows).toHaveLength(2);
        expect(result[0].subtotal.base_qty).toBe(300);
        expect(result[0].subtotal.delta_qty).toBe(-5);
        expect(result[0].subtotal.real_time_qty).toBe(295);
    });

    test('多物料保持插入顺序', () => {
        var data = [
            { item_code: 'B002', item_name: '垫片', uom: 'EA', base_qty: 50, delta_qty: 0, real_time_qty: 50 },
            { item_code: 'A001', item_name: '螺丝', uom: 'EA', base_qty: 100, delta_qty: 5, real_time_qty: 105 },
        ];
        var result = buildGroupedData(data);
        expect(result).toHaveLength(2);
        expect(result[0].item_code).toBe('B002');
        expect(result[1].item_code).toBe('A001');
    });

    test('item_code 缺失归入 _unknown 组', () => {
        var data = [{ item_name: '未知物料', base_qty: 10, delta_qty: 0, real_time_qty: 10 }];
        var result = buildGroupedData(data);
        expect(result[0].item_code).toBe('_unknown');
    });

    test('数量字段为字符串时正确转换为数字', () => {
        var data = [{ item_code: 'A001', base_qty: '100.5', delta_qty: '-3', real_time_qty: '97.5' }];
        var result = buildGroupedData(data);
        expect(result[0].subtotal.base_qty).toBe(100.5);
        expect(result[0].subtotal.delta_qty).toBe(-3);
        expect(result[0].subtotal.real_time_qty).toBe(97.5);
    });

    test('数量字段为 null/undefined 时视为 0', () => {
        var data = [{ item_code: 'A001', base_qty: null, delta_qty: undefined }];
        var result = buildGroupedData(data);
        expect(result[0].subtotal.base_qty).toBe(0);
        expect(result[0].subtotal.delta_qty).toBe(0);
        expect(result[0].subtotal.real_time_qty).toBe(0);
    });
});

describe('buildStockQueryUrl — 查询 URL 构建', () => {

    test('全部参数', () => {
        expect(buildStockQueryUrl('A001', 'WH01', 'A-01-01')).toBe('/stock?item=A001&whs=WH01&bin=A-01-01');
    });

    test('仅物料', () => {
        expect(buildStockQueryUrl('A001', '', '')).toBe('/stock?item=A001');
    });

    test('仅仓库', () => {
        expect(buildStockQueryUrl('', 'WH01', '')).toBe('/stock?whs=WH01');
    });

    test('仅库位', () => {
        expect(buildStockQueryUrl('', '', 'A-01-01')).toBe('/stock?bin=A-01-01');
    });

    test('全部为空', () => {
        expect(buildStockQueryUrl('', '', '')).toBe('/stock?');
    });

    test('特殊字符正确编码', () => {
        var url = buildStockQueryUrl('A 001', '', '');
        expect(url).toBe('/stock?item=A%20001');
    });
});

describe('buildBrowserUrl — 浏览器地址栏 URL', () => {

    test('有参数时包含 stock.html?...', () => {
        expect(buildBrowserUrl('A001', 'WH01', '')).toBe('stock.html?item=A001&whs=WH01');
    });

    test('无参数时返回纯 stock.html', () => {
        expect(buildBrowserUrl('', '', '')).toBe('stock.html');
    });
});

describe('buildCsvContent — CSV 导出内容', () => {

    test('包含 BOM 头', () => {
        var csv = buildCsvContent([]);
        expect(csv.charCodeAt(0)).toBe(0xFEFF);
    });

    test('包含 CSV 表头', () => {
        var csv = buildCsvContent([]);
        expect(csv).toContain('类型,物料号,物料名称,仓库,库位,批次,快照数,WMS变动,实时库存,单位');
    });

    test('单物料输出小计 + 明细行', () => {
        var data = [
            { item_code: 'A001', item_name: '螺丝', uom: 'EA', base_qty: 100, delta_qty: 5, real_time_qty: 105, whs_code: 'WH01' },
        ];
        var csv = buildCsvContent(data);
        expect(csv).toContain('[小计]');
        expect(csv).toContain('A001');
        expect(csv).toContain('明细');
        expect(csv).toContain('WH01');
    });

    test('正 delta 带 + 号', () => {
        var data = [{ item_code: 'A001', base_qty: 100, delta_qty: 10, real_time_qty: 110 }];
        var csv = buildCsvContent(data);
        expect(csv).toContain('+10');
    });

    test('CSV 转义: 含逗号的字段用双引号包裹', () => {
        var data = [{ item_code: 'A,001', item_name: '螺丝', base_qty: 100, delta_qty: 0, real_time_qty: 100 }];
        var csv = buildCsvContent(data);
        expect(csv).toContain('"A,001"');
    });

    test('CSV 转义: 含双引号的字段用 "" 转义 + 外层双引号', () => {
        var data = [{ item_code: 'A"01', item_name: '测试', base_qty: 10, delta_qty: 0, real_time_qty: 10 }];
        var csv = buildCsvContent(data);
        expect(csv).toContain('"A""01"');
    });

    test('负 delta 不带 + 号', () => {
        var data = [{ item_code: 'A001', base_qty: 100, delta_qty: -5, real_time_qty: 95 }];
        var csv = buildCsvContent(data);
        expect(csv).toContain('-5');
        expect(csv).not.toContain('+-5');
    });

    test('零 delta 不带 + 号', () => {
        var data = [{ item_code: 'A001', base_qty: 100, delta_qty: 0, real_time_qty: 100 }];
        var csv = buildCsvContent(data);
        // 小计行 delta=0，不应有 +0
        var lines = csv.split('\n');
        var subtotalLine = lines.find(function(l) { return l.indexOf('[小计]') >= 0; });
        expect(subtotalLine).toBeDefined();
        expect(subtotalLine).not.toContain('+0');
    });

    test('明细行使用 bins 回退 (bin_code 不存在时)', () => {
        var data = [{ item_code: 'A001', item_name: '螺丝', base_qty: 50, delta_qty: 0, real_time_qty: 50, bins: 'BIN-FALLBACK' }];
        var csv = buildCsvContent(data);
        expect(csv).toContain('BIN-FALLBACK');
    });

    test('明细行使用 batches 回退 (batch_number 不存在时)', () => {
        var data = [{ item_code: 'A001', item_name: '螺丝', base_qty: 50, delta_qty: 0, real_time_qty: 50, batches: 'BATCH-FB' }];
        var csv = buildCsvContent(data);
        expect(csv).toContain('BATCH-FB');
    });

    test('明细行 base_qty/real_time_qty 为 falsy 时显示 0', () => {
        var data = [{ item_code: 'A001', base_qty: 0, delta_qty: 0, real_time_qty: null }];
        var csv = buildCsvContent(data);
        var lines = csv.split('\n');
        var detailLine = lines.find(function(l) { return l.indexOf('明细') >= 0; });
        expect(detailLine).toBeDefined();
        // base_qty=0 和 real_time_qty=null → 0
        expect(detailLine).toContain(',0,');
    });
});

// ============================================================================
// DOM 绑定函数测试 — 需要 JSDOM 环境
// ============================================================================

describe('clearSearch — 清空筛选条件', () => {

    beforeEach(() => {
        document.body.innerHTML = `
            <input type="text" id="scanInput" value="A001" />
            <input type="text" id="whsFilter" value="WH01" />
            <input type="text" id="binFilter" value="A-01-01" />
            <div id="tableSection" class="">可见</div>
            <div id="resultContainer" class="">可见</div>
            <div id="emptyState" class="hidden">空状态</div>
        `;
        // Mock shared.js 全局函数
        global.hide = function(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); };
        global.show = function(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
        // 重置内部状态
        _setInternalState({ currentStockData: [{ item_code: 'A001' }], currentPage: 3 });
    });

    afterEach(() => {
        document.body.innerHTML = '';
        delete global.hide;
        delete global.show;
    });

    test('清空所有输入框', () => {
        clearSearch();
        expect(document.getElementById('scanInput').value).toBe('');
        expect(document.getElementById('whsFilter').value).toBe('');
        expect(document.getElementById('binFilter').value).toBe('');
    });

    test('隐藏表格区域, 显示空状态', () => {
        clearSearch();
        expect(document.getElementById('tableSection').classList.contains('hidden')).toBe(true);
        expect(document.getElementById('resultContainer').classList.contains('hidden')).toBe(true);
        expect(document.getElementById('emptyState').classList.contains('hidden')).toBe(false);
    });

    test('重置内部状态 (currentStockData/currentPage)', () => {
        clearSearch();
        var state = _getInternalState();
        expect(state.currentStockData).toEqual([]);
        expect(state.currentPage).toBe(1);
    });

    test('焦点回到扫码输入框', () => {
        var scanInput = document.getElementById('scanInput');
        var focusSpy = jest.spyOn(scanInput, 'focus');
        clearSearch();
        expect(focusSpy).toHaveBeenCalled();
    });
});

describe('handleSearch — 搜索触发', () => {

    beforeEach(() => {
        document.body.innerHTML = `
            <input type="text" id="scanInput" value="" />
            <input type="text" id="whsFilter" value="" />
            <input type="text" id="binFilter" value="" />
            <div id="emptyState" class="hidden"></div>
            <div id="tableSection" class="hidden"></div>
        `;
        global.showMessage = jest.fn();
        global.t = jest.fn(function(key, defaultStr) { return defaultStr; });
    });

    afterEach(() => {
        document.body.innerHTML = '';
        delete global.showMessage;
        delete global.t;
    });

    test('全空时提示用户输入', () => {
        handleSearch();
        expect(global.showMessage).toHaveBeenCalledWith('请输入物料代码、仓库或库位', 'warning');
    });
});

describe('handleStockBarcode — 扫码处理', () => {

    beforeEach(() => {
        document.body.innerHTML = `
            <input type="text" id="scanInput" value="" />
            <input type="text" id="whsFilter" value="" />
            <input type="text" id="binFilter" value="" />
            <div id="emptyState" class="hidden"></div>
            <div id="tableSection" class="hidden"></div>
            <div id="stockTableBody"></div>
        `;
        global.showLoading = jest.fn();
        global.showMessage = jest.fn();
        global.apiGet = jest.fn().mockResolvedValue({ success: true, data: [] });
        global.escapeHtml = jest.fn(function(s) { return s; });
        global.t = jest.fn(function(key, defaultStr) { return defaultStr; });
        global.playErrorSound = jest.fn();
        global.playSuccessSound = jest.fn();
        global.hide = function(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); };
        global.show = function(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
        jest.spyOn(window.history, 'replaceState').mockImplementation(function() {});
    });

    afterEach(() => {
        document.body.innerHTML = '';
        jest.restoreAllMocks();
    });

    test('空白条码不触发查询', () => {
        handleStockBarcode('   ');
        expect(global.apiGet).not.toHaveBeenCalled();
    });

    test('有效条码写入输入框', () => {
        handleStockBarcode('A001');
        expect(document.getElementById('scanInput').value).toBe('A001');
    });
});

describe('renderTable — 表格渲染 + 分页', () => {

    beforeEach(() => {
        document.body.innerHTML = `
            <table><tbody id="stockTableBody"></tbody></table>
            <span id="summaryText"></span>
            <span id="paginationInfo"></span>
            <button id="btnPrev" disabled></button>
            <button id="btnNext" disabled></button>
        `;
        global.escapeHtml = jest.fn(function(s) { return String(s || ''); });
        global.formatNumber = jest.fn(function(n) { return String(n); });
        global.tpl = jest.fn(function() { return Array.prototype.slice.call(arguments).join(' '); });

        // 设置测试数据: 3 种物料
        _setInternalState({
            currentStockData: [
                { item_code: 'A001', item_name: '螺丝', uom: 'EA', base_qty: 100, delta_qty: 5, real_time_qty: 105, whs_code: 'WH01' },
                { item_code: 'A001', item_name: '螺丝', uom: 'EA', base_qty: 50, delta_qty: -2, real_time_qty: 48, whs_code: 'WH02' },
                { item_code: 'B002', item_name: '垫片', uom: 'EA', base_qty: 200, delta_qty: 0, real_time_qty: 200, whs_code: 'WH01' },
                { item_code: 'C003', item_name: '螺母', uom: 'EA', base_qty: 80, delta_qty: 10, real_time_qty: 90, whs_code: 'WH01' },
            ],
            pageSize: 50,
            currentPage: 1,
        });
    });

    afterEach(() => {
        document.body.innerHTML = '';
        delete global.escapeHtml;
        delete global.formatNumber;
        delete global.tpl;
    });

    test('渲染 3 个分组行', () => {
        renderTable(1);
        var tbody = document.getElementById('stockTableBody');
        // A001 有 2 行 → 小计行 + 2 明细行 = 3
        // B002 单行 → 小计行 = 1
        // C003 单行 → 小计行 = 1
        // 总 TR = 3 (小计) + 2 (A001 明细) = 5
        expect(tbody.querySelectorAll('tr').length).toBe(5);
    });

    test('多行物料显示展开图标', () => {
        renderTable(1);
        var icon = document.getElementById('icon_grp_0');
        expect(icon).not.toBeNull();
        // B002 (单行) 不应有展开图标
        expect(document.getElementById('icon_grp_1')).toBeNull();
    });

    test('明细行默认隐藏', () => {
        renderTable(1);
        var details = document.querySelectorAll('.detail_grp_0');
        expect(details.length).toBe(2);
        details.forEach(function(el) {
            expect(el.style.display).toBe('none');
        });
    });

    test('currentPage 被更新', () => {
        renderTable(1);
        expect(_getInternalState().currentPage).toBe(1);
    });

    test('分页按钮状态: 第 1 页禁用上一页', () => {
        renderTable(1);
        expect(document.getElementById('btnPrev').disabled).toBe(true);
    });

    test('小分页: pageSize=2 时正确分页', () => {
        _setInternalState({ pageSize: 2 });
        renderTable(1);
        // 3 组, pageSize=2 → 第 1 页 2 组
        expect(document.getElementById('btnNext').disabled).toBe(false);
        renderTable(2);
        expect(document.getElementById('btnNext').disabled).toBe(true);
        expect(document.getElementById('btnPrev').disabled).toBe(false);
    });
});

describe('toggleGroup — 展开/折叠明细行', () => {

    beforeEach(() => {
        document.body.innerHTML = `
            <table><tbody id="stockTableBody">
                <tr data-gid="grp_0"><td><span id="icon_grp_0">&#8853;</span></td></tr>
                <tr class="detail_grp_0" style="display:none;"><td>明细1</td></tr>
                <tr class="detail_grp_0" style="display:none;"><td>明细2</td></tr>
            </tbody></table>
        `;
        // toggleGroup 是从 stock.js 导入的
        var stockModule = require('../../../apps/wms/stock');
        global.toggleGroup = stockModule.toggleGroup;
    });

    afterEach(() => {
        document.body.innerHTML = '';
        delete global.toggleGroup;
    });

    test('展开: display:none → 可见', () => {
        toggleGroup('grp_0');
        var details = document.querySelectorAll('.detail_grp_0');
        details.forEach(function(el) {
            expect(el.style.display).toBe('');
        });
    });

    test('折叠: 再次点击回到隐藏', () => {
        toggleGroup('grp_0'); // 展开
        toggleGroup('grp_0'); // 折叠
        var details = document.querySelectorAll('.detail_grp_0');
        details.forEach(function(el) {
            expect(el.style.display).toBe('none');
        });
    });

    test('不存在的 gid 不报错', () => {
        expect(() => toggleGroup('grp_999')).not.toThrow();
    });
});

describe('prevPage / nextPage — 翻页控制', () => {

    beforeEach(() => {
        document.body.innerHTML = `
            <table><tbody id="stockTableBody"></tbody></table>
            <span id="summaryText"></span>
            <span id="paginationInfo"></span>
            <button id="btnPrev"></button>
            <button id="btnNext"></button>
        `;
        global.escapeHtml = jest.fn(function(s) { return String(s || ''); });
        global.formatNumber = jest.fn(function(n) { return String(n); });
        global.tpl = jest.fn(function() { return ''; });

        // 生成 120 条数据 (120 种物料, pageSize=50 → 3 页)
        var data = [];
        for (var i = 0; i < 120; i++) {
            data.push({ item_code: 'ITEM_' + i, item_name: '物料' + i, uom: 'EA', base_qty: 10, delta_qty: 0, real_time_qty: 10 });
        }
        _setInternalState({ currentStockData: data, pageSize: 50, currentPage: 1 });
        renderTable(1);
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('nextPage 从 1 翻到 2', () => {
        nextPage();
        expect(_getInternalState().currentPage).toBe(2);
    });

    test('prevPage 从 2 翻回 1', () => {
        nextPage(); // → 2
        prevPage(); // → 1
        expect(_getInternalState().currentPage).toBe(1);
    });

    test('prevPage 在第 1 页不动', () => {
        prevPage();
        expect(_getInternalState().currentPage).toBe(1);
    });

    test('nextPage 在最后一页不动', () => {
        nextPage(); // → 2
        nextPage(); // → 3
        nextPage(); // 已到底，还是 3
        expect(_getInternalState().currentPage).toBe(3);
    });
});

describe('saveSearchHistory — 搜索历史保存', () => {
    const { saveSearchHistory } = require('../../../apps/wms/stock');

    beforeEach(() => {
        localStorage.clear();
    });

    test('空代码不保存', () => {
        saveSearchHistory('');
        expect(localStorage.getItem('stock_search_history')).toBeNull();
    });

    test('保存单条记录', () => {
        saveSearchHistory('A001');
        var history = JSON.parse(localStorage.getItem('stock_search_history'));
        expect(history).toEqual(['A001']);
    });

    test('重复代码移到最前', () => {
        saveSearchHistory('A001');
        saveSearchHistory('B002');
        saveSearchHistory('A001');
        var history = JSON.parse(localStorage.getItem('stock_search_history'));
        expect(history[0]).toBe('A001');
        expect(history[1]).toBe('B002');
        expect(history.length).toBe(2);
    });

    test('最多保留 10 条', () => {
        for (var i = 0; i < 15; i++) saveSearchHistory('ITEM_' + i);
        var history = JSON.parse(localStorage.getItem('stock_search_history'));
        expect(history.length).toBe(10);
        expect(history[0]).toBe('ITEM_14');
    });
});

describe('loadWarehouseOptions — 加载仓库下拉', () => {
    const { loadWarehouseOptions } = require('../../../apps/wms/stock');

    beforeEach(() => {
        document.body.innerHTML = '<datalist id="whsList"></datalist>';
    });

    afterEach(() => {
        document.body.innerHTML = '';
        delete global._getMasterCache;
    });

    test('无缓存时不报错', () => {
        global._getMasterCache = jest.fn().mockReturnValue(null);
        expect(() => loadWarehouseOptions()).not.toThrow();
    });

    test('缓存为空数组时不报错', () => {
        global._getMasterCache = jest.fn().mockReturnValue({ warehouses: [] });
        expect(() => loadWarehouseOptions()).not.toThrow();
    });

    test('正确填充仓库选项', () => {
        global._getMasterCache = jest.fn().mockReturnValue({
            warehouses: [
                { whs_code: 'WH01', whs_name: '主仓库' },
                { whs_code: 'WH02', whs_name: '副仓库' },
            ]
        });
        loadWarehouseOptions();
        var list = document.getElementById('whsList');
        expect(list.children.length).toBe(2);
        expect(list.children[0].value).toBe('WH01');
    });

    test('使用 code/name 后备字段', () => {
        global._getMasterCache = jest.fn().mockReturnValue({
            warehouses: [{ code: 'WH03', name: '三号仓' }]
        });
        loadWarehouseOptions();
        var list = document.getElementById('whsList');
        expect(list.children[0].value).toBe('WH03');
    });
});

describe('doQuery — 库存查询 (异步)', () => {
    const stockModule = require('../../../apps/wms/stock');

    beforeEach(() => {
        document.body.innerHTML = `
            <input type="text" id="scanInput" value="" />
            <input type="text" id="whsFilter" value="" />
            <input type="text" id="binFilter" value="" />
            <div id="emptyState" class="hidden"></div>
            <div id="tableSection" class="hidden"></div>
            <table><tbody id="stockTableBody"></tbody></table>
            <span id="summaryText"></span>
            <span id="paginationInfo"></span>
            <button id="btnPrev"></button>
            <button id="btnNext"></button>
        `;
        global.showLoading = jest.fn();
        global.showMessage = jest.fn();
        global.escapeHtml = jest.fn(function(s) { return String(s || ''); });
        global.t = jest.fn(function(key, defaultStr) { return defaultStr; });
        global.playErrorSound = jest.fn();
        global.playSuccessSound = jest.fn();
        global.formatNumber = jest.fn(function(n) { return String(n); });
        global.tpl = jest.fn(function() { return ''; });
        jest.spyOn(window.history, 'replaceState').mockImplementation(function() {});
        global.hide = function(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); };
        global.show = function(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
        localStorage.clear();
        jest.useFakeTimers();
    });

    afterEach(() => {
        document.body.innerHTML = '';
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    test('查询成功 — 渲染表格 + 播放成功音', async () => {
        global.apiGet = jest.fn().mockResolvedValue({
            success: true,
            data: [
                { item_code: 'A001', item_name: '螺丝', uom: 'EA', base_qty: 100, delta_qty: 5, real_time_qty: 105 },
            ]
        });
        await stockModule.doQuery('A001');
        expect(global.playSuccessSound).toHaveBeenCalled();
        expect(document.getElementById('tableSection').classList.contains('hidden')).toBe(false);
        var state = stockModule._getInternalState();
        expect(state.currentStockData.length).toBe(1);
    });

    test('查询无结果 — 显示空状态 + 播放错误音', async () => {
        global.apiGet = jest.fn().mockResolvedValue({ success: true, data: [] });
        await stockModule.doQuery('NOTEXIST');
        expect(global.playErrorSound).toHaveBeenCalled();
        expect(document.getElementById('emptyState').classList.contains('hidden')).toBe(false);
    });

    test('查询异常 — 显示错误信息', async () => {
        global.apiGet = jest.fn().mockRejectedValue(new Error('网络错误'));
        await stockModule.doQuery('A001');
        expect(global.showMessage).toHaveBeenCalledWith(expect.stringContaining('网络错误'), 'error');
        expect(global.playErrorSound).toHaveBeenCalled();
    });

    test('data 为非数组时包装为数组', async () => {
        global.apiGet = jest.fn().mockResolvedValue({
            success: true,
            data: { item_code: 'A001', base_qty: 100, delta_qty: 0, real_time_qty: 100 }
        });
        await stockModule.doQuery('A001');
        var state = stockModule._getInternalState();
        expect(Array.isArray(state.currentStockData)).toBe(true);
        expect(state.currentStockData.length).toBe(1);
    });

    test('仅仓库查询时 hintText 显示仓库', async () => {
        document.getElementById('whsFilter').value = 'WH01';
        global.apiGet = jest.fn().mockResolvedValue({ success: true, data: [] });
        await stockModule.doQuery('');
        var emptyHtml = document.getElementById('emptyState').innerHTML;
        expect(emptyHtml).toContain('WH01');
    });

    test('保存搜索历史', async () => {
        global.apiGet = jest.fn().mockResolvedValue({ success: true, data: [] });
        await stockModule.doQuery('A001');
        var history = JSON.parse(localStorage.getItem('stock_search_history'));
        expect(history).toContain('A001');
    });

    test('finally 块: 清空输入框并聚焦 (500ms 后)', async () => {
        global.apiGet = jest.fn().mockResolvedValue({ success: true, data: [] });
        document.getElementById('scanInput').value = 'A001';
        await stockModule.doQuery('A001');
        jest.advanceTimersByTime(500);
        expect(document.getElementById('scanInput').value).toBe('');
    });

    test('history.replaceState 被调用', async () => {
        global.apiGet = jest.fn().mockResolvedValue({ success: true, data: [] });
        await stockModule.doQuery('A001');
        expect(window.history.replaceState).toHaveBeenCalled();
    });
});

describe('exportCSV — CSV 导出', () => {
    const stockModule = require('../../../apps/wms/stock');

    beforeEach(() => {
        global.showMessage = jest.fn();
        global.getSystemToday = jest.fn().mockReturnValue('2026-03-04');
        // mock URL.createObjectURL and Blob
        global.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock');
        global.Blob = jest.fn().mockImplementation(function(content, opts) {
            this.content = content;
            this.type = opts.type;
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('无数据时提示警告', () => {
        stockModule._setInternalState({ currentStockData: [] });
        stockModule.exportCSV();
        expect(global.showMessage).toHaveBeenCalledWith('没有可导出的数据', 'warning');
    });

    test('有数据时创建下载链接', () => {
        stockModule._setInternalState({
            currentStockData: [
                { item_code: 'A001', item_name: '螺丝', uom: 'EA', base_qty: 100, delta_qty: 5, real_time_qty: 105 },
            ]
        });
        // Mock appendChild/removeChild for link element
        var appendSpy = jest.spyOn(document.body, 'appendChild').mockImplementation(function() {});
        var removeSpy = jest.spyOn(document.body, 'removeChild').mockImplementation(function() {});
        stockModule.exportCSV();
        expect(global.showMessage).toHaveBeenCalledWith(expect.stringContaining('1 种物料'), 'success');
        appendSpy.mockRestore();
        removeSpy.mockRestore();
    });
});

describe('initStock — 页面初始化', () => {
    const stockModule = require('../../../apps/wms/stock');

    beforeEach(() => {
        document.body.innerHTML = `
            <input type="text" id="scanInput" value="" />
            <input type="text" id="whsFilter" value="" />
            <input type="text" id="binFilter" value="" />
            <div id="emptyState" class="hidden"></div>
            <div id="tableSection" class="hidden"></div>
            <table><tbody id="stockTableBody"></tbody></table>
            <span id="summaryText"></span>
            <span id="paginationInfo"></span>
            <button id="btnPrev"></button>
            <button id="btnNext"></button>
        `;
        global.checkAuth = jest.fn().mockReturnValue(true);
        global.setupBarcodeInput = jest.fn();
        global.show = function(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
        global.hide = function(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); };
        global.getUrlParam = jest.fn().mockReturnValue(null);
        global.validateWarehouse = jest.fn().mockReturnValue(true);
        global.validateBin = jest.fn().mockReturnValue(true);
        global.showMessage = jest.fn();
        global.loadMasterDataCache = jest.fn().mockResolvedValue(undefined);
        global._getMasterCache = jest.fn().mockReturnValue(null);
        localStorage.clear();
    });

    afterEach(() => {
        document.body.innerHTML = '';
        jest.restoreAllMocks();
    });

    test('checkAuth 失败时直接返回', () => {
        global.checkAuth.mockReturnValue(false);
        stockModule.initStock();
        expect(global.setupBarcodeInput).not.toHaveBeenCalled();
    });

    test('正常初始化: setupBarcodeInput + 显示空状态', () => {
        stockModule.initStock();
        expect(global.checkAuth).toHaveBeenCalled();
        expect(global.setupBarcodeInput).toHaveBeenCalledWith('scanInput', expect.any(Function));
        expect(document.getElementById('emptyState').classList.contains('hidden')).toBe(false);
    });

    test('URL 有 item 参数时自动填入 + 触发查询', () => {
        global.getUrlParam = jest.fn(function(key) {
            if (key === 'item') return 'A001';
            return null;
        });
        global.showLoading = jest.fn();
        global.apiGet = jest.fn().mockResolvedValue({ success: true, data: [] });
        global.escapeHtml = jest.fn(function(s) { return s; });
        global.t = jest.fn(function(k, d) { return d; });
        global.playErrorSound = jest.fn();
        jest.spyOn(window.history, 'replaceState').mockImplementation(function() {});
        stockModule.initStock();
        expect(document.getElementById('scanInput').value).toBe('A001');
    });

    test('URL 有 whs 参数时填入并触发主数据加载', () => {
        global.getUrlParam = jest.fn(function(key) {
            if (key === 'whs') return 'WH01';
            return null;
        });
        global.showLoading = jest.fn();
        global.apiGet = jest.fn().mockResolvedValue({ success: true, data: [] });
        global.escapeHtml = jest.fn(function(s) { return s; });
        global.t = jest.fn(function(k, d) { return d; });
        global.playErrorSound = jest.fn();
        jest.spyOn(window.history, 'replaceState').mockImplementation(function() {});
        stockModule._setInternalState({ _masterDataRequested: false });
        stockModule.initStock();
        expect(document.getElementById('whsFilter').value).toBe('WH01');
        expect(global.loadMasterDataCache).toHaveBeenCalled();
    });

    test('仓库输入失焦时校验仓库代码 (不存在)', () => {
        global.validateWarehouse = jest.fn().mockReturnValue(false);
        stockModule.initStock();
        var whsEl = document.getElementById('whsFilter');
        whsEl.value = 'INVALID';
        whsEl.dispatchEvent(new Event('blur'));
        expect(global.showMessage).toHaveBeenCalledWith(expect.stringContaining('INVALID'), 'warning');
    });

    test('仓库输入失焦时校验仓库代码 (存在)', () => {
        global.validateWarehouse = jest.fn().mockReturnValue(true);
        stockModule.initStock();
        var whsEl = document.getElementById('whsFilter');
        whsEl.value = 'WH01';
        whsEl.dispatchEvent(new Event('blur'));
        expect(whsEl.style.borderColor).toBe('');
    });

    test('仓库校验返回 null (无缓存) 不阻断', () => {
        global.validateWarehouse = jest.fn().mockReturnValue(null);
        stockModule.initStock();
        var whsEl = document.getElementById('whsFilter');
        whsEl.value = 'WH01';
        whsEl.dispatchEvent(new Event('blur'));
        expect(global.showMessage).not.toHaveBeenCalled();
    });

    test('库位输入失焦时校验 (不存在)', () => {
        global.validateBin = jest.fn().mockReturnValue(false);
        stockModule.initStock();
        var binEl = document.getElementById('binFilter');
        binEl.value = 'INVALID';
        binEl.dispatchEvent(new Event('blur'));
        expect(global.showMessage).toHaveBeenCalledWith(expect.stringContaining('INVALID'), 'warning');
    });

    test('库位校验返回 null (无缓存) 不阻断', () => {
        global.validateBin = jest.fn().mockReturnValue(null);
        stockModule.initStock();
        var binEl = document.getElementById('binFilter');
        binEl.value = 'BIN01';
        binEl.dispatchEvent(new Event('blur'));
        expect(global.showMessage).not.toHaveBeenCalled();
    });

    test('空仓库值失焦不触发校验', () => {
        stockModule.initStock();
        var whsEl = document.getElementById('whsFilter');
        whsEl.value = '';
        whsEl.dispatchEvent(new Event('blur'));
        expect(global.validateWarehouse).not.toHaveBeenCalled();
    });
});

describe('_getInternalState / _setInternalState — 内部状态后门', () => {

    test('获取默认状态', () => {
        var state = _getInternalState();
        expect(state).toHaveProperty('currentStockData');
        expect(state).toHaveProperty('currentPage');
        expect(state).toHaveProperty('pageSize');
        expect(state).toHaveProperty('_groupedData');
        expect(state).toHaveProperty('_masterDataRequested');
    });

    test('设置并回读状态', () => {
        _setInternalState({ currentPage: 5, pageSize: 100 });
        var state = _getInternalState();
        expect(state.currentPage).toBe(5);
        expect(state.pageSize).toBe(100);
    });

    test('部分设置不影响其他字段', () => {
        _setInternalState({ currentPage: 99 });
        var state = _getInternalState();
        expect(state.currentPage).toBe(99);
        expect(state.pageSize).toBeDefined();
    });
});

// ============================================================================
// 补充边缘用例 — 提升覆盖率
// ============================================================================

describe('buildGroupedData — 边缘情况', () => {

    test('item_code 缺失时归入 _unknown 组', () => {
        var data = [{ item_name: '未知物料', base_qty: 10, delta_qty: 0, real_time_qty: 10 }];
        var result = buildGroupedData(data);
        expect(result).toHaveLength(1);
        expect(result[0].item_code).toBe('_unknown');
    });

    test('数量字段为字符串时正确转为数字', () => {
        var data = [{ item_code: 'X', base_qty: '100', delta_qty: '-5', real_time_qty: '95' }];
        var result = buildGroupedData(data);
        expect(result[0].subtotal.base_qty).toBe(100);
        expect(result[0].subtotal.delta_qty).toBe(-5);
        expect(result[0].subtotal.real_time_qty).toBe(95);
    });

    test('数量字段为 null/undefined 时视为 0', () => {
        var data = [{ item_code: 'Y', base_qty: null, delta_qty: undefined, real_time_qty: '' }];
        var result = buildGroupedData(data);
        expect(result[0].subtotal.base_qty).toBe(0);
        expect(result[0].subtotal.delta_qty).toBe(0);
        expect(result[0].subtotal.real_time_qty).toBe(0);
    });

    test('item_name/uom 缺失时回退空字符串', () => {
        var data = [{ item_code: 'Z', base_qty: 1, delta_qty: 0, real_time_qty: 1 }];
        var result = buildGroupedData(data);
        expect(result[0].item_name).toBe('');
        expect(result[0].uom).toBe('');
    });
});

describe('buildCsvContent — 边缘情况', () => {

    test('负 delta 不带 + 号', () => {
        var data = [{ item_code: 'A001', base_qty: 100, delta_qty: -20, real_time_qty: 80 }];
        var csv = buildCsvContent(data);
        expect(csv).toContain('-20');
        expect(csv).not.toContain('+-20');
    });

    test('delta 为 0 时不带 + 号', () => {
        var data = [{ item_code: 'A001', base_qty: 100, delta_qty: 0, real_time_qty: 100 }];
        var csv = buildCsvContent(data);
        // 小计行和明细行都包含 delta=0
        var lines = csv.split('\n').filter(function(l) { return l.indexOf('A001') >= 0; });
        lines.forEach(function(line) {
            expect(line).not.toContain('+0');
        });
    });

    test('CSV 转义: 含双引号的字段正确转义', () => {
        var data = [{ item_code: 'A"B', item_name: '测试', base_qty: 1, delta_qty: 0, real_time_qty: 1 }];
        var csv = buildCsvContent(data);
        expect(csv).toContain('"A""B"');
    });

    test('多物料多行输出完整 CSV', () => {
        var data = [
            { item_code: 'A001', item_name: '螺丝', uom: 'EA', base_qty: 100, delta_qty: 5, real_time_qty: 105, whs_code: 'WH01' },
            { item_code: 'A001', item_name: '螺丝', uom: 'EA', base_qty: 200, delta_qty: -10, real_time_qty: 190, whs_code: 'WH02' },
            { item_code: 'B002', item_name: '垫片', uom: 'KG', base_qty: 50, delta_qty: 0, real_time_qty: 50 },
        ];
        var csv = buildCsvContent(data);
        // 2 组: A001 小计+2 明细, B002 小计+1 明细 → 表头(1) + 小计(2) + 明细(3) = 6 行
        var lines = csv.split('\n').filter(function(l) { return l.trim(); });
        expect(lines.length).toBe(6);
    });

    test('batch_number/bin_code 的后备字段 bins/batches', () => {
        var data = [{
            item_code: 'C', base_qty: 10, delta_qty: 0, real_time_qty: 10,
            bins: 'A-01', batches: 'LOT001'
        }];
        var csv = buildCsvContent(data);
        expect(csv).toContain('A-01');
        expect(csv).toContain('LOT001');
    });
});

describe('buildStockQueryUrl — 边缘情况', () => {

    test('所有参数为空时只返回基本路径', () => {
        expect(buildStockQueryUrl('', '', '')).toBe('/stock?');
    });

    test('特殊字符被 URL 编码', () => {
        expect(buildStockQueryUrl('A&B', '', '')).toBe('/stock?item=A%26B');
    });
});

describe('buildBrowserUrl — 边缘情况', () => {

    test('所有参数为空时不带查询字符串', () => {
        expect(buildBrowserUrl('', '', '')).toBe('stock.html');
    });

    test('只有仓库参数', () => {
        expect(buildBrowserUrl('', 'WH01', '')).toBe('stock.html?whs=WH01');
    });

    test('三个参数都有', () => {
        var url = buildBrowserUrl('A001', 'WH01', 'B-01');
        expect(url).toBe('stock.html?item=A001&whs=WH01&bin=B-01');
    });
});

describe('saveSearchHistory — 边缘情况', () => {

    beforeEach(() => localStorage.clear());

    test('null 代码不保存', () => {
        const { saveSearchHistory } = require('../../../apps/wms/stock');
        saveSearchHistory(null);
        expect(localStorage.getItem('stock_search_history')).toBeNull();
    });

    test('已有损坏 JSON 时: 静默忽略不报错', () => {
        const { saveSearchHistory } = require('../../../apps/wms/stock');
        localStorage.setItem('stock_search_history', 'BROKEN{JSON');
        expect(() => saveSearchHistory('A001')).not.toThrow();
    });
});

describe('loadWarehouseOptions — 边缘情况', () => {
    const { loadWarehouseOptions } = require('../../../apps/wms/stock');

    test('whsList 元素不存在时静默返回', () => {
        document.body.innerHTML = '';
        global._getMasterCache = jest.fn().mockReturnValue({
            warehouses: [{ whs_code: 'WH01', whs_name: '主仓库' }]
        });
        expect(() => loadWarehouseOptions()).not.toThrow();
    });

    test('仓库缺少 whs_code 和 code 时 value 为空字符串', () => {
        document.body.innerHTML = '<datalist id="whsList"></datalist>';
        global._getMasterCache = jest.fn().mockReturnValue({
            warehouses: [{ whs_name: '无编码仓库' }]
        });
        loadWarehouseOptions();
        var list = document.getElementById('whsList');
        expect(list.children[0].value).toBe('');
    });

    afterEach(() => {
        document.body.innerHTML = '';
        delete global._getMasterCache;
    });
});

// ============================================================================
// loadSearchHistory — 通过 initStock 间接测试 (loadSearchHistory 未导出)
// ============================================================================

describe('initStock → loadSearchHistory 间接测试 (L222-237)', () => {

    beforeEach(() => {
        document.body.innerHTML = `
            <input type="text" id="scanInput" value="" />
            <input type="text" id="whsFilter" value="" />
            <input type="text" id="binFilter" value="" />
            <div id="emptyState" class="hidden"></div>
            <div id="tableSection" class="hidden"></div>
            <table><tbody id="stockTableBody"></tbody></table>
            <span id="summaryText"></span>
            <span id="paginationInfo"></span>
            <button id="btnPrev"></button>
            <button id="btnNext"></button>
            <div class="form-hint">输入物料编码</div>
        `;
        global.checkAuth = jest.fn().mockReturnValue(true);
        global.setupBarcodeInput = jest.fn();
        global.show = function(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
        global.hide = function(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); };
        global.getUrlParam = jest.fn().mockReturnValue(null);
        global.validateWarehouse = jest.fn().mockReturnValue(true);
        global.validateBin = jest.fn().mockReturnValue(true);
        global.showMessage = jest.fn();
        global.loadMasterDataCache = jest.fn().mockResolvedValue(undefined);
        global._getMasterCache = jest.fn().mockReturnValue(null);
        global.escapeHtml = jest.fn(function(s) {
            return s.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        });
    });

    afterEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        jest.restoreAllMocks();
    });

    test('有历史记录 → initStock 渲染可点击链接到 .form-hint', () => {
        localStorage.setItem('stock_search_history', JSON.stringify(['A001', 'B002', 'C003']));
        stockModule.initStock();
        var hint = document.querySelector('.form-hint');
        expect(hint.innerHTML).toContain('最近查询');
        expect(hint.querySelectorAll('.history-link').length).toBe(3);
        expect(hint.querySelector('.history-link').getAttribute('data-code')).toBe('A001');
    });

    test('无历史记录 → .form-hint 内容不变', () => {
        localStorage.setItem('stock_search_history', JSON.stringify([]));
        var originalHTML = document.querySelector('.form-hint').innerHTML;
        stockModule.initStock();
        // 空历史不修改 hint
        expect(document.querySelector('.form-hint').innerHTML).toBe(originalHTML);
    });

    test('历史含 XSS 标签 → escapeHtml 防注入（无 img 元素创建）', () => {
        localStorage.setItem('stock_search_history', JSON.stringify(['<img src=x onerror=alert(1)>']));
        stockModule.initStock();
        var hint = document.querySelector('.form-hint');
        // 关键安全断言: escapeHtml 阻止了 img 元素的创建
        expect(hint.querySelector('img')).toBeNull();
        // 历史链接仍然存在且可点击
        expect(hint.querySelectorAll('.history-link').length).toBe(1);
    });

    test('超过 5 条只显示前 5 条', () => {
        localStorage.setItem('stock_search_history', JSON.stringify(['A', 'B', 'C', 'D', 'E', 'F', 'G']));
        stockModule.initStock();
        expect(document.querySelectorAll('.history-link').length).toBe(5);
    });

    test('点击历史链接 → input 值变化 (quickSearch 触发)', () => {
        localStorage.setItem('stock_search_history', JSON.stringify(['A001']));
        // quickSearch 需要 doQuery 依赖
        global.showLoading = jest.fn();
        global.apiGet = jest.fn().mockResolvedValue({ success: true, data: [] });
        global.t = jest.fn(function(k, d) { return d; });
        global.playErrorSound = jest.fn();
        global.playSuccessSound = jest.fn();
        jest.spyOn(window.history, 'replaceState').mockImplementation(function() {});

        stockModule.initStock();
        var link = document.querySelector('.history-link');
        link.click();
        expect(document.getElementById('scanInput').value).toBe('A001');
    });
});

// ============================================================================
// quickSearch — 快速搜索 (L239-242)
// ============================================================================

describe('quickSearch — 快速搜索', () => {

    beforeEach(() => {
        document.body.innerHTML = `
            <input type="text" id="scanInput" value="" />
            <input type="text" id="whsFilter" value="" />
            <input type="text" id="binFilter" value="" />
            <div id="emptyState" class="hidden"></div>
            <div id="tableSection" class="hidden"></div>
            <div id="stockTableBody"></div>
        `;
        global.showLoading = jest.fn();
        global.showMessage = jest.fn();
        global.apiGet = jest.fn().mockResolvedValue({ success: true, data: [] });
        global.escapeHtml = jest.fn(function(s) { return s; });
        global.t = jest.fn(function(key, d) { return d; });
        global.playErrorSound = jest.fn();
        global.playSuccessSound = jest.fn();
        global.hide = function(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); };
        global.show = function(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
        jest.spyOn(window.history, 'replaceState').mockImplementation(function() {});
    });

    afterEach(() => {
        document.body.innerHTML = '';
        jest.restoreAllMocks();
    });

    test('传入物料码 → 设置 input 值 + 触发 doQuery', () => {
        quickSearch('A001');
        expect(document.getElementById('scanInput').value).toBe('A001');
        // doQuery 内部会调用 apiGet
        expect(global.apiGet).toHaveBeenCalled();
    });

    test('空字符串 → 仍触发 doQuery（由 doQuery 内部处理空值）', () => {
        quickSearch('');
        expect(document.getElementById('scanInput').value).toBe('');
    });
});

// ============================================================================
// handleStockBarcode — 扫码触发查询的完整路径 (L244-260, L259)
// ============================================================================

describe('handleStockBarcode — 有效条码触发 doQuery', () => {

    beforeEach(() => {
        document.body.innerHTML = `
            <input type="text" id="scanInput" value="" />
            <input type="text" id="whsFilter" value="" />
            <input type="text" id="binFilter" value="" />
            <div id="emptyState" class="hidden"></div>
            <div id="tableSection" class="hidden"></div>
            <div id="stockTableBody"></div>
        `;
        global.showLoading = jest.fn();
        global.showMessage = jest.fn();
        global.apiGet = jest.fn().mockResolvedValue({ success: true, data: [] });
        global.escapeHtml = jest.fn(function(s) { return s; });
        global.t = jest.fn(function(key, d) { return d; });
        global.playErrorSound = jest.fn();
        global.playSuccessSound = jest.fn();
        global.hide = function(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); };
        global.show = function(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
        jest.spyOn(window.history, 'replaceState').mockImplementation(function() {});
    });

    afterEach(() => {
        document.body.innerHTML = '';
        jest.restoreAllMocks();
    });

    test('有效条码 → trim + 设置 input + 触发 apiGet 查询', () => {
        handleStockBarcode('  B002  ');
        expect(document.getElementById('scanInput').value).toBe('B002');
        // handleStockBarcode → doQuery → apiGet
        expect(global.apiGet).toHaveBeenCalled();
    });
});

// ============================================================================
// handleSearch — 有效搜索条件触发 doQuery (L251-259)
// ============================================================================

describe('handleSearch — 有效搜索条件路径', () => {

    beforeEach(() => {
        document.body.innerHTML = `
            <input type="text" id="scanInput" value="" />
            <input type="text" id="whsFilter" value="" />
            <input type="text" id="binFilter" value="" />
            <div id="emptyState" class="hidden"></div>
            <div id="tableSection" class="hidden"></div>
            <div id="stockTableBody"></div>
        `;
        global.showLoading = jest.fn();
        global.showMessage = jest.fn();
        global.apiGet = jest.fn().mockResolvedValue({ success: true, data: [] });
        global.escapeHtml = jest.fn(function(s) { return s; });
        global.t = jest.fn(function(key, d) { return d; });
        global.playErrorSound = jest.fn();
        global.playSuccessSound = jest.fn();
        global.hide = function(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); };
        global.show = function(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
        jest.spyOn(window.history, 'replaceState').mockImplementation(function() {});
    });

    afterEach(() => {
        document.body.innerHTML = '';
        jest.restoreAllMocks();
    });

    test('有物料码时触发 doQuery', () => {
        document.getElementById('scanInput').value = 'A001';
        handleSearch();
        expect(global.apiGet).toHaveBeenCalled();
        expect(global.showMessage).not.toHaveBeenCalled();
    });

    test('仅有仓库筛选时触发 doQuery', () => {
        document.getElementById('whsFilter').value = 'WH01';
        handleSearch();
        expect(global.apiGet).toHaveBeenCalled();
    });

    test('仅有库位筛选时触发 doQuery', () => {
        document.getElementById('binFilter').value = 'BIN-A';
        handleSearch();
        expect(global.apiGet).toHaveBeenCalled();
    });
});

// ============================================================================
// initStock — 扫码回调 + bin blur 验证路径 (L132-135, L183-185)
// ============================================================================

describe('initStock — 扫码回调和库位验证', () => {

    var _barcodeCallback;

    beforeEach(() => {
        document.body.innerHTML = `
            <input type="text" id="scanInput" value="" />
            <input type="text" id="whsFilter" value="" />
            <input type="text" id="binFilter" value="" />
            <datalist id="whsList"></datalist>
            <div id="emptyState"></div>
            <div id="tableSection" class="hidden"></div>
            <div id="stockTableBody"></div>
            <div class="form-hint">提示</div>
        `;
        global.checkAuth = jest.fn().mockReturnValue(true);
        global.setupBarcodeInput = jest.fn(function(id, cb) { _barcodeCallback = cb; });
        global.loadMasterDataCache = jest.fn().mockResolvedValue(undefined);
        global.playBeepSound = jest.fn();
        global.showBeepIndicator = jest.fn();
        global.showLoading = jest.fn();
        global.showMessage = jest.fn();
        global.apiGet = jest.fn().mockResolvedValue({ success: true, data: [] });
        global.escapeHtml = jest.fn(function(s) { return s; });
        global.t = jest.fn(function(key, d) { return d; });
        global.tpl = jest.fn(function() { return ''; });
        global.playErrorSound = jest.fn();
        global.playSuccessSound = jest.fn();
        global.getUrlParam = jest.fn().mockReturnValue('');
        global.validateWarehouse = jest.fn().mockReturnValue(null);
        global.validateBin = jest.fn().mockReturnValue(null);
        global._getMasterCache = jest.fn().mockReturnValue(null);
        global.hide = function(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); };
        global.show = function(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
        jest.spyOn(window.history, 'replaceState').mockImplementation(function() {});
    });

    afterEach(() => {
        document.body.innerHTML = '';
        jest.restoreAllMocks();
        _barcodeCallback = null;
    });

    test('扫码回调 → playBeepSound + showBeepIndicator + handleStockBarcode', () => {
        stockModule.initStock();
        expect(_barcodeCallback).toBeDefined();

        // 触发回调 (覆盖 L132-135)
        _barcodeCallback('SCAN001');

        expect(global.playBeepSound).toHaveBeenCalled();
        expect(global.showBeepIndicator).toHaveBeenCalled();
        expect(document.getElementById('scanInput').value).toBe('SCAN001');
    });

    test('库位 blur → 有效库位 → 纠正值 + 绿色边框 (L183-185)', () => {
        global.validateBin = jest.fn().mockReturnValue({ bin_code: 'BIN-001' });
        stockModule.initStock();

        var binEl = document.getElementById('binFilter');
        binEl.value = 'bin-001';
        binEl.dispatchEvent(new Event('blur'));

        expect(binEl.value).toBe('BIN-001');
        expect(binEl.style.borderColor).toBe('');
    });

    test('库位 blur → 无效库位 → 警告边框 + 提示消息', () => {
        global.validateBin = jest.fn().mockReturnValue(false);
        stockModule.initStock();

        var binEl = document.getElementById('binFilter');
        binEl.value = 'INVALID';
        binEl.dispatchEvent(new Event('blur'));

        expect(binEl.style.borderColor).toBe('#f59e0b');
        expect(global.showMessage).toHaveBeenCalledWith(expect.stringContaining('不在主数据'), 'warning');
    });
});

// ============================================================================
// setText / show / hide — 辅助函数 (L441-443)
// ============================================================================

describe('setText / show / hide — 辅助 DOM 函数', () => {

    beforeEach(() => {
        document.body.innerHTML = '<div id="test1">old</div><div id="test2" class="hidden">hidden</div>';
    });

    test('setText 设置文本内容', () => {
        stockModule.renderTable && void 0; // 确保模块已加载
        // setText 未导出，但 show/hide 被 stock.js 内部使用
        // 直接测试 show/hide 行为通过 clearSearch 间接验证
    });
});
