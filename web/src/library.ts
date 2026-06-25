// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/library.ts — 서재(보관함) = 에디터와 분리된 독립 페이지/플랫폼.
// 해시 라우팅: #/(서가) · #/read/:char(뷰어). 데이터는 store.ts(IndexedDB/localStorage)로 에디터와 공유.
// 화 HTML은 살균 후 본문 DOM에 직접 렌더(연속 스크롤·테마·줌). 본인 로그 + 살균이라 안전.
// @ts-nocheck
import { logsAll, logsAdd, logsDelete, loadRead, saveRead, loadReaderCfg, saveReaderCfg, metaGet, metaSet, metaDelete, metaAll, newWorkKey, idbDeleteWorkCard, getBackendKind, kvLoad, kvSave, isSessionSynced, markSessionSynced, OPEN_LOG_KEY, dedupeLogList, dedupeLogsInStore, blobsPutAssetMap, scanWorkSizes, deleteWorkLogs } from './store.js';
import { mountAccountUI } from './accountUI.js';   // 계정 UI(가벼움) — 에디터와 공용
import { richCopy } from './clipboard.js';         // 리치 복사(아카 붙여넣기) — 에디터와 공용
import { desktopAvailable, externalCount, bakeLogs } from './bake.js';   // 이미지 굳히기(데스크탑 전용)
import { translateAvailable, translateUnits, getWorkPrompt, setWorkPrompt, openTranslateSettings, ensureTranslateReady } from './translate.js';   // 로그 번역(웹·데스크탑)
import { cleanUnits, getCleanPrompt, setCleanPrompt, makeCleanFn, ensureCleanReady } from './cleanup.js';   // 가져온 로그 군더더기 정리(1차 결정론 + 2차 LLM·작품별 프롬프트)
import { createReaderLog, fattenShareHtml } from './readerLog.js';   // 번역/정리 흐름 + 공유 fatten(이미지 임베드+내 입력 가리기) 공용
import { popAutoClose } from './readerView.js';   // 공유 팝오버 바깥 탭=닫힘(리더 단일화 공유와 거동 통일)
import { isLocalFirst, getSyncMode, shareBaseUrl, isDesktop } from './desktopSync.js';   // 로컬-퍼스트(데스크탑 OR 웹-수동) + 수동 동기화 상태 + 플랫폼
import { mountUpdateBanner } from './updateBanner.js';   // 자동 업데이트 배너(데스크탑 전용)
import { buildBackup, parseBackup, isZip } from '../../core/preset/backupZip.js';   // 서재 내보내기/가져오기=zip(이미지 분리)
import { fontsSupported, refreshFonts, getFontList } from './fonts.js';   // 커스텀 폰트(리더·보관함 글꼴)
import { icon } from './icons.js';                 // 통일 라인 아이콘(currentColor) — 이모지 대체
import { confirmModal } from './confirmModal.js';  // 공용 DOM 확인 모달(네이티브 confirm 대체 — Electron 포커스 버그 회피)
import { mountSettingsMenu } from './settingsMenu.js';  // 앱-레벨 ⚙ 설정(서재 홈 단독 소유): 로그인·테마·스킨·화질·백업·Pro1·고급
// auth.js / sync.js(무거운 Firebase)는 첫 렌더 뒤 동적 import.
import { convertText } from '../../core/convert/convertText.js';
import { defaultSettings } from '../../core/preset/bundle.js';
import { parseRisuLog, splitMessages, stripGigaTrans } from '../../core/import/risuLog.js';
import { TEMPLATE_DEFS, TEMPLATE_ORDER } from '../../core/convert/templates/registry.js';
// 작품 에셋 일괄 입히기(charx/png/risum → 저장된 로그 html의 이미지 태그를 실제 이미지로 후처리)
import { parseCard } from '../../core/card/parseCard.js';
import { applyTagScheme, assetDataUrl } from '../../core/card/assets.js';
import { decodeCharxAsset } from '../../core/card/charx.js';
import { decodeRisumAsset } from '../../core/card/risum.js';
import { getImagePatterns, extractTagFromMatch, processImageTags } from '../../core/convert/processImageTags.js';
import { resolveAssetCBS } from '../../core/convert/prepareBody.js';
import { resolveAssetMarkers } from '../../core/convert/risuMarkers.js';

// 화 정렬: 수동 order(작품 페이지에서 편집) 우선, 없으면 저장 날짜/id 순.
const epOrder = (x: any) => (x && x.order != null ? x.order : 1e9);
function sortEps(eps: any[]): any[] {
  return eps.slice().sort((a, b) => (epOrder(a) - epOrder(b)) || (a.date || '').localeCompare(b.date || '') || (a.id || '').localeCompare(b.id || ''));
}

const $ = (id: string) => document.getElementById(id)!;
const app = $('app');
const esc = (s: any) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const mk = (tag: string, cls?: string, text?: string): HTMLElement => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
// 공유 링크 모듈(무거운 Firebase 의존)은 "공유 버튼 클릭/공유 열람" 시에만 동적 로드.
const loadShare = () => import('./share.js');

// 로그인 사용자 추적(공유 가용성 판정용). watchAuth로 갱신.
let libUser: any = null;
let libAuthMod: any = null;   // 로드된 auth 모듈(고급 설정의 계정 삭제용)
// 공유 가능 여부 — ★공유는 저장소 백엔드와 무관(share.ts는 getDb/currentUser 직접 사용).
//   웹: 기존대로 백엔드가 firebase(=로그인)면 가능. 데스크탑: 로컬-퍼스트라도 로그인+온라인+연동허용이면 가능.
function shareAvailability(): { ok: boolean; reason: string } {
  if (isLocalFirst()) {
    if (getSyncMode() === 'off') return { ok: false, reason: 'off' };
    if (!libUser) return { ok: false, reason: 'login' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, reason: 'offline' };
    return { ok: true, reason: '' };
  }
  return getBackendKind() === 'firebase' ? { ok: true, reason: '' } : { ok: false, reason: 'login' };
}
function shareGateMessage(reason: string): string {
  if (reason === 'off') return '“연동 안 함(로컬 전용)” 모드에서는 공유할 수 없어요. 상단 “동기화”에서 모드를 바꾸면 공유할 수 있습니다.';
  if (reason === 'offline') return '공유는 인터넷 연결이 필요해요. 온라인 상태에서 다시 시도하세요.';
  return '공개 링크는 로그인해야 만들 수 있어요. 위쪽 “로그인”으로 로그인하세요.';
}

// ----- 도구 스킨/테마를 에디터와 동일하게(일관성) -----
function applyShellChrome() {
  try {
    const skin = localStorage.getItem('pro2-shell-skin'); if (skin) document.documentElement.dataset.skin = skin.replace(/^custom:.*/, 'aurora');
    const theme = localStorage.getItem('pro2-shell-theme');
    const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = (theme === 'light' || theme === 'dark') ? theme : (sysDark ? 'dark' : 'light');
  } catch (_) {}
}

// ----- 유틸 ----- (살균 sanitizeArchiveHtml은 readerView.ts로 이전)
const firstImg = (html: string) => { const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html || ''); return m ? m[1] : ''; };
// 공용 라이트박스: 이미지를 어두운 전체 오버레이 + 가운데 원본으로 확대. 아무 데나 탭/Esc로 닫힘(모바일 대응). 표지·에셋 재사용.
function openLightbox(src: string) {
  if (!src) return;
  const ov = document.createElement('div'); ov.className = 'lightbox';
  const img = document.createElement('img'); img.className = 'lightbox-img'; img.src = src; ov.appendChild(img);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  ov.addEventListener('click', close);   // 아무 데나(이미지 포함) 탭=닫힘
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
}
const isMobileLib = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
// 모바일 서재 상단 헤더 자동 숨김: 아래로 스크롤하면 헤더를 위로 슬라이드 아웃, 위로 올리면 복귀.
//   ★루프 차단 핵심: 헤더(전역 .lib-topbar + 인페이지 바)를 position:fixed 오버레이로 흐름에서 빼고,
//   스크롤러엔 헤더 합산 높이만큼 "고정" 패딩을 둔다. 숨김은 transform만 → 스크롤러의 높이·scrollTop이
//   전혀 안 변함 → "숨김이 스크롤을 일으켜 다시 토글"하던 피드백 루프(지진·맨위복귀)가 원천 차단된다.
//   본문은 오버레이 아래로 스크롤되므로 숨길 때 그 공간이 실제로 회수된다(음수 margin 방식 폐기).
//   로그 열람 리더(reader-scroll)는 자체 탭-토글이 있어 제외 — 호출처는 홈·작품 페이지뿐.
function autoHideBar(scroller: HTMLElement, bars: (HTMLElement | null)[]) {
  if (!isMobileLib()) return;
  const list = bars.filter(Boolean) as HTMLElement[];
  if (!list.length) return;
  let offset = 0;                                            // 위에서부터 누적 top 오프셋
  for (const b of list) {
    b.classList.add('auto-hide-bar');
    b.style.transform = '';                                  // 표시 상태로 시작(공유 .lib-topbar의 직전 숨김 잔재 리셋)
    b.style.top = offset + 'px';
    b.dataset.ahHide = (offset + b.offsetHeight) + '';       // 숨길 때 위로 밀 거리 = 자기 top + 높이(완전히 화면 밖)
    offset += b.offsetHeight;
  }
  scroller.style.paddingTop = (offset + 10) + 'px';          // 합산 높이 + 약간의 여백("고정" 패딩 → 레이아웃 불변)
  const setHidden = (hide: boolean) => { for (const b of list) b.style.transform = hide ? `translateY(-${b.dataset.ahHide}px)` : ''; };
  let lastY = scroller.scrollTop, ticking = false;
  scroller.addEventListener('scroll', () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const y = scroller.scrollTop;
      const max = scroller.scrollHeight - scroller.clientHeight;
      if (y <= 4) { setHidden(false); lastY = y; return; }   // 맨 위 = 항상 표시
      if (y >= max - 4) { lastY = y; return; }               // 맨 아래 근처 = 토글 금지(clamp 가짜 스크롤 무시)
      if (Math.abs(y - lastY) < 12) return;                  // 넉넉한 임계값(깜빡임 방지)
      setHidden(y > lastY);                                  // 아래로 → 숨김 / 위로 → 표시
      lastY = y;
    });
  }, { passive: true });
}
// (리더 설정 rdCfg는 readerView.ts로 이전 — 서재[홈·작품]는 리더 설정을 안 씀.)
const previewLine = (r: any) => { const t = String(r.input || '').replace(/<[^>]*>/g, '').replace(/\{\{[^}]*\}\}/g, '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim(); return t ? t.slice(0, 60) : ''; };
function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function downloadBytes(name: string, bytes: Uint8Array, mime: string) {
  const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
// 상태 메시지 = 일시 토스트. 표시 후 자동으로 비운다. 새 메시지가 오면 이전 자동-지움 타이머를
//   취소해(가드) 새 메시지가 조기 삭제되지 않게 한다. aria-live는 요소에 그대로 유지(텍스트만 갱신).
let statusTimer: any = null;
function setStatus(msg: string) {
  const s = document.getElementById('lib-status'); if (!s) return;
  if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
  s.textContent = msg;
  if (msg) statusTimer = setTimeout(() => { s.textContent = ''; statusTimer = null; }, 3500);
}

// ----- 상태 -----
let allLogs: any[] = [];
let metaByChar: Record<string, any> = {};   // 작품 메타(표지/설명) — 목록에서 사용자 지정 표지 반영용
let archiveQuery = '';
let archiveSort: 'recent' | 'oldest' | 'title' = 'recent';

// 네트워크/Storage 지연으로 영원히 멈추지 않게 타임아웃 보호(지나면 직전 값/빈 값 사용, 실시간 갱신이 뒤따름).
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);
}
async function reloadLogs() {
  const raw = await withTimeout(logsAll(), 7000, allLogs || []);
  allLogs = dedupeLogList(raw).kept;   // 표시 안전망: 같은 화가 2벌이어도 화면엔 1벌로(정리 스윕 전에도)
  const ms = await withTimeout(metaAll(), 7000, [] as any[]);
  metaByChar = {}; for (const m of ms) if (m && m.char) metaByChar[m.char] = m;
}
// 저장소의 실제 중복을 정리(로컬+클라우드). 정리되면 다시 그린다.
async function cleanupDuplicates() {
  try {
    const removed = await dedupeLogsInStore();
    if (removed > 0) { await reloadLogs(); routePreservingScroll(); lastDataSig = dataSig(); setStatus(`중복된 화 ${removed}개를 정리했습니다.`); }
  } catch (_) {}
}
// 동기화 재렌더 게이트: 로그/메타의 (id·savedAt) 지문. 직전과 같으면 실시간 콜백이 재렌더를 건너뜀.
let lastDataSig = '';
function dataSig(): string {
  const logs = (allLogs || []).map((l: any) => l.id + ':' + (l.savedAt || 0)).sort().join('|');
  const metas = Object.keys(metaByChar || {}).sort().map((c) => c + ':' + ((metaByChar[c] && metaByChar[c].savedAt) || 0)).join('|');
  return logs + '#' + metas;
}
// 메타(표지/설명) 한 작품만 캐시 갱신 — 변경 즉시 서재 목록에 반영(새로고침 불필요).
async function syncMetaCache(char: string) { try { const mm = await metaGet(char); if (mm) metaByChar[char] = mm; else delete metaByChar[char]; } catch (_) {} }

// 작품 표시 이름 = meta.name(사용자가 바꾼 이름) || char(불변 작품 키 — 기존엔 이름이기도 함).
// char는 절대 안 바뀌는 키(그룹핑·라우팅·읽기상태·공유), 사람이 보는 글자만 이 함수로.
const nameOf = (char: string): string => {
  const n = metaByChar[char] && metaByChar[char].name;
  if (n) return n;
  // ★불변 작품키(wk_…)는 절대 화면에 노출 금지 — meta.name이 없거나 안 실려도 raw 키 대신 사람이 읽을 폴백.
  return /^wk_[a-z0-9]+$/i.test(char) ? '이름 없는 작품' : char;
};

