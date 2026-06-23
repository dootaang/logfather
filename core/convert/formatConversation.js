// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/formatConversation.js
// Pro 1.2 format_conversation (5675-5765) 재현 + Pro 2 스마트 모드(옵션) + 인라인 보호.
//
// parity 모드(기본, settings.text.smartFormat 미설정/false):
//   옛 앱과 바이트 동일. 속마음은 "대사 앞 나레이션"에서만·U+0027만 인식(옛 버그 그대로 보존).
// smart 모드(settings.text.smartFormat === true):
//   줄을 대사/속마음/나레이션 토큰으로 순서대로 분해 → 속마음을 줄 어디서나 인식.
//   속마음 = ‘…’ (U+2018 열기 … U+2019 닫기). 여는따옴표 U+2018만 인정 → don’t/it’s(U+2019) 오작동 없음.
//
// Pro2 마스킹(2026-06-16): 줄을 대사/속마음으로 쪼개기 전에 두 종류를 placeholder로 가린다.
//   ① HTML 태그(런) — 문장 중간 <img>/<aoiimg>/커스텀 태그의 따옴표를 대사로 오인하던 버그 수정.
//   ② 단위(피트/인치) — 키/치수 5'7" · 6' · 12'' 의 ' " 를 대사/속마음 따옴표로 오인하던 버그 수정(#4-A).
//   가린 뒤 텍스트만 처리하고 마지막에 원래대로 복원. **둘 다 없는 입력은 마스킹 미발동 → 옛 동작과 바이트 동일(parity)**.
//   HTML 토큰(U+E000…U+E001)은 블록 통과(narration span 미적용), 단위 토큰(U+E002…U+E003)은 보통 텍스트로 narration에 포함.
'use strict';

const DIALOG = /(\*\*".*?"\*\*|["″“]\s*.+?\s*["″”]|".*?")/g; // 여는 U+0022/U+2033/U+201C, 닫는 U+0022/U+2033/U+201D
const INNER_PARITY = /([']\s*.+?\s*['])/g;                    // 옛 앱: U+0027 쌍
const INNER_SMART = /(‘\s*.+?\s*’)/g;               // Pro2: ‘…’ (U+2018 열기, U+2019 닫기)

// 마스킹 토큰: 사설영역 경계문자로 인덱스를 감쌈(줄바꿈/따옴표 없음 → 줄분할·대사정규식 안 걸림).
const TAG_RUN = /<[^>]*>(?:\s*<[^>]*>)*/g;   // 태그 1개(개행 포함) + 뒤따르는 공백+태그 반복 = 블록 이미지 한 단위
// 단위(피트/인치): 5'7" · 5' 2" · 6' · 12'' · 12″. 본문 숫자-대사(예: "5")와 충돌 않도록 ' 또는 겹따옴표/″만 인식.
const UNIT = /\d+\s*'(?:\s*\d+\s*(?:''|"|″))?|\d+\s*(?:''|″)/g;
const PH_HTML = /(\d+)/;          // HTML placeholder (블록 통과/ raw 대상)
const PH_HTML_G = /(\d+)/g;
const RESTORE = /[](\d+)[]/g; // HTML(E000) + 단위(E002) 모두 복원

// 단위 → 보통 텍스트 토큰(E002), HTML 태그 → 블록 토큰(E000). 같은 store 공유.
function maskSpans(text) {
  const store = [];
  let s = text.replace(UNIT, (m) => '' + (store.push(m) - 1) + ''); // 단위 먼저(따옴표 숨김)
  s = s.replace(TAG_RUN, (m) => '' + (store.push(m) - 1) + '');       // 그 다음 HTML 태그
  return { masked: s, store };
}

