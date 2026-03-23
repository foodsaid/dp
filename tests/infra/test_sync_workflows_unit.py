# =============================================================================
# sync-workflows.py 单元测试 — 核心函数 Mock 测试
# =============================================================================
# 策略: 导入脚本模块函数，Mock subprocess/urllib 调用
# =============================================================================
import os
import sys
import json
import hashlib
import importlib
import importlib.util
import tempfile
import pytest

# 动态加载 sync-workflows.py (文件名含连字符，不能直接 import)
SCRIPT_PATH = os.path.join(
    os.path.dirname(__file__), '..', '..', 'scripts', 'n8n-tools', 'sync-workflows.py'
)
spec = importlib.util.spec_from_file_location('sync_workflows', SCRIPT_PATH)
sync_mod = importlib.util.module_from_spec(spec)


class TestRunFunction:
    """run() — 命令执行包装"""

    def test_run_with_list_cmd(self, mocker):
        """列表命令不经过 shell"""
        mock_run = mocker.patch('subprocess.run')
        mock_run.return_value = mocker.MagicMock(returncode=0, stdout='ok', stderr='')
        spec.loader.exec_module(sync_mod)
        result = sync_mod.run(['echo', 'hello'])
        mock_run.assert_called_once()
        assert mock_run.call_args[0][0] == ['echo', 'hello']

    def test_run_with_string_cmd_splits(self, mocker):
        """字符串命令自动 shlex.split"""
        mock_run = mocker.patch('subprocess.run')
        mock_run.return_value = mocker.MagicMock(returncode=0, stdout='', stderr='')
        spec.loader.exec_module(sync_mod)
        sync_mod.run('echo hello world')
        args = mock_run.call_args[0][0]
        assert args == ['echo', 'hello', 'world']

    def test_run_stderr_warning(self, mocker, capsys):
        """非零返回码 + stderr 时打印警告"""
        mock_run = mocker.patch('subprocess.run')
        mock_run.return_value = mocker.MagicMock(returncode=1, stdout='', stderr='some error')
        spec.loader.exec_module(sync_mod)
        sync_mod.run(['false'], check=True)
        captured = capsys.readouterr()
        assert 'some error' in captured.out


class TestPsqlFunctions:
    """psql() / psql_exec() — SQL 执行包装"""

    def test_psql_passes_sql_via_stdin(self, mocker):
        """SQL 通过 stdin 传递 (防注入)"""
        mock_run = mocker.patch('subprocess.run')
        mock_run.return_value = mocker.MagicMock(returncode=0, stdout='result\n', stderr='')
        spec.loader.exec_module(sync_mod)
        result = sync_mod.psql('SELECT 1')
        # 验证 input 参数
        assert mock_run.call_args[1].get('input') == 'SELECT 1' or mock_run.call_args.kwargs.get('input') == 'SELECT 1'
        assert result == 'result'

    def test_psql_exec_returns_subprocess_result(self, mocker):
        """psql_exec 返回 subprocess.run 结果"""
        mock_run = mocker.patch('subprocess.run')
        expected = mocker.MagicMock(returncode=0)
        mock_run.return_value = expected
        spec.loader.exec_module(sync_mod)
        result = sync_mod.psql_exec('DELETE FROM test')
        assert result == expected


class TestWorkflowIdGeneration:
    """工作流 ID 生成 — hashlib SHA-256 截断"""

    def test_id_from_filename(self):
        """文件名 → SHA-256 前 10 位"""
        filename = 'wf02-transaction.json'
        expected = hashlib.sha256(filename.encode()).hexdigest()[:10]
        assert len(expected) == 10
        # 验证确定性
        assert hashlib.sha256(filename.encode()).hexdigest()[:10] == expected

    def test_different_files_different_ids(self):
        """不同文件名生成不同 ID"""
        id1 = hashlib.sha256('wf02.json'.encode()).hexdigest()[:10]
        id2 = hashlib.sha256('wf03.json'.encode()).hexdigest()[:10]
        assert id1 != id2


class TestMainFunction:
    """main() — 主流程集成"""

    def test_no_api_key_exits(self, mocker):
        """缺少 API_KEY 时 sys.exit(1)"""
        mocker.patch.dict(os.environ, {'N8N_API_KEY': ''}, clear=False)
        spec.loader.exec_module(sync_mod)
        sync_mod.API_KEY = ''
        with pytest.raises(SystemExit) as exc_info:
            sync_mod.main()
        assert exc_info.value.code == 1

    def test_main_with_empty_wf_dir(self, mocker, tmp_path):
        """空工作流目录时跳过导入步骤"""
        mocker.patch.dict(os.environ, {'N8N_API_KEY': 'test-key'}, clear=False)
        spec.loader.exec_module(sync_mod)
        sync_mod.API_KEY = 'test-key'
        sync_mod.WF_DIR = str(tmp_path)

        mock_psql = mocker.patch.object(sync_mod, 'psql', return_value='')
        mock_psql_exec = mocker.patch.object(sync_mod, 'psql_exec')
        mock_run = mocker.patch.object(sync_mod, 'run')
        # 模拟 n8n 健康检查成功
        mock_run.return_value = mocker.MagicMock(returncode=0, stdout='"ok"', stderr='')

        sync_mod.main()
        # 应该调用了 psql 查旧工作流
        mock_psql.assert_called()
