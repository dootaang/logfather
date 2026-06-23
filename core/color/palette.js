// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/color/palette.js
// 빠른 테마(헤드라인 #5): 배경색 + 포인트색 2개에서 카드 전체 색 팔레트를 자동 생성.
//   - 글자색(대사/나레/속마음)은 배경 대비로 자동 결정 + WCAG 대비 가드(가독성 보정).
//   - 태그/구분선/테두리는 포인트색에서 파생.
//   - 다크 버전은 배경을 어둡게 만들어(deriveDarkBg) 같은 함수로 재생성(글자는 자동으로 밝아짐).
// 아카는 var()/class/<style>을 떼므로 "CSS 변수"는 출력에 못 씀 → 결과는 그냥 인라인 색 값(기존 settings 색 노브를 채움).
'use strict';
const { hexToRgb, lighter, darker } = require('./qtColor.js');

// ---------- 색 헬퍼 ----------
const _hx = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
function rgbToHex(r, g, b) { return `#${_hx(r)}${_hx(g)}${_hx(b)}`; }
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const m = (x, y) => Math.max(0, Math.min(255, Math.round(x + (y - x) * t)));
  return rgbToHex(m(A.r, B.r), m(A.g, B.g), m(A.b, B.b));
}
function _lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function luminance(hex) { const { r, g, b } = hexToRgb(hex); return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b); }
function contrast(a, b) { const la = luminance(a) + 0.05, lb = luminance(b) + 0.05; return la > lb ? la / lb : lb / la; }
function isLight(hex) { return luminance(hex) > 0.4; }
// fg를 bg 위에서 ratio 이상 대비가 나도록 흑/백 중 더 잘 맞는 쪽으로 밀어붙임(가독성 가드).
function ensureContrast(fg, bg, ratio) {
  const target = contrast('#000000', bg) >= contrast('#ffffff', bg) ? '#000000' : '#ffffff';
  let c = fg;
  for (let i = 0; i < 24 && contrast(c, bg) < ratio; i++) c = mix(c, target, 0.12);
  return c;
}
// 배경의 색조를 살짝 남긴 어두운 배경(다크 버전용)
function deriveDarkBg(bg) { return mix(bg, '#15171c', 0.9); }

// ---------- 팔레트 생성 ----------
// bg=카드 배경, accent=포인트색, tagCount=색을 입힐 태그 수. 반환 = settings 색 패치.
function generatePalette(bg, accent, tagCount) {
  const n = (tagCount == null) ? 2 : Math.max(0, Math.floor(tagCount)); // 미지정=2, 0이면 0개
  const inkTarget = contrast('#000000', bg) >= contrast('#ffffff', bg) ? '#0d0f12' : '#f7f8fa';

  // 본문 메인 텍스트: 잉크에 포인트색 살짝 + 대비 보장
  let mainText = mix(inkTarget, accent, 0.12);
  mainText = ensureContrast(mainText, bg, 6);
  const dialog = mainText;
  const narration = ensureContrast(mix(mainText, bg, 0.28), bg, 4.5);
  const inner = ensureContrast(mix(mainText, bg, 0.5), bg, 3.2);
  const botName = ensureContrast(mix(mainText, accent, 0.25), bg, 5);

  const light = isLight(bg);
  const outerBox = light ? darker(bg, 106) : lighter(bg, 118);
  const boxBorder = mix(bg, mainText, 0.14);
  const imageBorder = mix(bg, accent, 0.5);
  const profileBorder = mix(bg, accent, 0.45);

  const divOuter = mix(accent, bg, 0.25);
  const divInner = light ? lighter(bg, 102) : bg;
  const divSolid = mix(accent, bg, 0.4);

  const tags = [];
  for (let i = 0; i < n; i++) {
    const tbg = mix(accent, bg, 0.82 - (i % 3) * 0.07); // 포인트색 옅은 틴트(태그마다 살짝 다르게)
    tags.push({ color: tbg, textColor: ensureContrast(mainText, tbg, 4.5) });
  }

  return {
    cardTextColor: mainText,
    box: { innerBoxColor: bg, outerBoxColor: outerBox, boxBorderColor: boxBorder },
    profile: { botNameColor: botName, profileBorderColor: profileBorder },
    divider: { outerColor: divOuter, innerColor: divInner, solidColor: divSolid },
    text: { dialogColor: dialog, narrationColor: narration, innerThoughtsColor: inner },
    assetImage: { imageBorderColor: imageBorder },
    tags,
  };
}

module.exports = { generatePalette, deriveDarkBg, luminance, contrast, mix, ensureContrast, isLight };
