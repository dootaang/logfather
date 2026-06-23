// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/translate.ts — 로그 번역(BYO-key) 연결부. ★웹·데스크탑 완전 동등(2026-06-20 결정 B).
//
// 코어(translateLog)가 마스킹/복원/한국어스킵/블록 오케스트레이션(순수)을 맡고, 실제 LLM 호출만 플랫폼별:
//   데스크탑 = window.desktop.llm*(IPC → electron/llm.js, safeStorage 키) · 웹 = webLlm(브라우저 fetch, localStorage 키).
// provider 요청 로직은 양쪽 공유(core/translate/providers.js). ★구조 보존은 코드(마스킹), 프롬프트는 문체만.
// ★자동 번역 없음 — 전부 명시적 버튼. 키는 어디서도 Firebase 동기화 안 함.
// @ts-nocheck
import { translateBlocks } from '../../core/translate/translateLog.js';
import { getWebConfig, webPublicConfig, setWebConfig, clearWebConfig, webTranslate } from './webLlm.js';
import { trcacheGet, trcachePut } from './store.js';   // 번역 캐시(로컬 — 같은 원문·프롬프트면 API 0)

const D = () => (window as any).desktop;
/** 데스크탑(IPC 어댑터)인가. 아니면 웹(브라우저 fetch). */
function isDesktopTr(): boolean { return !!(typeof window !== 'undefined' && (window as any).desktop && typeof (window as any).desktop.llmTranslate === 'function'); }
/** 번역 기능을 이 플랫폼에서 쓸 수 있나 — 이제 ★웹·데스크탑 모두 가능(BYO-key). 키는 사용 시점에 확인. */
export function translateAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return isDesktopTr() || typeof fetch === 'function';   // 데스크탑 OR 브라우저면 true
}

// ── 설정/번역 플랫폼 디스패치(데스크탑=IPC·safeStorage / 웹=localStorage·브라우저 fetch) ──
async function cfgGet(): Promise<any> { return isDesktopTr() ? await D().llmGetConfig() : webPublicConfig(); }
async function cfgSet(payload: any): Promise<any> { return isDesktopTr() ? await D().llmSetConfig(payload) : setWebConfig(payload); }
async function cfgClear(): Promise<any> { return isDesktopTr() ? await D().llmClearConfig() : clearWebConfig(); }
// LLM 1덩이 호출 디스패치(데스크탑 IPC / 웹 fetch). payload.task='clean'이면 정리, 없으면 번역. cleanup.ts도 재사용.
export async function doLlm(payload: any): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (isDesktopTr()) return await D().llmTranslate(payload);
  try { return { ok: true, text: await webTranslate(payload) }; }
  catch (e: any) { return { ok: false, error: (e && e.message) || '요청 실패' }; }
}
const doTranslate = doLlm;

/** 키/설정이 준비됐는지 확인 — 아니면 설정 모달을 연다. 준비됐으면 true. (웹·데스크탑 공통) */
export async function ensureTranslateReady(setStatus: (m: string) => void): Promise<boolean> {
  const cfg = await cfgGet();
  const noKeyProviders = ['custom'];   // 키 없어도 되는 provider(커스텀 엔드포인트)
  if (cfg.hasKey || noKeyProviders.indexOf(cfg.provider) >= 0) return true;
  setStatus('먼저 번역 설정에서 모델·API 키를 입력하세요.');
  openTranslateSettings(setStatus);
  return false;
}

