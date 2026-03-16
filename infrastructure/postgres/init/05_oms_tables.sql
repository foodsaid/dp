-- ============================================================================
-- DP v0.2.0 — OMS Schema 完整建表 (PostgreSQL 17)
-- 订单管理系统: SAP 订单缓存 + DD 拆单 + 事件溯源预埋 + 审计日志
-- 含: P1 核心 4 表 + 2 视图 + 5 触发器 + Feature Flags
-- ============================================================================

-- ============================================================================
-- OMS Schema 创建 + 授权
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS oms;
COMMENT ON SCHEMA oms IS 'OMS 订单管理系统 — SAP 订单缓存、DD 拆单、对账';

DO $$
DECLARE
    app_user TEXT := current_user;
BEGIN
    EXECUTE format('GRANT ALL ON SCHEMA oms TO %I', app_user);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA oms GRANT ALL ON TABLES TO %I', app_user);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA oms GRANT USAGE, SELECT ON SEQUENCES TO %I', app_user);
END $$;

SET search_path TO oms, wms, public;

-- ============================================================================
-- 通用触发器函数 (OMS Schema 独立, 与 WMS 解耦)
-- ============================================================================

CREATE OR REPLACE FUNCTION oms.fn_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION oms.fn_synced_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.synced_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION oms.fn_enforce_company_code()
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
-- 1. oms.orders — 订单头 (PO/WO/SO/TR/DD 五类)
-- ============================================================================

