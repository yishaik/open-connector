import type { ReportPeriod, ReportTimezone } from "../../core/report-period.ts";
import type { RunLogCaller } from "../storage/runtime-store.ts";

export interface UsageEvent {
  id: string;
  service: string;
  actionId: string;
  caller: RunLogCaller;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  ok: boolean;
  connectionId: string;
  runtimeTokenId: string;
  errorCode: string;
}

export interface UsageGroup {
  key: string;
  count: number;
  failed: number;
  avgDurationMs: number;
  firstAt: string | null;
  lastAt: string | null;
}

export interface UsageReportInput {
  date?: string;
  timezone?: ReportTimezone;
  service?: string;
  token?: string;
  offset?: number;
}

export interface UsageReport {
  generatedAt: string;
  period: ReportPeriod;
  totals: UsageGroup;
  previous: UsageGroup;
  hours: Array<{ hour: string; count: number; failed: number }>;
  services: UsageGroup[];
  tools: UsageGroup[];
  actors: UsageGroup[];
  connections: UsageGroup[];
  callers: UsageGroup[];
  events: UsageEvent[];
  nextOffset: number | null;
  coverage: { recordingStartedAt: string | null; earliestEventAt: string | null; latestEventAt: string | null };
}

export interface UsageReportSource {
  read(input: UsageReportInput): Promise<UsageReport>;
}
