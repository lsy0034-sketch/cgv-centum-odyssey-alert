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
const BASE_URL = "https://cgv.co.kr/cnm/movieBook/cinema";

function normalize(s) {
  return String(s || "").toUpperCase().replace(/\s+/g, "");
}

function isTargetMovie(name) {
  const n = normalize(name);
  return MOVIE_KEYWORDS.some(k => n.includes(normalize(k)));
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
    console.log(`[INFO] ${date}: alert already exists, duplicate skipped`);
    return;
  }

  const pretty = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
  const rows = shows.map(s =>
    `- **${s.startTime || "시간 확인 필요"}** / ${s.movie} / ${s.screenType || "IMAX"} / ${s.seatInfo || ""}`
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
    "_GitHub Actions 자동 감시가 생성한 알림입니다._"
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
    title: `[CGV TEST ${stamp}] v2.1 푸시 알림 테스트`,
    body: `@${ASSIGNEE}\n\n✅ **CGV 센텀시티 IMAX 감시기 v2.1 테스트 알림입니다.**`,
    assignees: [ASSIGNEE]
  });
  console.log(`[TEST] ${issue.html_url}`);
}

function chromeExecutable() {
  return process.env.PUPPETEER_EXECUTABLE_PATH ||
         "/usr/bin/google-chrome";
}

async function applyImaxFilter(page, date) {
  const filterBtn = await page.waitForSelector(
    'button[aria-label="극장 속성"]',
    { timeout: 15000 }
  );
  await filterBtn.click();

  const imaxBtn = await page.waitForSelector(
    '#\\30 3-TCSCNS_GRAD_CD',
    { timeout: 12000 }
  );
  await imaxBtn.click();

  const confirmBtn = await page.waitForSelector(
    'div.bot-modal-footer > div.btn-wrap > button',
    { timeout: 12000 }
  );
  await confirmBtn.click();

  console.log(`[DIAG] ${date}: IMAX filter applied`);
}

async function parseTimetable(page) {
  // CGV React CSS class suffixes may change, so match stable class-name fragments.
  return await page.evaluate(() => {
    const candidates = [
      ...document.querySelectorAll('div[class*="screenInfoTimes_startTimeItem"]')
    ];

    const result = [];
    for (const node of candidates) {
      const movieEl =
        node.querySelector('span[class*="screenInfoTimes_title"] span') ||
        node.querySelector('span[class*="screenInfoTimes_title"]');

      const timeEl =
        node.querySelector('p[class*="screenInfoTimes_startTime"]');

      const seatWrap =
        node.querySelector('span[class*="screenInfoTimes_seatWrap"]');

      const seatSpans = seatWrap
        ? [...seatWrap.querySelectorAll("span")]
        : [];

      const movie = movieEl ? (movieEl.textContent || "").trim() : "";
      const startTime = timeEl ? (timeEl.textContent || "").trim() : "";
      const seatInfo = seatSpans[0] ? (seatSpans[0].textContent || "").trim() : "";
      const screenType = seatSpans[1] ? (seatSpans[1].textContent || "").trim() : "";

      if (movie || startTime) {
        result.push({
          movie,
          startTime,
          seatInfo,
          screenType,
          raw: (node.innerText || "").trim().slice(0, 400)
        });
      }
    }
    return result;
  });
}

async function openDate(browser, date) {
  const url =
    `${BASE_URL}?siteNo=${THEATER.siteNo}` +
    `&siteNm=${encodeURIComponent(THEATER.siteNm)}&scnYmd=${date}`;

  const page = await browser.newPage();
  page.setDefaultTimeout(20000);

  await page.setViewport({ width: 1365, height: 900 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
  );

  console.log(`[INFO] ${date}: opening ${url}`);

  try {
    const response = await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 45000
    });

    const status = response ? response.status() : 0;
    console.log(`[DIAG] ${date}: HTTP=${status} finalURL=${page.url()}`);

    if (!response || status >= 400) {
      throw new Error(`CGV page HTTP failure: ${status}`);
    }

    const bodyBefore = await page.evaluate(() => document.body.innerText || "");
    console.log(
      `[DIAG] ${date}: pageTextLength=${bodyBefore.length} ` +
      `hasCGV=${bodyBefore.includes("CGV")} hasIMAX=${bodyBefore.toUpperCase().includes("IMAX")}`
    );

    if (!bodyBefore.includes("CGV")) {
      throw new Error("CGV page loaded but expected CGV content was not found");
    }

    await applyImaxFilter(page, date);

    // Wait for React rerender after IMAX filter.
    await new Promise(r => setTimeout(r, 1800));

    const items = await parseTimetable(page);
    console.log(`[DIAG] ${date}: timetable items=${items.length}`);

    if (items.length > 0) {
      // This is the key smoke-test output.
      console.log(`[DIAG] ${date}: ALL_TIMETABLE=${JSON.stringify(items)}`);
    } else {
      const txt = await page.evaluate(() => document.body.innerText || "");
      console.log(
        `[DIAG] ${date}: afterFilterTextLength=${txt.length} ` +
        `containsOdyssey=${txt.includes("오디세이")}`
      );

      const healthyEmpty =
        txt.includes("상영시간표가 없습니다") ||
        txt.includes("상영 정보가 없습니다") ||
        txt.includes("조회된 상영") ||
        txt.includes("상영시간") ||
        txt.toUpperCase().includes("IMAX");

      if (!healthyEmpty) {
        throw new Error(
          "CGV page is reachable, but timetable parser returned 0 and " +
          "the rendered page did not contain expected schedule/IMAX markers. " +
          "Selectors may have changed."
        );
      }
    }

    const target = items.filter(x =>
      isTargetMovie(x.movie) &&
      (
        normalize(x.screenType).includes("IMAX") ||
        // The page has already been explicitly filtered to IMAX.
        true
      )
    );

    console.log(
      `[DIAG] ${date}: targetOdysseyItems=${target.length}` +
      (target.length ? ` ${JSON.stringify(target)}` : "")
    );

    return { items, target };
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

      const result = await openDate(browser, DIAGNOSTIC_DATE);

      if (result.items.length === 0) {
        throw new Error(
          `Smoke test failed: ${DIAGNOSTIC_DATE} returned 0 IMAX timetable items. ` +
          "Use a date that currently has a visible Centum City IMAX schedule."
        );
      }

      console.log(
        `[SMOKE PASS] Parsed ${result.items.length} Centum City IMAX timetable item(s) ` +
        `for ${DIAGNOSTIC_DATE}.`
      );

      if (result.target.length > 0) {
        console.log(
          `[SMOKE PASS] Odyssey was parsed successfully: ${JSON.stringify(result.target)}`
        );
      } else {
        console.log(
          "[SMOKE PARTIAL] Timetable parsing works, but Odyssey was not among the parsed items."
        );
      }
      return;
    }

    for (const date of TARGET_DATES) {
      const result = await openDate(browser, date);

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
