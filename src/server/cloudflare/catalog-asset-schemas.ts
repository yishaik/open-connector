import type { CatalogIndexAction, CatalogIndexProvider } from "../../catalog-index.ts";
import type { ActionDefinition, JsonSchema, ProviderDefinition } from "../../core/types.ts";
import type { AssetsBinding } from "./cloudflare-bindings.ts";

interface ActionSchemas {
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}

/**
 * Non-enumerable link from a metadata-only action to the provider asset that owns its schemas. A symbol
 * keeps it out of `Object.keys`, `JSON.stringify` and spreads, while the descriptor copy in
 * `createCatalogStore` still carries it onto the runtime action.
 */
const actionSchemaFile = Symbol("catalog action schema asset");

interface AssetBackedActionDefinition extends ActionDefinition {
  [actionSchemaFile]: AssetSchemaSource;
}

/** Provider assets whose parsed schemas stay cached at once. Above the `search_actions` limit of 50. */
export const defaultAssetSchemaCacheProviders = 128;

/** Directory, under the catalog assets, that holds one full JSON file per provider. */
export const catalogProviderAssetDir = "/catalog/providers";

/**
 * A schema was read before its provider asset was loaded. Workers cannot read assets synchronously, so a
 * caller that needs schemas must await `CatalogStore.withActionSchemas`; `files` names what to load.
 */
export class CatalogSchemasNotLoadedError extends Error {
  readonly files: string[];

  constructor(files: string[]) {
    super(`Catalog schemas are not loaded yet for: ${files.join(", ")}`);
    this.name = "CatalogSchemasNotLoadedError";
    this.files = files;
  }
}

/** One summary entry: the provider asset file name and the provider without action schemas. */
export interface CatalogSummaryEntry {
  file: string;
  provider: CatalogIndexProvider;
}

/**
 * Bounded, least-recently-used cache of provider schemas read from the assets binding. Loading is async;
 * reads are synchronous because they answer property getters, and they only see what was loaded.
 */
export class AssetSchemaLoader {
  private readonly assets: AssetsBinding;
  private readonly maxCachedProviders: number;
  private readonly cache = new Map<string, Map<string, ActionSchemas>>();
  private readonly pins = new Map<string, number>();
  private readonly pending = new Map<string, Promise<void>>();

  constructor(assets: AssetsBinding, maxCachedProviders: number = defaultAssetSchemaCacheProviders) {
    if (!Number.isInteger(maxCachedProviders) || maxCachedProviders < 1) {
      throw new Error(`maxCachedProviders must be a positive integer, got ${maxCachedProviders}`);
    }
    this.assets = assets;
    this.maxCachedProviders = maxCachedProviders;
  }

  /** Load every given provider file that is not cached yet. Concurrent loads of one file share a request. */
  async ensure(files: Iterable<string>): Promise<void> {
    const loads: Promise<void>[] = [];
    for (const file of new Set(files)) {
      const cached = this.cache.get(file);
      if (cached) {
        this.touch(file, cached);
        continue;
      }
      let load = this.pending.get(file);
      if (!load) {
        load = this.load(file).finally(() => this.pending.delete(file));
        this.pending.set(file, load);
      }
      loads.push(load);
    }
    await Promise.all(loads);
  }

  /** Return the cached schemas of one action, or undefined when its provider file is not loaded. */
  peek(file: string, actionId: string): ActionSchemas | undefined {
    return this.cache.get(file)?.get(actionId);
  }

  private async load(file: string): Promise<void> {
    const path = `${catalogProviderAssetDir}/${file}`;
    const response = await this.assets.fetch(
      new Request(new URL(path, "https://assets.local"), { headers: { accept: "application/json" } }),
    );
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
    if (!response.ok || !/^application\/(?:[\w.+-]+\+)?json$/i.test(contentType)) {
      throw new Error(`Cloudflare catalog provider asset request failed: ${path} returned ${response.status}`);
    }
    const provider = (await response.json()) as ProviderDefinition;
    this.touch(
      file,
      new Map(
        provider.actions.map((action) => [
          action.id,
          { inputSchema: action.inputSchema, outputSchema: action.outputSchema },
        ]),
      ),
    );
  }

  private touch(file: string, schemas: Map<string, ActionSchemas>): void {
    // Re-inserting moves the entry to the end of the insertion order, so the first key is the oldest.
    this.cache.delete(file);
    this.cache.set(file, schemas);
    this.evict();
  }

  /** Pin schemas while a consumer runs so concurrent requests cannot evict them. */
  async withFiles<T>(files: Iterable<string>, read: () => T | Promise<T>): Promise<T> {
    const unique = [...new Set(files)];
    for (const file of unique) this.pins.set(file, (this.pins.get(file) ?? 0) + 1);
    try {
      await this.ensure(unique);
      return await read();
    } finally {
      for (const file of unique) {
        const count = this.pins.get(file)! - 1;
        if (count) this.pins.set(file, count);
        else this.pins.delete(file);
      }
      this.evict();
    }
  }

  private evict(): void {
    for (const file of this.cache.keys()) {
      if (this.cache.size <= this.maxCachedProviders) break;
      if (!this.pins.has(file)) this.cache.delete(file);
    }
  }
}

/** The provider asset that backs every action of one provider. */
class AssetSchemaSource {
  readonly file: string;
  private readonly loader: AssetSchemaLoader;

  constructor(file: string, loader: AssetSchemaLoader) {
    this.file = file;
    this.loader = loader;
  }

  read(actionId: string): ActionSchemas {
    const schemas = this.loader.peek(this.file, actionId);
    if (!schemas) {
      throw new CatalogSchemasNotLoadedError([this.file]);
    }
    return schemas;
  }
}

/**
 * Turn schema-free summary providers into providers whose actions expose `inputSchema`/`outputSchema`
 * accessors at their original key positions, so serialized output keeps the same key order as an eagerly
 * loaded catalog. Nothing is fetched here.
 */
export function assetBackedProviders(entries: CatalogSummaryEntry[], loader: AssetSchemaLoader): ProviderDefinition[] {
  return entries.map((entry) => {
    const source = new AssetSchemaSource(entry.file, loader);
    return {
      ...entry.provider,
      actions: entry.provider.actions.map((action) => toAssetBackedAction(action, source)),
    };
  });
}

/** Provider asset files that own the given actions; unknown or eagerly loaded actions are skipped. */
export function schemaFilesForActions(actions: Iterable<ActionDefinition | undefined>): string[] {
  const files = new Set<string>();
  for (const action of actions) {
    const source = action ? (action as Partial<AssetBackedActionDefinition>)[actionSchemaFile] : undefined;
    if (source) {
      files.add(source.file);
    }
  }
  return [...files];
}

function toAssetBackedAction(action: CatalogIndexAction, source: AssetSchemaSource): ActionDefinition {
  const backed: Record<string, unknown> = {};
  for (const key of Object.keys(action)) {
    if (key === "inputSchema" || key === "outputSchema") {
      Object.defineProperty(backed, key, {
        get: key === "inputSchema" ? readInputSchema : readOutputSchema,
        enumerable: true,
        configurable: true,
      });
    } else {
      backed[key] = action[key as keyof CatalogIndexAction];
    }
  }
  Object.defineProperty(backed, actionSchemaFile, { value: source });
  return backed as ActionDefinition;
}

function readInputSchema(this: AssetBackedActionDefinition): JsonSchema {
  return this[actionSchemaFile].read(this.id).inputSchema;
}

function readOutputSchema(this: AssetBackedActionDefinition): JsonSchema {
  return this[actionSchemaFile].read(this.id).outputSchema;
}
