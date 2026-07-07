# 관리자 사용량 패널 — 사장님 설정 절차 (10분)

앱 안에서 "서비스 지표(접속·가입·공유) + Firebase 무료쿼터 게이지"를 보는 패널입니다.
코드는 전부 들어가 있고, 아래 **사장님만 할 수 있는 2가지**를 하면 켜집니다.

## 1. 관리자 uid 지정 (필수 — 이걸 해야 패널이 보임)

1. 로그파파(웹) 로그인 → 서재 ⚙ 설정 → **고급 설정** → 앱 정보의 **"내 UID 복사"** 클릭.
2. 복사한 uid를 터미널 클로드에게 전달 → 아래 2곳을 바꿔 커밋·푸시(한 줄씩):
   - `firestore.rules`의 `isAdmin()` 안 `'ADMIN_UID_TBD'`
   - `web/src/adminStats.ts`의 `ADMIN_UID` 상수
3. 푸시하면 CI가 규칙·웹을 자동 배포 → ⚙ 설정 메뉴에 **"관리자"** 버튼이 나타남(사장님 계정만).

> uid를 바꾸기 전엔 stats 컬렉션을 **아무도 못 읽습니다**(자리표시자 상태 = 안전).
> 접속 카운터 수집은 uid와 무관하게 이미 동작(로그인 기기당 하루 1회 +1).

## 2. 쿼터 스냅샷 크론 (선택 — Firebase 게이지까지 보려면)

Cloud Monitoring 지표는 클라이언트에서 직접 못 읽어서(키 노출), GitHub Actions가 매일 1회
긁어 Firestore `stats/usage`에 써 줍니다. 서비스 계정 하나 만들어 시크릿에 넣으면 끝:

1. [GCP 콘솔 → IAM → 서비스 계정](https://console.cloud.google.com/iam-admin/serviceaccounts?project=logpapa)
   → **서비스 계정 만들기** — 이름 예: `usage-snapshot`.
2. 역할 3개 부여:
   - **Monitoring 뷰어** (roles/monitoring.viewer)
   - **Cloud Datastore 사용자** (roles/datastore.user) — Firestore 쓰기용
   - **Firebase Authentication 뷰어** (roles/firebaseauth.viewer) — 가입 계정 수
3. 만든 계정 → 키 → **새 키 만들기(JSON)** → 파일 다운로드.
4. GitHub 레포(dootaang/logfather) → Settings → Secrets and variables → Actions →
   **New repository secret** — 이름 `GCP_SA_KEY`, 값 = JSON 파일 내용 전체 붙여넣기.
5. Actions 탭 → `usage-snapshot` → **Run workflow**(수동 1회) → 초록이면 끝.
   이후 매일 00:15 KST 자동. 실패하면 로그의 `errors` 항목 확인.

> 시크릿이 없어도 워크플로는 조용히 생략(에러 아님). 패널은 "스냅샷 없음" 안내를 보여줍니다.

## 뭘 보여주나

- **서비스 지표**: 오늘/14일 접속(로그인 기기·하루 1회 집계 — 개인 식별 없음) · 가입 계정 · 공개 공유 수.
- **Firebase 무료쿼터 게이지** (일간/월간 칩으로 리셋 주기 구분):
  - Firestore 읽기 5만·쓰기 2만·삭제 2만 = **오늘**(태평양 자정 리셋)
  - Storage(모던 버킷) 저장 5GB=누적 · 다운로드 100GB·업로드 5천 회·다운로드 5만 회 = **이번 달**
  - Hosting 전송 = 월누적 수치 참고 표시(무료한도는 360MB/**일**)
- 80% 노랑 / 100% 빨강. GCP 예산 알림(이미 설정됨)과 이중 안전망.

## 보안 메모

- stats 읽기 = 관리자 uid만(보안규칙). 클라이언트 쓰기 = `daily-*` 문서의 `opens` **+1만** 허용
  (다른 필드·증분·삭제 불가, `usage` 문서는 클라이언트 쓰기 전면 차단 — 크론의 Admin SDK만).
- 악의적 로그인 사용자가 +1을 반복 호출할 수는 있음(카운터 부풀리기) — 피해는 통계 왜곡뿐이라 수용.
