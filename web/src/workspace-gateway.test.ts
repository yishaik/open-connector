import { describe, expect, it, vi } from "vitest";
import gateway from "../../deploy/workspace/worker";

describe("console gateway", () => {
  it("leaves API, OAuth, MCP, catalog and legacy asset requests on the existing backend", async () => {
    for (const path of [
      "/api/auth/session",
      "/api/runtime-tokens",
      "/mcp",
      "/v1/actions",
      "/oauth/callback",
      "/catalog/index.json",
      "/assets/legacy.js",
      "/docs",
    ]) {
      const request = new Request(`https://connect.yishaik.com${path}`, {
        headers: { Authorization: "Bearer test-only" },
      });
      const origin = vi.fn(async () => new Response("backend"));
      const assets = vi.fn(async () => new Response("frontend"));
      await gateway.fetch(request, { ORIGIN: { fetch: origin }, ASSETS: { fetch: assets } });
      expect(origin).toHaveBeenCalledWith(request);
      expect(assets).not.toHaveBeenCalled();
    }
  });
  it("serves shell and prefixed assets without changing query strings", async () => {
    for (const [path, expected] of [
      ["/?oauth=done", "/index.html?oauth=done"],
      ["/workspace", "/index.html"],
      ["/ui-assets/assets/app.js", "/assets/app.js"],
    ]) {
      const assets = vi.fn(async (_request: Request) => new Response("frontend"));
      const origin = vi.fn(async () => new Response("backend"));
      await gateway.fetch(new Request(`https://connect.yishaik.com${path}`), {
        ORIGIN: { fetch: origin },
        ASSETS: { fetch: assets },
      });
      expect(assets.mock.calls[0]![0].url).toBe(`https://connect.yishaik.com${expected}`);
      expect(origin).not.toHaveBeenCalled();
    }
  });
  it("forwards POST requests unchanged instead of consuming their bodies", async () => {
    const request = new Request("https://connect.yishaik.com/api/runtime-tokens", {
      method: "POST",
      body: '{"allowedActions":["mail.read"]}',
    });
    const origin = vi.fn(async (input: Request) => new Response(await input.text()));
    const response = await gateway.fetch(request, { ORIGIN: { fetch: origin }, ASSETS: { fetch: vi.fn() } });
    expect(await response.text()).toBe('{"allowedActions":["mail.read"]}');
  });
});
