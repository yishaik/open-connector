/** Read-only staging server for a migrated D1 export, using Cloudflare's credential codec. */
import { serve } from "@hono/node-server";
import { loadCatalog } from "../src/catalog-store.ts";
import { ProviderLoader } from "../src/providers/provider-loader.ts";
import { executorModules } from "../src/providers/registry.cloudflare.generated.ts";
import { createConnectApp } from "../src/server/connect-app.ts";
import { TransitFileService } from "../src/server/files/transit-files.ts";
import { createWorkerSecretCodec } from "../src/server/secrets/worker-secret-codec.ts";
import { SqliteRuntimeDatabase } from "../src/server/storage/sqlite/runtime-store.ts";

const root = "/home/ubuntu/.local/state/open-connector-upgrade/staging";
const origin = "http://127.0.0.1:4182";
const codec = await createWorkerSecretCodec(process.env.OOMOL_CONNECT_ENCRYPTION_KEY);
const database = new SqliteRuntimeDatabase(`${root}/connect.sqlite`, { secretCodec: codec });
const catalog = await loadCatalog("catalog/apps", {
  executableServices: Object.keys(executorModules),
  lazySchemas: true,
  lazySchemaIndexFile: "catalog/apps-index.json",
  lazySchemaCacheFiles: 4,
});
const { app } = await createConnectApp({
  catalog,
  providerLoader: new ProviderLoader(executorModules),
  runtimeDatabase: database,
  transitFiles: new TransitFileService({ rootDir: `${root}/files`, publicOrigin: origin }),
  publicOrigin: origin,
  configuredOrigin: origin,
  secretCodec: codec,
  adminToken: process.env.OOMOL_CONNECT_ADMIN_TOKEN,
});
serve({
  hostname: "127.0.0.1",
  port: 4182,
  fetch: (request) => {
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Read-only staging", { status: 405 });
    return app.fetch(request);
  },
});
console.log("Staging ready on loopback using migrated D1 data and Worker secret codec.");
