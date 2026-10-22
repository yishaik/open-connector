-- Reporting metadata is independent of recent-run retention. No input/output or secrets are copied.
create table if not exists usage_events (
  id text primary key,
  service text not null,
  action_id text not null,
  caller text not null,
  started_at text not null,
  completed_at text not null,
  duration_ms real not null,
  ok integer not null,
  connection_id text not null default '',
  runtime_token_id text not null default '',
  error_code text not null default ''
);
create index if not exists usage_events_time on usage_events (started_at, id);
create index if not exists usage_events_service_time on usage_events (service, started_at);
create index if not exists usage_events_token_time on usage_events (runtime_token_id, started_at);
create table if not exists usage_report_meta (id integer primary key check (id = 1), recording_started_at text not null);
insert or ignore into usage_report_meta values (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
insert or ignore into usage_events
select id, service, action_id, caller, started_at, completed_at,
  coalesce(json_extract(value, '$.durationMs'), 0), ok,
  coalesce(json_extract(value, '$.connectionId'), ''),
  coalesce(json_extract(value, '$.runtimeTokenId'), ''),
  coalesce(json_extract(value, '$.errorCode'), '')
from runs;
