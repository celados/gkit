import { Buffer } from "node:buffer";

import type { RawJsonDispatchResult } from "./raw-json";

export type GscConfig = Readonly<{ siteUrl?: string }>;
export type GscCredentials = Readonly<{ accessToken: string }>;
export type GscOperation = Readonly<{
  adapterKey: string;
  input: Readonly<Record<string, unknown>>;
}>;
export type GscFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const defaultGscTimeoutMs = 30_000;
const webmastersOrigin = "https://www.googleapis.com/webmasters/v3";
const inspectionEndpoint = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

type GscRequest = {
  method: "GET" | "POST" | "PUT";
  url: string;
  body?: Record<string, unknown>;
  rowsKey?: string;
  // Present only for sitemaps.submit: Google acknowledges it with an empty body.
  submission?: { siteUrl: string; feedpath: string };
};

const submitReceiptFormat = "gkit-gsc-sitemap-submit-receipt";

export function gscArtifactFormat(operation: GscOperation): string {
  return operation.adapterKey === "sitemaps.submit"
    ? submitReceiptFormat
    : "exact-gsc-json-response";
}

export function planGscRequest(
  operation: GscOperation,
  config: GscConfig,
): { method: GscRequest["method"]; endpoint: string } {
  const request = buildRequest(operation, config);
  return { method: request.method, endpoint: request.url };
}

export async function dispatchGsc(options: {
  operation: GscOperation;
  config: GscConfig;
  credentials: GscCredentials;
  signal: AbortSignal;
  fetch?: GscFetch;
  timeoutMs?: number;
}): Promise<RawJsonDispatchResult> {
  const timeoutMs = options.timeoutMs ?? defaultGscTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("GSC timeoutMs must be a positive safe integer.");
  }
  const request = buildRequest(options.operation, options.config);
  const dispatchSignal = createDispatchSignal(options.signal, timeoutMs);
  let response: Response;
  let rawBytes: Uint8Array;
  try {
    response = await (options.fetch ?? globalThis.fetch)(request.url, {
      method: request.method,
      headers: {
        authorization: `Bearer ${options.credentials.accessToken}`,
        accept: "application/json",
        ...(request.method === "POST" ? { "content-type": "application/json" } : {}),
      },
      ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      signal: dispatchSignal.signal,
    });
    rawBytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return failure({
      code: dispatchSignal.timedOut()
        ? "TIMEOUT"
        : options.signal.aborted
          ? "UNKNOWN_OUTCOME"
          : "NETWORK_ERROR",
      message: dispatchSignal.timedOut()
        ? "The GSC request exceeded its deadline before the outcome was confirmed."
        : options.signal.aborted
          ? "The GSC request was interrupted before the outcome was confirmed."
          : "The GSC request ended without a confirmed provider outcome.",
      outcome: "unknown",
    });
  } finally {
    dispatchSignal.dispose();
  }

  const providerRequestId = safeRequestId(response);
  if (request.submission && response.ok) {
    return submissionReceipt(request.submission, response.status, providerRequestId);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(rawBytes).toString("utf8")) as unknown;
  } catch {
    return failure({
      code: response.ok ? "UNKNOWN_OUTCOME" : "PROVIDER_ERROR",
      message: "GSC returned an unreadable response body.",
      outcome: response.ok ? "unknown" : "confirmed",
      rawBytes,
      providerRequestId,
      details: { httpStatus: response.status },
    });
  }
  if (!response.ok) {
    const code =
      response.status === 401 || response.status === 403
        ? "AUTH_FAILED"
        : response.status === 429
          ? "RATE_LIMITED"
          : response.status === 408 || response.status >= 500
            ? "UNKNOWN_OUTCOME"
            : "PROVIDER_ERROR";
    // A Restricted user can read a property but gets 403 on writes; say so
    // instead of the generic credentials message.
    const writeDenied = Boolean(request.submission) && response.status === 403;
    return failure({
      code,
      message: writeDenied
        ? "GSC denied the sitemap submission: the service account lacks write permission on this property. A Restricted user can read but cannot submit sitemaps; grant it Full or Owner permission in Search Console."
        : code === "AUTH_FAILED"
          ? "GSC rejected the configured credentials or property access."
          : code === "RATE_LIMITED"
            ? "GSC rejected the request because its rate limit was reached."
            : request.submission
              ? "GSC rejected the sitemap submission."
              : "GSC rejected the read request.",
      outcome: code === "UNKNOWN_OUTCOME" ? "unknown" : "confirmed",
      rawBytes,
      providerRequestId,
      details: {
        httpStatus: response.status,
        ...safeGoogleError(payload),
        ...(writeDenied ? { requiredPermissionLevel: "siteFullUser" } : {}),
      },
    });
  }
  if (!isRecord(payload)) {
    return failure({
      code: "PROVIDER_ERROR",
      message: "GSC returned a successful status with an invalid result shape.",
      outcome: "confirmed",
      rawBytes,
      providerRequestId,
      details: { httpStatus: response.status, contract: "gsc_result_invalid" },
    });
  }
  const rows = request.rowsKey ? payload[request.rowsKey] : payload;
  if (request.rowsKey && rows !== undefined && !Array.isArray(rows)) {
    return failure({
      code: "PROVIDER_ERROR",
      message: "GSC returned a successful status with an invalid result collection.",
      outcome: "confirmed",
      rawBytes,
      providerRequestId,
      details: { httpStatus: response.status, contract: "gsc_collection_invalid" },
    });
  }
  return {
    ok: true,
    rawBytes,
    providerRequestId,
    data: { rowCount: Array.isArray(rows) ? rows.length : 1 },
  };
}

