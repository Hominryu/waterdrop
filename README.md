# waterdrop

앱인토스 리워드형 미니앱 **물방울모으기** UI/UX 1차 프로토타입입니다.

## 1차 목표

기능/백엔드보다 화면 품질과 핵심 사용자 흐름을 먼저 검증합니다.

- `팝콘쌓기`의 빠른 혜택 인지, 명확한 메인 CTA, 진행 상태 표현 참고
- `도시모으기`의 HERO 중심 구조, 도착/완료 피드백, 기록 화면의 정보 계층 참고
- 두 제품의 구조를 복제하지 않고 물방울만의 `밀기 → 합치기 → 큰 한 방울 완성` 경험으로 재설계

## 현재 구현

- 홈: 이번 달 포인트, 오늘 3회 진행도, 물방울 HERO, 메인 CTA, 오늘 흐름
- 플레이: 모바일 보드, 드래그, 단순 병합 프로토타입, 라운드 완료 시트
- 기록: 최근 7일, 오늘 완료 상태, 이용 방법
- 설정: 효과음/진동 UI
- 360px 모바일부터 넓은 WebView까지 반응형
- safe-area, reduced-motion 대응

## 의도적으로 아직 연결하지 않은 것

- Apps-in-Toss SDK
- 전면형/리워드형 광고
- Toss Point 지급
- Supabase/서버 상태
- 실제 물방울 물리 엔진 및 햅틱/효과음

현재 `10원 받기`는 화면 흐름 검토용 로컬 데모입니다.

## 다음 작업

1. 실기기 UI/UX 검수 및 폴리싱
2. DOM 기반 병합 프로토타입을 Canvas/WebGL fake-fluid 엔진으로 교체
3. 라운드 종료 → 전면형, 최종 포인트 수령 → Rewarded 연결
4. 서버 authoritative progress / idempotency / payout ledger 구현
5. Apps-in-Toss 3.x 및 QR QA 연결

## 실행

```bash
npm install
npm run dev
```

검증:

```bash
npm run typecheck
npm run build
```
