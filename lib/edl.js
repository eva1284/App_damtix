// 편집 결정 목록(EDL): 어떤 원본 클립을 몇 초부터 몇 초까지, 어떤 속도·확대·전환·마스크·소리로 썼는지를 데이터로 남기고
// 그 데이터로 프로그램이 영상을 만든다. Claude는 바뀐 부분만 보내면 되고(patch), 버전마다 EDL이 남아 되돌릴 수 있다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probe, probeAudio } from './media.js';
import { sniff } from './files.js';
import { resolveSrc, buildComposition, composite, ffRun, prepareMusic, FPS } from './motion.js';
import { decode, mix, limit, writeWav, toMono, saveLayer, RATE } from './audio.js';
import { sfxFile } from './sfx.js';

const ID = /^[A-Z0-9][A-Z0-9_-]{0,11}$/;
const T_TYPES = { cut: null, dissolve: 'fade', push: 'slide' };
const DIRS = ['left', 'right', 'up', 'down'];
const num = (v, name, min, max, d) => {
  if (v === undefined || v === null || v === '') { if (d !== undefined) return d; throw new Error(`${name}이(가) 없어요.`); }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name}은(는) ${min}~${max} 사이로 넣어 주세요 (지금 ${v}).`);
  return Math.round(n * 1000) / 1000;
};
const str = (v, max = 400) => String(v ?? '').trim().slice(0, max);
const merge = (a, b) => { // b의 값으로 덮어쓰고, null이면 지운다 (한 단계 아래 객체까지)
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    if (v === null) delete out[k];
    else if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') out[k] = { ...out[k], ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null)) };
    else out[k] = v;
  }
  return out;
};

async function sourceInfo(src, w, cache) {
  if (cache.has(src)) return cache.get(src);
  const file = await resolveSrc(src, w);
  const head = Buffer.alloc(16); const fd = fs.openSync(file, 'r'); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd);
  const kind = sniff(head)?.kind;
  if (kind !== 'video' && kind !== 'image') throw new Error(`${src}는 영상이나 이미지가 아니에요.`);
  const info = kind === 'video' ? await probe(file) : { duration: Infinity, audio: false };
  const r = { file, kind, duration: info.duration, audio: info.audio, width: info.width, height: info.height };
  cache.set(src, r);
  return r;
}

function cleanCut(c, i, info) {
  const id = str(c.id, 12).toUpperCase();
  if (!ID.test(id)) throw new Error(`${i + 1}번 컷의 id("${c.id}")는 C1, C5-1 같은 영문·숫자로 넣어 주세요.`);
  const name = `컷 ${id}`;
  const inT = num(c.in, `${name} in`, 0, 3600, 0);
  const dur = info.kind === 'video' ? info.duration : 3600;
  const outT = c.out === undefined || c.out === null ? (info.kind === 'video' ? info.duration : null) : num(c.out, `${name} out`, 0, 3600);
  if (outT === null) throw new Error(`${name}은 이미지라 out(보여 줄 길이의 끝, 초)이 필요해요.`);
  if (outT <= inT + 0.05) throw new Error(`${name}의 out(${outT})이 in(${inT})보다 커야 해요.`);
  if (info.kind === 'video' && outT > dur + 0.05) throw new Error(`${name}의 out(${outT}초)이 원본 길이(${dur.toFixed(2)}초)보다 길어요.`);
  const out = { id, src: str(c.src, 2000), in: inT, out: Math.min(outT, dur), speed: num(c.speed, `${name} speed`, 0.25, 4, 1), freeze: num(c.freeze, `${name} freeze`, 0, 10, 0), fit: c.fit === 'contain' ? 'contain' : 'cover', note: str(c.note, 300) };
  if (c.zoom) out.zoom = { from: num(c.zoom.from, `${name} zoom.from`, 1, 4, 1), to: num(c.zoom.to, `${name} zoom.to`, 1, 4, 1), x: num(c.zoom.x, `${name} zoom.x`, 0, 100, 50), y: num(c.zoom.y, `${name} zoom.y`, 0, 100, 50) };
  const a = c.audio || {};
  out.audio = { on: a.on !== false, volume: num(a.volume, `${name} audio.volume`, 0, 2, 1), fadeIn: num(a.fadeIn, `${name} audio.fadeIn`, 0, 10, 0), fadeOut: num(a.fadeOut, `${name} audio.fadeOut`, 0, 10, 0) };
  if (c.mask) {
    if ((c.mask.type || 'iris') !== 'iris') throw new Error(`${name}: 마스크는 지금 iris(아이리스)만 돼요.`);
    out.mask = { type: 'iris', x: num(c.mask.x, `${name} mask.x`, 0, 100, 50), y: num(c.mask.y, `${name} mask.y`, 0, 100, 50), r0: num(c.mask.r0, `${name} mask.r0`, 0, 150, 0), r1: num(c.mask.r1, `${name} mask.r1`, 0, 150, 150), at: num(c.mask.at, `${name} mask.at`, 0, 600, 0), dur: num(c.mask.dur, `${name} mask.dur`, 0.05, 10, 0.6), hold: c.mask.hold == null ? null : num(c.mask.hold, `${name} mask.hold`, 0, 600) };
  }
  const t = c.transition || {};
  const type = t.type || 'cut';
  if (!(type in T_TYPES)) throw new Error(`${name}: 전환은 cut, push, dissolve 중 하나예요.`);
  out.transition = type === 'cut' ? { type: 'cut' } : { type, dur: num(t.dur, `${name} transition.dur`, 0.05, 2, 0.4), ...(type === 'push' ? { dir: DIRS.includes(t.dir) ? t.dir : 'left' } : {}) };
  return out;
}

// Claude가 보낸 EDL(전체 또는 바뀐 부분)을 지금 EDL에 합쳐 검사한다
export async function buildEdl(w, input, prev) {
  if (!input || typeof input !== 'object') throw new Error('edl을 보내 주세요.');
  const base = input.replace || !prev ? { width: 1080, height: 1920, background: '#000000', cuts: [], sfx: [], music: null, overlay: null } : JSON.parse(JSON.stringify(prev));
  for (const k of ['width', 'height']) if (input[k] !== undefined) base[k] = Math.round(num(input[k], k, 240, 3840));
  if (base.width % 2 || base.height % 2) throw new Error('화면 크기는 짝수로 넣어 주세요 (예: 1080×1920).');
  if (input.background !== undefined) { if (!/^#[0-9a-fA-F]{6}$/.test(input.background)) throw new Error('background는 #000000 같은 색 코드예요.'); base.background = input.background; }
  // 컷: id가 있으면 그 컷을 고치고, 없던 id면 더한다. remove로 빼고 order로 순서를 바꾼다.
  let cuts = base.cuts;
  for (const c of input.cuts || []) {
    const id = str(c.id, 12).toUpperCase();
    const i = cuts.findIndex(x => x.id === id);
    if (i >= 0) cuts[i] = merge(cuts[i], c);
    else { if (!c.src) throw new Error(`새 컷 ${id || '(id 없음)'}에 src(원본 클립)가 없어요.`); cuts.push({ ...c, id }); }
  }
  if (input.remove) cuts = cuts.filter(c => !input.remove.map(x => String(x).toUpperCase()).includes(c.id));
  if (input.order) {
    const order = input.order.map(x => String(x).toUpperCase());
    const missing = cuts.filter(c => !order.includes(c.id)).map(c => c.id);
    if (missing.length) throw new Error(`order에 빠진 컷이 있어요: ${missing.join(', ')} (빼려면 remove)`);
    cuts = order.map(id => { const c = cuts.find(x => x.id === id); if (!c) throw new Error(`order의 ${id} 컷이 없어요.`); return c; });
  }
  if (!cuts.length) throw new Error('컷이 하나도 없어요.');
  if (new Set(cuts.map(c => c.id)).size !== cuts.length) throw new Error('컷 id가 겹쳐요.');
  if (cuts.length > 60) throw new Error('컷은 60개까지예요.');
  const cache = new Map();
  const clean = [];
  for (const [i, c] of cuts.entries()) clean.push(cleanCut(c, i, await sourceInfo(c.src, w, cache)));
  base.cuts = clean;
  // 효과음: id(S1…)가 있으면 고치거나(delete:true면 빼고), 없으면 더한다
  if (input.sfx) {
    const list = [...(base.sfx || [])];
    let n = Math.max(0, ...list.map(s => Number(String(s.id).slice(1)) || 0));
    for (const s of input.sfx) {
      const i = s.id ? list.findIndex(x => x.id === String(s.id).toUpperCase()) : -1;
      if (s.delete) { if (i >= 0) list.splice(i, 1); continue; }
      const e = i >= 0 ? { ...list[i], ...s, id: list[i].id } : { ...s, id: `S${++n}` };
      sfxFile(e.name); // 라이브러리에 있는지
      list[i >= 0 ? i : list.length] = { id: e.id, name: String(e.name).toLowerCase(), at: num(e.at, `효과음 ${e.id} at`, 0, 600), volume: num(e.volume, `효과음 ${e.id} volume`, 0, 2, 1), note: str(e.note, 120) };
    }
    base.sfx = list.sort((a, b) => a.at - b.at);
  }
  if (input.music !== undefined) base.music = input.music && input.music.src ? { src: str(input.music.src, 2000), volume: num(input.music.volume, 'music volume', 0, 2, 0.6) } : null;
  const tl = timeline(base);
  // 글자 층(모션 그래픽): 지금 쓰는 모션 그래픽 약속 그대로. 길이는 EDL 길이에 맞춘다.
  if (input.overlay !== undefined || base.overlay) {
    if (input.overlay === null) base.overlay = null;
    else {
      const o = input.overlay || {};
      const comp = buildComposition(w, { html: o.html, html_edits: o.html_edits, texts: o.texts, width: base.width, height: base.height, duration: Math.max(0.5, tl.duration), background: base.background, clips: [] }, base.overlay ? { ...base.overlay, width: base.width, height: base.height, duration: tl.duration, background: base.background, clips: [] } : null);
      base.overlay = { html: comp.html, texts: comp.texts, keys: comp.keys, checks: comp.checks };
    }
  }
  for (const s of base.sfx || []) if (s.at >= tl.duration) throw new Error(`효과음 ${s.id}(${s.name})의 시각 ${s.at}초가 영상 길이 ${tl.duration.toFixed(2)}초를 넘어요.`);
  return base;
}

// 컷마다 타임라인 위치. 전환(push·dissolve)은 앞 컷 끝과 뒤 컷 앞이 겹친다.
export function timeline(edl) {
  const rows = [];
  let start = 0;
  edl.cuts.forEach((c, i) => {
    const play = (c.out - c.in) / c.speed, len = play + (c.freeze || 0);
    const d = c.transition?.type && c.transition.type !== 'cut' && i < edl.cuts.length - 1 ? c.transition.dur : 0;
    rows.push({ id: c.id, start: Math.round(start * 1000) / 1000, end: Math.round((start + len) * 1000) / 1000, play, len, d });
    start += len - d;
  });
  rows.forEach((r, i) => {
    if (r.d) {
      const next = rows[i + 1];
      if (r.d > Math.min(r.len, next.len) * 0.5 + 1e-6) throw new Error(`컷 ${r.id} 전환 길이(${r.d}초)가 너무 길어요. 앞뒤 컷 길이의 절반 이하로 넣어 주세요.`);
    }
  });
  const last = rows[rows.length - 1];
  return { cuts: rows, duration: last ? last.end : 0 };
}

// 완성 영상의 시각 → [컷, 그 컷 원본의 시각]. 전환 구간은 가운데를 기준으로 앞·뒤 컷을 고른다.
export function mapTime(edl, t) {
  const tl = timeline(edl);
  let k = tl.cuts.findIndex((r, i) => t < r.end - (r.d ? r.d / 2 : 0) || i === tl.cuts.length - 1);
  if (k < 0) k = tl.cuts.length - 1;
  const r = tl.cuts[k], c = edl.cuts[k];
  const local = Math.max(0, t - r.start);
  const freeze = local > r.play;
  return { cut: c.id, src: Math.round((c.in + Math.min(local, r.play) * c.speed) * 100) / 100, local: Math.round(local * 100) / 100, freeze: freeze || undefined, clip: c.src };
}

const atempo = s => { const out = []; let x = s; while (x > 2) { out.push('atempo=2'); x /= 2; } while (x < 0.5) { out.push('atempo=0.5'); x /= 0.5; } out.push(`atempo=${x.toFixed(4)}`); return out.join(','); };

// 컷 하나를 같은 형식(W×H, 30fps, 스테레오 48kHz)의 조각으로
async function renderCut(c, info, edl, frames, file) {
  const W = edl.width, H = edl.height, bg = edl.background.replace('#', '0x');
  const play = (c.out - c.in) / c.speed, playF = Math.max(1, Math.round(play * FPS));
  const fit = c.fit === 'contain' ? `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${bg}` : `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  const input = info.kind === 'video' ? ['-ss', String(c.in), '-t', String(c.out - c.in), '-i', info.file] : ['-loop', '1', '-framerate', String(FPS), '-t', String(play + 1), '-i', info.file];
  const vf = [info.kind === 'video' ? `setpts=(PTS-STARTPTS)/${c.speed}` : 'setpts=PTS-STARTPTS', fit, 'setsar=1', `fps=${FPS}`];
  if (c.zoom && (c.zoom.from !== 1 || c.zoom.to !== 1)) vf.push(`zoompan=z='${c.zoom.from}+(${c.zoom.to - c.zoom.from})*min(on/${Math.max(1, playF - 1)},1)':x='(iw-iw/zoom)*${c.zoom.x / 100}':y='(ih-ih/zoom)*${c.zoom.y / 100}':d=1:s=${W}x${H}:fps=${FPS}`);
  if (c.freeze) vf.push(`tpad=stop_mode=clone:stop_duration=${c.freeze}`);
  vf.push('format=yuv420p');
  const len = frames / FPS;
  let af, extra = [];
  if (info.kind === 'video' && info.audio && c.audio.on && c.audio.volume > 0) {
    af = [`[0:a]asetpts=PTS-STARTPTS`, c.speed !== 1 ? atempo(c.speed) : null, 'aresample=48000', 'aformat=channel_layouts=stereo', `volume=${c.audio.volume}`, c.audio.fadeIn ? `afade=t=in:st=0:d=${c.audio.fadeIn}` : null, c.audio.fadeOut ? `afade=t=out:st=${Math.max(0, play - c.audio.fadeOut).toFixed(3)}:d=${c.audio.fadeOut}` : null, 'apad[a]'].filter(Boolean).join(',');
  } else { extra = ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']; af = '[1:a]anull[a]'; }
  await ffRun([...input, ...extra, '-filter_complex', `[0:v]${vf.join(',')}[v];${af}`, '-map', '[v]', '-map', '[a]', '-frames:v', String(frames), '-t', len.toFixed(4), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-g', String(FPS), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-f', 'mp4', file], `컷 ${c.id} 만들기`);
}

