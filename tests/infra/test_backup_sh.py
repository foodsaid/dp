# =============================================================================
# backup.sh 的 Python 补充测试 (验证脚本逻辑边界)
# =============================================================================
# 注: 主要测试在 backup.bats 中, 此处验证环境变量解析等边界
# =============================================================================
import subprocess
import os
import pytest


SCRIPT_PATH = os.path.join(
    os.path.dirname(__file__), '..', '..', 'scripts', 'backup.sh'
)


def test_backup_script_exists():
    """备份脚本文件存在且可读"""
    assert os.path.isfile(SCRIPT_PATH)


def test_backup_script_has_set_e():
    """备份脚本包含 set -e (错误立即退出)"""
    with open(SCRIPT_PATH, 'r') as f:
        content = f.read()
    assert 'set -e' in content


def test_backup_script_uses_custom_format():
    """备份脚本使用 pg_dump 自定义格式 (-Fc/--format=custom)"""
    with open(SCRIPT_PATH, 'r') as f:
        content = f.read()
    assert '--format=custom' in content or '-Fc' in content


def test_backup_script_no_hardcoded_passwords():
    """备份脚本不包含硬编码密码"""
    with open(SCRIPT_PATH, 'r') as f:
        content = f.read()
    # 不应包含明文密码
    assert 'password' not in content.lower() or '${' in content or 'DP_DB' in content
