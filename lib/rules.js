// 브랜드 기준의 구조, 수정 규칙, 금지 표현 검사. 화면과 Claude 연결 창구가 함께 쓴다.
import { load, save, snapshot, readSnapshot, newId, fillFromSeed } from './store.js';
import { listFonts } from './fonts.js';

export const ACCOUNTS = {
  GLOBAL: { handle: '@damtix.global', lang: '영어(미국)', market: 'US' },
  JP: { handle: '@damtix.jp', lang: '일본어', market: 'JP' },
  EU: { handle: '@damtix_eu', lang: '프랑스어', market: 'EU' }
};

// [필드 이름, 화면 이름, 입력 종류]
export const DEFS = {
  brand: {
    core: { title: '브랜드 핵심', fields: [['slogan', '슬로건', 'input'], ['positioning', '포지셔닝', 'input'], ['target', '타깃', 'input'], ['signature', '시그니처 성분', 'input']] },
    tone: { title: '톤앤매너 (계정별)', fields: [['GLOBAL', 'GLOBAL · 영어(미국)', 'textarea'], ['JP', 'JP · 일본어', 'textarea'], ['EU', 'EU · 프랑스어', 'textarea']] },
    rules: { title: '금지 표현과 대신 쓰는 표현', note: '쉼표로 구분해요. 캡션·자막·HTML 문구를 검사할 때 이 목록을 씁니다.', fields: [['GLOBAL_ban', 'GLOBAL 금지', 'textarea'], ['GLOBAL_alt', 'GLOBAL 대신', 'input'], ['JP_ban', 'JP 금지', 'textarea'], ['JP_alt', 'JP 대신', 'input'], ['EU_ban', 'EU 금지', 'textarea'], ['EU_alt', 'EU 대신', 'input'], ['ALL_ban', '공통 금지', 'input'], ['ALL_alt', '공통 대신', 'input']] },
    visual: { title: '비주얼 기준', note: '"(채워 주세요)"로 된 칸은 아직 정해지지 않은 값이에요.', fields: [['color', '색', 'input'], ['light', '빛', 'input'], ['model', '모델', 'input'], ['avoid', '피할 것', 'input']] },
    subtitle: {
      title: '자막 디자인 (영상)',
      note: '모든 영상의 나라별 자막이 이 디자인으로 입혀져요. 어둡게 칠한 곳은 인스타그램 버튼·설명이 덮는 곳이라 자막을 그 위에 둬요.',
      fields: [
        ['font_GLOBAL', 'GLOBAL · 영어 글꼴', 'font'], ['font_EU', 'EU · 프랑스어 글꼴', 'font'], ['font_JP', 'JP · 일본어 글꼴', 'font'], ['font_KR', '한국어 글꼴', 'font'],
        ['weight', '굵기', 'select', [['300', '얇게'], ['400', '보통'], ['500', '중간'], ['600', '조금 굵게'], ['700', '굵게'], ['800', '아주 굵게']]],
        ['size', '글자 크기 (px, 가로 1080 기준)', 'number', [28, 96]],
        ['position', '높이 (화면 위에서 자막 아래 끝까지, %)', 'number', [30, 80]],
        ['color', '글씨 색 기본값', 'select', [['auto', '자동: 밝은 장면은 검정, 어두운 장면은 흰색'], ['white', '항상 흰 글씨'], ['black', '항상 검정 글씨']]],
        ['edge', '글씨 테두리', 'select', [['outline', '얇은 테두리'], ['shadow', '부드러운 그림자'], ['none', '없음']]]
      ]
    }
  },
  product: {
    names: { title: '제품명 (시장별)', fields: [['KR', '한국어 (검수용)', 'input'], ['EN', '영어 · GLOBAL·damtix.shop', 'input'], ['JP', '일본 판매명', 'input'], ['FR', '프랑스어 계정·damtix.eu 표기', 'input']] },
    markets: { title: '판매 시장', fields: [['US', '미국 (GLOBAL · damtix.shop)', 'check'], ['JP', '일본 (JP)', 'check'], ['EU', '유럽 (EU · damtix.eu)', 'check']] },
    content: { title: '핵심 정보와 제품별 규칙', fields: [['keyIngredients', '핵심 성분', 'textarea'], ['usage', '사용법', 'textarea'], ['rules', '제품별 규칙 (한 줄에 하나)', 'textarea']] }
  }
};

