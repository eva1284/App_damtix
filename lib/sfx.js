// 효과음 라이브러리 (data/sfx). 기본 효과음은 프로그램이 직접 만들어 넣고, 사용자가 가진 파일도 등록할 수 있다.
// Claude는 소리를 들을 수 없으니 이름(pop, ding…)으로 고르고, 사용자는 화면에서 미리 듣는다.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, load, save } from './store.js';
import { writeWav, RATE } from './audio.js';
import { sniff } from './files.js';

export const SFX_DIR = path.join(DATA_DIR, 'sfx');
const BUILTIN = [
  ['pop', '뾱 (팝)', '짧고 가벼운 팝. 무언가 튀어나오거나 나타날 때'],
  ['buzz', '진동음', '부르르 떨리는 낮은 진동. 기기가 켜지거나 진동할 때'],
  ['beep', '삐', '짧은 전자음. 버튼·표시등'],
  ['ding', '딩', '맑은 종소리. 완성·정답·알림'],
  ['wink', '윙크 팅', '높고 반짝이는 짧은 소리. 윙크·반짝임'],
  ['murmur', '웅얼웅얼 말소리', '알아들을 수 없는 작은 말소리. 캐릭터가 말하는 느낌'],
  ['whoosh', '휙', '바람 가르는 소리. 장면 전환·빠른 움직임']
];

// 간단한 합성 (스테레오 Float32)
function synth(name) {
  const sec = { pop: 0.12, buzz: 0.7, beep: 0.18, ding: 1.4, wink: 0.45, murmur: 1.3, whoosh: 0.6 }[name];
  const n = Math.round(sec * RATE), out = new Float32Array(n * 2);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
  // 대역 통과 필터 (주파수가 바뀌어도 되게 샘플마다 계수 계산)
  const bp = () => { let x1 = 0, x2 = 0, y1 = 0, y2 = 0; return (x, f, q) => { const w = 2 * Math.PI * f / RATE, a = Math.sin(w) / (2 * q), c = Math.cos(w); const b0 = a, b2 = -a, a0 = 1 + a, a1 = -2 * c, a2 = 1 - a; const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; }; };
  const f1 = bp(), f2 = bp();
  let ph = 0, env = 0, syl = 0, sylLen = 0, sylF = 500;
  for (let i = 0; i < n; i++) {
    const t = i / RATE, p = t / sec;
    let v = 0;
    if (name === 'pop') { const f = 900 * Math.pow(0.35, p); ph += 2 * Math.PI * f / RATE; v = Math.sin(ph) * Math.exp(-t * 45) * 0.9 + (i < 40 ? rnd() * 0.3 * (1 - i / 40) : 0); }
    if (name === 'buzz') { const am = 0.6 + 0.4 * Math.sin(2 * Math.PI * 28 * t); for (const h of [1, 3, 5, 7]) v += Math.sin(2 * Math.PI * 150 * h * t) / h; v *= 0.35 * am * Math.min(1, t / 0.03) * Math.min(1, (sec - t) / 0.08); }
    if (name === 'beep') v = Math.sin(2 * Math.PI * 1000 * t) * 0.45 * Math.min(1, t / 0.005) * Math.min(1, (sec - t) / 0.01);
    if (name === 'ding') { for (const [r, a] of [[1, 1], [2.0, 0.5], [2.76, 0.35], [5.4, 0.15]]) v += a * Math.sin(2 * Math.PI * 880 * r * t) * Math.exp(-t * (2.2 + r)); v *= 0.32 * Math.min(1, t / 0.002); }
    if (name === 'wink') { const f = 2600 * (1 + 0.08 * p); v = (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 1.5 * t)) * Math.exp(-t * 11) * 0.35 * Math.min(1, t / 0.002); }
    if (name === 'murmur') {
      if (i >= syl + sylLen) { syl = i; sylLen = Math.round((0.09 + 0.08 * Math.abs(rnd())) * RATE); sylF = 380 + 420 * Math.abs(rnd()); }
      const sp = (i - syl) / sylLen; env = Math.sin(Math.PI * sp);
      const voice = Math.sin(2 * Math.PI * (170 + 30 * Math.sin(2 * Math.PI * 3 * t)) * t);
      v = (f1(voice + 0.3 * rnd(), sylF, 4) * 1.6 + f2(voice, sylF * 2.6, 6) * 0.8) * env * 0.5 * Math.min(1, (sec - t) / 0.1);
    }
    if (name === 'whoosh') { const f = 300 * Math.pow(10, p); v = f1(rnd(), f, 1.2) * Math.sin(Math.PI * p) ** 2 * 1.4; }
    const pan = name === 'whoosh' ? p : 0.5; // 휙은 왼쪽에서 오른쪽으로
    out[i * 2] = v * Math.cos(pan * Math.PI / 2) * Math.SQRT2;
    out[i * 2 + 1] = v * Math.sin(pan * Math.PI / 2) * Math.SQRT2;
  }
  return out;
}

