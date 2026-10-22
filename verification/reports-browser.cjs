const { chromium } = require("/home/ubuntu/git/x-reader/node_modules/playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const origin = process.env.REPORT_PREVIEW_URL || "http://127.0.0.1:4180";
const output = "/home/ubuntu/.local/state/open-connector-reports-verification";
fs.mkdirSync(output, { recursive: true, mode: 0o700 });

(async () => {
  assert.ok(process.env.OOMOL_CONNECT_ADMIN_TOKEN);
  const browser = await chromium.launch({
    executablePath: "/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome",
    args: ["--no-sandbox"],
  });
  const pageErrors = [];
  let apiWrites = 0;
  const report = {
    date: "2026-10-22",
    source: "Private production database copy and read-only staging inventory",
    viewports: [],
    apiWrites: 0,
  };
  const cache = new Map();
  try {
    for (const viewport of [
      { width: 1440, height: 1050 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      const context = await browser.newContext({
        viewport,
        isMobile: viewport.width < 500,
        hasTouch: viewport.width < 500,
        acceptDownloads: true,
      });
      await context.route("**/ui-assets/**", (route) =>
        route.continue({ url: route.request().url().replace("/ui-assets/", "/") }),
      );
      await context.route("**/api/**", async (route) => {
        if (route.request().method() !== "GET") {
          apiWrites++;
          throw new Error("Browser verification must remain read-only");
        }
        const url = new URL(route.request().url());
        const local =
          (url.pathname.startsWith("/api/reports/") ? "http://127.0.0.1:4184" : "http://127.0.0.1:4182") +
          url.pathname +
          url.search;
        let result = cache.get(local);
        if (!result) {
          const response = await route.fetch({
            url: local,
            headers: { authorization: "Bearer " + process.env.OOMOL_CONNECT_ADMIN_TOKEN },
          });
          assert.equal(response.status(), 200, url.pathname);
          result = { body: await response.body(), contentType: "application/json" };
          cache.set(local, result);
        }
        await route.fulfill(result);
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(origin + "/reports?week=2026-10-18");
      try {
        await page.locator(".report-metric").first().waitFor();
      } catch (error) {
        await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
        console.error("Page errors:", pageErrors);
        console.error("Page headings:", await page.locator("h1,h2").allInnerTexts());
        console.error("UI errors:", await page.locator(".report-error,.inline-error").allTextContents());
        throw error;
      }
      assert.equal(await page.locator(".report-metric").count(), 4);
      assert.equal(await page.locator(".report-inventory-row").count(), 11);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.locator(".reports-page").getAttribute("dir"), "rtl");
      assert.ok(await page.locator(".report-chart svg").count());
      await page.screenshot({ path: `${output}/reports-${viewport.width}.png`, fullPage: true });
      report.viewports.push(`${viewport.width}x${viewport.height}`);
      if (viewport.width === 1440) {
        const before = await page.locator(".report-metric > strong").first().innerText();
        await page.getByLabel("מצב שימוש במפתח").selectOption("unused");
        const values = await page.locator(".report-record-stat strong").allInnerTexts();
        assert.ok(values.length > 0 && values.every((value) => value === "0"));
        await page.getByLabel("חיפוש במלאי").fill("no-such-key-inventory");
        await page.getByText("אין מפתחות התואמים לחיפוש ולמצב שבחרת.").waitFor();
        await page.getByLabel("חיפוש במלאי").fill("");
        await page.getByRole("tab", { name: /חשבונות מחוברים/ }).click();
        assert.equal(await page.locator(".report-inventory-row").count(), 32);
        await page.locator(".report-service-bar").first().click();
        await page.waitForURL(/service=/);
        await page.locator(".report-filter-note").waitFor();
        await page.locator(".report-metric").first().waitFor();
        await page.getByRole("button", { name: "ניקוי סינון" }).click();
        await page.locator(".report-metric").first().waitFor();
        assert.equal(await page.locator(".report-metric > strong").first().innerText(), before);
        const download = page.waitForEvent("download");
        await page.getByRole("button", { name: "ייצוא כלים" }).click();
        const file = await download;
        const csv = fs.readFileSync(await file.path(), "utf8");
        assert.ok(csv.includes("פעולות") && csv.startsWith("\ufeff"));
        await page.getByRole("button", { name: "השבוע הקודם", exact: true }).click();
        await page.waitForURL(/week=2026-10-11/);
        await page.locator(".report-metric").first().waitFor();
        await page.getByLabel("אזור זמן").selectOption("UTC");
        await page.waitForURL(/timezone=UTC/);
        await page.locator(".report-metric").first().waitFor();
        report.unusedKeysFilter = true;
        report.inventorySearch = true;
        report.connectedAccounts = 32;
        report.serviceFilter = true;
        report.weekNavigation = true;
        report.timezoneSelection = true;
        report.csvDownload = true;
      }
      await context.close();
    }
    assert.deepEqual(pageErrors, []);
    assert.equal(apiWrites, 0);
    report.pageErrors = pageErrors;
    fs.writeFileSync("verification/reports-browser.json", JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
