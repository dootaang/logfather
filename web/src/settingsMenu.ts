// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/settingsMenu.ts — 앱-레벨 ⚙ 설정 메뉴. 서재 홈이 단독 소유(편집기엔 없음, 결정 '가').
//   테마·스킨·복사화질·전체 백업/복원(★저장소 스냅샷)·Pro1 가져오기·고급 설정·내 폰트.
//   ★백업 = 저장소(autosave/presets/logs/meta/read/reader)를 그대로 덤프/복원 → 편집기 라이브 상태 불필요·무손실.
//     편집기는 항상 autosave에 현재 상태를 기록하므로 스냅샷이 곧 현재 상태. 옛 v2(designs) 백업은
//     프리셋·서재·읽기상태만 복원(작업중 룩은 생략 — 콘텐츠/프리셋은 안전).
// @ts-nocheck
import { confirmModal } from './confirmModal.js';
import { initTheme, wireThemeToggle, applyShellTheme, getThemePref, applySkin, refreshSkinOptions, SKIN_KEY, SHELL_THEME_KEY, buildCustomSkin } from './appSettings.js';
import { kvLoad, kvSave, logsAll, logsAdd, metaAll, metaSet, clearLibraryLocal, dedupeLogsInStore, AUTOSAVE_KEY, PRESET_LIB_KEY, READ_KEY, RDR_KEY,
  idbExportCards, idbImportCard, archiveList, archiveGetFile, archiveImport, fontsAll, fontsAdd } from './store.js';
import { buildBackup, openBackup, isZip } from '../../core/preset/backupZip.js';
import { fontsSupported, getFontList, addFontFiles, removeFont, getUiFont, applyUiFont, refreshFonts } from './fonts.js';
import { isDesktop, getWebSyncMode, setWebSyncMode, getDesktopSyncMode, setDesktopSyncMode } from './desktopSync.js';   // 동기화 모드(자동/수동) 토글용(웹·데스크탑)

const APP_ID = 'log-jejogi-pro2';
const DESIGN_IDS = ['card', 'log-diary', 'custom-css'];
const JPEG_KEY = 'pro2-clipboard-jpeg';
const esc = (s: any) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
function download(name: string, text: string) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function downloadBytes(name: string, bytes: Uint8Array, mime: string) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: mime })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function flash(b: HTMLElement | null, msg: string) { if (!b) return; const o = b.textContent; b.textContent = msg; setTimeout(() => { b.textContent = o; }, 1400); }

// 서재 홈 상단 ⚙ 메뉴 배선. opts: 상태표시·로그인 사용자/모듈 접근(고급 클라우드 기능)·데이터 변경 후 새로고침.
export function mountSettingsMenu(opts: { setStatus: (m: string) => void; getUser: () => any; getAuthMod: () => any; refresh?: () => void }) {
  const setStatus = opts.setStatus;
  initTheme();   // 테마 적용(토글 버튼은 "디자인 설정" 모달 안)
  applySkin(localStorage.getItem(SKIN_KEY) || 'atelier');   // ★저장된 스킨(커스텀이면 오버라이드까지) 적용 — 드롭다운은 모달
  injectDesign(setStatus);   // ⚙ → "디자인 설정" 모달(스킨·테마·폰트·UI커스텀 통합)
  // 복사·공유 화질(JPEG) — 모바일 기본 켜짐
  const chk = document.getElementById('chk-jpeg') as HTMLInputElement | null;
  if (chk) {
    const isMob = /Android|iPhone|iPad|iPod|Mobile|Mobi/i.test(navigator.userAgent) || !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
    const saved = localStorage.getItem(JPEG_KEY); chk.checked = saved === null ? isMob : saved === '1';
    chk.addEventListener('change', () => { try { localStorage.setItem(JPEG_KEY, chk.checked ? '1' : '0'); } catch (_) {} });
  }
  wireBackup(setStatus, opts.refresh);
  injectRisuConnect(opts.getUser);
  injectAdvanced(setStatus, opts.getUser, opts.getAuthMod, opts.refresh);
  // 메뉴 항목 클릭 시 드롭다운 닫기 + 바깥 클릭 닫기
  document.addEventListener('click', (e) => { document.querySelectorAll('details.menu[open]').forEach((d) => { if (!d.contains(e.target as Node)) (d as HTMLDetailsElement).open = false; }); });
  document.querySelectorAll('.menu-pop button').forEach((b) => b.addEventListener('click', () => { const d = b.closest('details.menu') as HTMLDetailsElement | null; if (d) d.open = false; }));
}

