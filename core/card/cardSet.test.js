// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/card/cardSet.test.js
// 검증: "에셋없는 원본 charx + 에셋만 있는 모듈" 세트 — 둘을 파싱해 매핑 합쳐 로그 변환.
// 668MB 모듈을 다루므로 기본 npm test에서 분리(npm run test:heavy). 선택 디코드로 메모리 절약.
// 실행: node --max-old-space-size=4096 core/card/cardSet.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const { parseCard } = require('./parseCard.js');
const { parseRisumCard } = require('./risum.js');
const { buildImageMappings } = require('./assets.js');
const { processImageTags } = require('../convert/processImageTags.js');

const D = path.join(__dirname, '..', '..', '캐릭터파일', '청원고');
const CHARX = path.join(D, 'Cheongwon High School.charx');
const RISUM = path.join(D, '🏫Cheongwon High School v1.3.2.risum');
if (!fs.existsSync(CHARX) || !fs.existsSync(RISUM)) { console.error('SKIP: 청원고 세트 파일 없음'); process.exit(0); }

let failed = 0;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); else { failed++; console.error('  ✗ ' + m); } };

const cx = parseCard(fs.readFileSync(CHARX));
ok(cx.format === 'charx' && cx.assets.length > 0 && cx.assets.every((a) => a.found), `원본 charx: ${cx.assets.length} 에셋 전부 추출`);

const wantSprite = 'boreum_casual_angry.avif';
const mod = parseRisumCard(fs.readFileSync(RISUM), { onlyTags: [wantSprite] });
ok(mod.assets.length > 1000, `모듈: ${mod.assets.length} 에셋 목록 (namespace ${mod.namespace})`);
const decoded = mod.assets.filter((a) => a.found).length;
ok(decoded === 1, `선택 디코드: 필요한 1개만 디코드 (전체 디코드 회피) — ${decoded}`);
const sp = mod.assets.find((a) => a.name === wantSprite);
ok(sp && sp.found && sp.mime === 'image/avif', `스프라이트 ${wantSprite} avif 추출`);

// 세트 합치기 → 로그 변환
const charxIcon = cx.assets.find((a) => a.found).name;
const merged = Object.assign({}, buildImageMappings(cx, { onlyTags: [charxIcon] }), buildImageMappings(mod, { onlyTags: [wantSprite] }));
const out = processImageTags(`{{img::${charxIcon}}} {{img::${wantSprite}}}`, merged, { size: 100, margin: 10, useBorder: false, borderColor: '#000', useShadow: true });
ok(out.includes('data:image/png;base64,'), '합친 매핑: charx 아이콘(png) 임베드');
ok(out.includes('data:image/avif;base64,'), '합친 매핑: 모듈 스프라이트(avif) 임베드');

if (failed === 0) { console.log('✅ cardSet: charx+모듈 세트 합치기 통과'); process.exit(0); }
else { console.error(`❌ cardSet: ${failed} 실패`); process.exit(1); }
