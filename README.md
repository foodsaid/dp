> **注意**: 本仓库为 [foodsaid/dp](https://github.com/foodsaid/dp) 的脱敏快照发布版，仅供参考，不包含 git 历史。

# DP — Digital Platform

> SAP Business One 数字化底座 · WMS + OMS + BI 三位一体 · 统一 PostgreSQL · 多公司一键复制

[![CI](https://github.com/foodsaid/dp/actions/workflows/ci.yml/badge.svg)](https://github.com/foodsaid/dp/actions/workflows/ci.yml)

## 架构概览

```
                          ┌──────────────────────────────────────────────────┐
                          │          DP v0.8.1 — Digital Platform            │
  浏览器/PDA ─────────┐   │                                                  │
                      ▼   │  ┌─────────────────────────────────────────┐    │
  Cloudflare ──────► 网关  │──│  认证层: Authelia SSO + Redis           │    │
  Tunnel             nginx│  └─────────────────────────────────────────┘    │
                      │   │                                                  │
          ┌───────────┼───┼──────────────┐                                  │
          ▼           ▼   ▼              ▼                                  │
  ┌─────────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐                │
  │  WMS + OMS  │ │ n8n 主   │ │ n8n      │ │ Superset   │                │
  │  前端       │ │ 路由+入队 │ │ Worker   │ │ BI 引擎    │  ◄── 应用层    │
  └─────────────┘ └────┬─────┘ └──┬───────┘ └──┬─────────┘                │
                       │    ▲     │             │                           │
                       ▼    │消费  ▼             ▼                           │
                  ┌────────────┐ ┌─────────────────────┐                   │
                  │Redis 7.4   │ │  PostgreSQL 17       │  ◄── 数据层      │
                  │Bull + 缓存 │ │  6 Schema + pgvector │                   │
                  └────────────┘ └─────────┬───────────┘                   │
                                           │                                │
  SAP B1 ◄ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘ OMS 定时同步 (MSSQL 只读)    │
         · · · · · · · · · · · · · · · · · ·  Service Layer 回写 (规划中)  │
                                                                            │
  ┌─ 监控层 (可选) ──────────────────────────────────────────┐             │
  │  Prometheus · Grafana · Loki · Alloy · Alertmanager     │             │
  └─────────────────────────────────────────────────────────┘             │
                          └──────────────────────────────────────────────────┘
```

## 快速启动

```bash
# 1. 克隆仓库
git clone https://github.com/foodsaid/dp && cd Digital-Platform

# 2. 创建环境文件
cp .env.example .env
# ⚠️ 必须设置所有密码字段！快速生成: openssl rand -base64 32

# 3. 启动 (推荐，自动检测平台 + 创建网络 + 权限预检)
bash scripts/dev-up.sh

# 4. 访问
# 统一网关:   http://localhost:<DP_GATEWAY_PORT>
# WMS 前端:   http://localhost:<DP_GATEWAY_PORT>/wms/
# n8n 编辑器: http://localhost:<DP_WF_PORT>  (独立端口，不走网关)
```

## 测试

```bash
npm test                   # Jest 单元测试 (WMS + WF 纯函数)
npx playwright test        # E2E 端到端测试
npm run lint               # ESLint 静态分析
pytest tests/infra/        # 基建测试 (BATS + pytest)
```

## 文档

| 文档 | 说明 |
|------|------|
| [CLAUDE.md](CLAUDE.md) | AI 指令中枢 (架构规则 + 完整结构 + 规则红线) |
| [docs/DEPLOY-GUIDE.md](docs/DEPLOY-GUIDE.md) | 系统部署实施手册 |
| [docs/WMS-UAT-Guide.md](docs/WMS-UAT-Guide.md) | WMS 用户验收测试指南 |
| [docs/ADR/](docs/ADR/) | 架构决策记录 (8 篇) |
| [.claude/skills/](.claude/skills/) | AI 技能库 (可复用 SOP) |

## 路线图

**v0.8.1** (当前 · OMS 同步优化) → **v1.0** 生产加固 → **Future** 智能化演进

详见 [PLAN.md](PLAN.md)

## 许可证

Private @Foodsaid
