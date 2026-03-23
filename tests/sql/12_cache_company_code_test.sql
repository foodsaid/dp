-- ============================================================================
-- DP v0.5 — 缓存表 company_code 隔离测试
-- 验证: 复合 PK、不同公司同 code 共存、触发器拦截、脏数据监控
-- ============================================================================

-- 准备测试数据
\echo '>>> 测试 12: 缓存表 company_code 隔离'

-- ----------------------------------------------------------------------------
-- 1. wms_items_cache: 复合 PK 允许不同公司使用相同 item_code
-- ----------------------------------------------------------------------------
INSERT INTO wms.wms_items_cache (company_code, item_code, item_name, uom, man_batch_num)
VALUES ('COMP_A', 'ITEM-001', '物料A', 'PCS', 'N');

INSERT INTO wms.wms_items_cache (company_code, item_code, item_name, uom, man_batch_num)
VALUES ('COMP_B', 'ITEM-001', '物料B', 'KG', 'Y');

-- 验证: 两条记录都存在
DO $$
DECLARE cnt INT;
BEGIN
    SELECT COUNT(*) INTO cnt FROM wms.wms_items_cache WHERE item_code = 'ITEM-001';
    IF cnt <> 2 THEN
        RAISE EXCEPTION '❌ wms_items_cache: 期望 2 条记录 (不同公司同 item_code)，实际 %', cnt;
    END IF;
    RAISE NOTICE '✅ wms_items_cache: 不同公司同 item_code 共存';
END $$;

-- 验证: 同公司同 item_code 冲突
DO $$
BEGIN
    INSERT INTO wms.wms_items_cache (company_code, item_code, item_name, uom, man_batch_num)
    VALUES ('COMP_A', 'ITEM-001', '重复', 'PCS', 'N')
    ON CONFLICT (company_code, item_code) DO UPDATE SET item_name = 'UPSERT更新';

    IF (SELECT item_name FROM wms.wms_items_cache WHERE company_code = 'COMP_A' AND item_code = 'ITEM-001') <> 'UPSERT更新' THEN
        RAISE EXCEPTION '❌ wms_items_cache: UPSERT 未生效';
    END IF;
    RAISE NOTICE '✅ wms_items_cache: 复合 PK UPSERT 正常';
END $$;

-- 验证: 公司过滤隔离
DO $$
DECLARE cnt INT;
BEGIN
    SELECT COUNT(*) INTO cnt FROM wms.wms_items_cache WHERE company_code = 'COMP_A';
    IF cnt <> 1 THEN
        RAISE EXCEPTION '❌ wms_items_cache: COMP_A 应有 1 条，实际 %', cnt;
    END IF;
    RAISE NOTICE '✅ wms_items_cache: company_code 过滤隔离正确';
END $$;

-- ----------------------------------------------------------------------------
-- 2. wms_locations_cache: 同上模式
-- ----------------------------------------------------------------------------
INSERT INTO wms.wms_locations_cache (company_code, whs_code, whs_name)
VALUES ('COMP_A', 'WH01', '主仓A');

INSERT INTO wms.wms_locations_cache (company_code, whs_code, whs_name)
VALUES ('COMP_B', 'WH01', '主仓B');

DO $$
DECLARE cnt INT;
BEGIN
    SELECT COUNT(*) INTO cnt FROM wms.wms_locations_cache WHERE whs_code = 'WH01';
    IF cnt <> 2 THEN
        RAISE EXCEPTION '❌ wms_locations_cache: 期望 2 条，实际 %', cnt;
    END IF;
    RAISE NOTICE '✅ wms_locations_cache: 不同公司同 whs_code 共存';
END $$;

-- ----------------------------------------------------------------------------
-- 3. wms_bins_cache: 同上模式
-- ----------------------------------------------------------------------------
INSERT INTO wms.wms_bins_cache (company_code, bin_code, bin_name, whs_code, whs_name, max_level)
VALUES ('COMP_A', 'BIN-001', '库位1', 'WH01', '主仓', 5);

INSERT INTO wms.wms_bins_cache (company_code, bin_code, bin_name, whs_code, whs_name, max_level)
VALUES ('COMP_B', 'BIN-001', '库位1B', 'WH01', '主仓B', 3);

DO $$
DECLARE cnt INT;
BEGIN
    SELECT COUNT(*) INTO cnt FROM wms.wms_bins_cache WHERE bin_code = 'BIN-001';
    IF cnt <> 2 THEN
        RAISE EXCEPTION '❌ wms_bins_cache: 期望 2 条，实际 %', cnt;
    END IF;
    RAISE NOTICE '✅ wms_bins_cache: 不同公司同 bin_code 共存';
END $$;

-- ----------------------------------------------------------------------------
-- 4. 触发器拦截: 空 company_code
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    INSERT INTO wms.wms_items_cache (company_code, item_code, item_name, uom, man_batch_num)
    VALUES ('', 'ITEM-BAD', '不应存在', 'PCS', 'N');
    RAISE EXCEPTION '❌ 空 company_code 未被拦截';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM LIKE '%company_code%' THEN
            RAISE NOTICE '✅ wms_items_cache: 空 company_code 被触发器/约束拦截';
        ELSE
            RAISE EXCEPTION '❌ 异常消息不匹配: %', SQLERRM;
        END IF;
END $$;

DO $$
BEGIN
    INSERT INTO wms.wms_locations_cache (company_code, whs_code, whs_name)
    VALUES ('   ', 'WH-BAD', '不应存在');
    RAISE EXCEPTION '❌ 空白 company_code 未被拦截';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM LIKE '%company_code%' THEN
            RAISE NOTICE '✅ wms_locations_cache: 空白 company_code 被拦截';
        ELSE
            RAISE EXCEPTION '❌ 异常消息不匹配: %', SQLERRM;
        END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. 脏数据监控查询 (期望全部为 0)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    items_null INT;
    locs_null INT;
    bins_null INT;
BEGIN
    SELECT COUNT(*) INTO items_null FROM wms.wms_items_cache WHERE company_code IS NULL;
    SELECT COUNT(*) INTO locs_null FROM wms.wms_locations_cache WHERE company_code IS NULL;
    SELECT COUNT(*) INTO bins_null FROM wms.wms_bins_cache WHERE company_code IS NULL;

    IF items_null > 0 OR locs_null > 0 OR bins_null > 0 THEN
        RAISE EXCEPTION '❌ 脏数据: items_null=%, locs_null=%, bins_null=%', items_null, locs_null, bins_null;
    END IF;
    RAISE NOTICE '✅ 脏数据监控: 全部 company_code 非空';
END $$;

-- 清理测试数据
DELETE FROM wms.wms_items_cache WHERE company_code IN ('COMP_A', 'COMP_B');
DELETE FROM wms.wms_locations_cache WHERE company_code IN ('COMP_A', 'COMP_B');
DELETE FROM wms.wms_bins_cache WHERE company_code IN ('COMP_A', 'COMP_B');

\echo '>>> 测试 12: 全部通过 ✅'
