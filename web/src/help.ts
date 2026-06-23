// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/help.ts — 인앱 사용설명서(전 화면·전 기능). 독립 페이지 help.html. 각 화면 '?'가 help.html#섹션으로 딥링크.
//   ★콘텐츠는 여기 SECTIONS 한 곳에서 관리(기능 바뀌면 갱신). 읽기 전용·셸만·이모지 0(전부 icon()).
// @ts-nocheck
import { icon } from './icons.js';

const SECTIONS = [
  { id: 'start', icon: 'flame', title: '시작하기', items: [
    'LogPapa는 AI 역할극 채팅 로그를 예쁜 카드로 꾸며 아카라이브 등에 붙여넣거나 내 서재에 보관하는 도구예요.',
    '기본 흐름: ① 편집기에 로그 붙여넣기 → ② 디자인 고르기 → ③ "복사"(아카에 이미지까지 그대로 붙음) 또는 서재에 보관.',
    '웹(logpapa.web.app)과 데스크탑 앱에서 똑같이 쓸 수 있고, 로그인하면 여러 기기가 동기화돼요.',
  ] },
  { id: 'editor', icon: 'pencil', title: '편집기', items: [
    '입력: 대화 로그를 붙여넣으면 화자·지문·대사를 인식해 카드로 변환해요. 제목·부제·접기 블록도 추가할 수 있어요.',
    '디자인: 채팅형(말풍선)·웹소설형(세로 읽기)·기본 카드·명명 CSS(내가 만든 CSS) 중 선택. 디자인마다 프리셋(설정 묶음)이 따로 저장돼요.',
    '프리셋: 자주 쓰는 설정을 저장·불러오기·파일로 내보내기. 디자인별 독립.',
    '복사: "복사"는 이미지까지 들어간 리치 HTML(아카 에디터에 그대로 붙음). 출력은 아카(Froala) 허용 태그·인라인 스타일에 맞춰 나와요.',
    '작품 바인딩: 어떤 작품의 새 화로 쓰면 그 작품에 묶여 보관이 빨라요. 봇카드를 넣으면 그 작품에 기억돼 다음 화에 자동 복원.',
    '카드 적용: 봇카드(.charx·.png·.json·.risum)를 드롭하면 캐릭터 이미지·표시 정규식이 로그에 적용돼요(에셋 트레이).',
  ] },
  { id: 'library', icon: 'book', title: '서재', items: [
    '서재 = 보관한 로그(작품·화) 모음. 작품 카드 → 화 목록 → 화를 누르면 리더로 열려요.',
    '읽음·이어보기: 읽은 화 표시, 작품마다 마지막 본 화로 이어보기. 즐겨찾기.',
    '검색·정렬: 작품·제목·본문으로 검색.',
    '동기화: 로그인하면 서재·설정이 클라우드에 동기화돼요(자세히는 "동기화·계정").',
  ] },
  { id: 'reader', icon: 'bookOpen', title: '리더', items: [
    '리더 = 한 화를 읽는 화면. 이전화/다음화 · 복사 · 공개 링크 공유 · 편집기로 · 삭제.',
    '원문 ↔ 번역 토글: 번역한 화는 "번역/원문"을 즉시 전환해요(저장된 원문, 재번역 0). 기본은 번역.',
    '정리 ↔ 원본 토글: 관리실에 등록한 정리 규칙이 있으면 군더더기(상태창·생각의 사슬·AI 슬롭 등)를 숨겨요. "정리/원본"으로 전환 — 원본 로그·복사물은 그대로(비파괴).',
    '웹소설 리더: 세피아·명조, 페이지 넘김 또는 연속 스크롤, 글자 크기·간격 설정.',
  ] },
  { id: 'management', icon: 'tool', title: '관리실', items: [
    '관리실 = 프롬프트·봇카드·모듈을 보관·관리하는 곳. 서재 우상단 관리실 버튼으로 진입.',
    '보관(데스크탑): 봇카드·모듈·프롬프트(.charx·.png·.json·.risum·.risup)를 올리면 원본 그대로 영구 보관 + 에셋·정리 규칙이 함께 잡혀요. 같은 파일은 1벌.',
    '분류·검색: 타입 탭(전체/프롬프트/봇카드/모듈)·이름 검색·정렬. 카드에 타입 배지.',
    '정리 규칙(개별 활성): 소스가 품은 "화면 정리 정규식"을 뽑아 리더에 적용해요. ★소스별 켜기/끄기 — 여러 프롬프트가 충돌해 본문이 깨지면 끄세요. 정리 규칙은 웹에서도 되고 여러 기기에 동기화돼요.',
    '에셋 추출(데스크탑): 카드·모듈 안의 이미지를 꺼내 미리보기·개별/전체 내려받기(zip). 큰 모듈도 지연 추출이라 안 멈춰요.',
    '카드 포맷 변환(데스크탑): 봇카드를 CharX ↔ PNG ↔ JSON으로 변환·내려받기(상세에서). PNG=아바타 위주·CharX=전체 에셋·JSON=인라인(이식성 차이 안내 참고).',
    '편집기 투입(데스크탑): 보관한 소스를 "편집기에서 쓰기" → 다음 화에 그 카드·에셋을 재드롭 없이 바로 사용.',
    '웹은 정리 규칙만 — 에셋 추출·영구 보관·변환은 데스크탑 앱에서.',
  ] },
  { id: 'translate', icon: 'language', title: '번역', items: [
    '번역은 본인 API 키(BYO)로 동작해요(설정 → 모델·키). 비용은 사용자 부담. 이미 한국어인 부분은 자동으로 건너뜁니다.',
    '작품 프롬프트: 작품마다 번역 톤·지침 지정. 우선순위 = 작품 프롬프트 > 활성 프리셋 > 기본.',
    '명명 프리셋: 번역 프롬프트를 이름 붙여 저장·내보내기/가져오기.',
    '결합 번역: 여러 블록을 한 요청으로 묶어 번역(빠르고 일관).',
    '번역은 비파괴 — 원문이 보존돼 리더에서 원문/번역 토글이 돼요(이번 이후 번역분부터).',
  ] },
  { id: 'risu', icon: 'inbox', title: '리스 연결 (RisuAI)', items: [
    '푸시 플러그인: 리스에서 보던 챗을 버튼 하나로 이 서재에 보내요(파일 없이). 설정 → "리스 연결"에서 연결 키 복사 → "플러그인 받기" → 리스에 추가·활성화 → 챗 화면 버튼에 연결 키 한 번 붙여넣기.',
    '연결 키는 "넣기"만 가능해요(비밀번호 아님). 한 기기당 한 번 붙여넣으면 기억돼요.',
    'LLM 번역기 주의: 플러그인은 리스 "LLM 번역기"로 번역한 부분만 가져올 수 있어요(구글·DeepL은 플러그인용 캐시를 안 남깁니다). GigaTrans로 번역한 챗은 번역기와 무관하게 그대로 들어와요.',
    '받은 로그함(우체통): 리스에서 보낸 챗이 서재 우상단 우체통에 쌓여요. 검토하고 [서재로 보관]을 누르면 평소 "채팅 가져오기" 설정으로 저장돼요. 미리보기·삭제·전체 보관도.',
  ] },
  { id: 'sync', icon: 'cloud', title: '동기화 · 계정', items: [
    '로그인 = 동기화 / 비로그인 = 이 기기에만 저장(로컬). 이메일 또는 게스트로 로그인.',
    '웹: 기본 자동(실시간 동기화). 설정 → 고급에서 수동(버튼식)으로 바꿀 수 있어요.',
    '데스크탑: 기본 수동(로컬-퍼스트, "안 썩는 영구 보관소"). 설정에서 자동으로 바꿀 수 있어요.',
    '커스텀 폰트는 이 기기에만 저장돼요(동기화 안 함). 관리실 보관물도 이 기기에만(정리 규칙만 동기화).',
  ] },
];

