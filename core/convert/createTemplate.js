// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/createTemplate.js
// Pro 1.2 create_template (5767-5953) 재현 — 인라인 CSS 카드 전체 틀.
// 들여쓰기(공백 수)는 골든 hello-test.raw.html과 1:1로 맞춤. SP(n)로 명시.
'use strict';
const { STYLES, DEFAULT_PROFILE_IMAGE } = require('../constants.js');
const { renderTagSpan } = require('./renderTags.js');

const SP = (n) => ' '.repeat(n);
// Python float str 재현: 정수값 float은 ".0" 유지(4/2→"2.0"), 그 외 최소표기(3/2→"1.5", 1/2→"0.5")
const pyFloat = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
function processImageUrl(url) { return url && url.trim() ? url : DEFAULT_PROFILE_IMAGE; }
const hook = (settings, name) => settings.__outputHooks ? ` class="${name}"` : '';

// 기본 카드 폰트: 미선택(빈값)이면 기존 고정 폰트 그대로 — ★골든 패리티(바이트 동일). 선택 시 그 폰트 + 자동 폴백.
const CARD_SANS_FONTS = ['Pretendard', 'Noto Sans KR', 'Nanum Gothic', 'Gothic A1', 'Gowun Dodum', 'IBM Plex Sans KR'];
function cardFontFamily(settings) {
  const ts = settings.templateSettings;
  const f = ts && ts.card && ts.card.font;
  if (!f) return STYLES.font_family;
  return "'" + f + "', " + (CARD_SANS_FONTS.indexOf(f) >= 0 ? 'sans-serif' : 'serif');
}

