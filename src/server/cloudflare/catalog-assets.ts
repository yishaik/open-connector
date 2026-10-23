import type { CatalogStore, ExecutableActionOptions } from "../../catalog-store.ts";
import type { ActionDefinition, ProviderDefinition } from "../../core/types.ts";
import type { CatalogSummaryEntry } from "./catalog-asset-schemas.ts";
import type { AssetsBinding } from "./cloudflare-bindings.ts";

import { createCatalogStore, resolveExecutableActionIds } from "../../catalog-store.ts";
import { AssetSchemaLoader, assetBackedProviders, schemaFilesForActions } from "./catalog-asset-schemas.ts";

const catalogIndexPath = "/catalog/index.json";
const catalogSummaryPath = "/catalog/summary.json";
const chunkNamePattern = /^apps-\d{4}\.json$/;
const jsonContentTypePattern = /^application\/(?:[\w.+-]+\+)?json$/i;

interface CatalogAssetIndex {
  version: 1;
  providerCount: number;
  chunks: string[];
}

export async function loadCatalogFromAssets(
  assets: AssetsBinding,
  options: ExecutableActionOptions = {},
): Promise<CatalogStore> {
  // Prefer the schema-free summary: parsing every action schema at isolate start costs most of the
  // Workers CPU budget, while list views and policy checks need metadata only. Builds without a
  // summary fall back to the full chunks below.
  const summary = await readOptionalJsonAsset(assets, catalogSummaryPath);
  if (summary !== undefined) {
    return createAssetBackedCatalog(assets, parseCatalogSummary(summary), options);
  }

  const index = parseCatalogIndex(await readJsonAsset(assets, catalogIndexPath), catalogIndexPath);
  const chunks = await Promise.all(index.chunks.map((chunk) => requireProviderArrayAsset(assets, `/catalog/${chunk}`)));
  const providers = chunks.flat();
  if (providers.length !== index.providerCount) {
    throw new Error(
      `Cloudflare asset catalog provider count mismatch: index declares ${index.providerCount}, loaded ${providers.length}`,
    );
  }

  return createCatalog(providers, options);
}

function createCatalog(providers: ProviderDefinition[], options: ExecutableActionOptions): CatalogStore {
  return createCatalogStore(providers, {
    executableActionIds: resolveExecutableActionIds(providers, options),
  });
}

/**
 * Build a catalog whose action schemas load per provider on demand. Callers that read schemas await
 * `withActionSchemas`; a missed read throws `CatalogSchemasNotLoadedError` naming the files.
 */
export function createAssetBackedCatalog(
  assets: AssetsBinding,
  entries: CatalogSummaryEntry[],
  options: ExecutableActionOptions,
): CatalogStore {
  const loader = new AssetSchemaLoader(assets);
  const store = createCatalog(assetBackedProviders(entries, loader), options);
  store.withActionSchemas = async (actionIds, read) => {
    const actions: (ActionDefinition | undefined)[] = [];
    for (const actionId of actionIds) {
      actions.push(store.actionsById.get(actionId));
    }
    return loader.withFiles(schemaFilesForActions(actions), read);
  };
  return store;
}

function parseCatalogSummary(value: unknown): CatalogSummaryEntry[] {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.providers)) {
    throw new Error(`Cloudflare asset catalog summary must be { version: 1, providers: [...] }: ${catalogSummaryPath}`);
  }
  return value.providers.map((entry, position) => {
    if (!isRecord(entry) || typeof entry.file !== "string" || !isRecord(entry.provider)) {
      throw new Error(`Cloudflare asset catalog summary entry ${position} must have a file and a provider`);
    }
    if (!/^[\w.-]+\.json$/.test(entry.file)) {
      throw new Error(`Cloudflare asset catalog summary entry ${position} has an invalid file name`);
    }
    return { file: entry.file, provider: entry.provider as unknown as CatalogSummaryEntry["provider"] };
  });
}

