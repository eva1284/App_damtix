// 이미지 제작 흐름: 구도 시안 맡기기 → Claude가 SVG 시안 제출 → 사용자가 고름 → Claude가 Higgsfield로 생성해 제출
// → 사용자가 핀 메모로 검수 → 수정 요청 또는 최종 컨펌 → 최적화·폴더 저장·Drive 복사
// 한 작업에 컷이 여러 개일 수 있다 (캐러셀, 영상 스토리보드의 컷 이미지): 컷마다 시안을 고르고, 컷마다 이미지를 만든다.
import fs from 'node:fs';
import path from 'node:path';
import { getWork, mutate } from './works.js';
import { workDir, sniff, download, readLocal, cleanSvg } from './files.js';
import { finalizeImages } from './finalize.js';
import sharp from 'sharp';

export const IMAGE_STAGE = {
  none: '시작 전',
  draft_requested: 'Claude가 구도 시안 만들 차례',
  draft_fix: 'Claude가 구도 시안 고칠 차례',
  draft_review: '구도 시안 고를 차례',
  make: 'Claude가 이미지 만들 차례',
  make_fix: 'Claude가 이미지 고칠 차례',
  result_review: '결과 검수할 차례',
  upscale: 'Claude가 업스케일할 차례',
  finalizing: '최종 처리 중',
  done: '최종 완료'
};
export const CLAUDE_STAGES = ['draft_requested', 'draft_fix', 'make', 'make_fix', 'upscale'];
export const MY_STAGES = ['draft_review', 'result_review'];

const blank = () => ({ stage: 'none', request: null, cuts: [], drafts: [], pick: {}, pickNote: '', pickNotes: {}, results: [], round: 0, fixes: [], history: [], final: null, error: '' });
export const imageOf = w => w.image || blank();
export const MIN_WIDTH = 1080;
const ONE = [{ id: 'C1', title: '', desc: '' }];
export const cutsOf = im => (im.cuts?.length ? im.cuts : ONE);
// 예전 데이터는 pick이 시안 번호 하나였다
export const picksOf = im => typeof im.pick === 'string' ? { [im.drafts.find(d => d.id === im.pick)?.cut || 'C1']: im.pick } : (im.pick || {});
const cutOrder = im => Object.fromEntries(cutsOf(im).map((c, i) => [c.id, i]));

function prep(w, allowed) {
  if (w.type !== 'image') throw new Error('이미지 작업에서만 쓸 수 있어요.');
  if (!w.image) w.image = blank();
  if (allowed && !allowed.includes(w.image.stage)) throw new Error(`${w.id}는 지금 이 단계가 아니에요 (${IMAGE_STAGE[w.image.stage]}).`);
  return w.image;
}
const text = (v, max = 1000) => String(v ?? '').trim().slice(0, max);

export function requestDrafts(id, note, by = '화면') {
  return mutate(id, by, w => {
    const im = prep(w, ['none', 'done']);
    if (im.stage === 'done') { im.history.unshift({ at: new Date().toISOString(), drafts: im.drafts, results: im.results, final: im.final }); im.drafts = []; im.results = []; im.final = null; im.pick = {}; im.pickNotes = {}; }
    im.stage = 'draft_requested';
    im.request = { note: text(note), at: new Date().toISOString() };
    return '구도 시안을 Claude에게 맡겼어요';
  });
}

