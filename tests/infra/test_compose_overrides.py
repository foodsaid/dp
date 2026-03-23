# =============================================================================
# test_compose_overrides.py — Docker Compose 覆盖层结构验证
# =============================================================================
# 策略: 用 PyYAML 解析三个 Compose 文件，静态断言关键配置
#       不依赖 docker/docker-compose 命令，CI 无需 Docker 环境
#
# 覆盖:
#   1. 基础层 (docker-compose.yml)  — 服务列表、无硬编码密码、必填变量引用
#   2. 开发层 (docker-compose.dev.yml) — 端口绑定 127.0.0.1、热更新挂载
#   3. 生产层 (docker-compose.prod.yml) — restart:always、资源限制、安全配置
# =============================================================================
import os
import re
import yaml
import pytest

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BASE_COMPOSE  = os.path.join(PROJECT_ROOT, 'docker-compose.yml')
DEV_COMPOSE   = os.path.join(PROJECT_ROOT, 'docker-compose.dev.yml')
PROD_COMPOSE  = os.path.join(PROJECT_ROOT, 'docker-compose.prod.yml')

# 核心服务列表 (必须在基础层存在)
CORE_SERVICES = [
    'dp-db', 'dp-cache-wf', 'dp-cache-bi',
    'dp-wms-web', 'dp-wf', 'dp-wf-worker',
    'dp-bi', 'dp-gateway',
]

# 生产层必须有 restart:always 的服务
PROD_RESTART_SERVICES = [
    'dp-db', 'dp-cache-wf', 'dp-cache-bi',
    'dp-wms-web', 'dp-wf', 'dp-wf-worker',
    'dp-bi', 'dp-gateway',
]

# 生产层必须有资源限制的服务
PROD_RESOURCE_LIMIT_SERVICES = [
    'dp-db', 'dp-wf', 'dp-wf-worker', 'dp-bi',
]

# 绝不允许硬编码的敏感字符串模式
HARDCODED_SECRET_PATTERNS = [
    re.compile(r'(?:password|secret|key)\s*:\s*["\'][^${\s][^"\']{3,}["\']', re.IGNORECASE),
]


def load_compose(path):
    with open(path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)


def collect_all_values(obj, results=None):
    """递归收集所有字符串值"""
    if results is None:
        results = []
    if isinstance(obj, dict):
        for v in obj.values():
            collect_all_values(v, results)
    elif isinstance(obj, list):
        for item in obj:
            collect_all_values(item, results)
    elif isinstance(obj, str):
        results.append(obj)
    return results


# ===========================================================================
# 基础层测试
# ===========================================================================

class TestBaseCompose:
    """docker-compose.yml 基础层结构验证"""

    def test_file_exists(self):
        """基础 Compose 文件存在"""
        assert os.path.isfile(BASE_COMPOSE)

    def test_project_name_is_dp(self):
        """项目名称为 dp"""
        d = load_compose(BASE_COMPOSE)
        assert d.get('name') == 'dp'

    def test_all_core_services_present(self):
        """所有核心服务均在基础层定义"""
        d = load_compose(BASE_COMPOSE)
        services = d.get('services', {})
        for svc in CORE_SERVICES:
            assert svc in services, f"核心服务 {svc} 未在基础层定义"

    def test_container_names_follow_dp_convention(self):
        """容器名称遵循 dp- 命名约定"""
        d = load_compose(BASE_COMPOSE)
        for svc_name, svc_cfg in d.get('services', {}).items():
            if svc_cfg and 'container_name' in svc_cfg:
                assert svc_cfg['container_name'].startswith('dp-'), \
                    f"容器 {svc_cfg['container_name']} 不符合 dp- 命名约定"

    def test_db_password_uses_env_var(self):
        """数据库密码通过环境变量注入，不硬编码"""
        d = load_compose(BASE_COMPOSE)
        db_env = d['services']['dp-db'].get('environment', {})
        if isinstance(db_env, dict):
            pg_password = db_env.get('POSTGRES_PASSWORD', '')
        else:
            # list format: ["KEY=VALUE"]
            pg_password = next((e.split('=', 1)[1] for e in db_env
                                if isinstance(e, str) and e.startswith('POSTGRES_PASSWORD=')), '')
        # 必须是变量引用格式 ${...}
        assert str(pg_password).startswith('${') or str(pg_password) == '', \
            f"POSTGRES_PASSWORD 不应硬编码，应使用 ${{DP_DB_PASSWORD}} 形式"

    def test_no_hardcoded_non_loopback_ip_in_configs(self):
        """配置文件中不含硬编码公网 IP
        允许: 127.0.0.1 (回环) / 10.x.x.x / 172.16-31.x.x (私有) / 0.0.0.0 (容器监听)
        """
        d = load_compose(BASE_COMPOSE)
        # 排除保留地址: 0.0.0.0/127.x/10.x/172.16-31.x/192.168.x (RFC1918私有网段)
        ip_pattern = re.compile(
            r'\b(?!0\.0\.0\.0\b)(?!127\.)(?!10\.)(?!172\.1[6-9]\.)(?!172\.2\d\.)(?!172\.3[01]\.)'
            r'(?!192\.168\.)(\d{1,3}\.){3}\d{1,3}\b'
        )
        all_vals = collect_all_values(d.get('services', {}))
        for val in all_vals:
            match = ip_pattern.search(val)
            if match:
                pytest.fail(f"发现疑似硬编码 IP: {match.group()} (值: {val[:80]})")

    def test_monitoring_services_use_profile(self):
        """监控服务使用 monitoring profile 隔离，不在默认启动"""
        d = load_compose(BASE_COMPOSE)
        monitoring_services = ['dp-prometheus', 'dp-grafana', 'dp-alertmanager',
                               'dp-node-exporter', 'dp-cadvisor', 'dp-loki', 'dp-alloy']
        for svc in monitoring_services:
            if svc in d.get('services', {}):
                profiles = d['services'][svc].get('profiles', [])
                assert 'monitoring' in profiles, \
                    f"监控服务 {svc} 应属于 monitoring profile"

    def test_dp_db_has_healthcheck_or_depends_on(self):
        """wp-wf 或其他服务应有 depends_on dp-db (数据库先启动)"""
        d = load_compose(BASE_COMPOSE)
        wf_svc = d['services'].get('dp-wf', {}) or {}
        depends = wf_svc.get('depends_on', {})
        if isinstance(depends, list):
            assert 'dp-db' in depends
        elif isinstance(depends, dict):
            assert 'dp-db' in depends


