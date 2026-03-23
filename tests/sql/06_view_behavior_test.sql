-- ============================================================================
-- DP v0.1.6 — 视图行为测试: v_stock_realtime 多租户隔离
-- 验证: 不同 company_code 的库存数据绝对不会跨租户累加
-- 在 CI pg-schema-test Job 中执行
-- ============================================================================

SET search_path TO wms, public;

-- ============================================================================
-- 准备测试数据: 两个租户 (TENANT_A / TENANT_B) 拥有同名物料
-- ============================================================================

-- 1) 插入快照数据 (同一物料 ITEM-X 在两个租户各有不同库存)
INSERT INTO wms.wms_stock_snapshot
  (company_code, snapshot_date, item_code, item_name, whs_code, on_hand, bin_qty, batch_qty)
VALUES
  ('TENANT_A', CURRENT_DATE, 'ITEM-X', '测试物料X', 'WH01', 100, 100, 0),
  ('TENANT_B', CURRENT_DATE, 'ITEM-X', '测试物料X', 'WH01', 200, 200, 0);

-- 2) 插入单据 (各租户各一张)
INSERT INTO wms.wms_documents
  (company_code, doc_type, doc_number, created_by)
VALUES
  ('TENANT_A', 'PO', 'VIEW-TEST-A01', 'ci_test'),
  ('TENANT_B', 'PO', 'VIEW-TEST-B01', 'ci_test');

-- 3) 插入未过账事务 (同名物料、同仓库，但不同租户)
INSERT INTO wms.wms_transactions
  (company_code, document_id, action, item_code, warehouse_code, quantity, performed_by, posted_flag)
VALUES
  ('TENANT_A',
    (SELECT id FROM wms.wms_documents WHERE doc_number = 'VIEW-TEST-A01'),
    'receipt', 'ITEM-X', 'WH01', 30, 'ci_test', FALSE),
  ('TENANT_B',
    (SELECT id FROM wms.wms_documents WHERE doc_number = 'VIEW-TEST-B01'),
    'receipt', 'ITEM-X', 'WH01', 50, 'ci_test', FALSE);


-- ============================================================================
-- 测试 V1: TENANT_A 实时库存 = 快照(100) + 入库(30) = 130
-- (不得包含 TENANT_B 的 50)
-- ============================================================================

DO $$
DECLARE
  v_realtime DECIMAL;
  v_in_qty DECIMAL;
  v_out_qty DECIMAL;
BEGIN
  SELECT realtime_qty, today_in_qty, today_out_qty
  INTO v_realtime, v_in_qty, v_out_qty
  FROM wms.v_stock_realtime
  WHERE company_code = 'TENANT_A'
    AND item_code = 'ITEM-X'
    AND whs_code = 'WH01';

  IF v_realtime = 130 AND v_in_qty = 30 AND v_out_qty = 0 THEN
    RAISE NOTICE 'PASS [V1]: TENANT_A 实时库存 = % (快照100 + 入库%), 隔离正确', v_realtime, v_in_qty;
  ELSE
    RAISE EXCEPTION 'FAIL [V1]: TENANT_A 实时库存 = % (期望130), in=% (期望30), out=% (期望0) — 租户隔离泄漏!',
      v_realtime, v_in_qty, v_out_qty;
  END IF;
END $$;


-- ============================================================================
-- 测试 V2: TENANT_B 实时库存 = 快照(200) + 入库(50) = 250
-- (不得包含 TENANT_A 的 30)
-- ============================================================================

DO $$
DECLARE
  v_realtime DECIMAL;
  v_in_qty DECIMAL;
  v_out_qty DECIMAL;
BEGIN
  SELECT realtime_qty, today_in_qty, today_out_qty
  INTO v_realtime, v_in_qty, v_out_qty
  FROM wms.v_stock_realtime
  WHERE company_code = 'TENANT_B'
    AND item_code = 'ITEM-X'
    AND whs_code = 'WH01';

  IF v_realtime = 250 AND v_in_qty = 50 AND v_out_qty = 0 THEN
    RAISE NOTICE 'PASS [V2]: TENANT_B 实时库存 = % (快照200 + 入库%), 隔离正确', v_realtime, v_in_qty;
  ELSE
    RAISE EXCEPTION 'FAIL [V2]: TENANT_B 实时库存 = % (期望250), in=% (期望50), out=% (期望0) — 租户隔离泄漏!',
      v_realtime, v_in_qty, v_out_qty;
  END IF;
END $$;


