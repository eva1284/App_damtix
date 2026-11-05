#!/bin/bash
# Claude 데스크톱 앱에 contents controller 연결: 이 파일을 한 번만 더블클릭하세요.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js가 설치되어 있지 않아요. 먼저 start.command를 실행해 안내를 따라 주세요."
  read -r -p "엔터를 누르면 창이 닫혀요." _
  exit 1
fi
[ -d node_modules ] || npm install --omit=dev --no-audit --no-fund
node scripts/connect-claude.js
read -r -p "엔터를 누르면 창이 닫혀요." _
