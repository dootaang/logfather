# 골든 캡처 플랜 (Pro 1.2 → Pro 2 패리티 코퍼스 확장)

이 문서는 개발자가 **Pro 1.2를 직접 실행**하여 나머지 골든 코퍼스를 생산하기 위한 작업 체크리스트다. 각 레시피는 Pro 1.2의 특정 동작(주로 *조용히 깨질* 위험이 큰 색 계산·유니코드·이미지 패턴)을 바이트 단위로 고정(pin)하는 것을 목표로 한다.

## 캡처 규칙 (모든 레시피 공통)

1. **RAW 출력만 캡처한다.** Pro 1.2 출력창(`output_text`) = 클립보드에 복사되는 PRE-paste HTML이 권위 출처다. arca.live에 붙여넣은 POST-paste 결과를 골든으로 쓰면 통제 불가능한 외부 변환을 재현하려다 영원히 실패한다(README의 PRE/POST 구분 참고).
   - 캡처 방법: 변환 실행 → 출력창 전체 선택 → **복사 직전의 그대로**를 파일에 저장. 에디터가 줄바꿈/인코딩을 건드리지 않게 한다.
2. **각 레시피는 세 파일로 저장한다.**
   - `expected/<id>.raw.html` — Pro 1.2 RAW 출력 (바이트 단위 권위 출처)
   - `inputs/<id>.txt` — 변환에 넣은 입력 텍스트 그대로
   - `settings/<id>.json` — 그 입력에 적용한 설정 스냅샷
3. **인코딩은 UTF-8(BOM 없음)으로 고정한다.** 특히 유니코드 따옴표(U+201C/U+201D/U+2033/U+0027)와 말줄임표(U+2026)가 ASCII로 접히지 않도록, 저장 후 **헥스/코드포인트 뷰어**로 해당 바이트가 살아있는지 확인한다.
4. **`needsCardFile=true` 레시피(R13–R16)는 사용자가 샘플 카드(.png / .charx / .json)를 제공해야** 진행할 수 있다. 카드 파서 경로는 합성 입력으로 재현하기 어려우므로, 해당 분기(chara / ccv3 / ccv2 / charx)를 실제로 트리거하는 샘플 카드를 미리 확보한 뒤 캡처한다. 카드 레시피의 골든은 HTML이 아니라 **`image_uri_map`(name→key) 바이트 맵**이다 — `expected/<id>.raw.html` 대신 `expected/<id>.map.json`(또는 동등한 덤프)으로 저장하고 입력 카드 파일은 `inputs/<id>.<ext>`로 함께 보관한다.
5. **"Run TWICE" 표기 레시피**는 토글 한 개만 바뀐 두 캡처(A/B)를 만든다. 각 캡처는 `<id>-A` / `<id>-B` 접미사로 세 파일을 따로 저장한다.

> 진행 순서: 아래 테이블을 위에서 아래로 처리하되, **"우선순위" 섹션의 5–6개를 먼저** 캡처한다(조용한 회귀 위험 최상위).

---

## 1. 유니코드 / 텍스트 무결성

스마트 따옴표·말줄임표·CRLF가 ASCII로 접히거나 정규화되어 조용히 사라지는 위험. 색 칠하는 span 경계가 유니코드 코드포인트에 의존한다.

