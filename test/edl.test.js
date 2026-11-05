import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';

process.env.CC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-edltest-'));
const { ensureData, load, save } = await import('../lib/store.js');
const W = await import('../lib/works.js');
const V = await import('../lib/videowork.js');
const E = await import('../lib/edl.js');
const M = await import('../lib/motion.js');
const R = await import('../lib/rules.js');
const REF = await import('../lib/refs.js');
const H = await import('../lib/handover.js');
const { claudeQueue } = await import('../lib/queue.js');
const { listSfx } = await import('../lib/sfx.js');
ensureData();
after(() => M.closeBrowser());
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-edlfiles-'));
const { finalsConfig, setFinals } = await import('../lib/finalize.js');
const imageRoot = path.join(tmp, '이미지정리'); fs.mkdirSync(imageRoot);
{ const c = load('config'); c.imageRoot = imageRoot; save('config', c); finalsConfig(); setFinals({ driveFolder: '' }); }
const a = path.join(tmp, 'a.mp4'), b = path.join(tmp, 'b.mp4'), img = path.join(tmp, 'c.png');
execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=540x960:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=300', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', a]);
execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=960x540:rate=24', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', b]);
await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#bbbbbb' } }).png().toFile(img);

test('효과음 라이브러리: 기본 7종이 만들어진다', () => {
  assert.deepEqual(listSfx().filter(s => s.builtin).map(s => s.name).sort(), ['beep', 'buzz', 'ding', 'murmur', 'pop', 'whoosh', 'wink']);
});

test('편집 목록 검사와 타임라인 계산', async () => {
  const w = W.createWork({ type: 'video', account: 'GLOBAL', product: 'P7XL', date: '2026-11-20', title: '검사' });
  await assert.rejects(E.buildEdl(w, { cuts: [{ id: 'C1', src: a, in: 2, out: 1 }] }), /in\(2\)보다 커야/);
  await assert.rejects(E.buildEdl(w, { cuts: [{ id: 'C1', src: a, in: 0, out: 9 }] }), /원본 길이/);
  await assert.rejects(E.buildEdl(w, { cuts: [{ id: 'C1', src: img }] }), /이미지라 out/);
  await assert.rejects(E.buildEdl(w, { cuts: [{ id: 'C1', src: a }], sfx: [{ name: 'nope', at: 1 }] }), /라이브러리에 없어요/);
  const edl = await E.buildEdl(w, { cuts: [{ id: 'C1', src: a, in: 1, out: 3, transition: { type: 'dissolve', dur: 0.5 } }, { id: 'C2', src: img, in: 0, out: 2, freeze: 0 }, { id: 'C3', src: b, in: 0, out: 2, speed: 2, freeze: 0.5 }] });
  const tl = E.timeline(edl);
  assert.equal(tl.duration, 2 + 2 - 0.5 + 1.5);
  assert.deepEqual(E.mapTime(edl, 1.2), { cut: 'C1', src: 2.2, local: 1.2, freeze: undefined, clip: a });
  assert.equal(E.mapTime(edl, 3.0).cut, 'C2');
  assert.equal(E.mapTime(edl, 4.2).src, 1.4, '속도 2배: 0.7초 지나면 원본 1.4초');
  assert.equal(E.mapTime(edl, 4.9).freeze, true);
  // 바뀐 부분만 (patch), 순서, 빼기
  const p = await E.buildEdl(w, { cuts: [{ id: 'C3', in: 0.5, zoom: { to: 1.2 } }], order: ['C3', 'C1', 'C2'] }, edl);
  assert.deepEqual(p.cuts.map(c => c.id), ['C3', 'C1', 'C2']);
  assert.equal(p.cuts[0].in, 0.5); assert.equal(p.cuts[0].zoom.to, 1.2); assert.equal(p.cuts[0].speed, 2);
  const r = await E.buildEdl(w, { remove: ['C2'], cuts: [{ id: 'C3', zoom: null }] }, p);
  assert.deepEqual(r.cuts.map(c => c.id), ['C3', 'C1']);
  assert.equal(r.cuts[0].zoom, undefined);
});

