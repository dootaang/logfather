// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/cleanup/stripJunk.js — 가져온 RP 로그의 군더더기 제거(순수·결정론·키 불필요).
//
// LLM이 뱉은 응답 스캐폴딩(헤더·생각의 사슬·OOC·코드펜스·화자 라벨)을 걷어내고 RP 본문만 남긴다.
// ★보수적 — 고신뢰 패턴만 제거하고 실제 산문은 안 건드린다. ★마크업 보존 — 대사/이미지/에셋마커/카드구조는
//   maskMarkup으로 가린 뒤 라인/인라인 정리를 하므로 절대 안 깨진다. 블록형 군더더기(생각의 사슬·코드펜스)는
//   html을 품으므로 마스킹 전에 통째로 제거한다. 규칙은 카테고리 토글로 확장 가능(향후 패턴 추가 용이).
// 결정론·idempotent(두 번 돌려도 같은 결과) → 코어 무LLM 정체성 부합.
'use strict';
const { maskMarkup, unmaskMarkup } = require('../translate/maskMarkup.js');

// 카테고리 토글 기본값. F(상태창·구분선)는 오작동 여지가 있어 기본 off(opt-in).
const DEFAULTS = { headers: true, cot: true, ooc: true, codeFence: true, speakerLabels: true, statusBlocks: false, dividers: false };

function stripJunk(text, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  let s = String(text == null ? '' : text);

  // ── B. 생각의 사슬(CoT) 접기 — html 블록이라 마스킹 전에 통째 제거 ──
  if (o.cot) {
    s = s.replace(/<details\b[^>]*>[\s\S]*?<\/details\s*>/gi, '');                                   // <details>…</details>(summary 포함)
    s = s.replace(/<(thinking|thought|thoughts|reasoning|analysis|think|scratchpad|inner_monologue)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ''); // <thinking>…</thinking> 류
  }
  // ── D. 응답 전체를 감싼 코드펜스 껍데기만 제거(안쪽 본문 유지) ──
  if (o.codeFence) {
    const t = s.trim();
    const m = /^```[^\n`]*\n([\s\S]*?)\n?```$/.exec(t);
    if (m) s = m[1];
  }

  // ── 마크업 보호: 대사 따옴표는 산문이라 그대로, <img>/{{...}}/[x|name]는 placeholder로 가림 ──
  const { masked, tokens } = maskMarkup(s);
  const out = [];
  for (let line of masked.split('\n')) {
    const t = line.trim();
    // A. 응답 스캐폴딩 헤더(## Response / ### 응답 등) — 줄 통째 제거 (\b 미사용: 한글은 ASCII 경계가 없음)
    if (o.headers && /^#{1,6}\s*(response|reply|answer|output|리스폰스|리스폰|응답|답변|출력|리플라이)/i.test(t)) continue;
    if (o.ooc) {
      // C. OOC·메타 줄 / 시스템·노트 브래킷으로 시작하는 줄 통째 제거(뒤 텍스트 있어도)
      if (/^ooc\s*[:：]/i.test(t)) continue;
      if (/^\(\s*ooc\b[\s\S]*\)\s*$/i.test(t)) continue;
      if (/^\[\s*(system|note|author'?s?\s*note|시스템|노트|작가의?\s*말)[^\]]*\]/i.test(t)) continue;
    }
    // F. (opt-in) 상태창/스탯 줄 · 구분선 줄
    if (o.statusBlocks && /^(status|time|location|hp|mp|stats?|상태|시간|장소|위치)\s*[:：]/i.test(t)) continue;
    if (o.dividers && /^[-=_*~]{3,}$/.test(t)) continue;
    // E. 화자 라벨(줄머리 AI:/Assistant:/Narrator:/{{char}}: 류) — 라벨만 떼고 본문 유지
    if (o.speakerLabels) {
      line = line.replace(/^\s*⟦\d+⟧\s*[:：]\s*/, '');   // {{char}}: 처럼 마스킹된 라벨(토큰+콜론)
      line = line.replace(/^\s*(ai|assistant|asst|bot|narrator|system|sys|봇|나레이터|내레이터|나레이션|시스템)\s*[:：]\s*/i, '');
    }
    out.push(line);
  }
  let res = out.join('\n');
  // C. 인라인 OOC/메타 제거
  if (o.ooc) {
    res = res.replace(/\(\(\s*[\s\S]*?\)\)/g, '');           // ((OOC 메모))
    res = res.replace(/\(\s*ooc\s*[:：][^)]*\)/gi, '');        // (OOC: …)
    res = res.replace(/\[\s*ooc\s*[:：][^\]]*\]/gi, '');       // [OOC: …]
  }
  res = unmaskMarkup(res, tokens);
  // 정리: 줄끝 공백·과도한 빈 줄·앞뒤 공백
  res = res.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  return res;
}

module.exports = { stripJunk, DEFAULTS };
