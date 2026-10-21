# Services and tools console

Live at https://connect.yishaik.com/workspace (also the default home page).
Source worktree: `/home/ubuntu/git/open-connector-ui`, branch
`ui/connector-service-access`. Original checkout's pre-existing changes are intact.

The console groups connected accounts, service discovery and per-app tool access.
A service card opens account setup or that service's tools. The app picker shows
effective access, including both action rules and account grants. The visual
editor preserves existing blocks and proxy grants; wildcard/proxy policies stay
in the existing advanced editor. Empty allowlists cannot be saved accidentally,
because the runtime interprets them as unrestricted. New keys require a name,
explicit tools and accounts (or an explicitly selected all-account option).

The new console copy is currently English in each supported locale; existing
translated screens and translated navigation labels are preserved. Account setup
reuses the real existing API-key/OAuth forms; OAuth app configuration is still
required where the provider requires it.

## Mobile layout

Below 960px the full sidebar moves into a keyboard-accessible menu, keeping the
page header compact. At phone widths, inputs and primary touch controls are at
least 44px high and text inputs use 16px fonts. The tool/account editor fills the
phone viewport with one scrolling body and a separate, always-visible action
footer. Safe-area spacing supports devices with home indicators. Desktop layout
and permission semantics are unchanged.

## Deployment

`open-connector-console` serves only frontend routes and `/ui-assets/*`. All other
requests, including API, MCP, OAuth callbacks, catalog and legacy assets, go through
a service binding `ORIGIN` to the unchanged `open-connector` Worker. The original
backend version, secrets, D1 data, catalog assets and token policies were preserved.
The existing hostname's Cloudflare Access remains in place. workers.dev and
preview URLs are disabled for the console. The custom domain is attached through
the account-level Domains API; routes are deliberately omitted from the CLI
config because the existing credential has no zone-route permission. Updating
the console Worker leaves the existing domain assignment in place.

```bash
npm run build:console
python3 /home/ubuntu/alfred/secretbox.py --run open-connector/CLOUDFLARE_API_TOKEN/CLOUDFLARE_API_TOKEN -- npm run deploy:console
```

Do not reclaim connect.yishaik.com for the backend in a later backend deployment.
Its legacy local Wrangler config may still declare that custom domain. Backend
updates must leave the hostname assigned to the console and retain the
`open-connector` service name used by the service binding.

The one-time activation helper records the original domain assignment and checks
live MCP discovery and write denial, with rollback on verification failure. It
refuses unexpected domain ownership. Do not rerun it after successful activation.
Private deployment backups live under
`/home/ubuntu/.local/state/open-connector-ui`, outside source control.

To roll back the UI, attach connect.yishaik.com to the original `open-connector`
Worker using the saved original domain assignment. No database restore is needed.

## Validation

- `npm run fix-check`: formatting, lint and source/scripts/examples type checks.
- `npm run build:console`: frontend type check and production build.
- `vitest run web/src`: 158 tests, including layered permissions, empty-grant
  protection, account restrictions and gateway routing/body preservation.
- `node verification/browser.cjs` against a local preview on port 4177: desktop
  and touch-enabled mobile viewports (320×568, 390×844, 844×390), menu navigation
  and Escape, a long tool list with visible phone save/cancel controls, service search and account-setup navigation, per-app tool selection,
  blocked-action controls, preserving grants, explicit new-key creation and
  wildcard-policy protection. API data/writes are mocked; no real keys are created.
- Live post-deploy: MCP metadata call through the gateway and denied empty-input
  write probe; original backend version unchanged. Existing Cloudflare login flow
  is protected but was not completed as the human owner by the agent.

Browser evidence and nonsecret deployment results are in `verification/`.
