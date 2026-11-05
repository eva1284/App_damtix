// 영상 제작 흐름
// 스토리보드 맡기기 → Claude가 컷 구성 제출 → 검수(컷에 이미지 작업 연결) → 편집 방식 선택
//   · Claude가 편집: Claude가 영상 제출 · 내가 CapCut에서 편집: 내보낸 영상을 올림
// → 타임라인 메모로 검수 → 수정 또는 영상 컨펌 → 자막(나라별, Claude는 글자만 씀) 검수 → 최종 컨펌
// → 프로그램이 나라별로 자막을 입혀 최적화하고 Mac 폴더·Google Drive에 저장 (토큰 안 씀)
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { load } from './store.js';
import { getWork, mutate, marketOf, createWork } from './works.js';
import { setCuts, requestDrafts } from './imagework.js';
import { ACCOUNTS, checkText } from './rules.js';
import { workDir, sniff, download, readLocal, cleanSvg } from './files.js';
import { probe, frame, encode, toSrt } from './media.js';
import { subtitleStyle, toAss, decideColors, still, COLOR_MODES, lineLimit } from './subtitles.js';
import { finalsConfig } from './finalize.js';
import { copyToDrive } from './drive.js';
import { buildComposition, renderMotion, renderStill, getTemplate } from './motion.js';
import { buildEdl, renderEdl, timeline as edlTimeline, mapTime } from './edl.js';
import { decode, analyze, loadLayer, toMono, ARATE } from './audio.js';
import { resolveFolder } from './images.js';

export const VIDEO_STAGE = {
  none: '시작 전',
  story_requested: 'Claude가 스토리보드 만들 차례',
  story_fix: 'Claude가 스토리보드 고칠 차례',
  story_review: '스토리보드 검수할 차례',
  make: 'Claude가 영상 편집할 차례',
  make_fix: 'Claude가 영상 고칠 차례',
  edit_me: 'CapCut에서 편집해서 올릴 차례',
  rendering: '프로그램이 모션 그래픽 영상 만드는 중',
  result_review: '영상 검수할 차례',
  video_ok: '영상 컨펌 · 자막 단계',
  finalizing: '최종 처리 중',
  done: '최종 완료'
};
export const SUB_STATUS = { none: '자막 없음', requested: 'Claude가 자막 쓸 차례', fix: 'Claude가 자막 고칠 차례', review: '자막 검수할 차례', confirmed: '자막 컨펌됨' };
export const VIDEO_CLAUDE = ['story_requested', 'story_fix', 'make', 'make_fix'];
export const VIDEO_MINE = ['story_review', 'edit_me', 'result_review'];
const MAX_VIDEO = 1024 * 1024 * 1024; // 1GB

const now = () => new Date().toISOString();
const text = (v, max = 1000) => String(v ?? '').trim().slice(0, max);
const blank = w => ({ stage: 'none', method: 'claude', request: null, story: null, storyHistory: [], videos: [], notes: [], fixes: [], round: 0, versions: [w.account], subs: { status: 'none', tracks: {}, fixes: [] }, final: null, job: null, error: '' });
export const videoOf = w => w.video || blank(w);

function prep(w, allowed) {
  if (w.type !== 'video') throw new Error('영상 작업에서만 쓸 수 있어요.');
  if (!w.video) w.video = blank(w);
  if (allowed && !allowed.includes(w.video.stage)) throw new Error(`${w.id}는 지금 이 단계가 아니에요 (${VIDEO_STAGE[w.video.stage]}).`);
  return w.video;
}
const num = (v, name) => { const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error(`${name} 시간이 잘못됐어요.`); return Math.round(n * 100) / 100; };

/* ---------- 스토리보드 ---------- */
export function requestStory(id, note, by = '화면') {
  return mutate(id, by, w => {
    const v = prep(w, ['none', 'done']);
    if (v.stage === 'done') { v.storyHistory.unshift({ at: now(), story: v.story, videos: v.videos, final: v.final }); v.story = null; v.videos = []; v.notes = []; v.final = null; v.motion = null; v.subs = { status: 'none', tracks: {}, fixes: [] }; }
    v.stage = 'story_requested';
    v.request = { note: text(note), at: now() };
    return '스토리보드를 Claude에게 맡겼어요';
  });
}

export function submitStory(id, { cuts, note }, by = 'Claude') {
  if (!Array.isArray(cuts) || cuts.length < 1 || cuts.length > 30) throw new Error('컷은 1~30개 보내 주세요.');
  const clean = cuts.map((c, i) => {
    const start = num(c.start, `${i + 1}번 컷 시작`), end = num(c.end, `${i + 1}번 컷 끝`);
    if (end <= start) throw new Error(`${i + 1}번 컷의 끝 시간이 시작보다 빨라요.`);
    const desc = text(c.desc, 400);
    if (!desc) throw new Error(`${i + 1}번 컷 설명(desc)이 비어 있어요.`);
    return { start, end, desc, kind: c.kind === 'motion' ? 'motion' : 'footage', camera: text(c.camera, 120), text: text(c.text, 200), back: text(c.back, 200), fromImage: text(c.from_image || c.fromImage, 300).toUpperCase().replace(/\s+/g, ''), svg: c.svg ? cleanSvg(c.svg) : null };
  });
  return mutate(id, by, w => {
    const v = prep(w, ['story_requested', 'story_fix']);
    v.round += 1;
    const dir = workDir(w.id);
    if (v.story) v.storyHistory.unshift({ at: now(), story: v.story });
    v.story = {
      round: v.round, note: text(note), at: now(),
      cuts: clean.map((c, i) => {
        let sketch = '';
        if (c.svg) { sketch = `cut-${v.round}-${i + 1}.svg`; fs.writeFileSync(path.join(dir, sketch), c.svg); }
        const { svg, ...rest } = c;
        return { id: `C${i + 1}`, ...rest, sketch };
      })
    };
    const wasFix = v.stage === 'story_fix';
    v.stage = 'story_review';
    return `${wasFix ? '고친 ' : ''}스토리보드 ${clean.length}컷이 들어왔어요`;
  });
}

