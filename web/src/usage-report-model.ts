import type { UsageGroup, UsageReport } from "../../src/server/reports/usage-types";
import type { RuntimeTokenSummary } from "./model";

import { reportDate, shiftReportDate } from "../../src/core/report-period";

export function dailyUsage(
  report: UsageReport,
): Array<{ date: string; label: string; success: number; failed: number }> {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = shiftReportDate(report.period.week, index);
    return {
      date,
      label: new Intl.DateTimeFormat("he-IL", { weekday: "short" }).format(new Date(date + "T12:00:00Z")),
      success: 0,
      failed: 0,
    };
  });
  for (const hour of report.hours) {
    const day = days.find((item) => item.date === reportDate(new Date(hour.hour), report.period.timezone));
    if (day) {
      day.success += hour.count - hour.failed;
      day.failed += hour.failed;
    }
  }
  return days;
}

export function tokenUsageLabel(token: RuntimeTokenSummary, report: UsageReport, activity?: UsageGroup): string {
  if (activity && activity.count > 0) return "בוצעו פעולות";
  if (token.createdAt >= report.period.endsAt) return "נוצר אחרי השבוע הזה";
  if (token.lastUsedAt && token.lastUsedAt >= report.period.startsAt && token.lastUsedAt < report.period.endsAt)
    return "הזדהה · ללא פעולות בסינון";
  return token.lastUsedAt ? "ללא פעולות בסינון" : "טרם נרשמה הזדהות";
}

/** Escape spreadsheet formula prefixes as well as ordinary CSV quoting. */
export function reportCsv(rows: Array<Array<string | number>>): string {
  return (
    "\ufeff" +
    rows
      .map((row) =>
        row
          .map((value) => {
            const text = String(value);
            const safe = /^\s*[=+@-]/.test(text) ? "'" + text : text;
            return '"' + safe.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n")
  );
}
