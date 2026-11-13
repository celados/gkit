import { Buffer } from 'node:buffer'

import type { RawJsonDispatchResult } from './raw-json'

export type HubSpotConfig = Readonly<Record<string, never>>
export type HubSpotCredentials = Readonly<{ accessToken: string }>
export type HubSpotFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>
export type HubSpotOperation = Readonly<{
	adapterKey: string
	input: Readonly<Record<string, unknown>>
	request: HubSpotRequestDefinition
}>

type HubSpotRequestDefinition = Readonly<{
	method: 'GET' | 'POST'
	endpoint: string
	pageSize: number | null
	totalLimit: number | null
	query: Readonly<Record<string, string | readonly string[]>>
	body: Readonly<Record<string, unknown>> | null
}>

type ObjectType = 'companies' | 'contacts' | 'deals' | 'tickets'
type EventObjectType = 'company' | 'contact' | 'deal' | 'ticket'

const defaultHubSpotTimeoutMs = 30_000
const hubSpotApiOrigin = 'https://api.hubapi.com'

const objectTypes = new Set<ObjectType>([
	'companies',
	'contacts',
	'deals',
	'tickets',
])
const pipelineObjectTypes = new Set(['deals', 'tickets'])
const eventObjectTypes = new Set<EventObjectType>([
	'company',
	'contact',
	'deal',
	'ticket',
])
const eventProperties = new Set([
	'hs_browser',
	'hs_city',
	'hs_content_type',
	'hs_country',
	'hs_device_name',
	'hs_device_type',
	'hs_page_title',
	'hs_referrer',
	'hs_touchpoint_source',
	'hs_url',
	'hs_utm_campaign',
	'hs_utm_medium',
	'hs_utm_source',
])
const searchOperators = new Set([
	'BETWEEN',
	'CONTAINS_TOKEN',
	'EQ',
	'GT',
	'GTE',
	'HAS_PROPERTY',
	'IN',
	'LT',
	'LTE',
	'NEQ',
	'NOT_CONTAINS_TOKEN',
	'NOT_HAS_PROPERTY',
	'NOT_IN',
])

const hubSpotPropertyAllowlist: Readonly<
	Record<ObjectType, ReadonlySet<string>>
> = Object.freeze({
	contacts: new Set([
		'createdate',
		'email',
		'firstname',
		'hs_analytics_source',
		'hs_analytics_source_data_1',
		'hs_analytics_source_data_2',
		'hs_lead_status',
		'hs_object_id',
		'hubspot_owner_id',
		'lastmodifieddate',
		'lastname',
		'lifecyclestage',
	]),
	companies: new Set([
		'city',
		'country',
		'createdate',
		'domain',
		'hs_lastmodifieddate',
		'hs_object_id',
		'hubspot_owner_id',
		'industry',
		'lifecyclestage',
		'name',
		'numberofemployees',
		'state',
	]),
	deals: new Set([
		'amount',
		'closedate',
		'createdate',
		'dealname',
		'dealstage',
		'hs_lastmodifieddate',
		'hs_object_id',
		'hubspot_owner_id',
		'pipeline',
	]),
	tickets: new Set([
		'content',
		'createdate',
		'hs_lastmodifieddate',
		'hs_object_id',
		'hs_pipeline',
		'hs_pipeline_stage',
		'hs_ticket_category',
		'hs_ticket_priority',
		'hubspot_owner_id',
		'subject',
	]),
})

export function createHubSpotOperation(
	adapterKey: string,
	input: Readonly<Record<string, unknown>>,
): HubSpotOperation {
	const request = buildRequestDefinition(adapterKey, input)
	return Object.freeze({
		adapterKey,
		input: Object.freeze({ ...input }),
		request,
	})
}

export function planHubSpotRequest(
	operation: HubSpotOperation,
	_config: HubSpotConfig,
): { method: 'GET' | 'POST'; endpoint: string } {
	return {
		method: operation.request.method,
		endpoint: operation.request.endpoint,
	}
}