// 컷 정하기 (영상 스토리보드에서 컷 이미지를 만들 때, 또는 Claude가 이미 만든 컷 이미지를 옮길 때)
// id는 C1, C2… 또는 영상 컷 번호에 맞춘 C5-1 같은 이름. from은 연결할 영상 컷 (VID-001:C5)
const CUT_ID = /^C\d{1,2}(-\d{1,2})?$/;
export const EARLY = ['none', 'done', 'draft_requested', 'draft_fix', 'draft_review', 'make', 'make_fix'];
export function setCuts(id, cuts, by = '화면') {
  if (!Array.isArray(cuts) || cuts.length < 1 || cuts.length > 20) throw new Error('컷은 1~20개예요.');
  const clean = cuts.map((c, i) => {
    const cid = c.id ? String(c.id).toUpperCase().trim() : `C${i + 1}`;
    if (!CUT_ID.test(cid)) throw new Error(`컷 이름 "${c.id}"는 C1, C2, C5-1 같은 형식으로 써 주세요.`);
    const from = text(c.from, 40).toUpperCase();
    if (from && !/^VID-\d+:C\d{1,2}$/.test(from)) throw new Error(`${cid}의 from은 VID-001:C5 같은 형식이에요.`);
    return { id: cid, title: text(c.title, 60), desc: text(c.desc, 400), from };
  });
  if (new Set(clean.map(c => c.id)).size !== clean.length) throw new Error('컷 이름이 겹쳐요.');
  const w = mutate(id, by, w => {
    const im = prep(w, EARLY);
    if (im.stage === 'done') { im.history.unshift({ at: new Date().toISOString(), drafts: im.drafts, results: im.results, final: im.final }); im.drafts = []; im.results = []; im.final = null; im.pick = {}; im.pickNotes = {}; im.stage = 'none'; }
    const ids = new Set(clean.map(c => c.id));
    const lost = [...im.drafts, ...im.results].filter(x => !ids.has(x.cut || 'C1'));
    if (lost.length && clean.length > 1) throw new Error(`이미 시안이나 이미지가 있는 컷(${[...new Set(lost.map(x => x.cut || 'C1'))].join(', ')})이 새 컷 구성에 없어요.`);
    im.cuts = clean;
    return `컷 ${clean.length}개로 나눴어요 (${clean.map(c => c.id).join(', ')})`;
  });
  linkVideoCuts(w, by);
  return getWork(id);
}

// 컷에 from(VID-001:C5)이 있으면 그 영상 컷에 이 이미지 컷을 연결한다. 한 영상 컷에 여러 장(C5-1, C5-2…)이 연결될 수 있다.
const VIDEO_LINKABLE = ['story_review', 'make', 'make_fix', 'edit_me', 'result_review'];
export function linkVideoCuts(w, by = '화면') {
  const byVideo = {};
  for (const c of w.image?.cuts || []) {
    if (!c.from) continue;
    const [vid, vcut] = c.from.split(':');
    (byVideo[vid] = byVideo[vid] || []).push([vcut, `${w.id}:${c.id}`]);
  }
  const done = [];
  for (const [vid, pairs] of Object.entries(byVideo)) {
    try {
      mutate(vid, by, v => {
        const story = v.video?.story;
        if (!story || !VIDEO_LINKABLE.includes(v.video.stage)) return null;
        const changed = [];
        for (const [vcut, ref] of pairs) {
          const c = story.cuts.find(x => x.id === vcut);
          if (!c) continue;
          const list = String(c.fromImage || '').split(',').filter(Boolean).filter(x => !x.startsWith(`${w.id}:`) || pairs.some(p => p[1] === x));
          if (!list.includes(ref)) { list.push(ref); changed.push(`${vcut}←${ref}`); }
          c.fromImage = list.join(',');
        }
        if (changed.length) done.push(vid);
        return changed.length ? `컷 이미지 연결: ${changed.join(', ')}` : null;
      });
    } catch { /* 영상 작업이 없으면 건너뛴다 */ }
  }
  return done;
}

// 구도 시안 없이 바로 이미지 만들기를 맡긴다
export function requestMake(id, note, by = '화면') {
  return mutate(id, by, w => {
    const im = prep(w, ['none', 'done', 'draft_requested', 'draft_review']);
    if (im.stage === 'done') { im.history.unshift({ at: new Date().toISOString(), drafts: im.drafts, results: im.results, final: im.final }); im.drafts = []; im.results = []; im.final = null; im.pick = {}; im.pickNotes = {}; }
    im.request = { note: text(note), at: new Date().toISOString(), noDraft: true };
    im.stage = 'make';
    return '구도 시안 없이 바로 이미지 만들기를 맡겼어요';
  });
}

