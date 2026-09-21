// SPDX-License-Identifier: GPL-3.0-or-later
// core/reader/textAnchor.test.js — 형광펜 앵커 생성·복원 검증.
'use strict';
const assert = require('assert');
const { makeAnchor, resolveAnchor, CTX } = require('./textAnchor.js');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); pass++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg + ` (got: ${JSON.stringify(a)})`); console.log('  ✓ ' + msg); pass++; };

const T = '카나시는 창밖을 바라보았다. 비가 내리고 있었다. "왜 이제야 왔어?" 그녀가 물었다. 비가 내리고 있었다. 유나는 대답하지 않았다.';

console.log('makeAnchor:');
const s = T.indexOf('"왜 이제야 왔어?"'), e = s + '"왜 이제야 왔어?"'.length;
const a = makeAnchor(T, s, e);
eq(a.q, '"왜 이제야 왔어?"', '인용 = 구간 텍스트');
eq(a.at, s, '위치 힌트 = start');
ok(a.pre.length <= CTX && T.slice(s - a.pre.length, s) === a.pre, '앞 문맥은 start 직전 텍스트');
ok(a.post.length <= CTX && T.slice(e, e + a.post.length) === a.post, '뒤 문맥은 end 직후 텍스트');
eq(makeAnchor(T, -5, 3).q, T.slice(0, 3), '범위 밖 start는 0으로 클램프');
eq(makeAnchor(T, 10, 5).q, '', 'end<start면 빈 인용');

console.log('resolveAnchor:');
eq(resolveAnchor(T, a), [s, e], '정확 일치(pre+q+post) → 같은 구간');
const P = '앞에 문장이 추가됐다. ';
eq(resolveAnchor(P + T, a), [s + P.length, e + P.length], '앞에 텍스트가 끼어도 찾음(오프셋 이동)');

// 같은 인용이 두 번 — 문맥으로 고른다
const dupQ = '비가 내리고 있었다.';
const first = T.indexOf(dupQ), second = T.indexOf(dupQ, first + 1);
const a2 = makeAnchor(T, second, second + dupQ.length);
eq(resolveAnchor(T, a2), [second, second + dupQ.length], '중복 인용: 문맥으로 두 번째 것을 고름');
const a1 = makeAnchor(T, first, first + dupQ.length);
eq(resolveAnchor(T, a1), [first, first + dupQ.length], '중복 인용: 문맥으로 첫 번째 것을 고름');

// 문맥이 바뀌어도(정리 규칙로 앞 문장이 사라짐) 인용만으로 찾음
const cut = T.replace('카나시는 창밖을 바라보았다. ', '');
const r3 = resolveAnchor(cut, a);
eq(cut.slice(r3[0], r3[1]), a.q, '앞 문맥이 사라져도 인용만으로 찾음');

// 문맥까지 똑같은 중복 → 위치 힌트에 가까운 것
const twin = '같은 문장. 같은 문장. 같은 문장. ' + '같은 문장. 같은 문장. 같은 문장. ';
const hint = twin.indexOf('같은 문장.', 30);
const a4 = { q: '같은 문장.', pre: '', post: '', at: hint };
eq(resolveAnchor(twin, a4)[0], hint, '문맥 동점이면 위치 힌트에 가장 가까운 후보');

// 공백만 다른 경우(줄바꿈·들여쓰기 변화)
const spaced = T.replace('"왜 이제야 왔어?"', '"왜  이제야\n왔어?"');
const r5 = resolveAnchor(spaced, a);
ok(r5 && spaced.slice(r5[0], r5[1]).replace(/\s+/g, ' ') === '"왜 이제야 왔어?"', '공백·줄바꿈만 달라도 찾음(정규화 폴백)');

eq(resolveAnchor(T.replace('"왜 이제야 왔어?"', '"이제 왔구나."'), a), null, '텍스트가 사라지면 null(고아)');
eq(resolveAnchor(T, { q: '', pre: 'x', post: 'y', at: 0 }), null, '빈 인용은 null');
eq(resolveAnchor('', a), null, '빈 본문은 null');
eq(resolveAnchor(T, null), null, '앵커 없음은 null');

// 본문 맨 앞/맨 뒤 인용(문맥 한쪽 없음)
const head = makeAnchor(T, 0, 4);
eq(resolveAnchor(T, head), [0, 4], '맨 앞 인용(pre 없음)');
const tail = makeAnchor(T, T.length - 5, T.length);
eq(resolveAnchor(T, tail), [T.length - 5, T.length], '맨 뒤 인용(post 없음)');

console.log(`\nreader/textAnchor: 모든 검사 통과 ✓ (${pass})`);
