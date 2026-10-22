import type { UsageReportSource } from "../reports/usage-types.ts";

import { Hono } from "hono";
import { reportPeriod } from "../../core/report-period.ts";
import { jsonError } from "./http-utils.ts";

/** Mounted under /api, after the existing administrator authentication middleware. */
export function createUsageReportRoutes(source: UsageReportSource): Hono {
  const app = new Hono();
  app.get("/reports/weekly", async (context) => {
    const timezone = context.req.query("timezone") ?? "Asia/Jerusalem";
    const date = context.req.query("week");
    const offset = Number(context.req.query("offset") ?? "0");
    if (
      (timezone !== "Asia/Jerusalem" && timezone !== "UTC") ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 1_000_000
    )
      return jsonError(context, 400, "invalid_input", "Invalid timezone or event offset.");
    try {
      if (date !== undefined) reportPeriod(date, timezone);
    } catch {
      return jsonError(context, 400, "invalid_input", "Use a valid calendar date in YYYY-MM-DD format.");
    }
    const service = context.req.query("service");
    const token = context.req.query("token");
    if ((service?.length ?? 0) > 256 || (token?.length ?? 0) > 256)
      return jsonError(context, 400, "invalid_input", "Filter is too long.");
    return context.json(await source.read({ date, timezone, service, token, offset }));
  });
  return app;
}
