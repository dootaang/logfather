// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/adminStats.ts — 어드민 사용량 지표의 데이터 계층(수집 + 조회).
//
// 수집(bumpDauOnce): 로그인 기기가 하루 1회 stats/daily-YYYY-MM-DD.opens를 +1 — 개인 식별 없는 집계
//   숫자 하나. dedup=localStorage(기기·일 단위), 실패(오프라인·규칙 미배포)면 마킹 안 해 다음 로드에 재시도.
//   Firestore SDK는 동적 import(비로그인 사용자는 로드 0). 규칙이 "+1만" 강제(firestore.rules stats).
// 조회(fetchAdminData): 최근 N일 접속 + 쿼터 스냅샷(stats/usage, GitHub Actions 크론이 씀) + 총 공유 수.
//   읽기는 규칙상 관리자 uid만 — 패널(adminPanel.ts)도 같은 uid로 게이트.
// ★ADMIN_UID: 비밀 아님(게이트는 서버 규칙이 강제, 이 상수는 UI 노출용). 규칙의 isAdmin()과 같은 값 유지.
// @ts-nocheck
import { todayKey } from './readStats.js';

export const ADMIN_UID = 'KjPRmdoN5xgSn4Kv341vlUYNM032';   // 사장님 계정 uid(firestore.rules isAdmin()과 한 쌍)

export function isAdminUser(user: any): boolean {
  return !!(user && user.uid && user.uid === ADMIN_UID && ADMIN_UID !== 'ADMIN_UID_TBD');
}

const DAU_KEY_PREFIX = 'pro2-dau-';

// 로그인 시 하루 1회 접속 카운터 +1(fire-and-forget — 호출부는 await 안 함).
export async function bumpDauOnce(user: any): Promise<void> {
  if (!user || !user.uid) return;
  const day = todayKey();
  const k = DAU_KEY_PREFIX + day;
  try { if (localStorage.getItem(k)) return; } catch (_) {}
  try {
    const [{ getDb }, F] = await Promise.all([import('./firebaseBackend.js'), import('firebase/firestore')]);
    await F.setDoc(F.doc(getDb(), 'stats', 'daily-' + day), { opens: F.increment(1) }, { merge: true });
    try {
      localStorage.setItem(k, '1');
      for (let i = localStorage.length - 1; i >= 0; i--) {   // 지난 날짜 dedup 키 청소
        const key = localStorage.key(i);
        if (key && key.indexOf(DAU_KEY_PREFIX) === 0 && key !== k) localStorage.removeItem(key);
      }
    } catch (_) {}
  } catch (_) { /* 오프라인·규칙 미배포 등 — 조용히, 다음 로드에 재시도 */ }
}

// 어드민 패널 데이터 한 번에: { dau: [{day, opens}...오름차순], usage: 스냅샷|null, shares: n|null }
export async function fetchAdminData(days = 14): Promise<any> {
  const [{ getDb }, F] = await Promise.all([import('./firebaseBackend.js'), import('firebase/firestore')]);
  const db = getDb();
  const dayKeys: string[] = [];
  for (let i = days - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); dayKeys.push(todayKey(d)); }
  const snaps = await Promise.all(dayKeys.map((d) => F.getDoc(F.doc(db, 'stats', 'daily-' + d)).catch(() => null)));
  const dau = dayKeys.map((d, i) => ({ day: d, opens: (snaps[i] && snaps[i].exists() && (snaps[i].data().opens || 0)) || 0 }));
  let usage: any = null;
  try { const u = await F.getDoc(F.doc(db, 'stats', 'usage')); usage = u.exists() ? u.data() : null; } catch (_) {}
  let shares: any = null;
  try { const c = await F.getCountFromServer(F.collection(db, 'shares')); shares = c.data().count; } catch (_) {}   // shares는 공개 읽기라 집계 가능
  return { dau, usage, shares };
}
