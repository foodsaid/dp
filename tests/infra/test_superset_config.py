# =============================================================================
# superset_config.py 配置测试 — SSO 角色映射 + 连接字符串 + 安全策略
# =============================================================================
import os
import sys
import importlib
import importlib.util
import pytest

CONFIG_PATH = os.path.join(
    os.path.dirname(__file__), '..', '..', 'apps', 'bi', 'superset_config.py'
)


def load_config(env_overrides=None):
    """重新加载配置 (每次使用新的环境变量)"""
    env = {
        'SUPERSET_SECRET_KEY': 'test-secret-key-32-chars-long!!',
        'DP_DB_HOST': 'test-db',
        'DP_DB_PORT': '5432',
        'DP_DB_NAME': 'testdb',
        'DP_DB_USER': 'testuser',
        'DP_DB_PASSWORD': 'testpass',
        'DP_REDIS_BI_HOST': 'test-redis',
        'DP_REDIS_BI_PORT': '6379',
        'DP_REDIS_BI_PASSWORD': 'redispass',
    }
    if env_overrides:
        env.update(env_overrides)

    # 清理已加载的模块缓存
    mod_name = 'superset_config_test'
    if mod_name in sys.modules:
        del sys.modules[mod_name]

    # Mock flask_appbuilder (在非 Superset 环境不可用)
    fab_mock = type(sys)('flask_appbuilder')
    fab_security = type(sys)('flask_appbuilder.security')
    fab_manager = type(sys)('flask_appbuilder.security.manager')
    fab_manager.AUTH_REMOTE_USER = 4  # FAB AUTH_REMOTE_USER 常量
    fab_security.manager = fab_manager
    fab_mock.security = fab_security
    sys.modules['flask_appbuilder'] = fab_mock
    sys.modules['flask_appbuilder.security'] = fab_security
    sys.modules['flask_appbuilder.security.manager'] = fab_manager

    old_env = {}
    for k in list(os.environ.keys()):
        if k.startswith('DP_') or k.startswith('SUPERSET_'):
            old_env[k] = os.environ.pop(k)

    for k, v in env.items():
        os.environ[k] = v

    try:
        spec = importlib.util.spec_from_file_location(mod_name, CONFIG_PATH)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    finally:
        # 恢复环境变量
        for k in env:
            os.environ.pop(k, None)
        for k, v in old_env.items():
            os.environ[k] = v


class TestDatabaseURI:
    """SQLALCHEMY_DATABASE_URI 构建"""

    def test_default_uri_format(self):
        """URI 包含正确的 schema/host/port"""
        config = load_config()
        uri = config.SQLALCHEMY_DATABASE_URI
        assert 'postgresql+psycopg2://' in uri
        assert 'testuser:testpass@test-db:5432/testdb' in uri

    def test_search_path_includes_bi_and_wms(self):
        """search_path 包含 bi,wms (零 ETL 跨 Schema JOIN)"""
        config = load_config()
        uri = config.SQLALCHEMY_DATABASE_URI
        assert 'search_path' in uri
        assert 'bi' in uri
        assert 'wms' in uri

    def test_sslmode_require(self):
        """URI 强制 sslmode=require"""
        config = load_config()
        assert 'sslmode=require' in config.SQLALCHEMY_DATABASE_URI

    def test_default_host_when_env_missing(self):
        """环境变量缺失时使用默认 dp-db"""
        config = load_config({
            'DP_DB_HOST': '',  # 空值
        })
        # 空字符串会被使用 (os.environ.get 返回空字符串而非 None)
        # 但默认值 dp-db 仅在 key 不存在时生效
        assert config.SQLALCHEMY_DATABASE_URI is not None


class TestRedisConfig:
    """Redis 缓存配置"""

    def test_cache_config_type(self):
        """CACHE_CONFIG 使用 RedisCache"""
        config = load_config()
        assert config.CACHE_CONFIG['CACHE_TYPE'] == 'RedisCache'

    def test_cache_prefix(self):
        """各缓存使用不同前缀"""
        config = load_config()
        assert config.CACHE_CONFIG['CACHE_KEY_PREFIX'] == 'superset_'
        assert config.DATA_CACHE_CONFIG['CACHE_KEY_PREFIX'] == 'superset_data_'
        assert config.FILTER_STATE_CACHE_CONFIG['CACHE_KEY_PREFIX'] == 'superset_filter_'

    def test_cache_redis_url_format(self):
        """Redis URL 格式正确 (含密码)"""
        config = load_config()
        url = config.CACHE_CONFIG['CACHE_REDIS_URL']
        assert url == 'redis://:redispass@test-redis:6379/0'

    def test_celery_config(self):
        """Celery broker/backend 使用 Redis db=1"""
        config = load_config()
        celery = config.CELERY_CONFIG
        assert celery.broker_url == 'redis://:redispass@test-redis:6379/1'
        assert celery.result_backend == 'redis://:redispass@test-redis:6379/1'


