// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — 에셋추출기(Asset Extractor). Licensed under GNU GPL v3 (see LICENSE).
// 에셋추출기 렌더러 — 독립 단일 화면(에스프레소 브랜딩: 카드를 놓으면 에셋을 곱게 내린다).
//   파서는 본체 core/card를 그대로 번들(새 디코더 0): 전 포맷 지연 인덱스 → 누른 에셋만 복호.
//   무상태 도구: 보관·규칙·동기화 없음. 열고 → 탐색(검색·탭·호버확대) → 꺼내고(개별/전체 zip·변환) 끝.
// @ts-nocheck
import { parseCardAssets, cardAssetBytes } from '../../../core/card/cardAssets.js';
import { applyTagScheme, assetDataUrl } from '../../../core/card/assets.js';
import { encodeJson, encodeCharx, encodePng, pickPngBase } from '../../../core/card/cardEncode.js';
import { zipSync } from 'fflate';

const app = document.getElementById('app');
const ACCEPT = '.charx,.png,.json,.jpeg,.risum,.risup';

// 브랜드 아이콘(build/icon.svg와 동일 도형) — 상단바·드롭존에 인라인 렌더.
const ICON = (s: number) => `<svg width="${s}" height="${s}" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">`
  + `<defs><linearGradient id="axg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f9f1e0"/><stop offset="1" stop-color="#e9d3ae"/></linearGradient></defs>`
  + `<rect width="128" height="128" rx="28" fill="url(#axg)" stroke="#e2cda4" stroke-width="3"/>`
  + `<rect x="30" y="42" width="58" height="12" rx="6" fill="#4a2c1a"/><rect x="86" y="44" width="26" height="8" rx="4" fill="#4a2c1a"/>`
  + `<path d="M40,54 L78,54 L71,70 L47,70 Z" fill="#4a2c1a"/>`
  + `<path d="M59,78 q-6,9 0 14 q6,-5 0,-14" fill="#6b4226"/><path d="M59,97 q-5,8 0 12 q5,-4 0,-12" fill="#b07d3f"/></svg>`;

// ── 세션 상태(저장 없음 — 창 닫으면 끝) ──────────────────────────────────────
// chips: 이번 세션에 연 파일들. File 핸들만 들고 있다가 선택 시 다시 읽음 → 큰 모듈 여러 개도 메모리엔 현재 1개만.
let chips: any[] = [];        // {id, name, size, read: () => Promise<Uint8Array>}
let currentId: string | null = null;
let parsed: any = null;       // parseCardAssets 결과(지연 인덱스, _bytes 보관)
let parseError = '';
let trayAssets: any[] = [];
let trayFilter: 'all' | 'icon' | 'emotion' = 'all';
let trayQuery = '';
let trayPage = 0;
const TRAY_PAGE = 60;

let chipsEl: HTMLElement, bodyEl: HTMLElement, statusEl: HTMLElement | null = null;
const setStatus = (m: string) => { if (statusEl) statusEl.textContent = m || ''; };

// ── 공용 유틸(관리실 포팅) ──────────────────────────────────────────────────
const safeName = (s: string) => String(s || 'source').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
const assetFilename = (a: any) => { const n = safeName(a.name || 'asset'); const e = (a.ext || '').toLowerCase(); return (e && !n.toLowerCase().endsWith('.' + e)) ? n + '.' + e : n; };
const fmtKB = (n: number) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');
const typeOf = (fmt: string) => { const f = String(fmt || '').toLowerCase(); return f === 'risup' ? 'prompt' : f === 'risum' ? 'module' : 'card'; };
const TYPE_LABEL: any = { prompt: '프롬프트', card: '봇카드', module: '모듈' };
const isIconAsset = (a: any) => a.type === 'icon' || /icon/i.test(a.name || '');
const isImage = (a: any) => /^image\//.test(a.mime || '');

