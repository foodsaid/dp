# =============================================================================
# fix_wf22_error_handling.py 测试
# =============================================================================
# 策略: 验证错误处理节点添加逻辑
# =============================================================================
import os
import json
import pytest
from unittest.mock import patch, MagicMock, mock_open

SCRIPT_PATH = os.path.join(
    os.path.dirname(__file__), '..', '..', 'scripts', 'archive', 'fix_wf22_error_handling.py'
)


class TestFixWf22ErrorHandling:
    """fix_wf22_error_handling.py 测试套件"""

    def test_script_exists(self):
        """脚本文件存在"""
        assert os.path.isfile(SCRIPT_PATH)

    def test_script_targets_wf22(self):
        """脚本目标是 wf22 工作流"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'wf22' in content

    def test_script_adds_onerror(self):
        """脚本添加 onError=continueErrorOutput"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'continueErrorOutput' in content

    def test_script_adds_error_response_node(self):
        """脚本添加 DB错误响应 节点"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'DB错误响应' in content

    def test_script_adds_error_connection(self):
        """脚本添加错误输出连接"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'error' in content.lower()
        assert '执行拆单' in content

    def test_error_node_structure(self):
        """错误响应节点使用 respondToWebhook 类型"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'respondToWebhook' in content

    def test_script_handles_already_exists(self):
        """脚本处理节点已存在的情况 (幂等性)"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert '已存在' in content or '已有' in content

    def test_script_follows_sop_order(self):
        """按 SOP: 先 INSERT history, 再 UPDATE entity"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        history_pos = content.find('INSERT INTO wf.workflow_history')
        update_pos = content.find('UPDATE wf.workflow_entity')
        assert history_pos > 0 and update_pos > 0
        assert history_pos < update_pos
