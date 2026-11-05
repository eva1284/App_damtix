import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

process.env.CC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-subs-'));
const store = await import('../lib/store.js');
const { applyChange, rollback } = await import('../lib/rules.js');
const F = await import('../lib/fonts.js');
const S = await import('../lib/subtitles.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-subfiles-'));

test('자막 디자인 기본값: 예전 데이터에도 채워지고, 되돌리기 뒤에도 남는다', () => {
  fs.writeFileSync(path.join(process.env.CC_DATA_DIR, 'brand.json'), JSON.stringify({ version: '1.3', core: { slogan: 'x' } }));
  store.ensureData();
  const b = store.load('brand');
  assert.equal(b.version, '1.3');
  assert.equal(b.core.slogan, 'x');
  assert.equal(b.subtitle.font_JP, 'Noto Sans JP');
  assert.equal(b.subtitle.font_KR, 'Pretendard');
  const st = S.subtitleStyle();
  assert.equal(st.fonts.GLOBAL, 'Epilogue');
  assert.ok(st.position <= S.SAFE_BOTTOM * 100, '기본 위치가 인스타그램 가림 영역 위에 있어야 해요');
});

test('글꼴: 앱에 든 글꼴을 읽고, 굵기에 맞는 글꼴을 고른다. 글꼴이 아닌 파일은 막는다', () => {
  const fams = F.listFonts().map(f => f.family);
  for (const f of ['Epilogue', 'Pretendard', 'Noto Sans JP']) assert.ok(fams.includes(f), f);
  assert.equal(F.pickFace('Epilogue', 600).full, 'Epilogue SemiBold');
  assert.equal(F.pickFace('Noto Sans JP', 700).full, 'Noto Sans JP Bold');
  assert.throws(() => F.addFont('x.ttf', Buffer.from('not a font at all')), /글꼴 파일만/);
  assert.throws(() => F.addFont('x.woff2', Buffer.from('wOF2....')), /woff/);
  const r = F.addFont('내 글꼴.ttf', fs.readFileSync(path.join(F.BUNDLED_DIR, 'Epilogue_400Regular.ttf')));
  assert.equal(r.family, 'Epilogue');
  assert.ok(fs.existsSync(path.join(F.FONT_DIR, '내 글꼴.ttf')));
});

test('브랜드 기준에서 자막 디자인 고치기: 없는 글꼴·범위 밖 숫자는 막고, 기록과 되돌리기가 된다', () => {
  assert.throws(() => applyChange({ key: 'brand.subtitle', draft: { font_GLOBAL: 'Comic Sans' }, reason: 't' }), /글꼴이 없어요/);
  assert.throws(() => applyChange({ key: 'brand.subtitle', draft: { size: '200' }, reason: 't' }), /28~96/);
  assert.throws(() => applyChange({ key: 'brand.subtitle', draft: { color: 'pink' }, reason: 't' }), /고를 수 없는/);
  const before = store.load('history')[0].id;
  const r = applyChange({ key: 'brand.subtitle', draft: { size: '56', position: '60.4', color: 'black', font_EU: 'Pretendard' }, reason: '테스트' });
  assert.match(r.label, /브랜드 v/);
  const sub = store.load('brand').subtitle;
  assert.equal(sub.size, '56');
  assert.equal(sub.position, '60');
  assert.equal(S.subtitleStyle().color, 'black');
  rollback(before);
  assert.equal(store.load('brand').subtitle.size, '42');
});

test('ASS 자막: 글꼴 전체 이름, 높이, 흰/검정 글씨, 일본어 줄바꿈, 특수문자', () => {
  const style = S.subtitleStyle({ size: '60', position: '60', weight: '700' });
  const segs = [{ start: 0, end: 2.5, text: 'Hello {world}\nline' }, { start: 2.5, end: 5, text: 'あ'.repeat(30) }];
  const en = S.toAss(segs, { style, account: 'GLOBAL', width: 1080, height: 1920, colors: ['white', 'black'] });
  assert.match(en, /Style: W,Epilogue Bold,60,&H00FFFFFF/);
  assert.match(en, /,100,100,-2\.40,0,1,/); // 영어 자간 -0.04em
  assert.match(en, /Style: B,Epilogue Bold,60,&H001F1D1D/);
  assert.match(en, /,2,227,227,768,1/); // 폭 58%, 1920 × (1 - 0.60)
  assert.match(en, /Dialogue: 0,0:00:00\.00,0:00:02\.50,W,.*Hello \(world\)\\Nline/);
  assert.match(en, /Dialogue: 0,0:00:02\.50,0:00:05\.00,B,/);
  const jp = S.toAss(segs, { style, account: 'JP', width: 720, height: 1280, colors: [] });
  assert.match(jp, /Style: W,Noto Sans JP Bold/);
  const line = jp.split('\n').find(l => l.includes('あああ'));
  const parts = line.split(',,').pop().replace(/^\{[^}]*\}/, '').split('\\N');
  assert.ok(parts.length >= 2 && parts.every(p => [...p].length <= S.lineLimit(style, 'JP')), '일본어는 한 줄 글자 수를 넘지 않게 나눠요');
});

test('장면 밝기를 보고 흰/검정 글씨를 고르고, 미리보기를 그린다', async () => {
  const mk = (name, color) => {
    const f = path.join(tmp, name);
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=540x960:r=10`, '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f]);
    return f;
  };
  const bright = mk('bright.mp4', 'white'), dark = mk('dark.mp4', 'black');
  const style = S.subtitleStyle({ color: 'auto' });
  const seg = [{ start: 0, end: 2, text: 'Hi' }];
  assert.deepEqual(await S.decideColors(bright, seg, style, 'auto', { width: 540, height: 960 }), ['black']);
  assert.deepEqual(await S.decideColors(dark, seg, style, 'auto', { width: 540, height: 960 }), ['white']);
  assert.deepEqual(await S.decideColors(dark, seg, style, 'black', { width: 540, height: 960 }), ['black']);
  const img = await S.still({ input: bright, t: 1, text: 'Your last step', account: 'GLOBAL', style, color: 'black', size: { width: 540, height: 960 } });
  assert.equal(img[0], 0xff); assert.equal(img[1], 0xd8); // JPEG
  const prev = await S.stylePreview({ size: '64' });
  assert.equal(prev.length, 8);
  assert.deepEqual([...new Set(prev.map(p => p.account))], ['GLOBAL', 'EU', 'JP', 'KR']);
  assert.ok(prev.every(p => p.data.startsWith('data:image/jpeg;base64,') && p.data.length > 2000));
});