function downloadBytes(bytes: Uint8Array, filename: string, mime: string) {
  try { const blob = new Blob([bytes], { type: mime || 'application/octet-stream' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); } catch (_) {}
}

// 에셋 바이트/데이터URL — 지연 복호(cardAssetBytes가 포맷별 on-demand + 캐시).
const bytesOf = (a: any) => { try { return cardAssetBytes(parsed, a); } catch (_) { return null; } };
const urlOf = (a: any) => { bytesOf(a); return assetDataUrl(a) || ''; };

// 태그 복사: 리스AI 계열 도구들이 그대로 알아듣는 기본 이미지 토큰.
async function copyTag(name: string) {
  const text = `{{img::${name}}}`;
  try { await navigator.clipboard.writeText(text); }
  catch (_) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (_) {} ta.remove(); }
  toast(`태그 복사됨 — ${text}`);
}

// ── 토스트 ──────────────────────────────────────────────────────────────────
let toastEl: HTMLElement | null = null, toastTimer: any = null;
function toast(msg: string) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
  toastEl.textContent = msg; toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl && toastEl.classList.remove('show'), 1800);
}

// ── 파일 열기(드롭·선택·연결 프로그램) ──────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function addFiles(files: File[]) {
  let lastId = null;
  for (const f of files) {
    const id = uid();
    chips.push({ id, name: f.name, size: f.size, read: () => f.arrayBuffer().then((b) => new Uint8Array(b)) });
    lastId = id;
  }
  if (lastId) selectChip(lastId); else renderChips();
}
function addBytesFile(name: string, bytes: Uint8Array) {   // 메인 프로세스(argv)에서 온 파일
  const id = uid();
  chips.push({ id, name, size: bytes.length, read: () => Promise.resolve(bytes) });
  selectChip(id);
}
function removeChip(id: string) {
  chips = chips.filter((c) => c.id !== id);
  if (currentId === id) { currentId = null; parsed = null; trayAssets = []; parseError = ''; if (chips.length) { selectChip(chips[chips.length - 1].id); return; } }
  renderChips(); renderBody();
}

async function selectChip(id: string) {
  const chip = chips.find((c) => c.id === id); if (!chip) return;
  currentId = id; parsed = null; trayAssets = []; parseError = '';
  trayFilter = 'all'; trayQuery = ''; trayPage = 0;
  renderChips(); renderBody();   // "읽는 중" 상태 먼저
  setStatus('읽는 중…'); await new Promise((r) => setTimeout(r, 16));   // 큰 파일도 UI 먼저 그림
  try {
    const bytes = await chip.read();
    const p = parseCardAssets(bytes, chip.name);
    if (Array.isArray(p.assets) && p.assets.length) applyTagScheme(p);
    parsed = p;
    trayAssets = (p.assets || []).filter((a: any) => a && a.found !== false);
  } catch (e) {
    console.warn('[에셋추출기] 파싱 실패', chip.name, e);
    parseError = typeOf((chip.name.split('.').pop() || '')) === 'prompt'
      ? '프리셋(.risup)에는 보통 에셋이 없어요 — 봇카드(.charx/.png/.json)나 모듈(.risum)을 열어주세요.'
      : '이 파일에서 에셋을 읽지 못했어요 — 지원 포맷(.charx · .png · .json · .jpeg · .risum)인지 확인해주세요.';
  }
  renderBody();
}

// ── 상단 칩(세션 파일 전환) ─────────────────────────────────────────────────
function renderChips() {
  if (!chipsEl) return; chipsEl.innerHTML = '';
  for (const c of chips) {
    const el = document.createElement('button'); el.className = 'chip' + (c.id === currentId ? ' active' : ''); el.title = c.name;
    el.appendChild(Object.assign(document.createElement('span'), { className: 'nm', textContent: c.name }));
    const x = Object.assign(document.createElement('button'), { className: 'x', textContent: '✕', title: '닫기' });
    x.onclick = (ev) => { ev.stopPropagation(); removeChip(c.id); };
    el.appendChild(x);
    el.onclick = () => { if (c.id !== currentId) selectChip(c.id); };
    chipsEl.appendChild(el);
  }
}