// 조각의 [a, b) 프레임만 잘라 낸다
const trimPiece = (src, a, b, file) => ffRun(['-i', src, '-filter_complex', `[0:v]trim=start_frame=${a}:end_frame=${b},setpts=N/(${FPS}*TB)[v];[0:a]atrim=start=${(a / FPS).toFixed(4)}:end=${(b / FPS).toFixed(4)},asetpts=PTS-STARTPTS[a]`, '-map', '[v]', '-map', '[a]', '-frames:v', String(b - a), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-f', 'mp4', file], '컷 다듬기');

// 앞 조각 끝 d프레임 + 뒤 조각 앞 d프레임 → 전환 조각
function transitionPiece(a, aFrames, b, dF, t, file) {
  const d = dF / FPS;
  const name = t.type === 'dissolve' ? 'fade' : `slide${t.dir || 'left'}`;
  return ffRun(['-ss', ((aFrames - dF) / FPS).toFixed(4), '-i', a, '-t', d.toFixed(4), '-i', b, '-filter_complex', `[0:v]trim=end_frame=${dF},setpts=N/(${FPS}*TB),fps=${FPS}[x];[1:v]trim=end_frame=${dF},setpts=N/(${FPS}*TB),fps=${FPS}[y];[x][y]xfade=transition=${name}:duration=${(d - 0.001).toFixed(4)}:offset=0,format=yuv420p[v];[0:a]atrim=end=${d.toFixed(4)},asetpts=PTS-STARTPTS[p];[1:a]atrim=end=${d.toFixed(4)},asetpts=PTS-STARTPTS[q];[p][q]acrossfade=d=${(d - 0.001).toFixed(4)}[aa]`, '-map', '[v]', '-map', '[aa]', '-frames:v', String(dF), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-f', 'mp4', file], `컷 전환(${t.type})`);
}

// 아이리스 마스크 → 글자 층에 그린다 (검은 화면에 둥근 구멍이 커지거나 작아짐)
function maskMarkup(edl, tl) {
  const masks = [];
  edl.cuts.forEach((c, i) => {
    if (!c.mask) return;
    const r = tl.cuts[i], t0 = r.start + c.mask.at, hold = c.mask.hold ?? (c.mask.r1 < c.mask.r0 ? Math.max(0, r.end - t0 - c.mask.dur) : 0);
    masks.push({ x: c.mask.x, y: c.mask.y, r0: c.mask.r0, r1: c.mask.r1, t0, dur: c.mask.dur, t1: t0 + c.mask.dur + hold });
  });
  if (!masks.length) return '';
  return masks.map((_, i) => `<div id="__iris${i}" style="position:absolute;inset:0;pointer-events:none;display:none;z-index:2147483000"></div>`).join('')
    + `<script>window.__edl=function(t){var M=${JSON.stringify(masks)};M.forEach(function(m,i){var el=document.getElementById('__iris'+i);if(t<m.t0||t>m.t1){el.style.display='none';return;}var u=Math.max(0,Math.min(1,(t-m.t0)/m.dur));var e=u<.5?2*u*u:1-Math.pow(-2*u+2,2)/2;var r=m.r0+(m.r1-m.r0)*e;if(r>=149){el.style.display='none';return;}el.style.display='block';el.style.background='radial-gradient(circle at '+m.x+'% '+m.y+'%, transparent '+r+'vmax, #000 '+(r+0.12)+'vmax)';});};</script>`;
}

// EDL → 영상. layersDir를 주면 분석용 소리 층(원본 소리·효과음·음악)을 남긴다.
export async function renderEdl(edl, w, account, out, { onProgress, layersDir, layersName = 'layers' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-edl-'));
  try {
    const tl = timeline(edl);
    const cache = new Map();
    const lenF = tl.cuts.map(r => Math.max(1, Math.round(r.len * FPS)));
    const dF = tl.cuts.map((r, i) => (r.d ? Math.max(2, Math.round(r.d * FPS)) : 0));
    const segs = [];
    for (const [i, c] of edl.cuts.entries()) {
      const file = path.join(dir, `seg${String(i).padStart(3, '0')}.mp4`);
      await renderCut(c, await sourceInfo(c.src, w, cache), edl, lenF[i], file);
      segs.push(file);
      onProgress?.(i + 1, edl.cuts.length + 2, `컷 ${c.id}`);
    }
    // 이어 붙일 순서: 몸통0, 전환0, 몸통1, 전환1, … (전환 구간은 앞뒤 컷이 겹친다)
    const pieces = [];
    for (let i = 0; i < segs.length; i++) {
      const a = i > 0 ? dF[i - 1] : 0, b = lenF[i] - dF[i];
      if (b - a < 1) throw new Error(`컷 ${edl.cuts[i].id}가 앞뒤 전환보다 짧아요.`);
      if (a === 0 && b === lenF[i]) pieces.push(segs[i]);
      else { const f = path.join(dir, `body${i}.mp4`); await trimPiece(segs[i], a, b, f); pieces.push(f); }
      if (dF[i]) { const f = path.join(dir, `tr${i}.mp4`); await transitionPiece(segs[i], lenF[i], segs[i + 1], dF[i], edl.cuts[i].transition, f); pieces.push(f); }
    }
    const list = path.join(dir, 'list.txt');
    fs.writeFileSync(list, pieces.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    const D = (lenF.reduce((a, b) => a + b, 0) - dF.reduce((a, b) => a + b, 0)) / FPS;
    // 효과음·음악은 프로그램이 직접 섞는다
    const sfxEvents = [];
    for (const s of edl.sfx || []) sfxEvents.push({ data: await decode(sfxFile(s.name)), at: s.at, volume: s.volume });
    const sfxTrack = mix(D, sfxEvents);
    let musicTrack = null;
    if (edl.music) musicTrack = await decode(await prepareMusic(await resolveSrc(edl.music.src, w), D, edl.music.volume, dir));
    let extra = null;
    if (sfxEvents.length || musicTrack) {
      const m = new Float32Array(sfxTrack.length);
      for (let i = 0; i < m.length; i++) m[i] = sfxTrack[i] + (musicTrack?.[i] || 0);
      extra = writeWav(path.join(dir, 'extra.wav'), limit(m));
    }
    onProgress?.(edl.cuts.length + 1, edl.cuts.length + 2, '합치기');
    const markup = maskMarkup(edl, tl);
    const overlay = edl.overlay || markup ? { width: edl.width, height: edl.height, duration: D, html: (edl.overlay?.html || '') + markup, texts: edl.overlay?.texts || {}, keys: edl.overlay?.keys || [] } : null;
    const info = await composite({ list, audio: extra, overlay, account, w, out, duration: D });
    if (layersDir) {
      const clip = await decodeList(list);
      fs.mkdirSync(layersDir, { recursive: true });
      saveLayer(path.join(layersDir, `${layersName}-clip.f32`), toMono(clip));
      saveLayer(path.join(layersDir, `${layersName}-sfx.f32`), toMono(sfxTrack));
      if (musicTrack) saveLayer(path.join(layersDir, `${layersName}-music.f32`), toMono(musicTrack));
    }
    onProgress?.(edl.cuts.length + 2, edl.cuts.length + 2, '끝');
    return { ...info, timeline: tl };
  } finally { if (process.env.CC_KEEP_TMP) console.log('tmp', dir); else fs.rmSync(dir, { recursive: true, force: true }); }
}

// 조각 목록의 소리 전체 (원본 소리 층)
async function decodeList(list) {
  const tmp = list.replace(/list\.txt$/, 'clip.wav');
  await ffRun(['-f', 'concat', '-safe', '0', '-i', list, '-vn', '-ac', '2', '-ar', String(RATE), '-c:a', 'pcm_s16le', tmp], '원본 소리 모으기');
  return decode(tmp);
}

// 원본 클립의 프레임 띠 (0.25초 간격) — 사용자가 쓸 구간을 고를 때
export async function stripFor(src, w, file, { step = 0.25, height = 160, max = 240 } = {}) {
  const info = await sourceInfo(src, w, new Map());
  if (info.kind !== 'video') throw new Error('영상 클립만 구간을 고를 수 있어요.');
  const n = Math.min(max, Math.ceil(info.duration / step));
  const cols = Math.min(n, 40), rows = Math.ceil(n / cols);
  await ffRun(['-i', info.file, '-vf', `fps=${1 / step},scale=-2:${height},tile=${cols}x${rows}`, '-frames:v', '1', '-q:v', '5', file], '프레임 띠 만들기');
  return { file, step, count: n, cols, rows, duration: info.duration, frameHeight: height, frameWidth: Math.round(height * (info.width / info.height) / 2) * 2 };
}

export { probeAudio };
