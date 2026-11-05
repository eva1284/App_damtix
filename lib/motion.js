// 모션 그래픽: 있는 영상(촬영본·AI 영상·이미지) 위에 Claude가 코드(HTML)로 짠 글자 애니메이션을 얹어 영상 파일로 만든다.
// Claude는 코드와 나라별 글자만 보내고, 영상 파일은 내 Mac의 크롬(화면에 안 보이게)과 ffmpeg가 만든다 (토큰 안 씀).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { APP_DIR, load, save } from './store.js';
import { workDir, sniff, download, REF_DIR } from './files.js';
import { probe } from './media.js';
import { FONT_DIR, listFaces, syncFonts } from './fonts.js';
import { subtitleStyle } from './subtitles.js';
import { ACCOUNTS, checkText } from './rules.js';

const FFMPEG = process.env.FFMPEG_BIN || ffmpegPath;
export const FPS = 30;
const MAX_HTML = 1.5 * 1024 * 1024;
const KEY_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const LANG = { GLOBAL: 'en', EU: 'fr', JP: 'ja', KR: 'ko' };

// Claude가 코드를 쓸 때 지킬 약속. get_motion_guide 도구로 Claude에게 보여 준다.
export const MOTION_GUIDE = `모션 그래픽 코드 약속 (contents controller가 이 약속대로 영상으로 만든다)
1. html은 한 장짜리 HTML. 화면 크기는 width×height(기본 1080×1920) 그대로 px로 짠다. 바깥 파일·스크립트 없이 CSS와 JS를 안에 넣는다.
2. 배경은 투명. 아래에 clips(영상·이미지)가 깔린다. 글자만 얹는 구간은 배경을 칠하지 않고, 꽉 찬 카드 장면(제목·엔딩)만 그 요소에 배경색을 준다.
3. 움직임은 CSS 애니메이션(@keyframes)이나 element.animate()로 만들고, 시작 시점은 animation-delay로 정한다(0초 = 영상 시작). animation-fill-mode: both를 꼭 쓴다. setTimeout·setInterval·Date.now·requestAnimationFrame으로 시간을 재지 않는다.
   GSAP처럼 직접 시간을 다루려면 window.seek = (초) => {...} 를 만들어 두면 프레임마다 불러 준다.
4. 나라마다 바뀌는 글자는 {{키}} 로 쓰고 texts에 계정별로 넣는다: { GLOBAL: { title: { text: "Winners", back: "당첨자" } }, JP: {...}, EU: {...} }. back은 원문만 보고 옮긴 한국어 역번역. 줄바꿈은 \\n.
   제품이 팔리는 모든 계정의 texts가 필요하다. 계정마다 글꼴이 바뀌도록 font-family: var(--font) 를 쓴다 (GLOBAL·EU: Epilogue, JP: Noto Sans JP, 브랜드 자막 디자인 설정을 따른다). 'Epilogue', 'Noto Sans JP', 'Pretendard' 를 직접 써도 된다.
5. 이미지·로고는 /asset/ 주소로 넣는다: /asset/logo (담틱스 로고 검정 SVG, 흰색은 CSS filter: invert(1)), /asset/REF-003 (레퍼런스), /asset/IMG-002 (이미지 작업의 최종 이미지, 두 번째는 /asset/IMG-002/2), /asset/file?p=<절대 경로, 이미지정리 폴더 안> (get_product의 기준 이미지).
6. clips: [{ src, at, from, duration, fit, volume, muted }]. src는 "video:V2"(이 작업에 올라온 영상), "REF-003", "IMG-002", "VID-004"(다른 영상 작업의 최신 영상), https 주소(Higgsfield 결과 등), Mac 파일 절대 경로. at=타임라인 시작 초, from=원본에서 시작할 초, duration=길이(초), fit=cover|contain.
   music: { src, volume } 은 배경 음악(선택). 클립 사이 빈 곳은 background 색(기본 #000000)이 보인다.
7. 고칠 때는 html 전체 대신 html_edits: [{ find, replace }] 로 바뀐 부분만 보낸다(토큰 절약). find는 지금 코드에 한 번만 나와야 한다. texts도 바뀐 키만 보내면 합쳐진다.
8. 나라별 자막(대사)은 따로 submit_subtitles로 쓴다. 글자 애니메이션은 자막 자리(화면 위에서 약 55~63%)를 피해서 배치한다. 화면 아래 35%는 인스타그램 버튼·설명이 덮는다.`;