function buildRequest(operation: GscOperation, config: GscConfig): GscRequest {
  if (operation.adapterKey === "properties.list") {
    return { method: "GET", url: `${webmastersOrigin}/sites`, rowsKey: "siteEntry" };
  }
  const siteUrl = stringInput(operation.input, "siteUrl") ?? config.siteUrl;
  if (!siteUrl) throw new TypeError("GSC siteUrl is required in the profile or request input.");
  assertSiteUrl(siteUrl);
  if (operation.adapterKey === "url-inspection.inspect") {
    const inspectionUrl = requiredString(operation.input, "inspectionUrl");
    assertAbsoluteHttpUrl(inspectionUrl, "inspectionUrl");
    return {
      method: "POST",
      url: inspectionEndpoint,
      body: {
        inspectionUrl,
        siteUrl,
        ...(stringInput(operation.input, "languageCode")
          ? { languageCode: stringInput(operation.input, "languageCode") }
          : {}),
      },
    };
  }
  const sitePath = encodeURIComponent(siteUrl);
  if (operation.adapterKey === "search-analytics.query") {
    const { siteUrl: _siteUrl, ...body } = operation.input;
    return {
      method: "POST",
      url: `${webmastersOrigin}/sites/${sitePath}/searchAnalytics/query`,
      body,
      rowsKey: "rows",
    };
  }
  if (operation.adapterKey === "sitemaps.list") {
    const url = new URL(`${webmastersOrigin}/sites/${sitePath}/sitemaps`);
    const sitemapIndex = stringInput(operation.input, "sitemapIndex");
    if (sitemapIndex) url.searchParams.set("sitemapIndex", sitemapIndex);
    return { method: "GET", url: url.toString(), rowsKey: "sitemap" };
  }
  if (operation.adapterKey === "sitemaps.get" || operation.adapterKey === "sitemaps.submit") {
    const feedpath = requiredString(operation.input, "feedpath");
    assertAbsoluteHttpUrl(feedpath, "feedpath");
    const url = `${webmastersOrigin}/sites/${sitePath}/sitemaps/${encodeURIComponent(feedpath)}`;
    return operation.adapterKey === "sitemaps.get"
      ? { method: "GET", url }
      : { method: "PUT", url, submission: { siteUrl, feedpath } };
  }
  throw new TypeError("GSC adapter key is not reviewed.");
}

// sitemaps.submit succeeds with an empty body, so the artifact is a
// deterministic gkit receipt rather than provider bytes.
function submissionReceipt(
  submission: NonNullable<GscRequest["submission"]>,
  httpStatus: number,
  providerRequestId: string | null,
): RawJsonDispatchResult {
  const receipt = {
    feedpath: submission.feedpath,
    httpStatus,
    operation: "sitemaps.submit",
    provider: "gsc",
    siteUrl: submission.siteUrl,
    submitted: true,
  };
  return {
    ok: true,
    rawBytes: new Uint8Array(Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8")),
    providerRequestId,
    data: {
      submitted: true,
      siteUrl: submission.siteUrl,
      feedpath: submission.feedpath,
      httpStatus,
    },
  };
}

function stringInput(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function requiredString(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = stringInput(input, key);
  if (!value) throw new TypeError(`GSC ${key} is required.`);
  return value;
}

function assertSiteUrl(value: string): void {
  if (/^sc-domain:[A-Za-z0-9.-]+$/.test(value)) return;
  assertAbsoluteHttpUrl(value, "siteUrl");
}

function assertAbsoluteHttpUrl(value: string, key: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`GSC ${key} must be an absolute HTTP URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`GSC ${key} must be an absolute HTTP URL.`);
  }
}

function safeGoogleError(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload) || !isRecord(payload.error)) return {};
  const status = typeof payload.error.status === "string" ? payload.error.status : null;
  const details = Array.isArray(payload.error.details) ? payload.error.details : [];
  const reason = details
    .filter(isRecord)
    .map((detail) => detail.reason)
    .find((value): value is string => typeof value === "string" && /^[A-Z_]{1,80}$/.test(value));
  return { ...(status ? { providerStatus: status } : {}), ...(reason ? { reason } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeRequestId(response: Response): string | null {
  const value =
    response.headers.get("x-guploader-uploadid") ?? response.headers.get("x-request-id");
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null;
}

function failure(options: {
  code: Extract<RawJsonDispatchResult, { ok: false }>["code"];
  message: string;
  outcome: Extract<RawJsonDispatchResult, { ok: false }>["outcome"];
  details?: Record<string, unknown> | null;
  rawBytes?: Uint8Array | null;
  providerRequestId?: string | null;
}): RawJsonDispatchResult {
  return {
    ok: false,
    code: options.code,
    message: options.message,
    retryable:
      options.code === "RATE_LIMITED" ||
      options.code === "NETWORK_ERROR" ||
      options.code === "TIMEOUT",
    outcome: options.outcome,
    details: options.details ?? null,
    rawBytes: options.rawBytes ?? null,
    providerRequestId: options.providerRequestId ?? null,
  };
}

function createDispatchSignal(
  externalSignal: AbortSignal,
  timeoutMs: number,
): {
  signal: AbortSignal;
  timedOut(): boolean;
  dispose(): void;
} {
  const controller = new AbortController();
  let didTimeOut = false;
  const onExternalAbort = (): void => controller.abort(externalSignal.reason);
  if (externalSignal.aborted) onExternalAbort();
  else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => {
    didTimeOut = true;
    controller.abort(new Error("GSC request deadline exceeded."));
  }, timeoutMs);
  timer.unref();
  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    dispose: () => {
      clearTimeout(timer);
      externalSignal.removeEventListener("abort", onExternalAbort);
    },
  };
}
