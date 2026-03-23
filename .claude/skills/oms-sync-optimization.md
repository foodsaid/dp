# OMS 同步优化经验 (wf20a 批次执行器)

> **适用**: wf20/wf20a/wf20-xx OMS SAP 订单同步体系
> **更新**: 2026-03-21 v1.0

---

## 核心原则: 同步层不过滤

```
❌ 禁止: SAP 查询中加业务过滤条件 (如 ItemType=4 只拉物料)
✅ 必须: 底表 = SAP 完整镜像，前台按需过滤

理由: 如果同步层过滤，OMS 数量与 SAP 对不齐，排查极其困难。
      前端/BI 加 WHERE item_type = 4 很容易，反向补数据很痛苦。

适用范围: 所有 SAP→PG 同步 (WMS 主数据、OMS 订单)
```

## wf20a 架构

```
wf20 (夜间启动器)
  ├─ 只创建当月 sync_progress (ON CONFLICT DO NOTHING)
  ├─ 重置 failed → pending
  └─ 触发 wf20a

wf20-so/po/wo/tr (四个初始启动器)
  ├─ 创建全量月份 sync_progress (从 DP_OMS_SYNC_START_DATE 到当月)
  ├─ ON CONFLICT DO UPDATE SET status='pending', completed_at=NULL, row_count=0
  ├─ ⚠️ 不会重置 last_anchor_date 和 context
  └─ 触发 wf20a

wf20a (批次执行器) — 链式触发，每次处理 1 个月
  ├─ 参数校验 → 任务路由 (Switch)
  │   ├─ 跳过SAP: 历史月 + 有 anchor → 标记 skipped
  │   ├─ SO/PO/WO/TR → 各自 SAP MSSQL 查询
  │   └─ fallback → 无效类型
  ├─ 生成UPSERT SQL (分批 500 行)
  ├─ 批量写入OMS → 汇总 → 校验 → 标记 completed
  └─ 触发下一批 (HTTP → 链式触发 webhook)
```

## 智能跳过条件

```javascript
// ✅ 正确: 基于 last_anchor_date (启动器不重置)
const canSkip = isHistorical && anchorDate !== null;

// ❌ 错误: 基于 completed_at (启动器会重置为 NULL)
const canSkip = isHistorical && prevCompleted;

// 历史月 = month_end < 本月1号
// 有 anchor = 之前成功同步过且有数据
// 空月 (无数据) 没有 anchor → 重查 SAP 但秒级返回
```

## SAP JOIN 类型

```
❌ INNER JOIN WOR1: 排除无行项的 WO 头单
✅ LEFT JOIN WOR1:  捕获所有 WO，无行项的头单也入库

WO 特殊: 部分 WO 头单无行项 (非物料类型工单)
SO/PO/TR: INNER JOIN 通常安全 (总有行项)，但原则上也应改 LEFT JOIN
```

## item_type 字段

```sql
-- oms.order_lines.item_type: SAP 行类型
-- WOR1.ItemType: 4=物料, 290=人工/间接费用 (LB001, OH001)
-- SO/PO/TR: NULL (不适用)
-- 前端过滤: WHERE item_type = 4 OR item_type IS NULL (只显示物料行)
```

## 批次大小权衡

```
100 行/批: DB 往返太多 (13520 行 = 135 次)，但单次执行小
500 行/批: DB 往返合理 (13520 行 = 27 次)，推荐值
1000+ 行/批: SQL 字符串过大，可能超 PG statement 限制

WO 2026-02 实测: 1925 订单 + 13520 SAP 行 = 9 秒完成 (500行批次)
```

## n8n Worker 超时

```
错误: "This execution failed to be processed too many times and will no longer retry"
原因: Worker 并发限制 (N8N_CONCURRENCY_PRODUCTION_LIMIT=5)，队列积压

解决:
  1. 增加 Worker 并发: N8N_CONCURRENCY_PRODUCTION_LIMIT=10
  2. 减少单次执行时间: 小批次 + 智能跳过
  3. 首次全量同步预期: 38K+ WO 约 17 分钟，有少量重试正常
  4. 增量同步预期: 22 秒 (智能跳过生效)
```

## sync_progress 数据解读

```
row_count: 当次同步从 SAP 查到的唯一订单数 (不是累计值)
sap_rows: SAP 返回的原始行数 (订单+行项 JOIN 结果)
oms.orders: 实际入库的唯一订单数 (UPSERT 累计)

⚠️ 如果 sync_progress 被重置后重跑:
  - row_count 只反映增量/当次
  - oms.orders 可能远大于 sum(row_count) (含历史数据)
  - 这不是 bug，是累计效应
```

## Switch 节点替代 IF 链

```
旧: 参数校验 → 智能跳过? → 是SO? → 是PO? → 是WO? → 是TR? → 无效类型
    (5 个 IF 节点，链式判断)

新: 参数校验 → 任务路由 (Switch 3.2，1 个节点)
    output[0] 跳过SAP → 标记skipped
    output[1] SO → SAP-SO查询
    output[2] PO → SAP-PO查询
    output[3] WO → SAP-WO查询
    output[4] TR → SAP-TR查询
    output[5] fallback → 无效类型

n8n Switch typeVersion 3.2 参数格式:
  rules.values[]: conditions + renameOutput + outputKey
  options.fallbackOutput: "extra"
```
