import { Buffer } from 'node:buffer'

import type { ErrorCode, ProviderOutcome } from '../envelope'

export type PostHogQueryInput = {
	query: string
	limit: number
}

export type PostHogConfig = Readonly<{
	host: 'https://us.posthog.com' | 'https://eu.posthog.com'
	projectId: string
}>

export type PostHogCredentials = Readonly<{ apiToken: string }>

export type PostHogFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>

export type PostHogDispatchResult =
	| {
			ok: true
			rawBytes: Uint8Array
			providerRequestId: string | null
			data: { rowCount: number; columnCount: number }
	  }
	| {
			ok: false
			code: ErrorCode
			message: string
			retryable: boolean
			outcome: ProviderOutcome
			details: Record<string, unknown> | null
			rawBytes: Uint8Array | null
			providerRequestId: string | null
	  }

export const defaultPostHogTimeoutMs = 30_000

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function safeRequestId(response: Response): string | null {
	const value =
		response.headers.get('x-posthog-request-id') ??
		response.headers.get('x-request-id')
	return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null
}

export function buildBoundedHogQl(input: PostHogQueryInput): string {
	if (
		!Number.isSafeInteger(input.limit) ||
		input.limit < 1 ||
		input.limit > 1_000
	) {
		throw new RangeError(
			'PostHog query limit must be an integer between 1 and 1000.',
		)
	}
	const query = input.query.trim().replace(/;\s*$/, '').trim()
	if (
		query.length === 0 ||
		query.length > 20_000 ||
		!/^(?:SELECT|WITH)\b/i.test(query)
	) {
		throw new TypeError(
			'PostHog query must be a bounded SELECT or WITH statement.',
		)
	}
	if (
		/;/.test(query) ||
		/(?:--|\/\*|\*\/|#)/.test(query) ||
		/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i.test(query) ||
		/\bLIMIT\s+\d+\b/i.test(query)
	) {
		throw new TypeError(
			'PostHog query contains an unsupported statement, comment, or LIMIT clause.',
		)
	}
	return `${query} LIMIT ${input.limit}`
}

function failure(options: {
	code: ErrorCode
	message: string
	outcome: ProviderOutcome
	rawBytes?: Uint8Array | null
	providerRequestId?: string | null
	details?: Record<string, unknown> | null
}): PostHogDispatchResult {
	return {
		ok: false,
		code: options.code,
		message: options.message,
		retryable: false,
		outcome: options.outcome,
		details: options.details ?? null,
		rawBytes: options.rawBytes ?? null,
		providerRequestId: options.providerRequestId ?? null,
	}
}

function httpFailure(
	status: number,
	rawBytes: Uint8Array,
	providerRequestId: string | null,
): PostHogDispatchResult | null {
	const details = { httpStatus: status }
	if (status === 401 || status === 403) {
		return failure({
			code: 'AUTH_FAILED',
			message: 'PostHog rejected the configured credentials.',
			outcome: 'confirmed',
			rawBytes,
			providerRequestId,
			details,
		})
	}
	if (status === 429) {
		return failure({
			code: 'RATE_LIMITED',
			message:
				'PostHog rejected the request because its rate limit was reached.',
			outcome: 'confirmed',
			rawBytes,
			providerRequestId,
			details,
		})
	}
	if (status === 408 || status >= 500) {
		return failure({
			code: 'UNKNOWN_OUTCOME',
			message: 'PostHog did not confirm the query outcome.',
			outcome: 'unknown',
			rawBytes,
			providerRequestId,
			details,
		})
	}
	if (status >= 400) {
		return failure({
			code: 'PROVIDER_ERROR',
			message: 'PostHog rejected the query request.',
			outcome: 'confirmed',
			rawBytes,
			providerRequestId,
			details,
		})
	}
	return null
}

function validateResult(
	payload: JsonRecord,
): { rowCount: number; columnCount: number } | null {
	if (
		!Array.isArray(payload.columns) ||
		!payload.columns.every((column) => typeof column === 'string')
	) {
		return null
	}
	if (!Array.isArray(payload.results)) return null
	const columnCount = payload.columns.length
	if (
		!payload.results.every(
			(row) => Array.isArray(row) && row.length === columnCount,
		)
	)
		return null
	return { rowCount: payload.results.length, columnCount }
}

export async function dispatchPostHog(options: {
	input: PostHogQueryInput
	config: PostHogConfig
	credentials: PostHogCredentials
	signal: AbortSignal
	fetch?: PostHogFetch
	timeoutMs?: number
}): Promise<PostHogDispatchResult> {
	const timeoutMs = options.timeoutMs ?? defaultPostHogTimeoutMs
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
		throw new RangeError('PostHog timeoutMs must be a positive safe integer.')
	}
	const query = buildBoundedHogQl(options.input)
	const dispatchSignal = createDispatchSignal(options.signal, timeoutMs)
	let response: Response
	let rawBytes: Uint8Array
	try {
		response = await (options.fetch ?? globalThis.fetch)(
			`${options.config.host}/api/projects/${encodeURIComponent(options.config.projectId)}/query/`,
			{
				method: 'POST',
				headers: {
					authorization: `Bearer ${options.credentials.apiToken}`,
					'content-type': 'application/json',
				},
				body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
				signal: dispatchSignal.signal,
			},
		)
		rawBytes = new Uint8Array(await response.arrayBuffer())
	} catch {
		return failure({
			code: dispatchSignal.timedOut()
				? 'TIMEOUT'
				: options.signal.aborted
					? 'UNKNOWN_OUTCOME'
					: 'NETWORK_ERROR',
			message: dispatchSignal.timedOut()
				? 'The PostHog query exceeded its deadline before the outcome was confirmed.'
				: options.signal.aborted
					? 'The PostHog query was interrupted before its outcome was confirmed.'
					: 'The PostHog query ended without a confirmed provider outcome.',
			outcome: 'unknown',
		})
	} finally {
		dispatchSignal.dispose()
	}

	const providerRequestId = safeRequestId(response)
	const failedHttp = httpFailure(response.status, rawBytes, providerRequestId)
	if (failedHttp) return failedHttp

	let payload: JsonRecord
	try {
		const parsed: unknown = JSON.parse(Buffer.from(rawBytes).toString('utf8'))
		if (!isRecord(parsed))
			throw new TypeError('PostHog response must be an object.')
		payload = parsed
	} catch {
		return failure({
			code: 'UNKNOWN_OUTCOME',
			message:
				'PostHog returned a successful status with an unreadable response.',
			outcome: 'unknown',
			rawBytes,
			providerRequestId,
			details: {
				httpStatus: response.status,
				contract: 'posthog_response_unreadable',
			},
		})
	}

	const data = validateResult(payload)
	if (!data) {
		return failure({
			code: 'PROVIDER_ERROR',
			message:
				'PostHog returned a successful status with an invalid HogQL result.',
			outcome: 'confirmed',
			rawBytes,
			providerRequestId,
			details: {
				httpStatus: response.status,
				contract: 'posthog_hogql_result_invalid',
			},
		})
	}
	return { ok: true, rawBytes, providerRequestId, data }
}

function createDispatchSignal(
	externalSignal: AbortSignal,
	timeoutMs: number,
): { signal: AbortSignal; timedOut(): boolean; dispose(): void } {
	const controller = new AbortController()
	let didTimeOut = false
	const onExternalAbort = (): void => controller.abort(externalSignal.reason)
	if (externalSignal.aborted) onExternalAbort()
	else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
	const timer = setTimeout(() => {
		didTimeOut = true
		controller.abort(new Error('PostHog request deadline exceeded.'))
	}, timeoutMs)
	timer.unref()
	return {
		signal: controller.signal,
		timedOut: () => didTimeOut,
		dispose: () => {
			clearTimeout(timer)
			externalSignal.removeEventListener('abort', onExternalAbort)
		},
	}
}
