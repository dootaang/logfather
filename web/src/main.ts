// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
﻿// web/src/main.ts — 로그 제조기 Pro 2 웹 셸
// core(엔진)를 그대로 가져와 입력→라이브 미리보기→리치 복사 + 카드/모듈 드롭→에셋 자동매핑.
// 설정 패널은 core가 읽는 "모든 수동 노브"를 섹션별 접이식 + 조건부 노출로 제공(이행 불변식).
// @ts-nocheck  (core는 plain JS, 타입 없음)
import { convertText } from '../../core/convert/convertText.js';
import { parseCard } from '../../core/card/parseCard.js';
import { extractSourceInfo } from '../../core/card/sourceRegex.js';   // 편집기→관리실 자동 보관(B): 내부 이름·표시 규칙
import { saveCardCss, deleteCardCss } from './cardCss.js';   // ★카드 CSS(관리실 3단계 "리스 스타일") 이 기기 보관
import { parseCardAssets } from '../../core/card/cardAssets.js';      // 〃 에셋 수
import { isDesktop } from './desktopSync.js';                          // 〃 데스크탑에서만 보관(클라우드 X)
import { assetDataUrl, applyTagScheme } from '../../core/card/assets.js';
import { confirmModal } from './confirmModal.js';  // 공용 DOM 확인 모달(네이티브 confirm 대체 — Electron 포커스 버그 회피)
import { initTheme, SKIN_KEY, applySkin } from './appSettings.js';  // 앱-레벨 설정(테마·스킨) 공용 모듈 — 편집기는 적용만(드롭다운·빌더는 서재)
import { decodeRisumAsset } from '../../core/card/risum.js';
import { decodeCharxAsset } from '../../core/card/charx.js';
import { renderTagSpan } from '../../core/convert/renderTags.js';
import { getImagePatterns, extractTagFromMatch } from '../../core/convert/processImageTags.js';
import { extractRegexScripts, expandCardRegex } from '../../core/convert/cardRegex.js';
import { extractCardCss, evalRisuCss, sanitizeCss } from '../../core/convert/cardStyles.js';
import { TEMPLATE_DEFS, TEMPLATE_ORDER } from '../../core/convert/templates/registry.js';
import { DIARY_THEME_LIST, DIARY_FONT_LIST, DIARY_IMAGE_RATIOS } from '../../core/convert/templates/logDiaryThemes.js';
import { buildBundle, parseBundle, defaultSettings } from '../../core/preset/bundle.js';
import { classifyLegacyFiles, applyLegacy } from '../../core/preset/legacy.js';   // Pro1 가져오기(편집기 기본카드) — 분류/적용은 코어 공유
// (전체 백업/Pro1 레거시 import는 settingsMenu.ts[서재]로 이전 — 편집기 main.ts엔 없음.)
import { generatePalette, deriveDarkBg } from '../../core/color/palette.js';
import { idbSaveCard, idbLoadCard, idbClearCard, idbSaveWorkCard, idbLoadWorkCard, logsAdd, logsAll, logsDelete, OPEN_LOG_KEY, kvLoad, kvSave, PRESET_LIB_KEY, AUTOSAVE_KEY, READ_KEY, RDR_KEY, markSessionSynced, metaSet, metaGet, metaAll, newWorkKey, dedupeLogsInStore, clearLibraryLocal, LocalBackend, archiveSaveSource } from './store.js';
// auth.js / sync.js 는 무거운 Firebase SDK를 끌어온다 → 정적 import 대신 첫 렌더 뒤 동적 import(초기 로딩 경량화).
import { mountAccountUI } from './accountUI.js';   // 계정 UI(가벼움, DOM만) — 에디터·서재 공용
import { icon } from './icons.js';   // 통일 라인 아이콘(currentColor) — 이모지 대체
import { translateAvailable, translateEditors, openTranslateSettings, ensureTranslateReady } from './translate.js';   // 로그 번역(웹·데스크탑)
import { cleanEditors } from './cleanup.js';   // 가져온 로그 군더더기 정리(1차 결정론, 키 불필요)
import { mountUpdateBanner } from './updateBanner.js';   // 자동 업데이트 배너(데스크탑 전용)
import { sanitizePapaHtml, renderPapaBlocks, PAPA_SEP } from './readerView.js';   // 파파모드 살균·블록별 Shadow DOM 렌더(미리보기=리더 동일 함수)
import { fontsSupported, refreshFonts, getFontFaceCss, getFontList, addFontFiles, removeFont, getUiFont, applyUiFont } from './fonts.js';   // 커스텀 폰트(데스크탑)

// ---------- 상태 ----------
const settings: any = {
  box: { showInnerBox: false, outerBoxColor: '#ffffff', innerBoxColor: '#f8f9fa', shadowIntensity: 8, useBoxBorder: false, boxBorderColor: '#e2e8f0', boxBorderThickness: 2, maxWidth: 600, userColor: '#eef2ff', charColor: '#fdf2f8' },
  profile: { showProfile: true, showProfileImage: true, showBotName: true, showTags: true, showDivider: true, botName: '봇 이름', botNameColor: '#4a4a4a', frameStyle: '동그라미', width: 96, height: 96, imageUrl: '', showProfileBorder: true, profileBorderColor: '#e2e8f0', showProfileShadow: true },
  divider: { style: '그라데이션', thickness: 1, outerColor: '#e2e8f0', innerColor: '#ffffff', solidColor: '#b8bacf' },
  text: { useTextIndent: true, textIndent: 20, useTextSize: true, textSize: 14, dialogColor: '#2d3748', dialogBold: true, dialogNewline: true, innerThoughtsColor: '#718096', innerThoughtsBold: false, narrationColor: '#4a5568', usePadding: true, removeAsterisk: true, convertEllipsis: true, smartFormat: true, risuMarkers: true, asteriskEmphasis: false },
  tags: [
    { text: '모델', color: '#edf2f7', textColor: '#2d3748', style: '기본', borderRadius: 20, fontSize: 0.85, padding: { top: 0.2, right: 0.8, bottom: 0.2, left: 0.8 } },
    { text: '프롬프트', color: '#e2e8f0', textColor: '#2d3748', style: '기본', borderRadius: 20, fontSize: 0.85, padding: { top: 0.2, right: 0.8, bottom: 0.2, left: 0.8 } },
  ],
  assetImage: { imageSize: 80, imageMargin: 10, useImageBorder: false, imageBorderColor: '#000000', useImageShadow: true },
  imageMappings: [] as Array<{ tag: string; url: string }>,  // 수동 이미지 매핑(tag→url) — 엔진 collectUrlMappings가 소비
  wordReplace: [] as Array<{ from: string; to: string }>,    // 단어 치환(전역) — 엔진이 split/join으로 소비
  cardRegex: [] as any[],   // 드롭한 카드/모듈의 표시 regex(커스텀 태그 문법) — expandCardRegex가 소비
  cardCss: '',              // 드롭한 카드/모듈의 CSS(조건부 평가됨) — flattenCss가 출력에 인라인 + 미리보기 <style>
  template: 'card',         // 출력 디자인. 기본 카드 또는 고급 CSS 커스텀.
  templateSettings: {},     // 템플릿별 전용 설정 저장소(템플릿을 바꿔도 값 보존)
  userCardCss: '',          // 선택 템플릿 결과 HTML에 적용되는 고급 CSS 데코(복사 시 인라인화)
  darkMode: false, cardTextColor: '',  // cardTextColor='' → darkMode 폴백(명시 토큰); 수동지정 시 hex
};
// 섹션 셀렉터 단축(객체 참조 안정 — 필드만 변경)
const B = settings.box, P = settings.profile, D = settings.divider, T = settings.text, AI = settings.assetImage;
// 카드 글자색: 기본은 자동(darkMode 폴백). 수동지정 토글 시 hex 사용.
let cardTextManual = false;
let lastCardText = '#000000';
// 드롭한 카드 아이콘 data:URL 백업 — 이미지 URL 입력란을 비우면 이 값으로 복원(영구 손실 방지).
let cardIconUrl = '';
// 드롭한 카드의 표시 regex / CSS 백업 + 토글 상태(카드 로드 시 자동 on).
let loadedCardRegex: any[] = [];
let cardRegexOn = true;
let loadedCardCss = '';
let cardCssOn = true;
// 빠른 테마 입력 2색(배경/포인트). 패널에서만 쓰는 로컬 상태(현재 settings에서 초기화).
let themeBg = settings.box.innerBoxColor || '#f8f9fa';
let themeAccent = (settings.tags[0] && settings.tags[0].color) || '#8a5a44';

let parsed: any = null;          // 드롭한 카드/모듈
const urlCache: Record<string, string> = {};
let lastCard = '';
let trayAssets: any[] = [];

// ---------- 디자인별 완전 독립 설정 ----------
// 출력 디자인(card/log-diary/custom-css)마다 자기만의 "룩 설정" 한 벌을 가진다.
// 디자인 전환 시: 현재 룩을 designStore[old]에 저장 → designStore[new]를 라이브에 복원.
// 공용(디자인 무관, 절대 swap 안 함): 단어치환(wordReplace), 불러온 카드 콘텐츠(에셋/regex/css),
//   프로필의 봇이름·이미지(=카드에서 자동 채운 콘텐츠).
const DESIGN_IDS = ['card', 'log-diary', 'custom-css'];
// profile 중 디자인이 소유하는 "룩" 키 (봇이름·이미지 제외 → 공용 유지).
const PROFILE_LOOK = ['showProfile', 'showProfileImage', 'showBotName', 'showTags', 'showDivider', 'botNameColor', 'frameStyle', 'width', 'height', 'showProfileBorder', 'profileBorderColor', 'showProfileShadow'];
// 웹소설형 "룩"으로 보는 키 = 강조/타이포 노브만(본문 messages/blocks/useBlocks는 콘텐츠라 제외 → 프리셋이 내용을 안 덮음).
const WEBNOVEL_LOOK = ['dialogEmphasis', 'innerItalic', 'dialogNewline', 'asteriskEmphasis', 'textIndent', 'paraGap'];
const clone = (x: any) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const pick = (obj: any, keys: string[]) => { const o: any = {}; for (const k of keys) o[k] = clone((obj || {})[k]); return o; };
const designStore: Record<string, any> = {};

// 라이브 설정을 단일 객체 뷰로(lookFrom이 src로 읽기 좋게).
function liveView() {
  return { box: B, profile: P, divider: D, text: T, assetImage: AI, tags: settings.tags, templateSettings: settings.templateSettings, userCardCss: settings.userCardCss, darkMode: settings.darkMode, cardTextColor: settings.cardTextColor };
}
// src(라이브 뷰 또는 살균된 settings)에서 design이 소유하는 룩만 추려 스냅샷.
function lookFrom(design: string, src: any): any {
  const snap: any = { darkMode: src.darkMode, cardTextColor: src.cardTextColor };
  if (design === 'log-diary') {
    snap.text = clone(src.text); snap.assetImage = clone(src.assetImage);
    snap.diary = clone((src.templateSettings && src.templateSettings['log-diary']) || {});
  } else if (design === 'chat') {
    snap.text = clone(src.text); snap.assetImage = clone(src.assetImage);
    snap.chat = clone((src.templateSettings && src.templateSettings.chat) || {});
  } else if (design === 'webnovel') {
    snap.text = clone(src.text); snap.assetImage = clone(src.assetImage);
    snap.webnovel = pick((src.templateSettings && src.templateSettings.webnovel) || {}, WEBNOVEL_LOOK);  // 강조 노브만(본문 제외)
  } else { // card / custom-css
    snap.box = clone(src.box); snap.profile = pick(src.profile, PROFILE_LOOK); snap.divider = clone(src.divider);
    snap.text = clone(src.text); snap.tags = clone(src.tags); snap.assetImage = clone(src.assetImage);
    if (design === 'custom-css') { snap.userCardCss = src.userCardCss || ''; snap.cssBase = src.cssBase || ''; }
  }
  return snap;
}
function captureLook(design: string) { return lookFrom(design, liveView()); }
// 스냅샷을 라이브에 제자리 반영(B/P/D/T/AI 참조 유지; 봇이름·이미지는 안 건드림).
function restoreLook(design: string, snap: any) {
  if (!snap) return;
  if (typeof snap.darkMode === 'boolean') settings.darkMode = snap.darkMode;
  if (snap.cardTextColor != null) { settings.cardTextColor = snap.cardTextColor; cardTextManual = !!snap.cardTextColor; if (snap.cardTextColor) lastCardText = snap.cardTextColor; }
  if (design === 'log-diary') {
    if (snap.text) Object.assign(T, snap.text);
    if (snap.assetImage) Object.assign(AI, snap.assetImage);
    settings.templateSettings = settings.templateSettings || {};
    if (snap.diary) settings.templateSettings['log-diary'] = clone(snap.diary);
  } else if (design === 'chat') {
    if (snap.text) Object.assign(T, snap.text);
    if (snap.assetImage) Object.assign(AI, snap.assetImage);
    settings.templateSettings = settings.templateSettings || {};
    if (snap.chat) settings.templateSettings.chat = clone(snap.chat);
  } else if (design === 'webnovel') {
    if (snap.text) Object.assign(T, snap.text);
    if (snap.assetImage) Object.assign(AI, snap.assetImage);
    settings.templateSettings = settings.templateSettings || {};
    // 강조 노브만 덮어쓰고 본문(messages/blocks/useBlocks)은 보존 → 프리셋이 글 내용을 안 지운다.
    const cur = settings.templateSettings.webnovel || {};
    if (snap.webnovel) for (const k of WEBNOVEL_LOOK) if (snap.webnovel[k] !== undefined) cur[k] = clone(snap.webnovel[k]);
    settings.templateSettings.webnovel = cur;
  } else {
    if (snap.box) Object.assign(B, snap.box);
    if (snap.profile) Object.assign(P, snap.profile); // 룩 키만 → botName/imageUrl 보존
    if (snap.divider) Object.assign(D, snap.divider);
    if (snap.text) Object.assign(T, snap.text);
    if (snap.assetImage) Object.assign(AI, snap.assetImage);
    if (Array.isArray(snap.tags)) settings.tags = clone(snap.tags);
    if (design === 'custom-css') { settings.userCardCss = typeof snap.userCardCss === 'string' ? snap.userCardCss : (settings.userCardCss || ''); settings.cssBase = typeof snap.cssBase === 'string' ? snap.cssBase : (settings.cssBase || ''); }
  }
}
// ── 디자인 전환 시 "내용 이어받기" ── 현재 디자인의 글쓰기 내용을 구조화 항목으로 뽑아 새 디자인 형식으로 변환.
//   카드 블록 ↔ 다이어리 페이지 ↔ 채팅 메시지 ↔ 단일 입력(역할 보존). 새 디자인이 비었을 때만(기존 작업 보호).
function designItems(design: string): any[] {
  const ts = settings.templateSettings || {};
  if (design === 'card') {
    const c = ts.card || {};
    if (Array.isArray(c.blocks) && c.blocks.length) return c.blocks.map((b: any) => ({ role: b.role, content: b.content || '', title: b.title || '', subtitle: b.subtitle || '' }));
    return inputEl.value.trim() ? [{ content: inputEl.value }] : [];
  }
  if (design === 'log-diary') {
    const c = ts['log-diary'] || {};
    return (Array.isArray(c.pages) ? c.pages : []).filter((p: any) => p && p.itemType !== 'section').map((p: any) => ({ content: p.content || '', title: p.title || '', subtitle: p.subtitle || '' }));
  }
  if (design === 'chat') {
    const c = ts.chat || {};
    return (Array.isArray(c.messages) ? c.messages : []).map((m: any) => ({ role: m.role, content: m.text || '' }));
  }
  if (design === 'webnovel') {
    const c = ts.webnovel || {};
    if (c.useBlocks && Array.isArray(c.blocks) && c.blocks.length) return c.blocks.map((b: any) => ({ role: b.role, content: b.content || '', title: b.title || '' }));   // role 보존(전환 시 유저/봇 분리 복원)
    return inputEl.value.trim() ? [{ content: inputEl.value }] : [];
  }
  return inputEl.value.trim() ? [{ content: inputEl.value }] : [];   // custom-css 등 단일 입력
}
function designHasContent(design: string): boolean {
  return designItems(design).some((i: any) => String(i.content || '').trim() || String(i.title || '').trim());
}
function seedDesignContent(design: string, items: any[]) {
  if (!items.length) return;
  if (design === 'card') {
    const multi = items.length > 1 || items.some((i) => i.role || String(i.title || '').trim() || String(i.subtitle || '').trim());
    const c = templateConfig('card');
    if (multi) c.blocks = items.map((i) => ({ role: i.role, content: i.content || '', title: i.title || '', subtitle: i.subtitle || '' }));
    else { c.blocks = []; inputEl.value = items.map((i) => i.content || '').join('\n\n'); }
  } else if (design === 'log-diary') {
    const c = templateConfig('log-diary');
    c.pages = items.map((i) => ({ itemType: 'page', title: i.title || '', subtitle: i.subtitle || '', content: i.content || '' }));
  } else if (design === 'chat') {
    const c = templateConfig('chat');
    c.messages = items.map((i) => ({ role: i.role || 'char', text: i.content || '' }));
  } else if (design === 'webnovel') {
    const c = templateConfig('webnovel');
    const multi = items.length > 1 || items.some((i) => String(i.title || '').trim());
    if (multi) { c.useBlocks = true; c.sceneBreak = true; c.blocks = items.map((i) => ({ role: i.role, title: i.title || '', content: i.content || '' })); }  // 자동 분할(소설) = 장면 기호 기본 켜짐 + role 보존
    else { c.useBlocks = false; c.blocks = []; inputEl.value = items.map((i) => i.content || '').join('\n\n'); }
  } else {
    inputEl.value = items.map((i) => i.content || '').join('\n\n');
  }
}
// 출력 디자인 전환(독립 설정 swap). 첫 방문 디자인은 현재 룩을 상속(이후 독립).
function switchDesign(next: string) {
  const old = settings.template || 'card';
  if (next !== old) {
    const carry = designItems(old);                  // 전환 전 옛 디자인 내용 캡처
    designStore[old] = captureLook(old);
    if (!designStore[next]) designStore[next] = captureLook(next); // 첫 방문 = 현재 룩 상속
    restoreLook(next, designStore[next]);
    settings.template = next;
    if (carry.length && !designHasContent(next)) seedDesignContent(next, carry); // 새 디자인이 비었으면 내용 이어받기
  }
  syncOutputDesignSelect(); updateInputMode(); buildControls(); scheduleRender();
  setStatus(`${TEMPLATE_DEFS[next]?.label || '기본 카드'} 디자인 선택됨`);
}
// 프리셋/레거시 적용 = 그 디자인을 활성화하고 살균된 settings에서 소유 룩만 라이브에 반영.
function applyDesignPreset(design: string, s: any, ui: any) {
  const snap = lookFrom(design, s);
  designStore[design] = snap;
  settings.template = design;
  restoreLook(design, snap);
  if (ui) {
    cardRegexOn = !!ui.cardRegexOn; cardCssOn = !!ui.cardCssOn;
    settings.cardRegex = cardRegexOn ? loadedCardRegex : [];
    settings.cardCss = cardCssOn ? loadedCardCss : '';
  }
  syncOutputDesignSelect(); updateInputMode(); buildControls(); scheduleRender();
}

const $ = (id: string) => document.getElementById(id)!;
const inputEl = $('input') as HTMLTextAreaElement;
const previewEl = $('preview') as HTMLIFrameElement;
const papaPreviewEl = $('papa-preview') as HTMLElement;   // 파파 전용 미리보기 컨테이너(블록별 Shadow DOM)
const statusEl = $('status');

// ── 편집기 모드(URL 파라미터로 분기 — index.html 한 페이지로 통합) ─────────────────
//   ?log=<id>   = 기존 보관 로그 수정(제자리 덮어쓰기)
//   ?work=<키>  = 그 작품의 새 화(하드 바인딩 → 보관 시 모달 없이 그 작품 맨끝)
//   (무param)   = 빠른 제작(미바인딩 → 보관 시 목적지 모달, 초안 자동저장)
// BOUND(log/work)면 세션복원 스킵 + 자동저장 격리 = edit.html이 하던 상태충돌 방지를 그대로 분기에 둠.
const _ep = (() => { try { return new URLSearchParams(location.search); } catch (_) { return new URLSearchParams(); } })();
const MODE_LOG = (_ep.get('log') || '').trim();
const MODE_WORK = (_ep.get('work') || '').trim();
const BOUND = !!(MODE_LOG || MODE_WORK);
// 하드 바인딩 상태(새 화가 들어갈 작품) — 미바인딩이면 빈 값. 칩으로 바꿀 수 있음.
let boundWork = MODE_WORK;                                  // 작품 키('' = 미바인딩)
let boundNewName = '';                                      // boundWork가 "새 작품"이면 표시이름(저장 때 등록)
let boundOrder: number | null = null;                       // 새 화 위치(null = 맨끝)
let boundSiblings: { rec: any; order: number }[] = [];      // 위치 끼워넣기로 밀릴 형제 화(저장 때 적용)
let moveSiblings: { rec: any; order: number }[] = [];       // 기존 로그를 다른 작품으로 옮길 때 밀릴 형제(저장 때 적용)
// 에셋 트레이 썸네일 클릭/삽입의 대상 = 마지막으로 포커스한 편집칸(기본 입력란, 다이어리면 해당 페이지 칸).
let activeEditor: HTMLTextAreaElement = inputEl;

// ── 블록 본문 "크게보기" 공용 모달 ──────────────────────────────
// 좁은 .pb-content를 큰 모달로 편집. 모달 입력은 원본 textarea로 흘려보내(input 디스패치)
// 각 에디터의 기존 oninput(디바운스 렌더+cfg 갱신)을 그대로 재사용한다.
let bigOverlay: HTMLElement | null = null, bigTa: HTMLTextAreaElement | null = null;
let bigTitleEl: HTMLElement | null = null, bigSource: HTMLTextAreaElement | null = null;
let bigTrayHostEl: HTMLElement | null = null;
// 크게보기 모달의 에셋 트레이 = 편집기의 그 트레이(#tray)를 그대로 옮겨 씀(검색·그리드·호버 확대 동일).
//   삽입 대상은 모달 큰 입력칸(bigTa) — 모달 열 때 activeEditor=bigTa로 두면 트레이 클릭이 거기로 들어간다.
function ensureBigEditor() {
  if (bigOverlay) return;
  const ov = document.createElement('div'); ov.className = 'big-editor-overlay'; ov.hidden = true;
  const box = document.createElement('div'); box.className = 'big-editor';
  const head = document.createElement('div'); head.className = 'big-editor-head';
  const title = document.createElement('span'); title.className = 'big-editor-title';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'big-editor-close'; close.textContent = '✕ 닫기';
  head.append(title, close);
  const ta = document.createElement('textarea'); ta.className = 'big-editor-ta'; ta.placeholder = '여기서 크게 작성하세요…';
  const body = document.createElement('div'); body.className = 'big-editor-body';
  const trayHost = document.createElement('div'); trayHost.className = 'big-editor-tray-host'; trayHost.hidden = true;
  body.append(ta, trayHost);
  box.append(head, buildFormatToolbar(() => ta), body); ov.append(box); document.body.appendChild(ov);
  const closeFn = () => {
    ov.hidden = true; trayHost.hidden = true;
    relocateTray();   // 옮겨왔던 편집기 트레이(#tray)를 설정 패널로 되돌림
    const s = bigSource; bigSource = null; activeEditor = s || inputEl; if (s) s.focus();
  };
  ta.addEventListener('input', () => { if (bigSource) { bigSource.value = ta.value; bigSource.dispatchEvent(new Event('input')); } });
  ta.addEventListener('focus', () => { activeEditor = ta; });   // 트레이 삽입 대상 = 큰 입력칸
  close.onclick = closeFn;
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeFn(); }); // 바깥(오버레이) 클릭만
  document.addEventListener('keydown', (e) => { if (!ov.hidden && e.key === 'Escape') closeFn(); });
  bigOverlay = ov; bigTa = ta; bigTitleEl = title; bigTrayHostEl = trayHost;
}
function openBigEditor(source: HTMLTextAreaElement, label: string) {
  ensureBigEditor();
  bigSource = source;
  if (bigTitleEl) bigTitleEl.textContent = label || '크게 보기';
  bigTa!.value = source.value; bigOverlay!.hidden = false;
  // 편집기 트레이(#tray)를 모달 안으로 이동(드롭한 에셋이 있을 때만). 삽입 대상=bigTa.
  const tray = document.getElementById('tray');
  if (tray && trayAssets.length) { bigTrayHostEl!.hidden = false; bigTrayHostEl!.appendChild(tray); tray.hidden = false; }
  else if (bigTrayHostEl) bigTrayHostEl.hidden = true;
  activeEditor = bigTa!;                                   // 트레이 썸네일 클릭 → 이 큰 입력칸에 삽입
  bigTa!.focus(); bigTa!.setSelectionRange(bigTa!.value.length, bigTa!.value.length);
}
// 헤더에 꽂을 ⤢ 버튼 생성(라벨은 동적 — 블록 이름 함수).
function makeEnlargeBtn(ta: HTMLTextAreaElement, getLabel: () => string): HTMLButtonElement {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'pb-btn pb-big';
  b.textContent = '⤢'; b.title = '크게 보기';
  b.onclick = () => openBigEditor(ta, getLabel());
  return b;
}

function activeTarget(): HTMLTextAreaElement {
  // 포커스했던 페이지 칸이 살아있으면 거기. 아니면 다이어리는 첫 페이지 칸, 그 외엔 기본 입력란.
  if (activeEditor && activeEditor !== inputEl && document.contains(activeEditor)) return activeEditor;
  if (settings.template === 'log-diary') {
    const first = document.querySelector('#diary-pages .pb-content') as HTMLTextAreaElement | null;
    if (first) return first;
  }
  if (settings.template === 'chat') {
    const first = document.querySelector('#chat-messages .pb-content') as HTMLTextAreaElement | null;
    if (first) return first;
  }
  return inputEl;
}
const esc = (s: any) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

// ── 입력 서식 툴바(B·I·U·하이라이트) ─────────────────────────────
// 선택 영역을 평문 마커로 감싼다(아카 호환 파이프라인 유지 — WYSIWYG 아님). 입력 후 input 디스패치로
//   기존 oninput(렌더+저장)을 그대로 재사용. **굵게**·*기울임* 은 '별표 강조' 옵션, __밑줄__·==하이라이트== 는 항상 변환.
function wrapSel(ta: HTMLTextAreaElement, mark: string) {
  const s = ta.selectionStart, e = ta.selectionEnd, val = ta.value, sel = val.slice(s, e);
  const before = val.slice(Math.max(0, s - mark.length), s), after = val.slice(e, e + mark.length);
  if (sel && before === mark && after === mark) {            // 이미 감싸짐 → 토글 해제
    ta.value = val.slice(0, s - mark.length) + sel + val.slice(e + mark.length);
    ta.setSelectionRange(s - mark.length, e - mark.length);
  } else {                                                    // 감싸기(선택 없으면 커서를 마커 사이로)
    ta.value = val.slice(0, s) + mark + sel + mark + val.slice(e);
    if (sel) ta.setSelectionRange(s + mark.length, e + mark.length);
    else ta.setSelectionRange(s + mark.length, s + mark.length);
  }
  ta.focus();
  ta.dispatchEvent(new Event('input', { bubbles: true }));   // 기존 oninput 재사용(렌더+저장)
}
const tbSep = (): HTMLElement => { const s = document.createElement('span'); s.className = 'tb-sep'; return s; };
function buildFormatToolbar(getTa: () => HTMLTextAreaElement | null): HTMLElement {
  const bar = document.createElement('div'); bar.className = 'fmt-toolbar edit-toolbar';   // ★서식+변환 한 줄 통합 툴바(본문에 부착)
  const mk = (html: string, title: string, mark: string) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'fmt-btn'; b.title = title; b.innerHTML = html;
    b.addEventListener('mousedown', (e) => e.preventDefault());   // textarea 선택 유지(포커스 안 뺏음)
    b.onclick = () => { const ta = getTa(); if (ta) wrapSel(ta, mark); };
    return b;
  };
  bar.append(
    mk('<b>B</b>', '굵게  **굵게**', '**'),
    mk('<i>I</i>', '기울임  *기울임*', '*'),
    mk('<u>U</u>', '밑줄  __밑줄__', '__'),
    mk('<span class="fmt-hl">H</span>', '하이라이트  ==하이라이트==', '=='),
    tbSep(),
  );
  // 🖼 이미지 삽입 — 활성 입력칸 커서 위치에 인라인 <img>(아카 호환). 큰 이미지는 자동 축소. 웹·데스크탑 공통.
  const imgBtn = document.createElement('button'); imgBtn.type = 'button'; imgBtn.className = 'fmt-btn fmt-img'; imgBtn.innerHTML = icon('photo');
  imgBtn.title = '이미지 삽입 — 활성 입력칸 커서 위치에 그림을 넣습니다(인라인 img·아카 호환). 큰 이미지는 자동 축소.';
  imgBtn.addEventListener('mousedown', (e) => e.preventDefault());   // 입력칸 선택/포커스 유지
  const fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.accept = 'image/*'; fileIn.style.display = 'none';
  let imgTarget: HTMLTextAreaElement | null = null;
  imgBtn.onclick = () => { imgTarget = getTa(); if (!imgTarget) { setStatus('이미지를 넣을 입력칸을 먼저 누르세요.'); return; } fileIn.click(); };
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; const ta = imgTarget; if (!f || !ta) return;
    setStatus('이미지 넣는 중…');
    try {
      let url = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = () => rej(new Error('읽기 실패')); r.readAsDataURL(f); });
      if (f.size > 500 * 1024) url = await downscaleDataUrl(url, 1600);   // 과대 용량 방지(아카·저장 가벼움)
      const s = ta.selectionStart ?? ta.value.length;
      const before = ta.value.slice(0, s).replace(/\s*$/, ''), after = ta.value.slice(s).replace(/^\s*/, '');
      const tag = `<img src="${url}" style="max-width:100%">`;   // 인라인 — 미리보기 살균 통과 + 리치복사 시 업로드(아카)
      ta.value = (before ? before + '\n\n' : '') + tag + (after ? '\n\n' + after : '');
      ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }));   // 미리보기·자동저장 반영
      setStatus('이미지를 넣었어요.');
    } catch (e: any) { setStatus('이미지 삽입 실패: ' + ((e && e.message) || '')); }
  });
  bar.append(imgBtn, fileIn);
  return bar;
}
// 메인 입력칸 툴바의 대상 = 지금 포커스된 입력 textarea(기본 입력란 또는 블록 .pb-content), 없으면 활성 대상.
const fmtTarget = (): HTMLTextAreaElement | null => {
  const a = document.activeElement;
  if (a instanceof HTMLTextAreaElement && (a.id === 'input' || a.classList.contains('pb-content'))) return a;
  return activeTarget();
};
// ★서식·이미지·변환을 한 줄 통합 툴바로(본문에 부착). 변환 그룹(번역·정리·⚙)은 아래에서 같은 툴바에 합쳐 1회 삽입.
const editToolbar = buildFormatToolbar(fmtTarget);

