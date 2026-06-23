// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/emphasisBox.test.js
// Pro2 추가 기능: ① 아스테리스크 강조(*기울임*/**굵게**, 옵션) ② 박스 최대 너비 커스텀.
// 둘 다 기본값(asteriskEmphasis=false, maxWidth=600)이면 기존 동작과 동일(파리티).
'use strict';
const assert = require('assert');
const { convertText } = require('./convertText.js');
const { parseBundle } = require('../preset/bundle.js');

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); n++; };
const base = () => parseBundle({}).settings; // 전체 기본 settings(살균 통과)

// ── 아스테리스크 강조 ──
{
  const s = base(); s.text.asteriskEmphasis = true;
  const out = convertText('그는 *조용히* 웃었다 **정말로**.', s);
  ok(out.includes('font-style:italic'), '*기울임* → italic 스타일 적용');
  ok(out.includes('font-weight:bold'), '**굵게** → bold 스타일 적용');
  ok(out.includes('조용히') && out.includes('정말로'), '강조 텍스트 내용 보존');
}
{
  const s = base(); s.text.asteriskEmphasis = false; s.text.removeAsterisk = true;
  const out = convertText('그는 *조용히* 웃었다.', s);
  ok(out.indexOf('*') < 0, '강조 off + 별표제거 on → 별표 사라짐');
  ok(!out.includes('font-style:italic'), '강조 off → italic 스타일 없음(파리티)');
}
{
  // 공백 낀 별표(곱셈 등)는 강조하지 않음 — 양끝 비공백 쌍만
  const s = base(); s.text.asteriskEmphasis = true; s.text.removeAsterisk = false;
  const out = convertText('값은 2 * 3 이고 *진짜* 중요.', s);
  ok(out.includes('font-style:italic'), '같은 줄의 *진짜*는 강조됨');
  ok(/2\s*\*\s*3/.test(out) === false ? true : out.indexOf('2 ') >= 0, '곱셈 2 * 3은 강조 span으로 안 바뀜');
  ok(!/font-style:italic;">[^<]*2 /.test(out), '곱셈 별표가 italic으로 오변환되지 않음');
}

// ── 박스 최대 너비 ──
{
  const s = base(); // 기본 maxWidth=600
  ok(convertText('안녕', s).includes('max-width:600px'), '기본 박스 너비 600px(파리티)');
}
{
  const s = base(); s.box.maxWidth = 900;
  const out = convertText('안녕', s);
  ok(out.includes('max-width:900px'), '박스 최대 너비 커스텀(900px) 반영');
  ok(!out.includes('max-width:600px'), '커스텀 시 600px 카드 박스 사라짐');
}
{
  // 살균: 범위 밖 값은 clamp(300~1200)
  const r = parseBundle({ settings: { box: { maxWidth: 99999 } } });
  ok(r.settings.box.maxWidth === 1200, 'maxWidth 9999 → 1200으로 clamp');
  const r2 = parseBundle({ settings: { box: { maxWidth: 50 } } });
  ok(r2.settings.box.maxWidth === 300, 'maxWidth 50 → 300으로 clamp');
}

console.log(`emphasisBox: ${n} assertions ✓`);
