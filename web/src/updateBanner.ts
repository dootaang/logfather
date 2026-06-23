// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/updateBanner.ts — 자동 업데이트 최소 UX(데스크탑 전용).
//
// 메인 프로세스(electron-updater)가 새 버전을 백그라운드로 받으면 'downloaded' 알림이 온다 →
// 화면 하단에 작은 배너로 "지금 재시작해서 업데이트" 버튼을 보여준다(사용자가 눌러야 설치 = 강제 아님).
// 웹(window.desktop 없음)이거나 업데이트 미지원이면 아무것도 안 함.
// @ts-nocheck
export function mountUpdateBanner(): void {
  const d = (window as any).desktop;
  if (!d || typeof d.onUpdate !== 'function') return;
  d.onUpdate((msg: any) => {
    if (!msg) return;
    if (msg.status === 'downloaded') showBanner(msg.version);
    // available/progress/error는 조용히(배너는 받기 완료 때만 — 사용자 방해 최소화).
  });
}

function showBanner(version?: string): void {
  if (document.getElementById('lp-update-banner')) return;
  const b = document.createElement('div'); b.id = 'lp-update-banner'; b.className = 'lp-update-banner';
  const txt = document.createElement('span');
  txt.textContent = `새 버전${version ? ' ' + version : ''}이 준비됐어요.`;
  const go = document.createElement('button'); go.className = 'lp-update-go'; go.textContent = '지금 재시작해서 업데이트';
  go.onclick = () => { go.disabled = true; go.textContent = '재시작 중…'; try { (window as any).desktop.installUpdate(); } catch (_) {} };
  const later = document.createElement('button'); later.className = 'lp-update-later'; later.textContent = '나중에';
  later.onclick = () => b.remove();
  b.append(txt, go, later);
  document.body.appendChild(b);
}