// ── 변환 그룹(번역·정리·설정, BYO-key) — 영·일·중 로그를 한국어로 / 군더더기 정리. 웹·데스크탑 공통(translateAvailable). ──
function translateTargets(): HTMLTextAreaElement[] {
  // 블록형 디자인(다이어리/카드블록/채팅/웹소설)이면 그 블록 칸들, 아니면 기본 입력란.
  const blocks = Array.from(document.querySelectorAll('#diary-pages .pb-content, #card-blocks .pb-content, #chat-messages .pb-content, #webnovel-blocks .pb-content')) as HTMLTextAreaElement[];
  return blocks.length ? blocks : [inputEl];
}
if (translateAvailable()) {
  const tBtn = document.createElement('button'); tBtn.type = 'button'; tBtn.className = 'tr-btn'; tBtn.innerHTML = icon('language') + ' 번역';
  tBtn.title = '영·일·중 로그를 한국어로 — 이미지·대사 구조는 보존(본인 API 키)';
  const rBtn = document.createElement('button'); rBtn.type = 'button'; rBtn.className = 'tr-btn'; rBtn.innerHTML = icon('undo') + ' 원문'; rBtn.hidden = true;
  const sBtn = document.createElement('button'); sBtn.type = 'button'; sBtn.className = 'tr-btn tr-set'; sBtn.innerHTML = icon('settings'); sBtn.title = '번역 설정(서비스·API 키)';
  let lastRestore: (() => void) | null = null;
  tBtn.onclick = async () => {
    if (!(await ensureTranslateReady(setStatus))) return;
    const targets = translateTargets();
    const o = tBtn.innerHTML; tBtn.disabled = true; tBtn.textContent = '번역 중…';
    try {
      const res = await translateEditors(targets, setStatus);
      if (res) { lastRestore = res.restore; rBtn.hidden = false; setStatus(`번역 완료 — 문단 ${res.translated}개` + (res.skipped ? ` · 한국어 ${res.skipped}개 건너뜀` : '') + (res.failed ? ` · 실패 ${res.failed}개(원문 유지)` : '')); }
    } catch (e: any) { setStatus('번역 실패: ' + ((e && e.message) || '')); }
    tBtn.disabled = false; tBtn.innerHTML = o;
  };
  rBtn.onclick = () => { if (lastRestore) { lastRestore(); lastRestore = null; rBtn.hidden = true; setStatus('원문으로 되돌렸습니다.'); } };
  sBtn.onclick = () => openTranslateSettings(setStatus);
  // 정리(군더더기 제거) — 1차 결정론(키 불필요). 번역과 같은 대상 칸에 작용, 되돌리기 제공.
  const clBtn = document.createElement('button'); clBtn.type = 'button'; clBtn.className = 'tr-btn'; clBtn.innerHTML = icon('broom') + ' 정리';
  clBtn.title = '응답 헤더·생각의 사슬·OOC·화자 라벨 같은 군더더기를 걷어내 본문만 — 이미지·대사 보존(키 불필요)';
  const clRBtn = document.createElement('button'); clRBtn.type = 'button'; clRBtn.className = 'tr-btn'; clRBtn.innerHTML = icon('undo') + ' 정리취소'; clRBtn.hidden = true;
  let lastClean: (() => void) | null = null;
  clBtn.onclick = async () => {
    const targets = translateTargets();
    const o = clBtn.innerHTML; clBtn.disabled = true; clBtn.textContent = '정리 중…';
    try { const res = await cleanEditors(targets, setStatus); if (res) { lastClean = res.restore; clRBtn.hidden = false; setStatus(`정리 완료 — ${res.cleaned}개 정리` + (res.failed ? ` · 실패 ${res.failed}개(원문 유지)` : '')); } }
    catch (e: any) { setStatus('정리 실패: ' + ((e && e.message) || '')); }
    clBtn.disabled = false; clBtn.innerHTML = o;
  };
  clRBtn.onclick = () => { if (lastClean) { lastClean(); lastClean = null; clRBtn.hidden = true; setStatus('정리 전 원문으로 되돌렸습니다.'); } };
  // ★모바일 오버플로: 변환 그룹을 .tb-convert로 묶고 ··· 버튼으로 접기(좁을 때). 데스크탑은 ··· 숨김 + 그룹 인라인.
  const convWrap = document.createElement('div'); convWrap.className = 'tb-convert'; convWrap.append(tBtn, rBtn, clBtn, clRBtn, sBtn);
  const moreBtn = document.createElement('button'); moreBtn.type = 'button'; moreBtn.className = 'tr-btn tb-more'; moreBtn.innerHTML = icon('dots'); moreBtn.title = '변환 도구(번역 · 정리 · 설정)';
  moreBtn.onclick = () => editToolbar.classList.toggle('conv-open');
  editToolbar.append(tbSep(), moreBtn, convWrap);   // [서식 | 🖼 | (모바일:···) 변환그룹]
}
inputEl.insertAdjacentElement('beforebegin', editToolbar);   // 통합 툴바 1회 삽입(서식 없는 웹도 포맷 그룹은 표시)

// 모바일: ⚙ 설정 드롭다운을 뷰포트 기준(헤더 바로 아래·좌우 마진)으로 띄워 화면 밖 잘림 방지.
//   헤더가 wrap으로 여러 줄이 되면 버튼 위치가 변하므로 top은 헤더 bottom을 실측해 인라인 지정.
//   데스크탑(>820px)은 인라인 top을 비워 CSS 기본(버튼 우측 앵커) 그대로.
document.querySelectorAll('.settings-menu').forEach((d) => {
  d.addEventListener('toggle', () => {
    const pop = d.querySelector('.menu-pop') as HTMLElement | null;
    if (!pop) return;
    if ((d as HTMLDetailsElement).open && window.matchMedia('(max-width: 820px)').matches) {
      const hdr = document.querySelector('.topbar') as HTMLElement | null;
      const bottom = hdr ? hdr.getBoundingClientRect().bottom : 56;
      pop.style.top = Math.max(6, bottom + 6) + 'px';   // 헤더 바로 아래(실측), 좌우는 CSS가 뷰포트 마진으로 고정
    } else {
      pop.style.top = '';                               // 데스크탑/닫힘 = CSS 기본 복귀
    }
  });
});

// ── 명명 CSS 디자인 레지스트리 = 동기화 KV(프리셋과 동일 계층). { id, name, base, css, order }[]. base=card(P1)·webnovel(P2). ──
const CSS_DESIGNS_KEY = 'pro2-css-designs';
function getCssDesigns(): any[] { const o = kvLoad(CSS_DESIGNS_KEY); const arr = Array.isArray(o) ? o : []; return arr.filter((d: any) => d && d.id).slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0)); }
function saveCssDesigns(arr: any[]): void { arr.forEach((d, i) => { d.order = i; }); kvSave(CSS_DESIGNS_KEY, arr); }
function newCssId(): string { return 'css_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
// 현재 활성 CSS 디자인(드롭다운 연속성 — 에디터 로컬). custom-css 경로의 어느 슬롯이 로드됐나.
const ACTIVE_CSS_KEY = 'pro2-active-css-design';
let activeCssDesign: string = (() => { try { return localStorage.getItem(ACTIVE_CSS_KEY) || ''; } catch (_) { return ''; } })();
function setActiveCssDesign(id: string): void { activeCssDesign = id || ''; try { if (id) localStorage.setItem(ACTIVE_CSS_KEY, id); else localStorage.removeItem(ACTIVE_CSS_KEY); } catch (_) {} }

function syncOutputDesignSelect() {
  const sel = document.getElementById('output-design-select') as HTMLSelectElement | null;
  if (!sel) return;
  // custom-css 경로 + 활성 명명 디자인이면 그 디자인을 선택 표시, 아니면 템플릿.
  if ((settings.template || 'card') === 'custom-css' && activeCssDesign && getCssDesigns().some((d) => d.id === activeCssDesign)) sel.value = 'cssdesign:' + activeCssDesign;
  else sel.value = settings.template || 'card';
}

function buildOutputDesignSelect() {
  const sel = document.getElementById('output-design-select') as HTMLSelectElement | null;
  if (!sel) return;
  sel.innerHTML = '';
  for (const id of TEMPLATE_ORDER) {
    const def = TEMPLATE_DEFS[id];
    const o = document.createElement('option');
    o.value = id;
    o.textContent = def.label;
    sel.appendChild(o);
  }
  // 사용자 CSS 디자인들(custom-css 아래, order 순) — 선택 시 그 base 렌더 + css.
  const designs = getCssDesigns();
  if (designs.length) {
    const og = document.createElement('optgroup'); og.label = '내 CSS 디자인';
    for (const d of designs) { const o = document.createElement('option'); o.value = 'cssdesign:' + d.id; o.textContent = '✎ ' + d.name; og.appendChild(o); }
    sel.appendChild(og);
  }
  syncOutputDesignSelect();
  sel.onchange = () => {
    const v = sel.value || 'card';
    if (v.indexOf('cssdesign:') === 0) selectCssDesign(v.slice(10));
    else { setActiveCssDesign(''); settings.cssBase = ''; switchDesign(v); }
  };
}
// 명명 CSS 디자인 선택 = custom-css 경로 + 그 디자인 css·base 로드. base=card→카드, base=webnovel→웹소설(convertText 분기).
function selectCssDesign(id: string) {
  const d = getCssDesigns().find((x) => x.id === id);
  if (!d) { setActiveCssDesign(''); settings.cssBase = ''; switchDesign('custom-css'); return; }
  switchDesign('custom-css');                 // custom-css 렌더 경로 활성(옛 룩 캡처 포함)
  setActiveCssDesign(id);
  settings.cssBase = d.base || 'card';         // ★base 디스패치(webnovel이면 웹소설 렌더+훅)
  settings.userCardCss = sanitizeCss(d.css || '');   // 디자인 css 로드(라이브 렌더)
  buildControls(); syncOutputDesignSelect(); scheduleRender();
  setStatus(`CSS 디자인 "${d.name}" 선택됨`);
}

// ---------- 에셋 매핑 (입력에 쓰인 이름만 dataURL) ----------
const stripExt = (s: string) => s.replace(/\.[^.]+$/, '');
function assetByRef(ref: string) {
  if (!parsed) return null;
  const A = parsed.assets;
  return A.find((a: any) => a.found && a.name === ref)        // 풀네임 (tarumaemaru.happy.webp)
    || A.find((a: any) => a.found && stripExt(a.name) === ref) // 확장자 없는 이름 ([🌠|tarumaemaru.happy])
    || A.find((a: any) => a.found && a.tag === ref);           // 감정 별칭 (happy)
}
// 지연 로드(대형 risum)면 이 에셋을 필요할 때만 복호 → data URL. 작은 카드(즉시 파싱)는 바로 통과.
function decodedUrl(a: any): string {
  if (a && !a.bytes && parsed && parsed.lazy) {
    if (parsed.format === 'charx') decodeCharxAsset(parsed._bytes, a);
    else decodeRisumAsset(parsed._bytes, a); // risum
  }
  return assetDataUrl(a) || '';
}
function mappingsForInput(text: string) {
  const map: Record<string, string> = {};
  const refs = new Set<string>();
  // 4개 이미지 토큰 전부: 엔진 getImagePatterns/extractTagFromMatch로 식별자 추출(엔진 lookup 키와 1:1 일치).
  // ({{img::}}/{{img=}}/<img src=>/<img=>/<image=>) — <img src='이름'>도 카드 에셋 자동매핑 대상에 포함.
  for (const re of getImagePatterns()) {
    for (const m of text.matchAll(re)) {
      const key = extractTagFromMatch(m[0].replace(/″/g, '"')); // 엔진과 동일 정규화(″→")
      if (key) refs.add(key);
    }
  }
  for (const m of text.matchAll(/\[[^\]|\n]*\|\s*([^\]\n]+?)\s*\]/g)) refs.add(m[1].trim()); // RisuAI [🌠|이름] (엔진 키 = name.trim())
  // 카드 regex가 펼친 에셋 CBS({{raw|asset|source|emotion::이름}})의 이름도 수집 → dataURL 매핑 생성
  for (const m of text.matchAll(/\{\{(?:raw|asset|source|emotion|image_asset)::\s*([^}]+?)\s*\}\}/g)) refs.add(m[1].trim());
  for (const ref of refs) {
    if (urlCache[ref]) { map[ref] = urlCache[ref]; continue; }
    const a = assetByRef(ref.trim()); // 키는 엔진 정확값 유지, 에셋 조회는 trim으로 관대하게
    if (a) { const u = decodedUrl(a); if (u) { urlCache[ref] = u; map[ref] = u; } }
  }
  return map;
}

// ---------- 렌더 (디바운스) ----------
let rt: any = null;
let sticky = '';  // 프리셋/레거시 적용 메시지 — render가 덮어쓰지 않게 유지(사용자 입력 시 해제)
function setStatus(msg: string) { sticky = msg; statusEl.textContent = msg; }
function scheduleRender() { clearTimeout(rt); rt = setTimeout(render, 120); saveLocal(); }
// 변환·스캔·저장이 읽는 "현재 본문 텍스트". 로그 다이어리는 입력란 대신 페이지 블록(cfg.pages)을 합쳐서 쓴다.
function currentInputText(): string {
  if (settings.template === 'log-diary') {
    const cfg = (settings.templateSettings && settings.templateSettings['log-diary']) || {};
    if (Array.isArray(cfg.pages) && cfg.pages.length) return cfg.pages.map((p: any) => String(p.content || '')).join('\n');
  }
  if (settings.template === 'card') {
    const cfg = (settings.templateSettings && settings.templateSettings.card) || {};
    if (Array.isArray(cfg.blocks) && cfg.blocks.length) return cfg.blocks.map((b: any) => String(b.content || '')).join('\n');
  }
  if (settings.template === 'chat') {
    const cfg = (settings.templateSettings && settings.templateSettings.chat) || {};
    if (Array.isArray(cfg.messages) && cfg.messages.length) return cfg.messages.map((m: any) => String(m.text || '')).join('\n');
  }
  if (settings.template === 'webnovel') {
    const cfg = (settings.templateSettings && settings.templateSettings.webnovel) || {};
    if (cfg.useBlocks && Array.isArray(cfg.blocks) && cfg.blocks.length) return cfg.blocks.map((b: any) => String(b.content || '')).join('\n\n');
  }
  if (settings.template === 'papa') return papaCombinedHtml();   // 파파 = 살균 합본(다중 블록 포함) → 소스 복사·제목 파생에 사용
  return inputEl.value;
}
const cardBlocksActive = () => {
  const cfg = (settings.templateSettings && settings.templateSettings.card) || {};
  return Array.isArray(cfg.blocks) && cfg.blocks.length > 0;
};
const wnBlocksActive = () => {
  const cfg = (settings.templateSettings && settings.templateSettings.webnovel) || {};
  return !!cfg.useBlocks;
};
const papaBlocksActive = () => {
  const cfg = (settings.templateSettings && settings.templateSettings.papa) || {};
  return !!(cfg.useBlocks && Array.isArray(cfg.blocks));
};
// 파파 합본 html — 다중 블록이면 블록별 살균본을 구분자로 잇는다(리더/공유가 같은 마커로 쪼개 블록별 격리). 단일이면 입력칸 살균본.
function papaCombinedHtml(): string {
  if (papaBlocksActive()) {
    const cfg = templateConfig('papa');
    return (cfg.blocks || []).map((b: any) => sanitizePapaHtml(String(b.html || ''))).join('\n' + PAPA_SEP + '\n');
  }
  return sanitizePapaHtml(inputEl.value || '');
}

// (심플/Pro2 모드 제거 — 항상 LogPapa 풀기능. 듀얼 정체성 폐기.)

// ── 복사 이미지 형식: 기본 PNG(고화질). 모바일이면 기본 JPEG(클립보드 용량 한계). 사용자 선택은 localStorage 기억. ──
const isMobileDevice = () => /Android|iPhone|iPad|iPod|Mobile|Mobi/i.test(navigator.userAgent) || !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
const JPEG_KEY = 'pro2-clipboard-jpeg';
let jpegMode = (() => { const s = localStorage.getItem(JPEG_KEY); return s === '1' ? true : s === '0' ? false : isMobileDevice(); })();

// ── 표지 굽기(B): 표지를 한 장 이미지(배경+페이드+제목+둥근모서리)로 캔버스 합성 → data URL. 아카가 못 떼는 픽셀. ──
const DIARY_FONT_FAM: Record<string, string> = { 'Noto Serif KR': 'Noto+Serif+KR:wght@400;500;700' };
const loadedDiaryFonts = new Set<string>();
async function ensureDiaryFont(font: string) {
  if (font && DIARY_FONT_FAM[font] && !loadedDiaryFonts.has(font)) {
    loadedDiaryFonts.add(font);
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=' + DIARY_FONT_FAM[font] + '&display=swap'; document.head.appendChild(l);
  }
  try { await (document as any).fonts.load('700 40px "' + font + '"'); await (document as any).fonts.load('500 20px "' + font + '"'); } catch (_) {}
}
const BAKE_RATIO: Record<string, number> = { wide: 21 / 9, banner: 16 / 9, tall: 3 / 2 };
// 캔버스 둥근 사각형 path(roundRect 폴리필 포함) — 표지 태그 칩용.
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if ((ctx as any).roundRect) { (ctx as any).roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function bakeCover(cfg: any): Promise<string> {
  return new Promise((resolve) => {
    const src = cfg.coverImage; if (!src) { resolve(''); return; }
    const im = new Image();
    im.onload = async () => {
      try {
        await ensureDiaryFont(cfg.font || 'Pretendard');
        const ratio = BAKE_RATIO[cfg.imageRatio] || (3 / 2);  // 비율 미설정이면 표지 기본 3:2
        const W = 1200, H = Math.round(W / ratio);
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const ctx = c.getContext('2d')!;
        // 1) 배경 이미지: 비율 맞춰 크롭 + 세로 위치(coverFocusY) + 확대(coverZoom). 가로는 가운데 고정(띠와 동일 방식).
        const iw = im.naturalWidth, ih = im.naturalHeight;
        let cw = iw, ch = Math.round(iw / ratio);
        if (ch > ih) { ch = ih; cw = Math.round(ih * ratio); }
        const cz = Math.max(1, Math.min(3, (isFinite(+cfg.coverZoom) ? +cfg.coverZoom : 100) / 100));
        cw = Math.max(1, Math.min(iw, Math.round(cw / cz)));
        ch = Math.max(1, Math.min(ih, Math.round(ch / cz)));
        const cfy = Math.max(0, Math.min(100, isFinite(+cfg.coverFocusY) ? +cfg.coverFocusY : 50)) / 100; // 0=위 50=가운데 100=아래
        const sx = Math.round((iw - cw) / 2), sy = Math.round((ih - ch) * cfy);
        ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, W, H);
        ctx.drawImage(im, sx, sy, cw, ch, 0, 0, W, H);
        // 2) 아래→위 검은 페이드
        const g = ctx.createLinearGradient(0, H, 0, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(0.25, 'rgba(0,0,0,0.5)'); g.addColorStop(0.55, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        // 3) 텍스트(하단 좌측, 위→아래): 번호 · 제목 · 부제 · 태그칩 — log-diary 비율(px/615 기준)·명조.
        const fallback = cfg.font === 'Pretendard' ? 'sans-serif' : 'serif';
        const fam = "'" + (cfg.font || 'Noto Serif KR') + "', " + fallback;
        const scn = Number(cfg.coverTextScale); const sc = isFinite(scn) ? Math.max(0.8, Math.min(2.5, scn)) : 1.5; // 표지 글씨 크기 배율
        const padX = Math.round(W * 0.045); let y = H - Math.round(H * 0.06);
        ctx.textAlign = 'left';
        // 태그 칩(맨 아래): log-diary 그대로 — 각진 사각(둥글기 없음) + 흰 테두리 + 반투명 배경 + 작은 글씨.
        const coverTags = Array.isArray(cfg.coverTags) ? cfg.coverTags.map((t: any) => String(t || '').trim()).filter(Boolean) : [];
        if (coverTags.length) {
          ctx.shadowColor = 'transparent';
          const fs = Math.round(H * 0.02 * sc), cpx = Math.round(H * 0.018 * sc), cpy = Math.round(H * 0.012 * sc), gap = Math.round(H * 0.011);
          ctx.font = '400 ' + fs + 'px ' + fam; ctx.textBaseline = 'middle';
          const chipH = fs + cpy * 2, top = y - chipH; let cx = padX;
          for (const label of coverTags) {
            const w = Math.round(ctx.measureText(label).width) + cpx * 2;
            ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(cx, top, w, chipH);
            ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = Math.max(1, H * 0.0013); ctx.strokeRect(cx + 0.5, top + 0.5, w - 1, chipH - 1);
            ctx.fillStyle = '#ffffff'; ctx.fillText(label, cx + cpx, top + chipH / 2 + Math.round(H * 0.002));
            cx += w + gap;
          }
          ctx.textBaseline = 'alphabetic';
          y = top - Math.round(H * 0.022 * sc);
        }
        ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = Math.round(H * 0.014); ctx.shadowOffsetY = 2;
        if (cfg.coverSubtitle && cfg.coverSubtitle.trim()) { ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = '400 ' + Math.round(H * 0.023 * sc) + 'px ' + fam; ctx.fillText(cfg.coverSubtitle, padX, y); y -= Math.round(H * 0.04 * sc); }
        if (cfg.coverTitle && cfg.coverTitle.trim()) { ctx.fillStyle = '#ffffff'; ctx.font = '700 ' + Math.round(H * 0.068 * sc) + 'px ' + fam; ctx.fillText(cfg.coverTitle, padX, y); y -= Math.round(H * 0.088 * sc); }
        if (cfg.coverArchiveNo && cfg.coverArchiveNo.trim()) {
          ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '400 ' + Math.round(H * 0.018 * sc) + 'px ' + fam;
          if ('letterSpacing' in ctx) (ctx as any).letterSpacing = Math.round(H * 0.004) + 'px';
          ctx.fillText(String(cfg.coverArchiveNo).toUpperCase(), padX, y);
          if ('letterSpacing' in ctx) (ctx as any).letterSpacing = '0px';
        }
        ctx.shadowColor = 'transparent';
        // ★모서리는 굽지 않음(사각형). 둥글리기는 출력 <img>의 CSS border-radius에만 맡긴다(아카가 살려줌).
        // 형식: 기본 PNG(고화질, 글씨 선명) · 저화질 모드면 JPEG(작은 용량, 모바일 클립보드용).
        resolve(jpegMode ? c.toDataURL('image/jpeg', 0.86) : c.toDataURL('image/png'));
      } catch (_) { resolve(''); }
    };
    im.onerror = () => resolve('');
    im.src = src;
  });
}
let bakeCache: { key: string; url: string } = { key: '', url: '' };
async function getBakedCover(cfg: any): Promise<string> {
  if (!cfg.coverBake || !cfg.coverImage) return '';
  const key = [cfg.coverImage.length, cfg.coverImage.slice(0, 48), cfg.coverArchiveNo, cfg.coverTitle, cfg.coverSubtitle, cfg.font, cfg.imageRatio, (cfg.coverTags || []).join('~'), cfg.coverTextScale, cfg.coverFocusY, cfg.coverZoom, jpegMode ? 'j' : 'p'].join('|');
  if (bakeCache.key === key && bakeCache.url) return bakeCache.url;
  const url = await bakeCover(cfg);
  bakeCache = { key, url };
  return url;
}

// 페이지 헤더 이미지에 제목을 얹은 "섹션 띠"(log-diary). 와이드 띠(4:1) + 어둡게 + 중앙 라벨/제목. 제목 없으면 굽지 않음.
function bakePageBand(imageUrl: string, title: string, subtitle: string, font: string, scale: number, png: boolean, focusX?: number, focusY?: number, zoom?: number): Promise<string> {
  return new Promise((resolve) => {
    if (!imageUrl) { resolve(''); return; }
    const im = new Image();
    im.onload = async () => {
      try {
        await ensureDiaryFont(font || 'Noto Serif KR');
        const fam = "'" + (font || 'Noto Serif KR') + "', " + (font === 'Pretendard' ? 'sans-serif' : 'serif');
        const W = 1200, H = Math.round(W / 6); // 6:1 와이드 띠(원본 log-diary 섹션 ≈15vh 높이에 맞춤, 4:1보다 낮음)
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const ctx = c.getContext('2d')!;
        // 구도/확대: 대상 비율(6:1)에 맞는 최대 영역을 잡고 → 확대(zoom)로 좁히고 → focus로 위치.
        const ratio = W / H, iw = im.naturalWidth, ih = im.naturalHeight;
        let cw = iw, ch = Math.round(iw / ratio);
        if (ch > ih) { ch = ih; cw = Math.round(ih * ratio); }
        const z = Math.max(1, Math.min(3, (isFinite(+(zoom as any)) ? +(zoom as any) : 100) / 100));
        cw = Math.max(1, Math.min(iw, Math.round(cw / z)));
        ch = Math.max(1, Math.min(ih, Math.round(ch / z)));
        const fx = Math.max(0, Math.min(100, isFinite(+(focusX as any)) ? +(focusX as any) : 50)) / 100; // 0=왼쪽 50=가운데 100=오른쪽
        const fy = Math.max(0, Math.min(100, isFinite(+(focusY as any)) ? +(focusY as any) : 50)) / 100; // 0=위 50=가운데 100=아래
        const sx = Math.round((iw - cw) * fx), sy = Math.round((ih - ch) * fy);
        ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, W, H);
        ctx.drawImage(im, sx, sy, cw, ch, 0, 0, W, H);
        // 표지와 동일하게 '아래로만' 페이드(위는 투명). 평탄 어둡게/상단 스톱 제거 → 위아래 어두워지던 문제 해결.
        // 텍스트는 중앙이라, 원본 log-diary 섹션처럼 중간까지 완만히 어둡게 유지(0.9→0.6→투명@60%).
        const g = ctx.createLinearGradient(0, H, 0, 0); g.addColorStop(0, 'rgba(0,0,0,0.9)'); g.addColorStop(0.3, 'rgba(0,0,0,0.6)'); g.addColorStop(0.6, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        const sc = isFinite(+scale) ? Math.max(0.8, Math.min(2.5, +scale)) : 1.5;
        ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = Math.round(H * 0.04); ctx.shadowOffsetY = 1;
        const cxc = Math.round(W / 2), lbl = String(subtitle || '').trim(), ttl = String(title || '').trim();
        const titleFs = Math.round(H * 0.16 * sc), labelFs = Math.round(H * 0.075 * sc), gap = Math.round(H * 0.05);
        const stackH = (lbl ? labelFs + gap : 0) + titleFs; let cy = Math.round(H / 2 - stackH / 2);
        if (lbl) { ctx.font = '400 ' + labelFs + 'px ' + fam; ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.textBaseline = 'top'; if ('letterSpacing' in ctx) (ctx as any).letterSpacing = Math.round(H * 0.008) + 'px'; ctx.fillText(lbl.toUpperCase(), cxc, cy); if ('letterSpacing' in ctx) (ctx as any).letterSpacing = '0px'; cy += labelFs + gap; }
        ctx.font = '700 ' + titleFs + 'px ' + fam; ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'top'; ctx.fillText(ttl, cxc, cy);
        ctx.shadowColor = 'transparent';
        resolve(png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.86));
      } catch (_) { resolve(''); }
    };
    im.onerror = () => resolve('');
    im.src = imageUrl;
  });
}
const bandCache = new Map<string, string>();
async function getBakedBand(p: any, font: string, scale: number, png: boolean): Promise<string> {
  if (!p || !p.image) return ''; // 이미지 없으면 굽지 않음(제목/부제는 선택 — 없으면 텍스트 없는 띠)
  const fx = p.bandFocusX, fy = p.bandFocusY, z = p.bandZoom; // 구도/확대 노브(없으면 기본=가운데·100%)
  const key = [p.image.length, p.image.slice(0, 40), p.title, p.subtitle, font, scale, png ? 'p' : 'j', fx, fy, z].join('|');
  if (bandCache.has(key)) return bandCache.get(key)!;
  const url = await bakePageBand(p.image, p.title, p.subtitle || '', font, scale, png, fx, fy, z);
  bandCache.set(key, url);
  if (bandCache.size > 40) { const k = bandCache.keys().next().value; if (k !== undefined) bandCache.delete(k); }
  return url;
}

// 미리보기 iframe(sandbox)은 부모의 폰트를 못 받으므로 srcdoc에 폰트 링크를 직접 넣는다(다이어리=Noto Serif KR 명조).
const PREVIEW_FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;500;700&display=swap"><link rel="stylesheet" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">';
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  try {
    // ★파파모드 = 순수 통과(변환엔진 안 거침). 붙여넣은/소스 HTML을 살균만 하고 블록별 Shadow DOM으로 렌더(리더와 동일 함수=진짜 WYSIWYG).
    if (settings.template === 'papa') {
      lastCard = papaCombinedHtml();   // 저장·복사용 합본(다중 블록은 구분자로 이음)
      renderPapaBlocks(papaPreviewEl, lastCard);   // 미리보기 = 리더와 같은 격리 렌더
      const hasContent = papaBlocksActive() ? (templateConfig('papa').blocks || []).some((b: any) => String(b.html || '').trim()) : inputEl.value.trim();
      statusEl.textContent = sticky || (hasContent ? '' : '여기에 다른 제조기 로그를 붙여넣으세요(리치 복사 / 소스 복사)');
      return;
    }
    const src = currentInputText();
    // 카드 regex가 펼치는 에셋명까지 매핑하려면 펼친 뒤 스캔(스캔용 throwaway; convertText가 실제로 다시 펼침)
    const scanText = (settings.cardRegex && settings.cardRegex.length) ? expandCardRegex(src, settings.cardRegex) : src;
    const extra = mappingsForInput(scanText);
    // 표지 굽기 모드면 표지 한 장 이미지를 합성해 convertText용 클론에만 주입(원본 settings·저장은 깨끗하게).
    let convSettings: any = settings;
    if (settings.template === 'log-diary') {
      const cfgLD = (settings.templateSettings && settings.templateSettings['log-diary']) || {};
      // 섹션 항목(이미지 있음)마다 챕터 띠로 굽기(섹션제목/부제 오버레이) + 표지 굽기.
      const wantBands = Array.isArray(cfgLD.pages) && cfgLD.pages.some((p: any) => p && p.itemType === 'section' && p.image);
      const wantCover = cfgLD.coverBake && cfgLD.coverImage;
      if (wantBands || wantCover) {
        let ld: any = null;
        // 이미지 있는 섹션 항목 → bakedSection(섹션제목/부제 구워진 띠) 주입(transient).
        if (wantBands) {
          const newPages = await Promise.all(cfgLD.pages.map(async (p: any) => {
            if (p && p.itemType === 'section' && p.image) {
              // 섹션 띠 글씨 크기는 표지와 독립(per-섹션 bandTextScale, 기본 1.5).
              const band = await getBakedBand(p, cfgLD.font, (p.bandTextScale != null ? p.bandTextScale : 1.5), !jpegMode);
              return band ? Object.assign({}, p, { bakedSection: band }) : p;
            }
            return p;
          }));
          if (seq !== renderSeq) return;
          ld = Object.assign({}, cfgLD, { pages: newPages });
        }
        // 표지 굽기
        if (wantCover) {
          const baked = await getBakedCover(cfgLD);
          if (seq !== renderSeq) return;
          ld = Object.assign({}, ld || cfgLD, { bakedCover: baked });
        }
        if (ld) convSettings = Object.assign({}, settings, { templateSettings: Object.assign({}, settings.templateSettings, { 'log-diary': ld }) });
      }
    }
    lastCard = convertText(src, convSettings, extra);
    // 미리보기 = lastCard 그대로(인라인 <img>로 통일됨) → 복사해서 아카에 붙이는 것과 동일(진짜 WYSIWYG). 별도 <style> 주입 안 함.
    // 미리보기 iframe(sandbox)은 부모의 등록 폰트를 못 받음 → 커스텀 폰트는 @font-face(base64)로 따로 심는다.
    const customFontCss = getFontFaceCss();
    previewEl.srcdoc = `<!doctype html><meta charset="utf-8">${PREVIEW_FONTS}${customFontCss ? `<style>${customFontCss}</style>` : ''}<body style="margin:0;padding:16px;background:transparent;">${lastCard}</body>`;
    statusEl.textContent = sticky || (src.trim() ? '' : '입력 대기');
  } catch (e: any) { statusEl.textContent = '오류: ' + e.message; }
}