// ── 빈 상태(드롭존) ─────────────────────────────────────────────────────────
function buildEmpty(): HTMLElement {
  const wrap = document.createElement('div'); wrap.className = 'empty';
  const dz = document.createElement('div'); dz.className = 'dropzone';
  dz.innerHTML = '<div class="big">' + ICON(64) + '</div><div class="tit">봇카드·모듈을 놓으면 곱게 내려드려요</div>'
    + '<div>.charx · .png · .json · .jpeg · .risum 안의 에셋을 추출해요<br>클릭해서 파일을 고를 수도 있어요</div>';
  dz.onclick = () => pickFiles();
  wrap.appendChild(dz);
  return wrap;
}
function pickFiles() {
  const fin = document.createElement('input'); fin.type = 'file'; fin.accept = ACCEPT; fin.multiple = true;
  fin.onchange = () => { const fs = Array.from(fin.files || []); if (fs.length) addFiles(fs); };
  fin.click();
}

// ── 전체 내려받기(zip) — 관리실 downloadAll 포팅(파일명 충돌 _2 처리 포함) ──
async function downloadAll() {
  if (!parsed || !trayAssets.length) return;
  setStatus('압축 중… (큰 모듈은 시간이 걸려요)'); await new Promise((r) => setTimeout(r, 16));
  try {
    const files: Record<string, Uint8Array> = {}; const used: Record<string, number> = {}; let n = 0;
    for (const a of trayAssets) {
      const by = bytesOf(a); if (!by) continue;
      let fn = assetFilename(a);
      if (used[fn]) { const m = /^(.*?)(\.[^.]+)?$/.exec(fn) || [fn, fn, '']; let i = 2, cand; do { cand = m[1] + '_' + (i++) + (m[2] || ''); } while (used[cand]); fn = cand; }
      used[fn] = 1; files[fn] = by; n++;
    }
    if (!n) { setStatus('내려받을 에셋이 없어요.'); return; }
    downloadBytes(zipSync(files, { level: 0 }), safeName(parsed.name || currentName()) + '_assets.zip', 'application/zip');
    setStatus(`에셋 ${n}개 추출 완료 (zip)`);
  } catch (e) { console.warn('[에셋추출기] 전체 내려받기 실패', e); setStatus('전체 내려받기 실패 — 개별 내려받기를 써보세요.'); }
}
const currentName = () => { const c = chips.find((x) => x.id === currentId); return (c ? c.name : 'source').replace(/\.[^.]+$/, ''); };

// ── 본문 ────────────────────────────────────────────────────────────────────
function renderBody() {
  if (!bodyEl) return; bodyEl.innerHTML = ''; statusEl = null;
  if (!currentId) { bodyEl.appendChild(buildEmpty()); return; }

  const main = document.createElement('div'); main.className = 'main'; bodyEl.appendChild(main);
  const chip = chips.find((c) => c.id === currentId);

  // 정보줄
  const info = document.createElement('div'); info.className = 'infobar';
  info.appendChild(Object.assign(document.createElement('span'), { className: 'name', textContent: (parsed && parsed.name) || currentName() }));
  if (parsed) {
    info.appendChild(Object.assign(document.createElement('span'), { className: 'badge', textContent: String(parsed.format || '?').toUpperCase() }));
    const imgs = trayAssets.filter(isImage).length;
    info.appendChild(Object.assign(document.createElement('span'), { className: 'meta', textContent: `${TYPE_LABEL[typeOf(parsed.format)] || '소스'} · ${fmtKB(chip ? chip.size : 0)} · 에셋 ${trayAssets.length}개(이미지 ${imgs})` }));
  }
  main.appendChild(info);

  // 동작줄
  const acts = document.createElement('div'); acts.className = 'actions';
  const allB = Object.assign(document.createElement('button'), { className: 'primary', textContent: '전부 내리기 (zip)' });
  allB.disabled = !parsed || !trayAssets.length; allB.onclick = () => downloadAll();
  acts.appendChild(allB);
  const openB = Object.assign(document.createElement('button'), { textContent: '파일 추가' }); openB.onclick = () => pickFiles();
  acts.appendChild(openB);
  // 봇카드만 포맷 변환(관리실 포팅) — risum(모듈)·risup(프롬프트) 제외.
  if (parsed && typeOf(parsed.format) === 'card') {
    acts.appendChild(Object.assign(document.createElement('span'), { className: 'sep', textContent: '변환:' }));
    const gb = (a: any) => bytesOf(a);
    const convBtn = (label: string, make: () => Uint8Array | null, fname: string, mime: string) => {
      const b = Object.assign(document.createElement('button'), { textContent: label }) as HTMLButtonElement;
      b.onclick = () => { try { const out = make(); if (out) { downloadBytes(out, fname, mime); setStatus(`${label} 변환 내려받기`); } } catch (e: any) { setStatus('변환 실패: ' + ((e && e.message) || '')); } };
      return b;
    };
    const base = safeName((parsed && parsed.name) || currentName());
    acts.appendChild(convBtn('JSON', () => encodeJson(parsed, gb), base + '.json', 'application/json'));
    acts.appendChild(convBtn('CharX', () => encodeCharx(parsed, gb), base + '.charx', 'application/zip'));
    acts.appendChild(convBtn('PNG', () => { const pb = pickPngBase(parsed, gb); if (!pb) { setStatus('PNG 변환 불가 — 카드에 PNG 이미지가 없어요.'); return null; } return encodePng(parsed, pb, gb); }, base + '.png', 'image/png'));
  }
  main.appendChild(acts);

  statusEl = Object.assign(document.createElement('div'), { className: 'status' }); main.appendChild(statusEl);

  if (!parsed) { setStatus(parseError || '읽는 중…'); return; }
  if (!trayAssets.length) { setStatus('이 파일엔 꺼낼 에셋이 없어요.'); return; }
  main.appendChild(buildTray());
}

