// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/readerView.ts — 리더 공용 렌더링 툴킷(library.ts·reader.ts 공유). ★중복 복붙 금지(1차에서 공용화한 것 이전).
//
// 담는 것: 살균·리더 본문(스크롤↔페이지넘김 분기)·페이저·타이포·리더 설정 팝오버·모바일 헤더 자동숨김
//          + 공유 링크 열람(#/share, 비로그인 가능 — share.ts getShare만 씀).
// route() 의존(읽기방식 토글의 재렌더)은 rerender 콜백으로 분리 → 페이지(library/reader)별 라우터 주입.
// @ts-nocheck
import { loadReaderCfg, saveReaderCfg } from './store.js';
import { getFontList } from './fonts.js';
import { icon } from './icons.js';

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

// 웹소설형 좌우 페이지 넘김(전자책식, 반응형+스와이프).
function buildWnPager(reader: HTMLElement, html: string, rcfg: any): { relayout: () => void; stage: HTMLElement; setAnim: (on: boolean) => void } {
  const pager = mk('div', 'reader-pager');
  const stage = mk('div', 'reader-pager-stage');
  const doc = mk('div', 'reader-card reader-pager-doc'); doc.innerHTML = sanitizeArchiveHtml(html);
  doc.classList.toggle('anim', !!rcfg.wnPageAnim);
  stage.appendChild(doc); pager.appendChild(stage);
  const prev = mk('button', 'reader-page-arrow prev', '‹'); prev.setAttribute('aria-label', '이전 페이지');
  const next = mk('button', 'reader-page-arrow next', '›'); next.setAttribute('aria-label', '다음 페이지');
  const ind = mk('div', 'reader-page-ind', '');
  pager.append(prev, next, ind); reader.appendChild(pager);
  let page = 0, total = 1, screenStep = 1;
  const apply = () => { doc.style.transform = `translateX(${-page * screenStep}px)`; ind.textContent = `${page + 1} / ${total}`; (prev as HTMLButtonElement).disabled = page <= 0; (next as HTMLButtonElement).disabled = page >= total - 1; };
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
    const colStep = colW + GAP;
    const totalCols = Math.max(1, Math.round((doc.scrollWidth + GAP) / colStep));
    total = Math.max(1, Math.ceil(totalCols / cols));
    screenStep = cols * colStep;
    if (page > total - 1) page = total - 1;
    apply();
  };
  const go = (d: number) => { const np = Math.max(0, Math.min(total - 1, page + d)); if (np !== page) { page = np; apply(); } };
  const toggleBar = () => { const h = !reader.classList.contains('bar-hidden'); reader.classList.toggle('bar-hidden', h); rcfg.immersive = h; saveReaderCfg(rcfg); requestAnimationFrame(relayout); };
  prev.onclick = (e) => { e.stopPropagation(); go(-1); };
  next.onclick = (e) => { e.stopPropagation(); go(1); };
  let swiped = false;
  stage.onclick = (e: MouseEvent) => {
    if (swiped) { swiped = false; return; }
    const t = e.target as HTMLElement; if (t && t.closest && t.closest('a,button,summary')) return;
    const r = stage.getBoundingClientRect(); const x = e.clientX - r.left, third = r.width / 3;
    if (x < third) go(-1); else if (x > 2 * third) go(1); else toggleBar();
  };
  let tsx = 0, tsy = 0;
  stage.addEventListener('touchstart', (e: TouchEvent) => { const t = e.touches[0]; if (t) { tsx = t.clientX; tsy = t.clientY; } }, { passive: true });
  stage.addEventListener('touchend', (e: TouchEvent) => {
    const t = e.changedTouches[0]; if (!t) return;
    const dx = t.clientX - tsx, dy = t.clientY - tsy;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) { swiped = true; if (dx < 0) go(1); else go(-1); try { e.preventDefault(); } catch (_) {} }
  }, { passive: false });
  const onKey = (e: KeyboardEvent) => {
    const a = document.activeElement as HTMLElement | null;
    if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { go(1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { go(-1); e.preventDefault(); }
  };
  document.addEventListener('keydown', onKey);
  let ro: any = null; try { ro = new ResizeObserver(() => relayout()); ro.observe(pager); } catch (_) {}
  const onResize = () => relayout();
  window.addEventListener('resize', onResize);
  const cleanup = () => { document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); try { ro && ro.disconnect(); } catch (_) {} window.removeEventListener('hashchange', cleanup); };
  window.addEventListener('hashchange', cleanup);
  requestAnimationFrame(() => { relayout(); setTimeout(relayout, 300); });
  return { relayout, stage, setAnim: (on: boolean) => doc.classList.toggle('anim', on) };
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
export function mountReaderBody(reader: HTMLElement, html: string, rcfg: any, wn: boolean, theme: string | undefined, setBtn: HTMLElement, rerender: () => void): { paged: boolean; scroll?: HTMLElement; col?: HTMLElement } {
  const paged = wn && wnPagedResolved(rcfg);
  if (paged) {
    applyWnTypography(reader, null, rcfg, theme);
    reader.classList.toggle('bar-hidden', !!rcfg.immersive);
    const pager = buildWnPager(reader, html, rcfg);
    app().appendChild(reader);
    setBtn.onclick = () => toggleReaderSettings(reader, null, rcfg, wn, pager, setBtn, rerender);
    return { paged: true };
  }
  const scroll = mk('div', 'reader-scroll'); const col = mk('div', 'reader-col'); col.style.maxWidth = (wn ? rcfg.wnWidth : rcfg.width) + 'px';
  const card = mk('div', 'reader-card'); if (!wn) card.style.zoom = String(rcfg.zoom); card.innerHTML = sanitizeArchiveHtml(html || '');
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
    if (t && t.closest && t.closest('summary, a, button, input, label, select, textarea')) return;
    barHidden = !barHidden; rcfg.immersive = barHidden; saveReaderCfg(rcfg); applyImmersive();
  };
  applyImmersive();
  scroll.scrollTop = 0;
  return { paged: false, scroll, col };
}

