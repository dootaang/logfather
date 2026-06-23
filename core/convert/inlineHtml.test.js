// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/inlineHtml.test.js
// Pro2 인라인 HTML 보호: 문장 중간 <img>/커스텀 태그가 대사 정규식에 쪼개지지 않고 보존되는지.
// formatConversation 단독(이미지 펼침 결과를 직접 넣어 격리) + 옛 parity 무변경 확인.
'use strict';
const assert = require('assert');
const { formatConversation } = require('./formatConversation.js');

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); n++; };

const baseText = {
  useTextIndent: false, textIndent: 20, useTextSize: false, textSize: 14,
  dialogColor: '#111111', dialogBold: true, dialogNewline: false,
  innerThoughtsColor: '#222222', innerThoughtsBold: false, narrationColor: '#333333',
  usePadding: true, removeAsterisk: true, convertEllipsis: false, smartFormat: false, risuMarkers: true,
};
const S = (over) => ({ text: Object.assign({}, baseText, over || {}) });
const PH = /[]/; // 마스킹 토큰 누출 감지

// ── 인라인 <img>(따옴표 든 속성)가 안 쪼개짐 ──
{
  const img = '<img style="max-width:80%; border:2px solid #000" src="data:image/png;base64,AAA" alt="happy" class="fr-fic">';
  const line = `그는 웃었다 ${img} 그리고 떠났다`;
  const out = formatConversation(line, S());
  ok(out.includes(img), '인라인 <img>가 통째로 보존(속성 따옴표 안 쪼개짐)');
  ok(out.includes('color:#333333'), '앞뒤 텍스트는 나레이션 색으로');
  ok(!/color:#111111;[^>]*>그는/.test(out), '나레이션이 대사(dialog)로 오인되지 않음');
  ok(!PH.test(out), '마스킹 placeholder 토큰이 출력에 누출되지 않음');
}

// ── 대사 + 인라인 이미지 공존 ──
{
  const img = '<img src="x.png" alt="a">';
  const line = `"안녕!" 하고 ${img} 인사했다`;
  const out = formatConversation(line, S());
  ok(out.includes('color:#111111') && out.includes('"안녕!"'), '대사("안녕!")는 정상적으로 dialog 스타일');
  ok(out.includes(img), '같은 줄의 인라인 이미지도 보존');
}

// ── 블록 이미지(createImageHtml 형태, 줄바꿈 포함)가 인라인으로 와도 통과 ──
{
  const block = '\n            <div style="text-align:center;">\n                <img style="max-width:100%" \n                    src="u.png" alt="t" class="fr-fic">\n            </div>\n        ';
  const line = `소개할게 ${block} 어때?`;
  const out = formatConversation(line, S());
  ok(out.includes('<img style="max-width:100%"') && out.includes('src="u.png"'), '블록 이미지의 <img>가 온전');
  ok(out.includes('<div style="text-align:center;">') && out.includes('</div>'), '블록 div 열고 닫음이 보존(쪼개짐/유실 없음)');
  ok(!PH.test(out), '블록 이미지에서도 placeholder 누출 없음');
}

// ── 인라인 커스텀 태그(<b>강조</b>): 텍스트는 나레이션, 태그는 보존 ──
{
  const out = formatConversation('그는 <b>강조</b> 했다', S());
  ok(out.includes('<b>') && out.includes('</b>'), '커스텀 태그(<b></b>) 보존');
  ok(out.includes('>강조</span>') || /<b><span[^>]*>강조<\/span><\/b>/.test(out), '태그 안 텍스트는 나레이션 span으로 감싸짐');
  ok(out.includes('>그는 </span>') || out.includes('그는 '), '앞 텍스트 나레이션 유지');
}

// ── smart 모드에서도 인라인 이미지 보존 ──
{
  const img = '<img src="s.png">';
  const out = formatConversation(`마음속으로 ‘좋아’ ${img} 생각했다`, S({ smartFormat: true }));
  ok(out.includes(img), 'smart: 인라인 이미지 보존');
  ok(out.includes('color:#222222') && out.includes('‘좋아’'), 'smart: 속마음(‘좋아’)도 정상 인식');
}

// ── parity 보존: HTML 없는 입력은 마스킹 미발동(기존 동작과 동일 구조) ──
{
  const out = formatConversation('"대사" 그리고 나레이션', S());
  ok(out.includes('<div style="margin-bottom:1rem;">'), 'HTML 없는 입력: 기존 래핑 구조 그대로');
  ok(out.includes('color:#111111') && out.includes('color:#333333'), 'HTML 없는 입력: 대사/나레이션 분리 정상');
  ok(!PH.test(out), 'HTML 없는 입력: placeholder 미사용');
}

// ── 빈 줄·여러 줄 혼합 안전 ──
{
  const out = formatConversation(`첫 줄 <img src="a">\n\n둘째 줄`, S());
  ok(out.includes('<img src="a">'), '여러 줄 혼합: 이미지 보존');
  ok(!PH.test(out), '여러 줄 혼합: placeholder 누출 없음');
}

// ──────────── #4-A 단위(피트/인치) 보호 ────────────
const PH2 = /[-]/; // HTML(E000/E001) + 단위(E002/E003) 토큰 누출 감지

// 두 개의 피트+인치 → 아포스트로피끼리 짝지어 속마음으로 오인되던 mangle 방지
{
  const out = formatConversation('그는 5\'7" 였고 그녀는 5\'2" 였다', S());
  ok(out.includes('5\'7"') && out.includes('5\'2"'), '단위: 5\'7"·5\'2" 둘 다 온전 보존');
  ok(!out.includes('color:#222222'), '단위: 측정치가 속마음(innerColor)으로 오인되지 않음');
  ok(out.includes('color:#333333'), '단위: 측정치 줄은 나레이션으로 처리');
  ok(!PH2.test(out), '단위: placeholder 토큰 누출 없음');
}

// 두 개의 겹따옴표 인치 → 큰따옴표끼리 짝지어 대사로 오인되던 mangle 방지
{
  const out = formatConversation("모니터 12'' 와 24'' 비교", S());
  ok(out.includes("12''") && out.includes("24''"), "단위: 12''·24'' 보존");
  ok(!out.includes('color:#111111'), '단위: 겹따옴표 인치가 대사(dialogColor)로 오인되지 않음');
}

// 피트 단독(6') 보호 + 같은 줄 진짜 대사 공존
{
  const out = formatConversation('"안녕" 그는 6\' 장신이었다', S());
  ok(out.includes('color:#111111') && out.includes('"안녕"'), '단위: 진짜 대사("안녕")는 정상 dialog');
  ok(out.includes('6\''), "단위: 피트 단독(6') 보존");
}

// 숫자 대사("5")는 단위로 오인하지 않음(겹따옴표/' 아닌 단일 " 라서)
{
  const out = formatConversation('그가 "5"라고 했다', S());
  ok(out.includes('"5"') && out.includes('color:#111111'), '단위: 숫자 대사 "5" 는 그대로 대사 유지(오마스킹 없음)');
}

// 단위 없는 입력은 미발동(parity): 측정치 마스킹이 일반 텍스트 안 건드림
{
  const out = formatConversation('평범한 나레이션 12345 숫자', S());
  ok(out.includes('12345'), '단위 없음: 일반 숫자 보존');
  ok(!PH2.test(out), '단위 없음: placeholder 미사용');
}

// smart 모드: 측정치 보호 + 속마음 동시
{
  const out = formatConversation('‘작네’ 하고 5\'2" 를 쟀다', S({ smartFormat: true }));
  ok(out.includes('5\'2"'), 'smart 단위: 5\'2" 보존');
  ok(out.includes('color:#222222') && out.includes('‘작네’'), 'smart 단위: 속마음도 정상 인식');
}

// ──────────── 입력 서식 마커(__밑줄__ · ==하이라이트==) — Task E ────────────
const { prepareBody, applyInlineMarks } = require('./prepareBody.js');
{
  ok(applyInlineMarks('밑줄 __강조__ 끝').includes('border-bottom:0.08em solid currentColor'), '__밑줄__ → currentColor border-bottom(테마안전)');
  ok(applyInlineMarks('표시 ==형광== 끝').includes('color-mix(in srgb, currentColor'), '==하이라이트== → currentColor 혼합 배경');
  ok(applyInlineMarks('형광 ==색== 끝').indexOf('color:#') < 0, '하이라이트 고정색 없음(테마 적응)');
  const plain = '평범한 문장 그대로';
  ok(applyInlineMarks(plain) === plain, '마커 없으면 입력 그대로(opt-in parity)');
  ok(applyInlineMarks('a_b c=d').indexOf('<span') < 0, '단일 _ / = 는 변환 안 함(쌍만 발동)');
  const sUnder = prepareBody('나레이션 __밑줄__ 끝', { text: { removeAsterisk: false, risuMarkers: false } }, {});
  ok(sUnder.includes('border-bottom:0.08em solid currentColor'), 'prepareBody 통합: __밑줄__ 변환 반영');
  ok(sUnder.indexOf('position:') < 0 && sUnder.indexOf('display:flex') < 0, '입력 서식 마커 아카 안전(position/flex 없음)');
  const sPlain = prepareBody('밑줄 없는 평범한 본문', { text: { removeAsterisk: false, risuMarkers: false } }, {});
  ok(sPlain.indexOf('border-bottom') < 0, 'prepareBody: 마커 없으면 밑줄 span 없음(parity)');
}

console.log(`\ninlineHtml: ${n} assertions ✓`);
