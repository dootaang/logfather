// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/logDiary.test.js
// 출력 디자인 "로그 다이어리"(log-diary 이식, 1단계 골격) 검증.
//  - 미선택(card)이면 기존 출력 그대로(파리티) · 선택 시 표지+테마+본문이 다이어리 레이아웃으로.
//  - ★아카 불변식: 출력에 background-image / <style> / <iframe> / px치수 단위 없음, 사용자 텍스트는 이스케이프.
'use strict';
const assert = require('assert');
const { convertText } = require('./convertText.js');
const { parseBundle } = require('../preset/bundle.js');
const { TEMPLATE_ORDER, normalizeTemplateId } = require('./templates/registry.js');

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); n++; };
const base = () => parseBundle({}).settings;
const diary = (cfg, text) => {
  const s = base();
  s.template = 'log-diary';
  s.templateSettings = { 'log-diary': cfg };
  return convertText(text, s);
};

// ── 드롭다운 순서: 기본 카드 ↔ 고급 CSS 커스텀 사이 ──
{
  const i = TEMPLATE_ORDER.indexOf('log-diary');
  const ic = TEMPLATE_ORDER.indexOf('custom-css');
  ok(TEMPLATE_ORDER[0] === 'card', '첫 항목은 기본 카드');
  ok(TEMPLATE_ORDER[TEMPLATE_ORDER.length - 1] === 'papa', '마지막 항목은 파파모드');   // papa는 custom-css 밑(맨 끝)에 추가됨
  ok(i > 0 && i < ic, 'log-diary는 card와 custom-css 사이');
  ok(normalizeTemplateId('log-diary') === 'log-diary', 'log-diary는 유효 템플릿');
  ok(normalizeTemplateId('papa') === 'papa', 'papa는 유효 템플릿');
  ok(normalizeTemplateId('nope') === 'card', '미지 템플릿은 card 폴백');
}

// ── 카드(미선택)는 파리티 ──
{
  const s = base();
  const card = convertText('안녕하세요.', s);
  ok(card.includes('max-width:600px'), 'card 기본: 600px 카드 유지');
  ok(!card.includes('900px'), 'card 기본: 다이어리 900px 컨테이너 없음');
}

// ── 표지 + 테마 + 본문 ──
{
  const out = diary(
    { theme: 'oldMoneyDark', coverArchiveNo: 'NO. 001', coverTitle: '밤의 일기', coverSubtitle: '어느 겨울', pageTitle: '1장' },
    '그녀가 "안녕!" 하고 말했다.\n\n조용한 방이었다.'
  );
  ok(out.includes('밤의 일기'), '표지 제목 출력');
  ok(out.includes('어느 겨울'), '표지 부제 출력');
  ok(out.includes('NO. 001'), '표지 번호 출력');
  ok(out.includes('1장'), '페이지 제목 출력');
  ok(out.includes('#141e23'), '선택 테마(oldMoneyDark) 배경색 적용');
  ok(out.includes('max-width:900px'), '다이어리 900px 컨테이너');
  ok(out.includes('안녕'), '본문 대사 변환됨');
  ok(out.includes('조용한 방이었다'), '본문 나레이션 보존');
}

// ── 아카 불변식 ──
{
  const out = diary(
    { theme: 'basic', coverTitle: '제목', coverImage: 'data:image/png;base64,iVBORw0KGgo=' },
    '본문입니다.'
  );
  ok(!out.includes('background-image'), '출력에 background-image 없음(아카 strip 회피)');
  ok(!out.includes('<style'), '출력에 <style> 없음');
  ok(out.indexOf('<iframe') < 0, '출력에 <iframe> 없음(1단계는 사운드트랙 제외)');
  ok(out.includes('data:image/png;base64,iVBORw0KGgo='), '표지 이미지는 인라인 <img src=data:>로');
  ok(out.includes('max-width:100%'), '표지 이미지 크기는 max-width:%(아카 생존 단위)');
}

