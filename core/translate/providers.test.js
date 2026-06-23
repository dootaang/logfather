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
}
retryTests().then(() => {
  console.log(failed === 0 ? '\nproviders: 모든 검사 통과 ✓' : `\nproviders: ${failed}개 실패 ✗`);
  process.exit(failed ? 1 : 0);
}).catch((e) => { console.error('retryTests error', e); process.exit(1); });