// key: 'brand.core' 또는 'product.P7XL.names'
export function resolveKey(key, brand, products) {
  const parts = String(key).split('.');
  if (parts[0] === 'brand' && parts.length === 2 && DEFS.brand[parts[1]]) {
    return { def: DEFS.brand[parts[1]], obj: brand[parts[1]], scope: '브랜드 전체', product: null };
  }
  if (parts[0] === 'product' && parts.length === 3 && DEFS.product[parts[2]]) {
    const p = products.find(x => x.code === parts[1]);
    if (!p) throw new Error(`제품 코드 ${parts[1]}를 찾을 수 없어요.`);
    const obj = parts[2] === 'content' ? p : p[parts[2]];
    return { def: DEFS.product[parts[2]], obj, scope: `제품 · ${p.code}`, product: p };
  }
  throw new Error(`알 수 없는 기준 위치예요: ${key}`);
}

export const bumpBrand = v => { const [a, b] = String(v).split('.').map(Number); return `${a}.${(b || 0) + 1}`; };

function cleanValue(type, v, opts, label = '') {
  if (type === 'check') return v === true;
  if (type === 'number') {
    const n = Number(v);
    if (String(v).trim() === '' || !Number.isFinite(n) || n < opts[0] || n > opts[1]) throw new Error(`${label}은(는) ${opts[0]}~${opts[1]} 사이 숫자로 넣어 주세요.`);
    return String(Math.round(n));
  }
  if (type === 'select') {
    if (!opts.some(([k]) => k === String(v))) throw new Error(`${label}에 고를 수 없는 값이에요: ${v}`);
    return String(v);
  }
  if (type === 'font') {
    const fonts = listFonts().map(f => f.family);
    if (!fonts.includes(String(v))) throw new Error(`"${v}" 글꼴이 없어요. 들어 있는 글꼴: ${fonts.join(', ')}`);
    return String(v);
  }
  if (typeof v !== 'string') throw new Error('글자만 넣을 수 있어요.');
  if (v.length > 4000) throw new Error('너무 길어요. 4000자 이하로 줄여 주세요.');
  return v.trim();
}

// 기준 하나를 바꾸고, 버전을 올리고, 기록을 남긴다.
export function applyChange({ key, draft, reason, by }) {
  const brand = load('brand');
  const products = load('products');
  const { def, obj, scope, product } = resolveKey(key, brand, products);
  const changed = [];
  for (const [k, label, type, opts] of def.fields) {
    if (!(k in (draft || {}))) continue;
    const v = cleanValue(type, draft[k], opts, label);
    if (obj[k] !== v) { obj[k] = v; changed.push(label); }
  }
  if (!changed.length) throw new Error('바뀐 내용이 없어요.');
  let label;
  if (product) { product.version += 1; label = `${product.code} v${product.version}`; }
  else { brand.version = bumpBrand(brand.version); label = `브랜드 v${brand.version}`; }
  save('brand', brand);
  save('products', products);
  const history = load('history');
  history.unshift({ id: newId('h'), at: new Date().toISOString(), label, scope, what: `${def.title}: ${changed.join(', ')}`, reason: (reason || '').trim() || '(이유 없음)', by: by || '화면', snapshot: snapshot() });
  save('history', history);
  return { label, changed };
}

// 기록 하나의 상태로 되돌린다. 되돌린 것도 새 기록이 되고, 버전 숫자는 계속 올라간다.
export function rollback(historyId) {
  const history = load('history');
  const h = history.find(x => x.id === historyId);
  if (!h) throw new Error('해당 기록을 찾을 수 없어요.');
  if (history[0].id === historyId) throw new Error('이미 지금 상태예요.');
  const snap = readSnapshot(h.snapshot);
  const curBrand = load('brand');
  const curProducts = load('products');
  const same = (a, b) => JSON.stringify({ ...a, version: 0 }) === JSON.stringify({ ...b, version: 0 });
  const brand = fillFromSeed(snap.brand); // 예전 기록에 없던 항목(자막 디자인 등)은 기본값으로
  brand.version = same(brand, curBrand) ? curBrand.version : bumpBrand(curBrand.version);
  const products = snap.products.map(p => {
    const cur = curProducts.find(x => x.code === p.code);
    if (!cur) return p;
    return { ...p, version: same(p, cur) ? cur.version : cur.version + 1 };
  });
  save('brand', brand);
  save('products', products);
  const label = `${h.label} 상태로 복원`;
  history.unshift({ id: newId('h'), at: new Date().toISOString(), label, scope: h.scope, what: `${h.label} 시점으로 되돌림`, reason: '되돌리기', by: '화면', snapshot: snapshot() });
  save('history', history);
  return { label };
}

