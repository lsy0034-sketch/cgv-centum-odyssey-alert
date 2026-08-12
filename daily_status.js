const puppeteer = require("puppeteer-core");

const REPO = process.env.GITHUB_REPOSITORY || "lsy0034-sketch/cgv-centum-odyssey-alert";
const TOKEN = process.env.GITHUB_TOKEN || "";
const ASSIGNEE = process.env.ASSIGNEE || "lsy0034-sketch";

const TARGET_DATES = ["20260829", "20260830"];
const THEATER = { siteNo: "0089", siteNm: "센텀시티" };
const MOVIE_KEYWORDS = ["오디세이", "ODYSSEY"];
const IMAX_GRADE_CODE = "03";
const BASE_URL = "https://cgv.co.kr/cnm/movieBook/cinema";

function normalize(s) {
  return String(s || "").toUpperCase().replace(/\s+/g, "");
}

function isTargetMovie(name) {
  const n = normalize(name);
  return MOVIE_KEYWORDS.some(k => n.includes(normalize(k)));
}

function fmtTime(s) {
  const x = String(s || "").replace(/\D/g, "");
  return x.length >= 4 ? `${x.slice(0,2)}:${x.slice(2,4)}` : String(s || "");
}

function kstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function kstDateKey() {
  const d = kstNow();
  return d.toISOString().slice(0,10).replace(/-/g, "");
}

function kstDisplay() {
  const d = kstNow();
  return d.toISOString().replace("T", " ").slice(0,16) + " KST";
}

async function githubApi(path, method="GET", body=null) {
  if (!TOKEN) throw new Error("GITHUB_TOKEN is missing");

  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "cgv-centum-odyssey-daily-status"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }

  return await res.json();
}

async function dailyIssueExists() {
  const key = kstDateKey();
  const q = encodeURIComponent(`repo:${REPO} is:issue in:title "[CGV STATUS ${key}]"`);
  const data = await githubApi(`/search/issues?q=${q}`);
  return (data.total_count || 0) > 0;
}

async function createDailyIssue(results, fatalError=null) {
  if (await dailyIssueExists()) {
    console.log("[INFO] Today's daily status issue already exists; skipped");
    return;
  }

  const key = kstDateKey();

  let title;
  let bodyLines = [
    `@${ASSIGNEE}`,
    "",
    "## 📡 CGV 센텀시티 IMAX 오디세이 감시기 일일 상태",
    "",
    `- 점검 시각: **${kstDisplay()}**`,
    "- 자동 감시 대상: **2026-08-29 / 2026-08-30**",
    "- 극장: **CGV 센텀시티**",
    "- 상영관: **IMAX (grade code 03)**",
    ""
  ];

  if (fatalError) {
    title = `[CGV STATUS ${key}] ⚠️ 감시기 점검 실패`;
    bodyLines.push(
      "### ⚠️ 점검 실패",
      "",
      "CGV 조회 또는 감시 프로그램 실행 중 오류가 발생했습니다.",
      "",
      "```",
      String(fatalError.stack || fatalError).slice(0, 3000),
      "```"
    );
  } else {
    const hasOpen = results.some(r => r.target.length > 0);
    title = hasOpen
      ? `[CGV STATUS ${key}] 🎬 오디세이 IMAX 감지됨`
      : `[CGV STATUS ${key}] ✅ 감시기 정상 작동`;

    bodyLines.push("### 오늘의 확인 결과", "");

    for (const r of results) {
      const pretty = `${r.date.slice(0,4)}-${r.date.slice(4,6)}-${r.date.slice(6,8)}`;

      bodyLines.push(
        `#### ${pretty}`,
        `- CGV API 응답: **${r.apiStatus}**`,
        `- 전체 상영 일정: **${r.all.length}개**`,
        `- IMAX 일정: **${r.imax.length}개**`,
        `- 오디세이 IMAX: **${r.target.length}개**`
      );

      if (r.target.length > 0) {
        for (const s of r.target) {
          bodyLines.push(
            `  - ${fmtTime(s.scnsrtTm)}–${fmtTime(s.scnendTm)} / 잔여 ${s.frSeatCnt || "?"}/${s.cpSeatCnt || "?"}`
          );
        }
      } else {
        bodyLines.push("  - 현재 오디세이 IMAX 예매 일정 미감지");
      }

      bodyLines.push("");
    }

    bodyLines.push(
      "---",
      "",
      "✅ 이 알림은 **CGV 조회 경로와 파서가 오늘도 실제로 동작했음**을 확인하기 위한 heartbeat입니다.",
      "예매가 열리는 순간에는 별도의 `[CGV OPEN ...]` 긴급 알림이 즉시 생성됩니다."
    );
  }

  const issue = await githubApi(`/repos/${REPO}/issues`, "POST", {
    title,
    body: bodyLines.join("\n"),
    assignees: [ASSIGNEE]
  });

  console.log(`[DAILY STATUS] ${issue.html_url}`);
}

