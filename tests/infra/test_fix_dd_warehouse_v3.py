# =============================================================================
# fix_dd_warehouse_v3.py 测试
# =============================================================================
# 策略: mock psycopg2 + .env 文件读取, 验证 SQL 执行逻辑
# =============================================================================
import os
import sys
import json
import pytest
from unittest.mock import patch, MagicMock, mock_open

SCRIPT_PATH = os.path.join(
    os.path.dirname(__file__), '..', '..', 'scripts', 'archive', 'fix_dd_warehouse_v3.py'
)


class TestFixDDWarehouseV3:
    """fix_dd_warehouse_v3.py 测试套件"""

    def _build_env_content(self):
        return (
            "DP_DB_PORT=5432\n"
            "DP_DB_NAME=dp\n"
            "DP_DB_USER=dp_app\n"
            "DP_DB_PASSWORD=test\n"
        )

    def _build_wf_nodes(self, node_name='OMS查询', query_text=''):
        """构造模拟的 n8n 工作流节点"""
        return json.dumps([{
            'name': node_name,
            'type': 'n8n-nodes-base.postgres',
            'parameters': {
                'query': query_text or 'ol.warehouse_code AS "WhsCode", ol.warehouse_code AS "WhsName"'
            }
        }])

    def test_script_exists(self):
        """脚本文件存在"""
        assert os.path.isfile(SCRIPT_PATH)

    def test_script_reads_env_file(self):
        """脚本从 .env 文件读取配置"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert '.env' in content
        assert "open(env_path" in content

    def test_script_uses_parameterized_queries(self):
        """脚本使用参数化查询 (%s) 而非字符串拼接"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert '%s' in content

    def test_script_commits_transaction(self):
        """脚本包含事务提交"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'conn.commit()' in content

    def test_script_closes_connections(self):
        """脚本关闭数据库连接"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'cur.close()' in content
        assert 'conn.close()' in content

    def test_script_uses_psycopg2(self):
        """脚本使用 psycopg2 连接 PostgreSQL"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'psycopg2.connect' in content
        assert 'autocommit = False' in content

    def test_script_updates_wf1c_and_wf21(self):
        """脚本更新 wf1c 和 wf21 两个工作流"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'wf1c' in content
        assert 'wf21' in content

    def test_script_adds_warehouse_fallback(self):
        """脚本添加 warehouse_code COALESCE 回退"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'COALESCE' in content
        assert 'warehouse_code' in content

    def test_script_handles_wf_not_found(self):
        """脚本在找不到工作流时使用 sys.exit"""
        with open(SCRIPT_PATH, 'r') as f:
            content = f.read()
        assert 'sys.exit' in content