| id | 대상 리스크 | 입력 | 설정 | 검증 포인트 | 카드필요 |
|---|---|---|---|---|---|
| R01-unicode-quotes | §10.1 #2 유니코드 따옴표-클래스 손실. dialog_pattern(L5692) open {U+0022,U+2033,U+201C}…close {U+0022,U+2033,U+201D}; inner_thoughts_pattern(L5695) U+0027-클래스, 나레이션 간극에만 적용 | `걸어가며 "안녕" 하고 ″또 봐″ 라고 했다 '속으로는 싫어' 그리고 끝.` (스마트 따옴표 U+201C/U+201D, U+2033, U+0027 사용) | Text: dialogColor=#4a4a4a, dialogBold=on, narrationColor=#4a4a4a, innerThoughtsColor=기본(라이브-텍스트 경로), useTextSize=off(font-size:'' 빈값), useTextIndent=off, dialogNewline=off, convertEllipsis=off, removeAsterisk=off. showProfile=off. 한 문단 | dialog span `color:#4a4a4a; font-weight:bold;` 가 "안녕" 과 ″또 봐″ 각각을 감싼다(2개). 간극은 narration span(`color:#4a4a4a;`). '속으로는 싫어'는 inner-thoughts span(나레이션 간극 안의 U+0027). **CRITICAL: U+201C/U+201D/U+2033/U+0027 코드포인트가 매치 경계와 출력 텍스트 양쪽에서 verbatim 생존** — 헥스 뷰어로 확인, ASCII `"`/`'`로 접히면 안 됨 | ❌ |
| R08-ellipsis-on-off | §10.1 convertEllipsis. format_conversation L5686-5687: on이면 문단 전체 `text.replace('...', '…')`(U+2026). 정확히 ASCII 3점만; 2점/4점 동작 핀. **Run TWICE** | `잠깐... 그리고.. 또....` | 동일 입력 2회. A: convertEllipsis=ON / B: convertEllipsis=OFF. 둘 다 removeAsterisk=off, dialogNewline=off, useTextIndent=off, useTextSize=off, showProfile=off, narrationColor=#4a4a4a. 한 문단 | A(on): `...`→`…`(U+2026), `..`(2점)는 그대로, `....`(4점)→`…`+`.` (앞 3점만 소비). 기대 나레이션 = `잠깐… 그리고.. 또….`. U+2026 바이트와 2점 미변경·4점=…+. 확인. B(off): 전부 ASCII 그대로 `잠깐... 그리고.. 또....` | ❌ |
| R07-crlf-input | §10.1 #8 CRLF 처리. Pro 1.2 convert_text는 `\r\n` 정규화 **안 함**(L5955-5990); 스펙 §6.1은 Pro 2.0이 `\r\n→\n` 추가하라 함. Pro 1.2 실제 CRLF 동작을 캡처해 포트의 정규화를 권위 출력에 대해 검증 | `inputs/r07-crlf-input.txt`를 **리터럴 CRLF**로 생성: line1=`첫 줄` CRLF `<center>` CRLF `끝 줄`. PowerShell: 세 줄을 `` `r`n ``로 join 후 저장. 그 바이트를 그대로 입력창에 붙여넣거나 파일 로드. **`\r`가 반드시 존재** | Text: removeAsterisk=off, convertEllipsis=off, dialogNewline=off, useTextIndent=off, useTextSize=off. showProfile=off. 한 문단(이중 빈 줄 없음) | trailing `\r` 처리 캡처. Pro 1.2에서 `line.split('\n')`은 비-마지막 줄에 `\r`를 남김; `'<center>\r'.strip()=='<center>'` → `<...>` 줄은 여전히 드롭(strip이 \r 제거). 그러나 나레이션 텍스트 `첫 줄\r`은 span **안에 \r 포함**되어 방출(나레이션은 raw 슬라이스 사용). 정확한 바이트 핀: 방출된 나레이션 span 안에 `\r`가 생존하는지 확인. 포트의 `\r\n→\n` 정규화가 바꾸는 바이트이므로 양쪽 기록해 분기 문서화 | ❌ |

---

## 2. 색 계산 / 부동소수 직렬화 (HSV·float 바이트 핀)

QColor lighter/darker(120)의 HSV-V 스케일링과 Python float 문자열(`2.0` vs `2`)은 순진한 JS 포트가 **다른 hex/문자열**을 내어 조용히 깨진다. 가장 위험한 그룹.

