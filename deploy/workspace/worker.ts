interface ConsoleEnvironment {
  ASSETS: { fetch(request: Request): Promise<Response> };
  ORIGIN: { fetch(request: Request): Promise<Response> };
}

const consoleSections = new Set([
  "",
  "workspace",
  "overview",
  "providers",
  "oauth-apps",
  "actions",
  "runs",
  "access",
  "resources",
]);

export default {
  async fetch(request: Request, env: ConsoleEnvironment): Promise<Response> {
    const url = new URL(request.url);
    const section = url.pathname.split("/")[1] ?? "";
    const assetRequest = url.pathname.startsWith("/ui-assets/");
    if ((request.method !== "GET" && request.method !== "HEAD") || (!assetRequest && !consoleSections.has(section))) {
      // Keep authentication, OAuth, APIs, MCP and legacy assets on the exact
      // deployed backend, including its original catalog and secret bindings.
      return env.ORIGIN.fetch(request);
    }
    url.pathname = assetRequest ? url.pathname.slice("/ui-assets".length) : "/index.html";
    return env.ASSETS.fetch(new Request(url, request));
  },
};
