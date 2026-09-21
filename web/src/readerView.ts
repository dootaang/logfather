// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/readerView.ts — 리더 공용 렌더링 툴킷(library.ts·reader.ts 공유). ★중복 복붙 금지(1차에서 공용화한 것 이전).
//
// 담는 것: 살균·리더 본문(스크롤↔페이지넘김 분기)·페이저·타이포·리더 설정 팝오버·모바일 헤더 자동숨김
//          + 공유 링크 열람(#/share, 비로그인 가능 — share.ts getShare만 씀).
// route() 의존(읽기방식 토글의 재렌더)은 rerender 콜백으로 분리 → 페이지(library/reader)별 라우터 주입.
// @ts-nocheck
import { loadReaderCfg, saveReaderCfg, loadMarks, saveMarks } from './store.js';
import { getFontList } from './fonts.js';
import { icon } from './icons.js';
import { makeAnchor, resolveAnchor } from '../../core/reader/textAnchor.js';   // 형광펜 앵커(인용+문맥+힌트) — 순수 함수, core 테스트 커버

const app = () => document.getElementById('app')!;
export const mk = (tag: string, cls?: string, text?: string): HTMLElement => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
export const firstImg = (html: string) => { const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html || ''); return m ? m[1] : ''; };
export const isMobileLib = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches);

// 본인 로그 + 살균이라 안전. script/style/iframe 등 제거 + on*/javascript: 속성 제거.
export function sanitizeArchiveHtml(html: string): string {
  try {
    const doc = new DOMParser().parseFromString('<div id="__r">' + (html || '') + '</div>', 'text/html');
    const root = doc.getElementById('__r')!;
    root.querySelectorAll('script,style,iframe,object,embed,link,meta,base,svg,math,form,input,button,textarea,select').forEach((e) => e.remove());
    root.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((a) => {
        const n = a.name.toLowerCase();
        if (n.startsWith('on')) el.removeAttribute(a.name);
        else if ((n === 'href' || n === 'src' || n === 'xlink:href') && /^\s*(javascript|vbscript|data:text\/html)/i.test(a.value)) el.removeAttribute(a.name);
      });
    });
    return root.innerHTML;
  } catch (_) { return ''; }
}

// ── 파파모드 살균 (디자인 보존 + XSS 차단) ──────────────────────────────────
// sanitizeArchiveHtml(자가 로그용)은 <style>·<svg>·form류를 통째 제거하지만, 남의 제조기 로그는 <style>
//   (@keyframes·hover·미디어쿼리·클래스 디자인)·인라인 SVG(구분선·아이콘)를 정당하게 쓴다 → 보존해야 함.
//   대신 그 보존을 노린 XSS(스크립트 실행)를 전부 막는다. ★렌더는 반드시 Shadow DOM 격리(renderPapaBlocks)에서 — 보존한 남의 <style>가 셸 CSS를 박살내지 않게.
// papa <style> 본문 CSS 살균 — @import·expression·behavior·javascript:url 등 위험 패턴만 제거(외부 http url()=배경이미지는 Phase1에서 보존, Phase2에서 굳힘).
function sanitizePapaCss(css: string): string {
  return String(css || '')
    .replace(/<\s*\/\s*style/gi, '')                                          // </style 탈출 방지
    .replace(/@import[^;]*;?/gi, '')                                          // @import(외부 로드)
    .replace(/@charset[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, '(')                                        // IE expression()
    .replace(/behavior\s*:[^;}]*/gi, '')                                      // IE behavior(.htc)
    .replace(/-moz-binding\s*:[^;}]*/gi, '')                                  // 레거시 XBL
    .replace(/url\s*\(\s*['"]?\s*(?:javascript|vbscript):[^)]*\)/gi, 'none')  // url(javascript:)
    .replace(/javascript:/gi, '');
}
export function sanitizePapaHtml(html: string): string {
  try {
    const doc = new DOMParser().parseFromString('<div id="__p">' + (html || '') + '</div>', 'text/html');
    const root = doc.getElementById('__p')!;
    // 차단: 스크립트/임베드/메타/폼류 = 통째 제거. ★style·svg·details/summary·일반 구조 태그는 보존.
    root.querySelectorAll('script,iframe,object,embed,link,meta,base,form,input,button,textarea,select,noscript,template').forEach((e) => e.remove());
    // <style> 본문 CSS 살균(요소는 보존).
    root.querySelectorAll('style').forEach((s) => { s.textContent = sanitizePapaCss(s.textContent || ''); });
    root.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((a) => {
        const n = a.name.toLowerCase();
        if (n.startsWith('on')) el.removeAttribute(a.name);                    // on* 이벤트 핸들러 전부
        else if ((n === 'href' || n === 'src' || n === 'xlink:href' || n === 'srcset' || n === 'data') && /^\s*(javascript|vbscript|data:text\/html)/i.test(a.value)) el.removeAttribute(a.name);
        else if (n === 'style' && /(expression\s*\(|javascript:|behavior\s*:|-moz-binding)/i.test(a.value)) el.setAttribute('style', sanitizePapaCss(a.value));  // 인라인 style의 위험 패턴만 제거
      });
    });
    return root.innerHTML;
  } catch (_) { return ''; }
}
// ★파파 다중 블록 구분자 — 한 화에 로그를 여러 칸으로 나눠 담을 때, 합본 html을 블록 단위로 쪼개는 마커(HTML 주석=렌더 무해).
//   블록마다 따로 Shadow DOM에 넣어야 서로 다른 남의 <style>가 충돌하지 않는다(디자인 안 섞임).
export const PAPA_SEP = '<!--LP_PAPA_BLOCK-->';
// 파파 로그를 (블록마다) Shadow DOM 안에서 렌더 — 보존한 남의 <style>/클래스/인라인 스타일을 shadow 경계 안에 가둬
//   우리 리더·서재 셸 CSS를 안 건드리고, 우리 테마(--reader-*)도 남의 디자인 안으로 안 샌다 = "그 디자인 그대로".
//   ★데이터(복사·공유 fatten)는 평범한 살균 html 문자열을 그대로 씀 — 렌더만 shadow. 단일 블록=구분자 없음=shadow 1개(기존과 동일).
export function renderPapaBlocks(host: HTMLElement, html: string): void {
  host.innerHTML = '';
  const parts = String(html || '').split(PAPA_SEP);
  parts.forEach((part, i) => {
    if (parts.length > 1 && !part.trim()) return;   // 다중일 때 빈 조각 스킵
    const block = document.createElement('div'); block.className = 'papa-block';
    const safe = sanitizePapaHtml(part);
    try { (block.attachShadow({ mode: 'open' })).innerHTML = safe; }
    catch (_) { block.innerHTML = safe; }   // Shadow DOM 미지원 폴백(이미 살균됨)
    host.appendChild(block);
  });
}
export const isPapa = (r: any) => !!(r && r.template === 'papa');

// 모바일 상단 헤더 자동 숨김(아래 스크롤=숨김, 위=표시). 헤더를 fixed 오버레이로 빼 피드백 루프 차단.
export function autoHideBar(scroller: HTMLElement, bars: (HTMLElement | null)[]) {
  if (!isMobileLib()) return;
  const list = bars.filter(Boolean) as HTMLElement[];
  if (!list.length) return;
  let offset = 0;
  for (const b of list) {
    b.classList.add('auto-hide-bar');
    b.style.transform = '';
    b.style.top = offset + 'px';
    b.dataset.ahHide = (offset + b.offsetHeight) + '';
    offset += b.offsetHeight;
  }
  scroller.style.paddingTop = (offset + 10) + 'px';
  const setHidden = (hide: boolean) => { for (const b of list) b.style.transform = hide ? `translateY(-${b.dataset.ahHide}px)` : ''; };
  let lastY = scroller.scrollTop, ticking = false;
  scroller.addEventListener('scroll', () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const y = scroller.scrollTop;
      const max = scroller.scrollHeight - scroller.clientHeight;
      if (y <= 4) { setHidden(false); lastY = y; return; }
      if (y >= max - 4) { lastY = y; return; }
      if (Math.abs(y - lastY) < 12) return;
      setHidden(y > lastY);
      lastY = y;
    });
  }, { passive: true });
}

// 리더 설정 로드 + 1회 이관(옛 'light' → '자동').
export function rdCfg(): any {
  const c = loadReaderCfg();
  if (!c.themeV) { if (!c.theme || c.theme === 'light') c.theme = 'system'; c.themeV = 1; saveReaderCfg(c); }
  return c;
}

