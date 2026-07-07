// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/card/parseCard.test.js
// 검증: 4개 실제 샘플 카드를 매직 바이트로 판별하고 에셋 추출.
//   타로PNG(CCv3 PNG, R13) / CharX·Cheongwon(charx) / 타로JPEG(평문 JSON, 에셋은 rpack 미해결)
// 실행: node core/card/parseCard.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const { parseCard, detectFormat } = require('./parseCard.js');
const { buildImageMappings } = require('./assets.js');
const { processImageTags } = require('../convert/processImageTags.js');

const DIR = path.join(__dirname, '..', '..', '캐릭터파일');
let failed = 0;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); else { failed++; console.error('  ✗ ' + m); } };
const read = (f) => fs.readFileSync(path.join(DIR, f));
const exists = (f) => fs.existsSync(path.join(DIR, f));

// 1) 타로PNG — CCv3 PNG, 76/76 (ccdefault: main 포함)
if (exists('타로PNG.png')) {
  const p = parseCard(read('타로PNG.png'), '타로PNG.png');
  ok(p.format === 'png' && p.spec === 'chara_card_v3', `타로PNG: png/chara_card_v3 (${p.format})`);
  ok(p.assets.length === 76 && p.assets.filter((a) => a.found).length === 76, `타로PNG: 76/76 추출 (found ${p.assets.filter((a) => a.found).length})`);
  ok(p.assets.find((a) => a.name === 'iconx').mime === 'image/png', `타로PNG: iconx png`);
  // PNG 에셋으로 이미지 태그 resolve
  const map = buildImageMappings(p, { onlyTags: ['tarumaemaru.happy.webp'] });
  const out = processImageTags('{{img::tarumaemaru.happy.webp}}', map, { size: 100, margin: 10, useBorder: false, borderColor: '#000', useShadow: true });
  ok(out.includes('src="data:image/webp;base64,'), `타로PNG: {{img::happy}} → data URL 임베드`);
} else console.error('  - SKIP 타로PNG.png 없음');

// 2) charx 두 종
for (const [f, name, n] of [['CharX File.charx', '타루', 76], ['Cheongwon Univ..charx', 'Cheongwon Univ.', 1586]]) {
  if (!exists(f)) { console.error(`  - SKIP ${f} 없음`); continue; }
  const p = parseCard(read(f), f);
  ok(p.format === 'charx' && p.name === name, `${f}: charx / name=${p.name}`);
  ok(p.assets.length === n && p.assets.every((a) => a.found), `${f}: ${n}/${n} 추출`);
}

// 3) 타로JPEG — JPEG 폴리글랏(그림 뒤 charx zip). 구버전은 JSON만 긁고 "에셋 바이트 미해결"이었으나
//    embeddedZipStart 도입 후 charx로 온전히 파싱 = 에셋 바이트까지 복호 가능(업그레이드).
if (exists('타로JPEG.jpeg')) {
  const p = parseCard(read('타로JPEG.jpeg'), '타로JPEG.jpeg');
  ok(p.format === 'charx' && p.spec === 'chara_card_v3' && p.name === '타루', `타로JPEG: 폴리글랏 → charx (name ${p.name})`);
  ok(p.assets.length === 76 && p.assets.every((a) => a.found), `타로JPEG: 76/76 에셋 바이트 해결 (구버전 미해결이던 것)`);
} else console.error('  - SKIP 타로JPEG.jpeg 없음');

// 3.5) 또래상담부 — JPEG 폴리글랏(.charx 이름이지만 실체=JPEG 그림+charx zip 부착, 공유용 내보내기)
if (exists('또래상담부 2.1.charx')) {
  const p = parseCard(read('또래상담부 2.1.charx'), '또래상담부 2.1.charx', { lazy: true });
  ok(p.format === 'charx' && p.spec === 'chara_card_v3', `또래상담부: JPEG 폴리글랏 → charx 인식 (${p.format})`);
  ok(p.assets.length === 1327 && p.assets.every((a) => a.found), `또래상담부: 1327/1327 색인 (found ${p.assets.filter((a) => a.found).length})`);
} else console.error('  - SKIP 또래상담부 2.1.charx 없음');

// 4) 모듈봇 — .risum(RPack) + .module.charx(zip)
const MOD = path.join(DIR, '모듈봇');
const mread = (f) => fs.readFileSync(path.join(MOD, f));
const mexists = (f) => fs.existsSync(path.join(MOD, f));
if (mexists('오키 아오이(Oki Aoi).risum')) {
  const p = parseCard(mread('오키 아오이(Oki Aoi).risum'), 'risum');
  ok(p.format === 'risum' && p.assets.length === 24 && p.assets.every((a) => a.found), `오키.risum: RPack 모듈 24/24 에셋 추출 (${p.assets.filter((a) => a.found).length})`);
  ok(p.assets[0].mime === 'image/webp', `오키.risum: 감정 스프라이트 webp`);
} else console.error('  - SKIP 오키.risum 없음');
if (mexists('Flandre1.1.module.charx')) {
  const p = parseCard(mread('Flandre1.1.module.charx'), 'flandre');
  ok(p.format === 'charx' && p.assets.length === 177 && p.assets.every((a) => a.found), `Flandre.module.charx: charx 모듈 177/177 (${p.assets.filter((a) => a.found).length})`);
} else console.error('  - SKIP Flandre.module.charx 없음');

if (failed === 0) { console.log('✅ parseCard: 카드 포맷 판별/추출 통과'); process.exit(0); }
else { console.error(`❌ parseCard: ${failed} 실패`); process.exit(1); }
