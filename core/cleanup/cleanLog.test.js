// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/cleanup/cleanLog.test.js — 블록 정리 오케스트레이션 검증.
// 1차 결정론(키 없이) / 2차 LLM 주입 / 마스킹 보존 / 부분 실패 격리 / 진행률. 실행: node core/cleanup/cleanLog.test.js
'use strict';
const { cleanText, cleanBlocks } = require('./cleanLog.js');

let failed = 0;
const check = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { failed++; console.error('  ✗ ' + msg); } };

console.log('cleanLog:');

(async () => {
  // 1) cleanText 1차만(cleanFn 없음) = 결정론 stripJunk
  {
    const r = await cleanText('## Response\n그가 "안녕" 했다.');
    check(r === '그가 "안녕" 했다.', '1차만: 헤더 제거·대사 유지');
  }
  // 2) cleanText 2차 LLM 주입 — 마스킹된 산문을 받고 placeholder/대사 보존
  {
    const seen = [];
    const fakeLlm = async (masked) => { seen.push(masked); return masked.replace('군더더기 ', ''); };   // 모델이 산문만 다듬음
    const r = await cleanText('AI: 군더더기 그가 {{img::happy}} 웃었다.', fakeLlm);
    check(seen.length === 1 && seen[0].indexOf('{{img::happy}}') < 0, '2차: LLM엔 마스킹된 산문 전달(이미지 토큰 가려짐)');
    check(r.indexOf('{{img::happy}}') >= 0, '2차: 복원 시 이미지 토큰 그대로');
    check(r.indexOf('AI:') < 0 && r.indexOf('군더더기') < 0, '2차: 1차(라벨)+2차(군더더기) 모두 정리');
  }
  // 3) cleanBlocks 블록 단위 + 진행률
  {
    const prog = [];
    const res = await cleanBlocks(['## Response\n첫째', 'OOC: 메모\n둘째', '셋째 그대로'], null, { onProgress: (d, t) => prog.push(d + '/' + t) });
    check(res.blocks[0] === '첫째' && res.blocks[1] === '둘째' && res.blocks[2] === '셋째 그대로', '블록별 1차 정리');
    check(res.cleaned === 2, '바뀐 블록 수 = 2');
    check(prog.length === 3 && prog[2] === '3/3', '진행률 콜백 3회');
  }
  // 4) 부분 실패 격리 — 한 블록 LLM이 throw해도 그 블록은 1차 결과 유지, 나머지 진행
  {
    const llm = async (masked, ctx) => { if (ctx.index === 0) throw new Error('rate limit'); return masked.toUpperCase(); };
    const res = await cleanBlocks(['AI: hello', 'AI: world'], llm);
    check(res.failed.length === 1 && res.failed[0].index === 0, '실패 블록 1개 격리 기록');
    check(res.blocks[0] === 'hello', '실패 블록은 1차(라벨 제거) 결과 유지');
    check(res.blocks[1] === 'WORLD', '성공 블록은 2차 적용');
  }
  // 5) 순수 이미지 블록은 LLM 호출 0
  {
    let calls = 0; const llm = async (m) => { calls++; return m; };
    const res = await cleanBlocks(['{{img::happy}}', '<img src="a">'], llm);
    check(calls === 0, '산문 없는 블록 → LLM 호출 0');
    check(res.blocks[0] === '{{img::happy}}', '이미지 블록 원형 유지');
  }

  console.log(failed ? `\ncleanLog: 실패 ${failed}` : '\ncleanLog: 모든 검사 통과 ✓');
  process.exit(failed ? 1 : 0);
})();