export async function dispatchHubSpot(options: {
	operation: HubSpotOperation
	config: HubSpotConfig
	credentials: HubSpotCredentials
	signal: AbortSignal
	fetch?: HubSpotFetch
	timeoutMs?: number
}): Promise<RawJsonDispatchResult> {
	const timeoutMs = options.timeoutMs ?? defaultHubSpotTimeoutMs
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
		throw new RangeError('HubSpot timeoutMs must be a positive safe integer.')
	}

	const dispatchSignal = createDispatchSignal(options.signal, timeoutMs)
	const pageBytes: Uint8Array[] = []
	let rowCount = 0
	let remaining = options.operation.request.totalLimit
	let after: string | null = null
	let providerRequestId: string | null = null
	let hasMore = false

	try {
		while (true) {
			const request = materializeRequest(
				options.operation.request,
				after,
				remaining,
			)
			let response: Response
			let rawBytes: Uint8Array
			try {
				response = await (options.fetch ?? globalThis.fetch)(request.url, {
					method: request.method,
					headers: {
						authorization: `Bearer ${options.credentials.accessToken}`,
						accept: 'application/json',
						...(request.body ? { 'content-type': 'application/json' } : {}),
					},
					...(request.body ? { body: JSON.stringify(request.body) } : {}),
					signal: dispatchSignal.signal,
				})
				rawBytes = new Uint8Array(await response.arrayBuffer())
			} catch {
				return transportFailure(options.signal, dispatchSignal.timedOut())
			}

			const payload = parseJson(rawBytes)
			providerRequestId =
				safeRequestId(response, payload, options.credentials.accessToken) ??
				providerRequestId
			if (!response.ok) {
				return httpFailure(response, rawBytes, payload, providerRequestId)
			}
			if (!isRecord(payload)) {
				return failure({
					code: 'PROVIDER_ERROR',
					message:
						'HubSpot returned a successful status with an invalid result shape.',
					outcome: 'confirmed',
					rawBytes,
					providerRequestId,
					details: {
						httpStatus: response.status,
						contract: 'hubspot_result_invalid',
					},
				})
			}

			const rows = payload.results
			if (!Array.isArray(rows)) {
				return failure({
					code: 'PROVIDER_ERROR',
					message:
						'HubSpot returned a successful status without a result collection.',
					outcome: 'confirmed',
					rawBytes,
					providerRequestId,
					details: {
						httpStatus: response.status,
						contract: 'hubspot_collection_invalid',
					},
				})
			}
			pageBytes.push(rawBytes)
			rowCount += rows.length
			if (remaining !== null) remaining -= rows.length

			const next = nextCursor(payload)
			hasMore = next !== null
			if (!next || remaining === null || remaining <= 0 || rows.length === 0)
				break
			after = next
		}
	} finally {
		dispatchSignal.dispose()
	}

	return {
		ok: true,
		rawBytes: jsonArrayOfExactPages(pageBytes),
		providerRequestId,
		data: {
			pages: pageBytes.length,
			rowCount,
			truncated: hasMore && remaining === 0,
		},
	}
}