| id | 대상 리스크 | 입력 | 설정 | 검증 포인트 | 카드필요 |
|---|---|---|---|---|---|
| R02-tag-styles-3way | §10.1 #1 QColor.lighter/darker(120) HSV 색 계산 + 3-way 태그 스타일 분기(L5869-5886): 기본=solid bg, 투명 배경=transparent+1px border, 그라데이션=linear-gradient(135deg, lighter(120), darker(120)). per-channel RGB multiply는 HSV-V 스케일링과 다른 hex 생성 | `x` | Profile: showProfile=on, showProfileImage=off, showBotName=off, showDivider=off, showTags=on. 태그 3행 **동일 배경** color=#4a90d9, textColor=#000000 (borderRadius=20, fontSize=0.85, padding 0.2/0.8/0.2/0.8): tag1 '기본태그' 기본; tag2 '투명태그' 투명 배경; tag3 '그라데이션' 그라데이션. Box/text 기본 | 태그 컨테이너에 span 3개. (1) 기본태그 → `background:#4a90d9;border:none`. (2) 투명태그 → `background:transparent;border:1px solid #4a90d9`. (3) 그라데이션 → `background:linear-gradient(135deg, <LIGHT>, <DARK>);border:none` — **base #4a90d9의 lighter(120)/darker(120) 결과 hex 바이트를 정확히 기록**(qtColor.ts 바이트 핀; per-channel RGB 포트는 다른 hex 생성). 세 span 공통 prefix `display:inline-block;border-radius:20px;font-size:0.85rem;padding:0.2rem 0.8rem 0.2rem 0.8rem;color:#000000;margin:0.15rem 0.2rem;white-space:nowrap` 확인 | ❌ |
| R11-divider-float-even-odd | §10.1 #9 + §10.4 float 문자열. create_template L5913 `border-radius:{thickness/2}px`. Python 4/2→`2.0`(.0 유지), 3/2→`1.5`. JS 4/2→`2`. formatPyFloat 바이트 핀. **Run TWICE**(짝수 4, 홀수 3) | `내용` | Profile: showProfile=on, showProfileImage=off, showBotName=off, showTags=off, showDivider=on. dividerStyle=단색, dividerSolidColor=#b8bacf. A: thickness=4(짝수) / B: thickness=3(홀수). Box/text 최소 | A(4): divider div `height:4px;background:#b8bacf;margin:1rem 0;border-radius:2.0px;` — radius가 **`2.0`** 이어야 함(`2` 아님). B(3): `height:3px;...border-radius:1.5px;`. `2.0` vs `1.5` 리터럴 바이트 핀; 순진한 JS 포트는 짝수에 `2`를 내어 패리티 깨짐 | ❌ |
| R12-inner-thoughts-default-divergence | §4.3 + §10.1 #12 inner_thoughts_color 기본값이 두 경로에서 다름: format_conversation(라이브-텍스트, L5679)은 라이브 위젯을 읽고 기본=dialog_color(#4a4a4a), color-preset 로드(load_preset L1018)는 기본 #718096. 라이브-텍스트 경로 기본을 캡처해 포트가 둘을 통합하지 않게 | `narration 'inner voice' narration end` | A(라이브-텍스트 기본): 새 앱/기본 텍스트 설정, 컬러 프리셋 **로드 안 함**; dialogColor=#4a4a4a(기본), innerThoughtsColor 손대지 않아 dialog 기본과 같게. innerThoughtsBold=off, useTextSize=off, useTextIndent=off, dialogNewline=off, removeAsterisk=off, convertEllipsis=off, showProfile=off. B(프리셋 경로): inner_thoughts_color=#718096 가진 빌트인 컬러 프리셋 로드 후 같은 입력 변환 | A: 'inner voice' inner-thoughts span이 `color:#4a4a4a`(라이브 위젯 dialog-color 폴백) 방출 — #718096 **아님**. span 템플릿 `color:#4a4a4a;  <bold-or-empty> <size-or-empty>`. B: 프리셋 로드 후 inner-thoughts span이 `color:#718096`. 둘 다 핀해 포트가 두 기본을 유지하게(통합 시 라이브-텍스트 경로 깨짐). #718096 빌트인 프리셋 없으면 수동 설정 후 preset-path 대표로 문서화 | ❌ |

---

## 3. 이미지 패턴 / URL 처리

