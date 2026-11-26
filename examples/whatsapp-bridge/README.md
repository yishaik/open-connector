# WhatsApp Personal (development preview)

One private linked-device bridge, one Open Connector provider. Agents use the existing /mcp endpoint; the owner alone manages pairing and send approvals. No AI service or calendar logic is embedded.

## Before deployment

- This is an unofficial WhatsApp client. Test using a secondary account first; account restrictions, protocol changes and incomplete history are possible.
- Do not publish the bridge until its tests pass and the security review is complete. The current example stores SQLite files on disk, **not encrypted by SQLite**. Mount a dedicated encrypted volume and restrict backups, permissions and access before using real messages. Do not copy session databases to GitHub.
- Use a dedicated HTTPS tunnel with origin access restricted. Protect the owner routes with Cloudflare Access or equivalent in addition to owner credentials. Only the connector should have the runtime token. Never grant the owner/admin token to an agent.
- By default no chats are allowed. Configure exact JIDs in WA_ALLOWED_CHATS before pairing; no wildcard or public discovery is enabled. LID/phone alias resolution and contact display names are not implemented in this preview.
- The shared ActionRunner now omits WhatsApp input/output summaries entirely; verify all other runtime logging, idempotency storage and transit handling before production. No real personal data until this is verified.

## Run on a test host

Use Go 1.27 or the Dockerfile. Build from this directory. Generate two different 32-byte secrets in your secret manager. Set WA_RUNTIME_TOKEN and WA_ADMIN_TOKEN from that manager. Set WA_DATA_DIR to a dedicated encrypted, owner-only directory; set WA_ALLOWED_CHATS to a comma-separated list of exact test chat JIDs. For Docker ensure UID 10001 owns the mounted directory. The service listens at 127.0.0.1:8090 by default (Docker listens on its container interface; bind the published port to loopback only).

Open the protected /owner page in a computer browser using HTTP Basic username owner and the separate owner token. Scan the QR in WhatsApp > Linked devices > Link a device. If all QR codes expire, restart the test process to start a new pairing cycle. A persisted session is reused after restart. Unlink from the phone to revoke the session.

## Connector

Build the Open Connector catalog and typecheck on the feature branch. In a staging instance, open WhatsApp Personal, enter the HTTPS bridge origin and click Link WhatsApp (QR). The protected owner page opens in a separate browser tab; authenticate there using the separate owner credential, scan the code, then return and save the runtime token. Validation requires an active linked session. Create narrowly scoped runtime tokens, explicitly allow only the read actions needed and restrict the connection. Do not use bootstrap or unrestricted tokens. Do not grant send_message until approved.

The nine actions include status, list chats, search contacts (JID only in preview), recent/history search, context, media and owner-approved text send. Media is bounded to 4 MiB decoded and the provider transfers it into the gateway's existing transit-file store instead of returning base64 to the model. Verify download authorization and TTL before production. Sending creates an expiring, exact-content approval request; the owner approves or rejects it at /owner. A duplicate request ID with a different payload is rejected; ambiguous sends must never be retried automatically. No send_media yet.

The console links to the separate protected owner QR and approval page. This deliberately avoids passing owner credentials or raw pairing secrets through the runtime. Embedded same-origin pairing remains a future improvement; do not expose QR or approval as an MCP action.

## Acceptance checklist

- CI builds and tests pass; test an actual QR link using a non-primary account.
- Unauthenticated runtime/admin requests return 401; runtime token cannot access owner QR or approval.
- Empty allowlist returns no messages; all queries/media/sends enforce exact allowed chat IDs.
- Confirm history coverage, group handling, LID normalization, reconnection and deletion semantics.
- Verify no message content or media appears in gateway logs; verify volume encryption and backup policy.
- Confirm text send requires exact independent owner approval; no duplicate send on retry.
- Verify Open Connector staging /mcp discovers and executes actions with per-agent grants.
- Verify the QR launch flow and transit media end-to-end; add contact names and pagination improvements before production.