function buildCtx(t) {
  const innerColor = (t.innerThoughtsColor == null) ? t.dialogColor : t.innerThoughtsColor;
  const dialogBold = t.dialogBold ? 'font-weight:bold;' : '';
  const innerBold = t.innerThoughtsBold ? 'font-weight:bold;' : '';
  const textSize = t.useTextSize ? `font-size:${t.textSize}px;` : '';
  // 색을 비우면(웹소설형) `color:` 선언 자체를 생략 → 글자색은 상위(리더 잉크 = currentColor)를 상속.
  //   색이 들어오면 `color:VAL; ` 그대로 → 옛 출력과 바이트 동일(parity 보존).
  const colorOf = (col) => col ? `color:${col}; ` : '';
  // 웹소설형 테마안전 강조: currentColor 밑줄(고정색 금지 → 어떤 리더 테마에서도 글자색 따라 자연스러움).
  const dUnder = t.dialogUnderline ? 'border-bottom:0.08em solid currentColor; ' : '';
  // 웹소설형 속마음: 색 대신 이탤릭(테마안전).
  const innerItalic = t.innerThoughtsItalic ? 'font-style:italic;' : '';
  // Pro2 다이어리/웹소설: 대사/속마음 배경 하이라이트(옵션). 미설정이면 옛 출력과 바이트 동일(parity).
  //   웹소설형은 background-color에 color-mix(currentColor ..)를 넣어 반투명 마커를 테마안전하게 칠한다.
  const dBg = t.dialogBgColor ? `background-color:${t.dialogBgColor}; padding:0.05em 0.25em; border-radius:2px; vertical-align:baseline; ` : '';
  const iBg = t.innerThoughtsBgColor ? `background-color:${t.innerThoughtsBgColor}; padding:0.05em 0.1em; border-radius:2px; vertical-align:baseline; ` : '';
  return {
    dialogColor: t.dialogColor,
    innerColor,
    narrationColor: t.narrationColor,
    dialogBold, innerBold, textSize,
    // 배경 없으면 옛 style 문자열과 바이트 동일; 있으면 배경+패딩+라운드(원작 다이어리 quote 스타일).
    dialogStyle: dBg ? `${dBg}${colorOf(t.dialogTextColor || t.dialogColor)}${dUnder}${dialogBold} ${textSize}` : `${colorOf(t.dialogColor)}${dUnder}${dialogBold} ${textSize}`,
    innerStyle: iBg ? `${iBg}${colorOf(t.innerThoughtsTextColor || innerColor)}${innerBold} ${innerItalic}${textSize}` : `${colorOf(innerColor)}${innerBold} ${innerItalic}${textSize}`,
    narrationStyle: `${colorOf(t.narrationColor)}${textSize}`,
    dialogNewline: !!t.dialogNewline,
    hooks: !!t.__outputHooks,
  };
}
const cls = (c, name) => c.hooks ? ` class="${name}"` : '';
const emitDialog = (d, c) => c.dialogNewline
  ? `<div${cls(c, 'lp-dialog-block')} style="margin-top:1em; margin-bottom:1em;"><span${cls(c, 'lp-dialog')} style="${c.dialogStyle}">${d}</span></div>`
  : `<span${cls(c, 'lp-dialog')} style="${c.dialogStyle}">${d}</span>`;
const emitInner = (t, c) => `<span${cls(c, 'lp-inner-thought')} style="${c.innerStyle}">${t}</span>`;
const emitNarr = (t, c) => `<span${cls(c, 'lp-narration')} style="${c.narrationStyle}">${t}</span>`;

// 나레이션 출력 헬퍼: HTML placeholder가 없으면 옛 동작과 동일(통째로 narration span, trim 가드).
// HTML placeholder가 있으면 그 지점에서 끊어 — 텍스트는 narration span, 마스킹된 HTML 토큰은 그대로(끝에서 복원).
// (단위 토큰 E002는 따옴표가 없으므로 여기서 분리 안 하고 텍스트의 일부로 narration span에 포함 → 끝에서 복원)
function pushNarr(parts, text, c) {
  if (!PH_HTML.test(text)) { if (text.trim() !== '') parts.push(emitNarr(text, c)); return; }
  let last = 0;
  for (const m of text.matchAll(PH_HTML_G)) {
    if (m.index > last) { const seg = text.slice(last, m.index); if (seg.trim() !== '') parts.push(emitNarr(seg, c)); }
    parts.push(m[0]);  // 마스킹된 HTML 토큰 — span으로 안 감쌈
    last = m.index + m[0].length;
  }
  if (last < text.length) { const seg = text.slice(last); if (seg.trim() !== '') parts.push(emitNarr(seg, c)); }
}