// ── 트레이(편집기 에셋트레이 포팅: 검색 + 아이콘/감정 탭 + 60개 페이지) ─────
function buildTray(): HTMLElement {
  const tray = document.createElement('div'); tray.className = 'tray';
  const top = document.createElement('div'); top.className = 'tray-top';
  const search = document.createElement('input'); search.type = 'search'; search.className = 'tray-search';
  search.placeholder = `에셋 검색 (${trayAssets.length}개)`; search.value = trayQuery;
  search.oninput = () => { trayQuery = search.value; trayPage = 0; renderTrayGrid(); };
  top.appendChild(search);
  // 타입별 탭(아이콘/감정) — 두 종류가 다 있을 때만 노출(아니면 무의미)
  const iconN = trayAssets.filter(isIconAsset).length;
  const emoN = trayAssets.length - iconN;
  if (iconN > 0 && emoN > 0) {
    const tabs = document.createElement('div'); tabs.className = 'tray-tabs';
    const defs: Array<[typeof trayFilter, string, number]> = [['all', '전체', trayAssets.length], ['icon', '아이콘', iconN], ['emotion', '감정', emoN]];
    for (const [key, label, count] of defs) {
      const b = document.createElement('button'); b.className = 'tray-tab' + (key === trayFilter ? ' active' : '');
      b.textContent = `${label} ${count}`; (b as any).dataset.key = key;
      b.onclick = () => { trayFilter = key; trayPage = 0; tabs.querySelectorAll('.tray-tab').forEach((el) => el.classList.toggle('active', (el as HTMLElement).dataset.key === key)); renderTrayGrid(); };
      tabs.appendChild(b);
    }
    top.appendChild(tabs);
  }
  tray.appendChild(top);
  const grid = document.createElement('div'); grid.className = 'tray-grid'; grid.id = 'tray-grid'; tray.appendChild(grid);
  const nav = document.createElement('div'); nav.className = 'tray-nav'; nav.id = 'tray-nav';
  nav.innerHTML = '<button class="tray-pg" data-d="-1">‹ 이전</button><span class="tray-pos"></span><button class="tray-pg" data-d="1">다음 ›</button>';
  nav.querySelectorAll('.tray-pg').forEach((b) => (b as HTMLButtonElement).onclick = () => { trayPage += Number((b as HTMLElement).dataset.d); renderTrayGrid(); });
  tray.appendChild(nav);
  renderTrayGrid();
  return tray;
}

