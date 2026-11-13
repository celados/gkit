import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import {
	buildBoundedHogQl,
	dispatchPostHog,
	type PostHogFetch,
} from './posthog'

function response(
	payload: unknown,
	status = 200,
	requestId = 'req_123',
): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'x-posthog-request-id': requestId },
	})
}

const baseOptions = {
	input: {
		query: 'SELECT event, count() FROM events GROUP BY event',
		limit: 10,
	},
	config: { host: 'https://us.posthog.com' as const, projectId: '12345' },
	credentials: { apiToken: 'phx_secret' },
	signal: new AbortController().signal,
}

describe('PostHog reviewed query transport', () => {
	it('appends the caller bound exactly once', () => {
		expect(buildBoundedHogQl({ query: ' SELECT 1; ', limit: 7 })).toBe(
			'SELECT 1 LIMIT 7',
		)
		expect(() =>
			buildBoundedHogQl({ query: 'SELECT 1 LIMIT 1', limit: 7 }),
		).toThrow()
		expect(() =>
			buildBoundedHogQl({ query: 'DELETE FROM events', limit: 7 }),
		).toThrow()
		expect(() =>
			buildBoundedHogQl({ query: 'SELECT 1; SELECT 2', limit: 7 }),
		).toThrow()
	})

	it('uses the fixed project endpoint, bearer token, request body, and exact response bytes', async () => {
		const raw = JSON.stringify({
			columns: ['event', 'count()'],
			results: [['$pageview', 4]],
		})
		const calls: Array<Parameters<PostHogFetch>> = []
		const result = await dispatchPostHog({
			...baseOptions,
			fetch: async (...args) => {
				calls.push(args)
				return new Response(raw, {
					headers: { 'x-posthog-request-id': 'req_123' },
				})
			},
		})

		expect(calls[0]?.[0]).toBe(
			'https://us.posthog.com/api/projects/12345/query/',
		)
		expect(calls[0]?.[1]?.headers).toMatchObject({
			authorization: 'Bearer phx_secret',
			'content-type': 'application/json',
		})
		expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({
			query: {
				kind: 'HogQLQuery',
				query: 'SELECT event, count() FROM events GROUP BY event LIMIT 10',
			},
		})
		expect(result).toMatchObject({
			ok: true,
			providerRequestId: 'req_123',
			data: { rowCount: 1, columnCount: 2 },
		})
		if (result.ok)
			expect(Buffer.from(result.rawBytes).toString('utf8')).toBe(raw)
	})

	it.each([
		{ status: 401, code: 'AUTH_FAILED', outcome: 'confirmed' },
		{ status: 429, code: 'RATE_LIMITED', outcome: 'confirmed' },
		{ status: 503, code: 'UNKNOWN_OUTCOME', outcome: 'unknown' },
	])(
		'maps HTTP $status without exposing provider text',
		async ({ status, code, outcome }) => {
			const result = await dispatchPostHog({
				...baseOptions,
				fetch: async () => response({ detail: 'unsafe provider text' }, status),
			})
			expect(result).toMatchObject({
				ok: false,
				code,
				outcome,
				details: { httpStatus: status },
			})
			expect(JSON.stringify(result)).not.toContain('unsafe provider text')
		},
	)

	it('rejects malformed success bodies and unsafe request ids', async () => {
		const result = await dispatchPostHog({
			...baseOptions,
			fetch: async () =>
				response(
					{ columns: ['event', 'count()'], results: [['$pageview']] },
					200,
					'bad id\n',
				),
		})
		expect(result).toMatchObject({
			ok: false,
			code: 'PROVIDER_ERROR',
			outcome: 'confirmed',
			providerRequestId: null,
			details: { contract: 'posthog_hogql_result_invalid' },
		})
	})

	it('treats non-JSON success and network failures as unknown outcomes', async () => {
		const nonJson = await dispatchPostHog({
			...baseOptions,
			fetch: async () => new Response('not-json', { status: 200 }),
		})
		expect(nonJson).toMatchObject({
			ok: false,
			code: 'UNKNOWN_OUTCOME',
			outcome: 'unknown',
		})

		const network = await dispatchPostHog({
			...baseOptions,
			fetch: async () => {
				throw new Error('phx_secret provider failure')
			},
		})
		expect(network).toMatchObject({
			ok: false,
			code: 'NETWORK_ERROR',
			outcome: 'unknown',
		})
		expect(JSON.stringify(network)).not.toContain('phx_secret')
	})
})
