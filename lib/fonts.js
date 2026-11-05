// 자막 글꼴: 앱에 들어 있는 글꼴(assets/fonts) + 사용자가 추가한 글꼴(data/fonts)
// 영상에 자막을 입힐 때 이 폴더 하나만 보고 글꼴을 찾는다.
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, DATA_DIR } from './store.js';

export const BUNDLED_DIR = path.join(APP_DIR, 'assets', 'fonts');
export const FONT_DIR = path.join(DATA_DIR, 'fonts');
const FONT_RE = /\.(ttf|otf)$/i;

// 앱에 들어 있는 글꼴을 data/fonts에 연결해 둔다 (복사 대신 바로가기, 안 되면 복사)
export function syncFonts() {
  fs.mkdirSync(FONT_DIR, { recursive: true });
  if (!fs.existsSync(BUNDLED_DIR)) return;
  for (const f of fs.readdirSync(BUNDLED_DIR).filter(n => FONT_RE.test(n))) {
    const dest = path.join(FONT_DIR, f);
    if (fs.existsSync(dest)) continue; // 바로가기가 살아 있거나 사용자가 같은 이름으로 넣은 파일
    try { fs.rmSync(dest, { force: true }); } catch { /* 끊어진 바로가기 */ }
    try { fs.symlinkSync(path.join(BUNDLED_DIR, f), dest); } catch { fs.copyFileSync(path.join(BUNDLED_DIR, f), dest); }
  }
}

// 글꼴 파일의 이름표(name 표)와 굵기(OS/2 표)를 읽는다
export function readFontInfo(buf) {
  const tag = buf.toString('latin1', 0, 4);
  if (!['\0\x01\0\0', 'OTTO', 'true'].includes(tag)) throw new Error('ttf나 otf 글꼴 파일만 넣을 수 있어요.');
  const n = buf.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    tables[buf.toString('latin1', o, o + 4)] = buf.readUInt32BE(o + 8);
  }
  if (tables.name === undefined) throw new Error('글꼴 이름을 읽을 수 없는 파일이에요.');
  const t = tables.name;
  const count = buf.readUInt16BE(t + 2), strings = t + buf.readUInt16BE(t + 4);
  const names = {};
  for (let i = 0; i < count; i++) {
    const r = t + 6 + i * 12;
    const platform = buf.readUInt16BE(r), lang = buf.readUInt16BE(r + 4), id = buf.readUInt16BE(r + 6);
    const len = buf.readUInt16BE(r + 8), off = strings + buf.readUInt16BE(r + 10);
    if (![1, 2, 4, 6, 16, 17].includes(id)) continue;
    let s;
    if (platform === 3 || platform === 0) {
      if (platform === 3 && lang !== 0x409 && names[id]) continue; // 영어 이름을 먼저 쓴다
      const b = Buffer.from(buf.subarray(off, off + len)); b.swap16(); s = b.toString('utf16le');
    } else if (platform === 1 && !names[id]) s = buf.toString('latin1', off, off + len);
    if (s && (!names[id] || (platform === 3 && lang === 0x409))) names[id] = s;
  }
  const weight = tables['OS/2'] !== undefined ? buf.readUInt16BE(tables['OS/2'] + 4) : 400;
  const sub = (names[17] || names[2] || '').toLowerCase();
  return { family: names[16] || names[1], full: names[4] || names[1], postscript: names[6] || '', weight, italic: /italic|oblique/.test(sub) };
}

let cache = null;
export function listFaces() {
  syncFonts();
  const files = fs.readdirSync(FONT_DIR).filter(n => FONT_RE.test(n)).sort();
  const key = files.map(f => { try { return f + fs.statSync(path.join(FONT_DIR, f)).size; } catch { return f; } }).join('|');
  if (cache?.key === key) return cache.faces;
  const faces = [];
  for (const f of files) {
    try { faces.push({ ...readFontInfo(fs.readFileSync(path.join(FONT_DIR, f))), file: f, bundled: fs.existsSync(path.join(BUNDLED_DIR, f)) }); } catch { /* 읽을 수 없는 파일은 건너뛴다 */ }
  }
  cache = { key, faces };
  return faces;
}

// 화면용: 글꼴 이름과 들어 있는 굵기
export function listFonts() {
  const fam = new Map();
  for (const f of listFaces().filter(x => !x.italic)) {
    const e = fam.get(f.family) || { family: f.family, weights: [], bundled: true };
    if (!e.weights.includes(f.weight)) e.weights.push(f.weight);
    e.bundled &&= f.bundled;
    fam.set(f.family, e);
  }
  return [...fam.values()].map(e => ({ ...e, weights: e.weights.sort((a, b) => a - b) })).sort((a, b) => a.family.localeCompare(b.family));
}

// 원하는 굵기에 가장 가까운 글꼴 (자막을 입힐 때 이 글꼴의 전체 이름으로 부른다)
export function pickFace(family, weight = 400) {
  const faces = listFaces().filter(f => f.family === family && !f.italic);
  if (!faces.length) return null;
  return faces.reduce((a, b) => (Math.abs(b.weight - weight) < Math.abs(a.weight - weight) ? b : a));
}

export function addFont(filename, buf) {
  if (!buf?.length) throw new Error('빈 파일이에요.');
  if (buf.length > 40 * 1024 * 1024) throw new Error('글꼴 파일이 너무 커요 (40MB 이하).');
  const ext = FONT_RE.exec(String(filename || ''))?.[1]?.toLowerCase();
  if (!ext) throw new Error('ttf나 otf 글꼴 파일만 넣을 수 있어요. (woff·woff2는 안 돼요)');
  const info = readFontInfo(buf);
  if (!info.family) throw new Error('글꼴 이름을 읽을 수 없는 파일이에요.');
  syncFonts();
  const safe = path.basename(String(filename)).normalize('NFC').replace(/[^\p{L}\p{N}._ -]/gu, '_');
  const dest = path.join(FONT_DIR, safe);
  if (fs.existsSync(path.join(BUNDLED_DIR, safe))) throw new Error('앱에 이미 들어 있는 글꼴이에요.');
  fs.writeFileSync(dest, buf);
  cache = null;
  return { family: info.family, weight: info.weight, file: safe };
}
