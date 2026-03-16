# 发布版本一致性检查 SOP (严格版)

> **严格执行，零容忍偏差。**
> 本 SOP 源自 v0.1.17→v0.3.0 实战中 **反复出现的统计错误和版本遗漏**。
> 每一条规则背后都有至少一次实际事故。

---

## 核心原则

1. **数字不靠记忆，靠命令** — 所有统计数据必须跑命令得出，禁止从文档复制粘贴
2. **不信任旧数据** — 每次发版时重新计数，不要假设上次的数字还对
3. **一处改，全量搜** — 任何数字变更后，`grep -rn` 搜全仓库所有出现位置
4. **先验证后提交** — 提交前必须跑完整验证脚本，PASS 才能 commit
5. **先写文档再 push** — 统计数据在提交前就更新好，和代码同一个 commit (假设成功，CI 失败只改代码不改文档)

---

## 触发条件

- 准备发布新版本 (VERSION 文件变更)
- 全面审查/同步文档
- CLAUDE.md 目录树变更
- 新增/删除测试文件、工作流、lib 模块、skills 后

---

## 一、版本号一致性 (10 个位置)

> v0.3.0 教训: 原 SOP 只列 7 个位置，遗漏了 landing 页、UAT 指南、package.json，
> 导致 landing 路线图落后 3 个版本 (v0.1.16 标 Current，实际已 v0.3.0)。

| # | 文件 | 位置 | 验证命令 |
|---|------|------|---------|
| 1 | `VERSION` | 文件内容 | `cat VERSION` |
| 2 | `package.json` | `"version"` 字段 | `grep '"version"' package.json` |
| 3 | `CLAUDE.md` | header 第 3 行 | `head -3 CLAUDE.md` |
| 4 | `CLAUDE.md` | 目录树 VERSION 注释 | `grep '语义化版本号' CLAUDE.md` |
| 5 | `PLAN.md` | header `当前版本` | `head -5 PLAN.md` |
| 6 | `README.md` | mermaid 图 `DP v{X}` | `grep 'DP v' README.md` |
| 7 | `docs/DEPLOY-GUIDE.md` | header + footer (2 处) | `grep -n 'v0\.' docs/DEPLOY-GUIDE.md \| head -3` |
| 8 | `apps/wf/README.md` | header | `head -3 apps/wf/README.md` |
| 9 | `docs/WMS-UAT-Guide.md` | `系统版本` | `grep '系统版本' docs/WMS-UAT-Guide.md` |
| 10 | `infrastructure/nginx/landing/index.html` | 路线图 `Current` 标签 | `grep 'Current\|tm-tag done\|tm-tag next' infrastructure/nginx/landing/index.html` |

### 自动验证脚本 (必跑)

```bash
V=$(cat VERSION)
echo "=== 期望版本: $V ==="
FAIL=0

# 1. VERSION
[[ "$(cat VERSION)" == "$V" ]] && echo "✅ VERSION" || { echo "❌ VERSION"; FAIL=1; }

# 2. package.json
grep -q "\"version\": \"$V\"" package.json && echo "✅ package.json" || { echo "❌ package.json"; FAIL=1; }

# 3. CLAUDE.md header
head -3 CLAUDE.md | grep -q "v$V" && echo "✅ CLAUDE.md header" || { echo "❌ CLAUDE.md header"; FAIL=1; }

# 4. CLAUDE.md 目录树
grep '语义化版本号' CLAUDE.md | grep -q "$V" && echo "✅ CLAUDE.md 目录树" || { echo "❌ CLAUDE.md 目录树"; FAIL=1; }

# 5. PLAN.md
head -5 PLAN.md | grep -q "v$V" && echo "✅ PLAN.md" || { echo "❌ PLAN.md"; FAIL=1; }

# 6. README.md
grep -q "DP v$V" README.md && echo "✅ README.md" || { echo "❌ README.md"; FAIL=1; }

# 7. DEPLOY-GUIDE header + footer
DG_COUNT=$(grep -c "v$V" docs/DEPLOY-GUIDE.md)
[[ $DG_COUNT -ge 2 ]] && echo "✅ DEPLOY-GUIDE ($DG_COUNT 处)" || { echo "❌ DEPLOY-GUIDE (仅 $DG_COUNT 处, 需≥2)"; FAIL=1; }

# 8. apps/wf/README.md
head -3 apps/wf/README.md | grep -q "v$V" && echo "✅ wf/README.md" || { echo "❌ wf/README.md"; FAIL=1; }

# 9. WMS-UAT-Guide.md
grep -q "v$V" docs/WMS-UAT-Guide.md && echo "✅ WMS-UAT-Guide.md" || { echo "❌ WMS-UAT-Guide.md"; FAIL=1; }

# 10. landing/index.html 路线图
grep 'tm-tag done' infrastructure/nginx/landing/index.html | grep -q "v${V%.*}" && echo "✅ landing 路线图" || { echo "⚠️ landing 路线图 (检查 Current 标签)"; }

echo ""
[[ $FAIL -eq 0 ]] && echo "🟢 版本号全部对齐" || echo "🔴 存在版本号不一致，请修复后再提交"
```

