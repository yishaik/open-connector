import type { RunRequestOrigin } from "../storage/runtime-store.ts";

export type { RunRequestOrigin };

const userAgentMaxLength = 256;

export function readRunRequestOrigin(headers: Headers): RunRequestOrigin | undefined {
  const origin: RunRequestOrigin = {
    ip: firstHeader(headers, "cf-connecting-ip", "true-client-ip") ?? firstForwardedFor(headers.get("x-forwarded-for")),
    country: normalizeHeader(headers.get("cf-ipcountry")),
    userAgent: clip(normalizeHeader(headers.get("user-agent")), userAgentMaxLength),
    host: normalizeHeader(headers.get("host")),
  };
  return origin.ip || origin.country || origin.userAgent || origin.host ? origin : undefined;
}

function firstHeader(headers: Headers, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = normalizeHeader(headers.get(name));
    if (value) {
      return value;
    }
  }
  return undefined;
}

function firstForwardedFor(value: string | null): string | undefined {
  const first = value?.split(",")[0];
  return normalizeHeader(first ?? null);
}

function normalizeHeader(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function clip(value: string | undefined, max: number): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length > max ? value.slice(0, max) : value;
}
