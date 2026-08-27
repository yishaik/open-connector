import type { ConnectionRecord, PolicyRules, ProviderDefinition } from "./model";
import type { TokenGrantDraft, TokenGrantKind, TokenGrantService } from "./token-grant";
import type { ReactNode } from "react";

import { useTranslate } from "@embra/i18n/react";
import { useMemo, useState } from "react";
import {
  filterGrantServices,
  listGrantServices,
  tokenGrantDraftFromPolicy,
  tokenPolicyFromGrantDraft,
  toggleAccount,
  toggleAction,
  toggleKind,
  toggleService,
} from "./token-grant";

export interface TokenGrantChange {
  allowedActions: string[];
  blockedActions: string[];
  allowedProxies: string[];
  allowedConnections: string[];
}

interface TokenGrantEditorProps {
  providers: ProviderDefinition[];
  connections: ConnectionRecord[];
  policy: Pick<PolicyRules, "allowedActions" | "blockedActions" | "allowedProxies"> & {
    allowedConnections?: string[];
  };
  onChange(change: TokenGrantChange): void;
}

export function TokenGrantEditor(props: TokenGrantEditorProps): ReactNode {
  const t = useTranslate();
  const [query, setQuery] = useState("");
  const catalog = useMemo(
    () => listGrantServices(props.providers, props.connections).filter((service) => service.connected),
    [props.providers, props.connections],
  );
  const draft = useMemo(
    () => tokenGrantDraftFromPolicy(props.policy, catalog),
    [props.policy, catalog],
  );
  const filtered = useMemo(() => filterGrantServices(catalog, query), [catalog, query]);

  function emit(next: TokenGrantDraft): void {
    props.onChange(tokenPolicyFromGrantDraft(next, catalog));
  }

  if (catalog.length === 0) {
    return <p className="token-grant-empty">{t("access.grants.noConnectedServices")}</p>;
  }

  return (
    <div className="token-grant-editor">
      <p className="token-grant-lead">{t("access.grants.lead")}</p>
      <input
        className="token-grant-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("access.grants.search")}
        aria-label={t("access.grants.search")}
      />
      {filtered.map((service) => (
        <ServiceGrant
          key={service.service}
          service={service}
          draft={draft}
          onChange={emit}
        />
      ))}
    </div>
  );
}

function ServiceGrant(props: {
  service: TokenGrantService;
  draft: TokenGrantDraft;
  onChange(draft: TokenGrantDraft): void;
}): ReactNode {
  const t = useTranslate();
  const state = props.draft.services[props.service.service];
  const enabled = Boolean(state?.enabled);
  const grantedAccounts = props.service.accounts.filter((account) => state?.accounts[account.id]?.enabled);

  return (
    <section className="token-grant-service">
      <label className="token-grant-service-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => props.onChange(toggleService(props.draft, props.service, event.target.checked))}
        />
        <span>
          <strong>{props.service.displayName}</strong>
          <small>
            {enabled
              ? props.service.accounts.length > 1
                ? t("access.grants.accountCount", {
                    count: grantedAccounts.length,
                    total: props.service.accounts.length,
                  })
                : t("access.grants.actionCount", {
                    count: grantedAccounts[0] ? (state?.accounts[grantedAccounts[0].id]?.actionIds.length ?? 0) : 0,
                    total: props.service.actions.length,
                  })
              : t("access.grants.off")}
          </small>
        </span>
      </label>
      {enabled ? (
        <div className="token-grant-body">
          {props.service.accounts.length > 1 ? (
            <>
              <p className="token-grant-account-lead">{t("access.grants.accountLead")}</p>
              {props.service.accounts.map((account) => (
                <AccountGrant
                  key={account.id}
                  service={props.service}
                  accountId={account.id}
                  accountName={account.name}
                  draft={props.draft}
                  onChange={props.onChange}
                />
              ))}
            </>
          ) : (
            <AccountActions
              service={props.service}
              accountId={props.service.accounts[0]?.id}
              draft={props.draft}
              onChange={props.onChange}
            />
          )}
          <label className="token-grant-proxy">
            <input
              type="checkbox"
              checked={state?.proxy ?? false}
              onChange={(event) =>
                props.onChange({
                  services: {
                    ...props.draft.services,
                    [props.service.service]: { ...state!, proxy: event.target.checked },
                  },
                })
              }
            />
            <span>{t("access.grants.proxy")}</span>
          </label>
        </div>
      ) : null}
    </section>
  );
}

