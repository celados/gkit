import { Buffer } from 'node:buffer'

import type { ErrorCode, ProviderOutcome } from '../envelope'

import { parseUsdMicros } from '../envelope'

export type DataForSeoEnvironment = 'production' | 'sandbox'

export type DataForSeoCredentials = Readonly<{
	login: string
	password: string
}>

export type DataForSeoBulkRanksInput = {
	targets: string[]
	rank_scale?: 'one_hundred' | 'one_thousand'
	tag?: string
}

type DataForSeoBacklinkSummaryInput = {
	target: string
	include_subdomains?: boolean
	exclude_internal_backlinks?: boolean
	internal_list_limit?: number
	backlinks_status_type?: 'all' | 'live' | 'lost'
	rank_scale?: 'one_hundred' | 'one_thousand'
	tag?: string
}

type DataForSeoReferringDomainsInput = {
	target: string
	limit: number
	order_by?: string[]
	include_subdomains?: boolean
	exclude_internal_backlinks?: boolean
	backlinks_status_type?: 'all' | 'live' | 'lost'
	rank_scale?: 'one_hundred' | 'one_thousand'
	tag?: string
}

type DataForSeoSerpInput = {
	keyword: string
	location_code: number
	language_code: string
	device: 'desktop' | 'mobile'
	os: 'windows' | 'macos' | 'android' | 'ios'
	depth: number
	tag?: string
}

type DataForSeoLlmMentionsSearchInput = {
	target: Array<{
		domain: string
		search_filter?: 'include'
		search_scope?: Array<
			'any' | 'question' | 'answer' | 'brand_entities' | 'fan_out_queries'
		>
		include_subdomains?: boolean
	}>
	location_code: 2840
	language_code: 'en'
	platform: 'chat_gpt' | 'google'
	limit: number
	order_by?: string[]
	tag?: string
}

export type DataForSeoAdapterKey =
	| 'backlinks.bulk_ranks.live'
	| 'backlinks.referring_domains.live'
	| 'backlinks.summary.live'
	| 'ai_optimization.llm_mentions.search.live'
	| 'serp.google.organic.live.advanced'

export type DataForSeoDispatchSuccess = {
	ok: true
	rawBytes: Uint8Array
	providerRequestId: string | null
	costMicros: number | null
	costIsConfirmed: boolean
	data: {
		itemsCount: number
	}
}

export type DataForSeoDispatchFailure = {
	ok: false
	code: ErrorCode
	message: string
	retryable: boolean
	outcome: ProviderOutcome
	details: Record<string, unknown> | null
	rawBytes: Uint8Array | null
	providerRequestId: string | null
	costMicros: number | null
	costIsConfirmed: boolean
}

export type DataForSeoDispatchResult =
	| DataForSeoDispatchSuccess
	| DataForSeoDispatchFailure

export type DataForSeoFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>

const origins: Record<DataForSeoEnvironment, string> = {
	production: 'https://api.dataforseo.com',
	sandbox: 'https://sandbox.dataforseo.com',
}

export const defaultDataForSeoTimeoutMs = 30_000

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown): JsonRecord | null {
	return isRecord(value) ? value : null
}

function asNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asString(value: unknown): string | null {
	return typeof value === 'string' ? value : null
}

function asTaskId(value: unknown): string | null {
	const candidate = asString(value)
	return candidate !== null &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			candidate,
		)
		? candidate
		: null
}

function readSingleTask(payload: JsonRecord): {
	task: JsonRecord | null
	cardinalityIsValid: boolean
} {
	const tasks = payload.tasks
	const tasksCount = asNumber(payload.tasks_count)
	if (
		!Array.isArray(tasks) ||
		tasks.length !== 1 ||
		tasksCount !== 1 ||
		!Number.isSafeInteger(tasksCount)
	) {
		return { task: null, cardinalityIsValid: false }
	}
	const task = asRecord(tasks[0])
	return { task, cardinalityIsValid: task !== null }
}

function singleResult(task: JsonRecord | null): JsonRecord | null {
	if (
		!task ||
		!Array.isArray(task.result) ||
		task.result.length !== 1 ||
		asNumber(task.result_count) !== 1
	) {
		return null
	}
	return asRecord(task.result[0])
}