function buildRequestDefinition(
	adapterKey: string,
	input: Readonly<Record<string, unknown>>,
): HubSpotRequestDefinition {
	if (adapterKey === 'crm.properties.list') {
		const objectType = requiredObjectType(input, 'objectType')
		return requestDefinition(
			'GET',
			`${hubSpotApiOrigin}/crm/properties/2026-03/${objectType}`,
		)
	}
	if (adapterKey === 'crm.objects.list') {
		const objectType = requiredObjectType(input, 'objectType')
		const properties = validatedProperties(input, objectType)
		return requestDefinition(
			'GET',
			`${hubSpotApiOrigin}/crm/objects/2026-03/${objectType}`,
			boundedInteger(input, 'pageSize', 1, 100, 100),
			boundedInteger(input, 'limit', 1, 5_000, 100),
			{
				...(properties.length > 0 ? { properties } : {}),
				...(input.archived === true ? { archived: 'true' } : {}),
			},
		)
	}
	if (adapterKey === 'crm.objects.search') {
		const objectType = requiredObjectType(input, 'objectType')
		const properties = validatedProperties(input, objectType)
		const pageSize = boundedInteger(input, 'pageSize', 1, 200, 100)
		const totalLimit = boundedInteger(input, 'limit', 1, 10_000, 100)
		const body = searchBody(input, objectType, properties)
		assertSearchBodySize({ ...body, limit: pageSize, after: 'x'.repeat(512) })
		return requestDefinition(
			'POST',
			`${hubSpotApiOrigin}/crm/objects/2026-03/${objectType}/search`,
			pageSize,
			totalLimit,
			{},
			body,
		)
	}
	if (adapterKey === 'crm.associations.list') {
		const fromObjectType = requiredObjectType(input, 'fromObjectType')
		const toObjectType = requiredObjectType(input, 'toObjectType')
		const objectId = requiredIdentifier(input, 'objectId')
		return requestDefinition(
			'GET',
			`${hubSpotApiOrigin}/crm/objects/2026-03/${fromObjectType}/${encodeURIComponent(objectId)}/associations/${toObjectType}`,
			boundedInteger(input, 'pageSize', 1, 100, 100),
			boundedInteger(input, 'limit', 1, 5_000, 100),
		)
	}
	if (adapterKey === 'events.occurrences.list') {
		const occurredAfter = requiredDateTime(input, 'occurredAfter')
		const occurredBefore = requiredDateTime(input, 'occurredBefore')
		if (Date.parse(occurredAfter) >= Date.parse(occurredBefore)) {
			throw new TypeError(
				'HubSpot occurredAfter must be earlier than occurredBefore.',
			)
		}
		if (
			Date.parse(occurredBefore) - Date.parse(occurredAfter) >
			366 * 24 * 60 * 60 * 1_000
		) {
			throw new RangeError(
				'HubSpot event occurrence windows must not exceed 366 days.',
			)
		}
		const objectType = optionalEventObjectType(input, 'objectType')
		const objectId = optionalIdentifier(input, 'objectId')
		if (objectId && !objectType) {
			throw new TypeError('HubSpot objectId requires objectType.')
		}
		const properties = requiredEventProperties(input)
		return requestDefinition(
			'GET',
			`${hubSpotApiOrigin}/events/event-occurrences/2026-03`,
			boundedInteger(input, 'pageSize', 1, 100, 100),
			boundedInteger(input, 'limit', 1, 5_000, 100),
			{
				occurredAfter,
				occurredBefore,
				...(optionalString(input, 'eventType')
					? { eventType: optionalString(input, 'eventType')! }
					: {}),
				...(objectType ? { objectType } : {}),
				...(objectId ? { objectId } : {}),
				properties,
			},
		)
	}
	if (adapterKey === 'crm.pipelines.list') {
		const objectType = requiredString(input, 'objectType')
		if (!pipelineObjectTypes.has(objectType)) {
			throw new TypeError(
				'HubSpot pipeline objectType must be deals or tickets.',
			)
		}
		return requestDefinition(
			'GET',
			`${hubSpotApiOrigin}/crm/pipelines/2026-03/${objectType}`,
		)
	}
	if (adapterKey === 'crm.owners.list') {
		return requestDefinition(
			'GET',
			`${hubSpotApiOrigin}/crm/owners/2026-03`,
			boundedInteger(input, 'pageSize', 1, 100, 100),
			boundedInteger(input, 'limit', 1, 5_000, 100),
			input.archived === true ? { archived: 'true' } : {},
		)
	}
	throw new TypeError('HubSpot adapter key is not reviewed.')
}

function searchBody(
	input: Readonly<Record<string, unknown>>,
	objectType: ObjectType,
	properties: readonly string[],
): Readonly<Record<string, unknown>> {
	const body: Record<string, unknown> = {}
	if (properties.length > 0) body.properties = properties
	const rawQuery = input.query
	if (
		rawQuery !== undefined &&
		(typeof rawQuery !== 'string' || rawQuery.length === 0)
	) {
		throw new TypeError('HubSpot Search query must be a non-empty string.')
	}
	const query = typeof rawQuery === 'string' ? rawQuery : null
	if (query) {
		if (query.length > 3_000)
			throw new RangeError(
				'HubSpot Search query must not exceed 3000 characters.',
			)
		body.query = query
	}
	if (input.sorts !== undefined) {
		if (!Array.isArray(input.sorts) || input.sorts.length > 1) {
			throw new TypeError('HubSpot Search accepts at most one sort.')
		}
		body.sorts = input.sorts.map((sort) => validateSort(sort, objectType))
	}
	if (input.filterGroups !== undefined) {
		body.filterGroups = validateFilterGroups(input.filterGroups, objectType)
	}
	return Object.freeze(body)
}