// 영상 컷에 쓸 이미지 연결. 한 컷에 여러 장도 된다: 'IMG-002:C5-1,IMG-002:C5-2' 또는 배열.
// 스토리보드 검수부터 영상 검수까지 언제든 바꿀 수 있다 (화면에서도, Claude도).
export function setCutImage(id, cutId, imageWorkId, by = '화면') {
  const list = (Array.isArray(imageWorkId) ? imageWorkId : String(imageWorkId || '').split(',')).map(x => String(x).trim().toUpperCase()).filter(Boolean);
  return mutate(id, by, w => {
    const v = prep(w, ['story_review', 'make', 'make_fix', 'edit_me', 'result_review']);
    const c = v.story?.cuts.find(x => x.id === String(cutId).toUpperCase());
    if (!c) throw new Error(`컷 ${cutId}를 찾을 수 없어요. 컷: ${(v.story?.cuts || []).map(x => x.id).join(', ')}`);
    for (const img of list) {
      const [iid, icut] = img.split(':');
      const iw = load('works').find(x => x.id === iid);
      if (!iw || iw.type !== 'image') throw new Error(`이미지 작업 ${iid}를 찾을 수 없어요.`);
      if (icut && !(iw.image?.cuts || []).some(c => c.id === icut)) throw new Error(`${iid}에 ${icut} 컷이 없어요.`);
      const p = load('products').find(x => x.code === iw.product);
      if (p && !p.markets[marketOf(w)]) throw new Error(`${img}의 제품은 이 영상의 시장에서 팔지 않아요.`);
    }
    c.fromImage = list.join(',');
    return list.length ? `${c.id}에 ${list.join(', ')}를 넣었어요` : `${c.id}에서 이미지를 뺐어요`;
  });
}

// 스토리보드의 컷마다 이미지를 만들 이미지 작업을 하나 만들고, 컷끼리 연결한다 (컷 1 ↔ IMG-005:C1 …)
export function createCutImages(id, cutIds, by = '화면') {
  const w0 = getWork(id);
  const v0 = prep(w0, ['story_review']);
  const cuts = v0.story.cuts.filter(c => !cutIds?.length || cutIds.includes(c.id));
  if (!cuts.length) throw new Error('이미지로 만들 컷을 골라 주세요.');
  const img = createWork({ type: 'image', account: w0.account, product: w0.product, date: w0.date, title: `${w0.title} · 컷 이미지`.slice(0, 80), memo: `${w0.id} 영상 스토리보드의 컷 이미지 (9:16, 컷끼리 같은 인물·조명·톤으로 이어지게)` }, by);
  setCuts(img.id, cuts.map(c => ({ title: `${c.id} · ${c.desc.slice(0, 40)}`, desc: [c.desc, c.camera && `카메라: ${c.camera}`, c.text && `화면 글자: ${c.text} (${c.back})`].filter(Boolean).join(' / '), from: `${w0.id}:${c.id}` })), by);
  requestDrafts(img.id, `${w0.id} 영상의 ${cuts.length}컷 스토리보드. 컷마다 9:16 구도 시안(viewBox 0 0 1080 1920)을 보내 주세요.`, by);
  mutate(id, by, w => {
    const v = prep(w, ['story_review']);
    cuts.forEach((c, i) => { const vc = v.story.cuts.find(x => x.id === c.id); vc.fromImage = `${img.id}:C${i + 1}`; });
    return `컷 이미지 작업 ${img.id}를 만들었어요 (${cuts.length}컷)`;
  });
  return getWork(img.id);
}

export function fixStory(id, note, by = '화면') {
  const n = text(note);
  if (!n) throw new Error('무엇을 고칠지 한국어로 적어 주세요.');
  return mutate(id, by, w => {
    const v = prep(w, ['story_review']);
    v.fixes.unshift({ kind: 'story', note: n, at: now() });
    v.stage = 'story_fix';
    return `스토리보드 수정 요청: ${n}`;
  });
}

export function approveStory(id, method, by = '화면') {
  if (!['claude', 'capcut'].includes(method)) throw new Error('편집 방식을 골라 주세요.');
  return mutate(id, by, w => {
    const v = prep(w, ['story_review']);
    v.method = method;
    v.stage = method === 'claude' ? 'make' : 'edit_me';
    return method === 'claude' ? '스토리보드 승인 · Claude가 편집' : '스토리보드 승인 · CapCut에서 직접 편집';
  });
}

export function setMethod(id, method, by = '화면') {
  if (!['claude', 'capcut'].includes(method)) throw new Error('편집 방식을 골라 주세요.');
  return mutate(id, by, w => {
    const v = prep(w, ['make', 'make_fix', 'edit_me']);
    const fixing = v.stage === 'make_fix' || (v.stage === 'edit_me' && v.fixes[0]?.kind === 'video' && v.videos.length);
    v.method = method;
    v.stage = method === 'claude' ? (fixing ? 'make_fix' : 'make') : 'edit_me';
    return method === 'claude' ? '편집 방식 변경: Claude가 편집' : '편집 방식 변경: CapCut에서 직접 편집';
  });
}

