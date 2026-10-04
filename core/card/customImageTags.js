// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/card/customImageTags.js — 모듈/카드 "전용 이미지 태그" 학습.
//   일부 모듈봇은 리스 표준 태그({{img::}}·<img src=>) 대신 자체 태그를 쓰고, 자기 표시 정규식으로 그림을 띄운다.
//     예) 산해경 모듈: AI가 <img sh="mina_suspicious"> 를 쓰고,
//         규칙 in='<img\s*sh\s*=\s*"?([^">]+)"?>' / out='…{{raw::{{random::…{{module_assetlist::…}}…$1…}}}}…'
//     예) 오키 아오이 모듈: <aoiimg src="aoi_happy"> → out='…url('{{raw::$1}}')…'
//   에셋 입히기는 표준 태그만 찾아서 이런 로그는 0/0이 됐다(2026-10-04 유저 제보).
//   여기서는 "출력이 에셋을 부르는 CBS를 쓰고 캡처 $n을 넘기는" 표시 규칙을 찾아, 그 in 정규식을 이미지 태그 패턴으로,
//   캡처 n을 에셋 이름으로 쓴다. 모듈의 복잡한 CBS(module_assetlist·#each·random…)를 해석할 필요 없이 이름만 뽑는다.
//   ★안전: 카드 정규식은 신뢰 불가 → buildRegex 실패·ReDoS 의심 패턴은 버림. 치환은 "카드에 실제로 있는 이름"만(has 콜백) → 오탐은 원문 유지.
'use strict';

const { extractRegexScripts, buildRegex, isCatastrophic, DISPLAY_TYPES } = require('../convert/cardRegex.js');

// 에셋을 부르는 CBS(리스 parser assetRegex 계열 + 모듈 에셋 목록).
const ASSET_CBS = /\{\{\s*(?:raw|path|img|image|image_asset|video|video-img|audio|bgm|bg|emotion|asset|source|module_assetlist)\s*::/i;

function groupCount(source, flags) {
  try { return new RegExp(source + '|', flags.replace(/[gy]/g, '')).exec('').length - 1; } catch (_) { return 0; }
}

// 정규식 스크립트 배열 → [{ source, flags, group, comment }]. 표시/출력 타입만.
function deriveImageTagRules(scripts) {
  const out = [];
  const seen = new Set();
  for (const s of scripts || []) {
    if (!s || typeof s.in !== 'string' || typeof s.out !== 'string') continue;
    if (!DISPLAY_TYPES.has(s.type || 'editdisplay')) continue;
    const at = s.out.search(ASSET_CBS);
    if (at < 0) continue;
    // 에셋 이름 = 에셋 CBS가 시작된 뒤 처음 나오는 $n(없으면 out 전체의 첫 $n).
    const g = /\$(\d{1,2})/.exec(s.out.slice(at)) || /\$(\d{1,2})/.exec(s.out);
    if (!g) continue;
    const group = parseInt(g[1], 10);
    let re;
    try { re = buildRegex(s.in, s.flag); } catch (_) { continue; }
    if (isCatastrophic(re.source)) continue;
    if (!(group >= 1) || group > groupCount(re.source, re.flags)) continue;
    const key = re.source + '/' + re.flags + '#' + group;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: re.source, flags: re.flags, group, comment: s.comment || '' });
  }
  return out;
}

// 파싱된 카드들(parseCard 결과) → 전용 태그 규칙.
function imageTagRulesFromCards(cards) {
  const all = [];
  for (const p of cards || []) { try { all.push(...extractRegexScripts(p)); } catch (_) {} }
  return deriveImageTagRules(all);
}

function reOf(r) { return new RegExp(r.source, r.flags.includes('g') ? r.flags : r.flags + 'g'); }

// 텍스트에서 전용 태그가 가리키는 에셋 이름 수집(into: Set).
function collectCustomImageRefs(text, rules, into) {
  if (!text || !rules || !rules.length) return into;
  for (const r of rules) {
    let re; try { re = reOf(r); } catch (_) { continue; }
    for (const m of String(text).matchAll(re)) { const v = String(m[r.group] || '').trim(); if (v) into.add(v); }
  }
  return into;
}

// 전용 태그 → 표준 {{img::이름}} (has(이름)이 참인 것만 = 카드에 실제로 있는 그림만). 나머지는 원문 그대로.
//   표준 태그로 바꾼 뒤엔 기존 치환기(processImageTags)가 그림·스타일을 일관되게 입힌다.
function rewriteCustomImageTags(text, rules, has) {
  let s = String(text == null ? '' : text);
  if (!rules || !rules.length) return s;
  for (const r of rules) {
    let re; try { re = reOf(r); } catch (_) { continue; }
    try {
      s = s.replace(re, (...args) => {
        const v = String(args[r.group] || '').trim();
        return (v && !/[{}]/.test(v) && has(v)) ? '{{img::' + v + '}}' : args[0];
      });
    } catch (_) { /* 실패 시 원문 유지 */ }
  }
  return s;
}

module.exports = { deriveImageTagRules, imageTagRulesFromCards, collectCustomImageRefs, rewriteCustomImageTags, ASSET_CBS };
