const { buildOmsQuery, parseBatchParams } = require('../../../apps/wf/lib/wf21-query-builder');

describe('wf21-query-builder.js - OMS 查询构建器', () => {

    // ========== buildOmsQuery 基础 ==========

    describe('buildOmsQuery 基础查询', () => {
        test('场景 1: 仅 companyCode → 单条件 WHERE', () => {
            const result = buildOmsQuery({}, 'ACME');
            expect(result._error).toBe(false);
            expect(result.conditions).toHaveLength(1);
            expect(result.conditions[0]).toBe('o.company_code = $1');
            expect(result.params).toEqual(['ACME']);
        });

        test('场景 2: doc_type 筛选', () => {
            const result = buildOmsQuery({ doc_type: 'SO' }, 'ACME');
            expect(result._error).toBe(false);
            expect(result.conditions).toHaveLength(2);
            expect(result.params).toEqual(['ACME', 'SO']);
        });

        test('场景 3: bp_name ILIKE 模糊匹配', () => {
            const result = buildOmsQuery({ bp_name: '食品' }, 'ACME');
            expect(result._error).toBe(false);
            expect(result.params[1]).toBe('%食品%');
        });

        test('场景 4: oms_status 筛选', () => {
            const result = buildOmsQuery({ oms_status: 'pending' }, 'ACME');
            expect(result.params).toContain('pending');
        });

        test('场景 5: 日期范围筛选', () => {
            const result = buildOmsQuery({
                date_from: '2026-01-01',
                date_to: '2026-03-07'
            }, 'ACME');
            expect(result._error).toBe(false);
            expect(result.conditions.length).toBe(3); // company + from + to
            expect(result.params).toContain('2026-01-01');
            expect(result.params).toContain('2026-03-07');
        });
    });

    // ========== 单号搜索 ==========

    describe('buildOmsQuery 单号搜索', () => {
        test('场景 6: 单个单号 → ILIKE 模糊', () => {
            const result = buildOmsQuery({ doc_num: '26000123' }, 'ACME');
            expect(result._error).toBe(false);
            expect(result.params).toContain('%26000123%');
            expect(result.whereClause).toContain('ILIKE');
        });

        test('场景 7: 批量单号 (逗号分隔) → ANY 数组', () => {
            const result = buildOmsQuery({ doc_num: '100,200,300' }, 'ACME');
            expect(result._error).toBe(false);
            expect(result.whereClause).toContain('ANY');
            // params 应包含两个数组 (sap_doc_num + doc_number)
            const arrayParams = result.params.filter(p => Array.isArray(p));
            expect(arrayParams).toHaveLength(2);
            expect(arrayParams[0]).toEqual(['100', '200', '300']);
        });

        test('场景 8: 批量超 50 个 → 拒绝', () => {
            const nums = Array.from({ length: 51 }, (_, i) => String(i + 1)).join(',');
            const result = buildOmsQuery({ doc_num: nums }, 'ACME');
            expect(result._error).toBe(true);
            expect(result.message).toContain('50');
        });

        test('场景 9: 单号含空格 → trim 后正确解析', () => {
            const result = buildOmsQuery({ doc_num: ' 100 , 200 ' }, 'ACME');
            expect(result._error).toBe(false);
            const arrayParams = result.params.filter(p => Array.isArray(p));
            expect(arrayParams[0]).toEqual(['100', '200']);
        });
    });

    // ========== 仓库 + 柜号 ==========

    describe('buildOmsQuery 仓库与柜号', () => {
        test('场景 10: warehouse → 大写化 + EXISTS 子查询', () => {
            const result = buildOmsQuery({ warehouse: 'wh01' }, 'ACME');
            expect(result._error).toBe(false);
            expect(result.params).toContain('WH01');
            expect(result.whereClause).toContain('EXISTS');
        });

        test('场景 11: container_no → 三路搜索 (自身+父单+行溯源)', () => {
            const result = buildOmsQuery({ container_no: 'CONT-A' }, 'ACME');
            expect(result._error).toBe(false);
            expect(result.params).toContain('%CONT-A%');
            expect(result.whereClause).toContain('container_no');
        });
    });

    // ========== 分页 ==========

    describe('buildOmsQuery 分页', () => {
        test('场景 12: 默认分页 page=1, pageSize=20', () => {
            const result = buildOmsQuery({}, 'ACME');
            expect(result.page).toBe(1);
            expect(result.pageSize).toBe(20);
            expect(result.offset).toBe(0);
        });

        test('场景 13: page=3, page_size=10 → offset=20', () => {
            const result = buildOmsQuery({ page: '3', page_size: '10' }, 'ACME');
            expect(result.page).toBe(3);
            expect(result.pageSize).toBe(10);
            expect(result.offset).toBe(20);
        });

        test('场景 14: page_size 上限 100', () => {
            const result = buildOmsQuery({ page_size: '999' }, 'ACME');
            expect(result.pageSize).toBe(100);
        });

        test('场景 15: page_size=0 → falsy 回退默认 20', () => {
            // parseInt('0') = 0, 0 || 20 = 20 (falsy 回退)
            const result = buildOmsQuery({ page_size: '0' }, 'ACME');
            expect(result.pageSize).toBe(20);
        });

        test('场景 15b: page_size=-1 → Math.max 兜底到 1', () => {
            const result = buildOmsQuery({ page_size: '-1' }, 'ACME');
            expect(result.pageSize).toBe(1);
        });

        test('场景 16: 非法 page → 回退 1', () => {
            const result = buildOmsQuery({ page: 'abc' }, 'ACME');
            expect(result.page).toBe(1);
        });
    });

    // ========== 异常输入 ==========

    describe('buildOmsQuery 异常输入', () => {
        test('场景 17: companyCode 为空 → 错误', () => {
            const result = buildOmsQuery({}, '');
            expect(result._error).toBe(true);
            expect(result.message).toContain('DP_COMPANY_CODE');
        });

        test('场景 18: companyCode 为 null → 错误', () => {
            const result = buildOmsQuery({}, null);
            expect(result._error).toBe(true);
        });

        test('场景 19: query 为 null → 安全回退', () => {
            const result = buildOmsQuery(null, 'ACME');
            expect(result._error).toBe(false);
            expect(result.conditions).toHaveLength(1);
        });

        test('场景 20: 复合条件 → 参数索引连续递增', () => {
            const result = buildOmsQuery({
                doc_type: 'SO',
                bp_name: '测试',
                oms_status: 'pending',
                date_from: '2026-01-01'
            }, 'ACME');
            expect(result._error).toBe(false);
            // company=$1, doc_type=$2, bp_name=$3, oms_status=$4, date_from=$5
            expect(result.params).toHaveLength(5);
            expect(result.whereClause).toContain('$5');
        });
    });

    // ========== whereClause 输出 ==========

    describe('buildOmsQuery whereClause', () => {
        test('场景 21: 多条件 AND 连接', () => {
            const result = buildOmsQuery({ doc_type: 'SO', oms_status: 'completed' }, 'ACME');
            expect(result.whereClause).toBe(
                'o.company_code = $1 AND o.doc_type = $2 AND o.oms_status = $3'
            );
        });
    });
});


