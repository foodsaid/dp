# =============================================================================
# Nginx 安全配置补充测试 — SSO 动态 include / 安全头 / WebSocket / Header 防伪造
# =============================================================================
# 补充 test_nginx_routes.py 未覆盖的安全相关配置
# =============================================================================
import os
import re
import pytest

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DEV_CONF = os.path.join(PROJECT_ROOT, 'infrastructure', 'nginx', 'conf.d', 'default.conf')
PROD_CONF = os.path.join(PROJECT_ROOT, 'infrastructure', 'nginx', 'conf.d-prod', 'default.conf')
SEC_HEADERS = os.path.join(PROJECT_ROOT, 'infrastructure', 'nginx', 'security-headers.conf')
SEC_HEADERS_WF = os.path.join(PROJECT_ROOT, 'infrastructure', 'nginx', 'security-headers-wf.conf')
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
def sec_headers():
    with open(SEC_HEADERS) as f:
        return f.read()


@pytest.fixture
def sec_headers_wf():
    with open(SEC_HEADERS_WF) as f:
        return f.read()


@pytest.fixture
def nginx_main():
    with open(NGINX_MAIN) as f:
        return f.read()


# ============================================================================
# SSO 动态 include 验证
# ============================================================================

class TestSSODynamicIncludes:
    """SSO 动态 include 文件引用"""

    def test_sso_auth_inc_included(self, dev_conf):
        """sso-auth.inc 在受保护路由中被 include"""
        assert 'include /etc/nginx/dynamic/sso-auth.inc' in dev_conf

    def test_sso_headers_inc_included(self, dev_conf):
        """sso-headers.inc 在受保护路由中被 include"""
        assert 'include /etc/nginx/dynamic/sso-headers.inc' in dev_conf

    def test_sso_login_redirects_inc(self, dev_conf):
        """sso-login-redirects.inc 被 include (SSO 模式下重定向内置登录页)"""
        assert 'include /etc/nginx/dynamic/sso-login-redirects.inc' in dev_conf

    def test_sso_protected_routes(self, dev_conf):
        """WMS/BI/Grafana/Prometheus/Alertmanager/Loki 均有 SSO 保护"""
        sso_protected = ['/wms/', '/superset/', '/grafana/', '/prometheus/', '/alertmanager/', '/loki/']
        for route in sso_protected:
            # 找到该 location 块，验证其中包含 sso-auth.inc
            pattern = rf'location\s+{re.escape(route)}\s*\{{[^}}]*sso-auth\.inc'
            assert re.search(pattern, dev_conf, re.DOTALL), \
                f'{route} 缺少 SSO 保护 (sso-auth.inc)'

    def test_bypass_routes_no_sso(self, dev_conf):
        """API webhook 和 health 不应有 SSO 保护"""
        # /api/wms/ 不应包含 sso-auth (n8n 自有认证)
        api_wms_block = re.search(r'location /api/wms/\s*\{(.*?)\}', dev_conf, re.DOTALL)
        assert api_wms_block
        assert 'sso-auth.inc' not in api_wms_block.group(1)


# ============================================================================
# Header 防伪造验证
# ============================================================================

class TestHeaderAntiSpoofing:
    """X-Forwarded-User 等 Header 先清后设 (防客户端伪造)"""

    def test_wms_clears_forwarded_user(self, dev_conf):
        """/wms/ 先清 X-Forwarded-User 再由 sso-headers.inc 注入"""
        wms_block = re.search(r'location /wms/\s*\{(.*?)\n    \}', dev_conf, re.DOTALL)
        assert wms_block
        block = wms_block.group(1)
        assert 'proxy_set_header X-Forwarded-User ""' in block
        assert 'proxy_set_header Remote-User ""' in block
        assert 'proxy_set_header X-Forwarded-Groups ""' in block
        assert 'proxy_set_header X-Forwarded-Email ""' in block

    def test_grafana_clears_forwarded_user(self, dev_conf):
        """/grafana/ 先清 4 个 SSO Header"""
        grafana_block = re.search(r'location /grafana/\s*\{(.*?)\n    \}', dev_conf, re.DOTALL)
        assert grafana_block
        block = grafana_block.group(1)
        assert 'proxy_set_header X-Forwarded-User ""' in block
        assert 'proxy_set_header Remote-User ""' in block

    def test_bi_superset_clears_forwarded_user(self, dev_conf):
        """/superset/ 先清 4 个 SSO Header"""
        superset_block = re.search(r'location /superset/\s*\{(.*?)\n    \}', dev_conf, re.DOTALL)
        assert superset_block
        block = superset_block.group(1)
        assert 'proxy_set_header X-Forwarded-User ""' in block