function simplify(item, fallbackDate) {
  return {
    scnYmd: item.scnYmd || fallbackDate,
    movNm: item.movNm || item.prodNm || "",
    scnsrtTm: item.scnsrtTm || "",
    scnendTm: item.scnendTm || "",
    frSeatCnt: item.frSeatCnt ?? item.frtmpSeatCnt ?? "",
    cpSeatCnt: item.cpSeatCnt ?? item.stcnt ?? "",
    tcscnsGradCd: String(item.tcscnsGradCd || ""),
    scnsEnm: item.scnsEnm || item.scnsNm || ""
  };
}

async function fetchScreenings(browser, date) {
  const page = await browser.newPage();

  await page.setViewport({ width: 1365, height: 900 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
  );

  const targetUrl =
    `${BASE_URL}?siteNo=${THEATER.siteNo}` +
    `&siteNm=${encodeURIComponent(THEATER.siteNm)}&scnYmd=${date}`;

  console.log(`[INFO] ${date}: opening ${targetUrl}`);

  try {
    const responsePromise = page.waitForResponse(
      response => {
        try {
          if (!response.url().includes("searchMovScnInfo")) return false;
          if (response.request().method() !== "GET") return false;

          const u = new URL(response.url());
          return u.searchParams.get("scnYmd") === date &&
                 u.searchParams.get("siteNo") === THEATER.siteNo;
        } catch {
          return false;
        }
      },
      { timeout: 30000 }
    );

    const nav = await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    console.log(`[DIAG] ${date}: pageHTTP=${nav ? nav.status() : 0}`);

    const apiResponse = await responsePromise;
    console.log(`[DIAG] ${date}: API=${apiResponse.status()}`);

    if (!apiResponse.ok()) {
      throw new Error(`searchMovScnInfo HTTP ${apiResponse.status()}`);
    }

    const body = await apiResponse.json();
    const rawItems = Array.isArray(body?.data) ? body.data : [];
    const all = rawItems.map(x => simplify(x, date));
    const imax = all.filter(x => x.tcscnsGradCd === IMAX_GRADE_CODE);
    const target = imax.filter(x => isTargetMovie(x.movNm));

    console.log(
      `[RESULT] ${date}: all=${all.length} imax=${imax.length} odysseyImax=${target.length}`
    );

    return {
      date,
      apiStatus: apiResponse.status(),
      all,
      imax,
      target
    };
  } finally {
    await page.close();
  }
}

async function main() {
  console.log(`[INFO] Daily heartbeat started: ${kstDisplay()}`);

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/google-chrome",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-geolocation"
    ]
  });

  const results = [];

  try {
    for (const date of TARGET_DATES) {
      results.push(await fetchScreenings(browser, date));
    }
  } catch (err) {
    console.error(`[ERROR] ${err.stack || err}`);

    // Try to notify the user that the heartbeat itself failed.
    try {
      await createDailyIssue(results, err);
    } catch (notifyErr) {
      console.error(`[ERROR] Failed to create failure status issue: ${notifyErr.stack || notifyErr}`);
    }

    process.exitCode = 1;
    return;
  } finally {
    await browser.close();
  }

  await createDailyIssue(results);
}

main().catch(async err => {
  console.error(`[FATAL] ${err.stack || err}`);

  try {
    await createDailyIssue([], err);
  } catch (notifyErr) {
    console.error(`[FATAL] Could not create failure notification: ${notifyErr.stack || notifyErr}`);
  }

  process.exit(1);
});
