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
import { getStorage, ref as sref, uploadString, getBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import { LocalBackend, blobsGet, blobsPutRaw, setBlobCloudFetcher, setShareAssetUploader } from './store.js';   // KV 이중 쓰기 + 공유 에셋 블롭(콘텐츠해시) 동기화 + 공유 이미지 Storage 업로더
import { parseDataUrlImg, buildAssetDataUrl } from '../../core/card/assetRefs.js';
import { reencodeOne } from './clipboard.js';   // 공유 이미지 축소(캔버스) 재사용

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
  // 3) Storage 객체(큰 로그 html·표지 분리본 + 공유 에셋 블롭) — users/{uid}/ 전부
  try { await wipeStoragePrefix(store, 'users/' + uid, tick); } catch (_) {}
  try { localStorage.removeItem('pro2-cloud-blobs-' + uid); } catch (_) {}   // 블롭 업로드 집합 초기화(이후 재업로드 보장)
  try { localStorage.removeItem('pro2-shareurls-' + uid); } catch (_) {}   // 공유 이미지 URL 캐시 초기화(이후 재업로드 보장)
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

  // ── 공유 에셋 블롭(콘텐츠해시) 동기화 — 마른 레코드(rec.assetRefs=이름→해시)의 이미지 바이트를 기기 간 공유 ──
  //   업로드: users/{uid}/blobs/{hash} (콘텐츠주소 = 자동 dedup). 이미 올린 해시는 로컬 집합으로 건너뜀(멱등).
  //   다운로드: 리더가 그 화 표시 직전, 로컬에 없는 해시만 받아 IDB_BLOBS에 채움(setBlobCloudFetcher 훅, 온디맨드·메모리 바운드).
  const blobPath = (h: string) => `users/${uid}/blobs/${h}`;
  const UPKEY = 'pro2-cloud-blobs-' + uid;
  const loadUploaded = (): Set<string> => { try { const a = JSON.parse(localStorage.getItem(UPKEY) || '[]'); return new Set(Array.isArray(a) ? a.map(String) : []); } catch (_) { return new Set(); } };
  const markUploaded = (hs: string[]) => { try { const s = loadUploaded(); for (const h of hs) s.add(h); localStorage.setItem(UPKEY, JSON.stringify(Array.from(s))); } catch (_) {} };
  async function pushBlobs(hashes: string[]): Promise<void> {
    const want = Array.from(new Set((hashes || []).filter(Boolean)));
    if (!want.length) return;
    const up = loadUploaded();
    const todo = want.filter((h) => !up.has(h));
    if (!todo.length) return;
    const bytes = await blobsGet(todo);   // 로컬 IDB_BLOBS에서 바이트(한 화 분량, 바운드)
    const done: string[] = [];
    for (const h of todo) {
      const b = bytes.get(h); if (!b) continue;   // 로컬에 없으면(이미 마름) 스킵
      try { await uploadString(sref(storage(), blobPath(h)), buildAssetDataUrl(b.mime, b.b64), 'raw', { contentType: 'text/plain;charset=utf-8' }); done.push(h); } catch (_) { /* 실패 = 다음 기회(멱등) */ }
    }
    if (done.length) markUploaded(done);
  }
  async function fetchBlobs(hashes: string[]): Promise<void> {
    const want = Array.from(new Set((hashes || []).filter(Boolean)));
    if (!want.length) return;
    const got: Array<{ h: string; mime: string; b64: string }> = [];
    for (const h of want) {
      try {
        const txt = new TextDecoder().decode(await withBlobTimeout(getBytes(sref(storage(), blobPath(h)))));
        const p = parseDataUrlImg(txt); if (p) got.push({ h, mime: p.mime, b64: p.b64 });
      } catch (_) { /* 그 해시만 건너뜀(마커 유지) */ }
    }
    if (got.length) { try { await blobsPutRaw(got); } catch (_) {} }
  }

  // ── 공유 이미지(Storage) — 공유 스냅샷을 Firestore 1MB에 인라인하는 대신 Storage로 올리고 화 문서엔 URL만 ──
  //   ★기존 블롭은 text/plain(데이터URL 문자열)이라 <img src>로 직접 못 씀 → 공유용으로 "축소한 실제 이미지"를
  //     image/jpeg로 따로 올린다. 경로=콘텐츠해시 → 같은 스프라이트는 한 벌(화 간·재공유 중복제거). 다운로드 URL은
  //     토큰이 박혀 비로그인 받는 사람도 <img>로 로드(표시는 CORS 무관). URL 캐시(localStorage)로 재업로드 회피.
  const shareAssetPath = (h: string) => `users/${uid}/shareassets/${h}.jpg`;
  const SHARE_MAXDIM = 1024, SHARE_Q = 0.72;   // 공유 화질(원본 아님) — 용량·화질 균형. 받는 사람 대역폭·egress 절약.
  const SHAREURL_KEY = 'pro2-shareurls-' + uid;
  const loadShareUrls = (): Record<string, string> => { try { const o = JSON.parse(localStorage.getItem(SHAREURL_KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (_) { return {}; } };
  const saveShareUrls = (m: Record<string, string>) => { try { localStorage.setItem(SHAREURL_KEY, JSON.stringify(m)); } catch (_) {} };
  // refs(name→hash) → name→다운로드 URL. 로컬에 없는 바이트는 클라우드(blobs)에서 보충 후 축소·업로드.
  async function uploadShareAssets(refs: Record<string, string>): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (!refs || typeof refs !== 'object') return out;
    const cache = loadShareUrls();
    const hashes = Array.from(new Set(Object.values(refs).filter(Boolean) as string[]));
    const need = hashes.filter((h) => !cache[h]);
    if (need.length) {
      let bytes = await blobsGet(need);
      const miss = need.filter((h) => !bytes.has(h));
      if (miss.length) { try { await fetchBlobs(miss); bytes = await blobsGet(need); } catch (_) {} }   // 안 열어본 화 등 로컬에 없는 블롭은 클라우드서 보충
      const CONC = 8;   // 동시 업로드 제한(과부하 방지)
      for (let i = 0; i < need.length; i += CONC) {
        await Promise.all(need.slice(i, i + CONC).map(async (h) => {
          const b = bytes.get(h); if (!b) return;   // 바이트 못 구함(로컬·클라우드 모두 없음) → 그 에셋 스킵(마커 미해결 = 공유 경고가 잡음)
          try {
            const small = await reencodeOne(buildAssetDataUrl(b.mime, b.b64), null, false, SHARE_MAXDIM, SHARE_Q);   // 축소 JPEG data:URL
            await uploadString(sref(storage(), shareAssetPath(h)), small, 'data_url');   // 실제 이미지 바이트 + image/jpeg contentType
            cache[h] = await getDownloadURL(sref(storage(), shareAssetPath(h)));
          } catch (_) { /* 그 에셋만 실패(나머지는 진행) */ }
        }));
      }
      saveShareUrls(cache);
    }
    for (const name of Object.keys(refs)) { const u = cache[refs[name]]; if (u) out[name] = u; }
    return out;
  }

  // 로그 1건을 클라우드(Firestore + 필요시 Storage)로 올린다. 실패 시 throw.
  async function pushLog(rec: any): Promise<void> {
    // ★JSON 왕복 = 깊은 undefined 제거 — Firestore setDoc은 undefined 필드를 거부(과거 번역이 만든 orig.chat:undefined로
    //   동기화가 영구 실패·재시도 무한 루프). 이미 로컬에 남은 오염 레코드도 다음 flush에서 자동 치유된다.
    const r: any = JSON.parse(JSON.stringify(rec));
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
    // ★마른 레코드의 공유 에셋 블롭 업로드(콘텐츠해시 dedup) — assetRefs(이름→해시)는 작아 문서에 인라인 유지.
    if (r.assetRefs && typeof r.assetRefs === 'object') { try { await pushBlobs(Object.values(r.assetRefs)); } catch (_) {} }
    await setDoc(docRef('logs', r.id), r);
  }

  setBlobCloudFetcher(fetchBlobs);   // ★리더 온디맨드 블롭 보충 활성(로그아웃 시 store.setBackend가 해제)
  setShareAssetUploader(uploadShareAssets);   // ★공유 이미지 Storage 업로더 활성(공유 스냅샷이 화 문서엔 URL만 → 1MB 회피)

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