# ===========================================================================
# 开发层测试
# ===========================================================================

class TestDevCompose:
    """docker-compose.dev.yml 开发覆盖层验证"""

    def test_file_exists(self):
        """开发覆盖层文件存在"""
        assert os.path.isfile(DEV_COMPOSE)

    def test_all_exposed_ports_bind_localhost(self):
        """所有暴露端口绑定到 127.0.0.1，不暴露到 0.0.0.0"""
        d = load_compose(DEV_COMPOSE)
        for svc_name, svc_cfg in d.get('services', {}).items():
            if not svc_cfg or 'ports' not in svc_cfg:
                continue
            for port_entry in svc_cfg['ports']:
                port_str = str(port_entry)
                # 格式: "127.0.0.1:HOST:CONTAINER" 或 "${VAR}:HOST:CONTAINER"
                # 不允许直接 "HOST:CONTAINER" (会绑定 0.0.0.0)
                if ':' in port_str:
                    parts = port_str.split(':')
                    if len(parts) == 2:
                        # "HOST:CONTAINER" 格式 → 绑定 0.0.0.0，不允许
                        pytest.fail(
                            f"服务 {svc_name} 端口 {port_str} 绑定到 0.0.0.0，"
                            f"开发环境应使用 127.0.0.1:HOST:CONTAINER 格式"
                        )

    def test_db_port_uses_env_var(self):
        """dp-db 端口使用 DP_DB_PORT 变量"""
        d = load_compose(DEV_COMPOSE)
        db_cfg = d.get('services', {}).get('dp-db', {}) or {}
        ports = db_cfg.get('ports', [])
        assert len(ports) > 0, "dp-db 开发层应暴露端口"
        port_str = str(ports[0])
        assert 'DP_DB_PORT' in port_str or '5432' in port_str, \
            "dp-db 端口应使用 DP_DB_PORT 环境变量"

    def test_wms_web_has_bind_mount(self):
        """dp-wms-web 开发层有 bind-mount 热更新挂载"""
        d = load_compose(DEV_COMPOSE)
        wms_cfg = d.get('services', {}).get('dp-wms-web', {}) or {}
        volumes = wms_cfg.get('volumes', [])
        has_wms_mount = any('apps/wms' in str(v) for v in volumes)
        assert has_wms_mount, "dp-wms-web 开发层应有 apps/wms 热更新挂载"

    def test_n8n_port_exposed_for_debugging(self):
        """dp-wf 开发层暴露 5678 端口 (调试用)"""
        d = load_compose(DEV_COMPOSE)
        wf_cfg = d.get('services', {}).get('dp-wf', {}) or {}
        ports = wf_cfg.get('ports', [])
        assert any('5678' in str(p) for p in ports), \
            "dp-wf 开发层应暴露 5678 端口"


