// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/cardRegex.test.js
// 카드 표시 regex 추출/적용 + 에셋 CBS 치환 + 풀 파이프라인(실제 오키 아오이 모듈) 검증.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { extractRegexScripts, expandCardRegex, buildRegex, sanitizeRegexOut, isCatastrophic, escapeRegexLiteral } = require('./cardRegex.js');
const { resolveAssetCBS, convertText } = require('./convertText.js');
const { parseRisumCard } = require('../card/risum.js');
const { buildImageMappings, applyTagScheme } = require('../card/assets.js');

const ROOT = path.join(__dirname, '..', '..');
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); n++; };

// ── buildRegex: raw / /pat/flags ──
{
  ok(buildRegex('<x>').flags.includes('g'), 'raw 패턴은 전역(g) 기본');
  const r = buildRegex('/<x>/i');
  ok(r.flags.includes('i') && r.flags.includes('g'), '/pat/flags 형식 파싱(+g 보강)');
}

// ── 합성: editdisplay 적용 / 비표시 타입 스킵 / 깨진 정규식 무해 ──
{
  const scripts = [
    { in: '<aoiimg src="(.*?)">', out: "<div style=\"background-image:url('{{raw::$1}}')\"></div>", type: 'editdisplay' },
    { in: 'SECRET', out: 'X', type: 'editinput' }, // 비표시 타입 → 무시
    { in: '(', out: 'Y', type: 'editdisplay' },    // 깨진 정규식 → 스킵(throw 안 함)
  ];
  const out = expandCardRegex('hi <aoiimg src="aoi_happy"> SECRET', scripts);
  ok(out.includes("url('{{raw::aoi_happy}}')"), 'editdisplay: $1 치환 + out HTML 펼침');
  ok(out.includes('SECRET'), 'editinput 타입은 적용 안 됨');
  ok(expandCardRegex('', scripts) === '', '빈 입력 안전');
  ok(expandCardRegex('x', []) === 'x', '스크립트 없으면 항등');
}

// ── 보안: out 살균 / $n 만 치환 / ReDoS 패턴 스킵 ──
{
  const dirty = '<img src="$1"><script>steal()</script><div onclick="x" onerror=y>ok</div>';
  const clean = sanitizeRegexOut(dirty);
  ok(!/script/i.test(clean), '살균: <script> 제거');
  ok(!/onclick|onerror/i.test(clean), '살균: on* 이벤트 핸들러 제거');
  ok(clean.includes('<img src="$1">') && clean.includes('>ok</div>'), '살균: 정상 태그/그룹참조 보존');

  // XSS 시도 카드 → 추출 시 살균 → 펼친 결과에 실행 가능한 페이로드 없음(실제 흐름: extract→expand)
  const xssScripts = extractRegexScripts({ module: { regex: [{ in: '<e>', out: '<img src=x onerror=alert(1)><script>p()</script>', type: 'editdisplay' }] } });
  const xss = expandCardRegex('hi <e>', xssScripts);
  ok(!/onerror|<script/i.test(xss), 'XSS: 카드 out이 추출 시 살균되어 클립보드로 안 샘');

  // $&/$`/$' 는 주변 텍스트를 끌어오지 않음(리터럴 유지), $1 만 치환
  // native replace였다면 $&→'<x>', $`→'A', $'→'B' 가 끼어듦. 함수 replacer는 리터럴 보존.
  const spliced = expandCardRegex('A<x>B', [{ in: '<x>', out: "[$&|$1]", type: 'editdisplay' }]);
  ok(spliced.includes('[$&|$1]'), '$&/$1(범위밖) 리터럴 보존 — 주변 텍스트 스플라이스 없음');
  ok(!spliced.includes('[<x>'), '$& 가 매치 텍스트로 치환되지 않음');

  ok(isCatastrophic('(a+)+$') && isCatastrophic('(.*)*'), 'ReDoS: 중첩 수량자 감지');
  ok(!isCatastrophic('(abc)+') && !isCatastrophic('<aoiimg src="(.*?)">'), 'ReDoS: 정상 패턴 통과');
  const guarded = expandCardRegex('aaaaaaaaaaaaaaaaaaaa!', [{ in: '(a+)+$', out: 'X', type: 'editdisplay' }]);
  ok(typeof guarded === 'string', 'ReDoS: 위험 패턴은 스킵되어 멈추지 않음');
}

