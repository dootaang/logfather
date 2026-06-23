// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/risuMarkers.js
// Pro 2: RisuAI 로그의 에셋 마커 [접두사|에셋이름] → 임베드 이미지로 변환.
//   예: [🌠|tarumaemaru.happy]  (이름은 확장자 없는 형태가 많음)
// mappings(이름→url)에 매칭되는 이름만 변환, 미매칭은 verbatim(일반 대괄호 텍스트 보호).
'use strict';
const { createImageHtml, createBaseStyle } = require('./processImageTags.js');

const MARKER = /\[[^\]|\n]*\|\s*([^\]\n]+?)\s*\]/g; // [<prefix>|<name>]

const DEFAULT_STYLE = { size: 100, margin: 10, useBorder: false, borderColor: '#000000', useShadow: true };

function resolveAssetMarkers(content, mappings, styleSettings) {
  if (!content) return content;
  const map = mappings || {};
  const baseStyle = createBaseStyle(styleSettings || DEFAULT_STYLE);
  const opts = { hooks: !!(styleSettings && styleSettings.hooks) };
  return content.replace(MARKER, (full, name) => {
    const key = name.trim();
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      return createImageHtml(map[key], key, baseStyle, opts);
    }
    return full; // 미매칭 마커/일반 텍스트는 그대로
  });
}

module.exports = { resolveAssetMarkers, MARKER };
