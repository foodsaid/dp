-- ============================================================================
-- DP v0.1.15 — 视图聚合行为测试: v_document_summary / v_pending_export / v_daily_activity
-- 验证: SUM / COUNT / GROUP BY / WHERE 过滤 的业务聚合逻辑
-- 执行方式: BEGIN → INSERT 脏数据 → SELECT 视图断言 → ROLLBACK (零污染)
-- 在 CI pg-schema-test Job 中执行
-- ============================================================================

-- 整体包裹在事务中，测试结束 ROLLBACK，绝不弄脏数据库
BEGIN;

SET search_path TO wms, public;


-- ============================================================================
-- 测试 A1: v_document_summary — 正确聚合行数与数量
-- 期望: line_count=2, total_planned=30, total_actual=18, completion_pct=60.0
-- ============================================================================

-- 插入测试单据头
INSERT INTO wms.wms_documents
  (company_code, doc_type, doc_number, created_by)
VALUES
  ('VIEWTEST', 'SO', 'VTEST-A1-001', 'ci_view_test');

-- 插入两行明细 (planned=10+20=30, actual=8+10=18)
INSERT INTO wms.wms_document_lines
  (document_id, line_num, item_code, planned_qty, actual_qty)
VALUES
  ((SELECT id FROM wms.wms_documents WHERE doc_number = 'VTEST-A1-001'), 1, 'ITEM-VA1', 10, 8),
  ((SELECT id FROM wms.wms_documents WHERE doc_number = 'VTEST-A1-001'), 2, 'ITEM-VA2', 20, 10);

DO $$
DECLARE
  v_line_count INT;
  v_total_planned DECIMAL;
  v_total_actual DECIMAL;
  v_completion DECIMAL;
BEGIN
  SELECT line_count, total_planned, total_actual, completion_pct
  INTO v_line_count, v_total_planned, v_total_actual, v_completion
  FROM wms.v_document_summary
  WHERE doc_number = 'VTEST-A1-001';

  IF v_line_count = 2
     AND v_total_planned = 30
     AND v_total_actual = 18
     AND v_completion = 60.0
  THEN
    RAISE NOTICE 'PASS [A1]: v_document_summary 聚合正确 — 行数=%, 计划=%, 实际=%, 完成率=%',
      v_line_count, v_total_planned, v_total_actual, v_completion;
  ELSE
    RAISE EXCEPTION 'FAIL [A1]: v_document_summary 聚合错误 — 行数=% (期望2), 计划=% (期望30), 实际=% (期望18), 完成率=% (期望60.0)',
      v_line_count, v_total_planned, v_total_actual, v_completion;
  END IF;
END $$;


-- ============================================================================
-- 测试 A2: v_document_summary — 无明细行时 line_count=0, 数量=0, 完成率=0
-- (LEFT JOIN 保证空单据仍可查到)
-- ============================================================================

INSERT INTO wms.wms_documents
  (company_code, doc_type, doc_number, created_by)
VALUES
  ('VIEWTEST', 'WO', 'VTEST-A2-EMPTY', 'ci_view_test');

DO $$
DECLARE
  v_line_count INT;
  v_total_planned DECIMAL;
  v_total_actual DECIMAL;
  v_completion DECIMAL;
BEGIN
  SELECT line_count, total_planned, total_actual, completion_pct
  INTO v_line_count, v_total_planned, v_total_actual, v_completion
  FROM wms.v_document_summary
  WHERE doc_number = 'VTEST-A2-EMPTY';

  IF v_line_count = 0
     AND v_total_planned = 0
     AND v_total_actual = 0
     AND v_completion = 0
  THEN
    RAISE NOTICE 'PASS [A2]: v_document_summary 空单据 — 行数=0, 计划=0, 实际=0, 完成率=0 (LEFT JOIN 正确)';
  ELSE
    RAISE EXCEPTION 'FAIL [A2]: 空单据聚合错误 — 行数=% (期望0), 计划=% (期望0), 实际=% (期望0), 完成率=% (期望0)',
      v_line_count, v_total_planned, v_total_actual, v_completion;
  END IF;
END $$;


-- ============================================================================
-- 测试 A3: v_document_summary — planned_qty 全为 0 时完成率 = 0 (除零防护)
-- ============================================================================

