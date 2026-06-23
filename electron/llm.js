// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// electron/llm.js — 번역용 LLM 어댑터(데스크탑 전용, BYO-key). 메인 프로세스에서만 동작.
//
// ★코어/웹은 무LLM 결정론 유지. 번역만 예외 — 데스크탑 전용·사용자 본인 키라 우리 비용 0·웹 LLM-free.
// provider-비종속 인터페이스: openai 호환(OpenAI/Gemini/Ollama 클라우드/커스텀) · anthropic(Claude). provider 정의는 core/translate/providers.js 한 벌.
//   대부분 provider가 OpenAI 호환 엔드포인트를 제공 → 한 경로로 흡수, Anthropic만 자체 포맷.
// ★키는 로컬에만. safeStorage로 암호화해 userData에 저장(Firebase 동기화 절대 안 함 — renderer/sync 경유 안 함).
'use strict';
const { net, safeStorage, app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');   // Vertex AI 서비스계정 JWT(RS256) 서명용
// ★provider 요청 로직은 브라우저-안전 공유 모듈(웹과 1벌 공유). 여기선 config 저장(safeStorage) + net.fetch만.
const providers = require('../core/translate/providers.js');
const { normParams, validate, buildRequest, parseResponse } = providers;

const configPath = () => path.join(app.getPath('userData'), 'translate-config.json');

// ── 설정(provider/model/baseUrl + 암호화 키 + 생성 파라미터) 로컬 저장 ──
function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    let apiKey = '';
    if (raw.keyEnc && safeStorage.isEncryptionAvailable()) {
      try { apiKey = safeStorage.decryptString(Buffer.from(raw.keyEnc, 'base64')); } catch (_) {}
    } else if (raw.keyPlain) { apiKey = raw.keyPlain; }   // 암호화 불가 환경 폴백
    return { provider: raw.provider || 'openai', model: raw.model || '', baseUrl: raw.baseUrl || '', apiKey, params: normParams(raw.params), thinking: raw.thinking || 'off', vertexProject: raw.vertexProject || '', vertexRegion: raw.vertexRegion || 'global', vertexEmail: raw.vertexEmail || '' };
  } catch (_) { return { provider: 'openai', model: '', baseUrl: '', apiKey: '', params: normParams() }; }
}

// 키 없는 공개용(renderer에 노출 — 원본 키는 절대 안 나감, 파라미터는 비밀 아니라 노출).
function publicConfig() { const c = loadConfig(); return { provider: c.provider, model: c.model, baseUrl: c.baseUrl, hasKey: !!c.apiKey, params: c.params, thinking: c.thinking, vertexProject: c.vertexProject, vertexRegion: c.vertexRegion, vertexEmail: c.vertexEmail }; }

function saveConfig(cfg) {
  cfg = cfg || {};
  const cur = loadConfig();
  const out = {
    provider: cfg.provider || cur.provider || 'openai',
    model: (cfg.model != null ? cfg.model : cur.model) || '',
    baseUrl: (cfg.baseUrl != null ? cfg.baseUrl : cur.baseUrl) || '',
    params: normParams(cfg.params != null ? cfg.params : cur.params),
    thinking: (cfg.thinking != null ? cfg.thinking : cur.thinking) || 'off',
    vertexProject: (cfg.vertexProject != null ? cfg.vertexProject : cur.vertexProject) || '',
    vertexRegion: (cfg.vertexRegion != null ? cfg.vertexRegion : cur.vertexRegion) || 'global',
    vertexEmail: (cfg.vertexEmail != null ? cfg.vertexEmail : cur.vertexEmail) || '',
  };
  // apiKey: 빈/미지정이면 기존 키 유지(설정만 바꾸고 키는 그대로). 명시되면 교체.
  const key = (cfg.apiKey != null && cfg.apiKey !== '') ? String(cfg.apiKey) : cur.apiKey;
  if (key) {
    if (safeStorage.isEncryptionAvailable()) out.keyEnc = safeStorage.encryptString(key).toString('base64');
    else out.keyPlain = key;
  }
  fs.writeFileSync(configPath(), JSON.stringify(out), 'utf8');
  return publicConfig();
}

function clearConfig() { try { fs.unlinkSync(configPath()); } catch (_) {} return publicConfig(); }