// 작품(캐릭터)별 묶음 — 기본(검색/정렬 미적용). 홈 선반·전체목록·작품상세가 공유.
function seriesBase(): any[] {
  const groups: Record<string, any[]> = {};
  for (const r of allLogs) { (groups[r.char] || (groups[r.char] = [])).push(r); }
  // 빈 작품(메타만 있고 화 0)도 포함 → "+ 새 작품"으로 만들고 화 쓰기 전에도 서재에 보임.
  for (const char of Object.keys(metaByChar)) if (!groups[char]) groups[char] = [];
  const read = loadRead();
  const lastAt = read.lastReadAt || {};
  return Object.keys(groups).map((char) => {
    const eps = sortEps(groups[char]);
    const latest = eps[eps.length - 1] || {};   // 빈 작품이면 {}(date 등 없음 → 표시 폴백)
    const unread = eps.filter((e) => !read.readIds[e.id]).length;
    const cover = (metaByChar[char] && metaByChar[char].cover) || eps.map((e: any) => firstImg(e.html)).find(Boolean) || '';   // 사용자 지정 표지 우선
    const lastReadId = read.lastByChar[char];
    const readIdx = lastReadId ? eps.findIndex((e: any) => e.id === lastReadId) : -1;
    // 표시이름: meta.name 우선 → 로그에 저장된 표시이름(workName, meta 실패 대비) → wk_ 하드닝 폴백.
    const logName = eps.map((e: any) => e.workName).find(Boolean) || '';
    const name = (metaByChar[char] && metaByChar[char].name) || logName || nameOf(char);
    return { char, name, eps, count: eps.length, latest, cover, fav: !!read.fav[char], unread, lastReadId, readIdx, lastReadAt: lastAt[char] || 0 };
  });
}
// 전체 목록용: 검색 + 정렬 적용.
function seriesList(): any[] {
  const q = archiveQuery.trim().toLowerCase();
  let series = seriesBase();
  if (q) series = series.filter((s) => (s.name + ' ' + s.char + ' ' + s.eps.map((e: any) => e.title + ' ' + e.input).join(' ')).toLowerCase().includes(q));
  const cmp: Record<string, (a: any, b: any) => number> = {
    recent: (a, b) => (b.latest.date || '').localeCompare(a.latest.date || '') || (b.latest.id || '').localeCompare(a.latest.id || ''),
    oldest: (a, b) => ((a.eps[0] && a.eps[0].date) || '').localeCompare((b.eps[0] && b.eps[0].date) || '') || ((a.eps[0] && a.eps[0].id) || '').localeCompare((b.eps[0] && b.eps[0].id) || ''),
    title: (a, b) => a.name.localeCompare(b.name, 'ko'),
  };
  series.sort(cmp[archiveSort] || cmp.recent);
  series.sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0));
  return series;
}

// 한 작품의 세로 행(전체 작품 목록). refresh = 별표 토글 후 다시 그릴 함수.
function shelfRow(s: any, refresh: () => void): HTMLElement {
  const row = document.createElement('div'); row.className = 'lib-shelf';
  const cover = document.createElement('div'); cover.className = 'lib-cover';
  if (s.cover) { const im = document.createElement('img'); im.src = s.cover; im.loading = 'lazy'; cover.appendChild(im); } else cover.textContent = s.name.slice(0, 2);
  const meta = document.createElement('div'); meta.className = 'lib-meta';
  const nm = document.createElement('div'); nm.className = 'lib-name'; nm.textContent = s.name;
  const sub = document.createElement('div'); sub.className = 'lib-sub';
  sub.textContent = s.count ? (`${s.count}화 · 최근 ${s.latest.date || ''}` + (s.unread ? ` · 안 읽음 ${s.unread}` : ' · 다 읽음')) : '아직 화 없음';
  const prev = document.createElement('div'); prev.className = 'lib-preview'; prev.textContent = previewLine(s.latest);
  meta.append(nm, sub, prev);
  const acts = document.createElement('div'); acts.className = 'lib-actions';
  const star = document.createElement('button'); star.className = 'lib-star' + (s.fav ? ' on' : ''); star.textContent = s.fav ? '★' : '☆'; star.title = '즐겨찾기';
  star.onclick = (e) => { e.stopPropagation(); const rd = loadRead(); rd.fav[s.char] = !rd.fav[s.char]; if (!rd.fav[s.char]) delete rd.fav[s.char]; saveRead(rd); refresh(); };
  const readB = document.createElement('button'); readB.className = 'lib-read primary';
  readB.textContent = s.count ? (s.readIdx >= 0 ? '이어 읽기' : '읽기') : '열기';
  readB.onclick = (e) => { e.stopPropagation(); location.hash = (s.count ? '#/read/' : '#/series/') + encodeURIComponent(s.char); };
  acts.append(star, readB);
  row.append(cover, meta, acts);
  row.onclick = () => { location.hash = '#/series/' + encodeURIComponent(s.char); };
  return row;
}

// ====== 서재 홈 (이어읽기·즐겨찾기·최근 선반 + 전체 작품) ======
const baseMeta = (s: any) => `${s.count}화` + (s.unread ? ` · 안읽음 ${s.unread}` : '');
const contMeta = (s: any) => `${s.readIdx + 1}화까지` + (s.unread ? ` · 안읽음 ${s.unread}` : ' · 완독');

function homeCard(s: any, metaText: string, destBase: string): HTMLElement {
  const card = document.createElement('button'); card.className = 'home-card';
  const cover = document.createElement('div'); cover.className = 'home-cover';
  if (s.cover) { const im = document.createElement('img'); im.src = s.cover; im.loading = 'lazy'; cover.appendChild(im); } else cover.textContent = s.name.slice(0, 2);
  const nm = document.createElement('div'); nm.className = 'home-card-name'; nm.textContent = s.name;
  const meta = document.createElement('div'); meta.className = 'home-card-meta'; meta.textContent = metaText;
  card.append(cover, nm, meta);
  card.onclick = () => { location.hash = destBase + encodeURIComponent(s.char); };
  return card;
}
function homeRow(label: string, arr: any[], metaFn: (s: any) => string, destBase: string): HTMLElement {
  const sec = document.createElement('section'); sec.className = 'home-row';
  const h = document.createElement('h2'); h.className = 'home-h'; h.textContent = label; sec.appendChild(h);
  const track = document.createElement('div'); track.className = 'home-track';
  for (const s of arr) track.appendChild(homeCard(s, metaFn(s), destBase));
  sec.appendChild(track); return sec;
}

// 새 작품 만들기 — 이름(필수) + 표지(선택). 새 wk_ 키 + meta.name 등록 후 작품 페이지로 이동.
let createWorkModalOpen = false;   // ★단일 인스턴스 가드(겹침 방지)
function showCreateWorkModal() {
  if (createWorkModalOpen) return;
  createWorkModalOpen = true;
  const ov = mk('div', 'import-modal'); const card = mk('div', 'import-card');
  const close = () => { createWorkModalOpen = false; ov.remove(); };
  card.appendChild(mk('div', 'import-title', '새 작품 만들기'));
  const row = (label: string, el: HTMLElement) => { const r = mk('label', 'import-row'); r.append(mk('span', '', label), el); card.appendChild(r); return r; };
  const nameIn = document.createElement('input'); nameIn.type = 'text'; nameIn.placeholder = '작품 이름'; nameIn.maxLength = 300; row('작품 이름', nameIn);
  let coverData = '';
  const coverWrap = mk('div', 'cw-cover-row');
  const cov = document.createElement('img'); cov.style.cssText = 'width:64px;height:64px;object-fit:cover;border-radius:8px;display:none;';
  const pick = mk('button', '', '표지 고르기 (선택)');
  const fin = document.createElement('input'); fin.type = 'file'; fin.accept = 'image/*'; fin.style.display = 'none';
  pick.onclick = () => fin.click();
  fin.onchange = async () => { const f = fin.files && fin.files[0]; fin.value = ''; if (!f) return; try { coverData = await downscaleImage(f, 720); cov.src = coverData; cov.style.display = ''; pick.textContent = '표지 바꾸기'; } catch (_) {} };
  coverWrap.append(cov, pick, fin); row('표지', coverWrap);
  const btns = mk('div', 'import-btns');
  const go = mk('button', 'primary', '만들기') as HTMLButtonElement;
  const cancel = mk('button', '', '취소'); cancel.onclick = close;
  go.onclick = async () => {
    const name = nameIn.value.trim(); if (!name) { nameIn.focus(); return; }
    go.disabled = true; go.textContent = '만드는 중…';
    const char = newWorkKey();
    try { await metaSet({ char, name, cover: coverData || '', desc: '' }); } catch (_) {}
    await reloadLogs(); close();
    location.hash = '#/series/' + encodeURIComponent(char);
  };
  btns.append(go, cancel); card.appendChild(btns);
  ov.appendChild(card); document.body.appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  setTimeout(() => { try { nameIn.focus(); } catch (_) {} }, 0);
}

function renderHome() {
  app.innerHTML = '';
  const head = document.createElement('div'); head.className = 'archive-head';
  const title = document.createElement('div'); title.className = 'archive-title'; title.innerHTML = icon('book') + ' 서재';
  const search = document.createElement('input'); search.type = 'search'; search.className = 'archive-search'; search.placeholder = '검색 (작품·제목·본문)'; search.value = archiveQuery;
  const chatBtn = document.createElement('button'); chatBtn.innerHTML = icon('message') + ' 채팅 가져오기';
  const expBtn = document.createElement('button'); expBtn.textContent = '전체 내보내기';
  const impBtn = document.createElement('button'); impBtn.textContent = '가져오기';
  head.append(title, search, chatBtn, expBtn, impBtn);
  // 전체 굳히기(서재 모든 로그의 외부 이미지 영구 박제) — 데스크탑 앱 전용.
  if (desktopAvailable()) {
    const bakeAllBtn = document.createElement('button'); bakeAllBtn.innerHTML = icon('flame') + ' 전체 굳히기';
    bakeAllBtn.title = '서재 전체 로그의 외부 링크 이미지를 한 번에 영구 박제(원본 화질)';
    bakeAllBtn.onclick = async () => {
      const total = allLogs.reduce((n, r) => n + externalCount(r.html || ''), 0);
      if (!total) { setStatus('굳힐 외부 이미지가 없습니다 — 서재 전체가 이미 영구 보관 상태예요.'); return; }
      if (!(await confirmModal(`서재 전체에서 외부(핫링크) 이미지 ${total}장을 받아 영구 박제할까요?\n시간이 걸릴 수 있고, 죽은 링크는 그대로 남습니다.`, { okText: '굳히기' }))) return;
      bakeAllBtn.disabled = true;
      await runBakeFlow(allLogs.slice(), '서재 전체');
      renderHome();
    };
    head.append(bakeAllBtn);
  }
  app.appendChild(head);

  // ── 스튜디오 만들기 존(주인공): + 새 작품 / 빠른 제작 ──
  // ★스크롤러 body 안(renderBody)에서 그린다 — app에 직접 붙이면 모바일에서 고정 상단바(autoHideBar) 뒤로
  //   깔리고 transform에 휩쓸린다. body 첫 항목이면 상단바 클리어런스 padding을 상속하고 transform과 분리된다.
  const makeStudio = () => {
    const studio = document.createElement('div'); studio.className = 'studio-create';
    const newWorkBtn = mk('button', 'studio-btn primary'); newWorkBtn.innerHTML = icon('plus') + ' 새 작품';
    newWorkBtn.title = '이름(과 표지)을 정해 새 작품 한 권을 만들고 첫 화를 씁니다';
    newWorkBtn.onclick = () => showCreateWorkModal();
    const quickBtn = mk('button', 'studio-btn'); quickBtn.innerHTML = icon('pencil') + ' 빠른 제작';
    quickBtn.title = '작품을 안 정하고 바로 편집기에서 작성 — 보관할 때 어느 작품에 넣을지 고릅니다';
    quickBtn.onclick = () => { location.href = 'index.html?new=1'; };
    studio.append(newWorkBtn, quickBtn);
    return studio;
  };

  const body = document.createElement('div'); body.className = 'archive-list lib-home'; app.appendChild(body);

  chatBtn.onclick = () => importChatLog();
  expBtn.onclick = async () => {
    let metas: any[] = []; try { metas = await metaAll(); } catch (_) {}   // 작품 표지·소개도 함께(예전엔 빠졌음)
    const data = { app: 'log-jejogi-pro2', kind: 'log-archive', version: 2, logs: allLogs, meta: metas };
    // ★zip 한 파일(이미지 분리). 로그 html의 data:이미지가 많아도 안 부풀고 안 멈춤. 실패 시 json 폴백.
    try { downloadBytes('log-archive.zip', buildBackup(data), 'application/zip'); }
    catch (_) { download('log-archive.json', JSON.stringify(data, null, 2)); }
  };
  impBtn.onclick = () => importLogs();
  search.oninput = () => { archiveQuery = search.value; renderBody(); };
  autoHideBar(body, [document.querySelector('.lib-topbar'), head]);   // 모바일: 전역 헤더 + 검색바를 오버레이 스택으로 통째 숨김

  function fullListSection(withSort: boolean): HTMLElement {
    const sec = document.createElement('section'); sec.className = 'home-all';
    const bar = document.createElement('div'); bar.className = 'home-all-bar';
    const h = document.createElement('h2'); h.className = 'home-h'; h.textContent = archiveQuery.trim() ? '검색 결과' : '전체 작품';
    bar.appendChild(h);
    if (withSort) {
      const sort = document.createElement('select'); sort.className = 'lib-sort';
      [['recent', '최근 화 순'], ['oldest', '오래된 순'], ['title', '작품 이름순']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sort.appendChild(o); });
      sort.value = archiveSort; sort.onchange = () => { archiveSort = sort.value as any; renderBody(); };
      bar.appendChild(sort);
    }
    sec.appendChild(bar);
    const listWrap = document.createElement('div'); listWrap.className = 'lib-shelves'; sec.appendChild(listWrap);
    const series = seriesList();
    if (!series.length) {
      const e = document.createElement('div'); e.className = 'archive-empty';
      const art = document.createElement('div'); art.className = 'empty-art'; art.innerHTML = icon('book'); e.appendChild(art);
      e.appendChild(mk('div', 'studio-empty-h', '검색 결과가 없어요'));
      e.appendChild(mk('div', 'studio-empty-sub', '다른 단어로 찾아보거나, 위에서 검색어를 지워보세요.'));
      listWrap.appendChild(e); return sec;
    }
    for (const s of series) listWrap.appendChild(shelfRow(s, renderBody));
    return sec;
  }

  function renderBody() {
    body.innerHTML = '';
    if (!seriesBase().length) {   // 진짜 빈 서재(작품 0개) = 큰 CTA
      const e = document.createElement('div'); e.className = 'archive-empty studio-empty';
      const art = document.createElement('div'); art.className = 'empty-art'; art.innerHTML = icon('flame'); e.appendChild(art);
      e.appendChild(mk('div', 'studio-empty-h', '아직 작품이 없어요'));
      e.appendChild(mk('div', 'studio-empty-sub', '첫 작품을 만들어 로그를 모아보세요. 가볍게 써보려면 “빠른 제작”도 좋아요.'));
      const cta = mk('button', 'primary studio-empty-cta'); cta.innerHTML = icon('plus') + ' 첫 작품 만들기'; cta.onclick = () => showCreateWorkModal();
      e.appendChild(cta); body.appendChild(e); return;
    }
    body.appendChild(makeStudio());   // 만들기 존 = 스크롤러 첫 항목(모바일 상단바 안 가림·이어읽기 위)
    if (archiveQuery.trim()) { body.appendChild(fullListSection(false)); return; } // 검색 = 결과 목록만
    const base = seriesBase();
    const cont = base.filter((s) => s.readIdx >= 0).sort((a, b) => b.lastReadAt - a.lastReadAt);
    const favs = base.filter((s) => s.fav).sort((a, b) => b.lastReadAt - a.lastReadAt || (b.latest.date || '').localeCompare(a.latest.date || ''));
    const recent = [...base].sort((a, b) => (b.latest.date || '').localeCompare(a.latest.date || '') || (b.latest.id || '').localeCompare(a.latest.id || '')).slice(0, 12);
    if (cont.length) body.appendChild(homeRow('이어 읽기', cont, contMeta, '#/read/'));
    if (favs.length) body.appendChild(homeRow('즐겨찾기 ★', favs, baseMeta, '#/series/'));
    if (recent.length) body.appendChild(homeRow('최근 추가', recent, baseMeta, '#/series/'));
    body.appendChild(fullListSection(true));
  }
  renderBody();
  applyPendingScroll(body);   // 백그라운드 갱신 재렌더면 스크롤 위치 복원(명시적 이동은 pendingScrollY=-1 → 맨 위)
}

