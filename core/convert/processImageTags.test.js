// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/processImageTags.test.js
// 소스 의미 기반 스펙 테스트 (Pro 1.2 process_image_tags 5392-5587 포팅 검증).
// 5패턴/4토큰 resolve + 미지 태그 verbatim + _create_image_html 포맷 핀.
// 실행: node core/convert/processImageTags.test.js
'use strict';
const { processImageTags, collectUrlMappings, extractTagFromMatch, stripUnresolvedAssetImages } = require('./processImageTags.js');

const style = { size: 100, margin: 10, useBorder: false, borderColor: '#000000', useShadow: true };
const map = { happy: 'https://example.com/o.png' };

const EXPECTED_HTML =
  '\n            <div style="margin-bottom:1rem; width:100%; text-align:center;">' +
  '\n                <img style="\n            max-width:100%;\n            margin:10px 0;\n            border-radius:12px;\n        box-shadow:rgba(0,0,0,0.12) 0px 4px 16px;" ' +
  '\n                    src="https://example.com/o.png" alt="happy" class="fr-fic fr-dii">' +
  '\n            </div>\n        ';

let failed = 0;
const check = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { failed++; console.error('  ✗ ' + msg); } };

// 1) 4토큰 resolve, 미지 verbatim
check(processImageTags('{{img::happy}}', map, style).includes('src="https://example.com/o.png"'), '{{img::happy}} resolve');
check(processImageTags('{{img=happy}}', map, style).includes('src="https://example.com/o.png"'), '{{img=happy}} resolve');
check(processImageTags('{{image::happy}}', map, style).includes('src="https://example.com/o.png"'), '{{image::happy}} resolve');
check(processImageTags('<img src="happy">', map, style).includes('src="https://example.com/o.png"'), '<img src="happy"> resolve');
check(processImageTags('{{img::unknown}}', map, style) === '{{img::unknown}}', '미지 태그 verbatim');

// 2) _create_image_html 바이트 핀
check(processImageTags('{{img::happy}}', map, style) === EXPECTED_HTML, '_create_image_html 포맷 정확');

// 3) ″(U+2033) 정규화 — {{img::″happy″}} 도 resolve
check(processImageTags('{{img::″happy″}}', map, style).includes('alt="happy"'), '″(U+2033) 따옴표 정규화 후 resolve');

// 4) 본문 내 혼합 (텍스트 + 태그)
const mixed = processImageTags('인사 {{img::happy}} 끝', map, style);
check(mixed.startsWith('인사 ') && mixed.endsWith(' 끝') && mixed.includes('<img style='), '본문 중간 태그 치환');

// 5) collectUrlMappings: width:0px strip + 정리
const cm = collectUrlMappings([{ tag: 'a', url: 'https://x.com/z.png style="width: 0px; height: 0px;"' }, { tag: 'b.png', url: '//namu.la/i.png?w=1&amp;h=2' }]);
check(cm.a === 'https://x.com/z.png' && cm.b === 'https://namu.la/i.png?w=1&h=2', 'collectUrlMappings: width:0px 제거 + // → https + &amp; 디코드 + .png 키 제거');

// 6) extractTagFromMatch 직접
check(extractTagFromMatch('{{img::cat}}') === 'cat' && extractTagFromMatch('{{img=cat}}') === 'cat', 'extractTagFromMatch :: 와 =');

// 7) 무따옴표 <img src=name> (RisuAI/에셋봇 로그가 흔히 따옴표 없이 씀)
check(extractTagFromMatch('<img src=seolji_excited>') === 'seolji_excited', '무따옴표 src 추출');
check(processImageTags('<img src=happy>', map, style).includes('src="https://example.com/o.png"'), '<img src=happy>(무따옴표) resolve');
check(processImageTags('<img src=unknown>', map, style) === '<img src=unknown>', '무따옴표 미지 태그 verbatim');

// 8) stripUnresolvedAssetImages: 미해결 에셋명 <img>만 제거(엑박 방지), 진짜 URL/데이터/마커는 보존
check(stripUnresolvedAssetImages('<img src="Heilian_Default_seductive smile">') === '', '미해결 에셋명(공백 포함) <img> 제거');
check(stripUnresolvedAssetImages('<img src=seolji_excited>') === '', '무따옴표 에셋명 <img> 제거');
check(stripUnresolvedAssetImages('<img style="x" src="data:image/png;base64,AAAA" class="y">').includes('data:image/png'), 'data: 이미지 보존');
check(stripUnresolvedAssetImages('<img src="https://x.com/a.png">').includes('https://x.com/a.png'), 'http URL 보존');
check(stripUnresolvedAssetImages('<img src="lpblob:' + 'a'.repeat(64) + '">').includes('lpblob:'), 'lpblob 참조 보존(하이드레이트 전)');
check(stripUnresolvedAssetImages('앞 <img src="happy.webp"> 뒤') === '앞  뒤', '에셋명 제거 후 주변 텍스트 보존');
check(stripUnresolvedAssetImages('{{img::happy}} 텍스트') === '{{img::happy}} 텍스트', '{{img::}} 마커는 안 건드림(img 태그 아님)');
check(stripUnresolvedAssetImages('이미지 없음') === '이미지 없음', '<img 없으면 무변경');

if (failed === 0) { console.log('✅ processImageTags: 통과'); process.exit(0); }
else { console.error(`❌ processImageTags: ${failed} 실패`); process.exit(1); }
