// SPDX-License-Identifier: GPL-3.0-or-later
// core/card/customImageTags.test.js — 모듈 전용 이미지 태그 학습(에셋 입히기 0/0 수정) 검증.
'use strict';
const assert = require('assert');
const { deriveImageTagRules, collectCustomImageRefs, rewriteCustomImageTags } = require('./customImageTags.js');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); pass++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg + ` (got: ${JSON.stringify(a)})`); console.log('  ✓ ' + msg); pass++; };

// 실제 산해경 모듈 규칙(2026-10-04 제보 파일에서 그대로)
const SANHAE = {
  in: '<img\\s*sh\\s*=\\s*"?([^">]+)"?>',
  out: '<style> .sh-imgbox{display:grid;} </style><div class="sh-imgbox"><img class="sh-img" src="{{raw::{{random::{{spread::{{filter::{{split::{{#each {{module_assetlist::산해경통합에셋}} a}} {{#if {{equal::{{slot::a}}::$1}}}} {{slot::a}}$$ {{/if}} {{/each}}::$$}}}}}}}}}}"></div>',
  type: 'editdisplay', flag: 'g',
};
const AOI = { in: '<aoiimg src="(.*?)">', out: '<div style="background-image: url(\'{{raw::$1}}\');"></div>', type: 'editdisplay' };
const TWO = { in: '<pic who="([^"]+)" mood="([^"]+)">', out: '<b>$1</b>{{img::$2}}', type: 'editdisplay' };
const NOASSET = { in: '<hp>(\\d+)</hp>', out: '<span>HP $1</span>', type: 'editdisplay' };
const INPUT_ONLY = { in: '<x n="(\\w+)">', out: '{{img::$1}}', type: 'editinput' };
const BAD = { in: '(a+)+$', out: '{{raw::$1}}', type: 'editdisplay' };
const BROKEN = { in: '([unclosed', out: '{{raw::$1}}', type: 'editdisplay' };
const OUT_OF_RANGE = { in: '<y>', out: '{{img::$1}}', type: 'editdisplay' };

console.log('deriveImageTagRules:');
const rules = deriveImageTagRules([SANHAE, AOI, TWO, NOASSET, INPUT_ONLY, BAD, BROKEN, OUT_OF_RANGE, SANHAE]);
eq(rules.length, 3, '에셋 CBS를 쓰는 표시 규칙 3개만(산해경·아오이·2그룹), 중복 1개 제거');
eq(rules[0].group, 1, '산해경: 중첩 CBS 안의 $1 = 에셋 이름');
eq(rules[2].group, 2, '두 캡처 중 에셋 CBS 뒤에 나오는 $2를 이름으로');
ok(!rules.some((r) => r.source.includes('hp')), '에셋 CBS 없는 규칙(HP 표시)은 제외');
ok(!rules.some((r) => r.source.includes('x n=')), '입력 전처리(editinput) 규칙은 제외');
ok(!rules.some((r) => r.source.includes('a+')), 'ReDoS 의심 패턴은 제외');
eq(deriveImageTagRules([OUT_OF_RANGE]).length, 0, '캡처 그룹이 없는데 $1을 쓰면 제외');
eq(deriveImageTagRules(null).length, 0, '입력 없음 = 빈 배열');

console.log('collectCustomImageRefs:');
const html = '미나는 말했다.\n<img sh="mina_suspicious">\n<p>루미</p><img sh=rumi_curious>\n<aoiimg src="aoi_happy">\n<pic who="미나" mood="mina_blushing shyly">';
const refs = [...collectCustomImageRefs(html, rules, new Set())].sort();
eq(refs, ['aoi_happy', 'mina_blushing shyly', 'mina_suspicious', 'rumi_curious'], '따옴표 있음/없음·다른 모듈 태그·공백 있는 이름까지 수집');
eq([...collectCustomImageRefs('', rules, new Set())], [], '빈 본문 = 수집 없음');
eq([...collectCustomImageRefs(html, [], new Set())], [], '규칙 없음 = 수집 없음');

console.log('rewriteCustomImageTags:');
const have = new Set(['mina_suspicious', 'aoi_happy', 'mina_blushing shyly']);
const rw = rewriteCustomImageTags(html, rules, (n) => have.has(n));
ok(rw.includes('{{img::mina_suspicious}}'), '카드에 있는 이름 → 표준 {{img::}} 태그');
ok(rw.includes('{{img::aoi_happy}}'), '다른 모듈 태그도 표준화');
ok(rw.includes('{{img::mina_blushing shyly}}'), '공백 있는 이름 보존');
ok(rw.includes('<img sh=rumi_curious>'), '카드에 없는 이름은 원문 그대로(다른 카드로 다시 입힐 수 있게)');
ok(!rw.includes('<b>'), '태그 자리만 바뀌고 규칙의 나머지 출력(장식)은 끼워넣지 않음');
eq(rewriteCustomImageTags('본문만', rules, () => true), '본문만', '태그 없는 본문은 무변경');
eq(rewriteCustomImageTags('<img sh="a{b}">', rules, () => true), '<img sh="a{b}">', '중괄호 든 이름은 CBS 깨짐 방지로 원문 유지');

console.log(`\ncard/customImageTags: 모든 검사 통과 ✓ (${pass})`);
