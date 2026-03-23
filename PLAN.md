# DP 执行计划 — Digital Platform

> **当前版本**: v0.8.1
> **核心理念**: SAP B1 为锚，WMS + OMS + BI 三位一体，AI 预留，多公司一键复制
> **规则红线**: 见 [CLAUDE.md](CLAUDE.md)

---

## 路线图

```
v0.1~v0.7 基建期              v0.8.x 解耦+优化期 ← 当前        v1.0+ 演进期
──────────────────────────  ──────────────────────────────   ──────────────
WMS 7模块 + SAP集成          WMS 解耦 SAP 直连 (v0.8) ✅      API 网关限流
OMS DD拆单 + BI可视化        OMS 同步加固 (领空保护) ✅         前端 Vite 构建
监控全栈 + SSO认证            wf1x MSSQL→PG 切换 ✅            Service Layer 回写
RLS 行级安全 + OMS 增量       OMS 同步优化 (v0.8.1) ✅          工作流失败自愈
━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   ──────────────
         ✅ 完成                      ✅ 当前                     🔮 远期
```

---

## 关键里程碑

| 版本 | 核心交付 |
|------|---------|
| v0.1~v0.1.3 | WMS 7模块 + SAP预填 + PostgreSQL 统一数据库 |
| v0.1.10 | 安全基线: SQL注入消除 + 审计日志不可变触发器 |
| v0.1.14~v0.1.16 | OMS: 独立Schema + DD拆单 + WMS双向联动 |
| v0.2.0 | 全栈可观测性: Prometheus + Grafana + Alertmanager |
| v0.3.0~v0.3.2 | SSO统一认证 (Authelia) + 安全加固 (CSP/SSL/Redis) |
| v0.4.0 | n8n Queue模式 + Worker容器 + 队列告警 |
| v0.5.0 | 缓存表补 `company_code` 复合主键 |
| v0.6.0 | RLS行级安全: 14表策略 + 3 DB角色 + 29工作流全量切换 |
| v0.7.0 | OMS分批同步: 8工作流 + 断点续传 + 实时进度 |
| v0.8.0 | WMS 解耦 SAP: wf1x MSSQL→PG + OMS 同步加固 + 领空保护 |
| v0.8.1 | OMS 同步优化: item_type 完整同步 + Switch 路由 + LEFT JOIN + 智能跳过 + DB 审计热补丁 *(当前)* |

---

## 架构关键决策

> 详细分析见 [docs/ADR/](docs/ADR/)

| 版本 | 决策 | 备注 |
|------|------|------|
| v0.1 | 统一 PG 17 一库七 Schema (零 ETL) | ADR-001, v0.8.1 新增 core |
| v0.1 | `company_code NOT NULL` 无 DEFAULT，四层防御 | ADR-002，v0.6 升至 RLS |
| v0.1 | n8n 编辑器独立端口/子域名 (绕过上游 Bug) | 长期保持 |
| v0.1.10 | SQL 注入消除 + 审计日志不可变触发器 | 安全基线 |
| v0.1.14 | OMS 独立 Schema + DD 拆单 (parent_id 自引用) | ADR-007 |
| v0.1.15 | n8n 逻辑剥离纯函数库 (`apps/wf/lib/`) | 可单测 |
| v0.2.0 | Prometheus + Grafana + Loki 全栈可观测性 | ADR-006 |
| v0.3.0 | Authelia SSO gateway (nginx auth_request) | ADR-008 |
| v0.6.0 | RLS 14 表策略 + 3 DB 角色 | 多租户安全 |
| v0.7.0 | OMS 分批同步 (按月断点续传) | 可扩展至更多类型 |

---

## 技术债

| 优先级 | 项目 | 说明 |
|--------|------|------|
| 中 | 跨 Schema 触发器事件化 | v1.0 用 order_events + n8n 异步替代同步触发器 |
| 中 | DEPRECATED 字段物理删除 | wms_status / oms_status 待所有消费方迁移后清理 |
| 低 | 工作流失败自愈 | 自动重试 + 告警 |
| 低 | Service Layer 回写 SAP | 定时回写替代实时 API |

> 已解决: ~~TIMESTAMPTZ~~ (v0.8) · ~~索引优化~~ (v0.8) · ~~通用函数统一~~ (v0.8) · ~~RLS~~ (v0.6) · ~~缓存表cc~~ (v0.5) · ~~SSO~~ (v0.3) · ~~可观测性~~ (v0.2) · ~~n8n Queue~~ (v0.4)
