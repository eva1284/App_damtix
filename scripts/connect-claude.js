// Claude 데스크톱 앱에 contents controller를 연결한다 (설정 파일에 MCP 서버를 등록).
// 기존 설정은 그대로 두고 contents-controller 항목만 추가하거나 바꾼다. 바꾸기 전에 백업을 만든다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = process.env.CLAUDE_CONFIG_PATH || (
  process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  : process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
  : path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json'));

let config = {};
if (fs.existsSync(configPath)) {
  const raw = fs.readFileSync(configPath, 'utf8');
  try { config = raw.trim() ? JSON.parse(raw) : {}; }
  catch { console.error(`\nClaude 설정 파일을 읽을 수 없어요 (형식 오류):\n${configPath}\n파일을 고친 뒤 다시 실행해 주세요. 아무것도 바꾸지 않았어요.\n`); process.exit(1); }
  const backup = `${configPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(configPath, backup);
  console.log(`기존 설정을 백업했어요: ${backup}`);
} else {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
}

config.mcpServers = config.mcpServers || {};
config.mcpServers['contents-controller'] = { command: process.execPath, args: [path.join(appDir, 'mcp.js')] };
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

console.log(`\nClaude 데스크톱 앱에 contents controller를 연결했어요.\n설정 파일: ${configPath}\n\n다음 단계:\n  1. Claude 앱을 완전히 종료하세요 (⌘Q).\n  2. Claude 앱을 다시 여세요.\n  3. Claude에게 "contents controller 브랜드 기준 보여줘"라고 말해 보세요.\n`);
