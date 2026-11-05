// 소리: 효과음·음악을 프로그램이 직접 섞고(층별로 보관), 시간대별 음량·주파수를 분석한다.
// ffmpeg는 파일 하나를 읽어 PCM으로 바꾸는 데만 쓴다 (여러 입력을 한 번에 섞는 그래프는 일부 ffmpeg에서 멈춘다).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const FFMPEG = process.env.FFMPEG_BIN || ffmpegPath;
export const RATE = 48000;

// 파일 → 스테레오 Float32 (48kHz). from/dur(초)로 일부만
export function decode(file, { from = 0, dur = null, rate = RATE, channels = 2 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', ...(from ? ['-ss', String(from)] : []), '-i', file, ...(dur ? ['-t', String(dur)] : []), '-vn', '-ac', String(channels), '-ar', String(rate), '-f', 'f32le', 'pipe:1'];
    execFile(FFMPEG, args, { encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024, timeout: 120000 }, (err, out, se) => {
      if (err) return reject(new Error(`소리를 읽지 못했어요 (${path.basename(file)}): ${String(se).trim().split('\n').pop()}`));
      resolve(new Float32Array(out.buffer, out.byteOffset, Math.floor(out.length / 4)));
    });
  });
}

// 여러 소리 이벤트를 길이 D초의 스테레오 트랙에 섞는다. events: [{ data(Float32 스테레오), at(초), volume, fadeIn, fadeOut }]
export function mix(D, events) {
  const n = Math.ceil(D * RATE) * 2;
  const out = new Float32Array(n);
  for (const e of events) {
    const start = Math.round(e.at * RATE) * 2, len = e.data.length, vol = e.volume ?? 1;
    const fi = Math.round((e.fadeIn || 0) * RATE) * 2, fo = Math.round((e.fadeOut || 0) * RATE) * 2;
    for (let i = 0; i < len; i++) {
      const j = start + i;
      if (j < 0) continue;
      if (j >= n) break;
      let g = vol;
      if (fi && i < fi) g *= i / fi;
      if (fo && i > len - fo) g *= Math.max(0, (len - i) / fo);
      out[j] += e.data[i] * g;
    }
  }
  return out;
}

// 부드러운 리미터 (최대 -0.5 dBFS 근처)
export function limit(buf, ceiling = 0.944) {
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i] / ceiling;
    buf[i] = Math.abs(x) <= 0.8 ? buf[i] : ceiling * Math.sign(x) * (0.8 + 0.2 * Math.tanh((Math.abs(x) - 0.8) / 0.2));
  }
  return buf;
}

export function writeWav(file, buf, { rate = RATE, channels = 2 } = {}) {
  const data = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(buf[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
  return file;
}

// 분석용으로 층을 작게(모노 16kHz) 저장
export const ARATE = 16000;
export function toMono(buf, from = RATE, to = ARATE) {
  const frames = buf.length / 2, step = from / to, out = new Float32Array(Math.floor(frames / step));
  for (let i = 0; i < out.length; i++) { const j = Math.floor(i * step) * 2; out[i] = (buf[j] + buf[j + 1]) / 2; }
  return out;
}
export const saveLayer = (file, mono) => fs.writeFileSync(file, Buffer.from(mono.buffer, mono.byteOffset, mono.byteLength));
export const loadLayer = file => { const b = fs.readFileSync(file); return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4)); };

const db = x => (x > 1e-9 ? Math.round(20 * Math.log10(x) * 10) / 10 : -120);
// 가장 센 주파수 (짧은 구간 DFT, 60Hz~8kHz)
function peakFreq(mono, start, len) {
  const N = Math.min(1024, len);
  if (N < 64) return 0;
  let best = 0, bestF = 0;
  for (let k = 4; k < N / 2; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); const v = mono[start + i] * w; const a = 2 * Math.PI * k * i / N; re += v * Math.cos(a); im -= v * Math.sin(a); }
    const p = re * re + im * im;
    if (p > best) { best = p; bestF = k * ARATE / N; }
  }
  return Math.round(bestF);
}

// 층별 시간대 분석. layers: { 이름: Float32 모노 16kHz }
export function analyze(layers, from, to, step = 0.1) {
  const rows = [];
  for (let t = from; t < to - 1e-6; t += step) {
    const s = Math.floor(t * ARATE), len = Math.max(1, Math.floor(step * ARATE));
    const row = { t: Math.round(t * 100) / 100, layers: {} };
    let loud = null, loudV = 0;
    const mixw = new Float32Array(len);
    for (const [name, m] of Object.entries(layers)) {
      let sum = 0, pk = 0;
      for (let i = 0; i < len; i++) { const v = m[s + i] || 0; sum += v * v; pk = Math.max(pk, Math.abs(v)); mixw[i] += v; }
      const rms = Math.sqrt(sum / len);
      row.layers[name] = { rmsDb: db(rms), peakDb: db(pk) };
      if (rms > loudV) { loudV = rms; loud = name; }
    }
    let msum = 0; for (let i = 0; i < len; i++) msum += mixw[i] * mixw[i];
    row.mixDb = db(Math.sqrt(msum / len));
    row.loudest = loudV > 0.003 ? loud : null; // -50dB 아래는 무음으로 본다
    row.freqHz = row.loudest ? peakFreq(mixw, 0, len) : 0;
    rows.push(row);
  }
  return rows;
}