// 입력란 모드: 다이어리=페이지 에디터, 기본카드(다중블록 켬)=블록 에디터, 그 외=일반 입력란.
function updateInputMode() {
  const pagesEl = document.getElementById('diary-pages');
  const blocksEl = document.getElementById('card-blocks');
  const chatEl = document.getElementById('chat-messages');
  const wnEl = document.getElementById('webnovel-blocks');
  const toggleRow = document.getElementById('card-blocks-toggle-row');
  const toggle = document.getElementById('card-blocks-toggle') as HTMLInputElement | null;
  const isDiary = settings.template === 'log-diary';
  const isCard = settings.template === 'card';
  const isChat = settings.template === 'chat';
  const isWn = settings.template === 'webnovel';
  const isPapaUi = settings.template === 'papa';
  const papaEl = document.getElementById('papa-blocks');
  const papaToggleRow = document.getElementById('papa-blocks-toggle-row');
  const papaToggle = document.getElementById('papa-blocks-toggle') as HTMLInputElement | null;
  const papaBlocks = isPapaUi && papaBlocksActive();
  applyPapaUi(isPapaUi);   // ★파파 = 02 설정/커스텀·카드에셋·서식툴바 숨김 → 큰 01 입력 + 02 미리보기만
  if (papaToggleRow) papaToggleRow.hidden = !isPapaUi;   // '여러 블록으로 나누기' 토글은 파파일 때만
  if (papaToggle) papaToggle.checked = papaBlocks;
  if (papaEl) papaEl.hidden = !papaBlocks;
  if (papaBlocks && papaEl) buildPapaBlocksEditor(papaEl, templateConfig('papa'));
  if (!pagesEl) return;
  // 기본카드일 때만 '다중 블록' 토글 노출.
  if (toggleRow) toggleRow.hidden = !isCard;
  const cardBlocks = isCard && cardBlocksActive();
  const wnBlocks = isWn && wnBlocksActive();
  if (toggle) toggle.checked = cardBlocks;
  // 전역 '출력에서 접어두기' 토글은 블록 모드일 때만.
  const collapseRow = document.getElementById('card-collapse-row');
  const collapseToggle = document.getElementById('card-collapse-toggle') as HTMLInputElement | null;
  if (collapseRow) collapseRow.hidden = !cardBlocks;
  if (collapseToggle) collapseToggle.checked = !!templateConfig('card').collapseAll;
  inputEl.hidden = isDiary || cardBlocks || isChat || wnBlocks || papaBlocks;
  pagesEl.hidden = !isDiary;
  if (blocksEl) blocksEl.hidden = !cardBlocks;
  if (chatEl) chatEl.hidden = !isChat;
  if (wnEl) wnEl.hidden = !wnBlocks;
  if (cardBlocks && blocksEl) buildCardBlocksEditor(blocksEl, templateConfig('card'));
  if (wnBlocks && wnEl) buildWebnovelBlocksEditor(wnEl, templateConfig('webnovel'));
  if (isChat && chatEl) {
    const cfg = templateConfig('chat');
    // 최초 전환: 메시지가 없으면 입력란 내용을 한 메시지로 시드(없으면 빈 유저 메시지 1개).
    if (!Array.isArray(cfg.messages) || !cfg.messages.length) {
      const txt = inputEl.value.trim();
      cfg.messages = txt ? [{ role: 'char', text: inputEl.value }] : [{ role: 'user', text: '' }];
    }
    buildChatEditor(chatEl, cfg);
  }
  if (isDiary) {
    const cfg = templateConfig('log-diary');
    cfg.pages = Array.isArray(cfg.pages) ? cfg.pages : [];
    // 최초 전환: 원본 Log Diary 구조에 맞춰 "섹션(챕터 띠) + 페이지 1개"를 기본 시드.
    // 기존 입력란 내용이 있으면 섹션 뒤에 [페이지] 마커로 쪼갠 페이지들을 붙인다.
    if (!cfg.pages.length) {
      const section = { itemType: 'section', title: '', subtitle: '', image: '' };
      const txt = inputEl.value;
      if (txt.trim()) {
        const parts = txt.split(/^\s*\[\s*(?:페이지|page)\s*(?::[^\]]*)?\s*\]\s*$/im);
        const pages = parts.map((c) => ({ itemType: 'page', title: '', subtitle: '', content: c.replace(/^\n+|\n+$/g, '') })).filter((p, i) => p.content.trim() || i === 0);
        cfg.pages = [section, ...pages];
      } else {
        cfg.pages = [section, { itemType: 'page', title: '', subtitle: '', content: '' }];
      }
    }
    buildDiaryPagesEditor(pagesEl, cfg);
  }
}

const papaPrevPlaceholder = inputEl.placeholder;   // 비-파파 기본 안내문 보존(복귀용) — applyPapaUi보다 먼저 선언(TDZ 회피)
// ★파파모드 편집기 = 02 설정/커스텀 칸 전체 숨김 + 카드·에셋·서식툴바 숨김 → "큰 01 입력 + 03 미리보기"만.
//   (다른 디자인으로 돌아오면 전부 복구.) body 클래스로도 표시 → 모바일 '설정' 탭 등 CSS가 잡을 수 있게.
function applyPapaUi(on: boolean) {
  document.body.classList.toggle('papa-mode', on);
  const settingsPane = document.querySelector('.pane-settings') as HTMLElement | null;
  if (settingsPane) settingsPane.hidden = on;
  const settingsTab = document.querySelector('#mtabs [data-pane="pane-settings"]') as HTMLElement | null;
  if (settingsTab) settingsTab.hidden = on;
  const cardAsset = document.getElementById('card-asset') as HTMLElement | null;
  if (cardAsset) cardAsset.hidden = on;
  if (editToolbar) editToolbar.hidden = on;   // 서식(B/I/U)·번역·정리 툴바 = 줄글 도구라 통째 HTML엔 무의미
  // 미리보기: 파파 = iframe 대신 블록별 Shadow DOM 컨테이너(리더와 동일 격리 렌더).
  previewEl.hidden = on; papaPreviewEl.hidden = !on;
  inputEl.classList.toggle('papa-input', on);
  inputEl.placeholder = on ? PAPA_PASTE_PLACEHOLDER : papaPrevPlaceholder;
}
const PAPA_PASTE_PLACEHOLDER = '다른 로그제조기·아카 게시글에서 만든 로그를 여기에 붙여넣으세요.\n\n• 리치 복사: 렌더된 로그를 Ctrl+C → 여기에 Ctrl+V (디자인·이미지 그대로)\n• 소스 복사: HTML 소스를 그대로 붙여넣기\n\n살균(안전)만 거쳐 그 디자인 그대로 보관됩니다.';
// ★리치 복사 붙여넣기 핸들러(공용) — 파파 입력칸·블록 칸 둘 다 사용. clipboard의 text/html을 우선(렌더된 디자인·이미지 보존),
//   없으면 text/plain(소스 복사). 텍스트에어리어는 기본적으로 text/html을 못 받으므로 paste를 가로채 직접 주입.
function attachPapaPaste(ta: HTMLTextAreaElement, after?: () => void) {
  ta.addEventListener('paste', (e: ClipboardEvent) => {
    if (settings.template !== 'papa') return;   // 다른 디자인은 기존 평문 붙여넣기 그대로
    const dt = e.clipboardData; if (!dt) return;
    const html = dt.getData('text/html');
    const text = dt.getData('text/plain');
    const payload = (html && html.trim()) ? html : text;
    if (!payload) return;   // 이미지 등 비텍스트는 기본 동작에 맡김
    e.preventDefault();
    const s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, s) + payload + ta.value.slice(en);
    const caret = s + payload.length; ta.setSelectionRange(caret, caret);
    ta.dispatchEvent(new Event('input', { bubbles: true }));   // 미리보기·자동저장 반영
    if (after) after();
    setStatus(html && html.trim() ? '리치 복사(디자인 포함)를 받았어요.' : '소스(HTML)를 받았어요.');
  });
}
attachPapaPaste(inputEl);

// ★파파 블록 에디터: 각 블록 = 독립 붙여넣기 칸(리치/소스). 위/아래/삭제 + 블록 추가. 채팅 메시지 에디터와 같은 골격.
//   블록 내용은 templateConfig('papa').blocks[i].html. 미리보기·리더는 블록마다 Shadow DOM 격리(디자인 안 섞임).
let papaCollapsed: Record<number, boolean> = {};
function buildPapaBlocksEditor(host: HTMLElement, cfg: any) {
  cfg.blocks = Array.isArray(cfg.blocks) && cfg.blocks.length ? cfg.blocks : [{ html: '' }];
  const render2 = () => {
    host.innerHTML = '';
    const hint = document.createElement('div'); hint.className = 'pair-hint';
    hint.textContent = '로그를 블록 단위로 나눠 담습니다. 각 블록에 다른 제조기 로그를 따로 붙여넣으세요(리치 복사 / 소스 복사). 블록마다 디자인이 독립 격리돼 서로 안 섞입니다.';
    host.appendChild(hint);
    cfg.blocks.forEach((b: any, i: number) => {
      const card = document.createElement('div'); card.className = 'page-block';
      const head = document.createElement('div'); head.className = 'page-block-head';
      const chev = document.createElement('button'); chev.type = 'button'; chev.className = 'pb-chev'; chev.textContent = papaCollapsed[i] ? '▸' : '▾';
      const name = document.createElement('span'); name.className = 'pb-name'; name.textContent = `블록 ${i + 1}`;
      const up = document.createElement('button'); up.type = 'button'; up.className = 'pb-btn'; up.textContent = '▲'; up.title = '위로'; up.disabled = i === 0;
      const dn = document.createElement('button'); dn.type = 'button'; dn.className = 'pb-btn'; dn.textContent = '▼'; dn.title = '아래로'; dn.disabled = i === cfg.blocks.length - 1;
      const del = document.createElement('button'); del.type = 'button'; del.className = 'pb-btn pb-del'; del.textContent = '✕'; del.title = '삭제';
      head.append(chev, name, up, dn, del);
      const body = document.createElement('div'); body.className = 'page-block-body'; body.hidden = !!papaCollapsed[i];
      const ta = document.createElement('textarea'); ta.className = 'pb-content papa-input'; ta.placeholder = '이 블록에 로그를 붙여넣으세요 (리치 복사 / 소스 복사)'; ta.value = b.html || '';
      ta.onfocus = () => { activeEditor = ta; };
      let t: any; ta.oninput = () => { b.html = ta.value; clearTimeout(t); t = setTimeout(scheduleRender, 120); };
      attachPapaPaste(ta);   // 블록 칸도 리치 복사(text/html 우선)
      body.appendChild(ta);
      chev.onclick = () => { papaCollapsed[i] = !papaCollapsed[i]; body.hidden = !!papaCollapsed[i]; chev.textContent = papaCollapsed[i] ? '▸' : '▾'; };
      up.onclick = () => { if (i > 0) { const a = cfg.blocks; [a[i - 1], a[i]] = [a[i], a[i - 1]]; papaCollapsed = {}; render2(); scheduleRender(); } };
      dn.onclick = () => { if (i < cfg.blocks.length - 1) { const a = cfg.blocks; [a[i + 1], a[i]] = [a[i], a[i + 1]]; papaCollapsed = {}; render2(); scheduleRender(); } };
      del.onclick = () => { cfg.blocks.splice(i, 1); if (!cfg.blocks.length) cfg.blocks.push({ html: '' }); papaCollapsed = {}; render2(); scheduleRender(); };
      card.append(head, body); host.appendChild(card);
    });
    const addRow = document.createElement('div'); addRow.className = 'page-add-row';
    const addB = document.createElement('button'); addB.type = 'button'; addB.className = 'tag-add'; addB.textContent = '+ 블록 추가';
    addB.onclick = () => { cfg.blocks.push({ html: '' }); render2(); scheduleRender(); };
    addRow.append(addB); host.appendChild(addRow);
  };
  render2();
}
// 파파 '여러 블록으로 나누기' 토글 — 켜면 입력칸 내용을 1블록으로 시드, 끄면 블록을 합쳐 입력칸으로 되돌림(카드 토글과 동일 골격).
(function wirePapaBlocksToggle() {
  const toggle = document.getElementById('papa-blocks-toggle') as HTMLInputElement | null;
  if (!toggle) return;
  toggle.addEventListener('change', () => {
    const cfg = templateConfig('papa');
    if (toggle.checked) {
      if (!Array.isArray(cfg.blocks) || !cfg.blocks.length) cfg.blocks = [{ html: inputEl.value }];
      cfg.useBlocks = true; papaCollapsed = {};
    } else {
      const joined = (Array.isArray(cfg.blocks) ? cfg.blocks : []).map((b: any) => String(b.html || '')).join('\n\n');
      cfg.useBlocks = false; cfg.blocks = [];
      inputEl.value = joined;
    }
    updateInputMode(); scheduleRender();
  });
})();

// 항목 블록 에디터: 페이지(제목·부제·내용)와 섹션(헤더 이미지·섹션제목·부제·구도)을 한 리스트에 섞어 편집.
// 섹션은 '뒤따르는 페이지들'을 한 카드(챕터)로 묶는다(원본 Log Diary 구조). 순서이동/삭제/접기 + 추가.
let diaryCollapsed: Record<number, boolean> = {};
function buildDiaryPagesEditor(host: HTMLElement, cfg: any) {
  cfg.pages = Array.isArray(cfg.pages) && cfg.pages.length ? cfg.pages : [{ itemType: 'page', title: '', subtitle: '', content: '' }];
  const render2 = () => {
    host.innerHTML = '';
    let pno = 0;
    cfg.pages.forEach((pg: any, i: number) => {
      const isSection = pg.itemType === 'section';
      if (!isSection) pno++;
      const myNo = pno;
      const nameText = () => isSection ? ('❖ 섹션' + (pg.title ? ` · ${pg.title}` : '')) : (`페이지 ${myNo}` + (pg.title ? ` · ${pg.title}` : ''));
      const card = document.createElement('div'); card.className = 'page-block' + (isSection ? ' section-block' : '');
      if (isSection) card.style.borderLeft = '3px solid #c98a5a';
      const head = document.createElement('div'); head.className = 'page-block-head';
      const chev = document.createElement('button'); chev.type = 'button'; chev.className = 'pb-chev'; chev.textContent = diaryCollapsed[i] ? '▸' : '▾';
      const name = document.createElement('span'); name.className = 'pb-name'; name.textContent = nameText();
      const up = document.createElement('button'); up.type = 'button'; up.className = 'pb-btn'; up.textContent = '▲'; up.title = '위로'; up.disabled = i === 0;
      const dn = document.createElement('button'); dn.type = 'button'; dn.className = 'pb-btn'; dn.textContent = '▼'; dn.title = '아래로'; dn.disabled = i === cfg.pages.length - 1;
      const del = document.createElement('button'); del.type = 'button'; del.className = 'pb-btn pb-del'; del.textContent = '✕'; del.title = '삭제';
      head.append(chev, name, up, dn, del);
      const body = document.createElement('div'); body.className = 'page-block-body'; body.hidden = !!diaryCollapsed[i];
      const mkText = (ph: string, key: string) => {
        const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'pb-text'; inp.placeholder = ph; inp.value = pg[key] || '';
        inp.oninput = () => { pg[key] = inp.value; name.textContent = nameText(); scheduleRender(); };
        return inp;
      };
      if (isSection) {
        // 섹션: 챕터 구분 띠. 헤더 이미지 + 섹션 제목/부제(띠에 구워짐) + 구도 노브.
        const imgCtl = buildControl({ label: '헤더 이미지', type: 'image', get: () => pg.image || '', set: (v) => { pg.image = v; render2(); } });
        body.append(mkText('섹션 제목 (예: Story)', 'title'), mkText('섹션 부제 (예: Chapter 1)', 'subtitle'), imgCtl.wrap);
        if (pg.image) {
          const focusYCtl = buildControl({ label: '띠 세로 위치', type: 'range', min: 0, max: 100, step: 5, suffix: '%', get: () => pg.bandFocusY != null ? pg.bandFocusY : 50, set: (v) => { pg.bandFocusY = +v; } });
          const zoomCtl = buildControl({ label: '띠 확대', type: 'range', min: 100, max: 250, step: 10, suffix: '%', get: () => pg.bandZoom != null ? pg.bandZoom : 100, set: (v) => { pg.bandZoom = +v; } });
          const fontCtl = buildControl({ label: '띠 글씨 크기', type: 'range', min: 80, max: 250, step: 10, suffix: '%', get: () => Math.round((pg.bandTextScale != null ? pg.bandTextScale : 1.5) * 100), set: (v) => { pg.bandTextScale = (+v) / 100; } });
          const bhint = document.createElement('div'); bhint.className = 'pair-hint';
          bhint.textContent = '섹션 제목·부제가 이 이미지 위에 구워집니다(아카 호환). 세로 위치 0=위쪽·50=가운데·100=아래쪽 / 확대로 클로즈업 / 글씨 크기는 표지와 따로 조절(이 섹션만).';
          body.append(focusYCtl.wrap, zoomCtl.wrap, fontCtl.wrap, bhint);
        } else {
          const nhint = document.createElement('div'); nhint.className = 'pair-hint';
          nhint.textContent = '이미지를 넣으면 챕터 표지 띠로 구워집니다(섹션 제목/부제 포함). 이미지 없이 제목만 넣으면 가운데 텍스트 구분선으로 표시됩니다.';
          body.append(nhint);
        }
      } else {
        // 페이지: 텍스트 헤더(번호·제목·부제) + 내용.
        const ta = document.createElement('textarea'); ta.className = 'pb-content'; ta.placeholder = '이 페이지 내용 (대사 "큰따옴표", 속마음 \'작은따옴표\')'; ta.value = pg.content || '';
        head.insertBefore(makeEnlargeBtn(ta, () => nameText()), up);
        ta.onfocus = () => { activeEditor = ta; }; // 에셋 트레이 삽입 대상 = 이 페이지
        let t: any; ta.oninput = () => { pg.content = ta.value; clearTimeout(t); t = setTimeout(scheduleRender, 120); };
        body.append(mkText('페이지 제목(선택)', 'title'), mkText('페이지 부제(선택)', 'subtitle'), ta);
      }
      chev.onclick = () => { diaryCollapsed[i] = !diaryCollapsed[i]; body.hidden = !!diaryCollapsed[i]; chev.textContent = diaryCollapsed[i] ? '▸' : '▾'; };
      up.onclick = () => { if (i > 0) { const a = cfg.pages; [a[i - 1], a[i]] = [a[i], a[i - 1]]; diaryCollapsed = {}; render2(); scheduleRender(); } };
      dn.onclick = () => { if (i < cfg.pages.length - 1) { const a = cfg.pages; [a[i + 1], a[i]] = [a[i], a[i + 1]]; diaryCollapsed = {}; render2(); scheduleRender(); } };
      del.onclick = () => { cfg.pages.splice(i, 1); if (!cfg.pages.length) cfg.pages.push({ itemType: 'page', title: '', subtitle: '', content: '' }); diaryCollapsed = {}; render2(); scheduleRender(); };
      card.append(head, body); host.appendChild(card);
    });
    const addRow = document.createElement('div'); addRow.className = 'page-add-row';
    const addP = document.createElement('button'); addP.type = 'button'; addP.className = 'tag-add'; addP.textContent = '+ 페이지 추가';
    addP.onclick = () => { cfg.pages.push({ itemType: 'page', title: '', subtitle: '', content: '' }); render2(); scheduleRender(); };
    const addS = document.createElement('button'); addS.type = 'button'; addS.className = 'tag-add'; addS.textContent = '+ 섹션(챕터) 추가';
    addS.onclick = () => { cfg.pages.push({ itemType: 'section', title: '', subtitle: '', image: '' }); render2(); scheduleRender(); };
    addRow.append(addP, addS); host.appendChild(addRow);
  };
  render2();
}

// 기본 카드 다중 블록 에디터(다이어리보다 단순: 제목·부제·내용 + 출력 접기 + 순서/삭제/추가).
let cardCollapsed: Record<number, boolean> = {};
function buildCardBlocksEditor(host: HTMLElement, cfg: any) {
  cfg.blocks = Array.isArray(cfg.blocks) && cfg.blocks.length ? cfg.blocks : [{ title: '', subtitle: '', content: '' }];
  const render2 = () => {
    host.innerHTML = '';
    // 역할 블록이 있으면 헤더 라벨(유저/캐릭터 이름) · 번호 표시 옵션을 상단에.
    if (cfg.blocks.some((b: any) => b && b.role)) {
      const opt = document.createElement('div'); opt.className = 'cardblk-roleopts';
      const mkLbl = (label: string, key: string, ph: string) => {
        const w = document.createElement('label'); w.className = 'pb-role-row'; const s = document.createElement('span'); s.textContent = label;
        const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'pb-text'; inp.placeholder = ph; inp.value = cfg[key] != null ? cfg[key] : ''; inp.disabled = !!cfg.numbered;
        inp.oninput = () => { cfg[key] = inp.value; scheduleRender(); };
        w.append(s, inp); return w;
      };
      const nWrap = document.createElement('label'); nWrap.className = 'pb-collapse';
      const nCb = document.createElement('input'); nCb.type = 'checkbox'; nCb.checked = !!cfg.numbered;
      nCb.onchange = () => { cfg.numbered = nCb.checked; render2(); scheduleRender(); };
      nWrap.append(nCb, document.createTextNode(' 이름 대신 번호로 표시 (1,2,3 …)'));
      opt.append(mkLbl('유저 이름', 'userLabel', '나'), mkLbl('캐릭터 이름', 'charLabel', settings.profile.botName || '상대'), nWrap);
      host.appendChild(opt);
    }
    cfg.blocks.forEach((bl: any, i: number) => {
      const roleText = () => bl.role === 'user' ? '유저' : bl.role === 'char' ? '캐릭터' : '';
      const nameText = () => `블록 ${i + 1}` + (roleText() ? ` · ${roleText()}` : '') + (bl.title ? ` · ${bl.title}` : '');
      const card = document.createElement('div'); card.className = 'page-block' + (bl.role ? ' role-' + bl.role : '');
      const head = document.createElement('div'); head.className = 'page-block-head';
      const chev = document.createElement('button'); chev.type = 'button'; chev.className = 'pb-chev'; chev.textContent = cardCollapsed[i] ? '▸' : '▾';
      const name = document.createElement('span'); name.className = 'pb-name'; name.textContent = nameText();
      const up = document.createElement('button'); up.type = 'button'; up.className = 'pb-btn'; up.textContent = '▲'; up.title = '위로'; up.disabled = i === 0;
      const dn = document.createElement('button'); dn.type = 'button'; dn.className = 'pb-btn'; dn.textContent = '▼'; dn.title = '아래로'; dn.disabled = i === cfg.blocks.length - 1;
      const del = document.createElement('button'); del.type = 'button'; del.className = 'pb-btn pb-del'; del.textContent = '✕'; del.title = '삭제';
      head.append(chev, name, up, dn, del);
      const body = document.createElement('div'); body.className = 'page-block-body'; body.hidden = !!cardCollapsed[i];
      const mkText = (ph: string, key: string) => {
        const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'pb-text'; inp.placeholder = ph; inp.value = bl[key] || '';
        inp.oninput = () => { bl[key] = inp.value; name.textContent = nameText(); scheduleRender(); };
        return inp;
      };
      const ta = document.createElement('textarea'); ta.className = 'pb-content'; ta.placeholder = '이 블록 내용 (대사 "큰따옴표", 속마음 \'작은따옴표\')'; ta.value = bl.content || '';
      head.insertBefore(makeEnlargeBtn(ta, () => nameText()), up);
      ta.onfocus = () => { activeEditor = ta; }; // 에셋 트레이 삽입 대상 = 이 블록
      let t: any; ta.oninput = () => { bl.content = ta.value; clearTimeout(t); t = setTimeout(scheduleRender, 120); };
      // 역할(유저/캐릭터) — 2색 전사용. 바꾸면 박스색·라벨 즉시 반영.
      const roleRow = document.createElement('label'); roleRow.className = 'pb-role-row';
      const rlab = document.createElement('span'); rlab.textContent = '역할';
      const roleSel = document.createElement('select'); roleSel.className = 'pb-role';
      ([['', '없음'], ['user', '유저'], ['char', '캐릭터']] as const).forEach(([v, t2]) => { const o = document.createElement('option'); o.value = v; o.textContent = t2; roleSel.appendChild(o); });
      roleSel.value = bl.role || '';
      roleSel.onchange = () => { bl.role = roleSel.value || undefined; render2(); scheduleRender(); };
      roleRow.append(rlab, roleSel);
      body.append(roleRow, mkText('블록 제목(선택)', 'title'), mkText('블록 부제(선택)', 'subtitle'), ta);
      chev.onclick = () => { cardCollapsed[i] = !cardCollapsed[i]; body.hidden = !!cardCollapsed[i]; chev.textContent = cardCollapsed[i] ? '▸' : '▾'; };
      up.onclick = () => { if (i > 0) { const a = cfg.blocks; [a[i - 1], a[i]] = [a[i], a[i - 1]]; cardCollapsed = {}; render2(); scheduleRender(); } };
      dn.onclick = () => { if (i < cfg.blocks.length - 1) { const a = cfg.blocks; [a[i + 1], a[i]] = [a[i], a[i + 1]]; cardCollapsed = {}; render2(); scheduleRender(); } };
      del.onclick = () => { cfg.blocks.splice(i, 1); if (!cfg.blocks.length) cfg.blocks.push({ title: '', subtitle: '', content: '' }); cardCollapsed = {}; render2(); scheduleRender(); };
      card.append(head, body); host.appendChild(card);
    });
    const addRow = document.createElement('div'); addRow.className = 'page-add-row';
    const addB = document.createElement('button'); addB.type = 'button'; addB.className = 'tag-add'; addB.textContent = '+ 블록 추가';
    addB.onclick = () => { cfg.blocks.push({ title: '', subtitle: '', content: '' }); render2(); scheduleRender(); };
    addRow.append(addB); host.appendChild(addRow);
  };
  render2();
}

// 채팅형 메시지 편집기: 메시지마다 역할(유저/캐릭터) + 텍스트 + 순서이동/삭제. (왼쪽 입력 영역)
let chatCollapsed: Record<number, boolean> = {};
function buildChatEditor(host: HTMLElement, cfg: any) {
  cfg.messages = Array.isArray(cfg.messages) && cfg.messages.length ? cfg.messages : [{ role: 'user', text: '' }];
  const render2 = () => {
    host.innerHTML = '';
    const hint = document.createElement('div'); hint.className = 'pair-hint';
    hint.textContent = '대화를 메시지 단위로 편집합니다. 각 메시지의 역할(유저/캐릭터)을 정하면 말풍선 좌우·색이 갈립니다. 말풍선 색·아바타·이름표는 오른쪽 “채팅 설정”에서.';
    host.appendChild(hint);
    cfg.messages.forEach((m: any, i: number) => {
      const role = m.role === 'user' ? 'user' : 'char';
      const card = document.createElement('div'); card.className = 'page-block role-' + role;
      const head = document.createElement('div'); head.className = 'page-block-head';
      const chev = document.createElement('button'); chev.type = 'button'; chev.className = 'pb-chev'; chev.textContent = chatCollapsed[i] ? '▸' : '▾';
      // 역할 선택(헤더에 인라인)
      const roleSel = document.createElement('select'); roleSel.className = 'pb-role';
      ([['user', '유저'], ['char', '캐릭터']] as const).forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; roleSel.appendChild(o); });
      roleSel.value = role;
      roleSel.onchange = () => { m.role = roleSel.value; card.className = 'page-block role-' + (roleSel.value === 'user' ? 'user' : 'char'); scheduleRender(); };
      const name = document.createElement('span'); name.className = 'pb-name'; name.textContent = `메시지 ${i + 1}`;
      const up = document.createElement('button'); up.type = 'button'; up.className = 'pb-btn'; up.textContent = '▲'; up.title = '위로'; up.disabled = i === 0;
      const dn = document.createElement('button'); dn.type = 'button'; dn.className = 'pb-btn'; dn.textContent = '▼'; dn.title = '아래로'; dn.disabled = i === cfg.messages.length - 1;
      const del = document.createElement('button'); del.type = 'button'; del.className = 'pb-btn pb-del'; del.textContent = '✕'; del.title = '삭제';
      head.append(chev, roleSel, name, up, dn, del);
      const body = document.createElement('div'); body.className = 'page-block-body'; body.hidden = !!chatCollapsed[i];
      const ta = document.createElement('textarea'); ta.className = 'pb-content'; ta.placeholder = '이 메시지 내용 (대사 "큰따옴표", 속마음 \'작은따옴표\')'; ta.value = m.text || '';
      head.insertBefore(makeEnlargeBtn(ta, () => name.textContent || '메시지'), up);
      ta.onfocus = () => { activeEditor = ta; };
      let t: any; ta.oninput = () => { m.text = ta.value; clearTimeout(t); t = setTimeout(scheduleRender, 120); };
      body.appendChild(ta);
      chev.onclick = () => { chatCollapsed[i] = !chatCollapsed[i]; body.hidden = !!chatCollapsed[i]; chev.textContent = chatCollapsed[i] ? '▸' : '▾'; };
      up.onclick = () => { if (i > 0) { const a = cfg.messages; [a[i - 1], a[i]] = [a[i], a[i - 1]]; chatCollapsed = {}; render2(); scheduleRender(); } };
      dn.onclick = () => { if (i < cfg.messages.length - 1) { const a = cfg.messages; [a[i + 1], a[i]] = [a[i], a[i + 1]]; chatCollapsed = {}; render2(); scheduleRender(); } };
      del.onclick = () => { cfg.messages.splice(i, 1); if (!cfg.messages.length) cfg.messages.push({ role: 'user', text: '' }); chatCollapsed = {}; render2(); scheduleRender(); };
      card.append(head, body); host.appendChild(card);
    });
    const addRow = document.createElement('div'); addRow.className = 'page-add-row';
    const addU = document.createElement('button'); addU.type = 'button'; addU.className = 'tag-add'; addU.textContent = '+ 유저 메시지';
    addU.onclick = () => { cfg.messages.push({ role: 'user', text: '' }); render2(); scheduleRender(); };
    const addC = document.createElement('button'); addC.type = 'button'; addC.className = 'tag-add'; addC.textContent = '+ 캐릭터 메시지';
    addC.onclick = () => { cfg.messages.push({ role: 'char', text: '' }); render2(); scheduleRender(); };
    addRow.append(addU, addC); host.appendChild(addRow);
  };
  render2();
}