test('편집 목록 흐름: Claude가 EDL 제출 → 프로그램이 영상 → 메모에 컷·원본 시각 → 바뀐 부분만 → 직접 고치기 → 되돌리기', { timeout: 600000 }, async () => {
  const w = W.createWork({ type: 'video', account: 'JP', product: 'P7XL', date: '2026-11-21', title: 'EDL' });
  V.requestStory(w.id, '');
  V.submitStory(w.id, { cuts: [{ start: 0, end: 2, desc: '시작' }, { start: 2, end: 4, desc: '제품' }, { start: 4, end: 6, desc: '엔딩' }] });
  V.approveStory(w.id, 'claude');
  const T = (t, b) => ({ text: t, back: b });
  await V.submitEdit(w.id, {
    cuts: [
      { id: 'C1', src: a, in: 0.5, out: 2.5, zoom: { from: 1, to: 1.2, x: 50, y: 40 }, transition: { type: 'push', dir: 'left', dur: 0.4 } },
      { id: 'C2', src: img, in: 0, out: 1.5, audio: { on: false } },
      { id: 'C3', src: b, in: 1, out: 3, mask: { r0: 150, r1: 0, at: 1.2, dur: 0.6 } }
    ],
    sfx: [{ name: 'pop', at: 0.8 }, { name: 'ding', at: 3.0, volume: 0.7 }],
    overlay: { html: '<div style="position:absolute;top:400px;width:100%;text-align:center;color:#fff;font-size:70px">{{t}}</div>', texts: { GLOBAL: { t: T('Hello', '안녕') }, JP: { t: T('こんにちは', '안녕') }, EU: { t: T('Bonjour', '안녕') } } },
    note: '첫 편집'
  });
  let v = W.getWork(w.id).video;
  assert.equal(v.stage, 'rendering');
  assert.equal(v.story.cuts.length, 3);
  assert.equal(v.story.cuts[1].end, 3.1, '스토리보드가 실제 편집 길이에 맞춰져요');
  V.pumpRenders(); await V.waitRender(w.id);
  v = W.getWork(w.id).video;
  assert.equal(v.stage, 'result_review', v.renderError);
  const v1 = v.videos[0];
  assert.equal(v1.source, 'edl');
  assert.equal(Math.round(v1.duration * 10) / 10, 5.1);
  assert.ok(fs.existsSync(path.join(process.env.CC_DATA_DIR, 'works', w.id, `${v1.id}-sfx.f32`)));
  // 소리 확인: 0.8초에 효과음 층
  const au = await V.inspectAudio(w.id, 0.7, 1.1);
  assert.deepEqual(au.layers, ['클립 원본 소리', '효과음']);
  assert.ok(au.rows.some(r => r.loudest === '효과음'), JSON.stringify(au.rows.slice(0, 3)));
  assert.equal(au.sfx[0].name, 'pop');
  // 장면 확인: 시트·확대
  const sh = await V.framesForClaude(w.id, [0.5, 2, 4], { sheet: true });
  assert.equal(sh.frames.length, 1);
  const cr = await V.framesForClaude(w.id, [1], { crop: { x: 25, y: 25, w: 50, h: 30 } });
  assert.ok(cr.frames[0].data.length > 1000);
  // 메모: 컷과 원본 시각, 대상
  V.saveNotes(w.id, [{ t: 1.0, text: '더 크게' }, { t: 3.05, text: '이 띵 소리 작게', target: 'sfx' }, { t: 4.5, text: '말소리 빼', target: 'clip' }]);
  const notes = W.getWork(w.id).video.notes;
  assert.equal(notes[0].at.cut, 'C1'); assert.equal(notes[0].at.src, 1.5);
  assert.equal(notes[1].sfx.name, 'ding');
  assert.equal(notes[2].at.cut, 'C3');
  V.fixVideo(w.id, '전체적으로 좋아요');
  const q = claudeQueue().find(t => t.workId === w.id);
  assert.equal(q.video.latestFix.notes[0].at.cut, 'C1');
  assert.ok(q.video.edl.cuts.length === 3, '고칠 때는 편집 목록 전체가 가요');
  assert.equal(q.video.more !== undefined, true, '간단 모드');
  // 보낸 메모 고치기
  V.editFix(w.id, { notes: [{ t: 1.0, text: '확대는 취소, 그대로' }, { t: 3.05, text: '이 띵 소리 작게', target: 'sfx' }] });
  assert.equal(W.getWork(w.id).video.fixes[0].notes.length, 2);
  // Claude: 바뀐 부분만
  await V.submitEdit(w.id, { cuts: [{ id: 'C1', zoom: null }], sfx: [{ id: 'S2', volume: 0.3 }] });
  V.pumpRenders(); await V.waitRender(w.id);
  v = W.getWork(w.id).video;
  assert.equal(v.stage, 'result_review', v.renderError);
  assert.equal(v.videos[0].edl.cuts[0].zoom, undefined);
  assert.equal(v.videos[0].edl.sfx[1].volume, 0.3);
  const cmp = await V.compareVideos(w.id, v.videos[1].id, v.videos[0].id);
  assert.ok(cmp.maxDiff > 3, '확대를 뺐으니 앞부분이 달라요');
  assert.ok(cmp.worst[0].t < 2);
  const same = await V.compareVideos(w.id, v.videos[0].id, v.videos[0].id);
  assert.equal(same.same, true);
  // 사용자가 화면에서 직접: 원본 구간 바꾸고 효과음 옮기기 → Claude 없이 다시
  await V.submitEdit(w.id, { cuts: [{ id: 'C3', in: 0, out: 2 }], sfx: [{ id: 'S1', at: 1.5 }] }, '화면', { user: true });
  V.pumpRenders(); await V.waitRender(w.id);
  v = W.getWork(w.id).video;
  assert.equal(v.videos[0].edl.cuts[2].in, 0);
  assert.equal(v.videos[0].edl.sfx[0].at, 1.5);
  // 프레임 띠
  const meta = await E.stripFor(b, W.getWork(w.id), path.join(tmp, 'strip.jpg'));
  assert.equal(meta.count, 20);
  // 되돌리기
  const first = v.videos[v.videos.length - 1].id;
  V.restoreVersion(w.id, first);
  v = W.getWork(w.id).video;
  assert.equal(v.videos[0].restoredFrom, first);
  assert.equal(v.edl.cuts[0].zoom.to, 1.2);
  assert.equal(v.stage, 'result_review');
  // 나라별 버전은 글자층만 바꿔 다시
  V.approveVideo(w.id, ['GLOBAL'], false);
  V.finalConfirmVideo(w.id);
  await V.waitFinal(w.id);
  assert.equal(W.getWork(w.id).video.stage, 'done', W.getWork(w.id).video.error);
});

