import type { UsageReportSource } from "../reports/usage-types.ts";

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createLocalAuthMiddleware } from "./auth.ts";
import { createUsageReportRoutes } from "./usage-report-routes.ts";

function fixture(): { app: Hono; read: ReturnType<typeof vi.fn> } {
  const read = vi.fn().mockResolvedValue({ events: [] });
  const source: UsageReportSource = { read };
  const app = new Hono();
  app.use("*", createLocalAuthMiddleware({ adminToken: "admin-secret", runtimeToken: "runtime-secret" }));
  app.route("/api", createUsageReportRoutes(source));
  return { app, read };
}

describe("weekly report admin API", () => {
  it("denies runtime keys and anonymous requests, allows the existing admin session", async () => {
    const { app, read } = fixture();
    expect((await app.request("/api/reports/weekly")).status).toBe(401);
    expect(
      (await app.request("/api/reports/weekly", { headers: { authorization: "Bearer runtime-secret" } })).status,
    ).toBe(401);
    expect(read).not.toHaveBeenCalled();
    expect(
      (
        await app.request("/api/reports/weekly?week=2026-10-22&token=", {
          headers: { authorization: "Bearer admin-secret" },
        })
      ).status,
    ).toBe(200);
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ date: "2026-10-22", token: "", timezone: "Asia/Jerusalem" }),
    );
  });
  it.each(["week=2026-02-30", "offset=-1", "offset=1.5", "offset=NaN", "timezone=Europe/Paris"])(
    "rejects %s before querying data",
    async (query) => {
      const { app, read } = fixture();
      expect(
        (await app.request("/api/reports/weekly?" + query, { headers: { authorization: "Bearer admin-secret" } }))
          .status,
      ).toBe(400);
      expect(read).not.toHaveBeenCalled();
    },
  );
});
