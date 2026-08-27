import type { ActionDefinition, ConnectionRecord, ProviderDefinition } from "./model";
import { describe, expect, it } from "vitest";
import {
  emptyTokenGrantDraft,
  filterGrantServices,
  grantedActionIds,
  listGrantServices,
  tokenGrantDraftFromPolicy,
  tokenPolicyFromGrantDraft,
  toggleAccount,
  toggleAction,
  toggleKind,
  toggleService,
} from "./token-grant";

const exec = {
  locallyExecutable: true,
  catalogOnly: false,
  requiredAuthTypes: ["oauth2"],
  noAuthRunnable: false,
  needsCredential: true,
};

const gmailId = "11111111-1111-4111-8111-111111111111";
const youtubeId = "22222222-2222-4222-8222-222222222222";
const telegramOpsId = "cc9ff1ab-08f6-45d6-975d-46c8ecc19d38";
const telegramBridgeId = "6568c3f0-79fd-410f-8aa9-4eabfc0add89";
const githubDefaultId = "33333333-3333-4333-8333-333333333333";
const githubWorkId = "44444444-4444-4444-8444-444444444444";

function action(id: string, name: string, description = name): ActionDefinition {
  return {
    id,
    service: id.split(".")[0] ?? "",
    name,
    description,
    requiredScopes: [],
    execution: exec,
  };
}

function provider(service: string, displayName: string, actions: ActionDefinition[]): ProviderDefinition {
  return {
    service,
    displayName,
    categories: [],
    authTypes: ["oauth2"],
    auth: [],
    actions,
  };
}

function connection(id: string, service: string, connectionName: string): ConnectionRecord {
  return { id, service, connectionName, authType: "oauth2", metadata: {} };
}

const gmail = provider("gmail", "Gmail", [
  action("gmail.fetch_emails", "fetch_emails", "List mail"),
  action("gmail.create_draft", "create_draft", "Compose a draft"),
  action("gmail.send_email", "send_email", "Send mail"),
]);
const youtube = provider("youtube", "YouTube", [action("youtube.search", "search", "Search videos")]);
const telegram = provider("telegram", "Telegram", [
  action("telegram.get_me", "get_me", "Bot identity"),
  action("telegram.send_message", "send_message", "Send a message"),
]);
const github = provider("github", "GitHub", [
  action("github.list_repos", "list_repos", "List repos"),
  action("github.create_issue", "create_issue", "Create an issue"),
]);
const mxtoolbox = provider("mx_toolbox", "MxToolbox", [action("mx_toolbox.lookup_mx", "lookup_mx", "Lookup MX")]);

const connections = [
  connection(gmailId, "gmail", "default"),
  connection(youtubeId, "youtube", "default"),
  connection(telegramOpsId, "telegram", "ops"),
  connection(telegramBridgeId, "telegram", "bridge"),
  connection(githubDefaultId, "github", "default"),
  connection(githubWorkId, "github", "persona-lab"),
  connection("55555555-5555-4555-8555-555555555555", "mx_toolbox", "MxToolbox-theyishaik"),
  {
    id: "clock-virtual",
    service: "clock",
    connectionName: "virtual",
    authType: "no_auth",
    virtual: true,
    metadata: {},
  } satisfies ConnectionRecord,
];

const catalog = listGrantServices([gmail, youtube, telegram, github, mxtoolbox], connections);

function policyFromToggles(
  enable: Array<{ service: string; accountId?: string; actions?: string[] }>,
) {
  let draft = emptyTokenGrantDraft();
  const byService = new Map(catalog.map((service) => [service.service, service]));
  for (const grant of enable) {
    const service = byService.get(grant.service);
    if (!service) {
      throw new Error(`missing ${grant.service}`);
    }
    if (!draft.services[grant.service]) {
      draft = toggleService(draft, service, true);
    }
    if (grant.actions) {
      const allowed = new Set(grant.actions);
      for (const item of service.actions) {
        draft = toggleAction(draft, service, item.id, allowed.has(item.id), grant.accountId);
      }
    }
  }
  return tokenPolicyFromGrantDraft(draft, catalog);
}

