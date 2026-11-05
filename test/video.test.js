import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';

process.env.CC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-video-'));
const { ensureData, load, save } = await import('../lib/store.js');
const W = await import('../lib/works.js');
const V = await import('../lib/videowork.js');
const IM = await import('../lib/imagework.js');
const { claudeQueue } = await import('../lib/queue.js');
const { finalsConfig, setFinals } = await import('../lib/finalize.js');
ensureData();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-vfiles-'));
const imageRoot = path.join(tmp, '이미지정리'); fs.mkdirSync(imageRoot);
const c = load('config'); c.imageRoot = imageRoot; save('config', c);
finalsConfig(); setFinals({ driveFolder: '' });
const clip = path.join(tmp, 'edit.mp4');
execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);

test('영상: 스토리보드 → CapCut 편집 업로드 → 메모 수정 → Claude 편집으로 전환 → 컨펌 → 자막 → 최종(나라별 자막 입힌 영상)', async () => {
  const w = W.createWork({ type: 'video', account: 'GLOBAL', product: 'P7XL', date: '2026-11-13', title: '밤 루틴 릴스', memo: '마사지 도구' });
  assert.throws(() => IM.requestDrafts(w.id), /이미지 작업에서만/);
  V.requestStory(w.id, '15초 이내');
  let q = claudeQueue().find(t => t.workId === w.id);
  assert.equal(q.task, '스토리보드 만들기');

  assert.throws(() => V.submitStory(w.id, { cuts: [{ start: 3, end: 1, desc: 'x' }] }), /끝 시간/);
  V.submitStory(w.id, { cuts: [{ start: 0, end: 3, desc: '뚜껑 여는 손', camera: '클로즈업', text: 'Your last step', back: '마지막 단계' }, { start: 3, end: 6, desc: '턱선 마사지', svg: '<svg viewBox="0 0 9 16"><script>x</script><rect width="9" height="16"/></svg>' }] });
  let v = W.getWork(w.id).video;
  assert.equal(v.stage, 'story_review');
  assert.ok(!fs.readFileSync(path.join(process.env.CC_DATA_DIR, 'works', w.id, v.story.cuts[1].sketch), 'utf8').includes('script'));

  // 컷에 이미지 작업 연결 (P7XL 이미지 작업)
  const img = W.createWork({ type: 'image', account: 'GLOBAL', product: 'P7XL', date: '2026-11-12', title: '크림 이미지' });
  V.setCutImage(w.id, 'C1', img.id);
  assert.equal(W.getWork(w.id).video.story.cuts[0].fromImage, img.id);

  V.approveStory(w.id, 'capcut');
  assert.equal(W.getWork(w.id).video.stage, 'edit_me');
  assert.ok(!claudeQueue().some(t => t.workId === w.id)); // 내가 편집하는 동안 Claude 할 일 없음

  await assert.rejects(V.uploadVideo(w.id, path.join(tmp, '../nope.mp4')), /ENOENT|찾을 수 없어요/);
  const notVideo = path.join(tmp, 'x.mp4'); fs.writeFileSync(notVideo, 'not a video at all....');
  await assert.rejects(V.uploadVideo(w.id, notVideo), /영상 파일/);
  v = (await V.uploadVideo(w.id, clip)).video;
  assert.equal(v.stage, 'result_review');
  assert.equal(Math.round(v.videos[0].duration), 6);
  assert.equal(v.videos[0].width, 720);

  V.saveNotes(w.id, [{ t: 4.2, text: '자막 더 크게' }, { t: 1, t2: 2.5, text: '이 구간 밝게' }, { t: 99, text: '' }]);
  v = W.getWork(w.id).video;
  assert.deepEqual(v.notes.map(n => n.t), [1, 4.2, 6]);
  V.fixVideo(w.id, '');
  assert.equal(W.getWork(w.id).video.stage, 'edit_me'); // CapCut 방식이면 내 차례로
  V.setMethod(w.id, 'claude');
  q = claudeQueue().find(t => t.workId === w.id);
  assert.equal(q.task, '영상 고치기');
  assert.equal(q.video.latestFix.notes.length, 2);

  const frames = await V.framesForClaude(w.id, [0.5, 3]);
  assert.equal(frames.frames.length, 2);
  assert.ok(frames.frames[0].data.length > 1000);

  await V.submitVideo(w.id, { path: clip, note: '자막 키움' });
  V.approveVideo(w.id, ['JP', 'EU', 'KR'], true); // KR은 계정이 아니라 빠지고, JP·EU는 판매 시장이라 들어간다
  v = W.getWork(w.id).video;
  assert.equal(v.stage, 'video_ok');
  assert.deepEqual(v.versions, ['GLOBAL', 'JP', 'EU']);
  q = claudeQueue().find(t => t.workId === w.id && t.kind === 'subtitles');
  assert.equal(q.task, '자막 쓰기');
  assert.equal(q.languages.length, 3);

  const seg = (t, b) => [{ start: 0, end: 3, text: t, back: b }, { start: 3, end: 6, text: t + '!', back: b }];
  assert.throws(() => V.submitSubtitles(w.id, { GLOBAL: seg('Hi', '안녕') }), /JP/);
  assert.throws(() => V.submitSubtitles(w.id, { GLOBAL: seg('It heals your skin', '치유'), JP: seg('ダムティックスP7XLクリーム', '크림'), EU: seg('Crème', '크림') }), /브랜드 기준/);
  V.submitSubtitles(w.id, { GLOBAL: seg('Your last step', '마지막 단계'), JP: seg('ダムティックスP7XLクリーム', '담틱스 크림'), EU: seg('La dernière étape', '마지막 단계') });
  V.fixSubtitles(w.id, '더 짧게');
  assert.equal(claudeQueue().find(t => t.workId === w.id && t.kind === 'subtitles').task, '자막 고치기');
  V.submitSubtitles(w.id, { GLOBAL: seg('Last step', '마지막'), JP: seg('ダムティックスP7XLクリーム', '담틱스 크림'), EU: seg('Dernière étape', '마지막') });
  assert.throws(() => V.finalConfirmVideo(w.id), /자막을 먼저 컨펌/);
  V.confirmSubtitles(w.id);

  V.finalConfirmVideo(w.id);
  assert.equal(W.getWork(w.id).video.stage, 'finalizing');
  await V.waitFinal(w.id);
  v = W.getWork(w.id).video;
  assert.equal(v.stage, 'done', v.error);
  const root = path.join(imageRoot, '완성본 (contents controller)');
  assert.deepEqual(fs.readdirSync(path.join(root, 'GLOBAL', `2026-11-13_${w.id}`)).sort(), [`${w.id}_GLOBAL.srt`, `${w.id}_GLOBAL_ko.srt`, `${w.id}_GLOBAL_P7XL.mp4`, `${w.id}_P7XL_clean.mp4`].sort());
  assert.ok(fs.existsSync(path.join(root, 'JP', `2026-11-13_${w.id}`, `${w.id}_JP_P7XL.mp4`)));
  assert.match(fs.readFileSync(path.join(root, 'EU', `2026-11-13_${w.id}`, `${w.id}_EU.srt`), 'utf8'), /00:00:03,000 --> 00:00:06,000\nDernière étape!/);
  assert.equal(v.final.outputs.length, 4);
  assert.equal(v.final.drive.status, 'off');
});

