// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/card/charxResolve.test.js
// 통합 검증: charx 에셋 추출 → 이미지 태그 매핑 → 본문의 {{img::이름}}이 data URL <img>로 치환.
// 이것이 "charx 넣으면 자동매핑 + 임베드" 전체 흐름의 증명.
// 실행: node core/card/charxResolve.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const { parseCharx, buildImageMappings } = require('./charx.js');
const { processImageTags } = require('../convert/processImageTags.js');

const CHARX = path.join(__dirname, '..', '..', '캐릭터파일', 'CharX File.charx');
if (!fs.existsSync(CHARX)) { console.error('SKIP: CharX File.charx 없음'); process.exit(0); }

const parsed = parseCharx(fs.readFileSync(CHARX));
// 필요한 태그만 data URL 생성(용량 절약)
const mappings = buildImageMappings(parsed, { onlyTags: ['iconx', 'tarumaemaru.happy.webp'] });
const style = { size: 100, margin: 10, useBorder: false, borderColor: '#000000', useShadow: true };

const log = '안녕 {{img::iconx}} 그리고 {{img::tarumaemaru.happy.webp}} 또 {{img::없는태그}} 끝';
const out = processImageTags(log, mappings, style);

let failed = 0;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); else { failed++; console.error('  ✗ ' + m); } };

ok(out.includes('src="data:image/png;base64,'), 'iconx → data:image/png 임베드');
ok(out.includes('src="data:image/webp;base64,'), 'happy.webp → data:image/webp 임베드');
ok(out.includes('alt="iconx"') && out.includes('alt="tarumaemaru.happy.webp"'), 'alt에 에셋 이름');
ok(out.includes('{{img::없는태그}}'), '미지 태그 verbatim 유지');
ok((out.match(/<img style=/g) || []).length === 2, '치환된 <img> 정확히 2개');
ok(out.startsWith('안녕 ') && out.endsWith(' 끝'), '본문 텍스트 보존');

if (failed === 0) { console.log('✅ charxResolve: charx 에셋 자동매핑+임베드 통과'); process.exit(0); }
else { console.error(`❌ charxResolve: ${failed} 실패`); process.exit(1); }