// ── 공유 링크 열람(#/share, 비로그인 가능) ───────────────────────────────────
const loadShare = () => import('./share.js');
const SHARE_PROGRESS_KEY = 'pro2-share-progress';
function shareProgress(id: string): number { try { const o = JSON.parse(localStorage.getItem(SHARE_PROGRESS_KEY) || '{}'); const n = o && o[id]; return Number.isInteger(n) ? n : -1; } catch (_) { return -1; } }
function setShareProgress(id: string, n: number): void { try { const o = JSON.parse(localStorage.getItem(SHARE_PROGRESS_KEY) || '{}'); o[id] = n; localStorage.setItem(SHARE_PROGRESS_KEY, JSON.stringify(o)); } catch (_) {} }

function shareReaderView(o: { titleText: string; html: string; backLabel: string; onBack: () => void; prevHash?: string | null; nextHash?: string | null; rerender: () => void }) {
  const rcfg = rdCfg();
  const wn = isWebnovel({ html: o.html });
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
  mountReaderBody(reader, o.html, rcfg, wn, wn ? rcfg.wnTheme : undefined, setBtn, o.rerender);
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
// #/share/:id — 단일 화면 또는 작품(시리즈) 인덱스. rerender = 이 라우트 다시 그리기(읽기방식 토글용).
export async function renderShare(id: string, rerender: () => void) {
  shareLoading();
  let data: any = null;
  try { const S = await loadShare(); data = await S.getShare(id); } catch (_) {}
  if (!data) { shareNotFound(); return; }
  if (data.type === 'series') { renderSharedSeries(id, data); return; }
  shareReaderView({ titleText: (data.title || '공유된 로그') + (data.char ? ' · ' + data.char : ''), html: data.html || '', backLabel: '← 서재', onBack: () => { location.href = 'library.html'; }, rerender });
}
function renderSharedSeries(id: string, data: any) {
  const eps: any[] = data.eps || [];
  const readIdx = shareProgress(id);
  app().innerHTML = '';
  const wrap = mk('div', 'series');
  const bar = mk('div', 'reader-bar');
  const back = mk('button', 'reader-back', '← 서재'); back.onclick = () => { location.href = 'library.html'; };
  bar.append(back, mk('div', 'reader-title', (data.title || data.char || '공유된 작품')));
  const mine = mk('button', 'reader-iconbtn'); mine.innerHTML = icon('pencil') + ' 나도 만들기'; mine.onclick = () => { location.href = 'index.html'; };
  bar.append(mine); wrap.appendChild(bar);
  const scroll = mk('div', 'series-scroll');
  const hero = mk('div', 'series-hero');
  const cover = mk('div', 'series-cover');
  if (data.cover) { const im = document.createElement('img'); im.src = data.cover; cover.appendChild(im); }
  else cover.textContent = String(data.char || data.title || '?').slice(0, 2);
  const info = mk('div', 'series-info');
  info.append(mk('h1', 'series-name', String(data.char || data.title || '공유된 작품')));
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
    titleText: `${n + 1}화 · ${ep.title || series.title || ''}`,
    html: ep.html || '',
    backLabel: '← 목록', onBack: () => { location.hash = '#/share/' + encodeURIComponent(id); },
    prevHash: n > 0 ? '#/share/' + encodeURIComponent(id) + '/' + (n - 1) : null,
    nextHash: n < eps.length - 1 ? '#/share/' + encodeURIComponent(id) + '/' + (n + 1) : null,
    rerender,
  });
}