test('이미지 최종 컨펌: 작은 이미지는 프로그램 확대 또는 Higgsfield 업스케일 선택', async () => {
  const small = path.join(tmp, 'small.png');
  await sharp({ create: { width: 896, height: 1120, channels: 3, background: '#888' } }).png().toFile(small);
  const mk = async () => {
    const w = W.createWork({ type: 'image', account: 'JP', product: 'GTCP', date: '2026-11-20', title: '작은 이미지' });
    IM.requestDrafts(w.id); IM.submitDrafts(w.id, [{ svg: '<svg viewBox="0 0 4 5"><rect width="4" height="5"/></svg>' }]);
    IM.pickDraft(w.id, W.getWork(w.id).image.drafts[0].id);
    const r = await IM.submitImages(w.id, [{ path: small }]);
    assert.equal(r.image.results[0].width, 896);
    return r;
  };
  let r = await mk();
  r = await IM.finalConfirm(r.id, [r.image.results[0].id], 'local');
  assert.equal(r.image.final.files[0].width, 1080);
  assert.equal(r.image.final.files[0].upscaled, 'local');

  r = await mk();
  r = await IM.finalConfirm(r.id, [r.image.results[0].id], 'higgsfield');
  assert.equal(r.image.stage, 'upscale');
  const q = claudeQueue().find(t => t.workId === r.id);
  assert.equal(q.task, '최종 이미지 업스케일');
  assert.equal(q.image.upscale.files[0].width, 896);
  const big = path.join(tmp, 'up.png');
  await sharp({ create: { width: 1792, height: 2240, channels: 3, background: '#777' } }).png().toFile(big);
  await assert.rejects(IM.submitUpscaled(r.id, [{ result_id: 'R9-9', path: big }]), /고른 이미지가 아니에요/);
  r = await IM.submitUpscaled(r.id, [{ result_id: r.image.results[0].id, path: big }]);
  assert.equal(r.image.stage, 'done');
  assert.equal(r.image.final.files[0].upscaled, 'higgsfield');
  assert.equal(r.image.final.files[0].width, 1080);
});
