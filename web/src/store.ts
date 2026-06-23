// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/store.ts — 에디터(index)와 서재(library)가 공유하는 데이터 계층.
//
// ── 백엔드 추상화(Firebase 동기화 1단계) ──────────────────────────────
// 모든 "동기화 대상" 데이터(로그·작품메타·읽기상태·프리셋·자동저장)는 이제
// `backend`를 통해 읽고 쓴다. 기본값 = LocalBackend(지금 그대로: IndexedDB + localStorage).
// 로그인하면 main/library가 setBackend(FirebaseBackend)로 갈아끼우기만 하면 됨(호출부 무변경).
//
//   동기화 대상(backend 경유): logs · meta · KV(읽기상태/리더설정/프리셋라이브러리/자동저장)
//   로컬 전용(backend 밖, 직접 접근 유지): cards(마지막 드롭 카드) · 기기 환경설정(스킨/테마/심플/JPEG)
//
// FirebaseBackend 계약(나중 구현): logs/meta는 Firestore(+Storage로 1MB 초과 html 분리),
// kvLoad/kvSave는 작은 블롭이라 Firestore kv 문서. 동기 getter 유지를 위해 로그인 시
// 작은 KV 블롭을 메모리에 미리 적재(hydrate)하고 write-through 한다 → 호출부 시그니처 불변.
// @ts-nocheck
export const IDB_NAME = 'pro2', IDB_STORE = 'cards', IDB_KEY = 'last', IDB_LOGS = 'logs', IDB_META = 'meta', IDB_FONTS = 'fonts', IDB_BLOBS = 'blobs', IDB_SRC = 'srcCatalog', IDB_SRCFILE = 'srcFiles';

// 동기화 대상 KV 키(한 곳에서 관리 → Firebase 마이그레이션/문서모델이 참조).
export const READ_KEY = 'pro2-read';            // 읽기상태(이어보기·읽음·즐겨찾기·lastReadAt)
export const RDR_KEY = 'pro2-reader';           // 리더설정(테마·폭·줌) — 기기취향이라 동기화는 선택
export const PRESET_LIB_KEY = 'pro2-preset-library';  // 디자인별 프리셋 목록
export const AUTOSAVE_KEY = 'pro2-preset-autosave';   // 활성 설정 + designStore(작업 상태)
// 에디터로 특정 로그를 열어달라는 교차 페이지 임시 요청(서재 → 에디터). 동기화 안 함.
export const OPEN_LOG_KEY = 'pro2-open-log';

