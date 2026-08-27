import type { RunLog } from "./model";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { RunsPage, runFiltersFromSearchParams, runListPath, runServiceOptions } from "./runs-page";

vi.mock("@embra/i18n/react", () => ({
  useTranslate() {
    return (key: string) => key;
  },
}));

describe("runServiceOptions", () => {
  it("returns services in first-seen order with counts", () => {
    expect(
      runServiceOptions([
        run("hackernews-1", "news.get_best_stories", "hackernews"),
        run("gmail-1", "mail.search_threads", "gmail"),
        run("hackernews-2", "news.get_top_stories", "hackernews"),
        run("gmail-1", "mail.search_threads", "gmail"),
      ]),
    ).toEqual([
      { service: "hackernews", count: 2 },
      { service: "gmail", count: 1 },
    ]);
  });
});

describe("runListPath", () => {
  it("adds the selected service to run API requests", () => {
    expect(runListPath({ filters: filters({ service: "gmail" }) })).toBe("/api/runs?limit=50&service=gmail");
  });

  it("keeps all filters while paginating", () => {
    expect(
      runListPath({
        cursor: "next cursor",
        filters: filters({
          service: "gmail",
          actionId: "gmail.search_threads",
          caller: "mcp",
          ok: false,
          runtimeTokenId: "token-1",
        }),
      }),
    ).toBe(
      "/api/runs?limit=50&cursor=next+cursor&service=gmail&actionId=gmail.search_threads&caller=mcp&ok=false&runtimeTokenId=token-1",
    );
  });
});

describe("runFiltersFromSearchParams", () => {
  it("reads structured filters from the URL query", () => {
    expect(
      runFiltersFromSearchParams(
        new URLSearchParams("service=hackernews&actionId=hackernews.get_item&caller=mcp&ok=false&runtimeTokenId=token-1"),
      ),
    ).toEqual({
      service: "hackernews",
      actionId: "hackernews.get_item",
      caller: "mcp",
      ok: false,
      runtimeTokenId: "token-1",
    });
  });
});

describe("RunsPage", () => {
  it("keeps filters visible when no runs match", () => {
    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(RunsPage, { initialRuns: [] })),
    );

    expect(markup).toContain("run-action-filter");
    expect(markup).toContain("runs.noRunsTitle");
  });

  it("renders seven audit columns and connection context", () => {
    const auditRun = {
      ...run("execution-1", "gmail.search_threads", "gmail"),
      connectionProfile: { displayName: "Finance workspace" },
      outputSummary: { threadCount: 2 },
    };
    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(RunsPage, { initialRuns: [auditRun] })),
    );

    for (const heading of ["action", "context", "key", "status", "timing", "input", "result"]) {
      expect(markup).toContain(`runs.table.${heading}`);
    }
    const headings = ["timing", "key", "status", "action", "context", "input", "result"].map((heading) =>
      markup.indexOf(`runs.table.${heading}`),
    );
    expect(headings).toEqual([...headings].sort((left, right) => left - right));
    expect(markup).toContain("Finance workspace");
    expect(markup).toContain("threadCount");
    expect(markup).toContain("execution-1");
  });

  it("offers inline expansion for long successful results", () => {
    const auditRun = {
      ...run("execution-long", "hackernews.get_latest_posts", "hackernews"),
      outputSummary: { hits: Array.from({ length: 20 }, (_, index) => ({ id: index, title: `Story ${index}` })) },
    };
    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(RunsPage, { initialRuns: [auditRun] })),
    );

    expect(markup).toContain('aria-label="runs.expandResult"');
    expect(markup).toContain('aria-expanded="false"');
  });

  it("renders both the stable error code and safe error message", () => {
    const failedRun = {
      ...run("execution-2", "gmail.search_threads", "gmail"),
      ok: false,
      errorCode: "rate_limited",
      errorMessage: "The provider rate limit was reached.",
    };
    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(RunsPage, { initialRuns: [failedRun] })),
    );

    expect(markup).toContain("rate_limited");
    expect(markup).toContain("The provider rate limit was reached.");
  });

  it("shows the key name, caller origin, and policy outcome", () => {
    const auditRun: RunLog = {
      ...run("execution-policy", "github.delete_repository", "github"),
      ok: false,
      runtimeTokenId: "token-1",
      runtimeTokenName: "grok-mcp",
      request: { ip: "203.0.113.10", country: "IL", userAgent: "Cursor/1.0" },
      policy: {
        allowed: false,
        checks: [{ source: "token", outcome: "block_match", rule: "github.delete_repository" }],
      },
    };
    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(RunsPage, { initialRuns: [auditRun] })),
    );

    expect(markup).toContain("grok-mcp");
    expect(markup).toContain("runs.from");
    expect(markup).toContain("203.0.113.10");
    expect(markup).toContain("IL");
    expect(markup).toContain("Cursor/1.0");
    expect(markup).toContain("runs.policyBlocked");
    expect(markup).toContain("access.policy.sources.token: github.delete_repository");
    expect(markup).toContain("runs.table.key");
  });
});

function filters(input: Partial<ReturnType<typeof runFiltersFromSearchParams>> = {}) {
  return { service: null, actionId: "", caller: null, ok: null, runtimeTokenId: null, ...input };
}

function run(id: string, actionId: string, service: string): RunLog {
  return {
    id,
    service,
    actionId,
    caller: "http",
    startedAt: "2026-07-06T09:00:00.000Z",
    completedAt: "2026-07-06T09:00:00.727Z",
    durationMs: 727,
    ok: true,
    inputSummary: {},
  };
}
