import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

process.env.CC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cuts-'));
const { ensureData, load, save } = await import('../lib/store.js');
const W = await import('../lib/works.js');
const IM = await import('../lib/imagework.js');
const V = await import('../lib/videowork.js');
const M = await import('../lib/motion.js');
const { claudeQueue } = await import('../lib/queue.js');
const { finalsConfig, setFinals, optimizeImage } = await import('../lib/finalize.js');
ensureData();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cutfiles-'));
const imageRoot = path.join(tmp, '이미지정리'); fs.mkdirSync(imageRoot);
const c = load('config'); c.imageRoot = imageRoot; save('config', c);
finalsConfig(); setFinals({ driveFolder: '' });
const svg = n => `<svg viewBox="0 0 1080 1920"><rect width="1080" height="1920" fill="#ddd"/><text x="10" y="50">${n}</text></svg>`;
const img = async (name, w, h, color = '#888') => { const f = path.join(tmp, name); await sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toFile(f); return f; };

test('여러 컷 이미지: 컷마다 시안 고르기 → 컷마다 생성 → 일부 컷만 고치기 → 컷 순서대로 저장', async () => {
  const w = W.createWork({ type: 'image', account: 'JP', product: 'P7XL', date: '2026-11-25', title: '5컷 캐러셀' });
  IM.requestDrafts(w.id, '3컷 스토리');
  IM.submitDrafts(w.id, { cuts: [
    { title: '뚜껑', desc: '뚜껑 여는 손', drafts: [{ title: 'A', note: '', svg: svg('1A') }, { title: 'B', note: '', svg: svg('1B') }] },
    { title: '바르기', desc: '턱선', drafts: [{ title: 'A', note: '', svg: svg('2A') }] },
    { title: '제품', desc: '정면', drafts: [{ title: 'A', note: '', svg: svg('3A') }] }
  ] });
  let im = W.getWork(w.id).image;
  assert.deepEqual(im.cuts.map(c => c.id), ['C1', 'C2', 'C3']);
  assert.equal(im.drafts.length, 4);
  assert.throws(() => IM.pickDrafts(w.id, { C1: im.drafts[1].id }), /C2, C3/);
  // 고친 컷만 다시 받으면 나머지 컷의 선택은 그대로
  IM.fixDrafts(w.id, '2번 컷 손을 더 크게', '화면', ['C2']);
  assert.deepEqual(W.getWork(w.id).image.fixes[0].cuts, ['C2']);
  IM.submitDrafts(w.id, { cuts: [{ id: 'C2', title: '바르기', desc: '턱선 손 크게', drafts: [{ title: 'A2', note: '', svg: svg('2A2') }] }] });
  im = W.getWork(w.id).image;
  assert.equal(im.drafts.length, 4);
  assert.ok(im.drafts.some(d => d.id === 'D1-C1-2'), '고치지 않은 C1 시안은 남아요');
  assert.equal(im.cuts[1].desc, '턱선 손 크게');
  IM.pickDrafts(w.id, { C1: 'D1-C1-2', C2: im.drafts.find(d => d.cut === 'C2').id, C3: im.drafts.find(d => d.cut === 'C3').id }, { C3: '배경 회색' }, '같은 모델');
  im = W.getWork(w.id).image;
  assert.equal(im.stage, 'make');
  const task = claudeQueue().find(t => t.workId === w.id);
  assert.equal(task.image.cuts.length, 3);
  assert.equal(task.image.cuts[2].pickedDraft.note, '배경 회색');

  const big = await img('big.png', 2160, 3840), small = await img('small.png', 896, 1592);
  await assert.rejects(IM.submitImages(w.id, [{ path: big }]), /cut/);
  await IM.submitImages(w.id, [{ path: big, cut: 'C1' }, { path: small, cut: 'C2' }, { path: big, cut: 'C3' }, { path: big, cut: 'C3' }]);
  im = W.getWork(w.id).image;
  assert.equal(im.results.length, 4);
  assert.equal(im.results.find(r => r.cut === 'C2').lowRes, true);
  // C2만 고치기
  IM.savePins(w.id, im.results.find(r => r.cut === 'C2').id, [{ x: 50, y: 50, note: '더 선명하게' }]);
  IM.fixResults(w.id, '');
  assert.deepEqual(W.getWork(w.id).image.fixes[0].cuts, ['C2']);
  await IM.submitImages(w.id, [{ path: big, cut: 'C2' }]);
  im = W.getWork(w.id).image;
  assert.deepEqual(im.results.map(r => r.cut), ['C1', 'C2', 'C3', 'C3']);
  assert.ok(!im.results.some(r => r.lowRes));
  // 최종: 고른 순서와 상관없이 컷 순서대로 01, 02, 03
  const pick = [im.results[3].id, im.results[0].id, im.results[1].id];
  const r = await IM.finalConfirm(w.id, pick, 'none');
  const files = r.image.final.files;
  assert.deepEqual(files.map(f => f.cut), ['C1', 'C2', 'C3']);
  assert.deepEqual(files.map(f => f.name), [`${w.id}_JP_P7XL_01.jpg`, `${w.id}_JP_P7XL_02.jpg`, `${w.id}_JP_P7XL_03.jpg`]);
  assert.equal(files[0].width, 1080);
  assert.equal(M.soldAccounts(W.getWork(w.id)).length, 3);
});

