//@api 3.0
//@name LogPapaPush
//@display-name 로그파파로 보내기
//@version 1.15.0
//@description 현재 채팅 세션을 번역 캐시 적용본 + 에셋(감정 이미지, 어떤 봇 문법이든) + 자동 정리(군더더기)까지 로그파파 서재에 바로 보냅니다(파일 export 없이).
//@arg connectKey string
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
//
// 쓰는 법: 1) 로그파파 앱 → 설정 → "리스 연결"에서 연결 키 복사(또는 리스 플러그인 설정의 connectKey에 입력)
//          2) 한 번만 붙여넣으면 기기에 영속 저장 — 이후엔 버튼만
//          3) "이 세션 보내기" → 로그파파 서재(받은 로그함)에 번역본으로 들어감(로그인한 그 계정)
// 보안: 연결 키는 "넣기"만 가능(다른 데이터 접근 불가). 비밀번호는 절대 안 받습니다.
//       아래 apiKey/projectId는 비밀이 아닌 공개 web config(보안은 Firestore 규칙).

(async () => {
  const risu = typeof risuai !== 'undefined' ? risuai : (typeof Risuai !== 'undefined' ? Risuai : null);
  if (!risu) throw new Error('리스 v3 API 객체를 찾을 수 없습니다.');

  // ── 로그파파 클라우드(공개 web config) ─────────────────────────────
  const PROJECT = 'logpapa';
  const API_KEY = 'AIzaSyDUR9_DGQTqdkZVfGzbQzEYO0qACR5vsfo';
  const INBOX_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/inbox?key=${API_KEY}`;
  const ARG_NAME = 'connectKey';   // //@arg 이름 — RisuAI 플러그인 인자에 영속(getArgument/setArgument). localStorage 의존 제거.

  // ── 인라인 라인 아이콘(Tabler·24·stroke·currentColor) = 우리 아이콘 패밀리. 플러그인은 icons.ts를 import 못 해 직접 둠. ──
  const IC = {
    flame: '<path d="M12 12c2 -2.96 0 -7 -1 -8c0 3.038 -1.773 4.741 -3 6c-1.226 1.26 -2 3.24 -2 5a6 6 0 1 0 12 0c0 -1.532 -1.056 -3.94 -2 -5c-1.786 3 -2.791 3 -4 2z"/>',
    x: '<path d="M18 6l-12 12"/><path d="M6 6l12 12"/>',
    send: '<path d="M10 14l11 -11"/><path d="M21 3l-6.5 18a.55 .55 0 0 1 -1 0l-3.5 -7l-7 -3.5a.55 .55 0 0 1 0 -1l18 -6.5"/>',
    check: '<path d="M5 12l5 5l10 -10"/>',
    alert: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.24 3.957l-8.422 14.06a1.989 1.989 0 0 0 1.7 2.983h16.845a1.989 1.989 0 0 0 1.7 -2.983l-8.423 -14.06a1.989 1.989 0 0 0 -3.4 0z"/>',
    loader: '<path d="M12 3a9 9 0 1 0 9 9"/>',
    download: '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 11l5 5l5 -5"/><path d="M12 4l0 12"/>',
  };
  const ic = (n, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;

  // ── 연결 키 영속 저장 = RisuAI 플러그인 인자(//@arg connectKey). getArgument/setArgument로 기기에 영속.
  //   ★localStorage 의존 제거 — 리스 공식 저장이라 세션·재시작을 넘어 유지(한 기기당 한 번 붙여넣으면 끝).
  //   RisuAI "플러그인 설정"에서 직접 입력해도 되고(같은 인자), 아래 입력칸은 그 인자를 읽고/쓴다.
  async function loadKey() { try { return (await risu.getArgument(ARG_NAME)) || ''; } catch (_) { return ''; } }
  async function saveKey(v) { try { await risu.setArgument(ARG_NAME, (v || '').trim()); } catch (_) {} }
  // 연결 키 = "uid:secret" → 첫 ':' 기준 분리(uid·secret엔 ':' 없음).
  function splitKey(raw) {
    const s = String(raw || '').trim();
    const i = s.indexOf(':');
    if (i <= 0 || i >= s.length - 1) return null;
    return { uid: s.slice(0, i), secret: s.slice(i + 1) };
  }

  // ── 현재 챗 읽기 + 번역 캐시 적용 ──────────────────────────────────
  async function getCurrentChat() {
    const char = await risu.getCharacter();
    if (!char) throw new Error('현재 캐릭터를 찾을 수 없습니다.');
    const page = char.chatPage || 0;
    const chat = char.chats?.[page];
    if (!chat) throw new Error('현재 챗을 찾을 수 없습니다.');
    if (chat._placeholder) throw new Error('챗 데이터가 로드되지 않았습니다. 챗을 한 번 열어주세요.');
    return { char, chat };
  }
  // 번역 캐시 조회 = ★메시지별 부분검색 매칭. 리스 LLM 번역 캐시 키 = "렌더된 메시지 HTML 통째"라
  //   원문/문단 정확조회(getTranslationCache)는 단위·형식이 어긋나 100% 미스 → searchTranslationCache로
  //   평문 스니펫을 부분검색해 이 메시지에 맞는 키를 고르고 그 value(번역 HTML)를 평문으로 정리해 담는다.
  //   매칭 실패(수정·리롤·정리규칙 변경 등)는 원문 유지(유실 0). LLM 번역기 캐시만 잡힘(구글/DeepL은 in-memory라 못 읽음).
  function stripHtml(h) {
    return String(h == null ? '' : h).replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'").replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ').trim();
  }
  // 메시지를 "렌더돼도 그대로 남을 평문 조각"으로 쪼갬: 태그·CBS·에셋마커·따옴표·별표·마크다운 기호를 경계로.
  //   이 조각들은 렌더된 HTML(캐시 키) 안에 그대로 들어있어 부분검색·매칭에 쓰인다.
  function plainRuns(s) {
    const t = String(s == null ? '' : s)
      .replace(/<[^>]*>/g, '\n').replace(/\{\{[^}]*\}\}/g, '\n').replace(/\[[^\]\n|]*\|[^\]\n]*\]/g, '\n');
    return t.split(/[\n*_~`#>\[\]()"'“”‘’「」『』\r]+/).map((r) => r.replace(/\s+/g, ' ').trim()).filter((r) => r.length >= 4);
  }
  // 번역 HTML(value) → 우리 메시지 형식(평문)으로 정리: 블록태그·br=줄바꿈, 나머지 태그 제거, 엔티티 복원.
  function cleanTranslatedHtml(h) {
    const t = String(h == null ? '' : h)
      .replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'").replace(/&amp;/gi, '&');
    return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  const _searchMemo = new Map();   // 스니펫→검색결과 재사용(중복/동일 메시지 호출 절감)
  async function searchCache(snip) {
    if (_searchMemo.has(snip)) return _searchMemo.get(snip);
    let r = null;
    try { if (typeof risu.searchTranslationCache === 'function') r = await risu.searchTranslationCache(snip); } catch (_) { r = null; }
    if (!Array.isArray(r)) r = [];
    _searchMemo.set(snip, r);
    return r;
  }
  // 원문 1메시지 → 번역본(캐시 매칭). 실패 시 원문 유지(유실 0).
  async function translateViaCache(text) {
    const original = String(text == null ? '' : text);
    const runs = plainRuns(original);
    if (!runs.length) return { text: original, hit: false };
    const snip = runs.slice().sort((a, b) => b.length - a.length)[0];   // 가장 길고 고유한 평문 조각으로 검색(오매칭 최소)
    if (snip.length < 6) return { text: original, hit: false };
    const results = await searchCache(snip);
    if (!results.length) return { text: original, hit: false };
    // 후보 키 중 "이 메시지 평문을 가장 많이 담은 것" 선택 → 스니펫이 여러 메시지에 걸려도 통짜가 든 키가 최고점.
    let best = null, bestScore = -1;
    for (const r of results) {
      if (!r || typeof r.key !== 'string' || typeof r.value !== 'string') continue;
      const keyPlain = stripHtml(r.key);
      let score = 0; for (const run of runs) if (keyPlain.indexOf(run) >= 0) score += run.length;
      if (score > bestScore) { bestScore = score; best = r; }
    }
    if (!best || bestScore < snip.length) return { text: original, hit: false };   // 스니펫조차 안 든 키 = 오매칭 → 폴백
    const cleaned = cleanTranslatedHtml(best.value);
    return cleaned ? { text: cleaned, hit: true } : { text: original, hit: false };
  }
  // 안정 해시(FNV-1a) — 챗 지문(fp)용.
  function fpHash(s) { let h = 0x811c9dc5; s = String(s || ''); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); }

  // ── 삽화(inlay) 가져오기 — 리스가 보관한 생성 이미지를 readImage로 꺼내 메시지 본문에 심는다. ──
  //   마커: 리스 네이티브 {{inlay::ID}}/{{inlayed::ID}} + 라이트보드 등 모듈의 <lb-xnai>/<lb-lazy> 태그(내부가 그 마커 또는 id).
  //   ★못 찾거나 readImage 실패면 그 삽화만 건너뜀(텍스트는 그대로 — 절대 안 깨지게). inbox 1MB 위해 축소·JPEG + 총량 상한.
  const hasReadImage = typeof risu.readImage === 'function';
  const IMG_MAX_PX = 800, IMG_QUALITY = 0.7, IMG_BUDGET = 700 * 1024;   // 총 dataURL 길이 상한(텍스트·오버헤드 여유 두고 1MB 미만)
  function extractInlayIds(text) {
    const ids = []; const seen = new Set();
    const add = (id) => { id = String(id || '').trim(); if (id && id.length <= 256 && !seen.has(id)) { seen.add(id); ids.push(id); } };
    let m;
    const re1 = /\{\{inlay(?:ed)?::\s*([^}|]+?)\s*\}\}/gi;   // 리스 네이티브 마커
    while ((m = re1.exec(String(text || '')))) add(m[1]);
    const re2 = /<lb-(?:xnai|lazy)\b[^>]*>([\s\S]*?)<\/lb-(?:xnai|lazy)>/gi;   // 모듈 태그
    while ((m = re2.exec(String(text || '')))) {
      const inner = m[1]; let mm, found = false; const reIn = /\{\{[\w-]+::\s*([^}|]+?)\s*\}\}/g;
      while ((mm = reIn.exec(inner))) { add(mm[1]); found = true; }   // 내부의 어떤 {{타입::id}} 마커든 id 추출(네이티브 형식 달라도 모듈 태그 안이면 잡음)
      if (!found) { const t = inner.replace(/<[^>]*>/g, '').trim(); if (t) add(t); }   // 마커 없으면 내부 토큰을 id 후보로(readImage가 검증)
    }
    return ids;
  }
  function imgSrcFrom(v) {   // readImage 반환을 <img src>용으로 정규화(자체완결 dataURL 우선, http(s)도 허용).
    if (!v) return '';
    if (typeof v === 'string') return (v.startsWith('data:') || /^https?:\/\//.test(v)) ? v : (v.startsWith('//') ? 'https:' + v : '');
    try { if (v instanceof Uint8Array || v instanceof ArrayBuffer) { const b = new Uint8Array(v); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return 'data:image/png;base64,' + btoa(s); } } catch (_) {}
    if (typeof v === 'object' && typeof v.data === 'string') return imgSrcFrom(v.data);
    return '';
  }
  function shrinkImage(src, maxPx, png) {   // canvas로 최대 maxPx 재인코딩. png=true면 PNG(알파 보존·스프라이트용), 아니면 JPEG(장면용). 실패·교차출처 오염 시 원본 그대로.
    maxPx = maxPx || IMG_MAX_PX;
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => { try {
          let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          if (!w || !h) return resolve(src);
          const sc = Math.min(1, maxPx / Math.max(w, h));
          w = Math.max(1, Math.round(w * sc)); h = Math.max(1, Math.round(h * sc));
          const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(png ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', IMG_QUALITY));
        } catch (_) { resolve(src); } };
        img.onerror = () => resolve(src);
        img.src = src;
      } catch (_) { resolve(src); }
    });
  }
  // 삽화(장면) = 큰 블록 → 800px JPEG. 본문에 인라인 <img>로 박는다.
  async function inlayDataUrl(id) {
    let raw; try { raw = await risu.readImage(id); } catch (_) { return ''; }
    const src = imgSrcFrom(raw);
    if (!src) return '';
    return src.startsWith('data:') ? await shrinkImage(src, IMG_MAX_PX, false) : src;
  }
  // 에셋(감정 스프라이트) = 작게 → 512px ★PNG(알파 보존). assets 맵에 담아 마커로 카드 스타일 렌더(블록 임베드 X).
  async function assetDataUrl(path) {
    let raw; try { raw = await risu.readImage(path); } catch (_) { return ''; }
    const src = imgSrcFrom(raw);
    if (!src) return '';
    return src.startsWith('data:') ? await shrinkImage(src, 512, true) : src;
  }

  // ── ★인레이 삽화 실험(v1.13.0·옵트인) — 모듈 generateImage 삽화 복구 시도 ──────────────────
  //   모듈 삽화 바이트는 리스 inlayStorage(플러그인 차단 저장소)에만 있고, readImage는 forageStorage만 읽어 못 꺼낸다.
  //   화면엔 <img src="blob:..."> 로 렌더됨 → 유일 경로 = DOM에서 그 blob URL의 바이트를 빼낸다.
  //   getRootDocument는 async + mainDom 권한 → SafeDocument(querySelectorAll 등 전부 async). blob 바이트를 T1 fetch / T2 nativeFetch로 시도.
  //   ★진단을 결과창에 한 줄로 출력 = 커뮤니티 1명 회신으로 "되나/뭐가 막히나" 판정(사장님은 콘솔 못 돌림). 무회귀(옵트인·실패해도 본 전송 그대로).
  // ★어떤 await도 영영 멈추지 않게(권한 프롬프트·느린 DOM 브리지·blob fetch 행). 시간 초과 시 fallback 반환.
  function withTimeout(p, ms, fb) { let t; const timer = new Promise((res) => { t = setTimeout(() => res(fb), ms); }); return Promise.race([Promise.resolve(p).then((v) => { clearTimeout(t); return v; }, () => { clearTimeout(t); return fb; }), timer]); }
  function u8ToPngDataUrl(u8) { let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return 'data:image/png;base64,' + btoa(s); }
  async function fetchBlobBytes(url, fn) {   // blob: URL → Uint8Array (fetch/nativeFetch 양쪽 응답 모양 관대 처리)
    try {
      const r = await withTimeout(Promise.resolve().then(() => fn(url)), 5000, null);
      if (!r) return null;
      let buf = null;
      if (r && typeof r.arrayBuffer === 'function') buf = await r.arrayBuffer();
      else if (r && r.data instanceof ArrayBuffer) buf = r.data;
      else if (r && r.data && r.data.buffer instanceof ArrayBuffer) buf = r.data.buffer;
      else if (r && typeof r.blob === 'function') { const b = await r.blob(); buf = await b.arrayBuffer(); }
      if (!buf) return null;
      const u8 = new Uint8Array(buf);
      return u8.length > 8 ? u8 : null;
    } catch (_) { return null; }
  }
  async function safeArrayToList(sa) {   // SafeClassArray<SafeElement> → [SafeElement] (length()/at(i) 모두 async)
    const out = [];
    try { const n = await sa.length(); for (let i = 0; i < n && i < 4000; i++) { try { out.push(await sa.at(i)); } catch (_) {} } } catch (_) {}
    return out;
  }
  function fmtInlayDiag(d) {
    const sc = d.sch || {};
    const parts = `blob${sc.blob || 0} data${sc.data || 0} http${sc.http || 0} asset${sc.asset || 0} rel${sc.rel || 0} etc${sc.other || 0}`;
    const samp = (d.samples && d.samples.length) ? ' / 샘플 ' + d.samples.map((s) => '"' + s + '"').join(' ') : '';
    const win = (d.byScheme && Object.keys(d.byScheme).length) ? ' ★바이트확보:' + Object.entries(d.byScheme).map(([k, v]) => k + '×' + v).join(',') : '';
    return `[인레이실험] UUID ${d.uuid}·CARD ${d.card} / DOM ${d.dom}·img ${d.imgs} [${parts}]${samp} / 추출 fetch${d.fetchOk} native${d.nativeOk} read${d.readOk}${win}${d.note ? ' · ' + d.note : ''}`;
  }
  function schemeOf(src) {
    const s = String(src || ''); if (!s) return null;
    if (s.indexOf('blob:') === 0) return 'blob';
    if (s.indexOf('data:') === 0) return 'data';
    if (/^https?:\/\//i.test(s)) return (s.indexOf('asset.localhost') >= 0 || s.indexOf('/asset/') >= 0) ? 'asset' : 'http';
    if (s.indexOf('asset:') === 0 || s.indexOf('tauri:') === 0 || s.indexOf('://asset') >= 0) return 'asset';
    if (s[0] === '/' || s[0] === '.') return 'rel';
    return 'other';
  }
  async function captureDomInlays() {
    const d = { uuid: 0, card: 0, dom: 'none', imgs: 0, sch: { blob: 0, data: 0, http: 0, asset: 0, rel: 0, other: 0 }, samples: [], fetchOk: 0, nativeOk: 0, readOk: 0, byScheme: {}, note: '' };
    // 1) 라이브 챗 마커 수
    try {
      const { chat } = await getCurrentChat();
      const all = (chat.message || []).map((m) => { if (!m) return ''; const sw = (Array.isArray(m.swipes) && m.swipes[m.swipeId ?? 0] != null) ? m.swipes[m.swipeId ?? 0] : m.data; return String(sw || ''); }).join('\n');
      d.uuid = (all.match(/\{\{inlay(?:ed)?::[^}]+\}\}/gi) || []).length;
      d.card = (all.match(/INLAY\[<CARD[^\]]*\]/gi) || []).length;
    } catch (_) {}
    // 2) DOM 접근 — ★60s 타임아웃(권한 모달 사람 응답 시간 확보. 로드 시 사전획득과 합쳐 안정).
    let doc = null; try { doc = await withTimeout(Promise.resolve().then(() => risu.getRootDocument()), 60000, null); } catch (_) { doc = null; }
    if (!doc) { d.dom = 'null(mainDom 권한 미허용/모달 못봄 — 로드 시 권한창 떴으면 허용, 아니면 플러그인 닫고 재시도)'; return { diag: fmtInlayDiag(d), byOrder: [], detail: d }; }
    d.dom = (typeof doc.querySelectorAll === 'function') ? 'ok' : 'noQuery';
    // 3) 전 <img> 수집 → 스킴 분류 + 샘플 src + outerHTML(콘솔). ★blob 가정 폐기 — 실제 스킴을 본다.
    let imgs = [];
    try { const sa = await doc.querySelectorAll('img'); imgs = sa ? await safeArrayToList(sa) : []; } catch (_) {}
    d.imgs = imgs.length;
    const srcsBy = { blob: [], http: [], asset: [], rel: [], other: [] };
    let outerN = 0;
    for (const el of imgs) {
      let src = ''; try { src = await el.getAttribute('src'); } catch (_) {}
      const sc = schemeOf(src); if (!sc) continue;
      d.sch[sc] = (d.sch[sc] || 0) + 1;
      if (sc !== 'data' && srcsBy[sc] && srcsBy[sc].length < 8) srcsBy[sc].push(src);
      if (sc !== 'data' && d.samples.length < 3) d.samples.push(String(src).slice(0, 38));
      if (sc !== 'data' && outerN < 3) { outerN++; try { console.info('[LogPapaPush] inlay img 샘플: ' + String(await el.getOuterHTML()).slice(0, 240)); } catch (_) {} }
    }
    // 4) 각 비-data 스킴 후보를 fetch/nativeFetch/readImage로 시도 → 어느 스킴·방법이 바이트를 주나(진단).
    const nativeFn = (typeof risu.nativeFetch === 'function') ? risu.nativeFetch : null;
    const readFn = (typeof risu.readImage === 'function') ? risu.readImage : null;
    let winScheme = null, winMethod = null;
    for (const sc of ['blob', 'http', 'asset', 'rel', 'other']) {
      for (const src of srcsBy[sc].slice(0, 4)) {
        let u8 = await fetchBlobBytes(src, fetch); let method = u8 ? 'fetch' : '';
        if (u8) d.fetchOk++;
        if (!u8 && nativeFn) { u8 = await fetchBlobBytes(src, nativeFn); if (u8) { d.nativeOk++; method = 'native'; } }
        let du = u8 ? u8ToPngDataUrl(u8) : null;
        if (!du && readFn && (sc === 'asset' || sc === 'rel' || sc === 'other')) { try { const raw = await withTimeout(Promise.resolve().then(() => readFn(src)), 5000, null); const r = imgSrcFrom(raw); if (r && r.indexOf('data:') === 0) { du = r; method = 'read'; d.readOk++; } } catch (_) {} }
        if (du) { d.byScheme[sc] = (d.byScheme[sc] || 0) + 1; if (!winScheme) { winScheme = sc; winMethod = method; } }
      }
    }
    // 5) 성공 스킴이 있으면 그 스킴 img들로 byOrder 채움(best-effort 박제).
    const byOrder = [];
    if (winScheme) {
      for (const src of srcsBy[winScheme]) {
        let du = null;
        if (winMethod === 'read' && readFn) { try { du = imgSrcFrom(await withTimeout(Promise.resolve().then(() => readFn(src)), 5000, null)); } catch (_) {} }
        else { const u8 = await fetchBlobBytes(src, winMethod === 'native' ? nativeFn : fetch); if (u8) du = u8ToPngDataUrl(u8); }
        if (du && du.indexOf('data:') === 0) { try { byOrder.push(await shrinkImage(du, IMG_MAX_PX, false)); } catch (_) { byOrder.push(du); } }
        else byOrder.push(null);
      }
    }
    if (!d.fetchOk && !d.nativeOk && !d.readOk) d.note = (d.imgs === 0) ? 'DOM img 0 — 챗 스크롤로 삽화 보이게 후 재시도' : '전 스킴 추출 실패 — 위 [스킴]·샘플로 다음 버전 보정';
    return { diag: fmtInlayDiag(d), byOrder, detail: d };
  }

  // ── 인레이 모듈 빈 마커 INLAY[<CARDxx>] ─────────────────────────────────────────────────
  //   ★모듈 생성 삽화는 "생성한 사람"의 리스 런타임에만 있고 저장 데이터/플러그인 API로는 못 꺼낸다(검증됨:
  //   getRootDocument는 화면 DOM이 아니라 데이터 객체 — querySelectorAll 없음). 따라서 빈 마커는 복구 불가 →
  //   본문에 글자로 새지 않게 제거만 한다(텍스트 오염 방지). DOM 캡처 가설은 API 한계로 폐기.
  const INLAY_CARD_RE = /INLAY\[<CARD[^\]]*\]/gi;

  // ── 에셋봇 에셋(감정 스프라이트·아이콘) 흡수 — 삽화와 같은 구조(리스 내부 보관 + 메시지엔 이름 참조). ──
  //   캐릭터 에셋 목록(이름→경로) + 메시지에서 실제 쓰인 이름만 → readImage(경로) → 축소·임베드. ★쓰인 것만(전체 6천장 방지).
  function charAssetMap(char) {
    const out = []; const seen = new Set();
    const push = (n, p) => { n = String(n || '').trim(); p = String(p || '').trim(); if (n && p && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push({ name: n, path: p }); } };
    try { for (const e of (char && char.emotionImages) || []) if (Array.isArray(e)) push(e[0], e[1]); } catch (_) {}
    try { for (const a of (char && char.additionalAssets) || []) if (Array.isArray(a)) push(a[0], a[1]); } catch (_) {}
    return out;
  }
  const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 메시지에서 실제 쓰인 에셋 수집(맵에 있는 이름만). 우리 토큰 {{img::}}/{{img=}}/{{image::}} + <img src> + ★등호형 <img="이름"> + 리스 [🌠|이름].
  //   ★등호형(<타입="이름">)이 핵심 버그였음: 에셋봇 customScript가 <img="이름">→{{img::}}로 표시변환하기 전 raw엔 <img="이름">으로 있어, 공백·src 필수였던 reImg가 못 잡아 에셋 전탈락(28개). 등호형 추가로 해결.
  const RE_EQ_USE = /<(?:img|image|emotion|asset|raw|bg)\s*=\s*['"″]?([^'"″>\s]+)/gi;   // <img="이름"> / <emotion=이름> 등(공백·src 없음, 따옴표 선택)
  function usedAssets(text, byName) {
    if (!byName.size) return [];
    const used = []; const seen = new Set(); let m;
    const consider = (raw) => { const n = String(raw || '').trim().replace(/^['"″]|['"″]$/g, ''); const hit = byName.get(n.toLowerCase()) || byName.get(n.toLowerCase().replace(/\.[a-z0-9]+$/i, '')); if (hit && !seen.has(hit.path)) { seen.add(hit.path); used.push(hit); } };
    const reTok = /\{\{(?:img|image|raw|asset|source|emotion|image_asset)(?:::|=)\s*([^}|]+?)\s*\}\}/gi; while ((m = reTok.exec(text))) consider(m[1]);
    const reImg = /<(?:img|image)\s+src=\s*['"″]?([^'"″>\s]+)/gi; while ((m = reImg.exec(text))) consider(m[1]);
    RE_EQ_USE.lastIndex = 0; while ((m = RE_EQ_USE.exec(text))) consider(m[1]);   // ★등호형 <img="이름"> (가상화 무관·전 메시지 커버)
    const reCBS = /\[[^\]\n|]*\|\s*([^\]\n]+?)\s*\]/g; while ((m = reCBS.exec(text))) consider(m[1]);   // 리스 CBS [x|이름] (감정/에셋 표시)
    return used;
  }
  // 본문(번역본)에서 원본 이미지 마커를 싹 제거 — inlay/lb(내부참조) + 우리/리스 에셋 마커 + CBS + 맨이름 <img>. ★data:/http <img>는 유지.
  //   HIT 본문은 이미 깨끗(no-op), MISS 원본의 군더더기 정리. 이후 깨끗한 마커/이미지로 본문을 재구성한다.
  function stripImageMarkers(body) {
    return String(body || '')
      .replace(/INLAY\[<CARD[^\]]*\]/gi, '')   // ★인레이 모듈 빈 마커 제거(텍스트만 모드·캡처 안 함 — 텍스트 오염 방지)
      .replace(/\{\{inlay(?:ed)?::[^}]*\}\}/gi, '')
      .replace(/<lb-(?:xnai|lazy)\b[^>]*\/>/gi, '')
      .replace(/<lb-(?:xnai|lazy)\b[^>]*>[\s\S]*?<\/lb-(?:xnai|lazy)>/gi, '')
      .replace(/\{\{(?:img|image|raw|asset|source|emotion|image_asset)(?:::|=)[^}]*\}\}/gi, '')
      .replace(/\[[^\]\n|]*\|[^\]\n]*\]/g, '')
      .replace(/<(?:img|image)\s+src=\s*(?!['"″]?(?:data:|https?:|\/\/))[^>]*>/gi, '')
      .replace(/<(?:img|image|emotion|asset|raw|bg)\s*=\s*(?!['"″]?(?:data:|https?:|\/\/))[^>]*>/gi, '')   // ★등호형 <img="이름"> 마커 제거(텍스트만 모드 — data:/http는 보존)
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ── ★RisuAI CBS 제어흐름 제거 + 배경이미지 div 마커화 ────────────────────────────────────
  //   모듈이 스프라이트를 {{#if 최근3개}}<div style="background-image:url('{{img::이름}}')">{{/}} 로 감싸는데(화면선 리스가 조건 계산해 숨김),
  //   우리는 raw를 읽어 그 {{#if}}/{{/}}가 글자로 샌다 → 제거. {{#...}}/{{:...}}/{{/...}}만 중첩 {{}} 균형매칭으로 통째 제거(내부 보존).
  //   우리 {{img::}}/{{inlay::}} 마커는 #/:// 로 시작 안 해 무영향(검증됨).
  function stripCbsControl(s) {
    s = String(s || ''); let out = '', i = 0;
    while (i < s.length) {
      if (s[i] === '{' && s[i + 1] === '{' && (s[i + 2] === '#' || s[i + 2] === ':' || s[i + 2] === '/')) {
        let depth = 0, j = i;
        while (j < s.length) { if (s[j] === '{' && s[j + 1] === '{') { depth++; j += 2; } else if (s[j] === '}' && s[j + 1] === '}') { depth--; j += 2; if (depth === 0) break; } else j++; }
        i = j;
      } else { out += s[i]; i++; }
    }
    return out;
  }
  // <태그 ... background-image:url('{{img::이름}}') ...></태그> → 맨 {{img::이름}} 마커. (우리 import가 카드로 렌더 + 아카는 bg-image strip하므로 마커가 안전.)
  function unwrapBgImageMarker(s) { return String(s || '').replace(/<(\w+)\b[^>]*url\(\s*['"]?\s*(\{\{img::[^}]+?\}\})\s*['"]?\s*\)[^>]*>(?:\s*<\/\1>)?/gi, '\n\n$2\n\n'); }

  // ── 자동 정리(리스 표시 정규식 editdisplay) — 관리실 수동등록 없이 챗에 든 정리 규칙 흡수. 우리 코어 expandCardRegex 이식(살균·ReDoS·$n). ──
  const CLEAN_DISPLAY = new Set(['editdisplay', 'edit_display', 'display', 'editoutput', 'edit_output', 'output']);
  function cleanSanitizeOut(out) { return String(out).replace(/<\s*script\b[\s\S]*?<\s*\/\s*script\s*>/gi, '').replace(/<\s*\/?\s*(?:script|iframe|object|embed|link|meta|base)\b[^>]*>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/javascript:/gi, ''); }
  function cleanCatastrophic(p) { return /\([^()]*[+*][^()]*\)[+*]/.test(p); }
  function cleanBuildRe(inStr, flagHint) { let pattern = inStr, flags = flagHint || ''; const m = /^\/([\s\S]*)\/([gimsuy]*)$/.exec(inStr); if (m) { pattern = m[1]; flags = m[2] || flags; } if (!flags.includes('g')) flags += 'g'; return new RegExp(pattern, flags); }
  function cleanSubst(template, args) { let end = args.length - 2; if (args.length && typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null) end = args.length - 3; const g = args.slice(1, end); return String(template).replace(/\$(\$|\d{1,2})/g, (mm, d) => { if (d === '$') return '$'; const i = parseInt(d, 10); if (i >= 1 && i <= g.length) { const v = g[i - 1]; return v == null ? '' : v; } return mm; }); }
  // editdisplay 규칙 수집: char.customscript + db.presetRegex + 모듈. out 살균·정규화. ★실기기 PoC = getRootDocument().presetRegex 추출 확인.
  function collectCleanupRegex(char) {
    const out = []; const seen = new Set();
    const add = (arr) => { if (!Array.isArray(arr) || seen.has(arr)) return; seen.add(arr); for (const r of arr) if (r && typeof r.in === 'string' && typeof r.out === 'string') { const type = r.type || 'editdisplay'; if (!CLEAN_DISPLAY.has(type)) continue; out.push({ in: r.in, out: cleanSanitizeOut(r.out), type, flags: r.flag || r.flags || '' }); } };
    try { add(char && char.customscript); } catch (_) {}
    let root = null; try { root = (typeof risu.getRootDocument === 'function') ? risu.getRootDocument() : null; } catch (_) { root = null; }
    if (root) { try { add(root.presetRegex); } catch (_) {} try { if (Array.isArray(root.modules)) for (const mo of root.modules) if (mo) add(mo.regex); } catch (_) {} }
    return out;
  }
  // (A) 텍스트에 정리 규칙 적용 — 깨진/ReDoS/비표시 스킵, $n 치환(주변 텍스트 스플라이스 방지).
  function cleanApply(text, rules) { if (!text || !Array.isArray(rules) || !rules.length) return text; let o = text; for (const s of rules) { if (!s || typeof s.in !== 'string' || typeof s.out !== 'string') continue; if (!CLEAN_DISPLAY.has(s.type || 'editdisplay')) continue; let re; try { re = cleanBuildRe(s.in, s.flags); } catch (_) { continue; } if (cleanCatastrophic(re.source)) continue; try { o = o.replace(re, (...a) => cleanSubst(s.out, a)); } catch (_) {} } return o; }

  // ── ★customScript 이미지 정규화 — "어떤 봇 문법이든 리스처럼" ─────────────────────────────────
  //   리스가 <img="이름">를 화면에 띄울 때 쓰는 게 바로 그 캐릭터의 customScript(표시 규칙)다. 수집·치환 전에
  //   그 봇의 "이미지 변환 규칙"만 골라 본문에 먼저 적용하면, 무슨 마커 문법이든 표준형({{img::}}/<img src>)으로
  //   바뀐 뒤 우리 기존 수집·치환이 잡는다 = 패턴 두더지잡기를 넘어 리스 표시와 정합. ★텍스트 정리 규칙은 제외
  //   (out이 이미지 마커인 규칙만) → cleanMode와 무관하게 본문 텍스트를 안 건드림. cleanApply와 같은 살균·ReDoS 가드.
  const IMG_OUT_RE = /(\{\{\s*(?:img|image|raw|asset|source|emotion|bg|video|audio|path|inlay)\s*(?:::|=)|<\s*img\b|<\s*image\b|getfilesrc|asset:\/\/|emotion:\/\/)/i;
  function collectImageRules(char) {
    const out = []; const seen = new Set();
    const add = (arr) => { if (!Array.isArray(arr) || seen.has(arr)) return; seen.add(arr); for (const r of arr) if (r && typeof r.in === 'string' && typeof r.out === 'string') { const type = r.type || 'editdisplay'; if (!CLEAN_DISPLAY.has(type)) continue; if (!IMG_OUT_RE.test(r.out)) continue; out.push({ in: r.in, out: cleanSanitizeOut(r.out), type, flags: r.flag || r.flags || '' }); } };
    try { add(char && char.customscript); } catch (_) {}
    let root = null; try { root = (typeof risu.getRootDocument === 'function') ? risu.getRootDocument() : null; } catch (_) { root = null; }
    if (root) { try { add(root.presetRegex); } catch (_) {} try { if (Array.isArray(root.modules)) for (const mo of root.modules) if (mo) add(mo.regex); } catch (_) {} }
    return out;
  }

  // ★표시규칙 동봉(리스 렌더엔진 이식) — 리더가 [hsPortrait]·@hsTitle·⟦⟧ 등 모듈 DSL을 그 규칙대로 충실 렌더하게.
  //   char.customscript editdisplay(권한 불필요) + 활성 모듈 regex(getDatabase, ★모듈 DSL 있는 챗에서만 호출=권한 프롬프트 최소화).
  const DISPLAY_TYPES = new Set(['editdisplay', 'edit_display', 'display']);
  async function collectDisplayRules(char, wantModules) {
    const out = []; const seen = new Set();
    const add = (arr) => { if (!Array.isArray(arr)) return; for (const r of arr) { if (out.length >= 2000) return; if (!r || typeof r.in !== 'string' || typeof r.out !== 'string') continue; const type = r.type || 'editdisplay'; if (!DISPLAY_TYPES.has(type)) continue; const key = r.in + '' + r.out; if (seen.has(key)) continue; seen.add(key); out.push({ in: r.in, out: cleanSanitizeOut(r.out), type, flags: r.flag || r.flags || '' }); } };
    try { add(char && char.customscript); } catch (_) {}
    if (wantModules) {
      try {
        const db = await withTimeout(Promise.resolve().then(() => (typeof risu.getDatabase === 'function' ? risu.getDatabase(['modules']) : null)), 8000, null);
        if (db && Array.isArray(db.modules)) for (const mo of db.modules) { if (mo) add(mo.regex || mo.regexScript); }
      } catch (_) {}
    }
    return out;
  }

  async function buildMessages(onProgress, opts) {
    opts = opts || {};
    const noImages = !!opts.noImages;                          // 토글: 이미지(삽화·에셋) 빼고 텍스트만
    const cleanMode = opts.cleanMode || 'off';                 // 정리 방식: 'off' | 'A'(미리 정리) | 'B'(정규식 동봉)
    const budget = opts.noBudget ? Infinity : IMG_BUDGET;      // 다운로드(noBudget)=inbox 1MB 우회, 이미지 전량 포함
    const { char, chat } = await getCurrentChat();
    // ★인레이 삽화 실험(옵트인): DOM에서 blob 이미지 바이트 추출을 1회 수행, byOrder를 인레이 마커에 등장 순서대로 채움. 진단 문자열은 결과창에.
    let exp = null, inlayDiag = '';
    if (opts.inlayExp && !noImages) {
      try { const cap = await withTimeout(captureDomInlays(), 30000, { diag: '[인레이실험] 타임아웃 30s — 건너뜀(mainDom 권한 미허용 가능). 권한 허용 후 재시도.', byOrder: [] }); inlayDiag = cap.diag || ''; let ci = 0; const bo = cap.byOrder || []; exp = { next: () => (ci < bo.length ? bo[ci++] : null) }; }
      catch (e) { inlayDiag = '[인레이실험] 오류: ' + ((e && e.message) || e); }
      try { console.info('[LogPapaPush] ' + inlayDiag); } catch (_) {}
    }
    const raw = Array.isArray(chat.message) ? chat.message : [];
    const messages = []; let hit = 0, miss = 0, imgCount = 0, imgDropped = 0, imgBytes = 0;
    const assetByName = new Map();   // 캐릭터 에셋(이름→경로) 1회 구축
    for (const a of charAssetMap(char)) {   // ★확장자 있는 키(예: laica_curious.png)와 없는 키(laica_curious) 둘 다 색인 — 리스는 메시지에 <img src="이름">(확장자 생략)으로 렌더하므로, 한쪽만 색인하면 매칭 실패 → 에셋 유실.
      const k = String(a.name).toLowerCase(); assetByName.set(k, a);
      const ks = k.replace(/\.[a-z0-9]+$/i, ''); if (ks !== k && !assetByName.has(ks)) assetByName.set(ks, a);
    }
    const assets = {};   // 쓰인 에셋 dataURL 맵(이름→dataURL) — 푸시/다운로드 본체에 동봉, 우리 import가 카드 스타일로 렌더(블록 임베드 X)
    const cleanRules = (cleanMode !== 'off') ? collectCleanupRegex(char) : [];   // editdisplay 정리 규칙(A 적용·B 동봉용) 1회 수집
    const imageRules = !noImages ? collectImageRules(char) : [];   // ★봇 customScript 이미지 변환 규칙(어떤 문법이든 표준 마커로) 1회 수집
    const wantModuleRules = raw.some((m) => m && typeof m.data === 'string' && /\[[A-Za-z]\w*\s*:|@[A-Za-z]\w*\s*:|⟦/.test(m.data));   // 모듈 DSL 흔적 있을 때만 모듈 규칙 수집(권한 프롬프트 최소화)
    const displayRules = await collectDisplayRules(char, wantModuleRules);   // ★모듈/캐릭터 표시규칙 동봉 — 리더가 항상 적용(리스처럼 [hsPortrait] 등 렌더)

    // ★이미지 제자리 심기 — 원래 위치 보존(끝에 몰지 않음). 삽화=인라인 <img src="dataURL">, 에셋→{{img::이름}}(dataURL은 assets 맵).
    //   번역본(body) 안의 마커를 그 자리에서 치환. 번역이 마커를 떼어내 본문에 없으면 끝에 보충(유실 0). 예산(imgBytes)은 삽화+에셋 공유 — 클로저로 누적.
    async function embedImagesInPlace(body, original) {
      let out = String(body || '');
      // ── 삽화(inlay) ──
      const inlayUrl = {};   // id -> dataURL ('' = 실패/예산초과)  [비-실험 경로]
      let wantIds = new Set();
      const placedInlay = new Set();
      if (exp) {
        // ★실험 모드: DOM에서 캡처한 blob 이미지(byOrder)를 인레이 마커에 등장 순서대로 치환.
        //   모듈 INLAY[<CARDi>{{inlay::UUID}}] 래퍼는 통째로(내부 UUID 포함) 한 슬롯, 네이티브 {{inlay}}·lb 태그도 각 한 슬롯.
        out = out.replace(INLAY_CARD_RE, () => { const du = exp.next(); if (du) { imgCount++; return '\n\n<img src="' + du + '">\n\n'; } return ''; });
        out = out.replace(/\{\{inlay(?:ed)?::[^}]+\}\}/gi, () => { const du = exp.next(); if (du) { imgCount++; return '\n\n<img src="' + du + '">\n\n'; } return ''; });
        out = out.replace(/<lb-(?:xnai|lazy)\b[^>]*>[\s\S]*?<\/lb-(?:xnai|lazy)>/gi, () => { const du = exp.next(); if (du) { imgCount++; return '\n\n<img src="' + du + '">\n\n'; } return ''; });
        out = out.replace(/<lb-(?:xnai|lazy)\b[^>]*\/>/gi, '');
      } else {
        wantIds = new Set([...extractInlayIds(out), ...extractInlayIds(original)]);
        for (const id of wantIds) {
          if (imgBytes >= budget) { imgDropped++; inlayUrl[id] = ''; continue; }
          const du = await inlayDataUrl(id);
          if (!du) { inlayUrl[id] = ''; continue; }
          if (imgBytes + du.length > budget) { imgDropped++; inlayUrl[id] = ''; continue; }
          imgBytes += du.length; imgCount++; inlayUrl[id] = du;
        }
        out = out.replace(/\{\{inlay(?:ed)?::\s*([^}|]+?)\s*\}\}/gi, (mm, id) => { const du = inlayUrl[String(id).trim()]; if (du) { placedInlay.add(du); return '\n\n<img src="' + du + '">\n\n'; } return ''; });
        out = out.replace(/<lb-(?:xnai|lazy)\b[^>]*>([\s\S]*?)<\/lb-(?:xnai|lazy)>/gi, (mm, inner) => { for (const id of extractInlayIds(inner)) { const du = inlayUrl[id]; if (du) { placedInlay.add(du); return '\n\n<img src="' + du + '">\n\n'; } } return ''; });
        out = out.replace(/<lb-(?:xnai|lazy)\b[^>]*\/>/gi, '');
        out = out.replace(INLAY_CARD_RE, '');   // ★빈 마커 제거(글자로 새지 않게)
      }

      // ── 에셋(감정 스프라이트): 참조→{{img::표준이름}} 제자리. dataURL은 assets 맵에 1회만 ──
      for (const a of usedAssets(out + '\n' + original, assetByName)) {
        if (assets[a.name]) continue;
        if (imgBytes >= budget) { imgDropped++; continue; }
        const du = await assetDataUrl(a.path);
        if (!du) continue;
        if (imgBytes + du.length > budget) { imgDropped++; continue; }
        assets[a.name] = du; imgBytes += du.length; imgCount++;
      }
      const canon = (ref) => { const n = String(ref || '').trim().replace(/^['"″]|['"″]$/g, ''); const hit = assetByName.get(n.toLowerCase()) || assetByName.get(n.toLowerCase().replace(/\.[a-z0-9]+$/i, '')); return (hit && assets[hit.name]) ? hit.name : null; };
      const placedAsset = new Set();
      const sub = (ref) => { const c = canon(ref); if (c) { placedAsset.add(c); return '{{img::' + c + '}}'; } return null; };
      out = out.replace(/\{\{(?:img|image|raw|asset|source|emotion|image_asset)(?:::|=)\s*([^}|]+?)\s*\}\}/gi, (mm, name) => { const r = sub(name); return r == null ? mm : r; });
      out = out.replace(/\[[^\]\n|]*\|\s*([^\]\n]+?)\s*\]/g, (mm, name) => { const r = sub(name); return r == null ? mm : r; });
      out = out.replace(/<(?:img|image)\s+src=\s*(['"″]?)([^'"″>\s]+)\1[^>]*>/gi, (mm, q, name) => { if (/^(?:data:|https?:|\/\/)/i.test(name)) return mm; const r = sub(name); return r == null ? '' : r; });   // 외부/임베드(data:·http)는 보존, 매칭 안 된 맨이름 태그는 제거(깨진 아이콘 방지)
      out = out.replace(/<(?:img|image|emotion|asset|raw|bg)\s*=\s*(['"″]?)([^'"″>\s]+)\1[^>]*>/gi, (mm, q, name) => { if (/^(?:data:|https?:|\/\/)/i.test(name)) return mm; const r = sub(name); return r == null ? '' : r; });   // ★등호형 <img="이름"> → {{img::표준이름}} 제자리(매칭 안 되면 제거)

      // ── 폴백: 번역이 떼어내 본문에 못 들어간 이미지 → 끝에 보충(유실 0) ──
      for (const id of wantIds) { const du = inlayUrl[id]; if (du && !placedInlay.has(du)) { placedInlay.add(du); out += '\n\n<img src="' + du + '">'; } }
      for (const a of usedAssets(original, assetByName)) { if (assets[a.name] && !placedAsset.has(a.name)) { placedAsset.add(a.name); out += '\n\n{{img::' + a.name + '}}'; } }

      return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    for (let i = 0; i < raw.length; i++) {
      onProgress?.(i + 1, raw.length);
      const m = raw[i];
      if (!m || typeof m.data !== 'string') continue;
      // 활성(표시중) swipe 우선 — 나머지 swipe는 제외.
      const hasSwipes = Array.isArray(m.swipes) && m.swipes.length > 0;
      const sid = hasSwipes ? (m.swipeId ?? 0) : -1;
      const original = (sid >= 0 && m.swipes[sid] !== undefined) ? m.swipes[sid] : m.data;
      const tr = await translateViaCache(original);   // ★캐시 부분검색 매칭(원문/문단 정확조회는 키가 어긋나 미스)
      if (tr.hit) hit++; else miss++;
      // 번역본 기준으로 본문 구성. 이미지는 ★제자리 치환(원래 위치 보존) — 삽화=인라인 <img>, 에셋={{img::이름}}. ★1MB 예산은 삽화+에셋 공유.
      let body = String(tr.text || '');
      if (cleanMode === 'A') body = cleanApply(body, cleanRules);   // ★(A) 미리 정리 — 이미지 심기 전에 적용(새 dataURL·마커는 그 뒤에 들어가 안 건드림)
      // ★customScript 이미지 정규화 — 어떤 봇 문법이든 표준 마커로(리스 표시와 정합). 멱등(이미 표준형이면 무동작).
      const origForImg = imageRules.length ? cleanApply(original, imageRules) : original;
      if (imageRules.length) body = cleanApply(body, imageRules);
      if ((hasReadImage || exp) && !noImages) body = await embedImagesInPlace(body, origForImg);
      else body = stripImageMarkers(body);   // 텍스트만(noImages): 이미지 마커 제거(기존 거동)
      body = unwrapBgImageMarker(stripCbsControl(body)).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();   // ★모듈 CBS 조건문({{#if 최근3}})·배경이미지 div 래퍼 정리 — 글자로 새지 않게
      if (!body.trim()) continue;   // 텍스트·이미지 둘 다 없으면 건너뜀(이미지만 있으면 보냄)
      messages.push({ role: m.role === 'user' ? 'user' : 'char', text: body });
    }
    const charName = String(char.name || '리스 로그').slice(0, 300);   // 규칙: char ≤300자
    // ★챗 지문(fp) = 캐릭터명 + 첫 메시지 해시(이어가도 불변) → 보관 시 같은 챗 이어붙이기·중복 방지.
    const firstRaw = raw.find((m) => m && typeof m.data === 'string' && m.data.trim());
    const fp = fpHash(charName + '::' + ((firstRaw && firstRaw.data) || ''));
    return { charName, messages, hit, miss, fp, imgCount, imgDropped, assets, cleanupRegex: cleanMode === 'B' ? cleanRules : null, displayRules: displayRules.length ? displayRules : null, inlayDiag };
  }

  // ── Firestore REST(타입 지정 본문)로 inbox에 create ───────────────
  function msgArray(messages) {
    return { arrayValue: { values: messages.map((m) => ({ mapValue: { fields: {
      role: { stringValue: m.role }, text: { stringValue: m.text },
    } } })) } };
  }
  function assetsMapValue(assets) {   // {이름:dataURL} → Firestore mapValue
    const fields = {}; for (const k of Object.keys(assets || {})) fields[k] = { stringValue: String(assets[k]) };
    return { mapValue: { fields } };
  }
  function regexArrayValue(rules) {   // [{in,out,type,flags}] → Firestore arrayValue(mapValue)
    return { arrayValue: { values: (rules || []).map((r) => ({ mapValue: { fields: { in: { stringValue: String(r.in || '') }, out: { stringValue: String(r.out || '') }, type: { stringValue: String(r.type || 'editdisplay') }, flags: { stringValue: String(r.flags || '') } } } })) } };
  }
  async function postInbox(uid, secret, charName, messages, translated, fp, assets, cleanupRegex, displayRules) {
    const body = { fields: {
      uid: { stringValue: uid },
      key: { stringValue: secret },
      char: { stringValue: charName },
      translated: { booleanValue: !!translated },
      source: { stringValue: 'risu' },
      createdAt: { integerValue: String(Date.now()) },
      messages: msgArray(messages),
      fp: { stringValue: String(fp || '') },   // ★챗 지문(이어붙이기용)
    } };
    if (assets && Object.keys(assets).length) body.fields.assets = assetsMapValue(assets);   // ★쓰인 에셋(이름→dataURL) — import가 카드 스타일로 렌더
    if (cleanupRegex && cleanupRegex.length) body.fields.cleanupRegex = regexArrayValue(cleanupRegex);   // ★(B) 정리 정규식 동봉 — 리더가 살균·비파괴 적용
    if (displayRules && displayRules.length) body.fields.displayRules = regexArrayValue(displayRules);   // ★모듈/캐릭터 표시규칙 동봉 — 리더가 항상 적용(리스처럼)
    const fetchFn = (typeof risu.nativeFetch === 'function') ? risu.nativeFetch : fetch;   // CORS 우회(데스크탑/탑) 위해 nativeFetch 우선
    let res;
    try { res = await fetchFn(INBOX_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch (e) { throw new Error('네트워크 오류: ' + ((e && e.message) || e)); }
    // 응답을 표준 fetch / RisuAI nativeFetch 양쪽 모양에서 관대하게 해석.
    const status = (res && (typeof res.status === 'number' ? res.status : (res.ok ? 200 : 0))) || 0;
    let raw = '';
    try { raw = (typeof res.text === 'function') ? await res.text() : (typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? res.body ?? '')); } catch (_) {}
    let json = {}; try { json = JSON.parse(raw); } catch (_) {}
    const ok = status === 200 || status === 201 || !!(json && json.name);   // create 성공 = 문서 name 반환
    if (!ok) {
      const msg = (json && json.error && json.error.message) || raw || ('status ' + status);
      throw new Error('전송 실패 (' + status + '): ' + String(msg).slice(0, 300));
    }
  }

  function escapeHtml(t) { return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  const STYLES = `
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#1a1410; color:#ece2d2; display:flex; justify-content:center; padding:24px; min-height:100vh; }
    .wrap { max-width:520px; width:100%; }
    .ic { width:1.05em; height:1.05em; vertical-align:-.16em; }
    .spin { animation:lp-spin .9s linear infinite; }
    @keyframes lp-spin { to { transform:rotate(360deg); } }
    .top-bar { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; }
    h1 { font-size:17px; color:#fff; display:inline-flex; align-items:center; gap:7px; }
    .section { background:#221c15; border:1px solid #342b20; border-radius:10px; padding:18px; margin-bottom:14px; }
    .desc { font-size:13px; color:#b3a692; line-height:1.7; }
    .section-title { font-size:12px; color:#897d6a; margin-bottom:10px; text-transform:uppercase; letter-spacing:.05em; }
    input[type=text] { width:100%; padding:10px 12px; border-radius:8px; border:1px solid #423626; background:#18140f; color:#ece2d2; font-size:13px; font-family:monospace; }
    .btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:11px 20px; border-radius:8px; border:none; font-size:14px; font-weight:600; cursor:pointer; }
    .btn:active { transform:scale(.98); }
    .btn-primary { background:#d07440; color:#1a140e; width:100%; margin-top:10px; }
    .btn-primary:hover { filter:brightness(1.08); }
    .btn-primary:disabled { background:#3a2f22; color:#776; cursor:default; filter:none; }
    .btn-danger { background:#2a1a14; color:#e07a5f; border:1px solid #5a2a1a; }
    .hint { font-size:11px; color:#776; margin-top:8px; line-height:1.6; }
    .status { display:flex; align-items:flex-start; gap:8px; padding:11px 14px; border-radius:8px; font-size:13px; margin-top:14px; line-height:1.6; }
    .status .ic { flex:none; margin-top:.2em; }
    .status:empty { display:none; }
    .status.progress { background:#221c15; border:1px solid #423626; color:#c8bca6; }
    .status.info { background:#2a2418; border:1px solid #4a3f2c; color:#d9c89a; }
    .status.success { background:#16281a; border:1px solid #2a5a3a; color:#7fae80; }
    .status.error { background:#2a1410; border:1px solid #5a2a1a; color:#e07a5f; }
  `;

  function renderUI() {
    document.body.innerHTML = `
      <style>${STYLES}</style>
      <div class="wrap">
        <div class="top-bar">
          <h1>${ic('flame')} 로그파파로 보내기</h1>
          <button class="btn btn-danger" id="closeBtn" style="width:auto;">${ic('x')} 닫기</button>
        </div>
        <div class="section">
          <div class="section-title">연결 키</div>
          <div id="keyConnected" class="desc" style="display:none;">${ic('check')} 연결됨 — 리스 플러그인 설정(connectKey)에서 바꿀 수 있어요. <a id="keyEdit" style="color:#d07440;cursor:pointer;text-decoration:underline;">키 바꾸기</a></div>
          <div id="keyInputWrap">
            <div class="desc" style="margin-bottom:10px;">로그파파 앱 → 설정 → <b>리스 연결</b>에서 키를 복사해 붙여넣으세요. 한 번만 하면 기억됩니다.</div>
            <input type="text" id="keyInput" placeholder="uid:secret 형태의 연결 키" autocomplete="off" spellcheck="false" />
            <div class="hint">이 키는 비밀번호가 아닙니다 — 채팅 세션을 "넣기"만 가능합니다.</div>
          </div>
        </div>
        <div class="section">
          <div class="section-title">이 세션 보내기 (번역 캐시 적용)</div>
          <div class="desc">지금 보고 있는 채팅 세션을 번역 캐시와 함께 로그파파 서재로 보냅니다(리스 <b>LLM 번역기</b>로 번역한 부분만 — 구글·DeepL은 캐시를 안 남겨요). 캐시 없는 메시지는 원문 유지.</div>
          <label style="display:flex;align-items:center;gap:8px;margin:10px 0;cursor:pointer;font-size:14px;"><input type="checkbox" id="noImgChk" /> 이미지(삽화·에셋) 빼고 텍스트만 보내기</label>
          <label style="display:flex;align-items:center;gap:8px;margin:10px 0;font-size:14px;">자동 정리(군더더기)
            <select id="cleanMode" style="flex:1;padding:6px 8px;border-radius:8px;background:#1c1813;color:#e8dcc8;border:1px solid #423626;">
              <option value="off">안 함</option>
              <option value="A">미리 정리해서 보냄 (받는 곳에 깔끔히)</option>
              <option value="B">정규식 동봉 (리더에서 정리/원본 토글)</option>
            </select></label>
          <label style="display:flex;align-items:center;gap:8px;margin:10px 0;cursor:pointer;font-size:14px;"><input type="checkbox" id="inlayExpChk" /> 인레이 삽화 실험 — 모듈이 생성한 삽화 가져오기 시도 (실험적)</label>
          <div class="hint" id="inlayExpHint" style="display:none;margin-top:-4px;">삽화가 실제로 뜬 챗에서 켜세요. ★켠 뒤 <b>리스를 새로고침</b>하면 메인 화면에 <b>‘화면 접근(mainDom)’ 권한 창</b>이 떠요 — 꼭 <b>허용</b>하세요(이게 핵심. 놓치면 진단에 ‘DOM null’). 그 다음 이 창에서 <b>‘번역+이미지 JSON 내려받기’</b> → 뜨는 <b>진단 한 줄</b>을 복사해 회신해 주세요.</div>
          <button class="btn btn-primary" id="sendBtn">${ic('send')} 이 세션 보내기</button>
          <div class="hint" style="margin-top:14px;">이미지가 많아 전송이 무겁거나 실패하면(받은편지함 1MB 한도) 아래로 받아 “채팅 가져오기”로 넣으세요 — 용량 제한 없이 삽화·에셋이 다 들어옵니다.</div>
          <button class="btn btn-primary" id="dlBtn" style="margin-top:8px;opacity:.9;">${ic('download')} 번역+이미지 JSON 내려받기</button>
        </div>
        <div id="status" class="status" style="display:none;"></div>
      </div>
    `;
    const statusEl = document.getElementById('status');
    // ★회전 로더(spin)는 진행 단계(progress)에서만. 완료·안내(success/info)·에러는 정지 아이콘 →
    //   캐시 0이라 info로 띄워도 스피너가 안 돈다(끝났는데 무한히 돌던 버그 수정). 캐시 0 구분은 .status 색·문구로만.
    const setStatus = (type, msg) => {
      const i = type === 'progress' ? ic('loader', 'spin') : type === 'success' ? ic('check') : type === 'error' ? ic('alert') : ic('check');
      statusEl.className = `status ${type}`; statusEl.style.display = 'flex'; statusEl.innerHTML = i + '<span>' + msg + '</span>';
    };
    // 인레이 실험 진단 — 결과창에 복사 가능한 한 줄(커뮤니티 회신용).
    const diagHtml = (d) => d ? ('<br><br><b>인레이 실험 진단</b> — 아래 한 줄을 복사해 로그파파에 회신해 주세요:<br><code style="display:block;background:#18140f;border:1px solid #423626;border-radius:6px;padding:8px;font-size:11px;color:#d9c89a;word-break:break-all;margin-top:4px;">' + escapeHtml(d) + '</code>') : '';
    const keyInput = document.getElementById('keyInput');
    const keyWrap = document.getElementById('keyInputWrap');
    const keyDone = document.getElementById('keyConnected');
    loadKey().then((k) => { keyInput.value = k; if (k) { keyWrap.style.display = 'none'; keyDone.style.display = 'block'; } });   // 키 있으면(리스 설정/이전 입력) 입력란 숨김 → "연결됨 ✓"
    keyInput.addEventListener('change', () => { saveKey(keyInput.value); });
    document.getElementById('keyEdit').addEventListener('click', () => { keyDone.style.display = 'none'; keyWrap.style.display = 'block'; keyInput.focus(); });
    const cleanSel = document.getElementById('cleanMode');   // 정리 방식(off/A/B) — 마지막 선택 기억
    try { cleanSel.value = localStorage.getItem('pro2-push-cleanmode') || 'off'; } catch (_) {}
    cleanSel.addEventListener('change', () => { try { localStorage.setItem('pro2-push-cleanmode', cleanSel.value); } catch (_) {} });
    const inlayChk = document.getElementById('inlayExpChk');   // 인레이 실험 토글 — 상태 기억 + 힌트 표시
    const inlayHint = document.getElementById('inlayExpHint');
    try { inlayChk.checked = localStorage.getItem('pro2-push-inlayexp') === '1'; } catch (_) {}
    const syncInlayHint = () => { inlayHint.style.display = inlayChk.checked ? 'block' : 'none'; };
    syncInlayHint();
    inlayChk.addEventListener('change', () => { try { localStorage.setItem('pro2-push-inlayexp', inlayChk.checked ? '1' : '0'); } catch (_) {} syncInlayHint(); });

    document.getElementById('closeBtn').addEventListener('click', async () => { await risu.hideContainer(); });

    document.getElementById('sendBtn').addEventListener('click', async () => {
      const btn = document.getElementById('sendBtn');
      saveKey(keyInput.value);   // 입력한 키 영속 저장(다음부터 자동 채움)
      const parsed = splitKey(keyInput.value);
      if (!parsed) { setStatus('error', '연결 키 형식이 올바르지 않아요. 로그파파 "리스 연결"에서 키를 다시 복사해 붙여넣으세요.'); return; }
      btn.disabled = true;
      setStatus('progress', '챗을 읽고 번역 캐시를 적용하는 중...');
      try {
        const noImages = document.getElementById('noImgChk').checked;
        const inlayExp = document.getElementById('inlayExpChk').checked;
        const { charName, messages, hit, miss, fp, imgCount, imgDropped, assets, cleanupRegex, displayRules, inlayDiag } = await buildMessages((c, t) => setStatus('progress', `번역 캐시 적용 중... ${c}/${t}`), { noImages, cleanMode: cleanSel.value, inlayExp });
        if (!messages.length) { setStatus('error', '보낼 메시지가 없습니다.'); btn.disabled = false; return; }
        if (messages.length > 5000) { setStatus('error', '메시지가 너무 많습니다(5000개 초과). 챗을 나눠 보내주세요.'); btn.disabled = false; return; }
        setStatus('progress', `로그파파로 보내는 중... (${messages.length}개)`);
        await postInbox(parsed.uid, parsed.secret, charName, messages, hit > 0, fp, assets, cleanupRegex, displayRules);
        let okMsg = `보냈어요 — <b>${escapeHtml(charName)}</b> (${messages.length}개, 캐시 ${hit} / 원문 ${miss}${imgCount ? ` · 이미지 ${imgCount}개` : ''})<br>로그파파 앱(서재)의 받은 로그함에서 보관하세요.`;
        if (imgDropped > 0) okMsg += `<br><br>이미지 ${imgDropped}개는 용량(1MB) 한도로 못 담았어요 — “이미지 JSON 내려받기”로 받으면 다 들어와요.`;
        if (miss > 0) okMsg += `<br><br>${hit === 0 ? '번역이 안 따라왔어요 — ' : '일부는 원문이에요 — '}리스에서 <b>LLM 번역기</b>로 번역한 챗만 따라와요(구글·DeepL은 플러그인용 캐시를 안 남깁니다). 또는 GigaTrans로 번역한 챗은 번역기와 무관하게 그대로 들어와요.`;
        okMsg += diagHtml(inlayDiag);
        setStatus(hit === 0 && miss > 0 ? 'info' : 'success', okMsg);
      } catch (err) {
        setStatus('error', escapeHtml((err && err.message) || String(err)));
      } finally {
        btn.disabled = false;
      }
    });

    // (b) 번역+이미지 JSON 내려받기 — ★inbox 1MB 우회. 받은 파일을 앱의 "채팅 가져오기"로 임포트(우리 parseRisuLog가 읽는 risuChat 형식, 본문에 이미지 임베드).
    document.getElementById('dlBtn').addEventListener('click', async () => {
      const dl = document.getElementById('dlBtn'); dl.disabled = true;
      setStatus('progress', '챗을 읽고 번역·이미지를 모으는 중...');
      try {
        const noImages = document.getElementById('noImgChk').checked;
        const inlayExp = document.getElementById('inlayExpChk').checked;
        const { charName, messages, imgCount, assets, cleanupRegex, displayRules, inlayDiag } = await buildMessages((c, t) => setStatus('progress', `모으는 중... ${c}/${t}`), { noImages, noBudget: true, cleanMode: cleanSel.value, inlayExp });
        if (!messages.length) { setStatus('error', '내려받을 메시지가 없습니다.'); dl.disabled = false; return; }
        const obj = { type: 'risuChat', ver: 1, data: { name: charName, message: messages.map((m) => ({ role: m.role, data: m.text })) }, assets };   // ★assets 맵 동봉(우리 import가 카드 스타일로 렌더)
        if (cleanupRegex && cleanupRegex.length) obj.cleanupRegex = cleanupRegex;   // ★(B) 정리 정규식 동봉 — 가져오기 시 리더가 비파괴 적용
        if (displayRules && displayRules.length) obj.displayRules = displayRules;   // ★모듈/캐릭터 표시규칙 동봉 — 리더가 항상 적용(리스처럼 모듈 DSL 렌더)
        const iso = new Date().toISOString().replace(/[:.]/g, '-');
        const safe = (String(charName).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '로그');
        const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${safe}_${iso}_chat.json`;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
        setStatus('success', `내려받았어요 — <b>${escapeHtml(charName)}</b> (${messages.length}개${imgCount ? ` · 이미지 ${imgCount}장` : ''}).<br>로그파파 앱(서재)의 <b>채팅 가져오기</b>로 넣으면 삽화·에셋이 다 보여요(용량 제한 없음).` + diagHtml(inlayDiag));
      } catch (err) { setStatus('error', escapeHtml((err && err.message) || String(err))); }
      finally { dl.disabled = false; }
    });
  }

  await risu.registerButton(
    {
      name: '로그파파로 보내기',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12c2 -2.96 0 -7 -1 -8c0 3.038 -1.773 4.741 -3 6c-1.226 1.26 -2 3.24 -2 5a6 6 0 1 0 12 0c0 -1.532 -1.056 -3.94 -2 -5c-1.786 3 -2.791 3 -4 2z"></path></svg>`,
      iconType: 'html',
      location: 'chat',
    },
    async () => { await risu.showContainer('fullscreen'); renderUI(); }
  );

  await risu.onUnload(async () => { console.log('[LogPapaPush] Unloaded.'); });
  // ★인레이 실험 권한 사전획득 — 이전에 실험 켰던 사용자면 플러그인 로드 시(전체화면 전·메인화면)에 mainDom 권한 프롬프트를 미리 띄움(보이게·1회). 허용되면 영속.
  try { let on = false; try { on = localStorage.getItem('pro2-push-inlayexp') === '1'; } catch (_) {} if (on && typeof risu.getRootDocument === 'function') { Promise.resolve().then(() => risu.getRootDocument()).catch(() => {}); } } catch (_) {}
  console.info('[LogPapaPush] loaded v1.15.0');
})();
