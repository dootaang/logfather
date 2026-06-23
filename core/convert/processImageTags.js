// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/processImageTags.js
// Pro 1.2 process_image_tags + 헬퍼 (5392-5587) 재현.
// 본문의 이미지 태그 5패턴 × 4토큰을 매핑된 URL의 <img>로 치환. 미매핑 태그는 verbatim.
// 따옴표 클래스 = {U+0027 ' , U+0022 " , U+2033 ″} (소스 코드포인트 추출).
// 정규화는 ″(U+2033)→"(U+0022) 만 기능적(나머지 replace는 no-op).
'use strict';

const Q = "['\"″]";        // 따옴표 클래스 (옵션)
const NQ = "[^}'\"″]";     // 닫는 중괄호/따옴표 제외
// 5개 패턴 (소스 _get_image_patterns 순서대로). 전역.
function getImagePatterns() {
  return [
    new RegExp(`\\{\\{(?:img|image)::${Q}*(${NQ}+)${Q}*\\}\\}`, 'g'),
    new RegExp(`\\{\\{(?:img|image)=${Q}*(${NQ}+)${Q}*\\}\\}`, 'g'),
    new RegExp(`<(?:img|image)\\s+src=${Q}*[^'\"″]+${Q}*>`, 'g'),
    new RegExp(`<(?:img|image)=${Q}*[^>]+${Q}*>`, 'g'),
    new RegExp(`<img=${Q}*[^>]+${Q}*>`, 'g'),
  ];
}

function rstripChars(s, chars) { let e = s.length; while (e > 0 && chars.includes(s[e - 1])) e--; return s.slice(0, e); }
function stripChars(s, chars) { let b = 0, e = s.length; while (b < e && chars.includes(s[b])) b++; while (e > b && chars.includes(s[e - 1])) e--; return s.slice(b, e); }
const STRIP_Q = '"\'″';            // {",',″}
const STRIP_EQ = '{}"\' ″';        // {{,},",',space,″}

function extractTagFromMatch(full) {
  let tag = null;
  if (full.includes('{{')) {
    if (full.includes('img::') || full.includes('image::')) {
      tag = stripChars(rstripChars(full.split('::')[1], '}'), STRIP_Q);
    } else if (full.includes('img=') || full.includes('image=')) {
      tag = stripChars(full.split('=')[1], STRIP_EQ);
    }
  } else if (full.includes('<img') || full.includes('<image')) {
    if (full.includes('src=')) {
      let m = /src=['"″](.*?)['"″]/.exec(full); // 따옴표 있으면 우선
      if (m) tag = m[1];
      else { m = /src=([^'"″\s>]+)/.exec(full); if (m) tag = m[1]; } // 무따옴표 src도 추출 (예: <img src=seolji_excited>)
    } else {
      const m = /=(['"″](.*?)['"″])/.exec(full);
      if (m) tag = m[2];
    }
  }
  return tag;
}

function createBaseStyle(s) {
  let style = `\n            max-width:${s.size}%;\n            margin:${s.margin}px 0;\n            border-radius:12px;\n        `;
  if (s.useBorder) style += `border:2px solid ${s.borderColor};`;
  if (s.useShadow) style += 'box-shadow:rgba(0,0,0,0.12) 0px 4px 16px;';
  return style;
}

function createImageHtml(url, tag, style, opts = {}) {
  const wrapCls = opts.hooks ? ' class="lp-asset-block"' : '';
  const imgCls = opts.hooks ? 'fr-fic fr-dii lp-asset-image' : 'fr-fic fr-dii';
  return `\n            <div${wrapCls} style="margin-bottom:1rem; width:100%; text-align:center;">\n                <img style="${style}" \n                    src="${url}" alt="${tag}" class="${imgCls}">\n            </div>\n        `;
}

function cleanUrl(url) {
  if (url.includes('<img')) { const m = /src=['"](.*?)['"]/.exec(url); if (m) url = m[1]; }
  if (url.startsWith('//')) url = 'https:' + url;
  url = url.replace(/&amp;/g, '&');
  return url.trim();
}

function extractTagIdentifier(tag) {
  if (tag.includes('<img')) { const m = /src=['"](.*?)['"]/.exec(tag); if (m) tag = m[1]; }
  else if (tag.startsWith('{{img::')) tag = stripChars(rstripChars(tag.split('::')[1], '}'), STRIP_Q);
  else if (tag.includes('{{img=')) tag = stripChars(tag.split('=')[1], '{}"\'″');
  if (tag.toLowerCase().endsWith('.png')) tag = tag.slice(0, -4);
  return tag.trim();
}

// UI 입력 엔트리 [{tag, url}] → 정리된 {tag: url} (parity: _collect_url_mappings)
function collectUrlMappings(entries) {
  const m = {};
  for (const e of (entries || [])) {
    let tag = (e.tag || '').trim();
    let url = (e.url || '').trim();
    if (tag && url) {
      if (url.includes('style="width: 0px; height: 0px;"')) url = url.replace('style="width: 0px; height: 0px;"', '');
      m[extractTagIdentifier(tag)] = cleanUrl(url);
    }
  }
  return m;
}

const DEFAULT_STYLE = { size: 100, margin: 10, useBorder: false, borderColor: '#000000', useShadow: true };

// content 내 이미지 태그를 mappings(tag→url)에 따라 <img>로 치환. 미매핑은 verbatim.
function processImageTags(content, mappings, styleSettings) {
  if (!content) return content;
  const baseStyle = createBaseStyle(styleSettings || DEFAULT_STYLE);
  const opts = { hooks: !!(styleSettings && styleSettings.hooks) };
  const map = mappings || {};
  const replaceTag = (full) => {
    const normalized = full.replace(/″/g, '"'); // ″→" (유일한 기능적 정규화)
    const tag = extractTagFromMatch(normalized);
    if (tag && Object.prototype.hasOwnProperty.call(map, tag)) {
      return createImageHtml(map[tag], tag, baseStyle, opts);
    }
    return full;
  };
  let result = content;
  for (const re of getImagePatterns()) result = result.replace(re, replaceTag);
  return result;
}

module.exports = {
  processImageTags, collectUrlMappings, createBaseStyle, createImageHtml,
  extractTagFromMatch, extractTagIdentifier, cleanUrl, getImagePatterns,
};
