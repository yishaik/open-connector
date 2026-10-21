import type { AppData, RuntimeTokenCreation, RuntimeTokenSummary } from "./model";
import type { ReactNode } from "react";

import { useTranslate } from "@embra/i18n/react";
import { ArrowRight, Check, Copy, KeyRound, Plus, Search, Settings2, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { apiPost, apiPut } from "./api";
import { isNoAuthOnlyProvider, usableConnectionsForService } from "./model";
import { evaluatePolicy } from "./policy";
import { isProviderLocallyAvailable } from "./providers-page";
import { ProviderIcon } from "./shared-ui";
import {
  allowedToolCount,
  grantSelectionError,
  permittedAccounts,
  supportsVisualEditing,
  workspacePolicyLayers,
} from "./workspace-access";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface WorkspacePageProps {
  data: AppData;
  onRefresh(): void;
}
interface GrantEditorProps extends WorkspacePageProps {
  token?: RuntimeTokenSummary;
  initialService?: string;
  onClose(): void;
}

export function WorkspacePage({ data, onRefresh }: WorkspacePageProps): ReactNode {
  const t = useTranslate();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("connected");
  const [clientId, setClientId] = useState("");
  const [focusedService, setFocusedService] = useState<string | undefined>();
  const [editing, setEditing] = useState<RuntimeTokenSummary | "new" | null>(null);
  const token =
    data.runtimeTokens.find((item) => item.id === clientId) ??
    data.runtimeTokens.find((item) => item.name.startsWith("open-webui")) ??
    data.runtimeTokens[0];
  const connected = useMemo(
    () =>
      data.providers.filter(
        (provider) =>
          usableConnectionsForService(data.connections, provider.service).length > 0 ||
          Boolean(token && isNoAuthOnlyProvider(provider) && allowedToolCount(provider, data, token)),
      ),
    [data, token],
  );
  const base = mode === "connected" ? connected : data.providers;
  const providers = base
    .filter((provider) =>
      `${provider.displayName} ${provider.service} ${provider.description ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .slice(0, 60);
  const total = token ? connected.reduce((count, provider) => count + allowedToolCount(provider, data, token), 0) : 0;
  return (
    <section className="workspace-page">
      <header className="workspace-heading">
        <div>
          <p className="workspace-eyebrow">OpenConnector</p>
          <h1>{t("workspace.title")}</h1>
          <p>{t("workspace.subtitle")}</p>
        </div>
        <Button
          onClick={() => {
            setMode("all");
            setQuery("");
          }}
        >
          <Plus size={16} />
          {t("workspace.addService")}
        </Button>
      </header>
      <div className="workspace-steps">
        <span>
          <b>1</b>
          {t("workspace.stepConnect")}
        </span>
        <ArrowRight size={16} />
        <span>
          <b>2</b>
          {t("workspace.stepChoose")}
        </span>
        <ArrowRight size={16} />
        <span>
          <b>3</b>
          {t("workspace.stepUse")}
        </span>
      </div>
      <div className="workspace-client">
        <div className="workspace-client-icon">
          <ShieldCheck size={24} />
        </div>
        <div className="workspace-client-main">
          <label htmlFor="workspace-client">{t("workspace.toolsFor")}</label>
          <select
            id="workspace-client"
            value={token?.id ?? ""}
            onChange={(event) => setClientId(event.target.value)}
            aria-label={t("workspace.toolsFor")}
          >
            <option value="" disabled>
              {t("workspace.chooseApp")}
            </option>
            {data.runtimeTokens.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <p>{token ? t("workspace.allowedSummary", { count: total }) : t("workspace.noApps")}</p>
        </div>
        <div className="workspace-client-actions">
          {token && (
            <Button
              variant="outline"
              onClick={() => {
                setFocusedService(undefined);
                setEditing(token);
              }}
            >
              <Settings2 size={15} />
              {t("workspace.chooseTools")}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setFocusedService(undefined);
              setEditing("new");
            }}
          >
            <KeyRound size={15} />
            {t("workspace.addApp")}
          </Button>
        </div>
      </div>
      <div className="workspace-toolbar">
        <div className="workspace-tabs" role="group" aria-label={t("workspace.serviceFilter")}>
          <Button
            variant={mode === "connected" ? "secondary" : "ghost"}
            aria-pressed={mode === "connected"}
            onClick={() => setMode("connected")}
          >
            {t("workspace.connected")} <span>{connected.length}</span>
          </Button>
          <Button
            variant={mode === "all" ? "secondary" : "ghost"}
            aria-pressed={mode === "all"}
            onClick={() => setMode("all")}
          >
            {t("workspace.allServices")}
          </Button>
        </div>
        <div className="workspace-search">
          <Search size={16} />
          <Input
            aria-label={t("workspace.searchServices")}
            placeholder={t("workspace.searchServices")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <div className="workspace-services">
        {providers.map((provider) => {
          const accounts = usableConnectionsForService(data.connections, provider.service);
          const requiresReconnect = accounts.some((account) => account.status === "reauth_required");
          const count = token ? allowedToolCount(provider, data, token) : 0;
          const publicService = isNoAuthOnlyProvider(provider);
          const available = isProviderLocallyAvailable(provider);
          const needsOAuthSetup =
            provider.authTypes.length > 0 &&
            provider.authTypes.every((type) => type === "oauth2") &&
            !data.oauthConfigs.some((config) => config.service === provider.service && config.configured);
          const ready = accounts.length > 0 || publicService;
          return (
            <article className="workspace-service" key={provider.service}>
              <div className="workspace-service-top">
                <ProviderIcon provider={provider} />
                <span className={accounts.length ? "workspace-status connected" : "workspace-status"}>
                  {t(
                    requiresReconnect
                      ? "workspace.reconnectRequired"
                      : !available
                        ? "workspace.unavailable"
                        : needsOAuthSetup && !accounts.length
                          ? "workspace.setupRequired"
                          : publicService
                            ? "workspace.publicService"
                            : accounts.length
                              ? "workspace.connectedLabel"
                              : "workspace.notConnected",
                  )}
                </span>
              </div>
              <h2>{provider.displayName}</h2>
              <p className="workspace-description">{provider.description ?? provider.service}</p>
              <div className="workspace-service-count">
                {publicService
                  ? t("workspace.publicTools", { count })
                  : accounts.length
                    ? t("workspace.accountsAndTools", { accounts: accounts.length, tools: count })
                    : t("workspace.connectToUse")}
              </div>
              {accounts.length && token && permittedAccounts(provider, data, token).length === 0 ? (
                <p className="workspace-explanation">{t("workspace.accountNotGranted")}</p>
              ) : null}
              {!available || (needsOAuthSetup && !accounts.length) ? (
                <p className="workspace-explanation">
                  {t(!available ? "workspace.unavailableHelp" : "workspace.oauthSetupHelp")}
                </p>
              ) : null}
              <div className="workspace-card-actions">
                <Button variant="outline" asChild>
                  <Link to={`/providers/${encodeURIComponent(provider.service)}`}>
                    {t(
                      !available
                        ? "workspace.viewService"
                        : needsOAuthSetup && !accounts.length
                          ? "workspace.setupConnection"
                          : publicService
                            ? "workspace.viewService"
                            : accounts.length
                              ? "workspace.manageAccount"
                              : "workspace.connect",
                    )}
                    <ArrowRight size={14} />
                  </Link>
                </Button>
                {ready && token && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setFocusedService(provider.service);
                      setEditing(token);
                    }}
                  >
                    {t("workspace.tools")}
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {providers.length === 0 && (
        <div className="workspace-empty">
          <h2>{t("workspace.emptyTitle")}</h2>
          <p>{t("workspace.emptyDescription")}</p>
          <Button
            onClick={() => {
              setMode("all");
              setQuery("");
            }}
          >
            {t("workspace.addService")}
          </Button>
        </div>
      )}
      {base.length > 60 && !query && <p className="workspace-hint">{t("workspace.searchMore")}</p>}
      <footer className="workspace-footer">
        <ShieldCheck size={16} />
        <span>{t("workspace.footer")}</span>
        <Link to="/access">{t("workspace.advanced")}</Link>
      </footer>
      {editing && (
        <GrantEditor
          data={data}
          onRefresh={onRefresh}
          token={editing === "new" ? undefined : editing}
          initialService={focusedService}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function GrantEditor({ data, token, initialService, onRefresh, onClose }: GrantEditorProps): ReactNode {
  const t = useTranslate();
  const [name, setName] = useState(token?.name ?? "");
  const [actions, setActions] = useState(token?.allowedActions ?? []);
  const [accounts, setAccounts] = useState(token?.allowedConnections ?? []);
  const [accountMode, setAccountMode] = useState(
    token?.allowedConnections.length ? "selected" : token ? "all" : "selected",
  );
  const [query, setQuery] = useState("");
  const connected = useMemo(
    () =>
      data.providers.filter(
        (provider) =>
          usableConnectionsForService(data.connections, provider.service).length > 0 || isNoAuthOnlyProvider(provider),
      ),
    [data],
  );
  const [service, setService] = useState(initialService ?? connected[0]?.service ?? "");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<RuntimeTokenCreation | null>(null);
  const [copied, setCopied] = useState(false);
  const provider = connected.find((item) => item.service === service);
  const editable = Boolean(data.runtimePolicy) && (!token || supportsVisualEditing(token));
  const connectionOptions = data.connections.filter(
    (connection) => connection.id && !connection.virtual && connection.configured !== false,
  );
  const policyToken = token ? { ...token, allowedActions: actions } : undefined;
  const visibleActions =
    provider?.actions.filter(
      (action) =>
        action.execution.locallyExecutable &&
        `${action.name} ${action.description} ${action.id}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const issue = grantSelectionError(actions, accountMode === "all" ? ["all"] : accounts);
  const changed =
    !token ||
    JSON.stringify([...actions].sort()) !== JSON.stringify([...token.allowedActions].sort()) ||
    accountMode !== (token.allowedConnections.length ? "selected" : "all") ||
    (accountMode === "selected" &&
      JSON.stringify([...accounts].sort()) !== JSON.stringify([...token.allowedConnections].sort()));
  const toggle = (values: string[], value: string): string[] =>
    values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  async function save(): Promise<void> {
    if (issue || !editable || !name.trim() || saving) return;
    setSaving(true);
    setStatus("");
    const body = {
      allowedActions: actions,
      blockedActions: token?.blockedActions ?? [],
      allowedProxies: token?.allowedProxies ?? [],
      allowedTriggers: token?.allowedTriggers ?? [],
      allowedConnections: accountMode === "all" ? [] : accounts,
    };
    try {
      if (token) {
        await apiPut(`/api/runtime-tokens/${encodeURIComponent(token.id)}`, body);
        onRefresh();
        onClose();
      } else {
        const result = await apiPost<RuntimeTokenCreation>("/api/runtime-tokens", { name: name.trim(), ...body });
        setCreated(result);
        onRefresh();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("workspace.saveFailed"));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="workspace-dialog">
        <DialogHeader>
          <DialogTitle>
            {created
              ? t("workspace.keyReady")
              : token
                ? t("workspace.editTitle", { name: token.name })
                : t("workspace.createTitle")}
          </DialogTitle>
          <DialogDescription>{t(created ? "workspace.keyHelp" : "workspace.editorHelp")}</DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="workspace-created">
            <label htmlFor="workspace-key">{t("workspace.privateKey")}</label>
            <Input id="workspace-key" value={created.token} readOnly type="password" />
            <Button
              onClick={() => {
                void navigator.clipboard
                  .writeText(created.token)
                  .then(() => setCopied(true))
                  .catch(() => setStatus(t("workspace.copyFailed")));
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />} {t(copied ? "workspace.copied" : "workspace.copyKey")}
            </Button>
            <p>
              {t("workspace.mcpUrl")} <code>{`${window.location.origin}/mcp`}</code>
            </p>
            {status && <p role="alert">{status}</p>}
            <Button variant="outline" onClick={onClose}>
              {t("workspace.done")}
            </Button>
          </div>
        ) : (
          <>
            <div className="workspace-editor-body">
              {!token && (
                <label className="workspace-field">
                  {t("workspace.appName")}
                  <Input
                    placeholder={t("workspace.appPlaceholder")}
                    value={name}
                    maxLength={120}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              )}
              {!editable && (
                <p className="workspace-notice">
                  {t("workspace.advancedPolicy")}{" "}
                  <Link to="/access" onClick={onClose}>
                    {t("workspace.advanced")}
                  </Link>
                </p>
              )}
              {editable && (
                <>
                  <div className="workspace-editor-summary">
                    <strong>{t("workspace.selectedTools", { count: actions.length })}</strong>
                    <span>{t("workspace.explicitOnly")}</span>
                  </div>
                  <details className="workspace-account-picker" open={accounts.length === 0 && accountMode !== "all"}>
                    <summary>
                      {t("workspace.accounts")} · {accountMode === "all" ? t("workspace.allAccounts") : accounts.length}
                    </summary>
                    <label className="workspace-check">
                      <input
                        type="checkbox"
                        checked={accountMode === "all"}
                        onChange={(event) => {
                          setAccountMode(event.target.checked ? "all" : "selected");
                        }}
                      />
                      {t("workspace.includeFutureAccounts")}
                    </label>
                    {accountMode !== "all" &&
                      connectionOptions.map((connection) => (
                        <label className="workspace-check" key={connection.id}>
                          <input
                            type="checkbox"
                            checked={accounts.includes(connection.id!)}
                            onChange={() => setAccounts(toggle(accounts, connection.id!))}
                          />
                          {data.providers.find((item) => item.service === connection.service)?.displayName ??
                            connection.service}{" "}
                          · {connection.connectionName ?? "default"}
                        </label>
                      ))}
                  </details>
                </>
              )}
              <div className="workspace-tool-filters">
                <label className="workspace-field">
                  {t("workspace.service")}
                  <select value={service} onChange={(event) => setService(event.target.value)}>
                    {connected.map((item) => (
                      <option key={item.service} value={item.service}>
                        {item.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <Input
                  aria-label={t("workspace.searchTools")}
                  placeholder={t("workspace.searchTools")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="workspace-tool-list">
                {visibleActions.map((action) => {
                  const baseAllowed = evaluatePolicy(action.id, "action", workspacePolicyLayers(data)).allowed;
                  const blocked =
                    token &&
                    !evaluatePolicy(
                      action.id,
                      "action",
                      workspacePolicyLayers(data, { ...token, allowedActions: [action.id] }),
                    ).allowed;
                  const checked = editable
                    ? actions.includes(action.id)
                    : policyToken
                      ? evaluatePolicy(action.id, "action", workspacePolicyLayers(data, policyToken)).allowed
                      : false;
                  return (
                    <label key={action.id} className="workspace-tool">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!editable || !baseAllowed || Boolean(blocked) || (!checked && actions.length >= 128)}
                        onChange={() => setActions(toggle(actions, action.id))}
                      />
                      <div>
                        <strong>{action.name}</strong>
                        <p>{action.description}</p>
                        {(!baseAllowed || blocked) && <small>{t("workspace.blockedPolicy")}</small>}
                      </div>
                    </label>
                  );
                })}
                {visibleActions.length === 0 && <p className="workspace-hint">{t("workspace.noTools")}</p>}
              </div>
            </div>
            <div className="workspace-editor-footer">
              <div>
                {status && <p role="alert">{status}</p>}
                {editable && issue && <p role="status">{t(`workspace.validation.${issue}`)}</p>}
              </div>
              <Button variant="outline" disabled={saving} onClick={onClose}>
                {t("workspace.cancel")}
              </Button>
              {editable && (
                <Button disabled={Boolean(issue) || !name.trim() || saving || !changed} onClick={() => void save()}>
                  {t(saving ? "workspace.saving" : token ? "workspace.save" : "workspace.createKey")}
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
