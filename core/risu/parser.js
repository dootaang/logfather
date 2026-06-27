// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/risu/parser.js
// RisuAI CBS(Curly Brace Syntax) 표시 마커의 "관대(lenient) 렌더러" — 보관소용.
// 출처 이식: kwaroran/RisuAI `src/ts/parser/parser.svelte.ts`(risuChatParser/matcher) — GPL(호환).
//   리스 원본은 문자단위 스테이트풀 파서지만, 보관 렌더 목적상 동일 결과를 내는 관대 구현으로 포팅.
//   ★관대 원칙: ① 모듈/변수/Lua 의존 조건은 평가 불가 → 내용을 보여줌(숨김 X, 보관소는 다 보여주는 게 맞음)
//             ② 미구현 함수는 graceful(빈문자·잔재 0) ③ 절대 throw로 리더를 깨지 않음(원본 폴백)
'use strict';

// ── 안전 산술 평가(eval 금지) — {{? expr}} / {{calc::expr}} 용. 재귀하강 파서. ──
//   지원: + - * / % ** , 괄호, 비교(== != > < >= <=), 단항 -, 숫자. 문자 비교는 동치만.
function calcString(input) {
  const s = String(input == null ? '' : input);
  let i = 0;
  const skip = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  function parseExpr() { return parseCompare(); }
  function parseCompare() {
    let a = parseAddSub();
    skip();
    const two = s.substr(i, 2);
    if (two === '==' || two === '!=' || two === '>=' || two === '<=') {
      i += 2; const b = parseAddSub();
      if (two === '==') return a === b ? 1 : 0;
      if (two === '!=') return a !== b ? 1 : 0;
      if (two === '>=') return a >= b ? 1 : 0;
      return a <= b ? 1 : 0;
    }
    if (s[i] === '>' || s[i] === '<') { const op = s[i++]; const b = parseAddSub(); return op === '>' ? (a > b ? 1 : 0) : (a < b ? 1 : 0); }
    return a;
  }
  function parseAddSub() {
    let a = parseMulDiv();
    for (;;) { skip(); const c = s[i]; if (c === '+' || c === '-') { i++; const b = parseMulDiv(); a = c === '+' ? a + b : a - b; } else return a; }
  }
  function parseMulDiv() {
    let a = parsePow();
    for (;;) { skip(); const c = s[i]; if (c === '*' && s[i + 1] !== '*') { i++; a *= parsePow(); } else if (c === '/') { i++; const b = parsePow(); a = b === 0 ? 0 : a / b; } else if (c === '%') { i++; const b = parsePow(); a = b === 0 ? 0 : a % b; } else return a; }
  }
  function parsePow() {
    const a = parseUnary(); skip();
    if (s[i] === '*' && s[i + 1] === '*') { i += 2; return Math.pow(a, parsePow()); }
    return a;
  }
  function parseUnary() { skip(); if (s[i] === '-') { i++; return -parseUnary(); } if (s[i] === '+') { i++; return parseUnary(); } return parseAtom(); }
  function parseAtom() {
    skip();
    if (s[i] === '(') { i++; const v = parseExpr(); skip(); if (s[i] === ')') i++; return v; }
    let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++;
    if (j > i) { const num = parseFloat(s.slice(i, j)); i = j; return isNaN(num) ? 0 : num; }
    // 숫자가 아니면(미해석 변수 등) 0으로 — 관대
    while (i < s.length && !/[-+*/%()<>=\s]/.test(s[i])) i++;
    return 0;
  }
  try { const r = parseExpr(); return (typeof r === 'number' && isFinite(r)) ? (Number.isInteger(r) ? String(r) : String(r)) : '0'; }
  catch (_) { return '0'; }
}