test('데이터 정합성: 가타카나 판매명 막기, 기기 효과 표현 확인, 내부 주소 레퍼런스 막기, 크레딧, 멈춘 자막 올리기', () => {
  const sales = R.checkText({ text: 'ダムティックスP7XLクリームで毎日ケア', account: 'JP', product: 'P7XL' });
  assert.equal(sales.ok, false);
  assert.ok(sales.issues.some(i => i.type === 'jp_sales_name' && i.level === 'block'));
  const dev = R.checkText({ text: 'レッドLEDの振動でクリームの吸収を高めます。', account: 'JP' });
  assert.ok(dev.issues.some(i => i.type === 'device_effect'));
  assert.equal(R.checkText({ text: 'レッドLEDと振動のアプリケーター内蔵。なじませるように使えます。', account: 'JP' }).issues.length, 0);
  assert.throws(() => REF.addUrlRef({ url: 'http://localhost:4321/#work-VID-001' }), /내부망/);
  assert.throws(() => REF.addUrlRef({ url: 'http://192.168.45.74:4321/' }), /내부망/);
  const w = W.createWork({ type: 'video', account: 'JP', product: 'P7XL', date: '2026-11-22', title: '크레딧' });
  W.logCredits(w.id, { amount: 35, what: 'seedance 720p C3' });
  W.logCredits(w.id, { amount: 5.5, what: '이미지' });
  assert.equal(W.creditsOf(W.getWork(w.id)), 40.5);
  // 영상 컨펌 뒤 자막이 시작되지 않은 작업
  const works = load('works'); const x = works.find(y => y.id === w.id);
  x.video = { stage: 'video_ok', videos: [], subs: { status: 'none', tracks: {}, fixes: [] }, versions: ['JP'], notes: [], fixes: [], storyHistory: [] };
  save('works', works);
  const r = H.applyFeedback();
  assert.deepEqual(r.subtitles, [w.id]);
  assert.equal(claudeQueue().find(t => t.workId === w.id && t.kind === 'subtitles').task, '자막 쓰기');
  assert.equal(H.applyFeedback(), null);
});
