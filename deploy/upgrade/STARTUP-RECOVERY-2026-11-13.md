# Cloudflare startup recovery — 2026-11-13

The production console returned HTTP 500 / error 1101 because the backend exceeded startup memory limits. Enable minification in the backend Wrangler configuration so future deployments retain the working packaging.

The main JavaScript bundle shrank from about 36 MB to 18 MB. Application source, provider definitions, schema, and permissions did not change. The frontend asset upload reported no changed files.

Validation:

- `npm run fix-check` passed, including typechecks for src, scripts, and examples.
- Seven targeted test files passed: 187 tests.
- The isolated staging Worker passed 28 MCP, catalog, schema, documentation, and input-validation requests. Startup: 395 ms.
- Production version `2bc84570-82a8-44c4-a31c-473d3f2ff9e5` deployed with `--keep-vars`. Startup: 385 ms.
- Production health, provider listing, connected-app listing, action schema, MCP initialization, tool listing, connection listing, app listing, action guide, and action search passed.
- An unauthenticated runtime request returned 401. The console root still redirects browser requests to Cloudflare Access. Browser login and provider-side actions were not exercised.
- All 43 connection rows, 16 OAuth configurations, 11 runtime tokens, and the empty runtime-policy table were preserved. Runtime-token last-used timestamps were excluded from comparison. All Worker bindings were preserved.

A full copy of the previous Worker, deployment/settings metadata, and private credential/policy row snapshots are stored outside Git in the owner's private task state directory. The previous backend version is `35275b26-c552-4746-a9b3-34e9ee2b219d`; it is a recovery reference, but restoring it also restores the known startup failure. No database migration was applied.

These checks establish recovery for the tested routes. They do not measure peak isolate memory or establish CPU-budget compliance for every action.
