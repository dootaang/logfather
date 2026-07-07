// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/adminPanel.ts — 관리자 사용량 패널(사장님 계정 전용 UI).
//
// 게이트 2중: ①버튼 노출 = isAdminUser(uid 일치, adminStats.ADMIN_UID) ②데이터 읽기 = 서버 보안규칙
//   (firestore.rules stats: 관리자 uid만 read) — UI 상수는 노출용일 뿐, 진짜 벽은 규칙.
// 내용: 서비스 지표(오늘/14일 접속·가입 계정·총 공유) + Firebase 쿼터 게이지(★일간/월간 구분 표시 —
//   Firestore 읽쓰=일간 리셋, Storage(모던 버킷)=월간, Hosting 전송=일간 한도인데 메트릭은 월누적이라 참고 표기).
//   쿼터 스냅샷(stats/usage)은 GitHub Actions 일일 크론(scripts/usage-snapshot.mjs)이 쓴다 — 없으면 안내.
// @ts-nocheck
import { fetchAdminData, isAdminUser } from './adminStats.js';

const el = (tag: string, cls?: string, text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmtN = (n: any) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const fmtB = (n: any) => {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (v >= 10 ? Math.round(v).toLocaleString('ko-KR') : v.toFixed(1)) + u[i];
};

// 게이지 한 줄: 라벨 · [주기 칩] · 바 · "사용 / 무료한도". 80% 노랑, 100% 빨강.
function gaugeRow(label: string, period: string, val: any, max: number, fmt: (n: any) => string): HTMLElement {
  const row = el('div', 'adm-row');
  const lb = el('span', 'adm-label', label);
  const chip = el('span', 'adm-chip' + (period === '오늘' ? ' day' : ''), period);
  const bar = el('div', 'adm-bar');
  const fill = el('div', 'adm-fill');
  const pct = val == null ? 0 : Math.min(100, (Number(val) / max) * 100);
  fill.style.width = pct.toFixed(1) + '%';
  if (pct >= 100) fill.classList.add('over'); else if (pct >= 80) fill.classList.add('warn');
  bar.appendChild(fill);
  const num = el('span', 'adm-num', `${fmt(val)} / ${fmt(max)}`);
  row.append(lb, chip, bar, num);
  return row;
}

export function openAdminPanel(setStatus: (m: string) => void) {
  const ov = el('div', 'import-modal');
  const card = el('div', 'import-card adv-card adm-card');
  const close = () => ov.remove();
  card.appendChild(el('div', 'import-title', '관리자 — 사용량'));
  const body = el('div', 'adm-body'); card.appendChild(body);
  const btns = el('div', 'import-btns');
  const refreshB = el('button', '', '새로고침') as HTMLButtonElement;
  const closeB = el('button', '', '닫기'); (closeB as HTMLButtonElement).onclick = close;
  btns.append(refreshB, closeB); card.appendChild(btns);
  ov.appendChild(card); document.body.appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

  const load = async () => {
    refreshB.disabled = true;
    body.innerHTML = ''; body.appendChild(el('div', 'adv-desc', '불러오는 중…'));
    let d: any = null;
    try { d = await fetchAdminData(14); } catch (_) {}
    body.innerHTML = '';
    if (!d) {
      body.appendChild(el('div', 'adv-desc', '불러오기 실패 — 관리자 계정 로그인 여부와 보안규칙(stats)의 관리자 uid를 확인하세요.'));
      refreshB.disabled = false; return;
    }
    // ── 서비스 지표(자체 수집) ──
    body.appendChild(el('div', 'menu-label', '서비스 지표'));
    const today = d.dau[d.dau.length - 1];
    const sum14 = d.dau.reduce((n: number, x: any) => n + x.opens, 0);
    const usage = d.usage || null;
    const facts = el('div', 'adm-facts');
    facts.append(
      el('span', 'adm-fact', `오늘 접속 ${fmtN(today && today.opens)}`),
      el('span', 'adm-fact', `14일 합계 ${fmtN(sum14)}`),
      el('span', 'adm-fact', `가입 계정 ${fmtN(usage && usage.authUsers)}`),
      el('span', 'adm-fact', `공개 공유 ${fmtN(d.shares)}`),
    );
    body.appendChild(facts);
    // 14일 미니 막대(접속 추이). 접속=로그인 기기·하루 1회 집계라 개인 식별 없음.
    const maxOpen = Math.max(1, ...d.dau.map((x: any) => x.opens));
    const mini = el('div', 'adm-mini');
    for (const x of d.dau) {
      const b = el('i'); b.style.height = Math.max(6, (x.opens / maxOpen) * 100) + '%';
      b.title = `${x.day} · ${x.opens}`;
      if (!x.opens) b.classList.add('zero');
      mini.appendChild(b);
    }
    body.appendChild(mini);
    // ── Firebase 쿼터(크론 스냅샷) ──
    body.appendChild(el('div', 'menu-label', 'Firebase 무료쿼터'));
    if (!usage) {
      body.appendChild(el('div', 'adv-desc', '쿼터 스냅샷이 아직 없어요 — GitHub Actions 크론(usage-snapshot) 설정이 필요합니다. 절차는 repo의 ADMIN_PANEL_SETUP.md 참고.'));
    } else {
      const fs = usage.firestore || {};
      const st = usage.storage || {};
      body.appendChild(gaugeRow('Firestore 읽기', '오늘', fs.reads, 50000, fmtN));
      body.appendChild(gaugeRow('Firestore 쓰기', '오늘', fs.writes, 20000, fmtN));
      body.appendChild(gaugeRow('Firestore 삭제', '오늘', fs.deletes, 20000, fmtN));
      body.appendChild(gaugeRow('Storage 저장', '누적', st.bytes, 5 * 1024 ** 3, fmtB));
      body.appendChild(gaugeRow('Storage 다운로드', '이번 달', st.monthDownBytes, 100 * 1024 ** 3, fmtB));
      body.appendChild(gaugeRow('Storage 업로드 횟수', '이번 달', st.monthUploadOps, 5000, fmtN));
      body.appendChild(gaugeRow('Storage 다운로드 횟수', '이번 달', st.monthDownOps, 50000, fmtN));
      const hosting = usage.hosting || {};
      if (hosting.monthSentBytes != null) body.appendChild(el('div', 'adv-desc', `Hosting 전송(이번 달 누적): ${fmtB(hosting.monthSentBytes)} — 무료 한도는 360MB/일(일간 리셋)이라 게이지 대신 참고 수치로 표시.`));
      const when = usage.at ? new Date(usage.at) : null;
      body.appendChild(el('div', 'adv-desc adm-when', `스냅샷: ${when ? when.toLocaleString('ko-KR') : '?'} (매일 1회 갱신 · Firestore 일간 수치는 태평양 자정 리셋 기준)`));
      if (Array.isArray(usage.errors) && usage.errors.length) body.appendChild(el('div', 'adv-desc', '수집 실패 항목: ' + usage.errors.join(' · ')));
    }
    refreshB.disabled = false;
  };
  refreshB.onclick = load;
  load();
}

// 설정 메뉴에 "관리자" 버튼 주입 — 평소 숨김, 메뉴를 열 때마다 현재 로그인으로 노출 판정(로그인이 늦게 떠도 반영).
export function injectAdminButton(getUser: () => any, setStatus: (m: string) => void) {
  const pop = document.querySelector('.settings-menu .menu-pop'); if (!pop) return;
  if (pop.querySelector('#btn-admin')) return;
  const b = document.createElement('button'); b.id = 'btn-admin'; b.textContent = '관리자'; b.hidden = true;
  b.title = '사용량 대시보드(관리자 전용)';
  b.onclick = () => openAdminPanel(setStatus);
  const adv = pop.querySelector('#btn-advanced');
  if (adv) pop.insertBefore(b, adv); else pop.appendChild(b);
  const menu = document.querySelector('details.settings-menu');
  if (menu) menu.addEventListener('toggle', () => { if ((menu as HTMLDetailsElement).open) b.hidden = !isAdminUser(getUser()); });
}
