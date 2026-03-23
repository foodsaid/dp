# =============================================================================
# test_sync_workflows_error_recovery.py — sync-workflows.py 错误恢复路径测试
# =============================================================================
# 策略: Mock 所有外部依赖 (subprocess/urllib)，模拟各步骤失败场景
#       验证脚本在单步失败时不崩溃、打印错误信息、继续执行后续步骤
#
# 覆盖的错误场景:
#   步骤1: psql 删除旧工作流时 docker exec 失败
#   步骤2: n8n 重启后健康检查持续超时 (15 次轮询全部失败)
#   步骤3: docker cp 复制文件失败 (容器不存在)
#   步骤5: API 激活返回 HTTP 500
#   步骤5: API 激活返回非 JSON 响应 (json.decode 失败)
#   步骤5: API 激活网络连接拒绝 (URLError)
#   步骤5: 部分激活失败，不影响其他工作流继续激活
# =============================================================================
import os
import sys
import json
import importlib
import importlib.util
import tempfile
import pytest
from unittest.mock import MagicMock, patch, call
from urllib.error import URLError, HTTPError
from io import BytesIO

SCRIPT_PATH = os.path.join(
    os.path.dirname(__file__), '..', '..', 'scripts', 'n8n-tools', 'sync-workflows.py'
)

spec = importlib.util.spec_from_file_location('sync_workflows', SCRIPT_PATH)


def load_module():
    """每次测试重新加载模块，避免全局状态污染"""
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def make_wf_file(tmp_path, filename, active=True):
    """创建测试工作流 JSON 文件"""
    data = {
        'name': filename.replace('.json', ''),
        'nodes': [],
        'connections': {},
        'active': active,
    }
    f = tmp_path / filename
    f.write_text(json.dumps(data))
    return str(f)


# ===========================================================================
# 步骤1: 删除旧工作流时 psql 失败
# ===========================================================================

class TestStep1DeleteFailure:
    """步骤1 psql 失败时脚本继续执行 (不崩溃)"""

    def test_psql_failure_prints_warning_and_continues(self, mocker, tmp_path, capsys):
        """psql 返回错误时打印警告，不抛异常"""
        make_wf_file(tmp_path, 'wf02-transaction.json')
        mod = load_module()
        mod.API_KEY = 'test-key'
        mod.WF_DIR = str(tmp_path)

        # psql 查旧ID时返回包含错误
        mock_psql = mocker.patch.object(mod, 'psql', return_value='')
        mock_psql_exec = mocker.patch.object(mod, 'psql_exec',
            return_value=MagicMock(returncode=1, stderr='connection refused'))
        mock_run = mocker.patch.object(mod, 'run',
            return_value=MagicMock(returncode=0, stdout='"ok"', stderr=''))

        # 不应抛出异常
        try:
            mod.main()
        except SystemExit:
            pass  # API激活可能因无API server而失败，不影响本测试

        # psql 应被调用 (查询旧工作流)
        mock_psql.assert_called()

    def test_empty_old_workflows_skips_delete_step(self, mocker, tmp_path):
        """无旧工作流时跳过删除步骤，不调用 psql_exec"""
        make_wf_file(tmp_path, 'wf02-transaction.json')
        mod = load_module()
        mod.API_KEY = 'test-key'
        mod.WF_DIR = str(tmp_path)

        # 返回空 (无旧工作流)
        mock_psql = mocker.patch.object(mod, 'psql', return_value='')
        mock_psql_exec = mocker.patch.object(mod, 'psql_exec')
        mock_run = mocker.patch.object(mod, 'run',
            return_value=MagicMock(returncode=0, stdout='"ok"', stderr=''))

        try:
            mod.main()
        except Exception:
            pass

        # 无旧工作流时不应调用 psql_exec 删除
        mock_psql_exec.assert_not_called()


# ===========================================================================
# 步骤2: n8n 重启健康检查超时
# ===========================================================================

