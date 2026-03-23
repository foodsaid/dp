# 生产部署经验 (HTTPS + Cloudflare Tunnel + Split DNS)

> **合并自**: cloudflare-tunnel-performance.md + production-https-split-dns.md
> **场景**: DP 生产环境部署、Tunnel 性能诊断、证书管理、网络架构

---

## 一、架构总览

```
内网 PDA → WiFi → DNS (→ LAN IP) → dp-gateway:443 (LE cert)
外网用户 → 公网 DNS → Cloudflare → cloudflared → dp-gateway:443
两条路径 → 同一 nginx:443 → 同一后端 → 同 origin → 同 httpOnly cookie
```

### 核心组件

| 组件 | 作用 | 配置位置 |
|------|------|---------|
| Let's Encrypt 通配符证书 | `*.example.com` 公信证书 | `${DP_DATA_DIR}/certbot/` |
| nginx conf.d-prod/ | 4 个 server 块 (HTTP+HTTPS × 2域名) | `infrastructure/nginx/conf.d-prod/` |
| certbot/dns-cloudflare | DNS-01 验证生成证书 | `docker-compose.prod.yml` profile: certbot |
| dnsmasq (可选) | 工厂 Split DNS | `docker-compose.prod.yml` profile: dns |
| crontab | 每月 1/15 号自动续期 | `scripts/cert-renew.sh` |

---

## 二、Cloudflare Tunnel 性能诊断

### 2.1 QUIC UDP 缓冲区 — 延迟首因

**症状**: tunnel 日志出现 `failed to sufficiently increase receive buffer size`

**原因**: cloudflared 使用 QUIC 协议，需要 7MB UDP 缓冲区。WSL2 默认 `rmem_max=208KB` 导致丢包→重传→延迟。

**修复**:
```bash
sudo sysctl -w net.core.rmem_max=7340032
sudo sysctl -w net.core.wmem_max=7340032
# 持久化
echo "net.core.rmem_max=7340032" | sudo tee -a /etc/sysctl.d/99-sysctl.conf
echo "net.core.wmem_max=7340032" | sudo tee -a /etc/sysctl.d/99-sysctl.conf
```

**验证**: 修改后 `docker restart dp-tunnel`，确认日志警告消失。

### 2.2 多实例冲突 — 502 轮换首因

**症状**: 两个域名 502 轮换出现 (有时 A 502 B 200，有时反过来)

**根因**: Windows cloudflared 服务 + Docker dp-tunnel 用同一 TUNNEL_TOKEN → Cloudflare 负载均衡到旧实例 → 502

**诊断**:
```bash
sc.exe query cloudflared          # Windows 服务
tasklist.exe | grep cloudflare    # Windows 进程
docker ps | grep tunnel           # Docker 容器
```

**修复**: `sc.exe stop cloudflared && sc.exe config cloudflared start=disabled`

**关键**: 同一 Tunnel Token 绝不能跑两个 cloudflared。协议切换 (QUIC→HTTP/2) 不能解决此问题。

### 2.3 Tunnel 路由优化

**反模式**: ingress 用 `host.docker.internal` (多两次 NAT)
**正确**: 同一 Docker 网络内用容器名直连 `http://dp-gateway:80`

### 2.4 nginx 代理缓冲

**症状**: `upstream response is buffered to a temporary file`
**修复**: nginx.conf http 块增大 proxy_buffers (已在 nginx.conf 配置)

### 2.5 n8n trust proxy

**症状**: n8n 日志刷 `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`
**修复**: `N8N_TRUST_PROXY=true` (dp-wf 已配)

---

## 三、诊断命令速查

```bash
# cloudflared 日志 (QUIC 连接和 buffer 警告)
docker logs dp-tunnel --tail 50

# nginx gateway 日志 (proxy_temp 和 upstream 错误)
docker logs dp-gateway --tail 50

# UDP buffer 值
cat /proc/sys/net/core/rmem_max

# 容器资源限制 (0 = 无限制)
docker inspect dp-tunnel --format '{{.HostConfig.Memory}}'
```

