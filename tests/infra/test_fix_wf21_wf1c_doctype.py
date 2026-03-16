# =============================================================================
# fix_wf21_wf1c_doctype.py 测试
# =============================================================================
# 策略: 验证 doc_type 过滤修复逻辑
# =============================================================================
import os
import json
import pytest
from unittest.mock import patch, MagicMock, mock_open

SCRIPT_PATH = os.path.join(
    os.path.dirname(__file__), '..', '..', 'scripts', 'archive', 'fix_wf21_wf1c_doctype.py'
)


class TestFixWf21Wf1cDoctype:
    """fix_wf21_wf1c_doctype.py 测试套件"""

    def test_script_exists(self):
        """脚本文件存在"""
        assert os.path.isfile(SCRIPT_PATH)

    def test_script_adds_doc_type_filter(self):
        """脚本添加 doc_type='SO' 过滤"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert "doc_type = 'SO'" in content or "doc_type='SO'" in content

    def test_script_fixes_both_workflows(self):
        """脚本同时修复 wf21 和 wf1c"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'wf21' in content
        assert 'wf1c' in content

    def test_script_syncs_active_version_id(self):
        """脚本同步 activeVersionId (教训 #25)"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'activeVersionId' in content

    def test_fix_workflow_function_exists(self):
        """脚本包含通用修复函数"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'def fix_workflow' in content

    def test_script_uses_parameterized_wf_query(self):
        """工作流查询使用参数化 (%s) 而非 f-string"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        # fix_workflow 中的查询应使用 %s
        assert "WHERE name LIKE %s" in content

    def test_fix_workflow_handles_no_change(self):
        """修复函数处理无变化的情况"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert '无变化' in content or 'no change' in content.lower() or '已修复' in content

    def test_script_inserts_history_before_update(self):
        """按 SOP: 先 INSERT history, 再 UPDATE entity"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        history_pos = content.find('INSERT INTO wf.workflow_history')
        update_pos = content.find('UPDATE wf.workflow_entity')
        # history INSERT 应在 entity UPDATE 之前
        assert history_pos < update_pos