// 구도 시안 받기.
//   한 장짜리: drafts = [{ title, note, svg }] (1~4개)
//   여러 컷: { cuts: [{ id?, title, desc, drafts: [{ title, note, svg }] }] } (컷 1~20개, 컷마다 시안 1~3개)
//   고칠 때는 고친 컷만 id를 붙여 보내면 나머지 컷의 시안과 선택은 그대로 둔다.
export function submitDrafts(id, input, by = 'Claude') {
  const multi = !Array.isArray(input) && Array.isArray(input?.cuts);
  let groups;
  if (multi) {
    if (input.cuts.length < 1 || input.cuts.length > 20) throw new Error('컷은 1~20개 보내 주세요.');
    groups = input.cuts.map((c, i) => {
      const ds = c.drafts || [];
      if (!Array.isArray(ds) || ds.length < 1 || ds.length > 3) throw new Error(`${c.id || `${i + 1}번 컷`}의 시안은 1~3개 보내 주세요.`);
      return { id: c.id ? String(c.id).toUpperCase() : '', title: text(c.title, 60), desc: text(c.desc, 400), drafts: ds.map((d, j) => ({ title: text(d.title, 60) || `시안 ${j + 1}`, note: text(d.note, 400), svg: cleanSvg(d.svg) })) };
    });
  } else {
    if (!Array.isArray(input) || input.length < 1 || input.length > 4) throw new Error('구도 시안은 1~4개 보내 주세요.');
    groups = [{ id: 'C1', title: '', desc: '', drafts: input.map((d, i) => ({ title: text(d.title, 60) || `시안 ${i + 1}`, note: text(d.note, 400), svg: cleanSvg(d.svg) })) }];
  }
  return mutate(id, by, w => {
    const im = prep(w, ['draft_requested', 'draft_fix']);
    im.round += 1;
    const dir = workDir(w.id);
    const known = new Set((im.cuts || []).map(c => c.id));
    const partial = multi && im.drafts.length && groups.every(g => g.id && known.has(g.id));
    if (im.drafts.length) im.history.unshift({ at: new Date().toISOString(), drafts: im.drafts });
    const picks = partial ? { ...picksOf(im) } : {};
    if (!partial) {
      // 미리 정한 컷(영상 스토리보드)이 있으면 순서대로 맞춘다
      const pre = im.cuts || [];
      im.cuts = groups.map((g, i) => { const old = pre.find(c => c.id === g.id) || pre[i]; return { id: `C${i + 1}`, title: g.title || old?.title || '', desc: g.desc || old?.desc || '', from: old?.from || '' }; });
      if (!multi) im.cuts = [];
      im.drafts = [];
      im.pickNotes = {};
    }
    groups.forEach((g, gi) => {
      const cut = partial ? g.id : `C${gi + 1}`;
      if (partial) {
        im.drafts = im.drafts.filter(d => (d.cut || 'C1') !== cut);
        delete picks[cut];
        const c = im.cuts.find(x => x.id === cut);
        if (g.title) c.title = g.title;
        if (g.desc) c.desc = g.desc;
      }
      g.drafts.forEach((d, i) => {
        const file = `draft-${im.round}-${cut}-${i + 1}.svg`;
        fs.writeFileSync(path.join(dir, file), d.svg);
        im.drafts.push({ id: `D${im.round}-${cut}-${i + 1}`, cut, title: d.title, note: d.note, file });
      });
    });
    const order = cutOrder(im);
    im.drafts.sort((a, b) => (order[a.cut || 'C1'] - order[b.cut || 'C1']));
    im.pick = picks;
    const wasFix = im.stage === 'draft_fix';
    im.stage = 'draft_review';
    const n = groups.reduce((a, g) => a + g.drafts.length, 0);
    return multi ? `${wasFix ? '고친 ' : ''}구도 시안이 들어왔어요 (${partial ? groups.map(g => g.id).join(', ') : `${groups.length}컷`} · 시안 ${n}개)` : (wasFix ? `고친 구도 시안 ${n}개가 들어왔어요` : `구도 시안 ${n}개가 들어왔어요`);
  });
}

// 시안 고르기. 컷이 여러 개면 모든 컷을 고르면 이미지 만들기로 넘어간다.
export function pickDrafts(id, picks, notes = {}, note = '', by = '화면') {
  return mutate(id, by, w => {
    const im = prep(w, ['draft_review']);
    const cur = { ...picksOf(im), ...(picks || {}) };
    for (const [cut, did] of Object.entries(picks || {})) {
      const d = im.drafts.find(x => x.id === did);
      if (!d || (d.cut || 'C1') !== cut) throw new Error(`${cut}에서 고른 시안을 찾을 수 없어요.`);
    }
    im.pick = cur;
    im.pickNotes = { ...(im.pickNotes || {}), ...Object.fromEntries(Object.entries(notes || {}).map(([k, v]) => [k, text(v, 400)])) };
    if (note !== undefined) im.pickNote = text(note);
    const missing = cutsOf(im).filter(c => !cur[c.id]).map(c => c.id);
    if (missing.length) throw new Error(`아직 시안을 고르지 않은 컷이 있어요: ${missing.join(', ')}`);
    im.stage = 'make';
    const one = cutsOf(im).length === 1;
    return one ? `${im.drafts.find(d => d.id === cur.C1)?.title || '고른 시안'}로 이미지 생성을 맡겼어요` : `${cutsOf(im).length}컷의 구도를 골라 이미지 생성을 맡겼어요`;
  });
}
export function pickDraft(id, draftId, note, by = '화면') {
  const im = imageOf(getWork(id));
  const d = im.drafts.find(x => x.id === draftId);
  if (!d) throw new Error('고른 시안을 찾을 수 없어요.');
  return pickDrafts(id, { [d.cut || 'C1']: d.id }, {}, note, by);
}