// ====== 뷰어 ======
// 연속 스크롤 뷰어(renderReader)·목차(toggleToc)는 폐기 — 모든 읽기는 단일 화(renderSingleLog).
// #/read는 라우터가 #/log(단일 화)로 리다이렉트한다.

// (리더 본문·페이저·타이포·설정·공유 열람 = readerView.ts/readerLog.ts로 이전. 여기엔 서재[홈·작품]만.)

// 작품 공유 상태(작품→공유 인덱스 id) — 동기화 KV에 보관(다른 기기서도 공유 해제 가능).
const SERIES_SHARE_KEY = 'pro2-series-shares';
const loadSeriesShares = (): Record<string, string> => { const o = kvLoad(SERIES_SHARE_KEY); return (o && typeof o === 'object') ? o : {}; };
const seriesShareId = (char: string): string => loadSeriesShares()[char] || '';
function setSeriesShareId(char: string, id: string) { const m = loadSeriesShares(); if (id) m[char] = id; else delete m[char]; kvSave(SERIES_SHARE_KEY, m); }

function shareUrlFor(id: string): string { return shareBaseUrl() + '#/share/' + encodeURIComponent(id); }

// 작품(시리즈) 공유 팝오버: 작품 전체를 한 링크로 공개(화별 공유 문서 + 인덱스). 로그인 필요.
function toggleSeriesSharePop(host: HTMLElement, s: any, btn: HTMLElement) {
  const exist = host.querySelector('.share-pop') as HTMLElement | null;
  if (exist) { exist.remove(); return; }
  host.style.position = host.style.position || 'relative';
  const pop = document.createElement('div'); pop.className = 'reader-settings share-pop'; host.appendChild(pop);
  popAutoClose(pop, btn);   // 바깥 아무 곳 탭 = 닫힘(리더 단일화 공유와 통일). 모바일 위치는 CSS에서 중앙 시트로 보정.
  const draw = () => {
    pop.innerHTML = '';
    pop.appendChild(mk('div', 'share-title', '작품 통째 공유'));
    const av = shareAvailability();
    if (!av.ok) { pop.appendChild(mk('div', 'share-note', shareGateMessage(av.reason))); return; }
    // ★내 입력 가리기 — 공유본에서만 user 메시지 제거(★내 서재 로그 불변). 마지막 선택 기억. 만들기·내용갱신 둘 다 적용.
    const hideWrap = document.createElement('label'); hideWrap.className = 'import-check'; (hideWrap as HTMLElement).style.margin = '0 0 8px';
    const hideChk = document.createElement('input'); hideChk.type = 'checkbox';
    try { hideChk.checked = localStorage.getItem('pro2-share-hideuser') === '1'; } catch (_) {}
    hideChk.onchange = () => { try { localStorage.setItem('pro2-share-hideuser', hideChk.checked ? '1' : '0'); } catch (_) {} };
    hideWrap.append(hideChk, document.createTextNode(' 내 입력 가리기 (공유본에서 내 메시지 빼기 — 내 서재는 그대로)'));
    pop.appendChild(hideWrap);
    const sid = seriesShareId(s.char);
    if (sid) {
      pop.appendChild(mk('div', 'share-note', `이 작품 ${s.count}화를 누구나 링크로 읽을 수 있습니다.`));
      const row = mk('div', 'share-link-row');
      const input = document.createElement('input'); input.type = 'text'; input.readOnly = true; input.className = 'share-link'; input.value = shareUrlFor(sid); input.onclick = () => input.select();
      const copyB = mk('button', 'primary', '링크 복사') as HTMLButtonElement;
      copyB.onclick = async () => { try { await navigator.clipboard.writeText(input.value); copyB.textContent = '복사됨!'; } catch (_) { input.select(); copyB.textContent = 'Ctrl+C'; } setTimeout(() => { copyB.textContent = '링크 복사'; }, 1400); };
      row.append(input, copyB); pop.appendChild(row);
      const acts = mk('div', 'share-actions');
      const reB = mk('button', '', '내용 갱신') as HTMLButtonElement; reB.title = '화 추가/수정 후 최신 내용으로 다시 공유';
      reB.onclick = async () => { await doShareSeries(s, pop, draw, undefined, hideChk.checked); };
      const unB = mk('button', 'series-del', '공유 해제') as HTMLButtonElement;
      unB.onclick = async () => { unB.disabled = true; try { const S = await loadShare(); await S.deleteSeriesShare(sid); setSeriesShareId(s.char, ''); btn.innerHTML = icon('link') + ' 작품 공유'; setStatus('작품 공유를 해제했습니다.'); draw(); } catch (e: any) { setStatus('해제 실패: ' + ((e && e.message) || '')); unB.disabled = false; } };
      acts.append(reB, unB); pop.appendChild(acts);
    } else {
      pop.appendChild(mk('div', 'share-note', `이 작품 ${s.count}화 전체를 누구나 볼 수 있는 링크로 공개합니다 (이미지 포함, 읽기전용).`));
      const makeB = mk('button', 'primary share-make') as HTMLButtonElement; makeB.innerHTML = icon('link') + ' 작품 공유 링크 만들기';
      makeB.onclick = async () => { await doShareSeries(s, pop, draw, makeB, hideChk.checked); };
      pop.appendChild(makeB);
    }
  };
  draw();
}
// 작품 공유 생성/갱신(화별 공유 문서 N개 + 인덱스). 진행률 표시.
async function doShareSeries(s: any, pop: HTMLElement, redraw: () => void, makeBtn?: HTMLButtonElement, hideUser?: boolean) {
  const prev = seriesShareId(s.char);
  const note = pop.querySelector('.share-note') as HTMLElement | null;
  if (makeBtn) { makeBtn.disabled = true; makeBtn.textContent = '만드는 중…'; }
  try {
    const S = await loadShare();
    const episodes = await Promise.all(s.eps.map(async (e: any) => ({ char: s.char, title: e.title, date: e.date, html: await fattenShareHtml(e, !!hideUser), hideUser: !!hideUser })));   // ★공유본: 이미지 임베드(마른 레코드 복원) + 내 입력 가리기(원본 불변)
    // 표지·소개도 함께 공유 → 공유 열람 화면이 작품 페이지처럼 보임.
    let cm: any = {}; try { cm = (await metaGet(s.char)) || {}; } catch (_) {}
    let cover = cm.cover || s.cover || '';
    if (cover) { try { cover = await downscaleDataUrl(cover, 480); } catch (_) {} }   // 인덱스 문서 가볍게(JPEG 480px)
    const desc = (cm.desc != null && String(cm.desc).trim() !== '') ? String(cm.desc) : (previewLine(s.eps[0]) || '');
    const res = await S.createSeriesShare(s.char, s.char, episodes, (i: number, n: number) => { if (note) note.textContent = `만드는 중… (${i + 1}/${n}화)`; }, { cover, desc });
    if (prev) { try { await S.deleteSeriesShare(prev); } catch (_) {} }   // 옛 공유 정리(갱신)
    setSeriesShareId(s.char, res.id);
    try { await navigator.clipboard.writeText(shareUrlFor(res.id)); setStatus(`작품 공유 링크를 복사했습니다 (${res.count}화${res.failed ? `, ${res.failed}화는 이미지가 많아 제외` : ''}).`); }
    catch (_) { setStatus(`작품 공유 링크가 만들어졌습니다 (${res.count}화).`); }
    redraw();
  } catch (e: any) { setStatus('작품 공유 실패: ' + ((e && e.message) || '')); if (makeBtn) { makeBtn.disabled = false; makeBtn.innerHTML = icon('link') + ' 작품 공유 링크 만들기'; } }
}

// 서재 → 에디터로 특정 로그 열기(교차 페이지: 키 남기고 index.html로 이동).
// 로그 열람 → "편집기로": 통합 편집기를 수정 모드로 연다(index.html?log=<id>).
// id를 URL에 실어 보냄(새로고침 안전) → 그 로그 하나만 로드(세션복원 스킵)라 디자인 충돌이 구조적으로 없음.
function openInEditor(id: string) { location.href = 'index.html?log=' + encodeURIComponent(id); }

// 가져오기(JSON) → 보관함에 병합.
let fileInput: HTMLInputElement | null = null;
function importLogs() {
  if (!fileInput) {
    fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'application/json,.json,.zip,application/zip'; fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
    fileInput.addEventListener('change', async () => {
      const f = fileInput!.files && fileInput!.files[0]; if (!f) return;
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        const obj = isZip(buf) ? parseBackup(buf) : JSON.parse(new TextDecoder().decode(buf));   // zip(신규) 또는 옛 json
        const logs = Array.isArray(obj) ? obj : (obj && Array.isArray(obj.logs) ? obj.logs : []);
        let n = 0;
        const { logsAdd, metaSet } = await import('./store.js');
        for (const r of logs) {
          if (!r || typeof r !== 'object') continue;
          const rec: any = { id: String(r.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8))), char: String(r.char || '기타'), title: String(r.title || '(제목 없음)'), date: String(r.date || ''), input: String(r.input || ''), html: String(r.html || '') };
          if (r.template) rec.template = String(r.template);
          // ★모든 출력 디자인의 구조 데이터 보존(예전엔 diary만 받아 채팅·웹소설·카드블록이 누락됐음).
          for (const fld of ['diary', 'chat', 'webnovel', 'cardCfg']) if (r[fld] && typeof r[fld] === 'object') rec[fld] = r[fld];
          if (typeof r.userCardCss === 'string') rec.userCardCss = r.userCardCss;
          if (r.order != null) rec.order = r.order;
          await logsAdd(rec); n++;
        }
        // 작품 메타(표지·소개)도 함께 복원(있으면).
        let mn = 0;
        if (obj && Array.isArray(obj.meta)) {
          for (const m of obj.meta) {
            if (!m || !m.char) continue;
            const cover = (typeof m.cover === 'string' && (/^data:image\//i.test(m.cover) || /^https?:\/\//i.test(m.cover))) ? m.cover : '';
            const desc = String(m.desc || '').replace(/[<>]/g, '').slice(0, 5000);
            const name = String(m.name || '').replace(/[<>]/g, '').slice(0, 300);
            try { await metaSet({ char: String(m.char).slice(0, 300), cover, desc, name }); mn++; } catch (_) {}
          }
        }
        setStatus(`보관함에 ${n}건${mn ? ` · 작품정보 ${mn}건` : ''} 가져옴`); await reloadLogs(); route();
      } catch (e: any) { setStatus('가져오기 실패: ' + e.message); }
      fileInput!.value = '';
    });
  }
  fileInput.click();
}

// ====== 작품(시리즈) 상세 = "책 한 권" 페이지 ======
let seriesEditMode = false;     // 보기 ↔ 편집 토글
let dragFromIdx = -1;           // 드래그앤드롭 순서변경
let seriesCoverInput: HTMLInputElement | null = null;

// 표지 등 큰 이미지를 작게 줄여 dataURL로 — 작품 표지는 썸네일이면 충분(로그인 시 Storage/CORS 회피 + 빠름).
function downscaleImage(file: File, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.max(1, Math.round(w * r)); h = Math.max(1, Math.round(h * r)); }
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d'); if (!ctx) { resolve(String(rd.result)); return; }
        ctx.drawImage(img, 0, 0, w, h);
        try { resolve(c.toDataURL('image/jpeg', 0.85)); } catch (_) { resolve(String(rd.result)); }
      };
      img.onerror = () => reject(new Error('이미지 로드 실패'));
      img.src = String(rd.result);
    };
    rd.onerror = () => reject(new Error('파일 읽기 실패'));
    rd.readAsDataURL(file);
  });
}

// 이미 data URL인 이미지를 캔버스로 더 줄여 JPEG로(공유 인덱스 문서 가볍게). 실패하면 원본 반환.
function downscaleDataUrl(src: string, max: number): Promise<string> {
  return new Promise((resolve) => {
    if (!src || src.slice(0, 5) !== 'data:') { resolve(src || ''); return; }
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.max(1, Math.round(w * r)); h = Math.max(1, Math.round(h * r)); }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); if (!ctx) { resolve(src); return; }
      ctx.drawImage(img, 0, 0, w, h);
      try { resolve(c.toDataURL('image/jpeg', 0.82)); } catch (_) { resolve(src); }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

// (공유 작품 "이어 읽기" 진행도 shareProgress/setShareProgress = readerView.ts로 이전.)

// ====== 작품 에셋 일괄 입히기 ======
// 채팅 JSON으로 가져온 로그엔 카드가 없어 이미지 태그({{img::}}·<img src=>·[🌠|이름])가 그대로 남는다.
// 해당 봇의 카드 파일(charx/png/risum, 모듈봇이면 여러 개)을 받아, 작품 내 모든 로그의 저장 html에서
// 그 태그만 실제 이미지로 치환(외형은 그대로, 이미지만 입힘). 카드 데이터는 끝나면 폐기(저장 안 함).
const stripExt = (s: string) => String(s || '').replace(/\.[^.]+$/, '');
function assetByRefIn(p: any, ref: string): any {
  const A = p && p.assets; if (!Array.isArray(A)) return null;
  return A.find((a: any) => a.found && a.name === ref)
    || A.find((a: any) => a.found && stripExt(a.name) === ref)
    || A.find((a: any) => a.found && a.tag === ref) || null;
}
function decodeAssetUrl(p: any, a: any): string {
  if (a && !a.bytes && p.lazy) { if (p.format === 'charx') decodeCharxAsset(p._bytes, a); else decodeRisumAsset(p._bytes, a); }
  return assetDataUrl(a) || '';
}
// 한 로그의 html/input에서 이미지 참조명 수집(편집기 mappingsForInput과 동일 규칙).
function collectAssetRefs(text: string, into: Set<string>) {
  if (!text) return;
  const norm = (s: string) => s.replace(/″/g, '"');
  for (const re of getImagePatterns()) { for (const m of text.matchAll(re)) { const k = extractTagFromMatch(norm(m[0])); if (k) into.add(k); } }
  for (const m of text.matchAll(/\[[^\]|\n]*\|\s*([^\]\n]+?)\s*\]/g)) into.add(m[1].trim());
  for (const m of text.matchAll(/\{\{(?:raw|asset|source|emotion|image_asset)::\s*([^}]+?)\s*\}\}/g)) into.add(m[1].trim());
}
// 작품(char)의 모든 로그에 카드 파일들의 에셋을 입힌다. onStep(메시지)로 진행 보고. 반환={changed,mapped,refs}.
async function applyAssetsToSeries(char: string, files: File[], onStep?: (msg: string) => void): Promise<{ changed: number; mapped: number; refs: number }> {
  const logs = allLogs.filter((r) => r.char === char);
  // 1) 카드 파일 파싱(lazy: 대형도 색인만)
  const cards: any[] = [];
  for (const f of files) {
    if (onStep) onStep(`카드 읽는 중… ${f.name}`);
    try { const p = parseCard(new Uint8Array(await f.arrayBuffer()), f.name, { lazy: true }); applyTagScheme(p); cards.push(p); } catch (e: any) { if (onStep) onStep(`카드 실패: ${f.name}`); }
  }
  if (!cards.length) throw new Error('읽을 수 있는 카드 파일이 없습니다.');
  // 2) 작품 로그들에서 참조된 에셋명만 수집
  const refs = new Set<string>();
  for (const r of logs) { collectAssetRefs(r.html || '', refs); collectAssetRefs(r.input || '', refs); }
  // 3) 참조명 → dataURL (필요한 것만 디코드 = 대형 카드도 메모리 안전)
  const map: Record<string, string> = {};
  for (const ref of refs) {
    const key = ref.trim(); if (!key || map[key]) continue;
    for (const p of cards) { const a = assetByRefIn(p, key); if (a) { const u = decodeAssetUrl(p, a); if (u) { map[key] = u; break; } } }
  }
  const mapped = Object.keys(map).length;
  // 4) 각 로그 html 후처리(치환기 3종) → 바뀐 것만 저장
  const imgStyle: any = { size: 100, margin: 10, useBorder: false, borderColor: '#000000', useShadow: true };
  let changed = 0;
  for (let i = 0; i < logs.length; i++) {
    const r = logs[i];
    if (onStep) onStep(`에셋 입히는 중… (${i + 1}/${logs.length}화)`);
    let h = String(r.html || '');
    let nh = resolveAssetCBS(h, map);
    nh = processImageTags(nh, map, imgStyle);
    nh = resolveAssetMarkers(nh, map, imgStyle);
    if (nh !== h) { r.html = nh; try { await logsAdd(r); changed++; } catch (_) {} }
  }
  return { changed, mapped, refs: refs.size };
}

