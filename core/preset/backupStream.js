// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/preset/backupStream.js — 백업 zip을 "흘려 쓰기 / 흘려 읽기". 브라우저+node 공용.
//
// 왜(2026-10-22 제보): buildBackup/openBackup은 zip 전체를 메모리에서 만들고 펼친다 → 담을 파일을 다 모으고(1벌)
//   zipSync 출력(1벌) + 다운로드 Blob(1벌) = 백업 데이터의 3~4배가 동시에 렌더러에 올라, 1GB만 넘어도 V8/파티션 OOM.
//   (측정: 그림 1GB 백업 → 렌더러 +3.4GB.) 여기서는 파일을 하나씩 zip에 이어 쓰고 바로 버린다(write 콜백이 디스크로).
//   읽기는 zip 끝의 중앙 디렉터리만 읽고 항목을 필요할 때 하나씩 꺼낸다(readAt = 파일 슬라이스) → 메모리 = 가장 큰 항목 1개.
// ★형식은 buildBackup과 동일(catalog.json + assets/N.ext + bin/...): 옛 앱(openBackup=unzipSync)도 새 백업을 읽고,
//   새 리더(openBackupLazy)는 옛 백업(zipSync 산출)도 읽는다. 항목 순서만 다름(바이너리 먼저, catalog 마지막).
// 한계: zip64 미지원(fflate) → 백업 4GB 미만. 넘기면 명확한 오류로 중단(깨진 파일 대신).
'use strict';
const { Zip, ZipPassThrough, ZipDeflate, inflateSync, strToU8, strFromU8 } = require('fflate');

const ZIP32_LIMIT = 0xFFFFFFFF - 64 * 1024 * 1024;   // 중앙 디렉터리·헤더 여유 64MB
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/svg+xml': 'svg' };
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml' };
const extFor = (mime) => EXT[String(mime).toLowerCase()] || 'bin';
const mimeForExt = (ext) => MIME[String(ext).toLowerCase()] || 'application/octet-stream';
const DATA_IMG = /data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/gi;
const ASSET_REF = /lpasset:(\d+)\.([a-z0-9]+)/gi;

function b64ToBytes(b64) { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
function bytesToB64(bytes) { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); }
function mapStrings(v, fn) {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn));
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = mapStrings(v[k], fn); return o; }
  return v;
}
function walkStrings(v, fn) {
  if (typeof v === 'string') { fn(v); return; }
  if (Array.isArray(v)) { for (const x of v) walkStrings(x, fn); return; }
  if (v && typeof v === 'object') for (const k of Object.keys(v)) walkStrings(v[k], fn);
}

// ── 흘려 쓰기 ─────────────────────────────────────────────────────────────
// write(chunk: Uint8Array) => Promise<void> — 조각을 받는 곳(디스크 파일·파일 핸들·Blob 조각 묶음).
//   fflate Zip은 push 즉시(동기) 조각을 내보낸다 → 큐에 받아 await로 비운 뒤 다음 파일로(파일 1개 분량만 메모리).
function createBackupWriter(write, opts) {
  const limit = (opts && opts.limit) || ZIP32_LIMIT;
  const queue = []; let err = null; let total = 0;
  const zip = new Zip((e, chunk) => { if (e) err = e; else if (chunk && chunk.length) queue.push(chunk); });
  async function drain() {
    while (queue.length) { const c = queue.shift(); total += c.length; await write(c); }
    if (err) throw err;
  }
  return {
    /** 파일 하나를 zip에 이어 쓴다. level 0 = 저장(그림·원본은 이미 압축됨), 1~9 = 압축(텍스트). */
    async addFile(path, bytes, level) {
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
      if (total + u8.length > limit) throw new Error('백업이 4GB를 넘어 한 파일에 담을 수 없어요 (zip 한계). 관리실 원본 파일을 정리한 뒤 다시 시도해 주세요.');
      const f = level ? new ZipDeflate(path, { level }) : new ZipPassThrough(path);
      zip.add(f); f.push(u8, true);
      await drain();
    },
    /** 중앙 디렉터리까지 써서 마무리. 반환 = 총 바이트. */
    async finish() { zip.end(); await drain(); return total; },
    get bytesWritten() { return total; },
  };
}

// 백업 객체 → 흘려 쓰기. bins = [{ path, get: () => Promise<Uint8Array|null> }] — 하나씩 읽어 쓰고 버린다.
//   data 안의 data:image 문자열은 buildBackup처럼 assets/N.ext로 분리(같은 URL은 1벌) — 디코드도 쓰기 직전에 하나씩.
async function writeBackupStream(write, data, bins, opts) {
  const w = createBackupWriter(write, opts);
  const onStep = (opts && opts.onStep) || null;
  let i = 0;
  for (const b of bins || []) {
    i++;
    const bytes = await b.get();
    if (!bytes) continue;
    if (onStep) onStep(i, bins.length);
    await w.addFile(b.path, bytes, 0);
  }
  const assets = {}; const byUrl = new Map(); const pending = []; let n = 0;
  const refData = mapStrings(data, (s) => s.replace(DATA_IMG, (full, mime, b64) => {
    let ref = byUrl.get(full);
    if (!ref) { const ext = extFor(mime); ref = 'lpasset:' + n + '.' + ext; assets[n] = mime; pending.push({ path: 'assets/' + n + '.' + ext, b64 }); byUrl.set(full, ref); n++; }
    return ref;
  }));
  byUrl.clear();
  for (const a of pending) await w.addFile(a.path, b64ToBytes(a.b64), 0);
  pending.length = 0;
  const catalog = { app: 'log-jejogi-pro2', kind: 'backup-zip', version: 2, assets, data: refData };
  await w.addFile('catalog.json', strToU8(JSON.stringify(catalog)), 6);
  return w.finish();
}

