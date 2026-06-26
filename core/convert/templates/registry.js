// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/templates/registry.js
// Output design registry. Keep the default card plus the advanced CSS sandbox.
'use strict';

const TEMPLATE_ORDER = ['card', 'log-diary', 'chat', 'webnovel', 'custom-css', 'papa'];

const CARD_HOOKS = [
  'lp-card', 'lp-card-pad', 'lp-inner',
  'lp-profile', 'lp-profile-image-wrap', 'lp-profile-image', 'lp-profile-name',
  'lp-tags', 'lp-tag', 'lp-divider',
  'lp-paragraph', 'lp-line', 'lp-dialog',
  'lp-inner-thought', 'lp-narration',
  'lp-asset-block', 'lp-asset-image',
];

const TEMPLATE_DEFS = {
  card: {
    id: 'card',
    label: '기본 카드',
    origin: 'Log Generator Pro 1/Pro 2',
    description: '기존 600px 중앙 카드. Pro1 패리티와 아카 호환을 가장 강하게 유지합니다.',
    hooks: CARD_HOOKS,
  },
  'log-diary': {
    id: 'log-diary',
    label: '로그 다이어리',
    origin: 'log-diary.github.io',
    description: '표지(이미지+제목) + 본문 페이지의 잡지/일기장형 레이아웃입니다. 본문 변환은 기본 엔진을 그대로 쓰고, 표지·테마만 다이어리 풍으로 입힙니다.',
    hooks: CARD_HOOKS,
    defaults: {
      theme: 'basic',
      font: 'Noto Serif KR',
      coverImage: '',
      coverArchiveNo: '',
      coverTitle: '',
      coverSubtitle: '',
      coverTags: [],
      coverTextScale: 1.5,
      coverFocusY: 50,
      coverZoom: 100,
      coverOverlay: false,
      coverBake: false,
      quoteHighlight: true,
      imageRatio: '',
      profiles: [],
      intro: '',
      summary: '',
      soundtrack: { url: '', title: '', artist: '' },
      pageTitle: '',
      pageSubtitle: '',
      collapse: false,
      comment: { nickname: '', text: '' },
    },
  },
  chat: {
    id: 'chat',
    label: '채팅',
    origin: 'Log Generator Pro 2',
    description: '대화를 좌우 말풍선(카톡/디코식)으로 꾸미는 디자인입니다. 메시지마다 역할(유저/캐릭터)을 정하고, 아바타·이름표·좌우 정렬을 입힙니다. 본문 변환은 기본 엔진을 그대로 씁니다.',
    hooks: CARD_HOOKS,
    defaults: {
      messages: [],
      userName: '나',
      charName: '',
      userAvatar: '',
      charAvatar: '',
      align: 'lr',
      showName: true,
      showAvatar: true,
      userColor: '#ffe2c2',
      charColor: '#eef0f4',
      userTextColor: '#2b2b2b',
      charTextColor: '#2b2b2b',
      radius: 18,
      bg: '',
    },
  },
  webnovel: {
    id: 'webnovel',
    label: '웹소설',
    origin: 'Log Generator Pro 2',
    description: '활자에 집중하는 줄글 본문 디자인입니다. 종이/세피아/다크/night 테마를 골라 웹소설처럼 읽을 수 있고, 그 테마는 미리보기·서재 리더·리치 복사에 그대로 적용됩니다.',
    hooks: CARD_HOOKS,
    defaults: {
      messages: [],
      useBlocks: false,         // 장(章)으로 나누기 — 챕터 제목+구분선
      blocks: [],               // [{ title, content }]
      theme: 'sepia',           // 종이(light)/세피아(sepia)/다크(dark)/night(black) — 출력에 구워짐(미리보기·리더·리치복사 일관)
      dialogEmphasis: 'marker', // 기본 = 형광펜(반투명 마커). none | bold | underline | marker (테마안전, 고정색 없음)
      innerItalic: true,        // 속마음 이탤릭(기본 on)
      dialogNewline: false,     // 대사를 새 줄로
      asteriskEmphasis: true,   // *기울임* / **굵게**
      textIndent: 16,           // 첫 줄 들여쓰기(px) — 기본 정통소설풍
      paraGap: 1.5,             // 문단 간격(rem)
    },
  },
  'custom-css': {
    id: 'custom-css',
    label: '고급 CSS 커스텀',
    origin: 'Log Generator Pro 2',
    description: '기본 카드 출력을 베이스로 두고, 사용자가 직접 CSS를 써서 출력 카드를 장식하는 샌드박스형 디자인입니다.',
    hooks: CARD_HOOKS,
  },
  // ★파파모드 — 변환·편집 안 함(순수 통과). 다른 로그제조기가 만든 결과물(리치/소스 복사)을 그 디자인 그대로
  //   받아 살균만 거쳐 영구 보관·열람. 변환엔진·카드베이스·역할구조 전부 안 거침(web 셸이 읽는 메타일 뿐).
  papa: {
    id: 'papa',
    label: 'PAPA MODE',
    origin: 'LogPapa',
    description: '다른 로그제조기·아카 게시글에서 만든 로그를 (리치 복사·소스 복사로) 그 디자인 그대로 받아 보관합니다. 변환·꾸미기 없이 살균만 거쳐 통째로 삼키는 영구 보관 모드입니다.',
    hooks: [],
    defaults: {
      useBlocks: false,   // 여러 블록으로 나누기(opt-in) — 켜면 로그를 여러 칸에 따로 붙여넣기(블록마다 독립 격리 렌더)
      blocks: [],         // [{ html }] — 블록별 원본 HTML(붙여넣기/소스)
    },
  },
};

function normalizeTemplateId(id) {
  return Object.prototype.hasOwnProperty.call(TEMPLATE_DEFS, id) ? id : 'card';
}

module.exports = { TEMPLATE_ORDER, TEMPLATE_DEFS, normalizeTemplateId };