// 업데이트 제안: Claude나 새 매뉴얼 비교 결과. 사용자가 승인해야 반영된다.
export function addProposal({ key, field, newValue, reason, source }) {
  const brand = load('brand');
  const products = load('products');
  const { def, obj, scope } = resolveKey(key, brand, products);
  const f = def.fields.find(x => x[0] === field);
  if (!f) throw new Error(`${def.title}에는 "${field}" 항목이 없어요. 가능한 항목: ${def.fields.map(x => x[0]).join(', ')}`);
  const value = cleanValue(f[2], newValue, f[3], f[1]);
  if (obj[field] === value) throw new Error('지금 기준과 같은 내용이라 제안할 게 없어요.');
  const proposals = load('proposals');
  const p = { id: newId('pr'), key, field, label: `${scope} · ${f[1]}`, newValue: value, reason: (reason || '').trim(), source: source || 'Claude 앱', at: new Date().toISOString() };
  proposals.unshift(p);
  save('proposals', proposals);
  return p;
}

export function acceptProposal(id) {
  const proposals = load('proposals');
  const p = proposals.find(x => x.id === id);
  if (!p) throw new Error('해당 제안을 찾을 수 없어요.');
  const result = applyChange({ key: p.key, draft: { [p.field]: p.newValue }, reason: p.reason ? `${p.source}: ${p.reason}` : p.source, by: '제안 승인' });
  save('proposals', proposals.filter(x => x.id !== id));
  return result;
}

export function rejectProposal(id) {
  const proposals = load('proposals');
  if (!proposals.some(x => x.id === id)) throw new Error('해당 제안을 찾을 수 없어요.');
  save('proposals', proposals.filter(x => x.id !== id));
}

const splitWords = s => String(s || '').split(',').map(w => w.trim()).filter(Boolean);
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function findWord(text, word) {
  // 영어·프랑스어 단어는 단어 경계로 찾는다 ("cure"가 "secure"에 걸리지 않게). 한·중·일 글자는 그대로 찾는다.
  if (/^[\p{Script=Latin}\s'-]+$/u.test(word)) {
    // 어미 변화도 잡는다: heal → heals, healed, healing
    return new RegExp(`(^|[^\\p{L}])${escapeRe(word)}(?:s|es|d|ed|ing)?(?=$|[^\\p{L}])`, 'iu').test(text);
  }
  return text.includes(word);
}

// 문구 검사: 막아야 할 것(block)과 확인할 것(caution)을 돌려준다.
export function checkText({ text, account, product }) {
  const brand = load('brand');
  const products = load('products');
  if (!ACCOUNTS[account]) throw new Error(`계정은 ${Object.keys(ACCOUNTS).join(', ')} 중 하나여야 해요.`);
  const issues = [];
  const banned = [...splitWords(brand.rules[`${account}_ban`]), ...splitWords(brand.rules.ALL_ban)];
  for (const w of banned) if (findWord(text, w)) issues.push({ level: 'block', type: 'banned_word', word: w, message: `금지 표현 "${w}"가 들어 있어요. 대신 쓰는 표현: ${brand.rules[`${account}_alt`] || brand.rules.ALL_alt}` });
  let p = null;
  if (product) {
    p = products.find(x => x.code === product);
    if (!p) throw new Error(`제품 코드 ${product}를 찾을 수 없어요.`);
    const market = ACCOUNTS[account].market;
    if (!p.markets[market]) issues.push({ level: 'block', type: 'not_sold', message: `${p.names.KR}(${p.code})는 ${account} 계정 시장(${market})에서 팔지 않는 제품이에요.` });
    if (account === 'JP' && p.names.JP && !text.includes(p.names.JP)) issues.push({ level: 'caution', type: 'jp_name_missing', message: `일본 판매명 "${p.names.JP}"이 문구에 없어요.` });
  }
  return { ok: !issues.some(i => i.level === 'block'), issues, checkedWith: { brand: `v${brand.version}`, product: p ? `${p.code} v${p.version}` : null } };
}