---

## 二、统计数据硬验证 (跑命令，不信文档)

> **这是最容易出错的部分。** 历史上统计数字错误率超过 50%。
> 原因: 文档里写死数字，代码变了文档没跟。
> 解法: 每次发版时跑以下命令，用实际值覆盖文档值。

### 自动计数脚本 (必跑)

```bash
echo "========== 统计数据硬验证 =========="

# --- 测试文件计数 ---
WMS_UNIT=$(ls tests/unit/wms/*.test.js 2>/dev/null | wc -l)
WF_UNIT=$(ls tests/unit/wf/*.test.js 2>/dev/null | wc -l)
JEST_FILES=$((WMS_UNIT + WF_UNIT))
E2E_FILES=$(ls tests/e2e/*.spec.js 2>/dev/null | wc -l)
BATS_FILES=$(ls tests/infra/*.bats 2>/dev/null | wc -l)
PYTEST_FILES=$(ls tests/infra/test_*.py 2>/dev/null | wc -l)

echo "Jest 测试文件: $JEST_FILES (WMS: $WMS_UNIT + WF: $WF_UNIT)"
echo "E2E 文件: $E2E_FILES"
echo "BATS 文件: $BATS_FILES"
echo "pytest 文件: $PYTEST_FILES"

# --- 测试用例计数 ---
# Jest: 必须跑 npm test 才能得到真实数字，不要猜
echo ""
echo "⚠️ Jest 用例数必须从 npm test 输出中读取 (grep 'Tests:' + 'Test Suites:')"
echo "⚠️ 不要从文档复制旧数字！"

# BATS 用例
BATS_TOTAL=0
for f in tests/infra/*.bats; do
  C=$(grep -c '@test' "$f")
  BATS_TOTAL=$((BATS_TOTAL + C))
  echo "  BATS: $C  $(basename "$f")"
done
echo "BATS 用例总计: $BATS_TOTAL"

# pytest 用例
PYTEST_TOTAL=0
for f in tests/infra/test_*.py; do
  C=$(grep -c 'def test_' "$f")
  PYTEST_TOTAL=$((PYTEST_TOTAL + C))
  echo "  pytest: $C  $(basename "$f")"
done
echo "pytest 用例总计: $PYTEST_TOTAL"

# E2E 场景 (用 test( 和 it( 两种模式)
E2E_TOTAL=0
for f in tests/e2e/*.spec.js; do
  C=$(grep -c -E "^\s*(test|it)\(" "$f")
  E2E_TOTAL=$((E2E_TOTAL + C))
  echo "  E2E: $C  $(basename "$f")"
done
echo "E2E 场景总计: $E2E_TOTAL"

# SQL 断言块
SQL_TOTAL=0
for f in tests/sql/*.sql; do
  C=$(grep -c 'RAISE NOTICE.*PASS' "$f")
  SQL_TOTAL=$((SQL_TOTAL + C))
  echo "  SQL: $C  $(basename "$f")"
done
echo "SQL 断言块总计: $SQL_TOTAL"

# --- 代码资产计数 ---
echo ""
WF_JSON=$(ls apps/wf/*.json 2>/dev/null | wc -l)
WF_LIB=$(ls apps/wf/lib/*.js 2>/dev/null | wc -l)
SKILLS=$(ls .claude/skills/*.md 2>/dev/null | wc -l)
ADR=$(ls docs/ADR/*.md 2>/dev/null | wc -l)
SHARED_LINES=$(wc -l < apps/wms/shared.js)
CAMERA_LINES=$(wc -l < apps/wms/camera-fallback.js)
LANG_LINES=$(wc -l < apps/wms/lang.js)

echo "n8n 工作流 JSON: $WF_JSON"
echo "n8n 纯函数库: $WF_LIB 模块"
echo "Skills: $SKILLS"
echo "ADR: $ADR"
echo "shared.js: ~${SHARED_LINES} 行"
echo "camera-fallback.js: ~${CAMERA_LINES} 行"
echo "lang.js: ~${LANG_LINES} 行"
```

