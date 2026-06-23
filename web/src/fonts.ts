// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/fonts.ts — 커스텀 폰트(데스크탑 전용, 로컬 저장). UI·카드 출력(미리보기/서재/보관함)·리더 글꼴 공용.
//
// 폰트 파일은 IndexedDB에 보관(크니까 클라우드 동기화 안 함). 앱 시작 시 FontFace API로 등록해
// "폰트 이름(family)"으로 어디서든 쓸 수 있게 한다. 단 미리보기 iframe(sandbox)은 부모의 등록 폰트를
// 못 받으므로, 거기엔 @font-face를 base64 data:로 따로 심는다(getFontFaceCss).
// @ts-nocheck
import { fontsAdd, fontsAll, fontsDelete } from './store.js';

// 데스크탑 + 웹 모두 허용 — FontFace·IndexedDB는 브라우저에서도 동작(기술 한계 아닌 선택이었음). 미지원 구형 브라우저는 우아하게 false.
//   웹에서도 폰트는 로컬 전용(크니까 동기화 안 함) — 안내 문구는 유지.
export function fontsSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if ((window as any).desktop) return true;
  try { return typeof (window as any).FontFace === 'function' && typeof (window as any).indexedDB !== 'undefined'; } catch (_) { return false; }
}

const EXT_FMT: Record<string, string> = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };
const extOf = (name: string) => { const m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; };
const familyFromName = (name: string) => String(name || '').replace(/\.[^.]+$/, '').replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim() || '내 폰트';
const cssEsc = (s: string) => String(s).replace(/['\\<>]/g, '');

function bytesToB64(bytes: Uint8Array): string { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); }
const asU8 = (b: any) => (b instanceof Uint8Array ? b : new Uint8Array(b));

// ── 캐시(동기 getter용 — 매 렌더마다 IDB 안 읽게) ──
let _list: Array<{ id: string; family: string; name: string }> = [];
let _css = '';
/** 등록된 커스텀 폰트 목록(폰트 선택 메뉴용). */
export function getFontList() { return _list; }
/** 미리보기 iframe에 심을 @font-face CSS(base64 data:). */
export function getFontFaceCss() { return _css; }

async function registerOne(r: any): Promise<boolean> {
  try { const ff = new FontFace(r.family, asU8(r.bytes).buffer); await ff.load(); (document as any).fonts.add(ff); return true; }
  catch (_) { return false; }
}

// 저장된 폰트를 전부 로드·등록하고 캐시를 다시 만든다(앱 시작 + 추가/삭제 후 호출).
export async function refreshFonts(): Promise<void> {
  let fonts: any[] = [];
  try { fonts = await fontsAll(); } catch (_) { fonts = []; }
  const list: any[] = []; let css = '';
  for (const r of fonts) {
    if (!(await registerOne(r))) continue;   // 깨진 파일 건너뜀
    list.push({ id: r.id, family: r.family, name: r.name });
    const fmt = EXT_FMT[r.format] || 'truetype';
    css += `@font-face{font-family:'${cssEsc(r.family)}';src:url(data:font/${r.format};base64,${bytesToB64(asU8(r.bytes))}) format('${fmt}');font-display:swap;}`;
  }
  _list = list; _css = css;
}

// 폰트 파일들 추가(여러 개). 형식 확인 + 로드 검증(깨진 파일 거름). 반환 {added,failed}.
export async function addFontFiles(files: File[]): Promise<{ added: number; failed: number }> {
  let added = 0, failed = 0;
  for (const f of files) {
    const fmt = EXT_FMT[extOf(f.name)];
    if (!fmt) { failed++; continue; }   // .ttf/.otf/.woff/.woff2 만
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const family = familyFromName(f.name);
      const ff = new FontFace(family, bytes.buffer); await ff.load();   // 깨졌으면 throw
      (document as any).fonts.add(ff);
      await fontsAdd({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), family, name: f.name, bytes, format: extOf(f.name), ts: Date.now() });
      added++;
    } catch (_) { failed++; }
  }
  if (added) await refreshFonts();
  return { added, failed };
}
export async function removeFont(id: string): Promise<void> { try { await fontsDelete(id); } catch (_) {} await refreshFonts(); }

// ── UI(도구 화면) 폰트 선택 — --font-sans 오버라이드(스킨 위에 얹음). 로컬 저장. ──
const UI_FONT_KEY = 'pro2-ui-font';
export function getUiFont(): string { try { return localStorage.getItem(UI_FONT_KEY) || ''; } catch (_) { return ''; } }
export function applyUiFont(family?: string): void {
  const fam = family != null ? family : getUiFont();
  try { localStorage.setItem(UI_FONT_KEY, fam || ''); } catch (_) {}
  const root = document.documentElement.style;
  if (fam) root.setProperty('--font-sans', `'${cssEsc(fam)}', 'Pretendard Variable', Pretendard, system-ui, sans-serif`);
  else root.removeProperty('--font-sans');   // 기본(스킨)로 복귀
}
