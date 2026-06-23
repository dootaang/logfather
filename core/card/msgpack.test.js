// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/card/msgpack.test.js — 최소 msgpack 디코더. 실행: node core/card/msgpack.test.js
'use strict';
const { decode } = require('./msgpack.js');
let failed = 0;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); else { failed++; console.error('  ✗ ' + m); } };
const U = (...a) => new Uint8Array(a);

ok(decode(U(0x05)) === 5, 'positive fixint');
ok(decode(U(0xff)) === -1, 'negative fixint');
ok(decode(U(0xc0)) === null, 'nil');
ok(decode(U(0xc2)) === false, 'false');
ok(decode(U(0xc3)) === true, 'true');
ok(decode(U(0xa3, 0x61, 0x62, 0x63)) === 'abc', 'fixstr "abc"');
// fixmap {a:1, b:[2,3]}
const m = decode(U(0x82, 0xa1, 0x61, 0x01, 0xa1, 0x62, 0x92, 0x02, 0x03));
ok(m && m.a === 1 && Array.isArray(m.b) && m.b[0] === 2 && m.b[1] === 3, 'fixmap + fixarray 중첩');
// bin8
const b = decode(U(0xc4, 0x03, 0x10, 0x20, 0x30));
ok(b instanceof Uint8Array && b.length === 3 && b[2] === 0x30, 'bin8');
// 정수 폭
ok(decode(U(0xcc, 0xff)) === 255, 'uint8 255');
ok(decode(U(0xcd, 0x01, 0x00)) === 256, 'uint16 256(빅엔디언)');
ok(decode(U(0xce, 0x00, 0x01, 0x00, 0x00)) === 65536, 'uint32 65536');
ok(decode(U(0xd0, 0xfb)) === -5, 'int8 -5');
ok(decode(U(0xd2, 0xff, 0xff, 0xff, 0xfb)) === -5, 'int32 -5');
// str8
ok(decode(U(0xd9, 0x02, 0x68, 0x69)) === 'hi', 'str8 "hi"');
// map16 헤더(1엔트리)
ok(decode(U(0xde, 0x00, 0x01, 0xa1, 0x6b, 0x2a)).k === 42, 'map16 {k:42}');
// UTF-8 멀티바이트
ok(decode(U(0xa3, 0xea, 0xb0, 0x80)) === '가', 'fixstr UTF-8 "가"');

if (failed === 0) { console.log('✅ msgpack: 통과'); process.exit(0); }
else { console.error(`❌ msgpack: ${failed} 실패`); process.exit(1); }
