import { Buffer } from 'node:buffer'

import type { ArtifactSource } from '../artifact'
import type { ErrorCode, ProviderOutcome } from '../envelope'

export const googleAdsApiOrigin = 'https://googleads.googleapis.com'
export const googleAdsApiVersion = 'v24'
export const defaultGoogleAdsTimeoutMs = 30_000

export type GoogleAdsAdapterKey =
	| 'customers.list-accessible'
	| 'fields.describe'
	| 'fields.search'
	| 'keyword-plan.generate-historical-metrics'
	| 'keyword-plan.generate-ideas'
	| 'query.gaql'

export type GoogleAdsOperation = Readonly<{
	adapterKey: GoogleAdsAdapterKey
	input: Readonly<Record<string, unknown>>
}>

export type GoogleAdsConfig = Readonly<{ customerId: string }>
export type GoogleAdsCredentials = Readonly<{
	developerToken: string
	accessToken: string
}>
export type GoogleAdsFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>

export type GoogleAdsDispatchResult =
	| {
			ok: true
			providerRequestId: string | null
			data: { pages: number; rowCount: number }
	  }
	| {
			ok: false
			code: ErrorCode
			message: string
			retryable: boolean
			outcome: ProviderOutcome
			details: Record<string, unknown> | null
			providerRequestId: string | null
	  }

export type GoogleAdsDispatch = Readonly<{
	source: ArtifactSource
	result: Promise<GoogleAdsDispatchResult>
}>

export type GoogleAdsRequestPlan = Readonly<{
	method: 'GET' | 'POST'
	endpoint: string
}>

type JsonRecord = Record<string, unknown>

export function createGoogleAdsDispatch(options: {
	operation: GoogleAdsOperation
	config: GoogleAdsConfig
	credentials: GoogleAdsCredentials
	signal: AbortSignal
	fetch?: GoogleAdsFetch
	timeoutMs?: number
}): GoogleAdsDispatch {
	const timeoutMs = options.timeoutMs ?? defaultGoogleAdsTimeoutMs
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
		throw new RangeError(
			'Google Ads timeoutMs must be a positive safe integer.',
		)
	}
	assertCustomerId(options.config.customerId)
	const request = buildRequest(options.operation, options.config)
	let settleResult: (result: GoogleAdsDispatchResult) => void = () => undefined
	const result = new Promise<GoogleAdsDispatchResult>((resolveResult) => {
		settleResult = resolveResult
	})
	let settled = false
	const settle = (value: GoogleAdsDispatchResult): void => {
		if (settled) return
		settled = true
		settleResult(value)
	}

	async function* pages(): AsyncGenerator<string | Uint8Array> {
		let pageToken: string | null = null
		let pageCount = 0
		let rowCount = 0
		let providerRequestId: string | null = null
		yield '['

		while (true) {
			const requestSignal = createRequestSignal(options.signal, timeoutMs)
			let response: Response
			let rawBytes: Uint8Array
			try {
				response = await (options.fetch ?? globalThis.fetch)(request.url, {
					method: request.method,
					headers: {
						authorization: `Bearer ${options.credentials.accessToken}`,
						'developer-token': options.credentials.developerToken,
						'content-type': 'application/json',
					},
					...(request.method === 'POST'
						? { body: JSON.stringify(withPageToken(request.body, pageToken)) }
						: {}),
					signal: requestSignal.signal,
				})
				rawBytes = new Uint8Array(await response.arrayBuffer())
			} catch {
				yield ']'
				settle(
					failure({
						code: requestSignal.timedOut()
							? 'TIMEOUT'
							: options.signal.aborted
								? 'UNKNOWN_OUTCOME'
								: 'NETWORK_ERROR',
						message: requestSignal.timedOut()
							? 'The Google Ads request exceeded its deadline before the outcome was confirmed.'
							: options.signal.aborted
								? 'The Google Ads request was interrupted before the outcome was confirmed.'
								: 'The Google Ads request ended without a confirmed provider outcome.',
						outcome: 'unknown',
						retryable: !options.signal.aborted,
						providerRequestId,
					}),
				)
				return
			} finally {
				requestSignal.dispose()
			}

			if (pageCount > 0) yield ','
			yield rawBytes
			pageCount++
			providerRequestId = safeRequestId(response)

			let payload: JsonRecord
			try {
				payload = asRecord(
					JSON.parse(Buffer.from(rawBytes).toString('utf8')) as unknown,
				)
			} catch {
				yield ']'
				settle(
					failure({
						code: 'UNKNOWN_OUTCOME',
						message: 'Google Ads returned an unreadable response body.',
						outcome: 'unknown',
						retryable: false,
						providerRequestId,
						details: {
							httpStatus: response.status,
							contract: 'google_ads_response_unreadable',
						},
					}),
				)
				return
			}

			const failedHttp = httpFailure(
				response.status,
				payload,
				providerRequestId,
			)
			if (failedHttp) {
				yield ']'
				settle(failedHttp)
				return
			}

			const rows = responseRows(request.rowsKey, payload)
			if (rows === null) {
				yield ']'
				settle(
					failure({
						code: 'PROVIDER_ERROR',
						message:
							'Google Ads returned a successful status with an invalid result shape.',
						outcome: 'confirmed',
						retryable: false,
						providerRequestId,
						details: {
							httpStatus: response.status,
							contract: 'google_ads_result_invalid',
						},
					}),
				)
				return
			}
			rowCount += rows.length
			pageToken =
				typeof payload.nextPageToken === 'string' &&
				payload.nextPageToken.length > 0
					? payload.nextPageToken
					: null
			if (!request.pageable || pageToken === null) break
			if (pageCount >= 1_000) {
				yield ']'
				settle(
					failure({
						code: 'PROVIDER_ERROR',
						message:
							'Google Ads pagination exceeded the reviewed 1000-page safety bound.',
						outcome: 'confirmed',
						retryable: false,
						providerRequestId,
						details: { contract: 'google_ads_page_bound_exceeded' },
					}),
				)
				return
			}
		}

		yield ']'
		settle({
			ok: true,
			providerRequestId,
			data: { pages: pageCount, rowCount },
		})
	}

	return Object.freeze({ source: pages(), result })
}

