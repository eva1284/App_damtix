// Claude 연결 창구 (MCP 서버). Claude 데스크톱 앱이 이 파일을 실행해서 브랜드 기준을 읽고, 문구를 검사하고, 업데이트를 제안한다.
// 주의: 표준 출력(stdout)은 Claude와 대화하는 통로라서 로그는 console.error로만 남긴다.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ensureData, load, markClaudeSeen } from './lib/store.js';
import { migrateConfig, productImages, folderMap, collectImages } from './lib/images.js';
import { ACCOUNTS, DEFS, checkText, addProposal } from './lib/rules.js';
import { listWorks, getWork, createWork, submitCaption } from './lib/works.js';
import { getRef, refPath, refsFor, submitAnalysis } from './lib/refs.js';
import { submitDrafts, submitImages, submitUpscaled, imageForClaude, imageOf } from './lib/imagework.js';
import { submitStory, submitVideo, submitSubtitles, videoForClaude, framesForClaude } from './lib/videowork.js';
import { workDir } from './lib/files.js';
import { finalsConfig } from './lib/finalize.js';
import { claudeQueue } from './lib/queue.js';
import sharp from 'sharp';
import path from 'node:path';

ensureData();
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

tool('get_brand_guide', {
  title: '브랜드 기준 읽기',
  description: 'Damtix 브랜드 기준(절대 원칙)을 읽는다. 캡션·자막·이미지 문구·HTML을 만들거나 고치기 전에 반드시 먼저 호출한다. account를 주면 그 인스타그램 계정의 톤과 금지 표현만 골라 준다.',
  inputSchema: { account: account.optional().describe('GLOBAL(@damtix.global, 영어 미국), JP(@damtix.jp, 일본어), EU(@damtix_eu, 프랑스어만)') }
}, ({ account: acc }) => {
  const b = load('brand');
  const accounts = acc ? { [acc]: ACCOUNTS[acc] } : ACCOUNTS;
  return {
    brandVersion: `v${b.version}`,
    source: b.source,
    rule: '이 기준은 절대 원칙이다. 어긋나는 문구는 만들지 말고, 결과를 보여 주기 전에 check_text로 검사한다. 사용자는 한국어로만 검수할 수 있으니 외국어 문구에는 항상 한국어 역번역(외국어만 보고 다시 한국어로 옮긴 것)을 함께 준다.',
    core: b.core,
    accounts: Object.fromEntries(Object.entries(accounts).map(([k, a]) => [k, { ...a, tone: b.tone[k], banned: splitWords(b.rules[`${k}_ban`]), useInstead: b.rules[`${k}_alt`] }])),
    allAccounts: { banned: splitWords(b.rules.ALL_ban), useInstead: b.rules.ALL_alt },
    visual: b.visual
  };
});

