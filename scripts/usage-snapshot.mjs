// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// scripts/usage-snapshot.mjs — Firebase 무료쿼터 사용량 스냅샷(하루 1회, GitHub Actions 크론).
//
// 하는 일: Cloud Monitoring API에서 Firestore(오늘·태평양 자정 리셋 기준)와 Storage(이번 달) 지표를
//   합산하고, Auth 가입 계정 수를 세어 Firestore `stats/usage` 문서 하나에 쓴다(Admin SDK — 규칙 미적용).
//   앱의 관리자 패널(web/src/adminPanel.ts)이 이 문서를 읽어 게이지로 보여준다.
// 인증: 환경변수 GCP_SA_KEY = 서비스 계정 JSON 전문(GitHub Secrets). 필요한 최소 역할 3개 =
//   Monitoring 뷰어(roles/monitoring.viewer) · Cloud Datastore 사용자(roles/datastore.user)
//   · Firebase Authentication 뷰어(roles/firebaseauth.viewer). 절차는 ADMIN_PANEL_SETUP.md.
// ★메트릭이 일부 실패해도 나머지는 기록(errors 배열에 사유) — 전부 실패해야 종료코드 1.
import { readFileSync } from 'node:fs';

const SA_RAW = process.env.GCP_SA_KEY || '';
if (!SA_RAW) { console.log('GCP_SA_KEY 시크릿이 없음 — 스냅샷 생략(설정 전 단계).'); process.exit(0); }
const SA = JSON.parse(SA_RAW);
const PROJECT = SA.project_id || 'logpapa';

const admin = (await import('firebase-admin')).default;
admin.initializeApp({ credential: admin.credential.cert(SA), projectId: PROJECT });

const monitoring = await import('@google-cloud/monitoring');
const client = new monitoring.MetricServiceClient({ credentials: { client_email: SA.client_email, private_key: SA.private_key }, projectId: PROJECT });

// ── 시간 경계: Firestore 무료쿼터는 태평양 자정 리셋 · Storage(모던 버킷)는 월간 ──
function pacificParts(d = new Date()) {
  const s = d.toLocaleString('en-CA', { timeZone: 'America/Los_Angeles', hour12: false });   // 'YYYY-MM-DD, HH:mm:ss'
  const [date] = s.split(',');
  return date.trim();   // 'YYYY-MM-DD'
}
function pacificMidnightUtc(dateStr) {
  // 태평양 자정의 UTC 시각: DST 때문에 -7/-8h 가변 → 두 후보 중 태평양 날짜가 맞는 쪽 채택.
  for (const off of [7, 8]) {
    const t = new Date(`${dateStr}T00:00:00-0${off}:00`);
    if (pacificParts(t) === dateStr && t.toLocaleString('en-GB', { timeZone: 'America/Los_Angeles', hour12: false }).includes('00:00:00')) return t;
  }
  return new Date(`${dateStr}T00:00:00-08:00`);
}
const now = new Date();
const todayPacific = pacificParts(now);
const dayStart = pacificMidnightUtc(todayPacific);
const monthStart = pacificMidnightUtc(todayPacific.slice(0, 8) + '01');

const errors = [];

// Cloud Monitoring 시계열 합산(DELTA/CUMULATIVE=구간 합, GAUGE=최신값 합).
async function sumMetric(metricType, { start, end = now, filterExtra = '', gauge = false } = {}) {
  try {
    const [series] = await client.listTimeSeries({
      name: `projects/${PROJECT}`,
      filter: `metric.type="${metricType}"${filterExtra ? ' AND ' + filterExtra : ''}`,
      interval: { startTime: { seconds: Math.floor(start.getTime() / 1000) }, endTime: { seconds: Math.floor(end.getTime() / 1000) } },
      view: 'FULL',
    });
    if (!series || !series.length) return 0;
    let total = 0;
    for (const ts of series) {
      const pts = ts.points || [];
      if (gauge) { if (pts[0]) total += Number(pts[0].value.int64Value ?? pts[0].value.doubleValue ?? 0); }   // 최신 포인트(응답은 최신순)
      else for (const p of pts) total += Number(p.value.int64Value ?? p.value.doubleValue ?? 0);
    }
    return total;
  } catch (e) {
    errors.push(`${metricType.split('/').slice(-2).join('/')}: ${String(e.message || e).slice(0, 120)}`);
    return null;
  }
}

// ── Firestore: 오늘(태평양) 문서 읽기/쓰기/삭제 ──
const fsOpts = { start: dayStart };
const firestore = {
  reads: await sumMetric('firestore.googleapis.com/document/read_count', fsOpts),
  writes: await sumMetric('firestore.googleapis.com/document/write_count', fsOpts),
  deletes: await sumMetric('firestore.googleapis.com/document/delete_count', fsOpts),
};

// ── Storage(모던 버킷=월간): 저장 바이트(게이지) · 이번 달 송신 바이트 · 이번 달 요청 수(업/다운 추정) ──
const stOpts = { start: monthStart };
const storage = {
  bytes: await sumMetric('storage.googleapis.com/storage/total_bytes', { start: new Date(now.getTime() - 3600e3), gauge: true }),
  monthDownBytes: await sumMetric('storage.googleapis.com/network/sent_bytes_count', stOpts),
  // Firebase 콘솔의 "업로드/다운로드 횟수"와 1:1은 아님(JSON API 메서드 기준 추정) — 참고용.
  monthUploadOps: await sumMetric('storage.googleapis.com/api/request_count', { ...stOpts, filterExtra: 'metric.label.method = monitoring.regex.full_match("Write.*|Insert.*|.*[Uu]pload.*")' }),
  monthDownOps: await sumMetric('storage.googleapis.com/api/request_count', { ...stOpts, filterExtra: 'metric.label.method = monitoring.regex.full_match("Read.*|Get[Oo]bject.*|.*[Dd]ownload.*")' }),
};

// ── Hosting: 월누적 송신(메트릭 자체가 월간) — 무료한도는 360MB/일이라 패널에선 참고 수치로 표시 ──
const hosting = {
  monthSentBytes: await sumMetric('firebasehosting.googleapis.com/network/monthly_sent', { start: new Date(now.getTime() - 3600e3), gauge: true }),
};

// ── Auth 가입 계정 수(작은 서비스 전제 — 전체 나열) ──
let authUsers = null;
try {
  let count = 0, token = undefined;
  do { const r = await admin.auth().listUsers(1000, token); count += r.users.length; token = r.pageToken; } while (token);
  authUsers = count;
} catch (e) { errors.push('authUsers: ' + String(e.message || e).slice(0, 120)); }

const snapshot = {
  at: now.toISOString(),
  dayPacific: todayPacific,
  firestore, storage, hosting, authUsers,
  errors,
};
const allNull = [firestore.reads, firestore.writes, storage.bytes, authUsers].every((v) => v == null);
await admin.firestore().doc('stats/usage').set(snapshot);
console.log(JSON.stringify(snapshot, null, 2));
if (allNull) { console.error('모든 지표 수집 실패 — 서비스 계정 권한 확인 필요'); process.exit(1); }
