// contents controller 화면 (1단계: 브랜드 기준·문구 검사 / 2단계: 캘린더·캡션 / 3단계: 레퍼런스·이미지 / 4단계: 영상)
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null; // 서버에서 받은 상태
const ui = { btab: 'brand', sku: 'GTCP', edit: null, images: {}, check: { text: '', account: 'GLOBAL', product: '', result: null }, week: null, newWork: null, workEdit: null, fixOpen: false, confirmDelete: false, refPick: null, draftPick: null, pins: {}, finalPick: new Set(), imgFixOpen: false, refDelete: null, busy: false, upscale: 'higgsfield', vNotes: null, vFixOpen: null, versions: null, subsOn: true };

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
const NAV = [['home', '홈'], ['calendar', '캘린더'], ['refs', '레퍼런스'], ['image', '이미지'], ['brand', '브랜드 기준'], ['check', '문구 검사'], ['video', '영상'], ['html', 'HTML', 1]];
const myTurn = () => S.works.filter(w => workState(w).c === 'st-you');
const badge = k => k === 'home' ? myTurn().length : k === 'brand' ? S.proposals.length : k === 'image' ? S.works.filter(w => w.type === 'image' && workState(w).c === 'st-you').length : k === 'video' ? S.works.filter(w => w.type === 'video' && workState(w).c === 'st-you').length : k === 'refs' ? S.refs.filter(r => r.status === 'wait').length : 0;
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
  const im = w.image?.stage || 'none', vs = w.video?.stage || 'none', sub = w.video?.subs?.status || 'none';
  const cap = w.account === 'SHOP' ? 'none' : w.caption.status;
  if (cap === 'review' || ['draft_review', 'result_review'].includes(im) || ['story_review', 'edit_me', 'result_review'].includes(vs) || sub === 'review' || (vs === 'video_ok' && (sub === 'confirmed' || w.video?.subs?.off))) return { t: '내 차례', c: 'st-you' };
  if (['requested', 'fix'].includes(cap) || ['draft_requested', 'draft_fix', 'make', 'make_fix', 'upscale'].includes(im) || ['story_requested', 'story_fix', 'make', 'make_fix'].includes(vs) || ['requested', 'fix'].includes(sub)) return { t: 'Claude 차례', c: 'st-claude' };
  if (im === 'finalizing' || vs === 'finalizing' || vs === 'rendering') return { t: '처리 중', c: 'st-claude' };
  if (w.type === 'image' ? im === 'done' : w.type === 'video' ? vs === 'done' : cap === 'confirmed') return { t: '완료', c: 'st-done' };
  return { t: '기획', c: 'st-plan' };
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
      ${mine.length ? `<div class="tasks">${mine.map(workRow).join('')}</div>` : `<p class="empty">검수할 것이 없어요.${upcoming.length ? ` 이번 주 게시 예정 ${upcoming.length}건은 캘린더에서 볼 수 있어요.` : ' 캘린더에서 새 작업을 기획해 보세요.'}</p>`}
    </section>
    <section class="panel"><div class="panel-h"><h2>Claude 차례 <span class="small muted" style="font-weight:400">${S.queue.length}건</span></h2></div>
      ${S.queue.length ? `<ul class="queue">${S.queue.map(q => `<li><span class="chip st-claude">${esc(q.task)}</span><a href="${q.workId ? `#work-${q.workId}` : '#refs'}" style="min-width:0;flex:1;color:var(--ink)">${esc(q.title)}</a><span class="code">${q.workId || q.refId}</span></li>`).join('')}</ul><div style="margin-top:12px">${cmdBox()}</div><p class="small muted" style="margin:8px 0 0">여러 건을 모아 두었다가 한 번에 맡겨도 돼요. 결과는 이 화면에 자동으로 들어와요.</p>` : '<p class="empty">Claude에게 맡긴 일이 없어요.</p>'}
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
    </section>
    <section class="panel"><div class="panel-h"><h2>완성본 저장</h2></div>
      <div class="status"><span class="dot ok"></span><div class="small" style="min-width:0">Mac: 이미지정리 안의 <b>${esc(i.finals.finalsFolder)}</b> 폴더<div class="small muted">계정 / 게시일_작업번호 폴더로 나눠 저장해요.</div></div></div>
      <div class="status"><span class="dot ${i.finals.driveFolder ? (i.finals.driveExists ? 'ok' : 'warn') : 'warn'}"></span><div class="small" style="min-width:0">${i.finals.driveFolder ? (i.finals.driveExists ? 'Google Drive에도 복사해요' : 'Google Drive 폴더를 찾을 수 없어요') : 'Google Drive 복사가 꺼져 있어요'}${i.finals.driveFolder ? `<div class="mono">${esc(i.finals.driveFolder)}</div>` : ''}</div></div>
      ${driveHealth(i.finals)}
      ${i.finals.driveCandidates.length ? `<div class="addbar"><select class="btn" id="drivesel" style="flex:1;min-width:0" aria-label="Google Drive 폴더">${i.finals.driveCandidates.map(d => `<option value="${esc(d)}" ${d === i.finals.driveFolder ? 'selected' : ''}>${esc(d.split('/').slice(-2).join(' / '))}</option>`).join('')}<option value="">Google Drive에 복사하지 않기</option></select><button class="btn sm" data-act="setdrive">저장</button></div>` : `<p class="small muted" style="margin:8px 0 0">Google Drive 데스크톱 앱을 설치하면 완성본이 Drive에도 자동으로 올라가요.</p>`}
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
  const make = { image: '', video: '스토리보드 → 제작 → 타임라인 검수는 4단계에서 열려요.', html: '섹션 구성 → 제작 → PC·모바일 미리보기 검수는 5단계에서 열려요.' }[w.type];
  return `<div class="row"><a class="btn sm" href="#calendar">‹ 캘린더</a></div>` + head(esc(w.title), `${w.id} · ${S.types[w.type].label} · ${md(w.date)} 게시`) + `
  <section class="panel"><div class="panel-h"><h2>기획</h2>${E ? '<span class="chip st-warn">수정 중</span>' : '<button class="btn sm" data-act="weopen">수정</button>'}</div>${plan}</section>
  ${refsPanel(w)}
  ${w.type === 'image' ? imagePanel(w) : w.type === 'video' ? videoPanel(w) : `<section class="panel"><div class="panel-h"><h2>${S.types[w.type].label} 제작</h2><span class="chip st-plan">준비 중</span></div><p class="small muted" style="margin:0">${make}</p></section>`}
  ${captionPanel(w)}
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
    inner = `<dl class="kv">${def.fields.map(([k, l, t, o]) => `<dt>${esc(l)}</dt><dd>${t === 'check' ? `<span class="chip ${obj[k] ? 'st-done' : 'st-crit'}">${fmtVal(obj[k])}</span>` : esc(fieldText(t, o, obj[k])) || '<span class="muted">비어 있음</span>'}</dd>`).join('')}</dl>`;
  } else if (E.step === 'edit') {
    inner = `<div class="form">${def.fields.map(([k, l, t, o]) => {
      const id = `f-${key.replace(/\./g, '-')}-${k}`, v = E.draft[k];
      if (t === 'select') return `<label for="${id}">${esc(l)}<select id="${id}" data-f="${k}">${o.map(([x, xl]) => `<option value="${esc(x)}" ${String(v) === x ? 'selected' : ''}>${esc(xl)}</option>`).join('')}</select></label>`;
      if (t === 'font') return `<label for="${id}">${esc(l)}<select id="${id}" data-f="${k}">${S.fonts.map(f => `<option value="${esc(f.family)}" ${v === f.family ? 'selected' : ''}>${esc(f.family)} (${f.weights.join('·')})</option>`).join('')}</select></label>`;
      if (t === 'number') return `<label for="${id}">${esc(l)}<input type="number" inputmode="numeric" id="${id}" data-f="${k}" value="${esc(v)}" min="${o[0]}" max="${o[1]}" step="1"></label>`;
      if (t === 'check') return `<label style="flex-direction:row;align-items:center;gap:12px;color:var(--ink);min-height:44px"><input type="checkbox" id="${id}" data-f="${k}" ${v ? 'checked' : ''}> ${esc(l)}</label>`;
      return `<label for="${id}">${esc(l)}${t === 'textarea' ? `<textarea id="${id}" data-f="${k}">${esc(v)}</textarea>` : `<input type="text" id="${id}" data-f="${k}" value="${esc(v)}">`}</label>`;
    }).join('')}</div>
    <div class="row" style="margin-top:16px"><button class="btn" data-ecancel>취소</button><span class="spacer"></span><button class="btn primary" data-econfirm>바뀐 내용 확인</button></div>`;
  } else {
    const ch = def.fields.filter(([k]) => String(E.draft[k]) !== String(obj[k]));
    const lost = key.endsWith('.markets') ? def.fields.filter(([k]) => obj[k] && !E.draft[k]).map(([k]) => k) : [];
    const ver = key.startsWith('brand.') ? `브랜드 v${bump(S.brand.version)}` : `${key.split('.')[1]} v${prodBy(key.split('.')[1]).version + 1}`;
    inner = `<div class="diff">${ch.length ? ch.map(([k, l, t, o]) => `<div class="d"><b class="small">${esc(l)}</b><div><del>${esc(fieldText(t, o, obj[k]))}</del></div><div><ins>${esc(fieldText(t, o, E.draft[k]))}</ins></div></div>`).join('') : '<p class="empty">바뀐 내용이 없어요.</p>'}</div>
    ${lost.length ? `<div class="cautionbox">주의: 저장하면 ${lost.join(', ')} 시장의 콘텐츠에서 이 제품을 쓸 수 없게 돼요. Claude도 이 제품을 그 시장 콘텐츠에 넣지 않아요.</div>` : ''}
    <label class="small" style="display:block;margin-top:16px">바꾸는 이유 (기록에 남아요)<input type="text" id="ereason" value="${esc(E.reason)}" placeholder="예: 매뉴얼 새 버전 반영, 법무 검토 의견" style="width:100%"></label>
    <p class="small" style="margin:12px 0 0">저장하면 <b>${ver}</b>이 되고, Claude는 다음 작업부터 새 기준을 읽어요.</p>
    <div class="row" style="margin-top:16px"><button class="btn" data-eback>다시 고치기</button><span class="spacer"></span><button class="btn primary" data-esave ${ch.length ? '' : 'disabled'}>저장</button></div>`;
  }
  if (key === 'brand.subtitle') inner = `<div class="subwrap"><div>${inner}${E ? '' : fontAdd()}</div>${subPreview(E ? E.draft : obj)}</div>`;
  return `<section class="panel"><div class="panel-h"><h2>${esc(def.title)}</h2>${E ? '<span class="chip st-warn">수정 중</span>' : `<button class="btn sm" data-edit="${key}">수정</button>`}</div>${def.note ? `<p class="small muted" style="margin:-8px 0 12px">${esc(def.note)}</p>` : ''}${inner}</section>`;
}
const fieldText = (t, o, v) => t === 'select' ? (o.find(([x]) => x === String(v))?.[1] || String(v ?? '')) : t === 'number' ? `${v ?? ''}` : fmtVal(v);

// 자막 디자인 미리보기: 계정마다 어두운 장면·밝은 장면. 고치는 동안에는 잠깐 멈췄을 때 다시 그린다.
const SUB_ACC = [['GLOBAL', 'GLOBAL · 영어'], ['EU', 'EU · 프랑스어'], ['JP', 'JP · 일본어'], ['KR', '한국어']];
function subPreview(draft) {
  const k = JSON.stringify(draft);
  const p = ui.subPrev;
  if (p?.key !== k) { clearTimeout(ui.subPrevT); ui.subPrevT = setTimeout(() => loadSubPrev(draft, k), p ? 600 : 0); }
  return `<div class="subprev" id="subprev" aria-live="polite">${subPrevHtml(p?.key === k ? p.images : p?.images, p?.key !== k)}</div>`;
}
function subPrevHtml(images, loading) {
  if (!images) return '<p class="empty">미리보기를 그리는 중…</p>';
  return `<div class="subgrid${loading ? ' loading' : ''}">${SUB_ACC.map(([a, l]) => `<div><div class="small" style="font-weight:600;margin-bottom:6px">${l}</div><div class="pair">${images.filter(x => x.account === a).map(x => `<figure><img src="${x.data}" alt="${l} ${x.bg === 'bright' ? '밝은' : '어두운'} 장면 미리보기"><figcaption class="small muted">${x.bg === 'bright' ? '밝은 장면' : '어두운 장면'} · ${x.color === 'black' ? '검정' : '흰'} 글씨</figcaption></figure>`).join('')}</div></div>`).join('')}</div>
    <p class="small muted" style="margin:8px 0 0">어둡게 칠한 위·아래는 인스타그램 화면이 덮는 곳이에요(글자는 y 300~1480 안). 한국어는 지금 올리는 계정이 없어서 미리보기로만 보여요.</p>`;
}
async function loadSubPrev(draft, k) {
  try {
    const r = await api('/api/subtitle-preview', { draft });
    ui.subPrev = { key: k, images: r.images };
  } catch (e) { ui.subPrev = { key: k, images: null }; toast(e.message); }
  const el = $('#subprev');
  if (el && (!ui.edit || JSON.stringify(ui.edit.draft) === k)) el.innerHTML = subPrevHtml(ui.subPrev.images, false);
}
const fontAdd = () => `<div class="row" style="margin-top:12px"><span class="small muted">들어 있는 글꼴: ${S.fonts.map(f => esc(f.family)).join(', ')}</span><span class="spacer"></span><label class="btn sm" style="cursor:pointer">글꼴 추가 (ttf·otf)<input type="file" accept=".ttf,.otf,font/ttf,font/otf" data-fontfile hidden></label></div>`;
async function uploadFont(file) {
  await run(async () => {
    const res = await fetch('/api/fonts/upload', { method: 'POST', headers: { 'x-filename': encodeURIComponent(file.name) }, body: file });
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || '글꼴을 넣지 못했어요.');
    S = r.state; render(); toast(`${r.font.family} (${r.font.weight}) 글꼴을 넣었어요. 수정에서 고를 수 있어요.`);
  });
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
  const tabs = [['brand', '브랜드 전체'], ['work', '작업 규칙'], ['sku', '제품별 (SKU)'], ['prop', `업데이트 제안${S.proposals.length ? ' ' + S.proposals.length : ''}`], ['hist', '변경 이력']];
  let body = '';
  if (ui.btab === 'brand') body = ['brand.core', 'brand.tone', 'brand.rules', 'brand.visual', 'brand.facts', 'brand.subtitle'].map(secView).join('');
  if (ui.btab === 'work') body = `<p class="small muted" style="margin:0 0 4px">Claude가 작업할 때 읽는 규칙이에요. 이전 작업(인수인계서)에서 정해진 것을 정리했어요. 바꾸면 버전과 기록이 남고, Claude는 다음 작업부터 새 규칙을 따라요.</p>` + ['brand.work', 'brand.reels', 'brand.imagegen', 'brand.event', 'brand.web'].map(secView).join('');
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

/* ---------- 레퍼런스 ---------- */
const partLabel = (workId, part) => { if (!part) return '전체'; const [k, n] = part.split(':'); return k === 'cut' ? `컷 ${Number(n) + 1}` : k === 'sec' ? `섹션 ${Number(n) + 1}` : part; };
function refThumb(r) {
  if (r.kind === 'image' && r.file) return `<img src="/ref-file?id=${r.id}" alt="${esc(r.title)}" loading="lazy">`;
  if (r.kind === 'video' && r.file) return `<video src="/ref-file?id=${r.id}#t=0.5" muted preload="metadata" aria-label="${esc(r.title)}"></video>`;
  return `<div style="display:grid;place-items:center;height:100%;font-size:12px;color:var(--muted)">${r.kind === 'video' ? '▶ 영상 링크' : '링크'}</div>`;
}
const dropZone = (work, big) => `<div class="drop ${big ? '' : 'mini'}" data-drop="${work || ''}" tabindex="0" aria-label="레퍼런스 넣기">
    <div class="${big ? 'big' : 'small'}">이미지·영상을 끌어다 놓거나 <b>⌘V</b>로 붙여넣기</div>
    <div class="addbar"><input type="text" id="refurl-${work || 'lib'}" data-urlfor="${work || ''}" placeholder="인스타그램·틱톡·유튜브·핀터레스트 주소" aria-label="레퍼런스 주소"><button class="btn sm primary" data-refurl="${work || ''}">주소 추가</button><label class="btn sm" for="reffile-${work || 'lib'}">파일 고르기</label><input type="file" id="reffile-${work || 'lib'}" data-filefor="${work || ''}" accept="image/*,video/*" multiple hidden>${work ? `<button class="btn sm" data-refpick="${work}|">보관함에서 고르기</button>` : ''}</div>
  </div>`;
function refPicker(work, part) {
  if (ui.refPick !== `${work}|${part}`) return '';
  const cands = S.refs.filter(r => !r.links.some(l => l.work === work && l.part === part));
  return `<div class="pickbox">${cands.map(r => `<button class="item" data-refadd="${r.id}|${work}|${part}"><span class="th" style="width:56px;height:42px">${refThumb(r)}</span><span style="min-width:0"><span class="it">${esc(r.title)}</span><span class="m"><span class="chip acc">${esc(r.source)}</span>${r.memo ? `<span class="small muted">${esc(r.memo)}</span>` : ''}</span></span></button>`).join('') || '<p class="empty">보관함에 더 고를 레퍼런스가 없어요.</p>'}</div>`;
}
function refsPanel(w) {
  const list = S.refs.filter(r => r.links.some(l => l.work === w.id));
  return `<section class="panel"><div class="panel-h"><h2>레퍼런스 <span class="small muted" style="font-weight:400">${list.length}개</span></h2><span class="small muted">여기에 넣으면 보관함에도 저장되고 이 작업에 연결돼요</span></div>
    ${dropZone(w.id)}${refPicker(w.id, '')}
    ${list.length ? `<div class="rrefs">${list.map(r => `<div class="rref"><span class="rth">${refThumb(r)}</span><div style="min-width:0"><div class="small" style="font-weight:600;overflow-wrap:anywhere">${esc(r.title)}</div>
      <div class="m"><span class="chip acc">${esc(r.source)}</span>${r.links.filter(l => l.work === w.id).map(l => `<span class="chip st-plan">${partLabel(w.id, l.part)}</span>`).join('')}${r.status === 'done' ? '<span class="chip st-done">분석됨</span>' : '<span class="chip st-claude">분석 대기</span>'}</div>
      <input type="text" id="rm-${w.id}-${r.id}" data-refmemo="${r.id}" value="${esc(r.memo)}" placeholder="가져올 점 (예: 색감만, 구도만)" style="width:100%;margin-top:8px">
      ${r.analysis ? `<details class="inci"><summary>Claude 분석</summary><p style="font-size:14px;color:var(--ink)">${esc(r.analysis)}</p></details>` : ''}</div>
      <button class="btn sm" data-unref="${r.id}|${w.id}" aria-label="연결 해제">해제</button></div>`).join('')}</div>` : ''}
  </section>`;
}
function vRefs() {
  const openWorks = S.works.filter(w => workState(w).c !== 'st-done');
  return head('레퍼런스', '인터넷에서 찾은 이미지·영상·링크를 모아 두는 곳이에요. Claude가 직접 보고 분석해서 시안에 반영해요.') + `
  ${dropZone('', true)}
  <p class="hint">인스타그램·틱톡 영상은 주소만으로는 Claude가 내용을 못 볼 때가 많아요. 화면 녹화(⌘+Shift+5)나 캡처(⌘+Shift+4)를 같이 넣어 주세요.</p>
  <div class="row"><span class="small muted">${S.refs.length}개 · 분석 대기 ${S.refs.filter(r => r.status === 'wait').length}개</span></div>
  <div class="refs">${S.refs.map(r => `<article class="ref">
    <div class="rt">${refThumb(r)}<span class="chip acc src">${esc(r.source)}${r.kind === 'video' ? ' · 영상' : ''}</span></div>
    <div class="rb"><div class="rtitle">${esc(r.title)} <span class="code">${r.id}</span></div>${r.url ? `<a class="url" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a>` : ''}
      ${r.tags.length ? `<div class="tags">${r.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${r.status === 'done' ? `<div class="ana"><b>Claude 분석</b>${esc(r.analysis)}</div>` : `<div class="ana"><b>분석 대기</b>Claude 앱에서 "contents controller 대기 작업 처리해줘"라고 하면 분석해요.</div>`}
      <label class="small">가져올 점<input type="text" id="lm-${r.id}" data-refmemo="${r.id}" value="${esc(r.memo)}" placeholder="예: 색감만, 컷 길이만" style="width:100%"></label>
      <div><div class="small muted" style="margin-bottom:4px">쓰인 곳</div><div class="row">${r.links.length ? r.links.map(l => `<span class="chip acc"><a href="#work-${l.work}" style="color:inherit">${l.work}</a> · ${partLabel(l.work, l.part)}<button class="x" data-unref="${r.id}|${l.work}|${l.part}" aria-label="연결 해제">×</button></span>`).join('') : '<span class="small muted">아직 없음</span>'}</div></div>
      <select class="btn" id="rl-${r.id}" data-reflink="${r.id}" aria-label="연결할 작업">${['<option value="">+ 작업에 연결</option>', ...openWorks.filter(w => !r.links.some(l => l.work === w.id)).map(w => `<option value="${w.id}">${w.id} · ${esc(w.title)}</option>`)].join('')}</select>
      <div class="row"><span class="spacer"></span>${ui.refDelete === r.id ? `<span class="small" style="color:var(--red)">지울까요?</span><button class="btn sm" data-act="refdelno">취소</button><button class="btn sm" data-refdel="${r.id}" style="color:var(--red)">지우기</button>` : `<button class="btn sm" data-act="refdelask" data-id="${r.id}">삭제</button>`}</div>
    </div></article>`).join('') || '<p class="empty">아직 레퍼런스가 없어요. 위에 끌어다 놓거나 붙여넣어 보세요.</p>'}</div>`;
}
async function uploadFiles(files, work) {
  if (!files.length) return;
  ui.busy = true; toast(`${files.length}개 올리는 중…`);
  try {
    for (const f of files) {
      const r = await fetch('/api/refs/upload', { method: 'POST', headers: { 'x-filename': encodeURIComponent(f.name || 'clipboard.png'), 'x-work': work || '', 'content-type': f.type || 'application/octet-stream' }, body: f });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || '올리지 못했어요.');
      S = j.state;
    }
    render(); toast(work ? `레퍼런스를 보관함에 저장하고 ${work}에 연결했어요.` : '레퍼런스를 추가했어요. Claude 분석 대기에 올렸어요.');
  } catch (e) { toast(e.message); } finally { ui.busy = false; }
}
async function addUrl(url, work) {
  if (!/^https?:\/\//i.test(String(url || '').trim())) { toast('http로 시작하는 주소를 넣어 주세요.'); return; }
  try { S = (await api('/api/refs/url', { url: url.trim(), work: work || undefined })).state; render(); toast(work ? `${work}에 레퍼런스를 연결했어요.` : '레퍼런스를 추가했어요.'); } catch (e) { toast(e.message); }
}

/* ---------- 이미지 제작 ---------- */
const workFile = (w, f) => `/work-file?id=${w.id}&f=${encodeURIComponent(f)}`;
const fmtSize = b => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
function pinsOf(r) { return ui.pins[r.id] || r.pins || []; }
// 홈 > 완성본 저장: Drive 진단 결과와 다시 시도 대기열
function driveHealth(f) {
  if (!f.driveFolder) return '';
  const c = f.check, q = f.queue || [];
  const dot = !c ? 'warn' : c.state === 'ok' ? (c.mode === 'stream' ? 'warn' : 'ok') : 'bad';
  return `<div class="status"><span class="dot ${dot}"></span><div class="small" style="min-width:0">Drive 점검: ${c ? esc(c.message) : '아직 점검하지 않았어요.'}${c?.hint ? `<div class="small" style="margin-top:4px">${esc(c.hint)}</div>` : ''}${c ? `<div class="small muted">${ago(c.at)} 점검</div>` : ''}</div><button class="btn sm" data-act="drivecheck" ${ui.busy ? 'disabled' : ''}>다시 점검</button></div>
    ${q.length ? `<div class="status"><span class="dot warn"></span><div class="small" style="min-width:0">Drive 복사 대기 ${q.length}건: ${q.map(x => `<a href="#work-${x.workId}">${x.workId}</a>`).join(', ')}<div class="small muted">자동으로 다시 시도해요 (10분 간격부터).</div></div><button class="btn sm" data-act="driveretryall" ${ui.busy ? 'disabled' : ''}>지금 다시 시도</button></div>` : ''}`;
}
// 최종 저장의 Google Drive 단계 (실패하면 다시 복사)
function driveStep(w, f) {
  const d = f.drive || { status: 'off' };
  const paths = d.paths?.length ? d.paths : d.path ? [d.path] : [];
  const text = d.status === 'copied' ? paths.map(esc).join('<br>') : d.status === 'failed' ? `<span style="color:var(--red)">복사하지 못했어요.</span> ${esc(d.error || '')}` : d.status === 'missing' ? 'Drive 폴더를 찾을 수 없어서 복사하지 못했어요. 홈 > 완성본 저장에서 확인해 주세요.' : 'Drive 복사가 꺼져 있어요 (홈 > 완성본 저장).';
  const btn = ['failed', 'missing'].includes(d.status) || (d.status === 'off' && S.info.finals?.driveFolder) ? `<div style="margin-top:8px"><button class="btn sm" data-driveretry="${w.id}" ${ui.busy ? 'disabled' : ''}>Drive에 다시 복사</button></div>` : '';
  return `<li class="${d.status === 'copied' ? 'ok' : ''}"><span class="pi">${d.status === 'copied' ? '✓' : d.status === 'failed' ? '!' : '–'}</span><div style="min-width:0"><b class="small">Google Drive</b><div class="small muted path">${text}</div>${btn}</div></li>`;
}
const imgCuts = im => (im.cuts?.length ? im.cuts : [{ id: 'C1', title: '', desc: '' }]);
// 화면에서 고른 시안 (아직 저장 전) + 저장된 선택. 처음에는 컷마다 첫 시안.
function draftPicks(im) {
  const saved = typeof im.pick === 'string' ? { [im.drafts.find(d => d.id === im.pick)?.cut || 'C1']: im.pick } : (im.pick || {});
  const out = {};
  for (const c of imgCuts(im)) out[c.id] = ui.dPicks?.[c.id] || saved[c.id] || (imgCuts(im).length === 1 ? im.drafts.find(d => (d.cut || 'C1') === c.id)?.id : undefined);
  return out;
}
const cutChips = im => im.cuts?.length > 1 ? `<div class="row" style="margin:0 0 12px;gap:6px"><span class="small muted">컷 ${im.cuts.length}개</span>${im.cuts.map(c => `<span class="chip st-plan" title="${esc(c.desc || '')}">${esc(c.id)}${c.title ? ` · ${esc(c.title.replace(/^C[\d-]+ · /, '').slice(0, 14))}` : ''}${c.from ? ` → ${esc(c.from)}` : ''}</span>`).join('')}</div>` : '';
// 이미 만든 이미지 올리기 (여러 장 가능, 컷을 고를 수 있다)
function imgUpload(w, im, more) {
  const cuts = imgCuts(im);
  return `<div class="drop mini" data-imgdrop="${w.id}" style="margin-top:${more ? 16 : 12}px"><span class="small">${more ? '이미지 더 올리기' : '이미 만든 이미지가 있으면 여기에 끌어다 놓거나'}</span><div class="addbar">${cuts.length > 1 ? `<select class="btn" id="imgcut" aria-label="올릴 컷" style="min-height:36px">${cuts.map(c => `<option value="${c.id}" ${ui.imgCut === c.id ? 'selected' : ''}>${esc(c.id)}</option>`).join('')}</select>` : ''}<label class="btn sm${more ? '' : ' primary'}" for="imgfile-${w.id}">이미지 고르기</label><input type="file" id="imgfile-${w.id}" data-imgfile="${w.id}" accept="image/*" multiple hidden></div></div>`;
}
async function uploadImages(id, files) {
  const cut = $('#imgcut')?.value;
  ui.imgCut = cut;
  await run(async () => {
    let n = 0;
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      const res = await fetch(`/api/works/${id}/image-upload`, { method: 'POST', headers: { 'x-filename': encodeURIComponent(f.name), ...(cut ? { 'x-cut': cut } : {}) }, body: f });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || '이미지를 올리지 못했어요.');
      S = r.state; n += 1;
    }
    render(); toast(n ? `이미지 ${n}장을 올렸어요${cut ? ` (${cut})` : ''}.` : '이미지 파일만 올릴 수 있어요.');
  });
}
function imagePanel(w) {
  const im = w.image || { stage: 'none', drafts: [], results: [] };
  const label = S.imageStage[im.stage];
  let body = '';
  if (im.stage === 'none') body = `<p class="small" style="margin:0 0 12px">보통은 Claude가 컴퓨터로 그린 구도 시안을 먼저 보내요(크레딧 없음). 구도가 이미 정해졌으면 시안 없이 바로 맡기거나, 이미 만든 이미지를 올려도 돼요.</p>
    ${cutChips(im)}
    <label class="small">방향 (선택)<textarea id="img-note" placeholder="예: 제품을 크게, 아침 햇살, 손이 나오는 컷 · 여러 장이면 '5컷 캐러셀'"></textarea></label>
    <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" data-img="make">시안 없이 바로 만들기 맡기기</button><button class="btn primary" data-img="request">구도 시안 맡기기</button></div>
    ${imgUpload(w, im)}`;
  else if (['draft_requested', 'draft_fix', 'make', 'make_fix', 'upscale'].includes(im.stage)) {
    const fix = im.stage === 'upscale' ? null : im.fixes?.[0];
    body = `<div class="status"><span class="dot"></span><div class="small">${esc(label)}.${im.stage.startsWith('make') || im.stage === 'upscale' ? ' Higgsfield를 쓰기 전에 Claude가 예상 크레딧을 먼저 알려 드려요.' : ''}${im.stage === 'upscale' ? ` 업스케일이 끝나면 바로 최종 저장까지 진행돼요. (${im.upscale.ids.join(', ')})` : ''}${fix && im.stage.endsWith('fix') ? `<div class="muted" style="margin-top:4px">수정 요청: ${esc(fix.note || '')}${fix.pins?.length ? ` (핀 ${fix.pins.reduce((a, x) => a + x.pins.length, 0)}개)` : ''}</div>` : ''}</div></div>${cmdBox()}`;
  } else if (im.stage === 'draft_review') {
    const cuts = imgCuts(im), multi = cuts.length > 1, picks = draftPicks(im);
    const cutBlock = c => { const ds = im.drafts.filter(d => (d.cut || 'C1') === c.id); return `${multi ? `<div class="cuth"><b class="small">${esc(c.id)}${c.title ? ` · ${esc(c.title.replace(/^C\d+ · /, ''))}` : ''}</b>${picks[c.id] ? '<span class="chip st-done">고름</span>' : '<span class="chip st-warn">고르기 전</span>'}</div>${c.desc ? `<p class="small muted" style="margin:0 0 8px">${esc(c.desc)}</p>` : ''}` : ''}
      <div class="drafts">${ds.map(d => `<button class="draft" data-draft="${d.id}" data-dcut="${d.cut || 'C1'}" aria-pressed="${picks[c.id] === d.id}"><div class="dn"><h3>${esc(d.title)}</h3>${picks[c.id] === d.id ? '<span class="chip st-done">선택</span>' : ''}</div><img src="${workFile(w, d.file)}" alt="${esc(d.title)}" style="width:100%;border-radius:8px;background:#fff"><span class="small muted">${esc(d.note)}</span></button>`).join('')}</div>
      ${multi ? `<input type="text" data-pnote="${c.id}" value="${esc(ui.pNotes?.[c.id] || '')}" placeholder="${c.id} 생성 메모 (선택)" style="width:100%;margin-top:8px">` : ''}`; };
    const left = cuts.filter(c => !picks[c.id]).length;
    body = `<p class="small muted" style="margin:0 0 12px">${multi ? `${cuts.length}컷이에요. 컷마다 구도를 하나씩 고르고, 생성할 때 바랄 점을 적어요.` : '하나를 고르고, 생성할 때 바랄 점을 적어요.'} 마음에 드는 게 없으면 수정 요청을 보내요.</p>
      ${multi ? `<div class="cutlist">${cuts.map(c => `<section class="cutbox">${cutBlock(c)}</section>`).join('')}</div>` : cutBlock(cuts[0])}
      <label class="small" style="display:block;margin-top:16px">${multi ? '전체 메모' : '메모'} (생성할 때 Claude가 반영)<textarea id="pick-note" placeholder="예: 빛은 더 부드럽게, 배경은 연한 회색${multi ? ', 모든 컷에서 같은 모델' : ''}"></textarea></label>
      ${ui.imgFixOpen ? `<label class="small" style="display:block;margin-top:12px">시안을 어떻게 고칠까요?<textarea id="draftfix-note" placeholder="예: 제품을 더 크게, 문구 자리를 위로"></textarea></label>
        ${multi ? `<div class="row" style="margin-top:8px;gap:4px 16px"><span class="small muted">다시 받을 컷 (안 고르면 전체)</span>${cuts.map(c => `<label class="small" style="display:flex;gap:6px;align-items:center;min-height:44px"><input type="checkbox" data-fixcut="${c.id}" ${ui.fixCuts?.has(c.id) ? 'checked' : ''}> ${c.id}</label>`).join('')}</div>` : ''}
        <div class="row" style="margin-top:12px"><button class="btn" data-img="fixcancel">취소</button><span class="spacer"></span><button class="btn primary" data-img="fixdrafts">시안 수정 요청</button></div>`
        : `<div class="row" style="margin-top:12px"><button class="btn" data-img="fixopen">시안 수정 요청</button><span class="spacer"></span><button class="btn primary" data-img="pick" ${left ? 'disabled' : ''}>${multi ? (left ? `${left}컷 더 골라 주세요` : `고른 구도로 ${cuts.length}컷 이미지 만들기 맡기기`) : '이 시안으로 이미지 만들기 맡기기'}</button></div>`}`;
  } else if (im.stage === 'result_review' || im.stage === 'finalizing') {
    body = `${im.note ? `<p class="small" style="margin:0 0 12px">Claude: ${esc(im.note)}</p>` : ''}${im.error ? `<div class="warnbox" style="margin:0 0 12px">${esc(im.error)}</div>` : ''}
      <p class="small muted" style="margin:0 0 12px">이미지를 누르면 그 자리에 핀이 생겨요. 고칠 점을 핀마다 적고, 최종으로 쓸 이미지는 체크해요.</p>
      ${imgCuts(im).map(c => { const rs = im.results.filter(r => (r.cut || 'C1') === c.id); return `${imgCuts(im).length > 1 ? `<div class="cuth" style="margin-top:16px"><b class="small">${esc(c.id)}${c.title ? ` · ${esc(c.title.replace(/^C\d+ · /, ''))}` : ''}</b><span class="small muted">${rs.length}장</span></div>` : ''}<div class="grid g-2">${rs.map(r => { const pins = pinsOf(r); return `<div><div class="board" data-board="${r.id}"><img src="${workFile(w, r.file)}" alt="${r.id}" style="display:block;width:100%">${pins.map((p, i) => `<span class="pin" style="left:${p.x}%;top:${p.y}%">${i + 1}</span>`).join('')}</div>
        <label class="small" style="display:flex;gap:8px;align-items:center;min-height:44px"><input type="checkbox" data-final="${r.id}" ${ui.finalPick.has(r.id) ? 'checked' : ''}> ${r.id} 최종으로 쓰기<span class="spacer"></span>${r.width ? `<span class="${r.width < 1080 ? 'chip st-warn' : 'small muted'}">${r.width}×${r.height}${r.width < 1080 ? ' · 저해상도' : ''}</span>` : ''}</label>
        <div class="notes">${pins.map((p, i) => `<div class="note"><span class="n">${i + 1}</span><input type="text" id="pin-${r.id}-${i}" data-pin="${r.id}" data-i="${i}" value="${esc(p.note)}" placeholder="고칠 점"><button class="btn sm" data-pindel="${r.id}" data-i="${i}" aria-label="${i + 1}번 핀 지우기">지우기</button></div>`).join('')}</div></div>`; }).join('') || '<p class="empty">이 컷의 이미지가 아직 없어요.</p>'}</div>`; }).join('')}
      ${im.stage === 'result_review' ? imgUpload(w, im, true) : ''}
      <label class="small" style="display:block;margin-top:16px">전체 메모 (선택)<textarea id="imgfix-note" placeholder="예: 전체적으로 조금 더 밝게"></textarea></label>
      ${(() => { const small = im.results.filter(r => ui.finalPick.has(r.id) && r.width && r.width < 1080); return small.length ? `<div class="cautionbox"><b>${small.map(r => `${r.id} (${r.width}×${r.height})`).join(', ')}</b>는 가로 1080px보다 작아요. 최종 컨펌 때 어떻게 할까요?
        <div style="display:flex;flex-direction:column;gap:4px;margin-top:8px;color:var(--ink)">${[['higgsfield', 'Higgsfield로 업스케일 (크레딧 사용, Claude 차례가 한 번 더 생겨요)'], ['local', '프로그램에서 확대 (무료, 조금 덜 선명)'], ['none', '원본 크기 그대로']].map(([k, t]) => `<label style="display:flex;gap:8px;align-items:center;min-height:36px"><input type="radio" name="upscale" value="${k}" data-upscale="${k}" ${ui.upscale === k ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>` : ''; })()}
      <div class="row" style="margin-top:12px"><button class="btn" data-img="fixresults" ${im.stage === 'finalizing' ? 'disabled' : ''}>수정 요청 보내기</button><span class="spacer"></span><button class="btn primary" data-img="final" ${im.stage === 'finalizing' || ui.busy ? 'disabled' : ''}>${im.stage === 'finalizing' ? '처리 중…' : '최종 컨펌'}</button></div>
      <p class="small muted" style="margin:8px 0 0">최종 컨펌하면 인스타그램 크기(JPG · 가로 1080px · 고화질)로 맞춰 Mac 폴더에 저장하고 Google Drive에 복사해요.${imgCuts(im).length > 1 ? ' 파일 번호는 컷 순서(01, 02…)예요.' : ''}</p>`;
  } else if (im.stage === 'done') {
    const f = im.final;
    body = `<ol class="pipe">
      <li class="ok"><span class="pi">✓</span><div style="min-width:0"><b class="small">용량 최적화</b><div class="small muted">${f.files.map(x => `${esc(x.name)} · ${fmtSize(x.before)} → ${fmtSize(x.after)} · ${x.width}×${x.height}`).join('<br>')}</div></div></li>
      <li class="ok"><span class="pi">✓</span><div style="min-width:0"><b class="small">내 Mac에 저장</b><div class="small muted path">${esc(f.folder)}</div>${f.caption ? '' : '<div class="small" style="color:var(--yellow)">캡션이 컨펌되기 전이라 캡션 파일은 넣지 않았어요.</div>'}</div></li>
      ${driveStep(w, f)}</ol>
      <div class="imgs" style="margin-top:12px">${im.results.filter(r => f.picked.includes(r.id)).map(r => `<a href="${workFile(w, r.file)}" target="_blank" rel="noopener"><img src="${workFile(w, r.file)}" alt="${r.id}"></a>`).join('')}</div>
      <div class="row" style="margin-top:12px">${S.info.local ? `<button class="btn sm" data-open="mac">Mac 폴더 열기</button>${f.drive.status === 'copied' ? '<button class="btn sm" data-open="drive">Drive 폴더 열기</button>' : ''}` : ''}<span class="spacer"></span><button class="btn sm" data-img="again">새 버전 만들기</button></div>`;
  }
  return `<section class="panel"><div class="panel-h"><h2>이미지 제작</h2><span class="chip ${workState({ ...w, caption: { status: 'none' } }).c}">${esc(label)}</span></div>${body}</section>`;
}
function vImage() {
  const ws = S.works.filter(w => w.type === 'image');
  const groups = [['내 차례', w => workState(w).c === 'st-you'], ['Claude 차례', w => workState(w).c === 'st-claude'], ['기획', w => workState(w).c === 'st-plan'], ['완료', w => workState(w).c === 'st-done']];
  return head('이미지', '구도 시안 → 생성 → 핀 메모 검수 → 최종 컨펌 순서로 진행해요. 새 이미지 작업은 캘린더에서 만들어요.') + `
  <div class="row"><span class="spacer"></span><a class="btn primary" href="#calendar">캘린더에서 새 작업</a></div>
  ${groups.map(([t, f]) => { const list = ws.filter(f); return list.length ? `<section class="panel"><div class="panel-h"><h2>${t} <span class="small muted" style="font-weight:400">${list.length}건</span></h2></div><div class="tasks">${list.map(workRow).join('')}</div></section>` : ''; }).join('') || '<p class="empty">아직 이미지 작업이 없어요.</p>'}`;
}
let pinTimer = {};
function savePinsSoon(w, resultId) {
  clearTimeout(pinTimer[resultId]);
  pinTimer[resultId] = setTimeout(() => api(`/api/works/${w.id}/image-pins`, { resultId, pins: ui.pins[resultId] }).then(r => { S = r.state; }).catch(e => toast(e.message)), 600);
}

/* ---------- 영상 제작 ---------- */
const subColorOf = () => ui.subColor || S.brand.subtitle?.color || 'auto';
const fmtT = s => { const v = Math.max(0, Number(s) || 0); return `${Math.floor(v / 60)}:${(v % 60).toFixed(1).padStart(4, '0')}`; };
function vNotesOf(w) { return ui.vNotes || w.video.notes || []; }
let vNotesTimer = null;
function saveVNotesSoon(w) { clearTimeout(vNotesTimer); vNotesTimer = setTimeout(() => api(`/api/works/${w.id}/video-notes`, { notes: ui.vNotes }).then(r => { S = r.state; }).catch(e => toast(e.message)), 600); }
function cutRefs(w, i) {
  const part = `cut:${i}`;
  const list = S.refs.filter(r => r.links.some(l => l.work === w.id && l.part === part));
  return `<div class="row small" style="margin-top:4px">${list.map(r => `<span class="chip acc">${esc(r.source)} · ${esc(r.memo || r.title)}<button class="x" data-unref="${r.id}|${w.id}|${part}" aria-label="연결 해제">×</button></span>`).join('')}<button class="btn sm" data-refpick="${w.id}|${part}" style="min-height:32px">+ 레퍼런스</button></div>${refPicker(w.id, part)}`;
}
// 모션 그래픽 글자 (나라별) — 영상 컨펌 때 고른 나라 버전은 이 글자로 프로그램이 다시 만들어요
function motionTexts(w) {
  const m = w.video.motion;
  if (!m) return '';
  const accs = Object.keys(m.comp.texts);
  const la = { GLOBAL: 'en', JP: 'ja', EU: 'fr' };
  return `<details class="inci" style="margin-top:16px" ${ui.motionOpen ? 'open' : ''}><summary data-motionopen>영상 속 글자 · 나라별 (${m.comp.keys.length}개 × ${accs.join('·')})</summary>
    <p class="small muted" style="margin:8px 0">나라별 버전은 같은 디자인에 이 글자만 바꿔서 프로그램이 만들어요. 고칠 글자가 있으면 수정 요청 메모에 적어 주세요.</p>
    <div class="tbl"><table class="subs"><thead><tr><th>키</th>${accs.map(a => `<th>${a}</th>`).join('')}</tr></thead><tbody>${m.comp.keys.map(k => `<tr><td class="tc">${esc(k)}</td>${accs.map(a => `<td><div lang="${la[a]}">${esc(m.comp.texts[a]?.[k]?.text || '')}</div><div class="small muted">${esc(m.comp.texts[a]?.[k]?.back || '')}</div></td>`).join('')}</tr>`).join('')}</tbody></table></div>
    ${accs.flatMap(a => (m.comp.checks?.[a]?.issues || []).map(i => `<div class="check"><span class="ic" style="background:var(--yellow-soft);color:var(--yellow)">!</span><span>${a} · ${esc(i.message)}</span></div>`)).join('')}
    <div class="row" style="margin-top:12px">${ui.tplOpen ? `<input type="text" id="tpl-name" placeholder="템플릿 이름 (예: 행사 릴스 틀)" style="flex:1;min-width:0"><button class="btn sm" data-tpl="cancel">취소</button><button class="btn sm primary" data-tpl="save">저장</button>` : `<span class="small muted">비슷한 영상을 또 만들 거라면</span><span class="spacer"></span><button class="btn sm" data-tpl="open">이 디자인을 템플릿으로 저장</button>`}</div>
  </details>`;
}

function videoPanel(w) {
  const v = w.video || { stage: 'none', videos: [], notes: [], subs: { status: 'none' }, versions: [w.account] };
  const label = S.videoStage[v.stage];
  const vid = v.videos?.[0];
  const p = prodBy(w.product);
  let body = '';
  if (v.stage === 'none') body = `<p class="small" style="margin:0 0 12px">먼저 Claude가 컷 구성(스토리보드)을 보내요. 확인한 뒤에 편집을 시작해요.</p>
    <label class="small">스토리보드 방향 (선택)<textarea id="vid-note" placeholder="예: 15초, 첫 2초에 텍스처 클로즈업, 마지막에 로고"></textarea></label>
    <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn primary" data-vid="request">스토리보드 맡기기</button></div>`;
  else if (v.stage === 'rendering') {
    const j = v.job || {};
    body = `<div class="status"><span class="dot warn"></span><div class="small">Claude가 보낸 모션 그래픽 코드를 영상으로 만드는 중… ${j.total ? `${Math.round((j.done || 0) / j.total * 100)}%` : ''}<div class="muted" style="margin-top:4px">${v.motion ? `${v.motion.comp.duration}초 · ${v.motion.comp.width}×${v.motion.comp.height}${v.motion.template ? ` · 템플릿 ${esc(v.motion.template)}` : ''} · ` : ''}보통 1~3분 걸려요. 이 화면을 닫아도 계속 진행돼요.</div></div></div>${S.info.browser ? '' : '<div class="warnbox" style="margin-top:12px">Mac에 Google Chrome이 없어서 영상을 만들 수 없어요. Chrome을 설치하면 이어서 만들어요.</div>'}`;
  }
  else if (['story_requested', 'story_fix', 'make', 'make_fix'].includes(v.stage)) {
    const fix = v.fixes?.[0];
    body = `${v.motion?.error ? `<div class="warnbox" style="margin:0 0 12px">모션 그래픽 영상을 만들지 못했어요. Claude가 고칠 차례예요: ${esc(v.motion.error)}</div>` : ''}`+`<div class="status"><span class="dot"></span><div class="small">${esc(label)}.${v.stage.startsWith('make') ? ' Higgsfield 영상 생성은 Claude가 예상 크레딧을 먼저 알려 드려요.' : ''}${fix && v.stage.endsWith('fix') ? `<div class="muted" style="margin-top:4px">수정 요청: ${esc(fix.note || '')}${fix.notes?.length ? ` (타임라인 메모 ${fix.notes.length}개)` : ''}</div>` : ''}</div></div>${cmdBox()}
      ${v.stage.startsWith('make') ? '<div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn sm" data-vmethod="capcut">CapCut에서 직접 편집으로 바꾸기</button></div>' : ''}`;
  } else if (v.stage === 'story_review') {
    const imgs = S.works.filter(x => x.type === 'image' && x.id !== w.id && (x.image?.results?.length || x.image?.final || x.image?.cuts?.length > 1));
    const imgOpts = imgs.flatMap(x => x.image?.cuts?.length > 1 ? x.image.cuts.map(c => [`${x.id}:${c.id}`, `${x.id} ${c.id} · ${x.title}`]) : [[x.id, `${x.id} · ${x.title}`]]);
    const linked = [...new Set(v.story.cuts.flatMap(c => (c.fromImage || '').split(',').map(x => x.split(':')[0])).filter(Boolean))];
    body = `<p class="small muted" style="margin:0 0 12px">${v.story.cuts.length}컷 · ${fmtT(v.story.cuts[v.story.cuts.length - 1].end)}${v.story.note ? ` · Claude: ${esc(v.story.note)}` : ''}</p>
      <div class="cautionbox" style="margin:0 0 12px;background:var(--fill);color:var(--ink)">${linked.length ? `컷 이미지: ${linked.map(id => `<a href="#work-${id}">${id}</a>`).join(', ')}에서 컷마다 구도를 고르고 이미지를 만들어요. 다 만든 뒤 이 영상을 승인하면 Claude가 그 이미지로 컷을 만들어요.` : '컷마다 먼저 이미지를 뽑고 싶으면, 이 스토리보드로 <b>컷 이미지 작업</b>을 한 번에 만들 수 있어요. 컷마다 구도 시안을 고르고 이미지를 만든 뒤 영상에 써요.'}
        ${linked.length ? '' : `<div class="row" style="margin-top:8px"><span class="spacer"></span><button class="btn sm primary" data-vid="cutimages">컷 이미지 한꺼번에 만들기 (${v.story.cuts.length}컷)</button></div>`}</div>
      <div class="cuts">${v.story.cuts.map((c, i) => `<div class="cut"><div class="cth">${c.sketch ? `<img src="${workFile(w, c.sketch)}" alt="${c.id} 스케치" style="width:100%;height:100%;object-fit:contain;background:#fff">` : `<div style="display:grid;place-items:center;height:100%;font-size:12px;color:var(--muted)">${c.id}</div>`}</div>
        <div style="min-width:0;display:flex;flex-direction:column;gap:4px"><div class="row"><b class="small">${c.id}</b><span class="code">${fmtT(c.start)}–${fmtT(c.end)}</span>${c.kind === 'motion' ? '<span class="chip st-plan">모션 그래픽</span>' : ''}${c.camera ? `<span class="small muted">${esc(c.camera)}</span>` : ''}</div>
          <div class="small">${esc(c.desc)}</div>${c.text ? `<div class="small">${esc(c.text)}</div><div class="small muted">${esc(c.back)}</div>` : ''}
          <label class="small muted" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">이미지 작업으로 시작<select class="btn" data-cutimg="${c.id}" style="min-height:36px;flex:1;min-width:0"><option value="">없음</option>${c.fromImage?.includes(',') ? `<option value="${esc(c.fromImage)}" selected>여러 장: ${esc(c.fromImage.replace(/,/g, ', '))}</option>` : ''}${imgOpts.map(([val, lab]) => `<option value="${val}" ${c.fromImage === val ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select></label>
          ${cutRefs(w, i)}</div></div>`).join('')}</div>
      ${ui.vFixOpen === 'story' ? `<label class="small" style="display:block;margin-top:16px">스토리보드를 어떻게 고칠까요?<textarea id="vstory-note" placeholder="예: C2를 더 짧게, 마지막에 제품 클로즈업 추가"></textarea></label><div class="row" style="margin-top:12px"><button class="btn" data-vid="fixcancel">취소</button><span class="spacer"></span><button class="btn primary" data-vid="fixstory">수정 요청 보내기</button></div>`
        : `<div class="row" style="margin-top:16px"><button class="btn" data-vid="fixopen-story">수정 요청</button><span class="spacer"></span><button class="btn" data-vapprove="capcut">승인 · CapCut에서 내가 편집</button><button class="btn primary" data-vapprove="claude">승인 · Claude가 편집</button></div>`}`;
  } else if (v.stage === 'edit_me') {
    const fix = v.fixes?.[0]?.kind === 'video' && vid ? v.fixes[0] : null;
    body = `<p class="small" style="margin:0 0 12px">CapCut에서 편집해서 내보낸 영상(mp4·mov)을 올려 주세요. <b>자막은 넣지 마세요.</b> 나라별 자막은 프로그램이 입혀요.</p>
      ${fix ? `<div class="cautionbox" style="margin:0 0 12px">고칠 점: ${esc(fix.note || '')}<ul style="margin:4px 0 0;padding-left:20px">${fix.notes.map(n => `<li>${fmtT(n.t)}${n.t2 ? `–${fmtT(n.t2)}` : ''} ${esc(n.text)}</li>`).join('')}</ul></div>` : ''}
      <details class="inci"><summary>스토리보드 보기 (${v.story.cuts.length}컷)</summary>${v.story.cuts.map(c => `<p style="font-size:14px;color:var(--ink);margin:4px 0">${c.id} ${fmtT(c.start)}–${fmtT(c.end)} · ${esc(c.desc)}${c.fromImage ? ` · ${c.fromImage}` : ''}</p>`).join('')}</details>
      <div class="drop mini" data-vdrop="${w.id}" style="margin-top:12px"><span class="small">영상 파일을 여기에 끌어다 놓거나</span><div class="addbar"><label class="btn sm primary" for="vfile-${w.id}">영상 파일 고르기</label><input type="file" id="vfile-${w.id}" data-vfile="${w.id}" accept="video/*" hidden><span class="spacer"></span><button class="btn sm" data-vmethod="claude">Claude에게 편집 맡기기</button></div></div>`;
  } else if (v.stage === 'result_review') {
    const notes = vNotesOf(w);
    const cuts = v.story?.cuts || [];
    const markets = ['GLOBAL', 'JP', 'EU'].filter(a => p.markets[S.accounts[a].market]);
    const versions = ui.versions || v.versions || [w.account];
    body = `${vid.note ? `<p class="small" style="margin:0 0 12px">${vid.source === 'upload' ? '나' : 'Claude'}: ${esc(vid.note)}</p>` : ''}
      <div class="grid g-main"><div>
        <video id="vp" src="${workFile(w, vid.file)}" controls playsinline preload="metadata" style="width:100%;max-height:560px;background:#000;border-radius:11px"></video>
        <div class="timeline" id="vtl" data-dur="${vid.duration}" role="slider" aria-label="타임라인" tabindex="0">
          ${cuts.map(c => `<div class="seg" style="left:${c.start / vid.duration * 100}%;width:calc(${Math.max(0, Math.min(c.end, vid.duration) - c.start) / vid.duration * 100}% - 4px);margin-left:2px">${c.id}</div>`).join('')}
          ${notes.map(n => `<span class="mk" style="left:${n.t / vid.duration * 100}%"></span>`).join('')}<div class="head" id="vhead" style="left:0"></div></div>
        <div class="ticks"><span>0:00</span><span>${fmtT(vid.duration / 2)}</span><span>${fmtT(vid.duration)}</span></div>
        <div class="row" style="margin-top:12px"><input type="text" id="vnote" placeholder="지금 지점에 남길 수정사항" style="flex:1;min-width:0"><button class="btn sm primary" data-vid="addnote">메모 추가</button></div>
        <p class="small muted" style="margin:8px 0 0">${vid.duration.toFixed(1)}초 · ${vid.width}×${vid.height}${vid.audio ? '' : ' · 소리 없음'}</p>
      </div><div>
        <h3>수정사항 <span class="small muted" style="font-weight:400">${notes.length}개</span></h3>
        <div class="notes" style="margin-top:8px">${notes.map((n, i) => `<div class="note" style="grid-template-columns:auto minmax(0,1fr) auto"><button class="btn sm" data-vseek="${n.t}" style="min-height:36px" aria-label="${fmtT(n.t)}로 이동">${fmtT(n.t)}${n.t2 ? `–${fmtT(n.t2)}` : ''}</button><input type="text" id="vn-${i}" data-vnote="${i}" value="${esc(n.text)}" placeholder="고칠 점"><span class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn sm" data-vrange="${i}" title="지금 지점을 구간 끝으로" style="min-height:36px">끝</button><button class="btn sm" data-vdel="${i}" style="min-height:36px" aria-label="메모 지우기">×</button></span></div>`).join('') || '<p class="empty">재생하다가 고칠 곳에서 메모를 추가하세요.</p>'}</div>
      </div></div>
      ${vid.source === 'motion' ? motionTexts(w) : ''}
      ${ui.vFixOpen === 'video' ? `<label class="small" style="display:block;margin-top:16px">전체 메모 (선택)<textarea id="vfix-note" placeholder="예: 전체 길이 2초 줄이기"></textarea></label><div class="row" style="margin-top:12px"><button class="btn" data-vid="fixcancel">취소</button><span class="spacer"></span><button class="btn primary" data-vid="fixvideo">수정 요청 보내기 (${v.method === 'claude' ? 'Claude가 고쳐요' : 'CapCut에서 내가 고쳐요'})</button></div>`
        : `<div class="panel" style="margin-top:16px;padding:16px;background:var(--fill);border:0"><h3>영상 컨펌 후 만들 버전</h3>
          <div class="row" style="margin-top:8px">${markets.map(a => `<label class="small" style="display:flex;gap:8px;align-items:center;min-height:44px;margin-right:12px"><input type="checkbox" data-version="${a}" ${versions.includes(a) ? 'checked' : ''} ${a === w.account ? 'disabled' : ''}> ${a} · ${esc(S.accounts[a].lang)}</label>`).join('')}</div>
          <label class="small" style="display:flex;gap:8px;align-items:center;min-height:44px"><input type="checkbox" id="subs-on" ${ui.subsOn ? 'checked' : ''}> 나라별 자막 넣기 (Claude는 글자만 쓰고, 영상에 입히는 건 프로그램이 해요)</label>
          ${['GLOBAL', 'JP', 'EU'].filter(a => !p.markets[S.accounts[a].market]).length ? `<p class="small muted" style="margin:4px 0 0">판매하지 않는 시장(${['GLOBAL', 'JP', 'EU'].filter(a => !p.markets[S.accounts[a].market]).join(', ')})은 버전을 만들 수 없어요.</p>` : ''}</div>
          <div class="row" style="margin-top:12px"><button class="btn" data-vid="fixopen-video">수정 요청</button><span class="spacer"></span><button class="btn primary" data-vid="approve">영상 컨펌</button></div>`}`;
  } else if (v.stage === 'video_ok' || v.stage === 'finalizing') {
    const sub = v.subs;
    let subBody = '';
    if (sub.off) subBody = '<p class="small muted" style="margin:0">자막 없이 만들어요.</p>';
    else if (['requested', 'fix'].includes(sub.status)) subBody = `<div class="status"><span class="dot"></span><div class="small">${esc(S.subStatus[sub.status])} (${v.versions.join(', ')})${sub.status === 'fix' ? ` · 수정 요청: ${esc(sub.fixes[0]?.note)}` : ''}</div></div>${cmdBox()}`;
    else subBody = v.versions.map(a => { const la = { GLOBAL: 'en', JP: 'ja', EU: 'fr' }[a]; const iss = sub.checks?.[a]?.issues || []; return `<h3 style="margin:16px 0 8px">${a} · ${esc(S.accounts[a].lang)}</h3>
        <div class="tbl"><table class="subs"><thead><tr><th>시간</th><th>원문</th><th>한국어 역번역</th></tr></thead><tbody>${(sub.tracks[a] || []).map(sg => `<tr><td class="tc">${fmtT(sg.start)}–${fmtT(sg.end)}</td><td lang="${la}">${esc(sg.text)}</td><td>${esc(sg.back)}</td></tr>`).join('')}</tbody></table></div>
        ${ui.subStill?.[a] ? `<div class="stills" aria-label="${a} 자막을 입힌 장면">${(sub.tracks[a] || []).map((sg, i) => `<figure><img src="/work-sub-still?id=${w.id}&acc=${a}&i=${i}&color=${subColorOf()}&v=${encodeURIComponent(sub.at || '')}" alt="${fmtT(sg.start)} 장면" loading="lazy"><figcaption class="small muted">${fmtT(sg.start)}</figcaption></figure>`).join('')}</div><button class="btn sm" data-substill="${a}" style="margin-top:8px">장면 닫기</button>`
          : `<button class="btn sm" data-substill="${a}" style="margin-top:8px">영상에 입힌 모습 보기</button>`}
        ${iss.map(i => `<div class="check"><span class="ic" style="background:var(--yellow-soft);color:var(--yellow)">!</span><span>${esc(i.message)}</span></div>`).join('')}`; }).join('')
      + (sub.status === 'review' ? (ui.vFixOpen === 'subs' ? `<label class="small" style="display:block;margin-top:16px">자막을 어떻게 고칠까요? (한국어로)<textarea id="vsub-note" placeholder="예: JP 2번 줄을 더 짧게"></textarea></label><div class="row" style="margin-top:12px"><button class="btn" data-vid="fixcancel">취소</button><span class="spacer"></span><button class="btn primary" data-vid="fixsubs">수정 요청 보내기</button></div>`
        : `<div class="row" style="margin-top:16px"><button class="btn" data-vid="fixopen-subs">수정 요청</button><span class="spacer"></span><button class="btn primary" data-vid="confirmsubs">자막 컨펌</button></div>`) : '');
    const ready = sub.off || sub.status === 'confirmed';
    body = `${v.error ? `<div class="warnbox" style="margin:0 0 12px">${esc(v.error)}</div>` : ''}<video src="${workFile(w, vid.file)}" controls playsinline preload="metadata" style="width:100%;max-width:320px;max-height:480px;background:#000;border-radius:11px;display:block"></video>
      <h3 style="margin-top:16px">자막 <span class="chip ${sub.status === 'confirmed' ? 'st-done' : sub.status === 'review' ? 'st-you' : 'st-claude'}" style="margin-left:4px">${esc(sub.off ? '자막 없음' : S.subStatus[sub.status])}</span></h3>${subBody}
      ${v.stage === 'finalizing' ? `<div class="status" style="margin-top:16px"><span class="dot warn"></span><div class="small">나라별 영상을 만드는 중… (${v.job?.done || 0}/${v.job?.total || 0}) 영상 길이에 따라 몇 분 걸려요. 이 화면을 닫아도 계속 진행돼요.</div></div>`
        : ready ? `${sub.off ? '' : `<div class="row" role="radiogroup" aria-label="자막 글씨 색" style="margin-top:16px;gap:4px 16px"><span class="small" style="font-weight:600">자막 글씨 색</span>${Object.entries(S.subColors).map(([k, l]) => `<label class="small" style="display:flex;gap:8px;align-items:center;min-height:44px"><input type="radio" name="subcolor" data-subcolor="${k}" ${subColorOf() === k ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>`}<div class="row" style="margin-top:8px"><span class="small muted">${v.versions.join(', ')} 버전 · 자막 입히기 → 용량 최적화(H.264 · 가로 1080px) → Mac 폴더 → Google Drive</span><span class="spacer"></span><button class="btn primary" data-vid="final">최종 컨펌</button></div>` : ''}`;
  } else if (v.stage === 'done') {
    const f = v.final;
    body = `<ol class="pipe">
      <li class="ok"><span class="pi">✓</span><div style="min-width:0"><b class="small">나라별 영상 · 용량 최적화</b><div class="small muted">${f.outputs.map(o => `${esc(o.file)} · ${fmtSize(o.before)} → ${fmtSize(o.after)} · ${o.width}×${o.height}${o.subColors ? ` · 자막 흰 ${o.subColors.white} · 검정 ${o.subColors.black}` : ''}`).join('<br>')}</div></div></li>
      <li class="ok"><span class="pi">✓</span><div style="min-width:0"><b class="small">내 Mac에 저장</b><div class="small muted path">${f.folders.map(esc).join('<br>')}</div></div></li>
      ${driveStep(w, f)}</ol>
      <div class="row" style="margin-top:12px">${S.info.local ? f.folders.map((d, i) => `<button class="btn sm" data-open="mac" data-index="${i}">${esc(d.split('/').slice(-2, -1)[0])} 폴더 열기</button>`).join('') : ''}<span class="spacer"></span><button class="btn sm" data-vid="again">새 버전 만들기</button></div>`;
  }
  return `<section class="panel"><div class="panel-h"><h2>영상 제작${v.method && v.stage !== 'none' ? ` <span class="small muted" style="font-weight:400">${v.method === 'claude' ? 'Claude가 편집' : 'CapCut에서 내가 편집'}</span>` : ''}</h2><span class="chip ${workState({ ...w, caption: { status: 'none' } }).c}">${esc(label)}</span></div>${body}</section>`;
}
function vVideo() {
  const ws = S.works.filter(w => w.type === 'video');
  const groups = [['내 차례', w => workState(w).c === 'st-you'], ['Claude 차례', w => workState(w).c === 'st-claude'], ['기획', w => workState(w).c === 'st-plan'], ['완료', w => workState(w).c === 'st-done']];
  return head('영상', '스토리보드 → 편집(Claude 또는 CapCut) → 타임라인 검수 → 나라별 자막 → 최종 컨펌 순서로 진행해요. 새 영상 작업은 캘린더에서 만들어요.') + `
  <div class="row"><span class="spacer"></span><a class="btn primary" href="#calendar">캘린더에서 새 작업</a></div>
  ${groups.map(([t, f]) => { const list = ws.filter(f); return list.length ? `<section class="panel"><div class="panel-h"><h2>${t} <span class="small muted" style="font-weight:400">${list.length}건</span></h2></div><div class="tasks">${list.map(workRow).join('')}</div></section>` : ''; }).join('') || '<p class="empty">아직 영상 작업이 없어요.</p>'}`;
}
async function uploadVideoFile(workId, file) {
  if (!file) return;
  ui.busy = true; render(); toast(`영상을 올리는 중… (${fmtSize(file.size)})`);
  try {
    const r = await fetch(`/api/works/${workId}/video-upload`, { method: 'POST', headers: { 'content-type': file.type || 'video/mp4' }, body: file });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '올리지 못했어요.');
    S = j.state; ui.vNotes = null; render(); toast('영상을 올렸어요. 재생하면서 검수해 주세요.');
  } catch (e) { toast(e.message); } finally { ui.busy = false; render(); }
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
  html: ['HTML', '5단계', ['자사몰(damtix.shop · damtix.eu) 섹션 구성 → 제작 → PC·모바일 미리보기 검수']]
};
function vSoon(k) {
  const [t, step, items] = SOON[k];
  return head(t, `${step}에서 열려요.`) + `<section class="panel soon"><span class="chip st-plan">준비 중</span><ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p class="small muted" style="margin:0">화면 미리보기에서 만든 모습 그대로 단계별로 만들어 갈게요.</p></section>`;
}

/* ---------- 라우터 ---------- */
const VIEWS = { home: vHome, calendar: vCalendar, refs: vRefs, image: vImage, video: vVideo, brand: vBrand, check: vCheck };
let cur = 'home';
function render() {
  const h = location.hash.replace('#', '');
  const wm = /^work-([A-Za-z]+-\d+)$/.exec(h);
  cur = wm ? 'work' : VIEWS[h] || SOON[h] ? h : 'home';
  renderNav(cur === 'work' ? 'calendar' : cur);
  $('#view').innerHTML = wm ? vWork(wm[1].toUpperCase()) : VIEWS[cur] ? VIEWS[cur]() : vSoon(cur);
}
window.addEventListener('hashchange', () => { $('.rail').classList.remove('open'); $('#menuBtn').setAttribute('aria-expanded', 'false'); ui.edit = null; ui.workEdit = null; ui.fixOpen = false; ui.confirmDelete = false; ui.refPick = null; ui.draftPick = null; ui.dPicks = null; ui.pNotes = null; ui.fixCuts = null; ui.pins = {}; ui.finalPick = new Set(); ui.imgFixOpen = false; ui.refDelete = null; ui.vNotes = null; ui.vFixOpen = null; ui.versions = null; ui.subsOn = true; render(); scrollTo(0, 0); refresh(); });

async function run(fn) { try { await fn(); } catch (e) { toast(e.message); } }
function copy(text, done) {
  const fallback = () => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} ta.remove(); toast(ok ? done : '복사하지 못했어요. 직접 선택해서 복사해 주세요.'); };
  try { navigator.clipboard.writeText(text).then(() => toast(done), fallback); } catch { fallback(); }
}

