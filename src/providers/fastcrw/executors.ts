import type {
  CredentialValidationResult,
  CredentialValidators,
  ExecutionContext,
  ProviderExecutors,
} from "../../core/types.ts";
import type { ProviderActionHandlers } from "../provider-runtime.ts";

import { compactObject, optionalRecord, optionalString, requiredString } from "../../core/cast.ts";
import { assertPublicHttpUrl } from "../../core/request.ts";
import {
  defineProviderExecutors,
  providerUserAgent,
  ProviderRequestError,
  requireApiKeyCredential,
} from "../provider-runtime.ts";

const service = "fastcrw";
const defaultApiBaseUrl = "https://api.fastcrw.com";

type FastcrwRequestPhase = "validate" | "execute";

export interface FastcrwActionContext {
  apiKey: string;
  apiBaseUrl: string;
  fetcher: typeof fetch;
  signal?: AbortSignal;
}

type FastcrwActionHandler = (input: Record<string, unknown>, context: FastcrwActionContext) => Promise<unknown>;

export const fastcrwActionHandlers: ProviderActionHandlers<"fastcrw", FastcrwActionHandler> = {
  scrape: fastcrwPostAction("/v1/scrape"),
  map: fastcrwPostAction("/v1/map"),
  search: fastcrwPostAction("/v1/search"),
  crawl: fastcrwPostAction("/v1/crawl"),
  crawl_get: fastcrwGetAction((input) => `/v1/crawl/${encodePathSegment(input.id)}`),
  batch_scrape: fastcrwPostAction("/v1/batch/scrape"),
  batch_scrape_get: fastcrwGetAction((input) => `/v1/batch/scrape/${encodePathSegment(input.id)}`),
  batch_scrape_cancel: fastcrwDeleteAction((input) => `/v1/batch/scrape/${encodePathSegment(input.id)}`),
  extract: fastcrwPostAction("/v1/extract"),
  extract_get: fastcrwGetAction((input) => `/v1/extract/${encodePathSegment(input.id)}`),
  extract_cancel: fastcrwDeleteAction((input) => `/v1/extract/${encodePathSegment(input.id)}`),
};

export function createFastcrwContext(
  values: Record<string, string>,
  metadata: Record<string, unknown>,
  apiKey: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): FastcrwActionContext {
  const baseUrl = optionalString(metadata.apiBaseUrl) ?? optionalString(values.baseUrl) ?? defaultApiBaseUrl;
  return {
    apiKey,
    apiBaseUrl: normalizeFastcrwApiBaseUrl(baseUrl),
    fetcher,
    signal,
  };
}

export const executors: ProviderExecutors = defineProviderExecutors<FastcrwActionContext>({
  service,
  handlers: fastcrwActionHandlers,
  async createContext(context: ExecutionContext, fetcher: typeof fetch): Promise<FastcrwActionContext> {
    const credential = await requireApiKeyCredential(context, service);
    return createFastcrwContext(credential.values, credential.metadata, credential.apiKey, fetcher, context.signal);
  },
  fallbackMessage: "fastCRW request failed",
});

export const credentialValidators: CredentialValidators = {
  async apiKey(input, { fetcher, signal }): Promise<CredentialValidationResult> {
    return validateFastcrwCredential(input.values, input.apiKey, fetcher, signal);
  },
};

