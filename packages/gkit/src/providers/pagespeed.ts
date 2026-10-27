import { Buffer } from "node:buffer";

import type { RawJsonDispatchResult } from "./raw-json";

export const pageSpeedEndpoint = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
// Lighthouse runs routinely take 20–40 seconds on the provider side.
export const defaultPageSpeedTimeoutMs = 60_000;

export type PageSpeedConfig = Readonly<Record<string, never>>;
export type PageSpeedCredentials = Readonly<{ apiKey: string | null }>;
export type PageSpeedOperation = Readonly<{
  adapterKey: string;
  input: Readonly<Record<string, unknown>>;
}>;
export type PageSpeedFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type PageSpeedCategory = "performance" | "seo" | "accessibility" | "best-practices";

const categoryParam: Readonly<Record<PageSpeedCategory, string>> = {
  performance: "PERFORMANCE",
  seo: "SEO",
  accessibility: "ACCESSIBILITY",
  "best-practices": "BEST_PRACTICES",
};
const defaultCategories: readonly PageSpeedCategory[] = ["performance", "seo"];

export function planPageSpeedRequest(
  operation: PageSpeedOperation,
  _config: PageSpeedConfig,
): { method: "GET"; endpoint: string; diagnosticUrl: string } {
  const diagnosticUrl = buildPageSpeedUrls(operation).diagnosticUrl;
  return { method: "GET", endpoint: diagnosticUrl, diagnosticUrl };
}

/** The key is added only to the request URL; the diagnostic URL never carries it. */
export function buildPageSpeedUrls(
  operation: PageSpeedOperation,
  apiKey: string | null = null,
): { requestUrl: string; diagnosticUrl: string } {
  if (operation.adapterKey !== "run") throw new TypeError("PageSpeed adapter key is not reviewed.");
  const input = operation.input;
  const target = input.url;
  if (typeof target !== "string") throw new TypeError("PageSpeed url is required.");
  assertHttpUrl(target);
  const strategy = input.strategy ?? "mobile";
  if (strategy !== "mobile" && strategy !== "desktop") {
    throw new TypeError("PageSpeed strategy must be mobile or desktop.");
  }
  const categories = (input.categories ?? defaultCategories) as unknown;
  if (
    !Array.isArray(categories) ||
    categories.length === 0 ||
    !categories.every((category) => typeof category === "string" && category in categoryParam)
  ) {
    throw new TypeError("PageSpeed categories must be reviewed Lighthouse categories.");
  }

  const url = new URL(pageSpeedEndpoint);
  url.searchParams.set("url", target);
  url.searchParams.set("strategy", strategy.toUpperCase());
  for (const category of new Set(categories as PageSpeedCategory[])) {
    url.searchParams.append("category", categoryParam[category]);
  }
  if (typeof input.locale === "string") url.searchParams.set("locale", input.locale);
  const diagnosticUrl = url.toString();
  if (apiKey) url.searchParams.set("key", apiKey);
  return { requestUrl: url.toString(), diagnosticUrl };
}

export async function dispatchPageSpeed(options: {
  operation: PageSpeedOperation;
  config: PageSpeedConfig;
  credentials: PageSpeedCredentials;
  signal: AbortSignal;
  fetch?: PageSpeedFetch;
  timeoutMs?: number;
}): Promise<RawJsonDispatchResult> {
  const timeoutMs = options.timeoutMs ?? defaultPageSpeedTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("PageSpeed timeoutMs must be a positive safe integer.");
  }
  const urls = buildPageSpeedUrls(options.operation, options.credentials.apiKey);
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => controller.abort(options.signal.reason);
  if (options.signal.aborted) onAbort();
  else options.signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("PageSpeed request deadline exceeded."));
  }, timeoutMs);
  timer.unref();

  let response: Response;
  let rawBytes: Uint8Array;
  try {
    response = await (options.fetch ?? globalThis.fetch)(urls.requestUrl, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    rawBytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return failure({
      code: timedOut ? "TIMEOUT" : options.signal.aborted ? "UNKNOWN_OUTCOME" : "NETWORK_ERROR",
      message: timedOut
        ? "The PageSpeed request exceeded its deadline before the outcome was confirmed."
        : "The PageSpeed request ended without a confirmed provider outcome.",
      outcome: "unknown",
      details: { diagnosticUrl: urls.diagnosticUrl },
    });
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", onAbort);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(rawBytes).toString("utf8")) as unknown;
  } catch {
    return failure({
      code: response.ok ? "UNKNOWN_OUTCOME" : "PROVIDER_ERROR",
      message: "PageSpeed returned an unreadable response body.",
      outcome: response.ok ? "unknown" : "confirmed",
      rawBytes,
      details: { httpStatus: response.status, diagnosticUrl: urls.diagnosticUrl },
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
    return failure({
      code,
      message:
        code === "AUTH_FAILED"
          ? "PageSpeed rejected the configured API key."
          : code === "RATE_LIMITED"
            ? "PageSpeed rejected the request because its quota was reached."
            : code === "UNKNOWN_OUTCOME"
              ? "PageSpeed failed before confirming the analysis."
              : "PageSpeed rejected the analysis request.",
      outcome: code === "UNKNOWN_OUTCOME" ? "unknown" : "confirmed",
      rawBytes,
      details: { httpStatus: response.status, diagnosticUrl: urls.diagnosticUrl },
    });
  }

  return { ok: true, rawBytes, providerRequestId: null, data: summarizePageSpeed(payload, urls.diagnosticUrl) };
}

/** Compact, non-authoritative summary; the raw response artifact stays the Evidence. */
export function summarizePageSpeed(payload: unknown, diagnosticUrl: string): Record<string, unknown> {
  const body = isRecord(payload) ? payload : {};
  const lighthouse = isRecord(body.lighthouseResult) ? body.lighthouseResult : {};
  const categories = isRecord(lighthouse.categories) ? lighthouse.categories : {};
  const scores: Record<string, number | null> = {};
  for (const [id, category] of Object.entries(categories)) {
    const score = isRecord(category) ? category.score : null;
    scores[id] = typeof score === "number" ? score : null;
  }
  return {
    finalUrl: typeof lighthouse.finalUrl === "string" ? lighthouse.finalUrl : null,
    scores,
    fieldData: {
      url: hasMetrics(body.loadingExperience),
      origin: hasMetrics(body.originLoadingExperience),
    },
    diagnosticUrl,
  };
}

function hasMetrics(value: unknown): boolean {
  return isRecord(value) && isRecord(value.metrics) && Object.keys(value.metrics).length > 0;
}

function assertHttpUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("PageSpeed url must be an absolute HTTP URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("PageSpeed url must be an absolute HTTP URL.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failure(options: {
  code: Extract<RawJsonDispatchResult, { ok: false }>["code"];
  message: string;
  outcome: Extract<RawJsonDispatchResult, { ok: false }>["outcome"];
  details?: Record<string, unknown> | null;
  rawBytes?: Uint8Array | null;
}): RawJsonDispatchResult {
  return {
    ok: false,
    code: options.code,
    message: options.message,
    retryable:
      options.code === "RATE_LIMITED" || options.code === "NETWORK_ERROR" || options.code === "TIMEOUT",
    outcome: options.outcome,
    details: options.details ?? null,
    rawBytes: options.rawBytes ?? null,
    providerRequestId: null,
  };
}
