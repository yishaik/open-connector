import type { UsageReport } from "../../src/server/reports/usage-types";
import type { RuntimeTokenSummary } from "./model";

import { describe, expect, it } from "vitest";
import { reportPeriod } from "../../src/core/report-period";
import { dailyUsage, reportCsv, tokenUsageLabel } from "./usage-report-model";

describe("weekly report presentation", () => {
  const report = {
    period: reportPeriod("2026-10-22", "Asia/Jerusalem"),
    hours: [
      { hour: "2026-10-17T22:00:00Z", count: 3, failed: 1 },
      { hour: "2026-10-18T10:00:00Z", count: 2, failed: 0 },
    ],
  } as UsageReport;
  it("groups hours by the selected timezone and fills empty calendar days", () => {
    const days = dailyUsage(report);
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ date: "2026-10-18", success: 4, failed: 1 });
    expect(days[1]?.success).toBe(0);
  });
  it("does not equate authentication with a tool execution or claim never-used", () => {
    const token = { createdAt: "2026-10-01T00:00:00Z", lastUsedAt: "2026-10-20T00:00:00Z" } as RuntimeTokenSummary;
    expect(tokenUsageLabel(token, report)).toBe("הזדהה · ללא פעולות בסינון");
    expect(tokenUsageLabel({ ...token, createdAt: "2026-10-30T00:00:00Z" }, report)).toBe("נוצר אחרי השבוע הזה");
    expect(tokenUsageLabel({ ...token, lastUsedAt: undefined }, report)).toBe("טרם נרשמה הזדהות");
  });
  it("exports quoted CSV and neutralizes spreadsheet formulas", () => {
    const result = reportCsv([["=SUM(A1)", 'a"b', "hello,world", "@command", 3]]);
    expect(result).toContain('"\'=SUM(A1)"');
    expect(result).toContain('"a""b"');
    expect(result).toContain('"\'@command"');
    expect(result.startsWith("\ufeff")).toBe(true);
  });
});
