// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/readerLog.ts — 내 서재 리더(단일 화 #/log) + 번역/정리 흐름 + 공유 팝오버. library·reader 공용(팩토리).
//
// 페이지별 상태(allLogs·setStatus·route·로그인 사용자·표시이름)는 ctx로 주입 → library(작품 페이지의 번역/정리)와
// reader(단일 화 열람)가 같은 코드 1벌을 쓴다(중복 복붙 금지). 리더 본문/페이저/타이포는 readerView.ts 재사용.
// @ts-nocheck
import { mountReaderBody, rdCfg, isWebnovel, isPapa, popAutoClose, mk } from './readerView.js';
import { icon } from './icons.js';
import { richCopy } from './clipboard.js';
import { confirmModal } from './confirmModal.js';
import { logsAdd, logsDelete, loadRead, saveRead, saveReaderCfg, getBackendKind, kvLoad, resolveAssetRefs } from './store.js';
import { isLocalFirst, getSyncMode } from './desktopSync.js';
import { bakeLogs, externalCount, bakeAvailable } from './bake.js';   // 파파 하이브리드 이미지 굳히기(데스크탑 native / 웹 weserv 폴백)
import { stripPapaCruft, papaCruftChanges } from '../../core/cleanup/papaCruft.js';   // 파파 보편 군더더기(CoT/번역분석 접기) 비파괴 제거
import { translateAvailable, translateUnits, getWorkPrompt, setWorkPrompt, ensureTranslateReady, openTranslateSettings } from './translate.js';
import { cleanUnits } from './cleanup.js';
import { defaultSettings } from '../../core/preset/bundle.js';
import { convertText } from '../../core/convert/convertText.js';
import { expandCardRegex, sanitizeRegexOut } from '../../core/convert/cardRegex.js';   // 관리실 정리 규칙(표시 정규식) 적용 + 외부 규칙 out 살균
import { processImageTags, stripUnresolvedAssetImages } from '../../core/convert/processImageTags.js';   // 가져온 에셋 맵 재적용 + 미해결 에셋명 <img> 숨김(엑박 방지)
import { resolveAssetCBS } from '../../core/convert/prepareBody.js';
import { resolveAssetMarkers } from '../../core/convert/risuMarkers.js';
import { renderRisu } from '../../core/risu/parser.js';   // ★리스 CBS 관대 렌더(조건문·계산·변수·배경이미지 div) — 임포트 챗 충실 렌더

