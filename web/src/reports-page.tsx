import type { ReportTimezone } from "../../src/core/report-period";
import type { UsageEvent, UsageReport } from "../../src/server/reports/usage-types";
import type { AppData } from "./model";
import type { ReactNode } from "react";

import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Cable,
  Check,
  Clock3,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { reportDate, reportPeriod, shiftReportDate } from "../../src/core/report-period";
import { apiGet } from "./api";
import { ReportsCharts } from "./reports-charts";
import { reportCsv, tokenUsageLabel } from "./usage-report-model";

interface ReportsPageProps {
  data: AppData;
  onRefresh(): void;
}

const number = (value: number): string => value.toLocaleString("he-IL", { maximumFractionDigits: 1 });

function saveCsv(name: string, rows: Array<Array<string | number>>): void {
  const url = URL.createObjectURL(new Blob([reportCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReportsPage({ data, onRefresh }: ReportsPageProps): ReactNode {
  const [params, setParams] = useSearchParams();
  const timezone: ReportTimezone = params.get("timezone") === "UTC" ? "UTC" : "Asia/Jerusalem";
  const requestedWeek = params.get("week") ?? reportDate(new Date(), timezone);
  const week = useMemo(() => {
    try {
      return reportPeriod(requestedWeek, timezone).week;
    } catch {
      return reportPeriod(reportDate(new Date(), timezone), timezone).week;
    }
  }, [requestedWeek, timezone]);
  const service = params.get("service") ?? "";
  const token = params.get("token");
  const [report, setReport] = useState<UsageReport | null>(null);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [visibleEvents, setVisibleEvents] = useState(12);
  const [allTools, setAllTools] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [inventory, setInventory] = useState("keys");
  const [inventorySearch, setInventorySearch] = useState("");
  const [keyState, setKeyState] = useState("all");
  const generation = useRef(0);
  const providers = useMemo(
    () => new Map(data.providers.map((item) => [item.service, item.displayName])),
    [data.providers],
  );
  const tokenNames = useMemo(
    () => new Map(data.runtimeTokens.map((item) => [item.id, item.name])),
    [data.runtimeTokens],
  );
  const saved = useMemo(
    () => data.connections.filter((item) => !item.virtual && item.authType !== "no_auth" && item.configured !== false),
    [data.connections],
  );
  const connectionNames = useMemo(
    () =>
      new Map(
        saved.map((item) => [
          item.id ?? `${item.service}:${item.connectionName ?? "default"}`,
          typeof item.profile?.displayName === "string" ? item.profile.displayName : (item.connectionName ?? "default"),
        ]),
      ),
    [saved],
  );
  const serviceName = (id: string): string => providers.get(id) ?? id;
  const actorName = (id: string): string =>
    id ? (tokenNames.get(id) ?? `מפתח שהוסר או אינו מזוהה (${id})`) : "ללא שיוך למפתח אפליקציה";
  const time = (value: string | null | undefined): string =>
    value
      ? new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: timezone }).format(
          new Date(value),
        )
      : "לא נרשם";
  const path = useMemo(() => {
    const query = new URLSearchParams({ week, timezone });
    if (service) query.set("service", service);
    if (token !== null) query.set("token", token);
    return "/api/reports/weekly?" + query.toString();
  }, [week, timezone, service, token]);

  useEffect(() => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    setEventError(null);
    setReport(null);
    setEvents([]);
    setNextOffset(null);
    setMoreLoading(false);
    setVisibleEvents(12);
    setAllTools(false);
    void apiGet<UsageReport>(path)
      .then((value) => {
        if (generation.current !== current) return;
        setReport(value);
        setEvents(value.events);
        setNextOffset(value.nextOffset);
      })
      .catch((caught: unknown) => {
        if (generation.current === current) setError(caught instanceof Error ? caught.message : "הדוח לא נטען");
      })
      .finally(() => {
        if (generation.current === current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [path, refresh]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        setRefresh((value) => value + 1);
        onRefresh();
      }
    }, 300_000);
    return () => clearInterval(timer);
  }, [onRefresh]);

  function update(values: Record<string, string | null>): void {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(values)) {
        if (value === null || (key !== "token" && value === "")) next.delete(key);
        else next.set(key, value);
      }
      return next;
    });
  }

  async function loadMore(): Promise<void> {
    if (moreLoading || nextOffset === null) return;
    const current = generation.current;
    setMoreLoading(true);
    setEventError(null);
    try {
      const result = await apiGet<UsageReport>(path + `&offset=${nextOffset}`);
      if (generation.current === current) {
        setEvents((old) => {
          const seen = new Set(old.map((item) => item.id));
          return [...old, ...result.events.filter((item) => !seen.has(item.id))];
        });
        setNextOffset(result.nextOffset);
        setVisibleEvents((count) => count + 12);
      }
    } catch (caught) {
      if (generation.current === current)
        setEventError(caught instanceof Error ? caught.message : "טעינת פעולות נוספות נכשלה");
    } finally {
      if (generation.current === current) setMoreLoading(false);
    }
  }

  const actorGroups = new Map(report?.actors.map((item) => [item.key, item]));
  const connectionGroups = new Map(report?.connections.map((item) => [item.key, item]));
  const tools = report?.tools ?? [];
  const currentUsed = data.runtimeTokens.filter((item) => (actorGroups.get(item.id)?.count ?? 0) > 0).length;
  const relevantTokens = data.runtimeTokens.filter((item) => !report || item.createdAt < report.period.endsAt);
  const idleKeys = relevantTokens.filter((item) => !actorGroups.get(item.id)?.count).length;
  const currentWeek = reportPeriod(reportDate(new Date(), timezone), timezone).week;
  const isCurrent = week === currentWeek;
  const keyword = inventorySearch.trim().toLowerCase();
  const filteredKeys = data.runtimeTokens.filter(
    (item) =>
      `${item.name} ${item.id}`.toLowerCase().includes(keyword) &&
      (keyState === "all" ||
        (keyState === "used" ? Boolean(actorGroups.get(item.id)?.count) : !actorGroups.get(item.id)?.count)),
  );
  const filteredConnections = saved.filter((item) =>
    `${serviceName(item.service)} ${item.connectionName} ${connectionNames.get(item.id ?? "")}`
      .toLowerCase()
      .includes(keyword),
  );

  return (
    <div className="reports-page" dir="rtl" lang="he">
      <section className="report-hero">
        <div className="report-hero-top">
          <span className="report-live">
            <i /> OPEN CONNECTOR · INSIGHTS
          </span>
          <span className="report-private">
            <ShieldCheck size={14} /> דוח פרטי
          </span>
        </div>
        <div className="report-hero-body">
          <div>
            <p className="report-hero-eyebrow">התמונה המלאה של החיבורים שלך</p>
            <h1>
              שבוע אחד.
              <br />
              <em>כל מה שקרה.</em>
            </h1>
            <p>השירותים, המפתחות והכלים שלך — עם מספרים שאפשר להבין, ופעילות שאפשר לבדוק.</p>
          </div>
          <div className="report-hero-mark" aria-hidden="true">
            <Activity size={68} strokeWidth={1.1} />
            <span>
              WEEKLY
              <br />
              ACTIVITY REPORT
            </span>
          </div>
        </div>
        <div className="report-hero-foot">
          <span>
            <Clock3 size={14} /> {report ? `עודכן ${time(report.generatedAt)}` : "נתונים חיים מיומן הפעילות"}
          </span>
          <span>מתעדכן כל 5 דקות כשהדף פתוח</span>
        </div>
      </section>

      <section className="report-toolbar" aria-label="בחירת שבוע וסינון">
        <div className="report-week-picker">
          <button type="button" aria-label="השבוע הקודם" onClick={() => update({ week: shiftReportDate(week, -7) })}>
            <ArrowRight size={18} />
          </button>
          <label>
            <span>שבוע שמתחיל ביום ראשון</span>
            <input
              aria-label="תאריך בשבוע הדוח"
              type="date"
              value={week}
              onChange={(event) => {
                if (event.target.value) update({ week: event.target.value });
              }}
            />
          </label>
          <button
            type="button"
            aria-label="השבוע הבא"
            disabled={week >= currentWeek}
            onClick={() => update({ week: shiftReportDate(week, 7) })}
          >
            <ArrowLeft size={18} />
          </button>
        </div>
        <label className="report-control">
          <span>אזור זמן</span>
          <select value={timezone} onChange={(event) => update({ timezone: event.target.value })}>
            <option value="Asia/Jerusalem">שעון ישראל</option>
            <option value="UTC">UTC</option>
          </select>
        </label>
        <label className="report-control">
          <span>שירות</span>
          <select value={service} onChange={(event) => update({ service: event.target.value })}>
            <option value="">כל השירותים</option>
            {[
              ...new Set([
                ...saved.map((item) => item.service),
                ...(report?.services.map((item) => item.key) ?? []),
                ...(service ? [service] : []),
              ]),
            ]
              .sort()
              .map((id) => (
                <option value={id} key={id}>
                  {serviceName(id)}
                </option>
              ))}
          </select>
        </label>
        <label className="report-control">
          <span>אפליקציה / מפתח</span>
          <select
            value={token ?? "__all__"}
            onChange={(event) => update({ token: event.target.value === "__all__" ? null : event.target.value })}
          >
            <option value="__all__">כל האפליקציות</option>
            <option value="">ללא שיוך למפתח</option>
            {[
              ...new Set([
                ...data.runtimeTokens.map((item) => item.id),
                ...(report?.actors.map((item) => item.key).filter(Boolean) ?? []),
                ...(token ? [token] : []),
              ]),
            ].map((id) => (
              <option value={id} key={id}>
                {actorName(id)}
              </option>
            ))}
          </select>
        </label>
        <div className="report-toolbar-actions">
          <button type="button" title="השבוע הנוכחי" onClick={() => update({ week: null, service: null, token: null })}>
            השבוע
          </button>
          <button
            type="button"
            aria-label="רענון הדוח"
            disabled={loading}
            onClick={() => {
              setRefresh((value) => value + 1);
              onRefresh();
            }}
          >
            <RefreshCw size={17} className={loading ? "spin" : ""} />
          </button>
        </div>
      </section>
      {(service || token !== null) && (
        <div className="report-filter-note">
          הפעולות מסוננות לפי {service ? serviceName(service) : "כל השירותים"} ·{" "}
          {token !== null ? actorName(token) : "כל האפליקציות"}
          <button type="button" onClick={() => update({ service: null, token: null })}>
            <X size={13} />
            ניקוי סינון
          </button>
        </div>
      )}
      {error && (
        <div className="report-error" role="alert">
          <strong>לא הצלחנו לטעון את הדוח.</strong>
          <p>{error}</p>
          <button type="button" onClick={() => setRefresh((value) => value + 1)}>
            ניסיון נוסף
          </button>
        </div>
      )}
      {loading && (
        <div className="report-loading" role="status">
          <RefreshCw size={24} className="spin" />
          <span>מכינים את הדוח שלך…</span>
        </div>
      )}
      {report && (
        <>
          <div className="report-period-line">
            <h2>
              {new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long" }).format(
                new Date(week + "T12:00:00Z"),
              )}{" "}
              —{" "}
              {new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long", year: "numeric" }).format(
                new Date(shiftReportDate(week, 6) + "T12:00:00Z"),
              )}
            </h2>
            <span className={isCurrent ? "report-chip" : "report-chip report-chip-neutral"}>
              {isCurrent ? "השבוע בעיצומו" : week > currentWeek ? "שבוע עתידי" : "דוח היסטורי"}
            </span>
          </div>
          <div className="report-metrics">
            <Metric
              icon={<Activity size={19} />}
              label="פעולות שנרשמו"
              value={number(report.totals.count)}
              detail={`${number(report.previous.count)} בכל השבוע הקודם${isCurrent ? " · השבוע הנוכחי חלקי" : ""}`}
            />
            <Metric
              icon={<Check size={19} />}
              label="שיעור הצלחה"
              value={
                report.totals.count
                  ? `${number(((report.totals.count - report.totals.failed) / report.totals.count) * 100)}%`
                  : "—"
              }
              detail={`${number(report.totals.failed)} פעולות נכשלו מתוך ${number(report.totals.count)}`}
            />
            <Metric
              icon={<KeyRound size={19} />}
              label="מפתחות עם פעולות"
              value={number(currentUsed)}
              detail={`${idleKeys} מפתחות קיימים ללא פעולות בסינון`}
            />
            <Metric
              icon={<Cable size={19} />}
              label="שירותים עם פעילות"
              value={number(report.services.length)}
              detail={`${new Set(saved.map((item) => item.service)).size} שירותים מחוברים כיום · ${saved.length} חשבונות`}
            />
          </div>

          <div className="report-insight">
            <Sparkles size={21} />
            <div>
              <strong>מה בולט השבוע?</strong>
              <p>
                {report.totals.count ? (
                  <>
                    {serviceName(report.services[0]!.key)} מוביל עם {number(report.services[0]!.count)} פעולות (
                    {number((report.services[0]!.count / report.totals.count) * 100)}%).{" "}
                    {report.totals.failed
                      ? `${number(report.totals.failed)} פעולות נכשלו — אפשר לבדוק את קודי השגיאה ביומן המפורט.`
                      : "כל הפעולות המתועדות הסתיימו בהצלחה."}{" "}
                    זמן הפעולה הממוצע: {number(report.totals.avgDurationMs / 1000)} שניות.
                  </>
                ) : (
                  "לא נרשמו פעולות בשבוע ובסינון הנוכחיים. החיבורים והמפתחות מוצגים לפי מצבם כיום; אין בכך הוכחה שלא שימשו מחוץ לתיעוד."
                )}
              </p>
            </div>
          </div>
          <ReportsCharts report={report} serviceName={serviceName} onService={(id) => update({ service: id })} />

          <section className="report-panel" id="inventory">
            <div className="report-section-title">
              <div>
                <span className="report-kicker">מלאי ושימוש</span>
                <h2>מה מחובר, ומה באמת עובד</h2>
              </div>
              <span className="report-muted">המלאי נוכחי · הפעילות לפי השבוע</span>
            </div>
            <div className="report-inventory-tools">
              <div className="report-tabs" role="tablist" aria-label="סוג מלאי">
                <button role="tab" aria-selected={inventory === "keys"} onClick={() => setInventory("keys")}>
                  מפתחות גישה <b>{data.runtimeTokens.length}</b>
                </button>
                <button
                  role="tab"
                  aria-selected={inventory === "connections"}
                  onClick={() => setInventory("connections")}
                >
                  חשבונות מחוברים <b>{saved.length}</b>
                </button>
              </div>
              <input
                type="search"
                aria-label="חיפוש במלאי"
                placeholder="חיפוש לפי שם…"
                value={inventorySearch}
                onChange={(event) => setInventorySearch(event.target.value)}
              />
              {inventory === "keys" && (
                <select
                  aria-label="מצב שימוש במפתח"
                  value={keyState}
                  onChange={(event) => setKeyState(event.target.value)}
                >
                  <option value="all">כל המפתחות</option>
                  <option value="used">עם פעולות</option>
                  <option value="unused">ללא פעולות בסינון</option>
                </select>
              )}
            </div>
            {inventory === "keys" ? (
              <>
                <p className="report-caption">
                  מפתחות גישה מזהים אפליקציה או סוכן. “הזדהות אחרונה” כוללת גם גילוי כלים ובקשות מידע, ואינה בהכרח הפעלת
                  כלי. ערכי המפתחות אינם מוצגים.
                </p>
                <div className="report-record-list">
                  {filteredKeys.map((item) => {
                    const usage = actorGroups.get(item.id);
                    return (
                      <article className="report-inventory-row" key={item.id}>
                        <div className="report-record-name">
                          <span className="report-record-icon">
                            <KeyRound size={18} />
                          </span>
                          <div>
                            <strong>
                              <bdi>{item.name}</bdi>
                            </strong>
                            <small>
                              <bdi>{item.id}</bdi>
                            </small>
                          </div>
                        </div>
                        <span className={usage?.count ? "report-chip" : "report-chip report-chip-neutral"}>
                          {tokenUsageLabel(item, report, usage)}
                        </span>
                        <div className="report-record-stat">
                          <strong>{number(usage?.count ?? 0)}</strong>
                          <small>פעולות בסינון</small>
                        </div>
                        <div className="report-record-time">
                          <small>פעולה אחרונה בשבוע</small>
                          <bdi>{time(usage?.lastAt)}</bdi>
                          <small>
                            הזדהות אחרונה בכלל: <bdi>{time(item.lastUsedAt)}</bdi>
                          </small>
                        </div>
                        <button type="button" className="report-link" onClick={() => update({ token: item.id })}>
                          לפעילות ←
                        </button>
                      </article>
                    );
                  })}
                  {!filteredKeys.length && <p className="report-empty">אין מפתחות התואמים לחיפוש ולמצב שבחרת.</p>}
                </div>
                {report.actors
                  .filter((item) => !item.key || !tokenNames.has(item.key))
                  .map((item) => (
                    <p className="report-caption" key={item.key}>
                      {actorName(item.key)}: {number(item.count)} פעולות. אין להן שיוך למפתח קיים ברשימה.
                    </p>
                  ))}
              </>
            ) : (
              <>
                <p className="report-caption">
                  אלו חשבונות השירות השמורים כיום, כולל חיבורי OAuth ומפתחות API של ספקים. הספירה מתארת פעולות שעברו דרך
                  Open Connector בלבד.
                </p>
                <div className="report-record-list">
                  {filteredConnections.map((item) => {
                    const usage = connectionGroups.get(item.id ?? "");
                    return (
                      <article className="report-inventory-row" key={item.id ?? item.service + item.connectionName}>
                        <div className="report-record-name">
                          <span className="report-record-icon">
                            <Cable size={18} />
                          </span>
                          <div>
                            <strong>
                              <bdi>{serviceName(item.service)}</bdi>
                            </strong>
                            <small>
                              <bdi>{connectionNames.get(item.id ?? "") ?? item.connectionName}</bdi>
                            </small>
                          </div>
                        </div>
                        <span
                          className={
                            item.status === "reauth_required"
                              ? "report-chip report-chip-error"
                              : usage?.count
                                ? "report-chip"
                                : "report-chip report-chip-neutral"
                          }
                        >
                          {item.status === "reauth_required"
                            ? "נדרשת התחברות מחדש"
                            : usage?.count
                              ? "עם פעילות השבוע"
                              : "ללא פעולות בסינון"}
                        </span>
                        <div className="report-record-stat">
                          <strong>{number(usage?.count ?? 0)}</strong>
                          <small>פעולות בסינון</small>
                        </div>
                        <div className="report-record-time">
                          <small>פעולה אחרונה בשבוע</small>
                          <bdi>{time(usage?.lastAt)}</bdi>
                          <small>
                            <bdi>{item.authType}</bdi>
                          </small>
                        </div>
                        <button type="button" className="report-link" onClick={() => update({ service: item.service })}>
                          לשירות ←
                        </button>
                      </article>
                    );
                  })}
                  {!filteredConnections.length && <p className="report-empty">אין חשבונות התואמים לחיפוש.</p>}
                </div>
              </>
            )}
          </section>

          <section className="report-panel">
            <div className="report-section-title">
              <div>
                <span className="report-kicker">הכלים בפעולה</span>
                <h2>אילו כלים הופעלו, וכמה</h2>
              </div>
              <button
                type="button"
                className="report-export"
                onClick={() =>
                  saveCsv(`openconnector-tools-${week}.csv`, [
                    ["כלי", "פעולות", "כשלונות", "ממוצע במילישניות", "פעולה ראשונה", "פעולה אחרונה"],
                    ...tools.map((item) => [
                      item.key,
                      item.count,
                      item.failed,
                      item.avgDurationMs,
                      item.firstAt ?? "",
                      item.lastAt ?? "",
                    ]),
                  ])
                }
              >
                <ArrowDownToLine size={15} />
                ייצוא כלים
              </button>
            </div>
            <div className="report-tool-grid">
              {(allTools ? tools : tools.slice(0, 6)).map((item) => (
                <article className="report-tool" key={item.key}>
                  <div>
                    <code dir="ltr">{item.key}</code>
                    <span>{serviceName(item.key.split(".")[0]!)}</span>
                  </div>
                  <strong>
                    {number(item.count)}
                    <small>פעולות</small>
                  </strong>
                  <div className="report-tool-meta">
                    <span>{item.failed ? `${item.failed} כשלונות` : "ללא כשלונות"}</span>
                    <span>{number(item.avgDurationMs / 1000)} שנ׳ בממוצע</span>
                  </div>
                  <p>
                    אחרונה: <bdi>{time(item.lastAt)}</bdi>
                  </p>
                </article>
              ))}
              {!tools.length && <p className="report-empty">לא נרשמו הפעלות כלים בשבוע הזה.</p>}
            </div>
            {tools.length > 6 && (
              <div className="report-event-footer report-tools-footer">
                <span>{tools.length} כלים שונים בשבוע ובסינון הנבחרים</span>
                <button type="button" aria-expanded={allTools} onClick={() => setAllTools((value) => !value)}>
                  {allTools ? "צמצום הרשימה" : `הצגת כל ${tools.length} הכלים`}
                </button>
              </div>
            )}
          </section>

          <section className="report-panel" id="report-events">
            <div className="report-section-title">
              <div>
                <span className="report-kicker">עקבות הפעילות</span>
                <h2>מי הפעיל מה, ומתי</h2>
              </div>
              <button
                type="button"
                className="report-export"
                disabled={!events.length}
                onClick={() =>
                  saveCsv(`openconnector-events-${week}.csv`, [
                    [
                      "זמן UTC",
                      "כלי",
                      "אפליקציה",
                      "מזהה מפתח",
                      "חשבון",
                      "פרוטוקול",
                      "תוצאה",
                      "משך במילישניות",
                      "קוד שגיאה",
                    ],
                    ...events.map((item) => [
                      item.startedAt,
                      item.actionId,
                      actorName(item.runtimeTokenId),
                      item.runtimeTokenId,
                      connectionNames.get(item.connectionId) ?? item.connectionId,
                      item.caller,
                      item.ok ? "הצלחה" : "כשלון",
                      item.durationMs,
                      item.errorCode,
                    ]),
                  ])
                }
              >
                <ArrowDownToLine size={15} />
                ייצוא {events.length} הפעולות שנטענו
              </button>
            </div>
            <p className="report-caption">
              השיוך הוא לאפליקציה או למפתח הגישה שנרשמו בבקשה. המערכת אינה מזהה אדם מאחורי מפתח משותף. זמני התצוגה לפי{" "}
              {timezone === "UTC" ? "UTC" : "שעון ישראל"}; הייצוא כולל זמן UTC.
            </p>
            <div className="report-event-list">
              {events.slice(0, visibleEvents).map((item) => (
                <article className="report-event" key={item.id}>
                  <div className={item.ok ? "report-event-status" : "report-event-status report-event-error"}>
                    {item.ok ? <Check size={16} /> : <X size={16} />}
                  </div>
                  <div className="report-event-main">
                    <code dir="ltr">{item.actionId}</code>
                    <div>
                      <bdi>{actorName(item.runtimeTokenId)}</bdi>
                      <span>←</span>
                      <bdi>{connectionNames.get(item.connectionId) ?? (item.connectionId || "לא נרשם חשבון")}</bdi>
                    </div>
                    {item.errorCode && (
                      <small className="report-error-code">
                        <bdi>{item.errorCode}</bdi>
                      </small>
                    )}
                  </div>
                  <div className="report-event-time">
                    <time dateTime={item.startedAt}>{time(item.startedAt)}</time>
                    <span>
                      <bdi>{item.caller.toUpperCase()}</bdi> · {number(item.durationMs / 1000)} שנ׳ ·{" "}
                      {item.ok ? "הצלחה" : "כשלון"}
                    </span>
                  </div>
                </article>
              ))}
              {!events.length && <p className="report-empty">אין פעולות התואמות לתקופה ולסינון.</p>}
            </div>
            <div className="report-event-footer">
              <span>
                מוצגות {number(Math.min(visibleEvents, events.length))} מתוך {number(report.totals.count)} פעולות
              </span>
              {visibleEvents < events.length ? (
                <button type="button" onClick={() => setVisibleEvents((count) => count + 12)}>
                  הצגת פעולות נוספות
                </button>
              ) : (
                nextOffset !== null && (
                  <button type="button" disabled={moreLoading} onClick={() => void loadMore()}>
                    {moreLoading ? "טוענים…" : "טעינת 100 הפעולות הבאות"}
                  </button>
                )
              )}
            </div>
            {eventError && (
              <p role="alert" className="report-error-code">
                {eventError} — אפשר לנסות לטעון שוב.
              </p>
            )}
          </section>

          <section className="report-methodology">
            <ShieldCheck size={22} />
            <div>
              <h2>איך לקרוא את הדוח</h2>
              <ul>
                <li>
                  הדוח מתעדכן אוטומטית בכל שבוע, מיום ראשון בחצות עד יום ראשון הבא, באזור הזמן שנבחר. אפשר לחזור לשבועות
                  קודמים.
                </li>
                <li>
                  “פעולה” היא ניסיון הפעלת כלי שתועד ביומן, כולל כשלונות. בקשות גילוי כלים, שימוש ב־proxy ופעילות ישירה
                  אצל הספק אינם נספרים כאן.
                </li>
                <li>
                  אפס פעולות אינו מוכיח שמפתח לא שימש מעולם. זמן ההזדהות האחרון הוא נתון נוכחי; הוא אינו יומן הזדהויות
                  היסטורי.
                </li>
                <li>
                  המלאי ושמות האפליקציות והחשבונות מוצגים לפי ההגדרות כיום. חשבון או מפתח שנמחקו עדיין יכולים להופיע
                  בהיסטוריית הפעולות עם המזהה שלהם.
                </li>
                <li>
                  תיעוד פעולות זמין החל מ־<bdi>{time(report.coverage.earliestEventAt)}</bdi>. איסוף ההיסטוריה הנפרדת החל
                  ב־<bdi>{time(report.coverage.recordingStartedAt)}</bdi>, עם השלמת הפעולות שעוד נשמרו ביומן. ייתכנו
                  פערים מוקדמים יותר; אין שחזור של רשומות שנמחקו.
                </li>
                <li>
                  נשמרים לצורך הדוח זמני שימוש ומזהי כלים, מפתחות וחשבונות. ערכי מפתחות, סיסמאות ותוכן הבקשות והתשובות
                  אינם נכללים בדוח.
                </li>
              </ul>
            </div>
          </section>
          <footer className="report-page-footer">
            <span>OPEN CONNECTOR / WEEKLY REPORT</span>
            <span>נתונים אמיתיים. שיוך מפורש. תמונה ברורה.</span>
          </footer>
        </>
      )}
    </div>
  );
}

interface MetricProps {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}
function Metric({ icon, label, value, detail }: MetricProps): ReactNode {
  return (
    <article className="report-metric">
      <div>
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}