// ── 번역 프롬프트 = 로컬 저장(동기화 금지). 모델/키는 전역(메인 프로세스). ──
// 우선순위: 작품별 프롬프트 > (C2)선택 프리셋 > 편집 가능한 기본 프롬프트 > 하드코딩 폴백.
export const DEFAULT_TR_PROMPT = '자연스럽고 매끄러운 한국어로 번역하세요. 등장인물의 말투와 성격을 살리고, 이름·호칭 표기는 작품 내내 일관되게 유지하세요.';
const PROMPTS_KEY = 'pro2-translate-prompts';   // { [char]: 프롬프트 } — 일반 localStorage(backend 미경유=동기화 안 함)
const DEFAULT_PROMPT_KEY = 'pro2-translate-default-prompt';   // 사용자 편집 기본 프롬프트(하드코딩 대체)
export function getDefaultPrompt(): string {
  try { const v = localStorage.getItem(DEFAULT_PROMPT_KEY); return (typeof v === 'string' && v.trim()) ? v : DEFAULT_TR_PROMPT; } catch (_) { return DEFAULT_TR_PROMPT; }
}
export function setDefaultPrompt(text: string): void {
  try { if (text && text.trim() && text.trim() !== DEFAULT_TR_PROMPT) localStorage.setItem(DEFAULT_PROMPT_KEY, text); else localStorage.removeItem(DEFAULT_PROMPT_KEY); } catch (_) {}
}
export function getWorkPrompt(char: string): string {
  try { const o = JSON.parse(localStorage.getItem(PROMPTS_KEY) || '{}'); if (o && typeof o[char] === 'string' && o[char].trim()) return o[char]; } catch (_) {}
  return getActivePrompt();   // 작품 프롬프트 없으면 선택 프리셋 > 기본
}
export function setWorkPrompt(char: string, text: string): void {
  try { const o = JSON.parse(localStorage.getItem(PROMPTS_KEY) || '{}'); o[char] = text; localStorage.setItem(PROMPTS_KEY, JSON.stringify(o)); } catch (_) {}
}

// ── 명명 프롬프트 프리셋(RisuAI식) = 로컬 저장(키와 분리, 동기화 안 함). { list:[{name,prompt,maxResponse?}], active } ──
export interface TrPreset { name: string; prompt: string; maxResponse?: number; }
const PRESETS_KEY = 'pro2-translate-presets';
export function getPresets(): { list: TrPreset[]; active: string } {
  try { const o = JSON.parse(localStorage.getItem(PRESETS_KEY) || 'null'); if (o && Array.isArray(o.list) && o.list.length) return { list: o.list, active: typeof o.active === 'string' ? o.active : o.list[0].name }; } catch (_) {}
  return { list: [{ name: '기본', prompt: getDefaultPrompt() }], active: '기본' };   // 기본 프리셋 1개 폴백
}
export function savePresets(obj: { list: TrPreset[]; active: string }): void {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify({ list: obj.list, active: obj.active })); } catch (_) {}
}
export function getActivePreset(): TrPreset { const p = getPresets(); return p.list.find((x) => x.name === p.active) || p.list[0]; }
// 선택 프리셋의 프롬프트(없으면 편집 기본 프롬프트). 우선순위: 작품 > 프리셋 > 기본.
export function getActivePrompt(): string { const a = getActivePreset(); return (a && a.prompt && a.prompt.trim()) ? a.prompt : getDefaultPrompt(); }
export function getActiveMaxResponse(): number | undefined { const a = getActivePreset(); return a && a.maxResponse != null ? a.maxResponse : undefined; }
// 프리셋 파일 직렬화 — ★키 미포함(프롬프트·maxResponse만).
export function exportPresets(): string { const p = getPresets(); return JSON.stringify({ app: 'log-jejogi-pro2', kind: 'translate-presets', list: p.list.map((x) => ({ name: x.name, prompt: x.prompt, ...(x.maxResponse != null ? { maxResponse: x.maxResponse } : {}) })) }, null, 2); }
export function importPresets(text: string): number {
  let obj: any; try { obj = JSON.parse(text); } catch (_) { throw new Error('JSON 파싱 실패'); }
  const incoming: any[] = Array.isArray(obj) ? obj : (obj && Array.isArray(obj.list) ? obj.list : null);
  if (!incoming) throw new Error('프리셋 파일이 아닙니다(list 없음).');
  const cur = getPresets(); const byName: Record<string, TrPreset> = {}; for (const p of cur.list) byName[p.name] = p;
  let n = 0;
  for (const it of incoming) {
    if (!it || typeof it.name !== 'string' || typeof it.prompt !== 'string') continue;
    const name = it.name.slice(0, 80).trim(); if (!name) continue;
    byName[name] = { name, prompt: String(it.prompt).slice(0, 8000), ...(Number.isFinite(+it.maxResponse) ? { maxResponse: +it.maxResponse } : {}) };   // ★키 같은 잡필드 무시
    n++;
  }
  const list = Object.values(byName);
  savePresets({ list, active: cur.active && byName[cur.active] ? cur.active : list[0].name });
  return n;
}

