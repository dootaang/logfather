// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/cleanup/papaCruft.js — 파파모드(통째 보관) 전용 "보편 군더더기" 제거(순수·결정론·키 불필요).
//
// 파파는 다른 제조기/리스AI가 만든 완성 HTML을 통째로 삼킨다 → stripJunk(텍스트 슬롯·산문 가정)을 못 쓴다.
//   대신 출처 무관하게 "거의 항상 군더더기"인 HTML 블록만 보수적으로 제거한다:
//     ① 사고과정(CoT) 커스텀 태그: <thinking>/<reasoning>/<analysis> 류(표시용 콘텐츠가 아님 = 안전).
//     ② <details> 중 summary가 CoT/번역분석 라벨인 것만(일반 '접기'는 정당한 본문이라 보존 — log-diary 등).
//   ★보수적 — 출처 특정 시그니처·줄 단위 산문 정리는 안 한다(남의 디자인 깨질 위험). 비파괴 토글로만 쓴다(원본 보존).
//   ★idempotent — 두 번 돌려도 같은 결과. ★살균 후 html에 적용(여기선 제거만, 새 태그 주입 없음).
'use strict';

// CoT 커스텀 태그(표시 콘텐츠 아님 — 어느 제조기든 군더더기). <think>…</think> 등.
const COT_TAGS = /<(thinking|thought|thoughts|reasoning|analysis|think|scratchpad|inner_monologue|cot)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
// <details> summary가 이걸 포함하면 CoT/번역분석 접기로 보고 제거(그 외 접기는 정당한 본문 → 보존).
const COT_LABEL = /(생각의?\s*사슬|사고\s*과정|사고\s*흐름|추론\s*과정|번역\s*분석|체인\s*오브|chain[\s-]*of[\s-]*thought|\bcot\b|\bthinking\b|\bthought\s*process\b|\breasoning\b|translation\s*analysis|번역\s*노트)/i;

function stripTags(s) { return String(s || '').replace(/<[^>]*>/g, ''); }

// 파파 html에서 보편 군더더기(CoT 태그 + CoT 라벨 details)만 제거. 반환=정리된 html(나머지 전부 그대로).
function stripPapaCruft(html) {
  let s = String(html == null ? '' : html);
  if (s.indexOf('<') < 0) return s;
  s = s.replace(COT_TAGS, '');
  // <details>…</details> — summary 라벨이 CoT/번역분석이면 통째 제거, 아니면 그대로(중첩 details는 가장 안쪽부터 안전).
  let prev;
  do {
    prev = s;
    s = s.replace(/<details\b[^>]*>((?:(?!<details\b)[\s\S])*?)<\/details\s*>/gi, (full, inner) => {
      const m = /<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/i.exec(inner);
      const label = m ? stripTags(m[1]) : '';
      return COT_LABEL.test(label) ? '' : full;
    });
  } while (s !== prev);
  return s;
}

// 이 html을 실제로 바꾸나?(토글 노출 여부 — 싸게 판정)
function papaCruftChanges(html) { return stripPapaCruft(html) !== String(html == null ? '' : html); }

module.exports = { stripPapaCruft, papaCruftChanges };