export function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 6);   // v4: 커스텀 폰트 / v5: 굳힌 이미지 dedup 블롭 / v6: 관리실 보관(소스 카탈로그+원본파일)
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      if (!db.objectStoreNames.contains(IDB_LOGS)) db.createObjectStore(IDB_LOGS, { keyPath: 'id' }); // 로그 보관함
      if (!db.objectStoreNames.contains(IDB_META)) db.createObjectStore(IDB_META, { keyPath: 'char' }); // 작품 메타(표지/설명)
      if (!db.objectStoreNames.contains(IDB_FONTS)) db.createObjectStore(IDB_FONTS, { keyPath: 'id' }); // 커스텀 폰트(데스크탑 로컬, 동기화 안 함)
      if (!db.objectStoreNames.contains(IDB_BLOBS)) db.createObjectStore(IDB_BLOBS, { keyPath: 'h' }); // 콘텐츠 해시 → 이미지 바이트(굳히기 중복 제거)
      // v6 관리실 보관(데스크탑 전용·서재와 독립·동기화 안 함): 카탈로그(소스 메타, id=파일해시) + 원본파일(콘텐츠해시 dedup).
      if (!db.objectStoreNames.contains(IDB_SRC)) db.createObjectStore(IDB_SRC, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(IDB_SRCFILE)) db.createObjectStore(IDB_SRCFILE, { keyPath: 'h' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 서재(로그·작품메타)만 로컬에서 비움 — 편집기 설정·프리셋·드롭한 카드·폰트는 유지. ★클라우드 안 건드림(로컬 IndexedDB만).
export async function clearLibraryLocal(): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((res) => { const tx = db.transaction([IDB_LOGS, IDB_META, IDB_BLOBS], 'readwrite'); tx.objectStore(IDB_LOGS).clear(); tx.objectStore(IDB_META).clear(); tx.objectStore(IDB_BLOBS).clear(); tx.oncomplete = () => res(); tx.onerror = () => res(); });
  db.close();
  try { await idbClearAllWorkCards(); } catch (_) {}        // 작품별 카드도 함께 정리(작품이 사라지므로)
  try { localStorage.removeItem(READ_KEY); } catch (_) {}   // 읽기상태(이어보기·즐겨찾기)도 정리(로그가 사라지므로)
}

// ── 커스텀 폰트(로컬 전용 — 파일이 커서 클라우드 동기화 안 함) ──────────
export async function fontsAdd(rec: any): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((res, rej) => { const tx = db.transaction(IDB_FONTS, 'readwrite'); tx.objectStore(IDB_FONTS).put(rec); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  db.close();
}
export async function fontsAll(): Promise<any[]> {
  const db = await idbOpen();
  const r = await new Promise<any[]>((res) => { const tx = db.transaction(IDB_FONTS, 'readonly'); const g = tx.objectStore(IDB_FONTS).getAll(); g.onsuccess = () => res(g.result || []); g.onerror = () => res([]); });
  db.close(); return r;
}
export async function fontsDelete(id: string): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((res) => { const tx = db.transaction(IDB_FONTS, 'readwrite'); tx.objectStore(IDB_FONTS).delete(id); tx.oncomplete = () => res(); tx.onerror = () => res(); });
  db.close();
}

// ── 굳힌 이미지 dedup(콘텐츠 해시) ──────────────────────────────────
// 같은 이미지 바이트가 여러 로그·여러 곳에 인라인 data:로 중복 저장되는 걸 막는다. 저장(logsAdd) 때
// 큰 data: 이미지를 sha-256으로 해시해 blobs에 "한 벌"만 두고 html엔 lpblob:<hash> 참조만 남긴다(dehydrate).
// 읽기(logsAll) 때 참조를 원래 data:로 되돌린다(hydrate) → 소비자(리더·복사·동기화)는 항상 인라인 html을 본다.
//   ★굳히기 동작·화질 불변(같은 바이트 그대로 복원), 저장만 효율화. 작은 이미지(<6KB)는 인라인 유지.
const BLOB_MIN = 6 * 1024;   // 이보다 작은 data: 이미지는 그냥 인라인(해시 오버헤드/잡블롭 방지)
const DATA_IMG_RE = /data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g;
const BLOB_REF_RE = /lpblob:([0-9a-f]{64})/g;
const b64Bytes = (b64: string) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  const v = new Uint8Array(buf); let s = ''; for (let i = 0; i < v.length; i++) s += v[i].toString(16).padStart(2, '0'); return s;
}
// html 안 큰 data: 이미지 → blobs에 저장 후 lpblob:<hash> 참조로 치환. 반환 {html, blobs:[{h,mime,b64}]}.
async function dehydrateHtml(html: string): Promise<{ html: string; blobs: any[] }> {
  if (typeof html !== 'string' || html.indexOf('data:image/') < 0) return { html: html || '', blobs: [] };
  const blobs: any[] = []; const jobs: Array<Promise<void>> = []; const repl: Array<{ full: string; ref: string }> = [];
  const seen = new Set<string>(); let m: RegExpExecArray | null;
  DATA_IMG_RE.lastIndex = 0;
  while ((m = DATA_IMG_RE.exec(html)) !== null) {
    const full = m[0], mime = m[1], b64 = m[2];
    if (b64.length * 0.75 < BLOB_MIN) continue;   // 작은 이미지는 인라인 유지
    if (seen.has(full)) continue; seen.add(full);
    jobs.push(sha256Hex(b64Bytes(b64)).then((h) => { blobs.push({ h, mime, b64 }); repl.push({ full, ref: 'lpblob:' + h }); }));
  }
  if (!jobs.length) return { html, blobs: [] };
  await Promise.all(jobs);
  let out = html;
  for (const { full, ref } of repl) out = out.split(full).join(ref);   // 같은 data:는 모두 같은 참조로
  return { html: out, blobs };
}
// lpblob:<hash> 참조 → 원래 data:image 로 되돌림(blobMap = hash→{mime,b64}).
function hydrateHtml(html: string, blobMap: Map<string, any>): string {
  if (typeof html !== 'string' || html.indexOf('lpblob:') < 0) return html || '';
  return html.replace(BLOB_REF_RE, (full, h) => { const b = blobMap.get(h); return b ? 'data:image/' + b.mime + ';base64,' + b.b64 : full; });
}
function collectBlobRefs(html: string, into: Set<string>) {
  if (typeof html !== 'string' || html.indexOf('lpblob:') < 0) return;
  let m: RegExpExecArray | null; BLOB_REF_RE.lastIndex = 0;
  while ((m = BLOB_REF_RE.exec(html)) !== null) into.add(m[1]);
}

