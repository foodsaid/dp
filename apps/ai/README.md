# AI 智能体模块

> **状态**: 预留，计划 v1.5 上线。详见 [CLAUDE.md § AI 预留表](../../CLAUDE.md)

## 能力边界

**可以做 (v1.5+)**: RAG 检索增强 (pgvector) / 库存异常检测 / 自然语言查询 / SAP 数据分析

**不做**: 自动写入 SAP / 替代人工盘点决策 / 未经授权的数据访问

## 技术栈

- 向量存储: `ai.ai_embeddings` (PostgreSQL + pgvector, 已创建)
- API 路由: `/ai/*` (当前返回 503)
