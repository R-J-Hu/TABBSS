#!/bin/bash
# 海峡报站模拟器 — 启动本地网页（路径随本脚本位置自动解析，可整体复制到任意目录使用）
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="8940"
if [ -f "$SCRIPT_DIR/port.txt" ]; then
  PORT="$(tr -d ' \r\n' < "$SCRIPT_DIR/port.txt")"
fi

if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti TCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$PIDS" ]; then
    echo "正在结束占用端口 $PORT 的进程: $PIDS"
    kill $PIDS 2>/dev/null || true
    sleep 0.4
  fi
fi

echo "项目目录: $SCRIPT_DIR"
echo "档案库新模式目录: $SCRIPT_DIR/报站线路文件库"
echo "海峡兼容模式目录: $SCRIPT_DIR/兼容模式-海峡报站器文件库"
echo "端口: $PORT"
echo "浏览器将打开: http://127.0.0.1:$PORT/web/"
echo "按 Ctrl+C 可停止服务"
echo ""

python3 "$SCRIPT_DIR/scripts/local_server.py" --port "$PORT" --root "$SCRIPT_DIR" &
SERVER_PID=$!
sleep 0.6
open "http://127.0.0.1:$PORT/web/" 2>/dev/null || true
wait $SERVER_PID
