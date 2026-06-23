// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/card/charx.test.js
// 골든 검증: 실제 charx(CharX File.charx, CCv3)에서 에셋 76개를 추출하는지.
// 실행: node core/card/charx.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const { parseCharx, assetDataUrl, autoMap } = require('./charx.js');

const CHARX = path.join(__dirname, '..', '..', '캐릭터파일', 'CharX File.charx');
let failed = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { failed++; console.error('  ✗ ' + msg); } };

if (!fs.existsSync(CHARX)) {
  console.error('SKIP: CharX File.charx 없음');
  process.exit(0);
}

const p = parseCharx(fs.readFileSync(CHARX));
ok(p.spec === 'chara_card_v3', `spec=chara_card_v3 (got ${p.spec})`);
ok(String(p.specVersion) === '3.0', `spec_version=3.0 (got ${p.specVersion})`);
ok(p.assets.length === 76, `에셋 76개 (got ${p.assets.length})`);
ok(p.assets.every((a) => a.found), `전부 zip에서 발견 (missing ${p.assets.filter((a) => !a.found).length})`);

const icon = p.assets[0];
ok(icon.type === 'icon' && icon.name === 'iconx' && icon.mime === 'image/png' && icon.size > 1000,
  `아이콘: iconx png ${icon.size}B`);

const happy = p.assets.find((a) => a.name === 'tarumaemaru.happy.webp');
ok(!!happy && happy.mime === 'image/webp' && happy.size > 1000, `tarumaemaru.happy.webp webp ${happy ? happy.size : 0}B`);
const url = happy ? assetDataUrl(happy) : null;
ok(!!url && url.startsWith('data:image/webp;base64,'), `happy dataURL = data:image/webp;base64,...`);

const m = autoMap(p);
ok(Object.keys(m.byName).length === 76, `byName 풀네임 매핑 76개 (got ${Object.keys(m.byName).length})`);
ok(m.collisions.length > 0, `충돌 감정태그 감지 (2캐릭터팩) = ${m.collisions.length}개`);
const chars = new Set(p.assets.filter((a) => a.name.includes('.')).map((a) => a.name.split('.')[0]));
ok(chars.has('tarumaemaru') && chars.has('hotarumaru'), `캐릭터 2팩 감지: ${[...chars].join(', ')}`);

if (failed === 0) { console.log('✅ charx: 에셋 추출 골든 통과'); process.exit(0); }
else { console.error(`❌ charx: ${failed} 실패`); process.exit(1); }
