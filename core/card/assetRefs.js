// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/card/assetRefs.js
// 가져온 챗 에셋의 "공유 저장(이름→해시 참조)" 순수 헬퍼 — dataURL ↔ {mime,b64} 변환.
//   바이트는 store(IDB_BLOBS)에 콘텐츠해시로 한 벌만 저장, 각 화는 이름→해시(작음)만 보유,
//   렌더 직전 그 화에 필요한 것만 dataURL로 복원(지연). 여기엔 IDB/해시 없는 순수부만(테스트 가능).
'use strict';

// 'data:image/<mime>;base64,<b64>' → {mime, b64}. 이미지 base64 dataURL이 아니면 null(=마커 유지).
function parseDataUrlImg(u) {
  const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(u == null ? '' : u).trim());
  return m ? { mime: m[1], b64: m[2] } : null;
}
// {mime,b64} → dataURL (store의 blob 복원·hydrate와 동일 형식: 'data:image/'+mime+';base64,'+b64).
function buildAssetDataUrl(mime, b64) { return 'data:image/' + String(mime) + ';base64,' + String(b64); }

module.exports = { parseDataUrlImg, buildAssetDataUrl };
