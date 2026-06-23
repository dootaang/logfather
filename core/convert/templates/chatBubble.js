// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/templates/chatBubble.js
// 출력 디자인 "채팅형" — 메시지(역할+텍스트) 리스트를 좌우 말풍선으로 렌더한다.
//   · 데이터 = settings.templateSettings.chat.messages = [{ role:'user'|'char', text }]
//   · 각 메시지 본문은 기본 엔진(prepareBody)으로 변환 → 대사/나레/속마음/이미지/마커 그대로 동작.
//   · v1 요소: 아바타(유저/캐릭터 프로필 이미지) + 이름표 + 좌우 정렬(유저 오른쪽/캐릭터 왼쪽 또는 둘 다 왼쪽).
//
// ★아카(Froala) 호환 = 인라인 스타일만. position/flex/gap/url()/<style> 안 씀:
//   좌우 배치 = 행 wrapper의 text-align:left|right + 말풍선/아바타는 display:inline-block(아카 허용).
//   아바타 = span(width 고정, 아카가 div/span width는 살림) > img(max-width:100%·border-radius:50%, 아카가 살림;
//            정사각 크롭은 리치복사 reencode가 border-radius:50% 보고 처리). img width/height는 아카가 떼므로 안 씀.
'use strict';
const { prepareBody } = require('../prepareBody.js');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 채팅형 기본값(레지스트리 DEFS.defaults와 동일하게 유지).
const CHAT_DEFAULTS = {
  messages: [],
  userName: '나',
  charName: '',          // 비면 렌더 시 profile.botName → '상대'
  userAvatar: '',
  charAvatar: '',
  align: 'lr',           // 'lr' = 유저 오른쪽·캐릭터 왼쪽 / 'left' = 둘 다 왼쪽(디코식)
  showName: true,
  showAvatar: true,
  userColor: '#ffe2c2',
  charColor: '#eef0f4',
  userTextColor: '#2b2b2b',
  charTextColor: '#2b2b2b',
  radius: 18,
  bg: '',                // 채팅창 배경(선택, 비면 없음)
};

function avatarSpan(url) {
  return '<span style="display:inline-block;width:42px;vertical-align:top;margin:0 8px;">'
    + '<img src="' + esc(url) + '" style="max-width:100%;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.15);" class="fr-fic fr-dii"></span>';
}

function renderRow(m, cfg, settings, extraMappings, names) {
  const isUser = m.role === 'user';
  const right = isUser && cfg.align !== 'left';
  const bubbleColor = isUser ? cfg.userColor : cfg.charColor;
  const textColor = isUser ? cfg.userTextColor : cfg.charTextColor;
  const name = isUser ? names.userName : names.charName;
  const avatar = isUser ? cfg.userAvatar : cfg.charAvatar;
  // 본문은 엔진 그대로(대사/나레/이미지). 문단 사이 간격은 말풍선용으로 줄임.
  const body = prepareBody(String(m.text || ''), settings, extraMappings).replace(/margin-bottom:1\.5rem;/g, 'margin-bottom:0.4rem;');
  const nameHtml = cfg.showName
    ? '<div style="font-size:11px;font-weight:700;color:' + textColor + ';margin-bottom:3px;">' + esc(name) + '</div>'
    : '';
  const radius = (+cfg.radius >= 0 ? +cfg.radius : 18);
  const bubble = '<div style="display:inline-block;max-width:74%;text-align:left;vertical-align:top;'
    + 'background:' + bubbleColor + ';color:' + textColor + ';border-radius:' + radius + 'px;'
    + 'padding:9px 13px;box-shadow:0 1px 2px rgba(0,0,0,0.06);">' + nameHtml + body + '</div>';
  const avatarHtml = (cfg.showAvatar && avatar) ? avatarSpan(avatar) : '';
  const inner = right ? (bubble + avatarHtml) : (avatarHtml + bubble);
  return '<div style="text-align:' + (right ? 'right' : 'left') + ';margin-bottom:11px;">' + inner + '</div>';
}

// 출력 디자인 디스패처(render.js)가 호출. input = 입력란(메시지 없을 때 폴백).
function renderChatBubble(input, settings, extraMappings) {
  const cfg = Object.assign({}, CHAT_DEFAULTS, (settings.templateSettings && settings.templateSettings.chat) || {});
  let messages = Array.isArray(cfg.messages) ? cfg.messages.filter((m) => m && String(m.text || '').trim() !== '') : [];
  if (!messages.length) {
    const t = String(input || '').trim();
    if (!t) return '';
    messages = [{ role: 'char', text: t }];   // 메시지 리스트가 없으면 입력란을 캐릭터 한 마디로(폴백)
  }
  const names = {
    userName: cfg.userName || '나',
    charName: cfg.charName || (settings.profile && settings.profile.botName) || '상대',
  };
  const rows = messages.map((m) => renderRow(m, cfg, settings, extraMappings, names)).join('\n');
  const bg = cfg.bg ? ('background:' + cfg.bg + ';padding:14px 12px;border-radius:14px;') : '';
  return '<div style="max-width:600px;margin:0 auto;' + bg + '">' + rows + '</div>';
}

module.exports = { renderChatBubble, CHAT_DEFAULTS };
