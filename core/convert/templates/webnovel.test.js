// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/templates/webnovel.test.js
// 웹소설형 출력 디자인 — 줄글 본문. ★색을 굽지 않고(리더가 제어) 테마안전 강조(currentColor)만 입힌다.
// 실행: node core/convert/templates/webnovel.test.js
'use strict';
const { convertText } = require('../convertText.js');
const { renderWebnovel } = require('./webnovel.js');

let failed = 0;
const check = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { failed++; console.error('  ✗ ' + msg); } };

const base = (over) => Object.assign({
  box: { showInnerBox: false, outerBoxColor: '#fff', innerBoxColor: '#f8f9fa', shadowIntensity: 8, useBoxBorder: false, boxBorderColor: '#e2e8f0', boxBorderThickness: 2, maxWidth: 600 },
  profile: { showProfile: false, showProfileImage: false, showBotName: false, showTags: false, showDivider: false, botName: '히로인', botNameColor: '#000', frameStyle: '배너', width: 96, height: 96, imageUrl: '' },
  divider: { style: '그라데이션', thickness: 1, outerColor: '#e2e8f0', innerColor: '#fff', solidColor: '#b8bacf' },
  text: { useTextIndent: false, textIndent: 20, useTextSize: false, textSize: 14, dialogColor: '#2d3748', dialogBold: true, dialogNewline: false, innerThoughtsColor: '#718096', innerThoughtsBold: false, narrationColor: '#4a5568', usePadding: false, removeAsterisk: false, convertEllipsis: false, smartFormat: false, risuMarkers: false },
  tags: [], assetImage: { imageSize: 100, imageMargin: 10, useImageBorder: false, imageBorderColor: '#000', useImageShadow: true },
  imageMappings: [], wordReplace: [], darkMode: false, cardTextColor: '', template: 'webnovel', templateSettings: {}, userCardCss: '',
}, over || {});

const wn = (cfg, input, maps) => { const s = base(); s.templateSettings.webnovel = cfg; return convertText(input || '', s, maps); };

// 1) 빈 입력 → ''
check(renderWebnovel('', base(), {}) === '', '내용 없음 → 빈 출력');

// 2) 래퍼 + 본문 포함
const out = wn({}, '“안녕” 하고 그녀가 말했다.');
check(out.includes('class="lp-webnovel"'), 'lp-webnovel 래퍼 출력');
check(out.includes('안녕') && out.includes('그녀가 말했다'), '본문 포함');

// 3) ★색을 굽지 않음 — 대사/나레이션 span 에 color:#... 없음(리더가 글자색 제어)
check(out.indexOf('color:#') < 0, '글자색을 굽지 않음(color:#... 없음 → currentColor 상속)');

// 4) 대사 강조 = 굵게
const bold = wn({ dialogEmphasis: 'bold' }, '“대사다”');
check(bold.includes('font-weight:bold'), "dialogEmphasis='bold' → font-weight:bold");
check(bold.indexOf('color:#') < 0, '굵게여도 고정색 없음');

// 5) 대사 강조 = 밑줄(currentColor — 테마안전)
const under = wn({ dialogEmphasis: 'underline' }, '“대사다”');
check(under.includes('border-bottom:0.08em solid currentColor'), "dialogEmphasis='underline' → currentColor 밑줄");

// 6) 대사 강조 = 형광펜(반투명 마커, color-mix currentColor)
const mark = wn({ dialogEmphasis: 'marker' }, '“대사다”');
check(mark.includes('background-color:color-mix(in srgb, currentColor 14%, transparent)'), "dialogEmphasis='marker' → currentColor 반투명 마커");

// 7) 속마음 이탤릭(기본 on, smart 모드 곡선따옴표 ‘…’)
const inner = wn({ innerItalic: true }, '‘이건 속마음’ 이라고 생각했다.');
check(inner.includes('font-style:italic'), '속마음 이탤릭(테마안전)');
const innerOff = wn({ innerItalic: false }, '‘이건 속마음’ 이라고 생각했다.');
check(innerOff.indexOf('font-style:italic') < 0, 'innerItalic=false → 이탤릭 없음');

// 8) 대사 줄바꿈(새 줄로)
const nl = wn({ dialogNewline: true }, '“대사다”');
check(nl.includes('margin-top:1em; margin-bottom:1em;'), 'dialogNewline → 대사 블록(새 줄)');

// 9) 문단 간격 노브(rem)
const gap = wn({ paraGap: 2.4 }, '첫 문단\n\n둘째 문단');
check(gap.includes('margin-bottom:2.4rem;'), 'paraGap → 문단 margin 치환');
check(gap.indexOf('margin-bottom:1.5rem;') < 0, '기본 1.5rem 잔재 없음');

