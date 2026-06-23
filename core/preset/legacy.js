// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/preset/legacy.js
// 레거시 Pro 1 임포터 (확정 결정 LOCKED #4: 필수 1급 기능).
// Pro 1 의 7가지 on-disk JSON 형태를 파일명 패턴으로 분류한 뒤, 사용자가 고른 항목을
// Pro 2 settings(camelCase)로 매핑. 웹=파일 업로드, 데스크탑=AppData 자동탐지(같은 분류 함수 재사용).
//   매핑표 출처: Pro2_MVP_기술설계서.md §5.2 (원본 log_generator_pro.py 저장 코드 직접 확인).
// 주의: 이름 복원은 접두사 길이 슬라이스(파일명에 '_' 포함 가능 → split 금지).
//       공백 보존(word_replace strip 금지). 캐시 vs 매핑셋 = 접미사 유무가 1차 신호.
'use strict';
const { sanitizeSettings } = require('./bundle.js');

// ---------- 파일명 → 패밀리 분류 ----------
// files: [{ name: '파일명.json', json: <파싱된 값> }]
// 반환: { colorTemplates{}, textSettings{}, tagPresets{}, profileSets{}, tagSets{}, wordReplaceSets{}, mappingSets{}, legacyImageCache, unknown[] }
function classifyLegacyFiles(files) {
  const out = {
    colorTemplates: {}, textSettings: {}, tagPresets: {},
    profileSets: {}, tagSets: {}, wordReplaceSets: {}, mappingSets: {},
    legacyImageCache: null, unknown: [],
  };
  const stripName = (fn, prefix) => fn.slice(prefix.length).replace(/\.json$/i, ''); // 접두사 길이 슬라이스(split 금지)
  for (const f of (files || [])) {
    const fn = String(f.name || '');
    const lower = fn.toLowerCase();
    const j = f.json;
    if (lower === 'color_presets.json') { if (j && typeof j === 'object') Object.assign(out.colorTemplates, j); }
    else if (lower === 'text_settings.json') { if (j && typeof j === 'object') Object.assign(out.textSettings, j); }
    else if (lower === 'tag_presets.json') { if (j && typeof j === 'object') Object.assign(out.tagPresets, j); }
    else if (lower.startsWith('profile_sets_')) { out.profileSets[stripName(fn, 'profile_sets_')] = j; }
    else if (lower.startsWith('tag_sets_')) { out.tagSets[stripName(fn, 'tag_sets_')] = j; }
    else if (lower.startsWith('word_replace_sets_')) { out.wordReplaceSets[stripName(fn, 'word_replace_sets_')] = j; }
    else if (lower.startsWith('image_mappings_')) { out.mappingSets[stripName(fn, 'image_mappings_')] = j; }
    else if (lower === 'image_mappings.json') {
      // 접미사 없음 → 형태 폴백: array=매핑셋, dict=캐시
      if (Array.isArray(j)) out.mappingSets['(기본)'] = j; else out.legacyImageCache = j;
    } else out.unknown.push(fn);
  }
  return out;
}

// ---------- 패밀리별 → Pro2 raw settings 조각(camelCase) ----------
// color_presets[name] → 넓은 스타일 조각(박스/프로필/구분선/텍스트색/에셋테두리) + 위치 태그색(_tagColors)
function colorPresetToRaw(e) {
  if (!e || typeof e !== 'object') return {};
  const out = { box: {}, profile: {}, divider: {}, text: {}, assetImage: {} };
  const B = out.box, P = out.profile, V = out.divider, T = out.text, A = out.assetImage;
  if ('outer_box_color' in e) B.outerBoxColor = e.outer_box_color;
  if ('inner_box_color' in e) B.innerBoxColor = e.inner_box_color;
  if ('box_border_color' in e) B.boxBorderColor = e.box_border_color;
  if ('use_box_border' in e) B.useBoxBorder = e.use_box_border;
  if ('box_border_thickness' in e) B.boxBorderThickness = e.box_border_thickness;
  if ('show_inner_box' in e) B.showInnerBox = e.show_inner_box;
  if ('bot_name_color' in e) P.botNameColor = e.bot_name_color;
  if ('profile_border_color' in e) P.profileBorderColor = e.profile_border_color;
  if ('dialog_color' in e) T.dialogColor = e.dialog_color;
  if ('narration_color' in e) T.narrationColor = e.narration_color;
  if ('inner_thoughts_color' in e) T.innerThoughtsColor = e.inner_thoughts_color;
  if ('inner_thoughts_bold' in e) T.innerThoughtsBold = e.inner_thoughts_bold;
  if ('divider_outer_color' in e) V.outerColor = e.divider_outer_color;
  if ('divider_inner_color' in e) V.innerColor = e.divider_inner_color;
  if ('divider_solid_color' in e) V.solidColor = e.divider_solid_color;
  if ('image_border_color' in e) A.imageBorderColor = e.image_border_color;
  const ps = e.profile_settings;
  if (ps && typeof ps === 'object') {
    Object.assign(P, profileFlat(ps));
    if ('divider_style' in ps) V.style = ps.divider_style;
    if ('divider_thickness' in ps) V.thickness = ps.divider_thickness;
  }
  if (Array.isArray(e.tag_colors)) out._tagColors = e.tag_colors.slice();
  return out;
}

