# =============================================================================
# DP v0.1 — BI 引擎配置
# PostgreSQL 元数据后端 (Schema: bi) + Redis 缓存 (dp-cache-bi)
# =============================================================================

import os

# ---------------------------------------------------------------------------
# 密钥 (必须在 .env 中设置!)
# ---------------------------------------------------------------------------
SECRET_KEY = os.environ.get('SUPERSET_SECRET_KEY', '')

# ---------------------------------------------------------------------------
# 元数据数据库 (PostgreSQL, Schema: bi)
# ---------------------------------------------------------------------------
_db_host = os.environ.get('DP_DB_HOST', 'dp-db')
_db_port = os.environ.get('DP_DB_PORT', '5432')
_db_name = os.environ.get('DP_DB_NAME', 'dp')
_db_user = os.environ.get('DP_DB_USER', 'dp_app')
_db_pass = os.environ.get('DP_DB_PASSWORD', '')

SQLALCHEMY_DATABASE_URI = (
    f'postgresql+psycopg2://{_db_user}:{_db_pass}@{_db_host}:{_db_port}/{_db_name}'
    f'?options=-c%20search_path%3Dbi%2Cwms&sslmode=require'
)

# ---------------------------------------------------------------------------
# Redis 缓存 (dp-cache-bi)
# ---------------------------------------------------------------------------
_redis_host = os.environ.get('DP_REDIS_BI_HOST', 'dp-cache-bi')
_redis_port = os.environ.get('DP_REDIS_BI_PORT', '6379')
_redis_pass = os.environ.get('DP_REDIS_BI_PASSWORD', '')

CACHE_CONFIG = {
    'CACHE_TYPE': 'RedisCache',
    'CACHE_DEFAULT_TIMEOUT': 300,
    'CACHE_KEY_PREFIX': 'superset_',
    'CACHE_REDIS_URL': f'redis://:{_redis_pass}@{_redis_host}:{_redis_port}/0',
}

DATA_CACHE_CONFIG = {
    'CACHE_TYPE': 'RedisCache',
    'CACHE_DEFAULT_TIMEOUT': 600,
    'CACHE_KEY_PREFIX': 'superset_data_',
    'CACHE_REDIS_URL': f'redis://:{_redis_pass}@{_redis_host}:{_redis_port}/0',
}

FILTER_STATE_CACHE_CONFIG = {
    'CACHE_TYPE': 'RedisCache',
    'CACHE_DEFAULT_TIMEOUT': 600,
    'CACHE_KEY_PREFIX': 'superset_filter_',
    'CACHE_REDIS_URL': f'redis://:{_redis_pass}@{_redis_host}:{_redis_port}/0',
}

# Celery (异步查询)
class CeleryConfig:
    broker_url = f'redis://:{_redis_pass}@{_redis_host}:{_redis_port}/1'
    result_backend = f'redis://:{_redis_pass}@{_redis_host}:{_redis_port}/1'
    task_annotations = {
        'sql_lab.get_sql_results': {
            'rate_limit': '100/m',
        },
    }

CELERY_CONFIG = CeleryConfig

# ---------------------------------------------------------------------------
# 路径前缀 (通过 nginx /bi/ 访问)
# ---------------------------------------------------------------------------
ENABLE_PROXY_FIX = True

# ---------------------------------------------------------------------------
# 功能标志
# ---------------------------------------------------------------------------
FEATURE_FLAGS = {
    'ENABLE_TEMPLATE_PROCESSING': True,
    'DASHBOARD_NATIVE_FILTERS': True,
    'DASHBOARD_CROSS_FILTERS': True,
    'EMBEDDED_SUPERSET': True,
}

# ---------------------------------------------------------------------------
# 时区
# ---------------------------------------------------------------------------
BABEL_DEFAULT_LOCALE = 'zh'
BABEL_DEFAULT_FOLDER = 'superset/translations'
LANGUAGES = {
    'en': {'flag': 'us', 'name': 'English'},
    'zh': {'flag': 'cn', 'name': 'Chinese'},
    'th': {'flag': 'th', 'name': 'Thai'},
}

# ---------------------------------------------------------------------------
# 品牌 / Logo 跳转路径
# ---------------------------------------------------------------------------
# 点击 Logo 跳转到 BI 欢迎页 (而非根路径 / 导航页)
LOGO_TARGET_PATH = '/superset/welcome/'

