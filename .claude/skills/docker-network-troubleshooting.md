# Docker 网络 · 环境配置 · 离线高可用

> **创建**: 2026-02-24
> **更新**: 2026-03-05
> **场景**: DP v0.1 容器编排 (docker compose)
> **合并**: 原 env-driven-config-changes.md 内容已整合至此

---

## 一、nginx 上游 DNS 缓存陷阱

### 问题现象
重启上游容器 (如 `dp-wf`) 后，nginx 网关返回 **502 Bad Gateway**。

### 根因
1. Docker 容器重启后 IP 会变 (bridge 网络动态分配)
2. nginx 启动时解析一次 DNS 并缓存，之后不再查询
3. 上游 IP 变了 → nginx 仍向旧 IP 发请求 → 502

### 触发条件
- `docker restart dp-wf` (或任何 nginx 上游容器)
- `docker compose up -d dp-wf` (重建容器)
- 容器 OOM 被 Docker 自动重启
- **不会触发**: `docker compose up -d` 全量启动 (nginx 也一起启动)

### 诊断
```bash
# 查看 nginx 错误日志
docker logs dp-gateway --tail 20 2>&1 | grep -E "502|upstream|connect"

# 从 nginx 内部直连验证
docker exec dp-gateway wget -qO- --timeout=3 http://dp-wf:5678/ 2>&1 | head -5
```

### 强制规则 (必须遵守)
**重建/重启任何 nginx 上游容器后，必须 reload 网关**:
```bash
# 重建上游容器后 (如 docker compose up -d --build dp-wms-web)
docker exec dp-gateway nginx -s reload    # ← 必须! 否则 502

# 或者重启上游容器后 (如 docker restart dp-wf)
docker restart dp-wf && sleep 8 && docker exec dp-gateway nginx -s reload
```

> **教训 (2026-03-10)**: 重建 `dp-wms-web` 后忘记 reload 网关，nginx 缓存旧 IP `172.18.0.6`，
> 导致 `/wms/` 全部 502 (`Host is unreachable`)。`nginx -s reload` 后立即恢复。

### 优先级
- **生产环境**: 优先 `nginx -s reload` (零停机，不中断已有连接)
- **开发环境**: `nginx -s reload` 或 `docker restart dp-gateway` 均可

### 上游依赖
```
dp-gateway (nginx) 上游:
  dp-wms-web:80    (WMS 前端)
  dp-wf:5678       (n8n)  <- 最常重启
  dp-bi:8088       (Superset)
```

---

## 二、n8n 工作流同步 SOP

通过 CLI 导入/更新工作流后，n8n **不会自动热加载**。

```bash
# 1. 导入
docker cp /tmp/wfXX.json dp-wf:/data/
docker exec dp-wf n8n import:workflow --input=/data/wfXX.json

# 2. 激活
docker exec dp-wf n8n update:workflow --id=XXX --active=true

# 3. 重启 n8n (必须)
docker restart dp-wf

# 4. 重启网关 (DNS 缓存)
sleep 8 && docker restart dp-gateway
```

---

## 三、离线高可用 — 断网仍能作业

### 设计原则
WMS 是仓库作业核心系统，**不能因为互联网中断而停止工作**。

### 离线架构
```
PDA/手机  -> DP_LOCAL_IP:8080 -> dp-gateway -> WMS + API
PC 浏览器 -> localhost:8080   -> dp-gateway -> WMS + API
n8n 编辑  -> DP_LOCAL_IP:5678 -> dp-wf      -> n8n 编辑器
```

### 关键配置
```yaml
# docker-compose.dev.yml (开发模式覆盖, 离线可用)
dp-wf:
  environment:
    WEBHOOK_URL: http://${DP_LOCAL_IP:-localhost}:${DP_GATEWAY_PORT:-8080}
    # N8N_EDITOR_BASE_URL 不要覆盖 (见第五节)
```

```bash
# .env (每台机器独立配置, 不提交 Git)
DP_LOCAL_IP=192.168.x.x    # 换 IP 只改这一处
```

### 离线阻断点清单 (已全部消除)

| 组件 | 阻断点 | 解决方案 |
|------|--------|---------|
| 前端 JS 库 | CDN (jsdelivr/cloudflare) | 自托管到 apps/wms/vendor/ |
| n8n WEBHOOK_URL | 指向域名 | dev.yml 覆盖为 DP_LOCAL_IP |
| n8n EDITOR_BASE_URL | 指向域名 | 不覆盖! n8n 根据 Host 自适配 |
| API 调用 | 无 | /api/wms 相对路径自动适配 |
| 数据库 | 无 | 本地 PostgreSQL |
| Redis | 无 | 本地 Redis |

### 禁止事项
- **禁止** 硬编码 IP 地址到源码 (192.168.x.x)
- **禁止** 硬编码域名到源码 (*.example.com)
- IP 和域名只允许出现在 .env 和 docker-compose.*.yml 中

---

## 四、速查

```bash
# nginx 热重载
docker exec dp-gateway nginx -s reload

# 检查 n8n 环境变量
docker exec dp-wf env | grep -E "WEBHOOK_URL|N8N_EDITOR"

# 检查工作流激活状态
docker exec dp-wf n8n list:workflow --active=false
```