const RD_SERIF = "'Noto Serif KR', Georgia, serif";
const RD_SANS = "'Pretendard Variable', Pretendard, system-ui, sans-serif";
export const isWebnovel = (r: any) => !!(r && (r.template === 'webnovel' || /class="lp-webnovel"/.test(String(r.html || ''))));
function wnFontFamily(wnFont: string): string {
  if (!wnFont || wnFont === 'serif') return RD_SERIF;
  if (wnFont === 'sans') return RD_SANS;
  return `'${String(wnFont).replace(/['"]/g, '')}', ${RD_SANS}`;
}
export function applyWnTypography(reader: HTMLElement, col: HTMLElement | null, rcfg: any, theme?: string) {
  reader.dataset.theme = theme || rcfg.wnTheme;
  reader.style.setProperty('--reader-font', wnFontFamily(rcfg.wnFont));
  reader.style.setProperty('--reader-size', rcfg.wnSize + 'px');
  reader.style.setProperty('--reader-lh', String(rcfg.wnLh));
  if (col) col.style.maxWidth = rcfg.wnWidth + 'px';
}

const WN_PAGE_MIN = 1024;
export function wnPagedResolved(rcfg: any): boolean { return rcfg.wnPaged === undefined ? (window.innerWidth >= WN_PAGE_MIN) : !!rcfg.wnPaged; }

// ── 화 안 읽던 위치 기억(기기 로컬) ──────────────────────────────────────────
// 페이지 번호가 아니라 비율(0~1)로 저장 — 글자 크기·창 폭이 바뀌어 총 페이지가 달라져도 같은 지점으로. 세로 스크롤도 같은 비율 키를 씀.
//   ★동기화 KV가 아니라 localStorage: 페이지 넘길 때마다 쓰는 값이라 클라우드 쓰기 churn 방지(공유 진행도 SHARE_PROGRESS_KEY와 같은 결).
//   키 = 화 id(서재) / 'share:<id>[:n]'(공유). 최근 400건만 보관. 0(맨 앞)이면 항목 삭제 = "아직 안 읽음".
const READ_POS_KEY = 'pro2-read-pos';
const READ_POS_MAX = 400;
let posCache: Record<string, { f: number; t: number }> | null = null;
let posFlushT: any = null;
function posMap(): Record<string, { f: number; t: number }> {
  if (!posCache) { try { const o = JSON.parse(localStorage.getItem(READ_POS_KEY) || '{}'); posCache = (o && typeof o === 'object') ? o : {}; } catch (_) { posCache = {}; } }
  return posCache!;
}
function posFlush(): void {
  posFlushT = null;
  const m = posMap(); const keys = Object.keys(m);
  if (keys.length > READ_POS_MAX) { keys.sort((a, b) => (m[a].t || 0) - (m[b].t || 0)); keys.slice(0, keys.length - READ_POS_MAX).forEach((k) => { delete m[k]; }); }
  try { localStorage.setItem(READ_POS_KEY, JSON.stringify(m)); } catch (_) {}
}
export function getReadPos(key: string): number { const e = key ? posMap()[key] : null; return (e && typeof e.f === 'number' && e.f > 0 && e.f <= 1) ? e.f : 0; }
export function setReadPos(key: string, f: number, now?: boolean): void {
  if (!key || !(f >= 0)) return;
  const m = posMap();
  if (f <= 0) delete m[key]; else m[key] = { f: Math.min(1, f), t: Date.now() };
  if (now) { if (posFlushT) clearTimeout(posFlushT); posFlush(); }
  else if (!posFlushT) posFlushT = setTimeout(posFlush, 400);
}
export function clearReadPos(key: string): void { setReadPos(key, 0, true); }
try { window.addEventListener('pagehide', () => { if (posFlushT) { clearTimeout(posFlushT); posFlush(); } }); } catch (_) {}

