// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/card/cssHide.test.js
// backgroundHTML CSS "기본 숨김 클래스" 감지 검증 — 합성 CSS(오탐/미탐 경계) + 실물 메리시스터즈 charx(있으면).
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { extractCssHide, extractHiddenClasses, stripCbs, styleBodies } = require('./cssHide.js');

const ROOT = path.join(__dirname, '..', '..');
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); n++; };
const has = (list, cls) => list.some((h) => h.cls === cls);

// ── stripCbs: 중첩 CBS(중괄호 문법)가 중괄호 토큰화를 못 깨게 ──
{
  const s = '.a { {{#if_pure {{equal::{{getvar::cv_x}}::1}}}} width: 25em; {{/if}} opacity: 0; }';
  const out = stripCbs(s);
  ok(out.indexOf('{{') === -1 && out.indexOf('opacity: 0') >= 0, 'CBS 중첩 제거 후 선언 보존');
}

// ── styleBodies: <style> 추출 + 순수 CSS 폴백 ──
{
  ok(styleBodies('<style>.a{opacity:0}</style>후미').join('') === '.a{opacity:0}', '<style> 본문 추출');
  ok(styleBodies('.a{opacity:0}').length === 1, '태그 없는 순수 CSS 폴백');
  ok(styleBodies('그냥 텍스트').length === 0, 'CSS 아닌 텍스트는 무시');
}

// ── 감지 기준: 숨김 3종 + 조건부(max-height:0+overflow) ──
{
  const css = `
    .tip { opacity: 0; transition: opacity .3s; pointer-events: none; }
    .gone { display: none !important; }
    .invis { visibility: hidden; opacity: 0; }
    .fold { max-height: 0; opacity: 1; overflow: hidden; }
    .zeroh { height: 0; }                       /* overflow 없음 → 스페이서일 수 있어 제외 */
    .half { opacity: 0.5; }                     /* 반투명 ≠ 숨김 */
    .card:hover .tip { opacity: 1; }            /* 드러내기 규칙(후손) — 기본 판정에 안 씀 */
    .tip2:hover { opacity: 0; }                 /* 의사클래스 붙음 → 순수 클래스 아님 */
    div.tagged { display: none; }               /* 복합(요소+클래스) → 보수적으로 제외 */
    .a, .b { visibility: hidden; }              /* 콤마 목록 개별 판정 */
  `;
  const r = extractHiddenClasses(css);
  ok(has(r, 'tip') && has(r, 'gone') && has(r, 'invis'), 'opacity:0 / display:none / visibility:hidden 감지');
  ok(has(r, 'fold'), 'max-height:0 + overflow:hidden 감지');
  ok(!has(r, 'zeroh'), 'height:0 단독(overflow 없음)은 제외');
  ok(!has(r, 'half'), 'opacity:0.5 는 숨김 아님');
  ok(!has(r, 'tip2') && !has(r, 'tagged'), ':hover·복합 선택자는 기본 판정에서 제외');
  ok(has(r, 'a') && has(r, 'b'), '콤마 목록의 각 클래스 개별 감지');
}

// ── last-wins: 나중 순수 규칙(미디어쿼리 재정의 포함)이 되살리면 제외 + @keyframes 스킵 ──
{
  const css = `
    .x { display: none; }
    .x { display: block; }                       /* 재정의 → 기본 표시 */
    .y { opacity: 0; }
    @media (max-width: 768px) { .y { opacity: 1; } }   /* 조건부 재정의도 last-wins(보수) */
    .z { visibility: hidden; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }   /* from{opacity:0} 오탐 금지 */
    @media (max-width: 768px) { .m { display: none; } }             /* 미디어 안 숨김도 감지 */
  `;
  const r = extractHiddenClasses(css);
  ok(!has(r, 'x') && !has(r, 'y'), '나중 규칙이 되살린 클래스는 제외(last-wins)');
  ok(has(r, 'z') && has(r, 'm'), '유지된 숨김 + @media 내부 규칙 감지');
  ok(!has(r, 'from') && !has(r, 'fadeIn'), '@keyframes 블록은 통째 스킵');
}

// ── CBS가 낀 실전형 CSS(메리시스터즈 패턴 축약) ──
{
  const css = `<style>
    .asset-container {
        {{#if_pure {{equal::{{getvar::cv_assetfolding}}::1}}}}
          {{#if {{? {{screen_width}} > 768 }} }} width: 25em; height: 20em; {{/if}}
        {{/if}}
        cursor: pointer; position: relative; overflow: hidden;
    }
    .info-tooltip { opacity: 0; transition: opacity 0.3s ease; pointer-events: none; }
    .asset-container:hover .info-tooltip { opacity: 1; }
    .gauge-tooltip { visibility: hidden; opacity: 0; position: absolute; }
    .character-info-tooltip { max-height: 0; opacity: 0; overflow: hidden; }
    .affection-gauge-fill { height: 100%; }
  </style>`;
  const r = extractHiddenClasses(styleBodies(css)[0]);
  ok(has(r, 'info-tooltip') && has(r, 'gauge-tooltip') && has(r, 'character-info-tooltip'), '툴팁 3종(호감도 문자열 운반체) 감지');
  ok(!has(r, 'asset-container') && !has(r, 'affection-gauge-fill'), '보이는 컨테이너·게이지는 미감지(CBS 섞여도)');
}

// ── extractCssHide: parseCard 모양(카드/모듈) 대응 ──
{
  const parsed = { card: { data: { extensions: { risuai: { backgroundHTML: '<style>.sec{display:none}</style>' } } } } };
  ok(has(extractCssHide(parsed), 'sec'), '카드 extensions.risuai.backgroundHTML 경로');
  const mod = { module: { backgroundEmbedding: '<style>.mm{opacity:0}</style>' } };
  ok(has(extractCssHide(mod), 'mm'), '모듈 backgroundEmbedding 경로');
  ok(extractCssHide(null).length === 0 && extractCssHide({}).length === 0, '빈 입력 안전');
}

// ── 실물: 메리시스터즈 charx(140MB, 로컬 있을 때만 — 지연 색인이라 에셋 안 풂) ──
{
  const p = path.join(ROOT, '캐릭터파일', 'Merry Sisters! - Final.charx');
  if (fs.existsSync(p)) {
    const { parseCharxIndex } = require('./charx.js');
    const parsed = parseCharxIndex(fs.readFileSync(p));
    const r = extractCssHide(parsed);
    ok(has(r, 'info-tooltip') && has(r, 'gauge-tooltip'), `실물 메리시스터즈: 호감도 툴팁 클래스 감지 (총 ${r.length}개)`);
    ok(!has(r, 'asset-container') && !has(r, 'status-wrapper'), '실물: 본문 컨테이너는 미감지(오탐 없음)');
    console.log('    감지 목록:', r.map((h) => h.cls + '(' + h.why + ')').join(' · '));
  } else {
    console.log('  - 실물 charx 없음(로컬 전용) — 합성 테스트로 대체');
  }
}

console.log(`✅ cssHide: CSS 기본 숨김 클래스 감지 (${n} assertions)`);
