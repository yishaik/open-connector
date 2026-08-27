import { describe, expect, it } from "vitest";
import { readRunRequestOrigin } from "./run-request-origin.ts";

describe("readRunRequestOrigin", () => {
  it("prefers Cloudflare connecting IP and country", () => {
    expect(
      readRunRequestOrigin(
        new Headers({
          "cf-connecting-ip": "203.0.113.10",
          "cf-ipcountry": "IL",
          "x-forwarded-for": "198.51.100.1, 203.0.113.10",
          "user-agent": "Cursor/1.0",
          host: "open-connector-api.yishai-k.workers.dev",
        }),
      ),
    ).toEqual({
      ip: "203.0.113.10",
      country: "IL",
      userAgent: "Cursor/1.0",
      host: "open-connector-api.yishai-k.workers.dev",
    });
  });

  it("falls back to the first X-Forwarded-For hop", () => {
    expect(readRunRequestOrigin(new Headers({ "x-forwarded-for": " 198.51.100.9 , 10.0.0.1 " }))).toEqual({
      ip: "198.51.100.9",
    });
  });

  it("returns undefined when no origin headers are present", () => {
    expect(readRunRequestOrigin(new Headers())).toBeUndefined();
  });
});
