// 데이터 저장소: 모든 데이터는 앱 폴더 안의 data/ 에 JSON 파일로 저장한다.
// 화면 서버(server.js)와 Claude 연결 창구(mcp.js)가 같은 파일을 함께 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.CC_DATA_DIR || path.join(APP_DIR, 'data');
const SEED_DIR = path.join(APP_DIR, 'seed');
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`${path.basename(file)} 파일을 읽을 수 없어요: ${e.message}`);
  }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file); // 쓰는 도중 끊겨도 파일이 깨지지 않게 바꿔치기
}

const file = name => path.join(DATA_DIR, `${name}.json`);
export const load = name => readJSON(file(name));
export const save = (name, data) => writeJSON(file(name), data);

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
}

// 지금 브랜드·제품 기준을 통째로 저장해 둔다 (되돌리기용)
export function snapshot() {
  const id = newId('snap');
  writeJSON(path.join(SNAP_DIR, `${id}.json`), { brand: load('brand'), products: load('products') });
  return id;
}

export function readSnapshot(id) {
  if (!/^snap-[a-z0-9]+$/.test(id)) throw new Error('잘못된 기록 번호예요.');
  return readJSON(path.join(SNAP_DIR, `${id}.json`));
}

// 처음 실행할 때 seed/ 의 기본 데이터로 data/ 를 만든다. 이미 있으면 건드리지 않는다.
export function ensureData() {
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  if (!fs.existsSync(file('brand'))) save('brand', readJSON(path.join(SEED_DIR, 'brand.json')));
  if (!fs.existsSync(file('products'))) save('products', readJSON(path.join(SEED_DIR, 'products.json')));
  if (!fs.existsSync(file('proposals'))) save('proposals', []);
  if (!fs.existsSync(file('works'))) save('works', []);
  if (!fs.existsSync(file('refs'))) save('refs', []);
  if (!fs.existsSync(file('history'))) {
    const brand = load('brand');
    save('history', [{
      id: newId('h'),
      at: new Date().toISOString(),
      label: `브랜드 v${brand.version}`,
      scope: `브랜드 전체 + 제품 ${load('products').length}개`,
      what: '처음 만듦',
      reason: `${brand.source} 기준`,
      by: '설치',
      snapshot: snapshot()
    }]);
  }
  if (!fs.existsSync(file('config'))) {
    save('config', {
      imageRoot: path.join(os.homedir(), 'Desktop', '이미지정리'),
      port: 4321,
      accessCode: String(crypto.randomInt(100000, 1000000))
    });
  }
}

export function markClaudeSeen(tool) {
  save('mcp-last-seen', { at: new Date().toISOString(), tool });
}

export function claudeLastSeen() {
  return readJSON(file('mcp-last-seen'), null);
}
