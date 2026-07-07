// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// 에셋추출기 preload — 최소 브릿지: 메인이 읽은 파일(연결 프로그램/두 번째 실행)을 렌더러에 전달.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('extractor', {
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_e, f) => { try { cb(f); } catch (_) {} }),
});
