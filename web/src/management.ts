// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/management.ts — 관리실(데스크탑 전용 페이지). ★풀 보관실로 통합(Phase 1·2·3).
//   드롭 한 번 = ①원본 영구 보관(IDB, 파일해시 dedup) + ②표시 정규식 추출→동기화 KV(리더 정리) + ③에셋 인덱스(지연).
//   보관 소스 그리드 → 상세(에셋 그리드·규칙·재추출·삭제). 데스크탑 전용·보관은 동기화 안 함(규칙만 KV).
// @ts-nocheck
import { icon } from './icons.js';
import { isDesktop } from './desktopSync.js';   // 웹=정리규칙만 / 데스크탑=정리+에셋+보관 게이팅(C)
import { kvLoad, kvSave, archiveSaveSource, archiveList, archiveGetFile, archiveDelete, idbSaveCard, logsAll } from './store.js';
import { extractSourceInfo } from '../../core/card/sourceRegex.js';
import { buildRegex, isCatastrophic, sanitizeRegexOut, escapeRegexLiteral, expandCardRegex } from '../../core/convert/cardRegex.js';   // 내 숨김 규칙(수동) 검증·이스케이프·살균 + 미리보기 적용
import { saveCardCss, deleteCardCss, hasCardCss } from './cardCss.js';   // ★3단계 "리스 스타일": 카드 CSS 이 기기 보관(동기화 KV엔 모드 플래그만)
import { authAvailable, watchAuth } from './auth.js';   // ★UX 1차: 동기화 상태 가시화(로그인=규칙 자동 동기화)
import { parseCardAssets, cardAssetBytes } from '../../core/card/cardAssets.js';
import { encodeJson, encodeCharx, encodePng, pickPngBase } from '../../core/card/cardEncode.js';   // C: 봇카드 포맷 변환(charx↔png↔json)
import { assetDataUrl } from '../../core/card/assets.js';
import { zipSync } from 'fflate';

const app = document.getElementById('app');

// ── 정리 규칙 KV(Phase 1, 동기화) — 보관 소스 id로 연결 ──
const RULES_KEY = 'pro2-cleanup-rules';
function loadRules() { const r = kvLoad(RULES_KEY); return (r && typeof r === 'object') ? { enabled: r.enabled !== false, sources: Array.isArray(r.sources) ? r.sources : [] } : { enabled: true, sources: [] }; }
let rules = loadRules();
const persistRules = () => kvSave(RULES_KEY, rules);
const ruleCountFor = (id: string) => { const s = rules.sources.find((x) => x.id === id); return (s && s.rules && s.rules.length) || 0; };
const cssCountFor = (id: string) => { const s = rules.sources.find((x) => x.id === id); return (s && s.cssHide && s.cssHide.length) || 0; };   // 2단계: CSS 기본 숨김 클래스 수
// B: 소스별 개별 활성(기본 on=미설정/없음). 리더는 켜진 소스 규칙만 적용 → 프롬프트 충돌 시 끄면 됨.
const isSrcEnabled = (id: string) => { const s = rules.sources.find((x) => x.id === id); return !s || s.enabled !== false; };
const setSrcEnabled = (id: string, on: boolean) => { const s = rules.sources.find((x) => x.id === id); if (s) { s.enabled = !!on; persistRules(); } };
// ★3단계 "리스 스타일" 모드: strip(기본)=숨김 요소 제거 / risu=카드 CSS를 리더에 입혀 리스처럼 표시.
const isRisuMode = (id: string) => { const s = rules.sources.find((x) => x.id === id); return !!(s && s.cssMode === 'risu'); };
const setRisuMode = (id: string, on: boolean) => { const s = rules.sources.find((x) => x.id === id); if (s) { if (on) s.cssMode = 'risu'; else delete s.cssMode; persistRules(); } };
// 리스 스타일 토글 버튼(웹 목록·데탑 상세 공용) — 카드 CSS가 이 기기에 있을 때만 노출.
function risuModeBtn(id: string, onChange: () => void): HTMLButtonElement | null {
  if (!hasCardCss(id)) return null;
  const b = Object.assign(document.createElement('button'), { textContent: '리스 스타일' }) as HTMLButtonElement;
  const paint = () => b.classList.toggle('primary', isRisuMode(id));
  b.title = '켜면 이 카드의 CSS를 리더 본문에 입혀 리스처럼 표시(툴팁 가림·상태창 꾸밈). 끄면 숨김 요소를 제거만 해요. CSS는 이 기기에 보관돼요(다른 기기는 카드 재업로드).';
  b.onclick = () => { setRisuMode(id, !isRisuMode(id)); paint(); onChange(); };
  paint(); return b;
}
// 소스 저장 시 카드 CSS 동반 처리: 번들 있으면 저장(실패=너무 큼 → 잔재 제거), 없으면 잔재 제거. 반환=저장 여부.
function persistCardCss(id: string, name: string, bundle: any): boolean {
  if (bundle && saveCardCss(id, Object.assign({ name }, bundle))) return true;
  deleteCardCss(id); return false;
}

// ── 내 숨김 규칙(수동) — 유저가 직접 추가하는 문자열/정규식 숨김. 각 규칙 = user:true 소스 1개로
//    rules.sources에 합류 → 리더 적용(cleanupRules 평탄화)·개별 토글·기기 동기화(KV)가 기존 파이프라인 그대로.
//    쓸모: 카드에 표시 정규식이 아예 없는 봇(숨김을 backgroundHTML CSS로 하는 상태창 봇 등)의 잔여 문자열 제거.
const isUserSrc = (s: any) => !!(s && s.user === true);
let userListEl: HTMLElement | null = null;