tool('list_products', {
  title: '제품 목록',
  description: 'Damtix 제품(SKU) 목록과 시장별 판매 여부를 본다. account를 주면 그 계정에서 쓸 수 있는 제품만 sellable=true로 표시한다.',
  inputSchema: { account: account.optional() }
}, ({ account: acc }) => load('products').map(p => ({
  code: p.code, version: `v${p.version}`, names: p.names, volume: p.volume, markets: p.markets,
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
    '[구도 시안 만들기/고치기] 실제 생성 전에 크레딧 없이 보는 컴퓨터 스케치다. 기획 메모, request.note, 연결된 레퍼런스(references, part가 있으면 그 부분용), 브랜드 비주얼 기준을 보고, 4:5(1080x1350) 비율 viewBox의 단순한 SVG 2~3개를 만든다: 무채색 도형으로 제품 위치·크기, 모델/손 위치, 문구 자리, 소품, 빛 방향을 표시하고 한국어 라벨을 붙인다. 고치기는 latestFix.note를 반영한다. submit_drafts로 보낸다.',
    '',
    '[이미지 만들기/고치기] image.pickedDraft(고른 구도 SVG 파일과 메모)를 따른다. get_product로 그 제품의 기준 이미지(referenceImages)를 항상 참조 이미지로 쓰고, 모델이 나오면 get_image_folders의 realModels/aiModels 사진을 써서 얼굴을 유지한다. Higgsfield로 생성하기 전에 예상 크레딧을 사용자에게 먼저 알리고 확인을 받는다. 결과는 submit_images로 보낸다(주소 url 또는 Mac 파일 path). 고치기는 latestFix의 핀(x,y는 왼쪽 위 기준 %)과 메모를 반영하고, view_work_image로 지금 결과를 보고 고친다. 그림 속 문구는 그 계정 언어로 쓰고 check_text로 검사한다.',
    '',
    '[최종 이미지 업스케일] image.upscale.files의 이미지만 Higgsfield로 가로 1080px 이상으로 업스케일한다. 예상 크레딧을 먼저 알리고 확인을 받은 뒤 submit_upscaled로 보내면 프로그램이 바로 최종 저장까지 한다.',
    '',
    '[스토리보드 만들기/고치기] 기획·레퍼런스(part가 cut:n이면 그 컷용)를 보고 9:16 릴스 컷 구성을 submit_storyboard로 보낸다. 컷마다 시작·끝(초), 장면 설명, 카메라, 화면 자막 초안(그 계정 언어)과 한국어 뜻. 토큰을 아끼려고 SVG 스케치는 꼭 필요한 컷만 넣는다.',
    '',
    '[영상 편집하기/고치기] video.story를 따른다. 컷에 fromImage(이미지 작업 번호)가 있으면 그 작업의 최종 이미지로 그 컷을 만든다(get_work). Higgsfield 영상 생성은 예상 크레딧을 먼저 알리고 확인을 받는다. 편집은 CapCut 연결이 있으면 그것으로 한다. 자막은 넣지 않는다(프로그램이 나라별로 입힌다). 완성 영상은 submit_video로 보낸다. 고치기는 latestFix.notes(초 단위 시간과 메모)를 반영하고, 필요한 장면만 view_video_frames로 확인한다.',
    '',
    '[자막 쓰기/고치기] languages의 모든 언어를 한 번에 submit_subtitles로 보낸다. 각 언어로 자연스럽게 쓰고, 줄마다 원문만 보고 옮긴 한국어 역번역(back)을 붙인다. 시간은 cuts와 duration에 맞춘다. 한 줄은 짧게(영어 기준 40자 이내). 영상을 다시 볼 필요는 없다.'
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
  description: '이미지 작업의 구도 시안(SVG 스케치) 2~3개를 보낸다. viewBox는 4:5 비율(예: 0 0 1080 1350). 무채색 도형과 한국어 라벨만 쓰고, 사진이나 외부 링크는 넣지 않는다. 사용자가 하나를 고르면 그 구도로 이미지를 만든다.',
  inputSchema: {
    work_id: z.string(),
    drafts: z.array(z.object({ title: z.string().describe('예: 시안 A · 제품 정면 클로즈업'), note: z.string().describe('한국어 한두 문장: 구도 의도'), svg: z.string() })).min(1).max(4)
  }
}, ({ work_id, drafts }) => { const w = submitDrafts(work_id, drafts); return `${w.id} 구도 시안 ${drafts.length}개를 보냈어요. 사용자가 고를 차례예요.`; });

tool('submit_images', {
  title: '만든 이미지 보내기',
  description: 'Higgsfield 등으로 만든 이미지를 작업에 보낸다. 각 이미지는 내려받을 수 있는 주소(url) 또는 Mac의 파일 경로(path)로 준다. 사용한 프롬프트와 모델도 적는다. 보내면 사용자가 핀 메모로 검수한다.',
  inputSchema: {
    work_id: z.string(),
    images: z.array(z.object({ url: z.string().optional(), path: z.string().optional(), prompt: z.string().optional(), model: z.string().optional() })).min(1).max(8),
    note: z.string().optional().describe('사용자에게 남길 한국어 한 줄 (예: 사용한 크레딧, 바꾼 점)')
  }
}, async ({ work_id, images, note }) => { const w = await submitImages(work_id, images, note); return `${w.id} 이미지 ${images.length}장을 보냈어요. 사용자가 검수할 차례예요.`; });

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