5개 이미지 패턴 × 4개 토큰 형식, 매핑/미매핑 분기, URL 정제(query 보존·`//`→https·`&amp;` 단일 디코드·width:0px 주입 제거). 토큰/패턴 누락은 이미지가 조용히 사라지거나 그대로 남는 결과를 낳는다.

| id | 대상 리스크 | 입력 | 설정 | 검증 포인트 | 카드필요 |
|---|---|---|---|---|---|
| R03-image-5patterns-4tokens | §10.1 #6 + §8.1 5개 _get_image_patterns(L5541-5549) + 4토큰 `{{img::}}`/`{{img=}}`/`{{image::}}`/`<img src='name'>`; 매핑된 태그는 fr-fic fr-dii 방출(_create_image_html L5532), 미매핑은 verbatim 통과(replace_tag full_match). `<img=...>` 패턴 4·5도 행사 | 5줄 한 문단:<br>`{{img::Orca_smile}}`<br>`{{img=Orca_smile}}`<br>`{{image::Orca_smile}}`<br>`<img src='Orca_smile'>`<br>`{{img::Unknown_tag}}` (줄 사이 빈 줄 없음) | Asset 관리: 매핑 1행 tag='Orca_smile' url='https://example.com/o.png'. assetImage: imageSize=100, imageMargin=10, useImageBorder=off, useImageShadow=on. Text: removeAsterisk=off, convertEllipsis=off, dialogNewline=off, useTextIndent=off, useTextSize=off. showProfile=off | 앞 4줄(4토큰 모두 Orca_smile로 해석) 각각 _create_image_html 블록: `<div style="margin-bottom:1rem; width:100%; text-align:center;"><img style="… max-width:100%; margin:10px 0; border-radius:12px; box-shadow:rgba(0,0,0,0.12) 0px 4px 16px;" src="https://example.com/o.png" alt="Orca_smile" class="fr-fic fr-dii"></div>`. alt·class 바이트 정확히. 5번째 `{{img::Unknown_tag}}` 는 **verbatim 유지**(미매핑). 이미지 div의 이중 래핑 없음 확인 | ❌ |
| R04-url-cleaning | §10.1 #11 + §6.8.b body cleanUrl. _collect_url_mappings(L5480) `style="width: 0px; height: 0px;"` 제거를 _clean_url(L5487) **전에**. _clean_url(L5572): `//`→https: prefix, `&amp;`→`&` 단일 디코드, `<img src=...>` 추출. body URL은 _clean_url 사용(process_image_url 아님)이라 namu.la/dcinside query 보존 | 4줄 한 문단:<br>`{{img::a}}`<br>`{{img::b}}`<br>`{{img::c}}`<br>`{{img::d}}` | Asset 관리 4행: a url=`https://gall.dcinside.com/pic.jpg?signature=AbC123&expires=999`(서명 query 보존); b url=`//namu.la/path/img.png?token=xyz`(protocol-relative→https:); c url=`https://x.com/i.png?w=1&amp;h=2`(단일 &amp; 디코드); d url=`https://x.com/z.png style="width: 0px; height: 0px;"`(width:0px 주입 제거). showProfile=off. 한 문단 | 4개 `<img src="…">` 값: (a) `…/pic.jpg?signature=AbC123&expires=999` query 온전. (b) `https://namu.la/path/img.png?token=xyz` 선행 `//`→https:. (c) `https://x.com/i.png?w=1&h=2` &amp;→& **정확히 1회**(이중 디코드 아님). (d) `https://x.com/z.png ` (literal style 제거, replace가 남긴 trailing space + cleanUrl `.strip()`). 4개 src 바이트 핀 | ❌ |

---

## 4. 텍스트 변환 / 라인 처리 (단어 치환·라인 드롭·div 패스스루)

Python `str.replace`는 전역, JS `String.replace`는 첫 번째만 — 단어 치환의 가장 위험한 회귀. `<...>`-only 라인의 조용한 드롭(데이터 손실)과 `<div`-시작 문단의 패스스루도 핀.

