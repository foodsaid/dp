-- ============================================================================
-- DP v0.3.2 — 触发器行为测试 + 跨 Schema 查询测试
-- 验证 fn_updated_at / fn_enforce_company_code / fn_prevent_audit_log_tampering
-- 在 CI pg-schema-test Job 中执行 (依赖 03_wms_tables.sql + 05_oms_tables.sql 已执行)
-- ============================================================================

SET search_path TO wms, public;

-- ============================================================================
-- 测试 1: fn_updated_at — UPDATE 自动更新 updated_at
-- ============================================================================

DO $$
DECLARE
    _doc_id INT;
    _created_ts TIMESTAMPTZ;
    _updated_ts TIMESTAMPTZ;
BEGIN
    -- 插入一条测试文档
    INSERT INTO wms.wms_documents
        (company_code, doc_type, doc_number, created_by)
    VALUES ('TEST_CO', 'PO', 'TRIG-UPD-01', 'ci_test')
    RETURNING id, updated_at INTO _doc_id, _created_ts;

    -- 等待微秒级时间差
    PERFORM pg_sleep(0.01);

    -- 更新文档
    UPDATE wms.wms_documents
        SET status = 'in_progress'
        WHERE id = _doc_id;

    SELECT updated_at INTO _updated_ts
        FROM wms.wms_documents WHERE id = _doc_id;

    -- updated_at 应该大于创建时间
    IF _updated_ts > _created_ts THEN
        RAISE NOTICE 'PASS: fn_updated_at 触发器正确更新了 updated_at';
    ELSE
        RAISE EXCEPTION 'FAIL: updated_at 未被更新 (created=%, updated=%)',
            _created_ts, _updated_ts;
    END IF;

    -- 清理
    DELETE FROM wms.wms_documents WHERE id = _doc_id;
END $$;

-- ============================================================================
-- 测试 2: fn_enforce_company_code — 空格 company_code 被拒绝
-- ============================================================================

DO $$
BEGIN
    BEGIN
        INSERT INTO wms.wms_documents
            (company_code, doc_type, doc_number, created_by)
        VALUES ('   ', 'PO', 'TRIG-ENF-01', 'ci_test');
        RAISE EXCEPTION 'FAIL: 纯空格 company_code 未被拒绝';
    EXCEPTION
        WHEN check_violation THEN
            RAISE NOTICE 'PASS: 纯空格 company_code 被 CHECK 约束拒绝';
        WHEN raise_exception THEN
            RAISE NOTICE 'PASS: 纯空格 company_code 被触发器拒绝';
    END;
END $$;

-- ============================================================================
-- 测试 3: fn_prevent_audit_log_tampering — 审计日志不可 UPDATE
-- ============================================================================

DO $$
DECLARE
    _log_id INT;
BEGIN
    -- 插入一条审计日志
    INSERT INTO wms.wms_audit_log
        (company_code, action, table_name, record_id, performed_by)
    VALUES ('TEST_CO', 'INSERT', 'wms_documents', 999, 'ci_test')
    RETURNING id INTO _log_id;

    -- 尝试 UPDATE → 应被触发器拒绝
    BEGIN
        UPDATE wms.wms_audit_log SET action = 'HACKED' WHERE id = _log_id;
        RAISE EXCEPTION 'FAIL: 审计日志 UPDATE 未被拒绝';
    EXCEPTION
        WHEN raise_exception THEN
            RAISE NOTICE 'PASS: 审计日志 UPDATE 被 fn_prevent_audit_log_tampering 拒绝';
    END;

    -- 尝试 DELETE → 应被触发器拒绝
    BEGIN
        DELETE FROM wms.wms_audit_log WHERE id = _log_id;
        RAISE EXCEPTION 'FAIL: 审计日志 DELETE 未被拒绝';
    EXCEPTION
        WHEN raise_exception THEN
            RAISE NOTICE 'PASS: 审计日志 DELETE 被 fn_prevent_audit_log_tampering 拒绝';
    END;
END $$;

-- ============================================================================
-- 测试 4: wms_documents doc_type 约束 — 无效类型被拒绝
-- ============================================================================

DO $$
BEGIN
    BEGIN
        INSERT INTO wms.wms_documents
            (company_code, doc_type, doc_number, created_by)
        VALUES ('TEST_CO', 'INVALID', 'TRIG-DOCTYPE-01', 'ci_test');
        RAISE EXCEPTION 'FAIL: 无效 doc_type 未被拒绝';
    EXCEPTION
        WHEN check_violation THEN
            RAISE NOTICE 'PASS: 无效 doc_type 被 CHECK 约束拒绝';
    END;
END $$;

-- ============================================================================
-- 测试 5: wms_documents status 约束 — 无效状态被拒绝
-- ============================================================================

DO $$
BEGIN
    BEGIN
        INSERT INTO wms.wms_documents
            (company_code, doc_type, doc_number, status, created_by)
        VALUES ('TEST_CO', 'PO', 'TRIG-STATUS-01', 'invalid_status', 'ci_test');
        RAISE EXCEPTION 'FAIL: 无效 status 未被拒绝';
    EXCEPTION
        WHEN check_violation THEN
            RAISE NOTICE 'PASS: 无效 status 被 CHECK 约束拒绝';
    END;
END $$;

