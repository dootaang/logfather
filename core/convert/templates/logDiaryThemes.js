// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/templates/logDiaryThemes.js
// 로그 다이어리(log-diary.github.io) 색 테마 이식 — 원작 script.js STYLES 발췌.
// 코어 렌더러와 웹 설정 패널이 같은 목록을 공유하도록 한 파일에 둔다.
'use strict';

const DIARY_THEMES = {
  basic: { bg: '#ffffff', text: '#2c3e50', em: '#2d5af0', header: '#162a3e', headerText: '#162a3e', line: '#162a3e', quote1Bg: '#f0f2f5', quote1Text: '#2c3e50', quote2Bg: '#f0f2f5', quote2Text: '#162a3e', tagText: '#6c8da8', divider: '#c8d6e0' },
  light: { bg: '#ececed', text: '#555555', em: '#666666', header: '#333333', headerText: '#333333', line: '#333333', quote1Bg: '#e0e0e0', quote1Text: '#444444', quote2Bg: '#dcdcdc', quote2Text: '#222222', tagText: '#808080', divider: '#d0d0d0' },
  dark: { bg: '#252525', text: '#aaaaaa', em: '#999999', header: '#f3f3f3', headerText: '#f3f3f3', line: '#f3f3f3', quote1Bg: '#333333', quote1Text: '#cccccc', quote2Bg: '#3a3a3a', quote2Text: '#ffffff', tagText: '#999999', divider: '#4a4a4a' },
  oldMoneyLight: { bg: '#efe9da', text: '#574d34', em: '#923838', header: '#56412b', headerText: '#56412b', line: '#56412b', quote1Bg: '#f7f3e8', quote1Text: '#184f66', quote2Bg: '#f7f3e8', quote2Text: '#634121', tagText: '#8b7355', divider: '#d4c9b0' },
  oldMoneyDark: { bg: '#141e23', text: '#a08e6c', em: '#aa7b5c', header: '#bf9f6f', headerText: '#bf9f6f', line: '#bf9f6f', quote1Bg: '#192228', quote1Text: '#3092ab', quote2Bg: '#192228', quote2Text: '#d0a053', tagText: '#a89070', divider: '#2a3540' },
  rose: { bg: '#fefbfd', text: '#5c4a5a', em: '#c77d8e', header: '#8b5a6a', headerText: '#8b5a6a', line: '#8b5a6a', quote1Bg: '#faf5f7', quote1Text: '#6b4a5a', quote2Bg: '#f8f0f3', quote2Text: '#7d5a6a', tagText: '#b08090', divider: '#e8d5db' },
  ocean: { bg: '#f5f9fc', text: '#3d5a6f', em: '#2980b9', header: '#1a4a66', headerText: '#1a4a66', line: '#1a4a66', quote1Bg: '#e8f4fa', quote1Text: '#2c5d7a', quote2Bg: '#dceef7', quote2Text: '#1e5a78', tagText: '#5a8aa8', divider: '#c8dce8' },
  forest: { bg: '#f7faf5', text: '#3d4f3a', em: '#5a8a50', header: '#2d5a28', headerText: '#2d5a28', line: '#2d5a28', quote1Bg: '#eef5ec', quote1Text: '#3d5a38', quote2Bg: '#e5f0e3', quote2Text: '#2a5025', tagText: '#6a9a60', divider: '#d0e0cc' },
};

// 웹 드롭다운에 보일 순서 + 한국어 라벨.
const DIARY_THEME_LIST = [
  { id: 'basic', label: '베이직' },
  { id: 'light', label: '라이트' },
  { id: 'dark', label: '다크' },
  { id: 'oldMoneyLight', label: '올드머니 라이트' },
  { id: 'oldMoneyDark', label: '올드머니 다크' },
  { id: 'rose', label: '로즈' },
  { id: 'ocean', label: '오션' },
  { id: 'forest', label: '포레스트' },
];

const DIARY_FONT_LIST = ['Pretendard', 'Noto Serif KR'];

// 표지·페이지 헤더 이미지 비율(높이 제한). 미리보기는 CSS aspect-ratio, 복사는 canvas 크롭으로 보장.
const DIARY_IMAGE_RATIOS = [
  { id: '', label: '원본 비율' },
  { id: 'wide', label: '와이드 (21:9)' },
  { id: 'banner', label: '배너 (16:9)' },
  { id: 'tall', label: '높게 (3:2)' },
];
const RATIO_VALUE = { wide: '21/9', banner: '16/9', tall: '3/2' };

module.exports = { DIARY_THEMES, DIARY_THEME_LIST, DIARY_FONT_LIST, DIARY_IMAGE_RATIOS, RATIO_VALUE };
