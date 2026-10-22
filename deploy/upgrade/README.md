# Cloudflare backend upgrade, 2026-10-22

The backend stays `open-connector`. The existing console Worker keeps ownership
of `connect.yishaik.com` and its `ORIGIN` service binding. Use this directory's
backend configuration, rather than the legacy local configuration that declares
the custom domain.

Private backups are outside Git at
`/home/ubuntu/.local/state/open-connector-backup-2026-10-22/`: the Git bundle,
all three source worktrees, production D1 export, both Worker modules, settings,
deployment versions and domain assignments. The backup directory is private.
Secrets remain in Secretbox and existing Worker secret bindings.

Seven migrations, 0012–0018, were rehearsed against the fresh D1 export. Every
existing field in all 32 connections and 11 runtime token records was preserved.
New trigger grants default to an empty list. Migration 0018 clears unfinished
OAuth consent; a person with an authorization in progress must restart it.

The backend version was uploaded before migrations to check acceptance without
switching traffic: `22a2920e-d192-4a83-bb8c-238a73921f91`.

With `CLOUDFLARE_API_TOKEN` supplied by Secretbox:

```bash
npx wrangler d1 migrations apply open-connector --remote --config deploy/upgrade/wrangler.backend.jsonc
npx wrangler versions deploy 22a2920e-d192-4a83-bb8c-238a73921f91@100% --config deploy/upgrade/wrangler.backend.jsonc --yes
npx wrangler deploy --config deploy/workspace/wrangler.jsonc --keep-vars
python3 verification/upgrade-live.py
python3 verification/runtime-review.py
```

`verification/upgrade-live.json` records the observed deployed versions, record
preservation and domain owner. `upgrade-live.py` compares existing D1 fields to
the private export without printing credential values. The browser report uses
fixtures; it does not claim that a human completed Cloudflare Access or provider
OAuth sign-in.

Previous backend version: `5aefb83c-010a-4f17-80ce-b2c259efdc02`.
Previous console version: `0cb33ee8-1b83-4ba8-bc66-6904c499fde3`.
An application rollback uses `wrangler versions deploy VERSION@100% --yes` with
the appropriate configuration. The new database fields are additive; do not
restore the old SQL over a live database automatically. The private export is
available for a separately planned restore if needed.
