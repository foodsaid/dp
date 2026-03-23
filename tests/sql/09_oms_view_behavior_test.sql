-- ============================================================================
-- DP v0.1.16 — OMS 视图行为测试: v_order_summary / v_dd_lineage / FK CASCADE
-- 验证: split 状态代偿聚合、递归血缘、除零防护、外键级联删除
-- 执行方式: 两个独立事务 BEGIN → INSERT → DO $$ 断言 → ROLLBACK (零污染)
-- 在 CI pg-schema-test Job 中执行
-- ============================================================================
-- 数据模型假设:
--   oms.orders: id SERIAL PK, parent_id → self-ref, ON DELETE CASCADE on order_lines
--   oms.order_lines: order_id FK → orders(id) ON DELETE CASCADE
--   oms.v_order_summary: GROUP BY o.id, split 状态子查询聚合 DD wms_actual_qty
--   oms.v_dd_lineage: WITH RECURSIVE, depth 列, path INTEGER[] 数组
-- ============================================================================


-- ============================================================================
-- 事务 1: D1–D7 视图行为测试
-- ============================================================================

BEGIN;

SET search_path TO oms, wms, public;

DO $$
DECLARE
  -- 测试数据 ID
  v_pending_so_id INT;
  v_split_so_id INT;
  v_dd1_id INT;
  v_dd2_id INT;
  v_dd_dd_id INT;
  v_zero_so_id INT;
  -- 断言变量
  v_line_count BIGINT;
  v_total_qty DECIMAL;
  v_actual DECIMAL;
  v_pct DECIMAL;
  v_depth INT;
  v_parent INT;
