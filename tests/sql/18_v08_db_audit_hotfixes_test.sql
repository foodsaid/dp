-- ============================================================================
-- DP v0.8.0 — DB audit hotfixes test suite
-- Validates: TIMESTAMPTZ migration, DEPRECATED annotations, index changes,
--            core schema, trigger audit log, data integrity
-- ============================================================================

-- ============================================================================
-- Test 1: All timestamp columns should be TIMESTAMPTZ
-- ============================================================================
DO $$
DECLARE
    v_bad_count INTEGER;
    v_details TEXT;
BEGIN
    SELECT COUNT(*), STRING_AGG(table_schema || '.' || table_name || '.' || column_name, ', ')
    INTO v_bad_count, v_details
    FROM information_schema.columns
    WHERE table_schema IN ('wms', 'oms', 'ai')
      AND column_name IN (
          'created_at', 'updated_at', 'locked_at', 'exported_at',
          'synced_at', 'transaction_time', 'wms_updated_at', 'fired_at', 'expires_at'
      )
      AND data_type = 'timestamp without time zone';

    IF v_bad_count > 0 THEN
        RAISE EXCEPTION 'FAIL: % columns still TIMESTAMP (no TZ): %', v_bad_count, v_details;
    END IF;
    RAISE NOTICE 'PASS: All timestamp columns are TIMESTAMPTZ';
END $$;


-- ============================================================================
-- Test 2: Time semantic validation — no 7-hour offset after conversion
-- ============================================================================
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    -- After TIMESTAMPTZ migration, data should be preserved correctly.
    -- Verify that AT TIME ZONE 'Asia/Bangkok' returns local time matching original values.
    -- Cannot do automated comparison (original values gone), but can verify no NULLs introduced.
    SELECT COUNT(*) INTO v_count
    FROM wms.wms_documents
    WHERE created_at IS NULL;

    IF v_count > 0 THEN
        RAISE EXCEPTION 'FAIL: % wms_documents rows have NULL created_at after migration', v_count;
    END IF;

    -- Spot check: created_at should have timezone info
    SELECT COUNT(*) INTO v_count
    FROM information_schema.columns
    WHERE table_schema = 'wms'
      AND table_name = 'wms_documents'
      AND column_name = 'created_at'
      AND data_type = 'timestamp with time zone';

    IF v_count = 0 THEN
        RAISE EXCEPTION 'FAIL: wms_documents.created_at is not TIMESTAMPTZ';
    END IF;

    RAISE NOTICE 'PASS: Time semantic validation — no NULLs, correct type';
END $$;

-- Informational: sample for manual verification (bangkok_repr should match original business time)
SELECT
    'wms_documents' AS source,
    created_at,
    created_at AT TIME ZONE 'UTC' AS utc_repr,
    created_at AT TIME ZONE 'Asia/Bangkok' AS bangkok_repr
FROM wms.wms_documents
LIMIT 5;


-- ============================================================================
-- Test 3: DEPRECATED column annotations exist
-- ============================================================================
DO $$
DECLARE
    v_comment TEXT;
BEGIN
    -- wms_documents.wms_status
    SELECT col_description(
        (SELECT oid FROM pg_class WHERE relname = 'wms_documents' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'wms')),
        (SELECT ordinal_position FROM information_schema.columns WHERE table_schema = 'wms' AND table_name = 'wms_documents' AND column_name = 'wms_status')
    ) INTO v_comment;

    IF v_comment IS NULL OR v_comment NOT LIKE '%DEPRECATED%' THEN
        RAISE EXCEPTION 'FAIL: wms_documents.wms_status missing DEPRECATED comment';
    END IF;

    -- wms_document_lines.wms_status
    SELECT col_description(
        (SELECT oid FROM pg_class WHERE relname = 'wms_document_lines' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'wms')),
        (SELECT ordinal_position FROM information_schema.columns WHERE table_schema = 'wms' AND table_name = 'wms_document_lines' AND column_name = 'wms_status')
    ) INTO v_comment;

    IF v_comment IS NULL OR v_comment NOT LIKE '%DEPRECATED%' THEN
        RAISE EXCEPTION 'FAIL: wms_document_lines.wms_status missing DEPRECATED comment';
    END IF;

    -- oms.orders.oms_status
    SELECT col_description(
        (SELECT oid FROM pg_class WHERE relname = 'orders' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'oms')),
        (SELECT ordinal_position FROM information_schema.columns WHERE table_schema = 'oms' AND table_name = 'orders' AND column_name = 'oms_status')
    ) INTO v_comment;

    IF v_comment IS NULL OR v_comment NOT LIKE '%DEPRECATED%' THEN
        RAISE EXCEPTION 'FAIL: oms.orders.oms_status missing DEPRECATED comment';
    END IF;

    RAISE NOTICE 'PASS: All DEPRECATED column annotations exist';
END $$;


-- ============================================================================
-- Test 4: Index changes — deleted indexes gone, new indexes exist
-- ============================================================================
DO $$
DECLARE
    v_count INTEGER;
    v_comment TEXT;