INSERT INTO wms.wms_documents
  (company_code, doc_type, doc_number, created_by)
VALUES
  ('VIEWTEST', 'IC', 'VTEST-A3-ZERO', 'ci_view_test');

INSERT INTO wms.wms_document_lines
  (document_id, line_num, item_code, planned_qty, actual_qty)
VALUES
  ((SELECT id FROM wms.wms_documents WHERE doc_number = 'VTEST-A3-ZERO'), 1, 'ITEM-VA3', 0, 5);

DO $$
DECLARE
  v_completion DECIMAL;
  v_total_actual DECIMAL;
BEGIN
  SELECT completion_pct, total_actual
  INTO v_completion, v_total_actual
  FROM wms.v_document_summary
  WHERE doc_number = 'VTEST-A3-ZERO';

  IF v_completion = 0 AND v_total_actual = 5 THEN
    RAISE NOTICE 'PASS [A3]: v_document_summary 除零防护 — planned=0 时完成率=0, actual=% 保留', v_total_actual;
  ELSE
    RAISE EXCEPTION 'FAIL [A3]: 除零防护失败 — 完成率=% (期望0), actual=% (期望5)',
      v_completion, v_total_actual;
  END IF;
END $$;


-- ============================================================================
-- 测试 A4: v_document_summary — 多单据独立聚合 (不跨单据累加)
-- ============================================================================

INSERT INTO wms.wms_documents
  (company_code, doc_type, doc_number, created_by)
VALUES
  ('VIEWTEST', 'PO', 'VTEST-A4-DOC1', 'ci_view_test'),
  ('VIEWTEST', 'PO', 'VTEST-A4-DOC2', 'ci_view_test');

INSERT INTO wms.wms_document_lines
  (document_id, line_num, item_code, planned_qty, actual_qty)
VALUES
  ((SELECT id FROM wms.wms_documents WHERE doc_number = 'VTEST-A4-DOC1'), 1, 'ITEM-D1', 100, 50),
  ((SELECT id FROM wms.wms_documents WHERE doc_number = 'VTEST-A4-DOC2'), 1, 'ITEM-D2', 200, 200);

DO $$
DECLARE
  v_planned1 DECIMAL;
  v_planned2 DECIMAL;
  v_pct1 DECIMAL;
  v_pct2 DECIMAL;
BEGIN
  SELECT total_planned, completion_pct INTO v_planned1, v_pct1
  FROM wms.v_document_summary WHERE doc_number = 'VTEST-A4-DOC1';

  SELECT total_planned, completion_pct INTO v_planned2, v_pct2
  FROM wms.v_document_summary WHERE doc_number = 'VTEST-A4-DOC2';

  IF v_planned1 = 100 AND v_pct1 = 50.0
     AND v_planned2 = 200 AND v_pct2 = 100.0
  THEN
    RAISE NOTICE 'PASS [A4]: 多单据独立聚合 — DOC1(计划=100,完成率=50%%), DOC2(计划=200,完成率=100%%)';
  ELSE
    RAISE EXCEPTION 'FAIL [A4]: 跨单据污染 — DOC1(计划=%, 完成率=%), DOC2(计划=%, 完成率=%)',
      v_planned1, v_pct1, v_planned2, v_pct2;
  END IF;
END $$;


-- ============================================================================
-- 测试 B1: v_pending_export — 精准过滤: 只显示 wms_status=completed 且未导出
-- ============================================================================

-- 已完成未导出 → 应出现
INSERT INTO wms.wms_documents
  (company_code, doc_type, doc_number, wms_status, exported_at, created_by)
VALUES
  ('VIEWTEST', 'SO', 'VTEST-B1-PEND', 'completed', NULL, 'ci_view_test');

INSERT INTO wms.wms_document_lines
  (document_id, line_num, item_code, actual_qty)
VALUES
  ((SELECT id FROM wms.wms_documents WHERE doc_number = 'VTEST-B1-PEND'), 1, 'ITEM-B1', 15);

-- 已完成已导出 → 应排除
INSERT INTO wms.wms_documents
  (company_code, doc_type, doc_number, wms_status, exported_at, created_by)
VALUES
  ('VIEWTEST', 'SO', 'VTEST-B1-DONE', 'completed', NOW(), 'ci_view_test');

