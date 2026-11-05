#!/bin/bash
# contents controller 실행: 이 파일을 더블클릭하세요.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Node.js가 설치되어 있지 않아요."
  echo "열리는 페이지에서 LTS 버전을 내려받아 설치한 뒤, 이 파일을 다시 더블클릭하세요."
  open "https://nodejs.org/ko/download"
  read -r -p "엔터를 누르면 창이 닫혀요." _
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "처음 실행이라 필요한 파일을 내려받는 중이에요 (1분 정도)..."
  npm install --omit=dev --no-audit --no-fund || { read -r -p "설치에 실패했어요. 엔터를 누르면 창이 닫혀요." _; exit 1; }
fi
(sleep 1.5 && open "http://localhost:4321") &
node server.js