/* ---------- 크롬 찾기 ---------- */
export function findBrowser() {
  const home = os.homedir();
  const list = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/opt/pw-browsers/chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ].filter(Boolean);
  return list.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

/* ---------- 받은 구성 정리 ---------- */
const text = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const nonneg = (v, name, d = 0) => { if (v === undefined || v === null || v === '') return d; const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error(`${name}이(가) 잘못됐어요.`); return Math.round(n * 1000) / 1000; };

export function soldAccounts(w) {
  const p = load('products').find(x => x.code === w.product);
  return Object.keys(ACCOUNTS).filter(a => p?.markets[ACCOUNTS[a].market]);
}

export const keysOf = html => [...new Set([...String(html).matchAll(KEY_RE)].map(m => m[1]))];

function applyEdits(html, edits) {
  if (!Array.isArray(edits) || !edits.length) throw new Error('html_edits가 비어 있어요.');
  let out = html;
  edits.forEach((e, i) => {
    const find = String(e?.find ?? '');
    if (!find) throw new Error(`html_edits ${i + 1}번의 find가 비어 있어요.`);
    const n = out.split(find).length - 1;
    if (n !== 1) throw new Error(`html_edits ${i + 1}번: find가 지금 코드에 ${n}번 나와요. 한 번만 나오는 부분으로 골라 주세요.`);
    out = out.replace(find, () => String(e.replace ?? ''));
  });
  return out;
}

