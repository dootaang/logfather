// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/translate/providers.test.js — 공유 provider 요청 빌더 검증(웹·데스크탑 1벌 공유).
// 실행: node core/translate/providers.test.js
'use strict';
const { PROVIDERS, providerDef, normParams, buildRequest, parseResponse, validate, sysPrompt, cleanSysPrompt, requestWithRetry, isTransientStatus, errorText } = require('./providers.js');

let failed = 0;
const check = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { failed++; console.error('  ✗ ' + msg); } };

// 1) OpenAI 호환 요청: /chat/completions, Bearer 키, system+user 메시지, 파라미터 반영.
{
  const cfg = { provider: 'gemini', model: '', apiKey: 'k1', baseUrl: '', params: { temperature: 0.7 } };
  const req = buildRequest(cfg, { text: 'hello', targetLang: '한국어', stylePrompt: '존댓말' });
  check(req.kind === 'openai', 'gemini=openai kind');
  check(req.url === 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'gemini 기본 endpoint');
  check(req.headers.Authorization === 'Bearer k1', 'Bearer 키 헤더');
  const body = JSON.parse(req.body);
  check(body.model === 'gemini-2.0-flash', '기본 모델 채움');
  check(body.messages[0].role === 'system' && /존댓말/.test(body.messages[0].content), 'system에 문체 프롬프트');
  check(body.messages[1].content === 'hello', 'user=원문');
  check(body.temperature === 0.7, 'temperature 반영');
  check(/⟦0⟧/.test(sysPrompt('한국어')) || /placeholder/.test(sysPrompt('한국어')), 'sysPrompt에 placeholder 보존 지시');
}

// 2) Anthropic 요청: /v1/messages, x-api-key, max_tokens 필수, 브라우저 접근 헤더.
{
  const cfg = { provider: 'anthropic', model: '', apiKey: 'sk-ant', baseUrl: '', params: { top_k: 40 } };
  const req = buildRequest(cfg, { text: 'hi' });
  check(req.kind === 'anthropic' && req.url === 'https://api.anthropic.com/v1/messages', 'anthropic endpoint');
  check(req.headers['x-api-key'] === 'sk-ant', 'x-api-key 헤더');
  check(req.headers['anthropic-dangerous-direct-browser-access'] === 'true', '브라우저 접근 헤더(웹 CORS용)');
  const body = JSON.parse(req.body);
  check(body.max_tokens > 0, 'max_tokens 필수');
  check(body.top_k === 40, 'top_k(Anthropic 전용) 반영');
  check(body.system && body.messages[0].role === 'user', 'system 분리 + user 메시지');
}

// 3) 커스텀 baseUrl 우선 + 무base 검증.
{
  const req = buildRequest({ provider: 'custom', model: 'm', apiKey: 'k', baseUrl: 'https://my/v1', params: {} }, { text: 'x' });
  check(req.url === 'https://my/v1/chat/completions', '커스텀 baseUrl 사용');
  let threw = false; try { validate({ provider: 'custom', apiKey: '', baseUrl: '' }); } catch (_) { threw = true; }
  check(threw, '커스텀 무base → validate throw');
}

// 4) validate: 키 필수 provider에 키 없으면 throw, 키 불필요(custom+엔드포인트)는 통과.
{
  let t1 = false; try { validate({ provider: 'gemini', apiKey: '' }); } catch (_) { t1 = true; }
  check(t1, '키 필수 provider 무키 → throw');
  let t2 = true; try { validate({ provider: 'custom', apiKey: '', baseUrl: 'http://x/v1' }); } catch (_) { t2 = false; }
  check(t2, 'custom(키 불필요)+엔드포인트 → 통과');
}