-- ============================================================================
-- 测试 V3: 两个租户的记录数各自独立 (各 1 条)
-- ============================================================================

DO $$
DECLARE
  v_count_a INT;
  v_count_b INT;
BEGIN
  SELECT COUNT(*) INTO v_count_a
  FROM wms.v_stock_realtime
  WHERE company_code = 'TENANT_A' AND item_code = 'ITEM-X';

  SELECT COUNT(*) INTO v_count_b
  FROM wms.v_stock_realtime
  WHERE company_code = 'TENANT_B' AND item_code = 'ITEM-X';

  IF v_count_a = 1 AND v_count_b = 1 THEN
    RAISE NOTICE 'PASS [V3]: 各租户记录数独立 (A=%, B=%)', v_count_a, v_count_b;
  ELSE
    RAISE EXCEPTION 'FAIL [V3]: 记录数异常 (A=%, B=%) — 期望各1条', v_count_a, v_count_b;
  END IF;
END $$;


-- ============================================================================
-- 测试 V4: 不同快照日期的租户各自取最新 (防止全局 MAX 覆盖)
-- ============================================================================

-- TENANT_A 追加一条昨天的旧快照 (不同物料，确保视图取 CURRENT_DATE)
INSERT INTO wms.wms_stock_snapshot
  (company_code, snapshot_date, item_code, item_name, whs_code, on_hand, bin_qty, batch_qty)
VALUES
  ('TENANT_A', CURRENT_DATE - INTERVAL '1 day', 'ITEM-OLD', '旧物料', 'WH01', 999, 999, 0);

DO $$
DECLARE
  v_old_count INT;
BEGIN
  -- ITEM-OLD 的快照日期是昨天，TENANT_A 最新快照是今天
  -- 所以 ITEM-OLD 不应出现在视图中
  SELECT COUNT(*) INTO v_old_count
  FROM wms.v_stock_realtime
  WHERE company_code = 'TENANT_A' AND item_code = 'ITEM-OLD';

  IF v_old_count = 0 THEN
    RAISE NOTICE 'PASS [V4]: 旧快照日期的物料被正确过滤 (TENANT_A 只取最新日期)';
  ELSE
    RAISE EXCEPTION 'FAIL [V4]: 旧快照物料出现在视图中 (count=%) — 快照日期过滤有误', v_old_count;
  END IF;
END $$;


-- ============================================================================
-- 测试 V5: 租户快照日期不同时各自独立
-- (TENANT_A=今天, 新增 TENANT_C=昨天，两者各取各自最新)
-- ============================================================================

INSERT INTO wms.wms_stock_snapshot
  (company_code, snapshot_date, item_code, item_name, whs_code, on_hand, bin_qty, batch_qty)
VALUES
  ('TENANT_C', CURRENT_DATE - INTERVAL '1 day', 'ITEM-X', '测试物料X', 'WH01', 500, 500, 0);

DO $$
DECLARE
  v_count_c INT;
  v_qty_c DECIMAL;
  v_date_c DATE;
BEGIN
  SELECT COUNT(*), MAX(realtime_qty), MAX(snapshot_date)
  INTO v_count_c, v_qty_c, v_date_c
  FROM wms.v_stock_realtime
  WHERE company_code = 'TENANT_C' AND item_code = 'ITEM-X';

  -- TENANT_C 唯一的快照是昨天，所以应该看到昨天的数据
  IF v_count_c = 1 AND v_qty_c = 500 AND v_date_c = CURRENT_DATE - 1 THEN
    RAISE NOTICE 'PASS [V5]: TENANT_C 取到自己的最新快照 (日期=%, 库存=%), 不受其他租户日期影响', v_date_c, v_qty_c;
  ELSE
    RAISE EXCEPTION 'FAIL [V5]: TENANT_C count=%, qty=% (期望500), date=% (期望昨天) — 跨租户快照日期污染!',
      v_count_c, v_qty_c, v_date_c;
  END IF;
END $$;


-- ============================================================================
-- 清理测试数据
-- ============================================================================

DELETE FROM wms.wms_transactions WHERE performed_by = 'ci_test';
DELETE FROM wms.wms_documents WHERE doc_number IN ('VIEW-TEST-A01', 'VIEW-TEST-B01');
DELETE FROM wms.wms_stock_snapshot WHERE company_code IN ('TENANT_A', 'TENANT_B', 'TENANT_C');

SELECT '✓ 视图行为测试全部通过: 5 项 v_stock_realtime 多租户隔离验证' AS status;