---

## 五、N8N_EDITOR_BASE_URL 踩坑

### 问题现象
域名访问 n8n 编辑器 (wf.example.com) 显示空白页，本地 localhost:5678 正常。

### 根因
`N8N_EDITOR_BASE_URL` 控制 n8n 生成 HTML 的 `<base href>`：
- 设为局域网 IP → HTML 中 base href 指向 LAN
- 域名用户浏览器从 LAN IP 加载 JS/CSS → 无法访问 → 空白页

### WEBHOOK_URL vs N8N_EDITOR_BASE_URL
| 变量 | 控制 | 能否安全覆盖 |
|------|------|-------------|
| WEBHOOK_URL | webhook 显示 URL (编辑器界面) | 可以，只影响显示 |
| N8N_EDITOR_BASE_URL | JS/CSS 资源加载路径 (base href) | 不能随意覆盖 |

### 正确做法
```yaml
# docker-compose.dev.yml — 只覆盖 WEBHOOK_URL
dp-wf:
  environment:
    WEBHOOK_URL: http://${DP_LOCAL_IP:-localhost}:${DP_GATEWAY_PORT:-8080}
    # N8N_EDITOR_BASE_URL 不要覆盖! n8n 默认根据请求 Host 自动适配
```

---

## 六、Docker Compose 多层叠加端口冲突

### 问题现象
用 dev compose 单独重建容器后，生产域名不可访问，Cloudflare Tunnel 报 502。

### 根因
DP 项目使用三层 compose 叠加:
```
docker-compose.yml         — 基础层 (无端口映射)
docker-compose.dev.yml     — 开发层 (映射 8080→80, 5678→5678 等)
docker-compose.prod.yml    — 生产层 (映射 80→80, 443→443)
```

**错误操作**: 只用 dev 层重建
```bash
# ❌ 丢失生产端口 80/443
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d dp-gateway dp-wf
# 结果: dp-gateway 只有 8080→80, 没有 80→80 和 443→443
# Cloudflare Tunnel 连 localhost:80 → Connection refused
```

### 正确做法
```bash
# ✅ 三层全加 (开发+生产端口共存)
docker compose -f docker-compose.yml \
  -f docker-compose.dev.yml \
  -f docker-compose.prod.yml \
  up -d dp-gateway dp-wf

# 验证: dp-gateway 应有三个端口映射
docker ps --format "{{.Names}} {{.Ports}}" | grep dp-gateway
# 期望: 0.0.0.0:80->80, 0.0.0.0:443->443, 0.0.0.0:8080->80
```

### 端口映射规则
| compose 层 | dp-gateway 端口 | dp-wf 端口 | 用途 |
|-----------|----------------|-----------|------|
| dev.yml | 8080→80 | 5678→5678 | 本地开发 (localhost) |
| prod.yml | 80→80, 443→443 | — | 生产域名 (Cloudflare Tunnel) |
| dev+prod | 全部 | 5678→5678 | 开发+生产共存 |

### 关键规则
1. **`docker restart` 不会改变端口映射** — 只重启进程，端口保持创建时的配置
2. **`docker compose up -d` 会重建容器** — 端口映射取决于当时使用的 compose 文件组合
3. **重建任何容器时，必须使用与首次启动相同的 compose 文件组合**
4. **Cloudflare Tunnel (dp-tunnel)** 连接 `localhost:80` → 如果 80 端口缺失则域名不可访问

### 诊断流程
```bash
# 1. 检查端口映射是否完整
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep dp-gateway

# 2. 缺少 80/443 → 需要加 prod.yml 重建
docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.prod.yml up -d dp-gateway

# 3. 验证外部访问
curl -s -o /dev/null -w "%{http_code}" http://localhost:80/     # 生产端口
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/   # 开发端口

# 4. Tunnel 状态
docker logs dp-tunnel --tail 10 2>&1 | grep -E "ERR|connected"
```

### 快捷记忆
```
❌ 只用 dev.yml 重建 → 丢生产端口 → 域名挂掉
❌ 只用 prod.yml 重建 → 丢开发端口 → localhost 挂掉
✅ dev.yml + prod.yml 一起 → 端口共存 → 全部正常
```

---

## 七、测试网关 envsubst 动态配置

### 架构
测试域名 (如 WMS 测试环境) 通过 envsubst 在容器启动时动态生成 nginx 配置，避免硬编码域名到源码。

```
.env                          → DP_WMS_TEST_DOMAIN=test.example.com
conf.template                 → server_name ${DP_WMS_TEST_DOMAIN};
25-wms-test-envsubst.sh       → envsubst 生成 → /etc/nginx/dynamic/wms-test.conf
nginx.conf include dynamic/*  → nginx 加载动态配置
```

