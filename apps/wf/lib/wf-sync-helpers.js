/**
 * 缓存同步共享工具 (wf06 物料 / wf07 仓库 / wf10 库位)
 * 从 n8n Code 节点提取的纯函数，可单测
 */

/**
 * 转义字符串用于 SQL VALUES 拼接
 * - null/undefined → 空字符串
 * - 截断至 maxLen 字符
 * - 移除 null bytes (\u0000)
 * - 转义反斜杠和单引号
 * @param {*} v - 待转义值
 * @param {number} [maxLen=500] - 最大长度
 * @returns {string}
 */
function escapeValue(v, maxLen) {
    if (v === null || v === undefined) return '';
    var s = String(v).substring(0, maxLen || 500);
    // eslint-disable-next-line no-control-regex
    s = s.replace(/\u0000/g, '');
    return s.replace(/\\/g, '\\\\').replace(/'/g, "''");
}

/**
 * 安全数值转换 (非数值返回 0)
 * @param {*} v
 * @returns {number}
 */
function safeNum(v) {
    return Number(v) || 0;
}

/**
 * 解析并格式化同步锚点日期
 * - 无日期时使用当前时间减 1 小时
 * - 严格 SQL 注入防护: 正则校验格式
 * @param {string|null} lastSync - 上次同步时间
 * @returns {string} 格式化后的日期字符串 (YYYY-MM-DD HH:MM:SS)
 * @throws {Error} 日期格式异常
 */
function formatSyncAnchor(lastSync) {
    var anchorDate = lastSync;
    if (!anchorDate) {
        var fallback = new Date();
        fallback.setHours(fallback.getHours() - 1);
        anchorDate = fallback.toISOString();
    }
    var d = new Date(anchorDate);
    if (isNaN(d.getTime())) {
        throw new Error('无效日期: ' + String(anchorDate).substring(0, 30));
    }
    var pad = function(n) { return n < 10 ? '0' + n : n; };
    var formatted = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    // 安全: 严格日期格式校验 (防 SQL 注入)
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(formatted)) {
        throw new Error('日期格式异常: ' + formatted);
    }
    return formatted;
}

/**
 * 构建增量查询锚点 (wf10 使用，截取前 19 字符)
 * @param {string|null} lastSync - 上次同步时间
 * @returns {string} 截取后的锚点字符串
 * @throws {Error} 格式不匹配 YYYY-MM-DD 前缀
 */
function buildSyncAnchor(lastSync) {
    var syncDate = String(lastSync || '2000-01-01').substring(0, 19);
    if (!/^\d{4}-\d{2}-\d{2}/.test(syncDate)) {
        throw new Error('增量锚点格式异常: ' + syncDate.substring(0, 30));
    }
    return syncDate;
}

/**
 * 生成物料批量 UPSERT SQL (wf06)
 * @param {Array} items - SAP 物料数据 [{ ItemCode, ItemName, InvntryUom, ManBtchNum }]
 * @param {number} [batchSize=200] - 每批大小
 * @returns {Array} [{ sql, batch_num, count }]
 */
function buildItemsUpsertBatches(items, batchSize) {
    batchSize = batchSize || 200;
    var batches = [];
    for (var i = 0; i < items.length; i += batchSize) {
        var batch = items.slice(i, i + batchSize);
        var values = batch.map(function(j) {
            return "('" + escapeValue(j.ItemCode) + "','" + escapeValue(j.ItemName) +
                "','" + escapeValue(j.InvntryUom) + "','" + (escapeValue(j.ManBtchNum) || 'N') + "',NOW())";
        }).join(',\n');
        var sql = 'INSERT INTO wms.wms_items_cache (item_code, item_name, uom, man_batch_num, synced_at) VALUES ' +
            values + ' ON CONFLICT (item_code) DO UPDATE SET item_name=EXCLUDED.item_name, uom=EXCLUDED.uom, man_batch_num=EXCLUDED.man_batch_num, synced_at=NOW()';
        batches.push({ sql: sql, batch_num: Math.floor(i / batchSize) + 1, count: batch.length });
    }
    if (batches.length === 0) return [{ sql: 'SELECT 1', batch_num: 0, count: 0 }];
    return batches;
}

/**
 * 生成仓库 UPSERT SQL (wf07)
 * @param {Array} items - SAP 仓库数据 [{ WhsCode, WhsName }]
 * @returns {{ sql: string, count: number }}
 */
function buildLocationsUpsert(items) {
    if (!items || items.length === 0) return { sql: 'SELECT 1', count: 0 };
    var values = items.map(function(j) {
        return "('" + escapeValue(j.WhsCode) + "','" + escapeValue(j.WhsName) + "',NOW())";
    }).join(',\n');
    var sql = 'INSERT INTO wms.wms_locations_cache (whs_code, whs_name, synced_at) VALUES ' +
        values + ' ON CONFLICT (whs_code) DO UPDATE SET whs_name=EXCLUDED.whs_name, synced_at=NOW()';
    return { sql: sql, count: items.length };
}

/**
 * 生成库位批量 UPSERT SQL (wf10)
 * @param {Array} items - SAP 库位数据 [{ bin_code, whs_code, whs_name, bin_name, max_level }]
 * @param {number} [batchSize=200] - 每批大小
 * @returns {Array} [{ sql, batch_num, count }]
 */
function buildBinsUpsertBatches(items, batchSize) {
    batchSize = batchSize || 200;
    var batches = [];
    for (var i = 0; i < items.length; i += batchSize) {
        var batch = items.slice(i, i + batchSize);
        var values = batch.map(function(j) {
            return "('" + escapeValue(j.bin_code) + "','" + escapeValue(j.whs_code) +
                "','" + escapeValue(j.whs_name) + "','" + escapeValue(j.bin_name) +
                "'," + safeNum(j.max_level) + ",NOW())";
        }).join(',\n');
        var sql = 'INSERT INTO wms.wms_bins_cache (bin_code, whs_code, whs_name, bin_name, max_level, synced_at) VALUES ' +
            values + ' ON CONFLICT (bin_code) DO UPDATE SET whs_code=EXCLUDED.whs_code, whs_name=EXCLUDED.whs_name, bin_name=EXCLUDED.bin_name, max_level=EXCLUDED.max_level, synced_at=NOW()';
        batches.push({ sql: sql, batch_num: Math.floor(i / batchSize) + 1, count: batch.length });
    }
    if (batches.length === 0) return [{ sql: 'SELECT 1', batch_num: 0, count: 0 }];
    return batches;
}

/**
 * 统计批次总行数
 * @param {Array} batches - [{ count }]
 * @returns {number}
 */
function countBatchTotal(batches) {
    var total = 0;
    for (var i = 0; i < batches.length; i++) {
        total += (batches[i].count || 0);
    }
    return total;
}

module.exports = {
    escapeValue: escapeValue,
    safeNum: safeNum,
    formatSyncAnchor: formatSyncAnchor,
    buildSyncAnchor: buildSyncAnchor,
    buildItemsUpsertBatches: buildItemsUpsertBatches,
    buildLocationsUpsert: buildLocationsUpsert,
    buildBinsUpsertBatches: buildBinsUpsertBatches,
    countBatchTotal: countBatchTotal
};
