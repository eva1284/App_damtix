// 최종 컨펌 뒤 처리: 용량 최적화 → 내 Mac 폴더에 정리 → Google Drive에 복사
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { load, save } from './store.js';
import { workDir } from './files.js';
import { resolveFolder } from './images.js';

export const DEFAULT_FINALS = '완성본 (contents controller)';
const LANG_CODE = { GLOBAL: 'en', JP: 'ja', EU: 'fr' };
const nfc = s => String(s ?? '').normalize('NFC');

// Google Drive 데스크톱 앱이 만든 폴더 후보 (~/Library/CloudStorage/GoogleDrive-계정/내 드라이브)
export function driveCandidates() {
  const base = path.join(os.homedir(), 'Library', 'CloudStorage');
  const out = [];
  try {
    for (const d of fs.readdirSync(base, { withFileTypes: true })) {
      if (!d.isDirectory() || !d.name.startsWith('GoogleDrive-')) continue;
      for (const inner of fs.readdirSync(path.join(base, d.name), { withFileTypes: true })) {
        if (inner.isDirectory() && ['내 드라이브', 'My Drive'].includes(nfc(inner.name))) out.push(path.join(base, d.name, inner.name));
      }
    }
  } catch { /* Google Drive 데스크톱 앱 없음 */ }
  return out;
}

export function finalsConfig() {
  const c = load('config');
  let changed = false;
  if (!c.finalsFolder) { c.finalsFolder = DEFAULT_FINALS; changed = true; }
  if (c.driveFolder === undefined) { c.driveFolder = driveCandidates()[0] || ''; changed = true; }
  if (changed) save('config', c);
  return { finalsFolder: c.finalsFolder, driveFolder: c.driveFolder, imageRoot: c.imageRoot };
}

export function setFinals({ finalsFolder, driveFolder }) {
  const c = load('config');
  if (typeof finalsFolder === 'string' && finalsFolder.trim()) {
    if (/[/\\]/.test(finalsFolder)) throw new Error('완성본 폴더 이름에는 / 를 넣을 수 없어요.');
    c.finalsFolder = finalsFolder.trim();
  }
  if (typeof driveFolder === 'string') c.driveFolder = driveFolder.trim().replace(/^~(?=\/|$)/, os.homedir());
  save('config', c);
}

// 인스타그램용: 긴 변 기준 가로 1080px, sRGB, JPEG 품질 85, 촬영 정보 제거
export async function optimizeImage(src, dest) {
  const before = fs.statSync(src).size;
  const info = await sharp(src).rotate().resize({ width: 1080, withoutEnlargement: true }).toColorspace('srgb').jpeg({ quality: 85, mozjpeg: true }).toFile(dest);
  return { before, after: info.size, width: info.width, height: info.height };
}

const captionFile = (w) => {
  const c = w.caption?.current;
  if (!c) return null;
  const tags = c.hashtags.map(h => h.tag).join(' ');
  const ments = c.mentions.map(m => m.handle).join(' ');
  return {
    original: [c.text, '', tags, ments].join('\n').trim() + '\n',
    korean: [c.back, '', c.hashtags.map(h => `${h.tag} (${h.ko})`).join(' '), c.mentions.map(m => `${m.handle} (${m.ko})`).join(' ')].join('\n').trim() + '\n'
  };
};

// 같은 이름의 폴더가 이미 있으면 (NFC/NFD 무시) 그 폴더를 쓰고, 없으면 만든다
function ensureDir(parent, name) {
  const hit = resolveFolder(parent, name);
  if (hit) return hit;
  const p = path.join(parent, name);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export async function finalizeImages(w, resultIds) {
  const { finalsFolder, driveFolder, imageRoot } = finalsConfig();
  if (!fs.existsSync(imageRoot)) throw new Error(`이미지 폴더를 찾을 수 없어요: ${imageRoot}. 홈 화면에서 경로를 확인해 주세요.`);
  const acc = w.account === 'SHOP' ? w.store : w.account;
  const folderName = `${w.date}_${w.id}`;
  const macDir = ensureDir(ensureDir(ensureDir(imageRoot, finalsFolder), acc), folderName);
  const src = workDir(w.id);
  const files = [];
  let n = 0;
  for (const id of resultIds) {
    const r = w.image.results.find(x => x.id === id);
    if (!r) throw new Error(`결과 ${id}를 찾을 수 없어요.`);
    n += 1;
    const name = `${w.id}_${acc}_${w.product}_${String(n).padStart(2, '0')}.jpg`;
    files.push({ name, ...(await optimizeImage(path.join(src, r.file), path.join(macDir, name))) });
  }
  const cap = captionFile(w);
  if (cap) {
    fs.writeFileSync(path.join(macDir, `caption_${LANG_CODE[w.account] || 'xx'}.txt`), cap.original);
    fs.writeFileSync(path.join(macDir, 'caption_ko.txt'), cap.korean);
  }
  let drive = { status: 'off', path: '' };
  if (driveFolder) {
    if (!fs.existsSync(driveFolder)) drive = { status: 'missing', path: driveFolder };
    else {
      const dDir = ensureDir(ensureDir(ensureDir(driveFolder, finalsFolder), acc), folderName);
      for (const f of fs.readdirSync(macDir)) fs.copyFileSync(path.join(macDir, f), path.join(dDir, f));
      drive = { status: 'copied', path: dDir };
    }
  }
  return { at: new Date().toISOString(), folder: macDir, files, caption: !!cap, drive };
}