// parity: 옛 앱 로직 그대로 (속마음은 대사 앞 나레이션에서만, narration 재할당 동작까지 재현)
function processLineParity(line, c) {
  const parts = [];
  let lastEnd = 0;
  for (const m of line.matchAll(DIALOG)) {
    const start = m.index, end = m.index + m[0].length;
    if (start > lastEnd) {
      let narration = line.slice(lastEnd, start);
      if (narration.trim() !== '') {
        for (const im of narration.matchAll(INNER_PARITY)) {
          const prevText = narration.slice(0, im.index);
          pushNarr(parts, prevText, c);
          parts.push(emitInner(im[0], c));
          narration = narration.slice(im.index + im[0].length);
        }
        pushNarr(parts, narration, c);
      }
    }
    parts.push(emitDialog(m[0], c));
    lastEnd = end;
  }
  if (lastEnd < line.length) {
    const remaining = line.slice(lastEnd);
    pushNarr(parts, remaining, c); // ← 옛 버그: 속마음 처리 없음(parity 보존)
  }
  return parts;
}

// smart: 줄 전체를 토큰화 (대사 → 그 사이 나레이션에서 속마음 탐지, 어디서나)
function processLineSmart(line, c) {
  const parts = [];
  const segs = [];
  let lastEnd = 0;
  for (const m of line.matchAll(DIALOG)) {
    if (m.index > lastEnd) segs.push({ d: false, text: line.slice(lastEnd, m.index) });
    segs.push({ d: true, text: m[0] });
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd < line.length) segs.push({ d: false, text: line.slice(lastEnd) });

  for (const seg of segs) {
    if (seg.d) { parts.push(emitDialog(seg.text, c)); continue; }
    let last = 0;
    for (const im of seg.text.matchAll(INNER_SMART)) {
      if (im.index > last) pushNarr(parts, seg.text.slice(last, im.index), c);
      parts.push(emitInner(im[0], c));
      last = im.index + im[0].length;
    }
    if (last < seg.text.length) pushNarr(parts, seg.text.slice(last), c);
  }
  return parts;
}

function formatConversation(text, settings) {
  const t = settings.text;
  const c = buildCtx(t);
  const indent = t.useTextIndent ? t.textIndent : 0;
  const smart = t.smartFormat === true;

  if (t.convertEllipsis) text = text.split('...').join('…');

  // HTML 태그·단위를 placeholder로 마스킹. 둘 다 없으면 masked===text·store 비어 옛 경로 그대로(바이트 parity).
  const { masked, store } = maskSpans(text);
  const hasMask = store.length > 0;

  const out = [];
  for (const line of masked.split('\n')) {
    if (line.trim() === '') { out.push('<p><br></p>'); continue; }
    const tr = line.trim();
    if (hasMask) {
      // 줄이 (마스킹된) HTML 태그로만 이뤄졌으면 그대로 통과 — 인라인/블록 이미지·커스텀 태그 보존.
      // (단위 토큰만 있는 줄은 여기 걸리지 않음 → 아래서 narration으로 처리)
      if (tr.replace(PH_HTML_G, '').trim() === '') { out.push(tr); continue; }
    } else {
      if (tr.startsWith('<') && tr.endsWith('>')) continue; // parity: 마스킹 없는 입력은 옛 드롭 규칙 그대로
    }

    const parts = smart ? processLineSmart(line, c) : processLineParity(line, c);

    const lineCls = settings.__outputHooks ? ' class="lp-line"' : '';
    if (t.useTextIndent) out.push(`<div${lineCls} style="margin-bottom:1rem; text-indent:${indent}px">${parts.join('')}</div>`);
    else out.push(`<div${lineCls} style="margin-bottom:1rem;">${parts.join('')}</div>`);
  }
  // 마스킹된 HTML/단위 토큰을 원래대로 복원(없으면 no-op).
  let result = out.join('\n');
  if (hasMask) result = result.replace(RESTORE, (_m, i) => store[+i]);
  return result;
}

module.exports = { formatConversation };
