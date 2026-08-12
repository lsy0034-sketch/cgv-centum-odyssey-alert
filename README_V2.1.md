# v2.1 smoke-test version

자동 실행:
- 5분마다 2026-08-29, 2026-08-30만 확인
- 오디세이 IMAX가 실제 파싱될 때만 이슈 알림 생성

수동 실행 기본값:
- diagnostic_only = true
- diagnostic_date = 20260813
- 알림 생성 안 함
- 실제 센텀시티 IMAX 시간표 항목을 전부 로그로 출력
- 항목이 0개면 smoke test 자체를 실패 처리

성공 기준:
```
[DIAG] 20260813: HTTP=200
[DIAG] 20260813: IMAX filter applied
[DIAG] 20260813: timetable items=N   # N > 0
[DIAG] 20260813: ALL_TIMETABLE=[...]
[SMOKE PASS] Parsed N Centum City IMAX timetable item(s) for 20260813.
```

오디세이까지 있으면 추가로:
```
[SMOKE PASS] Odyssey was parsed successfully: [...]
```
