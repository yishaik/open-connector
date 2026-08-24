import type { ActionDefinition, ConnectionRecord, ProviderDefinition } from "./model";
import { describe, expect, it } from "vitest";
import {
  actionGrantKind,
  listGrantServices,
  tokenGrantDraftFromPolicy,
  tokenPolicyFromGrantDraft,
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

const gmailConnection: ConnectionRecord = {
  id: "gmail-default",
  service: "gmail",
  connectionName: "default",
  authType: "oauth2",
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
      allowedConnections: ["gmail-default"],
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
    expect(loaded.services.gmail?.allActions).toBe(true);
    expect(loaded.services.gmail?.actionIds).toEqual([
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
        allowedConnections: ["gmail-default"],
      },
      catalog,
    );
    expect(loaded.services.gmail?.actionIds).toEqual(["gmail.fetch_emails", "gmail.create_draft"]);
    expect(loaded.services.gmail?.allActions).toBe(false);
  });

  it("turns off a service completely when unchecked", () => {
    const catalog = listGrantServices([gmail], [gmailConnection]);
    const enabled = toggleService({ services: {} }, catalog[0], true);
    const disabled = toggleService(enabled, catalog[0], false);
    expect(tokenPolicyFromGrantDraft(disabled, catalog).allowedActions).toEqual([]);
  });
});
