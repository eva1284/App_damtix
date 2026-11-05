// contents controller 화면 (1단계: 브랜드 기준·문구 검사 / 2단계: 캘린더·작업 맡기기·캡션 검수)
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null; // 서버에서 받은 상태
const ui = { btab: 'brand', sku: 'GTCP', edit: null, images: {}, check: { text: '', account: 'GLOBAL', product: '', result: null }, week: null, newWork: null, workEdit: null, fixOpen: false, confirmDelete: false };

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
const NAV = [['home', '홈'], ['calendar', '캘린더'], ['brand', '브랜드 기준'], ['check', '문구 검사'], ['refs', '레퍼런스', 1], ['image', '이미지', 1], ['video', '영상', 1], ['html', 'HTML', 1]];
const myTurn = () => S.works.filter(w => w.caption.status === 'review');
const badge = k => k === 'home' ? myTurn().length : k === 'brand' ? S.proposals.length : 0;
function renderNav(cur) {
  $('#nav').innerHTML = NAV.map(([k, t, soon]) => `<a href="#${k}" ${k === cur ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">${ICON[k]}</svg><span>${t}</span>${badge(k) ? `<span class="count">${badge(k)}</span>` : soon ? '<span class="soonmark">준비 중</span>' : ''}</a>`).join('');
}

