import type { CloudflareEnv } from "../src/server/cloudflare/cloudflare-env.ts";

import worker from "../src/server/cloudflare-embedded.ts";

interface StagingEnv extends CloudflareEnv {
  PERF_TOKEN?: string;
}

export default {
  fetch(request: Request, env: StagingEnv, ctx: Parameters<typeof worker.fetch>[2]): Promise<Response> | Response {
    if (!env.PERF_TOKEN || request.headers.get("authorization") !== `Bearer ${env.PERF_TOKEN}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    return worker.fetch(
      request,
      {
        ...env,
        OOMOL_CONNECT_ADMIN_TOKEN: env.PERF_TOKEN,
        OOMOL_CONNECT_RUNTIME_TOKEN: env.PERF_TOKEN,
        OOMOL_CONNECT_ENCRYPTION_KEY: env.PERF_TOKEN,
      },
      ctx,
    );
  },
};
