// 파일 저장 공통: 이미지 형식 확인, 내려받기, 작업 폴더
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './store.js';

export const REF_DIR = path.join(DATA_DIR, 'refs');
export const WORK_DIR = path.join(DATA_DIR, 'works');
export const workDir = id => { const d = path.join(WORK_DIR, String(id).toUpperCase()); fs.mkdirSync(d, { recursive: true }); return d; };

// 파일 앞부분으로 실제 형식을 확인한다 (확장자만 믿지 않는다)
export function sniff(buf) {
  const b = buf.subarray(0, 16);
  const hex = b.toString('hex');
  if (hex.startsWith('ffd8ff')) return { ext: '.jpg', mime: 'image/jpeg', kind: 'image' };
  if (hex.startsWith('89504e47')) return { ext: '.png', mime: 'image/png', kind: 'image' };
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return { ext: '.webp', mime: 'image/webp', kind: 'image' };
  if (b.toString('ascii', 0, 3) === 'GIF') return { ext: '.gif', mime: 'image/gif', kind: 'image' };
  if (b.toString('ascii', 4, 8) === 'ftyp') {
    const brand = b.toString('ascii', 8, 12);
    if (/^(avif|avis)/.test(brand)) return { ext: '.avif', mime: 'image/avif', kind: 'image' };
    if (/^(heic|heix|mif1|msf1|hevc)/.test(brand)) return { ext: '.heic', mime: 'image/heic', kind: 'image' };
    if (/^qt/.test(brand)) return { ext: '.mov', mime: 'video/quicktime', kind: 'video' };
    return { ext: '.mp4', mime: 'video/mp4', kind: 'video' };
  }
  if (hex.startsWith('1a45dfa3')) return { ext: '.webm', mime: 'video/webm', kind: 'video' };
  return null;
}

export const MAX_DOWNLOAD = 80 * 1024 * 1024;

// 주소에서 이미지를 받아온다 (Higgsfield 결과 등). 이미지가 아니면 거절한다.
export async function download(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`주소 형식이 잘못됐어요: ${url}`); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('http 또는 https 주소만 받을 수 있어요.');
  const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`이미지를 받지 못했어요 (${r.status}): ${url}`);
  const len = Number(r.headers.get('content-length') || 0);
  if (len > MAX_DOWNLOAD) throw new Error('이미지가 너무 커요 (80MB 초과).');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD) throw new Error('이미지가 너무 커요 (80MB 초과).');
  return buf;
}

export function readLocal(p) {
  const abs = path.resolve(String(p).replace(/^~(?=\/|$)/, process.env.HOME || ''));
  const st = fs.statSync(abs, { throwIfNoEntry: false });
  if (!st || !st.isFile()) throw new Error(`파일을 찾을 수 없어요: ${p}`);
  if (st.size > MAX_DOWNLOAD) throw new Error('파일이 너무 커요 (80MB 초과).');
  return fs.readFileSync(abs);
}

// SVG 구도 시안을 안전하게 만든다 (스크립트, 이벤트, 외부 연결 제거)
export function cleanSvg(svg) {
  let s = String(svg || '').trim();
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) throw new Error('구도 시안은 <svg>로 시작해서 </svg>로 끝나야 해요.');
  if (s.length > 300_000) throw new Error('구도 시안 SVG가 너무 커요 (300KB 이하).');
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*("|')\s*(?!#)[^"']*\1/gi, '');
  if (!/\sxmlns=/.test(s.slice(0, 300))) s = s.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return s;
}