// input: Claude가 보낸 것, prev: 지금 구성(고칠 때), base: 템플릿
export function buildComposition(w, input, prev, base) {
  const start = prev || base || {};
  let html;
  if (input.html !== undefined && input.html !== null && input.html !== '') html = String(input.html);
  else if (input.html_edits) { if (!start.html) throw new Error('고칠 코드가 없어요. 처음에는 html 전체를 보내 주세요.'); html = applyEdits(start.html, input.html_edits); }
  else if (start.html) html = start.html;
  else throw new Error('html(모션 그래픽 코드)을 보내 주세요.');
  if (Buffer.byteLength(html) > MAX_HTML) throw new Error('코드가 너무 길어요 (1.5MB 이하).');
  const width = Math.round(nonneg(input.width, '가로', start.width || 1080)), height = Math.round(nonneg(input.height, '세로', start.height || 1920));
  if (width < 240 || height < 240 || width > 2160 || height > 3840 || width % 2 || height % 2) throw new Error('화면 크기는 240~2160 사이 짝수로 넣어 주세요 (예: 1080×1920).');
  const duration = nonneg(input.duration, '길이', start.duration || 0);
  if (duration < 0.5 || duration > 180) throw new Error('영상 길이(duration)는 0.5~180초로 넣어 주세요.');
  const background = text(input.background ?? start.background ?? '#000000', 20);
  if (!/^#[0-9a-fA-F]{6}$/.test(background)) throw new Error('background는 #000000 같은 색 코드로 넣어 주세요.');
  const clipsIn = input.clips ?? start.clips ?? [];
  if (!Array.isArray(clipsIn) || clipsIn.length > 40) throw new Error('clips는 40개 이하 목록으로 보내 주세요.');
  const clips = clipsIn.map((c, i) => {
    const src = text(c?.src, 2000);
    if (!src) throw new Error(`clips ${i + 1}번의 src가 비어 있어요.`);
    const at = nonneg(c.at, `clips ${i + 1}번 at`);
    if (at >= duration) throw new Error(`clips ${i + 1}번이 영상 길이(${duration}초) 뒤에서 시작해요.`);
    const fit = c.fit === 'contain' ? 'contain' : 'cover';
    const volume = c.volume === undefined ? 1 : Math.min(2, nonneg(c.volume, `clips ${i + 1}번 volume`));
    return { src, at, from: nonneg(c.from, `clips ${i + 1}번 from`), duration: c.duration === undefined || c.duration === null ? null : nonneg(c.duration, `clips ${i + 1}번 duration`), fit, volume, muted: c.muted === true };
  });
  const mIn = input.music === undefined ? start.music : input.music;
  const music = mIn && mIn.src ? { src: text(mIn.src, 2000), volume: mIn.volume === undefined ? 0.6 : Math.min(2, nonneg(mIn.volume, 'music volume')) } : null;
  // 나라별 글자: 바뀐 키만 보내도 합친다
  const texts = JSON.parse(JSON.stringify(start.texts || {}));
  if (input.texts) {
    if (typeof input.texts !== 'object') throw new Error('texts 형식이 잘못됐어요.');
    for (const [acc, kv] of Object.entries(input.texts)) {
      const a = acc.toUpperCase();
      if (!ACCOUNTS[a]) throw new Error(`texts의 ${acc}는 계정(GLOBAL, JP, EU)이 아니에요.`);
      texts[a] = texts[a] || {};
      for (const [k, v] of Object.entries(kv || {})) {
        if (!/^[A-Za-z0-9_]+$/.test(k)) throw new Error(`texts 키 "${k}"는 영문·숫자·_만 쓸 수 있어요.`);
        if (v === null) { delete texts[a][k]; continue; }
        const t = text(typeof v === 'string' ? v : v?.text, 600), back = text(typeof v === 'string' ? '' : v?.back, 600);
        if (!t) throw new Error(`texts ${a}.${k}가 비어 있어요.`);
        if (!back) throw new Error(`texts ${a}.${k}에 한국어 역번역(back)이 없어요. 사용자는 한국어로만 검수해요.`);
        texts[a][k] = { text: t, back };
      }
    }
  }
  const keys = keysOf(html);
  const need = soldAccounts(w);
  for (const a of need) {
    const miss = keys.filter(k => !texts[a]?.[k]);
    if (miss.length) throw new Error(`${a} 글자가 빠졌어요: ${miss.join(', ')}. 제품이 팔리는 모든 계정(${need.join(', ')})의 texts가 필요해요.`);
  }
  // 브랜드 기준 검사 (막아야 할 표현이 있으면 저장하지 않는다)
  const checks = {};
  for (const a of need) {
    const all = keys.map(k => texts[a][k].text).join('\n');
    if (!all) continue;
    const c = checkText({ text: all, account: a, product: w.product });
    const issues = c.issues.filter(i => i.type !== 'jp_name_missing');
    if (issues.some(i => i.level === 'block')) throw new Error(`${a} 글자가 브랜드 기준에 맞지 않아 저장하지 않았어요:\n${issues.filter(i => i.level === 'block').map(i => `- ${i.message}`).join('\n')}`);
    checks[a] = { ok: true, issues };
  }
  return { width, height, duration, background, clips, music, html, texts, keys, checks };
}

/* ---------- 템플릿 ---------- */
export function listTemplates() { try { return load('motion-templates'); } catch { return []; } }
export function getTemplate(id) {
  const t = listTemplates().find(x => x.id === String(id).toUpperCase());
  if (!t) throw new Error(`템플릿 ${id}를 찾을 수 없어요.`);
  return t;
}
export function saveTemplate({ name, note, comp, from }) {
  const n = text(name, 60);
  if (!n) throw new Error('템플릿 이름을 넣어 주세요.');
  const list = listTemplates();
  const id = `TPL-${String(Math.max(0, ...list.map(t => Number(t.id.split('-')[1]) || 0)) + 1).padStart(3, '0')}`;
  const t = { id, name: n, note: text(note, 300), from: from || '', at: new Date().toISOString(), width: comp.width, height: comp.height, duration: comp.duration, background: comp.background, html: comp.html, texts: comp.texts, keys: comp.keys, clips: comp.clips.map(c => ({ ...c, src: '' })) };
  list.unshift(t);
  save('motion-templates', list);
  return t;
}
export function deleteTemplate(id) {
  const list = listTemplates();
  if (!list.some(t => t.id === id)) throw new Error('템플릿을 찾을 수 없어요.');
  save('motion-templates', list.filter(t => t.id !== id));
}

/* ---------- 재료(영상·이미지) 찾기 ---------- */
const insideDir = (p, dir) => { const r = path.relative(path.resolve(dir), path.resolve(p)); return r && !r.startsWith('..') && !path.isAbsolute(r); };
function allowedFile(p) {
  const c = load('config');
  const abs = path.resolve(String(p).replace(/^~(?=\/|$)/, os.homedir()));
  if (![c.imageRoot, REF_DIR, path.join(APP_DIR, 'assets')].some(d => d && insideDir(abs, d)) && !insideDir(abs, path.dirname(workDir('X')))) throw new Error(`이 위치의 파일은 쓸 수 없어요 (이미지정리 폴더 안의 파일만): ${p}`);
  if (!fs.existsSync(abs)) throw new Error(`파일을 찾을 수 없어요: ${p}`);
  return abs;
}

function imageWorkFile(id, nth = 1) {
  const iw = load('works').find(x => x.id === id);
  if (!iw || iw.type !== 'image') throw new Error(`이미지 작업 ${id}를 찾을 수 없어요.`);
  const f = iw.image?.final?.files?.[nth - 1];
  if (f) return path.join(iw.image.final.folder, f.name);
  const r = iw.image?.results?.[nth - 1];
  if (r) return path.join(workDir(id), r.upscaled || r.file);
  throw new Error(`${id}에 아직 이미지가 없어요.`);
}

// 재료 주소 → Mac 안의 파일 경로
export async function resolveSrc(src, w) {
  const s = String(src).trim();
  let m;
  if ((m = /^video:(V\d+)$/i.exec(s))) {
    const v = w.video?.videos.find(x => x.id === m[1].toUpperCase());
    if (!v) throw new Error(`이 작업에 ${m[1]} 영상이 없어요.`);
    return path.join(workDir(w.id), v.file);
  }
  if ((m = /^(REF-\d+)$/i.exec(s))) {
    const r = load('refs').find(x => x.id === m[1].toUpperCase());
    if (!r?.file) throw new Error(`${m[1]}에는 파일이 없어요 (링크만 있는 레퍼런스).`);
    return path.join(REF_DIR, r.file);
  }
  if ((m = /^(IMG-\d+)(?:\/(\d+))?$/i.exec(s))) return imageWorkFile(m[1].toUpperCase(), Number(m[2] || 1));
  if ((m = /^(VID-\d+)$/i.exec(s))) {
    const vw = load('works').find(x => x.id === m[1].toUpperCase());
    const v = vw?.video?.videos?.[0] || vw?.video?.storyHistory?.find(h => h.videos?.length)?.videos[0];
    if (!v) throw new Error(`${m[1]}에 영상이 없어요.`);
    return path.join(workDir(vw.id), v.file);
  }
  if (/^https?:\/\//i.test(s)) {
    const dir = path.join(workDir(w.id), 'assets'); fs.mkdirSync(dir, { recursive: true });
    const hash = crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
    const hit = fs.readdirSync(dir).find(f => f.startsWith(hash));
    if (hit) return path.join(dir, hit);
    const buf = await download(s, 1024 * 1024 * 1024);
    const k = sniff(buf.subarray(0, 16));
    if (!k) throw new Error(`영상·이미지 파일이 아니에요: ${s}`);
    const file = path.join(dir, `${hash}${k.ext}`);
    fs.writeFileSync(file, buf);
    return file;
  }
  if (s.startsWith('/') || s.startsWith('~')) { // Mac 안의 영상·이미지 파일 (Higgsfield에서 받은 파일 등). 영상·이미지인지는 만들 때 확인한다
    const abs = path.resolve(s.replace(/^~(?=\/|$)/, os.homedir()));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(`파일을 찾을 수 없어요: ${s}`);
    return abs;
  }
  throw new Error(`재료 주소를 알 수 없어요: ${s}`);
}

/* ---------- HTML 채우기 ---------- */
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function fillHtml(comp, account) {
  const style = subtitleStyle();
  const texts = comp.texts[account] || {};
  const body = comp.html.replace(KEY_RE, (_, k) => texts[k] ? escHtml(texts[k].text).replace(/\n/g, '<br>') : '');
  const faces = listFaces().filter(f => !f.italic).map(f => `@font-face{font-family:'${f.family.replace(/'/g, '')}';src:url('/__fonts/${encodeURIComponent(f.file)}');font-weight:${f.weight};font-style:normal;font-display:block}`).join('\n');
  const font = style.fonts[account] || style.fonts.GLOBAL;
  const head = `<meta charset="utf-8"><style>${faces}
:root{--font:'${font}','Noto Sans JP','Pretendard',sans-serif;--font-latin:'${style.fonts.GLOBAL}';--font-jp:'${style.fonts.JP}';--font-ko:'${style.fonts.KR}';--w:${comp.width}px;--h:${comp.height}px}
html,body{margin:0;width:${comp.width}px;height:${comp.height}px;overflow:hidden;background:transparent}body{font-family:var(--font);-webkit-font-smoothing:antialiased}</style>`;
  const lang = LANG[account] || 'en';
  if (/<head[^>]*>/i.test(body)) return body.replace(/<html(\s|>)/i, `<html lang="${lang}"$1`).replace(/<head[^>]*>/i, m => `${m}${head}`);
  return `<!doctype html><html lang="${lang}"><head>${head}</head><body>${body}</body></html>`;
}

/* ---------- 영상으로 만들기 ---------- */
let browserP = null;
async function browser() {
  const exe = findBrowser();
  if (!exe) throw new Error('모션 그래픽을 만들려면 Mac에 Google Chrome이 있어야 해요. https://www.google.com/chrome 에서 설치해 주세요.');
  if (browserP) { try { const b = await browserP; if (b.isConnected()) return b; } catch { /* 다시 연다 */ } }
  const { chromium } = await import('playwright-core');
  browserP = chromium.launch({ executablePath: exe, headless: true, args: ['--hide-scrollbars', '--mute-audio', '--font-render-hinting=none'] });
  const b = await browserP;
  b.on('disconnected', () => { browserP = null; });
  return b;
}
export async function closeBrowser() { if (browserP) { const b = await browserP.catch(() => null); browserP = null; await b?.close().catch(() => {}); } }

const TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };

async function assetFile(u, w) {
  const p = decodeURIComponent(u.pathname.slice('/asset/'.length));
  if (p === 'logo') return path.join(APP_DIR, 'assets', 'damtix-logo.svg');
  if (p === 'file') return allowedFile(u.searchParams.get('p') || '');
  return resolveSrc(p.replace(/\/(\d+)$/, '/$1'), w);
}

async function openPage(comp, account, w) {
  syncFonts();
  const b = await browser();
  const ctx = await b.newContext({ viewport: { width: comp.width, height: comp.height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const html = fillHtml(comp, account);
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.host !== 'motion.local') return route.continue();
    try {
      if (u.pathname === '/' || u.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
      if (u.pathname.startsWith('/__fonts/')) return route.fulfill({ status: 200, path: path.join(FONT_DIR, path.basename(decodeURIComponent(u.pathname.slice(9)))), contentType: TYPES[path.extname(u.pathname).toLowerCase()] });
      if (u.pathname.startsWith('/asset/')) { const f = await assetFile(u, w); return route.fulfill({ status: 200, path: f, contentType: TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream' }); }
      return route.fulfill({ status: 404, body: 'not found' });
    } catch (e) { errors.push(`${u.pathname}: ${e.message}`); return route.fulfill({ status: 404, body: e.message }); }
  });
  await page.goto('http://motion.local/', { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  if (errors.length) { await ctx.close(); throw new Error(`코드 오류: ${errors.slice(0, 3).join(' / ')}`); }
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const shot = async t => {
    await page.evaluate(async t => {
      if (typeof window.seek === 'function') await window.seek(t);
      for (const a of document.getAnimations()) { a.pause(); a.currentTime = t * 1000; }
      await new Promise(r => requestAnimationFrame(() => r()));
    }, t);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
    return Buffer.from(data, 'base64');
  };
  return { shot, errors, close: () => ctx.close() };
}

// 밑에 깔리는 영상 만들기: 클립을 타임라인 순서로 같은 형식의 조각으로 만든 뒤 이어 붙인다.
// (여러 영상을 한 번에 겹치는 방식은 ffmpeg가 멈추는 경우가 있어 조각으로 나눈다)
function ffRun(args, label = '영상 만들기') {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => p.kill('SIGKILL'), 20 * 60 * 1000);
    p.on('error', reject);
    p.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${label} 실패: ${err.trim().split('\n').slice(-3).join(' ') || `코드 ${code}`}`)); });
  });
}

async function timeline(comp, w) {
  const D = comp.duration;
  const items = [];
  for (const [i, c] of comp.clips.entries()) {
    const file = await resolveSrc(c.src, w);
    const head = Buffer.alloc(16); const fd = fs.openSync(file, 'r'); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd);
    const kind = sniff(head)?.kind;
    if (kind !== 'video' && kind !== 'image') throw new Error(`clips ${i + 1}번은 영상이나 이미지가 아니에요.`);
    let len = c.duration ?? D - c.at, audio = false;
    if (kind === 'video') {
      const info = await probe(file);
      if (c.from >= info.duration) throw new Error(`clips ${i + 1}번 from(${c.from}초)이 원본 길이(${info.duration.toFixed(1)}초)보다 길어요.`);
      len = Math.min(len, info.duration - c.from);
      audio = info.audio && !c.muted && c.volume > 0;
    }
    items.push({ ...c, file, kind, audio, start: c.at, end: Math.min(D, c.at + len) });
  }
  items.sort((a, b) => a.start - b.start);
  // 겹치면 뒤 클립이 이긴다 (앞 클립을 거기서 자른다). 빈 곳은 배경색.
  const segs = [];
  let cur = 0;
  items.forEach((it, i) => {
    const end = Math.min(it.end, items[i + 1]?.start ?? D);
    if (it.start > cur + 1e-3) segs.push({ kind: 'gap', start: cur, end: it.start });
    const start = Math.max(it.start, cur);
    if (end - start > 1e-3) segs.push({ ...it, from: it.from + (start - it.start), start, end });
    cur = Math.max(cur, end);
  });
  if (cur < D - 1e-3) segs.push({ kind: 'gap', start: cur, end: D });
  return segs;
}

async function buildBase(comp, w, dir) {
  const W = comp.width, H = comp.height, bg = comp.background.replace('#', '0x');
  const segs = await timeline(comp, w);
  const files = [];
  let frameCur = 0;
  for (const [i, s] of segs.entries()) {
    const endFrame = Math.round(s.end * FPS), n = endFrame - frameCur;
    if (n <= 0) continue;
    frameCur = endFrame;
    const dur = (n / FPS).toFixed(4), out = path.join(dir, `seg${String(i).padStart(3, '0')}.mp4`);
    const fit = s.fit === 'contain' ? `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${bg}` : `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
    let input, vf, af;
    if (s.kind === 'gap') { input = ['-f', 'lavfi', '-i', `color=c=${bg}:s=${W}x${H}:r=${FPS}`]; vf = '[0:v]format=yuv420p[v]'; }
    else if (s.kind === 'image') { input = ['-loop', '1', '-framerate', String(FPS), '-i', s.file]; vf = `[0:v]${fit},setsar=1,format=yuv420p[v]`; }
    else { input = ['-ss', String(s.from), '-i', s.file]; vf = `[0:v]${fit},setsar=1,fps=${FPS},format=yuv420p[v]`; }
    if (s.kind === 'video' && s.audio) af = `[0:a]aresample=48000,aformat=channel_layouts=stereo,volume=${s.volume},apad[a]`;
    else { input.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'); af = '[1:a]anull[a]'; }
    await ffRun([...input, '-filter_complex', `${vf};${af}`, '-map', '[v]', '-map', '[a]', '-frames:v', String(n), '-t', dur, '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-g', String(FPS), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-f', 'mp4', out], '밑 영상 만들기');
    files.push(out);
  }
  const list = path.join(dir, 'list.txt');
  fs.writeFileSync(list, files.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  return list; // 이어 붙이기는 글자 층을 얹을 때 함께 한다 (스트림 복사는 일부 ffmpeg에서 멈춘다)
}

// 글자 층을 얹는 ffmpeg 명령 (base 위에 overlayArgs로 들어오는 투명한 그림들)
async function plan(comp, w, dir, overlayArgs) {
  const list = await buildBase(comp, w, dir);
  const args = ['-f', 'concat', '-safe', '0', '-i', list];
  let idx = 1, music = null;
  if (comp.music) { args.push('-stream_loop', '-1', '-i', await resolveSrc(comp.music.src, w)); music = idx++; }
  args.push(...overlayArgs);
  const ov = idx;
  const filters = [`[${ov}:v]format=rgba[ov]`, `[0:v][ov]overlay=format=auto:eof_action=pass,format=yuv420p[vout]`];
  if (music !== null) filters.push(`[${music}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${comp.music.volume}[am]`, `[0:a][am]amix=inputs=2:normalize=0:duration=first[aout]`);
  else filters.push('[0:a]anull[aout]');
  return { args, filter: filters.join(';') };
}

// 영상 하나 만들기. onProgress(done, total)
export async function renderMotion(comp, w, account, out, { onProgress, crf = 18 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-motion-'));
  try { return await renderInto(comp, w, account, out, dir, { onProgress, crf }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
async function renderInto(comp, w, account, out, dir, { onProgress, crf }) {
  const { args, filter } = await plan(comp, w, dir, ['-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', 'pipe:0']);
  const total = Math.max(1, Math.round(comp.duration * FPS));
  const page = await openPage(comp, account, w);
  const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args, '-filter_complex', filter, '-map', '[vout]', '-map', '[aout]', '-t', String(comp.duration), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  ff.stderr.on('data', d => { stderr += d; });
  const done = new Promise((resolve, reject) => {
    ff.on('error', reject);
    ff.on('close', code => code === 0 ? resolve() : reject(new Error(`영상 만들기 실패: ${stderr.trim().split('\n').slice(-3).join(' ')}`)));
  });
  done.catch(() => {});
  let stdinErr = null;
  ff.stdin.on('error', e => { stdinErr = e; });
  try {
    for (let f = 0; f < total; f++) {
      if (stdinErr || ff.exitCode !== null) break;
      const png = await page.shot(f / FPS);
      if (page.errors.length) throw new Error(`코드 오류 (${(f / FPS).toFixed(1)}초): ${page.errors.slice(0, 2).join(' / ')}`);
      if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
      if (onProgress && (f % 15 === 0 || f === total - 1)) onProgress(f + 1, total);
    }
  } catch (e) { ff.kill('SIGKILL'); await done.catch(() => {}); fs.rmSync(out, { force: true }); throw e; }
  finally { ff.stdin.end(); await page.close().catch(() => {}); }
  await done;
  if (!fs.existsSync(out) || !fs.statSync(out).size) throw new Error('영상을 만들지 못했어요.');
  return probe(out);
}

// 한 장면만 그림으로 (Claude가 확인할 때, 화면 미리보기)
export async function renderStill(comp, w, account, t, width = 540) {
  t = Math.max(0, Math.min(Number(t) || 0, comp.duration - 1 / FPS));
  const tmp = path.join(os.tmpdir(), `cc-still-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const page = await openPage(comp, account, w);
  try {
    fs.writeFileSync(`${tmp}.png`, await page.shot(t));
    fs.mkdirSync(tmp, { recursive: true });
    const { args, filter } = await plan({ ...comp, duration: Math.min(comp.duration, t + 2 / FPS) }, w, tmp, ['-loop', '1', '-framerate', String(FPS), '-i', `${tmp}.png`]);
    await new Promise((resolve, reject) => {
      const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args, '-filter_complex', `${filter.split(';').filter(f => !/\[(aout|am)\]/.test(f)).join(';')};[vout]scale=${width}:-2[small]`, '-map', '[small]', '-ss', String(t), '-frames:v', '1', '-q:v', '4', `${tmp}.jpg`], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = ''; p.stderr.on('data', d => { err += d; });
      p.on('close', code => code === 0 && fs.existsSync(`${tmp}.jpg`) ? resolve() : reject(new Error(`장면 그리기 실패: ${err.trim().split('\n').slice(-2).join(' ')}`)));
    });
    return fs.readFileSync(`${tmp}.jpg`);
  } finally {
    await page.close().catch(() => {});
    for (const e of ['.png', '.jpg', '']) fs.rmSync(tmp + e, { recursive: true, force: true });
  }
}