// 마스킹된 산문 1덩이 → 플랫폼 번역(작품 문체 프롬프트 동반). 실패는 throw(코어가 블록 단위 격리).
function makeRawTranslate(stylePrompt: string) {
  // ctx.combine(결합 배치)·ctx.maxResponse(응답 토큰)를 어댑터→providers로 전달. 결합이면 시스템 프롬프트에 구분자 규칙 추가.
  return async (masked: string, ctx?: any) => {
    const r = await doTranslate({ text: masked, targetLang: '한국어', stylePrompt, combine: !!(ctx && ctx.combine), maxResponse: ctx && ctx.maxResponse });
    if (!r || !r.ok) throw new Error((r && r.error) || '번역 실패');
    return r.text;
  };
}

// ── 결합 번역 토글(로컬 저장·동기화 안 함, 기본 켬). 여러 블록 한 요청 = 문맥 공유·비용 절감. ──
const COMBINE_KEY = 'pro2-translate-combine';
export function getCombineOn(): boolean { try { const v = localStorage.getItem(COMBINE_KEY); return v === null ? true : v === '1'; } catch (_) { return true; } }
export function setCombineOn(on: boolean): void { try { localStorage.setItem(COMBINE_KEY, on ? '1' : '0'); } catch (_) {} }

export interface UnitsResult { blocks: string[]; translated: number; skipped: number; failed: { index: number; error: string }[]; }
// 번역 캐시 키: 정규화 원문 + 대상언어 + 프롬프트 해시(FNV-1a). 프롬프트 바뀌면 미스=새 문체 재번역, 같으면 히트=공짜.
function fnv(s: string): string { let h = 0x811c9dc5; s = String(s || ''); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); }
function trKey(unit: string, target: string, promptHash: string): string { return String(unit == null ? '' : unit).replace(/\r\n/g, '\n').trim() + '␟' + target + '␟' + promptHash; }
// 텍스트 단위 배열을 한국어로 번역(이미 한국어면 스킵). 마크업 보존·진행률·부분 실패 격리는 코어가 담당.
// ★로컬 캐시: 같은 원문+같은 프롬프트면 API 호출 0(히트) — 재푸시·삭제후재임포트·유실복구에서 공짜. opts.force=캐시 무시·갱신("다시 번역").
// 결합 번역(기본 켬): 미스만 코어 translateBlocks로(토큰 예산 배치 → 헛짓하면 그 배치만 순차 폴백). 성공·실제 번역분만 캐시 기록.
export async function translateUnits(units: string[], stylePrompt: string, onProgress?: (d: number, t: number) => void, opts?: { force?: boolean }): Promise<UnitsResult> {
  const force = !!(opts && opts.force);
  const TARGET = '한국어';
  const ph = fnv(stylePrompt);
  const keys = units.map((u) => trKey(u, TARGET, ph));
  let hits: (string | null)[] = new Array(units.length).fill(null);
  if (!force) { try { hits = await trcacheGet(keys); } catch (_) {} }
  const out = units.slice();
  let cachedCount = 0; const missIdx: number[] = [];
  for (let i = 0; i < units.length; i++) { if (hits[i] != null) { out[i] = hits[i] as string; cachedCount++; } else missIdx.push(i); }
  let translated = 0, skipped = 0; const failed: { index: number; error: string }[] = [];
  if (missIdx.length) {
    const missUnits = missIdx.map((i) => units[i]);
    const res = await translateBlocks(missUnits, makeRawTranslate(stylePrompt), { skipKorean: true, onProgress, combine: getCombineOn(), maxResponse: getActiveMaxResponse() });
    translated = res.translated; skipped = res.skipped;
    const failedK = new Set(res.failed.map((f: any) => f.index));
    res.failed.forEach((f: any) => failed.push({ index: missIdx[f.index], error: f.error }));
    const toCache: { k: string; v: string }[] = [];
    missIdx.forEach((origI, k) => { out[origI] = res.blocks[k]; if (!failedK.has(k) && res.blocks[k] !== units[origI]) toCache.push({ k: keys[origI], v: res.blocks[k] }); });   // 실제 번역분만 캐시(한국어스킵·실패·미변경 제외)
    if (toCache.length) { try { await trcachePut(toCache); } catch (_) {} }
  }
  return { blocks: out, translated: translated + cachedCount, skipped, failed };
}

