// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/firebase.ts — Firebase 앱 초기화 (공통 코어).
//
// 사장님이 Firebase 콘솔에서 만든 프로젝트의 config를 아래 firebaseConfig에 넣어두면 활성화된다.
// config가 비어 있으면 isFirebaseConfigured()=false → 앱은 100% 로컬 전용으로 동작(강제 로그인 없음).
//
// ※ 이 web config(apiKey 등)는 비밀이 아니라 공개값이다. 보안은 Firestore/Storage "보안 규칙"으로 건다(7단계).
// ※ 여기서는 'firebase/app'만 import한다. auth/firestore/storage는 각 모듈(auth.ts 등)에서 따로 가져와
//   필요한 기능만 번들에 들어가게 한다(용량 절감 — 로그인만 쓰면 firestore는 안 딸려옴).
// @ts-nocheck
import { initializeApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: 'AIzaSyDUR9_DGQTqdkZVfGzbQzEYO0qACR5vsfo',
  authDomain: 'logpapa.firebaseapp.com',
  projectId: 'logpapa',
  storageBucket: 'logpapa.firebasestorage.app',  // 이미지 blob 저장용 = 6단계
  messagingSenderId: '793749788973',
  appId: '1:793749788973:web:9e6e148bdb55b1c26fdba4',
};

/** config가 실제로 채워졌는지(=동기화 사용 가능한지). 빈 채로 두면 로컬 전용 유지. */
export function isFirebaseConfigured(): boolean {
  return !!firebaseConfig.apiKey && !!firebaseConfig.projectId;
}

let _app: any = null;
/** Firebase 앱을 1회 초기화해 돌려준다. config 없으면 null(→ 호출부는 로컬 유지). */
export function ensureApp(): any {
  if (!isFirebaseConfigured()) return null;
  if (!_app) _app = initializeApp(firebaseConfig);
  return _app;
}
