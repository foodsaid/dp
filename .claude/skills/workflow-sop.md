# AI 与人类协同的 Git 规范与 TODO 管理 (IDD 工作流)

> **版本**: v1.0
> **创建日期**: 2026-02-28
> **依据来源**: Issue #19 / #20 / #21 实战复盘 (触发器修复 + 视图隔离 + Fetch Mock 测试)
> **核心理念**: Issue-Driven Development — 一切变更从 Issue 出发，一切提交到 Issue 闭合

---

## 一、分支与提交流程限制 (Branch & Commit SOP)

### 1.1 环境限制

当前 Git 代理 **禁止向非 `claude/` 开头的分支 Push** (返回 403 错误)。
这是安全策略，不可绕过。

### 1.2 分支策略

- **不要** 创建常规的 `fix/xxx`、`feat/xxx` 分支 (会被 403 拒绝)
- **直接** 在当前会话自动生成的 `claude/xxx` 分支上进行开发和 Push
- 每次处理新 Issue 时，从最新 `main` 创建干净的 `claude/xxx` 分支:

```bash
# 标准流程
git checkout main
git pull origin main
# 如果 claude/xxx 分支已存在，先删后建 (确保基于最新 main)
git branch -D claude/implement-todo-item-xxxxx 2>/dev/null
git checkout -b claude/implement-todo-item-xxxxx
```

### 1.3 提交规范 (极其重要)

在每次修复/开发完成进行 Commit 时:

1. **必须** 向人类确认对应的 GitHub Issue 编号
2. **禁止** 猜测或假设 Issue 编号
3. Commit Message **必须** 包含关联暗号，格式规范:

```
<type>: <description> (Fixes #<Issue_ID>)
```

类型枚举:
- `fix:` — Bug 修复
- `feat:` — 新功能
- `test:` — 测试
- `refactor:` — 重构
- `docs:` — 文档
- `chore:` — 构建/CI/工具

**正确示例**:
```
fix: enforce company_code isolation to prevent whitespace bypass (Fixes #19)
fix: add company_code isolation to v_stock_realtime view (Fixes #20)
test: add fetch mock unit tests for apiGet and apiPost (Fixes #21)
```

**错误示例**:
```
fix: 修复触发器问题           ← 缺少 Issue 编号
fix: various bugfixes         ← 大杂烩，违反 One Issue = One PR
fix: security fix (Fixes #19, Fixes #20)  ← 多 Issue 混合
```

### 1.4 Push 后的标准话术

Push 成功后，固定回复模板:

```
推送成功。

### 变更文件
- file1.sql — 描述
- file2.js — 描述

### PR 地址
https://github.com/foodsaid/dp/pull/new/claude/implement-todo-item-xxxxx

你可以去网页端创建 PR，合并后 GitHub 会自动关闭 Issue #XX。
```

---

## 二、发现技术债与 Bug 的处理原则 (TODO & Task Management)

### 2.1 铁律: One Issue = One Branch = One PR

- **禁止** 大杂烩修复 (一个 PR 修多个不相关问题)
- **禁止** 在修复 Issue A 时顺手修复 Issue B
- 每个 Issue 独立完成: 同步 main → 修改 → 测试 → Commit → Push

### 2.2 主动梳理任务

当 AI 在扫描代码或重构时发现潜在隐患时:

1. **绝对不要** 未经确认就直接修改
2. **必须** 主动向人类汇报，使用以下模板:

```
我在审查代码时发现了以下 X 个隐患:

1. [严重] xxx — 描述问题 + 影响范围
2. [中等] xxx — 描述问题 + 影响范围
3. [低] xxx — 描述问题 + 影响范围

请去 GitHub 为这些问题创建对应的 Issue，并告诉我 Issue 编号，
我们再逐个修复。
```

### 2.3 分类标准

| 严重度 | 定义 | 处理方式 |
|--------|------|---------|
| 严重 | 安全漏洞、数据泄漏、多租户隔离失败 | 立即立案，当前会话修复 |
| 中等 | 测试缺失、性能隐患、维护性问题 | 立案后排期修复 |
| 低 | 代码风格、命名规范、文档缺失 | 立案后积压池 |

### 2.4 单点执行流程

```
人类创建 Issue → 告知 AI Issue 编号 → AI 单点修复 → 测试通过
→ Commit (含 Fixes #XX) → Push → 人类创建 PR → 合并 → Issue 自动关闭
```

---

## 三、实战验证的完整 SOP (Issue #19/#20/#21 复盘)

### 3.1 Issue #19: fn_enforce_company_code 纯空格绕过

```
发现 → 立案 → 修复触发器 TRIM() + 6 表 CHECK 约束 → 4 个 SQL 测试
→ Commit: fix: enforce company_code isolation... (Fixes #19)
→ Push → PR → 合并
```

### 3.2 Issue #20: v_stock_realtime 视图缺失 company_code

```
发现 → 立案 → 修复 3 个隔离缺陷 (delta聚合 + JOIN条件 + 关联子查询)
→ 5 个多租户断言测试 + CI 配置更新
→ Commit: fix: add company_code isolation... (Fixes #20)
→ Push → PR → 合并
```

### 3.3 Issue #21: apiGet/apiPost 缺少 Fetch Mock 测试

```
发现 → 立案 → 15 个 Fetch Mock 用例 (成功/业务错误/网络异常/空响应/非JSON)
→ setup.js 增加 fetch 委托 → 全量 132 测试通过
→ Commit: test: add fetch mock unit tests... (Fixes #21)
→ Push → PR → 合并
```

---

## 四、禁止事项清单

| # | 禁止行为 | 原因 |
|---|---------|------|
| 1 | 未确认 Issue 编号就 Commit | 无法自动关闭 Issue，破坏追溯链 |
| 2 | 一个 PR 包含多个不相关修复 | Code Review 困难，回滚粒度过粗 |
| 3 | 发现隐患直接修改不汇报 | 绕过人类审批，违反协作原则 |
| 4 | Push 到非 claude/ 开头的分支 | 会被 Git 代理 403 拒绝 |
| 5 | 猜测 Issue 编号 (如 "应该是 #20") | 必须由人类明确告知 |
| 6 | Commit 后不运行测试就 Push | 可能推送破损代码到远端 |
| 7 | 在修 Issue A 时顺手改 Issue B 的代码 | 违反 One Issue = One PR 铁律 |

---

## 变更日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-02-28 | v1.0 | 初始创建: 基于 Issue #19/#20/#21 IDD 实战复盘 |
