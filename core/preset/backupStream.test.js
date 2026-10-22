// SPDX-License-Identifier: GPL-3.0-or-later
// core/preset/backupStream.test.js — 흘려 쓰기/읽기 백업이 옛 형식과 서로 호환되는지 검증.
'use strict';
const assert = require('assert');
const { writeBackupStream, openBackupLazy, createBackupWriter } = require('./backupStream.js');
const { buildBackup, openBackup } = require('./backupZip.js');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); console.log('  ✓ ' + m); pass++; };

const concat = (parts) => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
const readerOf = (u8) => async (off, len) => u8.subarray(off, off + len);
const bytes = (n, seed) => { const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = (i * 31 + seed) & 255; return u; };
const PNG_B64 = Buffer.from(bytes(5000, 7)).toString('base64');

const data = {
  kind: 'backup', version: 4,
  logs: [{ id: 'a', html: '<img src="lpblob:' + 'ab'.repeat(32) + '"> 본문 한글', assetRefs: { mina: 'cd'.repeat(32) } }, { id: 'b', html: '<img src="data:image/png;base64,' + PNG_B64 + '">' }],
  meta: [{ char: 'w', cover: 'data:image/png;base64,' + PNG_B64 }],   // 같은 그림 2곳 → assets 1벌
  blobs: [{ h: 'ab'.repeat(32), mime: 'png', file: 'bin/blob/' + 'ab'.repeat(32) }],
};
const big = bytes(300000, 3), font = bytes(70000, 9);
const bins = [
  { path: 'bin/blob/' + 'ab'.repeat(32), get: async () => big },
  { path: 'bin/font/f1.ttf', get: async () => font },
  { path: 'bin/src/missing.risum', get: async () => null },   // 못 읽은 파일 = 건너뜀
];

(async () => {
  console.log('writeBackupStream:');
  const parts = []; let maxChunk = 0;
  const total = await writeBackupStream(async (c) => { parts.push(c.slice()); if (c.length > maxChunk) maxChunk = c.length; }, data, bins);
  const zip = concat(parts);
  eq(total, zip.length, '반환 바이트 = 실제로 쓴 크기');
  ok(maxChunk < big.length + 4096, '조각 하나가 가장 큰 파일 크기 수준(전체를 한 번에 만들지 않음)');

  console.log('옛 앱 호환(openBackup=unzipSync로 새 백업 읽기):');
  const old = openBackup(zip);
  eq(old.data.logs[1].html, data.logs[1].html, 'data: 그림 재인라인 동일');
  eq(old.data.meta[0].cover, data.meta[0].cover, '같은 그림 두 곳 모두 복원');
  eq(Array.from(old.getBin('bin/font/f1.ttf')), Array.from(font), '바이너리 회수 동일');
  ok(!old.names.includes('bin/src/missing.risum'), '읽지 못한 파일은 항목 없음');
  eq(old.names.filter((n) => n.startsWith('assets/')).length, 1, '같은 data: 그림은 assets 1벌');

  console.log('openBackupLazy(새 리더)로 새 백업 읽기:');
  const lz = await openBackupLazy(zip.length, readerOf(zip));
  eq(lz.data, old.data, '카탈로그 데이터 = 옛 리더 결과와 동일');
  eq(Array.from(await lz.getBin('bin/blob/' + 'ab'.repeat(32))), Array.from(big), '큰 바이너리 임의 접근 회수');
  eq(await lz.getBin('bin/없음'), null, '없는 경로 = null');

  console.log('openBackupLazy로 옛 백업(buildBackup=zipSync) 읽기:');
  const legacy = buildBackup(data, { 'bin/font/f1.ttf': font, ['bin/blob/' + 'ab'.repeat(32)]: big });
  const lz2 = await openBackupLazy(legacy.length, readerOf(legacy));
  eq(lz2.data, openBackup(legacy).data, '옛 백업 카탈로그 동일');
  eq(Array.from(await lz2.getBin('bin/font/f1.ttf')), Array.from(font), '옛 백업 바이너리 회수');

  console.log('한계·오류:');
  const w = createBackupWriter(async () => {}, { limit: 1000 });
  let threw = false; try { await w.addFile('x', bytes(2000, 1), 0); } catch (e) { threw = /4GB/.test(e.message); }
  ok(threw, '한계를 넘으면 명확한 오류(깨진 파일 대신)');
  let bad = false; try { await openBackupLazy(10, readerOf(new Uint8Array(10))); } catch (e) { bad = /zip/.test(e.message); }
  ok(bad, 'zip이 아니면 오류');

  console.log(`\npreset/backupStream: 모든 검사 통과 ✓ (${pass})`);
})().catch((e) => { console.error(e); process.exit(1); });
