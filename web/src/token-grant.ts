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

export interface TokenGrantAccountState {
  enabled: boolean;
  allActions: boolean;
  actionIds: string[];
}

export interface TokenGrantServiceState {
  enabled: boolean;
  proxy: boolean;
  accounts: Record<string, TokenGrantAccountState>;
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

export function filterGrantServices(catalog: TokenGrantService[], query: string): TokenGrantService[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return catalog;
  }
  return catalog.filter(
    (service) =>
      service.displayName.toLowerCase().includes(needle) ||
      service.service.toLowerCase().includes(needle) ||
      service.accounts.some((account) => account.name.toLowerCase().includes(needle)),
  );
}

export function grantedActionIds(draft: TokenGrantDraft, service: string, accountId: string): string[] {
  return [...(draft.services[service]?.accounts[accountId]?.actionIds ?? [])].sort();
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
    const scoped: { connectionId: string; actionPattern: string }[] = [];
    const unscoped: string[] = [];
    for (const rule of allowed) {
      const parsed = parseScopedRule(rule);
      if (parsed.connectionId) {
        if (actionPatternMatchesService(parsed.actionPattern, service.service)) {
          scoped.push({ connectionId: parsed.connectionId, actionPattern: parsed.actionPattern });
        }
        continue;
      }
      if (rule === "*" || rule === service.service || rule === wildcard || rule.startsWith(`${service.service}.`)) {
        unscoped.push(rule);
      }
    }
    const enabled = allActions || unscoped.length > 0 || scoped.length > 0 || proxies.has(service.service);
    if (!enabled) {
      continue;
    }
    const unscopedAll = allActions || unscoped.includes("*") || unscoped.includes(wildcard) || unscoped.includes(service.service);
    const unscopedIds = unscopedAll
      ? service.actions.map((action) => action.id)
      : unscoped.filter((rule) => rule.includes(".") && !rule.endsWith(".*"));
    const accounts: Record<string, TokenGrantAccountState> = {};
    for (const account of service.accounts) {
      const grantedByConnectionList = connectionIds.length === 0 || connectionIds.includes(account.id);
      const accountScoped = scoped.filter((rule) => rule.connectionId === account.id);
      if (!grantedByConnectionList && accountScoped.length === 0) {
        continue;
      }
      const scopedAll = accountScoped.some((rule) => rule.actionPattern === "*" || rule.actionPattern === wildcard || rule.actionPattern === service.service);
      let actionIds = scopedAll
        ? service.actions.map((action) => action.id)
        : [
            ...unscopedIds,
            ...accountScoped.flatMap((rule) =>
              rule.actionPattern.endsWith(".*")
                ? service.actions.filter((action) => action.id.startsWith(rule.actionPattern.slice(0, -1))).map((action) => action.id)
                : [rule.actionPattern],
            ),
          ];
      actionIds = [...new Set(actionIds)].filter((id) => service.actions.some((action) => action.id === id));
      actionIds = actionIds.filter((id) => !blocked.some((rule) => ruleMatches(rule, id)));
      if (actionIds.length === 0 && accountScoped.length === 0 && !unscopedAll && unscopedIds.length === 0 && !proxies.has(service.service)) {
        continue;
      }
      accounts[account.id] = {
        enabled: true,
        allActions: service.actions.length > 0 && service.actions.every((action) => actionIds.includes(action.id)),
        actionIds,
      };
    }
    if (Object.keys(accounts).length === 0 && !proxies.has(service.service)) {
      continue;
    }
    draft.services[service.service] = {
      enabled: true,
      proxy: proxies.has(service.service) || proxies.has("*"),
      accounts,
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
    const enabledAccounts = service.accounts.filter((account) => state.accounts[account.id]?.enabled);
    for (const account of enabledAccounts) {
      if (!allowedConnections.includes(account.id)) {
        allowedConnections.push(account.id);
      }
    }
    if (enabledAccounts.length === 0) {
      continue;
    }
    const actionSets = enabledAccounts.map((account) => new Set(state.accounts[account.id]?.actionIds ?? []));
    const sameActions = actionSets.every((ids) => ids.size === actionSets[0].size && [...ids].every((id) => actionSets[0].has(id)));
    if (sameActions) {
      const selected = actionSets[0];
      const allSelected = service.actions.length > 0 && service.actions.every((action) => selected.has(action.id));
      if (allSelected) {
        allowedActions.push(`${service.service}.*`);
      } else {
        for (const action of service.actions) {
          if (selected.has(action.id)) {
            allowedActions.push(action.id);
          }
        }
      }
      continue;
    }
    for (const account of enabledAccounts) {
      const selected = new Set(state.accounts[account.id]?.actionIds ?? []);
      const allSelected = service.actions.length > 0 && service.actions.every((action) => selected.has(action.id));
      if (allSelected) {
        allowedActions.push(`${service.service}.*@${account.id}`);
        continue;
      }
      for (const action of service.actions) {
        if (selected.has(action.id)) {
          allowedActions.push(`${action.id}@${account.id}`);
        }
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
  const accounts: Record<string, TokenGrantAccountState> = {};
  for (const account of service.accounts) {
    accounts[account.id] = {
      enabled: true,
      allActions: true,
      actionIds: service.actions.map((action) => action.id),
    };
  }
  next[service.service] = { enabled: true, proxy: false, accounts };
  return { services: next };
}

export function toggleAccount(
  draft: TokenGrantDraft,
  service: TokenGrantService,
  accountId: string,
  enabled: boolean,
): TokenGrantDraft {
  const current = draft.services[service.service] ?? { enabled: true, proxy: false, accounts: {} };
  const accounts = { ...current.accounts };
  if (!enabled) {
    delete accounts[accountId];
    if (Object.keys(accounts).length === 0) {
      const next = { ...draft.services };
      delete next[service.service];
      return { services: next };
    }
    return {
      services: {
        ...draft.services,
        [service.service]: { ...current, enabled: true, accounts },
      },
    };
  }
  accounts[accountId] = {
    enabled: true,
    allActions: true,
    actionIds: service.actions.map((action) => action.id),
  };
  return {
    services: {
      ...draft.services,
      [service.service]: { ...current, enabled: true, accounts },
    },
  };
}

export function toggleAction(
  draft: TokenGrantDraft,
  service: TokenGrantService,
  actionId: string,
  checked: boolean,
  accountId?: string,
): TokenGrantDraft {
  const current = draft.services[service.service] ?? {
    enabled: true,
    proxy: false,
    accounts: Object.fromEntries(
      service.accounts.map((account) => [
        account.id,
        { enabled: true, allActions: false, actionIds: [] as string[] },
      ]),
    ),
  };
  const targetIds = accountId ? [accountId] : Object.keys(current.accounts).length > 0 ? Object.keys(current.accounts) : service.accounts.map((account) => account.id);
  const accounts = { ...current.accounts };
  for (const id of targetIds) {
    const existing = accounts[id] ?? {
      enabled: true,
      allActions: false,
      actionIds: [],
    };
    const ids = new Set(existing.actionIds);
    if (checked) {
      ids.add(actionId);
    } else {
      ids.delete(actionId);
    }
    accounts[id] = {
      enabled: true,
      allActions: service.actions.length > 0 && service.actions.every((action) => ids.has(action.id)),
      actionIds: [...ids],
    };
  }
  return {
    services: {
      ...draft.services,
      [service.service]: { ...current, enabled: true, accounts },
    },
  };
}

export function toggleKind(
  draft: TokenGrantDraft,
  service: TokenGrantService,
  kind: TokenGrantKind,
  checked: boolean,
  accountId?: string,
): TokenGrantDraft {
  const ids = service.actions.filter((action) => action.kind === kind).map((action) => action.id);
  let next = draft;
  for (const id of ids) {
    next = toggleAction(next, service, id, checked, accountId);
  }
  return next;
}

function parseScopedRule(rule: string): { actionPattern: string; connectionId?: string } {
  const at = rule.lastIndexOf("@");
  if (at <= 0) {
    return { actionPattern: rule };
  }
  const actionPattern = rule.slice(0, at);
  const connectionId = rule.slice(at + 1);
  if (!connectionId || (actionPattern !== "*" && !actionPattern.includes("."))) {
    return { actionPattern: rule };
  }
  return { actionPattern, connectionId };
}

function actionPatternMatchesService(actionPattern: string, service: string): boolean {
  return actionPattern === "*" || actionPattern === service || actionPattern === `${service}.*` || actionPattern.startsWith(`${service}.`);
}

function ruleMatches(rule: string, actionId: string): boolean {
  const { actionPattern } = parseScopedRule(rule);
  if (actionPattern === "*") {
    return true;
  }
  if (actionPattern.endsWith(".*")) {
    return actionId.startsWith(actionPattern.slice(0, -1));
  }
  return actionPattern === actionId;
}
