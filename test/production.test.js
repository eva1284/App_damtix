import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

process.env.CC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-prod-'));
const { ensureData, load, save } = await import('../lib/store.js');
const W = await import('../lib/works.js');
const R = await import('../lib/refs.js');
const IM = await import('../lib/imagework.js');
const { claudeQueue } = await import('../lib/queue.js');
const { finalsConfig, setFinals } = await import('../lib/finalize.js');
ensureData();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-files-'));
const imageRoot = path.join(tmp, '이미지정리'); fs.mkdirSync(imageRoot);
const drive = path.join(tmp, 'GoogleDrive', '내 드라이브'); fs.mkdirSync(drive, { recursive: true });
const c = load('config'); c.imageRoot = imageRoot; save('config', c);
finalsConfig(); setFinals({ driveFolder: drive });

const big = path.join(tmp, 'big.png');
await sharp({ create: { width: 2400, height: 3000, channels: 3, background: '#8a8a88' } }).png().toFile(big);
const smallBuf = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#222' } }).jpeg().toBuffer();

test('레퍼런스: 파일·주소 추가, 형식 확인, 연결, 분석', () => {
  const f = R.addFileRef({ buffer: smallBuf, filename: '핀터레스트.jpg' });
  assert.equal(f.id, 'REF-001');
  assert.equal(f.kind, 'image');
  assert.throws(() => R.addFileRef({ buffer: Buffer.from('hello world, not an image'), filename: 'x.jpg' }), /파일만 넣을 수 있어요/);
  const u = R.addUrlRef({ url: 'https://www.tiktok.com/@a/video/1', work: 'IMG-001' });
  assert.equal(u.source, 'TikTok');
  assert.equal(u.kind, 'video');
  assert.equal(R.addUrlRef({ url: 'https://www.tiktok.com/@a/video/1' }).id, u.id); // 같은 주소는 하나로
  R.link(f.id, 'IMG-001', 'cut:1');
  assert.equal(R.refsFor('IMG-001').length, 2);
  R.unlink(f.id, 'IMG-001', 'cut:1');
  assert.equal(R.refsFor('IMG-001').length, 1);
  assert.throws(() => R.submitAnalysis({ id: f.id, summary: '' }), /비어 있어요/);
  assert.equal(R.submitAnalysis({ id: f.id, summary: '위에서 내려다본 플랫레이', tags: ['구도'] }).status, 'done');
  assert.ok(claudeQueue().some(t => t.kind === 'reference' && t.refId === u.id));
});

test('이미지 제작: 시안 → 고르기 → 생성 → 핀 수정 요청 → 재생성 → 최종 컨펌 → 최적화·저장·Drive 복사', async () => {
  const w = W.createWork({ type: 'image', account: 'JP', product: 'GTCP', date: '2026-11-12', title: '아침 루틴', memo: '그린 톤' });
  IM.requestDrafts(w.id, '제품 크게');
  let q = claudeQueue().find(t => t.workId === w.id && t.kind === 'image');
  assert.equal(q.task, '구도 시안 만들기');
  assert.equal(q.image.request.note, '제품 크게');

  assert.throws(() => IM.submitDrafts(w.id, [{ svg: '<div>no</div>' }]), /<svg>/);
  const evil = '<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><rect width="10" height="10"/><a href="javascript:alert(3)"><text>x</text></a></svg>';
  let r = IM.submitDrafts(w.id, [{ title: '시안 A', svg: evil }, { title: '시안 B', svg: '<svg viewBox="0 0 10 10"><circle r="4"/></svg>' }]);
  assert.equal(r.image.stage, 'draft_review');
  const saved = fs.readFileSync(path.join(process.env.CC_DATA_DIR, 'works', w.id, r.image.drafts[0].file), 'utf8');
  assert.ok(!/script|onload|javascript/i.test(saved), saved);

  assert.throws(() => IM.fixDrafts(w.id, ''), /한국어로 적어/);
  IM.fixDrafts(w.id, '제품 더 크게');
  assert.equal(claudeQueue().find(t => t.workId === w.id && t.kind === 'image').task, '구도 시안 고치기');
  r = IM.submitDrafts(w.id, [{ title: '시안 A2', svg: '<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>' }]);
  assert.equal(r.image.history.length, 1);
  IM.pickDraft(w.id, r.image.drafts[0].id, '빛은 더 부드럽게');
  q = claudeQueue().find(t => t.workId === w.id && t.kind === 'image');
  assert.equal(q.task, '이미지 만들기');
  assert.ok(q.image.pickedDraft.file.endsWith('.svg'));

  await assert.rejects(IM.submitImages(w.id, [{ path: path.join(tmp, 'nope.png') }]), /찾을 수 없어요/);
  r = await IM.submitImages(w.id, [{ path: big, prompt: 'green tea serum', model: 'test' }, { path: big }]);
  assert.equal(r.image.stage, 'result_review');
  assert.equal(r.image.results.length, 2);

  IM.savePins(w.id, r.image.results[0].id, [{ x: 72, y: 44, note: '뚜껑 반사 줄이기' }, { x: 300, y: -5, note: '' }]);
  const pins = W.getWork(w.id).image.results[0].pins;
  assert.deepEqual(pins[1], { x: 100, y: 0, note: '' });
  IM.fixResults(w.id, '');
  q = claudeQueue().find(t => t.workId === w.id && t.kind === 'image');
  assert.equal(q.task, '이미지 고치기');
  assert.equal(q.image.latestFix.pins[0].pins[0].note, '뚜껑 반사 줄이기');
  assert.equal(q.image.latestFix.pins[0].pins.length, 1); // 메모 없는 핀은 빼고 보낸다

  r = await IM.submitImages(w.id, [{ path: big }]);
  await assert.rejects(IM.finalConfirm(w.id, []), /하나 이상/);

  // 캡션도 컨펌된 상태로 만들어 두면 캡션 파일도 같이 저장된다
  W.requestCaption(w.id);
  W.submitCaption({ id: w.id, text: 'Green Tea Callus PDRN Serum 美容液が肌を整えます。', backTranslation: '그린티 캘러스 PDRN 세럼 미용액이 피부를 정돈합니다.', hashtags: [{ tag: '韓国コスメ', ko: '한국 화장품' }] });
  W.confirmCaption(w.id);

  r = await IM.finalConfirm(w.id, [r.image.results[0].id]);
  assert.equal(r.image.stage, 'done');
  const f = r.image.final;
  assert.equal(f.files.length, 1);
  assert.ok(f.files[0].after < f.files[0].before);
  assert.equal(f.files[0].width, 1080);
  assert.equal(f.files[0].height, 1350);
  assert.ok(f.folder.includes(path.join('완성본 (contents controller)', 'JP', `2026-11-12_${w.id}`)));
  assert.deepEqual(fs.readdirSync(f.folder).sort(), [`${w.id}_JP_GTCP_01.jpg`, 'caption_ja.txt', 'caption_ko.txt'].sort());
  assert.match(fs.readFileSync(path.join(f.folder, 'caption_ja.txt'), 'utf8'), /#韓国コスメ/);
  assert.equal(f.drive.status, 'copied');
  assert.equal(fs.readdirSync(f.drive.path).length, 3);
  assert.ok(!claudeQueue().some(t => t.workId === w.id));
});

test('이미지 단계는 이미지 작업에서만', () => {
  const v = W.createWork({ type: 'video', account: 'GLOBAL', product: 'P7XL', date: '2026-11-13', title: '영상' });
  assert.throws(() => IM.requestDrafts(v.id), /이미지 작업에서만/);
});
