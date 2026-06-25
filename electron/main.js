// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// electron/main.js — 로그 제조기 Pro 2 데스크탑 셸(메인 프로세스).
//
// 핵심 원칙(P0 백본):
//  1) 웹앱을 포크하지 않는다. esbuild가 만든 기존 web/ 번들을 "그대로" 로드한다.
//  2) ★스토리지 origin 고정 — 앱을 고정 커스텀 프로토콜 app://logpapa/ 에서 서빙한다.
//     file:// 이나 매번 바뀌는 경로로 로드하면 업데이트·재시작 때 origin이 흔들려
//     IndexedDB(pro2)·localStorage(pro2-*)·Firebase Auth 세션이 통째로 사라진다.
//     고정 origin = "안 썩는 영구 보관소" 정체성의 전제(데이터 유실 0).
//  3) 보안 기본값 — contextIsolation ON, nodeIntegration OFF, sandbox ON, 최소 preload.
//
// app:// 는 registerSchemesAsPrivileged로 standard(고정 origin)+secure(보안 컨텍스트)로
// 등록한다 → navigator.clipboard.write(리치 복사)·crypto.subtle·IndexedDB가 정상 동작.

const { app, BrowserWindow, protocol, net, session, shell, ipcMain, screen, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fss = require('node:fs');   // 동기(창 상태는 닫힐 때 동기 저장 — quit 전에 확실히 기록)
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const llm = require('./llm.js');   // 번역 LLM 어댑터(BYO-key, 로컬 저장) — 함수는 app ready 후에만 호출됨
const { autoUpdater } = require('electron-updater');   // 자동 업데이트(GitHub Releases) — 패키징본에서만 동작

// ── Content-Security-Policy (데스크탑 전용 — 커스텀 프로토콜 응답 헤더로 부여) ──────
// 출시-안전 수준으로 조이되 제품 핵심을 깨지 않게:
//  · script-src 'self' + 인라인 사전-페인트 스크립트는 ★sha256 해시로 허용(HTML 무수정, unsafe-inline/eval 금지).
//  · style-src 'unsafe-inline' — 아카 호환 인라인 스타일 카드가 제품 불변식(스크립트보다 위험 낮음) + 폰트 CSS 도메인.
//  · connect-src — Firebase(Auth/Firestore/Storage·로그인/수동동기화/공유)를 렌더러가 직접 호출하므로 googleapis 허용.
//  · 번역/굳히기 fetch는 메인 프로세스(net.fetch)라 렌더러 CSP와 무관 → connect-src에 LLM/이미지 호스트 불필요.
//  · img data:/https:(로그 임베드+외부) · frame-src 'self'(미리보기 srcdoc iframe).
const FONT_CSS = 'https://fonts.googleapis.com https://cdn.jsdelivr.net';
const FONT_FILES = 'https://fonts.gstatic.com https://cdn.jsdelivr.net';
// Firebase 도메인(누락 시 로그인/동기화/공유 무음 실패): Auth(identitytoolkit·securetoken)·Firestore·
//   Storage·installations = *.googleapis.com / 버킷 *.firebasestorage.app / authDomain *.firebaseapp.com / RTDB(미사용) *.firebaseio.com.
const FIREBASE = 'https://*.googleapis.com https://*.firebaseio.com https://*.firebasestorage.app https://*.firebaseapp.com';

// HTML 안 인라인(src 없는) <script> 내용의 sha256(base64) — CSP 화이트리스트용. HTML이 바뀌어도 자동 일치.
function inlineScriptHashes(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1].trim() === '') continue;
    out.push("'sha256-" + crypto.createHash('sha256').update(m[1], 'utf8').digest('base64') + "'");
  }
  return out;
}
function cspForHtml(html) {
  return [
    "default-src 'self'",
    ("script-src 'self' " + inlineScriptHashes(html).join(' ')).trim(),
    "style-src 'self' 'unsafe-inline' " + FONT_CSS,
    "font-src 'self' data: " + FONT_FILES,
    "img-src 'self' data: blob: https:",
    "connect-src 'self' " + FIREBASE,
    "frame-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}

// ── 고정 origin 좌표 ────────────────────────────────────────────────
// SCHEME://HOST 가 origin이 된다. 둘 다 상수 → 업데이트 후에도 영원히 동일 origin.
const SCHEME = 'app';
const HOST = 'logpapa';
const ORIGIN = `${SCHEME}://${HOST}`;
// 서빙 루트 = 리포의 web/ 폴더(빌드 산출물 web/dist 포함). 웹과 같은 파일을 소비한다.
const WEB_ROOT = path.join(__dirname, '..', 'web');

// 보안 컨텍스트·고정 origin·fetch/스트림 지원으로 스킴 등록(app.whenReady 이전 필수).
protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: {
    standard: true,        // app://logpapa 를 안정적 origin으로(IndexedDB/localStorage 스코프 고정)
    secure: true,          // https 급 보안 컨텍스트 → clipboard.write·subtle crypto 허용
    supportFetchAPI: true, // fetch()로 자기 자원 로드(번들 동적 import 등)
    stream: true,          // 큰 자원 스트리밍
    codeCache: true,
  },
}]);

