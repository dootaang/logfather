// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/readStats.ts — 읽기 이력(일별) 적재. "내 기록"(통계·연말 결산)의 원료 배관.
//
// ★저장 위치 = 기존 읽기상태 KV(pro2-read) 객체 안의 hist 필드 한 칸.
//   화를 열 때마다 이미 일어나는 saveRead(READ_KEY) 쓰기 1회에 편승 → Firestore 추가 쓰기 0,
//   로그인 시 다른 읽기상태와 같은 문서로 자동 동기화(기기 간 결산 일치). loadRead의 {...o} 스프레드가
//   미지 필드를 보존하므로 구버전과 왕복해도 hist가 안 깎인다.
// 모양: read.hist = { 'YYYY-MM-DD': { o: 화 열람 수, f: 처음 읽은 화 수, w: { 작품키: 열람 수 } } }
//   o = 스트릭/일별 추이용(재독 포함) · f = "총 읽은 화" 순증가용 · w = "최다 읽은 작품"용.
// @ts-nocheck

const KEEP_DAYS = 400;   // 연간 결산 + 여유. 넘치면 오래된 날부터 정리(동기화 KV 문서 비대 방지).

// 사용자 체감 하루 = 로컬 타임존 날짜.
export function todayKey(d?: Date): string {
  const t = d || new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
}

let lastBump = '';   // 같은 화 연속 재렌더(번역 자동복원 등 즉시 re-route) 중복 집계 방지

// read(pro2-read 객체)를 제자리 수정 — 호출부가 곧바로 saveRead(read)를 부른다(쓰기 편승).
export function bumpReadHistory(read: any, char: string, id: string, firstRead: boolean): void {
  if (!read || !char || !id) return;
  const day = todayKey();
  const key = day + '|' + char + '|' + id;
  if (key === lastBump) return;
  lastBump = key;
  const hist = (read.hist && typeof read.hist === 'object' && !Array.isArray(read.hist)) ? read.hist : (read.hist = {});
  const d = (hist[day] && typeof hist[day] === 'object') ? hist[day] : (hist[day] = { o: 0, f: 0, w: {} });
  d.o = (d.o || 0) + 1;
  if (firstRead) d.f = (d.f || 0) + 1;
  if (!d.w || typeof d.w !== 'object') d.w = {};
  d.w[char] = (d.w[char] || 0) + 1;
  const days = Object.keys(hist);
  if (days.length > KEEP_DAYS) { days.sort(); for (const k of days.slice(0, days.length - KEEP_DAYS)) delete hist[k]; }
}

// 통계/결산 화면용 안전 접근자(없으면 빈 객체 — 배관 이전 데이터).
export function readHistory(read: any): Record<string, { o: number; f: number; w: Record<string, number> }> {
  return (read && read.hist && typeof read.hist === 'object' && !Array.isArray(read.hist)) ? read.hist : {};
}
