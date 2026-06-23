// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/card/cardEncode.test.js — 카드 포맷 변환(쓰기) 라운드트립: 인코드 → parseCard 재해독 → 데이터·에셋 보존.
'use strict';
const { zipSync, strToU8 } = require('fflate');
const { parseCard } = require('./parseCard.js');
const { encodeJson, encodeCharx, encodePng, pickPngBase, crc32 } = require('./cardEncode.js');

let failed = 0;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); else { failed++; console.error('  ✗ ' + m); } };
const same = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
const u32be = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, false); return b; };
const cat = (arrs) => { let len = 0; for (const a of arrs) len += a.length; const o = new Uint8Array(len); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };
const SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const minPng = cat([SIG, u32be(0), strToU8('IEND'), u32be(crc32(strToU8('IEND')))]);   // 최소 유효 PNG(sig+IEND)
const happy = new Uint8Array([10, 20, 30, 40, 50]);

// 합성 charx(소스): card.json + assets/0.png(main=minPng) + assets/1.png(happy)
const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'TestCard', description: '설명 보존', assets: [
  { name: 'main', uri: 'embeded://assets/0.png', ext: 'png', type: 'icon' },
  { name: 'happy', uri: 'embeded://assets/1.png', ext: 'png', type: 'emotion' },
] } };
const charx = zipSync({ 'card.json': strToU8(JSON.stringify(card)), 'assets/0.png': minPng, 'assets/1.png': happy });
const parsed = parseCard(charx, 'src.charx');
const getBytes = (a) => a.bytes;
ok(parsed.assets.length === 2 && same(parsed.assets[1].bytes, happy), '소스 charx 파싱(에셋 2)');

// → CharX 라운드트립
const cx = parseCard(encodeCharx(parsed, getBytes), 'out.charx');
ok((cx.card.data.name) === 'TestCard' && cx.card.data.description === '설명 보존', 'charx: 카드 데이터(이름·설명) 보존');
ok(cx.assets.length === 2 && same(cx.assets[1].bytes, happy), 'charx: 에셋 바이트 보존');

// → PNG 라운드트립
const base = pickPngBase(parsed, getBytes);
ok(!!base, 'PNG 베이스(main PNG) 선택됨');
const png = encodePng(parsed, base, getBytes);
const pg = parseCard(png, 'out.png');
ok(pg.format === 'png' && pg.card.data.name === 'TestCard', 'png: 카드 데이터 보존');
ok(pg.assets.some((a) => a.name === 'happy' && same(a.bytes, happy)), 'png: 추가 에셋(happy) 바이트 보존');

// → JSON(self-contained data: URI)
const jbytes = encodeJson(parsed, getBytes);
const jobj = JSON.parse(Buffer.from(jbytes).toString('utf-8'));
ok(jobj.data.name === 'TestCard' && jobj.data.description === '설명 보존', 'json: 카드 데이터 보존');
ok(/^data:image\/png;base64,/.test(jobj.data.assets[1].uri), 'json: 에셋 data: URI 인라인');

if (failed === 0) { console.log('✅ cardEncode: 통과'); process.exit(0); }
else { console.error(`❌ cardEncode: ${failed} 실패`); process.exit(1); }
