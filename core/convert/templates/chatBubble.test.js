// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/templates/chatBubble.test.js
// 채팅형(말풍선) 출력 디자인 — 메시지 리스트 → 좌우 말풍선. 역할색·이름표·아바타·좌우정렬·아카 안전·폴백.
// 실행: node core/convert/templates/chatBubble.test.js
'use strict';
const { convertText } = require('../convertText.js');
const { renderChatBubble } = require('./chatBubble.js');

let failed = 0;
const check = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { failed++; console.error('  ✗ ' + msg); } };
const count = (s, sub) => s.split(sub).length - 1;

const base = (over) => Object.assign({
  box: { showInnerBox: false, outerBoxColor: '#fff', innerBoxColor: '#f8f9fa', shadowIntensity: 8, useBoxBorder: false, boxBorderColor: '#e2e8f0', boxBorderThickness: 2, maxWidth: 600 },
  profile: { showProfile: false, showProfileImage: false, showBotName: false, showTags: false, showDivider: false, botName: '히로인', botNameColor: '#000', frameStyle: '배너', width: 96, height: 96, imageUrl: '' },
  divider: { style: '그라데이션', thickness: 1, outerColor: '#e2e8f0', innerColor: '#fff', solidColor: '#b8bacf' },
  text: { useTextIndent: false, textIndent: 20, useTextSize: false, textSize: 14, dialogColor: '#2d3748', dialogBold: true, dialogNewline: false, innerThoughtsColor: '#718096', innerThoughtsBold: false, narrationColor: '#4a5568', usePadding: false, removeAsterisk: false, convertEllipsis: false, smartFormat: false, risuMarkers: false },
  tags: [], assetImage: { imageSize: 100, imageMargin: 10, useImageBorder: false, imageBorderColor: '#000', useImageShadow: true },
  imageMappings: [], wordReplace: [], darkMode: false, cardTextColor: '', template: 'chat', templateSettings: {}, userCardCss: '',
}, over || {});

const chat = (cfg, over) => { const s = base(over); s.templateSettings.chat = cfg; return convertText('', s); };

// 1) 빈 메시지 + 빈 입력 → ''
check(chat({ messages: [] }) === '', '메시지/입력 없음 → 빈 출력');

// 2) 2메시지 → 행 2개(말풍선) + 본문 포함
const two = chat({ messages: [{ role: 'user', text: '안녕!' }, { role: 'char', text: '반가워.' }] });
check(count(two, 'text-align:right') + count(two, 'text-align:left') >= 2, '메시지마다 행(text-align) 생성');
check(two.includes('안녕!') && two.includes('반가워.'), '두 메시지 본문 포함');

// 3) 좌우 정렬: 유저=오른쪽, 캐릭터=왼쪽(기본 align lr)
check(/text-align:right;[^]*안녕/.test(two), '유저 메시지 = 오른쪽 정렬');
check(/text-align:left;[^]*반가워/.test(two), '캐릭터 메시지 = 왼쪽 정렬');

// 4) align='left' → 둘 다 왼쪽(디코식)
const left = chat({ align: 'left', messages: [{ role: 'user', text: 'U' }, { role: 'char', text: 'C' }] });
check(count(left, 'text-align:right') === 0, "align='left' → 오른쪽 정렬 없음(둘 다 왼쪽)");

// 5) 역할별 말풍선 색
const colored = chat({ userColor: '#112233', charColor: '#445566', messages: [{ role: 'user', text: 'a' }, { role: 'char', text: 'b' }] });
check(colored.includes('background:#112233') && colored.includes('background:#445566'), '역할별 말풍선 배경색 적용');

// 6) 이름표: showName on → 이름 출력 / off → 없음
const named = chat({ userName: '주인공', charName: '칼라', messages: [{ role: 'user', text: 'a' }, { role: 'char', text: 'b' }] });
check(named.includes('주인공') && named.includes('칼라'), '이름표 출력(유저/캐릭터 표시 이름)');
const noName = chat({ showName: false, userName: '주인공', messages: [{ role: 'user', text: 'a' }] });
check(noName.indexOf('주인공') < 0, 'showName=false → 이름표 없음');
// charName 비면 profile.botName 폴백
const fallbackName = chat({ messages: [{ role: 'char', text: 'b' }] });
check(fallbackName.includes('히로인'), 'charName 비면 profile.botName 폴백');

// 7) 아바타: 설정 시 <img border-radius:50%>, 없으면 아바타 없음
const av = chat({ charAvatar: 'data:image/png;base64,AAAA', messages: [{ role: 'char', text: 'b' }] });
check(av.includes('data:image/png;base64,AAAA') && av.includes('border-radius:50%'), '아바타 이미지(원형) 렌더');
const noAv = chat({ messages: [{ role: 'char', text: 'b' }] });
check(noAv.indexOf('<img') < 0, '아바타 미설정 → 이미지 없음');
const avOff = chat({ showAvatar: false, charAvatar: 'data:image/png;base64,AAAA', messages: [{ role: 'char', text: 'b' }] });
check(avOff.indexOf('<img') < 0, 'showAvatar=false → 아바타 숨김');

// 8) 본문 엔진 동작: 대사("…") 변환 + 이미지 매핑
const sImg = base(); sImg.templateSettings.chat = { messages: [{ role: 'char', text: '"안녕" 하고 {{img::happy}} 웃었다.' }] };
const imgOut = convertText('', sImg, { happy: 'data:image/webp;base64,BBBB' });
check(imgOut.includes('data:image/webp;base64,BBBB') && imgOut.includes('<img'), '메시지 본문의 {{img::}} → 이미지 임베드(엔진 경유)');

// 9) 아카 안전: position/flex/gap/<style>/<script> 없음
const aka = chat({ charAvatar: 'data:image/png;base64,AAAA', messages: [{ role: 'user', text: 'a' }, { role: 'char', text: 'b' }] });
check(aka.indexOf('position:') < 0, '아카 안전: position 없음');
check(aka.indexOf('display:flex') < 0 && aka.indexOf('gap:') < 0, '아카 안전: flex/gap 없음');
check(aka.indexOf('<style') < 0 && aka.indexOf('<script') < 0, '아카 안전: <style>/<script> 없음');
check(aka.includes('display:inline-block'), '말풍선/아바타는 inline-block(아카 허용)');

// 10) 이름 escape
const escd = chat({ charName: '<b>x</b>', messages: [{ role: 'char', text: 'b' }] });
check(escd.indexOf('<b>x</b>') < 0 && escd.includes('&lt;b&gt;'), '표시 이름 꺾쇠 escape');

// 11) 폴백: 메시지 없고 입력만 → 캐릭터 한 마디
const sFb = base(); sFb.templateSettings.chat = { messages: [] };
const fb = convertText('입력란 본문입니다.', sFb);
check(fb.includes('입력란 본문입니다.') && fb.includes('display:inline-block'), '메시지 없으면 입력란을 말풍선 1개로 폴백');

// 12) renderChatBubble 직접 호출 = convertText 경로와 동일 본문
const direct = renderChatBubble('', base(), {});
check(direct === '', 'renderChatBubble 직접: 빈 → 빈 출력');

if (failed === 0) { console.log('✅ chatBubble: 채팅형 말풍선 출력 통과'); process.exit(0); }
else { console.error(`❌ chatBubble: ${failed} 실패`); process.exit(1); }
