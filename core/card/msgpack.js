// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/card/msgpack.js
// 최소 MessagePack 디코더(읽기 전용). RisuAI .risup preset 복호 결과(표준 msgpack)를 객체로 푼다.
//   범위: nil/bool/fixint/int/uint/float/str/bin/array/map/ext(표준). msgpackr "레코드 확장"은 .risup엔 없음(검증).
//   큰 64비트 정수는 Number로(정밀도 손실 허용 — preset 값은 작음). 브라우저·노드 공용(의존 0).
'use strict';

function decode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const td = new TextDecoder('utf-8');
  let pos = 0;

  const str = (n) => { const s = td.decode(u8.subarray(pos, pos + n)); pos += n; return s; };
  const bin = (n) => { const b = u8.subarray(pos, pos + n); pos += n; return b; };
  const arr = (n) => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = read(); return a; };
  const map = (n) => { const o = {}; for (let i = 0; i < n; i++) { const k = read(); o[k] = read(); } return o; };
  const ext = (n, t) => { const d = u8.subarray(pos, pos + n); pos += n; return { __ext: t, data: d }; };

  function read() {
    const c = u8[pos++];
    if (c < 0x80) return c;                 // positive fixint
    if (c >= 0xe0) return c - 0x100;        // negative fixint
    if (c <= 0x8f) return map(c & 0x0f);    // fixmap
    if (c <= 0x9f) return arr(c & 0x0f);    // fixarray
    if (c <= 0xbf) return str(c & 0x1f);    // fixstr
    switch (c) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: return bin(u8[pos++]);                                  // bin8
      case 0xc5: { const n = dv.getUint16(pos); pos += 2; return bin(n); }   // bin16
      case 0xc6: { const n = dv.getUint32(pos); pos += 4; return bin(n); }   // bin32
      case 0xc7: { const n = u8[pos++]; const t = dv.getInt8(pos++); return ext(n, t); }
      case 0xc8: { const n = dv.getUint16(pos); pos += 2; const t = dv.getInt8(pos++); return ext(n, t); }
      case 0xc9: { const n = dv.getUint32(pos); pos += 4; const t = dv.getInt8(pos++); return ext(n, t); }
      case 0xca: { const v = dv.getFloat32(pos); pos += 4; return v; }
      case 0xcb: { const v = dv.getFloat64(pos); pos += 8; return v; }
      case 0xcc: return u8[pos++];                                       // uint8
      case 0xcd: { const v = dv.getUint16(pos); pos += 2; return v; }    // uint16
      case 0xce: { const v = dv.getUint32(pos); pos += 4; return v; }    // uint32
      case 0xcf: { const v = dv.getBigUint64(pos); pos += 8; return Number(v); }   // uint64
      case 0xd0: return dv.getInt8(pos++);                              // int8
      case 0xd1: { const v = dv.getInt16(pos); pos += 2; return v; }    // int16
      case 0xd2: { const v = dv.getInt32(pos); pos += 4; return v; }    // int32
      case 0xd3: { const v = dv.getBigInt64(pos); pos += 8; return Number(v); }   // int64
      case 0xd4: case 0xd5: case 0xd6: case 0xd7: case 0xd8: {          // fixext 1/2/4/8/16
        const n = 1 << (c - 0xd4); const t = dv.getInt8(pos++); return ext(n, t);
      }
      case 0xd9: return str(u8[pos++]);                                 // str8
      case 0xda: { const n = dv.getUint16(pos); pos += 2; return str(n); }   // str16
      case 0xdb: { const n = dv.getUint32(pos); pos += 4; return str(n); }   // str32
      case 0xdc: { const n = dv.getUint16(pos); pos += 2; return arr(n); }   // array16
      case 0xdd: { const n = dv.getUint32(pos); pos += 4; return arr(n); }   // array32
      case 0xde: { const n = dv.getUint16(pos); pos += 2; return map(n); }   // map16
      case 0xdf: { const n = dv.getUint32(pos); pos += 4; return map(n); }   // map32
    }
    throw new Error('msgpack: unknown byte 0x' + (c == null ? '?' : c.toString(16)) + ' @' + (pos - 1));
  }
  return read();
}

module.exports = { decode };