// ====== 이미지 굳히기(영구화) — 데스크탑 전용 ======
// 로그 html의 외부(핫링크) 이미지를 받아 data URL로 박제 → 원격 호스트가 죽어도 안 깨짐.
// 웹은 CORS·쿼터로 불가(desktopAvailable()===false면 호출부가 버튼 자체를 안 보여줌).
// onDone(report) 콜백에서 호출부가 화면을 다시 그린다(남은 외부 이미지 수 갱신).
async function runBakeFlow(logs: any[], label: string, onProgress?: (msg: string) => void): Promise<any | null> {
  const total = logs.reduce((n, r) => n + externalCount(r.html || ''), 0);
  if (!total) { setStatus('굳힐 외부 이미지가 없습니다 — 이미 영구 보관 상태예요.'); return null; }
  const step = onProgress || ((m: string) => setStatus(m));
  step(`${label} 굳히는 중… (외부 이미지 ${total}장)`);
  let res: any;
  try { res = await bakeLogs(logs, logsAdd, step); }
  catch (e: any) { setStatus('굳히기 실패: ' + ((e && e.message) || '')); return null; }
  await reloadLogs();
  let msg = `굳히기 완료 — 이미지 ${res.bakedImgs}/${res.totalExternal}장 박제, ${res.changedLogs}개 화 영구화`;
  if (res.failed.length) msg += ` · 실패 ${res.failed.length}장(죽은 링크는 그대로 보존)`;
  setStatus(msg);
  if (res.failed.length) console.warn('[굳히기] 받지 못한 외부 이미지(죽은 링크 가능):', res.failed);
  return res;
}

// 번역/정리 흐름 + 단일 화 리더 = 공용 팩토리(reader.html과 1벌 공유). 작품 페이지·채팅가져오기는 흐름만 사용.
const rlog = createReaderLog({ setStatus, reloadLogs, getAllLogs: () => allLogs, route, getUser: () => libUser, nameOf });
const { runTranslateFlow, runCleanFlow } = rlog;

// 작품별 "역할 제외" 토글(없음/유저/캐릭터) — 로컬 저장(동기화 안 함).
const EXC_KEY = 'pro2-translate-exclude';
const getExcludeRole = (char: string): string => { try { const o = JSON.parse(localStorage.getItem(EXC_KEY) || '{}'); return (o && o[char]) || ''; } catch (_) { return ''; } };
const setExcludeRole = (char: string, v: string): void => { try { const o = JSON.parse(localStorage.getItem(EXC_KEY) || '{}'); if (v) o[char] = v; else delete o[char]; localStorage.setItem(EXC_KEY, JSON.stringify(o)); } catch (_) {} };