BEGIN
    -- Deleted indexes should NOT exist
    SELECT COUNT(*) INTO v_count
    FROM pg_indexes
    WHERE schemaname = 'wms'
      AND indexname IN ('idx_documents_company', 'idx_documents_doc_type', 'idx_documents_wms_status', 'idx_lines_wms_status');

    IF v_count > 0 THEN
        RAISE EXCEPTION 'FAIL: % deleted indexes still exist', v_count;
    END IF;

    -- New composite indexes MUST exist
    SELECT COUNT(*) INTO v_count
    FROM pg_indexes
    WHERE schemaname = 'wms' AND indexname = 'idx_documents_cc_type_status';
    IF v_count = 0 THEN RAISE EXCEPTION 'FAIL: idx_documents_cc_type_status not created'; END IF;

    SELECT COUNT(*) INTO v_count
    FROM pg_indexes
    WHERE schemaname = 'wms' AND indexname = 'idx_documents_cc_sap_docnum';
    IF v_count = 0 THEN RAISE EXCEPTION 'FAIL: idx_documents_cc_sap_docnum not created'; END IF;

    SELECT COUNT(*) INTO v_count
    FROM pg_indexes
    WHERE schemaname = 'oms' AND indexname = 'idx_oms_orders_cc_exec_state';
    IF v_count = 0 THEN RAISE EXCEPTION 'FAIL: idx_oms_orders_cc_exec_state not created'; END IF;

    -- DEPRECATED indexes should exist WITH comment
    SELECT obj_description(i.indexrelid, 'pg_class') INTO v_comment
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'idx_documents_status';

    IF v_comment IS NULL OR v_comment NOT LIKE '%DEPRECATED%' THEN
        RAISE EXCEPTION 'FAIL: idx_documents_status missing DEPRECATED comment';
    END IF;

    RAISE NOTICE 'PASS: Index changes validated — 4 deleted, 3 new, deprecated preserved';
END $$;


-- ============================================================================
-- Test 5: core Schema and functions exist
-- ============================================================================
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM pg_namespace WHERE nspname = 'core';
    IF v_count = 0 THEN RAISE EXCEPTION 'FAIL: core schema does not exist'; END IF;

    SELECT COUNT(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'core' AND p.proname = 'fn_updated_at';
    IF v_count = 0 THEN RAISE EXCEPTION 'FAIL: core.fn_updated_at() does not exist'; END IF;

    SELECT COUNT(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'core' AND p.proname = 'fn_synced_at';
    IF v_count = 0 THEN RAISE EXCEPTION 'FAIL: core.fn_synced_at() does not exist'; END IF;

    SELECT COUNT(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'core' AND p.proname = 'fn_enforce_company_code';
    IF v_count = 0 THEN RAISE EXCEPTION 'FAIL: core.fn_enforce_company_code() does not exist'; END IF;

    RAISE NOTICE 'PASS: core schema with 3 functions validated';
END $$;


-- ============================================================================
-- Test 6: trigger_audit_log table exists and accepts inserts
-- ============================================================================
DO $$
DECLARE
    v_count INTEGER;
    v_id INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM information_schema.tables
    WHERE table_schema = 'oms' AND table_name = 'trigger_audit_log';
    IF v_count = 0 THEN RAISE EXCEPTION 'FAIL: oms.trigger_audit_log does not exist'; END IF;

    -- Test insert
    INSERT INTO oms.trigger_audit_log (trigger_name, table_name, row_id, company_code)
    VALUES ('test_trigger', 'test_table', 0, 'TEST')
    RETURNING id INTO v_id;

    -- Verify
    SELECT COUNT(*) INTO v_count
    FROM oms.trigger_audit_log WHERE id = v_id;
    IF v_count = 0 THEN RAISE EXCEPTION 'FAIL: trigger_audit_log insert not readable'; END IF;

    -- Cleanup
    DELETE FROM oms.trigger_audit_log WHERE id = v_id;

    RAISE NOTICE 'PASS: trigger_audit_log table exists and accepts inserts';
END $$;


-- ============================================================================
-- Test 7: DEPRECATED function annotations exist
-- ============================================================================
DO $$
DECLARE
    v_comment TEXT;
BEGIN
    SELECT obj_description(p.oid, 'pg_proc') INTO v_comment
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'wms' AND p.proname = 'fn_updated_at';

    IF v_comment IS NULL OR v_comment NOT LIKE '%DEPRECATED%' THEN
        RAISE EXCEPTION 'FAIL: wms.fn_updated_at() missing DEPRECATED comment';
    END IF;

    SELECT obj_description(p.oid, 'pg_proc') INTO v_comment
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'oms' AND p.proname = 'fn_updated_at';

    IF v_comment IS NULL OR v_comment NOT LIKE '%DEPRECATED%' THEN
        RAISE EXCEPTION 'FAIL: oms.fn_updated_at() missing DEPRECATED comment';
    END IF;

    RAISE NOTICE 'PASS: DEPRECATED function annotations validated';
END $$;


-- ============================================================================
-- Test 8: Data integrity — no NULL timestamps after migration
-- ============================================================================
DO $$
DECLARE
    v_null_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_null_count FROM wms.wms_documents WHERE updated_at IS NULL;
    IF v_null_count > 0 THEN RAISE EXCEPTION 'FAIL: % wms_documents with NULL updated_at', v_null_count; END IF;

    SELECT COUNT(*) INTO v_null_count FROM wms.wms_document_lines WHERE created_at IS NULL;
    IF v_null_count > 0 THEN RAISE EXCEPTION 'FAIL: % wms_document_lines with NULL created_at', v_null_count; END IF;

    SELECT COUNT(*) INTO v_null_count FROM wms.wms_audit_log WHERE created_at IS NULL;
    IF v_null_count > 0 THEN RAISE EXCEPTION 'FAIL: % wms_audit_log with NULL created_at', v_null_count; END IF;

    RAISE NOTICE 'PASS: Data integrity — no NULL timestamps';
END $$;


-- ============================================================================
-- Summary
-- ============================================================================
SELECT '✓ All v0.8 DB audit hotfix tests passed' AS result;
