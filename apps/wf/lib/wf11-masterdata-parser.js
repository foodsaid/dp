/**
 * wf11 主数据解析器
 * 解析 PG UNION ALL 返回的 3 行 JSON (items/warehouses/bins)
 * bins 使用 bins_map 格式: { whs_code: [bin1, bin2, ...] } 压缩体积
 *
 * n8n Code 节点调用示例:
 * ───────────────────────
 * const { parseMasterdata } = require('./lib/wf11-masterdata-parser');
 * const rows = $input.all().map(r => r.json);
 * const result = parseMasterdata(rows);
 * return { json: result };
 * ───────────────────────
 */

/**
 * 解析主数据查询结果
 * @param {Array} rows - PG UNION ALL 结果 (每行含 _type 和 _json 字段)
 * @returns {{ success: boolean, items: Object[], warehouses: Object[], bins_map: Object, counts: Object }}
 */
function parseMasterdata(rows) {
    let items = [];
    let warehouses = [];
    let bins_map = {};
    let binCount = 0;

    if (!rows || !Array.isArray(rows)) {
        return {
            success: true,
            items: items,
            warehouses: warehouses,
            bins_map: bins_map,
            counts: { items: 0, warehouses: 0, bins: 0 }
        };
    }

    for (const row of rows) {
        try {
            if (row._type === 'items') {
                const raw = JSON.parse(row._json || '[]');
                items = raw.map(function (r) { return { item_code: r.c, item_name: r.n, uom: r.u }; });
            } else if (row._type === 'whs') {
                const raw = JSON.parse(row._json || '[]');
                warehouses = raw.map(function (r) { return { whs_code: r.c, whs_name: r.n }; });
            } else if (row._type === 'bins') {
                const raw = JSON.parse(row._json || '[]');
                for (const r of raw) {
                    const whs = r.w || '_';
                    if (!bins_map[whs]) bins_map[whs] = [];
                    bins_map[whs].push(r.c);
                    binCount++;
                }
            }
        } catch (e) {
            // JSON 解析失败，跳过该类型
        }
    }

    return {
        success: true,
        items: items,
        warehouses: warehouses,
        bins_map: bins_map,
        counts: { items: items.length, warehouses: warehouses.length, bins: binCount }
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseMasterdata };
}
