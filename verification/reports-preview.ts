/** Loopback-only report API against a private database copy; never proxies writes. */
import type { D1DatabaseBinding, D1PreparedStatementBinding } from "../src/server/cloudflare/cloudflare-bindings.ts";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { DatabaseSync } from "node:sqlite";
import { createUsageReportRoutes } from "../src/server/api/usage-report-routes.ts";
import { D1UsageReportStore } from "../src/server/reports/d1-usage-store.ts";

const sqlite = new DatabaseSync("/home/ubuntu/.local/state/open-connector-reports-preview.sqlite", { readOnly: true });
function statement(sql: string, values: Array<string | number | null> = []): D1PreparedStatementBinding {
  return {
    bind: (...input: unknown[]) => statement(sql, input as Array<string | number | null>),
    first: async <T>() => (sqlite.prepare(sql).get(...values) as T | undefined) ?? null,
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...values) as T[] }),
    run: async () => {
      throw new Error("Read-only preview");
    },
  };
}
const database: D1DatabaseBinding = {
  prepare: statement,
  batch: async () => {
    throw new Error("Read-only preview");
  },
};
const app = new Hono();
app.route("/api", createUsageReportRoutes(new D1UsageReportStore(database)));
serve({ hostname: "127.0.0.1", port: 4184, fetch: app.fetch });
console.log("Read-only reports API on loopback port 4184");