export function planGoogleAdsRequest(
	operation: GoogleAdsOperation,
	config: GoogleAdsConfig,
): GoogleAdsRequestPlan {
	assertCustomerId(config.customerId)
	const request = buildRequest(operation, config)
	return Object.freeze({ method: request.method, endpoint: request.url })
}

function buildRequest(
	operation: GoogleAdsOperation,
	config: GoogleAdsConfig,
): {
	method: 'GET' | 'POST'
	url: string
	body: JsonRecord
	pageable: boolean
	rowsKey: 'resourceNames' | 'results'
} {
	const customerPath = `customers/${config.customerId}`
	switch (operation.adapterKey) {
		case 'customers.list-accessible':
			return {
				method: 'GET',
				url: `${googleAdsApiOrigin}/${googleAdsApiVersion}/customers:listAccessibleCustomers`,
				body: {},
				pageable: false,
				rowsKey: 'resourceNames',
			}
		case 'fields.describe': {
			const name = operation.input.name
			if (typeof name !== 'string' || !/^[a-z][a-z0-9_.]{0,255}$/.test(name)) {
				throw new TypeError('Google Ads field name is invalid.')
			}
			return {
				method: 'POST',
				url: `${googleAdsApiOrigin}/${googleAdsApiVersion}/googleAdsFields:search`,
				body: {
					query: `SELECT name, category, data_type, selectable, filterable, sortable WHERE name = '${name}'`,
				},
				pageable: true,
				rowsKey: 'results',
			}
		}
		case 'fields.search':
			return {
				method: 'POST',
				url: `${googleAdsApiOrigin}/${googleAdsApiVersion}/googleAdsFields:search`,
				body: { ...operation.input },
				pageable: true,
				rowsKey: 'results',
			}
		case 'query.gaql':
			return {
				method: 'POST',
				url: `${googleAdsApiOrigin}/${googleAdsApiVersion}/${customerPath}/googleAds:search`,
				body: { ...operation.input },
				pageable: true,
				rowsKey: 'results',
			}
		case 'keyword-plan.generate-ideas':
			return {
				method: 'POST',
				url: `${googleAdsApiOrigin}/${googleAdsApiVersion}/${customerPath}:generateKeywordIdeas`,
				body: { ...operation.input },
				pageable: true,
				rowsKey: 'results',
			}
		case 'keyword-plan.generate-historical-metrics':
			return {
				method: 'POST',
				url: `${googleAdsApiOrigin}/${googleAdsApiVersion}/${customerPath}:generateKeywordHistoricalMetrics`,
				body: { ...operation.input },
				pageable: true,
				rowsKey: 'results',
			}
	}
}