INSERT INTO wms.wms_document_lines
  (document_id, line_num, item_code, actual_qty)
VALUES
  ((SELECT id FROM wms.wms_documents WHERE doc_number = 'VTEST-B1-DONE'), 1, 'ITEM-B1X', 99);

-- 未完成未导出 → 应排除
INSERT INTO wms.wms_documents
  (company_code, doc_type, doc_number, wms_status, exported_at, created_by)
VALUES
  ('VIEWTEST', 'SO', 'VTEST-B1-PROG', 'in_progress', NULL, 'ci_view_test');

INSERT INTO wms.wms_document_lines
  (document_id, line_num, item_code, actual_qty)
VALUES
  ((SELECT id FROM wms.wms_documents WHERE doc_number = 'VTEST-B1-PROG'), 1, 'ITEM-B1Y', 77);

DO $$
DECLARE
  v_count INT;
  v_doc VARCHAR;
  v_qty DECIMAL;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM wms.v_pending_export
  WHERE doc_number LIKE 'VTEST-B1-%';

  SELECT doc_number, total_qty INTO v_doc, v_qty
  FROM wms.v_pending_export
  WHERE doc_number LIKE 'VTEST-B1-%';

  IF v_count = 1 AND v_doc = 'VTEST-B1-PEND' AND v_qty = 15 THEN
    RAISE NOTICE 'PASS [B1]: v_pending_export 过滤正确 — 仅 completed+未导出 (doc=%, qty=%)', v_doc, v_qty;
  ELSE
    RAISE EXCEPTION 'FAIL [B1]: v_pending_export 过滤错误 — count=% (期望1), doc=% (期望VTEST-B1-PEND), qty=% (期望15)',
      v_count, v_doc, v_qty;
  END IF;
END $$;


-- ============================================================================
-- 测试 B2: v_pending_export — 无明细行的 completed 单据不出现 (INNER JOIN)
-- ============================================================================

INSERT INTO wms.wms_documents
  (company_code, doc_type, doc_number, wms_status, exported_at, created_by)
VALUES
  ('VIEWTEST', 'TR', 'VTEST-B2-NOLINE', 'completed', NULL, 'ci_view_test');

DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM wms.v_pending_export
  WHERE doc_number = 'VTEST-B2-NOLINE';

  IF v_count = 0 THEN
    RAISE NOTICE 'PASS [B2]: v_pending_export INNER JOIN — 无明细行的 completed 单据正确排除';
  ELSE
    RAISE EXCEPTION 'FAIL [B2]: 无明细行单据不应出现在 v_pending_export 中 (count=%)', v_count;
  END IF;
END $$;


-- ============================================================================
-- 测试 B3: v_pending_export — 多行聚合 (line_count + total_qty)
-- ============================================================================

INSERT INTO wms.wms_documents
  (company_code, doc_type, doc_number, wms_status, exported_at, created_by)
VALUES
  ('VIEWTEST', 'PO', 'VTEST-B3-MULTI', 'completed', NULL, 'ci_view_test');

INSERT INTO wms.wms_document_lines
  (document_id, line_num, item_code, actual_qty)
VALUES
  ((SELECT id FROM wms.wms_documents WHERE doc_number = 'VTEST-B3-MULTI'), 1, 'ITEM-B3A', 10),
  ((SELECT id FROM wms.wms_documents WHERE doc_number = 'VTEST-B3-MULTI'), 2, 'ITEM-B3B', 25),
  ((SELECT id FROM wms.wms_documents WHERE doc_number = 'VTEST-B3-MULTI'), 3, 'ITEM-B3C', 5);

DO $$
DECLARE
  v_line_count INT;
  v_total_qty DECIMAL;
BEGIN
  SELECT line_count, total_qty INTO v_line_count, v_total_qty
  FROM wms.v_pending_export
  WHERE doc_number = 'VTEST-B3-MULTI';

  IF v_line_count = 3 AND v_total_qty = 40 THEN
    RAISE NOTICE 'PASS [B3]: v_pending_export 多行聚合 — line_count=3, total_qty=40 (10+25+5)';
  ELSE
    RAISE EXCEPTION 'FAIL [B3]: v_pending_export 多行聚合错误 — line_count=% (期望3), total_qty=% (期望40)',
      v_line_count, v_total_qty;
  END IF;
