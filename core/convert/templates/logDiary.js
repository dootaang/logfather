// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// core/convert/templates/logDiary.js
// 출력 디자인 "로그 다이어리" — log-diary.github.io 의 잡지/일기장 레이아웃을 아카(Froala) 호환 인라인 HTML로 이식.
// 1단계: 표지(안전변형)+본문+테마. 2단계: 프로필(최대 6)+코멘트+소개글. 3단계: 다중 페이지+사운드트랙+페이지 접기.
//   ★아카 불변식: <img> 인라인 + max-width:% 만. background-image / class / <style> 없음. (사운드트랙은 예외=아래 주석)
//   ★표지·프로필 이미지는 원작 background-image div를 아카가 떼어내므로 인라인 <img>로 변환(프로필 동그라미=border-radius:50%, 리치복사 정사각크롭).
//   ★다중 페이지: 본문에 `[페이지]` / `[페이지: 제목]` / `[페이지: 제목 | 부제]` 줄로 나눔(없으면 1페이지=기존과 동일).
//   ★사운드트랙: 유튜브 iframe은 아카가 strip → '썸네일 이미지(외부 URL)+영상 링크'로 대체. (아카 실붙여넣기 검증 필요)
//   ★페이지 접기(<details>): 옵션(기본 off). 아카 생존 미확인 → UI에 명시.
'use strict';
const { prepareBody } = require('../prepareBody.js');
const { DIARY_THEMES, RATIO_VALUE } = require('./logDiaryThemes.js');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escBr = (s) => esc(s).replace(/\n/g, '<br>');

function pxToClamp(maxPx, minRatio) {
  minRatio = minRatio || 0.75;
  const min = Math.round(maxPx * minRatio);
  const vw = (maxPx / 900 * 100).toFixed(2);
  return 'clamp(' + min + 'px, ' + vw + 'vw, ' + maxPx + 'px)';
}
function fontFallback(font) {
  const sans = ['Pretendard', 'Noto Sans KR', 'Nanum Gothic', 'Gothic A1', 'Gowun Dodum', 'IBM Plex Sans KR'];
  return sans.indexOf(font) >= 0 ? 'sans-serif' : 'serif';
}
function safeSrc(url) {
  const t = String(url || '').trim();
  if (!t) return '';
  if (/^data:image\//i.test(t)) return t;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^\/\//.test(t)) return 'https:' + t;
  return '';
}
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
}
// 유튜브 영상 ID 추출 + 엄격 검증([A-Za-z0-9_-], URL/속성 주입 방지). 없으면 ''.
function youtubeId(url) {
  const s = String(url || '');
  let m = s.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/\s]+)/);
  if (!m) m = s.match(/youtube\.com\/.*[?&]v=([^&?/\s]+)/);
  const id = m ? m[1] : '';
  return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : '';
}

// 본문 → 페이지 배열. `[페이지]`/`[페이지: 제목]`/`[페이지: 제목 | 부제]` 줄로 분할. 첫 페이지 헤더는 cfg.pageTitle/부제.
const PAGE_MARK = /^\s*\[\s*(?:페이지|page)\s*(?::\s*([^\]]*?))?\s*\]\s*$/i;
function splitPages(input, cfg) {
  const out = [];
  let cur = { title: cfg.pageTitle, subtitle: cfg.pageSubtitle, lines: [] };
  for (const ln of String(input == null ? '' : input).split('\n')) {
    const m = ln.match(PAGE_MARK);
    if (m) {
      out.push(cur);
      const meta = String(m[1] || '').split('|');
      cur = { title: (meta[0] || '').trim(), subtitle: (meta[1] || '').trim(), lines: [] };
    } else {
      cur.lines.push(ln);
    }
  }
  out.push(cur);
  return out;
}