// 5) parseResponse: openai/anthropic 응답서 텍스트 추출, 형식 오류 throw.
{
  check(parseResponse('openai', { choices: [{ message: { content: '안녕' } }] }) === '안녕', 'openai 응답 파싱');
  check(parseResponse('anthropic', { content: [{ text: '하이' }] }) === '하이', 'anthropic 응답 파싱');
  let t = false; try { parseResponse('openai', { foo: 1 }); } catch (_) { t = true; }
  check(t, '형식 오류 → throw');
}

// 5-b) ★잘림·차단·빈 응답 = 실패(throw) — 부분/빈 번역이 원문을 갈아치우고 캐시를 오염시키지 않게.
{
  const boom = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
  check(/잘렸|max_tokens/.test(boom(() => parseResponse('openai', { choices: [{ finish_reason: 'length', message: { content: '부분 번역' } }] }))), 'finish_reason=length(잘림) → throw + max_tokens 안내');
  check(/안전 필터/.test(boom(() => parseResponse('openai', { choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }))), 'content_filter → 안전 필터 에러');
  check(/빈 응답/.test(boom(() => parseResponse('openai', { choices: [{ finish_reason: 'stop', message: { content: '  ' } }] }))), '빈/공백 응답 → throw(본문 삭제·캐시 오염 방지)');
  check(/잘렸|max_tokens/.test(boom(() => parseResponse('anthropic', { stop_reason: 'max_tokens', content: [{ text: '부분' }] }))), 'anthropic stop_reason=max_tokens → throw');
  check(/빈 응답/.test(boom(() => parseResponse('anthropic', { content: [{ text: '' }] }))), 'anthropic 빈 응답 → throw');
  check(parseResponse('openai', { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }) === 'ok', '정상(stop) 응답은 그대로');
}

// 5-c) ★응답 예산: max_tokens 미설정 → 입력 길이 기반 동적(8192~32768), 명시 설정은 존중(0=생략), maxResponse 우선.
{
  const cfg = (params) => ({ provider: 'gemini', model: 'm', apiKey: 'k', baseUrl: '', params });
  const bodyOf = (c, payload) => JSON.parse(buildRequest(c, payload).body);
  check(bodyOf(cfg({}), { text: 'short' }).max_tokens === 8192, '미설정+짧은 입력 → 동적 최소 8192(고정 4096 탈출)');
  const long = 'x'.repeat(10000);
  const bLong = bodyOf(cfg({}), { text: long });
  check(bLong.max_tokens >= 15000 && bLong.max_tokens <= 32768, '미설정+1만자 입력 → 길이 비례 예산(잘림 방지)');
  check(bodyOf(cfg({ max_tokens: 30000 }), { text: 'short' }).max_tokens === 30000, '사용자 명시값 존중');
  check(!('max_tokens' in bodyOf(cfg({ max_tokens: 0 }), { text: 'short' })), '명시 0 = 요청서 생략(기존 의미 유지)');
  check(bodyOf(cfg({}), { text: 'short', maxResponse: 50000 }).max_tokens === 50000, '프리셋 maxResponse가 더 크면 우선');
  const oa = JSON.parse(buildRequest({ provider: 'openai', model: 'gpt-5.1', apiKey: 'k', baseUrl: '', params: {} }, { text: 'hi' }).body);
  check(oa.max_completion_tokens === 8192 && !('max_tokens' in oa), 'OpenAI 본가 → max_completion_tokens(신형 GPT가 max_tokens 거부)');
  const an = JSON.parse(buildRequest({ provider: 'anthropic', model: '', apiKey: 'k', baseUrl: '', params: {} }, { text: long }).body);
  check(an.max_tokens >= 15000, 'anthropic도 동적 예산 적용');
}

// 6) 로컬 ollama 제거됨(클라우드만) + 클라우드 provider web 가능.
{
  check(!PROVIDERS.ollama, '로컬 ollama 제거됨');
  check(PROVIDERS.gemini.web && PROVIDERS.anthropic.web && PROVIDERS['ollama-turbo'].web, '클라우드 provider=web 가능');
}