/* ---------- 공통: 작업물 ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const mondayOf = s => { const d = parseYmd(s); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return ymd(d); };
const today = () => ymd(new Date());
const md = s => { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const DOW = ['월', '화', '수', '목', '금', '토', '일'];
const accLabel = w => w.account === 'SHOP' ? w.store : w.account;
function workState(w) {
  if (w.account === 'SHOP') return { t: '기획', c: 'st-plan' };
  return { none: { t: '기획', c: 'st-plan' }, requested: { t: 'Claude 차례', c: 'st-claude' }, fix: { t: 'Claude 고치는 중', c: 'st-claude' }, review: { t: '캡션 검수', c: 'st-you' }, confirmed: { t: '캡션 컨펌', c: 'st-done' } }[w.caption.status];
}
const stateChip = w => { const s = workState(w); return `<span class="chip ${s.c}">${s.t}</span>`; };
const workLink = w => `#work-${w.id}`;
const cmdBox = () => `<div class="cmd"><span class="small">Claude 데스크톱 앱에 입력</span><code id="cmdtxt">contents controller 대기 작업 처리해줘</code><button class="btn sm" data-act="copycmd">복사</button></div>`;
function workRow(w) {
  const p = prodBy(w.product);
  return `<a class="task" href="${workLink(w)}" style="text-decoration:none"><div class="thumb" style="display:grid;place-items:center;font-size:12px;color:var(--muted)">${S.types[w.type].label}</div><div style="min-width:0"><div class="t">${esc(w.title)}</div><div class="m"><span class="chip acc">${esc(accLabel(w))}</span><span class="code">${w.id} · ${w.product}${p ? '' : ''}</span><span class="small muted">${md(w.date)} 게시</span></div></div>${stateChip(w)}</a>`;
}

/* ---------- 홈 ---------- */
function vHome() {
  const i = S.info, last = S.history[0], seen = i.claudeLastSeen;
  const mine = myTurn();
  const upcoming = S.works.filter(w => w.date >= today() && w.date <= addDays(today(), 6));
  return head('홈', '내 차례인 일과 Claude에게 맡긴 일을 먼저 보여드려요.') + `
  ${S.proposals.length ? `<a class="hint" href="#brand" data-btab="prop" style="text-decoration:none;color:var(--ink);display:flex;gap:8px;align-items:center"><span class="chip st-warn">승인 필요</span>브랜드 기준 업데이트 제안 ${S.proposals.length}건이 기다려요 →</a>` : ''}
  <div class="grid g-main">
    <section class="panel"><div class="panel-h"><h2>내 차례 <span class="small muted" style="font-weight:400">${mine.length}건</span></h2><a class="btn sm" href="#calendar">캘린더</a></div>
      ${mine.length ? `<div class="tasks">${mine.map(workRow).join('')}</div>` : `<p class="empty">검수할 캡션이 없어요.${upcoming.length ? ` 이번 주 게시 예정 ${upcoming.length}건은 캘린더에서 볼 수 있어요.` : ' 캘린더에서 새 작업을 기획해 보세요.'}</p>`}
    </section>
    <section class="panel"><div class="panel-h"><h2>Claude 차례 <span class="small muted" style="font-weight:400">${S.queue.length}건</span></h2></div>
      ${S.queue.length ? `<ul class="queue">${S.queue.map(q => `<li><span class="chip st-claude">${esc(q.task)}</span><a href="#work-${q.workId}" style="min-width:0;flex:1;color:var(--ink)">${esc(q.title)}</a><span class="code">${q.workId}</span></li>`).join('')}</ul><div style="margin-top:12px">${cmdBox()}</div><p class="small muted" style="margin:8px 0 0">여러 건을 모아 두었다가 한 번에 맡겨도 돼요. 결과는 이 화면에 자동으로 들어와요.</p>` : '<p class="empty">Claude에게 맡긴 일이 없어요.</p>'}
    </section>
  </div>
  <h2 style="margin-top:8px">상태</h2>
  <div class="grid g-2">
    <section class="panel"><div class="panel-h"><h2>브랜드 기준</h2><a class="btn sm" href="#brand">열기</a></div>
      <div class="status"><span class="dot ok"></span><div><b>브랜드 v${esc(S.brand.version)}</b> · 제품 ${S.products.length}개<div class="small muted">마지막 변경: ${esc(last.label)} · ${esc(last.what)} · ${ago(last.at)}</div></div></div>
    </section>
    <section class="panel"><div class="panel-h"><h2>Claude 연결</h2></div>
      <div class="status"><span class="dot ${seen ? 'ok' : 'warn'}"></span><div>${seen ? `<b>연결됨</b><div class="small muted">마지막 사용 ${ago(seen.at)} · ${esc(seen.tool)}</div>` : `<b>아직 연결 기록이 없어요</b><div class="small muted">앱 폴더의 <code>connect-claude.command</code>를 한 번 더블클릭하고 Claude 앱을 다시 열어 주세요. 그다음 Claude에게 "contents controller 브랜드 기준 보여줘"라고 말해 보세요.</div>`}</div></div>
    </section>
    ${i.local ? `<section class="panel"><div class="panel-h"><h2>폰에서 열기</h2></div>
      ${i.phone.urls.length ? `<div class="status"><span class="dot ok"></span><div class="small">Mac과 같은 Wi-Fi에서 폰 브라우저로 여세요.${i.phone.urls.map(u => `<div class="mono" style="font-size:14px;margin-top:4px">${esc(u)}</div>`).join('')}</div></div>
      <div class="status"><span class="dot"></span><div class="small">처음 한 번 접속 코드를 넣어요: <b class="mono" style="font-size:17px">${esc(i.phone.accessCode)}</b></div></div>` : '<div class="status"><span class="dot warn"></span><div class="small">Wi-Fi에 연결되어 있지 않아요.</div></div>'}
    </section>
    <section class="panel"><div class="panel-h"><h2>이미지 폴더</h2></div>
      <div class="status"><span class="dot ${i.imageRootExists ? 'ok' : 'warn'}"></span><div class="small" style="min-width:0">${i.imageRootExists ? '연결됨' : '폴더를 찾을 수 없어요'}<div class="mono">${esc(i.imageRoot)}</div></div></div>
      ${i.imageRootExists ? `<div class="status"><span class="dot ${i.folders.products.every(x => x.path) ? 'ok' : 'warn'}"></span><div class="small" style="min-width:0">제품 폴더 ${i.folders.products.filter(x => x.path).length}/${i.folders.products.length}개 연결
        <div style="margin-top:4px">${i.folders.products.map(x => `<span class="chip ${x.path ? 'acc' : 'st-crit'}" style="margin:2px 4px 2px 0" title="${esc(x.product)}">${x.code} · ${esc(x.folderName)}</span>`).join('')}</div></div></div>
      <div class="status"><span class="dot ${i.folders.others.every(x => x.path) ? 'ok' : 'warn'}"></span><div class="small" style="min-width:0">그 밖의 폴더
        <div style="margin-top:4px">${i.folders.others.map(x => `<span class="chip ${x.path ? 'acc' : 'st-crit'}" style="margin:2px 4px 2px 0">${esc(x.label)} · ${esc(x.folderName)}</span>`).join('')}</div></div></div>
      ${i.folders.unassigned.length ? `<div class="status"><span class="dot"></span><div class="small muted" style="min-width:0">아직 쓰지 않는 폴더: ${i.folders.unassigned.map(esc).join(', ')}</div></div>` : ''}` : ''}
      <div class="addbar"><input type="text" id="imgroot" value="${esc(i.imageRoot)}" aria-label="이미지 폴더 경로"><button class="btn sm" data-act="setroot">바꾸기</button></div>
      <p class="small muted" style="margin:8px 0 0">제품별 폴더는 브랜드 기준 > 제품별 > 기준 이미지에서 바꿀 수 있어요.</p>
    </section>` : ''}
  </div>`;
}

