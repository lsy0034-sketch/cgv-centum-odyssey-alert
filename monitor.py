#!/usr/bin/env python3
import json, os, sys, urllib.parse, urllib.request, http.cookiejar
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

TARGET_DATES = ("20260829", "20260830")
MOVIE_KEYWORDS = ("오디세이", "ODYSSEY")
REPO = os.environ.get("GITHUB_REPOSITORY", "lsy0034-sketch/cgv-centum-odyssey-alert")
ASSIGNEE = os.environ.get("ASSIGNEE", REPO.split("/")[0])
TOKEN = os.environ.get("GITHUB_TOKEN", "")

CGV_RESERVATION_PAGE = "http://ticket.cgv.co.kr/Reservation/Reservation.aspx"
CGV_API = "http://ticket.cgv.co.kr/CGV2011/RIA/CJ000.aspx/CJ_TICKET_SCHEDULE_TOTAL_PLAY_YMD"

CGV_PAYLOAD = {
    "REQSITE": "x02PG4EcdFrHKluSEQQh4A==",
    "TheaterCd": "2jX4VAQPhAUY/gxvZBhDdQ==",
    "ISNormal": "ECFppiyFz/nvSGsg7VwPQw==",
    "MovieGroupCd": "nG6tVgEQPGU2GvOIdnwTjg==",
    "ScreenRatingCd": "kXwoR3tnLM/+Tu0BILP3Qg==",
    "MovieTypeCd": "nG6tVgEQPGU2GvOIdnwTjg==",
    "Subtitle_CD": "nG6tVgEQPGU2GvOIdnwTjg==",
    "SOUNDX_YN": "nG6tVgEQPGU2GvOIdnwTjg==",
    "Third_Attr_CD": "nG6tVgEQPGU2GvOIdnwTjg==",
    "Language": "zqWM417GS6dxQ7CIf65+iA==",
}

BROWSER_HEADERS = {
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Content-Type": "application/json",
    "Origin": "http://ticket.cgv.co.kr",
    "Pragma": "no-cache",
    "Referer": CGV_RESERVATION_PAGE,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
}

def fetch_cgv_xml():
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    try:
        req = urllib.request.Request(CGV_RESERVATION_PAGE, headers={"User-Agent": BROWSER_HEADERS["User-Agent"]})
        with opener.open(req, timeout=20) as r:
            r.read(256)
    except Exception as exc:
        print(f"[WARN] session seed failed: {exc}")

    req = urllib.request.Request(CGV_API, data=json.dumps(CGV_PAYLOAD).encode("utf-8"), headers=BROWSER_HEADERS, method="POST")
    with opener.open(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8-sig"))
    xml_text = data.get("d", {}).get("DATA")
    if not xml_text:
        raise RuntimeError("CGV response did not contain d.DATA")
    return xml_text

def tag_name(tag):
    return tag.rsplit("}", 1)[-1].upper()

def values(node, wanted):
    out = []
    for e in node.iter():
        if tag_name(e.tag) == wanted.upper():
            v = (e.text or "").strip()
            if v and v not in out:
                out.append(v)
    return out

def norm(s):
    return "".join((s or "").upper().split())

def find_matches(xml_text):
    root = ET.fromstring(xml_text)
    parent = {c: p for p in root.iter() for c in p}
    results = {}
    movie_nodes = [n for n in root.iter() if tag_name(n.tag) in {"MOVIE_NM", "MOVIE_NAME", "MOVIENM"}]
    print(f"[INFO] movie nodes: {len(movie_nodes)}")
    for movie_node in movie_nodes:
        movie_name = (movie_node.text or "").strip()
        if not any(norm(k) in norm(movie_name) for k in MOVIE_KEYWORDS):
            continue
        print(f"[INFO] Odyssey-like movie: {movie_name}")
        node = movie_node
        for _ in range(14):
            dates = [d.replace("-", "") for d in values(node, "PLAY_YMD")]
            hits = [d for d in TARGET_DATES if d in dates]
            if hits:
                info = {
                    "movie": movie_name,
                    "times": values(node, "PLAY_START_TM"),
                    "screen": values(node, "SCREEN_NM"),
                    "rating": values(node, "RATING_NM"),
                    "theater": values(node, "THEATER_NM"),
                }
                for d in hits:
                    results[d] = info
                break
            if node not in parent:
                break
            node = parent[node]
    return results

def github_request(path, method="GET", payload=None):
    if not TOKEN:
        raise RuntimeError("GITHUB_TOKEN is missing")
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {TOKEN}",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "cgv-centum-odyssey-alert",
    }
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(f"https://api.github.com{path}", data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}

def alert_exists(date):
    q = urllib.parse.quote(f'repo:{REPO} is:issue in:title "[CGV OPEN {date}]"')
    return github_request(f"/search/issues?q={q}").get("total_count", 0) > 0

def create_alert(date, info):
    pretty = f"{date[:4]}-{date[4:6]}-{date[6:8]}"
    times = ", ".join(info.get("times") or []) or "CGV 앱/웹에서 즉시 확인"
    screen = ", ".join(info.get("screen") or []) or "IMAX"
    theater = ", ".join(info.get("theater") or []) or "CGV 센텀시티"
    body = f'''@{ASSIGNEE}\n\n## 🎬 CGV 예매 오픈 감지\n\n- 극장: **{theater}**\n- 상영관: **{screen} / IMAX**\n- 영화: **{info.get("movie") or "오디세이"}**\n- 날짜: **{pretty}**\n- 확인된 상영 시각: **{times}**\n\n### 지금 CGV 앱 또는 웹에서 예매를 확인하세요.\n\n감지 시각(UTC): {datetime.now(timezone.utc).isoformat(timespec="seconds")}\n\n_5분 주기 자동 감시가 생성한 알림입니다._'''
    return github_request(f"/repos/{REPO}/issues", "POST", {
        "title": f"[CGV OPEN {date}] 센텀시티 IMAX 오디세이 예매 확인",
        "body": body,
        "assignees": [ASSIGNEE],
    })

def create_test_issue():
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    issue = github_request(f"/repos/{REPO}/issues", "POST", {
        "title": f"[CGV TEST {stamp}] 푸시 알림 테스트",
        "body": f"@{ASSIGNEE}\n\n✅ **CGV 센텀시티 IMAX 감시기 테스트 알림입니다.**\n\n이 알림이 휴대폰에 오면 GitHub 알림 경로가 정상입니다.",
        "assignees": [ASSIGNEE],
    })
    print("[TEST]", issue.get("html_url", issue.get("number")))

def main():
    if os.environ.get("TEST_NOTIFICATION", "").lower() in {"1", "true", "yes"}:
        create_test_issue()
        return
    print("[INFO] Checking CGV Centum City IMAX for 2026-08-29 / 2026-08-30")
    xml_text = fetch_cgv_xml()
    print(f"[INFO] CGV XML received: {len(xml_text):,} chars")
    matches = find_matches(xml_text)
    print("[INFO] matches:", json.dumps(matches, ensure_ascii=False))
    if not matches:
        print("[OK] Target booking schedule not detected.")
        return
    for date in TARGET_DATES:
        if date in matches:
            if alert_exists(date):
                print(f"[OK] Duplicate alert skipped for {date}")
            else:
                issue = create_alert(date, matches[date])
                print(f"[ALERT] {date}: {issue.get('html_url', issue.get('number'))}")

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ERROR] {type(exc).__name__}: {exc}", file=sys.stderr)
        raise
