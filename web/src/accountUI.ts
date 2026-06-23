// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/accountUI.ts — 상단바 계정 UI(아이디 로그인/가입 + 이메일추가 + 비번찾기). 에디터·서재 공용.
//
// DOM만 다루는 가벼운 모듈(Firebase 직접 import 안 함). 호출부가 로드한 auth 모듈(A)을 받아서 쓴다.
// 가입/로그인 = 아이디 + 비밀번호. 이메일은 선택(분실 복구용). 게스트 없음.
// @ts-nocheck
import { isLocalFirst, openSyncModal } from './desktopSync.js';   // 로컬-퍼스트(데스크탑 OR 웹-수동) 수동 동기화(버튼식)
import { icon } from './icons.js';   // 통일 라인 아이콘
import { hasUnpushed } from './store.js';   // "안 올린 변경" 점(로컬-퍼스트)

export function mountAccountUI(A: any): void {
  const group = document.getElementById('auth-group');
  if (!group) return;
  if (!A.authAvailable()) { group.hidden = true; return; }
  group.hidden = false;

  let overlay: HTMLElement | null = null;
  const close = () => { if (overlay) { overlay.remove(); overlay = null; } };
  const mkInput = (type: string, ph: string, ac: string) => { const i = document.createElement('input'); i.type = type; i.placeholder = ph; i.className = 'auth-input'; i.autocomplete = ac; return i; };

  // mode: 'auth'(로그인/가입) | 'addEmail'(분실대비 이메일) | 'forgot'(비번 재설정)
  function openModal(mode: string) {
    close();
    overlay = document.createElement('div'); overlay.className = 'auth-modal';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const card = document.createElement('div'); card.className = 'auth-card';
    const x = document.createElement('button'); x.className = 'auth-x'; x.textContent = '✕'; x.title = '닫기'; x.onclick = close;
    const h = document.createElement('div'); h.className = 'auth-title';
    const sub = document.createElement('div'); sub.className = 'auth-sub';
    const msg = document.createElement('div'); msg.className = 'auth-err'; msg.hidden = true;
    const setMsg = (m: string, ok?: boolean) => { msg.textContent = m; msg.hidden = !m; msg.classList.toggle('auth-ok', !!ok); };
    const btns = document.createElement('div'); btns.className = 'auth-btns';
    const all: HTMLButtonElement[] = [];
    const busy = (on: boolean) => all.forEach((b) => (b.disabled = on));
    async function run(fn: () => Promise<void>, okMsg?: string): Promise<boolean> {
      setMsg(''); busy(true);
      try { await fn(); if (okMsg) setMsg(okMsg, true); else close(); return true; }
      catch (e) { setMsg(A.authErrorMessage(e)); return false; }
      finally { busy(false); }
    }
    card.append(x, h, sub);

    if (mode === 'addEmail') {
      h.textContent = '이메일 추가 (분실 대비)';
      sub.textContent = '이메일을 등록하면 비밀번호를 잊었을 때 재설정 메일로 되찾을 수 있습니다. 등록 메일의 링크를 눌러야 완료됩니다. ★추가하면 앞으로 이 이메일로 로그인합니다(아이디 로그인은 대체). 계정·서재 데이터는 그대로예요 — 같은 계정이라 안전합니다.';
      const email = mkInput('email', '복구용 이메일', 'email');
      card.append(email, msg, btns);
      const add = document.createElement('button'); add.className = 'primary'; add.textContent = '인증 메일 보내기'; all.push(add);
      add.onclick = () => run(() => A.addRecoveryEmail(email.value), '인증 메일을 보냈습니다. 메일함에서 링크를 누르면 등록 완료됩니다.');
      btns.append(add);
      overlay.appendChild(card); document.body.appendChild(overlay); email.focus(); return;
    }

    if (mode === 'forgot') {
      h.textContent = '비밀번호 찾기';
      sub.textContent = '가입 시 등록한 복구용 이메일로 재설정 링크를 보냅니다. (아이디만 쓰고 이메일을 등록하지 않았다면 복구가 어렵습니다.)';
      const email = mkInput('email', '등록한 이메일', 'email');
      card.append(email, msg, btns);
      const send = document.createElement('button'); send.className = 'primary'; send.textContent = '재설정 메일 보내기'; all.push(send);
      send.onclick = () => { if (!email.value.trim()) { setMsg('이메일을 입력하세요.'); return; } run(() => A.resetPassword(email.value), '재설정 메일을 보냈습니다. 메일함을 확인하세요.'); };
      const back = document.createElement('button'); back.className = 'auth-link'; back.textContent = '← 로그인으로'; back.onclick = () => openModal('auth'); all.push(back);
      btns.append(send); card.appendChild(back);
      overlay.appendChild(card); document.body.appendChild(overlay); email.focus(); return;
    }

    // mode 'auth'
    h.textContent = '로그인 / 가입';
    sub.textContent = '아이디와 비밀번호로 시작하세요. 이메일은 나중에 분실 대비로 추가할 수 있습니다.';
    const id = mkInput('text', '아이디 (또는 등록한 이메일)', 'username');
    const pw = mkInput('password', '비밀번호 (6자 이상)', 'current-password');
    card.append(id, pw, msg, btns);
    const login = document.createElement('button'); login.className = 'primary'; login.textContent = '로그인'; all.push(login);
    const signup = document.createElement('button'); signup.textContent = '가입'; all.push(signup);
    login.onclick = () => run(() => A.signIn(id.value, pw.value));
    signup.onclick = () => run(() => A.signUp(id.value, pw.value));
    pw.addEventListener('keydown', (e: any) => { if (e.key === 'Enter') login.click(); });
    btns.append(login, signup);
    const forgot = document.createElement('button'); forgot.className = 'auth-link'; forgot.textContent = '비밀번호를 잊으셨나요?'; forgot.onclick = () => openModal('forgot'); all.push(forgot);
    const note = document.createElement('div'); note.className = 'auth-note'; note.textContent = '※ 이메일 없이 아이디만으로 가입돼요. 가입 후 “이메일 추가”로 분실 복구를 켤 수 있습니다.';
    card.append(forgot, note);
    overlay.appendChild(card); document.body.appendChild(overlay); id.focus();
  }

  function renderAccount(user: any) {
    group.innerHTML = '';
    if (user) {
      const recovered = A.hasRecoveryEmail(user);
      const who = document.createElement('span'); who.className = 'auth-who';
      who.innerHTML = icon(recovered ? 'mail' : 'user') + ' '; who.append(document.createTextNode(A.displayName(user)));   // 아이콘 + 이름(텍스트노드=안전)
      who.title = recovered ? '복구 이메일 등록됨' : '아이디 계정 — 분실 대비 이메일 미등록';
      group.append(who);
      if (!recovered) {   // 아직 복구 이메일 없으면 추가 버튼 노출
        const add = document.createElement('button'); add.id = 'btn-auth'; add.textContent = '이메일 추가'; add.title = '비밀번호 분실 대비 이메일 등록';
        add.onclick = () => openModal('addEmail'); group.append(add);
      }
      const out = document.createElement('button'); out.textContent = '로그아웃';
      out.onclick = async () => { try { await A.doSignOut(); } catch (_) {} };
      group.append(out);
    } else {
      const inb = document.createElement('button'); inb.id = 'btn-auth';
      inb.textContent = '로그인'; inb.title = '아이디로 로그인하면 서재·설정을 여러 기기에서 동기화할 수 있습니다';
      inb.onclick = () => openModal('auth');
      group.append(inb);
    }
    // ★로컬-퍼스트(데스크탑 항상 · 웹은 수동 모드): 수동 동기화 버튼(불러오기/저장/연동안함). 웹 자동 모드는 안 띄움(현행).
    if (isLocalFirst()) {
      const syncB = document.createElement('button'); syncB.innerHTML = icon('cloud') + ' 동기화';
      syncB.title = '클라우드에서 불러오기 / 클라우드에 저장 (수동 — 누를 때만 동기화)';
      if (hasUnpushed()) { const dot = document.createElement('span'); dot.className = 'sync-dot'; dot.title = '안 올린 변경이 있어요 — ‘동기화 → 저장’을 누르세요'; syncB.appendChild(dot); }
      syncB.onclick = () => openSyncModal(A);
      group.append(syncB);
    }
  }
  // verifyBeforeUpdateEmail은 onAuthStateChanged를 안 울릴 수 있어 직접 갱신 훅 제공.
  (window as any).__refreshAccount = () => renderAccount(A.currentUser());
  A.watchAuth(renderAccount);
  // "안 올린 변경" 점을 라이브로: 로컬 변경(pro2-unpushed)·동기화 완료(pro2-desktop-synced) 시 계정 UI 다시 그림.
  try { const rr = () => { try { renderAccount(A.currentUser()); } catch (_) {} }; window.addEventListener('pro2-unpushed', rr); window.addEventListener('pro2-desktop-synced', rr); } catch (_) {}
}
