# CGV 센텀시티 IMAX 오디세이 알리미 v2

기존 `ticket.cgv.co.kr/CGV2011/...` API 방식은 사용하지 않습니다.

현재 CGV 시간표 페이지를 **실제 Chrome/Puppeteer로 렌더링**하여 확인합니다.

대상:
- CGV 센텀시티 (`siteNo=0089`)
- IMAX
- 오디세이 / ODYSSEY
- 2026-08-29, 2026-08-30

## 교체 방법
기존 저장소에서 아래 파일을 교체/추가:
- `monitor.js` 추가
- `package.json` 추가
- `package-lock.json` 추가
- `.github/workflows/monitor.yml` 교체
- 기존 `monitor.py`는 삭제해도 됨

## 정상 수동 실행 로그 예
```
[DIAG] Chrome path=/usr/bin/google-chrome
[DIAG] 20260829: HTTP=200 ...
[DIAG] 20260829: IMAX filter applied
[DIAG] 20260829: timetable items=...
[OK] 20260829: Odyssey IMAX booking not detected
```

중요: HTTP 200 + CGV 페이지 정상 로드가 확인되지 않으면 성공으로 처리하지 않습니다.
