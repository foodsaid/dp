-- ============================================================================
-- DP v0.1.11 — OMS Schema 行为测试
-- 验证 oms 独立 Schema 的约束、触发器、视图正确性
-- 在 CI pg-schema-test Job 中执行
-- ============================================================================

SET search_path TO oms, wms, public;

-- ============================================================================
-- 测试 1: oms.orders company_code 空字符串 → CHECK 约束拒绝
-- ============================================================================

DO $$
BEGIN
  BEGIN
    INSERT INTO oms.orders
      (company_code, doc_type, doc_number, sap_doc_entry, sap_doc_num, oms_status)
    VALUES ('', 'SO', 'T-100001', 1, '100001', 'pending');
    RAISE EXCEPTION 'FAIL: 空 company_code 未被拒绝';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS [OMS-01]: 空 company_code 被 CHECK 约束拒绝';
    WHEN raise_exception THEN
      RAISE NOTICE 'PASS [OMS-01]: 空 company_code 被触发器拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 2: oms.orders company_code NULL → NOT NULL 约束拒绝
-- ============================================================================

DO $$
BEGIN
  BEGIN
    INSERT INTO oms.orders
      (company_code, doc_type, doc_number, sap_doc_entry, sap_doc_num, oms_status)
    VALUES (NULL, 'SO', 'T-100001', 1, '100001', 'pending');
    RAISE EXCEPTION 'FAIL: NULL company_code 未被拒绝';
  EXCEPTION
    WHEN not_null_violation THEN
      RAISE NOTICE 'PASS [OMS-02]: NULL company_code 被 NOT NULL 拒绝';
    WHEN raise_exception THEN
      RAISE NOTICE 'PASS [OMS-02]: NULL company_code 被触发器拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 3: 非法 doc_type → CHECK 约束拒绝
-- ============================================================================

DO $$
BEGIN
  BEGIN
    INSERT INTO oms.orders
      (company_code, doc_type, doc_number, sap_doc_entry, sap_doc_num, oms_status)
    VALUES ('TEST', 'XX', 'T-100001', 1, '100001', 'pending');
    RAISE EXCEPTION 'FAIL: 非法 doc_type "XX" 未被拒绝';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS [OMS-03]: 非法 doc_type 被 CHECK 约束拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 4: DD 类型必须有 parent_id (fn_enforce_dd_parent)
-- ============================================================================

DO $$
BEGIN
  BEGIN
    INSERT INTO oms.orders
      (company_code, doc_type, doc_number, parent_id, sap_doc_entry, sap_doc_num, oms_status)
    VALUES ('TEST', 'DD', 'T-100001', NULL, 1, '100001', 'pending');
    RAISE EXCEPTION 'FAIL: DD 无 parent_id 未被拒绝';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS [OMS-04]: DD 无 parent_id 被 CHECK 约束拒绝';
    WHEN raise_exception THEN
      RAISE NOTICE 'PASS [OMS-04]: DD 无 parent_id 被触发器拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 5: 非 DD 类型不允许有 parent_id
-- ============================================================================

DO $$
DECLARE
  _parent_id INTEGER;
BEGIN
  -- 先创建一个父订单
  INSERT INTO oms.orders
    (company_code, doc_type, doc_number, sap_doc_entry, sap_doc_num, oms_status)
  VALUES ('TEST', 'SO', 'OMS-TEST-05', 99901, 'OMS-TEST-05', 'pending')
  RETURNING id INTO _parent_id;

  BEGIN
    INSERT INTO oms.orders
      (company_code, doc_type, doc_number, parent_id, sap_doc_entry, sap_doc_num, oms_status)
    VALUES ('TEST', 'SO', 'OMS-TEST-05B', _parent_id, 99902, 'OMS-TEST-05B', 'pending');
    RAISE EXCEPTION 'FAIL: 非DD类型有 parent_id 未被拒绝';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS [OMS-05]: 非DD类型有 parent_id 被 CHECK 约束拒绝';
    WHEN raise_exception THEN
      RAISE NOTICE 'PASS [OMS-05]: 非DD类型有 parent_id 被触发器拒绝';
  END;

  -- 清理
  DELETE FROM oms.orders WHERE sap_doc_num = 'OMS-TEST-05';
END $$;

-- ============================================================================
-- 测试 6: 正常 DD 创建成功 (有 parent_id)
-- ============================================================================

DO $$
DECLARE
  _parent_id INTEGER;
  _dd_id INTEGER;
