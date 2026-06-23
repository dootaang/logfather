// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/smartInnerThoughts.test.js
// Pro 2 스마트 속마음 스펙 테스트 (옛 골든 없음 — 우리가 정의하는 새 동작).
// 검증: ① 대사 없는 줄/대사 뒤에서도 속마음 인식  ② ‘…’(U+2018/U+2019) 인식
//        ③ 축약형 don’t/it’s(U+2019) 오작동 없음  ④ parity 모드는 옛날대로 속마음 못 잡음(대비).
// 실행: node core/convert/smartInnerThoughts.test.js
'use strict';
const { formatConversation } = require('./formatConversation.js');

const baseText = {
  useTextIndent: true, textIndent: 20, useTextSize: true, textSize: 14,
  dialogColor: '#2d3748', dialogBold: true, dialogNewline: true,
  innerThoughtsColor: '#718096', innerThoughtsBold: false,
  narrationColor: '#4a5568', usePadding: true, removeAsterisk: false, convertEllipsis: false,
};
const smart = (extra = {}) => ({ text: { ...baseText, smartFormat: true, ...extra } });
const parity = (extra = {}) => ({ text: { ...baseText, smartFormat: false, ...extra } });

const D = (d) => `<div style="margin-top:1em; margin-bottom:1em;"><span style="color:#2d3748; font-weight:bold; font-size:14px;">${d}</span></div>`;
const I = (t) => `<span style="color:#718096;  font-size:14px;">${t}</span>`;
const N = (t) => `<span style="color:#4a5568; font-size:14px;">${t}</span>`;
const LINE = (inner) => `<div style="margin-bottom:1rem; text-indent:20px">${inner}</div>`;

const cases = [
  {
    name: 'A: 대사 없는 줄의 속마음 (parity는 못 잡음)',
    input: '‘이건 함정이야.’ 그녀는 생각했다.',
    settings: smart(),
    expect: LINE(I('‘이건 함정이야.’') + N(' 그녀는 생각했다.')),
  },
  {
    name: 'B: 대사 뒤의 속마음 (parity는 못 잡음)',
    input: '“가자.” ‘정말 괜찮을까.’',
    settings: smart(),
    expect: LINE(D('“가자.”') + I('‘정말 괜찮을까.’')),
  },
  {
    name: 'C: 축약형 don’t/it’s 오작동 없음',
    input: 'don’t worry, it’s ‘the plan’ now',
    settings: smart(),
    expect: LINE(N('don’t worry, it’s ') + I('‘the plan’') + N(' now')),
  },
  {
    name: 'D(대비): parity 모드는 속마음을 평범한 나레이션으로',
    input: '‘이건 함정이야.’ 그녀는 생각했다.',
    settings: parity(),
    expect: LINE(N('‘이건 함정이야.’ 그녀는 생각했다.')),
  },
];

let failed = 0;
for (const c of cases) {
  const got = formatConversation(c.input, c.settings);
  if (got === c.expect) { console.log(`✅ ${c.name}`); }
  else { failed++; console.error(`❌ ${c.name}`); console.error(`   got: ${got}`); console.error(`   exp: ${c.expect}`); }
}
process.exit(failed === 0 ? 0 : 1);