function addUserRule(raw: string, outRep: string, advanced: boolean): string | null {   // 반환 = 오류 메시지(null=성공)
  const src = raw.trim();
  if (!src) return '숨길 문자열을 입력해주세요.';
  const pattern = advanced ? src : escapeRegexLiteral(src);
  if (advanced) {
    try { buildRegex(pattern); } catch (e: any) { return '정규식 오류: ' + ((e && e.message) || '패턴을 확인해주세요.'); }
    if (isCatastrophic(pattern)) return '위험한 패턴(중첩 수량자·ReDoS)이라 추가할 수 없어요.';
  }
  const rule = { in: pattern, out: advanced ? sanitizeRegexOut(outRep || '') : '', type: 'editdisplay', flag: '' };
  if (rules.sources.some((s) => isUserSrc(s) && s.rules && s.rules[0] && s.rules[0].in === rule.in && s.rules[0].out === rule.out)) return '이미 있는 규칙이에요.';
  rules.sources.push({ id: 'user-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), user: true, mode: advanced ? 'regex' : 'plain', name: src, rules: [rule], addedAt: Date.now(), enabled: true });
  persistRules();
  return null;
}

function renderUserList() {
  if (!userListEl) return; userListEl.innerHTML = '';
  const list = rules.sources.filter(isUserSrc);
  if (!list.length) { userListEl.appendChild(Object.assign(document.createElement('div'), { className: 'adv-desc', textContent: '아직 없어요 — 위 칸에 문자열을 적고 추가하면 리더가 화면에서만 숨겨요(원본 보존).' })); return; }
  for (const s of list) {
    const row = document.createElement('div'); row.className = 'inbox-item';
    const top = document.createElement('div'); top.className = 'inbox-item-top';
    top.appendChild(Object.assign(document.createElement('span'), { className: 'inbox-item-name', textContent: String(s.name || ''), title: String(s.name || '') }));
    const r0 = (s.rules && s.rules[0]) || {};
    top.appendChild(Object.assign(document.createElement('span'), { className: 'inbox-item-meta', textContent: (s.mode === 'regex' ? '정규식' : '문자열') + (r0.out ? ' → 치환' : ' 숨김') }));
    row.appendChild(top);
    const acts = document.createElement('div'); acts.className = 'inbox-item-acts';
    const tg = Object.assign(document.createElement('button'), { textContent: isSrcEnabled(s.id) ? '켜짐' : '꺼짐' }) as HTMLButtonElement;
    if (isSrcEnabled(s.id)) tg.classList.add('primary');
    tg.title = '이 규칙을 리더에 적용 켜기/끄기';
    tg.onclick = () => { setSrcEnabled(s.id, !isSrcEnabled(s.id)); renderUserList(); };
    acts.appendChild(tg);
    const del = Object.assign(document.createElement('button'), { className: 'series-del', textContent: '삭제' });
    del.onclick = () => { rules.sources = rules.sources.filter((x) => x.id !== s.id); persistRules(); renderUserList(); };
    acts.appendChild(del); row.appendChild(acts); userListEl.appendChild(row);
  }
}

function buildUserRules(wrap: HTMLElement) {
  const head = document.createElement('div'); head.className = 'mgmt-listhead';
  head.appendChild(Object.assign(document.createElement('span'), { textContent: '내 숨김 규칙' }));
  const adv = document.createElement('label'); adv.className = 'mgmt-toggle';
  const advCb = document.createElement('input'); advCb.type = 'checkbox';
  adv.append(advCb, document.createTextNode(' 고급(정규식)')); head.appendChild(adv);
  wrap.appendChild(head);
  wrap.appendChild(Object.assign(document.createElement('div'), { className: 'adv-desc', textContent: '봇카드에 숨김 정규식이 없어도(CSS 방식 상태창 봇 등) 지우고 싶은 문자열을 직접 추가할 수 있어요. 리더 화면에서만 숨겨지고(원본 로그 보존·정리/원본 토글) 여러 기기에 동기화돼요.' }));
  const row = document.createElement('div'); row.className = 'import-btns'; row.style.justifyContent = 'flex-start';
  const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'archive-search'; inp.placeholder = '숨길 문자열 (예: 호감도 +5)';
  const outInp = document.createElement('input'); outInp.type = 'text'; outInp.className = 'archive-search'; outInp.placeholder = '바꿀 내용(비우면 삭제)'; outInp.hidden = true; (outInp.style as any).flex = '0 1 200px';
  advCb.onchange = () => { outInp.hidden = !advCb.checked; inp.placeholder = advCb.checked ? '정규식 (예: 호감도\\s*[+-]?\\d+ 또는 /패턴/gi)' : '숨길 문자열 (예: 호감도 +5)'; };
  const addB = Object.assign(document.createElement('button'), { className: 'primary', textContent: '추가' });
  const doAdd = () => { const err = addUserRule(inp.value, outInp.value, advCb.checked); if (err) { setStatus(err); return; } inp.value = ''; outInp.value = ''; setStatus('숨김 규칙 추가 — 리더에 바로 적용돼요.'); renderUserList(); };
  addB.onclick = doAdd;
  inp.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') doAdd(); });
  outInp.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') doAdd(); });
  row.append(inp, outInp, addB); wrap.appendChild(row);
  userListEl = document.createElement('div'); userListEl.className = 'inbox-list'; wrap.appendChild(userListEl);
  renderUserList();
}

let cat: any[] = [];        // 보관 카탈로그(archiveList)
let cur: any = null;        // 현재 상세 연 소스 {entry, parsed, assets}
let statusEl: HTMLElement, gridEl: HTMLElement;
const setStatus = (m: string) => { if (statusEl) statusEl.textContent = m || ''; };

// A: 분류(타입)·검색·정렬. 타입 = .risup→프롬프트 · .risum→모듈 · charx/png/json→봇카드.
let aFilter = 'all', aQuery = '', aSort = 'recent';
const typeOf = (fmt: string) => { const f = String(fmt || '').toLowerCase(); return f === 'risup' ? 'prompt' : f === 'risum' ? 'module' : 'card'; };
const TYPE_LABEL: any = { prompt: '프롬프트', card: '봇카드', module: '모듈' };
// ★UX 2차(웹·데탑 화면 통일): 그리드가 그리는 "소스 뷰" — 데탑=보관 카탈로그(원본·에셋 있음) / 웹=규칙 KV 소스(가벼움).
//   웹 항목은 web:true 표시 — 표지 지연로드·에셋 상세 대신 경량 상세로 분기.
function srcViews(): any[] {
  if (isDesktop()) return cat;
  return rules.sources.filter((s) => !isUserSrc(s)).map((s) => ({ id: s.id, name: s.name, format: s.format || '', addedAt: s.addedAt || 0, web: true }));
}
function filteredCat(): any[] {
  let r = srcViews().slice();
  if (aFilter !== 'all') r = r.filter((e) => typeOf(e.format) === aFilter);
  const q = aQuery.trim().toLowerCase();
  if (q) r = r.filter((e) => String(e.name || '').toLowerCase().indexOf(q) >= 0);
  if (aSort === 'name') r.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))); else r.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  return r;
}

// 안전한 다운로드(브라우저·일렉트론 공용).
function downloadBytes(bytes: Uint8Array, filename: string, mime: string) {
  try { const blob = new Blob([bytes], { type: mime || 'application/octet-stream' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); } catch (_) {}
}
const safeName = (s: string) => String(s || 'source').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
const assetFilename = (a: any) => { const n = safeName(a.name || 'asset'); const e = (a.ext || '').toLowerCase(); return (e && !n.toLowerCase().endsWith('.' + e)) ? n + '.' + e : n; };

// ── 드롭존 ──
function makeDrop(label: string, onFiles: (fs: File[]) => void): HTMLElement {
  const drop = document.createElement('label'); drop.className = 'asset-apply-drop'; drop.innerHTML = icon('plus') + ' ' + label;
  const fin = document.createElement('input'); fin.type = 'file'; fin.accept = '.charx,.png,.json,.jpeg,.risum,.risup'; fin.multiple = true; fin.style.display = 'none';
  fin.onchange = () => { const fs = Array.from(fin.files || []); fin.value = ''; if (fs.length) onFiles(fs); };
  drop.appendChild(fin);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const fs = Array.from((e.dataTransfer && e.dataTransfer.files) || []); if (fs.length) onFiles(fs); });
  return drop;
}

