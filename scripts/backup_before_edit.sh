#!/bin/bash
# 在修改 CurrentVersion 前，将当前目录完整备份到 History/<版本号>/
# 用法：在 CurrentVersion 根目录执行：  ./scripts/backup_before_edit.sh V1.1
set -e
VER="${1:?请传入版本号，例如 V1.1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARENT="$(cd "$ROOT/.." && pwd)"
DEST="$PARENT/History/$VER"
mkdir -p "$DEST"
echo "备份 $ROOT -> $DEST"
rsync -a --delete "$ROOT/" "$DEST/"
echo "完成。"
