// Claude가 할 일 전체: 캡션, 이미지(구도 시안·생성·수정), 레퍼런스 분석
import { load } from './store.js';
import { listWorks, queue as captionQueue, langOf } from './works.js';
import { CLAUDE_STAGES, imageForClaude } from './imagework.js';
import { listRefs, refsFor } from './refs.js';
import { ACCOUNTS } from './rules.js';

const IMAGE_TASK = { draft_requested: '구도 시안 만들기', draft_fix: '구도 시안 고치기', make: '이미지 만들기', make_fix: '이미지 고치기' };

export function claudeQueue() {
  const products = load('products');
  const tasks = captionQueue().map(q => ({ kind: 'caption', ...q }));
  for (const w of listWorks()) {
    if (w.type !== 'image' || !CLAUDE_STAGES.includes(w.image?.stage)) continue;
    const p = products.find(x => x.code === w.product);
    tasks.push({
      kind: 'image', workId: w.id, task: IMAGE_TASK[w.image.stage], title: w.title,
      account: w.account, accountHandle: ACCOUNTS[w.account]?.handle, language: langOf(w),
      product: w.product, productName: p ? p.names.KR : w.product, postDate: w.date, plan: w.memo,
      references: refsFor(w.id).map(r => ({ id: r.id, title: r.title, memo: r.memo, analysis: r.analysis, part: r.links.find(l => l.work === w.id)?.part || '' })),
      image: imageForClaude(w)
    });
  }
  for (const r of listRefs()) {
    if (r.status !== 'wait') continue;
    tasks.push({ kind: 'reference', refId: r.id, task: '레퍼런스 분석', title: r.title, source: r.source, refKind: r.kind, url: r.url || undefined, memo: r.memo, linkedTo: r.links.map(l => l.work) });
  }
  return tasks;
}