async function renderSeries(char: string) {
  const s = seriesBase().find((x) => x.char === char);
  if (!s) { location.hash = '#/'; return; }
  // 메타(표지/설명) 조회가 실패/지연돼도 작품 페이지는 반드시 렌더(4초 타임아웃) — "안 들어가짐" 방지.
  let m: any = {};
  try { m = (await Promise.race([metaGet(char), new Promise((res) => setTimeout(() => res(null), 4000))])) || {}; } catch (_) { m = {}; }
  const coverSrc = m.cover || s.cover;
  const descText = (m.desc != null && String(m.desc).trim() !== '') ? m.desc : (s.eps[0] ? (previewLine(s.eps[0]) || '') : '');
  const read = loadRead();
  const edit = seriesEditMode;
  app.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className = 'series';
  const bar = document.createElement('div'); bar.className = 'reader-bar';
  const back = document.createElement('button'); back.className = 'reader-back'; back.textContent = '← 서재'; back.onclick = () => { seriesEditMode = false; location.hash = '#/'; };
  const btitle = document.createElement('div'); btitle.className = 'reader-title'; btitle.textContent = s.name;
  const editB = document.createElement('button'); editB.className = 'reader-iconbtn' + (edit ? ' on' : ''); editB.innerHTML = edit ? (icon('check') + ' 편집 완료') : (icon('pencil') + ' 편집');
  editB.onclick = () => { seriesEditMode = !seriesEditMode; renderSeries(char); };
  bar.append(back, btitle, editB); wrap.appendChild(bar);

  const scroll = document.createElement('div'); scroll.className = 'series-scroll';
  // 히어로(표지 + 정보 + 액션)
  const hero = document.createElement('div'); hero.className = 'series-hero';
  const cover = document.createElement('div'); cover.className = 'series-cover';
  // 표지 클릭=크게 보기(라이트박스). ★img에만 연결 → edit 모드의 "이미지 변경" 버튼 클릭과 충돌 안 함.
  if (coverSrc) { const im = document.createElement('img'); im.src = coverSrc; im.className = 'zoomable'; im.title = '표지 크게 보기'; im.onclick = (e) => { e.stopPropagation(); openLightbox(coverSrc); }; cover.appendChild(im); } else cover.textContent = s.name.slice(0, 2);
  if (edit) {
    // 표지 이미지 변경/자동
    const ovl = document.createElement('div'); ovl.className = 'cover-edit';
    const chg = document.createElement('button'); chg.textContent = '이미지 변경';
    chg.onclick = () => {
      if (!seriesCoverInput) { seriesCoverInput = document.createElement('input'); seriesCoverInput.type = 'file'; seriesCoverInput.accept = 'image/*'; seriesCoverInput.style.display = 'none'; document.body.appendChild(seriesCoverInput); }
      seriesCoverInput.onchange = async () => {
        const f = seriesCoverInput!.files && seriesCoverInput!.files[0]; seriesCoverInput!.value = ''; if (!f) return;
        try {
          const cover = await downscaleImage(f, 720);   // 작게 줄여 저장(빠르고 Storage 안 거침)
          await metaSet({ char, cover, desc: m.desc || '', name: m.name || '' });
          await syncMetaCache(char);   // 서재 목록에 즉시 반영
          setStatus('표지 변경됨');
        } catch (e: any) { setStatus('표지 변경 실패: ' + ((e && e.message) || '')); }
        renderSeries(char);   // 실패해도 페이지는 다시 그림
      };
      seriesCoverInput.click();
    };
    const auto = document.createElement('button'); auto.textContent = '자동'; auto.title = '첫 화 이미지로';
    auto.onclick = async () => { await metaSet({ char, cover: '', desc: m.desc || '', name: m.name || '' }); await syncMetaCache(char); renderSeries(char); };
    ovl.append(chg, auto); cover.appendChild(ovl);
  }
  const info = document.createElement('div'); info.className = 'series-info';
  const name = document.createElement('h1'); name.className = 'series-name'; name.textContent = s.name;
  const meta = document.createElement('div'); meta.className = 'series-meta';
  meta.textContent = s.count ? (`총 ${s.count}화 · 최근 ${s.latest.date || ''}` + (s.unread ? ` · 안 읽음 ${s.unread}` : ' · 다 읽음')) : '아직 화가 없어요';
  info.append(name, meta);
  if (edit) {
    name.style.display = 'none';   // 편집 중엔 제목 h1 숨김(아래 입력칸이 대신)
    // 이름 변경 — meta.name만 바꾼다. 키(char)는 불변 → 화·읽기상태·공유링크·URL 전부 그대로.
    const ni = document.createElement('input'); ni.className = 'series-name-edit'; ni.value = s.name; ni.placeholder = '작품 이름'; ni.maxLength = 300;
    ni.onchange = async () => {
      const nm = ni.value.trim();
      await metaSet({ char, cover: m.cover || '', desc: m.desc || '', name: nm });
      m.name = nm; await syncMetaCache(char);
      name.textContent = nm || char; btitle.textContent = nm || char;   // 서가/제목 즉시 반영
      setStatus(nm ? `이름을 "${nm}"(으)로 바꿨습니다.` : '이름을 지웠습니다(키 이름으로 표시).');
    };
    info.appendChild(ni);
    const ta = document.createElement('textarea'); ta.className = 'series-desc-edit'; ta.placeholder = '작품 설명 (선택)'; ta.value = m.desc || '';
    ta.onchange = async () => { await metaSet({ char, cover: m.cover || '', desc: ta.value, name: m.name || '' }); await syncMetaCache(char); };
    info.appendChild(ta);
  } else {
    const intro = document.createElement('div'); intro.className = 'series-intro'; intro.textContent = descText || '';
    info.appendChild(intro);
  }
  const actions = document.createElement('div'); actions.className = 'series-actions';
  // ＋ 새 화 쓰기 — 편집기를 이 작품에 바인딩해서 연다(?work=불변키). 보관 시 이 작품·맨끝으로.
  const writeB = document.createElement('button'); writeB.className = 'series-read primary'; writeB.innerHTML = icon('plus') + ' 새 화 쓰기';
  writeB.onclick = () => { location.href = 'index.html?work=' + encodeURIComponent(char); };
  const readB = document.createElement('button'); readB.className = 'series-read';
  const star = document.createElement('button'); star.className = 'lib-star series-star' + (s.fav ? ' on' : ''); star.textContent = s.fav ? '★ 즐겨찾기' : '☆ 즐겨찾기';
  star.onclick = () => { const rd = loadRead(); rd.fav[char] = !rd.fav[char]; if (!rd.fav[char]) delete rd.fav[char]; saveRead(rd); renderSeries(char); };
  if (s.count === 0) {
    actions.append(writeB, star);   // 빈 작품 = 첫 화 쓰기만
  } else if (s.readIdx >= 0) {
    readB.textContent = `이어 읽기 · ${s.readIdx + 1}화`;
    readB.onclick = () => { location.hash = '#/read/' + encodeURIComponent(char); };
    const fromStart = document.createElement('button'); fromStart.className = 'series-read'; fromStart.textContent = '처음부터';
    fromStart.onclick = () => { location.hash = '#/read/' + encodeURIComponent(char) + '/' + encodeURIComponent(s.eps[0].id); };
    actions.append(writeB, readB, fromStart, star);
  } else {
    readB.textContent = '읽기';
    readB.onclick = () => { location.hash = '#/read/' + encodeURIComponent(char) + '/' + encodeURIComponent(s.eps[0].id); };
    actions.append(writeB, readB, star);
  }
  if (edit) {
    const delS = document.createElement('button'); delS.className = 'series-read series-del'; delS.innerHTML = icon('trash') + ' 작품 삭제';
    delS.onclick = async () => {
      if (!(await confirmModal(`작품 "${s.name}"의 모든 화(${s.count}개)를 삭제할까요? 되돌릴 수 없습니다.`, { okText: '삭제', danger: true }))) return;
      setStatus(`작품 "${s.name}" 삭제 중…`);
      await Promise.all(s.eps.map((e: any) => logsDelete(e.id)));   // 한 번에 삭제(순차 X)
      await metaDelete(char);
      try { await idbDeleteWorkCard(char); } catch (_) {}            // 그 작품에 기억된 카드도 정리

      const rd = loadRead(); delete rd.fav[char]; delete rd.lastByChar[char]; if (rd.lastReadAt) delete rd.lastReadAt[char]; for (const e of s.eps) delete rd.readIds[e.id]; saveRead(rd);
      seriesEditMode = false; await reloadLogs(); setStatus(`작품 "${s.name}" 삭제됨`); location.hash = '#/';
    };
    actions.appendChild(delS);
  }
  // 작품 통째 공유(공개 읽기전용 링크)
  const shareSeriesB = document.createElement('button'); shareSeriesB.className = 'lib-star series-star';
  shareSeriesB.innerHTML = icon('link') + (seriesShareId(char) ? ' 공유됨' : ' 작품 공유');
  shareSeriesB.onclick = () => toggleSeriesSharePop(wrap, s, shareSeriesB);
  actions.appendChild(shareSeriesB);
  info.appendChild(actions);
  hero.append(cover, info); scroll.appendChild(hero);

  // 편집 모드: 작품 에셋 일괄 입히기 패널(카드 파일 → 로그에 이미지)
  if (edit) {
    const ap = document.createElement('div'); ap.className = 'asset-apply';
    const apT = mk('div', 'asset-apply-title'); apT.innerHTML = icon('palette') + ' 에셋 입히기'; ap.appendChild(apT);
    ap.appendChild(mk('div', 'asset-apply-hint', '채팅으로 가져온 로그에 이미지가 안 보이면, 그 봇의 카드 파일(.charx · .png · .json · .risum)을 넣고 “에셋 입히기”를 누르세요. 모듈봇 추가 에셋이면 여러 개 넣어도 됩니다. 카드는 저장되지 않고 이미지만 로그에 들어갑니다.'));
    let chosen: File[] = [];
    const drop = document.createElement('div'); drop.className = 'asset-apply-drop'; drop.textContent = '카드 파일을 끌어다 놓거나 클릭해서 선택';
    const fin = document.createElement('input'); fin.type = 'file'; fin.accept = '.charx,.png,.json,.risum,application/json'; fin.multiple = true; fin.style.display = 'none';
    const list = document.createElement('div'); list.className = 'asset-apply-files';
    const goB = document.createElement('button'); goB.className = 'series-read primary'; goB.textContent = '에셋 입히기'; goB.disabled = true;
    const note = mk('div', 'asset-apply-note', '');
    const renderFiles = () => {
      list.innerHTML = ''; goB.disabled = !chosen.length;
      chosen.forEach((f, i) => { const chip = mk('span', 'asset-file-chip', f.name); const x = mk('button', 'asset-file-x', '✕'); x.onclick = () => { chosen.splice(i, 1); renderFiles(); }; chip.appendChild(x); list.appendChild(chip); });
    };
    const addFiles = (fl: FileList | null) => { if (!fl) return; for (const f of Array.from(fl)) chosen.push(f); renderFiles(); };
    drop.onclick = () => fin.click();
    fin.onchange = () => { addFiles(fin.files); fin.value = ''; };
    ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (e: any) => { e.preventDefault(); addFiles(e.dataTransfer && e.dataTransfer.files); });
    goB.onclick = async () => {
      goB.disabled = true;
      try {
        const res = await applyAssetsToSeries(char, chosen, (m) => { note.textContent = m; });
        note.textContent = `완료 — ${res.changed}개 화에 이미지 입힘 (에셋 ${res.mapped}/${res.refs}개 매칭). 카드는 폐기했습니다.`;
        chosen = []; renderFiles(); await reloadLogs();
      } catch (e: any) { note.textContent = '실패: ' + ((e && e.message) || ''); goB.disabled = false; }
    };
    ap.append(drop, fin, list, goB, note); scroll.appendChild(ap);

    // 이미지 굳히기 패널(외부 핫링크 이미지 → 영구 박제). 데스크탑=실행 / 웹=비활성+설치 안내.
    const extN = s.eps.reduce((n: number, e: any) => n + externalCount(e.html || ''), 0);
    const bp = mk('div', 'asset-apply'); const bpT = mk('div', 'asset-apply-title'); bpT.innerHTML = icon('flame') + ' 이미지 굳히기 (영구 박제)'; bp.appendChild(bpT);
    if (desktopAvailable()) {
      bp.appendChild(mk('div', 'asset-apply-hint', '로그 속 외부 링크 이미지를 내려받아 로그에 직접 박아 넣습니다. 원격 사이트가 사라져도 이미지가 안 깨져요. 원본 화질 그대로 보관합니다.'));
      const bnote = mk('div', 'asset-apply-note', extN ? `외부(핫링크) 이미지 ${extN}장이 남아 있습니다.` : '✓ 외부 이미지 없음 — 이미 모두 영구 보관 상태입니다.');
      const bgo = mk('button', 'series-read primary') as HTMLButtonElement; bgo.textContent = `이 작품 굳히기${extN ? ` (${extN}장)` : ''}`; bgo.disabled = !extN;
      bgo.onclick = async () => {
        bgo.disabled = true;
        const res = await runBakeFlow(s.eps, `작품 "${s.name}"`, (m: string) => { bnote.textContent = m; });
        if (res && res.failed.length) { bnote.innerHTML = ''; bnote.appendChild(mk('div', '', `완료 — 실패 ${res.failed.length}장(아래 링크는 죽었거나 차단됨, 로그는 손상 없이 그대로):`)); const ul = mk('div', 'bake-failed'); res.failed.slice(0, 30).forEach((f: any) => ul.appendChild(mk('div', 'bake-failed-url', f.url))); bnote.appendChild(ul); }
        renderSeries(char);
      };
      bp.append(bnote, bgo);
    } else {
      bp.appendChild(mk('div', 'asset-apply-hint', '외부 링크 이미지를 영구 박제하는 기능입니다. 웹 브라우저는 보안(CORS)·용량 제약으로 외부 이미지를 받아올 수 없어요. 데스크탑 앱에서 열면 이 작품의 외부 이미지를 한 번에 영구 보관할 수 있습니다.'));
      bp.appendChild(mk('div', 'asset-apply-note', `이 작품에 외부(핫링크) 이미지 ${extN}장 — 데스크탑 앱에서 굳히기 가능`));
    }
    scroll.appendChild(bp);

    // 정리 패널(작품 전체 군더더기 제거) — 1차 결정론이라 키 없이·웹·앱 어디서나.
    {
      const cp2 = mk('div', 'asset-apply');
      cp2.appendChild(Object.assign(mk('div', 'asset-apply-title'), { innerHTML: icon('broom') + ' 정리 (군더더기 제거)' }));
      cp2.appendChild(mk('div', 'asset-apply-hint', '응답 헤더·생각의 사슬(<details>)·OOC·코드펜스·화자 라벨 같은 군더더기를 걷어내 RP 본문만 남깁니다. 이미지·대사·카드 구조는 보존돼요. 먼저 한 화를 열어 “정리”로 시험해 본 뒤 작품 전체에 적용하세요. (API 키 불필요)'));
      const cnote = mk('div', 'asset-apply-note', '');
      const cgo = mk('button', 'series-read primary') as HTMLButtonElement; cgo.textContent = `작품 전체 정리하기 (${s.count}화)`;
      cgo.onclick = async () => {
        if (!(await confirmModal(`이 작품 ${s.count}개 화의 군더더기를 한 번에 정리합니다(무료·규칙 기반). 미리보기에서 확인 후 화별 “정리 취소”로 되돌릴 수 있어요. 계속할까요?`, { okText: '정리' }))) return;
        cgo.disabled = true;
        const res = await runCleanFlow(s.eps, char, { onStep: (m: string) => { cnote.textContent = m; } });
        if (res) cnote.textContent = `완료 — ${res.cleaned}개 정리` + (res.failed.length ? ` · 실패 ${res.failed.length}개(원문 유지)` : '') + ` · ${res.changedLogs}개 화 갱신`;
        cgo.disabled = false; renderSeries(char);
      };
      cp2.append(cnote, cgo);
      // ★2차 정밀 정리(LLM·작품별 프롬프트) — 규칙이 못 잡는 들쭉날쭉한 포맷용. 본인 키(번역과 공유).
      cp2.appendChild(mk('div', 'asset-apply-note', '정밀 정리 지침 (이 작품 전용 — 규칙이 못 잡는 군더더기 패턴을 말로)'));
      const cpta = document.createElement('textarea'); cpta.className = 'series-desc-edit'; cpta.rows = 2; cpta.value = getCleanPrompt(char);
      cpta.onchange = () => { setCleanPrompt(char, cpta.value); };
      cp2.appendChild(cpta);
      const aiRow = mk('div', 'tr-exrow');
      const aigo = mk('button', '') as HTMLButtonElement; aigo.innerHTML = icon('clean') + ` AI 정밀 정리 (${s.count}화)`; aigo.title = '규칙(1차) + 본인 키 LLM(2차)으로 정밀 정리. 번역하지 않고 군더더기만 제거.';
      aigo.onclick = async () => {
        if (!(await ensureCleanReady(setStatus))) return;
        if (!(await confirmModal(`이 작품 ${s.count}개 화를 규칙+AI로 정밀 정리합니다.\n본인 API 키로 비용이 발생할 수 있어요. 번역은 하지 않고 군더더기만 제거합니다. 계속할까요?`, { okText: 'AI 정리' }))) return;
        aigo.disabled = true;
        const res = await runCleanFlow(s.eps, char, { cleanFn: makeCleanFn(getCleanPrompt(char)), onStep: (m: string) => { cnote.textContent = m; } });
        if (res) cnote.textContent = `AI 정리 완료 — ${res.cleaned}개 정리` + (res.failed.length ? ` · 실패 ${res.failed.length}개(원문 유지)` : '') + ` · ${res.changedLogs}개 화 갱신`;
        aigo.disabled = false; renderSeries(char);
      };
      const setBtnC = mk('button', ''); setBtnC.innerHTML = icon('settings') + ' 모델·키'; setBtnC.onclick = () => openTranslateSettings(setStatus);
      aiRow.append(aigo, setBtnC); cp2.appendChild(aiRow);
      scroll.appendChild(cp2);
    }

    // 번역 패널(작품 전체 번역 + 작품별 문체 프롬프트 + 역할 제외) — 데스크탑 전용.
    if (translateAvailable()) {
      const tp = mk('div', 'asset-apply');
      const tpT = mk('div', 'asset-apply-title'); tpT.innerHTML = icon('language') + ' 번역 (영·일·중 → 한국어)'; tp.appendChild(tpT);
      tp.appendChild(mk('div', 'asset-apply-hint', '먼저 한 화를 열어 "번역"으로 시험해 본 뒤, 확신이 서면 작품 전체를 번역하세요. 이미 한국어인 부분은 자동으로 건너뛰어 비용을 아낍니다. 마크업·이미지·대사 구조는 그대로 보존됩니다.'));
      // 작품별 문체 프롬프트(말투·호칭만 — 마크업 지시는 코드가 보장).
      const pl = mk('div', 'asset-apply-note', '번역 문체 지침 (이 작품 전용 — 말투·호칭·분위기)'); tp.appendChild(pl);
      const pta = document.createElement('textarea'); pta.className = 'series-desc-edit'; pta.rows = 2; pta.value = getWorkPrompt(char);
      pta.onchange = () => { setWorkPrompt(char, pta.value); };
      tp.appendChild(pta);
      // 역할 제외 토글.
      const exRow = mk('div', 'tr-exrow');
      exRow.appendChild(mk('span', '', '번역 제외 역할:'));
      const exSel = document.createElement('select'); exSel.className = 'lib-sort';
      [['', '없음'], ['user', '유저'], ['char', '캐릭터']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; exSel.appendChild(o); });
      exSel.value = getExcludeRole(char); exSel.onchange = () => setExcludeRole(char, exSel.value);
      exRow.appendChild(exSel);
      const setBtnT = mk('button', ''); setBtnT.innerHTML = icon('settings') + ' 모델·키'; setBtnT.onclick = () => openTranslateSettings(setStatus);
      exRow.appendChild(setBtnT);
      tp.appendChild(exRow);
      const tnote = mk('div', 'asset-apply-note', '');
      const tgo = mk('button', 'series-read primary') as HTMLButtonElement; tgo.textContent = `작품 전체 번역하기 (${s.count}화)`;
      tgo.onclick = async () => {
        if (!(await ensureTranslateReady(setStatus))) return;
        if (!(await confirmModal(`이 작품 ${s.count}개 화를 한국어로 번역합니다.\n본인 API 키로 비용이 발생할 수 있어요(이미 한국어인 부분은 건너뜀). 계속할까요?`, { okText: '번역' }))) return;
        tgo.disabled = true;
        const res = await runTranslateFlow(s.eps, char, { excludeRole: getExcludeRole(char), onStep: (m: string) => { tnote.textContent = m; } });
        if (res) {
          tnote.textContent = `완료 — ${res.translated}개 번역` + (res.skipped ? ` · 한국어 ${res.skipped}개 건너뜀` : '') + (res.roleSkipped ? ` · 역할제외 ${res.roleSkipped}개` : '') + (res.failed.length ? ` · 실패 ${res.failed.length}개(원문 유지)` : '') + ` · ${res.changedLogs}개 화 갱신`;
        }
        tgo.disabled = false;
        renderSeries(char);
      };
      tp.append(tnote, tgo);
      scroll.appendChild(tp);
    }
  }

  // 화 목록
  const listTitle = document.createElement('h2'); listTitle.className = 'home-h series-list-title';
  listTitle.textContent = `화 목록 (${s.count})` + (edit ? ' — 드래그로 순서변경 · 제목 편집' : '');
  scroll.appendChild(listTitle);
  if (s.count === 0) {   // 빈 작품 = 첫 화 안내
    const empty = document.createElement('div'); empty.className = 'series-empty';
    const art = document.createElement('div'); art.className = 'empty-art'; art.innerHTML = icon('bookOpen'); empty.appendChild(art);
    empty.appendChild(mk('div', 'studio-empty-h', '아직 화가 없어요'));
    empty.appendChild(mk('div', 'studio-empty-sub', '위 “＋ 새 화 쓰기”로 첫 화를 써보세요.'));
    scroll.appendChild(empty); wrap.appendChild(scroll); app.appendChild(wrap);
    autoHideBar(scroll, [document.querySelector('.lib-topbar'), bar]);
    applyPendingScroll(scroll);
    return;
  }
  const list = document.createElement('div'); list.className = 'series-eps';
  const persistOrder = async () => { for (let k = 0; k < s.eps.length; k++) { s.eps[k].order = k; await logsAdd(s.eps[k]); } renderSeries(char); };
  s.eps.forEach((r: any, i: number) => {
    const ep = document.createElement('div'); ep.className = 'series-ep' + (read.readIds[r.id] ? ' read' : '') + (r.id === s.lastReadId ? ' current' : '') + (edit ? ' editing' : '');
    const no = document.createElement('button'); no.className = 'se-no se-open'; no.textContent = String(i + 1); no.title = '이 화 열람';
    no.onclick = (e) => { e.stopPropagation(); location.hash = '#/log/' + encodeURIComponent(char) + '/' + encodeURIComponent(r.id); };
    const dt = document.createElement('span'); dt.className = 'se-date'; dt.textContent = r.date || '';
    const dot = document.createElement('span'); dot.className = 'se-dot'; dot.title = read.readIds[r.id] ? '읽음' : '안읽음';
    const acts = document.createElement('span'); acts.className = 'se-acts';
    if (edit) {
      // 편집 모드: 제목 입력 + 드래그 + 삭제. (열람/편집기/내보내기는 단일 화 화면에서)
      const ti = document.createElement('input'); ti.className = 'se-title-edit'; ti.value = r.title || ''; ti.placeholder = '(제목 없음)'; ti.title = '제목 편집';
      ti.onclick = (e) => e.stopPropagation();
      ti.onchange = async () => { r.title = ti.value; await logsAdd(r); };
      const dl = document.createElement('button'); dl.textContent = '삭제'; dl.onclick = async (e) => { e.stopPropagation(); if (!(await confirmModal('이 화를 삭제할까요?', { okText: '삭제', danger: true }))) return; await logsDelete(r.id); await reloadLogs(); renderSeries(char); };
      acts.append(dl);
      ep.draggable = true;
      ep.ondragstart = (e) => { dragFromIdx = i; ep.classList.add('dragging'); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; };
      ep.ondragend = () => { ep.classList.remove('dragging'); list.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over')); };
      ep.ondragover = (e) => { e.preventDefault(); ep.classList.add('drag-over'); };
      ep.ondragleave = () => ep.classList.remove('drag-over');
      ep.ondrop = async (e) => { e.preventDefault(); ep.classList.remove('drag-over'); if (dragFromIdx < 0 || dragFromIdx === i) { dragFromIdx = -1; return; } const a = s.eps; const [moved] = a.splice(dragFromIdx, 1); a.splice(i, 0, moved); dragFromIdx = -1; await persistOrder(); };
      const handle = document.createElement('span'); handle.className = 'se-handle'; handle.textContent = '⠿'; handle.title = '드래그로 이동';
      ep.append(handle, no, ti, dt, dot, acts);
    } else {
      // 보기 모드: 제목 텍스트, 클릭=열람.
      const t = document.createElement('span'); t.className = 'se-title'; t.textContent = r.title || '(제목 없음)';
      ep.append(no, t, dt, dot, acts);
      ep.onclick = () => { location.hash = '#/log/' + encodeURIComponent(char) + '/' + encodeURIComponent(r.id); };
    }
    list.appendChild(ep);
  });
  scroll.appendChild(list); wrap.appendChild(scroll); app.appendChild(wrap);
  autoHideBar(scroll, [document.querySelector('.lib-topbar'), bar]);   // 모바일: 전역 헤더 + 작품 바를 오버레이 스택으로 통째 숨김
  applyPendingScroll(scroll);   // 백그라운드 갱신 재렌더면 읽던 위치 복원
}

// ====== 단일 화 열람(그 로그만) — 작품 페이지에서 화 클릭 시 ======
// (단일 화 리더 renderSingleLog = readerLog.ts로 이전 → reader.html. #/log는 route()가 reader.html로 리다이렉트.)

