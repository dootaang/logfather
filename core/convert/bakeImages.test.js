// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/bakeImages.test.js — 이미지 굳히기 순수 변환부 검증.
// 외부 이미지 수집 / fetcher 주입 굳히기 / 실패 격리 / idempotent / 엔티티·따옴표 / data: 보존.
// 실행: node core/convert/bakeImages.test.js
'use strict';
const { externalImageUrls, bakeImages, applyBaked } = require('./bakeImages.js');

let failed = 0;
const check = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { failed++; console.error('  ✗ ' + msg); } };

// 작은 1x1 png data URL(테스트용 가짜 박제 결과).
const DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const okFetcher = async () => ({ ok: true, dataUrl: DATA });

(async () => {
  // 1) 외부 이미지 수집: http/https만, data:/상대경로 제외, 중복 제거.
  {
    const html = '<img src="https://a.com/1.png"><img src="http://b.com/2.jpg">' +
      '<img src="data:image/png;base64,xxx"><img src="local.png">' +
      '<img src="https://a.com/1.png">';
    const urls = externalImageUrls(html);
    check(urls.length === 2, '외부 이미지 2개만 수집(중복·data:·상대 제외)');
    check(urls.includes('https://a.com/1.png') && urls.includes('http://b.com/2.jpg'), '수집 URL 정확');
  }

  // 2) 굳히기: 외부 src가 data URL로 교체, data:·상대는 그대로.
  {
    const html = '<img src="https://a.com/1.png" class="x"><img src="data:image/gif;base64,zzz"><img src="rel.png">';
    const r = await bakeImages(html, okFetcher);
    check(r.total === 1 && r.baked === 1 && r.failed.length === 0, '외부 1개 굳음(total=1,baked=1)');
    check(r.html.indexOf('https://a.com/1.png') < 0, '외부 URL 사라짐');
    check(r.html.indexOf(DATA) >= 0, 'data URL로 교체됨');
    check(r.html.indexOf('data:image/gif;base64,zzz') >= 0, '이미 data:인 이미지 보존');
    check(r.html.indexOf('rel.png') >= 0, '상대경로 이미지 보존');
    check(/class="x"/.test(r.html), '다른 속성(class) 보존');
  }

  // 3) idempotent: 굳은 결과를 다시 굳혀도 외부 0개(재실행 안전).
  {
    const html = '<img src="https://a.com/1.png">';
    const once = await bakeImages(html, okFetcher);
    const twice = await bakeImages(once.html, okFetcher);
    check(twice.total === 0 && twice.baked === 0, '재실행 시 외부 이미지 0(idempotent)');
    check(twice.html === once.html, '두 번째 굳히기는 변화 없음');
  }

  // 4) 실패 격리: 죽은 링크는 src 유지 + failed에 기록, 다른 이미지는 정상 굳음.
  {
    const html = '<img src="https://dead.com/x.png"><img src="https://ok.com/y.png">';
    const fetcher = async (url) => url.indexOf('dead') >= 0 ? { ok: false, error: '404' } : { ok: true, dataUrl: DATA };
    const r = await bakeImages(html, fetcher);
    check(r.total === 2 && r.baked === 1, '둘 중 하나만 굳음');
    check(r.failed.length === 1 && r.failed[0].url.indexOf('dead') >= 0 && r.failed[0].error === '404', '죽은 링크 failed 보고');
    check(r.html.indexOf('https://dead.com/x.png') >= 0, '죽은 링크 src는 손상 없이 그대로');
    check(r.html.indexOf(DATA) >= 0, '살아있는 이미지는 굳음');
  }

  // 5) fetcher가 throw 해도 전체가 안 죽고 그 이미지만 실패 처리.
  {
    const html = '<img src="https://boom.com/x.png">';
    const fetcher = async () => { throw new Error('네트워크 끊김'); };
    const r = await bakeImages(html, fetcher);
    check(r.baked === 0 && r.failed.length === 1 && r.failed[0].error === '네트워크 끊김', 'throw 격리 → failed 기록');
    check(r.html === html, '실패 시 html 무손상');
  }

  // 6) &amp; 엔티티: fetcher엔 디코드된 URL, 태그 치환은 정상.
  {
    const html = '<img src="https://a.com/i?x=1&amp;y=2">';
    let got = '';
    const fetcher = async (url) => { got = url; return { ok: true, dataUrl: DATA }; };
    const r = await bakeImages(html, fetcher);
    check(got === 'https://a.com/i?x=1&y=2', 'fetcher는 &amp;→& 디코드된 URL 받음');
    check(r.baked === 1 && r.html.indexOf(DATA) >= 0, '엔티티 URL도 정상 굳음');
  }

  // 7) 따옴표 2종 + 무따옴표 처리.
  {
    const html = "<img src='https://q.com/s.png'><img src=https://q.com/u.png>";
    const urls = externalImageUrls(html);
    check(urls.length === 2, '작은따옴표·무따옴표 src 모두 수집');
    const r = await bakeImages(html, okFetcher);
    check(r.baked === 2 && (r.html.match(/data:image\/png/g) || []).length === 2, '둘 다 큰따옴표 data URL로 교체');
  }

  // 8) applyBaked 단독: 매핑에 있는 것만 교체.
  {
    const html = '<img src="https://a.com/1.png"><img src="https://b.com/2.png">';
    const out = applyBaked(html, { 'https://a.com/1.png': DATA });
    check(out.indexOf(DATA) >= 0 && out.indexOf('https://b.com/2.png') >= 0, '매핑된 것만 교체, 나머지 보존');
  }

  console.log(failed === 0 ? '\nbakeImages: 모든 검사 통과 ✓' : `\nbakeImages: ${failed}개 실패 ✗`);
  process.exit(failed ? 1 : 0);
})();
