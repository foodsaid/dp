/**
 * wf08 库存 4 维聚合核心算法 (基础版 — 单字段 qty 聚合)
 * 维度: item_code, batch_number, whs_code, bin_code
 * 字段名与 SQL 输出 + 前端 (stock.js) 保持一致
 *
 * ⚠️ 注意: n8n 实际运行的 构建响应 节点使用 S/D 分离版本:
 *   - SQL 返回 _rt='S' (快照) 和 _rt='D' (delta/未过账事务)
 *   - 前端期望: base_qty / delta_qty / real_time_qty 三列
 *   - S/D 分离逻辑在 apps/wf/wf08-stock-query.json 的 构建响应 节点中
 *   - 本文件仅用于单元测试基础聚合逻辑 (不含 S/D 分离)
 */

/**
 * 按 4 维度聚合库存记录 (item_code, batch_number, whs_code, bin_code)
 * @param {Array<{ item_code: string, batch_number?: string, whs_code?: string, bin_code?: string, qty: number|string, [key: string]: * }>} records
 * @returns {Array<{ item_code: string, batch_number: string, whs_code: string, bin_code: string, qty: number, [key: string]: * }>}
 * @throws {Error} records 非数组时抛出
 */
function aggregateStock(records) {
    if (!Array.isArray(records)) {
        throw new Error('Invalid input: records must be an array');
    }

    const stockMap = new Map();

    records.forEach(record => {
        // 1. 提取 4 个维度，容错处理（默认空字符串）
        const item = record.item_code || 'UNKNOWN';
        const batch = record.batch_number || '';
        const wh = record.whs_code || '';
        const loc = record.bin_code || '';
        const qty = parseFloat(record.qty) || 0;

        // 忽略无效的空数量变动
        if (qty === 0) return;

        // 2. 生成绝对唯一的复合键
        const key = `${item}|${batch}|${wh}|${loc}`;

        // 3. 聚合数量 (引入 4 位小数精度防浮点漂移)
        if (stockMap.has(key)) {
            const existing = stockMap.get(key);
            const newQty = existing.qty + qty;
            existing.qty = Math.round(newQty * 10000) / 10000;
        } else {
            stockMap.set(key, {
                item_code: item,
                item_name: record.item_name || '',
                foreign_name: record.foreign_name || '',
                item_group: record.item_group || '',
                uom: record.uom || '',
                batch_number: batch,
                whs_code: wh,
                whs_name: record.whs_name || '',
                bin_code: loc,
                qty: Math.round(qty * 10000) / 10000,
                avg_price: parseFloat(record.avg_price) || 0,
                stock_value: parseFloat(record.stock_value) || 0,
                total_on_hand: parseFloat(record.total_on_hand) || 0,
                committed_qty: parseFloat(record.committed_qty) || 0,
                ordered_qty: parseFloat(record.ordered_qty) || 0,
                snapshot_date: record.snapshot_date || null
            });
        }
    });

    // 4. 清洗数据：过滤掉经过加减后库存恰好为 0 的记录（释放储位）
    return Array.from(stockMap.values()).filter(stock => Math.abs(stock.qty) >= 0.0001);
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { aggregateStock };
}
