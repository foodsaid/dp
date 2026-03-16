---
name: macOS Self-hosted Runner 经验
description: GitHub Actions macOS self-hosted runner 踩坑记录 — BSD 工具链差异、BATS UTF-8、Docker services 不可用、Python/pip 兼容性
type: reference
---

# macOS Self-hosted Runner 经验总结

## 核心教训: macOS ≠ Ubuntu

macOS self-hosted runner 与 GitHub hosted Ubuntu runner 的差异远超预期。一次成功需要解决 10+ 兼容性问题。

## 已踩坑清单

### 1. BSD sed vs GNU sed
- **问题**: `sed -i "s/..."` macOS 上报 `invalid command code`
- **修复**: 跨平台函数 `sedi() { local f="${*: -1}"; sed -i.bak "$@" && rm -f "${f}.bak"; }`
- **影响**: clone-company.sh、BATS 测试中的 sed 调用

### 2. BSD grep 不支持 `-P` (Perl regex)
- **问题**: `grep -ohP '\d+'` macOS 不可用
- **修复**: `grep -ohE '[0-9]+'` (ERE 语法)
- **影响**: CI 中所有 grep 调用

### 3. BATS 中文测试名
- **问题**: macOS bash 3.2 的 `printf '%q'` 对 UTF-8 多字节字符有 bug，BATS 无法匹配中文测试名
- **修复**: 测试名改为 ASCII (测试体内中文注释不受影响)
- **影响**: 所有 BATS 文件的 `@test "..."` 行

### 4. Docker `services:` 块不可用
- **问题**: self-hosted runner 不支持 `services:` (仅 GitHub hosted 支持)
- **修复**: 改为 `docker run -d --name ci-postgres ...` + 手动等待 + `always()` 清理
- **影响**: pg-schema-test job

### 5. `setup-python@v5` 需要 sudo
- **问题**: macOS .pkg 安装器需要 sudo，self-hosted runner 无 sudo
- **修复**: 跳过 setup-python，直接用 brew Python
- **条件**: `if: runner.os != 'macOS'`

### 6. PEP 668 externally-managed-environment
- **问题**: brew Python 3.12+ 拒绝 `pip install` (全局安装)
- **修复**: `python3 -m pip install --break-system-packages`

### 7. `python` 命令不存在
- **问题**: macOS brew 只有 `python3`，没有 `python` alias
- **修复**: package.json 和 CI 中统一用 `python3`

### 8. GitHub Actions cache 超时
- **问题**: 从泰国网络到 GitHub cache 服务器延迟高，`cache: 'npm'` 频繁超时
- **修复**: 移除所有 `cache:` 配置 (self-hosted runner 本地已有 node_modules)

### 9. `LANG` locale
- **问题**: runner 默认 POSIX locale，影响 UTF-8 输出
- **修复**: runner `.env` 设 `LANG=en_US.UTF-8`；CI 步骤也设 `LANG`/`LC_ALL`

### 10. Docker 跨架构构建
- **问题**: ARM64 macOS 构建 x86 镜像需要额外参数
- **修复**: `--platform linux/amd64 --provenance=false`

### 11. ShellCheck `${@: -1}` 混合参数
- **问题**: SC2145 不允许 `"${@: -1}.bak"` 混合字符串和数组
- **修复**: `local f="${*: -1}"` 先提取到变量

## Runner 配置要点

### .env 文件 (launchd 不读 ~/.zshrc)
```
PATH=/opt/homebrew/bin:/opt/homebrew/sbin:/opt/homebrew/opt/libpq/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/libexec
ImageOS=macos15
DOCKER_BUILDKIT=1
COMPOSE_DOCKER_CLI_BUILD=1
AGENT_TOOLSDIRECTORY=/Volumes/CIWorkspace/actions-runner/_tool
LANG=en_US.UTF-8
```

### 前置安装
```bash
brew install shellcheck libpq python@3.12 node@20
python3 -m pip install --break-system-packages pytest pytest-mock bats
```

### Case-sensitive 磁盘
```bash
hdiutil create -size 100g -fs 'Case-sensitive APFS' -volname CIWorkspace ~/CI-Workspace.sparsebundle
```

## runs-on 动态表达式
```yaml
runs-on: ${{ (github.ref == 'refs/heads/main' || ...) && vars.RUNNER_TARGET && fromJson(vars.RUNNER_TARGET) || fromJson('["ubuntu-latest"]') }}
```
- `vars.RUNNER_TARGET = ["self-hosted","macOS"]` → 用 self-hosted
- 变量不存在 → fallback ubuntu-latest

## 性能对比
- self-hosted macOS: 12 Job 串行约 8-10 分钟 (单 runner)
- GitHub hosted Ubuntu: 12 Job 并行约 3-4 分钟 (但消耗免费额度)
- self-hosted 适合额度耗尽时零成本运行
