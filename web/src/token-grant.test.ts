import type { ActionDefinition, ConnectionRecord, ProviderDefinition } from "./model";

import { describe, expect, it } from "vitest";
import {
  actionGrantKind,
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

const gmail: ProviderDefinition = {
  service: "gmail",
  displayName: "Gmail",
  categories: [],
  authTypes: ["oauth2"],
  auth: [],
  actions: [
    action("gmail.fetch_emails", "fetch_emails", "List mail"),
    action("gmail.create_draft", "create_draft", "Compose a draft"),
    action("gmail.send_email", "send_email", "Send mail"),
  ],
};

const gmailId = "11111111-1111-4111-8111-111111111111";

const gmailConnection: ConnectionRecord = {
  id: gmailId,
  service: "gmail",
  connectionName: "default",
  authType: "oauth2",
  metadata: {},
};

const telegram: ProviderDefinition = {
  service: "telegram",
  displayName: "Telegram",
  categories: [],
  authTypes: ["api_key"],
  auth: [],
  actions: [
    action("telegram.get_me", "get_me", "Bot identity"),
    action("telegram.send_message", "send_message", "Send a message"),
  ],
};

const telegramOpsId = "cc9ff1ab-08f6-45d6-975d-46c8ecc19d38";
const telegramBridgeId = "6568c3f0-79fd-410f-8aa9-4eabfc0add89";

const telegramOps: ConnectionRecord = {
  id: telegramOpsId,
  service: "telegram",
  connectionName: "ops",
  authType: "api_key",
  metadata: {},
};

const telegramBridge: ConnectionRecord = {
  id: telegramBridgeId,
  service: "telegram",
  connectionName: "bridge",
  authType: "api_key",
  metadata: {},
};

describe("token grants", () => {
  it("classifies send and draft as writes", () => {
    expect(actionGrantKind(action("gmail.fetch_emails", "fetch_emails"))).toBe("read");
    expect(actionGrantKind(action("gmail.create_draft", "create_draft"))).toBe("write");
    expect(actionGrantKind(action("gmail.send_email", "send_email"))).toBe("write");
  });

  it("round-trips the Gmail read / draft / send matrix", () => {
    const catalog = listGrantServices([gmail], [gmailConnection]);
    let draft = toggleService({ services: {} }, catalog[0], true);
    draft = toggleAction(draft, catalog[0], "gmail.send_email", false);
    draft = toggleAction(draft, catalog[0], "gmail.create_draft", false);
    expect(tokenPolicyFromGrantDraft(draft, catalog)).toEqual({
      allowedActions: ["gmail.fetch_emails"],
      blockedActions: [],
      allowedProxies: [],
      allowedConnections: [gmailId],
    });

    draft = toggleAction(draft, catalog[0], "gmail.create_draft", true);
    expect(tokenPolicyFromGrantDraft(draft, catalog).allowedActions).toEqual([
      "gmail.fetch_emails",
      "gmail.create_draft",
    ]);

    draft = toggleKind(draft, catalog[0], "write", true);
    expect(tokenPolicyFromGrantDraft(draft, catalog).allowedActions).toEqual(["gmail.*"]);
  });

  it("loads a wildcard key as every connected service with all actions", () => {
    const catalog = listGrantServices([gmail], [gmailConnection]);
    const loaded = tokenGrantDraftFromPolicy(
      { allowedActions: ["*"], blockedActions: [], allowedProxies: [], allowedConnections: [] },
      catalog,
    );
    expect(loaded.services.gmail?.accounts[gmailId]?.allActions).toBe(true);
    expect(loaded.services.gmail?.accounts[gmailId]?.actionIds).toEqual([
      "gmail.fetch_emails",
      "gmail.create_draft",
      "gmail.send_email",
    ]);
  });

  it("applies blocked send rules onto an all-gmail grant", () => {
    const catalog = listGrantServices([gmail], [gmailConnection]);
    const loaded = tokenGrantDraftFromPolicy(
      {
        allowedActions: ["gmail.*"],
        blockedActions: ["gmail.send_email"],
        allowedProxies: [],
        allowedConnections: [gmailId],
      },
      catalog,
    );
    expect(loaded.services.gmail?.accounts[gmailId]?.actionIds).toEqual(["gmail.fetch_emails", "gmail.create_draft"]);
    expect(loaded.services.gmail?.accounts[gmailId]?.allActions).toBe(false);
  });

  it("turns off a service completely when unchecked", () => {
    const catalog = listGrantServices([gmail], [gmailConnection]);
    const enabled = toggleService({ services: {} }, catalog[0], true);
    const disabled = toggleService(enabled, catalog[0], false);
    expect(tokenPolicyFromGrantDraft(disabled, catalog).allowedActions).toEqual([]);
  });

  it("grants different Telegram actions per account", () => {
    const catalog = listGrantServices([telegram], [telegramOps, telegramBridge]);
    let draft = toggleService({ services: {} }, catalog[0], true);
    draft = toggleAction(draft, catalog[0], "telegram.send_message", false, telegramBridgeId);
    const policy = tokenPolicyFromGrantDraft(draft, catalog);
    expect(policy.allowedConnections.sort()).toEqual([telegramBridgeId, telegramOpsId].sort());
    expect(policy.allowedActions.sort()).toEqual(
      [`telegram.*@${telegramOpsId}`, `telegram.get_me@${telegramBridgeId}`].sort(),
    );

    const loaded = tokenGrantDraftFromPolicy(policy, catalog);
    expect(loaded.services.telegram?.accounts[telegramOpsId]?.actionIds.sort()).toEqual([
      "telegram.get_me",
      "telegram.send_message",
    ]);
    expect(loaded.services.telegram?.accounts[telegramBridgeId]?.actionIds).toEqual(["telegram.get_me"]);
  });

  it("turns off one Telegram account without dropping the other", () => {
    const catalog = listGrantServices([telegram], [telegramOps, telegramBridge]);
    let draft = toggleService({ services: {} }, catalog[0], true);
    draft = toggleAccount(draft, catalog[0], telegramBridgeId, false);
    expect(tokenPolicyFromGrantDraft(draft, catalog)).toEqual({
      allowedActions: ["telegram.*"],
      blockedActions: [],
      allowedProxies: [],
      allowedConnections: [telegramOpsId],
    });
  });
});