| id | 대상 리스크 | 입력 | 설정 | 검증 포인트 | 카드필요 |
|---|---|---|---|---|---|
| R05-word-replace | §10.1 #3 단어 치환 전역 + 빈-to 삭제 + 공백 보존. convert_text L5967-5971: Python str.replace 전역(JS는 첫-만); to_word=''(빈=삭제); from/to 공백 보존(strip 없음) | `냥 냥 냥 그리고 [지움] 끝 ab  cd` | 텍스트(단어치환) 3행: r1 from='냥' to='야옹'(3회 전부); r2 from='[지움]' to=''(빈=삭제); r3 from='ab  cd' to='ab cd'(이중 공백→단일, literal 매칭). Text: removeAsterisk=off, convertEllipsis=off, dialogNewline=off, useTextIndent=off, useTextSize=off. showProfile=off. 한 문단 | 단어 치환 후(포맷 전) `냥` 3개 **전부**→`야옹 야옹 야옹`(첫-만 포트는 2·3번째 미변경 — 회귀 핀). `[지움]` 완전 제거 → `그리고  끝`(주변 공백 verbatim 보존). `ab  cd`(2공백)→`ab cd`(1공백), 임베디드 이중 공백 from이 literal 매칭됨 확인. 최종 나레이션 span 텍스트 바이트 단위 검증 | ❌ |
| R06-line-drop-vs-div-passthrough | §10.1 #4 `<...>`-only 라인 드롭(format_conversation L5705-5706 `continue`) vs convert_text L5982 `<div`-시작 문단 패스스루. 생존한 `<tag>`-only 라인은 드롭(데이터 손실 재현); `strip().startswith('<div')` 문단은 format_conversation 전체 우회 | `보이는 문장`<br>`<center>`<br>`또 보이는 문장`<br>(빈 줄)<br>`<div style="color:red">이미 div</div>` | Text: removeAsterisk=off, convertEllipsis=off, dialogNewline=off, useTextIndent=off, useTextSize=off, dialogColor=#4a4a4a, narrationColor=#4a4a4a. showProfile=off. `\n\n`이 두 문단으로 분할: para1=3줄, para2=`<div>`줄 | Para1(`<div style="margin-bottom:1.5rem;">` 래핑): `보이는 문장`→narration span; `<center>` 줄 **전체 드롭**(no `<p>`/span — 부재 확인, 의도적 데이터 손실 재현); `또 보이는 문장`→narration span. Para2: `<div`로 시작하므로 format_conversation 우회, **RAW 그대로** append(no margin-bottom:1.5rem 래퍼, no span 색칠). 드롭된 라인 부재 + raw 패스스루 둘 다 핀 | ❌ |

---

## 5. 박스 / 패딩 구조 (color-role 스왑·spacer 유무)

showInnerBox 토글 시 색 역할이 **SWAP**되고, usePadding은 카드 앞뒤 spacer 유무를 결정. 분기 양쪽을 핀해야 포트가 한쪽만 구현하는 회귀를 잡는다.

| id | 대상 리스크 | 입력 | 설정 | 검증 포인트 | 카드필요 |
|---|---|---|---|---|---|
| R09-show-inner-box-on-off | §10.1 showInnerBox 색 스왑. create_template L5785-5798: ON이면 background_color=outer_box_color + inner box div가 inner_box_color로 padding+radius; OFF이면 background_color=inner_box_color + inner box style=padding:0. 색 역할 SWAP. **Run TWICE** | `내용` | Box: outerBoxColor=#ffffff, innerBoxColor=#f8f9fa, useBoxBorder=off, shadowIntensity=8. showProfile=off. Text 최소. A: showInnerBox=ON / B: showInnerBox=OFF | A(on): 최외곽 카드 div `background:#ffffff`; inner div style에 `font-size:14px; background:#f8f9fa; padding:24px; border-radius:8px;`. B(off): 최외곽 카드 div `background:#f8f9fa`; inner div style에 `font-size:14px; padding:0;`(no background, no border-radius, no 24px). 스왑 정확히 핀: outer-bg = on→outerColor, off→innerColor; inner box style 두 분기 바이트 단위 상이 | ❌ |
| R10-use-padding-on-off | §10.1 usePadding spacer. create_template L5771: `padding_html='<p><br></p>' if use_padding else ''`. 카드 div 앞(L5931)·뒤(L5949) 양쪽 방출. **Run TWICE** | `내용` | Text: usePadding 토글. showProfile=off. Box 기본. A: usePadding=ON / B: usePadding=OFF | A(on): 출력이 `<p><br></p>`로 **시작**(다음 줄에 카드 div) 하고 `</div>` 뒤 `<p><br></p>`로 **끝**. spacer 2개(앞1 뒤1). B(off): 출력이 카드 `<div>`로 바로 시작(f-string 앞 위치 빈 문자열 → div 앞 leading newline) 하고 trailing `<p><br></p>` 없음. spacer 유무 + leading-whitespace 바이트 정확히 핀 | ❌ |

