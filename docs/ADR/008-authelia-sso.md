# ADR-008: Authelia SSO 统一认证

| 属性 | 值 |
|------|------|
| 状态 | ✅ Accepted |
| 日期 | 2026-03-10 |
| 版本 | v0.3 |
| 关联技术债 | #2 (SSO), #4 (n8n 认证) |

## 背景

v0.2.0 存在 4 套独立认证系统:
- WMS: 自建 `wf14-auth` (SHA-256 密码, Redis session)
- BI (Superset): 内置 FAB 认证
- Grafana: 内置 admin/password
- 监控 (Prometheus/Alertmanager): 零认证 (仅内网)

用户需多次登录, 且监控端口暴露存在安全风险。

## 决策

采用 **Authelia** 作为统一 SSO 网关, 通过 nginx `auth_request` 模块实现前置认证。

### 关键选择

| 决策 | 选择 | 理由 |
|------|------|------|
| SSO 方案 | Authelia (轻量) | <50 用户, 单容器部署, 内存消耗低; Keycloak 过重 |
| 部署方式 | `profiles: ["sso"]` | 开发默认不启动, 与 monitoring 同模式 |
| 存储后端 | PostgreSQL (authelia schema) | 备份统一 (pg_dump 一库全覆盖) |
| 会话后端 | 独立 Redis 实例 (dp-cache-sso) | eviction 是实例级 — allkeys-lru 会踢 session → 随机登出 |
| 用户数据源 | file backend (users.yml) | <50 人, YAML + argon2id 哈希 |
| 认证协议 | auth_request (P1) + Auth Proxy (P3) | 渐进式: P1 门禁 → P2 WMS → P3 BI/Grafana 深度集成 |
| Header 注入 | 双 Header (X-Forwarded-User + Remote-User) | Grafana 读 X-Forwarded-User; Superset FAB 硬编码读 REMOTE_USER |
| 配置注入 | sed 模板 + AUTHELIA_* 环境变量 | Authelia YAML 不支持 ${VAR}; 密钥不写入文件 |
| 降级策略 | DP_SSO_ENABLED 开关 | false=空 include, 各应用独立认证 |
| Cookie 域名 | 开发留空 (host-only) / 生产 .foodsaid.com | RFC 规定 localhost 不能作 cookie domain |
| auth_request 缓存 | **不缓存** | 缓存导致 RBAC 失效 (同 session 不同路径共享缓存 → 越权) |

### 安全措施

1. **Header 防伪造**: 每个 location 先清除 4 个 auth header (`""`) 再注入 Authelia 验证值
2. **登录限速**: `limit_req_zone` 1r/s burst=3 (仅 IP, 不含 UA 防伪造绕过)
3. **Authelia 内置防暴力**: 5 次/2 分钟 → 封禁 10 分钟
4. **Grafana 白名单**: `GF_AUTH_PROXY_WHITELIST` 限制 Docker 内网段
5. **HSTS**: 生产环境强制 HTTPS (仅 conf.d-prod)
6. **auth_request 2s 超时**: Authelia 挂时快速降级到 503

### 架构图

```
浏览器 → dp-gateway (nginx)
           ├─ auth_request → dp-sso (Authelia :9091)
           │                   200 OK + X-Forwarded-User + Remote-User
           ├─ /wms/          → dp-wms-web          (P2, SSO 保护)
           ├─ /              → landing/index.html   (门户导航页, 公开)
           ├─ /superset/*    → dp-bi               (P3, SSO + Remote-User)
           ├─ /grafana/      → dp-grafana           (P1, SSO + Auth Proxy)
           ├─ /prometheus/   → dp-prometheus         (P1, SSO 门禁)
           ├─ /alertmanager/ → dp-alertmanager       (P1, SSO 门禁)
           ├─ /auth/         → dp-sso (登录门户)    (公开)
           ├─ /api/auth/whoami → dp-sso             (统一身份端点)
           ├─ /api/wms/*     → dp-wf               (bypass, 不经 SSO)
           └─ wf.* 子域名    → dp-wf               (不纳入 SSO)
```

### 实施阶段

| 阶段 | 目标 | 状态 |
|------|------|------|
| P1 | Authelia 部署 + 监控保护 (Grafana/Prometheus/Alertmanager) | ✅ 已完成 |
| P2 | WMS 集成 (SSO whoami + env.js SSO_ENABLED + logout) | ✅ 已完成 |
| P3 | BI + Grafana 深度集成 (Auth Proxy + FLASK_APP_MUTATOR + Remote-User) | ✅ 已完成 |

### 新增基础设施

| 容器 | 镜像 | 职责 |
|------|------|------|
| dp-sso | authelia/authelia:4.39.15 | SSO 统一认证 (profiles: ["sso"]) |
| dp-cache-sso | redis:7.4-alpine | SSO 会话存储 (noeviction, 128MB) |

### 新增/修改文件

| 文件 | 说明 |
|------|------|
| `infrastructure/sso/configuration.yml` | Authelia 配置模板 |
| `infrastructure/sso/users.yml.example` | 用户模板 (Git 跟踪) |
| `infrastructure/redis/sso.conf` | SSO Redis 配置 |
| `infrastructure/nginx/27-sso-auth-toggle.sh` | SSO 开关脚本 |
| `infrastructure/postgres/init/07_sso_schema.sh` | PG schema 初始化 |
| `docs/ADR/008-authelia-sso.md` | 本文档 |

### 环境变量

| 变量 | 说明 |
|------|------|
| `DP_SSO_ENABLED` | 总开关 (false/true) |
| `DP_DOMAIN` | 主域名 (URL 用) |
| `DP_SSO_COOKIE_DOMAIN` | Cookie 域名 (跨子域用) |
| `DP_SSO_JWT_SECRET` | Authelia JWT 密钥 |
| `DP_SSO_SESSION_SECRET` | 会话密钥 |
| `DP_SSO_STORAGE_ENCRYPTION_KEY` | 存储加密密钥 |
| `DP_SSO_PORT` | 开发直连端口 |
| `DP_SSO_REDIS_PASSWORD` | SSO Redis 密码 |

## 后果

### 正面
- 统一登录体验, 消除 4 套独立认证
- 监控端口不再暴露, 所有管理界面受 SSO 保护
- DP_SSO_ENABLED 开关确保零风险回退
- 渐进式迁移, P1 不影响现有 WMS/BI 认证

### 负面
- 新增 2 个容器 (dp-sso + dp-cache-sso), 约增 300MB 内存
- 首次部署需生成 4 个密钥 + 创建用户
- HTTPS 在开发环境需 mkcert 自签证书 (secure cookie)
- SHA-256 密码不兼容 argon2id, P2 迁移时需用户重置密码

## 风险缓解

| 风险 | 缓解 |
|------|------|
| Authelia 挂掉 → 全站不可用 | DP_SSO_ENABLED 开关 + 2s 超时 + 503 降级 |
| Header 伪造 | 先清后设 4 个 auth header |
| 暴力破解 | nginx 限速 + Authelia regulation |
| Redis 会话丢失 | 独立实例 noeviction, 重启后用户重新登录 |
| auth_request 缓存越权 | 不缓存 (Authelia 毫秒级验证) |

## 未来预留

- OIDC 骨架 (注释状态, 取消注释启用 Google OAuth)
- `/sso/*` API namespace (统一身份端点)
- AUTH_ROLES_MAPPING (Authelia groups → Superset 角色自动映射)
