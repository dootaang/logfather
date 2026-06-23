// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/templates/webnovel.js
// 출력 디자인 "웹소설형" — 활자에 집중하는 줄글 본문. 종이/세피아/다크/night 테마.
//   · 데이터 = settings.templateSettings.webnovel = { messages?, theme, dialogEmphasis, innerItalic, dialogNewline, textIndent, paraGap, ... }
//     messages = [{ role, text }] (채팅 가져오기). 없으면 입력란(input) 폴백.
//   · ★테마(배경+글자색)는 래퍼 div 에 인라인으로 "굽는다" → 아카(div의 background/color/padding/border-radius 생존) ·
//     미리보기 · 서재 리더 · 리치 복사 어디서나 같은 테마로 보인다. 글자색은 테마 잉크(currentColor) 상속.
//   · 대사/속마음/나레이션 강조는 "상대 스타일만"(currentColor 밑줄·볼드·반투명 마커·이탤릭) → 테마 잉크에 자동 적응.
//   · 본문 변환은 기본 엔진(prepareBody=formatConversation)을 그대로 재사용 → 대사/속마음/이미지/마커/단어치환 동일 동작.
'use strict';
const { prepareBody } = require('../prepareBody.js');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const WEBNOVEL_DEFAULTS = { messages: [] };

// 리더와 동일한 팔레트(서재 .reader[data-theme] 와 색 일치) → 편집기 미리보기·리더·리치복사가 같은 톤.
const WN_THEMES = {
  light: { bg: '#f4f1ea', ink: '#2b2b2b' },
  sepia: { bg: '#f1e6cf', ink: '#4a3f2c' },
  dark: { bg: '#20242b', ink: '#d7dce4' },
  black: { bg: '#000000', ink: '#c6c6c6' },
};

// 장(章) 구분 — 다이어리식 "가운데 제목 + 얇은 선". 색은 currentColor(리더 잉크)라 어느 테마에서도 자연스럽다.
//   · 제목 있으면 가운데 굵은 제목 + 바로 아래 짧은 밑줄(아카 안전: position/flex 안 씀, 인라인 span).
//   · hooks(=custom-css base=webnovel일 때만 true) → .lp-wn-chapter 클래스 emit. ★off면 클래스 없이 바이트 동일(골든).
function chapterDivider(title, hooks) {
  const cls = hooks ? ' class="lp-wn-chapter"' : '';
  const t = String(title || '').trim();
  if (t) {
    return '<div' + cls + ' style="text-align:center; margin:2.8em 0 1.7em; line-height:1.45;">'
      + '<span style="display:inline-block; font-weight:700; font-size:1.12em; letter-spacing:0.06em; '
      + 'border-bottom:1px solid currentColor; padding:0 0.7em 0.34em;">' + esc(t) + '</span></div>';
  }
  return sceneBreakMark(hooks);
}

// 장면 전환 기호 — 당구장 기호 ※ ※ ※ (가운데, 자간 띄움, 살짝 옅게). currentColor 기반이라 모든 테마에서 잉크 톤을 따른다.
//   아카 안전: 인라인 스타일만(position/flex 안 씀). hooks ON일 때만 .lp-wn-scenebreak emit(off=바이트 동일).
function sceneBreakMark(hooks) {
  const cls = hooks ? ' class="lp-wn-scenebreak"' : '';
  return '<div' + cls + ' style="text-align:center; margin:2.4em 0; letter-spacing:0.5em; font-size:0.9em; opacity:0.7;">※ ※ ※</div>';
}

// 반투명 마커 — currentColor(글자색) 기반이라 종이/세피아/다크 어디서나 톤이 맞는다(고정색 금지).
const MARKER_BG = 'color-mix(in srgb, currentColor 14%, transparent)';

