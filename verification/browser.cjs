const { chromium } = require("/home/ubuntu/git/x-reader/node_modules/playwright-core");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const action = (service, name) => ({
  id: `${service}.${name}`,
  service,
  name: name === "read" ? "Read messages" : "Send a message",
  description: name === "read" ? "Find and read messages in this account." : "Send a new message to a recipient.",
  requiredScopes: [],
  execution: {
    locallyExecutable: true,
    catalogOnly: false,
    requiredAuthTypes: ["api_key"],
    noAuthRunnable: false,
    needsCredential: true,
  },
});
const providers = ["gmail", "github", "slack"].map((service) => ({
  service,
  displayName: service === "gmail" ? "Gmail" : service === "github" ? "GitHub" : "Slack",
  description: `Connect ${service} and choose what your assistant can do.`,
  categories: ["productivity"],
  authTypes: ["api_key"],
  auth: [{ type: "api_key" }],
  actions: [action(service, "read"), action(service, "send")],
}));
const connections = [
  {
    id: "gmail-personal",
    service: "gmail",
    connectionName: "personal",
    authType: "api_key",
    configured: true,
    metadata: {},
  },
  { id: "gmail-work", service: "gmail", connectionName: "work", authType: "api_key", configured: true, metadata: {} },
  {
    id: "github-personal",
    service: "github",
    connectionName: "personal",
    authType: "api_key",
    configured: true,
    metadata: {},
  },
];
const rules = { allowedActions: [], blockedActions: [], allowedProxies: [], blockedProxies: [] };
let tokens = [
  {
    id: "owui",
    name: "open-webui-readonly",
    allowedActions: ["gmail.read", "github.read"],
    blockedActions: ["gmail.send"],
    allowedProxies: [],
    allowedConnections: ["gmail-personal", "github-personal"],
    createdAt: "2026-10-21T00:00:00Z",
  },
  {
    id: "broad",
    name: "legacy-app",
    allowedActions: ["*"],
    blockedActions: [],
    allowedProxies: [],
    allowedConnections: [],
    createdAt: "2026-10-21T00:00:00Z",
  },
];
(async () => {
  const browser = await chromium.launch({
    executablePath: "/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
    await context.route("**/ui-assets/**", (route) =>
      route.continue({ url: route.request().url().replace("/ui-assets/", "/") }),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let writes = [];
    await context.route("**/api/**", async (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname;
      let result;
      if (req.method() === "PUT" && p === "/api/runtime-tokens/owui") {
        const body = req.postDataJSON();
        writes.push(body);
        tokens = tokens.map((t) => (t.id === "owui" ? { ...t, ...body } : t));
        result = tokens[0];
      } else if (req.method() === "POST" && p === "/api/runtime-tokens") {
        const body = req.postDataJSON();
        writes.push(body);
        const record = { ...body, id: "new-app", createdAt: "2026-10-21T00:00:00Z" };
        tokens.push(record);
        result = { token: "test-private-key-not-a-real-credential", record };
      } else
        result = {
          "/api/auth/session": { authenticated: true, adminAuthConfigured: true },
          "/api/providers": providers,
          "/api/connections": connections,
          "/api/oauth/configs": [],
          "/api/runtime-tokens": tokens,
          "/api/runtime-policy": { deployment: rules, runtime: rules },
          "/api/runs": { items: [] },
        }[p];
      if (result === undefined) throw new Error(`Unexpected API call ${req.method()} ${p}`);
      await route.fulfill({ json: result });
    });
    await page.goto("http://127.0.0.1:4177/");
    await page.getByRole("heading", { name: "Your services. The right tools." }).waitFor();
    assert.equal(await page.locator(".workspace-service").count(), 2);
    assert.match(await page.locator(".workspace-client-main").innerText(), /2 tools allowed/);
    await page.screenshot({ path: "verification/workspace-desktop.png", fullPage: true });
    const gmail = page
      .locator(".workspace-service")
      .filter({ has: page.getByRole("heading", { name: "Gmail", exact: true }) });
    await gmail.getByRole("button", { name: "Tools", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Send a message", { exact: true }).waitFor();
    assert.equal(await dialog.getByRole("checkbox", { name: /Send a message/ }).isDisabled(), true);
    await page.screenshot({ path: "verification/workspace-tools.png" });
    await dialog.getByRole("checkbox", { name: /Read messages/ }).uncheck();
    await dialog.getByRole("button", { name: "Save access", exact: true }).click();
    assert.deepEqual(writes[0].allowedActions, ["github.read"]);
    assert.deepEqual(writes[0].blockedActions, ["gmail.send"]);
    assert.deepEqual(writes[0].allowedConnections, ["gmail-personal", "github-personal"]);
    assert.deepEqual(writes[0].allowedProxies, []);
    await page.getByRole("button", { name: "Add an app", exact: true }).click();
    await page.getByPlaceholder("For example, my research assistant").fill("Research");
    assert.equal(await page.getByRole("button", { name: "Create app key" }).isDisabled(), true);
    await page.getByRole("checkbox", { name: "Gmail · personal", exact: true }).check();
    await page.getByRole("checkbox", { name: /Read messages/ }).check();
    await page.getByRole("button", { name: "Create app key" }).click();
    await page.getByRole("heading", { name: "Your app key is ready" }).waitFor();
    assert.deepEqual(writes[1].allowedActions, ["gmail.read"]);
    assert.deepEqual(writes[1].allowedConnections, ["gmail-personal"]);
    assert.deepEqual(writes[1].allowedProxies, []);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByLabel("Tools available to", { exact: true }).selectOption("broad");
    await page.getByRole("button", { name: "Choose tools & accounts" }).click();
    await page.getByText(/This app uses wildcard rules/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Save access", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByLabel("Tools available to", { exact: true }).selectOption("owui");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "verification/workspace-mobile.png", fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    // Phone navigation and long permission lists use fixture data only.
    providers[0].actions.push(
      ...Array.from({ length: 35 }, (_, index) => ({
        ...action("gmail", `read-${index}`),
        name: `Read archive ${index + 1}`,
        description: "Read archived messages with a long description that must wrap on narrow screens.",
      })),
    );
    await page.reload();
    await page.getByRole("heading", { name: "Your services. The right tools." }).waitFor();
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      const menu = page.getByRole("button", { name: "Primary", exact: true });
      await menu.click();
      const navigation = page.getByRole("dialog");
      if (viewport.width === 390) await page.screenshot({ path: "verification/workspace-mobile-menu.png" });
      const themeButtons = navigation.getByRole("radio");
      for (const radio of await themeButtons.all()) {
        const box = await radio.boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44);
      }
      const navBox = await navigation.boundingBox();
      assert.ok(navBox.x >= 0 && navBox.y >= 0);
      await navigation.getByRole("link", { name: "Runs", exact: true }).click();
      await navigation.waitFor({ state: "hidden" });
      await menu.click();
      await page.getByRole("dialog").getByRole("link", { name: "Services & tools", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await menu.click();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.ok((await page.locator(".shell-header").boundingBox()).height <= 60);
      const service = page
        .locator(".workspace-service")
        .filter({ has: page.getByRole("heading", { name: "Gmail", exact: true }) });
      await service.getByRole("button", { name: "Tools", exact: true }).click();
      const editor = page.getByRole("dialog");
      if (viewport.width === 390) await page.screenshot({ path: "verification/workspace-mobile-tools-start.png" });
      await editor.getByText("Read archive 35", { exact: true }).scrollIntoViewIfNeeded();
      if (viewport.width <= 600) {
        const save = editor.getByRole("button", { name: "Save access", exact: true });
        const box = await save.boundingBox();
        assert.ok(box.y >= 0 && box.y + box.height <= viewport.height);
        assert.ok(box.height >= 44);
        assert.equal(await editor.evaluate((element) => element.scrollWidth > element.clientWidth), false);
        const input = editor.getByRole("textbox", { name: "Search tools by name or purpose" });
        assert.ok(await input.evaluate((element) => parseFloat(getComputedStyle(element).fontSize) >= 16));
        await page.screenshot({ path: `verification/workspace-mobile-tools-${viewport.width}.png` });
      }
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `verification/workspace-mobile-${viewport.width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Add a service", exact: true }).click();
    await page.getByPlaceholder("Search Gmail, GitHub, Drive…").fill("Slack");
    await page.getByRole("link", { name: "Connect account" }).click();
    await page.getByRole("heading", { name: "Slack", exact: true }).waitFor();
    assert.equal(writes.length, 2);
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      "verification/browser-result.json",
      JSON.stringify(
        {
          desktop: true,
          mobile: true,
          mobileViewports: ["320x568", "390x844", "844x390"],
          mobileNavigationAndEscape: true,
          longPermissionListAndVisibleFooter: true,
          noHorizontalOverflow: true,
          appSelection: true,
          blockedActionDisabled: true,
          existingBlocksAndAccountsPreserved: true,
          newAppExplicitGrants: true,
          emptyGrantsCannotSave: true,
          wildcardRulesCannotBeRewritten: true,
          connectServiceNavigation: true,
          realProviderCalls: false,
          pageErrors: errors,
        },
        null,
        2,
      ) + "\n",
    );
    console.log("Workspace browser checks passed.");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