function withPageToken(body: JsonRecord, pageToken: string | null): JsonRecord {
	return pageToken ? { ...body, pageToken } : body
}

function responseRows(
	key: 'resourceNames' | 'results',
	payload: JsonRecord,
): unknown[] | null {
	const rows = payload[key]
	if (rows === undefined && key === 'results') return []
	return Array.isArray(rows) ? rows : null
}

function httpFailure(
	httpStatus: number,
	payload: JsonRecord,
	providerRequestId: string | null,
): GoogleAdsDispatchResult | null {
	if (httpStatus < 400) return null
	const details = errorDetails(httpStatus, payload, providerRequestId)
	if (httpStatus === 401 || httpStatus === 403) {
		return failure({
			code: 'AUTH_FAILED',
			message: 'Google Ads rejected the configured credentials.',
			outcome: 'confirmed',
			retryable: false,
			providerRequestId,
			details,
		})
	}
	if (httpStatus === 429) {
		return failure({
			code: 'RATE_LIMITED',
			message:
				'Google Ads rejected the request because its rate limit was reached.',
			outcome: 'confirmed',
			retryable: true,
			providerRequestId,
			details,
		})
	}
	if (httpStatus === 408 || httpStatus >= 500) {
		return failure({
			code: 'UNKNOWN_OUTCOME',
			message: 'Google Ads did not confirm the read outcome.',
			outcome: 'unknown',
			retryable: true,
			providerRequestId,
			details,
		})
	}
	return failure({
		code: 'PROVIDER_ERROR',
		message: 'Google Ads rejected the read request.',
		outcome: 'confirmed',
		retryable: false,
		providerRequestId,
		details,
	})
}

function errorDetails(
	httpStatus: number,
	payload: JsonRecord,
	requestId: string | null,
): Record<string, unknown> {
	const details: Record<string, unknown> = { httpStatus }
	const error = isRecord(payload.error) ? payload.error : null
	if (typeof error?.status === 'string' && /^[A-Z_]+$/.test(error.status)) {
		details.status = error.status
	}
	const providerCode = firstProviderCode(error?.details)
	if (providerCode) details.providerCode = providerCode
	if (requestId) details.requestId = requestId
	return details
}

function firstProviderCode(value: unknown): string | null {
	if (!Array.isArray(value)) return null
	for (const detailValue of value) {
		if (!isRecord(detailValue) || !Array.isArray(detailValue.errors)) continue
		for (const entryValue of detailValue.errors) {
			if (!isRecord(entryValue) || !isRecord(entryValue.errorCode)) continue
			const code = Object.entries(entryValue.errorCode)[0]
			if (code && typeof code[1] === 'string' && /^[A-Z_]+$/.test(code[1])) {
				return `${code[0]}:${code[1]}`
			}
		}
	}
	return null
}

function failure(options: {
	code: ErrorCode
	message: string
	outcome: ProviderOutcome
	retryable: boolean
	providerRequestId: string | null
	details?: Record<string, unknown> | null
}): GoogleAdsDispatchResult {
	return {
		ok: false,
		code: options.code,
		message: options.message,
		outcome: options.outcome,
		retryable: options.retryable,
		providerRequestId: options.providerRequestId,
		details: options.details ?? null,
	}
}

function safeRequestId(response: Response): string | null {
	const value =
		response.headers.get('request-id') ??
		response.headers.get('google-ads-request-id')
	return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null
}

function assertCustomerId(value: string): void {
	if (!/^[1-9]\d{9}$/.test(value))
		throw new TypeError('Google Ads customer ID is invalid.')
}

function asRecord(value: unknown): JsonRecord {
	if (!isRecord(value))
		throw new TypeError('Google Ads response must be an object.')
	return value
}

function isRecord(value: unknown): value is JsonRecord {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function createRequestSignal(
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
		controller.abort(new Error('Google Ads request deadline exceeded.'))
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