const app = document.getElementById('app');
let query = '';
let listEl: HTMLElement;

const norm = (s: string) => String(s || '').toLowerCase();
function visibleSections() { const q = norm(query.trim()); return q ? SECTIONS.filter((s) => norm(s.title + ' ' + s.items.join(' ')).indexOf(q) >= 0) : SECTIONS; }

function renderList() {
  listEl.innerHTML = '';
  const secs = visibleSections();
  if (!secs.length) { const e = document.createElement('div'); e.className = 'inbox-empty'; const art = document.createElement('div'); art.className = 'empty-art'; art.innerHTML = icon('language'); e.appendChild(art); e.appendChild(Object.assign(document.createElement('div'), { textContent: '검색 결과가 없어요.' })); listEl.appendChild(e); return; }
  for (const s of secs) {
    const sec = document.createElement('section'); sec.className = 'help-section'; sec.id = s.id;
    const h = document.createElement('h2'); h.className = 'home-h help-h'; h.innerHTML = icon(s.icon) + ' ' + s.title; sec.appendChild(h);
    for (const it of s.items) sec.appendChild(Object.assign(document.createElement('p'), { className: 'help-item', textContent: it }));
    listEl.appendChild(sec);
  }
}

function render() {
  app.innerHTML = '';
  const bar = document.createElement('header'); bar.className = 'topbar lib-topbar';
  const left = document.createElement('div'); left.className = 'topbar-left';
  const back = document.createElement('button'); back.className = 'reader-back'; back.textContent = '← 서재'; back.onclick = () => { location.href = 'library.html'; };
  left.append(back, Object.assign(document.createElement('span'), { className: 'mgmt-title', innerHTML: icon('book') + ' 사용설명서' }));
  bar.appendChild(left); app.appendChild(bar);

  const scroll = document.createElement('div'); scroll.className = 'mgmt-scroll'; app.appendChild(scroll);   // ★상단바 고정 + 내용 스크롤
  const wrap = document.createElement('div'); wrap.className = 'mgmt-wrap help-wrap'; scroll.appendChild(wrap);
  // 검색
  const search = document.createElement('input'); search.type = 'search'; search.className = 'archive-search'; search.placeholder = '기능 검색 (예: 번역·정리·동기화)'; search.value = query;
  search.oninput = () => { query = search.value; renderList(); }; wrap.appendChild(search);
  // 목차(딥링크)
  const toc = document.createElement('div'); toc.className = 'help-toc';
  for (const s of SECTIONS) { const b = document.createElement('button'); b.innerHTML = icon(s.icon) + ' ' + s.title; b.onclick = () => { query = ''; search.value = ''; renderList(); const el = document.getElementById(s.id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); location.hash = '#' + s.id; }; toc.appendChild(b); }
  wrap.appendChild(toc);
  // 섹션
  listEl = document.createElement('div'); listEl.className = 'help-list'; wrap.appendChild(listEl);
  renderList();
  // 딥링크 스크롤(? 버튼이 help.html#섹션으로 진입)
  const h = (location.hash || '').replace(/^#/, '');
  if (h) { const el = document.getElementById(h); if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 60); }
}

render();
window.addEventListener('hashchange', () => { const h = (location.hash || '').replace(/^#/, ''); const el = h && document.getElementById(h); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
