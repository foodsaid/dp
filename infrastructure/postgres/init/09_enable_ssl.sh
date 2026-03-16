#!/bin/bash
# ============================================================================
# DP v0.3.2 — PostgreSQL SSL 自签名证书 (容器间加密通信)
# 在 PostgreSQL 首次启动时由 docker-entrypoint-initdb.d 自动执行
# ============================================================================

set -e

PGDATA="${PGDATA:-/var/lib/postgresql/data}"

echo "=== [DP] 配置 PostgreSQL SSL ==="

# 生成自签名证书 (有效期 10 年, 容器间通信足够)
if [ ! -f "$PGDATA/server.key" ]; then
    openssl req -new -x509 -days 3650 -nodes \
        -subj "/CN=dp-db" \
        -keyout "$PGDATA/server.key" \
        -out "$PGDATA/server.crt" 2>/dev/null
    chmod 600 "$PGDATA/server.key"
    chown postgres:postgres "$PGDATA/server.key" "$PGDATA/server.crt"
    echo "=== [DP] SSL 自签名证书已生成 ==="
else
    echo "=== [DP] SSL 证书已存在, 跳过生成 ==="
fi

# 启用 SSL (修改 postgresql.conf)
if grep -q "^#ssl = off" "$PGDATA/postgresql.conf" 2>/dev/null; then
    sed -i 's/^#ssl = off/ssl = on/' "$PGDATA/postgresql.conf"
    echo "=== [DP] SSL 已启用 ==="
elif grep -q "^ssl = on" "$PGDATA/postgresql.conf" 2>/dev/null; then
    echo "=== [DP] SSL 已处于启用状态 ==="
fi

echo "=== [DP] PostgreSQL SSL 配置完成 ==="