// net.fetch 1회(60초 타임아웃). 상태+본문만 돌려준다 — 오류 분류·재시도는 공유 requestWithRetry가 담당.
async function fetchOnce(req) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await net.fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: ctrl.signal });
    return { status: res.status, bodyText: await res.text() };
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error('시간 초과(60초)');   // 타임아웃 = 일시 → requestWithRetry가 재시도
    throw e;
  } finally { clearTimeout(timer); }
}

// ── Vertex AI / GitHub Copilot (★데스크탑 전용 — 토큰 교환·서명·자체 엔드포인트라 브라우저 CORS 불가) ──
//   GigaTrans relay(GPL, THIRD_PARTY_NOTICES 고지) 흐름을 우리 코드로 재구현. system 프롬프트·스마트 재시도·thinking은 기존 공유 로직 재사용.
const VERTEX_BUDGET = { low: 2048, medium: 8192, high: 24576 };   // Gemini 2.5 thinkingBudget(off/미설정=미포함=모델 기본)
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let _vertexTok = { token: null, exp: 0 };
let _copilotTok = { token: null, exp: 0 };

// 서비스 계정 PEM → JWT(RS256) 서명 → OAuth2 access token 교환(캐시 ~58분). 사용자가 액세스 토큰(ya29…)을 직접 넣었으면 그대로.
async function vertexAccessToken(cfg) {
  const key = String(cfg.apiKey || '');
  if (!key.includes('-----BEGIN PRIVATE KEY-----')) return key;
  if (_vertexTok.token && Date.now() < _vertexTok.exp) return _vertexTok.token;
  const email = String(cfg.vertexEmail || '');
  if (!email.includes('gserviceaccount.com')) throw new Error('Vertex AI: 서비스 계정 이메일을 설정하세요(xxx@xxx.iam.gserviceaccount.com)');
  const pem = key.replace(/\\n/g, '\n');   // JSON에서 복사해 \n이 literal인 경우 복원
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: email, iat: now, exp: now + 3600, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token' }));
  const sigInput = header + '.' + claim;
  let sig;
  try { const s = crypto.createSign('RSA-SHA256'); s.update(sigInput); s.end(); sig = b64url(s.sign(pem)); }
  catch (_) { throw new Error('Vertex AI: 개인키 서명 실패 — PEM 키 형식을 확인하세요'); }
  const jwt = sigInput + '.' + sig;
  const res = await net.fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt });
  let data = null; try { data = JSON.parse(await res.text()); } catch (_) {}
  if (!res.ok || !data || !data.access_token) throw new Error('Vertex AI: OAuth2 토큰 교환 실패 — ' + (data ? JSON.stringify(data).slice(0, 200) : ('HTTP ' + res.status)));
  _vertexTok = { token: data.access_token, exp: Date.now() + 3500 * 1000 };
  return data.access_token;
}

async function translateVertex(cfg, payload, text) {
  if (!cfg.vertexProject) throw new Error('Vertex AI: Project ID를 설정하세요');
  const model = cfg.model || 'gemini-2.5-flash';
  const region = cfg.vertexRegion || 'global';
  const token = await vertexAccessToken(cfg);
  const system = (payload && payload.task === 'clean') ? providers.cleanSysPrompt(payload && payload.stylePrompt) : providers.sysPrompt((payload && payload.targetLang) || '한국어', payload && payload.stylePrompt, payload && payload.combine);
  const p = normParams(cfg.params);
  const gc = { temperature: p.temperature, topP: p.top_p };
  if (p.top_k > 0) gc.topK = p.top_k;
  const maxResp = (payload && +payload.maxResponse > 0) ? Math.min(200000, Math.round(+payload.maxResponse)) : 0;
  const maxTok = maxResp > p.max_tokens ? maxResp : p.max_tokens; if (maxTok > 0) gc.maxOutputTokens = maxTok;
  const think = String(cfg.thinking || '').toLowerCase(); if (VERTEX_BUDGET[think] != null) gc.thinkingConfig = { thinkingBudget: VERTEX_BUDGET[think] };
  const url = region === 'global'
    ? `https://aiplatform.googleapis.com/v1/projects/${cfg.vertexProject}/locations/global/publishers/google/models/${model}:generateContent`
    : `https://${region}-aiplatform.googleapis.com/v1/projects/${cfg.vertexProject}/locations/${region}/publishers/google/models/${model}:generateContent`;
  const reqBody = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text }] }], generationConfig: gc };
  const req = { url, method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify(reqBody) };
  const bodyText = await providers.requestWithRetry(req, fetchOnce, { retries: 2, retryNetwork: true });
  let data = null; try { data = JSON.parse(bodyText); } catch (_) {}
  const cand = data && data.candidates && data.candidates[0];
  const out = cand && cand.content && cand.content.parts && cand.content.parts.map((x) => (x && x.text) || '').join('');
  if (typeof out !== 'string' || !out) throw new Error('Vertex 응답 형식 오류(차단 또는 빈 응답)');
  return out;
}

