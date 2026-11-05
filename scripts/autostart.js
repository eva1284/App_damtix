// Mac에 로그인하면 contents controller가 뒤에서 자동으로 켜지게 한다 (macOS launchd).
// 터미널 창을 켜 둘 필요가 없고, 꺼지면 다시 켜진다. Claude 앱을 껐다 켜도 영향을 받지 않는다.
//   node scripts/autostart.js install   켜기
//   node scripts/autostart.js uninstall 끄기
//   node scripts/autostart.js status    상태 보기
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LABEL = 'com.damtix.contents-controller';
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const logPath = path.join(os.homedir(), 'Library', 'Logs', 'contents-controller.log');
const domain = `gui/${process.getuid?.() ?? 501}`;
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function launchctl(...args) {
  try { return execFileSync('launchctl', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString(); }
  catch (e) { return null; }
}

const cmd = process.argv[2] || 'status';
if (process.platform !== 'darwin') { console.log('자동 실행은 Mac에서만 쓸 수 있어요.'); process.exit(cmd === 'status' ? 0 : 1); }

if (cmd === 'install') {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(path.join(appDir, 'server.js'))}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(appDir)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(logPath)}</string>
  <key>StandardErrorPath</key><string>${xml(logPath)}</string>
</dict>
</plist>
`;
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  launchctl('bootout', domain, plistPath); // 이미 등록돼 있으면 내렸다가 다시 올린다
  fs.writeFileSync(plistPath, plist);
  if (launchctl('bootstrap', domain, plistPath) === null && launchctl('load', '-w', plistPath) === null) {
    console.error(`\n자동 실행 등록에 실패했어요. 기록 파일: ${logPath}\n`);
    process.exit(1);
  }
  console.log(`\n자동 실행을 켰어요. 이제 Mac에 로그인하면 contents controller가 뒤에서 켜져요.\n브라우저에서 http://localhost:4321 을 열면 돼요.\n\n처음에 "node가 데스크탑 폴더에 접근하려고 합니다" 같은 창이 뜨면 [허용]을 눌러 주세요 (기준 이미지 폴더를 읽기 위해서예요).\n기록 파일: ${logPath}\n`);
} else if (cmd === 'uninstall') {
  launchctl('bootout', domain, plistPath) ?? launchctl('unload', '-w', plistPath);
  if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
  console.log('\n자동 실행을 껐어요. 필요할 때 start.command로 켜면 돼요.\n');
} else {
  const on = fs.existsSync(plistPath);
  const info = on ? launchctl('print', `${domain}/${LABEL}`) : null;
  const running = !!info && /state = running/.test(info);
  console.log(on ? `자동 실행: 켜짐 · 지금 ${running ? '실행 중' : '실행 중 아님'}\n기록 파일: ${logPath}` : '자동 실행: 꺼짐');
}
