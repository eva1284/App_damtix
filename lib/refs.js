// 레퍼런스 보관함: 인터넷에서 찾은 이미지·영상·링크. 작업물(또는 컷·섹션)에 연결하고 Claude가 분석한다.
import fs from 'node:fs';
import path from 'node:path';
import { load, save } from './store.js';
import { REF_DIR, sniff } from './files.js';

const all = () => load('refs');
const now = () => new Date().toISOString();

export function sourceOf(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    if (/instagram\./.test(h)) return 'Instagram';
    if (/tiktok\./.test(h)) return 'TikTok';
    if (/youtu\.?be/.test(h)) return 'YouTube';
    if (/pinterest\.|pin\.it/.test(h)) return 'Pinterest';
    return h;
  } catch { return '링크'; }
}

function nextId(list) {
  const n = Math.max(0, ...list.map(r => Number(r.id.split('-')[1]) || 0)) + 1;
  return `REF-${String(n).padStart(3, '0')}`;
}
function find(list, id) {
  const r = list.find(x => x.id === String(id).toUpperCase());
  if (!r) throw new Error(`레퍼런스 ${id}를 찾을 수 없어요.`);
  return r;
}
const linkWork = (r, work) => { if (work && !r.links.some(l => l.work === work && !l.part)) r.links.push({ work, part: '' }); };

export const listRefs = () => all();
export const getRef = id => find(all(), id);
export const refPath = r => (r.file ? path.join(REF_DIR, r.file) : null);
export const refsFor = work => all().filter(r => r.links.some(l => l.work === work));

export function addFileRef({ buffer, filename, work }) {
  const kind = sniff(buffer);
  if (!kind) throw new Error('이미지(jpg, png, webp, gif, heic, avif)나 영상(mp4, mov, webm) 파일만 넣을 수 있어요.');
  const list = all();
  const id = nextId(list);
  fs.mkdirSync(REF_DIR, { recursive: true });
  const file = `${id}${kind.ext}`;
  fs.writeFileSync(path.join(REF_DIR, file), buffer);
  const r = { id, kind: kind.kind, source: '파일', title: String(filename || file).normalize('NFC').slice(0, 120), url: '', file, mime: kind.mime, size: buffer.length, memo: '', tags: [], status: 'wait', analysis: '', links: [], createdAt: now() };
  linkWork(r, work);
  list.unshift(r);
  save('refs', list);
  return r;
}

export function addUrlRef({ url, work }) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) throw new Error('http로 시작하는 주소를 넣어 주세요.');
  const list = all();
  const dup = list.find(r => r.url === u);
  if (dup) { linkWork(dup, work); save('refs', list); return dup; }
  const src = sourceOf(u);
  const r = { id: nextId(list), kind: ['TikTok', 'YouTube'].includes(src) ? 'video' : 'link', source: src, title: `${src} 레퍼런스`, url: u, file: '', mime: '', size: 0, memo: '', tags: [], status: 'wait', analysis: '', links: [], createdAt: now() };
  linkWork(r, work);
  list.unshift(r);
  save('refs', list);
  return r;
}

export function updateRef(id, { memo, title }) {
  const list = all();
  const r = find(list, id);
  if (typeof memo === 'string') r.memo = memo.trim().slice(0, 300);
  if (typeof title === 'string' && title.trim()) r.title = title.trim().slice(0, 120);
  save('refs', list);
  return r;
}

export function link(id, work, part = '') {
  const list = all();
  const r = find(list, id);
  if (!r.links.some(l => l.work === work && l.part === part)) r.links.push({ work, part });
  save('refs', list);
  return r;
}

export function unlink(id, work, part) {
  const list = all();
  const r = find(list, id);
  r.links = r.links.filter(l => !(l.work === work && (part === undefined || l.part === part)));
  save('refs', list);
  return r;
}

export function deleteRef(id) {
  const list = all();
  const r = find(list, id);
  if (r.file) fs.rmSync(path.join(REF_DIR, r.file), { force: true });
  save('refs', list.filter(x => x !== r));
  return { id: r.id };
}

export function dropWorkLinks(work) {
  const list = all();
  for (const r of list) r.links = r.links.filter(l => l.work !== work);
  save('refs', list);
}

export function submitAnalysis({ id, summary, tags, title }) {
  const list = all();
  const r = find(list, id);
  const s = String(summary || '').trim();
  if (!s) throw new Error('분석 내용(한국어)이 비어 있어요.');
  r.analysis = s.slice(0, 2000);
  if (Array.isArray(tags)) r.tags = tags.map(t => String(t).trim()).filter(Boolean).slice(0, 8);
  if (title && String(title).trim()) r.title = String(title).trim().slice(0, 120);
  r.status = 'done';
  r.analyzedAt = now();
  save('refs', list);
  return r;
}