// profile_settings(컬러프리셋 내부) / profile_sets_* 공통 프로필 평탄화
function profileFlat(ps) {
  const P = {};
  const m = {
    show_profile: 'showProfile', show_profile_image: 'showProfileImage', show_bot_name: 'showBotName',
    show_tags: 'showTags', show_divider: 'showDivider', bot_name: 'botName', frame_style: 'frameStyle',
    image_url: 'imageUrl', show_profile_border: 'showProfileBorder', show_profile_shadow: 'showProfileShadow',
    width: 'width', height: 'height',
  };
  for (const k in m) if (k in ps) P[m[k]] = ps[k];
  return P;
}

// text_settings[name] → text 조각
function textSettingToRaw(e) {
  if (!e || typeof e !== 'object') return {};
  const T = {};
  const m = {
    text_indent: 'textIndent', dialog_color: 'dialogColor', narration_color: 'narrationColor',
    inner_thoughts_color: 'innerThoughtsColor', dialog_bold: 'dialogBold', dialog_newline: 'dialogNewline',
    inner_thoughts_bold: 'innerThoughtsBold', remove_asterisk: 'removeAsterisk', convert_ellipsis: 'convertEllipsis',
    use_text_size: 'useTextSize', text_size: 'textSize', use_text_indent: 'useTextIndent', use_padding: 'usePadding',
  };
  for (const k in m) if (k in e) T[m[k]] = e[k];
  return { text: T };
}

// profile_sets_{name}.json → profile + divider 조각
function profileSetToRaw(e) {
  if (!e || typeof e !== 'object') return {};
  const out = { profile: profileFlat(e), divider: {} };
  if ('bot_name' in e) out.profile.botName = e.bot_name;
  if ('bot_name_color' in e) out.profile.botNameColor = e.bot_name_color;
  if ('profile_border_color' in e) out.profile.profileBorderColor = e.profile_border_color;
  const sz = e.size_settings;
  if (sz && typeof sz === 'object') {
    if ('width' in sz) out.profile.width = sz.width;
    if ('height' in sz) out.profile.height = sz.height;
    if ('frame_style' in sz) out.profile.frameStyle = sz.frame_style; // size_settings.frame_style 우선
  }
  const V = out.divider;
  if ('divider_style' in e) V.style = e.divider_style;
  if ('divider_thickness' in e) V.thickness = e.divider_thickness;
  if ('divider_outer_color' in e) V.outerColor = e.divider_outer_color;
  if ('divider_inner_color' in e) V.innerColor = e.divider_inner_color;
  if ('divider_solid_color' in e) V.solidColor = e.divider_solid_color;
  return out;
}

// 태그 dict(snake) → Pro2 태그(camel)
function tagToCamel(t) {
  if (!t || typeof t !== 'object') return null;
  const out = { text: t.text, color: t.color, style: t.style };
  if ('text_color' in t) out.textColor = t.text_color;
  if ('border_radius' in t) out.borderRadius = t.border_radius;
  if ('font_size' in t) out.fontSize = t.font_size;
  if (t.padding && typeof t.padding === 'object') out.padding = { top: t.padding.top, right: t.padding.right, bottom: t.padding.bottom, left: t.padding.left };
  return out;
}
// tag_sets_{name}.json (bare array) → tags 조각
function tagSetToRaw(arr) { return Array.isArray(arr) ? { tags: arr.map(tagToCamel).filter(Boolean) } : {}; }
// tag_presets[name] = {tags:[...]} → tags 조각
function tagPresetToRaw(e) { return (e && Array.isArray(e.tags)) ? { tags: e.tags.map(tagToCamel).filter(Boolean) } : {}; }