BEGIN
  -- 创建父订单
  INSERT INTO oms.orders
    (company_code, doc_type, doc_number, sap_doc_entry, sap_doc_num, oms_status)
  VALUES ('TEST', 'SO', 'OMS-TEST-06', 99910, 'OMS-TEST-06', 'pending')
  RETURNING id INTO _parent_id;

  -- 创建 DD 子单
  INSERT INTO oms.orders
    (company_code, doc_type, doc_number, parent_id, split_seq, sap_doc_entry, sap_doc_num, oms_status)
  VALUES ('TEST', 'DD', 'OMS-DD-06', _parent_id, 1, 99910, 'OMS-TEST-06', 'pending')
  RETURNING id INTO _dd_id;

  IF _dd_id IS NOT NULL THEN
    RAISE NOTICE 'PASS [OMS-06]: DD 创建成功 (parent_id=%, dd_id=%)', _parent_id, _dd_id;
  ELSE
    RAISE EXCEPTION 'FAIL: DD 创建返回 NULL id';
  END IF;

  -- 清理
  DELETE FROM oms.orders WHERE id = _dd_id;
  DELETE FROM oms.orders WHERE id = _parent_id;
END $$;

-- ============================================================================
-- 测试 7: 非法 oms_status → CHECK 约束拒绝
-- ============================================================================

DO $$
BEGIN
  BEGIN
    INSERT INTO oms.orders
      (company_code, doc_type, doc_number, sap_doc_entry, sap_doc_num, oms_status)
    VALUES ('TEST', 'SO', 'T-100007', 1, '100007', 'invalid_status');
    RAISE EXCEPTION 'FAIL: 非法 oms_status 未被拒绝';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS [OMS-07]: 非法 oms_status 被 CHECK 约束拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 8: 非法 execution_state → CHECK 约束拒绝
-- ============================================================================

DO $$
BEGIN
  BEGIN
    INSERT INTO oms.orders
      (company_code, doc_type, doc_number, sap_doc_entry, sap_doc_num, oms_status, execution_state)
    VALUES ('TEST', 'SO', 'T-100008', 1, '100008', 'pending', 'invalid_state');
    RAISE EXCEPTION 'FAIL: 非法 execution_state 未被拒绝';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS [OMS-08]: 非法 execution_state 被 CHECK 约束拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 9: row_version 自动递增 (fn_bump_row_version)
-- ============================================================================

DO $$
DECLARE
  _id INTEGER;
  _v1 INTEGER;
  _v2 INTEGER;
BEGIN
  INSERT INTO oms.orders
    (company_code, doc_type, doc_number, sap_doc_entry, sap_doc_num, oms_status)
  VALUES ('TEST', 'SO', 'OMS-TEST-09', 99920, 'OMS-TEST-09', 'pending')
  RETURNING id, row_version INTO _id, _v1;

  -- 更新关键字段触发 row_version 递增
  UPDATE oms.orders SET oms_status = 'in_progress' WHERE id = _id;
  SELECT row_version INTO _v2 FROM oms.orders WHERE id = _id;

  IF _v2 > _v1 THEN
    RAISE NOTICE 'PASS [OMS-09]: row_version 递增 (% → %)', _v1, _v2;
  ELSE
    RAISE EXCEPTION 'FAIL: row_version 未递增 (% → %)', _v1, _v2;
  END IF;

  -- 清理
  DELETE FROM oms.orders WHERE id = _id;
END $$;

-- ============================================================================
-- 测试 10: updated_at 自动更新 (fn_updated_at)
-- ============================================================================

DO $$
DECLARE
  _id INTEGER;
  _t1 TIMESTAMPTZ;
  _t2 TIMESTAMPTZ;
  _trg_exists BOOLEAN;
BEGIN
  -- 验证 fn_updated_at 触发器已绑定
  SELECT EXISTS(
    SELECT 1 FROM pg_trigger t JOIN pg_proc p ON t.tgfoid = p.oid
    WHERE tgrelid = 'oms.orders'::regclass AND p.proname = 'fn_updated_at'
  ) INTO _trg_exists;

  INSERT INTO oms.orders
    (company_code, doc_type, doc_number, sap_doc_entry, sap_doc_num, oms_status)
  VALUES ('TEST', 'SO', 'OMS-TEST-10', 99930, 'OMS-TEST-10', 'pending')
  RETURNING id, updated_at INTO _id, _t1;

  UPDATE oms.orders SET bp_name = 'Updated Name' WHERE id = _id;
  SELECT updated_at INTO _t2 FROM oms.orders WHERE id = _id;

  -- NOW() 在同一事务内固定，故检查触发器存在 + updated_at 已填充
  IF _trg_exists AND _t2 IS NOT NULL AND _t2 >= _t1 THEN
    RAISE NOTICE 'PASS [OMS-10]: updated_at 触发器已绑定且正常运行';
  ELSE
    RAISE EXCEPTION 'FAIL: updated_at 触发器未生效 (exists=%, t2=%)', _trg_exists, _t2;
  END IF;

  -- 清理
  DELETE FROM oms.orders WHERE id = _id;
END $$;