function validateSort(
	value: unknown,
	objectType: ObjectType,
): Record<string, string> {
	if (!isRecord(value))
		throw new TypeError('HubSpot Search sort must be an object.')
	const propertyName = requiredString(value, 'propertyName')
	assertAllowedProperty(objectType, propertyName)
	const direction = requiredString(value, 'direction')
	if (direction !== 'ASCENDING' && direction !== 'DESCENDING') {
		throw new TypeError('HubSpot Search sort direction is not reviewed.')
	}
	return { propertyName, direction }
}

function validateFilterGroups(
	value: unknown,
	objectType: ObjectType,
): unknown[] {
	if (!Array.isArray(value) || value.length > 5) {
		throw new TypeError('HubSpot Search accepts at most five filter groups.')
	}
	let filterCount = 0
	return value.map((group) => {
		if (
			!isRecord(group) ||
			!Array.isArray(group.filters) ||
			group.filters.length > 6
		) {
			throw new TypeError(
				'HubSpot Search filter groups accept at most six filters.',
			)
		}
		filterCount += group.filters.length
		if (filterCount > 18)
			throw new TypeError('HubSpot Search accepts at most 18 filters.')
		return {
			filters: group.filters.map((filter) =>
				validateFilter(filter, objectType),
			),
		}
	})
}

function validateFilter(
	value: unknown,
	objectType: ObjectType,
): Record<string, unknown> {
	if (!isRecord(value))
		throw new TypeError('HubSpot Search filter must be an object.')
	const propertyName = requiredString(value, 'propertyName')
	assertAllowedProperty(objectType, propertyName)
	const operator = requiredString(value, 'operator')
	if (!searchOperators.has(operator))
		throw new TypeError('HubSpot Search operator is not reviewed.')
	const filter: Record<string, unknown> = { propertyName, operator }
	for (const key of ['value', 'highValue'] as const) {
		if (value[key] !== undefined) filter[key] = requiredString(value, key)
	}
	if (value.values !== undefined) {
		if (
			!Array.isArray(value.values) ||
			value.values.length > 100 ||
			!value.values.every(isString)
		) {
			throw new TypeError(
				'HubSpot Search filter values must be a bounded string array.',
			)
		}
		filter.values = value.values
	}
	return filter
}

function requestDefinition(
	method: 'GET' | 'POST',
	endpoint: string,
	pageSize: number | null = null,
	totalLimit: number | null = null,
	query: Readonly<Record<string, string | readonly string[]>> = {},
	body: Readonly<Record<string, unknown>> | null = null,
): HubSpotRequestDefinition {
	return Object.freeze({ method, endpoint, pageSize, totalLimit, query, body })
}

function materializeRequest(
	definition: HubSpotRequestDefinition,
	after: string | null,
	remaining: number | null,
): {
	method: 'GET' | 'POST'
	url: string
	body: Record<string, unknown> | null
} {
	const pageLimit =
		definition.pageSize === null || remaining === null
			? definition.pageSize
			: Math.min(definition.pageSize, remaining)
	if (definition.method === 'POST') {
		const body = {
			...(definition.body ?? {}),
			...(pageLimit === null ? {} : { limit: pageLimit }),
			...(after ? { after } : {}),
		}
		assertSearchBodySize(body)
		return { method: 'POST', url: definition.endpoint, body }
	}
	const url = new URL(definition.endpoint)
	for (const [key, value] of Object.entries(definition.query)) {
		if (Array.isArray(value)) {
			for (const child of value) url.searchParams.append(key, child)
		} else {
			url.searchParams.set(key, value as string)
		}
	}
	if (pageLimit !== null) url.searchParams.set('limit', String(pageLimit))
	if (after) url.searchParams.set('after', after)
	return { method: 'GET', url: url.toString(), body: null }
}

function assertSearchBodySize(body: Readonly<Record<string, unknown>>): void {
	if (JSON.stringify(body).length > 3_000) {
		throw new RangeError(
			'HubSpot Search request body must not exceed 3000 characters.',
		)
	}
}

