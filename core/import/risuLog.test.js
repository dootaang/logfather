// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/import/risuLog.test.js
// RisuAI 채팅 export 파서 + 화 나누기. 실행: node core/import/risuLog.test.js
'use strict';
const { parseRisuLog, charFromFileName, splitMessages, stripGigaTrans } = require('./risuLog.js');

let failed = 0;
const check = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { failed++; console.error('  ✗ ' + msg); } };

// 파일명 → 캐릭터명
check(charFromFileName('Calla_2026-06-17T083021281Z_chat.json') === 'Calla', '파일명에서 캐릭터명 슬라이스');
check(charFromFileName('타루마에마루_2026-01-02T0000Z_chat.json') === '타루마에마루', '한글 캐릭터명');
check(charFromFileName('weird.json') === 'weird', '패턴 없으면 베이스명');

// risuChat(단일)
const single = { type: 'risuChat', ver: 2, data: { name: 'Chat 1', message: [
  { role: 'user', data: '안녕' }, { role: 'char', data: '반가워' }, { role: 'user', data: '  ' /*공백 제거*/ }, { role: 'char', data: '잘 지냈어?' },
] } };
const r = parseRisuLog(single, 'Bot_2026-06-17T0Z_chat.json');
check(r.char === 'Bot', 'risuChat char');
check(r.chats.length === 1 && r.chats[0].messages.length === 3, '빈 메시지 제외 후 3개');
check(r.chats[0].messages[0].role === 'user' && r.chats[0].messages[0].text === '안녕', '첫 메시지 role/text');
check(r.chats[0].messages[1].role === 'char', 'char role 보존');

// risuAllChats(여러 채팅)
const allc = { type: 'risuAllChats', ver: 2, data: [
  { name: 'A', message: [{ role: 'user', data: 'x' }] },
  { name: 'B', message: [{ role: 'char', data: 'y' }, { role: 'user', data: 'z' }] },
] };
const ra = parseRisuLog(allc, 'X_chat.json');
check(ra.chats.length === 2 && ra.chats[1].messages.length === 2, 'risuAllChats 다중 채팅');

// 화 나누기
const msgs = Array.from({ length: 25 }, (_, i) => ({ role: i % 2 ? 'char' : 'user', text: 't' + i }));
const byCount = splitMessages(msgs, 10, 'count');
check(byCount.length === 3 && byCount[0].length === 10 && byCount[2].length === 5, 'count: 10개씩 → 3화(10,10,5)');
const byTotal = splitMessages(msgs, 5, 'total');
check(byTotal.length === 5, 'total: 총 5화');

// 비정상 입력
check(parseRisuLog(null, 'a.json').chats.length === 0, 'null → 빈 chats');
check(parseRisuLog({ foo: 1 }, 'a.json').chats.length === 0, '메시지 없으면 빈 chats');

// GigaTrans 표시 마커 정규화(가져오기 상호운용) — 번역문만 남기고 원문·구분자·컨트롤 제거. 마커 없으면 무변경. 유실 0.
check(stripGigaTrans('안녕하세요\n<GT-SEP/>\n<GigaTrans>Hello there</GigaTrans>\n<GT-CTRL data="x"/>') === '안녕하세요', 'GigaTrans: 번역문만 남김');
check(stripGigaTrans('그냥 평범한 메시지') === '그냥 평범한 메시지', 'GigaTrans: 마커 없으면 무변경');
check(stripGigaTrans('<GigaTrans>원문만</GigaTrans>') === '원문만', 'GigaTrans: 번역 비면 원문 보존(유실 0)');
check(stripGigaTrans('번역<GT-SEP/><GigaTrans>orig</GigaTrans><GT-CTRL a/><GT-CTRL b/>') === '번역', 'GigaTrans: GT-CTRL 여러 개·구분자 제거');
check(stripGigaTrans('') === '' && stripGigaTrans(null) === '', 'GigaTrans: 빈/널 입력 안전');
const gt = parseRisuLog({ type: 'risuChat', data: { message: [{ role: 'char', data: '안녕\n<GT-SEP/>\n<GigaTrans>Hi</GigaTrans>\n<GT-CTRL/>' }, { role: 'user', data: '평범' }] } }, 'G_chat.json');
check(gt.chats[0].messages[0].text === '안녕' && gt.chats[0].messages[1].text === '평범', 'parseRisuLog 통합: GigaTrans 정규화 + 일반 메시지 무변경');

if (failed === 0) { console.log('✅ risuLog: 통과'); process.exit(0); }
else { console.error(`❌ risuLog: ${failed} 실패`); process.exit(1); }