### 数字出现位置速查表

> 修改任一数字后，必须 `grep -rn` 搜索全仓库所有引用并同步更新。

| 数据项 | 出现文件 | grep 搜索模式 |
|--------|---------|--------------|
| Jest 用例总数 | CLAUDE.md, PLAN.md, ADR-006, README.md | `grep -rn 'XXXX 用例\|XXXX tests\|XXXX passed' --include='*.md' .` |
| Jest 文件总数 | CLAUDE.md (2处: 注释 + 命令行), PLAN.md | `grep -rn 'XX 文件.*Jest\|Jest.*XX 文件' --include='*.md' .` |
| WMS 单测文件数 | CLAUDE.md 目录树注释 | `grep -n 'WMS.*单元测试.*文件' CLAUDE.md` |
| E2E 场景数 | CLAUDE.md (3处), PLAN.md, ADR-006 | `grep -rn 'XXX 场景' --include='*.md' .` |
| BATS 用例数 | CLAUDE.md CI 描述 | `grep -n 'BATS.*用例' CLAUDE.md` |
| pytest 用例数 | CLAUDE.md CI 描述 | `grep -n 'pytest.*用例' CLAUDE.md` |
| n8n 工作流数 | CLAUDE.md, PLAN.md, DEPLOY-GUIDE, wf/README | `grep -rn '23 个\|23 workflows\|23 JSON' --include='*.md' .` |
| n8n 纯函数库数 | CLAUDE.md 目录树 | `grep -n '纯函数库.*模块' CLAUDE.md` |
| shared.js 行数 | CLAUDE.md 目录树 | `grep -n 'shared.js.*行' CLAUDE.md` |
| Skills 文件数 | CLAUDE.md 目录树 | `grep -n 'AI 技能库.*个' CLAUDE.md` |
| 容器总数 | CLAUDE.md, PLAN.md, README.md | `grep -rn '核心.*可选.*监控\|容器清单' --include='*.md' .` |
| CI Jobs 数 | CLAUDE.md | `grep -n 'CI.*Jobs\|12 Jobs' CLAUDE.md` |

---

## 三、目录树准确性 (CLAUDE.md)

每次新增/删除/重命名文件后必须同步。

### 验证方法

```bash
# 实际文件 vs CLAUDE.md 列出的文件
echo "=== 目录树验证 ==="

# 重点检查经常变动的目录
echo "--- apps/wf/lib/ ---"
echo "CLAUDE.md 列出:"; grep -c 'wf.*\.js' CLAUDE.md | head -1
echo "实际文件:"; ls apps/wf/lib/*.js | wc -l
diff <(grep -oP 'wf[\w-]+\.js' CLAUDE.md | sort -u) <(ls apps/wf/lib/*.js | xargs -n1 basename | sort) || echo "⚠️ 有差异"

echo "--- tests/unit/wf/ ---"
diff <(grep -oP 'wf[\w-]+\.test\.js' CLAUDE.md | sort -u) <(ls tests/unit/wf/*.test.js | xargs -n1 basename | sort) || echo "⚠️ 有差异"

echo "--- tests/e2e/ ---"
diff <(grep -oP '[\w-]+\.spec\.js' CLAUDE.md | sort -u) <(ls tests/e2e/*.spec.js | xargs -n1 basename | sort) || echo "⚠️ 有差异"

echo "--- .claude/skills/ ---"
diff <(grep -oP '[\w-]+\.md' CLAUDE.md | grep -v 'CLAUDE\|README\|PLAN\|DEPLOY\|UAT\|SECURITY\|LICENSE\|VERSION\|ADR' | sort -u) <(ls .claude/skills/*.md | xargs -n1 basename | sort) 2>/dev/null || echo "⚠️ 有差异"
```

### 常见漏洞
- vendor/ 下文件增删后未同步 (如 pinia 删除)
- apps/wf/lib/ 新增模块未列出 (如 wf-sync-helpers.js)
- tests/ 新增文件未列出
- 文件描述中的行数/函数数过时
- docs/ 新增子目录未列出

---

## 四、敏感信息扫描 (每次提交前)

