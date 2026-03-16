# Authelia SSO 集成经验与教训

> **版本**: v2.0 (2026-03-11)
> **适用**: Authelia v4.39.15 + nginx auth_request + Docker Compose
> **范围**: 从零搭建到多域名 SSO 全覆盖的完整经验

---

## 1. Authelia 配置注入 — 双轨机制 (最重要)

### 问题
Authelia YAML 解析器**不支持** `${VAR}` Shell 风格变量插值。直接在 YAML 中写 `${DP_DOMAIN}` 会被当作字面字符串。

### 解决方案: 双轨注入
| 类型 | 注入方式 | 示例 |
|------|---------|------|
| **密钥** | `AUTHELIA_*` 环境变量 (Authelia 原生机制) | `AUTHELIA_JWT_SECRET`, `AUTHELIA_SESSION_SECRET` |
| **域名/数据库** | `__PLACEHOLDER__` + `sed` 替换 | `__DP_DOMAIN__`, `__DP_DB_NAME__` |

### 注意事项
- 密钥**永远不写入文件**, 只通过环境变量注入
- Docker Compose 中 `$$` 转义为容器内的 `$` (如 `$$DP_DOMAIN` → 容器看到 `$DP_DOMAIN`)
- sed 替换仅处理非密钥值 (域名/cookie 域名/数据库名/用户名)

---

## 2. BusyBox sed 多行插入 — Alpine 容器陷阱

### 问题
Authelia 官方镜像基于 Alpine, 使用 BusyBox sed。`sed "s/pattern/line1\nline2/"` 中的 `\n` **不会**产生换行, 而是输出字面的 `\n`, 导致 YAML 解析错误:
```
yaml: line 27: did not find expected key
```

### 解决方案: printf + sed -r
```bash
# ❌ 错误: BusyBox sed 不支持 \n 换行
sed -i "s/PLACEHOLDER/line1\nline2/" file.yml

# ✅ 正确: printf 生成临时文件 + sed -r 读入
printf "    - domain: '%s'\n      authelia_url: 'https://%s/auth'\n" "$DOMAIN" "$DOMAIN" > /tmp/block.yml
sed -i '/PLACEHOLDER/r /tmp/block.yml' file.yml
sed -i '/PLACEHOLDER/d' file.yml
```

### 适用范围
- 所有基于 Alpine/BusyBox 的容器 (Authelia, Redis Alpine, nginx Alpine 等)
- GNU sed (Ubuntu/Debian) 支持 `\n`, 但不要依赖 — 保持跨平台兼容

---

## 3. Cloudflare Tunnel + nginx: $scheme vs $real_scheme

### 问题
Cloudflare Tunnel 终止 TLS 后, 以 HTTP 连接内部 nginx。此时:
- `$scheme` = `http` (nginx 监听的协议)
- 实际客户端 = `https` (Cloudflare 外层)

Authelia 收到 `X-Original-URL: http://app.foodsaid.com/wms/` 但 cookie 配置为 `https://app.foodsaid.com`, 域名匹配失败 → 认证失效 → "SSO 暂不可用"。

### 解决方案
nginx.conf http 块定义 map:
```nginx
map $http_x_forwarded_proto $real_scheme {
    default $scheme;
    https   https;
}
```

**所有** auth_request 相关 header 使用 `$real_scheme`:
```nginx
proxy_set_header X-Original-URL $real_scheme://$http_host$request_uri;
proxy_set_header X-Forwarded-Proto $real_scheme;
```

### 影响范围
- `/auth/` 代理 (SSO 登录门户)
- `/auth/api/(firstfactor|secondfactor)` (登录 API)
- `/internal/authelia/authz` (auth_request 验证端点)
- **生产 nginx 使用 `$x_proto` 变量** (`set $x_proto https;` 在 HTTPS server 块), 不受影响
- **开发 nginx 必须用 `$real_scheme`** (Tunnel 走 HTTP:80)

---

## 4. Authelia 多域名 Cookie 配置

### 问题
开发环境用 `127.0.0.1:18443`, 生产/UAT 用 Cloudflare Tunnel `app.foodsaid.com`。单一 cookie 域名无法覆盖两种访问方式。

