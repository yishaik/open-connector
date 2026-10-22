# Weekly usage reports

Private report UI: `https://connect.yishaik.com/reports`.

Reports are computed from durable action metadata when requested. Each week is
Sunday-to-Sunday in Israel time by default, with UTC available. Past weeks stay
queryable; no browser needs to be open when an action is recorded. A visible
report refreshes every five minutes, along with the current connection/key
inventory. This does not send email or messages.

## Data and attribution

`usage_events` keeps only run ID, service/action, caller protocol, start/end,
duration, success, connection ID, runtime token ID and error code. Inputs,
outputs, credential values and profiles are not copied. Action metadata is
written atomically with the ordinary D1 run log and survives its 5,000-run
retention cleanup. The reporting table has no automatic deletion policy.

The idempotent bootstrap copies metadata from runs still retained at setup. It
cannot recover previously deleted runs. `usage_report_meta` records when the
independent archive began. The UI explains these limits, distinguishes key
authentication from recorded tool use, and identifies apps/keys rather than
claiming to identify a person behind a shared key. Proxy calls, tool discovery,
and use directly with a provider are outside the action-run counts.

Current key/connection inventory and names come from existing admin APIs, even
when viewing a historical week. Removed keys/accounts retain their identifiers
in action history. Reports expose no key values. CSV exports quote fields and
neutralize spreadsheet formula prefixes.

## Deployment

Back up production D1 and deployed Worker versions first. Apply the schema
before enabling the new Worker. With the existing Cloudflare token provided by
Secretbox:

```bash
npx wrangler d1 execute open-connector --remote --config deploy/upgrade/wrangler.backend.jsonc --file deploy/reports/schema.sql
npx wrangler deploy --config deploy/upgrade/wrangler.backend.jsonc --minify --keep-vars
npx wrangler deploy --config deploy/workspace/wrangler.jsonc --keep-vars
```

The backend config sets `OOMOL_CONNECT_USAGE_REPORTS=1`. Without that flag,
existing deployments do not depend on the additional reporting tables. The
console gateway explicitly serves `/reports` and continues forwarding the API
to the backend. `/api/reports/weekly` uses the existing admin middleware and
`no-store` cache policy. Runtime keys cannot read the admin report.

To roll back, restore the saved backend and console versions; leave the additive
reporting tables intact. No credentials or existing access grants are modified.

## Verification

Tests cover Sunday/DST boundaries, exact period counts, filtered/unattributed
calls, SQL parameterization, retention independence, metadata pagination,
idempotent backfill, admin-only access, inventory labels and safe CSV export.
The browser check uses a private production copy for reports and read-only
staging inventory at desktop, 390px and 320px widths. It exercises week/timezone
selection, filtering and CSV download. Browser screenshots containing account
labels are kept outside Git under the private local state directory.

Backup directory:
`/home/ubuntu/.local/state/open-connector-reports-backup-2026-10-22/`.

## Deployed 2026-10-22

Backend: `5f287754-73a4-466d-946f-ca7228e0ceae` at 100%.
Console: `c162ae82-e0b8-4a0c-8576-bcaab6ebe23f` at 100%.
The bootstrap was repeated after activation to cover any actions between schema
setup and the code switch. A subsequent read-only MCP action was found by its
exact execution ID in the archive without another backfill. Existing credentials,
32 connections, 11 runtime tokens and their access grants were preserved.
Anonymous requests to the report page and API redirect to the existing Access
login. Human Access sign-in was not performed by the agent. Browser QA used the
private copy and read-only staging, not an invented dataset.

Evidence: `verification/reports-browser.json`, `reports-schema-rehearsal.json`
and `reports-live.json`. Re-run `reports-live.py EXECUTION_ID` through Secretbox
to verify a specific read-only probe without printing keys or payloads.