BEGIN

  -- ==========================================================================
  -- 数据准备
  -- ==========================================================================

  -- 1. pending SO (2行: quantity=50+30=80, wms_actual_qty=20+10=30)
  INSERT INTO oms.orders
    (company_code, doc_type, doc_number, sap_doc_entry, sap_doc_num, oms_status)
  VALUES ('VTEST', 'SO', 'VTEST-D-PEND', 89001, 'VTEST-D-PEND', 'pending')
  RETURNING id INTO v_pending_so_id;

  INSERT INTO oms.order_lines (order_id, line_num, item_code, quantity, open_quantity, wms_actual_qty)
  VALUES
    (v_pending_so_id, 1, 'ITEM-D1A', 50, 50, 20),
    (v_pending_so_id, 2, 'ITEM-D1B', 30, 30, 10);

  -- 2. split SO (2行: quantity=100+60=160, wms_actual_qty=0 on parent)
  INSERT INTO oms.orders
    (company_code, doc_type, doc_number, sap_doc_entry, sap_doc_num, oms_status, is_split)
  VALUES ('VTEST', 'SO', 'VTEST-D-SPLIT', 89002, 'VTEST-D-SPLIT', 'split', TRUE)
  RETURNING id INTO v_split_so_id;

  INSERT INTO oms.order_lines (order_id, line_num, item_code, quantity, open_quantity, wms_actual_qty)
  VALUES
    (v_split_so_id, 1, 'ITEM-D2A', 100, 100, 0),
    (v_split_so_id, 2, 'ITEM-D2B', 60, 60, 0);

  -- 3. DD1 under split (1行: wms_actual_qty=40)
  INSERT INTO oms.orders
    (company_code, doc_type, doc_number, parent_id, split_seq, sap_doc_entry, sap_doc_num, oms_status)
  VALUES ('VTEST', 'DD', 'VTEST-DD1', v_split_so_id, 1, 89002, 'VTEST-D-SPLIT', 'in_progress')
  RETURNING id INTO v_dd1_id;

  INSERT INTO oms.order_lines (order_id, line_num, item_code, quantity, open_quantity, wms_actual_qty)
  VALUES (v_dd1_id, 1, 'ITEM-D2A', 50, 50, 40);

  -- 4. DD2 under split (1行: wms_actual_qty=70)
  INSERT INTO oms.orders
    (company_code, doc_type, doc_number, parent_id, split_seq, sap_doc_entry, sap_doc_num, oms_status)
  VALUES ('VTEST', 'DD', 'VTEST-DD2', v_split_so_id, 2, 89002, 'VTEST-D-SPLIT', 'in_progress')
  RETURNING id INTO v_dd2_id;

  INSERT INTO oms.order_lines (order_id, line_num, item_code, quantity, open_quantity, wms_actual_qty)
  VALUES (v_dd2_id, 1, 'ITEM-D2B', 60, 60, 70);

  -- 5. DD→DD under DD2 (三级嵌套, depth=2)
  INSERT INTO oms.orders
    (company_code, doc_type, doc_number, parent_id, split_seq, sap_doc_entry, sap_doc_num, oms_status)
  VALUES ('VTEST', 'DD', 'VTEST-DD2-SUB', v_dd2_id, 1, 89002, 'VTEST-D-SPLIT', 'pending')
  RETURNING id INTO v_dd_dd_id;

  -- 6. 零数量 SO (1行: quantity=0, 测试除零防护)
  INSERT INTO oms.orders
    (company_code, doc_type, doc_number, sap_doc_entry, sap_doc_num, oms_status)
  VALUES ('VTEST', 'SO', 'VTEST-D-ZERO', 89003, 'VTEST-D-ZERO', 'pending')
  RETURNING id INTO v_zero_so_id;

  INSERT INTO oms.order_lines (order_id, line_num, item_code, quantity, open_quantity, wms_actual_qty)
  VALUES (v_zero_so_id, 1, 'ITEM-DZ', 0, 0, 0);


  -- ==========================================================================
  -- D1: v_order_summary 基础聚合 — line_count=2, total_quantity=80
  -- ==========================================================================

  SELECT line_count, total_quantity
  INTO v_line_count, v_total_qty
  FROM oms.v_order_summary
  WHERE id = v_pending_so_id
  LIMIT 1;

  IF v_line_count IS NULL OR v_total_qty IS NULL OR v_line_count <> 2 OR v_total_qty <> 80 THEN
    RAISE EXCEPTION 'FAIL [D1]: line_count=% (期望2), qty=% (期望80)', v_line_count, v_total_qty;
  END IF;
  RAISE NOTICE 'PASS [D1]: v_order_summary 基础聚合 line_count=2, total_quantity=80';


  -- ==========================================================================
  -- D2: split 状态 actual 取子单聚合 — total_actual_qty=40+70=110
  -- ==========================================================================

  SELECT total_actual_qty
  INTO v_actual
  FROM oms.v_order_summary
  WHERE id = v_split_so_id
  LIMIT 1;

  IF v_actual IS NULL OR v_actual <> 110 THEN
    RAISE EXCEPTION 'FAIL [D2]: split actual=% (期望110)', v_actual;
  END IF;
  RAISE NOTICE 'PASS [D2]: split 状态 total_actual_qty=110 (DD 子单聚合 40+70)';


  -- ==========================================================================
  -- D3: 非 split actual 取自身行 — total_actual_qty=20+10=30
  -- ==========================================================================

  SELECT total_actual_qty
  INTO v_actual
  FROM oms.v_order_summary
  WHERE id = v_pending_so_id
  LIMIT 1;

  IF v_actual IS NULL OR v_actual <> 30 THEN
    RAISE EXCEPTION 'FAIL [D3]: pending actual=% (期望30)', v_actual;
  END IF;
  RAISE NOTICE 'PASS [D3]: 非 split total_actual_qty=30 (自身行 20+10)';


  -- ==========================================================================
  -- D4: 除零防护 — quantity=0 时 completion_pct≈0
  -- ==========================================================================

  SELECT completion_pct
  INTO v_pct
  FROM oms.v_order_summary
  WHERE id = v_zero_so_id
  LIMIT 1;

  IF v_pct IS NULL OR ABS(v_pct) > 0.0001 THEN
    RAISE EXCEPTION 'FAIL [D4]: zero qty completion_pct=% (期望≈0)', v_pct;
  END IF;
  RAISE NOTICE 'PASS [D4]: 除零防护 completion_pct≈0 (NULLIF 正确)';


  -- ==========================================================================
  -- D5: v_dd_lineage 根节点 — depth=0
  -- ==========================================================================

  SELECT depth
  INTO v_depth
  FROM oms.v_dd_lineage
  WHERE id = v_split_so_id
  LIMIT 1;

  IF v_depth IS NULL OR v_depth <> 0 THEN
    RAISE EXCEPTION 'FAIL [D5]: root depth=% (期望0)', v_depth;
  END IF;
  RAISE NOTICE 'PASS [D5]: v_dd_lineage 根节点 depth=0';


  -- ==========================================================================
  -- D6: v_dd_lineage DD 子节点 — depth=1, parent_id=父单
  -- ==========================================================================

  SELECT depth, parent_id
  INTO v_depth, v_parent
  FROM oms.v_dd_lineage
  WHERE id = v_dd1_id
  LIMIT 1;

  IF v_depth IS NULL OR v_depth <> 1 OR v_parent IS NULL OR v_parent <> v_split_so_id THEN
    RAISE EXCEPTION 'FAIL [D6]: DD depth=% (期望1), parent=% (期望%)', v_depth, v_parent, v_split_so_id;
  END IF;
  RAISE NOTICE 'PASS [D6]: DD depth=1, parent_id=% 正确', v_split_so_id;


  -- ==========================================================================
  -- D7: v_dd_lineage 三级嵌套 — DD→DD depth=2
  -- ==========================================================================

  SELECT depth
  INTO v_depth
  FROM oms.v_dd_lineage
  WHERE id = v_dd_dd_id
  LIMIT 1;

  IF v_depth IS NULL OR v_depth <> 2 THEN
    RAISE EXCEPTION 'FAIL [D7]: DD→DD depth=% (期望2)', v_depth;
  END IF;
  RAISE NOTICE 'PASS [D7]: DD→DD 三级嵌套 depth=2';

