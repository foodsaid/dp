-- =============================================================================
-- 17_wms_decouple_sap_test.sql — WMS 解耦 SAP DDL 行为测试
-- 前置: 17_wms_decouple_sap.sql
-- 用法: psql -U <superuser> -d <db> -v ON_ERROR_STOP=1 -f 17_wms_decouple_sap_test.sql
-- =============================================================================

\echo '============================================================'
\echo '  17_wms_decouple_sap 行为测试开始'
\echo '============================================================'

-- ============================================================================
-- 准备测试数据
-- ============================================================================
\echo '[准备] 插入测试订单...'

INSERT INTO oms.orders (
    company_code, doc_type, doc_number, sap_doc_entry, sap_doc_num,
    sap_status, sap_update_date, sap_update_time,
    item_code, item_name, planned_qty, warehouse_code,
    sync_status
) VALUES (
    'TEST_DECOUPLE', 'WO', 'DECOUPLE-WO-001', 99901, '99901',
    'R', '2026-01-15', '10:00:00',
    'FG-001', 'Finished Good 001', 100, 'WH01',
    'pending'
) ON CONFLICT (company_code, doc_type, doc_number) DO NOTHING;

DO $$
DECLARE
    v_order_id INT;
BEGIN
    SELECT id INTO v_order_id FROM oms.orders
        WHERE company_code = 'TEST_DECOUPLE' AND doc_number = 'DECOUPLE-WO-001';

    IF v_order_id IS NOT NULL THEN
        INSERT INTO oms.order_lines (
            order_id, company_code, line_num, item_code, item_name,
            quantity, open_quantity, uom, warehouse_code,
            delivered_qty, issued_qty, sap_update_date, sap_update_time,
            wms_actual_qty, picked_qty, status
        ) VALUES (
            v_order_id, 'TEST_DECOUPLE', 1, 'MAT-001', 'Material 001',
            50, 50, 'PC', 'WH01',
            0, 0, '2026-01-15', '10:00:00',
            10, 5, 'partial'
        ) ON CONFLICT (order_id, line_num) DO NOTHING;
    END IF;
END $$;


-- ============================================================================
-- Test 1: New columns exist
-- ============================================================================
\echo '[Test 1] order_lines new columns exist'

DO $$
DECLARE
    v_cols TEXT[];
    v_col TEXT;
BEGIN
    v_cols := ARRAY['delivered_qty','issued_qty','uom_snapshot','sap_update_date','sap_update_time','wms_updated_at'];
    FOREACH v_col IN ARRAY v_cols LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'oms' AND table_name = 'order_lines' AND column_name = v_col
        ) THEN
            RAISE EXCEPTION 'FAIL: column oms.order_lines.% does not exist', v_col;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS: all order_lines new columns exist';
END $$;

\echo '[Test 1b] orders new columns exist'

DO $$
DECLARE
    v_cols TEXT[];
    v_col TEXT;
BEGIN
    v_cols := ARRAY['expected_line_count','wms_updated_at','sync_status'];
    FOREACH v_col IN ARRAY v_cols LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'oms' AND table_name = 'orders' AND column_name = v_col
        ) THEN
            RAISE EXCEPTION 'FAIL: column oms.orders.% does not exist', v_col;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS: all orders new columns exist';
END $$;

\echo '[Test 1c] wms_items_cache new columns exist'

DO $$
DECLARE
    v_cols TEXT[];
    v_col TEXT;
BEGIN
    v_cols := ARRAY['foreign_name','item_group','inventory_uom','purchase_uom','sell_uom','is_active'];
    FOREACH v_col IN ARRAY v_cols LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'wms' AND table_name = 'wms_items_cache' AND column_name = v_col
        ) THEN
            RAISE EXCEPTION 'FAIL: column wms.wms_items_cache.% does not exist', v_col;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS: all wms_items_cache new columns exist';
END $$;


-- ============================================================================
-- Test 2: sync_status CHECK constraint
-- ============================================================================
\echo '[Test 2] sync_status CHECK constraint rejects invalid values'

DO $$
BEGIN
    UPDATE oms.orders SET sync_status = 'invalid_status'
        WHERE company_code = 'TEST_DECOUPLE' AND doc_number = 'DECOUPLE-WO-001';
    RAISE EXCEPTION 'FAIL: invalid sync_status was accepted';
EXCEPTION
    WHEN check_violation THEN
        RAISE NOTICE 'PASS: sync_status CHECK constraint works';
END $$;


-- ============================================================================
-- Test 3: Sovereignty trigger — SAP sync does NOT overwrite WMS fields
-- ============================================================================
\echo '[Test 3] Sovereignty trigger protects WMS fields during SAP sync'

