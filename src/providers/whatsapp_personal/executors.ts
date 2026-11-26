import type { CredentialValidators, ExecutionContext, ProviderExecutors, TransitFileWriter } from "../../core/types.ts";

import { Buffer } from "node:buffer";
import { readBoundedResponseBytes } from "../../core/request.ts";
import { defineProviderExecutors, requireApiKeyCredential, ProviderRequestError } from "../provider-runtime.ts";
import { actions } from "./actions.ts";

const service = "whatsapp_personal";
const maxResponse = 6 * 1024 * 1024;
const maxMedia = 4 * 1024 * 1024;

interface Context {
  apiKey: string;
  baseUrl: string;
  fetcher: typeof fetch;
  signal?: AbortSignal;
  transitFiles?: TransitFileWriter;
}

function origin(value: unknown): string {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.port) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new ProviderRequestError(400, "Bridge URL must be a bare HTTPS origin");
  }
}

async function request(ctx: Context, name: string, input: Record<string, unknown>): Promise<unknown> {
  const res = await ctx.fetcher(new URL("/v1/actions/" + name, ctx.baseUrl), {
    method: "POST",
    redirect: "error",
    headers: { authorization: "Bearer " + ctx.apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(input),
    signal: ctx.signal,
  });
  if (!res.ok) {
    throw new ProviderRequestError(res.status, "WhatsApp bridge rejected request");
  }
  const bytes = await readBoundedResponseBytes(res, {
    maxBytes: maxResponse,
    fieldName: "WhatsApp response",
    createError: (message) => new ProviderRequestError(502, message),
  });
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ProviderRequestError(502, "WhatsApp bridge returned invalid JSON");
  }
}

async function media(ctx: Context, input: Record<string, unknown>): Promise<unknown> {
  if (!ctx.transitFiles) {
    throw new ProviderRequestError(503, "Secure transit storage is unavailable");
  }
  const result = await request(ctx, "get_media", input);
  if (typeof result !== "object" || result === null || !("dataBase64" in result) || !("mimeType" in result)) {
    throw new ProviderRequestError(502, "Invalid bridge media response");
  }
  const { dataBase64, mimeType } = result;
  if (typeof dataBase64 !== "string" || typeof mimeType !== "string" ||
      !/^(image\/(jpeg|png|webp|gif)|audio\/(ogg|mpeg|mp4|wav|aac)|application\/pdf)$/.test(mimeType.split(";")[0]!.trim())) {
    throw new ProviderRequestError(415, "Unsupported media type");
  }
  const bytes = Buffer.from(dataBase64, "base64");
  if (bytes.length === 0 || bytes.length > maxMedia || bytes.length > ctx.transitFiles.maxBytes) {
    throw new ProviderRequestError(413, "Media exceeds the configured size limit");
  }
  const type = mimeType.split(";")[0]!.trim();
  const ext = type === "application/pdf" ? "pdf" : type.split("/")[1];
  const file = new File([new Uint8Array(bytes)], "whatsapp-attachment." + ext, { type });
  const stored = await ctx.transitFiles.create(file);
  return { ...stored, mimeType: type, source: "whatsapp_personal" };
}

const handlers = Object.fromEntries(actions.map((a) => [
  a.name,
  (input: Record<string, unknown>, ctx: Context) => a.name === "get_media" ? media(ctx, input) : request(ctx, a.name, input),
]));

export const executors: ProviderExecutors = defineProviderExecutors<Context>({
  service,
  handlers,
  async createContext(context: ExecutionContext, fetcher: typeof fetch) {
    const credential = await requireApiKeyCredential(context, service);
    return {
      apiKey: credential.apiKey,
      baseUrl: origin(credential.values.baseUrl),
      fetcher,
      signal: context.signal,
      transitFiles: context.transitFiles,
    };
  },
});

export const credentialValidators: CredentialValidators = {
  async apiKey(input, { fetcher, signal }) {
    const baseUrl = origin(input.values.baseUrl);
    const status = await request({ apiKey: input.apiKey, baseUrl, fetcher, signal }, "get_status", {});
    if (typeof status !== "object" || status === null || !("connected" in status) || status.connected !== true) {
      throw new ProviderRequestError(409, "Link WhatsApp from the owner QR page before saving the connection");
    }
    return { profile: { displayName: "WhatsApp Personal Bridge" }, grantedScopes: [], metadata: { baseUrl } };
  },
};
