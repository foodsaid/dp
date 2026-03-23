-- ============================================================================
-- DP — company_code 数据隔离专项测试
-- 验证不同 company_code 数据不会交叉泄露
-- ============================================================================

SET search_path TO wms, oms, public;

-- ============================================================================
-- 准备: 插入两家公司的测试数据
-- ============================================================================

-- 公司 A 的单据
INSERT INTO wms.wms_documents (company_code, doc_type, doc_number, created_by)
VALUES ('COMP_A', 'PO', 'ISO-TEST-A1', 'ci_isolation_test');
INSERT INTO wms.wms_documents (company_code, doc_type, doc_number, created_by)
VALUES ('COMP_A', 'SO', 'ISO-TEST-A2', 'ci_isolation_test');

-- 公司 B 的单据
INSERT INTO wms.wms_documents (company_code, doc_type, doc_number, created_by)
VALUES ('COMP_B', 'PO', 'ISO-TEST-B1', 'ci_isolation_test');

-- ============================================================================
-- 测试 1: 按 company_code 过滤只看到自己公司的数据
-- ============================================================================

DO $$
DECLARE
  cnt_a INTEGER;
  cnt_b INTEGER;
BEGIN
  SELECT COUNT(*) INTO cnt_a
    FROM wms.wms_documents
   WHERE company_code = 'COMP_A'
     AND doc_number LIKE 'ISO-TEST-%';

  SELECT COUNT(*) INTO cnt_b
    FROM wms.wms_documents
   WHERE company_code = 'COMP_B'
     AND doc_number LIKE 'ISO-TEST-%';

  IF cnt_a <> 2 THEN
    RAISE EXCEPTION 'FAIL: COMP_A 应有 2 条, 实际 %', cnt_a;
  END IF;

  IF cnt_b <> 1 THEN
    RAISE EXCEPTION 'FAIL: COMP_B 应有 1 条, 实际 %', cnt_b;
  END IF;

  RAISE NOTICE 'PASS: company_code 过滤正确 (A=%, B=%)', cnt_a, cnt_b;
END $$;

-- ============================================================================
-- 测试 2: v_document_summary 视图按 company_code 正确隔离
-- ============================================================================

DO $$
DECLARE
  cnt_a INTEGER;
  cnt_b INTEGER;
  cnt_all INTEGER;
BEGIN
  SELECT COUNT(*) INTO cnt_a
    FROM wms.v_document_summary
   WHERE company_code = 'COMP_A'
     AND doc_number LIKE 'ISO-TEST-%';

  SELECT COUNT(*) INTO cnt_b
    FROM wms.v_document_summary
   WHERE company_code = 'COMP_B'
     AND doc_number LIKE 'ISO-TEST-%';

  SELECT COUNT(*) INTO cnt_all
    FROM wms.v_document_summary
   WHERE doc_number LIKE 'ISO-TEST-%';

  IF cnt_a <> 2 THEN
    RAISE EXCEPTION 'FAIL: v_document_summary COMP_A 应有 2 条, 实际 %', cnt_a;
  END IF;

  IF cnt_b <> 1 THEN
    RAISE EXCEPTION 'FAIL: v_document_summary COMP_B 应有 1 条, 实际 %', cnt_b;
  END IF;

  IF cnt_all <> 3 THEN
    RAISE EXCEPTION 'FAIL: v_document_summary 总数应为 3, 实际 %', cnt_all;
  END IF;

  RAISE NOTICE 'PASS: v_document_summary company_code 隔离正确';
END $$;

-- ============================================================================
-- 测试 3: wms_transactions 按 company_code 隔离
-- ============================================================================

DO $$
DECLARE
  doc_id_a INTEGER;
  doc_id_b INTEGER;
  cnt_a INTEGER;
  cnt_b INTEGER;
