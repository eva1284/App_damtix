// Claude 연결 창구 (MCP 서버). Claude 데스크톱 앱이 이 파일을 실행해서 브랜드 기준을 읽고, 문구를 검사하고, 업데이트를 제안한다.
// 주의: 표준 출력(stdout)은 Claude와 대화하는 통로라서 로그는 console.error로만 남긴다.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { ensureData, load, markClaudeSeen } from './lib/store.js';
import { ACCOUNTS, DEFS, checkText, addProposal } from './lib/rules.js';

ensureData();
const server = new McpServer({ name: 'contents-controller', version: '0.1.0' });
const account = z.enum(['GLOBAL', 'JP', 'EU']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.avif']);

const ok = data => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const err = e => ({ isError: true, content: [{ type: 'text', text: e.message || String(e) }] });
function tool(name, config, handler) {
  server.registerTool(name, config, async args => {
    try { markClaudeSeen(name); return ok(await handler(args || {})); } catch (e) { return err(e); }
  });
}
const splitWords = s => String(s || '').split(',').map(w => w.trim()).filter(Boolean);

function referenceImages(code) {
  const base = path.join(load('config').imageRoot, '01_제품');
  if (!fs.existsSync(base)) return { folder: null, files: [], note: `기준 이미지 폴더가 없어요: ${base}` };
  const dir = fs.readdirSync(base, { withFileTypes: true }).find(d => d.isDirectory() && (d.name === code || d.name.startsWith(`${code}_`)));
  if (!dir) return { folder: null, files: [], note: `${base} 안에 ${code}로 시작하는 폴더가 없어요.` };
  const folder = path.join(base, dir.name);
  const files = [];
  const walk = (abs, depth) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(abs, e.name);
      if (e.isDirectory() && depth < 1) walk(p, depth + 1);
      else if (e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase())) files.push(p);
    }
  };
  walk(folder, 0);
  return { folder, files: files.sort() };
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

await server.connect(new StdioServerTransport());
console.error('contents controller MCP 서버 연결됨');