# ============================================================================
# 安全头文件验证
# ============================================================================

class TestSecurityHeaders:
    """安全响应头配置"""

    def test_main_headers_complete(self, sec_headers):
        """主站安全头包含 6 项"""
        assert 'X-Frame-Options' in sec_headers
        assert 'X-Content-Type-Options' in sec_headers
        assert 'X-XSS-Protection' in sec_headers
        assert 'Referrer-Policy' in sec_headers
        assert 'Content-Security-Policy' in sec_headers
        assert 'Permissions-Policy' in sec_headers

    def test_main_csp_no_unsafe_eval(self, sec_headers):
        """主站 CSP 不允许 unsafe-eval"""
        assert 'unsafe-eval' not in sec_headers

    def test_wf_csp_allows_unsafe_eval(self, sec_headers_wf):
        """n8n 编辑器 CSP 允许 unsafe-eval (JS 沙盒需要)"""
        assert 'unsafe-eval' in sec_headers_wf

    def test_wf_csp_allows_websocket(self, sec_headers_wf):
        """n8n 编辑器 CSP 允许 wss: (WebSocket)"""
        assert 'wss:' in sec_headers_wf

    def test_main_camera_self(self, sec_headers):
        """主站 Permissions-Policy camera=(self) (WMS 扫码需要)"""
        assert 'camera=(self)' in sec_headers

    def test_wf_camera_none(self, sec_headers_wf):
        """n8n 编辑器 camera=() (不需要摄像头)"""
        assert 'camera=()' in sec_headers_wf

    def test_sameorigin_frame(self, sec_headers):
        """X-Frame-Options SAMEORIGIN"""
        assert 'SAMEORIGIN' in sec_headers

    def test_nosniff(self, sec_headers):
        """X-Content-Type-Options nosniff"""
        assert 'nosniff' in sec_headers


# ============================================================================
# WebSocket 配置验证
# ============================================================================

class TestWebSocketConfig:
    """WebSocket 升级支持"""

    def test_n8n_editor_websocket(self, dev_conf):
        """n8n 编辑器 server block 有 WebSocket 升级"""
        # 找到 wf.* server block
        wf_block = re.search(r'server\s*\{[^}]*server_name\s+~\^wf(.*?)(?=\nserver\s*\{|\Z)',
                             dev_conf, re.DOTALL)
        assert wf_block
        block = wf_block.group(0)
        assert 'proxy_http_version 1.1' in block
        assert 'Upgrade $http_upgrade' in block
        assert 'Connection $connection_upgrade' in block

    def test_authelia_websocket(self, dev_conf):
        """/auth/ 有 WebSocket 支持 (Authelia 实时状态推送)"""
        auth_block = re.search(r'location /auth/\s*\{(.*?)\n    \}', dev_conf, re.DOTALL)
        assert auth_block
        block = auth_block.group(1)
        assert 'Upgrade $http_upgrade' in block

    def test_grafana_websocket(self, dev_conf):
        """/grafana/ 有 WebSocket 支持 (Live 功能)"""
        grafana_block = re.search(r'location /grafana/\s*\{(.*?)\n    \}', dev_conf, re.DOTALL)
        assert grafana_block
        block = grafana_block.group(1)
        assert 'Upgrade $http_upgrade' in block

    def test_bi_routes_websocket(self, dev_conf):
        """BI 枚举路由有 WebSocket 支持"""
        bi_block = re.search(
            r'location ~ \^/\(dashboard\|chart.*?\{(.*?)\n    \}', dev_conf, re.DOTALL
        )
        assert bi_block
        block = bi_block.group(1)
        assert 'Upgrade $http_upgrade' in block


