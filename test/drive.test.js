import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

process.env.CC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-drive-'));
process.env.CC_RETRY_MS = '5';
const { ensureData, load, save } = await import('../lib/store.js');
const W = await import('../lib/works.js');
const IM = await import('../lib/imagework.js');
const { finalsConfig, setFinals } = await import('../lib/finalize.js');
const D = await import('../lib/drive.js');
ensureData();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-drivefiles-'));
const imageRoot = path.join(tmp, '이미지정리'); fs.mkdirSync(imageRoot);
const drive = path.join(tmp, 'GoogleDrive', '내 드라이브'); fs.mkdirSync(drive, { recursive: true });
const c = load('config'); c.imageRoot = imageRoot; save('config', c);
finalsConfig(); setFinals({ driveFolder: drive });
const err11 = () => Object.assign(new Error(`Unknown system error -11: Unknown system error -11, mkdir '${drive}/완성본 (contents controller)'`), { errno: -11, code: 'Unknown system error -11' });

const done = async () => {
  const w = W.createWork({ type: 'image', account: 'JP', product: 'P7XL', date: '2026-11-05', title: 'drive' });
  const f = path.join(tmp, `i-${w.id}.png`);
  await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#888' } }).png().toFile(f);
  await IM.submitImages(w.id, [{ path: f }]);
  return W.getWork(w.id);
};

test('Drive가 잠깐 거절(-11)하면 다시 시도해서 복사한다', async () => {
  const orig = fs.promises.mkdir; let n = 0;
  fs.promises.mkdir = async (...a) => { if (n++ < 2) throw err11(); return orig(...a); };
  try {
    const w = await done();
    const r = await IM.finalConfirm(w.id, [w.image.results[0].id], 'none');
    assert.equal(r.image.stage, 'done');
    assert.equal(r.image.final.drive.status, 'copied');
    assert.ok(fs.existsSync(path.join(r.image.final.drive.path, `${w.id}_JP_P7XL_01.jpg`)));
  } finally { fs.promises.mkdir = orig; }
});

test('끝내 안 되면 최종 저장은 끝내고 Drive만 실패로 남기고, 나중에 다시 복사할 수 있다', async () => {
  const orig = fs.promises.mkdir;
  fs.promises.mkdir = async () => { throw err11(); };
  let w;
  try {
    w = await done();
    const r = await IM.finalConfirm(w.id, [w.image.results[0].id], 'none');
    assert.equal(r.image.stage, 'done', 'Mac 저장은 끝났으니 완료');
    assert.equal(r.image.final.drive.status, 'failed');
    assert.match(r.image.final.drive.error, /파일 미러링/);
    assert.ok(fs.existsSync(path.join(r.image.final.folder, `${w.id}_JP_P7XL_01.jpg`)));
  } finally { fs.promises.mkdir = orig; }
  const again = await D.recopyToDrive(w.id);
  assert.equal(again.image.final.drive.status, 'copied');
  assert.match(again.log[0].what, /다시 복사/);
});

test('일시적인 오류가 아니면 바로 실패로 남긴다', async () => {
  let n = 0;
  await assert.rejects(D.retry(async () => { n++; throw Object.assign(new Error('no'), { code: 'EACCES' }); }));
  assert.equal(n, 1);
});
