# =============================================================================
# Nginx 路由矩阵测试 — 验证开发/生产配置的路由规则一致性与安全性
# =============================================================================
# 策略: 解析 nginx 配置文件内容，断言关键路由规则存在且正确
# 不启动 nginx 容器，纯文本解析 (补充 CI Job 11 nginx-validate 的语法检查)
# =============================================================================
import os
import re
import pytest

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DEV_CONF = os.path.join(PROJECT_ROOT, 'infrastructure', 'nginx', 'conf.d', 'default.conf')
PROD_CONF = os.path.join(PROJECT_ROOT, 'infrastructure', 'nginx', 'conf.d-prod', 'default.conf')
PROXY_PARAMS = os.path.join(PROJECT_ROOT, 'infrastructure', 'nginx', 'conf.d-prod', 'proxy-params.conf')
SSL_PARAMS = os.path.join(PROJECT_ROOT, 'infrastructure', 'nginx', 'conf.d-prod', 'ssl-params.conf')
NGINX_MAIN = os.path.join(PROJECT_ROOT, 'infrastructure', 'nginx', 'nginx.conf')


@pytest.fixture
def dev_conf():
    with open(DEV_CONF) as f:
        return f.read()


@pytest.fixture
def prod_conf():
    with open(PROD_CONF) as f:
        return f.read()


@pytest.fixture
def proxy_params():
    with open(PROXY_PARAMS) as f:
        return f.read()


@pytest.fixture
def ssl_params():
    with open(SSL_PARAMS) as f:
        return f.read()


# ============================================================================
# 开发环境路由矩阵
# ============================================================================

class TestDevRoutes:
    """开发环境 default.conf 路由验证"""

    def test_landing_page_exact_match(self, dev_conf):
        """/ 精确匹配导航首页"""
        assert 'location = /' in dev_conf
        assert 'try_files /index.html' in dev_conf

    def test_wms_frontend_proxy(self, dev_conf):
        """WMS 前端代理到 dp-wms-web (variable proxy_pass + DNS 动态解析)"""
        assert 'location /wms/' in dev_conf
        assert 'set $wms_backend http://dp-wms-web:80' in dev_conf
        assert 'proxy_pass $wms_backend' in dev_conf

    def test_wms_api_rewrite(self, dev_conf):
        """/api/wms/ → /webhook/wms/ 重写"""
        assert 'location /api/wms/' in dev_conf
        assert re.search(r'rewrite\s+\^/api/\(\.\*\)\$\s+/webhook/\$1\s+break', dev_conf)

    def test_webhook_passthrough(self, dev_conf):
        """/api/webhook/ 透传到 n8n"""
        assert 'location /api/webhook/' in dev_conf
        assert 'location /api/webhook-test/' in dev_conf

    def test_bi_shortcut_redirect(self, dev_conf):
        """/bi → 302 重定向到 BI 欢迎页 (大小写兼容)"""
        assert re.search(r'location\s+~\*\s+\^/bi/\?\$', dev_conf)
        assert 'return 302 /superset/welcome/' in dev_conf

    def test_ai_placeholder_503(self, dev_conf):
        """/ai/ 返回 503 预留"""
        assert 'location /ai/' in dev_conf
        assert 'return 503' in dev_conf
        assert 'application/json' in dev_conf

    def test_health_endpoint(self, dev_conf):
        """/health 返回 200 JSON"""
        assert 'location = /health' in dev_conf
        assert 'return 200' in dev_conf
        assert '"status":"ok"' in dev_conf

    def test_hidden_files_blocked(self, dev_conf):
        """隐藏文件 (/.) 被拒绝"""
        assert re.search(r'location\s+~\s+/\\\.\s*\{', dev_conf)
        assert 'deny all' in dev_conf

    def test_bi_static_cache(self, dev_conf):
        """/static/ 代理到 BI 并缓存 7 天"""
        assert 'location /static/' in dev_conf
        assert 'expires 7d' in dev_conf

    def test_bi_fallback(self, dev_conf):
        """BI 引擎使用 variable proxy_pass (DNS 动态解析)"""
        assert 'set $bi_backend http://dp-bi:8088' in dev_conf
        assert 'proxy_pass $bi_backend' in dev_conf

    def test_wf_subdomain_server_block(self, dev_conf):
        """n8n 编辑器使用独立 server block (wf.* 子域名)"""
        assert re.search(r'server_name\s+~\^wf\\\.', dev_conf)

    def test_security_headers(self, dev_conf):
        """安全头存在"""
        assert 'X-Frame-Options' in dev_conf
        assert 'X-Content-Type-Options' in dev_conf
        assert 'X-XSS-Protection' in dev_conf

    def test_websocket_support(self, dev_conf):
        """WebSocket 支持 (Upgrade/Connection 头)"""
        assert '$http_upgrade' in dev_conf
        assert '$connection_upgrade' in dev_conf

    def test_privacy_terms_pages(self, dev_conf):
        """隐私政策和服务条款页面 (Google OAuth 要求)"""
        assert 'location = /privacy' in dev_conf
        assert 'location = /terms' in dev_conf
        assert 'logo-oauth.svg' in dev_conf