// ========== parseBatchParams ==========

describe('wf21-query-builder.js - parseBatchParams', () => {

    test('场景 1: 正常批量 ID → 解析为数字数组', () => {
        const result = parseBatchParams({ order_ids: '1,2,3' }, 'ACME');
        expect(result._error).toBe(false);
        expect(result.idsArray).toEqual([1, 2, 3]);
        expect(result.companyCode).toBe('ACME');
    });

    test('场景 2: 含空格 → trim 后正确', () => {
        const result = parseBatchParams({ order_ids: ' 10 , 20 , 30 ' }, 'ACME');
        expect(result.idsArray).toEqual([10, 20, 30]);
    });

    test('场景 3: 含非法值 → 自动过滤', () => {
        const result = parseBatchParams({ order_ids: '1,abc,3,0,-5' }, 'ACME');
        expect(result._error).toBe(false);
        expect(result.idsArray).toEqual([1, 3]);
    });

    test('场景 4: 超 50 个 → 拒绝', () => {
        const ids = Array.from({ length: 51 }, (_, i) => String(i + 1)).join(',');
        const result = parseBatchParams({ order_ids: ids }, 'ACME');
        expect(result._error).toBe(true);
        expect(result.message).toContain('50');
    });

    test('场景 5: 空 order_ids → 错误', () => {
        const result = parseBatchParams({ order_ids: '' }, 'ACME');
        expect(result._error).toBe(true);
        expect(result.message).toContain('Missing');
    });

    test('场景 6: 缺少 order_ids 字段 → 错误', () => {
        const result = parseBatchParams({}, 'ACME');
        expect(result._error).toBe(true);
    });

    test('场景 7: companyCode 为空 → 错误', () => {
        const result = parseBatchParams({ order_ids: '1,2' }, '');
        expect(result._error).toBe(true);
        expect(result.message).toContain('DP_COMPANY_CODE');
    });

    test('场景 8: query 为 null → 错误', () => {
        const result = parseBatchParams(null, 'ACME');
        expect(result._error).toBe(true);
    });

    test('场景 9: 全部非法 ID → Invalid', () => {
        const result = parseBatchParams({ order_ids: 'abc,def' }, 'ACME');
        expect(result._error).toBe(true);
        expect(result.message).toContain('Invalid');
    });

    test('场景 10: 单个 ID → 正常', () => {
        const result = parseBatchParams({ order_ids: '42' }, 'ACME');
        expect(result._error).toBe(false);
        expect(result.idsArray).toEqual([42]);
    });
});
