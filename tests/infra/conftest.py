# =============================================================================
# pytest 基础设施测试配置
# =============================================================================
# 为 scripts/ 下的 Python 运维脚本提供通用 fixture
# 策略: 深度 mock 所有外部依赖 (DB/Docker/网络), 零真实副作用
# =============================================================================
import os
import sys
import pytest

# 将项目根目录加入 sys.path (便于 importlib 加载脚本)
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SCRIPTS_DIR = os.path.join(PROJECT_ROOT, 'scripts')


@pytest.fixture
def project_root():
    """返回项目根目录路径"""
    return PROJECT_ROOT


@pytest.fixture
def scripts_dir():
    """返回 scripts/ 目录路径"""
    return SCRIPTS_DIR


@pytest.fixture
def fake_env_file(tmp_path):
    """创建模拟 .env 文件"""
    env_content = """# 测试环境配置
DP_COMPANY_CODE=TEST01
DP_DB_PORT=5432
DP_DB_NAME=dp
DP_DB_USER=dp_app
DP_DB_PASSWORD=test_password
DB_POSTGRESDB_DATABASE=dp
DB_POSTGRESDB_USER=dp_app
DB_POSTGRESDB_PASSWORD=test_password
"""
    env_file = tmp_path / '.env'
    env_file.write_text(env_content)
    return str(env_file)


@pytest.fixture
def mock_psycopg2(mocker):
    """深度 mock psycopg2 连接 (拦截所有数据库操作)"""
    mock_conn = mocker.MagicMock()
    mock_cursor = mocker.MagicMock()
    mock_conn.cursor.return_value = mock_cursor
    mock_cursor.rowcount = 0
    mock_cursor.fetchone.return_value = None
    mock_cursor.fetchall.return_value = []

    mock_module = mocker.MagicMock()
    mock_module.connect.return_value = mock_conn
    return mock_module, mock_conn, mock_cursor


@pytest.fixture
def mock_subprocess(mocker):
    """深度 mock subprocess.run (拦截所有子进程调用)"""
    mock_run = mocker.patch('subprocess.run')
    mock_result = mocker.MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = ''
    mock_result.stderr = ''
    mock_run.return_value = mock_result
    return mock_run, mock_result
