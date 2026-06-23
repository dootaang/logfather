// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/risuPush.ts — RisuAI 푸시: 연결 키(페어링) 관리 + 받은 편지함(inbox) 드레인.
//
// 흐름: 앱이 연결 키를 발급(랜덤 secret을 users/{uid}/state/pairing에 저장) → 사용자가 RisuAI 플러그인에
//   붙여넣음 → 플러그인이 inbox에 create(보안규칙이 secret 대조) → 앱이 내 inbox를 비우며 서재로 변환·저장.
// ★동적 import 청크(로그인 시에만 firestore SDK 로드). getDb()는 firebaseBackend가 만든 같은 인스턴스.
// @ts-nocheck
import { getDb } from './firebaseBackend.js';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where, onSnapshot } from 'firebase/firestore';

// 페어링 secret 문서 — users/{uid}/state/pairing (앱이 본인만 씀; 보안규칙은 inbox create 때 get()으로 대조).
function pairingRef(uid: string) { return doc(getDb(), 'users', uid, 'state', 'pairing'); }

function genSecret(): string {
  const a = new Uint8Array(24); crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');   // 48자리 hex(추측 불가)
}
/** 사용자에게 보여줄 "연결 키" = uid:secret (플러그인이 split해서 inbox 문서에 uid·key로 넣음). */
export function connectKey(uid: string, secret: string): string { return uid + ':' + secret; }

export async function getSecret(uid: string): Promise<string> {
  try { const s = await getDoc(pairingRef(uid)); return s.exists() ? String((s.data() || {}).secret || '') : ''; } catch (_) { return ''; }
}
/** 없으면 새로 만들어 저장하고 반환(키 발급). */
export async function ensureSecret(uid: string): Promise<string> {
  let sec = await getSecret(uid);
  if (!sec) { sec = genSecret(); await setDoc(pairingRef(uid), { secret: sec, createdAt: Date.now() }); }
  return sec;
}
/** 재발급(로테이션) — 새 secret으로 덮어써 옛 연결 키를 자동 무효화. */
export async function rotateSecret(uid: string): Promise<string> {
  const sec = genSecret(); await setDoc(pairingRef(uid), { secret: sec, createdAt: Date.now() }); return sec;
}
/** 연결 해제 — secret 삭제(이후 inbox create 전부 거부). */
export async function clearSecret(uid: string): Promise<void> { try { await deleteDoc(pairingRef(uid)); } catch (_) {} }

// ── 받은 편지함(inbox): 목록 읽기 · 개별 삭제 · 실시간 감지 ──────────────────────
//   ★자동 변환 안 함. 사용자가 "받은 로그함(우체통)"에서 검토하고 직접 보관(기존 변환 모달)한 뒤 삭제.
export async function listInbox(uid: string): Promise<any[]> {
  try {
    const snap = await getDocs(query(collection(getDb(), 'inbox'), where('uid', '==', uid)));
    return snap.docs.map((d: any) => Object.assign({ _id: d.id }, d.data() || {}));
  } catch (e) { console.warn('[risu] inbox 목록 실패', e); return []; }
}
export async function deleteInbox(docId: string): Promise<void> {
  await deleteDoc(doc(getDb(), 'inbox', String(docId)));
}
// 실시간: 내 inbox가 바뀌면 cb(개수, 문서들). 로그인 동안 유지하고 로그아웃/언마운트 시 unsubscribe.
export function watchInbox(uid: string, cb: (count: number, docs: any[]) => void): () => void {
  try {
    return onSnapshot(query(collection(getDb(), 'inbox'), where('uid', '==', uid)),
      (snap: any) => { try { cb(snap.size, snap.docs.map((d: any) => Object.assign({ _id: d.id }, d.data() || {}))); } catch (_) {} },
      (e: any) => console.warn('[risu] watchInbox', e));
  } catch (e) { console.warn('[risu] watchInbox setup', e); return () => {}; }
}
