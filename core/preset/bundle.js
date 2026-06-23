// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/preset/bundle.js
// 프리셋 = 단일 휴대용 JSON 번들 (확정 결정: 캐노니컬 저장 = 단일 JSON, SQLite 없음).
//  - buildBundle(settings)  → 직렬화용 plain 객체 { app, version, kind, settings }
//  - parseBundle(obj)       → 신뢰 금지 살균 + 버전 확인 → { settings, warnings }
//  - sanitizeSettings(raw)  → 기본값 위에 검증된 값만 덮어씀(색=hex, 숫자=범위 clamp, enum=화이트리스트)
// 보안(§4): import = 신뢰 금지. 색은 hex 검증, URL은 javascript:/따옴표/꺾쇠 차단,
//           HTML에 raw 주입되는 텍스트(botName/태그텍스트)는 꺾쇠 제거. cardRegex/cardCss(카드 산출물)는 번들에 안 담음.
'use strict';
const { sanitizeCss } = require('../convert/cardStyles.js');
const { normalizeTemplateId } = require('../convert/templates/registry.js');

const APP_ID = 'log-jejogi-pro2';
const BUNDLE_VERSION = 1;

// ---------- 검증 헬퍼 ----------
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const isHex = (v) => typeof v === 'string' && HEX.test(v.trim());
const okHex = (v, fb) => (isHex(v) ? v.trim() : fb);
// cardTextColor는 ''(자동) 또는 hex
const okHexOrEmpty = (v, fb) => (v === '' || v == null ? '' : (isHex(v) ? v.trim() : fb));
const okBool = (v, fb) => (typeof v === 'boolean' ? v : (v == null ? fb : !!v));
function okNum(v, fb, min, max) {
  let n = Number(v);
  if (!isFinite(n)) return fb;
  if (typeof min === 'number') n = Math.max(min, n);
  if (typeof max === 'number') n = Math.min(max, n);
  return n;
}
const okEnum = (v, opts, fb) => (opts.indexOf(v) >= 0 ? v : fb);
// HTML에 raw로 들어가는 텍스트: 꺾쇠 제거(속성/태그 탈출 방지) + 길이 cap
const cleanText = (v, fb) => (typeof v === 'string' ? v.replace(/[<>]/g, '').slice(0, 2000) : (fb == null ? '' : fb));
// URL: 문자열, 따옴표/꺾쇠/javascript: 차단(data:·http(s)·//·상대경로 허용)
function okUrl(v) {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  if (!t) return '';
  if (/[<>"']/.test(t)) return '';
  if (/^\s*javascript:/i.test(t)) return '';
  return t.slice(0, 200000); // data:URL 허용을 위해 넉넉히
}

// ---------- 기본 settings (web 셸 초기 상태와 동일) ----------
function defaultSettings() {
  return {
    box: { showInnerBox: false, outerBoxColor: '#ffffff', innerBoxColor: '#f8f9fa', shadowIntensity: 8, useBoxBorder: false, boxBorderColor: '#e2e8f0', boxBorderThickness: 2, maxWidth: 600, userColor: '#eef2ff', charColor: '#fdf2f8' },
    profile: { showProfile: true, showProfileImage: true, showBotName: true, showTags: true, showDivider: true, botName: '봇 이름', botNameColor: '#4a4a4a', frameStyle: '동그라미', width: 96, height: 96, imageUrl: '', showProfileBorder: true, profileBorderColor: '#e2e8f0', showProfileShadow: true },
    divider: { style: '그라데이션', thickness: 1, outerColor: '#e2e8f0', innerColor: '#ffffff', solidColor: '#b8bacf' },
    text: { useTextIndent: true, textIndent: 20, useTextSize: true, textSize: 14, dialogColor: '#2d3748', dialogBold: true, dialogNewline: true, innerThoughtsColor: '#718096', innerThoughtsBold: false, narrationColor: '#4a5568', usePadding: true, removeAsterisk: true, convertEllipsis: true, smartFormat: true, risuMarkers: true, asteriskEmphasis: false },
    tags: [
      { text: '모델', color: '#edf2f7', textColor: '#2d3748', style: '기본', borderRadius: 20, fontSize: 0.85, padding: { top: 0.2, right: 0.8, bottom: 0.2, left: 0.8 } },
      { text: '프롬프트', color: '#e2e8f0', textColor: '#2d3748', style: '기본', borderRadius: 20, fontSize: 0.85, padding: { top: 0.2, right: 0.8, bottom: 0.2, left: 0.8 } },
    ],
    assetImage: { imageSize: 80, imageMargin: 10, useImageBorder: false, imageBorderColor: '#000000', useImageShadow: true },
    imageMappings: [],
    wordReplace: [],
    darkMode: false,
    cardTextColor: '',
    template: 'card',
    templateSettings: {},
    userCardCss: '',
  };
}

const TAG_STYLES = ['기본', '투명 배경', '그라데이션'];
const FRAME_STYLES = ['배너', '동그라미', '직사각형'];
const DIVIDER_STYLES = ['그라데이션', '단색'];

// ---------- 살균(import) ----------
// raw(신뢰 못 할 객체) → 기본값 위에 검증된 값만 얹은 완전한 settings. warnings에 거른 항목 기록.
function sanitizeSettings(raw) {
  const d = defaultSettings();
  const w = [];
  if (!raw || typeof raw !== 'object') { w.push('settings 형식이 아님 — 기본값 사용'); return { settings: d, warnings: w }; }

  const r = raw;
  // box
  if (r.box && typeof r.box === 'object') {
    const b = r.box, B = d.box;
    B.showInnerBox = okBool(b.showInnerBox, B.showInnerBox);
    B.outerBoxColor = okHex(b.outerBoxColor, B.outerBoxColor);
    B.innerBoxColor = okHex(b.innerBoxColor, B.innerBoxColor);
    B.shadowIntensity = okNum(b.shadowIntensity, B.shadowIntensity, 0, 40);
    B.useBoxBorder = okBool(b.useBoxBorder, B.useBoxBorder);
    B.boxBorderColor = okHex(b.boxBorderColor, B.boxBorderColor);
    B.boxBorderThickness = okNum(b.boxBorderThickness, B.boxBorderThickness, 1, 8);
    B.maxWidth = okNum(b.maxWidth, B.maxWidth, 300, 1200);
    B.userColor = okHex(b.userColor, B.userColor);   // 역할별 박스색(2색 전사)
    B.charColor = okHex(b.charColor, B.charColor);
  }
  // profile
  if (r.profile && typeof r.profile === 'object') {
    const p = r.profile, P = d.profile;
    P.showProfile = okBool(p.showProfile, P.showProfile);
    P.showProfileImage = okBool(p.showProfileImage, P.showProfileImage);
    P.showBotName = okBool(p.showBotName, P.showBotName);
    P.showTags = okBool(p.showTags, P.showTags);
    P.showDivider = okBool(p.showDivider, P.showDivider);
    P.botName = cleanText(p.botName, P.botName);
    P.botNameColor = okHex(p.botNameColor, P.botNameColor);
    P.frameStyle = okEnum(p.frameStyle, FRAME_STYLES, P.frameStyle);
    P.width = okNum(p.width, P.width, 20, 300);
    P.height = okNum(p.height, P.height, 20, 300);
    const u = okUrl(p.imageUrl);
    if (p.imageUrl != null && u === '' && p.imageUrl !== '') w.push('프로필 이미지 URL이 안전하지 않아 무시');
    P.imageUrl = u;
    P.showProfileBorder = okBool(p.showProfileBorder, P.showProfileBorder);
    P.profileBorderColor = okHex(p.profileBorderColor, P.profileBorderColor);
    P.showProfileShadow = okBool(p.showProfileShadow, P.showProfileShadow);
  }
  // divider
  if (r.divider && typeof r.divider === 'object') {
    const v = r.divider, V = d.divider;
    V.style = okEnum(v.style, DIVIDER_STYLES, V.style);
    V.thickness = okNum(v.thickness, V.thickness, 1, 4);
    V.outerColor = okHex(v.outerColor, V.outerColor);
    V.innerColor = okHex(v.innerColor, V.innerColor);
    V.solidColor = okHex(v.solidColor, V.solidColor);
  }
  // text
  if (r.text && typeof r.text === 'object') {
    const t = r.text, T = d.text;
    T.useTextIndent = okBool(t.useTextIndent, T.useTextIndent);
    T.textIndent = okNum(t.textIndent, T.textIndent, 0, 100);
    T.useTextSize = okBool(t.useTextSize, T.useTextSize);
    T.textSize = okNum(t.textSize, T.textSize, 8, 24);
    T.dialogColor = okHex(t.dialogColor, T.dialogColor);
    T.dialogBold = okBool(t.dialogBold, T.dialogBold);
    T.dialogNewline = okBool(t.dialogNewline, T.dialogNewline);
    T.innerThoughtsColor = okHex(t.innerThoughtsColor, T.innerThoughtsColor);
    T.innerThoughtsBold = okBool(t.innerThoughtsBold, T.innerThoughtsBold);
    T.narrationColor = okHex(t.narrationColor, T.narrationColor);
    T.usePadding = okBool(t.usePadding, T.usePadding);
    T.removeAsterisk = okBool(t.removeAsterisk, T.removeAsterisk);
    T.convertEllipsis = okBool(t.convertEllipsis, T.convertEllipsis);
    T.smartFormat = okBool(t.smartFormat, T.smartFormat);
    T.risuMarkers = okBool(t.risuMarkers, T.risuMarkers);
    T.asteriskEmphasis = okBool(t.asteriskEmphasis, T.asteriskEmphasis);
  }
  // tags (배열 — 요소별 살균; 비배열이면 기본 유지)
  if (Array.isArray(r.tags)) {
    d.tags = r.tags.slice(0, 50).filter((x) => x && typeof x === 'object').map((x) => sanitizeTag(x));
  }
  // assetImage
  if (r.assetImage && typeof r.assetImage === 'object') {
    const a = r.assetImage, A = d.assetImage;
    A.imageSize = okNum(a.imageSize, A.imageSize, 10, 100);
    A.imageMargin = okNum(a.imageMargin, A.imageMargin, 0, 50);
    A.useImageBorder = okBool(a.useImageBorder, A.useImageBorder);
    A.imageBorderColor = okHex(a.imageBorderColor, A.imageBorderColor);
    A.useImageShadow = okBool(a.useImageShadow, A.useImageShadow);
  }
  // imageMappings [{tag,url}]
  if (Array.isArray(r.imageMappings)) {
    d.imageMappings = r.imageMappings.slice(0, 1000).filter((x) => x && typeof x === 'object')
      .map((x) => ({ tag: cleanText(x.tag, ''), url: okUrl(x.url) }));
  }
  // wordReplace [{from,to}]  — 공백 보존(strip 금지), to:"" 정당
  if (Array.isArray(r.wordReplace)) {
    d.wordReplace = r.wordReplace.slice(0, 1000).filter((x) => x && typeof x === 'object')
      .map((x) => ({ from: cleanText(x.from, ''), to: cleanText(x.to, '') }));
  }
  // 전역
  d.darkMode = okBool(r.darkMode, d.darkMode);
  d.cardTextColor = okHexOrEmpty(r.cardTextColor, '');
  d.template = normalizeTemplateId(r.template || 'card');
  d.templateSettings = (r.templateSettings && typeof r.templateSettings === 'object' && !Array.isArray(r.templateSettings)) ? clone(r.templateSettings) : {};
  d.userCardCss = typeof r.userCardCss === 'string' ? sanitizeCss(r.userCardCss).slice(0, 50000) : '';

  return { settings: d, warnings: w };
}

function sanitizeTag(x) {
  const dt = { text: '태그', color: '#edf2f7', textColor: '#2d3748', style: '기본', borderRadius: 20, fontSize: 0.85, padding: { top: 0.2, right: 0.8, bottom: 0.2, left: 0.8 } };
  const p = (x.padding && typeof x.padding === 'object') ? x.padding : {};
  return {
    text: cleanText(x.text, dt.text),
    color: okHex(x.color, dt.color),
    textColor: okHex(x.textColor, dt.textColor),
    style: okEnum(x.style, TAG_STYLES, dt.style),
    borderRadius: okNum(x.borderRadius, dt.borderRadius, 0, 40),
    fontSize: okNum(x.fontSize, dt.fontSize, 0.3, 3),
    padding: {
      top: okNum(p.top, dt.padding.top, 0, 5),
      right: okNum(p.right, dt.padding.right, 0, 5),
      bottom: okNum(p.bottom, dt.padding.bottom, 0, 5),
      left: okNum(p.left, dt.padding.left, 0, 5),
    },
  };
}

// ---------- 직렬화(export) ----------
// 직렬화 대상만 추려 plain 객체로. cardRegex/cardCss(카드 산출물)는 제외.
// profile.imageUrl 이 data:(드롭한 카드 아이콘)이면 휴대성 위해 제외 — 외부 URL은 유지.
function buildBundle(settings, ui) {
  const s = settings || {};
  const exImg = (s.profile && typeof s.profile.imageUrl === 'string' && /^data:/i.test(s.profile.imageUrl)) ? '' : (s.profile && s.profile.imageUrl) || '';
  const out = {
    app: APP_ID,
    version: BUNDLE_VERSION,
    kind: 'preset',
    settings: {
      box: clone(s.box),
      profile: Object.assign(clone(s.profile), { imageUrl: exImg }),
      divider: clone(s.divider),
      text: clone(s.text),
      tags: clone(s.tags),
      assetImage: clone(s.assetImage),
      imageMappings: clone(s.imageMappings),
      wordReplace: clone(s.wordReplace),
      darkMode: !!s.darkMode,
      cardTextColor: s.cardTextColor || '',
      template: normalizeTemplateId(s.template || 'card'),
      templateSettings: clone(s.templateSettings || {}),
      userCardCss: sanitizeCss(s.userCardCss || ''),
    },
  };
  if (ui && typeof ui === 'object') out.ui = clone(ui); // cardRegexOn/cardCssOn/cardTextManual 등 UI 토글 상태(선택)
  return out;
}

// ---------- 역직렬화(import) ----------
function parseBundle(obj) {
  const w = [];
  if (!obj || typeof obj !== 'object') return { settings: defaultSettings(), warnings: ['JSON 형식이 아님'], ui: null };
  if (obj.app && obj.app !== APP_ID) w.push('다른 앱의 번들일 수 있음 — 가능한 값만 적용');
  if (typeof obj.version === 'number' && obj.version > BUNDLE_VERSION) w.push('더 새 버전의 번들 — 일부 설정이 누락될 수 있음');
  const res = sanitizeSettings(obj.settings);
  const ui = (obj.ui && typeof obj.ui === 'object') ? {
    cardRegexOn: okBool(obj.ui.cardRegexOn, true),
    cardCssOn: okBool(obj.ui.cardCssOn, true),
    cardTextManual: okBool(obj.ui.cardTextManual, false),
  } : null;
  return { settings: res.settings, warnings: w.concat(res.warnings), ui };
}

function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

module.exports = {
  APP_ID, BUNDLE_VERSION,
  defaultSettings, sanitizeSettings, sanitizeTag,
  buildBundle, parseBundle,
  // 내부 헬퍼(레거시 임포터가 재사용)
  okHex, okHexOrEmpty, okBool, okNum, okEnum, cleanText, okUrl, isHex,
  TAG_STYLES, FRAME_STYLES, DIVIDER_STYLES,
};