// 채팅형 설정 패널(오른쪽): 정렬·이름·아바타·이름표/아바타 토글·말풍선 색·둥글기.
function buildChatPanel(host: HTMLElement) {
  host.innerHTML = '';
  const def: any = TEMPLATE_DEFS['chat'];
  const cfg = templateConfig('chat');
  const desc = document.createElement('div'); desc.className = 'pair-hint';
  desc.textContent = def.description;
  host.appendChild(desc);
  // 정렬: 값=id, 표시=라벨 → 직접 select
  const alignWrap = document.createElement('div'); alignWrap.className = 'ctl inline';
  alignWrap.appendChild(Object.assign(document.createElement('label'), { textContent: '정렬' }));
  const alignSel = document.createElement('select');
  ([['lr', '유저 오른쪽 · 캐릭터 왼쪽'], ['left', '둘 다 왼쪽 (디코식)']] as const).forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; alignSel.appendChild(o); });
  alignSel.value = cfg.align || 'lr';
  alignSel.onchange = () => { cfg.align = alignSel.value; scheduleRender(); };
  alignWrap.appendChild(alignSel); host.appendChild(alignWrap);
  const ctls: Ctl[] = [
    { label: '유저 표시 이름', type: 'text', placeholder: '나', get: () => cfg.userName != null ? cfg.userName : '나', set: (v) => cfg.userName = v },
    { label: '캐릭터 표시 이름', type: 'text', placeholder: settings.profile.botName || '상대', get: () => cfg.charName || '', set: (v) => cfg.charName = v },
    { label: '이름표 표시', type: 'check', get: () => cfg.showName !== false, set: (v) => cfg.showName = v },
    { label: '아바타 표시', type: 'check', get: () => cfg.showAvatar !== false, set: (v) => cfg.showAvatar = v },
    { label: '유저 아바타', type: 'image', get: () => cfg.userAvatar || '', set: (v) => cfg.userAvatar = v, when: () => cfg.showAvatar !== false },
    { label: '캐릭터 아바타', type: 'image', get: () => cfg.charAvatar || '', set: (v) => cfg.charAvatar = v, when: () => cfg.showAvatar !== false },
    { label: '유저 말풍선 배경', type: 'color', get: () => cfg.userColor || '#ffe2c2', set: (v) => cfg.userColor = v },
    { label: '유저 글자색', type: 'color', get: () => cfg.userTextColor || '#2b2b2b', set: (v) => cfg.userTextColor = v },
    { label: '캐릭터 말풍선 배경', type: 'color', get: () => cfg.charColor || '#eef0f4', set: (v) => cfg.charColor = v },
    { label: '캐릭터 글자색', type: 'color', get: () => cfg.charTextColor || '#2b2b2b', set: (v) => cfg.charTextColor = v },
    { label: '말풍선 둥글기', type: 'range', min: 0, max: 30, step: 1, suffix: 'px', get: () => cfg.radius != null ? cfg.radius : 18, set: (v) => cfg.radius = +v },
  ];
  for (const c of ctls) { const b = buildControl(c); built.push(b); host.appendChild(b.wrap); }
  const tip = document.createElement('div'); tip.className = 'pair-hint';
  tip.textContent = '대화 내용(메시지)은 왼쪽 입력 영역에서 편집합니다. 아바타는 정사각/원형으로 잘려 들어갑니다(아카 호환).';
  host.appendChild(tip);
}

// 웹소설형 설정 패널: 색을 안 굽고 "강조"만(테마안전·currentColor 기반). 대사강조/속마음/줄바꿈/들여쓰기/문단간격.
function buildWebnovelPanel(host: HTMLElement) {
  host.innerHTML = '';
  const def: any = TEMPLATE_DEFS['webnovel'];
  const cfg = templateConfig('webnovel');
  const desc = document.createElement('div'); desc.className = 'pair-hint';
  desc.textContent = def.description;
  host.appendChild(desc);
  // 장(章)으로 나누기 토글 — 켜면 입력란을 챕터 블록 에디터로(왼쪽), 끄면 합쳐서 줄글로.
  const blkRow = document.createElement('label'); blkRow.className = 'ctl inline';
  const blkCb = document.createElement('input'); blkCb.type = 'checkbox'; blkCb.checked = !!cfg.useBlocks;
  blkCb.onchange = () => {
    if (blkCb.checked) {
      cfg.useBlocks = true;
      if (!Array.isArray(cfg.blocks) || !cfg.blocks.length) {
        const txt = inputEl.value.trim();
        cfg.blocks = [{ title: '', content: txt ? inputEl.value : '' }];
      }
      wnCollapsed = {};
    } else {
      cfg.useBlocks = false;
      const joined = (Array.isArray(cfg.blocks) ? cfg.blocks : []).map((b: any) => String(b.content || '')).join('\n\n');
      cfg.blocks = [];
      inputEl.value = joined;
    }
    updateInputMode(); scheduleRender();
  };
  blkRow.append(blkCb, document.createTextNode(' 장(章)으로 나누기 — 챕터 제목 + 구분선'));
  host.appendChild(blkRow);
  // 장면 구분 기호 — 제목 없는 장들 "사이"에 ※ ※ ※. 장 나누기 모드에서만 효과(자동 분할 소설=기본 켜짐).
  const sbRow = document.createElement('label'); sbRow.className = 'ctl inline';
  const sbCb = document.createElement('input'); sbCb.type = 'checkbox'; sbCb.checked = cfg.sceneBreak !== false;   // 기본 켜짐(미설정=ON)
  sbCb.onchange = () => { cfg.sceneBreak = sbCb.checked; scheduleRender(); };
  sbRow.append(sbCb, document.createTextNode(' 장면 구분 기호 (※ ※ ※) — 제목 없는 장 사이'));
  host.appendChild(sbRow);
  // 테마: 배경+글자색을 출력에 구움 → 미리보기·서재 리더·리치 복사에 그대로 적용(작업 7·8).
  const thWrap = document.createElement('div'); thWrap.className = 'ctl inline';
  thWrap.appendChild(Object.assign(document.createElement('label'), { textContent: '테마' }));
  const thSel = document.createElement('select');
  ([['light', '종이'], ['sepia', '세피아'], ['dark', '다크'], ['black', 'night']] as const)
    .forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; thSel.appendChild(o); });
  thSel.value = cfg.theme || 'sepia';
  thSel.onchange = () => { cfg.theme = thSel.value; scheduleRender(); };
  thWrap.appendChild(thSel); host.appendChild(thWrap);
  // 대사 강조: 값=id → 직접 select(고정색 안 씀, 리더 글자색을 따라가는 효과만).
  const emWrap = document.createElement('div'); emWrap.className = 'ctl inline';
  emWrap.appendChild(Object.assign(document.createElement('label'), { textContent: '대사 강조' }));
  const emSel = document.createElement('select');
  ([['none', '없음 (따옴표만)'], ['bold', '굵게'], ['underline', '밑줄'], ['marker', '형광펜 (반투명)']] as const)
    .forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; emSel.appendChild(o); });
  emSel.value = cfg.dialogEmphasis || 'none';
  emSel.onchange = () => { cfg.dialogEmphasis = emSel.value; scheduleRender(); };
  emWrap.appendChild(emSel); host.appendChild(emWrap);
  const ctls: Ctl[] = [
    { label: '속마음 기울임 (이탤릭)', type: 'check', get: () => cfg.innerItalic !== false, set: (v) => cfg.innerItalic = v },
    { label: '대사 줄바꿈 (새 줄로)', type: 'check', get: () => !!cfg.dialogNewline, set: (v) => cfg.dialogNewline = v },
    { label: '별표 강조 (*기울임* · **굵게**)', type: 'check', get: () => cfg.asteriskEmphasis !== false, set: (v) => cfg.asteriskEmphasis = v },
    { label: '첫 줄 들여쓰기', type: 'range', min: 0, max: 60, step: 2, suffix: 'px', get: () => +cfg.textIndent || 0, set: (v) => cfg.textIndent = +v },
    { label: '문단 간격', type: 'range', min: 0.4, max: 3, step: 0.1, suffix: 'rem', get: () => cfg.paraGap != null ? +cfg.paraGap : 1.5, set: (v) => cfg.paraGap = +v },
  ];
  for (const c of ctls) { const b = buildControl(c); built.push(b); host.appendChild(b.wrap); }
  const tip = document.createElement('div'); tip.className = 'pair-hint';
  tip.textContent = '본문 글은 왼쪽 입력 영역에 씁니다. 위 ‘테마’가 미리보기·서재 리더·리치 복사에 그대로 적용됩니다. 폰트·글자 크기·행간은 서재 리더에서 더 조절할 수 있어요.';
  host.appendChild(tip);
}

// 웹소설형 장(章) 블록 편집기: 블록마다 챕터 제목(선택) + 본문 + 순서이동/삭제/접기. (왼쪽 입력 영역)
let wnCollapsed: Record<number, boolean> = {};
function buildWebnovelBlocksEditor(host: HTMLElement, cfg: any) {
  cfg.blocks = Array.isArray(cfg.blocks) && cfg.blocks.length ? cfg.blocks : [{ title: '', content: '' }];
  const render2 = () => {
    host.innerHTML = '';
    const hint = document.createElement('div'); hint.className = 'pair-hint';
    hint.textContent = '장(章)으로 나눠 씁니다. 각 장의 제목을 넣으면 본문 위에 가운데 챕터 구분선이 들어갑니다. ‘장면 구분 기호’를 켜면 제목 없는 장들 사이에 ※ ※ ※가 들어갑니다(맨 앞 장 앞에는 안 들어감).';
    host.appendChild(hint);
    cfg.blocks.forEach((bl: any, i: number) => {
      const nameText = () => `${i + 1}장` + (bl.title ? ` · ${bl.title}` : '');
      const card = document.createElement('div'); card.className = 'page-block';
      const head = document.createElement('div'); head.className = 'page-block-head';
      const chev = document.createElement('button'); chev.type = 'button'; chev.className = 'pb-chev'; chev.textContent = wnCollapsed[i] ? '▸' : '▾';
      const name = document.createElement('span'); name.className = 'pb-name'; name.textContent = nameText();
      const up = document.createElement('button'); up.type = 'button'; up.className = 'pb-btn'; up.textContent = '▲'; up.title = '위로'; up.disabled = i === 0;
      const dn = document.createElement('button'); dn.type = 'button'; dn.className = 'pb-btn'; dn.textContent = '▼'; dn.title = '아래로'; dn.disabled = i === cfg.blocks.length - 1;
      const del = document.createElement('button'); del.type = 'button'; del.className = 'pb-btn pb-del'; del.textContent = '✕'; del.title = '삭제';
      head.append(chev, name, up, dn, del);
      const body = document.createElement('div'); body.className = 'page-block-body'; body.hidden = !!wnCollapsed[i];
      const titleInp = document.createElement('input'); titleInp.type = 'text'; titleInp.className = 'pb-text'; titleInp.placeholder = '챕터 제목 (선택 — 비우면 장면으로 이어짐)'; titleInp.value = bl.title || '';
      titleInp.oninput = () => { bl.title = titleInp.value; name.textContent = nameText(); scheduleRender(); };
      const ta = document.createElement('textarea'); ta.className = 'pb-content'; ta.placeholder = '이 장 본문 (대사 "큰따옴표", 속마음 \'작은따옴표\')'; ta.value = bl.content || '';
      head.insertBefore(makeEnlargeBtn(ta, () => nameText()), up);
      ta.onfocus = () => { activeEditor = ta; }; // 에셋 트레이 삽입 대상 = 이 블록
      let t: any; ta.oninput = () => { bl.content = ta.value; clearTimeout(t); t = setTimeout(scheduleRender, 120); };
      body.append(titleInp, ta);
      chev.onclick = () => { wnCollapsed[i] = !wnCollapsed[i]; body.hidden = !!wnCollapsed[i]; chev.textContent = wnCollapsed[i] ? '▸' : '▾'; };
      up.onclick = () => { if (i > 0) { const a = cfg.blocks; [a[i - 1], a[i]] = [a[i], a[i - 1]]; wnCollapsed = {}; render2(); scheduleRender(); } };
      dn.onclick = () => { if (i < cfg.blocks.length - 1) { const a = cfg.blocks; [a[i + 1], a[i]] = [a[i], a[i + 1]]; wnCollapsed = {}; render2(); scheduleRender(); } };
      del.onclick = () => { cfg.blocks.splice(i, 1); if (!cfg.blocks.length) cfg.blocks.push({ title: '', content: '' }); wnCollapsed = {}; render2(); scheduleRender(); };
      card.append(head, body); host.appendChild(card);
    });
    const addRow = document.createElement('div'); addRow.className = 'page-add-row';
    const addB = document.createElement('button'); addB.type = 'button'; addB.className = 'tag-add'; addB.textContent = '+ 장(章) 추가';
    addB.onclick = () => { cfg.blocks.push({ title: '', content: '' }); render2(); scheduleRender(); };
    addRow.append(addB); host.appendChild(addRow);
  };
  render2();
}

// 다중 블록 토글: 켜면 입력란 내용을 1블록으로 시드, 끄면 블록을 합쳐 입력란으로 되돌림.
(function wireCardBlocksToggle() {
  const toggle = document.getElementById('card-blocks-toggle') as HTMLInputElement | null;
  if (!toggle) return;
  toggle.addEventListener('change', () => {
    const cfg = templateConfig('card');
    if (toggle.checked) {
      if (!Array.isArray(cfg.blocks) || !cfg.blocks.length) cfg.blocks = [{ title: '', subtitle: '', content: inputEl.value }];
      cardCollapsed = {};
    } else {
      const joined = (Array.isArray(cfg.blocks) ? cfg.blocks : []).map((b: any) => String(b.content || '')).join('\n\n');
      cfg.blocks = [];
      inputEl.value = joined;
    }
    updateInputMode(); scheduleRender();
  });
  const collapseToggle = document.getElementById('card-collapse-toggle') as HTMLInputElement | null;
  if (collapseToggle) collapseToggle.addEventListener('change', () => {
    templateConfig('card').collapseAll = collapseToggle.checked; scheduleRender();
  });
})();

// ---------- 설정 컨트롤 (섹션 기반 + 조건부 노출) ----------
type Ctl = {
  label: string; type: 'text' | 'color' | 'range' | 'select' | 'check' | 'image';
  get: () => any; set: (v: any) => void;
  min?: number; max?: number; step?: number; opts?: string[]; suffix?: string; placeholder?: string;
  insertBtn?: string;   // (text 전용) 커서 위치에 이 문자열을 넣는 보조 버튼 표시(예: 구분자 '|')
  when?: () => boolean;
};
type PairConf = { arrKey: string; aKey: string; aLabel: string; aPh: string; bKey: string; bLabel: string; bPh: string; newItem: () => any; hint?: string };
type Section = { title: string; open?: boolean; controls?: Ctl[]; tags?: boolean; pair?: PairConf; quick?: boolean; library?: boolean; customSkin?: boolean; panel?: (host: HTMLElement) => void; when?: () => boolean };

const SECTIONS: Section[] = [
  { title: 'Pro1 가져오기', open: false, panel: buildPro1Panel },   // 기본카드 전용(card만 전체 SECTIONS 사용 → 다른 디자인엔 안 보임)
  { title: '내 프리셋', open: true, library: true },
  { title: '빠른 테마', open: true, quick: true },
  {
    title: '프로필', open: true, controls: [
      { label: '프로필 표시', type: 'check', get: () => P.showProfile, set: (v) => P.showProfile = v },
      { label: '봇 이름', type: 'text', get: () => P.botName, set: (v) => P.botName = v, when: () => P.showProfile },
      { label: '봇이름 표시', type: 'check', get: () => P.showBotName, set: (v) => P.showBotName = v, when: () => P.showProfile },
      { label: '봇이름 색', type: 'color', get: () => P.botNameColor, set: (v) => P.botNameColor = v, when: () => P.showProfile && P.showBotName },
      { label: '프로필 이미지', type: 'check', get: () => P.showProfileImage, set: (v) => P.showProfileImage = v, when: () => P.showProfile },
      { label: '프로필 모양', type: 'select', opts: ['배너', '동그라미', '직사각형'], get: () => P.frameStyle, set: (v) => P.frameStyle = v, when: () => P.showProfile && P.showProfileImage },
      { label: '너비', type: 'range', min: 20, max: 300, step: 1, suffix: 'px', get: () => P.width, set: (v) => P.width = +v, when: () => P.showProfile && P.showProfileImage && P.frameStyle !== '배너' },
      { label: '높이', type: 'range', min: 20, max: 300, step: 1, suffix: 'px', get: () => P.height, set: (v) => P.height = +v, when: () => P.showProfile && P.showProfileImage && P.frameStyle === '직사각형' },
      { label: '프로필 사진', type: 'image', get: () => P.imageUrl || '', set: (v) => { P.imageUrl = (v === '' && cardIconUrl) ? cardIconUrl : v; }, when: () => P.showProfile && P.showProfileImage },
      { label: '프로필 테두리', type: 'check', get: () => P.showProfileBorder, set: (v) => P.showProfileBorder = v, when: () => P.showProfile && P.showProfileImage },
      { label: '테두리 색', type: 'color', get: () => P.profileBorderColor, set: (v) => P.profileBorderColor = v, when: () => P.showProfile && P.showProfileImage && P.showProfileBorder },
      { label: '프로필 그림자', type: 'check', get: () => P.showProfileShadow, set: (v) => P.showProfileShadow = v, when: () => P.showProfile && P.showProfileImage },
      { label: '태그 표시', type: 'check', get: () => P.showTags, set: (v) => P.showTags = v, when: () => P.showProfile },
      { label: '구분선 표시', type: 'check', get: () => P.showDivider, set: (v) => P.showDivider = v, when: () => P.showProfile },
    ],
  },
  {
    title: '박스', controls: [
      { label: '외부 박스 사용', type: 'check', get: () => B.showInnerBox, set: (v) => B.showInnerBox = v },
      { label: '외부 박스 색', type: 'color', get: () => B.outerBoxColor, set: (v) => B.outerBoxColor = v, when: () => B.showInnerBox },
      { label: '카드 배경색', type: 'color', get: () => B.innerBoxColor, set: (v) => B.innerBoxColor = v },
      { label: '박스 최대 너비', type: 'range', min: 300, max: 1200, step: 10, suffix: 'px', get: () => B.maxWidth, set: (v) => B.maxWidth = +v },
      { label: '그림자 강도', type: 'range', min: 0, max: 40, step: 1, suffix: 'px', get: () => B.shadowIntensity, set: (v) => B.shadowIntensity = +v },
      { label: '박스 테두리', type: 'check', get: () => B.useBoxBorder, set: (v) => B.useBoxBorder = v },
      { label: '테두리 색', type: 'color', get: () => B.boxBorderColor, set: (v) => B.boxBorderColor = v, when: () => B.useBoxBorder },
      { label: '테두리 굵기', type: 'range', min: 1, max: 8, step: 1, suffix: 'px', get: () => B.boxBorderThickness, set: (v) => B.boxBorderThickness = +v, when: () => B.useBoxBorder },
    ],
  },
  {
    title: '구분선', when: () => P.showProfile && P.showDivider, controls: [
      { label: '스타일', type: 'select', opts: ['그라데이션', '단색'], get: () => D.style, set: (v) => D.style = v },
      { label: '굵기', type: 'range', min: 1, max: 4, step: 1, suffix: 'px', get: () => D.thickness, set: (v) => D.thickness = +v },
      { label: '바깥 색', type: 'color', get: () => D.outerColor, set: (v) => D.outerColor = v, when: () => D.style === '그라데이션' },
      { label: '안쪽 색', type: 'color', get: () => D.innerColor, set: (v) => D.innerColor = v, when: () => D.style === '그라데이션' },
      { label: '선 색', type: 'color', get: () => D.solidColor, set: (v) => D.solidColor = v, when: () => D.style === '단색' },
    ],
  },
  {
    title: '텍스트', controls: [
      // 폰트(시스템 기본 + 명조/고딕 + 커스텀). '시스템 기본' = 미선택 → 출력 그대로(골든 패리티). 커스텀은 내 화면·미리보기·서재용(아카엔 안 따라감).
      { label: '폰트', type: 'select', opts: ['시스템 기본', ...DIARY_FONT_LIST, ...getFontList().map((f) => f.family)], get: () => (templateConfig('card').font || '시스템 기본'), set: (v) => { templateConfig('card').font = (v === '시스템 기본' ? '' : v); } },
      { label: '들여쓰기 사용', type: 'check', get: () => T.useTextIndent, set: (v) => T.useTextIndent = v },
      { label: '들여쓰기 크기', type: 'range', min: 0, max: 100, step: 1, suffix: 'px', get: () => T.textIndent, set: (v) => T.textIndent = +v, when: () => T.useTextIndent },
      { label: '글자 크기 조절', type: 'check', get: () => T.useTextSize, set: (v) => T.useTextSize = v },
      { label: '글자 크기', type: 'range', min: 8, max: 24, step: 1, suffix: 'px', get: () => T.textSize, set: (v) => T.textSize = +v, when: () => T.useTextSize },
      { label: '대사 색', type: 'color', get: () => T.dialogColor, set: (v) => T.dialogColor = v },
      { label: '대사 굵게', type: 'check', get: () => T.dialogBold, set: (v) => T.dialogBold = v },
      { label: '대사 줄바꿈', type: 'check', get: () => T.dialogNewline, set: (v) => T.dialogNewline = v },
      { label: '속마음 색', type: 'color', get: () => T.innerThoughtsColor, set: (v) => T.innerThoughtsColor = v },
      { label: '속마음 굵게', type: 'check', get: () => T.innerThoughtsBold, set: (v) => T.innerThoughtsBold = v },
      { label: '나레이션 색', type: 'color', get: () => T.narrationColor, set: (v) => T.narrationColor = v },
      { label: '위아래 여백', type: 'check', get: () => T.usePadding, set: (v) => T.usePadding = v },
      { label: '별표 강조 (*기울임* · **굵게**)', type: 'check', get: () => T.asteriskEmphasis, set: (v) => T.asteriskEmphasis = v },
      { label: '별표(*) 제거', type: 'check', get: () => T.removeAsterisk, set: (v) => T.removeAsterisk = v },
      { label: '말줄임표 변환 (...→…)', type: 'check', get: () => T.convertEllipsis, set: (v) => T.convertEllipsis = v },
      { label: '스마트 속마음 인식', type: 'check', get: () => T.smartFormat, set: (v) => T.smartFormat = v },
      { label: '리스 에셋 마커', type: 'check', get: () => T.risuMarkers !== false, set: (v) => T.risuMarkers = v },
    ],
  },
  { title: '태그', tags: true },
  {
    title: '에셋 이미지', open: true, controls: [
      { label: '이미지 크기', type: 'range', min: 10, max: 100, step: 5, suffix: '%', get: () => AI.imageSize, set: (v) => AI.imageSize = +v },
      { label: '이미지 여백', type: 'range', min: 0, max: 50, step: 1, suffix: 'px', get: () => AI.imageMargin, set: (v) => AI.imageMargin = +v },
      { label: '이미지 테두리', type: 'check', get: () => AI.useImageBorder, set: (v) => AI.useImageBorder = v },
      { label: '테두리 색', type: 'color', get: () => AI.imageBorderColor, set: (v) => AI.imageBorderColor = v, when: () => AI.useImageBorder },
      { label: '이미지 그림자', type: 'check', get: () => AI.useImageShadow, set: (v) => AI.useImageShadow = v },
    ],
  },
  {
    title: '단어 치환', pair: {
      arrKey: 'wordReplace', aKey: 'from', aLabel: '찾을 말', aPh: '바꿀 대상',
      bKey: 'to', bLabel: '바꿀 말', bPh: '대체할 텍스트(비우면 삭제)',
      newItem: () => ({ from: '', to: '' }), hint: '본문 전역 치환(예: {{user}} → 실제 이름). 위에서부터 순서대로 적용',
    },
  },
  {
    title: '전역', controls: [
      { label: '다크 모드', type: 'check', get: () => settings.darkMode, set: (v) => settings.darkMode = v },
      { label: '글자색 수동 지정', type: 'check', get: () => cardTextManual, set: (v) => { cardTextManual = v; settings.cardTextColor = v ? lastCardText : ''; } },
      { label: '카드 글자색', type: 'color', get: () => lastCardText, set: (v) => { lastCardText = v; settings.cardTextColor = v; }, when: () => cardTextManual },
      { label: '카드 표시 regex 적용', type: 'check', get: () => cardRegexOn, set: (v) => { cardRegexOn = v; settings.cardRegex = v ? loadedCardRegex : []; }, when: () => loadedCardRegex.length > 0 },
      { label: '카드 CSS 적용', type: 'check', get: () => cardCssOn, set: (v) => { cardCssOn = v; settings.cardCss = v ? loadedCardCss : ''; }, when: () => loadedCardCss.length > 0 },
    ],
  },
];   // (UI 디자인 커스텀 = 서재 "디자인 설정" 모달로 이전)

function baseSection(title: string) {
  const sec = SECTIONS.find((s) => s.title === title);
  if (!sec) throw new Error('missing section: ' + title);
  return sec;
}

function sectionsForCurrentDesign(): Section[] {
  const id = settings.template || 'card';
  if (id === 'papa') return [];   // 파파 = 설정 없음(순수 통과). 설정 패널 자체도 숨김(applyPapaUi).
  if (id === 'custom-css') {
    return [
      baseSection('내 프리셋'),
      { title: '고급 CSS 커스텀', open: true, panel: buildCustomCssDesignPanel },
      baseSection('단어 치환'),    ];
  }
  if (id === 'log-diary') {
    return [
      baseSection('내 프리셋'),
      { title: '로그 다이어리', open: true, panel: buildLogDiaryPanel },
      baseSection('텍스트'),
      baseSection('에셋 이미지'),
      baseSection('단어 치환'),    ];
  }
  if (id === 'chat') {
    return [
      baseSection('내 프리셋'),
      { title: '채팅 설정', open: true, panel: buildChatPanel },
      baseSection('텍스트'),
      baseSection('에셋 이미지'),
      baseSection('단어 치환'),    ];
  }
  if (id === 'webnovel') {
    return [
      baseSection('내 프리셋'),
      { title: '웹소설 설정', open: true, panel: buildWebnovelPanel },
      baseSection('에셋 이미지'),
      baseSection('단어 치환'),    ];
  }
  return SECTIONS;
}

let built: { ctl: Ctl; wrap: HTMLElement; refresh: () => void }[] = [];
let sectionEls: { sec: Section; wrap: HTMLElement }[] = [];
const afterChange = () => { applyConditions(); scheduleRender(); };

