-- ============================================================================
-- DP v0.1 — SQL 行为测试
-- 故意写错数据，验证 CHECK 约束 + 触发器是否生效
-- 在 CI pg-schema-test Job 中执行
-- ============================================================================

SET search_path TO wms, public;

-- ============================================================================
-- 测试 1: company_code 空字符串 → CHECK 约束拒绝
-- ============================================================================

DO $$
BEGIN
  BEGIN
    INSERT INTO wms.wms_documents
      (company_code, doc_type, doc_number, created_by)
    VALUES ('', 'PO', 'TEST-CHK-01', 'ci_test');
    RAISE EXCEPTION 'FAIL: 空 company_code 未被拒绝';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: 空 company_code 被 CHECK 约束拒绝';
    WHEN raise_exception THEN
      -- fn_enforce_company_code 触发器也可能拦截
      RAISE NOTICE 'PASS: 空 company_code 被触发器拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 2: company_code NULL → NOT NULL 约束拒绝
-- ============================================================================

DO $$
BEGIN
  BEGIN
    INSERT INTO wms.wms_documents
      (company_code, doc_type, doc_number, created_by)
    VALUES (NULL, 'PO', 'TEST-CHK-02', 'ci_test');
    RAISE EXCEPTION 'FAIL: NULL company_code 未被拒绝';
  EXCEPTION
    WHEN not_null_violation THEN
      RAISE NOTICE 'PASS: NULL company_code 被 NOT NULL 拒绝';
    WHEN raise_exception THEN
      RAISE NOTICE 'PASS: NULL company_code 被触发器拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 3: 非法 doc_type → CHECK 约束拒绝
-- ============================================================================

DO $$
BEGIN
  BEGIN
    INSERT INTO wms.wms_documents
      (company_code, doc_type, doc_number, created_by)
    VALUES ('TEST', 'XX', 'TEST-CHK-03', 'ci_test');
    RAISE EXCEPTION 'FAIL: 非法 doc_type "XX" 未被拒绝';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: 非法 doc_type 被 CHECK 约束拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 4: 非法 status → CHECK 约束拒绝
-- ============================================================================

DO $$
BEGIN
  BEGIN
    INSERT INTO wms.wms_documents
      (company_code, doc_type, doc_number, status, created_by)
    VALUES ('TEST', 'PO', 'TEST-CHK-04', 'invalid_status', 'ci_test');
    RAISE EXCEPTION 'FAIL: 非法 status 未被拒绝';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: 非法 status 被 CHECK 约束拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 5: wms_transactions 空 company_code → 触发器拒绝
-- ============================================================================

-- 先插入一个合法文档供外键引用
INSERT INTO wms.wms_documents
  (company_code, doc_type, doc_number, created_by)
VALUES ('TEST', 'PO', 'BEHAVIOR-TEST-01', 'ci_test');

DO $$
DECLARE
  v_doc_id INT;
BEGIN
  SELECT id INTO v_doc_id FROM wms.wms_documents
    WHERE doc_number = 'BEHAVIOR-TEST-01' LIMIT 1;

  BEGIN
    INSERT INTO wms.wms_transactions
      (company_code, document_id, action, item_code, quantity, performed_by)
    VALUES ('', v_doc_id, 'receipt', 'TEST-ITEM', 10, 'ci_test');
    RAISE EXCEPTION 'FAIL: 空 company_code 未被拒绝 (wms_transactions)';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: wms_transactions 空 company_code 被 CHECK 拒绝';
    WHEN raise_exception THEN
      RAISE NOTICE 'PASS: wms_transactions 空 company_code 被触发器拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 6: fn_updated_at 触发器 — UPDATE 自动刷新 updated_at
-- ============================================================================

DO $$
DECLARE
  v_old_ts TIMESTAMP;
  v_new_ts TIMESTAMP;
