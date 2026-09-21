# 지시서 — 리더 책갈피 + 형광펜 (리디식 "마음에 드는 문장·페이지 표시")

> 작성 2026-09-21 · 유저 건의 원문: "리디 형광펜이나 책갈피 기능처럼 마음에 드는 문장 북마크 할 수 있으면 좋을 거 같음. 나중에 두고두고 다시 보고 싶은 페이지 표시해 두게."
> 이 문서는 **자기완결 지시서**다. 작업자는 이 파일 + 아래 "재사용할 것" 코드만 보면 된다. 구현 전 체크포인트 커밋 = 이 문서 커밋. 이상해지면 그 뒤 커밋을 revert.
> 선행 작업(같은 날 완료·배포): 페이지 이동 입력·슬라이더(f06c537·8bf30b1), 화 안 위치 기억(f06c537), 장 목차 점프(c903749). 전부 `web/src/readerView.ts`.

## 0. 한 줄 목표
리더에서 **① 지금 페이지에 책갈피를 꽂고 ② 문장을 드래그해 형광펜을 칠하고 ③ 나중에 목록에서 한 번에 다시 찾아가는** 것. 원본 로그는 절대 안 건드린다(비파괴 오버레이 — 정리/원본 토글과 같은 철학).

## 1. 용어 (리디북스 기준)
- **책갈피(북마크)**: "이 페이지" 표시. 종이책 귀퉁이 접기. 단위=페이지(우리는 비율). 목록에서 누르면 그 페이지로.
- **형광펜(하이라이트)**: 문장을 드래그 → 색 선택 → 본문에 색이 칠해진 채 남음. 별도 목록("내가 밑줄 친 문장")에서 모아 보고, 누르면 그 위치로. 메모 첨부는 선택.