// ── 흘려 읽기(임의 접근) ───────────────────────────────────────────────────
// readAt(offset, length) => Promise<Uint8Array> — 파일 슬라이스. size = 전체 바이트.
//   zip 끝의 EOCD → 중앙 디렉터리 → 항목별 로컬 헤더 위치/크기. 데이터 디스크립터(bit3)도 중앙 디렉터리 크기로 처리.
async function readZipIndex(size, readAt) {
  const tailLen = Math.min(size, 22 + 65535);
  const tail = await readAt(size - tailLen, tailLen);
  const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let p = tail.length - 22; p >= 0; p--) { if (dv.getUint32(p, true) === 0x06054b50) { eocd = p; break; } }
  if (eocd < 0) throw new Error('zip 형식이 아닙니다 (끝 표식 없음)');
  const count = dv.getUint16(eocd + 10, true), cdSize = dv.getUint32(eocd + 12, true), cdOff = dv.getUint32(eocd + 16, true);
  if (count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF) throw new Error('zip64 백업은 아직 지원하지 않아요');
  const cd = await readAt(cdOff, cdSize);
  const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries = new Map(); let p = 0;
  for (let k = 0; k < count && p + 46 <= cd.length; k++) {
    if (cv.getUint32(p, true) !== 0x02014b50) throw new Error('zip 목록이 손상됐어요');
    const method = cv.getUint16(p + 10, true), comp = cv.getUint32(p + 20, true), usize = cv.getUint32(p + 24, true);
    const nl = cv.getUint16(p + 28, true), xl = cv.getUint16(p + 30, true), cl = cv.getUint16(p + 32, true), off = cv.getUint32(p + 42, true);
    const name = strFromU8(cd.subarray(p + 46, p + 46 + nl));
    entries.set(name, { method, comp, size: usize, off });
    p += 46 + nl + xl + cl;
  }
  async function readEntry(name) {
    const e = entries.get(name); if (!e) return null;
    const lh = await readAt(e.off, 30);
    const lv = new DataView(lh.buffer, lh.byteOffset, lh.byteLength);
    if (lv.getUint32(0, true) !== 0x04034b50) throw new Error('zip 항목이 손상됐어요: ' + name);
    const start = e.off + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
    const raw = await readAt(start, e.comp);
    if (e.method === 0) return raw;
    if (e.method === 8) return inflateSync(raw, { out: new Uint8Array(e.size) });
    throw new Error('지원하지 않는 압축 방식: ' + e.method);
  }
  return { names: Array.from(entries.keys()), has: (n) => entries.has(n), readEntry };
}

// 백업 zip(새·옛 형식 모두) → { catalog, data(이미지 재인라인), names, getBin(path)=Promise<Uint8Array|null> }.
//   data의 lpasset 참조는 해당 assets 항목만 한 번씩 읽어 data: URL로 되돌린다(openBackup과 같은 결과).
async function openBackupLazy(size, readAt) {
  const z = await readZipIndex(size, readAt);
  const cbytes = await z.readEntry('catalog.json');
  if (!cbytes) throw new Error('백업 zip 형식이 아닙니다 (catalog.json 없음)');
  const catalog = JSON.parse(strFromU8(cbytes));
  const assets = (catalog && catalog.assets) || {};
  const need = new Set();
  walkStrings(catalog.data, (s) => { if (s.indexOf('lpasset:') < 0) return; for (const m of s.matchAll(ASSET_REF)) need.add(m[0]); });
  const cache = {};
  for (const full of need) {
    const m = /^lpasset:(\d+)\.([a-z0-9]+)$/i.exec(full); if (!m) continue;
    const bytes = await z.readEntry('assets/' + m[1] + '.' + m[2]);
    if (bytes) cache[full] = 'data:' + (assets[m[1]] || mimeForExt(m[2])) + ';base64,' + bytesToB64(bytes);
  }
  const data = need.size ? mapStrings(catalog.data, (s) => (s.indexOf('lpasset:') < 0 ? s : s.replace(ASSET_REF, (full) => cache[full] || full))) : catalog.data;
  return { catalog, data, names: z.names, getBin: (path) => z.readEntry(String(path || '')) };
}

/** 브라우저 File/Blob → readAt (필요한 구간만 슬라이스로 읽음). */
function blobReader(blob) {
  return (off, len) => blob.slice(off, off + len).arrayBuffer().then((b) => new Uint8Array(b));
}

module.exports = { createBackupWriter, writeBackupStream, readZipIndex, openBackupLazy, blobReader, ZIP32_LIMIT };
