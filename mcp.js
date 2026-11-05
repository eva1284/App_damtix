// Claude 연결 창구 (MCP 서버). Claude 데스크톱 앱이 이 파일을 실행해서 브랜드 기준을 읽고, 문구를 검사하고, 업데이트를 제안한다.
// 주의: 표준 출력(stdout)은 Claude와 대화하는 통로라서 로그는 console.error로만 남긴다.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ensureData, load, markClaudeSeen } from './lib/store.js';
import { migrateConfig, productImages, folderMap, collectImages } from './lib/images.js';
import { ACCOUNTS, DEFS, checkText, addProposal } from './lib/rules.js';
import { listWorks, getWork, createWork, submitCaption, queue } from './lib/works.js';

ensureData();
migrateConfig();
const server = new McpServer({ name: 'contents-controller', version: '0.1.0' });
const account = z.enum(['GLOBAL', 'JP', 'EU']);

const ok = data => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
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
    '사용자가 contents controller에서 Claude에게 맡긴 일을 본다. 사용자가 "contents controller 대기 작업 처리해줘"라고 하면 이것부터 호출해서 하나씩 처리한다.',
    '캡션 쓰기/고치기 처리 순서:',
    '1) get_brand_guide(account)와 get_product(product)로 기준을 읽는다.',
    '2) 그 계정 언어로 처음부터 현지화해서 쓴다 (한국어 기획을 직역하지 않는다). JP는 일본 판매명을 쓰고, 효능은 허용 범위 표현만 쓴다.',
    '3) 해시태그는 그 나라에서 실제로 많이 쓰는 태그로 고르고, 각 태그에 한국어 뜻을 붙인다.',
    '4) 한국어 역번역은 원래 한국어 기획을 보지 말고 외국어 원문만 보고 다시 옮긴다. 뜻이 달라졌는지 사용자가 찾을 수 있게 하기 위해서다.',
    '5) check_text로 검사한 뒤 submit_caption으로 보낸다. 고치기(fixRequest가 있음)는 currentCaption을 고쳐서 보낸다.',
    '모두 끝나면 처리한 작업 번호와 한 줄 요약을 한국어로 알려 준다.'
  ].join('\n'),
  inputSchema: {}
}, () => {
  const q = queue();
  return q.length ? q : '지금 Claude가 처리할 일이 없어요.';
});

tool('get_work', {
  title: '작업 하나 보기',
  description: '작업물(IMG-001, VID-002, HTML-003 같은 번호) 하나의 기획, 캡션, 수정 요청, 기록을 본다.',
  inputSchema: { id: z.string() }
}, ({ id }) => getWork(id));

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
