# 제3자 코드 고지 (Third-Party Notices) — LogPapa

LogPapa는 **GNU General Public License v3.0 이상(GPL-3.0-or-later)** 으로 배포됩니다(루트 `LICENSE` 참조).
이 문서는 LogPapa가 토대로 삼은 제3자 코드·지식과 그 라이선스를 밝힙니다.

---

## RisuAI — GPL-3.0  ✅ (LogPapa와 동일 라이선스)
- 출처: https://github.com/kwaroran/RisuAI  (Copyright (C) 2024 Kwaroran)
- 라이선스: GNU GPL v3.0.
- 사용한 것: 리치-클립보드 재인코딩(이미지→canvas→data URL)으로 아카라이브에 붙여넣기-업로드되게 하는 방식,
  결합 번역(여러 블록 한 요청) 배치 처리, 표시 정규식(editdisplay)·CBS 기반 RP 본문 정리 접근,
  `.risup` 프리셋 해독(RisuAI 프리셋 포맷, `core/card/sourceRegex.js`)·카드 포맷 인코더(`core/card/cardEncode.js`).
  우리 코드베이스에 맞게 재구현했으며, **이 때문에 LogPapa 전체를 GPL-3.0로 공개**합니다.

## @risuai/ccardlib — MIT  ✅ (GPL 호환)
- 출처: npm 패키지 `@risuai/ccardlib` (저자: kwaroran)
- 라이선스: MIT.
- 사용한 것: RisuAI 캐릭터 카드 포맷(charx/png/json) 처리 지식 + `.risum`/`.risup` 해독에 쓰는
  **RPack 바이트 치환표**(`core/card/risum.js`의 `DECODE_MAP`).

## rpaddict/risumari — 라이선스 표기 없음 (출처 감사 표기)
- 출처: https://github.com/rpaddict/risumari
- 참고한 것: `.risup` 프리셋 해독·카드 인코더(charx/png) 구현을 참고했습니다.
- 별도의 라이선스 파일은 없지만, 코드·방식을 참고했기에 **출처를 남겨 감사를 표합니다.**

## komodoD/RisuToki — CC BY-NC 4.0  (의존 제거됨)
- 이전엔 RPack 치환표 출처로 RisuToki를 표기했으나, CC BY-NC(비상업)는 GPL과 비호환이라
  같은 표가 들어 있는 **MIT 라이브러리 `@risuai/ccardlib`로 출처를 정정**했습니다.

---

> 참고: LogPapa 저자는 변호사가 아닙니다. 이 고지는 선의의 출처 표기·준수 노력입니다.
