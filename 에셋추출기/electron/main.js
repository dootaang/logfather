// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — 에셋추출기(Asset Extractor). Licensed under GNU GPL v3 (see LICENSE).
// 에셋추출기 — 독립 미니 일렉트론 셸.
//   창 하나 + 보안 기본값(contextIsolation ON, nodeIntegration OFF, sandbox ON).
//   "연결 프로그램으로 열기"/두 번째 실행의 파일 인자를 렌더러로 전달(open-file IPC).
//   저장은 렌더러 <a download>(일렉트론 기본 저장 다이얼로그) — 메인엔 저장 코드 불필요.
'use strict';
const { app, BrowserWindow, Menu, ipcMain, dialog, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fss = require('node:fs');   // 드래그 아웃은 dragstart 안에서 동기 기록이 필요

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
      recentAdd({ path: p, name: path.basename(p), size: buf.length });
    } catch (e) { console.warn('[에셋추출기] 파일 열기 실패', p, e); }
  }
}

// ── 최근 파일(exe=경로만 기억, userData/recent.json) — 파일이 사라졌으면 열 때 목록에서 제거 ──
const RECENT_MAX = 10;
const recentFile = () => path.join(app.getPath('userData'), 'recent.json');
async function recentRead() { try { const l = JSON.parse(await fs.readFile(recentFile(), 'utf8')); return Array.isArray(l) ? l : []; } catch (_) { return []; } }
async function recentWrite(list) { try { await fs.writeFile(recentFile(), JSON.stringify(list.slice(0, RECENT_MAX))); } catch (_) {} }
async function recentAdd(entry) {
  if (!entry || !entry.path) return;
  const list = (await recentRead()).filter((e) => e && e.path !== entry.path);
  list.unshift({ path: entry.path, name: entry.name || path.basename(entry.path), size: entry.size || 0, at: Date.now() });
  await recentWrite(list);
}
ipcMain.handle('recent-list', () => recentRead());
ipcMain.handle('recent-add', (_e, entry) => recentAdd(entry));
ipcMain.handle('recent-remove', async (_e, p) => recentWrite((await recentRead()).filter((x) => x && x.path !== p)));
ipcMain.handle('recent-clear', () => recentWrite([]));
ipcMain.handle('recent-open', async (_e, p) => {
  try {
    const buf = await fs.readFile(p);
    await recentAdd({ path: p, name: path.basename(p), size: buf.length });
    return { name: path.basename(p), bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
  } catch (_) {
    await recentWrite((await recentRead()).filter((x) => x && x.path !== p));   // 이동/삭제된 파일 = 목록 정리
    return null;
  }
});

function createWindow() {
  win = new BrowserWindow({
    width: 1120, height: 780, minWidth: 720, minHeight: 480,
    backgroundColor: '#f9f1e0',   // index.html 테마색(크림)과 동일 → 로드 전 깜빡임 방지
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

// ── 추출 IPC ────────────────────────────────────────────────────────────────
const safeFileName = (s) => String(s || 'asset').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 150) || 'asset';

// 네이티브 드래그 아웃: 썸네일을 탐색기·디스코드로 바로 끌어다 놓기.
//   임시폴더에 파일을 쓰고 startDrag(로컬 파일만 지원) — 임시폴더는 종료 시 정리.
const dragDir = () => path.join(app.getPath('temp'), 'asset-extractor-drag');
ipcMain.on('drag-start', (e, f) => {
  try {
    if (!f || !f.name || !f.bytes) return;
    fss.mkdirSync(dragDir(), { recursive: true });
    const file = path.join(dragDir(), safeFileName(f.name));
    fss.writeFileSync(file, Buffer.from(f.bytes));
    const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'drag.png'));
    e.sender.startDrag({ file, icon });
  } catch (err) { console.warn('[에셋추출기] 드래그 아웃 실패', err); }
});
app.on('will-quit', () => { try { fss.rmSync(dragDir(), { recursive: true, force: true }); } catch (_) {} });

// 폴더로 추출: 폴더는 메인이 기억(렌더러에 임의 경로 쓰기 권한을 안 줌) → save-file은 그 폴더에만.
let extractDir = null;
ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { title: '에셋을 추출할 폴더 선택', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  extractDir = r.filePaths[0];
  return extractDir;
});
ipcMain.handle('save-file', async (_e, name, bytes) => {
  if (!extractDir) throw new Error('폴더를 먼저 선택하세요');
  const file = path.join(extractDir, safeFileName(name));
  await fs.writeFile(file, Buffer.from(bytes));
  return true;
});

app.on('second-instance', (_e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  sendFiles(fileArgs(argv));
});

app.whenReady().then(() => { Menu.setApplicationMenu(null); createWindow(); });
app.on('window-all-closed', () => app.quit());
