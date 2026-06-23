// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/color/qtColor.test.js
// 골든 검증: Pro 1.2(PyQt6 QColor)가 실제로 낸 색을 그대로 재현하는지.
// 출처: tests/golden/COLOR_MATH.md (Pro 1.2 실측 캡처).
// 실행: node core/color/qtColor.test.js
'use strict';
const { lighter, darker } = require('./qtColor.js');

// [기준색, lighter(120) 정답, darker(120) 정답]
const GOLDEN = [
  ['#cbd5e0', '#f5faff', '#a9b1bb'], // r02-tag-styles (연한 회청, V 한계 clamp 케이스)
  ['#e74c3c', '#ff6858', '#c03f32'], // r02b-tag-vivid (진한 빨강, 채도 깎임 케이스)
];

let failed = 0;
for (const [base, gl, gd] of GOLDEN) {
  const l = lighter(base, 120).toLowerCase();
  const d = darker(base, 120).toLowerCase();
  if (l !== gl) { failed++; console.error(`FAIL lighter(${base})=${l} expected ${gl}`); }
  if (d !== gd) { failed++; console.error(`FAIL darker(${base})=${d} expected ${gd}`); }
}

if (failed === 0) {
  console.log(`✅ qtColor: ${GOLDEN.length * 2}/${GOLDEN.length * 2} 골든 일치`);
  process.exit(0);
} else {
  console.error(`❌ qtColor: ${failed} 실패`);
  process.exit(1);
}
