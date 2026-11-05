// 자막 디자인: 브랜드 기준의 "자막 디자인"을 영상 자막(ASS)으로 바꾸고, 장면 밝기에 맞춰 흰/검정 글씨를 고른다.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { load } from './store.js';
import { pickFace, FONT_DIR, syncFonts } from './fonts.js';

const FFMPEG = process.env.FFMPEG_BIN || ffmpegPath;
export const SUB_DEFAULT = { font_GLOBAL: 'Epilogue', font_EU: 'Epilogue', font_JP: 'Noto Sans JP', font_KR: 'Pretendard', weight: '600', size: '42', position: '63', color: 'auto', edge: 'outline' };
export const COLOR_MODES = { auto: '자동 (장면 밝기 보고)', white: '흰 글씨', black: '검정 글씨' };
// 인스타그램 릴스에서 화면이 덮는 곳: 위 약 270px, 아래 1480px부터 (1080×1920 기준). 글자는 y 300~1480 안에.
export const SAFE_TOP = 0.14, SAFE_BOTTOM = 0.77;
export const TEXT_WIDTH = 0.58; // 자막 폭은 화면의 58% 이내
const TRACK = { GLOBAL: -0.04, EU: -0.04, KR: -0.03, JP: 0.01 }; // 자간 (em)
const CJK_ACC = new Set(['JP']);
const BRIGHT = 150; // 자막 자리 평균 밝기(0~255)가 이 이상이면 검정 글씨

export function subtitleStyle(override) {
  const s = { ...SUB_DEFAULT, ...(load('brand').subtitle || {}), ...(override || {}) };
  return { fonts: { GLOBAL: s.font_GLOBAL, EU: s.font_EU, JP: s.font_JP, KR: s.font_KR }, weight: Number(s.weight) || 600, size: Number(s.size) || 50, position: Number(s.position) || 63, color: s.color in COLOR_MODES ? s.color : 'auto', edge: s.edge || 'outline' };
}

// 한 줄에 들어가는 글자 수 (가로 1080 기준, 양옆 여백 90px). Claude에게 자막 길이 기준으로 알려 준다.
const textPx = () => Math.round(1080 * TEXT_WIDTH);
export function lineLimit(style, acc) {
  const cw = style.size * (CJK_ACC.has(acc) ? 1.0 + (TRACK[acc] || 0) : 0.52 + (TRACK[acc] || 0));
  return Math.max(6, Math.floor(textPx() / cw));
}

// 띄어쓰기가 없는 일본어는 자막 프로그램이 줄을 못 바꾸므로 여기서 문절 단위로 나눈다:
// 줄 길이를 고르게 맞추되, 구두점·조사 뒤에서 끊는 자리를 고른다
const BREAK_AFTER = /[、。，．！？!?」』）)・…\s]|[はがをにでとのもへやねよか]$/;
function wrapCjk(text, max) {
  return text.split('\n').map(line => {
    const chars = [...line];
    if (chars.length <= max) return line;
    const out = [];
    let rest = chars;
    while (rest.length > max) {
      const n = Math.ceil(rest.length / Math.ceil(rest.length / max)); // 고르게 나눈 길이
      let best = -1;
      for (let i = Math.min(max, rest.length - 1); i >= Math.max(2, Math.floor(n * 0.6)); i--) {
        const prev = rest.slice(0, i).join('');
        if (/^[、。，．！？!?」』）)・…ー]/.test(rest[i] || '')) continue; // 구두점으로 줄을 시작하지 않는다
        if (BREAK_AFTER.test(prev.slice(-1)) || /(から|まで|ので|けど|ため|して|ます|です)$/.test(prev)) { if (best < 0 || Math.abs(i - n) < Math.abs(best - n)) best = i; }
      }
      const cut = best > 0 ? best : n;
      out.push(rest.slice(0, cut).join('').trim());
      rest = rest.slice(cut);
    }
    out.push(rest.join('').trim());
    return out.filter(Boolean).join('\n');
  }).join('\n');
}

const assText = s => String(s).trim().replace(/\\/g, '＼').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\r?\n/g, '\\N');
const ts = sec => {
  const cs = Math.round(Math.max(0, sec) * 100);
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};

// ASS 자막 파일 내용. colors[i]: 'white' | 'black'
export function toAss(segments, { style, account, width = 1080, height = 1920, colors = [] }) {
  const resY = Math.round(1080 * height / width);
  const face = pickFace(style.fonts[account] || style.fonts.GLOBAL, style.weight) || pickFace(style.fonts.GLOBAL, style.weight);
  const fontName = face?.full || style.fonts[account] || 'Epilogue';
  const marginV = Math.round(resY * (1 - style.position / 100));
  const edge = { outline: { o: 2.4, a: '60', blur: 1 }, shadow: { o: 6, a: 'A8', blur: 10 }, none: { o: 0, a: 'FF', blur: 0 } }[style.edge] || { o: 2.4, a: '60', blur: 1 };
  const side = Math.round((1080 - textPx()) / 2), spacing = ((TRACK[account] || 0) * style.size).toFixed(2);
  const st = (name, text, line) => `Style: ${name},${fontName},${style.size},${text},${text},&H${edge.a}${line},&HFF000000,0,0,0,0,100,100,${spacing},0,1,${edge.o},0,2,${side},${side},${marginV},1`;
  const max = lineLimit(style, account);
  const lines = segments.map((s, i) => {
    const text = CJK_ACC.has(account) ? wrapCjk(String(s.text).trim(), max) : String(s.text).trim();
    return `Dialogue: 0,${ts(s.start)},${ts(s.end)},${colors[i] === 'black' ? 'B' : 'W'},,0,0,0,,${edge.blur ? `{\\blur${edge.blur}}` : ''}${assText(text)}`;
  });
  return ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', `PlayResY: ${resY}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    st('W', '&H00FFFFFF', '000000'), st('B', '&H001F1D1D', 'FFFFFF'), '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...lines, ''].join('\n');
}

