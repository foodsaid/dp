/**
 * wf22 DD 拆单核心数据转换逻辑
 * 纯函数设计：输入前端 payload，输出供 Postgres 节点批量消费的数组
 */

/**
 * 将前端 DD 拆单 payload 转换为 PG 批量插入格式
 * @param {{ source_order_id: number, dd_groups: Array<{ container_no?: string, lines: Object[] }> }} inputJson
 * @returns {Array<{ parent_order_id: number, container_no: string, dd_index: number, total_lines: number, lines_json: string }>}
 * @throws {Error} payload 缺少 source_order_id 或 dd_groups 为空时抛出
 */
function transformDDPayload(inputJson) {
    if (!inputJson || !inputJson.source_order_id) {
        throw new Error('Invalid payload: Missing source_order_id');
    }

    const sourceOrderId = inputJson.source_order_id;
    const groups = inputJson.dd_groups || [];

    if (groups.length === 0) {
        throw new Error('Invalid payload: dd_groups cannot be empty');
    }

    const result = [];

    // 扁平化数据结构，为每个柜子（DD）准备基础数据
    groups.forEach((group, index) => {
        if (!group.lines || group.lines.length === 0) {
            return; // 跳过空柜子
        }

        result.push({
            parent_order_id: sourceOrderId,
            container_no: group.container_no || '',
            dd_index: index + 1, // 拆单序号
            total_lines: group.lines.length,
            // 将行数据转为字符串，方便传入 PostgreSQL 的 jsonb 字段
            lines_json: JSON.stringify(group.lines)
        });
    });

    if (result.length === 0) {
        throw new Error('No valid containers with lines found');
    }

    return result;
}

// 导出模块，兼容 Node.js (Jest) 和 n8n 环境
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { transformDDPayload };
}