function parseCatalogIndex(value: unknown, path: string): CatalogAssetIndex {
  if (!isRecord(value)) {
    throw new Error(`Cloudflare asset catalog index must be an object: ${path}`);
  }
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "chunks,providerCount,version") {
    throw new Error("Cloudflare asset catalog index must contain only version, providerCount, and chunks");
  }
  if (value.version !== 1) {
    throw new Error(`Unsupported Cloudflare asset catalog index version: ${String(value.version)}`);
  }
  if (
    typeof value.providerCount !== "number" ||
    !Number.isSafeInteger(value.providerCount) ||
    value.providerCount < 0
  ) {
    throw new Error("Cloudflare asset catalog index providerCount must be a non-negative safe integer");
  }
  if (!Array.isArray(value.chunks) || !value.chunks.every((chunk): chunk is string => typeof chunk === "string")) {
    throw new Error("Cloudflare asset catalog index chunks must be an array of strings");
  }
  if (!value.chunks.every((chunk) => chunkNamePattern.test(chunk))) {
    throw new Error("Cloudflare asset catalog index contains an invalid chunk name");
  }
  if (new Set(value.chunks).size !== value.chunks.length) {
    throw new Error("Cloudflare asset catalog index contains duplicate chunks");
  }

  return {
    version: 1,
    providerCount: value.providerCount,
    chunks: value.chunks,
  };
}

async function requireProviderArrayAsset(assets: AssetsBinding, path: string): Promise<ProviderDefinition[]> {
  return requireProviderArray(await readJsonAsset(assets, path), path);
}

function requireProviderArray(value: unknown, path: string): ProviderDefinition[] {
  if (!Array.isArray(value)) {
    throw new Error(`Cloudflare asset catalog must be an array: ${path}`);
  }

  return value as ProviderDefinition[];
}

/**
 * Read one catalog asset as JSON.
 *
 * `not_found_handling: "single-page-application"` (see `wrangler.example.jsonc`) makes the assets
 * binding answer an unknown path with `index.html` and status 200 rather than 404, and it does so
 * for binding fetches regardless of the request's `Accept` header. A missing index or chunk is
 * therefore detected by the response content type as well as by the status, otherwise the SPA shell
 * would be parsed as catalog JSON.
 */
async function readJsonAsset(assets: AssetsBinding, path: string): Promise<unknown> {
  const response = await fetchAsset(assets, path);
  if (response.status === 404) {
    throw assetRequestError(path, "returned 404");
  }
  if (!response.ok) {
    throw assetRequestError(path, `returned ${response.status}`);
  }

  const contentType = response.headers.get("content-type");
  if (!isJsonContentType(contentType)) {
    throw assetRequestError(path, `returned content type ${contentType ?? "(none)"} instead of JSON`);
  }

  return await readResponseJson(response, path);
}

/**
 * Read an asset that older builds may lack. A 404 or the SPA shell (non-JSON 200) both mean "absent";
 * any other failure is still an error so a broken deployment is not mistaken for an old one.
 */
async function readOptionalJsonAsset(assets: AssetsBinding, path: string): Promise<unknown> {
  const response = await fetchAsset(assets, path);
  if (response.status === 404 || (response.ok && !isJsonContentType(response.headers.get("content-type")))) {
    return undefined;
  }
  if (!response.ok) {
    throw assetRequestError(path, `returned ${response.status}`);
  }
  return await readResponseJson(response, path);
}

function fetchAsset(assets: AssetsBinding, path: string): Promise<Response> {
  return assets.fetch(
    new Request(new URL(path, "https://assets.local"), {
      headers: { accept: "application/json" },
    }),
  );
}

function isJsonContentType(contentType: string | null): boolean {
  return contentType !== null && jsonContentTypePattern.test(contentType.split(";", 1)[0]!.trim());
}

async function readResponseJson(response: Response, path: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(`Cloudflare asset catalog contains invalid JSON: ${path}`);
  }
}

function assetRequestError(path: string, reason: string): Error {
  return new Error(`Cloudflare asset catalog request failed: ${path} ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