// 웹소설 cfg 노브 → formatConversation 이 읽는 settings.text 로 매핑(색은 전부 비움 = 리더가 제어).
function textOptsFromCfg(cfg, settings) {
  const emph = cfg.dialogEmphasis || 'none';   // none | bold | underline | marker
  const baseRisu = settings.text ? settings.text.risuMarkers : true;
  return {
    smartFormat: cfg.smartFormat !== false,         // 웹소설 기본 = 속마음 어디서나 인식
    convertEllipsis: cfg.convertEllipsis !== false, // ... → …
    risuMarkers: baseRisu !== false,
    asteriskEmphasis: cfg.asteriskEmphasis !== false, // *기울임* / **굵게**
    removeAsterisk: !!cfg.removeAsterisk,
    // 색은 모두 비움 → color 선언 생략 → currentColor(리더 잉크) 상속.
    dialogColor: '', narrationColor: '', innerThoughtsColor: '',
    // 테마안전 강조(고정색 없음)
    dialogBold: emph === 'bold',
    dialogUnderline: emph === 'underline',
    dialogBgColor: emph === 'marker' ? MARKER_BG : '',
    innerThoughtsItalic: cfg.innerItalic !== false, // 속마음 기본 이탤릭
    dialogNewline: !!cfg.dialogNewline,
    useTextIndent: (+cfg.textIndent || 0) > 0,
    textIndent: +cfg.textIndent || 0,
  };
}

function renderWebnovel(input, settings, extraMappings) {
  const cfg = Object.assign({}, WEBNOVEL_DEFAULTS, (settings.templateSettings && settings.templateSettings.webnovel) || {});
  // ★훅: custom-css base=webnovel일 때만 settings.__outputHooks=true → 본문(.lp-dialog 등)·구조(.lp-wn-*) 클래스 emit.
  //   off(일반 웹소설)면 prepareBody useHooks=false + 구조 클래스 없음 → 옛 출력과 바이트 동일(골든 패리티).
  const hooks = !!settings.__outputHooks;
  // 색을 안 굽도록 webnovel 전용 settings.text 로 본문 변환(나머지 설정=카드 regex/매핑/단어치환/에셋 이미지는 그대로).
  const s2 = Object.assign({}, settings, { __outputHooks: hooks, text: Object.assign(textOptsFromCfg(cfg, settings), { __outputHooks: hooks }) });
  const gap = cfg.paraGap != null ? +cfg.paraGap : 1.5;
  const applyGap = (html) => (gap !== 1.5 ? html.replace(/margin-bottom:1\.5rem;/g, 'margin-bottom:' + gap + 'rem;') : html);
  // 테마(배경+글자색)를 래퍼 div에 굽는다(아카 생존). theme 없으면 색을 안 굽어 리더/상속에 맡김(하위호환).
  const th = WN_THEMES[cfg.theme];
  const themeStyle = th ? ('background:' + th.bg + '; color:' + th.ink + '; padding:2.2em 1.7em; border-radius:0.7rem;') : '';
  const wrap = (inner) => '<div class="lp-webnovel" style="max-width:620px;margin:0 auto;' + themeStyle + '">' + inner + '</div>';

  // ── 장(章) 블록 모드: 제목 있는 블록은 챕터 구분선(제목+선). 제목 없는 블록은 기본은 깔끔히 분리하되,
  //    sceneBreak 켜면 제목 없는 인접 블록들 "사이"에 ※ ※ ※ 장면 전환 기호(맨 앞 블록 앞에는 안 넣음).
  //    (자동 분할 소설=켜짐 권장 / 채팅 턴 분할=꺼짐 권장 — 토글로 제어.) ──
  if (cfg.useBlocks && Array.isArray(cfg.blocks)) {
    const blocks = cfg.blocks.filter((b) => b && (String(b.content || '').trim() || String(b.title || '').trim()));
    if (blocks.length) {
      const sceneBreak = cfg.sceneBreak !== false;   // 기본 켜짐(미설정=ON). 사용자가 명시적으로 끈 경우만 off.
      const parts = blocks.map((b, i) => {
        const hasTitle = String(b.title || '').trim();
        let div = '';
        if (hasTitle) div = chapterDivider(b.title, hooks);
        else if (sceneBreak && i > 0 && !String(blocks[i - 1].title || '').trim()) div = sceneBreakMark(hooks);  // 제목 없는 블록 사이만
        const body = applyGap(prepareBody(String(b.content || ''), s2, extraMappings));
        return div + body;
      });
      return wrap(parts.join('\n'));
    }
  }

  // ── 프로즈 모드(기본): messages(채팅 가져오기) 또는 입력란을 줄글로. ──
  const msgs = Array.isArray(cfg.messages) ? cfg.messages.filter((m) => m && String(m.text || '').trim() !== '') : [];
  const bodyText = msgs.length ? msgs.map((m) => String(m.text || '').trim()).join('\n\n') : String(input || '').trim();
  if (!bodyText) return '';
  return wrap(applyGap(prepareBody(bodyText, s2, extraMappings)));
}

module.exports = { renderWebnovel, WEBNOVEL_DEFAULTS };