function meta() { try { return load('sfx'); } catch { return []; } }
export function ensureSfx() {
  fs.mkdirSync(SFX_DIR, { recursive: true });
  const list = meta();
  let changed = false;
  for (const [name, label, desc] of BUILTIN) {
    const file = `${name}.wav`;
    if (!fs.existsSync(path.join(SFX_DIR, file))) writeWav(path.join(SFX_DIR, file), synth(name));
    if (!list.some(s => s.name === name)) { list.push({ name, label, desc, file, builtin: true }); changed = true; }
  }
  if (changed || !fs.existsSync(path.join(DATA_DIR, 'sfx.json'))) save('sfx', list);
  return list;
}
export const listSfx = () => ensureSfx();
export function sfxFile(name) {
  const s = ensureSfx().find(x => x.name === String(name).toLowerCase());
  if (!s) throw new Error(`효과음 "${name}"이 라이브러리에 없어요. 있는 효과음: ${ensureSfx().map(x => x.name).join(', ')}`);
  return path.join(SFX_DIR, s.file);
}

// 사용자가 가진 효과음 등록 (wav, mp3, m4a, aiff…)
export function addSfx({ name, label, desc, filename, buffer }) {
  const n = String(name || path.parse(String(filename || '')).name).toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40);
  if (!n) throw new Error('효과음 이름을 넣어 주세요 (영문·숫자 권장).');
  if (!buffer?.length || buffer.length > 30 * 1024 * 1024) throw new Error('효과음 파일은 30MB 이하로 넣어 주세요.');
  const head = buffer.subarray(0, 16).toString('latin1');
  const audioLike = /^RIFF|^ID3|^fLaC|^OggS|^FORM/.test(head) || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) || head.slice(4, 8) === 'ftyp';
  if (!audioLike || sniff(buffer)?.kind === 'image') throw new Error('소리 파일(wav, mp3, m4a, aiff)만 넣을 수 있어요.');
  const list = ensureSfx();
  if (list.some(s => s.name === n && s.builtin)) throw new Error(`"${n}"은 기본 효과음 이름이에요. 다른 이름으로 넣어 주세요.`);
  const ext = (path.extname(String(filename || '')) || '.wav').toLowerCase().replace(/[^.a-z0-9]/g, '');
  const file = `user-${n}${ext}`;
  fs.writeFileSync(path.join(SFX_DIR, file), buffer);
  const entry = { name: n, label: String(label || n).trim().slice(0, 40), desc: String(desc || '').trim().slice(0, 200), file, builtin: false, at: new Date().toISOString() };
  save('sfx', [...list.filter(s => s.name !== n), entry]);
  return entry;
}
export function deleteSfx(name) {
  const list = ensureSfx();
  const s = list.find(x => x.name === name);
  if (!s) throw new Error('효과음을 찾을 수 없어요.');
  if (s.builtin) throw new Error('기본 효과음은 지울 수 없어요.');
  fs.rmSync(path.join(SFX_DIR, s.file), { force: true });
  save('sfx', list.filter(x => x !== s));
}
