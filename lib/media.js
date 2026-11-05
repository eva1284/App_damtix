// 영상 처리 (프로그램 안에서 무료로): 길이·크기 확인, 장면 캡처, 자막 입히기, 용량 최적화
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const FFMPEG = process.env.FFMPEG_BIN || ffmpegPath;

function run(args, timeoutMs = 30 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, ['-hide_banner', ...args], { maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err && err.code !== 1) return reject(new Error(`영상 처리 실패: ${String(stderr).trim().split('\n').slice(-3).join(' ')}`));
      resolve({ err, stderr: String(stderr) });
    });
  });
}

// 길이(초)와 가로·세로
export async function probe(file) {
  const { stderr } = await run(['-i', file]);
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const v = /Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/.exec(stderr);
  if (!d || !v) throw new Error('영상 파일을 읽을 수 없어요. mp4나 mov로 내보낸 파일인지 확인해 주세요.');
  return { duration: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]), width: Number(v[1]), height: Number(v[2]), audio: /Stream #[^\n]*Audio:/.test(stderr) };
}

// 한 장면을 작은 JPEG로 (Claude가 볼 때 토큰을 아끼려고 가로 768px)
export async function frame(file, t, dest, width = 768) {
  await run(['-y', '-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', dest]);
  if (!fs.existsSync(dest)) throw new Error(`${t}초 장면을 꺼내지 못했어요.`);
  return dest;
}

const ts = s => {
  const ms = Math.round(Math.max(0, s) * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60, r = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(sec)},${p(r, 3)}`;
};
export function toSrt(segments) {
  return segments.map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n${String(s.text).trim()}\n`).join('\n');
}

// 언어별 글꼴 (Mac 기본 글꼴)
const FONT = { JP: 'Hiragino Sans', GLOBAL: 'Helvetica Neue', EU: 'Helvetica Neue', KR: 'Apple SD Gothic Neo' };
const FONTS_DIR = process.platform === 'darwin' ? '/System/Library/Fonts' : '';

// 인스타그램용으로 다시 저장: 가로 최대 1080px, H.264, AAC, 빠른 재생 시작. 자막이 있으면 화면에 입힌다.
export async function encode(src, dest, { segments, account } = {}) {
  const before = fs.statSync(src).size;
  const filters = ["scale='min(1080,iw)':-2"];
  let tmpSrt = null;
  if (segments?.length) {
    tmpSrt = path.join(os.tmpdir(), `cc-sub-${process.pid}-${Date.now()}.srt`);
    fs.writeFileSync(tmpSrt, toSrt(segments));
    const style = `FontName=${FONT[account] || 'Helvetica Neue'}\\,FontSize=13\\,PrimaryColour=&H00FFFFFF\\,OutlineColour=&H80000000\\,BorderStyle=1\\,Outline=1.2\\,Shadow=0\\,MarginV=48`;
    filters.push(`subtitles=filename='${tmpSrt}'${FONTS_DIR ? `:fontsdir='${FONTS_DIR}'` : ''}:force_style='${style}'`);
  }
  try {
    await run(['-y', '-i', src, '-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', dest]);
  } finally { if (tmpSrt) fs.rmSync(tmpSrt, { force: true }); }
  if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) throw new Error('영상을 저장하지 못했어요.');
  const info = await probe(dest);
  return { before, after: fs.statSync(dest).size, width: info.width, height: info.height, duration: info.duration };
}
