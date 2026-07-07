// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/statsPage.ts — "내 기록"(#/stats): 파생 레벨(불꽃 칭호) + 서재 통계 + 결산(Wrapped) 아카 카드.
//
// ★레벨 = 적립이 아니라 "계산"(파생): 이미 있는 데이터(작품·보관 화·처음 읽은 화)에서 즉석 산출 —
//   저장·동기화·조작 걱정 0, 기존 유저는 첫 화면부터 소급 레벨. 안티패턴 가드(회의 결정):
//   스트릭 무벌점(현재/최고 표시만)·알림 0·소모 재화 없음·상시 노출 없음(이 페이지+결산 카드만).
// 결산(Wrapped) = 기간(이번 달/올해) 통계를 "아카 호환 인라인 카드 HTML"로 생성 → 리치 복사.
//   이미지 0·인라인 스타일만(Froala 생존) — 어두운 배경+불꽃 오렌지(브랜드, 소개글과 같은 idiom).
// @ts-nocheck
import { icon } from './icons.js';
import { loadRead } from './store.js';
import { readHistory, todayKey } from './readStats.js';
import { logTextSlots } from './readerLog.js';
import { richCopy } from './clipboard.js';

// ── 파생 레벨: 포인트 = 작품×30 + 보관 화×10 + 처음 읽은 화×5, 레벨 = 완만한 제곱근 커브 ──
//   문턱(레벨 L 진입) = 16×(L-1)² 포인트: L2=16(화 2개면 도달), L5=256, L10=1296, L20=5776.
const TIERS = [
  { min: 1, name: '불씨', color: '#d98c4a' },
  { min: 3, name: '불티', color: '#e8833a' },
  { min: 5, name: '장작불', color: '#f07830' },
  { min: 8, name: '모닥불', color: '#ff6a24' },
  { min: 11, name: '화톳불', color: '#ff5a1f' },
  { min: 15, name: '봉화', color: '#ff4d1a' },
  { min: 20, name: '들불', color: '#ff3d14' },
  { min: 25, name: '큰불', color: '#ff2d0e' },
];
export function computeLevel(works: number, eps: number, readFirst: number) {
  const points = (works | 0) * 30 + (eps | 0) * 10 + (readFirst | 0) * 5;
  const level = Math.floor(Math.sqrt(Math.max(0, points)) / 4) + 1;
  const cur = 16 * (level - 1) ** 2, next = 16 * level ** 2;
  let tier = TIERS[0];
  for (const t of TIERS) if (level >= t.min) tier = t;
  return { points, level, tier, toNext: next - points, progress: Math.max(0, Math.min(1, (points - cur) / (next - cur))) };
}