// ── 사용자 텍스트 이스케이프(XSS 방지) ──
{
  const out = diary({ theme: 'basic', coverTitle: '<img src=x onerror=alert(1)>' }, '본문');
  ok(out.includes('&lt;img src=x'), '표지 제목의 꺾쇠가 이스케이프됨');
  ok(out.indexOf('<img src=x onerror') < 0, '원본 주입 태그가 출력에 그대로 안 들어감');
}

// ── 프로필(최대 6) + 코멘트 + 추가설명/Story So Far (2단계) ──
{
  const out = diary({
    theme: 'rose',
    profiles: [
      { image: 'data:image/png;base64,iVBORw0KGgo=', tag: 'MAIN', name: '아리아', desc: '첫째 줄\n둘째 줄' },
      { name: '루나', desc: '설명만' },
    ],
    intro: '추가 설명 텍스트.',
    summary: '지금까지의 줄거리.',
    comment: { nickname: '작가', text: '"재밌었다!" 하고 적었다.' },
  }, '본문 한 줄.');
  ok(out.includes('Profile'), '프로필 섹션 헤더 출력');
  ok(out.includes('아리아') && out.includes('루나'), '프로필 이름들 출력');
  ok(out.includes('MAIN'), '프로필 태그 출력');
  ok(out.includes('첫째 줄<br>둘째 줄'), '프로필 설명 줄바꿈 → <br>');
  ok(out.includes('border-radius:50%'), '프로필 이미지는 동그라미(인라인 <img>)');
  ok(out.includes('추가 설명 텍스트'), '추가 설명 출력');
  ok(out.includes('Story So Far') && out.includes('지금까지의 줄거리'), 'Story So Far 출력');
  ok(out.includes('Comment') && out.includes('재밌었다'), '코멘트 섹션 출력');
  ok(out.includes('BY 작가'), '코멘트 닉네임(BY) 출력');
  ok(!out.includes('background-image'), '프로필/코멘트도 background-image 없음(아카 호환)');
}

// ── 프로필 최대 6개 cap + 빈 코멘트 숨김 ──
{
  const many = Array.from({ length: 9 }, (_, i) => ({ name: 'P' + i }));
  const out = diary({ theme: 'basic', profiles: many, comment: { nickname: '', text: '' } }, '본문');
  ok((out.match(/P[0-8]/g) || []).length === 6, '프로필은 최대 6개만 렌더(P0~P5)');
  ok(out.indexOf('Comment') < 0, '코멘트 내용 비면 코멘트 섹션 미출력');
}

// ── 프로필/코멘트 XSS 이스케이프 ──
{
  const out = diary({ theme: 'basic', profiles: [{ name: '<b>x</b>', desc: 'a' }], comment: { nickname: '<i>n</i>', text: '본문' } }, '본문');
  ok(out.includes('&lt;b&gt;x&lt;/b&gt;'), '프로필 이름 이스케이프');
  ok(out.includes('BY &lt;i&gt;n&lt;/i&gt;'), '코멘트 닉네임 이스케이프');
}

