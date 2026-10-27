import { Buffer } from "node:buffer";

export const errorCodes = [
  "CAPABILITY_NOT_FOUND",
  "INVALID_INPUT",
  "PROFILE_ERROR",
  "EFFECT_NOT_ALLOWED",
  "AUTH_FAILED",
  "RATE_LIMITED",
  "TIMEOUT",
  "NETWORK_ERROR",
  "UNKNOWN_OUTCOME",
  "SPEND_POLICY_BREACH",
  "CANCELLED",
  "PROVIDER_ERROR",
  "LOCAL_IO_ERROR",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof errorCodes)[number];
export type ProviderOutcome = "not_dispatched" | "confirmed" | "unknown";
export type SpendOutcome =
  | "confirmed_charged"
  | "confirmed_not_charged"
  | "unknown";

export type ArtifactReceipt = {
  path: string;
  bytes: number;
  sha256: string;
};

export type SpendMeta = {
  outcome: SpendOutcome;
  cost: { amount: string; currency: "USD" } | null;
};

export type EnvelopeMeta = {
  profile: string | null;
  provider: string | null;
  capability: string | null;
  effects: string[];
  /** Runtime-generated Growth Operation identity; present once the attempt is journaled. */
  operationId: string | null;
  artifact: ArtifactReceipt | null;
  providerRequestId: string | null;
  /** Settled spend facts; null for cost-free capabilities and before settlement. */
  spend: SpendMeta | null;
};

export type SuccessEnvelope<T = unknown> = {
  ok: true;
  data: T;
  meta: EnvelopeMeta;
};

export type FailureEnvelope = {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    hint: string | null;
    retryable: boolean;
    outcome: ProviderOutcome;
    details: Record<string, unknown> | null;
  };
  meta?: EnvelopeMeta;
};

export type Envelope<T = unknown> = SuccessEnvelope<T> | FailureEnvelope;

export class GkitFailure extends Error {
  readonly code: ErrorCode;
  readonly hint: string | null;
  readonly retryable: boolean;
  readonly outcome: ProviderOutcome;
  readonly details: Record<string, unknown> | null;
  readonly meta: EnvelopeMeta | undefined;

  constructor(options: {
    code: ErrorCode;
    message: string;
    hint?: string | null;
    retryable?: boolean;
    outcome?: ProviderOutcome;
    details?: Record<string, unknown> | null;
    meta?: EnvelopeMeta;
  }) {
    super(options.message);
    this.name = "GkitFailure";
    this.code = options.code;
    this.hint = options.hint ?? null;
    this.retryable = options.retryable ?? false;
    this.outcome = options.outcome ?? "not_dispatched";
    this.details = options.details ?? null;
    this.meta = options.meta;
  }
}

function urlSearchParamsEncoding(value: string): string {
  return new URLSearchParams({ value }).toString().slice("value=".length);
}

function jsonStringEncoding(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

export class SecretRegistry {
  readonly #patterns = new Set<string>();

  register(value: string): void {
    if (value.length === 0) {
      throw new GkitFailure({
        code: "PROFILE_ERROR",
        message: "A resolved secret is empty.",
      });
    }

    for (const candidate of [
      value,
      encodeURIComponent(value),
      urlSearchParamsEncoding(value),
      jsonStringEncoding(value),
    ]) {
      if (candidate.length > 0) this.#patterns.add(candidate);
    }
  }

  registerBasicAuth(login: string, password: string): void {
    this.register(login);
    this.register(password);
    const pair = `${login}:${password}`;
    this.register(pair);
    const encoded = Buffer.from(pair, "utf8").toString("base64");
    this.register(encoded);
    this.#patterns.add(`Basic ${encoded}`);
  }

  patterns(): readonly string[] {
    return [...this.#patterns].sort((left, right) => right.length - left.length);
  }

  redact(text: string): string {
    let redacted = text;
    for (const pattern of this.patterns()) {
      redacted = redacted.replaceAll(pattern, "[REDACTED]");
    }
    return redacted;
  }

  contains(bytes: Uint8Array): boolean {
    const buffer = Buffer.from(bytes);
    return this.patterns().some((pattern) =>
      buffer.includes(Buffer.from(pattern, "utf8")),
    );
  }
}

export function toFailureEnvelope(error: unknown): FailureEnvelope {
  if (error instanceof GkitFailure) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        hint: error.hint,
        retryable: error.retryable,
        outcome: error.outcome,
        details: error.details,
      },
      ...(error.meta ? { meta: error.meta } : {}),
    };
  }

  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "gkit encountered an internal error.",
      hint: "Rerun with the same non-secret input after inspecting local diagnostics.",
      retryable: false,
      outcome: "not_dispatched",
      details: null,
    },
  };
}

export function serializeEnvelope(
  envelope: Envelope,
  secrets?: SecretRegistry,
): string {
  const safeEnvelope = secrets ? redactEnvelopeValue(envelope, secrets) : envelope;
  return `${JSON.stringify(safeEnvelope)}\n`;
}

function redactEnvelopeValue(value: unknown, secrets: SecretRegistry): unknown {
  if (typeof value === "string") return secrets.redact(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactEnvelopeValue(item, secrets));
  }
  if (value === null || typeof value !== "object") return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = redactEnvelopeValue(child, secrets);
  }
  return redacted;
}

export function formatUsdMicros(micros: number): string {
  if (!Number.isSafeInteger(micros) || micros < 0) {
    throw new GkitFailure({
      code: "INTERNAL_ERROR",
      message: "An invalid integer-micros amount was produced.",
    });
  }
  const whole = Math.floor(micros / 1_000_000);
  const fraction = String(micros % 1_000_000).padStart(6, "0");
  return `${whole}.${fraction}`;
}

export function parseUsdMicros(value: string): number {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) {
    throw new GkitFailure({
      code: "INVALID_INPUT",
      message: "USD amounts must be non-negative decimal strings with at most 6 fractional digits.",
    });
  }
  const [whole, fraction = ""] = value.split(".");
  const micros = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));
  if (!Number.isSafeInteger(micros)) {
    throw new GkitFailure({
      code: "INVALID_INPUT",
      message: "The USD amount is too large.",
    });
  }
  return micros;
}
