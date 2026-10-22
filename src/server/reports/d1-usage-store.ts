import type { D1DatabaseBinding, D1PreparedStatementBinding } from "../cloudflare/cloudflare-bindings.ts";
import type { RunLog } from "../storage/runtime-store.ts";
import type { UsageEvent, UsageGroup, UsageReport, UsageReportInput, UsageReportSource } from "./usage-types.ts";

import { reportDate, reportPeriod } from "../../core/report-period.ts";

/** Whitelist the durable audit fields; payloads and credential profiles never enter this archive. */
export function usageEventStatement(database: D1DatabaseBinding, run: RunLog): D1PreparedStatementBinding {
  return database
    .prepare(`insert into usage_events
    (id, service, action_id, caller, started_at, completed_at, duration_ms, ok, connection_id, runtime_token_id, error_code)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict(id) do nothing`)
    .bind(
      run.id,
      run.service,
      run.actionId,
      run.caller,
      run.startedAt,
      run.completedAt,
      run.durationMs,
      run.ok ? 1 : 0,
      run.connectionId ?? "",
      run.runtimeTokenId ?? "",
      run.errorCode ?? "",
    );
}

const aggregateColumns = `count(*) as count, coalesce(sum(case when ok = 0 then 1 else 0 end), 0) as failed,
  coalesce(avg(duration_ms), 0) as avgDurationMs, min(started_at) as firstAt, max(started_at) as lastAt`;

/** Private weekly aggregates with bounded event pagination. */
export class D1UsageReportStore implements UsageReportSource {
  private readonly database: D1DatabaseBinding;

  constructor(database: D1DatabaseBinding) {
    this.database = database;
  }

  async read(input: UsageReportInput): Promise<UsageReport> {
    const timezone = input.timezone ?? "Asia/Jerusalem";
    const period = reportPeriod(input.date ?? reportDate(new Date(), timezone), timezone);
    const clauses: string[] = [];
    const parameters: unknown[] = [];
    if (input.service) {
      clauses.push("service = ?");
      parameters.push(input.service);
    }
    if (input.token !== undefined) {
      clauses.push("runtime_token_id = ?");
      parameters.push(input.token);
    }
    const suffix = clauses.length ? " and " + clauses.join(" and ") : "";
    const where = "started_at >= ? and started_at < ?" + suffix;
    const values = [period.startsAt, period.endsAt, ...parameters];
    const aggregate = async (start: string, end: string): Promise<UsageGroup> => {
      const row = await this.database
        .prepare(`select '' as key, ${aggregateColumns} from usage_events where ${where}`)
        .bind(start, end, ...parameters)
        .first<UsageGroup>();
      return row!;
    };
    const group = async (column: string): Promise<UsageGroup[]> => {
      const { results } = await this.database
        .prepare(`select ${column} as key, ${aggregateColumns}
        from usage_events where ${where} group by ${column} order by count desc, key`)
        .bind(...values)
        .all<UsageGroup>();
      return results;
    };
    const offset = input.offset ?? 0;
    const [totals, previous, services, tools, actors, connections, callers, hours, events, coverage] =
      await Promise.all([
        aggregate(period.startsAt, period.endsAt),
        aggregate(period.previousStartsAt, period.startsAt),
        group("service"),
        group("action_id"),
        group("runtime_token_id"),
        group("connection_id"),
        group("caller"),
        this.database
          .prepare(`select substr(started_at, 1, 13) || ':00:00Z' as hour, count(*) as count,
        sum(case when ok = 0 then 1 else 0 end) as failed from usage_events where ${where} group by hour order by hour`)
          .bind(...values)
          .all<{ hour: string; count: number; failed: number }>(),
        this.database
          .prepare(`select id, service, action_id as actionId, caller, started_at as startedAt,
        completed_at as completedAt, duration_ms as durationMs, ok, connection_id as connectionId,
        runtime_token_id as runtimeTokenId, error_code as errorCode from usage_events where ${where}
        order by started_at desc, id desc limit 101 offset ?`)
          .bind(...values, offset)
          .all<UsageEvent>(),
        this.database
          .prepare(`select (select recording_started_at from usage_report_meta where id = 1) as recordingStartedAt,
        min(started_at) as earliestEventAt, max(started_at) as latestEventAt from usage_events`)
          .first<UsageReport["coverage"]>(),
      ]);
    return {
      generatedAt: new Date().toISOString(),
      period,
      totals,
      previous,
      services,
      tools,
      actors,
      connections,
      callers,
      hours: hours.results,
      events: events.results.slice(0, 100).map((event) => ({ ...event, ok: Boolean(event.ok) })),
      nextOffset: events.results.length > 100 ? offset + 100 : null,
      coverage: coverage ?? { recordingStartedAt: null, earliestEventAt: null, latestEventAt: null },
    };
  }
}