function mergeDiarySettings(settings) {
  const raw = (settings && settings.templateSettings && settings.templateSettings['log-diary']) || {};
  const theme = Object.prototype.hasOwnProperty.call(DIARY_THEMES, raw.theme) ? raw.theme : 'basic';
  const profilesRaw = Array.isArray(raw.profiles) ? raw.profiles : [];
  const profiles = profilesRaw.slice(0, 6).filter((p) => p && typeof p === 'object').map((p) => ({
    image: safeSrc(p.image), tag: String(p.tag || ''), name: String(p.name || ''), desc: String(p.desc || ''),
  }));
  const cmt = (raw.comment && typeof raw.comment === 'object') ? raw.comment : {};
  const st = (raw.soundtrack && typeof raw.soundtrack === 'object') ? raw.soundtrack : {};
  const pagesRaw = Array.isArray(raw.pages) ? raw.pages : [];
  const pages = pagesRaw.slice(0, 50).filter((p) => p && typeof p === 'object').map((p) => (
    p.itemType === 'section'
      // 섹션(챕터 구분 띠): 이미지+섹션제목/부제. bakedSection=web이 구워 넣는 띠 이미지(transient).
      ? { itemType: 'section', title: String(p.title || ''), subtitle: String(p.subtitle || ''), image: safeSrc(p.image), bakedSection: typeof p.bakedSection === 'string' ? p.bakedSection : '' }
      // 페이지(내용 블록): 제목/부제 텍스트 헤더 + 내용.
      : { itemType: 'page', title: String(p.title || ''), subtitle: String(p.subtitle || ''), content: String(p.content == null ? '' : p.content) }
  ));
  return {
    pages,
    theme,
    font: typeof raw.font === 'string' && raw.font ? raw.font : 'Noto Serif KR',
    coverImage: safeSrc(raw.coverImage),
    coverArchiveNo: String(raw.coverArchiveNo || ''),
    coverTitle: String(raw.coverTitle || ''),
    coverSubtitle: String(raw.coverSubtitle || ''),
    coverTags: Array.isArray(raw.coverTags) ? raw.coverTags.slice(0, 8).map((t) => String(t == null ? '' : t).trim()).filter(Boolean) : [], // 표지 태그(모델·프롬프트 등)
    coverTextScale: (() => { const n = Number(raw.coverTextScale); return isFinite(n) ? Math.max(0.8, Math.min(2.5, n)) : 1.5; })(), // 표지 글씨 크기 배율(기본 1.5)

    profiles,
    intro: String(raw.intro || ''),
    summary: String(raw.summary || ''),
    soundtrack: { url: String(st.url || ''), title: String(st.title || ''), artist: String(st.artist || '') },
    pageTitle: String(raw.pageTitle || ''),
    pageSubtitle: String(raw.pageSubtitle || ''),
    collapse: !!raw.collapse,
    imageRatio: (raw.imageRatio && RATIO_VALUE[raw.imageRatio]) ? raw.imageRatio : '', // 표지·페이지 이미지 비율(빈값=원본)
    coverBake: !!raw.coverBake,                 // 표지를 한 장 이미지로 굽기(이미지+페이드+제목, web canvas) → 아카가 못 떼는 픽셀
    bakedCover: typeof raw.bakedCover === 'string' ? raw.bakedCover : '', // web이 구워 넣는 표지 이미지 data URL(렌더 시 주입, 저장 안 됨)
    coverOverlay: raw.coverOverlay === true,   // 기본 off(아카 한계로 보류): 이미지 아래 텍스트=안전변형. on이면 이미지 위 그라데이션(실험적).
    quoteHighlight: raw.quoteHighlight !== false, // 기본 on: 대사/속마음 배경 하이라이트(다이어리 특유).
    forceThumbnail: !!raw.forceThumbnail,         // 기본 off: 글 맨 위 숨김 0x0 <img>로 아카 게시글 대표 썸네일 고정(표지/첫 이미지).
    comment: { nickname: String(cmt.nickname || ''), text: String(cmt.text || '') },
  };
}

function themedBodySettings(settings, theme, highlight) {
  const t = Object.assign({}, settings.text || {});
  t.narrationColor = theme.text;
  t.dialogColor = theme.quote2Text || theme.header;
  t.innerThoughtsColor = theme.em;
  if (highlight) {
    // 원작 다이어리: 대사=quote2(배경+글자), 속마음=quote1. formatConversation 배경 옵션으로 전달.
    t.dialogBgColor = theme.quote2Bg; t.dialogTextColor = theme.quote2Text;
    t.innerThoughtsBgColor = theme.quote1Bg; t.innerThoughtsTextColor = theme.quote1Text;
  }
  return Object.assign({}, settings, { text: t, __outputHooks: false });
}