// ── 커스텀 프로토콜 핸들러: app://logpapa/<경로> → web/<경로> 파일 ──
function registerAppProtocol() {
  protocol.handle(SCHEME, async (request) => {
    let rel;
    try { rel = decodeURIComponent(new URL(request.url).pathname); }
    catch (_) { return new Response('Bad Request', { status: 400 }); }
    if (!rel || rel === '/') rel = '/index.html';

    // 경로 이탈(../) 차단 — web/ 밖 파일 서빙 금지.
    const filePath = path.normalize(path.join(WEB_ROOT, rel));
    if (filePath !== WEB_ROOT && !filePath.startsWith(WEB_ROOT + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    // HTML 문서엔 CSP 헤더를 붙인다(인라인 스크립트 해시는 그 파일 내용으로 동적 계산 → 항상 일치).
    if (/\.html?$/i.test(filePath)) {
      try {
        const html = await fs.readFile(filePath, 'utf8');
        return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': cspForHtml(html) } });
      } catch (_) { return new Response('Not Found', { status: 404 }); }
    }
    // 그 외(JS/CSS/이미지/폰트): net.fetch(file://)이 확장자로 올바른 Content-Type을 붙여준다(ESM 포함).
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

// ── 권한 정책: 꼭 필요한 것만 허용(리치 복사), 나머지는 거부 ──────────
function lockDownPermissions() {
  const allow = new Set(['clipboard-sanitized-write', 'clipboard-read']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(allow.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allow.has(permission));
}

// ── 창 크기·위치·상태 기억(데스크탑) ────────────────────────────────
// 끈 그 모습 그대로 다시 켜지게. origin 고정 덕에 업데이트 후에도 보존되는 userData에 저장.
const DEFAULT_WIN = { width: 1320, height: 880 };
const winStatePath = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWinState() {
  try { const s = JSON.parse(fss.readFileSync(winStatePath(), 'utf8')); return (s && typeof s === 'object') ? s : null; }
  catch (_) { return null; }
}
function saveWinState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getNormalBounds();   // 최대화/전체화면 무시한 "일반 창" 경계 → 복원 해제 시 원래 크기로
    fss.writeFileSync(winStatePath(), JSON.stringify({
      x: b.x, y: b.y, width: b.width, height: b.height,
      maximized: win.isMaximized(), fullScreen: win.isFullScreen(),
    }));
  } catch (_) {}
}
let winSaveTimer = null;
function scheduleSaveWinState(win) { if (winSaveTimer) clearTimeout(winSaveTimer); winSaveTimer = setTimeout(() => saveWinState(win), 400); }
// 저장 좌표가 현재 보이는 디스플레이와 겹치나(모니터 제거/해상도 변경 시 창 실종 방지).
function boundsOnScreen(b) {
  try {
    return screen.getAllDisplays().some((d) => {
      const w = d.workArea;
      return b.x < w.x + w.width && b.x + b.width > w.x && b.y < w.y + w.height && b.y + b.height > w.y;
    });
  } catch (_) { return false; }
}

function createWindow() {
  const saved = loadWinState();
  const opts = {
    width: DEFAULT_WIN.width,
    height: DEFAULT_WIN.height,
    minWidth: 360,
    title: 'LogPapa',   // 창 생성 시부터 "LogPapa"로(내부 이름 log-maker-pro2가 잠깐 뜨던 깜빡임 제거)
    icon: path.join(__dirname, '..', 'web', 'icon-512.png'),  // 창/작업표시줄 아이콘 = LogPapa 불꽃(dev; 패키징본은 exe 임베드 아이콘)
    backgroundColor: '#1a1410', // index.html 테마색과 동일 → 로드 전 흰 깜빡임 방지
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // 렌더러와 preload 컨텍스트 격리
      nodeIntegration: false,   // 렌더러에 Node 노출 금지
      sandbox: true,            // 렌더러 샌드박스(preload는 contextBridge/ipcRenderer만)
      spellcheck: false,
    },
  };
  // 저장된 일반 창 크기 복원(없으면 기본). 위치는 화면 안일 때만(아니면 OS 기본 = 중앙).
  if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) {
    opts.width = Math.max(360, Math.round(saved.width));
    opts.height = Math.max(300, Math.round(saved.height));
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y) && boundsOnScreen({ x: saved.x, y: saved.y, width: opts.width, height: opts.height })) {
      opts.x = Math.round(saved.x); opts.y = Math.round(saved.y);
    }
  }
  const win = new BrowserWindow(opts);
  // 문서 제목(<title>)이 창 제목을 흔들지 않게 — 창 제목은 항상 "LogPapa" 고정.
  win.on('page-title-updated', (e) => { e.preventDefault(); });
  win.setTitle('LogPapa');

  // 최대화/전체화면 상태 복원(일반 크기는 위에서 이미 적용 → 해제 시 그 크기로 돌아감).
  if (saved && saved.fullScreen) win.setFullScreen(true);
  else if (saved && saved.maximized) win.maximize();

  // 상태 변화 저장: resize/move는 디바운스, 최대화/전체화면 토글·닫힘은 즉시.
  ['resize', 'move'].forEach((ev) => win.on(ev, () => scheduleSaveWinState(win)));
  ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'].forEach((ev) => win.on(ev, () => scheduleSaveWinState(win)));
  win.on('close', () => saveWinState(win));   // 닫히기 직전 확정 저장(동기)

  // 외부 링크(폰트/공유 등 새 창 요청)는 OS 기본 브라우저로 — 앱 안에 임의 페이지를 띄우지 않음.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // 앱 자체 origin 밖으로의 메인 프레임 네비게이션 차단(번들 안에서만 이동).
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN + '/')) e.preventDefault();
  });

  // ★렌더러 OOM 자동 복구 — 거대 챗을 옛 경로로 가져오다 무거운 화가 남으면 로딩 중 렌더러가 메모리부족으로 죽어(검은 화면)
  //   다시 켜도 또 죽는다. 메인 프로세스가 그 죽음을 감지해, 무거운 로딩을 건너뛰는 #/recover로 자동 재진입(커서로 무거운 화만 정리).
  //   #/recover는 getAll을 안 타 다시 죽지 않음 → 정리 후 서재로. 무한루프 방지로 2회 한도.
  let recoverTries = 0;
  win.webContents.on('render-process-gone', (_e, details) => {
    const reason = details && details.reason;
    if (recoverTries >= 2) return;
    if (reason === 'oom' || reason === 'crashed' || reason === 'launch-failed') {
      recoverTries++;
      try { win.loadURL(`${ORIGIN}/library.html#/recover`); } catch (_) {}
    }
  });

  // 기본 진입 = 서재 스튜디오 홈(library.html). 편집기(index.html)는 "빠른 제작"·"새 화 쓰기"로 연다.
  //   편집기 자가점검(PRO2_SMOKE=1)은 index.html?new=1로(파라미터 없으면 index가 서재로 리다이렉트하므로).
  const smokePage = process.env.PRO2_SMOKE_PAGE || (process.env.PRO2_SMOKE === '1' ? 'index.html?new=1' : 'library.html');
  win.loadURL(`${ORIGIN}/${smokePage}`);

  // 스모크 자가점검(PRO2_SMOKE=1일 때만). 화면 없이 origin 고정·번들 로드·어댑터 이음매를
  // 검사하고 결과 JSON을 찍은 뒤 종료한다(스크린샷 아님 — DOM/console 상태 읽기). CI 재사용.
  if (process.env.PRO2_SMOKE === '1') runSmokeTest(win);
  return win;
}

