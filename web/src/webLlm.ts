// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/webLlm.ts — 웹(브라우저) 번역 어댑터(BYO-key). 데스크탑은 IPC(electron/llm.js), 웹은 이 모듈.
//
// provider 요청 로직은 데스크탑과 동일한 공유 모듈(core/translate/providers.js)을 쓰고,
// 실제 호출만 브라우저 fetch로 한다(provider별 CORS는 그 fetch에서 드러남 — 막히면 친절 안내).
// ★키는 이 브라우저에만 저장(localStorage 또는 세션-only sessionStorage) — Firebase 동기화 안 함.
// @ts-nocheck
import { providerDef, normParams, validate, buildRequest, parseResponse, requestWithRetry } from '../../core/translate/providers.js';

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
  return { provider: o.provider || 'gemini', model: o.model || '', baseUrl: o.baseUrl || '', apiKey: o.apiKey || '', params: normParams(o.params), thinking: o.thinking || 'off', sessionOnly: !!o.sessionOnly };
}
/** 키 없는 공개용(번역 바/모달 표시용). */
export function webPublicConfig(): any { const c = getWebConfig(); return { provider: c.provider, model: c.model, baseUrl: c.baseUrl, hasKey: !!c.apiKey, params: c.params, thinking: c.thinking, sessionOnly: c.sessionOnly }; }
export function setWebConfig(cfg: any): any {
  const cur = getWebConfig();
  const out = {
    provider: cfg.provider || cur.provider,
    model: cfg.model != null ? cfg.model : cur.model,
    baseUrl: cfg.baseUrl != null ? cfg.baseUrl : cur.baseUrl,
    apiKey: (cfg.apiKey != null && cfg.apiKey !== '') ? cfg.apiKey : cur.apiKey,   // 빈칸이면 기존 키 유지
    params: normParams(cfg.params != null ? cfg.params : cur.params),
    thinking: cfg.thinking != null ? cfg.thinking : cur.thinking,   // Gemini 추론 강도(off/low/medium/high)
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
  // ★스마트 재시도(공유): 429·5xx·타임아웃만 재시도, 치명(키·권한·모델없음·결제)은 즉시 명확 에러.
  //   웹은 fetch throw=대개 CORS(재시도 무의미) → retryNetwork:false로 즉시 안내.
  const body = await requestWithRetry(req, async (rq: any) => {
    let res: Response;
    try { res = await fetch(rq.url, { method: rq.method, headers: rq.headers, body: rq.body }); }
    catch (_) { throw new Error('브라우저에서 이 서비스에 직접 연결하지 못했어요(CORS일 수 있음). Gemini·Anthropic을 쓰거나 데스크탑 앱을 이용하세요.'); }
    // ★Retry-After(초 또는 날짜) → ms — 429 때 서버가 알려준 대기시간을 재시도가 존중.
    let retryAfterMs = 0;
    const ra = res.headers.get('retry-after');
    if (ra) { const s = +ra; retryAfterMs = isFinite(s) ? s * 1000 : Math.max(0, Date.parse(ra) - Date.now()); }
    return { status: res.status, bodyText: await res.text(), retryAfterMs };
  }, { retries: 2, retryNetwork: false });
  let json: any = null; try { json = JSON.parse(body); } catch (_) {}
  if (!json) throw new Error('응답 파싱 실패');
  return parseResponse(req.kind, json);
}
