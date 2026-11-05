import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-works-'));
const { ensureData } = await import('../lib/store.js');
const W = await import('../lib/works.js');
ensureData();

const base = { type: 'image', account: 'JP', product: 'GTCP', date: '2026-11-12', title: '아침 루틴 PDRN 세럼', memo: '아침 루틴 느낌' };

test('작업 번호는 종류별로 이어진다', () => {
  assert.equal(W.createWork(base).id, 'IMG-001');
  assert.equal(W.createWork({ ...base, title: '두 번째' }).id, 'IMG-002');
  assert.equal(W.createWork({ ...base, type: 'video' }).id, 'VID-001');
});

test('팔지 않는 시장, 잘못된 자사몰 조합은 막는다', () => {
  assert.throws(() => W.createWork({ ...base, product: 'DSS' }), /팔지 않는 제품/);
  assert.throws(() => W.createWork({ ...base, type: 'html' }), /자사몰/);
  assert.throws(() => W.createWork({ ...base, account: 'SHOP', store: 'damtix.shop' }), /HTML 작업만/);
  assert.throws(() => W.createWork({ ...base, date: '11/12' }), /YYYY-MM-DD/);
  const h = W.createWork({ ...base, type: 'html', account: 'SHOP', store: 'damtix.eu', product: 'HGB' });
  assert.equal(h.id, 'HTML-001');
  assert.throws(() => W.requestCaption(h.id), /캡션이 없어요/);
});

test('캡션: 맡기기 → Claude 제출 → 수정 요청 → 다시 제출 → 컨펌', () => {
  const w = W.createWork({ ...base, title: '캡션 흐름', requestCaption: true, captionNote: '질문으로 시작' });
  assert.equal(w.caption.status, 'requested');
  assert.ok(W.queue().some(q => q.workId === w.id && q.task === '캡션 쓰기' && q.direction === '질문으로 시작'));

  // 금지 표현이 있으면 저장하지 않는다
  assert.throws(() => W.submitCaption({ id: w.id, text: 'Green Tea Callus PDRN Serum 美容液で肌を再生。', backTranslation: '피부 재생', hashtags: [] }), /브랜드 기준에 맞지 않아/);
  // 역번역·해시태그 뜻이 없으면 받지 않는다
  assert.throws(() => W.submitCaption({ id: w.id, text: 'Green Tea Callus PDRN Serum 美容液が肌を整えます。', backTranslation: '', hashtags: [] }), /역번역/);
  assert.throws(() => W.submitCaption({ id: w.id, text: 'Green Tea Callus PDRN Serum 美容液が肌を整えます。', backTranslation: '정돈', hashtags: [{ tag: '韓国コスメ' }] }), /한국어 뜻/);

  let r = W.submitCaption({ id: w.id, text: 'Green Tea Callus PDRN Serum 美容液が肌を整えます。', backTranslation: '그린티 캘러스 PDRN 세럼 미용액이 피부를 정돈합니다.', hashtags: [{ tag: '韓国コスメ', ko: '한국 화장품' }] });
  assert.equal(r.caption.status, 'review');
  assert.equal(r.caption.current.hashtags[0].tag, '#韓国コスメ');
  assert.ok(!W.queue().some(q => q.workId === w.id));

  assert.throws(() => W.fixCaption(w.id, ''), /한국어로 적어/);
  r = W.fixCaption(w.id, '더 산뜻한 느낌으로');
  assert.equal(r.caption.status, 'fix');
  const q = W.queue().find(x => x.workId === w.id);
  assert.equal(q.task, '캡션 고치기');
  assert.equal(q.fixRequest, '더 산뜻한 느낌으로');

  r = W.submitCaption({ id: w.id, text: 'Green Tea Callus PDRN Serum 美容液で、さっぱり整う肌へ。', backTranslation: '담틱스 GTCP 세럼으로 산뜻하게 정돈된 피부로.', hashtags: [] });
  assert.equal(r.caption.versions.length, 1);
  assert.equal(W.confirmCaption(w.id).caption.status, 'confirmed');
  assert.equal(W.reopenCaption(w.id).caption.status, 'review');
});

test('기획 수정과 삭제', () => {
  const w = W.createWork({ ...base, title: '수정 전' });
  const u = W.updateWork(w.id, { title: '수정 후', date: '2026-11-20' });
  assert.equal(u.title, '수정 후');
  assert.match(u.log[0].what, /제목, 게시일/);
  assert.throws(() => W.updateWork(w.id, { product: 'DSS' }), /팔지 않는 제품/);
  W.deleteWork(w.id);
  assert.throws(() => W.getWork(w.id), /찾을 수 없어요/);
});
