// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/prepareBody.js
// 본문(대화) 전처리 파이프라인 — convertText 와 출력 템플릿(로그 다이어리 등)이 공유한다.
// 입력 텍스트 → 이미지태그/마커/단어치환/별표 → 문단분할 + format_conversation → 카드CSS flatten → bg-div→img.
// 반환값 = 카드/템플릿 본문에 그대로 박을 수 있는 인라인 HTML 문자열.
'use strict';
const { formatConversation } = require('./formatConversation.js');
const { processImageTags, collectUrlMappings } = require('./processImageTags.js');
const { resolveAssetMarkers } = require('./risuMarkers.js');
const { expandCardRegex } = require('./cardRegex.js');
const { flattenCss, backgroundDivToImg } = require('./cardStyles.js');

// 카드 표시 regex 가 펼친 RisuAI 에셋 CBS({{raw|asset|source|emotion::이름}})를 매핑 URL로 치환.
// {{img::}} 는 건드리지 않음(processImageTags 가 스타일 <img>로 처리). 미지 이름은 verbatim.
function resolveAssetCBS(text, mappings) {
  if (!text) return text;
  const map = mappings || {};
  return text.replace(/\{\{(?:raw|asset|source|emotion|image_asset)::\s*([^}]+?)\s*\}\}/g, (full, name) => {
    const key = name.trim();
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : full;
  });
}

// Pro2: 마크다운식 강조 — **굵게** → bold, *기울임* → italic (옵션 settings.text.asteriskEmphasis).
// 아카 호환 위해 <strong>/<em> 대신 인라인 스타일 span. ** 먼저(아니면 *로 쪼개짐). 양끝이 비공백인 쌍만
// (예: "2 * 3"의 별표는 공백이 끼어 매칭 안 됨 → 곱셈 오변환 방지). data URL(base64)엔 *가 없어 안전.
function applyAsteriskEmphasis(text) {
  if (!text || text.indexOf('*') < 0) return text;
  text = text.replace(/\*\*(\S(?:[^*\n]*\S)?)\*\*/g, '<span style="font-weight:bold;">$1</span>');
  text = text.replace(/\*(\S(?:[^*\n]*\S)?)\*/g, '<span style="font-style:italic;">$1</span>');
  return text;
}

// Pro2: 입력 서식 마커 — __밑줄__ → 밑줄, ==하이라이트== → 형광. 아카 호환 인라인 span(고정색 금지 →
//   밑줄=currentColor border-bottom, 하이라이트=currentColor 혼합 배경 → 세피아/다크 등 테마에 자동 적응).
//   opt-in: 해당 마커가 "있을 때만" 발동 → 없으면 옛 출력과 바이트 동일(parity). 양끝 비공백 쌍만(오변환 방지).
function applyInlineMarks(text) {
  if (!text) return text;
  if (text.indexOf('__') >= 0) text = text.replace(/__(\S(?:[^_\n]*\S)?)__/g, '<span style="border-bottom:0.08em solid currentColor;">$1</span>');
  if (text.indexOf('==') >= 0) text = text.replace(/==(\S(?:[^=\n]*\S)?)==/g, '<span style="background-color:color-mix(in srgb, currentColor 16%, transparent); padding:0.05em 0.25em; border-radius:2px;">$1</span>');
  return text;
}

function styleFromSettings(ai) {
  if (!ai) return undefined;
  return {
    size: ai.imageSize != null ? ai.imageSize : 100,
    margin: ai.imageMargin != null ? ai.imageMargin : 10,
    useBorder: !!ai.useImageBorder,
    borderColor: ai.imageBorderColor || '#000000',
    useShadow: ai.useImageShadow !== false,
  };
}

// 입력 텍스트 → 본문 HTML. settings 는 (필요시 클론된) 렌더 설정. extraMappings = 카드 에셋 tag→dataURL.
function prepareBody(input, settings, extraMappings) {
  const mappings = Object.assign({}, collectUrlMappings(settings.imageMappings || []), extraMappings || {});
  const imgStyle = styleFromSettings(settings.assetImage) || {};
  if (settings.__outputHooks) imgStyle.hooks = true;
  const useHooks = !!settings.__outputHooks;
  // Pro2: 카드 표시 regex(커스텀 태그 문법) 펼치기 → 펼쳐진 에셋 CBS를 URL로 치환 (둘 다 없으면 no-op).
  let content = expandCardRegex(input, settings.cardRegex || []);
  content = resolveAssetCBS(content, mappings);
  content = processImageTags(content, mappings, imgStyle);
  // Pro2: RisuAI [🌠|이름] 에셋 마커도 변환 (기본 on; settings.text.risuMarkers===false면 끔)
  if (!settings.text || settings.text.risuMarkers !== false) content = resolveAssetMarkers(content, mappings, imgStyle);

  for (const wr of (settings.wordReplace || [])) {
    if (wr.from) content = content.split(wr.from).join(wr.to == null ? '' : wr.to);
  }
  if (settings.text && settings.text.asteriskEmphasis) content = applyAsteriskEmphasis(content); // 별표제거 전에 강조 변환
  if (settings.text.removeAsterisk) content = content.replace(/\*+/g, '');
  content = applyInlineMarks(content); // __밑줄__ · ==하이라이트== (opt-in: 마커 있을 때만, 별표제거 후라 안전)

  const paragraphs = [];
  for (const p of content.split('\n\n')) {
    if (p.trim() === '') continue;
    if (p.trim().startsWith('<div')) paragraphs.push(p);
    else paragraphs.push(`<div${useHooks ? ' class="lp-paragraph"' : ''} style="margin-bottom:1.5rem;">${formatConversation(p, settings)}</div>`);
  }
  content = paragraphs.join('\n');
  // Pro2: 카드 CSS의 단순 셀렉터를 본문 요소에 인라인 flatten (크기/테두리를 요소 style로). 없으면 no-op.
  if (settings.cardCss) content = flattenCss(content, settings.cardCss);
  // Pro2: 카드 background-image div → 아카호환 인라인 <img>(업로드·유지되는 유일 형식). bg 없으면 no-op.
  content = backgroundDivToImg(content);
  return content;
}

module.exports = { prepareBody, resolveAssetCBS, applyAsteriskEmphasis, applyInlineMarks, styleFromSettings };