END $$;

ROLLBACK;


-- ============================================================================
-- 事务 2: D8 FK CASCADE 删除测试 (独立事务, 不受事务 1 影响)
-- ============================================================================

BEGIN;

SET search_path TO oms, public;

DO $$
DECLARE
  v_order_id INT;
  v_before INT;
  v_after INT;
BEGIN

  -- 创建测试父单
  INSERT INTO oms.orders
    (company_code, doc_type, doc_number, sap_doc_entry, sap_doc_num, oms_status)
  VALUES ('VTEST', 'SO', 'VTEST-D8-CASCADE', 89099, 'VTEST-D8-CASCADE', 'pending')
  RETURNING id INTO v_order_id;

  -- 创建 2 行明细
  INSERT INTO oms.order_lines (order_id, line_num, item_code, quantity)
  VALUES
    (v_order_id, 1, 'ITEM-D8A', 10),
    (v_order_id, 2, 'ITEM-D8B', 20);

  -- 验证删除前 lines 存在
  SELECT count(*) INTO v_before
  FROM oms.order_lines
  WHERE order_id = v_order_id;

  IF v_before <> 2 THEN
    RAISE EXCEPTION 'FAIL [D8 setup]: 删除前 lines=% (期望2)', v_before;
  END IF;

  -- 删除父单 → 触发 ON DELETE CASCADE
  DELETE FROM oms.orders WHERE id = v_order_id;

  -- 验证 cascade 后 lines 已清空
  SELECT count(*) INTO v_after
  FROM oms.order_lines
  WHERE order_id = v_order_id;

  IF v_after <> 0 THEN
    RAISE EXCEPTION 'FAIL [D8]: cascade 后 lines=% (期望0)', v_after;
  END IF;

  RAISE NOTICE 'PASS [D8]: FK ON DELETE CASCADE 正确 (lines 2→0)';

END $$;

ROLLBACK;


-- ============================================================================
-- 收尾
-- ============================================================================

SELECT '✓ OMS 视图行为测试全部通过: 8 项 (v_order_summary ×4 + v_dd_lineage ×3 + FK CASCADE ×1)' AS status;
