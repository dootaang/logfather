// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/preset/backupZip.js — 전체 백업을 zip 한 파일로(이미지 분리·중복제거). 브라우저+node 공용.
//
// "안 썩는 영구 보관소" 백업: 텍스트(설정·메타·로그 본문 구조)는 catalog.json 한 카탈로그로,
// 이미지(data:URL)는 base64 글자가 아니라 ★원본 사파일(assets/N.ext)로 분리해 담는다.
//   → 이미지 많아도 JSON이 수백 MB로 안 부풀고(탭 멈춤 방지), 앱 없이 압축만 풀어도 사진·텍스트를 꺼낼 수 있다.
//   → 같은 이미지가 여러 곳에 쓰이면(profile·표지·로그) 정확히 1벌만 담겨 자연히 중복 제거.
// zip 압축은 fflate(이미 의존). base64는 atob/btoa(브라우저·node 둘 다 전역 제공).
'use strict';
const { zipSync, unzipSync, strToU8, strFromU8 } = require('fflate');

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/svg+xml': 'svg' };
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml' };
const extFor = (mime) => EXT[String(mime).toLowerCase()] || 'bin';
const mimeForExt = (ext) => MIME[String(ext).toLowerCase()] || 'application/octet-stream';

function b64ToBytes(b64) { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
function bytesToB64(bytes) { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); }

// 중첩 객체/배열의 "문자열 값"마다 fn 적용해 새 구조 반환(불변 — 원본 안 건드림).
function mapStrings(v, fn) {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn));
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = mapStrings(v[k], fn); return o; }
  return v;
}

const DATA_IMG = /data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/gi;
const ASSET_REF = /lpasset:(\d+)\.([a-z0-9]+)/gi;

// data(백업 객체) → zip 바이트(Uint8Array). 이미지 data:URL은 assets/N.ext로 분리, catalog.json엔 lpasset:N.ext 참조.
//   binFiles(선택) = { [zip경로]: Uint8Array } — ★관리실 원본·폰트·카드처럼 큰 바이너리는 base64 문자열로 만들지 않고
//   zip 안에 사파일로 직접 담는다(level0). 호출부는 data 안에 그 zip경로 문자열을 참조로 둔다(예: {file:'bin/src/<해시>.charx'}).
//   → 수백 MB~GB 소스도 base64로 2배 부풀거나 탭이 멈추지 않음. 복원은 openBackup(zip).getBin(경로)로 그 바이트를 그대로 회수.
function buildBackup(data, binFiles) {
  const assets = {};        // index → mime(복원 시 정확 재구성)
  const byUrl = new Map();  // dataUrl → ref(정확 중복제거)
  const files = {};
  let n = 0;
  const refData = mapStrings(data, (s) => s.replace(DATA_IMG, (full, mime, b64) => {
    let ref = byUrl.get(full);
    if (!ref) {
      const ext = extFor(mime);
      ref = 'lpasset:' + n + '.' + ext;
      assets[n] = mime;
      files['assets/' + n + '.' + ext] = [b64ToBytes(b64), { level: 0 }];   // 이미지는 이미 압축됨 → store(level0)
      byUrl.set(full, ref);
      n++;
    }
    return ref;
  }));
  // ★대용량 바이너리 직접 담기(base64 금지). 경로는 호출부가 정한 'bin/...'(catalog/assets와 충돌 안 함). 이미 압축됐을 수 있어 store(level0).
  if (binFiles && typeof binFiles === 'object') {
    for (const path of Object.keys(binFiles)) {
      const b = binFiles[path];
      if (!b) continue;
      files[path] = [b instanceof Uint8Array ? b : new Uint8Array(b), { level: 0 }];
    }
  }
  const catalog = { app: 'log-jejogi-pro2', kind: 'backup-zip', version: 2, assets, data: refData };
  files['catalog.json'] = [strToU8(JSON.stringify(catalog)), { level: 6 }];   // 텍스트는 압축
  return zipSync(files);
}

// zip 바이트 → { catalog, data(이미지 재인라인), getBin(경로), names }. catalog.json 없으면 throw.
//   data = 텍스트 카탈로그(이미지 data:URL 복원됨). getBin = 직접 담긴 바이너리(관리실 원본·폰트·카드)를 경로로 회수.
function openBackup(zipBytes) {
  const files = unzipSync(zipBytes instanceof Uint8Array ? zipBytes : new Uint8Array(zipBytes));
  if (!files['catalog.json']) throw new Error('백업 zip 형식이 아닙니다 (catalog.json 없음)');
  const catalog = JSON.parse(strFromU8(files['catalog.json']));
  const assets = (catalog && catalog.assets) || {};
  const cache = {};
  const data = mapStrings(catalog.data, (s) => s.replace(ASSET_REF, (full, idx, ext) => {
    if (cache[full]) return cache[full];
    const bytes = files['assets/' + idx + '.' + ext];
    if (!bytes) return full;   // 자산 누락 → 참조 토큰 그대로(깨진 이미지보단 안전)
    const du = 'data:' + (assets[idx] || mimeForExt(ext)) + ';base64,' + bytesToB64(bytes);
    cache[full] = du;
    return du;
  }));
  return {
    catalog, data, names: Object.keys(files),
    getBin(path) { const b = files[path]; return b ? (b instanceof Uint8Array ? b : new Uint8Array(b)) : null; },
  };
}

// zip 바이트 → 백업 객체(이미지 재인라인)만. 바이너리는 안 회수(옛 호출부·서재 내보내기 호환).
function parseBackup(zipBytes) { return openBackup(zipBytes).data; }

// 바이트가 zip인가(PK 매직). 백업 불러올 때 zip vs 옛 json 분기용.
function isZip(bytes) { const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []); return b.length > 1 && b[0] === 0x50 && b[1] === 0x4b; }

module.exports = { buildBackup, parseBackup, openBackup, isZip };
