import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createCatalogStore, withActionSchemas } from "../src/catalog-store.ts";
import { loadCatalogFromAssets } from "../src/server/cloudflare/catalog-assets.ts";

let providerFetches = 0;
const catalog = await loadCatalogFromAssets({
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/catalog/providers/")) providerFetches++;
    return new Response(await readFile(`dist/web${path}`), {
      headers: { "content-type": "application/json" },
    });
  },
});
assert.equal(providerFetches, 0);
const source = JSON.parse(await readFile("dist/web/catalog/summary.json", "utf8"));
const providers = await Promise.all(
  source.providers.map(async (entry: { file: string }) =>
    JSON.parse(await readFile(`dist/web/catalog/providers/${entry.file}`, "utf8")),
  ),
);
const eager = createCatalogStore(providers);
assert.deepEqual(catalog.providerSummariesJson, eager.providerSummariesJson);
assert.equal(catalog.providerSummariesEtag, eager.providerSummariesEtag);
for (let i = 0; i < catalog.providers.length; i++) {
  const provider = catalog.providers[i]!;
  await withActionSchemas(
    catalog,
    provider.actions.map((action) => action.id),
    () => {
      assert.equal(JSON.stringify(provider), JSON.stringify(eager.providers[i]), provider.service);
    },
  );
}
const result = {
  date: "2026-10-23",
  providers: catalog.providers.length,
  actions: catalog.actions.length,
  startupProviderFetches: 0,
  providerFetches,
  summariesAndEtagsMatch: true,
  everyProviderSerializationMatches: true,
};
await writeFile("verification/perf-catalog-equivalence.json", `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
