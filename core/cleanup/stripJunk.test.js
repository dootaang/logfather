// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/cleanup/stripJunk.test.js — 가져온 로그 군더더기 제거 검증(결정론).
// A~F 각 패턴 제거 + 실제 본문/마크업 보존 + idempotent. 실행: node core/cleanup/stripJunk.test.js
'use strict';
const { stripJunk } = require('./stripJunk.js');

let failed = 0;
const check = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { failed++; console.error('  ✗ ' + msg); } };

console.log('stripJunk:');

// A. 응답 스캐폴딩 헤더
{
  check(stripJunk('## Response\n그는 웃었다.') === '그는 웃었다.', 'A: "## Response" 헤더 제거');
  check(stripJunk('### 응답\n안녕') === '안녕', 'A: "### 응답" 헤더 제거');
  check(stripJunk('## Chapter 1\n본문').indexOf('Chapter 1') >= 0, 'A: 일반 헤더(Chapter)는 보존');
}
// B. 생각의 사슬(CoT)
{
  check(stripJunk('<details><summary>thinking</summary>비밀 추론</details>\n진짜 대사') === '진짜 대사', 'B: <details> 통째 제거');
  check(stripJunk('<thinking>계획을 세운다</thinking>\n그가 말했다.') === '그가 말했다.', 'B: <thinking> 태그쌍 제거');
  check(stripJunk('<reasoning>\nstep1\nstep2\n</reasoning>\n본문').trim() === '본문', 'B: 여러 줄 <reasoning> 제거');
  check(stripJunk('추론은 없다 <details>만 본문</details>').indexOf('추론은 없다') >= 0, 'B: 본문은 남고 details만 제거');
}
// C. OOC·메타
{
  check(stripJunk('OOC: 이건 메모\n실제 대사') === '실제 대사', 'C: "OOC:" 줄 제거');
  check(stripJunk('그가 말했다. (OOC: 잠깐만) 계속.') === '그가 말했다.  계속.' || stripJunk('그가 말했다. (OOC: 잠깐만) 계속.').indexOf('OOC') < 0, 'C: 인라인 (OOC: …) 제거');
  check(stripJunk('대사 ((메모)) 끝').indexOf('메모') < 0, 'C: ((…)) 제거');
  check(stripJunk('[System] reset\n본문') === '본문', 'C: [System] 줄 제거');
  check(stripJunk("[Author's note] hi\n본문") === '본문', "C: [Author's note] 줄 제거");
}
// D. 코드펜스 래핑
{
  check(stripJunk('```html\n<b>안녕</b>\n```').indexOf('```') < 0 && stripJunk('```html\n<b>안녕</b>\n```').indexOf('안녕') >= 0, 'D: 코드펜스 껍데기만 제거(안쪽 유지)');
  check(stripJunk('```\n본문\n```') === '본문', 'D: 언어 없는 펜스도 제거');
  check(stripJunk('가운데 `code` 인라인').indexOf('`code`') >= 0, 'D: 인라인 백틱은 보존(전체 래핑만)');
}
// E. 화자 라벨
{
  check(stripJunk('AI: 그가 웃었다.') === '그가 웃었다.', 'E: "AI:" 라벨 제거(본문 유지)');
  check(stripJunk('Assistant: "안녕"') === '"안녕"', 'E: "Assistant:" 라벨 제거, 대사 유지');
  check(stripJunk('Narrator: 비가 내렸다.') === '비가 내렸다.', 'E: "Narrator:" 라벨 제거');
  check(stripJunk('{{char}}: 안녕') === '안녕', 'E: "{{char}}:" 라벨 제거(마스킹된 토큰)');
  check(stripJunk('5:30에 만나자') === '5:30에 만나자', 'E: 라벨 아닌 콜론(시간)은 보존');
}
// F. 상태창/구분선(opt-in)
{
  check(stripJunk('Status: HP 100\n본문', { statusBlocks: true }) === '본문', 'F: statusBlocks on → "Status:" 줄 제거');
  check(stripJunk('Status: HP 100\n본문').indexOf('Status') >= 0, 'F: 기본 off → Status 보존');
  check(stripJunk('A\n---\nB', { dividers: true }).indexOf('---') < 0, 'F: dividers on → 구분선 제거');
}
// ★보존: 대사·이미지·에셋마커·카드 구조는 절대 안 깨짐
{
  const rp = '그녀가 "안녕!" 하며 *손을 흔들었다*. {{img::happy}} [🌠|aoi.smile]';
  check(stripJunk(rp) === rp, '보존: 대사·별표·이미지·마커 그대로');
  const html = '<div style="x"><img src="a.png" class="fr-fic"></div>\n"대사"';
  check(stripJunk(html).indexOf('<img src="a.png"') >= 0 && stripJunk(html).indexOf('"대사"') >= 0, '보존: 카드 html·이미지 그대로');
}
// idempotent
{
  const messy = '## Response\nAI: <thinking>음</thinking>그가 "안녕" 했다. (OOC: 끝)';
  const once = stripJunk(messy); const twice = stripJunk(once);
  check(once === twice, 'idempotent: 두 번 돌려도 동일');
  check(once.indexOf('안녕') >= 0 && once.indexOf('OOC') < 0 && once.indexOf('thinking') < 0, '복합: 본문만 남음');
}

console.log(failed ? `\nstripJunk: 실패 ${failed}` : '\nstripJunk: 모든 검사 통과 ✓');
process.exit(failed ? 1 : 0);
