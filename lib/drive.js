// Google Drive 복사. Mac의 Google Drive 앱 폴더(~/Library/CloudStorage/GoogleDrive-…)는
// 동기화 중이거나 폴더를 아직 내려받지 않았을 때 잠깐 거절하는 경우가 있어서(Unknown system error -11 등)
// 잠깐 기다렸다가 다시 시도한다. 끝내 안 되면 최종 처리는 끝난 것으로 두고 Drive만 '실패'로 남긴다.
import fs from 'node:fs';
import path from 'node:path';
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
    return { status: 'failed', error: friendly(e), path: paths[0] || '', paths };
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
    f.drive = drive;
    return drive.status === 'copied' ? 'Google Drive에 다시 복사했어요' : drive.status === 'failed' ? `Google Drive 복사 실패: ${drive.error}` : drive.status === 'missing' ? 'Drive 폴더를 찾을 수 없어요' : 'Drive 복사가 꺼져 있어요';
  });
}
