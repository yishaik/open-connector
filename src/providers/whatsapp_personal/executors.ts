import type { CredentialValidators, ExecutionContext, ProviderExecutors } from "../../core/types.ts";
import { defineProviderExecutors, requireApiKeyCredential, ProviderRequestError } from "../provider-runtime.ts";
import { optionalString } from "../../core/cast.ts";
import { actions } from "./actions.ts";

const service = "whatsapp_personal";
interface Context { apiKey: string; baseUrl: string; fetcher: typeof fetch; signal?: AbortSignal }
function origin(value: unknown): string {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.port) throw new Error();
    return url.origin;
  } catch { throw new ProviderRequestError(400, "Bridge URL must be a bare HTTPS origin"); }
}
async function request(ctx: Context, name: string, input: Record<string, unknown>): Promise<unknown> {
  const res = await ctx.fetcher(new URL("/v1/actions/" + name, ctx.baseUrl), {
    method: "POST", redirect: "error",
    headers: { authorization: "Bearer " + ctx.apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(input), signal: ctx.signal,
  });
  if (!res.ok) throw new ProviderRequestError(res.status, "WhatsApp bridge rejected request");
  return res.json();
}
const handlers = Object.fromEntries(actions.map(a => [a.name, (input: Record<string, unknown>, ctx: Context) => request(ctx, a.name, input)]));
export const executors: ProviderExecutors = defineProviderExecutors<Context>({
  service, handlers,
  async createContext(context: ExecutionContext, fetcher: typeof fetch) {
    const credential = await requireApiKeyCredential(context, service);
    return { apiKey: credential.apiKey, baseUrl: origin(credential.values?.baseUrl), fetcher, signal: context.signal };
  },
});
export const credentialValidators: CredentialValidators = {
  async apiKey(input, { fetcher, signal }) {
    const baseUrl = origin(input.values?.baseUrl);
    await request({ apiKey: input.apiKey, baseUrl, fetcher, signal }, "get_status", {});
    return { profile: { displayName: "WhatsApp Personal Bridge" }, grantedScopes: [], metadata: { baseUrl: optionalString(baseUrl) } };
  },
};
