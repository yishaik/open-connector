# WhatsApp isolated Worker smoke test

Disposable local-only D1 and KV, generated test credentials, and status-only action policy. This branch is not a production deployment and must never be pointed at existing production D1 or KV. No account credentials, chat messages, service token or production environment variables are used. The workflow validates the actual Cloudflare runtime bundle, migrations, authentication and MCP discovery independently of the production baseline mismatch. Do not merge this experimental config into main or deploy it remotely.