// ── 드롭 = 보관 + 규칙 + 에셋 인덱스 (한 번에) ──
async function onDrop(files: File[]) {
  let saved = 0, totR = 0, totC = 0, totCss = 0, totA = 0, dup = 0, failed = 0;
  setStatus('보관 중…');
  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const fileName = f.name.replace(/\.[^.]+$/, '');
      let assetCount = 0; try { const p = parseCardAssets(bytes, f.name); assetCount = (p.assets || []).filter((a: any) => a && a.found !== false).length; } catch (_) {}
      let info: any = { name: '', format: '', rules: [], cssHide: [] }; try { info = await extractSourceInfo(bytes, f.name); } catch (_) {}
      const name = info.name || fileName;   // ★소스 내부 표시 이름(D) — 봇카드 data.name·모듈 module.name·.risup preset.name, 없으면 파일명
      const rs = info.rules || []; const ch = info.cssHide || [];   // ★ch = backgroundHTML CSS 기본 숨김 클래스(2단계)
      const entry = await archiveSaveSource(bytes, { name, format: info.format || '', assetCount, ruleCount: rs.length });
      // 규칙 KV 연결(id=파일해시) — 재보관이면 교체(리스 스타일 모드·규칙별 끄기 보존)
      const prevSrc = rules.sources.find((s) => s.id === entry.id); const prevMode = isRisuMode(entry.id);
      rules.sources = rules.sources.filter((s) => s.id !== entry.id);
      const gotCss = persistCardCss(entry.id, name, info.cssBundle); if (gotCss) totCss++;   // ★카드 CSS(3단계) 이 기기 보관
      if (rs.length || ch.length || gotCss) rules.sources.push({ id: entry.id, name, rules: carryRuleOff(prevSrc && prevSrc.rules, rs), cssHide: ch, addedAt: entry.addedAt, ...(prevMode ? { cssMode: 'risu' } : {}) });   // CSS만 있어도 등록(리스 스타일 토글 대상)
      persistRules();
      if (entry.existed) dup++; else saved++;
      totR += rs.length; totC += ch.length; totA += assetCount;
    } catch (e) { failed++; console.warn('[관리실] 보관 실패', f.name, e); }
  }
  await refreshGrid();
  setStatus(`보관 ${saved}개${dup ? ` · 이미 있음 ${dup}개` : ''} · 규칙 ${totR}${totC ? ` · CSS숨김 ${totC}` : ''}${totCss ? ` · 카드CSS ${totCss}` : ''} · 에셋 ${totA}` + (failed ? ` · 실패 ${failed}` : '')
    + ((saved + dup) > 0 && totR === 0 && totC === 0 && !failed ? ' — 표시 정규식·CSS 숨김이 없는 소스예요. 남는 문자열은 아래 "내 숨김 규칙"으로 직접 숨길 수 있어요.' : ''));
}

async function refreshGrid() { if (isDesktop()) cat = await archiveList(); renderGrid(); }   // 웹은 rules KV가 곧 목록(srcViews)

const fmtBadge = (f: string) => (f || '?').toUpperCase();

