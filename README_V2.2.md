# CGV 센텀시티 IMAX 오디세이 알리미 v2.2

핵심 변경:
- DOM/CSS 시간표 파싱 제거
- CGV 페이지가 실제 호출하는 `searchMovScnInfo` JSON 응답을 Chrome에서 직접 캡처
- `tcscnsGradCd == "03"`으로 IMAX 판별
- 영화명/시간/좌석을 JSON 응답에서 직접 읽음

수동 진단 기본값:
- diagnostic_only = true
- diagnostic_date = 20260813
- 알림 생성 없음

완전 성공 기준:
```
[DIAG] 20260813: pageHTTP=200
[DIAG] 20260813: API=200 ...searchMovScnInfo...
[DIAG] 20260813: API timetable items=N
[DIAG] 20260813: IMAX items=M
[SMOKE PASS] CGV API parsed N total schedule item(s), M IMAX item(s)
```

오디세이까지 IMAX로 실제 잡히면:
```
[SMOKE PASS] Odyssey IMAX parsed successfully: [...]
```
