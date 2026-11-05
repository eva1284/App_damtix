import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-img-'));
const { ensureData, load, save } = await import('../lib/store.js');
const I = await import('../lib/images.js');
ensureData();

// 사용자 Mac의 실제 폴더 구조를 흉내 낸다. 한글 이름은 macOS처럼 NFD(자모 분리)로 만든다.
const root = fs.mkdtempSync(path.join(os.tmpdir(), '이미지정리-'));
const nfd = s => s.normalize('NFD');
const mk = (rel, files = []) => { const d = path.join(root, ...rel.split('/').map(nfd)); fs.mkdirSync(d, { recursive: true }); for (const f of files) fs.writeFileSync(path.join(d, nfd(f)), 'x'); };
mk('01 다크스팟', ['정면.jpg', '측면.png', '메모.txt']);
mk('02 PDRN/패키지', ['a.jpg', 'b.jpg']);
mk('02 PDRN/텍스처/클로즈업', ['c.webp']);
mk('03 NMN'); mk('04 리페어'); mk('05 리프팅'); mk('06 아이크림'); mk('07 버블토너'); mk('08 아이크림 리필');
mk('09 필오프팩'); mk('00 누끼이미지', ['누끼.png']); mk('99 단체컷'); mk('실제 모델', ['m1.jpg']); mk('ai 모델'); mk('담틱스 로고'); mk('100 기타 이미지');
const config = load('config'); config.imageRoot = root; save('config', config);

test('처음 실행하면 사용자의 폴더 이름을 기억한다', () => {
  const c = I.migrateConfig();
  assert.equal(c.productFolders.GTCP, '02 PDRN');
  assert.equal(c.otherFolders.realModels, '실제 모델');
});

test('macOS식(NFD) 한글 폴더 이름도 찾는다', () => {
  const r = I.productImages('DSS');
  assert.ok(r.folder);
  assert.equal(r.count, 2); // txt는 빼고 이미지만
  assert.deepEqual(r.groups[0].files.map(f => f.name), ['정면.jpg', '측면.png']);
});

test('하위 폴더별로 묶고 두 단계 아래까지 찾는다', () => {
  const r = I.productImages('GTCP');
  assert.equal(r.count, 3);
  assert.deepEqual(r.groups.map(g => g.name).sort(), ['텍스처', '패키지']);
});

test('폴더 지도: 제품 8개와 기타 폴더 모두 연결, 안 쓰는 폴더 표시', () => {
  const m = I.folderMap();
  assert.equal(m.products.filter(p => p.path).length, 8);
  assert.equal(m.others.filter(o => o.path).length, 6);
  assert.deepEqual(m.unassigned, ['09 필오프팩']);
});

test('제품 폴더를 다시 지정할 수 있다', () => {
  I.setFolders({ productFolders: { GTCN: '09 필오프팩' } });
  assert.equal(I.productImages('GTCN').folderName, '09 필오프팩');
  assert.throws(() => I.setFolders({ productFolders: { NOPE: 'x' } }), /찾을 수 없어요/);
});