function renderTrayGrid() {
  const grid = document.getElementById('tray-grid'); if (!grid) return; grid.innerHTML = '';
  const ql = trayQuery.trim().toLowerCase();
  const inFilter = (a: any) => trayFilter === 'all' || (trayFilter === 'icon' ? isIconAsset(a) : !isIconAsset(a));
  const matches = trayAssets.filter((a) => inFilter(a) && (!ql || (a.name && a.name.toLowerCase().includes(ql)) || (a.tag && a.tag.toLowerCase().includes(ql))));
  const total = matches.length;
  const pages = Math.max(1, Math.ceil(total / TRAY_PAGE));
  if (trayPage < 0) trayPage = 0; if (trayPage > pages - 1) trayPage = pages - 1;
  const start = trayPage * TRAY_PAGE;
  for (const a of matches.slice(start, start + TRAY_PAGE)) grid.appendChild(trayCell(a));
  if (!total) { const m = document.createElement('div'); m.className = 'tray-note'; m.textContent = '일치하는 에셋 없음'; grid.appendChild(m); }
  grid.scrollTop = 0;
  const nav = document.getElementById('tray-nav'); if (!nav) return;
  (nav as HTMLElement).hidden = pages <= 1;
  const pos = nav.querySelector('.tray-pos'); if (pos) pos.textContent = total ? `${trayPage + 1} / ${pages}  ·  ${start + 1}–${Math.min(start + TRAY_PAGE, total)} / ${total}` : '0';
  const btns = nav.querySelectorAll('.tray-pg');
  (btns[0] as HTMLButtonElement).disabled = trayPage <= 0;
  (btns[1] as HTMLButtonElement).disabled = trayPage >= pages - 1;
}

// 셀: 이미지=보일 때만 복호(IntersectionObserver, 큰 모듈 안전) / 비이미지=확장자 뱃지.
function trayCell(a: any): HTMLElement {
  const t = document.createElement('div'); t.className = 'thumb'; t.title = a.name;
  if (isImage(a)) {
    const img = document.createElement('img'); img.loading = 'lazy'; img.draggable = false;
    const io = new IntersectionObserver((ents) => {
      for (const e of ents) if (e.isIntersecting) { io.disconnect(); const u = urlOf(a); if (u) img.src = u; }
    }, { rootMargin: '200px' });
    io.observe(img);
    t.appendChild(img);
    t.addEventListener('mouseenter', () => { if (img.src) showThumbPop(img.src, a, t); });
    t.addEventListener('mouseleave', scheduleHidePop);
  } else {
    t.appendChild(Object.assign(document.createElement('div'), { className: 'file-ext', textContent: (a.ext || '?').toUpperCase() }));
  }
  t.appendChild(Object.assign(document.createElement('span'), { className: 'cap', textContent: a.tag || a.name }));
  t.onclick = () => openLightbox(a);
  return t;
}

// ── 호버 확대(편집기 포팅) — 버튼은 편집기 종속(프로필/표지) 대신 [태그 복사][내려받기] ──
let popEl: HTMLElement | null = null;
let popAsset: any = null;
let popHideTimer: any = null;
function buildThumbPop(): HTMLElement {
  const pop = document.createElement('div'); pop.className = 'thumb-pop'; pop.hidden = true;
  const img = document.createElement('img'); img.alt = '';
  const span = document.createElement('span');
  const acts = document.createElement('div'); acts.className = 'pop-acts';
  // 캡처한 에셋을 핸들러에 전달(hideThumbPop이 popAsset을 비우므로 — 편집기에서 잡은 그 버그 예방)
  const mk = (label: string, fn: (a: any) => void) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); const a = popAsset; hideThumbPop(); if (a) fn(a); });
    return b;
  };
  acts.appendChild(mk('태그 복사', (a) => copyTag(a.name)));
  acts.appendChild(mk('내려받기', (a) => { const by = bytesOf(a); if (by) { downloadBytes(by, assetFilename(a), a.mime); toast('내려받기 시작'); } }));
  pop.append(img, span, acts);
  pop.addEventListener('mouseenter', () => { if (popHideTimer) { clearTimeout(popHideTimer); popHideTimer = null; } });
  pop.addEventListener('mouseleave', hideThumbPop);
  document.body.appendChild(pop);
  return pop;
}
function showThumbPop(src: string, asset: any, anchor: HTMLElement) {
  if (!src) return;
  if (popHideTimer) { clearTimeout(popHideTimer); popHideTimer = null; }
  if (!popEl) popEl = buildThumbPop();
  popAsset = asset;
  (popEl.querySelector('img') as HTMLImageElement).src = src;
  (popEl.querySelector('span') as HTMLElement).textContent = asset.name;
  popEl.hidden = false;
  const r = anchor.getBoundingClientRect();
  const pw = 216, ph = 280;
  let x = r.right + 8; if (x + pw > window.innerWidth) x = r.left - pw - 8; if (x < 4) x = 4;
  let y = r.top - 8; if (y + ph > window.innerHeight) y = window.innerHeight - ph - 4; if (y < 4) y = 4;
  popEl.style.left = x + 'px'; popEl.style.top = y + 'px';
}
function scheduleHidePop() { if (popHideTimer) clearTimeout(popHideTimer); popHideTimer = setTimeout(hideThumbPop, 180); }
function hideThumbPop() {
  if (popHideTimer) { clearTimeout(popHideTimer); popHideTimer = null; }
  if (popEl) popEl.hidden = true;
  popAsset = null;
}