document.addEventListener('click', e => {
  const board = e.target.closest('[data-board]');
  if (board && !e.target.closest('button,input,a')) {
    const w = S.works.find(x => x.id === (/^#work-([A-Za-z]+-\d+)$/.exec(location.hash) || [])[1]?.toUpperCase()); if (!w) return;
    const r = w.image.results.find(x => x.id === board.dataset.board); const rect = board.getBoundingClientRect();
    ui.pins[r.id] = [...pinsOf(r), { x: +((e.clientX - rect.left) / rect.width * 100).toFixed(1), y: +((e.clientY - rect.top) / rect.height * 100).toFixed(1), note: '' }];
    render(); const ins = document.querySelectorAll(`[data-pin="${r.id}"]`); ins[ins.length - 1]?.focus(); savePinsSoon(w, r.id); return;
  }
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
  if (d.refpick) { ui.refPick = ui.refPick === d.refpick ? null : d.refpick; render(); return; }
  if (d.refadd) { const [rid, work, part] = d.refadd.split('|'); return run(async () => { S = (await api(`/api/refs/${rid}/link`, { work, part })).state; ui.refPick = null; render(); toast(`${work}에 레퍼런스를 연결했어요.`); }); }
  if (d.unref) { const [rid, work, part] = d.unref.split('|'); return run(async () => { S = (await api(`/api/refs/${rid}/unlink`, { work, part })).state; render(); toast('연결을 해제했어요. 보관함에는 남아 있어요.'); }); }
  if (d.refurl !== undefined) { const work = d.refurl; addUrl($(`#refurl-${work || 'lib'}`).value, work); return; }
  if (d.act === 'refdelask') { ui.refDelete = d.id; render(); return; }
  if (d.act === 'refdelno') { ui.refDelete = null; render(); return; }
  if (d.refdel) return run(async () => { S = (await api(`/api/refs/${d.refdel}/delete`, {})).state; ui.refDelete = null; render(); toast('레퍼런스를 지웠어요.'); });
  if (d.draft) { ui.dPicks = { ...(ui.dPicks || {}), [d.dcut || 'C1']: d.draft }; render(); return; }
  if (d.pindel) { const w = cw(); const r = w.image.results.find(x => x.id === d.pindel); ui.pins[r.id] = pinsOf(r).filter((_, i) => i !== Number(d.i)); render(); savePinsSoon(w, r.id); return; }
  if (d.open) return run(async () => { await api('/api/open', { id: wid(), which: d.open === 'drive' ? 'drive' : 'mac', index: Number(d.index) || 0 }); });
  if (d.act === 'setdrive') return run(async () => { S = (await api('/api/config', { driveFolder: $('#drivesel').value })).state; render(); toast($('#drivesel')?.value ? 'Google Drive 폴더를 저장했어요.' : 'Google Drive 복사를 껐어요.'); });
  if (d.img) {
    const w = cw(); if (!w) return;
    if (d.img === 'fixopen') { ui.imgFixOpen = true; render(); $('#draftfix-note')?.focus(); return; }
    if (d.img === 'fixcancel') { ui.imgFixOpen = false; render(); return; }
    const im = w.image || {};
    const calls = {
      request: ['image-request', { note: $('#img-note')?.value }, '구도 시안을 Claude에게 맡겼어요.'],
      make: ['image-make', { note: $('#img-note')?.value }, '시안 없이 바로 이미지 만들기를 맡겼어요.'],
      again: ['image-request', { note: '' }, '새 버전 구도 시안을 Claude에게 맡겼어요.'],
      fixdrafts: ['image-fix-drafts', { note: $('#draftfix-note')?.value, cuts: [...(ui.fixCuts || [])] }, '시안 수정 요청을 보냈어요.'],
      pick: ['image-picks', { picks: draftPicks(im), notes: ui.pNotes || {}, note: $('#pick-note')?.value }, imgCuts(im).length > 1 ? `${imgCuts(im).length}컷 이미지 만들기를 맡겼어요.` : '이 시안으로 이미지 만들기를 맡겼어요.'],
      fixresults: ['image-fix', { note: $('#imgfix-note')?.value }, '수정 요청을 Claude에게 보냈어요.'],
      final: ['image-final', { resultIds: [...ui.finalPick], upscale: (w.image.results.some(r => ui.finalPick.has(r.id) && r.width && r.width < 1080)) ? ui.upscale : 'none' }, ui.upscale === 'higgsfield' && w.image.results.some(r => ui.finalPick.has(r.id) && r.width && r.width < 1080) ? 'Higgsfield 업스케일을 Claude에게 맡겼어요. 끝나면 바로 저장돼요.' : '최종 처리를 마쳤어요.']
    };
    const c = calls[d.img]; if (!c) return;
    if (d.img === 'final' && !ui.finalPick.size) { toast('최종으로 쓸 이미지를 체크해 주세요.'); return; }
    return run(async () => {
      if (d.img === 'final') { ui.busy = true; render(); toast('최적화해서 저장하는 중…'); }
      if (d.img === 'fixresults' || d.img === 'final') { for (const [rid, pins] of Object.entries(ui.pins)) { clearTimeout(pinTimer[rid]); await api(`/api/works/${w.id}/image-pins`, { resultId: rid, pins }); } }
      try { S = (await api(`/api/works/${w.id}/${c[0]}`, c[1])).state; } finally { ui.busy = false; }
      ui.imgFixOpen = false; ui.draftPick = null; ui.dPicks = null; ui.pNotes = null; ui.fixCuts = null; ui.pins = {}; if (d.img === 'final') ui.finalPick = new Set(); render(); toast(c[2]);
    });
  }
  if (d.act === 'drivecheck') return run(async () => { ui.busy = true; render(); try { S = (await api('/api/drive-check', {})).state; toast(S.info.finals.check?.message || '점검했어요.'); } finally { ui.busy = false; render(); } });
  if (d.act === 'driveretryall') return run(async () => { ui.busy = true; render(); toast('Google Drive에 다시 복사하는 중…'); try { const r = await api('/api/drive-retry-all', {}); S = r.state; const ok = r.done.filter(x => x.status === 'copied').length; toast(`${ok}/${r.done.length}건 복사했어요.`); } finally { ui.busy = false; render(); } });
  if (d.driveretry) return run(async () => { ui.busy = true; render(); toast('Google Drive에 복사하는 중…'); try { const r = await api(`/api/works/${d.driveretry}/drive-retry`, {}); S = r.state; const f = r.work.type === 'image' ? r.work.image.final : r.work.video.final; toast(f.drive.status === 'copied' ? 'Google Drive에 복사했어요.' : f.drive.status === 'failed' ? '아직 복사하지 못했어요. 잠시 뒤 다시 눌러 주세요.' : 'Drive 폴더를 확인해 주세요.'); } finally { ui.busy = false; render(); } });
  if (d.motionopen !== undefined) { ui.motionOpen = !ui.motionOpen; }
  if (d.tpl) {
    const w = S.works.find(x => x.id === dropWork());
    if (d.tpl === 'open') { ui.tplOpen = true; ui.motionOpen = true; render(); $('#tpl-name')?.focus(); return; }
    if (d.tpl === 'cancel') { ui.tplOpen = false; render(); return; }
    if (d.tpl === 'save') { const name = $('#tpl-name').value.trim(); if (!name) { $('#tpl-name').focus(); return; } return run(async () => { const r = await api(`/api/works/${w.id}/motion-template`, { name }); S = r.state; ui.tplOpen = false; render(); toast(`${r.template.id} "${r.template.name}" 템플릿으로 저장했어요. 다음 영상 기획 메모에 "${r.template.id} 템플릿으로"라고 적으면 Claude가 거기서 시작해요.`); }); }
  }
  if (d.substill) { ui.subStill = { ...ui.subStill, [d.substill]: !ui.subStill?.[d.substill] }; render(); return; }
  if (d.vid || d.vapprove || d.vmethod || d.vseek !== undefined || d.vrange !== undefined || d.vdel !== undefined) {
    const w = cw(); if (!w) return;
    const vp = $('#vp');
    if (d.vseek !== undefined) { if (vp) { vp.currentTime = Number(d.vseek); vp.play?.().catch(() => {}); } return; }
    if (d.vrange !== undefined) { const n = vNotesOf(w).map(x => ({ ...x })); const i = Number(d.vrange); const t = vp?.currentTime || 0; if (t > n[i].t) n[i].t2 = +t.toFixed(2); else toast('구간 끝은 시작보다 뒤여야 해요. 재생 위치를 옮긴 뒤 눌러 주세요.'); ui.vNotes = n; render(); saveVNotesSoon(w); return; }
    if (d.vdel !== undefined) { ui.vNotes = vNotesOf(w).filter((_, i) => i !== Number(d.vdel)); render(); saveVNotesSoon(w); return; }
    if (d.vid === 'addnote') { const t = vp?.currentTime || 0; const txt = $('#vnote').value.trim(); if (!txt) { $('#vnote').focus(); return; } ui.vNotes = [...vNotesOf(w), { t: +t.toFixed(2), t2: null, text: txt }].sort((a, b) => a.t - b.t); render(); saveVNotesSoon(w); toast(`${fmtT(t)} 지점에 메모를 남겼어요.`); return; }
    if (d.vid === 'cutimages') return run(async () => { const r = await api(`/api/works/${w.id}/video-cut-images`, {}); S = r.state; render(); toast(`컷 이미지 작업을 만들고 Claude에게 구도 시안을 맡겼어요.`); });
    if (d.vid?.startsWith('fixopen-')) { ui.vFixOpen = d.vid.slice(8); render(); return; }
    if (d.vid === 'fixcancel') { ui.vFixOpen = null; render(); return; }
    const calls = {
      request: ['video-request', { note: $('#vid-note')?.value }, '스토리보드를 Claude에게 맡겼어요.'],
      again: ['video-request', { note: '' }, '새 버전 스토리보드를 Claude에게 맡겼어요.'],
      fixstory: ['video-fix-story', { note: $('#vstory-note')?.value }, '스토리보드 수정 요청을 보냈어요.'],
      fixvideo: ['video-fix', { note: $('#vfix-note')?.value }, w.video?.method === 'claude' ? '수정 요청을 Claude에게 보냈어요.' : 'CapCut에서 고쳐서 다시 올려 주세요.'],
      approve: ['video-approve', { versions: ui.versions || w.video?.versions, subtitles: ui.subsOn }, ui.subsOn ? '영상을 컨펌했어요. 자막을 Claude에게 맡겼어요.' : '영상을 컨펌했어요.'],
      fixsubs: ['video-subs-fix', { note: $('#vsub-note')?.value }, '자막 수정 요청을 보냈어요.'],
      confirmsubs: ['video-subs-confirm', {}, '자막을 컨펌했어요.'],
      final: ['video-final', { subColor: subColorOf() }, '나라별 영상을 만드는 중이에요. 몇 분 걸릴 수 있어요.']
    };
    const c = d.vapprove ? ['video-approve-story', { method: d.vapprove }, d.vapprove === 'claude' ? '승인했어요. Claude가 편집할 차례예요.' : '승인했어요. CapCut에서 편집해서 올려 주세요.'] : d.vmethod ? ['video-method', { method: d.vmethod }, d.vmethod === 'claude' ? 'Claude가 편집하도록 바꿨어요.' : 'CapCut에서 직접 편집하도록 바꿨어요.'] : calls[d.vid];
    if (!c) return;
    return run(async () => { if (ui.vNotes && ['fixvideo', 'approve'].includes(d.vid)) { clearTimeout(vNotesTimer); await api(`/api/works/${w.id}/video-notes`, { notes: ui.vNotes }); } S = (await api(`/api/works/${w.id}/${c[0]}`, c[1])).state; ui.vFixOpen = null; ui.vNotes = null; if (d.vid === 'approve') ui.versions = null; render(); toast(c[2]); });
  }
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
  if (t.dataset.vnote !== undefined) { const w = S.works.find(x => x.id === dropWork()); const n = vNotesOf(w).map(x => ({ ...x })); n[Number(t.dataset.vnote)].text = t.value; ui.vNotes = n; saveVNotesSoon(w); }
  if (t.dataset.pin) { const w = S.works.find(x => x.id === (/^#work-([A-Za-z]+-\d+)$/.exec(location.hash) || [])[1]?.toUpperCase()); const r = w.image.results.find(x => x.id === t.dataset.pin); const pins = pinsOf(r).map(p => ({ ...p })); pins[Number(t.dataset.i)].note = t.value; ui.pins[r.id] = pins; savePinsSoon(w, r.id); }
  if (t.dataset.f && ui.edit) ui.edit.draft[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value;
  if (t.dataset.f && ui.edit?.key === 'brand.subtitle') { const draft = { ...ui.edit.draft }, k = JSON.stringify(draft); clearTimeout(ui.subPrevT); $('#subprev .subgrid')?.classList.add('loading'); ui.subPrevT = setTimeout(() => loadSubPrev(draft, k), 600); }
  if (t.id === 'ereason' && ui.edit) ui.edit.reason = t.value;
  if (t.dataset.pnote) ui.pNotes = { ...(ui.pNotes || {}), [t.dataset.pnote]: t.value };
  if (t.id === 'ck-text') ui.check.text = t.value;
});
document.addEventListener('change', e => { const t = e.target;
  if (t.dataset.refmemo !== undefined) { run(async () => { S = (await api(`/api/refs/${t.dataset.refmemo}/update`, { memo: t.value })).state; toast('가져올 점을 저장했어요.'); }); }
  if (t.dataset.reflink && t.value) { const work = t.value; run(async () => { S = (await api(`/api/refs/${t.dataset.reflink}/link`, { work, part: '' })).state; render(); toast(`${work}에 연결했어요.`); }); }
  if (t.dataset.filefor !== undefined && t.files.length) { uploadFiles([...t.files], t.dataset.filefor); }
  if (t.dataset.final) { t.checked ? ui.finalPick.add(t.dataset.final) : ui.finalPick.delete(t.dataset.final); render(); }
  if (t.dataset.upscale) { ui.upscale = t.dataset.upscale; }
  if (t.dataset.subcolor) { ui.subColor = t.dataset.subcolor; render(); }
  if (t.dataset.fixcut) { ui.fixCuts = ui.fixCuts || new Set(); t.checked ? ui.fixCuts.add(t.dataset.fixcut) : ui.fixCuts.delete(t.dataset.fixcut); }
  if (t.dataset.cutimg !== undefined) { const w = S.works.find(x => x.id === dropWork()); if (w) run(async () => { S = (await api(`/api/works/${w.id}/video-cut-image`, { cutId: t.dataset.cutimg, imageId: t.value })).state; render(); toast(t.value ? `${t.dataset.cutimg}에 ${t.value}를 넣었어요.` : `${t.dataset.cutimg}에서 이미지를 뺐어요.`); }); }
  if (t.dataset.version) { const w = S.works.find(x => x.id === dropWork()); const set = new Set(ui.versions || w.video.versions || [w.account]); t.checked ? set.add(t.dataset.version) : set.delete(t.dataset.version); set.add(w.account); ui.versions = [...set]; }
  if (t.id === 'subs-on') ui.subsOn = t.checked;
  if (t.dataset.vfile && t.files.length) uploadVideoFile(t.dataset.vfile, t.files[0]);
  if (ui.newWork && t.id?.startsWith('nw-')) { const k = { 'nw-type': 'type', 'nw-acc': 'acc', 'nw-prod': 'prod', 'nw-date': 'date' }[t.id]; if (k) ui.newWork[k] = t.value; if (t.id === 'nw-cap') ui.newWork.cap = t.checked; } if (t.dataset.f && ui.edit && t.type === 'checkbox') ui.edit.draft[t.dataset.f] = t.checked;
  if (t.dataset.fontfile !== undefined && t.files.length) uploadFont(t.files[0]);
  if (t.dataset.imgfile && t.files.length) uploadImages(t.dataset.imgfile, [...t.files]);
  if (t.id === 'imgcut') ui.imgCut = t.value;
});

// 다른 곳(Claude 앱, 다른 기기)에서 바뀐 내용을 30초마다 반영. 수정 중일 때는 건드리지 않는다.
function refresh() {
  if (ui.edit || ui.workEdit || ui.fixOpen || ui.newWork || ui.imgFixOpen || ui.vFixOpen || ui.busy || ui.vNotes || Object.keys(ui.pins).length || (cur === 'work' && $('#vp') && !$('#vp').paused) || document.hidden || ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement?.tagName)) return;
  api('/api/state').then(s => { const pick = x => JSON.stringify([x.brand, x.products, x.proposals, x.history[0]?.id, x.info.claudeLastSeen, x.works.map(w => w.updatedAt), x.queue.length, x.refs.map(r => r.status + r.links.length)]); const changed = pick(s) !== pick(S); S = s; if (changed && cur !== 'check') render(); }).catch(() => {});
}
setInterval(refresh, 10000);
setInterval(() => { if (S?.works.some(w => ['finalizing', 'rendering'].includes(w.video?.stage) || w.image?.stage === 'finalizing')) refresh(); }, 3000);
window.addEventListener('focus', refresh);

api('/api/state').then(s => { S = s; render(); }).catch(e => { $('#view').innerHTML = `<p class="loading">${esc(e.message)}</p>`; });

document.addEventListener('keydown', e => { const t = e.target; if (t.id === 'vnote' && e.key === 'Enter') { e.preventDefault(); document.querySelector('[data-vid="addnote"]')?.click(); return; } if (t.dataset?.urlfor !== undefined && e.key === 'Enter') { e.preventDefault(); addUrl(t.value, t.dataset.urlfor); } });
// 끌어다 놓기와 붙여넣기: 레퍼런스 화면은 보관함에, 작업 화면은 그 작업에 연결
const dropWork = () => cur === 'refs' ? '' : cur === 'work' ? (/^#work-([A-Za-z]+-\d+)$/.exec(location.hash) || [])[1]?.toUpperCase() : null;
document.addEventListener('dragover', e => { if (dropWork() === null) return; e.preventDefault(); const z = e.target.closest?.('[data-drop]') || $('[data-drop]'); document.querySelectorAll('.drop.over').forEach(x => x !== z && x.classList.remove('over')); z?.classList.add('over'); });
document.addEventListener('dragleave', e => { document.querySelectorAll('.drop.over').forEach(x => { if (!x.contains(e.relatedTarget)) x.classList.remove('over'); }); });
document.addEventListener('drop', e => {
  const work = dropWork(); if (work === null) return; e.preventDefault();
  document.querySelectorAll('.drop.over').forEach(x => x.classList.remove('over'));
  const dt = e.dataTransfer;
  if (e.target.closest?.('[data-vdrop]') && dt.files?.length) { uploadVideoFile(work, dt.files[0]); return; }
  if (e.target.closest?.('[data-imgdrop]') && dt.files?.length) { uploadImages(work, [...dt.files]); return; }
  if (dt.files?.length) { uploadFiles([...dt.files], work); return; }
  const u = dt.getData('text/uri-list') || dt.getData('text/plain'); if (u) addUrl(u.split('\n')[0], work);
});
document.addEventListener('paste', e => {
  const work = dropWork(); if (work === null) return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); uploadFiles(files, work); return; }
  const tg = e.target; if (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA') return;
  const txt = e.clipboardData?.getData('text/plain') || ''; if (/^https?:\/\//.test(txt.trim())) { e.preventDefault(); addUrl(txt, work); }
});

// 영상 재생 위치를 타임라인에 표시하고, 타임라인을 누르면 그 지점으로 이동
document.addEventListener('timeupdate', e => { if (e.target.id !== 'vp') return; const h = $('#vhead'), tl = $('#vtl'); if (h && tl) h.style.left = `${(e.target.currentTime / Number(tl.dataset.dur)) * 100}%`; }, true);
document.addEventListener('click', e => { const tl = e.target.closest?.('#vtl'); if (!tl) return; const r = tl.getBoundingClientRect(); const vp = $('#vp'); if (vp) vp.currentTime = (e.clientX - r.left) / r.width * Number(tl.dataset.dur); });
