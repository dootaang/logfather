// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/import/risuLog.js
// RisuAI 채팅 export(.json) 파서 — 평문 JSON(RPack 아님).
// { type:'risuChat'|'risuAllChats', ver, data:{message:[{role:'user'|'char', data:'텍스트'}], name}, folders }
// 캐릭터명은 export 안에 없고 파일명(<캐릭명>_<ISO>_chat.json)에서 슬라이스.
'use strict';

function charFromFileName(fileName) {
  const base = String(fileName || '').replace(/\.[^.]+$/, '');
  // <캐릭명>_2026-06-17T08...Z_chat → <캐릭명>
  const m = base.replace(/_\d{4}-\d\d-\d\dT[\d:.\-Z]*_chat$/i, '').replace(/_chat$/i, '');
  return (m || base || '가져온 로그').trim();
}

// GigaTrans(인기 RisuAI 번역 유틸) 표시 마커 정규화 — 가져오기 상호운용. ★결정론·무료, 마커 없으면 완전 무변경.
//   GigaTrans는 메시지 본문에 "번역문 <GT-SEP/> <GigaTrans>원문</GigaTrans> <GT-CTRL…/>" 식으로 저장(화면엔 번역만 보이게).
//   네이티브 번역 캐시가 아니라 본문에 있어 캐시 읽기론 안 잡히지만, 마커만 벗기면 깨끗한 번역문이 나온다.
//   ★유실 0: 번역문이 비는 경우(원문만 있는 메시지 등)는 래퍼·마커만 벗기고 내용 보존(빈 문자열로 안 날림).
function stripGigaTrans(text) {
  let s = String(text == null ? '' : text);
  if (!/<GT-SEP\b|<\/?GigaTrans\b|<GT-CTRL\b/i.test(s)) return s;   // 마커 없으면 무변경(일반 챗·기존 거동 영향 0)
  const origs = [];
  let body = s.replace(/<GigaTrans\b[^>]*>([\s\S]*?)<\/GigaTrans>/gi, (_m, inner) => { origs.push(inner); return ''; });   // 원문 블록 통째 제거(폴백용 보관)
  body = body.replace(/<GT-CTRL\b[^>]*>/gi, '');   // 토글 컨트롤 마커 전부 제거
  body = body.replace(/<GT-SEP\b[^>]*>/gi, '');    // 구분자 제거 → <GT-SEP/> 앞 번역문만 남음
  body = body.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (body) return body;                            // 번역문 남음 → 그것만
  const fb = origs.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();   // 유실 0: 번역문 비면 원문 보존(래퍼만 벗김)
  return fb || s.replace(/<\/?GigaTrans\b[^>]*>/gi, '').replace(/<GT-CTRL\b[^>]*>/gi, '').replace(/<GT-SEP\b[^>]*>/gi, '').trim();
}

function extractMessages(data) {
  if (!data || !Array.isArray(data.message)) return [];
  return data.message
    .filter((m) => m && typeof m.data === 'string')
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'char', text: stripGigaTrans(String(m.data)) }))   // GigaTrans 마커 정규화(번역문만)
    .filter((m) => m.text.trim());
}

// → { char, chats:[{ name, messages:[{role,text}] }] }
function parseRisuLog(obj, fileName) {
  const char = charFromFileName(fileName);
  if (!obj || typeof obj !== 'object') return { char, chats: [] };
  if (obj.type === 'risuAllChats' && Array.isArray(obj.data)) {
    return { char, chats: obj.data.map((d, i) => ({ name: (d && d.name) || ('Chat ' + (i + 1)), messages: extractMessages(d) })).filter((c) => c.messages.length) };
  }
  const d = obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data) ? obj.data : obj;
  const messages = extractMessages(d);
  return { char, chats: messages.length ? [{ name: (d && d.name) || 'Chat 1', messages }] : [] };
}

// 메시지 배열 → N개씩 묶은 화(episode) 배열. mode: 'count'(N개씩) | 'total'(총 N화 균등).
function splitMessages(messages, n, mode) {
  const eps = [];
  if (!messages.length) return eps;
  if (mode === 'total') {
    const per = Math.max(1, Math.ceil(messages.length / Math.max(1, n)));
    for (let i = 0; i < messages.length; i += per) eps.push(messages.slice(i, i + per));
  } else { // count: N개씩
    const per = Math.max(1, n);
    for (let i = 0; i < messages.length; i += per) eps.push(messages.slice(i, i + per));
  }
  return eps;
}

module.exports = { parseRisuLog, charFromFileName, extractMessages, splitMessages, stripGigaTrans };