# ============================================================================
# Authelia 验证端点
# ============================================================================

class TestAutheliaEndpoints:
    """Authelia SSO 端点配置"""

    def test_authz_endpoint_internal(self, dev_conf):
        """/internal/authelia/authz 标记为 internal"""
        assert 'location /internal/authelia/authz' in dev_conf
        authz_block = re.search(
            r'location /internal/authelia/authz\s*\{(.*?)\n    \}', dev_conf, re.DOTALL
        )
        assert authz_block
        assert 'internal' in authz_block.group(1)

    def test_authz_passes_original_url(self, dev_conf):
        """验证端点传递 X-Original-URL"""
        authz_block = re.search(
            r'location /internal/authelia/authz\s*\{(.*?)\n    \}', dev_conf, re.DOTALL
        )
        assert 'X-Original-URL' in authz_block.group(1)

    def test_authz_timeout(self, dev_conf):
        """验证端点有 2s 快速超时"""
        authz_block = re.search(
            r'location /internal/authelia/authz\s*\{(.*?)\n    \}', dev_conf, re.DOTALL
        )
        assert 'proxy_connect_timeout 2s' in authz_block.group(1)

    def test_login_rate_limit(self, dev_conf):
        """登录 API 有限速保护"""
        assert 'limit_req zone=sso_login' in dev_conf
        assert 'limit_req_status 429' in dev_conf

    def test_sso_down_fallback(self, dev_conf):
        """SSO 不可用时 503 降级"""
        assert 'location @sso_down' in dev_conf
        sso_down = re.search(r'location @sso_down\s*\{(.*?)\}', dev_conf, re.DOTALL)
        assert sso_down
        assert 'return 503' in sso_down.group(1)

    def test_access_denied_redirect(self, dev_conf):
        """无权限 → 302 重定向到导航页 (含 denied=1 防循环)"""
        assert 'location @access_denied' in dev_conf
        assert 'denied=1' in dev_conf

    def test_whoami_endpoint(self, dev_conf):
        """/api/auth/whoami 代理到 Authelia user/info"""
        assert 'location = /api/auth/whoami' in dev_conf
        assert 'user/info' in dev_conf

    def test_whoami_cache(self, dev_conf):
        """whoami 端点有 5s 微缓存 (防 storm)"""
        whoami_block = re.search(
            r'location = /api/auth/whoami\s*\{(.*?)\n    \}', dev_conf, re.DOTALL
        )
        assert whoami_block
        block = whoami_block.group(1)
        assert 'proxy_cache whoami_cache' in block
        assert '5s' in block


# ============================================================================
# WMS 前端 CSP 特殊策略
# ============================================================================

class TestWMSSecurityPolicy:
    """WMS 前端安全策略"""

    def test_wms_csp_unsafe_eval(self, dev_conf):
        """/wms/ CSP 允许 unsafe-eval (Vue 运行时编译)"""
        wms_block = re.search(r'location /wms/\s*\{(.*?)\n    \}', dev_conf, re.DOTALL)
        assert wms_block
        block = wms_block.group(1)
        assert 'unsafe-eval' in block

    def test_wms_camera_self(self, dev_conf):
        """/wms/ Permissions-Policy camera=(self) (扫码)"""
        wms_block = re.search(r'location /wms/\s*\{(.*?)\n    \}', dev_conf, re.DOTALL)
        assert wms_block
        assert 'camera=(self)' in wms_block.group(1)


# ============================================================================
# nginx.conf 主配置
# ============================================================================

class TestNginxMainConfig:
    """nginx.conf 主配置验证"""

    def test_connection_upgrade_map(self, nginx_main):
        """map $http_upgrade $connection_upgrade 定义"""
        assert '$connection_upgrade' in nginx_main

    def test_real_scheme_map(self, nginx_main):
        """$real_scheme 变量定义 (支持 HTTPS 反代)"""
        assert 'real_scheme' in nginx_main

    def test_rate_limit_zone(self, nginx_main):
        """限速 zone 定义"""
        assert 'limit_req_zone' in nginx_main
        assert 'sso_login' in nginx_main