---

## 6. 카드 파서 (image_uri_map name→key 바이트 핀) — 사용자 샘플 카드 필요

§6.7 카드 파싱의 네 분기(chara / ccv3 / ccv2 / charx)는 **서로 다른 key 모양**을 낸다(.png 접미사 유무, off-by-one 폴백). 합성으로 재현이 어려우므로 **사용자가 각 분기를 트리거하는 샘플 카드(.png/.charx/.json)를 제공**해야 한다. 골든은 HTML이 아니라 import 후의 `image_uri_map` name→key 맵 바이트.

| id | 대상 리스크 | 입력 | 설정 | 검증 포인트 | 카드필요 |
|---|---|---|---|---|---|
| R13-card-png-chara | §6.7.b chara 분기(PNG tEXt v3, L1683-1684): key=`keyword.split(':')[-1]` → `chara-ext-asset_:{…}`, **.png 접미사 없음**. ccv2/ccv3 key 도출과 병합 금지 | RisuAI/TavernAI v3 캐릭터 카드 `.png`(tEXt 청크 chara/ccv3 keyword, ext assets 포함). 카드 import | I/O 카드 import: `.png` 카드 import. 결과 image_uri_map(name→key)·image_data 검사. 변환 토글 불필요(파서 경로) | chara(PNG tEXt v3) 경로의 각 asset key = `keyword.split(':')[-1]` → `chara-ext-asset_:…` 형태, **trailing .png 없음**. name→key 맵 전체 바이트를 골든으로 캡처. key에 .png 없음 확인(.png는 ccv2 전용). R14/R15와 교차 확인해 세 분기가 다른 key 모양 산출 | ✅ |
| R14-card-png-ccv3 | §6.7.b ccv3 positional-zip 분기(L1874-1879,1794,1806): zip 위치 순서+card.json name으로 key; image_uri_map **먼저 clear**; name.lower() in {iconx, main} 제외; name 충돌→`{name}_{counter}`. + §6.7.a charx off-by-one: asset_names `str(i+1)`(1-based) vs zip `0.png..`(0-based) → 0.png가 name '1' 못 만나 `asset_0` 폴백 | positional asset(PNG/charx 내 zip-packed) 가진 CharacterCardV3 카드; 'icon'/'main' 이름 asset 1개 이상(제외 대상) + name 충돌 + 0-based 파일 인덱스 vs 1-based asset_names 불일치가 드러날 만큼의 asset. 카드 import | 카드 import. import 후 image_uri_map 검사 | (1) image_uri_map이 매핑 전 **clear**(이전 import 잔여 없음). (2) iconx/main(대소문자 무시) 이름 asset **드롭**. (3) 첫 zip 엔트리 0.png가 1-based asset_names 못 만나 → key `asset_0` 폴백(off-by-one 재현, 수정 금지). (4) name 충돌은 `_{counter}` 접미사. (5) key에 .png 없음. positional name→key 맵 전체 바이트 핀; 최고 위험 3분기 분기 | ✅ |
| R15-card-json | §6.7 + §6.7.b ccv2 additional-asset 분기(.json 카드, L1849-1850): key=`asset_uri.split(':')[1]` + .png **append** → `chara-ext-asset_{n}.png`. .json dispatch(parseCard .json 분기)는 ccv2/json key 도출로 라우팅, chara/ccv3와 구별 | additionalAssets / ext assets(asset_uri 값) 가진 RisuAI `.json` 캐릭터 카드. 카드 import(.json) | 카드 import as .json. image_uri_map 검사 | ccv2-style additional asset의 key = `asset_uri.split(':')[1]` + `.png` **append**(예 `chara-ext-asset_3.png`). **.png append하는 유일한 분기** — 여기엔 접미사 있고 R13(chara)/R14(ccv3)엔 없음 확인. .json dispatch의 name→key 맵 바이트 핀 | ✅ |
| R16-card-charx | §6.7.a charx off-by-one(L1778 asset_names `str(i+1)` 1-based, L1791 zip `0.png` 0-based, L1794 `asset_names.get('0', 'asset_0')` → `asset_0` 폴백). DECISION: 버그 재현, 수정 금지. .charx dispatch(zip unzip)가 0.png→asset_0 폴백 정확히 재현 | card.json asset_names가 '1','2',…(1-based)이고 zip이 0.png,1.png,…(0-based) 가진 `.charx`(zip) 카드. 카드 import(.charx) | 카드 import as .charx. image_uri_map / asset name 해석 검사 | off-by-one **재현** 확인: zip 0.png가 asset_names['1'] 못 만남; `asset_names.get('0','asset_0')`가 첫 파일에 `asset_0` 폴백, 이후 파일 shift. 해석된 name→key 맵 정확히 핀. 골든은 'corrected' 매핑이 아니라 buggy `asset_0` 폴백 잠금(off-by-one 수정 포트는 asset_0에 이미 태깅한 사용자 깨뜨림) | ✅ |

