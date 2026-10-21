import type { AppData, ConnectionRecord, ProviderDefinition, RuntimeTokenSummary } from "./model";
import type { PolicyLayer } from "./policy";

import { isNoAuthOnlyProvider, usableConnectionsForService } from "./model";
import { evaluatePolicy, policyLayers } from "./policy";

/** Actions and accounts must both be granted; discovery alone is not permission. */
export function permittedAccounts(
  provider: ProviderDefinition,
  data: AppData,
  token: RuntimeTokenSummary,
): ConnectionRecord[] {
  return usableConnectionsForService(data.connections, provider.service).filter(
    (connection) =>
      connection.status !== "reauth_required" &&
      (connection.authType === "no_auth" ||
        token.allowedConnections.length === 0 ||
        Boolean(connection.id && token.allowedConnections.includes(connection.id))),
  );
}

export function allowedToolCount(provider: ProviderDefinition, data: AppData, token: RuntimeTokenSummary): number {
  if (!isNoAuthOnlyProvider(provider) && permittedAccounts(provider, data, token).length === 0) return 0;
  return provider.actions.filter(
    (action) =>
      action.execution.locallyExecutable &&
      evaluatePolicy(action.id, "action", workspacePolicyLayers(data, token)).allowed,
  ).length;
}

/** A visual editor must never silently expand wildcard policies into a new policy. */
export function supportsVisualEditing(token: RuntimeTokenSummary): boolean {
  return (
    token.allowedProxies.length === 0 &&
    token.allowedActions.length > 0 &&
    token.allowedActions.every((rule) => !rule.includes("*"))
  );
}

export function grantSelectionError(
  actions: string[],
  accounts: string[],
): "actions" | "accounts" | "limit" | undefined {
  // Empty action/account allowlists mean unrestricted access in the runtime API.
  if (actions.length === 0) return "actions";
  if (accounts.length === 0) return "accounts";
  if (actions.length > 128 || accounts.length > 128) return "limit";
  return undefined;
}

/** Missing policy data must fail closed, including during a failed refresh. */
export function workspacePolicyLayers(data: AppData, token?: RuntimeTokenSummary): PolicyLayer[] {
  if (data.runtimePolicy) return policyLayers(data.runtimePolicy, token);
  return [
    {
      source: "runtime",
      rules: { allowedActions: [], blockedActions: ["*"], allowedProxies: [], blockedProxies: ["*"] },
    },
  ];
}
