# ADR-004: SAP B1 首选 Service Layer

## 状态
已采纳 (2026-02-22)

## 决策
SAP B1 集成首选 Service Layer REST API，MS SQL 直连仅作为备选 (只读查询)。

## 理由
- Service Layer 是 SAP 官方推荐接口
- 避免直接操作数据库导致的锁表和数据一致性问题
- REST API 更易于在 n8n 中实现 (HTTP Request 节点)
- Service Layer 自动处理 SAP 业务逻辑和验证

## 后果
- 需要 SAP Service Layer 服务可达 (HTTPS)
- 部分复杂查询性能可能不如直连
- MS SQL 直连查询必须加 `SET NOCOUNT ON` + `WITH(NOLOCK)`
