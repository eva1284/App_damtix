// Google Drive 복사. Mac의 Google Drive 앱 폴더(~/Library/CloudStorage/GoogleDrive-…)는
// 동기화 중이거나 폴더를 아직 내려받지 않았을 때 잠깐 거절하는 경우가 있어서(Unknown system error -11 등)
// 잠깐 기다렸다가 다시 시도한다. 끝내 안 되면 최종 처리는 끝난 것으로 두고 Drive만 '실패'로 남긴다.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { load } from './store.js';
import { finalsConfig } from './finalize.js';
import { resolveFolder } from './images.js';
import { getWork, mutate } from './works.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const TRANSIENT = new Set(['EDEADLK', 'EAGAIN', 'EBUSY', 'ETIMEDOUT', 'EINTR', 'ECANCELED', 'UNKNOWN', 'EIO']);
export const isTransient = e => TRANSIENT.has(e?.code) || e?.errno === -11 || /system error -11|deadlock|temporarily unavailable/i.test(e?.message || '');

export async function retry(fn, { tries = 6, wait = Number(process.env.CC_RETRY_MS) || 1000 } = {}) {
  let d = wait;
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (!isTransient(e) || i >= tries - 1) throw e;
      await sleep(d); d = Math.min(d * 2, 8000);
    }
  }
}

async function ensureDir(parent, name) {
  const hit = await retry(() => resolveFolder(parent, name));
  if (hit) return hit;
  const p = path.join(parent, name);
  await retry(() => fs.promises.mkdir(p, { recursive: true }));
  return p;
}

const friendly = e => `${e.message}${isTransient(e) ? ' — Google Drive 앱이 동기화 중이거나 폴더를 아직 내려받지 않았을 때 생겨요. 잠시 뒤 "Drive에 다시 복사"를 눌러 주세요. 계속되면 Google Drive 앱 설정에서 "내 드라이브"를 "파일 미러링"으로 바꿔 주세요.' : ''}`;

// dirs: Mac에 저장한 폴더들. 각 폴더는 <완성본>/<계정>/<게시일_작업번호> 모양이고 Drive에도 같은 모양으로 복사한다.
export async function copyToDrive(dirs, opts = {}) {
  const { finalsFolder, driveFolder } = { ...finalsConfig(), ...opts };
  if (!driveFolder) return { status: 'off', path: '', paths: [] };
  if (!fs.existsSync(driveFolder)) return { status: 'missing', path: driveFolder, paths: [driveFolder] };
  const paths = [];
  try {
    for (const d of dirs) {
      const acc = path.basename(path.dirname(d)), folder = path.basename(d);
      const dd = await ensureDir(await ensureDir(await ensureDir(driveFolder, finalsFolder), acc), folder);
      for (const f of fs.readdirSync(d)) {
        if (!fs.statSync(path.join(d, f)).isFile()) continue;
        await retry(() => fs.promises.copyFile(path.join(d, f), path.join(dd, f)));
      }
      paths.push(dd);
    }
    return { status: 'copied', path: paths[0] || '', paths };
  } catch (e) {
    return { status: 'failed', error: friendly(e), path: paths[0] || '', paths, at: new Date().toISOString() };
  }
}

// 완료된 작업을 Drive에 다시 복사 (화면의 "Drive에 다시 복사")
export async function recopyToDrive(id, by = '화면') {
  const w = getWork(id);
  const final = w.type === 'image' ? w.image?.final : w.video?.final;
  if (!final) throw new Error('최종 저장이 끝난 작업만 Drive에 복사할 수 있어요.');
  const dirs = w.type === 'image' ? [final.folder] : final.folders;
  const missing = dirs.filter(d => !fs.existsSync(d));
  if (missing.length) throw new Error(`Mac 폴더를 찾을 수 없어요: ${missing.join(', ')}`);
  const drive = await copyToDrive(dirs);
  return mutate(id, by, x => {
    const f = x.type === 'image' ? x.image.final : x.video.final;
    f.drive = { ...drive, ...(drive.status === 'failed' ? { attempts: f.drive?.attempts || 1, lastTry: new Date().toISOString() } : {}) };
    return drive.status === 'copied' ? 'Google Drive에 다시 복사했어요' : drive.status === 'failed' ? `Google Drive 복사 실패: ${drive.error}` : drive.status === 'missing' ? 'Drive 폴더를 찾을 수 없어요' : 'Drive 복사가 꺼져 있어요';
  });
}

/* ---------- 진단: 왜 Drive 복사가 실패하는지 ---------- */

const run = (cmd, args) => new Promise(r => execFile(cmd, args, { timeout: 15000 }, (err, out) => r(err ? '' : String(out))));

