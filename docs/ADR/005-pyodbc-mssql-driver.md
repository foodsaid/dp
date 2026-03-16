# ADR-005: Superset MSSQL 驱动选择 pyodbc

## 状态
已采纳 (2026-02-22)

## 决策
Superset 连接 SAP B1 MS SQL 使用 `pyodbc` + Microsoft ODBC Driver 18。

## 理由
- `pymssql` 已停止维护
- Microsoft ODBC Driver 18 是微软官方维护的驱动
- `pyodbc` 社区活跃，文档完善
- 连接串格式: `mssql+pyodbc://`

## 后果
- Docker 镜像需要额外安装 ODBC Driver 18 (增加约 50MB)
- 需要在 Dockerfile 中配置 Microsoft APT 源
