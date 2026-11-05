// 작업물(게시물 단위): 기획 → 캡션 맡기기 → Claude 작성 → 한국어로 검수 → 수정 요청 또는 컨펌
import { load, save } from './store.js';
import { ACCOUNTS, checkText } from './rules.js';

export const TYPES = { image: { label: '이미지', prefix: 'IMG' }, video: { label: '영상', prefix: 'VID' }, html: { label: 'HTML', prefix: 'HTML' } };
export const STORES = { 'damtix.shop': { market: 'US', lang: '영어(미국)' }, 'damtix.eu': { market: 'EU', lang: '프랑스어' } };
export const CAPTION_STATUS = {
  none: '캡션 없음', requested: 'Claude가 캡션 작성할 차례', fix: 'Claude가 캡션 고칠 차례', review: '캡션 검수할 차례', confirmed: '캡션 컨펌됨'
};

const all = () => load('works'); // 파일이 깨졌으면 덮어쓰지 않고 오류를 낸다
const now = () => new Date().toISOString();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function marketOf(w) { return w.account === 'SHOP' ? STORES[w.store]?.market : ACCOUNTS[w.account]?.market; }
export function langOf(w) { return w.account === 'SHOP' ? STORES[w.store]?.lang : ACCOUNTS[w.account]?.lang; }

function nextId(type) {
  const pre = TYPES[type].prefix;
  const n = Math.max(0, ...all().filter(w => w.type === type).map(w => Number(w.id.split('-')[1]) || 0)) + 1;
  return `${pre}-${String(n).padStart(3, '0')}`;
}

function validate(w) {
  if (!TYPES[w.type]) throw new Error('종류는 이미지, 영상, HTML 중 하나여야 해요.');
  if (w.type === 'html' && w.account !== 'SHOP') throw new Error('HTML은 자사몰(damtix.shop, damtix.eu)용이에요. 계정에서 자사몰을 골라 주세요.');
  if (w.account === 'SHOP') {
    if (w.type !== 'html') throw new Error('자사몰에는 HTML 작업만 만들 수 있어요.');
    if (!STORES[w.store]) throw new Error('자사몰은 damtix.shop 또는 damtix.eu 중에서 골라 주세요.');
  } else if (!ACCOUNTS[w.account]) throw new Error('계정은 GLOBAL, JP, EU, SHOP 중 하나여야 해요.');
  const p = load('products').find(x => x.code === w.product);
  if (!p) throw new Error(`제품 코드 ${w.product}를 찾을 수 없어요.`);
  if (!p.markets[marketOf(w)]) throw new Error(`${p.names.KR}(${p.code})는 이 시장(${marketOf(w)})에서 팔지 않는 제품이라 만들 수 없어요.`);
  if (!DATE_RE.test(w.date || '') || Number.isNaN(Date.parse(w.date))) throw new Error('게시일을 YYYY-MM-DD 형식으로 넣어 주세요.');
  if (!w.title || !String(w.title).trim()) throw new Error('작업 제목을 넣어 주세요.');
  if (String(w.title).length > 80) throw new Error('제목은 80자 이하로 줄여 주세요.');
}

function commit(list, w, what, by) {
  w.updatedAt = now();
  if (what) w.log.unshift({ at: w.updatedAt, what, by }); // 진행률 같은 작은 변경은 기록에 남기지 않는다
  save('works', list);
  return w;
}

function find(list, id) {
  const w = list.find(x => x.id === String(id).toUpperCase());
  if (!w) throw new Error(`작업 ${id}를 찾을 수 없어요.`);
  return w;
}

// 다른 모듈(이미지 제작 등)이 작업물을 고칠 때 쓰는 공통 함수: fn이 기록에 남길 문장을 돌려준다
export function mutate(id, by, fn) {
  const list = all();
  const w = find(list, id);
  const what = fn(w);
  return commit(list, w, what, by);
}