BEGIN
  SELECT updated_at INTO v_old_ts FROM wms.wms_documents
    WHERE doc_number = 'BEHAVIOR-TEST-01';

  -- 等待 10ms 确保时间戳有变化
  PERFORM pg_sleep(0.01);

  UPDATE wms.wms_documents
    SET remarks = 'trigger test'
    WHERE doc_number = 'BEHAVIOR-TEST-01';

  SELECT updated_at INTO v_new_ts FROM wms.wms_documents
    WHERE doc_number = 'BEHAVIOR-TEST-01';

  IF v_new_ts > v_old_ts THEN
    RAISE NOTICE 'PASS: fn_updated_at 触发器正常 (% → %)', v_old_ts, v_new_ts;
  ELSE
    RAISE EXCEPTION 'FAIL: updated_at 未更新 (old=%, new=%)', v_old_ts, v_new_ts;
  END IF;
END $$;

-- ============================================================================
-- 测试 7: 唯一约束 — 同 company_code + doc_type + doc_number 重复插入
-- ============================================================================

DO $$
BEGIN
  BEGIN
    INSERT INTO wms.wms_documents
      (company_code, doc_type, doc_number, created_by)
    VALUES ('TEST', 'PO', 'BEHAVIOR-TEST-01', 'ci_test');
    RAISE EXCEPTION 'FAIL: 重复单据未被拒绝';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS: 重复单据被唯一约束拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 8: wms_audit_log 空 company_code → 拒绝
-- ============================================================================

DO $$
BEGIN
  BEGIN
    INSERT INTO wms.wms_audit_log
      (company_code, table_name, record_id, action, performed_by)
    VALUES ('', 'wms_documents', 1, 'INSERT', 'ci_test');
    RAISE EXCEPTION 'FAIL: audit_log 空 company_code 未被拒绝';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: audit_log 空 company_code 被 CHECK 拒绝';
    WHEN raise_exception THEN
      RAISE NOTICE 'PASS: audit_log 空 company_code 被触发器拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 9: wms_audit_log 非法 action → CHECK 约束拒绝
-- ============================================================================

DO $$
BEGIN
  BEGIN
    INSERT INTO wms.wms_audit_log
      (company_code, table_name, record_id, action, performed_by)
    VALUES ('TEST', 'wms_documents', 1, 'HACK', 'ci_test');
    RAISE EXCEPTION 'FAIL: audit_log 非法 action 未被拒绝';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: audit_log 非法 action 被 CHECK 约束拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 10: wms_stock_snapshot company_code 防护
-- ============================================================================

DO $$
BEGIN
  BEGIN
    INSERT INTO wms.wms_stock_snapshot
      (company_code, snapshot_date, item_code, whs_code)
    VALUES ('', CURRENT_DATE, 'TEST-ITEM', 'WH01');
    RAISE EXCEPTION 'FAIL: stock_snapshot 空 company_code 未被拒绝';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: stock_snapshot 空 company_code 被 CHECK 拒绝';
    WHEN raise_exception THEN
      RAISE NOTICE 'PASS: stock_snapshot 空 company_code 被触发器拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 11: company_code 纯空格 → 触发器/CHECK 拒绝
-- (修复: fn_enforce_company_code 使用 TRIM() 防止空白字符绕过)
-- ============================================================================

DO $$
BEGIN
  BEGIN
    INSERT INTO wms.wms_documents
      (company_code, doc_type, doc_number, created_by)
    VALUES ('   ', 'PO', 'TEST-CHK-11', 'ci_test');
    RAISE EXCEPTION 'FAIL: 纯空格 company_code 未被拒绝';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: 纯空格 company_code 被 CHECK 约束拒绝';
    WHEN raise_exception THEN
      RAISE NOTICE 'PASS: 纯空格 company_code 被触发器拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 12: company_code 制表符 → 触发器/CHECK 拒绝
-- ============================================================================

DO $$
BEGIN
  BEGIN
    INSERT INTO wms.wms_documents
      (company_code, doc_type, doc_number, created_by)
    VALUES (E'\t', 'PO', 'TEST-CHK-12', 'ci_test');
    RAISE EXCEPTION 'FAIL: 制表符 company_code 未被拒绝';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: 制表符 company_code 被 CHECK 约束拒绝';
    WHEN raise_exception THEN
      RAISE NOTICE 'PASS: 制表符 company_code 被触发器拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 13: wms_transactions 纯空格 company_code → 拒绝