// 웹소설형 좌우 페이지 넘김(전자책식, 반응형+스와이프). posKey = 읽던 페이지 기억 키(없으면 기억 안 함).
function buildWnPager(reader: HTMLElement, html: string, rcfg: any, posKey?: string): { relayout: () => void; stage: HTMLElement; doc: HTMLElement; setAnim: (on: boolean) => void; goTo: (n: number) => void; getPage: () => number; getTotal: () => number; pageOf: (el: HTMLElement) => number; onPage: (fn: () => void) => void } {
  const pager = mk('div', 'reader-pager');
  const stage = mk('div', 'reader-pager-stage');
  const doc = mk('div', 'reader-card reader-pager-doc'); doc.innerHTML = sanitizeArchiveHtml(html);
  doc.classList.toggle('anim', !!rcfg.wnPageAnim);
  stage.appendChild(doc); pager.appendChild(stage);
  const prev = mk('button', 'reader-page-arrow prev', '‹'); prev.setAttribute('aria-label', '이전 페이지');
  const next = mk('button', 'reader-page-arrow next', '›'); next.setAttribute('aria-label', '다음 페이지');
  const ind = mk('div', 'reader-page-ind', ''); ind.setAttribute('role', 'button'); ind.tabIndex = 0; ind.title = '페이지 이동 — 번호(예: 50) 또는 비율(예: 50%) 입력';
  pager.append(prev, next, ind); reader.appendChild(pager);
  let page = 0, total = 1, screenStep = 1;
  let lastCols = 1, lastColStep = 1;   // 마지막 relayout의 컬럼 수·컬럼 간격(px) — 요소→페이지 환산(목차 점프)용
  const pageFns: (() => void)[] = [];   // 페이지 바뀔 때(apply) 부를 리스너 — 책갈피 귀퉁이 상태 갱신 등
  let editing = false;   // 페이지 이동 팝오버(슬라이더+번호 입력)가 열린 상태
  let syncPop: (() => void) | null = null;   // 열린 팝오버의 슬라이더·입력을 현재 page/total에 맞춤(relayout·넘김 시)
  let touched = false;   // 사용자가 한 번이라도 넘겼나 — 그 전까진 relayout마다 저장된 비율로 페이지를 다시 잡음(이미지 늦게 로드돼 총 페이지가 바뀌어도 같은 지점)
  const restoreF = posKey ? getReadPos(posKey) : 0;
  const apply = () => { doc.style.transform = `translateX(${-page * screenStep}px)`; ind.textContent = `${page + 1} / ${total}`; if (syncPop) syncPop(); (prev as HTMLButtonElement).disabled = page <= 0; (next as HTMLButtonElement).disabled = page >= total - 1; for (const fn of pageFns) { try { fn(); } catch (_) {} } };
  const relayout = () => {
    // 두 페이지 사이 등마루 간격(px) — 리더 설정 "간격" 슬라이더로 조절(기본 28). 컬럼 폭·넘김 step 계산에도 쓰임.
    const GAP = (rcfg.wnPageGap != null ? rcfg.wnPageGap : 28);
    doc.style.transform = 'none';
    const auto = rcfg.wnPageAuto !== false;
    stage.style.width = '100%'; stage.style.maxWidth = 'none';
    const availW = stage.clientWidth || 1;
    let cols = (rcfg.wnPageCols !== 1 && window.innerWidth >= WN_PAGE_MIN) ? 2 : 1;
    let colW = Math.floor((availW - (cols - 1) * GAP) / cols);
    if (cols === 2 && colW < 300) { cols = 1; colW = availW; }
    if (!auto) colW = Math.min(colW, Math.max(80, rcfg.wnWidth || 620));
    colW = Math.max(80, colW);
    const stageW = cols * colW + (cols - 1) * GAP;
    stage.style.width = stageW + 'px'; stage.style.maxWidth = stageW + 'px';
    doc.style.columnGap = GAP + 'px'; doc.style.columnWidth = colW + 'px';
    // ★작업 5: 큰 이미지 잘림 방지 — multicol에선 이미지 max-height:%가 무시되므로 페이지(컬럼) 높이를 px로 계산해
    //   CSS 변수(--wn-page-h)로 doc에 준다(이미지 여백분 차감). 이미지 max-height가 이 변수를 쓰면 비율 유지하며 페이지에 통째로 들어감.
    const pageH = stage.clientHeight || 0;
    if (pageH > 120) doc.style.setProperty('--wn-page-h', Math.max(80, pageH - 40) + 'px'); else doc.style.removeProperty('--wn-page-h');
    const colStep = colW + GAP;
    const totalCols = Math.max(1, Math.round((doc.scrollWidth + GAP) / colStep));
    total = Math.max(1, Math.ceil(totalCols / cols));
    screenStep = cols * colStep; lastCols = cols; lastColStep = colStep;
    if (!touched && restoreF > 0) page = Math.max(0, Math.min(total - 1, Math.floor(restoreF * total)));   // 저장 비율 → 현재 총 페이지 기준 위치
    else if (page > total - 1) page = total - 1;
    apply();
  };
  // 페이지 중앙 비율로 저장((page+0.5)/total) — 복원은 floor(f*total)이라 총 페이지가 그대로면 정확히 같은 페이지, 달라지면 같은 지점 근처. 1페이지는 삭제(=처음부터).
  const savePos = () => { if (posKey) setReadPos(posKey, page > 0 ? (page + 0.5) / total : 0); };   // 400ms 디바운스 flush(캐시는 즉시)
  const goTo = (n: number) => { const np = Math.max(0, Math.min(total - 1, Math.floor(n))); touched = true; if (np !== page) { page = np; apply(); } savePos(); };
  const go = (d: number) => goTo(page + d);
  // 본문 요소가 놓인 페이지(0-based): doc 좌단 기준 x 오프셋 → 컬럼 번호 → 페이지. rect 차이라 translateX·애니메이션 중에도 정확.
  const pageOf = (el: HTMLElement): number => {
    const x = el.getBoundingClientRect().left - doc.getBoundingClientRect().left;
    const col = Math.max(0, Math.floor((x + 2) / Math.max(1, lastColStep)));
    return Math.max(0, Math.min(total - 1, Math.floor(col / Math.max(1, lastCols))));
  };
  // 인디케이터 클릭 → 페이지 이동 팝오버: 슬라이더(드래그=즉시 이동, 리디식 스크러버) + 번호(1~총페이지)/%(비율) 입력 + 이동 버튼.
  //   Enter=이동, Esc·바깥 클릭·인디케이터 재클릭=닫기. 범위 밖 번호는 양끝으로 자름. 팝오버는 pager에 붙어 stage 탭 판정과 안 섞임.
  const openJump = () => {
    if (editing) { closeJump(); return; }
    editing = true; ind.classList.add('editing');
    const pop = mk('div', 'reader-page-pop'); pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', '페이지 이동');
    const sRow = mk('div', 'rpp-row');
    const sMin = mk('span', 'rpp-end', '1'); const sMax = mk('span', 'rpp-end', String(total));
    const range = document.createElement('input'); range.type = 'range'; range.min = '1'; range.max = String(total); range.step = '1'; range.value = String(page + 1); range.setAttribute('aria-label', '페이지 슬라이더');
    sRow.append(sMin, range, sMax);
    const iRow = mk('div', 'rpp-row');
    const inp = document.createElement('input'); inp.className = 'reader-page-jump'; inp.type = 'text'; inp.inputMode = 'numeric'; inp.autocomplete = 'off';
    inp.placeholder = `1–${total} 또는 %`; inp.setAttribute('aria-label', '이동할 페이지'); inp.value = String(page + 1);
    const goB = mk('button', 'rpp-go', '이동') as HTMLButtonElement;
    iRow.append(inp, goB);
    pop.append(sRow, iRow); pager.appendChild(pop);
    let fromRange = false;   // 슬라이더가 움직인 직후엔 입력칸 숫자만 따라가고 슬라이더 값은 건드리지 않음(드래그 중 되감김 방지)
    syncPop = () => { sMax.textContent = String(total); range.max = String(total); if (!fromRange) range.value = String(page + 1); inp.value = String(page + 1); };
    range.oninput = () => { fromRange = true; goTo(+range.value - 1); fromRange = false; };
    const commit = () => {
      const s = inp.value.trim(); let np = -1;
      const pm = /^(\d+(?:\.\d+)?)\s*%$/.exec(s);
      if (pm) np = Math.floor(Math.min(100, +pm[1]) / 100 * total);
      else if (/^\d+$/.test(s)) np = Math.max(0, +s - 1);
      if (np >= 0) { goTo(np); closeJump(); } else { inp.select(); }
    };
    goB.onclick = (e: Event) => { e.stopPropagation(); commit(); };
    const onKeyPop = (e: KeyboardEvent) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); closeJump(); } else if (e.key === 'Enter' && e.target === inp) { e.preventDefault(); commit(); } };
    pop.addEventListener('keydown', onKeyPop);
    pop.onclick = (e: Event) => e.stopPropagation();
    const onDown = (e: Event) => { const t = e.target as HTMLElement; if (!t || pop.contains(t) || ind.contains(t)) return; closeJump(); };
    setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
    closeJump = () => { if (!editing) return; editing = false; syncPop = null; ind.classList.remove('editing'); document.removeEventListener('mousedown', onDown, true); pop.remove(); };
    if (!isMobileLib()) { inp.focus(); inp.select(); }   // 모바일은 자동 포커스 X(가상 키보드가 슬라이더를 가림)
  };
  let closeJump = () => {};
  ind.onclick = (e: Event) => { e.stopPropagation(); openJump(); };
  ind.onkeydown = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openJump(); } };
  const toggleBar = () => { const h = !reader.classList.contains('bar-hidden'); reader.classList.toggle('bar-hidden', h); rcfg.immersive = h; saveReaderCfg(rcfg); requestAnimationFrame(relayout); };
  prev.onclick = (e) => { e.stopPropagation(); go(-1); };
  next.onclick = (e) => { e.stopPropagation(); go(1); };
  let swiped = false;
  stage.onclick = (e: MouseEvent) => {
    if (swiped) { swiped = false; return; }
    if (selOn()) return;   // 드래그 선택 직후 클릭은 넘김 X(형광펜·숨기기 팝오버가 뜸)
    const t = e.target as HTMLElement; if (t && t.closest && t.closest('a,button,summary,mark.lp-hl')) return;
    const r = stage.getBoundingClientRect(); const x = e.clientX - r.left, third = r.width / 3;
    if (x < third) go(-1); else if (x > 2 * third) go(1); else toggleBar();
  };
  let tsx = 0, tsy = 0;
  stage.addEventListener('touchstart', (e: TouchEvent) => { const t = e.touches[0]; if (t) { tsx = t.clientX; tsy = t.clientY; } }, { passive: true });
  stage.addEventListener('touchend', (e: TouchEvent) => {
    const t = e.changedTouches[0]; if (!t) return;
    const dx = t.clientX - tsx, dy = t.clientY - tsy;
    if (!selOn() && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) { swiped = true; if (dx < 0) go(1); else go(-1); try { e.preventDefault(); } catch (_) {} }
  }, { passive: false });
  const onKey = (e: KeyboardEvent) => {
    if (!document.contains(reader)) { cleanup(); return; }   // 재렌더로 떨어져 나간 옛 페이저 = 스스로 해제
    const a = document.activeElement as HTMLElement | null;
    if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { go(1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { go(-1); e.preventDefault(); }
    else if (e.key === 'Home') { goTo(0); e.preventDefault(); }
    else if (e.key === 'End') { goTo(total - 1); e.preventDefault(); }
  };
  document.addEventListener('keydown', onKey);
  let ro: any = null; try { ro = new ResizeObserver(() => relayout()); ro.observe(pager); } catch (_) {}
  const onResize = () => relayout();
  window.addEventListener('resize', onResize);
  const cleanup = () => { closeJump(); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); try { ro && ro.disconnect(); } catch (_) {} window.removeEventListener('hashchange', cleanup); };
  window.addEventListener('hashchange', cleanup);
  requestAnimationFrame(() => { relayout(); setTimeout(relayout, 300); });
  return { relayout, stage, doc, setAnim: (on: boolean) => doc.classList.toggle('anim', on), goTo, getPage: () => page, getTotal: () => total, pageOf, onPage: (fn: () => void) => { pageFns.push(fn); } };
}

