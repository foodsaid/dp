# =============================================================================
# DP v0.1 — BI 引擎镜像
# 基于: Apache Superset + pyodbc + pymssql + MS ODBC Driver 18
# 用途: 连接 SAP B1 (MSSQL) + PostgreSQL (dp-db)
#
# MSSQL 双驱动:
#   mssql+pyodbc://   → ODBC Driver 18 (需加 TrustServerCertificate=yes)
#   mssql+pymssql://  → 纯 Python (无 SSL 问题，更简洁)
# =============================================================================

FROM apache/superset:latest

USER root

# 安装 Microsoft ODBC Driver 18 for SQL Server (仅 x86_64，ARM64 跳过)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        gnupg2 \
        unixodbc-dev && \
    ( \
        curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg && \
        echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/debian/12/prod bookworm main" > /etc/apt/sources.list.d/mssql-release.list && \
        apt-get update && \
        ACCEPT_EULA=Y apt-get install -y msodbcsql18 \
    ) || echo "msodbcsql18 安装跳过 (非 x86_64 平台，使用 pymssql 替代)" ; \
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