function sectionLabel(text, theme, fontStack, sizeClamp) {
  return '<span style="display:inline-block;font-size:' + sizeClamp + ';font-weight:600;letter-spacing:clamp(1.5px, 0.3vw, 2px);color:' + theme.headerText + ';text-transform:uppercase;border-bottom:1px solid ' + theme.headerText + ';padding-bottom:5px;font-family:' + fontStack + ';">' + esc(text) + '</span>';
}

function buildCoverText(cfg, theme, fontStack) {
  let t = '';
  const sc = cfg.coverTextScale || 1.5;
  if (cfg.coverArchiveNo.trim()) t += '<p style="margin:0 0 5px 0;font-size:' + pxToClamp(Math.round(11 * sc)) + ';letter-spacing:clamp(2px, 0.4vw, 3px);color:' + theme.tagText + ';font-family:' + fontStack + ';">' + esc(cfg.coverArchiveNo) + '</p>';
  if (cfg.coverTitle.trim()) t += '<h1 style="margin:0 0 8px 0;font-size:' + pxToClamp(Math.round(42 * sc)) + ';font-weight:700;line-height:1.1;color:' + theme.header + ';word-break:keep-all;font-family:' + fontStack + ';">' + esc(cfg.coverTitle) + '</h1>';
  if (cfg.coverSubtitle.trim()) t += '<div style="margin:0;font-size:' + pxToClamp(Math.round(14 * sc)) + ';letter-spacing:-0.5px;color:' + theme.text + ';font-family:' + fontStack + ';">' + esc(cfg.coverSubtitle) + '</div>';
  t += buildCoverTags(cfg.coverTags, theme, fontStack, false, sc);
  return t ? '<div style="padding:0 clamp(30px, 5vw, 40px);text-align:center;">' + t + '</div>' : '';
}

// 표지 태그 칩(모델·프롬프트 등). white=true면 이미지 위(흰 테두리), false면 카드 위(테마색). 굽기 모드는 캔버스에 직접 그림(여긴 안 굽는 경로용).
function buildCoverTags(tags, theme, fontStack, white, scale) {
  const valid = (Array.isArray(tags) ? tags : []).map((t) => String(t == null ? '' : t).trim()).filter(Boolean);
  if (!valid.length) return '';
  const sc = scale || 1.5;
  const bg = white ? 'rgba(255,255,255,0.1)' : theme.quote1Bg;
  const fg = white ? '#ffffff' : theme.text;
  const bd = white ? 'rgba(255,255,255,0.3)' : theme.divider;
  // log-diary 그대로: 각진 사각(border-radius 없음) + 작은 글씨(표지 글씨 크기 배율 반영).
  const fz = pxToClamp(Math.round(11 * sc)), py = pxToClamp(Math.round(5 * sc)), px = pxToClamp(Math.round(12 * sc));
  let h = '<div style="font-size:0;margin-top:10px;">';
  for (const t of valid) {
    h += '<span style="display:inline-block;vertical-align:top;background:' + bg + ';color:' + fg + ';padding:' + py + ' ' + px + ';margin:0 clamp(6px, 0.89vw, 8px) clamp(6px, 0.89vw, 8px) 0;border:1px solid ' + bd + ';font-size:' + fz + ';font-family:' + fontStack + ';">' + esc(t) + '</span>';
  }
  return h + '</div>';
}

// 오버레이용 표지 텍스트(이미지 위 그라데이션 안 — 흰 글씨 + 그림자).
function buildCoverTextOverlay(cfg, fontStack) {
  let t = '';
  const sc = cfg.coverTextScale || 1.5;
  if (cfg.coverArchiveNo.trim()) t += '<p style="margin:0 0 5px 0;font-size:' + pxToClamp(Math.round(11 * sc)) + ';letter-spacing:clamp(2px, 0.4vw, 3px);color:rgba(255,255,255,0.8);text-shadow:0 2px 4px rgba(0,0,0,0.5);font-family:' + fontStack + ';">' + esc(cfg.coverArchiveNo) + '</p>';
  if (cfg.coverTitle.trim()) t += '<h1 style="margin:0 0 5px 0;font-size:' + pxToClamp(Math.round(42 * sc)) + ';font-weight:700;line-height:1.0;color:#ffffff;text-shadow:0 4px 15px rgba(0,0,0,0.6);word-break:keep-all;font-family:' + fontStack + ';">' + esc(cfg.coverTitle) + '</h1>';
  if (cfg.coverSubtitle.trim()) t += '<div style="margin:0;font-size:' + pxToClamp(Math.round(14 * sc)) + ';letter-spacing:-0.5px;color:rgba(255,255,255,0.9);text-shadow:0 1px 3px rgba(0,0,0,0.8);font-family:' + fontStack + ';">' + esc(cfg.coverSubtitle) + '</div>';
  t += buildCoverTags(cfg.coverTags, null, fontStack, true, sc);
  return t;
}

