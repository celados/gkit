import { describe, expect, it, vi } from 'vitest'

import {
	dispatchDataForSeo,
	dispatchDataForSeoBulkRanks,
	type DataForSeoFetch,
} from './dataforseo'

describe('DataForSEO reviewed adapter routing', () => {
	it.each([
		{
			adapterKey: 'ai_optimization.llm_mentions.search.live' as const,
			endpoint: '/v3/ai_optimization/llm_mentions/search/live',
			input: {
				target: [{ domain: 'clonesite.ai', search_filter: 'include' as const }],
				location_code: 2840 as const,
				language_code: 'en' as const,
				platform: 'chat_gpt' as const,
				limit: 10,
			},
			cost: 0.1,
			result: {
				total_count: 1,
				items_count: 1,
				items: [
					{
						platform: 'chat_gpt',
						model_name: 'gpt-4o-search-preview',
						location_code: 2840,
						language_code: 'en',
						question: 'What is the best website cloning service?',
					},
				],
			},
			itemsCount: 1,
		},
		{
			adapterKey: 'backlinks.summary.live' as const,
			endpoint: '/v3/backlinks/summary/live',
			input: { target: 'clonesite.ai' },
			cost: 0.024036,
			result: {
				target: 'clonesite.ai',
				rank: 42,
				backlinks: 12,
				referring_domains: 4,
			},
			itemsCount: 1,
		},
		{
			adapterKey: 'backlinks.referring_domains.live' as const,
			endpoint: '/v3/backlinks/referring_domains/live',
			input: { target: 'clonesite.ai', limit: 2, order_by: ['rank,desc'] },
			cost: 0.024072,
			result: {
				target: 'clonesite.ai',
				items_count: 2,
				items: [
					{ domain: 'example.com', rank: 80, backlinks: 5 },
					{ domain: 'example.org', rank: 70, backlinks: 2 },
				],
			},
			itemsCount: 2,
		},
		{
			adapterKey: 'serp.google.organic.live.advanced' as const,
			endpoint: '/v3/serp/google/organic/live/advanced',
			input: {
				keyword: 'website cloner',
				location_code: 2840,
				language_code: 'en',
				device: 'desktop' as const,
				os: 'windows' as const,
				depth: 10,
			},
			cost: 0.002,
			result: {
				keyword: 'website cloner',
				location_code: 2840,
				language_code: 'en',
				items_count: 1,
				items: [{ type: 'organic', rank_group: 1 }],
			},
			itemsCount: 1,
		},
	])('routes and validates $adapterKey', async (fixture) => {
		const calls: Array<Parameters<DataForSeoFetch>> = []
		const result = await dispatchDataForSeo({
			adapterKey: fixture.adapterKey,
			input: fixture.input,
			credentials: { login: 'login', password: 'password' },
			environment: 'sandbox',
			signal: new AbortController().signal,
			fetch: async (...args) => {
				calls.push(args)
				return response({
					status_code: 20_000,
					cost: fixture.cost,
					tasks_count: 1,
					tasks_error: 0,
					tasks: [
						{
							id: successTaskId,
							status_code: 20_000,
							cost: fixture.cost,
							result_count: 1,
							result: [fixture.result],
						},
					],
				})
			},
		})

		expect(calls[0]?.[0]).toBe(
			`https://sandbox.dataforseo.com${fixture.endpoint}`,
		)
		expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual([fixture.input])
		expect(result).toMatchObject({
			ok: true,
			costIsConfirmed: true,
			data: { itemsCount: fixture.itemsCount },
		})
	})
})

const input = {
	targets: ['clonesite.ai', 'example.com'],
	rank_scale: 'one_hundred' as const,
}
const successTaskId = '10131644-1535-0347-0000-750206cf57d8'
const errorTaskId = '10131644-1535-0347-0000-750206cf57d9'
const malformedTaskId = '10131644-1535-0347-0000-750206cf57da'
const createdTaskId = '10131644-1535-0347-0000-750206cf57db'

