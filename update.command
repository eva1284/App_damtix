#!/bin/bash
# contents controller 업데이트: 최신 버전을 받고 다시 켭니다. 더블클릭하세요.
cd "$(dirname "$0")" || exit 1
echo "최신 버전을 받는 중..."
git pull --ff-only || { echo ""; echo "업데이트를 받지 못했어요. 위 메시지를 캡처해서 Claude에게 보여주세요."; read -r -p "엔터를 누르면 창이 닫혀요." _; exit 1; }
npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1
if [ -f "$HOME/Library/LaunchAgents/com.damtix.contents-controller.plist" ]; then
  node scripts/autostart.js restart
else
  PIDS=$(lsof -ti tcp:4321 -sTCP:LISTEN 2>/dev/null)
  [ -n "$PIDS" ] && kill $PIDS 2>/dev/null
  echo "start.command로 다시 켜 주세요. (autostart.command를 쓰면 이 과정이 자동이에요)"
fi
echo ""
echo "업데이트 끝. Claude 기능이 바뀐 업데이트라면 Claude 앱도 ⌘Q로 껐다가 다시 열어 주세요."
read -r -p "엔터를 누르면 창이 닫혀요." _
