// 이미지 폴더: 바탕화면의 '이미지정리' 폴더를 지금 정리된 모습 그대로 쓴다.
// 제품별 폴더(01 다크스팟, 02 PDRN …)와 그 밖의 폴더(누끼, 단체컷, 모델, 로고)를 설정에 기억해 둔다.
// macOS는 한글 파일 이름을 자모가 분리된 형태(NFD)로 저장하는 경우가 많아서, 이름은 항상 NFC로 맞춰서 비교한다.
import fs from 'node:fs';
import path from 'node:path';
import { load, save } from './store.js';

export const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.avif', '.tif', '.tiff']);

// 사용자의 실제 폴더 이름 (2026-11 기준)
export const DEFAULT_PRODUCT_FOLDERS = {
  DSS: '01 다크스팟', GTCP: '02 PDRN', GTCN: '03 NMN', GTCR: '04 리페어',
  P7XL: '05 리프팅', VLE: '06 아이크림', HGB: '07 버블토너', VLER: '08 아이크림 리필'
};
export const OTHER_FOLDERS = [
  ['cutouts', '누끼 이미지', '00 누끼이미지'],
  ['group', '단체컷', '99 단체컷'],
  ['realModels', '실제 모델', '실제 모델'],
  ['aiModels', 'AI 모델', 'ai 모델'],
  ['logos', '로고', '담틱스 로고'],
  ['etc', '기타 이미지', '100 기타 이미지']
];

const nfc = s => String(s ?? '').normalize('NFC');

// 설정에 폴더 정보가 없으면 기본값을 채운다 (이미 있는 값은 건드리지 않는다)
export function migrateConfig() {
  const config = load('config');
  let changed = false;
  if (!config.productFolders) { config.productFolders = { ...DEFAULT_PRODUCT_FOLDERS }; changed = true; }
  if (!config.otherFolders) { config.otherFolders = Object.fromEntries(OTHER_FOLDERS.map(([k, , def]) => [k, def])); changed = true; }
  if (changed) save('config', config);
  return config;
}

export function listTopFolders(root = load('config').imageRoot) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => nfc(d.name))
      .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
  } catch { return []; }
}

// 이름이 같은 폴더를 찾아 실제 경로를 돌려준다 (NFC/NFD 차이를 무시)
export function resolveFolder(root, name) {
  if (!name) return null;
  try {
    const hit = fs.readdirSync(root, { withFileTypes: true }).find(d => d.isDirectory() && nfc(d.name) === nfc(name));
    return hit ? path.join(root, hit.name) : null;
  } catch { return null; }
}

// 폴더 안의 이미지를 하위 폴더별로 모은다 (두 단계 깊이까지, 최대 300장)
export function collectImages(root, folder, maxFiles = 300) {
  const groups = new Map();
  let count = 0, truncated = false;
  const walk = (abs, group, depth) => {
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => nfc(a.name).localeCompare(nfc(b.name), 'ko', { numeric: true }));
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(abs, e.name);
      if (e.isDirectory()) { if (depth < 2) walk(p, depth === 0 ? nfc(e.name) : group, depth + 1); continue; }
      if (!e.isFile() || !IMAGE_EXT.has(path.extname(e.name).toLowerCase())) continue;
      if (count >= maxFiles) { truncated = true; return; }
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({ name: nfc(e.name), rel: path.relative(root, p), abs: p });
      count++;
    }
  };
  walk(folder, '기본', 0);
  return { groups: [...groups].map(([name, files]) => ({ name, files })), count, truncated };
}

export function productImages(code) {
  const config = migrateConfig();
  const root = config.imageRoot;
  const folderName = config.productFolders[code] || '';
  const rootExists = fs.existsSync(root);
  const folder = rootExists ? resolveFolder(root, folderName) : null;
  const result = { root, rootExists, folderName, folder, groups: [], count: 0, truncated: false };
  if (folder) Object.assign(result, collectImages(root, folder));
  return result;
}

// 전체 폴더 연결 상태 (홈 화면, Claude 안내용)
export function folderMap() {
  const config = migrateConfig();
  const root = config.imageRoot;
  const products = load('products').map(p => {
    const name = config.productFolders[p.code] || '';
    return { code: p.code, product: p.names.KR, folderName: name, path: resolveFolder(root, name) };
  });
  const others = OTHER_FOLDERS.map(([key, label]) => {
    const name = config.otherFolders[key] || '';
    return { key, label, folderName: name, path: resolveFolder(root, name) };
  });
  const used = new Set([...products, ...others].map(x => nfc(x.folderName)));
  return { root, rootExists: fs.existsSync(root), products, others, unassigned: listTopFolders(root).filter(n => !used.has(n)) };
}

export function setFolders({ productFolders, otherFolders }) {
  const config = migrateConfig();
  const codes = new Set(load('products').map(p => p.code));
  for (const [code, name] of Object.entries(productFolders || {})) {
    if (!codes.has(code)) throw new Error(`제품 코드 ${code}를 찾을 수 없어요.`);
    config.productFolders[code] = nfc(name).trim();
  }
  const keys = new Set(OTHER_FOLDERS.map(x => x[0]));
  for (const [key, name] of Object.entries(otherFolders || {})) {
    if (!keys.has(key)) throw new Error(`알 수 없는 폴더 종류예요: ${key}`);
    config.otherFolders[key] = nfc(name).trim();
  }
  save('config', config);
}