// 10) 첫 줄 들여쓰기
const ind = wn({ textIndent: 24 }, '“대사다” 그리고 나레이션.');
check(ind.includes('text-indent:24px'), 'textIndent → text-indent 적용');

// 11) 이미지 토큰 매핑(엔진 경유)
const img = wn({}, '본문 {{img::happy}} 끝.', { happy: 'data:image/webp;base64,BBBB' });
check(img.includes('data:image/webp;base64,BBBB') && img.includes('<img'), '{{img::}} → 이미지 임베드');
// 매핑 없으면 토큰 보존(나중에 에셋 입히기가 채움)
const imgKeep = wn({}, '본문 {{img::none}} 끝.');
check(imgKeep.includes('{{img::none}}'), '매핑 없는 이미지 토큰은 본문에 보존');

// 12) messages(채팅 가져오기) → 줄글 합치기
const msgs = wn({ messages: [{ role: 'user', text: '안녕!' }, { role: 'char', text: '반가워.' }] });
check(msgs.includes('안녕!') && msgs.includes('반가워.'), 'messages 두 마디를 줄글로 합침');

// 13) 아카 안전: position/flex/gap/<style>/<script> 없음
check(out.indexOf('position:') < 0 && out.indexOf('display:flex') < 0 && out.indexOf('<style') < 0 && out.indexOf('<script') < 0, '아카 안전: position/flex/style/script 없음');

// ── 2단계: 장(章) 블록 + 챕터 구분선 ──
// 14) useBlocks=true → 블록별 본문 + 제목 챕터 구분선(가운데 제목+밑줄, currentColor)
const blk = wn({ useBlocks: true, blocks: [
  { title: '1장. 시작', content: '첫 장 본문.' },
  { title: '2장. 다음', content: '둘째 장 본문.' },
] });
check(blk.includes('1장. 시작') && blk.includes('2장. 다음'), '블록 제목(챕터) 출력');
check(blk.includes('첫 장 본문') && blk.includes('둘째 장 본문'), '블록별 본문 출력');
check(blk.includes('border-bottom:1px solid currentColor'), '챕터 제목 밑줄(currentColor — 테마안전)');
check(blk.indexOf('color:#') < 0, '블록 모드도 고정색 안 굽음');

// 15) sceneBreak 명시적 OFF → 구분선/기호 없는 깔끔한 프로즈(채팅 턴 분리용, 사용자가 끈 경우)
const blk2 = wn({ useBlocks: true, sceneBreak: false, blocks: [
  { title: '', content: '도입부.' },
  { title: '', content: '다음 장면.' },
] });
check(blk2.indexOf('※') < 0 && blk2.indexOf('✳') < 0, 'sceneBreak=false → 제목 없는 블록 사이 장식 없음(끈 선택 존중)');
check(blk2.includes('도입부') && blk2.includes('다음 장면'), '제목 없는 블록들 본문 모두 출력(턴 분리)');

// 15d) sceneBreak 미설정(기본) = 켜짐 → 제목 없는 인접 블록 사이에 ※ ※ ※
const blkDef = wn({ useBlocks: true, blocks: [
  { title: '', content: '도입부.' },
  { title: '', content: '다음 장면.' },
] });
check(blkDef.indexOf('※ ※ ※') >= 0, 'sceneBreak 미설정 = 기본 켜짐 → ※ ※ ※ 들어감');

// 15b) sceneBreak=true → 제목 없는 인접 블록 "사이"에만 ※ ※ ※(맨 앞 블록 앞에는 없음)
const sb = wn({ useBlocks: true, sceneBreak: true, blocks: [
  { title: '', content: '첫 장면.' },
  { title: '', content: '둘째 장면.' },
  { title: '', content: '셋째 장면.' },
] });
check((sb.match(/※ ※ ※/g) || []).length === 2, 'sceneBreak → 제목 없는 3블록 사이에 ※ ※ ※ 2개');
check(sb.indexOf('첫 장면') < sb.indexOf('※ ※ ※'), '맨 앞 블록 앞엔 장면 기호 없음(본문이 먼저)');
check(sb.indexOf('position:') < 0 && sb.indexOf('display:flex') < 0, '장면 기호도 아카 안전(position/flex 없음)');

// 15c) sceneBreak=true라도 제목 있는 블록은 챕터 구분선 유지, 그 앞엔 ※ 안 붙음
const sbT = wn({ useBlocks: true, sceneBreak: true, blocks: [
  { title: '', content: '도입.' },
  { title: '2장', content: '본문.' },
] });
check(sbT.includes('border-bottom:1px solid currentColor'), '제목 블록은 챕터 구분선 유지(sceneBreak 무관)');
check((sbT.match(/※ ※ ※/g) || []).length === 0, '제목 블록 앞엔 ※ 안 붙음(인접 제목없음 쌍 아님)');

