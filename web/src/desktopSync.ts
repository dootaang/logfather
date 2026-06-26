// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/desktopSync.ts — 데스크탑 전용 수동 동기화(버튼식 + 진행률).
//
// 데스크탑은 "안 썩는 영구 보관소" = 로컬-퍼스트 독립. 백엔드는 항상 로컬(UI 즉시·오프라인 동작),
// 클라우드와의 교환은 ★사용자가 버튼을 눌렀을 때만. 자동 백그라운드 동기화 없음(웹은 현행 자동 유지).
//   - 불러오기(pull): 클라우드 → 로컬 (추가/최신갱신만, 로컬 단독분 절대 삭제 안 함).
//   - 저장(push):     로컬 → 클라우드 (로컬 단독분 추가 + 로컬이 더 최신인 것만, 최신 클라우드 안 덮음).
//   - 연동 안 함:     완전 로컬 전용(버튼 비활성).
// @ts-nocheck
import { LocalBackend, logContentKey, clearUnpushed, loadPendingDeletes, clearPendingDeletion } from './store.js';

export function isDesktop(): boolean { return !!(typeof window !== 'undefined' && (window as any).desktop); }

// 공유 링크 베이스 — 받는 사람은 웹에서 연다. ★데스크탑(app://logpapa)에선 웹 호스트로 강제(안 그러면
//   app:// 링크가 나가서 다른 사람 브라우저에서 안 열림). 웹은 현 위치 유지(배포/깃헙페이지/로컬 dev 호환).
const WEB_HOST = 'https://logpapa.web.app';
export function shareBaseUrl(): string {
  // 공유 링크는 리더 독립 페이지(reader.html)로 — 비로그인 외부인이 가볍게 열람(서재 init 안 거침).
  // 옛 library.html#/share 링크는 library route()가 reader.html로 리다이렉트(하위호환).
  if (isDesktop()) return WEB_HOST + '/reader.html';
  return location.origin + location.pathname.replace(/[^/]*$/, 'reader.html');
}

const MODE_KEY = 'pro2-desktop-sync-mode';   // 'manual' | 'off' — 로컬 저장(동기화 안 함). 기본 manual. (로컬-퍼스트일 때 ☁모달의 off 체크)
export function getSyncMode(): string { try { return localStorage.getItem(MODE_KEY) || 'manual'; } catch (_) { return 'manual'; } }
export function setSyncMode(m: string): void { try { localStorage.setItem(MODE_KEY, m); } catch (_) {} }

// ── 웹 동기화 모드(자동/수동) — ★웹 전용. 데스크탑은 항상 로컬-퍼스트라 이 키를 무시한다. 기본 자동(현행 유지). ──
const WEB_MODE_KEY = 'pro2-web-sync-mode';   // 'auto' | 'manual' — 웹에서만 의미.
export function getWebSyncMode(): string { try { return localStorage.getItem(WEB_MODE_KEY) || 'auto'; } catch (_) { return 'auto'; } }
export function setWebSyncMode(m: string): void { try { localStorage.setItem(WEB_MODE_KEY, m === 'manual' ? 'manual' : 'auto'); } catch (_) {} }
// ── 데스크탑 동기화 모드(자동/수동) — ★기본 수동(기존 데스크탑 거동 유지). '자동'일 때만 웹처럼 실시간 클라우드. ──
const DESKTOP_MODE_KEY = 'pro2-desktop-auto-mode';   // 'auto' | 'manual' — 데스크탑에서만 의미.
export function getDesktopSyncMode(): string { try { return localStorage.getItem(DESKTOP_MODE_KEY) === 'auto' ? 'auto' : 'manual'; } catch (_) { return 'manual'; } }
export function setDesktopSyncMode(m: string): void { try { localStorage.setItem(DESKTOP_MODE_KEY, m === 'auto' ? 'auto' : 'manual'); } catch (_) {} }
// ★로컬-퍼스트 단일 판정 = 동기화 거동 게이트(초기화·☁버튼·공유 가용성이 공유). 플랫폼별:
//   웹 = ★항상 로컬-퍼스트(백엔드는 항상 로컬·UI 즉시·오프라인). 'auto'/'manual'은 클라우드 교환 방식 차이일 뿐:
//        auto=백그라운드 자동 일괄(sync.ts), manual=☁버튼식. (실시간 Firebase 백엔드 모드는 폐지 — 병목 제거.)
//   데스크탑 = 모드가 '자동'이 아니면 로컬-퍼스트(기본 수동). 데스크탑 'auto'만 실시간 Firebase 백엔드 유지.
//   (네이티브 전용 기능[번역·굳히기·공유 호스트]은 isDesktop() 등 각자 검사 → 모드와 무관.)
export function isLocalFirst(): boolean { return isDesktop() ? getDesktopSyncMode() !== 'auto' : true; }

