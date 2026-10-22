export type ReportTimezone = "Asia/Jerusalem" | "UTC";

export interface ReportPeriod {
  week: string;
  nextWeek: string;
  startsAt: string;
  endsAt: string;
  previousStartsAt: string;
  timezone: ReportTimezone;
}

/** Calendar date in the selected reporting timezone. */
export function reportDate(value: Date, timezone: ReportTimezone): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (name: string): string => parts.find((item) => item.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function shiftReportDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function midnight(date: string, timezone: ReportTimezone): string {
  const target = Date.parse(`${date}T00:00:00Z`);
  let instant = target;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = formatter.formatToParts(new Date(instant));
    const part = (name: string): string => parts.find((item) => item.type === name)!.value;
    const represented = Date.parse(
      `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}Z`,
    );
    instant += target - represented;
  }
  return new Date(instant).toISOString();
}

/** Sunday-to-Sunday boundaries, calculated separately to respect daylight saving time. */
export function reportPeriod(date: string, timezone: ReportTimezone): ReportPeriod {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) ||
    new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date
  )
    throw new Error("Invalid calendar date");
  const week = shiftReportDate(date, -new Date(`${date}T12:00:00Z`).getUTCDay());
  const nextWeek = shiftReportDate(week, 7);
  return {
    week,
    nextWeek,
    startsAt: midnight(week, timezone),
    endsAt: midnight(nextWeek, timezone),
    previousStartsAt: midnight(shiftReportDate(week, -7), timezone),
    timezone,
  };
}