# ===========================================================================
# 生产层测试
# ===========================================================================

class TestProdCompose:
    """docker-compose.prod.yml 生产覆盖层验证"""

    def test_file_exists(self):
        """生产覆盖层文件存在"""
        assert os.path.isfile(PROD_COMPOSE)

    @pytest.mark.parametrize('svc', PROD_RESTART_SERVICES)
    def test_core_services_have_restart_always(self, svc):
        """核心服务生产层设置 restart: always"""
        d = load_compose(PROD_COMPOSE)
        svc_cfg = d.get('services', {}).get(svc, {}) or {}
        assert svc_cfg.get('restart') == 'always', \
            f"生产服务 {svc} 应设置 restart: always"

    @pytest.mark.parametrize('svc', PROD_RESOURCE_LIMIT_SERVICES)
    def test_critical_services_have_memory_limits(self, svc):
        """关键服务生产层设置内存限制"""
        d = load_compose(PROD_COMPOSE)
        svc_cfg = d.get('services', {}).get(svc, {}) or {}
        deploy = svc_cfg.get('deploy', {}) or {}
        resources = deploy.get('resources', {}) or {}
        limits = resources.get('limits', {}) or {}
        assert 'memory' in limits, \
            f"生产服务 {svc} 应设置内存上限 (deploy.resources.limits.memory)"

    def test_n8n_secure_cookie_enabled_in_prod(self):
        """生产层 n8n 启用 Secure Cookie (HTTPS 环境)"""
        d = load_compose(PROD_COMPOSE)
        wf_cfg = d.get('services', {}).get('dp-wf', {}) or {}
        env = wf_cfg.get('environment', {}) or {}
        if isinstance(env, dict):
            secure_cookie = env.get('N8N_SECURE_COOKIE', '')
        else:
            secure_cookie = next((e.split('=', 1)[1] for e in env
                                  if isinstance(e, str) and e.startswith('N8N_SECURE_COOKIE=')), '')
        assert str(secure_cookie).lower() in ('true', '"true"'), \
            "生产层 dp-wf 应设置 N8N_SECURE_COOKIE: 'true'"

    def test_n8n_diagnostics_disabled_in_prod(self):
        """生产层 n8n 关闭遥测 (N8N_DIAGNOSTICS_ENABLED=false)"""
        d = load_compose(PROD_COMPOSE)
        wf_cfg = d.get('services', {}).get('dp-wf', {}) or {}
        env = wf_cfg.get('environment', {}) or {}
        if isinstance(env, dict):
            diag = env.get('N8N_DIAGNOSTICS_ENABLED', 'true')
        else:
            diag = next((e.split('=', 1)[1] for e in env
                         if isinstance(e, str) and e.startswith('N8N_DIAGNOSTICS_ENABLED=')), 'true')
        assert str(diag).lower() in ('false', '"false"'), \
            "生产层 dp-wf 应禁用 N8N_DIAGNOSTICS_ENABLED"

    def test_gateway_uses_prod_nginx_config(self):
        """生产层 gateway 使用 conf.d-prod (生产 nginx 配置)"""
        d = load_compose(PROD_COMPOSE)
        gw_cfg = d.get('services', {}).get('dp-gateway', {}) or {}
        volumes = gw_cfg.get('volumes', [])
        has_prod_conf = any('conf.d-prod' in str(v) for v in volumes)
        assert has_prod_conf, \
            "生产层 dp-gateway 应挂载 infrastructure/nginx/conf.d-prod"

    def test_data_dir_uses_env_var_not_hardcoded_path(self):
        """生产层数据目录使用 DP_DATA_DIR 变量，不硬编码绝对路径"""
        with open(PROD_COMPOSE, 'r', encoding='utf-8') as f:
            content = f.read()
        # 检查 /home/ 硬编码路径
        if re.search(r':\s*/home/\w+/', content):
            pytest.fail("生产层 Compose 文件中发现硬编码 /home/ 路径，应使用 ${DP_DATA_DIR}")

    def test_wms_web_sets_env_name_production(self):
        """生产层 dp-wms-web 设置 ENV_NAME=production"""
        d = load_compose(PROD_COMPOSE)
        wms_cfg = d.get('services', {}).get('dp-wms-web', {}) or {}
        env = wms_cfg.get('environment', {}) or {}
        if isinstance(env, dict):
            env_name = env.get('ENV_NAME', '')
        else:
            env_name = next((e.split('=', 1)[1] for e in env
                             if isinstance(e, str) and e.startswith('ENV_NAME=')), '')
        assert env_name == 'production', \
            "生产层 dp-wms-web 应设置 ENV_NAME=production"
