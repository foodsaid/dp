-- =============================================================================
-- 17_wms_decouple_sap.sql — WMS 解耦 SAP: 表结构扩充 + 触发器 + 索引
-- v0.8: order_lines 防旧覆盖字段、领空保护触发器、sync_status 闭环、
--       wms_items_cache 扩充、wms_alerts 告警表
-- 幂等: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / OR REPLACE
-- =============================================================================

SET search_path TO oms, wms, public;

-- ============================================================================
-- 1. oms.order_lines — 新增字段
-- ============================================================================

ALTER TABLE oms.order_lines
    ADD COLUMN IF NOT EXISTS delivered_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS issued_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS uom_snapshot VARCHAR(20),
    ADD COLUMN IF NOT EXISTS sap_update_date DATE,
    ADD COLUMN IF NOT EXISTS sap_update_time TIME,
    ADD COLUMN IF NOT EXISTS wms_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN oms.order_lines.delivered_qty IS 'SAP DelivrdQty (SO/PO 已交付数量)，SAP 同步覆盖';
COMMENT ON COLUMN oms.order_lines.issued_qty IS 'SAP IssuedQty (WO/PI 已发料数量)，SAP 同步覆盖';
COMMENT ON COLUMN oms.order_lines.uom_snapshot IS 'UOM 快照，首次写入后冻结，不随 SAP 变更';
COMMENT ON COLUMN oms.order_lines.sap_update_date IS 'SAP 行级更新日期，防旧数据覆盖';
COMMENT ON COLUMN oms.order_lines.sap_update_time IS 'SAP 行级更新时间，配合 sap_update_date 防旧覆盖';
COMMENT ON COLUMN oms.order_lines.wms_updated_at IS 'WMS 字段最后变更时间，触发器自动维护';


-- ============================================================================
-- 2. oms.orders — 新增字段
-- ============================================================================

ALTER TABLE oms.orders
    ADD COLUMN IF NOT EXISTS expected_line_count INTEGER,
    ADD COLUMN IF NOT EXISTS wms_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sync_status VARCHAR(20) NOT NULL DEFAULT 'pending';

-- 添加 CHECK 约束（幂等）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_orders_sync_status'
          AND conrelid = 'oms.orders'::regclass
    ) THEN
        ALTER TABLE oms.orders ADD CONSTRAINT chk_orders_sync_status
            CHECK (sync_status IN ('pending','syncing','complete','error'));
    END IF;
END $$;

COMMENT ON COLUMN oms.orders.expected_line_count IS 'SAP 行数，校验同步完整性';
COMMENT ON COLUMN oms.orders.wms_updated_at IS 'WMS 字段最后变更时间，触发器自动维护';
COMMENT ON COLUMN oms.orders.sync_status IS '同步状态: pending→syncing→complete|error';


-- ============================================================================
-- 3. wms.wms_items_cache — 扩充字段
-- ============================================================================

ALTER TABLE wms.wms_items_cache
    ADD COLUMN IF NOT EXISTS foreign_name VARCHAR(200) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS item_group INTEGER,
    ADD COLUMN IF NOT EXISTS inventory_uom VARCHAR(20) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS purchase_uom VARCHAR(20) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS sell_uom VARCHAR(20) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS is_active CHAR(1) NOT NULL DEFAULT 'Y';

COMMENT ON COLUMN wms.wms_items_cache.foreign_name IS '物料外文名 (OITM.FrgnName)';
COMMENT ON COLUMN wms.wms_items_cache.item_group IS '物料组代码 (OITM.ItmsGrpCod)';
COMMENT ON COLUMN wms.wms_items_cache.inventory_uom IS '库存计量单位 (OITM.InvntryUom)';
COMMENT ON COLUMN wms.wms_items_cache.purchase_uom IS '采购计量单位 (OITM.BuyUnitMsr)';
COMMENT ON COLUMN wms.wms_items_cache.sell_uom IS '销售计量单位 (OITM.SalUnitMsr)';
COMMENT ON COLUMN wms.wms_items_cache.is_active IS '是否有效 (Y/N)，frozenFor=N→Y';


-- ============================================================================
-- 4. oms.wms_alerts — 告警表
-- ============================================================================

