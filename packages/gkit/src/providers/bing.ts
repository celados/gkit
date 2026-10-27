import { Buffer } from "node:buffer";

import type { RawJsonDispatchResult } from "./raw-json";

export const bingBaseUrl = "https://ssl.bing.com/webmaster/api.svc/json";
export const defaultBingTimeoutMs = 30_000;

export type BingConfig = Readonly<{ siteUrl?: string }>;
export type BingCredentials = Readonly<{ apiKey: string }>;
export type BingOperation = Readonly<{
  adapterKey: string;
  input: Readonly<Record<string, unknown>>;
}>;
export type BingFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type QueryValue = { value: string | number; jsonString?: boolean };
type QueryParams = Record<string, QueryValue | undefined>;

const methodByAdapter = new Map<string, string>([
  ["sites.list", "GetUserSites"],
  ["traffic.rank", "GetRankAndTrafficStats"],
  ["traffic.queries", "GetQueryStats"],
  ["traffic.pages", "GetPageStats"],
  ["traffic.query", "GetQueryTrafficStats"],
  ["traffic.page-queries", "GetPageQueryStats"],
  ["traffic.query-pages", "GetQueryPageStats"],
  ["traffic.query-page", "GetQueryPageDetailStats"],
  ["crawl.stats", "GetCrawlStats"],
  ["crawl.issues", "GetCrawlIssues"],
  ["crawl.settings", "GetCrawlSettings"],
  ["links.pages", "GetLinkCounts"],
  ["links.url", "GetUrlLinks"],
  ["sitemaps.list", "GetFeeds"],
  ["sitemaps.get", "GetFeedDetails"],
  ["urls.info", "GetUrlInfo"],
  ["urls.traffic", "GetUrlTrafficInfo"],
  ["crawl.blocked-urls", "GetBlockedUrls"],
  ["urls.submission-quota", "GetUrlSubmissionQuota"],
  ["urls.submit", "SubmitUrlbatch"],
  ["sitemaps.submit", "SubmitFeed"],
]);

/** Write adapters POST a JSON body; the site stays in the body, not the query. */
const writeAdapters = new Set(["urls.submit", "sitemaps.submit"]);

export function planBingRequest(
  operation: BingOperation,
  config: BingConfig,
): { method: "GET" | "POST"; endpoint: string; diagnosticUrl: string } {
  const request = buildRequest(operation, config);
  const diagnosticUrl = buildBingUrls({
    method: request.method,
    params: request.params,
  }).diagnosticUrl;
  return { method: request.body ? "POST" : "GET", endpoint: diagnosticUrl, diagnosticUrl };
}

export function buildBingUrls(options: {
  method: string;
  params: QueryParams;
  apiKey?: string;
  baseUrl?: string;
}): { requestUrl: string | null; diagnosticUrl: string } {
  const url = new URL(`${options.baseUrl ?? bingBaseUrl}/${options.method}`);
  for (const [name, item] of Object.entries(options.params)) {
    if (!item) continue;
    url.searchParams.set(name, item.jsonString ? JSON.stringify(item.value) : String(item.value));
  }
  const diagnosticUrl = url.toString();
  if (!options.apiKey) return { requestUrl: null, diagnosticUrl };
  url.searchParams.set("apikey", options.apiKey);
  return { requestUrl: url.toString(), diagnosticUrl };
}

export async function dispatchBing(options: {
  operation: BingOperation;
  config: BingConfig;
  credentials: BingCredentials;
  signal: AbortSignal;
  fetch?: BingFetch;
  timeoutMs?: number;
}): Promise<RawJsonDispatchResult> {
  const timeoutMs = options.timeoutMs ?? defaultBingTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Bing timeoutMs must be a positive safe integer.");
  }
  const request = buildRequest(options.operation, options.config);
  const urls = buildBingUrls({
    method: request.method,
    params: request.params,
    apiKey: options.credentials.apiKey,
  });
  if (!urls.requestUrl) throw new TypeError("Bing API key is required.");
  const dispatchSignal = createDispatchSignal(options.signal, timeoutMs);
  let response: Response;
  let rawBytes: Uint8Array;
  try {
    response = await (options.fetch ?? globalThis.fetch)(
      urls.requestUrl,
      request.body
        ? {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify(request.body),
            signal: dispatchSignal.signal,
          }
        : { headers: { accept: "application/json" }, signal: dispatchSignal.signal },
    );
    rawBytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return failure({
      code: dispatchSignal.timedOut()
        ? "TIMEOUT"
        : options.signal.aborted
          ? "UNKNOWN_OUTCOME"
          : "NETWORK_ERROR",
      message: dispatchSignal.timedOut()
        ? "The Bing request exceeded its deadline before the outcome was confirmed."
        : options.signal.aborted
          ? "The Bing request was interrupted before the outcome was confirmed."
          : "The Bing request ended without a confirmed provider outcome.",
      outcome: "unknown",
      details: { diagnosticUrl: urls.diagnosticUrl },
    });
  } finally {
    dispatchSignal.dispose();
  }

  const providerRequestId = safeRequestId(response);
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(rawBytes).toString("utf8")) as unknown;
  } catch {
    return failure({
      code: response.ok ? "UNKNOWN_OUTCOME" : "PROVIDER_ERROR",
      message: "Bing returned an unreadable response body.",
      outcome: response.ok ? "unknown" : "confirmed",
      rawBytes,
      providerRequestId,
      details: { httpStatus: response.status, diagnosticUrl: urls.diagnosticUrl },
    });
  }
  if (!response.ok) {
    const body = isRecord(payload) ? payload : {};
    const providerCode =
      typeof body.ErrorCode === "number" || typeof body.ErrorCode === "string"
        ? body.ErrorCode
        : null;
    const invalidApiKey = providerCode === 3 || providerCode === "3";
    const code =
      response.status === 401 || response.status === 403 || invalidApiKey
        ? "AUTH_FAILED"
        : response.status === 429
          ? "RATE_LIMITED"
          : response.status === 408 || response.status >= 500
            ? "UNKNOWN_OUTCOME"
            : "PROVIDER_ERROR";
    return failure({
      code,
      message:
        code === "AUTH_FAILED"
          ? "Bing rejected the configured API key."
          : code === "RATE_LIMITED"
            ? "Bing rejected the request because its rate limit was reached."
            : "Bing rejected the Webmaster request.",
      outcome: code === "UNKNOWN_OUTCOME" ? "unknown" : "confirmed",
      rawBytes,
      providerRequestId,
      details: {
        httpStatus: response.status,
        diagnosticUrl: urls.diagnosticUrl,
        ...(providerCode === null ? {} : { providerCode }),
      },
    });
  }
  const data = isRecord(payload) && "d" in payload ? payload.d : payload;
  return {
    ok: true,
    rawBytes,
    providerRequestId,
    data: {
      rowCount: Array.isArray(data) ? data.length : data === null ? 0 : 1,
      diagnosticUrl: urls.diagnosticUrl,
    },
  };
}

