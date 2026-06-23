// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/templates/render.js
// 출력 디자인 템플릿 디스패처. 'card'/'custom-css'는 convertText 본체가 직접 처리하고,
// 여기서는 별도 렌더러를 가진 템플릿(로그 다이어리 등)만 분기한다. 미지/미구현이면 null → card 폴백.
'use strict';
const { renderLogDiary } = require('./logDiary.js');
const { renderChatBubble } = require('./chatBubble.js');
const { renderWebnovel } = require('./webnovel.js');

function renderOutputTemplate(id, input, settings, extraMappings) {
  if (id === 'log-diary') return renderLogDiary(input, settings, extraMappings);
  if (id === 'chat') return renderChatBubble(input, settings, extraMappings);
  if (id === 'webnovel') return renderWebnovel(input, settings, extraMappings);
  return null;
}

module.exports = { renderOutputTemplate };