// 값의 truthy 판정(리스: "",0,-1,false,null = falsy).
function truthy(v) { const t = String(v == null ? '' : v).trim().toLowerCase(); return !(t === '' || t === '0' || t === '-1' || t === 'false' || t === 'null' || t === 'undefined'); }
function numify(v) { const n = parseFloat(String(v)); return isNaN(n) ? null : n; }
// 수치 비교(양쪽 숫자면 수치, 아니면 문자).
function cmp(a, b) { const x = numify(a), y = numify(b); if (x !== null && y !== null) return x < y ? -1 : (x > y ? 1 : 0); const sa = String(a), sb = String(b); return sa < sb ? -1 : (sa > sb ? 1 : 0); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// 에셋/인레이 이름 정규화 조회(확장자 유무 양쪽).
function lookupAsset(map, name) {
  if (!map) return null;
  const n = String(name == null ? '' : name).trim().replace(/^['"]|['"]$/g, '');
  if (map[n] != null) return map[n];
  const lower = n.toLowerCase();
  if (map[lower] != null) return map[lower];
  const noext = lower.replace(/\.[a-z0-9]+$/i, '');
  if (map[noext] != null) return map[noext];
  // 맵 키를 소문자/무확장자로 매칭
  for (const k of Object.keys(map)) { const kl = k.toLowerCase(); if (kl === lower || kl.replace(/\.[a-z0-9]+$/i, '') === noext) return map[k]; }
  return null;
}
function imgTag(url, name) { return url ? `<img src="${url}" alt="${esc(name || '')}" style="max-width:100%;">` : ''; }

// ── 인라인 {{func::args}} 함수 테이블 ── (ctx = {index,total,role,charName,userName,assets,inlays,vars})
const FN = {
  // 자기참조/역할
  char: (a, ctx) => ctx.charName || 'Character', bot: (a, ctx) => ctx.charName || 'Character',
  user: (a, ctx) => ctx.userName || 'User', persona: (a, ctx) => ctx.userName || 'User',
  role: (a, ctx) => ctx.role || '',
  chatindex: (a, ctx) => String(ctx.index != null ? ctx.index : ''),
  messagecount: (a, ctx) => String(ctx.total != null ? ctx.total : ''),
  lastmessageid: (a, ctx) => String(ctx.total != null ? ctx.total - 1 : ''), lastcharmessageid: (a, ctx) => String(ctx.total != null ? ctx.total - 1 : ''),
  // 에셋(이미지)
  img: (a, ctx) => imgTag(lookupAsset(ctx.assets, a[0]), a[0]), image: (a, ctx) => imgTag(lookupAsset(ctx.assets, a[0]), a[0]),
  raw: (a, ctx) => imgTag(lookupAsset(ctx.assets, a[0]), a[0]), path: (a, ctx) => imgTag(lookupAsset(ctx.assets, a[0]), a[0]),
  emotion: (a, ctx) => imgTag(lookupAsset(ctx.assets, a[0]), a[0]), asset: (a, ctx) => imgTag(lookupAsset(ctx.assets, a[0]), a[0]),
  source: (a, ctx) => { const u = lookupAsset(ctx.assets, a[0]); return u || ''; }, bg: (a, ctx) => imgTag(lookupAsset(ctx.assets, a[0]), a[0]),
  // 영상/음성
  video: (a, ctx) => { const u = lookupAsset(ctx.assets, a[0]); return u ? `<video controls style="max-width:100%;"><source src="${u}"></video>` : ''; },
  'video-img': (a, ctx) => imgTag(lookupAsset(ctx.assets, a[0]), a[0]),
  audio: (a, ctx) => { const u = lookupAsset(ctx.assets, a[0]); return u ? `<audio controls><source src="${u}"></audio>` : ''; },
  bgm: (a, ctx) => { const u = lookupAsset(ctx.assets, a[0]); return u ? `<audio controls><source src="${u}"></audio>` : ''; },
  // 인레이(생성/첨부 이미지)
  inlay: (a, ctx) => imgTag(lookupAsset(ctx.inlays, a[0]), a[0]), inlayed: (a, ctx) => imgTag(lookupAsset(ctx.inlays, a[0]), a[0]), inlayeddata: (a, ctx) => imgTag(lookupAsset(ctx.inlays, a[0]), a[0]),
  // 비교/논리 (인라인)
  equal: (a) => (String(a[0]) === String(a[1]) ? '1' : '0'), is: (a) => (String(a[0]) === String(a[1]) ? '1' : '0'),
  notequal: (a) => (String(a[0]) !== String(a[1]) ? '1' : '0'), isnot: (a) => (String(a[0]) !== String(a[1]) ? '1' : '0'),
  greater: (a) => (cmp(a[0], a[1]) > 0 ? '1' : '0'), greaterequal: (a) => (cmp(a[0], a[1]) >= 0 ? '1' : '0'),
  less: (a) => (cmp(a[0], a[1]) < 0 ? '1' : '0'), lessequal: (a) => (cmp(a[0], a[1]) <= 0 ? '1' : '0'),
  and: (a) => (a.every(truthy) ? '1' : '0'), or: (a) => (a.some(truthy) ? '1' : '0'), not: (a) => (truthy(a[0]) ? '0' : '1'),
  all: (a) => (a.every(truthy) ? '1' : '0'), any: (a) => (a.some(truthy) ? '1' : '0'),
  // 계산
  calc: (a) => calcString(a.join('::')), pow: (a) => String(Math.pow(numify(a[0]) || 0, numify(a[1]) || 0)),
  remaind: (a) => { const y = numify(a[1]) || 0; return String(y ? (numify(a[0]) || 0) % y : 0); },
  min: (a) => String(Math.min(...a.map((x) => numify(x) || 0))), max: (a) => String(Math.max(...a.map((x) => numify(x) || 0))),
  abs: (a) => String(Math.abs(numify(a[0]) || 0)), round: (a) => String(Math.round(numify(a[0]) || 0)),
  floor: (a) => String(Math.floor(numify(a[0]) || 0)), ceil: (a) => String(Math.ceil(numify(a[0]) || 0)),
  // 문자열
  upper: (a) => String(a[0] || '').toUpperCase(), lower: (a) => String(a[0] || '').toLowerCase(),
  capitalize: (a) => { const s = String(a[0] || ''); return s.charAt(0).toUpperCase() + s.slice(1); },
  trim: (a) => String(a[0] || '').trim(), length: (a) => String(String(a[0] || '').length),
  reverse: (a) => String(a[0] || '').split('').reverse().join(''),
  replace: (a) => String(a[0] || '').split(String(a[1] || '')).join(String(a[2] || '')),
  startswith: (a) => (String(a[0] || '').startsWith(String(a[1] || '')) ? '1' : '0'),
  endswith: (a) => (String(a[0] || '').endsWith(String(a[1] || '')) ? '1' : '0'),
  contains: (a) => (String(a[0] || '').includes(String(a[1] || '')) ? '1' : '0'),
  slice: (a) => String(a[0] || '').slice(numify(a[1]) || 0, a[2] != null ? numify(a[2]) : undefined),
  substring: (a) => String(a[0] || '').substring(numify(a[1]) || 0, a[2] != null ? numify(a[2]) : undefined),
  tonumber: (a) => { const n = String(a[0] || '').replace(/[^0-9.\-]/g, ''); return n || '0'; },
  // 공백/줄바꿈/빈값
  br: () => '\n', newline: () => '\n', space: () => ' ', tab: () => '\t', blank: () => '', none: () => '', nothing: () => '',
  // 날짜(보관 시점 무의미 → 빈문자, 관대)
  datetimeformat: () => '', date: () => '', time: () => '', datetime: () => '', isodate: () => '', unixtime: () => '',
  // 무해 무시(변수·내부)
  hidden_key: () => '', hiddenkey: () => '', comment: () => '', position: () => '', random: () => '', roll: () => '',
};
// 비교 연산자 이름(케이스 라벨 '>','<','>=','<=','is','isnot') 별칭
FN['>'] = FN.greater; FN['<'] = FN.less; FN['>='] = FN.greaterequal; FN['<='] = FN.lessequal;

// 함수 이름 정규화(리스: lowercase + 공백/_/- 제거).
function normName(name) { return String(name || '').toLocaleLowerCase().replace(/[\s_-]/g, ''); }

// 단일 {{...}} 내용 평가 → 문자열. 미지/실패 = null(호출부가 관대 처리).
function evalToken(inner, ctx) {
  const p1 = String(inner);
  if (p1.startsWith('? ') || p1.startsWith('?')) { // {{? expr}} 계산
    const sub = p1.replace(/^\?\s*/, ''); return calcString(sub);
  }
  // :: 우선, 없으면 : 로 분리(리스와 동일)
  let splited;
  const ci = p1.indexOf(':');
  if (ci !== -1 && p1[ci + 1] === ':') splited = p1.split('::');
  else if (ci !== -1) splited = p1.split(':');
  else splited = [p1];
  const name = normName(splited[0]);
  const args = splited.slice(1);
  const fn = FN[name] || FN[splited[0]]; // 정규화/원형 둘 다
  if (fn) { try { const r = fn(args, ctx); return r == null ? '' : String(r); } catch (_) { return ''; } }
  return null; // 미지 함수
}

// 인라인 {{func}} 안쪽부터 바깥으로 반복 치환. 블록 토큰(#,:,/)은 건드리지 않음.
function evalInline(text, ctx) {
  let s = String(text == null ? '' : text);
  let guard = 0;
  for (;;) {
    if (guard++ > 10000) break;
    // 가장 안쪽 {{...}} (내부에 {{ 없음) 1개 찾기
    const m = /\{\{(?!\s*[#:/])([^{}]*?)\}\}/.exec(s);
    if (!m) break;
    const inner = m[1];
    const val = evalToken(inner, ctx);
    const replacement = (val == null) ? '' : val; // 미지 함수 = 제거(관대·잔재 0)
    s = s.slice(0, m.index) + replacement + s.slice(m.index + m[0].length);
  }
  return s;
}

// 블록 {{#...}}...{{/}} 처리(관대 = true 분기를 보여주고 :else/조건은 버림). 중첩 균형 매칭.
function expandBlocks(text, ctx) {
  let s = String(text == null ? '' : text);
  let guard = 0;
  for (;;) {
    if (guard++ > 5000) break;
    const open = /\{\{(#[a-z_-]*|:[a-z_-]+)\b[^}]*\}\}/i.exec(s);
    if (!open) break;
    if (open[1][0] === ':') { // 떠도는 {{:else}} 등 — 제거
      s = s.slice(0, open.index) + s.slice(open.index + open[0].length); continue;
    }
    // 매칭되는 {{/}} / {{/if}} 찾기(중첩 카운트)
    const startContent = open.index + open[0].length;
    let depth = 1, j = startContent, closeStart = -1, closeEnd = -1;
    const re = /\{\{(#[a-z_-]*\b[^}]*|\/[a-z]*)\}\}/gi; re.lastIndex = startContent;
    let t;
    while ((t = re.exec(s))) {
      if (t[1][0] === '#') depth++;
      else { depth--; if (depth === 0) { closeStart = t.index; closeEnd = t.index + t[0].length; break; } }
    }
    let body;
    if (closeStart === -1) { body = s.slice(startContent); closeStart = s.length; closeEnd = s.length; } // 닫힘 없음 = 끝까지
    else body = s.slice(startContent, closeStart);
    // :else 가 있으면 true 분기만(else 버림) — 관대
    const elseM = /\{\{:else\}\}/i.exec(body);
    if (elseM) body = body.slice(0, elseM.index);
    // #each 의 {{slot::x}} 잔재 제거(반복 미수행·1회 본문)
    body = body.replace(/\{\{slot::[^}]*\}\}/gi, '');
    s = s.slice(0, open.index) + body + s.slice(closeEnd);
  }
  // 레거시 {#if val\ncontent#}
  s = s.replace(/\{#\s*if\s+([^\n#]*)\n([\s\S]*?)#\}/gi, (mm, val, content) => content);
  s = s.replace(/\{#[\s\S]*?#\}/g, ''); // 기타 레거시 블록 제거
  return s;
}

// <태그 ... background-image:url('{{img::이름}}' 또는 url('dataURL')) ...></태그> → 맨 이미지(아카는 bg-image strip).
function unwrapBgImage(s) {
  return String(s == null ? '' : s)
    .replace(/<(\w+)\b[^>]*background-image\s*:\s*url\(\s*['"]?\s*([^'")]+?)\s*['"]?\s*\)[^>]*>(?:\s*<\/\1>)?/gi, (mm, tag, inner) => {
      const v = inner.trim();
      if (/^\{\{/.test(v)) return '\n\n' + v + '\n\n'; // {{img::}} 마커 → 그대로(아래 파서가 해석)
      if (/^(data:|https?:|\/\/)/i.test(v)) return '\n\n<img src="' + v + '" style="max-width:100%;">\n\n';
      return '\n\n' + v + '\n\n';
    });
}

// ── 메인: RisuAI 마커가 든 텍스트를 렌더(관대). 절대 throw 안 함(원본 폴백). ──
function renderRisu(text, ctx) {
  ctx = ctx || {};
  try {
    let s = String(text == null ? '' : text);
    s = s.replace(/<(user|char|bot)>/gi, '{{$1}}');   // 레거시 <user> 등
    s = unwrapBgImage(s);                              // 배경이미지 div → 마커/이미지
    s = evalInline(s, ctx);                            // {{func}} 안쪽부터(에셋→<img>, 비교/계산/변수)
    s = expandBlocks(s, ctx);                          // {{#if}}..{{/}} 관대(true 분기)
    s = evalInline(s, ctx);                            // 블록이 드러낸 잔여 {{func}} 한 번 더
    s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    return s;
  } catch (_) { return String(text == null ? '' : text); }
}

module.exports = { renderRisu, calcString, evalInline, expandBlocks, unwrapBgImage, truthy, cmp };