# 必须同步覆盖 THEME_DEFAULT，否则 React 前端仍使用默认 brandLogoHref="/"
THEME_DEFAULT = {
    'token': {
        'brandLogoHref': '/superset/welcome/',
    },
}

# ---------------------------------------------------------------------------
# 登出重定向 (防止回到网关 landing 页)
# ---------------------------------------------------------------------------
# 问题链路: 退出 → /login/ (无 next) → 登录成功 → FAB 默认跳 / → nginx = / → landing
# 修复: 携带 next 参数，登录成功后直接回 BI 欢迎页
LOGOUT_REDIRECT_URL = '/login/?next=/superset/welcome/'

# ---------------------------------------------------------------------------
# 安全
# ---------------------------------------------------------------------------
WTF_CSRF_ENABLED = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = False  # 生产环境改为 True
TALISMAN_ENABLED = False       # 生产环境改为 True
RECAPTCHA_PUBLIC_KEY = ''      # Superset 6.0 需要此键 (不启用 reCAPTCHA)

# ---------------------------------------------------------------------------
# SSO 统一认证 (Authelia Remote-User header)
# ---------------------------------------------------------------------------
# nginx auth_request → Authelia 验证 → X-Forwarded-User header 注入
# FAB AUTH_REMOTE_USER_HEADER: 直接指定 WSGI environ 变量名 (HTTP_X_FORWARDED_USER)
# 无需 WSGI middleware — FAB 原生支持此配置
# 注意: ENABLE_PROXY_FIX 必须全局生效 (已在上面启用), 否则 Superset 无法识别代理 header
if os.environ.get('DP_SSO_ENABLED', 'false').lower() == 'true':
    from flask_appbuilder.security.manager import AUTH_REMOTE_USER
    AUTH_TYPE = AUTH_REMOTE_USER
    # 自动创建 Superset 内部用户 (非自注册, 仅从 SSO header 同步)
    AUTH_USER_REGISTRATION = True
    # SSO 新用户默认 Alpha (可用 SQL Lab/创建图表, 但不是管理员)
    # Public 完全无权限 (API 全 403, BI 页面白屏); Alpha 是最低可用角色
    # 管理员需手动在 Superset 中提权为 Admin
    AUTH_USER_REGISTRATION_ROLE = 'Alpha'
    # 未来: AUTH_ROLES_MAPPING 将 Authelia groups → Superset 角色
    # AUTH_ROLES_MAPPING = {"admins": ["Admin"], "bi-users": ["Alpha"]}

    # SSO 模式下登出重定向到 Authelia
    LOGOUT_REDIRECT_URL = '/auth/logout'

    # -----------------------------------------------------------------------
    # Superset 6.0 SSO 修复: before_request 注入 Remote-User 认证
    # -----------------------------------------------------------------------
    # 问题: Superset 6.0 SupersetAuthView.login() 完全覆盖 FAB AuthRemoteUserView
    #        从不读取 REMOTE_USER environ — 只渲染登录页 React SPA
    # 修复: FLASK_APP_MUTATOR + before_request hook 绕过 Superset 的 login view
    #        在每个请求前检查 HTTP_REMOTE_USER, 自动认证+创建用户
    # 附加: /login/ 路径直接重定向到 welcome (防止 Superset 内部 302 → /login/ 循环)
    def FLASK_APP_MUTATOR(app):
        @app.before_request
        def sso_remote_user_auth():
            from flask import request, g, redirect
            from flask_login import login_user
            username = request.environ.get('HTTP_REMOTE_USER')
            if not username:
                return  # 非 SSO 请求 (bypass 路径或内部调用)
            if g.user is not None and g.user.is_authenticated:
                # 已认证 — 但如果访问 /login/ 需要重定向走 (防循环)
                if request.path == '/login/' or request.path == '/login':
                    next_url = request.args.get('next', '/superset/welcome/')
                    return redirect(next_url)
                return
            # 调用 FAB auth_user_remote_user: 查找或自动创建用户
            sm = app.appbuilder.sm
            user = sm.auth_user_remote_user(username)
            if user:
                login_user(user)
                # 登录成功后如果在 /login/ 页, 直接跳转 (防 Superset 渲染 React 登录页)
                if request.path == '/login/' or request.path == '/login':
                    next_url = request.args.get('next', '/superset/welcome/')
                    return redirect(next_url)
