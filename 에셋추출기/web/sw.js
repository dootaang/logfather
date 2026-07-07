// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — 에셋추출기(Asset Extractor). Licensed under GNU GPL v3 (see LICENSE).
// P4(PWA) 서비스워커 — 정적 자원 오프라인 캐시.
//   전략 = 네트워크 우선(호스팅이 html/js/css를 no-cache로 주므로 항상 최신), 실패 시 캐시(오프라인).
//   파일 처리 자체가 전부 로컬이라 한 번 로드해두면 오프라인에서도 완전 동작.
'use strict';
const CACHE = 'ax-static-v1';
const ASSETS = ['./', 'style.css', 'dist/main.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.ok) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((m) => m || caches.match('./')))
  );
});
