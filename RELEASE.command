#!/bin/bash
cd "$(dirname "$0")"
python3 RELEASE "$@"
echo ""
read -p "按回车退出..."