function runSmokeTest(win) {
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    // Electron이 개발 모드에서만 띄우는 자체 보안 경고(CSP 안내 등)는 앱 오류가 아님 → 제외.
    if (level >= 3 && !/Electron Security Warning/.test(message)) errors.push(message);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame === false) return;   // 서브프레임(미리보기 srcdoc 등)의 중단(-3)은 benign — 메인 문서 실패만 잡음
    console.log(JSON.stringify({ ok: false, stage: 'did-fail-load', code, desc, url }));
    app.exit(1);
  });
  win.webContents.once('did-finish-load', async () => {
    // 리더 페이지 점검(PRO2_SMOKE_PAGE=reader.html…): origin 고정 + #app + 콘솔 0(공유 리더는 로그인 없이 떠야 함).
    if ((process.env.PRO2_SMOKE_PAGE || '').indexOf('reader.html') === 0) {
      const rd = await win.webContents.executeJavaScript(`new Promise((res)=>{ setTimeout(()=>{ res({ hasApp: !!document.getElementById('app'), origin: location.origin, hash: location.hash }); }, 2000); })`);
      const ok = rd.origin === ORIGIN && rd.hasApp && errors.length === 0;
      console.log(JSON.stringify({ ok, page: 'reader', rd, consoleErrors: errors }, null, 2));
      app.exit(ok ? 0 : 1); return;
    }
    // 라이브러리 페이지 점검(PRO2_SMOKE_PAGE=library.html): 콘솔 에러 0 + 계정 마운트 + 공유 게이팅 로드.
    if (process.env.PRO2_SMOKE_PAGE === 'library.html') {
      const lib = await win.webContents.executeJavaScript(`new Promise((res)=>{ setTimeout(()=>{
        const btns = Array.from(document.querySelectorAll('#auth-group button')).map(b=>b.textContent);
        res({ hasApp: !!document.getElementById('app'), origin: location.origin, authBtns: btns, hasSync: btns.some(t=>/동기화/.test(t||'')) });
      }, 2500); })`);
      const ok = lib.origin === ORIGIN && lib.hasApp && errors.length === 0;
      console.log(JSON.stringify({ ok, page: 'library', lib, consoleErrors: errors }, null, 2));
      app.exit(ok ? 0 : 1); return;
    }
    try {
      const r = await win.webContents.executeJavaScript(`(${(() => ({
        origin: location.origin,
        secure: window.isSecureContext,
        hasDesktop: !!window.desktop,
        isDesktop: window.desktop && window.desktop.isDesktop,
        hasInput: !!document.getElementById('input'),
        hasPreview: !!document.getElementById('preview'),
        hasClipboardWrite: !!(navigator.clipboard && navigator.clipboard.write),
        hasIDB: typeof indexedDB !== 'undefined',
      })).toString()})()`);
      const info = await win.webContents.executeJavaScript('window.desktop.appInfo()');
      // 영속 증명: localStorage 마커를 읽어 보고(이전 실행 값) +1 저장. 두 번 실행하면 prev가 이어짐
      // = 프로세스 완전 종료 후 재실행에도 origin이 고정돼 데이터가 보존된다는 직접 증거.
      const persist = await win.webContents.executeJavaScript(`(function(){
        var k='pro2-smoke-persist'; var prev=Number(localStorage.getItem(k)||0);
        localStorage.setItem(k, String(prev+1)); return { prevRunValue: prev, nowSaved: prev+1 };
      })()`);
      console.log('PERSIST ' + JSON.stringify(persist));
      // CSP 하에서 미리보기 srcdoc(frame-src)·인라인 스크립트·폰트가 안 막히는지 — 입력 후 렌더 트리거.
      // CSP 위반은 콘솔 에러(level 3)라 errors에 쌓이고 최종 ok 판정에 반영된다.
      await win.webContents.executeJavaScript(`(function(){ var i=document.getElementById('input'); if(i){ i.value='그녀가 "안녕!" 하며 {{img::happy}} 손을 흔들었다.'; i.dispatchEvent(new Event('input',{bubbles:true})); } return true; })()`);
      await new Promise((r) => setTimeout(r, 600));   // 디바운스 렌더(120ms) + 폰트/iframe 로드 여유
      if (process.env.PRO2_SMOKE_CSP === '1') {
        const cspInfo = await win.webContents.executeJavaScript(`fetch(location.href).then(r=>({ csp:r.headers.get('content-security-policy'), theme:document.documentElement.getAttribute('data-theme') }))`);
        console.log('CSP ' + JSON.stringify(cspInfo));
      }
      if (process.env.PRO2_SMOKE_WIN === '1') {
        const b = win.getBounds();
        console.log('WIN ' + JSON.stringify({ width: b.width, height: b.height, x: b.x, y: b.y, maximized: win.isMaximized() }));
      }
      // 전체 초기화 규칙 점검(PRO2_SMOKE_RESET=1, ★격리 userData에서만 실행 — 실데이터 안전).
      // 콘텐츠(pro2 localStorage + pro2 IndexedDB)는 지우고, 인증 유사(firebase)는 보존됨을 확인.
      if (process.env.PRO2_SMOKE_RESET === '1') {
        const r = await win.webContents.executeJavaScript(`(async()=>{
          const openDb=(name)=>new Promise(res=>{ const o=indexedDB.open(name,1); o.onupgradeneeded=()=>{ const db=o.result; if(!db.objectStoreNames.contains('s')) db.createObjectStore('s'); }; o.onsuccess=()=>{ o.result.close(); res(); }; o.onerror=()=>res(); });
          localStorage.setItem('pro2-read','{}'); localStorage.setItem('pro2-preset-autosave','x'); localStorage.setItem('firebase:authUser:abc','tok');
          await openDb('pro2'); await openDb('firebaseLocalStorageDb');
          for(const k of Object.keys(localStorage)) if(k.indexOf('pro2')===0) localStorage.removeItem(k);
          for(const k of Object.keys(sessionStorage)) if(k.indexOf('pro2')===0) sessionStorage.removeItem(k);
          await new Promise(res=>{ const d=indexedDB.deleteDatabase('pro2'); d.onsuccess=d.onerror=d.onblocked=()=>res(); });
          const dbs = indexedDB.databases ? (await indexedDB.databases()).map(d=>d.name) : [];
          return { pro2KeysLeft: Object.keys(localStorage).filter(k=>k.indexOf('pro2')===0).length, pro2DbGone: dbs.indexOf('pro2')<0, authKeyKept: localStorage.getItem('firebase:authUser:abc')==='tok', authDbKept: dbs.indexOf('firebaseLocalStorageDb')>=0 };
        })()`);
        console.log('RESET ' + JSON.stringify(r));
      }
      // 고급 설정 모달 비파괴 점검(PRO2_SMOKE_ADV=1): 모달 열어 행 렌더·로그인 게이팅만 읽음(위험 버튼 클릭 안 함).
      if (process.env.PRO2_SMOKE_ADV === '1') {
        const r = await win.webContents.executeJavaScript(`new Promise((res)=>{ setTimeout(()=>{
          var b=document.getElementById('btn-advanced'); if(b) b.click();
          var card=document.querySelector('.adv-card');
          var rows=Array.prototype.slice.call(card?card.querySelectorAll('.adv-row button'):[]).map(function(x){return {t:x.textContent, disabled:x.disabled};});
          var auth=Array.prototype.slice.call(document.querySelectorAll('#auth-group button')).map(function(x){return x.textContent;});
          res({ hasAdvBtn:!!b, authBtns:auth, rows:rows });
        }, 5500); })`);
        console.log('ADV ' + JSON.stringify(r));
      }
      // 페이지 넘김 핵심(multicol 가로 흐름) 동작 점검(PRO2_SMOKE_PAGER=1, 합성·비파괴).
      if (process.env.PRO2_SMOKE_PAGER === '1') {
        const r = await win.webContents.executeJavaScript(`(function(){
          var host=document.createElement('div'); host.style.cssText='position:fixed;left:-9999px;top:0;width:300px;height:200px;overflow:hidden';
          var d=document.createElement('div'); d.style.cssText='height:100%;column-width:300px;column-gap:40px;column-fill:auto';
          var ps=''; for(var i=0;i<80;i++) ps+='<p style="break-inside:avoid">줄 '+i+' 가나다라마바사아자차카타파하 abcdefghij</p>';
          d.innerHTML=ps; host.appendChild(d); document.body.appendChild(host);
          var w=d.clientWidth, step=w+40, total=Math.round((d.scrollWidth+40)/step);
          var out={ colWidth:w, scrollWidth:d.scrollWidth, pages:total, multiPage: total>1 };
          // 2면(두 페이지) 레이아웃: stage 600px에 column-width 280(=2*280+40) → 한 화면에 2컬럼 보이는지
          var st=document.createElement('div'); st.style.cssText='position:fixed;left:-9999px;top:0;width:600px;height:200px;overflow:hidden';
          var d2=document.createElement('div'); d2.style.cssText='height:100%;column-width:280px;column-gap:40px;column-fill:auto'; d2.innerHTML=ps;
          st.appendChild(d2); document.body.appendChild(st);
          var colW2=280, colStep2=320, totalCols2=Math.round((d2.scrollWidth+40)/colStep2), screens2=Math.ceil(totalCols2/2);
          out.twoCol={ totalCols:totalCols2, screens:screens2, twoVisible: d2.scrollWidth>=560 };
          st.remove(); host.remove(); return out;
        })()`);
        console.log('PAGER ' + JSON.stringify(r));
      }
      // 커스텀 폰트(PRO2_SMOKE_FONT=1): 내 폰트 모달·UI 선택·IndexedDB v4(fonts 저장소) 비파괴 점검.
      if (process.env.PRO2_SMOKE_FONT === '1') {
        const r = await win.webContents.executeJavaScript(`new Promise((res)=>{ setTimeout(function(){
          var b=document.getElementById('btn-fonts'); var ui={ hasFontsBtn:!!b };
          if(b){ b.click(); ui.hasAdd=!!Array.prototype.slice.call(document.querySelectorAll('.import-card .adv-row button')).find(function(x){return /폰트 파일 추가/.test(x.textContent||'');}); ui.hasUiSel=!!document.querySelector('.import-card select'); var ov=document.querySelector('.import-modal'); if(ov) ov.remove(); }
          res(ui);   // db v4/fonts저장소는 격리 userData 스모크에서 검증(실 userData는 누적 강제종료로 IDB가 일시 잠김 — 환경 노이즈)
        }, 1500); })`);
        console.log('FONT ' + JSON.stringify(r));
      }
      // 서재 초기화 로직(PRO2_SMOKE_LIBRESET=1, 격리 userData): 로그/작품메타만 비우고 설정(프리셋) 유지하는지.
      if (process.env.PRO2_SMOKE_LIBRESET === '1') {
        const r = await win.webContents.executeJavaScript(`new Promise((res)=>{
          var req=indexedDB.open('pro2',4);
          req.onerror=function(){ res({err:String(req.error&&req.error.name)}); };
          req.onsuccess=function(){ var db=req.result;
            var tx=db.transaction(['logs','meta'],'readwrite'); tx.objectStore('logs').put({id:'t1',char:'C',html:'x'}); tx.objectStore('meta').put({char:'C',cover:'y'});
            tx.oncomplete=function(){
              localStorage.setItem('pro2-preset-library','KEEP'); localStorage.setItem('pro2-read','R');   // 유지돼야 할 설정 + 지워야 할 읽기상태
              var tx2=db.transaction(['logs','meta'],'readwrite'); tx2.objectStore('logs').clear(); tx2.objectStore('meta').clear();   // = clearLibraryLocal
              tx2.oncomplete=function(){ localStorage.removeItem('pro2-read');
                var lc=db.transaction('logs').objectStore('logs').count(); lc.onsuccess=function(){
                  var mc=db.transaction('meta').objectStore('meta').count(); mc.onsuccess=function(){ db.close();
                    res({ logs:lc.result, meta:mc.result, presetKept:localStorage.getItem('pro2-preset-library'), readCleared:localStorage.getItem('pro2-read')===null });
                  };};
              };
            };
          };
        })`);
        console.log('LIBRESET ' + JSON.stringify(r));
      }
      // 페이지 넘김 반응형 결정 로직(PRO2_SMOKE_WNPAGE=1): 1024px 경계로 페이지↔스크롤·두↔한 페이지가 갈리는지(코드와 동일 판정).
      if (process.env.PRO2_SMOKE_WNPAGE === '1') {
        const r = await win.webContents.executeJavaScript(`(function(){
          var MIN=1024;
          function resolved(wnPaged,w){ return wnPaged===undefined ? (w>=MIN) : !!wnPaged; }   // 기본=화면크기, 사용자 선택 우선
          function cols(wnPageCols,w){ return (wnPageCols!==1 && w>=MIN) ? 2 : 1; }            // 두 페이지는 ≥1024만
          return {
            wide_default: resolved(undefined,1280),    // true(페이지)
            phone_default: resolved(undefined,800),    // false(스크롤)
            boundary_1024: resolved(undefined,1024),   // true(경계 포함)
            boundary_1023: resolved(undefined,1023),   // false
            user_page_on_phone: resolved(true,800),    // true(사용자 선택 우선)
            user_scroll_on_wide: resolved(false,1280), // false(사용자 선택 우선)
            cols_wide: cols(undefined,1280),           // 2
            cols_narrow: cols(undefined,800),          // 1(자동 한 페이지)
            cols_user_one_wide: cols(1,1280)           // 1(사용자 한 페이지 설정)
          };
        })()`);
        console.log('WNPAGE ' + JSON.stringify(r));
      }
      // PNG export 파이프라인(PRO2_SMOKE_PNG=1): SVG foreignObject→canvas→toBlob이 PNG를 만드는지(합성).
      if (process.env.PRO2_SMOKE_PNG === '1') {
        const r = await win.webContents.executeJavaScript(`new Promise(function(res){
          var wrap=document.createElement('div'); wrap.style.cssText='display:inline-block;padding:20px;background:#eee;';
          wrap.innerHTML='<div style="width:300px;background:#fff;padding:16px;border-radius:8px;">안녕하세요 카드 <b>테스트</b></div>';
          document.body.appendChild(wrap); var w=wrap.offsetWidth, h=wrap.offsetHeight;
          var xhtml=new XMLSerializer().serializeToString(wrap); wrap.remove();
          var svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><foreignObject x="0" y="0" width="'+w+'" height="'+h+'">'+xhtml+'</foreignObject></svg>';
          var img=new Image();
          img.onload=function(){ var c=document.createElement('canvas'); c.width=w*2; c.height=h*2; var ctx=c.getContext('2d'); ctx.scale(2,2); ctx.drawImage(img,0,0); c.toBlob(function(bl){ res({ ok:!!bl, type:bl&&bl.type, bytes:bl&&bl.size, w:w, h:h }); }, 'image/png'); };
          img.onerror=function(){ res({ ok:false, err:'render' }); };
          img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
        })`);
        console.log('PNG ' + JSON.stringify(r));
      }
      // Pro1 자동 임포트(PRO2_SMOKE_PRO1=1): pro1Scan IPC가 폴더를 찾고 JSON을 읽어오는지(없으면 found:false 우아하게).
      if (process.env.PRO2_SMOKE_PRO1 === '1') {
        const r = await win.webContents.executeJavaScript(`window.desktop.pro1Scan().then(function(x){ return { found:x.found, dir:x.dir, fileCount:(x.files||[]).length, firstName:(x.files&&x.files[0]&&x.files[0].name)||null }; })`);
        console.log('PRO1 ' + JSON.stringify(r));
      }
      // 굳히기 dedup(PRO2_SMOKE_DEDUP=1, 격리 userData): 코드와 동일 로직으로 왕복 무결성 + 중복 1벌 + 작은건 인라인.
      if (process.env.PRO2_SMOKE_DEDUP === '1') {
        const r = await win.webContents.executeJavaScript(`(async function(){ try {
          var BLOB_MIN=6*1024;
          var DATA=/data:image\\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g, REF=/lpblob:([0-9a-f]{64})/g;
          function b64u(b64){ var bin=atob(b64), u=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i); return u; }
          async function sha(bytes){ var buf=await crypto.subtle.digest('SHA-256',bytes); var v=new Uint8Array(buf),s=''; for(var i=0;i<v.length;i++)s+=v[i].toString(16).padStart(2,'0'); return s; }
          async function dehy(html){ var blobs=[],repl=[],seen={},m; DATA.lastIndex=0; var jobs=[];
            while((m=DATA.exec(html))!==null){ var full=m[0],mime=m[1],b64=m[2]; if(b64.length*0.75<BLOB_MIN) continue; if(seen[full]) continue; seen[full]=1; (function(full,mime,b64){ jobs.push(sha(b64u(b64)).then(function(h){ blobs.push({h:h,mime:mime,b64:b64}); repl.push({full:full,ref:'lpblob:'+h}); })); })(full,mime,b64); }
            await Promise.all(jobs); var out=html; for(var i=0;i<repl.length;i++) out=out.split(repl[i].full).join(repl[i].ref); return {html:out,blobs:blobs}; }
          function hyd(html,map){ return html.replace(REF,function(full,h){ var b=map[h]; return b?('data:image/'+b.mime+';base64,'+b.b64):full; }); }
          var bigImg='data:image/png;base64,'+'A'.repeat(12000);
          var smallImg='data:image/png;base64,'+'B'.repeat(100);
          var html1='<img src="'+bigImg+'"> 본문 <img src="'+smallImg+'">';
          var html2='<div><img src="'+bigImg+'"></div>';
          var db=await new Promise(function(res,rej){ var q=indexedDB.open('pro2',5); q.onsuccess=function(){res(q.result);}; q.onerror=function(){rej(q.error);}; });
          async function store(id,html){ var d=await dehy(html); await new Promise(function(res){ var tx=db.transaction(['logs','blobs'],'readwrite'); tx.objectStore('logs').put({id:id,html:d.html}); for(var i=0;i<d.blobs.length;i++) tx.objectStore('blobs').put(d.blobs[i]); tx.oncomplete=res; }); return d; }
          var d1=await store('l1',html1); var d2=await store('l2',html2);
          // 읽기+hydrate
          var logs=await new Promise(function(res){ var g=db.transaction('logs').objectStore('logs').getAll(); g.onsuccess=function(){res(g.result);}; });
          var allBlobs=await new Promise(function(res){ var g=db.transaction('blobs').objectStore('blobs').getAll(); g.onsuccess=function(){res(g.result);}; });
          var map={}; for(var i=0;i<allBlobs.length;i++) map[allBlobs[i].h]=allBlobs[i];
          var byId={}; for(var i=0;i<logs.length;i++) byId[logs[i].id]=logs[i];
          var r1=hyd(byId.l1.html,map), r2=hyd(byId.l2.html,map);
          db.close();
          return { roundtrip1: r1===html1, roundtrip2: r2===html2, blobCount: allBlobs.length, bigDehydrated: byId.l1.html.indexOf('lpblob:')>=0, smallInline: byId.l1.html.indexOf(smallImg)>=0 };
        } catch(e){ return { err: String((e&&e.message)||e) }; } })()`);
        console.log('DEDUP ' + JSON.stringify(r));
      }
      // 네트워크 어댑터 라이브 점검(PRO2_SMOKE_FETCH=<이미지URL>일 때만): 실제 fetch→data URL 확인.
      if (process.env.PRO2_SMOKE_FETCH) {
        const fr = await win.webContents.executeJavaScript(
          `window.desktop.fetchImage(${JSON.stringify(process.env.PRO2_SMOKE_FETCH)}).then(r=>({ok:r.ok,error:r.error,mime:r.mime,bytes:r.bytes,head:String(r.dataUrl||'').slice(0,24)}))`);
        console.log('FETCH ' + JSON.stringify(fr));
      }
      // 번역 어댑터 점검(PRO2_SMOKE_LLM=1): 브리지 존재 + 키 암호화 저장(누출 없음) + no-key 에러 경로(네트워크 없이).
      if (process.env.PRO2_SMOKE_LLM === '1') {
        const lr = await win.webContents.executeJavaScript(`(async()=>{
          const d=window.desktop;
          const has = typeof d.llmTranslate==='function' && typeof d.llmGetConfig==='function' && typeof d.llmSetConfig==='function';
          await d.llmClearConfig();
          // 커스텀 provider + 키 + 생성 파라미터 저장 round-trip
          const saved = await d.llmSetConfig({provider:'custom', model:'my-model', baseUrl:'https://my/v1', apiKey:'sk-secret-xyz', params:{temperature:0.9, top_p:0.8, max_tokens:1234, top_k:40}});
          const after = await d.llmGetConfig();
          const leaksKey = JSON.stringify(after).indexOf('sk-secret')>=0;
          const params = after.params || {};
          await d.llmClearConfig();
          await d.llmSetConfig({provider:'openai', model:'gpt-x'});   // 키 없음 → 에러 경로
          const tr = await d.llmTranslate({text:'hello'});
          await d.llmClearConfig();
          return { has, savedProvider:saved.provider, afterHasKey:after.hasKey, afterModel:after.model, leaksKey, paramTemp:params.temperature, paramMaxTok:params.max_tokens, paramTopK:params.top_k, noKeyError:(tr&&tr.error)||'' };
        })()`);
        console.log('LLM ' + JSON.stringify(lr));
      }
      // 데스크탑 수동 동기화 UI 점검(PRO2_SMOKE_SYNC=1): 계정 비동기 마운트 후 "☁ 동기화" 버튼 존재 확인.
      if (process.env.PRO2_SMOKE_SYNC === '1') {
        const sr = await win.webContents.executeJavaScript(`new Promise((res)=>{ setTimeout(()=>{
          const btns = Array.from(document.querySelectorAll('#auth-group button')).map(b=>b.textContent);
          res({ authBtns: btns, hasSync: btns.some(t=>/동기화/.test(t||'')) });
        }, 2500); })`);
        console.log('SYNC ' + JSON.stringify(sr));
      }
      const cond = {
        origin: r.origin === ORIGIN, secure: !!r.secure, hasDesktop: !!r.hasDesktop,
        hasInput: !!r.hasInput, hasPreview: !!r.hasPreview, hasClipboardWrite: !!r.hasClipboardWrite,
        hasIDB: !!r.hasIDB, noErrors: errors.length === 0,
      };
      const ok = Object.values(cond).every(Boolean);
      console.log(JSON.stringify({ ok, cond, checks: r, appInfo: info, consoleErrors: errors }, null, 2));
      app.exit(ok ? 0 : 1);
    } catch (e) {
      console.log(JSON.stringify({ ok: false, stage: 'eval', error: String(e) }));
      app.exit(1);
    }
  });
}