function createTemplate(content, settings) {
  const box = settings.box, prof = settings.profile, dv = settings.divider, txt = settings.text;
  const cardText = settings.cardTextColor || (settings.darkMode ? STYLES.text_dark : STYLES.text_light);
  const padding_html = txt.usePadding ? '<p><br></p>' : '';
  const shadow = box.shadowIntensity;
  const maxW = (box.maxWidth && box.maxWidth > 0) ? box.maxWidth : 600; // 카드 최대 너비(기본 600 → 골든/패리티 유지)
  const border_style = box.useBoxBorder ? `border: ${box.boxBorderThickness}px solid ${box.boxBorderColor};` : '';

  let background_color, inner_box_style;
  if (box.showInnerBox) {
    background_color = box.outerBoxColor;
    inner_box_style = '\n' + SP(20) + `font-size:${STYLES.font_size_normal}px;\n` + SP(20) +
      `background:${box.innerBoxColor};\n` + SP(20) + `padding:${STYLES.spacing_large}px;\n` + SP(20) +
      `border-radius:${STYLES.radius_normal}px;`;
  } else {
    background_color = box.innerBoxColor;
    inner_box_style = '\n' + SP(20) + `font-size:${STYLES.font_size_normal}px;\n` + SP(20) + `padding:0;`;
  }

  let profile_section_html = '';
  if (prof.showProfile) {
    const parts = [];

    if (prof.showProfileImage) {
      const shadowCss = prof.showProfileShadow ? 'box-shadow:rgba(0,0,0,0.12) 0px 4px 16px;' : '';
      const borderCss = prof.showProfileBorder ? `border:3px solid ${prof.profileBorderColor};` : '';
      const common = '\n' + SP(28) + 'max-width:100%;\n' + SP(28) + shadowCss + '\n' + SP(28) + borderCss + '\n' + SP(24);
      // 동그라미/직사각형: 아카(Froala)가 width/height(px)를 떼어내므로, 살아남는 max-width(%)로 크기 지정.
      //   비율은 aspect-ratio+object-fit(미리보기·브라우저용)으로 보장하고, 리치복사 때 동그라미는 정사각 크롭까지 함(아카 원형 보장).
      const commonNoMax = '\n' + SP(28) + shadowCss + '\n' + SP(28) + borderCss + '\n' + SP(24);
      const pct = (px) => +(Math.max(1, Math.min(100, px / (maxW / 100))).toFixed(2)); // px → 카드폭(maxW) 대비 %
      const url = processImageUrl(prof.imageUrl);
      const profileCls = settings.__outputHooks ? 'fr-fic fr-dii lp-profile-image' : 'fr-fic fr-dii';
      let profile_style, container_style;
      if (prof.frameStyle === '배너') { profile_style = common + ' border-radius:12px;'; container_style = 'width:100%;'; }
      else if (prof.frameStyle === '동그라미') { profile_style = commonNoMax + ` max-width:${pct(prof.width)}%; aspect-ratio:1/1; object-fit:cover; border-radius:50%;`; container_style = 'width:auto;'; }
      else { profile_style = commonNoMax + ` max-width:${pct(prof.width)}%; aspect-ratio:${prof.width}/${prof.height}; object-fit:cover; border-radius:8px;`; container_style = 'width:auto;'; }
      parts.push(
        '\n' + SP(24) + `<div${hook(settings, 'lp-profile-image-wrap')} style="margin-bottom:1rem; text-align:center; ${container_style}">\n` +
        SP(28) + `<img style="${profile_style}" \n` +
        SP(32) + `src="${url}" \n` +
        SP(32) + `alt="profile" \n` +
        SP(32) + `class="${profileCls}">\n` +
        SP(24) + `</div>\n` + SP(24)
      );
    }

    if (prof.showBotName) {
      const name = prof.botName || '봇 이름';
      parts.push('\n' + SP(28) + `<h3${hook(settings, 'lp-profile-name')} style="color:${prof.botNameColor};font-weight:${STYLES.font_weight_bold};">${name}</h3>\n` + SP(24));
    }

    if (prof.showTags) {
      const tagsHtml = settings.tags.map((tag, i) => '\n' + SP(36) + renderTagSpan(tag, i, { hooks: !!settings.__outputHooks }) + '\n' + SP(32));
      if (tagsHtml.length) {
        parts.push('\n' + SP(32) + `<div${hook(settings, 'lp-tags')} style="text-align:center;margin:0 auto;max-width:fit-content;">\n` +
          SP(36) + tagsHtml.join('') + '\n' + SP(32) + `</div>\n` + SP(28));
      }
    }

    if (prof.showDivider) {
      const divider_style = dv.style === '그라데이션'
        ? `background:linear-gradient(to right,${dv.outerColor} 0%,${dv.innerColor} 50%,${dv.outerColor} 100%);`
        : `background:${dv.solidColor};`;
      parts.push('\n' + SP(28) + `<div${hook(settings, 'lp-divider')} style="height:${dv.thickness}px;${divider_style}margin:1rem 0;border-radius:${pyFloat(dv.thickness / 2)}px;">\n` +
        SP(32) + `<br>\n` + SP(28) + `</div>\n` + SP(24));
    }

    if (parts.length) {
      profile_section_html = '\n' + SP(28) + `<div${hook(settings, 'lp-profile')} style="display:flex;flex-direction:column;text-align:center;margin-bottom:1.25rem;">\n` +
        SP(32) + parts.join('') + '\n' + SP(28) + `</div>\n` + SP(24);
    }
  }

  return `${padding_html}\n` +
    SP(16) + `<div${hook(settings, 'lp-card')} style="font-family:${cardFontFamily(settings)};\n` +
    SP(28) + `color:${cardText};\n` +
    SP(28) + `line-height:1.8;\n` +
    SP(28) + `width:100%;\n` +
    SP(28) + `max-width:${maxW}px;\n` +
    SP(28) + `margin:1rem auto;\n` +
    SP(28) + `background:${background_color};\n` +
    SP(28) + `border-radius:${STYLES.radius_large}px;\n` +
    SP(28) + `box-shadow:0px ${shadow}px ${shadow * 2}px rgba(0,0,0,0.2);\n` +
    SP(28) + `${border_style}">\n` +
    SP(20) + `<div${hook(settings, 'lp-card-pad')} style="padding:${STYLES.spacing_large}px;">\n` +
    SP(24) + `<div${hook(settings, 'lp-inner')} style="${inner_box_style}">\n` +
    SP(28) + `${profile_section_html}\n` +
    SP(28) + `${content}\n` +
    SP(24) + `</div>\n` +
    SP(20) + `</div>\n` +
    SP(16) + `</div>\n` +
    SP(16) + `${padding_html}`;
}

module.exports = { createTemplate, pyFloat };