const loadShare = () => import('./share.js');
const epOrder = (x: any) => (x && x.order != null ? x.order : 1e9);
function sortEps(eps: any[]): any[] { return eps.slice().sort((a, b) => (epOrder(a) - epOrder(b)) || (a.date || '').localeCompare(b.date || '') || (a.id || '').localeCompare(b.id || '')); }
const clonej = (x: any) => (x == null ? x : JSON.parse(JSON.stringify(x)));
// 비파괴 번역: 원문 스냅샷(r.orig, 구조화 텍스트) ↔ 표시 레코드 사이 헬퍼.
const ORIG_FIELDS = ['input', 'chat', 'diary', 'webnovel', 'cardCfg', 'userCardCss'];
const origRecord = (r: any) => Object.assign({ template: r.template, char: r.char, assets: r.assets, assetRefs: r.assetRefs }, r.orig || {});   // 원문 → rerenderLog용 임시 레코드(에셋 맵·참조 동반 → 원문/번역 토글에서도 에셋 보존)
// ★가져온 에셋(마커 방식)을 모든 재렌더(정리·번역·토글·편집) 끝에 rec.assets로 되살림 — 마커 {{img::이름}}·CBS를 카드 스타일 <img>로(증발 방지).
const ASSET_IMG_STYLE = { size: 100, margin: 10, useBorder: false, borderColor: '#000000', useShadow: true };
function applyAssetMap(html: string, assets: any, charName?: string): string {
  if (!assets || typeof assets !== 'object' || !Object.keys(assets).length) return html;
  let h = String(html || '');
  try {
    // ★리스 CBS/조건문/계산/배경이미지 div 충실 렌더(임포트 챗). 에셋 마커({{img::}})는 보존 → 아래 카드 스타일 해석기로.
    //   리스 마커가 있을 때만 동작(없으면 무동작 = 우리 자가 로그·골든 무영향).
    if (/\{\{|background-image\s*:\s*url|<(?:user|char|bot)>/i.test(h)) h = renderRisu(h, { charName, userName: '나', assets, inlays: {}, keepAssetMarkers: true });
    h = resolveAssetCBS(h, assets); h = processImageTags(h, assets, ASSET_IMG_STYLE); h = resolveAssetMarkers(h, assets, ASSET_IMG_STYLE);
  } catch (_) {}
  return h;
}
function applyOrig(r: any) { if (!r.orig) return; for (const k of ORIG_FIELDS) { if (k in r.orig) r[k] = clonej(r.orig[k]); else delete r[k]; } }   // 표시 본문을 원문으로 되돌림(번역 지우기/다시 번역)
// ── 관리실 정리 규칙(표시 정규식) — 리더 전역 비파괴 적용(원본 로그 불변·토글) ──
const CLEANUP_KEY = 'pro2-cleanup-rules';
function cleanupRules(): any[] {   // 전역 enabled + ★소스별 enabled(개별 활성)인 것만 평탄화. 0개·꺼짐 = [](무동작).
  try { const r = kvLoad(CLEANUP_KEY); if (!r || r.enabled === false || !Array.isArray(r.sources)) return []; const out: any[] = []; for (const s of r.sources) if (s && s.enabled !== false && Array.isArray(s.rules)) for (const x of s.rules) out.push(x); return out; } catch (_) { return []; }
}
// ★per-log 정리 규칙 — 가져올 때 챗에 동봉된 rec.cleanupRegex(외부 유입). ★out 살균 + 모양 정규화(표시타입·ReDoS 필터는 expandCardRegex가 보장). 관리실 글로벌과 합성·멱등.
function perLogCleanup(rec: any): any[] {
  const arr = rec && rec.cleanupRegex;
  if (!Array.isArray(arr) || !arr.length) return [];
  const out: any[] = [];
  for (const r of arr) if (r && typeof r.in === 'string' && typeof r.out === 'string') out.push({ in: r.in, out: sanitizeRegexOut(r.out), type: r.type || 'editdisplay', flag: r.flag || r.flags || '' });
  return out;
}
function cleanupChanges(rec: any, rules: any[]): boolean {   // 이 레코드 텍스트를 바꾸나?(재렌더 없이 싸게 판정 — 토글 노출 여부)
  try { const s = logTextSlots(clonej(rec)); for (const t of s.texts) if (expandCardRegex(t, rules) !== t) return true; } catch (_) {}
  return false;
}
function renderCleaned(rec: any, rules: any[], displayAssets?: Record<string, string>): string {   // 비파괴 정리: 복제 → 텍스트 슬롯에 expandCardRegex → 재렌더(표시용 에셋 적용)
  const c = clonej(rec); const s = logTextSlots(c);
  for (let i = 0; i < s.texts.length; i++) s.set(i, expandCardRegex(s.texts[i], rules));
  return rerenderLog(c, displayAssets);
}

// 한 로그의 번역/정리 대상 텍스트 슬롯(구조화 원본). role 있는 단위(채팅/카드블록)는 역할 제외에 쓰임.
export function logTextSlots(rec: any): { texts: string[]; roles: (string | null)[]; set: (i: number, v: string) => void } {
  const texts: string[] = []; const roles: (string | null)[] = []; const setters: ((v: string) => void)[] = [];
  const push = (get: () => string, set: (v: string) => void, role?: string | null) => { texts.push(get()); roles.push(role || null); setters.push(set); };
  const t = rec.template || 'card';
  if (t === 'chat' && rec.chat && Array.isArray(rec.chat.messages)) {
    rec.chat.messages.forEach((m: any) => push(() => String(m.text || ''), (v) => { m.text = v; }, m.role));
  } else if (t === 'log-diary' && rec.diary && Array.isArray(rec.diary.pages)) {
    rec.diary.pages.forEach((p: any) => { push(() => String(p.title || ''), (v) => { p.title = v; }); push(() => String(p.subtitle || ''), (v) => { p.subtitle = v; }); push(() => String(p.content || ''), (v) => { p.content = v; }); });
  } else if (t === 'webnovel' && rec.webnovel && Array.isArray(rec.webnovel.blocks) && rec.webnovel.blocks.length) {
    rec.webnovel.blocks.forEach((b: any) => { push(() => String(b.title || ''), (v) => { b.title = v; }); push(() => String(b.content || ''), (v) => { b.content = v; }, b.role); });
  } else if (t === 'card' && rec.cardCfg && Array.isArray(rec.cardCfg.blocks) && rec.cardCfg.blocks.length) {
    rec.cardCfg.blocks.forEach((b: any) => { push(() => String(b.title || ''), (v) => { b.title = v; }); push(() => String(b.subtitle || ''), (v) => { b.subtitle = v; }); push(() => String(b.content || ''), (v) => { b.content = v; }, b.role); });
  } else {
    push(() => String(rec.input || ''), (v) => { rec.input = v; });
  }
  return { texts, roles, set: (i, v) => setters[i](v) };
}
// 구조화 원본으로 html 재렌더(채팅 가져오기 buildAndSaveChat와 동일 = defaults 기준).
//   displayAssets(이름→dataURL)를 주면 표시용(이미지 임베드). 안 주면 저장용 = 마른 형태(마커 유지) + 옛 레코드는 rec.assets(base64)로 하위호환 임베드.
//   ★새 가져오기는 rec.html에 이미지를 안 굽는다(마커 + rec.assetRefs[이름→해시], 바이트는 IDB_BLOBS 한 벌). 표시 직전 resolveAssetRefs로 그 화만 복원해 displayAssets로 넘긴다.
export function rerenderLog(rec: any, displayAssets?: Record<string, string>): string {
  const s = defaultSettings();
  s.template = rec.template || 'card';
  s.profile = s.profile || {}; if (rec.char) s.profile.botName = rec.char;
  s.templateSettings = s.templateSettings || {};
  let input = '';
  const t = s.template;
  if (t === 'chat') s.templateSettings.chat = rec.chat || {};
  else if (t === 'log-diary') s.templateSettings['log-diary'] = rec.diary || {};
  else if (t === 'webnovel') { s.templateSettings.webnovel = rec.webnovel || {}; if (!(rec.webnovel && rec.webnovel.useBlocks)) input = String(rec.input || ''); }
  else if (t === 'card' && rec.cardCfg && Array.isArray(rec.cardCfg.blocks) && rec.cardCfg.blocks.length) s.templateSettings.card = rec.cardCfg;
  else if (t === 'custom-css') { s.userCardCss = String(rec.userCardCss || ''); input = String(rec.input || ''); }
  else input = String(rec.input || '');
  const assets = displayAssets !== undefined ? displayAssets : rec.assets;   // 표시=resolve된 맵 / 저장=undefined(마른 마커) / 옛 레코드=rec.assets(base64)
  return applyAssetMap(convertText(input, s), assets, rec.char);   // ★표시 시에만 에셋 임베드 → 저장 html은 마름(용량·메모리 절약). 옛 레코드는 그대로 보존.
}
// 공유용 html — 내 입력(user 역할) 항목을 구조에서 빼고 재렌더(★rec.assets 재적용 = 에셋 보존). ★비파괴(복제만, 원본 r 불변).
//   역할 구조가 있는 디자인(chat/card/webnovel)만 필터 가능 — 없으면(단일 input·custom-css) 원본 html 그대로 반환(안전).
export function filteredShareHtml(r: any): string {
  const hasRole = (r.chat && Array.isArray(r.chat.messages) && r.chat.messages.length)
    || (r.cardCfg && Array.isArray(r.cardCfg.blocks) && r.cardCfg.blocks.length)
    || (r.webnovel && Array.isArray(r.webnovel.blocks) && r.webnovel.blocks.length);
  if (!hasRole) return String(r.html || '');
  const c = clonej(r);
  if (c.chat && Array.isArray(c.chat.messages)) c.chat.messages = c.chat.messages.filter((m: any) => m && m.role !== 'user');
  if (c.cardCfg && Array.isArray(c.cardCfg.blocks)) c.cardCfg.blocks = c.cardCfg.blocks.filter((b: any) => b && b.role !== 'user');
  if (c.webnovel && Array.isArray(c.webnovel.blocks)) c.webnovel.blocks = c.webnovel.blocks.filter((b: any) => b && b.role !== 'user');
  return rerenderLog(c);
}
// 공유용 "살찐(이미지 임베드)" html — 공유 받는 사람은 로컬 블롭이 없으므로 이미지를 본문에 박아 올린다.
//   마른 레코드(rec.assetRefs): 그 화 이미지를 IDB_BLOBS(필요시 클라우드)에서 복원해 마커에 임베드.
//   옛 레코드(rec.assets/임베드된 r.html): amap=undefined → 그대로(이미 임베드). hideUser면 user 메시지 빼고 재렌더.
export async function fattenShareHtml(r: any, hideUser: boolean): Promise<string> {
  const amap = (r && r.assetRefs && typeof r.assetRefs === 'object') ? await resolveAssetRefs(r.assetRefs) : undefined;
  let h: string;
  if (hideUser) {
    const hasRole = (r.chat && Array.isArray(r.chat.messages) && r.chat.messages.length)
      || (r.cardCfg && Array.isArray(r.cardCfg.blocks) && r.cardCfg.blocks.length)
      || (r.webnovel && Array.isArray(r.webnovel.blocks) && r.webnovel.blocks.length);
    if (!hasRole) h = applyAssetMap(String(r.html || ''), amap, r.char);   // 역할 구조 없으면 필터 불가 → 본문 임베드만
    else {
      const c = clonej(r);
      if (c.chat && Array.isArray(c.chat.messages)) c.chat.messages = c.chat.messages.filter((m: any) => m && m.role !== 'user');
      if (c.cardCfg && Array.isArray(c.cardCfg.blocks)) c.cardCfg.blocks = c.cardCfg.blocks.filter((b: any) => b && b.role !== 'user');
      if (c.webnovel && Array.isArray(c.webnovel.blocks)) c.webnovel.blocks = c.webnovel.blocks.filter((b: any) => b && b.role !== 'user');
      h = rerenderLog(c, amap);
    }
  } else {
    h = applyAssetMap(String(r.html || ''), amap, r.char);
  }
  return stripUnresolvedAssetImages(h);   // 공유본도 미해결 에셋명 <img> 숨김(받는 사람 화면 엑박 방지)
}

// 팩토리 — ctx: { setStatus, reloadLogs, getAllLogs, route, getUser, nameOf }.
export function createReaderLog(ctx: { setStatus: (m: string) => void; reloadLogs: () => Promise<void>; getAllLogs: () => any[]; route: () => void; getUser: () => any; nameOf: (char: string) => string }) {
  const { setStatus, reloadLogs, getAllLogs, route } = ctx;
  const origView: Record<string, boolean> = {};   // 리더 토글 상태(true=원문 보기). 기본=번역. 세션 UI 상태(데이터는 r.orig로 영속). 옛 세션 ↩원문(trialRestores)을 이 영속 토글로 대체.
  const cleanView: Record<string, boolean> = {};   // 정리 토글 상태(false=원본 보기). 기본=정리됨. 정규식은 관리실 KV(원본 로그 불변).
  const papaCleanView: Record<string, boolean> = {};   // ★파파 군더더기 숨김 토글(true=정리). 기본=원본(파파 철학="그대로 삼키기" → opt-in). 비파괴.
  const cleanRestores: Record<string, () => Promise<void>> = {};

  function shareAvailability(): { ok: boolean; reason: string } {
    if (isLocalFirst()) {
      if (getSyncMode() === 'off') return { ok: false, reason: 'off' };
      if (!ctx.getUser()) return { ok: false, reason: 'login' };
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, reason: 'offline' };
      return { ok: true, reason: '' };
    }
    return getBackendKind() === 'firebase' ? { ok: true, reason: '' } : { ok: false, reason: 'login' };
  }
  function shareGateMessage(reason: string): string {
    if (reason === 'off') return '“연동 안 함(로컬 전용)” 모드에서는 공유할 수 없어요. 상단 “동기화”에서 모드를 바꾸면 공유할 수 있습니다.';
    if (reason === 'offline') return '공유는 인터넷 연결이 필요해요. 온라인 상태에서 다시 시도하세요.';
    return '공개 링크는 로그인해야 만들 수 있어요. 위쪽 “로그인”으로 로그인하세요.';
  }

  // 여러 로그 번역(구조화 원본→재렌더→재저장). 한국어/역할제외 스킵. 원문 백업 restore() 반환.
  async function runTranslateFlow(logs: any[], char: string, opts: { excludeRole?: string; onStep?: (m: string) => void; force?: boolean; cacheOnly?: boolean; silent?: boolean } = {}): Promise<any | null> {
    const stylePrompt = getWorkPrompt(char);
    const excludeRole = opts.excludeRole || '';
    const slots = logs.map((r) => logTextSlots(r));
    const flat: string[] = []; const ref: [number, number][] = [];
    let roleSkipped = 0;
    slots.forEach((sl, li) => sl.texts.forEach((tx, si) => { if (excludeRole && sl.roles[si] === excludeRole) { roleSkipped++; return; } ref.push([li, si]); flat.push(tx); }));
    if (!flat.length) { if (!opts.silent) setStatus('번역할 내용이 없습니다.'); return null; }
    const step = opts.silent ? (() => {}) : (opts.onStep || ((m: string) => setStatus(m)));
    const backup = logs.map((r) => ({ r, input: r.input, html: r.html, chat: clonej(r.chat), diary: clonej(r.diary), webnovel: clonej(r.webnovel), cardCfg: clonej(r.cardCfg), userCardCss: r.userCardCss }));
    let res: any;
    try { res = await translateUnits(flat, stylePrompt, (d, t) => step(`번역 중… (${d}/${t})`), { force: !!opts.force, cacheOnly: !!opts.cacheOnly }); }
    catch (e: any) { if (!opts.silent) setStatus('번역 실패: ' + ((e && e.message) || '')); return null; }
    ref.forEach(([li, si], k) => { if (res.blocks[k] !== flat[k]) slots[li].set(si, res.blocks[k]); });
    let changedLogs = 0;
    for (let i = 0; i < logs.length; i++) {
      const r = logs[i];
      try {
        const nh = rerenderLog(r);
        if (nh !== r.html) {
          // ★비파괴: 번역 전 원문을 레코드 필드로 영속 스냅샷(구조화 텍스트만; html은 토글 때 rerenderLog로 재생성 → 용량·1MB 회피).
          if (!r.orig) { const b = backup[i]; r.orig = { input: b.input, chat: b.chat, diary: b.diary, webnovel: b.webnovel, cardCfg: b.cardCfg, userCardCss: b.userCardCss }; }
          r.html = nh; await logsAdd(r); changedLogs++;
        }
      } catch (_) {}
    }
    await reloadLogs();
    // ★명시적 갱신 보장: 클라우드 재읽기(logsAll)가 방금 쓴 변경을 아직 안 돌려줄 수 있어(stale) → 방금 갱신한
    //   레코드를 현재 allLogs에 직접 반영. 호출부 route()가 옛 본문을 렌더하지 않게(백그라운드 동기화 재렌더 스킵과 무관).
    { const cur = getAllLogs(); for (const r of logs) { const i = cur.findIndex((x: any) => x.id === r.id); if (i >= 0) cur[i] = r; } }
    let msg = `번역 완료 — ${res.translated}개 번역` + (res.skipped ? ` · 한국어 ${res.skipped}개 건너뜀` : '') + (roleSkipped ? ` · 역할제외 ${roleSkipped}개` : '');
    if (res.failed.length) msg += ` · 실패 ${res.failed.length}개(원문 유지)`;
    if (changedLogs) msg += ` · ${changedLogs}개 화 갱신`;
    if (!opts.silent) setStatus(msg);
    if (res.failed.length) console.warn('[번역 실패]', res.failed);
    const restore = async () => { for (const b of backup) { Object.assign(b.r, { input: b.input, html: b.html, chat: b.chat, diary: b.diary, webnovel: b.webnovel, cardCfg: b.cardCfg }); try { await logsAdd(b.r); } catch (_) {} } await reloadLogs(); };
    return { changedLogs, translated: res.translated, skipped: res.skipped, roleSkipped, failed: res.failed, restore };
  }
  // 여러 로그 정리(1차 결정론 + 선택 2차 cleanFn). 원문 백업 restore() 반환.
  async function runCleanFlow(logs: any[], char: string, opts: { onStep?: (m: string) => void; cleanFn?: any } = {}): Promise<any | null> {
    const slots = logs.map((r) => logTextSlots(r));
    const flat: string[] = []; const ref: [number, number][] = [];
    slots.forEach((sl, li) => sl.texts.forEach((tx, si) => { ref.push([li, si]); flat.push(tx); }));
    if (!flat.length) { setStatus('정리할 내용이 없습니다.'); return null; }
    const step = opts.onStep || ((m: string) => setStatus(m));
    const backup = logs.map((r) => ({ r, input: r.input, html: r.html, chat: clonej(r.chat), diary: clonej(r.diary), webnovel: clonej(r.webnovel), cardCfg: clonej(r.cardCfg) }));
    let res: any;
    try { res = await cleanUnits(flat, (d, t) => step(`정리 중… (${d}/${t})`), opts.cleanFn); }
    catch (e: any) { setStatus('정리 실패: ' + ((e && e.message) || '')); return null; }
    ref.forEach(([li, si], k) => { if (res.blocks[k] !== flat[k]) slots[li].set(si, res.blocks[k]); });
    let changedLogs = 0;
    for (const r of logs) { try { const nh = rerenderLog(r); if (nh !== r.html) { r.html = nh; await logsAdd(r); changedLogs++; } } catch (_) {} }
    await reloadLogs();
    { const cur = getAllLogs(); for (const r of logs) { const i = cur.findIndex((x: any) => x.id === r.id); if (i >= 0) cur[i] = r; } }   // 명시적 갱신: 방금 정리분을 allLogs에 직접 반영(stale 재읽기 방지)
    let msg = `정리 완료 — ${res.cleaned}개 정리`;
    if (res.failed.length) msg += ` · 실패 ${res.failed.length}개(원문 유지)`;
    if (changedLogs) msg += ` · ${changedLogs}개 화 갱신`;
    setStatus(msg);
    if (res.failed.length) console.warn('[정리 실패]', res.failed);
    const restore = async () => { for (const b of backup) { Object.assign(b.r, { input: b.input, html: b.html, chat: b.chat, diary: b.diary, webnovel: b.webnovel, cardCfg: b.cardCfg }); try { await logsAdd(b.r); } catch (_) {} } await reloadLogs(); };
    return { changedLogs, cleaned: res.cleaned, failed: res.failed, restore };
  }

  // ★파파 하이브리드 이미지 굳히기 — 외부(핫링크) <img>를 받아 data URL로 박제(저장 시 logsAdd가 블롭으로 dedup·동기화).
  //   성공=영구 박제 / 실패(CORS·차단·404)=원본 URL 그대로(하이브리드 — 강요 안 함). manual=사용자 버튼(메시지 더 자세히).
  async function hardenPapaInReader(r: any, manual: boolean): Promise<void> {
    if (!bakeAvailable()) { if (manual) setStatus('이 환경에선 이미지를 굳힐 수 없어요.'); return; }
    if (!externalCount(r.html || '')) { if (manual) setStatus('굳힐 외부 이미지가 없어요(이미 박제됨).'); return; }
    try {
      const res = await bakeLogs([r], (x: any) => logsAdd(x), (m: string) => setStatus(m));
      await reloadLogs();
      { const cur = getAllLogs(); const i = cur.findIndex((x: any) => x.id === r.id); if (i >= 0) cur[i] = r; }   // 방금 굳힌 본문을 allLogs에 직접 반영(stale 재읽기 방지 — 번역 흐름과 동일)
      if (res.bakedImgs) setStatus(`이미지 ${res.bakedImgs}장 굳힘(영구 박제)` + (res.failed.length ? ` · ${res.failed.length}장 안 굳음(원본 링크 유지)` : ''));
      else if (res.failed.length && manual) setStatus(`못 굳힌 이미지 ${res.failed.length}장 — 차단·죽은 링크일 수 있어요(원본 그대로 유지).`);
      route();   // 재렌더(굳힌 이미지는 이제 blob 백업 → 안 썩음)
    } catch (e: any) { if (manual) setStatus('굳히기 실패: ' + ((e && e.message) || '')); }
  }

  // 공유 팝오버(단일 화): 공개 읽기전용 링크 만들기/복사/해제. 로그인 필요.
  function toggleSharePop(reader: HTMLElement, r: any, btn: HTMLElement) {
    const exist = reader.querySelector('.share-pop') as HTMLElement | null;
    if (exist) { exist.remove(); return; }
    const pop = document.createElement('div'); pop.className = 'reader-settings share-pop'; reader.appendChild(pop);
    popAutoClose(pop, btn);
    const draw = () => {
      pop.innerHTML = '';
      pop.appendChild(mk('div', 'share-title', '공개 읽기전용 링크'));
      const av = shareAvailability();
      if (!av.ok) { pop.appendChild(mk('div', 'share-note', shareGateMessage(av.reason))); return; }
      // ★내 입력 가리기 — 공유본에서만 user 메시지 제거(★내 서재 로그는 불변). 마지막 선택 기억. 만들기·내용갱신 둘 다 적용.
      const hideWrap = document.createElement('label'); hideWrap.className = 'import-check'; (hideWrap as HTMLElement).style.margin = '0 0 8px';
      const hideChk = document.createElement('input'); hideChk.type = 'checkbox';
      try { hideChk.checked = localStorage.getItem('pro2-share-hideuser') === '1'; } catch (_) {}
      hideChk.onchange = () => { try { localStorage.setItem('pro2-share-hideuser', hideChk.checked ? '1' : '0'); } catch (_) {} };
      hideWrap.append(hideChk, document.createTextNode(' 내 입력 가리기 (공유본에서 내 메시지 빼기 — 내 서재는 그대로)'));
      pop.appendChild(hideWrap);
      const shareRec = async () => Object.assign({}, r, { html: await fattenShareHtml(r, hideChk.checked), hideUser: hideChk.checked });   // ★공유본은 이미지 임베드(받는 사람은 로컬 블롭 없음)
      if (r.shareId) {
        pop.appendChild(mk('div', 'share-note', '이 링크를 받은 사람은 로그인 없이 이 화를 볼 수 있습니다 (이미지 포함). 이미지는 공유용으로 축소된 화질입니다.'));
        const row = document.createElement('div'); row.className = 'share-link-row';
        const input = document.createElement('input'); input.type = 'text'; input.readOnly = true; input.className = 'share-link';
        loadShare().then((S) => { input.value = S.shareUrl(r.shareId); });
        input.onclick = () => input.select();
        const copyB = mk('button', 'primary', '링크 복사') as HTMLButtonElement;
        copyB.onclick = async () => { try { await navigator.clipboard.writeText(input.value); copyB.textContent = '복사됨!'; } catch (_) { input.select(); copyB.textContent = 'Ctrl+C'; } setTimeout(() => { copyB.textContent = '링크 복사'; }, 1400); };
        row.append(input, copyB); pop.appendChild(row);
        const acts = document.createElement('div'); acts.className = 'share-actions';
        const refreshB = mk('button', '', '내용 갱신') as HTMLButtonElement; refreshB.title = '편집 후 최신 내용으로 링크 갱신';
        refreshB.onclick = async () => { refreshB.disabled = true; refreshB.textContent = '갱신 중…'; try { const S = await loadShare(); await S.createShare(await shareRec(), r.shareId); setStatus('링크 내용을 갱신했습니다.'); } catch (e: any) { setStatus('갱신 실패: ' + ((e && e.message) || '')); } refreshB.disabled = false; refreshB.textContent = '내용 갱신'; };
        const unshareB = mk('button', 'series-del', '공유 해제') as HTMLButtonElement;
        unshareB.onclick = async () => { unshareB.disabled = true; try { const S = await loadShare(); await S.deleteShare(r.shareId); delete r.shareId; await logsAdd(r); btn.innerHTML = icon('link') + ' 공유'; setStatus('공유를 해제했습니다.'); draw(); } catch (e: any) { setStatus('해제 실패: ' + ((e && e.message) || '')); unshareB.disabled = false; } };
        acts.append(refreshB, unshareB); pop.appendChild(acts);
      } else {
        pop.appendChild(mk('div', 'share-note', '이 화를 누구나 볼 수 있는 링크로 공개합니다 (이미지 포함, 읽기전용). 공유 링크는 용량 한도 때문에 이미지가 자동 축소돼요 — 원본 화질은 서재에 그대로 남습니다.'));
        const makeB = mk('button', 'primary share-make') as HTMLButtonElement; makeB.innerHTML = icon('link') + ' 공개 링크 만들기';
        makeB.onclick = async () => {
          makeB.disabled = true; makeB.textContent = '만드는 중…';
          try {
            const S = await loadShare();
            const id = await S.createShare(await shareRec());
            r.shareId = id; await logsAdd(r); btn.innerHTML = icon('link') + ' 공유됨';
            try { await navigator.clipboard.writeText(S.shareUrl(id)); setStatus('공개 링크를 클립보드에 복사했습니다.'); } catch (_) { setStatus('공개 링크가 만들어졌습니다.'); }
            draw();
          } catch (e: any) { setStatus('링크 생성 실패: ' + ((e && e.message) || '')); makeB.disabled = false; makeB.innerHTML = icon('link') + ' 공개 링크 만들기'; }
        };
        pop.appendChild(makeB);
      }
    };
    draw();
  }

  // 번역 설정 팝오버(단일 화) — 번역 가능하면 ★항상 노출(번역 후에도 조정 가능). 공유/보기 팝오버와 같은 방식.
  //   작품 번역 지침(프롬프트) 인라인 편집 + 모델/키/파라미터 모달 연결 + "이 설정으로 (다시) 번역".
  function toggleTransSetPop(reader: HTMLElement, r: any, char: string, btn: HTMLElement) {
    const exist = reader.querySelector('.trset-pop') as HTMLElement | null;
    if (exist) { exist.remove(); return; }
    const pop = document.createElement('div'); pop.className = 'reader-settings trset-pop'; reader.appendChild(pop);
    popAutoClose(pop, btn);
    pop.appendChild(mk('div', 'share-title', '번역 설정'));
    pop.appendChild(mk('div', 'share-note', '이 작품의 번역 지침(문체)입니다. 고치면 저장돼 이 작품 번역에 쓰여요. 모델·키·생성 파라미터는 아래 “모델·키 설정”에서.'));
    const ta = document.createElement('textarea'); ta.className = 'tr-prompt'; ta.rows = 4; ta.value = getWorkPrompt(char);
    ta.onchange = () => { setWorkPrompt(char, ta.value); setStatus('이 작품 번역 지침을 저장했어요.'); };
    pop.appendChild(ta);
    const acts = document.createElement('div'); acts.className = 'share-actions';
    const modelB = mk('button', '', '모델·키 설정') as HTMLButtonElement;
    modelB.onclick = () => openTranslateSettings(setStatus);
    const runB = mk('button', 'primary', (r && r.orig) ? '이 설정으로 다시 번역' : '이 설정으로 번역') as HTMLButtonElement;
    runB.onclick = async () => {
      if (!(await ensureTranslateReady(setStatus))) return;
      setWorkPrompt(char, ta.value);   // 최신 프롬프트 반영 후 번역
      runB.disabled = true; runB.textContent = '번역 중…';
      if (r && r.orig) applyOrig(r);   // 원문에서 다시(원문 스냅샷은 보존)
      await runTranslateFlow([r], char, { force: !!(r && r.orig) });   // 다시 번역=캐시 무시(새로 갱신), 첫 번역=캐시 사용
      origView[r.id] = false;
      pop.remove();
      location.hash = '#/log/' + encodeURIComponent(char) + '/' + encodeURIComponent(r.id); route();
    };
    acts.append(modelB, runB); pop.appendChild(acts);
  }

  // 단일 화 열람(그 로그만). char·epId로 allLogs에서 찾아 렌더. prev/next·복사·공유·편집기로·번역·정리·삭제·몰입.
  async function renderSingleLog(char: string, epId: string) {
    const app = document.getElementById('app')!;
    const all = getAllLogs();
    const eps = sortEps(all.filter((r: any) => r.char === char));
    const idx = eps.findIndex((r: any) => r.id === epId);
    if (idx < 0) {
      // ★데이터 미로드(빈 allLogs)면 파괴적으로 작품 페이지로 튕기지 말 것 — 로딩 표시 후 다음 route()에서 재렌더.
      //   (로그 로드/클라우드 동기화가 끝나면 reader가 route()를 다시 부른다. 직접 진입·새로고침도 안전.)
      if (!all.length) {
        app.innerHTML = '';
        const reader = document.createElement('div'); reader.className = 'reader'; reader.dataset.theme = rdCfg().theme;
        const scroll = mk('div', 'reader-scroll'); const col = mk('div', 'reader-col');
        // 로딩이 (클라우드·로컬 모두) 실패했으면 무한 "불러오는 중" 대신 명확한 안내+새로고침 — 갇히지 않게.
        if (ctx.isLoadFailed && ctx.isLoadFailed()) {
          const card = mk('div', 'reader-card');
          card.appendChild(mk('div', '', '서재를 불러오지 못했어요. 다른 탭·창을 모두 닫고 새로고침해 주세요.'));
          const rb = document.createElement('button'); rb.className = 'reader-iconbtn'; rb.textContent = '새로고침'; rb.style.marginTop = '10px';
          rb.onclick = () => location.reload();
          card.appendChild(rb); col.appendChild(card);
        } else {
          col.appendChild(mk('div', 'reader-card', '불러오는 중…'));
        }
        scroll.appendChild(col); reader.appendChild(scroll); app.appendChild(reader);
        return;
      }
      location.hash = '#/series/' + encodeURIComponent(char); return;   // 로드됐는데 없음 = 진짜 없는 화 → 작품 페이지
    }
    const r = eps[idx];
    const papa = isPapa(r);   // ★파파모드 = 순수 통과 보관(번역·정리·역할 구조 없음). 리더는 충실 렌더(Shadow DOM)+스크롤만.
    // ★마른 레코드(rec.assetRefs=이름→해시): 이 화에 필요한 이미지만 IDB_BLOBS에서 지연 복원(name→dataURL). 옛 레코드(rec.assets base64)는 undefined → rerenderLog가 rec.assets로 하위호환.
    const amap: Record<string, string> | undefined = (r && r.assetRefs && typeof r.assetRefs === 'object') ? await resolveAssetRefs(r.assetRefs) : undefined;
    // ★작업 3: 번역된 적 있는 화(r.orig)인데 본문이 원문으로 되돌아가 있으면(왕복/동기화 잔여) 캐시에서 자동 복원 — 무료·키 불필요·진입당 1회.
    //   비파괴(원문 토글 유지) · 캐시 미스면 원문 유지(무해) · 진입=상단이라 스크롤 보존 회귀 없음.
    if (!papa && r && r.orig && !origView[r.id] && !r._trAuto && translateAvailable()) {
      r._trAuto = true;
      try {
        if (rerenderLog(origRecord(r)) === r.html) {   // 현재 본문 = 원문 렌더 = 번역이 되돌아감 → 캐시로 복원
          runTranslateFlow([r], char, { cacheOnly: true, silent: true })
            .then((res) => { if (res && res.changedLogs) { location.hash = '#/log/' + encodeURIComponent(char) + '/' + encodeURIComponent(r.id); route(); } })
            .catch(() => {});
        }
      } catch (_) {}
    }
    const rcfg = rdCfg();
    const wn = !papa && isWebnovel(r);
    const rd = loadRead(); rd.readIds[r.id] = true; rd.lastByChar[char] = r.id; rd.lastReadAt = rd.lastReadAt || {}; rd.lastReadAt[char] = Date.now(); saveRead(rd);
    app.innerHTML = '';
    const wnTh = (r.webnovel && r.webnovel.theme) || rcfg.wnTheme;
    const reader = document.createElement('div'); reader.className = 'reader' + (wn ? ' wn' : ''); reader.dataset.theme = wn ? wnTh : rcfg.theme;
    const bar = document.createElement('div'); bar.className = 'reader-bar';
    const back = document.createElement('button'); back.className = 'reader-back'; back.textContent = '← 작품'; back.onclick = () => { location.href = 'library.html#/series/' + encodeURIComponent(char); };
    const rtitle = document.createElement('div'); rtitle.className = 'reader-title'; rtitle.textContent = `${idx + 1}화 · ${r.title || ctx.nameOf(char)}`;
    const prevB = document.createElement('button'); prevB.className = 'reader-iconbtn'; prevB.textContent = '‹ 이전화'; prevB.disabled = idx === 0;
    prevB.onclick = () => { location.hash = '#/log/' + encodeURIComponent(char) + '/' + encodeURIComponent(eps[idx - 1].id); };
    const nextB = document.createElement('button'); nextB.className = 'reader-iconbtn'; nextB.textContent = '다음화 ›'; nextB.disabled = idx === eps.length - 1;
    nextB.onclick = () => { location.hash = '#/log/' + encodeURIComponent(char) + '/' + encodeURIComponent(eps[idx + 1].id); };
    const setBtn = document.createElement('button'); setBtn.className = 'reader-iconbtn'; setBtn.innerHTML = icon('sliders') + ' 보기';
    const cp = document.createElement('button'); cp.className = 'reader-iconbtn'; cp.innerHTML = icon('copy') + ' 복사'; cp.title = '리치 복사 — 아카 에디터에 붙여넣으면 이미지까지 올라감';
    cp.onclick = async () => { const o = cp.textContent; cp.textContent = '변환중…'; try { await richCopy(displayHtml, r.input || ''); cp.textContent = '복사됨!'; } catch (err: any) { cp.textContent = '실패'; setStatus('복사 오류: ' + ((err && err.message) || '')); } setTimeout(() => { cp.textContent = o; }, 1400); };   // ★표시본(이미지 임베드)으로 복사 — 마른 레코드는 r.html이 마커뿐이라 displayHtml 사용
    const shareB = document.createElement('button'); shareB.className = 'reader-iconbtn'; shareB.innerHTML = icon('link') + (r.shareId ? ' 공유됨' : ' 공유'); shareB.title = '공개 읽기전용 링크 — 받은 사람이 로그인 없이 이 화를 봄';
    shareB.onclick = () => toggleSharePop(reader, r, shareB);
    const editLog = document.createElement('button'); editLog.className = 'reader-iconbtn'; editLog.innerHTML = icon('pencil') + ' 편집기로'; editLog.title = '이 로그를 편집기에서 수정';
    editLog.onclick = () => { location.href = 'index.html?log=' + encodeURIComponent(r.id); };
    // 번역(비파괴): 원문 스냅샷(r.orig)이 있으면 "원문↔번역" 영속 토글 + 다시번역·번역지우기. 없으면 첫 번역 버튼.
    //   ★파파모드는 구조화 텍스트가 없어 번역·정리가 작동 안 함(사장님 확정) → 관련 버튼 전부 숨김.
    const hasOrig = !papa && !!(r && r.orig);
    let trB: HTMLButtonElement | null = null; let trClearB: HTMLButtonElement | null = null; let segWrap: HTMLElement | null = null;
    if (hasOrig) {
      segWrap = document.createElement('div'); segWrap.className = 'reader-seg';
      const tBtn = document.createElement('button'); tBtn.className = 'reader-iconbtn' + (origView[r.id] ? '' : ' on'); tBtn.textContent = '번역';
      const oBtn = document.createElement('button'); oBtn.className = 'reader-iconbtn' + (origView[r.id] ? ' on' : ''); oBtn.textContent = '원문';
      tBtn.title = '번역본 보기'; oBtn.title = '원문 보기 (저장된 원문 — 재번역·API 0, 유실 0)';
      tBtn.onclick = () => { if (origView[r.id]) { origView[r.id] = false; route(); } };
      oBtn.onclick = () => { if (!origView[r.id]) { origView[r.id] = true; route(); } };
      segWrap.append(tBtn, oBtn);
      if (translateAvailable()) {
        trB = document.createElement('button'); trB.className = 'reader-iconbtn'; trB.innerHTML = icon('language') + ' 다시 번역';
        trB.title = '원문에서 다시 번역해 번역본을 갱신합니다 (원문은 보존).';
        trB.onclick = async () => {
          if (!(await ensureTranslateReady(setStatus))) return;
          const o = trB!.innerHTML; trB!.disabled = true; trB!.textContent = '번역 중…';
          applyOrig(r);   // 원문에서 다시 시작(r.orig는 보존됨 → 번역이 다시 덮어씀)
          await runTranslateFlow([r], char, { force: true });   // "다시 번역" = 캐시 무시하고 새로(캐시도 갱신)
          origView[r.id] = false;
          trB!.disabled = false; trB!.innerHTML = o;
          location.hash = '#/log/' + encodeURIComponent(char) + '/' + encodeURIComponent(r.id); route();
        };
      }
      trClearB = document.createElement('button'); trClearB.className = 'reader-iconbtn'; trClearB.innerHTML = icon('undo') + ' 번역 지우기';
      trClearB.title = '번역을 버리고 원문만 남깁니다 (언제든 다시 번역 가능).';
      trClearB.onclick = async () => {
        if (!(await confirmModal('번역을 지우고 원문만 남길까요? (언제든 다시 번역할 수 있어요)', { okText: '번역 지우기' }))) return;
        applyOrig(r); r.html = rerenderLog(r); delete r.orig; delete origView[r.id];
        try { await logsAdd(r); } catch (_) {}
        await reloadLogs();
        location.hash = '#/log/' + encodeURIComponent(char) + '/' + encodeURIComponent(r.id); route(); setStatus('번역을 지우고 원문만 남겼어요.');
      };
    } else if (!papa && translateAvailable()) {
      trB = document.createElement('button'); trB.className = 'reader-iconbtn'; trB.innerHTML = icon('language') + ' 번역';
      trB.title = '이 화를 한국어로 번역(현재 작품 프롬프트·모델). 원문은 보존돼 언제든 “원문↔번역” 토글이 가능. 이미 한국어인 부분은 건너뜀.';
      trB.onclick = async () => {
        if (!(await ensureTranslateReady(setStatus))) return;
        const o = trB!.innerHTML; trB!.disabled = true; trB!.textContent = '번역 중…';
        await runTranslateFlow([r], char, {});
        origView[r.id] = false;   // 번역 후 기본=번역 보기(원문 토글로 전환 가능)
        trB!.disabled = false; trB!.innerHTML = o;
        location.hash = '#/log/' + encodeURIComponent(char) + '/' + encodeURIComponent(r.id); route();
      };
    }
    // ★번역 설정(⚙) — 번역 가능하면 항상(번역 전·후 무관). 작품 프롬프트·파라미터 조정 + 이 설정으로 번역. (파파는 제외)
    let trSetB: HTMLButtonElement | null = null;
    if (!papa && translateAvailable()) {
      trSetB = document.createElement('button'); trSetB.className = 'reader-iconbtn'; trSetB.innerHTML = icon('settings') + ' 번역 설정';
      trSetB.title = '번역 지침(작품 프롬프트)·모델·파라미터 조정 + 이 설정으로 번역';
      trSetB.onclick = () => toggleTransSetPop(reader, r, char, trSetB!);
    }
    let clB: HTMLButtonElement | null = null;
    if (!papa) {   // 파파는 정리(군더더기 제거)도 비적용 — 통째 보관이라 구조화 텍스트가 없음.
      clB = document.createElement('button'); clB.className = 'reader-iconbtn'; clB.innerHTML = icon('broom') + ' 정리';
      clB.title = '이 화의 군더더기(응답 헤더·생각의 사슬·OOC·화자 라벨 등)를 걷어내 본문만 남깁니다. 이미지·대사는 보존.';
      clB.onclick = async () => {
        const o = clB!.innerHTML; clB!.disabled = true; clB!.textContent = '정리 중…';
        const res = await runCleanFlow([r], char, {});
        if (res) cleanRestores[r.id] = res.restore;
        clB!.disabled = false; clB!.innerHTML = o;
        location.hash = '#/log/' + encodeURIComponent(char) + '/' + encodeURIComponent(r.id); route();
      };
    }
    let clUndoB: HTMLButtonElement | null = null;
    if (cleanRestores[r.id]) {
      clUndoB = document.createElement('button'); clUndoB.className = 'reader-iconbtn'; clUndoB.innerHTML = icon('undo') + ' 정리 취소';
      clUndoB.title = '이 화를 정리 전 원문으로 되돌립니다';
      clUndoB.onclick = async () => { const f = cleanRestores[r.id]; delete cleanRestores[r.id]; if (f) await f(); location.hash = '#/log/' + encodeURIComponent(char) + '/' + encodeURIComponent(r.id); route(); setStatus('정리 전 원문으로 되돌렸습니다.'); };
    }
    // ★파파 이미지 굳히기 버튼 — 외부(핫링크) 이미지가 남아 있을 때만 노출(=하이브리드 "안 굳음" 표시). 클릭=영구 박제 재시도.
    let bakeB: HTMLButtonElement | null = null;
    if (papa) {
      const ext = externalCount(r.html || '');
      if (ext && bakeAvailable()) {
        bakeB = document.createElement('button'); bakeB.className = 'reader-iconbtn'; bakeB.innerHTML = icon('flame') + ` 이미지 굳히기 (${ext})`;
        bakeB.title = '외부(핫링크) 이미지를 받아 영구 박제 — 원본 호스트가 죽어도 안 깨지게(안 받아지는 건 원본 링크 그대로 유지).';
        bakeB.onclick = async () => { const o = bakeB!.innerHTML; bakeB!.disabled = true; bakeB!.textContent = '굳히는 중…'; await hardenPapaInReader(r, true); };
      }
    }
    const delB = document.createElement('button'); delB.className = 'reader-iconbtn'; delB.innerHTML = icon('trash') + ' 삭제';
    delB.title = '이 화를 서재에서 삭제합니다 (되돌릴 수 없음)';
    delB.onclick = async () => {
      if (!(await confirmModal(`이 화(${idx + 1}화${r.title ? ' · ' + r.title : ''})를 삭제할까요? 되돌릴 수 없습니다.`, { okText: '삭제', danger: true }))) return;
      await logsDelete(r.id);
      const rd2 = loadRead(); delete rd2.readIds[r.id]; if (rd2.lastByChar && rd2.lastByChar[char] === r.id) delete rd2.lastByChar[char]; saveRead(rd2);
      await reloadLogs();
      const remain = getAllLogs().filter((x: any) => x.char === char).length;
      setStatus('화를 삭제했습니다.');
      if (remain) location.hash = '#/log/' + encodeURIComponent(char) + '/' + encodeURIComponent((sortEps(getAllLogs().filter((x: any) => x.char === char))[0] || {}).id || '');
      else location.href = 'library.html#/';
    };
    const helpB = document.createElement('button'); helpB.className = 'reader-iconbtn'; helpB.innerHTML = icon('help') + ' 도움말'; helpB.title = '사용설명서'; helpB.onclick = () => { location.href = 'help.html#reader'; };
    const actions = document.createElement('div'); actions.className = 'reader-actions';
    actions.append(cp, shareB, editLog, ...(bakeB ? [bakeB] : []), ...(clB ? [clB] : []), ...(clUndoB ? [clUndoB] : []), ...(trB ? [trB] : []), ...(trClearB ? [trClearB] : []), ...(trSetB ? [trSetB] : []), delB, helpB, setBtn);
    const moreB = document.createElement('button'); moreB.className = 'reader-iconbtn reader-more';
    moreB.innerHTML = icon('dots') + ' 더보기'; moreB.title = '더보기';
    moreB.onclick = (e) => { e.stopPropagation(); actions.classList.toggle('open'); };
    actions.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button')) actions.classList.remove('open'); });
    // ── 관리실 정리 규칙 비파괴 적용 + "정리/원본" 토글 (이 화를 실제로 바꾸는 규칙이 있을 때만 노출, 기본=정리됨) ──
    const showOrig = !!(hasOrig && origView[r.id]);
    const baseRec = showOrig ? origRecord(r) : r;
    // 표시용 본문: 마른 레코드는 amap(그 화 이미지)으로 임베드, 옛 레코드는 r.html 그대로(이미 임베드됨, amap=undefined → applyAssetMap 무동작).
    const baseHtml = showOrig ? rerenderLog(origRecord(r), amap) : applyAssetMap(r.html, amap, r.char);
    let displayHtml = baseHtml; let cleanSeg: HTMLElement | null = null;
    const cRules = papa ? [] : cleanupRules().concat(perLogCleanup(r));   // 관리실 글로벌 + per-log(가져온 챗 동봉) 정리 규칙 합성 (파파는 미적용)
    if (cRules.length && cleanupChanges(baseRec, cRules)) {
      const on = cleanView[r.id] !== false;
      displayHtml = on ? renderCleaned(baseRec, cRules, amap) : baseHtml;
      cleanSeg = document.createElement('div'); cleanSeg.className = 'reader-seg';
      const cOn = document.createElement('button'); cOn.className = 'reader-iconbtn' + (on ? ' on' : ''); cOn.textContent = '정리';
      const cOff = document.createElement('button'); cOff.className = 'reader-iconbtn' + (on ? '' : ' on'); cOff.textContent = '원본';
      cOn.title = '등록된 규칙으로 군더더기 숨김(비파괴 — 원본 로그·복사물 불변)'; cOff.title = '숨김 없이 원본 그대로';
      cOn.onclick = () => { if (cleanView[r.id] === false) { cleanView[r.id] = true; route(); } };
      cOff.onclick = () => { if (cleanView[r.id] !== false) { cleanView[r.id] = false; route(); } };
      cleanSeg.append(cOn, cOff);
    }
    // ★파파 보편 군더더기 토글(Phase 3·A안) — CoT/번역분석 접기가 있을 때만 노출. 기본=원본(opt-in, "그대로 삼키기" 철학). 비파괴(원본 불변).
    if (papa && papaCruftChanges(displayHtml)) {
      const cleaned = !!papaCleanView[r.id];   // 기본 false=원본
      if (cleaned) displayHtml = stripPapaCruft(displayHtml);
      cleanSeg = document.createElement('div'); cleanSeg.className = 'reader-seg';
      const cOn = document.createElement('button'); cOn.className = 'reader-iconbtn' + (cleaned ? ' on' : ''); cOn.textContent = '정리';
      const cOff = document.createElement('button'); cOff.className = 'reader-iconbtn' + (cleaned ? '' : ' on'); cOff.textContent = '원본';
      cOn.title = '사고과정(CoT)·번역분석 같은 접힌 군더더기를 숨깁니다 (비파괴 — 원본·복사물 불변).'; cOff.title = '숨김 없이 받은 그대로';
      cOn.onclick = () => { if (!papaCleanView[r.id]) { papaCleanView[r.id] = true; route(); } };
      cOff.onclick = () => { if (papaCleanView[r.id]) { papaCleanView[r.id] = false; route(); } };
      cleanSeg.append(cOn, cOff);
    }
    bar.append(back, rtitle, ...(segWrap ? [segWrap] : []), ...(cleanSeg ? [cleanSeg] : []), prevB, nextB, actions, moreB); reader.appendChild(bar);

    // 몰입 탭 토글·초기 상태·스크롤 리셋은 공용 mountReaderBody가 처리(일반·공유 리더 동일). 더보기 메뉴 닫힘도 거기서.
    // displayHtml = 원문/번역 토글(origView) + 정리/원본 토글(cleanView) 비파괴 합성(위에서 계산). ★저장은 안 바뀜.
    if (!papa) displayHtml = stripUnresolvedAssetImages(displayHtml);   // ★매핑 안 된 에셋명 <img>(AI가 지어낸 감정 등)는 표시에서 숨김 = 엑박 아이콘 방지. 파파는 남의 디자인 그대로(진짜 URL/data만) → 미적용
    mountReaderBody(reader, displayHtml, rcfg, wn, wnTh, setBtn, route, papa);
    // ★파파 = 받자마자(처음 볼 때) 자동 이미지 굳히기 시도 — 배경. 세션당 1회(죽은 링크 매번 두드리지 않게). 성공=blob 박제 후 재렌더, 실패=원본 유지("굳히기" 버튼으로 재시도).
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (papa && online && bakeAvailable() && externalCount(r.html || '') && !r._papaBakeTried) {
      r._papaBakeTried = true;
      hardenPapaInReader(r, false).catch(() => {});
    }
  }

  return { renderSingleLog, runTranslateFlow, runCleanFlow, cleanRestores };
}