function validatedProperties(
	input: Readonly<Record<string, unknown>>,
	objectType: ObjectType,
): readonly string[] {
	if (
		!Array.isArray(input.properties) ||
		input.properties.length < 1 ||
		input.properties.length > 50 ||
		!input.properties.every(isString)
	) {
		throw new TypeError('HubSpot properties must be a bounded string array.')
	}
	for (const property of input.properties)
		assertAllowedProperty(objectType, property)
	return [...new Set(input.properties)]
}

function assertAllowedProperty(objectType: ObjectType, property: string): void {
	if (!hubSpotPropertyAllowlist[objectType].has(property)) {
		throw new TypeError(
			`HubSpot property ${property} is not reviewed for ${objectType}.`,
		)
	}
}

function requiredObjectType(
	input: Readonly<Record<string, unknown>>,
	key: string,
): ObjectType {
	const value = requiredString(input, key)
	if (!objectTypes.has(value as ObjectType)) {
		throw new TypeError('HubSpot objectType is not in the reviewed allowlist.')
	}
	return value as ObjectType
}

function optionalEventObjectType(
	input: Readonly<Record<string, unknown>>,
	key: string,
): EventObjectType | null {
	const value = optionalString(input, key)
	if (!value) return null
	if (!eventObjectTypes.has(value as EventObjectType)) {
		throw new TypeError(
			'HubSpot event objectType is not in the reviewed allowlist.',
		)
	}
	return value as EventObjectType
}

function requiredEventProperties(
	input: Readonly<Record<string, unknown>>,
): readonly string[] {
	const value = input.properties
	if (
		!Array.isArray(value) ||
		value.length < 1 ||
		value.length > 20 ||
		!value.every(isString)
	) {
		throw new TypeError(
			'HubSpot event properties must be a bounded reviewed string array.',
		)
	}
	for (const property of value) {
		if (!eventProperties.has(property)) {
			throw new TypeError(`HubSpot event property ${property} is not reviewed.`)
		}
	}
	return [...new Set(value)]
}

function requiredIdentifier(
	input: Readonly<Record<string, unknown>>,
	key: string,
): string {
	const value = requiredString(input, key)
	if (!/^[1-9]\d{0,19}$/.test(value))
		throw new TypeError(`HubSpot ${key} must be a record ID.`)
	return value
}

function optionalIdentifier(
	input: Readonly<Record<string, unknown>>,
	key: string,
): string | null {
	const value = optionalString(input, key)
	if (!value) return null
	if (!/^[1-9]\d{0,19}$/.test(value))
		throw new TypeError(`HubSpot ${key} must be a record ID.`)
	return value
}

function requiredDateTime(
	input: Readonly<Record<string, unknown>>,
	key: string,
): string {
	const value = requiredString(input, key)
	if (!Number.isFinite(Date.parse(value)) || value.length > 64) {
		throw new TypeError(`HubSpot ${key} must be an ISO 8601 date-time.`)
	}
	return value
}

function boundedInteger(
	input: Readonly<Record<string, unknown>>,
	key: string,
	minimum: number,
	maximum: number,
	fallback: number,
): number {
	const value = input[key] ?? fallback
	if (
		!Number.isSafeInteger(value) ||
		(value as number) < minimum ||
		(value as number) > maximum
	) {
		throw new RangeError(
			`HubSpot ${key} must be an integer between ${minimum} and ${maximum}.`,
		)
	}
	return value as number
}

function requiredString(
	input: Readonly<Record<string, unknown>>,
	key: string,
): string {
	const value = optionalString(input, key)
	if (!value) throw new TypeError(`HubSpot ${key} is required.`)
	return value
}

function optionalString(
	input: Readonly<Record<string, unknown>>,
	key: string,
): string | null {
	const value = input[key]
	return typeof value === 'string' && value.length > 0 && value.length <= 3_000
		? value
		: null
}

function isString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 3_000
}

function parseJson(rawBytes: Uint8Array): unknown {
	try {
		return JSON.parse(Buffer.from(rawBytes).toString('utf8')) as unknown
	} catch {
		return null
	}
}