const el = (tag: string, cls?: string, text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmtN = (n: any) => Number(n || 0).toLocaleString('ko-KR');
const fmtChars = (n: any) => (Number(n || 0) < 1000 ? fmtN(n) : '약 ' + fmtN(Math.round(Number(n) / 1000)) + '천');   // 소량일 때 "약 0천" 방지
const esc = (s: any) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 로그 1건의 대략 글자수(디자인별 텍스트 슬롯 합 — 마크업 포함 슬롯도 있어 "약" 표기 전제).
function logChars(rec: any): number {
  try { return (logTextSlots(rec).texts || []).reduce((n: number, t: any) => n + String(t || '').length, 0); } catch (_) { return 0; }
}

// 읽기 이력(hist) → 연속 읽기(오늘 미독이면 어제까지 인정 — 무벌점 표시용) + 최고 기록.
function streaks(hist: Record<string, any>): { cur: number; best: number } {
  const days = Object.keys(hist).filter((d) => hist[d] && hist[d].o > 0).sort();
  if (!days.length) return { cur: 0, best: 0 };
  const set = new Set(days);
  const prevDay = (d: string) => { const t = new Date(d + 'T12:00:00'); t.setDate(t.getDate() - 1); return todayKey(t); };
  let best = 1, run = 1;
  for (let i = 1; i < days.length; i++) { run = (prevDay(days[i]) === days[i - 1]) ? run + 1 : 1; if (run > best) best = run; }
  let cur = 0, d = todayKey();
  if (!set.has(d)) d = prevDay(d);   // 오늘 아직 안 읽었어도 어제까지의 연속은 유지(벌점 없음)
  while (set.has(d)) { cur++; d = prevDay(d); }
  return { cur, best };
}

// ── 결산(Wrapped) 카드 HTML — 아카(Froala) 호환: 인라인 스타일만·이미지 0·단일 래퍼 ──
function buildWrapCard(o: any): string {
  const stat = (num: string, label: string) =>
    `<div style="display:inline-block; min-width:118px; margin:6px; padding:14px 16px; background:#211910; border:1px solid #463726; border-radius:14px; text-align:center;">` +
    `<div style="font-size:1.7em; font-weight:800; color:#ffb27d; line-height:1.2;">${num}</div>` +
    `<div style="margin-top:4px; font-size:0.85em; color:#b8a078;">${label}</div></div>`;
  const top = o.topWork
    ? `<div style="margin:14px auto 0; max-width:520px; padding:12px 18px; background:linear-gradient(135deg,#2e2013,#24190e); border:1px solid #7a5a2a; border-radius:14px;">` +
      `<span style="color:#d8b378; font-weight:700;">가장 많이 읽은 작품</span>` +
      `<span style="color:#ece0d2; font-weight:800; margin-left:10px;">${esc(o.topWork)}</span>` +
      (o.topWorkCount ? `<span style="color:#b8a078; margin-left:8px;">${fmtN(o.topWorkCount)}회</span>` : '') + `</div>`
    : '';
  return `<div style="background:#17120d; padding:26px 16px 22px; border-radius:18px; font-family:'Noto Serif KR',serif; color:#dcc7a8; text-align:center; max-width:600px; margin:0 auto;">` +
    `<div style="font-family:'Pretendard Variable',system-ui,sans-serif; font-weight:900; font-size:1.9em; letter-spacing:-1px;"><span style="color:#ece0d2;">Log</span><span style="color:#ff5a1f;">Papa</span> <span style="color:#f3dcb0; font-size:0.72em; font-weight:800;">${esc(o.periodLabel)} 결산</span></div>` +
    `<div style="width:72px; height:3px; margin:12px auto 4px; background:linear-gradient(90deg,#e8633a,#f3a44a); border-radius:3px;">&nbsp;</div>` +
    `<div style="margin-top:8px;">` +
    stat(fmtN(o.eps), '보관한 화') + stat(fmtN(o.works), '새 작품') + stat(fmtN(o.readEps), '읽은 화') + stat(fmtChars(o.chars), '글자') +
    `</div>` + top +
    `<div style="margin-top:16px; font-size:0.95em; color:#b8a078;">서재 주인의 불꽃은 지금 <span style="color:${o.tierColor}; font-weight:800;">${esc(o.tierName)}</span> <span style="color:#ece0d2; font-weight:700;">Lv.${o.level}</span></div>` +
    `<div style="margin-top:10px; font-size:0.78em; color:#8a7355;">logpapa.web.app — AI 채팅 로그 보관소</div></div>`;
}

// ── 페이지 본체(팩토리 — library.ts가 ctx 주입) ──
export function createStatsPage(ctx: { app: HTMLElement; getAllLogs: () => any[]; nameOf: (char: string) => string; setStatus: (m: string) => void }) {
  // 작품 표시 이름: 메타 이름(ctx.nameOf) → 로그에 실린 workName(메타 없는 가져온 작품) → 원래 폴백.
  function nameFor(char: string): string {
    const n = ctx.nameOf(char);
    if (n !== char && n !== '이름 없는 작품') return n;
    const w = ctx.getAllLogs().find((r: any) => r.char === char && r.workName);
    return (w && w.workName) || n;
  }
  function periodStats(logs: any[], hist: any, prefix: string) {
    const inP = (d: string) => (d || '').indexOf(prefix) === 0;
    const eps = logs.filter((r) => inP(r.date));
    const works = new Set(eps.map((r) => r.char));
    // 기간 내 "이전에 화가 없던" 작품만 새 작품으로(기존 작품에 화 추가는 제외).
    const before = new Set(logs.filter((r) => (r.date || '') < prefix).map((r) => r.char));
    const newWorks = [...works].filter((c) => !before.has(c));
    let readEps = 0; const workReads: Record<string, number> = {};
    for (const day of Object.keys(hist)) if (inP(day)) { const h = hist[day]; readEps += h.o || 0; for (const c of Object.keys(h.w || {})) workReads[c] = (workReads[c] || 0) + h.w[c]; }
    const top = Object.keys(workReads).sort((a, b) => workReads[b] - workReads[a])[0] || '';
    const chars = eps.reduce((n, r) => n + logChars(r), 0);
    return { eps: eps.length, works: newWorks.length, readEps, chars, topChar: top, topCount: top ? workReads[top] : 0 };
  }

  function openWrapModal(prefix: string, label: string, lv: any) {
    const logs = ctx.getAllLogs();
    const hist = readHistory(loadRead());
    const p = periodStats(logs, hist, prefix);
    const html = buildWrapCard({ periodLabel: label, eps: p.eps, works: p.works, readEps: p.readEps, chars: p.chars, topWork: p.topChar ? nameFor(p.topChar) : '', topWorkCount: p.topCount, tierName: lv.tier.name, tierColor: lv.tier.color, level: lv.level });
    const ov = el('div', 'import-modal'); const card = el('div', 'import-card st-wrap-card');
    const close = () => ov.remove();
    card.appendChild(el('div', 'import-title', label + ' 결산'));
    const prev = el('div', 'st-wrap-preview'); prev.innerHTML = html; card.appendChild(prev);   // 우리가 방금 생성한 HTML(입력 경유 없음)이라 직접 렌더 안전
    card.appendChild(el('div', 'adv-desc', '아카 글쓰기 화면에 그대로 붙여넣을 수 있는 카드예요(이미지 없음·인라인 전용). 결산을 자랑하면 로그파파도 함께 알려집니다.'));
    const btns = el('div', 'import-btns');
    const cp = el('button', 'primary', '아카용 복사') as HTMLButtonElement;
    cp.onclick = async () => { const o = cp.textContent; cp.textContent = '복사 중…'; try { await richCopy(html, `${label} 결산 — 보관 ${p.eps}화 · 읽음 ${p.readEps}화`); cp.textContent = '복사됨!'; } catch (_) { cp.textContent = '실패'; } setTimeout(() => { cp.textContent = o; }, 1400); };
    const cl = el('button', '', '닫기'); (cl as HTMLButtonElement).onclick = close;
    btns.append(cp, cl); card.appendChild(btns);
    ov.appendChild(card); document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  }

  function render() {
    const app = ctx.app;
    app.innerHTML = '';
    const logs = ctx.getAllLogs();
    const read = loadRead();
    const hist = readHistory(read);
    const works = new Set(logs.map((r) => r.char));
    const readFirst = logs.filter((r) => read.readIds && read.readIds[r.id]).length;
    const lv = computeLevel(works.size, logs.length, readFirst);

    const bar = el('div', 'reader-bar');
    const back = el('button', 'reader-back', '← 서재') as HTMLButtonElement; back.onclick = () => { location.hash = '#/'; };
    bar.append(back, el('div', 'reader-title', '내 기록'));
    app.appendChild(bar);
    const scroll = el('div', 'series-scroll st-scroll'); app.appendChild(scroll);

    // ── 1층: 레벨 히어로(불꽃 + 칭호 + 게이지) ──
    const hero = el('div', 'st-hero');
    const flame = el('div', 'st-flame'); flame.innerHTML = icon('flame'); flame.style.color = lv.tier.color;
    const heroTx = el('div', 'st-hero-tx');
    const t1 = el('div', 'st-tier'); t1.append(el('span', 'st-tier-name', lv.tier.name), el('span', 'st-lv', 'Lv.' + lv.level));
    const gauge = el('div', 'st-gauge'); const fill = el('div', 'st-gauge-fill'); fill.style.width = (lv.progress * 100).toFixed(1) + '%'; fill.style.background = lv.tier.color; gauge.appendChild(fill);
    const sub = el('div', 'st-hero-sub', `${fmtN(lv.points)}점 — 작품 ${fmtN(works.size)} · 보관 ${fmtN(logs.length)}화 · 읽음 ${fmtN(readFirst)}화 · 다음 레벨까지 ${fmtN(lv.toNext)}점`);
    heroTx.append(t1, gauge, sub);
    hero.append(flame, heroTx);
    scroll.appendChild(hero);

    // ── 2층: 통계 ──
    const h2 = (t: string) => scroll.appendChild(el('h2', 'home-h st-h', t));
    // 최근 30일 읽기 추이 + 연속 읽기(표시만·무벌점)
    h2('읽기');
    const st = streaks(hist);
    const facts = el('div', 'adm-facts');
    const totalReadOpens = Object.keys(hist).reduce((n, d) => n + (hist[d].o || 0), 0);
    facts.append(
      el('span', 'adm-fact', `연속 읽기 ${st.cur}일`),
      el('span', 'adm-fact', `최고 연속 ${st.best}일`),
      el('span', 'adm-fact', `기록된 열람 ${fmtN(totalReadOpens)}회`),
    );
    scroll.appendChild(facts);
    const mini = el('div', 'adm-mini st-mini');
    const days: string[] = [];
    for (let i = 29; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(todayKey(d)); }
    const maxO = Math.max(1, ...days.map((d) => (hist[d] && hist[d].o) || 0));
    for (const d of days) { const o = (hist[d] && hist[d].o) || 0; const b = el('i'); b.style.height = Math.max(6, (o / maxO) * 100) + '%'; b.title = `${d} · ${o}화`; if (!o) b.classList.add('zero'); mini.appendChild(b); }
    scroll.appendChild(mini);
    scroll.appendChild(el('div', 'adv-desc st-note', '읽기 이력은 2026-07-07부터 기록돼요(그 전 읽음은 레벨에는 반영, 추이에는 없음).'));
    // 최다 읽은 작품 TOP 3(이력 누적)
    const acc: Record<string, number> = {};
    for (const d of Object.keys(hist)) for (const c of Object.keys(hist[d].w || {})) acc[c] = (acc[c] || 0) + hist[d].w[c];
    const tops = Object.keys(acc).sort((a, b) => acc[b] - acc[a]).slice(0, 3);
    if (tops.length) {
      h2('최다 읽은 작품');
      const list = el('div', 'st-tops');
      tops.forEach((c, i) => { const r = el('div', 'st-top'); r.append(el('span', 'st-top-rank', String(i + 1)), el('span', 'st-top-name', nameFor(c)), el('span', 'st-top-n', fmtN(acc[c]) + '회')); list.appendChild(r); });
      scroll.appendChild(list);
    }
    // 월별 보관 추이(최근 12개월)
    h2('보관');
    const months: string[] = [];
    { const d = new Date(); d.setDate(1); for (let i = 11; i >= 0; i--) { const m = new Date(d.getFullYear(), d.getMonth() - i, 1); months.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`); } }
    const byMonth: Record<string, number> = {};
    for (const r of logs) { const k = (r.date || '').slice(0, 7); if (k) byMonth[k] = (byMonth[k] || 0) + 1; }
    const maxM = Math.max(1, ...months.map((m) => byMonth[m] || 0));
    const mbar = el('div', 'adm-mini st-mini st-months');
    for (const m of months) { const n = byMonth[m] || 0; const b = el('i'); b.style.height = Math.max(6, (n / maxM) * 100) + '%'; b.title = `${m} · ${n}화`; if (!n) b.classList.add('zero'); mbar.appendChild(b); }
    scroll.appendChild(mbar);
    const totalChars = logs.reduce((n, r) => n + logChars(r), 0);
    const facts2 = el('div', 'adm-facts');
    facts2.append(
      el('span', 'adm-fact', `작품 ${fmtN(works.size)}`),
      el('span', 'adm-fact', `보관 ${fmtN(logs.length)}화`),
      el('span', 'adm-fact', `읽음 ${fmtN(readFirst)} / ${fmtN(logs.length)}화`),
      el('span', 'adm-fact', `글자 ${fmtChars(totalChars)}`),
    );
    scroll.appendChild(facts2);

    // ── 3층: 결산(Wrapped) ──
    h2('결산 카드');
    scroll.appendChild(el('div', 'adv-desc st-note', '기간 결산을 아카에 붙여넣을 수 있는 카드로 만들어요.'));
    const wrapBtns = el('div', 'st-wrap-btns');
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const mB = el('button', 'studio-btn', `${now.getMonth() + 1}월 결산 카드`) as HTMLButtonElement;
    mB.onclick = () => openWrapModal(monthPrefix, `${now.getFullYear()}년 ${now.getMonth() + 1}월`, lv);
    const yB = el('button', 'studio-btn primary', `${now.getFullYear()}년 결산 카드`) as HTMLButtonElement;
    yB.onclick = () => openWrapModal(String(now.getFullYear()) + '-', `${now.getFullYear()}년`, lv);
    wrapBtns.append(mB, yB);
    scroll.appendChild(wrapBtns);
  }

  return { render };
}