END $$;


-- ============================================================================
-- 测试 C1: v_daily_activity — 按日期 + action + doc_type 精准 GROUP BY
-- ============================================================================

-- 准备单据 (事务表需要 document_id FK)
INSERT INTO wms.wms_documents
  (company_code, doc_type, doc_number, created_by)
VALUES
  ('VIEWTEST', 'SO', 'VTEST-C1-SO', 'ci_view_test'),
  ('VIEWTEST', 'PO', 'VTEST-C1-PO', 'ci_view_test');

-- 今天: SO 单据 2 笔 scan 事务 (数量 5+10=15)
INSERT INTO wms.wms_transactions
  (company_code, document_id, action, item_code, quantity, performed_by, transaction_time)
VALUES
  ('VIEWTEST',
   (SELECT id FROM wms.wms_documents WHERE doc_number = 'VTEST-C1-SO'),
   'scan', 'ITEM-C1A', 5, 'ci_view_test', CURRENT_TIMESTAMP),
  ('VIEWTEST',
   (SELECT id FROM wms.wms_documents WHERE doc_number = 'VTEST-C1-SO'),
   'scan', 'ITEM-C1B', 10, 'ci_view_test', CURRENT_TIMESTAMP);

-- 今天: PO 单据 1 笔 receipt 事务 (数量 20)
INSERT INTO wms.wms_transactions
  (company_code, document_id, action, item_code, quantity, performed_by, transaction_time)
VALUES
  ('VIEWTEST',
   (SELECT id FROM wms.wms_documents WHERE doc_number = 'VTEST-C1-PO'),
   'receipt', 'ITEM-C1C', 20, 'ci_view_test', CURRENT_TIMESTAMP);

DO $$
DECLARE
  v_scan_count INT;
  v_scan_qty DECIMAL;
  v_scan_docs INT;
  v_receipt_count INT;
  v_receipt_qty DECIMAL;
BEGIN
  -- SO/scan 分组
  SELECT transaction_count, total_quantity, document_count
  INTO v_scan_count, v_scan_qty, v_scan_docs
  FROM wms.v_daily_activity
  WHERE company_code = 'VIEWTEST'
    AND activity_date = CURRENT_DATE
    AND action = 'scan'
    AND doc_type = 'SO';

  -- PO/receipt 分组
  SELECT transaction_count, total_quantity
  INTO v_receipt_count, v_receipt_qty
  FROM wms.v_daily_activity
  WHERE company_code = 'VIEWTEST'
    AND activity_date = CURRENT_DATE
    AND action = 'receipt'
    AND doc_type = 'PO';

  IF v_scan_count = 2 AND v_scan_qty = 15 AND v_scan_docs = 1
     AND v_receipt_count = 1 AND v_receipt_qty = 20
  THEN
    RAISE NOTICE 'PASS [C1]: v_daily_activity GROUP BY 正确 — SO/scan(次数=2, 数量=15, 单据=1), PO/receipt(次数=1, 数量=20)';
  ELSE
    RAISE EXCEPTION 'FAIL [C1]: v_daily_activity GROUP BY 错误 — scan(次数=%, 数量=%, 单据=%), receipt(次数=%, 数量=%)',
      v_scan_count, v_scan_qty, v_scan_docs, v_receipt_count, v_receipt_qty;
  END IF;
END $$;


-- ============================================================================
-- 测试 C2: v_daily_activity — 不同日期不混淆 (昨天 vs 今天)
-- ============================================================================

-- 昨天: 同一 SO 单据 1 笔 scan 事务 (数量 99)
INSERT INTO wms.wms_transactions
  (company_code, document_id, action, item_code, quantity, performed_by, transaction_time)
VALUES
  ('VIEWTEST',
   (SELECT id FROM wms.wms_documents WHERE doc_number = 'VTEST-C1-SO'),
   'scan', 'ITEM-C2', 99, 'ci_view_test', CURRENT_TIMESTAMP - INTERVAL '1 day');

DO $$
DECLARE
  v_today_qty DECIMAL;
  v_yesterday_qty DECIMAL;
