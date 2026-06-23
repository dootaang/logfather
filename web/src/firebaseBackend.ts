// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/firebaseBackend.ts — Firestore + Storage 백엔드 (Firebase 동기화 4단계).
//
// store.ts의 LocalBackend와 "같은 메서드 모양"을 구현 → 로그인 시 setBackend로 갈아끼움.
//
// 데이터 모델(사용자별 격리):
//   users/{uid}/logs/{id}    — 로그 1건. html이 작으면 인라인, 크면 Storage로 분리(htmlRef).
//   users/{uid}/meta/{char}  — 작품 메타{cover,desc}. cover(이미지)가 크면 Storage(coverRef).
//   users/{uid}/state/kv     — 작은 설정 블롭 모음(읽기상태·리더설정·프리셋·자동저장) 한 문서.
//
// ★1MB 한도 대응: Firestore 문서는 최대 1,048,576 bytes. 로그 html엔 이미지 data:URL이 박혀 쉽게 초과.
//   → 문서가 임계(800KB)를 넘으면 html(또는 cover)만 Firebase Storage blob으로 빼고 경로만 저장.
//   대부분의 작은 로그는 Firestore에 바로 들어가 빠르고, 큰 로그만 Storage를 써서 비용도 아낀다.
//   (주의: Storage 업로드는 오프라인 큐가 없어 오프라인에선 큰 로그 저장이 실패할 수 있음 — 온라인 권장.)
// @ts-nocheck
import { ensureApp } from './firebase.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, query, where,
} from 'firebase/firestore';
import { getStorage, ref as sref, uploadString, getBytes, deleteObject, listAll } from 'firebase/storage';
import { LocalBackend } from './store.js';   // KV 이중 쓰기(같은 기기 로컬 자동저장도 최신화)용

let _db: any = null, _storage: any = null;
function db(): any {
  if (!_db) {
    // 오프라인 영속성(IndexedDB 캐시 + 온라인 시 자동 동기화 + 멀티탭).
    _db = initializeFirestore(ensureApp(), { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  }
  return _db;
}
function storage(): any { if (!_storage) _storage = getStorage(ensureApp()); return _storage; }

/** 공유 링크 모듈(share.ts)이 같은 Firestore 인스턴스를 쓰도록 노출 — initializeFirestore 중복 호출 방지. */
export function getDb(): any { return db(); }

// ── 내 클라우드 데이터 전부 비우기(클라우드 초기화·계정 삭제 전처리) ──────────
// ★본인(uid) 데이터만 — 보안규칙(소유자만 쓰기) 안에서. Firestore 서브컬렉션 + 본인 공유 + Storage(큰 이미지) 재귀 삭제.
async function wipeStoragePrefix(store: any, prefix: string, tick: () => void): Promise<void> {
  let res: any; try { res = await listAll(sref(store, prefix)); } catch (_) { return; }
  for (const item of res.items) { try { await deleteObject(item); tick(); } catch (_) {} }
  for (const p of res.prefixes) { await wipeStoragePrefix(store, p.fullPath, tick); }   // logs/ meta/ 하위까지
}
export async function wipeUserCloud(uid: string, onProgress?: (n: number) => void): Promise<number> {
  const database = db(); const store = storage();
  let n = 0; const tick = () => { n++; if (onProgress) try { onProgress(n); } catch (_) {} };
  // 1) Firestore 서브컬렉션(로그·작품메타·설정 KV)
  for (const sub of ['logs', 'meta', 'state']) {
    try { const snap = await getDocs(collection(database, 'users', uid, sub)); for (const d of snap.docs) { try { await deleteDoc(d.ref); tick(); } catch (_) {} } } catch (_) {}
  }
  // 2) 본인 소유 공유 문서(shares/{id}, owner==uid)
  try { const snap = await getDocs(query(collection(database, 'shares'), where('owner', '==', uid))); for (const d of snap.docs) { try { await deleteDoc(d.ref); tick(); } catch (_) {} } } catch (_) {}
  // 3) Storage 객체(큰 로그 html·표지 분리본) — users/{uid}/ 전부
  try { await wipeStoragePrefix(store, 'users/' + uid, tick); } catch (_) {}
  return n;
}

const THRESHOLD = 800 * 1024;     // 이보다 크면 Storage로 분리(1MB 한도 여유)
const ENC = new TextEncoder();
const byteLen = (s: string) => ENC.encode(s).length;
// Storage blob 가져오기 시간제한 — 느리거나 멈춘 getBytes 하나가 logsAll 전체(=리더 로딩)를 못 막게. 초과 시 그 한 건만 건너뜀.
const withBlobTimeout = <T>(p: Promise<T>, ms = 6000): Promise<T> => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('blob timeout')), ms))]);
const enc = (v: any) => encodeURIComponent(String(v));   // Firestore 문서ID/경로 안전화('/' 등)

