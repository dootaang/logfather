// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/bake.ts — 이미지 굳히기(영구화)의 데스크탑 연결부.
//
// 코어(bakeImages)는 순수 변환만 한다 — 외부 이미지를 "어떻게 받아오는지"는 여기서 데스크탑
// 어댑터(window.desktop.fetchImage = 메인 프로세스 fetch, CORS 무관)로 주입한다.
// 웹(브라우저)엔 window.desktop이 없으므로 desktopAvailable()===false → 호출부가 기능을 숨긴다.
// ★보관용이라 재인코딩/축소 없음(원본 화질). 죽은 링크는 격리해 나머지는 정상 굳힌다.
// @ts-nocheck
import { bakeImages, externalImageUrls } from '../../core/convert/bakeImages.js';

/** 데스크탑 앱에서 실행 중이고 네트워크 어댑터가 있는가(=CORS 없이 직접 받기). 웹이면 false. */
export function desktopAvailable(): boolean {
  return !!(typeof window !== 'undefined' && (window as any).desktop && typeof (window as any).desktop.fetchImage === 'function');
}
/** 굳히기 시도 가능 여부 — 데스크탑(native)이거나 웹(weserv 프록시 폴백)이면 true. ★파파모드는 웹에서도 굳힌다. */
export function bakeAvailable(): boolean {
  return desktopAvailable() || (typeof fetch === 'function');
}

// Blob → data URL (FileReader). ★canvas/JPEG 재인코딩 안 함 = 원본 바이트 그대로(알파 보존).
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = () => rej(new Error('읽기 실패')); r.readAsDataURL(blob); });
}
// 웹 이미지 fetcher — 직접 fetch(CORS 되는 호스트/동일출처) 먼저, 막히면 weserv.nl 프록시 1회 폴백(6종 권고: 죽은 프록시 체인 금지).
//   weserv는 CORS 헤더를 붙여 프록시한다 + 포맷 보존(PNG 알파 유지). 우리는 canvas를 안 거치므로 알파 깨짐 없음.
async function webFetchImage(url: string): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  const grab = async (u: string) => {
    const resp = await fetch(u, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();
    if (!blob || !blob.size) throw new Error('빈 응답');
    const dataUrl = await blobToDataUrl(blob);
    if (!/^data:image\//i.test(dataUrl)) throw new Error('이미지 아님');
    return dataUrl;
  };
  try { return { ok: true, dataUrl: await grab(url) }; }
  catch (_) {
    try {
      const prox = 'https://images.weserv.nl/?url=' + encodeURIComponent(url.replace(/^https?:\/\//i, '')) + '&n=-1';
      return { ok: true, dataUrl: await grab(prox) };
    } catch (e: any) { return { ok: false, error: (e && e.message) || '받기 실패(차단·CORS·죽은 링크)' }; }
  }
}
/** 한 배치 안에서 같은 URL은 1번만 받도록 메모이즈하는 fetcher. 데스크탑=native(CORS 무관) / 웹=fetch+weserv 폴백. */
function cachedFetcher() {
  const native = desktopAvailable();
  const cache = new Map<string, Promise<any>>();
  return (url: string) => { let p = cache.get(url); if (!p) { p = native ? (window as any).desktop.fetchImage(url) : webFetchImage(url); cache.set(url, p); } return p; };
}

/** 로그 html 안의 외부(http/https) 이미지 수 — "굳힐 게 남았는지" 표시·게이팅용. */
export function externalCount(html: string): number { return externalImageUrls(html || '').length; }

export interface BakeReport { changedLogs: number; bakedImgs: number; totalExternal: number; failed: { url: string; error: string }[]; }

/**
 * 여러 로그를 굳힌다. saveOne(rec)=바뀐 로그 저장(보통 logsAdd), onStep(msg)=진행 보고.
 * 외부 이미지가 있는 로그만 처리하고, baked가 있을 때만 저장한다(불필요한 쓰기 방지).
 */
export async function bakeLogs(logs: any[], saveOne: (r: any) => Promise<any>, onStep?: (msg: string) => void): Promise<BakeReport> {
  const fetcher = cachedFetcher();
  const perLogUrls = logs.map((r) => externalImageUrls(r.html || ''));
  const grandTotal = perLogUrls.reduce((n, a) => n + a.length, 0);
  let changedLogs = 0, bakedImgs = 0, totalExternal = 0, doneImgs = 0;
  const failedMap = new Map<string, string>();   // url → error (배치 전체에서 url 기준 dedupe)
  for (let i = 0; i < logs.length; i++) {
    if (!perLogUrls[i].length) continue;
    const r = logs[i];
    const res = await bakeImages(r.html || '', fetcher, {
      onProgress: () => { doneImgs++; if (onStep) onStep(`이미지 받는 중… (${doneImgs}/${grandTotal})`); },
    });
    totalExternal += res.total;
    bakedImgs += res.baked;
    for (const f of res.failed) if (!failedMap.has(f.url)) failedMap.set(f.url, f.error);
    if (res.baked > 0 && res.html !== r.html) { r.html = res.html; try { await saveOne(r); changedLogs++; } catch (_) {} }
  }
  return { changedLogs, bakedImgs, totalExternal, failed: Array.from(failedMap, ([url, error]) => ({ url, error })) };
}