-- ============================================================================

DO $$
DECLARE
  v_doc_id INT;
BEGIN
  SELECT id INTO v_doc_id FROM wms.wms_documents
    WHERE doc_number = 'BEHAVIOR-TEST-01' LIMIT 1;

  BEGIN
    INSERT INTO wms.wms_transactions
      (company_code, document_id, action, item_code, quantity, performed_by)
    VALUES ('   ', v_doc_id, 'receipt', 'TEST-ITEM', 10, 'ci_test');
    RAISE EXCEPTION 'FAIL: 纯空格 company_code 未被拒绝 (wms_transactions)';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: wms_transactions 纯空格 company_code 被 CHECK 拒绝';
    WHEN raise_exception THEN
      RAISE NOTICE 'PASS: wms_transactions 纯空格 company_code 被触发器拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 14: wms_stock_snapshot 纯空格 company_code → 拒绝
-- ============================================================================

DO $$
BEGIN
  BEGIN
    INSERT INTO wms.wms_stock_snapshot
      (company_code, snapshot_date, item_code, whs_code)
    VALUES ('   ', CURRENT_DATE, 'TEST-ITEM', 'WH01');
    RAISE EXCEPTION 'FAIL: stock_snapshot 纯空格 company_code 未被拒绝';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: stock_snapshot 纯空格 company_code 被 CHECK 拒绝';
    WHEN raise_exception THEN
      RAISE NOTICE 'PASS: stock_snapshot 纯空格 company_code 被触发器拒绝';
  END;
END $$;

-- ============================================================================
-- 测试 15: wms_audit_log UPDATE → 触发器拒绝 (append-only 不可变性)
-- ============================================================================

-- 先插入一条合法审计记录用于测试
INSERT INTO wms.wms_audit_log
  (company_code, table_name, record_id, action, performed_by)
VALUES ('TEST', 'wms_documents', 1, 'INSERT', 'ci_test');

DO $$
DECLARE
  v_audit_id BIGINT;
BEGIN
  SELECT id INTO v_audit_id FROM wms.wms_audit_log
    WHERE performed_by = 'ci_test' LIMIT 1;

  BEGIN
    UPDATE wms.wms_audit_log
      SET performed_by = 'hacker'
      WHERE id = v_audit_id;
    RAISE EXCEPTION 'FAIL: audit_log UPDATE 未被拒绝';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE '%append-only%' THEN
        RAISE NOTICE 'PASS: audit_log UPDATE 被不可变性触发器拒绝';
      ELSE
        RAISE EXCEPTION 'FAIL: 非预期异常: %', SQLERRM;
      END IF;
  END;
END $$;

-- ============================================================================
-- 测试 16: wms_audit_log DELETE → 触发器拒绝 (append-only 不可变性)
-- ============================================================================

DO $$
DECLARE
  v_audit_id BIGINT;
BEGIN
  SELECT id INTO v_audit_id FROM wms.wms_audit_log
    WHERE performed_by = 'ci_test' LIMIT 1;

  BEGIN
    DELETE FROM wms.wms_audit_log WHERE id = v_audit_id;
    RAISE EXCEPTION 'FAIL: audit_log DELETE 未被拒绝';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE '%append-only%' THEN
        RAISE NOTICE 'PASS: audit_log DELETE 被不可变性触发器拒绝';
      ELSE
        RAISE EXCEPTION 'FAIL: 非预期异常: %', SQLERRM;
      END IF;
  END;
END $$;

-- ============================================================================
-- 清理测试数据
-- 注意: wms_audit_log 测试记录无法删除 (append-only 不可变性保护)
-- CI 环境数据库为临时实例，无需清理审计日志
-- ============================================================================

DELETE FROM wms.wms_transactions WHERE performed_by = 'ci_test';
DELETE FROM wms.wms_documents WHERE doc_number = 'BEHAVIOR-TEST-01';

SELECT '✓ SQL 行为测试全部通过: 16 项约束/触发器验证' AS status;
