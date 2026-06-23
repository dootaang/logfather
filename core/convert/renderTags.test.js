// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/renderTags.test.js
// 골든 검증: 태그 span이 Pro 1.2 실측 출력과 바이트 동일한지.
// 골든의 태그 span만 추출(display:inline-block 포함)해 비교 — 나레이션 span은 제외.
// 실행: node core/convert/renderTags.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const { renderTagSpan } = require('./renderTags.js');

const G = path.join(__dirname, '..', '..', 'tests', 'golden');
const CASES = ['r02-tag-styles', 'r02b-tag-vivid'];

function tagSpansFromHtml(html) {
  const all = html.match(/<span style="[^"]*">[^<]*<\/span>/g) || [];
  return all.filter((s) => s.includes('display:inline-block'));
}

let failed = 0, total = 0;
for (const id of CASES) {
  const settings = JSON.parse(fs.readFileSync(path.join(G, 'settings', id + '.json'), 'utf8'));
  const html = fs.readFileSync(path.join(G, 'expected', id + '.raw.html'), 'utf8');
  const golden = tagSpansFromHtml(html);

  settings.tags.forEach((tag, i) => {
    total++;
    const got = renderTagSpan(tag, i);
    if (got !== golden[i]) {
      failed++;
      console.error(`FAIL [${id}] tag ${i} (${tag.style})`);
      console.error(`  got: ${got}`);
      console.error(`  exp: ${golden[i]}`);
    }
  });
}

if (failed === 0) {
  console.log(`✅ renderTags: ${total}/${total} 골든 일치`);
  process.exit(0);
} else {
  console.error(`❌ renderTags: ${failed}/${total} 실패`);
  process.exit(1);
}