### 解决方案: 动态注入多域名 cookie
在 `configuration.yml` 模板中使用占位符:
```yaml
session:
  cookies:
    - domain: '__DP_SSO_COOKIE_DOMAIN__'
      authelia_url: '__DP_SSO_BASE_URL__/auth'
      default_redirection_url: '__DP_SSO_BASE_URL__'
    # __TUNNEL_COOKIE_PLACEHOLDER__ (由 entrypoint 脚本条件注入)
```

Docker Compose entrypoint 中条件注入:
```bash
if [ -n "$DP_SSO_TUNNEL_DOMAIN" ]; then
    # 生成 tunnel cookie YAML 块
    printf "    - domain: '%s'\n..." "$TCD" > /tmp/tunnel_cookie.yml
    sed -i '/__TUNNEL_COOKIE_PLACEHOLDER__/r /tmp/tunnel_cookie.yml' /tmp/configuration.yml
    sed -i '/__TUNNEL_COOKIE_PLACEHOLDER__/d' /tmp/configuration.yml
else
    # 清除所有 tunnel 占位符
    sed -i '/__TUNNEL_/d' /tmp/configuration.yml
fi
```

### 环境变量
```bash
DP_SSO_TUNNEL_DOMAIN=app.foodsaid.com      # Tunnel 外部域名
DP_SSO_TUNNEL_COOKIE_DOMAIN=app.foodsaid.com  # Cookie 域名 (通常相同)
```

---

## 5. Superset 6.0 SSO 集成 — FLASK_APP_MUTATOR 绕过

### 问题
Superset 6.0 的 `SupersetAuthView.login()` **完全覆盖** FAB 的 `AuthRemoteUserView`, 从不读取 `REMOTE_USER` environ。即使配置了 `AUTH_TYPE = AUTH_REMOTE_USER`, 登录页仍然渲染 React SPA 而非自动认证。

### 解决方案: before_request hook
```python
if os.environ.get('DP_SSO_ENABLED', 'false').lower() == 'true':
    from flask_appbuilder.security.manager import AUTH_REMOTE_USER
    AUTH_TYPE = AUTH_REMOTE_USER
    AUTH_USER_REGISTRATION = True
    AUTH_USER_REGISTRATION_ROLE = 'Alpha'  # 不要用 Public (全 403)

    def FLASK_APP_MUTATOR(app):
        @app.before_request
        def sso_remote_user_auth():
            from flask import request, g, redirect
            from flask_login import login_user
            username = request.environ.get('HTTP_REMOTE_USER')
            if not username:
                return
            if g.user is not None and g.user.is_authenticated:
                if request.path in ('/login/', '/login'):
                    return redirect(request.args.get('next', '/superset/welcome/'))
                return
            sm = app.appbuilder.sm
            user = sm.auth_user_remote_user(username)
            if user:
                login_user(user)
                if request.path in ('/login/', '/login'):
                    return redirect(request.args.get('next', '/superset/welcome/'))
```

### 关键教训
| 教训 | 说明 |
|------|------|
| `HTTP_REMOTE_USER` 不是 `REMOTE_USER` | nginx `Remote-User` header → WSGI `HTTP_REMOTE_USER` (带 HTTP_ 前缀) |
| `AUTH_USER_REGISTRATION_ROLE` 不能是 `Public` | Public 角色 = 所有 API 返回 403 = 页面白屏/无限加载 |
| `Alpha` 是最低可用角色 | SQL Lab + 创建图表, 管理员需手动提权为 Admin |
| `/login/` 路径必须拦截 | Superset 内部 302 → /login/ → 渲染 React 登录页 → 循环 |
| `ENABLE_PROXY_FIX = True` 必须全局 | 不在 if SSO 块内, 否则 X-Forwarded-Proto 不生效 → http/https 循环 |

---

## 6. nginx auth_request Header 安全

### 4 头全清原则
每个 SSO 保护的 location **必须**:
1. 先清除 4 个 header (防客户端伪造)
2. 再 include sso-headers.conf 注入真实值

```nginx
location /grafana/ {
    include /etc/nginx/dynamic/sso-auth.conf;
    # Step 1: 清除 (防伪造)
    proxy_set_header X-Forwarded-User "";
    proxy_set_header Remote-User "";
    proxy_set_header X-Forwarded-Groups "";
    proxy_set_header X-Forwarded-Email "";
    # Step 2: 注入真实值
    include /etc/nginx/dynamic/sso-headers.conf;
    # Step 3: 标准 proxy headers (必须重写, include 会清空继承!)
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $real_scheme;
}
```

