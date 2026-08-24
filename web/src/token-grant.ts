import type { ActionDefinition, ConnectionRecord, PolicyRules, ProviderDefinition } from "./model";

const WRITE_NAME =
  /(^|_)(send|create|update|delete|post|upload|insert|compose|draft|patch|put|remove|set|rate|add|write|reply|forward|trash|modify|replace)(_|$)/i;

export type TokenGrantKind = "read" | "write";

export interface TokenGrantAction {
  id: string;
  name: string;
  description: string;
  kind: TokenGrantKind;
}

export interface TokenGrantAccount {
  id: string;
  name: string;
}

export interface TokenGrantService {
  service: string;
  displayName: string;
  connected: boolean;
  accounts: TokenGrantAccount[];
  actions: TokenGrantAction[];
}

export interface TokenGrantServiceState {
  enabled: boolean;
  allActions: boolean;
  actionIds: string[];
  proxy: boolean;
  accountIds: string[];
}

export interface TokenGrantDraft {
  services: Record<string, TokenGrantServiceState>;
}

export interface TokenGrantPolicy {
  allowedActions: string[];
  blockedActions: string[];
  allowedProxies: string[];
  allowedConnections: string[];
}

export function actionGrantKind(action: Pick<ActionDefinition, "name" | "id">): TokenGrantKind {
  return WRITE_NAME.test(action.name) || WRITE_NAME.test(action.id.split(".")[1] ?? "") ? "write" : "read";
}

export function listGrantServices(
  providers: ProviderDefinition[],
  connections: ConnectionRecord[],
): TokenGrantService[] {
  const connected = new Map<string, TokenGrantAccount[]>();
  for (const connection of connections) {
    if (!connection.id || connection.virtual || connection.authType === "no_auth") {
      continue;
    }
    const accounts = connected.get(connection.service) ?? [];
    accounts.push({
      id: connection.id,
      name: connection.connectionName?.trim() || "default",
    });
    connected.set(connection.service, accounts);
  }

  return providers
    .filter((provider) => connected.has(provider.service) || provider.actions.length > 0)
    .map((provider) => ({
      service: provider.service,
      displayName: provider.displayName || provider.service,
      connected: connected.has(provider.service),
      accounts: connected.get(provider.service) ?? [],
      actions: provider.actions.map((action) => ({
        id: action.id,
        name: action.name,
        description: action.description,
        kind: actionGrantKind(action),
      })),
    }))
    .filter((service) => service.connected || service.actions.length > 0);
}

export function emptyTokenGrantDraft(): TokenGrantDraft {
  return { services: {} };
}

export function tokenGrantDraftFromPolicy(
  policy: Pick<PolicyRules, "allowedActions" | "blockedActions" | "allowedProxies"> & {
    allowedConnections?: string[];
  },
  catalog: TokenGrantService[],
): TokenGrantDraft {
  const allowed = policy.allowedActions ?? [];
  const blocked = policy.blockedActions ?? [];
  const proxies = new Set(policy.allowedProxies ?? []);
  const connectionIds = policy.allowedConnections ?? [];
  const allActions = allowed.includes("*");
  const draft: TokenGrantDraft = { services: {} };

  for (const service of catalog) {
    const wildcard = `${service.service}.*`;
    const explicit = allowed.filter((rule) => rule === service.service || rule.startsWith(`${service.service}.`));
    const enabled = allActions || explicit.length > 0;
    if (!enabled && !proxies.has(service.service)) {
      continue;
    }
    const useAll = allActions || explicit.includes(wildcard) || explicit.includes(service.service);
    let actionIds = useAll ? service.actions.map((action) => action.id) : explicit.filter((rule) => rule.includes(".") && !rule.endsWith(".*"));
    actionIds = actionIds.filter((id) => !blocked.some((rule) => ruleMatches(rule, id)));
    const accounts = service.accounts.map((account) => account.id);
    const selectedAccounts =
      connectionIds.length === 0 ? accounts : accounts.filter((id) => connectionIds.includes(id));
    draft.services[service.service] = {
      enabled: true,
      allActions: useAll && actionIds.length === service.actions.length,
      actionIds,
      proxy: proxies.has(service.service) || proxies.has("*"),
      accountIds: selectedAccounts,
    };
  }

  return draft;
}

export function tokenPolicyFromGrantDraft(draft: TokenGrantDraft, catalog: TokenGrantService[]): TokenGrantPolicy {
  const allowedActions: string[] = [];
  const allowedProxies: string[] = [];
  const allowedConnections: string[] = [];

  for (const service of catalog) {
    const state = draft.services[service.service];
    if (!state?.enabled) {
      continue;
    }
    if (state.proxy) {
      allowedProxies.push(service.service);
    }
    const selected = new Set(state.actionIds);
    const allSelected = service.actions.length > 0 && service.actions.every((action) => selected.has(action.id));
    if (state.allActions || allSelected) {
      allowedActions.push(`${service.service}.*`);
    } else {
      for (const id of state.actionIds) {
        if (id.startsWith(`${service.service}.`)) {
          allowedActions.push(id);
        }
      }
    }
    for (const accountId of state.accountIds) {
      if (!allowedConnections.includes(accountId)) {
        allowedConnections.push(accountId);
      }
    }
  }

  return {
    allowedActions,
    blockedActions: [],
    allowedProxies,
    allowedConnections,
  };
}

export function toggleService(draft: TokenGrantDraft, service: TokenGrantService, enabled: boolean): TokenGrantDraft {
  const next = { ...draft.services };
  if (!enabled) {
    delete next[service.service];
    return { services: next };
  }
  next[service.service] = {
    enabled: true,
    allActions: true,
    actionIds: service.actions.map((action) => action.id),
    proxy: false,
    accountIds: service.accounts.map((account) => account.id),
  };
  return { services: next };
}

export function toggleAction(draft: TokenGrantDraft, service: TokenGrantService, actionId: string, checked: boolean): TokenGrantDraft {
  const current = draft.services[service.service] ?? {
    enabled: true,
    allActions: false,
    actionIds: [],
    proxy: false,
    accountIds: service.accounts.map((account) => account.id),
  };
  const ids = new Set(current.actionIds);
  if (checked) {
    ids.add(actionId);
  } else {
    ids.delete(actionId);
  }
  const actionIds = [...ids];
  return {
    services: {
      ...draft.services,
      [service.service]: {
        ...current,
        enabled: true,
        allActions: service.actions.length > 0 && service.actions.every((action) => ids.has(action.id)),
        actionIds,
      },
    },
  };
}

export function toggleKind(draft: TokenGrantDraft, service: TokenGrantService, kind: TokenGrantKind, checked: boolean): TokenGrantDraft {
  const ids = service.actions.filter((action) => action.kind === kind).map((action) => action.id);
  let next = draft;
  for (const id of ids) {
    next = toggleAction(next, service, id, checked);
  }
  return next;
}

function ruleMatches(rule: string, actionId: string): boolean {
  if (rule === "*") {
    return true;
  }
  if (rule.endsWith(".*")) {
    return actionId.startsWith(rule.slice(0, -1));
  }
  return rule === actionId;
}
