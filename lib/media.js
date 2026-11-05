// 영상 처리 (프로그램 안에서 무료로): 길이·크기 확인, 장면 캡처, 자막 입히기, 용량 최적화
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import ffmpegPath from 'ffmpeg-static';
import { assFilter } from './subtitles.js';

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

// 소리 파일 길이(초). 영상이 없어도 된다 (음악·효과음)
export async function probeAudio(file) {
  const { stderr } = await run(['-i', file]);
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!d || !/Stream #[^\n]*Audio:/.test(stderr)) throw new Error(`소리 파일을 읽을 수 없어요: ${file.split('/').pop()}`);
  return Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
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

// 인스타그램용으로 다시 저장 (이전 작업에서 확정한 규격): 가로 최대 1080px, 최대 30fps, H.264 High 4.2 CRF 17 · 최대 12Mbps, bt709, AAC 192k 48kHz, 빠른 재생 시작.
// ass: 자막 디자인이 들어간 자막 파일 내용 (lib/subtitles.js의 toAss). 있으면 화면에 입힌다.
export async function encode(src, dest, { ass } = {}) {
  const before = fs.statSync(src).size;
  const filters = ["scale='min(1080,iw)':-2"];
  const sub = ass ? assFilter(ass) : null;
  if (sub) filters.push(sub.filter);
  try {
    await run(['-y', '-i', src, '-vf', filters.join(','), '-fpsmax', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-maxrate', '12M', '-bufsize', '24M', '-profile:v', 'high', '-level:v', '4.2', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', dest]);
  } finally { sub?.cleanup(); }
  if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) throw new Error('영상을 저장하지 못했어요.');
  const info = await probe(dest);
  return { before, after: fs.statSync(dest).size, width: info.width, height: info.height, duration: info.duration };
}