function response(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	})
}

describe('DataForSEO bulk ranks transport', () => {
	it('uses the fixed sandbox origin, wraps one task, and returns exact bytes', async () => {
		const payload = {
			status_code: 20_000,
			cost: 0.024072,
			tasks_count: 1,
			tasks_error: 0,
			tasks: [
				{
					id: successTaskId,
					status_code: 20_000,
					cost: 0.024072,
					result_count: 1,
					result: [
						{
							items_count: 2,
							items: [
								{ target: 'clonesite.ai', rank: 51 },
								{ target: 'example.com', rank: 61 },
							],
						},
					],
				},
			],
		}
		const raw = JSON.stringify(payload)
		const calls: Array<Parameters<DataForSeoFetch>> = []
		const fetch: DataForSeoFetch = async (...args) => {
			calls.push(args)
			return new Response(raw, { status: 200 })
		}

		const result = await dispatchDataForSeoBulkRanks({
			input,
			credentials: { login: 'login', password: 'password' },
			environment: 'sandbox',
			signal: new AbortController().signal,
			fetch,
		})

		expect(calls).toHaveLength(1)
		const [url, init] = calls[0]!
		expect(url).toBe(
			'https://sandbox.dataforseo.com/v3/backlinks/bulk_ranks/live',
		)
		expect(JSON.parse(String(init?.body))).toEqual([input])
		expect(init?.headers).toMatchObject({ 'content-type': 'application/json' })
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(Buffer.from(result.rawBytes).toString('utf8')).toBe(raw)
			expect(result.costMicros).toBe(24_072)
			expect(result.providerRequestId).toBe(successTaskId)
			expect(result.data.itemsCount).toBe(2)
		}
	})

	it('treats an HTTP 200 task error as a confirmed provider error', async () => {
		const result = await dispatchDataForSeoBulkRanks({
			input,
			credentials: { login: 'login', password: 'password' },
			environment: 'production',
			signal: new AbortController().signal,
			fetch: async () =>
				response({
					status_code: 20_000,
					cost: 0,
					tasks_count: 1,
					tasks_error: 1,
					tasks: [
						{
							id: errorTaskId,
							status_code: 40_204,
							cost: 0,
							status_message: 'unsafe provider text is deliberately ignored',
						},
					],
				}),
		})

		expect(result).toMatchObject({
			ok: false,
			code: 'PROVIDER_ERROR',
			outcome: 'confirmed',
			costMicros: 0,
			providerRequestId: errorTaskId,
			details: { providerCode: 40_204, providerRequestId: errorTaskId },
		})
		expect(JSON.stringify(result)).not.toContain('unsafe provider text')
	})

	it('does not report business success when the bulk-ranks result is missing', async () => {
		const result = await dispatchDataForSeoBulkRanks({
			input,
			credentials: { login: 'login', password: 'password' },
			environment: 'production',
			signal: new AbortController().signal,
			fetch: async () =>
				response({
					status_code: 20_000,
					cost: 0.024072,
					tasks_count: 1,
					tasks_error: 0,
					tasks: [
						{
							id: malformedTaskId,
							status_code: 20_000,
							cost: 0.024072,
							result_count: 0,
							result: null,
						},
					],
				}),
		})

		expect(result).toMatchObject({
			ok: false,
			code: 'PROVIDER_ERROR',
			outcome: 'confirmed',
			costMicros: 24_072,
			providerRequestId: malformedTaskId,
			details: { contract: 'bulk_ranks_result_invalid' },
		})
	})

	it('does not report business success for a non-terminal task-created status', async () => {
		const result = await dispatchDataForSeoBulkRanks({
			input,
			credentials: { login: 'login', password: 'password' },
			environment: 'production',
			signal: new AbortController().signal,
			fetch: async () =>
				response({
					status_code: 20_000,
					cost: 0.024072,
					tasks_count: 1,
					tasks_error: 0,
					tasks: [
						{
							id: createdTaskId,
							status_code: 20_100,
							cost: 0.024072,
							result_count: 1,
							result: [
								{
									items_count: 2,
									items: [
										{ target: 'clonesite.ai', rank: 51 },
										{ target: 'example.com', rank: 61 },
									],
								},
							],
						},
					],
				}),
		})

		expect(result).toMatchObject({
			ok: false,
			code: 'UNKNOWN_OUTCOME',
			outcome: 'unknown',
			costMicros: 24_072,
			providerRequestId: createdTaskId,
			details: { contract: 'bulk_ranks_terminal_status_unconfirmed' },
		})
	})

	it('rejects a terminal response without the documented UUID task identifier', async () => {
		const result = await dispatchDataForSeoBulkRanks({
			input,
			credentials: { login: 'login', password: 'password' },
			environment: 'production',
			signal: new AbortController().signal,
			fetch: async () =>
				response({
					status_code: 20_000,
					cost: 0.024072,
					tasks_count: 1,
					tasks_error: 0,
					tasks: [
						{
							id: 'not-a-task-uuid',
							status_code: 20_000,
							cost: 0.024072,
							result_count: 1,
							result: [
								{
									items_count: 2,
									items: [
										{ target: 'clonesite.ai', rank: 51 },
										{ target: 'example.com', rank: 61 },
									],
								},
							],
						},
					],
				}),
		})

		expect(result).toMatchObject({
			ok: false,
			code: 'PROVIDER_ERROR',
			outcome: 'confirmed',
			providerRequestId: null,
			details: { contract: 'dataforseo_task_id_invalid' },
		})
	})

	it('keeps a terminal result with an invalid cost in unknown reconciliation state', async () => {
		const result = await dispatchDataForSeoBulkRanks({
			input,
			credentials: { login: 'login', password: 'password' },
			environment: 'production',
			signal: new AbortController().signal,
			fetch: async () =>
				response({
					status_code: 20_000,
					cost: 'not-a-cost',
					tasks_count: 1,
					tasks_error: 0,
					tasks: [
						{
							id: successTaskId,
							status_code: 20_000,
							cost: 'not-a-cost',
							result_count: 1,
							result: [
								{
									items_count: 2,
									items: [
										{ target: 'clonesite.ai', rank: 51 },
										{ target: 'example.com', rank: 61 },
									],
								},
							],
						},
					],
				}),
		})

		expect(result).toMatchObject({
			ok: false,
			code: 'PROVIDER_ERROR',
			outcome: 'confirmed',
			costMicros: null,
			costIsConfirmed: false,
			providerRequestId: successTaskId,
			details: { contract: 'dataforseo_cost_unconfirmed' },
		})
	})

	it('fails closed on extra tasks or inconsistent top-level and task costs', async () => {
		const extraTaskResult = await dispatchDataForSeoBulkRanks({
			input,
			credentials: { login: 'login', password: 'password' },
			environment: 'production',
			signal: new AbortController().signal,
			fetch: async () =>
				response({
					status_code: 20_000,
					cost: 1.024,
					tasks_count: 2,
					tasks_error: 0,
					tasks: [
						{
							id: successTaskId,
							status_code: 20_000,
							cost: 0.024,
							result_count: 1,
							result: [
								{
									items_count: 2,
									items: [
										{ target: 'clonesite.ai', rank: 51 },
										{ target: 'example.com', rank: 61 },
									],
								},
							],
						},
						{
							id: createdTaskId,
							status_code: 20_000,
							cost: 1,
							result_count: 0,
							result: [],
						},
					],
				}),
		})
		expect(extraTaskResult).toMatchObject({
			ok: false,
			code: 'UNKNOWN_OUTCOME',
			outcome: 'unknown',
			costMicros: 1_024_000,
			costIsConfirmed: false,
			details: { contract: 'dataforseo_task_cardinality_invalid' },
		})

		const inconsistentCostResult = await dispatchDataForSeoBulkRanks({
			input,
			credentials: { login: 'login', password: 'password' },
			environment: 'production',
			signal: new AbortController().signal,
			fetch: async () =>
				response({
					status_code: 20_000,
					cost: 1.024,
					tasks_count: 1,
					tasks_error: 0,
					tasks: [
						{
							id: successTaskId,
							status_code: 20_000,
							cost: 0.024,
							result_count: 1,
							result: [
								{
									items_count: 2,
									items: [
										{ target: 'clonesite.ai', rank: 51 },
										{ target: 'example.com', rank: 61 },
									],
								},
							],
						},
					],
				}),
		})
		expect(inconsistentCostResult).toMatchObject({
			ok: false,
			code: 'PROVIDER_ERROR',
			outcome: 'confirmed',
			costMicros: 1_024_000,
			costIsConfirmed: false,
			details: { contract: 'dataforseo_cost_unconfirmed' },
		})
	})

	it('maps credentials and rate-limit responses without retrying spend', async () => {
		const auth = await dispatchDataForSeoBulkRanks({
			input,
			credentials: { login: 'login', password: 'password' },
			environment: 'production',
			signal: new AbortController().signal,
			fetch: async () => response({}, 401),
		})
		expect(auth).toMatchObject({
			ok: false,
			code: 'AUTH_FAILED',
			retryable: false,
		})

		const limited = await dispatchDataForSeoBulkRanks({
			input,
			credentials: { login: 'login', password: 'password' },
			environment: 'production',
			signal: new AbortController().signal,
			fetch: async () => response({}, 429),
		})
		expect(limited).toMatchObject({
			ok: false,
			code: 'RATE_LIMITED',
			retryable: false,
		})

		const nonJsonAuth = await dispatchDataForSeoBulkRanks({
			input,
			credentials: { login: 'login', password: 'password' },
			environment: 'production',
			signal: new AbortController().signal,
			fetch: async () => new Response('Unauthorized', { status: 401 }),
		})
		expect(nonJsonAuth).toMatchObject({
			ok: false,
			code: 'AUTH_FAILED',
			outcome: 'confirmed',
		})

		const serverError = await dispatchDataForSeoBulkRanks({
			input,
			credentials: { login: 'login', password: 'password' },
			environment: 'production',
			signal: new AbortController().signal,
			fetch: async () => new Response('gateway failure', { status: 500 }),
		})
		expect(serverError).toMatchObject({
			ok: false,
			code: 'UNKNOWN_OUTCOME',
			outcome: 'unknown',
			retryable: false,
		})
	})

	it('marks a post-dispatch connection failure as unknown and never retries', async () => {
		const fetch = vi.fn(async () => {
			throw new TypeError('connection reset')
		}) as unknown as DataForSeoFetch
		const result = await dispatchDataForSeoBulkRanks({
			input,
			credentials: { login: 'login', password: 'password' },
			environment: 'production',
			signal: new AbortController().signal,
			fetch,
		})

		expect(fetch).toHaveBeenCalledTimes(1)
		expect(result).toMatchObject({
			ok: false,
			code: 'NETWORK_ERROR',
			retryable: false,
			outcome: 'unknown',
			costMicros: null,
		})
	})

	it('enforces a transport deadline and classifies timeout without retry', async () => {
		let calls = 0
		const fetch: DataForSeoFetch = async (_request, init) => {
			calls++
			return await new Promise<Response>((_resolveResponse, rejectResponse) => {
				init?.signal?.addEventListener(
					'abort',
					() => rejectResponse(new Error('aborted by deadline')),
					{ once: true },
				)
			})
		}
		const result = await dispatchDataForSeoBulkRanks({
			input,
			credentials: { login: 'login', password: 'password' },
			environment: 'production',
			signal: new AbortController().signal,
			fetch,
			timeoutMs: 5,
		})

		expect(calls).toBe(1)
		expect(result).toMatchObject({
			ok: false,
			code: 'TIMEOUT',
			retryable: false,
			outcome: 'unknown',
			costMicros: null,
		})
	})
})
