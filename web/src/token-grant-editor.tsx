import type { ConnectionRecord, PolicyRules, ProviderDefinition } from "./model";
import type { TokenGrantDraft, TokenGrantKind, TokenGrantService } from "./token-grant";
import type { ReactNode } from "react";

import { useTranslate } from "@embra/i18n/react";
import { useMemo } from "react";
import {
  listGrantServices,
  tokenGrantDraftFromPolicy,
  tokenPolicyFromGrantDraft,
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
  const catalog = useMemo(
    () => listGrantServices(props.providers, props.connections).filter((service) => service.connected),
    [props.providers, props.connections],
  );
  const draft = useMemo(
    () => tokenGrantDraftFromPolicy(props.policy, catalog),
    [props.policy, catalog],
  );

  function emit(next: TokenGrantDraft): void {
    props.onChange(tokenPolicyFromGrantDraft(next, catalog));
  }

  if (catalog.length === 0) {
    return <p className="token-grant-empty">{t("access.grants.noConnectedServices")}</p>;
  }

  return (
    <div className="token-grant-editor">
      <p className="token-grant-lead">{t("access.grants.lead")}</p>
      {catalog.map((service) => (
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
  const selected = new Set(state?.actionIds ?? []);
  const reads = props.service.actions.filter((action) => action.kind === "read");
  const writes = props.service.actions.filter((action) => action.kind === "write");

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
              ? t("access.grants.actionCount", { count: selected.size, total: props.service.actions.length })
              : t("access.grants.off")}
          </small>
        </span>
      </label>
      {enabled ? (
        <div className="token-grant-body">
          {props.service.accounts.length > 1 ? (
            <fieldset className="token-grant-accounts">
              <legend>{t("access.grants.accounts")}</legend>
              {props.service.accounts.map((account) => (
                <label key={account.id}>
                  <input
                    type="checkbox"
                    checked={state?.accountIds.includes(account.id) ?? false}
                    onChange={(event) => {
                      const ids = new Set(state?.accountIds ?? []);
                      if (event.target.checked) {
                        ids.add(account.id);
                      } else {
                        ids.delete(account.id);
                      }
                      props.onChange({
                        services: {
                          ...props.draft.services,
                          [props.service.service]: {
                            ...state!,
                            accountIds: [...ids],
                          },
                        },
                      });
                    }}
                  />
                  <span>{account.name}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <ActionGroup
            title={t("access.grants.reads")}
            kind="read"
            actions={reads}
            selected={selected}
            draft={props.draft}
            service={props.service}
            onChange={props.onChange}
          />
          <ActionGroup
            title={t("access.grants.writes")}
            kind="write"
            actions={writes}
            selected={selected}
            draft={props.draft}
            service={props.service}
            onChange={props.onChange}
          />
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

function ActionGroup(props: {
  title: string;
  kind: TokenGrantKind;
  actions: TokenGrantService["actions"];
  selected: Set<string>;
  draft: TokenGrantDraft;
  service: TokenGrantService;
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
            onChange={(event) => props.onChange(toggleKind(props.draft, props.service, props.kind, event.target.checked))}
          />
          <span>{props.title}</span>
        </label>
      </legend>
      {props.actions.map((action) => (
        <label key={action.id} title={action.description}>
          <input
            type="checkbox"
            checked={props.selected.has(action.id)}
            onChange={(event) => props.onChange(toggleAction(props.draft, props.service, action.id, event.target.checked))}
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
