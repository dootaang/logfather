// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// electron/preload.js — 플랫폼 어댑터 이음매(P0 백본).
//
// 여기서 노출하는 window.desktop 이 앞으로의 데스크탑 전용 기능
// (이미지 굳히기=자유 fetch/저장, 번역=BYO-key LLM, 로컬 보관소=fs)이
// 끼어드는 "단 하나의 통로"다. 웹 코드는 이 객체를 참조하지 않으므로(=웹 무변경),
// 웹 빌드는 그대로 동작하고, 데스크탑에서만 window.desktop 유무로 분기하게 된다.
//
// 보안: sandbox=true + contextIsolation=true 환경. Node를 직접 노출하지 않고
// contextBridge로 "명시적 최소 API"만, 모든 메인 프로세스 호출은 화이트리스트 채널의
// ipcRenderer.invoke 한 곳으로만 흐른다(임의 채널 호출 불가 — 메인이 핸들러를 등록한 채널만 응답).

const { contextBridge, ipcRenderer } = require('electron');

// 미래 어댑터가 부를 메인 기능 채널 화이트리스트.
// appInfo=영속 위치 · fetchImage=이미지 굳히기 · llm*=번역 어댑터 · installUpdate=자동 업데이트 설치.
const CHANNELS = new Set(['appInfo', 'fetchImage', 'llmGetConfig', 'llmSetConfig', 'llmClearConfig', 'llmTranslate', 'installUpdate']);

const desktop = {
  // 웹/데스크탑 분기용 플래그. 웹에서는 window.desktop 자체가 없다(undefined).
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  // 어댑터 단일 통로. 화이트리스트 채널만 통과(미등록/차단 채널은 거부).
  invoke(channel, payload) {
    if (!CHANNELS.has(channel)) return Promise.reject(new Error('차단된 채널: ' + channel));
    return ipcRenderer.invoke('desktop:' + channel, payload);
  },
  // 데이터 영속 위치 등 앱 정보(IndexedDB/localStorage가 사는 userData 경로 포함).
  appInfo() { return ipcRenderer.invoke('desktop:appInfo'); },
  // Pro1 자동 임포트: 옛 Pro1 설정 폴더(%APPDATA%\LogGenerator Pro 등)를 메인이 찾아 JSON들을 읽어 돌려줌.
  //   반환 { found, dir, files:[{name,text}] }
  pro1Scan() { return ipcRenderer.invoke('desktop:pro1Scan'); },
  // 이미지 굳히기: 외부 이미지 URL을 메인 프로세스가 받아 원본 화질 data URL로 돌려준다(CORS 무관).
  //   반환 { ok:true, dataUrl, bytes, mime } | { ok:false, error }
  fetchImage(url) { return ipcRenderer.invoke('desktop:fetchImage', url); },
  // 번역(BYO-key, 데스크탑 전용). 설정/키는 메인 프로세스에만 저장(키 원본은 안 돌려줌).
  llmGetConfig() { return ipcRenderer.invoke('desktop:llmGetConfig'); },           // → { provider, model, baseUrl, hasKey }
  llmSetConfig(cfg) { return ipcRenderer.invoke('desktop:llmSetConfig', cfg); },   // apiKey는 명시할 때만 교체
  llmClearConfig() { return ipcRenderer.invoke('desktop:llmClearConfig'); },
  llmTranslate(payload) { return ipcRenderer.invoke('desktop:llmTranslate', payload); },  // { text, targetLang } → { ok, text }
  // 자동 업데이트: onUpdate(cb)로 상태(available/progress/downloaded/error) 수신, installUpdate()로 재시작 설치.
  //   event 객체는 안 넘기고 메시지만 콜백에 전달(보안).
  onUpdate(cb) { ipcRenderer.on('desktop:update', (_e, msg) => { try { cb(msg); } catch (_) {} }); },
  installUpdate() { return ipcRenderer.invoke('desktop:installUpdate'); },
};

contextBridge.exposeInMainWorld('desktop', desktop);