function buildControl(c: Ctl) {
  const wrap = document.createElement('div');
  const inline = c.type === 'check' || c.type === 'color';
  wrap.className = 'ctl' + (inline ? ' inline' : '');
  const lab = document.createElement('label'); lab.textContent = c.label; wrap.appendChild(lab);
  let refresh = () => {};
  if (c.type === 'text') {
    const i = document.createElement('input'); i.type = 'text'; if (c.placeholder) i.placeholder = c.placeholder;
    i.value = c.get() ?? ''; i.oninput = () => { c.set(i.value); afterChange(); }; refresh = () => i.value = c.get() ?? '';
    if (c.insertBtn) {
      // 커서 위치에 구분자 등을 넣어주는 보조 버튼(예: 표지 태그 '|').
      const row = document.createElement('div'); row.className = 'ctl-textrow';
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ctl-insert-btn'; btn.textContent = c.insertBtn.trim() || c.insertBtn; btn.title = `커서 위치에 "${c.insertBtn}" 넣기`;
      btn.onclick = () => {
        const ins = c.insertBtn!;
        const s = i.selectionStart ?? i.value.length, e = i.selectionEnd ?? i.value.length;
        i.value = i.value.slice(0, s) + ins + i.value.slice(e);
        const pos = s + ins.length; try { i.setSelectionRange(pos, pos); } catch (_) {}
        i.focus(); c.set(i.value); afterChange();
      };
      row.append(i, btn); wrap.appendChild(row);
    } else { wrap.appendChild(i); }
  } else if (c.type === 'color') {
    const i = document.createElement('input'); i.type = 'color'; i.value = c.get() || '#000000'; i.oninput = () => { c.set(i.value); afterChange(); }; refresh = () => i.value = c.get() || '#000000'; wrap.appendChild(i);
  } else if (c.type === 'check') {
    const i = document.createElement('input'); i.type = 'checkbox'; i.checked = c.get(); i.onchange = () => { c.set(i.checked); afterChange(); }; refresh = () => i.checked = c.get(); wrap.appendChild(i);
  } else if (c.type === 'select') {
    const s = document.createElement('select'); for (const o of c.opts!) { const op = document.createElement('option'); op.value = op.textContent = o; s.appendChild(op); }
    s.value = c.get(); s.onchange = () => { c.set(s.value); afterChange(); }; refresh = () => s.value = c.get(); wrap.appendChild(s);
  } else if (c.type === 'image') {
    // 로컬 이미지 선택기: 클릭=파일찾기 / 드래그앤드롭 / 썸네일 + 제거. 파일 → data URL(아카 업로드 호환).
    const box = document.createElement('div'); box.className = 'img-pick';
    const thumb = document.createElement('img'); thumb.className = 'img-pick-thumb'; thumb.alt = '';
    const hint = document.createElement('span'); hint.className = 'img-pick-hint';
    const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'img-pick-rm'; rm.textContent = '제거';
    const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
    const readFile = (f: File | null | undefined) => {
      if (!f || !/^image\//.test(f.type)) return;
      const r = new FileReader();
      r.onload = () => { c.set(String(r.result)); afterChange(); refresh(); };
      r.readAsDataURL(f);
    };
    box.onclick = (e) => { if (e.target === rm) return; file.click(); };
    file.onchange = () => { readFile(file.files && file.files[0]); file.value = ''; };
    ['dragover', 'dragenter'].forEach((ev) => box.addEventListener(ev, (e) => { e.preventDefault(); box.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => box.addEventListener(ev, () => box.classList.remove('over')));
    box.addEventListener('drop', (e: any) => { e.preventDefault(); readFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); });
    rm.onclick = (e) => { e.stopPropagation(); c.set(''); afterChange(); refresh(); };
    refresh = () => {
      const v = c.get() || '';
      if (v) { thumb.src = v; thumb.style.display = ''; hint.textContent = '클릭/드롭하여 교체'; rm.style.display = ''; }
      else { thumb.removeAttribute('src'); thumb.style.display = 'none'; hint.textContent = '클릭하거나 사진을 드롭하세요'; rm.style.display = 'none'; }
    };
    box.appendChild(thumb); box.appendChild(hint); box.appendChild(rm); box.appendChild(file);
    wrap.appendChild(box); refresh();
  } else { // range
    const row = document.createElement('div'); row.className = 'row';
    const i = document.createElement('input'); i.type = 'range'; i.min = '' + c.min; i.max = '' + c.max; i.step = '' + (c.step || 1); i.value = c.get();
    const v = document.createElement('span'); v.className = 'val'; const fmt = (x: any) => c.suffix ? x + c.suffix : '' + x; v.textContent = fmt(c.get());
    i.oninput = () => { c.set(+i.value); v.textContent = fmt(+i.value); afterChange(); };
    refresh = () => { i.value = c.get(); v.textContent = fmt(c.get()); };
    row.appendChild(i); row.appendChild(v); wrap.appendChild(row);
  }
  return { ctl: c, wrap, refresh };
}

function buildSection(sec: Section) {
  const wrap = document.createElement('div'); wrap.className = 'section' + (sec.open ? '' : ' collapsed');
  const head = document.createElement('div'); head.className = 'shead';
  const chev = document.createElement('span'); chev.className = 'chev'; chev.textContent = '▸';
  const t = document.createElement('span'); t.textContent = sec.title;
  head.appendChild(chev); head.appendChild(t);
  head.onclick = () => wrap.classList.toggle('collapsed');
  const body = document.createElement('div'); body.className = 'sbody';
  if (sec.panel) {
    const host = document.createElement('div'); host.className = 'quick-theme output-design'; body.appendChild(host); sec.panel(host);
  } else if (sec.library) {
    const host = document.createElement('div'); host.className = 'quick-theme preset-lib'; body.appendChild(host); buildPresetLibrary(host);
  } else if (sec.quick) {
    const host = document.createElement('div'); host.className = 'quick-theme'; body.appendChild(host); buildQuickTheme(host);
  } else if (sec.tags) {
    const host = document.createElement('div'); host.className = 'tag-editor'; body.appendChild(host); buildTagEditor(host);
  } else if (sec.pair) {
    if (sec.pair.hint) { const h = document.createElement('div'); h.className = 'pair-hint'; h.textContent = sec.pair.hint; body.appendChild(h); }
    const host = document.createElement('div'); host.className = 'pair-editor'; body.appendChild(host); buildPairEditor(host, sec.pair);
  } else {
    for (const c of sec.controls!) { const b = buildControl(c); built.push(b); body.appendChild(b.wrap); }
  }
  wrap.appendChild(head); wrap.appendChild(body);
  sectionEls.push({ sec, wrap });
  return wrap;
}

function buildControls() {
  built = []; sectionEls = [];
  const box = $('controls');
  // Pro1 패널은 body에 사는 fixed 팝업 → 재구축 때 여기서 정리(섹션과 생명주기 일치, 디자인 전환 시 잔존/중복 방지).
  document.querySelectorAll('.legacy-panel').forEach((e) => e.remove());
  // 트레이는 '에셋 이미지' 섹션 안에 들어가는데 #controls를 innerHTML로 비우면 같이 지워짐 → 비우기 전에 대피시켰다가 재배치.
  const trayEl = document.getElementById('tray');
  if (trayEl && trayEl.parentElement) trayEl.parentElement.removeChild(trayEl);
  box.innerHTML = '';
  for (const sec of sectionsForCurrentDesign()) box.appendChild(buildSection(sec));
  relocateTray(trayEl);
  applyConditions();
}

// 에셋 트레이를 '에셋 이미지' 설정 섹션 안으로 이동(입력 패널은 글쓰기 전용). 그 섹션이 없으면 설정 패널 하단으로.
function relocateTray(trayEl?: HTMLElement | null) {
  const tray = trayEl || document.getElementById('tray');
  if (!tray) return;
  const assetSec = sectionEls.find((s) => s.sec.title === '에셋 이미지');
  const body = assetSec && (assetSec.wrap.querySelector('.sbody') as HTMLElement | null);
  (body || $('controls').parentElement || $('controls')).appendChild(tray);
}

// 조건부 노출 적용(값 재빌드 없이 hide/show만 — 포커스/슬라이더 드래그 보존)
function applyConditions() {
  for (const b of built) b.wrap.hidden = b.ctl.when ? !b.ctl.when() : false;
  for (const s of sectionEls) if (s.sec.when) s.wrap.hidden = !s.sec.when();
}
// 프로그램적 변경(카드 드롭/프리셋) 후 일반 컨트롤 입력값을 settings에서 다시 읽음.
// (태그/쌍 편집기는 별도 동적 리스트라 여기서 갱신하지 않음 — 현재 호출자는 이들을 건드리지 않음)
function syncControls() { for (const b of built) b.refresh(); applyConditions(); syncOutputDesignSelect(); }

function buildCustomCssDesignPanel(host: HTMLElement) {
  host.innerHTML = '';
  const def = TEMPLATE_DEFS['custom-css'];
  const active = activeCssDesign ? getCssDesigns().find((d) => d.id === activeCssDesign) : null;
  host.appendChild(Object.assign(document.createElement('div'), { className: 'pair-hint', textContent: def.description + ' 여러 개를 "내 CSS 디자인"으로 저장해 출력 디자인 드롭다운에서 고를 수 있어요.' }));

  const cssWrap = document.createElement('div'); cssWrap.className = 'ctl';
  cssWrap.appendChild(Object.assign(document.createElement('label'), { textContent: active ? `CSS — "${active.name}" 편집 중 (자동 갱신)` : '출력 카드 CSS (임시 — 저장하면 디자인이 됩니다)' }));
  const ta = document.createElement('textarea'); ta.className = 'cs-css output-css'; ta.spellcheck = false;
  ta.placeholder = '.lp-card{ border:3px dashed #ff6b6b; }\n.lp-dialog{ color:#3157ff; }\n.lp-tag{ border-radius:4px; }';
  ta.value = settings.userCardCss || '';
  let cssT: any;
  ta.oninput = () => {
    settings.userCardCss = ta.value;
    // ★쓰면 바로 보임: 미리보기를 이 custom-css(base)로 즉시 — 출력 디자인이 딴 거였어도 custom-css로 맞추고 드롭다운 동기화.
    if (settings.template !== 'custom-css') { settings.template = 'custom-css'; syncOutputDesignSelect(); }
    clearTimeout(cssT);
    cssT = setTimeout(() => {
      if (activeCssDesign) { const arr = getCssDesigns(); const d = arr.find((x) => x.id === activeCssDesign); if (d) { d.css = ta.value; saveCssDesigns(arr); } }   // 연결된 디자인 갱신(디바운스)
      scheduleRender();
    }, 250);
  };
  cssWrap.appendChild(ta); host.appendChild(cssWrap);

  // 바탕(base) 선택: 카드 / 웹소설(B2). 바꾸면 즉시 미리보기(설정 cssBase) + 연결 디자인이면 갱신.
  const baseRow = document.createElement('div'); baseRow.className = 'qt-btns';
  baseRow.appendChild(Object.assign(document.createElement('span'), { className: 'pair-hint', textContent: '바탕', style: 'align-self:center;flex:0 0 auto;' }));
  const baseSel = document.createElement('select'); baseSel.className = 'tr-preset-sel'; baseSel.style.flex = '1';
  [['card', '기본 카드'], ['webnovel', '웹소설']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; baseSel.appendChild(o); });   // option은 텍스트만(SVG 불가)
  baseSel.value = active ? (active.base || 'card') : (settings.cssBase || 'card');
  baseSel.onchange = () => {
    settings.cssBase = baseSel.value;
    if (settings.template !== 'custom-css') { settings.template = 'custom-css'; syncOutputDesignSelect(); }   // base 바꾸면 즉시 그 base로 미리보기
    if (activeCssDesign) { const arr = getCssDesigns(); const d = arr.find((x) => x.id === activeCssDesign); if (d) { d.base = baseSel.value; saveCssDesigns(arr); } }
    scheduleRender();
  };
  baseRow.appendChild(baseSel); host.appendChild(baseRow);

  // 저장(디자인으로) / 새 빈 슬롯
  const btns = document.createElement('div'); btns.className = 'qt-btns';
  const nameIn = document.createElement('input'); nameIn.type = 'text'; nameIn.placeholder = '디자인 이름'; nameIn.style.flex = '1'; if (active) nameIn.value = active.name;
  const saveB = document.createElement('button'); saveB.className = 'tag-add'; saveB.textContent = active ? '디자인 갱신' : '디자인으로 저장';
  saveB.onclick = () => {
    const nm = nameIn.value.trim(); if (!nm) { nameIn.focus(); setStatus('디자인 이름을 입력하세요'); return; }
    const arr = getCssDesigns();
    let d: any = activeCssDesign ? arr.find((x) => x.id === activeCssDesign) : null;
    if (d) { d.name = nm; d.css = ta.value; d.base = baseSel.value; }
    else { d = { id: newCssId(), name: nm, base: baseSel.value, css: ta.value, order: arr.length }; arr.push(d); setActiveCssDesign(d.id); }
    saveCssDesigns(arr); settings.template = 'custom-css'; settings.cssBase = baseSel.value;
    buildOutputDesignSelect(); buildControls(); scheduleRender();
    setStatus(`CSS 디자인 "${nm}" 저장됨 — 출력 디자인 드롭다운 "내 CSS 디자인"에 있어요`);
  };
  const reset = document.createElement('button'); reset.className = 'tag-add'; reset.textContent = '새 CSS (빈 슬롯)';
  reset.onclick = () => { setActiveCssDesign(''); settings.userCardCss = ''; buildControls(); scheduleRender(); setStatus('빈 CSS — 저장하면 새 디자인이 됩니다'); };
  btns.append(nameIn, saveB, reset); host.appendChild(btns);

  // 저장된 디자인 목록: 편집(로드)·순서(↑↓)·삭제.
  const designs = getCssDesigns();
  if (designs.length) {
    host.appendChild(Object.assign(document.createElement('div'), { className: 'menu-label', textContent: '내 CSS 디자인' }));
    const list = document.createElement('div'); list.className = 'css-design-list';
    designs.forEach((d, idx) => {
      const row = document.createElement('div'); row.className = 'css-design-row' + (d.id === activeCssDesign ? ' active' : '');
      const nm = document.createElement('button'); nm.className = 'css-design-name'; nm.innerHTML = icon(d.base === 'webnovel' ? 'bookOpen' : 'card') + ' ' + esc(d.name); nm.title = '이 디자인 편집(로드)';
      nm.onclick = () => selectCssDesign(d.id);
      const up = document.createElement('button'); up.className = 'css-design-mini'; up.textContent = '↑'; up.disabled = idx === 0; up.title = '위로';
      up.onclick = () => { const a = getCssDesigns(); const i = a.findIndex((x) => x.id === d.id); if (i > 0) { const t = a[i - 1]; a[i - 1] = a[i]; a[i] = t; saveCssDesigns(a); buildOutputDesignSelect(); buildControls(); } };
      const dn = document.createElement('button'); dn.className = 'css-design-mini'; dn.textContent = '↓'; dn.disabled = idx === designs.length - 1; dn.title = '아래로';
      dn.onclick = () => { const a = getCssDesigns(); const i = a.findIndex((x) => x.id === d.id); if (i < a.length - 1) { const t = a[i + 1]; a[i + 1] = a[i]; a[i] = t; saveCssDesigns(a); buildOutputDesignSelect(); buildControls(); } };
      const del = document.createElement('button'); del.className = 'css-design-mini series-del'; del.textContent = '✕'; del.title = '삭제';
      del.onclick = async () => { if (!(await confirmModal(`"${d.name}" CSS 디자인을 삭제할까요?`, { okText: '삭제', danger: true }))) return; const a = getCssDesigns().filter((x) => x.id !== d.id); saveCssDesigns(a); if (activeCssDesign === d.id) { setActiveCssDesign(''); } buildOutputDesignSelect(); buildControls(); setStatus(`"${d.name}" 삭제됨`); };
      row.append(nm, up, dn, del); list.appendChild(row);
    });
    host.appendChild(list);
  }

  // 예시 보기(정직하게 재구성): 바탕별 클래스 훅 + 시작 스니펫 + 안내.
  const ref = document.createElement('details'); ref.className = 'cs-ref';
  ref.appendChild(Object.assign(document.createElement('summary'), { textContent: '예시 보기 — 클래스 훅 + 시작 CSS (카드·웹소설)' }));
  const refCard = document.createElement('div'); refCard.className = 'pair-hint';
  refCard.innerHTML = `${icon('card')} <b>카드</b> 훅:<br><code>${def.hooks.map((h: string) => '.' + h).join('  ')}</code>`;
  ref.appendChild(refCard);
  const snipCard = document.createElement('textarea'); snipCard.className = 'cs-css'; snipCard.readOnly = true; snipCard.rows = 4;
  snipCard.value = '.lp-card{ border:2px solid #b1532c; border-radius:14px; }\n.lp-dialog{ color:#2f6df0; font-weight:600; }\n.lp-narration{ color:#555; }\n.lp-tag{ border-radius:999px; }';
  ref.appendChild(snipCard);
  const refWn = document.createElement('div'); refWn.className = 'pair-hint';
  refWn.innerHTML = `${icon('bookOpen')} <b>웹소설</b> 훅:<br><code>.lp-webnovel  .lp-wn-chapter  .lp-wn-scenebreak  .lp-line  .lp-dialog  .lp-narration  .lp-inner-thought</code>`;
  ref.appendChild(refWn);
  const snipWn = document.createElement('textarea'); snipWn.className = 'cs-css'; snipWn.readOnly = true; snipWn.rows = 5;
  snipWn.value = '.lp-webnovel{ font-family:"Noto Serif KR",serif; }\n.lp-wn-chapter{ letter-spacing:0.1em; }\n.lp-dialog{ color:#1f6feb; }\n.lp-inner-thought{ font-style:italic; opacity:0.85; }\n.lp-narration{ line-height:1.9; }';
  ref.appendChild(snipWn);
  ref.appendChild(Object.assign(document.createElement('div'), { className: 'pair-hint', textContent: '단순 클래스 선택자만 복사본에 살아남습니다. 다이어리·채팅은 각자 설정 패널에서 꾸밉니다. @import·외부 url()·javascript:는 제거됩니다.' }));
  host.appendChild(ref);
}

function buildLogDiaryPanel(host: HTMLElement) {
  host.innerHTML = '';
  const def: any = TEMPLATE_DEFS['log-diary'];
  const cfg = templateConfig('log-diary');
  const desc = document.createElement('div'); desc.className = 'pair-hint';
  desc.textContent = def.description;
  host.appendChild(desc);

  // 테마: 값=id, 표시=한국어 라벨 (buildControl select는 값=라벨이라 여기선 직접 만듦)
  const themeWrap = document.createElement('div'); themeWrap.className = 'ctl inline';
  const themeLab = document.createElement('label'); themeLab.textContent = '테마'; themeWrap.appendChild(themeLab);
  const themeSel = document.createElement('select');
  for (const t of DIARY_THEME_LIST) { const o = document.createElement('option'); o.value = t.id; o.textContent = t.label; themeSel.appendChild(o); }
  themeSel.value = cfg.theme || 'basic';
  themeSel.onchange = () => { cfg.theme = themeSel.value; scheduleRender(); };
  themeWrap.appendChild(themeSel); host.appendChild(themeWrap);

  const topCtls: Ctl[] = [
    { label: '폰트', type: 'select', opts: [...DIARY_FONT_LIST, ...getFontList().map((f) => f.family)], get: () => cfg.font || 'Pretendard', set: (v) => cfg.font = v },   // 커스텀 폰트도 선택지로
    { label: '대사 배경 하이라이트', type: 'check', get: () => cfg.quoteHighlight !== false, set: (v) => cfg.quoteHighlight = v },
  ];
  for (const c of topCtls) { const b = buildControl(c); built.push(b); host.appendChild(b.wrap); }

  const diarySub = (txt: string) => { const d = document.createElement('div'); d.className = 'diary-sub'; d.textContent = txt; host.appendChild(d); };

  // ── 표지 ──
  diarySub('표지');
  const coverCtls: Ctl[] = [
    { label: '표지 이미지', type: 'image', get: () => cfg.coverImage || '', set: (v) => cfg.coverImage = v },
    { label: '표지를 한 장 이미지로 굽기 (페이드+제목+둥근모서리)', type: 'check', get: () => cfg.coverBake === true, set: (v) => cfg.coverBake = v, when: () => !!cfg.coverImage },
    { label: '글씨를 이미지 위에 (실험적·아카 미확인)', type: 'check', get: () => cfg.coverOverlay === true, set: (v) => cfg.coverOverlay = v, when: () => !!cfg.coverImage && cfg.coverBake !== true },
    { label: '표지 번호', type: 'text', placeholder: '예: NO. 001', get: () => cfg.coverArchiveNo || '', set: (v) => cfg.coverArchiveNo = v },
    { label: '표지 제목', type: 'text', placeholder: '로그 제목', get: () => cfg.coverTitle || '', set: (v) => cfg.coverTitle = v },
    { label: '표지 부제', type: 'text', placeholder: '부제(선택)', get: () => cfg.coverSubtitle || '', set: (v) => cfg.coverSubtitle = v },
    { label: '표지 태그 (| 로 구분)', type: 'text', placeholder: '예: 모델 | 프롬프트', insertBtn: ' | ', get: () => (cfg.coverTags || []).join(' | '), set: (v) => cfg.coverTags = String(v).split('|').map((s) => s.trim()).filter(Boolean) },
    { label: '표지 글씨 크기', type: 'range', min: 80, max: 250, step: 10, suffix: '%', get: () => Math.round((cfg.coverTextScale != null ? cfg.coverTextScale : 1.5) * 100), set: (v) => cfg.coverTextScale = (+v) / 100 },
    { label: '표지 세로 위치', type: 'range', min: 0, max: 100, step: 5, suffix: '%', get: () => cfg.coverFocusY != null ? cfg.coverFocusY : 50, set: (v) => cfg.coverFocusY = +v, when: () => !!cfg.coverImage && cfg.coverBake === true },
    { label: '표지 확대', type: 'range', min: 100, max: 250, step: 10, suffix: '%', get: () => cfg.coverZoom != null ? cfg.coverZoom : 100, set: (v) => cfg.coverZoom = +v, when: () => !!cfg.coverImage && cfg.coverBake === true },
  ];
  for (const c of coverCtls) { const b = buildControl(c); built.push(b); host.appendChild(b.wrap); }
  // 이미지 비율(표지·페이지 헤더 공통): 값=id, 표시=라벨 → 직접 select
  const ratioWrap = document.createElement('div'); ratioWrap.className = 'ctl inline';
  const ratioLab = document.createElement('label'); ratioLab.textContent = '이미지 비율'; ratioWrap.appendChild(ratioLab);
  const ratioSel = document.createElement('select');
  for (const r of DIARY_IMAGE_RATIOS) { const o = document.createElement('option'); o.value = r.id; o.textContent = r.label; ratioSel.appendChild(o); }
  ratioSel.value = cfg.imageRatio || '';
  ratioSel.onchange = () => { cfg.imageRatio = ratioSel.value; scheduleRender(); };
  ratioWrap.appendChild(ratioSel); host.appendChild(ratioWrap);
  const ratioHint = document.createElement('div'); ratioHint.className = 'pair-hint';
  ratioHint.textContent = '표지·페이지 헤더 이미지를 일정한 띠로 자릅니다(세로로 긴 이미지가 너무 커지는 것 방지). 복사 시 아카에서도 같은 비율로 잘려 들어갑니다.';
  host.appendChild(ratioHint);
  const bakeHint = document.createElement('div'); bakeHint.className = 'pair-hint';
  bakeHint.textContent = '“표지를 한 장 이미지로 굽기”: 페이드+제목을 이미지에 구워 아카에서도 둥근 모서리·페이드가 그대로 나옵니다. 단 제목이 그림이 되어 붙여넣은 뒤 글자 수정은 안 됩니다. (끄면 제목이 진짜 텍스트)';
  host.appendChild(bakeHint);
  const thumbCtl = buildControl({ label: '아카 대표 썸네일 고정', type: 'check', get: () => cfg.forceThumbnail === true, set: (v) => cfg.forceThumbnail = v });
  built.push(thumbCtl); host.appendChild(thumbCtl.wrap);
  const thumbHint = document.createElement('div'); thumbHint.className = 'pair-hint';
  thumbHint.textContent = '아카 글 목록의 대표 썸네일을 표지(없으면 첫 이미지)로 고정합니다. 글 맨 위에 보이지 않는 0×0 이미지를 한 장 더 넣는 방식이라, 대표 이미지가 엉뚱하게 잡힐 때 켜세요.';
  host.appendChild(thumbHint);

  // ── 프로필(최대 6) ──
  diarySub('프로필 (최대 6)');
  const profHost = document.createElement('div'); profHost.className = 'diary-profiles'; host.appendChild(profHost);
  buildDiaryProfiles(profHost, cfg);

  // ── 추가 설명 / Story So Far ──
  diarySub('소개 글 (선택)');
  diaryTextarea(host, '추가 설명', () => cfg.intro || '', (v) => cfg.intro = v, '프로필 아래 들어가는 설명(선택)');
  diaryTextarea(host, 'Story So Far', () => cfg.summary || '', (v) => cfg.summary = v, '지금까지의 줄거리(선택)');

  // ── 본문 페이지 ──
  diarySub('본문 페이지');
  const pgHint = document.createElement('div'); pgHint.className = 'pair-hint';
  pgHint.textContent = '왼쪽 입력 영역에서 [+ 페이지]와 [+ 섹션(챕터)]를 추가·편집·순서 변경합니다. 섹션은 헤더 이미지(섹션 제목/부제 포함)로 챕터를 나누고, 뒤따르는 페이지들을 한 카드로 묶습니다. 페이지가 2개 이상이면 번호가 붙습니다(섹션마다 1부터).';
  host.appendChild(pgHint);
  const collapseCtl = buildControl({ label: '페이지 접기 (펼침/접힘)', type: 'check', get: () => !!cfg.collapse, set: (v) => cfg.collapse = v });
  built.push(collapseCtl); host.appendChild(collapseCtl.wrap);

  // ── 사운드트랙(선택) ──
  diarySub('사운드트랙 (선택)');
  cfg.soundtrack = (cfg.soundtrack && typeof cfg.soundtrack === 'object') ? cfg.soundtrack : { url: '', title: '', artist: '' };
  const stCtls: Ctl[] = [
    { label: '유튜브 URL', type: 'text', placeholder: 'https://youtu.be/...', get: () => cfg.soundtrack.url || '', set: (v) => cfg.soundtrack.url = v },
    { label: '곡명', type: 'text', placeholder: '곡 제목(선택)', get: () => cfg.soundtrack.title || '', set: (v) => cfg.soundtrack.title = v },
    { label: '아티스트', type: 'text', placeholder: '아티스트(선택)', get: () => cfg.soundtrack.artist || '', set: (v) => cfg.soundtrack.artist = v },
  ];
  for (const c of stCtls) { const b = buildControl(c); built.push(b); host.appendChild(b.wrap); }
  const stNote = document.createElement('div'); stNote.className = 'pair-hint';
  stNote.textContent = '유튜브 iframe은 아카가 제거하므로, 썸네일 이미지 + 영상 링크로 넣습니다.';
  host.appendChild(stNote);

  // ── 코멘트(선택) ──
  diarySub('코멘트 (선택)');
  cfg.comment = (cfg.comment && typeof cfg.comment === 'object') ? cfg.comment : { nickname: '', text: '' };
  const nickCtl = buildControl({ label: '닉네임', type: 'text', placeholder: '작성자(선택)', get: () => cfg.comment.nickname || '', set: (v) => cfg.comment.nickname = v });
  built.push(nickCtl); host.appendChild(nickCtl.wrap);
  diaryTextarea(host, '코멘트 내용', () => cfg.comment.text || '', (v) => cfg.comment.text = v, '맨 아래 코멘트 박스(비우면 숨김)');

  const note = document.createElement('div'); note.className = 'pair-hint';
  note.textContent = '본문 대사·나레이션 색은 위 테마를 따릅니다. 비어 있는 표지·프로필·코멘트 영역은 출력되지 않습니다.';
  host.appendChild(note);
}

// 다이어리 전용 멀티라인 입력(설명/줄거리/코멘트). 동적이라 built에는 넣지 않음(프리셋 복원 시 패널 재빌드로 충분).
function diaryTextarea(host: HTMLElement, label: string, get: () => string, set: (v: string) => void, ph: string) {
  const w = document.createElement('div'); w.className = 'ctl';
  const l = document.createElement('label'); l.textContent = label; w.appendChild(l);
  const ta = document.createElement('textarea'); ta.className = 'diary-ta'; ta.spellcheck = false; ta.placeholder = ph;
  ta.value = get() || '';
  let t: any; ta.oninput = () => { set(ta.value); clearTimeout(t); t = setTimeout(scheduleRender, 160); };
  w.appendChild(ta); host.appendChild(w);
}

// 프로필 동적 편집기(최대 6): 카드별 사진/태그/이름/설명 + 추가·삭제. 동적 리스트라 built 미등록.
function buildDiaryProfiles(host: HTMLElement, cfg: any) {
  cfg.profiles = Array.isArray(cfg.profiles) ? cfg.profiles : [];
  const render = () => {
    host.innerHTML = '';
    cfg.profiles.forEach((p: any, i: number) => {
      const card = document.createElement('div'); card.className = 'tag-card';
      const head = document.createElement('div'); head.className = 'tag-head';
      const title = document.createElement('span'); title.textContent = `프로필 ${i + 1}`;
      const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'tag-del'; rm.textContent = '삭제';
      rm.onclick = () => { cfg.profiles.splice(i, 1); render(); scheduleRender(); };
      head.appendChild(title); head.appendChild(rm); card.appendChild(head);
      const fields: Ctl[] = [
        { label: '사진', type: 'image', get: () => p.image || '', set: (v) => p.image = v },
        { label: '태그', type: 'text', placeholder: '예: MAIN', get: () => p.tag || '', set: (v) => p.tag = v },
        { label: '이름', type: 'text', placeholder: '캐릭터 이름', get: () => p.name || '', set: (v) => p.name = v },
        { label: '설명', type: 'text', placeholder: '한 줄 소개', get: () => p.desc || '', set: (v) => p.desc = v },
      ];
      for (const f of fields) { const b = buildControl(f); card.appendChild(b.wrap); }
      host.appendChild(card);
    });
    if (cfg.profiles.length < 6) {
      const add = document.createElement('button'); add.type = 'button'; add.className = 'tag-add'; add.textContent = '+ 프로필 추가';
      add.onclick = () => { cfg.profiles.push({ image: '', tag: '', name: '', desc: '' }); render(); scheduleRender(); };
      host.appendChild(add);
    }
  };
  render();
}

function templateConfig(id: string) {
  settings.templateSettings = settings.templateSettings || {};
  const def: any = TEMPLATE_DEFS[id] || {};
  const defaults = def.defaults || {};
  settings.templateSettings[id] = Object.assign({}, defaults, settings.templateSettings[id] || {});
  return settings.templateSettings[id];
}

// ---------- named 프리셋 라이브러리 (디자인별 독립) ----------
// 저장소 = localStorage 단일 키에 { card:{이름:번들}, 'log-diary':{...}, 'custom-css':{...} } 중첩.
// "내 프리셋" 패널은 현재 디자인 목록만 보여주고, 저장/불러오기도 그 디자인 칸에만 작용한다.
// (나중에 Electron 파일/Firebase로 갈아끼우기 쉽게 헬퍼로 격리)
const LIB_KEY = PRESET_LIB_KEY;  // store.ts 단일 출처(동기화 대상 KV)
function loadLibrary(): Record<string, Record<string, any>> {
  let o: any = kvLoad(LIB_KEY);  // backend 경유(로컬=localStorage, 로그인=Firebase)
  if (!o || typeof o !== 'object' || Array.isArray(o)) o = {};
  // 마이그레이션: 옛 평면 { 이름:번들 }(값에 .app 있음) → card 칸으로 이사(Pro1=카드).
  const flat = Object.keys(o).some((k) => DESIGN_IDS.indexOf(k) < 0 && o[k] && typeof o[k] === 'object' && o[k].app);
  if (flat) o = { card: o };
  for (const d of DESIGN_IDS) if (!o[d] || typeof o[d] !== 'object' || Array.isArray(o[d])) o[d] = {};
  if (flat) saveLibrary(o); // 정규화(3칸) 상태로 저장
  return o;
}
function saveLibrary(lib: Record<string, any>) { kvSave(LIB_KEY, lib); }

// ── Pro1 가져오기 패널(편집기 기본카드 02설정 맨 위) — 발견 세트를 "카드 프리셋"으로 적립. 분류/적용·자동스캔은 코어/데스크탑 공유. ──
function buildPro1Panel(host: HTMLElement) {
  host.innerHTML = '';
  host.appendChild(Object.assign(document.createElement('div'), { className: 'pair-hint', textContent: 'Pro 1 설정 폴더(color_presets.json·text_settings.json 등)를 가져와 “카드 프리셋”으로 적립합니다. 적립 후 위 “내 프리셋”에서 골라 쓰세요.' }));
  const btn = document.createElement('button'); btn.className = 'tag-add'; btn.innerHTML = icon('archiveDown') + ' Pro1 설정 가져오기';
  const fileLegacy = document.createElement('input'); fileLegacy.type = 'file'; fileLegacy.accept = '.json,application/json'; fileLegacy.multiple = true; fileLegacy.style.display = 'none';
  const panel = document.createElement('div'); panel.className = 'legacy-panel'; panel.hidden = true;
  host.append(btn, fileLegacy);
  // fixed 팝업은 body에(.thumb-pop과 동일 패턴) — 섹션 안에 두면 블러 스킨의 .section backdrop-filter가
  // fixed의 기준을 섹션으로 바꿔 overflow:hidden에 갇힌다. 옛 패널 정리는 buildControls가 함(디자인 전환 포함).
  document.body.appendChild(panel);
  let classified: any = null;
  const legacySelect = (label: string, hint: string, options: Array<{ value: string; text: string }>) => {
    const wrap = document.createElement('div'); wrap.className = 'legacy-row';
    wrap.appendChild(Object.assign(document.createElement('label'), { textContent: label }));
    const sel = document.createElement('select'); const none = document.createElement('option'); none.value = ''; none.textContent = hint; sel.appendChild(none);
    for (const o of options) { const op = document.createElement('option'); op.value = o.value; op.textContent = o.text; sel.appendChild(op); }
    if (options.length === 1) sel.value = options[0].value;
    wrap.appendChild(sel); return { wrap, sel };
  };
  const renderPanel = (bad: number) => {
    const c = classified; panel.hidden = false; panel.innerHTML = '';
    panel.appendChild(Object.assign(document.createElement('div'), { className: 'legacy-title', textContent: 'Pro1 설정 가져오기' }));
    const colorNames = Object.keys(c.colorTemplates), textNames = Object.keys(c.textSettings), profileNames = Object.keys(c.profileSets);
    const tagSetNames = Object.keys(c.tagSets), tagPresetNames = Object.keys(c.tagPresets), wordNames = Object.keys(c.wordReplaceSets), mapNames = Object.keys(c.mappingSets);
    const total = colorNames.length + textNames.length + profileNames.length + tagSetNames.length + tagPresetNames.length + wordNames.length + mapNames.length;
    if (!total) { panel.appendChild(Object.assign(document.createElement('div'), { className: 'legacy-empty', textContent: bad ? `읽을 수 있는 Pro1 설정이 없습니다 (${bad}개 파싱 실패).` : 'color_presets.json·text_settings.json 등이 있는 폴더를 선택하세요.' })); const cb = document.createElement('button'); cb.textContent = '닫기'; cb.onclick = () => { panel.hidden = true; }; panel.appendChild(cb); return; }
    const selectors: Record<string, HTMLSelectElement> = {};
    const add = (key: string, label: string, names: string[]) => { if (!names.length) return; const { wrap, sel } = legacySelect(label, '(사용 안 함)', names.map((nm) => ({ value: nm, text: nm }))); selectors[key] = sel; panel.appendChild(wrap); };
    add('colorTemplate', '색상 프리셋', colorNames); add('textSetting', '텍스트 설정', textNames); add('profileSet', '프로필 세트', profileNames);
    const tagOpts = [...tagSetNames.map((nm) => ({ value: 'set:' + nm, text: nm + ' (세트)' })), ...tagPresetNames.map((nm) => ({ value: 'preset:' + nm, text: nm + ' (프리셋)' }))];
    if (tagOpts.length) { const { wrap, sel } = legacySelect('태그', '(사용 안 함)', tagOpts); selectors['tagSource'] = sel; panel.appendChild(wrap); }
    add('wordReplaceSet', '단어 치환 세트', wordNames); add('mappingSet', '이미지 매핑 세트', mapNames);
    const nameRow = document.createElement('div'); nameRow.className = 'legacy-row';
    nameRow.appendChild(Object.assign(document.createElement('label'), { textContent: '카드 프리셋 이름' }));
    const nameIn = document.createElement('input'); nameIn.type = 'text'; nameIn.value = 'Pro1 가져옴'; nameRow.appendChild(nameIn); panel.appendChild(nameRow);
    const btns = document.createElement('div'); btns.className = 'legacy-btns';
    const apply = document.createElement('button'); apply.className = 'primary'; apply.textContent = '카드 프리셋으로 저장';
    apply.onclick = () => {
      const nm = nameIn.value.trim(); if (!nm) { nameIn.focus(); setStatus('프리셋 이름을 입력하세요.'); return; }
      const sel: any = {};
      if (selectors.colorTemplate?.value) sel.colorTemplate = selectors.colorTemplate.value;
      if (selectors.textSetting?.value) sel.textSetting = selectors.textSetting.value;
      if (selectors.profileSet?.value) sel.profileSet = selectors.profileSet.value;
      if (selectors.wordReplaceSet?.value) sel.wordReplaceSet = selectors.wordReplaceSet.value;
      if (selectors.mappingSet?.value) sel.mappingSet = selectors.mappingSet.value;
      if (selectors.tagSource?.value) { const [type, ...rest] = selectors.tagSource.value.split(':'); sel.tagSource = { type, name: rest.join(':') }; }
      const { settings: s, warnings } = applyLegacy(classified, sel, defaultSettings());
      let lib: any = kvLoad(LIB_KEY); if (!lib || typeof lib !== 'object') lib = {};
      if (!lib.card || typeof lib.card !== 'object') lib.card = {};
      lib.card[nm] = Object.assign(buildBundle(s), { design: 'card' });
      kvSave(LIB_KEY, lib);
      panel.hidden = true;
      setStatus(`Pro1 → 카드 프리셋 "${nm}" 저장 완료` + (warnings.length ? ` (주의 ${warnings.length}건)` : '') + ' — 위 “내 프리셋”에서 사용.');
      const sec = document.querySelector('.preset-lib') as HTMLElement | null; if (sec) buildPresetLibrary(sec);
    };
    const cancel = document.createElement('button'); cancel.textContent = '취소'; cancel.onclick = () => { panel.hidden = true; };
    btns.append(apply, cancel); panel.appendChild(btns);
  };
  const fromFiles = async (files: File[]) => { const parsed: any[] = []; let bad = 0; for (const f of files) { try { parsed.push({ name: f.name, json: JSON.parse(await f.text()) }); } catch (_) { bad++; } } classified = classifyLegacyFiles(parsed); renderPanel(bad); };
  const importFromFolder = async () => {
    let dir: any;
    try { dir = await (window as any).showDirectoryPicker({ id: 'pro1-appdata', mode: 'read' }); }
    catch (e: any) { if (e && e.name === 'AbortError') return; fileLegacy.click(); return; }
    const parsed: any[] = []; let bad = 0;
    try { for await (const entry of dir.values()) { if (entry.kind === 'file' && /\.json$/i.test(entry.name)) { try { const file = await entry.getFile(); parsed.push({ name: entry.name, json: JSON.parse(await file.text()) }); } catch (_) { bad++; } } } } catch (_) {}
    classified = classifyLegacyFiles(parsed); renderPanel(bad);
  };
  btn.onclick = async () => {
    const d = (window as any).desktop;
    if (d && d.pro1Scan) {
      setStatus('Pro1 설정 폴더를 자동으로 찾는 중…');
      try { const r = await d.pro1Scan(); if (r && r.found && r.files && r.files.length) { const parsed: any[] = []; let bad = 0; for (const f of r.files) { try { parsed.push({ name: f.name, json: JSON.parse(f.text) }); } catch (_) { bad++; } } if (parsed.length) { classified = classifyLegacyFiles(parsed); renderPanel(bad); setStatus('Pro1 폴더 자동 인식: ' + r.dir); return; } } setStatus('자동으로 못 찾았어요 — 폴더를 직접 골라주세요.'); }
      catch (_) { setStatus('자동 검색 실패 — 폴더를 직접 골라주세요.'); }
    }
    if ((window as any).showDirectoryPicker) importFromFolder(); else fileLegacy.click();
  };
  fileLegacy.onchange = async () => { const files = Array.from(fileLegacy.files || []); fileLegacy.value = ''; if (files.length) fromFiles(files); };
}

// 디자인별 "추천(기본 제공)" 프리셋 — 코드 상수. 사용자 저장 목록과 별개(삭제 불가, "추천" 그룹으로 노출).
function mkWnPreset(knobs: any): any {
  return { app: 'log-jejogi-pro2', version: 1, kind: 'preset', design: 'webnovel', settings: { template: 'webnovel', templateSettings: { webnovel: knobs } } };
}
const BUILTIN_PRESETS: Record<string, Record<string, any>> = {
  webnovel: {
    // 정통 소설: 강조 없이 따옴표만, 첫 줄 들여쓰기 + 촘촘한 행간 = 종이책 느낌. 속마음만 이탤릭.
    '정통 소설 (들여쓰기·이탤릭)': mkWnPreset({ dialogEmphasis: 'none', innerItalic: true, dialogNewline: false, asteriskEmphasis: true, textIndent: 16, paraGap: 1.3 }),
    // 대사 강조: 대사에 currentColor 밑줄(테마안전) + 넉넉한 문단 여백 = 웹소설 몰입형. 들여쓰기 없음.
    '대사 강조 (밑줄·여백)': mkWnPreset({ dialogEmphasis: 'underline', innerItalic: true, dialogNewline: false, asteriskEmphasis: true, textIndent: 0, paraGap: 1.7 }),
  },
};

function buildPresetLibrary(host: HTMLElement) {
  host.innerHTML = '';
  const design = settings.template || 'card';
  const designLabel = TEMPLATE_DEFS[design]?.label || '기본 카드';
  const lib = loadLibrary();
  const dlib = lib[design] || {};
  const names = Object.keys(dlib).sort((a, b) => a.localeCompare(b, 'ko'));
  const builtins = BUILTIN_PRESETS[design] || {};            // 코드 상수 = "추천(기본 제공)" 그룹
  const builtinNames = Object.keys(builtins);

  const caption = document.createElement('div'); caption.className = 'pair-hint';
  caption.textContent = `‘${designLabel}’ 디자인 전용 프리셋 — 디자인마다 목록이 따로입니다.`;
  host.appendChild(caption);

  // 프리셋 선택(추천 + 내가 저장한 것). 추천은 value 앞에 '★'를 붙여 사용자 이름과 구분.
  const sel = document.createElement('select');
  const ph = document.createElement('option'); ph.value = '';
  ph.textContent = (names.length || builtinNames.length) ? '— 프리셋 선택 —' : '— 저장된 프리셋 없음 —';
  sel.appendChild(ph);
  if (builtinNames.length) {
    const og = document.createElement('optgroup'); og.label = '추천 (기본 제공)';
    for (const nm of builtinNames) { const o = document.createElement('option'); o.value = '★' + nm; o.textContent = nm; og.appendChild(o); }
    sel.appendChild(og);
  }
  if (names.length) {
    const og = document.createElement('optgroup'); og.label = '내 프리셋';
    for (const nm of names) { const o = document.createElement('option'); o.value = nm; o.textContent = nm; og.appendChild(o); }
    sel.appendChild(og);
  }
  host.appendChild(sel);

  // 불러오기 / 삭제
  const btns = document.createElement('div'); btns.className = 'qt-btns';
  const loadB = document.createElement('button'); loadB.className = 'tag-add'; loadB.textContent = '불러오기';
  loadB.onclick = () => {
    const raw = sel.value; if (!raw) { setStatus('불러올 프리셋을 선택하세요'); return; }
    const isB = raw[0] === '★'; const nm = isB ? raw.slice(1) : raw;
    const bundle = isB ? builtins[nm] : dlib[nm];
    if (!bundle) { setStatus('불러올 프리셋을 선택하세요'); return; }
    try {
      const { settings: s, warnings, ui } = parseBundle(bundle);
      applyDesignPreset(design, s, ui); // 이 디자인의 소유 룩만 반영(다른 디자인 작업 보존)
      setStatus(`"${nm}" 프리셋 불러옴` + (warnings.length ? ` (주의 ${warnings.length}건)` : ''));
    } catch (e: any) { setStatus('불러오기 실패: ' + e.message); }
  };
  const delB = document.createElement('button'); delB.className = 'tag-add'; delB.textContent = '삭제';
  delB.onclick = async () => {
    const raw = sel.value; if (!raw) { setStatus('삭제할 프리셋을 선택하세요'); return; }
    if (raw[0] === '★') { setStatus('추천 프리셋은 삭제할 수 없어요'); return; }
    const nm = raw;
    if (!(await confirmModal(`"${nm}" 프리셋을 삭제할까요?`, { okText: '삭제', danger: true }))) return;
    const l = loadLibrary(); delete l[design][nm]; saveLibrary(l); buildPresetLibrary(host); setStatus(`"${nm}" 삭제됨`);
  };
  btns.appendChild(loadB); btns.appendChild(delB); host.appendChild(btns);

  // 현재 설정을 새 이름으로 저장 (이름 비우고 저장 = 선택된 프리셋 덮어쓰기)
  const nameIn = document.createElement('input'); nameIn.type = 'text'; nameIn.placeholder = `새 ${designLabel} 프리셋 이름`;
  host.appendChild(nameIn);
  const saveBtns = document.createElement('div'); saveBtns.className = 'qt-btns';
  const saveB = document.createElement('button'); saveB.className = 'tag-add'; saveB.textContent = '현재 설정 저장';
  const doSave = async () => {
    const selVal = sel.value && sel.value[0] !== '★' ? sel.value : ''; // 추천 프리셋엔 덮어쓰기 금지
    const nm = (nameIn.value.trim() || selVal).trim();
    if (!nm) { setStatus('프리셋 이름을 입력하세요'); nameIn.focus(); return; }
    const l = loadLibrary();
    if (l[design][nm] && !(await confirmModal(`"${nm}" 프리셋을 덮어쓸까요?`, { okText: '덮어쓰기' }))) return;
    l[design][nm] = Object.assign(buildBundle(settings, { cardRegexOn, cardCssOn, cardTextManual }), { design });
    saveLibrary(l); buildPresetLibrary(host);
    const ns = host.querySelector('select') as HTMLSelectElement | null; if (ns) ns.value = nm; // 방금 저장한 것 선택 상태로
    setStatus(`"${nm}" ${designLabel} 프리셋 저장됨`);
  };
  saveB.onclick = doSave;
  nameIn.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); doSave(); } });
  saveBtns.appendChild(saveB); host.appendChild(saveBtns);

  const hint = document.createElement('div'); hint.className = 'pair-hint';
  hint.textContent = '이 디자인의 설정을 이름 붙여 이 브라우저에 저장합니다. 프로필 사진(로컬 이미지)은 제외 — 전체 백업·이사는 상단 "전체 백업 내보내기"로.';
  host.appendChild(hint);
}

