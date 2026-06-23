// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/confirmModal.ts — 공용 DOM 확인 모달(예/아니오). 편집기·서재 공용.
// ★Electron에서 네이티브 confirm()/alert()/prompt()는 렌더러 포커스를 안 돌려줘 입력칸이 먹통이 된다
//   (Electron #31917). 그래서 모든 가벼운 확인은 이 DOM 모달로 대체한다(파괴적 강확인은 confirmDestructive).
// @ts-nocheck
export function confirmModal(message: string, opts: { okText?: string; cancelText?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const ov = document.createElement('div'); ov.className = 'import-modal';
    const card = document.createElement('div'); card.className = 'import-card confirm-card';
    const msg = document.createElement('div'); msg.className = 'confirm-msg'; msg.textContent = message;   // \n 보존(CSS white-space:pre-line)
    const btns = document.createElement('div'); btns.className = 'import-btns';
    const ok = document.createElement('button'); ok.className = 'primary' + (opts.danger ? ' danger' : ''); ok.textContent = opts.okText || '확인';
    const cancel = document.createElement('button'); cancel.textContent = opts.cancelText || '취소';
    let done = false;
    const close = (v: boolean) => { if (done) return; done = true; ov.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(false); } else if (e.key === 'Enter') { e.preventDefault(); close(true); } };
    ok.onclick = () => close(true); cancel.onclick = () => close(false);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(false); });   // 바깥 클릭 = 취소
    document.addEventListener('keydown', onKey, true);
    btns.append(ok, cancel); card.append(msg, btns); ov.appendChild(card); document.body.appendChild(ov);
    setTimeout(() => { try { ok.focus(); } catch (_) {} }, 0);
  });
}
