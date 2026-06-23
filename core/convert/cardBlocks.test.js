// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/cardBlocks.test.js
// 기본 카드 다중 블록 = 블록마다 독립 카드 박스(세로 쌓기). 1블록(제목없음)=패리티 / 2+블록=박스 N개 +
// 다이어리식 번호 헤더 / 프로필 첫 박스만 / collapsed=<details> / 제목 escape / 빈 블록 가드.
// 실행: node core/convert/cardBlocks.test.js
'use strict';
const { convertText } = require('./convertText.js');
const { renderCardBlocks } = require('./cardBlocks.js');

let failed = 0;
const check = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { failed++; console.error('  ✗ ' + msg); } };
const count = (s, sub) => s.split(sub).length - 1;

const base = (over) => Object.assign({
  box: { showInnerBox: false, outerBoxColor: '#fff', innerBoxColor: '#f8f9fa', shadowIntensity: 8, useBoxBorder: false, boxBorderColor: '#e2e8f0', boxBorderThickness: 2, maxWidth: 600 },
  profile: { showProfile: false, showProfileImage: false, showBotName: false, showTags: false, showDivider: false, botName: 'BOTNAME_X', botNameColor: '#000', frameStyle: '배너', width: 96, height: 96, imageUrl: '' },
  divider: { style: '그라데이션', thickness: 1, outerColor: '#e2e8f0', innerColor: '#fff', solidColor: '#b8bacf' },
  text: { useTextIndent: false, textIndent: 20, useTextSize: false, textSize: 14, dialogColor: '#2d3748', dialogBold: true, dialogNewline: false, innerThoughtsColor: '#718096', innerThoughtsBold: false, narrationColor: '#4a5568', usePadding: false, removeAsterisk: false, convertEllipsis: false, smartFormat: false, risuMarkers: false },
  tags: [], assetImage: { imageSize: 100, imageMargin: 10, useImageBorder: false, imageBorderColor: '#000', useImageShadow: true },
  imageMappings: [], wordReplace: [], darkMode: false, cardTextColor: '', template: 'card', templateSettings: {}, userCardCss: '',
}, over || {});

// 1) 패리티: 블록 없음 vs 단일 블록(제목없음, 동일 내용) → 카드 HTML 동일.
const plain = convertText('나레이션 문장입니다.', base());
const s1 = base(); s1.templateSettings.card = { blocks: [{ title: '', subtitle: '', content: '나레이션 문장입니다.' }] };
const single = convertText('', s1);
check(plain === single, '단일 블록(제목없음) === 블록 없는 단일 입력 (패리티)');

// 2) 다중 블록 → 카드 박스 N개(세로 쌓기), <details> 없음(접기 안 함).
const s2 = base(); s2.templateSettings.card = { blocks: [
  { title: '1장', subtitle: '서막', content: '첫 블록 본문.' },
  { title: '2장', subtitle: '', content: '둘째 블록 본문.' },
]};
const multi = convertText('', s2);
check(count(multi, 'max-width:600px') === 2, '2블록 → 카드 박스 2개');
check(multi.indexOf('<details') < 0, '접기 안 한 블록은 <details> 없음(별도 박스)');
check(multi.includes('1장') && multi.includes('서막') && multi.includes('2장'), '제목/부제 헤더 출력');
check(multi.includes('첫 블록 본문') && multi.includes('둘째 블록 본문'), '각 블록 본문 포함');
check(multi.includes('display:table'), '다이어리식 번호 헤더(display:table) 사용');

// 3) 프로필은 첫 박스에만(반복 안 함).
const s3 = base({ profile: Object.assign(base().profile, { showProfile: true, showBotName: true }) });
s3.templateSettings.card = { blocks: [
  { title: 'A', subtitle: '', content: 'a' },
  { title: 'B', subtitle: '', content: 'b' },
]};
const withProf = convertText('', s3);
check(count(withProf, 'BOTNAME_X') === 1, '프로필 봇이름은 첫 박스에만 1회');

// 4) 제목 escape
const s4 = base(); s4.templateSettings.card = { blocks: [
  { title: '<img src=x onerror=alert(1)>', subtitle: '', content: 'a' }, { title: 'b', subtitle: '', content: 'b' },
]};
const escd = convertText('', s4);
check(escd.indexOf('<img src=x onerror') < 0 && escd.includes('&lt;img'), '섹션 제목 꺾쇠 escape');

// 5) 빈 블록 → ''
const s5 = base(); s5.templateSettings.card = { blocks: [{ title: '', subtitle: '', content: '   ' }] };
check(convertText('', s5) === '', '내용 없는 블록 → 빈 출력');

// 6) 전역 collapseAll → 모든 블록 <details>(헤더가 summary)
const s6 = base(); s6.templateSettings.card = { collapseAll: true, blocks: [
  { title: 'A', subtitle: '', content: 'a' }, { title: 'B', subtitle: '', content: 'b' },
]};
const col = convertText('', s6);
check(count(col, '<details') === 2 && col.includes('<summary'), 'collapseAll → 모든 블록 <details>+<summary>');
check(count(col, 'max-width:600px') === 2, '접기여도 박스 2개 유지');
// collapseAll 없으면 <details> 없음
const s6b = base(); s6b.templateSettings.card = { blocks: [{ title: 'A', subtitle: '', content: 'a' }, { title: 'B', subtitle: '', content: 'b' }] };
check(convertText('', s6b).indexOf('<details') < 0, 'collapseAll off → <details> 없음');

// 6.5) 역할 헤더: 라벨 치환 / 번호 모드 / 블록 제목 우선
const sR = base({ profile: Object.assign(base().profile, { botName: '칼라' }) });
sR.templateSettings.card = { userLabel: '주인공', charLabel: '히로인', blocks: [{ role: 'user', content: 'a' }, { role: 'char', content: 'b' }] };
const rh = convertText('', sR);
check(rh.includes('>주인공<') && rh.includes('>히로인<'), '역할 라벨 치환(유저/캐릭터 이름)');
const sN = base(); sN.templateSettings.card = { numbered: true, blocks: [{ role: 'user', content: 'a' }, { role: 'char', content: 'b' }] };
const rn = convertText('', sN);
check(rn.includes('>1<') && rn.includes('>2<') && !rn.includes('>나<'), '번호 모드: 1·2 (역할 라벨 대신)');
const sT = base(); sT.templateSettings.card = { blocks: [{ role: 'user', title: '프롤로그', content: 'a' }, { role: 'char', content: 'b' }] };
check(convertText('', sT).includes('>프롤로그<'), '블록 제목이 역할 라벨보다 우선');

// 7) renderCardBlocks 직접: 단일 제목없음 = 카드 1개(섹션 래핑 없음)
const r = renderCardBlocks([{ title: '', subtitle: '', content: 'x' }], base(), {});
check(count(r, 'max-width:600px') === 1 && r.indexOf('display:table') < 0, 'renderCardBlocks 단일 제목없음 = 카드 1개·헤더 없음');

if (failed === 0) { console.log('✅ cardBlocks: 통과'); process.exit(0); }
else { console.error(`❌ cardBlocks: ${failed} 실패`); process.exit(1); }