// ── 전체 백업/복원 = 저장소 스냅샷(v4) ────────────────────────────────
//   v4 = 기존(autosave/presets/read/reader/logs/meta) + ★새로 생긴 데이터 전부:
//     · 관리실 영구보관 소스(원본 파일 통째)·커스텀 폰트(파일)·작품별 카드 = 큰 바이너리 → zip에 사파일로 직접(base64 금지).
//     · 일반 KV(정리규칙·번역문체·UI디자인·외형취향 등) = raw 문자열로 무손실 캡처(거부목록 방식 — 새 키 자동 포함).
//   ★백업 제외(복원하면 꼬임/무의미): 번역 API 키·동기화 모드/세션/안올린변경/pending·pull·시리즈공유 id.
const KV_NAMED = new Set([AUTOSAVE_KEY, PRESET_LIB_KEY, READ_KEY, RDR_KEY]);   // 아래 named 슬롯이 따로 담당 → 일반 KV에서 제외
const KV_EXCLUDE = new Set([
  'pro2-translate-config-web',                                               // ★웹 번역 API 키 — 절대 백업 안 함(불변식)
  'pro2-web-sync-mode', 'pro2-desktop-sync-mode', 'pro2-desktop-auto-mode',  // 동기화 모드(기기 종속)
  'pro2-session-synced', 'pro2-desktop-synced',                             // 세션 1회 플래그
  'pro2-unpushed', 'pro2-series-shares', 'pro2-last-mirror', 'pro2-share-progress', 'pro2-open-log',  // 기기/계정/세션 일시상태
]);
const KV_EXCLUDE_PREFIX = ['pro2-pending-logs-', 'pro2-pull-ts-'];   // per-uid 큐·타임스탬프(계정 종속)
// ★새 KV 키가 비밀(API키/토큰)·동기화상태·세션/계정 종속이면 위 목록에 추가할 것(아니면 자동으로 백업에 포함됨).
function backupKvKey(k: string): boolean {
  if (!k || k.indexOf('pro2-') !== 0) return false;
  if (KV_NAMED.has(k) || KV_EXCLUDE.has(k)) return false;
  for (const p of KV_EXCLUDE_PREFIX) if (k.indexOf(p) === 0) return false;
  return true;
}
// 일반 KV를 raw 문자열 그대로 캡처(JSON·생문자열 혼재 → kvLoad 안 거치고 원형 보존 = 무손실).
function captureKv(): Record<string, string> {
  const out: Record<string, string> = {};
  try { for (const k of Object.keys(localStorage)) { if (!backupKvKey(k)) continue; const v = localStorage.getItem(k); if (v != null) out[k] = v; } } catch (_) {}
  return out;
}
function snapshot() { return { app: APP_ID, version: 4, kind: 'backup', autosave: kvLoad(AUTOSAVE_KEY), presets: kvLoad(PRESET_LIB_KEY), read: kvLoad(READ_KEY), reader: kvLoad(RDR_KEY), kv: captureKv() }; }
function wireBackup(setStatus: (m: string) => void, refresh?: () => void) {
  const expB = document.getElementById('btn-export'); const impB = document.getElementById('btn-import'); const fileImp = document.getElementById('file-import') as HTMLInputElement | null;
  if (expB) expB.addEventListener('click', async () => {
    const orig = expB.textContent; expB.textContent = '백업 만드는 중…';
    try {
      let logs: any[] = []; try { logs = await logsAll(); } catch (_) {}
      let meta: any[] = []; try { meta = await metaAll(); } catch (_) {}
      // ★큰 바이너리는 base64 문자열이 아니라 zip 안 사파일로(level0). data엔 그 경로 참조만 둔다(수백 MB~GB도 안전).
      const binFiles: Record<string, Uint8Array> = {};
      const management: any[] = [], fonts: any[] = [], cards: any[] = [];
      try { for (const s of await archiveList()) { const bytes = await archiveGetFile(s.id); if (!bytes) continue; const path = 'bin/src/' + s.id + '.' + (s.format || 'bin'); binFiles[path] = bytes; management.push(Object.assign({}, s, { file: path })); } } catch (_) {}
      try { for (const f of await fontsAll()) { if (!f || !f.bytes) continue; const bytes = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes); const path = 'bin/font/' + f.id + '.' + (f.format || 'bin'); binFiles[path] = bytes; fonts.push({ id: f.id, family: f.family, name: f.name, format: f.format, ts: f.ts, file: path }); } } catch (_) {}
      try { const cl = await idbExportCards(); cl.forEach((c, i) => { const path = 'bin/card/' + i + '.bin'; binFiles[path] = c.bytes; cards.push({ key: c.key, name: c.name, ts: c.ts, file: path }); }); } catch (_) {}
      const backup = Object.assign(snapshot(), { logs, meta, management, fonts, cards });
      const stamp = new Date().toISOString().slice(0, 10);
      try { downloadBytes(`log-backup-${stamp}.zip`, buildBackup(backup, binFiles), 'application/zip'); }
      catch (_) { download(`log-backup-${stamp}.json`, JSON.stringify(backup, null, 2)); }   // zip 실패 시 json 폴백(바이너리 제외, 텍스트만)
      flash(expB, `백업 저장됨 (로그 ${logs.length}·소스 ${management.length}·폰트 ${fonts.length})`);
    } finally { if (orig != null) expB.textContent = orig; }
  });
  if (impB && fileImp) {
    impB.addEventListener('click', () => fileImp.click());
    fileImp.addEventListener('change', async () => {
      const f = fileImp.files && fileImp.files[0]; if (!f) return;
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        let obj: any, getBin: (p: string) => Uint8Array | null;
        if (isZip(buf)) { const op = openBackup(buf); obj = op.data; getBin = op.getBin; }   // zip(신규): 데이터 + 바이너리 회수
        else { obj = JSON.parse(new TextDecoder().decode(buf)); getBin = () => null; }        // 옛 json: 바이너리 없음
        if (obj && obj.kind === 'backup') { await restoreBackupObj(obj, getBin, setStatus, refresh); flash(impB, '복원됨!'); }
        else setStatus('백업 파일이 아닙니다 (kind:backup 아님).');
      } catch (e: any) { setStatus('불러오기 실패: ' + e.message); flash(impB, '실패'); }
      fileImp.value = '';
    });
  }
}
async function restoreBackupObj(obj: any, getBin: (p: string) => Uint8Array | null, setStatus: (m: string) => void, refresh?: () => void) {
  if (!(await confirmModal('이 백업으로 이 기기의 프리셋·디자인·서재·관리실·폰트·설정을 덮어쓸까요?', { okText: '복원' }))) return;
  setStatus('복원 중…');
  // 프리셋(디자인별) — DESIGN_IDS만 추려 적용(살균).
  if (obj.presets && typeof obj.presets === 'object') {
    const clean: any = {}; for (const d of DESIGN_IDS) clean[d] = (obj.presets[d] && typeof obj.presets[d] === 'object' && !Array.isArray(obj.presets[d])) ? obj.presets[d] : {};
    kvSave(PRESET_LIB_KEY, clean);
  }
  // v3+ = 편집기 작업본(autosave) 통째 복원. v2(designs)는 작업중 룩 생략(프리셋·서재는 그대로 복원).
  if (obj.autosave && typeof obj.autosave === 'object') kvSave(AUTOSAVE_KEY, obj.autosave);
  // 일반 KV(정리규칙·번역문체·UI디자인·외형취향 등) — raw 문자열 그대로 무손실 복원(거부목록 방어 재적용 = 옛/조작 백업의 제외키 무시).
  if (obj.kv && typeof obj.kv === 'object') { for (const k of Object.keys(obj.kv)) { if (!backupKvKey(k)) continue; const v = obj.kv[k]; if (typeof v === 'string') { try { localStorage.setItem(k, v); } catch (_) {} } } }
  if (obj.read && typeof obj.read === 'object') { try { kvSave(READ_KEY, obj.read); } catch (_) {} }
  if (obj.reader && typeof obj.reader === 'object') { try { kvSave(RDR_KEY, obj.reader); } catch (_) {} }
  // 서재 로그·작품 메타
  if (Array.isArray(obj.logs)) { for (const r of obj.logs) { if (r && r.id) { try { await logsAdd(r); } catch (_) {} } } }
  if (Array.isArray(obj.meta)) {
    for (const m of obj.meta) {
      if (!m || !m.char) continue;
      const cover = (typeof m.cover === 'string' && (/^data:image\//i.test(m.cover) || /^https?:\/\//i.test(m.cover))) ? m.cover : '';
      const desc = String(m.desc || '').replace(/[<>]/g, '').slice(0, 5000);
      const name = String(m.name || '').replace(/[<>]/g, '').slice(0, 300);
      try { await metaSet({ char: String(m.char).slice(0, 300), cover, desc, name }); } catch (_) {}
    }
  }
  // ★관리실 영구보관 소스(원본 바이트 = zip 사파일에서 회수) — id=파일해시·보관시각 보존.
  let nSrc = 0;
  if (Array.isArray(obj.management)) { for (const s of obj.management) { if (!s || !s.id || !s.file) continue; const bytes = getBin(s.file); if (!bytes) continue; try { await archiveImport(s, bytes); nSrc++; } catch (_) {} } }
  // ★커스텀 폰트(파일 바이트 회수 → 저장 후 등록).
  let nFont = 0;
  if (Array.isArray(obj.fonts)) { for (const ft of obj.fonts) { if (!ft || !ft.id || !ft.file) continue; const bytes = getBin(ft.file); if (!bytes) continue; try { await fontsAdd({ id: String(ft.id), family: String(ft.family || '내 폰트'), name: String(ft.name || ''), format: String(ft.format || ''), bytes, ts: +ft.ts || Date.now() }); nFont++; } catch (_) {} } }
  if (nFont) { try { await refreshFonts(); } catch (_) {} }
  // ★작품별 카드(연재 재드롭 방지) + 전역 last 카드 — 키 그대로 복원.
  if (Array.isArray(obj.cards)) { for (const c of obj.cards) { if (!c || !c.key || !c.file) continue; const bytes = getBin(c.file); if (!bytes) continue; try { await idbImportCard(String(c.key), { name: String(c.name || ''), bytes, ts: +c.ts || Date.now() }); } catch (_) {} } }
  // 외형(스킨·테마·도구폰트) 즉시 재적용 — 복원한 localStorage 값 기준.
  try { applySkin(localStorage.getItem(SKIN_KEY) || 'atelier'); } catch (_) {}
  try { applyShellTheme(localStorage.getItem(SHELL_THEME_KEY) || 'system'); } catch (_) {}
  try { applyUiFont(); } catch (_) {}
  const oldV2 = !obj.autosave && obj.designs;
  setStatus(`백업 복원 완료 (로그 ${Array.isArray(obj.logs) ? obj.logs.length : 0}·작품 ${Array.isArray(obj.meta) ? obj.meta.length : 0}·관리실 ${nSrc}·폰트 ${nFont})` + (oldV2 ? ' · 옛 백업이라 편집기 작업중 디자인은 생략(프리셋·서재는 복원)' : ''));
  if (refresh) refresh();
}

// (Pro1 가져오기 = 편집기 기본카드 02설정으로 이전 — buildPro1Panel. 분류/적용·자동스캔은 코어/데스크탑 공유.)

// ── 고급 설정 + 내 폰트 ────────────────────────────────────────────
function injectAdvanced(setStatus: (m: string) => void, getUser: () => any, getAuthMod: () => any, refresh?: () => void) {
  const pop = document.querySelector('.settings-menu .menu-pop'); if (!pop) return;
  pop.appendChild(Object.assign(document.createElement('div'), { className: 'menu-sep' }));
  const adv = document.createElement('button'); adv.id = 'btn-advanced'; adv.textContent = '고급 설정'; adv.title = '진단·정리·초기화 등 고급/위험 기능';
  adv.onclick = () => openAdvancedSettings(setStatus, getUser, getAuthMod, refresh);
  pop.appendChild(adv);   // (내 폰트는 "디자인 설정" 모달로 흡수)
}

// ── 리스 연결(연결 키 발급/표시/복사/재발급/해제) — 로그인 필요. 받기(드레인)는 library init이 함. ──
function injectRisuConnect(getUser: () => any) {
  const pop = document.querySelector('.settings-menu .menu-pop'); if (!pop) return;
  if (pop.querySelector('#btn-risu-connect')) return;
  const b = document.createElement('button'); b.id = 'btn-risu-connect'; b.textContent = '리스 연결';
  b.title = '리스에서 보던 챗을 버튼 하나로 이 서재에 받기(번역본째)';
  b.onclick = () => openRisuConnect(getUser);
  const adv = pop.querySelector('#btn-advanced');
  if (adv) pop.insertBefore(b, adv); else pop.appendChild(b);
}
async function openRisuConnect(getUser: () => any) {
  const ov = document.createElement('div'); ov.className = 'import-modal';
  const card = document.createElement('div'); card.className = 'import-card adv-card';
  const close = () => ov.remove();
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-title', textContent: '리스 연결' }));
  // 플러그인 받기 + 설치 안내 — ★로그인 무관(파일 다운로드일 뿐). 로그아웃 상태에서도 미리 받아 설치 가능.
  const appendPluginDownload = () => {
    card.appendChild(Object.assign(document.createElement('div'), { className: 'menu-label', textContent: '리스 플러그인 설치' }));
    card.appendChild(Object.assign(document.createElement('div'), { className: 'adv-desc', textContent: '① 아래 “플러그인 받기”로 파일 저장 → ② 리스 설정 → 플러그인에서 이 파일을 추가·활성화 → ③ 챗 화면에 생기는 “로그파파로 보내기” 버튼에 연결 키를 붙여넣고 “이 세션 보내기”. 그러면 이 서재에 번역본으로 들어와요.' }));
    const dlRow = document.createElement('div'); dlRow.className = 'import-btns'; dlRow.style.justifyContent = 'flex-start';
    const dlB = Object.assign(document.createElement('button'), { textContent: '플러그인 받기 (.js)' }) as HTMLButtonElement;
    dlB.onclick = () => { try { const a = document.createElement('a'); a.href = new URL('risu-plugin/logpapa-push.js', location.href).href; a.download = 'logpapa-push.js'; document.body.appendChild(a); a.click(); a.remove(); flash(dlB, '받는 중…'); } catch (_) {} };
    dlRow.appendChild(dlB); card.appendChild(dlRow);
  };
  const user = getUser();
  if (!user) {
    // ★로그아웃이어도 플러그인은 받을 수 있게 — 연결 키만 로그인 후 이 창에서 발급/복사하면 됨.
    card.appendChild(Object.assign(document.createElement('div'), { className: 'import-info', textContent: '플러그인은 지금 바로 받아 리스에 설치해둘 수 있어요. “연결 키”만 로그인 후 이 창에서 복사하면 됩니다(위쪽 “로그인”). 키 없이도 설치까지 미리 끝내두세요.' }));
    appendPluginDownload();
    const b = Object.assign(document.createElement('button'), { textContent: '닫기' }); b.onclick = close;
    const btns = document.createElement('div'); btns.className = 'import-btns'; btns.append(b); card.appendChild(btns);
    ov.appendChild(card); document.body.appendChild(ov); ov.addEventListener('click', (e) => { if (e.target === ov) close(); }); return;
  }
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-info', textContent: '리스 “로그파파로 보내기” 플러그인에 아래 연결 키를 한 번 붙여넣으세요. 그러면 리스에서 보던 챗을 버튼 하나로 이 서재에 넣을 수 있어요(번역본째, 파일 없이).' }));
  const keyWrap = document.createElement('label'); keyWrap.className = 'import-row';
  keyWrap.appendChild(Object.assign(document.createElement('span'), { textContent: '연결 키' }));
  const keyRow = document.createElement('div'); keyRow.className = 'share-link-row';
  const keyIn = document.createElement('input'); keyIn.className = 'share-link'; keyIn.readOnly = true; keyIn.value = '불러오는 중…';
  const copyB = Object.assign(document.createElement('button'), { className: 'primary', textContent: '복사' }) as HTMLButtonElement;
  keyRow.append(keyIn, copyB); keyWrap.appendChild(keyRow); card.appendChild(keyWrap);
  card.appendChild(Object.assign(document.createElement('div'), { className: 'adv-desc', textContent: '이 키는 비밀번호가 아닙니다 — 챗을 “넣기”만 가능하고 다른 데이터엔 접근 못 해요. 새어 나간 것 같으면 “키 재발급”으로 무효화하세요.' }));
  appendPluginDownload();   // 플러그인 받기 + 설치 안내(로그인/로그아웃 공용)
  const actions = document.createElement('div'); actions.className = 'import-btns';
  const rotateB = Object.assign(document.createElement('button'), { textContent: '키 재발급' }) as HTMLButtonElement;
  const offB = Object.assign(document.createElement('button'), { className: 'series-del', textContent: '연결 해제' }) as HTMLButtonElement;
  const closeB = Object.assign(document.createElement('button'), { textContent: '닫기' }); closeB.onclick = close;
  actions.append(rotateB, offB, closeB); card.appendChild(actions);
  ov.appendChild(card); document.body.appendChild(ov); ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

  const R = await import('./risuPush.js');
  const setKey = (sec: string) => { keyIn.value = sec ? R.connectKey(user.uid, sec) : '(연결 해제됨 — “키 재발급”으로 다시 연결)'; };
  try { setKey(await R.ensureSecret(user.uid)); } catch (_) { keyIn.value = '키 발급 실패 — 잠시 후 다시 시도'; }
  copyB.onclick = async () => { try { await navigator.clipboard.writeText(keyIn.value); flash(copyB, '복사됨!'); } catch (_) { try { keyIn.select(); } catch (__) {} } };
  rotateB.onclick = async () => {
    if (!(await confirmModal('연결 키를 재발급할까요?\n기존에 붙여넣은 키는 무효가 되고, 새 키를 리스 플러그인에 다시 붙여넣어야 합니다.', { okText: '재발급' }))) return;
    try { setKey(await R.rotateSecret(user.uid)); flash(rotateB, '재발급됨'); } catch (_) {}
  };
  offB.onclick = async () => {
    if (!(await confirmModal('리스 연결을 해제할까요?\n리스에서 더는 이 서재로 보낼 수 없게 됩니다(키 삭제). 다시 연결하려면 “키 재발급”을 누르세요.', { okText: '연결 해제', danger: true }))) return;
    try { await R.clearSecret(user.uid); setKey(''); flash(offB, '해제됨'); } catch (_) {}
  };
}

// ── 디자인 설정 모달: 스킨(11종+커스텀) · 테마 · 내 폰트 · UI 디자인 커스텀 통합(흩어진 자리 → 한곳) ──
function injectDesign(setStatus: (m: string) => void) {
  const pop = document.querySelector('.settings-menu .menu-pop'); if (!pop) return;
  const b = document.createElement('button'); b.id = 'btn-design'; b.textContent = '디자인 설정'; b.title = '도구 화면 스킨·테마·폰트·UI 커스텀';
  b.onclick = () => openDesignSettings(setStatus);
  // 외형 라벨 바로 뒤(있으면)·없으면 맨 위에
  const label = Array.from(pop.querySelectorAll('.menu-label')).find((l) => /외형/.test(l.textContent || ''));
  if (label && label.nextSibling) pop.insertBefore(b, label.nextSibling); else pop.insertBefore(b, pop.firstChild);
}
function openDesignSettings(setStatus: (m: string) => void) {
  const ov = document.createElement('div'); ov.className = 'import-modal';
  const card = document.createElement('div'); card.className = 'import-card adv-card design-card';
  // 닫기 = 저장된 스킨 재적용 — "내 디자인" 미리보기(previewCustomDraft)가 저장 없이 페이지에 남아
  // "바뀐 줄 알았는데 편집기/재시작엔 안 먹는" 착각 방지. 저장했으면 SKIN_KEY가 그 값이라 그대로 유지.
  const close = () => { ov.remove(); applySkin(localStorage.getItem(SKIN_KEY) || 'atelier'); };
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-title', textContent: '디자인 설정' }));
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-info', textContent: '도구 화면(셸)의 스킨·테마·폰트·UI 커스텀 — 출력 카드와는 무관합니다.' }));
  // ① 스킨 + ② 테마
  card.appendChild(Object.assign(document.createElement('div'), { className: 'menu-label', textContent: '스킨 · 테마' }));
  const skinRow = document.createElement('div'); skinRow.className = 'menu-row';
  const sel = document.createElement('select'); sel.id = 'skin-select'; sel.className = 'skin-select';
  for (const [v, t] of SKIN_LIST_OPTS) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }
  refreshSkinOptions(); sel.value = localStorage.getItem(SKIN_KEY) || 'atelier';
  sel.addEventListener('change', () => { localStorage.setItem(SKIN_KEY, sel.value); applySkin(sel.value); });
  const themeBtn = document.createElement('button'); themeBtn.id = 'btn-theme'; themeBtn.title = '라이트/다크/시스템 전환';
  skinRow.append(sel, themeBtn); card.appendChild(skinRow);
  wireThemeToggle(themeBtn); applyShellTheme(getThemePref());   // 토글 배선 + 버튼 아이콘 페인트(중복 initTheme 회피)
  // ③ 내 폰트
  if (fontsSupported()) { card.appendChild(Object.assign(document.createElement('div'), { className: 'menu-label', textContent: '내 폰트' })); appendFontSection(card, setStatus); }
  // ④ UI 디자인 커스텀(내 디자인)
  card.appendChild(Object.assign(document.createElement('div'), { className: 'menu-label', textContent: '내 디자인 (UI 커스텀)' }));
  const host = document.createElement('div'); host.className = 'quick-theme preset-lib custom-skin'; card.appendChild(host); buildCustomSkin(host, setStatus);
  const btns = document.createElement('div'); btns.className = 'import-btns';
  const closeB = Object.assign(document.createElement('button'), { textContent: '닫기' }); closeB.onclick = close;
  btns.append(closeB); card.appendChild(btns);
  ov.appendChild(card); document.body.appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
}
// 11종 기본 스킨 옵션(커스텀은 refreshSkinOptions가 optgroup으로 추가)
const SKIN_LIST_OPTS: Array<[string, string]> = [
  ['atelier', 'Warm Atelier (기본)'], ['aurora', 'A · Aurora Glass'], ['brutal', 'B · Neo-Brutalism'], ['cyber', 'C · Cyber Neon'],
  ['dopa', 'D · Soft Dopamine'], ['glass', 'E · Liquid Glass'], ['aero', 'F · Frutiger Aero'], ['synth', 'G · Synthwave'],
  ['kawaii', 'H · Kawaii Sticker'], ['memphis', 'I · Memphis 80s'], ['luxe', 'J · Dark Luxe'], ['modern', 'M · Modern (legacy)'],
];
async function resetAllLocalData() {
  try { for (const k of Object.keys(localStorage)) if (k.indexOf('pro2') === 0) localStorage.removeItem(k); } catch (_) {}
  try { for (const k of Object.keys(sessionStorage)) if (k.indexOf('pro2') === 0) sessionStorage.removeItem(k); } catch (_) {}
  await new Promise<void>((res) => { try { const d = indexedDB.deleteDatabase('pro2'); d.onsuccess = d.onerror = (d as any).onblocked = () => res(); } catch (_) { res(); } });
  location.reload();
}
// 강확인 모달(파괴 기능): 지정 단어 입력해야 실행 + (옵션)비번칸.
function confirmDestructive(opts: { title: string; body: string; word: string; goText: string; needPassword?: boolean; onGo: (password?: string) => Promise<void> | void }) {
  const ov = document.createElement('div'); ov.className = 'import-modal';
  const card = document.createElement('div'); card.className = 'import-card';
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-title', textContent: opts.title }));
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-info', textContent: opts.body }));
  const warn = Object.assign(document.createElement('div'), { className: 'tr-web-warn' }); warn.innerHTML = `계속하려면 아래 칸에 <b>${esc(opts.word)}</b> 라고 입력하세요.`;
  card.appendChild(warn);
  const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'auth-input'; inp.placeholder = opts.word; card.appendChild(inp);
  let pw: HTMLInputElement | null = null;
  if (opts.needPassword) { pw = document.createElement('input'); pw.type = 'password'; pw.className = 'auth-input'; pw.placeholder = '비밀번호 재확인'; card.appendChild(pw); }
  const note = Object.assign(document.createElement('div'), { className: 'import-info' });
  const btns = document.createElement('div'); btns.className = 'import-btns';
  const go = Object.assign(document.createElement('button'), { className: 'primary series-del', textContent: opts.goText }) as HTMLButtonElement; go.disabled = true;
  const cancel = Object.assign(document.createElement('button'), { textContent: '취소' });
  const close = () => ov.remove(); cancel.onclick = close;
  inp.oninput = () => { go.disabled = inp.value.trim() !== opts.word; };
  go.onclick = async () => { go.disabled = true; const o = go.textContent; go.textContent = '처리 중…'; note.textContent = ''; try { await opts.onGo(pw ? pw.value : undefined); close(); } catch (e: any) { go.textContent = o; go.disabled = false; note.textContent = '실패: ' + ((e && e.message) || ''); } };
  btns.append(go, cancel); card.append(note, btns);
  ov.appendChild(card); document.body.appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  inp.focus();
}
function openAdvancedSettings(setStatus: (m: string) => void, getUser: () => any, getAuthMod: () => any, refresh?: () => void) {
  const ov = document.createElement('div'); ov.className = 'import-modal';
  const card = document.createElement('div'); card.className = 'import-card adv-card';
  const close = () => ov.remove();
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-title', textContent: '고급 설정' }));
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-info', textContent: '평소 잘 쓰지 않는 진단·정리·위험 기능입니다. 파괴적 작업은 단어를 직접 입력해야 실행됩니다.' }));
  const section = (t: string) => card.appendChild(Object.assign(document.createElement('div'), { className: 'menu-label', textContent: t }));
  const row = (btnText: string, desc: string, onClick: (b: HTMLButtonElement) => void, o?: { danger?: boolean; disabled?: boolean }) => {
    const r = document.createElement('div'); r.className = 'adv-row';
    const b = document.createElement('button'); b.textContent = btnText; if (o?.danger) b.classList.add('series-del'); b.disabled = !!o?.disabled;
    b.onclick = () => onClick(b);
    r.append(b, Object.assign(document.createElement('div'), { className: 'adv-desc', textContent: desc }));
    card.appendChild(r); return b;
  };
  section('앱 정보');
  const infoEl = Object.assign(document.createElement('div'), { className: 'adv-desc adv-info' }); card.appendChild(infoEl);
  (async () => { try { const d = (window as any).desktop; if (d && d.appInfo) { const i = await d.appInfo(); infoEl.textContent = `버전 ${i.appVersion} · 저장 위치: ${i.userDataPath}`; } else infoEl.textContent = '웹 앱 (브라우저 저장소에 보관)'; } catch (_) { infoEl.textContent = ''; } })();
  // 동기화 방식(자동/수동) — 웹·데스크탑 공통. 기본: 웹=자동, 데스크탑=수동(무회귀). 동기화 거동 게이트 isLocalFirst가 이 모드를 따른다.
  {
    const dt = isDesktop();
    const getMode = dt ? getDesktopSyncMode : getWebSyncMode;
    const setMode = dt ? setDesktopSyncMode : setWebSyncMode;
    section('동기화 방식' + (dt ? ' (데스크탑)' : ' (웹)'));
    const sr = document.createElement('div'); sr.className = 'adv-row';
    const sel = document.createElement('select');
    // 웹 자동 = 로컬-퍼스트 + 백그라운드 자동 일괄(즉시 UI, 잠시 후 한 번에 동기화). 데스크탑 자동 = 실시간 Firebase.
    [['auto', dt ? '자동 (실시간)' : '자동 (백그라운드 동기화)'], ['manual', '수동 (버튼식)']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
    sel.value = getMode();
    sel.onchange = async () => {
      const m = sel.value === 'manual' ? 'manual' : 'auto';
      if (m === getMode()) return;
      const autoMsg = dt
        ? '자동(실시간) 모드로 바꿀까요?\n변경이 자동으로 클라우드에 동기화됩니다(여러 기기 실시간 반영). 적용하려면 새로고침합니다.'
        : '자동(백그라운드) 모드로 바꿀까요?\n로컬에 먼저 저장해 UI는 즉시 반응하고, 잠시 후·창 전환 때 클라우드와 자동으로 한 번에 동기화합니다. 적용하려면 새로고침합니다.';
      const ok = await confirmModal(m === 'manual'
        ? '수동 모드로 바꿀까요?\n로컬에 먼저 저장하고, 클라우드와는 ‘동기화’ 버튼(불러오기/저장)을 누를 때만 주고받습니다. 적용하려면 새로고침합니다.'
        : autoMsg, { okText: '바꾸고 새로고침' });
      if (!ok) { sel.value = getMode(); return; }
      setMode(m); location.reload();
    };
    sr.append(sel, Object.assign(document.createElement('div'), { className: 'adv-desc', textContent: (dt ? '자동 = 변경 즉시 동기화·여러 기기 실시간 반영. ' : '자동 = 로컬에 먼저 저장(즉시·오프라인) 후 백그라운드로 자동 일괄 동기화. ') + '수동 = ‘동기화’ 버튼으로만 클라우드와 주고받기.' + (dt ? ' 데스크탑 기본은 수동.' : '') }));
    card.appendChild(sr);
    card.appendChild(Object.assign(document.createElement('div'), { className: 'adv-desc', textContent: '주의 — 수동 모드에선 ‘저장’을 누르기 전까지 클라우드에 안 올라갑니다.' + (dt ? '' : ' 브라우저 정리 시 유실될 수 있어요.') }));
  }
  section('정리');
  row('중복 로그 정리', '기기를 오가다 같은 화가 여러 벌 생긴 것을 청소합니다.', async (b) => {
    b.disabled = true; const o = b.textContent; b.textContent = '정리 중…';
    try { const n = await dedupeLogsInStore(); setStatus(n > 0 ? `중복된 화 ${n}개를 정리했습니다.` : '정리할 중복이 없습니다.'); if (refresh) refresh(); } catch (_) {}
    b.textContent = o; b.disabled = false;
  });
  row('비상 복구 (서재가 안 열릴 때)', '용량이 비정상적으로 큰 작품 때문에 서재가 메모리 부족으로 안 열릴 때, 작품별 용량을 보고 직접 골라 지웁니다. (자동 삭제 없음)', () => { close(); location.hash = '#/recover'; location.reload(); });
  section('위험 — 되돌릴 수 없음');
  row('서재 초기화 (이 기기)', '이 기기의 서재(로그·작품 정보)만 비웁니다. 편집기 설정·프리셋·드롭한 카드·폰트는 그대로. 클라우드는 안 건드립니다.', () => {
    close();
    confirmDestructive({ title: '서재 초기화 (이 기기)', body: '이 기기에 저장된 서재 로그·작품 정보·읽기기록만 비웁니다. ★편집기 설정·프리셋·드롭한 카드·내 폰트는 유지됩니다. 클라우드는 안 건드려요 — “동기화 → 불러오기”로 되살릴 수 있어요.', word: '서재', goText: '서재 비우기', onGo: async () => { await clearLibraryLocal(); setStatus('서재를 비웠습니다 (로그·작품 정보).'); if (refresh) refresh(); } });
  }, { danger: true });
  row('전체 초기화 (이 기기)', '이 기기의 로컬 데이터(서재·설정·프리셋·읽기기록)를 모두 지웁니다. 클라우드·로그인은 유지돼요.', () => {
    close();
    confirmDestructive({ title: '전체 초기화 (이 기기)', body: '이 기기에 저장된 서재·드롭한 카드·편집기 설정·프리셋·읽기기록을 모두 지웁니다. ★클라우드와 로그인은 유지됩니다 — “동기화 → 불러오기”로 되살릴 수 있어요.', word: '초기화', goText: '전체 초기화', onGo: resetAllLocalData });
  }, { danger: true });
  // 클라우드 위험(로그인 시)
  const u = getUser(); const loggedIn = !!u;
  section('위험 — 클라우드 (로그인 계정)');
  row('내 클라우드 초기화', loggedIn ? '클라우드에 올린 내 데이터(서재·작품정보·설정·큰 이미지)를 모두 비웁니다. 계정과 로컬은 유지돼요.' : '로그인하면 사용할 수 있어요.', () => {
    close();
    confirmDestructive({ title: '내 클라우드 초기화', body: '클라우드(다른 기기와 공유되는 저장소)에 올린 내 데이터를 남김없이 비웁니다 — 분리 저장된 큰 이미지까지. ★계정·로컬은 유지돼요.', word: '초기화', goText: '클라우드 비우기', onGo: async () => {
      const cu = getUser(); if (!cu) throw new Error('로그인이 필요합니다.');
      const fb = await import('./firebaseBackend.js'); const n = await fb.wipeUserCloud(cu.uid);
      try { localStorage.removeItem('pro2-pending-logs-' + cu.uid); localStorage.removeItem('pro2-pull-ts-' + cu.uid); } catch (_) {}
      setStatus(`클라우드를 비웠습니다 (${n}개 삭제). 로컬·로그인은 유지됩니다.`); if (refresh) refresh();
    } });
  }, { danger: true, disabled: !loggedIn });
  row('계정 삭제 (탈퇴)', loggedIn ? '계정과 그 클라우드 데이터를 영구 삭제하고 로그아웃합니다. 이 기기의 로컬은 유지돼요.' : '로그인하면 사용할 수 있어요.', () => {
    close();
    confirmDestructive({ title: '계정 삭제 (탈퇴)', body: '계정 자체와 그 클라우드 데이터를 영구 삭제합니다(되돌릴 수 없음). 먼저 클라우드를 비운 뒤 계정을 지웁니다. ★이 기기 로컬은 유지. 완료되면 로그아웃.', word: '삭제', goText: '계정 삭제', needPassword: true, onGo: async (password) => {
      const cu = getUser(); const am = getAuthMod(); if (!cu || !am) throw new Error('로그인이 필요합니다.');
      const fb = await import('./firebaseBackend.js'); try { await fb.wipeUserCloud(cu.uid); } catch (_) {}
      try { localStorage.removeItem('pro2-pending-logs-' + cu.uid); } catch (_) {}
      try { await am.deleteAccount(); } catch (e: any) { if (am.needsReauth(e)) { if (!password) throw new Error('비밀번호를 다시 입력하세요(보안 재확인).'); await am.reauthenticate(password); await am.deleteAccount(); } else { throw e; } }
      setStatus('계정을 삭제했습니다. 로그아웃되었습니다.');
    } });
  }, { danger: true, disabled: !loggedIn });
  const btns = document.createElement('div'); btns.className = 'import-btns';
  const closeB = Object.assign(document.createElement('button'), { textContent: '닫기' }); closeB.onclick = close;
  btns.append(closeB); card.appendChild(btns);
  ov.appendChild(card); document.body.appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
}
// 폰트 섹션(추가·도구폰트 선택·목록)을 주어진 card에 append — 디자인 설정 모달이 사용.
function appendFontSection(card: HTMLElement, setStatus: (m: string) => void) {
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-info', textContent: '폰트 파일(.ttf · .otf · .woff · .woff2)을 추가하면 도구·미리보기·서재·리더 글꼴에서 골라 쓸 수 있어요. 이 컴퓨터에만 저장됩니다.' }));
  const addRow = document.createElement('div'); addRow.className = 'adv-row';
  const fin = document.createElement('input'); fin.type = 'file'; fin.accept = '.ttf,.otf,.woff,.woff2,font/*'; fin.multiple = true; fin.style.display = 'none';
  const addB = document.createElement('button'); addB.className = 'primary'; addB.textContent = '폰트 파일 추가';
  const addNote = Object.assign(document.createElement('div'), { className: 'adv-desc', textContent: '여러 개 한 번에 추가 가능' });
  addB.onclick = () => fin.click();
  fin.onchange = async () => { const files = Array.from(fin.files || []); fin.value = ''; if (!files.length) return; addB.disabled = true; addNote.textContent = '추가 중…'; const res = await addFontFiles(files); addNote.textContent = `추가됨 ${res.added}개` + (res.failed ? ` · 실패 ${res.failed}개` : ''); addB.disabled = false; renderList(); };
  addRow.append(addB, addNote); card.append(fin, addRow);
  const uiRow = document.createElement('label'); uiRow.className = 'import-row';
  uiRow.appendChild(Object.assign(document.createElement('span'), { textContent: '도구 화면 폰트' }));
  const uiSel = document.createElement('select'); uiRow.appendChild(uiSel); card.appendChild(uiRow);
  const fillUiSel = () => { const cur = getUiFont(); uiSel.innerHTML = ''; const o0 = document.createElement('option'); o0.value = ''; o0.textContent = '기본 (스킨 폰트)'; uiSel.appendChild(o0); for (const f of getFontList()) { const o = document.createElement('option'); o.value = f.family; o.textContent = f.family; uiSel.appendChild(o); } uiSel.value = getFontList().some((f) => f.family === cur) ? cur : ''; };
  uiSel.onchange = () => applyUiFont(uiSel.value);
  card.appendChild(Object.assign(document.createElement('div'), { className: 'menu-label', textContent: '추가된 폰트' }));
  const listEl = document.createElement('div'); listEl.className = 'font-list'; card.appendChild(listEl);
  const renderList = () => {
    fillUiSel(); listEl.innerHTML = '';
    const fonts = getFontList();
    if (!fonts.length) { listEl.appendChild(Object.assign(document.createElement('div'), { className: 'adv-desc', textContent: '아직 추가된 폰트가 없어요.' })); return; }
    for (const f of fonts) {
      const r = document.createElement('div'); r.className = 'font-row';
      const nm = document.createElement('span'); nm.className = 'font-name'; nm.textContent = f.family + ' — 다람쥐 헌 쳇바퀴 Aa1'; nm.style.fontFamily = `'${f.family.replace(/['"]/g, '')}'`;
      const del = document.createElement('button'); del.className = 'series-del'; del.textContent = '삭제';
      del.onclick = async () => { del.disabled = true; await removeFont(f.id); renderList(); setStatus(`폰트 "${f.family}"를 삭제했어요.`); };
      r.append(nm, del); listEl.appendChild(r);
    }
  };
  renderList();
}