### nginx 继承陷阱
location 块内出现**任何** `proxy_set_header` (包括 include 引入的) → **立刻清空**外层继承的全部 `proxy_set_header`。必须在每个 location 内**显式写全**所有 proxy header。

---

## 7. Docker 容器镜像重建时机

### 问题
WMS 容器 env.js 缺少 `SSO_ENABLED: true`。原因: Docker 镜像是 SSO 代码添加**之前**构建的, entrypoint 脚本是旧版本 (不含 SSO 逻辑)。

### 解决方案
修改 entrypoint 脚本 / Dockerfile 后, 必须:
```bash
docker compose build dp-wms-web   # 重建镜像
docker compose up -d dp-wms-web   # 重建容器 (使用新镜像)
```

### 教训
- `docker restart` 不会更新镜像 — 只重启现有容器
- `docker compose up -d` 如果镜像哈希相同, 不会重建 — 必须先 build
- env.js 在容器**启动时**由 entrypoint 生成, 不是构建时

---

## 8. Authelia 用户管理

### 密码哈希生成
```bash
# 在 Authelia 容器内生成 argon2id 哈希
docker exec dp-sso authelia crypto hash generate argon2 --password '新密码'

# 将输出的哈希写入 users.yml, 然后重启
docker restart dp-sso
```

