#!/bin/sh
# =============================================================================
# 27-sso-auth-toggle.sh — 根据 DP_SSO_ENABLED 生成 SSO 配置 include 文件
# =============================================================================
# 位置: /docker-entrypoint.d/27-sso-auth-toggle.sh (nginx 启动时自动执行)
# 输出:
#   /etc/nginx/dynamic/sso-auth.inc    — auth_request 指令 + 错误处理
#   /etc/nginx/dynamic/sso-headers.inc — 已验证 header 注入
# =============================================================================

mkdir -p /etc/nginx/dynamic

if [ "${DP_SSO_ENABLED:-false}" = "true" ]; then
    echo "🔒 SSO 已启用: 生成 auth_request 配置"

    # sso-auth.inc: auth_request + 错误处理
    cat > /etc/nginx/dynamic/sso-auth.inc <<'CONF'
auth_request /internal/authelia/authz;
# Authelia auth-request endpoint 返回: Remote-User / Remote-Groups / Remote-Name / Remote-Email
auth_request_set $authelia_user $upstream_http_remote_user;
auth_request_set $authelia_groups $upstream_http_remote_groups;
auth_request_set $authelia_name $upstream_http_remote_name;
auth_request_set $authelia_email $upstream_http_remote_email;
auth_request_set $authelia_auth_level $upstream_http_remote_authentication_level;
auth_request_set $authelia_redirect $upstream_http_location;
# 未认证 → 302 重定向到 Authelia 登录页
error_page 401 =302 $authelia_redirect;
# 已认证但无权限 (Authelia deny 策略返回 403) → 外部 302 重定向到导航首页
# 必须用 named location + return 302, 直接写 error_page 403 =302 / 只做内部重定向 (无 Location 头)
error_page 403 = @access_denied;
# auth_request 子请求失败 → 503 降级 (不影响后端 upstream 自身的 5xx)
# 原理: proxy_intercept_errors 默认 off, 后端 500 直接透传给客户端
#        error_page 仅拦截 nginx 自身产生的错误 (auth_request 超时/连接失败)
error_page 500 502 503 =503 @sso_down;
CONF

    # sso-headers.inc: 注入已验证的真实 header (双 header 兼容)
    cat > /etc/nginx/dynamic/sso-headers.inc <<'CONF'
proxy_set_header X-Forwarded-User $authelia_user;    # Grafana 等现代应用
proxy_set_header Remote-User $authelia_user;          # Superset (FAB 硬编码 WSGI REMOTE_USER)
proxy_set_header X-Forwarded-Groups $authelia_groups;
proxy_set_header X-Forwarded-Email $authelia_email;   # 未来 BI/审计用
CONF

    # sso-login-redirects.inc: SSO 已启用时各模块内置登录页 301 重定向
    cat > /etc/nginx/dynamic/sso-login-redirects.inc <<'CONF'
# WMS 内置登录页 → WMS 主页
location = /wms/login.html {
    return 301 /wms/;
}
# BI (Superset) 内置登录页 → BI 欢迎页
location = /superset/login/ {
    return 301 /superset/welcome/;
}
location = /login/ {
    return 301 /superset/welcome/;
}
# Grafana 内置登录页 → Grafana 主页
location = /grafana/login {
    return 301 /grafana/;
}
CONF

else
    echo "🔓 SSO 未启用: 生成空配置 (各应用独立认证)"
    # SSO 关闭: 空文件, include 无效果
    > /etc/nginx/dynamic/sso-auth.inc
    > /etc/nginx/dynamic/sso-headers.inc
    > /etc/nginx/dynamic/sso-login-redirects.inc
fi