export async function validateFastcrwCredential(
  values: Record<string, string>,
  apiKey: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<CredentialValidationResult> {
  const context = createFastcrwContext(values, {}, apiKey, fetcher, signal);
  const payload = optionalRecord(
    await fastcrwRequest({
      apiKey: context.apiKey,
      apiBaseUrl: context.apiBaseUrl,
      fetcher: context.fetcher,
      signal: context.signal,
      path: "/v1/capabilities",
      method: "GET",
      phase: "validate",
    }),
  );

  const host = new URL(context.apiBaseUrl).host;
  return {
    profile: {
      accountId: `fastcrw:${host}`,
      displayName: `fastCRW ${host}`,
    },
    grantedScopes: [],
    metadata: compactObject({
      apiBaseUrl: context.apiBaseUrl,
      validationEndpoint: "/v1/capabilities",
      version: optionalString(payload?.version),
      success: true,
    }),
  };
}

function fastcrwPostAction(path: string): FastcrwActionHandler {
  return (input, context) =>
    fastcrwRequest({
      apiKey: context.apiKey,
      apiBaseUrl: context.apiBaseUrl,
      fetcher: context.fetcher,
      signal: context.signal,
      method: "POST",
      path,
      body: compactObject({ ...input }),
      phase: "execute",
    });
}

function fastcrwGetAction(buildPath: (input: Record<string, unknown>) => string): FastcrwActionHandler {
  return (input, context) =>
    fastcrwRequest({
      apiKey: context.apiKey,
      apiBaseUrl: context.apiBaseUrl,
      fetcher: context.fetcher,
      signal: context.signal,
      method: "GET",
      path: buildPath(input),
      phase: "execute",
    });
}

function fastcrwDeleteAction(buildPath: (input: Record<string, unknown>) => string): FastcrwActionHandler {
  return (input, context) =>
    fastcrwRequest({
      apiKey: context.apiKey,
      apiBaseUrl: context.apiBaseUrl,
      fetcher: context.fetcher,
      signal: context.signal,
      method: "DELETE",
      path: buildPath(input),
      phase: "execute",
    });
}

interface FastcrwRequestInput {
  apiKey: string;
  apiBaseUrl: string;
  fetcher: typeof fetch;
  signal?: AbortSignal;
  method: string;
  path: string;
  body?: Record<string, unknown>;
  phase: FastcrwRequestPhase;
}

async function fastcrwRequest(input: FastcrwRequestInput): Promise<unknown> {
  const url = new URL(input.path, input.apiBaseUrl);

  let response: Response;
  try {
    response = await input.fetcher(url, {
      method: input.method,
      headers: buildFastcrwHeaders(input.apiKey, input.body !== undefined),
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      throw error;
    }
    throw new ProviderRequestError(
      502,
      error instanceof Error ? `fastCRW request failed: ${error.message}` : "fastCRW request failed",
    );
  }

  const payload = await readFastcrwPayload(response);
  if (!response.ok) {
    throw createFastcrwError(response.status, payload, input.phase);
  }

  return payload;
}

function buildFastcrwHeaders(apiKey: string, hasBody: boolean): Headers {
  const headers = new Headers({
    authorization: `Bearer ${apiKey}`,
    "user-agent": providerUserAgent,
  });
  if (hasBody) {
    headers.set("content-type", "application/json");
  }
  return headers;
}

async function readFastcrwPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return response.ok ? { data: text } : text;
  }
}

function createFastcrwError(status: number, payload: unknown, phase: FastcrwRequestPhase): ProviderRequestError {
  const message = readFastcrwErrorMessage(payload, status);
  if (status === 400 || status === 404) {
    return new ProviderRequestError(status, message, payload);
  }
  if (status === 401 || status === 403) {
    return new ProviderRequestError(phase === "validate" ? 400 : 401, message, payload);
  }
  if (status === 429) {
    return new ProviderRequestError(429, message, payload);
  }
  return new ProviderRequestError(status || 502, message, payload);
}

function readFastcrwErrorMessage(payload: unknown, status: number): string {
  if (typeof payload === "string" && payload) {
    return payload;
  }

  const body = optionalRecord(payload);
  if (!body) {
    return `fastCRW request failed with ${status}`;
  }

  const directError =
    optionalString(body.error) ?? optionalString(optionalRecord(body.error)?.message) ?? optionalString(body.message);
  return directError ?? `fastCRW request failed with ${status}`;
}

/**
 * Validates a fastCRW API base URL: must be public HTTPS, no embedded
 * credentials, no query/hash. Defaults to https://api.fastcrw.com.
 */
export function normalizeFastcrwApiBaseUrl(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return defaultApiBaseUrl;
  }

  const raw = requiredString(value, "baseUrl", credentialError);
  const url = assertPublicHttpUrl(raw, {
    fieldName: "baseUrl",
    createError: credentialError,
    allowPrivateNetwork: false,
  });

  if (url.username || url.password) {
    throw credentialError("baseUrl must not include credentials");
  }
  if (url.search || url.hash) {
    throw credentialError("baseUrl must not include query parameters or a fragment");
  }

  return url.toString().replace(/\/+$/u, "");
}

function encodePathSegment(value: unknown): string {
  return encodeURIComponent(String(value));
}

function credentialError(message: string): ProviderRequestError {
  return new ProviderRequestError(400, message);
}