CREATE TABLE IF NOT EXISTS oms.wms_alerts (
    id SERIAL PRIMARY KEY,
    company_code VARCHAR(20) NOT NULL
        CHECK (TRIM(company_code) <> ''),
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'warning'
        CHECK (severity IN ('info','warning','error','critical')),
    source VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    context JSONB,
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wms_alerts_type
    ON oms.wms_alerts (alert_type, created_at);
CREATE INDEX IF NOT EXISTS idx_wms_alerts_cc
    ON oms.wms_alerts (company_code, acknowledged);

-- RLS
ALTER TABLE oms.wms_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON oms.wms_alerts;
CREATE POLICY company_isolation ON oms.wms_alerts
    FOR ALL TO dp_app_rls
    USING (company_code = current_setting('app.company_code'))
    WITH CHECK (company_code = current_setting('app.company_code'));

-- company_code 触发器
CREATE TRIGGER trg_wms_alerts_enforce_cc
    BEFORE INSERT OR UPDATE ON oms.wms_alerts
    FOR EACH ROW EXECUTE FUNCTION oms.fn_enforce_company_code();

COMMENT ON TABLE oms.wms_alerts IS 'WMS/OMS 告警表 — 同步异常、UOM变更、领空违规等';


-- ============================================================================
-- 5. 索引
-- ============================================================================

-- wf1x 按 sap_doc_num 查询（核心路径）
CREATE INDEX IF NOT EXISTS idx_oms_orders_cc_type_sapdocnum
    ON oms.orders (company_code, doc_type, sap_doc_num)
    WHERE parent_id IS NULL;

-- sync_status 过滤
CREATE INDEX IF NOT EXISTS idx_oms_orders_sync_status
    ON oms.orders (company_code, doc_type, sync_status);

-- order_lines RLS + JOIN 性能
CREATE INDEX IF NOT EXISTS idx_oms_lines_cc_orderid
    ON oms.order_lines (company_code, order_id);


-- ============================================================================
-- 6. 触发器: order_lines wms_updated_at 自动更新
-- ============================================================================

CREATE OR REPLACE FUNCTION oms.fn_order_lines_wms_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    -- WMS 字段白名单: 任一变化则更新 wms_updated_at
    IF OLD.wms_actual_qty IS DISTINCT FROM NEW.wms_actual_qty
       OR OLD.picked_qty IS DISTINCT FROM NEW.picked_qty
       OR OLD.status IS DISTINCT FROM NEW.status
    THEN
        NEW.wms_updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_lines_wms_updated ON oms.order_lines;
CREATE TRIGGER trg_order_lines_wms_updated
    BEFORE UPDATE ON oms.order_lines
    FOR EACH ROW EXECUTE FUNCTION oms.fn_order_lines_wms_updated_at();


-- ============================================================================
-- 7. 触发器: orders wms_updated_at 自动更新
-- ============================================================================

CREATE OR REPLACE FUNCTION oms.fn_orders_wms_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.oms_status IS DISTINCT FROM NEW.oms_status
       OR OLD.execution_state IS DISTINCT FROM NEW.execution_state
    THEN
        NEW.wms_updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_wms_updated ON oms.orders;
CREATE TRIGGER trg_orders_wms_updated
    BEFORE UPDATE ON oms.orders
    FOR EACH ROW EXECUTE FUNCTION oms.fn_orders_wms_updated_at();


-- ============================================================================
-- 8. 触发器: order_lines 领空保护（SAP 同步时禁止覆盖 WMS 字段）
-- ============================================================================

CREATE OR REPLACE FUNCTION oms.fn_protect_wms_fields()
RETURNS TRIGGER AS $$
BEGIN
    -- 检测 SAP 同步特征: sap_update_date 或 sap_update_time 发生变化
    -- 此时强制还原 WMS 领空字段为原值
    IF NEW.sap_update_date IS DISTINCT FROM OLD.sap_update_date
       OR NEW.sap_update_time IS DISTINCT FROM OLD.sap_update_time
    THEN
        NEW.wms_actual_qty = OLD.wms_actual_qty;
        NEW.picked_qty = OLD.picked_qty;
        NEW.status = OLD.status;
        NEW.wms_updated_at = OLD.wms_updated_at;

        -- uom_snapshot 冻结: 已有值则保持，首次则写入当前 UOM
        IF OLD.uom_snapshot IS NOT NULL THEN
            NEW.uom_snapshot = OLD.uom_snapshot;
        ELSE
            NEW.uom_snapshot = COALESCE(NEW.uom, OLD.uom);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 触发器名以 'a_' 前缀确保在其他 BEFORE UPDATE 触发器之前执行（字母序）
DROP TRIGGER IF EXISTS trg_a_order_lines_protect_wms ON oms.order_lines;
CREATE TRIGGER trg_a_order_lines_protect_wms
    BEFORE UPDATE ON oms.order_lines
    FOR EACH ROW EXECUTE FUNCTION oms.fn_protect_wms_fields();


-- ============================================================================
-- 9. 触发器: wms_items_cache UOM 变更审计
-- ============================================================================

CREATE OR REPLACE FUNCTION wms.fn_audit_uom_change()
RETURNS TRIGGER AS $$
BEGIN
    -- inventory_uom 从非空值变更时记录告警
    IF OLD.inventory_uom IS DISTINCT FROM NEW.inventory_uom
       AND OLD.inventory_uom != ''
    THEN
        INSERT INTO oms.wms_alerts (company_code, alert_type, severity, source, message, context)
        VALUES (
            NEW.company_code,
            'UOM_CHANGED',
            'warning',
            'wf06',
            'inventory_uom: ' || COALESCE(OLD.inventory_uom, '') || ' → ' || COALESCE(NEW.inventory_uom, ''),
            jsonb_build_object(
                'item_code', NEW.item_code,
                'old_uom', OLD.inventory_uom,
                'new_uom', NEW.inventory_uom
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_items_cache_audit_uom ON wms.wms_items_cache;
CREATE TRIGGER trg_items_cache_audit_uom
    BEFORE UPDATE ON wms.wms_items_cache
    FOR EACH ROW EXECUTE FUNCTION wms.fn_audit_uom_change();


-- ============================================================================
-- 10. 权限授予
-- ============================================================================

-- dp_app_rls 需要 wms_alerts 表的读写权限
DO $$
BEGIN
    -- wms_alerts
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_app_rls') THEN
        GRANT SELECT, INSERT ON oms.wms_alerts TO dp_app_rls;
        GRANT USAGE, SELECT ON SEQUENCE oms.wms_alerts_id_seq TO dp_app_rls;
    END IF;
    -- dp_bi 只读
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_bi') THEN
        GRANT SELECT ON oms.wms_alerts TO dp_bi;
    END IF;
END $$;
