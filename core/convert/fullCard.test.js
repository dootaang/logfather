// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/fullCard.test.js
// 골든 검증: 입력+설정 → 카드 전체 HTML이 Pro 1.2 실측과 일치(정규화 비교).
// 정규화 = 줄 끝 공백 제거 + 말미 빈 줄 제거 (의미 무손실; README 골든 비교 정책).
// 실행: node core/convert/fullCard.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const { convertText } = require('./convertText.js');

const G = path.join(__dirname, '..', '..', 'tests', 'golden');
const CASES = ['hello-test'];

const norm = (s) => s.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n+$/, '');

let failed = 0;
for (const id of CASES) {
  const input = fs.readFileSync(path.join(G, 'inputs', id + '.txt'), 'utf8');
  const settings = JSON.parse(fs.readFileSync(path.join(G, 'settings', id + '.json'), 'utf8'));
  const expected = norm(fs.readFileSync(path.join(G, 'expected', id + '.raw.html'), 'utf8'));
  const got = norm(convertText(input, settings));

  if (got === expected) { console.log(`✅ fullCard[${id}]: 카드 전체 일치(정규화)`); continue; }
  failed++;
  const el = expected.split('\n'), gl = got.split('\n');
  console.error(`❌ fullCard[${id}]: 불일치 (exp ${el.length}줄 / got ${gl.length}줄)`);
  let shown = 0;
  for (let i = 0; i < Math.max(el.length, gl.length) && shown < 14; i++) {
    if (el[i] !== gl[i]) {
      shown++;
      console.error(`  line ${i + 1}:`);
      console.error(`    exp(${(el[i] || '').length}): ${JSON.stringify(el[i])}`);
      console.error(`    got(${(gl[i] || '').length}): ${JSON.stringify(gl[i])}`);
    }
  }
}
process.exit(failed === 0 ? 0 : 1);