/* ---------- 영상 받기 ---------- */
async function addVideo(id, buffer, srcPath, source, note, by) {
  const w0 = getWork(id);
  const v0 = prep(w0, ['make', 'make_fix', 'edit_me']);
  const dir = workDir(w0.id);
  const round = v0.round + 1;
  const tmp = path.join(dir, `incoming-${Date.now()}`);
  if (buffer) fs.writeFileSync(tmp, buffer); else fs.copyFileSync(srcPath, tmp);
  const head = Buffer.alloc(16); const fd = fs.openSync(tmp, 'r'); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd);
  const kind = sniff(head);
  if (!kind || kind.kind !== 'video') { fs.rmSync(tmp, { force: true }); throw new Error('영상 파일(mp4, mov, webm)만 받을 수 있어요.'); }
  let info;
  try { info = await probe(tmp); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  const file = `video-${round}${kind.ext}`;
  fs.renameSync(tmp, path.join(dir, file));
  return mutate(id, by, w => {
    const v = prep(w, ['make', 'make_fix', 'edit_me']);
    v.round = round;
    v.videos.unshift({ id: `V${round}`, file, duration: info.duration, width: info.width, height: info.height, audio: info.audio, source, note: text(note), at: now() });
    v.notes = [];
    v.stage = 'result_review';
    return `${source === 'upload' ? '편집한 영상을 올렸어요' : '영상이 들어왔어요'} (${info.duration.toFixed(1)}초, ${info.width}×${info.height})`;
  });
}
export const uploadVideo = (id, tmpPath, by = '화면') => addVideo(id, null, tmpPath, 'upload', '', by);
export async function submitVideo(id, { url, path: p, note }, by = 'Claude') {
  if (url) return addVideo(id, await download(url, MAX_VIDEO), null, 'claude', note, by);
  if (p) { const abs = path.resolve(String(p).replace(/^~(?=\/|$)/, process.env.HOME || '')); if (!fs.existsSync(abs)) throw new Error(`파일을 찾을 수 없어요: ${p}`); return addVideo(id, null, abs, 'claude', note, by); }
  throw new Error('url이나 path 중 하나를 주세요.');
}

/* ---------- 타임라인 검수 ---------- */
// 메모 대상: 화면 / 클립 원본 소리 / 효과음(어떤 효과음) / 자막
export const NOTE_TARGETS = { screen: '화면', clip: '클립 원본 소리', sfx: '효과음', subtitle: '자막' };
// 완성 영상 시각 → [컷, 그 컷 원본의 시각] (EDL이나 모션 그래픽 재료 기준)
export function locate(v, t) {
  const vid = v.videos?.[0];
  if (vid?.edl) { try { return mapTime(vid.edl, t); } catch { return null; } }
  const comp = vid?.source === 'motion' ? (vid.comp || v.motion?.comp) : null;
  if (comp?.clips?.length) {
    const c = [...comp.clips].reverse().find(x => t >= x.at && (x.duration == null || t < x.at + x.duration));
    if (c) return { cut: `clip ${comp.clips.indexOf(c) + 1}`, src: Math.round((c.from + t - c.at) * 100) / 100, clip: c.src };
  }
  return null;
}
export function saveNotes(id, notes, by = '화면') {
  if (!Array.isArray(notes) || notes.length > 60) throw new Error('메모는 60개까지 남길 수 있어요.');
  return mutate(id, by, w => {
    const v = prep(w, ['result_review']);
    const dur = v.videos[0]?.duration || 0;
    const sfx = v.videos[0]?.edl?.sfx || [];
    v.notes = notes.map((n, i) => {
      const t = Math.min(dur, num(n.t, `${i + 1}번 메모`));
      const t2 = n.t2 === null || n.t2 === undefined || n.t2 === '' ? null : Math.min(dur, num(n.t2, `${i + 1}번 메모 끝`));
      const target = NOTE_TARGETS[n.target] ? n.target : 'screen';
      const out = { t, t2: t2 !== null && t2 > t ? t2 : null, text: text(n.text, 300), target };
      const at = locate(v, t);
      if (at) out.at = at;
      if (target === 'sfx') {
        const s = n.sfx ? sfx.find(x => x.id === n.sfx) : sfx.reduce((b, x) => (Math.abs(x.at - t) < 1 && (!b || Math.abs(x.at - t) < Math.abs(b.at - t)) ? x : b), null);
        if (s) out.sfx = { id: s.id, name: s.name, at: s.at };
      }
      return out;
    }).sort((a, b) => a.t - b.t);
    return null; // 메모는 자주 저장되니 기록에 남기지 않는다
  });
}

// 보낸 수정 요청을 Claude가 고치기 전까지 고치거나 지운다
export function editFix(id, { note, notes }, by = '화면') {
  return mutate(id, by, w => {
    const v = prep(w, ['make_fix', 'edit_me']);
    const f = v.fixes[0];
    if (!f || f.kind !== 'video') throw new Error('고칠 수정 요청이 없어요.');
    if (note !== undefined) f.note = text(note);
    if (Array.isArray(notes)) {
      if (notes.length > 60) throw new Error('메모는 60개까지예요.');
      f.notes = notes.map((n, i) => {
        const t = num(n.t, `${i + 1}번 메모`), target = NOTE_TARGETS[n.target] ? n.target : 'screen';
        const old = f.notes.find(x => x.t === t);
        return { ...(old || {}), t, t2: n.t2 != null && Number(n.t2) > t ? num(n.t2, `${i + 1}번 메모 끝`) : null, text: text(n.text, 300), target, at: old?.at || locate(v, t) || undefined };
      }).filter(n => n.text).sort((a, b) => a.t - b.t);
    }
    if (!f.note && !f.notes.length) throw new Error('메모를 다 지우면 수정 요청이 비어요. 요청을 취소하려면 영상 검수로 돌아가 주세요.');
    f.edited = now();
    return `보낸 수정 요청을 고쳤어요 (메모 ${f.notes.length}개)`;
  });
}

export function fixVideo(id, note, by = '화면') {
  return mutate(id, by, w => {
    const v = prep(w, ['result_review']);
    const notes = v.notes.filter(n => n.text);
    const n = text(note);
    if (!n && !notes.length) throw new Error('타임라인에 메모를 남기거나 고칠 점을 적어 주세요.');
    v.fixes.unshift({ kind: 'video', note: n, notes, video: v.videos[0]?.id, at: now() });
    v.stage = v.method === 'claude' ? 'make_fix' : 'edit_me';
    return `영상 수정 요청 (메모 ${notes.length}개)${v.method === 'capcut' ? ' · CapCut에서 고쳐서 다시 올려요' : ''}`;
  });
}

