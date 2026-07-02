// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/appSettings.ts — 앱-레벨 설정(셸 테마·스킨)의 공용 모듈. 편집기·서재가 같이 쓴다(드리프트 차단).
//   여기 함수는 전부 document + localStorage만 만지는 페이지 독립 코드 → 어느 페이지에서 호출해도 동일.
//   커스텀 스킨 "정의"는 localStorage(loadCustomSkins)에 있어 양쪽이 공유. 편집기의 스킨 빌더(controls 패널)도 이걸 import.
// @ts-nocheck
import { icon } from './icons.js';
import { confirmModal } from './confirmModal.js';

// ── 셸 테마(라이트/다크/시스템 3단) ──────────────────────────────────
export const SHELL_THEME_KEY = 'pro2-shell-theme';
const themeMql = window.matchMedia('(prefers-color-scheme: dark)');
let themePref = localStorage.getItem(SHELL_THEME_KEY) || 'system';
export function getThemePref(): string { return themePref; }
export function applyShellTheme(pref: string) {
  const resolved = pref === 'dark' ? 'dark' : pref === 'light' ? 'light' : (themeMql.matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', resolved);
  const tb = document.getElementById('btn-theme');
  if (tb) {
    tb.innerHTML = pref === 'system' ? icon('contrast') : pref === 'dark' ? icon('moon') : icon('sun');
    const cur = pref === 'system' ? '시스템' : pref === 'light' ? '라이트' : '다크';
    const nxt = pref === 'system' ? '라이트' : pref === 'light' ? '다크' : '시스템';
    tb.setAttribute('title', `테마: ${cur} (클릭 → ${nxt})`);
  }
}
// 페이지 진입 시 1회: 현재 테마 적용 + OS 테마 변경 실시간 반영(pref=system일 때).
export function initTheme() { applyShellTheme(themePref); themeMql.addEventListener('change', () => { if (themePref === 'system') applyShellTheme('system'); }); }
// 테마 토글 버튼 배선(시스템→라이트→다크→시스템). 버튼이 있는 페이지(서재)만 호출.
export function wireThemeToggle(btn: HTMLElement | null) {
  if (!btn) return;
  btn.addEventListener('click', () => { themePref = themePref === 'system' ? 'light' : themePref === 'light' ? 'dark' : 'system'; localStorage.setItem(SHELL_THEME_KEY, themePref); applyShellTheme(themePref); });
}

// ── 셸 스킨(도구 화면 디자인 11종 + 커스텀) ──────────────────────────
export const SKIN_KEY = 'pro2-shell-skin';
export const CUSTOM_KEY = 'pro2-custom-skins';
export const CUSTOM_PROPS = ['--accent','--accent-2','--accent-soft','--accent-line','--btn-pri-bg','--btn-pri-fg','--btn-pri-shadow','--r-sm','--r-md','--r-lg','--r-xl','--font-sans','--font-display','--bg','--bg-deep','--body-bg','--ink','--line','--line-2'];
const SKIN_FONTS: Record<string, string> = {
  aurora: 'Sora:wght@400;500;600;700',
  brutal: 'Space+Grotesk:wght@400;500;700&family=Archivo:wght@500;700;900',
  dopa: 'Quicksand:wght@500;600;700',
  glass: 'Inter:wght@400;500;600;700',
  aero: 'Nunito:wght@600;700;800',
  synth: 'Orbitron:wght@500;700;900',
  kawaii: 'Baloo+2:wght@500;600;700',
  memphis: 'Archivo:wght@500;700;900',
  luxe: 'Playfair+Display:ital,wght@0,500;0,700;1,600&family=Inter:wght@400;500;600;700',
};
export const CUSTOM_FONTS: Record<string, { label: string; sans: string; display: string; fam?: string }> = {
  pretendard: { label: 'Pretendard (기본)', sans: '"Pretendard Variable",sans-serif', display: '"Pretendard Variable",sans-serif' },
  sora: { label: 'Sora', sans: '"Sora","Pretendard Variable",sans-serif', display: '"Sora","Pretendard Variable",sans-serif', fam: 'Sora:wght@400;500;600;700' },
  grotesk: { label: 'Space Grotesk', sans: '"Space Grotesk","Pretendard Variable",sans-serif', display: '"Space Grotesk","Pretendard Variable",sans-serif', fam: 'Space+Grotesk:wght@400;500;700' },
  quicksand: { label: 'Quicksand (둥근)', sans: '"Quicksand","Pretendard Variable",sans-serif', display: '"Quicksand","Pretendard Variable",sans-serif', fam: 'Quicksand:wght@500;600;700' },
  nunito: { label: 'Nunito (부드러운)', sans: '"Nunito","Pretendard Variable",sans-serif', display: '"Nunito","Pretendard Variable",sans-serif', fam: 'Nunito:wght@600;700;800' },
  playfair: { label: 'Playfair (세리프)', sans: '"Inter","Pretendard Variable",sans-serif', display: '"Playfair Display","Pretendard Variable",serif', fam: 'Playfair+Display:ital,wght@0,500;0,700;1,600&family=Inter:wght@400;500;600;700' },
};
export const SKIN_LIST: Array<[string, string]> = [
  ['atelier', 'Warm Atelier'], ['aurora', 'Aurora Glass'], ['brutal', 'Neo-Brutalism'], ['cyber', 'Cyber Neon'],
  ['dopa', 'Soft Dopamine'], ['glass', 'Liquid Glass'], ['aero', 'Frutiger Aero'], ['synth', 'Synthwave'],
  ['kawaii', 'Kawaii Sticker'], ['memphis', 'Memphis 80s'], ['luxe', 'Dark Luxe'], ['modern', 'Modern (legacy)'],
];
const loadedSkinFonts = new Set<string>();
export function loadSkinFont(skin: string) {
  const fam = SKIN_FONTS[skin];
  if (!fam || loadedSkinFonts.has(skin)) return;
  loadedSkinFonts.add(skin);
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=' + fam + '&display=swap';
  document.head.appendChild(l);
}
export function loadGFont(fam?: string) {
  if (!fam) return;
  const id = 'gf-' + fam.replace(/[^a-z0-9]/gi, '').slice(0, 24);
  if (document.getElementById(id)) return;
  const l = document.createElement('link'); l.id = id; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=' + fam + '&display=swap'; document.head.appendChild(l);
}
export function loadCustomSkins(): Record<string, any> {
  try { const o = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}'); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; } catch (_) { return {}; }
}
export function saveCustomSkins(o: Record<string, any>) { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(o)); } catch (_) {} }
// 사용자 CSS 살균: 외부 리소스 로드(추적/유출)·스크립트성 CSS 차단. data:image 배경은 허용.
export function sanitizeUserCss(css: string): string {
  return String(css || '')
    .replace(/<\s*\/?\s*style/gi, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/@charset[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, '(')
    .replace(/behavior\s*:[^;}]*/gi, '')
    .replace(/-moz-binding\s*:[^;}]*/gi, '')
    .replace(/url\s*\(\s*['"]?\s*(?:javascript|vbscript|data:text\/html):[^)]*\)/gi, 'none')
    .replace(/url\s*\(\s*['"]?\s*https?:[^)]*\)/gi, 'none');
}
let userCssEl: HTMLStyleElement | null = null;
export function applyCustomCss(css: string) {
  if (!userCssEl) { userCssEl = document.createElement('style'); userCssEl.id = 'pro2-user-css'; document.head.appendChild(userCssEl); }
  userCssEl.textContent = sanitizeUserCss(css);
}
function clearCustomCss() { if (userCssEl) userCssEl.textContent = ''; }
function hx2rgb(h: string): number[] { const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim()); if (!m) return [128, 128, 128]; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function relLum(rgb: number[]) { const a = rgb.map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * a[0] + .7152 * a[1] + .0722 * a[2]; }
function rgbaOf(h: string, a: number) { const [r, g, b] = hx2rgb(h); return `rgba(${r},${g},${b},${a})`; }
export function clearCustomOverrides() { const s = document.documentElement.style; for (const p of CUSTOM_PROPS) s.removeProperty(p); s.removeProperty('zoom'); clearCustomCss(); }
export function applyCustomOverrides(def: any) {
  const s = document.documentElement.style;
  const acc = def.accent || '#b1532c';
  s.setProperty('--accent', acc); s.setProperty('--accent-2', acc);
  s.setProperty('--accent-soft', rgbaOf(acc, .14)); s.setProperty('--accent-line', rgbaOf(acc, .45));
  s.setProperty('--btn-pri-bg', acc); s.setProperty('--btn-pri-fg', relLum(hx2rgb(acc)) > .45 ? '#16120d' : '#ffffff'); // 밝은 강조색 → 어두운 글자
  s.setProperty('--btn-pri-shadow', '0 6px 16px ' + rgbaOf(acc, .4));
  const r = def.radius != null ? +def.radius : 10;
  s.setProperty('--r-sm', Math.round(r * 0.55) + 'px'); s.setProperty('--r-md', Math.round(r) + 'px');
  s.setProperty('--r-lg', Math.round(r * 1.35) + 'px'); s.setProperty('--r-xl', Math.round(r * 1.7) + 'px');
  const f = CUSTOM_FONTS[def.font] || CUSTOM_FONTS.pretendard;
  s.setProperty('--font-sans', f.sans); s.setProperty('--font-display', f.display); loadGFont(f.fam);
  if (def.bg) { s.setProperty('--bg', def.bg); s.setProperty('--bg-deep', def.bg); s.setProperty('--body-bg', def.bg); } else { s.removeProperty('--bg'); s.removeProperty('--bg-deep'); s.removeProperty('--body-bg'); }
  if (def.text) s.setProperty('--ink', def.text); else s.removeProperty('--ink');
  if (def.border) { s.setProperty('--line', def.border); s.setProperty('--line-2', def.border); } else { s.removeProperty('--line'); s.removeProperty('--line-2'); }
  const sc = def.scale != null ? +def.scale : 1;
  if (sc && sc !== 1) (s as any).zoom = String(sc); else s.removeProperty('zoom');
  applyCustomCss(def.css || '');
}
export function applySkin(skin: string) {
  const sel = document.getElementById('skin-select') as HTMLSelectElement | null;
  if (skin && skin.indexOf('custom:') === 0) {
    const def = loadCustomSkins()[skin.slice(7)];
    const base = (def && def.base) || 'atelier';
    document.documentElement.setAttribute('data-skin', base); loadSkinFont(base);
    if (def) applyCustomOverrides(def); else clearCustomOverrides();
  } else {
    clearCustomOverrides();
    document.documentElement.setAttribute('data-skin', skin || 'atelier'); loadSkinFont(skin);
  }
  if (sel && sel.value !== skin) sel.value = skin;
}
// 스킨 드롭다운에 저장된 커스텀 스킨을 optgroup으로 채움(저장/삭제 후 갱신).
export function refreshSkinOptions() {
  const sel = document.getElementById('skin-select') as HTMLSelectElement | null; if (!sel) return;
  const cur = sel.value; const old = sel.querySelector('optgroup'); if (old) old.remove();
  const names = Object.keys(loadCustomSkins());
  if (names.length) {
    const og = document.createElement('optgroup'); og.label = '내 디자인';
    for (const n of names) { const o = document.createElement('option'); o.value = 'custom:' + n; o.textContent = '✎ ' + n; og.appendChild(o); }
    sel.appendChild(og);
  }
  sel.value = cur;
}

// ── UI 디자인 커스텀 빌더(내 디자인) — 편집기에서 이전(⑦식 공용화). 서재 "디자인 설정" 모달이 사용. ──
// 출력 카드와 무관(도구 셸 스킨). 미리보기는 노브 변경 시에만 적용. setStatus는 호출 페이지가 주입.
function dlJson(name: string, text: string) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
let customDraft: any = { base: 'atelier', accent: '#b1532c', radius: 10, font: 'pretendard', scale: 1, bg: null, text: null, border: null, css: '' };
function previewCustomDraft() { document.documentElement.setAttribute('data-skin', customDraft.base); loadSkinFont(customDraft.base); applyCustomOverrides(customDraft); }
let csImport: HTMLInputElement | null = null;
function ensureCsImport(setStatus: (m: string) => void, rebuild: () => void) {
  if (csImport) return csImport;
  csImport = document.createElement('input'); csImport.type = 'file'; csImport.accept = '.json,application/json'; csImport.style.display = 'none'; document.body.appendChild(csImport);
  csImport.addEventListener('change', async () => {
    const f = csImport!.files && csImport!.files[0]; if (!f) return;
    try {
      const obj = JSON.parse(await f.text()); const sk = (obj && obj.skin) ? obj.skin : obj;
      const okHexOrNull = (v: any) => /^#?[0-9a-f]{6}$/i.test(String(v || '')) ? (String(v)[0] === '#' ? String(v) : '#' + String(v)) : null;
      customDraft = {
        base: SKIN_LIST.some((s) => s[0] === sk.base) ? sk.base : 'atelier',
        accent: okHexOrNull(sk.accent) || '#b1532c', radius: Math.max(0, Math.min(24, +sk.radius || 10)), font: CUSTOM_FONTS[sk.font] ? sk.font : 'pretendard',
        scale: Math.max(0.8, Math.min(1.4, +sk.scale || 1)),
        bg: okHexOrNull(sk.bg), text: okHexOrNull(sk.text), border: okHexOrNull(sk.border), css: sanitizeUserCss(String(sk.css || '')),
      };
      rebuild();
      document.documentElement.setAttribute('data-skin', customDraft.base); loadSkinFont(customDraft.base); applyCustomOverrides(customDraft);
      setStatus('UI 스킨 가져옴 — 이름 붙여 저장하세요');
    } catch (e: any) { setStatus('가져오기 실패: ' + e.message); }
    csImport!.value = '';
  });
  return csImport;
}
export function buildCustomSkin(host: HTMLElement, setStatus: (m: string) => void) {
  host.innerHTML = '';
  const rebuild = () => buildCustomSkin(host, setStatus);
  const mkSelect = (label: string, opts: Array<[string, string]>, val: string, on: (v: string) => void) => {
    const row = document.createElement('div'); row.className = 'ctl';
    const l = document.createElement('label'); l.textContent = label; row.appendChild(l);
    const s = document.createElement('select'); for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; s.appendChild(o); }
    s.value = val; s.onchange = () => on(s.value); row.appendChild(s); return row;
  };
  host.appendChild(mkSelect('베이스 스킨 (미리보기 — "내 디자인 저장"을 눌러야 유지)', SKIN_LIST, customDraft.base, (v) => { customDraft.base = v; previewCustomDraft(); }));
  const accRow = document.createElement('div'); accRow.className = 'ctl inline';
  const accL = document.createElement('label'); accL.textContent = '포인트색';
  const accI = document.createElement('input'); accI.type = 'color'; accI.value = customDraft.accent;
  accI.oninput = () => { customDraft.accent = accI.value; previewCustomDraft(); };
  accRow.appendChild(accL); accRow.appendChild(accI); host.appendChild(accRow);
  const optColor = (label: string, key: string) => {
    const row = document.createElement('div'); row.className = 'ctl inline';
    const left = document.createElement('label'); left.style.cssText = 'display:flex;align-items:center;gap:7px;flex:1;';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!customDraft[key];
    const t = document.createElement('span'); t.textContent = label; left.appendChild(cb); left.appendChild(t);
    const ci = document.createElement('input'); ci.type = 'color'; ci.value = customDraft[key] || '#888888'; ci.disabled = !customDraft[key];
    cb.onchange = () => { if (cb.checked) { customDraft[key] = ci.value; ci.disabled = false; } else { customDraft[key] = null; ci.disabled = true; } previewCustomDraft(); };
    ci.oninput = () => { if (cb.checked) { customDraft[key] = ci.value; previewCustomDraft(); } };
    row.appendChild(left); row.appendChild(ci); return row;
  };
  host.appendChild(optColor('배경색 직접', 'bg'));
  host.appendChild(optColor('글자색 직접', 'text'));
  host.appendChild(optColor('테두리색 직접', 'border'));
  const radRow = document.createElement('div'); radRow.className = 'ctl';
  const radL = document.createElement('label'); radL.textContent = '모서리 둥글기'; radRow.appendChild(radL);
  const radWrap = document.createElement('div'); radWrap.className = 'row';
  const radI = document.createElement('input'); radI.type = 'range'; radI.min = '0'; radI.max = '24'; radI.step = '1'; radI.value = String(customDraft.radius);
  const radV = document.createElement('span'); radV.className = 'val'; radV.textContent = customDraft.radius + 'px';
  radI.oninput = () => { customDraft.radius = +radI.value; radV.textContent = radI.value + 'px'; previewCustomDraft(); };
  radWrap.appendChild(radI); radWrap.appendChild(radV); radRow.appendChild(radWrap); host.appendChild(radRow);
  const scRow = document.createElement('div'); scRow.className = 'ctl';
  const scL = document.createElement('label'); scL.textContent = '글자 크기 (UI 배율)'; scRow.appendChild(scL);
  const scWrap = document.createElement('div'); scWrap.className = 'row';
  const scI = document.createElement('input'); scI.type = 'range'; scI.min = '80'; scI.max = '140'; scI.step = '5'; scI.value = String(Math.round((customDraft.scale || 1) * 100));
  const scV = document.createElement('span'); scV.className = 'val'; scV.textContent = Math.round((customDraft.scale || 1) * 100) + '%';
  scI.oninput = () => { customDraft.scale = +scI.value / 100; scV.textContent = scI.value + '%'; previewCustomDraft(); };
  scWrap.appendChild(scI); scWrap.appendChild(scV); scRow.appendChild(scWrap); host.appendChild(scRow);
  host.appendChild(mkSelect('폰트', Object.keys(CUSTOM_FONTS).map((k) => [k, CUSTOM_FONTS[k].label]) as Array<[string, string]>, customDraft.font, (v) => { customDraft.font = v; previewCustomDraft(); }));
  const cssWrap = document.createElement('div'); cssWrap.className = 'ctl';
  const cssL = document.createElement('label'); cssL.textContent = '고급: CSS 직접 편집 (도구 화면만, 출력 카드 무관)'; cssWrap.appendChild(cssL);
  const cssTa = document.createElement('textarea'); cssTa.className = 'cs-css'; cssTa.value = customDraft.css || ''; cssTa.spellcheck = false;
  cssTa.placeholder = ':root{ --accent:#ff3b6b; --r-md:2px }\n.topbar{ letter-spacing:1px }\n.section{ border-style:dashed }';
  let cssT: any;
  cssTa.oninput = () => { customDraft.css = cssTa.value; clearTimeout(cssT); cssT = setTimeout(() => applyCustomCss(customDraft.css), 250); };
  cssWrap.appendChild(cssTa); host.appendChild(cssWrap);
  const ref = document.createElement('details'); ref.className = 'cs-ref';
  const sum = document.createElement('summary'); sum.textContent = '타겟 가능한 변수·클래스 보기'; ref.appendChild(sum);
  const refB = document.createElement('div'); refB.className = 'pair-hint';
  refB.textContent = '변수: --bg --bg-deep --panel --panel-2 --ink --ink-2 --muted --line --line-2 --accent --accent-2 --r-sm/md/lg/xl --font-sans --font-display   ·   클래스: .topbar .brand .actions .pane .pane-input .pane-settings .pane-preview .section .shead .ctl textarea#input .tray .thumb .skin-select   ·   외부 url()·@import는 안전상 차단(data:image 배경은 가능)';
  ref.appendChild(refB); host.appendChild(ref);
  const nameIn = document.createElement('input'); nameIn.type = 'text'; nameIn.placeholder = '내 디자인 이름'; host.appendChild(nameIn);
  const saveBtns = document.createElement('div'); saveBtns.className = 'qt-btns';
  const saveB = document.createElement('button'); saveB.className = 'tag-add'; saveB.textContent = '내 디자인 저장';
  saveB.onclick = async () => {
    const nm = nameIn.value.trim(); if (!nm) { setStatus('디자인 이름을 입력하세요'); nameIn.focus(); return; }
    const lib = loadCustomSkins();
    if (lib[nm] && !(await confirmModal(`"${nm}" 디자인을 덮어쓸까요?`, { okText: '덮어쓰기' }))) return;
    lib[nm] = { base: customDraft.base, accent: customDraft.accent, radius: customDraft.radius, font: customDraft.font, scale: customDraft.scale, bg: customDraft.bg, text: customDraft.text, border: customDraft.border, css: sanitizeUserCss(customDraft.css || '') };
    saveCustomSkins(lib); refreshSkinOptions();
    localStorage.setItem(SKIN_KEY, 'custom:' + nm);
    const ss = document.getElementById('skin-select') as HTMLSelectElement | null; if (ss) ss.value = 'custom:' + nm;
    rebuild();
    setStatus(`"${nm}" 디자인 저장됨 — 상단 드롭다운 "내 디자인"에 추가됨`);
  };
  const resetB = document.createElement('button'); resetB.className = 'tag-add'; resetB.textContent = '초기화';
  resetB.onclick = () => {
    customDraft = { base: 'atelier', accent: '#b1532c', radius: 10, font: 'pretendard', scale: 1, bg: null, text: null, border: null, css: '' };
    clearCustomOverrides(); document.documentElement.setAttribute('data-skin', 'atelier');
    localStorage.setItem(SKIN_KEY, 'atelier');
    const ss = document.getElementById('skin-select') as HTMLSelectElement | null; if (ss) ss.value = 'atelier';
    rebuild(); setStatus('내 디자인 초기화됨 (기본 Warm Atelier로)');
  };
  saveBtns.appendChild(saveB); saveBtns.appendChild(resetB); host.appendChild(saveBtns);
  const names = Object.keys(loadCustomSkins());
  if (names.length) {
    const mgr = document.createElement('div'); mgr.className = 'qt-btns';
    const ls = document.createElement('select'); ls.style.flex = '1'; for (const n of names) { const o = document.createElement('option'); o.value = n; o.textContent = n; ls.appendChild(o); }
    const loadB = document.createElement('button'); loadB.className = 'tag-add'; loadB.textContent = '편집';
    loadB.onclick = () => { const d = loadCustomSkins()[ls.value]; if (d) { customDraft = { base: d.base, accent: d.accent, radius: d.radius, font: d.font, scale: d.scale || 1, bg: d.bg || null, text: d.text || null, border: d.border || null, css: d.css || '' }; rebuild(); previewCustomDraft(); } };
    const delB = document.createElement('button'); delB.className = 'tag-add'; delB.textContent = '삭제';
    delB.onclick = async () => { if (!(await confirmModal(`"${ls.value}" 디자인을 삭제할까요?`, { okText: '삭제', danger: true }))) return; const l = loadCustomSkins(); delete l[ls.value]; saveCustomSkins(l); refreshSkinOptions(); rebuild(); setStatus(`"${ls.value}" 삭제됨`); };
    mgr.appendChild(ls); mgr.appendChild(loadB); mgr.appendChild(delB); host.appendChild(mgr);
  }
  const io = document.createElement('div'); io.className = 'qt-btns';
  const exp = document.createElement('button'); exp.className = 'tag-add'; exp.textContent = 'JSON 내보내기';
  exp.onclick = () => dlJson('my-ui-skin.json', JSON.stringify({ app: 'log-jejogi-pro2', kind: 'ui-skin', skin: { base: customDraft.base, accent: customDraft.accent, radius: customDraft.radius, font: customDraft.font, scale: customDraft.scale, bg: customDraft.bg, text: customDraft.text, border: customDraft.border, css: sanitizeUserCss(customDraft.css || '') } }, null, 2));
  const imp = document.createElement('button'); imp.className = 'tag-add'; imp.textContent = 'JSON 가져오기';
  imp.onclick = () => ensureCsImport(setStatus, rebuild).click();
  io.appendChild(exp); io.appendChild(imp); host.appendChild(io);
  const hint = document.createElement('div'); hint.className = 'pair-hint';
  hint.textContent = '도구 화면(셸) 디자인을 만듭니다 — 출력 카드와 무관. 배경·라이트/다크는 베이스 스킨이, 포인트색·둥글기·폰트는 여기서. 저장하면 상단 스킨 드롭다운에 추가됩니다.';
  host.appendChild(hint);
}