---

## 四、Let's Encrypt 证书管理

### 首次生成
```bash
cp infrastructure/certbot/cloudflare.ini.example infrastructure/certbot/cloudflare.ini
# 填入 Cloudflare API Token (Zone:DNS:Edit)
chmod 600 infrastructure/certbot/cloudflare.ini
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --profile certbot run --rm dp-certbot
```

### 自动续期 (crontab)
```
0 3 1,15 * * /path/to/scripts/cert-renew.sh >> /var/log/dp-cert-renew.log 2>&1
```

### 续期原理
- certbot renew 读取 `${DP_DATA_DIR}/certbot/renewal/` 配置
- `--deploy-hook` 写 flag 到共享 volume
- 主机脚本检测 flag → `nginx -t` → `nginx -s reload`

---

## 五、nginx 生产配置 (conf.d-prod/)

### 文件结构
```
conf.d-prod/
├── ssl-params.conf      # SSL 参数 (include 复用)
├── proxy-params.conf    # 代理头 + 安全头 (include 复用)
└── default.conf         # 4 个 server 块
```

### 4 server 块设计
| # | 端口 | 域名 | 用途 |
|---|------|------|------|
| 1 | HTTP:80 | 主域名 | 完整路由安全网 (证书故障时仍可用) |
| 2 | HTTPS:443 | 主域名 | 主入口 (LAN + Tunnel 统一) |
| 3 | HTTP:80 | wf 子域名 | n8n 编辑器安全网 |
| 4 | HTTPS:443 | wf 子域名 | n8n 编辑器主入口 |

### 关键设计决策
- HTTP:80 **不做 301 跳转** — 证书故障安全网
- HSTS 初期不启用 — 稳定 2-4 周后取消注释
- OCSP Stapling 注释掉 — LE 通配符证书不含 OCSP responder URL

---

## 六、Split DNS

### 目的
工厂 PDA 直连 LAN IP，不走 Cloudflare Tunnel:
- 零外网依赖 (断网仍可作业)
- 低延迟 (<5ms vs Tunnel 60-130ms)

### 实施前提
- 服务器需**固定 LAN IP** (静态 IP 或 DHCP 保留)
- 路由器 DNS 添加静态记录 (或用 dp-dns 容器)

### 无 Split DNS 时的影响
- 正常: PDA 通过 Tunnel 可用 (延迟高)
- Tunnel 故障: **PDA 完全瘫痪** (Split DNS 的核心价值)

---

## 七、n8n CLI 导入激活 (v2.x)

n8n 2.x 区分草稿/已发布:
- `active = true` ≠ 已发布，`activeVersionId` 必须指向当前 `versionId`
- `n8n import:workflow` 强制去激活
- 激活需数据库层 `SET active = true, "activeVersionId" = "versionId"` + 重启

---

## 优化优先级

| 优先级 | 项目 | 效果 |
|--------|------|------|
| P0 | QUIC UDP 缓冲区 (sysctl) | 消除 QUIC 丢包重传 |
| P0 | 停用非必要容器释放内存 | 减少 swap |
| P0 | 多实例冲突排查 | 消除 502 轮换 |
| P1 | 统一 tunnel 路由走容器名 | 减少 NAT 跳数 |
| P1 | 增大 nginx proxy buffer | 消除磁盘 IO |
| P2 | Split DNS 配置 | 断网可用 + 低延迟 |

---

## 关键教训

1. **同一 Tunnel Token 不能跑多个 cloudflared** — Windows 安装版默认 AUTO_START，迁移到 Docker 后必须禁用
2. **WSL2 的 sysctl 默认值对 QUIC 不友好** — 必须手动调 rmem_max
3. **非项目容器是内存黑洞** — Java 应用在低内存环境特别危险
4. **`host.docker.internal` 有性能代价** — 生产环境用容器网络直连
5. **修改 sysctl 后容器必须重启** — 运行中不会自动感知变更
6. **HTTP:80 保留完整路由** — 证书故障时的安全网
