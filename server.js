// contents controller 화면 서버. 내 Mac에서 돌고, 같은 Wi-Fi의 폰에서도 열 수 있다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { APP_DIR, DATA_DIR, ensureData, load, save, claudeLastSeen } from './lib/store.js';
import { DEFS, ACCOUNTS, applyChange, rollback, acceptProposal, rejectProposal, checkText } from './lib/rules.js';
import { IMAGE_EXT, migrateConfig, productImages, folderMap, listTopFolders, setFolders } from './lib/images.js';
import { spawn } from 'node:child_process';
import { listRefs, getRef, refPath, addFileRef, addUrlRef, updateRef, link as linkRef, unlink as unlinkRef, deleteRef, dropWorkLinks } from './lib/refs.js';
import { IMAGE_STAGE, requestDrafts, fixDrafts, pickDraft, savePins, fixResults, finalConfirm } from './lib/imagework.js';
import { finalsConfig, setFinals, driveCandidates } from './lib/finalize.js';
import { claudeQueue } from './lib/queue.js';
import { WORK_DIR, REF_DIR } from './lib/files.js';
import { TYPES as WORK_TYPES, STORES, CAPTION_STATUS, listWorks, createWork, updateWork, deleteWork, requestCaption, fixCaption, confirmCaption, reopenCaption } from './lib/works.js';

ensureData();
migrateConfig();
finalsConfig();
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.heic': 'image/heic', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.json': 'application/json' };

const isLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const codeHash = code => crypto.createHash('sha256').update(`cc:${code}`).digest('hex').slice(0, 32);
function hasAccess(req) {
  if (isLocal(req)) return true;
  const m = /(?:^|;\s*)cc_access=([a-f0-9]{32})/.exec(req.headers.cookie || '');
  return !!m && m[1] === codeHash(load('config').accessCode);
}

