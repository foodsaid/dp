# 前端缓存版本号管理 (Cache Busting)

> **创建**: 2026-02-25
> **更新**: 2026-03-05
> **教训来源**: httpOnly Cookie 认证切换后手机端死循环
> **环境**: dp-wms-web (nginx:alpine) + Cloudflare Tunnel
> **当前版本号**: `phase20.8` (2026-03-16)

---

## 🔴 修改 JS/CSS 后必须执行 (强制检查清单)

**触发条件**: 修改了 `shared.js` / `shared.css` / `lang.js` / `camera-fallback.js` / 任何页面级 `.js` 文件

```bash
# 1. 确定新版本号 (当前 + 0.01)
#    当前: phase20.7 → 新: phase20.8

# 2. 批量替换 (11 个 HTML 文件)
cd "Digital-Platform"
sed -i 's/phase20\.7/phase20.8/g' apps/wms/*.html

# 3. 验证一致性
grep -o 'phase[0-9]*\.[0-9]*' apps/wms/*.html | sort -t: -k2 -u
# 所有文件必须显示同一个版本号

# 4. 更新本文件的 "当前版本号" 记录
```

**不执行的后果**: 用户浏览器 + CDN 缓存旧文件，新功能/修复不生效，可能死循环。

---

## 一、版本号机制

### 当前方案
```html
<link rel="stylesheet" href="shared.css?v=phase20.7">
<script src="shared.js?v=phase20.7"></script>
<script src="lang.js?v=phase20.7"></script>
```

### 缓存策略 (dp-wms-web nginx)
```nginx
location ~* \.(js|css|svg)$ {
    if ($args ~* "v=") {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}
```
- 带 `?v=` 参数: **1 年 + immutable** (浏览器 + CDN 永不重新验证)
- 不带 `?v=`: 正常缓存 (浏览器自行决定)
- `env.js`: 单独规则, `no-store` (每次都重新请求)

### 缓存层级 (从近到远)
```
浏览器内存缓存 → 浏览器磁盘缓存 → Cloudflare CDN 边缘 → dp-gateway → dp-wms-web
```
**immutable 意味着**: 只要 URL 不变, 所有缓存层都不会重新请求 origin。
版本号是**唯一的缓存失效手段**。

---

## 二、何时必须升版本号

### 必须升 (P0 — 不升就出 bug)

| 场景 | 原因 | 示例 |
|------|------|------|
| shared.js 修改 | 所有页面依赖, immutable 缓存 | API 调用方式变更、checkAuth 逻辑变更 |
| shared.css 修改 | 布局/样式变更 | body:not(.authed) 规则 |
| lang.js 修改 | 翻译变更 | 新增语言、修正翻译 |
| 认证机制变更 | 新旧代码不兼容会死循环 | Bearer → httpOnly cookie |
| 任何 JS/CSS 公共文件修改 | immutable 缓存不会过期 | — |

### 不需要升

| 场景 | 原因 |
|------|------|
| 仅修改 HTML 结构 (不改 JS/CSS 引用) | HTML 无 immutable 缓存, 正常刷新即可 |
| 仅修改 env.js | env.js 有 `no-store` 规则, 不走版本号缓存 |
| 仅修改后端 (n8n 工作流、数据库) | 不涉及前端文件 |
| 仅修改 nginx 配置 | 不涉及静态文件 |
| 仅修改 docker-compose | 不涉及前端文件 |

---

## 三、升版本号 SOP

### 1. 确定新版本号
```
当前: phase20.7
格式: phase{大版本}.{小版本}
规则: 每次前端公共文件变更 +0.01 (19.21 → 19.22)
```

### 2. 批量替换 (一条命令)
```bash
cd "Digital-Platform"
sed -i 's/phase20\.7/phase20.8/g' apps/wms/*.html
echo "updated $(grep -rl 'phase20.8' apps/wms/*.html | wc -l) files"
```

### 3. 重建容器
```bash
wsl.exe -d Ubuntu-24.04 -- bash -c '
  cd "/home/user/Digital Platform" && \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml build dp-wms-web && \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d dp-wms-web
'
docker exec dp-gateway nginx -s reload
```

### 4. 验证
```bash
curl -sk https://app.example.com/wms/index.html | grep -o 'phase[0-9]*\.[0-9]*' | sort -u
# → phase18.6
```

---

## 四、死循环诊断

### 症状
login.html ↔ index.html 来回跳转, 无法停留在任何页面。

### 根因模式
```
login.html (新版)              shared.js (旧版, 缓存)
  设置 localStorage.wms_username    检查 localStorage.wms_token
         ↓                              ↓
  跳转 index.html              wms_token 不存在 → 跳 login.html
         ↓                              ↑
  wms_username 存在 → 跳 index ──────────┘
                    死循环
```

### 诊断命令
```bash
# 1. 检查服务端提供的是哪个版本
curl -sk https://app.example.com/wms/shared.js?v=phase18.5 | grep -c "wms_username"
# 期望: > 0 (新版), 0 = 旧版

# 2. 检查 HTML 引用的版本号
curl -sk https://app.example.com/wms/index.html | grep -o 'phase[0-9]*\.[0-9]*' | sort -u

# 3. 容器内文件确认
docker exec dp-wms-web sh -c 'grep -c "wms_username" /usr/share/nginx/html/shared.js'
```

### 紧急修复
```bash
# 如果缓存问题, 升版本号 (见第三节)

# 如果循环中无法打开登录页, 用 ?relogin 参数
https://app.example.com/wms/login.html?relogin
```

---

## 五、关键教训

1. **`immutable` 缓存是双刃剑** — 性能极好但版本号是唯一出路, 忘记升级 = 用户拿到旧文件
2. **Cloudflare CDN 也缓存** — Tunnel 流量过 Cloudflare 边缘, 同样受 Cache-Control 影响
3. **手机浏览器缓存更激进** — PC 硬刷新可能有效, 手机几乎无法手动清缓存
4. **认证机制变更是最高危场景** — 新旧代码检查不同的 localStorage key = 必死循环
5. **dp-wms-web 是构建镜像** — 修改源码后必须 `docker compose build` 重建, 不会自动生效
6. **版本号必须全部文件一致** — 11 个 HTML 文件引用同一个版本号, 用 `sed` 批量替换防遗漏
