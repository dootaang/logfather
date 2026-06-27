// SPDX-License-Identifier: GPL-3.0-or-later
// core/risu/parser.test.js — 리스 CBS 관대 렌더러 검증.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { renderRisu, calcString, expandBlocks } = require('./parser.js');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg + ` (got: ${JSON.stringify(a)})`); console.log('  ✓ ' + msg); pass++; };

console.log('calcString:');
eq(calcString('27-3'), '24', '27-3 = 24');
eq(calcString('2 + 3 * 4'), '14', '연산 우선순위');
eq(calcString('(2+3)*4'), '20', '괄호');
eq(calcString('3 >= 24'), '0', '3>=24 = 0');
eq(calcString('24 >= 3'), '1', '24>=3 = 1');
eq(calcString('10 / 0'), '0', '0 나눗셈 안전');

console.log('에셋 마커:');
const ctx = { index: 3, total: 28, role: 'char', charName: '카나시', userName: '유나', assets: { 'kanashi_basic.png': 'data:image/png;base64,AAA', 'daria_basic.png': 'data:image/png;base64,BBB' }, inlays: { 'uuid-1': 'data:image/png;base64,CCC' } };
ok(renderRisu('{{img::kanashi_basic.png}}', ctx).includes('<img src="data:image/png;base64,AAA"'), '{{img::name}} → <img>');
ok(renderRisu('{{img::kanashi_basic}}', ctx).includes('AAA'), '무확장자 이름도 매칭');
eq(renderRisu('{{img::없는것}}', ctx).trim(), '', '없는 에셋 → 빈문자(깨진 아이콘 방지)');
ok(renderRisu('{{inlay::uuid-1}}', ctx).includes('CCC'), '{{inlay::uuid}} → <img>');
eq(renderRisu('{{inlay::없음}}', ctx).trim(), '', '바이트 없는 인레이 → 빈문자');

console.log('변수/비교/계산:');
eq(renderRisu('{{chat_index}}', ctx), '3', '{{chat_index}}');
eq(renderRisu('{{lastmessageid}}', ctx), '27', '{{lastmessageid}} = total-1');
eq(renderRisu('{{char}}', ctx), '카나시', '{{char}}');
eq(renderRisu('{{greater_equal::3::24}}', ctx), '0', '{{greater_equal::3::24}} = 0');
eq(renderRisu('{{equal::a::a}}', ctx), '1', '{{equal}}');
eq(renderRisu('{{and::1::1::0}}', ctx), '0', '{{and}}');
eq(renderRisu('{{? {{lastmessageid}}-3}}', ctx), '24', '중첩: {{?{{lastmessageid}}-3}} = 24');
eq(renderRisu('{{upper::abc}}', ctx), 'ABC', '{{upper}}');

console.log('조건문(관대 = true 분기 보여줌):');
eq(renderRisu('{{#if 1}}보임{{/}}', ctx), '보임', '{{#if 1}} → 내용');
eq(renderRisu('{{#if 0}}그래도보임{{/}}', ctx), '그래도보임', '관대: {{#if 0}}도 내용 보여줌(보관소)');
eq(renderRisu('{{#if 0}}참{{:else}}거짓{{/}}', ctx).trim(), '참', ':else 분기는 버림(중복 방지)');
eq(renderRisu('바깥 {{#if {{greater_equal::{{chat_index}}::{{?{{lastmessageid}}-3}}}}}}안{{/}} 끝', ctx).replace(/\s+/g, ' ').trim(), '바깥 안 끝', '깊은 중첩 조건도 처리(내용 보존)');
// 중첩 블록
eq(renderRisu('{{#if 1}}A{{#if 1}}B{{/}}C{{/}}', ctx), 'ABC', '중첩 {{#if}} 균형 매칭');

console.log('배경이미지 div → 이미지:');
const bg = `<div class="x" style="background-image: url('{{img::kanashi_basic.png}}');" tabindex="0"></div>`;
ok(renderRisu(bg, ctx).includes('<img src="data:image/png;base64,AAA"'), 'bg-image div의 {{img}} → <img>');
ok(!/background-image/.test(renderRisu(bg, ctx)), 'background-image 제거됨(아카 안전)');

console.log('graceful(미지 함수):');
eq(renderRisu('a{{someunknownfunc::x}}b', ctx), 'ab', '미지 함수 → 제거(잔재 0)');
eq(renderRisu('정상 텍스트 그대로', ctx), '정상 텍스트 그대로', '마커 없는 텍스트 무변경');

