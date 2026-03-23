# =============================================================================
# DP v0.4 — BI 引擎镜像 (Superset 6.1.0rc1, Debian Trixie)
# 基于: Apache Superset + pyodbc + pymssql + MS ODBC Driver 18
# 用途: 连接 SAP B1 (MSSQL) + PostgreSQL (dp-db)
#
# MSSQL 双驱动:
#   mssql+pyodbc://   → ODBC Driver 18 (需加 TrustServerCertificate=yes)
#   mssql+pymssql://  → 纯 Python (无 SSL 问题，更简洁)
# =============================================================================

FROM apache/superset:6.1.0rc1

USER root

# MSSQL ODBC 连接策略:
#   ENABLE_MSSQL_ODBC=true  → 安装 ODBC Driver 18 (仅 amd64, Bookworm 源)
#   ENABLE_MSSQL_ODBC=false → 跳过 ODBC, 仅用 pymssql 纯 Python 驱动
# Trixie (Debian 13) 上 Bookworm 源的 msodbcsql18 可能 runtime segfault
# 如遇到 segfault，用 --build-arg ENABLE_MSSQL_ODBC=false 重建
ARG ENABLE_MSSQL_ODBC=true

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        gnupg2 \
        unixodbc-dev && \
    if [ "$ENABLE_MSSQL_ODBC" = "true" ]; then \
        curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | \
            gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg && \
        echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/debian/12/prod bookworm main" \
            > /etc/apt/sources.list.d/mssql-release.list && \
        apt-get update && \
        ACCEPT_EULA=Y apt-get install -y msodbcsql18 || \
            echo "⚠ msodbcsql18 安装失败, 降级为 pymssql"; \
    else \
        echo "ODBC 已禁用 (ENABLE_MSSQL_ODBC=false), 使用 pymssql"; \
    fi && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# 安装 Python 驱动 (uv 包管理器，安装到 .venv)
# pymssql: 纯 Python MSSQL 驱动 (mssql+pymssql://)
# pyodbc:  ODBC 驱动 (mssql+pyodbc://, 需搭配上面的 msodbcsql18)
RUN uv pip install --no-cache-dir \
    pyodbc \
    pymssql \
    psycopg2-binary \
    redis

# 复制自定义配置
COPY apps/bi/superset_config.py /app/pythonpath/superset_config.py

# 启动脚本
COPY apps/bi/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

USER superset

EXPOSE 8088

ENTRYPOINT ["/app/docker-entrypoint.sh"]
