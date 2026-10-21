import type { AppData, ProviderDefinition, RuntimeTokenSummary } from "./model";

import { describe, expect, it } from "vitest";
import { allowedToolCount, grantSelectionError, supportsVisualEditing } from "./workspace-access";
const rules = { allowedActions: [], blockedActions: [], allowedProxies: [], blockedProxies: [] };
const provider: ProviderDefinition = {
  service: "mail",
  displayName: "Mail",
  categories: [],
  authTypes: ["api_key"],
  auth: [{ type: "api_key" }],
  actions: ["read", "send"].map((name) => ({
    id: `mail.${name}`,
    service: "mail",
    name,
    description: name,
    requiredScopes: [],
    execution: {
      locallyExecutable: true,
      catalogOnly: false,
      requiredAuthTypes: ["api_key"],
      noAuthRunnable: false,
      needsCredential: true,
    },
  })),
};
const token: RuntimeTokenSummary = {
  id: "app",
  name: "App",
  allowedActions: ["mail.read"],
  blockedActions: [],
  allowedProxies: [],
  allowedConnections: ["personal"],
  createdAt: "2026-10-21",
};
const data: AppData = {
  providers: [provider],
  connections: [{ id: "personal", service: "mail", authType: "api_key", metadata: {} }],
  oauthConfigs: [],
  runtimeTokens: [token],
  runtimePolicy: { deployment: rules, runtime: rules },
  runs: [],
};
describe("workspace access", () => {
  it("counts actions only when both the account and layered action policy permit them", () => {
    expect(allowedToolCount(provider, data, token)).toBe(1);
    expect(allowedToolCount(provider, data, { ...token, allowedConnections: ["other"] })).toBe(0);
    expect(
      allowedToolCount(
        provider,
        { ...data, runtimePolicy: { deployment: rules, runtime: { ...rules, blockedActions: ["mail.*"] } } },
        token,
      ),
    ).toBe(0);
  });
  it("fails closed if the runtime policy has not loaded", () => {
    expect(allowedToolCount(provider, { ...data, runtimePolicy: undefined }, token)).toBe(0);
  });
  it("allows public tools without inventing a credential grant", () => {
    const publicProvider = { ...provider, authTypes: ["no_auth"], auth: [{ type: "no_auth" as const }] };
    expect(allowedToolCount(publicProvider, { ...data, connections: [] }, token)).toBe(1);
  });
  it("does not flatten wildcard or direct-proxy permissions in the visual editor", () => {
    expect(supportsVisualEditing({ ...token, allowedActions: ["*"] })).toBe(false);
    expect(supportsVisualEditing({ ...token, allowedProxies: ["mail"] })).toBe(false);
    expect(supportsVisualEditing(token)).toBe(true);
  });
  it("never sends empty allowlists that the server would treat as unrestricted", () => {
    expect(grantSelectionError([], ["personal"])).toBe("actions");
    expect(grantSelectionError(["mail.read"], [])).toBe("accounts");
    expect(
      grantSelectionError(
        Array.from({ length: 129 }, (_, i) => `mail.${i}`),
        ["personal"],
      ),
    ).toBe("limit");
    expect(grantSelectionError(["mail.read"], ["personal"])).toBeUndefined();
  });
});
