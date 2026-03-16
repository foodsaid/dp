/**
 * wf21 OMS 查询构建器
 * 纯函数设计：根据查询参数构建参数化 SQL WHERE 子句
 *
 * n8n Code 节点调用示例:
 * ───────────────────────
 * const { buildOmsQuery, parseBatchParams } = require('./lib/wf21-query-builder');
 * const query = $input.first().json.query || {};
 * const result = buildOmsQuery(query, $env.DP_COMPANY_CODE);
 * return { json: result };
 * ───────────────────────
 */

/**
 * 构建 OMS 订单查询的 WHERE 条件和参数
 * @param {Object} query - 查询参数 (doc_type, doc_num, bp_name, oms_status, ...)
 * @param {string} companyCode - 公司代码
 * @returns {{ _error: boolean, conditions?: string[], params?: any[], page?: number, pageSize?: number, offset?: number, message?: string }}
 */
function buildOmsQuery(query, companyCode) {
    if (!companyCode) {
        return { _error: true, message: 'DP_COMPANY_CODE not set' };
    }

    if (!query || typeof query !== 'object') {
        query = {};
    }

    const conditions = ['o.company_code = $1'];
    const params = [companyCode];
    let paramIdx = 2;

    if (query.doc_type) {
        conditions.push('o.doc_type = $' + paramIdx++);
        params.push(query.doc_type);
    }

    if (query.business_partner) {
        conditions.push('o.business_partner ILIKE $' + paramIdx++);
        params.push('%' + query.business_partner + '%');
    }

    if (query.bp_name) {
        conditions.push('o.bp_name ILIKE $' + paramIdx++);
        params.push('%' + query.bp_name + '%');
    }

    if (query.doc_num) {
        const nums = query.doc_num.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        if (nums.length > 50) {
            return { _error: true, message: '批量查询上限 50 个单号' };
        }
        if (nums.length > 1) {
            conditions.push('(o.sap_doc_num = ANY($' + paramIdx + '::text[]) OR o.doc_number = ANY($' + (paramIdx + 1) + '::text[]))');
            params.push(nums, nums);
            paramIdx += 2;
        } else {
            conditions.push('(o.sap_doc_num ILIKE $' + paramIdx + ' OR o.doc_number ILIKE $' + paramIdx + ')');
            params.push('%' + nums[0] + '%');
            paramIdx++;
        }
    }

    if (query.warehouse) {
        conditions.push('EXISTS(SELECT 1 FROM oms.order_lines ol2 WHERE ol2.order_id = o.id AND ol2.warehouse_code = $' + paramIdx + ')');
        params.push(query.warehouse.trim().toUpperCase());
        paramIdx++;
    }

    if (query.container_no) {
        conditions.push('(o.container_no ILIKE $' + paramIdx + ' OR o.id IN (SELECT dd2.parent_id FROM oms.orders dd2 WHERE dd2.container_no ILIKE $' + paramIdx + " AND dd2.doc_type = 'DD') OR o.sap_doc_num IN (SELECT DISTINCT ddl2.source_doc_number FROM oms.order_lines ddl2 JOIN oms.orders dd3 ON ddl2.order_id = dd3.id WHERE dd3.container_no ILIKE $" + paramIdx + " AND dd3.doc_type = 'DD'))");
        params.push('%' + query.container_no.trim() + '%');
        paramIdx++;
    }

    if (query.oms_status) {
        conditions.push('o.oms_status = $' + paramIdx++);
        params.push(query.oms_status);
    }

    if (query.date_from) {
        conditions.push('o.doc_date >= $' + paramIdx++);
        params.push(query.date_from);
    }

    if (query.date_to) {
        conditions.push('o.doc_date <= $' + paramIdx);
        params.push(query.date_to);
    }

    var page = Math.max(1, parseInt(query.page) || 1);
    var pageSize = Math.min(100, Math.max(1, parseInt(query.page_size) || 20));
    var offset = (page - 1) * pageSize;

    return {
        _error: false,
        conditions: conditions,
        params: params,
        page: page,
        pageSize: pageSize,
        offset: offset,
        whereClause: conditions.join(' AND ')
    };
}

/**
 * 解析批量订单查询参数
 * @param {Object} query - 查询参数 (order_ids: "1,2,3")
 * @param {string} companyCode - 公司代码
 * @returns {{ _error: boolean, idsArray?: number[], companyCode?: string, message?: string }}
 */
function parseBatchParams(query, companyCode) {
    if (!companyCode) {
        return { _error: true, message: 'DP_COMPANY_CODE not set' };
    }

    if (!query || typeof query !== 'object') {
        return { _error: true, message: 'Missing order_ids parameter' };
    }

    var orderIdsStr = query.order_ids || '';
    if (!orderIdsStr) {
        return { _error: true, message: 'Missing order_ids parameter' };
    }

    var idsArray = orderIdsStr.split(',')
        .map(function (s) { return s.trim(); })
        .filter(Boolean)
        .map(Number)
        .filter(function (n) { return !isNaN(n) && n > 0; });

    if (!Array.isArray(idsArray) || idsArray.length === 0) {
        return { _error: true, message: 'Invalid order_ids' };
    }

    if (idsArray.length > 50) {
        return { _error: true, message: '批量查询上限 50 个订单' };
    }

    return { _error: false, idsArray: idsArray, companyCode: companyCode };
}

// 导出模块，兼容 Node.js (Jest) 和 n8n 环境
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildOmsQuery, parseBatchParams };
}