function lanUrls(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`);
  return out;
}

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const fail = (res, status, message) => send(res, status, { error: message });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 1_000_000) { reject(new Error('보낸 내용이 너무 커요.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('보낸 내용을 읽을 수 없어요.')); } });
    req.on('error', reject);
  });
}

// 레퍼런스 파일 올리기: 본문을 그대로 받는다 (최대 300MB)
function readRaw(req, max = 300 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > max) { reject(new Error('파일이 너무 커요 (300MB 초과).')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return fail(res, 404, '파일이 없어요.');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

function state(req) {
  const config = load('config');
  const local = isLocal(req);
  return {
    brand: load('brand'), products: load('products'), proposals: load('proposals'),
    history: load('history').map(({ snapshot, ...h }) => h),
    defs: DEFS, accounts: ACCOUNTS, types: WORK_TYPES, stores: STORES, captionStatus: CAPTION_STATUS,
    works: listWorks(), queue: claudeQueue(), refs: listRefs(), imageStage: IMAGE_STAGE,
    info: {
      local, imageRoot: config.imageRoot, imageRootExists: fs.existsSync(config.imageRoot), folders: folderMap(),
      finals: { ...finalsConfig(), driveExists: !!config.driveFolder && fs.existsSync(config.driveFolder), driveCandidates: local ? driveCandidates() : [] },
      claudeLastSeen: claudeLastSeen(), dataDir: local ? DATA_DIR : undefined,
      phone: local ? { urls: lanUrls(config.port), accessCode: config.accessCode } : undefined
    }
  };
}

const who = req => isLocal(req) ? '나 (Mac)' : '나 (폰)';
const LOGIN_PAGE = fs.readFileSync(path.join(PUBLIC_DIR, 'login.html'));

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/login' && req.method === 'POST') {
    const { code } = await readBody(req);
    if (String(code || '').trim() !== load('config').accessCode) return fail(res, 403, '접속 코드가 맞지 않아요. Mac 화면의 홈에서 코드를 확인해 주세요.');
    return send(res, 200, { ok: true }, undefined, { 'set-cookie': `cc_access=${codeHash(load('config').accessCode)}; Path=/; Max-Age=15552000; HttpOnly; SameSite=Lax` });
  }
  if (!hasAccess(req)) {
    if (p.startsWith('/api/') || p === '/file') return fail(res, 401, '접속 코드가 필요해요.');
    if (p === '/style.css' || p === '/assets/damtix-logo.svg') { /* 로그인 화면용 */ }
    else return send(res, 200, LOGIN_PAGE, TYPES['.html']);
  }

  if (p === '/api/state' && req.method === 'GET') return send(res, 200, state(req));
  if (p === '/api/change' && req.method === 'POST') {
    const b = await readBody(req);
    const r = applyChange({ key: b.key, draft: b.draft, reason: b.reason, by: who(req) });
    return send(res, 200, { ...r, state: state(req) });
  }
  if (p === '/api/rollback' && req.method === 'POST') {
    const b = await readBody(req);
    return send(res, 200, { ...rollback(b.historyId), state: state(req) });
  }
  let m = /^\/api\/proposals\/([\w-]+)\/(accept|reject)$/.exec(p);
  if (m && req.method === 'POST') {
    const r = m[2] === 'accept' ? acceptProposal(m[1]) : (rejectProposal(m[1]), {});
    return send(res, 200, { ...r, state: state(req) });
  }
  m = /^\/api\/products\/([A-Z0-9]+)\/images$/.exec(p);
  if (m && req.method === 'GET') {
    const r = productImages(m[1]);
    return send(res, 200, { ...r, folder: isLocal(req) ? r.folder : undefined, groups: r.groups.map(g => ({ name: g.name, files: g.files.map(({ abs, ...f }) => f) })) });
  }
  if (p === '/api/folders' && req.method === 'GET') return send(res, 200, { top: listTopFolders() });
  if (p === '/api/works' && req.method === 'POST') {
    const w = createWork(await readBody(req), who(req));
    return send(res, 200, { work: w, state: state(req) });
  }
  m = /^\/api\/works\/([A-Za-z]+-\d+)\/(update|delete|caption-request|caption-fix|caption-confirm|caption-reopen)$/.exec(p);
  if (m && req.method === 'POST') {
    const b = await readBody(req), id = m[1], by = who(req);
    const w = { update: () => updateWork(id, b, by), delete: () => { const r = deleteWork(id); dropWorkLinks(r.id); fs.rmSync(path.join(WORK_DIR, r.id), { recursive: true, force: true }); return r; }, 'caption-request': () => requestCaption(id, b.note, by), 'caption-fix': () => fixCaption(id, b.note, by), 'caption-confirm': () => confirmCaption(id, by), 'caption-reopen': () => reopenCaption(id, by) }[m[2]]();
    return send(res, 200, { work: w, state: state(req) });
  }
  // 이미지 제작 단계
  m = /^\/api\/works\/([A-Za-z]+-\d+)\/image-(request|fix-drafts|pick|pins|fix|final)$/.exec(p);
  if (m && req.method === 'POST') {
    const b = await readBody(req), id = m[1], by = who(req);
    const w = await ({ request: () => requestDrafts(id, b.note, by), 'fix-drafts': () => fixDrafts(id, b.note, by), pick: () => pickDraft(id, b.draftId, b.note, by), pins: () => savePins(id, b.resultId, b.pins, by), fix: () => fixResults(id, b.note, by), final: () => finalConfirm(id, b.resultIds, by) }[m[2]])();
    return send(res, 200, { work: w, state: state(req) });
  }
  // 레퍼런스
  if (p === '/api/refs/upload' && req.method === 'POST') {
    const buffer = await readRaw(req);
    const filename = decodeURIComponent(req.headers['x-filename'] || 'file');
    const work = req.headers['x-work'] ? String(req.headers['x-work']).toUpperCase() : undefined;
    return send(res, 200, { ref: addFileRef({ buffer, filename, work }), state: state(req) });
  }
  if (p === '/api/refs/url' && req.method === 'POST') {
    const b = await readBody(req);
    return send(res, 200, { ref: addUrlRef({ url: b.url, work: b.work }), state: state(req) });
  }
  m = /^\/api\/refs\/(REF-\d+)\/(update|link|unlink|delete)$/.exec(p);
  if (m && req.method === 'POST') {
    const b = await readBody(req), id = m[1];
    const r = { update: () => updateRef(id, b), link: () => linkRef(id, String(b.work).toUpperCase(), b.part || ''), unlink: () => unlinkRef(id, String(b.work).toUpperCase(), b.part), delete: () => deleteRef(id) }[m[2]]();
    return send(res, 200, { ref: r, state: state(req) });
  }
  if (p === '/api/open' && req.method === 'POST') {
    if (!isLocal(req) || process.platform !== 'darwin') return fail(res, 403, '폴더 열기는 Mac에서만 돼요.');
    const b = await readBody(req);
    const w = listWorks().find(x => x.id === String(b.id).toUpperCase());
    const target = b.which === 'drive' ? w?.image?.final?.drive?.path : w?.image?.final?.folder;
    if (!target || !fs.existsSync(target)) return fail(res, 404, '폴더를 찾을 수 없어요.');
    spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
    return send(res, 200, { ok: true });
  }
  if (p === '/api/check' && req.method === 'POST') return send(res, 200, checkText(await readBody(req)));
  if (p === '/api/config' && req.method === 'POST') {
    if (!isLocal(req)) return fail(res, 403, '설정은 Mac에서만 바꿀 수 있어요.');
    const b = await readBody(req);
    const config = load('config');
    if (typeof b.imageRoot === 'string' && b.imageRoot.trim()) config.imageRoot = b.imageRoot.trim().replace(/^~(?=\/|$)/, os.homedir());
    save('config', config);
    if (b.productFolders || b.otherFolders) setFolders(b);
    if (b.finalsFolder !== undefined || b.driveFolder !== undefined) setFinals(b);
    return send(res, 200, { state: state(req) });
  }
  if (p === '/file' && req.method === 'GET') {
    const root = path.resolve(load('config').imageRoot);
    const abs = path.resolve(root, url.searchParams.get('rel') || '');
    if (!abs.startsWith(root + path.sep) || !IMAGE_EXT.has(path.extname(abs).toLowerCase())) return fail(res, 403, '이 파일은 열 수 없어요.');
    return sendFile(res, abs);
  }
  if (p === '/ref-file' && req.method === 'GET') {
    let r; try { r = getRef(url.searchParams.get('id') || ''); } catch { return fail(res, 404, '파일이 없어요.'); }
    return r.file ? sendFile(res, path.join(REF_DIR, r.file)) : fail(res, 404, '파일이 없는 레퍼런스예요.');
  }
  if (p === '/work-file' && req.method === 'GET') {
    const id = String(url.searchParams.get('id') || '').toUpperCase(), f = url.searchParams.get('f') || '';
    if (!/^[A-Z]+-\d+$/.test(id) || !/^[\w.-]+$/.test(f)) return fail(res, 400, '잘못된 파일이에요.');
    const file = path.join(WORK_DIR, id, f);
    if (f.endsWith('.svg')) { res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'"); }
    return sendFile(res, file);
  }
  if (p.startsWith('/api/')) return fail(res, 404, '없는 기능이에요.');

  // 화면 파일
  if (p === '/assets/damtix-logo.svg') return sendFile(res, path.join(APP_DIR, 'assets', 'damtix-logo.svg'));
  const rel = p === '/' ? 'index.html' : p.slice(1);
  const abs = path.resolve(PUBLIC_DIR, rel);
  if (!abs.startsWith(PUBLIC_DIR + path.sep)) return fail(res, 403, '열 수 없어요.');
  return sendFile(res, abs);
}

const config = load('config');
const port = Number(process.env.PORT) || config.port || 4321;
const server = http.createServer((req, res) => {
  route(req, res).catch(e => fail(res, 400, e.message));
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.log(`\ncontents controller가 이미 켜져 있어요: http://localhost:${port}\n`); process.exit(0); }
  throw e;
});
server.listen(port, '0.0.0.0', () => {
  console.log(`\n  contents controller 실행 중\n\n  Mac:  http://localhost:${port}`);
  for (const u of lanUrls(port)) console.log(`  폰:   ${u}  (같은 Wi-Fi, 접속 코드 ${config.accessCode})`);
  // 자동 실행(launchd)으로 켜졌으면 창이 없으니 다른 안내를 남긴다
  console.log(process.env.XPC_SERVICE_NAME === 'com.damtix.contents-controller' ? `\n  자동 실행 중이에요. Mac을 켜면 알아서 켜져요.\n` : `\n  이 창을 닫으면 프로그램이 꺼져요.\n`);
});
