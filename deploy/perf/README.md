# Worker catalog optimization — 2026-10-23

The backend now reads action schemas from a per-provider static asset only when a
caller needs them. Its small-tool MCP interface, action schemas, connection
selection and policy checks stay compatible. The embedded deployment entrypoint
prepares metadata during isolate startup. Schemas use a bounded cache; active
reads pin their providers until asynchronous work completes.

Production backend version: `35275b26-c552-4746-a9b3-34e9ee2b219d` (100%).
Previous backend version: `5f287754-73a4-466d-946f-ca7228e0ceae`.
The console version, domain routing, database and secret bindings were preserved.
No database migrations or plan changes were made.

Verification:

- `npm run fix-check` passed for src, scripts and examples.
- 314 tests passed across 14 files covering MCP, schema assets, action execution,
  HTTP routes, runtime tokens, permissions, D1 storage and reports.
- Every provider's full serialization matched the eager catalog: 1,650 providers
  and 19,770 actions. Provider summary bytes and ETags also matched.
- 28 requests passed against a fresh deployment to the isolated staging database.
  Schema responses were checked against the source catalog; invalid action input
  was rejected without making a provider request.
- Live initialization and scoped search returned HTTP 500 before deployment.
  Both passed afterward, along with tool discovery, connections, Google Chat app
  lookup and the custom `googlechat.list_messages` action guide.
- Live Open WebUI write restrictions still rejected Drive deletion and Sheets
  updates. Protected console routes redirected to Access; unauthenticated MCP
  returned 401. No external provider writes were executed.
- Fresh before/after comparisons preserved all fields of 32 connection records,
  11 runtime tokens and runtime policy, except allowed token last-use updates.

The trace summaries in `verification/perf-*-cpu.json` show successful requests
without CPU termination. They do **not** prove every request fits the documented
Workers Free CPU allowance. Cloudflare documents 10ms per request with occasional
burst flexibility. In these probes, the staging peak was 1,151ms; the production
peak was 1,134ms. Cold initialization and search can still consume substantial
CPU. Sustained load and long-term free-plan reliability have not been established.
See https://developers.cloudflare.com/workers/platform/limits/.

Fresh private backups of backend code, deployment settings, domain ownership,
connections, tokens and policy are outside Git at
`/home/ubuntu/.local/state/open-connector-perf-2026-10-23/`.
Do not copy those files into the repository.

Rebuild the generated assets before any subsequent upload:

```bash
node scripts/copy-catalog-assets.ts
```

Production configuration remains `deploy/upgrade/wrangler.backend.jsonc`.
Use `--keep-vars` when uploading a new version. Supplying the existing Cloudflare
credential through Secretbox, an application rollback is:

```bash
wrangler versions deploy 5f287754-73a4-466d-946f-ca7228e0ceae@100% --config deploy/upgrade/wrangler.backend.jsonc --yes
```

This rolls back code; do not restore SQL over the live database automatically.
The prior version had the MCP failures reproduced above.

Reproducible local catalog check: `node verification/perf-catalog-equivalence.ts`.
The staging probe is `python3 verification/perf-probe.py`; it expects the existing
private staging token file. The live probe is `verification/perf-live.py`; supply
`OPENCONNECTOR_MCP_TOKEN` through Secretbox. Neither probe prints credentials or
saves connection payloads. Human Access login was not retested in this session.
