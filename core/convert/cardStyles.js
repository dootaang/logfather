// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/cardStyles.js
// 카드/모듈이 품은 CSS를 꺼내 → RisuAI 조건부 CBS를 정적(데스크탑) 컨텍스트로 평가 → 카드에 적용.
//   동기: 카드 표시 regex가 클래스 기반 HTML(<div class="aoiimage-container" ...>)을 만들면, 그
//   클래스 CSS가 module.backgroundEmbedding 등에 들어있어야 크기가 잡힌다(없으면 0px).
//   · 미리보기: 평가된 CSS를 <style>로 주입(웹).
//   · 출력(아카): 단순 셀렉터(.class/tag)를 매칭 요소의 style="" 로 flatten(자기완결 인라인 카드 불변식).
// 안전: 카드는 신뢰 불가 → CSS 살균(@import·expression·javascript:·</style 탈출 제거).
'use strict';

// ── CSS 살균 (신뢰 불가 카드 — cardRegex sanitizeRegexOut와 같은 강도) ──
function sanitizeCss(css) {
  return String(css)
    .replace(/<\s*\/\s*style/gi, '')                                   // </style 탈출 방지
    .replace(/@import[^;]*;?/gi, '')                                   // @import (외부 로드)
    .replace(/@charset[^;]*;?/gi, '')                                  // @charset
    .replace(/expression\s*\(/gi, '(')                                 // IE expression()
    .replace(/behavior\s*:[^;}]*/gi, '')                               // IE behavior(.htc 스크립트)
    .replace(/-moz-binding\s*:[^;}]*/gi, '')                           // 레거시 XBL 스크립트
    .replace(/url\s*\(\s*['"]?\s*(?:javascript|vbscript):[^)]*\)/gi, 'none') // url(javascript:)
    .replace(/url\s*\(\s*['"]?\s*https?:[^)]*\)/gi, 'none')            // 외부 http(s) 로드 차단(자기완결 오프라인)
    .replace(/javascript:/gi, '');
}

// 문자열에서 CSS 수집. html 필드는 <style> 내용만, css 필드는 생 CSS(단 <style>가 있으면 그 내용).
function collectCss(s, isCssField) {
  if (typeof s !== 'string' || !s.trim()) return [];
  if (/<\s*style\b/i.test(s)) {
    const out = []; const re = /<\s*style\b[^>]*>([\s\S]*?)<\s*\/\s*style\s*>/gi; let m;
    while ((m = re.exec(s))) out.push(m[1]);
    return out;
  }
  return isCssField ? [s] : [];
}

// parsed(카드/모듈)에서 CSS 추출(살균 포함, CBS 평가 전).
function extractCardCss(parsed) {
  const chunks = [];
  const mod = parsed && parsed.module;
  if (mod) { chunks.push(...collectCss(mod.backgroundEmbedding, false)); chunks.push(...collectCss(mod.css, true)); }
  const data = parsed && parsed.card && (parsed.card.data || parsed.card);
  const r = data && data.extensions && data.extensions.risuai;
  if (r) {
    chunks.push(...collectCss(r.backgroundHTML, false));
    chunks.push(...collectCss(r.backgroundEmbedding, false));
    chunks.push(...collectCss(r.prebuiltAssetStyle, true));
    chunks.push(...collectCss(r.additionalCss, true));
    chunks.push(...collectCss(r.customCSS, true));
    chunks.push(...collectCss(r.css, true));
  }
  return sanitizeCss(chunks.join('\n')).trim();
}

// ── RisuAI 조건부 CBS 평가(정적 컨텍스트) ──
// 단순 이항식만 안전 평가(eval 미사용). 비교→'1'/'0', 산술→숫자, 못 풀면 ''.
function evalExpr(expr) {
  expr = String(expr).trim();
  if (/^-?\d+(?:\.\d+)?$/.test(expr)) return expr;
  let m = /^(-?\d+(?:\.\d+)?)\s*(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?)$/.exec(expr);
  if (m) {
    const a = parseFloat(m[1]), b = parseFloat(m[3]); let r;
    switch (m[2]) { case '>': r = a > b; break; case '<': r = a < b; break; case '>=': r = a >= b; break; case '<=': r = a <= b; break; case '==': r = a === b; break; default: r = a !== b; }
    return r ? '1' : '0';
  }
  m = /^(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)$/.exec(expr);
  if (m) {
    const a = parseFloat(m[1]), b = parseFloat(m[3]); let r;
    switch (m[2]) { case '+': r = a + b; break; case '-': r = a - b; break; case '*': r = a * b; break; default: r = b !== 0 ? a / b : 0; }
    return String(r);
  }
  return '';
}

// css 안의 {{screen_width}}, {{? expr}}/{{calc::expr}}, {{#if X}}…{{/if}} 를 평가.
function evalRisuCss(css, ctx) {
  if (!css || css.indexOf('{{') < 0) return css || '';
  const sw = (ctx && ctx.screenWidth) || 1080;
  let out = css, prev;
  // 1) 값 CBS innermost-first 해소 (screen_width → ? / calc)
  let guard = 0;
  do {
    prev = out;
    out = out.replace(/\{\{\s*screen_width\s*\}\}/gi, String(sw));
    out = out.replace(/\{\{\s*(?:\?|calc::)\s*([^{}]+?)\s*\}\}/gi, (m, e) => evalExpr(e));
  } while (out !== prev && ++guard < 50);
  // 2) {{#if X}}…{{/if}} (X==='1'이면 유지). body에 중첩 {{#if}} 제외 → 내부-우선으로 정확히 페어링.
  guard = 0;
  const IF = /\{\{\s*#if\s+([^{}]*?)\s*\}\}((?:(?!\{\{\s*#if\b)[\s\S])*?)\{\{\s*\/if\s*\}\}/gi;
  do {
    prev = out;
    out = out.replace(IF, (m, cond, body) => (String(cond).trim() === '1' ? body : ''));
  } while (out !== prev && ++guard < 100);
  // 3) 미해소 잔여 CBS/고아 if 마커(#if·/if·if) 반복 제거(정적 컨텍스트 평가 불가 → 출력/미리보기 누수 방지)
  guard = 0;
  do {
    prev = out;
    out = out.replace(/\{\{\s*[#/]?\s*if\b[^{}]*\}\}/gi, '').replace(/\{\{[^{}]*\}\}/g, '');
  } while (out !== prev && ++guard < 20);
  return out;
}

// at-rule 블록(@media/@supports/@keyframes/@font-face 등)을 통째로 제거(중괄호 깊이 카운트).
// 이유: 이 규칙들의 내부 규칙이 flatten으로 새어 데스크탑 출력에 무조건 적용되는 것 방지(@media는 인라인 불가).
function stripAtBlocks(css) {
  let out = '', i = 0;
  while (i < css.length) {
    if (css[i] === '@' && /^@(?:media|supports|keyframes|-webkit-keyframes|-moz-keyframes|font-face|document|page)\b/i.test(css.slice(i, i + 24))) {
      let j = i;
      while (j < css.length && css[j] !== '{' && css[j] !== ';') j++;
      if (css[j] === ';' || j >= css.length) { i = j + 1; continue; }
      let depth = 0;
      for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}') { if (--depth === 0) { j++; break; } } }
      i = j; continue;
    }
    out += css[i++];
  }
  return out;
}

// ── 단순 셀렉터 CSS → 인라인 flatten (출력은 클래스 기반만; 콤비네이터/의사/at-rule 제외) ──
function parseSimpleRules(css) {
  css = stripAtBlocks(String(css).replace(/\/\*[\s\S]*?\*\//g, '')); // 주석·at-rule 제거
  const rules = []; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(css))) {
    const decls = m[2].replace(/\s+/g, ' ').trim();
    if (!decls) continue;
    const declOut = decls.endsWith(';') ? decls : decls + ';';
    for (const sel of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      if (sel.startsWith('@')) continue;                 // 잔여 at-rule
      if (/[ >+~\[\]:]/.test(sel)) continue;             // 콤비네이터/속성/의사(:hover) 제외
      const mm = /^([a-zA-Z][\w-]*)?(?:\.([\w-]+))?$/.exec(sel);
      if (!mm || !mm[2]) continue;                       // **클래스 필수** — bare 태그(div{})는 엔진 래퍼 과다매칭 방지로 제외
      rules.push({ tag: mm[1] || null, cls: mm[2], decls: declOut });
    }
  }
  return rules;
}

// html 의 여는 태그를 훑어 매칭 규칙의 선언을 style="" 에 병합.
function flattenCss(html, cssText) {
  if (!html || !cssText) return html;
  const rules = parseSimpleRules(cssText);
  if (!rules.length) return html;
  return html.replace(/<([a-zA-Z][\w-]*)\b([^>]*)>/g, (full, tag, attrs) => {
    const classAttr = (/\bclass\s*=\s*"([^"]*)"/.exec(attrs) || [, ''])[1];
    const classes = classAttr.split(/\s+/).filter(Boolean);
    let add = '';
    for (const r of rules) {
      const tagOk = !r.tag || r.tag.toLowerCase() === tag.toLowerCase();
      const clsOk = !r.cls || classes.includes(r.cls);
      if (tagOk && clsOk) add += r.decls;
    }
    if (!add) return full;
    // 속성 컨텍스트 이스케이프: CSS 선언의 "/< 가 style="" 를 탈출해 on* 핸들러를 주입하는 것 차단(리치복사 XSS).
    // &quot; 는 HTML 파서가 다시 " 로 디코드 → CSS 의미 보존(예: content:"x", font-family:"Arial").
    add = add.replace(/"/g, '&quot;').replace(/</g, '&lt;');
    if (/\bstyle\s*=\s*"/.test(attrs)) {
      attrs = attrs.replace(/\bstyle\s*=\s*"([^"]*)"/, (mm, cur) => {
        const sep = (cur.trim() && !cur.trim().endsWith(';')) ? ';' : '';
        return 'style="' + cur + sep + add + '"';
      });
    } else {
      attrs = attrs + ' style="' + add + '"';
    }
    return '<' + tag + attrs + '>';
  });
}

// ── 카드 background-image div → 아카호환 인라인 <img> ──
// 아카(Froala)는 <img src="data:"> 만 namu.la에 업로드·유지하고, class·<style>·background-image 는 strip 한다.
// 카드 regex가 만든 빈 <div style="background-image:url('data:...')"> 를 Pro1 검증 패턴
// (<div text-align:center><img ... class="fr-fic fr-dii"></div>)으로 변환. 크기/테두리는 img에 인라인 유지.
function backgroundDivToImg(html) {
  if (!html || html.indexOf('background-image') < 0) return html;
  const re = /<(\w+)\b([^>]*?)\sstyle="([^"]*)"([^>]*)>\s*<\/\1>/gi; // 빈 컨테이너만(내용 있으면 미매칭)
  return html.replace(re, (full, tag, pre, style) => {
    const m = /background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(style);
    if (!m) return full;
    const url = m[1];
    let s = style
      .replace(/background-image\s*:\s*url\([^)]*\)\s*;?/i, '')
      .replace(/background-size\s*:\s*([^;]+);?/i, 'object-fit:$1;')          // cover/contain → object-fit
      .replace(/background-position\s*:\s*([^;]+);?/i, 'object-position:$1;')
      .replace(/background(?:-repeat|-color|-attachment|-origin|-clip|-blend-mode)?\s*:[^;]*;?/gi, '')
      .replace(/(?:cursor|transition|outline)\s*:[^;]*;?/gi, '');             // img에 무의미
    s = ('max-width:100%;' + s).replace(/\s+/g, ' ').replace(/;+\s*;+/g, ';').replace(/^\s*;\s*/, '').trim();
    return `<div style="margin-bottom:1rem; width:100%; text-align:center;"><img src="${url}"${s ? ` style="${s}"` : ''} alt="" class="fr-fic fr-dii"></div>`;
  });
}

module.exports = { extractCardCss, evalRisuCss, evalExpr, sanitizeCss, parseSimpleRules, flattenCss, backgroundDivToImg };