// ── 장 목차(chapter TOC) ──────────────────────────────────────────────────────
// 웹소설 템플릿의 장 구분을 본문에서 찾는다: ① .lp-wn-chapter(훅 ON) ② 훅 OFF 구조 매칭(가운데 정렬 div 안 단일 span, currentColor 밑줄+굵게)
//   ③ 사용자가 직접 넣은 h1~h3. 문서 순서로 정렬. 하나도 없으면 목차 버튼 자체를 안 그림.
function findChapters(root: HTMLElement): { el: HTMLElement; title: string }[] {
  const out: { el: HTMLElement; title: string }[] = []; const seen = new Set<HTMLElement>();
  const push = (el: HTMLElement | null) => {
    if (!el || seen.has(el)) return;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim(); if (!t) return;
    seen.add(el); out.push({ el, title: t.length > 60 ? t.slice(0, 59) + '…' : t });
  };
  try {
    root.querySelectorAll('.lp-wn-chapter').forEach((e) => push(e as HTMLElement));
    root.querySelectorAll('div > span[style*="border-bottom:1px solid currentColor"][style*="font-weight:700"]').forEach((s) => { const d = s.parentElement; if (d && d.children.length === 1 && /text-align:\s*center/.test(d.getAttribute('style') || '')) push(d); });
    root.querySelectorAll('h1, h2, h3').forEach((e) => push(e as HTMLElement));
  } catch (_) {}
  out.sort((a, b) => a.el === b.el ? 0 : ((a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1));
  return out;
}
// ── 좌하단 알약 버튼 + 목록 팝오버 (목차·책갈피 공용 1벌) ─────────────────────
//   버튼은 .reader-fabs 묶음에 나란히. count()=0이면 버튼 숨김. items()는 열 때마다 계산(현재 위치·개수 최신). del 있으면 ✕(지우기).
type PopItem = { title: string; label?: string; on?: boolean; dot?: string; muted?: boolean; pick: () => void; del?: () => void };
function attachListPop(reader: HTMLElement, o: { cls: string; iconName: string; word: string; head: string; title: string; count: () => number; items: () => PopItem[] }): { refresh: () => void } {
  let fabs = reader.querySelector(':scope > .reader-fabs') as HTMLElement | null;
  if (!fabs) { fabs = mk('div', 'reader-fabs'); reader.appendChild(fabs); }
  const btn = mk('button', 'reader-toc-btn ' + o.cls); btn.title = o.title;
  const refresh = () => { const n = o.count(); btn.style.display = n ? '' : 'none'; btn.innerHTML = icon(o.iconName) + ` ${o.word} ${n}`; };
  btn.onclick = (e: Event) => {
    e.stopPropagation();
    const old = reader.querySelector('.reader-toc-pop') as HTMLElement | null;
    const mine = !!(old && old.dataset.for === o.cls); if (old) old.remove(); if (mine) return;   // 같은 버튼 재클릭=닫기, 다른 버튼=바꿔 열기
    const pop = mk('div', 'reader-toc-pop'); pop.dataset.for = o.cls; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', o.head);
    const render = () => {
      pop.innerHTML = '';
      const items = o.items();
      pop.appendChild(mk('div', 'rtp-head', `${o.head} · ${items.length}`));
      items.forEach((it, i) => {
        const row = mk('div', 'rtp-item' + (it.on ? ' on' : '') + (it.muted ? ' muted' : ''));
        const main = mk('button', 'rtp-main');
        main.append(mk('span', 'rtp-no', String(i + 1)));
        if (it.dot) { const d = mk('span', 'rtp-dot'); d.dataset.c = it.dot; main.appendChild(d); }
        main.appendChild(mk('span', 'rtp-title', it.title));
        if (it.label) main.appendChild(mk('span', 'rtp-page', it.label));
        main.onclick = (ev: Event) => { ev.stopPropagation(); pop.remove(); it.pick(); };
        row.appendChild(main);
        if (it.del) { const d = mk('button', 'rtp-del', '✕'); d.title = '지우기'; d.setAttribute('aria-label', '지우기'); d.onclick = (ev: Event) => { ev.stopPropagation(); it.del!(); refresh(); if (o.count()) render(); else pop.remove(); }; row.appendChild(d); }
        pop.appendChild(row);
      });
    };
    render();
    pop.onclick = (ev: Event) => ev.stopPropagation();
    pop.addEventListener('keydown', (ev: KeyboardEvent) => { ev.stopPropagation(); if (ev.key === 'Escape') { ev.preventDefault(); pop.remove(); btn.focus(); } });
    reader.appendChild(pop); popAutoClose(pop, btn);
    const on = pop.querySelector('.rtp-item.on .rtp-main') as HTMLElement | null; if (on) { try { on.scrollIntoView({ block: 'center' }); } catch (_) {} on.focus(); }
  };
  fabs.appendChild(btn); refresh();
  return { refresh };
}
// 장 목차 — 페이지·스크롤 모드 공용, 위치 환산만 콜백. isPast(el)=그 장이 현재 위치보다 앞(또는 같음) → 마지막 true가 "현재 장". label(el)=보조 표기(페이지 번호 등).
function attachToc(reader: HTMLElement, root: HTMLElement, jump: (el: HTMLElement) => void, isPast: (el: HTMLElement) => boolean, label: (el: HTMLElement) => string): void {
  const chapters = findChapters(root); if (!chapters.length) return;
  attachListPop(reader, { cls: 'toc', iconName: 'bookOpen', word: '목차', head: '장 목차', title: '장 목차 — 장으로 바로 이동', count: () => chapters.length,
    items: () => { let cur = -1; chapters.forEach((c, i) => { if (isPast(c.el)) cur = i; }); return chapters.map((c, i) => ({ title: c.title, label: label(c.el), on: i === cur, pick: () => jump(c.el) })); } });
}

// ── 책갈피(리디식 "이 페이지 표시") — 계획서 HANDOFF_형광펜_책갈피.md 1단계 ─────────
// 저장: 서재 화 = 동기화 KV pro2-marks.bm[화id] / 공유 리더(비로그인) = localStorage pro2-share-marks[key]. 항목 {id, f(비율 0~1), snip(그 페이지 첫 문장 40자), t}.
//   비율 저장이라 글자 크기·창 폭이 바뀌어도 같은 지점(위치 기억과 같은 공식). 화당 50개. 원본 로그 불변(오버레이 데이터).
const SHARE_MARKS_KEY = 'pro2-share-marks';
const BM_MAX = 50;
type Bm = { id: string; f: number; snip: string; t: number };
function bmList(key: string): Bm[] {
  try {
    if (key.startsWith('share:')) { const o = JSON.parse(localStorage.getItem(SHARE_MARKS_KEY) || '{}'); return Array.isArray(o[key]) ? o[key] : []; }
    const m = loadMarks(); return Array.isArray(m.bm[key]) ? m.bm[key] : [];
  } catch (_) { return []; }
}
function bmSave(key: string, list: Bm[]): void {
  try {
    if (key.startsWith('share:')) { const o = JSON.parse(localStorage.getItem(SHARE_MARKS_KEY) || '{}'); if (list.length) o[key] = list; else delete o[key]; localStorage.setItem(SHARE_MARKS_KEY, JSON.stringify(o)); return; }
    const m = loadMarks(); if (list.length) m.bm[key] = list; else delete m.bm[key]; saveMarks(m);
  } catch (_) {}
}
// 화 삭제 시 그 화의 책갈피(·형광펜 자리) 제거. 없으면 쓰기 0.
export function clearMarks(key: string): void {
  if (!key) return;
  if (key.startsWith('share:')) { bmSave(key, []); return; }
  try { const m = loadMarks(); if (!(key in m.bm) && !(key in m.hl)) return; delete m.bm[key]; delete m.hl[key]; saveMarks(m); } catch (_) {}
}
// 여러 화 한 번에 정리(작품 삭제) — 저장 1회. 없으면 쓰기 0.
export function clearMarksMany(keys: string[]): void {
  try { const m = loadMarks(); let ch = false; for (const k of keys) { if (k in m.bm) { delete m.bm[k]; ch = true; } if (k in m.hl) { delete m.hl[k]; ch = true; } } if (ch) saveMarks(m); } catch (_) {}
}
// 화별 개수(서재 배지·내 기록) — 호출 측이 loadMarks() 1회 하고 넘김.
export function marksCountOf(m: any, key: string): { bm: number; hl: number } {
  const b = (m && m.bm && Array.isArray(m.bm[key])) ? m.bm[key].length : 0, h = (m && m.hl && Array.isArray(m.hl[key])) ? m.hl[key].length : 0;
  return { bm: b, hl: h };
}
// 목록 표시용 스니펫: 본문 블록 중 pred가 처음 true인 블록(=현재 위치에서 처음 시작하는 블록)의 텍스트 앞 40자. 파파(Shadow DOM)는 빈 문자열.
function snipFrom(root: HTMLElement, pred: (el: HTMLElement) => boolean): string {
  const body = (root.querySelector('.lp-webnovel') as HTMLElement | null) || root;
  const cands = (body.children.length > 1 ? Array.from(body.children) : Array.from(body.querySelectorAll('p, div, li, blockquote'))) as HTMLElement[];
  for (const el of cands) {
    if (!pred(el)) continue;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim(); if (!t) continue;
    return t.length > 40 ? t.slice(0, 40) + '…' : t;
  }
  return '';
}
// 귀퉁이 토글 버튼(host에 부착) + 좌하단 "책갈피 N" 목록. 모드별 차이(현재 비율·같은 페이지 판정·점프·라벨·스니펫)는 콜백으로.
function attachBookmarks(reader: HTMLElement, host: HTMLElement, key: string, o: { curF: () => number; same: (f: number) => boolean; jump: (f: number) => void; label: (f: number) => string; snip: () => string }): { toggle: () => void; paint: () => void } {
  let list = bmList(key);
  const corner = mk('button', 'reader-bm-corner'); corner.innerHTML = icon('bookmark');
  const here = () => list.find((b) => o.same(b.f));
  const pop = attachListPop(reader, { cls: 'bm', iconName: 'bookmark', word: '책갈피', head: '책갈피', title: '책갈피 목록 — 꽂아 둔 페이지로 바로 이동', count: () => list.length,
    items: () => list.map((b) => ({ title: b.snip || '(본문)', label: o.label(b.f), on: o.same(b.f), pick: () => o.jump(b.f), del: () => { list = list.filter((x) => x !== b); bmSave(key, list); paint(); } })) });
  const paint = () => { const h = !!here(); corner.classList.toggle('on', h); corner.title = (h ? '책갈피 빼기' : '이 페이지에 책갈피 꽂기') + ' (B)'; pop.refresh(); };
  const toggle = () => {
    const h = here();
    if (h) { list = list.filter((b) => b !== h); bmSave(key, list); paint(); return; }
    if (list.length >= BM_MAX) { corner.title = `책갈피는 화당 ${BM_MAX}개까지예요`; return; }
    list.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), f: o.curF(), snip: o.snip(), t: Date.now() });
    list.sort((a, b) => a.f - b.f); bmSave(key, list); paint();
  };
  corner.onclick = (e: Event) => { e.stopPropagation(); toggle(); };
  host.appendChild(corner); paint();
  return { toggle, paint };
}
// B 키 = 책갈피 토글(양 모드). e.code라 한/영 무관. 입력칸 포커스·조합키는 무시. 리더가 DOM에서 빠지면(재렌더·라우트 이탈) 스스로 해제.
function bindBookmarkKey(reader: HTMLElement, bm: { toggle: () => void } | null): void {
  if (!bm) return;
  const onKey = (e: KeyboardEvent) => {
    if (!document.contains(reader)) { document.removeEventListener('keydown', onKey); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || e.code !== 'KeyB') return;
    const a = document.activeElement as HTMLElement | null; if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
    bm.toggle(); e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
}

// ── 형광펜(하이라이트) — 계획서 HANDOFF_형광펜_책갈피.md 2단계 ───────────────────
// 저장 = 동기화 KV pro2-marks.hl[화id]. 원본 로그 불변: 표시 DOM 위에 <mark class="lp-hl">만 씌움(복사·공유·아카 카드는 저장 html을 쓰므로 영향 0).
//   앵커 = core/reader/textAnchor(인용 q + 앞뒤 문맥 + 위치 힌트). 본문 텍스트 규약 = 텍스트 노드 data를 문서 순서로 이어 붙인 것(Range.toString과 동일).
//   view = 'o'(원문 화면) | 't'(번역 화면): 칠한 화면에서만 다시 칠함(텍스트가 다르므로). 다른 화면·못 찾음 = 고아(목록에만, 흐리게).
type Hl = { id: string; c: string; q: string; pre: string; post: string; at: number; view: string; t: number; memo?: string };
const HL_MAX_LOG = 200, HL_MAX_ALL = 5000, HL_QMAX = 300;
export const HL_COLORS: [string, string][] = [['y', '노랑'], ['g', '초록'], ['p', '분홍']];
function hlList(key: string): Hl[] { try { const m = loadMarks(); return Array.isArray(m.hl[key]) ? m.hl[key] : []; } catch (_) { return []; } }
function hlSave(key: string, list: Hl[]): void { try { const m = loadMarks(); if (list.length) m.hl[key] = list; else delete m.hl[key]; saveMarks(m); } catch (_) {} }
function hlTotal(): number { try { const m = loadMarks(); let n = 0; for (const k in m.hl) n += Array.isArray(m.hl[k]) ? m.hl[k].length : 0; return n; } catch (_) { return 0; } }
// 본문 텍스트(노드 순서 이어붙임) + 각 노드 시작 오프셋.
function rootText(root: HTMLElement): { text: string; nodes: Text[]; starts: number[] } {
  const nodes: Text[] = []; const starts: number[] = []; let text = '';
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n: Node | null;
  while ((n = w.nextNode())) { nodes.push(n as Text); starts.push(text.length); text += (n as Text).data; }
  return { text, nodes, starts };
}
// Range → root 텍스트 오프셋 [start,end). root 밖이면 null. (root 시작~선택 시작 Range의 toString 길이 = 앞 텍스트 길이)
function rangeOffsets(root: HTMLElement, range: Range): [number, number] | null {
  if (!root.contains(range.commonAncestorContainer)) return null;
  try { const pre = document.createRange(); pre.setStart(root, 0); pre.setEnd(range.startContainer, range.startOffset); const s = pre.toString().length; return [s, s + range.toString().length]; } catch (_) { return null; }
}
// [s,e) 구간의 텍스트 노드들을 (필요하면 쪼개서) <mark>로 감쌈. 공백만인 조각은 건너뜀(문단 사이 줄바꿈 노드). 만든 mark 목록 반환.
function wrapRange(root: HTMLElement, s: number, e: number, id: string, c: string): HTMLElement[] {
  const rt = rootText(root); const jobs: { node: Text; a: number; b: number }[] = [];
  for (let i = 0; i < rt.nodes.length; i++) {
    const st = rt.starts[i], len = rt.nodes[i].data.length, en = st + len;
    if (en <= s || st >= e) continue;
    jobs.push({ node: rt.nodes[i], a: Math.max(0, s - st), b: Math.min(len, e - st) });
  }
  const marks: HTMLElement[] = [];
  for (const j of jobs) {
    let piece = j.node;
    if (j.a > 0) piece = piece.splitText(j.a);
    if (j.b - j.a < piece.data.length) piece.splitText(j.b - j.a);
    if (!/\S/.test(piece.data)) continue;
    const parent = piece.parentNode; if (!parent) continue;
    const m = document.createElement('mark'); m.className = 'lp-hl'; m.dataset.id = id; m.dataset.c = c;
    parent.insertBefore(m, piece); m.appendChild(piece); marks.push(m);
  }
  return marks;
}
function unwrapMarks(root: HTMLElement, id: string): void {
  root.querySelectorAll('mark.lp-hl').forEach((m) => {
    if ((m as HTMLElement).dataset.id !== id) return;
    const p = m.parentNode; if (!p) return;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m); try { p.normalize(); } catch (_) {}
  });
}
const selOn = (): boolean => { try { const s = window.getSelection(); return !!(s && !s.isCollapsed && String(s).trim()); } catch (_) { return false; } };
// 형광펜 부착: 저장분 렌더 + 칠한 곳 클릭 메뉴(색·복사·지우기) + 좌하단 "형광펜 N" 목록. add(range,c)는 선택 팝오버(readerLog)가 부름 → 안내 문구 반환.
function attachHighlights(reader: HTMLElement, root: HTMLElement, key: string, view: string, ctx: { jump: (el: HTMLElement) => void; label: (el: HTMLElement) => string; here: (el: HTMLElement) => boolean }): { add: (range: Range, c: string) => string; remove: (id: string) => void } {
  let list = hlList(key);
  const rendered = new Map<string, HTMLElement[]>();
  const pop = attachListPop(reader, { cls: 'hl', iconName: 'palette', word: '형광펜', head: '형광펜', title: '형광펜 목록 — 칠한 문장으로 바로 이동', count: () => list.length,
    items: () => list.map((h) => {
      const ms = rendered.get(h.id); const el = ms && ms[0];
      return { title: h.q.length > 60 ? h.q.slice(0, 59) + '…' : h.q, dot: h.c, muted: !el, on: !!(el && ctx.here(el)),
        label: el ? ctx.label(el) : (h.view !== view ? (h.view === 't' ? '번역 화면에서' : '원문 화면에서') : '못 찾음'),
        pick: () => { if (el) ctx.jump(el); }, del: () => remove(h.id) };
    }) });
  const render = () => {
    for (const h of list) {
      if (h.view !== view || rendered.has(h.id)) continue;
      const r = resolveAnchor(rootText(root).text, h); if (!r) continue;
      const ms = wrapRange(root, r[0], r[1], h.id, h.c); if (ms.length) rendered.set(h.id, ms);
    }
    pop.refresh();
  };
  const remove = (id: string) => { list = list.filter((h) => h.id !== id); hlSave(key, list); unwrapMarks(root, id); rendered.delete(id); pop.refresh(); };
  const recolor = (id: string, c: string) => { const h = list.find((x) => x.id === id); if (!h) return; h.c = c; hlSave(key, list); (rendered.get(id) || []).forEach((m) => { m.dataset.c = c; }); };
  const add = (range: Range, c: string): string => {
    const off = rangeOffsets(root, range); if (!off) return '본문 안의 문장만 칠할 수 있어요.';
    const rt = rootText(root); const [s, e] = off; const q = rt.text.slice(s, e);
    if (!/\S/.test(q)) return '';
    if (q.length > HL_QMAX) return `형광펜은 한 번에 ${HL_QMAX}자까지예요.`;
    if (list.length >= HL_MAX_LOG) return `이 화의 형광펜이 ${HL_MAX_LOG}개예요 — 지우고 칠해 주세요.`;
    if (hlTotal() >= HL_MAX_ALL) return `형광펜이 전체 ${HL_MAX_ALL}개예요 — 오래된 것을 정리해 주세요.`;
    const anc = makeAnchor(rt.text, s, e);
    const h: Hl = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), c, q: anc.q, pre: anc.pre, post: anc.post, at: anc.at, view, t: Date.now() };
    list.push(h); list.sort((a, b) => a.at - b.at); hlSave(key, list);
    const ms = wrapRange(root, s, e, h.id, c); if (ms.length) rendered.set(h.id, ms);
    try { window.getSelection()!.removeAllRanges(); } catch (_) {}
    pop.refresh();
    return '형광펜을 칠했어요. 칠한 곳을 누르면 색 바꾸기·지우기.';
  };
  // 칠한 곳 클릭 → 미니 메뉴(body 부착, fixed). 드래그 선택 중이면 X(선택 팝오버가 뜸). 페이지 탭 판정보다 먼저 잡아 넘김 방지.
  let menu: HTMLElement | null = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  root.addEventListener('click', (e: MouseEvent) => {
    const t = e.target as HTMLElement; const m = (t && t.closest) ? (t.closest('mark.lp-hl') as HTMLElement | null) : null; if (!m) return;
    if (selOn()) return;
    e.stopPropagation(); e.preventDefault(); closeMenu();
    const id = m.dataset.id || ''; const h = list.find((x) => x.id === id); if (!h) return;
    menu = mk('div', 'reader-hlmenu');
    for (const [c, name] of HL_COLORS) { const d = mk('button', 'hl-dot' + (h.c === c ? ' on' : '')); d.dataset.c = c; d.title = name; d.onclick = (ev: Event) => { ev.stopPropagation(); recolor(id, c); closeMenu(); }; menu.appendChild(d); }
    const cp = mk('button', 'hl-act', '복사'); cp.onclick = async (ev: Event) => { ev.stopPropagation(); try { await navigator.clipboard.writeText(h.q); } catch (_) {} closeMenu(); };
    const del = mk('button', 'hl-act danger', '지우기'); del.onclick = (ev: Event) => { ev.stopPropagation(); remove(id); closeMenu(); };
    menu.append(cp, del);
    document.body.appendChild(menu);
    const r = m.getBoundingClientRect(); const mw = menu.offsetWidth || 200;
    menu.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.left + r.width / 2 - mw / 2)) + 'px';
    menu.style.top = Math.min(window.innerHeight - 48, r.bottom + 8) + 'px';
    popAutoClose(menu, m);
    window.addEventListener('hashchange', closeMenu, { once: true });
  });
  reader.addEventListener('scroll', closeMenu, true);   // 캡처: 안쪽 스크롤러 스크롤도 메뉴 닫기
  render();
  return { add, remove };
}

