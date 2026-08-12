const puppeteer = require("puppeteer-core");

const REPO = process.env.GITHUB_REPOSITORY || "lsy0034-sketch/cgv-centum-odyssey-alert";
const TOKEN = process.env.GITHUB_TOKEN || "";
const ASSIGNEE = process.env.ASSIGNEE || "lsy0034-sketch";

const TEST_NOTIFICATION =
  String(process.env.TEST_NOTIFICATION || "").toLowerCase() === "true";
const DIAGNOSTIC_ONLY =
  String(process.env.DIAGNOSTIC_ONLY || "").toLowerCase() === "true";
const DIAGNOSTIC_DATE = String(process.env.DIAGNOSTIC_DATE || "20260813").trim();

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

async function githubApi(path, method="GET", body=null) {
  if (!TOKEN) throw new Error("GITHUB_TOKEN is missing");
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "cgv-centum-odyssey-alert"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }
  return await res.json();
}

async function issueExists(date) {
  const q = encodeURIComponent(`repo:${REPO} is:issue in:title "[CGV OPEN ${date}]"`);
  const data = await githubApi(`/search/issues?q=${q}`);
  return (data.total_count || 0) > 0;
}

async function createIssue(date, shows) {
  if (await issueExists(date)) {
    console.log(`[INFO] ${date}: alert already exists; duplicate skipped`);
    return;
  }

  const pretty = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
  const rows = shows.map(s =>
    `- **${fmtTime(s.scnsrtTm)}**–${fmtTime(s.scnendTm)} / ` +
    `${s.movNm} / IMAX / 잔여 ${s.frSeatCnt || "?"}/${s.cpSeatCnt || "?"}`
  ).join("\n");

  const bookingUrl =
    `${BASE_URL}?siteNo=${THEATER.siteNo}` +
    `&siteNm=${encodeURIComponent(THEATER.siteNm)}&scnYmd=${date}`;

  const body = [
    `@${ASSIGNEE}`,
    "",
    "## 🎬 CGV 센텀시티 IMAX 《오디세이》 예매 오픈 감지",
    "",
    `- 날짜: **${pretty}**`,
    "- 극장: **CGV 센텀시티**",
    "- 상영관: **IMAX**",
    "",
    rows,
    "",
    `예매 확인: ${bookingUrl}`,
    "",
    "_CGV의 실제 상영정보 JSON 응답을 감지하여 생성한 알림입니다._"
  ].join("\n");

  const issue = await githubApi(`/repos/${REPO}/issues`, "POST", {
    title: `[CGV OPEN ${date}] 센텀시티 IMAX 오디세이 예매 확인`,
    body,
    assignees: [ASSIGNEE]
  });

  console.log(`[ALERT] ${date}: ${issue.html_url}`);
}

async function createTestIssue() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0,14);
  const issue = await githubApi(`/repos/${REPO}/issues`, "POST", {
    title: `[CGV TEST ${stamp}] v2.2 푸시 알림 테스트`,
    body: `@${ASSIGNEE}\n\n✅ **CGV 센텀시티 IMAX 감시기 v2.2 테스트 알림입니다.**`,
    assignees: [ASSIGNEE]
  });
  console.log(`[TEST] ${issue.html_url}`);
}

function chromeExecutable() {
  return process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/google-chrome";
}

function simplify(item, fallbackDate) {
  return {
    scnYmd: item.scnYmd || fallbackDate,
    scnsNo: item.scnsNo || "",
    scnSseq: item.scnSseq || "",
    movNo: item.movNo || "",
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
    // Register the listener BEFORE navigation so we cannot miss a fast API response.
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

    console.log(
      `[DIAG] ${date}: pageHTTP=${nav ? nav.status() : 0} finalURL=${page.url()}`
    );

    const apiResponse = await responsePromise;
    console.log(
      `[DIAG] ${date}: API=${apiResponse.status()} ${apiResponse.url()}`
    );

    if (!apiResponse.ok()) {
      throw new Error(`searchMovScnInfo HTTP ${apiResponse.status()}`);
    }

    const body = await apiResponse.json();
    const rawItems = Array.isArray(body?.data) ? body.data : [];
    const items = rawItems.map(x => simplify(x, date));

    console.log(`[DIAG] ${date}: API timetable items=${items.length}`);

    if (items.length > 0) {
      console.log(
        `[DIAG] ${date}: API_SAMPLE=${JSON.stringify(items.slice(0, 8))}`
      );
    }

    const imax = items.filter(x => x.tcscnsGradCd === IMAX_GRADE_CODE);

    console.log(`[DIAG] ${date}: IMAX items=${imax.length}`);
    if (imax.length > 0) {
      console.log(
        `[DIAG] ${date}: IMAX_TIMETABLE=${JSON.stringify(imax)}`
      );
    }

    const target = imax.filter(x => isTargetMovie(x.movNm));

    console.log(
      `[DIAG] ${date}: Odyssey IMAX items=${target.length}` +
      (target.length ? ` ${JSON.stringify(target)}` : "")
    );

    return { all: items, imax, target };
  } finally {
    await page.close();
  }
}

async function main() {
  if (TEST_NOTIFICATION) {
    await createTestIssue();
    return;
  }

  const executablePath = chromeExecutable();
  console.log(`[DIAG] Chrome path=${executablePath}`);

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-geolocation"
    ]
  });

  try {
    if (DIAGNOSTIC_ONLY) {
      console.log("=== DIAGNOSTIC MODE: NO ALERT WILL BE CREATED ===");
      console.log(`[DIAG] smoke-test date=${DIAGNOSTIC_DATE}`);

      const result = await fetchScreenings(browser, DIAGNOSTIC_DATE);

      if (result.all.length === 0) {
        throw new Error(
          `Smoke test failed: CGV API returned 0 timetable items for ${DIAGNOSTIC_DATE}.`
        );
      }

      if (result.imax.length === 0) {
        throw new Error(
          `Smoke test failed: timetable exists but IMAX grade code 03 returned 0 items for ${DIAGNOSTIC_DATE}.`
        );
      }

      console.log(
        `[SMOKE PASS] CGV API parsed ${result.all.length} total schedule item(s), ` +
        `${result.imax.length} IMAX item(s) for ${DIAGNOSTIC_DATE}.`
      );

      if (result.target.length > 0) {
        console.log(
          `[SMOKE PASS] Odyssey IMAX parsed successfully: ${JSON.stringify(result.target)}`
        );
      } else {
        console.log(
          "[SMOKE PARTIAL] IMAX timetable parsing is verified, but Odyssey was not in the IMAX list."
        );
      }

      return;
    }

    for (const date of TARGET_DATES) {
      const result = await fetchScreenings(browser, date);

      if (result.target.length > 0) {
        console.log(`[MATCH] ${date}: ${JSON.stringify(result.target)}`);
        await createIssue(date, result.target);
      } else {
        console.log(`[OK] ${date}: Odyssey IMAX booking not detected`);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(`[ERROR] ${err.stack || err}`);
  process.exit(1);
});
