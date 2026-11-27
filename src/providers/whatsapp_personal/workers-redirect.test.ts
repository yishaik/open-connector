import { describe, expect, it, vi } from "vitest";
import { credentialValidators } from "./executors.ts";

const input = {
  apiKey: "synthetic-bearer",
  values: {
    apiKey: "synthetic-bearer",
    baseUrl: "https://bridge.example.com",
    cfAccessClientId: "synthetic-client",
    cfAccessClientSecret: "synthetic-secret",
  },
};

describe("WhatsApp Workers credential validation", () => {
  it("uses manual redirect mode supported by Workers", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.redirect !== "manual") throw new TypeError("Invalid redirect value");
      return Response.json({ connected: true, archiveReady: true });
    });
    await expect(credentialValidators.apiKey!(input, { fetcher })).resolves.toMatchObject({
      profile: { displayName: "WhatsApp Personal Bridge" },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer synthetic-bearer",
      "CF-Access-Client-Id": "synthetic-client",
      "CF-Access-Client-Secret": "synthetic-secret",
    });
  });

  it("refuses an unfollowed redirect without forwarding credentials", async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://other.example.com/" },
    }));
    await expect(credentialValidators.apiKey!(input, { fetcher })).rejects.toThrow("WhatsApp bridge rejected request");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
