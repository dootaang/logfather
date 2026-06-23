// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/color/qtColor.js
// Qt QColor.lighter/darker(factor) 정확 재현 — 그라데이션 태그 색 계산.
// 옛 앱은 PyQt6(QColor)를 호출했고 결과 hex는 코드에 없으므로,
// Pro 1.2 실제 출력(골든)으로 역설계·검증한 알고리즘이다. (tests/golden/COLOR_MATH.md)
//
// Qt 내부 정밀도를 그대로 재현하는 게 핵심:
//  - 8bit→16bit: c16 = c8 * 257
//  - HSV의 S·V는 0..65535, H는 0..35999(도*100)로 보관
//  - lighter: V*=f/100(정수); V>65535면 S를 넘침만큼 깎고 V=65535
//  - darker:  V=V*100/f(정수)
//  - 16bit→8bit: c8 = round(c16 / 257)
'use strict';

const U16 = 65535;

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function to8(c16) { return Math.round(c16 / 257); }            // Qt의 16→8bit
function rgbToHex(r, g, b) {
  const c = (n) => n.toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

// 8bit RGB -> Qt HSV {h:0..35999 or -1, s:0..65535, v:0..65535}
function rgbToHsv16(r8, g8, b8) {
  const r = r8 / 255, g = g8 / 255, b = b8 / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const v = Math.round(max * U16);
  if (delta === 0) return { h: -1, s: 0, v };
  const s = Math.round((delta / max) * U16);
  let hue;
  if (r === max) hue = (g - b) / delta;
  else if (g === max) hue = 2 + (b - r) / delta;
  else hue = 4 + (r - g) / delta;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { h: Math.round(hue * 100), s, v };
}

// Qt HSV(16bit) -> 8bit RGB
function hsv16ToRgb8(h, s16, v16) {
  const s = s16 / U16, v = v16 / U16;
  if (h < 0 || s16 === 0) { const c = to8(Math.round(v * U16)); return { r: c, g: c, b: c }; }
  const hh = h / 6000;            // (도*100)/100/60 = 섹터
  const i = Math.floor(hh), f = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  let r, g, b;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return { r: to8(Math.round(r * U16)), g: to8(Math.round(g * U16)), b: to8(Math.round(b * U16)) };
}

function lighter(hex, factor = 120) {
  const { r, g, b } = hexToRgb(hex);
  let { h, s, v } = rgbToHsv16(r, g, b);
  v = Math.trunc((v * factor) / 100);
  if (v > U16) { s = s - (v - U16); if (s < 0) s = 0; v = U16; }
  const o = hsv16ToRgb8(h, s, v);
  return rgbToHex(o.r, o.g, o.b);
}
function darker(hex, factor = 120) {
  const { r, g, b } = hexToRgb(hex);
  let { h, s, v } = rgbToHsv16(r, g, b);
  v = Math.trunc((v * 100) / factor);
  const o = hsv16ToRgb8(h, s, v);
  return rgbToHex(o.r, o.g, o.b);
}

module.exports = { lighter, darker, rgbToHsv16, hsv16ToRgb8, hexToRgb };
