#!/bin/bash
# =============================================================================
# 06_monitoring_user.sh — PostgreSQL 监控专用账号 (最小权限)
# 仅在 DP_MONITOR_PASSWORD 非空时创建 (监控可选)
# =============================================================================
set -e

# 密码为空时跳过 (监控未启用)
if [ -z "${DP_MONITOR_PASSWORD:-}" ]; then
    echo "06_monitoring_user.sh: DP_MONITOR_PASSWORD 未设置, 跳过监控账号创建"
    exit 0
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dp_monitor') THEN
            CREATE USER dp_monitor WITH PASSWORD '${DP_MONITOR_PASSWORD}';
            GRANT pg_monitor TO dp_monitor;
            RAISE NOTICE '06_monitoring_user.sh: dp_monitor 账号已创建';
        ELSE
            RAISE NOTICE '06_monitoring_user.sh: dp_monitor 账号已存在, 跳过';
        END IF;
    END
    \$\$;
EOSQL