function buildProfiles(profiles, theme, fontStack) {
  const valid = profiles.filter((p) => (p.name && p.name.trim()) || (p.desc && p.desc.trim()) || p.image);
  if (!valid.length) return '';
  let h = '<div style="padding:clamp(8px, 1.5vw, 12px) clamp(30px, 5vw, 50px) 10px;text-align:center;">' + sectionLabel('Profile', theme, fontStack, 'clamp(11px, 2vw, 13px)') + '</div>';
  h += '<div style="width:100%;text-align:center;font-size:0;padding:0 clamp(15px, 3vw, 25px);">';
  for (const p of valid) {
    const img = safeSrc(p.image);
    h += '<div style="display:inline-block;width:50%;max-width:350px;vertical-align:top;text-align:center;box-sizing:border-box;padding:0 clamp(15px, 4vw, 30px);margin-bottom:clamp(20px, 4vw, 30px);">';
    if (img) {
      h += '<div style="display:inline-block;width:100%;max-width:clamp(130px, 18vw, 200px);margin:0 auto clamp(10px, 2vw, 15px) auto;">' +
        '<img src="' + img + '" alt="profile" class="fr-fic fr-dii" style="display:block;width:100%;max-width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:50%;box-shadow:rgba(0,0,0,0.12) 0px 4px 16px;">' +
        '</div>';
    }
    if (p.tag && p.tag.trim()) h += '<div style="font-size:clamp(8px, 1.3vw, 10px);color:' + theme.tagText + ';margin-bottom:3px;font-weight:600;text-transform:uppercase;font-family:' + fontStack + ';">' + esc(p.tag) + '</div>';
    if (p.name && p.name.trim()) h += '<div style="font-size:clamp(13px, 2.5vw, 18px);font-weight:700;color:' + theme.headerText + ';line-height:1.2;margin-bottom:clamp(6px, 1.5vw, 10px);font-family:' + fontStack + ';">' + esc(p.name) + '</div>';
    if (p.desc && p.desc.trim()) h += '<div style="font-size:clamp(11px, 2vw, 12px);line-height:1.6;color:' + theme.text + ';word-break:keep-all;font-family:' + fontStack + ';">' + escBr(p.desc) + '</div>';
    h += '</div>';
  }
  h += '</div>';
  return h;
}

// 사운드트랙: 유튜브 썸네일(외부 URL)+영상 링크. iframe 미사용(아카 strip). 썸네일은 외부 URL이라 리치복사 임베드 대상 아님.
function buildSoundtrack(st, theme, fontStack) {
  const id = youtubeId(st.url);
  if (!id) return '';
  const watch = 'https://www.youtube.com/watch?v=' + id;
  const thumb = 'https://img.youtube.com/vi/' + id + '/hqdefault.jpg';
  let h = '<div style="padding:clamp(14px, 3vw, 20px) clamp(30px, 5vw, 50px) 0;text-align:center;">' + sectionLabel('Soundtrack', theme, fontStack, 'clamp(11px, 2vw, 13px)') + '</div>';
  h += '<div style="text-align:center;padding:clamp(12px, 2vw, 16px) clamp(20px, 5vw, 40px) 0;">';
  h += '<a href="' + watch + '" target="_blank" rel="noopener" style="display:inline-block;width:100%;max-width:300px;text-decoration:none;">';
  h += '<img src="' + thumb + '" alt="soundtrack" class="fr-fic fr-dii" style="display:block;width:100%;max-width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:6px;">';
  h += '</a>';
  if (st.title || st.artist) {
    h += '<div style="max-width:300px;margin:clamp(12px, 2.5vw, 18px) auto 0;text-align:center;">';
    if (st.title) h += '<div style="font-size:clamp(13px, 2.5vw, 15px);font-weight:600;color:' + (theme.header || theme.text) + ';line-height:1.4;font-family:' + fontStack + ';">' + esc(st.title) + '</div>';
    if (st.artist) h += '<div style="font-size:clamp(11px, 2vw, 12px);color:' + theme.tagText + ';margin-top:4px;font-family:' + fontStack + ';">' + esc(st.artist) + '</div>';
    h += '</div>';
  }
  h += '</div>';
  return h;
}

