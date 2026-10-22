import type { RunLog } from "../storage/runtime-store.ts";

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { D1RunLogStore } from "../storage/d1/runtime-store.ts";
import { SqliteD1Database } from "../storage/d1/test-database.ts";
import { D1UsageReportStore } from "./d1-usage-store.ts";

const schema = readFileSync(new URL("../../../deploy/reports/schema.sql", import.meta.url), "utf8");

function run(id: string, startedAt: string, extra: Partial<RunLog> = {}): RunLog {
  return {
    id,
    service: "github",
    actionId: "github.get_current_user",
    caller: "mcp",
    startedAt,
    completedAt: startedAt,
    durationMs: 120,
    ok: true,
    runtimeTokenId: "agent",
    connectionId: "github:default",
    inputSummary: { private: "payload must not enter the report" },
    ...extra,
  };
}

describe("durable weekly reports", () => {
  let db: SqliteD1Database;
  beforeEach(() => {
    db = new SqliteD1Database();
    db.exec(schema);
  });
  afterEach(() => db.close());

  it("survives recent-run retention, excludes payloads and counts exact week boundaries", async () => {
    const recent = new D1RunLogStore(db, 2, true);
    await recent.add(run("before", "2026-10-17T20:59:59.999Z"));
    await recent.add(run("first", "2026-10-17T21:00:00.000Z"));
    await recent.add(run("failure", "2026-10-20T10:00:00.000Z", { ok: false, errorCode: "provider_error" }));
    await recent.add(run("after", "2026-10-24T21:00:00.000Z"));
    expect((await recent.list()).items).toHaveLength(2);
    const report = await new D1UsageReportStore(db).read({ date: "2026-10-22" });
    expect(report.totals.count).toBe(2);
    expect(report.totals.failed).toBe(1);
    expect(report.previous.count).toBe(1);
    expect(report.events.map((event) => event.id)).toEqual(["failure", "first"]);
    expect(report.events[0]?.ok).toBe(false);
    expect(JSON.stringify(report)).not.toContain("payload must not enter");
    expect(report.actors[0]?.key).toBe("agent");
    await recent.add(run("first", "2026-10-17T21:00:00.000Z"));
    expect((await new D1UsageReportStore(db).read({ date: "2026-10-22" })).totals.count).toBe(2);
  });

  it("filters unattributed calls separately and treats SQL-like input literally", async () => {
    const recent = new D1RunLogStore(db, 10, true);
    await recent.add(run("a", "2026-10-20T10:00:00Z"));
    await recent.add(run("b", "2026-10-20T10:01:00Z", { runtimeTokenId: undefined }));
    const reports = new D1UsageReportStore(db);
    expect((await reports.read({ date: "2026-10-22", token: "" })).totals.count).toBe(1);
    expect((await reports.read({ date: "2026-10-22", token: "agent" })).totals.count).toBe(1);
    expect((await reports.read({ date: "2026-10-22", service: "' or 1=1 --" })).totals.count).toBe(0);
  });

  it("paginates metadata without capping the aggregate counts", async () => {
    const recent = new D1RunLogStore(db, 2, true);
    for (let index = 0; index < 104; index++)
      await recent.add(run(String(index).padStart(3, "0"), "2026-10-20T10:00:00.000Z"));
    const reports = new D1UsageReportStore(db);
    const first = await reports.read({ date: "2026-10-22" });
    const second = await reports.read({ date: "2026-10-22", offset: first.nextOffset! });
    expect(first.totals.count).toBe(104);
    expect(first.events).toHaveLength(100);
    expect(second.events).toHaveLength(4);
    expect(second.nextOffset).toBeNull();
    expect(new Set([...first.events, ...second.events].map((event) => event.id)).size).toBe(104);
  });

  it("backfills available historical runs and is safe to apply again", async () => {
    const recent = new D1RunLogStore(db, 10);
    await recent.add(run("legacy", "2026-10-20T10:00:00.000Z"));
    db.exec(schema);
    db.exec(schema);
    const report = await new D1UsageReportStore(db).read({ date: "2026-10-22" });
    expect(report.totals.count).toBe(1);
    expect(report.coverage.recordingStartedAt).toBeTruthy();
    expect(JSON.stringify(report)).not.toContain("payload must not enter");
  });
});