CREATE TABLE oms.orders (
    id SERIAL PRIMARY KEY,
    company_code VARCHAR(20) NOT NULL
        CHECK (TRIM(company_code) <> ''),

    -- 单据类型
    doc_type VARCHAR(10) NOT NULL
        CHECK (doc_type IN ('PO','WO','SO','TR','DD')),
        -- PO=采购订单, WO=生产订单, SO=销售订单, TR=调拨, DD=配送单
    doc_number VARCHAR(50) NOT NULL,

    -- DD 谱系
    parent_id INTEGER REFERENCES oms.orders(id),
    is_split BOOLEAN NOT NULL DEFAULT FALSE,
    split_seq INTEGER,
    container_no VARCHAR(100),     -- DD 装柜号 (英文数字)

    -- DD 谱系完整性: DD 必须有父单, 非 DD 禁止有父单
    CHECK ((doc_type = 'DD' AND parent_id IS NOT NULL) OR (doc_type <> 'DD' AND parent_id IS NULL)),

    -- SAP 锚点
    sap_doc_entry INTEGER,
    sap_doc_num VARCHAR(50),
    sap_update_date DATE,          -- SAP 原始更新日期 (版本仲裁)
    sap_update_time TIME,          -- SAP 原始更新时间
    sap_status VARCHAR(20),        -- SAP 状态 (O=Open, C=Closed)
    sap_cancelled CHAR(1) NOT NULL DEFAULT 'N',  -- SAP 取消标记 (Y/N)
    sap_data_hash VARCHAR(32),     -- 关键字段 MD5 (防无意义更新)
    sap_last_seen_at TIMESTAMPTZ,  -- SAP 同步心跳 (30天未 seen → orphan)

    -- 业务状态 (OMS 权威)
    oms_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (oms_status IN ('pending','in_progress','completed','split','exported','cancelled')),
        -- pending=待处理, in_progress=进行中, completed=已完成
        -- split=已拆分(区别于 cancelled), exported=已导出, cancelled=已取消

    -- 执行生命周期 (WMS 触发器驱动)
    execution_state VARCHAR(20) NOT NULL DEFAULT 'idle'
        CHECK (execution_state IN ('idle','executing','done')),
        -- idle=未开始, executing=执行中, done=已完成

    -- WMS 关联
    wms_document_id INTEGER,       -- 关联 wms.wms_documents.id (DD 拣货单)

    -- 业务伙伴
    business_partner VARCHAR(100),
    bp_name VARCHAR(200),

    -- WO 成品 (BOM 抬头)
    item_code VARCHAR(50),          -- WO: OWOR.ItemCode (BOM 成品编号)
    item_name VARCHAR(200),         -- WO: OWOR.ProdName (成品名称)
    planned_qty DECIMAL(18,4),      -- WO: OWOR.PlannedQty; SO/PO: NULL(用行汇总)
    actual_qty DECIMAL(18,4),       -- WO: OWOR.CmpltQty; SO/PO: NULL(用行汇总)

    -- 仓库
    warehouse_code VARCHAR(20),
    warehouse_name VARCHAR(100),
    from_warehouse VARCHAR(20),
    to_warehouse VARCHAR(20),

    -- 日期
    doc_date DATE,
    due_date DATE,
    posting_date DATE,

    -- 金额汇总 (SAP 同步)
    doc_total DECIMAL(18,4) DEFAULT 0,
    doc_currency VARCHAR(10),

    -- 乐观锁
    row_version INTEGER NOT NULL DEFAULT 0,

    -- 幂等控制 (DD 创建防网络抖动)
    idempotency_key VARCHAR(100),

    -- 审计
    created_by VARCHAR(50),
    updated_by VARCHAR(50),
    remarks TEXT,

    -- 时间戳
    synced_at TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 核心索引
CREATE UNIQUE INDEX idx_oms_orders_unique ON oms.orders (company_code, doc_type, doc_number);
CREATE INDEX idx_oms_orders_parent ON oms.orders (parent_id);
CREATE INDEX idx_oms_orders_wms ON oms.orders (wms_document_id);
CREATE INDEX idx_oms_orders_sync ON oms.orders (synced_at, doc_type);
CREATE INDEX idx_oms_orders_status ON oms.orders (oms_status, doc_type);
-- SAP 同步 UPSERT 唯一索引 (wf20 ON CONFLICT 依赖)
-- WHERE: 仅非 DD 订单 + sap_doc_entry 非空 (DD 不走 SAP 同步)
CREATE UNIQUE INDEX idx_oms_orders_sap_upsert ON oms.orders (company_code, doc_type, sap_doc_entry) WHERE parent_id IS NULL AND sap_doc_entry IS NOT NULL;
CREATE INDEX idx_oms_orders_sap_entry ON oms.orders (sap_doc_entry, doc_type);
CREATE UNIQUE INDEX idx_oms_orders_split_seq ON oms.orders (parent_id, split_seq) WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX idx_oms_orders_idempotency ON oms.orders (company_code, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 触发器
CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON oms.orders
    FOR EACH ROW EXECUTE FUNCTION oms.fn_updated_at();

CREATE TRIGGER trg_orders_enforce_cc
    BEFORE INSERT OR UPDATE ON oms.orders
    FOR EACH ROW EXECUTE FUNCTION oms.fn_enforce_company_code();

COMMENT ON TABLE oms.orders IS 'OMS 订单头 — SAP 订单缓存 + DD 配送单';


-- ============================================================================
-- 2. oms.order_lines — 订单行 (FK → oms.orders)
-- ============================================================================

CREATE TABLE oms.order_lines (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES oms.orders(id) ON DELETE CASCADE,
    line_num INTEGER NOT NULL DEFAULT 1,

    -- 物料信息
    item_code VARCHAR(50) NOT NULL,
    item_name VARCHAR(200),
    barcode VARCHAR(100),
    uom VARCHAR(20),

    -- SAP 数量 (SAP 权威)
    quantity DECIMAL(18,4) NOT NULL DEFAULT 0,
    open_quantity DECIMAL(18,4) NOT NULL DEFAULT 0,

    -- WMS 实操数量 (WMS 权威, SAP sync 不覆盖)
    wms_actual_qty DECIMAL(18,4) NOT NULL DEFAULT 0,

    -- 金额
    unit_price DECIMAL(18,4) DEFAULT 0,
    line_total DECIMAL(18,4) DEFAULT 0,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    tax_percent DECIMAL(5,2) DEFAULT 0,

    -- 仓库
    warehouse_code VARCHAR(20),
    from_warehouse VARCHAR(20),
    to_warehouse VARCHAR(20),

    -- SAP 行级日期
    ship_date DATE,               -- RDR1.ShipDate (仅 SO 行)

    -- 批次追踪
    batch_number VARCHAR(50),
    serial_number VARCHAR(50),

    -- DD 行级溯源 (仅 DD 类型使用)
    source_doc_number VARCHAR(50),       -- 原单 SAP 单号 (如 SO 26000247)
    source_line_num INTEGER,             -- 原单行号

    -- SO 行累计已拣货数量 (所有子 DD 的 wms_actual_qty 聚合)
    picked_qty DECIMAL(18,4) NOT NULL DEFAULT 0,

    -- 行状态
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','partial','completed','cancelled')),

    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_oms_order_lines_order ON oms.order_lines (order_id);
CREATE INDEX idx_oms_order_lines_item ON oms.order_lines (item_code);
CREATE UNIQUE INDEX idx_oms_order_lines_num ON oms.order_lines (order_id, line_num);
CREATE INDEX IF NOT EXISTS idx_order_lines_warehouse ON oms.order_lines (warehouse_code);

-- 触发器
CREATE TRIGGER trg_order_lines_updated_at
    BEFORE UPDATE ON oms.order_lines
    FOR EACH ROW EXECUTE FUNCTION oms.fn_updated_at();

COMMENT ON TABLE oms.order_lines IS 'OMS 订单行 — FK→orders';


-- ============================================================================
-- 3. oms.order_events — 事件表 (P1 预埋, 为未来 Event Sourcing 准备)
-- ============================================================================

CREATE TABLE oms.order_events (
    id SERIAL PRIMARY KEY,
    company_code VARCHAR(20) NOT NULL
        CHECK (TRIM(company_code) <> ''),
    order_id INTEGER REFERENCES oms.orders(id),
    event_type VARCHAR(50) NOT NULL,   -- status_changed/qty_updated/split/sync/created
    source VARCHAR(20) NOT NULL,       -- wms_trigger/sap_sync/user_action
    old_value JSONB,
    new_value JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_oms_order_events_order ON oms.order_events (order_id, created_at);
CREATE INDEX idx_oms_order_events_type ON oms.order_events (event_type);

CREATE TRIGGER trg_order_events_enforce_cc
    BEFORE INSERT OR UPDATE ON oms.order_events
    FOR EACH ROW EXECUTE FUNCTION oms.fn_enforce_company_code();

COMMENT ON TABLE oms.order_events IS 'OMS 事件表 — 触发器同步双写, 未来 Event Sourcing';


-- ============================================================================
-- 4. oms.audit_logs — OMS 审计日志 (append-only)
-- ============================================================================

CREATE TABLE oms.audit_logs (
    id BIGSERIAL PRIMARY KEY,
    company_code VARCHAR(20) NOT NULL
        CHECK (TRIM(company_code) <> ''),
    operator VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL,
    target_type VARCHAR(20) NOT NULL,
    target_id INTEGER,
    trace_id VARCHAR(100),             -- 同一 HTTP 请求串联多条日志
    old_value JSONB,
    new_value JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_oms_audit_logs_target ON oms.audit_logs (target_type, target_id);
CREATE INDEX idx_oms_audit_logs_created ON oms.audit_logs (created_at);

CREATE TRIGGER trg_audit_logs_enforce_cc
    BEFORE INSERT OR UPDATE ON oms.audit_logs
    FOR EACH ROW EXECUTE FUNCTION oms.fn_enforce_company_code();

-- 审计日志不可变性保护 (继承 WMS 模式)
CREATE OR REPLACE FUNCTION oms.fn_prevent_oms_audit_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'OMS Audit log is append-only. UPDATE and DELETE are strictly forbidden.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_oms_audit_log_immutable
    BEFORE UPDATE OR DELETE ON oms.audit_logs
    FOR EACH ROW EXECUTE FUNCTION oms.fn_prevent_oms_audit_tampering();

COMMENT ON TABLE oms.audit_logs IS 'OMS 审计日志 — append-only, 禁止修改和删除';


-- ============================================================================
-- 触发器 1: DD 父单类型校验 (fn_enforce_dd_parent)
-- P1: DD 的 parent 必须是 SO; P2+: 放宽为 IN ('SO','DD')
-- ============================================================================

CREATE OR REPLACE FUNCTION oms.fn_enforce_dd_parent()
RETURNS TRIGGER AS $$
DECLARE
    parent_doc_type VARCHAR(10);
BEGIN
    -- 仅对 DD 类型校验 parent
    IF NEW.doc_type = 'DD' AND NEW.parent_id IS NOT NULL THEN
        SELECT doc_type INTO parent_doc_type
        FROM oms.orders
        WHERE id = NEW.parent_id;

        IF parent_doc_type IS NULL THEN
            RAISE EXCEPTION 'DD parent_id=% does not exist', NEW.parent_id;
        END IF;

        -- P1: 限制父单为 SO; P2+: 放宽为 IN ('SO','DD')
        IF parent_doc_type NOT IN ('SO', 'DD') THEN
            RAISE EXCEPTION 'DD parent must be SO or DD, got: %', parent_doc_type;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_enforce_dd_parent
    BEFORE INSERT OR UPDATE ON oms.orders
    FOR EACH ROW EXECUTE FUNCTION oms.fn_enforce_dd_parent();


-- ============================================================================
-- 触发器 2: 状态转换守卫 (fn_validate_status_transition)
-- 禁止非法 oms_status + execution_state 组合
-- ============================================================================

CREATE OR REPLACE FUNCTION oms.fn_validate_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    -- 跳过 INSERT (初始值已由 DEFAULT 保证合法)
    IF TG_OP = 'INSERT' THEN
        RETURN NEW;
    END IF;

    -- 禁止: 未开始业务但已执行完
    IF NEW.oms_status = 'pending' AND NEW.execution_state = 'done' THEN
        RAISE EXCEPTION 'Invalid state: oms_status=pending + execution_state=done';
    END IF;

    -- 禁止: 已完成但未执行
    IF NEW.oms_status = 'completed' AND NEW.execution_state = 'idle' THEN
        RAISE EXCEPTION 'Invalid state: oms_status=completed + execution_state=idle';
    END IF;

    -- oms_status 转换规则 (cancelled/split 可从任意状态进入)
    IF OLD.oms_status IS DISTINCT FROM NEW.oms_status THEN
        IF NEW.oms_status NOT IN ('cancelled', 'split') THEN
            -- 正向流转: pending → in_progress → completed → exported
            IF NOT (
                (OLD.oms_status = 'pending' AND NEW.oms_status = 'in_progress') OR
                (OLD.oms_status = 'in_progress' AND NEW.oms_status = 'completed') OR
                (OLD.oms_status = 'completed' AND NEW.oms_status = 'exported') OR
                -- 允许 pending 直接到 completed (SAP 同步场景)
                (OLD.oms_status = 'pending' AND NEW.oms_status = 'completed') OR
                -- 允许 pending 直接到 exported (SAP 状态同步)
                (OLD.oms_status = 'pending' AND NEW.oms_status = 'exported') OR
                -- split → completed (所有DD拣货完成后回写)
                (OLD.oms_status = 'split' AND NEW.oms_status = 'completed') OR
                -- split → in_progress (DD开始作业)
                (OLD.oms_status = 'split' AND NEW.oms_status = 'in_progress')
            ) THEN
                RAISE EXCEPTION 'Invalid oms_status transition: % → %', OLD.oms_status, NEW.oms_status;
            END IF;
        END IF;
    END IF;

    -- execution_state 转换规则: idle → executing → done
    IF OLD.execution_state IS DISTINCT FROM NEW.execution_state THEN
        IF NOT (
            (OLD.execution_state = 'idle' AND NEW.execution_state = 'executing') OR
            (OLD.execution_state = 'executing' AND NEW.execution_state = 'done') OR
            -- 允许 idle 直接到 done (SAP 已完成的单据同步)
            (OLD.execution_state = 'idle' AND NEW.execution_state = 'done')
        ) THEN
            RAISE EXCEPTION 'Invalid execution_state transition: % → %', OLD.execution_state, NEW.execution_state;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_validate_status
    BEFORE UPDATE ON oms.orders
    FOR EACH ROW EXECUTE FUNCTION oms.fn_validate_status_transition();


-- ============================================================================
-- 触发器 3: row_version 自增 (仅关键字段变化时)
-- ============================================================================

CREATE OR REPLACE FUNCTION oms.fn_bump_row_version()
RETURNS TRIGGER AS $$
BEGIN
    -- 仅当关键字段变化时 bump (防批量同步全部 +1)
    IF OLD.sap_data_hash IS DISTINCT FROM NEW.sap_data_hash
       OR OLD.oms_status IS DISTINCT FROM NEW.oms_status
       OR OLD.execution_state IS DISTINCT FROM NEW.execution_state THEN
        NEW.row_version = OLD.row_version + 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_bump_version
    BEFORE UPDATE ON oms.orders
    FOR EACH ROW EXECUTE FUNCTION oms.fn_bump_row_version();


-- ============================================================================
-- 触发器 4: WMS→OMS 头状态同步 (fn_sync_wms_status_to_oms)
-- AFTER UPDATE ON wms.wms_documents → 自动更新 oms.orders.execution_state + oms_status
-- ============================================================================

CREATE OR REPLACE FUNCTION oms.fn_sync_wms_status_to_oms()
RETURNS TRIGGER AS $$
DECLARE
    new_exec_state TEXT;
    new_oms_status TEXT;
    cur_oms_status TEXT;
BEGIN
    IF pg_trigger_depth() > 2 THEN RETURN NEW; END IF;

    CASE NEW.wms_status
        WHEN 'pending' THEN new_exec_state := 'idle';
        WHEN 'in_progress' THEN new_exec_state := 'executing';
        WHEN 'completed' THEN new_exec_state := 'done';
        WHEN 'exported' THEN new_exec_state := 'done';
        ELSE RETURN NEW;
    END CASE;

    -- oms_status 联动 (只升级不降级)
    CASE new_exec_state
        WHEN 'executing' THEN new_oms_status := 'in_progress';
        WHEN 'done' THEN new_oms_status := 'completed';
        ELSE new_oms_status := NULL;
    END CASE;

    -- 查询当前 OMS 状态，防止降级
    SELECT oms_status INTO cur_oms_status
    FROM oms.orders WHERE wms_document_id = NEW.id;

    IF cur_oms_status IS NULL THEN RETURN NEW; END IF;

    -- 只允许向上转换: pending → in_progress → completed → exported
    IF new_oms_status IS NOT NULL THEN
        IF (cur_oms_status = 'completed' AND new_oms_status = 'in_progress')
        OR (cur_oms_status = 'exported')
        OR (cur_oms_status IN ('split', 'cancelled'))
        THEN
            new_oms_status := NULL;  -- 不降级
        END IF;
    END IF;

    UPDATE oms.orders
    SET execution_state = CASE
            WHEN cur_oms_status IN ('completed', 'exported') AND new_exec_state IN ('idle', 'executing')
            THEN execution_state  -- 不降级 execution_state
            ELSE new_exec_state
        END,
        oms_status = COALESCE(new_oms_status, oms_status)
    WHERE wms_document_id = NEW.id
      AND (execution_state IS DISTINCT FROM new_exec_state
           OR (new_oms_status IS NOT NULL AND oms_status IS DISTINCT FROM new_oms_status));

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 注意: 此触发器挂在 wms.wms_documents 上, 跨 schema 操作
CREATE TRIGGER trg_wms_docs_sync_oms_status
    AFTER UPDATE ON wms.wms_documents
    FOR EACH ROW
    WHEN (OLD.wms_status IS DISTINCT FROM NEW.wms_status)
    EXECUTE FUNCTION oms.fn_sync_wms_status_to_oms();


-- ============================================================================
-- 触发器 5: WMS→OMS 行数量同步 (fn_sync_wms_qty_to_oms)
-- AFTER UPDATE ON wms.wms_document_lines → 自动更新 oms.order_lines.wms_actual_qty
-- ============================================================================

CREATE OR REPLACE FUNCTION oms.fn_sync_wms_qty_to_oms()
RETURNS TRIGGER AS $$
DECLARE
    v_oms_order_id INTEGER;
    v_dd_doc_type TEXT;
    v_parent_id INTEGER;
    v_company_code TEXT;
    v_source_docs TEXT[];
    v_src_doc TEXT;
    v_src_so_id INTEGER;
    v_all_lines_done BOOLEAN;
BEGIN
    -- 递归防御
    IF pg_trigger_depth() > 2 THEN RETURN NEW; END IF;

    -- 查找关联的 OMS 订单 (通过 wms_document_id)
    SELECT o.id, o.doc_type, o.parent_id, o.company_code
    INTO v_oms_order_id, v_dd_doc_type, v_parent_id, v_company_code
    FROM oms.orders o
    WHERE o.wms_document_id = NEW.document_id;

    -- Fallback: 通过 doc_number 匹配 (wms_document_id 可能尚未设置)
    IF v_oms_order_id IS NULL THEN
        SELECT o.id, o.doc_type, o.parent_id, o.company_code
        INTO v_oms_order_id, v_dd_doc_type, v_parent_id, v_company_code
        FROM oms.orders o
        JOIN wms.wms_documents wd ON wd.id = NEW.document_id
        WHERE o.doc_number = wd.doc_number
          AND o.doc_type = wd.doc_type
          AND o.company_code = wd.company_code;

        -- 顺便回填 wms_document_id
        IF v_oms_order_id IS NOT NULL THEN
            UPDATE oms.orders SET wms_document_id = NEW.document_id
            WHERE id = v_oms_order_id AND wms_document_id IS NULL;
        END IF;
    END IF;

    IF v_oms_order_id IS NULL THEN
        RETURN NEW;  -- 无 OMS 关联, 跳过 (普通 WMS 单据)
    END IF;

    -- 更新 DD 自身的 OMS 行 wms_actual_qty (1:1 line_num 匹配)
    UPDATE oms.order_lines
    SET wms_actual_qty = NEW.actual_qty
    WHERE order_id = v_oms_order_id
      AND line_num = NEW.line_num
      AND wms_actual_qty IS DISTINCT FROM NEW.actual_qty;

    -- ========== DD→SO 回写 (仅 DD 类型, 通过 source_doc_number 定位所有源 SO) ==========
    IF v_dd_doc_type = 'DD' THEN

        -- 获取此 DD 涉及的所有不同 source_doc_number
        SELECT ARRAY_AGG(DISTINCT ddl.source_doc_number)
        INTO v_source_docs
        FROM oms.order_lines ddl
        WHERE ddl.order_id = v_oms_order_id
          AND ddl.source_doc_number IS NOT NULL;

        IF v_source_docs IS NOT NULL THEN
            FOREACH v_src_doc IN ARRAY v_source_docs LOOP
                -- 找到源 SO (通过 sap_doc_num 匹配, 必须是已拆分的非 DD 订单)
                SELECT o.id INTO v_src_so_id
                FROM oms.orders o
                WHERE o.sap_doc_num = v_src_doc
                  AND o.company_code = v_company_code
                  AND o.parent_id IS NULL
                  AND o.is_split = TRUE
                LIMIT 1;

                IF v_src_so_id IS NOT NULL THEN
                    -- 聚合所有 DD 行 (跨多个 DD) 指向此 SO 行的 wms_actual_qty
                    UPDATE oms.order_lines sol
                    SET picked_qty = COALESCE(sub.total_picked, 0),
                        status = CASE
                            WHEN COALESCE(sub.total_picked, 0) >= sol.quantity THEN 'completed'
                            WHEN COALESCE(sub.total_picked, 0) > 0 THEN 'partial'
                            ELSE 'pending'
                        END
                    FROM (
                        SELECT ddl.source_line_num AS line_num,
                               SUM(ddl.wms_actual_qty) AS total_picked
                        FROM oms.order_lines ddl
                        JOIN oms.orders dd ON ddl.order_id = dd.id
                        WHERE dd.doc_type = 'DD'
                          AND ddl.source_doc_number = v_src_doc
                        GROUP BY ddl.source_line_num
                    ) sub
                    WHERE sol.order_id = v_src_so_id
                      AND sol.line_num = sub.line_num
                      AND (sol.picked_qty IS DISTINCT FROM COALESCE(sub.total_picked, 0)
                           OR sol.status IS DISTINCT FROM CASE
                               WHEN COALESCE(sub.total_picked, 0) >= sol.quantity THEN 'completed'
                               WHEN COALESCE(sub.total_picked, 0) > 0 THEN 'partial'
                               ELSE 'pending'
                           END);

                    -- 检查此 SO 是否所有行都已完成
                    SELECT NOT EXISTS(
                        SELECT 1 FROM oms.order_lines
                        WHERE order_id = v_src_so_id AND status != 'completed'
                    ) INTO v_all_lines_done;

                    IF v_all_lines_done THEN
                        UPDATE oms.orders
                        SET oms_status = 'completed', execution_state = 'done'
                        WHERE id = v_src_so_id AND oms_status = 'split';

                        UPDATE wms.wms_documents
                        SET wms_status = 'completed'
                        WHERE company_code = v_company_code
                          AND doc_type = 'SO'
                          AND doc_number = v_src_doc
                          AND wms_status = 'split';
                    END IF;
                END IF;
            END LOOP;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 触发器 6: WMS→OMS 自动关联 (fn_link_wms_to_oms)
-- AFTER INSERT/UPDATE ON wms.wms_documents → 自动设置 oms.orders.wms_document_id
-- ============================================================================

CREATE OR REPLACE FUNCTION oms.fn_link_wms_to_oms()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.doc_type IN ('DD', 'SO', 'PO', 'WO', 'TR') THEN
        UPDATE oms.orders
        SET wms_document_id = NEW.id
        WHERE doc_number = NEW.doc_number
          AND doc_type = NEW.doc_type
          AND company_code = NEW.company_code
          AND wms_document_id IS DISTINCT FROM NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wms_docs_link_oms
    AFTER INSERT OR UPDATE ON wms.wms_documents
    FOR EACH ROW
    EXECUTE FUNCTION oms.fn_link_wms_to_oms();


-- 注意: 此触发器挂在 wms.wms_document_lines 上, 跨 schema 操作
CREATE TRIGGER trg_wms_lines_sync_oms_qty
    AFTER UPDATE ON wms.wms_document_lines
    FOR EACH ROW
    WHEN (OLD.actual_qty IS DISTINCT FROM NEW.actual_qty)
    EXECUTE FUNCTION oms.fn_sync_wms_qty_to_oms();


-- ============================================================================
-- 视图 1: oms.v_order_summary — 订单汇总
-- split 状态代偿: 动态聚合子单 DD 的进度
-- ============================================================================

CREATE OR REPLACE VIEW oms.v_order_summary AS
SELECT
    o.id,
    o.company_code,
    o.doc_type,
    o.doc_number,
    o.sap_doc_num,
    o.parent_id,
    o.container_no,
    o.oms_status,
    o.execution_state,
    o.sap_status,
    o.sap_cancelled,
    o.business_partner,
    o.bp_name,
    o.warehouse_code,
    o.doc_date,
    o.due_date,
    o.doc_total,
    o.doc_currency,
    o.row_version,
    o.created_by,
    o.created_at,
    o.updated_at,
    -- 行汇总
    COUNT(ol.id) AS line_count,
    COALESCE(SUM(ol.quantity), 0) AS total_quantity,
    COALESCE(SUM(ol.open_quantity), 0) AS total_open_qty,
    -- 实操数量: split 状态聚合子单 DD, 否则取自身行
    CASE
        WHEN o.oms_status = 'split' THEN
            COALESCE((
                SELECT SUM(col.wms_actual_qty)
                FROM oms.orders co
                JOIN oms.order_lines col ON col.order_id = co.id
                WHERE co.parent_id = o.id
            ), 0)
        ELSE COALESCE(SUM(ol.wms_actual_qty), 0)
    END AS total_actual_qty,
    -- 完成率
    CASE
        WHEN COALESCE(SUM(ol.quantity), 0) = 0 THEN 0
        WHEN o.oms_status = 'split' THEN
            ROUND(COALESCE((
                SELECT SUM(col.wms_actual_qty)
                FROM oms.orders co
                JOIN oms.order_lines col ON col.order_id = co.id
                WHERE co.parent_id = o.id
            ), 0) / NULLIF(SUM(ol.quantity), 0) * 100, 1)
        ELSE ROUND(COALESCE(SUM(ol.wms_actual_qty), 0) / NULLIF(SUM(ol.quantity), 0) * 100, 1)
    END AS completion_pct,
    -- 金额汇总
    COALESCE(SUM(ol.line_total), 0) AS total_line_amount
FROM oms.orders o
LEFT JOIN oms.order_lines ol ON ol.order_id = o.id
GROUP BY o.id;


-- ============================================================================
-- 视图 2: oms.v_dd_lineage — DD 谱系 (WITH RECURSIVE, 支持多级拆分)
-- ============================================================================

CREATE OR REPLACE VIEW oms.v_dd_lineage AS
WITH RECURSIVE lineage AS (
    -- 根节点: 没有父单的 SO/PO/WO/TR
    SELECT
        id,
        company_code,
        doc_type,
        doc_number,
        parent_id,
        split_seq,
        container_no,
        oms_status,
        execution_state,
        0 AS depth,
        ARRAY[id] AS path
    FROM oms.orders
    WHERE parent_id IS NULL

    UNION ALL

    -- 子节点: DD 递归展开
    SELECT
        c.id,
        c.company_code,
        c.doc_type,
        c.doc_number,
        c.parent_id,
        c.split_seq,
        c.container_no,
        c.oms_status,
        c.execution_state,
        p.depth + 1,
        p.path || c.id
    FROM oms.orders c
    JOIN lineage p ON c.parent_id = p.id
    WHERE NOT c.id = ANY(p.path)  -- 防止循环引用
)
SELECT * FROM lineage;


-- ============================================================================
-- DD 流水号序列 + doc_number 唯一约束
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS oms.dd_doc_seq START WITH 1;
COMMENT ON SEQUENCE oms.dd_doc_seq IS 'DD 配送单流水号 (DD + YY + 6位序列)';

-- 注: doc_number 唯一性已由 idx_oms_orders_unique (company_code, doc_type, doc_number) 保障
-- 不同 doc_type (SO/PO/WO/TR) 可共享相同 SAP 单号, 故不加跨类型唯一约束


-- ============================================================================
-- Feature Flags (插入 wms.wms_system_settings)
-- oms_source_{type} = 'sap' → 未来支持 'sap'/'oms'/'hybrid'/'disabled'
-- ============================================================================

INSERT INTO wms.wms_system_settings (setting_key, setting_value)
VALUES
    ('oms_source_so', 'sap'),
    ('oms_source_po', 'sap'),
    ('oms_source_wo', 'sap'),
    ('oms_source_tr', 'sap')
ON CONFLICT (setting_key) DO NOTHING;


-- ============================================================================
-- 迁移提示: source_line_num (v0.1.16+, 已有部署需手动执行)
-- ALTER TABLE oms.order_lines ADD COLUMN IF NOT EXISTS source_line_num INTEGER;
-- COMMENT ON COLUMN oms.order_lines.source_line_num
--   IS 'DD 行对应的源 SO 行号 (仅 DD 类型订单使用)';
-- 回填:
-- UPDATE oms.order_lines ol SET source_line_num = so_line.line_num
-- FROM oms.orders dd JOIN oms.orders so ON dd.parent_id = so.id
-- JOIN oms.order_lines so_line ON so_line.order_id = so.id
--   AND so_line.item_code = ol.item_code
-- WHERE ol.order_id = dd.id AND dd.doc_type = 'DD'
--   AND ol.source_line_num IS NULL;
-- ============================================================================


-- ============================================================================
-- 验证
-- ============================================================================

SELECT '✓ DP OMS Schema 创建完成: 4 表 + 2 视图 + 5 触发器 + Feature Flags' AS status;
