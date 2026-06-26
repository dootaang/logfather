// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/cleanup/papaCruft.test.js — 파파 보편 군더더기 제거 검증(보수성·비파괴·idempotent).
'use strict';
const assert = require('assert');
const { stripPapaCruft, papaCruftChanges } = require('./papaCruft.js');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); n++; };

// 1) CoT 커스텀 태그 제거
{
  const h = '<div>본문</div><thinking>몰래 생각</thinking><p>대사</p>';
  const out = stripPapaCruft(h);
  ok(out.indexOf('thinking') < 0 && out.indexOf('몰래 생각') < 0, 'CoT <thinking> 태그 통째 제거');
  ok(out.indexOf('본문') >= 0 && out.indexOf('대사') >= 0, '본문/대사는 보존');
}
{
  const h = '<reasoning>추론</reasoning><analysis>분석</analysis><cot>x</cot>본문';
  const out = stripPapaCruft(h);
  ok(out === '본문', 'reasoning/analysis/cot 모두 제거 + 본문만 남음');
}

// 2) CoT 라벨 <details>만 제거, 일반 접기는 보존
{
  const cot = '<details><summary>Thinking</summary>비밀 추론</details><p>본문</p>';
  const out = stripPapaCruft(cot);
  ok(out.indexOf('비밀 추론') < 0 && out.indexOf('본문') >= 0, 'CoT 라벨(details/summary=Thinking) 제거');
}
{
  const kor = '<details><summary>사고 과정</summary>xxx</details>유지';
  ok(stripPapaCruft(kor) === '유지', '한글 "사고 과정" 라벨 details 제거');
}
{
  const legit = '<details><summary>더보기</summary><p>정당한 접힌 본문</p></details>';
  ok(stripPapaCruft(legit) === legit, '일반 접기(더보기)는 보존(false positive 없음)');
}
{
  const legit2 = '<details open><summary>설정집</summary>세계관</details>';
  ok(stripPapaCruft(legit2) === legit2, '"설정집" 같은 정당한 라벨은 보존');
}

// 3) 디자인(인라인 CSS·svg·img)·구조는 절대 안 건드림
{
  const design = '<style>.x{color:red}</style><svg><path/></svg><img src="http://a/b.png"><div class="card">글</div>';
  ok(stripPapaCruft(design) === design, '디자인(style/svg/img/클래스)은 불변');
}

// 4) idempotent + 변경판정
{
  const h = '<thinking>a</thinking><details><summary>thinking</summary>b</details>본문';
  const once = stripPapaCruft(h);
  ok(stripPapaCruft(once) === once, '두 번 돌려도 동일(idempotent)');
  ok(papaCruftChanges(h) === true && papaCruftChanges('<p>그냥 본문</p>') === false, 'papaCruftChanges 판정 정확');
}

// 5) 빈/평문 안전
ok(stripPapaCruft('') === '' && stripPapaCruft('평문만') === '평문만', '빈/평문 안전');

console.log(`\npapaCruft: 모든 검사 통과 ✓ (${n} assertions)`);
