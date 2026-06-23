// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/cleanup/cleanLog.js — 로그 정리 오케스트레이션(순수, LLM 어댑터는 선택 주입).
//
// translateLog.js 패턴 미러: "마크업 보존 마스킹 + 블록 단위 + 부분 실패 격리". 차이:
//   - 1차 = 결정론 stripJunk(키 불필요·항상 동작). 2차 = 선택적 cleanFn(LLM, 규칙이 못 잡는 포맷).
//   - skipKorean 없음(정리는 언어 무관). cleanFn은 stripJunk 결과 위에서 동작(이미 1차 정리된 산문을 다듬음).
// ★코어 무LLM 원칙 유지 — cleanFn 없으면 순수 결정론. cleanFn은 데스크탑/웹 어댑터가 BYO-key로 주입.
'use strict';
const { stripJunk } = require('./stripJunk.js');
const { maskMarkup, unmaskMarkup, hasProse } = require('../translate/maskMarkup.js');

// 한 텍스트 정리: 1차 stripJunk → (선택)2차 cleanFn(마스킹 보호). cleanFn(maskedProse, ctx)=>Promise<string>.
async function cleanText(text, cleanFn, opts) {
  const first = stripJunk(text, opts);
  if (typeof cleanFn !== 'function') return first;
  const { masked, tokens } = maskMarkup(first);
  if (!first.trim() || !hasProse(masked)) return first;   // 산문 없음 → LLM 호출 0
  const out = await cleanFn(masked, (opts && opts.ctx) || {});
  return unmaskMarkup(String(out == null ? masked : out), tokens);
}

// 여러 블록 정리(순차 = 레이트리밋·순서 보존). 부분 실패 격리(실패 블록은 1차 결과 유지 + failed 기록).
// opts: { onProgress(done,total), cleanFn 없으면 1차만, + stripJunk 카테고리 토글 }.
// 반환 { blocks:[정리된 텍스트…], cleaned(바뀐 블록 수), failed:[{index,error}] }.
async function cleanBlocks(blocks, cleanFn, opts) {
  opts = opts || {};
  const src = Array.isArray(blocks) ? blocks : [];
  const out = src.slice();
  const failed = [];
  let cleaned = 0, done = 0;
  const tick = () => { done++; if (typeof opts.onProgress === 'function') opts.onProgress(done, src.length); };
  for (let i = 0; i < src.length; i++) {
    let r = stripJunk(src[i], opts);   // 1차 결정론(항상)
    if (typeof cleanFn === 'function') {
      const { masked, tokens } = maskMarkup(r);
      if (r.trim() && hasProse(masked)) {
        try { const o = await cleanFn(masked, { index: i }); r = unmaskMarkup(String(o == null ? masked : o), tokens); }
        catch (e) { failed.push({ index: i, error: (e && e.message) || String(e) }); }   // 실패 → 1차 결과 r 유지
      }
    }
    out[i] = r;
    if (r !== String(src[i] == null ? '' : src[i])) cleaned++;
    tick();
  }
  return { blocks: out, cleaned, failed };
}

module.exports = { cleanText, cleanBlocks, stripJunk };