// (UI 디자인 커스텀 buildCustomSkin = appSettings.ts로 이전 → 서재 "디자인 설정" 모달. 편집기에선 빠짐.)

// ---------- 빠른 테마 (배경색 + 포인트색 → 전체 색 자동 생성) ----------
function buildQuickTheme(host: HTMLElement) {
  host.innerHTML = '';
  const colorRow = (label: string, get: () => string, set: (v: string) => void) => {
    const row = document.createElement('div'); row.className = 'ctl inline';
    const l = document.createElement('label'); l.textContent = label;
    const i = document.createElement('input'); i.type = 'color'; i.value = get();
    i.oninput = () => set(i.value);
    row.appendChild(l); row.appendChild(i); return row;
  };
  host.appendChild(colorRow('배경색', () => themeBg, (v) => themeBg = v));
  host.appendChild(colorRow('포인트색', () => themeAccent, (v) => themeAccent = v));
  const hint = document.createElement('div'); hint.className = 'pair-hint';
  hint.textContent = '2색에서 카드·글자·태그·구분선 색을 자동 생성(가독성 자동 보정). 기존 색 설정을 덮어씁니다.';
  host.appendChild(hint);
  const btns = document.createElement('div'); btns.className = 'qt-btns';
  const apply = document.createElement('button'); apply.className = 'tag-add'; apply.textContent = '테마 적용';
  apply.onclick = () => applyTheme(themeBg, themeAccent);
  const dark = document.createElement('button'); dark.className = 'tag-add'; dark.textContent = '다크 버전';
  dark.onclick = () => { themeBg = deriveDarkBg(themeBg); applyTheme(themeBg, themeAccent); };
  btns.appendChild(apply); btns.appendChild(dark); host.appendChild(btns);
}
// 팔레트를 settings 색 노브에 덮어쓰고(태그는 색만), 컨트롤 재빌드 + 렌더.
function applyTheme(bg: string, accent: string) {
  const p = generatePalette(bg, accent, settings.tags.length);
  Object.assign(B, p.box); Object.assign(P, p.profile); Object.assign(D, p.divider);
  Object.assign(T, p.text); Object.assign(AI, p.assetImage);
  p.tags.forEach((tc: any, i: number) => { if (settings.tags[i]) { settings.tags[i].color = tc.color; settings.tags[i].textColor = tc.textColor; } });
  settings.cardTextColor = p.cardTextColor; cardTextManual = true; lastCardText = p.cardTextColor;
  buildControls(); scheduleRender();
}

// ---------- 태그 편집기 (동적 리스트) ----------
function defaultTag() {
  return { text: '새 태그', color: '#edf2f7', textColor: '#2d3748', style: '기본', borderRadius: 20, fontSize: 0.85, padding: { top: 0.2, right: 0.8, bottom: 0.2, left: 0.8 } };
}
function buildTagEditor(host: HTMLElement) {
  host.innerHTML = '';
  settings.tags.forEach((tag: any, i: number) => host.appendChild(tagCard(tag, i, host)));
  const add = document.createElement('button'); add.className = 'tag-add'; add.textContent = '+ 태그 추가';
  add.onclick = () => { settings.tags.push(defaultTag()); buildTagEditor(host); scheduleRender(); };
  host.appendChild(add);
}
function tagCard(tag: any, i: number, host: HTMLElement) {
  const card = document.createElement('div'); card.className = 'tag-card';
  // 헤더: 실시간 칩 프리뷰(엔진 renderTagSpan; 텍스트는 이스케이프 — 부모문서 XSS 방지) + 삭제
  const head = document.createElement('div'); head.className = 'tag-head';
  const chip = document.createElement('div'); chip.className = 'tag-chip';
  const del = document.createElement('button'); del.className = 'tag-del'; del.textContent = '삭제'; del.title = '이 태그 삭제';
  del.onclick = () => { settings.tags.splice(i, 1); buildTagEditor(host); scheduleRender(); };
  head.appendChild(chip); head.appendChild(del); card.appendChild(head);
  // 칩 프리뷰는 부모 문서 DOM이므로 텍스트는 esc(), 색은 hex 화이트리스트로 검증(§4 방어 깊이 — 향후 프리셋/외부 로드 대비).
  const okColor = (c: any) => (/^#[0-9a-fA-F]{3,8}$/.test(String(c)) ? c : '#000000');
  const updateChip = () => {
    const safe = Object.assign({}, tag, { text: esc(tag.text || `태그 ${i + 1}`), color: okColor(tag.color), textColor: okColor(tag.textColor) });
    chip.innerHTML = renderTagSpan(safe, i);
  };

  // 텍스트
  const txt = document.createElement('input'); txt.type = 'text'; txt.className = 'tag-text'; txt.value = tag.text || ''; txt.placeholder = '태그 텍스트';
  txt.oninput = () => { tag.text = txt.value; updateChip(); scheduleRender(); };
  card.appendChild(txt);

  // 스타일 + 배경(테두리)색 + 글자색
  const r1 = document.createElement('div'); r1.className = 'tag-row';
  const styleSel = document.createElement('select');
  for (const o of ['기본', '투명 배경', '그라데이션']) { const op = document.createElement('option'); op.value = op.textContent = o; styleSel.appendChild(op); }
  styleSel.value = tag.style || '기본';
  const bgLab = document.createElement('label'); bgLab.className = 'mini'; bgLab.textContent = tag.style === '투명 배경' ? '테두리색' : '배경색';
  const bg = document.createElement('input'); bg.type = 'color'; bg.value = tag.color || '#edf2f7';
  const tcLab = document.createElement('label'); tcLab.className = 'mini'; tcLab.textContent = '글자색';
  const tc = document.createElement('input'); tc.type = 'color'; tc.value = tag.textColor || '#2d3748';
  styleSel.onchange = () => { tag.style = styleSel.value; bgLab.textContent = tag.style === '투명 배경' ? '테두리색' : '배경색'; updateChip(); scheduleRender(); };
  bg.oninput = () => { tag.color = bg.value; updateChip(); scheduleRender(); };
  tc.oninput = () => { tag.textColor = tc.value; updateChip(); scheduleRender(); };
  r1.appendChild(styleSel); r1.appendChild(bgLab); r1.appendChild(bg); r1.appendChild(tcLab); r1.appendChild(tc);
  card.appendChild(r1);

  // 반경 + 폰트(rem)
  const miniRange = (labelText: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number, dec: number) => {
    const w = document.createElement('div'); w.className = 'tag-mini';
    const l = document.createElement('label'); l.className = 'mini'; l.textContent = labelText;
    const r = document.createElement('input'); r.type = 'range'; r.min = '' + min; r.max = '' + max; r.step = '' + step; r.value = '' + get();
    const v = document.createElement('span'); v.className = 'val'; const fmt = (x: number) => dec ? x.toFixed(dec) : '' + x; v.textContent = fmt(get());
    r.oninput = () => { const n = parseFloat(r.value); set(n); v.textContent = fmt(n); updateChip(); scheduleRender(); };
    w.appendChild(l); w.appendChild(r); w.appendChild(v); return w;
  };
  const r2 = document.createElement('div'); r2.className = 'tag-row';
  r2.appendChild(miniRange('반경', () => tag.borderRadius, (n) => tag.borderRadius = n, 0, 40, 1, 0));
  r2.appendChild(miniRange('폰트', () => tag.fontSize, (n) => tag.fontSize = n, 0.5, 1.5, 0.05, 2));
  card.appendChild(r2);

  // 패딩 세로(top=bottom) / 가로(left=right)
  const r3 = document.createElement('div'); r3.className = 'tag-row';
  r3.appendChild(miniRange('세로 여백', () => tag.padding.top, (n) => { tag.padding.top = n; tag.padding.bottom = n; }, 0, 2, 0.1, 1));
  r3.appendChild(miniRange('가로 여백', () => tag.padding.right, (n) => { tag.padding.right = n; tag.padding.left = n; }, 0, 2, 0.1, 1));
  card.appendChild(r3);

  updateChip();
  return card;
}

// ---------- 쌍 리스트 편집기 (이미지 매핑 tag→url, 단어 치환 from→to) ----------
// 사용자 텍스트는 input.value 로만 다룸 — raw innerHTML 주입 없음(§4 안전).
function buildPairEditor(host: HTMLElement, conf: PairConf) {
  host.innerHTML = '';
  const arr: any[] = settings[conf.arrKey];
  arr.forEach((item, i) => host.appendChild(pairRow(item, i, host, conf)));
  const add = document.createElement('button'); add.className = 'tag-add'; add.textContent = '+ 추가';
  add.onclick = () => { arr.push(conf.newItem()); buildPairEditor(host, conf); scheduleRender(); };
  host.appendChild(add);
}
function pairRow(item: any, i: number, host: HTMLElement, conf: PairConf) {
  const row = document.createElement('div'); row.className = 'pair-row';
  const mk = (key: string, label: string, ph: string) => {
    const wrap = document.createElement('div'); wrap.className = 'pair-field';
    const l = document.createElement('label'); l.className = 'mini'; l.textContent = label;
    const inp = document.createElement('input'); inp.type = 'text'; inp.value = item[key] || ''; inp.placeholder = ph;
    inp.oninput = () => { item[key] = inp.value; scheduleRender(); };
    wrap.appendChild(l); wrap.appendChild(inp); return wrap;
  };
  const del = document.createElement('button'); del.className = 'tag-del'; del.textContent = '삭제';
  del.onclick = () => { settings[conf.arrKey].splice(i, 1); buildPairEditor(host, conf); scheduleRender(); };
  row.appendChild(mk(conf.aKey, conf.aLabel, conf.aPh));
  row.appendChild(mk(conf.bKey, conf.bLabel, conf.bPh));
  row.appendChild(del);
  return row;
}

// ---------- 카드/모듈 드롭 + 파일 찾기 ----------
const dz = $('dropzone');
const cardFileInput = document.createElement('input');
cardFileInput.type = 'file'; cardFileInput.accept = '.charx,.png,.json,.risum'; cardFileInput.hidden = true;
dz.appendChild(cardFileInput);
dz.addEventListener('click', () => cardFileInput.click());          // 클릭=파일 찾기 창
cardFileInput.addEventListener('change', async () => { const f = cardFileInput.files && cardFileInput.files[0]; if (f) await loadCardFile(f); cardFileInput.value = ''; });
// ★드래그는 입력 pane 아무 데나 — 드래그 중에만 전체 오버레이를 띄우고, 어디에 놓아도 카드 로드(미니 버튼 자체 드롭 핸들러는 제거 → 중복 방지).
{
  const paneInput = document.querySelector('.pane-input') as HTMLElement | null;
  if (paneInput) {
    let dragDepth = 0;
    const hasFiles = (e: DragEvent) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0);
    paneInput.addEventListener('dragenter', (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; paneInput.classList.add('drag-active'); });
    paneInput.addEventListener('dragover', (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); });
    paneInput.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) paneInput.classList.remove('drag-active'); });
    paneInput.addEventListener('drop', async (e: DragEvent) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      paneInput.classList.remove('drag-active'); dragDepth = 0;
      if (!f) return;                 // 파일 아니면(텍스트 드래그 등) 가로채지 않음 — 본문 텍스트 드롭은 그대로
      e.preventDefault(); await loadCardFile(f);
    });
  }
}

const MB = 1024 * 1024;
const CARD_SAVE_CAP = 50 * MB; // 이보다 큰 카드는 IndexedDB 자동저장 생략(모바일 쿼터 보호)

// 지금 편집기에 적용된 카드(바이트+이름) — 작품에 시드(연결)할 때 재사용. 드롭/복원 시 갱신.
let curCardBytes: Uint8Array | null = null;
let curCardName = '';
// 지금 편집기가 묶인 작품 키(?log로 연 기존 로그의 char 또는 ?work/칩으로 바인딩된 작품). 미바인딩이면 ''.
function currentWorkKey(): string { return (editingLog && editingLog.char) || boundWork || ''; }
// 현재 카드를 그 작품에 기억(연재 화마다 재드롭 안 하게). 50MB 초과는 store가 알아서 생략.
function seedWorkCard(char: string): Promise<void> { return (char && curCardBytes) ? idbSaveWorkCard(char, curCardName, curCardBytes).catch(() => {}) : Promise.resolve(); }

// bytes+이름 → 파싱·트레이·프로필 적용 (드롭/복원 공통). restore=true면 자동복원(저장 안 함).
function applyCard(bytes: Uint8Array, name: string) {
  const info = $('card-info'); info.hidden = false;
  const ca = document.getElementById('card-asset'); if (ca) (ca as HTMLDetailsElement).open = true;   // 카드 로드 = 카드·에셋 섹션 자동 펼침
  try {
    parsed = parseCard(bytes, name, { lazy: true }); // risum/charx 대형은 색인만, 블롭은 필요 시 복호
    applyTagScheme(parsed);
    loadedCardRegex = extractRegexScripts(parsed);
    settings.cardRegex = cardRegexOn ? loadedCardRegex : [];
    loadedCardCss = evalRisuCss(extractCardCss(parsed), { screenWidth: 1080 });
    settings.cardCss = cardCssOn ? loadedCardCss : '';
    Object.keys(urlCache).forEach((k) => delete urlCache[k]);
    const found = parsed.assets.filter((a: any) => a.found).length;
    const schemeNote = parsed.tagScheme && parsed.tagScheme.sep ? ` · 태그관례 "${esc(parsed.tagScheme.sep)}"` : '';
    const rxNote = loadedCardRegex.length ? ` · 표시 regex ${loadedCardRegex.length}개` : '';
    const cssNote = loadedCardCss ? ' · CSS 적용' : '';
    info.innerHTML = `<b>${esc(parsed.name || name)}</b> · ${esc(parsed.format)} · 에셋 ${found}/${parsed.assets.length}${schemeNote}${rxNote}${cssNote}`;
    const icon = parsed.assets.find((a: any) => a.found && (a.type === 'icon' || /icon/i.test(a.name)));
    if (icon) { cardIconUrl = decodedUrl(icon); settings.profile.imageUrl = cardIconUrl; }
    if (parsed.name) { settings.profile.botName = parsed.name; }
    curCardBytes = bytes; curCardName = name;   // 작품 시드용으로 기억
    syncControls();
    buildTray();
    scheduleRender();
    return true;
  } catch (err: any) { info.innerHTML = `❌ 파싱 실패: ${esc(err.message)}`; return false; }
}

async function loadCardFile(f: File) {
  const info = $('card-info'); info.hidden = false;
  if (f.size > 1200 * MB) { info.innerHTML = `⚠️ <b>${esc(f.name)}</b> — 1.2GB 초과 파일은 브라우저 메모리 한계로 미지원`; return; }
  info.textContent = f.size > 200 * MB ? '대형 파일 읽는 중… (잠시 걸릴 수 있어요)' : '읽는 중...';
  const bytes = new Uint8Array(await f.arrayBuffer());
  const okCard = applyCard(bytes, f.name);
  // 재방문 복원용 자동저장(50MB 이하만; 큰 모듈은 저장 생략하고 이전 저장도 비워 오복원 방지)
  if (okCard && f.size <= CARD_SAVE_CAP) idbSaveCard(f.name, bytes).catch(() => {});
  else idbClearCard().catch(() => {});
  // 작품에 묶인 편집기면(?work/?log) 그 작품에도 카드 연결 → 다음 화 열 때 자동 복원.
  if (okCard) { const wk = currentWorkKey(); if (wk) seedWorkCard(wk); }
  // ★데스크탑: 편집기에 넣은 봇카드/모듈도 관리실에 자동 보관(Phase 3 경로 동일) → 영속·재사용. 파일해시 dedup. 클라우드 보관 안 함(로컬만).
  if (okCard && isDesktop()) archiveFromEditor(bytes, f.name);
}
// 편집기 드롭 → 관리실 보관 + 규칙 KV + 에셋 인덱스(관리실 드롭과 동일). 백그라운드(편집 흐름 안 막음).
async function archiveFromEditor(bytes: Uint8Array, fileName: string) {
  try {
    const info = await extractSourceInfo(bytes, fileName);
    let assetCount = 0; try { const p = parseCardAssets(bytes, fileName); assetCount = (p.assets || []).filter((a: any) => a && a.found !== false).length; } catch (_) {}
    const name = info.name || fileName.replace(/\.[^.]+$/, '');
    const entry = await archiveSaveSource(bytes, { name, format: info.format || '', assetCount, ruleCount: (info.rules || []).length });
    const cssHide = (info as any).cssHide || [];   // ★backgroundHTML CSS 기본 숨김 클래스(관리실 2단계)
    let gotCss = false;   // ★카드 CSS(관리실 3단계 "리스 스타일") — 이 기기 보관, 실패/없음이면 잔재 제거
    try { const b = (info as any).cssBundle; if (b) gotCss = saveCardCss(entry.id, Object.assign({ name }, b)); if (!gotCss) deleteCardCss(entry.id); } catch (_) {}
    if ((info.rules && info.rules.length) || cssHide.length || gotCss) {
      const r: any = kvLoad('pro2-cleanup-rules');
      const rr = (r && typeof r === 'object') ? { enabled: r.enabled !== false, sources: Array.isArray(r.sources) ? r.sources : [] } : { enabled: true, sources: [] };
      const prev = rr.sources.find((s: any) => s.id === entry.id);   // 리스 스타일 모드·규칙별 끄기(off) 보존
      rr.sources = rr.sources.filter((s: any) => s.id !== entry.id);
      const nextRules = info.rules || [];
      if (prev && Array.isArray(prev.rules)) {   // 관리실 carryRuleOff와 동일 로직[동기 유지]: 같은 in+out 규칙에 off 이식
        const offs = new Set(prev.rules.filter((r: any) => r && r.off === true).map((r: any) => r.in + ' ' + r.out));
        for (const r of nextRules) if (r && offs.has(r.in + ' ' + r.out)) r.off = true;
      }
      rr.sources.push({ id: entry.id, name, rules: nextRules, cssHide, addedAt: entry.addedAt, ...(prev && prev.cssMode === 'risu' ? { cssMode: 'risu' } : {}) });
      kvSave('pro2-cleanup-rules', rr);
    }
  } catch (e) { console.warn('[편집기→관리실] 자동 보관 실패', e); }
}

