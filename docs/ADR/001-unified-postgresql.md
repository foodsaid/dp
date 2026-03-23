# ADR-001: 统一 PostgreSQL 17 (弃 MySQL)

## 状态
已采纳 (2026-02-22)

## 背景
easyWMS 原使用 MySQL 8.4，n8n 默认 SQLite/PostgreSQL，Superset 支持多种后端。
多数据库架构带来: 跨库 JOIN 困难、双备份复杂度、多驱动维护。

## 决策
统一使用 PostgreSQL 17 作为唯一数据库，通过 Schema 隔离不同模块。

## 理由
- BI 可直接 `SELECT wms.* JOIN bi.*` (零 ETL)
- `pg_dump` 一次备份全平台
- n8n + Superset 均原生支持 PostgreSQL
- pgvector 扩展为 AI 提供向量检索能力
- 消除 MySQL/PG 双驱动维护负担

## 后果
- 需将 easyWMS MySQL DDL 转换为 PostgreSQL 语法
- n8n 工作流需从 MySQL 节点迁移到 PostgreSQL 节点