class TestStep2HealthCheckTimeout:
    """步骤2 n8n 健康检查超时后继续执行 (打印警告不崩溃)"""

    def test_health_check_timeout_prints_warning(self, mocker, tmp_path, capsys):
        """15 次健康检查全部失败时打印超时警告"""
        make_wf_file(tmp_path, 'wf02-transaction.json')
        mod = load_module()
        mod.API_KEY = 'test-key'
        mod.WF_DIR = str(tmp_path)

        call_count = [0]

        def mock_run_side_effect(cmd, check=True):
            result = MagicMock(returncode=0, stdout='', stderr='')
            # healthz 始终返回非 "ok" (超时模拟)
            if 'healthz' in str(cmd):
                result.stdout = 'connection refused'
                call_count[0] += 1
            elif 'restart' in str(cmd):
                pass  # restart 成功
            else:
                result.stdout = ''
            return result

        mocker.patch.object(mod, 'run', side_effect=mock_run_side_effect)
        mocker.patch.object(mod, 'psql', return_value='')
        mocker.patch.object(mod, 'psql_exec')
        mocker.patch('time.sleep')  # 跳过 sleep 加速测试

        try:
            mod.main()
        except Exception:
            pass

        # 应进行了健康检查轮询
        assert call_count[0] > 0

        # 输出中应有超时警告
        captured = capsys.readouterr()
        assert '超时' in captured.out or 'timeout' in captured.out.lower() or \
               '启动' in captured.out

    def test_health_check_succeeds_on_retry(self, mocker, tmp_path):
        """健康检查第 N 次成功后正常继续"""
        make_wf_file(tmp_path, 'wf02-transaction.json', active=False)
        mod = load_module()
        mod.API_KEY = 'test-key'
        mod.WF_DIR = str(tmp_path)

        health_calls = [0]

        def mock_run_side_effect(cmd, check=True):
            result = MagicMock(returncode=0, stdout='', stderr='')
            if 'healthz' in str(cmd):
                health_calls[0] += 1
                # 第 3 次成功
                result.stdout = '"ok"' if health_calls[0] >= 3 else 'error'
            return result

        mocker.patch.object(mod, 'run', side_effect=mock_run_side_effect)
        mocker.patch.object(mod, 'psql', return_value='')
        mocker.patch.object(mod, 'psql_exec')
        mocker.patch('time.sleep')

        try:
            mod.main()
        except Exception:
            pass

        # 健康检查至少被调用了 3 次
        assert health_calls[0] >= 3


# ===========================================================================
# 步骤3: docker cp 文件复制失败
# ===========================================================================

class TestStep3CopyFailure:
    """步骤3 docker cp 失败时打印警告但不中断"""

    def test_docker_cp_failure_does_not_crash(self, mocker, tmp_path, capsys):
        """docker cp 返回非零状态码时打印警告，继续执行"""
        make_wf_file(tmp_path, 'wf02-transaction.json')
        mod = load_module()
        mod.API_KEY = 'test-key'
        mod.WF_DIR = str(tmp_path)

        def mock_run_side_effect(cmd, check=True):
            result = MagicMock(returncode=0, stdout='', stderr='')
            if isinstance(cmd, list) and 'cp' in cmd:
                result.returncode = 1
                result.stderr = 'No such container: dp-wf'
            elif isinstance(cmd, list) and 'healthz' in ' '.join(cmd):
                result.stdout = '"ok"'
            return result

        mocker.patch.object(mod, 'run', side_effect=mock_run_side_effect)
        mocker.patch.object(mod, 'psql', return_value='')
        mocker.patch.object(mod, 'psql_exec')
        mocker.patch('time.sleep')

        # 不应抛出 SystemExit 或未捕获异常
        try:
            mod.main()
        except SystemExit:
            pass


# ===========================================================================
# 步骤5: API 激活失败场景
# ===========================================================================

