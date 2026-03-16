#!/bin/bash
# =============================================================================
# DP v0.1 — 统一备份 (单 pg_dump = 全平台)
# =============================================================================

set -e

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_DIR:-./backups}"
CONTAINER="dp-db"

echo "=== DP 数据库备份 ==="
echo "时间: $TIMESTAMP"

mkdir -p "$BACKUP_DIR"

BACKUP_FILE="$BACKUP_DIR/dp_backup_${TIMESTAMP}.dump"

# pg_dump -Fc 自定义格式 (全库，包含所有 4 个 Schema)
# 自定义格式优势:
#   - 自动处理 schema/扩展顺序
#   - 支持选择性恢复 (按 schema/表)
#   - 大库恢复更快 (并行 pg_restore)
#   - 自带压缩，无需 gzip
docker exec "$CONTAINER" pg_dump \
    -U "${DP_DB_USER:-dp_app}" \
    -d "${DP_DB_NAME:-dp}" \
    --no-owner \
    --no-privileges \
    --format=custom \
    -f "/tmp/dp_backup.dump"

# 从容器复制到宿主机
docker cp "$CONTAINER:/tmp/dp_backup.dump" "$BACKUP_FILE"
docker exec "$CONTAINER" rm -f /tmp/dp_backup.dump

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "备份完成: $BACKUP_FILE ($SIZE)"

# GPG 对称加密 (可选)
if [ -n "$DP_BACKUP_ENCRYPTION_KEY" ]; then
    echo "正在加密备份文件..."
    gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase "$DP_BACKUP_ENCRYPTION_KEY" \
        --output "${BACKUP_FILE}.gpg" \
        "$BACKUP_FILE"
    rm -f "$BACKUP_FILE"
    BACKUP_FILE="${BACKUP_FILE}.gpg"
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "加密完成: $BACKUP_FILE ($SIZE)"
else
    echo "未设置 DP_BACKUP_ENCRYPTION_KEY，跳过加密"
fi

echo ""
echo "恢复命令:"
if [ -n "$DP_BACKUP_ENCRYPTION_KEY" ]; then
    echo "  # 先解密"
    echo "  gpg --batch --decrypt --passphrase \$DP_BACKUP_ENCRYPTION_KEY --output dp_backup.dump $BACKUP_FILE"
    echo "  docker cp dp_backup.dump $CONTAINER:/tmp/dp_backup.dump"
else
    echo "  docker cp $BACKUP_FILE $CONTAINER:/tmp/dp_backup.dump"
fi
echo "  docker exec $CONTAINER pg_restore -U \${DP_DB_USER:-dp_app} -d \${DP_DB_NAME:-dp} --clean --if-exists /tmp/dp_backup.dump"
