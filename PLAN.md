# DP 执行计划 — Digital Platform 数字底座

> **当前版本**: v0.3.3
> **核心理念**: SAP B1 为锚，WMS + OMS + BI 三位一体，AI 预留，多公司一键复制
> **完整架构**: 见 [CLAUDE.md](CLAUDE.md)

---

## 已完成版本摘要

| 版本 | 核心特性 |
|------|---------|
| v0.1.0~v0.1.3 | 基础架构 (8 容器 + PG + 4 Schema) + WMS 7 模块 + SAP 预填 |
| v0.1.4~v0.1.5 | 移动端扫码 + 多环境 + BI MSSQL 双驱动 |
| v0.1.7~v0.1.9 | 智能同步 + 快照双触发 + 跨平台兼容 |
| v0.1.10 | 安全加固 (SQL 注入消除 + 审计日志不可变) |
| v0.1.14~v0.1.16 | OMS 订单管理 (独立 Schema + DD 拆单 + 双向追溯) |
| v0.1.17~v0.1.20 | 测试冲刺 (Jest 2264 用例 + E2E 152 场景 + ESLint) + 端口标准化 |
| v0.2.0 | 可观测性 (Prometheus + Grafana + Alertmanager, 8 监控容器) |
| v0.3.0~v0.3.3 | SSO 统一认证 (Authelia) + 安全加固 (CSP/SSL/Redis) |

> 详细变更日志见 [CLAUDE.md § 变更日志](CLAUDE.md) 和 [CLAUDE.md § 架构演进记录](CLAUDE.md)

---

## 后续规划

### v0.4 — OIDC + 日志聚合
- OIDC (Google OAuth) — Authelia 已预留骨架 (取消注释即可)
- Loki + Promtail 日志聚合
- n8n 工作流执行统计

### v1.0 — 多公司
- RLS 行级安全 (替换 company_code 应用层过滤)
- API 网关升级
- 缓存表补充 company_code

### v1.5 — AI 上线
- RAG + pgvector 检索增强
- 异常检测 (库存异动告警)
- 智能报表

---

## 技术债

| # | 技术债 | 优先级 | 计划版本 |
|---|--------|--------|---------|
| 1 | 未实现 RLS (行级安全) | 高 | v1.0 |
| 5 | 前端无构建工具 (原生 HTML/JS) | 低 | v1.0+ |
| 7 | 缓存表 (items/locations/bins) 缺少 company_code | 中 | v1.0 |

> 已解决: ~~#2 SSO~~ (v0.3) / ~~#3 可观测性~~ (v0.2) / ~~#4 n8n 认证~~ (v0.3) / ~~#6 E2E 覆盖~~ (v0.1.17)