// 현재 로그인 사용자로 firebase 백엔드 확보(없으면 null). 무거운 SDK·hydrate는 여기서만. uid별 1회 캐시.
let _fbCache: { uid: string; fb: any } | null = null;
async function fbForUser(): Promise<any | null> {
  try {
    const A = await import('./auth.js');
    const u = A.currentUser ? A.currentUser() : null;
    if (!u) return null;
    if (_fbCache && _fbCache.uid === u.uid) { try { await _fbCache.fb.hydrate(); } catch (_) {} return _fbCache.fb; }
    const { createFirebaseBackend } = await import('./firebaseBackend.js');
    const fb = createFirebaseBackend(u.uid);
    await fb.hydrate();
    _fbCache = { uid: u.uid, fb };
    return fb;
  } catch (_) { return null; }
}

export interface SyncReport { added: number; updated: number; metas: number; scanned: number; }
type Prog = (done: number, total: number, label?: string) => void;

const pullTsKey = (uid: string) => 'pro2-pull-ts-' + uid;   // uid별 "마지막으로 받은 savedAt"(증분 기준)

// 클라우드 → 로컬 (안전 병합·증분): savedAt이 lastTs 이상인 로그만 받아 추가/최신갱신. ★로컬 단독분 삭제 안 함.
//   opts.full=true면 전체(처음부터). 첫 증분(저장된 ts 없음)은 로컬 최신 savedAt 기준 → 이미 가진 건 안 받음.
export async function pullFromCloud(onProgress?: Prog, opts: { full?: boolean } = {}): Promise<SyncReport | null> {
  const fb = await fbForUser(); if (!fb) return null;
  const uid = _fbCache ? _fbCache.uid : '';
  const localLogs = await LocalBackend.logsAll();
  const localById = new Map(localLogs.map((l: any) => [String(l.id), l]));
  // 증분 기준 시각 결정.
  let lastTs = 0;
  if (!opts.full) {
    const stored = uid ? localStorage.getItem(pullTsKey(uid)) : null;
    lastTs = stored != null ? Number(stored) : localLogs.reduce((m: number, l: any) => Math.max(m, l.savedAt || 0), 0);
  }
  const cloudLogs = await fb.logsSince(lastTs);   // 증분(savedAt>=lastTs) 또는 전체(0)
  let added = 0, updated = 0, maxSaved = lastTs;
  for (let i = 0; i < cloudLogs.length; i++) {
    const l = cloudLogs[i]; const loc = localById.get(String(l.id));
    if (!loc) { try { await LocalBackend.logsAdd(l); added++; } catch (_) {} }
    else if ((loc.savedAt || 0) < (l.savedAt || 0)) { try { await LocalBackend.logsAdd(l); updated++; } catch (_) {} }
    maxSaved = Math.max(maxSaved, l.savedAt || 0);
    if (onProgress) onProgress(i + 1, cloudLogs.length, '로그');
  }
  let metas = 0;
  try {
    const localMetaBy = new Map((await LocalBackend.metaAll()).map((m: any) => [String(m.char), m]));
    for (const m of await fb.metaAll()) { const loc = localMetaBy.get(String(m.char)); if (!loc || (loc.savedAt || 0) < (m.savedAt || 0)) { try { await LocalBackend.metaSet(m); metas++; } catch (_) {} } }
  } catch (_) {}
  try { for (const k of fb.kvKeys()) { if (LocalBackend.kvLoad(k) == null) LocalBackend.kvSave(k, fb.kvLoad(k)); } } catch (_) {}   // 로컬에 없는 설정만 보충(로컬 우선)
  if (uid) { try { localStorage.setItem(pullTsKey(uid), String(maxSaved)); } catch (_) {} }   // 다음 증분 기준 갱신
  return { added, updated, metas, scanned: cloudLogs.length };
}