// ── escapeRegexLiteral: 관리실 "내 숨김 규칙" 간단모드(문자열 그대로 숨김) ──
{
  const raw = '호감도 +5 (Elsie) [55/100] ❤.*$';   // 정규식 메타문자 잔뜩
  const rule = { in: escapeRegexLiteral(raw), out: '', type: 'editdisplay' };
  const out = expandCardRegex('앞 ' + raw + ' 뒤 ' + raw, [rule]);
  ok(out === '앞  뒤 ', '간단모드: 메타문자 포함 문자열이 그대로(전부) 숨겨짐');
  ok(expandCardRegex('호감도 +55', [rule]) === '호감도 +55', '간단모드: 부분 불일치는 안 건드림(이스케이프 확인)');
  ok(new RegExp(escapeRegexLiteral('a\\b')).test('a\\b'), '백슬래시도 리터럴 매치');
}

// ── resolveAssetCBS: 알려진 에셋만 URL, {{img::}}는 보존 ──
{
  const map = { aoi_happy: 'data:image/webp;base64,AAA' };
  const t = resolveAssetCBS("url('{{raw::aoi_happy}}') {{raw::unknown}} {{img::aoi_happy}}", map);
  ok(t.includes("url('data:image/webp;base64,AAA')"), 'CBS: 알려진 에셋 → URL');
  ok(t.includes('{{raw::unknown}}'), 'CBS: 미지 이름 verbatim');
  ok(t.includes('{{img::aoi_happy}}'), 'CBS: {{img::}}는 건드리지 않음');
}

// ── 풀 파이프라인: 오키 아오이 모듈 로드 → regex 추출 → 그 카드 고유 태그가 카드에 반영 ──
{
  const parsed = parseRisumCard(fs.readFileSync(path.join(ROOT, '캐릭터파일', '모듈봇', '오키 아오이(Oki Aoi).risum')));
  applyTagScheme(parsed);
  const scripts = extractRegexScripts(parsed);
  ok(scripts.length === 1, `오키 모듈에서 regex 1개 추출 (배열참조 dedup; got ${scripts.length})`);
  ok(scripts[0].in.includes('aoiimg'), '추출된 regex가 <aoiimg> 커스텀 태그');

  // 웹 render 경로 재현: 입력을 먼저 펼쳐 매핑 스캔 → convertText(원본, cardRegex)
  const log = '오키가 미소지었다.\n\n<aoiimg src="aoi_angry">'; // aoi_angry = 실존 에셋
  const expanded = expandCardRegex(log, scripts);
  const mappings = buildImageMappings(parsed, { onlyTags: ['aoi_angry'] }); // 이름으로 dataURL
  const settings = {
    box: { showInnerBox: false, innerBoxColor: '#fff', shadowIntensity: 8 },
    profile: { showProfile: false },
    divider: { style: '그라데이션', thickness: 1, outerColor: '#000', innerColor: '#fff' },
    text: { useTextIndent: false, useTextSize: false, dialogColor: '#000', narrationColor: '#000', innerThoughtsColor: '#000', removeAsterisk: true, smartFormat: true, risuMarkers: false },
    tags: [], assetImage: { imageSize: 80, imageMargin: 10, useImageShadow: true },
    cardRegex: scripts,
  };
  const card = convertText(log, settings, mappings);
  ok(card.includes('<img src="data:image/webp'), '커스텀 태그 <aoiimg>가 아카호환 <img>(dataURL)로 반영됨');
  ok(!card.includes('background-image'), '배경이미지 div가 아닌 <img>로 변환됨(아카 업로드 가능)');
  ok(!card.includes('<aoiimg'), '원본 커스텀 태그는 남지 않음');
  ok(!card.includes('{{raw::'), '에셋 CBS는 전부 해소됨');
}

console.log(`✅ cardRegex: 카드 표시 regex 추출/적용 + CBS 통과 (${n} assertions)`);