function srcCard(e: any): HTMLElement {
  const c = document.createElement('div'); c.className = 'home-card' + (isSrcEnabled(e.id) ? '' : ' src-off');
  const cover = document.createElement('div'); cover.className = 'home-cover'; cover.textContent = e.format ? fmtBadge(e.format) : 'SRC';
  if (!e.web) {
    // 표지 = 첫 이미지 에셋(지연: 보일 때만 원본 열어 디코드) — 데탑만(웹은 원본 파일 미보관 → 타입 뱃지 표지)
    const io = new IntersectionObserver((ents) => {
      for (const x of ents) if (x.isIntersecting) {
        io.disconnect();
        (async () => { try { const b = await archiveGetFile(e.id); if (!b) return; const p = parseCardAssets(b, e.name + '.' + (e.format || '')); const img = (p.assets || []).find((a: any) => /^image\//.test(a.mime || '') && a.found !== false); if (!img) return; const by = cardAssetBytes(p, img); if (by) { const el = document.createElement('img'); el.loading = 'lazy'; el.src = assetDataUrl(img); cover.innerHTML = ''; cover.appendChild(el); } } catch (_) {} })();
      }
    }, { rootMargin: '300px' });
    io.observe(cover);
  }
  c.appendChild(cover);
  c.appendChild(Object.assign(document.createElement('div'), { className: 'home-card-name', textContent: e.name || '소스' }));
  const meta = document.createElement('div'); meta.className = 'home-card-meta';
  const tail = `규칙 ${ruleCountFor(e.id)}${cssCountFor(e.id) ? ` · CSS숨김 ${cssCountFor(e.id)}` : ''}${hasCardCss(e.id) ? ' · 카드CSS' : ''}`;
  meta.innerHTML = `<span class="src-badge">${TYPE_LABEL[typeOf(e.format)] || '소스'}</span> ${e.web ? tail : `에셋 ${e.assetCount || 0} · ${tail}`}`;
  c.appendChild(meta);
  // 개별 활성 토글(규칙/CSS숨김 있는 소스만, 우상단). 카드 클릭=상세라 stopPropagation.
  if (ruleCountFor(e.id) > 0 || cssCountFor(e.id) > 0) {
    const on = isSrcEnabled(e.id);
    const tg = document.createElement('button'); tg.className = 'src-toggle' + (on ? ' on' : ''); tg.textContent = on ? '정리 켜짐' : '정리 꺼짐'; tg.title = '이 소스의 정리 규칙을 리더에 적용 켜기/끄기';
    tg.onclick = (ev) => { ev.stopPropagation(); setSrcEnabled(e.id, !isSrcEnabled(e.id)); renderGrid(); };
    c.appendChild(tg);
  }
  c.title = e.name + (e.web ? ' — 클릭하면 상세(규칙·리스 스타일·삭제)' : ' — 클릭하면 상세(에셋·규칙·내려받기)');
  c.onclick = () => (e.web ? openWebDetail(e) : openDetail(e));
  return c;
}

// ★UX 2차: 웹 소스 상세(경량) — 원본 파일이 없으니 규칙 정보·토글·삭제만(에셋·보관·변환은 데탑 전용 안내).
function openWebDetail(entry: any) {
  const ov = document.createElement('div'); ov.className = 'import-modal'; const card = document.createElement('div'); card.className = 'import-card adv-card src-detail';
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-title', textContent: entry.name || '소스' }));
  const cssN = cssCountFor(entry.id);
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-info', textContent: `${TYPE_LABEL[typeOf(entry.format)] || '소스'} · 규칙 ${ruleCountFor(entry.id)}개${cssN ? ` · CSS숨김 ${cssN}개` : ''}${hasCardCss(entry.id) ? ' · 카드CSS(이 기기)' : ''}` }));
  const acts = document.createElement('div'); acts.className = 'import-btns'; acts.style.justifyContent = 'flex-start';
  const togB = Object.assign(document.createElement('button'), { textContent: isSrcEnabled(entry.id) ? '정리 켜짐' : '정리 꺼짐' }) as HTMLButtonElement;
  if (isSrcEnabled(entry.id)) togB.classList.add('primary');
  togB.title = '이 소스의 정리 규칙을 리더에 적용 켜기/끄기';
  togB.onclick = () => { setSrcEnabled(entry.id, !isSrcEnabled(entry.id)); const on = isSrcEnabled(entry.id); togB.textContent = on ? '정리 켜짐' : '정리 꺼짐'; togB.classList.toggle('primary', on); renderGrid(); };
  const risuB = risuModeBtn(entry.id, () => renderGrid());
  const delB = Object.assign(document.createElement('button'), { className: 'series-del', textContent: '삭제' });
  delB.onclick = () => { rules.sources = rules.sources.filter((x) => x.id !== entry.id); persistRules(); deleteCardCss(entry.id); ov.remove(); setStatus(`“${entry.name}” 규칙 삭제`); renderGrid(); };
  acts.append(togB, ...(risuB ? [risuB] : []), delB); card.appendChild(acts);
  const rsec = rulesSection(entry.id); if (rsec) card.appendChild(rsec);   // ★UX 3차: 규칙 목록·개별 토글·미리보기
  card.appendChild(Object.assign(document.createElement('div'), { className: 'adv-desc', textContent: '에셋 추출·원본 영구 보관·포맷 변환은 데스크탑 앱 전용이에요. 웹에는 리더 정리에 필요한 규칙·CSS만 저장돼요.' }));
  const closeRow = document.createElement('div'); closeRow.className = 'import-btns'; const closeB = Object.assign(document.createElement('button'), { textContent: '닫기' }); closeB.onclick = () => ov.remove(); closeRow.append(closeB); card.appendChild(closeRow);
  ov.appendChild(card); document.body.appendChild(ov); ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
}

function renderGrid() {
  if (!gridEl) return; gridEl.innerHTML = '';
  const list = filteredCat();
  if (!list.length) {
    const total = srcViews().length;
    const e = document.createElement('div'); e.className = 'inbox-empty';
    const art = document.createElement('div'); art.className = 'empty-art'; art.innerHTML = icon(total ? 'broom' : 'folder'); e.appendChild(art);
    e.appendChild(Object.assign(document.createElement('div'), { innerHTML: total ? '조건에 맞는 소스가 없어요.' : (isDesktop() ? '보관된 소스가 없어요.<br>봇카드·모듈·프롬프트를 올리면 영구 보관되고, 규칙·에셋이 함께 잡혀요.' : '등록된 소스가 없어요.<br>봇카드·모듈·프롬프트를 올리면 정리 규칙·CSS가 잡혀 리더에 적용돼요.') }));
    gridEl.appendChild(e); return;
  }
  for (const e of list) gridEl.appendChild(srcCard(e));
}

// ── 상세(모달): 에셋 그리드(Phase 2) + 규칙 정보 + 재추출·삭제·전체 내려받기 ──
function assetCell(a: any): HTMLElement {
  const cell = document.createElement('button'); cell.className = 'home-card';
  const thumb = document.createElement('div'); thumb.className = 'home-cover';
  if (!/^image\//.test(a.mime || '')) { thumb.textContent = (a.ext || '?').toUpperCase(); }
  else { const io = new IntersectionObserver((ents) => { for (const e of ents) if (e.isIntersecting) { io.disconnect(); try { const by = cardAssetBytes(cur.parsed, a); if (by) { const img = document.createElement('img'); img.loading = 'lazy'; img.src = assetDataUrl(a); thumb.innerHTML = ''; thumb.appendChild(img); } else thumb.textContent = '?'; } catch (_) { thumb.textContent = '!'; } } }, { rootMargin: '300px' }); io.observe(thumb); }
  cell.appendChild(thumb);
  cell.appendChild(Object.assign(document.createElement('div'), { className: 'home-card-name', textContent: a.name || 'asset' }));
  cell.appendChild(Object.assign(document.createElement('div'), { className: 'home-card-meta', textContent: (a.ext || '').toUpperCase() + (a.size ? ` · ${(a.size / 1024).toFixed(0)}KB` : '') }));
  cell.onclick = () => previewAsset(a);
  return cell;
}
function previewAsset(a: any) {
  let by; try { by = cardAssetBytes(cur.parsed, a); } catch (_) { by = null; }
  const ov = document.createElement('div'); ov.className = 'import-modal asset-light';
  const inner = document.createElement('div'); inner.className = 'asset-light-inner';
  if (by && /^image\//.test(a.mime || '')) { const img = document.createElement('img'); img.src = assetDataUrl(a); inner.appendChild(img); }
  else inner.appendChild(Object.assign(document.createElement('div'), { className: 'asset-light-file', textContent: (a.ext || '파일').toUpperCase() + (by ? ` · ${(by.length / 1024).toFixed(0)}KB` : '') }));
  const cap = document.createElement('div'); cap.className = 'asset-light-cap';
  cap.appendChild(Object.assign(document.createElement('span'), { textContent: a.name || 'asset' }));
  const dl = Object.assign(document.createElement('button'), { className: 'primary', textContent: '내려받기' });
  dl.onclick = () => { const b2 = cardAssetBytes(cur.parsed, a); if (b2) downloadBytes(b2, assetFilename(a), a.mime); };
  cap.appendChild(dl); inner.appendChild(cap);
  ov.appendChild(inner); document.body.appendChild(ov); ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
}
async function downloadAll() {
  if (!cur || !cur.assets.length) return;
  setStatus('압축 중… (큰 모듈은 시간이 걸려요)'); await new Promise((r) => setTimeout(r, 16));
  try {
    const files: Record<string, Uint8Array> = {}; const used: Record<string, number> = {}; let n = 0;
    for (const a of cur.assets) { let by; try { by = cardAssetBytes(cur.parsed, a); } catch (_) { by = null; } if (!by) continue; let fn = assetFilename(a); if (used[fn]) { const m = /^(.*?)(\.[^.]+)?$/.exec(fn) || [fn, fn, '']; let i = 2, cand; do { cand = m[1] + '_' + (i++) + (m[2] || ''); } while (used[cand]); fn = cand; } used[fn] = 1; files[fn] = by; n++; }
    if (!n) { setStatus('내려받을 에셋이 없어요.'); return; }
    downloadBytes(zipSync(files, { level: 0 }), safeName(cur.entry.name) + '_assets.zip', 'application/zip'); setStatus(`${n}개 에셋 zip 내려받기`);
  } catch (e) { console.warn('[관리실] 전체 내려받기 실패', e); setStatus('전체 내려받기 실패(개별 내려받기를 써보세요).'); }
}

async function openDetail(entry: any) {
  const ov = document.createElement('div'); ov.className = 'import-modal'; const card = document.createElement('div'); card.className = 'import-card adv-card src-detail';
  card.appendChild(Object.assign(document.createElement('div'), { className: 'import-title', textContent: entry.name || '소스' }));
  const cssMeta = () => (cssCountFor(entry.id) ? ` · CSS숨김 ${cssCountFor(entry.id)}개` : '');
  const info = Object.assign(document.createElement('div'), { className: 'import-info', textContent: `${fmtBadge(entry.format)} · ${(entry.size / 1024).toFixed(0)}KB · 규칙 ${ruleCountFor(entry.id)}개${cssMeta()} · 불러오는 중…` }); card.appendChild(info);
  const acts = document.createElement('div'); acts.className = 'import-btns'; acts.style.justifyContent = 'flex-start';
  // ★편집기 투입(③): 보관 원본을 편집기 last 카드로 넣고 새 화 열기 → restoreLastCard→applyCard로 에셋·표시 regex 바로. 화마다 재드롭 0.
  const useB = Object.assign(document.createElement('button'), { className: 'primary', textContent: '편집기에서 쓰기' }); useB.title = '이 소스의 카드·에셋을 편집기에 올려 다음 화에 바로 사용(applyCard 재사용)';
  useB.onclick = async () => { try { const bytes = await archiveGetFile(entry.id); if (!bytes) { setStatus('원본을 찾을 수 없어요.'); return; } await idbSaveCard((entry.name || '소스') + '.' + (entry.format || 'bin'), bytes); location.href = 'index.html?new=1'; } catch (e) { console.warn('[관리실] 편집기 투입 실패', e); setStatus('편집기 투입 실패'); } };
  const allB = Object.assign(document.createElement('button'), { textContent: '전체 내려받기 (zip)' }); allB.onclick = () => downloadAll();
  const reB = Object.assign(document.createElement('button'), { textContent: '재추출' }); reB.title = '보관된 원본에서 규칙·에셋 다시 추출';
  const delB = Object.assign(document.createElement('button'), { className: 'series-del', textContent: '삭제' });
  let togB: HTMLButtonElement | null = null;   // B: 이 소스 정리 적용 on/off (규칙 또는 CSS숨김 보유 시)
  if (ruleCountFor(entry.id) > 0 || cssCountFor(entry.id) > 0) {
    togB = Object.assign(document.createElement('button'), { textContent: isSrcEnabled(entry.id) ? '정리 켜짐' : '정리 꺼짐' }) as HTMLButtonElement;
    togB.title = '이 소스의 정리 규칙을 리더에 적용 켜기/끄기';
    if (isSrcEnabled(entry.id)) togB.classList.add('primary');
    togB.onclick = () => { setSrcEnabled(entry.id, !isSrcEnabled(entry.id)); const on = isSrcEnabled(entry.id); togB!.textContent = on ? '정리 켜짐' : '정리 꺼짐'; togB!.classList.toggle('primary', on); renderGrid(); };
  }
  const risuB = risuModeBtn(entry.id, () => renderGrid());   // ★3단계: 카드 CSS 보유 소스만(리스처럼 표시)
  acts.append(useB, ...(togB ? [togB] : []), ...(risuB ? [risuB] : []), allB, reB, delB); card.appendChild(acts);
  // C: 봇카드만 포맷 변환(charx↔png↔json). risum(모듈)·risup(프롬프트) 제외. cur는 아래 비동기 로드가 채움(클릭 시 참조).
  if (typeOf(entry.format) === 'card') {
    const conv = document.createElement('div'); conv.className = 'import-btns'; conv.style.justifyContent = 'flex-start';
    conv.appendChild(Object.assign(document.createElement('span'), { className: 'adv-desc', textContent: '변환·내려받기:', style: 'align-self:center;margin-right:2px;' }));
    const gb = (a: any) => cardAssetBytes(cur && cur.parsed, a);
    const convBtn = (label: string, make: () => Uint8Array | null, fname: string, mime: string) => {
      const b = Object.assign(document.createElement('button'), { textContent: label }) as HTMLButtonElement;
      b.onclick = () => { if (!cur || cur.entry.id !== entry.id) { setStatus('상세를 다시 열어주세요.'); return; } try { const out = make(); if (out) downloadBytes(out, fname, mime); } catch (e: any) { setStatus('변환 실패: ' + ((e && e.message) || '')); } };
      return b;
    };
    conv.appendChild(convBtn('JSON', () => encodeJson(cur.parsed, gb), safeName(entry.name) + '.json', 'application/json'));
    conv.appendChild(convBtn('CharX', () => encodeCharx(cur.parsed, gb), safeName(entry.name) + '.charx', 'application/zip'));
    conv.appendChild(convBtn('PNG', () => { const base = pickPngBase(cur.parsed, gb); if (!base) { setStatus('PNG 변환 불가 — 카드에 PNG 이미지가 없어요.'); return null; } return encodePng(cur.parsed, base, gb); }, safeName(entry.name) + '.png', 'image/png'));
    card.appendChild(conv);
    card.appendChild(Object.assign(document.createElement('div'), { className: 'adv-desc', textContent: '※ 포맷별 에셋 이식성이 달라요 — JSON=data:로 인라인 · CharX=전체 에셋 · PNG=아바타 위주(추가 에셋 일부 손실 가능). 카드 데이터(설명·로어북 등)는 보존.' }));
  }
  { const rsec = rulesSection(entry.id); if (rsec) card.appendChild(rsec); }   // ★UX 3차: 규칙 목록·개별 토글·미리보기(웹 상세와 공용)
  const grid = document.createElement('div'); grid.className = 'mgmt-grid'; card.appendChild(grid);
  const closeRow = document.createElement('div'); closeRow.className = 'import-btns'; const closeB = Object.assign(document.createElement('button'), { textContent: '닫기' }); closeB.onclick = () => ov.remove(); closeRow.append(closeB); card.appendChild(closeRow);
  ov.appendChild(card); document.body.appendChild(ov); ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });

  // 보관된 원본 열어 지연 추출
  try {
    const bytes = await archiveGetFile(entry.id);
    if (!bytes) { info.textContent = '원본을 찾을 수 없어요(삭제됐을 수 있음).'; return; }
    const parsed = parseCardAssets(bytes, entry.name + '.' + (entry.format || ''));
    const assets = (parsed.assets || []).filter((a: any) => a && a.found !== false);
    cur = { entry, parsed, assets };
    const imgs = assets.filter((a: any) => /^image\//.test(a.mime || '')).length;
    info.textContent = `${fmtBadge(entry.format)} · ${(entry.size / 1024).toFixed(0)}KB · 에셋 ${assets.length}개(이미지 ${imgs}) · 규칙 ${ruleCountFor(entry.id)}개${cssMeta()}`;
    for (const a of assets) grid.appendChild(assetCell(a));
  } catch (e) { info.textContent = '에셋을 읽지 못했어요.'; console.warn(e); }

  reB.onclick = async () => {
    reB.disabled = true; reB.textContent = '재추출 중…';
    try { const bytes = await archiveGetFile(entry.id); if (bytes) { const inf = await extractSourceInfo(bytes, entry.name + '.' + (entry.format || '')); const rs = inf.rules || []; const ch = inf.cssHide || []; const parsed = parseCardAssets(bytes, entry.name + '.' + (entry.format || '')); const ac = (parsed.assets || []).filter((a: any) => a.found !== false).length; await archiveSaveSource(bytes, { name: entry.name, format: entry.format, assetCount: ac, ruleCount: rs.length }); const gotCss = persistCardCss(entry.id, entry.name, (inf as any).cssBundle); const prevSrc = rules.sources.find((s) => s.id === entry.id); const prevMode = isRisuMode(entry.id); rules.sources = rules.sources.filter((s) => s.id !== entry.id); if (rs.length || ch.length || gotCss) rules.sources.push({ id: entry.id, name: entry.name, rules: carryRuleOff(prevSrc && prevSrc.rules, rs), cssHide: ch, addedAt: entry.addedAt, ...(prevMode ? { cssMode: 'risu' } : {}) }); persistRules(); setStatus(`“${entry.name}” 재추출 — 규칙 ${rs.length}${ch.length ? ` · CSS숨김 ${ch.length}` : ''}${gotCss ? ' · 카드CSS 보관' : ''} · 에셋 ${ac}`); } }
    catch (_) { setStatus('재추출 실패'); }
    ov.remove(); refreshGrid();
  };
  delB.onclick = async () => { try { await archiveDelete(entry.id); rules.sources = rules.sources.filter((s) => s.id !== entry.id); persistRules(); deleteCardCss(entry.id); } catch (_) {} ov.remove(); setStatus(`“${entry.name}” 보관 삭제`); refreshGrid(); };
}

// ★UX 1차: 동기화 상태 뱃지 — "규칙이 어디까지 가 있나"를 보여줘 '보내기 버튼' 찾는 혼란 제거.
//   사실만 표기: 규칙·리스 스타일 모드=계정 동기화(KV) / 카드 CSS 원본·보관실 파일=이 기기 전용.
function buildSyncBadge(wrap: HTMLElement) {
  const el = document.createElement('div'); el.className = 'mgmt-sync';
  const dot = document.createElement('span'); dot.className = 'dot';
  const txt = document.createElement('span');
  el.append(dot, txt); wrap.appendChild(el);
  const paint = (u: any) => {
    if (u) { el.classList.add('on'); txt.textContent = '동기화 켜짐 — 정리 규칙·내 숨김 규칙·리스 스타일 설정이 로그인된 기기들의 리더에 자동 적용돼요. 카드 CSS 원본과 보관실 파일은 이 기기에만 저장.'; }
    else { el.classList.remove('on'); txt.textContent = '이 기기에만 저장 중 — 서재에서 로그인하면 정리 규칙이 기기 간 자동 동기화돼요(따로 보낼 필요 없음).'; }
  };
  paint(null);
  try { if (authAvailable()) watchAuth((u) => paint(u)); } catch (_) { /* 미구성(오프라인 빌드 등) = 로컬 문구 유지 */ }
}

// ── UX 3차: 규칙 미리보기·규칙별 토글 + 내 로그 before/after (상세 모달 공용 섹션, 웹·데탑) ──────
// 재드롭/재추출로 규칙 배열이 새로 와도 개별 끄기(off)를 보존: 같은 in+out 규칙에 off 이식.
function carryRuleOff(prevRules: any[] | undefined, nextRules: any[]): any[] {
  if (!Array.isArray(prevRules) || !prevRules.length) return nextRules;
  const offs = new Set(prevRules.filter((r) => r && r.off === true).map((r) => r.in + ' ' + r.out));
  for (const r of nextRules) if (r && offs.has(r.in + ' ' + r.out)) r.off = true;
  return nextRules;
}
// 로그 레코드의 규칙 적용 대상 텍스트(원시) — readerLog.logTextSlots의 읽기전용 축약판 [모양 동기 유지].
function logTexts(r: any): string[] {
  const out: string[] = [];
  if (r && r.chat && Array.isArray(r.chat.messages)) for (const m of r.chat.messages) out.push(String((m && m.text) || ''));
  else if (r && r.webnovel && Array.isArray(r.webnovel.blocks)) for (const b of r.webnovel.blocks) out.push(String((b && b.content) || ''));
  else if (r && r.cardCfg && Array.isArray(r.cardCfg.blocks)) for (const b of r.cardCfg.blocks) out.push(String((b && b.content) || ''));
  else if (r && typeof r.input === 'string' && r.input) out.push(r.input);
  else if (r && typeof r.html === 'string') out.push(r.html);
  return out;
}
// CSS 숨김 클래스 요소 제거 — readerLog.removeHiddenClassEls와 동일 로직(미리보기용 사본) [동기 유지].
function stripHiddenEls(text: string, classes: string[]): string {
  if (!classes.length || !text || text.indexOf('class') < 0) return text;
  if (!classes.some((c) => text.indexOf(c) >= 0)) return text;
  try {
    const doc = new DOMParser().parseFromString('<div id="__ph">' + text + '</div>', 'text/html');
    const root = doc.getElementById('__ph'); if (!root) return text;
    const els = root.querySelectorAll(classes.map((c) => '.' + c).join(','));
    if (!els.length) return text;
    els.forEach((e) => e.remove());
    return root.innerHTML;
  } catch (_) { return text; }
}
// 최근 보관 로그에서 이 소스가 실제로 바꾸는 첫 지점을 찾아 전/후 발췌 반환(못 찾으면 null).
async function findRulePreview(s: any): Promise<{ before: string; after: string; title: string } | null> {
  const active = (s.rules || []).filter((r: any) => r && r.off !== true);
  const classes = (s.cssHide || []).filter((c: any) => typeof c === 'string' && /^[A-Za-z_][\w-]*$/.test(c));
  if (!active.length && !classes.length) return null;
  let logs: any[] = []; try { logs = await logsAll(); } catch (_) {}
  logs.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  for (const r of logs.slice(0, 80)) {
    for (const t of logTexts(r)) {
      if (!t) continue;
      let c = expandCardRegex(t, active);
      if (classes.length) c = stripHiddenEls(c, classes);
      if (c === t) continue;
      let i = 0; const n = Math.min(t.length, c.length);
      while (i < n && t.charAt(i) === c.charAt(i)) i++;   // 첫 차이 지점
      const from = Math.max(0, i - 100);
      const cut = (x: string) => (from > 0 ? '…' : '') + x.slice(from, from + 340) + (x.length > from + 340 ? '…' : '');
      return { before: cut(t), after: c.trim() ? cut(c) : '(전부 숨겨짐)', title: (r.title ? r.title + ' · ' : '') + (r.char || '') };
    }
  }
  return null;
}
function rulesSection(srcId: string): HTMLElement | null {
  const s = rules.sources.find((x) => x.id === srcId);
  if (!s || ((!s.rules || !s.rules.length) && (!s.cssHide || !s.cssHide.length))) return null;
  const box = document.createElement('div');
  const det = document.createElement('details'); det.className = 'rule-details';
  const ruleN = (s.rules && s.rules.length) || 0;
  det.appendChild(Object.assign(document.createElement('summary'), { textContent: `규칙 자세히 — 정규식 ${ruleN}개 개별 켜기/끄기${s.cssHide && s.cssHide.length ? ` · CSS숨김 ${s.cssHide.length}` : ''}` }));
  const pvArea = document.createElement('div');   // 미리보기 결과(규칙 토글 시 비움 = 최신 상태만)
  const list = document.createElement('div'); list.className = 'rule-list';
  for (const r of (s.rules || [])) {
    const row = document.createElement('label'); row.className = 'rule-row' + (r.off === true ? ' off' : '');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = r.off !== true;
    cb.onchange = () => { if (cb.checked) delete r.off; else r.off = true; persistRules(); row.classList.toggle('off', r.off === true); pvArea.innerHTML = ''; };
    const label = (r.comment && String(r.comment).trim()) || String(r.in || '');   // 제작자 설명 우선, 없으면 패턴
    row.appendChild(cb);
    row.appendChild(Object.assign(document.createElement('span'), { className: 'rule-pat', textContent: label, title: `in: ${r.in}\nout: ${r.out || '(삭제)'}` }));
    row.appendChild(Object.assign(document.createElement('span'), { className: 'rule-type', textContent: String(r.type || 'editdisplay') }));
    list.appendChild(row);
  }
  if (list.childNodes.length) det.appendChild(list);
  if (s.cssHide && s.cssHide.length) det.appendChild(Object.assign(document.createElement('div'), { className: 'rule-csschips', textContent: '숨김 클래스: ' + s.cssHide.join(' · ') }));
  // ③ before/after — 최근 내 로그에서 이 소스가 실제 바꾸는 지점 발췌
  const pvBtn = Object.assign(document.createElement('button'), { textContent: '내 로그로 미리보기' });
  pvBtn.title = '최근 보관함에서 이 규칙이 실제로 바꾸는 화를 찾아 정리 전/후를 보여줘요(현재 켜진 규칙 기준).';
  pvBtn.style.marginTop = '8px';
  pvBtn.onclick = async () => {
    pvBtn.disabled = true; pvBtn.textContent = '찾는 중…';
    const r = await findRulePreview(s);
    pvBtn.disabled = false; pvBtn.textContent = '내 로그로 미리보기';
    pvArea.innerHTML = '';
    if (!r) { pvArea.appendChild(Object.assign(document.createElement('div'), { className: 'adv-desc', textContent: '최근 보관함(80화)에서 이 규칙이 바꾸는 로그를 못 찾았어요 — 규칙이 전부 꺼져 있거나, 이 봇의 로그가 없을 수 있어요.' })); return; }
    const grid = document.createElement('div'); grid.className = 'prev-grid';
    const mk2 = (lab: string, body: string) => { const d = document.createElement('div'); d.appendChild(Object.assign(document.createElement('div'), { className: 'prev-label', textContent: lab })); d.appendChild(Object.assign(document.createElement('div'), { className: 'prev-box', textContent: body })); return d; };
    grid.appendChild(mk2('원본' + (r.title ? ` — ${r.title}` : ''), r.before));
    grid.appendChild(mk2('정리 후', r.after));
    pvArea.appendChild(grid);
  };
  det.appendChild(pvBtn); det.appendChild(pvArea);
  box.appendChild(det);
  return box;
}

// 정리 토글(공용): 리더 적용 on/off.
function rulesToggle(labelText: string): HTMLElement {
  const head = document.createElement('div'); head.className = 'mgmt-listhead';
  head.appendChild(Object.assign(document.createElement('span'), { textContent: labelText }));
  const tog = document.createElement('label'); tog.className = 'mgmt-toggle';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = rules.enabled !== false; cb.onchange = () => { rules.enabled = cb.checked; persistRules(); };
  tog.append(cb, document.createTextNode(' 리더 정리 켜기 (전체)')); head.appendChild(tog);
  return head;
}

// ── 데스크탑: 풀 보관실(보관+규칙+에셋) ──
// A: 분류 탭 + 검색 + 정렬 툴바(서재 archive-head 재사용). 바뀌면 그리드만 다시 그림.
function archiveToolbar(): HTMLElement {
  const head = document.createElement('div'); head.className = 'archive-head mgmt-toolbar';
  const chips = document.createElement('div'); chips.className = 'mgmt-chips';
  const FILTERS: Array<[string, string]> = [['all', '전체'], ['prompt', '프롬프트'], ['card', '봇카드'], ['module', '모듈']];
  const drawChips = () => { chips.innerHTML = ''; for (const [v, t] of FILTERS) { const b = document.createElement('button'); b.textContent = t; if (aFilter === v) b.className = 'primary'; b.onclick = () => { aFilter = v; drawChips(); renderGrid(); }; chips.appendChild(b); } };
  drawChips(); head.appendChild(chips);
  const search = document.createElement('input'); search.type = 'search'; search.className = 'archive-search'; search.placeholder = '이름 검색'; search.value = aQuery;
  search.oninput = () => { aQuery = search.value; renderGrid(); }; head.appendChild(search);
  const sort = document.createElement('select'); sort.className = 'mgmt-sort'; [['recent', '최근순'], ['name', '이름순']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sort.appendChild(o); }); sort.value = aSort; sort.onchange = () => { aSort = sort.value; renderGrid(); }; head.appendChild(sort);
  return head;
}
function buildArchiveRoom(wrap: HTMLElement) {
  wrap.appendChild(Object.assign(document.createElement('div'), { className: 'adv-desc', textContent: '봇카드·모듈·프롬프트(.charx · .png · .json · .risum · .risup)를 올리면 ①원본 그대로 영구 보관(안 사라짐) ②화면 정리 정규식을 뽑아 리더에 적용(정리/원본 토글) ③안의 에셋을 꺼내 미리보기·내려받기. 큰 모듈도 지연 추출이라 안 멈춰요. 보관은 이 기기에만(동기화 안 함), 정리 규칙만 동기화돼 웹 리더에도 적용.' }));
  buildSyncBadge(wrap);
  wrap.appendChild(makeDrop('소스 보관 (드롭 또는 클릭)', onDrop));
  statusEl = Object.assign(document.createElement('div'), { className: 'adv-desc mgmt-status' }); wrap.appendChild(statusEl);
  wrap.appendChild(archiveToolbar());
  wrap.appendChild(rulesToggle('보관 소스'));
  gridEl = document.createElement('div'); gridEl.className = 'mgmt-grid'; wrap.appendChild(gridEl);
  buildUserRules(wrap);   // 내 숨김 규칙(수동) — 소스에 정규식이 없는 봇(CSS 숨김 상태창류) 대응
  renderGrid(); refreshGrid();
}

// ── 웹: 정리 규칙만(드롭→규칙 추출→동기화 KV). 에셋/보관은 데스크탑 전용. ──
async function sha256Hex(b: Uint8Array): Promise<string> { const buf = await crypto.subtle.digest('SHA-256', b); return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, '0')).join(''); }
async function onDropWeb(files: File[]) {
  let added = 0, totR = 0, totC = 0, totCss = 0, empty = 0, failed = 0;
  setStatus('규칙 추출 중…');
  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const info = await extractSourceInfo(bytes, f.name);
      const ch = info.cssHide || [];   // ★backgroundHTML CSS 기본 숨김 클래스(2단계) — 정규식 0개여도 정리 가능
      const id = await sha256Hex(bytes);   // 콘텐츠 해시 = dedup(같은 소스 재드롭 1벌)
      const name = info.name || f.name.replace(/\.[^.]+$/, '');
      const gotCss = persistCardCss(id, name, info.cssBundle); if (gotCss) totCss++;   // ★카드 CSS(3단계) 이 기기 보관
      if (!info.rules.length && !ch.length && !gotCss) { empty++; continue; }
      const prevSrc = rules.sources.find((s) => s.id === id); const prevMode = isRisuMode(id);   // 재드롭 시 리스 스타일 모드·규칙별 끄기 보존
      rules.sources = rules.sources.filter((s) => s.id !== id);
      rules.sources.push({ id, name, format: info.format || '', rules: carryRuleOff(prevSrc && prevSrc.rules, info.rules), cssHide: ch, addedAt: Date.now(), ...(prevMode ? { cssMode: 'risu' } : {}) });   // format=그리드 타입 분류·표지(UX 2차)
      persistRules(); added++; totR += info.rules.length; totC += ch.length;
    } catch (e) { failed++; console.warn('[관리실 웹] 규칙 추출 실패', f.name, e); }
  }
  renderGrid();
  setStatus(added ? `정리 규칙 ${totR}개${totC ? ` · CSS숨김 ${totC}개` : ''}${totCss ? ` · 카드CSS ${totCss}개(리스 스타일 가능)` : ''} 추출 (소스 ${added}개)` + (empty ? ` · 표시규칙 없음 ${empty}` : '') : empty ? '이 소스엔 표시 정규식·CSS 숨김이 아예 없어요. 남는 문자열은 아래 "내 숨김 규칙"으로 직접 숨겨보세요.' : '소스를 읽지 못했어요(.charx · .png · .json · .risum · .risup).');
}
// ★UX 2차: 웹도 데탑과 같은 그리드 카드형(분류 탭·검색·정렬·소스 카드) — 렌더 경로 통일(srcViews가 데이터만 분기).
//   구 inbox 리스트(renderRulesList)는 이 그리드로 대체. 에셋·보관·변환 등 원본 필요 기능만 데탑 게이팅.
function buildRulesOnly(wrap: HTMLElement) {
  wrap.appendChild(Object.assign(document.createElement('div'), { className: 'adv-desc', textContent: '프롬프트·봇카드·모듈(.charx · .png · .json · .risum · .risup)을 올리면 그 안의 “화면 정리 정규식”과 CSS 숨김을 뽑아 저장해요. 리더가 군더더기(상태창·생각의 사슬·AI 슬롭 등)를 비파괴로 숨깁니다(정리/원본 토글). 여러 기기에 동기화돼요.' }));
  buildSyncBadge(wrap);
  wrap.appendChild(makeDrop('정리 규칙 추출 (드롭 또는 클릭)', onDropWeb));
  statusEl = Object.assign(document.createElement('div'), { className: 'adv-desc mgmt-status' }); wrap.appendChild(statusEl);
  wrap.appendChild(archiveToolbar());
  wrap.appendChild(rulesToggle('정리 규칙'));
  gridEl = document.createElement('div'); gridEl.className = 'mgmt-grid'; wrap.appendChild(gridEl);
  buildUserRules(wrap);   // 내 숨김 규칙(수동) — 소스에 정규식이 없는 봇(CSS 숨김 상태창류) 대응
  wrap.appendChild(Object.assign(document.createElement('div'), { className: 'adv-desc', textContent: '에셋 추출기와 영구 보관실은 데스크탑 앱 전용이에요(큰 모듈 보관·에셋 내려받기·편집기 투입).' }));
  renderGrid();
}

