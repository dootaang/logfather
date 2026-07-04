// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/cardCss.ts — 카드 CSS(3단계 "리스 스타일") 저장·주입 준비.
//   왜 localStorage 직접인가: 동기화 KV는 Firestore 문서 1개(users/{uid}/state/kv, 1MB 한계)에 전부 담겨서
//   카드당 수십 KB짜리 CSS를 넣으면 동기화 전체가 위험. → CSS 바이트는 이 기기 보관(비밀 아님·전체백업엔 포함),
//   "리스 스타일" 모드 플래그(cssMode)만 정리규칙 KV로 동기화. 다른 기기는 카드 재업로드로 CSS 확보(없으면
//   리더가 2단계 숨김제거로 자동 폴백 — 문자열 노출 없음).
// @ts-nocheck
import { resolveCssCbs, scopeCss } from '../../core/card/cssHide.js';

const PREFIX = 'pro2-cardcss.';          // localStorage 키 = PREFIX + 소스id(파일해시)
const MAX_CSS = 300 * 1024;              // 카드당 상한(localStorage 보호)
const SCOPE = '.reader-card';            // 리더 화 컨테이너(일반 스크롤 모드) — 셸·상단바엔 안 닿음

export function saveCardCss(id: string, bundle: { css: string; vars?: any; classes?: string[]; name?: string }): boolean {
  try {
    if (!id || !bundle || !bundle.css || bundle.css.length > MAX_CSS) return false;
    localStorage.setItem(PREFIX + id, JSON.stringify({ css: bundle.css, vars: bundle.vars || {}, classes: bundle.classes || [], name: bundle.name || '' }));
    cache.clear();
    return true;
  } catch (_) { return false; }   // 용량 초과 등 — 실패해도 규칙 저장엔 지장 없음
}
export function loadCardCss(id: string): any {
  try { const raw = localStorage.getItem(PREFIX + id); return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
}
export function hasCardCss(id: string): boolean { try { return localStorage.getItem(PREFIX + id) != null; } catch (_) { return false; } }
export function deleteCardCss(id: string): void { try { localStorage.removeItem(PREFIX + id); cache.clear(); } catch (_) {} }

// 주입용 최종 CSS: CBS 실평가(현재 화면 폭·카드 기본 변수) → 리더 스코프 접두. 결과 캐시(id|폭).
const cache = new Map<string, string>();
export function scopedCardCss(id: string, width: number): string {
  const key = id + '|' + width;
  const hit = cache.get(key); if (hit != null) return hit;
  const b = loadCardCss(id);
  let out = '';
  if (b && b.css) { try { out = scopeCss(resolveCssCbs(b.css, { width, vars: b.vars || {} }), SCOPE); } catch (_) { out = ''; } }
  cache.set(key, out);
  return out;
}