export function listWorks({ from, to } = {}) {
  return all().filter(w => (!from || w.date >= from) && (!to || w.date <= to)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
export const getWork = id => find(all(), id);

export function createWork(input, by = '화면') {
  const list = all();
  const w = {
    id: nextId(input.type), type: input.type, title: String(input.title || '').trim(), account: input.account,
    store: input.account === 'SHOP' ? input.store : undefined, product: String(input.product || '').toUpperCase(),
    date: input.date, memo: String(input.memo || '').trim(), createdAt: now(), updatedAt: now(),
    caption: { status: 'none', request: null, current: null, versions: [], fixes: [] }, log: []
  };
  validate(w);
  list.push(w);
  commit(list, w, '작업을 만들었어요', by);
  if (input.requestCaption && w.account !== 'SHOP') return requestCaption(w.id, input.captionNote, by);
  return w;
}

export function updateWork(id, fields, by = '화면') {
  const list = all();
  const w = find(list, id);
  const next = { ...w };
  for (const k of ['title', 'date', 'memo', 'product']) if (k in fields) next[k] = typeof fields[k] === 'string' ? fields[k].trim() : fields[k];
  if ('product' in fields) next.product = String(next.product).toUpperCase();
  validate(next);
  const changed = ['title', 'date', 'memo', 'product'].filter(k => next[k] !== w[k]);
  if (!changed.length) throw new Error('바뀐 내용이 없어요.');
  Object.assign(w, next);
  return commit(list, w, `기획 수정: ${changed.map(k => ({ title: '제목', date: '게시일', memo: '메모', product: '제품' }[k])).join(', ')}`, by);
}

export function deleteWork(id) {
  const list = all();
  const w = find(list, id);
  save('works', list.filter(x => x !== w));
  return { id: w.id };
}

export function requestCaption(id, note, by = '화면') {
  const list = all();
  const w = find(list, id);
  if (w.account === 'SHOP') throw new Error('자사몰 HTML에는 인스타그램 캡션이 없어요.');
  if (w.caption.status === 'requested' || w.caption.status === 'fix') throw new Error('이미 Claude에게 맡겨 둔 상태예요.');
  w.caption.status = 'requested';
  w.caption.request = { note: String(note || '').trim(), at: now() };
  return commit(list, w, w.caption.current ? '캡션을 새로 만들어 달라고 맡겼어요' : '캡션 작성을 맡겼어요', by);
}

function cleanPairs(arr, key, max) {
  if (arr == null) return [];
  if (!Array.isArray(arr)) throw new Error(`${key} 목록 형식이 잘못됐어요.`);
  if (arr.length > max) throw new Error(`${key}는 ${max}개 이하로 넣어 주세요.`);
  return arr.map(x => {
    const v = String(x?.[key] || '').trim();
    const ko = String(x?.ko || '').trim();
    if (!v) throw new Error(`비어 있는 ${key}가 있어요.`);
    if (!ko) throw new Error(`${v}의 한국어 뜻(ko)이 없어요. 사용자는 한국어로만 검수해요.`);
    return { [key]: v, ko };
  });
}

// Claude가 쓴 캡션을 저장한다. 막아야 할 문제가 있으면 저장하지 않고 이유를 돌려준다.
export function submitCaption({ id, text, backTranslation, hashtags, mentions }, by = 'Claude') {
  const list = all();
  const w = find(list, id);
  if (!['requested', 'fix'].includes(w.caption.status)) throw new Error(`${w.id}는 지금 캡션을 받을 차례가 아니에요 (${CAPTION_STATUS[w.caption.status]}).`);
  const t = String(text || '').trim();
  const back = String(backTranslation || '').trim();
  if (!t) throw new Error('캡션 원문이 비어 있어요.');
  if (!back) throw new Error('한국어 역번역이 비어 있어요. 원래 기획을 보지 말고 외국어 원문만 보고 한국어로 옮겨 주세요.');
  if (t.length > 2200) throw new Error('인스타그램 캡션은 2,200자 이하여야 해요.');
  const tags = cleanPairs(hashtags, 'tag', 30).map(h => ({ ...h, tag: h.tag.startsWith('#') ? h.tag : `#${h.tag}` }));
  const ments = cleanPairs(mentions, 'handle', 20).map(m => ({ ...m, handle: m.handle.startsWith('@') ? m.handle : `@${m.handle}` }));
  const check = checkText({ text: [t, ...tags.map(h => h.tag)].join('\n'), account: w.account, product: w.product });
  if (!check.ok) {
    const e = new Error(`브랜드 기준에 맞지 않아 저장하지 않았어요. 고친 뒤 다시 보내 주세요:\n${check.issues.filter(i => i.level === 'block').map(i => `- ${i.message}`).join('\n')}`);
    e.issues = check.issues;
    throw e;
  }
  if (w.caption.current) w.caption.versions.unshift(w.caption.current);
  w.caption.current = { text: t, back, hashtags: tags, mentions: ments, check, at: now(), by };
  const wasFix = w.caption.status === 'fix';
  w.caption.status = 'review';
  return commit(list, w, wasFix ? '고친 캡션이 들어왔어요' : '캡션이 들어왔어요', by);
}

export function fixCaption(id, note, by = '화면') {
  const list = all();
  const w = find(list, id);
  if (w.caption.status !== 'review') throw new Error('검수 중인 캡션만 수정 요청할 수 있어요.');
  const n = String(note || '').trim();
  if (!n) throw new Error('무엇을 고칠지 한국어로 적어 주세요.');
  w.caption.status = 'fix';
  w.caption.fixes.unshift({ note: n, at: now() });
  return commit(list, w, `캡션 수정 요청: ${n}`, by);
}

export function confirmCaption(id, by = '화면') {
  const list = all();
  const w = find(list, id);
  if (w.caption.status !== 'review') throw new Error('검수 중인 캡션만 컨펌할 수 있어요.');
  w.caption.status = 'confirmed';
  return commit(list, w, '캡션을 컨펌했어요', by);
}

export function reopenCaption(id, by = '화면') {
  const list = all();
  const w = find(list, id);
  if (w.caption.status !== 'confirmed') throw new Error('컨펌된 캡션만 다시 열 수 있어요.');
  w.caption.status = 'review';
  return commit(list, w, '컨펌을 풀고 다시 검수해요', by);
}

// Claude가 처리할 일 목록
export function queue() {
  const products = load('products');
  return all().filter(w => ['requested', 'fix'].includes(w.caption.status)).map(w => {
    const p = products.find(x => x.code === w.product);
    return {
      workId: w.id, task: w.caption.status === 'fix' ? '캡션 고치기' : '캡션 쓰기',
      type: TYPES[w.type].label, title: w.title, account: w.account, accountHandle: ACCOUNTS[w.account]?.handle, language: langOf(w),
      product: w.product, productName: p ? (w.account === 'JP' ? p.names.JP : p.names.EN) : w.product,
      postDate: w.date, plan: w.memo, direction: w.caption.request?.note || '',
      fixRequest: w.caption.status === 'fix' ? w.caption.fixes[0]?.note : undefined,
      currentCaption: w.caption.status === 'fix' ? w.caption.current : undefined
    };
  });
}