function buildRequest(
  operation: BingOperation,
  config: BingConfig,
): { method: string; params: QueryParams; body?: Record<string, unknown> } {
  const method = methodByAdapter.get(operation.adapterKey);
  if (!method) throw new TypeError("Bing adapter key is not reviewed.");
  if (operation.adapterKey === "sites.list") return { method, params: {} };
  const siteUrl = stringInput(operation.input, "siteUrl") ?? config.siteUrl;
  if (!siteUrl) throw new TypeError("Bing siteUrl is required in the profile or request input.");
  assertHttpUrl(siteUrl, "siteUrl");
  if (writeAdapters.has(operation.adapterKey)) {
    return { method, params: {}, body: buildWriteBody(operation, siteUrl) };
  }
  const params: QueryParams = { siteUrl: { value: siteUrl } };
  switch (operation.adapterKey) {
    case "traffic.query":
    case "traffic.query-pages":
      params.query = jsonStringInput(operation.input, "query");
      break;
    case "traffic.page-queries":
      params.page = jsonStringInput(operation.input, "pageUrl");
      break;
    case "traffic.query-page":
      params.query = jsonStringInput(operation.input, "query");
      params.page = jsonStringInput(operation.input, "pageUrl");
      break;
    case "links.pages":
      params.page = { value: integerInput(operation.input, "page", 0) };
      break;
    case "links.url":
      params.link = jsonStringInput(operation.input, "link");
      params.page = { value: integerInput(operation.input, "page", 0) };
      break;
    case "sitemaps.get":
      params.feedUrl = jsonStringInput(operation.input, "feedUrl");
      break;
    case "urls.info":
    case "urls.traffic":
      params.url = jsonStringInput(operation.input, "url");
      break;
  }
  return { method, params };
}

function buildWriteBody(operation: BingOperation, siteUrl: string): Record<string, unknown> {
  if (operation.adapterKey === "sitemaps.submit") {
    const feedUrl = stringInput(operation.input, "feedUrl");
    if (!feedUrl) throw new TypeError("Bing feedUrl is required.");
    assertHttpUrl(feedUrl, "feedUrl");
    assertSameSite(feedUrl, siteUrl, "feedUrl");
    return { siteUrl, feedUrl };
  }
  const urlList = operation.input.urlList;
  if (!Array.isArray(urlList) || urlList.length === 0 || urlList.length > 500) {
    throw new TypeError("Bing urlList must contain 1 to 500 URLs.");
  }
  for (const url of urlList) {
    if (typeof url !== "string") throw new TypeError("Bing urlList entries must be URLs.");
    assertHttpUrl(url, "urlList entry");
    assertSameSite(url, siteUrl, "urlList entry");
  }
  return { siteUrl, urlList: [...urlList] };
}

/** Bing only accepts submissions for URLs under the verified site. */
function assertSameSite(value: string, siteUrl: string, name: string): void {
  if (new URL(value).hostname !== new URL(siteUrl).hostname) {
    throw new TypeError(`Bing ${name} must belong to ${siteUrl}.`);
  }
}

function stringInput(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function jsonStringInput(input: Readonly<Record<string, unknown>>, key: string): QueryValue {
  const value = stringInput(input, key);
  if (!value) throw new TypeError(`Bing ${key} is required.`);
  return { value, jsonString: true };
}

function integerInput(
  input: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
): number {
  const value = input[key] ?? fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new TypeError(`Bing ${key} is invalid.`);
  return value as number;
}

function assertHttpUrl(value: string, name: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`Bing ${name} must be an absolute HTTP URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`Bing ${name} must be an absolute HTTP URL.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeRequestId(response: Response): string | null {
  const value = response.headers.get("x-ms-request-id") ?? response.headers.get("x-request-id");
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
    controller.abort(new Error("Bing request deadline exceeded."));
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
