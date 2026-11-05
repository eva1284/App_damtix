import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

process.env.CC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-motion-'));
const { ensureData, load, save } = await import('../lib/store.js');
const W = await import('../lib/works.js');
const V = await import('../lib/videowork.js');
const M = await import('../lib/motion.js');
const { claudeQueue } = await import('../lib/queue.js');
const { setFinals, finalsConfig } = await import('../lib/finalize.js');
ensureData();
after(() => M.closeBrowser());

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-mfiles-'));
const imageRoot = path.join(tmp, '이미지정리'); fs.mkdirSync(imageRoot);
const c = load('config'); c.imageRoot = imageRoot; save('config', c);
finalsConfig(); setFinals({ driveFolder: '' });
const clip = path.join(tmp, 'footage.mp4');
execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=540x960:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=330', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);

const HTML = `<style>@keyframes up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
.t{position:absolute;top:300px;width:100%;text-align:center;font-size:80px;font-weight:700;color:#fff;animation:up .4s ease .2s both}
.card{position:absolute;inset:0;background:#f5f5f7;display:grid;place-items:center;animation:up .3s ease 2s both}
.card img{width:300px}</style><div class="t">{{title}}</div><div class="card"><img src="/asset/logo"><p>{{end}}</p></div>`;
const T = (text, back) => ({ text, back });
const TEXTS = {
  GLOBAL: { title: T('Your last step', '마지막 단계'), end: T('See you', '또 만나요') },
  JP: { title: T('最後のひと手間', '마지막 한 단계'), end: T('またね', '또 만나요') },
  EU: { title: T('La dernière étape', '마지막 단계'), end: T('À bientôt', '또 만나요') }
};

