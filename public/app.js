// contents controller 화면 (1단계: 홈, 브랜드 기준, 문구 검사)
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null; // 서버에서 받은 상태
const ui = { btab: 'brand', sku: 'GTCP', edit: null, images: {}, check: { text: '', account: 'GLOBAL', product: '', result: null } };

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { location.reload(); throw new Error('접속 코드가 필요해요.'); }
  if (!r.ok) throw new Error(j.error || `요청에 실패했어요 (${r.status})`);
  return j;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3200); }
const head = (title, sub) => `<div class="topline"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div></div>`;
const ago = iso => { if (!iso) return ''; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
const day = iso => new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/* ---------- 메뉴 ---------- */
const ICON = {
  home: '<path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  refs: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M3 18l6-5 4 3 3-2 5 4"/>',
  video: '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="M17 10l4-2v8l-4-2z"/>',
  html: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  brand: '<path d="M12 3l8 4v5c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V7z"/>',
  check: '<path d="M4 12l5 5L20 6"/>'
};
const NAV = [['home', '홈'], ['brand', '브랜드 기준'], ['check', '문구 검사'], ['calendar', '캘린더', 1], ['refs', '레퍼런스', 1], ['image', '이미지', 1], ['video', '영상', 1], ['html', 'HTML', 1]];
function renderNav(cur) {
  $('#nav').innerHTML = NAV.map(([k, t, soon]) => `<a href="#${k}" ${k === cur ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">${ICON[k]}</svg><span>${t}</span>${k === 'brand' && S.proposals.length ? `<span class="count">${S.proposals.length}</span>` : soon ? '<span class="soonmark">준비 중</span>' : ''}</a>`).join('');
}

/* ---------- 홈 ---------- */
function vHome() {
  const i = S.info, last = S.history[0];
  const seen = i.claudeLastSeen;
  return head('홈', '1단계에서는 브랜드 기준을 관리하고 Claude와 연결해요.') + `
  ${S.proposals.length ? `<a class="hint" href="#brand" data-btab="prop" style="text-decoration:none;color:var(--ink);display:flex;gap:8px;align-items:center"><span class="chip st-warn">승인 필요</span>브랜드 기준 업데이트 제안 ${S.proposals.length}건이 기다려요 →</a>` : ''}
  <div class="grid g-2">
    <section class="panel"><div class="panel-h"><h2>브랜드 기준</h2><a class="btn sm" href="#brand">열기</a></div>
      <div class="status"><span class="dot ok"></span><div><b>브랜드 v${esc(S.brand.version)}</b> · 제품 ${S.products.length}개<div class="small muted">마지막 변경: ${esc(last.label)} · ${esc(last.what)} · ${ago(last.at)}</div></div></div>
      <div class="status"><span class="dot"></span><div class="small muted">기준 자료: ${esc(S.brand.source)}</div></div>
    </section>
    <section class="panel"><div class="panel-h"><h2>Claude 연결</h2></div>
      <div class="status"><span class="dot ${seen ? 'ok' : 'warn'}"></span><div>${seen ? `<b>연결됨</b><div class="small muted">마지막 사용 ${ago(seen.at)} · ${esc(seen.tool)}</div>` : `<b>아직 연결 기록이 없어요</b><div class="small muted">앱 폴더의 <code>connect-claude.command</code>를 한 번 더블클릭하고 Claude 앱을 다시 열어 주세요.</div>`}</div></div>
      <div class="status"><span class="dot"></span><div class="small">Claude 앱에서 이렇게 말해 보세요<div class="cmd" style="margin-top:8px"><code>contents controller 브랜드 기준 보여줘</code></div></div></div>
    </section>
    ${i.local ? `<section class="panel"><div class="panel-h"><h2>폰에서 열기</h2></div>
      ${i.phone.urls.length ? `<div class="status"><span class="dot ok"></span><div class="small">Mac과 같은 Wi-Fi에서 폰 브라우저로 여세요.${i.phone.urls.map(u => `<div class="mono" style="font-size:14px;margin-top:4px">${esc(u)}</div>`).join('')}</div></div>
      <div class="status"><span class="dot"></span><div class="small">처음 한 번 접속 코드를 넣어요: <b class="mono" style="font-size:17px">${esc(i.phone.accessCode)}</b></div></div>` : '<div class="status"><span class="dot warn"></span><div class="small">Wi-Fi에 연결되어 있지 않아요.</div></div>'}
    </section>` : ''}
    ${i.local ? `<section class="panel"><div class="panel-h"><h2>이미지 폴더</h2></div>
      <div class="status"><span class="dot ${i.imageRootExists ? 'ok' : 'warn'}"></span><div class="small" style="min-width:0">${i.imageRootExists ? '연결됨' : '폴더를 찾을 수 없어요'}<div class="mono">${esc(i.imageRoot)}</div></div></div>
      <div class="addbar"><input type="text" id="imgroot" value="${esc(i.imageRoot)}" aria-label="이미지 폴더 경로"><button class="btn sm" data-act="setroot">바꾸기</button></div>
      <p class="small muted" style="margin:8px 0 0">제품 기준 이미지는 이 폴더의 <code class="mono">01_제품/제품코드_이름/</code>에서 찾아요.</p>
    </section>` : ''}
  </div>`;
}

/* ---------- 브랜드 기준 ---------- */
const prodBy = c => S.products.find(p => p.code === c);
function resolve(key) {
  const [a, b, c] = key.split('.');
  if (a === 'brand') return { def: S.defs.brand[b], obj: S.brand[b] };
  const p = prodBy(b);
  return { def: S.defs.product[c], obj: c === 'content' ? p : p[c] };
}
const fmtVal = v => typeof v === 'boolean' ? (v ? '판매' : '판매 안 함') : String(v ?? '');
function secView(key) {
  const { def, obj } = resolve(key);
  const E = ui.edit && ui.edit.key === key ? ui.edit : null;
  let inner;
  if (!E) {
    inner = `<dl class="kv">${def.fields.map(([k, l, t]) => `<dt>${esc(l)}</dt><dd>${t === 'check' ? `<span class="chip ${obj[k] ? 'st-done' : 'st-crit'}">${fmtVal(obj[k])}</span>` : esc(obj[k]) || '<span class="muted">비어 있음</span>'}</dd>`).join('')}</dl>`;
  } else if (E.step === 'edit') {
    inner = `<div class="form">${def.fields.map(([k, l, t]) => {
      const id = `f-${key.replace(/\./g, '-')}-${k}`, v = E.draft[k];
      if (t === 'check') return `<label style="flex-direction:row;align-items:center;gap:12px;color:var(--ink);min-height:44px"><input type="checkbox" id="${id}" data-f="${k}" ${v ? 'checked' : ''}> ${esc(l)}</label>`;
      return `<label for="${id}">${esc(l)}${t === 'textarea' ? `<textarea id="${id}" data-f="${k}">${esc(v)}</textarea>` : `<input type="text" id="${id}" data-f="${k}" value="${esc(v)}">`}</label>`;
    }).join('')}</div>
    <div class="row" style="margin-top:16px"><button class="btn" data-ecancel>취소</button><span class="spacer"></span><button class="btn primary" data-econfirm>바뀐 내용 확인</button></div>`;
  } else {
    const ch = def.fields.filter(([k]) => E.draft[k] !== obj[k]);
    const lost = key.endsWith('.markets') ? def.fields.filter(([k]) => obj[k] && !E.draft[k]).map(([k]) => k) : [];
    const ver = key.startsWith('brand.') ? `브랜드 v${bump(S.brand.version)}` : `${key.split('.')[1]} v${prodBy(key.split('.')[1]).version + 1}`;
    inner = `<div class="diff">${ch.length ? ch.map(([k, l]) => `<div class="d"><b class="small">${esc(l)}</b><div><del>${esc(fmtVal(obj[k]))}</del></div><div><ins>${esc(fmtVal(E.draft[k]))}</ins></div></div>`).join('') : '<p class="empty">바뀐 내용이 없어요.</p>'}</div>
    ${lost.length ? `<div class="cautionbox">주의: 저장하면 ${lost.join(', ')} 시장의 콘텐츠에서 이 제품을 쓸 수 없게 돼요. Claude도 이 제품을 그 시장 콘텐츠에 넣지 않아요.</div>` : ''}
    <label class="small" style="display:block;margin-top:16px">바꾸는 이유 (기록에 남아요)<input type="text" id="ereason" value="${esc(E.reason)}" placeholder="예: 매뉴얼 새 버전 반영, 법무 검토 의견" style="width:100%"></label>
    <p class="small" style="margin:12px 0 0">저장하면 <b>${ver}</b>이 되고, Claude는 다음 작업부터 새 기준을 읽어요.</p>
    <div class="row" style="margin-top:16px"><button class="btn" data-eback>다시 고치기</button><span class="spacer"></span><button class="btn primary" data-esave ${ch.length ? '' : 'disabled'}>저장</button></div>`;
  }
  return `<section class="panel"><div class="panel-h"><h2>${esc(def.title)}</h2>${E ? '<span class="chip st-warn">수정 중</span>' : `<button class="btn sm" data-edit="${key}">수정</button>`}</div>${def.note ? `<p class="small muted" style="margin:-8px 0 12px">${esc(def.note)}</p>` : ''}${inner}</section>`;
}
const bump = v => { const [a, b] = String(v).split('.').map(Number); return `${a}.${(b || 0) + 1}`; };

function imagesPanel(p) {
  const im = ui.images[p.code];
  if (!im) { loadImages(p.code); return `<section class="panel"><div class="panel-h"><h2>기준 이미지</h2></div><p class="empty">불러오는 중…</p></section>`; }
  const count = im.groups.reduce((n, g) => n + g.files.length, 0);
  let body;
  if (!im.exists) body = `<div class="cautionbox">이미지 폴더에 <code class="mono">01_제품</code> 폴더가 없어요: ${esc(im.base)}</div>`;
  else if (!im.folder) body = `<div class="cautionbox"><code class="mono">01_제품</code> 안에 <b>${p.code}</b>로 시작하는 폴더를 만들어 주세요. 예: <code class="mono">${p.code}_${esc(p.names.KR.replace(/\s/g, ''))}</code></div>`;
  else if (!count) body = `<p class="empty">폴더는 있지만 이미지가 없어요: ${esc(im.folder)}</p>`;
  else body = im.groups.map(g => `<h3 style="margin-top:12px">${esc(g.name)} <span class="small muted" style="font-weight:400">${g.files.length}장</span></h3><div class="imgs">${g.files.map(f => `<a href="/file?rel=${encodeURIComponent(f.rel)}" target="_blank" rel="noopener" title="${esc(f.name)}"><img src="/file?rel=${encodeURIComponent(f.rel)}" alt="${esc(f.name)}" loading="lazy"></a>`).join('')}</div>`).join('');
  return `<section class="panel"><div class="panel-h"><h2>기준 이미지 <span class="small muted" style="font-weight:400">${count}장</span></h2><button class="btn sm" data-reimg="${p.code}">새로 고침</button></div>
    <p class="small muted" style="margin:-8px 0 8px">이미지를 만들 때 Claude가 항상 이 사진들을 참조해요. 바꾸려면 폴더 안의 파일을 바꾸면 돼요.</p>${body}</section>`;
}
async function loadImages(code) {
  try { ui.images[code] = await api(`/api/products/${code}/images`); } catch (e) { ui.images[code] = { exists: false, base: e.message, groups: [] }; }
  if (cur === 'brand' && ui.btab === 'sku' && ui.sku === code) render();
}

function vBrand() {
  const tabs = [['brand', '브랜드 전체'], ['sku', '제품별 (SKU)'], ['prop', `업데이트 제안${S.proposals.length ? ' ' + S.proposals.length : ''}`], ['hist', '변경 이력']];
  let body = '';
  if (ui.btab === 'brand') body = ['brand.core', 'brand.tone', 'brand.rules', 'brand.visual'].map(secView).join('');
  if (ui.btab === 'sku') {
    const p = prodBy(ui.sku) || S.products[0];
    const r = p.registration || {};
    body = `<div class="skuw"><aside class="skulist" aria-label="제품 목록">${S.products.map(x => `<button class="item" data-sku="${x.code}" aria-current="${x.code === p.code}"><span style="min-width:0"><span class="it">${esc(x.names.KR)}</span><span class="m"><span class="code">${x.code}</span><span class="ver">v${x.version}</span>${['US', 'JP', 'EU'].filter(m => !x.markets[m]).length ? `<span class="chip st-plan">${['US', 'JP', 'EU'].filter(m => x.markets[m]).join('·')}만</span>` : ''}</span></span></button>`).join('')}</aside>
      <div style="display:flex;flex-direction:column;gap:16px;min-width:0">
        <div class="row"><h2 style="font-size:21px">${esc(p.names.KR)}</h2><span class="code">${p.code} · ${esc(p.volume)}</span><span class="ver">v${p.version}</span></div>
        ${secView(`product.${p.code}.names`)}${secView(`product.${p.code}.markets`)}${secView(`product.${p.code}.content`)}
        ${imagesPanel(p)}
        <section class="panel"><div class="panel-h"><h2>등록 정보</h2><span class="small muted">매뉴얼 원문 그대로</span></div>
          <dl class="kv"><dt>EAN</dt><dd class="mono">${esc(r.ean)}</dd><dt>미국 MoCRA</dt><dd class="mono">${esc(r.mocra)}</dd><dt>EU CPNP</dt><dd class="mono">${esc(r.cpnp) || '<span class="muted">없음 (EU 미판매)</span>'}</dd><dt>개봉 후 사용기간</dt><dd>${esc(r.paoMonths)}개월</dd></dl>
          <details class="inci"><summary>전성분 (INCI) 보기</summary><p>${esc(p.inci)}</p></details>
        </section>
      </div></div>`;
  }
  if (ui.btab === 'prop') {
    body = `<section class="panel"><div class="panel-h"><h2>업데이트 제안이 들어오는 길</h2></div>
      <ul class="small" style="margin:0;padding-left:20px;color:var(--muted)"><li>Claude 앱에 "P7XL 사용법 바꿔줘"처럼 말하면 Claude가 여기에 제안을 올려요.</li><li>새 매뉴얼이 나오면 Claude 앱에 매뉴얼을 주고 "contents controller 기준과 비교해서 바뀐 점을 제안해줘"라고 하세요.</li><li>제안은 직접 [반영]해야 기준에 적용돼요.</li></ul></section>
      ${S.proposals.length ? S.proposals.map(pr => { let cur = ''; try { cur = resolve(pr.key).obj[pr.field]; } catch { cur = '(찾을 수 없음)'; } return `<section class="panel"><div class="panel-h"><h2>${esc(pr.label)}</h2><div class="row"><span class="chip st-warn">승인 필요</span><span class="small muted">${esc(pr.source)} · ${ago(pr.at)}</span></div></div>
        ${pr.reason ? `<p class="small" style="margin:0 0 12px">이유: ${esc(pr.reason)}</p>` : ''}
        <div class="diff"><div class="d"><div><del>${esc(fmtVal(cur))}</del></div><div><ins>${esc(fmtVal(pr.newValue))}</ins></div></div></div>
        <div class="row" style="margin-top:16px"><button class="btn" data-pno="${pr.id}">무시</button><span class="spacer"></span><button class="btn primary" data-pok="${pr.id}">반영</button></div></section>`; }).join('') : '<p class="empty">승인을 기다리는 제안이 없어요.</p>'}`;
  }
  if (ui.btab === 'hist') {
    body = `<section class="panel"><div class="tbl"><table class="subs"><thead><tr><th>버전</th><th>날짜</th><th>범위</th><th>바뀐 내용</th><th>이유</th><th>누가</th><th></th></tr></thead><tbody>${S.history.map((h, i) => `<tr><td><span class="ver">${esc(h.label)}</span></td><td class="tc">${day(h.at)}</td><td>${esc(h.scope)}</td><td>${esc(h.what)}</td><td>${esc(h.reason)}</td><td>${esc(h.by)}</td><td>${i === 0 ? '<span class="small muted">지금</span>' : `<button class="btn sm" data-rollback="${h.id}">이 상태로 되돌리기</button>`}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted" style="margin:12px 0 0">되돌리면 그 시점의 브랜드·제품 기준 전체로 돌아가고, 되돌린 것도 새 기록으로 남아요.</p></section>`;
  }
  return head('브랜드 기준', `모든 작업의 기준이에요. 브랜드 v${esc(S.brand.version)} · Claude는 작업 전에 항상 최신 기준을 읽어요.`) + `
  <div class="tabs" role="tablist">${tabs.map(([k, t]) => `<button role="tab" aria-selected="${ui.btab === k}" data-btab="${k}">${t}</button>`).join('')}</div>
  ${body}`;
}

/* ---------- 문구 검사 ---------- */
function vCheck() {
  const c = ui.check, r = c.result;
  return head('문구 검사', '캡션·자막·배너 문구를 붙여넣으면 브랜드 기준으로 검사해요. Claude도 같은 검사를 써요.') + `
  <section class="panel checker">
    <div class="grid g-2">
      <label class="small">계정<select class="btn" id="ck-acc" style="width:100%;margin-top:8px">${Object.entries(S.accounts).map(([k, a]) => `<option value="${k}" ${c.account === k ? 'selected' : ''}>${k} · ${esc(a.handle)} · ${esc(a.lang)}</option>`).join('')}</select></label>
      <label class="small">제품 (선택)<select class="btn" id="ck-prod" style="width:100%;margin-top:8px"><option value="">제품 없음</option>${S.products.map(p => `<option value="${p.code}" ${c.product === p.code ? 'selected' : ''}>${p.code} · ${esc(p.names.KR)}</option>`).join('')}</select></label>
    </div>
    <label class="small" style="display:block;margin-top:16px">검사할 문구<textarea id="ck-text" placeholder="예: This cream lifts your skin in minutes.">${esc(c.text)}</textarea></label>
    <div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn primary" data-act="check">검사하기</button></div>
  </section>
  ${r ? `<section class="panel"><div class="panel-h"><h2>결과</h2>${r.ok ? (r.issues.length ? '<span class="chip st-warn">확인 필요</span>' : '<span class="chip st-done">문제 없음</span>') : '<span class="chip st-crit">고쳐야 해요</span>'}</div>
    ${r.issues.length ? r.issues.map(i => `<div class="check"><span class="ic ${i.level === 'block' ? 'bad' : ''}" style="${i.level === 'caution' ? 'background:var(--yellow-soft);color:var(--yellow)' : ''}">!</span><span>${esc(i.message)}</span></div>`).join('') : '<div class="check"><span class="ic ok">✓</span><span>금지 표현과 판매 시장 모두 문제 없어요.</span></div>'}
    <p class="small muted" style="margin:12px 0 0">검사 기준: 브랜드 ${esc(r.checkedWith.brand)}${r.checkedWith.product ? ` · ${esc(r.checkedWith.product)}` : ''}</p></section>` : ''}`;
}

/* ---------- 준비 중 화면 ---------- */
const SOON = {
  calendar: ['캘린더', '2단계', ['계정 3개(GLOBAL·JP·EU)와 자사몰의 주간·월간 게시 일정', '새 작업 기획 → Claude에게 맡기기']],
  refs: ['레퍼런스', '3단계', ['인터넷 이미지·영상·링크를 끌어다 놓기, ⌘V 붙여넣기', '작업물·컷·섹션에 연결, Claude 분석']],
  image: ['이미지', '3단계', ['구도 시안 → Higgsfield 생성 → 핀 메모 검수 → 최종 컨펌', '캡션·해시태그 3개 언어 + 한국어 역번역', '언어 버전 만들기, 영상·HTML로 넘기기']],
  video: ['영상', '4단계', ['스토리보드 컨펌 → 제작 → 타임라인 구간 메모', '자막 3개 언어 + 역번역, 최종 컨펌 때 SRT 저장']],
  html: ['HTML', '5단계', ['자사몰(damtix.shop · damtix.eu) 섹션 구성 → 제작 → PC·모바일 미리보기 검수']]
};
function vSoon(k) {
  const [t, step, items] = SOON[k];
  return head(t, `${step}에서 열려요.`) + `<section class="panel soon"><span class="chip st-plan">준비 중</span><ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p class="small muted" style="margin:0">화면 미리보기에서 만든 모습 그대로 단계별로 만들어 갈게요.</p></section>`;
}

/* ---------- 라우터 ---------- */
const VIEWS = { home: vHome, brand: vBrand, check: vCheck };
let cur = 'home';
function render() {
  const h = location.hash.replace('#', '');
  cur = VIEWS[h] || SOON[h] ? h : 'home';
  renderNav(cur);
  $('#view').innerHTML = VIEWS[cur] ? VIEWS[cur]() : vSoon(cur);
}
window.addEventListener('hashchange', () => { $('.rail').classList.remove('open'); $('#menuBtn').setAttribute('aria-expanded', 'false'); ui.edit = null; render(); scrollTo(0, 0); });

async function run(fn) { try { await fn(); } catch (e) { toast(e.message); } }

document.addEventListener('click', e => {
  const t = e.target.closest('button,a[data-btab]'); if (!t) return;
  const d = t.dataset;
  if (d.act === 'menu') { const r = $('.rail'); const open = !r.classList.contains('open'); r.classList.toggle('open', open); t.setAttribute('aria-expanded', open); return; }
  if (d.btab) { ui.btab = d.btab; ui.edit = null; if (t.tagName === 'BUTTON') render(); return; }
  if (d.sku) { ui.sku = d.sku; ui.edit = null; render(); return; }
  if (d.edit) { const { def, obj } = resolve(d.edit); const draft = {}; def.fields.forEach(([k]) => (draft[k] = obj[k])); ui.edit = { key: d.edit, step: 'edit', draft, reason: '' }; render(); return; }
  if ('ecancel' in d) { ui.edit = null; render(); return; }
  if ('econfirm' in d) { ui.edit.step = 'confirm'; render(); return; }
  if ('eback' in d) { ui.edit.step = 'edit'; render(); return; }
  if ('esave' in d) return run(async () => { const E = ui.edit; const r = await api('/api/change', { key: E.key, draft: E.draft, reason: E.reason }); S = r.state; ui.edit = null; render(); toast(`${r.label}로 저장했어요. Claude는 다음 작업부터 새 기준을 써요.`); });
  if (d.pok) return run(async () => { const r = await api(`/api/proposals/${d.pok}/accept`, {}); S = r.state; render(); toast(`반영했어요: ${r.label}`); });
  if (d.pno) return run(async () => { S = (await api(`/api/proposals/${d.pno}/reject`, {})).state; render(); toast('제안을 무시했어요. 기준은 그대로예요.'); });
  if (d.rollback) return run(async () => { const r = await api('/api/rollback', { historyId: d.rollback }); S = r.state; ui.images = {}; render(); toast(`${r.label}했어요.`); });
  if (d.reimg) { delete ui.images[d.reimg]; render(); return; }
  if (d.act === 'setroot') return run(async () => { S = (await api('/api/config', { imageRoot: $('#imgroot').value })).state; ui.images = {}; render(); toast(S.info.imageRootExists ? '이미지 폴더를 바꿨어요.' : '저장했지만 그 경로에 폴더가 없어요.'); });
  if (d.act === 'check') return run(async () => { const c = ui.check; c.text = $('#ck-text').value; c.account = $('#ck-acc').value; c.product = $('#ck-prod').value; if (!c.text.trim()) { $('#ck-text').focus(); return; } c.result = await api('/api/check', { text: c.text, account: c.account, product: c.product || undefined }); render(); });
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.f && ui.edit) ui.edit.draft[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value;
  if (t.id === 'ereason' && ui.edit) ui.edit.reason = t.value;
  if (t.id === 'ck-text') ui.check.text = t.value;
});
document.addEventListener('change', e => { const t = e.target; if (t.dataset.f && ui.edit && t.type === 'checkbox') ui.edit.draft[t.dataset.f] = t.checked; });

// 다른 곳(Claude 앱, 다른 기기)에서 바뀐 내용을 30초마다 반영. 수정 중일 때는 건드리지 않는다.
setInterval(() => { if (ui.edit || document.hidden) return; api('/api/state').then(s => { const changed = JSON.stringify([s.brand, s.products, s.proposals, s.history[0]?.id, s.info.claudeLastSeen]) !== JSON.stringify([S.brand, S.products, S.proposals, S.history[0]?.id, S.info.claudeLastSeen]); S = s; if (changed && cur !== 'check') render(); }).catch(() => {}); }, 30000);

api('/api/state').then(s => { S = s; render(); }).catch(e => { $('#view').innerHTML = `<p class="loading">${esc(e.message)}</p>`; });
