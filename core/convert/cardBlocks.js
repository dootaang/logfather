// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/cardBlocks.js
// 기본 카드의 "다중 입력 블록" → 블록마다 '독립 카드 박스'를 세로로 쌓는다(로그 다이어리가 페이지를 박스로 쌓는 방식 차용).
//   · 한 박스 안 <details> 섹션이 아니라, 블록 추가 시 새 카드 박스가 아래로 생김.
//   · 제목/부제 헤더 = 다이어리 다중페이지식(큰 번호 + 제목 + 부제), 단 색/폰트는 카드 설정을 따름.
//   · 프로필(이미지/이름/태그/구분선)은 첫 박스에만(반복 안 함).
//   · 블록 1개 + 제목/부제 없음 = 기존 단일 카드와 동일(골든 패리티).
//   · "출력에서 접어두기"(block.collapsed) 블록은 다이어리식 <details>(헤더가 summary)로.
'use strict';
const { prepareBody } = require('./prepareBody.js');
const { createTemplate } = require('./createTemplate.js');
const { STYLES } = require('../constants.js');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function blocksHaveContent(blocks) {
  return Array.isArray(blocks) && blocks.some((b) => b && (String(b.content || '').trim() || String(b.title || '').trim() || String(b.subtitle || '').trim()));
}
// 섹션화(=여러 박스로 쌓기)가 필요한가: 2개 이상 또는 어떤 블록이 제목/부제/역할을 가짐.
function isSectioned(blocks) {
  return blocks.length > 1 || blocks.some((b) => b && (String(b.title || '').trim() || String(b.subtitle || '').trim() || b.role));
}

// 다이어리 다중페이지식 헤더(번호 + 제목 + 부제). 색은 카드 글자색·나레이션색 사용.
// 역할(role) 블록(채팅 가져오기): 블록 제목 있으면 그게 우선 / 번호 모드면 숫자 / 아니면 라벨(유저·캐릭터, 치환 가능).
function cardBlockHeader(block, num, settings) {
  const cardText = settings.cardTextColor || (settings.darkMode ? STYLES.text_dark : STYLES.text_light);
  const cardCfg = (settings.templateSettings && settings.templateSettings.card) || {};
  if (block.role) {
    const isUser = block.role === 'user';
    const accent = (settings.profile && settings.profile.botNameColor) || cardText;
    const blockTitle = String(block.title || '').trim();
    // 우선순위: 블록 제목 > 번호 모드 > 역할 라벨(치환 가능)
    let label;
    if (blockTitle) label = blockTitle;
    else if (cardCfg.numbered) label = String(num);
    else label = isUser ? (cardCfg.userLabel || '나') : (cardCfg.charLabel || (settings.profile && settings.profile.botName) || '상대');
    return '<div style="font-weight:700;font-size:13px;margin-bottom:0.5rem;color:' + (isUser ? cardText : accent) + ';">' + esc(label) + '</div>';
  }
  const title = esc(String(block.title || '').trim());
  const subtitle = esc(String(block.subtitle || '').trim());
  const subColor = (settings.text && settings.text.narrationColor) || cardText;
  let h = '<div style="display:table;width:100%;margin-bottom:1rem;">';
  h += '<div style="display:table-cell;vertical-align:middle;width:1%;white-space:nowrap;padding-right:1rem;">';
  h += '<div style="font-size:30px;font-weight:700;color:' + cardText + ';line-height:1;">' + num + '</div></div>';
  h += '<div style="display:table-cell;vertical-align:middle;">';
  if (title) h += '<div style="font-size:17px;font-weight:700;color:' + cardText + ';line-height:1.3;">' + title + '</div>';
  if (subtitle) h += '<div style="font-size:13px;color:' + subColor + ';line-height:1.4;margin-top:2px;">' + subtitle + '</div>';
  h += '</div></div>';
  return h;
}

// 박스별 settings: 프로필은 첫 박스에만, 박스 사이 여백은 카드 margin이 담당(외곽 <p><br></p> 제거).
// role(user|char)이면 역할별 박스색(box.userColor/charColor)으로 박스 배경 교체(2색 전사).
function blockBoxSettings(settings, withProfile, role) {
  const text = Object.assign({}, settings.text, { usePadding: false });
  const profile = withProfile ? settings.profile : Object.assign({}, settings.profile, { showProfile: false });
  let box = settings.box;
  if (role && box) {
    const rc = role === 'user' ? box.userColor : box.charColor;
    if (rc) box = Object.assign({}, box, box.showInnerBox ? { outerBoxColor: rc } : { innerBoxColor: rc });
  }
  return Object.assign({}, settings, { text, profile, box });
}

// blocks → 최종 HTML(카드 박스 N개를 세로로 쌓음). convertText가 이 결과를 그대로 반환(추가 createTemplate 없음).
function renderCardBlocks(blocks, settings, extraMappings) {
  // 단일(제목없음) = 기존 단일 카드 그대로(패리티).
  if (!isSectioned(blocks)) {
    const content = prepareBody((blocks[0] && blocks[0].content) || '', settings, extraMappings);
    return createTemplate(content, settings);
  }
  // 접기 = 전역(모든 블록 일괄). settings.templateSettings.card.collapseAll.
  const cardCfg = (settings.templateSettings && settings.templateSettings.card) || {};
  const collapseAll = !!cardCfg.collapseAll;
  const boxes = blocks.map((b, i) => {
    const bl = b || {};
    const body = prepareBody(String(bl.content || ''), settings, extraMappings);
    const header = cardBlockHeader(bl, i + 1, settings);
    let content;
    if (collapseAll) {
      // 다이어리식 접기: 헤더가 summary, 본문이 펼침 영역.
      content = '<details style="margin:0;">'
        + '<summary style="cursor:pointer;list-style:none;outline:none;">' + header + '</summary>'
        + '<div>' + body + '</div></details>';
    } else {
      content = header + '\n' + body;
    }
    return createTemplate(content, blockBoxSettings(settings, i === 0, bl.role));
  });
  return boxes.join('\n');
}

module.exports = { renderCardBlocks, blocksHaveContent, isSectioned, cardBlockHeader };
