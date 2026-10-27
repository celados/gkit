import { describe, expect, it } from "vitest";

import { buildPageSpeedUrls, dispatchPageSpeed, planPageSpeedRequest } from "./pagespeed";

const operation = {
  adapterKey: "run",
  input: { url: "https://example.com/", strategy: "desktop", categories: ["seo", "accessibility"] },
};

describe("PageSpeed adapter", () => {
  it("builds repeated category params and keeps the key out of the diagnostic URL", () => {
    const urls = buildPageSpeedUrls(operation, "secret+/key");
    const request = new URL(urls.requestUrl);
    expect(request.searchParams.get("url")).toBe("https://example.com/");
    expect(request.searchParams.get("strategy")).toBe("DESKTOP");
    expect(request.searchParams.getAll("category")).toEqual(["SEO", "ACCESSIBILITY"]);
    expect(request.searchParams.get("key")).toBe("secret+/key");
    expect(new URL(urls.diagnosticUrl).searchParams.has("key")).toBe(false);
    expect(planPageSpeedRequest(operation, {})).toMatchObject({
      method: "GET",
      endpoint: urls.diagnosticUrl,
    });
  });

  it("defaults to mobile performance and SEO and rejects unreviewed input", () => {
    const request = new URL(
      buildPageSpeedUrls({ adapterKey: "run", input: { url: "https://example.com/" } }).requestUrl,
    );
    expect(request.searchParams.get("strategy")).toBe("MOBILE");
    expect(request.searchParams.getAll("category")).toEqual(["PERFORMANCE", "SEO"]);
    expect(() => buildPageSpeedUrls({ adapterKey: "run", input: { url: "ftp://example.com" } })).toThrow();
    expect(() =>
      buildPageSpeedUrls({ adapterKey: "run", input: { url: "https://example.com", categories: ["pwa"] } }),
    ).toThrow();
  });

  it.each([
    [400, "PROVIDER_ERROR", "confirmed"],
    [403, "AUTH_FAILED", "confirmed"],
    [429, "RATE_LIMITED", "confirmed"],
    [500, "UNKNOWN_OUTCOME", "unknown"],
  ] as const)("maps HTTP %s to %s without echoing the key", async (status, code, outcome) => {
    const apiKey = "danger+/token=value";
    const result = await dispatchPageSpeed({
      operation,
      config: {},
      credentials: { apiKey },
      signal: new AbortController().signal,
      fetch: async () => new Response(JSON.stringify({ error: { code: status } }), { status }),
    });
    expect(result).toMatchObject({ ok: false, code, outcome, details: { httpStatus: status } });
    const { rawBytes: _rawBytes, ...rest } = result as { rawBytes: unknown };
    expect(JSON.stringify(rest)).not.toContain(apiKey);
    expect(JSON.stringify(rest)).not.toContain(encodeURIComponent(apiKey));
  });

  it("reports a timeout as an unknown outcome", async () => {
    const result = await dispatchPageSpeed({
      operation,
      config: {},
      credentials: { apiKey: null },
      signal: new AbortController().signal,
      timeoutMs: 5,
      fetch: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    });
    expect(result).toMatchObject({ ok: false, code: "TIMEOUT", outcome: "unknown" });
  });
});
