// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/auth.ts — 아이디(ID) + 비밀번호 로그인. 이메일은 선택(분실 복구용). 게스트 없음.
//
// Firebase Auth는 email/password만 지원 → 아이디를 내부 합성 이메일 `<id>@logpapa.app` 로 매핑해 사용.
//   (합성 이메일은 내부 키일 뿐 메일 발송도, 외부 노출도 없음.)
// "이메일 추가(분실 대비)": verifyBeforeUpdateEmail로 검증메일 발송 → 사용자가 링크 클릭하면
//   그 이메일이 계정의 기본 이메일이 됨 → 이후 비밀번호 재설정 메일 수신 가능(그 뒤엔 이메일로도 로그인).
// 세션은 Firebase가 IndexedDB에 자동 유지. config 없으면 authAvailable()=false → 로컬 전용.
// @ts-nocheck
import {
  getAuth, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, verifyBeforeUpdateEmail,
  deleteUser, reauthenticateWithCredential, EmailAuthProvider,
} from 'firebase/auth';
import { ensureApp, isFirebaseConfigured } from './firebase.js';

const ID_DOMAIN = '@logpapa.app';   // 합성 이메일 도메인(내부용 — 실제 메일 아님)

let _auth: any = null;
function authInstance(): any { const app = ensureApp(); if (!app) return null; if (!_auth) _auth = getAuth(app); return _auth; }

export function authAvailable(): boolean { return isFirebaseConfigured(); }
export function watchAuth(cb: (u: any) => void): void { const a = authInstance(); if (!a) { cb(null); return; } onAuthStateChanged(a, (u: any) => cb(u)); }
export function currentUser(): any { const a = authInstance(); return a ? a.currentUser : null; }

/** 아이디 규칙: 영문/숫자/._- 3~20자. */
export function validateId(id: string): boolean { return /^[a-z0-9._-]{3,20}$/i.test(id || ''); }
function idToEmail(id: string): string { return id.trim().toLowerCase() + ID_DOMAIN; }
function asLoginEmail(idOrEmail: string): string { const v = (idOrEmail || '').trim(); return v.indexOf('@') >= 0 ? v : idToEmail(v); }

export async function signUp(id: string, pw: string): Promise<void> {
  const a = authInstance(); if (!a) throw new Error('Firebase 미설정');
  if (!validateId(id)) { const e: any = new Error('invalid-id'); e.code = 'auth/invalid-id'; throw e; }
  await createUserWithEmailAndPassword(a, idToEmail(id), pw);
}
/** 아이디(또는 이메일을 추가한 경우 이메일) + 비밀번호로 로그인. */
export async function signIn(idOrEmail: string, pw: string): Promise<void> {
  const a = authInstance(); if (!a) throw new Error('Firebase 미설정');
  await signInWithEmailAndPassword(a, asLoginEmail(idOrEmail), pw);
}
export async function doSignOut(): Promise<void> { const a = authInstance(); if (!a) return; await signOut(a); }

/** 표시 이름: 합성이면 아이디, 실제 이메일을 추가했으면 그 이메일. */
export function displayName(u?: any): string { u = u || currentUser(); if (!u) return ''; const em = u.email || ''; return em.endsWith(ID_DOMAIN) ? em.slice(0, -ID_DOMAIN.length) : em; }
/** 분실 복구용 실제 이메일이 등록돼 있는지(=기본 이메일이 합성이 아님). */
export function hasRecoveryEmail(u?: any): boolean { u = u || currentUser(); const em = (u && u.email) || ''; return !!em && !em.endsWith(ID_DOMAIN); }

/** 분실 대비 이메일 추가 — 검증메일 발송. 링크 클릭 시 계정 기본 이메일이 이 이메일로 바뀐다. */
export async function addRecoveryEmail(email: string): Promise<void> {
  const a = authInstance(); if (!a) throw new Error('Firebase 미설정');
  const u = a.currentUser; if (!u) throw new Error('로그인 필요');
  await verifyBeforeUpdateEmail(u, email.trim());
}
/** 비밀번호 재설정 메일(등록한 실제 이메일로). */
export async function resetPassword(email: string): Promise<void> {
  const a = authInstance(); if (!a) throw new Error('Firebase 미설정');
  await sendPasswordResetEmail(a, email.trim());
}

// ── 계정 삭제(탈퇴) + 비밀번호 재확인(재인증) ──────────────────────────
/** 비밀번호 재확인(재인증) — deleteAccount가 requires-recent-login일 때 호출부가 부른다. */
export async function reauthenticate(password: string): Promise<void> {
  const a = authInstance(); const u = a && a.currentUser; if (!u) throw new Error('로그인이 필요합니다.');
  if (!u.email) throw new Error('이 계정은 비밀번호 재확인을 쓸 수 없습니다.');
  await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
}
/** 인증 계정 삭제. requires-recent-login이면 throw → 호출부가 reauthenticate 후 재시도. */
export async function deleteAccount(): Promise<void> {
  const a = authInstance(); const u = a && a.currentUser; if (!u) throw new Error('로그인이 필요합니다.');
  await deleteUser(u);
}
export function needsReauth(e: any): boolean { return !!(e && e.code && String(e.code).indexOf('requires-recent-login') >= 0); }

export function authErrorMessage(e: any): string {
  const c = (e && e.code) || '';
  if (c.indexOf('invalid-id') >= 0) return '아이디는 영문·숫자·._- 조합 3~20자로 입력하세요.';
  if (c.indexOf('email-already-in-use') >= 0) return '이미 쓰는 아이디입니다. 다른 아이디로 가입하세요.';
  if (c.indexOf('missing-password') >= 0) return '비밀번호를 입력하세요.';
  if (c.indexOf('weak-password') >= 0) return '비밀번호는 6자 이상이어야 합니다.';
  if (c.indexOf('invalid-credential') >= 0 || c.indexOf('wrong-password') >= 0 || c.indexOf('user-not-found') >= 0) return '아이디 또는 비밀번호가 맞지 않습니다.';
  if (c.indexOf('invalid-email') >= 0) return '이메일 형식이 올바르지 않습니다.';
  if (c.indexOf('too-many-requests') >= 0) return '시도가 너무 많습니다. 잠시 후 다시 시도하세요.';
  if (c.indexOf('network-request-failed') >= 0) return '네트워크 오류 — 연결을 확인하세요.';
  if (c.indexOf('requires-recent-login') >= 0) return '보안을 위해 로그아웃 후 다시 로그인하고 시도하세요.';
  if (c.indexOf('operation-not-allowed') >= 0) return '이메일/비밀번호 로그인이 콘솔에서 꺼져 있습니다(Authentication에서 사용 설정).';
  return (e && e.message) || '오류가 발생했습니다.';
}
