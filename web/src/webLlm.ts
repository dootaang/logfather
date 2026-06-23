// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/webLlm.ts — 웹(브라우저) 번역 어댑터(BYO-key). 데스크탑은 IPC(electron/llm.js), 웹은 이 모듈.
//
// provider 요청 로직은 데스크탑과 동일한 공유 모듈(core/translate/providers.js)을 쓰고,
// 실제 호출만 브라우저 fetch로 한다(provider별 CORS는 그 fetch에서 드러남 — 막히면 친절 안내).
// ★키는 이 브라우저에만 저장(localStorage 또는 세션-only sessionStorage) — Firebase 동기화 안 함.
// @ts-nocheck
import { providerDef, normParams, validate, buildRequest, parseResponse } from '../../core/translate/providers.js';

const WEB_KEY = 'pro2-translate-config-web';   // backend 미경유 일반 storage = 동기화 안 함

// 세션-only면 sessionStorage(탭 닫으면 사라짐), 아니면 localStorage. 읽기는 세션 우선.
function readRaw(): any {
  try {
    const raw = sessionStorage.getItem(WEB_KEY) || localStorage.getItem(WEB_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) { return {}; }
}
export function getWebConfig(): any {
  const o = readRaw();
  return { provider: o.provider || 'gemini', model: o.model || '', baseUrl: o.baseUrl || '', apiKey: o.apiKey || '', params: normParams(o.params), sessionOnly: !!o.sessionOnly };
}
/** 키 없는 공개용(번역 바/모달 표시용). */
export function webPublicConfig(): any { const c = getWebConfig(); return { provider: c.provider, model: c.model, baseUrl: c.baseUrl, hasKey: !!c.apiKey, params: c.params, sessionOnly: c.sessionOnly }; }
export function setWebConfig(cfg: any): any {
  const cur = getWebConfig();
  const out = {
    provider: cfg.provider || cur.provider,
    model: cfg.model != null ? cfg.model : cur.model,
    baseUrl: cfg.baseUrl != null ? cfg.baseUrl : cur.baseUrl,
    apiKey: (cfg.apiKey != null && cfg.apiKey !== '') ? cfg.apiKey : cur.apiKey,   // 빈칸이면 기존 키 유지
    params: normParams(cfg.params != null ? cfg.params : cur.params),
    sessionOnly: cfg.sessionOnly != null ? !!cfg.sessionOnly : cur.sessionOnly,
  };
  try { localStorage.removeItem(WEB_KEY); sessionStorage.removeItem(WEB_KEY); } catch (_) {}   // 중복 방지(한 곳에만)
  try { (out.sessionOnly ? sessionStorage : localStorage).setItem(WEB_KEY, JSON.stringify(out)); } catch (_) {}
  return webPublicConfig();
}
export function clearWebConfig(): any { try { localStorage.removeItem(WEB_KEY); sessionStorage.removeItem(WEB_KEY); } catch (_) {} return webPublicConfig(); }

// 마스킹된 산문 1덩이 → 브라우저에서 직접 provider 호출. CORS 막히면 친절 안내(throw).
export async function webTranslate(payload: any): Promise<string> {
  const cfg = getWebConfig();
  const text = String((payload && payload.text) || '');
  if (!text.trim()) return text;
  validate(cfg);
  const req = buildRequest(cfg, { text, targetLang: (payload && payload.targetLang) || '한국어', stylePrompt: payload && payload.stylePrompt, task: payload && payload.task, combine: payload && payload.combine, maxResponse: payload && payload.maxResponse });
  let res: Response;
  try {
    res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  } catch (_) {
    // 브라우저 fetch가 throw = 대개 CORS/네트워크 차단(예: OpenAI는 브라우저 직접호출 차단).
    throw new Error('브라우저에서 이 서비스에 직접 연결하지 못했어요(CORS일 수 있음). Gemini·Anthropic을 쓰거나 데스크탑 앱을 이용하세요.');
  }
  const body = await res.text();
  let json: any = null; try { json = JSON.parse(body); } catch (_) {}
  if (!res.ok) { const m = json && json.error && (json.error.message || json.error); throw new Error(typeof m === 'string' ? m : ('HTTP ' + res.status)); }
  if (!json) throw new Error('응답 파싱 실패');
  return parseResponse(req.kind, json);
}
