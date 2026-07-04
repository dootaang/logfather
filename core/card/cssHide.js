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

// ════════════════════════════════════════════════════════════════════════════
// 3단계: 카드 CSS 통째 이식(리스 표시 패리티) — 리더가 이 CSS를 화 컨테이너에 스코프해 주입.
//   저장(관리실): sanitizeCardCss(원본, CBS 보존) + vars(defaultVariables) + classes(매칭용)
//   렌더(리더):  resolveCssCbs(CBS 실평가: screen_width·getvar·equal·? 비교) → scopeCss(선택자 접두)
// ════════════════════════════════════════════════════════════════════════════

// defaultVariables 블록("k=v" 줄들) → 맵. CBS 조건({{getvar::cv_x}})의 기본값 소스.
function parseVarsBlock(str) {
  const out = Object.create(null);
  for (const line of String(str || '').split(/\r?\n/)) {
    const k = line.indexOf('=');
    if (k > 0) out[line.slice(0, k).trim()] = line.slice(k + 1).trim();
  }
  return out;
}

// CSS 전용 CBS 미니 평가기(공유 파서 무변경 — 리더 renderRisu는 조건을 실평가 안 하는 "관대"라 CSS엔 부적합).
//   지원: {{screen_width/height}} {{getvar::x}} {{equal/any/all/not}} {{? A OP B}} + {{#if(_pure)}}...{{:else}}...{{/if}}
//   미해석 조건 = 관대(본문 유지, 리스 기본과 유사). 남은 {{...}}는 최종 제거(CSS 문법 보호).
function resolveCssCbs(css, env) {
  env = env || {};
  const vars = env.vars || {};
  const truthy = (v) => { const s = String(v).trim(); return s !== '' && s !== '0' && s.toLowerCase() !== 'false'; };
  let s = String(css || '');
  // 1) 리프 토큰 반복 평가(안쪽부터). 해석 불가 토큰은 자리 유지(무한루프 방지 위해 "바뀐 게 없으면 종료").
  for (let guard = 0; guard < 200; guard++) {
    let changed = false;
    s = s.replace(/\{\{(?!\s*[#:/])([^{}]*)\}\}/g, (whole, body) => {
      const b = body.trim();
      let r = null;
      if (/^screen_width$/i.test(b)) r = String(env.width != null ? env.width : 1024);
      else if (/^screen_height$/i.test(b)) r = String(env.height != null ? env.height : 768);
      else if (/^getvar::/i.test(b)) { const k = b.slice(8).trim(); r = vars[k] != null ? String(vars[k]) : '0'; }
      else if (/^equal::/i.test(b)) { const a = b.slice(7).split('::'); r = (a.length >= 2 && a[0].trim() === a[1].trim()) ? '1' : '0'; }
      else if (/^any::/i.test(b)) r = b.slice(5).split('::').some(truthy) ? '1' : '0';
      else if (/^all::/i.test(b)) r = b.slice(5).split('::').every(truthy) ? '1' : '0';
      else if (/^not::/i.test(b)) r = truthy(b.slice(5)) ? '0' : '1';
      else if (/^\?/.test(b)) {
        const m = /^([-\d.]+)\s*(>=|<=|==|!=|=|>|<)\s*([-\d.]+)$/.exec(b.replace(/^\?\s*/, ''));
        if (m) {
          const A = parseFloat(m[1]), B = parseFloat(m[3]), op = m[2];
          r = (op === '>' ? A > B : op === '<' ? A < B : op === '>=' ? A >= B : op === '<=' ? A <= B : op === '!=' ? A !== B : A === B) ? '1' : '0';
        }
      }
      if (r == null) return whole;   // 미지 토큰 유지(아래 블록 관대 판정 → 최종 제거)
      changed = true; return r;
    });
    if (!changed) break;
  }
  // 2) 조건 블록(안쪽=본문에 {{#가 없는 것)부터: 1=본문 · 0=else(있으면) · 미해석=관대(본문).
  const BLOCK = /\{\{#(?:if|if_pure)\b([^{}]*)\}\}((?:(?!\{\{#)[\s\S])*?)\{\{\/(?:if_pure|if)?\}\}/i;
  for (let guard = 0; guard < 500; guard++) {
    const m = BLOCK.exec(s);
    if (!m) break;
    const cond = m[1].trim();
    let body = m[2];
    const elseM = /\{\{:else\}\}/i.exec(body);
    const yes = elseM ? body.slice(0, elseM.index) : body;
    const no = elseM ? body.slice(elseM.index + elseM[0].length) : '';
    const pick = (cond === '0' || cond === '') ? no : yes;   // '1'·미해석 → 본문(관대)
    s = s.slice(0, m.index) + pick + s.slice(m.index + m[0].length);
  }
  return stripCbs(s);   // 잔여 CBS({{roll::}} 등) 제거 — CSS 문법 보호
}

// 카드 CSS 살균(파파모드 sanitizePapaCss와 같은 계열 + position:fixed 강등). CBS 토큰은 보존(렌더 시 평가).
function sanitizeCardCss(css) {
  return String(css || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')                                         // 주석(용량·파서 단순화)
    .replace(/<\s*\/\s*style/gi, '')                                          // </style 탈출 방지
    .replace(/@import[^;]*;?/gi, '')                                          // 외부 로드
    .replace(/@charset[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, '(')                                        // IE expression()
    .replace(/behavior\s*:[^;}]*/gi, '')
    .replace(/-moz-binding\s*:[^;}]*/gi, '')
    .replace(/url\s*\(\s*['"]?\s*(?:javascript|vbscript):[^)]*\)/gi, 'none')
    .replace(/javascript:/gi, '')
    .replace(/position\s*:\s*fixed/gi, 'position: relative');                 // 리더 UI 위로 떠오르는 오버레이 방지
}

// 선택자 수집(매칭용): CSS의 모든 클래스 토큰. 리더가 "이 화에 이 카드 클래스가 나오나"로 주입 여부 판단.
function extractCssClasses(cssText) {
  const css = stripCbs(String(cssText || '').replace(/\/\*[\s\S]*?\*\//g, ''));
  const seen = new Set();
  walkCss(css, (selector) => {
    let m; const re = /\.([A-Za-z_][\w-]*)/g;
    while ((m = re.exec(selector)) && seen.size < 500) seen.add(m[1]);
  });
  return [...seen];
}

// CSS를 scope 선택자 아래로 재작성(리더 셸 보호). CBS는 이미 해석된 상태여야 함(중괄호).
//   · 일반 규칙: 콤마 항목별로 클래스/아이디/속성([.#[)이 든 것만 scope 접두 — 순수 요소 선택자(p·div·body)는
//     로그 전체를 물들이므로 통째 드롭(상태창 CSS는 클래스 기반이라 손실 미미).
//   · @media류는 재귀 재작성, @keyframes/@font-face는 원문 보존(애니메이션 필요).
function scopeCss(css, scope) {
  const src = String(css || '');
  let out = '';
  let i = 0; const n = src.length;
  while (i < n) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const sel = src.slice(i, open).trim();
    if (sel.charAt(0) === '@') {
      let depth = 1, j = open + 1;
      while (j < n && depth) { const c = src.charAt(j); if (c === '{') depth++; else if (c === '}') depth--; j++; }
      const inner = src.slice(open + 1, j - 1);
      if (/^@(media|supports|container|layer|scope)\b/i.test(sel)) out += sel + '{' + scopeCss(inner, scope) + '}\n';
      else if (/^@(keyframes|-webkit-keyframes|font-face)\b/i.test(sel)) out += sel + '{' + inner + '}\n';
      i = j;
    } else {
      const close = src.indexOf('}', open);
      if (close < 0) break;
      const kept = sel.split(',').map((x) => x.trim()).filter((x) => x && /[.#[]/.test(x)).map((x) => scope + ' ' + x);
      if (kept.length) out += kept.join(', ') + '{' + src.slice(open + 1, close) + '}\n';
      i = close + 1;
    }
  }
  return out;
}

// 소스(parseCard 결과) → 카드 CSS 번들 {css(살균·CBS보존), vars, classes} 또는 null(CSS 없음).
function extractCardCssBundle(parsed) {
  const bodies = [];
  for (const src of cardCssSources(parsed)) for (const b of styleBodies(src)) bodies.push(b);
  if (!bodies.length) return null;
  const css = sanitizeCardCss(bodies.join('\n'));
  if (!css.trim()) return null;
  let vars = {};
  const data = (parsed && parsed.card && (parsed.card.data || parsed.card)) || null;
  const risuai = data && data.extensions && data.extensions.risuai;
  if (risuai && typeof risuai.defaultVariables === 'string') vars = parseVarsBlock(risuai.defaultVariables);
  return { css, vars, classes: extractCssClasses(css) };
}

module.exports = { extractCssHide, extractHiddenClasses, stripCbs, styleBodies, parseVarsBlock, resolveCssCbs, sanitizeCardCss, extractCssClasses, scopeCss, extractCardCssBundle };