function AccountGrant(props: {
  service: TokenGrantService;
  accountId: string;
  accountName: string;
  draft: TokenGrantDraft;
  onChange(draft: TokenGrantDraft): void;
}): ReactNode {
  const t = useTranslate();
  const state = props.draft.services[props.service.service];
  const account = state?.accounts[props.accountId];
  const enabled = Boolean(account?.enabled);
  return (
    <section className="token-grant-account">
      <label className="token-grant-account-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => props.onChange(toggleAccount(props.draft, props.service, props.accountId, event.target.checked))}
        />
        <span>
          <strong>{props.accountName}</strong>
          <small>
            {enabled
              ? t("access.grants.actionCount", { count: account?.actionIds.length ?? 0, total: props.service.actions.length })
              : t("access.grants.off")}
          </small>
        </span>
      </label>
      {enabled ? (
        <AccountActions
          service={props.service}
          accountId={props.accountId}
          draft={props.draft}
          onChange={props.onChange}
        />
      ) : null}
    </section>
  );
}

function AccountActions(props: {
  service: TokenGrantService;
  accountId?: string;
  draft: TokenGrantDraft;
  onChange(draft: TokenGrantDraft): void;
}): ReactNode {
  const t = useTranslate();
  const state = props.draft.services[props.service.service];
  const selected = new Set(
    props.accountId ? (state?.accounts[props.accountId]?.actionIds ?? []) : Object.values(state?.accounts ?? {})[0]?.actionIds ?? [],
  );
  const reads = props.service.actions.filter((action) => action.kind === "read");
  const writes = props.service.actions.filter((action) => action.kind === "write");
  return (
    <>
      <ActionGroup
        title={t("access.grants.reads")}
        kind="read"
        actions={reads}
        selected={selected}
        draft={props.draft}
        service={props.service}
        accountId={props.accountId}
        onChange={props.onChange}
      />
      <ActionGroup
        title={t("access.grants.writes")}
        kind="write"
        actions={writes}
        selected={selected}
        draft={props.draft}
        service={props.service}
        accountId={props.accountId}
        onChange={props.onChange}
      />
    </>
  );
}

function ActionGroup(props: {
  title: string;
  kind: TokenGrantKind;
  actions: TokenGrantService["actions"];
  selected: Set<string>;
  draft: TokenGrantDraft;
  service: TokenGrantService;
  accountId?: string;
  onChange(draft: TokenGrantDraft): void;
}): ReactNode {
  const t = useTranslate();
  if (props.actions.length === 0) {
    return null;
  }
  const allOn = props.actions.every((action) => props.selected.has(action.id));
  return (
    <fieldset className="token-grant-actions">
      <legend>
        <label>
          <input
            type="checkbox"
            checked={allOn}
            onChange={(event) =>
              props.onChange(toggleKind(props.draft, props.service, props.kind, event.target.checked, props.accountId))
            }
          />
          <span>{props.title}</span>
        </label>
      </legend>
      {props.actions.map((action) => (
        <label key={action.id} title={action.description}>
          <input
            type="checkbox"
            checked={props.selected.has(action.id)}
            onChange={(event) =>
              props.onChange(toggleAction(props.draft, props.service, action.id, event.target.checked, props.accountId))
            }
          />
          <span>
            <code>{action.name}</code>
            <small>{action.description || t("access.grants.action")}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
