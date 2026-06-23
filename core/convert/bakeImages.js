// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/bakeImages.js — 이미지 굳히기(영구화)의 순수 변환부.
//
// 로그 html 안의 외부 http(s) <img> 를 찾아, 주입된 fetcher가 받아온 data URL로 교체한다.
// 핫링크(원격 호스트)는 언젠가 썩는다(hotlink rot) → data URL로 박제하면 호스트가 죽어도 안 깨짐.
// "안 썩는 영구 보관소" 간판 기능.
//
// ★네트워크는 코어에 두지 않는다(어댑터 주입). fetcher는 데스크탑 메인 프로세스에서 와서
//   CORS·쿼터 없이 받아온다(웹은 못 함 → 호출부에서 게이팅). 코어는 순수·이식 가능·node 테스트 가능.
// ★재인코딩/축소 안 함 — 보관은 원본 화질. (복사·공유 경로의 다운스케일과 혼동 금지.)
// ★idempotent — 이미 data: 인 이미지는 외부가 아니므로 건너뜀. 재실행 안전.
'use strict';

const IMG_RE = /<img\b[^>]*>/gi;

// <img> 태그에서 src 원문(따옴표 2종/무따옴표)을 뽑는다. 반환은 html에 적힌 그대로(엔티티 미디코드).
function srcOf(tag) {
  const m = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
  if (!m) return '';
  return m[1] != null ? m[1] : (m[2] != null ? m[2] : (m[3] || ''));
}

const isExternal = (u) => /^https?:\/\//i.test(u || '');

// URL 안 HTML 엔티티(&amp; 등)를 실제 문자로 — fetch에 넘기기 전 정리(태그 치환 키는 원문 유지).
function decodeEntities(s) {
  return String(s || '').replace(/&amp;/gi, '&').replace(/&#0*38;/g, '&').replace(/&#x0*26;/gi, '&');
}

// html 안 모든 외부(http/https) 이미지 src를 중복 없이 수집(원문 기준 — 치환 키로도 씀).
function externalImageUrls(html) {
  const out = [];
  const seen = new Set();
  for (const tag of (String(html || '').match(IMG_RE) || [])) {
    const u = srcOf(tag);
    if (isExternal(u) && !seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}

// 한 <img> 태그의 src 값을 newUrl로 교체(따옴표는 큰따옴표로 정규화 — data URL엔 " 없음).
function replaceSrcInTag(tag, newUrl) {
  return tag.replace(/(\bsrc\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i, (_full, pre) => pre + '"' + newUrl + '"');
}

// 외부 src→dataURL 매핑을 html의 해당 <img>들에 적용(매핑에 있는 것만).
function applyBaked(html, map) {
  return String(html || '').replace(IMG_RE, (tag) => {
    const raw = srcOf(tag);
    const dataUrl = map[raw];
    return dataUrl ? replaceSrcInTag(tag, dataUrl) : tag;
  });
}

// 동시성 제한 map(죽은 링크 하나가 전체를 막지 않게 + 너무 많은 동시 요청 방지).
async function mapPool(items, limit, fn) {
  let i = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const run = async () => { while (i < items.length) { const idx = i++; await fn(items[idx], idx); } };
  await Promise.all(Array.from({ length: n }, run));
}

// 메인 엔트리. html의 외부 이미지를 fetcher로 받아 data URL로 박제한다.
//   fetcher(url) => Promise<{ ok:true, dataUrl } | { ok:false, error }>
//   opts: { concurrency=4, onProgress(done,total) }
// 반환: { html, baked(성공수), failed:[{url,error}], total(외부 이미지 수) }.
//   실패(죽은 링크)는 src를 안 바꾸고 failed에 모은다 → 로그 손상 0, 나머지는 정상 굳음.
async function bakeImages(html, fetcher, opts) {
  opts = opts || {};
  const refs = externalImageUrls(html);
  if (!refs.length) return { html: String(html || ''), baked: 0, failed: [], total: 0 };
  const map = Object.create(null);
  const failed = [];
  let done = 0;
  await mapPool(refs, opts.concurrency || 4, async (ref) => {
    let res;
    try { res = await fetcher(decodeEntities(ref)); }
    catch (e) { res = { ok: false, error: (e && e.message) || String(e) }; }
    if (res && res.ok && typeof res.dataUrl === 'string' && res.dataUrl.slice(0, 5) === 'data:') {
      map[ref] = res.dataUrl;
    } else {
      failed.push({ url: ref, error: (res && res.error) || '받기 실패' });
    }
    done++;
    if (typeof opts.onProgress === 'function') opts.onProgress(done, refs.length);
  });
  return { html: applyBaked(html, map), baked: Object.keys(map).length, failed, total: refs.length };
}

module.exports = { externalImageUrls, bakeImages, applyBaked, srcOf, isExternal };
