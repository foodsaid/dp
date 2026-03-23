# =============================================================================
# test_prometheus_rules.py — Prometheus 告警规则结构验证
# =============================================================================
# 策略: 用 PyYAML 解析规则文件，静态验证结构完整性
#       不依赖 promtool 命令 (CI 环境不一定有 Prometheus 安装)
#
# 覆盖:
#   1. 文件可解析为有效 YAML
#   2. 顶层 groups 字段存在且为非空列表
#   3. 每个 group 有 name 和 rules 字段
#   4. 每条 rule 有必填字段: alert, expr, labels.severity, annotations.summary
#   5. severity 值只能是 warning / critical (防止拼写错误)
#   6. expr 不含明显语法错误 (括号平衡)
#   7. for 字段格式正确 (Prometheus duration: 5m / 2h / 30s 等)
#   8. 告警名称唯一性 (同文件内不重复)
#   9. annotations.summary 非空且包含至少 1 个字符
#  10. 规则总数在合理范围内 (防止意外删除)
# =============================================================================
import os
import re
import yaml
import pytest

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RULES_FILE = os.path.join(PROJECT_ROOT, 'infrastructure', 'monitoring', 'prometheus', 'rules', 'dp-alerts.yml')
PROMETHEUS_YML = os.path.join(PROJECT_ROOT, 'infrastructure', 'monitoring', 'prometheus', 'prometheus.yml')

VALID_SEVERITIES = {'warning', 'critical', 'info'}
DURATION_PATTERN = re.compile(r'^\d+[smhdw]$')


def load_rules():
    with open(RULES_FILE, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)


def get_all_rules():
    """提取所有 rules 条目"""
    d = load_rules()
    rules = []
    for group in d.get('groups', []):
        for rule in group.get('rules', []):
            rules.append((group['name'], rule))
    return rules


# ===========================================================================
# 1. YAML 可解析性
# ===========================================================================

class TestYamlParseable:

    def test_rules_file_exists(self):
        """告警规则文件存在"""
        assert os.path.isfile(RULES_FILE), f"告警规则文件不存在: {RULES_FILE}"

    def test_rules_file_is_valid_yaml(self):
        """告警规则文件是合法 YAML"""
        d = load_rules()
        assert d is not None
        assert isinstance(d, dict)

    def test_prometheus_config_exists(self):
        """Prometheus 配置文件存在"""
        assert os.path.isfile(PROMETHEUS_YML)

    def test_prometheus_config_is_valid_yaml(self):
        """Prometheus 配置文件是合法 YAML"""
        with open(PROMETHEUS_YML, 'r', encoding='utf-8') as f:
            d = yaml.safe_load(f)
        assert d is not None
        assert isinstance(d, dict)


# ===========================================================================
# 2. 顶层结构
# ===========================================================================

class TestTopLevelStructure:

    def test_has_groups_field(self):
        """顶层 groups 字段存在"""
        d = load_rules()
        assert 'groups' in d, "告警规则文件缺少 groups 字段"

    def test_groups_is_non_empty_list(self):
        """groups 是非空列表"""
        d = load_rules()
        groups = d['groups']
        assert isinstance(groups, list), "groups 应为列表"
        assert len(groups) > 0, "groups 不能为空"

    def test_each_group_has_name(self):
        """每个 group 有 name 字段"""
        d = load_rules()
        for group in d['groups']:
            assert 'name' in group, f"group 缺少 name 字段: {group}"
            assert isinstance(group['name'], str), "group name 应为字符串"
            assert len(group['name'].strip()) > 0, "group name 不能为空"

    def test_each_group_has_rules(self):
        """每个 group 有 rules 字段"""
        d = load_rules()
        for group in d['groups']:
            assert 'rules' in group, f"group '{group.get('name')}' 缺少 rules 字段"
            assert isinstance(group['rules'], list), f"group '{group.get('name')}' rules 应为列表"


# ===========================================================================
# 3. 每条规则的必填字段
# ===========================================================================