export function approveVideo(id, versions, subs, by = '화면') {
  return mutate(id, by, w => {
    const v = prep(w, ['result_review']);
    const p = load('products').find(x => x.code === w.product);
    const list = [...new Set([w.account, ...(versions || [])])].filter(a => ACCOUNTS[a]);
    for (const a of list) if (!p.markets[ACCOUNTS[a].market]) throw new Error(`${p.names.KR}는 ${a} 시장에서 팔지 않아서 그 버전은 만들 수 없어요.`);
    v.versions = list;
    v.stage = 'video_ok';
    v.subs = subs === false ? { status: 'none', tracks: {}, fixes: [], off: true } : { status: 'requested', tracks: {}, fixes: [], at: now() };
    return `영상 컨펌 · ${list.join(', ')} 버전${subs === false ? ' (자막 없음)' : ' · 자막을 Claude에게 맡겼어요'}`;
  });
}

/* ---------- 자막 (Claude는 글자만, 한 번에 모든 언어) ---------- */
export function submitSubtitles(id, tracks, by = 'Claude') {
  const w0 = getWork(id);
  const v0 = prep(w0);
  if (!['requested', 'fix'].includes(v0.subs.status)) throw new Error(`${w0.id}는 지금 자막을 받을 차례가 아니에요.`);
  const dur = v0.videos[0]?.duration || 0;
  const clean = {};
  for (const acc of v0.versions) {
    const segs = tracks?.[acc];
    if (!Array.isArray(segs) || !segs.length) throw new Error(`${acc}(${ACCOUNTS[acc].lang}) 자막이 없어요. 필요한 언어: ${v0.versions.join(', ')}`);
    clean[acc] = segs.map((s, i) => {
      const start = num(s.start, `${acc} ${i + 1}번 시작`), end = num(s.end, `${acc} ${i + 1}번 끝`);
      if (end <= start) throw new Error(`${acc} ${i + 1}번 자막의 끝이 시작보다 빨라요.`);
      if (dur && start > dur + 0.5) throw new Error(`${acc} ${i + 1}번 자막이 영상 길이(${dur.toFixed(1)}초)를 넘어요.`);
      const t = text(s.text, 200), b = text(s.back, 300);
      if (!t) throw new Error(`${acc} ${i + 1}번 자막이 비어 있어요.`);
      if (!b) throw new Error(`${acc} ${i + 1}번 자막의 한국어 역번역이 없어요.`);
      return { start, end: dur ? Math.min(end, dur) : end, text: t, back: b };
    }).sort((a, b) => a.start - b.start);
    const check = checkText({ text: clean[acc].map(s => s.text).join('\n'), account: acc, product: w0.product });
    const blocks = check.issues.filter(i => i.level === 'block');
    if (blocks.length) throw new Error(`${acc} 자막이 브랜드 기준에 맞지 않아 저장하지 않았어요:\n${blocks.map(i => `- ${i.message}`).join('\n')}`);
  }
  return mutate(id, by, w => {
    const v = prep(w);
    v.subs.tracks = clean;
    // 자막은 줄마다 제품명을 넣지 않으니 일본 판매명 누락 안내는 빼고 보여준다
    v.subs.checks = Object.fromEntries(Object.keys(clean).map(acc => { const c = checkText({ text: clean[acc].map(s => s.text).join('\n'), account: acc, product: w.product }); return [acc, { ...c, issues: c.issues }]; }));
    const wasFix = v.subs.status === 'fix';
    v.subs.status = 'review';
    v.subs.at = now();
    return `${wasFix ? '고친 ' : ''}자막이 들어왔어요 (${Object.keys(clean).join(', ')})`;
  });
}

export function fixSubtitles(id, note, by = '화면') {
  const n = text(note);
  if (!n) throw new Error('무엇을 고칠지 한국어로 적어 주세요.');
  return mutate(id, by, w => {
    const v = prep(w);
    if (v.subs.status !== 'review') throw new Error('검수 중인 자막만 수정 요청할 수 있어요.');
    v.subs.fixes.unshift({ note: n, at: now() });
    v.subs.status = 'fix';
    return `자막 수정 요청: ${n}`;
  });
}

export function confirmSubtitles(id, by = '화면') {
  return mutate(id, by, w => {
    const v = prep(w);
    if (v.subs.status !== 'review') throw new Error('검수 중인 자막만 컨펌할 수 있어요.');
    v.subs.status = 'confirmed';
    return '자막을 컨펌했어요';
  });
}