---

## 우선순위 (먼저 캡처할 5–6개)

조용한 회귀(silent breakage) 위험이 가장 큰 순서. 색 계산·유니코드·이미지 패턴은 포트가 "그럴듯하게 다른" 출력을 내어 테스트 없이는 눈에 안 띈다.

| 순위 | id | 왜 먼저인가 |
|---|---|---|
| 1 | **R02-tag-styles-3way** | HSV-V lighter/darker(120) 색 수학. per-channel RGB 포트가 *유효하지만 다른* hex를 내어 조용히 깨짐. qtColor.ts 전체의 바이트 핀이라 다른 색 작업의 기준점. |
| 2 | **R11-divider-float-even-odd** | Python `2.0` vs JS `2` float 직렬화. formatPyFloat 한 줄짜리지만 모든 thickness/2·padding 계산에 퍼져 있어 미루면 광범위 회귀. 캡처도 빠름. |
| 3 | **R01-unicode-quotes** | U+201C/U+201D/U+2033/U+0027이 ASCII로 접히면 span 경계가 통째로 어긋남. 에디터/인코딩이 조용히 망가뜨리는 클래식 위험 — 헥스 검증 필수. |
| 4 | **R03-image-5patterns-4tokens** | 5패턴×4토큰 매핑/미매핑. 토큰 하나 누락 시 이미지가 사라지거나 raw로 남음. fr-fic fr-dii·alt·class 바이트가 paste 생존성에 직결. |
| 5 | **R05-word-replace** | Python str.replace 전역 vs JS 첫-만. 사용자가 가장 흔히 쓰는 기능이라 회귀 시 광범위·즉각 체감. 합성 입력으로 즉시 캡처 가능. |
| 6 | **R04-url-cleaning** | `&amp;` 이중 디코드·`//`→https·width:0px 주입·query 보존. URL 한 글자만 틀려도 이미지 깨짐. R03와 함께 이미지 경로를 완전 봉인. |

> R13–R16(카드 파서)은 위험은 높으나 **사용자 샘플 카드가 도착한 뒤** 착수한다. 카드가 준비되면 R14(ccv3 3분기) → R16(charx off-by-one) → R13/R15 순으로, 세 key 모양의 차이를 한 번에 교차 검증하며 캡처할 것.