// 로컬 → 클라우드 (안전 병합): 로컬 단독분 추가(내용 중복 제외) + 로컬이 더 최신인 것만 갱신. ★최신 클라우드 안 덮음.
export async function pushToCloud(onProgress?: Prog): Promise<SyncReport | null> {
  const fb = await fbForUser(); if (!fb) return null;
  // ★삭제 전파 먼저: 명시적으로 지운 작품의 로그·메타를 클라우드에서도 제거(안 하면 다음 pull이 metaAll로
  //   메타를 되살려 "화 0개 빈 작품"이 서재 맨밑에 쌓임). fb.metaDelete는 로컬 메타도 지우므로, pull이 먼저
  //   끼어들어 로컬에 메타를 되살렸더라도 같이 정리됨. 실패(오프라인 등)는 큐 유지 → 다음 push 재시도.
  for (const d of loadPendingDeletes()) {
    try {
      for (const id of d.ids) { try { await fb.logsDelete(id); } catch (_) {} }
      try { await fb.metaDelete(d.char); } catch (_) {}
      clearPendingDeletion(d.char);
    } catch (_) { /* 큐 유지 → 다음 push에서 재시도 */ }
  }
  const localLogs = await LocalBackend.logsAll();
  let cloudDocs: any[] = []; try { cloudDocs = fb.logKeyData ? await fb.logKeyData() : await fb.logsAll(); } catch (_) {}
  const cloudById = new Map(cloudDocs.map((d: any) => [String(d.id), d]));
  const cloudKeys = new Set(cloudDocs.map((d: any) => logContentKey(d)));
  let added = 0, updated = 0;
  for (let i = 0; i < localLogs.length; i++) {
    const l = localLogs[i]; const cloud = cloudById.get(String(l.id));
    if (!cloud) { if (!cloudKeys.has(logContentKey(l))) { try { await fb.logsAdd(l); added++; } catch (_) {} } }   // 내용 같은 화 이미 있으면 중복 방지 스킵
    else if ((l.savedAt || 0) > (cloud.savedAt || 0)) { try { await fb.logsAdd(l); updated++; } catch (_) {} }      // 로컬이 더 최신일 때만
    if (onProgress) onProgress(i + 1, localLogs.length, '로그');
  }
  let metas = 0;
  try {
    const cloudMetaBy = new Map((await fb.metaAll()).map((m: any) => [String(m.char), m]));
    for (const m of await LocalBackend.metaAll()) { const c = cloudMetaBy.get(String(m.char)); if (!c || (m.savedAt || 0) > (c.savedAt || 0)) { try { await fb.metaSet(m); metas++; } catch (_) {} } }
  } catch (_) {}
  try { for (const k of ['pro2-preset-autosave', 'pro2-preset-library', 'pro2-read', 'pro2-reader']) { const v = LocalBackend.kvLoad(k); if (v != null && fb.kvLoad(k) == null) fb.kvSave(k, v); } } catch (_) {}
  try { const v = LocalBackend.kvLoad('pro2-cleanup-rules'); if (v != null) fb.kvSave('pro2-cleanup-rules', v); } catch (_) {}   // ★정리 규칙은 갱신도 반영(fill-if-missing 예외·최신 우선) → 데스크탑 규칙 변경이 웹 리더에 동기화
  clearUnpushed();   // ★push 성공 → "안 올린 변경" 해제(이 기기 로컬이 클라우드에 반영됨)
  return { added, updated, metas, scanned: localLogs.length };
}

