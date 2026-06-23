// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/sync.ts — 로그인 상태에 따라 백엔드를 갈아끼우고 첫 로그인 시 로컬→클라우드 병합.
//
// initSync(onChange): 페이지(에디터/서재) 시작 시 1회 호출.
//   - 로그인 → FirebaseBackend로 교체(+오프라인캐시 hydrate +로컬데이터 병합) → onChange('firebase').
//   - 로그아웃 → LocalBackend로 복귀 → onChange('local').
//   onChange는 그 페이지의 데이터 의존 UI를 다시 그리는 콜백(에디터=설정/미리보기 재빌드, 서재=목록 새로고침).
//
// 병합 정책(개인용): 클라우드 우선(덮어쓰지 않음) + 로컬에만 있는 것만 올림 → 데이터 손실 방지.
//   첫 로그인(클라우드 비었음)=로컬 전부 업로드. 재로그인=클라우드 채택 + 로컬 단독분만 보충.
// @ts-nocheck
import { watchAuth } from './auth.js';
import { setBackend, LocalBackend, READ_KEY, RDR_KEY, PRESET_LIB_KEY, AUTOSAVE_KEY, logContentKey } from './store.js';
import { isLocalFirst } from './desktopSync.js';   // 로컬-퍼스트(데스크탑 OR 웹-수동)는 자동 동기화 안 함(수동 버튼식)
// firebaseBackend(=firestore+storage, 무거움)는 "로그인된 순간"에만 동적 import → 로그아웃 사용자는 안 받음.

const KV_KEYS = [AUTOSAVE_KEY, PRESET_LIB_KEY, READ_KEY, RDR_KEY];
let migratedFor: string | null = null;   // uid별 1회만 병합

async function migrateLocalToCloud(fb: any, uid: string) {
  if (migratedFor === uid) return;
  migratedFor = uid;
  // 로그: 로컬에만 있는 화를 업로드(클라우드에 있는 건 건드리지 않음).
  //   ★중복 방지: id가 새것이어도 "내용 지문"이 같은 화가 클라우드에 이미 있으면 올리지 않는다
  //   (기기 왔다갔다 하며 같은 글을 다시 만든/가져온 경우 → 같은 화가 2벌로 불어나는 것 차단).
  let localLogs: any[] = []; try { localLogs = await LocalBackend.logsAll(); } catch (_) {}
  let cloudDocs: any[] = []; try { cloudDocs = fb.logKeyData ? await fb.logKeyData() : await fb.logsAll(); } catch (_) {}
  const cloudIds = new Set(cloudDocs.map((d: any) => String(d.id)));
  const cloudKeys = new Set(cloudDocs.map((d: any) => logContentKey(d)));
  for (const l of localLogs) {
    if (cloudIds.has(String(l.id))) continue;            // 이미 같은 id로 있음
    if (cloudKeys.has(logContentKey(l))) continue;       // 내용이 같은 화가 이미 있음 → 새 중복 방지
    try { await fb.logsAdd(l); } catch (e) { console.warn('[sync] 로그 업로드 실패', l && l.id, e); }
  }
  // 작품 메타: 로컬에만 있는 것 업로드
  let localMetas: any[] = []; try { localMetas = await LocalBackend.metaAll(); } catch (_) {}
  let cloudChars = new Set<string>(); try { cloudChars = new Set((await fb.metaAll()).map((m: any) => String(m.char))); } catch (_) {}
  for (const m of localMetas) {
    if (!cloudChars.has(String(m.char))) { try { await fb.metaSet(m); } catch (_) {} }
  }
  // KV(설정/읽기상태 등): 클라우드에 없는 키만 로컬값으로 보충
  for (const key of KV_KEYS) {
    if (fb.kvLoad(key) == null) { const v = LocalBackend.kvLoad(key); if (v != null) fb.kvSave(key, v); }
  }
}

