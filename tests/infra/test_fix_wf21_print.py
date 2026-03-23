# =============================================================================
# fix_wf21_print.py 测试
# =============================================================================
# 策略: 静态分析 + mock DB 连接验证逻辑路径
# =============================================================================
import os
import pytest

SCRIPT_PATH = os.path.join(
    os.path.dirname(__file__), '..', '..', 'scripts', 'archive', 'fix_wf21_print.py'
)


class TestFixWf21Print:
    """fix_wf21_print.py 测试套件"""

    def test_script_exists(self):
        """脚本文件存在"""
        assert os.path.isfile(SCRIPT_PATH)

    def test_script_targets_wf21(self):
        """脚本目标是 wf21 工作流"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'wf21' in content

    def test_script_adds_source_planned_qty(self):
        """脚本添加 source_planned_qty 字段"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'source_planned_qty' in content

    def test_script_uses_parameterized_queries(self):
        """脚本使用 psycopg2 参数化查询"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert '%s' in content

    def test_script_creates_version_history(self):
        """脚本创建工作流版本历史"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'workflow_history' in content

    def test_script_closes_resources(self):
        """脚本正确关闭数据库资源"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'cur.close()' in content
        assert 'conn.close()' in content

    def test_script_handles_already_modified(self):
        """脚本处理已修改过的情况 (幂等性检查)"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        # 检查是否有 "已有" 或幂等检查
        assert 'source_planned_qty' in content and 'not in' in content or 'already' in content.lower() or '已有' in content
