# Superset 升级经验教训

> **版本**: v1.1 (2026-03-18)
> **适用**: Superset 大版本升级 (6.0 → 6.1+)
> **来源**: feature/superset-6.1.0 分支验证经验

---

## 1. 数据库隔离 (最关键)

### Alembic 迁移不可逆

`superset db upgrade` 执行后，`alembic_version` 和表结构升级到新版格式。
**切回旧版本的 Superset 将无法启动** (Alembic head 不匹配)。

### 空库 ≠ 升级测试

全新空库只验证"全新安装"路径。Alembic 迁移失败往往因:
- 历史脏数据、旧索引冲突、外键约束
- 空库完全测不出这些问题

### 正确方案: pg_dump 克隆真实数据

```bash
# 1. 创建临时数据库
docker exec dp-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "CREATE DATABASE dp_superset_610rc OWNER dp_app;"

# 2. 克隆 bi + wms schema 到临时库
docker exec dp-db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -n bi -n wms | \
  docker exec -i dp-db psql -U "$POSTGRES_USER" -d dp_superset_610rc

# 3. 用临时库启动 (注意: 会导致 dp-db 容器重建，但数据不受影响)
DP_DB_NAME=dp_superset_610rc docker compose up -d dp-bi

# ⚠ 验证完成后必须恢复 dp-db 默认配置:
docker compose up -d dp-db
```

### 清理

```bash
docker exec dp-db psql -U "$POSTGRES_USER" \
  -c "DROP DATABASE IF EXISTS dp_superset_610rc;"
```

---

## 2. Debian Trixie + Bookworm APT 源兼容性

### 实际验证 (2026-03-18)

**6.1.0rc1 基础镜像仍为 Bookworm (Debian 12.13)**，未升级到 Trixie。
因此 ODBC Driver 18 build + runtime 均正常，无 segfault。

但未来正式版可能切换到 Trixie，Bookworm 源的 `msodbcsql18` 在 Trixie 上:
- **build 可能成功** (apt install 不报错)
- **runtime segfault** (glibc/libssl 版本不匹配)

### ENABLE_MSSQL_ODBC 显式开关

```dockerfile
ARG ENABLE_MSSQL_ODBC=true

RUN if [ "$ENABLE_MSSQL_ODBC" = "true" ]; then \
        # 安装 ODBC Driver 18 (Bookworm 源) \
    else \
        echo "ODBC 已禁用, 使用 pymssql"; \
    fi
```

**使用**:
```bash
# 默认 (启用 ODBC)
docker compose build dp-bi

# 禁用 ODBC (Trixie 不兼容时)
docker compose build dp-bi --build-arg ENABLE_MSSQL_ODBC=false
```

---

## 3. FAB 5.0.2 SSO 认证三步法

### 废弃方法

```python
# ❌ Flask 3 + SQLAlchemy 2.0 后 session 处理不稳定
user = sm.auth_user_remote_user(username)
```

### 迁移三步

```python
sm = app.appbuilder.sm

# 1. 查找用户
user = sm.find_user(username=username)

# 2. 不存在则创建
if not user:
    default_role = sm.find_role(
        app.config.get('AUTH_USER_REGISTRATION_ROLE', 'Gamma')
    )
    user = sm.add_user(
        username=username,
        first_name=username,
        last_name='',
        email=f'{username}@sso.local',
        role=default_role,
    )
    sm.session.commit()

# 3. 更新认证统计 (last_login / login_count) — 必须!
sm.update_user_auth_stat(user)
```

### 关键细节

- 用 `sm.session` 而非 `db.session` (FAB 5.0.2 + SQLAlchemy 2.0 兼容)
- 所有 session 操作必须 `try/except` + `sm.session.rollback()` 防僵死
- `update_user_auth_stat` 不能省略，否则审计/权限逻辑异常

### 实际验证结果 (2026-03-18, Flask test client)

| 场景 | WSGI environ | 期望角色 | 实际角色 | login_count |
|------|-------------|---------|---------|-------------|
| 无组匹配 | `HTTP_REMOTE_USER` only | Gamma | Gamma | 1 |
| admins 组 | + `HTTP_X_FORWARDED_GROUPS: admins` | Admin | Admin | 1 |
| bi-users 组 | + `HTTP_X_FORWARDED_GROUPS: bi-users` | Alpha | Alpha | 1 |

### WSGI environ key 的坑

代码中 `request.environ.get('HTTP_REMOTE_USER')` 对应 HTTP header `Remote-User`。

- **WSGI 规范**: HTTP header `Foo-Bar` → environ key `HTTP_FOO_BAR`
- **CGI 变量**: `REMOTE_USER` (无 `HTTP_` 前缀) 是完全不同的 key
- Flask test client 用 `environ_base={'HTTP_REMOTE_USER': 'xxx'}` 才能命中

```python
# ✅ 正确 — HTTP header 风格
request.environ.get('HTTP_REMOTE_USER')

# ❌ 错误 — CGI 变量，nginx proxy_set_header 设置的 header 不会出现在这
request.environ.get('REMOTE_USER')
```