// 리더 설정 팝오버. rerender = 읽기방식(스크롤↔페이지) 전환 시 호출자 라우터로 다시 그림(library/reader별).
function toggleReaderSettings(reader: HTMLElement, col: HTMLElement | null, rcfg: any, isWn: boolean, pager: any, trigger: HTMLElement | null, rerender: () => void) {
  let pop = reader.querySelector('.reader-settings') as HTMLElement | null;
  if (pop) { pop.remove(); return; }
  pop = document.createElement('div'); pop.className = 'reader-settings';
  const row = (label: string) => { const r = document.createElement('div'); r.className = 'rs-row'; r.appendChild(Object.assign(document.createElement('span'), { className: 'rs-label', textContent: label })); pop!.appendChild(r); return r; };
  const seg = (r: HTMLElement, opts: [string, string][], get: () => string, set: (v: string) => void) => {
    opts.forEach(([v, t]) => { const b = document.createElement('button'); b.className = 'rs-theme' + (get() === v ? ' on' : ''); b.textContent = t; b.dataset.v = v; b.onclick = () => { set(v); r.querySelectorAll('.rs-theme').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.v === v)); }; r.appendChild(b); });
  };
  const selectCtl = (r: HTMLElement, opts: [string, string][], get: () => string, set: (v: string) => void) => {
    const s = document.createElement('select'); s.className = 'rs-select';
    for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; s.appendChild(o); }
    s.value = get(); s.onchange = () => set(s.value); r.appendChild(s);
  };
  const slider = (r: HTMLElement, min: number, max: number, step: number, val: number, on: (v: number) => void) => { const s = document.createElement('input'); s.type = 'range'; s.min = String(min); s.max = String(max); s.step = String(step); s.value = String(val); s.oninput = () => on(+s.value); r.appendChild(s); };
  if (!isWn) {
    seg(row('테마'), [['system', '자동'], ['light', '종이'], ['sepia', '세피아'], ['dark', '다크'], ['black', 'night']], () => rcfg.theme, (v) => { rcfg.theme = v; saveReaderCfg(rcfg); reader.dataset.theme = v; });
  }
  if (isWn) {
    seg(row('읽기 방식'), [['scroll', '세로 스크롤'], ['page', '페이지 넘김']], () => (wnPagedResolved(rcfg) ? 'page' : 'scroll'), (v) => { rcfg.wnPaged = (v === 'page'); saveReaderCfg(rcfg); rerender(); });
    const relay = () => { if (pager) pager.relayout(); };
    let widthRow: HTMLElement | null = null;
    let gapRow: HTMLElement | null = null;
    if (pager) {
      seg(row('보기'), [['2', '두 페이지'], ['1', '한 페이지']], () => String(rcfg.wnPageCols === 1 ? 1 : 2), (v) => { rcfg.wnPageCols = +v; saveReaderCfg(rcfg); if (gapRow) gapRow.style.display = (v === '1') ? 'none' : ''; pager.relayout(); });
      seg(row('분량'), [['auto', '자동 분할'], ['manual', '직접 조절']], () => (rcfg.wnPageAuto === false ? 'manual' : 'auto'), (v) => { rcfg.wnPageAuto = (v === 'auto'); saveReaderCfg(rcfg); if (widthRow) widthRow.style.display = (v === 'manual') ? '' : 'none'; pager.relayout(); });
      seg(row('넘김 효과'), [['none', '없음'], ['slide', '슬라이드']], () => (rcfg.wnPageAnim ? 'slide' : 'none'), (v) => { rcfg.wnPageAnim = (v === 'slide'); saveReaderCfg(rcfg); if (pager.setAnim) pager.setAnim(!!rcfg.wnPageAnim); });
      // 두 페이지 사이 간격(등마루) — 두 페이지 보기에만 의미. 즉시 반영 + 저장(재진입 유지).
      gapRow = row('간격'); slider(gapRow, 0, 60, 2, (rcfg.wnPageGap != null ? rcfg.wnPageGap : 28), (v) => { rcfg.wnPageGap = v; saveReaderCfg(rcfg); pager.relayout(); });
      if (rcfg.wnPageCols === 1) gapRow.style.display = 'none';
    }
    const fontOpts: [string, string][] = [['serif', '명조'], ['sans', '고딕'], ...getFontList().map((f) => [f.family, f.family] as [string, string])];
    selectCtl(row('글꼴'), fontOpts, () => rcfg.wnFont || 'serif', (v) => { rcfg.wnFont = v; saveReaderCfg(rcfg); reader.style.setProperty('--reader-font', wnFontFamily(v)); relay(); });
    slider(row('글자 크기'), 15, 26, 1, rcfg.wnSize, (v) => { rcfg.wnSize = v; saveReaderCfg(rcfg); reader.style.setProperty('--reader-size', v + 'px'); relay(); });
    slider(row('줄 간격'), 1.4, 2.3, 0.05, rcfg.wnLh, (v) => { rcfg.wnLh = v; saveReaderCfg(rcfg); reader.style.setProperty('--reader-lh', String(v)); relay(); });
    widthRow = row('폭'); slider(widthRow, 480, 900, 20, rcfg.wnWidth, (v) => { rcfg.wnWidth = v; saveReaderCfg(rcfg); if (pager) pager.relayout(); else if (col) col.style.maxWidth = v + 'px'; });
    if (pager && rcfg.wnPageAuto !== false) widthRow.style.display = 'none';
  } else {
    slider(row('폭'), 520, 1000, 20, rcfg.width, (v) => { rcfg.width = v; saveReaderCfg(rcfg); col!.style.maxWidth = v + 'px'; });
    slider(row('크기'), 0.8, 1.8, 0.1, rcfg.zoom, (v) => { rcfg.zoom = v; saveReaderCfg(rcfg); reader.querySelectorAll('.reader-card').forEach((c) => (c as HTMLElement).style.zoom = String(v)); });
  }
  reader.appendChild(pop);
  popAutoClose(pop, trigger);
}