test('모션 그래픽 구성 검사: 나라별 글자 누락, 금지 표현, 고칠 부분만 보내기', () => {
  const w = W.createWork({ type: 'video', account: 'GLOBAL', product: 'P7XL', date: '2026-11-20', title: '검사' });
  assert.throws(() => M.buildComposition(w, { html: HTML, duration: 3, texts: { GLOBAL: TEXTS.GLOBAL } }), /JP 글자가 빠졌어요/);
  assert.throws(() => M.buildComposition(w, { html: HTML, duration: 3, texts: { ...TEXTS, GLOBAL: { ...TEXTS.GLOBAL, title: T('It heals your skin', '치유') } } }), /브랜드 기준/);
  assert.throws(() => M.buildComposition(w, { html: HTML, duration: 3, texts: { ...TEXTS, JP: { ...TEXTS.JP, end: { text: 'x' } } } }), /역번역/);
  assert.throws(() => M.buildComposition(w, { html: HTML, duration: 999, texts: TEXTS }), /0\.5~180초/);
  const comp = M.buildComposition(w, { html: HTML, duration: 3, texts: TEXTS, clips: [{ src: clip, at: 0 }] });
  assert.deepEqual(comp.keys, ['title', 'end']);
  const next = M.buildComposition(w, { html_edits: [{ find: 'font-size:80px', replace: 'font-size:96px' }], texts: { JP: { end: T('またね!', '또 봐요!') } } }, comp);
  assert.match(next.html, /font-size:96px/);
  assert.equal(next.texts.JP.end.text, 'またね!');
  assert.equal(next.texts.GLOBAL.end.text, 'See you');
  assert.equal(next.clips[0].src, clip);
  assert.throws(() => M.buildComposition(w, { html_edits: [{ find: 'nope', replace: 'x' }] }, comp), /0번 나와요/);
  const filled = M.fillHtml(comp, 'JP');
  assert.match(filled, /最後のひと手間/);
  assert.match(filled, /lang="ja"/);
  assert.match(filled, /--font:'Noto Sans JP'/);
  assert.match(filled, /@font-face\{font-family:'Epilogue'/);
});

test('모션 그래픽: Claude가 코드 제출 → 프로그램이 영상으로 → 수정(바뀐 부분만) → 나라별 버전은 글자만 바꿔 저장', { timeout: 300000 }, async () => {
  assert.ok(M.findBrowser(), '테스트에는 크롬이 필요해요');
  const w = W.createWork({ type: 'video', account: 'GLOBAL', product: 'P7XL', date: '2026-11-21', title: '모션' });
  V.requestStory(w.id, '');
  V.submitStory(w.id, { cuts: [{ start: 0, end: 2, desc: '촬영본 위 제목', kind: 'motion' }, { start: 2, end: 3, desc: '엔딩 카드', kind: 'motion' }] });
  assert.equal(W.getWork(w.id).video.story.cuts[0].kind, 'motion');
  V.approveStory(w.id, 'claude');
  const task = claudeQueue().find(t => t.workId === w.id);
  assert.deepEqual(task.motionAccounts, ['GLOBAL', 'JP', 'EU']);

  const prev = await V.previewMotion(w.id, { html: HTML, duration: 3, texts: TEXTS, clips: [{ src: clip, at: 0, duration: 2 }] }, [0.5, 2.5], 'JP');
  assert.equal(prev.frames.length, 2);
  assert.ok(Buffer.from(prev.frames[0].data, 'base64').length > 3000);

  V.submitMotion(w.id, { html: HTML, duration: 3, texts: TEXTS, clips: [{ src: clip, at: 0, duration: 2 }], note: '첫 시안' });
  assert.equal(W.getWork(w.id).video.stage, 'rendering');
  V.pumpRenders();
  await V.waitRender(w.id);
  let v = W.getWork(w.id).video;
  assert.equal(v.stage, 'result_review', v.motion.error);
  assert.equal(v.videos[0].source, 'motion');
  assert.equal(Math.round(v.videos[0].duration), 3);
  assert.equal(v.videos[0].width, 1080);
  assert.ok(v.videos[0].audio);

  // 수정: 고칠 부분만
  V.saveNotes(w.id, [{ t: 0.5, text: '제목 더 크게' }]);
  V.fixVideo(w.id, '');
  assert.equal(W.getWork(w.id).video.stage, 'make_fix');
  const fixTask = claudeQueue().find(t => t.workId === w.id);
  assert.match(fixTask.video.motion.html, /font-size:80px/);
  // 코드 오류는 렌더링 단계에서 잡혀서 Claude에게 돌아간다
  V.submitMotion(w.id, { html_edits: [{ find: '<div class="t">', replace: '<script>throw new Error("boom")</script><div class="t">' }] });
  V.pumpRenders(); await V.waitRender(w.id);
  v = W.getWork(w.id).video;
  assert.equal(v.stage, 'make_fix');
  assert.match(v.motion.error, /boom/);
  assert.match(claudeQueue().find(t => t.workId === w.id).video.motion.error, /boom/);
  V.submitMotion(w.id, { html_edits: [{ find: '<script>throw new Error("boom")</script>', replace: '' }, { find: 'font-size:80px', replace: 'font-size:110px' }] });
  V.pumpRenders(); await V.waitRender(w.id);
  v = W.getWork(w.id).video;
  assert.equal(v.stage, 'result_review', v.motion.error);
  assert.equal(v.videos.length, 2);

  // 템플릿으로 저장
  const tpl = M.saveTemplate({ name: '제목+엔딩', comp: v.motion.comp, from: w.id });
  assert.equal(M.getTemplate(tpl.id).keys.length, 2);
  assert.equal(M.listTemplates()[0].clips[0].src, '');

  // 나라별 버전: 자막 없이, 프로그램이 글자만 바꿔 다시 만든다
  V.approveVideo(w.id, ['JP', 'EU'], false);
  V.finalConfirmVideo(w.id);
  await V.waitFinal(w.id);
  v = W.getWork(w.id).video;
  assert.equal(v.stage, 'done', v.error);
  const root = path.join(imageRoot, '완성본 (contents controller)');
  for (const acc of ['GLOBAL', 'JP', 'EU']) assert.ok(fs.existsSync(path.join(root, acc, `2026-11-21_${w.id}`, `${w.id}_${acc}_P7XL.mp4`)), acc);
  assert.equal(v.final.outputs.length, 4);
  assert.ok(!fs.readdirSync(path.join(process.env.CC_DATA_DIR, 'works', w.id)).some(f => f.startsWith('tmp-')), '임시 파일이 남지 않아요');
});

test('템플릿에서 시작하기: 재료 영상과 글자만 새로 넣는다', () => {
  const w = W.createWork({ type: 'video', account: 'JP', product: 'P7XL', date: '2026-11-22', title: '템플릿' });
  V.requestStory(w.id, ''); V.submitStory(w.id, { cuts: [{ start: 0, end: 3, desc: 'x', kind: 'motion' }] }); V.approveStory(w.id, 'claude');
  const tpl = M.listTemplates()[0];
  assert.throws(() => V.submitMotion(w.id, { template: tpl.id }), /src가 비어 있어요/);
  const r = V.submitMotion(w.id, { template: tpl.id, clips: [{ src: clip, at: 0, duration: 2 }], texts: { JP: { title: T('新作', '신제품') } } });
  assert.equal(r.video.motion.template, tpl.id);
  assert.equal(r.video.motion.comp.texts.JP.title.text, '新作');
  assert.equal(r.video.motion.comp.texts.GLOBAL.end.text, 'See you');
});
