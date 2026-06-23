// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/card/risumLazy.test.js
// risum 지연 색인(parseRisumIndex) + 단건 디코딩(decodeRisumAsset)이 즉시 디코딩과 동치인지 검증.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { parseRisumCard, parseRisumIndex, decodeRisumAsset } = require('./risum.js');
const { parseCard } = require('./parseCard.js');

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); n++; };

const FILE = path.join(__dirname, '..', '..', '캐릭터파일', '모듈봇', '오키 아오이(Oki Aoi).risum');
if (!fs.existsSync(FILE)) {
  console.log('  (오키 risum 샘플 없음 — 스킵)');
  console.log(`\nrisumLazy: ${n} assertions ✓ (skipped)`);
  process.exit(0);
}
const bytes = new Uint8Array(fs.readFileSync(FILE));

const eager = parseRisumCard(bytes);
const lazy = parseRisumIndex(bytes);

// ── 색인: 개수·이름·태그·존재 표시가 즉시 파싱과 일치, 단 bytes는 아직 null ──
ok(lazy.lazy === true && lazy._bytes, 'parseRisumIndex: lazy 플래그 + _bytes 보관');
ok(lazy.assets.length === eager.assets.length, `색인 에셋 수 일치 (${lazy.assets.length})`);
ok(lazy.assets.every((a) => a.bytes === null), '색인 직후 모든 bytes=null(미복호)');
ok(lazy.assets.every((a) => a.found === true), '색인 에셋 found=true(존재 알림)');
ok(lazy.assets.every((a, i) => a.name === eager.assets[i].name && a.tag === eager.assets[i].tag), '이름/태그가 즉시 파싱과 동일');
ok(lazy.assets.every((a, i) => a.size === eager.assets[i].size), '크기(=_len, rpack 길이보존)가 즉시와 동일');

// ── 단건 디코딩: 즉시 디코딩 바이트와 완전 일치 ──
const k = lazy.assets.findIndex((a) => a._len > 0);
const dec = decodeRisumAsset(bytes, lazy.assets[k]);
const ref = eager.assets[k].bytes;
ok(dec && ref && dec.length === ref.length, `decodeRisumAsset[${k}] 길이 일치 (${dec.length})`);
let same = dec.length === ref.length;
for (let i = 0; same && i < dec.length; i++) if (dec[i] !== ref[i]) same = false;
ok(same, '디코딩 바이트가 즉시 디코딩과 바이트 동일');
ok(lazy.assets[k].bytes === dec, '디코딩 결과가 asset.bytes에 캐시됨');

// ── 다른 에셋은 여전히 미복호(필요한 것만 디코딩) ──
const others = lazy.assets.filter((_, i) => i !== k);
ok(others.some((a) => a.bytes === null), '디코딩 안 한 에셋은 bytes=null 유지');

// ── parseCard 옵션: lazy=true → 색인, 기본 → 즉시 ──
ok(parseCard(bytes, 'x', { lazy: true }).lazy === true, 'parseCard({lazy:true}) → 색인 경로');
ok(!parseCard(bytes, 'x').lazy && parseCard(bytes, 'x').assets[0].bytes, 'parseCard 기본 → 즉시(bytes 채워짐)');

console.log(`\nrisumLazy: ${n} assertions ✓`);
