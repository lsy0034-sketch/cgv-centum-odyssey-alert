# CGV 센텀시티 IMAX 《오디세이》 예매 알리미

대상: CGV 센텀시티 IMAX / 《오디세이》 / 2026-08-29, 2026-08-30

## 업로드 구조

```text
cgv-centum-odyssey-alert/
├─ monitor.py
├─ README.md
└─ .github/
   └─ workflows/
      └─ monitor.yml
```

`.github/workflows/monitor.yml` 경로가 정확해야 합니다.

## 푸시 테스트

업로드 후 GitHub 저장소에서:

1. `Actions`
2. `CGV Centum Odyssey Monitor`
3. `Run workflow`
4. `Create a test GitHub Issue notification` 체크
5. `Run workflow`

정상 실행되면 `[CGV TEST ...] 푸시 알림 테스트` 이슈가 생성되고 `lsy0034-sketch`에 할당됩니다.

## 실제 감시

스케줄은 `*/5 * * * *`로 설정되어 있습니다. 목표 날짜가 감지되면 날짜별 이슈가 생성됩니다.

- `[CGV OPEN 20260829] ...`
- `[CGV OPEN 20260830] ...`

GitHub 모바일 앱에서 Issue assignment 알림을 허용해 주세요.

## 주의

- GitHub 스케줄은 서버 상황에 따라 실제 실행이 조금 지연될 수 있습니다.
- CGV 내부 예매 API가 변경되면 스크립트 수정이 필요할 수 있습니다.
- 자동 예매 기능은 없고, 예매 일정 감지/알림만 합니다.
