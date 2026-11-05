// 인수인계서(2026-10-26~11-05 작업 기록) 반영: 이미 쓰고 있는 데이터에 한 번만 적용한다.
// 사용자가 고친 값은 덮어쓰지 않는다. 처음 값 그대로인 것만 바꾸고, 금지 표현·제품 규칙은 빠진 것만 더한다.
// 브랜드 버전이 한 번 오르고 변경 이력에 남으므로 "되돌리기"로 이전 상태로 돌아갈 수 있다.
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, load, save, snapshot, newId } from './store.js';
import { bumpBrand } from './rules.js';

export const HANDOVER_ID = 'handover-2026-11-05';
const seed = name => JSON.parse(fs.readFileSync(path.join(APP_DIR, 'seed', `${name}.json`), 'utf8'));

// 예전 기본값 (이 값 그대로면 사용자가 고치지 않은 것)
const OLD = {
  'core.slogan': 'Aesthetic precision, brought to your routine. FROM SEOUL.',
  'tone.GLOBAL': '짧고 명확하게. 효과는 외관 표현으로만 ("helps skin look …")',
  'tone.JP': '정중하고 부드럽게. 약기법 56개 효능 범위 안에서만',
  'tone.EU': '세련되고 절제된 톤. 근거 없는 주장 금지 (EU 655/2013). 프랑스어만 사용',
  'rules.JP_alt': '肌を整える, 肌にハリを与える, 肌にうるおいを与える',
  'visual.color': '무채색 중심 (블랙·화이트·그레이). 색은 제품·소품에서만',
  'subtitle.size': '50' // 이전 작업의 자막 크기(1080 기준 약 35~40px)에 맞춰 조금 작게
};
const OLD_KR = { GTCR: '그린티 캘러스 리페어 크림', VLE: '볼륨 리프트 아이크림', VLER: '볼륨 리프트 아이크림 리필' };
const BLANK = v => v === undefined || v === null || String(v).trim() === '' || String(v).trim() === '(채워 주세요)';
const words = s => String(s || '').split(',').map(w => w.trim()).filter(Boolean);

export function applyHandover() {
  const config = load('config');
  if ((config.migrations || []).includes(HANDOVER_ID)) return null;
  config.migrations = [...(config.migrations || []), HANDOVER_ID];
  save('config', config); // 두 프로그램(화면·Claude 연결)이 동시에 켜져도 한 번만

  const sb = seed('brand'), sp = seed('products');
  const brand = load('brand'), products = load('products');
  const changed = [];
  const get = (o, k) => k.split('.').reduce((a, x) => a?.[x], o);
  const set = (o, k, v) => { const [a, b] = k.split('.'); o[a] = o[a] || {}; o[a][b] = v; };
  // 처음 값 그대로이거나 비어 있으면 새 값으로
  for (const k of Object.keys(OLD)) {
    const cur = get(brand, k);
    if ((cur === OLD[k] || BLANK(cur)) && cur !== get(sb, k)) { set(brand, k, get(sb, k)); changed.push(k); }
  }
  for (const k of ['visual.light', 'visual.model', 'visual.avoid']) if (BLANK(get(brand, k))) { set(brand, k, get(sb, k)); changed.push(k); }
  // 금지 표현은 빠진 것만 더한다
  for (const k of ['GLOBAL_ban', 'JP_ban', 'EU_ban', 'ALL_ban']) {
    const cur = words(brand.rules?.[k]);
    const add = words(sb.rules[k]).filter(w => !cur.some(c => c.toLowerCase() === w.toLowerCase()));
    if (add.length) { brand.rules[k] = [...cur, ...add].join(', '); changed.push(`rules.${k} +${add.length}`); }
  }
  // 새 항목(사실·인증, 작업 방식, 릴스, 이미지 생성, 이벤트, 웹, 서체, 로고 등)은 비어 있을 때만 채운다
  for (const [sec, fields] of Object.entries(sb)) {
    if (!fields || typeof fields !== 'object') continue;
    for (const [f, v] of Object.entries(fields)) if (BLANK(brand[sec]?.[f]) && !BLANK(v)) { set(brand, `${sec}.${f}`, v); changed.push(`${sec}.${f}`); }
  }
  // 제품: 한국어 표기, 일본어 종류, 실물 형태, 시험 근거, 제품별 규칙
  const prodChanged = [];
  for (const p of products) {
    const s = sp.find(x => x.code === p.code);
    if (!s) continue;
    const before = JSON.stringify(p);
    if (OLD_KR[p.code] && p.names.KR === OLD_KR[p.code]) p.names.KR = s.names.KR;
    if (BLANK(p.names.JPkind) && !BLANK(s.names.JPkind)) p.names.JPkind = s.names.JPkind;
    for (const f of ['look', 'tests']) if (BLANK(p[f]) && !BLANK(s[f])) p[f] = s[f];
    const lines = String(p.rules || '').split('\n').map(x => x.trim()).filter(Boolean);
    for (const l of String(s.rules || '').split('\n').map(x => x.trim()).filter(Boolean)) if (!lines.includes(l)) lines.push(l);
    p.rules = lines.join('\n');
    if (JSON.stringify(p) !== before) { p.version += 1; prodChanged.push(`${p.code} v${p.version}`); }
  }
  if (!changed.length && !prodChanged.length) return { changed: [], products: [] };
  brand.version = bumpBrand(brand.version);
  save('brand', brand);
  save('products', products);
  const history = load('history');
  history.unshift({
    id: newId('h'), at: new Date().toISOString(), label: `브랜드 v${brand.version}`, scope: `브랜드 전체${prodChanged.length ? ` + 제품 ${prodChanged.length}개` : ''}`,
    what: `인수인계서 반영: 사실·인증 표기, Claude 작업 방식, 영상·릴스 규칙, 이미지·AI 생성 규칙, 이벤트·당첨자 콘텐츠, 웹 규칙, 서체·자간, 로고, 금지 표현 추가, 제품별 실물 형태·시험 근거${prodChanged.length ? ` (${prodChanged.join(', ')})` : ''}`,
    reason: '이전 AI의 인수인계서(10/26~11/5 작업 기록). 사용자가 고친 값은 그대로 두고 빈 칸과 처음 값만 바꿈',
    by: '인수인계서', snapshot: snapshot()
  });
  save('history', history);
  return { changed, products: prodChanged };
}

// 2차: 작업 회고(VID-001) 반영 — 영상이 컨펌됐는데 자막이 시작되지 않은 작업은 자막을 대기 목록에 올린다
export const FEEDBACK_ID = 'feedback-2026-11-05';
export function applyFeedback() {
  const config = load('config');
  if ((config.migrations || []).includes(FEEDBACK_ID)) return null;
  config.migrations = [...(config.migrations || []), FEEDBACK_ID];
  save('config', config);
  const works = load('works');
  const fixed = [];
  for (const w of works) {
    const v = w.video;
    if (w.type !== 'video' || !v || v.stage !== 'video_ok' || v.subs?.off || (v.subs && v.subs.status !== 'none')) continue;
    v.subs = { status: 'requested', tracks: {}, fixes: [], at: new Date().toISOString() };
    w.updatedAt = new Date().toISOString();
    w.log.unshift({ at: w.updatedAt, what: '영상 컨펌 뒤 멈춰 있던 자막을 Claude에게 맡겼어요', by: '프로그램' });
    fixed.push(w.id);
  }
  if (fixed.length) save('works', works);
  return { subtitles: fixed };
}
export function applyMigrations() { return { handover: applyHandover(), feedback: applyFeedback() }; }
