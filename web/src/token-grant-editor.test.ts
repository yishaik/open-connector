import type { ConnectionRecord, ProviderDefinition } from "./model";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TokenGrantEditor } from "./token-grant-editor";

vi.mock("@embra/i18n/react", () => ({
  useTranslate() {
    return (key: string, values?: Record<string, string | number>) =>
      values === undefined ? key : `${key} ${Object.values(values).join(" ")}`;
  },
}));

const gmailId = "11111111-1111-4111-8111-111111111111";
const telegramOpsId = "cc9ff1ab-08f6-45d6-975d-46c8ecc19d38";
const telegramBridgeId = "6568c3f0-79fd-410f-8aa9-4eabfc0add89";
const githubDefaultId = "33333333-3333-4333-8333-333333333333";
const githubWorkId = "44444444-4444-4444-8444-444444444444";
const youtubeId = "22222222-2222-4222-8222-222222222222";

const exec = {
  locallyExecutable: true,
  catalogOnly: false,
  requiredAuthTypes: ["oauth2"],
  noAuthRunnable: false,
  needsCredential: true,
};

function provider(service: string, displayName: string, names: string[]): ProviderDefinition {
  return {
    service,
    displayName,
    categories: [],
    authTypes: ["oauth2"],
    auth: [],
    actions: names.map((name) => ({
      id: `${service}.${name}`,
      service,
      name,
      description: name,
      requiredScopes: [],
      execution: exec,
    })),
  };
}

function connection(id: string, service: string, connectionName: string): ConnectionRecord {
  return { id, service, connectionName, authType: "oauth2", metadata: {} };
}

const providers: ProviderDefinition[] = [
  provider("gmail", "Gmail", ["fetch_emails", "create_draft", "send_email"]),
  provider("telegram", "Telegram", ["get_me", "send_message"]),
  provider("github", "GitHub", ["list_repos", "create_issue"]),
  provider("youtube", "YouTube", ["search"]),
  provider("mx_toolbox", "MxToolbox", ["lookup_mx"]),
];

const connections: ConnectionRecord[] = [
  connection(gmailId, "gmail", "default"),
  connection(telegramOpsId, "telegram", "ops"),
  connection(telegramBridgeId, "telegram", "bridge"),
  connection(githubDefaultId, "github", "default"),
  connection(githubWorkId, "github", "persona-lab"),
  connection(youtubeId, "youtube", "default"),
  connection("55555555-5555-4555-8555-555555555555", "mx_toolbox", "MxToolbox-theyishaik"),
];

function render(policy: {
  allowedActions: string[];
  blockedActions?: string[];
  allowedProxies?: string[];
  allowedConnections?: string[];
}): string {
  return renderToStaticMarkup(
    createElement(TokenGrantEditor, {
      providers,
      connections,
      policy: {
        allowedActions: policy.allowedActions,
        blockedActions: policy.blockedActions ?? [],
        allowedProxies: policy.allowedProxies ?? [],
        allowedConnections: policy.allowedConnections,
      },
      onChange: vi.fn(),
    }),
  );
}

describe("TokenGrantEditor", () => {
  it("explains the grant model and offers a search box so a service is easy to find", () => {
    const markup = render({ allowedActions: [] });
    expect(markup).toContain("access.grants.lead");
    expect(markup).toContain("access.grants.search");
    expect(markup).toContain('type="search"');
    expect(markup).toContain("token-grant-search");
    expect(markup).toContain("Gmail");
    expect(markup).toContain("Telegram");
    expect(markup).toContain("GitHub");
    expect(markup).toContain("YouTube");
    expect(markup).toContain("MxToolbox");
  });

  it("tells the user to connect a provider first when nothing is connected", () => {
    const markup = renderToStaticMarkup(
      createElement(TokenGrantEditor, {
        providers,
        connections: [],
        policy: { allowedActions: [], blockedActions: [], allowedProxies: [] },
        onChange: vi.fn(),
      }),
    );
    expect(markup).toContain("access.grants.noConnectedServices");
    expect(markup).not.toContain("token-grant-search");
  });

  it("keeps a single Gmail account flat so read/draft/send are one click away", () => {
    const markup = render({
      allowedActions: ["gmail.fetch_emails"],
      allowedConnections: [gmailId],
    });
    expect(markup).toContain("fetch_emails");
    expect(markup).toContain("create_draft");
    expect(markup).toContain("send_email");
    expect(markup).not.toContain("access.grants.accountLead");
    expect(markup).not.toContain("token-grant-account");
  });

  it("nests Telegram accounts so ops and bridge can have different actions", () => {
    const markup = render({
      allowedActions: [`telegram.*@${telegramOpsId}`, `telegram.get_me@${telegramBridgeId}`],
      allowedConnections: [telegramOpsId, telegramBridgeId],
    });
    expect(markup).toContain("access.grants.accountLead");
    expect(markup).toContain("ops");
    expect(markup).toContain("bridge");
    expect(markup).toContain("token-grant-account");
    expect(markup).toContain("get_me");
    expect(markup).toContain("send_message");
  });

  it("shows GitHub default and persona-lab as separate account grants", () => {
    const markup = render({
      allowedActions: ["github.*"],
      allowedConnections: [githubDefaultId, githubWorkId],
    });
    expect(markup).toContain("persona-lab");
    expect(markup).toContain("default");
    expect(markup).toContain("access.grants.accountLead");
  });

  it("does not show action checklists until the service is granted", () => {
    const markup = render({ allowedActions: [] });
    expect(markup).toContain("access.grants.off");
    expect(markup).not.toContain("fetch_emails");
    expect(markup).not.toContain("send_message");
  });

  it("shows a wildcard key with every connected service already granted", () => {
    const markup = render({ allowedActions: ["*"], allowedConnections: [] });
    expect(markup).toContain("fetch_emails");
    expect(markup).toContain("ops");
    expect(markup).toContain("bridge");
    expect(markup).toContain("persona-lab");
    expect(markup).toContain("search");
  });
});