export function fixDrafts(id, note, by = '화면', cuts = []) {
  const n = text(note);
  if (!n) throw new Error('무엇을 고칠지 한국어로 적어 주세요.');
  return mutate(id, by, w => {
    const im = prep(w, ['draft_review']);
    const list = (cuts || []).map(c => String(c).toUpperCase()).filter(c => cutsOf(im).some(x => x.id === c));
    im.fixes.unshift({ kind: 'draft', note: n, cuts: list, at: new Date().toISOString() });
    im.stage = 'draft_fix';
    return `구도 시안 수정 요청${list.length ? ` (${list.join(', ')})` : ''}: ${n}`;
  });
}

// Claude가 만든 이미지를 받는다: 주소(Higgsfield 결과) 또는 Mac의 파일 경로
export async function submitImages(id, images, note, by = 'Claude', { append = false } = {}) {
  if (!Array.isArray(images) || images.length < 1 || images.length > 40) throw new Error('이미지는 1장 이상 보내 주세요.');
  let w0 = getWork(id);
  const STAGES = [...EARLY.filter(x => x !== 'done'), ...(append ? ['result_review'] : [])];
  const im00 = prep(w0, STAGES);
  // 컷 이름이 아직 없는데 cut이 붙은 이미지가 오면 그 이름으로 컷을 만든다 (이미 만든 이미지 옮기기)
  if (!im00.cuts?.length && !im00.results.length && images.some(i => i?.cut) && new Set(images.map(i => String(i?.cut || '').toUpperCase())).size > 1) {
    w0 = setCuts(id, [...new Set(images.map(i => String(i.cut || '').toUpperCase()))].map(c => ({ id: c, title: '', desc: '' })), by);
  }
  const got = [];
  for (const [i, img] of images.entries()) {
    if (!img?.url && !img?.path) throw new Error(`${i + 1}번째 이미지에 url이나 path가 없어요.`);
    const buf = img.url ? await download(img.url) : readLocal(img.path);
    const kind = sniff(buf);
    if (!kind || kind.kind !== 'image') throw new Error(`${i + 1}번째 파일은 이미지가 아니에요.`);
    const meta = await sharp(buf).metadata().catch(() => ({}));
    const cut = img.cut ? String(img.cut).toUpperCase() : 'C1';
    if (!cutsOf(imageOf(w0)).some(c => c.id === cut)) throw new Error(`${i + 1}번째 이미지의 컷(${img.cut})이 이 작업에 없어요. 컷: ${cutsOf(imageOf(w0)).map(c => c.id).join(', ')}`);
    if (cutsOf(imageOf(w0)).length > 1 && !img.cut) throw new Error(`컷이 여러 개인 작업이에요. ${i + 1}번째 이미지에 cut(C1, C2…)을 넣어 주세요.`);
    got.push({ buf, ext: kind.ext, cut, width: meta.width || 0, height: meta.height || 0, prompt: text(img.prompt, 2000), model: text(img.model, 80), source: img.url ? 'url' : 'file' });
  }
  const many = cutsOf(imageOf(w0)).length > 1;
  if (images.length > (many ? 40 : 8)) throw new Error(`이미지는 ${many ? 40 : 8}장까지 보낼 수 있어요.`);
  return mutate(id, by, w => {
    const im = prep(w, STAGES);
    const skipped = !['make', 'make_fix', 'result_review'].includes(im.stage);
    im.round += 1;
    const dir = workDir(w.id);
    if (im.results.length && !append) im.history.unshift({ at: new Date().toISOString(), results: im.results });
    // 여러 컷이면 이번에 보낸 컷만 바꾸고 나머지 컷의 결과는 그대로 둔다
    const sent = new Set(got.map(g => g.cut));
    const keep = append ? im.results : many ? im.results.filter(r => !sent.has(r.cut || 'C1')) : [];
    const fresh = got.map((g, i) => {
      const file = `result-${im.round}-${i + 1}${g.ext}`;
      fs.writeFileSync(path.join(dir, file), g.buf);
      return { id: `R${im.round}-${i + 1}`, cut: g.cut, file, width: g.width, height: g.height, lowRes: Math.max(g.width, g.height) > 0 && g.width < MIN_WIDTH, prompt: g.prompt, model: g.model, pins: [] };
    });
    const order = cutOrder(im);
    im.results = [...keep, ...fresh].sort((a, b) => order[a.cut || 'C1'] - order[b.cut || 'C1']);
    im.note = text(note);
    const wasFix = im.stage === 'make_fix';
    im.stage = 'result_review';
    return `${wasFix ? '고친 ' : ''}이미지 ${got.length}장이 들어왔어요${many ? ` (${[...sent].join(', ')})` : ''}${skipped ? ' · 구도 시안 없이 바로' : ''}`;
  });
}