// ── 동기화 모달(불러오기/저장 + 진행률 + 연동 안 함) ─────────────────
let modalEl: HTMLElement | null = null;
export async function openSyncModal(A: any): Promise<void> {
  if (modalEl) { modalEl.remove(); modalEl = null; }
  const user = A && A.currentUser ? A.currentUser() : null;
  const ov = document.createElement('div'); ov.className = 'import-modal'; modalEl = ov;
  const card = document.createElement('div'); card.className = 'import-card';
  const close = () => { ov.remove(); modalEl = null; };
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-title', textContent: '클라우드 동기화 (수동)' }));
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-info', textContent: '이 앱은 로컬에 먼저 저장됩니다(독립 동작). 클라우드와의 동기화는 아래 버튼을 누를 때만 일어납니다.' }));

  if (!user) {
    card.appendChild(Object.assign(document.createElement('div'), { className: 'import-info', textContent: '동기화하려면 먼저 로그인하세요(상단 “로그인”).' }));
    const b = Object.assign(document.createElement('button'), { textContent: '닫기' }); b.onclick = close;
    const btns = document.createElement('div'); btns.className = 'import-btns'; btns.append(b); card.appendChild(btns);
    ov.appendChild(card); document.body.appendChild(ov); ov.addEventListener('click', (e) => { if (e.target === ov) close(); }); return;
  }

  // 진행률 바
  const bar = document.createElement('div'); bar.className = 'sync-progress'; const fill = document.createElement('div'); fill.className = 'sync-progress-fill'; bar.appendChild(fill);
  const note = Object.assign(document.createElement('div'), { className: 'import-info', textContent: '' });
  const setProg = (d: number, t: number, label?: string) => { const pct = t ? Math.round((d / t) * 100) : 100; fill.style.width = pct + '%'; note.textContent = `${label || ''} ${d}/${t} (${pct}%)`; };

  const pullB = Object.assign(document.createElement('button'), { className: 'primary', textContent: '⬇ 클라우드에서 불러오기' });
  pullB.title = '바뀐 로그만 빠르게 가져옵니다(로컬에만 있는 건 그대로 유지).';
  const pushB = Object.assign(document.createElement('button'), { textContent: '⬆ 현재 상태 클라우드에 저장' });
  pushB.title = '이 기기의 로그를 클라우드에 올립니다(클라우드의 더 최신 글은 덮지 않음).';
  // 증분이 기본 — 평소엔 바뀐 것만. 체크하면 처음부터 전체 다시(다른 기기서 옛 글이 안 보일 때).
  const fullWrap = document.createElement('label'); fullWrap.className = 'import-check';
  const fullCb = document.createElement('input'); fullCb.type = 'checkbox';
  fullWrap.append(fullCb, document.createTextNode(' 불러올 때 처음부터 전체 다시 받기 (느림)'));
  const offWrap = document.createElement('label'); offWrap.className = 'import-check';
  const offCb = document.createElement('input'); offCb.type = 'checkbox'; offCb.checked = getSyncMode() === 'off';
  offWrap.append(offCb, document.createTextNode(' 연동 안 함 (로컬 전용 — 클라우드를 건드리지 않음)'));

  const applyMode = () => { const off = offCb.checked; pullB.disabled = off; pushB.disabled = off; fullCb.disabled = off; };
  offCb.onchange = () => { setSyncMode(offCb.checked ? 'off' : 'manual'); applyMode(); };
  applyMode();

  const run = async (which: 'pull' | 'push') => {
    pullB.disabled = pushB.disabled = true; fill.style.width = '0%';
    // 무거운 일괄 다운로드/업로드 전엔 진행 카운트가 없어 "시작…"이 멈춰 보임 → 무슨 일인지 안내.
    note.textContent = which === 'pull'
      ? (fullCb.checked ? '클라우드에서 전체 받는 중… (로그·이미지 많으면 시간이 걸려요)' : '클라우드에서 바뀐 로그 확인 중…')
      : '클라우드 상태 확인 중…';
    try {
      const res = which === 'pull' ? await pullFromCloud(setProg, { full: fullCb.checked }) : await pushToCloud(setProg);
      if (!res) { note.textContent = '로그인이 필요합니다.'; }
      else {
        fill.style.width = '100%';
        const base = `새 ${res.added}개 · 갱신 ${res.updated}개 · 작품정보 ${res.metas}개`;
        note.textContent = which === 'pull'
          ? `불러오기 완료 — ${base}` + (res.added + res.updated === 0 ? ' (이미 최신)' : '')
          : `저장 완료 — ${base}`;
        try { window.dispatchEvent(new Event('pro2-desktop-synced')); } catch (_) {}   // 페이지가 서재/배지 새로고침
      }
    } catch (e: any) { note.textContent = '실패: ' + ((e && e.message) || ''); }
    applyMode();
  };
  pullB.onclick = () => run('pull');
  pushB.onclick = () => run('push');

  const btns = document.createElement('div'); btns.className = 'import-btns';
  const closeB = Object.assign(document.createElement('button'), { textContent: '닫기' }); closeB.onclick = close;
  btns.append(pullB, pushB, closeB);
  card.append(fullWrap, offWrap, bar, note, btns);
  ov.appendChild(card); document.body.appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
}