// 16) useBlocks지만 blocks 비면 프로즈 폴백
const blkEmpty = wn({ useBlocks: true, blocks: [] }, '폴백 본문');
check(blkEmpty.includes('폴백 본문') && blkEmpty.indexOf('✳') < 0, 'useBlocks라도 blocks 비면 입력란 프로즈 폴백');

// 17) 블록 챕터 구분선도 아카 안전(position/flex 없음)
check(blk.indexOf('position:') < 0 && blk.indexOf('display:flex') < 0, '챕터 구분선 아카 안전');

// ── 테마 굽기(미리보기·리더·리치복사 일관, 아카에서 div의 background/color 생존) ──
// 18) theme 지정 → 래퍼 div에 배경+글자색 인라인으로 구움
const themed = wn({ theme: 'dark' }, '본문 한 줄');
check(themed.includes('background:#20242b') && themed.includes('color:#d7dce4'), "theme='dark' → 래퍼에 배경/글자색 구움");
check(themed.includes('class="lp-webnovel"'), '테마 굽기도 lp-webnovel 래퍼 유지');
// 19) theme 없으면 색 안 구움(리더 제어 하위호환)
const noTheme = wn({}, '본문 한 줄');
check(noTheme.indexOf('background:#') < 0, 'theme 없으면 배경 안 구움(리더가 제어)');
// 20) 형광펜 마커는 테마 잉크(currentColor)에 적응 → 다크 테마에서도 고정색 아님
const themedMark = wn({ theme: 'dark', dialogEmphasis: 'marker' }, '“대사다”');
check(themedMark.includes('currentColor'), '형광펜은 테마와 무관히 currentColor 기반(잉크 적응)');

// ── 3단계: 명명 CSS 디자인 base=webnovel 훅(B2) — 훅 OFF=골든 / 훅 ON=emit + flatten ──
// 21) ★골든: 일반 웹소설(custom-css 아님)은 훅 OFF → 구조/본문 lp- 클래스 없음(바이트 동일 보존)
const plainH = wn({ useBlocks: true, blocks: [{ title: '1장', content: '"안녕" 그가 말했다.' }] });
check(plainH.indexOf('class="lp-wn-chapter"') < 0 && plainH.indexOf('class="lp-line"') < 0 && plainH.indexOf('class="lp-dialog"') < 0, '훅 OFF(일반 웹소설): lp-wn-*/lp-line/lp-dialog 클래스 없음(골든)');
// 22) custom-css base=webnovel → 훅 ON: 구조(.lp-wn-chapter)·본문(.lp-dialog) emit + lp-webnovel 래퍼
const wh = base(); wh.template = 'custom-css'; wh.cssBase = 'webnovel'; wh.userCardCss = '.lp-dialog{ color:#1f6feb; }';
wh.templateSettings.webnovel = { useBlocks: true, blocks: [{ title: '1장', content: '"안녕" 그가 말했다.' }] };
const wout = convertText('', wh);
check(wout.includes('class="lp-wn-chapter"'), 'base=webnovel 훅 ON: .lp-wn-chapter emit');
check(wout.indexOf('lp-dialog') >= 0, 'base=webnovel 훅 ON: .lp-dialog 본문 훅 emit');
check(wout.includes('class="lp-webnovel"'), 'base=webnovel: lp-webnovel 래퍼 유지');
// 23) userCardCss가 flatten으로 인라인화(아카 생존) — .lp-dialog color가 요소 style로
check(/color:#1f6feb/.test(wout), 'base=webnovel: userCss(.lp-dialog)가 인라인화(flatten)');
// 24) 장면전환 훅 ON
const wsb = base(); wsb.template = 'custom-css'; wsb.cssBase = 'webnovel'; wsb.userCardCss = '';
wsb.templateSettings.webnovel = { useBlocks: true, blocks: [{ title: '', content: '도입.' }, { title: '', content: '다음.' }] };
check(convertText('', wsb).includes('class="lp-wn-scenebreak"'), 'base=webnovel 훅 ON: ※ 장면전환에 .lp-wn-scenebreak');

if (failed === 0) { console.log('✅ webnovel: 웹소설형(색 안 굽기·테마안전 강조·장 블록·CSS base 훅) 출력 통과'); process.exit(0); }
else { console.error(`❌ webnovel: ${failed} 실패`); process.exit(1); }