console.log('절대 throw 안 함:');
eq(renderRisu(null, ctx), '', 'null 입력 안전');
ok(typeof renderRisu('{{#if {{#if', ctx) === 'string', '깨진 입력도 문자열 반환');

console.log('keepAssetMarkers 모드(리더 통합용 — 에셋 마커는 보존, CBS만 처리):');
eq(renderRisu('{{#if 0}}{{img::x}}{{/}}', { assets: { x: 'D' }, keepAssetMarkers: true }).trim(), '{{img::x}}', '조건문 처리 + 에셋 마커 보존');
eq(renderRisu('{{img::kanashi_basic.png}} {{upper::ab}}', { assets: { 'kanashi_basic.png': 'D' }, keepAssetMarkers: true }), '{{img::kanashi_basic.png}} AB', '에셋 보존 + 인라인 함수 해석');
ok(!/background-image/.test(renderRisu(`<div style="background-image:url('{{img::x}}')"></div>`, { assets: { x: 'D' }, keepAssetMarkers: true })), 'bg-image div → 마커(보존모드도 언랩)');

// ── 실파일 회귀: 조교 챗(플러그인 출력) — {{#if}}·background-image·{{img:: 잔재 0, <img> 생김 ──
console.log('실파일 회귀(조교 챗):');
const file = path.join(__dirname, '..', '..', '캐릭터파일', '조교 아카데미에 어서오세요_2026-06-27T06-23-31-085Z_chat.json');
if (fs.existsSync(file)) {
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  const assets = obj.assets || {};
  const msgs = obj.data.message;
  const total = msgs.length;
  let totalImgs = 0, leftoverCbs = 0, leftoverBg = 0, leftoverImgMarker = 0;
  msgs.forEach((m, i) => {
    const out = renderRisu(String(m.data || ''), { index: i, total, role: m.role, charName: '카나시', userName: '유나', assets, inlays: {} });
    totalImgs += (out.match(/<img\s/gi) || []).length;
    leftoverCbs += (out.match(/\{\{#if/g) || []).length;
    leftoverBg += (out.match(/background-image/gi) || []).length;
    leftoverImgMarker += (out.match(/\{\{img::/g) || []).length;
  });
  eq(leftoverCbs, 0, '실파일: {{#if}} 잔재 0');
  eq(leftoverBg, 0, '실파일: background-image 잔재 0');
  eq(leftoverImgMarker, 0, '실파일: {{img::}} 잔재 0(전부 해석)');
  ok(totalImgs > 0, `실파일: 스프라이트 <img> 생성됨 (${totalImgs}장)`);
} else {
  console.log('  (스킵 — 실파일 없음: ' + file + ')');
}

console.log('Phase 3 확장(변수/배열/조건):');
eq(renderRisu('{{setvar::x::5}}{{getvar::x}}', ctx), '5', '메시지 내 setvar→getvar');
eq(renderRisu('{{getvar::없음}}', ctx).trim(), '', '미설정 변수 → 빈문자(관대)');
eq(renderRisu('{{when::1::참::거짓}}', ctx), '참', '{{when}} 참');
eq(renderRisu('{{when::0::참::거짓}}', ctx), '거짓', '{{when}} 거짓');
eq(renderRisu('{{join::["a","b","c"]::-}}', ctx), 'a-b-c', '{{join}}');
eq(renderRisu('{{arraylength::[1,2,3,4]}}', ctx), '4', '{{arraylength}}');
eq(renderRisu('{{#if {{hasvar::z}}}}있음{{:else}}없음{{/}}'.replace('z', 'none'), ctx).trim(), '있음', '관대: 조건 true 분기(hasvar)');

console.log('통합: 모듈 표시규칙(expandCardRegex) → renderRisu:');
try {
  const { expandCardRegex } = require('../convert/cardRegex.js');
  const rule = { in: '\\[hsPortrait:\\s*([^\\]]*)\\]', out: "<div style=\"background-image:url('{{img::$1}}')\"></div>", type: 'editdisplay', flag: 'g' };
  const transformed = expandCardRegex('장면 제목\n[hsPortrait: kanashi_basic]\n본문', [rule]);
  const final = renderRisu(transformed, { assets: { kanashi_basic: 'data:DDD' } });
  ok(!/\[hsPortrait:/.test(final), '[hsPortrait:] 모듈 규칙으로 변환(잔재 0)');
  ok(final.includes('data:DDD'), '변환 후 스프라이트 <img> 해석 (표시규칙→CBS→에셋 = 충실 렌더)');
} catch (e) { console.log('  (스킵 — ' + (e && e.message) + ')'); }

console.log(`\nrisu/parser: 모든 검사 통과 ✓ (${pass})`);
