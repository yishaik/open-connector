import type { CredentialValidators, ProviderExecutors } from "../../core/types.ts";
import type { ApiKeyProviderContext, ProviderActionHandlers } from "../provider-runtime.ts";

import { compactObject, optionalRecord, optionalString, requiredString } from "../../core/cast.ts";
import { assertPublicHttpUrl } from "../../core/request.ts";
import { defineApiKeyProviderExecutors, providerUserAgent, ProviderRequestError } from "../provider-runtime.ts";

const service = "fastcrw";
const defaultApiBaseUrl = "https://api.fastcrw.com";

type FastcrwRequestPhase = "validate" | "execute";

interface FastcrwActionContext extends ApiKeyProviderContext {
  apiBaseUrl: string;
}

type FastcrwActionHandler = (input: Record<string, unknown>, context: FastcrwActionContext) => Promise<unknown>;

export const fastcrwActionHandlers: ProviderActionHandlers<"fastcrw", FastcrwActionHandler> = {
  scrape: fastcrwPostAction("/v1/scrape", buildDirectBody),
  map: fastcrwPostAction("/v1/map", buildDirectBody),
  search: fastcrwPostAction("/v1/search", buildDirectBody),
  crawl: fastcrwPostAction("/v1/crawl", buildDirectBody),
  crawl_get: fastcrwGetAction((input) => `/v1/crawl/${encodePathSegment(input.id)}`),
  batch_scrape: fastcrwPostAction("/v1/batch/scrape", buildDirectBody),
  batch_scrape_get: fastcrwGetAction((input) => `/v1/batch/scrape/${encodePathSegment(input.id)}`),
  batch_scrape_cancel: fastcrwDeleteAction((input) => `/v1/batch/scrape/${encodePathSegment(input.id)}`),
  extract: fastcrwPostAction("/v1/extract", buildDirectBody),
  extract_get: fastcrwGetAction((input) => `/v1/extract/${encodePathSegment(input.id)}`),
  extract_cancel: fastcrwDeleteAction((input) => `/v1/extract/${encodePathSegment(input.id)}`),
};

export const executors: ProviderExecutors = defineApiKeyProviderExecutors(service, {
  scrape: wrapHandler(fastcrwActionHandlers.scrape),
  map: wrapHandler(fastcrwActionHandlers.map),
  search: wrapHandler(fastcrwActionHandlers.search),
  crawl: wrapHandler(fastcrwActionHandlers.crawl),
  crawl_get: wrapHandler(fastcrwActionHandlers.crawl_get),
  batch_scrape: wrapHandler(fastcrwActionHandlers.batch_scrape),
  batch_scrape_get: wrapHandler(fastcrwActionHandlers.batch_scrape_get),
  batch_scrape_cancel: wrapHandler(fastcrwActionHandlers.batch_scrape_cancel),
  extract: wrapHandler(fastcrwActionHandlers.extract),
  extract_get: wrapHandler(fastcrwActionHandlers.extract_get),
  extract_cancel: wrapHandler(fastcrwActionHandlers.extract_cancel),
});

export const credentialValidators: CredentialValidators = {
  async apiKey(input, { fetcher, signal }) {
    const baseUrl = normalizeFastcrwApiBaseUrl(input.values.baseUrl);
    const payload = optionalRecord(
      await fastcrwRequest({
        apiKey: input.apiKey,
        apiBaseUrl: baseUrl,
        fetcher,
        signal,
        path: "/v1/capabilities",
        method: "GET",
        phase: "validate",
      }),
    );

    const host = new URL(baseUrl).host;
    return {
      profile: {
        accountId: `fastcrw:${host}`,
        displayName: `fastCRW ${host}`,
      },
      grantedScopes: [],
      metadata: compactObject({
        apiBaseUrl: baseUrl,
        validationEndpoint: "/v1/capabilities",
        version: optionalString(payload?.version),
        success: true,
      }),
    };
  },
};

function wrapHandler(
  handler: FastcrwActionHandler,
): (input: Record<string, unknown>, context: ApiKeyProviderContext) => Promise<unknown> {
  return async (input, context) => {
    const baseUrl = normalizeFastcrwApiBaseUrl(input.baseUrl ?? defaultApiBaseUrl);
    return handler(input, { ...context, apiBaseUrl: baseUrl });
  };
}

function fastcrwPostAction(
  path: string,
  buildBody: (input: Record<string, unknown>) => Record<string, unknown>,
): FastcrwActionHandler {
  return (input, context) =>
    fastcrwRequest({
      apiKey: context.apiKey,
      apiBaseUrl: context.apiBaseUrl,
      fetcher: context.fetcher,
      signal: context.signal,
      method: "POST",
      path,
      body: buildBody(input),
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

function buildDirectBody(input: Record<string, unknown>): Record<string, unknown> {
  const body = { ...input };
  delete body.baseUrl;
  return compactObject(body);
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

function normalizeFastcrwApiBaseUrl(value: unknown): string {
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