# ============================================================================
# 生产环境路由矩阵
# ============================================================================

class TestProdRoutes:
    """生产环境 conf.d-prod/default.conf 路由验证"""

    def test_four_server_blocks(self, prod_conf):
        """4 个 server block (HTTP+HTTPS × app+wf)"""
        server_blocks = re.findall(r'^\s*server\s*\{', prod_conf, re.MULTILINE)
        assert len(server_blocks) == 4

    def test_http_and_https_listeners(self, prod_conf):
        """同时有 HTTP:80 和 HTTPS:443 监听"""
        assert 'listen 80' in prod_conf
        assert 'listen 443 ssl' in prod_conf

    def test_http2_enabled(self, prod_conf):
        """HTTPS server 启用 HTTP/2"""
        assert 'http2 on' in prod_conf

    def test_app_and_wf_domains(self, prod_conf):
        """app.example.com 和 wf.example.com 域名"""
        assert 'server_name app.example.com' in prod_conf
        assert 'server_name wf.example.com' in prod_conf

    def test_ssl_params_included(self, prod_conf):
        """SSL 参数通过 include 引入"""
        assert 'include /etc/nginx/conf.d/ssl-params.conf' in prod_conf

    def test_proxy_params_included(self, prod_conf):
        """代理参数通过 include 引入"""
        assert 'include /etc/nginx/conf.d/proxy-params.conf' in prod_conf

    def test_prod_has_same_routes_as_dev(self, dev_conf, prod_conf):
        """生产 HTTP server 包含所有开发环境的关键路由"""
        key_routes = [
            'location = /',
            'location /wms/',
            'location /api/wms/',
            'location /api/webhook/',
            'location /ai/',
            'location = /health',
            'location /static/',
        ]
        for route in key_routes:
            assert route in prod_conf, f'生产配置缺少路由: {route}'

    def test_wf_server_has_healthz(self, prod_conf):
        """n8n server block 有 /healthz 端点"""
        assert 'location = /healthz' in prod_conf

    def test_variable_proxy_pass(self, prod_conf):
        """生产配置使用 variable proxy_pass (DNS 动态解析)"""
        assert '$wms_backend' in prod_conf
        assert '$wf_backend' in prod_conf
        assert '$bi_backend' in prod_conf

    def test_wf_no_buffering(self, prod_conf):
        """n8n 编辑器禁用缓冲 (SSE/WebSocket 需要)"""
        assert 'proxy_buffering off' in prod_conf
        assert 'chunked_transfer_encoding off' in prod_conf


# ============================================================================
# SSL 配置
# ============================================================================

class TestSSLConfig:
    """SSL 参数安全验证"""

    def test_tls_versions(self, ssl_params):
        """仅允许 TLS 1.2+"""
        assert 'TLSv1.2' in ssl_params
        assert 'TLSv1.3' in ssl_params
        assert 'TLSv1.0' not in ssl_params
        assert 'TLSv1.1' not in ssl_params
        assert 'SSLv3' not in ssl_params

    def test_weak_ciphers_excluded(self, ssl_params):
        """排除弱加密套件"""
        assert '!aNULL' in ssl_params
        assert '!MD5' in ssl_params

    def test_session_cache(self, ssl_params):
        """启用 SSL session 缓存"""
        assert 'ssl_session_cache' in ssl_params
        assert 'ssl_session_timeout' in ssl_params

    def test_server_cipher_preference(self, ssl_params):
        """服务端优先选择加密套件"""
        assert 'ssl_prefer_server_ciphers on' in ssl_params