## 2. 재사용할 것 (전부 이미 있음 — 바닥부터 만들지 말 것)
| 무엇 | 어디 | 어떻게 쓰나 |
|---|---|---|
| 페이저 API `goTo(n)`·`getPage()`·`getTotal()`·`pageOf(el)`·`doc` | `readerView.ts` `buildWnPager` 반환값 | 책갈피 점프=goTo, 형광펜 점프=goTo(pageOf(markEl)), 현재 페이지 비율=(page+0.5)/total |
| 위치 기억 `getReadPos/setReadPos` (비율 0~1, localStorage `pro2-read-pos`) | `readerView.ts` 상단 | 책갈피의 "비율" 개념·복원 공식(`floor(f*total)`)을 그대로 |
| 장 목차 팝오버 `attachToc`·`findChapters` (좌하단 알약 버튼+목록, 현재 항목 강조, `popAutoClose`) | `readerView.ts` | 책갈피 목록·형광펜 목록 팝오버는 **같은 틀**(`.reader-toc-btn`/`.reader-toc-pop`/`.rtp-item` CSS 재사용, 버튼만 나란히) |
| 드래그 선택 팝오버 `attachHideSelection` ("이 문자열 숨기기") | `readerLog.ts:124` | 형광펜 색 버튼을 **이 팝오버에 추가**. 현재 세로 스크롤에서만 붙음(`mounted.scroll`) → 페이지 모드에도 붙이도록 확장 |
| `mountReaderBody(..., papa, posKey)` — posKey=화 id | `readerView.ts` | 책갈피·형광펜의 저장 키도 같은 화 id(`r.id`). 공유 리더는 `share:<id>[:n]` |
| KV 저장 `kvLoad/kvSave` (로그인 시 Firestore kv 문서에 merge + 로컬 이중 쓰기) | `store.ts:392`, `firebaseBackend.ts:343` | 새 키 `pro2-marks` 하나 → 자동 동기화·전체백업 자동 포함(비밀 아님이므로 KV_EXCLUDE 불필요) |
| 정리/원본·원문/번역 토글 = `route()` 재렌더, displayHtml은 비파괴 합성 | `readerLog.ts` renderSingleLog | 형광펜은 **표시 HTML 위에 오버레이**로만 칠함(저장 html 불변). 복사·공유·아카 카드는 저장 html을 쓰므로 영향 0 |
| 리더 문단 구조: 웹소설=`.lp-webnovel > div…`(문단 div, 장 구분 div), 일반=`.reader-card` 안 카드 HTML | `core/convert/templates/webnovel.js` | 앵커의 "블록 힌트"=`.reader-card` 하위 텍스트 블록 인덱스 |
| 내 기록(#/stats)·Wrapped 아카 카드·오늘의 명대사 스트립 | `statsPage.ts`·`library.ts` | 3단계 연계: "내 형광펜 N개", 명대사 후보를 형광펜에서 뽑기 |

## 3. 데이터 모델 (KV 키 `pro2-marks`, 동기화됨)
```ts
{ v: 1,
  bm: { [logId]: Array<{ id: string; f: number; snip: string; t: number }> },        // 책갈피: f=비율(0~1), snip=그 페이지 첫 문장 40자(목록 표시용), t=생성 시각
  hl: { [logId]: Array<{ id: string; c: 'y'|'g'|'p'; q: string; pre: string; post: string; b: number; view: 'o'|'t'; t: number; memo?: string }> } }
  // 형광펜: c=색(노랑·초록·분홍), q=칠한 텍스트 그대로(최대 300자), pre/post=앞뒤 32자 문맥, b=블록 인덱스 힌트, view=원문(o)/번역(t) 중 어느 표시에서 칠했나
```
- **앵커 방식 = 텍스트 인용(quote) + 앞뒤 문맥 + 블록 힌트** (W3C Web Annotation의 TextQuoteSelector와 같은 발상). DOM 경로·문자 오프셋을 저장하지 않는다. 이유: 정리 규칙 on/off·번역 토글·리스 렌더엔진 갱신으로 DOM이 바뀌어도 **텍스트가 남아 있으면 다시 찾는다**.
- 복원 순서: ① 블록 b 안에서 `pre+q+post` 정확 일치 → ② 전체 본문 textContent에서 `q` 검색(여러 개면 pre/post 유사도로 선택) → ③ 못 찾으면 **고아(orphan)**: 본문엔 안 칠하고 목록에만 회색으로 남김(삭제 가능). 원문/번역 view가 다르면 칠하지 않고 목록엔 "번역에서 칠함" 표기.
- 상한: 화당 형광펜 200·책갈피 50, 전체 형광펜 5,000. 초과 시 setStatus 경고(Firestore 문서 1MB 한계 보호). q 300자 초과 선택은 거부(숨기기와 동일 규칙).
- id = `Date.now().toString(36)+난수 4자`. 삭제=배열에서 제거. 화 삭제(`logsDelete`) 시 `bm[logId]`·`hl[logId]` 같이 제거(현재 `clearReadPos(r.id)` 자리에 나란히).

## 4. UI
### 책갈피
- **꽂기**: 리더 본문 **우상단 귀퉁이**에 책갈피 아이콘(`icon('bookmark')`) — 페이지 모드는 `.reader-pager` 우상단, 스크롤 모드는 `.reader-scroll` 우상단(absolute, 상단바 아래). 클릭=토글(현재 위치에 이미 있으면 빼기). 꽂힌 상태=아이콘 채움+accent. "현재 위치에 있다"의 판정=저장 비율이 현재 페이지 범위 `[page/total, (page+1)/total)` 안(스크롤은 ±2% 이내).
- **목록**: 좌하단 `목차` 옆에 `책갈피 N` 알약 버튼(0개면 숨김). 팝오버 항목=`p.12`(스크롤은 `34%`) + snip + 삭제(✕). 클릭=`goTo(floor(f*total))`/scrollTop=f*max. 틀은 `attachToc`을 일반화한 `attachListPop(reader, btnLabel, items, onPick, onDelete)`로 — 목차도 이 일반화 함수로 갈아타서 **팝오버 코드 1벌 유지**.
- 키보드: `B` = 책갈피 토글(입력칸 포커스 중엔 무시, 기존 onKey 가드 그대로).
### 형광펜
- **칠하기**: 텍스트 드래그 → 기존 `.reader-hidepop`에 **색 동그라미 3개(노랑·초록·분홍)** 를 "이 문자열 숨기기" 왼쪽에 추가. 클릭 즉시 칠함+저장+팝오버 닫힘. 선택 규칙은 숨기기와 동일(2~300자, 한 줄). 페이지 모드에도 붙여야 함: `mounted.paged`면 `pager.doc`에 attach. **stage 탭 판정과 충돌 방지**: `stage.onclick`에서 `window.getSelection()`이 비어 있지 않으면(드래그 직후) 넘김/바 토글을 하지 않는다(한 줄 가드).
- **렌더**: 표시 HTML 마운트 직후(`mountReaderBody` 끝, 위치 복원 전) 저장된 형광펜을 순회하며 Range를 찾아 `<mark class="lp-hl" data-id data-c="y">`로 감싼다(Range.surroundContents는 경계 넘으면 실패 → 텍스트 노드 단위로 쪼개 감싸는 `wrapRange` 유틸). 인라인 요소라 multicol 페이지 계산 영향 없음. 이미 살균된 DOM에 우리가 넣는 것이라 XSS 무관.
- **칠한 곳 클릭**: 미니 메뉴(색 3개·메모·복사·지우기). 메모는 2단계 범위 밖(필드만 예약, UI는 3단계).
- **목록**: 좌하단 `형광펜 N` 알약 버튼 → 팝오버(색 점 + q 앞 60자 + 고아 표시). 클릭=그 mark로 점프(페이지=`goTo(pageOf(mark))`, 스크롤=y). 
- 색 CSS: 리더 테마별 가독성 — `mark.lp-hl[data-c=y]{background:rgba(255,220,0,.38)}` 등, 다크/night에서는 알파 낮추고 밑줄 보조(`box-shadow: inset 0 -2px`). 글자색은 건드리지 않음(currentColor 유지).
### 파파·공유
- **파파 로그 제외**(Shadow DOM 격리라 선택 Range가 셸에서 안 보임 + "그대로 삼키기" 철학). 버튼 자체 안 그림.
- **공유 리더(#/share)**: 책갈피·형광펜 모두 **로컬 전용**(비로그인 열람이라 KV 아님 → `pro2-marks` 대신 localStorage `pro2-share-marks`). 1단계에선 공유는 책갈피만, 형광펜은 3단계에서.

## 5. 구현 단계 (단계마다 커밋·푸시 한 세트, `npm run web:build` + `npm test`)
### 1단계 — 책갈피 (반나절)
- 파일: `web/src/store.ts`(`MARKS_KEY='pro2-marks'`, `loadMarks/saveMarks`) · `web/src/readerView.ts`(귀퉁이 버튼·목록 팝오버·`attachListPop` 일반화·`B`키) · `web/src/readerLog.ts`(화 삭제 시 정리) · `style.css` · `help.ts`.
- 금지: 저장 html 수정, 페이저 relayout 로직 변경, 기존 목차·위치 기억 동작 변경(회귀 0).
- 완료 조건: 페이지·스크롤 양 모드에서 꽂기/빼기/목록/점프/삭제 동작, 글자 크기 바꿔도 같은 지점, 로그인 기기 간 동기화(kv), 화 삭제 시 정리, 빌드·테스트 통과.
### 2단계 — 형광펜 칠하기·렌더 (1일)
- 신규 **`core/reader/textAnchor.js`(CJS, GPL 헤더)**: `makeAnchor(rootText, start, end)`·`resolveAnchor(root, anchor)`·`wrapRange(range, attrs)` 순수 함수 + `textAnchor.test.js`(정확 일치·중복 q·문맥 선택·고아·블록 힌트 이동·mark 감싸기 경계). `package.json` test 체인에 추가. ★web/src는 테스트가 없으므로 앵커 로직은 반드시 core에.
- `readerLog.ts` `attachHideSelection` → 색 버튼 추가 + 페이지 모드 부착 + stage 탭 가드(`readerView.ts`). `mountReaderBody` 끝에 `applyHighlights(root, list)`.
- 완료 조건: 칠하기→새로고침→그대로, 정리/원본·원문/번역 토글 후에도 텍스트 남아 있으면 유지(view 다르면 목록만), 페이지 모드 드래그가 페이지 넘김을 유발하지 않음, 복사·공유·아카 카드 결과물에 `<mark>` 없음(저장 html 불변 확인), 상한 경고.
### 3단계 — 모아보기·연계 (반나절)
- 리더 `형광펜 N` 목록 팝오버 + 칠한 곳 클릭 메뉴(색 변경·지우기·메모).
- 서재 작품 페이지 화 목록에 `🔖 2 · 🖍 5` 배지, 내 기록(#/stats)에 "형광펜 N개·책갈피 N개" 타일. Wrapped 카드 "내가 밑줄 친 문장 TOP 3"(형광펜 없으면 기존 명대사 로직 유지).
- 공유 리더 형광펜(로컬).

## 6. 리스크·주의
- **앵커 실패율**: 번역 토글은 텍스트 자체가 달라 원문/번역 각각 별개 앵커(view 필드). 리스 렌더엔진 갱신으로 표시 텍스트가 바뀌면 고아가 늘 수 있음 → 목록에서 고아 일괄 정리 버튼.
- **페이지 모드 선택 vs 탭**: 모바일에서 길게 눌러 선택 → touchend가 스와이프/탭으로 오인될 수 있음. `swiped` 플래그처럼 `selecting` 가드 추가(touchend 시 selection 비어 있지 않으면 무시).
- **KV 문서 크기**: `pro2-marks`는 kv 문서에 merge되는 한 필드. 5,000개×~200B≈1MB 근접 → 상한 강제. 초과 시 오래된 화부터 정리 제안(자동 삭제 X).
- **성능**: 형광펜 복원은 화당 최대 200개 × textContent 검색. 본문 5만 자 기준 수 ms. 문제 시 블록 힌트 우선 탐색으로 충분.
- **롤백**: 기능 플래그 없음. 이 문서 커밋이 체크포인트. 단계별 커밋이라 `git revert <단계 커밋>`로 단계 단위 철회 가능. `pro2-marks` 키는 남아도 무해(읽는 코드가 없으면 그냥 KV 한 필드).

## 7. 사장님 결정 필요 (추천 = 굵게)
1. 저장 범위: **로그인 시 계정 동기화(kv)** vs 기기 로컬만. → 동기화 추천(폰에서 칠하고 PC에서 모아보기가 핵심 가치).
2. 형광펜 색: **3색(노랑·초록·분홍)** vs 1색. → 3색(리디 기본 4색 중 가독 좋은 3개).
3. 메모 첨부: **3단계로 미룸** vs 2단계 포함.
4. 일반(챗버블·카드) 로그에도 형광펜: **허용(세로 스크롤)** vs 웹소설형만. → 허용. 책갈피는 스크롤 비율이라 어디든 됨.
5. 아카 카드 연계(밑줄 TOP 3): **3단계 마지막에, 사장님 시안 확인 후**.