export interface TranslateResult { restore: () => void; translated: number; skipped: number; failed: number; }
// 에디터 입력칸/블록들을 문단 단위로 번역(원문 백업→되돌리기). 기존 oninput 재사용(렌더·저장).
export async function translateEditors(targets: HTMLTextAreaElement[], setStatus: (m: string) => void): Promise<TranslateResult | null> {
  const parts = targets.map((ta) => ta.value.split(/(\n[ \t]*\n)/));   // 홀수 인덱스 = 문단 구분자(보존)
  const segs: [number, number][] = [];
  const flat: string[] = [];
  parts.forEach((ps, ti) => ps.forEach((p, pi) => { if (pi % 2 === 0 && p.trim()) { segs.push([ti, pi]); flat.push(p); } }));
  if (!flat.length) { setStatus('번역할 내용이 없습니다.'); return null; }
  const backup = targets.map((ta) => ({ ta, value: ta.value }));
  const res = await translateUnits(flat, getActivePrompt(), (d, t) => setStatus(`번역 중… (${d}/${t} 문단)`));
  segs.forEach(([ti, pi], k) => { parts[ti][pi] = res.blocks[k]; });
  targets.forEach((ta, ti) => { ta.value = parts[ti].join(''); ta.dispatchEvent(new Event('input', { bubbles: true })); });
  return {
    translated: res.translated, skipped: res.skipped, failed: res.failed.length,
    restore: () => { backup.forEach((b) => { b.ta.value = b.value; b.ta.dispatchEvent(new Event('input', { bubbles: true })); }); },
  };
}

// ── 번역 설정 모달(전역 모델/키 — 로컬 저장, 동기화 금지) ─────────────
// value, 표시명, 모델 placeholder, 키 필요, 서버주소칸 노출
// web: 브라우저에서 쓸 수 있나(전부 클라우드라 web:true — 로컬 localhost provider는 제거함).
const PROVIDERS: { v: string; t: string; mh: string; key: boolean; base: boolean; baseHint?: string; web: boolean }[] = [
  { v: 'gemini',       t: 'Gemini (Google)',             mh: '예: gemini-2.0-flash', key: true,  base: false, web: true },
  { v: 'openai',       t: 'OpenAI',                      mh: '예: gpt-4o-mini',       key: true,  base: false, web: true },
  { v: 'anthropic',    t: 'Anthropic (Claude)',          mh: '예: claude-3-5-haiku-latest', key: true, base: false, web: true },
  { v: 'ollama-turbo', t: 'Ollama Turbo — 클라우드(유료)', mh: '예: gpt-oss:120b',      key: true,  base: false, web: true },
  { v: 'custom',       t: '커스텀 (OpenAI 호환)',         mh: '모델명 입력',            key: true,  base: true, baseHint: '예: https://내서버/v1', web: true },
];

// 생성 파라미터 입력 정의(전 provider 공통, 사용자 조절). top_k는 Anthropic 전용.
const PARAM_FIELDS: { k: string; label: string; min: number; max: number; step: number; only?: string }[] = [
  { k: 'temperature', label: 'temperature (창의성)', min: 0, max: 2, step: 0.05 },
  { k: 'top_p', label: 'top_p', min: 0, max: 1, step: 0.05 },
  { k: 'max_tokens', label: 'max_tokens (응답 길이)', min: 0, max: 200000, step: 64 },
  { k: 'frequency_penalty', label: 'frequency_penalty', min: -2, max: 2, step: 0.1 },
  { k: 'presence_penalty', label: 'presence_penalty', min: -2, max: 2, step: 0.1 },
  { k: 'top_k', label: 'top_k (Anthropic 전용)', min: 0, max: 500, step: 1, only: 'anthropic' },
];