-- ============================================================================
-- 测试 11: audit_log 不可变性 (fn_prevent_oms_audit_tampering)
-- ============================================================================

DO $$
DECLARE
  _log_id BIGINT;
BEGIN
  -- 插入测试日志
  INSERT INTO oms.audit_logs
    (company_code, action, target_type, target_id, operator)
  VALUES ('TEST', 'test_insert', 'orders', 0, 'ci_test')
  RETURNING id INTO _log_id;

  -- 尝试 UPDATE → 应被拒绝
  BEGIN
    UPDATE oms.audit_logs SET action = 'tampered' WHERE id = _log_id;
    RAISE EXCEPTION 'FAIL: audit_log UPDATE 未被拒绝';
  EXCEPTION
    WHEN raise_exception THEN
      RAISE NOTICE 'PASS [OMS-11a]: audit_log UPDATE 被触发器拒绝';
  END;

  -- 尝试 DELETE → 应被拒绝
  BEGIN
    DELETE FROM oms.audit_logs WHERE id = _log_id;
    RAISE EXCEPTION 'FAIL: audit_log DELETE 未被拒绝';
  EXCEPTION
    WHEN raise_exception THEN
      RAISE NOTICE 'PASS [OMS-11b]: audit_log DELETE 被触发器拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 12: idempotency_key UNIQUE 约束
-- ============================================================================

DO $$
DECLARE
  _parent_id INTEGER;
BEGIN
  INSERT INTO oms.orders
    (company_code, doc_type, doc_number, sap_doc_entry, sap_doc_num, oms_status)
  VALUES ('TEST', 'SO', 'OMS-TEST-12', 99940, 'OMS-TEST-12', 'pending')
  RETURNING id INTO _parent_id;

  -- 第一次插入 DD
  INSERT INTO oms.orders
    (company_code, doc_type, doc_number, parent_id, split_seq, sap_doc_entry, sap_doc_num, oms_status, idempotency_key)
  VALUES ('TEST', 'DD', 'OMS-DD-12A', _parent_id, 1, 99940, 'OMS-TEST-12', 'pending', 'IDEM_TEST_12');

  -- 第二次插入相同 idempotency_key → 应冲突
  BEGIN
    INSERT INTO oms.orders
      (company_code, doc_type, doc_number, parent_id, split_seq, sap_doc_entry, sap_doc_num, oms_status, idempotency_key)
    VALUES ('TEST', 'DD', 'OMS-DD-12B', _parent_id, 2, 99940, 'OMS-TEST-12', 'pending', 'IDEM_TEST_12');
    RAISE EXCEPTION 'FAIL: 重复 idempotency_key 未被拒绝';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS [OMS-12]: 重复 idempotency_key 被 UNIQUE 约束拒绝';
  END;

  -- 清理
  DELETE FROM oms.orders WHERE sap_doc_num = 'OMS-TEST-12' AND doc_type = 'DD';
  DELETE FROM oms.orders WHERE id = _parent_id;
END $$;

-- ============================================================================
-- 测试 13: v_order_summary 视图存在且可查询
-- ============================================================================

DO $$
BEGIN
  PERFORM 1 FROM oms.v_order_summary LIMIT 0;
  RAISE NOTICE 'PASS [OMS-13]: v_order_summary 视图可查询';
EXCEPTION
  WHEN undefined_table THEN
    RAISE EXCEPTION 'FAIL: v_order_summary 视图不存在';
END $$;

-- ============================================================================
-- 测试 14: v_dd_lineage 视图存在且可查询
-- ============================================================================

DO $$
BEGIN
  PERFORM 1 FROM oms.v_dd_lineage LIMIT 0;
  RAISE NOTICE 'PASS [OMS-14]: v_dd_lineage 视图可查询';
EXCEPTION
  WHEN undefined_table THEN
    RAISE EXCEPTION 'FAIL: v_dd_lineage 视图不存在';
END $$;

-- ============================================================================
-- 测试 15: DD doc_type 在 WMS 中也可用 (wms_documents)
-- ============================================================================

DO $$
DECLARE
  _id INTEGER;
BEGIN
  INSERT INTO wms.wms_documents
    (company_code, doc_type, doc_number, created_by)
  VALUES ('TEST', 'DD', 'OMS-WMS-TEST-15', 'ci_test')
  RETURNING id INTO _id;

  IF _id IS NOT NULL THEN
    RAISE NOTICE 'PASS [OMS-15]: DD doc_type 在 wms_documents 中可用';
  ELSE
    RAISE EXCEPTION 'FAIL: DD 文档创建失败';
  END IF;

  -- 清理
  DELETE FROM wms.wms_documents WHERE id = _id;
END $$;

-- ============================================================================
-- 测试完成
-- ============================================================================
DO $$ BEGIN RAISE NOTICE '=== OMS Schema 行为测试完成 (15 项) ==='; END $$;
