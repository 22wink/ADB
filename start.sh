#!/usr/bin/env bash
# macOS / Linux 开发或生产入口
set -euo pipefail
cd "$(dirname "$0")"

if [[ -x "release/ADB-Studio/start.sh" ]]; then
  exec "release/ADB-Studio/start.sh"
fi

if [[ -f "apps/server/dist/index.js" ]]; then
  exec node apps/server/dist/index.js
fi

echo "[ERROR] 未找到可运行产物"
echo "开发：pnpm install && pnpm fetch:adb && pnpm build && pnpm start"
echo "发布：pnpm release && ./start.sh"
exit 1
