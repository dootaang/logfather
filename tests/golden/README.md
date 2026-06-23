# 골든 회귀 테스트 코퍼스 (Pro 1.2 → Pro 2 패리티 권위 출처)

이 폴더는 Pro 2의 `core/`가 Pro 1.2와 **바이트 단위로 동일한 HTML**을 생성하는지 고정(pin)하는 골든 픽스처를 보관한다.

## ⚠️ 가장 중요한 구분: PRE-paste vs POST-paste

| | RAW (core 출력) | POST-paste (arca 변환본) |
|---|---|---|
| 정체 | Pro 1.2 출력창(`output_text`) 내용 = 클립보드에 복사되는 그대로 | 위를 arca.live Froala 에디터에 붙여넣고 이미지가 namu.la CDN에 업로드된 뒤 |
| **core 골든 expected** | ✅ **이것이 권위 출처** | ❌ 직접 쓰면 안 됨 |
| 용도 | `createTemplate`/`formatConversation` 출력 핀 | paste-fidelity(헤드라인 #2) 레퍼런스 + 구조 검증 |

> **이유:** core의 책임은 클립보드에 올라가는 PRE-paste HTML을 만드는 것이다. arca는 그 뒤 우리가 통제할 수 없는 변환(아래 델타)을 가한다. core 골든을 POST-paste로 잡으면 통제 불가능한 외부 변환을 재현하려다 영원히 실패한다.

## 폴더 구조 (목표)
```
tests/golden/
├─ README.md
├─ samples/                       # 참고용 실제 산출물
│  └─ orca-card.arca-pasted.html  # POST-paste 레퍼런스 (사용자 제공 2026-06-15)
├─ inputs/*.txt                   # 변환 입력 텍스트
├─ settings/*.json                # 각 입력에 대한 설정 스냅샷
└─ expected/*.html                # ★ Pro 1.2 RAW 출력 (캡처 대기)
```

## 샘플 #1 (orca-card) 이 검증/확정해 준 사실

이 POST-paste 샘플 하나가 설계서의 다음을 **실측으로 확인**했다:

1. **다크모드 의존성** — 카드 컨테이너 `color:#FFFFFF`. `create_template`의 `STYLES['text']`는 main()에서 OS 다크모드 감지 시 `#FFFFFF`로 덮인다(기본 `#000000`). → **같은 설정이 OS 테마에 따라 다른 출력**. Pro 2는 이를 OS 의존이 아니라 명시적 테마 토큰(`--card-text`)으로 고정해야 한다(§7.0 보강 필요).
2. **박스 로직** — `show_inner_box` OFF → 카드 배경 = `inner_box_color`(#f8f9fa), inner div = `font-size:14px;padding:0;`. ✓
3. **그림자 공식** — `shadow=8` → `0px 8px 16px`. ✓
4. **구분선 float** — `thickness=1` → `border-radius:0.5px`(thickness/2). 짝수면 `2.0`. → float 문자열 핀 필요(§10.1 #9). ✓
5. **태그** — 커스텀 템플릿 tag_colors `#edf2f7/#e2e8f0/#cbd5e0`, border-radius 20px, font 0.85rem. ✓
6. **대사 구조** — `dialog_newline` ON → 대사는 `<div margin-top/bottom:1em>`, 나레이션은 인라인 `<span>`. 한 문단(line) 안에서 div/span 교차. ✓ (format_conversation line 5740-5744)
7. **유니코드 따옴표** — 입력이 `″`(U+2033)를 썼고 dialog_pattern(line 5692) char class가 매칭. ✓

## arca 변환 델타 (POST-paste에서 관측 — headline #2/flatten 설계에 직결)

| 변환 | RAW (core가 생성) | POST-paste (arca) | 비고 |
|---|---|---|---|
| style 공백 | `color:#2d3748; font-weight:bold; font-size:14px;` | `color:#2d3748;font-weight:bold;font-size:14px;` | arca가 세미콜론 뒤 공백 제거 |
| trailing `;` | `text-indent:20px` (없음, line 5758) | `text-indent:20px;` | arca가 추가 |
| **img 색상** | `border:3px solid #e2e8f0` | `border: 3px solid rgb(226, 232, 240)` | hex→rgb + 공백 (img에만) |
| **img src** | 원본 매핑 URL | `//ac.namu.la/...?expires=&key=` | arca CDN 업로드 |
| img 속성 | `alt="profile" class="fr-fic fr-dii"` | alt 제거 / `data-originalurl` 추가 / class 유지 | |
| 엔티티 | `″` `…` 및 공백 (literal) | `&Prime;` `&hellip;` `&nbsp;` | arca 인코딩 |

**핵심 함의:** 비-이미지 요소의 인라인 CSS(hex 색·구조)는 arca에서 **그대로 생존**한다 → flatten 인라인 전략이 옳다. 이미지만 재호스팅/재직렬화되며 이는 정상(이미지는 어차피 CDN 업로드). 즉 core는 RAW를 정확히 만들고, paste 생존성은 비-img 인라인 CSS에 달려 있다.

## 골든 비교 정책 — **정규화 비교** (권장 결정)

`create_template`의 f-string은 의미 없는 공백을 다수 만든다(아래 명세). 채팅 paste·에디터 저장·LLM 전송 모두 trailing space를 잃으므로, **바이트-정확(trailing space 포함) 비교는 취약하고 포팅을 Python 들여쓰기 사고에 묶는다.** 따라서 골든 비교는 다음 **정규화** 후 수행한다:

1. 각 물리적 줄의 **끝 공백 제거**(`rstrip` per line).
2. 파일 **말미 개행 1개로 통일**.
3. (그 외 변경 없음.)

이 정규화는 **의미를 보존**한다 — 태그 사이 콘텐츠 공백(예: 나레이션 ` 텍스트 ` → `&nbsp;`)은 줄 *중간*에 있어 영향받지 않고, style 속성 내부 공백/개행은 브라우저가 어차피 무시한다. 구조·색·속성·텍스트의 실제 회귀는 전부 잡힌다. **바이트-정확이 꼭 필요하면** 앱이 출력을 파일로 직접 쓰게 해 캡처할 것(채팅 paste 금지).

## `hello-test` RAW 공백 명세 (소스 f-string 기준, 권위)

`expected/hello-test.raw.html`의 정확한 바이트 형태(에디터가 strip하기 전):
- **말미 개행 없음** — 출력은 `<p><br></p>`로 끝남(`create_template` 5949: f-string이 `\n` 없이 종료).
- **공백-only 줄 11개** — f-string이 `\n`+들여쓰기로 끝나는 값을 보간하는 자리마다 생성. 각 줄은 비어있지 않고 **공백만** 포함: 28/32/24/24/36/32/32/32/28/24/24 칸.
- **img 속성 줄 trailing space** — `border-radius:12px;"`, src(base64 `...QmCC"`), `alt="profile"` 각 줄 끝에 **공백 1개**(소스 5832-5834가 리터럴 trailing space). `class="fr-fic fr-dii">`(5835)는 없음.
- `border-radius:12px;"` 줄 **앞 공백 25칸**(common_style 24칸 + f-string 삽입 공백 1칸).
- 카드 여는 div의 `border_style` 빈 자리 → 28칸 + `">` 줄(공백-only 아님).

→ 위 정규화 비교를 쓰면 이 디테일은 무시되지만, **byte-exact 캡처 시 검증 기준**으로 보존한다.