// 리더 팝오버 자동 닫힘.
export function popAutoClose(pop: HTMLElement, trigger?: HTMLElement | null) {
  const onDown = (e: Event) => {
    if (!document.contains(pop)) { document.removeEventListener('mousedown', onDown, true); return; }
    const t = e.target as HTMLElement;
    if (!t || pop.contains(t)) return;
    if (trigger && trigger.contains(t)) return;
    pop.remove(); document.removeEventListener('mousedown', onDown, true);
  };
  setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
}

// 리더 본문(스크롤↔페이지넘김 분기). app에 append + 결과 반환. rerender = 읽기방식 토글 시 호출자 라우터.
// posKey = 화 안 읽던 위치 기억 키(페이지·스크롤 공통 비율). 없으면 기억 안 함.
// view = 'o'(원문 화면)|'t'(번역 화면) — 형광펜은 칠한 화면에서만 다시 칠함. 반환 root = 본문 요소(선택 팝오버 부착용), hl = 형광펜 컨트롤러(add/remove).
export function mountReaderBody(reader: HTMLElement, html: string, rcfg: any, wn: boolean, theme: string | undefined, setBtn: HTMLElement, rerender: () => void, papa?: boolean, posKey?: string, view?: string): { paged: boolean; scroll?: HTMLElement; col?: HTMLElement; root?: HTMLElement; hl?: { add: (range: Range, c: string) => string; remove: (id: string) => void } | null } {
  const paged = wn && wnPagedResolved(rcfg);   // papa는 통짜 디자인이라 항상 스크롤(페이저·웹소설 타이포 비적용)
  if (paged) {
    applyWnTypography(reader, null, rcfg, theme);
    reader.classList.toggle('bar-hidden', !!rcfg.immersive);
    const pager = buildWnPager(reader, html, rcfg, posKey);
    app().appendChild(reader);
    setBtn.onclick = () => toggleReaderSettings(reader, null, rcfg, wn, pager, setBtn, rerender);
    // 장 목차: 요소→페이지 환산(pageOf)으로 점프·현재 장 판정·"p.12" 표기. relayout 뒤 값이라 열 때마다 계산(캐시 X).
    attachToc(reader, pager.doc, (el) => pager.goTo(pager.pageOf(el)), (el) => pager.pageOf(el) <= pager.getPage(), (el) => 'p.' + (pager.pageOf(el) + 1));
    // 책갈피(페이지): 비율↔페이지 환산은 위치 기억과 같은 공식(floor(f*total)). 귀퉁이 버튼은 pager 우상단.
    let bm: { toggle: () => void; paint: () => void } | null = null;
    if (posKey) {
      const T = () => Math.max(1, pager.getTotal()); const pOf = (f: number) => Math.max(0, Math.min(T() - 1, Math.floor(f * T())));
      bm = attachBookmarks(reader, pager.stage.parentElement as HTMLElement, posKey, {
        curF: () => (pager.getPage() + 0.5) / T(), same: (f) => pOf(f) === pager.getPage(), jump: (f) => pager.goTo(pOf(f)), label: (f) => 'p.' + (pOf(f) + 1),
        snip: () => snipFrom(pager.doc, (el) => pager.pageOf(el) >= pager.getPage()) });
      pager.onPage(bm.paint);
    }
    bindBookmarkKey(reader, bm);
    // 형광펜(페이지): 점프=칠한 mark가 놓인 페이지. 공유 리더는 2단계 범위 밖(로컬 저장은 3단계).
    let hl: any = null;
    if (posKey && !posKey.startsWith('share:')) hl = attachHighlights(reader, pager.doc, posKey, view || 'o', { jump: (el) => pager.goTo(pager.pageOf(el)), label: (el) => 'p.' + (pager.pageOf(el) + 1), here: (el) => pager.pageOf(el) === pager.getPage() });
    return { paged: true, root: pager.doc, hl };
  }
  const scroll = mk('div', 'reader-scroll'); const col = mk('div', 'reader-col'); col.style.maxWidth = (wn ? rcfg.wnWidth : rcfg.width) + 'px';
  const card = mk('div', 'reader-card' + (papa ? ' reader-card-papa' : '')); if (!wn) card.style.zoom = String(rcfg.zoom);
  if (papa) renderPapaBlocks(card, html || '');   // ★남의 디자인은 (블록마다) Shadow DOM 격리(우리 셸·테마와 상호 비침투)
  else card.innerHTML = sanitizeArchiveHtml(html || '');
  col.appendChild(card); scroll.appendChild(col); reader.appendChild(scroll); app().appendChild(reader);
  if (wn) applyWnTypography(reader, col, rcfg, theme);
  setBtn.onclick = () => toggleReaderSettings(reader, col, rcfg, wn, undefined, setBtn, rerender);
  // ★몰입 탭 토글(일반·공유 리더 공용 — 드리프트 해소): 본문 탭 = 상단바 숨김/표시. summary/링크/버튼/입력 탭은 제외.
  //   열린 더보기 메뉴(.reader-actions.open)가 있으면 그것만 닫고 끝(단일화 리더용, 공유엔 없음=무해).
  let barHidden = (rcfg.immersive === undefined) ? isMobileLib() : !!rcfg.immersive;
  const applyImmersive = () => reader.classList.toggle('bar-hidden', barHidden);
  scroll.onclick = (e: Event) => {
    const t = e.target as HTMLElement | null;
    const openMenu = reader.querySelector('.reader-actions.open');
    if (openMenu) { openMenu.classList.remove('open'); return; }
    if (t && t.closest && t.closest('summary, a, button, input, label, select, textarea, mark.lp-hl')) return;
    barHidden = !barHidden; rcfg.immersive = barHidden; saveReaderCfg(rcfg); applyImmersive();
  };
  applyImmersive();
  scroll.scrollTop = 0;
  const yOf = (el: HTMLElement) => el.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;   // 요소의 스크롤러 내 y
  // 장 목차(세로 스크롤): 요소 y로 점프·현재 장 판정. 파파는 Shadow DOM 격리라 장 마커를 못 보므로 미적용(=버튼 없음). 일반 로그(챗버블 등)도 제외.
  if (wn && !papa) {   // 웹소설형만(일반 로그의 상태창 h2 등이 목차로 잡히지 않게)
    attachToc(reader, card, (el) => { scroll.scrollTop = Math.max(0, yOf(el) - 12); }, (el) => yOf(el) <= scroll.scrollTop + 8, () => '');
  }
  // 책갈피(세로 스크롤): 비율=scrollTop/max. 귀퉁이 버튼은 스크롤러 안 sticky 띠(높이 0)에 얹어 스크롤해도 우상단 고정. 파파도 됨(스니펫만 빈칸).
  let bm: { toggle: () => void; paint: () => void } | null = null;
  if (posKey) {
    const stick = mk('div', 'reader-bm-stick'); scroll.insertBefore(stick, col);
    const max = () => Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    const cur = () => (max() > 0 ? scroll.scrollTop / max() : 0);
    bm = attachBookmarks(reader, stick, posKey, {
      curF: cur, same: (f) => Math.abs(f - cur()) <= 0.02, jump: (f) => { scroll.scrollTop = Math.round(f * max()); }, label: (f) => Math.round(f * 100) + '%',
      snip: () => snipFrom(card, (el) => yOf(el) + el.offsetHeight > scroll.scrollTop + 4) });
    let pt: any = null;
    scroll.addEventListener('scroll', () => { if (pt) return; pt = requestAnimationFrame(() => { pt = null; bm && bm.paint(); }); }, { passive: true });
  }
  bindBookmarkKey(reader, bm);
  // 형광펜(세로 스크롤): 점프=mark의 y. 파파 제외(Shadow DOM — 선택 Range가 셸에서 안 보임 + "그대로 삼키기").
  let hl: any = null;
  if (posKey && !posKey.startsWith('share:') && !papa) {
    const maxY = () => Math.max(1, scroll.scrollHeight - scroll.clientHeight);
    hl = attachHighlights(reader, card, posKey, view || 'o', { jump: (el) => { scroll.scrollTop = Math.max(0, yOf(el) - 40); }, label: (el) => Math.round(Math.min(1, yOf(el) / maxY()) * 100) + '%', here: (el) => { const y = yOf(el); return y >= scroll.scrollTop && y < scroll.scrollTop + scroll.clientHeight; } });
  }
  if (posKey) {
    // 복원: 첫 프레임 + 300ms(이미지 늦은 로드로 높이 변할 때). 그 사이 사용자가 직접 스크롤했으면(우리가 놓은 값에서 벗어남) 두 번째 복원은 건너뜀.
    let setTo = -1;
    const restore = () => {
      const f = getReadPos(posKey); const max = scroll.scrollHeight - scroll.clientHeight;
      if (!(f > 0) || max <= 0) return;
      if (setTo >= 0 && Math.abs(scroll.scrollTop - setTo) > 2) return;
      setTo = Math.round(f * max); scroll.style.scrollBehavior = 'auto'; scroll.scrollTop = setTo; scroll.style.scrollBehavior = '';   // 복원은 즉시(.reader-scroll의 smooth 무시 — 애니메이션 중 "사용자 스크롤" 오판 방지)
    };
    requestAnimationFrame(() => { restore(); setTimeout(restore, 300); });
    let saveT: any = null;
    scroll.addEventListener('scroll', () => {
      if (saveT) return;
      saveT = setTimeout(() => { saveT = null; const max = scroll.scrollHeight - scroll.clientHeight; setReadPos(posKey, max > 0 ? scroll.scrollTop / max : 0); }, 250);
    }, { passive: true });
  }
  return { paged: false, scroll, col, root: card, hl };
}