// 7) normParams clamp.
{
  const p = normParams({ temperature: 9, top_p: 2, max_tokens: -5, top_k: 999 });
  check(p.temperature === 2 && p.top_p === 1 && p.max_tokens === 0 && p.top_k === 500, '파라미터 범위 clamp');
}

// 8) task:'clean' — 정리 시스템 프롬프트(번역 아님·원문 언어 유지) + placeholder 보존. translate(기본)는 무변경.
{
  const cfg = { provider: 'gemini', model: 'm', apiKey: 'k', baseUrl: '', params: {} };
  const tr = JSON.parse(buildRequest(cfg, { text: 'x' }).body);
  const cl = JSON.parse(buildRequest(cfg, { text: 'x', task: 'clean', stylePrompt: '꼬리말 제거' }).body);
  check(/transl/i.test(tr.messages[0].content), '기본 task=translate(시스템=번역) 유지');
  check(/Do NOT translate/i.test(cl.messages[0].content), "task=clean → '번역하지 말 것' 지시");
  check(/⟦0⟧/.test(cl.messages[0].content), 'clean도 placeholder 보존 지시');
  check(/꼬리말 제거/.test(cl.messages[0].content), 'clean에 작품별 사용자 프롬프트 반영');
  check(/Do NOT translate/i.test(cleanSysPrompt('')) , 'cleanSysPrompt 단독 동작');
}

// 10) Gemini thinking(GigaTrans 흡수 ②) — reasoning_effort 반영(gemini+low/med/high), off/미설정/비-gemini는 미포함(호환).
{
  const g = (thinking) => JSON.parse(buildRequest({ provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'k', baseUrl: '', params: {}, thinking }, { text: 'x' }).body);
  check(g('high').reasoning_effort === 'high', 'gemini thinking=high → reasoning_effort=high');
  check(g('medium').reasoning_effort === 'medium', 'gemini thinking=medium → reasoning_effort');
  check(!('reasoning_effort' in g('off')), 'thinking=off → 미포함(모델 기본)');
  check(!('reasoning_effort' in g('')), 'thinking 미설정 → 미포함');
  const o = JSON.parse(buildRequest({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'k', baseUrl: '', params: {}, thinking: 'high' }, { text: 'x' }).body);
  check(!('reasoning_effort' in o), '비-gemini는 thinking 무시(호환)');
}