### 注意事项
- users.yml 中密码哈希包含 `$` 符号, YAML 中必须用**单引号**包裹
- argon2id 是 Authelia 默认且推荐的算法
- SHA-256 (WMS 旧系统) 与 argon2id **不兼容**, 迁移时需用户重置密码
- **密码必须用单引号传递** — 双引号会被 shell 转义 (`\$` → `$`, `\\` → `\`), 导致哈希的密码与用户实际输入不一致
- 可用 `authelia crypto hash validate` 验证密码与哈希匹配:
  ```bash
  docker exec dp-sso authelia crypto hash validate --password '密码' -- '$argon2id$...'
  ```
- **Tunnel 域名配置**: 启用 Cloudflare Tunnel 时必须设置 `DP_SSO_TUNNEL_DOMAIN` 和 `DP_SSO_TUNNEL_COOKIE_DOMAIN`, 否则 Authelia 对未知域名返回 400 → nginx 触发 @sso_down 降级

---

## 9. SSO 降级策略 (DP_SSO_ENABLED 开关)

### 设计
```bash
DP_SSO_ENABLED=false  # 默认关闭 SSO
DP_SSO_ENABLED=true   # 开启 SSO (需 --profile sso)
```

### 实现
- `27-sso-auth-toggle.sh`: 根据环境变量生成空文件或 auth_request 配置
- `sso-auth.inc` 为空 → include 无效果 → 各应用保持独立认证
- `sso-headers.inc` 为空 → 不注入 SSO header → 后端不受影响
- `sso-login-redirects.inc`: SSO 启用时各模块内置登录页 301 重定向 (WMS/Superset/Grafana)
- `docker-entrypoint.sh`: 将 `DP_SSO_ENABLED` 注入 env.js 的 `SSO_ENABLED` 字段
- `login.js`: 读取 `window.__ENV.SSO_ENABLED`，为 true 时 `location.replace('/wms/')`

### 关键: error_page 不吞后端错误
- `proxy_intercept_errors` 默认 `off` → 后端 5xx 直接透传
- error_page 仅在 nginx 内部错误时触发 (auth_request 子请求超时)
- 不在 server 块统一 error_page (会吞 Grafana/Superset 自身 500)

---

## 10. Authelia + Cloudflare Tunnel 访问控制

### access_control 域名匹配
Authelia 需要 access_control rules 中包含实际访问域名, 否则默认 deny:

```yaml
access_control:
  rules:
    - domain:
        - '127.0.0.1'        # 本地访问
        - '*.127.0.0.1'      # 本地子域名
        - 'app.foodsaid.com'    # Tunnel 域名 (动态注入)
        - '*.app.foodsaid.com'  # Tunnel 子域名 (动态注入)
      policy: 'bypass'
      resources:
        - '^/api/wms(/.*)?$'  # WMS API 公开
```

### Tunnel 域名动态注入
使用占位符 `# __TUNNEL_DOMAIN_BYPASS__` / `# __TUNNEL_DOMAIN_ADMIN__` / `# __TUNNEL_DOMAIN_ALL__`, entrypoint 中用 sed -r 替换为实际域名列表。

---

## 11. 调试 SSO 问题的检查清单

```bash
# 1. Authelia 容器健康
docker compose ps dp-sso dp-cache-sso

# 2. 检查 sed 模板渲染结果 (验证无 __PLACEHOLDER__ 残留)
docker exec dp-sso cat /tmp/configuration.yml | grep -E '__|domain|cookie'

# 3. 检查 sso-auth.conf 是否生成
docker exec dp-gateway cat /etc/nginx/dynamic/sso-auth.conf

# 4. 检查 env.js SSO_ENABLED
docker exec dp-wms-web cat /usr/share/nginx/html/env.js | grep SSO

# 5. 测试 whoami 端点
curl -s http://localhost:18080/api/auth/whoami  # 401 = 未登录正常

# 6. 测试 Header 防伪造
curl -H "X-Forwarded-User: hacker" http://localhost:18080/grafana/
# 后端应收到空 header, 非 "hacker"

# 7. 检查 Authelia 日志
docker logs dp-sso --tail 50

# 8. 检查 nginx $real_scheme (Tunnel 场景)
# 确认 X-Original-URL 使用 https:// 而非 http://
docker exec dp-gateway nginx -T 2>/dev/null | grep -A2 X-Original-URL
```

---

## 12. Redis 实例隔离 — SSO 会话必须独立

### 为什么不复用 dp-cache-bi
dp-cache-bi 使用 `allkeys-lru` 策略, eviction 是**实例级** (非 db 级)。SSO 会话若与 BI 缓存同实例, 会被 LRU eviction 随机踢掉 → 用户随机登出。

### dp-cache-sso 配置
```
maxmemory 128mb
maxmemory-policy noeviction  # 会话满时报错, 不踢旧数据
databases 1
save ""                       # 纯内存, 不持久化
appendonly no                  # 重启后用户重新登录即可
```

---

## 13. nginx error_page 403 — 内部重定向 vs 外部 302

### 问题
`error_page 403 =302 /;` 做的是**内部重定向** (类似 rewrite), 不产生 `Location` 头。浏览器 XHR 拿到的是 302 状态码 + landing 页 HTML body, 而不是真正的跳转。SPA 应用 (如 Superset) 会展示错误而非跳转。

### 解决方案: named location + return 302
```nginx
# ❌ 内部重定向, 无 Location 头
error_page 403 =302 /;

# ✅ 真正的外部 302 重定向
error_page 403 = @access_denied;
location @access_denied {
    return 302 /?rd=$request_uri;  # 带 rd 参数记录原始目标
}
```

### 关键
- `error_page` 的 `=302 URI` 语法是内部重定向, 不等于 HTTP 302
- `return 302 URL` 才会产生真正的 `Location` 头

---

## 14. nginx rewrite vs return — auth_request 阶段差异

### 问题
```nginx
location ~* ^/bi/?$ {
    rewrite ^ /superset/welcome/ last;  # ❌ rewrite 阶段先于 access 阶段
}
```
`rewrite ... last` 在 **rewrite 阶段**执行, 直接跳到 `/superset/welcome/` 的 location, 跳过了**当前 location** 的 access 阶段 (auth_request)。无权限用户通过 `/bi/` 入口直接加载 Superset HTML。

### 解决方案: return 302 (外部重定向)
```nginx
location ~* ^/bi/?$ {
    return 302 /superset/welcome/;  # ✅ 客户端重新发起请求, 走 /superset/ auth_request
}
```

### 原理
- `rewrite ... last`: nginx 内部跳转, 在同一请求内切换 location (不经过新 location 的 access 阶段)
- `return 302`: 告诉客户端重新请求, 新请求会完整走目标 location 的所有阶段

---

## 15. 动态 nginx 配置文件命名 — .conf vs .inc 陷阱

### 问题
`nginx.conf` 中 `include /etc/nginx/dynamic/*.conf;` 位于 http 块, 会匹配所有 `.conf` 文件。SSO 配置 (`sso-auth.conf`, `sso-headers.conf`) 生成到 `/etc/nginx/dynamic/` 目录, 被 glob 匹配后在 **http 块**生效, 导致所有 server block (包括 n8n 独立子域名) 都被 SSO 保护。

### 解决方案
- 动态生成的 SSO include 文件使用 `.inc` 后缀 (非 `.conf`)
- `sso-auth.conf` → `sso-auth.inc`, `sso-headers.conf` → `sso-headers.inc`
- `.inc` 文件只在需要的 location 内 `include`, 不被 `*.conf` glob 意外捕获

---

## 16. SSO 登出后智能跳回原页面

### 问题
用户从 WMS/BI 退出后, 总是回到 landing 首页, 需要手动导航回原页面。

### 解决方案: rd 参数传递链
```
WMS 退出 → POST /auth/api/logout → landing/?rd=/wms/
                                        ↓
                              已登录 → 自动跳回 /wms/ (auth_request 再校验)
                              未登录 → 登录按钮 href="/auth/?rd=https://host/wms/"
                                        ↓
                              Authelia 登录成功 → 跳回 /wms/
                                        ↓
                              有权限 → 正常访问
                              无权限 → 403 → @access_denied → landing/?rd=/wms/
```

### 实现要点
1. **WMS shared.js logout()**: `fetch('/auth/api/logout', {method:'POST'}).finally(() => location.href='/?rd='+path)`
2. **Landing index.html**: 读取 `URLSearchParams` 的 `rd` 参数, 已登录自动跳转, 未登录传递给 Authelia
3. **nginx @access_denied**: `return 302 /?rd=$request_uri;` 无权限时带目标路径回 landing
4. **安全校验**: landing JS 校验 `rd` 必须以 `/` 开头且不以 `//` 开头 (防 open redirect)
5. **Authelia 4.39.x logout API**: POST `/auth/api/logout` 返回 JSON, 不像 GET `/auth/logout` 会自己做重定向
6. **Authelia rd 参数**: 登录时接受完整 URL (非相对路径), 格式: `/auth/?rd=https://host/path`

---

## 速查: 常见错误与修复

| 症状 | 原因 | 修复 |
|------|------|------|
| "SSO 暂不可用" (503 HTML) | dp-sso 未启动或不健康 | `docker compose --profile sso up -d` |
| 登录后仍跳回 /auth/ | Cookie 域名不匹配 (检查 DP_SSO_COOKIE_DOMAIN) | 确保 cookie domain 与访问域名一致 |
| BI 全白屏/403 | SSO 用户角色为 Public | DB 改 `bi.ab_user_role` 或改 `AUTH_USER_REGISTRATION_ROLE` |
| BI 无限加载 | /login/ 重定向循环 | 检查 FLASK_APP_MUTATOR 是否拦截 /login/ |
| Tunnel 访问被拒 | access_control 无 Tunnel 域名 | 检查 DP_SSO_TUNNEL_DOMAIN 环境变量 |
| YAML 解析错误 line 27 | BusyBox sed `\n` 不生效 | 用 printf + sed -r 方式 |
| env.js 无 SSO_ENABLED | 容器镜像未重建 | `docker compose build dp-wms-web` |
| auth_request 无限 302 | X-Original-URL 用了 $scheme (应为 $real_scheme) | 修正 nginx 配置 |
| Grafana "unauthorized" | Auth Proxy 未启用或 whitelist 不含 Docker 网段 | 检查 GF_AUTH_PROXY_* 环境变量 |
| `/bi/` 入口绕过 SSO | `rewrite ... last` 跳过 auth_request | 改为 `return 302 /superset/welcome/;` |
| 403 不跳转 (SPA 显示错误) | `error_page 403 =302` 是内部重定向 | 改为 named location `@access_denied` + `return 302` |
| n8n 独立子域名被 SSO 拦截 | `dynamic/*.conf` glob 在 http 块 | SSO 文件改 `.inc` 后缀 |
| 登出后无法跳回原页面 | logout 无 rd 参数 | WMS 用 API logout + `/?rd=路径`; landing 传递 rd 给 Authelia |
