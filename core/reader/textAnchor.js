// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/reader/textAnchor.js — 형광펜 앵커: 리더 본문 텍스트 안의 "이 문장" 위치를 기억·복원. 순수 함수(DOM 없음) → node 테스트.
//   발상 = W3C Web Annotation TextQuoteSelector: 인용(q) + 앞뒤 문맥(pre/post) + 위치 힌트(at). DOM 경로·오프셋은 저장하지 않는다 →
//   정리 규칙 on/off·번역 토글·렌더엔진 갱신으로 DOM이 바뀌어도 "그 텍스트가 남아 있으면" 다시 찾는다. 못 찾으면 null(고아).
//   text = 본문 텍스트 노드를 문서 순서로 이어 붙인 문자열(브라우저 쪽 rootText/Range.toString과 같은 규약).
'use strict';

const CTX = 32;   // 앞뒤 문맥 길이

// [start,end) 구간의 앵커 생성.
function makeAnchor(text, start, end) {
  text = String(text || '');
  start = Math.max(0, Math.min(text.length, start | 0)); end = Math.max(start, Math.min(text.length, end | 0));
  return { q: text.slice(start, end), pre: text.slice(Math.max(0, start - CTX), start), post: text.slice(end, end + CTX), at: start };
}

function allIndexes(hay, needle) {
  const out = []; if (!needle) return out;
  let i = hay.indexOf(needle);
  while (i >= 0) { out.push(i); i = hay.indexOf(needle, i + 1); }
  return out;
}
const suffixMatch = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++; return n; };
const prefixMatch = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; };
// 후보 i(인용 시작)의 문맥 점수 = 앞 문맥 끝 일치 길이 + 뒤 문맥 앞 일치 길이.
function score(text, i, anc) {
  const pre = text.slice(Math.max(0, i - CTX), i), post = text.slice(i + anc.q.length, i + anc.q.length + CTX);
  return suffixMatch(pre, anc.pre || '') + prefixMatch(post, anc.post || '');
}
// 후보 여러 개 → 문맥 점수 최대, 동점이면 위치 힌트(at)에 가까운 것.
function pick(text, cands, anc) {
  if (!cands.length) return -1;
  if (cands.length === 1) return cands[0];
  let best = -1, bs = -1, bd = Infinity;
  for (const i of cands) {
    const s = score(text, i, anc), d = Math.abs(i - (anc.at | 0));
    if (s > bs || (s === bs && d < bd)) { best = i; bs = s; bd = d; }
  }
  return best;
}
// 공백 정규화(연속 공백→한 칸, 앞 공백 제거) + 정규화 인덱스→원본 인덱스 맵.
function normalize(text) {
  let out = ''; const map = []; let ws = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) { if (!ws && out.length) { out += ' '; map.push(i); } ws = true; }
    else { out += ch; map.push(i); ws = false; }
  }
  return { text: out, map };
}

// 앵커 → 현재 text 안의 [start,end) 또는 null(고아). 순서: ①pre+q+post 정확 일치 ②q만(문맥 점수·힌트) ③공백 무시.
function resolveAnchor(text, anc) {
  text = String(text || '');
  if (!anc || typeof anc.q !== 'string' || !anc.q) return null;
  const pre = anc.pre || '', post = anc.post || '';
  const full = pre + anc.q + post;
  if (full.length > anc.q.length) {
    const idx = allIndexes(text, full);
    if (idx.length) { const i = pick(text, idx.map((x) => x + pre.length), anc); return [i, i + anc.q.length]; }
  }
  const idx = allIndexes(text, anc.q);
  if (idx.length) { const i = pick(text, idx, anc); return [i, i + anc.q.length]; }
  const nt = normalize(text); const nq = normalize(anc.q).text.trim();
  if (!nq) return null;
  const nidx = allIndexes(nt.text, nq);
  if (!nidx.length) return null;
  const ni = pick(nt.text, nidx, { q: nq, pre: normalize(pre).text, post: normalize(post).text, at: anc.at });
  return [nt.map[ni], nt.map[ni + nq.length - 1] + 1];
}

module.exports = { makeAnchor, resolveAnchor, CTX };
