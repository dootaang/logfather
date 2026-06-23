// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/color/palette.test.js
// 빠른 테마 팔레트 생성 + 가독성(WCAG 대비) 가드 + 다크 파생 검증.
'use strict';
const assert = require('assert');
const { generatePalette, deriveDarkBg, luminance, contrast, mix, ensureContrast, isLight } = require('./palette.js');

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); n++; };
const HEX = /^#[0-9a-f]{6}$/;

// ── 기본 색 수학 ──
{
  ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 0.1, '흑백 대비 = 21');
  ok(Math.abs(contrast('#777777', '#777777') - 1) < 0.001, '같은 색 대비 = 1');
  ok(isLight('#ffffff') && !isLight('#000000'), 'isLight: 흰색=참, 검정=거짓');
  ok(mix('#000000', '#ffffff', 0.5) === '#808080', 'mix 0.5 = 중간 회색');
  ok(HEX.test(mix('#123456', '#abcdef', 0.3)), 'mix 결과는 6자리 hex');
}

// ── ensureContrast: 대비 끌어올림 ──
{
  const fg = ensureContrast('#bbbbbb', '#ffffff', 4.5); // 흰 배경에 흐린 회색 → 더 진하게
  ok(contrast(fg, '#ffffff') >= 4.5, 'ensureContrast: 흰 배경에서 4.5 이상 확보');
  const fg2 = ensureContrast('#555555', '#000000', 4.5); // 검은 배경 → 더 밝게
  ok(contrast(fg2, '#000000') >= 4.5, 'ensureContrast: 검은 배경에서 4.5 이상 확보');
  const fg3 = ensureContrast('#808080', '#808080', 4.5); // 중간 회색 배경 → 흑/백 중 잘 맞는 쪽
  ok(contrast(fg3, '#808080') >= 4.5, 'ensureContrast: 중간색 배경도 4.5 이상(흑백 중 선택)');
}

// ── 팔레트 생성: 모든 색 필드 + 유효 hex ──
{
  const p = generatePalette('#f8f9fa', '#8a5a44', 2);
  for (const k of ['cardTextColor']) ok(HEX.test(p[k]), `palette.${k} 유효 hex`);
  for (const [grp, keys] of [['box', ['innerBoxColor', 'outerBoxColor', 'boxBorderColor']], ['profile', ['botNameColor', 'profileBorderColor']], ['divider', ['outerColor', 'innerColor', 'solidColor']], ['text', ['dialogColor', 'narrationColor', 'innerThoughtsColor']], ['assetImage', ['imageBorderColor']]]) {
    for (const key of keys) ok(HEX.test(p[grp][key]), `palette.${grp}.${key} 유효 hex`);
  }
  ok(p.box.innerBoxColor === '#f8f9fa', '카드 배경 = 입력 배경색 그대로');
  ok(p.tags.length === 2 && HEX.test(p.tags[0].color) && HEX.test(p.tags[0].textColor), '태그 색 2개 생성(bg+text)');
}

// ── 가독성: 밝은 배경 → 어두운 글자, 어두운 배경 → 밝은 글자 (자동) ──
{
  const lightP = generatePalette('#ffffff', '#3366cc', 2);
  ok(contrast(lightP.text.dialogColor, '#ffffff') >= 6, '밝은 배경: 대사 대비 6 이상');
  ok(contrast(lightP.text.narrationColor, '#ffffff') >= 4.5, '밝은 배경: 나레이션 대비 4.5 이상');
  ok(contrast(lightP.text.innerThoughtsColor, '#ffffff') >= 3.2, '밝은 배경: 속마음 대비 3.2 이상');
  ok(luminance(lightP.text.dialogColor) < 0.4, '밝은 배경: 대사 글자는 어두움');

  const darkP = generatePalette('#1a1d24', '#e0a040', 2);
  ok(contrast(darkP.text.dialogColor, '#1a1d24') >= 6, '어두운 배경: 대사 대비 6 이상');
  ok(luminance(darkP.text.dialogColor) > 0.4, '어두운 배경: 대사 글자는 밝음(자동 반전)');
  ok(contrast(darkP.tags[0].textColor, darkP.tags[0].color) >= 4.5, '어두운 배경: 태그 글자/배경 대비 4.5 이상');
}

// ── 태그 개수 가변 ──
{
  ok(generatePalette('#fff', '#c33', 3).tags.length === 3, '태그 3개 요청 → 3개');
  ok(generatePalette('#fff', '#c33', 1).tags.length === 1, '태그 1개 요청 → 1개');
  ok(generatePalette('#fff', '#c33', 0).tags.length === 0, '0개 요청 → 0개(적용 안 함)');
  ok(generatePalette('#fff', '#c33').tags.length === 2, '미지정 → 기본 2개');
}

// ── 다크 파생 ──
{
  const darkBg = deriveDarkBg('#f8f9fa');
  ok(!isLight(darkBg), 'deriveDarkBg: 밝은 배경 → 어두운 배경');
  const p = generatePalette(darkBg, '#8a5a44', 2);
  ok(luminance(p.text.dialogColor) > 0.4, '다크 파생 팔레트: 글자 밝아짐');
  ok(contrast(p.text.dialogColor, darkBg) >= 6, '다크 파생: 대사 대비 확보');
}

console.log(`\npalette: ${n} assertions ✓`);