# ============================================================================
# 代理参数
# ============================================================================

class TestProxyParams:
    """公共代理参数验证"""

    def test_forwarded_headers(self, proxy_params):
        """X-Forwarded-* 头正确设置"""
        assert 'X-Forwarded-For' in proxy_params
        assert 'X-Forwarded-Proto' in proxy_params
        assert 'X-Forwarded-Host' in proxy_params
        assert 'X-Real-IP' in proxy_params

    def test_security_headers(self, proxy_params):
        """安全头在公共参数中定义"""
        assert 'X-Frame-Options' in proxy_params
        assert 'SAMEORIGIN' in proxy_params
        assert 'X-Content-Type-Options' in proxy_params
        assert 'nosniff' in proxy_params

    def test_timeout_defaults(self, proxy_params):
        """默认超时设置"""
        assert 'proxy_connect_timeout' in proxy_params
        assert 'proxy_send_timeout' in proxy_params
        assert 'proxy_read_timeout' in proxy_params


# ============================================================================
# 开发 vs 生产一致性
# ============================================================================

class TestDevProdConsistency:
    """开发环境与生产环境路由一致性"""

    def test_rewrite_rules_match(self, dev_conf, prod_conf):
        """关键 rewrite 规则在两套配置中一致"""
        # /api/wms/ → /webhook/$1
        dev_rewrites = re.findall(r'rewrite\s+\S+\s+\S+\s+break', dev_conf)
        prod_rewrites = re.findall(r'rewrite\s+\S+\s+\S+\s+break', prod_conf)
        # 生产至少包含开发的所有 rewrite 规则 (可能因 HTTP+HTTPS 有双份)
        for rule in dev_rewrites:
            assert rule in prod_rewrites, f'生产配置缺少 rewrite 规则: {rule}'

    def test_backend_variable_names_match(self, dev_conf, prod_conf):
        """两套配置使用相同的 backend 变量名 (variable proxy_pass)"""
        for name in ['$wms_backend', '$wf_backend', '$bi_backend']:
            assert name in dev_conf, f'开发配置缺少 backend 变量: {name}'
            assert name in prod_conf, f'生产配置缺少 backend 变量: {name}'

    def test_ai_503_both_envs(self, dev_conf, prod_conf):
        """/ai/ 在两套配置中都返回 503"""
        for conf in [dev_conf, prod_conf]:
            assert 'location /ai/' in conf
            assert 'return 503' in conf


# ============================================================================
# 安全负面验证
# ============================================================================

class TestSecurityNegative:
    """验证安全相关的负面规则"""

    def test_no_autoindex(self, dev_conf, prod_conf):
        """不应启用目录列表"""
        for conf in [dev_conf, prod_conf]:
            assert 'autoindex on' not in conf

    def test_hidden_files_blocked_both_envs(self, dev_conf, prod_conf):
        """隐藏文件 (/.) 在两套配置中都被拒绝"""
        for conf in [dev_conf, prod_conf]:
            assert re.search(r'location\s+~\s+/\\\.\s*\{', conf), '缺少隐藏文件拦截规则'
            assert 'deny all' in conf

    def test_no_sensitive_path_exposure(self, dev_conf, prod_conf):
        """不应有暴露敏感文件的 location 规则"""
        for conf in [dev_conf, prod_conf]:
            # 不应有服务 .env 文件的 location 块
            assert not re.search(r'location\s+.*\.env', conf)
            # 不应有服务 .git 目录的 location 块
            assert not re.search(r'location\s+.*\.git', conf)

    def test_prod_has_ssl(self, ssl_params):
        """生产 SSL 配置应包含证书路径"""
        assert 'ssl_certificate' in ssl_params
        assert 'ssl_certificate_key' in ssl_params
