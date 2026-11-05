import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-handover-'));
const dir = process.env.CC_DATA_DIR;
const fx = n => JSON.parse(fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
// 인수인계서 반영 전의 데이터 + 사용자가 직접 고친 값 하나
const brand = fx('brand-before-handover.json');
brand.tone.GLOBAL = '사용자가 직접 고친 톤';
brand.version = '1.4';
fs.writeFileSync(path.join(dir, 'brand.json'), JSON.stringify(brand));
fs.writeFileSync(path.join(dir, 'products.json'), JSON.stringify(fx('products-before-handover.json')));

const store = await import('../lib/store.js');
const { applyHandover } = await import('../lib/handover.js');
const { rollback, checkText } = await import('../lib/rules.js');
const { queue } = await import('../lib/works.js');
store.ensureData();

test('인수인계서 반영: 처음 값과 빈 칸만 바꾸고 사용자가 고친 값은 그대로, 한 번만, 되돌리기 가능', async () => {
  const before = store.load('history')[0].id;
  const r = applyHandover();
  assert.ok(r.changed.length > 5);
  const b = store.load('brand');
  assert.equal(b.version, '1.5');
  assert.equal(b.tone.GLOBAL, '사용자가 직접 고친 톤');
  assert.match(b.tone.JP, /ご連絡いたします/);
  assert.equal(b.core.slogan, 'Aesthetic precision, brought to your routine — FROM SEOUL');
  assert.match(b.rules.JP_ban, /たるみ/);
  assert.match(b.rules.GLOBAL_ban, /^treat, heal/, '원래 금지 표현은 그대로 앞에');
  assert.match(b.rules.GLOBAL_ban, /giveaway/);
  assert.match(b.visual.light, /쿨톤/);
  assert.match(b.visual.type, /palt/);
  assert.match(b.work.process, /하나만 먼저/);
  assert.match(b.reels.spec, /300~1480/);
  assert.equal(b.subtitle.size, '42');
  const ps = store.load('products');
  const gtcr = ps.find(p => p.code === 'GTCR'), gtcp = ps.find(p => p.code === 'GTCP'), p7 = ps.find(p => p.code === 'P7XL');
  assert.equal(gtcr.names.KR, '그린티 캘러스 리페어크림');
  assert.equal(gtcp.names.JPkind, '美容液');
  assert.match(gtcp.look, /스포이트 볼은 없음/);
  assert.match(p7.look, /어플리케이터 헤드/);
  assert.equal(gtcr.tests, 'Dermatest (excellent)');
  assert.ok(gtcr.version > 1);
  const h = store.load('history')[0];
  assert.equal(h.by, '인수인계서');
  assert.equal(applyHandover(), null, '두 번째는 아무것도 안 해요');
  // 판매명 대신 영문 라벨명
  assert.ok(checkText({ text: 'Peptide 7X Lifting Cream クリーム', account: 'JP', product: 'P7XL' }).issues.length === 0);
  assert.ok(!checkText({ text: '血行促進', account: 'JP' }).ok);
  const W = await import('../lib/works.js');
  const w = W.createWork({ type: 'image', account: 'JP', product: 'GTCP', date: '2026-11-20', title: '캡션', requestCaption: true });
  assert.equal(queue().find(q => q.workId === w.id).productName, 'Green Tea Callus PDRN Serum 美容液', '일본 캡션에는 판매명 대신 영문 라벨명 + 종류');
  rollback(before);
  const back = store.load('brand');
  assert.equal(back.tone.JP, '정중하고 부드럽게. 약기법 56개 효능 범위 안에서만');
  assert.ok(back.work, '되돌려도 새 항목 칸은 남아요(기본값)');
});