### 踩坑 1: entrypoint 脚本无执行权限
**现象**: 容器启动正常，但动态配置未生成，测试域名落入默认 server block。
**根因**: WSL 挂载的 `.sh` 文件丢失 `+x` 权限，nginx 官方镜像的 entrypoint 输出 `Ignoring, not executable`。
**修复**: `chmod +x infrastructure/nginx/25-wms-test-envsubst.sh` + `--force-recreate dp-gateway`
**预防**: `.gitattributes` 中标记 `*.sh text eol=lf` 不够，WSL 挂载时权限仍可能丢失。compose 中可改用 `command: ["/bin/sh", "-c", "sh /docker-entrypoint.d/25-wms-test-envsubst.sh && nginx -g 'daemon off;'"]` 避免权限依赖。

### 踩坑 2: 测试网关缺少 API 路由
**现象**: 测试域名前端页面正常，但 API 请求 (`/api/wms/...`) 返回 404。
**根因**: 网关模板只配了 `location /` 透明代理到测试容器 (dp-wms-test)，而测试容器内部 nginx 只服务静态文件，没有 API 反向代理。API 请求需要转发到 n8n (dp-wf)。
**修复**: 在模板中添加 `/api/wms/`、`/api/webhook/`、`/api/webhook-test/` 三个 location，复用主站的 `wf_engine` upstream。
**规则**: 任何新增域名/子域名的网关模板，必须同时配置 **静态文件路由** + **API 路由**，不能只做透明代理。

### 踩坑 3: 禁止硬编码域名到 nginx 配置
**现象**: 直接在 `conf.d-prod/default.conf` 添加了测试域名的 server block。
**根因**: 违反 CLAUDE.md 规则 "禁止硬编码域名"。正确做法是通过 envsubst 模板 + 环境变量动态生成。
**规则**: 新增域名路由时，检查是否已有 envsubst 机制。有 → 用环境变量；无 → 新建模板 + entrypoint 脚本。

---

## 八、.env 环境变量驱动 (零代码配置变更)

DP 项目所有运行时配置均通过 `.env` 环境变量驱动，**源码中零硬编码**。

### `restart` vs `up -d` (最高频踩坑!)
| 命令 | 重读 .env | 重建容器 | 重新生成 env.js |
|------|:---------:|:--------:|:--------------:|
| `docker compose restart` | ❌ | ❌ | ✅ (重跑 entrypoint) |
| `docker compose up -d` | ✅ | ✅ (检测到配置变化时) | ✅ |

**关键**: 修改 `.env` 后必须用 `up -d`，`restart` 不会重新读取环境变量！

### env.js 多容器隔离 (v0.1.9+)
`dp-wms-web` 和 `dp-wms-test` 都 bind-mount `apps/wms/` 目录。
env.js 写到容器内部 `/var/run/wms-env/env.js`，nginx 通过 `location = /env.js { root /var/run/wms-env; }` 读取。
**不再写入 bind-mount 目录**，避免后启动的容器覆盖前面的。

### Docker bind-mount 权限污染 (WSL2)
容器内 nginx 以 `messagebus` 用户运行，bind-mount 时会改变文件/目录属主。
```bash
# 诊断+修复
ls -ld apps/wms/   # drwxr-xr-x messagebus ...
sudo chown -R $(whoami):$(whoami) apps/wms/
```

### .env 参数速查
| 参数 | 影响范围 | 变更后操作 |
|------|---------|-----------|
| `ENV_NAME` | WMS 前端环境标识/横幅 | `up -d dp-wms-web` |
| `DP_WMS_TEST_DOMAIN` | 网关 WMS 测试路由 | `up -d dp-gateway` |
| `DP_COMPANY_CODE` | 全部 WMS 数据隔离 | `up -d` + 数据迁移 |
| `WEBHOOK_URL` | n8n webhook 回调地址 | `up -d` |
| `SYSTEM_TIMEZONE` | 所有容器时区 | `up -d` |
| `DP_*_PORT` | 各服务端口 | `up -d` (需 dev overlay) |
| `SAP_SL_*` / `SAP_MSSQL_*` | SAP 连接参数 | `up -d` |

**通用规则**: 任何 `.env` 变更 → `docker compose ... up -d` → 验证日志/配置

---

## 教训总结

| 要点 | 说明 |
|------|------|
| **重建/重启上游后必须 reload 网关** | **`docker exec dp-gateway nginx -s reload` — 忘记就 502** |
| nginx 不是动态 DNS | 启动时解析一次，之后不再查询 |
| CDN 是离线致命点 | 自托管到 vendor/ 消除 |
| IP 不能硬编码 | 放 .env 的 DP_LOCAL_IP |
| dev/prod 用 compose 覆盖 | dev.yml = 本地, prod.yml = 域名 |
| N8N_EDITOR_BASE_URL 不能覆盖 | 它控制 base href，影响 JS/CSS 加载 |
| compose 重建必须全部层 | 丢任何一层 → 丢对应端口映射 |
| **docker restart ≠ compose up** | **restart 不重读 .env，up -d 才会** |
| 测试域名用 envsubst 动态生成 | 禁止硬编码到 conf.d-prod/ |
| entrypoint 脚本需 +x 权限 | WSL 挂载可能丢失执行权限 |
| 新域名网关必须含 API 路由 | 不能只做透明代理到前端容器 |
| env.js 写容器内部 | 不写 bind-mount 目录，防容器间覆盖 |
