// Claude 연결 창구 (MCP 서버). Claude 데스크톱 앱이 이 파일을 실행해서 브랜드 기준을 읽고, 문구를 검사하고, 업데이트를 제안한다.
// 주의: 표준 출력(stdout)은 Claude와 대화하는 통로라서 로그는 console.error로만 남긴다.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ensureData, load, markClaudeSeen, APP_DIR } from './lib/store.js';
import { migrateConfig, productImages, folderMap, collectImages } from './lib/images.js';
import { ACCOUNTS, DEFS, checkText, addProposal } from './lib/rules.js';
import { listWorks, getWork, createWork, submitCaption } from './lib/works.js';
import { getRef, refPath, refsFor, submitAnalysis } from './lib/refs.js';
import { submitDrafts, submitImages, submitUpscaled, imageForClaude, imageOf, setCuts } from './lib/imagework.js';
import { submitStory, submitVideo, submitSubtitles, videoForClaude, framesForClaude, submitMotion, previewMotion, setCutImage } from './lib/videowork.js';
import { MOTION_GUIDE, listTemplates, getTemplate, closeBrowser } from './lib/motion.js';
import { workDir } from './lib/files.js';
import { finalsConfig } from './lib/finalize.js';
import { claudeQueue } from './lib/queue.js';
import { applyHandover } from './lib/handover.js';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';

ensureData();
applyHandover();
migrateConfig();
finalsConfig();
const server = new McpServer({ name: 'contents-controller', version: '0.1.0' });
const account = z.enum(['GLOBAL', 'JP', 'EU']);

const ok = data => data?.__content ? { content: data.__content } : ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
// Claude가 직접 볼 수 있게 이미지를 돌려준다 (긴 변 1568px JPEG로 줄여서)
async function imageContent(file) {
  const data = await sharp(file, { density: 144 }).rotate().resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer();
  return { type: 'image', data: data.toString('base64'), mimeType: 'image/jpeg' };
}
const err = e => ({ isError: true, content: [{ type: 'text', text: e.message || String(e) }] });
function tool(name, config, handler) {
  server.registerTool(name, config, async args => {
    try { markClaudeSeen(name); return ok(await handler(args || {})); } catch (e) { return err(e); }
  });
}
const splitWords = s => String(s || '').split(',').map(w => w.trim()).filter(Boolean);

function referenceImages(code) {
  const r = productImages(code);
  if (!r.rootExists) return { folder: null, files: [], note: `이미지 폴더가 없어요: ${r.root}` };
  if (!r.folder) return { folder: null, files: [], note: `"${r.folderName}" 폴더를 ${r.root}에서 찾을 수 없어요. contents controller > 브랜드 기준 > 제품별에서 폴더를 다시 지정해 주세요.` };
  return { folder: r.folder, count: r.count, truncated: r.truncated, groups: r.groups.map(g => ({ name: g.name, files: g.files.map(f => f.abs) })) };
}

// 작업 종류별로 읽을 브랜드 기준 (토큰을 아끼려고 필요한 것만)
const TOPICS = {
  caption: ['facts', 'event'],
  image: ['imagegen', 'facts'],
  video: ['reels', 'imagegen'],
  motion: ['reels', 'event'],
  event: ['event'],
  web: ['web', 'facts']
};
tool('get_brand_guide', {
  title: '브랜드 기준 읽기',
  description: 'Damtix 브랜드 기준(절대 원칙)과 작업 규칙을 읽는다. 캡션·자막·이미지·영상·HTML을 만들거나 고치기 전에 반드시 먼저 호출한다. account를 주면 그 인스타그램 계정의 톤과 금지 표현만, topic을 주면 그 작업의 규칙(caption 캡션·자막, image 이미지 생성·캐러셀, video 영상·릴스, motion 모션 그래픽, event 이벤트·당첨자, web 쇼피파이)을 함께 준다.',
  inputSchema: { account: account.optional().describe('GLOBAL(@damtix.global, 영어 미국), JP(@damtix.jp, 일본어), EU(@damtix_eu, 프랑스어만)'), topic: z.enum(['caption', 'image', 'video', 'motion', 'event', 'web']).optional() }
}, ({ account: acc, topic }) => {
  const b = load('brand');
  const accounts = acc ? { [acc]: ACCOUNTS[acc] } : ACCOUNTS;
  const sec = k => ({ title: DEFS.brand[k]?.title, ...b[k] });
  return {
    brandVersion: `v${b.version}`,
    source: b.source,
    rule: '이 기준은 절대 원칙이다. 어긋나는 문구는 만들지 말고, 결과를 보여 주기 전에 check_text로 검사한다. 사용자는 한국어로만 검수할 수 있으니 외국어 문구에는 항상 한국어 역번역(외국어만 보고 다시 한국어로 옮긴 것)을 함께 준다.',
    core: b.core,
    accounts: Object.fromEntries(Object.entries(accounts).map(([k, a]) => [k, { ...a, tone: b.tone[k], banned: splitWords(b.rules[`${k}_ban`]), useInstead: b.rules[`${k}_alt`] }])),
    allAccounts: { banned: splitWords(b.rules.ALL_ban), useInstead: b.rules.ALL_alt },
    visual: b.visual,
    work: sec('work'),
    ...(topic ? Object.fromEntries(TOPICS[topic].map(k => [k, sec(k)])) : { moreRules: 'topic을 주면 그 작업의 규칙을 더 준다: caption, image, video, motion, event, web' })
  };
});