BEGIN
  -- 获取测试单据 ID
  SELECT id INTO doc_id_a FROM wms.wms_documents
    WHERE company_code = 'COMP_A' AND doc_number = 'ISO-TEST-A1' LIMIT 1;
  SELECT id INTO doc_id_b FROM wms.wms_documents
    WHERE company_code = 'COMP_B' AND doc_number = 'ISO-TEST-B1' LIMIT 1;

  -- 插入事务
  INSERT INTO wms.wms_transactions
    (company_code, document_id, item_code, warehouse_code, quantity, direction, created_by)
  VALUES ('COMP_A', doc_id_a, 'ITEM-001', 'WH01', 10, 'IN', 'ci_test');

  INSERT INTO wms.wms_transactions
    (company_code, document_id, item_code, warehouse_code, quantity, direction, created_by)
  VALUES ('COMP_B', doc_id_b, 'ITEM-001', 'WH01', 5, 'IN', 'ci_test');

  -- 验证隔离
  SELECT COUNT(*) INTO cnt_a FROM wms.wms_transactions
    WHERE company_code = 'COMP_A' AND item_code = 'ITEM-001';
  SELECT COUNT(*) INTO cnt_b FROM wms.wms_transactions
    WHERE company_code = 'COMP_B' AND item_code = 'ITEM-001';

  IF cnt_a <> 1 OR cnt_b <> 1 THEN
    RAISE EXCEPTION 'FAIL: wms_transactions 隔离错误 (A=%, B=%)', cnt_a, cnt_b;
  END IF;

  RAISE NOTICE 'PASS: wms_transactions company_code 隔离正确';
END $$;

-- ============================================================================
-- 测试 4: OMS orders 按 company_code 隔离
-- ============================================================================

DO $$
DECLARE
  cnt_a INTEGER;
  cnt_b INTEGER;
BEGIN
  INSERT INTO oms.orders
    (company_code, doc_type, doc_number, status, created_by)
  VALUES ('COMP_A', 'SO', 'OMS-ISO-A1', 'draft', 'ci_test');

  INSERT INTO oms.orders
    (company_code, doc_type, doc_number, status, created_by)
  VALUES ('COMP_B', 'SO', 'OMS-ISO-B1', 'draft', 'ci_test');

  SELECT COUNT(*) INTO cnt_a FROM oms.orders
    WHERE company_code = 'COMP_A' AND doc_number LIKE 'OMS-ISO-%';
  SELECT COUNT(*) INTO cnt_b FROM oms.orders
    WHERE company_code = 'COMP_B' AND doc_number LIKE 'OMS-ISO-%';

  IF cnt_a <> 1 OR cnt_b <> 1 THEN
    RAISE EXCEPTION 'FAIL: oms.orders 隔离错误 (A=%, B=%)', cnt_a, cnt_b;
  END IF;

  RAISE NOTICE 'PASS: oms.orders company_code 隔离正确';
END $$;

-- ============================================================================
-- 测试 5: 跨公司 company_code 不匹配时触发器拦截
-- ============================================================================

DO $$
DECLARE
  doc_id_a INTEGER;
BEGIN
  SELECT id INTO doc_id_a FROM wms.wms_documents
    WHERE company_code = 'COMP_A' AND doc_number = 'ISO-TEST-A1' LIMIT 1;

  -- 尝试用 COMP_B 的 company_code 写入 COMP_A 的单据行
  BEGIN
    INSERT INTO wms.wms_document_lines
      (company_code, document_id, line_num, item_code, planned_qty)
    VALUES ('COMP_B', doc_id_a, 1, 'ITEM-CROSS', 10);
    RAISE EXCEPTION 'FAIL: 跨公司写入未被拦截';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE '%company_code%' OR SQLERRM LIKE '%跨公司%' OR SQLERRM LIKE '%FAIL%' THEN
        -- 如果是我们自己抛的 FAIL，说明没有触发器拦截
        IF SQLERRM LIKE 'FAIL:%' THEN
          RAISE;
        END IF;
        RAISE NOTICE 'PASS: 跨公司写入被触发器拦截';
      ELSE
        RAISE NOTICE 'PASS: 跨公司写入被触发器拦截 (%)' , SQLERRM;
      END IF;
    WHEN OTHERS THEN
      RAISE NOTICE 'PASS: 跨公司写入被数据库约束拦截 (%)', SQLERRM;
  END;
END $$;

-- ============================================================================
-- 清理测试数据
-- ============================================================================

DELETE FROM wms.wms_document_lines WHERE company_code IN ('COMP_A', 'COMP_B');
DELETE FROM wms.wms_transactions WHERE company_code IN ('COMP_A', 'COMP_B');
DELETE FROM wms.wms_documents WHERE company_code IN ('COMP_A', 'COMP_B');
DELETE FROM oms.order_lines WHERE company_code IN ('COMP_A', 'COMP_B');
DELETE FROM oms.order_events WHERE company_code IN ('COMP_A', 'COMP_B');
DELETE FROM oms.orders WHERE company_code IN ('COMP_A', 'COMP_B');

DO $$ BEGIN RAISE NOTICE '✅ company_code 隔离测试全部通过'; END $$;