// ── 공유 링크 열람(#/share, 비로그인 가능) ───────────────────────────────────
const loadShare = () => import('./share.js');
const SHARE_PROGRESS_KEY = 'pro2-share-progress';
function shareProgress(id: string): number { try { const o = JSON.parse(localStorage.getItem(SHARE_PROGRESS_KEY) || '{}'); const n = o && o[id]; return Number.isInteger(n) ? n : -1; } catch (_) { return -1; } }
function setShareProgress(id: string, n: number): void { try { const o = JSON.parse(localStorage.getItem(SHARE_PROGRESS_KEY) || '{}'); o[id] = n; localStorage.setItem(SHARE_PROGRESS_KEY, JSON.stringify(o)); } catch (_) {} }

function shareReaderView(o: { titleText: string; html: string; backLabel: string; onBack: () => void; prevHash?: string | null; nextHash?: string | null; rerender: () => void; papa?: boolean; posKey?: string }) {
  const rcfg = rdCfg();
  const papa = !!o.papa;
  const wn = !papa && isWebnovel({ html: o.html });
  app().innerHTML = '';
  const reader = mk('div', 'reader' + (wn ? ' wn' : '')); reader.dataset.theme = wn ? rcfg.wnTheme : rcfg.theme;
  const bar = mk('div', 'reader-bar');
  const back = mk('button', 'reader-back', o.backLabel); back.onclick = o.onBack;
  const rtitle = mk('div', 'reader-title', o.titleText); rtitle.style.flex = '1';
  bar.append(back, rtitle);
  if (o.prevHash !== undefined) { const p = mk('button', 'reader-iconbtn', '‹ 이전화') as HTMLButtonElement; p.disabled = !o.prevHash; p.onclick = () => { if (o.prevHash) location.hash = o.prevHash; }; bar.append(p); }
  if (o.nextHash !== undefined) { const n = mk('button', 'reader-iconbtn', '다음화 ›') as HTMLButtonElement; n.disabled = !o.nextHash; n.onclick = () => { if (o.nextHash) location.hash = o.nextHash; }; bar.append(n); }
  const setBtn = mk('button', 'reader-iconbtn') as HTMLButtonElement; setBtn.innerHTML = icon('sliders') + ' 보기';
  const mine = mk('button', 'reader-iconbtn'); mine.innerHTML = icon('pencil') + ' 나도 만들기'; mine.onclick = () => { location.href = 'index.html'; };
  bar.append(setBtn, mine); reader.appendChild(bar);
  mountReaderBody(reader, o.html, rcfg, wn, wn ? rcfg.wnTheme : undefined, setBtn, o.rerender, papa, o.posKey);
}
function shareLoading() {
  app().innerHTML = '';
  const reader = mk('div', 'reader'); reader.dataset.theme = rdCfg().theme;
  const scroll = mk('div', 'reader-scroll'); const col = mk('div', 'reader-col');
  col.appendChild(mk('div', 'reader-card', '불러오는 중…')); scroll.appendChild(col); reader.appendChild(scroll); app().appendChild(reader);
}
function shareNotFound() {
  app().innerHTML = '';
  const reader = mk('div', 'reader'); reader.dataset.theme = rdCfg().theme;
  const bar = mk('div', 'reader-bar'); const back = mk('button', 'reader-back', '← 서재'); back.onclick = () => { location.href = 'library.html'; };
  bar.append(back, mk('div', 'reader-title', '공유 없음')); reader.appendChild(bar);
  const scroll = mk('div', 'reader-scroll'); const col = mk('div', 'reader-col');
  col.appendChild(mk('div', 'reader-card', '공유를 찾을 수 없습니다. (삭제되었거나 잘못된 링크예요.)')); scroll.appendChild(col); reader.appendChild(scroll); app().appendChild(reader);
}
// 공유 문서의 작품 표시이름 — 새 공유=charName(또는 이름이 담긴 char). ★옛 공유는 char에 내부 키(wk_…)가 박혀 있어 절대 노출 안 함.
const WK_KEY_RE = /^wk_[a-z0-9]+$/i;
function shareWorkName(d: any): string {
  const n = d && d.charName ? String(d.charName).trim() : '';
  if (n && !WK_KEY_RE.test(n)) return n;
  const c = d && d.char ? String(d.char).trim() : '';
  return (c && !WK_KEY_RE.test(c)) ? c : '';
}
// 옛 공유는 title에도 키가 들어가 있을 수 있어(작품 통째 공유) 키면 버린다.
function shareTitleSafe(d: any): string {
  const t = d && d.title ? String(d.title).trim() : '';
  return (t && !WK_KEY_RE.test(t)) ? t : '';
}