```bash
echo "=== 敏感信息扫描 ==="

# 个人路径 (排除 .local.md 和 node_modules)
echo "--- 个人路径 ---"
grep -rn '/home/[a-z]' --include='*.md' --include='*.sh' --include='*.py' --include='*.js' . | grep -v node_modules | grep -v '.local.md' | grep -v '.git/' || echo "✅ 无个人路径"

# 旧系统名称
echo "--- 旧系统名称 ---"
grep -rn 'easywms' --include='*.sh' --include='*.py' --include='*.html' --include='*.js' --include='*.sql' . | grep -v node_modules | grep -v '.bats' || echo "✅ 无旧名称"

# 硬编码凭据
echo "--- 硬编码凭据 ---"
grep -rn 'psql.*-U dp_app\|password.*=.*dp\b' --include='*.md' --include='*.sh' --include='*.py' . | grep -v ci.yml | grep -v node_modules | grep -v '.local.md' || echo "✅ 无硬编码凭据"
```

---

## 五、脚本与文档对齐

| 检查项 | 方法 |
|--------|------|
| import-workflows.sh 默认目录 | `grep 'WF_DIR=' scripts/import-workflows.sh` — 应为 `apps/wf` |
| sync-workflows.py 健康检查端口 | `grep 'healthz' scripts/n8n-tools/sync-workflows.py` — 应使用 `API_PORT` 变量 |
| clone-company.sh sed 模式 | `grep 'sed.*API' scripts/clone-company.sh` — 应匹配 `.env.example` 实际内容 |
| DEPLOY-GUIDE 同步输出 | 工作流数/激活数/webhook 数须匹配实际 |
| .env.example 完整性 | docker-compose 中引用的所有 `${VAR}` 须在 .env.example 中出现 |
| BATS 测试夹具 | `tests/infra/*.bats` 中的 mock .env 须匹配 `.env.example` 真实内容 |

---

## 六、ADR-006 专项 (测试覆盖文档)

ADR-006 是最容易漂移的文件，历史上每次发版都发现偏差:

- **节标题版本号**: `## 现状总结 (vN)` 须匹配实际内部版本
- **测试文件列表**: 须与 `ls tests/unit/wf/*.test.js` **完全一致** (曾出现 4 个幽灵文件)
- **SQL 断言块明细**: 各文件数之和须等于总数 (用 `grep -c "RAISE NOTICE.*PASS"` 验证)
- **推荐路线版本映射**: 内部版本 (v21) 与发布版本 (v0.1.17) 须正确对应
- **Jest 覆盖率数字**: 从 `npm test` 输出中读取，不要从上一版文档复制

---

## 七、完整验证流程 (发布前必做)

```
发版检查清单 (按顺序执行，每一步都不可跳过):

□ 1. 更新 VERSION 文件
□ 2. 跑版本号验证脚本 (第一节) — 10 个位置全 ✅
□ 3. 跑统计数据硬验证脚本 (第二节) — 用命令输出覆盖文档数字
□ 4. 全量搜索旧版本号 → 确认无遗留: grep -rn 'v旧版本' --include='*.md' .
□ 5. 跑目录树验证 (第三节) — 无幽灵文件/无遗漏文件
□ 6. 跑敏感信息扫描 (第四节)
□ 7. npm test — 记录实际 Tests/Suites 数字
□ 8. 对比第 7 步数字与 CLAUDE.md 中写的数字，不一致则修正
□ 9. git diff --stat — 审查变更文件列表
□ 10. 提交

关键: 第 3 步和第 7-8 步是最容易偷懒跳过的，也是错误率最高的。
```

---

## 八、版本分级策略

### Stable 版本 vs Fix 版本

| 类型 | 示例 | 版本号更新 | Release | 文档同步 |
|------|------|:----------:|:-------:|:--------:|
| **Stable** | `v0.3.0` | 全量 10 个位置 + package.json | 必须，完整描述 | 全量同步 |
| **Fix** | `v0.3.0.1` | 仅 tag，不改文档 | 简要描述即可 | 不动，等下一个 stable 统一 |

### 决策流程

```
需要发版？
  ├─ 新功能/大改动 → Stable (vX.Y.Z)
  │   1. 更新 VERSION + 10 个位置 + package.json
  │   2. 跑统计数据硬验证 + npm test
  │   3. git commit + push main → CI 跑
  │   4. git tag + gh release (完整描述)
  │
  └─ 仅修复/小优化 → Fix (vX.Y.Z.N)
      1. 不改 VERSION 和文档版本号
      2. 代码改动 commit + push main → CI 跑
      3. git tag + gh release (简要描述)
      4. 文档版本号等下一个 stable 统一升级
```