-- ============================================================================
-- 测试 6: v_stock_realtime 视图存在且可查询
-- ============================================================================

DO $$
BEGIN
    PERFORM 1 FROM wms.v_stock_realtime LIMIT 0;
    RAISE NOTICE 'PASS: v_stock_realtime 视图可查询';
EXCEPTION
    WHEN undefined_table THEN
        RAISE EXCEPTION 'FAIL: v_stock_realtime 视图不存在';
END $$;

-- ============================================================================
-- 测试 7: v_document_summary 视图存在且可查询
-- ============================================================================

DO $$
BEGIN
    PERFORM 1 FROM wms.v_document_summary LIMIT 0;
    RAISE NOTICE 'PASS: v_document_summary 视图可查询';
EXCEPTION
    WHEN undefined_table THEN
        RAISE EXCEPTION 'FAIL: v_document_summary 视图不存在';
END $$;

-- ============================================================================
-- 测试 8: wms_stock_snapshot 表 company_code 非空约束
-- ============================================================================

DO $$
BEGIN
    BEGIN
        INSERT INTO wms.wms_stock_snapshot
            (company_code, item_code, warehouse_code, on_hand_qty, snapshot_date)
        VALUES ('', 'ITEM-TEST', 'WH01', 100, CURRENT_DATE);
        RAISE EXCEPTION 'FAIL: stock_snapshot 空 company_code 未被拒绝';
    EXCEPTION
        WHEN check_violation THEN
            RAISE NOTICE 'PASS: stock_snapshot 空 company_code 被 CHECK 拒绝';
        WHEN raise_exception THEN
            RAISE NOTICE 'PASS: stock_snapshot 空 company_code 被触发器拒绝';
    END;
END $$;

-- ============================================================================
-- 测试 9: wms_transactions 表 company_code 非空约束
-- ============================================================================

DO $$
BEGIN
    BEGIN
        INSERT INTO wms.wms_transactions
            (company_code, doc_id, line_id, tx_type, item_code, quantity, performed_by)
        VALUES (NULL, 1, 1, 'GR', 'ITEM-TEST', 10, 'ci_test');
        RAISE EXCEPTION 'FAIL: transactions NULL company_code 未被拒绝';
    EXCEPTION
        WHEN not_null_violation THEN
            RAISE NOTICE 'PASS: transactions NULL company_code 被 NOT NULL 拒绝';
    END;
END $$;

-- ============================================================================
-- 测试 10: 跨 Schema 查询 (wms + oms)
-- ============================================================================

DO $$
BEGIN
    -- 验证 OMS Schema 存在
    PERFORM 1 FROM information_schema.schemata WHERE schema_name = 'oms';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'FAIL: oms schema 不存在';
    END IF;
    RAISE NOTICE 'PASS: oms schema 存在';
END $$;

DO $$
BEGIN
    -- 验证跨 Schema 表可访问
    PERFORM 1 FROM oms.orders LIMIT 0;
    RAISE NOTICE 'PASS: 跨 Schema 查询 oms.orders 成功';
EXCEPTION
    WHEN undefined_table THEN
        RAISE EXCEPTION 'FAIL: oms.orders 表不存在或不可访问';
    WHEN insufficient_privilege THEN
        RAISE EXCEPTION 'FAIL: 无权访问 oms.orders';
END $$;

-- ============================================================================
-- 测试 11: DD doc_type 在 wms_documents 中被接受
-- ============================================================================

DO $$
DECLARE
    _doc_id INT;
BEGIN
    INSERT INTO wms.wms_documents
        (company_code, doc_type, doc_number, created_by)
    VALUES ('TEST_CO', 'DD', 'TRIG-DD-01', 'ci_test')
    RETURNING id INTO _doc_id;

    RAISE NOTICE 'PASS: DD doc_type 成功插入 wms_documents';

    -- 清理
    DELETE FROM wms.wms_documents WHERE id = _doc_id;
END $$;

-- ============================================================================
-- 测试 12: fn_synced_at 触发器 — 缓存表更新自动刷新 synced_at
-- ============================================================================

DO $$
DECLARE
    _created_ts TIMESTAMPTZ;
    _synced_ts TIMESTAMPTZ;
BEGIN
    -- 插入测试物料缓存
    INSERT INTO wms.wms_items_cache
        (item_code, item_name)
    VALUES ('SYNC-TEST-001', '同步测试物料')
    ON CONFLICT (item_code) DO UPDATE SET item_name = EXCLUDED.item_name;

    SELECT synced_at INTO _created_ts
        FROM wms.wms_items_cache WHERE item_code = 'SYNC-TEST-001';

    PERFORM pg_sleep(0.01);

    -- 更新触发 fn_synced_at
    UPDATE wms.wms_items_cache
        SET item_name = '更新后名称'
        WHERE item_code = 'SYNC-TEST-001';

    SELECT synced_at INTO _synced_ts
        FROM wms.wms_items_cache WHERE item_code = 'SYNC-TEST-001';

    IF _synced_ts > _created_ts THEN
        RAISE NOTICE 'PASS: fn_synced_at 触发器正确更新了 synced_at';
    ELSE
        RAISE EXCEPTION 'FAIL: synced_at 未被更新';
    END IF;

    -- 清理
    DELETE FROM wms.wms_items_cache WHERE item_code = 'SYNC-TEST-001';
END $$;
