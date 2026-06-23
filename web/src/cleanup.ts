// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/cleanup.ts — 가져온 로그 정리(군더더기 제거) 연결부. translate.ts의 형제.
//
// 1차 = 결정론 stripJunk(코어, 키 불필요·오프라인·어디서나). 2차 = 선택적 LLM(cleanFn 주입, Phase 3).
// 코어(cleanLog)가 마스킹/블록/부분실패 격리를 맡고, 여기선 에디터/단위 배선만. ★1차는 키 없이 항상 동작.
// @ts-nocheck
import { cleanBlocks } from '../../core/cleanup/cleanLog.js';
import { doLlm, ensureTranslateReady } from './translate.js';   // 2차 LLM = 번역 인프라(키/설정/디스패치) 재사용

/** 정리 1차(결정론)는 이 플랫폼에서 항상 가능(키 불필요). */
export function cleanAvailable(): boolean { return true; }
/** 2차 정밀 정리(LLM)는 번역과 같은 키/설정을 쓴다 — 준비됐는지 확인(아니면 설정 모달). */
export const ensureCleanReady = ensureTranslateReady;

// ── 작품별 정리 프롬프트 = 로컬 저장(동기화 금지). 번역 프롬프트와 별개 키. ──
export const DEFAULT_CLEAN_PROMPT = 'RP 본문만 남기고, 응답 헤더·생각의 사슬·OOC·시스템 토큰·화자 라벨 같은 군더더기를 제거하세요. 번역하지 말고 원문 언어·표현을 그대로 두세요.';
const CLEAN_PROMPTS_KEY = 'pro2-clean-prompts';   // { [char]: 프롬프트 } — 동기화 안 함
export function getCleanPrompt(char: string): string {
  try { const o = JSON.parse(localStorage.getItem(CLEAN_PROMPTS_KEY) || '{}'); return (o && typeof o[char] === 'string') ? o[char] : DEFAULT_CLEAN_PROMPT; } catch (_) { return DEFAULT_CLEAN_PROMPT; }
}
export function setCleanPrompt(char: string, text: string): void {
  try { const o = JSON.parse(localStorage.getItem(CLEAN_PROMPTS_KEY) || '{}'); o[char] = text; localStorage.setItem(CLEAN_PROMPTS_KEY, JSON.stringify(o)); } catch (_) {}
}

// 마스킹된 산문 1덩이 → 플랫폼 2차 정리(작품별 프롬프트 동반). 실패는 throw(코어가 블록 단위 격리).
export function makeCleanFn(cleanPrompt: string) {
  return async (masked: string) => {
    const r = await doLlm({ text: masked, task: 'clean', stylePrompt: cleanPrompt });
    if (!r || !r.ok) throw new Error((r && r.error) || '정리 실패');
    return r.text;
  };
}

export interface CleanUnitsResult { blocks: string[]; cleaned: number; failed: { index: number; error: string }[]; }
// 텍스트 단위 배열 정리. cleanFn(선택)=2차 LLM. 마크업 보존·진행률·부분실패 격리는 코어가 담당.
export async function cleanUnits(units: string[], onProgress?: (d: number, t: number) => void, cleanFn?: any): Promise<CleanUnitsResult> {
  return await cleanBlocks(units, cleanFn || null, { onProgress });
}

export interface CleanEditResult { restore: () => void; cleaned: number; failed: number; }
// 에디터 입력칸/블록들 정리(각 칸 통째 = 문서 단위 군더더기[헤더·생각의사슬 등]가 문단 경계를 넘으므로). 원문 백업→되돌리기.
export async function cleanEditors(targets: HTMLTextAreaElement[], setStatus: (m: string) => void, cleanFn?: any): Promise<CleanEditResult | null> {
  const vals = targets.map((ta) => ta.value);
  if (!vals.some((v) => v.trim())) { setStatus('정리할 내용이 없습니다.'); return null; }
  const backup = targets.map((ta) => ({ ta, value: ta.value }));
  const res = await cleanUnits(vals, (d, t) => setStatus(`정리 중… (${d}/${t})`), cleanFn);
  targets.forEach((ta, i) => { ta.value = res.blocks[i]; ta.dispatchEvent(new Event('input', { bubbles: true })); });
  return {
    cleaned: res.cleaned, failed: res.failed.length,
    restore: () => { backup.forEach((b) => { b.ta.value = b.value; b.ta.dispatchEvent(new Event('input', { bubbles: true })); }); },
  };
}