DO $$
DECLARE
    v_order_id INT;
    v_actual DECIMAL;
    v_picked DECIMAL;
    v_status TEXT;
    v_wms_ts TIMESTAMPTZ;
BEGIN
    SELECT id INTO v_order_id FROM oms.orders
        WHERE company_code = 'TEST_DECOUPLE' AND doc_number = 'DECOUPLE-WO-001';

    -- Simulate SAP sync: change sap_update_date (triggers sovereignty protection)
    UPDATE oms.order_lines SET
        sap_update_date = '2026-02-01',
        sap_update_time = '12:00:00',
        quantity = 60,
        open_quantity = 40,
        -- Attempt to overwrite WMS fields (should be blocked by trigger)
        wms_actual_qty = 999,
        picked_qty = 888,
        status = 'completed'
    WHERE order_id = v_order_id AND line_num = 1;

    -- Verify WMS fields preserved
    SELECT wms_actual_qty, picked_qty, status, wms_updated_at
    INTO v_actual, v_picked, v_status, v_wms_ts
    FROM oms.order_lines WHERE order_id = v_order_id AND line_num = 1;

    IF v_actual != 10 THEN
        RAISE EXCEPTION 'FAIL: wms_actual_qty was overwritten (got %, expected 10)', v_actual;
    END IF;
    IF v_picked != 5 THEN
        RAISE EXCEPTION 'FAIL: picked_qty was overwritten (got %, expected 5)', v_picked;
    END IF;
    IF v_status != 'partial' THEN
        RAISE EXCEPTION 'FAIL: status was overwritten (got %, expected partial)', v_status;
    END IF;

    -- SAP fields should have been updated
    IF NOT EXISTS (
        SELECT 1 FROM oms.order_lines
        WHERE order_id = v_order_id AND line_num = 1
          AND quantity = 60 AND sap_update_date = '2026-02-01'
    ) THEN
        RAISE EXCEPTION 'FAIL: SAP fields were not updated';
    END IF;

    RAISE NOTICE 'PASS: sovereignty trigger protects WMS fields';
END $$;


-- ============================================================================
-- Test 4: wms_updated_at auto-updates on WMS field change
-- ============================================================================
\echo '[Test 4] wms_updated_at auto-updates when WMS fields change'

DO $$
DECLARE
    v_order_id INT;
    v_ts_before TIMESTAMPTZ;
    v_ts_after TIMESTAMPTZ;