// 스트리밍(파일이 클라우드에만 있고 필요할 때 받음) / 미러링(파일이 Mac에 다 있음) 구분: macOS는 클라우드 전용 파일에 dataless 표시(0x40000000)를 붙인다
async function driveMode(folder) {
  if (process.platform !== 'darwin') return 'unknown';
  let files = [];
  try { files = fs.readdirSync(folder).filter(f => !f.startsWith('.')).slice(0, 30).map(f => path.join(folder, f)); } catch { return 'unknown'; }
  if (!files.length) return 'unknown';
  const out = await run('/usr/bin/stat', ['-f', '%Xf', ...files]);
  const flags = out.split('\n').map(x => parseInt(x.trim(), 16)).filter(n => Number.isFinite(n));
  if (!flags.length) return 'unknown';
  return flags.some(n => n & 0x40000000) ? 'stream' : 'mirror';
}

const HINT = {
  missing: 'Google Drive 폴더가 없어요. Google Drive 앱에 로그인돼 있는지 보고, 홈 > 완성본 저장에서 폴더를 다시 골라 주세요.',
  perm: '맥이 이 프로그램의 Google Drive 접근을 막고 있어요. 시스템 설정 > 개인정보 보호 및 보안 > 전체 디스크 접근 권한에서 node를 켜 주세요.',
  busy: 'Google Drive가 동기화 중이거나 스트리밍 모드라 잠깐 거절해요. Google Drive 설정 > 내 드라이브를 "파일 미러링"으로 바꾸면 해결돼요.',
  stream: '스트리밍 모드라 가끔 복사가 거절될 수 있어요. 실패하면 자동으로 다시 시도하고, 계속되면 "파일 미러링"으로 바꿔 주세요.',
  ok: ''
};

let lastCheck = null;
export const driveStatus = () => lastCheck;
export async function diagnoseDrive() {
  const { finalsFolder, driveFolder } = finalsConfig();
  const at = new Date().toISOString();
  if (!driveFolder) return (lastCheck = { at, state: 'off', message: 'Google Drive 복사가 꺼져 있어요.', hint: '' });
  if (!fs.existsSync(driveFolder)) return (lastCheck = { at, state: 'missing', folder: driveFolder, message: 'Google Drive 폴더를 찾을 수 없어요.', hint: HINT.missing });
  const mode = await driveMode(driveFolder);
  const t0 = Date.now();
  try {
    const dir = await ensureDir(driveFolder, finalsFolder);
    const probeFile = path.join(dir, `.cc-write-test-${process.pid}`);
    await retry(() => fs.promises.writeFile(probeFile, 'ok'), { tries: 3 });
    await retry(() => fs.promises.rm(probeFile, { force: true }), { tries: 3 });
    return (lastCheck = { at, state: 'ok', folder: driveFolder, mode, ms: Date.now() - t0, message: `복사할 수 있어요${mode === 'stream' ? ' (스트리밍 모드)' : mode === 'mirror' ? ' (미러링 모드)' : ''}.`, hint: mode === 'stream' ? HINT.stream : '' });
  } catch (e) {
    const perm = ['EPERM', 'EACCES'].includes(e.code);
    return (lastCheck = { at, state: 'fail', folder: driveFolder, mode, message: `쓰기 실패: ${e.message}`, hint: perm ? HINT.perm : isTransient(e) ? HINT.busy : HINT.busy, code: e.code || e.errno });
  }
}

/* ---------- 실패한 복사는 대기열에서 자동으로 다시 시도 ---------- */
// 최종 저장은 끝났는데 Drive만 실패한 작업들. 10분 간격(시도할수록 길게, 최대 1시간)으로 다시 복사한다.
export function driveQueue() {
  return load('works').filter(w => (w.type === 'image' ? w.image?.final : w.video?.final)?.drive?.status === 'failed').map(w => {
    const d = (w.type === 'image' ? w.image.final : w.video.final).drive;
    return { workId: w.id, title: w.title, attempts: d.attempts || 1, lastTry: d.lastTry || d.at || null, error: d.error };
  });
}
let pumping = false;
export async function pumpDriveQueue(force = false) {
  if (pumping) return [];
  pumping = true;
  const done = [];
  try {
    for (const q of driveQueue()) {
      const wait = Math.min(60, 10 * 2 ** Math.max(0, q.attempts - 1)) * 60000;
      if (!force && q.lastTry && Date.now() - Date.parse(q.lastTry) < wait) continue;
      const w = await recopyToDrive(q.workId, '프로그램 (자동 재시도)').catch(() => null);
      const f = w && (w.type === 'image' ? w.image.final : w.video.final);
      if (f?.drive?.status === 'failed') mutate(q.workId, '프로그램', x => { const d = (x.type === 'image' ? x.image.final : x.video.final).drive; d.attempts = q.attempts + 1; d.lastTry = new Date().toISOString(); return null; });
      done.push({ workId: q.workId, status: f?.drive?.status || 'error' });
    }
  } finally { pumping = false; }
  return done;
}
