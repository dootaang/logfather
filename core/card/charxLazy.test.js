// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/card/charxLazy.test.js
// charx 지연 색인(parseCharxIndex) + 단건 압축해제(decodeCharxAsset)가 즉시(parseCharx)와 동치인지 검증.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { parseCharx, parseCharxIndex, decodeCharxAsset } = require('./charx.js');
const { parseCard } = require('./parseCard.js');

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); n++; };

const FILE = path.join(__dirname, '..', '..', '캐릭터파일', 'CharX File.charx');
if (!fs.existsSync(FILE)) {
  console.log('  (CharX 샘플 없음 — 스킵)');
  console.log(`\ncharxLazy: ${n} assertions ✓ (skipped)`);
  process.exit(0);
}
const bytes = new Uint8Array(fs.readFileSync(FILE));

const eager = parseCharx(bytes);
const lazy = parseCharxIndex(bytes);

// ── 색인: 개수·이름·태그·존재·크기가 즉시와 일치, bytes는 아직 null ──
ok(lazy.lazy === true && lazy._bytes, 'parseCharxIndex: lazy 플래그 + _bytes 보관');
ok(lazy.assets.length === eager.assets.length, `색인 에셋 수 일치 (${lazy.assets.length})`);
ok(lazy.assets.every((a) => a.bytes === null), '색인 직후 모든 bytes=null(미해제)');
ok(lazy.assets.every((a, i) => a.name === eager.assets[i].name && a.tag === eager.assets[i].tag), '이름/태그 동일');
ok(lazy.assets.every((a, i) => a.found === eager.assets[i].found), 'found(존재 여부) 동일');
ok(lazy.assets.every((a, i) => a.size === eager.assets[i].size), '크기(원본 압축해제 크기)가 즉시와 동일');

// ── 단건 압축해제: 즉시와 바이트 완전 일치 ──
const k = lazy.assets.findIndex((a) => a.found);
const dec = decodeCharxAsset(bytes, lazy.assets[k]);
const ref = eager.assets[k].bytes;
ok(dec && ref && dec.length === ref.length, `decodeCharxAsset[${k}] 길이 일치 (${dec.length})`);
let same = dec.length === ref.length;
for (let i = 0; same && i < dec.length; i++) if (dec[i] !== ref[i]) same = false;
ok(same, '압축해제 바이트가 즉시와 바이트 동일');
ok(lazy.assets[k].bytes === dec, '결과가 asset.bytes에 캐시됨');
ok(lazy.assets.filter((_, i) => i !== k).some((a) => a.bytes === null), '나머지 에셋은 미해제 유지');

// ── parseCard 옵션 ──
ok(parseCard(bytes, 'x', { lazy: true }).lazy === true, 'parseCard({lazy:true}) → charx 색인');
ok(!parseCard(bytes, 'x').lazy && parseCard(bytes, 'x').assets[0].bytes, 'parseCard 기본 → 즉시(bytes 채워짐)');

console.log(`\ncharxLazy: ${n} assertions ✓`);