// ---------- IndexedDB(카드 자동복원) + 로그 보관함: store.ts로 이관(에디터·서재 페이지 공유) ----------
async function restoreLastCard() {
  try {
    const rec = await idbLoadCard();
    if (rec) applyCard(rec.bytes, rec.name); // 지난 세션 카드 자동 복원
  } catch (_) { /* IndexedDB 불가 환경이면 무시 */ }
}

function deriveTitle(text: string): string {
  const line = String(text || '').split('\n').map((s) => s.trim()).find((s) => s) || '';
  const t = line.replace(/<[^>]*>/g, '').replace(/\{\{[^}]*\}\}/g, '').replace(/\[[^\]]*\]/g, '').trim();
  return t ? (t.length > 36 ? t.slice(0, 36) + '…' : t) : '(제목 없음)';
}
const newLogId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
let editingLog: any = null;   // 서재에서 편집기로 연 로그(제자리 덮어쓰기 대상). null이면 새 화로 저장.

// 현재 편집 상태 → 보관함 레코드(디자인별 구조 포함). asNew=false + editingLog면 제자리 덮어쓰기.
// 새 로그(asNew)면 opts로 목적지를 지정한다: char=작품 키(기존 작품 키 또는 새 wk_ 키), title=화 제목, order=위치.
function buildLogRecord(asNew: boolean, opts?: { char?: string; title?: string; order?: number | null }): any {
  const o = opts || {};
  const isDiary = settings.template === 'log-diary';
  const isPapaT = settings.template === 'papa';
  const dcfg = isDiary ? ((settings.templateSettings && settings.templateSettings['log-diary']) || {}) : null;
  const derivedChar = isDiary
    ? ((dcfg.coverTitle || (dcfg.profiles && dcfg.profiles[0] && dcfg.profiles[0].name) || '').trim() || '다이어리')
    : isPapaT ? '담은 로그'
    : ((settings.profile.botName || '').trim() || '기타');
  const newChar = (o.char && o.char.trim()) ? o.char.trim() : derivedChar;  // 새로 저장 시 목적지 작품 키 지정
  // 제목: 파파는 입력칸이 비어(다중 블록은 blocks에 있음) → 살균 합본(lastCard)에서 첫 텍스트로 파생.
  const derivedTitle = (isDiary && dcfg.coverTitle && dcfg.coverTitle.trim()) ? dcfg.coverTitle.trim() : deriveTitle(isPapaT ? lastCard : currentInputText());
  const overwrite = !asNew && !!editingLog;
  const rec: any = {
    id: overwrite ? editingLog.id : newLogId(),
    char: overwrite ? editingLog.char : newChar,
    title: overwrite ? (editingLog.title || derivedTitle) : (o.title != null ? o.title : derivedTitle),
    date: overwrite ? editingLog.date : new Date().toISOString().slice(0, 10),
    input: currentInputText(), html: lastCard,
    template: settings.template || 'card',
  };
  if (overwrite && editingLog.order != null) rec.order = editingLog.order; // 같은 자리 유지
  else if (!overwrite && o.order != null) rec.order = o.order;             // 목적지 위치(맨앞/사이=정수, 맨끝=null)
  // 디자인별 구조 저장 → 다시 열면 그대로 복원.
  if (isDiary) rec.diary = JSON.parse(JSON.stringify(dcfg));
  else if (settings.template === 'chat') rec.chat = JSON.parse(JSON.stringify((settings.templateSettings && settings.templateSettings.chat) || {}));
  else if (settings.template === 'webnovel') rec.webnovel = JSON.parse(JSON.stringify((settings.templateSettings && settings.templateSettings.webnovel) || {}));
  else if (settings.template === 'card' && cardBlocksActive()) rec.cardCfg = JSON.parse(JSON.stringify(settings.templateSettings.card));
  else if (settings.template === 'custom-css') { rec.userCardCss = String(settings.userCardCss || ''); if (settings.cssBase) rec.cssBase = settings.cssBase; }
  // ★파파모드 = 통째 보관: html(살균 합본, 다중 블록은 구분자로 이음)만 영속. 변환 입력칸·역할구조 없음(rec.input 비움 → 미살균 원본 영속 안 함).
  //   재열람·재편집은 rec.papa.blocks(다중) 또는 rec.html(단일)로 복원.
  if (isPapaT) {
    rec.input = '';
    const pcfg = (settings.templateSettings && settings.templateSettings.papa) || {};
    rec.papa = { useBlocks: !!pcfg.useBlocks, blocks: JSON.parse(JSON.stringify(Array.isArray(pcfg.blocks) ? pcfg.blocks : [])) };
  }
  return rec;
}
async function saveLog(asNew: boolean, opts?: { char?: string; title?: string; order?: number | null; newWorkName?: string }): Promise<boolean> {
  if (!lastCard.trim()) { flash('btn-archive-save', '저장할 내용 없음'); return false; }
  const wasEditing = !asNew && !!editingLog;
  const o = opts || {};
  // 새 작품(목적지 모달이 만든 wk_ 키)이면 표시이름을 메타에 먼저 등록(이름↔키 분리).
  if (asNew && o.newWorkName != null && o.char) {
    try { const mm = (await metaGet(o.char)) || {}; await metaSet({ char: o.char, cover: mm.cover || '', desc: mm.desc || '', name: o.newWorkName }); } catch (_) {}
  }
  const rec = buildLogRecord(asNew, o);
  try {
    await logsAdd(rec);
    editingLog = { id: rec.id, char: rec.char, title: rec.title, date: rec.date, order: rec.order, template: rec.template }; // 이후 보관은 이 로그를 덮어씀
    // 📕로 지정해둔 표지가 있으면 이 작품의 서재 표지로 박는다(기존 표지 있어도 덮어씀).
    if (pendingSeriesCover && rec.char) {
      try {
        const cover = await downscaleDataUrl(pendingSeriesCover, 720);
        const m = (await metaGet(rec.char)) || {};
        await metaSet({ char: rec.char, cover, desc: m.desc || '', name: m.name || '' });
      } catch (_) {}
      pendingSeriesCover = '';
    }
    refreshArchiveSaveUI();
    flash('btn-archive-save', icon('check') + (wasEditing ? ' 제자리 수정 저장됨!' : ' 보관됨!'));
    popEl('btn-archive-save', 'save-pop');                 // 저장 성공 = 살짝 팝(만족 피드백)
    await updateArchiveCount();
    const bdg = document.getElementById('archive-count'); if (bdg && !(bdg as HTMLElement).hidden) popEl('archive-count', 'badge-bounce');   // 서재 배지 +1 바운스
    return true;
  } catch (_) { flash('btn-archive-save', '저장 실패'); return false; }
}
// 보관/새로저장 버튼 표시 + ★목적지 표기: 기존 로그 수정=💾 수정 저장 / 작품 바인딩=📥 보관 → 〈작품명〉 / 미바인딩=📥 보관…
function refreshArchiveSaveUI() {
  const save = document.getElementById('btn-archive-save'); const neu = document.getElementById('btn-archive-new');
  if (neu) (neu as HTMLElement).hidden = !editingLog;
  if (!save) return;
  if (editingLog) { save.innerHTML = icon('save') + ' 수정 저장'; return; }
  const wk = boundWork || '';
  if (wk) {
    save.innerHTML = icon('archiveDown') + ' 보관 → …';   // 작품명은 메타에서 비동기로 채움(이름↔키 분리)
    metaGet(wk).then((m) => { if (!editingLog && (boundWork || '') === wk) save.innerHTML = icon('archiveDown') + ' 보관 → ' + esc((m && m.name) || wk); })
      .catch(() => { if (!editingLog && (boundWork || '') === wk) save.innerHTML = icon('archiveDown') + ' 보관 → ' + esc(wk); });
  } else {
    save.innerHTML = icon('archiveDown') + ' 보관…';   // 빠른제작 = 저장 시 목적지 모달
  }
}
// 저장 후 바인딩(log/work) 모드면 그 로그 열람화면으로 복귀. 미바인딩(빠른제작)은 편집기에 머무름.
function afterSaveNav() { if (BOUND && editingLog) location.href = 'reader.html#/log/' + encodeURIComponent(editingLog.char) + '/' + encodeURIComponent(editingLog.id); }
// 목적지 모달 → 작품/위치/제목 선택 → (위치 정규화로 바뀐 형제 화 먼저 저장 후) 새 로그로 보관(미바인딩 경로).
async function saveViaDestModal(defaultChar?: string) {
  if (!lastCard.trim()) { flash('btn-archive-save', '저장할 내용 없음'); return; }
  const dest = await showSaveDestModal(defaultChar);
  if (!dest) return;
  for (const u of dest.siblings) { try { u.rec.order = u.order; await logsAdd(u.rec); } catch (_) {} }   // 끼워넣기로 밀린 형제 화 order만 갱신
  const ok = await saveLog(true, { char: dest.char, title: dest.title, order: dest.order, newWorkName: dest.newWorkName });
  if (ok) { await seedWorkCard(dest.char); updateChip(); afterSaveNav(); }   // 빠른제작 카드를 고른 작품에 시드
}
$('btn-archive-save').addEventListener('click', async () => {
  // ① 편집 중(기존 로그) = 제자리 덮어쓰기(모달 없음). 다른 작품으로 옮겨졌으면 밀린 형제 화 먼저 갱신.
  if (editingLog) {
    for (const u of moveSiblings) { try { u.rec.order = u.order; await logsAdd(u.rec); } catch (_) {} }
    moveSiblings = [];
    const ok = await saveLog(false); if (ok) { await seedWorkCard(editingLog.char); updateChip(); afterSaveNav(); } return;
  }
  // ② 작품에 바인딩됨(새 화) = 모달 없이 그 작품·정한 위치로 바로 저장(하드 바인딩).
  if (boundWork) {
    for (const u of boundSiblings) { try { u.rec.order = u.order; await logsAdd(u.rec); } catch (_) {} }
    boundSiblings = [];
    const ok = await saveLog(true, { char: boundWork, order: boundOrder, newWorkName: boundNewName || undefined });
    if (ok) { await seedWorkCard(boundWork); updateChip(); afterSaveNav(); } return;
  }
  // ③ 미바인딩(빠른 제작) = 목적지 모달.
  await saveViaDestModal();
});
{
  const n = document.getElementById('btn-archive-new');
  // "새로 저장" = 편집 중이어도 현재 내용을 새 로그로(목적지 모달). 기본 선택=지금 편집 중인 작품.
  if (n) n.addEventListener('click', () => { saveViaDestModal((editingLog && editingLog.char) || boundWork || undefined); });
}

// 보관 목적지 모달 — 어느 작품/어디 위치/무슨 제목으로 저장할지 고른다. 작품은 드롭다운에서 골라(타이핑 아님 = 오타로
// 새 작품 생기는 사고 차단) 그 작품의 불변 키를 박는다. "새 작품"이면 새 wk_ 키 + 표시이름. 취소면 null.
let destModalOpen = false;   // ★단일 인스턴스 가드 — 빠르게 여러 번 눌러도 모달 1개만(겹침 방지).
async function showSaveDestModal(defaultChar?: string): Promise<{ char: string; newWorkName?: string; title: string; order: number | null; siblings: { rec: any; order: number }[] } | null> {
  if (destModalOpen) return null;
  destModalOpen = true;
  // ★즉시 표시: 작품 목록은 로컬 캐시(IndexedDB)에서 읽는다 — 로그인 상태에서도 클라우드 왕복을
  //   기다리지 않아 모달이 바로 뜬다(앱은 클라우드를 로컬로 미러하므로 거의 항상 최신). 저장은 기존대로 정확한 키.
  let logs: any[] = []; let metas: any[] = [];
  try { logs = await LocalBackend.logsAll(); } catch (_) {}
  try { metas = (LocalBackend.metaAll ? await LocalBackend.metaAll() : []); } catch (_) {}
  const metaBy: Record<string, any> = {}; for (const m of metas) if (m && m.char) metaBy[m.char] = m;
  const groups: Record<string, any[]> = {}; for (const r of logs) { if (r && r.char != null) (groups[r.char] || (groups[r.char] = [])).push(r); }
  for (const m of metas) if (m && m.char && !groups[m.char]) groups[m.char] = [];   // 빈 작품(메타만)도 목적지 후보에
  const eord = (x: any) => (x && x.order != null ? x.order : 1e9);
  const sortE = (a: any[]) => a.slice().sort((x, y) => (eord(x) - eord(y)) || String(x.date || '').localeCompare(String(y.date || '')) || String(x.id || '').localeCompare(String(y.id || '')));
  const fImg = (h: string) => { const m = /<img[^>]+src=["']([^"']+)["']/i.exec(h || ''); return m ? m[1] : ''; };
  const works = Object.keys(groups).map((char) => {
    const eps = sortE(groups[char]);
    return { char, name: (metaBy[char] && metaBy[char].name) || char, cover: (metaBy[char] && metaBy[char].cover) || eps.map((e) => fImg(e.html)).find(Boolean) || '', eps };
  }).sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  // buildLogRecord와 동일한 파생 이름/제목(기본값).
  const isDiary = settings.template === 'log-diary';
  const dcfg = isDiary ? ((settings.templateSettings && settings.templateSettings['log-diary']) || {}) : null;
  const derivedName = isDiary ? ((dcfg.coverTitle || (dcfg.profiles && dcfg.profiles[0] && dcfg.profiles[0].name) || '').trim() || '다이어리') : (settings.template === 'papa' ? '담은 로그' : ((settings.profile.botName || '').trim() || '기타'));
  const defaultTitle = (isDiary && dcfg.coverTitle && dcfg.coverTitle.trim()) ? dcfg.coverTitle.trim() : deriveTitle(currentInputText());

  return new Promise((resolve) => {
    const ov = document.createElement('div'); ov.className = 'import-modal';
    const card = document.createElement('div'); card.className = 'import-card';
    const done = (v: any) => { destModalOpen = false; ov.remove(); resolve(v); };
    card.appendChild(Object.assign(document.createElement('div'), { className: 'import-title', textContent: '어디에 보관할까요?' }));
    const row = (label: string, el: HTMLElement) => { const r = document.createElement('label'); r.className = 'import-row'; const s = document.createElement('span'); s.textContent = label; r.append(s, el); card.appendChild(r); return r; };

    const NEW = 'new';
    const workSel = document.createElement('select');
    for (const w of works) { const o = document.createElement('option'); o.value = w.char; o.textContent = `${w.name} (${w.eps.length}화)`; workSel.appendChild(o); }
    { const o = document.createElement('option'); o.value = NEW; o.textContent = '＋ 새 작품 만들기'; workSel.appendChild(o); }   // option은 텍스트만(SVG 불가)
    row('작품', workSel);

    const cov = document.createElement('img'); cov.style.cssText = 'width:64px;height:64px;object-fit:cover;border-radius:8px;';
    const covRow = row('표지', cov);

    const nameIn = document.createElement('input'); nameIn.type = 'text'; nameIn.value = derivedName; nameIn.maxLength = 300;
    const nameRow = row('새 작품 이름', nameIn);

    const posSel = document.createElement('select'); const posRow = row('위치', posSel);
    const titleIn = document.createElement('input'); titleIn.type = 'text'; titleIn.value = defaultTitle; titleIn.maxLength = 200; row('이 화 제목', titleIn);

    const buildPos = (w: any) => {
      posSel.innerHTML = '';
      const add = (v: string, t: string) => { const o = document.createElement('option'); o.value = v; o.textContent = t; posSel.appendChild(o); };
      add('end', '맨 끝 (기본)');
      if (w && w.eps.length) { add('start', '맨 앞'); w.eps.forEach((e: any, i: number) => add('after:' + i, `${i + 1}화 뒤에` + (e.title ? ` · ${e.title}` : ''))); }
    };
    const syncSel = () => {
      const isNew = workSel.value === NEW;
      const w = isNew ? null : works.find((x) => x.char === workSel.value);
      nameRow.style.display = isNew ? '' : 'none';
      covRow.style.display = (w && w.cover) ? '' : 'none'; if (w && w.cover) cov.src = w.cover;
      posRow.style.display = isNew ? 'none' : '';
      if (!isNew) buildPos(w);
    };
    workSel.onchange = syncSel;

    // 기본 선택: ①편집 중이던 작품 ②파생 이름과 같은 기존 작품 ③없으면 새 작품(이름=파생값).
    let presel = '';
    if (defaultChar && works.some((w) => w.char === defaultChar)) presel = defaultChar;
    else { const byName = works.find((w) => w.name === derivedName); if (byName) presel = byName.char; }
    workSel.value = presel || NEW; syncSel();

    const btns = document.createElement('div'); btns.className = 'import-btns';
    const go = document.createElement('button'); go.className = 'primary'; go.textContent = '보관';
    const cancel = document.createElement('button'); cancel.textContent = '취소'; cancel.onclick = () => done(null);
    go.onclick = () => {
      const title = titleIn.value.trim() || defaultTitle;
      if (workSel.value === NEW) { done({ char: newWorkKey(), newWorkName: (nameIn.value.trim() || derivedName), title, order: null, siblings: [] }); return; }
      const w = works.find((x) => x.char === workSel.value)!;
      const pv = posSel.value; let order: number | null = null; const siblings: { rec: any; order: number }[] = [];
      if (pv !== 'end') {
        const ins = pv === 'start' ? 0 : (parseInt(pv.split(':')[1], 10) + 1);
        // 끼워넣기 = 그 작품 화들에 0..n 정수 자리를 다시 매겨 빈칸(ins)에 새 화. order 안 바뀐 형제는 안 건드림.
        w.eps.forEach((e: any, i: number) => { const no = i < ins ? i : i + 1; if (e.order !== no) siblings.push({ rec: e, order: no }); });
        order = ins;
      }
      done({ char: w.char, title, order, siblings });
    };
    btns.append(go, cancel); card.appendChild(btns);
    ov.appendChild(card); document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov) done(null); });
    setTimeout(() => { try { titleIn.focus(); titleIn.select(); } catch (_) {} }, 0);
  });
}

// 현재 디자인의 글쓰기 내용만 비운다(카드·에셋·설정·표지는 유지). 빈 새 화 시작에도 재사용.
function clearActiveContent() {
  const t = settings.template;
  if (t === 'log-diary') {
    templateConfig('log-diary').pages = [{ itemType: 'section', title: '', subtitle: '', image: '' }, { itemType: 'page', title: '', subtitle: '', content: '' }];
  } else if (t === 'chat') {
    templateConfig('chat').messages = [{ role: 'user', text: '' }];
  } else if (t === 'webnovel') {
    const cfg = templateConfig('webnovel'); if (Array.isArray(cfg.blocks) && cfg.blocks.length) cfg.blocks = [{ title: '', content: '' }];
    inputEl.value = '';
  } else if (t === 'papa') {
    const cfg = templateConfig('papa'); if (Array.isArray(cfg.blocks) && cfg.blocks.length) cfg.blocks = [{ html: '' }];
    papaCollapsed = {}; inputEl.value = '';
  } else { // card / custom-css
    const cfg = (settings.templateSettings && settings.templateSettings.card) || {};
    if (Array.isArray(cfg.blocks) && cfg.blocks.length) cfg.blocks = [{ title: '', subtitle: '', content: '' }];
    inputEl.value = '';
  }
}
// 입력란 비우기 버튼: 확인 후 내용 비우고 미바인딩으로(다음 "보관"은 목적지 모달).
async function clearInput() {
  if (currentInputText().trim() && !(await confirmModal('현재 입력 내용을 비울까요? (불러온 카드·설정·표지는 그대로 둡니다)', { okText: '비우기' }))) return;
  clearActiveContent();
  editingLog = null;   // 새로 쓰기 → 다음 "보관"은 새 로그로
  activeEditor = inputEl;
  updateInputMode(); scheduleRender(); refreshArchiveSaveUI(); updateChip();
}
{ const c = document.getElementById('btn-clear-input'); if (c) c.addEventListener('click', clearInput); }

// 서재(library.html)로 이동. 버튼에 저장 로그 개수 배지 표시.
$('btn-archive').addEventListener('click', () => { location.href = 'library.html'; });
{ const hb = document.getElementById('btn-help'); if (hb) hb.addEventListener('click', () => { location.href = 'help.html#editor'; }); }   // 사용설명서
{ const b = document.getElementById('brand'); if (b) b.onclick = () => { location.href = 'library.html#/'; }; }   // 로고 = 서재 홈
async function updateArchiveCount() {
  const badge = document.getElementById('archive-count'); if (!badge) return;
  // ★로컬 미러 기준으로 센다 — 보관은 항상 로컬 IndexedDB에 먼저 쓰이고(로그인 시 클라우드도 로컬로 미러),
  //   클라우드(logsAll)는 Firestore 왕복이라 방금 저장분이 늦게 반영돼 배지가 안 늘어 보였다(버그).
  let n = 0; try { n = (await LocalBackend.logsAll()).length; } catch (_) { try { n = (await logsAll()).length; } catch (__) {} }
  if (n > 0) { badge.textContent = String(n); badge.hidden = false; } else { badge.hidden = true; }
}
updateArchiveCount();
// 데스크탑 수동 동기화(불러오기/저장) 완료 → 서재 개수 배지 갱신(로컬 미러 기준).
window.addEventListener('pro2-desktop-synced', () => { try { updateArchiveCount(); } catch (_) {} });
mountUpdateBanner();   // 데스크탑: 새 버전 받아지면 재시작 배너
// 커스텀 폰트: 저장된 UI 폰트 즉시 적용 + 데스크탑이면 폰트 등록 후 미리보기 재렌더(@font-face 반영).
applyUiFont();
if (fontsSupported()) { refreshFonts().then(() => { applyUiFont(); scheduleRender(); }).catch(() => {}); }

// ---------- 에셋 트레이 (검색 필터 + 클릭 삽입) ----------
const isIconAsset = (a: any) => a.type === 'icon' || /icon/i.test(a.name || '');
let trayFilter: 'all' | 'icon' | 'emotion' = 'all';
let trayQuery = '';
let trayPage = 0;              // 현재 페이지(0-based). 페이지당 TRAY_PAGE개씩 → 보이는 것만 디코딩.
const TRAY_PAGE = 60;
function buildTray() {
  const tray = $('tray'); tray.hidden = false; tray.innerHTML = '';
  trayAssets = parsed.assets.filter((a: any) => a.found);
  trayFilter = 'all'; trayQuery = ''; trayPage = 0;
  const search = document.createElement('input'); search.type = 'search'; search.className = 'tray-search';
  search.placeholder = `에셋 검색 (${trayAssets.length}개)`;
  search.oninput = () => { trayQuery = search.value; trayPage = 0; renderTrayGrid(); };
  tray.appendChild(search);
  // 타입별 탭(아이콘/감정) — 두 종류가 다 있을 때만 노출(아니면 무의미)
  const iconN = trayAssets.filter(isIconAsset).length;
  const emoN = trayAssets.length - iconN;
  if (iconN > 0 && emoN > 0) {
    const tabs = document.createElement('div'); tabs.className = 'tray-tabs';
    const defs: Array<[typeof trayFilter, string, number]> = [['all', '전체', trayAssets.length], ['icon', '아이콘', iconN], ['emotion', '감정', emoN]];
    for (const [key, label, count] of defs) {
      const b = document.createElement('button'); b.className = 'tray-tab' + (key === trayFilter ? ' active' : '');
      b.textContent = `${label} ${count}`; b.dataset.key = key;
      b.onclick = () => { trayFilter = key; trayPage = 0; tabs.querySelectorAll('.tray-tab').forEach((el) => el.classList.toggle('active', (el as HTMLElement).dataset.key === key)); renderTrayGrid(); };
      tabs.appendChild(b);
    }
    tray.appendChild(tabs);
  }
  const grid = document.createElement('div'); grid.className = 'tray-grid'; grid.id = 'tray-grid';
  tray.appendChild(grid);
  // 페이지 네비게이션(스크롤 박스 밖 → 항상 보임). renderTrayGrid가 내용 갱신.
  const nav = document.createElement('div'); nav.className = 'tray-nav'; nav.id = 'tray-nav';
  nav.innerHTML = '<button class="tray-pg" data-d="-1">‹ 이전</button><span class="tray-pos"></span><button class="tray-pg" data-d="1">다음 ›</button>';
  nav.querySelectorAll('.tray-pg').forEach((b) => (b as HTMLButtonElement).onclick = () => { trayPage += Number((b as HTMLElement).dataset.d); renderTrayGrid(); });
  tray.appendChild(nav);
  renderTrayGrid();
}
function renderTrayGrid() {
  const grid = $('tray-grid'); grid.innerHTML = '';
  const ql = trayQuery.trim().toLowerCase();
  const inFilter = (a: any) => trayFilter === 'all' || (trayFilter === 'icon' ? isIconAsset(a) : !isIconAsset(a));
  const matches = trayAssets.filter((a) => inFilter(a) && (!ql || (a.name && a.name.toLowerCase().includes(ql)) || (a.tag && a.tag.toLowerCase().includes(ql))));
  const total = matches.length;
  const pages = Math.max(1, Math.ceil(total / TRAY_PAGE));
  if (trayPage < 0) trayPage = 0; if (trayPage > pages - 1) trayPage = pages - 1; // 클램프
  const start = trayPage * TRAY_PAGE;
  for (const a of matches.slice(start, start + TRAY_PAGE)) {
    const t = document.createElement('div'); t.className = 'thumb'; t.title = a.name;
    const img = document.createElement('img'); img.loading = 'lazy'; img.src = decodedUrl(a);
    img.draggable = false; // 썸네일 img를 끌면 data URL이 텍스트로 떨어지는 브라우저 기본동작 차단
    const s = document.createElement('span'); s.textContent = a.tag || a.name;
    t.appendChild(img); t.appendChild(s);
    t.onclick = () => insertTag(a.name);
    // 호버 시 큰 미리보기(58px 조각 구분 쉽게) + 그 안에 프로필/표지 버튼. 이미 디코딩된 썸네일 src 재사용.
    t.addEventListener('mouseenter', () => showThumbPop(img.src, a.name, t, a));
    t.addEventListener('mouseleave', scheduleHidePop);
    // 드래그하면 data URL 대신 삽입 태그 텍스트가 들어가게
    t.draggable = true;
    t.addEventListener('dragstart', (e) => { hideThumbPop(); try { (e as DragEvent).dataTransfer!.setData('text/plain', nativeInsertTemplate(a.name) || `{{img::${a.name}}}`); } catch (_) {} });
    grid.appendChild(t);
  }
  if (!total) { const m = document.createElement('div'); m.className = 'tray-note'; m.textContent = '일치하는 에셋 없음'; grid.appendChild(m); }
  grid.scrollTop = 0; // 페이지 넘기면 위로
  // 네비게이션 갱신(페이지 1개뿐이면 숨김)
  const nav = $('tray-nav'); nav.hidden = pages <= 1;
  const pos = nav.querySelector('.tray-pos'); if (pos) pos.textContent = total ? `${trayPage + 1} / ${pages}  ·  ${start + 1}–${Math.min(start + TRAY_PAGE, total)} / ${total}` : '0';
  const btns = nav.querySelectorAll('.tray-pg');
  (btns[0] as HTMLButtonElement).disabled = trayPage <= 0;
  (btns[1] as HTMLButtonElement).disabled = trayPage >= pages - 1;
}

// ---------- 썸네일 호버 큰 미리보기 (body에 fixed로 띄워 스크롤 박스에 안 잘림) ----------
// 확대창 안에 프로필/표지 지정 버튼을 둔다. 썸네일→확대창으로 마우스를 옮길 때 안 사라지게
// "호버 인텐트"(숨김 지연)를 쓴다: 썸네일에서 벗어나도 잠깐 기다렸다가, 그 사이 확대창으로
// 들어오면 숨김을 취소.
let trayHoverEl: HTMLElement | null = null;
let popAsset: any = null;       // 확대창이 지금 보여주는 에셋 (버튼이 이걸로 지정)
let popHideTimer: any = null;
function buildThumbPop() {
  const pop = document.createElement('div'); pop.className = 'thumb-pop';
  const img = document.createElement('img'); img.alt = '';
  const span = document.createElement('span');
  const acts = document.createElement('div'); acts.className = 'pop-acts';
  // ★캡처한 에셋(a)을 핸들러에 넘긴다 — hideThumbPop()이 전역 popAsset을 null로 만들기 때문에
  //   fn 안에서 popAsset을 다시 읽으면 null이 되어 "먹통"이 됐다(버그). 캡처본을 전달해 고침.
  const mk = (label: string, fn: (a: any) => void) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pop-act'; b.innerHTML = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); const a = popAsset; hideThumbPop(); if (a) fn(a); });
    return b;
  };
  acts.appendChild(mk(icon('user') + ' 프로필', (a) => setAssetAsProfile(a)));
  acts.appendChild(mk(icon('bookmark') + ' 표지', (a) => setAssetAsCover(a)));
  pop.append(img, span, acts);
  // 확대창에 마우스가 있으면 안 사라짐. 나가면 숨김.
  pop.addEventListener('mouseenter', () => { if (popHideTimer) { clearTimeout(popHideTimer); popHideTimer = null; } });
  pop.addEventListener('mouseleave', hideThumbPop);
  document.body.appendChild(pop);
  return pop;
}
function showThumbPop(src: string, name: string, anchor: HTMLElement, asset?: any) {
  if (!src) return;
  if (popHideTimer) { clearTimeout(popHideTimer); popHideTimer = null; }
  if (!trayHoverEl) trayHoverEl = buildThumbPop();
  const pop = trayHoverEl;
  popAsset = asset || null;
  (pop.querySelector('img') as HTMLImageElement).src = src;
  (pop.querySelector('span') as HTMLElement).textContent = name;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const pw = 216, ph = 290; // 미리보기 대략 크기(버튼 줄 포함)
  let x = r.right + 8; if (x + pw > window.innerWidth) x = r.left - pw - 8; if (x < 4) x = 4;
  let y = r.top - 8; if (y + ph > window.innerHeight) y = window.innerHeight - ph - 4; if (y < 4) y = 4;
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
}
// 썸네일에서 마우스가 벗어남 → 바로 숨기지 말고 잠깐 기다림(확대창으로 옮길 시간).
function scheduleHidePop() {
  if (popHideTimer) clearTimeout(popHideTimer);
  popHideTimer = setTimeout(hideThumbPop, 180);
}
function hideThumbPop() {
  if (popHideTimer) { clearTimeout(popHideTimer); popHideTimer = null; }
  if (trayHoverEl) trayHoverEl.hidden = true;
  popAsset = null;
}