// ====== 채팅 JSON 가져오기 (리스 export → 화 단위로 서재에 저장) ======
let chatInput: HTMLInputElement | null = null;
function importChatLog() {
  if (!chatInput) {
    chatInput = document.createElement('input'); chatInput.type = 'file'; chatInput.accept = 'application/json,.json'; chatInput.style.display = 'none';
    document.body.appendChild(chatInput);
    chatInput.addEventListener('change', async () => {
      const f = chatInput!.files && chatInput!.files[0]; chatInput!.value = ''; if (!f) return;
      let parsed: any;
      try { const _obj = JSON.parse(await f.text()); parsed = parseRisuLog(_obj, f.name); if (_obj && _obj.assets && typeof _obj.assets === 'object' && !Array.isArray(_obj.assets)) parsed.assets = _obj.assets; if (_obj && Array.isArray(_obj.cleanupRegex)) parsed.cleanupRegex = _obj.cleanupRegex; }   // ★다운로드 JSON의 assets 맵 + cleanupRegex(정리 정규식 동봉)
      catch (e: any) { setStatus('JSON 파싱 실패: ' + e.message); return; }
      const total = parsed.chats.reduce((n: number, c: any) => n + c.messages.length, 0);
      if (!total) { setStatus('메시지를 찾을 수 없습니다 (리스 채팅 export .json인지 확인하세요).'); return; }
      showChatImportModal(parsed, total);
    });
  }
  chatInput.click();
}

function showChatImportModal(parsed: any, total: number, onDone?: () => Promise<void>) {
  const ov = document.createElement('div'); ov.className = 'import-modal';
  const card = document.createElement('div'); card.className = 'import-card';
  const h = document.createElement('div'); h.className = 'import-title'; h.textContent = '채팅 로그 가져오기';
  const info = document.createElement('div'); info.className = 'import-info'; info.textContent = `“${parsed.char}” · 메시지 ${total}개`;
  card.append(h, info);

  const row = (label: string, el: HTMLElement) => { const r = document.createElement('label'); r.className = 'import-row'; const s = document.createElement('span'); s.textContent = label; r.append(s, el); card.appendChild(r); return r; };

  const nameIn = document.createElement('input'); nameIn.type = 'text'; nameIn.value = parsed.char; row('작품(캐릭터) 이름', nameIn);

  const design = document.createElement('select');
  for (const id of TEMPLATE_ORDER) { const o = document.createElement('option'); o.value = id; o.textContent = TEMPLATE_DEFS[id].label; design.appendChild(o); }
  design.value = 'webnovel'; row('어떤 디자인으로 저장', design);

  // ★이미지 처리 — '이미지로 가져오기'(동봉된 그림 있으면 바로 표시)/'태그만 남기기'(나중에 charx로 '에셋 입히기'). 둘 다 태그는 보존(charx로 채움). 마지막 선택 기억.
  const imgMode = document.createElement('select');
  [['embed', '이미지로 가져오기 (동봉된 그림은 바로 표시)'], ['keep', '이미지태그만 남기기 (나중에 charx로 채우기)']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; imgMode.appendChild(o); });
  try { imgMode.value = localStorage.getItem(IMPORT_IMGMODE_KEY) === 'keep' ? 'keep' : 'embed'; } catch (_) {}
  imgMode.onchange = () => { try { localStorage.setItem(IMPORT_IMGMODE_KEY, imgMode.value); } catch (_) {} };
  row('이미지 처리', imgMode);
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-info', textContent: '그림이 안 보이면 작품 화면의 “에셋 입히기”로 그 봇의 .charx 파일을 넣으면 채워집니다 (태그는 어느 쪽이든 보존돼요).' }));

  const mode = document.createElement('select');
  [['count', '메시지 N개씩'], ['total', '총 N화로 균등']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; mode.appendChild(o); });
  row('화 나누기', mode);
  const num = document.createElement('input'); num.type = 'number'; num.min = '1'; num.max = '500'; num.value = '20'; row('N (개수/화수)', num);

  const roleWrap = document.createElement('label'); roleWrap.className = 'import-check';
  const roleCb = document.createElement('input'); roleCb.type = 'checkbox'; roleCb.checked = true;
  roleWrap.append(roleCb, document.createTextNode(' 유저/캐릭터 박스색 구분 (기본 카드만)'));
  card.appendChild(roleWrap);

  // 블록 헤더(역할 이름) 옵션 — 역할 구분 켰을 때만 의미.
  const userLbl = document.createElement('input'); userLbl.type = 'text'; userLbl.value = '나'; const uRow = row('유저 표시 이름', userLbl);
  const charLbl = document.createElement('input'); charLbl.type = 'text'; charLbl.value = parsed.char; const cRow = row('캐릭터 표시 이름', charLbl);
  const numWrap = document.createElement('label'); numWrap.className = 'import-check';
  const numCb = document.createElement('input'); numCb.type = 'checkbox';
  numWrap.append(numCb, document.createTextNode(' 이름 대신 번호로 표시 (1, 2, 3 …)'));
  card.appendChild(numWrap);
  const syncRoleOpts = () => { const on = roleCb.checked; uRow.style.display = cRow.style.display = numWrap.style.display = on ? '' : 'none'; if (on) { uRow.style.opacity = cRow.style.opacity = numCb.checked ? '0.5' : '1'; } };
  roleCb.onchange = syncRoleOpts; numCb.onchange = syncRoleOpts; syncRoleOpts();

  // ★가져온 뒤 자동 정리 — 군더더기 제거(1차 결정론, 무료). 사장님 핵심 동선이라 기본 켜짐.
  const cleanWrap = document.createElement('label'); cleanWrap.className = 'import-check';
  const cleanCb = document.createElement('input'); cleanCb.type = 'checkbox'; cleanCb.checked = true;
  cleanWrap.append(cleanCb, document.createTextNode(' 가져온 뒤 군더더기 자동 정리 (응답 헤더·생각의 사슬·OOC·화자 라벨 등 — 무료, 본문·이미지 보존)'));
  card.appendChild(cleanWrap);

  // ★내 입력(user 메시지) 빼고 캐릭터 응답만 저장 — 공유 시 부끄러운 입력 노출 방지(영구·내 사본도). 마지막 선택 기억.
  const hideWrap = document.createElement('label'); hideWrap.className = 'import-check';
  const hideUserCb = document.createElement('input'); hideUserCb.type = 'checkbox';
  try { hideUserCb.checked = localStorage.getItem(IMPORT_HIDEU_KEY) === '1'; } catch (_) {}
  hideUserCb.onchange = () => { try { localStorage.setItem(IMPORT_HIDEU_KEY, hideUserCb.checked ? '1' : '0'); } catch (_) {} };
  hideWrap.append(hideUserCb, document.createTextNode(' 내 입력 빼기 (캐릭터 응답만 저장 — 채팅형은 한쪽만 남아 휑할 수 있어요)'));
  card.appendChild(hideWrap);

  const est = document.createElement('div'); est.className = 'import-info';
  const updateEst = () => { const n = Math.max(1, +num.value || 1); const eps = mode.value === 'total' ? n : Math.ceil(total / n); est.textContent = `→ 약 ${eps}화로 저장`; };
  mode.onchange = updateEst; num.oninput = updateEst; updateEst();
  card.appendChild(est);

  const btns = document.createElement('div'); btns.className = 'import-btns';
  const go = document.createElement('button'); go.className = 'primary'; go.textContent = '가져오기';
  const cancel = document.createElement('button'); cancel.textContent = '취소'; cancel.onclick = () => ov.remove();
  go.onclick = async () => {
    go.disabled = true; go.textContent = '가져오는 중…';
    try {
      await buildAndSaveChat(parsed, { char: (nameIn.value.trim() || parsed.char), fp: parsed.fp, design: design.value, mode: mode.value, n: Math.max(1, +num.value || 1), roleColor: roleCb.checked, userLabel: userLbl.value.trim() || '나', charLabel: charLbl.value.trim() || (nameIn.value.trim() || parsed.char), numbered: numCb.checked, clean: cleanCb.checked, hideUser: hideUserCb.checked, keepImgTags: imgMode.value === 'keep' });
      ov.remove();
      if (onDone) { try { await onDone(); } catch (_) {} }   // 우체통 보관: 성공 후 그 inbox 항목 삭제(배지 −1)
    } catch (e: any) { setStatus('가져오기 실패: ' + e.message); go.disabled = false; go.textContent = '가져오기'; }
  };
  btns.append(go, cancel); card.appendChild(btns);
  ov.appendChild(card); document.body.appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
}

const newChatId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ── 챗 지문(fp) 이어붙이기 — 같은 챗 재유입 시 새 작품 대신 델타(새 메시지)만 잇는다(동기화 KV). ──
const IMPORTS_KEY = 'pro2-chat-imports';   // { [fp]: { workKey, count, sig } } — count=보관한 메시지 수, sig=그 앞부분 해시
const IMPORT_HIDEU_KEY = 'pro2-import-hideuser';   // 가져오기 "내 입력 빼기(캐릭터 응답만)" 마지막 선택 기억
const IMPORT_IMGMODE_KEY = 'pro2-import-imgmode';   // 가져오기 "이미지 처리"(embed/keep) 마지막 선택 기억
function loadImports(): Record<string, any> { const o = kvLoad(IMPORTS_KEY); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; }
function saveImports(o: any) { kvSave(IMPORTS_KEY, o); }
// 메시지 시퀀스 안정 해시(FNV-1a) — "앞부분 그대로(이어짐) vs 바뀜(수정·리롤)" 판정용.
function msgsSig(msgs: any[]): string {
  let h = 0x811c9dc5; const s = msgs.map((m: any) => (m.role || '') + '' + (m.text || '')).join('');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16);
}

async function buildAndSaveChat(parsed: any, opts: any) {
  const allMsgs = parsed.chats.flatMap((c: any) => c.messages);
  const today = new Date().toISOString().slice(0, 10);
  // ★fp(챗 지문)가 있으면 같은 챗 재유입을 이어붙임: 앞부분(이미 보관한 count개)이 그대로면 델타만 그 작품에,
  //   어긋나면(중간 수정·리롤) 새 작품으로 폴백(유실 0). fp 없으면(파일 가져오기) 늘 새 작품(기존 동작).
  const fp = opts.fp ? String(opts.fp) : '';
  const imports = fp ? loadImports() : {};
  const prev = fp ? imports[fp] : null;
  let workKey = '', startEp = 0, isAppend = false;
  let messages = allMsgs;
  if (prev && prev.workKey && allLogs.some((r: any) => r.char === prev.workKey)) {   // 기존 작품이 아직 있고
    if (allMsgs.length >= prev.count && msgsSig(allMsgs.slice(0, prev.count)) === prev.sig) {   // 앞부분 일치 = 진짜 이어짐
      messages = allMsgs.slice(prev.count);
      if (!messages.length) {   // 새 메시지 없음(이미 최신·중복 보관) → 아무것도 안 만들고 끝
        setStatus(`“${opts.char}” — 새 화가 없어요(이미 최신).`);
        if (!opts.noNav) { location.hash = '#/series/' + encodeURIComponent(prev.workKey); route(); }
        return;
      }
      workKey = prev.workKey; isAppend = true;
      startEp = allLogs.filter((r: any) => r.char === workKey).length;   // 기존 화 수 → 이어서 번호
    }
  }
  if (!workKey) workKey = newWorkKey();   // 새 작품(첫 보관 또는 앞부분 어긋남)
  if (opts.hideUser) {   // ★내 입력(user) 빼고 캐릭터 응답만 저장 — 저장 콘텐츠에만 적용(fp·델타·imports는 위에서 원본 기준으로 끝나 재유입 매칭 안 깨짐).
    const onlyChar = messages.filter((m: any) => m && m.role !== 'user');
    if (!onlyChar.length) { setStatus(`“${opts.char}” — 캐릭터 응답이 없어 건너뛰었어요(내 입력만 있음).`); if (!opts.noNav) { location.hash = '#/series/' + encodeURIComponent(workKey); route(); } return; }
    messages = onlyChar;
  }
  const eps = splitMessages(messages, opts.n, opts.mode);
  // 새 작품일 때만 표시이름 메타 등록(이어붙이기는 기존 작품 이름·표지 유지).
  if (!isAppend) { try { await metaSet({ char: workKey, name: opts.char, cover: '', desc: '' }); } catch (_) {} }
  // ★삽화(장면)는 본문 인라인(플러그인이 박음), 에셋(감정 스프라이트)은 assets 맵으로 와서 여기서 카드 스타일로 렌더(블록 X) = 카드 드롭과 동일 경로.
  let assetMap: any = (parsed && parsed.assets && typeof parsed.assets === 'object' && !Array.isArray(parsed.assets) && Object.keys(parsed.assets).length) ? parsed.assets : null;
  const cleanupRegexArr: any = (parsed && Array.isArray(parsed.cleanupRegex) && parsed.cleanupRegex.length) ? parsed.cleanupRegex : null;   // ★가져온 챗에 동봉된 정리 정규식(B) — 레코드에 저장 → 리더가 비파괴 적용(살균·ReDoS는 리더서)
  const created: any[] = [];
  for (let i = 0; i < eps.length; i++) {
    const chunk = eps[i];
    const epIdx = startEp + i;   // 이어붙이기면 기존 화 뒤로 번호 계속
    const s = defaultSettings(); s.template = opts.design; s.profile.botName = opts.char;
    const input = chunk.map((m: any) => m.text).join('\n\n');
    const rec: any = { id: newChatId() + '-' + epIdx, char: workKey, title: `${epIdx + 1}화`, date: today, input, html: '', template: opts.design, order: epIdx, workName: opts.char };
    if (cleanupRegexArr) rec.cleanupRegex = cleanupRegexArr;   // ★per-log 정리 규칙 동봉(리더 "정리/원본" 토글·재렌더 보존). 작아서 화별 저장 OK.
    // 디자인별 구조(편집기에서 그대로 복원 가능)도 함께 저장.
    if (opts.design === 'card' && opts.roleColor) {
      const cardCfg = { blocks: chunk.map((m: any) => ({ role: m.role, content: m.text, title: '', subtitle: '' })), collapseAll: false, userLabel: opts.userLabel || '나', charLabel: opts.charLabel || opts.char, numbered: !!opts.numbered };
      s.templateSettings.card = cardCfg; rec.html = convertText('', s); rec.cardCfg = cardCfg;
    } else if (opts.design === 'chat') {
      const chat: any = { messages: chunk.map((m: any) => ({ role: m.role, text: m.text })), userName: opts.userLabel || '나', charName: opts.charLabel || opts.char };
      s.templateSettings.chat = chat; rec.html = convertText('', s); rec.chat = chat;
    } else if (opts.design === 'log-diary') {
      const diary: any = { theme: 'basic', pages: chunk.map((m: any) => ({ itemType: 'page', title: '', subtitle: '', content: m.text })) };
      s.templateSettings['log-diary'] = diary; rec.html = convertText('', s); rec.diary = diary;
    } else if (opts.design === 'webnovel') {
      // 유저/캐릭터 턴마다 한 블록 → 편집기 입력칸에서 블록이 나뉘어 보이고(작업 4), 리더는 깔끔한 줄글.
      // 테마·강조 등 기본 노브(세피아·형광펜·들여쓰기·이탤릭)도 함께 담아 rec.html 에 테마가 구워짐.
      const wn: any = Object.assign({}, TEMPLATE_DEFS.webnovel.defaults, {
        messages: [], useBlocks: true,
        blocks: chunk.map((m: any) => ({ title: '', content: m.text })),
      });
      s.templateSettings.webnovel = wn; rec.html = convertText('', s); rec.webnovel = wn;
    } else { // card(역할색 없음) / custom-css: 단일 입력
      rec.html = convertText(input, s);
      if (opts.design === 'custom-css') rec.userCardCss = '';
    }
    // ★에셋(감정 스프라이트) 공유 저장: 이미지를 화마다 base64로 굽지 않는다(같은 스프라이트 ×화수 복제 = OOM 원인).
    //   대신 rec.html엔 마커({{img::이름}}·<img src=이름>·CBS)를 그대로 두고, 바이트는 작품당 한 벌만 IDB_BLOBS에 저장(blobsPutAssetMap, 콘텐츠해시 dedup).
    //   rec.assetRefs(이름→해시, 작음)만 화에 동반 → 리더가 그 화에 필요한 것만 지연 복원(rerenderLog/applyAssetMap, readerLog.ts).
    if (assetMap && !opts.keepImgTags) {   // '이미지태그만 남기기'면 동봉 그림도 안 박음 — 태그 보존(charx '에셋 입히기'로 채움)
      const refs = new Set<string>(); for (const mm of chunk) collectAssetRefs(String((mm as any).text || ''), refs);
      const sub: any = {};
      for (const k of Object.keys(assetMap)) { const kl = k.toLowerCase(), ks = kl.replace(/\.[a-z0-9]+$/i, ''); for (const ref of refs) { const rl = String(ref).toLowerCase(); if (rl === kl || rl === ks || rl.replace(/\.[a-z0-9]+$/i, '') === ks) { sub[k] = assetMap[k]; break; } } }
      if (Object.keys(sub).length) {
        try { const refsHashes = await blobsPutAssetMap(sub); if (Object.keys(refsHashes).length) rec.assetRefs = refsHashes; } catch (_) {}   // 바이트는 한 벌(dedup)·메모리 화별 바운드
      }
    }
    await logsAdd(rec); created.push(rec);
  }
  assetMap = null; try { if (parsed) { parsed.assets = null; } } catch (_) {}   // ★거대 에셋 맵(수백MB) 즉시 해제 — 바이트는 IDB_BLOBS에 들어갔고 created/정리엔 불필요(메모리 회수)
  // fp 기록 갱신 — 다음 재유입 때 이 시점까지를 "이미 보관한 앞부분"으로 보고 델타만 잇는다.
  if (fp) { imports[fp] = { workKey, count: allMsgs.length, sig: msgsSig(allMsgs) }; saveImports(imports); }
  const verb = isAppend ? '이어받음' : '가져옴';
  // ★가져온 직후 군더더기 정리(옵션, 기본 켜짐) — 1차 결정론(무료). runCleanFlow가 재렌더·재저장·reloadLogs.
  if (opts.clean && created.length) {
    setStatus(`“${opts.char}” — ${eps.length}화 ${verb}, 정리 중…`);
    try { await runCleanFlow(created, workKey, { onStep: (m: string) => setStatus(m) }); } catch (_) { await reloadLogs(); }
  } else {
    await reloadLogs();
  }
  setStatus(`“${opts.char}” — ${eps.length}화 ${verb}` + (opts.clean ? ' · 정리 완료' : ''));
  if (!opts.noNav) { location.hash = '#/series/' + encodeURIComponent(workKey); route(); }   // 드레인(여러 건·백그라운드)은 네비 생략
}

