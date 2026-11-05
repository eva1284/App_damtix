// Claude가 할 일 전체: 캡션, 이미지(구도 시안·생성·수정·업스케일), 영상(스토리보드·편집·자막), 레퍼런스 분석
// 토큰을 아끼려고 각 일에 꼭 필요한 정보만 담는다. 자세한 것은 get_work로 본다.
import { load } from './store.js';
import { listWorks, queue as captionQueue, langOf } from './works.js';
import { CLAUDE_STAGES, imageForClaude } from './imagework.js';
import { VIDEO_CLAUDE, videoForClaude } from './videowork.js';
import { listRefs, refsFor } from './refs.js';
import { ACCOUNTS } from './rules.js';
import { soldAccounts } from './motion.js';

const IMAGE_TASK = { draft_requested: '구도 시안 만들기', draft_fix: '구도 시안 고치기', make: '이미지 만들기', make_fix: '이미지 고치기', upscale: '최종 이미지 업스케일' };
const VIDEO_TASK = { story_requested: '스토리보드 만들기', story_fix: '스토리보드 고치기', make: '영상 편집하기', make_fix: '영상 고치기' };

export function claudeQueue() {
  const products = load('products');
  const tasks = captionQueue().map(q => ({ kind: 'caption', ...q }));
  const base = w => {
    const p = products.find(x => x.code === w.product);
    return { workId: w.id, title: w.title, account: w.account, accountHandle: ACCOUNTS[w.account]?.handle, language: langOf(w), product: w.product, productName: p ? p.names.KR : w.product, postDate: w.date, plan: w.memo };
  };
  const refs = w => refsFor(w.id).map(r => ({ id: r.id, title: r.title, memo: r.memo, analysis: r.analysis, parts: r.links.filter(l => l.work === w.id).map(l => l.part || '전체') }));
  for (const w of listWorks()) {
    if (w.type === 'image' && CLAUDE_STAGES.includes(w.image?.stage)) {
      tasks.push({ kind: 'image', task: IMAGE_TASK[w.image.stage], ...base(w), references: refs(w), image: imageForClaude(w) });
    }
    if (w.type === 'video' && VIDEO_CLAUDE.includes(w.video?.stage)) {
      tasks.push({ kind: 'video', task: VIDEO_TASK[w.video.stage], ...base(w), references: refs(w), motionAccounts: soldAccounts(w), video: videoForClaude(w) });
    }
    if (w.type === 'video' && ['requested', 'fix'].includes(w.video?.subs?.status)) {
      const v = videoForClaude(w);
      tasks.push({ kind: 'subtitles', task: w.video.subs.status === 'fix' ? '자막 고치기' : '자막 쓰기', ...base(w), languages: w.video.versions.map(a => ({ account: a, language: ACCOUNTS[a].lang })), duration: v.latestVideo?.duration, cuts: v.story?.cuts.map(c => ({ start: c.start, end: c.end, desc: c.desc, text: c.text })), maxCharsPerLine: v.subtitles.maxCharsPerLine, fixRequest: v.subtitles.latestFix?.note, current: v.subtitles.current });
    }
  }
  for (const r of listRefs()) {
    if (r.status !== 'wait') continue;
    tasks.push({ kind: 'reference', refId: r.id, task: '레퍼런스 분석', title: r.title, source: r.source, refKind: r.kind, url: r.url || undefined, memo: r.memo, linkedTo: r.links.map(l => l.work) });
  }
  return tasks;
}
