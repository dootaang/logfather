// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/card/sourceRegex.test.js
// 소스 → 표시 정규식 추출. ★.risup = 실제 RisuAI 프리셋 포맷 왕복: 인코드(테스트) → 프로덕션 디코더로 추출.
// 실행: node core/card/sourceRegex.test.js
'use strict';
const { zipSync, gzipSync, strToU8 } = require('fflate');
const { DECODE_MAP } = require('./risum.js');
const { extractSourceRegex, extractSourceInfo, parseRisup, looksLikeRisup } = require('./sourceRegex.js');

let failed = 0;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); else { failed++; console.error('  ✗ ' + m); } };

// ── 테스트용 인코더(프로덕션 디코더를 실제로 태우려고 합성 .risup을 만든다) ──
const te = new TextEncoder();
function mpEnc(v, out) {
  out = out || [];
  if (v === null || v === undefined) { out.push(0xc0); return out; }
  if (typeof v === 'boolean') { out.push(v ? 0xc3 : 0xc2); return out; }
  if (typeof v === 'number') {
    if (Number.isInteger(v) && v >= 0 && v <= 127) out.push(v);
    else if (Number.isInteger(v) && v < 0 && v >= -32) out.push(v + 0x100);
    else { out.push(0xce, (v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); }
    return out;
  }
  if (typeof v === 'string') { const b = te.encode(v); if (b.length <= 31) out.push(0xa0 | b.length); else out.push(0xd9, b.length & 255); for (const x of b) out.push(x); return out; }
  if (v instanceof Uint8Array) { const n = v.length; if (n <= 255) out.push(0xc4, n); else out.push(0xc6, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255); for (const x of v) out.push(x); return out; }
  if (Array.isArray(v)) { if (v.length <= 15) out.push(0x90 | v.length); else out.push(0xdc, (v.length >> 8) & 255, v.length & 255); for (const x of v) mpEnc(x, out); return out; }
  const ks = Object.keys(v); if (ks.length <= 15) out.push(0x80 | ks.length); else out.push(0xde, (ks.length >> 8) & 255, ks.length & 255);
  for (const k of ks) { mpEnc(k, out); mpEnc(v[k], out); } return out;
}
const mp = (v) => new Uint8Array(mpEnc(v));
const ENC = new Uint8Array(256); for (let i = 0; i < 256; i++) ENC[DECODE_MAP[i]] = i;   // rpack 역맵(암호화)
const rpackEncode = (b) => { const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = ENC[b[i]]; return o; };
async function aesEnc(plain, pass) {
  const subtle = globalThis.crypto.subtle;
  const keyBytes = new Uint8Array(await subtle.digest('SHA-256', te.encode(pass)));
  const key = await subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  return new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12), tagLength: 128 }, key, plain));
}

(async () => {
  // ── .risup 왕복: 합성 → 프로덕션 디코더 추출 ──
  const regex = [
    { in: '<status>[\\s\\S]*?</status>', out: '', type: 'editdisplay', comment: 'hide status' },
    { in: '<x>(.*?)</x>', out: '<img src=x onerror=alert(1)><b>$1</b>', type: 'editoutput' },
    { in: 'foo', out: 'bar', type: 'editinput' },   // 모델용 — 제외돼야
  ];
  const inner = mp({ name: 'PSYCHE', regex });                          // 내부 preset msgpack
  const encBlob = await aesEnc(inner, 'risupreset');                     // AES-256-GCM(ct+tag)
  const outer = mp({ presetVersion: 2, type: 'preset', preset: encBlob }); // 외피 msgpack
  const risup = rpackEncode(gzipSync(outer));                            // gzip → rpack = .risup

  ok(looksLikeRisup(risup), '.risup 내용 판별(rpack→gzip 매직)');
  const raw = await parseRisup(risup);
  ok(raw.rules.length === 3, `parseRisup raw 3개(표시 필터 전) — 실제 ${raw.rules.length}`);
  ok(raw.name === 'PSYCHE', `parseRisup: preset 내부 이름 — ${raw.name}`);
  // extractSourceInfo: 내부 이름 + 표시 규칙(D)
  const info = await extractSourceInfo(risup, 'x.risup');
  ok(info.name === 'PSYCHE' && info.format === 'risup' && info.rules.length === 2, `extractSourceInfo(.risup): name·format·표시규칙 — ${info.name}/${info.format}/${info.rules.length}`);
  const rules = await extractSourceRegex(risup, 'x.risup');
  ok(rules.length === 2, `.risup: 표시 타입만(editinput 제외) → 2개 — 실제 ${rules.length}`);
  ok(rules.every((r) => r.type === 'editdisplay' || r.type === 'editoutput'), '.risup: 전부 표시 타입');
  ok(rules.some((r) => /<status>/.test(r.in)), '.risup: status 숨김 규칙 포함');
  ok(!/onerror|<\s*script/i.test(rules.map((r) => r.out).join(' ')), '.risup: out 살균(onerror/script 제거)');
  ok(rules.some((r) => r.out.indexOf('<img') >= 0 && r.out.indexOf('$1') >= 0), '.risup: 안전 태그·$n 보존');
  // 확장자 없이 내용으로도 판별
  ok((await extractSourceRegex(risup, 'noext')).length === 2, '확장자 없이 내용으로 .risup 판별');

  // ── 봇카드(charx) 경로: ZIP card.json의 extensions.risuai.customScripts ──
  const card = { spec: 'chara_card_v3', data: { name: 'C', extensions: { risuai: { customScripts: [
    { in: '<a>', out: 'A', type: 'editdisplay' }, { in: 'b', out: 'B', type: 'editinput' },
  ] } } } };
  const charx = zipSync({ 'card.json': strToU8(JSON.stringify(card)) });
  const cr = await extractSourceRegex(charx, 'c.charx');
  ok(cr.length === 1 && cr[0].out === 'A', '봇카드(charx): customScripts 표시만(editinput 제외)');

  // 규칙 0개 소스 → 빈 배열(무동작 보장)
  const empty = rpackEncode(gzipSync(mp({ presetVersion: 2, type: 'preset', preset: await aesEnc(mp({ name: 'E' }), 'risupreset') })));
  ok((await extractSourceRegex(empty, 'e.risup')).length === 0, '규칙 없는 .risup → 빈 배열');

  if (failed === 0) { console.log('✅ sourceRegex: 통과'); process.exit(0); }
  else { console.error(`❌ sourceRegex: ${failed} 실패`); process.exit(1); }
})().catch((e) => { console.error('❌ sourceRegex 예외:', e); process.exit(1); });
