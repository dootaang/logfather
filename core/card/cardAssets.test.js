// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/card/cardAssets.test.js — 전 포맷 에셋 지연 추출 + on-demand 복호. 실행: node core/card/cardAssets.test.js
'use strict';
const { zipSync, strToU8 } = require('fflate');
const { DECODE_MAP } = require('./risum.js');
const { parseCardAssets, cardAssetBytes } = require('./cardAssets.js');

let failed = 0;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); else { failed++; console.error('  ✗ ' + m); } };
const same = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
const ENC = new Uint8Array(256); for (let i = 0; i < 256; i++) ENC[DECODE_MAP[i]] = i;   // rpack 역맵(인코딩)
const rpackEncode = (b) => { const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = ENC[b[i]]; return o; };
const u32le = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const u32be = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, false); return b; };
const cat = (arrs) => { let len = 0; for (const a of arrs) len += a.length; const o = new Uint8Array(len); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };

// ── charx(zip): card.json + assets/other/0.png (지연) ──
const pic = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const card = { spec: 'chara_card_v3', data: { name: 'C', assets: [{ name: 'happy', uri: 'embeded://assets/other/0.png', ext: 'png', type: 'emotion' }] } };
const charx = zipSync({ 'card.json': strToU8(JSON.stringify(card)), 'assets/other/0.png': pic });
const cx = parseCardAssets(charx, 'c.charx');
ok(cx.format === 'charx' && cx.lazy === true, 'charx: 지연 인덱스');
ok(cx.assets.length === 1 && cx.assets[0].name === 'happy' && cx.assets[0].bytes === null, 'charx: 인덱스(이름·미복호)');
ok(same(cardAssetBytes(cx, cx.assets[0]), pic), 'charx: cardAssetBytes 지연 복호 = 원본');

// ── risum(RPack): [0x6f][ver][u32 mainLen][rpack(json)] [0x01][u32 len][rpack(asset)] [0x00] ──
const mAsset = new Uint8Array([9, 8, 7, 6, 5]);
const mjson = strToU8(JSON.stringify({ name: 'M', assets: [['pic.png', '', 'png']] }));
const risum = cat([new Uint8Array([0x6f, 0x00]), u32le(mjson.length), rpackEncode(mjson), new Uint8Array([0x01]), u32le(mAsset.length), rpackEncode(mAsset), new Uint8Array([0x00])]);
const rs = parseCardAssets(risum, 'm.risum');
ok(rs.format === 'risum' && rs.lazy === true, 'risum: 지연 인덱스(★옛 추출기 불가했던 포맷)');
ok(rs.assets.length === 1 && rs.assets[0].name === 'pic.png' && rs.assets[0].bytes === null, 'risum: 인덱스(미복호)');
ok(same(cardAssetBytes(rs, rs.assets[0]), mAsset), 'risum: cardAssetBytes RPack 지연 복호 = 원본');
ok(rs.assets[0].bytes !== null, 'risum: 복호 후 bytes 캐시');

// ── png(즉시): PNG_SIG + tEXt(ccv3) + tEXt(chara-ext-asset_:1) + IEND ──
const tEXt = (kw, dataStr) => { const body = cat([strToU8(kw), new Uint8Array([0]), strToU8(dataStr)]); return cat([u32be(body.length), strToU8('tEXt'), body, new Uint8Array([0, 0, 0, 0])]); };
const b64 = (u8) => Buffer.from(u8).toString('base64');
const pcard = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'P', assets: [{ name: 'face', uri: '__asset:1', ext: 'png', type: 'emotion' }] } };
const pimg = new Uint8Array([11, 22, 33, 44]);
const png = cat([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), tEXt('ccv3', b64(strToU8(JSON.stringify(pcard)))), tEXt('chara-ext-asset_:1', b64(pimg)), cat([u32be(0), strToU8('IEND'), new Uint8Array([0, 0, 0, 0])])]);
const pg = parseCardAssets(png, 'p.png');
ok(pg.format === 'png' && pg.assets.length === 1 && pg.assets[0].name === 'face', 'png: 에셋 추출');
ok(same(cardAssetBytes(pg, pg.assets[0]), pimg), 'png: cardAssetBytes 즉시 = 원본');

if (failed === 0) { console.log('✅ cardAssets: 통과'); process.exit(0); }
else { console.error(`❌ cardAssets: ${failed} 실패`); process.exit(1); }
