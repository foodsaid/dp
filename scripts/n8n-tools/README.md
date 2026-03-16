# n8n 工作流管理工具

> 位置: `scripts/n8n-tools/`
> 用途: n8n 工作流的批量导入、激活、同步等运维操作

## 工具列表

| 脚本 | 语言 | 用途 | 运行方式 |
|------|------|------|---------|
| `sync-workflows.py` | Python3 | 一键同步: 删除旧工作流→导入→激活 | `N8N_API_KEY=xxx python3 scripts/n8n-tools/sync-workflows.py` |
| `add-ids.js` | Node.js | 为 JSON 文件添加 n8n 要求的 id 字段 | 在 dp-wf 容器内执行 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `N8N_API_KEY` | (必填) | n8n API Key (从 n8n UI Settings > API 创建) |
| `WF_DIR` | `apps/wf/` | 工作流 JSON 文件目录 |
| `DB_USER` | `dp_app` | PostgreSQL 用户 |
| `DB_NAME` | `dp` | PostgreSQL 数据库 |
| `N8N_CONTAINER` | `dp-wf` | n8n 容器名 |
| `DB_CONTAINER` | `dp-db` | 数据库容器名 |
| `N8N_API_PORT` | `5678` | n8n API 端口 |

## 注意事项

- 在 WSL 中执行 (不要从 Windows 直接运行)
- 同步脚本会删除所有现有工作流后重新导入
- API Key 从 n8n UI 的 Settings > API 页面创建
