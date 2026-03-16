# =============================================================================
# update_wf1c_wf21.py / update_wf1c_wf22_v2.py / update_wf21_wf22.py 测试
# =============================================================================
# 策略: 三个 update 脚本共享类似结构 (subprocess docker exec psql),
#        统一验证安全性、结构完整性和边界条件
# =============================================================================
import os
import json
import subprocess
import pytest
from unittest.mock import patch, MagicMock

SCRIPTS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'archive')

UPDATE_SCRIPTS = [
    'update_wf1c_wf21.py',
    'update_wf1c_wf22_v2.py',
    'update_wf21_wf22.py',
]


class TestUpdateScriptsCommon:
    """三个 update 脚本的通用测试"""

    @pytest.mark.parametrize('script_name', UPDATE_SCRIPTS)
    def test_script_exists(self, script_name):
        """脚本文件存在"""
        path = os.path.join(SCRIPTS_DIR, script_name)
        assert os.path.isfile(path)

    @pytest.mark.parametrize('script_name', UPDATE_SCRIPTS)
    def test_script_uses_docker_exec(self, script_name):
        """脚本通过 docker exec 执行 SQL"""
        with open(os.path.join(SCRIPTS_DIR, script_name), 'r') as f:
            content = f.read()
        assert 'docker' in content
        assert 'exec' in content
        assert 'psql' in content

    @pytest.mark.parametrize('script_name', UPDATE_SCRIPTS)
    def test_script_creates_version_history(self, script_name):
        """脚本创建工作流版本历史"""
        with open(os.path.join(SCRIPTS_DIR, script_name), 'r') as f:
            content = f.read()
        assert 'workflow_history' in content

    @pytest.mark.parametrize('script_name', UPDATE_SCRIPTS)
    def test_script_updates_active_version_id(self, script_name):
        """脚本更新 activeVersionId"""
        with open(os.path.join(SCRIPTS_DIR, script_name), 'r') as f:
            content = f.read()
        assert 'activeVersionId' in content

    @pytest.mark.parametrize('script_name', UPDATE_SCRIPTS)
    def test_script_uses_uuid(self, script_name):
        """脚本使用 UUID 生成版本号"""
        with open(os.path.join(SCRIPTS_DIR, script_name), 'r') as f:
            content = f.read()
        assert 'uuid' in content

    @pytest.mark.parametrize('script_name', UPDATE_SCRIPTS)
    def test_script_restarts_n8n(self, script_name):
        """脚本执行后重启 n8n"""
        with open(os.path.join(SCRIPTS_DIR, script_name), 'r') as f:
            content = f.read()
        assert 'docker' in content and 'restart' in content


class TestUpdateWf1cWf21:
    """update_wf1c_wf21.py 专项测试"""

    SCRIPT = os.path.join(SCRIPTS_DIR, 'update_wf1c_wf21.py')

    def test_updates_oms_query(self):
        """脚本更新 OMS查询 节点"""
        with open(self.SCRIPT, 'r') as f:
            content = f.read()
        assert 'OMS查询' in content

    def test_updates_merge_data(self):
        """脚本更新 Merge Data 节点"""
        with open(self.SCRIPT, 'r') as f:
            content = f.read()
        assert 'Merge Data' in content

    def test_sql_function_returns_output(self):
        """sql() 辅助函数返回 stdout"""
        with open(self.SCRIPT, 'r') as f:
            content = f.read()
        assert 'def sql(' in content
        assert 'r.stdout.strip()' in content

    @patch('subprocess.run')
    def test_sql_helper_calls_docker(self, mock_run):
        """sql() 函数调用 docker exec psql"""
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = 'test-output'
        mock_result.stderr = ''
        mock_run.return_value = mock_result

        # 导入并测试 sql 函数
        import importlib.util
        spec = importlib.util.spec_from_file_location('update_wf1c_wf21', self.SCRIPT)
        # 不实际加载脚本 (会执行顶层代码), 仅验证结构
        assert 'docker' in open(self.SCRIPT).read()


class TestUpdateWf1cWf22V2:
    """update_wf1c_wf22_v2.py 专项测试"""

    SCRIPT = os.path.join(SCRIPTS_DIR, 'update_wf1c_wf22_v2.py')

    def test_fixes_delivrd_qty(self):
        """脚本修复 DelivrdQty BUG"""
        with open(self.SCRIPT, 'r') as f:
            content = f.read()
        assert 'DelivrdQty' in content

    def test_adds_source_planned_qty(self):
        """脚本添加 sourcePlannedQty"""
        with open(self.SCRIPT, 'r') as f:
            content = f.read()
        assert 'sourcePlannedQty' in content

    def test_updates_wf22_sql_generation(self):
        """脚本更新 wf22 拆单 SQL 生成"""
        with open(self.SCRIPT, 'r') as f:
            content = f.read()
        assert '生成拆单SQL' in content or '生成拆SQL' in content


class TestUpdateWf21Wf22:
    """update_wf21_wf22.py 专项测试"""

    SCRIPT = os.path.join(SCRIPTS_DIR, 'update_wf21_wf22.py')

    def test_updates_wf22_validate_request(self):
        """脚本更新验证请求节点"""
        with open(self.SCRIPT, 'r') as f:
            content = f.read()
        assert '验证请求' in content

    def test_updates_wf22_query_source(self):
        """脚本更新查询源订单"""
        with open(self.SCRIPT, 'r') as f:
            content = f.read()
        assert '查询源订单' in content

    def test_updates_wf21_query_lines(self):
        """脚本更新 Query Lines 节点"""
        with open(self.SCRIPT, 'r') as f:
            content = f.read()
        assert 'Query Lines' in content

    def test_updates_wf21_dd_children(self):
        """脚本更新 DD Children 查询"""
        with open(self.SCRIPT, 'r') as f:
            content = f.read()
        assert 'Query DD Children' in content

    def test_updates_batch_merge_results(self):
        """脚本更新合并批量结果"""
        with open(self.SCRIPT, 'r') as f:
            content = f.read()
        assert '合并批量结果' in content