BEGIN
  SELECT total_quantity INTO v_today_qty
  FROM wms.v_daily_activity
  WHERE company_code = 'VIEWTEST'
    AND activity_date = CURRENT_DATE
    AND action = 'scan'
    AND doc_type = 'SO';

  SELECT total_quantity INTO v_yesterday_qty
  FROM wms.v_daily_activity
  WHERE company_code = 'VIEWTEST'
    AND activity_date = CURRENT_DATE - 1
    AND action = 'scan'
    AND doc_type = 'SO';

  -- 今天仍是 15 (不受昨天 99 影响), 昨天独立为 99
  IF v_today_qty = 15 AND v_yesterday_qty = 99 THEN
    RAISE NOTICE 'PASS [C2]: v_daily_activity 日期隔离 — 今天=15, 昨天=99 (互不干扰)';
  ELSE
    RAISE EXCEPTION 'FAIL [C2]: 日期隔离失败 — 今天=% (期望15), 昨天=% (期望99)',
      v_today_qty, v_yesterday_qty;
  END IF;
END $$;


-- ============================================================================
-- 测试 C3: v_daily_activity — 多租户隔离 (不同 company_code 不混淆)
-- ============================================================================

INSERT INTO wms.wms_documents
  (company_code, doc_type, doc_number, created_by)
VALUES
  ('VIEWTEST2', 'SO', 'VTEST-C3-OTHER', 'ci_view_test');

INSERT INTO wms.wms_transactions
  (company_code, document_id, action, item_code, quantity, performed_by, transaction_time)
VALUES
  ('VIEWTEST2',
   (SELECT id FROM wms.wms_documents WHERE doc_number = 'VTEST-C3-OTHER'),
   'scan', 'ITEM-C3', 888, 'ci_view_test', CURRENT_TIMESTAMP);

DO $$
DECLARE
  v_qty1 DECIMAL;
  v_qty2 DECIMAL;
BEGIN
  SELECT total_quantity INTO v_qty1
  FROM wms.v_daily_activity
  WHERE company_code = 'VIEWTEST'
    AND activity_date = CURRENT_DATE
    AND action = 'scan'
    AND doc_type = 'SO';

  SELECT total_quantity INTO v_qty2
  FROM wms.v_daily_activity
  WHERE company_code = 'VIEWTEST2'
    AND activity_date = CURRENT_DATE
    AND action = 'scan'
    AND doc_type = 'SO';

  -- VIEWTEST 仍然是 15, VIEWTEST2 独立为 888
  IF v_qty1 = 15 AND v_qty2 = 888 THEN
    RAISE NOTICE 'PASS [C3]: v_daily_activity 多租户隔离 — VIEWTEST=15, VIEWTEST2=888 (不交叉)';
  ELSE
    RAISE EXCEPTION 'FAIL [C3]: 租户隔离泄漏 — VIEWTEST=% (期望15), VIEWTEST2=% (期望888)',
      v_qty1, v_qty2;
  END IF;
END $$;


-- ============================================================================
-- 测试 C4: v_daily_activity — document_count 去重 (同单据多事务只计 1 个)
-- ============================================================================

DO $$
DECLARE
  v_doc_count INT;
  v_tx_count INT;
BEGIN
  SELECT document_count, transaction_count INTO v_doc_count, v_tx_count
  FROM wms.v_daily_activity
  WHERE company_code = 'VIEWTEST'
    AND activity_date = CURRENT_DATE
    AND action = 'scan'
    AND doc_type = 'SO';

  -- 同一 SO 单据 VTEST-C1-SO 产生了 2 笔 scan 事务
  -- transaction_count=2, 但 document_count 应该=1 (DISTINCT)
  IF v_doc_count = 1 AND v_tx_count = 2 THEN
    RAISE NOTICE 'PASS [C4]: v_daily_activity document_count 去重正确 — 事务=%, 去重单据=%', v_tx_count, v_doc_count;
  ELSE
    RAISE EXCEPTION 'FAIL [C4]: document_count 去重失败 — 事务=% (期望2), 去重单据=% (期望1)',
      v_tx_count, v_doc_count;
  END IF;
END $$;


-- ============================================================================
-- 收尾: ROLLBACK 销毁所有测试数据 (零污染)
-- ============================================================================

ROLLBACK;

SELECT '✓ 视图聚合行为测试全部通过: 10 项 (v_document_summary ×4 + v_pending_export ×3 + v_daily_activity ×3)' AS status;