class TestRuleRequiredFields:

    def test_each_rule_has_alert_name(self):
        """每条规则有 alert 名称"""
        for group_name, rule in get_all_rules():
            assert 'alert' in rule, \
                f"group '{group_name}' 中有规则缺少 alert 字段: {rule}"
            assert isinstance(rule['alert'], str), \
                f"group '{group_name}' alert 应为字符串"
            assert len(rule['alert'].strip()) > 0, \
                f"group '{group_name}' alert 名称不能为空"

    def test_each_rule_has_expr(self):
        """每条规则有 expr 表达式"""
        for group_name, rule in get_all_rules():
            assert 'expr' in rule, \
                f"group '{group_name}' 规则 '{rule.get('alert')}' 缺少 expr 字段"
            assert rule['expr'] is not None, \
                f"group '{group_name}' 规则 '{rule.get('alert')}' expr 不能为 null"
            expr_str = str(rule['expr']).strip()
            assert len(expr_str) > 0, \
                f"group '{group_name}' 规则 '{rule.get('alert')}' expr 不能为空"

    def test_each_rule_has_labels_severity(self):
        """每条规则有 labels.severity"""
        for group_name, rule in get_all_rules():
            labels = rule.get('labels', {}) or {}
            assert 'severity' in labels, \
                f"group '{group_name}' 规则 '{rule.get('alert')}' 缺少 labels.severity"

    def test_each_rule_has_annotations_summary(self):
        """每条规则有 annotations.summary"""
        for group_name, rule in get_all_rules():
            annotations = rule.get('annotations', {}) or {}
            assert 'summary' in annotations, \
                f"group '{group_name}' 规则 '{rule.get('alert')}' 缺少 annotations.summary"
            summary = str(annotations['summary']).strip()
            assert len(summary) > 0, \
                f"group '{group_name}' 规则 '{rule.get('alert')}' annotations.summary 不能为空"


# ===========================================================================
# 4. severity 值范围校验
# ===========================================================================

class TestSeverityValues:

    def test_all_severities_are_valid(self):
        """severity 只允许 warning / critical / info"""
        for group_name, rule in get_all_rules():
            labels = rule.get('labels', {}) or {}
            severity = labels.get('severity', '')
            assert severity in VALID_SEVERITIES, \
                f"group '{group_name}' 规则 '{rule.get('alert')}' " \
                f"severity='{severity}' 不在允许范围 {VALID_SEVERITIES}"

    def test_critical_alerts_exist(self):
        """至少有一条 critical 级别告警"""
        critical_rules = [
            rule for _, rule in get_all_rules()
            if (rule.get('labels') or {}).get('severity') == 'critical'
        ]
        assert len(critical_rules) > 0, "应至少有一条 critical 级别告警"


# ===========================================================================
# 5. expr 括号平衡校验
# ===========================================================================

class TestExprSyntax:

    def test_expr_parentheses_balanced(self):
        """expr 表达式括号平衡"""
        for group_name, rule in get_all_rules():
            expr = str(rule.get('expr', ''))
            open_count = expr.count('(')
            close_count = expr.count(')')
            assert open_count == close_count, \
                f"group '{group_name}' 规则 '{rule.get('alert')}' " \
                f"expr 括号不平衡: 开括号 {open_count}, 闭括号 {close_count}\nexpr: {expr}"

    def test_expr_not_empty_after_strip(self):
        """expr 去除空白后非空"""
        for group_name, rule in get_all_rules():
            expr = str(rule.get('expr', '')).strip()
            assert len(expr) > 0, \
                f"group '{group_name}' 规则 '{rule.get('alert')}' expr 为空"


# ===========================================================================
# 6. for 字段格式校验
# ===========================================================================

class TestForFieldFormat:

    def test_for_field_format_when_present(self):
        """for 字段格式符合 Prometheus duration (数字+单位)"""
        for group_name, rule in get_all_rules():
            if 'for' not in rule:
                continue
            for_val = str(rule['for'])
            assert DURATION_PATTERN.match(for_val), \
                f"group '{group_name}' 规则 '{rule.get('alert')}' " \
                f"for='{for_val}' 格式不正确，应为 5m / 2h / 30s 格式"


# ===========================================================================
# 7. 告警名称唯一性
# ===========================================================================

class TestAlertNameUniqueness:

    def test_alert_names_are_unique_within_file(self):
        """同一规则文件内告警名称不重复"""
        all_names = [rule.get('alert') for _, rule in get_all_rules()]
        seen = set()
        duplicates = []
        for name in all_names:
            if name in seen:
                duplicates.append(name)
            seen.add(name)
        assert len(duplicates) == 0, \
            f"发现重复的告警名称: {duplicates}"


# ===========================================================================
# 8. 规则数量下限 (防止意外删除)
# ===========================================================================

class TestRuleCount:

    def test_minimum_rule_count(self):
        """规则数量不低于 15 条 (防止告警规则被意外清空)"""
        all_rules = get_all_rules()
        assert len(all_rules) >= 15, \
            f"告警规则数量 {len(all_rules)} 低于最低期望 15 条，请确认是否意外删除"

    def test_group_count_matches_expected(self):
        """规则组数量不低于 5 个 (当前共 10 个组)"""
        d = load_rules()
        group_count = len(d.get('groups', []))
        assert group_count >= 5, \
            f"规则组数量 {group_count} 低于期望，请确认是否意外删除"
