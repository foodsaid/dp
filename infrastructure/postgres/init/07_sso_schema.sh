#!/bin/bash
# =============================================================================
# 07_sso_schema.sh — Authelia SSO 存储 Schema
# =============================================================================
# 属主必须是 DP_DB_USER (业务账号), 而非 POSTGRES_USER (超级管理员)
# 否则 Authelia 用 DP_DB_USER 连接时 Permission denied for schema authelia
# =============================================================================
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE SCHEMA IF NOT EXISTS authelia AUTHORIZATION "${DP_DB_USER:-dp_app}";
SQL

echo "✅ Schema 'authelia' 已创建 (owner: ${DP_DB_USER:-dp_app})"