export function savePins(id, resultId, pins, by = '화면') {
  if (!Array.isArray(pins) || pins.length > 30) throw new Error('핀은 한 장에 30개까지 남길 수 있어요.');
  const clean = pins.map(p => ({ x: Math.min(100, Math.max(0, Number(p.x) || 0)), y: Math.min(100, Math.max(0, Number(p.y) || 0)), note: text(p.note, 200) }));
  return mutate(id, by, w => {
    const im = prep(w, ['result_review']);
    const r = im.results.find(x => x.id === resultId);
    if (!r) throw new Error('결과 이미지를 찾을 수 없어요.');
    r.pins = clean;
    return `${r.id}에 핀 메모 ${clean.length}개`;
  });
}

export function fixResults(id, note, by = '화면') {
  return mutate(id, by, w => {
    const im = prep(w, ['result_review']);
    const pins = im.results.map(r => ({ result: r.id, pins: r.pins.filter(p => p.note) })).filter(x => x.pins.length);
    const n = text(note);
    if (!n && !pins.length) throw new Error('이미지에 핀 메모를 남기거나, 고칠 점을 적어 주세요.');
    const cuts = [...new Set(pins.map(x => im.results.find(r => r.id === x.result)?.cut || 'C1'))];
    im.fixes.unshift({ kind: 'result', note: n, pins, cuts: cutsOf(im).length > 1 ? cuts : [], at: new Date().toISOString() });
    im.stage = 'make_fix';
    return `이미지 수정 요청 (핀 ${pins.reduce((a, x) => a + x.pins.length, 0)}개${n ? `, "${n}"` : ''})`;
  });
}

// 최종 컨펌: 고른 이미지를 최적화해서 Mac 폴더와 Google Drive에 저장
// upscale: 'none' 원본 크기 유지 · 'local' 프로그램에서 1080px로 확대(무료) · 'higgsfield' Claude가 Higgsfield로 업스케일(크레딧) 후 저장
async function runFinalize(id, ids, enlarge) {
  try {
    const final = await finalizeImages(getWork(id), ids, { enlarge });
    return mutate(id, '프로그램', w => {
      const im = prep(w);
      im.final = { ...final, picked: ids };
      im.stage = 'done';
      im.upscale = null;
      return `최적화해서 저장했어요${final.drive.status === 'copied' ? ' (Google Drive에도 복사)' : final.drive.status === 'failed' ? ` · Google Drive 복사 실패: ${final.drive.error}` : ''}`;
    });
  } catch (e) {
    mutate(id, '프로그램', w => { const im = prep(w); im.stage = 'result_review'; im.error = e.message; im.upscale = null; return `최종 처리 실패: ${e.message}`; });
    throw e;
  }
}

