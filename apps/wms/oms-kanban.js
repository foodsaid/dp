/**
 * OMS 看板纯业务逻辑 + Vue DD 看板
 * exports: OmsKanban (round4, createKanbanState, validateDDSplit, ...)
 * requires: shared.js (formatNumber), lang.js (t), vue.global.prod.js (Vue)
 */
/* global checkDep, formatNumber, OmsKanban, queryOrders, OmsState */
if (typeof checkDep === 'function') {
    checkDep('shared.js', typeof formatNumber !== 'undefined' ? formatNumber : undefined);
}

window.OmsKanban = (function() {
    'use strict';

    // ============================================================
    // 纯函数 — 可测试的业务逻辑 (从 Vue IIFE 中提取)
    // ============================================================

    /**
     * 四位小数精度工具
     */
    function round4(x) { return Math.round(x * 10000) / 10000; }

    /**
     * 检查 itemMap 中是否有 CBM 数据
     * @param {Object} itemMapObj - 物料映射 { lineKey: { cbm, ... } }
     * @returns {boolean}
     */
    function checkHasCbmData(itemMapObj) {
        var codes = Object.keys(itemMapObj || {});
        for (var i = 0; i < codes.length; i++) {
            if ((itemMapObj[codes[i]].cbm || 0) > 0) return true;
        }
        return false;
    }

    /**
     * 检查 itemMap 中是否有重量数据
     * @param {Object} itemMapObj - 物料映射 { lineKey: { grossWeight, ... } }
     * @returns {boolean}
     */
    function checkHasWeightData(itemMapObj) {
        var codes = Object.keys(itemMapObj || {});
        for (var i = 0; i < codes.length; i++) {
            if ((itemMapObj[codes[i]].grossWeight || 0) > 0) return true;
        }
        return false;
    }

    /**
     * 构建汇总项列表 (从 Vue computed summaryItems 提取)
     * @param {Object} itemMapObj - 物料映射
     * @param {Function} getRemainingFn - 获取剩余数量函数 (lineKey) => number
     * @returns {Array} 汇总项数组
     */
    function buildSummaryItems(itemMapObj, getRemainingFn) {
        var result = [];
        var codes = Object.keys(itemMapObj || {});
        for (var i = 0; i < codes.length; i++) {
            var item = itemMapObj[codes[i]];
            var rem = getRemainingFn(item.lineKey);
            var statusClass, statusIcon;
            if (Math.abs(rem) < 0.0001) {
                statusClass = 'dd-status-ok'; statusIcon = '\u2713';
            } else if (rem < 0) {
                statusClass = 'dd-status-err'; statusIcon = '\u2717';
            } else {
                statusClass = 'dd-status-warn'; statusIcon = '\u26A0';
            }
            result.push({
                lineKey: item.lineKey, itemCode: item.itemCode,
                sapDocNum: item.sapDocNum, lineNum: item.lineNum,
                totalQty: item.totalQty,
                statusClass: statusClass, statusIcon: statusIcon
            });
        }
        return result;
    }

    /**
     * 构建源单标签文本 (从 Vue computed sourceLabel 提取)
     * @param {Array} sourceOrders - 源订单数组
     * @param {number} itemCount - 物料项数
     * @param {Function} [tFn] - 翻译函数
     * @returns {string}
     */
    function buildSourceLabel(sourceOrders, itemCount, tFn) {
        var _t = tFn || function(k, d) { return d || k; };
        if (!sourceOrders || sourceOrders.length === 0) return '';
        var labels = sourceOrders.map(function(o) {
            return (o.doc_type || 'SO') + '#' + (o.sap_doc_num || o.doc_number || '');
        });
        return labels.join(' + ') + ' | ' + itemCount + _t('oms.items_unit', '项');
    }

    /**
     * 创建看板纯逻辑状态 (无 Vue 依赖)
     * @param {Object} [extItemMap] - 外部 itemMap (Vue.reactive 或普通对象)
     * @param {Array} [extContainers] - 外部 containers (Vue.reactive 或普通数组)
     * @param {Function} [getSearchTermFn] - searchTerm 获取函数 (Vue ref 或闭包)
     * @returns {Object} 看板方法集合
     */
    function createKanbanState(extItemMap, extContainers, getSearchTermFn) {
        var itemMap = extItemMap || {};
        var containers = extContainers || [];
        var _nextId = 1;
        var _searchTerm = '';
        var _getSearchTerm = getSearchTermFn || function() { return _searchTerm; };

        function getRemaining(lineKey) {
            var item = itemMap[lineKey];
            if (!item) return 0;
            var sum = 0;
            var keys = Object.keys(item.allocated);
            for (var i = 0; i < keys.length; i++) { sum += (item.allocated[keys[i]] || 0); }
            return round4(item.totalQty - sum);
        }

        function getMaxAllowed(lineKey, cid) {
            var item = itemMap[lineKey];
            if (!item) return 0;
            var otherSum = 0;
            var keys = Object.keys(item.allocated);
            for (var i = 0; i < keys.length; i++) {
                var k = keys[i];
                if (String(k) !== String(cid)) { otherSum += (item.allocated[k] || 0); }
            }
            return round4(item.totalQty - otherSum);
        }

        function matchesSearch(item) {
            var term = _getSearchTerm().toLowerCase();
            if (!term) return true;
            return item.itemCode.toLowerCase().indexOf(term) >= 0 ||
                   item.itemName.toLowerCase().indexOf(term) >= 0;
        }

        function getPoolItems() {
            var term = _getSearchTerm().toLowerCase();
            var result = [];
            var codes = Object.keys(itemMap);
            for (var i = 0; i < codes.length; i++) {
                var item = itemMap[codes[i]];
                if (term) {
                    if (matchesSearch(item)) result.push(item);
                } else {
                    if (getRemaining(item.lineKey) > 0.0001) result.push(item);
                }
            }
            return result;
        }

        function getContainerItems(cid) {
            var term = _getSearchTerm().toLowerCase();
            var result = [];
            var codes = Object.keys(itemMap);
            for (var i = 0; i < codes.length; i++) {
                var item = itemMap[codes[i]];
                if (term) {
                    if (matchesSearch(item)) result.push(item);
                } else {
                    if ((item.allocated[cid] || 0) > 0.0001) result.push(item);
                }
            }
            return result;
        }

        function getContainerItemCount(cid) {
            var count = 0;
            var codes = Object.keys(itemMap);
            for (var i = 0; i < codes.length; i++) {
                if ((itemMap[codes[i]].allocated[cid] || 0) > 0.0001) count++;
            }
            return count;
        }

        function getContainerTotalQty(cid) {
            var total = 0;
            var codes = Object.keys(itemMap);
            for (var i = 0; i < codes.length; i++) { total += (itemMap[codes[i]].allocated[cid] || 0); }
            return round4(total);
        }

        function getContainerCbm(cid) {
            var total = 0;
            var codes = Object.keys(itemMap);
            for (var i = 0; i < codes.length; i++) {
                var item = itemMap[codes[i]];
                var qty = item.allocated[cid] || 0;
                if (qty > 0 && item.totalQty > 0) {
                    total += round4(qty / item.totalQty * (item.cbm || 0));
                }
            }
            return round4(total);
        }

        function getContainerWeight(cid) {
            var total = 0;
            var codes = Object.keys(itemMap);
            for (var i = 0; i < codes.length; i++) {
                var item = itemMap[codes[i]];
                var qty = item.allocated[cid] || 0;
                if (qty > 0 && item.totalQty > 0) {
                    total += round4(qty / item.totalQty * (item.grossWeight || 0));
                }
            }
            return round4(total);
        }

        function initFromOrder(order) {
            Object.keys(itemMap).forEach(function(k) { delete itemMap[k]; });
            containers.splice(0, containers.length);
            _nextId = 1;
            _searchTerm = '';
            var lines = order.lines || [];
            for (var j = 0; j < lines.length; j++) {
                var ln = lines[j];
                var lineKey = order.id + '_' + ln.line_num;
                itemMap[lineKey] = {
                    lineKey: lineKey,
                    orderId: order.id,
                    lineNum: ln.line_num,
                    sapDocNum: order.sap_doc_num || '',
                    itemCode: ln.item_code,
                    itemName: ln.item_name || '',
                    totalQty: parseFloat(ln.planned_qty) || 0,
                    cbm: parseFloat(ln.cbm) || 0,
                    grossWeight: parseFloat(ln.gross_weight) || 0,
                    sources: [{ orderId: order.id, lineNum: ln.line_num, qty: parseFloat(ln.planned_qty) || 0 }],
                    allocated: {}
                };
            }
        }

        function updateQty(cid, lineKey, newVal) {
            var item = itemMap[lineKey];
            if (!item) return;
            var val = parseFloat(newVal);
            if (isNaN(val)) return;
            if (val < 0) val = 0;
            var otherSum = 0;
            var keys = Object.keys(item.allocated);
            for (var i = 0; i < keys.length; i++) {
                if (String(keys[i]) !== String(cid)) otherSum += (item.allocated[keys[i]] || 0);
            }
            var maxAllowed = round4(item.totalQty - otherSum);
            var clamped = Math.min(round4(val), maxAllowed);
            clamped = Math.max(0, clamped);
            if (clamped > 0.0001) {
                item.allocated[cid] = clamped;
            } else {
                delete item.allocated[cid];
            }
        }

        function splitEvenly() {
            var n = containers.length;
            if (n < 2) return;
            var codes = Object.keys(itemMap);
            for (var i = 0; i < codes.length; i++) {
                var item = itemMap[codes[i]];
                var rem = getRemaining(item.lineKey);
                if (rem < 0.0001) continue;
                var perDD = round4(rem / n);
                var assigned = 0;
                for (var j = 0; j < n; j++) {
                    var cid = containers[j].id;
                    var existing = item.allocated[cid] || 0;
                    if (j < n - 1) {
                        item.allocated[cid] = round4(existing + perDD);
                        assigned += perDD;
                    } else {
                        item.allocated[cid] = round4(existing + (rem - assigned));
                    }
                }
            }
        }

        function fillRemaining(cid) {
            var codes = Object.keys(itemMap);
            for (var i = 0; i < codes.length; i++) {
                var item = itemMap[codes[i]];
                var rem = getRemaining(item.lineKey);
                if (rem > 0.0001) {
                    var existing = item.allocated[cid] || 0;
                    item.allocated[cid] = round4(existing + rem);
                }
            }
        }

        function addContainer() {
            containers.push({ id: _nextId++, containerNo: '' });
        }

        function removeContainer(cid) {
            var codes = Object.keys(itemMap);
            for (var i = 0; i < codes.length; i++) {
                delete itemMap[codes[i]].allocated[cid];
            }
            var idx = containers.findIndex(function(c) { return c.id === cid; });
            if (idx >= 0) containers.splice(idx, 1);
        }

        function onDropToPool(fromCid, lineKey) {
            if (fromCid === 'pool') return;
            var item = itemMap[lineKey];
            if (item) { delete item.allocated[fromCid]; }
        }

        function onDropToContainer(targetCid, fromCid, lineKey) {
            var item = itemMap[lineKey];
            if (!item) return;
            if (fromCid === 'pool') {
                var rem = getRemaining(item.lineKey);
                if (rem > 0.0001) {
                    var existing = item.allocated[targetCid] || 0;
                    item.allocated[targetCid] = round4(existing + rem);
                }
            } else if (String(fromCid) !== String(targetCid)) {
                var srcQty = item.allocated[fromCid] || 0;
                if (srcQty > 0.0001) {
                    var existTarget = item.allocated[targetCid] || 0;
                    item.allocated[targetCid] = round4(existTarget + srcQty);
                    delete item.allocated[fromCid];
                }
            }
        }

        function isAllAllocated() {
            var codes = Object.keys(itemMap);
            if (codes.length === 0) return false;
            for (var i = 0; i < codes.length; i++) {
                if (Math.abs(getRemaining(codes[i])) >= 0.0001) return false;
            }
            return true;
        }

        function validateSubmit() {
            if (containers.length === 0) return '请至少创建一个DD';
            var hasAnyAlloc = false;
            for (var ci = 0; ci < containers.length; ci++) {
                if (getContainerItemCount(containers[ci].id) > 0) { hasAnyAlloc = true; break; }
            }
            if (!hasAnyAlloc) return '没有任何已分配物料';
            var nos = [];
            for (var ci2 = 0; ci2 < containers.length; ci2++) {
                var no = containers[ci2].containerNo.trim();
                if (!no) return '请填写所有DD的柜号';
                nos.push(no.toUpperCase());
            }
            if (new Set(nos).size !== nos.length) return '柜号不能重复';
            return null;
        }

        function buildPayload(sourceOrder) {
            var payload = { source_order_id: sourceOrder.id, dd_groups: [] };
            for (var pi = 0; pi < containers.length; pi++) {
                var c = containers[pi];
                var ddLines = [];
                var allKeys = Object.keys(itemMap);
                for (var ki = 0; ki < allKeys.length; ki++) {
                    var entry = itemMap[allKeys[ki]];
                    if (entry.orderId !== sourceOrder.id) continue;
                    var allocQty = entry.allocated[c.id] || 0;
                    if (allocQty > 0.0001) {
                        ddLines.push({
                            item_code: entry.itemCode,
                            item_name: entry.itemName,
                            line_num: entry.lineNum,
                            qty: round4(allocQty)
                        });
                    }
                }
                if (ddLines.length > 0) {
                    payload.dd_groups.push({ container_no: c.containerNo.trim(), lines: ddLines });
                }
            }
            return payload;
        }

        return {
            itemMap: itemMap,
            containers: containers,
            getRemaining: getRemaining,
            getMaxAllowed: getMaxAllowed,
            getPoolItems: getPoolItems,
            getContainerItems: getContainerItems,
            getContainerItemCount: getContainerItemCount,
            getContainerTotalQty: getContainerTotalQty,
            getContainerCbm: getContainerCbm,
            getContainerWeight: getContainerWeight,
            initFromOrder: initFromOrder,
            updateQty: updateQty,
            splitEvenly: splitEvenly,
            fillRemaining: fillRemaining,
            addContainer: addContainer,
            removeContainer: removeContainer,
            onDropToPool: onDropToPool,
            onDropToContainer: onDropToContainer,
            isAllAllocated: isAllAllocated,
            validateSubmit: validateSubmit,
            buildPayload: buildPayload,
            setSearchTerm: function(v) { _searchTerm = v; },
            _resetState: function() { _nextId = 1; _searchTerm = ''; }
        };
    }

    /**
     * DD 拆单前置校验
     */
    function validateDDSplit(sourceOrder, ddGroups) {
        var errors = [];
        if (!sourceOrder) {
            errors.push('源订单不存在');
            return errors;
        }
        if (sourceOrder.doc_type !== 'SO') {
            errors.push('DD 拆单仅支持 SO 类型');
        }
        if (sourceOrder.execution_state === 'executing' || sourceOrder.execution_state === 'done') {
            errors.push('该订单已在 WMS 执行中');
        }
        if (!Array.isArray(ddGroups) || ddGroups.length === 0) {
            errors.push('缺少 DD 组');
            return errors;
        }
        var sourceLines = sourceOrder.lines || [];
        var hasAllocation = false;
        for (var li = 0; li < sourceLines.length; li++) {
            var totalAllocated = 0;
            ddGroups.forEach(function(g) {
                if (g.lines && g.lines[li]) {
                    totalAllocated += (parseFloat(g.lines[li].allocated_qty) || 0);
                }
            });
            if (totalAllocated > 0) hasAllocation = true;
            if (Math.abs(totalAllocated - (sourceLines[li].planned_qty || 0)) > 0.001) {
                errors.push('分配数量不匹配: ' + sourceLines[li].item_code);
            }
        }
        if (!hasAllocation) {
            errors.push('请至少分配一个物料');
        }
        return errors;
    }

    /**
     * 批量单号输入解析 (去重 + 上限 50)
     */
    function parseDocNumInput(input) {
        if (!input || !input.trim()) return { nums: [], error: null };
        var docNum = input.trim();
        var numsArr = docNum.split(/\s+/).filter(Boolean);
        var uniqueNums = [];
        var seen = {};
        numsArr.forEach(function(n) { if (!seen[n]) { seen[n] = true; uniqueNums.push(n); } });
        if (uniqueNums.length > 50) {
            return { nums: [], error: '最多批量查询 50 个单号' };
        }
        return { nums: uniqueNums, error: null };
    }

    /**
     * 从多个 SO 订单构建 itemMap 数据结构 (纯函数，无 Vue 依赖)
     * @param {Array} orders - 源订单数组
     * @returns {Object} itemMap — { lineKey: { lineKey, orderId, lineNum, sapDocNum, itemCode, itemName, warehouseCode, totalQty, cbm, grossWeight, sources, allocated } }
     */
    function buildInitItemMap(orders) {
        var itemMap = {};
        for (var oi = 0; oi < orders.length; oi++) {
            var order = orders[oi];
            var lines = order.lines || [];
            for (var j = 0; j < lines.length; j++) {
                var ln = lines[j];
                var lineKey = order.id + '_' + ln.line_num;
                itemMap[lineKey] = {
                    lineKey: lineKey,
                    orderId: order.id,
                    lineNum: ln.line_num,
                    sapDocNum: order.sap_doc_num || '',
                    itemCode: ln.item_code,
                    itemName: ln.item_name || '',
                    warehouseCode: ln.warehouse_code || order.warehouse_code || '',
                    totalQty: parseFloat(ln.planned_qty) || 0,
                    cbm: parseFloat(ln.cbm) || 0,
                    grossWeight: parseFloat(ln.gross_weight) || 0,
                    sources: [{ orderId: order.id, lineNum: ln.line_num, qty: parseFloat(ln.planned_qty) || 0 }],
                    allocated: {}
                };
            }
        }
        return itemMap;
    }

    /**
     * 多 SO 提交校验 (纯函数，5 项校验)
     * @param {Object} itemMap - 物料映射
     * @param {Array} containers - 容器数组
     * @param {Function} getContainerItemCountFn - 获取容器物料数函数
     * @param {number} [sourceOrderCount] - 源订单数
     * @returns {Object} { valid: boolean, error: string|null, validCount: number }
     */
    function validateMultiSOSubmit(itemMap, containers, getContainerItemCountFn, sourceOrderCount) {
        // ① 柜数 > 0
        if (containers.length === 0) {
            return { valid: false, error: 'no_container', validCount: 0 };
        }

        // ② 有分配物料的柜 > 0
        var hasAnyAlloc = false;
        for (var ci = 0; ci < containers.length; ci++) {
            if (getContainerItemCountFn(containers[ci].id) > 0) { hasAnyAlloc = true; break; }
        }
        if (!hasAnyAlloc) {
            return { valid: false, error: 'no_alloc', validCount: 0 };
        }

        // ③ containerNo 不重复 (非必填，仅校验非空柜号)
        var nos = [];
        for (var ci2 = 0; ci2 < containers.length; ci2++) {
            var no = containers[ci2].containerNo.trim();
            if (no) nos.push(no.toUpperCase());
        }
        if (nos.length > 0 && new Set(nos).size !== nos.length) {
            return { valid: false, error: 'container_dup', validCount: 0 };
        }

        // ④ 所有物料必须全部分配完
        var unallocated = [];
        var allKeys = Object.keys(itemMap);
        for (var ui = 0; ui < allKeys.length; ui++) {
            var chkItem = itemMap[allKeys[ui]];
            var totalAlloc = 0;
            var akeys = Object.keys(chkItem.allocated);
            for (var ai = 0; ai < akeys.length; ai++) {
                totalAlloc += (chkItem.allocated[akeys[ai]] || 0);
            }
            if (Math.abs(round4(totalAlloc) - round4(chkItem.totalQty)) >= 0.0001) {
                unallocated.push((chkItem.sapDocNum ? chkItem.sapDocNum + ' ' : '') + 'L' + chkItem.lineNum + ': ' + chkItem.itemCode);
            }
        }
        if (unallocated.length > 0) {
            return { valid: false, error: 'unallocated', unallocated: unallocated, validCount: 0 };
        }

        // ⑤ 拦截无意义拆单
        var validCount = 0;
        for (var vc = 0; vc < containers.length; vc++) {
            if (getContainerItemCountFn(containers[vc].id) > 0) validCount++;
        }
        var soCount = sourceOrderCount || 1;
        if (validCount === 1 && soCount <= 1) {
            return { valid: false, error: 'single_no_change', validCount: validCount };
        }

        return { valid: true, error: null, validCount: validCount, soCount: soCount };
    }

    /**
     * 构建多 SO 提交 payload (纯函数)
     * @param {Object} itemMap - 物料映射
     * @param {Array} containers - 容器数组
     * @param {Array} sourceOrders - 源订单数组
     * @returns {Object} { source_order_ids: [], dd_groups: [] }
     */
    function buildMultiSOPayload(itemMap, containers, sourceOrders) {
        var ddGroups = [];
        var allSourceIds = new Set();

        for (var pi = 0; pi < containers.length; pi++) {
            var c = containers[pi];
            var cno = c.containerNo.trim() || ('DD-' + (pi + 1));
            var ddLines = [];
            var keys = Object.keys(itemMap);
            for (var ci3 = 0; ci3 < keys.length; ci3++) {
                var item = itemMap[keys[ci3]];
                var allocQty = item.allocated[c.id] || 0;
                if (allocQty < 0.0001) continue;

                allSourceIds.add(item.orderId);
                var srcOrder = sourceOrders.find(function(o) { return o.id === item.orderId; });
                ddLines.push({
                    item_code: item.itemCode,
                    item_name: item.itemName,
                    line_num: item.lineNum,
                    qty: round4(allocQty),
                    warehouse_code: item.warehouseCode || '',
                    source_order_id: item.orderId,
                    source_doc_num: srcOrder ? (srcOrder.sap_doc_num || srcOrder.doc_number || '') : ''
                });
            }
            if (ddLines.length > 0) {
                ddGroups.push({ container_no: cno, lines: ddLines });
            }
        }

        return {
            source_order_ids: Array.from(allSourceIds),
            dd_groups: ddGroups
        };
    }

    /**
     * 格式化数字 (从 Vue 方法提取)
     */
    function fmtNum(val) {
        if (val == null || isNaN(val)) return '0';
        return typeof formatNumber === 'function' ? formatNumber(val) : String(val);
    }

    // ============================================================
    // DD 全屏看板 — Vue 3 Composition API
    // ============================================================
    var _mountedApi = null;

    function mountDDBoard(selector) {
        if (_mountedApi) return _mountedApi;
        var Vue = typeof window !== 'undefined' && window.Vue;
        if (!Vue) return null;
        var el = typeof document !== 'undefined' && document.querySelector(selector);
        if (!el) return null;

        var app = Vue.createApp({
            setup: function() {
                // ---- 响应式状态 ----
                var showBoard = Vue.ref(false);
                var searchTerm = Vue.ref('');
                var isSubmitting = Vue.ref(false);
                var dragOverTarget = Vue.ref(null);
                var _dragSource = Vue.ref(null);

                var itemMap = Vue.reactive({});
                var containers = Vue.reactive([]);
                var _sourceOrders = null;
                var _savedOverflow = '';

                // ---- 委托纯逻辑到 createKanbanState ----
                var kb = createKanbanState(itemMap, containers, function() { return searchTerm.value; });
                var getRemaining = kb.getRemaining;
                var getMaxAllowed = kb.getMaxAllowed;
                var getContainerItems = kb.getContainerItems;
                var getContainerItemCount = kb.getContainerItemCount;
                var getContainerTotalQty = kb.getContainerTotalQty;
                var getContainerCbm = kb.getContainerCbm;
                var getContainerWeight = kb.getContainerWeight;
                var updateQty = kb.updateQty;
                var splitEvenly = kb.splitEvenly;
                var fillRemaining = kb.fillRemaining;
                var addContainer = kb.addContainer;
                var removeContainer = kb.removeContainer;

                // ---- Vue computed ----
                var poolItems = Vue.computed(function() { return kb.getPoolItems(); });

                var hasCbmData = Vue.computed(function() { return checkHasCbmData(itemMap); });

                var hasWeightData = Vue.computed(function() { return checkHasWeightData(itemMap); });

                var summaryItems = Vue.computed(function() { return buildSummaryItems(itemMap, getRemaining); });

                var isAllAllocated = Vue.computed(function() { return kb.isAllAllocated(); });

                var sourceLabel = Vue.computed(function() {
                    return buildSourceLabel(_sourceOrders, Object.keys(itemMap).length, typeof t === 'function' ? t : undefined);
                });

                // ---- Actions: initFromOrders (多 SO 合并 + UI) ----
                function initFromOrders(orders) {
                    _sourceOrders = orders;
                    // 清空
                    var oldKeys = Object.keys(itemMap);
                    for (var i = 0; i < oldKeys.length; i++) { delete itemMap[oldKeys[i]]; }
                    containers.splice(0, containers.length);
                    kb._resetState();
                    searchTerm.value = '';
                    isSubmitting.value = false;

                    // 委托纯函数构建 itemMap 数据
                    var built = buildInitItemMap(orders);
                    var builtKeys = Object.keys(built);
                    for (var bi = 0; bi < builtKeys.length; bi++) {
                        itemMap[builtKeys[bi]] = Vue.reactive(built[builtKeys[bi]]);
                    }

                    // 默认创建 1 个柜
                    addContainer();

                    // 打开全屏 + body scroll lock
                    _savedOverflow = document.body.style.overflow;
                    document.body.style.overflow = 'hidden';
                    showBoard.value = true;
                }

                function initFromOrder(order) {
                    initFromOrders([order]);
                }

                // ---- Drag & Drop ----
                function onDragStart(ev, from, lineKey) {
                    _dragSource.value = { from: from, lineKey: lineKey };
                    if (ev && ev.dataTransfer) {
                        ev.dataTransfer.effectAllowed = 'move';
                        ev.dataTransfer.setData('text/plain', lineKey);
                    }
                }

                function onDragEnd() {
                    _dragSource.value = null;
                    dragOverTarget.value = null;
                }

                function onPoolLeave(ev) {
                    if (ev.currentTarget && !ev.currentTarget.contains(ev.relatedTarget)) {
                        if (dragOverTarget.value === 'pool') dragOverTarget.value = null;
                    }
                }

                function onColLeave(ev, cid) {
                    if (ev.currentTarget && !ev.currentTarget.contains(ev.relatedTarget)) {
                        if (dragOverTarget.value === cid) dragOverTarget.value = null;
                    }
                }

                function onDropToPool() {
                    dragOverTarget.value = null;
                    if (!_dragSource.value) return;
                    var src = _dragSource.value;
                    kb.onDropToPool(src.from, src.lineKey);
                    _dragSource.value = null;
                }

                function onDropToContainer(targetCid) {
                    dragOverTarget.value = null;
                    if (!_dragSource.value) return;
                    var src = _dragSource.value;
                    kb.onDropToContainer(targetCid, src.from, src.lineKey);
                    _dragSource.value = null;
                }

                // ---- Actions: submit (行级直接映射, 支持多 SO) ----
                async function submitDD() {
                    if (isSubmitting.value) return;

                    // 委托纯函数校验
                    var soCount = _sourceOrders ? _sourceOrders.length : 1;
                    var vResult = validateMultiSOSubmit(itemMap, containers, getContainerItemCount, soCount);

                    if (!vResult.valid) {
                        var errMsgs = {
                            no_container: t('oms.dd_no_container', '请至少创建一个DD'),
                            no_alloc: t('oms.dd_no_alloc', '没有任何已分配物料'),
                            container_dup: t('oms.dd_container_dup', '柜号不能重复'),
                            unallocated: t('oms.dd_unallocated', '以下物料未完全分配: ') + (vResult.unallocated || []).join(', '),
                            single_no_change: t('oms.dd_single_no_change', '只有一个柜子且数量未删减，无需拆单，请直接使用SO作业')
                        };
                        if (vResult.error === 'single_no_change') {
                            alert(errMsgs[vResult.error]);
                        } else {
                            showMessage(errMsgs[vResult.error] || vResult.error, vResult.error === 'unallocated' ? 'warning' : 'warning');
                        }
                        return;
                    }

                    if (!confirm(t('oms.dd_confirm', '确认拆分为 {0} 个DD?').replace('{0}', vResult.validCount) +
                        (vResult.soCount > 1 ? ' (' + vResult.soCount + ' SO)' : ''))) return;

                    isSubmitting.value = true;
                    showLoading(true);

                    try {
                        // 委托纯函数构建 payload
                        var payload = buildMultiSOPayload(itemMap, containers, _sourceOrders || []);

                        if (payload.dd_groups.length === 0) {
                            showMessage(t('oms.dd_no_items', '没有分配物料到容器'), 'error');
                            return;
                        }

                        // 单次 API 调用, 所有容器一并提交
                        var result = await apiPost('/oms/dd/split', payload);

                        if (result && result.success) {
                            showMessage('DD ' + t('common.success', '成功') + ': ' + (result.dd_count || payload.dd_groups.length) + ' DD', 'success');
                        } else {
                            showMessage(t('common.failed', '失败') + ': ' + (result && result.message || ''), 'error');
                        }
                        closeBoard();
                        queryOrders(typeof OmsState !== 'undefined' ? OmsState.getPage() : 1);
                    } catch (e) {
                        showMessage(t('common.failed', '操作失败') + ': ' + e.message, 'error');
                    } finally {
                        isSubmitting.value = false;
                        showLoading(false);
                    }
                }

                // ---- Actions: close ----
                function closeBoard() {
                    showBoard.value = false;
                    document.body.style.overflow = _savedOverflow || '';
                    _sourceOrders = null;
                    searchTerm.value = '';
                    dragOverTarget.value = null;
                    _dragSource.value = null;
                }

                // ---- 暴露到 window 供原生 JS 桥接 ----
                window._ddVueApp = {
                    initFromOrder: initFromOrder,
                    initFromOrders: initFromOrders
                };

                // ---- return 给模板 ----
                return {
                    showBoard: showBoard,
                    searchTerm: searchTerm,
                    isSubmitting: isSubmitting,
                    dragOverTarget: dragOverTarget,
                    itemMap: itemMap,
                    containers: containers,
                    poolItems: poolItems,
                    summaryItems: summaryItems,
                    isAllAllocated: isAllAllocated,
                    sourceLabel: sourceLabel,
                    hasCbmData: hasCbmData,
                    hasWeightData: hasWeightData,
                    getRemaining: getRemaining,
                    getMaxAllowed: getMaxAllowed,
                    getContainerItems: getContainerItems,
                    getContainerItemCount: getContainerItemCount,
                    getContainerTotalQty: getContainerTotalQty,
                    getContainerCbm: getContainerCbm,
                    getContainerWeight: getContainerWeight,
                    initFromOrder: initFromOrder,
                    updateQty: updateQty,
                    splitEvenly: splitEvenly,
                    fillRemaining: fillRemaining,
                    addContainer: addContainer,
                    removeContainer: removeContainer,
                    onDragStart: onDragStart,
                    onDragEnd: onDragEnd,
                    onPoolLeave: onPoolLeave,
                    onColLeave: onColLeave,
                    onDropToPool: onDropToPool,
                    onDropToContainer: onDropToContainer,
                    submitDD: submitDD,
                    closeBoard: closeBoard,
                    fmtNum: fmtNum,
                    t: typeof t === 'function' ? t : function(k, d) { return d || k; }
                };
            }
        });
        app.mount(selector);
        _mountedApi = window._ddVueApp || {};
        return _mountedApi;
    }

    return Object.freeze({
        round4: round4,
        checkHasCbmData: checkHasCbmData,
        checkHasWeightData: checkHasWeightData,
        buildSummaryItems: buildSummaryItems,
        buildSourceLabel: buildSourceLabel,
        createKanbanState: createKanbanState,
        validateDDSplit: validateDDSplit,
        parseDocNumInput: parseDocNumInput,
        buildInitItemMap: buildInitItemMap,
        validateMultiSOSubmit: validateMultiSOSubmit,
        buildMultiSOPayload: buildMultiSOPayload,
        fmtNum: fmtNum,
        mountDDBoard: mountDDBoard
    });
})();

var _omsKanbanExport = (typeof OmsKanban !== 'undefined') ? OmsKanban : {};
if (typeof module !== 'undefined' && module.exports) {
    module.exports = _omsKanbanExport;
}
