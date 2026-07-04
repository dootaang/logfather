// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/card/cssHide.js
// 카드 backgroundHTML(순수 CSS 운반체) 분석 → "기본 상태가 숨김"인 클래스 자동 감지 (관리실 2단계).
//   왜: 상태창 봇(예: 메리시스터즈)은 숨김을 정규식이 아니라 CSS로 함 —
//     .info-tooltip { opacity: 0 }  +  .asset-container:hover .info-tooltip { opacity: 1 }
//   리스는 이 CSS를 채팅 화면에 주입해 호감도 문자열이 안 보이지만, 로그파파 리더엔 CSS가 없어 노출.
//   → 여기서 "기본 숨김 클래스"만 뽑아 리더가 그 클래스 요소를 제거(호버 안 한 리스 기본 화면과 동일).
// 감지 기준(보수적 = 오탐 최소):
//   · 선택자가 정확히 단일 클래스(.foo)인 규칙만(콤마 목록의 각 항 개별 판정). 후손/:hover/복합은 제외
//     — 그런 건 "드러내기" 규칙이라 기본 상태 판정에 안 씀.
//   · 숨김 선언: display:none · visibility:hidden · opacity:0 (즉시),
//     max-height:0/height:0 은 같은 클래스가 overflow:hidden일 때만.
//   · 같은 클래스의 순수 규칙이 나중에 같은 속성을 되살리면(미디어쿼리 재정의 등) 마지막 값 기준(last-wins).
//   · @media/@supports 등 조건부 블록은 재귀, @keyframes/@font-face 는 통째 스킵(from{opacity:0} 오탐 방지).
// 파서 견고성: 주석 제거 + CBS({{#if ...}}·{{getvar::..}} — 중괄호!)를 안쪽부터 반복 제거 후 중괄호 토큰화.
'use strict';

const CLASS_RE = /^\.([A-Za-z_][\w-]*)$/;   // 순수 단일 클래스 선택자만
const MAX_CLASSES = 64;                      // 안전 상한(비정상 카드)

// CBS(리스 중괄호 문법) 제거 — 중첩되므로 안쪽({{...}} 중 중괄호 없는 것)부터 반복.
function stripCbs(s) {
  let p = String(s || ''), q;
  do { q = p; p = p.replace(/\{\{[^{}]*\}\}/g, ''); } while (p !== q);
  return p;
}

// html 문자열에서 <style> 본문들. 태그가 없고 CSS처럼 생겼으면(중괄호) 전체를 CSS로 간주.
function styleBodies(html) {
  const s = String(html || '');
  const out = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  let m; while ((m = re.exec(s))) out.push(m[1]);
  if (!out.length && s.indexOf('<') === -1 && s.indexOf('{') >= 0) out.push(s);
  return out;
}

// CSS 토큰 순회: 일반 규칙은 onRule(selector, body), @media류는 재귀, 그 외 @블록·깨진 꼬리는 스킵.
function walkCss(css, onRule) {
  let i = 0; const n = css.length;
  while (i < n) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const sel = css.slice(i, open).trim();
    if (sel.charAt(0) === '@') {
      let depth = 1, j = open + 1;
      while (j < n && depth) { const c = css.charAt(j); if (c === '{') depth++; else if (c === '}') depth--; j++; }
      if (/^@(media|supports|container|layer|scope)\b/i.test(sel)) walkCss(css.slice(open + 1, j - 1), onRule);
      i = j;
    } else {
      const close = css.indexOf('}', open);
      if (close < 0) break;
      onRule(sel, css.slice(open + 1, close));
      i = close + 1;
    }
  }
}

// 선언 블록 → [prop(소문자), value(!important 제거·trim)] 목록.
function parseDecls(body) {
  const out = [];
  for (const part of String(body).split(';')) {
    const k = part.indexOf(':');
    if (k <= 0) continue;
    const prop = part.slice(0, k).trim().toLowerCase();
    const val = part.slice(k + 1).replace(/!important/gi, '').trim().toLowerCase();
    if (prop && val) out.push([prop, val]);
  }
  return out;
}

const isZero = (v) => /^0(?:\.0+)?(?:px|em|rem|vh|vw|%)?$/.test(v);

// CSS 텍스트 → 기본 숨김 클래스 [{cls, why}]. 문서 순서 last-wins(미디어쿼리 재정의 반영).
function extractHiddenClasses(cssText) {
  const css = stripCbs(String(cssText || '').replace(/\/\*[\s\S]*?\*\//g, ''));
  const state = new Map();   // cls -> 마지막 값들 {display,visibility,opacity,maxh0,h0,overflowHidden}
  walkCss(css, (selector, body) => {
    const classes = [];
    for (const one of selector.split(',')) { const m = CLASS_RE.exec(one.trim()); if (m) classes.push(m[1]); }
    if (!classes.length) return;
    const decls = parseDecls(body);
    if (!decls.length) return;
    for (const cls of classes) {
      const st = state.get(cls) || {};
      for (const [prop, val] of decls) {
        if (prop === 'display') st.display = val;
        else if (prop === 'visibility') st.visibility = val;
        else if (prop === 'opacity') st.opacity = val;
        else if (prop === 'max-height') st.maxh0 = isZero(val);
        else if (prop === 'height') st.h0 = isZero(val);
        else if (prop === 'overflow' || prop === 'overflow-y') st.overflowHidden = /hidden|clip/.test(val);
      }
      state.set(cls, st);
    }
  });
  const out = [];
  for (const [cls, st] of state) {
    let why = '';
    if (st.display === 'none') why = 'display:none';
    else if (st.visibility === 'hidden') why = 'visibility:hidden';
    else if (st.opacity != null && /^0(?:\.0+)?$/.test(st.opacity)) why = 'opacity:0';
    else if ((st.maxh0 || st.h0) && st.overflowHidden) why = st.maxh0 ? 'max-height:0' : 'height:0';
    if (why) out.push({ cls, why });
    if (out.length >= MAX_CLASSES) break;
  }
  return out;
}

// parseCard 결과에서 CSS 운반 필드 수집: 카드=extensions.risuai.backgroundHTML · 모듈=backgroundEmbedding.
function cardCssSources(parsed) {
  const out = []; const seen = new Set();
  const push = (s) => { if (typeof s === 'string' && s && !seen.has(s)) { seen.add(s); out.push(s); } };
  if (!parsed) return out;
  const data = (parsed.card && (parsed.card.data || parsed.card)) || null;
  const risuai = data && data.extensions && data.extensions.risuai;
  if (risuai) push(risuai.backgroundHTML);
  if (parsed.module) push(parsed.module.backgroundEmbedding);
  if (parsed.card && parsed.card.module) push(parsed.card.module.backgroundEmbedding);
  return out;
}

// 소스(parseCard 결과) → 기본 숨김 클래스 [{cls, why}] (dedup).
function extractCssHide(parsed) {
  const found = []; const seen = new Set();
  for (const src of cardCssSources(parsed)) {
    for (const body of styleBodies(src)) {
      for (const h of extractHiddenClasses(body)) {
        if (!seen.has(h.cls)) { seen.add(h.cls); found.push(h); }
      }
    }
  }
  return found;
}

module.exports = { extractCssHide, extractHiddenClasses, stripCbs, styleBodies };