// word_replace_sets_{name}.json (array {from,to}) → wordReplace 조각(공백 보존)
function wordReplaceToRaw(arr) {
  return Array.isArray(arr) ? { wordReplace: arr.filter((x) => x && typeof x === 'object').map((x) => ({ from: String(x.from == null ? '' : x.from), to: String(x.to == null ? '' : x.to) })) } : {};
}
// image_mappings_{name}.json (array {tag,url}) → imageMappings 조각
function mappingSetToRaw(arr) {
  return Array.isArray(arr) ? { imageMappings: arr.filter((x) => x && typeof x === 'object').map((x) => ({ tag: String(x.tag == null ? '' : x.tag), url: String(x.url == null ? '' : x.url) })) } : {};
}

// ---------- 선택 적용 ----------
// classified = classifyLegacyFiles 결과, sel = { colorTemplate, textSetting, profileSet, tagSource:{type:'set'|'preset', name}, wordReplaceSet, mappingSet }
// base = 시작 settings(없으면 현재 기본). 병합 후 sanitizeSettings로 검증 → { settings, warnings }.
// 병합 순서: base ← colorPreset ← profileSet ← textSetting ← (태그/단어치환/매핑 교체).
function applyLegacy(classified, sel, base) {
  const c = classified || {};
  sel = sel || {};
  const merged = base ? deepClone(base) : null; // null이면 sanitize가 기본값 채움
  const acc = merged ? merged : {};

  if (sel.colorTemplate && c.colorTemplates && c.colorTemplates[sel.colorTemplate]) {
    const raw = colorPresetToRaw(c.colorTemplates[sel.colorTemplate]);
    const tagColors = raw._tagColors; delete raw._tagColors;
    deepMerge(acc, raw);
    if (Array.isArray(tagColors)) recolorTags(acc, tagColors); // 위치 태그색
  }
  if (sel.profileSet && c.profileSets && (sel.profileSet in c.profileSets)) {
    deepMerge(acc, profileSetToRaw(c.profileSets[sel.profileSet]));
  }
  if (sel.textSetting && c.textSettings && c.textSettings[sel.textSetting]) {
    deepMerge(acc, textSettingToRaw(c.textSettings[sel.textSetting]));
  }
  // 태그 교체(세트 또는 프리셋)
  if (sel.tagSource && sel.tagSource.name) {
    if (sel.tagSource.type === 'preset' && c.tagPresets && c.tagPresets[sel.tagSource.name]) {
      acc.tags = tagPresetToRaw(c.tagPresets[sel.tagSource.name]).tags;
    } else if (sel.tagSource.type === 'set' && c.tagSets && (sel.tagSource.name in c.tagSets)) {
      acc.tags = tagSetToRaw(c.tagSets[sel.tagSource.name]).tags;
    }
  }
  if (sel.wordReplaceSet && c.wordReplaceSets && (sel.wordReplaceSet in c.wordReplaceSets)) {
    acc.wordReplace = wordReplaceToRaw(c.wordReplaceSets[sel.wordReplaceSet]).wordReplace;
  }
  if (sel.mappingSet && c.mappingSets && (sel.mappingSet in c.mappingSets)) {
    acc.imageMappings = mappingSetToRaw(c.mappingSets[sel.mappingSet]).imageMappings;
  }
  return sanitizeSettings(acc);
}

// 위치 기반 태그 색 적용(색만 교체, 텍스트/스타일 유지). 태그가 색 개수보다 적으면 부족분은 추가.
function recolorTags(acc, colors) {
  if (!Array.isArray(acc.tags)) acc.tags = [];
  for (let i = 0; i < colors.length; i++) {
    if (acc.tags[i]) acc.tags[i].color = colors[i];
    else acc.tags[i] = { text: '태그', color: colors[i], textColor: '#000000', style: '기본', borderRadius: 20, fontSize: 0.85, padding: { top: 0.2, right: 0.8, bottom: 0.2, left: 0.8 } };
  }
}

function deepClone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
function deepMerge(dst, src) {
  for (const k in src) {
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!dst[k] || typeof dst[k] !== 'object' || Array.isArray(dst[k])) dst[k] = {};
      deepMerge(dst[k], v);
    } else {
      dst[k] = v;
    }
  }
  return dst;
}

module.exports = {
  classifyLegacyFiles, applyLegacy,
  colorPresetToRaw, textSettingToRaw, profileSetToRaw,
  tagSetToRaw, tagPresetToRaw, wordReplaceToRaw, mappingSetToRaw, tagToCamel, profileFlat,
};
