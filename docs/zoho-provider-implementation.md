# Implement the Zoho provider family

Status: proposed implementation instructions, 2026-11-13. No Zoho provider code or live connection has been delivered by this work. Start with CRM, Desk and Voice, then work through the other Zoho One apps that have supported APIs. Each product can ship independently.

Read this document with the repository's `AGENTS.md`, the [reviewed design](specs/zoho/design.md), [coverage inventory](specs/zoho/coverage.md), [machine-readable inventory](specs/zoho/coverage.json) and [review status](specs/zoho/review-status.md). Keep these documents current as work proceeds.

## 1. Resolve the remaining protocol contracts

- Confirm the installation's Zoho region from its actual account URL. Verify the product-specific account, API and authorization hosts using official documentation. Do not assume every app supports every Zoho region.
- Confirm active app access, organization identifiers, roles and API entitlements. Voice has a separate subscription according to the [official FAQ](https://www.zoho.com/voice/pricing.html); do not infer entitlement from Zoho One or automatically purchase a plan.
- For CRM, confirm field metadata, search, pagination, module-specific read scopes and error responses against API v8.
- For Desk, confirm the organization-discovery scopes, organization-specific headers, pagination and error responses. The initial selection must be explicit and retained per connection.
- For Voice, confirm the two call-log endpoint contracts, supported regions, tenant context, pagination and error envelopes. Start with call-log reads; do not place calls, send messages or create paid transcriptions during validation.
- Record the exact official source and sanitized mock fixtures for each contract. Missing API-directory entries are research tasks, not evidence that an API does not exist.

Implement and validate each product when its contracts are resolved. Missing Voice access must not block CRM or Desk. The public coverage list is a discovery baseline, not an exhaustive statement of regional or contractual entitlement.

## 2. Implement OAuth and account isolation

Use separate service IDs: `zoho_crm`, `zoho_desk` and `zoho_voice`. Retain the existing provider-local OAuth hooks, encrypted storage, OAuth state handling and action policies.

- Configure a server-based OAuth client in the [Zoho API Console](https://api-console.zoho.com/) with the deployment's exact `<OPEN_CONNECTOR_ORIGIN>/oauth/callback` URI. Reuse a client across products only where the registered client and region support it. Obtain consent separately for each app with the selected product scopes.
- Freeze the normalized Zoho OAuth client configuration when authorization starts, including the default-config path. Reuse the existing encrypted pending-state and credential snapshot fields. Explicitly require encrypted storage before persisting a snapshot; the existence of a codec alone is insufficient.
- Freeze the chosen region and Desk organization on the named connection. Later edits to service defaults must not change an in-progress consent or an existing connection's refresh target.
- For Desk, use an optional `deskOrgId` OAuth client field and store it with the connection. Without it, permit only organization discovery. Select an organization in settings and reconnect the intended named connection; do not select the first organization automatically or allow action inputs to override it.
- Validate exact documented regional origins in callbacks and token responses. Do not follow arbitrary `accounts-server` or `api_domain` values. Preserve region and tenant state during refresh.
- Preserve the old refresh token when a refresh response omits one. Reuse the existing refresh coalescing and revision fences. Validate identity against the frozen credential/config pair, rather than current global defaults.
- Sanitize raw OAuth callback `error` and `error_description` values before logging. Add regression tests for both Zoho and existing provider paths.

The existing OAuth settings are per service. Do not advertise a universal token, automatic app provisioning or one-click suite authorization. Keep client secrets and tokens out of commits, examples, fixtures, logs and issue bodies.

## 3. Implement the first actions

| Provider | Initial actions                                                                                        | Important contract                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| CRM      | `list_modules`, `list_fields`, `list_records`, `get_record`, `search_records`                          | API v8; initial modules: Leads, Contacts, Accounts, Deals and Tasks; explicit field selection and bounded pagination |
| Desk     | `list_organizations`, `list_departments`, `list_tickets`, `get_ticket`, `list_contacts`, `get_contact` | Freeze the explicitly selected organization; bootstrap discovery works without a selected organization               |
| Voice    | `list_call_logs`, `get_call_log`                                                                       | `ZohoVoice.call.READ`; verify region-specific Voice hosts and both endpoint schemas                                  |

Classify these actions as `read` and declare verified provider-native scopes. Preserve long IDs as strings. Validate inputs before outbound requests and return pagination information without automatically retrieving an entire account. Respect product-specific error and rate-limit behavior.

Keep provider definitions separate from executors and keep executor imports lazy. Use existing HTTP, validation, timeout and error helpers. Generate registries and catalog assets from provider source; do not hand-edit generated files. Do not add a generic HTTP escape hatch as a substitute for supported actions.

Future create, update, delete, send and dial actions require explicit schemas, scopes and operation classifications. Live test runs must not trigger those effects without authorization for the specific validation.

## 4. Verify and release each provider

1. Test OAuth code exchange, refresh, denied consent, invalid grants, malformed responses, unsupported regions, hostile hosts and omitted refresh tokens with mock HTTP responses.
2. Test configuration A starting consent, settings changing to B, then A completing. A must retain its own client, region and organization. Cover both authorization entry points and later refresh. Verify the encrypted-storage requirement and sanitized callback logging.
3. Test empty results, pagination, long IDs, invalid input and missing organization context. Verify that runtime-policy denials stop outbound requests and that existing connections remain isolated.
4. Run the repository checks:

   ```bash
   npm run generate:registry
   npm run generate:catalog
   node scripts/check-action-examples.ts
   npm run fix-check
   ```

   Run the focused new provider/OAuth tests and the existing runtime/catalog regression tests appropriate to the change. Record actual commands and results.

5. Deploy to isolated staging with fixture credentials, its own storage and minification retained. Verify startup, health, catalog schemas, MCP discovery and preservation of the existing catalog. Never copy production credentials into staging.
6. Configure production OAuth settings through the protected interface and obtain human consent for each app. Verify the correct account/organization, read access, refresh and reconnect. Distinguish mocked checks from live checks.
7. Before promotion, save a private rollback backup and a fresh connection/policy baseline. Preserve existing bindings, secrets, storage and minification. After deployment, verify health, MCP, access restrictions and persisted data. A metadata listing alone does not prove provider execution works.

## 5. Complete the broader Zoho One coverage

Work through the [coverage inventory](specs/zoho/coverage.md) in batches. Suggested next apps are Mail, Calendar, WorkDrive, Books, Inventory, Projects and Cliq. Calendar and other suite components may require additional discovery because the inventory records public plan sections rather than every embedded app.

Track these states separately for each app: documentation located, supported actions implemented, tests passed, credentials configured, account entitlement verified, live reads passed, and release deployed. Add discovered apps to both inventory formats. Record evidence for any unsupported or unavailable capability.

An API link does not make an app implemented. An implemented provider does not make an account connected. Do not mark the suite complete while entries remain unresolved; report completed products and remaining gaps explicitly.

## Handoff checkpoint

After each batch, commit the implementation and updated inventory, validation evidence and remaining tasks. Push the working branch to the configured owner repository and provide the commit/document links. Never include credential backups or account payloads in the repository.
