import type { UsageGroup, UsageReport } from "../../src/server/reports/usage-types";
import type { ReactNode } from "react";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dailyUsage } from "./usage-report-model";

interface ReportsChartsProps {
  report: UsageReport;
  serviceName(service: string): string;
  onService(service: string): void;
}

export function ReportsCharts({ report, serviceName, onService }: ReportsChartsProps): ReactNode {
  const top = report.services.slice(0, 6);
  return (
    <div className="report-chart-grid">
      <section className="report-panel">
        <div className="report-section-title">
          <div>
            <span className="report-kicker">קצב הפעילות</span>
            <h2>השבוע, יום אחרי יום</h2>
          </div>
          <span className="report-muted">{report.period.timezone === "UTC" ? "UTC" : "שעון ישראל"}</span>
        </div>
        <div className="report-legend">
          <span>
            <i className="report-dot" />
            הצלחות
          </span>
          <span>
            <i className="report-dot report-dot-error" />
            כשלונות
          </span>
        </div>
        <div className="report-chart" dir="ltr" role="img" aria-label="גרף פעולות יומי: הצלחות וכשלונות">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyUsage(report)} barSize={25} margin={{ top: 12, left: -20, right: 10 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  borderColor: "var(--border)",
                  borderRadius: 12,
                  direction: "rtl",
                }}
              />
              <Bar dataKey="success" name="הצלחות" stackId="day" fill="#159b83" radius={[0, 0, 3, 3]} />
              <Bar dataKey="failed" name="כשלונות" stackId="day" fill="#ec8572" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="report-caption">
          {report.totals.count
            ? "כל עמודה מציגה את מספר הפעולות שנרשמו באותו יום. גם ניסיונות שנכשלו נספרים."
            : "לא נרשמו פעולות בשבוע ובסינון שבחרת. אפשר לעבור לשבוע אחר או לנקות סינון."}
        </p>
      </section>
      <section className="report-panel">
        <div className="report-section-title">
          <div>
            <span className="report-kicker">מפת השירותים</span>
            <h2>איפה הפעילות מתרכזת</h2>
          </div>
          <span className="report-muted">לחיצה מסננת</span>
        </div>
        <div className="report-service-bars">
          {top.map((item: UsageGroup, index: number) => (
            <button type="button" key={item.key} className="report-service-bar" onClick={() => onService(item.key)}>
              <span className="report-bar-title">
                <span>
                  <small>{String(index + 1).padStart(2, "0")}</small>
                  <bdi>{serviceName(item.key)}</bdi>
                </span>
                <strong>{item.count.toLocaleString("he-IL")}</strong>
              </span>
              <span className="report-track">
                <i style={{ width: `${Math.max(2, (item.count / (top[0]?.count || 1)) * 100)}%` }} />
              </span>
            </button>
          ))}
          {!top.length && <p className="report-empty">אין פעילות להצגה בשבוע הזה.</p>}
        </div>
        <p className="report-caption">ששת השירותים הפעילים ביותר. הרשימה המלאה נמצאת בטבלת החיבורים ובפירוט הכלים.</p>
      </section>
    </div>
  );
}
