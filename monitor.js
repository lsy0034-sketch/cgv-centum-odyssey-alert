const puppeteer = require("puppeteer-core");

const REPO = process.env.GITHUB_REPOSITORY || "lsy0034-sketch/cgv-centum-odyssey-alert";
const TOKEN = process.env.GITHUB_TOKEN || "";
const ASSIGNEE = process.env.ASSIGNEE || "lsy0034-sketch";
const TEST_NOTIFICATION = String(process.env.TEST_NOTIFICATION || "").toLowerCase() === "true";

const TARGET_DATES = ["20260829", "20260830"];
const THEATER = {
  siteNo: "0089",
  siteNm: "센텀시티",
};
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

  const body = [
    `@${ASSIGNEE}`,
    "",
    "## 🎬 CGV 센텀시티 IMAX 《오디세이》 예매 오픈 감지",
    "",
    `- 날짜: **${pretty}**`,
    `- 극장: **CGV 센텀시티**`,
    `- 상영관: **IMAX**`,
    "",
    rows,
    "",
    `예매 확인: ${BASE_URL}?siteNo=${THEATER.siteNo}&siteNm=${encodeURIComponent(THEATER.siteNm)}&scnYmd=${date}`,
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
    title: `[CGV TEST ${stamp}] v2 푸시 알림 테스트`,
    body: `@${ASSIGNEE}\n\n✅ **CGV 센텀시티 IMAX 감시기 v2 테스트 알림입니다.**`,
    assignees: [ASSIGNEE]
  });
  console.log(`[TEST] ${issue.html_url}`);
}

function chromeExecutable() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  return candidates[0];
}

async function openDate(browser, date) {
  const url = `${BASE_URL}?siteNo=${THEATER.siteNo}&siteNm=${encodeURIComponent(THEATER.siteNm)}&scnYmd=${date}`;
  const page = await browser.newPage();

  page.setDefaultTimeout(20000);
  await page.setViewport({width: 1365, height: 900});
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
  );

  console.log(`[INFO] ${date}: opening ${url}`);

  const response = await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: 45000
  });

  const status = response ? response.status() : 0;
  console.log(`[DIAG] ${date}: HTTP=${status} finalURL=${page.url()}`);
  if (!response || status >= 400) {
    throw new Error(`CGV page HTTP failure: ${status}`);
  }

  const bodyText = await page.evaluate(() => document.body.innerText || "");
  if (!bodyText.includes("CGV") && !bodyText.includes("영화")) {
    throw new Error("CGV page loaded but expected page content was not found");
  }

  // The current CGV UI uses a theater-attribute modal for IMAX.
  // First try the selectors used by a working Jul-2026 CGV crawler.
  let filterApplied = false;
  try {
    const filterBtn = await page.waitForSelector('button[aria-label="극장 속성"]', {timeout: 12000});
    await filterBtn.click();

    const imaxBtn = await page.waitForSelector('#\\30 3-TCSCNS_GRAD_CD', {timeout: 10000});
    await imaxBtn.click();

    const confirmBtn = await page.waitForSelector('div.bot-modal-footer > div.btn-wrap > button', {timeout: 10000});
    await confirmBtn.click();
    filterApplied = true;
    console.log(`[DIAG] ${date}: IMAX filter applied`);
  } catch (e) {
    // If CGV changed CSS hashes but the page already visibly contains IMAX,
    // do not immediately fail; inspect rendered timetable and filter by text.
    const visibleText = await page.evaluate(() => document.body.innerText || "");
    if (visibleText.toUpperCase().includes("IMAX")) {
      console.log(`[WARN] ${date}: IMAX filter selector changed; IMAX text exists, continuing with rendered timetable`);
    } else {
      throw new Error(`IMAX filter could not be applied and IMAX text was not found: ${e.message}`);
    }
  }

  // Give React a moment to rerender after filter confirmation.
  await new Promise(r => setTimeout(r, 1200));

  // Preferred current-CGV selector, then broad fallback selectors.
  const items = await page.evaluate(() => {
    const preferred = [...document.querySelectorAll('div[class*="screenInfoTimes_startTimeItem"]')];
    const nodes = preferred.length
      ? preferred
      : [...document.querySelectorAll('div[class*="screenInfoTimes"], li[class*="screenInfoTimes"]')];

    const result = [];
    for (const node of nodes) {
      const text = (node.innerText || "").trim();
      if (!text) continue;

      const movieEl =
        node.querySelector('span[class*="screenInfoTimes_title"] span') ||
        node.querySelector('span[class*="title"]');
      const timeEl =
        node.querySelector('p[class*="screenInfoTimes_startTime"]') ||
        node.querySelector('[class*="startTime"]');
      const seatWrap = node.querySelector('span[class*="screenInfoTimes_seatWrap"]');
      const seatSpans = seatWrap ? [...seatWrap.querySelectorAll("span")] : [];

      const movie = movieEl ? movieEl.textContent.trim() : "";
      const startTime = timeEl ? timeEl.textContent.trim() : "";
      const seatInfo = seatSpans[0] ? seatSpans[0].textContent.trim() : "";
      const screenType = seatSpans[1] ? seatSpans[1].textContent.trim() : "";

      if (movie || startTime) {
        result.push({movie, startTime, seatInfo, screenType, raw: text.slice(0,300)});
      }
    }
    return result;
  });

  console.log(`[DIAG] ${date}: timetable items=${items.length}`);
  if (items.length > 0) {
    console.log(`[DIAG] ${date}: sample=${JSON.stringify(items.slice(0,3))}`);
  } else {
    const txt = await page.evaluate(() => document.body.innerText || "");
    const noSchedule =
      txt.includes("상영시간표가 없습니다") ||
      txt.includes("상영 정보가 없습니다") ||
      txt.includes("조회된 상영") ||
      !txt.toUpperCase().includes("IMAX");
    if (noSchedule) {
      console.log(`[OK] ${date}: page healthy, target IMAX schedule not open`);
      await page.close();
      return [];
    }
    console.log(`[WARN] ${date}: no timetable item parsed; page may have no schedule or selectors may have changed`);
  }

  const target = items.filter(x =>
    isTargetMovie(x.movie) &&
    (normalize(x.screenType).includes("IMAX") || filterApplied)
  );

  await page.close();
  return target;
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
    for (const date of TARGET_DATES) {
      const target = await openDate(browser, date);
      if (target.length) {
        console.log(`[MATCH] ${date}: ${JSON.stringify(target)}`);
        await createIssue(date, target);
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
