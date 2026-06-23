// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/renderTags.js
// 태그 span HTML 생성 — Pro 1.2 create_template 5849-5899 재현.
// css 속성 순서·구분자(';'로 join, 마지막 세미콜론 없음)까지 동일해야 함.
// 그라데이션은 qtColor.lighter/darker(120) 사용.
'use strict';
const { lighter, darker } = require('../color/qtColor.js');

// 태그 1개 → <span ...>텍스트</span> (옛 앱과 바이트 동일)
function renderTagSpan(tag, index, opts = {}) {
  const text = tag.text || `태그 ${index + 1}`;
  const p = tag.padding;
  const css = [
    'display:inline-block',
    `border-radius:${tag.borderRadius}px`,
    `font-size:${tag.fontSize}rem`,
    `padding:${p.top}rem ${p.right}rem ${p.bottom}rem ${p.left}rem`,
    `color:${tag.textColor}`,
    'margin:0.15rem 0.2rem',
    'white-space:nowrap',
  ];

  if (tag.style === '투명 배경') {
    css.push('background:transparent', `border:1px solid ${tag.color}`);
  } else if (tag.style === '그라데이션') {
    const light = lighter(tag.color, 120);
    const dark = darker(tag.color, 120);
    css.push(`background:linear-gradient(135deg, ${light}, ${dark})`, 'border:none');
  } else { // 기본
    css.push(`background:${tag.color}`, 'border:none');
  }

  const cls = opts.hooks ? ' class="lp-tag"' : '';
  return `<span${cls} style="${css.join(';')}">${text}</span>`;
}

function renderTagSpans(tags) {
  return tags.map((t, i) => renderTagSpan(t, i));
}

module.exports = { renderTagSpan, renderTagSpans };