// ── 페이지 셸 ──
function render() {
  app.innerHTML = '';
  const bar = document.createElement('header'); bar.className = 'topbar lib-topbar';
  const left = document.createElement('div'); left.className = 'topbar-left';
  const back = document.createElement('button'); back.className = 'reader-back'; back.textContent = '← 서재'; back.onclick = () => { location.href = 'library.html'; };
  left.append(back, Object.assign(document.createElement('span'), { className: 'mgmt-title', innerHTML: icon('tool') + (isDesktop() ? ' 관리실 — 보관실' : ' 관리실 — 정리 규칙') }));
  const helpB = document.createElement('button'); helpB.className = 'reader-iconbtn'; helpB.innerHTML = icon('help'); helpB.title = '사용설명서'; helpB.onclick = () => { location.href = 'help.html#management'; };
  bar.appendChild(left); bar.appendChild(helpB); app.appendChild(bar);
  const scroll = document.createElement('div'); scroll.className = 'mgmt-scroll'; app.appendChild(scroll);   // ★상단바 고정 + 내용 스크롤(.lib-app엔 자체 스크롤 없음)
  const wrap = document.createElement('div'); wrap.className = 'mgmt-wrap'; scroll.appendChild(wrap);
  if (isDesktop()) buildArchiveRoom(wrap); else buildRulesOnly(wrap);
}

render();
