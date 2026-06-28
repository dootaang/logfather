// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/clipboard.ts — 리치 복사(아카 붙여넣기용) 공용 로직. 에디터(main)와 서재(library) 공유.
//
// 아카(Froala)는 붙여넣은 <img> data URL을 namu.la에 업로드하는데 webp/avif 원본은 업로드 실패가 잦음.
// → canvas로 재인코딩(PNG 무손실 / JPEG 저용량). 큰 이미지는 1600px 다운스케일. 태그 사이 공백 정리.
// @ts-nocheck

// img 태그별 크롭 결정: border-radius:50%=정사각(1), aspect-ratio:W/H=그 비율 띠, 없으면 null.
function cropOf(tag: string): number | null {
  if (/border-radius:\s*50%/i.test(tag)) return 1;
  const m = /aspect-ratio:\s*([\d.]+)\s*\/\s*([\d.]+)/i.exec(tag);
  if (m) { const r = parseFloat(m[1]) / parseFloat(m[2]); return isFinite(r) && r > 0 ? r : null; }
  return null;
}

export function reencodeOne(url: string, crop: number | null, png: boolean, maxDim = 1600, quality: number | null = null): Promise<string> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      try {
        let sx = 0, sy = 0, sw = im.naturalWidth, sh = im.naturalHeight;
        if (crop != null && crop > 0) {
          if (sw / sh > crop) { const nw = Math.round(sh * crop); sx = Math.round((sw - nw) / 2); sw = nw; }
          else { const nh = Math.round(sw / crop); sy = Math.round((sh - nh) / 2); sh = nh; }
        }
        const MAX = maxDim; let w = sw, h = sh;
        if (Math.max(w, h) > MAX) { const k = MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d')!;
        if (!png) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
        ctx.drawImage(im, sx, sy, sw, sh, 0, 0, w, h);
        const q = quality != null ? quality : (crop === 1 ? 0.9 : 0.6);
        resolve(png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', q));
      } catch (_) { resolve(url); }
    };
    im.onerror = () => resolve(url);
    im.src = url;
  });
}

// 범용 이미지 재인코딩. opts.maxDim/quality로 공유용 강한 축소도 가능.
export async function reencodeImages(html: string, opts: { png?: boolean; maxDim?: number; quality?: number | null } = {}): Promise<string> {
  const png = !!opts.png, maxDim = opts.maxDim || 1600, quality = opts.quality != null ? opts.quality : null;
  const srcOf = (tag: string) => { const m = /\bsrc="(data:image\/[^"]+)"/i.exec(tag); return m ? m[1] : null; };
  const jobs = new Map<string, string | null>();
  for (const tag of (html.match(/<img\b[^>]*>/gi) || [])) {
    if (/lp-baked/i.test(tag)) continue;
    const u = srcOf(tag); if (!u) continue;
    const key = u + '|' + cropOf(tag);
    if (!jobs.has(key)) jobs.set(key, null);
  }
  if (!jobs.size) return html;
  await Promise.all([...jobs.keys()].map((key) => {
    const i = key.lastIndexOf('|'); const u = key.slice(0, i); const cs = key.slice(i + 1);
    const crop = cs === 'null' ? null : parseFloat(cs);
    return reencodeOne(u, crop, png, maxDim, quality).then((p) => { jobs.set(key, p); });
  }));
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const u = srcOf(tag); if (!u) return tag;
    const rep = jobs.get(u + '|' + cropOf(tag));
    return rep ? tag.replace(u, rep) : tag;
  });
}

export async function reencodeImagesForClipboard(html: string, png: boolean): Promise<string> {
  const srcOf = (tag: string) => { const m = /\bsrc="(data:image\/[^"]+)"/i.exec(tag); return m ? m[1] : null; };
  const jobs = new Map<string, string | null>();
  for (const tag of (html.match(/<img\b[^>]*>/gi) || [])) {
    if (/lp-baked/i.test(tag)) continue;
    const u = srcOf(tag); if (!u) continue;
    const key = u + '|' + cropOf(tag);
    if (!jobs.has(key)) jobs.set(key, null);
  }
  if (!jobs.size) return html;
  await Promise.all([...jobs.keys()].map((key) => {
    const i = key.lastIndexOf('|'); const u = key.slice(0, i); const cs = key.slice(i + 1);
    const crop = cs === 'null' ? null : parseFloat(cs);
    return reencodeOne(u, crop, png).then((p) => { jobs.set(key, p); });
  }));
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const u = srcOf(tag); if (!u) return tag;
    const rep = jobs.get(u + '|' + cropOf(tag));
    return rep ? tag.replace(u, rep) : tag;
  });
}

// 아카는 태그 사이 들여쓰기 공백을 &nbsp;로 바꿔 레이아웃을 망가뜨림 → 줄바꿈 든 태그 사이 공백만 제거.
export const collapseWs = (h: string) => h.replace(/>\s*\n\s*</g, '><').trim();

// PNG(고화질) 기본, 모바일이거나 '저화질' 설정(pro2-clipboard-jpeg)이면 JPEG. (에디터 토글과 같은 키 공유)
export function preferPng(): boolean {
  try { const s = localStorage.getItem('pro2-clipboard-jpeg'); if (s === '1') return false; if (s === '0') return true; } catch (_) {}
  return !(/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (window.matchMedia && window.matchMedia('(pointer:coarse)').matches));
}

// 리치 복사: text/html(이미지 재인코딩) + text/plain(원문). aka 일반 에디터에 붙여넣으면 이미지까지 업로드됨.
export async function richCopy(html: string, plainText: string, png?: boolean): Promise<void> {
  if (png === undefined) png = preferPng();
  const out = collapseWs(await reencodeImagesForClipboard(html, png));
  await navigator.clipboard.write([new ClipboardItem({
    'text/plain': new Blob([plainText || ''], { type: 'text/plain' }),
    'text/html': new Blob([out], { type: 'text/html' }),
  })]);
}
