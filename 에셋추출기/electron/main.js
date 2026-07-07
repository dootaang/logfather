// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// 에셋추출기 — 독립 미니 일렉트론 셸.
//   창 하나 + 보안 기본값(contextIsolation ON, nodeIntegration OFF, sandbox ON).
//   "연결 프로그램으로 열기"/두 번째 실행의 파일 인자를 렌더러로 전달(open-file IPC).
//   저장은 렌더러 <a download>(일렉트론 기본 저장 다이얼로그) — 메인엔 저장 코드 불필요.
'use strict';
const { app, BrowserWindow, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

let win = null;

// 단일 인스턴스: 이미 떠 있으면 새 인스턴스는 즉시 종료, 파일 인자만 기존 창으로.
if (!app.requestSingleInstanceLock()) app.quit();

// argv에서 열 파일 경로만 추출(패키징=argv[1..], 개발 'electron .'의 '.'은 확장자 필터에 걸러짐).
const fileArgs = (argv) => argv.slice(1).filter((a) => a && !a.startsWith('-') && /\.(charx|png|json|jpeg|risum|risup)$/i.test(a));

async function sendFiles(paths) {
  if (!win || !paths.length) return;
  for (const p of paths) {
    try {
      const buf = await fs.readFile(p);
      win.webContents.send('open-file', { name: path.basename(p), bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) });
    } catch (e) { console.warn('[에셋추출기] 파일 열기 실패', p, e); }
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1120, height: 780, minWidth: 720, minHeight: 480,
    backgroundColor: '#14100c',   // index.html 테마색과 동일 → 로드 전 흰 깜빡임 방지
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.on('closed', () => { win = null; });
  win.loadFile(path.join(__dirname, '..', 'web', 'index.html'));
  win.webContents.on('did-finish-load', () => sendFiles(fileArgs(process.argv)));
}

app.on('second-instance', (_e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  sendFiles(fileArgs(argv));
});

app.whenReady().then(() => { Menu.setApplicationMenu(null); createWindow(); });
app.on('window-all-closed', () => app.quit());