/* ---------- 캘린더 ---------- */
const ROWS = [['GLOBAL', '@damtix.global'], ['JP', '@damtix.jp'], ['EU', '@damtix_eu'], ['SHOP', '자사몰 (Shopify)']];
function newWorkForm() {
  const n = ui.newWork;
  if (!n) return '';
  const accOpts = [['GLOBAL', 'GLOBAL · 영어(미국)'], ['JP', 'JP · 일본어'], ['EU', 'EU · 프랑스어'], ['SHOP:damtix.shop', '자사몰 damtix.shop'], ['SHOP:damtix.eu', '자사몰 damtix.eu']];
  return `<section class="panel" id="newwork"><div class="panel-h"><h2>새 작업 기획</h2><button class="btn sm" data-act="newclose">닫기</button></div>
    <div class="grid g-3">
      <label class="small">종류<select class="btn" id="nw-type" style="width:100%;margin-top:8px">${Object.entries(S.types).map(([k, t]) => `<option value="${k}" ${n.type === k ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
      <label class="small">계정<select class="btn" id="nw-acc" style="width:100%;margin-top:8px">${accOpts.map(([v, t]) => `<option value="${v}" ${n.acc === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="small">게시일<input type="date" id="nw-date" value="${esc(n.date)}" style="width:100%;margin-top:8px;min-height:44px;border:1px solid var(--line-strong);border-radius:11px;padding:0 12px;background:var(--surface)"></label>
    </div>
    <label class="small" style="display:block;margin-top:16px">제품<select class="btn" id="nw-prod" style="width:100%;margin-top:8px">${S.products.map(p => `<option value="${p.code}" ${n.prod === p.code ? 'selected' : ''}>${p.code} · ${esc(p.names.KR)}</option>`).join('')}</select></label>
    <label class="small" style="display:block;margin-top:16px">제목<input type="text" id="nw-title" value="${esc(n.title)}" placeholder="예: 아침 루틴 PDRN 세럼" style="width:100%;margin-top:8px"></label>
    <label class="small" style="display:block;margin-top:16px">기획 메모 (한국어)<textarea id="nw-memo" placeholder="예: 아침 루틴 느낌, 제품 클로즈업, 끈적이지 않는 사용감 강조">${esc(n.memo)}</textarea></label>
    <label class="small" style="display:flex;gap:12px;align-items:center;min-height:44px;margin-top:8px"><input type="checkbox" id="nw-cap" ${n.cap ? 'checked' : ''}> 캡션 작성도 바로 Claude에게 맡기기 (자사몰 제외)</label>
    <div class="row" style="margin-top:8px"><span class="spacer"></span><button class="btn primary" data-act="newsave">만들기</button></div>
  </section>`;
}
function vCalendar() {
  if (!ui.week) ui.week = mondayOf(today());
  const days = [...Array(7)].map((_, i) => addDays(ui.week, i));
  const t = today();
  let cells = `<div class="hd corner"></div>` + days.map((d, i) => `<div class="hd" style="${d === t ? 'background:var(--ink);color:var(--bg)' : ''}">${DOW[i]}<small style="${d === t ? 'color:var(--bg)' : ''}">${md(d)}</small></div>`).join('');
  for (const [acc, handle] of ROWS) {
    cells += `<div class="rh">${acc}<small>${esc(handle)}</small></div>`;
    for (const d of days) {
      const ws = S.works.filter(w => w.account === acc && w.date === d);
      cells += `<div>${ws.map(w => `<a class="post ${workState(w).c}" href="${workLink(w)}" style="text-decoration:none"><b>${esc(w.title)}</b><span class="code">${w.id}</span> · ${workState(w).t}</a>`).join('')}<button class="btn sm" data-add="${acc}|${d}" aria-label="${acc} ${md(d)}에 새 작업" style="min-height:32px;padding:0 10px;align-self:flex-start;color:var(--faint);background:transparent">+</button></div>`;
    }
  }
  const end = addDays(ui.week, 6);
  return head('캘린더', '계정 3개와 자사몰의 게시 일정이에요. 칸의 + 를 누르면 그 날짜·계정으로 새 작업을 만들어요.') + `
  <div class="row"><button class="btn sm" data-week="-7" aria-label="이전 주">‹ 이전 주</button><b>${md(ui.week)} – ${md(end)}</b><button class="btn sm" data-week="7" aria-label="다음 주">다음 주 ›</button><button class="btn sm" data-week="0">이번 주</button><span class="spacer"></span><button class="btn primary" data-act="newopen">+ 새 작업</button></div>
  <div class="legend"><span><i style="background:var(--ink)"></i>내 차례</span><span><i style="border:1px dashed var(--faint)"></i>Claude 차례</span><span><i style="border:1px dashed var(--line-strong)"></i>기획</span><span><i style="background:var(--green)"></i>컨펌</span></div>
  ${newWorkForm()}
  <div class="cal-wrap"><div class="cal">${cells}</div></div>`;
}

/* ---------- 작업 상세 ---------- */
function captionPanel(w) {
  if (w.account === 'SHOP') return `<section class="panel"><div class="panel-h"><h2>문구</h2></div><p class="empty">자사몰 HTML 작업은 5단계에서 섹션 구성·문구·미리보기 검수가 열려요.</p></section>`;
  const c = w.caption, cur = c.current, a = S.accounts[w.account];
  const la = { GLOBAL: 'en', JP: 'ja', EU: 'fr' }[w.account];
  let body = '';
  if (c.status === 'none') {
    body = `<p class="small" style="margin:0 0 12px">${esc(a.lang)} 캡션·해시태그·멘션과 한국어 역번역을 Claude에게 맡겨요.</p>
      <label class="small">캡션 방향 (선택)<textarea id="cap-note" placeholder="예: 질문으로 시작, 아침 루틴 느낌, 이모지는 1개만"></textarea></label>
      <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn primary" data-cap="request">캡션 맡기기</button></div>`;
  } else if (c.status === 'requested' || c.status === 'fix') {
    body = `<div class="status"><span class="dot"></span><div class="small">${c.status === 'fix' ? `수정 요청을 Claude에게 보냈어요: <b>${esc(c.fixes[0]?.note)}</b>` : `Claude가 캡션을 쓸 차례예요.${c.request?.note ? ` 방향: ${esc(c.request.note)}` : ''}`}</div></div>${cmdBox()}`;
  }
  if (cur && (c.status === 'review' || c.status === 'confirmed' || c.status === 'fix')) {
    const iss = cur.check.issues;
    body += `${c.status === 'fix' ? '<h3 style="margin:16px 0 8px">지금 캡션 (고치기 전)</h3>' : ''}
      <div class="cmp"><div class="col"><div class="lab">원문 · ${esc(a.lang)}</div><p lang="${la}">${esc(cur.text)}</p></div><div class="col"><div class="lab">한국어 역번역 · 검수용</div><p>${esc(cur.back)}</p></div></div>
      <p class="small muted" style="margin:8px 0 0">역번역은 원래 기획을 보지 않고 외국어 원문만 다시 한국어로 옮긴 거예요. 뜻이 달라졌으면 수정 요청하세요.</p>
      ${cur.hashtags.length ? `<h3 style="margin:16px 0 8px">해시태그</h3><div class="tags">${cur.hashtags.map(h => `<span class="tag" lang="${la}">${esc(h.tag)}<small>${esc(h.ko)}</small></span>`).join('')}</div>` : ''}
      ${cur.mentions.length ? `<h3 style="margin:16px 0 8px">멘션</h3><div class="tags">${cur.mentions.map(m => `<span class="tag">${esc(m.handle)}<small>${esc(m.ko)}</small></span>`).join('')}</div>` : ''}
      <h3 style="margin:16px 0 4px">규칙 검사 <span class="small muted" style="font-weight:400">${esc(cur.check.checkedWith.brand)} · ${esc(cur.check.checkedWith.product || '')} 기준</span></h3>
      ${iss.length ? iss.map(i => `<div class="check"><span class="ic ${i.level === 'block' ? 'bad' : ''}" style="${i.level === 'caution' ? 'background:var(--yellow-soft);color:var(--yellow)' : ''}">!</span><span>${esc(i.message)}</span></div>`).join('') : '<div class="check"><span class="ic ok">✓</span><span>금지 표현 없음, 이 계정에서 판매하는 제품</span></div>'}`;
  }
  if (c.status === 'review') {
    body += ui.fixOpen
      ? `<label class="small" style="display:block;margin-top:16px">무엇을 고칠까요? (한국어로)<textarea id="fix-note" placeholder="예: '부드러운' 대신 '산뜻한' 느낌으로, 해시태그 2개 줄이기"></textarea></label>
         <div class="row" style="margin-top:12px"><button class="btn" data-cap="fixcancel">취소</button><span class="spacer"></span><button class="btn primary" data-cap="fix">수정 요청 보내기</button></div>`
      : `<div class="row" style="margin-top:16px"><button class="btn" data-cap="fixopen">수정 요청</button><span class="spacer"></span><button class="btn primary" data-cap="confirm">캡션 컨펌</button></div>`;
  }
  if (c.status === 'confirmed') {
    body += `<div class="row" style="margin-top:16px"><button class="btn" data-cap="reopen">컨펌 풀기</button><button class="btn" data-cap="redo">새로 만들기</button><span class="spacer"></span><button class="btn primary" data-act="copycap">캡션·해시태그 복사</button></div>`;
  }
  const chip = `<span class="chip ${workState(w).c}">${esc(S.captionStatus[c.status])}</span>`;
  const older = c.versions.length ? `<details class="inci" style="margin-top:12px"><summary>이전 캡션 ${c.versions.length}개</summary>${c.versions.map(v => `<div class="cmp" style="margin-top:8px"><div class="col"><p class="small">${esc(v.text)}</p></div><div class="col"><p class="small">${esc(v.back)}</p></div></div>`).join('')}</details>` : '';
  return `<section class="panel"><div class="panel-h"><h2>캡션</h2>${chip}</div>${body}${older}</section>`;
}
function vWork(id) {
  const w = S.works.find(x => x.id === id);
  if (!w) return head('작업을 찾을 수 없어요', '지워졌거나 번호가 바뀌었을 수 있어요.') + '<a class="btn" href="#calendar">캘린더로</a>';
  const p = prodBy(w.product), E = ui.workEdit;
  const plan = E ? `<div class="form">
      <label for="we-title">제목<input type="text" id="we-title" value="${esc(E.title)}"></label>
      <label for="we-date">게시일<input type="date" id="we-date" value="${esc(E.date)}" style="min-height:44px;border:1px solid var(--line-strong);border-radius:11px;padding:0 12px;background:var(--surface);margin-top:8px;color:var(--ink)"></label>
      <label for="we-prod">제품<select class="btn" id="we-prod" style="margin-top:8px">${S.products.map(x => `<option value="${x.code}" ${E.product === x.code ? 'selected' : ''}>${x.code} · ${esc(x.names.KR)}</option>`).join('')}</select></label>
      <label for="we-memo">기획 메모<textarea id="we-memo">${esc(E.memo)}</textarea></label></div>
      <div class="row" style="margin-top:16px"><button class="btn" data-act="weclose">취소</button><span class="spacer"></span><button class="btn primary" data-act="wesave">저장</button></div>`
    : `<dl class="kv"><dt>게시일</dt><dd>${esc(w.date)} (${DOW[(parseYmd(w.date).getDay() + 6) % 7]})</dd><dt>계정</dt><dd>${esc(accLabel(w))}${w.account !== 'SHOP' ? ` · ${esc(S.accounts[w.account].handle)} · ${esc(S.accounts[w.account].lang)}` : ''}</dd><dt>제품</dt><dd>${esc(w.product)} · ${esc(p?.names.KR || '')}${w.account === 'JP' && p?.names.JP ? ` · ${esc(p.names.JP)}` : ''}</dd><dt>기획 메모</dt><dd>${esc(w.memo) || '<span class="muted">비어 있음</span>'}</dd></dl>`;
  const make = { image: '구도 시안 → Higgsfield 생성 → 핀 메모 검수는 3단계에서 열려요.', video: '스토리보드 → 제작 → 타임라인 검수는 4단계에서 열려요.', html: '섹션 구성 → 제작 → PC·모바일 미리보기 검수는 5단계에서 열려요.' }[w.type];
  return `<div class="row"><a class="btn sm" href="#calendar">‹ 캘린더</a></div>` + head(esc(w.title), `${w.id} · ${S.types[w.type].label} · ${md(w.date)} 게시`) + `
  <section class="panel"><div class="panel-h"><h2>기획</h2>${E ? '<span class="chip st-warn">수정 중</span>' : '<button class="btn sm" data-act="weopen">수정</button>'}</div>${plan}</section>
  ${captionPanel(w)}
  <section class="panel"><div class="panel-h"><h2>${S.types[w.type].label} 제작</h2><span class="chip st-plan">준비 중</span></div><p class="small muted" style="margin:0">${make}</p></section>
  <section class="panel"><div class="panel-h"><h2>기록</h2></div>${w.log.slice(0, 12).map(l => `<div class="check" style="min-height:36px"><span class="small muted" style="width:120px;flex:none">${day(l.at)}</span><span class="small">${esc(l.what)}</span><span class="spacer"></span><span class="small muted">${esc(l.by)}</span></div>`).join('')}</section>
  <div class="row">${ui.confirmDelete ? `<span class="small" style="color:var(--red)">${w.id}를 지울까요? 되돌릴 수 없어요.</span><button class="btn" data-act="delno">취소</button><button class="btn" data-act="delyes" style="border-color:var(--red);color:var(--red)">지우기</button>` : '<button class="btn sm" data-act="delask">작업 지우기</button>'}</div>`;
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
  const local = S.info.local;
  const top = ui.topFolders || [];
  const picker = local ? `<div class="addbar" style="margin-top:0"><select class="btn" id="pf-${p.code}" aria-label="${p.code} 기준 이미지 폴더" style="flex:1;min-width:0">${[im.folderName, ...top.filter(n => n !== im.folderName)].filter(Boolean).map(n => `<option value="${esc(n)}" ${n === im.folderName ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select><button class="btn sm" data-setpf="${p.code}">이 폴더로 지정</button></div>` : '';
  let body;
  if (!im.rootExists) body = `<div class="cautionbox">이미지 폴더를 찾을 수 없어요: ${esc(im.root)}. 홈 화면에서 경로를 확인해 주세요.</div>`;
  else if (!im.folder) body = `<div class="cautionbox">"${esc(im.folderName)}" 폴더를 찾을 수 없어요. 위에서 이 제품의 폴더를 골라 주세요.</div>`;
  else if (!im.count) body = `<p class="empty">"${esc(im.folderName)}" 폴더에 이미지가 없어요.</p>`;
  else body = im.groups.map(g => `<h3 style="margin-top:16px">${esc(g.name)} <span class="small muted" style="font-weight:400">${g.files.length}장</span></h3><div class="imgs">${g.files.map(f => `<a href="/file?rel=${encodeURIComponent(f.rel)}" target="_blank" rel="noopener" title="${esc(f.name)}"><img src="/file?rel=${encodeURIComponent(f.rel)}" alt="${esc(f.name)}" loading="lazy"></a>`).join('')}</div>`).join('') + (im.truncated ? '<p class="small muted">이미지가 많아서 처음 300장만 보여요.</p>' : '');
  return `<section class="panel"><div class="panel-h"><h2>기준 이미지 <span class="small muted" style="font-weight:400">${im.count || 0}장 · ${esc(im.folderName || '폴더 없음')}</span></h2><button class="btn sm" data-reimg="${p.code}">새로 고침</button></div>
    <p class="small muted" style="margin:-8px 0 12px">Claude가 이 제품 이미지를 만들 때 항상 이 폴더의 사진을 참조해요. 사진을 바꾸려면 폴더 안의 파일을 바꾸면 돼요.</p>${picker}${body}</section>`;
}
async function loadImages(code) {
  try {
    const [im, f] = await Promise.all([api(`/api/products/${code}/images`), ui.topFolders ? null : api('/api/folders')]);
    ui.images[code] = im; if (f) ui.topFolders = f.top;
  } catch (e) { ui.images[code] = { rootExists: false, root: e.message, groups: [], count: 0 }; }
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
const VIEWS = { home: vHome, calendar: vCalendar, brand: vBrand, check: vCheck };
let cur = 'home';
function render() {
  const h = location.hash.replace('#', '');
  const wm = /^work-([A-Za-z]+-\d+)$/.exec(h);
  cur = wm ? 'work' : VIEWS[h] || SOON[h] ? h : 'home';
  renderNav(cur === 'work' ? 'calendar' : cur);
  $('#view').innerHTML = wm ? vWork(wm[1].toUpperCase()) : VIEWS[cur] ? VIEWS[cur]() : vSoon(cur);
}
window.addEventListener('hashchange', () => { $('.rail').classList.remove('open'); $('#menuBtn').setAttribute('aria-expanded', 'false'); ui.edit = null; ui.workEdit = null; ui.fixOpen = false; ui.confirmDelete = false; render(); scrollTo(0, 0); refresh(); });

async function run(fn) { try { await fn(); } catch (e) { toast(e.message); } }
function copy(text, done) {
  const fallback = () => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} ta.remove(); toast(ok ? done : '복사하지 못했어요. 직접 선택해서 복사해 주세요.'); };
  try { navigator.clipboard.writeText(text).then(() => toast(done), fallback); } catch { fallback(); }
}

document.addEventListener('click', e => {
  const t = e.target.closest('button,a[data-btab]'); if (!t) return;
  if (t.disabled) return;
  const d = t.dataset;
  const wid = () => (/^#work-([A-Za-z]+-\d+)$/.exec(location.hash) || [])[1]?.toUpperCase();
  const cw = () => S.works.find(x => x.id === wid());
  if (d.week !== undefined) { ui.week = d.week === '0' ? mondayOf(today()) : addDays(ui.week, Number(d.week)); render(); return; }
  if (d.add) { const [acc, date] = d.add.split('|'); ui.newWork = { type: acc === 'SHOP' ? 'html' : 'image', acc: acc === 'SHOP' ? 'SHOP:damtix.shop' : acc, date, prod: 'GTCP', title: '', memo: '', cap: acc !== 'SHOP' }; render(); $('#newwork')?.scrollIntoView({ block: 'start' }); return; }
  if (d.act === 'newopen') { ui.newWork = ui.newWork || { type: 'image', acc: 'GLOBAL', date: addDays(today(), 1), prod: 'GTCP', title: '', memo: '', cap: true }; render(); $('#newwork')?.scrollIntoView({ block: 'start' }); return; }
  if (d.act === 'newclose') { ui.newWork = null; render(); return; }
  if (d.act === 'newsave') return run(async () => {
    const [acc, store] = $('#nw-acc').value.split(':');
    const body = { type: $('#nw-type').value, account: acc, store, date: $('#nw-date').value, product: $('#nw-prod').value, title: $('#nw-title').value, memo: $('#nw-memo').value, requestCaption: $('#nw-cap').checked };
    const r = await api('/api/works', body); S = r.state; ui.newWork = null; location.hash = `work-${r.work.id}`;
    toast(r.work.caption.status === 'requested' ? `${r.work.id}를 만들고 캡션을 Claude에게 맡겼어요.` : `${r.work.id}를 만들었어요.`);
  });
  if (d.cap) {
    const w = cw(); if (!w) return;
    if (d.cap === 'fixopen') { ui.fixOpen = true; render(); $('#fix-note')?.focus(); return; }
    if (d.cap === 'fixcancel') { ui.fixOpen = false; render(); return; }
    const call = { request: ['caption-request', { note: $('#cap-note')?.value }, 'Claude에게 캡션을 맡겼어요.'], redo: ['caption-request', { note: '' }, '캡션을 새로 만들어 달라고 맡겼어요.'], fix: ['caption-fix', { note: $('#fix-note')?.value }, '수정 요청을 Claude에게 보냈어요.'], confirm: ['caption-confirm', {}, '캡션을 컨펌했어요.'], reopen: ['caption-reopen', {}, '컨펌을 풀었어요.'] }[d.cap];
    return run(async () => { S = (await api(`/api/works/${w.id}/${call[0]}`, call[1])).state; ui.fixOpen = false; render(); toast(call[2]); });
  }
  if (d.act === 'weopen') { const w = cw(); ui.workEdit = { title: w.title, date: w.date, product: w.product, memo: w.memo }; render(); return; }
  if (d.act === 'weclose') { ui.workEdit = null; render(); return; }
  if (d.act === 'wesave') return run(async () => { const w = cw(); S = (await api(`/api/works/${w.id}/update`, { title: $('#we-title').value, date: $('#we-date').value, product: $('#we-prod').value, memo: $('#we-memo').value })).state; ui.workEdit = null; render(); toast('기획을 저장했어요.'); });
  if (d.act === 'delask') { ui.confirmDelete = true; render(); return; }
  if (d.act === 'delno') { ui.confirmDelete = false; render(); return; }
  if (d.act === 'delyes') return run(async () => { const w = cw(); S = (await api(`/api/works/${w.id}/delete`, {})).state; ui.confirmDelete = false; location.hash = 'calendar'; toast(`${w.id}를 지웠어요.`); });
  if (d.act === 'copycmd') return copy('contents controller 대기 작업 처리해줘', '복사했어요. Claude 앱에 붙여넣으세요.');
  if (d.act === 'copycap') { const c = cw().caption.current; return copy([c.text, '', c.hashtags.map(h => h.tag).join(' '), c.mentions.map(m => m.handle).join(' ')].join('\n').trim(), '캡션과 해시태그를 복사했어요. 인스타그램에 붙여넣으세요.'); }
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
  if (d.setpf) return run(async () => { const name = $(`#pf-${d.setpf}`).value; S = (await api('/api/config', { productFolders: { [d.setpf]: name } })).state; delete ui.images[d.setpf]; render(); toast(`${d.setpf} 기준 이미지 폴더를 "${name}"(으)로 지정했어요.`); });
  if (d.act === 'setroot') return run(async () => { S = (await api('/api/config', { imageRoot: $('#imgroot').value })).state; ui.images = {}; ui.topFolders = null; render(); toast(S.info.imageRootExists ? '이미지 폴더를 바꿨어요.' : '저장했지만 그 경로에 폴더가 없어요.'); });
  if (d.act === 'check') return run(async () => { const c = ui.check; c.text = $('#ck-text').value; c.account = $('#ck-acc').value; c.product = $('#ck-prod').value; if (!c.text.trim()) { $('#ck-text').focus(); return; } c.result = await api('/api/check', { text: c.text, account: c.account, product: c.product || undefined }); render(); });
});
document.addEventListener('input', e => {
  const t = e.target;
  if (ui.newWork && t.id?.startsWith('nw-')) { const k = { 'nw-title': 'title', 'nw-memo': 'memo', 'nw-date': 'date' }[t.id]; if (k) ui.newWork[k] = t.value; }
  if (t.dataset.f && ui.edit) ui.edit.draft[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value;
  if (t.id === 'ereason' && ui.edit) ui.edit.reason = t.value;
  if (t.id === 'ck-text') ui.check.text = t.value;
});
document.addEventListener('change', e => { const t = e.target;
  if (ui.newWork && t.id?.startsWith('nw-')) { const k = { 'nw-type': 'type', 'nw-acc': 'acc', 'nw-prod': 'prod', 'nw-date': 'date' }[t.id]; if (k) ui.newWork[k] = t.value; if (t.id === 'nw-cap') ui.newWork.cap = t.checked; } if (t.dataset.f && ui.edit && t.type === 'checkbox') ui.edit.draft[t.dataset.f] = t.checked; });

// 다른 곳(Claude 앱, 다른 기기)에서 바뀐 내용을 30초마다 반영. 수정 중일 때는 건드리지 않는다.
function refresh() {
  if (ui.edit || ui.workEdit || ui.fixOpen || ui.newWork || document.hidden || ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement?.tagName)) return;
  api('/api/state').then(s => { const pick = x => JSON.stringify([x.brand, x.products, x.proposals, x.history[0]?.id, x.info.claudeLastSeen, x.works.map(w => w.updatedAt), x.queue.length]); const changed = pick(s) !== pick(S); S = s; if (changed && cur !== 'check') render(); }).catch(() => {});
}
setInterval(refresh, 10000);
window.addEventListener('focus', refresh);

api('/api/state').then(s => { S = s; render(); }).catch(e => { $('#view').innerHTML = `<p class="loading">${esc(e.message)}</p>`; });
