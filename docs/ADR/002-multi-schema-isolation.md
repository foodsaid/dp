# ADR-002: 多 Schema 单实例隔离

## 状态
已采纳 (2026-02-22)

## 决策
使用 4 个 PostgreSQL Schema (`wms` / `wf` / `bi` / `ai`) 在同一数据库实例中隔离模块。

## 理由
- 同库 Schema 间可直接 JOIN，无需 ETL
- 各模块独立演进，互不干扰
- n8n/Superset 通过 `search_path` 自动管理各自 Schema
- 运维最简: 一个连接字符串，一次备份

## 后果
- 需要正确配置各模块的 `search_path`
- Schema 级权限需要精细管理 (v1.0+)