/* ---------- 최종: 나라별로 자막을 입혀 최적화하고 저장 (프로그램이 처리, 토큰 안 씀) ---------- */
function ensureDir(parent, name) {
  const hit = resolveFolder(parent, name);
  if (hit) return hit;
  const p = path.join(parent, name);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

const jobs = new Map();
// subColor: 'auto'(장면 밝기 보고) | 'white' | 'black'. 비우면 브랜드 기준의 기본값
export function finalConfirmVideo(id, by = '화면', { subColor } = {}) {
  const w0 = getWork(id);
  const v0 = prep(w0, ['video_ok', 'finalizing']);
  if (!v0.subs.off && v0.subs.status !== 'confirmed') throw new Error('자막을 먼저 컨펌해 주세요.');
  if (jobs.has(w0.id)) throw new Error('이미 처리 중이에요.');
  if (subColor && !(subColor in COLOR_MODES)) throw new Error('자막 색은 자동, 흰 글씨, 검정 글씨 중에서 골라 주세요.');
  const w1 = mutate(id, by, w => { const v = prep(w); v.stage = 'finalizing'; v.error = ''; v.subColor = subColor || subtitleStyle().color; v.job = { at: now(), done: 0, total: v.versions.length + 1 }; return `최종 컨펌 · 나라별 영상을 만드는 중${v.subs.off ? '' : ` (자막: ${COLOR_MODES[v.subColor]})`}`; });
  const job = runFinal(w1.id).catch(e => {
    mutate(w1.id, '프로그램', w => { const v = prep(w); v.stage = 'video_ok'; v.error = e.message; v.job = null; return `최종 처리 실패: ${e.message}`; });
  }).finally(() => jobs.delete(w1.id));
  jobs.set(w1.id, job);
  return w1;
}
export const waitFinal = id => jobs.get(String(id).toUpperCase()) || Promise.resolve();

async function runFinal(id) {
  const w = getWork(id);
  const v = videoOf(w);
  const { finalsFolder, driveFolder, imageRoot } = finalsConfig();
  if (!fs.existsSync(imageRoot)) throw new Error(`이미지 폴더를 찾을 수 없어요: ${imageRoot}`);
  const src = path.join(workDir(w.id), v.videos[0].file);
  const base = ensureDir(imageRoot, finalsFolder);
  const step = () => mutate(id, '프로그램', x => { prep(x).job.done += 1; return null; });
  const outputs = [];
  const style = subtitleStyle();
  const dims = await probe(src);
  const tmpDir = fs.mkdtempSync(path.join(workDir(w.id), 'tmp-'));
  // 자막 없는 원본(클린본)은 대표 계정 폴더에
  const mainDir = ensureDir(ensureDir(base, w.account), `${w.date}_${w.id}`);
  const clean = `${w.id}_${w.product}_clean.mp4`;
  outputs.push({ account: w.account, dir: mainDir, file: clean, kind: 'clean', ...(await encode(src, path.join(mainDir, clean))) });
  step();
  for (const acc of v.versions) {
    const dir = ensureDir(ensureDir(base, acc), `${w.date}_${w.id}`);
    const segs = v.subs.off ? null : v.subs.tracks[acc];
    const name = `${w.id}_${acc}_${w.product}.mp4`;
    const vsrc = await versionSource(w, v, acc, src, tmpDir);
    const colors = segs ? await decideColors(vsrc, segs, style, v.subColor, dims) : [];
    const ass = segs ? toAss(segs, { style, account: acc, width: dims.width, height: dims.height, colors }) : null;
    outputs.push({ account: acc, dir, file: name, kind: 'version', ...(segs ? { subColors: { white: colors.filter(c => c === 'white').length, black: colors.filter(c => c === 'black').length } } : {}), ...(await encode(vsrc, path.join(dir, name), { ass })) });
    if (vsrc !== src) fs.rmSync(vsrc, { force: true });
    if (segs) fs.writeFileSync(path.join(dir, `${w.id}_${acc}.srt`), toSrt(segs));
    if (segs) fs.writeFileSync(path.join(dir, `${w.id}_${acc}_ko.srt`), toSrt(segs.map(s => ({ ...s, text: s.back }))));
    step();
  }
  const c = w.caption?.current;
  if (c && w.caption.status === 'confirmed') {
    const lang = { GLOBAL: 'en', JP: 'ja', EU: 'fr' }[w.account];
    fs.writeFileSync(path.join(mainDir, `caption_${lang}.txt`), [c.text, '', c.hashtags.map(h => h.tag).join(' '), c.mentions.map(m => m.handle).join(' ')].join('\n').trim() + '\n');
    fs.writeFileSync(path.join(mainDir, 'caption_ko.txt'), c.back + '\n');
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const drive = await copyToDrive([...new Set(outputs.map(o => o.dir))], { finalsFolder, driveFolder });
  mutate(id, '프로그램', x => {
    const vv = prep(x);
    vv.final = { at: now(), outputs: outputs.map(({ dir, ...o }) => ({ ...o, folder: dir })), folders: [...new Set(outputs.map(o => o.dir))], drive };
    vv.stage = 'done';
    vv.job = null;
    return `나라별 영상 ${v.versions.length}개를 최적화해서 저장했어요${drive.status === 'copied' ? ' (Google Drive에도 복사)' : drive.status === 'failed' ? ` · Google Drive 복사 실패: ${drive.error}` : ''}`;
  });
}

// 자막 검수용: 실제 영상 장면에 자막 디자인을 입혀 본 그림 (JPEG)
export async function subtitleStill(id, acc, i, mode) {
  const w = getWork(id);
  const v = videoOf(w);
  const segs = v.subs.tracks?.[String(acc).toUpperCase()];
  const s = segs?.[Number(i)];
  if (!s) throw new Error('해당 자막을 찾을 수 없어요.');
  if (!v.videos[0]) throw new Error('올라온 영상이 없어요.');
  const src = path.join(workDir(w.id), v.videos[0].file);
  const style = subtitleStyle();
  const dims = { width: v.videos[0].width, height: v.videos[0].height };
  const [color] = await decideColors(src, [s], style, mode || style.color, dims);
  return still({ input: src, t: (Number(s.start) + Number(s.end)) / 2, text: s.text, account: String(acc).toUpperCase(), style, color, size: dims, width: 360 });
}

/* ---------- 모션 그래픽 (Claude는 코드와 글자만, 영상은 프로그램이) ---------- */
// Claude가 구성(코드·나라별 글자·재료 영상)을 보내면 저장하고 'rendering' 단계로. 실제 영상 만들기는 화면 서버가 한다(pumpRenders).
export function submitMotion(id, input, by = 'Claude') {
  const w0 = getWork(id);
  const v0 = prep(w0, ['make', 'make_fix']);
  const base = input.template ? getTemplate(input.template) : null;
  const comp = buildComposition(w0, input, input.template ? null : v0.motion?.comp, base);
  return mutate(id, by, w => {
    const v = prep(w, ['make', 'make_fix']);
    const round = (v.motion?.round || 0) + 1;
    fs.writeFileSync(path.join(workDir(w.id), `motion-${round}.html`), comp.html);
    v.motion = { round, comp, note: text(input.note), at: now(), from: v.stage, template: base?.id || v.motion?.template || '', error: '' };
    v.method = 'claude';
    v.renderKind = 'motion';
    v.stage = 'rendering';
    v.job = { at: now(), done: 0, total: Math.round(comp.duration * 30) };
    return `모션 그래픽 코드가 들어왔어요 (${comp.duration}초, 나라별 글자 ${Object.keys(comp.texts).join('·')})${base ? ` · 템플릿 ${base.id}` : ''} · 영상으로 만드는 중`;
  });
}

/* ---------- 편집 결정 목록(EDL) ---------- */
// Claude(또는 사용자가 화면에서)가 보낸 EDL을 합쳐 저장하고 영상으로 만든다. 스토리보드도 실제 편집에 맞춘다.
export async function submitEdit(id, input, by = 'Claude', { user = false } = {}) {
  const w0 = getWork(id);
  const allowed = user ? ['result_review'] : ['make', 'make_fix'];
  const v0 = prep(w0, allowed);
  const prev = input?.from_version ? v0.videos.find(x => x.id === String(input.from_version).toUpperCase())?.edl : v0.edl;
  if (input?.from_version && !prev) throw new Error(`${input.from_version}에는 편집 목록(EDL)이 없어요.`);
  const edl = await buildEdl(w0, input.edl || input, prev);
  const tl = edlTimeline(edl);
  return mutate(id, by, w => {
    const v = prep(w, allowed);
    v.edl = edl;
    v.renderKind = 'edl';
    v.renderFrom = v.stage;
    v.renderNote = text(input.note);
    v.renderError = '';
    v.method = user ? v.method : 'claude';
    // 스토리보드를 실제 편집에 맞춘다 (이전 스토리보드는 기록에)
    if (v.story) {
      const old = v.story;
      v.storyHistory.unshift({ at: now(), story: old, reason: 'EDL에 맞춤' });
      v.story = { ...old, round: (old.round || 0) + 1, at: now(), fromEdl: true, cuts: edl.cuts.map((c, i) => { const o = old.cuts.find(x => x.id === c.id); return { id: c.id, start: tl.cuts[i].start, end: tl.cuts[i].end, desc: o?.desc || c.note || '(편집에서 추가된 컷)', kind: o?.kind || 'footage', camera: o?.camera || '', text: o?.text || '', back: o?.back || '', fromImage: o?.fromImage || '', sketch: o?.sketch || '' }; }) };
    }
    v.stage = 'rendering';
    v.job = { at: now(), done: 0, total: edl.cuts.length + 2 };
    return `${user ? '직접 편집' : '편집 목록(EDL)이 들어왔어요'}: ${edl.cuts.length}컷 · ${tl.duration.toFixed(1)}초${edl.sfx?.length ? ` · 효과음 ${edl.sfx.length}개` : ''}${input.note ? ` · ${text(input.note, 80)}` : ''}`;
  });
}

// 예전 버전으로 되돌리기: 그 버전의 영상과 편집 목록을 다시 검수 대상으로
export function restoreVersion(id, videoId, by = '화면') {
  return mutate(id, by, w => {
    const v = prep(w, ['result_review', 'make', 'make_fix', 'edit_me']);
    const src = v.videos.find(x => x.id === String(videoId).toUpperCase());
    if (!src) throw new Error(`${videoId} 버전을 찾을 수 없어요.`);
    if (!fs.existsSync(path.join(workDir(w.id), src.file))) throw new Error(`${src.id} 영상 파일이 없어요.`);
    v.round += 1;
    v.videos.unshift({ ...src, id: `V${v.round}`, restoredFrom: src.id, note: `${src.id}로 되돌림`, at: now() });
    if (src.edl) v.edl = JSON.parse(JSON.stringify(src.edl));
    if (src.comp && v.motion) v.motion.comp = JSON.parse(JSON.stringify(src.comp));
    v.notes = [];
    v.stage = 'result_review';
    return `${src.id}로 되돌렸어요 (새 번호 V${v.round})`;
  });
}

const renders = new Map();
export const waitRender = id => renders.get(String(id).toUpperCase()) || Promise.resolve();
// 'rendering' 단계인 작업을 찾아 영상으로 만든다. 화면 서버가 몇 초마다 부른다.
export function pumpRenders() {
  for (const w of load('works')) {
    if (w.type !== 'video' || w.video?.stage !== 'rendering' || renders.has(w.id)) continue;
    const job = runRender(w.id).catch(e => {
      mutate(w.id, '프로그램', x => {
        const v = prep(x);
        const edl = v.renderKind === 'edl';
        v.stage = (edl ? v.renderFrom : v.motion?.from) || 'make';
        if (v.stage === 'result_review' && !v.videos.length) v.stage = 'make';
        if (edl) v.renderError = e.message; else if (v.motion) v.motion.error = e.message;
        v.job = null;
        return `${edl ? '편집 목록' : '모션 그래픽'} 영상 만들기 실패: ${e.message}`;
      });
    }).finally(() => renders.delete(w.id));
    renders.set(w.id, job);
  }
}

async function runRender(id) {
  const w = getWork(id);
  const v = videoOf(w);
  const round = v.round + 1;
  const file = `video-${round}.mp4`;
  const out = path.join(workDir(w.id), file);
  let last = 0;
  const progress = (d, n) => { if (d - last >= 60 || d === n || n < 60) { last = d; mutate(id, '프로그램', x => { const vv = prep(x); if (vv.job) { vv.job.done = d; vv.job.total = n; } return null; }); } };
  if (v.renderKind === 'edl') {
    const info = await renderEdl(v.edl, w, w.account, out, { onProgress: progress, layersDir: workDir(w.id), layersName: `V${round}` });
    return mutate(id, '프로그램', x => {
      const vv = prep(x, ['rendering']);
      vv.round = round;
      vv.videos.unshift({ id: `V${round}`, file, duration: info.duration, width: info.width, height: info.height, audio: info.audio, source: 'edl', edl: JSON.parse(JSON.stringify(vv.edl)), timeline: info.timeline, note: vv.renderNote, at: now() });
      vv.notes = [];
      vv.stage = 'result_review';
      vv.job = null;
      vv.renderKind = null;
      return `편집 목록으로 영상을 만들었어요 (V${round}, ${info.duration.toFixed(1)}초, ${vv.edl.cuts.length}컷)`;
    });
  }
  const info = await renderMotion(v.motion.comp, w, w.account, out, { onProgress: progress });
  return mutate(id, '프로그램', x => {
    const vv = prep(x, ['rendering']);
    vv.round = round;
    vv.videos.unshift({ id: `V${round}`, file, duration: info.duration, width: info.width, height: info.height, audio: info.audio, source: 'motion', motion: vv.motion.round, comp: JSON.parse(JSON.stringify(vv.motion.comp)), note: vv.motion.note, at: now() });
    vv.notes = [];
    vv.stage = 'result_review';
    vv.job = null;
    return `모션 그래픽 영상이 만들어졌어요 (${info.duration.toFixed(1)}초, ${info.width}×${info.height})`;
  });
}

// 나라별 버전: 같은 코드에 그 나라 글자를 넣어 다시 만든다 (토큰 안 씀)
const isMotion = v => v.videos[0]?.source === 'motion' && v.motion;
async function versionSource(w, v, acc, src, tmpDir) {
  if (acc === w.account) return src;
  const vid = v.videos[0];
  if (vid?.edl?.overlay) { const out = path.join(tmpDir, `edl-${acc}.mp4`); await renderEdl(vid.edl, w, acc, out); return out; }
  if (!isMotion(v)) return src;
  const out = path.join(tmpDir, `motion-${acc}.mp4`);
  await renderMotion(v.motion.comp, w, acc, out);
  return out;
}

// Claude가 코드를 보내기 전에 확인하는 장면 그림 (저장하지 않음)
export async function previewMotion(id, input, times = [0], account) {
  const w = getWork(id);
  const v = videoOf(w);
  const base = input.template ? getTemplate(input.template) : null;
  const comp = buildComposition(w, input, input.template ? null : v.motion?.comp, base);
  const acc = account && ACCOUNTS[String(account).toUpperCase()] ? String(account).toUpperCase() : w.account;
  const out = [];
  for (const t of (times.length ? times : [0]).slice(0, 4)) out.push({ t: Number(t) || 0, data: (await renderStill(comp, w, acc, Number(t) || 0, 540)).toString('base64') });
  return { account: acc, frames: out };
}

/* ---------- Claude용 정보와 장면 보기 ---------- */
export function videoForClaude(w) {
  const v = videoOf(w);
  const dir = workDir(w.id);
  return {
    stage: v.stage, stageLabel: VIDEO_STAGE[v.stage], method: v.method, request: v.request,
    story: v.story ? { ...v.story, cuts: v.story.cuts.map(c => ({ ...c, sketch: c.sketch ? path.join(dir, c.sketch) : undefined })) } : null,
    latestVideo: v.videos[0] ? { ...v.videos[0], file: path.join(dir, v.videos[0].file) } : null,
    latestFix: v.fixes[0] || null, versions: v.versions,
    edl: v.edl ? (['make', 'make_fix'].includes(v.stage) ? v.edl : { cuts: v.edl.cuts.map(c => c.id), sfx: (v.edl.sfx || []).length }) : null,
    timeline: v.videos[0]?.timeline || null,
    renderError: v.renderError || undefined,
    motion: v.motion ? { round: v.motion.round, error: v.motion.error || undefined, width: v.motion.comp.width, height: v.motion.comp.height, duration: v.motion.comp.duration, background: v.motion.comp.background, clips: v.motion.comp.clips, music: v.motion.comp.music, texts: v.motion.comp.texts, html: ['make', 'make_fix'].includes(v.stage) ? v.motion.comp.html : undefined } : null,
    subtitles: { status: v.subs.status, latestFix: v.subs.fixes?.[0] || null, current: v.subs.status === 'fix' ? v.subs.tracks : undefined, maxCharsPerLine: Object.fromEntries(v.versions.map(a => [a, lineLimit(subtitleStyle(), a)])) }
  };
}

// 장면 보기. sheet: 시간 라벨이 붙은 한 장(최대 12장면), crop: 영역 확대(%), video: 버전(V3 등)
export async function framesForClaude(id, times, { sheet = false, crop = null, video = null } = {}) {
  const w = getWork(id);
  const v = videoOf(w);
  const vid = video ? v.videos.find(x => x.id === String(video).toUpperCase()) : v.videos[0];
  if (!vid) throw new Error(video ? `${video} 버전을 찾을 수 없어요.` : `${w.id}에 아직 영상이 없어요.`);
  const src = path.join(workDir(w.id), vid.file);
  const max = sheet ? 12 : 6;
  const list = (times?.length ? times : sheet ? Array.from({ length: 8 }, (_, i) => vid.duration * (i + 0.5) / 8) : [0, vid.duration / 2, Math.max(0, vid.duration - 0.5)]).slice(0, max).map(t => Math.min(Math.max(0, Number(t) || 0), Math.max(0, vid.duration - 0.05)));
  const sharp = (await import('sharp')).default;
  const shots = [];
  for (const t of list) {
    const f = path.join(workDir(w.id), `frame-${process.pid}-${Date.now()}-${shots.length}.jpg`);
    await frame(src, t, f, crop ? (vid.width || 1080) : sheet ? 360 : 768);
    let img = sharp(f);
    if (crop) {
      const m = await sharp(f).metadata();
      const c = { left: Math.round(m.width * (crop.x || 0) / 100), top: Math.round(m.height * (crop.y || 0) / 100), width: Math.round(m.width * (crop.w || 50) / 100), height: Math.round(m.height * (crop.h || 50) / 100) };
      c.width = Math.max(8, Math.min(c.width, m.width - c.left)); c.height = Math.max(8, Math.min(c.height, m.height - c.top));
      img = sharp(await sharp(f).extract(c).toBuffer()).resize({ width: sheet ? 360 : 768 });
    }
    shots.push({ t, buf: await img.jpeg({ quality: 82 }).toBuffer() });
    fs.rmSync(f, { force: true });
  }
  if (!sheet) return { video: vid, frames: shots.map(x => ({ t: x.t, data: x.buf.toString('base64') })) };
  // 콘택트 시트: 4열, 장면마다 시간 라벨과 컷 이름
  const metas = await Promise.all(shots.map(x => sharp(x.buf).metadata()));
  const tw = 360, th = Math.round(tw * metas[0].height / metas[0].width), cols = Math.min(4, shots.length), rows = Math.ceil(shots.length / cols), pad = 6;
  const label = (t) => { const at = locate({ videos: [vid], motion: v.motion }, t); return `${t.toFixed(2)}s${at ? ` · ${at.cut} ${at.src}s` : ''}`; };
  const tiles = await Promise.all(shots.map(async (x, i) => {
    const svg = Buffer.from(`<svg width="${tw}" height="28"><rect width="${tw}" height="28" fill="black" fill-opacity="0.7"/><text x="8" y="19" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="white">${label(x.t)}</text></svg>`);
    return { input: await sharp(x.buf).resize(tw, th, { fit: 'cover' }).composite([{ input: svg, top: 0, left: 0 }]).toBuffer(), left: pad + (i % cols) * (tw + pad), top: pad + Math.floor(i / cols) * (th + pad) };
  }));
  const data = await sharp({ create: { width: pad + cols * (tw + pad), height: pad + rows * (th + pad), channels: 3, background: '#ffffff' } }).composite(tiles).jpeg({ quality: 80 }).toBuffer();
  return { video: vid, frames: [{ t: list[0], data: data.toString('base64'), sheet: list }] };
}

// 두 버전 비교 (같은 결과인지): 0.5초마다 작은 회색 그림의 평균 차이 (0=같음, 255=완전히 다름)
export async function compareVideos(id, a, b, step = 0.5) {
  const w = getWork(id);
  const v = videoOf(w);
  const pick = x => { const vid = v.videos.find(y => y.id === String(x).toUpperCase()); if (!vid) throw new Error(`${x} 버전을 찾을 수 없어요.`); return vid; };
  const va = pick(a), vb = pick(b);
  const grab = vid => new Promise((resolve, reject) => {
    execFile(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', path.join(workDir(w.id), vid.file), '-vf', `fps=${1 / step},scale=96:170,format=gray`, '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }, (e, out) => e ? reject(e) : resolve(out));
  });
  const [fa, fb] = await Promise.all([grab(va), grab(vb)]);
  const size = 96 * 170, n = Math.min(fa.length, fb.length) / size;
  const samples = [];
  for (let i = 0; i < n; i++) { let d = 0; for (let j = 0; j < size; j++) d += Math.abs(fa[i * size + j] - fb[i * size + j]); samples.push({ t: Math.round(i * step * 100) / 100, diff: Math.round(d / size * 10) / 10 }); }
  const maxDiff = Math.max(0, ...samples.map(x => x.diff)), meanDiff = samples.length ? Math.round(samples.reduce((x, y) => x + y.diff, 0) / samples.length * 10) / 10 : 0;
  return { a: va.id, b: vb.id, durationA: va.duration, durationB: vb.duration, meanDiff, maxDiff, same: Math.abs(va.duration - vb.duration) < 0.1 && maxDiff < 8, worst: [...samples].sort((x, y) => y.diff - x.diff).slice(0, 5), samples: samples.length > 80 ? undefined : samples };
}

// 소리 확인: 시간대별 층별 음량(원본 소리·효과음·음악), 주요 주파수, 가장 큰 층, 그 구간의 효과음
export async function inspectAudio(id, from = 0, to = null, video = null) {
  const w = getWork(id);
  const v = videoOf(w);
  const vid = video ? v.videos.find(x => x.id === String(video).toUpperCase()) : v.videos[0];
  if (!vid) throw new Error('영상이 없어요.');
  const end = Math.min(vid.duration, to ?? vid.duration), start = Math.max(0, Math.min(from, end - 0.1));
  if (end - start > 30) throw new Error('한 번에 30초까지 볼 수 있어요.');
  const base = path.join(workDir(w.id), vid.restoredFrom || vid.id);
  const layers = {};
  for (const k of ['clip', 'sfx', 'music']) if (fs.existsSync(`${base}-${k}.f32`)) layers[{ clip: '클립 원본 소리', sfx: '효과음', music: '음악' }[k]] = loadLayer(`${base}-${k}.f32`);
  if (!Object.keys(layers).length) layers['전체 소리'] = toMono(await decode(path.join(workDir(w.id), vid.file)));
  const step = end - start > 10 ? 0.25 : 0.1;
  const rows = analyze(layers, start, end, step);
  const sfx = (vid.edl?.sfx || []).filter(x => x.at >= start - 1 && x.at <= end).map(x => ({ id: x.id, name: x.name, at: x.at, volume: x.volume }));
  return { video: vid.id, from: start, to: end, step, layers: Object.keys(layers), note: Object.keys(layers)[0] === '전체 소리' ? '이 버전은 층별 소리가 없어 전체 소리만 분석했어요 (편집 목록으로 만든 버전은 층별로 나와요).' : undefined, sfx, rows };
}
