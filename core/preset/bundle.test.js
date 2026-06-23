// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/preset/bundle.test.js
// 프리셋 번들(export/import 살균/라운드트립) + 레거시 Pro1 임포터(분류/매핑) 검증.
'use strict';
const assert = require('assert');
const {
  defaultSettings, sanitizeSettings, buildBundle, parseBundle, APP_ID, BUNDLE_VERSION,
} = require('./bundle.js');
const {
  classifyLegacyFiles, applyLegacy, colorPresetToRaw, textSettingToRaw, profileSetToRaw,
  tagSetToRaw, tagPresetToRaw, wordReplaceToRaw, mappingSetToRaw,
} = require('./legacy.js');

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg + ` (got ${JSON.stringify(a)})`); console.log('  ✓ ' + msg); n++; };

// ── 라운드트립: buildBundle → parseBundle 동일 ──
{
  const s = defaultSettings();
  s.profile.botName = '테스트봇';
  s.box.shadowIntensity = 25;
  s.tags.push({ text: '커스텀', color: '#aabbcc', textColor: '#112233', style: '그라데이션', borderRadius: 12, fontSize: 1.1, padding: { top: 0.3, right: 1, bottom: 0.3, left: 1 } });
  s.wordReplace.push({ from: '{{user}}', to: '하나' });
  s.imageMappings.push({ tag: 'happy', url: 'https://x.com/h.png' });
  const bundle = buildBundle(s);
  ok(bundle.app === APP_ID && bundle.version === BUNDLE_VERSION && bundle.kind === 'preset', '번들 헤더(app/version/kind) 부여');
  const json = JSON.parse(JSON.stringify(bundle)); // 직렬화 왕복
  const { settings: back } = parseBundle(json);
  eq(back.profile.botName, '테스트봇', '라운드트립: botName 보존');
  eq(back.box.shadowIntensity, 25, '라운드트립: 숫자 보존');
  eq(back.tags.length, 3, '라운드트립: 태그 개수 보존');
  eq(back.tags[2], s.tags[2], '라운드트립: 커스텀 태그 무손실(반경/폰트/패딩)');
  eq(back.wordReplace[0], { from: '{{user}}', to: '하나' }, '라운드트립: 단어치환 보존');
  eq(back.imageMappings[0], { tag: 'happy', url: 'https://x.com/h.png' }, '라운드트립: 이미지 매핑 보존');
}

// ── export: data:URL 프로필 이미지(카드 아이콘)는 제외, 외부 URL은 유지 ──
{
  const s = defaultSettings(); s.profile.imageUrl = 'data:image/png;base64,AAAA';
  ok(buildBundle(s).settings.profile.imageUrl === '', 'export: data: 프로필 이미지는 휴대성 위해 제외');
  s.profile.imageUrl = 'https://x.com/a.png';
  ok(buildBundle(s).settings.profile.imageUrl === 'https://x.com/a.png', 'export: 외부 URL 프로필 이미지는 유지');
}

// ── 살균: 색은 hex, 숫자는 clamp, enum 화이트리스트, 불리언 강제 ──
{
  const { settings, warnings } = sanitizeSettings({
    box: { outerBoxColor: 'red', shadowIntensity: 9999, boxBorderThickness: 0 },
    profile: { frameStyle: '해킹', width: -5, showProfile: 'yes' },
    divider: { style: 'xxx', thickness: 100 },
    text: { textSize: 2, dialogColor: '#GGGGGG' },
  });
  ok(settings.box.outerBoxColor === '#ffffff', '살균: 잘못된 색(red) → 기본값');
  ok(settings.box.shadowIntensity === 40, '살균: 그림자 9999 → 40 clamp');
  ok(settings.box.boxBorderThickness === 1, '살균: 테두리굵기 0 → 1 clamp');
  ok(settings.profile.frameStyle === '동그라미', '살균: 알 수 없는 enum → 기본값');
  ok(settings.profile.width === 20, '살균: 너비 -5 → 20 clamp');
  ok(settings.profile.showProfile === true, "살균: 'yes' → true 강제");
  ok(settings.divider.style === '그라데이션', '살균: 잘못된 divider enum → 기본');
  ok(settings.divider.thickness === 4, '살균: divider thickness 100 → 4 clamp');
  ok(settings.text.textSize === 8, '살균: textSize 2 → 8 clamp');
  ok(settings.text.dialogColor === '#2d3748', '살균: #GGGGGG → 기본 색');
  ok(Array.isArray(warnings), '살균: warnings 배열 반환');
}