// 작은 DOM 텍스트 입력 모달(★Electron은 window.prompt 미지원 → 직접 구현).
function textPrompt(title: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    const ov = document.createElement('div'); ov.className = 'import-modal'; ov.style.zIndex = '100';
    const card = document.createElement('div'); card.className = 'import-card'; card.style.maxWidth = '360px';
    card.appendChild(Object.assign(document.createElement('div'), { className: 'import-title', textContent: title }));
    const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'auth-input'; inp.value = initial || ''; card.appendChild(inp);
    const btns = document.createElement('div'); btns.className = 'import-btns';
    const ok = Object.assign(document.createElement('button'), { className: 'primary', textContent: '확인' });
    const cancel = Object.assign(document.createElement('button'), { textContent: '취소' });
    const done = (v: string | null) => { ov.remove(); resolve(v); };
    ok.onclick = () => done(inp.value); cancel.onclick = () => done(null);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(inp.value); } else if (e.key === 'Escape') done(null); });
    btns.append(ok, cancel); card.appendChild(btns); ov.appendChild(card); document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov) done(null); });
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
  });
}

let modalEl: HTMLElement | null = null;
export async function openTranslateSettings(setStatus: (m: string) => void): Promise<void> {
  if (modalEl) { modalEl.remove(); modalEl = null; }
  const web = !isDesktopTr();
  const cfg = await cfgGet();
  const list = web ? PROVIDERS.filter((p) => p.web) : PROVIDERS;   // 웹은 web:true만(현재 전부 클라우드 → 동일. 비-web provider 추가 대비 가드 유지)
  const ov = document.createElement('div'); ov.className = 'import-modal'; modalEl = ov;
  const card = document.createElement('div'); card.className = 'import-card';
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-title', textContent: 'AI 모델·키 (번역·정리 공용)' }));
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-info',
    textContent: web
      ? '번역·정밀 정리에 쓰는 AI 모델·키입니다. 키는 이 브라우저에만 저장돼요(아래 경고 참고).'
      : '번역·정밀 정리에 쓰는 AI 모델·키입니다. 키는 암호화돼 이 컴퓨터에만 저장됩니다(클라우드 동기화 안 함).' }));
  // ★웹 보안 경고: 키가 브라우저에 저장됨(공용 PC·XSS 주의) + 세션-only 옵션.
  let sessionCb: HTMLInputElement | null = null;
  if (web) {
    const warn = Object.assign(document.createElement('div'), { className: 'tr-web-warn' });
    warn.innerHTML = '⚠️ 키는 <b>이 브라우저</b>에만 저장됩니다(클라우드 동기화 안 함). 공용 PC에선 키를 넣지 마세요. 가능하면 사용량·도메인 제한을 건 키를 쓰고, 아래 “세션에만 저장”을 켜면 탭을 닫을 때 키가 지워집니다.';
    card.appendChild(warn);
  }
  const row = (label: string, el: HTMLElement) => { const r = document.createElement('label'); r.className = 'import-row'; r.append(Object.assign(document.createElement('span'), { textContent: label }), el); card.appendChild(r); return r; };

  const prov = document.createElement('select');
  list.forEach((p) => { const o = document.createElement('option'); o.value = p.v; o.textContent = p.t; prov.appendChild(o); });
  prov.value = list.some((p) => p.v === cfg.provider) ? cfg.provider : 'gemini'; row('번역 서비스', prov);

  const model = document.createElement('input'); model.type = 'text'; model.value = cfg.model || ''; row('모델', model);
  const base = document.createElement('input'); base.type = 'text'; base.value = cfg.baseUrl || ''; const baseRow = row('서버 주소', base);
  const key = document.createElement('input'); key.type = 'password'; const keyRow = row('API 키', key);
  if (web) {   // 세션-only 저장(탭 닫으면 키 삭제)
    const sw = document.createElement('label'); sw.className = 'import-check';
    sessionCb = document.createElement('input'); sessionCb.type = 'checkbox'; sessionCb.checked = !!cfg.sessionOnly;
    sw.append(sessionCb, document.createTextNode(' 세션에만 저장 (탭 닫으면 키 삭제)'));
    card.appendChild(sw);
  }

  // ── 생성 파라미터(전 provider 공통, 로컬 저장) ──
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-info', textContent: '생성 파라미터 (기본값 권장 — 필요할 때만 조절)' }));
  const pgrid = document.createElement('div'); pgrid.className = 'tr-param-grid'; card.appendChild(pgrid);
  const curParams = (cfg.params || {});
  const paramInputs: Record<string, HTMLInputElement> = {};
  const paramRows: Record<string, HTMLElement> = {};
  for (const f of PARAM_FIELDS) {
    const r = document.createElement('label'); r.className = 'tr-param';
    r.append(Object.assign(document.createElement('span'), { textContent: f.label }));
    const inp = document.createElement('input'); inp.type = 'number'; inp.min = String(f.min); inp.max = String(f.max); inp.step = String(f.step);
    inp.value = String(curParams[f.k] != null ? curParams[f.k] : '');
    r.appendChild(inp); pgrid.appendChild(r);
    paramInputs[f.k] = inp; paramRows[f.k] = r;
  }

  // ── 번역 프롬프트 프리셋(문체 지시, 명명) — 작품별 프롬프트가 있으면 그쪽이 우선. ──
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-info', textContent: '번역 프롬프트 프리셋 (문체·톤 지시 — 이미지·대사 구조는 코드가 보존). 작품별 프롬프트가 있으면 그쪽이 우선합니다.' }));
  let presetState = getPresets();
  const presetSel = document.createElement('select'); presetSel.className = 'tr-preset-sel';
  const promptTa = document.createElement('textarea'); promptTa.className = 'tr-prompt'; promptTa.rows = 3; promptTa.placeholder = DEFAULT_TR_PROMPT;
  const fillPresetSel = () => { presetSel.innerHTML = ''; for (const p of presetState.list) { const o = document.createElement('option'); o.value = p.name; o.textContent = p.name; presetSel.appendChild(o); } presetSel.value = presetState.active; };
  const loadActiveIntoTa = () => { const a = presetState.list.find((x) => x.name === presetState.active) || presetState.list[0]; promptTa.value = a ? a.prompt : ''; };
  const writeTaToActive = () => { const a = presetState.list.find((x) => x.name === presetState.active); if (a) a.prompt = promptTa.value; };
  fillPresetSel(); loadActiveIntoTa();
  presetSel.onchange = () => { writeTaToActive(); presetState.active = presetSel.value; loadActiveIntoTa(); };
  const pRow = document.createElement('div'); pRow.className = 'tr-preset-row';
  const newB = Object.assign(document.createElement('button'), { type: 'button', textContent: '+ 새 프리셋' });
  const renB = Object.assign(document.createElement('button'), { type: 'button', textContent: '이름변경' });
  const delB = Object.assign(document.createElement('button'), { type: 'button', textContent: '삭제' });
  newB.onclick = async () => { writeTaToActive(); const nm = ((await textPrompt('새 프리셋 이름', '내 프리셋')) || '').trim(); if (!nm) return; if (presetState.list.some((x) => x.name === nm)) { setStatus('같은 이름의 프리셋이 있습니다.'); return; } presetState.list.push({ name: nm, prompt: promptTa.value || DEFAULT_TR_PROMPT }); presetState.active = nm; fillPresetSel(); loadActiveIntoTa(); };
  renB.onclick = async () => { const a = presetState.list.find((x) => x.name === presetState.active); if (!a) return; const nm = ((await textPrompt('프리셋 이름 변경', a.name)) || '').trim(); if (!nm || nm === a.name) return; if (presetState.list.some((x) => x.name === nm)) { setStatus('같은 이름의 프리셋이 있습니다.'); return; } a.name = nm; presetState.active = nm; fillPresetSel(); };
  delB.onclick = () => { if (presetState.list.length <= 1) { setStatus('프리셋이 하나뿐이라 삭제할 수 없어요.'); return; } presetState.list = presetState.list.filter((x) => x.name !== presetState.active); presetState.active = presetState.list[0].name; fillPresetSel(); loadActiveIntoTa(); };
  pRow.append(presetSel, newB, renB, delB); card.appendChild(pRow); card.appendChild(promptTa);
  // 내보내기/가져오기 (★키 미포함 — 프롬프트만)
  const ioRow = document.createElement('div'); ioRow.className = 'tr-preset-row';
  const expB = Object.assign(document.createElement('button'), { type: 'button', textContent: '프리셋 내보내기' });
  const impB = Object.assign(document.createElement('button'), { type: 'button', textContent: '가져오기' });
  const impFile = document.createElement('input'); impFile.type = 'file'; impFile.accept = '.json,application/json'; impFile.style.display = 'none';
  expB.onclick = () => { writeTaToActive(); savePresets(presetState); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([exportPresets()], { type: 'application/json' })); a.download = 'translate-presets.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  impB.onclick = () => impFile.click();
  impFile.onchange = async () => { const f = impFile.files && impFile.files[0]; impFile.value = ''; if (!f) return; try { const n = importPresets(await f.text()); presetState = getPresets(); fillPresetSel(); loadActiveIntoTa(); setStatus(`프리셋 ${n}개 가져옴 (키는 포함되지 않습니다).`); } catch (e: any) { setStatus('가져오기 실패: ' + ((e && e.message) || '')); } };
  ioRow.append(expB, impB); card.append(ioRow, impFile);
  // 결합 번역 토글(여러 블록 한 번에 — 문맥·비용 절약). 로컬 저장, 기본 켬. 모델이 헛짓하면 코어가 그 배치만 순차 폴백.
  const combineWrap = document.createElement('label'); combineWrap.className = 'import-check';
  const combineCb = document.createElement('input'); combineCb.type = 'checkbox'; combineCb.checked = getCombineOn();
  combineWrap.append(combineCb, document.createTextNode(' 결합 번역 (여러 블록 한 번에 — 문맥·비용 절약, 권장)'));
  card.appendChild(combineWrap);

  const syncByProvider = () => {
    const def = (PROVIDERS.find((p) => p.v === prov.value) || PROVIDERS[0])!;
    model.placeholder = def.mh;
    keyRow.style.display = def.key ? '' : 'none';
    baseRow.style.display = def.base ? '' : 'none';
    base.placeholder = def.baseHint || '비우면 기본값';
    key.placeholder = cfg.hasKey ? '저장됨 — 바꿀 때만 입력' : 'API 키 입력';
    for (const f of PARAM_FIELDS) if (f.only) paramRows[f.k].style.display = (prov.value === f.only) ? '' : 'none';   // top_k는 Anthropic만
  };
  prov.onchange = syncByProvider; syncByProvider();

  const btns = document.createElement('div'); btns.className = 'import-btns';
  const save = Object.assign(document.createElement('button'), { className: 'primary', textContent: '저장' });
  const clear = Object.assign(document.createElement('button'), { textContent: '키 삭제' });
  const cancel = Object.assign(document.createElement('button'), { textContent: '닫기' });
  const close = () => { ov.remove(); modalEl = null; };
  cancel.onclick = close;
  clear.onclick = async () => { await cfgClear(); setStatus('번역 설정·키를 삭제했습니다.'); close(); };
  save.onclick = async () => {
    const params: any = {};
    for (const f of PARAM_FIELDS) { const v = paramInputs[f.k].value.trim(); if (v !== '') params[f.k] = Number(v); }
    const payload: any = { provider: prov.value, model: model.value.trim(), baseUrl: base.value.trim(), params };
    if (key.value) payload.apiKey = key.value;   // 입력했을 때만 키 교체(빈 칸이면 기존 유지)
    if (sessionCb) payload.sessionOnly = sessionCb.checked;   // 웹: 세션-only 저장
    writeTaToActive(); savePresets(presetState);   // 선택 프리셋에 프롬프트 저장(로컬, 동기화 안 함)
    setDefaultPrompt(promptTa.value);   // 폴백 기본 프롬프트도 동기화(프리셋 비었을 때 대비)
    setCombineOn(combineCb.checked);   // 결합 번역 토글(로컬)
    save.disabled = true;
    try { const pub = await cfgSet(payload); setStatus(`번역 설정 저장됨 (${pub.provider}${pub.hasKey ? ', 키 설정됨' : ''}).`); close(); }
    catch (e: any) { setStatus('저장 실패: ' + ((e && e.message) || '')); save.disabled = false; }
  };
  btns.append(save, clear, cancel); card.appendChild(btns);
  ov.appendChild(card); document.body.appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
}
