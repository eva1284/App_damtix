// 이미지 제작 흐름: 구도 시안 맡기기 → Claude가 SVG 시안 제출 → 사용자가 고름 → Claude가 Higgsfield로 생성해 제출
// → 사용자가 핀 메모로 검수 → 수정 요청 또는 최종 컨펌 → 최적화·폴더 저장·Drive 복사
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

const blank = () => ({ stage: 'none', request: null, drafts: [], pick: null, pickNote: '', results: [], round: 0, fixes: [], history: [], final: null, error: '' });
export const imageOf = w => w.image || blank();

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
    if (im.stage === 'done') { im.history.unshift({ at: new Date().toISOString(), drafts: im.drafts, results: im.results, final: im.final }); im.drafts = []; im.results = []; im.final = null; im.pick = null; }
    im.stage = 'draft_requested';
    im.request = { note: text(note), at: new Date().toISOString() };
    return '구도 시안을 Claude에게 맡겼어요';
  });
}

export function submitDrafts(id, drafts, by = 'Claude') {
  if (!Array.isArray(drafts) || drafts.length < 1 || drafts.length > 4) throw new Error('구도 시안은 1~4개 보내 주세요.');
  const clean = drafts.map((d, i) => ({ title: text(d.title, 60) || `시안 ${i + 1}`, note: text(d.note, 400), svg: cleanSvg(d.svg) }));
  return mutate(id, by, w => {
    const im = prep(w, ['draft_requested', 'draft_fix']);
    im.round += 1;
    const dir = workDir(w.id);
    if (im.drafts.length) im.history.unshift({ at: new Date().toISOString(), drafts: im.drafts });
    im.drafts = clean.map((d, i) => {
      const file = `draft-${im.round}-${i + 1}.svg`;
      fs.writeFileSync(path.join(dir, file), d.svg);
      return { id: `D${im.round}-${i + 1}`, title: d.title, note: d.note, file };
    });
    const wasFix = im.stage === 'draft_fix';
    im.stage = 'draft_review';
    return wasFix ? `고친 구도 시안 ${clean.length}개가 들어왔어요` : `구도 시안 ${clean.length}개가 들어왔어요`;
  });
}

export function pickDraft(id, draftId, note, by = '화면') {
  return mutate(id, by, w => {
    const im = prep(w, ['draft_review']);
    const d = im.drafts.find(x => x.id === draftId);
    if (!d) throw new Error('고른 시안을 찾을 수 없어요.');
    im.pick = d.id;
    im.pickNote = text(note);
    im.stage = 'make';
    return `${d.title}로 이미지 생성을 맡겼어요`;
  });
}

export function fixDrafts(id, note, by = '화면') {
  const n = text(note);
  if (!n) throw new Error('무엇을 고칠지 한국어로 적어 주세요.');
  return mutate(id, by, w => {
    const im = prep(w, ['draft_review']);
    im.fixes.unshift({ kind: 'draft', note: n, at: new Date().toISOString() });
    im.stage = 'draft_fix';
    return `구도 시안 수정 요청: ${n}`;
  });
}

// Claude가 만든 이미지를 받는다: 주소(Higgsfield 결과) 또는 Mac의 파일 경로
export async function submitImages(id, images, note, by = 'Claude') {
  if (!Array.isArray(images) || images.length < 1 || images.length > 8) throw new Error('이미지는 1~8장 보내 주세요.');
  const w0 = getWork(id);
  prep(w0, ['make', 'make_fix']);
  const got = [];
  for (const [i, img] of images.entries()) {
    if (!img?.url && !img?.path) throw new Error(`${i + 1}번째 이미지에 url이나 path가 없어요.`);
    const buf = img.url ? await download(img.url) : readLocal(img.path);
    const kind = sniff(buf);
    if (!kind || kind.kind !== 'image') throw new Error(`${i + 1}번째 파일은 이미지가 아니에요.`);
    const meta = await sharp(buf).metadata().catch(() => ({}));
    got.push({ buf, ext: kind.ext, width: meta.width || 0, height: meta.height || 0, prompt: text(img.prompt, 2000), model: text(img.model, 80), source: img.url ? 'url' : 'file' });
  }
  return mutate(id, by, w => {
    const im = prep(w, ['make', 'make_fix']);
    im.round += 1;
    const dir = workDir(w.id);
    if (im.results.length) im.history.unshift({ at: new Date().toISOString(), results: im.results });
    im.results = got.map((g, i) => {
      const file = `result-${im.round}-${i + 1}${g.ext}`;
      fs.writeFileSync(path.join(dir, file), g.buf);
      return { id: `R${im.round}-${i + 1}`, file, width: g.width, height: g.height, prompt: g.prompt, model: g.model, pins: [] };
    });
    im.note = text(note);
    const wasFix = im.stage === 'make_fix';
    im.stage = 'result_review';
    return wasFix ? `고친 이미지 ${got.length}장이 들어왔어요` : `이미지 ${got.length}장이 들어왔어요`;
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
    im.fixes.unshift({ kind: 'result', note: n, pins, at: new Date().toISOString() });
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
      return `최적화해서 저장했어요${final.drive.status === 'copied' ? ' (Google Drive에도 복사)' : ''}`;
    });
  } catch (e) {
    mutate(id, '프로그램', w => { const im = prep(w); im.stage = 'result_review'; im.error = e.message; im.upscale = null; return `최종 처리 실패: ${e.message}`; });
    throw e;
  }
}

export async function finalConfirm(id, resultIds, upscale = 'none', by = '화면') {
  const w0 = getWork(id);
  const im0 = prep(w0, ['result_review', 'finalizing']); // 처리 중 프로그램이 꺼졌으면 다시 시도할 수 있게
  const ids = (resultIds || []).filter(x => im0.results.some(r => r.id === x));
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
    drafts: im.drafts.map(d => ({ ...d, file: abs(d.file) })),
    pickedDraft: (() => { const d = im.drafts.find(x => x.id === im.pick); return d ? { ...d, file: abs(d.file), note: im.pickNote } : null; })(),
    results: im.results.map(r => ({ ...r, file: abs(r.file) })),
    latestFix: im.fixes[0] || null,
    upscale: im.stage === 'upscale' ? { ids: im.upscale.ids, files: im.upscale.ids.map(x => { const r = im.results.find(y => y.id === x); return { result_id: x, file: abs(r.file), width: r.width, height: r.height }; }) } : null,
    final: im.final
  };
}
