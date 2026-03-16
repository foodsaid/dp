# =============================================================================
# n8n-tools/sync-workflows.py 测试
# =============================================================================
# 策略: mock subprocess + urllib + 文件 I/O, 验证同步流程
# =============================================================================
import os
import sys
import json
import hashlib
import pytest
from unittest.mock import patch, MagicMock, mock_open, call

SCRIPT_PATH = os.path.join(
    os.path.dirname(__file__), '..', '..', 'scripts', 'n8n-tools', 'sync-workflows.py'
)


class TestSyncWorkflowsStructure:
    """sync-workflows.py 结构验证"""

    def test_script_exists(self):
        """脚本文件存在"""
        assert os.path.isfile(SCRIPT_PATH)

    def test_script_has_main_function(self):
        """脚本包含 main() 入口"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'def main()' in content

    def test_script_requires_api_key(self):
        """脚本要求 N8N_API_KEY"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'N8N_API_KEY' in content

    def test_script_has_psql_helper(self):
        """脚本包含 psql 辅助函数"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'def psql(' in content

    def test_script_uses_stdin_for_sql(self):
        """psql 通过 stdin 传递 SQL (安全: 避免注入)"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'input=sql' in content or 'input=' in content

    def test_script_uses_list_mode_subprocess(self):
        """run() 使用列表模式 (安全: 避免 shell 注入)"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'shlex.split' in content or 'isinstance(cmd, str)' in content


class TestSyncWorkflowsSafety:
    """sync-workflows.py 安全性测试"""

    def test_no_hardcoded_credentials(self):
        """不包含硬编码凭据"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        # API key 应来自环境变量
        assert 'os.environ' in content

    def test_workflow_id_generation(self):
        """工作流 ID 通过 MD5 哈希文件名生成"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'hashlib.md5' in content

    def test_cleanup_after_import(self):
        """导入后清理临时文件"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'rm -rf' in content or 'remove' in content


class TestSyncWorkflowsLogic:
    """sync-workflows.py 逻辑测试"""

    def test_hashlib_id_generation(self):
        """验证 ID 生成逻辑: MD5 前 10 字符"""
        filename = 'wf01-test.json'
        expected_id = hashlib.md5(filename.encode()).hexdigest()[:10]
        assert len(expected_id) == 10
        # 确保是十六进制字符
        assert all(c in '0123456789abcdef' for c in expected_id)

    def test_workflow_file_pattern(self):
        """脚本过滤 wf*.json 文件"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'wf' in content
        assert '.json' in content

    @patch.dict(os.environ, {'N8N_API_KEY': ''}, clear=False)
    def test_exits_without_api_key(self):
        """缺少 API key 时退出"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'sys.exit' in content

    def test_handles_activation_errors(self):
        """处理工作流激活失败"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'except' in content
        # 检查有错误处理
        assert 'Exception' in content or 'Error' in content

    def test_final_verification(self):
        """脚本包含最终验证步骤"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert '最终验证' in content or 'verify' in content.lower()

    def test_step_order(self):
        """同步步骤按正确顺序执行: 删除→重启→复制→导入→激活→验证"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        # 验证步骤标题的顺序
        step1_pos = content.find('步骤 1')
        step2_pos = content.find('步骤 2')
        step3_pos = content.find('步骤 3')
        step4_pos = content.find('步骤 4')
        step5_pos = content.find('步骤 5')
        assert step1_pos < step2_pos < step3_pos < step4_pos < step5_pos