// GitHub 토큰 → Copilot 토큰 교환(만료까지 캐시). 사용자는 자기 GitHub 토큰(Copilot 구독)을 키로 넣는다.
async function copilotAccessToken(githubToken) {
  if (_copilotTok.token && Date.now() < _copilotTok.exp) return _copilotTok.token;
  const res = await net.fetch('https://api.github.com/copilot_internal/v2/token', { method: 'GET', headers: { 'Authorization': 'token ' + githubToken, 'User-Agent': 'LogPapa', 'Accept': 'application/json' } });
  let data = null; try { data = JSON.parse(await res.text()); } catch (_) {}
  if (!res.ok || !data || !data.token) throw new Error('Copilot 토큰 교환 실패 — GitHub 토큰(Copilot 구독)을 확인하세요');
  _copilotTok = { token: data.token, exp: (data.expires_at || 0) * 1000 };
  return data.token;
}

async function translateCopilot(cfg, payload, text) {
  const model = cfg.model || 'gpt-4o';
  const token = await copilotAccessToken(String(cfg.apiKey || ''));
  const system = (payload && payload.task === 'clean') ? providers.cleanSysPrompt(payload && payload.stylePrompt) : providers.sysPrompt((payload && payload.targetLang) || '한국어', payload && payload.stylePrompt, payload && payload.combine);
  const p = normParams(cfg.params);
  const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: text }], temperature: p.temperature, top_p: p.top_p, stream: false };
  const maxResp = (payload && +payload.maxResponse > 0) ? Math.min(200000, Math.round(+payload.maxResponse)) : 0;
  const maxTok = maxResp > p.max_tokens ? maxResp : p.max_tokens; if (maxTok > 0) body.max_tokens = maxTok;
  const req = { url: 'https://api.githubcopilot.com/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Editor-Version': 'vscode/1.95.0', 'Copilot-Integration-Id': 'vscode-chat' }, body: JSON.stringify(body) };
  let bodyText;
  try { bodyText = await providers.requestWithRetry(req, fetchOnce, { retries: 2, retryNetwork: true }); }
  catch (e) { _copilotTok = { token: null, exp: 0 }; throw e; }   // 실패 시 토큰 캐시 무효화(다음에 재교환)
  let data = null; try { data = JSON.parse(bodyText); } catch (_) {}
  const out = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof out !== 'string') throw new Error('Copilot 응답 형식 오류');
  return out;
}

// 마스킹된 산문 1덩이를 번역해 돌려준다(마스킹/복원·한국어 스킵은 renderer 쪽 코어가 담당).
//   payload: { text, targetLang, stylePrompt(작품별 문체) }
async function translate(payload) {
  const cfg = loadConfig();
  const text = String((payload && payload.text) || '');
  if (!text.trim()) return text;
  if (cfg.provider === 'vertex') return await translateVertex(cfg, payload, text);     // 데스크탑 전용(토큰 서명·네이티브 generateContent)
  if (cfg.provider === 'copilot') return await translateCopilot(cfg, payload, text);   // 데스크탑 전용(GitHub→Copilot 토큰 교환)
  validate(cfg);
  const req = buildRequest(cfg, { text, targetLang: (payload && payload.targetLang) || '한국어', stylePrompt: payload && payload.stylePrompt, task: payload && payload.task, combine: payload && payload.combine, maxResponse: payload && payload.maxResponse });
  // ★스마트 재시도(공유): 429·5xx·타임아웃·일시 네트워크만 재시도, 치명(키·권한·모델없음·결제)은 즉시 명확 에러. 데스크탑은 CORS 없음 → retryNetwork:true.
  const body = await providers.requestWithRetry(req, fetchOnce, { retries: 2, retryNetwork: true });
  let json = null; try { json = JSON.parse(body); } catch (_) {}
  if (!json) throw new Error('응답 파싱 실패');
  return parseResponse(req.kind, json);
}

module.exports = { loadConfig, publicConfig, saveConfig, clearConfig, translate };