// 클라우드 → 로컬 미러(로컬-퍼스트): 받은 데이터를 로컬 IndexedDB에도 복사해 둠 →
// 다음에 어느 페이지를 열든 로컬에서 "즉시" 그릴 수 있게(로딩 화면은 사이트 첫 진입에만).
// onBackendChange를 막지 않도록 백그라운드로 돌린다. 과도한 재미러 방지 위해 6초 스로틀.
let mirroring = false, lastMirror = 0;
const MIRROR_TS_KEY = 'pro2-last-mirror';
function recentMirror(): boolean { try { return Date.now() - (+(localStorage.getItem(MIRROR_TS_KEY) || 0)) < 20000; } catch (_) { return false; } }
async function mirrorCloudToLocal(fb: any, force?: boolean) {
  if (mirroring) return;
  if (!force && recentMirror()) return;   // 최근(20초내) 미러했으면 스킵 — 잦은 페이지 이동 시 과도한 I/O 방지
  mirroring = true;
  try {
    const cloudLogs = await fb.logsAll();
    const cloudIds = new Set(cloudLogs.map((l: any) => String(l.id)));
    const localLogs = await LocalBackend.logsAll();
    const localById = new Map(localLogs.map((l: any) => [String(l.id), l]));
    for (const l of localLogs) if (!cloudIds.has(String(l.id))) { try { await LocalBackend.logsDelete(l.id); } catch (_) {} }
    for (const l of cloudLogs) {   // 바뀐 것만 기록(같은 savedAt이면 스킵) → IndexedDB 쓰기 최소화
      const loc: any = localById.get(String(l.id));
      if (!loc || (loc.savedAt || 0) !== (l.savedAt || 0)) { try { await LocalBackend.logsAdd(l); } catch (_) {} }
    }
    const cloudMeta = await fb.metaAll();
    const cloudChars = new Set(cloudMeta.map((m: any) => String(m.char)));
    const localMeta = await LocalBackend.metaAll();
    const localMetaBy = new Map(localMeta.map((m: any) => [String(m.char), m]));
    for (const m of localMeta) if (!cloudChars.has(String(m.char))) { try { await LocalBackend.metaDelete(m.char); } catch (_) {} }
    for (const m of cloudMeta) {
      const loc: any = localMetaBy.get(String(m.char));
      if (!loc || (loc.savedAt || 0) !== (m.savedAt || 0)) { try { await LocalBackend.metaSet(m); } catch (_) {} }
    }
    for (const k of fb.kvKeys()) { try { LocalBackend.kvSave(k, fb.kvLoad(k)); } catch (_) {} }
    lastMirror = Date.now(); try { localStorage.setItem(MIRROR_TS_KEY, String(lastMirror)); } catch (_) {}
  } catch (e) { console.warn('[sync] 로컬 미러 실패', e); }
  finally { mirroring = false; }
}

// onBackendChange(kind,user): 백엔드 교체 시(로그인/로그아웃) 전체 다시 그림.
// onDataChange(): 클라우드 로그가 실시간으로 바뀌면(다른 기기 포함) 가벼운 새로고침(C단계).
export function initSync(onBackendChange: (kind: string, user: any) => void, onDataChange?: () => void): void {
  // ★로컬-퍼스트(데스크탑 OR 웹-수동 모드): 자동 동기화 안 함. 백엔드는 항상 로컬(UI 즉시·오프라인), 클라우드
  //   교환은 사용자가 ☁ 버튼을 눌렀을 때만. 여기선 로그인 상태에 따른 housekeeping만(백엔드 교체 X).
  if (isLocalFirst()) {
    watchAuth((user: any) => { try { onBackendChange('local', user); } catch (_) {} });
    return;
  }
  let cur = 'local';
  let unsub: any = null;       // 실시간 리스너 해제 함수
  let dataT: any = null;       // onDataChange 디바운스(변경 몰아치기 합치기)
  let fbRef: any = null;       // 현재 firebase 백엔드(실시간 미러용)
  const scheduleData = () => {
    if (fbRef && Date.now() - lastMirror > 6000) mirrorCloudToLocal(fbRef, true);  // 실시간 변경 → 로컬 미러 갱신(실변경이라 force)
    if (!onDataChange) return; clearTimeout(dataT); dataT = setTimeout(() => { try { onDataChange(); } catch (_) {} }, 250);
  };
  const teardown = () => { if (unsub) { try { unsub(); } catch (_) {} unsub = null; } clearTimeout(dataT); };
  // 네트워크 복구 시: 보관 대기(클라우드 푸시 실패)분을 자동 재업로드.
  try { window.addEventListener('online', () => { if (fbRef && fbRef.flushPending) fbRef.flushPending(); }); } catch (_) {}
  watchAuth(async (user: any) => {
    if (user) {
      try {
        const { createFirebaseBackend } = await import('./firebaseBackend.js');  // 무거운 SDK는 여기서 로드
        const fb = createFirebaseBackend(user.uid);
        await fb.hydrate();                  // 클라우드 KV를 메모리로(동기 kvLoad 가능하게)
        await migrateLocalToCloud(fb, user.uid);
        setBackend(fb, 'firebase'); fbRef = fb;
        teardown();
        if (fb.watchLogs) unsub = fb.watchLogs(scheduleData);   // 실시간: 로그 변경 → onDataChange
        if (cur !== 'firebase') { cur = 'firebase'; try { onBackendChange('firebase', user); } catch (_) {} }
        if (fb.flushPending) fb.flushPending();   // 로컬-퍼스트: 지난번 클라우드 푸시 실패분(보관 대기)을 지금 올림
        mirrorCloudToLocal(fb);   // 백그라운드: 클라우드 → 로컬 미러(다음 로드 즉시표시용). onBackendChange는 안 막음.
      } catch (e) {
        console.warn('[sync] Firebase 백엔드 활성 실패 — 로컬 유지', e);
        teardown(); fbRef = null;
        setBackend(null, 'local');
        if (cur !== 'local') { cur = 'local'; try { onBackendChange('local', user); } catch (_) {} }
      }
    } else {
      teardown(); fbRef = null;
      setBackend(null, 'local');             // 로그아웃 → 로컬 복귀
      migratedFor = null;
      if (cur !== 'local') { cur = 'local'; try { onBackendChange('local', null); } catch (_) {} }
    }
  });
}
