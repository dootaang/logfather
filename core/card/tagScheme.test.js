// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/card/tagScheme.test.js
// 카드별 에셋 이름 관례 자동 감지(detectTagScheme/applyTagScheme) 검증 — 합성 + 실제 카드.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { detectTagScheme, tagFromScheme, applyTagScheme, baseName } = require('./assets.js');
const { parseCharx } = require('./charx.js');
const { parseRisumCard } = require('./risum.js');

const ROOT = path.join(__dirname, '..', '..');
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); n++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); console.log('  ✓ ' + msg + ` = ${JSON.stringify(a)}`); n++; };

// ── 합성: 세 관례 ──
{
  // 점: char.emotion (다중 캐릭터팩 — 공통 prefix 없음, 첫 점 뒤가 감정)
  const dot = detectTagScheme(['tarumaemaru.angry', 'hotarumaru.happy', 'tarumaemaru.sad']);
  eq(dot.sep, '.', '점 관례 구분자');
  eq(tagFromScheme('tarumaemaru.acting cute', dot), 'acting cute', '점: 첫 점 뒤(공백 포함) 추출');

  // 언더스코어 + 공통 접미사: CWU_X_Icon
  const us = detectTagScheme(['CWU_DayToNight_Icon', 'CWU_HeartMaster_Icon', 'CWU_LibraryFairy_Icon']);
  eq(us.sep, '_', '언더스코어 관례 구분자');
  eq(us.stripTrailing, 'Icon', '공통 접미사 감지');
  eq(tagFromScheme('CWU_DayToNight_Icon', us), 'DayToNight', '언더스코어: prefix+접미사 제거');

  // 네임스페이스(접미사 없음): aoi_emotion
  const ns = detectTagScheme(['aoi_angry', 'aoi_happy', 'aoi_crying']);
  eq(ns.sep, '_', '네임스페이스 구분자');
  eq(ns.stripTrailing, null, '공통 접미사 없음');
  eq(tagFromScheme('aoi_angry', ns), 'angry', '네임스페이스 prefix 제거');

  // 구분자 없음(넘버링 등) → 이름 그대로
  const none = detectTagScheme(['1', '2', '3']);
  eq(none.sep, null, '구분자 없으면 sep=null');
  eq(tagFromScheme('1', none), '1', '구분자 없으면 베이스 그대로');
}

// ── 실제 카드: 타루 charx(점) ──
{
  const p = parseCharx(fs.readFileSync(path.join(ROOT, '캐릭터파일', 'CharX File.charx')));
  applyTagScheme(p);
  const happy = p.assets.find((a) => a.name === 'tarumaemaru.happy.webp');
  ok(happy, '타루: tarumaemaru.happy.webp 존재');
  eq(happy.tag, 'happy', '타루: tag = happy (점 관례 보존)');
  const icon = p.assets.find((a) => a.type === 'icon');
  ok(icon && icon.tag === baseName(icon.name, icon.ext), '타루: 아이콘 tag는 이름 유지');
}

// ── 실제 카드: 청원고 charx(언더스코어 네임스페이스 CWU_) ──
// 구조가 CWU_<페르소나>_<감정/Icon> 이라 접미사가 균일하지 않음 → 네임스페이스 CWU_ 만 벗고
// 페르소나+구분은 보존(감정 스프라이트 CWU_DayToNight_admiring 등과의 구분에 필요 = 올바른 수준).
{
  const p = parseCharx(fs.readFileSync(path.join(ROOT, '캐릭터파일', 'Cheongwon Univ..charx')));
  applyTagScheme(p);
  eq(p.tagScheme.sep, '_', '청원고: 언더스코어 관례 감지');
  const a = p.assets.find((x) => x.name === 'CWU_DayToNight_Icon.png');
  ok(a, '청원고: CWU_DayToNight_Icon.png 존재');
  eq(a.tag, 'DayToNight_Icon', '청원고: tag = DayToNight_Icon (네임스페이스 CWU_ 만 제거)');
}

// ── 실제 모듈: 오키 아오이 risum(네임스페이스 aoi_) ──
{
  const p = parseRisumCard(fs.readFileSync(path.join(ROOT, '캐릭터파일', '모듈봇', '오키 아오이(Oki Aoi).risum')));
  applyTagScheme(p);
  eq(p.tagScheme.sep, '_', '오키: 언더스코어/네임스페이스 감지');
  const a = p.assets.find((x) => x.name === 'aoi_angry');
  ok(a, '오키: aoi_angry 존재');
  eq(a.tag, 'angry', '오키: tag = angry (aoi_ prefix 제거)');
}

console.log(`✅ tagScheme: 에셋 이름 관례 자동 감지 통과 (${n} assertions)`);