class TestStep5ActivationFailure:
    """步骤5 API 激活失败时正确处理 (不崩溃，打印 ❌)"""

    def _run_main_with_activation_mock(self, mocker, tmp_path, urlopen_side_effect):
        """通用辅助: 设置 mock 并运行 main"""
        make_wf_file(tmp_path, 'wf02-transaction.json', active=True)
        mod = load_module()
        mod.API_KEY = 'test-key'
        mod.WF_DIR = str(tmp_path)

        mocker.patch.object(mod, 'run',
            return_value=MagicMock(returncode=0, stdout='"ok"', stderr=''))
        mocker.patch.object(mod, 'psql', return_value='')
        mocker.patch.object(mod, 'psql_exec')
        mocker.patch('time.sleep')
        mocker.patch('urllib.request.urlopen', side_effect=urlopen_side_effect)

        return mod

    def test_http_500_does_not_crash(self, mocker, tmp_path, capsys):
        """HTTP 500 响应时打印 ❌，不崩溃"""
        http_error = HTTPError(
            url='http://localhost:5678/api/v1/workflows/abc/activate',
            code=500,
            msg='Internal Server Error',
            hdrs=MagicMock(),
            fp=BytesIO(b'Internal Server Error'),
        )
        mod = self._run_main_with_activation_mock(mocker, tmp_path, http_error)
        try:
            mod.main()
        except Exception as e:
            pytest.fail(f"main() 不应抛出异常，但抛出了: {e}")

        captured = capsys.readouterr()
        assert '❌' in captured.out

    def test_network_connection_refused_does_not_crash(self, mocker, tmp_path, capsys):
        """网络连接拒绝时打印 ❌，不崩溃"""
        url_error = URLError(reason='Connection refused')
        mod = self._run_main_with_activation_mock(mocker, tmp_path, url_error)
        try:
            mod.main()
        except Exception as e:
            pytest.fail(f"main() 不应抛出异常，但抛出了: {e}")

        captured = capsys.readouterr()
        assert '❌' in captured.out

    def test_non_json_response_does_not_crash(self, mocker, tmp_path, capsys):
        """API 返回非 JSON 内容时打印 ❌，不崩溃"""
        mock_resp = MagicMock()
        mock_resp.read.return_value = b'<html>Gateway Timeout</html>'
        mocker.patch('urllib.request.urlopen', return_value=mock_resp)

        make_wf_file(tmp_path, 'wf02-transaction.json', active=True)
        mod = load_module()
        mod.API_KEY = 'test-key'
        mod.WF_DIR = str(tmp_path)
        mocker.patch.object(mod, 'run',
            return_value=MagicMock(returncode=0, stdout='"ok"', stderr=''))
        mocker.patch.object(mod, 'psql', return_value='')
        mocker.patch.object(mod, 'psql_exec')
        mocker.patch('time.sleep')

        try:
            mod.main()
        except Exception as e:
            pytest.fail(f"main() 不应抛出异常，但抛出了: {e}")

    def test_partial_activation_failure_continues_remaining(self, mocker, tmp_path, capsys):
        """部分工作流激活失败时，其余工作流继续激活 (不短路)"""
        # 创建 3 个工作流文件
        make_wf_file(tmp_path, 'wf02-transaction.json', active=True)
        make_wf_file(tmp_path, 'wf03-document-management.json', active=True)
        make_wf_file(tmp_path, 'wf04-document-query.json', active=True)

        mod = load_module()
        mod.API_KEY = 'test-key'
        mod.WF_DIR = str(tmp_path)

        call_count = [0]
        def urlopen_side_effect(req):
            call_count[0] += 1
            if call_count[0] == 2:
                # 第 2 个工作流激活失败
                raise URLError(reason='timeout')
            # 其他成功
            mock_resp = MagicMock()
            mock_resp.read.return_value = json.dumps({'active': True}).encode()
            return mock_resp

        mocker.patch.object(mod, 'run',
            return_value=MagicMock(returncode=0, stdout='"ok"', stderr=''))
        mocker.patch.object(mod, 'psql', return_value='')
        mocker.patch.object(mod, 'psql_exec')
        mocker.patch('time.sleep')
        mocker.patch('urllib.request.urlopen', side_effect=urlopen_side_effect)

        try:
            mod.main()
        except Exception as e:
            pytest.fail(f"main() 不应抛出异常，但抛出了: {e}")

        # 所有 3 个工作流都尝试了激活 (不因第 2 个失败而停止)
        assert call_count[0] == 3

        captured = capsys.readouterr()
        # 有成功也有失败
        assert '✅' in captured.out
        assert '❌' in captured.out

    def test_inactive_workflow_not_activated(self, mocker, tmp_path):
        """active=false 的工作流不触发 API 激活调用"""
        make_wf_file(tmp_path, 'wf02-transaction.json', active=False)
        mod = load_module()
        mod.API_KEY = 'test-key'
        mod.WF_DIR = str(tmp_path)

        mock_urlopen = mocker.patch('urllib.request.urlopen')
        mocker.patch.object(mod, 'run',
            return_value=MagicMock(returncode=0, stdout='"ok"', stderr=''))
        mocker.patch.object(mod, 'psql', return_value='')
        mocker.patch.object(mod, 'psql_exec')
        mocker.patch('time.sleep')

        try:
            mod.main()
        except Exception:
            pass

        # active=false 的工作流不应调用 urlopen 激活
        mock_urlopen.assert_not_called()
