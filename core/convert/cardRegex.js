// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/cardRegex.js
// 카드/모듈이 품은 RisuAI regex 스크립트("표시 변환")를 읽어 로그에 적용.
//   각 카드는 자기만의 커스텀 태그 문법을 정의함. 예(오키 아오이 모듈):
//     { in: '<aoiimg src="(.*?)">',
//       out: '<div ... style="background-image: url(\'{{raw::$1}}\');"></div>',
//       type: 'editdisplay' }
//   → 로그의 <aoiimg src="aoi_happy"> 가 이미지 div 로 펼쳐짐. {{raw::이름}} 의 에셋 이름은
//     이후 convert 단계(resolveAssetCBS)에서 dataURL 로 치환된다.
// 안전(카드 작성자 정의 = 신뢰 불가):
//   · out 은 추출 시 살균(script/iframe/on*/javascript: 제거) → 리치복사 클립보드 XSS 차단.
//   · in 은 try/catch + 중첩수량자(ReDoS) 휴리스틱 스킵.
//   · 치환은 $n 그룹만(함수 replacer) → $&/$`/$' 로 주변 로그 텍스트가 끼어드는 것 방지.
'use strict';

// "표시/출력" 타입만 적용 대상(입력 전처리/번역 타입은 제외).
const DISPLAY_TYPES = new Set(['editdisplay', 'edit_display', 'display', 'editoutput', 'edit_output', 'output']);

// out 템플릿 살균: 스크립트/위험 태그/이벤트 핸들러/javascript: 제거. 인라인 div/span/img 스타일은 보존.
function sanitizeRegexOut(out) {
  return String(out)
    .replace(/<\s*script\b[\s\S]*?<\s*\/\s*script\s*>/gi, '')                 // <script>...</script>
    .replace(/<\s*\/?\s*(?:script|iframe|object|embed|link|meta|base)\b[^>]*>/gi, '') // 위험 태그
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')                  // on* 이벤트 핸들러 속성
    .replace(/javascript:/gi, '');                                            // javascript: URL
}

// 고전 ReDoS 휴리스틱: 중첩 수량자 (…[+*]…)[+*] (예: (a+)+, (.*)* ). 정상 패턴((abc)+, (.*?)" 등)은 통과.
function isCatastrophic(pattern) {
  return /\([^()]*[+*][^()]*\)[+*]/.test(pattern);
}

// parsed(카드/모듈) 에서 regex 스크립트 배열을 모은다(가능한 위치 모두 + 배열참조 dedup).
function extractRegexScripts(parsed) {
  const found = [];
  const seen = new Set(); // 같은 배열 객체를 두 번 push 방지(risum은 parsed.module===parsed.card.module 별칭)
  const push = (arr) => {
    if (!Array.isArray(arr) || seen.has(arr)) return;
    seen.add(arr);
    for (const r of arr) if (r && typeof r.in === 'string' && typeof r.out === 'string') {
      found.push({ in: r.in, out: sanitizeRegexOut(r.out), type: r.type || 'editdisplay', flag: r.flag || r.flags || '', comment: r.comment || '' });
    }
  };
  if (!parsed) return found;
  if (parsed.module) push(parsed.module.regex);                       // risum 모듈
  const data = (parsed.card && (parsed.card.data || parsed.card)) || null;
  const risuai = data && data.extensions && data.extensions.risuai;   // 캐릭터 카드(charx/png/json)
  if (risuai) { push(risuai.customScripts); push(risuai.customscript); push(risuai.regexScript); push(risuai.regex); }
  if (parsed.card && parsed.card.module) push(parsed.card.module.regex); // charx 모듈 변형(별칭이면 dedup됨)
  return found;
}

// RisuAI in 문자열 → JS RegExp. "/pattern/flags" 형식 또는 raw 패턴 모두 지원. 전역(g) 기본.
function buildRegex(inStr, flagHint) {
  let pattern = inStr, flags = flagHint || '';
  const m = /^\/([\s\S]*)\/([gimsuy]*)$/.exec(inStr);
  if (m) { pattern = m[1]; flags = m[2] || flags; }
  if (!flags.includes('g')) flags += 'g';
  return new RegExp(pattern, flags);
}

// out 템플릿에서 $n 그룹만 치환($$→$, $&/$`/$' 는 리터럴 보존 = 주변 텍스트 스플라이스 방지).
function substituteGroups(template, args) {
  let sliceEnd = args.length - 2; // [match, p1..pN, offset, string]
  if (args.length && typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null) sliceEnd = args.length - 3; // 명명 그룹 객체
  const groups = args.slice(1, sliceEnd);
  return template.replace(/\$(\$|\d{1,2})/g, (m, d) => {
    if (d === '$') return '$';
    const i = parseInt(d, 10);
    if (i >= 1 && i <= groups.length) { const g = groups[i - 1]; return g == null ? '' : g; }
    return m; // 범위 밖 $n 은 리터럴 유지
  });
}

// 텍스트에 스크립트들을 순서대로 적용.
function expandCardRegex(text, scripts) {
  if (!text || !Array.isArray(scripts) || !scripts.length) return text;
  let out = text;
  for (const s of scripts) {
    if (!s || typeof s.in !== 'string' || typeof s.out !== 'string') continue;
    if (!DISPLAY_TYPES.has(s.type || 'editdisplay')) continue;
    let re;
    try { re = buildRegex(s.in, s.flag); } catch (e) { continue; } // 깨진 정규식 스킵
    if (isCatastrophic(re.source)) continue;                       // ReDoS 가능 패턴 스킵
    try { out = out.replace(re, (...args) => substituteGroups(s.out, args)); } catch (e) { /* 실패 시 원본 유지 */ }
  }
  return out;
}

module.exports = { extractRegexScripts, expandCardRegex, buildRegex, sanitizeRegexOut, isCatastrophic, DISPLAY_TYPES };