// 페이지 헤더. num!=null(다중 페이지)이면 번호 좌측+제목 우측, 아니면 중앙 정렬(단일 페이지=기존 모양).
function buildPageHeader(num, title, subtitle, theme, fontStack, collapse) {
  title = String(title || '').trim(); subtitle = String(subtitle || '').trim();
  if (num == null && !title && !subtitle) return '';
  if (num != null) {
    let h = '<div style="display:table;width:100%;margin-bottom:clamp(10px, 2vw, 14px);">';
    h += '<div style="display:table-cell;vertical-align:middle;width:1%;white-space:nowrap;padding-right:clamp(16px, 3vw, 24px);">';
    h += '<div style="font-size:' + pxToClamp(40) + ';font-weight:700;color:' + theme.header + ';line-height:1;font-family:' + fontStack + ';">' + num + '</div></div>';
    h += '<div style="display:table-cell;vertical-align:middle;">';
    h += '<div style="font-size:' + pxToClamp(22) + ';font-weight:700;color:' + theme.header + ';line-height:1.3;font-family:' + fontStack + ';">' + (title ? esc(title) : 'Page ' + num) + '</div>';
    if (subtitle) h += '<div style="font-size:' + pxToClamp(16) + ';color:' + theme.tagText + ';line-height:1.4;margin-top:2px;font-family:' + fontStack + ';">' + esc(subtitle) + '</div>';
    h += '</div>';
    // log-diary: 접기 켜진 페이지는 우측에 ⌵ 펼침 화살표
    if (collapse) h += '<div style="display:table-cell;vertical-align:middle;width:clamp(40px, 8vw, 60px);text-align:right;padding-left:clamp(10px, 2vw, 16px);"><span style="font-size:' + pxToClamp(22) + ';color:' + theme.tagText + ';">⌵</span></div>';
    h += '</div>';
    return h;
  }
  let h = '<div style="text-align:center;margin-bottom:clamp(15px, 3vw, 22px);">';
  if (title) h += '<div style="font-size:' + pxToClamp(22) + ';font-weight:700;line-height:1.3;color:' + theme.header + ';font-family:' + fontStack + ';">' + esc(title) + '</div>';
  if (subtitle) h += '<div style="font-size:' + pxToClamp(16) + ';color:' + theme.tagText + ';line-height:1.4;margin-top:4px;font-family:' + fontStack + ';">' + esc(subtitle) + '</div>';
  h += '<div style="height:1px;background:' + theme.divider + ';max-width:120px;margin:clamp(10px, 2vw, 14px) auto 0 auto;"><br></div></div>';
  return h;
}

function containerStyle(theme, fontStack) {
  return 'box-sizing:border-box;max-width:900px;margin:5px auto;border-radius:1rem;background-color:' + theme.bg + ';box-shadow:0 4px 16px rgba(0,0,0,0.1);padding:clamp(20px, 4vw, 30px) clamp(20px, 5vw, 40px);font-family:' + fontStack + ';font-size:clamp(13px, 2.3vw, 14.2px);color:' + theme.text + ';';
}