// ── 살균: XSS 차단(botName 꺾쇠 제거, imageUrl javascript: 차단, 태그텍스트 꺾쇠 제거) ──
{
  const { settings, warnings } = sanitizeSettings({
    profile: { botName: '<img src=x onerror=alert(1)>봇', imageUrl: 'javascript:alert(1)' },
    tags: [{ text: '<b>해킹</b>', color: '#ffffff', textColor: '#000000', style: '기본' }],
    imageMappings: [{ tag: 'a', url: 'javascript:steal()' }],
  });
  ok(settings.profile.botName.indexOf('<') < 0 && settings.profile.botName.indexOf('>') < 0, '살균: botName 꺾쇠 제거(주입 차단)');
  ok(settings.profile.imageUrl === '', '살균: imageUrl javascript: 차단');
  ok(settings.tags[0].text.indexOf('<') < 0, '살균: 태그 텍스트 꺾쇠 제거');
  ok(settings.imageMappings[0].url === '', '살균: 매핑 URL javascript: 차단');
  ok(warnings.length > 0, '살균: 위험 항목에 경고 기록');
}

// ── 비-객체/누락 입력 안전 ──
{
  ok(sanitizeSettings(null).settings.profile.botName === '봇 이름', '살균: null 입력 → 기본값');
  ok(parseBundle('not json').warnings.length > 0, 'parseBundle: 비객체 입력 경고');
  ok(parseBundle({ app: 'other-app', settings: {} }).warnings.some((x) => x.includes('다른 앱')), 'parseBundle: 다른 앱 경고');
}

// ── UI 토글 라운드트립 ──
{
  const b = buildBundle(defaultSettings(), { cardRegexOn: false, cardCssOn: true, cardTextManual: true });
  const { ui } = parseBundle(JSON.parse(JSON.stringify(b)));
  eq(ui, { cardRegexOn: false, cardCssOn: true, cardTextManual: true }, 'UI 토글 상태 라운드트립');
}

// ──────────── 레거시 Pro1 임포터 ────────────

// ── 분류: 파일명 패턴, 이름 복원(접두사 슬라이스, '_' 포함 이름 보존) ──
{
  const files = [
    { name: 'color_presets.json', json: { '내프리셋': { outer_box_color: '#111111' } } },
    { name: 'text_settings.json', json: { '글자A': { text_indent: 30 } } },
    { name: 'tag_presets.json', json: { '태그모음': { tags: [{ text: 'x', color: '#fff', style: '기본' }] } } },
    { name: 'profile_sets_내_프로필.json', json: { bot_name: '루시' } }, // 이름에 '_' 포함
    { name: 'tag_sets_세트1.json', json: [{ text: 'y', color: '#000', style: '기본' }] },
    { name: 'word_replace_sets_치환1.json', json: [{ from: 'a', to: 'b' }] },
    { name: 'image_mappings_맵1.json', json: [{ tag: 't', url: 'u' }] },
    { name: 'image_mappings.json', json: { 'http://x': 'y' } }, // dict → 캐시
    { name: '엉뚱한파일.json', json: {} },
  ];
  const c = classifyLegacyFiles(files);
  ok('내프리셋' in c.colorTemplates, '분류: color_presets dict 흡수');
  ok('글자A' in c.textSettings, '분류: text_settings dict 흡수');
  ok('태그모음' in c.tagPresets, '분류: tag_presets dict 흡수');
  ok('내_프로필' in c.profileSets, "분류: profile_sets 이름 복원('_' 포함 보존)");
  ok('세트1' in c.tagSets, '분류: tag_sets bare array');
  ok('치환1' in c.wordReplaceSets, '분류: word_replace_sets');
  ok('맵1' in c.mappingSets, '분류: image_mappings_*');
  ok(c.legacyImageCache && c.legacyImageCache['http://x'] === 'y', '분류: image_mappings.json(dict)=캐시');
  ok(c.unknown.indexOf('엉뚱한파일.json') >= 0, '분류: 알 수 없는 파일 기록');
}

// ── image_mappings.json(array, 접미사 없음) → 형태 폴백으로 매핑셋 ──
{
  const c = classifyLegacyFiles([{ name: 'image_mappings.json', json: [{ tag: 'a', url: 'b' }] }]);
  ok('(기본)' in c.mappingSets, '분류: image_mappings.json(array)=매핑셋(형태 폴백)');
}

