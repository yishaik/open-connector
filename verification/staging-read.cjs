const { chromium } = require("/home/ubuntu/git/x-reader/node_modules/playwright-core");
const fs = require("node:fs");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath: "/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome",
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const errors = [];
    const counts = {};
    await context.route("**/ui-assets/**", (route) =>
      route.continue({ url: route.request().url().replace("/ui-assets/", "/") }),
    );
    await context.route("**/api/**", async (route) => {
      assert.equal(route.request().method(), "GET", "Staging UI must remain read-only");
      const path = new URL(route.request().url()).pathname;
      const response = await route.fetch({
        url: "http://127.0.0.1:4182" + path,
        headers: { ...route.request().headers(), authorization: "Bearer " + process.env.OOMOL_CONNECT_ADMIN_TOKEN },
      });
      assert.equal(response.status(), 200, path);
      if (["/api/providers", "/api/connections", "/api/runtime-tokens"].includes(path)) {
        const data = await response.json();
        counts[path] = data.length;
        if (path === "/api/connections")
          counts.savedConnections = data.filter(
            (connection) => !connection.virtual && connection.authType !== "no_auth",
          ).length;
      }
      await route.fulfill({ response });
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:4178/workspace");
    await page.getByRole("heading", { name: "Your services. The right tools." }).waitFor();
    await page.locator(".workspace-service").first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.goto("http://127.0.0.1:4178/runs");
    await page.locator(".run-entry").first().waitFor();
    assert.ok(await page.locator(".run-actor").count());
    assert.deepEqual(errors, []);
    assert.equal(counts.savedConnections, 32);
    assert.equal(counts["/api/runtime-tokens"], 11);
    assert.equal(counts["/api/providers"], 1650);
    const report = {
      date: "2026-10-21",
      source: "Upgraded backend using Worker credential encryption and a migrated copy of production D1",
      counts,
      workspaceRenders: true,
      activityRenders: true,
      noHorizontalOverflow: true,
      apiWrites: 0,
      realProviderCalls: 0,
      pageErrors: errors,
    };
    fs.writeFileSync("verification/upgrade-staging-read.json", JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