export async function finalConfirm(id, resultIds, upscale = 'none', by = '화면') {
  const w0 = getWork(id);
  const im0 = prep(w0, ['result_review', 'finalizing']); // 처리 중 프로그램이 꺼졌으면 다시 시도할 수 있게
  const order = cutOrder(im0);
  const ids = im0.results.filter(r => (resultIds || []).includes(r.id)).sort((a, b) => order[a.cut || 'C1'] - order[b.cut || 'C1']).map(r => r.id); // 컷 순서대로 01, 02…
  if (!ids.length) throw new Error('최종으로 쓸 이미지를 하나 이상 골라 주세요.');
  if (!['none', 'local', 'higgsfield'].includes(upscale)) throw new Error('업스케일 방식을 골라 주세요.');
  if (upscale === 'higgsfield') {
    return mutate(id, by, w => { const im = prep(w); im.stage = 'upscale'; im.error = ''; im.upscale = { ids, at: new Date().toISOString() }; return `최종 컨펌 (${ids.join(', ')}) · Higgsfield 업스케일을 Claude에게 맡겼어요`; });
  }
  mutate(id, by, w => { const im = prep(w); im.stage = 'finalizing'; im.error = ''; return `최종 컨펌 (${ids.join(', ')})${upscale === 'local' ? ' · 프로그램에서 확대' : ''}`; });
  return runFinalize(id, ids, upscale === 'local');
}

// Claude가 Higgsfield로 업스케일한 이미지를 받고, 바로 최종 저장까지 진행한다
export async function submitUpscaled(id, items, by = 'Claude') {
  const w0 = getWork(id);
  const im0 = prep(w0, ['upscale']);
  const ids = im0.upscale.ids;
  if (!Array.isArray(items) || !items.length) throw new Error('업스케일한 이미지를 보내 주세요.');
  const got = [];
  for (const it of items) {
    const rid = String(it.result_id || '').toUpperCase();
    if (!ids.includes(rid)) throw new Error(`${rid}는 최종으로 고른 이미지가 아니에요. 고른 이미지: ${ids.join(', ')}`);
    const buf = it.url ? await download(it.url) : it.path ? readLocal(it.path) : null;
    if (!buf) throw new Error(`${rid}의 url이나 path가 없어요.`);
    const kind = sniff(buf);
    if (!kind || kind.kind !== 'image') throw new Error(`${rid} 파일은 이미지가 아니에요.`);
    const meta = await sharp(buf).metadata().catch(() => ({}));
    got.push({ rid, buf, ext: kind.ext, width: meta.width || 0, height: meta.height || 0 });
  }
  const missing = ids.filter(x => !got.some(g => g.rid === x));
  if (missing.length) throw new Error(`업스케일한 이미지가 빠졌어요: ${missing.join(', ')}`);
  mutate(id, by, w => {
    const im = prep(w, ['upscale']);
    const dir = workDir(w.id);
    for (const g of got) {
      const r = im.results.find(x => x.id === g.rid);
      r.upscaled = `up-${g.rid}${g.ext}`;
      fs.writeFileSync(path.join(dir, r.upscaled), g.buf);
      r.upWidth = g.width; r.upHeight = g.height;
    }
    im.stage = 'finalizing';
    return `업스케일한 이미지 ${got.length}장이 들어왔어요`;
  });
  return runFinalize(id, ids, false);
}

// Claude에게 줄 작업 정보: 파일 이름 대신 실제 경로를 넣는다
export function imageForClaude(w) {
  const im = imageOf(w);
  const dir = workDir(w.id);
  const abs = f => path.join(dir, f);
  return {
    stage: im.stage, stageLabel: IMAGE_STAGE[im.stage], request: im.request,
    cuts: cutsOf(im).length > 1 ? cutsOf(im).map(c => { const d = im.drafts.find(x => x.id === picksOf(im)[c.id]); return { ...c, pickedDraft: d ? { ...d, file: abs(d.file), note: im.pickNotes?.[c.id] || '' } : null }; }) : undefined,
    drafts: im.drafts.map(d => ({ ...d, file: abs(d.file) })),
    pickedDraft: cutsOf(im).length > 1 ? undefined : (() => { const d = im.drafts.find(x => x.id === picksOf(im).C1); return d ? { ...d, file: abs(d.file), note: im.pickNote } : null; })(),
    pickNote: cutsOf(im).length > 1 ? im.pickNote : undefined,
    minWidth: MIN_WIDTH,
    results: im.results.map(r => ({ ...r, file: abs(r.file) })),
    latestFix: im.fixes[0] || null,
    upscale: im.stage === 'upscale' ? { ids: im.upscale.ids, files: im.upscale.ids.map(x => { const r = im.results.find(y => y.id === x); return { result_id: x, file: abs(r.file), width: r.width, height: r.height }; }) } : null,
    final: im.final
  };
}
