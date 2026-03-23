/**
 * wf02 事务合法性校验引擎
 * 纯函数设计：校验事务载荷的完整性与合规性
 *
 * n8n Code 节点调用示例:
 * ───────────────────────
 * const { validateTransaction } = require('./lib/wf02-tx-validator');
 * const result = validateTransaction($input.first().json);
 * return [{ json: result }];
 * ───────────────────────
 */

// 合法事务类型与方向映射
const TX_TYPES = {
    SO_PICK:    'OUTBOUND',   // 销售拣货
    WO_RECEIVE: 'INBOUND',    // 生产收货
    PO_RECEIVE: 'INBOUND',    // 采购收货
    TR_OUT:     'OUTBOUND',   // 调拨出库
    TR_IN:      'INBOUND',    // 调拨入库
    IC_COUNT:   'NEUTRAL',    // 盘点（无方向）
    LM_MOVE:    'INTERNAL',   // 库位移动（内部）
    PI_ISSUE:   'OUTBOUND',   // 生产领料
    DD_PICK:    'OUTBOUND'    // DD 拆单拣货
};

/**
 * 校验事务载荷
 * @param {Object} txPayload - 事务载荷
 * @param {string} txPayload.tx_type - 事务类型
 * @param {number} txPayload.qty - 操作数量
 * @param {string} [txPayload.from_location] - 源储位
 * @param {string} [txPayload.to_location] - 目标储位
 * @returns {{ valid: true, direction: string }} 校验通过结果
 * @throws {Error} 校验失败时抛出具体原因
 */
function validateTransaction(txPayload) {
    // 1. 载荷基础校验
    if (!txPayload || typeof txPayload !== 'object') {
        throw new Error('无效载荷: txPayload 不能为空且必须为对象');
    }

    // 2. 事务类型校验
    const txType = txPayload.tx_type;
    if (!txType || typeof txType !== 'string') {
        throw new Error('无效载荷: tx_type 为必填字段');
    }

    const direction = TX_TYPES[txType];
    if (!direction) {
        throw new Error(`非法事务类型: ${txType}`);
    }

    // 3. 数量校验 (qty 必须为正数)
    const qty = txPayload.qty;
    if (qty === undefined || qty === null || typeof qty !== 'number' || isNaN(qty)) {
        throw new Error('无效数量: qty 必须为数字');
    }
    if (qty <= 0) {
        throw new Error(`数量不合法: qty=${qty}，必须大于 0`);
    }

    // 4. 方向性储位校验
    if (direction === 'INBOUND' && !txPayload.to_location) {
        throw new Error(`入库事务 (${txType}) 必须提供目标储位 to_location`);
    }

    if (direction === 'OUTBOUND' && !txPayload.from_location) {
        throw new Error(`出库事务 (${txType}) 必须提供源储位 from_location`);
    }

    // 5. 校验通过
    return { valid: true, direction };
}

// 导出模块，兼容 Node.js (Jest) 和 n8n 环境
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validateTransaction, TX_TYPES };
}
