-- ============================================================================
-- DP v0.1 — WMS Schema 完整建表 (PostgreSQL 17)
-- WMS 核心表 (PostgreSQL 17)
-- 含: 11 表 + 4 视图 + company_code 防错 (CHECK + 触发器) + 审计日志
-- ============================================================================

SET search_path TO wms, public;

-- ============================================================================
-- 通用: updated_at 自动更新触发器函数
-- (PostgreSQL 没有 ON UPDATE CURRENT_TIMESTAMP，用触发器代替)
-- ============================================================================

CREATE OR REPLACE FUNCTION wms.fn_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 通用: company_code 非空防错触发器
-- 即使 n8n 工作流漏加 Company Filter，数据库层直接报错
-- ============================================================================

CREATE OR REPLACE FUNCTION wms.fn_enforce_company_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.company_code IS NULL OR TRIM(NEW.company_code) = '' THEN
        RAISE EXCEPTION 'company_code cannot be empty (table: %, operation: %)',
            TG_TABLE_NAME, TG_OP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 1. wms_documents — 统一单据头 (7 种单据类型)
-- ============================================================================

CREATE TABLE wms.wms_documents (
    id SERIAL PRIMARY KEY,
    company_code VARCHAR(20) NOT NULL
        CHECK (TRIM(company_code) <> ''),

    doc_type VARCHAR(5) NOT NULL
        CHECK (doc_type IN ('SO','WO','PO','TR','IC','LM','PI','DD')),
        -- SO=销售拣货, WO=生产收货, PO=采购收货, TR=调拨, IC=盘点, LM=移库, PI=生产领料, DD=配送单
    doc_number VARCHAR(50) NOT NULL,
    sap_doc_num VARCHAR(50),
    sap_doc_entry INT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','in_progress','completed','cancelled','exported')),
    wms_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (wms_status IN ('pending','in_progress','completed','exported','split')),
    priority VARCHAR(10) NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low','normal','high','urgent')),

    -- 业务伙伴
    business_partner VARCHAR(100),
    bp_name VARCHAR(200),

    -- 仓库
    warehouse_code VARCHAR(20),
    warehouse_name VARCHAR(100),

    -- 调拨 / 移库
    from_warehouse VARCHAR(20),
    to_warehouse VARCHAR(20),
    from_bin VARCHAR(50),
    to_bin VARCHAR(50),

    -- 日期
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    posting_date DATE,

    -- 用户追踪
    created_by VARCHAR(50) NOT NULL,
    updated_by VARCHAR(50),
    locked_by VARCHAR(50),
    locked_at TIMESTAMP,
    locked_session VARCHAR(50),
    remarks TEXT,

    -- SAP 导出追踪
    exported_at TIMESTAMP,
    export_batch VARCHAR(50),

    -- 时间戳
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_documents_company ON wms.wms_documents (company_code);
CREATE INDEX idx_documents_doc_type ON wms.wms_documents (doc_type);
CREATE INDEX idx_documents_doc_number ON wms.wms_documents (doc_number);
CREATE INDEX idx_documents_sap_doc_num ON wms.wms_documents (sap_doc_num);
CREATE INDEX idx_documents_status ON wms.wms_documents (status);
CREATE INDEX idx_documents_wms_status ON wms.wms_documents (wms_status);
CREATE INDEX idx_documents_doc_date ON wms.wms_documents (doc_date);
CREATE INDEX idx_documents_created_at ON wms.wms_documents (created_at);
CREATE UNIQUE INDEX idx_documents_type_number ON wms.wms_documents (company_code, doc_type, doc_number);
CREATE INDEX idx_documents_company_created ON wms.wms_documents (company_code, created_at);

-- updated_at 触发器
CREATE TRIGGER trg_documents_updated_at
    BEFORE UPDATE ON wms.wms_documents
    FOR EACH ROW EXECUTE FUNCTION wms.fn_updated_at();

-- company_code 防错触发器
CREATE TRIGGER trg_documents_enforce_cc
    BEFORE INSERT OR UPDATE ON wms.wms_documents
    FOR EACH ROW EXECUTE FUNCTION wms.fn_enforce_company_code();

COMMENT ON TABLE wms.wms_documents IS 'WMS 统一单据头';


-- ============================================================================
-- 2. wms_document_lines — 统一行项目
-- ============================================================================

CREATE TABLE wms.wms_document_lines (
    id SERIAL PRIMARY KEY,
    document_id INT NOT NULL REFERENCES wms.wms_documents(id) ON DELETE CASCADE,
    line_num INT NOT NULL DEFAULT 1,

    -- 物料信息
    item_code VARCHAR(50) NOT NULL,
    item_name VARCHAR(200),
    barcode VARCHAR(100),
    uom VARCHAR(20),

    -- 数量
    planned_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
    actual_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
    variance_qty DECIMAL(18,4) GENERATED ALWAYS AS (actual_qty - planned_qty) STORED,

    -- 仓库 / 库位
    warehouse_code VARCHAR(20),
    bin_location VARCHAR(50),
    from_warehouse VARCHAR(20),
    to_warehouse VARCHAR(20),
    from_bin VARCHAR(50),
    to_bin VARCHAR(50),

    -- 批次追踪
    batch_number VARCHAR(50),
    serial_number VARCHAR(50),
    production_date DATE,

    -- 行状态
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','partial','completed','cancelled')),
    wms_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (wms_status IN ('pending','partial','completed')),
    remarks TEXT,

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_lines_document_id ON wms.wms_document_lines (document_id);
CREATE INDEX idx_lines_item_code ON wms.wms_document_lines (item_code);
CREATE INDEX idx_lines_barcode ON wms.wms_document_lines (barcode);
CREATE INDEX idx_lines_status ON wms.wms_document_lines (status);
CREATE INDEX idx_lines_wms_status ON wms.wms_document_lines (wms_status);
CREATE UNIQUE INDEX idx_lines_doc_line ON wms.wms_document_lines (document_id, line_num);

CREATE TRIGGER trg_lines_updated_at
    BEFORE UPDATE ON wms.wms_document_lines
    FOR EACH ROW EXECUTE FUNCTION wms.fn_updated_at();

COMMENT ON TABLE wms.wms_document_lines IS 'WMS 统一行项目';


-- ============================================================================
-- 3. wms_transactions — 操作事务日志
-- ============================================================================

CREATE TABLE wms.wms_transactions (
    id SERIAL PRIMARY KEY,
    company_code VARCHAR(20) NOT NULL
        CHECK (TRIM(company_code) <> ''),
    document_id INT NOT NULL REFERENCES wms.wms_documents(id),
    line_id INT,

    -- 操作详情
    action VARCHAR(10) NOT NULL
        CHECK (action IN ('scan','receipt','count','move','adjust','confirm','export','cancel','issue','add')),
        -- scan=拣货, receipt=收货, count=盘点, move=移动, adjust=调整,
        -- confirm=确认, export=导出, cancel=取消, issue=领料, add=增量盘点
    item_code VARCHAR(50) NOT NULL,
    item_name VARCHAR(200),
    quantity DECIMAL(18,4) NOT NULL,

    -- 位置
    warehouse_code VARCHAR(20),
    from_warehouse VARCHAR(20),
    bin_location VARCHAR(50),
    from_bin VARCHAR(50),

    -- 用户
    performed_by VARCHAR(50) NOT NULL,
    device_id VARCHAR(50),

    -- 条码
    scanned_barcode VARCHAR(200),

    -- 批次追踪
    batch_number VARCHAR(100),
    production_date DATE,

    -- 过账状态
    posted_flag BOOLEAN NOT NULL DEFAULT FALSE,
    remarks TEXT,
    transaction_time TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_tx_company ON wms.wms_transactions (company_code);
CREATE INDEX idx_tx_document_id ON wms.wms_transactions (document_id);
CREATE INDEX idx_tx_action ON wms.wms_transactions (action);
CREATE INDEX idx_tx_item_code ON wms.wms_transactions (item_code);
CREATE INDEX idx_tx_performed_by ON wms.wms_transactions (performed_by);
CREATE INDEX idx_tx_transaction_time ON wms.wms_transactions (transaction_time);
CREATE INDEX idx_tx_posted ON wms.wms_transactions (posted_flag);
CREATE INDEX idx_tx_company_time ON wms.wms_transactions (company_code, transaction_time);
-- wf08 库存查询: 按物料+仓库联查未过账 delta
CREATE INDEX idx_tx_item_whs ON wms.wms_transactions (item_code, warehouse_code);
CREATE INDEX idx_tx_posted_item_whs ON wms.wms_transactions (posted_flag, company_code, item_code, warehouse_code)
    WHERE (posted_flag = FALSE OR posted_flag IS NULL);

CREATE TRIGGER trg_tx_enforce_cc
    BEFORE INSERT OR UPDATE ON wms.wms_transactions
    FOR EACH ROW EXECUTE FUNCTION wms.fn_enforce_company_code();

COMMENT ON TABLE wms.wms_transactions IS 'WMS 操作事务日志';


-- ============================================================================
-- 4. wms_stock_snapshot — SAP 库存快照 (每夜同步)
-- ============================================================================

CREATE TABLE wms.wms_stock_snapshot (
    id BIGSERIAL PRIMARY KEY,
    company_code VARCHAR(20) NOT NULL
        CHECK (TRIM(company_code) <> ''),
    snapshot_date DATE NOT NULL,

    -- 物料信息
    item_code VARCHAR(50) NOT NULL,
    item_name VARCHAR(200),
    foreign_name VARCHAR(200),
    item_group VARCHAR(100),
    uom VARCHAR(20),

    -- 仓库信息
    whs_code VARCHAR(20) NOT NULL,
    whs_name VARCHAR(100),
    bin_code VARCHAR(50) DEFAULT 'Default Bin',
    bin_enabled CHAR(1) NOT NULL DEFAULT 'N',

    -- 批次信息
    batch_managed CHAR(1) NOT NULL DEFAULT 'N',
    batch_number VARCHAR(100),
    mfr_batch VARCHAR(100),
    lot_number VARCHAR(100),
    mfr_date DATE,
    exp_date DATE,
    in_date DATE,

    -- 数量
    on_hand DECIMAL(18,4) NOT NULL DEFAULT 0,
    bin_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
    batch_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
    bin_max_level DECIMAL(18,4) NOT NULL DEFAULT 0,

    -- 价格
    avg_price DECIMAL(18,6) NOT NULL DEFAULT 0,
    stock_value DECIMAL(18,4) NOT NULL DEFAULT 0,

    -- SAP 汇总
    total_on_hand DECIMAL(18,4) NOT NULL DEFAULT 0,
    committed_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
    ordered_qty DECIMAL(18,4) NOT NULL DEFAULT 0,

    -- 时间戳
    synced_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_snap_company ON wms.wms_stock_snapshot (company_code);
CREATE INDEX idx_snap_date ON wms.wms_stock_snapshot (snapshot_date);
CREATE INDEX idx_snap_item ON wms.wms_stock_snapshot (item_code);
CREATE INDEX idx_snap_whs ON wms.wms_stock_snapshot (whs_code);
CREATE INDEX idx_snap_batch ON wms.wms_stock_snapshot (batch_number);
CREATE INDEX idx_snap_bin ON wms.wms_stock_snapshot (bin_code);
CREATE INDEX idx_snap_date_item ON wms.wms_stock_snapshot (snapshot_date, item_code);
CREATE INDEX idx_snap_date_item_whs ON wms.wms_stock_snapshot (snapshot_date, item_code, whs_code);
CREATE INDEX idx_snap_company_date ON wms.wms_stock_snapshot (company_code, snapshot_date);

CREATE TRIGGER trg_snap_enforce_cc
    BEFORE INSERT OR UPDATE ON wms.wms_stock_snapshot
    FOR EACH ROW EXECUTE FUNCTION wms.fn_enforce_company_code();

COMMENT ON TABLE wms.wms_stock_snapshot IS 'SAP 库存快照 — 每夜同步';


-- ============================================================================
-- 5. wms_items_cache — 主数据: 物料
-- ============================================================================

CREATE TABLE wms.wms_items_cache (
    item_code VARCHAR(50) NOT NULL PRIMARY KEY,
    item_name VARCHAR(200) NOT NULL DEFAULT '',
    uom VARCHAR(20) NOT NULL DEFAULT '',
    man_batch_num CHAR(1) NOT NULL DEFAULT 'N',
    synced_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_items_name ON wms.wms_items_cache (item_name);

CREATE TRIGGER trg_items_cache_updated_at
    BEFORE UPDATE ON wms.wms_items_cache
    FOR EACH ROW EXECUTE FUNCTION wms.fn_updated_at();

COMMENT ON TABLE wms.wms_items_cache IS '主数据 — 物料缓存';

-- 复用 fn_updated_at 但字段名是 synced_at，需要单独处理
-- 实际上 items_cache 用 synced_at 而非 updated_at，创建专用触发器
DROP TRIGGER IF EXISTS trg_items_cache_updated_at ON wms.wms_items_cache;

CREATE OR REPLACE FUNCTION wms.fn_synced_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.synced_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_items_cache_synced_at
    BEFORE UPDATE ON wms.wms_items_cache
    FOR EACH ROW EXECUTE FUNCTION wms.fn_synced_at();


-- ============================================================================
-- 6. wms_locations_cache — 主数据: 仓库
-- ============================================================================

CREATE TABLE wms.wms_locations_cache (
    whs_code VARCHAR(20) NOT NULL PRIMARY KEY,
    whs_name VARCHAR(100) NOT NULL DEFAULT '',
    synced_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_locations_cache_synced_at
    BEFORE UPDATE ON wms.wms_locations_cache
    FOR EACH ROW EXECUTE FUNCTION wms.fn_synced_at();

COMMENT ON TABLE wms.wms_locations_cache IS '主数据 — 仓库缓存';


-- ============================================================================
-- 7. wms_bins_cache — 主数据: 库位
-- ============================================================================

CREATE TABLE wms.wms_bins_cache (
    bin_code VARCHAR(50) NOT NULL PRIMARY KEY,
    bin_name VARCHAR(100) NOT NULL DEFAULT '',
    whs_code VARCHAR(20) NOT NULL DEFAULT '',
    whs_name VARCHAR(100) NOT NULL DEFAULT '',
    max_level INT NOT NULL DEFAULT 0,
    synced_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bins_whs ON wms.wms_bins_cache (whs_code);

CREATE TRIGGER trg_bins_cache_synced_at
    BEFORE UPDATE ON wms.wms_bins_cache
    FOR EACH ROW EXECUTE FUNCTION wms.fn_synced_at();

COMMENT ON TABLE wms.wms_bins_cache IS '主数据 — 库位缓存';


-- ============================================================================
-- 8. wms_users — 用户管理
-- DEPRECATED (v0.3.1): SSO 强制化后此表不再使用
-- 认证已迁移到 authelia.sso_users (argon2id 哈希)
-- 保留仅为向后兼容，计划在 v1.0 移除
-- ============================================================================

CREATE TABLE wms.wms_users (
    id SERIAL PRIMARY KEY,
    company_code VARCHAR(20) NOT NULL
        CHECK (TRIM(company_code) <> ''),
    username VARCHAR(50) NOT NULL,
    password VARCHAR(128) NOT NULL,
    display_name VARCHAR(100) NOT NULL DEFAULT '',
    role VARCHAR(20) NOT NULL DEFAULT 'operator'
        CHECK (role IN ('admin','operator','qm')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_users_username ON wms.wms_users (company_code, username);

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON wms.wms_users
    FOR EACH ROW EXECUTE FUNCTION wms.fn_updated_at();

CREATE TRIGGER trg_users_enforce_cc
    BEFORE INSERT OR UPDATE ON wms.wms_users
    FOR EACH ROW EXECUTE FUNCTION wms.fn_enforce_company_code();

COMMENT ON TABLE wms.wms_users IS 'WMS 用户';


-- ============================================================================
-- 9. wms_system_settings — 系统配置
-- ============================================================================

CREATE TABLE wms.wms_system_settings (
    setting_key VARCHAR(50) NOT NULL PRIMARY KEY,
    setting_value VARCHAR(200),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_settings_updated_at
    BEFORE UPDATE ON wms.wms_system_settings
    FOR EACH ROW EXECUTE FUNCTION wms.fn_updated_at();

COMMENT ON TABLE wms.wms_system_settings IS '系统配置';

-- 初始锚点 (昨天) — 首次 wf12 运行触发全量同步
INSERT INTO wms.wms_system_settings (setting_key, setting_value)
VALUES ('stock_snapshot_last_sap_update_date', TO_CHAR(CURRENT_DATE - INTERVAL '1 day', 'YYYY-MM-DD'))
ON CONFLICT (setting_key) DO NOTHING;


-- ============================================================================
-- 11. wms_id_sequences — 原子序列生成器
-- ============================================================================

CREATE TABLE wms.wms_id_sequences (
    seq_key VARCHAR(30) NOT NULL PRIMARY KEY,
    next_val INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_sequences_updated_at
    BEFORE UPDATE ON wms.wms_id_sequences
    FOR EACH ROW EXECUTE FUNCTION wms.fn_updated_at();

COMMENT ON TABLE wms.wms_id_sequences IS '原子序列生成器';


-- ============================================================================
-- 12. wms_audit_log — 审计日志 (新增)
-- ============================================================================

CREATE TABLE wms.wms_audit_log (
    id BIGSERIAL PRIMARY KEY,
    company_code VARCHAR(20) NOT NULL
        CHECK (TRIM(company_code) <> ''),
    table_name VARCHAR(50) NOT NULL,
    record_id INT NOT NULL,
    action VARCHAR(10) NOT NULL
        CHECK (action IN ('INSERT','UPDATE','DELETE')),
    field_name VARCHAR(50),
    old_value TEXT,
    new_value TEXT,
    performed_by VARCHAR(50) NOT NULL,
    sap_doc_ref VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_company ON wms.wms_audit_log (company_code);
CREATE INDEX idx_audit_table ON wms.wms_audit_log (table_name);
CREATE INDEX idx_audit_record ON wms.wms_audit_log (record_id);
CREATE INDEX idx_audit_time ON wms.wms_audit_log (created_at);
CREATE INDEX idx_audit_user ON wms.wms_audit_log (performed_by);
CREATE INDEX idx_audit_company_time ON wms.wms_audit_log (company_code, created_at);

CREATE TRIGGER trg_audit_enforce_cc
    BEFORE INSERT OR UPDATE ON wms.wms_audit_log
    FOR EACH ROW EXECUTE FUNCTION wms.fn_enforce_company_code();

-- 审计日志不可变性保护: 禁止 UPDATE 和 DELETE (只增不删不改)
CREATE OR REPLACE FUNCTION wms.fn_prevent_audit_log_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'WMS Audit log is append-only. UPDATE and DELETE are strictly forbidden.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_immutable
    BEFORE UPDATE OR DELETE ON wms.wms_audit_log
    FOR EACH ROW EXECUTE FUNCTION wms.fn_prevent_audit_log_tampering();

COMMENT ON TABLE wms.wms_audit_log IS '审计日志 — 数据变更追踪 (append-only, 禁止修改和删除)';


-- ============================================================================
-- 视图 1: v_document_summary — 单据汇总
-- ============================================================================

CREATE OR REPLACE VIEW wms.v_document_summary AS
SELECT
    d.id,
    d.company_code,
    d.doc_type,
    d.doc_number,
    d.sap_doc_num,
    d.status,
    d.wms_status,
    d.warehouse_code,
    d.business_partner,
    d.bp_name,
    d.created_by,
    d.doc_date,
    d.created_at,
    d.exported_at,
    COUNT(dl.id) AS line_count,
    COALESCE(SUM(dl.planned_qty), 0) AS total_planned,
    COALESCE(SUM(dl.actual_qty), 0) AS total_actual,
    CASE
        WHEN COALESCE(SUM(dl.planned_qty), 0) = 0 THEN 0
        ELSE ROUND(COALESCE(SUM(dl.actual_qty), 0) / SUM(dl.planned_qty) * 100, 1)
    END AS completion_pct
FROM wms.wms_documents d
LEFT JOIN wms.wms_document_lines dl ON d.id = dl.document_id
GROUP BY d.id;


-- ============================================================================
-- 视图 2: v_pending_export — 待导出单据
-- ============================================================================

CREATE OR REPLACE VIEW wms.v_pending_export AS
SELECT
    d.id,
    d.company_code,
    d.doc_type,
    d.doc_number,
    d.sap_doc_num,
    d.warehouse_code,
    d.business_partner,
    d.bp_name,
    d.doc_date,
    d.created_by,
    d.created_at,
    COUNT(dl.id) AS line_count,
    COALESCE(SUM(dl.actual_qty), 0) AS total_qty
FROM wms.wms_documents d
JOIN wms.wms_document_lines dl ON d.id = dl.document_id
WHERE d.wms_status = 'completed'
  AND d.exported_at IS NULL
GROUP BY d.id;


-- ============================================================================
-- 视图 3: v_daily_activity — 每日活动统计
-- ============================================================================

CREATE OR REPLACE VIEW wms.v_daily_activity AS
SELECT
    d.company_code,
    t.transaction_time::DATE AS activity_date,
    t.action,
    d.doc_type,
    COUNT(*) AS transaction_count,
    COUNT(DISTINCT t.document_id) AS document_count,
    COALESCE(SUM(t.quantity), 0) AS total_quantity
FROM wms.wms_transactions t
JOIN wms.wms_documents d ON t.document_id = d.id
GROUP BY d.company_code, t.transaction_time::DATE, t.action, d.doc_type;


-- ============================================================================
-- 视图 4: v_stock_realtime — 实时库存 (快照 + 未过账增量)
-- ============================================================================

CREATE OR REPLACE VIEW wms.v_stock_realtime AS
SELECT
    s.company_code,
    s.item_code,
    s.item_name,
    s.foreign_name,
    s.item_group,
    s.uom,
    s.whs_code,
    s.whs_name,
    s.bin_code,
    s.bin_enabled,
    s.batch_managed,
    s.batch_number,
    s.mfr_batch,
    s.lot_number,
    s.mfr_date,
    s.exp_date,
    s.in_date,
    s.on_hand AS snapshot_qty,
    s.bin_qty,
    s.batch_qty,
    s.avg_price,
    s.stock_value,
    s.total_on_hand,
    s.committed_qty,
    s.ordered_qty,
    s.snapshot_date,
    s.synced_at,

    -- 未过账入库合计 (收货 + 盘点正向调整)
    COALESCE(delta.in_qty, 0) AS today_in_qty,

    -- 未过账出库合计 (拣货 + 领料 + 移出)
    COALESCE(delta.out_qty, 0) AS today_out_qty,

    -- 净增量
    COALESCE(delta.in_qty, 0) - COALESCE(delta.out_qty, 0) AS today_delta,

    -- 实时库存 = 快照 + 未过账净增量
    s.on_hand + COALESCE(delta.in_qty, 0) - COALESCE(delta.out_qty, 0) AS realtime_qty

FROM wms.wms_stock_snapshot s

LEFT JOIN (
    SELECT
        t.company_code,
        t.item_code,
        t.warehouse_code,
        SUM(CASE WHEN t.action IN ('receipt', 'count') THEN t.quantity ELSE 0 END) AS in_qty,
        SUM(CASE WHEN t.action IN ('scan', 'issue', 'move') THEN t.quantity ELSE 0 END) AS out_qty
    FROM wms.wms_transactions t
    WHERE t.posted_flag = FALSE
    GROUP BY t.company_code, t.item_code, t.warehouse_code
) delta ON s.company_code = delta.company_code
       AND s.item_code = delta.item_code
       AND s.whs_code = delta.warehouse_code

-- 每个租户取各自最新快照日期 (防止跨租户日期不同导致数据丢失)
WHERE s.snapshot_date = (
    SELECT MAX(s2.snapshot_date)
    FROM wms.wms_stock_snapshot s2
    WHERE s2.company_code = s.company_code
);


-- ============================================================================
-- AI 预留: 向量表模板
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai.ai_embeddings (
    id BIGSERIAL PRIMARY KEY,
    company_code VARCHAR(20) NOT NULL
        CHECK (TRIM(company_code) <> ''),
    source_type VARCHAR(30) NOT NULL,
    source_id VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536),
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_company ON ai.ai_embeddings (company_code);
CREATE INDEX idx_ai_source ON ai.ai_embeddings (source_type, source_id);

COMMENT ON TABLE ai.ai_embeddings IS 'AI 向量嵌入 — RAG 检索预留';


-- ============================================================================
-- 验证
-- ============================================================================

SELECT '✓ DP WMS Schema 创建完成: 11 表 + 4 视图 + AI 预留表' AS status;
