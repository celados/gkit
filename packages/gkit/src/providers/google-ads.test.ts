import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import {
	createGoogleAdsDispatch,
	type GoogleAdsFetch,
	type GoogleAdsOperation,
} from './google-ads'

const config = { customerId: '1234567890' }
const credentials = {
	developerToken: 'developer_secret',
	accessToken: 'access_secret',
}
const signal = new AbortController().signal

async function collect(operation: GoogleAdsOperation, fetch: GoogleAdsFetch) {
	const dispatch = createGoogleAdsDispatch({
		operation,
		config,
		credentials,
		signal,
		fetch,
	})
	const chunks: Uint8Array[] = []
	for await (const chunk of dispatch.source as AsyncIterable<
		string | Uint8Array
	>) {
		chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
	}
	return {
		artifact: Buffer.concat(chunks).toString('utf8'),
		result: await dispatch.result,
	}
}

describe('Google Ads reviewed REST transport', () => {
	it('uses the pinned origin/version and paginates GAQL without a manager header', async () => {
		const calls: Array<Parameters<GoogleAdsFetch>> = []
		const pages = [
			{ results: [{ campaign: { id: '1' } }], nextPageToken: 'next' },
			{ results: [{ campaign: { id: '2' } }] },
		]
		const output = await collect(
			{
				adapterKey: 'query.gaql',
				input: { query: 'SELECT campaign.id FROM campaign' },
			},
			async (...args) => {
				calls.push(args)
				return new Response(JSON.stringify(pages[calls.length - 1]), {
					headers: { 'request-id': `request_${calls.length}` },
				})
			},
		)

		expect(calls).toHaveLength(2)
		expect(calls[0]?.[0]).toBe(
			'https://googleads.googleapis.com/v24/customers/1234567890/googleAds:search',
		)
		expect(calls[0]?.[1]?.headers).toMatchObject({
			authorization: 'Bearer access_secret',
			'developer-token': 'developer_secret',
		})
		expect(calls[0]?.[1]?.headers).not.toHaveProperty('login-customer-id')
		expect(JSON.parse(String(calls[1]?.[1]?.body))).toEqual({
			query: 'SELECT campaign.id FROM campaign',
			pageToken: 'next',
		})
		expect(JSON.parse(output.artifact)).toEqual(pages)
		expect(output.result).toMatchObject({
			ok: true,
			data: { pages: 2, rowCount: 2 },
			providerRequestId: 'request_2',
		})
	})

	it('maps field describe and Keyword Planner to their exact v24 methods', async () => {
		const calls: string[] = []
		const fetch: GoogleAdsFetch = async (input) => {
			calls.push(String(input))
			return new Response(JSON.stringify({ results: [] }))
		}

		await collect(
			{ adapterKey: 'fields.describe', input: { name: 'campaign.id' } },
			fetch,
		)
		await collect(
			{
				adapterKey: 'keyword-plan.generate-ideas',
				input: { keywordSeed: { keywords: ['website cloner'] } },
			},
			fetch,
		)
		await collect(
			{
				adapterKey: 'keyword-plan.generate-historical-metrics',
				input: { keywords: ['website cloner'] },
			},
			fetch,
		)

		expect(calls).toEqual([
			'https://googleads.googleapis.com/v24/googleAdsFields:search',
			'https://googleads.googleapis.com/v24/customers/1234567890:generateKeywordIdeas',
			'https://googleads.googleapis.com/v24/customers/1234567890:generateKeywordHistoricalMetrics',
		])
	})

	it('projects provider errors without unsafe provider text', async () => {
		const output = await collect(
			{
				adapterKey: 'query.gaql',
				input: { query: 'SELECT bad.field FROM campaign' },
			},
			async () =>
				new Response(
					JSON.stringify({
						error: {
							code: 400,
							status: 'INVALID_ARGUMENT',
							message: 'unsafe provider detail',
							details: [
								{
									errors: [{ errorCode: { queryError: 'UNRECOGNIZED_FIELD' } }],
								},
							],
						},
					}),
					{ status: 400, headers: { 'request-id': 'request_error' } },
				),
		)

		expect(output.result).toMatchObject({
			ok: false,
			code: 'PROVIDER_ERROR',
			outcome: 'confirmed',
			details: {
				httpStatus: 400,
				status: 'INVALID_ARGUMENT',
				providerCode: 'queryError:UNRECOGNIZED_FIELD',
				requestId: 'request_error',
			},
		})
		expect(JSON.stringify(output.result)).not.toContain(
			'unsafe provider detail',
		)
	})

	it('treats unreadable successes and network failures as unknown', async () => {
		const unreadable = await collect(
			{ adapterKey: 'customers.list-accessible', input: {} },
			async () => new Response('not-json'),
		)
		expect(unreadable.result).toMatchObject({
			ok: false,
			code: 'UNKNOWN_OUTCOME',
			outcome: 'unknown',
		})

		const network = await collect(
			{ adapterKey: 'customers.list-accessible', input: {} },
			async () => {
				throw new Error('developer_secret access_secret')
			},
		)
		expect(network.result).toMatchObject({
			ok: false,
			code: 'NETWORK_ERROR',
			outcome: 'unknown',
		})
		expect(JSON.stringify(network.result)).not.toContain('developer_secret')
	})
})
