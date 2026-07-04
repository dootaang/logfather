// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/card/cssHide.test.js
// backgroundHTML CSS "기본 숨김 클래스" 감지 검증 — 합성 CSS(오탐/미탐 경계) + 실물 메리시스터즈 charx(있으면).
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { extractCssHide, extractHiddenClasses, stripCbs, styleBodies, parseVarsBlock, resolveCssCbs, sanitizeCardCss, extractCssClasses, scopeCss, extractCardCssBundle } = require('./cssHide.js');

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

// ── 3단계: resolveCssCbs — CSS 전용 CBS 실평가 ──
{
  const vars = parseVarsBlock('cv_assetfolding=1\ncv_off=0\ncv_name = elsie ');
  ok(vars.cv_assetfolding === '1' && vars.cv_off === '0' && vars.cv_name === 'elsie', 'defaultVariables 블록 파싱');
  const css = `
    .asset-container {
      {{#if_pure {{equal::{{getvar::cv_assetfolding}}::1}}}}
        {{#if {{? {{screen_width}} > 768 }} }} width: 25em; {{/if}}
        {{#if {{? {{screen_width}} <= 768 }} }} width: 100%; {{/if}}
      {{/if_pure}}
      position: relative;
    }
    .gated { {{#if {{equal::{{getvar::cv_off}}::1}}}} color: red; {{:else}} color: blue; {{/if}} }
    .mystery { {{#if {{unknownfn::x}}}} outline: none; {{/if}} }
    .kf { animation: roll 1s; } @keyframes roll { 0% { content: '{{roll::20}}'; } }
  `;
  const desktop = resolveCssCbs(css, { width: 1200, vars });
  ok(desktop.includes('width: 25em') && !desktop.includes('width: 100%'), '중첩 조건 실평가: 데스크탑 분기만 생존');
  const mobile = resolveCssCbs(css, { width: 400, vars });
  ok(mobile.includes('width: 100%') && !mobile.includes('width: 25em'), '모바일 폭이면 반대 분기');
  const foldOff = resolveCssCbs(css, { width: 1200, vars: { cv_assetfolding: '0' } });
  ok(!foldOff.includes('width: 25em') && !foldOff.includes('width: 100%'), 'if_pure 바깥 조건 0이면 안쪽 통째 제거');
  ok(desktop.includes('color: blue') && !desktop.includes('color: red'), '{{:else}} 분기 선택(조건 0)');
  ok(desktop.includes('outline: none'), '미해석 조건은 관대(본문 유지)');
  ok(!desktop.includes('{{') && desktop.includes("content: ''"), '잔여 CBS 전부 제거(CSS 문법 보호)');
}

// ── 3단계: sanitizeCardCss / scopeCss / extractCssClasses ──
{
  const dirty = `@import url('https://evil.example/x.css'); /* c */
    .a { background: url("javascript:alert(1)"); position: fixed; top: 0; }
    .b { behavior: url(x.htc); width: expression(alert(1)); }`;
  const clean = sanitizeCardCss(dirty);
  ok(!/@import|javascript:|behavior|expression\s*\(/i.test(clean), '살균: @import·js url·behavior·expression 제거');
  ok(/position:\s*relative/.test(clean) && !/fixed/.test(clean), '살균: position:fixed → relative(오버레이 방지)');
  ok(sanitizeCardCss('.x { {{#if {{? {{screen_width}} > 7}} }} color:red; {{/if}} }').includes('{{#if'), '살균: CBS 보존(렌더 시 평가)');

  const css = `
    .tip { opacity: 0; } .tip:hover { opacity: 1; }
    p { color: red; } body { margin: 0; }
    .wrap p, hr { color: gold; }
    @media (max-width: 768px) { .tip { width: 100%; } div { padding: 0; } }
    @keyframes spin { to { transform: rotate(1turn); } }
  `;
  const scoped = scopeCss(css, '.reader-card');
  ok(scoped.includes('.reader-card .tip{') && scoped.includes('.reader-card .tip:hover{'), '스코프: 클래스 규칙 접두(호버 포함)');
  ok(!/(^|\n)\.reader-card p\{/.test(scoped) && !scoped.includes('body'), '스코프: 순수 요소 선택자(p·body)는 드롭');
  ok(scoped.includes('.reader-card .wrap p{') && !scoped.includes('hr{'), '스코프: 콤마 목록 항목별 필터(클래스 낀 것만)');
  ok(/@media \(max-width: 768px\)\{[\s\S]*\.reader-card \.tip\{ width: 100%; \}/.test(scoped) && !/@media[\s\S]*div\{/.test(scoped), '스코프: @media 내부 재귀 재작성');
  ok(scoped.includes('@keyframes spin{') && scoped.includes('rotate(1turn)'), '스코프: @keyframes 원문 보존');

  const classes = extractCssClasses(css);
  ok(classes.includes('tip') && classes.includes('wrap') && classes.length === 2, '클래스 수집(매칭용): 선택자의 클래스 토큰만');
}

// ── 3단계: extractCardCssBundle — 카드에서 번들(css·vars·classes) ──
{
  const parsed = { card: { data: { extensions: { risuai: {
    backgroundHTML: '<style>.st { opacity: 0; } @import url(https://x/y.css);</style>',
    defaultVariables: 'cv_a=1\ncv_b=2',
  } } } } };
  const b = extractCardCssBundle(parsed);
  ok(b && b.css.includes('.st') && !/@import/.test(b.css), '번들: 살균된 CSS');
  ok(b.vars.cv_a === '1' && b.vars.cv_b === '2', '번들: defaultVariables 동반');
  ok(b.classes.includes('st'), '번들: 매칭용 클래스');
  ok(extractCardCssBundle({ card: { data: {} } }) === null, 'CSS 없는 카드 = null');
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
    // 3단계 실물: 번들 → CBS 실평가(카드 기본 변수·데스크탑 폭) → 스코프
    const b = extractCardCssBundle(parsed);
    ok(b && b.css.length > 10000 && b.classes.includes('info-tooltip'), `실물: CSS 번들 추출(${(b.css.length / 1024).toFixed(0)}KB · 클래스 ${b.classes.length}개)`);
    const resolved = resolveCssCbs(b.css, { width: 1200, vars: b.vars });
    ok(resolved.indexOf('{{') === -1, '실물: CBS 잔재 0(중괄호 안전)');
    ok(resolved.includes('width: 25em') && /\.info-tooltip\s*\{[^}]*opacity:\s*0/.test(resolved), '실물: 데스크탑 분기 생존 + 툴팁 기본숨김 유지');
    const scoped = scopeCss(resolved, '.reader-card');
    ok(scoped.includes('.reader-card .info-tooltip') && scoped.includes('.reader-card .asset-container:hover .info-tooltip'), '실물: 스코프 접두(호버 드러내기 규칙 포함)');
    ok(!/(^|\n)\s*\.reader-card\s+(?:body|html)\b/.test(scoped), '실물: 요소 선택자 유출 없음');
  } else {
    console.log('  - 실물 charx 없음(로컬 전용) — 합성 테스트로 대체');
  }
}

console.log(`✅ cssHide: CSS 기본 숨김 클래스 감지 (${n} assertions)`);