export function createFirebaseBackend(uid: string): any {
  const colRef = (sub: string) => collection(db(), 'users', uid, sub);
  const docRef = (sub: string, id: string) => doc(db(), 'users', uid, sub, enc(id));
  const kvDocRef = () => doc(db(), 'users', uid, 'state', 'kv');
  const logHtmlPath = (id: string) => `users/${uid}/logs/${enc(id)}.html`;
  const logOrigPath = (id: string) => `users/${uid}/logs/${enc(id)}.orig.json`;   // 번역 원문 스냅샷(r.orig) 분리본
  const logAssetsPath = (id: string) => `users/${uid}/logs/${enc(id)}.assets.json`;   // 가져온 에셋 맵(r.assets) 분리본
  const metaCoverPath = (char: string) => `users/${uid}/meta/${enc(char)}.cover`;

  let kv: Record<string, any> = {};   // 로그인 시 hydrate로 채우는 메모리 캐시(동기 kvLoad용)

  // ── 클라우드 푸시 실패분 재시도 큐(로컬-퍼스트) ──────────────────────
  // 보관은 "로컬 먼저" 저장(절대 실패 안 함) → 클라우드 푸시는 best-effort.
  //   푸시 실패(예: Storage CORS·일시 오프라인)면 로그 id를 이 큐에 적어두고, 나중에(로그인/온라인/
  //   실시간 변경 때) flushPending()이 로컬본을 다시 읽어 재업로드한다 → 데이터 유실 0.
  const PENDING_KEY = 'pro2-pending-logs-' + uid;
  const loadPending = (): string[] => { try { const a = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch (_) { return []; } };
  const savePending = (ids: string[]) => { try { localStorage.setItem(PENDING_KEY, JSON.stringify(Array.from(new Set(ids)))); } catch (_) {} };
  const addPending = (id: string) => { const p = loadPending(); if (!p.includes(String(id))) { p.push(String(id)); savePending(p); } };
  const removePending = (id: string) => savePending(loadPending().filter((x) => x !== String(id)));

  // 로그 1건을 클라우드(Firestore + 필요시 Storage)로 올린다. 실패 시 throw.
  async function pushLog(rec: any): Promise<void> {
    const r: any = Object.assign({}, rec);
    // html이 커서 문서가 임계를 넘으면 Storage로 분리.
    if (r.html && byteLen(JSON.stringify(r)) > THRESHOLD) {
      await uploadString(sref(storage(), logHtmlPath(r.id)), r.html, 'raw', { contentType: 'text/html;charset=utf-8' });
      r.htmlRef = logHtmlPath(r.id);
      delete r.html;
    } else if (r.htmlRef) {
      // 작아졌으면 옛 Storage 분리본 참조 제거(+청소)
      delete r.htmlRef;
      try { await deleteObject(sref(storage(), logHtmlPath(r.id))); } catch (_) {}
    }
    // ★r.orig(번역 원문 스냅샷)도 커서 문서가 임계를 넘으면 Storage로 분리 — 큰 화에서 doc 1MB 초과로 setDoc이
    //   실패해 클라우드에 r.orig가 누락(→ 재로드 시 원문/번역 토글이 사라지던 것)되던 것을 막는다(html과 대칭).
    if (r.orig && byteLen(JSON.stringify(r)) > THRESHOLD) {
      await uploadString(sref(storage(), logOrigPath(r.id)), JSON.stringify(r.orig), 'raw', { contentType: 'application/json' });
      r.origRef = logOrigPath(r.id);
      delete r.orig;
    } else if (r.origRef) {
      delete r.origRef;
      try { await deleteObject(sref(storage(), logOrigPath(r.id))); } catch (_) {}
    }
    // ★r.assets(가져온 에셋 맵)도 커서 문서가 임계를 넘으면 Storage로 분리(html·orig와 대칭) — 에셋 많은 화에서 doc 1MB 초과로 누락 방지.
    if (r.assets && byteLen(JSON.stringify(r)) > THRESHOLD) {
      await uploadString(sref(storage(), logAssetsPath(r.id)), JSON.stringify(r.assets), 'raw', { contentType: 'application/json' });
      r.assetsRef = logAssetsPath(r.id);
      delete r.assets;
    } else if (r.assetsRef) {
      delete r.assetsRef;
      try { await deleteObject(sref(storage(), logAssetsPath(r.id))); } catch (_) {}
    }
    await setDoc(docRef('logs', r.id), r);
  }

  return {
    // ── 로그 보관함 ──
    // ★로컬-퍼스트: (1) 로컬 IndexedDB에 먼저 저장 → 보관은 항상 성공(서재로 즉시 이동).
    //              (2) 클라우드 푸시는 best-effort. 실패해도 throw 안 함 → "저장 실패" 안 뜸.
    //                  실패분은 재시도 큐에 적어두고 flushPending이 나중에 올림.
    async logsAdd(rec: any) {
      try { await LocalBackend.logsAdd(rec); } catch (_) {}   // 1) 로컬 먼저(보관 보장)
      try { await pushLog(rec); removePending(rec.id); }      // 2) 클라우드 best-effort
      catch (e) { console.warn('[sync] 클라우드 로그 저장 실패 — 로컬엔 저장됨, 재시도 예약', rec && rec.id, e); addPending(rec.id); }
    },
    // 큐에 쌓인(클라우드 미반영) 로그를 로컬본에서 다시 읽어 재업로드. 성공분만 큐에서 제거.
    async flushPending(): Promise<void> {
      const ids = loadPending();
      if (!ids.length) return;
      let local: any[] = []; try { local = await LocalBackend.logsAll(); } catch (_) { return; }
      const byId = new Map(local.map((l: any) => [String(l.id), l]));
      for (const id of ids) {
        const rec = byId.get(String(id));
        if (!rec) { removePending(id); continue; }   // 로컬에서 사라졌으면 큐에서 제거
        try { await pushLog(rec); removePending(id); } catch (_) { /* 여전히 실패 — 다음 기회에 */ }
      }
    },
    pendingCount(): number { return loadPending().length; },
    async logsAll(): Promise<any[]> {
      const snap = await getDocs(colRef('logs'));
      const out: any[] = [];
      for (const d of snap.docs) {
        const r: any = d.data();
        if (r.htmlRef && !r.html) {
          try { r.html = new TextDecoder().decode(await withBlobTimeout(getBytes(sref(storage(), r.htmlRef)))); } catch (_) {}
          delete r.htmlRef;
        }
        if (r.origRef && !r.orig) {   // 분리 저장된 원문 스냅샷 복원(번역 토글 영속)
          try { r.orig = JSON.parse(new TextDecoder().decode(await withBlobTimeout(getBytes(sref(storage(), r.origRef))))); } catch (_) {}
          delete r.origRef;
        }
        if (r.assetsRef && !r.assets) {   // 분리 저장된 에셋 맵 복원(재렌더 에셋 보존)
          try { r.assets = JSON.parse(new TextDecoder().decode(await withBlobTimeout(getBytes(sref(storage(), r.assetsRef))))); } catch (_) {}
          delete r.assetsRef;
        }
        out.push(r);
      }
      return out;
    },
    // 증분 동기화용: savedAt이 ts 이상인 로그만(데스크탑 수동 동기화). ts<=0이면 전체.
    //   변경분만 받아 재-불러오기가 빨라진다. htmlRef(큰 로그)는 Storage에서 받아 합친다(데스크탑은 CORS 허용 필요).
    async logsSince(ts: number): Promise<any[]> {
      const base = colRef('logs');
      const q = (ts && ts > 0) ? query(base, where('savedAt', '>=', ts)) : base;
      const snap = await getDocs(q);
      const out: any[] = [];
      for (const d of snap.docs) {
        const r: any = d.data();
        if (r.htmlRef && !r.html) {
          try { r.html = new TextDecoder().decode(await withBlobTimeout(getBytes(sref(storage(), r.htmlRef)))); } catch (_) {}
          delete r.htmlRef;
        }
        if (r.origRef && !r.orig) {   // 분리 저장된 원문 스냅샷 복원(번역 토글 영속)
          try { r.orig = JSON.parse(new TextDecoder().decode(await withBlobTimeout(getBytes(sref(storage(), r.origRef))))); } catch (_) {}
          delete r.origRef;
        }
        if (r.assetsRef && !r.assets) {   // 분리 저장된 에셋 맵 복원(재렌더 에셋 보존)
          try { r.assets = JSON.parse(new TextDecoder().decode(await withBlobTimeout(getBytes(sref(storage(), r.assetsRef))))); } catch (_) {}
          delete r.assetsRef;
        }
        out.push(r);
      }
      return out;
    },
    // 마이그레이션/존재확인용 경량 조회(Storage blob 안 받음 → 빠름).
    async logIds(): Promise<string[]> {
      const snap = await getDocs(colRef('logs'));
      return snap.docs.map((d: any) => String((d.data() || {}).id ?? decodeURIComponent(d.id)));
    },
    // 중복 판정용 경량 조회(문서 필드만, Storage html blob 안 받음 → 빠름). 내용 지문 계산에 사용.
    async logKeyData(): Promise<any[]> {
      const snap = await getDocs(colRef('logs'));
      return snap.docs.map((d: any) => d.data());
    },
    async logsDelete(id: string) {
      removePending(id);   // 클라우드 미반영 대기분이었어도 삭제했으니 큐에서 제거
      try { await LocalBackend.logsDelete(id); } catch (_) {}   // 로컬 먼저(서재 즉시 반영)
      try { await deleteDoc(docRef('logs', id)); } catch (_) {}
      try { await deleteObject(sref(storage(), logHtmlPath(id))); } catch (_) {}
      try { await deleteObject(sref(storage(), logOrigPath(id))); } catch (_) {}
      try { await deleteObject(sref(storage(), logAssetsPath(id))); } catch (_) {}
    },
    // 실시간: 로그 컬렉션이 바뀌면(다른 기기 포함) cb 호출. unsubscribe 함수 반환.
    watchLogs(cb: () => void): () => void {
      try { return onSnapshot(colRef('logs'), () => cb(), (e: any) => console.warn('[sync] watchLogs', e)); }
      catch (e) { console.warn('[sync] watchLogs setup', e); return () => {}; }
    },

    // ── 작품 메타(표지/설명) ──
    async metaGet(char: string): Promise<any> {
      const s = await getDoc(docRef('meta', char));
      if (!s.exists()) return null;
      const r: any = s.data();
      if (r.coverRef && !r.cover) {
        try { r.cover = new TextDecoder().decode(await withBlobTimeout(getBytes(sref(storage(), r.coverRef)))); } catch (_) {}
        delete r.coverRef;
      }
      return r;
    },
    async metaSet(rec: any) {
      try { await LocalBackend.metaSet(rec); } catch (_) {}   // 로컬 먼저(표지/설명 변경 즉시 반영)
      try {                                                   // 클라우드 best-effort(실패해도 throw 안 함)
        const r: any = Object.assign({}, rec);
        if (r.cover && byteLen(JSON.stringify(r)) > THRESHOLD) {
          await uploadString(sref(storage(), metaCoverPath(r.char)), r.cover, 'raw');
          r.coverRef = metaCoverPath(r.char);
          delete r.cover;
        } else if (r.coverRef) {
          delete r.coverRef;
          try { await deleteObject(sref(storage(), metaCoverPath(r.char))); } catch (_) {}
        }
        await setDoc(docRef('meta', r.char), r);
      } catch (e) { console.warn('[sync] 클라우드 메타 저장 실패 — 로컬엔 저장됨', rec && rec.char, e); }
    },
    async metaAll(): Promise<any[]> {
      const snap = await getDocs(colRef('meta'));
      return snap.docs.map((d: any) => d.data());
    },
    async metaDelete(char: string) {
      try { await deleteDoc(docRef('meta', char)); } catch (_) {}
      try { await deleteObject(sref(storage(), metaCoverPath(char))); } catch (_) {}
      try { await LocalBackend.metaDelete(char); } catch (_) {}   // 이중 쓰기: 로컬에서도 삭제
    },

    // ── 작은 KV(읽기상태·리더설정·프리셋·자동저장) = 한 문서 ──
    // 동기 getter(kvLoad)를 위해 로그인 시 hydrate()로 메모리에 적재, 쓰기는 write-through(비동기).
    // 클라우드 KV를 메모리로 적재. ★실패(권한 거부=규칙 미배포 / 첫 로드 오프라인)는 일부러 throw →
    //   sync.ts가 받아 클라우드로 안 바꾸고 로컬을 유지(빈 화면 방지). 문서가 없을 뿐이면 정상(빈 kv).
    async hydrate() {
      const s = await getDoc(kvDocRef());
      kv = s.exists() ? (s.data() || {}) : {};
    },
    kvKeys(): string[] { return Object.keys(kv); },
    kvLoad(key: string): any { return (key in kv) ? kv[key] : null; },
    kvSave(key: string, value: any) {
      kv[key] = value;
      setDoc(kvDocRef(), { [key]: value }, { merge: true }).catch(() => {});
      // ★이중 쓰기: 같은 기기의 로컬(localStorage)도 즉시 갱신 → 서재 다녀와도(시작 시 로컬을 읽으므로)
      //   방금 편집(다이어리 표지 등)이 사라지지 않음. (기기 간은 미러/다음 로드로 반영)
      try { LocalBackend.kvSave(key, value); } catch (_) {}
    },
  };
}
