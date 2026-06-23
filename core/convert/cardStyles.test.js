// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
﻿// core/convert/cardStyles.test.js
// 카드 CSS 추출/조건부평가/인라인 flatten 검증 — 합성 + 실제 오키 아오이 모듈.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { extractCardCss, evalRisuCss, evalExpr, sanitizeCss, parseSimpleRules, flattenCss, backgroundDivToImg } = require('./cardStyles.js');
const { parseRisumCard } = require('../card/risum.js');
const { convertText } = require('./convertText.js');
const { defaultSettings, buildBundle, parseBundle } = require('../preset/bundle.js');

const ROOT = path.join(__dirname, '..', '..');
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); n++; };

// ── 살균 ──
{
  const c = sanitizeCss('@import url(x); a{color:red} b{c:expression(alert(1))} d{background:url(javascript:x)}');
  ok(!/@import/i.test(c), '살균: @import 제거');
  ok(!/expression\s*\(/i.test(c), '살균: expression() 제거');
  ok(!/javascript:/i.test(c), '살균: javascript: 제거');
  ok(c.includes('color:red'), '살균: 정상 선언 보존');
  ok(!sanitizeCss('a{}</style><script>').includes('</style'), '살균: </style 탈출 제거');
}

// ── 조건부 평가 ──
{
  ok(evalExpr('1080 > 768') === '1', 'evalExpr: 1080>768 → 1');
  ok(evalExpr('768 > 1080') === '0', 'evalExpr: 768>1080 → 0');
  ok(evalExpr('1080 <= 768') === '0', 'evalExpr: <= 비교');
  ok(evalExpr('3 + 4') === '7', 'evalExpr: 산술');
  ok(evalExpr('42') === '42', 'evalExpr: 숫자 그대로');
  ok(evalExpr('garbage > x') === '', 'evalExpr: 못 풀면 빈값');

  const css = '.x {\n{{#if {{? {{screen_width}} > 768 }} }}\n  width: 30em; height: 28em;\n{{/if}}\n{{#if {{? {{screen_width}} <= 768 }} }}\n  width: 100%;\n{{/if}}\n  margin: auto;\n}';
  const desk = evalRisuCss(css, { screenWidth: 1080 });
  ok(desk.includes('width: 30em'), '조건부: 데스크탑 분기(>768) 유지');
  ok(!desk.includes('width: 100%'), '조건부: 모바일 분기(<=768) 제거');
  ok(desk.includes('margin: auto'), '조건부: 조건 밖 선언 보존');
  ok(desk.indexOf('{{') < 0, '조건부: CBS 전부 해소');
}

// ── 단순 셀렉터 파싱 (클래스 필수 + at-rule 제거) ──
{
  const rules = parseSimpleRules('.foo{a:b} .bar:hover{c:d} p q{e:f} div,.baz{g:h} @media (max-width:768px){.z{i:j}}');
  const cls = rules.map((r) => (r.tag || '') + (r.cls ? '.' + r.cls : ''));
  ok(cls.includes('.foo'), '파싱: .foo 채택');
  ok(!cls.includes('.bar'), '파싱: :hover 제외');
  ok(!rules.some((r) => r.tag === 'p'), '파싱: 후손 셀렉터(p q) 제외');
  ok(!cls.includes('div') && cls.includes('.baz'), '파싱: bare 태그(div) 드롭, .baz 채택(클래스 필수)');
  ok(!cls.includes('.z'), '파싱: @media 내부 규칙 제거(데스크탑 무조건 적용 방지)');
}

// ── 인라인 flatten ──
{
  const h1 = flattenCss('<div class="foo" style="x:y">a</div>', '.foo{w:1px}');
  ok(h1.includes('style="x:y;w:1px;"'), 'flatten: 기존 style에 병합');
  const h2 = flattenCss('<div class="foo">a</div>', '.foo{w:1px}');
  ok(h2.includes('style="w:1px;"'), 'flatten: style 없으면 추가');
  const h3 = flattenCss('<span class="bar">a</span>', '.foo{w:1px}');
  ok(h3 === '<span class="bar">a</span>', 'flatten: 비매칭 요소 불변');
}

// ── 보안/정확성 회귀(적대 리뷰 반영) ──
{
  // 중첩 {{#if}} 정확 페어링: 외부 false면 내부까지 전부 제거(고아 {{/if}} 누수 없음)
  ok(evalRisuCss('PRE{{#if 0}}A{{#if 1}}B{{/if}}C{{/if}}POST') === 'PREPOST', '중첩 #if: 외부 false → 전체 제거, {{/if}} 누수 없음');
  ok(evalRisuCss('{{#if 1}}outer{{#if 0}}inner{{/if}}after{{/if}}') === 'outerafter', '중첩 #if: after 보존');
  ok(evalRisuCss('.x{ {{#if {{unknown_var}}}}A{{/if}} }').indexOf('{{') < 0, '미해소 CBS 잔여 제거');

  // @media 규칙은 flatten에 안 들어감(미리보기는 별도 <style>가 처리)
  const med = flattenCss('<div class="box">x</div>', '@media (max-width:768px){.box{width:10em}} .box{color:red}');
  ok(/style="color:red;"/.test(med) && !/width:10em/.test(med), '@media: 모바일 규칙은 flatten 제외, 데스크탑 규칙만');

  // XSS: CSS 선언의 " 가 style="" 를 탈출하지 못함(리치복사 출력 안전)
  const xss = flattenCss('<div class="aoiimage-container">x</div>', '.aoiimage-container{color:red" onmouseover="alert(1)}');
  ok(!/onmouseover\s*=\s*"/.test(xss), 'XSS: 속성 breakout 차단(on* 미주입)');
  ok(xss.includes('&quot;'), 'XSS: 선언 내 " 가 &quot; 로 이스케이프');

  // sanitizeCss 강화: behavior/-moz-binding/외부 url 차단
  const s = sanitizeCss('.a{behavior:url(x.htc)} .b{-moz-binding:url(#z)} .c{background:url(http://evil/x.png)}');
  ok(!/behavior\s*:/i.test(s) && !/-moz-binding/i.test(s), '살균: behavior/-moz-binding 제거');
  ok(!/http:\/\/evil/i.test(s), '살균: 외부 http url 차단');

  // bare 태그 규칙은 엔진 래퍼 div를 오염시키지 않음
  ok(flattenCss('<div style="margin-bottom:1.5rem;">t</div>', 'div{width:100%}') === '<div style="margin-bottom:1.5rem;">t</div>', 'bare 태그 규칙은 flatten 안 함(엔진 래퍼 보호)');
}

// ── background-image div → 아카호환 인라인 <img> ──
{
  const div = '<div class="aoiimage-container" style="background-image: url(\'data:image/webp;base64,AAA\');width:30em;height:28em;background-size:cover;border-radius:20px;border:5px solid #EBE0E0;cursor:pointer;" tabindex="0"></div>';
  const out = backgroundDivToImg(div);
  ok(out.includes('<img src="data:image/webp;base64,AAA"'), 'convert: <img src=dataURL 생성');
  ok(!out.includes('background-image'), 'convert: background-image 제거(아카는 못 올림)');
  ok(/object-fit:\s*cover/.test(out), 'convert: background-size:cover → object-fit:cover');
  ok(out.includes('width:30em') && out.includes('border:5px solid'), 'convert: 크기·테두리 인라인 유지(아카 생존)');
  ok(!/cursor|transition/.test(out), 'convert: img에 무의미한 cursor/transition 제거');
  ok(out.includes('text-align:center') && out.includes('fr-fic fr-dii'), 'convert: Pro1 중앙정렬 래퍼 + 프로알라 클래스');
  // bg 없는 일반 div는 불변
  ok(backgroundDivToImg('<div style="color:red"></div>') === '<div style="color:red"></div>', 'convert: bg 없으면 불변');
  // 내용 있는 div는 변환 안 함(빈 컨테이너만)
  ok(backgroundDivToImg('<div style="background-image:url(x)">내용</div>').includes('내용'), 'convert: 내용 있는 div는 건드리지 않음');
}

// ── 실제 오키 모듈 e2e ──
{
  const parsed = parseRisumCard(fs.readFileSync(path.join(ROOT, '캐릭터파일', '모듈봇', '오키 아오이(Oki Aoi).risum')));
  const raw = extractCardCss(parsed);
  ok(raw.includes('.aoiimage-container'), '오키: backgroundEmbedding에서 .aoiimage-container CSS 추출');
  ok(raw.indexOf('{{') >= 0, '오키: 추출 CSS에 조건부 CBS 존재(평가 전)');
  const evaled = evalRisuCss(raw, { screenWidth: 1080 });
  ok(evaled.includes('width: 30em') && evaled.indexOf('{{') < 0, '오키: 데스크탑 평가 후 width:30em, CBS 없음');
  // regex out이 만드는 클래스 div에 flatten
  const cardHtml = '<div class="aoiimage-container" style="background-image: url(\'data:image/webp;base64,AAA\');" tabindex="0"></div>';
  const flat = flattenCss(cardHtml, evaled);
  ok(/width: 30em/.test(flat) && /height: 28em/.test(flat), '오키: 클래스 div에 크기 인라인 flatten(아카 생존)');
  ok(flat.includes("background-image: url('data:image/webp"), '오키: 기존 배경이미지 보존');
}

// ── 사용자 출력 CSS 데코(템플릿 hook → flatten) ──
{
  const s = defaultSettings();
  s.template = 'custom-css';
  s.profile.showProfile = false;
  s.userCardCss = '.lp-card{border:3px dashed #ff6b6b}.lp-dialog{color:#3157ff}.lp-narration{opacity:.8}';
  const out = convertText('"안녕" 그리고 나레이션', s);
  ok(out.includes('class="lp-card"'), 'userCardCss: 카드 hook 클래스 부여');
  ok(/class="lp-card" style="[^"]*border:3px dashed #ff6b6b;/.test(out), 'userCardCss: 카드 CSS 인라인 flatten');
  ok(/class="lp-dialog" style="[^"]*color:#2d3748;[^"]*color:#3157ff;/.test(out), 'userCardCss: 대사 CSS가 기존 style 뒤에 병합');
  ok(/class="lp-narration" style="[^"]*opacity:.8;/.test(out), 'userCardCss: 나레이션 CSS 인라인 flatten');

  const clean = convertText('"안녕" 그리고 나레이션', Object.assign(defaultSettings(), { profile: Object.assign(defaultSettings().profile, { showProfile: false }) }));
  ok(!clean.includes('lp-card') && !clean.includes('lp-dialog'), 'userCardCss 없음: hook 클래스 미출력(골든 패리티 보호)');
  const ignored = convertText('"안녕"', Object.assign(defaultSettings(), { userCardCss: '.lp-card{border:9px solid red}' }));
  ok(!ignored.includes('lp-card') && !ignored.includes('9px solid red'), 'custom-css 미선택: userCardCss는 출력에 기생 적용되지 않음');

  const bundle = buildBundle(s);
  ok(bundle.settings.template === 'custom-css', 'bundle: CSS 커스텀 출력 디자인 저장');
  ok(bundle.settings.userCardCss.includes('.lp-card'), 'bundle: userCardCss 저장');
  const parsedBundle = parseBundle({ app: 'log-jejogi-pro2', version: 1, settings: { userCardCss: '@import url(x);.lp-card{color:red}', template: 'unknown' } });
  ok(parsedBundle.settings.template === 'card', 'bundle: 미지 템플릿은 card로 폴백');
  ok(!/@import/i.test(parsedBundle.settings.userCardCss) && parsedBundle.settings.userCardCss.includes('.lp-card'), 'bundle: userCardCss 살균');
}

console.log(`✅ cardStyles: 카드 CSS 추출/조건부평가/인라인 flatten 통과 (${n} assertions)`);

