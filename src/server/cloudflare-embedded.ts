import type { CatalogSummaryEntry } from "./cloudflare/catalog-asset-schemas.ts";
import type { AssetsBinding } from "./cloudflare/cloudflare-bindings.ts";

import summaryText from "../../dist/web/catalog-summary.txt";
import { executorModules } from "../providers/registry.cloudflare.generated.ts";
import worker, { configureWorkerCatalog } from "./cloudflare.ts";
import { createAssetBackedCatalog } from "./cloudflare/catalog-assets.ts";

// Preparing metadata during isolate startup keeps it out of the first HTTP request's CPU budget.
// The Text module is generated from the same provider files as the schema assets.
let assets: AssetsBinding | undefined;
const summary = JSON.parse(summaryText) as { providers: CatalogSummaryEntry[] };
configureWorkerCatalog(
  createAssetBackedCatalog(
    {
      fetch(request) {
        if (!assets) throw new Error("Cloudflare ASSETS binding is required to load action schemas");
        return assets.fetch(request);
      },
    },
    summary.providers,
    { executableServices: Object.keys(executorModules) },
  ),
);

const embeddedWorker: typeof worker = {
  fetch(request, env, ctx) {
    assets ??= env.ASSETS;
    return worker.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    assets ??= env.ASSETS;
    return worker.scheduled(controller, env, ctx);
  },
};

export default embeddedWorker;
