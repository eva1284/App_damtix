#!/bin/bash
# Mac에 로그인하면 contents controller가 자동으로 켜지게 합니다. 한 번만 더블클릭하세요.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js가 설치되어 있지 않아요. 먼저 start.command를 실행해 안내를 따라 주세요."
  read -r -p "엔터를 누르면 창이 닫혀요." _
  exit 1
fi
[ -d node_modules ] || npm install --omit=dev --no-audit --no-fund
# start.command로 켜 둔 프로그램이 있으면 끄고 자동 실행으로 넘긴다
pkill -f "node server.js" 2>/dev/null
pkill -f "$(pwd)/server.js" 2>/dev/null
node scripts/autostart.js install && (sleep 2 && open "http://localhost:4321") &
wait
read -r -p "엔터를 누르면 창이 닫혀요." _