function validBulkRanksItemsCount(
	result: JsonRecord | null,
	input: DataForSeoBulkRanksInput,
): number | null {
	const itemsCount = asNumber(result?.items_count)
	const items = result?.items
	if (
		itemsCount === null ||
		!Number.isSafeInteger(itemsCount) ||
		itemsCount < 0 ||
		!Array.isArray(items) ||
		items.length !== itemsCount
	) {
		return null
	}
	const remainingTargets = new Map<string, number>()
	for (const target of input.targets) {
		remainingTargets.set(target, (remainingTargets.get(target) ?? 0) + 1)
	}
	const maxRank = input.rank_scale === 'one_hundred' ? 100 : 1_000
	for (const item of items) {
		const record = asRecord(item)
		const target = asString(record?.target)
		const rank = asNumber(record?.rank)
		if (
			!record ||
			!target ||
			rank === null ||
			!Number.isSafeInteger(rank) ||
			rank < 0 ||
			rank > maxRank ||
			(remainingTargets.get(target) ?? 0) === 0
		) {
			return null
		}
		remainingTargets.set(target, remainingTargets.get(target)! - 1)
	}
	return [...remainingTargets.values()].every((count) => count === 0)
		? itemsCount
		: null
}

function validSummaryItemsCount(
	result: JsonRecord | null,
	input: DataForSeoBacklinkSummaryInput,
): number | null {
	if (!result || asString(result.target) !== input.target) return null
	const metricKeys = ['rank', 'backlinks', 'referring_domains']
	if (!metricKeys.some((key) => Object.hasOwn(result, key))) return null
	return metricKeys.every((key) => {
		if (!Object.hasOwn(result, key)) return true
		const value = result[key]
		return (
			value === null ||
			(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
		)
	})
		? 1
		: null
}

function validReferringDomainsItemsCount(
	result: JsonRecord | null,
	input: DataForSeoReferringDomainsInput,
): number | null {
	if (!result || asString(result.target) !== input.target) return null
	const itemsCount = asNumber(result.items_count)
	const items = result.items
	if (
		itemsCount === null ||
		!Number.isSafeInteger(itemsCount) ||
		itemsCount < 0 ||
		itemsCount > input.limit ||
		!Array.isArray(items) ||
		items.length !== itemsCount
	) {
		return null
	}
	return items.every((item) => {
		const record = asRecord(item)
		const rank = record?.rank
		const backlinks = record?.backlinks
		return (
			record !== null &&
			Boolean(asString(record.domain)) &&
			(rank === null ||
				(typeof rank === 'number' &&
					Number.isSafeInteger(rank) &&
					rank >= 0)) &&
			(backlinks === null ||
				(typeof backlinks === 'number' &&
					Number.isSafeInteger(backlinks) &&
					backlinks >= 0))
		)
	})
		? itemsCount
		: null
}

function validSerpItemsCount(
	result: JsonRecord | null,
	input: DataForSeoSerpInput,
): number | null {
	if (
		!result ||
		asString(result.keyword) !== input.keyword ||
		asNumber(result.location_code) !== input.location_code ||
		asString(result.language_code) !== input.language_code
	) {
		return null
	}
	const itemsCount = asNumber(result.items_count)
	const items = result.items
	if (
		itemsCount === null ||
		!Number.isSafeInteger(itemsCount) ||
		itemsCount < 0
	) {
		return null
	}
	if (itemsCount === 0)
		return items === null || (Array.isArray(items) && items.length === 0)
			? 0
			: null
	return Array.isArray(items) &&
		items.length === itemsCount &&
		items.every((item) => item === null || isRecord(item))
		? itemsCount
		: null
}

function validLlmMentionsItemsCount(
	result: JsonRecord | null,
	input: DataForSeoLlmMentionsSearchInput,
): number | null {
	if (!result) return null
	const itemsCount = asNumber(result.items_count)
	const totalCount = asNumber(result.total_count)
	const items = result.items
	if (
		itemsCount === null ||
		!Number.isSafeInteger(itemsCount) ||
		itemsCount < 0 ||
		itemsCount > input.limit ||
		totalCount === null ||
		!Number.isSafeInteger(totalCount) ||
		totalCount < itemsCount
	) {
		return null
	}
	if (itemsCount === 0) {
		return items === null || (Array.isArray(items) && items.length === 0)
			? 0
			: null
	}
	return Array.isArray(items) &&
		items.length === itemsCount &&
		items.every((item) => {
			const record = asRecord(item)
			return (
				record !== null &&
				asString(record.platform) === input.platform &&
				asNumber(record.location_code) === input.location_code &&
				asString(record.language_code) === input.language_code &&
				Boolean(asString(record.question))
			)
		})
		? itemsCount
		: null
}

type AdapterDefinition = {
	endpoint: string
	terminalStatusContract: string
	resultContract: string
	validateResult: (result: JsonRecord | null, input: unknown) => number | null
}

const adapterDefinitions: Record<DataForSeoAdapterKey, AdapterDefinition> = {
	'ai_optimization.llm_mentions.search.live': {
		endpoint: '/v3/ai_optimization/llm_mentions/search/live',
		terminalStatusContract: 'llm_mentions_search_terminal_status_unconfirmed',
		resultContract: 'llm_mentions_search_result_invalid',
		validateResult: (result, input) =>
			validLlmMentionsItemsCount(
				result,
				input as DataForSeoLlmMentionsSearchInput,
			),
	},
	'backlinks.bulk_ranks.live': {
		endpoint: '/v3/backlinks/bulk_ranks/live',
		terminalStatusContract: 'bulk_ranks_terminal_status_unconfirmed',
		resultContract: 'bulk_ranks_result_invalid',
		validateResult: (result, input) =>
			validBulkRanksItemsCount(result, input as DataForSeoBulkRanksInput),
	},
	'backlinks.referring_domains.live': {
		endpoint: '/v3/backlinks/referring_domains/live',
		terminalStatusContract: 'referring_domains_terminal_status_unconfirmed',
		resultContract: 'referring_domains_result_invalid',
		validateResult: (result, input) =>
			validReferringDomainsItemsCount(
				result,
				input as DataForSeoReferringDomainsInput,
			),
	},
	'backlinks.summary.live': {
		endpoint: '/v3/backlinks/summary/live',
		terminalStatusContract: 'backlinks_summary_terminal_status_unconfirmed',
		resultContract: 'backlinks_summary_result_invalid',
		validateResult: (result, input) =>
			validSummaryItemsCount(result, input as DataForSeoBacklinkSummaryInput),
	},
	'serp.google.organic.live.advanced': {
		endpoint: '/v3/serp/google/organic/live/advanced',
		terminalStatusContract: 'serp_google_organic_terminal_status_unconfirmed',
		resultContract: 'serp_google_organic_result_invalid',
		validateResult: (result, input) =>
			validSerpItemsCount(result, input as DataForSeoSerpInput),
	},
}

function parseCostMicros(raw: unknown): number | null {
	if (typeof raw !== 'number' && typeof raw !== 'string') return null
	try {
		return parseUsdMicros(String(raw))
	} catch {
		return null
	}
}

function readCostReport(
	payload: JsonRecord,
	task: JsonRecord | null,
): { costMicros: number | null; costIsConfirmed: boolean } {
	const topCostMicros = parseCostMicros(payload.cost)
	const taskCostMicros = parseCostMicros(task?.cost)
	if (
		topCostMicros !== null &&
		taskCostMicros !== null &&
		topCostMicros === taskCostMicros
	) {
		return { costMicros: topCostMicros, costIsConfirmed: true }
	}
	const observed = [topCostMicros, taskCostMicros].filter(
		(value): value is number => value !== null,
	)
	return {
		costMicros: observed.length > 0 ? Math.max(...observed) : null,
		costIsConfirmed: false,
	}
}

function providerDetails(options: {
	httpStatus: number
	providerCode?: number | null
	providerRequestId?: string | null
}): Record<string, unknown> {
	const details: Record<string, unknown> = { httpStatus: options.httpStatus }
	if (options.providerCode !== null && options.providerCode !== undefined) {
		details.providerCode = options.providerCode
	}
	if (options.providerRequestId) {
		details.providerRequestId = options.providerRequestId
	}
	return details
}

function httpFailure(
	status: number,
	providerRequestId: string | null,
	rawBytes: Uint8Array,
	costMicros: number | null,
	costIsConfirmed: boolean,
): DataForSeoDispatchFailure | null {
	const details = providerDetails({ httpStatus: status, providerRequestId })
	if (status === 401 || status === 403) {
		return {
			ok: false,
			code: 'AUTH_FAILED',
			message: 'DataForSEO rejected the configured credentials.',
			retryable: false,
			outcome: 'confirmed',
			details,
			rawBytes,
			providerRequestId,
			costMicros,
			costIsConfirmed,
		}
	}
	if (status === 429) {
		return {
			ok: false,
			code: 'RATE_LIMITED',
			message: 'DataForSEO rate-limited the request.',
			retryable: false,
			outcome: 'confirmed',
			details,
			rawBytes,
			providerRequestId,
			costMicros,
			costIsConfirmed,
		}
	}
	if (status === 408 || status >= 500) {
		return {
			ok: false,
			code: 'UNKNOWN_OUTCOME',
			message:
				'DataForSEO returned an HTTP response that did not confirm the request outcome.',
			retryable: false,
			outcome: 'unknown',
			details,
			rawBytes,
			providerRequestId,
			costMicros,
			costIsConfirmed,
		}
	}
	if (status >= 400 && status < 500) {
		return {
			ok: false,
			code: 'PROVIDER_ERROR',
			message: 'DataForSEO returned an HTTP error.',
			retryable: false,
			outcome: 'confirmed',
			details,
			rawBytes,
			providerRequestId,
			costMicros,
			costIsConfirmed,
		}
	}
	if (status < 200 || status >= 300) {
		return {
			ok: false,
			code: 'UNKNOWN_OUTCOME',
			message:
				'DataForSEO returned an HTTP response that did not confirm the request outcome.',
			retryable: false,
			outcome: 'unknown',
			details,
			rawBytes,
			providerRequestId,
			costMicros,
			costIsConfirmed,
		}
	}
	return null
}

export async function dispatchDataForSeo(options: {
	adapterKey: DataForSeoAdapterKey
	input: unknown
	credentials: DataForSeoCredentials
	environment: DataForSeoEnvironment
	signal: AbortSignal
	fetch?: DataForSeoFetch
	timeoutMs?: number
}): Promise<DataForSeoDispatchResult> {
	const definition = adapterDefinitions[options.adapterKey]
	const fetchImplementation = options.fetch ?? globalThis.fetch
	const timeoutMs = options.timeoutMs ?? defaultDataForSeoTimeoutMs
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
		throw new RangeError(
			'DataForSEO timeoutMs must be a positive safe integer.',
		)
	}
	const authorization = Buffer.from(
		`${options.credentials.login}:${options.credentials.password}`,
		'utf8',
	).toString('base64')

	const dispatchSignal = createDispatchSignal(options.signal, timeoutMs)
	let response: Response
	let rawBytes: Uint8Array
	try {
		response = await fetchImplementation(
			`${origins[options.environment]}${definition.endpoint}`,
			{
				method: 'POST',
				headers: {
					authorization: `Basic ${authorization}`,
					'content-type': 'application/json',
				},
				body: JSON.stringify([options.input]),
				signal: dispatchSignal.signal,
			},
		)
		rawBytes = new Uint8Array(await response.arrayBuffer())
	} catch {
		const timedOut = dispatchSignal.timedOut()
		return {
			ok: false,
			code: timedOut
				? 'TIMEOUT'
				: options.signal.aborted
					? 'UNKNOWN_OUTCOME'
					: 'NETWORK_ERROR',
			message: timedOut
				? 'The dispatched DataForSEO request exceeded its deadline before the outcome was confirmed.'
				: options.signal.aborted
					? 'The dispatched DataForSEO request was interrupted before its outcome was confirmed.'
					: 'The dispatched DataForSEO request ended without a confirmed provider outcome.',
			retryable: false,
			outcome: 'unknown',
			details: null,
			rawBytes: null,
			providerRequestId: null,
			costMicros: null,
			costIsConfirmed: false,
		}
	} finally {
		dispatchSignal.dispose()
	}

	let payload: JsonRecord
	try {
		payload = asRecord(JSON.parse(Buffer.from(rawBytes).toString('utf8'))) ?? {}
	} catch {
		const failedHttp = httpFailure(response.status, null, rawBytes, null, false)
		if (failedHttp) return failedHttp
		return {
			ok: false,
			code: 'UNKNOWN_OUTCOME',
			message:
				'DataForSEO returned a response whose spend outcome could not be parsed.',
			retryable: false,
			outcome: 'unknown',
			details: providerDetails({ httpStatus: response.status }),
			rawBytes,
			providerRequestId: null,
			costMicros: null,
			costIsConfirmed: false,
		}
	}

	const { task, cardinalityIsValid } = readSingleTask(payload)
	const providerRequestId = asTaskId(task?.id)
	const costReport = readCostReport(payload, task)
	const failedHttp = httpFailure(
		response.status,
		providerRequestId,
		rawBytes,
		costReport.costMicros,
		costReport.costIsConfirmed,
	)
	if (failedHttp) return failedHttp

	if (!cardinalityIsValid) {
		return {
			ok: false,
			code: 'UNKNOWN_OUTCOME',
			message:
				'DataForSEO returned an unexpected task cardinality for a single-task request.',
			retryable: false,
			outcome: 'unknown',
			details: {
				...providerDetails({ httpStatus: response.status }),
				contract: 'dataforseo_task_cardinality_invalid',
			},
			rawBytes,
			providerRequestId: null,
			costMicros: costReport.costMicros,
			costIsConfirmed: false,
		}
	}

	const topStatus = asNumber(payload.status_code)
	const taskStatus = asNumber(task?.status_code)
	const providerCode =
		taskStatus !== null && taskStatus >= 40_000
			? taskStatus
			: topStatus !== null && topStatus >= 40_000
				? topStatus
				: null
	if (providerCode !== null) {
		return {
			ok: false,
			code: 'PROVIDER_ERROR',
			message: 'DataForSEO rejected the request.',
			retryable: false,
			outcome: 'confirmed',
			details: providerDetails({
				httpStatus: response.status,
				providerCode,
				providerRequestId,
			}),
			rawBytes,
			providerRequestId,
			costMicros: costReport.costMicros,
			costIsConfirmed: costReport.costIsConfirmed,
		}
	}

	if (
		topStatus !== 20_000 ||
		taskStatus !== 20_000 ||
		asNumber(payload.tasks_error) !== 0
	) {
		return {
			ok: false,
			code: 'UNKNOWN_OUTCOME',
			message: 'DataForSEO did not confirm a terminal successful result.',
			retryable: false,
			outcome: 'unknown',
			details: {
				...providerDetails({
					httpStatus: response.status,
					providerRequestId,
				}),
				contract: definition.terminalStatusContract,
			},
			rawBytes,
			providerRequestId,
			costMicros: costReport.costMicros,
			costIsConfirmed: costReport.costIsConfirmed,
		}
	}

	if (providerRequestId === null) {
		return {
			ok: false,
			code: 'PROVIDER_ERROR',
			message:
				'DataForSEO returned a terminal task without a valid task identifier.',
			retryable: false,
			outcome: 'confirmed',
			details: {
				...providerDetails({ httpStatus: response.status }),
				contract: 'dataforseo_task_id_invalid',
			},
			rawBytes,
			providerRequestId: null,
			costMicros: costReport.costMicros,
			costIsConfirmed: costReport.costIsConfirmed,
		}
	}

	const result = singleResult(task)
	const itemsCount = definition.validateResult(result, options.input)
	if (itemsCount === null) {
		return {
			ok: false,
			code: 'PROVIDER_ERROR',
			message:
				'DataForSEO returned a successful status with an invalid reviewed result.',
			retryable: false,
			outcome: 'confirmed',
			details: {
				...providerDetails({
					httpStatus: response.status,
					providerRequestId,
				}),
				contract: definition.resultContract,
			},
			rawBytes,
			providerRequestId,
			costMicros: costReport.costMicros,
			costIsConfirmed: costReport.costIsConfirmed,
		}
	}
	if (!costReport.costIsConfirmed) {
		return {
			ok: false,
			code: 'PROVIDER_ERROR',
			message:
				'DataForSEO confirmed the result but did not provide one consistent spend amount.',
			retryable: false,
			outcome: 'confirmed',
			details: {
				...providerDetails({
					httpStatus: response.status,
					providerRequestId,
				}),
				contract: 'dataforseo_cost_unconfirmed',
			},
			rawBytes,
			providerRequestId,
			costMicros: costReport.costMicros,
			costIsConfirmed: false,
		}
	}
	return {
		ok: true,
		rawBytes,
		providerRequestId,
		costMicros: costReport.costMicros,
		costIsConfirmed: true,
		data: {
			itemsCount,
		},
	}
}

export async function dispatchDataForSeoBulkRanks(options: {
	input: DataForSeoBulkRanksInput
	credentials: DataForSeoCredentials
	environment: DataForSeoEnvironment
	signal: AbortSignal
	fetch?: DataForSeoFetch
	timeoutMs?: number
}): Promise<DataForSeoDispatchResult> {
	return await dispatchDataForSeo({
		...options,
		adapterKey: 'backlinks.bulk_ranks.live',
	})
}

function createDispatchSignal(
	externalSignal: AbortSignal,
	timeoutMs: number,
): {
	signal: AbortSignal
	timedOut(): boolean
	dispose(): void
} {
	const controller = new AbortController()
	let didTimeOut = false
	const onExternalAbort = (): void => {
		controller.abort(externalSignal.reason)
	}
	if (externalSignal.aborted) onExternalAbort()
	else externalSignal.addEventListener('abort', onExternalAbort, { once: true })

	const timer = setTimeout(() => {
		didTimeOut = true
		controller.abort(new Error('DataForSEO request deadline exceeded.'))
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