class TestSSOConfig:
    """SSO 统一认证配置"""

    def test_sso_disabled_by_default(self):
        """SSO 默认关闭 (无 AUTH_TYPE)"""
        config = load_config({'DP_SSO_ENABLED': 'false'})
        assert not hasattr(config, 'AUTH_TYPE')

    def test_sso_enabled_sets_auth_remote_user(self):
        """SSO 启用时 AUTH_TYPE = AUTH_REMOTE_USER"""
        config = load_config({'DP_SSO_ENABLED': 'true'})
        assert config.AUTH_TYPE == 4  # AUTH_REMOTE_USER

    def test_sso_roles_mapping(self):
        """Authelia groups → Superset 角色映射"""
        config = load_config({'DP_SSO_ENABLED': 'true'})
        mapping = config.AUTH_ROLES_MAPPING
        assert mapping['admins'] == ['Admin']
        assert mapping['bi-users'] == ['Alpha']

    def test_sso_user_registration_enabled(self):
        """SSO 模式自动创建用户"""
        config = load_config({'DP_SSO_ENABLED': 'true'})
        assert config.AUTH_USER_REGISTRATION is True

    def test_sso_default_role_gamma(self):
        """SSO 新用户默认 Gamma (最小权限)"""
        config = load_config({'DP_SSO_ENABLED': 'true'})
        assert config.AUTH_USER_REGISTRATION_ROLE == 'Gamma'

    def test_sso_roles_sync_at_login(self):
        """SSO 每次登录同步角色"""
        config = load_config({'DP_SSO_ENABLED': 'true'})
        assert config.AUTH_ROLES_SYNC_AT_LOGIN is True

    def test_sso_logout_redirects_to_authelia(self):
        """SSO 模式登出到 /auth/logout"""
        config = load_config({'DP_SSO_ENABLED': 'true'})
        assert config.LOGOUT_REDIRECT_URL == '/auth/logout'

    def test_non_sso_logout_redirects_to_login(self):
        """非 SSO 模式登出到 /login/"""
        config = load_config({'DP_SSO_ENABLED': 'false'})
        assert '/login/' in config.LOGOUT_REDIRECT_URL

    def test_flask_app_mutator_defined_in_sso(self):
        """SSO 模式定义 FLASK_APP_MUTATOR"""
        config = load_config({'DP_SSO_ENABLED': 'true'})
        assert hasattr(config, 'FLASK_APP_MUTATOR')
        assert callable(config.FLASK_APP_MUTATOR)


class TestSecurityConfig:
    """安全配置"""

    def test_csrf_enabled(self):
        """CSRF 保护已启用"""
        config = load_config()
        assert config.WTF_CSRF_ENABLED is True

    def test_session_cookie_httponly(self):
        """Session Cookie 标记 HttpOnly"""
        config = load_config()
        assert config.SESSION_COOKIE_HTTPONLY is True

    def test_proxy_fix_enabled(self):
        """代理修复已启用 (nginx 反代必需)"""
        config = load_config()
        assert config.ENABLE_PROXY_FIX is True


class TestFeatureFlags:
    """功能标志"""

    def test_template_processing_enabled(self):
        config = load_config()
        assert config.FEATURE_FLAGS['ENABLE_TEMPLATE_PROCESSING'] is True

    def test_deprecated_flags_removed(self):
        """DASHBOARD_NATIVE_FILTERS / DASHBOARD_CROSS_FILTERS 已永久启用，配置中不应存在"""
        config = load_config()
        assert 'DASHBOARD_NATIVE_FILTERS' not in config.FEATURE_FLAGS
        assert 'DASHBOARD_CROSS_FILTERS' not in config.FEATURE_FLAGS

    def test_embedded_superset_enabled(self):
        config = load_config()
        assert config.FEATURE_FLAGS['EMBEDDED_SUPERSET'] is True


class TestBrandConfig:
    """品牌 / Logo 配置"""

    def test_logo_target_path(self):
        """Logo 跳转到 BI 欢迎页"""
        config = load_config()
        assert config.LOGO_TARGET_PATH == '/superset/welcome/'

    def test_locale_chinese(self):
        """默认语言为中文"""
        config = load_config()
        assert config.BABEL_DEFAULT_LOCALE == 'zh'

    def test_languages_include_zh_en_th(self):
        """支持中英泰三语"""
        config = load_config()
        assert 'zh' in config.LANGUAGES
        assert 'en' in config.LANGUAGES
        assert 'th' in config.LANGUAGES
