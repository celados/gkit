import { describe, expect, it } from "vitest";

import { dispatchGsc, gscArtifactFormat, planGscRequest } from "./gsc";

describe("GSC adapter", () => {
  it("encodes the property path and keeps Search Analytics as a POST read", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    const result = await dispatchGsc({
      operation: {
        adapterKey: "search-analytics.query",
        input: {
          startDate: "2026-07-01",
          endDate: "2026-07-07",
          dimensions: ["query"],
          rowLimit: 25,
        },
      },
      config: { siteUrl: "sc-domain:example.com" },
      credentials: { accessToken: "access-secret" },
      signal: new AbortController().signal,
      fetch: async (input, init) => {
        capturedUrl = String(input);
        capturedBody = String(init?.body);
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-secret");
        return new Response(JSON.stringify({ rows: [{ keys: ["clone site"], clicks: 1 }] }), {
          status: 200,
        });
      },
    });

    expect(capturedUrl).toBe(
      "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query",
    );
    expect(JSON.parse(capturedBody)).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      dimensions: ["query"],
      rowLimit: 25,
    });
    expect(result).toEqual(expect.objectContaining({ ok: true, data: { rowCount: 1 } }));
    expect(JSON.stringify(result)).not.toContain("access-secret");
  });

  it("maps Google errors to an allowlisted projection", async () => {
    const result = await dispatchGsc({
      operation: { adapterKey: "properties.list", input: {} },
      config: {},
      credentials: { accessToken: "access-secret" },
      signal: new AbortController().signal,
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: {
              status: "PERMISSION_DENIED",
              message: "do not project this provider message",
              details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT", metadata: { token: "x" } }],
            },
          }),
          { status: 403 },
        ),
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        code: "AUTH_FAILED",
        details: {
          httpStatus: 403,
          providerStatus: "PERMISSION_DENIED",
          reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
        },
      }),
    );
    expect(JSON.stringify(result)).not.toContain("do not project");
    expect(JSON.stringify(result)).not.toContain("access-secret");
  });

  it("uses the fixed URL Inspection endpoint", () => {
    expect(
      planGscRequest(
        {
          adapterKey: "url-inspection.inspect",
          input: { inspectionUrl: "https://example.com/docs" },
        },
        { siteUrl: "https://example.com/" },
      ),
    ).toEqual({
      method: "POST",
      endpoint: "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
    });
  });
  describe("sitemaps.submit", () => {
    const feedpath = "https://example.com/sitemap.xml?lang=en&v=2";
    const submit = { adapterKey: "sitemaps.submit", input: { feedpath } } as const;

    it.each([200, 204])(
      "PUTs to the encoded sitemap path with no body and writes a receipt for an empty %i",
      async (status) => {
        const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
        const result = await dispatchGsc({
          operation: submit,
          config: { siteUrl: "sc-domain:example.com" },
          credentials: { accessToken: "access-secret" },
          signal: new AbortController().signal,
          fetch: async (input, init) => {
            calls.push({ url: String(input), init });
            return new Response(status === 204 ? null : "", { status });
          },
        });

        expect(calls).toHaveLength(1);
        expect(calls[0]!.url).toBe(
          "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/sitemaps/https%3A%2F%2Fexample.com%2Fsitemap.xml%3Flang%3Den%26v%3D2",
        );
        expect(calls[0]!.init?.method).toBe("PUT");
        expect(calls[0]!.init?.body).toBeUndefined();
        const headers = new Headers(calls[0]!.init?.headers);
        expect(headers.get("authorization")).toBe("Bearer access-secret");
        expect(headers.has("content-type")).toBe(false);

        expect(result).toEqual({
          ok: true,
          providerRequestId: null,
          rawBytes: expect.any(Uint8Array),
          data: { submitted: true, siteUrl: "sc-domain:example.com", feedpath, httpStatus: status },
        });
        if (!result.ok) throw new Error("expected success");
        expect(Buffer.from(result.rawBytes).toString("utf8")).toBe(
          `${JSON.stringify(
            {
              feedpath,
              httpStatus: status,
              operation: "sitemaps.submit",
              provider: "gsc",
              siteUrl: "sc-domain:example.com",
              submitted: true,
            },
            null,
            2,
          )}\n`,
        );
        expect(JSON.stringify(result)).not.toContain("access-secret");
      },
    );

    it("prefers an explicit siteUrl input and plans a PUT", () => {
      expect(
        planGscRequest(
          { adapterKey: "sitemaps.submit", input: { siteUrl: "https://example.com/", feedpath } },
          { siteUrl: "sc-domain:other.com" },
        ),
      ).toEqual({
        method: "PUT",
        endpoint:
          "https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fexample.com%2F/sitemaps/https%3A%2F%2Fexample.com%2Fsitemap.xml%3Flang%3Den%26v%3D2",
      });
      expect(gscArtifactFormat(submit)).toBe("gkit-gsc-sitemap-submit-receipt");
      expect(gscArtifactFormat({ adapterKey: "sitemaps.get", input: { feedpath } })).toBe(
        "exact-gsc-json-response",
      );
    });

    it("rejects a non-HTTP feedpath before dispatch", () => {
      expect(() =>
        planGscRequest(
          { adapterKey: "sitemaps.submit", input: { feedpath: "ftp://example.com/sitemap.xml" } },
          { siteUrl: "sc-domain:example.com" },
        ),
      ).toThrow("feedpath must be an absolute HTTP URL");
    });

    it("explains a 403 for a Restricted service account as a missing write permission", async () => {
      const googleBody = JSON.stringify({
        error: {
          code: 403,
          message: "User does not have sufficient permission for site 'sc-domain:example.com'.",
          errors: [{ message: "insufficient permission", domain: "global", reason: "forbidden" }],
          status: "PERMISSION_DENIED",
        },
      });
      const result = await dispatchGsc({
        operation: submit,
        config: { siteUrl: "sc-domain:example.com" },
        credentials: { accessToken: "access-secret" },
        signal: new AbortController().signal,
        fetch: async () => new Response(googleBody, { status: 403 }),
      });

      expect(result).toEqual(
        expect.objectContaining({
          ok: false,
          code: "AUTH_FAILED",
          outcome: "confirmed",
          retryable: false,
          details: {
            httpStatus: 403,
            providerStatus: "PERMISSION_DENIED",
            requiredPermissionLevel: "siteFullUser",
          },
        }),
      );
      if (result.ok) throw new Error("expected failure");
      expect(result.message).toMatch(/lacks write permission/);
      expect(result.message).toMatch(/Restricted user/);
      expect(Buffer.from(result.rawBytes!).toString("utf8")).toBe(googleBody);
    });

    it("keeps the existing mapping for other non-2xx submission responses", async () => {
      const dispatch = async (status: number) =>
        await dispatchGsc({
          operation: submit,
          config: { siteUrl: "sc-domain:example.com" },
          credentials: { accessToken: "access-secret" },
          signal: new AbortController().signal,
          fetch: async () =>
            new Response(JSON.stringify({ error: { status: "X" } }), { status }),
        });
      expect(await dispatch(401)).toMatchObject({
        code: "AUTH_FAILED",
        message: "GSC rejected the configured credentials or property access.",
      });
      expect(await dispatch(429)).toMatchObject({ code: "RATE_LIMITED", retryable: true });
      expect(await dispatch(503)).toMatchObject({ code: "UNKNOWN_OUTCOME", outcome: "unknown" });
      expect(await dispatch(400)).toMatchObject({
        code: "PROVIDER_ERROR",
        message: "GSC rejected the sitemap submission.",
      });
    });
  });
});
