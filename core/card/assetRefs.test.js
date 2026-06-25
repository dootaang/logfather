// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/card/assetRefs.test.js — 공유 에셋 참조(dataURL ↔ {mime,b64}) 순수부 검증.
'use strict';
const assert = require('assert');
const { parseDataUrlImg, buildAssetDataUrl } = require('./assetRefs.js');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };

// 1) 정상 png dataURL 파싱
{
  const u = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const p = parseDataUrlImg(u);
  ok(p && p.mime === 'png', 'png mime 추출');
  ok(p && p.b64 === 'iVBORw0KGgoAAAANSUhEUg==', 'b64 추출');
}
// 2) 왕복 — parse → build = 원본 동일(바이트 보존)
{
  const u = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==';
  const p = parseDataUrlImg(u);
  ok(buildAssetDataUrl(p.mime, p.b64) === u, 'jpeg 왕복 동일');
}
// 3) webp/svg+xml 등 비표준 mime도 통과(이미지면)
{
  const u = 'data:image/webp;base64,UklGRhYAAABXRUJQ';
  const p = parseDataUrlImg(u);
  ok(p && p.mime === 'webp', 'webp mime');
  const u2 = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
  const p2 = parseDataUrlImg(u2);
  ok(p2 && p2.mime === 'svg+xml', 'svg+xml mime(+ 포함)');
  ok(buildAssetDataUrl(p2.mime, p2.b64) === u2, 'svg 왕복');
}
// 4) 이미지가 아니거나 base64 아님 → null(마커 유지 = 안 박음)
{
  ok(parseDataUrlImg('') === null, '빈 문자열 null');
  ok(parseDataUrlImg('{{img::세실리아_웃음}}') === null, '마커 텍스트 null');
  ok(parseDataUrlImg('data:audio/mp3;base64,AAAA') === null, '비이미지 null');
  ok(parseDataUrlImg('https://x/y.png') === null, '외부 URL null');
  ok(parseDataUrlImg('data:image/png;utf8,<svg>') === null, 'base64 아님 null');
  ok(parseDataUrlImg(null) === null, 'null 입력 null');
}
// 5) 앞뒤 공백 허용(trim)
{
  const p = parseDataUrlImg('  data:image/png;base64,AAAA  ');
  ok(p && p.b64 === 'AAAA', '공백 trim 후 파싱');
}

console.log(`✅ assetRefs: dataURL↔{mime,b64} 순수부 통과 (${n} assertions)`);
