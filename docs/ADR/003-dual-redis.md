# ADR-003: 双 Redis 实例

## 状态
已采纳 (2026-02-22)

## 决策
部署两个独立 Redis 实例:
- `dp-cache-wf`: 工作流队列 (AOF 持久化, noeviction)
- `dp-cache-bi`: BI 缓存 (无 AOF, allkeys-lru)

## 理由
- 队列数据不能丢失 (noeviction)，缓存数据可丢弃 (LRU)
- 独立扩容: 队列和缓存负载特征不同
- 独立清空: 清 BI 缓存不影响工作流队列
- 故障隔离: 一个 Redis 故障不影响另一个

## 后果
- 多一个容器，但资源占用极小 (256M 上限)
