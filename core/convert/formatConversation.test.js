// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/formatConversation.test.js
// 골든 검증: 대사(곡선따옴표 “...”) 경로가 Pro 1.2 실측과 일치하는지.
// 출처: RisuAI 로그 샘플에서 추출한 대사 줄 (tests/golden/expected/r01-dialogue.frag.html).
// 실행: node core/convert/formatConversation.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const { formatConversation } = require('./formatConversation.js');

const G = path.join(__dirname, '..', '..', 'tests', 'golden');
const id = 'r01-dialogue';
const input = fs.readFileSync(path.join(G, 'inputs', id + '.txt'), 'utf8');
const settings = JSON.parse(fs.readFileSync(path.join(G, 'settings', id + '.json'), 'utf8'));
const expected = fs.readFileSync(path.join(G, 'expected', id + '.frag.html'), 'utf8').replace(/\n$/, '');

const got = formatConversation(input, settings);

if (got === expected) {
  console.log('✅ formatConversation[대사]: 골든 일치');
  process.exit(0);
}
const el = expected.split('\n'), gl = got.split('\n');
console.error('❌ formatConversation[대사]: 불일치');
for (let i = 0; i < Math.max(el.length, gl.length); i++) {
  if (el[i] !== gl[i]) {
    console.error(`  line ${i + 1}:`);
    console.error(`    exp: ${JSON.stringify(el[i])}`);
    console.error(`    got: ${JSON.stringify(gl[i])}`);
  }
}
process.exit(1);