function jsonArrayOfExactPages(pages: readonly Uint8Array[]): Uint8Array {
	const chunks: Uint8Array[] = [Buffer.from('[', 'utf8')]
	for (const [index, page] of pages.entries()) {
		if (index > 0) chunks.push(Buffer.from(',', 'utf8'))
		chunks.push(page)
	}
	chunks.push(Buffer.from(']', 'utf8'))
	return Buffer.concat(chunks)
}

function nextCursor(payload: Record<string, unknown>): string | null {
	if (!isRecord(payload.paging) || !isRecord(payload.paging.next)) return null
	const after = payload.paging.next.after
	return typeof after === 'string' && /^[A-Za-z0-9._:-]{1,512}$/.test(after)
		? after
		: null
}

function safeRequestId(
	response: Response,
	payload: unknown,
	accessToken: string,
): string | null {
	const header =
		response.headers.get('x-hubspot-correlation-id') ??
		response.headers.get('x-request-id')
	if (
		header &&
		header !== accessToken &&
		/^[A-Za-z0-9._:-]{1,128}$/.test(header)
	)
		return header
	if (!isRecord(payload)) return null
	const correlationId = payload.correlationId
	return typeof correlationId === 'string' &&
		correlationId !== accessToken &&
		/^[A-Za-z0-9._:-]{1,128}$/.test(correlationId)
		? correlationId
		: null
}

function safeErrorDetails(payload: unknown): Record<string, unknown> {
	if (!isRecord(payload)) return {}
	const category = payload.category
	return typeof category === 'string' && /^[A-Z0-9_]{1,80}$/.test(category)
		? { providerCategory: category }
		: {}
}

function httpFailure(
	response: Response,
	rawBytes: Uint8Array,
	payload: unknown,
	providerRequestId: string | null,
): RawJsonDispatchResult {
	const status = response.status
	const code =
		status === 401 || status === 403
			? 'AUTH_FAILED'
			: status === 429
				? 'RATE_LIMITED'
				: status === 408 || status >= 500
					? 'UNKNOWN_OUTCOME'
					: 'PROVIDER_ERROR'
	return failure({
		code,
		message:
			code === 'AUTH_FAILED'
				? 'HubSpot rejected the configured credentials or scopes.'
				: code === 'RATE_LIMITED'
					? 'HubSpot rejected the request because its rate limit was reached.'
					: code === 'UNKNOWN_OUTCOME'
						? 'HubSpot did not confirm the read outcome.'
						: 'HubSpot rejected the read request.',
		outcome: code === 'UNKNOWN_OUTCOME' ? 'unknown' : 'confirmed',
		rawBytes,
		providerRequestId,
		details: { httpStatus: status, ...safeErrorDetails(payload) },
	})
}

function transportFailure(
	signal: AbortSignal,
	timedOut: boolean,
): RawJsonDispatchResult {
	return failure({
		code: timedOut
			? 'TIMEOUT'
			: signal.aborted
				? 'UNKNOWN_OUTCOME'
				: 'NETWORK_ERROR',
		message: timedOut
			? 'The HubSpot request exceeded its deadline before the outcome was confirmed.'
			: signal.aborted
				? 'The HubSpot request was interrupted before the outcome was confirmed.'
				: 'The HubSpot request ended without a confirmed provider outcome.',
		outcome: 'unknown',
	})
}

function failure(options: {
	code: Extract<RawJsonDispatchResult, { ok: false }>['code']
	message: string
	outcome: Extract<RawJsonDispatchResult, { ok: false }>['outcome']
	details?: Record<string, unknown> | null
	rawBytes?: Uint8Array | null
	providerRequestId?: string | null
}): RawJsonDispatchResult {
	return {
		ok: false,
		code: options.code,
		message: options.message,
		retryable:
			options.code === 'RATE_LIMITED' ||
			options.code === 'NETWORK_ERROR' ||
			options.code === 'TIMEOUT' ||
			options.code === 'UNKNOWN_OUTCOME',
		outcome: options.outcome,
		details: options.details ?? null,
		rawBytes: options.rawBytes ?? null,
		providerRequestId: options.providerRequestId ?? null,
	}
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
		controller.abort(new Error('HubSpot request deadline exceeded.'))
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}