// ── 받은 로그함(우체통) — 리스 푸시를 ★검토 후 보관(자동 변환 폐기 = 0화 버그 해소). ──
//   inbox는 "목록만 읽고" 보관은 기존 '채팅 가져오기' 설정 모달(검증된 경로) → 새 변환기 안 만듦.
let inboxDocs: any[] = [];                        // 라이브 감지로 채워지는 현재 inbox 목록
let inboxUnsub: (() => void) | null = null;       // onSnapshot 해제(로그아웃·언마운트 시 정리)
let inboxPanelBody: HTMLElement | null = null;    // 패널 열려 있으면 그 목록 컨테이너(라이브 갱신)
let inboxBulkBar: HTMLElement | null = null;      // 전체 보관/삭제 바(항목 있을 때만 표시)

function updateInboxBadge(count: number) {
  const badge = document.getElementById('inbox-count') as HTMLElement | null; if (!badge) return;
  if (count > 0) {
    const prev = badge.textContent; badge.textContent = String(count); badge.hidden = false;
    if (prev !== String(count)) { badge.classList.remove('badge-bounce'); void badge.offsetWidth; badge.classList.add('badge-bounce'); }   // 카톡식 +1 바운스
  } else badge.hidden = true;
}
// 로그인 시 우체통 버튼 표시 + 라이브 감지(onSnapshot). 로그아웃 시 정리.
async function setupInbox(user: any) {
  if (inboxUnsub) { try { inboxUnsub(); } catch (_) {} inboxUnsub = null; }
  const btn = document.getElementById('btn-inbox') as HTMLElement | null;
  if (!user || !user.uid) { if (btn) btn.hidden = true; inboxDocs = []; updateInboxBadge(0); return; }
  if (btn) { btn.hidden = false; (btn as HTMLButtonElement).onclick = () => openInboxPanel(); }
  try {
    const R = await import('./risuPush.js');
    try { inboxDocs = await R.listInbox(user.uid); updateInboxBadge(inboxDocs.length); } catch (_) {}
    inboxUnsub = R.watchInbox(user.uid, (count: number, docs: any[]) => { inboxDocs = docs; updateInboxBadge(count); if (inboxPanelBody) renderInboxList(); });
  } catch (e) { console.warn('[risu] 우체통 설정 실패', e); }
}
const inboxPreview = (msgs: any[]): string => {
  const m = (Array.isArray(msgs) ? msgs : []).find((x: any) => x && String(x.text || '').trim());
  const s = stripGigaTrans(String((m && m.text) || '')).replace(/\s+/g, ' ').trim();   // GigaTrans 마커 벗긴 번역문으로 teaser
  return s ? (s.length > 80 ? s.slice(0, 80) + '…' : s) : '(빈 메시지)';
};
const inboxDate = (ms: any): string => { const n = +ms; if (!isFinite(n) || n <= 0) return ''; try { return new Date(n).toISOString().slice(0, 10); } catch (_) { return ''; } };
// inbox 항목 → 기존 '채팅 가져오기' 설정 모달용 parsed(검증된 변환 경로). 외부 유입이라 이름·메시지 coerce/살균.
function inboxParsed(it: any): { parsed: any; total: number } {
  const name = (String((it && it.char) || '').replace(/[<>]/g, '').slice(0, 300).trim()) || '리스 로그';
  const messages = (Array.isArray(it && it.messages) ? it.messages : [])
    .map((m: any) => ({ role: (m && m.role === 'user') ? 'user' : 'char', text: stripGigaTrans(String((m && m.text) || '')) }))   // GigaTrans 마커 정규화(번역문만)
    .filter((m: any) => m.text.trim());
  const assets = (it && it.assets && typeof it.assets === 'object' && !Array.isArray(it.assets)) ? it.assets : null;   // ★에셋 맵(이름→dataURL) — Firestore SDK가 mapValue를 평문으로 디코드
  const cleanupRegex = (it && Array.isArray(it.cleanupRegex)) ? it.cleanupRegex : null;   // ★정리 정규식 동봉(B) — Firestore SDK가 arrayValue를 평문 배열로 디코드
  return { parsed: { char: name, fp: String((it && it.fp) || ''), assets, cleanupRegex, chats: [{ name: '리스', messages }] }, total: messages.length };
}
async function inboxDelete(id: string) { try { const R = await import('./risuPush.js'); await R.deleteInbox(id); } catch (_) { setStatus('삭제 실패 — 잠시 후 다시'); } }   // 라이브 감지가 목록·배지 갱신

function inboxItemRow(it: any): HTMLElement {
  const row = document.createElement('div'); row.className = 'inbox-item';
  const msgs = Array.isArray(it.messages) ? it.messages : [];
  const top = document.createElement('div'); top.className = 'inbox-item-top';
  top.appendChild(Object.assign(document.createElement('span'), { className: 'inbox-item-name', textContent: String(it.char || '리스 로그') }));   // textContent = escape
  top.appendChild(Object.assign(document.createElement('span'), { className: 'inbox-item-meta', textContent: `${msgs.length}개${inboxDate(it.createdAt) ? ' · ' + inboxDate(it.createdAt) : ''}` }));
  if (it.translated) top.appendChild(Object.assign(document.createElement('span'), { className: 'inbox-chip', textContent: '번역됨' }));
  row.appendChild(top);
  row.appendChild(Object.assign(document.createElement('div'), { className: 'inbox-item-prev', textContent: inboxPreview(msgs) }));
  const acts = document.createElement('div'); acts.className = 'inbox-item-acts';
  const saveB = Object.assign(document.createElement('button'), { className: 'primary', textContent: '서재로 보관' }) as HTMLButtonElement;
  saveB.onclick = () => { const { parsed, total } = inboxParsed(it); if (!total) { setStatus('빈 로그라 보관할 게 없어요.'); return; } showChatImportModal(parsed, total, async () => { await inboxDelete(it._id); }); };
  const prevB = Object.assign(document.createElement('button'), { textContent: '미리보기' }) as HTMLButtonElement;
  prevB.onclick = () => inboxPreviewModal(it);
  const delB = Object.assign(document.createElement('button'), { textContent: '삭제' }) as HTMLButtonElement;
  delB.onclick = () => inboxDelete(it._id);
  acts.append(saveB, prevB, delB); row.appendChild(acts);
  return row;
}
function renderInboxList() {
  const body = inboxPanelBody; if (!body) return; body.innerHTML = '';
  if (inboxBulkBar) inboxBulkBar.style.display = inboxDocs.length ? '' : 'none';   // 비면 일괄 바 숨김
  if (!inboxDocs.length) {
    const e = document.createElement('div'); e.className = 'inbox-empty';
    e.innerHTML = '받은 로그가 없어요.<br>리스에서 “로그파파로 보내기”를 누르면 여기로 옵니다.';
    body.appendChild(e); return;
  }
  for (const it of inboxDocs) body.appendChild(inboxItemRow(it));
}
function openInboxPanel() {
  const ov = document.createElement('div'); ov.className = 'import-modal';
  const card = document.createElement('div'); card.className = 'import-card adv-card';
  const close = () => { inboxPanelBody = null; inboxBulkBar = null; ov.remove(); };
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-title', textContent: '받은 로그함' }));
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-info', textContent: '검토하고 [서재로 보관]을 누르면 평소 설정으로 저장됩니다.' }));
  const bulk = document.createElement('div'); bulk.className = 'inbox-bulk'; inboxBulkBar = bulk;
  const allSave = Object.assign(document.createElement('button'), { className: 'primary', textContent: '전체 보관' }); allSave.onclick = () => bulkImport();
  const allDel = Object.assign(document.createElement('button'), { className: 'series-del', textContent: '전체 삭제' }); allDel.onclick = () => bulkDelete();
  bulk.append(allSave, allDel); card.appendChild(bulk);
  const body = document.createElement('div'); body.className = 'inbox-list'; card.appendChild(body); inboxPanelBody = body;
  const btns = document.createElement('div'); btns.className = 'import-btns';
  const cl = Object.assign(document.createElement('button'), { textContent: '닫기' }); cl.onclick = close;
  btns.append(cl); card.appendChild(btns);
  ov.appendChild(card); document.body.appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  renderInboxList();
}

