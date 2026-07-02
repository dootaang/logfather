// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/translate/translateLog.test.js — 마크업 보존 번역 오케스트레이션 검증.
// 마스킹(이미지/마커/태그) / 산문만 번역 / 토큰 복원 / 순수이미지 스킵 / 부분 실패 격리 / 따옴표·별표 보존.
// 실행: node core/translate/translateLog.test.js
'use strict';
const { maskMarkup, unmaskMarkup, hasProse, translateText, translateBlocks, isKoreanDominant } = require('./translateLog.js');

let failed = 0;
const check = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { failed++; console.error('  ✗ ' + msg); } };

// 가짜 번역기: 산문을 대문자로 바꾸되 placeholder(⟦n⟧)·따옴표·별표는 그대로 둔다(좋은 모델 모방).
const fakeUpper = async (masked) => masked.toUpperCase();

(async () => {
  // 1) 마스킹: 이미지 토큰·에셋 마커·html 태그는 가려지고, 산문/따옴표는 남는다.
  {
    const text = '그녀가 "안녕!" 하며 {{img::happy}} 손을 흔들었다 [🌠|aoi.smile] <img src="x.png">';
    const { masked, tokens } = maskMarkup(text);
    check(masked.indexOf('{{img::happy}}') < 0 && masked.indexOf('[🌠|aoi.smile]') < 0 && masked.indexOf('<img') < 0, '구조 토큰 모두 가려짐');
    check(masked.indexOf('"안녕!"') >= 0, '대사 따옴표는 산문으로 남음');
    check(tokens.length === 3, '토큰 3개 추출(이미지·마커·태그)');
    check(unmaskMarkup(masked, tokens) === text, '복원 시 원문 동일');
  }

  // 2) hasProse: 순수 이미지/태그 블록은 false(번역 스킵 대상).
  {
    check(hasProse(maskMarkup('{{img::happy}}').masked) === false, '이미지뿐 → 산문 없음');
    check(hasProse(maskMarkup('<img src="a">\n{{img::x}}').masked) === false, '태그+이미지뿐 → 산문 없음');
    check(hasProse(maskMarkup('안녕 {{img::x}}').masked) === true, '산문 있으면 true');
  }

  // 3) translateText: 산문만 번역되고 구조 토큰은 제자리 보존, 호출은 마스킹된 텍스트로.
  {
    let sent = '';
    const fn = async (m) => { sent = m; return m.replace(/hello/i, '안녕'); };
    const out = await translateText('hello {{img::happy}} <b>x</b>', fn);
    check(sent.indexOf('{{img::happy}}') < 0 && sent.indexOf('<b>') < 0, '모델엔 마스킹된 텍스트만 감');
    check(out === '안녕 {{img::happy}} <b>x</b>', '산문만 번역 + 토큰 원위치 복원');
  }

  // 4) 순수 이미지 블록은 fn 호출 0회(원문 그대로).
  {
    let calls = 0;
    const fn = async (m) => { calls++; return m; };
    const out = await translateText('{{img::happy}}', fn);
    check(calls === 0 && out === '{{img::happy}}', '순수 이미지 → 호출 없이 원문');
  }

  // 5) translateBlocks: 여러 블록 번역 + 진행 보고 + 바뀐 수.
  {
    const steps = [];
    const r = await translateBlocks(['hello world', '{{img::x}}', 'bye'], fakeUpper, { onProgress: (d, t) => steps.push(d + '/' + t) });
    check(r.blocks[0] === 'HELLO WORLD' && r.blocks[2] === 'BYE', '산문 블록 번역됨');
    check(r.blocks[1] === '{{img::x}}', '순수 이미지 블록은 원문 유지');
    check(r.translated === 2, '바뀐 블록 2개');
    check(steps.length === 2 && steps[1] === '2/2', '진행률 분모=API 대상만(이미지 블록 제외)');
  }

  // 5-b) ★진행률 착시 수정: 스킵(한국어·빈칸)이 많아도 (1/N)부터 시작 — 예전엔 분류 루프가 스킵을 즉시 tick해 "(30/40) 시작"처럼 보였음.
  {
    const mk = (n, v) => Array.from({ length: n }, () => v);
    const blocks = [...mk(3, '이미 한국어인 블록입니다'), 'translate me', ...mk(2, ''), 'me too'];
    for (const combine of [false, true]) {
      const steps = [];
      const fn = async (m, ctx) => (ctx && ctx.combine) ? String(m).split(/\n?⟦\s*⟦\s*SEG\s*⟧\s*⟧\n?/).map((s) => s.toUpperCase()).join('\n⟦⟦SEG⟧⟧\n') : m.toUpperCase();
      const r = await translateBlocks(blocks, fn, { skipKorean: true, combine, onProgress: (d, t) => steps.push(d + '/' + t) });
      check(steps[0] === '1/2' && steps[steps.length - 1] === '2/2', `진행률 (1/2)부터 시작(combine=${combine}) — 스킵 5개는 분모서 제외`);
      check(r.skipped === 3 && r.translated === 2, `스킵·번역 리포트는 그대로(combine=${combine})`);
    }
  }

  // 6) 부분 실패 격리: 한 블록이 throw 해도 나머지는 번역, 실패는 원문 유지 + failed 기록.
  {
    const fn = async (m) => { if (m.indexOf('boom') >= 0) throw new Error('429 한도초과'); return m.toUpperCase(); };
    const r = await translateBlocks(['ok one', 'boom here', 'ok two'], fn);
    check(r.blocks[0] === 'OK ONE' && r.blocks[2] === 'OK TWO', '정상 블록은 번역');
    check(r.blocks[1] === 'boom here', '실패 블록은 원문 그대로(안 깨짐)');
    check(r.failed.length === 1 && r.failed[0].index === 1 && r.failed[0].error === '429 한도초과', '실패 인덱스·사유 기록');
    check(r.translated === 2, '성공 2개만 카운트');
  }

  // 7) 따옴표·별표·줄바꿈 보존(모델이 유지하면 그대로 흐름).
  {
    const text = '"Hi," he said.\n*She smiled.*';
    const out = await translateText(text, async (m) => m);   // 항등(모델이 그대로 둠) → 구조 보존 확인
    check(out === text, '따옴표·별표·줄바꿈 보존');
  }

  // 8) placeholder 주변 공백 변형 복원 관대성(모델이 "⟦ 0 ⟧"로 띄워도 복원).
  {
    const { tokens } = maskMarkup('<img src="x.png">');
    check(unmaskMarkup('앞 ⟦ 0 ⟧ 뒤', tokens) === '앞 <img src="x.png"> 뒤', 'placeholder 공백 변형도 복원');
  }

  // 9) 짝 태그 안 텍스트는 산문으로 번역되고 태그는 보존(<b>x</b> → <b>·</b> 보존, x 번역).
  {
    const out = await translateText('<b>hello</b>', async (m) => m.replace(/hello/i, '안녕'));
    check(out === '<b>안녕</b>', '짝 태그 속 텍스트만 번역, 태그 보존');
  }

  // 10) 한글 우세 감지: 한국어=true, 영어/일본어/중국어=false, 혼합은 비율.
  {
    check(isKoreanDominant('안녕하세요 반갑습니다') === true, '순한국어 → 한글 우세');
    check(isKoreanDominant('Hello there friend') === false, '영어 → 한글 우세 아님');
    check(isKoreanDominant('こんにちは、元気ですか') === false, '일본어 → 한글 우세 아님');
    check(isKoreanDominant('你好世界很高兴') === false, '중국어 → 한글 우세 아님');
    check(isKoreanDominant('안녕 hello 반가워요 친구야 정말') === true, '한글 다수 혼합 → 우세');
    check(isKoreanDominant('') === false, '빈 문자열 → false');
  }

  // 11) skipKorean: 이미 한국어인 블록은 호출 0회로 스킵, 외국어만 번역(비용 절약 리포트).
  {
    let calls = 0;
    const fn = async (m) => { calls++; return m.toUpperCase(); };
    const r = await translateBlocks(['이미 한국어 문장입니다', 'translate this please', '또 다른 한국어'], fn, { skipKorean: true });
    check(calls === 1, '외국어 블록만 1회 호출(한국어 2개 스킵)');
    check(r.skipped === 2 && r.translated === 1, 'skipped=2, translated=1 리포트');
    check(r.blocks[0] === '이미 한국어 문장입니다' && r.blocks[2] === '또 다른 한국어', '한국어 블록 원문 유지');
    check(r.blocks[1] === 'TRANSLATE THIS PLEASE', '외국어 블록만 번역');
  }

  // 12) skipKorean 한글 판정은 마스킹 후 산문에만 — 이미지 태그가 비율을 오염시키지 않음.
  {
    let calls = 0;
    const fn = async (m) => { calls++; return m; };
    // 이름(영문) 이미지 태그가 많아도 산문이 한국어면 스킵돼야 함.
    await translateBlocks(['안녕 {{img::happy_smiling_face}} 반가워 [🌠|tarumaemaru.excited]'], fn, { skipKorean: true });
    check(calls === 0, '이미지 태그 영문명이 많아도 산문이 한국어면 스킵(마스킹 후 판정)');
  }

  // ── 결합 번역(C3) — 여러 블록 한 요청 + 구분자 재분해 + 안전 폴백 ──
  const SEGJOIN = '\n⟦⟦SEG⟧⟧\n';
  const splitSeg = (m) => String(m).split(/\n?⟦\s*⟦\s*SEG\s*⟧\s*⟧\n?/);

  // 13) 결합: 번역 대상 블록을 1회 결합 호출, 구역별 재분해·복원. 이미지 블록은 결합서 제외.
  {
    let combineCalls = 0, perCalls = 0;
    const fn = async (m, ctx) => { if (ctx && ctx.combine) { combineCalls++; return splitSeg(m).map((s) => s.toUpperCase()).join(SEGJOIN); } perCalls++; return m.toUpperCase(); };
    const r = await translateBlocks(['hello there', '{{img::x}}', 'goodbye friend', 'third one'], fn, { combine: true });
    check(combineCalls === 1 && perCalls === 0, '결합: 대상 3블록을 1회 결합 호출(이미지 제외)');
    check(r.blocks[1] === '{{img::x}}', '이미지 블록은 결합서 제외·원문 유지');
    check(r.blocks[0] === 'HELLO THERE' && r.blocks[2] === 'GOODBYE FRIEND' && r.blocks[3] === 'THIRD ONE', '각 구역 재분해·번역 정확');
    check(r.translated === 3, '결합 translated=3');
  }
  // 14) 결합: 블록별 placeholder를 자기 tokens로 복원(인덱스 섞임 없음).
  {
    const fn = async (m, ctx) => (ctx && ctx.combine) ? splitSeg(m).map((s) => s.toUpperCase()).join(SEGJOIN) : m.toUpperCase();
    const r = await translateBlocks(['hi {{img::happy}} there', 'bye <b>x</b> now'], fn, { combine: true });
    check(r.blocks[0] === 'HI {{img::happy}} THERE', '결합 복원: 블록0 자기 토큰');
    check(r.blocks[1] === 'BYE <b>X</b> NOW', '결합 복원: 블록1 자기 토큰(태그만 마스킹, 사이 x는 산문→X)');
  }
  // 15) ★구역 수 불일치(모델이 구분자 누락/합침) → 그 배치만 per-block 순차 폴백.
  {
    let combineCalls = 0, perCalls = 0;
    const fn = async (m, ctx) => { if (ctx && ctx.combine) { combineCalls++; return splitSeg(m).map((s) => s.toUpperCase()).join(' '); } perCalls++; return m.toUpperCase(); };  // 구분자 없앰=합침
    const r = await translateBlocks(['alpha one', 'beta two', 'gamma three'], fn, { combine: true });
    check(combineCalls === 1 && perCalls === 3, '구역 수 불일치 → per-block 폴백(3회)');
    check(r.blocks.join('|') === 'ALPHA ONE|BETA TWO|GAMMA THREE' && r.translated === 3, '폴백으로 전부 정상 번역');
  }
  // 16) 결합 호출 실패 → 그 배치만 격리(per-block 폴백, 폴백 중 실패 블록만 원문 유지).
  {
    const fn = async (m, ctx) => { if (ctx && ctx.combine) throw new Error('combine boom'); if (/beta/i.test(m)) throw new Error('beta boom'); return m.toUpperCase(); };
    const r = await translateBlocks(['alpha one', 'beta two', 'gamma three'], fn, { combine: true });
    check(r.blocks[0] === 'ALPHA ONE' && r.blocks[2] === 'GAMMA THREE', '결합 실패 후 폴백: 정상 블록 번역');
    check(r.blocks[1] === 'beta two' && r.failed.length === 1 && r.failed[0].index === 1, '폴백 중 실패 블록만 격리(원문 유지)');
  }
  // 17) 결합 + skipKorean + 배치 상한: 한국어 스킵, 외국어만 배치(batchCount=2 → 결합 1 + 단독 1).
  {
    let combineCalls = 0;
    const fn = async (m, ctx) => { if (ctx && ctx.combine) { combineCalls++; return splitSeg(m).map((s) => s.toUpperCase()).join(SEGJOIN); } return m.toUpperCase(); };
    const r = await translateBlocks(['한국어 블록입니다', 'foo bar', 'bar baz', 'qux quux'], fn, { combine: true, skipKorean: true, batchCount: 2 });
    check(r.skipped === 1, '결합+skipKorean: 한국어 1블록 스킵');
    check(combineCalls === 1, 'batchCount=2 → 2블록 배치만 결합 호출(나머지 1블록 단독)');
    check(r.blocks[1] === 'FOO BAR' && r.blocks[2] === 'BAR BAZ' && r.blocks[3] === 'QUX QUUX', '외국어 전부 번역');
  }
  // 17-b) ★단독(큰) 블록·순차 경로에도 maxResponse 전달 — 제일 긴 블록이 제일 작은 응답 상한(4096)을 받아 잘리던 것.
  {
    const seen = [];
    const fn = async (m, ctx) => { seen.push(ctx && ctx.maxResponse); return m.toUpperCase(); };
    const big = 'long english text '.repeat(300);   // ≥4000자 → 결합서도 단독 배치
    await translateBlocks([big, 'small one'], fn, { combine: true, maxResponse: 12345 });
    check(seen.length === 2 && seen.every((v) => v === 12345), '결합 모드 단독 블록에 maxResponse 전달');
    const seen2 = [];
    await translateBlocks(['plain text'], async (m, ctx) => { seen2.push(ctx && ctx.maxResponse); return m; }, { maxResponse: 777 });
    check(seen2[0] === 777, '순차(비결합) 경로에도 maxResponse 전달');
  }
  // 18) 진행률(onProgress)은 결합에서도 블록 단위로 total까지 보고.
  {
    const steps = [];
    const fn = async (m, ctx) => (ctx && ctx.combine) ? splitSeg(m).map((s) => s.toUpperCase()).join(SEGJOIN) : m.toUpperCase();
    const r = await translateBlocks(['aa', 'bb', 'cc'], fn, { combine: true, onProgress: (d, t) => steps.push(d + '/' + t) });
    check(steps[steps.length - 1] === '3/3', '결합 onProgress 마지막=3/3');
    check(r.blocks.length === 3, '블록 수 보존');
  }

  console.log(failed === 0 ? '\ntranslateLog: 모든 검사 통과 ✓' : `\ntranslateLog: ${failed}개 실패 ✗`);
  process.exit(failed ? 1 : 0);
})();
