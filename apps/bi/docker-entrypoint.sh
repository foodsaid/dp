#!/bin/bash
set -e

# =============================================================================
# DP v0.4 — BI 引擎启动脚本 (Superset 6.1.0rc1)
# 初始化数据库 + 依赖自愈 + 创建管理员 + 启动服务
#
# 自愈机制: 基础镜像更新 (Watchtower / 手动 pull) 后
#           Dockerfile 的 RUN pip install 层丢失，此脚本自动补装
# =============================================================================

echo "=== [DP-BI] BI 引擎初始化 ==="

# -----------------------------------------------------------------------
# 依赖自愈: 检查 MSSQL 驱动，缺失时自动安装
# 场景: 基础镜像 apache/superset 更新后 Dockerfile 层失效
# 正常启动 (已安装): 仅 import 检查 ~0.5s
# 自愈启动 (缺失): pip install ~10s
# -----------------------------------------------------------------------
_missing_pkgs=""
python3 -c "import pyodbc"  2>/dev/null || _missing_pkgs="${_missing_pkgs} pyodbc"
python3 -c "import pymssql" 2>/dev/null || _missing_pkgs="${_missing_pkgs} pymssql"
python3 -c "import psycopg2" 2>/dev/null || _missing_pkgs="${_missing_pkgs} psycopg2-binary"

if [ -n "${_missing_pkgs}" ]; then
    echo "=== [DP-BI] 检测到缺失依赖:${_missing_pkgs}, 自动安装... ==="
    uv pip install --no-cache-dir ${_missing_pkgs} || pip install --no-cache-dir ${_missing_pkgs}
    echo "=== [DP-BI] 依赖自愈完成 ==="
else
    echo "=== [DP-BI] 依赖检查通过 (pyodbc + pymssql + psycopg2) ==="
fi

# 数据库迁移
superset db upgrade

# 初始化角色
superset init

# 创建管理员 (如不存在)
superset fab create-admin \
    --username "${SUPERSET_ADMIN_USERNAME:-admin}" \
    --firstname "Admin" \
    --lastname "DP" \
    --email "${SUPERSET_ADMIN_EMAIL:-admin@example.com}" \
    --password "${SUPERSET_ADMIN_PASSWORD}" \
    2>/dev/null || echo "管理员已存在，跳过创建"

echo "=== [DP-BI] BI 引擎就绪 ==="

# 启动 BI 引擎
# workers=2: 每个 worker 约 300-400MB，生产限制 1G 内存
# 4 workers 容易 OOM 导致请求卡死 (kill -9)
exec gunicorn \
    --bind 0.0.0.0:8088 \
    --workers 2 \
    --threads 4 \
    --timeout 120 \
    --limit-request-line 0 \
    --limit-request-field_size 0 \
    "superset.app:create_app()"