BEGIN
    SELECT id INTO v_order_id FROM oms.orders
        WHERE company_code = 'TEST_DECOUPLE' AND doc_number = 'DECOUPLE-WO-001';

    SELECT wms_updated_at INTO v_ts_before
    FROM oms.order_lines WHERE order_id = v_order_id AND line_num = 1;

    -- Change WMS field (NOT sap_update_date, so sovereignty trigger won't fire)
    UPDATE oms.order_lines SET wms_actual_qty = 15
    WHERE order_id = v_order_id AND line_num = 1;

    SELECT wms_updated_at INTO v_ts_after
    FROM oms.order_lines WHERE order_id = v_order_id AND line_num = 1;

    IF v_ts_after IS NULL THEN
        RAISE EXCEPTION 'FAIL: wms_updated_at was not set';
    END IF;
    IF v_ts_before IS NOT DISTINCT FROM v_ts_after THEN
        RAISE EXCEPTION 'FAIL: wms_updated_at was not updated';
    END IF;

    RAISE NOTICE 'PASS: wms_updated_at auto-updates (% → %)', v_ts_before, v_ts_after;
END $$;


-- ============================================================================
-- Test 5: uom_snapshot freezes after first set
-- ============================================================================
\echo '[Test 5] uom_snapshot freezes after first write'

DO $$
DECLARE
    v_order_id INT;
    v_snap TEXT;
BEGIN
    SELECT id INTO v_order_id FROM oms.orders
        WHERE company_code = 'TEST_DECOUPLE' AND doc_number = 'DECOUPLE-WO-001';

    -- First check: uom_snapshot should have been set by sovereignty trigger in Test 3
    SELECT uom_snapshot INTO v_snap
    FROM oms.order_lines WHERE order_id = v_order_id AND line_num = 1;

    IF v_snap IS NULL THEN
        RAISE EXCEPTION 'FAIL: uom_snapshot was not set on first SAP sync';
    END IF;

    -- Second SAP sync with different UOM should NOT change uom_snapshot
    UPDATE oms.order_lines SET
        sap_update_date = '2026-03-01',
        sap_update_time = '08:00:00',
        uom = 'KG'
    WHERE order_id = v_order_id AND line_num = 1;

    SELECT uom_snapshot INTO v_snap
    FROM oms.order_lines WHERE order_id = v_order_id AND line_num = 1;

    IF v_snap = 'KG' THEN
        RAISE EXCEPTION 'FAIL: uom_snapshot was overwritten to KG (should be frozen)';
    END IF;

    RAISE NOTICE 'PASS: uom_snapshot frozen at "%"', v_snap;
END $$;


-- ============================================================================
-- Test 6: wms_alerts table and RLS
-- ============================================================================
\echo '[Test 6] wms_alerts table exists and accepts inserts'

DO $$
BEGIN
    INSERT INTO oms.wms_alerts (company_code, alert_type, severity, source, message)
    VALUES ('TEST_DECOUPLE', 'TEST_ALERT', 'info', 'test', 'Test alert message');

    IF NOT EXISTS (
        SELECT 1 FROM oms.wms_alerts
        WHERE company_code = 'TEST_DECOUPLE' AND alert_type = 'TEST_ALERT'
    ) THEN
        RAISE EXCEPTION 'FAIL: wms_alerts insert did not persist';
    END IF;

    RAISE NOTICE 'PASS: wms_alerts table works';
END $$;


-- ============================================================================
-- Test 7: orders wms_updated_at trigger
-- ============================================================================
\echo '[Test 7] orders.wms_updated_at auto-updates on oms_status change'

DO $$
DECLARE
    v_ts TIMESTAMPTZ;
BEGIN
    -- Change oms_status from pending to in_progress
    UPDATE oms.orders SET oms_status = 'in_progress', execution_state = 'executing'
    WHERE company_code = 'TEST_DECOUPLE' AND doc_number = 'DECOUPLE-WO-001';

    SELECT wms_updated_at INTO v_ts FROM oms.orders
    WHERE company_code = 'TEST_DECOUPLE' AND doc_number = 'DECOUPLE-WO-001';

    IF v_ts IS NULL THEN
        RAISE EXCEPTION 'FAIL: orders.wms_updated_at was not set after oms_status change';
    END IF;

    RAISE NOTICE 'PASS: orders.wms_updated_at set to %', v_ts;
END $$;


-- ============================================================================
-- Test 8: Indexes exist
-- ============================================================================
\echo '[Test 8] Required indexes exist'

DO $$
DECLARE
    v_idxs TEXT[];
    v_idx TEXT;
BEGIN
    v_idxs := ARRAY[
        'idx_oms_orders_cc_type_sapdocnum',
        'idx_oms_orders_sync_status',
        'idx_oms_lines_cc_orderid'
    ];
    FOREACH v_idx IN ARRAY v_idxs LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = v_idx
        ) THEN
            RAISE EXCEPTION 'FAIL: index % does not exist', v_idx;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS: all required indexes exist';
END $$;


-- ============================================================================
-- Test 9: UOM audit trigger on wms_items_cache
-- ============================================================================
\echo '[Test 9] UOM change audit trigger fires'

DO $$
BEGIN
    -- Insert test item with inventory_uom
    INSERT INTO wms.wms_items_cache (company_code, item_code, item_name, uom, man_batch_num, inventory_uom)
    VALUES ('TEST_DECOUPLE', 'UOM-TEST-001', 'UOM Test Item', 'PC', 'N', 'PC')
    ON CONFLICT (company_code, item_code) DO UPDATE SET inventory_uom = 'PC';

    -- Change inventory_uom → should fire audit trigger
    UPDATE wms.wms_items_cache SET inventory_uom = 'KG'
    WHERE company_code = 'TEST_DECOUPLE' AND item_code = 'UOM-TEST-001';

    IF NOT EXISTS (
        SELECT 1 FROM oms.wms_alerts
        WHERE company_code = 'TEST_DECOUPLE'
          AND alert_type = 'UOM_CHANGED'
          AND context->>'item_code' = 'UOM-TEST-001'
    ) THEN
        RAISE EXCEPTION 'FAIL: UOM change audit alert was not created';
    END IF;

    RAISE NOTICE 'PASS: UOM change audit trigger fires correctly';
END $$;


-- ============================================================================
-- 清理测试数据
-- ============================================================================
\echo '[清理] 删除测试数据...'

DELETE FROM oms.wms_alerts WHERE company_code = 'TEST_DECOUPLE';
DELETE FROM oms.order_lines WHERE company_code = 'TEST_DECOUPLE';
DELETE FROM oms.orders WHERE company_code = 'TEST_DECOUPLE';
DELETE FROM wms.wms_items_cache WHERE company_code = 'TEST_DECOUPLE';

\echo '============================================================'
\echo '  17_wms_decouple_sap 行为测试完成 ✓'
\echo '============================================================'