// ── 색상 프리셋 매핑(snake→camel, tag_colors 위치, profile_settings 평탄화) ──
{
  const raw = colorPresetToRaw({
    outer_box_color: '#101010', inner_box_color: '#202020', box_border_color: '#303030',
    use_box_border: true, box_border_thickness: 5, show_inner_box: true,
    bot_name_color: '#404040', dialog_color: '#505050', narration_color: '#606060',
    inner_thoughts_color: '#707070', divider_outer_color: '#808080', divider_inner_color: '#909090',
    divider_solid_color: '#a0a0a0', image_border_color: '#b0b0b0',
    tag_colors: ['#c0c0c0', '#d0d0d0'],
    profile_settings: { show_profile: false, bot_name: '오르카', frame_style: '직사각형', width: 120, height: 140, divider_style: '단색', divider_thickness: 3 },
  });
  eq(raw.box, { outerBoxColor: '#101010', innerBoxColor: '#202020', boxBorderColor: '#303030', useBoxBorder: true, boxBorderThickness: 5, showInnerBox: true }, '색프리셋: box snake→camel');
  eq(raw.text, { dialogColor: '#505050', narrationColor: '#606060', innerThoughtsColor: '#707070' }, '색프리셋: text 색');
  eq(raw.assetImage, { imageBorderColor: '#b0b0b0' }, '색프리셋: 에셋 테두리색');
  eq(raw.divider, { outerColor: '#808080', innerColor: '#909090', solidColor: '#a0a0a0', style: '단색', thickness: 3 }, '색프리셋: divider(색+style/thickness from profile_settings)');
  eq(raw.profile.frameStyle, '직사각형', '색프리셋: profile_settings 평탄화(frameStyle)');
  eq(raw.profile.width, 120, '색프리셋: width 평탄화');
  eq(raw._tagColors, ['#c0c0c0', '#d0d0d0'], '색프리셋: tag_colors 위치 리스트 보존');
}

// ── 프로필 세트(size_settings.frame_style 우선) ──
{
  const raw = profileSetToRaw({ bot_name: '나비', frame_style: '동그라미', size_settings: { width: 200, height: 210, frame_style: '직사각형' }, divider_style: '그라데이션' });
  eq(raw.profile.frameStyle, '직사각형', '프로필세트: size_settings.frame_style 우선');
  eq(raw.profile.width, 200, '프로필세트: size_settings.width 평탄화');
  eq(raw.profile.botName, '나비', '프로필세트: bot_name → botName');
}

// ── 태그 세트/프리셋(border_radius/font_size/padding 무손실) ──
{
  const t = { text: '모델', color: '#eeeeee', text_color: '#222222', style: '그라데이션', border_radius: 15, font_size: 0.9, padding: { top: 0.1, right: 0.5, bottom: 0.1, left: 0.5 } };
  eq(tagSetToRaw([t]).tags[0], { text: '모델', color: '#eeeeee', textColor: '#222222', style: '그라데이션', borderRadius: 15, fontSize: 0.9, padding: { top: 0.1, right: 0.5, bottom: 0.1, left: 0.5 } }, '태그세트: snake→camel 무손실');
  eq(tagPresetToRaw({ tags: [t] }).tags[0].borderRadius, 15, '태그프리셋: {tags:[]} 래핑 처리');
}

// ── 단어치환 공백 보존 + 매핑셋 ──
{
  eq(wordReplaceToRaw([{ from: ' 공백 ', to: '' }]).wordReplace[0], { from: ' 공백 ', to: '' }, '단어치환: 공백 보존 + to:"" 정당');
  eq(mappingSetToRaw([{ tag: 'happy', url: 'https://x/h.png' }]).imageMappings[0], { tag: 'happy', url: 'https://x/h.png' }, '매핑셋: tag/url 그대로');
}

// ── 통합 적용: 분류 → 선택 → settings (살균 통과) ──
{
  const files = [
    { name: 'color_presets.json', json: { '베이스': { outer_box_color: '#123456', tag_colors: ['#abcdef'], profile_settings: { bot_name: '메인', frame_style: '배너' } } } },
    { name: 'text_settings.json', json: { '글자': { text_indent: 40, text_size: 18 } } },
    { name: 'tag_sets_T1.json', json: [{ text: '태그X', color: '#fedcba', text_color: '#000000', style: '기본' }] },
    { name: 'word_replace_sets_W1.json', json: [{ from: '{{char}}', to: '오르카' }] },
    { name: 'image_mappings_M1.json', json: [{ tag: 'smile', url: 'https://x/s.png' }] },
  ];
  const c = classifyLegacyFiles(files);
  const { settings, warnings } = applyLegacy(c, {
    colorTemplate: '베이스', textSetting: '글자',
    tagSource: { type: 'set', name: 'T1' }, wordReplaceSet: 'W1', mappingSet: 'M1',
  });
  ok(settings.box.outerBoxColor === '#123456', '통합: 색프리셋 박스색 적용');
  ok(settings.profile.botName === '메인' && settings.profile.frameStyle === '배너', '통합: 프로필 평탄화 적용');
  ok(settings.text.textIndent === 40 && settings.text.textSize === 18, '통합: 텍스트 설정 적용');
  ok(settings.tags.length === 1 && settings.tags[0].text === '태그X', '통합: 태그 세트 교체');
  ok(settings.wordReplace[0].to === '오르카', '통합: 단어치환 교체');
  ok(settings.imageMappings[0].url === 'https://x/s.png', '통합: 매핑 교체');
  ok(Array.isArray(warnings), '통합: 살균 거쳐 warnings 반환');
}

console.log(`\npreset(bundle+legacy): ${n} assertions ✓`);