// ── 로컬 백엔드(현재 구현) ──────────────────────────────────────────
// IndexedDB(logs/meta) + localStorage(KV). FirebaseBackend가 이 모양을 그대로 구현하면 교체 가능.
const LocalBackend = {
  // 로그 보관함 — 저장 시 큰 이미지를 dedup(blobs)로 분리, 읽기 시 복원.
  async logsAdd(rec: any) {
    let toStore = rec, blobs: any[] = [];
    try { if (rec && typeof rec.html === 'string') { const d = await dehydrateHtml(rec.html); if (d.blobs.length) { toStore = Object.assign({}, rec, { html: d.html }); blobs = d.blobs; } } } catch (_) { toStore = rec; }
    const db = await idbOpen();
    await new Promise<void>((res, rej) => {
      const stores = blobs.length ? [IDB_LOGS, IDB_BLOBS] : [IDB_LOGS];
      const tx = db.transaction(stores, 'readwrite');
      tx.objectStore(IDB_LOGS).put(toStore);
      if (blobs.length) { const bs = tx.objectStore(IDB_BLOBS); for (const b of blobs) bs.put(b); }   // put=있으면 그대로(한 벌)
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
    db.close();
  },
  async logsAll(): Promise<any[]> {
    const db = await idbOpen();
    const r = await new Promise<any[]>((res, rej) => { const tx = db.transaction(IDB_LOGS, 'readonly'); const g = tx.objectStore(IDB_LOGS).getAll(); g.onsuccess = () => res(g.result || []); g.onerror = () => rej(g.error); });
    // 참조(lpblob:) 복원 — 필요한 해시만 한 번에 읽어 hydrate.
    const need = new Set<string>(); for (const rec of r) if (rec && rec.html) collectBlobRefs(rec.html, need);
    if (need.size) {
      const map = new Map<string, any>();
      await new Promise<void>((res) => { const tx = db.transaction(IDB_BLOBS, 'readonly'); const bs = tx.objectStore(IDB_BLOBS); let left = need.size; if (!left) return res(); need.forEach((h) => { const g = bs.get(h); g.onsuccess = () => { if (g.result) map.set(h, g.result); if (--left === 0) res(); }; g.onerror = () => { if (--left === 0) res(); }; }); });
      for (const rec of r) if (rec && rec.html && rec.html.indexOf('lpblob:') >= 0) rec.html = hydrateHtml(rec.html, map);
    }
    db.close(); return r;
  },
  async logsDelete(id: string) {
    const db = await idbOpen();
    await new Promise<void>((res) => { const tx = db.transaction(IDB_LOGS, 'readwrite'); tx.objectStore(IDB_LOGS).delete(id); tx.oncomplete = () => res(); tx.onerror = () => res(); });
    db.close();
  },
  // 작품 메타(표지 이미지·설명), keyPath=char
  async metaGet(char: string): Promise<any> {
    const db = await idbOpen();
    const r = await new Promise<any>((res) => { const tx = db.transaction(IDB_META, 'readonly'); const g = tx.objectStore(IDB_META).get(char); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); });
    db.close(); return r;
  },
  async metaSet(rec: any) {
    const db = await idbOpen();
    await new Promise<void>((res, rej) => { const tx = db.transaction(IDB_META, 'readwrite'); tx.objectStore(IDB_META).put(rec); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    db.close();
  },
  async metaAll(): Promise<any[]> {   // 마이그레이션용(작품 메타 전체)
    const db = await idbOpen();
    const r = await new Promise<any[]>((res) => { const tx = db.transaction(IDB_META, 'readonly'); const g = tx.objectStore(IDB_META).getAll(); g.onsuccess = () => res(g.result || []); g.onerror = () => res([]); });
    db.close(); return r;
  },
  async metaDelete(char: string) {
    const db = await idbOpen();
    await new Promise<void>((res) => { const tx = db.transaction(IDB_META, 'readwrite'); tx.objectStore(IDB_META).delete(char); tx.oncomplete = () => res(); tx.onerror = () => res(); });
    db.close();
  },
  // 작은 KV 블롭(읽기상태·리더설정·프리셋·자동저장)
  kvLoad(key: string): any { try { const raw = localStorage.getItem(key); return raw == null ? null : JSON.parse(raw); } catch (_) { return null; } },
  kvSave(key: string, value: any) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} },
};

let backend: any = LocalBackend;
let backendKind = 'local';
/** 현재 백엔드 종류('local' | 'firebase' …). */
export function getBackendKind(): string { return backendKind; }
/** 로그인/로그아웃 시 백엔드 교체. FirebaseBackend는 LocalBackend와 같은 메서드 모양을 구현한다. */
export function setBackend(b: any, kind: string) { backend = b || LocalBackend; backendKind = b ? (kind || 'custom') : 'local'; }
/** 새 백엔드(예: FirebaseBackend) 구현 시 기준으로 삼을 로컬 구현 노출. */
export { LocalBackend };

// ── "안 올린 변경" 플래그 (로컬-퍼스트=수동/데스크탑에서만 의미) ──────────────────────
// 사용자발 로컬 변경(보관·제목/순서/표지 수정·삭제)이 클라우드에 아직 안 올라갔음을 표시 → ☁ 버튼 점.
// ★pull(클라우드→로컬)은 LocalBackend.*를 직접 호출해 이 래퍼를 안 타므로 set 안 됨(받은 건 이미 클라우드에 있음).
//   auto 모드(backend=firebase)는 저장이 곧 클라우드행이라 set 안 함(=점 없음). push 성공 시 clear.
const UNPUSHED_KEY = 'pro2-unpushed';
export function markUnpushed(): void { try { if (localStorage.getItem(UNPUSHED_KEY) !== '1') { localStorage.setItem(UNPUSHED_KEY, '1'); window.dispatchEvent(new Event('pro2-unpushed')); } } catch (_) {} }
export function clearUnpushed(): void { try { if (localStorage.getItem(UNPUSHED_KEY)) { localStorage.removeItem(UNPUSHED_KEY); window.dispatchEvent(new Event('pro2-unpushed')); } } catch (_) {} }
export function hasUnpushed(): boolean { try { return localStorage.getItem(UNPUSHED_KEY) === '1'; } catch (_) { return false; } }
function noteLocalChange(): void { if (backendKind !== 'firebase') markUnpushed(); }   // 로컬-퍼스트일 때만(auto/firebase는 즉시 클라우드행)

// ── 로그 보관함(backend 경유) ──────────────────────────────────────
// 저장(=편집) 시각을 찍는다 → 클라우드 백엔드가 "stale 기기가 더 최신본을 덮어쓰는 것"을 막는 가드에 사용.
export function logsAdd(rec: any) { if (rec && typeof rec === 'object') rec.savedAt = Date.now(); noteLocalChange(); return backend.logsAdd(rec); }
export function logsAll(): Promise<any[]> { return backend.logsAll(); }
export function logsDelete(id: string) { noteLocalChange(); return backend.logsDelete(id); }

// ── 중복 화 정리(기기 왔다갔다 시 같은 화가 다른 id로 2벌 생기는 문제) ──────────
// id가 달라도 "내용 지문"(작품·디자인·제목·날짜·본문)이 같으면 같은 화로 본다.
export function logContentKey(r: any): string {
  const n = (v: any) => String(v == null ? '' : v).trim();
  return [n(r.char), n(r.template || 'card'), n(r.title), n(r.date), n(r.input)].join('');
}
// 같은 지문 그룹에서 남길 1벌을 "결정적으로" 고른다(모든 기기가 동일 생존자 선택 → 서로 다른 걸 남겨
// 다시 퍼지는 일 방지): 최근 수정(savedAt) 우선 → 동률이면 id 사전순.
function pickSurvivor(a: any, b: any): any {
  const sa = +(a.savedAt || 0), sb = +(b.savedAt || 0);
  if (sa !== sb) return sa > sb ? a : b;
  return String(a.id) <= String(b.id) ? a : b;
}
// 로그 배열을 지문으로 접어 1벌씩만 남긴다(순수 함수). kept=화면용, removeIds=실제 삭제 대상.
export function dedupeLogList(logs: any[]): { kept: any[]; removeIds: string[] } {
  const byKey = new Map<string, any>();
  const removeIds: string[] = [];
  for (const r of logs) {
    if (!r || r.id == null) continue;
    const k = logContentKey(r);
    const cur = byKey.get(k);
    if (!cur) { byKey.set(k, r); continue; }
    const win = pickSurvivor(cur, r);
    byKey.set(k, win);
    removeIds.push(String((win === cur ? r : cur).id));
  }
  return { kept: Array.from(byKey.values()), removeIds };
}
// 현재 백엔드(로그인 시 클라우드+로컬, 비로그인 시 로컬)에서 실제 중복을 삭제. 삭제 개수 반환.
let _deduping = false;
export async function dedupeLogsInStore(): Promise<number> {
  if (_deduping) return 0;   // 재진입 방지(실시간 변경이 겹쳐 들어와도 중복 실행 안 함)
  _deduping = true;
  try {
    const logs = await backend.logsAll();
    const { removeIds } = dedupeLogList(logs);
    for (const id of removeIds) { try { await backend.logsDelete(id); } catch (_) {} }
    return removeIds.length;
  } catch (_) { return 0; } finally { _deduping = false; }
}

// 작품(서재 한 권) 안정 키 — 표시 이름과 분리된 불투명 식별자. 이름을 바꿔도 로그·읽기상태·공유·URL이
// 그대로 살아있게(이름=키였던 기존 방식의 오타=새작품·이름변경=흩어짐 문제 해소). 새 작품 생성 시에만 쓴다.
export function newWorkKey(): string { return 'wk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// ── 작품 메타(표지/설명, backend 경유) ─────────────────────────────
export function metaGet(char: string): Promise<any> { return backend.metaGet(char); }
export function metaSet(rec: any) { if (rec && typeof rec === 'object') rec.savedAt = Date.now(); noteLocalChange(); return backend.metaSet(rec); }
export function metaDelete(char: string) { noteLocalChange(); return backend.metaDelete(char); }
export function metaAll(): Promise<any[]> { return backend.metaAll ? backend.metaAll() : Promise.resolve([]); }

// ── 범용 KV(backend 경유) — 프리셋 라이브러리·자동저장 등 작은 블롭 ──
export function kvLoad(key: string): any { return backend.kvLoad(key); }
export function kvSave(key: string, value: any) { backend.kvSave(key, value); }

// ── 세션 동기화 1회 플래그 ──────────────────────────────────────────
// "사이트/앱을 열 때 한 번만 동기화"를 위한 표식. sessionStorage라 탭/앱 단위(닫으면 사라져 다음에 다시 1회).
// 편집기·서재가 공유 → 한쪽에서 동기화 끝나면 다른 쪽은 로딩 화면 없이 캐시로 즉시 표시.
const SESSION_SYNCED_KEY = 'pro2-session-synced';
export function isSessionSynced(): boolean { try { return sessionStorage.getItem(SESSION_SYNCED_KEY) === '1'; } catch (_) { return false; } }
export function markSessionSynced(): void { try { sessionStorage.setItem(SESSION_SYNCED_KEY, '1'); } catch (_) {} }

// ── 읽기 상태(이어보기·읽음·즐겨찾기) + 리더 설정(테마·폭·줌) ──────
export function loadRead(): any { const o = backend.kvLoad(READ_KEY); return (o && typeof o === 'object') ? { readIds: {}, lastByChar: {}, fav: {}, ...o } : { readIds: {}, lastByChar: {}, fav: {} }; }
export function saveRead(r: any) { backend.kvSave(READ_KEY, r); }
export function loadReaderCfg(): any {
  const o = backend.kvLoad(RDR_KEY);
  // theme/width/zoom = 카드·다이어리 등 일반 로그용(현행 유지).
  // wn* = 웹소설형 전용 타이포 프로필(기본 = 세피아 명조, 시안 A). 독립이라 일반 로그 읽기는 안 바뀜.
  return Object.assign({ theme: 'system', width: 720, zoom: 1, wnTheme: 'sepia', wnFont: 'serif', wnSize: 18, wnLh: 1.9, wnWidth: 620, wnPageGap: 28 }, (o && typeof o === 'object') ? o : {});
}
export function saveReaderCfg(s: any) { backend.kvSave(RDR_KEY, s); }

// ── 카드(마지막 드롭 카드 자동복원) = 로컬 전용(기기·세션, 동기화 안 함) ──
export async function idbSaveCard(name: string, bytes: Uint8Array) {
  const db = await idbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({ name, bytes, ts: Date.now() }, IDB_KEY);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  db.close();
}
export async function idbLoadCard(): Promise<{ name: string; bytes: Uint8Array } | null> {
  const db = await idbOpen();
  const rec = await new Promise<any>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const r = tx.objectStore(IDB_STORE).get(IDB_KEY);
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  db.close();
  if (!rec || !rec.bytes) return null;
  return { name: rec.name, bytes: rec.bytes instanceof Uint8Array ? rec.bytes : new Uint8Array(rec.bytes) };
}
export async function idbClearCard() {
  const db = await idbOpen();
  await new Promise<void>((resolve) => { const tx = db.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).delete(IDB_KEY); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
  db.close();
}

// ── 작품별 카드(에셋) 기억 = 로컬 전용(동기화 안 함, 바이트 큼). cards 스토어에 key=work:<char>로 저장. ──
//   연재 화마다 카드 재드롭 안 하게: 그 작품 편집기를 열 때 자동 복원. 총 예산+LRU(가장 오래 안 쓴 작품부터 제거).
//   바이트를 안 읽고 LRU를 계산하려고 {char:{ts,size}} 인덱스를 localStorage(기기 전용)에 따로 둔다.
const WORKCARD_PREFIX = 'work:';
const WORKCARD_MAX = 50 * 1024 * 1024;        // 단일 카드 상한(이보다 크면 저장 생략 = 전역 last 50MB 정책 준용)
const WORKCARD_BUDGET = 150 * 1024 * 1024;    // 작품별 카드 총 예산(초과 시 오래된 것부터 제거)
const WORKCARD_IDX = 'pro2-workcards';
function wcIdxLoad(): Record<string, { ts: number; size: number }> { try { const o = JSON.parse(localStorage.getItem(WORKCARD_IDX) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (_) { return {}; } }
function wcIdxSave(o: any) { try { localStorage.setItem(WORKCARD_IDX, JSON.stringify(o)); } catch (_) {} }

export async function idbSaveWorkCard(char: string, name: string, bytes: Uint8Array): Promise<void> {
  if (!char || !bytes || !bytes.byteLength) return;
  if (bytes.byteLength > WORKCARD_MAX) { await idbDeleteWorkCard(char); return; }   // 너무 큰 카드는 저장 생략(+옛것 정리)
  const idx = wcIdxLoad();
  idx[char] = { ts: Date.now(), size: bytes.byteLength };
  // LRU: 총합이 예산 초과면 가장 오래된(방금 저장분 제외) 작품 카드부터 제거.
  const evict: string[] = [];
  let total = Object.keys(idx).reduce((n, c) => n + (idx[c].size || 0), 0);
  if (total > WORKCARD_BUDGET) {
    const order = Object.keys(idx).filter((c) => c !== char).sort((a, b) => idx[a].ts - idx[b].ts);
    for (const c of order) { if (total <= WORKCARD_BUDGET) break; total -= idx[c].size || 0; evict.push(c); delete idx[c]; }
  }
  const db = await idbOpen();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite'); const st = tx.objectStore(IDB_STORE);
    st.put({ name, bytes, ts: Date.now() }, WORKCARD_PREFIX + char);
    for (const c of evict) st.delete(WORKCARD_PREFIX + c);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  db.close(); wcIdxSave(idx);
}
export async function idbLoadWorkCard(char: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (!char) return null;
  const db = await idbOpen();
  const rec = await new Promise<any>((res) => { const tx = db.transaction(IDB_STORE, 'readonly'); const g = tx.objectStore(IDB_STORE).get(WORKCARD_PREFIX + char); g.onsuccess = () => res(g.result); g.onerror = () => res(null); });
  db.close();
  if (!rec || !rec.bytes) return null;
  const idx = wcIdxLoad(); if (idx[char]) { idx[char].ts = Date.now(); wcIdxSave(idx); }   // LRU 사용 기록(touch)
  return { name: rec.name, bytes: rec.bytes instanceof Uint8Array ? rec.bytes : new Uint8Array(rec.bytes) };
}
export async function idbDeleteWorkCard(char: string): Promise<void> {
  if (!char) return;
  const db = await idbOpen();
  await new Promise<void>((res) => { const tx = db.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).delete(WORKCARD_PREFIX + char); tx.oncomplete = () => res(); tx.onerror = () => res(); });
  db.close();
  const idx = wcIdxLoad(); if (idx[char]) { delete idx[char]; wcIdxSave(idx); }
}
// 서재 초기화 등에서 작품별 카드 전부 정리(전역 last 카드는 안 건드림).
export async function idbClearAllWorkCards(): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((res) => {
    const tx = db.transaction(IDB_STORE, 'readwrite'); const st = tx.objectStore(IDB_STORE);
    const g = st.getAllKeys();
    g.onsuccess = () => { for (const k of (g.result || []) as any[]) if (typeof k === 'string' && k.indexOf(WORKCARD_PREFIX) === 0) st.delete(k); };
    tx.oncomplete = () => res(); tx.onerror = () => res();
  });
  db.close();
  try { localStorage.removeItem(WORKCARD_IDX); } catch (_) {}
}

// ── 전체 백업/복원용: cards 스토어 통째 열거·복원(전역 last + 작품별 work:*) ──
//   백업이 카드 바이트를 zip에 사파일로 담을 수 있게 키와 함께 내보낸다. 복원은 키 그대로 되돌림(LRU 가드 없이 무손실).
export async function idbExportCards(): Promise<Array<{ key: string; name: string; bytes: Uint8Array; ts: number }>> {
  const db = await idbOpen();
  const out = await new Promise<Array<{ key: string; name: string; bytes: Uint8Array; ts: number }>>((res) => {
    const tx = db.transaction(IDB_STORE, 'readonly'); const st = tx.objectStore(IDB_STORE);
    const kq = st.getAllKeys(); const vq = st.getAll();   // 같은 키 순서로 반환됨(IndexedDB 보장) → index 짝
    let keys: any[] = [], vals: any[] = [];
    kq.onsuccess = () => { keys = kq.result || []; }; vq.onsuccess = () => { vals = vq.result || []; };
    tx.oncomplete = () => res(keys.map((k, i) => ({ k: String(k), v: vals[i] })).filter((x) => x.v && x.v.bytes)
      .map((x) => ({ key: x.k, name: x.v.name, bytes: x.v.bytes instanceof Uint8Array ? x.v.bytes : new Uint8Array(x.v.bytes), ts: x.v.ts || 0 })));
    tx.onerror = () => res([]);
  });
  db.close(); return out;
}
export async function idbImportCard(key: string, rec: { name: string; bytes: Uint8Array; ts?: number }): Promise<void> {
  if (!key || !rec || !rec.bytes) return;
  const db = await idbOpen();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({ name: rec.name, bytes: rec.bytes instanceof Uint8Array ? rec.bytes : new Uint8Array(rec.bytes), ts: rec.ts || Date.now() }, key);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  db.close();
}

// ── 관리실 보관(Phase 3) — ★데스크탑 전용·동기화 안 함·서재(logs/blobs)와 독립 스토어. ──
//   저장 모델(사장님 확정): 원본 파일 통째 보관(srcFiles, 파일 콘텐츠해시 dedup=같은 소스 1벌) + 소스 카탈로그(srcCatalog, id=파일해시).
//   에셋은 쓸 때 지연 추출(Phase 2 cardAssets)이라 보관은 즉시(대형 모듈도 디코드 0). assetCount/ruleCount는 호출부가 계산해 넘김(store는 저장만).
const archiveToBytes = (x: any): Uint8Array => (x instanceof Uint8Array ? x : new Uint8Array(x));
export async function archiveSaveSource(bytes: Uint8Array, meta: { name?: string; format?: string; assetCount?: number; ruleCount?: number } = {}): Promise<any> {
  const b = archiveToBytes(bytes);
  const h = await sha256Hex(b);   // 파일 콘텐츠 해시 = id(=중복 보관 방지). 같은 파일 다시 떨궈도 1벌.
  const db = await idbOpen();
  const prev = await new Promise<any>((res) => { const g = db.transaction(IDB_SRC, 'readonly').objectStore(IDB_SRC).get(h); g.onsuccess = () => res(g.result); g.onerror = () => res(null); });
  const entry = { id: h, name: meta.name || '소스', format: meta.format || '', size: b.length, assetCount: meta.assetCount || 0, ruleCount: meta.ruleCount || 0, addedAt: (prev && prev.addedAt) || Date.now(), updatedAt: Date.now() };
  await new Promise<void>((res, rej) => {
    const tx = db.transaction([IDB_SRC, IDB_SRCFILE], 'readwrite');
    tx.objectStore(IDB_SRC).put(entry);
    tx.objectStore(IDB_SRCFILE).put({ h, bytes: b, format: meta.format || '' });   // put = dedup(같은 해시 1벌)
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  db.close();
  return Object.assign({ existed: !!prev }, entry);
}
export async function archiveList(): Promise<any[]> {
  const db = await idbOpen();
  const r = await new Promise<any[]>((res) => { const g = db.transaction(IDB_SRC, 'readonly').objectStore(IDB_SRC).getAll(); g.onsuccess = () => res(g.result || []); g.onerror = () => res([]); });
  db.close();
  return r.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));   // 최신 보관 먼저
}
export async function archiveGetFile(id: string): Promise<Uint8Array | null> {
  if (!id) return null;
  const db = await idbOpen();
  const rec = await new Promise<any>((res) => { const g = db.transaction(IDB_SRCFILE, 'readonly').objectStore(IDB_SRCFILE).get(id); g.onsuccess = () => res(g.result); g.onerror = () => res(null); });
  db.close();
  return rec && rec.bytes ? (rec.bytes instanceof Uint8Array ? rec.bytes : new Uint8Array(rec.bytes)) : null;
}
export async function archiveDelete(id: string): Promise<void> {
  if (!id) return;
  const db = await idbOpen();
  await new Promise<void>((res) => { const tx = db.transaction([IDB_SRC, IDB_SRCFILE], 'readwrite'); tx.objectStore(IDB_SRC).delete(id); tx.objectStore(IDB_SRCFILE).delete(id); tx.oncomplete = () => res(); tx.onerror = () => res(); });
  db.close();
}
// 전체 백업 복원용: 보관 소스를 카탈로그 엔트리·원본 바이트 그대로 되살림(★id=파일해시·보관시각 보존, dedup put). archiveSaveSource와 달리 해시 재계산·시각 갱신 안 함.
export async function archiveImport(entry: any, bytes: Uint8Array): Promise<void> {
  const b = archiveToBytes(bytes); const id = String((entry && entry.id) || '');
  if (!id || !b.length) return;
  const e = {
    id, name: String((entry && entry.name) || '소스').slice(0, 300), format: String((entry && entry.format) || ''),
    size: b.length, assetCount: +((entry && entry.assetCount) || 0) || 0, ruleCount: +((entry && entry.ruleCount) || 0) || 0,
    addedAt: +((entry && entry.addedAt) || 0) || Date.now(), updatedAt: +((entry && entry.updatedAt) || 0) || Date.now(),
  };
  const db = await idbOpen();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction([IDB_SRC, IDB_SRCFILE], 'readwrite');
    tx.objectStore(IDB_SRC).put(e);
    tx.objectStore(IDB_SRCFILE).put({ h: id, bytes: b, format: e.format });
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  db.close();
}