test('영상 스토리보드에서 컷 이미지 작업을 한 번에 만들고 컷끼리 연결한다', async () => {
  const v = W.createWork({ type: 'video', account: 'GLOBAL', product: 'P7XL', date: '2026-11-26', title: '밤 루틴' });
  V.requestStory(v.id, '');
  V.submitStory(v.id, { cuts: [{ start: 0, end: 2, desc: '뚜껑 여는 손', camera: '클로즈업' }, { start: 2, end: 4, desc: '턱선 마사지' }] });
  const iw = V.createCutImages(v.id);
  assert.equal(iw.type, 'image');
  assert.equal(iw.image.stage, 'draft_requested');
  assert.deepEqual(iw.image.cuts.map(c => c.from), [`${v.id}:C1`, `${v.id}:C2`]);
  assert.match(iw.image.cuts[0].desc, /클로즈업/);
  assert.deepEqual(W.getWork(v.id).video.story.cuts.map(c => c.fromImage), [`${iw.id}:C1`, `${iw.id}:C2`]);
  const task = claudeQueue().find(t => t.workId === iw.id);
  assert.equal(task.task, '구도 시안 만들기');
  assert.equal(task.image.cuts.length, 2);
  assert.throws(() => V.setCutImage(v.id, 'C1', `${iw.id}:C9`), /C9 컷이 없어요/);
  // 컷 이미지가 생기면 모션 그래픽 재료로 쓸 수 있다
  IM.submitDrafts(iw.id, { cuts: [{ title: 'a', desc: 'a', drafts: [{ title: 'A', note: '', svg: svg('a') }] }, { title: 'b', desc: 'b', drafts: [{ title: 'A', note: '', svg: svg('b') }] }] });
  assert.equal(W.getWork(iw.id).image.cuts[0].from, `${v.id}:C1`, '미리 정한 컷 정보는 유지돼요');
  const im = W.getWork(iw.id).image;
  IM.pickDrafts(iw.id, { C1: im.drafts[0].id, C2: im.drafts[1].id });
  const f = await img('c2.png', 1080, 1920, '#333');
  await IM.submitImages(iw.id, [{ path: f, cut: 'C2' }]);
  assert.equal(await M.resolveSrc(`${iw.id}:C2`, W.getWork(v.id)), path.join(process.env.CC_DATA_DIR, 'works', iw.id, W.getWork(iw.id).image.results[0].file));
  await assert.rejects(M.resolveSrc(`${iw.id}:C1`, W.getWork(v.id)), /C1 컷에 아직 이미지가 없어요/);
});

test('최종 이미지 화질: 4:4:4 고화질 JPEG, 큰 이미지는 1080px로 줄이고 작은 이미지는 그대로', async () => {
  const big = await img('q-big.png', 2160, 2700, '#c03030');
  const out = path.join(tmp, 'q.jpg');
  const r = await optimizeImage(big, out);
  assert.equal(r.width, 1080); assert.equal(r.height, 1350);
  assert.deepEqual(r.source, { width: 2160, height: 2700 });
  const meta = await sharp(out).metadata();
  assert.equal(meta.chromaSubsampling, '4:4:4');
  const small = await img('q-small.png', 896, 1120);
  assert.equal((await optimizeImage(small, path.join(tmp, 'q2.jpg'))).width, 896);
  assert.equal((await optimizeImage(small, path.join(tmp, 'q3.jpg'), { enlarge: true })).width, 1080);
});
