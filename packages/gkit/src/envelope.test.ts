import { describe, expect, it } from "vitest";

import {
  formatUsdMicros,
  GkitFailure,
  parseUsdMicros,
  SecretRegistry,
  serializeEnvelope,
  toFailureEnvelope,
} from "./envelope";

describe("money conversion", () => {
  it("round-trips integer micros without floating-point arithmetic", () => {
    expect(parseUsdMicros("0.024036")).toBe(24_036);
    expect(formatUsdMicros(24_036)).toBe("0.024036");
    expect(parseUsdMicros("12.5")).toBe(12_500_000);
  });

  it("rejects ambiguous or over-precise amounts", () => {
    expect(() => parseUsdMicros("1e-3")).toThrow(GkitFailure);
    expect(() => parseUsdMicros("0.0000001")).toThrow(GkitFailure);
    expect(() => parseUsdMicros("-1")).toThrow(GkitFailure);
  });
});

describe("secret redaction", () => {
  it("redacts raw, encoded, JSON-escaped, and Basic auth forms", () => {
    const secrets = new SecretRegistry();
    const login = "agent+growth@example.com";
    const password = 'p@ss word/"line';
    secrets.registerBasicAuth(login, password);

    const basic = Buffer.from(`${login}:${password}`, "utf8").toString("base64");
    const unsafe = [
      login,
      password,
      encodeURIComponent(password),
      new URLSearchParams({ value: password }).toString().slice(6),
      JSON.stringify(password).slice(1, -1),
      basic,
      `Basic ${basic}`,
    ].join(" | ");

    const redacted = secrets.redact(unsafe);
    expect(redacted).not.toContain(login);
    expect(redacted).not.toContain(password);
    expect(redacted).not.toContain(basic);
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts serialized envelopes and scans artifact bytes", () => {
    const secrets = new SecretRegistry();
    secrets.register("secret-token");
    const serialized = serializeEnvelope(
      {
        ok: true,
        data: { diagnostic: "secret-token" },
        meta: {
          profile: null,
          provider: null,
          capability: null,
          effects: [],
          operationId: null,
          artifact: null,
          providerRequestId: null,
          spend: null,
        },
      },
      secrets,
    );
    expect(serialized).not.toContain("secret-token");
    expect(secrets.contains(Buffer.from("prefix secret-token suffix"))).toBe(true);
  });

  it("keeps the envelope valid JSON even when a secret is JSON punctuation", () => {
    const secrets = new SecretRegistry();
    secrets.register("{");
    const serialized = serializeEnvelope(
      {
        ok: true,
        data: { diagnostic: "{" },
        meta: {
          profile: null,
          provider: null,
          capability: null,
          effects: [],
          operationId: null,
          artifact: null,
          providerRequestId: null,
          spend: null,
        },
      },
      secrets,
    );
    expect(() => JSON.parse(serialized)).not.toThrow();
    expect(JSON.parse(serialized)).toMatchObject({
      ok: true,
      data: { diagnostic: "[REDACTED]" },
    });
  });
});

describe("failure normalization", () => {
  it("does not expose arbitrary exception messages", () => {
    const envelope = toFailureEnvelope(new Error("token=do-not-print"));
    expect(JSON.stringify(envelope)).not.toContain("do-not-print");
    expect(envelope.error.code).toBe("INTERNAL_ERROR");
  });
});
