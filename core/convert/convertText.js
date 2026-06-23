// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/convertText.js
// Pro 1.2 convert_text (5955-5990) 오케스트레이터.
// 본문 전처리(이미지태그/단어치환/문단분할/format_conversation/flatten)는 prepareBody.js 로 분리 — card/템플릿 공유.
// extraMappings: charx 등에서 만든 tag→dataURL 매핑을 UI 매핑 위에 병합(에셋 자동매핑).
'use strict';
const { createTemplate } = require('./createTemplate.js');
const { flattenCss, sanitizeCss } = require('./cardStyles.js');
const { normalizeTemplateId } = require('./templates/registry.js');
const { renderOutputTemplate } = require('./templates/render.js');
const { prepareBody, resolveAssetCBS } = require('./prepareBody.js');
const { renderCardBlocks, blocksHaveContent } = require('./cardBlocks.js');

function convertText(input, settings, extraMappings) {
  const templateId = normalizeTemplateId(settings.template || 'card');
  // ★명명 CSS 디자인 base=webnovel(B2): 웹소설 렌더(훅 ON) → 공통 flattenCss(userCss)로 인라인화(아카 생존).
  //   base=card는 아래 기존 custom-css 경로. (core 결정론·골든: 일반 웹소설은 훅 OFF라 무변경.)
  if (templateId === 'custom-css' && settings.cssBase === 'webnovel') {
    const rs = Object.assign({}, settings, { __outputHooks: true, text: Object.assign({}, settings.text || {}, { __outputHooks: true }) });
    let html = renderOutputTemplate('webnovel', input, rs, extraMappings);
    if (html == null) html = '';
    const userCss = String(settings.userCardCss || '').trim();
    if (userCss) html = flattenCss(html, sanitizeCss(userCss));
    return html;
  }
  // 별도 렌더러를 가진 출력 디자인(로그 다이어리)은 빈-입력 가드 전에 처리(페이지/표지가 입력란과 별도라 자체 판단).
  if (templateId !== 'card' && templateId !== 'custom-css') {
    const html = renderOutputTemplate(templateId, input, settings, extraMappings);
    if (html != null) return html;
    // null → card 폴백
  }
  // card / custom-css 만 여기 도달.
  const userCss = templateId === 'custom-css' ? String(settings.userCardCss || '').trim() : '';
  const useHooks = !!userCss;
  const renderSettings = useHooks
    ? Object.assign({}, settings, { __outputHooks: true, text: Object.assign({}, settings.text || {}, { __outputHooks: true }) })
    : settings;
  renderSettings.template = useHooks ? 'custom-css' : 'card';

  // 기본 카드의 다중 입력 블록(templateSettings.card.blocks): 있으면 섹션화, 없으면 단일 입력(패리티).
  const cardCfg = (renderSettings.templateSettings && renderSettings.templateSettings.card) || {};
  const blocks = Array.isArray(cardCfg.blocks) ? cardCfg.blocks : null;
  // 기본 카드 + 다중 블록: 블록마다 독립 카드 박스를 세로로 쌓아 반환(renderCardBlocks가 완성 HTML 생성).
  if (templateId === 'card' && blocks && blocks.length) {
    if (!blocksHaveContent(blocks)) return '';
    return renderCardBlocks(blocks, renderSettings, extraMappings);
  }
  if (!input || input.trim() === '') return '';
  const content = prepareBody(input, renderSettings, extraMappings);
  let html = createTemplate(content, renderSettings);
  if (userCss) html = flattenCss(html, sanitizeCss(userCss));
  return html;
}

module.exports = { convertText, resolveAssetCBS };
