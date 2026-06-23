// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/preset/backupZip.test.js — 전체 백업 zip 라운드트립·이미지분리·중복제거 검증.
// 실행: node core/preset/backupZip.test.js
'use strict';
const { buildBackup, parseBackup, isZip } = require('./backupZip.js');

let failed = 0;
const check = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { failed++; console.error('  ✗ ' + msg); } };

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQ==';

// 같은 PNG를 3곳(로그 html·작품 표지·프로필), JPG를 1곳에 사용 → 이미지 2개로 중복제거돼야.
const data = {
  app: 'log-jejogi-pro2', version: 2, kind: 'backup',
  presets: { card: { a: 1 } },
  designs: { active: 'card', shared: { botName: '봇', profileImageUrl: PNG } },
  logs: [
    { id: 'l1', char: '작품A', title: '1화', html: '그녀가 "안녕" <img src="' + PNG + '"> 하며 {{img::x}}', input: '원문', chat: { messages: [{ role: 'user', text: '<img src="' + JPG + '">' }] } },
    { id: 'l2', char: '작품A', title: '2화', html: '<p>이미지 없음</p>' },
  ],
  meta: [{ char: '작품A', cover: PNG, desc: '소개<글>' }],
  read: { readIds: { l1: true }, fav: {} },
  reader: { theme: 'sepia', width: 720 },
};

const zip = buildBackup(data);
check(zip instanceof Uint8Array && zip.length > 0, 'zip 바이트 생성');
check(isZip(zip), 'PK 매직 = zip로 인식');

// catalog.json엔 data:이미지가 없어야(분리됨), lpasset 참조만.
const { unzipSync, strFromU8 } = require('fflate');
const files = unzipSync(zip);
const names = Object.keys(files).sort();
check(names.indexOf('catalog.json') >= 0, 'catalog.json 포함');
const imgFiles = names.filter((n) => n.indexOf('assets/') === 0);
check(imgFiles.length === 2, '이미지 2개만(같은 PNG 3곳→1벌 중복제거, JPG 1벌)');
check(imgFiles.some((n) => n.endsWith('.png')) && imgFiles.some((n) => n.endsWith('.jpg')), 'png·jpg 확장자 분리');
const catalogStr = strFromU8(files['catalog.json']);
check(catalogStr.indexOf('data:image') < 0, 'catalog.json에 data:이미지 없음(전부 분리)');
check(catalogStr.indexOf('lpasset:') >= 0, 'catalog.json에 lpasset 참조 있음');

// 라운드트립: 풀면 원본과 완전 동일(이미지 재인라인).
const back = parseBackup(zip);
check(JSON.stringify(back) === JSON.stringify(data), '라운드트립 — 원본과 완전 동일(이미지 복원)');
check(back.designs.shared.profileImageUrl === PNG, '프로필 사진 복원');
check(back.meta[0].cover === PNG, '작품 표지 복원');
check(back.logs[0].html.indexOf('<img src="' + PNG + '">') >= 0, '로그 html 이미지 복원(제자리)');
check(back.logs[0].chat.messages[0].text === '<img src="' + JPG + '">', '채팅형 구조 안 이미지까지 복원');
check(back.read.readIds.l1 === true && back.reader.theme === 'sepia', '읽기기록·리더설정 복원');

// 비-이미지 data:URL은 분리 안 함(그대로 인라인).
{
  const d2 = { logs: [{ id: 'x', html: 'data:text/plain;base64,SGk=' }] };
  const b2 = parseBackup(buildBackup(d2));
  check(b2.logs[0].html === 'data:text/plain;base64,SGk=', '비-이미지 data:URL은 인라인 유지');
}

// ── ★대용량 바이너리 직접 담기(관리실 원본·폰트·카드) — base64 금지, 사파일로 분리·무손실 복원 ──
{
  const { openBackup } = require('./backupZip.js');
  // 임의 바이너리(이미지 아님 — 관리실 .charx/.risum·폰트 .woff2 모사). 0~255 패턴으로 바이트 무결성 검사.
  const srcBytes = new Uint8Array(5000); for (let i = 0; i < srcBytes.length; i++) srcBytes[i] = (i * 7 + 3) & 0xff;
  const fontBytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1, 2, 3, 254, 255]);   // 'wOF2'…
  const d3 = {
    app: 'log-jejogi-pro2', version: 4, kind: 'backup',
    management: [{ id: 'abc123', name: '🦋소스', format: 'charx', size: srcBytes.length, file: 'bin/src/abc123.charx' }],
    fonts: [{ id: 'f1', family: '내 폰트', format: 'woff2', file: 'bin/font/f1.woff2' }],
    logs: [{ id: 'l1', char: '작품A', html: '<img src="' + PNG + '">' }],   // 이미지는 여전히 assets/로 분리
  };
  const binFiles = { 'bin/src/abc123.charx': srcBytes, 'bin/font/f1.woff2': fontBytes };
  const zip3 = buildBackup(d3, binFiles);
  check(isZip(zip3), '바이너리 포함 백업도 zip');
  const f3 = unzipSync(zip3);
  check(!!f3['bin/src/abc123.charx'] && !!f3['bin/font/f1.woff2'], '바이너리가 zip에 사파일로 담김');
  check(!!f3['assets/0.png'], '이미지는 여전히 assets/로 분리');
  const cat3 = strFromU8(f3['catalog.json']);
  check(cat3.indexOf('base64') < 0 || cat3.indexOf('bin/src') >= 0, 'catalog엔 바이너리 경로 참조만(base64 본문 아님)');
  // 바이트 무결성: 넣은 바이트 == 복원 바이트
  const op = openBackup(zip3);
  const gotSrc = op.getBin('bin/src/abc123.charx');
  check(!!gotSrc && gotSrc.length === srcBytes.length && gotSrc.every((v, i) => v === srcBytes[i]), '관리실 원본 바이트 무손실 복원(in==out)');
  const gotFont = op.getBin('bin/font/f1.woff2');
  check(!!gotFont && gotFont.every((v, i) => v === fontBytes[i]), '폰트 바이트 무손실 복원(in==out)');
  check(op.getBin('bin/없는파일') === null, '없는 바이너리 경로 = null(깨진 복원 방지)');
  // 텍스트/이미지 데이터도 함께 복원
  check(op.data.management[0].id === 'abc123' && op.data.management[0].file === 'bin/src/abc123.charx', 'management 카탈로그 텍스트 복원');
  check(op.data.logs[0].html.indexOf('<img src="' + PNG + '">') >= 0, '로그 이미지 복원(바이너리와 공존)');
}

// 하위호환: 옛 백업(바이너리 인자 없이 buildBackup(data))도 openBackup으로 멀쩡히 열림(바이너리 없음).
{
  const { openBackup } = require('./backupZip.js');
  const op = openBackup(buildBackup({ kind: 'backup', logs: [{ id: 'x', html: '<img src="' + PNG + '">' }] }));
  check(op.data.logs[0].html.indexOf(PNG) >= 0 && op.getBin('bin/anything') === null, '옛 백업(바이너리 0) 호환 — data 복원·getBin은 null');
}

// isZip: json 텍스트는 zip 아님.
check(!isZip(new TextEncoder().encode('{"kind":"backup"}')), 'json 바이트 = zip 아님');

console.log(failed === 0 ? '\nbackupZip: 모든 검사 통과 ✓' : `\nbackupZip: ${failed}개 실패 ✗`);
process.exit(failed ? 1 : 0);
