// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/share.ts — 서재 로그 "공개 읽기전용 링크"(Firebase 공개문서).
//
// 로그인 사용자가 한 화(로그)를 shares/{id} 공개문서로 올리면, 받은 사람은 로그인 없이 링크로 열람한다.
//   읽기 = 누구나(보안규칙 allow read: if true), 생성/수정/삭제 = 본인(owner)만.
//   id = 추측 불가 난수(crypto) → URL을 모르면 접근 불가.
//
// ★1MB 대응: 로그 html엔 이미지 data:URL이 박혀 쉽게 1MB(Firestore 문서 한도)를 넘는다.
//   읽기전용 공유는 화질이 덜 중요 → 이미지를 JPEG로 줄여(reencodeImagesForClipboard) 한도 밑으로 맞춘다.
//   (Storage 분리 대신 인라인을 택한 이유: 받는 사람이 비로그인이라 Storage 공개읽기+CORS가 불확실.
//    Firestore 읽기는 SDK 자체 전송이라 CORS 문제 없음.) 그래도 넘치면 친절한 에러로 안내.
// @ts-nocheck
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { getDb } from './firebaseBackend.js';
import { currentUser } from './auth.js';
import { reencodeImagesForClipboard, reencodeImages, collapseWs } from './clipboard.js';
import { shareBaseUrl } from './desktopSync.js';   // 데스크탑은 공유 링크를 웹 호스트로(받는 사람이 웹에서 염)

const ENC = new TextEncoder();
const byteLen = (s: string) => ENC.encode(s).length;
const MAX = 1_000_000;   // Firestore 1MB 문서 한도(여유 둠)

/** 추측 불가한 공유 id — crypto 난수 12바이트 → 24자리 hex. */
function newShareId(): string {
  const a = new Uint8Array(12);
  (self.crypto || (window as any).crypto).getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 공유 URL — 데스크탑은 웹 호스트, 웹은 현재 페이지 기준(로컬/배포/서브경로 대응). */
export function shareUrl(id: string): string {
  return shareBaseUrl() + '#/share/' + encodeURIComponent(id);
}

/** 공유 생성(또는 같은 id로 내용 갱신). rec={char,title,date,html}. 성공 시 shareId 반환. */
export async function createShare(rec: any, shareId?: string): Promise<string> {
  const u = currentUser();
  if (!u) throw new Error('로그인이 필요합니다.');
  const id = shareId || newShareId();
  const raw = String(rec.html || '');
  const base: any = { owner: u.uid, char: String(rec.char || ''), title: String(rec.title || ''), date: String(rec.date || ''), createdAt: Date.now() };
  if (rec.template === 'papa') base.template = 'papa';   // ★파파모드 공유 = 받는 쪽 리더가 Shadow DOM 격리로 그 디자인 그대로 렌더(살균된 <style>·svg 보존)
  if (rec.hideUser) base.hideUser = true;   // ★내 입력 가린 공유본 표식(팝오버 기억·"내용 갱신" 유지). 내 원본 로그는 불변.
  const fits = (h: string) => byteLen(JSON.stringify(Object.assign({}, base, { html: h }))) <= MAX;
  // 읽기전용 공유 = 화질 덜 중요 → 1MB에 맞을 때까지 점점 더 강하게 축소(삽화 많은 화도 공유되게).
  let html = raw;
  try { html = collapseWs(await reencodeImages(raw, { png: false, maxDim: 1280, quality: 0.6 })); } catch (_) {}
  if (!fits(html)) {
    for (const [dim, q] of [[960, 0.5], [760, 0.45], [600, 0.4], [460, 0.38], [360, 0.35]] as [number, number][]) {
      try { html = collapseWs(await reencodeImages(raw, { png: false, maxDim: dim, quality: q })); } catch (_) {}
      if (fits(html)) break;
    }
  }
  if (!fits(html)) {
    throw new Error('이미지가 너무 많아 한 링크에 담기 어렵습니다 (화를 더 잘게 나눠보세요).');
  }
  await setDoc(doc(getDb(), 'shares', id), Object.assign({}, base, { html }));
  return id;
}

/** 공유 문서 읽기(비로그인도 가능). 없으면 null. */
export async function getShare(id: string): Promise<any | null> {
  try { const s = await getDoc(doc(getDb(), 'shares', id)); return s.exists() ? s.data() : null; }
  catch (e) { console.warn('[share] 읽기 실패', e); return null; }
}

/** 공유 해제(본인만). */
export async function deleteShare(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), 'shares', id));
}

// ── 작품(시리즈) 통째 공유 ──────────────────────────────────────────
// 화가 여럿이라 한 문서에 다 넣으면 1MB를 넘김 → 화별로 공유 문서(createShare)를 만들고,
// 그 위에 가벼운 "작품 인덱스" 문서(eps=각 화의 공유 id 목록)만 얹는다. 받은 사람은
// 작품 목록을 보고 화를 골라 읽음(각 화는 기존 단일 공유 뷰어 재사용).
//   episodes = [{ char, title, date, html }] (서재 화 순서대로)
export async function createSeriesShare(char: string, title: string, episodes: any[], onProgress?: (i: number, n: number) => void, meta?: { cover?: string; desc?: string }): Promise<{ id: string; count: number; failed: number }> {
  const u = currentUser();
  if (!u) throw new Error('로그인이 필요합니다.');
  const eps: any[] = [];
  let failed = 0;
  for (let i = 0; i < episodes.length; i++) {
    if (onProgress) onProgress(i, episodes.length);
    try {
      const sid = await createShare(episodes[i]);   // 화별 공유 문서(이미지 JPEG 축소 포함)
      eps.push({ sid, title: String(episodes[i].title || ''), date: String(episodes[i].date || '') });
    } catch (_) { failed++; }   // 너무 큰 화는 건너뜀(나머지는 공유)
  }
  if (!eps.length) throw new Error('공유할 수 있는 화가 없습니다 (이미지가 너무 많을 수 있어요).');
  const id = newShareId();
  // 인덱스 문서에 표지·소개를 함께 담아 공유 열람 화면이 작품 페이지처럼 보이게 한다.
  const data: any = { type: 'series', owner: u.uid, char: String(char || ''), title: String(title || char || ''), eps, createdAt: Date.now() };
  if (meta && meta.desc) data.desc = String(meta.desc);
  if (meta && meta.cover) data.cover = String(meta.cover);
  // 표지(이미지)까지 넣어 1MB를 넘으면 표지만 빼고 저장(목록은 살린다).
  if (data.cover && byteLen(JSON.stringify(data)) > MAX) delete data.cover;
  await setDoc(doc(getDb(), 'shares', id), data);
  return { id, count: eps.length, failed };
}

/** 작품 공유 해제: 인덱스 + 각 화 공유 문서 모두 삭제(본인만). */
export async function deleteSeriesShare(seriesId: string): Promise<void> {
  const s = await getShare(seriesId);
  if (s && Array.isArray(s.eps)) { for (const e of s.eps) { try { await deleteShare(e.sid); } catch (_) {} } }
  await deleteDoc(doc(getDb(), 'shares', seriesId));
}