// #/share/:id — 단일 화면 또는 작품(시리즈) 인덱스. rerender = 이 라우트 다시 그리기(읽기방식 토글용).
export async function renderShare(id: string, rerender: () => void) {
  shareLoading();
  let data: any = null;
  try { const S = await loadShare(); data = await S.getShare(id); } catch (_) {}
  if (!data) { shareNotFound(); return; }
  if (data.type === 'series') { renderSharedSeries(id, data); return; }
  const cn = shareWorkName(data);
  shareReaderView({ titleText: (data.title || '공유된 로그') + (cn ? ' · ' + cn : ''), html: data.html || '', backLabel: '← 서재', onBack: () => { location.href = 'library.html'; }, rerender, papa: data.template === 'papa', posKey: 'share:' + id });
}
function renderSharedSeries(id: string, data: any) {
  const eps: any[] = data.eps || [];
  const readIdx = shareProgress(id);
  const workName = shareWorkName(data) || shareTitleSafe(data) || '공유된 작품';   // ★코드(wk_…) 대신 항상 사람이 읽는 이름(옛 공유도 키는 버림)
  app().innerHTML = '';
  const wrap = mk('div', 'series');
  const bar = mk('div', 'reader-bar');
  const back = mk('button', 'reader-back', '← 서재'); back.onclick = () => { location.href = 'library.html'; };
  bar.append(back, mk('div', 'reader-title', workName));
  const mine = mk('button', 'reader-iconbtn'); mine.innerHTML = icon('pencil') + ' 나도 만들기'; mine.onclick = () => { location.href = 'index.html'; };
  bar.append(mine); wrap.appendChild(bar);
  const scroll = mk('div', 'series-scroll');
  const hero = mk('div', 'series-hero');
  const cover = mk('div', 'series-cover');
  if (data.cover) { const im = document.createElement('img'); im.src = data.cover; cover.appendChild(im); }
  else cover.textContent = (workName === '공유된 작품' ? '?' : workName).slice(0, 2);
  const info = mk('div', 'series-info');
  info.append(mk('h1', 'series-name', workName));
  info.append(mk('div', 'series-meta', `총 ${eps.length}화` + (data.date ? ` · ${data.date}` : '')));
  if (data.desc) info.append(mk('div', 'series-intro', String(data.desc)));
  const actions = mk('div', 'series-actions');
  const readB = mk('button', 'series-read primary') as HTMLButtonElement;
  if (readIdx >= 0 && readIdx < eps.length) {
    readB.textContent = `이어 읽기 · ${readIdx + 1}화`;
    readB.onclick = () => { location.hash = '#/share/' + encodeURIComponent(id) + '/' + readIdx; };
    const fromStart = mk('button', 'series-read', '처음부터') as HTMLButtonElement;
    fromStart.onclick = () => { location.hash = '#/share/' + encodeURIComponent(id) + '/0'; };
    actions.append(readB, fromStart);
  } else {
    readB.textContent = '읽기';
    readB.onclick = () => { location.hash = '#/share/' + encodeURIComponent(id) + '/0'; };
    actions.append(readB);
  }
  info.append(actions);
  hero.append(cover, info); scroll.appendChild(hero);
  scroll.appendChild(mk('h2', 'home-h series-list-title', `화 목록 (${eps.length})`));
  const list = mk('div', 'series-eps');
  eps.forEach((e: any, i: number) => {
    const ep = mk('div', 'series-ep' + (i <= readIdx ? ' read' : '') + (i === readIdx ? ' current' : ''));
    const no = mk('button', 'se-no se-open', String(i + 1)); no.onclick = (ev: Event) => { ev.stopPropagation(); location.hash = '#/share/' + encodeURIComponent(id) + '/' + i; };
    const t = mk('span', 'se-title', e.title || `${i + 1}화`);
    const dt = mk('span', 'se-date', e.date || '');
    const dot = mk('span', 'se-dot');
    ep.append(no, t, dt, dot); ep.onclick = () => { location.hash = '#/share/' + encodeURIComponent(id) + '/' + i; };
    list.appendChild(ep);
  });
  scroll.appendChild(list); wrap.appendChild(scroll); app().appendChild(wrap);
  autoHideBar(scroll, [document.querySelector('.lib-topbar'), bar]);
}
// #/share/:id/:n — 공유 작품의 n번째 화.
export async function renderSharedSeriesEp(id: string, n: number, rerender: () => void) {
  shareLoading();
  let series: any = null;
  try { const S = await loadShare(); series = await S.getShare(id); } catch (_) {}
  if (!series || series.type !== 'series' || !Array.isArray(series.eps) || !series.eps[n]) { location.hash = '#/share/' + encodeURIComponent(id); return; }
  let ep: any = null;
  try { const S = await loadShare(); ep = await S.getShare(series.eps[n].sid); } catch (_) {}
  if (!ep) { shareNotFound(); return; }
  setShareProgress(id, n);
  const eps = series.eps;
  shareReaderView({
    titleText: `${n + 1}화 · ${ep.title || shareWorkName(series) || shareTitleSafe(series) || ''}`,
    html: ep.html || '',
    backLabel: '← 목록', onBack: () => { location.hash = '#/share/' + encodeURIComponent(id); },
    prevHash: n > 0 ? '#/share/' + encodeURIComponent(id) + '/' + (n - 1) : null,
    nextHash: n < eps.length - 1 ? '#/share/' + encodeURIComponent(id) + '/' + (n + 1) : null,
    rerender, papa: ep.template === 'papa', posKey: 'share:' + id + ':' + n,
  });
}
