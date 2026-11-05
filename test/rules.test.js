import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-test-'));
const { ensureData, load } = await import('../lib/store.js');
const R = await import('../lib/rules.js');
ensureData();

test('금지 표현을 단어 단위로 찾는다', () => {
  const r = R.checkText({ text: 'This cream lifts skin in minutes.', account: 'GLOBAL' });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some(i => i.word === 'lifts skin'));
  // "cure"가 "secure" 안에서 잡히면 안 된다
  assert.equal(R.checkText({ text: 'A secure, comfortable finish.', account: 'GLOBAL' }).ok, true);
  // 어미가 바뀌어도 잡는다
  assert.ok(R.checkText({ text: 'It heals and treats dryness.', account: 'GLOBAL' }).issues.some(i => i.word === 'heal'));
  assert.equal(R.checkText({ text: 'A healthy-looking glow.', account: 'GLOBAL' }).ok, true);
});

test('일본어 금지 표현을 찾고, 판매명은 전성분 페이지에만 쓰도록 막는다', () => {
  const r = R.checkText({ text: '肌を再生するセラム', account: 'JP', product: 'GTCP' });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some(i => i.word === '再生'));
  const sales = R.checkText({ text: 'ダムティックスGTCPセラムが、肌を整えます。', account: 'JP', product: 'GTCP' });
  assert.equal(sales.ok, false, '판매명은 콘텐츠에서 막아요');
  assert.ok(sales.issues.some(i => i.type === 'jp_sales_name' && i.level === 'block'));
  const good = R.checkText({ text: 'Green Tea Callus PDRN Serum 美容液で、肌を整えます。', account: 'JP', product: 'GTCP' });
  assert.equal(good.ok, true);
  assert.equal(good.issues.length, 0);
});

test('미국 전용 제품은 일본·유럽 계정에서 막힌다', () => {
  assert.equal(R.checkText({ text: 'Bright look.', account: 'GLOBAL', product: 'DSS' }).ok, true);
  const jp = R.checkText({ text: '明るい印象に。', account: 'JP', product: 'DSS' });
  assert.ok(jp.issues.some(i => i.type === 'not_sold' && i.level === 'block'));
});

test('기준을 바꾸면 버전이 오르고 기록이 남는다', () => {
  const before = load('brand').version;
  const r = R.applyChange({ key: 'brand.tone', draft: { EU: '테스트 톤' }, reason: '테스트' });
  assert.equal(load('brand').version, R.bumpBrand(before));
  assert.equal(load('brand').tone.EU, '테스트 톤');
  assert.equal(load('history')[0].label, r.label);
  assert.throws(() => R.applyChange({ key: 'brand.tone', draft: { EU: '테스트 톤' } }), /바뀐 내용이 없어요/);
});

test('제품 기준을 바꾸면 그 제품 버전만 오른다', () => {
  const v = load('products').find(p => p.code === 'P7XL').version;
  R.applyChange({ key: 'product.P7XL.markets', draft: { JP: false } });
  const p = load('products').find(p => p.code === 'P7XL');
  assert.equal(p.version, v + 1);
  assert.equal(p.markets.JP, false);
  assert.equal(load('products').find(p => p.code === 'GTCP').version, 1);
});

test('제안은 승인해야 반영된다', () => {
  const pr = R.addProposal({ key: 'product.GTCN.content', field: 'usage', newValue: '새 사용법', reason: '테스트' });
  assert.notEqual(load('products').find(p => p.code === 'GTCN').usage, '새 사용법');
  R.acceptProposal(pr.id);
  assert.equal(load('products').find(p => p.code === 'GTCN').usage, '새 사용법');
  assert.equal(load('proposals').length, 0);
  assert.throws(() => R.addProposal({ key: 'brand.core', field: 'nope', newValue: 'x' }), /항목이 없어요/);
});

test('되돌리기는 그 시점 기준으로 돌아가고 버전은 계속 오른다', () => {
  const history = load('history');
  const first = history[history.length - 1];
  const verBefore = load('brand').version;
  R.rollback(first.id);
  assert.notEqual(load('brand').tone.EU, '테스트 톤');
  assert.equal(load('brand').version, R.bumpBrand(verBefore));
  const p7 = load('products').find(p => p.code === 'P7XL');
  assert.equal(p7.markets.JP, true);
  assert.equal(p7.version, 3);
  assert.match(load('history')[0].label, /복원/);
});
