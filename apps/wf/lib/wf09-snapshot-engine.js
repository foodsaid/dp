/**
 * wf09 库存快照核心引擎
 * 纯函数设计：构建快照数据载荷 + 计算前后差异
 *
 * 在 n8n Code 节点中使用示例:
 * ─────────────────────────────
 * const { buildSnapshotPayload, calculateDiff } = require('/data/wf-lib/wf09-snapshot-engine');
 * const rows = $input.all().map(r => r.json);
 * const payload = buildSnapshotPayload(rows);
 * return payload.records.map(r => ({ json: r }));
 * ─────────────────────────────
 *
 * 核心逻辑:
 * - 四元组去重 (item_code|whs_code|bin_code|batch_number)
 * - 空数据检测 (SAP 无变动时跳过)
 * - 前后快照差异计算 (新增/删除/变更)
 */

/**
 * 安全提取数值，非法值回退为 0
 * @param {*} value - 任意值
 * @returns {number}
 */
function safeNum(value) {
    if (value === null || value === undefined) return 0;
    const n = Number(value);
    return isNaN(n) ? 0 : n;
}

/**
 * 安全提取字符串，null/undefined 回退为空字符串
 * @param {*} value - 任意值
 * @returns {string}
 */
function safeStr(value) {
    if (value === null || value === undefined) return '';
    return String(value);
}

/**
 * 生成四元组去重键
 * @param {{ item_code?: string, whs_code?: string, bin_code?: string, batch_number?: string }} record
 * @returns {string} 管道分隔的复合键
 */
function dedupeKey(record) {
    return safeStr(record.item_code) + '|' +
           safeStr(record.whs_code) + '|' +
           safeStr(record.bin_code) + '|' +
           safeStr(record.batch_number);
}

/**
 * 构建快照数据载荷
 * 对 SAP 返回的原始数据进行过滤、去重、标准化
 *
 * @param {Array} currentData - SAP 查询返回的原始库存行
 * @returns {{ records: Array, totalRows: number, skipped: boolean, message: string }}
 */
function buildSnapshotPayload(currentData) {
    if (!Array.isArray(currentData)) {
        throw new Error('Invalid input: currentData must be an array');
    }

    // 过滤无效行 (item_code 为空)
    const filtered = currentData.filter(r =>
        r && r.item_code && String(r.item_code).trim() !== ''
    );

    // 四元组去重 (SAP JOIN 可能产生重复行)
    const seen = new Set();
    const deduped = filtered.filter(r => {
        const key = dedupeKey(r);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    if (deduped.length === 0) {
        return {
            records: [],
            totalRows: 0,
            skipped: true,
            message: 'SAP无库存变动，保留旧快照'
        };
    }

    // 标准化字段
    const records = deduped.map(r => ({
        item_code: safeStr(r.item_code),
        item_name: safeStr(r.item_name),
        foreign_name: safeStr(r.foreign_name),
        item_group: safeStr(r.item_group),
        uom: safeStr(r.uom),
        whs_code: safeStr(r.whs_code),
        whs_name: safeStr(r.whs_name),
        bin_code: safeStr(r.bin_code),
        bin_enabled: safeStr(r.bin_enabled),
        batch_managed: safeStr(r.batch_managed),
        batch_number: safeStr(r.batch_number),
        mfr_batch: safeStr(r.mfr_batch),
        lot_number: safeStr(r.lot_number),
        mfr_date: r.mfr_date || null,
        exp_date: r.exp_date || null,
        in_date: r.in_date || null,
        on_hand: safeNum(r.on_hand),
        bin_qty: safeNum(r.bin_qty),
        batch_qty: safeNum(r.batch_qty),
        bin_max_level: safeNum(r.bin_max_level),
        avg_price: safeNum(r.avg_price),
        stock_value: safeNum(r.stock_value),
        total_on_hand: safeNum(r.total_on_hand),
        committed_qty: safeNum(r.committed_qty),
        ordered_qty: safeNum(r.ordered_qty)
    }));

    return {
        records: records,
        totalRows: records.length,
        skipped: false,
        message: 'SAP ' + records.length + '行 准备写入PG'
    };
}

/**
 * 计算两次快照的差异
 * 用于对比当前快照与上一次快照，找出新增、删除、变更的记录
 *
 * @param {Array} current - 当前快照记录数组
 * @param {Array|null} previous - 上一次快照记录数组 (首次运行时为 null)
 * @returns {{ added: Array, removed: Array, changed: Array, unchanged: number }}
 */
function calculateDiff(current, previous) {
    if (!Array.isArray(current)) {
        throw new Error('Invalid input: current must be an array');
    }

    // 首次快照: previous 为 null/undefined/非数组 → 全部视为新增
    if (!previous || !Array.isArray(previous)) {
        return {
            added: current.slice(),
            removed: [],
            changed: [],
            unchanged: 0
        };
    }

    // 构建 previous Map (key → record)
    const prevMap = new Map();
    previous.forEach(r => {
        if (r) prevMap.set(dedupeKey(r), r);
    });

    // 构建 current Map
    const currMap = new Map();
    current.forEach(r => {
        if (r) currMap.set(dedupeKey(r), r);
    });

    const added = [];
    const changed = [];
    let unchanged = 0;

    // 遍历当前快照
    currMap.forEach((currRec, key) => {
        const prevRec = prevMap.get(key);
        if (!prevRec) {
            added.push(currRec);
        } else {
            // 比较关键数值字段
            const currQty = safeNum(currRec.on_hand);
            const prevQty = safeNum(prevRec.on_hand);
            const currBinQty = safeNum(currRec.bin_qty);
            const prevBinQty = safeNum(prevRec.bin_qty);

            if (currQty !== prevQty || currBinQty !== prevBinQty) {
                changed.push({
                    key: key,
                    current: currRec,
                    previous: prevRec,
                    on_hand_diff: Math.round((currQty - prevQty) * 10000) / 10000,
                    bin_qty_diff: Math.round((currBinQty - prevBinQty) * 10000) / 10000
                });
            } else {
                unchanged++;
            }
        }
    });

    // 在上一次快照中但不在当前快照中的 → 删除
    const removed = [];
    prevMap.forEach((prevRec, key) => {
        if (!currMap.has(key)) {
            removed.push(prevRec);
        }
    });

    return { added, removed, changed, unchanged };
}

// 导出模块，兼容 Node.js (Jest) 和 n8n Code 节点注入
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildSnapshotPayload, calculateDiff, safeNum, safeStr, dedupeKey };
}