---

## 九、Git 操作与 CI 触发规则

### CI 触发条件 (ci.yml)

```yaml
on:
  push:
    branches: [main]       # push 到 main → 触发
  pull_request:
    branches: [main]       # PR 目标 main → 触发
```

### 各操作触发矩阵

| 操作 | 触发 CI？ | 说明 |
|------|:---------:|------|
| `git push origin main` | **是** | 代码/文档推到 main |
| `git push origin feature/xxx` | **否** | 功能分支，CI 不管 |
| 功能分支有开放 PR 目标 main | **是** | PR 更新时触发 |
| `git tag` + `git push --tags` | **否** | tag 不在触发条件 |
| `gh release create` | **否** | release 不在触发条件 |
| merge feature → main + push | **是** | 本质是 push to main |

### 最佳实践

```
功能开发 (推荐流程):
  main → feature/xxx → 开发测试 → 合并 main → CI 跑一次 → tag + release (不触发 CI)

发版顺序 (必须):
  1. 先 commit + push (触发 CI)
  2. CI 通过后再 tag + release (不触发 CI)
  3. 禁止: 先打 tag 再改代码 — 导致 tag 指向的代码和实际不一致
```

---

## 教训记录 (按时间倒序)

| # | 教训 | 来源 | 严重程度 |
|---|------|------|:--------:|
| 12 | landing 路线图落后 3 个版本 (v0.1.16 标 Current, 实际 v0.3.0) | v0.3.0 发布 | 🟠 |
| 13 | WMS-UAT-Guide 版本号停留在 v0.1.20 | v0.3.0 发布 | 🟡 |
| 14 | apps/wf/README 版本号停留在 v0.2.0 | v0.3.0 发布 | 🟡 |
| 15 | CLAUDE.md 多处统计数字同时过时 (Jest/E2E/BATS/pytest/WF lib 共 8 处偏差) | v0.3.0 发布 | 🔴 |
| 11 | 缓存版本号 (phaseX.Y) 升级后忘记同步 MEMORY.md 和 frontend-cache-versioning.md | v0.1.19.1 | 🟡 |
| 10 | fix 版本 (v0.1.19.1) 不应全量更新 7 个文档版本号 | v0.1.19.1 | 🟡 |
| 9 | 一轮审查反复 5 次才收敛 | v0.1.18 | 🔴 |
| 8 | SQL 断言块明细 (16+5+16+11) 与总数 (69) 不一致 | v0.1.18 | 🟠 |
| 7 | clone-company.bats 测试夹具与 clone-company.sh 脚本不同步 | v0.1.18 | 🟠 |
| 6 | /home/<user> 硬编码在 4 个提交文件中 | v0.1.18 | 🔴 |
| 5 | pinia.iife.prod.js 在 vendor 中从未使用 (幽灵文件) | v0.1.18 | 🟡 |
| 4 | DEPLOY-GUIDE 同步脚本预期输出 (20/18) 滞后 3 个版本 | v0.1.18 | 🟠 |
| 3 | DEPLOY-GUIDE Schema 数写 4 实际 5 | v0.1.18 | 🟠 |
| 2 | ADR-006 列出 4 个不存在的测试文件 (幽灵文件) | v0.1.18 | 🔴 |
| 1 | VERSION 目录树注释 3 个版本未更新 (0.1.16→0.1.18) | v0.1.18 | 🟠 |

### 错误模式总结

| 模式 | 发生次数 | 根因 | 预防 |
|------|:--------:|------|------|
| **统计数字从文档复制而非重新计数** | >10 次 | 懒惰/信任旧数据 | 必须跑计数脚本 |
| **新增位置未加入检查清单** | 3 次 | SOP 不完整 | 每次发现遗漏就更新 SOP |
| **变更日志写数字时用记忆而非命令** | >5 次 | 数字变化频繁 | 变更日志中的数字也要硬验证 |
| **只改了文档没搜其他引用** | >5 次 | 一处改全量搜太麻烦 | grep -rn 是最低成本的保险 |
| **landing 页等非 .md 文件被遗漏** | 2 次 | SOP 只关注 .md | 扩大检查范围到 .html |
