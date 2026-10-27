import { describe, expect, it } from "vitest";

import { buildBingUrls, dispatchBing, planBingRequest } from "./bing";

describe("Bing adapter", () => {
  it("sends apikey only in the request URL and exposes a key-free diagnostic URL", async () => {
    const apiKey = "secret+/key=value";
    let capturedUrl = "";
    const result = await dispatchBing({
      operation: { adapterKey: "traffic.query", input: { query: "clone site" } },
      config: { siteUrl: "https://example.com/" },
      credentials: { apiKey },
      signal: new AbortController().signal,
      fetch: async (input) => {
        capturedUrl = String(input);
        return new Response(JSON.stringify({ d: [{ Clicks: 1 }] }), {
          status: 200,
          headers: { "x-ms-request-id": "bing-123" },
        });
      },
    });

    expect(capturedUrl).toContain(`apikey=${encodeURIComponent(apiKey)}`);
    expect(new URL(capturedUrl).searchParams.get("query")).toBe("clone site");
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        providerRequestId: "bing-123",
        data: expect.objectContaining({ rowCount: 1 }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(JSON.stringify(result)).not.toContain(encodeURIComponent(apiKey));
  });

  it("redacts encoded and decoded API key variants from every provider failure path", async () => {
    const apiKey = "danger+/token=value";
    const result = await dispatchBing({
      operation: { adapterKey: "sites.list", input: {} },
      config: {},
      credentials: { apiKey },
      signal: new AbortController().signal,
      fetch: async () =>
        new Response(JSON.stringify({ ErrorCode: 3, Message: `bad ${apiKey}` }), {
          status: 400,
        }),
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        code: "AUTH_FAILED",
        details: expect.objectContaining({
          httpStatus: 400,
          providerCode: 3,
          diagnosticUrl: "https://ssl.bing.com/webmaster/api.svc/json/GetUserSites",
        }),
      }),
    );
    const rendered = JSON.stringify(result);
    expect(rendered).not.toContain(apiKey);
    expect(rendered).not.toContain(encodeURIComponent(apiKey));
  });

  it("plans only fixed-origin reviewed methods", () => {
    const plan = planBingRequest(
      { adapterKey: "links.url", input: { link: "https://example.com/docs", page: 0 } },
      { siteUrl: "https://example.com/" },
    );
    expect(plan).toEqual({
      method: "GET",
      endpoint:
        "https://ssl.bing.com/webmaster/api.svc/json/GetUrlLinks?siteUrl=https%3A%2F%2Fexample.com%2F&link=https%3A%2F%2Fexample.com%2Fdocs&page=0",
      diagnosticUrl:
        "https://ssl.bing.com/webmaster/api.svc/json/GetUrlLinks?siteUrl=https%3A%2F%2Fexample.com%2F&link=https%3A%2F%2Fexample.com%2Fdocs&page=0",
    });
    expect(buildBingUrls({ method: "GetUserSites", params: {} }).requestUrl).toBeNull();
  });

  it("POSTs URL and sitemap submissions as JSON with the site in the body", async () => {
    const captured: { url: string; init: RequestInit | undefined }[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({ url: String(input), init });
      return new Response(JSON.stringify({ d: null }), { status: 200 });
    };
    const urls = await dispatchBing({
      operation: {
        adapterKey: "urls.submit",
        input: { urlList: ["https://example.com/a", "https://example.com/b"] },
      },
      config: { siteUrl: "https://example.com/" },
      credentials: { apiKey: "key" },
      signal: new AbortController().signal,
      fetch,
    });
    const feed = await dispatchBing({
      operation: { adapterKey: "sitemaps.submit", input: { feedUrl: "https://example.com/sitemap.xml" } },
      config: { siteUrl: "https://example.com/" },
      credentials: { apiKey: "key" },
      signal: new AbortController().signal,
      fetch,
    });

    expect(urls).toMatchObject({ ok: true, data: { rowCount: 0 } });
    expect(feed).toMatchObject({ ok: true });
    expect(captured.map(({ url, init }) => [new URL(url).pathname, init?.method])).toEqual([
      ["/webmaster/api.svc/json/SubmitUrlbatch", "POST"],
      ["/webmaster/api.svc/json/SubmitFeed", "POST"],
    ]);
    expect(new URL(captured[0]!.url).searchParams.has("siteUrl")).toBe(false);
    expect(JSON.parse(String(captured[0]!.init?.body))).toEqual({
      siteUrl: "https://example.com/",
      urlList: ["https://example.com/a", "https://example.com/b"],
    });
    expect(JSON.parse(String(captured[1]!.init?.body))).toEqual({
      siteUrl: "https://example.com/",
      feedUrl: "https://example.com/sitemap.xml",
    });
  });

  it("plans submissions as POST and rejects URLs outside the site before dispatch", () => {
    expect(
      planBingRequest(
        { adapterKey: "urls.submit", input: { urlList: ["https://example.com/a"] } },
        { siteUrl: "https://example.com/" },
      ),
    ).toMatchObject({ method: "POST", endpoint: "https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlbatch" });
    expect(
      planBingRequest({ adapterKey: "urls.submission-quota", input: {} }, { siteUrl: "https://example.com/" }),
    ).toMatchObject({ method: "GET" });
    expect(() =>
      planBingRequest(
        { adapterKey: "urls.submit", input: { urlList: ["https://other.example/a"] } },
        { siteUrl: "https://example.com/" },
      ),
    ).toThrow("must belong to");
    expect(() =>
      planBingRequest(
        { adapterKey: "sitemaps.submit", input: { feedUrl: "https://other.example/sitemap.xml" } },
        { siteUrl: "https://example.com/" },
      ),
    ).toThrow("must belong to");
  });

  it("sends URL-valued parameters unquoted so Bing accepts their scheme", () => {
    const plan = planBingRequest(
      { adapterKey: "urls.info", input: { url: "https://example.com/docs" } },
      { siteUrl: "https://example.com/" },
    );
    expect(new URL(plan.endpoint).searchParams.get("url")).toBe("https://example.com/docs");
  });
});
