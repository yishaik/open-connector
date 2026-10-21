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
providers.push({
  service: "oauth-demo",
  displayName: "OAuth demo",
  description: "Test service",
  categories: [],
  authTypes: ["oauth2"],
  auth: [{ type: "oauth2", scopes: [] }],
  actions: [
    {
      ...action("oauth-demo", "read"),
      execution: { ...action("oauth-demo", "read").execution, requiredAuthTypes: ["oauth2"] },
    },
  ],
});
const auditRuns = [
  {
    id: "audit-demo",
    service: "gmail",
    actionId: "gmail.read",
    caller: "mcp",
    runtimeTokenId: "owui",
    connectionId: "gmail-personal",
    startedAt: "2026-10-21T10:00:00Z",
    completedAt: "2026-10-21T10:00:01Z",
    durationMs: 1000,
    ok: true,
    inputSummary: {},
    outputSummary: { count: 1 },
  },
];
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
    const connectionWrites = [];
    let oauthAttempts = 0;
    let oauthFailure = false;
    let oauthMissingUrl = false;
    let connectionFailure = false;
    let grantFailure = false;
    await context.route("**/api/**", async (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname;
      let result;
      if (req.method() === "PUT" && p === "/api/connections/slack") {
        if (connectionFailure) {
          await route.fulfill({ status: 400, json: { message: "Example credential rejected" } });
          return;
        }
        const body = req.postDataJSON();
        connectionWrites.push(body);
        const record = {
          id: "slack-new",
          service: "slack",
          connectionName: body.connectionName,
          authType: body.authType,
          configured: true,
          metadata: {},
        };
        connections.push(record);
        result = record;
      } else if (req.method() === "POST" && p === "/api/oauth/authorizations") {
        oauthAttempts++;
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (oauthFailure) {
          await route.fulfill({ status: 400, json: { message: "Example authorization failed" } });
          return;
        }
        result = oauthMissingUrl ? {} : { authorizationUrl: "https://example.test/authorize?state=test-only" };
      } else if (req.method() === "PUT" && p === "/api/runtime-tokens/owui") {
        if (grantFailure) {
          await route.fulfill({ status: 500, json: { message: "Example save failed" } });
          return;
        }
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
          "/api/oauth/configs": [
            { service: "oauth-demo", configured: true, clientId: "fixture-client", customClientAvailable: true },
          ],
          "/api/runtime-tokens": tokens,
          "/api/runtime-policy": { deployment: rules, runtime: rules },
          "/api/runs": { items: auditRuns },
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
    await page.getByLabel("API key", { exact: true }).fill("fixture-only-not-a-real-key");
    await page.getByRole("button", { name: "Save Connection", exact: true }).click();
    await page.getByText(/Account connected. Next, choose/).waitFor();
    assert.equal(connectionWrites.length, 1);
    assert.equal(connectionWrites[0].connectionName, "default");
    assert.equal(connectionWrites[0].authType, "api_key");
    await page.goto("http://127.0.0.1:4177/runs");
    await page.locator(".run-actor", { hasText: "open-webui-readonly" }).waitFor();
    assert.match(await page.locator(".run-col-context").last().innerText(), /personal/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: "verification/activity-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: "verification/activity-desktop.png", fullPage: true });
    await context.route("https://example.test/**", (route) => route.fulfill({ body: "Fixture authorization page" }));
    await page.goto("http://127.0.0.1:4177/providers/oauth-demo");
    const popupPromise = context.waitForEvent("page");
    await page.getByRole("button", { name: "Connect OAuth demo", exact: true }).click();
    const popup = await popupPromise;
    await popup.waitForURL("https://example.test/**");
    await popup.close();
    await page.reload();
    await page.getByRole("button", { name: "Connect OAuth demo", exact: true }).waitFor();
    await page.evaluate(() => {
      window.open = () => null;
    });
    await page.getByRole("button", { name: "Connect OAuth demo", exact: true }).click();
    const fallback = page.getByRole("link", { name: "Continue sign-in" });
    await fallback.waitFor();
    assert.match(await fallback.getAttribute("href"), /^https:\/\/example.test\/authorize/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "verification/connect-oauth-fallback.png", fullPage: true });
    oauthFailure = true;
    await page.getByRole("button", { name: "Connect OAuth demo", exact: true }).click();
    await page.getByText("Example authorization failed", { exact: true }).waitFor();
    assert.equal(await fallback.count(), 0);
    assert.equal(await page.getByRole("button", { name: "Connect OAuth demo", exact: true }).isEnabled(), true);
    assert.equal(oauthAttempts, 3);
    assert.equal(writes.length, 2);
    // Rejected saves keep the current form and selections available for retry.
    oauthFailure = false;
    oauthMissingUrl = true;
    await page.getByRole("button", { name: "Connect OAuth demo", exact: true }).click();
    await page.getByText("The service did not return a sign-in URL. Try again.", { exact: true }).waitFor();
    assert.equal(await fallback.count(), 0);
    oauthMissingUrl = false;
    await page.getByRole("button", { name: "Connect OAuth demo", exact: true }).click();
    await fallback.waitFor();
    connections.push({
      id: "oauth-complete",
      service: "oauth-demo",
      connectionName: "default",
      authType: "oauth2",
      configured: true,
      metadata: {},
    });
    // Callback completion is received even though the OAuth window has no opener.
    await page.evaluate(() => {
      const channel = new BroadcastChannel("oomol-connect-oauth");
      channel.postMessage({ type: "oauth.completed", service: "oauth-demo" });
      channel.close();
    });
    await page.getByText(/Account connected. Next, choose/).waitFor();

    await page.goto("http://127.0.0.1:4177/providers/slack");
    await page.getByRole("button", { name: "Add Connection", exact: true }).click();
    await page.getByLabel(/^Connection name/).fill("retry-account");
    await page.getByLabel("API key", { exact: true }).fill("fixture-retry-credential");
    connectionFailure = true;
    await page.getByRole("button", { name: "Save Connection", exact: true }).click();
    await page.getByText("Example credential rejected", { exact: true }).waitFor();
    assert.equal(await page.getByLabel(/^Connection name/).inputValue(), "retry-account");
    assert.equal(await page.getByLabel("API key", { exact: true }).inputValue(), "fixture-retry-credential");
    assert.equal(connectionWrites.length, 1);
    connectionFailure = false;
    await page.getByRole("button", { name: "Save Connection", exact: true }).click();
    await page.getByText("retry-account", { exact: true }).waitFor();
    assert.equal(connectionWrites.length, 2);

    await page.goto("http://127.0.0.1:4177/workspace");
    await page
      .locator(".workspace-service")
      .filter({ has: page.getByRole("heading", { name: "Gmail", exact: true }) })
      .getByRole("button", { name: "Tools", exact: true })
      .click();
    const retryDialog = page.getByRole("dialog");
    await retryDialog.getByRole("checkbox", { name: /Read messages/ }).check();
    grantFailure = true;
    await retryDialog.getByRole("button", { name: "Save access", exact: true }).click();
    await retryDialog.getByRole("alert").filter({ hasText: "Example save failed" }).waitFor();
    assert.equal(await retryDialog.getByRole("checkbox", { name: /Read messages/ }).isChecked(), true);
    assert.equal(writes.length, 2);
    grantFailure = false;
    await retryDialog.getByRole("button", { name: "Save access", exact: true }).click();
    await retryDialog.waitFor({ state: "hidden" });
    assert.equal(writes.length, 3);
    assert.deepEqual(writes[2].blockedActions, ["gmail.send"]);
    assert.deepEqual(writes[2].allowedConnections, ["gmail-personal", "github-personal"]);
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
          connectionSaved: true,
          oauthPopupAndBlockedFallback: true,
          oauthFailureCanRetry: true,
          activityShowsAppAndAccount: true,
          missingAuthorizationUrlHandled: true,
          oauthCompletionRefreshesAccount: true,
          rejectedCredentialsPreservedForRetry: true,
          failedGrantSavePreservesSelectionAndCanRetry: true,
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