tool('get_handover_notes', {
  title: '이전 작업 인수인계서 보기',
  description: '프로그램이 생기기 전 이전 AI가 남긴 인수인계서(2026-10-26~11-05)의 한 장을 읽는다. 주요 규칙은 이미 브랜드 기준에 들어 있으니, 그 밖의 세부 절차가 필요할 때만 읽는다: 8 Figma 카탈로그, 6 CapCut draft 수정 절차·16:9→9:16 릴스, 10 지난 프로젝트 이력·폴더, 11 도구·경로, 13 열린 이슈. chapter를 비우면 목차.',
  inputSchema: { chapter: z.number().int().min(1).max(14).optional() }
}, ({ chapter }) => {
  const doc = fs.readFileSync(path.join(APP_DIR, 'docs', 'handover-2026-11-05.md'), 'utf8');
  const parts = doc.split(/\n(?=## \d+\. )/);
  if (!chapter) return parts.slice(1).map(p => p.split('\n')[0].replace('## ', '')).join('\n');
  const hit = parts.find(p => p.startsWith(`## ${chapter}. `));
  return hit ? `${hit.trim()}\n\n(이 문서는 과거 기록이에요. 폴더·파일 상태는 바뀌었을 수 있으니 직접 확인하고, 브랜드 기준과 다르면 브랜드 기준을 따른다.)` : '그 장이 없어요.';
});

tool('list_products', {
  title: '제품 목록',
  description: 'Damtix 제품(SKU) 목록과 시장별 판매 여부를 본다. account를 주면 그 계정에서 쓸 수 있는 제품만 sellable=true로 표시한다.',
  inputSchema: { account: account.optional() }
}, ({ account: acc }) => load('products').map(p => ({
  code: p.code, version: `v${p.version}`, names: p.names, volume: p.volume, markets: p.markets, look: p.look || undefined, tests: p.tests || undefined,
  ...(acc ? { sellable: !!p.markets[ACCOUNTS[acc].market] } : {})
})));

tool('get_product', {
  title: '제품 기준 읽기',
  description: '제품 하나의 기준(시장별 제품명, 판매 시장, 핵심 성분, 사용법, 제품별 규칙, 등록 정보, 전성분)과 기준 이미지 파일 경로를 읽는다. 제품이나 모델이 나오는 이미지·영상을 만들 때는 이 기준 이미지를 항상 참조로 쓴다.',
  inputSchema: { code: z.string().describe('제품 코드: DSS, GTCP, GTCN, GTCR, P7XL, VLE, VLER, HGB') }
}, ({ code }) => {
  const p = load('products').find(x => x.code === String(code).toUpperCase());
  if (!p) throw new Error(`제품 코드 ${code}를 찾을 수 없어요. list_products로 코드를 확인하세요.`);
  return { ...p, version: `v${p.version}`, rules: p.rules.split('\n').filter(Boolean), referenceImages: referenceImages(p.code) };
});

tool('get_image_folders', {
  title: '이미지 폴더 지도',
  description: '사용자 Mac의 이미지정리 폴더 구조를 본다: 제품별 기준 이미지 폴더(01 다크스팟, 02 PDRN …)와 누끼, 단체컷, 실제 모델, AI 모델, 로고, 기타 폴더의 실제 경로. kind를 주면 그 폴더의 이미지 파일 경로 목록도 준다. 모델이 나오는 이미지를 만들 때는 realModels 또는 aiModels 폴더의 사진을 참조로 써서 같은 얼굴을 유지한다.',
  inputSchema: { kind: z.enum(['cutouts', 'group', 'realModels', 'aiModels', 'logos', 'etc']).optional() }
}, ({ kind }) => {
  const map = folderMap();
  if (!kind) return map;
  const f = map.others.find(o => o.key === kind);
  if (!f?.path) return `${f?.label || kind} 폴더("${f?.folderName}")를 찾을 수 없어요.`;
  const r = collectImages(map.root, f.path);
  return { ...f, count: r.count, truncated: r.truncated, groups: r.groups.map(g => ({ name: g.name, files: g.files.map(x => x.abs) })) };
});

tool('check_text', {
  title: '문구 검사',
  description: '캡션·자막·그림 속 문구·HTML 문구가 브랜드 기준에 맞는지 검사한다. 금지 표현, 그 시장에서 팔지 않는 제품, 일본 판매명 누락을 찾는다. level=block 문제가 있으면 고친 뒤 다시 검사한다.',
  inputSchema: { text: z.string().min(1), account, product: z.string().optional().describe('제품 코드 (선택)') }
}, ({ text, account: acc, product }) => checkText({ text, account: acc, product: product ? product.toUpperCase() : undefined }));

tool('propose_brand_update', {
  title: '브랜드 기준 업데이트 제안',
  description: '브랜드 기준이나 제품 기준을 바꾸자고 제안한다. 바로 바뀌지 않고, 사용자가 contents controller의 브랜드 > 업데이트 제안에서 승인해야 반영된다. target 예: brand.core, brand.tone, brand.rules, brand.visual, product.P7XL.names, product.P7XL.markets, product.P7XL.content',
  inputSchema: {
    target: z.string(),
    field: z.string().describe(`항목 이름. brand.core: ${DEFS.brand.core.fields.map(f => f[0]).join('/')} · brand.tone: GLOBAL/JP/EU · brand.rules: GLOBAL_ban/GLOBAL_alt/JP_ban/JP_alt/EU_ban/EU_alt/ALL_ban/ALL_alt · brand.visual: color/light/model/avoid · product.<코드>.names: KR/EN/JP/FR · product.<코드>.content: keyIngredients/usage/rules`),
    new_value: z.string().describe('바꿀 내용 전체 (판매 시장 항목은 "true" 또는 "false")'),
    reason: z.string().describe('왜 바꾸는지 한국어로 한 줄')
  }
}, ({ target, field, new_value, reason }) => {
  const isMarket = /^product\.[A-Z0-9]+\.markets$/.test(target);
  const value = isMarket ? new_value.trim().toLowerCase() === 'true' : new_value;
  const p = addProposal({ key: target, field, newValue: value, reason, source: 'Claude 앱 요청' });
  return `제안을 올렸어요 (${p.label}). 사용자가 contents controller > 브랜드 > 업데이트 제안에서 승인해야 반영됩니다.`;
});

tool('get_change_history', {
  title: '브랜드 기준 변경 이력',
  description: '브랜드·제품 기준이 언제, 왜 바뀌었는지 최근 기록을 본다.',
  inputSchema: { limit: z.number().int().min(1).max(50).optional() }
}, ({ limit }) => load('history').slice(0, limit || 10).map(({ snapshot, ...h }) => h));


const pair = (key, desc) => z.array(z.object({ [key]: z.string(), ko: z.string().describe('한국어 뜻') })).describe(desc);

tool('list_queue', {
  title: 'Claude가 할 일 목록',
  description: [
    '사용자가 contents controller에서 Claude에게 맡긴 일을 본다. 사용자가 "contents controller 대기 작업 처리해줘"라고 하면 이것부터 호출해서 하나씩 처리한다. 모두 끝나면 처리한 번호와 한 줄 요약을 한국어로 알려 준다.',
    '',
    '[캡션 쓰기/고치기] get_brand_guide(account)와 get_product(product)로 기준을 읽고, 그 계정 언어로 처음부터 현지화해서 쓴다(직역 금지). 해시태그는 그 나라에서 실제로 쓰는 태그 + 한국어 뜻. 한국어 역번역은 원래 기획을 보지 말고 외국어 원문만 보고 옮긴다. check_text 후 submit_caption.',
    '',
    '[레퍼런스 분석] get_reference로 이미지를 직접 보고 구도·빛·색감·소품·문구 위치를 한국어 3~5문장으로 정리해 submit_reference_analysis로 보낸다. 영상이나 볼 수 없는 링크는 볼 수 없다고 적고, 사용자에게 캡처를 부탁한다고 쓴다.',
    '',
    '모든 작업은 시작 전에 get_brand_guide(account, topic)를 읽는다: 캡션·자막 caption, 이미지 image, 영상 video, 모션 그래픽 motion, 이벤트 event. 기준의 work(Claude 작업 방식)를 따른다(하나만 먼저, 크레딧 견적·보고, 게시 금지, 외국어 검수표).',
    '',
    '[구도 시안 만들기/고치기] 실제 생성 전에 크레딧 없이 보는 컴퓨터 스케치다. 요청 메모에 여러 컷(캐러셀, 스토리)이 있거나 image.cuts가 미리 정해져 있으면 submit_drafts의 cuts로 컷마다 시안을 보낸다(미리 정한 컷은 그 순서·설명을 따른다). 기획 메모, request.note, 연결된 레퍼런스(references, part가 있으면 그 부분용), 브랜드 비주얼 기준을 보고, 4:5(1080x1350) 비율 viewBox의 단순한 SVG 2~3개를 만든다: 무채색 도형으로 제품 위치·크기, 모델/손 위치, 문구 자리, 소품, 빛 방향을 표시하고 한국어 라벨을 붙인다. 고치기는 latestFix.note를 반영한다. submit_drafts로 보낸다.',
    '',
    '[이미지 만들기/고치기] image.pickedDraft(고른 구도 SVG 파일과 메모)를 따른다. 사용자가 시안 없이 맡겼으면(request.noDraft) 기획 메모·request.note·레퍼런스대로 만든다. 컷이 여러 개면 image.cuts의 컷마다 pickedDraft를 따라 컷마다 이미지를 만들고 같은 모델·조명·인물로 이어지게 한다(cut을 붙여 submit_images). 고치기는 latestFix.cuts의 컷만 다시 만든다. 해상도는 가능한 가장 높게(가로 1080px 이상, image.minWidth) 만들고 원본 주소를 보낸다. get_product로 그 제품의 기준 이미지(referenceImages)를 항상 참조 이미지로 쓰고, 모델이 나오면 get_image_folders의 realModels/aiModels 사진을 써서 얼굴을 유지한다. Higgsfield로 생성하기 전에 예상 크레딧을 사용자에게 먼저 알리고 확인을 받는다. 결과는 submit_images로 보낸다(주소 url 또는 Mac 파일 path). 고치기는 latestFix의 핀(x,y는 왼쪽 위 기준 %)과 메모를 반영하고, view_work_image로 지금 결과를 보고 고친다. 그림 속 문구는 그 계정 언어로 쓰고 check_text로 검사한다.',
    '',
    '[최종 이미지 업스케일] image.upscale.files의 이미지만 Higgsfield로 가로 1080px 이상으로 업스케일한다. 예상 크레딧을 먼저 알리고 확인을 받은 뒤 submit_upscaled로 보내면 프로그램이 바로 최종 저장까지 한다.',
    '',
    '[스토리보드 만들기/고치기] 기획·레퍼런스(part가 cut:n이면 그 컷용)를 보고 9:16 릴스 컷 구성을 submit_storyboard로 보낸다. 컷마다 시작·끝(초), 장면 설명, 카메라, 화면 자막 초안(그 계정 언어)과 한국어 뜻. 토큰을 아끼려고 SVG 스케치는 꼭 필요한 컷만 넣는다.',
    '',
    '[영상 편집하기/고치기] video.story를 따른다. 컷에 fromImage가 있으면 그 이미지로 그 컷을 만든다: IMG-002는 그 작업의 최종 이미지, IMG-002:C3은 그 컷의 이미지, 쉼표로 여러 장이면(IMG-002:C5-1,IMG-002:C5-2) 그 순서대로 쓴다(get_work). 연결이 비었거나 바꿔야 하면 link_cut_image로 직접 연결한다. Higgsfield 영상 생성은 예상 크레딧을 먼저 알리고 확인을 받는다. 자막(대사)은 넣지 않는다(프로그램이 나라별로 입힌다).',
    '  · 글자 애니메이션·제목 카드·엔딩·레이아웃 틀이 있는 영상(스토리보드 kind=motion 컷)은 영상 파일을 직접 만들지 말고 submit_motion으로 코드(HTML)와 나라별 글자(motionAccounts 전부), 재료 영상(clips: Higgsfield 결과 주소, 올라온 영상 video:V1, 레퍼런스 등)을 보낸다. 처음 한 번 get_motion_guide를 읽는다. 영상 파일은 프로그램이 만들고 나라별 버전도 글자만 바꿔 프로그램이 만든다. 보내기 전에 preview_motion으로 2~3장면만 확인하면 좋다. 비슷한 영상은 list_motion_templates의 템플릿에서 시작한다(template).',
    '  · 글자 애니메이션 없이 촬영본만 이어 붙이는 편집은 CapCut 연결로 하고 submit_video로 보낸다.',
    '  · 고치기는 latestFix.notes(초 단위 시간과 메모)를 반영한다. 모션 그래픽이면 video.motion.html을 보고 html_edits로 바뀐 부분만 보낸다. video.motion.error가 있으면 그 오류부터 고친다. 필요한 장면만 view_video_frames로 확인한다.',
    '',
    '[자막 쓰기/고치기] languages의 모든 언어를 한 번에 submit_subtitles로 보낸다. 각 언어로 자연스럽게 쓰고, 줄마다 원문만 보고 옮긴 한국어 역번역(back)을 붙인다. 시간은 cuts와 duration에 맞춘다. 자막은 브랜드 자막 디자인으로 입혀지므로 한 줄이 maxCharsPerLine(계정별 글자 수)을 넘지 않게, 한 자막은 두 줄 이내로 쓴다. 영상을 다시 볼 필요는 없다.'
  ].join('\n'),
  inputSchema: {}
}, () => {
  const q = claudeQueue();
  return q.length ? q : '지금 Claude가 처리할 일이 없어요.';
});

tool('get_work', {
  title: '작업 하나 보기',
  description: '작업물(IMG-001, VID-002, HTML-003 같은 번호) 하나의 기획, 캡션, 수정 요청, 기록을 본다.',
  inputSchema: { id: z.string() }
}, ({ id }) => {
  const w = getWork(id);
  return { ...w, image: w.type === 'image' ? imageForClaude(w) : undefined, video: w.type === 'video' ? videoForClaude(w) : undefined, references: refsFor(w.id).map(r => ({ id: r.id, title: r.title, kind: r.kind, memo: r.memo, analysis: r.analysis, parts: r.links.filter(l => l.work === w.id).map(l => l.part || '전체') })) };
});

tool('list_works', {
  title: '게시 일정 보기',
  description: '캘린더에 있는 작업물 목록을 본다. 기간을 주면 그 사이 게시일만 고른다. 날짜는 YYYY-MM-DD.',
  inputSchema: { from: z.string().optional(), to: z.string().optional() }
}, ({ from, to }) => listWorks({ from, to }).map(w => ({ id: w.id, type: w.type, title: w.title, account: w.account, store: w.store, product: w.product, date: w.date, caption: w.caption.status })));

tool('create_work', {
  title: '새 작업 기획하기',
  description: '캘린더에 새 작업물을 만든다. 사용자가 "다음 주 일본 계정 게시물 3개 기획해줘"처럼 요청할 때 쓴다. 그 시장에서 팔지 않는 제품은 만들 수 없다 (list_products로 확인). html은 자사몰(account=SHOP, store=damtix.shop 또는 damtix.eu)만 가능.',
  inputSchema: {
    type: z.enum(['image', 'video', 'html']),
    account: z.enum(['GLOBAL', 'JP', 'EU', 'SHOP']),
    store: z.enum(['damtix.shop', 'damtix.eu']).optional(),
    product: z.string().describe('제품 코드'),
    date: z.string().describe('게시일 YYYY-MM-DD'),
    title: z.string().describe('한국어 작업 제목 (짧게)'),
    memo: z.string().optional().describe('한국어 기획 메모'),
    request_caption: z.boolean().optional().describe('true면 캡션 작성도 바로 할 일 목록에 올린다')
  }
}, a => {
  const w = createWork({ type: a.type, account: a.account, store: a.store, product: a.product, date: a.date, title: a.title, memo: a.memo, requestCaption: a.request_caption }, 'Claude');
  return `${w.id}를 만들었어요 (${w.date}, ${w.account}, ${w.product}). 사용자는 contents controller 캘린더에서 볼 수 있어요.`;
});

tool('get_reference', {
  title: '레퍼런스 보기',
  description: '레퍼런스 하나의 정보와, 이미지 파일이면 그림 자체를 본다. 분석할 때나 시안·이미지를 만들 때 참고한다.',
  inputSchema: { id: z.string().describe('REF-001 같은 번호') }
}, async ({ id }) => {
  const r = getRef(id);
  const info = { id: r.id, kind: r.kind, source: r.source, title: r.title, url: r.url || undefined, memo: r.memo, analysis: r.analysis || undefined, linkedTo: r.links };
  const content = [{ type: 'text', text: JSON.stringify(info, null, 2) }];
  if (r.kind === 'image' && r.file) content.push(await imageContent(refPath(r)));
  else if (r.kind === 'video' && r.file) content.push({ type: 'text', text: '영상 파일이라 직접 볼 수 없어요. 제목과 메모로 판단하거나, 사용자에게 장면 캡처를 부탁하세요.' });
  else if (r.url) content.push({ type: 'text', text: '링크 레퍼런스예요. 열어 볼 수 있으면 열어 보고, 로그인이 필요해서 못 보면 사용자에게 캡처를 부탁하세요.' });
  return { __content: content };
});

tool('submit_reference_analysis', {
  title: '레퍼런스 분석 보내기',
  description: '레퍼런스를 보고 한국어로 정리한 분석(구도, 빛, 색감, 소품, 문구 위치, 영상이면 컷 길이)을 보낸다. 태그는 구도·색감·분위기·모션·컷 구성·소품 중에서 고른다.',
  inputSchema: { id: z.string(), summary: z.string().describe('한국어 3~5문장'), tags: z.array(z.string()).optional(), title: z.string().optional().describe('알아보기 쉬운 한국어 제목 (선택)') }
}, ({ id, summary, tags, title }) => { const r = submitAnalysis({ id, summary, tags, title }); return `${r.id} 분석을 저장했어요.`; });

tool('submit_drafts', {
  title: '구도 시안 보내기',
  description: '이미지 작업의 구도 시안(SVG 스케치)을 보낸다. 한 장짜리는 drafts에 2~3개. 컷이 여러 개인 작업(캐러셀, 영상 컷 이미지, 요청 메모에 여러 컷이 있으면)은 cuts에 컷마다 title·desc와 시안 1~3개를 넣는다. 고칠 때는 latestFix.cuts에 있는 컷만 id(C2 등)를 붙여 보내면 나머지는 그대로 남는다. viewBox는 그 작업의 비율(피드 4:5는 0 0 1080 1350, 릴스·영상 컷은 9:16 0 0 1080 1920). 무채색 도형과 한국어 라벨만 쓰고, 사진이나 외부 링크는 넣지 않는다.',
  inputSchema: {
    work_id: z.string(),
    drafts: z.array(z.object({ title: z.string().describe('예: 시안 A · 제품 정면 클로즈업'), note: z.string().describe('한국어 한두 문장: 구도 의도'), svg: z.string() })).min(1).max(4).optional(),
    cuts: z.array(z.object({ id: z.string().optional().describe('고칠 때만: C1, C2…'), title: z.string().describe('컷 이름 (예: 1 · 뚜껑 여는 손)'), desc: z.string().describe('한국어: 이 컷이 보여줄 것'), drafts: z.array(z.object({ title: z.string(), note: z.string(), svg: z.string() })).min(1).max(3) })).min(1).max(20).optional()
  }
}, ({ work_id, drafts, cuts }) => {
  if (!drafts && !cuts) throw new Error('drafts(한 장짜리) 또는 cuts(여러 컷) 중 하나를 보내 주세요.');
  const w = submitDrafts(work_id, cuts ? { cuts } : drafts);
  return cuts ? `${w.id} ${cuts.length}컷의 구도 시안을 보냈어요. 사용자가 컷마다 고를 차례예요.` : `${w.id} 구도 시안 ${drafts.length}개를 보냈어요. 사용자가 고를 차례예요.`;
});

tool('set_image_cuts', {
  title: '이미지 작업의 컷 정하기',
  description: '이미지 작업을 여러 컷으로 나눈다(캐러셀, 영상 컷 이미지). id는 C1, C2… 또는 영상 컷에 맞춘 C5-1 같은 이름. from에 영상 컷(VID-001:C5)을 넣으면 그 영상 컷에 자동으로 연결된다(한 영상 컷에 여러 장 가능). 시작 전이거나 이미지가 들어오기 전 단계에서 쓴다. 이미 만든 이미지를 옮길 때는 이 도구로 컷을 정한 뒤 submit_images로 컷별로 올린다(구도 시안 단계 없이 바로 올릴 수 있다).',
  inputSchema: { work_id: z.string(), cuts: z.array(z.object({ id: z.string().optional(), title: z.string(), desc: z.string().optional(), from: z.string().optional().describe('VID-001:C5') })).min(1).max(20) }
}, ({ work_id, cuts }) => { const w = setCuts(work_id, cuts, 'Claude'); const linked = w.image.cuts.filter(c => c.from); return `${w.id}를 ${w.image.cuts.length}컷으로 나눴어요 (${w.image.cuts.map(c => c.id).join(', ')}).${linked.length ? ` 영상 컷 연결: ${linked.map(c => `${c.id}→${c.from}`).join(', ')}` : ''}`; });

tool('link_cut_image', {
  title: '영상 컷에 이미지 연결하기',
  description: '영상 작업의 컷(C1…)에 쓸 이미지를 연결한다. image는 IMG-002(그 작업의 최종 이미지), IMG-002:C3(그 컷의 이미지), 여러 장이면 배열 또는 쉼표. 빈 문자열이면 연결을 뺀다. 스토리보드 검수부터 영상 검수 전까지 쓸 수 있다.',
  inputSchema: { video_id: z.string(), links: z.array(z.object({ cut: z.string(), image: z.union([z.string(), z.array(z.string())]) })).min(1).max(30) }
}, ({ video_id, links }) => { let w; for (const l of links) w = setCutImage(video_id, l.cut, l.image, 'Claude'); return `${w.id} 컷 연결: ${w.video.story.cuts.map(c => `${c.id}=${c.fromImage || '없음'}`).join(', ')}`; });

tool('submit_images', {
  title: '만든 이미지 보내기',
  description: 'Higgsfield 등으로 만든 이미지를 작업에 보낸다. 구도 시안 단계 없이 바로 보낼 수도 있다(시작 전 작업, 이미 만든 이미지 옮기기). 각 이미지는 내려받을 수 있는 원본 주소(url, 미리보기·썸네일 주소 말고) 또는 Mac의 파일 경로(path). 가로 1080px 이상이어야 인스타그램에서 선명하다(Higgsfield는 가능한 가장 높은 해상도로 생성). 컷이 여러 개인 작업은 이미지마다 cut(C1, C2…)을 넣고, 고칠 때는 고친 컷만 보내면 나머지 컷은 그대로 남는다. 사용한 프롬프트와 모델도 적는다.',
  inputSchema: {
    work_id: z.string(),
    images: z.array(z.object({ url: z.string().optional(), path: z.string().optional(), cut: z.string().optional(), prompt: z.string().optional(), model: z.string().optional() })).min(1).max(40),
    note: z.string().optional().describe('사용자에게 남길 한국어 한 줄 (예: 사용한 크레딧, 바꾼 점)')
  }
}, async ({ work_id, images, note }) => {
  const w = await submitImages(work_id, images, note);
  const low = w.image.results.filter(r => r.lowRes);
  return `${w.id} 이미지 ${images.length}장을 보냈어요. 사용자가 검수할 차례예요.${low.length ? `\n주의: ${low.map(r => `${r.id} ${r.width}×${r.height}`).join(', ')}는 가로 1080px보다 작아서 인스타그램에서 흐리게 보여요. 원본 주소를 보냈는지 확인하고, 가능하면 더 높은 해상도로 다시 받아 보내 주세요.` : ''}`;
});

tool('view_work_image', {
  title: '작업 이미지 보기',
  description: '작업의 구도 시안(D1-1 같은 번호)이나 결과 이미지(R1-1 같은 번호)를 직접 본다. 수정 요청을 반영하기 전에 지금 상태를 확인할 때 쓴다.',
  inputSchema: { work_id: z.string(), item_id: z.string().describe('D로 시작하면 구도 시안, R로 시작하면 결과 이미지') }
}, async ({ work_id, item_id }) => {
  const w = getWork(work_id);
  const im = imageOf(w);
  const item = [...im.drafts, ...im.results].find(x => x.id === String(item_id).toUpperCase());
  if (!item) throw new Error(`${work_id}에 ${item_id}가 없어요. get_work로 번호를 확인하세요.`);
  const pins = item.pins?.length ? `\n핀 메모 (x,y는 왼쪽 위 기준 %): ${item.pins.map((p, i) => `${i + 1}) (${p.x.toFixed(0)}%, ${p.y.toFixed(0)}%) ${p.note}`).join(' / ')}` : '';
  return { __content: [{ type: 'text', text: `${w.id} ${item.id}${item.title ? ` · ${item.title}` : ''}${pins}` }, await imageContent(path.join(workDir(w.id), item.file))] };
});

tool('submit_upscaled', {
  title: '업스케일한 이미지 보내기',
  description: '최종 이미지 업스케일 작업의 결과를 보낸다. 고른 이미지(result_id) 모두를 보내야 하고, 받으면 프로그램이 최적화·Mac 폴더·Google Drive 저장까지 바로 한다.',
  inputSchema: { work_id: z.string(), items: z.array(z.object({ result_id: z.string(), url: z.string().optional(), path: z.string().optional() })).min(1) }
}, async ({ work_id, items }) => { const w = await submitUpscaled(work_id, items); return `${w.id} 업스케일 이미지를 받아서 최종 저장까지 했어요.`; });

tool('submit_storyboard', {
  title: '스토리보드 보내기',
  description: '영상 작업의 컷 구성을 보낸다. start/end는 초 단위. text는 그 계정 언어의 화면 자막 초안, back은 그 한국어 뜻. from_image에 이미지 작업 번호를 넣으면 그 이미지로 시작하는 컷이 된다. svg 스케치는 선택(9:16 viewBox, 무채색 도형 + 한국어 라벨).',
  inputSchema: {
    work_id: z.string(),
    cuts: z.array(z.object({ start: z.number(), end: z.number(), desc: z.string(), camera: z.string().optional(), text: z.string().optional(), back: z.string().optional(), from_image: z.string().optional(), svg: z.string().optional() })).min(1).max(30),
    note: z.string().optional()
  }
}, ({ work_id, cuts, note }) => { const w = submitStory(work_id, { cuts, note }); return `${w.id} 스토리보드 ${cuts.length}컷을 보냈어요. 사용자가 검수할 차례예요.`; });

tool('submit_video', {
  title: '편집한 영상 보내기',
  description: '완성한 영상(자막 없이)을 보낸다. 내려받을 수 있는 주소(url) 또는 Mac의 파일 경로(path). mp4·mov·webm, 1GB 이하.',
  inputSchema: { work_id: z.string(), url: z.string().optional(), path: z.string().optional(), note: z.string().optional().describe('사용자에게 남길 한국어 한 줄') }
}, async ({ work_id, url, path: p, note }) => { const w = await submitVideo(work_id, { url, path: p, note }); const v = w.video.videos[0]; return `${w.id} 영상을 보냈어요 (${v.duration.toFixed(1)}초, ${v.width}×${v.height}). 사용자가 타임라인으로 검수할 차례예요.`; });

tool('get_motion_guide', {
  title: '모션 그래픽 코드 약속 보기',
  description: 'submit_motion으로 보낼 모션 그래픽 코드(HTML)의 약속(투명 배경, 애니메이션 시간, 나라별 글자, 재료 주소)을 읽는다. 모션 그래픽을 처음 만들 때 한 번 읽는다.',
  inputSchema: {}
}, () => MOTION_GUIDE);

const motionInput = {
  work_id: z.string(),
  html: z.string().optional().describe('모션 그래픽 코드 전체 (처음 보낼 때)'),
  html_edits: z.array(z.object({ find: z.string(), replace: z.string() })).optional().describe('고칠 때: 바뀐 부분만'),
  texts: z.record(z.string(), z.record(z.string(), z.union([z.object({ text: z.string(), back: z.string() }), z.null()]))).optional().describe('계정별 {{키}} 글자: { JP: { title: { text, back } } }'),
  clips: z.array(z.object({ src: z.string(), at: z.number().optional(), from: z.number().optional(), duration: z.number().optional(), fit: z.enum(['cover', 'contain']).optional(), volume: z.number().optional(), muted: z.boolean().optional() })).optional(),
  music: z.object({ src: z.string(), volume: z.number().optional() }).nullable().optional(),
  width: z.number().optional(), height: z.number().optional(), duration: z.number().optional().describe('초'), background: z.string().optional(),
  template: z.string().optional().describe('TPL-001처럼 템플릿에서 시작'),
  note: z.string().optional().describe('사용자에게 남길 한국어 한 줄')
};

tool('submit_motion', {
  title: '모션 그래픽 보내기 (코드 + 나라별 글자)',
  description: '글자 애니메이션이 있는 영상을 코드(HTML)와 나라별 글자, 재료 영상으로 보낸다. 영상 파일은 사용자 Mac의 프로그램이 만든다(1~3분). 약속은 get_motion_guide. 막아야 할 표현이 있거나 글자가 빠지면 저장되지 않는다.',
  inputSchema: motionInput
}, ({ work_id, ...rest }) => { const w = submitMotion(work_id, rest); const m = w.video.motion; return `${w.id} 모션 그래픽 코드를 보냈어요 (${m.comp.duration}초, ${m.comp.width}×${m.comp.height}, 글자 ${m.comp.keys.length}개 × ${Object.keys(m.comp.texts).join('·')}). 프로그램이 영상으로 만든 뒤 사용자가 검수해요. 만들다 실패하면 video.motion.error에 이유가 남아요.`; });

tool('preview_motion', {
  title: '모션 그래픽 장면 미리 보기',
  description: '보내기 전에 코드가 원하는 대로 보이는지 몇 장면(최대 4장)만 그림으로 본다. 저장하지 않는다. 입력은 submit_motion과 같고 times(초)와 account를 고른다.',
  inputSchema: { ...motionInput, times: z.array(z.number()).max(4).optional(), account: z.string().optional() }
}, async ({ work_id, times, account, ...rest }) => {
  try {
    const r = await previewMotion(work_id, rest, times || [0], account);
    return { __content: [{ type: 'text', text: `${work_id} ${r.account} 장면: ${r.frames.map(f => `${f.t}초`).join(', ')}` }, ...r.frames.map(f => ({ type: 'image', data: f.data, mimeType: 'image/jpeg' }))] };
  } finally { await closeBrowser(); }
});

tool('list_motion_templates', {
  title: '모션 그래픽 템플릿 목록',
  description: '사용자가 저장해 둔 모션 그래픽 템플릿(행사 릴스 틀, 당첨자 발표 등). id를 주면 그 템플릿의 코드와 글자 키까지 본다. submit_motion의 template에 id를 넣으면 거기서 시작한다.',
  inputSchema: { id: z.string().optional() }
}, ({ id }) => id ? getTemplate(id) : (listTemplates().map(({ html, texts, clips, ...t }) => t).length ? listTemplates().map(({ html, texts, clips, ...t }) => t) : '저장된 템플릿이 없어요.'));

tool('submit_subtitles', {
  title: '자막 보내기 (모든 언어 한 번에)',
  description: '영상 자막을 언어별로 한 번에 보낸다. tracks의 키는 계정(GLOBAL, JP, EU)이고 값은 [{start, end, text, back}] 목록. back은 원문만 보고 옮긴 한국어 역번역. 금지 표현이 있으면 저장되지 않는다. 자막은 프로그램이 영상에 입힌다.',
  inputSchema: { work_id: z.string(), tracks: z.record(z.string(), z.array(z.object({ start: z.number(), end: z.number(), text: z.string(), back: z.string() }))) }
}, ({ work_id, tracks }) => { const w = submitSubtitles(work_id, tracks); return `${w.id} 자막(${Object.keys(tracks).join(', ')})을 보냈어요. 사용자가 검수할 차례예요.`; });

tool('view_video_frames', {
  title: '영상 장면 보기',
  description: '작업의 최신 영상에서 몇 장면을 작은 사진으로 본다(최대 6장). 수정 메모가 가리키는 시간만 골라 보면 토큰을 아낄 수 있다. times를 비우면 처음·중간·끝.',
  inputSchema: { work_id: z.string(), times: z.array(z.number()).max(6).optional().describe('초 단위') }
}, async ({ work_id, times }) => {
  const r = await framesForClaude(work_id, times);
  return { __content: [{ type: 'text', text: `${work_id} ${r.video.id} (${r.video.duration.toFixed(1)}초) · 장면: ${r.frames.map(f => `${f.t.toFixed(1)}초`).join(', ')}` }, ...r.frames.map(f => ({ type: 'image', data: f.data, mimeType: 'image/jpeg' }))] };
});

tool('submit_caption', {
  title: '캡션 보내기',
  description: '작성한 캡션을 contents controller에 보낸다. 브랜드 기준에 어긋나면 저장되지 않고 이유가 돌아오니, 고쳐서 다시 보낸다. 사용자는 한국어 역번역을 보고 검수한다.',
  inputSchema: {
    id: z.string().describe('작업 번호'),
    text: z.string().describe('캡션 원문 (그 계정 언어)'),
    back_translation: z.string().describe('원문만 보고 다시 한국어로 옮긴 역번역'),
    hashtags: pair('tag', '해시태그와 한국어 뜻'),
    mentions: pair('handle', '멘션 계정과 한국어 설명 (없으면 빈 목록)').optional()
  }
}, a => {
  const w = submitCaption({ id: a.id, text: a.text, backTranslation: a.back_translation, hashtags: a.hashtags, mentions: a.mentions || [] }, 'Claude');
  const cautions = w.caption.current.check.issues.filter(i => i.level === 'caution');
  return `${w.id} 캡션을 보냈어요. 사용자가 검수할 차례예요.${cautions.length ? `\n확인 필요: ${cautions.map(i => i.message).join(' / ')}` : ''}`;
});

await server.connect(new StdioServerTransport());
console.error('contents controller MCP 서버 연결됨');