// 미리보기 — 보관 전 메시지·번역 상태 엿보기(간단 목록, escape).
function inboxPreviewModal(it: any) {
  const { parsed, total } = inboxParsed(it);
  const ov = document.createElement('div'); ov.className = 'import-modal';
  const card = document.createElement('div'); card.className = 'import-card adv-card';
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-title', textContent: '미리보기 — ' + parsed.char }));
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-info', textContent: `메시지 ${total}개` + (it.translated ? ' · 번역됨' : '') }));
  const list = document.createElement('div'); list.className = 'inbox-list';
  for (const m of parsed.chats[0].messages) {
    const r = document.createElement('div'); r.className = 'inbox-item';
    r.appendChild(Object.assign(document.createElement('div'), { className: 'inbox-item-meta', textContent: m.role === 'user' ? '나' : parsed.char }));
    const t = document.createElement('div'); t.style.cssText = 'font-size:13px;line-height:1.6;white-space:pre-wrap;color:var(--ink);'; t.textContent = m.text;   // textContent = escape
    r.appendChild(t); list.appendChild(r);
  }
  card.appendChild(list);
  const btns = document.createElement('div'); btns.className = 'import-btns';
  const cl = Object.assign(document.createElement('button'), { textContent: '닫기' }); cl.onclick = () => ov.remove(); btns.append(cl); card.appendChild(btns);
  ov.appendChild(card); document.body.appendChild(ov); ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
}
// 전체 삭제 — 확인 후 내 inbox 전부 삭제(라이브 감지가 목록·배지 갱신).
async function bulkDelete() {
  const items = inboxDocs.slice(); if (!items.length) return;
  if (!(await confirmModal(`받은 로그 ${items.length}개를 모두 삭제할까요? 되돌릴 수 없습니다.`, { okText: '전체 삭제', danger: true }))) return;
  for (const it of items) { try { await inboxDelete(it._id); } catch (_) {} }
  setStatus('받은 로그를 모두 삭제했어요.');
}
// 전체 보관 — 설정 한 번으로 전부 순차 저장(기존 변환 엔진), 성공분 삭제. 마지막 설정 기억(반복 시 빠르게).
const INBOX_OPTS_KEY = 'pro2-inbox-import-opts';
const loadInboxOpts = (): any => { try { const o = JSON.parse(localStorage.getItem(INBOX_OPTS_KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (_) { return {}; } };
const saveInboxOpts = (o: any) => { try { localStorage.setItem(INBOX_OPTS_KEY, JSON.stringify(o)); } catch (_) {} };
function bulkImport() {
  const items = inboxDocs.slice(); if (!items.length) return;
  const last = loadInboxOpts();
  const ov = document.createElement('div'); ov.className = 'import-modal';
  const card = document.createElement('div'); card.className = 'import-card';
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-title', textContent: '전체 보관 설정' }));
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-info', textContent: `받은 로그 ${items.length}개를 한 설정으로 모두 저장합니다(작품명은 각자 캐릭터명).` }));
  const row = (label: string, el: HTMLElement) => { const r = document.createElement('label'); r.className = 'import-row'; r.append(Object.assign(document.createElement('span'), { textContent: label }), el); card.appendChild(r); };
  const design = document.createElement('select'); for (const id of TEMPLATE_ORDER) { const o = document.createElement('option'); o.value = id; o.textContent = TEMPLATE_DEFS[id].label; design.appendChild(o); } design.value = last.design || 'webnovel'; row('어떤 디자인으로 저장', design);
  const mode = document.createElement('select'); [['count', '메시지 N개씩'], ['total', '총 N화로 균등']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; mode.appendChild(o); }); mode.value = last.mode || 'count'; row('화 나누기', mode);
  const num = document.createElement('input'); num.type = 'number'; num.min = '1'; num.max = '500'; num.value = String(last.n || 20); row('N (개수/화수)', num);
  const roleWrap = document.createElement('label'); roleWrap.className = 'import-check'; const roleCb = document.createElement('input'); roleCb.type = 'checkbox'; roleCb.checked = last.roleColor !== false; roleWrap.append(roleCb, document.createTextNode(' 유저/캐릭터 박스색 구분 (기본 카드만)')); card.appendChild(roleWrap);
  const cleanWrap = document.createElement('label'); cleanWrap.className = 'import-check'; const cleanCb = document.createElement('input'); cleanCb.type = 'checkbox'; cleanCb.checked = !!last.clean; cleanWrap.append(cleanCb, document.createTextNode(' 보관 시 군더더기 자동 정리 (무료·본문 보존)')); card.appendChild(cleanWrap);
  const hideWrap = document.createElement('label'); hideWrap.className = 'import-check'; const hideUserCb = document.createElement('input'); hideUserCb.type = 'checkbox'; hideUserCb.checked = !!last.hideUser; hideWrap.append(hideUserCb, document.createTextNode(' 내 입력 빼기 (캐릭터 응답만 저장)')); card.appendChild(hideWrap);
  const btns = document.createElement('div'); btns.className = 'import-btns';
  const go = Object.assign(document.createElement('button'), { className: 'primary', textContent: '전체 보관' }) as HTMLButtonElement;
  const cancel = Object.assign(document.createElement('button'), { textContent: '취소' }) as HTMLButtonElement; cancel.onclick = () => ov.remove();
  go.onclick = async () => {
    go.disabled = true; cancel.disabled = true;
    const opts: any = { design: design.value, mode: mode.value, n: Math.max(1, +num.value || 1), roleColor: roleCb.checked, numbered: false, clean: cleanCb.checked, hideUser: hideUserCb.checked };
    saveInboxOpts(opts);
    let done = 0, fail = 0;
    for (const it of items) {
      const { parsed, total } = inboxParsed(it);
      go.textContent = `보관 중… ${done + fail + 1}/${items.length}`;
      if (!total) { try { await inboxDelete(it._id); } catch (_) {} continue; }
      try { await buildAndSaveChat(parsed, Object.assign({ char: parsed.char, userLabel: '나', charLabel: parsed.char, noNav: true }, opts)); await inboxDelete(it._id); done++; }
      catch (e) { fail++; console.warn('[risu] 전체 보관 항목 실패', e); }
    }
    ov.remove();
    setStatus(`전체 보관 완료 — ${done}개 저장${fail ? `, ${fail}개 실패(우체통에 남음)` : ''}.`);
    try { lastDataSig = dataSig(); route(); } catch (_) {}
  };
  btns.append(go, cancel); card.appendChild(btns);
  ov.appendChild(card); document.body.appendChild(ov); ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
}

// ====== 라우터 ======
// #/(홈) · #/series/:char(작품 상세) · #/read/:char[/:epId](뷰어)
async function route() {
  const h = location.hash || '#/';
  // ★모든 읽기(공유 #/share·내 화 #/log·옛 #/read)는 독립 리더 페이지(reader.html)로 이전 → 리다이렉트(하위호환).
  //   옛 library.html#/share·#/log·#/read 링크가 전부 reader.html로 살아서 넘어간다. (신규 링크도 reader.html.)
  if (/^#\/(share|log|read)\//.test(h)) { location.replace('reader.html' + h); return; }
  document.body.classList.remove('lib-reading');   // 서재 화면(홈·작품)에선 고정 헤더 표시
  const m = /^#\/series\/(.+)$/.exec(h);
  if (m) { renderSeries(decodeURIComponent(m[1])); return; }
  renderHome();
}
// 백그라운드(데이터 갱신성) 재렌더 전용 스크롤 보존.
// ★타이밍 무관: 다시 그리기 전 위치를 pendingScrollY에 기억했다가, 새 화면이 다 자리잡은 "렌더 끝"에서
//   복원한다 — renderHome(동기)·renderSeries(비동기) 각자 자기 끝에서 applyPendingScroll을 부른다.
//   (DOM 관찰자에 기대지 않음 = 동기 홈에서 안 불리던 버그 제거.)
// 명시적 이동(hashchange=작품 클릭·뒤로가기)은 plain route()라 pendingScrollY가 -1 → 복원 안 함 → 맨 위.
let pendingScrollY = -1;
function routePreservingScroll() {
  const sc = document.querySelector('.archive-list, .series-scroll') as HTMLElement | null;
  pendingScrollY = sc ? sc.scrollTop : 0;
  route();
}
function applyPendingScroll(scroller: HTMLElement | null) {
  if (pendingScrollY > 0 && scroller) scroller.scrollTop = pendingScrollY;
  pendingScrollY = -1;
}

// 로딩 오버레이 + 동기화 진행률(%). "켤 때 동기화 끝나면 보여주기" — 단, 어떤 비동기에도 막히지 않게.
const libLoadingEl = document.getElementById('lib-loading');
const libPctEl = document.getElementById('lib-loading-pct');
const libTextEl = document.getElementById('lib-loading-text');
let pctShown = 0, pctTarget = 6, pctTimer: any = null;
const paintPct = () => { if (libPctEl) libPctEl.textContent = Math.min(100, Math.round(pctShown)) + '%'; };
// 단계별 목표치까지 부드럽게 차오르게(멈춰 보이지 않도록). 완료 전엔 93%에서 대기.
function pctTo(t: number, label?: string) { pctTarget = Math.max(pctTarget, t); if (label && libTextEl) libTextEl.textContent = label; }
function startPct() { paintPct(); pctTimer = setInterval(() => { const cap = Math.min(pctTarget, 93); if (pctShown < cap) { pctShown += Math.max(0.5, (cap - pctShown) * 0.12); paintPct(); } }, 120); }
function hideLibLoading() {
  pctShown = 100; pctTarget = 100; paintPct(); if (pctTimer) { clearInterval(pctTimer); pctTimer = null; }
  if (libLoadingEl) { libLoadingEl.classList.add('hide'); setTimeout(() => { try { libLoadingEl.remove(); } catch (_) {} }, 400); }
}

// ★비상 복구 — 거대 챗을 옛 경로로 가져오다 크래시해 무거운 화가 남으면, 다음 로딩(logsAll의 getAll)에서 또 OOM.
//   이 라우트는 무거운 로딩을 타기 전에 가로채, 작품별 용량만 가볍게 재서(커서) 목록을 보여준다.
//   ★자동 삭제 없음 — 사용자가 거대한 작품(용량으로 한눈에 보임)을 직접 골라 그 작품만 지운다(다른 작품·읽기기록·프리셋 보존).
async function runRecovery() {
  try { const el = document.getElementById('lib-loading'); if (el) el.remove(); } catch (_) {}
  const goHome = () => { location.hash = '#/'; location.reload(); };   // ★해시만 바꾸면 리로드 안 됨(복구는 부트에서만 분기) → reload로 정상 서재 진입
  { const b = document.getElementById('brand'); if (b) (b as HTMLElement).onclick = goHome; }   // 로고 클릭 = 서재홈(복구 페이지에선 기본 핸들러 미설정 상태라 직접 연결)
  const app = document.getElementById('app') || document.body;
  app.innerHTML = '';
  // .lib-app은 자체 스크롤이 없다(내부 컨테이너가 스크롤) → 긴 목록이 잘리지 않게 스크롤 래퍼로 감싼다.
  const scroll = document.createElement('div'); scroll.style.cssText = 'flex:1 1 auto;min-height:0;overflow-y:auto;width:100%;';
  const box = document.createElement('div'); box.style.cssText = 'max-width:640px;margin:48px auto;padding:0 24px 48px;font:15px/1.7 system-ui,sans-serif;';
  const h = document.createElement('div'); h.style.cssText = 'font-size:20px;font-weight:700;margin-bottom:6px;'; h.textContent = '비상 복구';
  const p = document.createElement('div'); p.style.marginBottom = '6px'; p.textContent = '서재가 메모리 부족으로 안 열릴 때 쓰는 화면입니다. 용량이 비정상적으로 큰 작품을 직접 골라 지우세요. (다른 작품·읽기기록·프리셋은 그대로)';
  const status = document.createElement('div'); status.style.cssText = 'color:#a98;margin:8px 0;'; status.textContent = '작품 용량 확인 중…';
  const list = document.createElement('div'); list.style.cssText = 'margin-top:8px;';
  const goBtn = document.createElement('button'); goBtn.textContent = '서재로 가기'; goBtn.style.cssText = 'margin-top:18px;padding:8px 16px;cursor:pointer;';
  goBtn.onclick = goHome;
  box.append(h, p, status, list, goBtn); scroll.appendChild(box); app.appendChild(scroll);
  const mb = (n: number) => (n / 1048576).toFixed(1) + 'MB';
  const render = (works: Array<{ key: string; name: string; bytes: number; count: number }>) => {
    list.innerHTML = '';
    if (!works.length) { status.textContent = '저장된 작품이 없습니다.'; return; }
    status.textContent = `작품 ${works.length}개 — 용량 큰 순. 거대한 것(보통 100MB+)이 문제의 작품입니다.`;
    for (const w of works) {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid #5a4636;border-radius:8px;margin-bottom:8px;';
      const huge = w.bytes > 60 * 1048576;
      const info = document.createElement('div'); info.style.flex = '1';
      info.innerHTML = `<div style="font-weight:600">${(w.name || '(이름 없음)').replace(/</g, '&lt;')}</div><div style="color:#a98;font-size:13px">${mb(w.bytes)} · ${w.count}화${huge ? ' · ⚠ 비정상적으로 큼' : ''}</div>`;
      const del = document.createElement('button'); del.textContent = '이 작품 삭제'; del.style.cssText = 'padding:7px 12px;cursor:pointer;' + (huge ? 'background:#c0392b;color:#fff;border:none;border-radius:6px;' : '');
      del.onclick = async () => {
        if (!confirm(`“${w.name}” (${mb(w.bytes)}, ${w.count}화)를 삭제할까요? 되돌릴 수 없습니다.\n(다른 작품은 그대로 유지됩니다.)`)) return;
        del.disabled = true; del.textContent = '삭제 중…';
        try { const r = await deleteWorkLogs(w.key); status.textContent = `“${w.name}” ${r.deleted}화 삭제 완료. 서재로 가서 정상 동작을 확인하세요.`; }
        catch (e: any) { status.textContent = '삭제 오류: ' + ((e && e.message) || e); del.disabled = false; del.textContent = '이 작품 삭제'; return; }
        row.remove();
      };
      row.append(info, del); list.appendChild(row);
    }
  };
  try { render(await scanWorkSizes()); }
  catch (e: any) { status.textContent = '용량 확인 오류: ' + ((e && e.message) || e) + ' — 새로고침 후 다시 시도하세요.'; }
}

(function init() {
  applyShellChrome();
  if ((location.hash || '') === '#/recover') { runRecovery(); return; }   // ★무거운 로딩 전에 가로채 OOM 회피
  { const b = document.getElementById('brand'); if (b) b.onclick = () => { if ((location.hash || '#/') !== '#/') location.hash = '#/'; else route(); }; }   // 로고 = 서재 홈
  // 관리실 진입 — ★웹·데스크탑 둘 다. 웹=정리 규칙만 / 데스크탑=정리+에셋추출+풀보관(management.ts가 isDesktop 게이팅).
  { const mb = document.getElementById('btn-mgmt') as HTMLElement | null; if (mb) { mb.hidden = false; (mb as HTMLButtonElement).onclick = () => { location.href = 'management.html'; }; } }
  { const hb = document.getElementById('btn-help') as HTMLElement | null; if (hb) (hb as HTMLButtonElement).onclick = () => { location.href = 'help.html#library'; }; }   // 사용설명서
  // ── 로컬-퍼스트 로딩 + ★단일 갱신 경로 헬퍼 ──
  const synced = isSessionSynced();
  if (!synced) { startPct(); pctTo(85, '서재 불러오는 중…'); }   // 오버레이가 보일 때만 진행 표시
  let shown = false;
  const showOnce = () => { if (!shown) { shown = true; hideLibLoading(); markSessionSynced(); } };
  // 첫 렌더(로컬-퍼스트·즉시). 시작 스크롤은 0이라 보존 불필요 — plain route()로 맨 위.
  const renderInitial = async () => {
    try { await reloadLogs(); route(); lastDataSig = dataSig(); } catch (_) { try { route(); } catch (__) {} }
    if (synced || allLogs.length) showOnce();
  };
  // ★데이터 갱신성 재렌더의 단일 경로 — 인증 직후·8초 안전망·폰트 등록·중복 정리·수동 동기화·실시간이
  //   전부 여길 거친다. 다시 읽고 → 지문(dataSig)이 같으면 아예 안 그린다(로컬-퍼스트·돌아온 사용자는
  //   대부분 변경 0 → 재렌더 0 → 스크롤 안 튐). 진짜 바뀐 경우에만 스크롤 위치를 보존하며 다시 그린다.
  const refreshLibrary = async () => {
    try { await reloadLogs(); } catch (_) {}
    const sig = dataSig();
    if (sig === lastDataSig) return;
    lastDataSig = sig;
    routePreservingScroll();
  };

  // 앱-레벨 ⚙ 설정(로그인·테마·스킨·화질·백업·Pro1·고급) — 서재 홈 단독 소유(편집기엔 없음). 갱신은 단일 경로로.
  mountSettingsMenu({ setStatus, getUser: () => libUser, getAuthMod: () => libAuthMod, refresh: () => refreshLibrary() });
  if (fontsSupported()) refreshFonts().then(() => refreshLibrary()).catch(() => {});   // 폰트 등록 후 갱신도 지문 가드를 탄다(안 바뀌면 재렌더 0 = 데스크탑 폰트 트리거 튐 제거)
  window.addEventListener('hashchange', route);   // ★명시적 이동(작품 클릭·뒤로가기) = plain route = 맨 위
  window.addEventListener('pro2-desktop-synced', () => { refreshLibrary(); });   // 데스크탑 수동 동기화 완료 → 보존 반영
  mountUpdateBanner();   // 데스크탑: 새 버전 받아지면 재시작 배너

  renderInitial().then(() => cleanupDuplicates());   // 즉시 로컬 렌더 후, 로컬 중복 정리
  setTimeout(() => { showOnce(); refreshLibrary(); }, 8000);   // ★8초 안전망 = 오버레이 닫기만(데이터 안 바뀌었으면 재렌더 0)
  (async () => {
    try {
      const A = await import('./auth.js');
      if (!A.authAvailable()) { const g = document.getElementById('auth-group'); if (g) g.hidden = true; showOnce(); return; }
      mountAccountUI(A); libAuthMod = A;
      const { initSync } = await import('./sync.js');
      // 백엔드 교체(로그인)·실시간 변경 모두 단일 경로(지문 가드 + 스크롤 보존)로 → 진입 직후·실시간에 안 튐.
      //   실시간/클라우드 갱신 반영 자체는 유지(다른 기기 변경 반영) — 끄는 게 아니라 스크롤만 안 깨지게.
      initSync(() => { showOnce(); refreshLibrary(); cleanupDuplicates(); }, () => { refreshLibrary(); });
      A.watchAuth((u: any) => { libUser = u || null; setupInbox(u || null); if (!u) refreshLibrary(); });
    } catch (e) { console.warn('[cloud] 로드 실패', e); showOnce(); }
  })();
})();