// 9) 스마트 재시도(GigaTrans 흡수 ①) — 일시(429·5xx·타임아웃)만 재시도, 치명(4xx)은 즉시. sleep 주입으로 즉시 실행.
async function retryTests() {
  const nosleep = () => Promise.resolve();
  const stub = (seq) => { let i = 0; const f = async () => { const v = seq[Math.min(i, seq.length - 1)]; i++; if (v && v.throw) throw new Error('net'); return v; }; f.count = () => i; return f; };
  check(isTransientStatus(429) && isTransientStatus(500) && isTransientStatus(503) && isTransientStatus(408), '일시: 429·5xx·408');
  check(!isTransientStatus(400) && !isTransientStatus(401) && !isTransientStatus(404), '치명: 400·401·404 비일시');
  { const f = stub([{ status: 200, bodyText: 'OK' }]); const r = await requestWithRetry({ url: 'u' }, f, { sleep: nosleep }); check(r === 'OK' && f.count() === 1, '200 즉시 성공(1회)'); }
  { const f = stub([{ status: 401, bodyText: '{"error":{"message":"bad key"}}' }]); let msg = ''; try { await requestWithRetry({ url: 'u' }, f, { sleep: nosleep }); } catch (e) { msg = e.message; } check(f.count() === 1 && /키|401/.test(msg), '401 치명=재시도 0 + 명확 에러'); }
  { const f = stub([{ status: 429, bodyText: '' }, { status: 429, bodyText: '' }, { status: 200, bodyText: 'OK' }]); const r = await requestWithRetry({ url: 'u' }, f, { sleep: nosleep, retries: 2 }); check(r === 'OK' && f.count() === 3, '429 재시도 후 성공(3회)'); }
  { const f = stub([{ status: 503, bodyText: '' }]); let msg = ''; try { await requestWithRetry({ url: 'u' }, f, { sleep: nosleep, retries: 2 }); } catch (e) { msg = e.message; } check(f.count() === 3 && /서버|503/.test(msg), '503 소진=3회 후 에러'); }
  { const f = stub([{ throw: true }]); let c = 0; try { await requestWithRetry({ url: 'u' }, f, { sleep: nosleep, retryNetwork: false }); } catch (_) { c = f.count(); } check(c === 1, '네트워크 throw + retryNetwork:false = 1회(즉시)'); }
  { const f = stub([{ throw: true }, { throw: true }, { status: 200, bodyText: 'OK' }]); const r = await requestWithRetry({ url: 'u' }, f, { sleep: nosleep, retries: 2, retryNetwork: true }); check(r === 'OK' && f.count() === 3, '네트워크 throw + retryNetwork:true = 재시도 후 성공'); }
  check(/키|권한/.test(errorText(401, '')) && /모델|주소/.test(errorText(404, '')) && /서버/.test(errorText(500, '')), 'errorText 상태별 한국어 힌트');
  // ★429 레이트리밋: 초 단위 백오프(밀리초 백오프는 분당 쿼터에 무의미) + Retry-After 존중 + 별도 재시도 횟수(기본 4).
  {
    const waits = []; const rec = (ms) => { waits.push(ms); return Promise.resolve(); };
    const f = stub([{ status: 429, bodyText: '' }, { status: 429, bodyText: '' }, { status: 429, bodyText: '' }, { status: 429, bodyText: '' }, { status: 200, bodyText: 'OK' }]);
    const r = await requestWithRetry({ url: 'u' }, f, { sleep: rec });
    check(r === 'OK' && f.count() === 5, '429 ×4 후 성공(기본 재시도 4회)');
    check(waits.join(',') === '2000,5000,12000,30000', '429 백오프 = 2s→5s→12s→30s(쿼터 창 리셋 대기)');
  }
  {
    const waits = []; const rec = (ms) => { waits.push(ms); return Promise.resolve(); };
    const f = stub([{ status: 429, bodyText: '', retryAfterMs: 7000 }, { status: 200, bodyText: 'OK' }]);
    const r = await requestWithRetry({ url: 'u' }, f, { sleep: rec });
    check(r === 'OK' && waits[0] === 7000, 'Retry-After(7초) 존중');
    const f2 = stub([{ status: 429, bodyText: '', retryAfterMs: 999000 }, { status: 200, bodyText: 'OK' }]);
    const waits2 = []; await requestWithRetry({ url: 'u' }, f2, { sleep: (ms) => { waits2.push(ms); return Promise.resolve(); } });
    check(waits2[0] === 60000, 'Retry-After 상한 60초');
  }
  {
    const f = stub([{ status: 429, bodyText: '' }]); let msg = '';
    try { await requestWithRetry({ url: 'u' }, f, { sleep: nosleep, retries429: 1 }); } catch (e) { msg = e.message; }
    check(f.count() === 2 && /한도|429/.test(msg), '429 소진 → 쿼터 안내 에러');
  }
  {
    const waits = []; const f = stub([{ status: 503, bodyText: '' }, { status: 200, bodyText: 'OK' }]);
    await requestWithRetry({ url: 'u' }, f, { sleep: (ms) => { waits.push(ms); return Promise.resolve(); } });
    check(waits[0] === 600, '5xx는 기존 짧은 백오프 유지(429만 길게)');
  }
}
retryTests().then(() => {
  console.log(failed === 0 ? '\nproviders: 모든 검사 통과 ✓' : `\nproviders: ${failed}개 실패 ✗`);
  process.exit(failed ? 1 : 0);
}).catch((e) => { console.error('retryTests error', e); process.exit(1); });
