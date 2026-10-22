# OpenConnector upstream review — 2026-10-21

Compared the local UI branch against a freshly fetched `origin/main` from
https://github.com/oomol-lab/open-connector. This is a source review, not an upgrade.

- Local upstream base: `5a997e37be87b63a693d19d960dbb5de44c63353` (2026-08-23), after the v1.4.0 tag.
- Current upstream: `1fcfb9997e96196d6114e5a5be5b80021e694ed4` (2026-10-21).
- 409 upstream commits since the base. The latest published release is v1.9.1,
  at `b09c377e`, with 399 of these commits. Main has ten additional commits.
- Our frontend, permissions editor, mobile layout and app-name activity view are
  separate local changes. The reviewed local OAuth service, guarded-fetch and
  D1 runtime-store source files still match the older upstream base.

## Recommended adoption order

| Priority       | Change                                                  | Why it matters here                                                                                                                                                                                                                                                                                                                                                                             | References                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First          | OAuth refresh/reconnect fixes                           | Avoid losing rotated refresh tokens or using an older refresh after reconnect. Persist `reauth_required` instead of presenting rejected credentials as active.                                                                                                                                                                                                                                  | [rotation](https://github.com/oomol-lab/open-connector/commit/d3126cae), [reauthorization isolation](https://github.com/oomol-lab/open-connector/commit/c4b83b96), [reconnect status](https://github.com/oomol-lab/open-connector/commit/fed0722e)   |
| First          | Redirect-header safety and dependency updates           | Cross-origin redirects now retain only safe-listed headers, covering custom provider credentials as well as standard auth headers. Upstream also resolved dependency audit findings. This is evidence of improvements, not a fresh vulnerability scan of our deployment.                                                                                                                        | [headers](https://github.com/oomol-lab/open-connector/commit/ce5be1e8), [dependencies](https://github.com/oomol-lab/open-connector/commit/50003ef6)                                                                                                  |
| First          | Atomic idempotency claims on D1                         | Cloudflare uses D1 here; atomic claims prevent concurrent requests with the same idempotency key from both obtaining the execution claim. This does not deduplicate unrelated calls without a shared key.                                                                                                                                                                                       | [D1 fix](https://github.com/oomol-lab/open-connector/commit/ae31cb3c)                                                                                                                                                                                |
| Next           | Client onboarding and requested/effective OAuth scopes  | Reusable MCP/CLI/SDK setup examples and clearer scope selection fit our simpler setup flow. Connection authorization IDs identify a consent instance, not a human actor.                                                                                                                                                                                                                        | [client onboarding](https://github.com/oomol-lab/open-connector/commit/ce7ec590), [effective scopes](https://github.com/oomol-lab/open-connector/commit/ff9f87b1), [consent provenance](https://github.com/oomol-lab/open-connector/commit/0556a290) |
| Next, optional | OAuth for MCP clients on Cloudflare                     | Supports clients such as ChatGPT that need OAuth rather than a manually supplied bearer header. Requires a new OAUTH_KV binding and review of Access discovery/callback routing. This is client-to-gateway OAuth, separate from provider account OAuth. The default grants may permit writes subject to deployment policy; do not assume our Open WebUI read-only policy automatically applies. | [implementation](https://github.com/oomol-lab/open-connector/commit/f043bea8), [configuration](https://github.com/oomol-lab/open-connector/blob/v1.9.1/docs/cloudflare.md)                                                                           |
| Selective      | Official Notion/Linear MCP providers and provider fixes | Dynamic public-client registration avoids creating a conventional integration app, but still requires registration and a user consent flow. Linear defaults to read scope; writes are optional. Existing Google, Slack and other providers also received fixes.                                                                                                                                 | [Notion](https://github.com/oomol-lab/open-connector/blob/v1.9.1/src/providers/notion_mcp/definition.ts), [Linear](https://github.com/oomol-lab/open-connector/blob/v1.9.1/src/providers/linear_mcp/definition.ts)                                   |
| Later          | Native event triggers                                   | New runtime, policies and subscription maintenance can support event-driven automation. Core is in v1.9.1; the additional 15 integrations in #765 are only on main at this review. Cloudflare integration includes scheduled maintenance and needs cron configuration.                                                                                                                          | [core](https://github.com/oomol-lab/open-connector/commit/cdd4b597), [15 integrations](https://github.com/oomol-lab/open-connector/commit/c17f17f1)                                                                                                  |

## Upgrade implications

Prefer a staged integration against v1.9.1, preserving our console changes, rather
than replacing our UI with upstream's console. Some fixes depend on earlier
storage/OAuth refactors, so individual commits are not assumed to cherry-pick cleanly.

There are seven new numbered SQL migrations (0012–0018), mirrored for PostgreSQL.
Migration0018 invalidates unfinished local OAuth consent state and in-progress
local connection requests; stored credentials remain intact. An upgrade requires
backups, a migration rehearsal, the existing granular-token regression checks,
and testing our frontend against the newer API responses. New connection status
must be rendered deliberately by our UI; a backend upgrade alone is insufficient.

Keep connect.yishaik.com assigned to the console gateway and preserve the backend
service binding. The original ignored backend deployment config can reclaim the
hostname if used unchanged. Existing dirty Google Chat/provider files in the
original checkout must be preserved during any future integration.

The latest upstream RunLog adds `remoteExecutionId` but still records caller,
connectionId and runtimeTokenId, without a new personal actor identity. The
upstream runs-page source is unchanged from our upstream base. Our app-name
attribution and mobile activity cards remain useful and should be retained.
The latest upstream settings-dialog positioning fix overlaps with geometry
already handled by our mobile drawer/editor; it is not a reason to replace them.

Hosted Marketplace/OOMOL Key and SaaS OAuth are optional separate integrations.
SaaS OAuth sends action inputs/outputs through the hosted service; adopt only if
that data path is desired, not as an incidental consequence of updating the core.

No application code, schema, credentials, permissions or deployed Workers were
changed by this review. Only upstream refs were fetched and this report was added.