// ── 라이트박스(관리실 previewAsset 포팅 + 태그 복사) ────────────────────────
function openLightbox(a: any) {
  hideThumbPop();
  const by = bytesOf(a);
  const ov = document.createElement('div'); ov.className = 'lightbox';
  const inner = document.createElement('div'); inner.className = 'light-inner';
  if (by && isImage(a)) { const img = document.createElement('img'); img.src = assetDataUrl(a); inner.appendChild(img); }
  else inner.appendChild(Object.assign(document.createElement('div'), { className: 'light-file', textContent: (a.ext || '파일').toUpperCase() + (by ? ` · ${fmtKB(by.length)}` : ' · 읽기 실패') }));
  const cap = document.createElement('div'); cap.className = 'light-cap';
  cap.appendChild(Object.assign(document.createElement('span'), { className: 'nm', textContent: a.name + (by ? ` (${fmtKB(by.length)})` : ''), title: a.name }));
  const tagB = Object.assign(document.createElement('button'), { textContent: '태그 복사' }); tagB.onclick = () => copyTag(a.name);
  const dlB = Object.assign(document.createElement('button'), { className: 'primary', textContent: '내려받기' });
  dlB.onclick = () => { const b2 = bytesOf(a); if (b2) { downloadBytes(b2, assetFilename(a), a.mime); toast('내려받기 시작'); } };
  cap.append(tagB, dlB); inner.appendChild(cap);
  ov.appendChild(inner); document.body.appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
}

// ── 셸 ──────────────────────────────────────────────────────────────────────
function render() {
  app.innerHTML = '';
  const bar = document.createElement('header'); bar.className = 'topbar';
  bar.appendChild(Object.assign(document.createElement('span'), { className: 'logo', innerHTML: ICON(20) + ' 에셋추출기' }));
  chipsEl = document.createElement('div'); chipsEl.className = 'chips'; bar.appendChild(chipsEl);
  const openB = Object.assign(document.createElement('button'), { textContent: '파일 열기' }); openB.onclick = () => pickFiles();
  bar.appendChild(openB);
  app.appendChild(bar);
  bodyEl = document.createElement('div'); bodyEl.style.cssText = 'flex:1 1 auto;min-height:0;display:flex;flex-direction:column;'; app.appendChild(bodyEl);
  app.appendChild(Object.assign(document.createElement('div'), { className: 'foot', textContent: '파일은 이 컴퓨터 밖으로 나가지 않아요 · GPL-3.0' }));
  renderChips(); renderBody();
}

// 창 전체 드롭 허용(빈 상태든 아니든)
document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
document.addEventListener('dragleave', (e) => { if (!(e as DragEvent).relatedTarget) document.body.classList.remove('dragging'); });
document.addEventListener('drop', (e) => {
  e.preventDefault(); document.body.classList.remove('dragging');
  const fs = Array.from(((e as DragEvent).dataTransfer && (e as DragEvent).dataTransfer.files) || []);
  if (fs.length) addFiles(fs);
});

// "연결 프로그램으로 열기"/두 번째 실행 → 메인 프로세스가 읽어 보내는 파일
try { (window as any).extractor && (window as any).extractor.onOpenFile((f: any) => { if (f && f.bytes) addBytesFile(f.name || 'file', new Uint8Array(f.bytes)); }); } catch (_) {}

render();
