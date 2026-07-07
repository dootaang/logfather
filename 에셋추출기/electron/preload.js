// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — 에셋추출기(Asset Extractor). Licensed under GNU GPL v3 (see LICENSE).
// 에셋추출기 preload — 최소 브릿지: 메인이 읽은 파일(연결 프로그램/두 번째 실행)을 렌더러에 전달.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('extractor', {
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_e, f) => { try { cb(f); } catch (_) {} }),
  dragOut: (name, bytes) => ipcRenderer.send('drag-start', { name, bytes }),           // 썸네일 → 탐색기 드래그
  pickFolder: () => ipcRenderer.invoke('pick-folder'),                                  // 추출 폴더 선택(메인이 기억)
  saveFile: (name, bytes) => ipcRenderer.invoke('save-file', name, bytes),              // 선택된 폴더에 저장
});
