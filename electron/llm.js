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
    return { provider: raw.provider || 'openai', model: raw.model || '', baseUrl: raw.baseUrl || '', apiKey, params: normParams(raw.params) };
  } catch (_) { return { provider: 'openai', model: '', baseUrl: '', apiKey: '', params: normParams() }; }
}

// 키 없는 공개용(renderer에 노출 — 원본 키는 절대 안 나감, 파라미터는 비밀 아니라 노출).
function publicConfig() { const c = loadConfig(); return { provider: c.provider, model: c.model, baseUrl: c.baseUrl, hasKey: !!c.apiKey, params: c.params }; }

function saveConfig(cfg) {
  cfg = cfg || {};
  const cur = loadConfig();
  const out = {
    provider: cfg.provider || cur.provider || 'openai',
    model: (cfg.model != null ? cfg.model : cur.model) || '',
    baseUrl: (cfg.baseUrl != null ? cfg.baseUrl : cur.baseUrl) || '',
    params: normParams(cfg.params != null ? cfg.params : cur.params),
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

// 마스킹된 산문 1덩이를 번역해 돌려준다(마스킹/복원·한국어 스킵은 renderer 쪽 코어가 담당).
//   payload: { text, targetLang, stylePrompt(작품별 문체) }
async function translate(payload) {
  const cfg = loadConfig();
  const text = String((payload && payload.text) || '');
  if (!text.trim()) return text;
  validate(cfg);
  const req = buildRequest(cfg, { text, targetLang: (payload && payload.targetLang) || '한국어', stylePrompt: payload && payload.stylePrompt, task: payload && payload.task, combine: payload && payload.combine, maxResponse: payload && payload.maxResponse });
  // ★스마트 재시도(공유): 429·5xx·타임아웃·일시 네트워크만 재시도, 치명(키·권한·모델없음·결제)은 즉시 명확 에러. 데스크탑은 CORS 없음 → retryNetwork:true.
  const body = await providers.requestWithRetry(req, fetchOnce, { retries: 2, retryNetwork: true });
  let json = null; try { json = JSON.parse(body); } catch (_) {}
  if (!json) throw new Error('응답 파싱 실패');
  return parseResponse(req.kind, json);
}

module.exports = { loadConfig, publicConfig, saveConfig, clearConfig, translate };