// ── 메인 프로세스 기능 핸들러(어댑터 통로의 끝단) ──────────────────
// P0: 영속 데이터가 사는 위치와 앱 버전만. 후속 단계에서 fs/네트워크/업데이트가 여기 추가됨.
function registerIpc() {
  ipcMain.handle('desktop:appInfo', () => ({
    appVersion: app.getVersion(),
    userDataPath: app.getPath('userData'), // IndexedDB/localStorage(app://logpapa)가 사는 곳
    origin: ORIGIN,
  }));

  // ── Pro1 자동 임포트: 옛 Pro1 설정 폴더를 찾아 안의 JSON들을 읽어 돌려준다(분류·적용은 렌더러의 기존 Pro1 임포터). ──
  ipcMain.handle('desktop:pro1Scan', async () => {
    const roaming = app.getPath('appData');   // %APPDATA%\Roaming
    const home = app.getPath('home');
    const candidates = [
      path.join(roaming, 'LogGenerator Pro'), path.join(roaming, 'LogGenerator_Pro'),
      path.join(roaming, 'log-generator-pro'), path.join(roaming, 'LogGenerator'),
      path.join(home, 'LogGenerator Pro'), path.join(home, 'Documents', 'LogGenerator Pro'),
    ];
    for (const dir of candidates) {
      try {
        if (!(await fs.stat(dir)).isDirectory()) continue;
        const names = await fs.readdir(dir);
        const files = [];
        for (const name of names) {
          if (!/\.json$/i.test(name)) continue;
          try { const full = path.join(dir, name); const st = await fs.stat(full); if (st.isFile() && st.size <= 8 * 1024 * 1024) files.push({ name, text: await fs.readFile(full, 'utf8') }); } catch (_) {}
        }
        if (files.length) return { found: true, dir, files };
      } catch (_) {}
    }
    return { found: false, dir: candidates[0] };
  });

  // ── 네트워크 fetch 어댑터(이미지 굳히기용) ──────────────────────────
  // 데스크탑 메인 프로세스에서 외부 이미지를 받아온다(CORS·쿼터 무관 — 웹이 못 하는 영역).
  // 보관용이라 ★재인코딩·축소 없이 원본 바이트 그대로 data URL로 돌려준다(원본 화질).
  // 죽은 링크가 앱을 멈추지 않게 타임아웃, 폭주 방지로 크기 상한.
  ipcMain.handle('desktop:fetchImage', async (_e, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false, error: '이미지 URL이 아님' };
    const MAX = 64 * 1024 * 1024;  // 단일 이미지 64MB 상한(보관 자체는 무제한, 한 장 폭주만 차단)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);  // 20초 타임아웃
    try {
      const res = await net.fetch(url, { signal: ctrl.signal, redirect: 'follow' });
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
      const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (ct && !ct.startsWith('image/')) return { ok: false, error: '이미지가 아님(' + ct + ')' };
      const cl = Number(res.headers.get('content-length') || 0);
      if (cl && cl > MAX) return { ok: false, error: '너무 큼(' + Math.round(cl / 1048576) + 'MB)' };
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX) return { ok: false, error: '너무 큼(' + Math.round(buf.length / 1048576) + 'MB)' };
      // content-type이 없으면 확장자로 보정(없으면 image/png 가정 — 거의 일어나지 않음).
      const mime = ct || mimeFromUrl(url);
      return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}`, bytes: buf.length, mime };
    } catch (e) {
      return { ok: false, error: ctrl.signal.aborted ? '시간 초과' : ((e && e.message) || '받기 실패') };
    } finally { clearTimeout(timer); }
  });

  // ── 번역 LLM 어댑터(데스크탑 전용, BYO-key) ─────────────────────────
  // 설정/키는 메인 프로세스에만(safeStorage 암호화, 동기화 안 함). renderer엔 키 없는 공개 설정만.
  ipcMain.handle('desktop:llmGetConfig', () => llm.publicConfig());
  ipcMain.handle('desktop:llmSetConfig', (_e, cfg) => llm.saveConfig(cfg || {}));
  ipcMain.handle('desktop:llmClearConfig', () => llm.clearConfig());
  ipcMain.handle('desktop:llmTranslate', async (_e, payload) => {
    try { return { ok: true, text: await llm.translate(payload || {}) }; }
    catch (e) { return { ok: false, error: (e && e.message) || '번역 실패' }; }
  });

  // 자동 업데이트: 사용자가 "지금 재시작" 눌렀을 때만 설치(조용한 강제설치 금지).
  ipcMain.handle('desktop:installUpdate', () => { try { autoUpdater.quitAndInstall(); } catch (_) {} });
}

// ── 자동 업데이트(electron-updater + GitHub Releases) ───────────────
// 패키징본에서만 동작(dev는 비활성). 백그라운드로 새 버전 다운로드 → 준비되면 렌더러에 알림 →
// 사용자가 배너의 "재시작" 누르면 설치. autoInstallOnAppQuit=false라 모르게 설치 안 됨.
function setupAutoUpdate(win) {
  if (!app.isPackaged) return;
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    const send = (status, extra) => { try { if (win && !win.isDestroyed()) win.webContents.send('desktop:update', Object.assign({ status }, extra || {})); } catch (_) {} };
    autoUpdater.on('update-available', (info) => send('available', { version: info && info.version }));
    autoUpdater.on('download-progress', (p) => send('progress', { percent: Math.round((p && p.percent) || 0) }));
    autoUpdater.on('update-downloaded', (info) => send('downloaded', { version: info && info.version }));
    autoUpdater.on('error', (e) => send('error', { error: String((e && e.message) || e) }));
    autoUpdater.checkForUpdates().catch(() => {});
  } catch (_) {}
}

// URL 확장자 → MIME(content-type 헤더가 없을 때만 보조).
function mimeFromUrl(url) {
  const m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url || '');
  const ext = (m ? m[1] : '').toLowerCase();
  const t = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml' }[ext];
  return t || 'image/png';
}

// ── 앱 메뉴(자동 숨김 — Alt로 표시) — 표준 편집 역할 + 도구(비상 복구·새로고침). ──
//   비상 복구 = library.html#/recover 로드(무거운 로딩 없이 커서로 큰 화만 정리). 검은 화면이어도 Alt→도구로 접근.
function buildAppMenu(getWin) {
  const tools = {
    label: '도구',
    submenu: [
      { label: '비상 복구 (용량 큰 화 정리)', click: () => { const w = getWin(); if (w && !w.isDestroyed()) w.loadURL(`${ORIGIN}/library.html#/recover`); } },
      { type: 'separator' },
      { label: '서재로', click: () => { const w = getWin(); if (w && !w.isDestroyed()) w.loadURL(`${ORIGIN}/library.html`); } },
      { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
    ],
  };
  const edit = { label: '편집', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] };
  Menu.setApplicationMenu(Menu.buildFromTemplate([edit, tools]));
}

app.whenReady().then(() => {
  registerAppProtocol();
  lockDownPermissions();
  registerIpc();
  const win = createWindow();
  buildAppMenu(() => win);   // Alt→도구→비상 복구 (검은 화면 수동 탈출구) + render-process-gone 자동 복구가 1차
  setupAutoUpdate(win);   // 패키징본이면 백그라운드 업데이트 확인

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
