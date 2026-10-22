import { describe, expect, it } from "vitest";
import { reportDate, reportPeriod } from "./report-period.ts";

describe("weekly reporting calendar", () => {
  it("uses Sunday midnight in Israel and a separate offset for the DST end", () => {
    const period = reportPeriod("2026-10-22", "Asia/Jerusalem");
    expect(period.week).toBe("2026-10-18");
    expect(period.startsAt).toBe("2026-10-17T21:00:00.000Z");
    expect(period.endsAt).toBe("2026-10-24T21:00:00.000Z");
    const transition = reportPeriod("2026-10-26", "Asia/Jerusalem");
    expect(transition.startsAt).toBe("2026-10-24T21:00:00.000Z");
    expect(transition.endsAt).toBe("2026-10-31T22:00:00.000Z");
    expect((Date.parse(transition.endsAt) - Date.parse(transition.startsAt)) / 3600000).toBe(169);
  });
  it("uses the local calendar date when UTC is on the previous day", () => {
    expect(reportDate(new Date("2026-10-17T22:00:00Z"), "Asia/Jerusalem")).toBe("2026-10-18");
    expect(reportPeriod("2026-10-22", "UTC").startsAt).toBe("2026-10-18T00:00:00.000Z");
  });
  it.each(["2026-02-30", "2026-13-01", "today", "2026-2-1"])("rejects invalid date %s", (date) => {
    expect(() => reportPeriod(date, "UTC")).toThrow();
  });
});