### Flask test client 端到端测试方法

无需 gateway/Authelia，直接在容器内验证 SSO 逻辑:

```python
from superset.app import create_app
app = create_app()

with app.test_client() as client:
    response = client.get(
        '/superset/welcome/',
        environ_base={
            'HTTP_REMOTE_USER': 'test_user',
            'HTTP_X_FORWARDED_GROUPS': 'admins'
        }
    )
    # 200 = 直接进入，302 → /login/ = SSO 未生效

with app.app_context():
    sm = app.appbuilder.sm
    user = sm.find_user(username='test_user')
    # 验证 user.roles / login_count / last_login

    # 清理
    sm.session.delete(user)
    sm.session.commit()
```

---

## 4. sm.session vs db.session

### 问题

SQLAlchemy 2.0 移除 autocommit。异常后 Session 进入 `InvalidRequestError` 僵死状态。

### 规则

- **统一使用** `sm.session` (FAB SecurityManager 管理的 session)
- **不要混用** `db.session` (可能是不同的 scoped session)
- 所有写操作包裹 `try/except`:

```python
try:
    # 读写操作
    sm.session.commit()
except Exception as e:
    sm.session.rollback()
    app.logger.error(f'操作失败: {e}')
```

---

## 5. 废弃 Feature Flags

Superset 6.1 已永久启用以下标志，从配置中移除:

| 标志 | 状态 |
|------|------|
| `DASHBOARD_NATIVE_FILTERS` | 永久启用，配置中设置无效 |
| `DASHBOARD_CROSS_FILTERS` | 永久启用，配置中设置无效 |

---

## 6. Alembic 迁移详情 (6.0.0 → 6.1.0)

实际执行的 5 步增量迁移 (2026-03-18 验证):

| 步骤 | 版本号 | 内容 |
|------|--------|------|
| 1 | `c233f5365c9e → x2s8ocx6rto6` | 扩展 username 字段到 128 chars |
| 2 | `→ a9c01ec10479` | 添加 datetime_format 到 table_columns |
| 3 | `→ f5b5f88d8526` | 修复 form_data 字符串在 query_context 中 |
| 4 | `→ 9787190b3d89` | 添加 currency_code_column 支持 |
| 5 | `→ 4b2a8c9d3e1f` | 创建 tasks + task_subscribers 表 (GTF) |

结果: bi schema 从 51 表增加到 53 表。

---

## 7. 缓存 Hash 变更 (MD5 → SHA-256)

Superset 6.1 将缓存键 hash 从 MD5 改为 SHA-256。
升级后首次访问所有仪表板/图表会缓存失效 (重新计算)。

**影响**: 一次性性能抖动，无需特殊处理。
**验证**: 清除浏览器缓存 → 刷新 → 确认无 JS 报错。

---

## 8. RC1 已知 UI Bug (可忽略)

v6.1.0rc1 已知但不影响核心功能的 UI 问题:
- Fullscreen 模式布局异常
- Pivot table 样式偶尔错位
- Weekly chart 日期轴标签重叠

这些预计在正式版修复，不影响功能验证。

---

## 9. 回滚策略

### 理想情况 (主库未被污染)

如果严格使用 `DP_DB_NAME=dp_superset_610rc` 隔离，主库不受影响:

```bash
docker compose stop dp-bi
git checkout main
docker exec dp-db psql -U "$POSTGRES_USER" \
  -c "DROP DATABASE IF EXISTS dp_superset_610rc;"
docker compose build dp-bi --no-cache
docker compose up -d dp-bi
```

### 主库已被升级 (实际踩坑 2026-03-18)

**教训**: SSO 验证时 `docker compose --profile sso up -d` 忘记带 `DP_DB_NAME`，
dp-bi 对主库执行了 `superset db upgrade`，将 `bi.alembic_version` 推进到 6.1.0 head。

**评估**: 6.0→6.1 的 5 步迁移均为增量变更 (新表/新列)，不删旧结构。
6.0.0 启动时若检测到未知 alembic head，可能报 `Pending database migrations` 但多数情况仍可运行。

**修复 (如 6.0.0 无法启动)**:

```bash
# 查询 6.0.0 的 alembic head (从旧备份或文档获取)
# 6.0.0 最后一个 head: c233f5365c9e

# 回退 alembic_version 标记 (不回退表结构)
docker exec dp-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "UPDATE bi.alembic_version SET version_num = 'c233f5365c9e';"

# 新增的 tasks/task_subscribers 表不影响 6.0.0，可不删
# 如需完全清理:
# DROP TABLE IF EXISTS bi.task_subscribers;
# DROP TABLE IF EXISTS bi.tasks;
```

### 核心教训

> **任何 docker compose 操作都必须确认 DP_DB_NAME 指向隔离库**。
> `--profile sso` / `up -d` / `restart` 都会触发 entrypoint 中的 `superset db upgrade`。
> 一次疏忽就会污染主库，且 Alembic 不支持自动 downgrade。