// ── 다중 페이지([페이지] 마커) (3단계) ──
{
  const out = diary({ theme: 'basic' }, '첫 페이지.\n[페이지: 두번째 | 부제]\n둘째 페이지.\n[페이지]\n셋째.');
  ok(out.includes('첫 페이지') && out.includes('둘째 페이지') && out.includes('셋째'), '세 페이지 본문 모두 렌더');
  ok(out.includes('두번째'), '마커 제목 출력');
  ok(out.includes('부제'), '마커 부제 출력');
  ok((out.match(/style="display:table;width:100%;margin-bottom/g) || []).length === 3, '페이지 3개 = 번호 헤더 3개');
  ok(out.indexOf('[페이지') < 0, '마커 원문은 출력에 안 남음');
}
{
  // 단일 페이지(마커 없음)는 기존 중앙 헤더 + 번호 없음
  const out = diary({ theme: 'basic', pageTitle: '제목' }, '본문.');
  ok(out.includes('text-align:center') && out.includes('제목'), '단일 페이지: 중앙 정렬 헤더');
  ok(out.indexOf('display:table;width:100%;margin-bottom') < 0, '단일 페이지: 번호 헤더 없음(파리티 느낌)');
}

// ── 페이지 블록(cfg.pages) 우선, 입력 마커는 폴백 (B: 페이지 UI) ──
{
  const out = diary({ theme: 'basic', pages: [
    { title: '서장', content: '첫 페이지.' },
    { title: '본장', subtitle: '깊은 밤', content: '둘째 페이지.' },
  ] }, '입력란 내용은 무시됨 [페이지] 마커도 무시');
  ok(out.includes('첫 페이지') && out.includes('둘째 페이지'), 'cfg.pages의 두 페이지 렌더');
  ok(out.includes('서장') && out.includes('본장') && out.includes('깊은 밤'), '페이지별 제목/부제');
  ok((out.match(/style="display:table;width:100%;margin-bottom/g) || []).length === 2, '페이지 2개 = 번호 헤더 2개');
  ok(out.indexOf('입력란 내용은 무시됨') < 0, 'cfg.pages 있으면 입력란 텍스트는 안 쓰임');
}
{
  // cfg.pages 비면 입력 마커 폴백(레거시)
  const out = diary({ theme: 'basic', pages: [] }, '에이.\n[페이지]\n비.');
  ok(out.includes('에이') && out.includes('비'), '페이지 빈 배열 → 입력 [페이지] 마커 폴백');
}

// ── 구분선은 빈 div가 아니어야 함(아카가 빈 div 자동 제거 → 구분선 사라짐) ──
{
  const single = diary({ theme: 'basic', pageTitle: '제목' }, '본문.');
  ok(single.indexOf('"></div>') < 0 || !/height:1px[^>]*"><\/div>/.test(single), '단일 페이지 구분선이 빈 div 아님');
  ok(/height:1px[^>]*"><br><\/div>/.test(single), '단일 페이지 구분선에 <br>(아카 빈요소 제거 회피)');
  // 다중 페이지(번호 헤더)는 제목/부제 밑 구분선 제거됨(사용자 요청).
  const multi = diary({ theme: 'basic' }, '하나.\n[페이지]\n둘.');
  ok(multi.indexOf('height:1px') < 0, '다중 페이지 번호 헤더엔 밑줄 없음(제거)');
}

// ── 하위호환: itemType 없는 항목은 페이지로(텍스트 헤더) + 섹션 src 살균 ──
{
  const out = diary({ theme: 'basic', pages: [
    { title: '1장', content: '본문 하나.' },
    { title: '2장', content: '본문 둘.' },
  ] }, '무시');
  ok(out.includes('1장') && out.includes('2장'), 'itemType 없는 항목 = 페이지(제목 텍스트 출력)');
  ok(!out.includes('background-image'), 'background-image 안 씀(아카 호환)');
}
{
  // 섹션의 raw image는 코어가 직접 그리지 않고(web이 구운 bakedSection만 출력), 위험 src는 출력에 없음
  const out = diary({ theme: 'basic', pages: [{ itemType: 'section', title: 'S', image: 'javascript:alert(1)' }] }, '무시');
  ok(out.indexOf('javascript:alert') < 0, '위험한 섹션 이미지 src 차단(코어는 raw image 미출력)');
}

// ── 표지 태그(모델·프롬프트 칩, log-diary 기능 이식) ──
{
  // 안 굽는 경로(safe variant): 표지 텍스트 아래 HTML 칩
  const out = diary({ theme: 'basic', coverTitle: '제목', coverTags: ['GPT 5.5', '잠열 프롬프트 1.7'] }, '본문.');
  ok(out.includes('GPT 5.5') && out.includes('잠열 프롬프트 1.7'), '표지 태그 칩 출력');
  ok((out.match(/border:1px solid/g) || []).length >= 2, '태그가 테두리 칩(2개+)');
  ok(out.includes('&lt;') === false || !/coverTags/.test(out), '정상');
  // 굽기 모드면 표지가 한 장 이미지라 태그는 캔버스에 구워짐(HTML엔 칩 없음) — bakedCover 경로
  const baked = diary({ theme: 'basic', coverTitle: '제목', coverTags: ['모델X'], coverBake: true, bakedCover: 'data:image/jpeg;base64,/9j/x==' }, '본문.');
  ok(baked.indexOf('모델X') < 0, '굽기 모드: 태그는 이미지에 구워져 HTML 텍스트엔 없음');
}
{
  const out = diary({ theme: 'basic', coverTitle: '제목', coverTags: ['<b>x</b>'] }, '본문.');
  ok(out.includes('&lt;b&gt;x'), '표지 태그 XSS 이스케이프');
}

// ── 표지 글씨 크기 배율(coverTextScale) ──
{
  const big = diary({ theme: 'basic', coverTitle: '제목', coverTextScale: 2.0 }, '본문.');
  const small = diary({ theme: 'basic', coverTitle: '제목', coverTextScale: 1.0 }, '본문.');
  ok(big.includes('84px') && !small.includes('84px'), '배율 2.0 → 제목 84px');
  ok(small.includes('42px'), '배율 1.0 → log-diary 기본 42px');
  const def = diary({ theme: 'basic', coverTitle: '제목' }, '본문.');
  ok(def.includes('63px'), '기본 배율 1.5 → 제목 63px');
}

// ── 섹션(챕터) 항목: 구운 띠(bakedSection)가 카드 맨 위, 뒤따르는 페이지들을 한 카드로 묶음 (log-diary Story 구조) ──
{
  const band = 'data:image/jpeg;base64,/9j/sec==';
  const out = diary({ theme: 'basic', pages: [
    { itemType: 'section', title: 'Section Title', subtitle: 'Story', bakedSection: band },
    { itemType: 'page', title: '만남', content: '본문1.' },
    { itemType: 'page', title: '재회', content: '본문2.' },
  ] }, '무시');
  ok(out.includes(band), '섹션 띠(bakedSection) 이미지 출력');
  ok(/class="[^"]*lp-baked/.test(out), '섹션 띠는 lp-baked(복사 시 재인코딩 건너뜀)');
  ok(out.includes('border-radius:1rem 1rem 0 0'), '섹션 띠 위 모서리 둥글기');
  ok(out.indexOf(band) < out.indexOf('만남'), '섹션 띠가 첫 페이지보다 위');
  ok(out.includes('만남') && out.includes('재회'), '뒤따르는 페이지 제목은 텍스트로(각자 제목)');
  ok((out.match(/border-radius:1rem;overflow:hidden/g) || []).length === 1, '섹션+페이지들이 한 카드로 묶임');
  // 이미지 없는 섹션 = 텍스트 구분선(제목/부제)
  const txt = diary({ theme: 'basic', pages: [
    { itemType: 'section', title: '2막', subtitle: 'Chapter 2' },
    { itemType: 'page', content: '본문.' },
  ] }, '무시');
  ok(txt.includes('2막') && txt.includes('Chapter 2'), '이미지 없는 섹션은 텍스트 라벨(제목·부제)');
  // 페이지 번호는 섹션마다 1부터 리셋
  const reset = diary({ theme: 'basic', pages: [
    { itemType: 'section', title: 'A', bakedSection: band },
    { itemType: 'page', content: 'a1.' }, { itemType: 'page', content: 'a2.' },
    { itemType: 'section', title: 'B', bakedSection: band },
    { itemType: 'page', content: 'b1.' },
  ] }, '무시');
  ok((reset.match(/>1</g) || []).length === 2, '페이지 번호가 섹션마다 1부터 리셋(>1< 두 번)');
  // 접기 ON: summary는 이미지 없는 텍스트 헤더(아카 이미지 클릭 가로채기 회피), 띠는 <details> 바깥 위.
  const col = diary({ theme: 'basic', collapse: true, pages: [
    { itemType: 'section', title: 'S', bakedSection: band }, { itemType: 'page', title: '챕터1', content: '본문.' },
  ] }, '무시');
  ok(col.includes('<details'), '접기 → <details>');
  ok(col.indexOf('lp-baked') < col.indexOf('<details'), '구운 띠는 <details> 바깥 위');
  const sm = col.slice(col.indexOf('<summary'), col.indexOf('</summary>'));
  ok(sm.indexOf('lp-baked') < 0 && sm.indexOf(band) < 0, 'summary엔 이미지 없음(클릭 토글 보장)');
}

// ── 아카 대표 썸네일 고정(forceThumbnail): 글 맨 위 숨김 0x0 <img> ──
{
  const cv = 'data:image/png;base64,iVBORxx==';
  const off = diary({ theme: 'basic', coverImage: cv, pages: [{ content: '본문.' }] }, '무시');
  ok(off.indexOf('width:0px;height:0px') < 0, '기본(off)이면 숨김 썸네일 없음');
  const on = diary({ theme: 'basic', coverImage: cv, forceThumbnail: true, pages: [{ content: '본문.' }] }, '무시');
  ok(/width:0px;height:0px/.test(on), 'forceThumbnail → 0x0 숨김 img');
  ok(on.indexOf(cv) !== on.lastIndexOf(cv), '표지가 두 번(숨김 썸네일 + 보이는 표지)');
  ok(on.indexOf('width:0px;height:0px') < on.lastIndexOf(cv), '숨김 썸네일이 보이는 표지보다 앞(첫 이미지=대표)');
  ok(on.indexOf('<img') < on.indexOf('box-sizing'), '숨김 썸네일이 첫 컨테이너(표지/본문)보다 앞');
  // 표지 없으면 첫 섹션 띠를 대표로
  const sb = 'data:image/png;base64,iVBORsec==';
  const noCover = diary({ theme: 'basic', forceThumbnail: true, pages: [
    { itemType: 'section', title: 'S', bakedSection: sb }, { itemType: 'page', content: '본문.' },
  ] }, '무시');
  ok(noCover.indexOf('width:0px;height:0px') >= 0 && noCover.indexOf(sb) >= 0, '표지 없으면 첫 섹션 띠로 썸네일');
}

// ── 페이지 헤더 ⌵ 화살표(접기 시, log-diary 디테일) ──
{
  const on = diary({ theme: 'basic', collapse: true }, '하나.\n[페이지]\n둘.');
  ok(on.includes('⌵'), '접기 다중 페이지 헤더에 ⌵ 화살표');
  const off = diary({ theme: 'basic' }, '하나.\n[페이지]\n둘.');
  ok(off.indexOf('⌵') < 0, '접기 off면 ⌵ 없음');
}

// ── 표지 굽기(B): bakedCover 있으면 그 한 장만, 텍스트는 이미지에 구워져 본문에 없음 ──
{
  const baked = 'data:image/jpeg;base64,/9j/4AAQSkZJRn==';
  const on = diary({ theme: 'basic', coverImage: 'data:image/png;base64,iVBORw0KGgo=', coverTitle: '구운제목', coverBake: true, bakedCover: baked }, '본문.');
  ok(on.includes(baked), '구운 표지 이미지가 출력됨');
  ok(/class="[^"]*lp-baked/.test(on), '구운 표지는 lp-baked 클래스(복사 시 재인코딩 건너뜀)');
  ok(on.indexOf('구운제목') < 0, '제목은 이미지에 구워져 HTML 텍스트로는 없음');
  // 굽기 켰지만 아직 bakedCover 없으면(굽는 중) 일반 표지로 폴백
  const pending = diary({ theme: 'basic', coverImage: 'data:image/png;base64,iVBORw0KGgo=', coverTitle: '제목', coverBake: true }, '본문.');
  ok(pending.includes('제목'), '굽기 켰지만 결과 없으면 일반 표지(텍스트)로 폴백');
}

// ── 이미지 비율(표지 높이 제한) ── 섹션 띠는 굽기(4:1 고정)라 비율은 표지에만 적용.
{
  const img = 'data:image/png;base64,iVBORw0KGgo=';
  const on = diary({ theme: 'basic', coverImage: img, imageRatio: 'wide', pages: [{ itemType: 'page', content: '본문.' }] }, '무시');
  ok((on.match(/aspect-ratio:21\/9/g) || []).length === 1, '와이드 비율이 표지에 적용');
  const off = diary({ theme: 'basic', coverImage: img }, '본문.');
  ok(off.indexOf('aspect-ratio') < 0, '기본(원본 비율)은 aspect-ratio 없음');
  const bad = diary({ theme: 'basic', coverImage: img, imageRatio: '없는값' }, '본문.');
  ok(bad.indexOf('aspect-ratio') < 0, '알 수 없는 비율은 무시(원본)');
}

// ── 사운드트랙(유튜브 썸네일+링크, iframe 미사용) (3단계) ──
{
  const out = diary({ theme: 'basic', soundtrack: { url: 'https://youtu.be/dQw4w9WgXcQ', title: '곡명', artist: '가수' } }, '본문.');
  ok(out.includes('Soundtrack'), '사운드트랙 헤더 출력');
  ok(out.includes('img.youtube.com/vi/dQw4w9WgXcQ/'), '유튜브 썸네일 이미지');
  ok(out.includes('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"'), '영상 링크');
  ok(out.indexOf('<iframe') < 0, 'iframe 미사용(아카 strip 회피)');
  ok(out.includes('곡명') && out.includes('가수'), '곡명/아티스트 출력');
}
{
  const out = diary({ theme: 'basic', soundtrack: { url: '잘못된 주소' } }, '본문.');
  ok(out.indexOf('Soundtrack') < 0, '유효하지 않은 유튜브 URL이면 사운드트랙 미출력');
}

// ── 페이지 접기(<details>) (3단계, 옵션) ──
{
  const on = diary({ theme: 'basic', collapse: true, pageTitle: '제목' }, '접히는 본문.');
  ok(on.includes('<details') && on.includes('<summary'), '접기 on → <details>/<summary>');
  ok(on.includes('접히는 본문'), '접기 본문 내용 포함');
  const off = diary({ theme: 'basic', pageTitle: '제목' }, '본문.');
  ok(off.indexOf('<details') < 0, '접기 off(기본) → <details> 없음');
}

// ── 표지 그라데이션 오버레이 (B) ──
{
  const img = 'data:image/png;base64,iVBORw0KGgo=';
  const on = diary({ theme: 'basic', coverImage: img, coverTitle: '제목', coverOverlay: true }, '본문.');
  ok(on.includes('linear-gradient(to top'), '오버레이 on → 그라데이션 페이드');
  ok(on.includes('position:absolute'), '오버레이 글씨는 이미지 위에(absolute)');
  ok(on.includes('color:#ffffff') || on.includes('color:rgba(255,255,255'), '오버레이 제목은 흰 글씨');
  ok(on.includes(img), '표지 이미지는 인라인 <img>(아카 업로드)');
  const off = diary({ theme: 'basic', coverImage: img, coverTitle: '제목', coverOverlay: false }, '본문.');
  ok(off.indexOf('linear-gradient') < 0, '오버레이 off → 그라데이션 없음(안전변형)');
  ok(off.includes('color:#162a3e') || off.indexOf('rgba(255,255,255') < 0, '안전변형은 흰 글씨 아님(테마 색)');
}

// ── 대사 배경 하이라이트 (B) ──
{
  const on = diary({ theme: 'basic', quoteHighlight: true }, '그가 "안녕" 하고 ‘속말’ 했다.');
  ok(on.includes('background-color:#f0f2f5'), '하이라이트 on → 대사/속마음 배경색(테마 quote)');
  ok(on.includes('border-radius:2px'), '하이라이트 칩 라운드');
  const off = diary({ theme: 'basic', quoteHighlight: false }, '그가 "안녕" 했다.');
  ok(off.indexOf('background-color:#f0f2f5') < 0, '하이라이트 off → 대사 배경 없음(색 글씨만)');
}

// ── 하이라이트는 기본 카드에 영향 없음(골든 파리티 보호) ──
{
  const s = base();
  const card = convertText('그가 "안녕" 했다.', s);
  ok(card.indexOf('background-color:') < 0 || card.indexOf('border-radius:2px') < 0, 'card 대사에는 배경 하이라이트 없음(파리티)');
}

// ── 빈 표지/페이지면 해당 영역 미출력 ──
{
  const out = diary({ theme: 'basic' }, '본문만 있음.');
  ok(out.includes('본문만 있음'), '표지 없이도 본문 렌더');
  ok(out.includes('max-width:900px'), '본문 컨테이너는 항상 존재');
}

console.log(`\n✅ logDiary: 로그 다이어리 출력 디자인 통과 (${n} assertions)`);