describe("token grant user flows", () => {
  it("hides virtual connections and lists every real connected service", () => {
    expect(catalog.map((service) => service.service).sort()).toEqual([
      "github",
      "gmail",
      "mx_toolbox",
      "telegram",
      "youtube",
    ]);
    expect(catalog.find((service) => service.service === "telegram")?.accounts.map((account) => account.name)).toEqual([
      "ops",
      "bridge",
    ]);
  });

  it("lets a user find Telegram by service, display name, or account name", () => {
    expect(filterGrantServices(catalog, "tele").map((service) => service.service)).toEqual(["telegram"]);
    expect(filterGrantServices(catalog, "Gmail").map((service) => service.service)).toEqual(["gmail"]);
    expect(filterGrantServices(catalog, "ops").map((service) => service.service)).toEqual(["telegram"]);
    expect(filterGrantServices(catalog, "persona-lab").map((service) => service.service)).toEqual(["github"]);
    expect(filterGrantServices(catalog, "no-such-app")).toEqual([]);
    expect(filterGrantServices(catalog, "  ")).toHaveLength(catalog.length);
  });

  it("creates a key that can do nothing until services are checked", () => {
    const policy = tokenPolicyFromGrantDraft({ services: {} }, catalog);
    expect(policy).toEqual({
      allowedActions: [],
      blockedActions: [],
      allowedProxies: [],
      allowedConnections: [],
    });
  });

  it("sets WhatsAI to Gmail read plus YouTube, without drafts or send", () => {
    let draft = toggleService({ services: {} }, catalog.find((service) => service.service === "gmail")!, true);
    draft = toggleKind(draft, catalog.find((service) => service.service === "gmail")!, "write", false);
    draft = toggleService(draft, catalog.find((service) => service.service === "youtube")!, true);
    const policy = tokenPolicyFromGrantDraft(draft, catalog);
    expect(policy.allowedActions).toEqual(["gmail.fetch_emails", "youtube.*"]);
    expect(policy.allowedConnections.sort()).toEqual([gmailId, youtubeId].sort());
    expect(grantedActionIds(draft, "gmail", gmailId)).toEqual(["gmail.fetch_emails"]);
  });

  it("sets Alfred to Gmail read and drafts, still blocking send", () => {
    const gmailService = catalog.find((service) => service.service === "gmail")!;
    let draft = toggleService({ services: {} }, gmailService, true);
    draft = toggleAction(draft, gmailService, "gmail.send_email", false);
    const policy = tokenPolicyFromGrantDraft(draft, catalog);
    expect(policy.allowedActions).toEqual(["gmail.fetch_emails", "gmail.create_draft"]);
    expect(policy.allowedActions).not.toContain("gmail.send_email");
  });

  it("lets Grok keep every Gmail action including send", () => {
    const gmailService = catalog.find((service) => service.service === "gmail")!;
    const draft = toggleService({ services: {} }, gmailService, true);
    expect(tokenPolicyFromGrantDraft(draft, catalog).allowedActions).toEqual(["gmail.*"]);
  });

  it("gives Telegram ops send while bridge can only get_me", () => {
    const telegramService = catalog.find((service) => service.service === "telegram")!;
    let draft = toggleService({ services: {} }, telegramService, true);
    draft = toggleAction(draft, telegramService, "telegram.send_message", false, telegramBridgeId);
    const policy = tokenPolicyFromGrantDraft(draft, catalog);
    expect(policy.allowedConnections.sort()).toEqual([telegramBridgeId, telegramOpsId].sort());
    expect(policy.allowedActions.sort()).toEqual(
      [`telegram.*@${telegramOpsId}`, `telegram.get_me@${telegramBridgeId}`].sort(),
    );
    const loaded = tokenGrantDraftFromPolicy(policy, catalog);
    expect(grantedActionIds(loaded, "telegram", telegramOpsId)).toEqual(["telegram.get_me", "telegram.send_message"]);
    expect(grantedActionIds(loaded, "telegram", telegramBridgeId)).toEqual(["telegram.get_me"]);
  });

  it("round-trips a split Telegram grant without leaking send onto bridge", () => {
    const policy = {
      allowedActions: [`telegram.*@${telegramOpsId}`, `telegram.get_me@${telegramBridgeId}`],
      blockedActions: [],
      allowedProxies: [],
      allowedConnections: [telegramOpsId, telegramBridgeId],
    };
    const draft = tokenGrantDraftFromPolicy(policy, catalog);
    expect(tokenPolicyFromGrantDraft(draft, catalog).allowedActions.sort()).toEqual(policy.allowedActions.sort());
    expect(grantedActionIds(draft, "telegram", telegramBridgeId)).not.toContain("telegram.send_message");
  });

  it("keeps compact unscoped rules when every Telegram account has the same actions", () => {
    const telegramService = catalog.find((service) => service.service === "telegram")!;
    let draft = toggleService({ services: {} }, telegramService, true);
    draft = toggleAction(draft, telegramService, "telegram.send_message", false);
    expect(tokenPolicyFromGrantDraft(draft, catalog)).toEqual({
      allowedActions: ["telegram.get_me"],
      blockedActions: [],
      allowedProxies: [],
      allowedConnections: [telegramOpsId, telegramBridgeId],
    });
  });

  it("turns off the bridge bot without changing ops", () => {
    const telegramService = catalog.find((service) => service.service === "telegram")!;
    let draft = toggleService({ services: {} }, telegramService, true);
    draft = toggleAccount(draft, telegramService, telegramBridgeId, false);
    const policy = tokenPolicyFromGrantDraft(draft, catalog);
    expect(policy.allowedConnections).toEqual([telegramOpsId]);
    expect(policy.allowedActions).toEqual(["telegram.*"]);
  });

  it("gives GitHub work create_issue while default stays read-only", () => {
    const githubService = catalog.find((service) => service.service === "github")!;
    let draft = toggleService({ services: {} }, githubService, true);
    draft = toggleAction(draft, githubService, "github.create_issue", false, githubDefaultId);
    const loaded = tokenGrantDraftFromPolicy(tokenPolicyFromGrantDraft(draft, catalog), catalog);
    expect(grantedActionIds(loaded, "github", githubDefaultId)).toEqual(["github.list_repos"]);
    expect(grantedActionIds(loaded, "github", githubWorkId)).toEqual(["github.create_issue", "github.list_repos"]);
  });

  it("loads a wildcard MCP key as every connected service and account, all actions on", () => {
    const loaded = tokenGrantDraftFromPolicy(
      { allowedActions: ["*"], blockedActions: [], allowedProxies: [], allowedConnections: [] },
      catalog,
    );
    expect(Object.keys(loaded.services).sort()).toEqual(["github", "gmail", "mx_toolbox", "telegram", "youtube"]);
    expect(loaded.services.telegram?.accounts[telegramOpsId]?.allActions).toBe(true);
    expect(loaded.services.telegram?.accounts[telegramBridgeId]?.allActions).toBe(true);
    expect(loaded.services.gmail?.accounts[gmailId]?.actionIds).toContain("gmail.send_email");
  });

  it("applies a blocked send rule onto an all-Gmail grant", () => {
    const loaded = tokenGrantDraftFromPolicy(
      {
        allowedActions: ["gmail.*"],
        blockedActions: ["gmail.send_email"],
        allowedProxies: [],
        allowedConnections: [gmailId],
      },
      catalog,
    );
    expect(grantedActionIds(loaded, "gmail", gmailId)).toEqual(["gmail.create_draft", "gmail.fetch_emails"]);
  });

  it("does not grant proxy unless the user checks it", () => {
    const gmailService = catalog.find((service) => service.service === "gmail")!;
    const draft = toggleService({ services: {} }, gmailService, true);
    expect(tokenPolicyFromGrantDraft(draft, catalog).allowedProxies).toEqual([]);
  });

  it("builds the live WhatsAI / Alfred / Grok Gmail matrix from the same catalog", () => {
    const whatsai = policyFromToggles([
      { service: "gmail", actions: ["gmail.fetch_emails"] },
      { service: "youtube" },
    ]);
    const alfred = policyFromToggles([{ service: "gmail", actions: ["gmail.fetch_emails", "gmail.create_draft"] }]);
    const grok = policyFromToggles([{ service: "gmail" }]);
    expect(whatsai.allowedActions).toContain("gmail.fetch_emails");
    expect(whatsai.allowedActions).not.toContain("gmail.send_email");
    expect(alfred.allowedActions).toContain("gmail.create_draft");
    expect(alfred.allowedActions).not.toContain("gmail.send_email");
    expect(grok.allowedActions).toEqual(["gmail.*"]);
  });
});