// 카드가 고유 이미지 regex를 가지면 그 문법(예: <aoiimg src="이름">)을 삽입 → 카드 regex+CSS가 자동 적용.
// 없으면 기본 토큰 {{img::이름}}. (단순 패턴: in의 첫 캡처그룹을 이름으로 치환 + 앵커/이스케이프 정리)
function nativeInsertTemplate(name: string): string | null {
  for (const sc of (settings.cardRegex || [])) {
    const inPat = String(sc.in || '');
    if (!/\([^)]*\)/.test(inPat)) continue; // 캡처 그룹 없으면 스킵
    return inPat.replace(/\([^)]*\)/, name).replace(/^\^/, '').replace(/\$$/, '').replace(/\\(.)/g, '$1');
  }
  return null;
}
// 지정한 textarea의 커서 위치에 에셋 토큰 삽입(크게보기 모달 트레이도 이걸 씀).
function insertTokenInto(ta: HTMLTextAreaElement, name: string) {
  const native = nativeInsertTemplate(name);
  const tag = native || `{{img::${name}}}`;
  const s = ta.selectionStart ?? ta.value.length;
  let before = ta.value.slice(0, s), after = ta.value.slice(s);
  if (native) { // 카드 고유 태그는 블록 → 자체 문단으로 격리(인라인 mangle 회피)
    before = before.replace(/\s*$/, ''); after = after.replace(/^\s*/, '');
    ta.value = (before ? before + '\n\n' : '') + tag + (after ? '\n\n' + after : '');
  } else {
    ta.value = before + tag + after;
  }
  ta.focus();
  ta.dispatchEvent(new Event('input', { bubbles: true })); // 입력란/페이지 칸/크게보기 핸들러가 값 동기화 + 렌더
}
function insertTag(name: string) {
  insertTokenInto(activeTarget(), name); // 입력란 또는 마지막 포커스한 블록 칸
}

// ---------- 에셋을 프로필 사진 / 표지로 지정 (트레이 호버 버튼) ----------
let pendingSeriesCover = '';   // 📕로 고른 에셋 → 보관 시 그 작품의 서재 표지(meta.cover)로 박는다.
// data URL을 캔버스로 줄여 가벼운 JPEG로 (서재 표지 저장용 — Storage/CORS 안 거치고 빠르게).
function downscaleDataUrl(url: string, max: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.max(1, Math.round(w * r)); h = Math.max(1, Math.round(h * r)); }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); if (!ctx) { resolve(url); return; }
      ctx.drawImage(img, 0, 0, w, h);
      try { resolve(c.toDataURL('image/jpeg', 0.85)); } catch (_) { resolve(url); }
    };
    img.onerror = () => resolve(url);
    img.src = url;
  });
}
// 트레이 안에 잠깐 뜨는 안내(지정했는데 화면 변화가 없을 때 피드백).
function trayToast(msg: string) {
  const tray = document.getElementById('tray'); if (!tray) return;
  let el = tray.querySelector('.tray-toast') as HTMLElement | null;
  if (!el) { el = document.createElement('div'); el.className = 'tray-toast'; tray.appendChild(el); }
  el.textContent = msg; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout((el as any)._t); (el as any)._t = setTimeout(() => { if (el) el.classList.remove('show'); }, 1500);
}
function setAssetAsProfile(a: any) {
  const url = decodedUrl(a); if (!url) { trayToast('이미지를 읽지 못했어요'); return; }
  settings.profile.imageUrl = url;
  syncControls();        // 설정 ▸ 프로필 ▸ '프로필 사진' 썸네일 즉시 갱신
  scheduleRender();
  trayToast('프로필 사진으로 지정됨');
}
async function setAssetAsCover(a: any) {
  const url = decodedUrl(a); if (!url) { trayToast('이미지를 읽지 못했어요'); return; }
  const isDiary = settings.template === 'log-diary';
  if (isDiary) { templateConfig('log-diary').coverImage = url; syncControls(); scheduleRender(); } // 다이어리 표지 즉시 반영
  pendingSeriesCover = url;   // 모든 디자인: 보관 시 서재 작품표지로 박는다.
  // 편집 중(작품명을 이미 아는 로그)이면 서재 표지를 지금 바로 반영.
  if (editingLog && editingLog.char) {
    try {
      const cover = await downscaleDataUrl(url, 720);
      const m = (await metaGet(editingLog.char)) || {};
      await metaSet({ char: editingLog.char, cover, desc: m.desc || '', name: m.name || '' });
      trayToast('표지로 지정됨 (서재 반영)');
    } catch (_) { trayToast(isDiary ? '표지로 지정됨' : '표지로 지정됨 (보관 시 서재 표지로)'); }
  } else {
    trayToast(isDiary ? '표지로 지정됨' : '표지로 지정됨 (보관 시 서재 표지로)');
  }
}

// ---------- 복사 ----------
// RisuAI 모방: 클립보드에 넣기 전 모든 data: 이미지를 canvas로 재인코딩.
// 아카(Froala)는 붙여넣은 <img> data URL을 namu.la에 업로드하는데, webp/avif 원본은 업로드 실패가 잦음.
// → canvas로 재인코딩(아카 호환). 큰 이미지는 1600px로 다운스케일.
// ★형식 = JPEG(RisuAI와 동일: 아이콘 0.9 / 본문 0.6). PNG(무손실)은 data URL 용량이 커서 모바일 크롬의
//   clipboard.write가 거부하는 정황 → RisuAI가 폰에서 동작하는 JPEG를 그대로 따라간다. JPEG는 알파가 없으니
//   투명 영역은 흰색으로 채워 검정 박스를 막는다.
// crop = 목표 가로세로비(W/H). 1=중앙 정사각(border-radius:50% 원형 보장), 21/9 등=띠 크롭(표지·페이지 비율).
//   아카가 object-fit/aspect-ratio를 떼도 픽셀 자체가 그 비율이라 보장. null=크롭 없음.
function reencodeOne(url: string, crop: number | null, png: boolean): Promise<string> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      try {
        let sx = 0, sy = 0, sw = im.naturalWidth, sh = im.naturalHeight;
        if (crop != null && crop > 0) { // 목표비로 중앙 cover 크롭
          if (sw / sh > crop) { const nw = Math.round(sh * crop); sx = Math.round((sw - nw) / 2); sw = nw; }
          else { const nh = Math.round(sw / crop); sy = Math.round((sh - nh) / 2); sh = nh; }
        }
        const MAX = 1600; let w = sw, h = sh;
        if (Math.max(w, h) > MAX) { const k = MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d')!;
        if (!png) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); } // JPEG엔 알파 없음 → 흰 배경(검정박스 방지). PNG은 투명 보존.
        ctx.drawImage(im, sx, sy, sw, sh, 0, 0, w, h);
        resolve(png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', crop === 1 ? 0.9 : 0.6)); // PNG=무손실 / JPEG는 아이콘 0.9·본문 0.6
      } catch (_) { resolve(url); }
    };
    im.onerror = () => resolve(url);
    im.src = url;
  });
}
// img 태그별 크롭 결정: border-radius:50%=정사각(1), aspect-ratio:W/H=그 비율 띠, 없으면 크롭 없음(null).
function cropOf(tag: string): number | null {
  if (/border-radius:\s*50%/i.test(tag)) return 1;
  const m = /aspect-ratio:\s*([\d.]+)\s*\/\s*([\d.]+)/i.exec(tag);
  if (m) { const r = parseFloat(m[1]) / parseFloat(m[2]); return isFinite(r) && r > 0 ? r : null; }
  return null;
}
async function reencodeImagesForClipboard(html: string, png: boolean): Promise<string> {
  const srcOf = (tag: string) => { const m = /\bsrc="(data:image\/[^"]+)"/i.exec(tag); return m ? m[1] : null; };
  const jobs = new Map<string, string | null>(); // key = url|crop → 재인코딩 결과
  for (const tag of (html.match(/<img\b[^>]*>/gi) || [])) {
    if (/lp-baked/i.test(tag)) continue; // 구운 표지는 이미 합성됨 → 재인코딩 건너뜀(굽기 단계서 형식 결정)
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
// 아카(Froala)는 붙여넣을 때 태그 사이의 들여쓰기 공백을 &nbsp;로 바꿔 레이아웃(특히 태그 칩)을 망가뜨림.
// → 클립보드에 넣기 전 "줄바꿈이 든 태그 사이 공백"만 제거(>\s*\n\s*<). 글자 사이 단일 공백은 줄바꿈이 없어 보존됨.
const collapseWs = (h: string) => h.replace(/>\s*\n\s*</g, '><').trim();
$('btn-rich').addEventListener('click', async () => {
  if (!lastCard.trim()) { flash('btn-rich', '복사할 내용 없음'); return; }
  const b = $('btn-rich') as HTMLButtonElement;
  if (!b.dataset.label) b.dataset.label = b.textContent || '리치 복사'; // 진짜 원래 텍스트 1회 보관
  const orig = b.dataset.label;
  b.textContent = '이미지 변환 중...';
  try {
    const out = collapseWs(await reencodeImagesForClipboard(lastCard, !jpegMode)); // PNG(고화질)/JPEG(저화질·모바일) + 태그사이 공백 제거
    // RisuAI와 동일: text/plain엔 진짜 평문(입력 원문), text/html엔 꾸민 HTML. 값은 Blob(Promise 아님), await 후 write.
    await navigator.clipboard.write([new ClipboardItem({
      'text/plain': new Blob([currentInputText()], { type: 'text/plain' }),
      'text/html': new Blob([out], { type: 'text/html' }),
    })]);
    b.textContent = '복사됨!';
  } catch (e: any) {
    b.textContent = '복사 실패';
    statusEl.textContent = '복사 오류: ' + (e && e.message ? e.message : String(e)); // 실패 사유를 화면에 그대로(폰 진단용)
  }
  setTimeout(() => { b.textContent = orig; }, 1400); // 항상 원래 텍스트로 복귀(중첩 flash 버그 제거)
});
$('btn-source').addEventListener('click', async () => {
  if (!lastCard.trim()) { flash('btn-source', '복사할 내용 없음'); return; }
  try { await navigator.clipboard.writeText(collapseWs(lastCard)); flash('btn-source', '복사됨!'); }
  catch (e: any) { flash('btn-source', '실패'); }
});
function flash(id: string, msg: string) { const b = $(id) as HTMLButtonElement; const o = b.innerHTML; b.innerHTML = msg; setTimeout(() => b.innerHTML = o, 1200); }   // innerHTML 기반(아이콘 버튼 보존)
// CSS 애니메이션 재실행(클래스 제거 → 리플로 → 추가). 저장 성공 팝/배지 바운스용.
function popEl(id: string, cls: string) { const el = document.getElementById(id); if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), 700); }

// (PNG 저장 기능 제거 — 불필요. 카드 공유는 리치 복사로.)

// ── 셸 테마(라이트/다크/시스템) = appSettings 공용 모듈. 편집기는 적용만(토글 버튼은 서재). ──
initTheme();

// ── 계정 UI는 accountUI.ts(공용 모듈)로 분리 — 에디터·서재가 같은 로그인 UI를 씀. ──
//    아래 loadCloud에서 auth 로드 후 mountAccountUI(A) 호출.

// ── 셸 스킨 = appSettings 공용 모듈. 편집기는 저장된 스킨 룩을 적용만(드롭다운·빌더는 서재 "디자인 설정"). ──
applySkin(localStorage.getItem(SKIN_KEY) || 'atelier');   // custom: 스킨이면 내부에서 오버라이드까지 적용

// ---------- 프리셋 적용 헬퍼(내 프리셋 패널·세션복원이 사용) ----------
// 살균된 settings를 라이브 settings에 "제자리" 반영(B/P/D/T/AI 참조 유지 위해 sub객체는 Object.assign,
// 배열은 교체 — 편집기는 매 빌드 때 settings.tags 등을 새로 읽으므로 안전). 모듈 토글 변수도 복원.
function loadSettingsInto(s: any, ui: any) {
  Object.assign(B, s.box); Object.assign(P, s.profile); Object.assign(D, s.divider);
  Object.assign(T, s.text); Object.assign(AI, s.assetImage);
  settings.tags = s.tags; settings.imageMappings = s.imageMappings; settings.wordReplace = s.wordReplace;
  settings.darkMode = s.darkMode; settings.cardTextColor = s.cardTextColor;
  settings.template = s.template || 'card';
  settings.templateSettings = s.templateSettings || {};
  settings.userCardCss = sanitizeCss(s.userCardCss || '');
  // 카드 글자색: hex면 수동 지정 ON, 빈값이면 자동(다크모드 폴백)
  cardTextManual = !!s.cardTextColor;
  if (s.cardTextColor) lastCardText = s.cardTextColor;
  // 카드 토글(드롭한 카드가 있을 때만 효과; 미리 복원해도 무해)
  if (ui) {
    cardRegexOn = ui.cardRegexOn; cardCssOn = ui.cardCssOn;
    settings.cardRegex = cardRegexOn ? loadedCardRegex : [];
    settings.cardCss = cardCssOn ? loadedCardCss : '';
  }
}
// 프리셋 적용 = settings 반영 + 모든 컨트롤/동적 편집기 재빌드(③ 라운드트립 요구). 그 뒤 렌더.
function applyPreset(s: any, ui: any) { loadSettingsInto(s, ui); syncOutputDesignSelect(); updateInputMode(); buildControls(); scheduleRender(); }

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
// 바이트(zip 등) 다운로드 — 데스크탑/웹 공통(파일 하나라 기존 Blob 저장 그대로).
function downloadBytes(name: string, bytes: Uint8Array, mime: string) {
  const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
// (전체 백업/복원·Pro1 가져오기·고급 설정·내 폰트 = 서재 홈 ⚙ 메뉴로 이전 → settingsMenu.ts. 편집기엔 없음.)

// ---------- localStorage 자동 저장/복원 ----------
const LS_KEY = AUTOSAVE_KEY;  // store.ts 단일 출처(동기화 대상 KV)
let appliedAutoSavedAt = 0;   // 마지막으로 적용한 자동저장의 savedAt(클라우드가 더 최신일 때만 재적용)
let openedFromLibrary = false; // 서재에서 특정 로그를 열었는지 → 클라우드 동기화가 그 디자인을 덮지 않게
let saveT: any = null;
function saveLocal() {
  if (BOUND) return;   // 바인딩(log/work) 모드는 자동저장 안 함 → 빠른제작 초안을 안 건드림(결과는 "보관"으로 저장)
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    // 활성 디자인 설정 + 비활성 디자인 작업본(designStore)을 함께 저장 → 새로고침해도 디자인별로 유지.
    try {
      const bundle: any = buildBundle(settings, { cardRegexOn, cardCssOn, cardTextManual });
      bundle.designStore = Object.assign({}, clone(designStore));
      bundle.draftInput = inputEl.value;   // 작업 중인 입력 초안도 동기화(기기 간 이어쓰기)
      bundle.savedAt = Date.now();         // 클라우드가 '더 최신일 때만' 재적용하도록(불필요한 패널 재빌드 방지)
      appliedAutoSavedAt = bundle.savedAt;
      kvSave(LS_KEY, bundle);  // backend 경유
    } catch (_) {}
  }, 400);
}
// 사용자가 이 세션에 #input을 직접 건드렸는지 — 클라우드 동기화가 작업 중 입력을 덮어쓰지 않게.
let inputTouched = false;
function restoreLocal(applyDraft = true) {
  try {
    const obj = kvLoad(LS_KEY); if (!obj) return;  // backend 경유
    appliedAutoSavedAt = obj.savedAt || 0;
    const { settings: s, ui } = parseBundle(obj);
    loadSettingsInto(s, ui); // 컨트롤 빌드 전이므로 buildControls는 호출자(시작부)가 수행
    // 비활성 디자인 작업본 복원(있으면). 활성 디자인은 loadSettingsInto가 이미 라이브에 반영.
    if (obj.designStore && typeof obj.designStore === 'object') {
      for (const d of DESIGN_IDS) if (obj.designStore[d]) designStore[d] = clone(obj.designStore[d]);
    }
    // 작업 중 입력 초안 복원(단일 입력창). 클라우드 전환 시엔 사용자가 아직 안 쳤을 때만(작업 보호).
    if (applyDraft && typeof obj.draftInput === 'string') inputEl.value = obj.draftInput;
  } catch (_) {}
}

// ---------- 모바일 탭 전환 (좁은 화면에서만 보임; 데스크탑은 3열 그대로) ----------
const mtabs = document.getElementById('mtabs');
if (mtabs) mtabs.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!btn || !btn.dataset.pane) return;
  const target = btn.dataset.pane;
  document.querySelectorAll('.layout .pane').forEach((p) => p.classList.toggle('m-active', p.classList.contains(target)));
  mtabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
});

// ---------- 시작 ----------
inputEl.addEventListener('focus', () => { activeEditor = inputEl; });
inputEl.addEventListener('input', () => { sticky = ''; inputTouched = true; scheduleRender(); });
// 복사 형식 토글(저화질 JPEG). 기본 = 모바일 감지(모바일이면 켜짐), 사용자 선택은 localStorage 기억.
const chkJpeg = document.getElementById('chk-jpeg') as HTMLInputElement | null;
if (chkJpeg) {
  chkJpeg.checked = jpegMode;
  chkJpeg.addEventListener('change', () => {
    jpegMode = chkJpeg.checked;
    try { localStorage.setItem(JPEG_KEY, jpegMode ? '1' : '0'); } catch (_) {}
    scheduleRender(); // 표지를 그 형식으로 다시 구워 미리보기·복사 갱신
  });
}
// 서재로 돌아가기(바인딩 모드 ← 서재). 연 로그의 열람화면으로 "직접" 이동(history.back은 리다이렉트 엔트리로 한 번에 안 감).
function editBack() {
  // 작품 바인딩(작품→"새 화 쓰기")으로 왔으면 그 작품 페이지로. 기존 로그 수정은 그 로그 읽던 화면. 빠른 제작은 서재 홈.
  if (MODE_WORK) { location.href = 'library.html#/series/' + encodeURIComponent(MODE_WORK); return; }
  if (editingLog && editingLog.char && editingLog.id) location.href = 'reader.html#/log/' + encodeURIComponent(editingLog.char) + '/' + encodeURIComponent(editingLog.id);
  else location.href = 'library.html';
}
function injectEditBack() {
  const left = document.querySelector('.topbar-left') as HTMLElement | null;
  if (!left || left.querySelector('.edit-back')) return;
  const b = document.createElement('button'); b.className = 'edit-back';
  if (MODE_WORK) { b.textContent = '← 작품'; b.title = '이 작품 페이지로 돌아가기'; } else { b.textContent = '← 서재'; b.title = '서재로 돌아가기'; }
  b.onclick = editBack;
  left.insertBefore(b, left.firstChild);
}

// ── 컨텍스트 칩: 이 글이 어디로 보관될지 상단에 표시 + 클릭해 목적지 변경(기존 모달 재사용) ──
async function destWorkName(char: string): Promise<string> { try { const mm = await metaGet(char); if (mm && mm.name) return mm.name; } catch (_) {} return char; }
function injectChip() {
  // ★입력 pane 최상단(dest-row)에 — 이 글이 어디로 보관되는지 눈에 띄게(비우기와 한 줄). 없으면 헤더로 폴백.
  const row = (document.getElementById('dest-row') || document.querySelector('.topbar-left')) as HTMLElement | null;
  if (!row || row.querySelector('.dest-chip')) return;
  const c = document.createElement('button'); c.className = 'dest-chip'; c.title = '이 글이 보관될 작품 — 눌러서 바꾸기';
  c.onclick = changeDestination;
  row.insertBefore(c, row.firstChild); updateChip();   // 칩을 줄 맨 앞(비우기는 오른쪽)
}
async function updateChip() {
  const c = document.querySelector('.dest-chip') as HTMLElement | null; if (!c) return;
  if (editingLog) c.innerHTML = icon('folder') + ' ' + esc(await destWorkName(editingLog.char)) + ' · 수정 중';
  else if (boundWork) c.innerHTML = icon('folder') + ' ' + esc(boundNewName || await destWorkName(boundWork)) + ' · 새 화';
  else c.innerHTML = icon('pencil') + ' 새 글 · 저장 위치 고르기';
}
async function changeDestination() {
  const dest = await showSaveDestModal(editingLog ? editingLog.char : (boundWork || undefined));
  if (!dest) return;
  if (editingLog) {
    // 기존 로그를 다른 작품/위치로 이동(저장 때 반영). 새 작품이면 이름 즉시 등록.
    editingLog.char = dest.char; editingLog.order = dest.order; moveSiblings = dest.siblings;
    if (dest.newWorkName) { try { await metaSet({ char: dest.char, name: dest.newWorkName, cover: '', desc: '' }); } catch (_) {} }
  } else {
    boundWork = dest.char; boundNewName = dest.newWorkName || ''; boundOrder = dest.order; boundSiblings = dest.siblings;
    try { history.replaceState({}, '', 'index.html?work=' + encodeURIComponent(dest.char)); } catch (_) {}
  }
  updateChip(); setStatus('보관 위치를 바꿨습니다. “보관”을 누르면 적용됩니다.');
}

if (BOUND) {
  // ★세션복원(자동저장/카드강제/마지막카드/기본샘플) 스킵 → 의도한 내용만 로드 = 상태 경쟁 0.
  injectEditBack();
  if (MODE_WORK) {
    restoreLocal(false);   // 디자인·룩은 지난 설정 따르되(초안 텍스트는 미적용) 내용은 빈 새 화로
    clearActiveContent();
  }
  buildOutputDesignSelect();
  updateInputMode();
  buildControls();
  render();
  // 새 화(?work): 그 작품에 기억된 카드가 있으면 자동 복원 → 연재 화마다 재드롭 안 함.
  if (MODE_WORK) idbLoadWorkCard(MODE_WORK).then((rec) => { if (rec) { applyCard(rec.bytes, rec.name); scheduleRender(); } }).catch(() => {});
  // MODE_LOG: 아래 pendingOpenLogId(=?log) + tryOpenPending이 그 로그를 로드(카드는 openLogById가 복원).
} else {
  inputEl.value = '“안녕하세요!” 그녀가 밝게 웃으며 말했다. ‘오늘은 좋은 하루가 될 것 같아.’ 그녀는 속으로 생각했다.';
  restoreLocal();   // 지난 세션 설정 복원(있으면) — buildControls 전에 settings/토글변수 채움
  buildOutputDesignSelect();
  updateInputMode();
  buildControls();
  render();
  restoreLastCard(); // 지난 세션 카드(IndexedDB) 자동 복원 → 에셋 트레이·프로필·표시 regex 되살림
}
injectChip();   // 통합 편집기: 항상 컨텍스트 칩 표시(미바인딩=새 글, work/log=그 작품)

// 서재(library.html)의 "편집" → 키를 남기고 이 페이지로 옴: 그 로그를 편집기에 로드.
// 저장된 디자인(template) + 그 디자인의 구조(diary/cardCfg/userCardCss)를 그대로 복원.
// 서재 "편집" → OPEN_LOG_KEY로 넘어온 로그를 편집기에 로드(디자인·구조 복원).
// ★로그인 시: 시작 시점엔 아직 로컬 백엔드라 클라우드 로그를 못 찾는다 → id를 보류해 두고,
//   클라우드 백엔드로 바뀌면(loadCloud 콜백) 다시 시도한다.
let pendingOpenLogId = '';
if (MODE_LOG) {
  pendingOpenLogId = MODE_LOG;   // ?log=<id> → 그 로그를 로드(새로고침해도 URL에 있어 안전)
} else if (!BOUND) {
  try { pendingOpenLogId = localStorage.getItem(OPEN_LOG_KEY) || ''; localStorage.removeItem(OPEN_LOG_KEY); } catch (_) {}  // 옛 진입 경로 호환
}
async function openLogById(r: any) {
  if (!r) return;
  const tmpl = (r.template === 'log-diary' || r.template === 'custom-css' || r.template === 'chat' || r.template === 'webnovel' || r.template === 'papa') ? r.template : 'card';
  designStore[settings.template || 'card'] = captureLook(settings.template || 'card');
  settings.template = tmpl;
  settings.templateSettings = settings.templateSettings || {};
  if (tmpl === 'papa') {
    // 파파 = 통째 보관. 다중 블록이면 blocks 복원(블록 편집기), 단일이면 살균 html을 입력칸에 되돌림(재살균 멱등). 구조/카드 없음.
    const pcfg = (r.papa && typeof r.papa === 'object') ? r.papa : null;
    settings.templateSettings.papa = { useBlocks: !!(pcfg && pcfg.useBlocks), blocks: (pcfg && Array.isArray(pcfg.blocks)) ? JSON.parse(JSON.stringify(pcfg.blocks)) : [] };
    papaCollapsed = {};
    if (!(pcfg && pcfg.useBlocks)) inputEl.value = String((pcfg && pcfg.blocks && pcfg.blocks[0] && pcfg.blocks[0].html) || r.html || r.input || '');
  } else if (tmpl === 'log-diary') {
    settings.templateSettings['log-diary'] = r.diary && typeof r.diary === 'object' ? JSON.parse(JSON.stringify(r.diary)) : {};
    diaryCollapsed = {};
  } else if (tmpl === 'chat') {
    settings.templateSettings.chat = r.chat && typeof r.chat === 'object' ? JSON.parse(JSON.stringify(r.chat)) : {};
    chatCollapsed = {};
  } else if (tmpl === 'custom-css') {
    settings.userCardCss = sanitizeCss(r.userCardCss || '');
    settings.cssBase = (r.cssBase === 'webnovel') ? 'webnovel' : '';   // 명명 CSS 디자인 base 복원(웹소설 base 로그도 그대로 렌더)
    if (settings.templateSettings.card) settings.templateSettings.card.blocks = [];
    inputEl.value = r.input || '';
  } else if (tmpl === 'webnovel') {
    // 강조 노브(테마/대사강조/속마음/들여쓰기 등) 복원. 장 블록이면 블록 그대로, 아니면 입력란(프로즈) 기반.
    const wcfg = (r.webnovel && typeof r.webnovel === 'object') ? JSON.parse(JSON.stringify(r.webnovel)) : {};
    const legacyMsgs = Array.isArray(wcfg.messages) ? wcfg.messages.filter((m: any) => m && String(m.text || '').trim()) : [];
    wcfg.messages = [];   // 편집기는 messages 안 씀(채팅 가져오기는 블록으로 펼침)
    settings.templateSettings.webnovel = wcfg;
    if (wcfg.useBlocks && Array.isArray(wcfg.blocks) && wcfg.blocks.length) {
      wnCollapsed = {};   // 블록 모드 그대로 복원
    } else if (legacyMsgs.length > 1) {
      // 옛 채팅-가져오기 로그(messages만 있고 블록 없음) → 유저/캐릭터 턴마다 한 블록으로 펼쳐 분리(작업 4).
      wcfg.useBlocks = true; wcfg.blocks = legacyMsgs.map((m: any) => ({ role: m.role, title: '', content: String(m.text || '') }));   // role 보존(전환 시 분리 복원)
      wnCollapsed = {};
    } else {
      wcfg.useBlocks = false; wcfg.blocks = [];
    }
    inputEl.value = r.input || '';
  } else { // card
    if (r.cardCfg && Array.isArray(r.cardCfg.blocks) && r.cardCfg.blocks.length) {
      settings.templateSettings.card = JSON.parse(JSON.stringify(r.cardCfg)); // 다중 블록(역할 등) 그대로 복원 → 블록 모드 자동
    } else {
      settings.templateSettings.card = {};
      inputEl.value = r.input || '';
    }
  }
  // 제자리 덮어쓰기용: 이 로그가 편집 출처임을 기억.
  editingLog = { id: r.id, char: r.char, title: r.title, date: r.date, order: r.order, template: tmpl };
  boundWork = '';   // 기존 로그 수정 = editingLog 경로(새 화 바인딩 아님)
  openedFromLibrary = true;   // 클라우드 동기화가 이 디자인을 자동저장으로 덮어쓰지 않게
  sticky = '';
  syncOutputDesignSelect(); updateInputMode(); buildControls(); scheduleRender(); refreshArchiveSaveUI(); updateChip();
  // 그 작품에 기억된 카드가 있으면 자동 복원(에셋 트레이·{{img}} 해소) → 재드롭 없이 바로 편집.
  idbLoadWorkCard(r.char).then((rec) => { if (rec) { applyCard(rec.bytes, rec.name); scheduleRender(); } }).catch(() => {});
  setStatus(`불러온 로그를 수정 중 — “보관”하면 제자리에 덮어씁니다.`);
}
async function tryOpenPending() {
  if (!pendingOpenLogId) return;
  let r: any = null; try { r = (await logsAll()).find((x: any) => x.id === pendingOpenLogId); } catch (_) {}
  if (r) { pendingOpenLogId = ''; await openLogById(r); }
}
tryOpenPending();   // 로컬(비로그인)은 즉시 / 로그인은 클라우드 전환 후 loadCloud가 재시도

// ── 클라우드 동기화(4단계) + 경량 로딩 ──────────────────────────────
// 무거운 Firebase SDK는 첫 렌더를 막지 않도록 따로 불러온다(에디터 화면은 이미 떠 있음).
//  - auth.js(앱+로그인 SDK)만 먼저 → 로그인 UI + 세션 복원.
//  - firestore/storage(무거움)는 sync.js가 "로그인된 순간"에만 동적 로드(로그아웃 사용자는 안 받음).
(function loadCloud() {
  const start = () => import('./auth.js').then((A) => {
    if (!A.authAvailable()) { const g = document.getElementById('auth-group'); if (g) g.hidden = true; return; }
    mountAccountUI(A);   // (편집기 상단바엔 auth-group이 없어 사실상 no-op; 로그인 UI는 서재 ⚙. 동기화는 아래 initSync.)
    return import('./sync.js').then(({ initSync }) => initSync((kind: string) => {
      // ★방향 A: 클라우드 동기화는 "라이브 편집기"를 절대 안 건드린다(설정/디자인 재적용·패널 재빌드·재렌더 없음).
      //   설정은 시작할 때 1회만 로드(로컬 자동저장). 기기 간 설정 이어받기는 '다음에 새로 열 때' 반영됨(미러가 따라가므로).
      //   여기서는 (1)서재에서 연 로그(명시적 의도) 열기 (2)보관함 개수 (3)세션 플래그만 한다 → 편집 중 절대 안 끊김.
      try { tryOpenPending(); } catch (_) {}   // 명시적: 서재에서 "편집기로" 연 로그를 클라우드 붙은 뒤 찾아 열기
      // 중복 화 자동 정리(기기 왔다갔다로 같은 화가 2벌 된 것) → 끝나면 보관함 개수 갱신.
      try { dedupeLogsInStore().then((n) => { if (n > 0) { try { updateArchiveCount(); } catch (_) {} } }); } catch (_) {}
      try { updateArchiveCount(); } catch (_) {}
      try { markSessionSynced(); } catch (_) {}
      setStatus(kind === 'firebase' ? '클라우드 동기화 켜짐 — 이 기기에 로그인됨.' : '로컬 모드.');
    }, () => {
      // 실시간: 다른 기기에서 서재가 바뀌면 — 편집 중 방해 없이 보관함 개수만 갱신.
      try { updateArchiveCount(); } catch (_) {}
    }));
  }).catch((e) => console.warn('[cloud] 로드 실패 — 로컬 전용', e));
  setTimeout(start, 0);   // 첫 렌더 직후 즉시 클라우드 시작(지연 X) → 미러·세션 플래그가 서재 이동 전에 준비됨
})();

