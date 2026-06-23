// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/reader.ts — 리더 독립 페이지(3번째 esbuild 진입점). "모든 읽기"를 자체 해시 라우터로 소유.
//
// ★공유(#/share)는 로그인/동기화 없이 가볍게 뜸(비로그인 외부인). 내 서재(#/log·#/read)는 그 라우트에 들어올 때만
//   클라우드를 지연 init(로그인 시 백엔드 교체·실시간) — 공유 열람자에겐 무거운 init이 안 걸린다.
// 화↔화는 해시 변경=즉시(페이지 리로드 0). 리더 본문/공유/단일화는 공용 readerView·readerLog(중복 없음).
// @ts-nocheck
import { renderShare, renderSharedSeriesEp } from './readerView.js';
import { createReaderLog } from './readerLog.js';
import { logsAll, metaAll, loadRead, dedupeLogList, LocalBackend } from './store.js';
import { fontsSupported, refreshFonts } from './fonts.js';

const epOrder = (x: any) => (x && x.order != null ? x.order : 1e9);
const sortEps = (eps: any[]) => eps.slice().sort((a, b) => (epOrder(a) - epOrder(b)) || (a.date || '').localeCompare(b.date || '') || (a.id || '').localeCompare(b.id || ''));

// 상태 토스트(서재의 #lib-status 대용 — reader.html엔 상단바가 없어 화면 하단에 잠깐 띄움).
let statusTimer: any = null;
function setStatus(msg: string) {
  let el = document.getElementById('reader-status');
  if (!el) { el = document.createElement('div'); el.id = 'reader-status'; el.className = 'reader-status'; el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
  el.textContent = msg;
  if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
  if (msg) statusTimer = setTimeout(() => { el!.textContent = ''; }, 3500);
}

let allLogs: any[] = [];
let metaByChar: Record<string, any> = {};
let readerUser: any = null;
let curView = '';   // 현재 그린 화 id — 백엔드 교체(로그인) 재렌더 시 이 화가 살아있으면 다시 안 그림(스크롤 보존)
let loadFailed = false;   // 로그 로딩이 (클라우드·로컬 모두) 실패했는지 — 리더가 무한 "불러오는 중"에 안 갇히게 안내용
// 네트워크/Storage/막힌 DB 승급으로 영영 안 멈추게 시간제한 — {ok,v}로 성공·실패 구분.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<{ ok: boolean; v?: T }> {
  return Promise.race([
    Promise.resolve(p).then((v) => ({ ok: true, v })).catch(() => ({ ok: false })),
    new Promise<{ ok: boolean }>((res) => setTimeout(() => res({ ok: false }), ms)),
  ]);
}
async function reloadLogs() {
  // 1) 현재 백엔드(로그인=클라우드) 우선. 2) 멈추거나 실패하면 로컬 미러로 폴백 — 클라우드가 막혀도 보관된 화는 뜬다.
  let got = await withTimeout(logsAll(), 8000);
  if (!got.ok) { try { got = await withTimeout(LocalBackend.logsAll(), 5000); } catch (_) { got = { ok: false }; } }
  if (got.ok && got.v) { try { allLogs = dedupeLogList(got.v).kept; loadFailed = false; } catch (_) {} }
  else { loadFailed = true; }   // 둘 다 실패 — 기존 allLogs 유지(빈 채로 안 덮음)
  let gm = await withTimeout(metaAll(), 8000);
  if (!gm.ok) { try { gm = await withTimeout(LocalBackend.metaAll(), 5000); } catch (_) { gm = { ok: false }; } }
  if (gm.ok && gm.v) { metaByChar = {}; for (const m of (gm.v as any[])) if (m && m.char) metaByChar[m.char] = m; }
}

const rlog = createReaderLog({
  setStatus, reloadLogs, getAllLogs: () => allLogs, route, getUser: () => readerUser,
  nameOf: (char: string) => (metaByChar[char] && metaByChar[char].name) || char,
  isLoadFailed: () => loadFailed,
});

// 내 서재(#/log) 진입 시에만 클라우드 1회 init(로그인=백엔드 교체+실시간). 공유는 안 거침.
let cloudInited = false;
function ensureCloud() {
  if (cloudInited) return; cloudInited = true;
  (async () => {
    try {
      const A = await import('./auth.js');
      if (!A.authAvailable()) return;
      const { initSync } = await import('./sync.js');
      // 백엔드 교체(로그인)·실시간 변경 모두 데이터만 조용히 갱신. ★읽던 화가 그대로 있으면 재렌더 안 함
      //   → 긴 화를 읽다 "진입 직후 동기화"로 위로 튀던 것 방지. 처음 진입 때 화가 비어 있던 경우엔 다시 그림.
      initSync(() => { reloadLogs().then(() => { if (curView && allLogs.some((r: any) => r.id === curView)) return; route(); }); }, async () => { await reloadLogs(); });
      A.watchAuth((u: any) => { readerUser = u || null; });
    } catch (e) { console.warn('[reader cloud] 로드 실패', e); }
  })();
}

async function route() {
  const h = location.hash || '';
  let m = /^#\/share\/([^/]+)\/(\d+)$/.exec(h);
  if (m) { renderSharedSeriesEp(decodeURIComponent(m[1]), +m[2], route); return; }      // 공유 작품의 한 화
  m = /^#\/share\/([^/]+)$/.exec(h);
  if (m) { renderShare(decodeURIComponent(m[1]), route); return; }                        // 공유 링크(단일/작품)
  m = /^#\/log\/([^/]+)\/([^/]+)$/.exec(h);
  if (m) { ensureCloud(); curView = decodeURIComponent(m[2]); rlog.renderSingleLog(decodeURIComponent(m[1]), curView); return; }   // 내 화 열람
  m = /^#\/read\/([^/]+)(?:\/([^/]+))?$/.exec(h);
  if (m) {   // 옛 링크 호환: 이어읽기/읽기/처음부터 → 단일 화로.
    ensureCloud();
    const c = decodeURIComponent(m[1]);
    let ep = m[2] ? decodeURIComponent(m[2]) : '';
    if (!ep) { const eps = sortEps(allLogs.filter((r: any) => r.char === c)); const rd = loadRead(); ep = (rd.lastByChar && rd.lastByChar[c]) || (eps[0] && eps[0].id) || ''; }
    if (ep) location.hash = '#/log/' + encodeURIComponent(c) + '/' + encodeURIComponent(ep);
    else location.replace('library.html#/series/' + encodeURIComponent(c));   // 화 없으면 작품 페이지(서재)
    return;
  }
  // 공유·읽기 외 해시(#/·#/series 등)·빈 해시 → 서재가 처리.
  location.replace('library.html' + h);
}

window.addEventListener('hashchange', route);
// ★초기 라우팅 일원화: 로그를 먼저 로드한 뒤 route() — 폰트가 빈 allLogs로 route()를 앞질러 부르면
//   #/log가 빈 데이터로 #/series로 튕겼다(데스크탑 진입 실패). 폰트는 그 다음에 로드하고 route() 재호출(반영).
(async () => {
  await reloadLogs();
  route();
  // 첫 로드가 비었으면(막힌 v7 승급·지연 등) 잠깐씩 재시도하며 풀리는 즉시 재렌더 — "불러오는 중"에 안 갇히게.
  for (let i = 0; i < 6 && !allLogs.length; i++) { await new Promise((r) => setTimeout(r, 1000)); await reloadLogs(); route(); }
  if (fontsSupported()) { try { await refreshFonts(); route(); } catch (_) {} }
})();
