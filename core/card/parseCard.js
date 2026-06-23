// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/card/parseCard.js
// 매직 바이트로 카드 포맷 자동 판별 → 적절한 파서. 모든 파서는 동일한 {spec,name,assets,card} 모양 반환.
//   .charx(zip PK) / .png(PNG sig, ccv3 tEXt) / .jpeg·.json(평문 JSON)
'use strict';
const { parseCharx, parseCharxIndex } = require('./charx.js');
const { parsePngCard, isPng } = require('./png.js');
const { parseJsonCard } = require('./json.js');
const { parseRisumCard, parseRisumIndex } = require('./risum.js');

function toBytes(x) { return x instanceof Uint8Array ? x : new Uint8Array(x); }

function detectFormat(b) {
  if (isPng(b)) return 'png';
  if (b[0] === 0x50 && b[1] === 0x4b) return 'charx';   // 'PK' zip (.charx / .module.charx)
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';     // JPEG SOI
  if (b[0] === 0x6f) return 'risum';                     // RPack 매직 'o' (.risum 모듈)
  return 'json';
}

// opts.lazy: risum 모듈을 색인만 하고 블롭은 필요 시 디코딩(대형 모듈 메모리 절약). 다른 포맷은 무시(즉시).
function parseCard(bytes, hintName, opts = {}) {
  const b = toBytes(bytes);
  const fmt = detectFormat(b);
  let parsed;
  if (fmt === 'png') parsed = parsePngCard(b);
  else if (fmt === 'charx') parsed = opts.lazy ? parseCharxIndex(b) : parseCharx(b);
  else if (fmt === 'risum') parsed = opts.lazy ? parseRisumIndex(b) : parseRisumCard(b);
  else parsed = parseJsonCard(b); // jpeg(평문 JSON) / json
  return Object.assign({ format: fmt, source: hintName || null }, parsed);
}

module.exports = { parseCard, detectFormat };