function renderLogDiary(input, settings, extraMappings) {
  const cfg = mergeDiarySettings(settings);
  const theme = DIARY_THEMES[cfg.theme] || DIARY_THEMES.basic;
  const fontStack = "'" + cfg.font + "', " + fontFallback(cfg.font);
  const bodySettings = themedBodySettings(settings, theme, cfg.quoteHighlight);
  const renderText = (text) => prepareBody(text, bodySettings, extraMappings);
  // 표지·페이지 이미지 비율: 미리보기는 CSS aspect-ratio로 띠 크롭, 복사 시 web이 같은 비율로 canvas 크롭(아카 보장).
  const ratioCss = RATIO_VALUE[cfg.imageRatio] ? 'aspect-ratio:' + RATIO_VALUE[cfg.imageRatio] + ';' : '';
  const imgBanner = (src, alt) => '<img src="' + src + '" alt="' + alt + '" class="fr-fic fr-dii" style="display:block;width:100%;max-width:100%;object-fit:cover;' + ratioCss + '">';

  // ── 인트로 본문 조각(표지 텍스트 제외): 프로필 + 소개글 + Story So Far + 사운드트랙 ──
  let pieces = '';
  pieces += buildProfiles(cfg.profiles, theme, fontStack);
  if (cfg.intro.trim()) pieces += '<div style="padding:clamp(10px, 2vw, 14px) clamp(30px, 5vw, 50px) 0;">' + renderText(cfg.intro) + '</div>';
  if (cfg.summary.trim()) {
    pieces += '<div style="padding:clamp(14px, 3vw, 18px) clamp(20px, 3vw, 25px) 5px;text-align:center;">' + sectionLabel('Story So Far', theme, fontStack, 'clamp(11px, 2vw, 13px)') + '</div>';
    pieces += '<div style="padding:6px clamp(30px, 5vw, 50px) 0;">' + renderText(cfg.summary) + '</div>';
  }
  pieces += buildSoundtrack(cfg.soundtrack, theme, fontStack);

  // ── 표지 + 인트로 컨테이너 ──
  // 굽기 모드(B): web이 표지를 한 장 이미지(페이드+제목+둥근모서리)로 구워 넣음 → 그 이미지만 출력(아카가 못 떼는 픽셀).
  // 오버레이 모드: 이미지 위 그라데이션(실험적). 안전 모드: 이미지 아래 어두운 글씨.
  let introContainer = '';
  if (cfg.coverBake && cfg.bakedCover) {
    // 표지를 카드 맨 위에 여백 없이 풀블리드. 위 모서리만 카드와 같은 반지름(1rem)으로 둥글리고, 아래는 사각으로 본문에 이어짐.
    //   (아카가 overflow를 떼서 카드가 이미지를 못 자르므로, 아카가 살려주는 img border-radius로 직접 둥글림.)
    // 본문 조각(프로필/소개글)이 있으면 같은 카드 안에 이어 붙임 → 표지 아래가 본문과 연결(아래 둥글기 불필요).
    // lp-baked = 이미 합성된 JPEG → 복사 시 재인코딩 건너뜀.
    const coverRad = pieces ? '1rem 1rem 0 0' : '1rem';
    let inner = '<img src="' + cfg.bakedCover + '" alt="cover" class="fr-fic fr-dii lp-baked" style="display:block;width:100%;max-width:100%;border-radius:' + coverRad + ';' + ratioCss + '">';
    if (pieces) inner += '<div style="padding:clamp(20px, 4vw, 30px) 0;">' + pieces + '</div>';
    introContainer += '<div style="box-sizing:border-box;max-width:900px;margin:5px auto;border-radius:1rem;background-color:' + theme.bg + ';box-shadow:0 4px 16px rgba(0,0,0,0.1);font-family:' + fontStack + ';color:' + theme.text + ';">' + inner + '</div>';
  } else if (cfg.coverImage && cfg.coverOverlay) {
    const txt = buildCoverTextOverlay(cfg, fontStack);
    const grad = txt ? '<div style="position:absolute;left:0;right:0;bottom:0;padding:clamp(15px, 3vw, 22px) clamp(30px, 5vw, 40px);background:linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0) 75%);">' + txt + '</div>' : '';
    introContainer += '<div style="position:relative;overflow:hidden;border-radius:1rem;max-width:900px;margin:5px auto;box-shadow:0 4px 16px rgba(0,0,0,0.1);font-family:' + fontStack + ';">' + imgBanner(cfg.coverImage, 'cover') + grad + '</div>';
    if (pieces) introContainer += '<div style="box-sizing:border-box;max-width:900px;margin:5px auto;border-radius:1rem;background-color:' + theme.bg + ';box-shadow:0 4px 16px rgba(0,0,0,0.1);padding:clamp(20px, 4vw, 30px) 0;font-family:' + fontStack + ';color:' + theme.text + ';">' + pieces + '</div>';
  } else {
    let inner = '';
    if (cfg.coverImage) inner += imgBanner(cfg.coverImage, 'cover');
    const pad = buildCoverText(cfg, theme, fontStack) + pieces;
    if (pad) inner += '<div style="padding:clamp(20px, 4vw, 30px) 0;">' + pad + '</div>';
    if (inner) introContainer = '<div style="box-sizing:border-box;max-width:900px;margin:5px auto;border-radius:1rem;overflow:hidden;background-color:' + theme.bg + ';box-shadow:0 4px 16px rgba(0,0,0,0.1);font-family:' + fontStack + ';color:' + theme.text + ';">' + inner + '</div>';
  }

  // ── 본문: 섹션/페이지 항목 리스트 ── cfg.pages(블록 에디터) 우선, 없으면 입력의 [페이지] 마커 분할(레거시=전부 page).
  // 섹션(kind 'section')=챕터 구분 띠(이미지+섹션제목/부제, web이 bakedSection으로 구워 넣음)로, '뒤따르는 페이지들'을 한 카드로 묶는다.
  // 페이지(kind 'page')=#번호+제목/부제 텍스트 헤더 + 내용(+접기). 섹션을 만나면 페이지 번호 1부터 리셋(원본 Log Diary 구조).
  let items;
  if (Array.isArray(cfg.pages) && cfg.pages.length) {
    items = cfg.pages.map((p) => p.itemType === 'section'
      ? { kind: 'section', title: String(p.title || ''), subtitle: String(p.subtitle || ''), banner: typeof p.bakedSection === 'string' ? p.bakedSection : '' }
      : { kind: 'page', title: String(p.title || ''), subtitle: String(p.subtitle || ''), content: renderText(String(p.content == null ? '' : p.content)) });
  } else {
    items = splitPages(input, cfg).map((pg) => ({ kind: 'page', title: String(pg.title || ''), subtitle: String(pg.subtitle || ''), content: renderText(pg.lines.join('\n')) }));
  }
  // 빈 항목 제거: 페이지=내용·제목·부제 다 비면 / 섹션=띠·제목·부제 다 비면.
  items = items.filter((it) => it.kind === 'section'
    ? (it.banner || it.title.trim() || it.subtitle.trim())
    : (it.content.trim() || it.title.trim() || it.subtitle.trim()));
  const multi = items.filter((it) => it.kind === 'page').length > 1;

  const PAD = 'padding:clamp(20px, 4vw, 30px) clamp(20px, 5vw, 40px);';
  // 한 장 카드(섹션 그룹/단독 페이지 공통). overflow:hidden=둥근 모서리(아카는 떼지만 img border-radius로 보완).
  const flushStyle = 'box-sizing:border-box;max-width:900px;margin:5px auto;border-radius:1rem;overflow:hidden;background-color:' + theme.bg + ';box-shadow:0 4px 16px rgba(0,0,0,0.1);font-family:' + fontStack + ';font-size:clamp(13px, 2.3vw, 14.2px);color:' + theme.text + ';';
  const summaryStyle = 'cursor:pointer;list-style:none;outline:none;color:inherit;';
  // 섹션 띠: 이미지 있으면 구운 띠(위 모서리 둥글), 없으면 텍스트 섹션 라벨(이미지 없는 챕터 구분).
  const sectionBand = (it) => {
    if (it.banner) return '<img src="' + it.banner + '" alt="" class="fr-fic fr-dii lp-baked" style="display:block;width:100%;max-width:100%;border-radius:1rem 1rem 0 0;">';
    if (!it.title.trim() && !it.subtitle.trim()) return '';
    let h = '<div style="text-align:center;padding:clamp(18px, 3.5vw, 26px) clamp(20px, 5vw, 40px) 0;">';
    if (it.subtitle.trim()) h += '<div style="font-size:' + pxToClamp(13) + ';letter-spacing:clamp(1.5px, 0.3vw, 2px);text-transform:uppercase;color:' + theme.tagText + ';margin-bottom:clamp(6px, 1.2vw, 8px);font-family:' + fontStack + ';">' + esc(it.subtitle) + '</div>';
    if (it.title.trim()) h += '<div style="font-size:' + pxToClamp(22) + ';font-weight:700;color:' + theme.header + ';font-family:' + fontStack + ';">' + esc(it.title) + '</div>';
    return h + '</div>';
  };
  // 페이지 블록(헤더+내용). 접기면 <details>, 아니면 div. inGroup이면 섹션 카드 안(margin:0), 아니면 단독 카드.
  const pageBlock = (it, num, inGroup) => {
    const header = buildPageHeader(multi ? num : null, it.title, it.subtitle, theme, fontStack, cfg.collapse);
    const fallback = '<div style="font-weight:700;color:' + theme.header + ';font-family:' + fontStack + ';">' + (multi ? 'Page ' + num : '내용 보기') + '</div>';
    if (cfg.collapse) {
      const summary = '<div style="' + PAD + '">' + (header || fallback) + '</div>';
      const open = inGroup ? '<details style="margin:0;">' : '<details style="' + flushStyle + '">';
      return open + '<summary style="' + summaryStyle + '">' + summary + '</summary><div style="' + PAD + 'padding-top:0;">' + it.content + '</div></details>';
    }
    if (inGroup) return '<div style="' + PAD + '">' + header + it.content + '</div>';
    return '<div style="' + containerStyle(theme, fontStack) + '">' + header + it.content + '</div>';
  };

  let bodyHtml = '';
  let group = null;  // 현재 섹션 그룹 { band, inner }
  let num = 0;
  const flush = () => { if (group) { bodyHtml += '<div style="' + flushStyle + '">' + group.band + group.inner + '</div>'; group = null; } };
  items.forEach((it) => {
    if (it.kind === 'section') {
      flush();
      num = 0;
      group = { band: sectionBand(it), inner: '' };
    } else {
      num++;
      if (group) {
        group.inner += pageBlock(it, num, true);
      } else {
        bodyHtml += pageBlock(it, num, false);
      }
    }
  });
  flush();

  // ── 코멘트 컨테이너(선택) ──
  let commentContainer = '';
  if (cfg.comment.text.trim()) {
    let c = '<div style="padding:0 clamp(30px, 5vw, 50px) clamp(10px, 2vw, 15px);text-align:center;">' + sectionLabel('Comment', theme, fontStack, 'clamp(10px, 1.8vw, 12px)') + '</div>';
    c += '<div style="padding:0 clamp(30px, 5vw, 50px);color:' + theme.text + ';">' + renderText(cfg.comment.text) + '</div>';
    const by = cfg.comment.nickname.trim() ? 'BY ' + esc(cfg.comment.nickname) + ' • ' + todayStr() : todayStr();
    c += '<div style="text-align:right;padding:clamp(10px, 2vw, 15px) clamp(30px, 5vw, 50px) 0;font-size:clamp(9px, 1.5vw, 10px);color:' + theme.tagText + ';font-family:' + fontStack + ';">' + by + '</div>';
    commentContainer = '<div style="box-sizing:border-box;max-width:900px;margin:5px auto;border-radius:1rem;background-color:' + theme.bg + ';box-shadow:0 4px 16px rgba(0,0,0,0.1);padding:clamp(20px, 4vw, 30px) 0;font-family:' + fontStack + ';font-size:clamp(13px, 2.3vw, 14.2px);">' + c + '</div>';
  }

  if (!introContainer && !bodyHtml && !commentContainer) return ''; // 표지·본문·코멘트 다 비면 빈 출력
  // 아카 대표 썸네일 고정(선택): 글 맨 위 숨김 0x0 <img>. 아카는 첫 이미지를 대표 썸네일로 잡으므로, 표지(굽기 우선)/첫 섹션 띠를 지정.
  let thumb = '';
  if (cfg.forceThumbnail) {
    const baked = cfg.coverBake && cfg.bakedCover ? cfg.bakedCover : '';
    let src = baked || cfg.coverImage || '', bakedSrc = !!baked;
    if (!src) { const fs = items.find((it) => it.kind === 'section' && it.banner); if (fs) { src = fs.banner; bakedSrc = true; } }
    if (src) thumb = '<img src="' + src + '" alt="" class="fr-fic fr-dii' + (bakedSrc ? ' lp-baked' : '') + '" style="width:0px;height:0px;">';
  }
  return '<div style="font-family:' + fontStack + ';max-width:900px;margin:1rem auto;">' + thumb + introContainer + bodyHtml + commentContainer + '</div>';
}

module.exports = { renderLogDiary, mergeDiarySettings };