// ffmpeg 필터에 넣을 자막 필터 (임시 ASS 파일을 만든다. 다 쓰면 cleanup() 호출)
export function assFilter(content) {
  syncFonts();
  const file = path.join(os.tmpdir(), `cc-sub-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ass`);
  fs.writeFileSync(file, content);
  const q = s => s.replace(/\\/g, '/').replace(/'/g, "'\\''");
  return { filter: `subtitles=filename='${q(file)}':fontsdir='${q(FONT_DIR)}'`, cleanup: () => fs.rmSync(file, { force: true }) };
}

function ff(args, binary = false) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 64 * 1024 * 1024, timeout: 120000, encoding: binary ? 'buffer' : 'utf8' }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`자막 미리보기 실패: ${String(stderr).trim().split('\n').slice(-2).join(' ')}`));
      resolve(stdout);
    });
  });
}

// 자막 자리(글자가 놓이는 띠)의 평균 밝기
export async function bandBrightness(file, t, style, height, width) {
  const resY = 1080 * height / width;
  const y1 = style.position / 100, y0 = Math.max(0, y1 - (style.size * 2.6) / resY);
  const buf = await ff(['-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', '-vf', `crop=iw*0.8:ih*${(y1 - y0).toFixed(4)}:iw*0.1:ih*${y0.toFixed(4)},scale=64:-2,format=gray`, '-f', 'rawvideo', 'pipe:1'], true);
  if (!buf.length) return 0;
  let sum = 0;
  for (const b of buf) sum += b;
  return sum / buf.length;
}

// 자막마다 흰/검정 글씨 정하기
export async function decideColors(file, segments, style, mode, { width, height }) {
  const m = mode in COLOR_MODES ? mode : style.color;
  if (m !== 'auto') return segments.map(() => m);
  const out = [];
  for (const s of segments) {
    const lum = await bandBrightness(file, (Number(s.start) + Number(s.end)) / 2, style, height, width).catch(() => 0);
    out.push(lum >= BRIGHT ? 'black' : 'white');
  }
  return out;
}

// 한 장면 미리보기 (JPEG). input이 없으면 샘플 배경(dark/bright)을 그린다.
export async function still({ input, t = 0, text, account, style, color, bg = 'dark', guide = true, width = 360, size }) {
  const w = size?.width || 1080, h = size?.height || 1920;
  const { filter, cleanup } = assFilter(toAss([{ start: 0, end: 36000, text }], { style, account, width: w, height: h, colors: [color] }));
  const pre = guide ? `drawbox=x=0:y=0:w=iw:h=ih*${SAFE_TOP}:color=black@0.28:t=fill,drawbox=x=0:y=ih*${SAFE_BOTTOM}:w=iw:h=ih*${(1 - SAFE_BOTTOM).toFixed(2)}:color=black@0.28:t=fill,drawbox=x=0:y=ih*${SAFE_BOTTOM}:w=iw:h=3:color=white@0.7:t=fill,` : '';
  const bright = bg === 'bright';
  const inArgs = input ? ['-ss', String(Math.max(0, t)), '-i', input]
    : ['-f', 'lavfi', '-i', `gradients=s=${w}x${h}:${bright ? 'c0=0xf4f1ec:c1=0xd8d2ca' : 'c0=0x6b645e:c1=0x24211f'}:x0=0:y0=0:x1=${w}:y1=${h}:d=1`];
  try {
    return await ff([...inArgs, '-frames:v', '1', '-vf', `${input ? '' : `drawbox=x=iw*0.35:y=ih*0.3:w=iw*0.3:h=ih*0.28:color=${bright ? '0xb3aba2' : '0x151413'}@0.9:t=fill,gblur=sigma=20,`}${pre}${filter},scale=${width}:-2`, '-q:v', '4', '-f', 'mjpeg', 'pipe:1'], true);
  } finally { cleanup(); }
}

export const SAMPLE = { GLOBAL: 'Your last step before sleep', EU: 'La dernière étape avant de dormir', JP: '眠る前の、最後のひと手間', KR: '잠들기 전 마지막 단계' };

// 브랜드 화면용: 계정마다 어두운 장면(흰 글씨)·밝은 장면(검정 글씨) 두 장
export async function stylePreview(draft) {
  const style = subtitleStyle(draft);
  const out = [];
  for (const account of ['GLOBAL', 'EU', 'JP', 'KR']) {
    for (const bg of ['dark', 'bright']) {
      const color = style.color === 'auto' ? (bg === 'bright' ? 'black' : 'white') : style.color;
      const buf = await still({ text: SAMPLE[account], account, style, color, bg });
      out.push({ account, bg, color, data: `data:image/jpeg;base64,${buf.toString('base64')}` });
    }
  }
  return out;
}
