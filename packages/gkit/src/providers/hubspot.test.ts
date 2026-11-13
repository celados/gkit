import { describe, expect, it, vi } from 'vitest'

import {
	createHubSpotOperation,
	dispatchHubSpot,
	planHubSpotRequest,
} from './hubspot'

describe('HubSpot adapter', () => {
	it('keeps CRM Search as a bounded POST and aggregates provider cursors', async () => {
		const requests: Array<{ url: string; body: Record<string, unknown> }> = []
		const fetch = vi
			.fn()
			.mockImplementationOnce(
				async (input: string | URL | Request, init?: RequestInit) => {
					requests.push({
						url: String(input),
						body: JSON.parse(String(init?.body)),
					})
					return new Response(
						JSON.stringify({
							total: 3,
							results: [{ id: '1' }, { id: '2' }],
							paging: {
								next: { after: '2', link: 'https://attacker.invalid/ignored' },
							},
						}),
						{
							status: 200,
							headers: { 'x-hubspot-correlation-id': 'request_1' },
						},
					)
				},
			)
			.mockImplementationOnce(
				async (input: string | URL | Request, init?: RequestInit) => {
					requests.push({
						url: String(input),
						body: JSON.parse(String(init?.body)),
					})
					return new Response(
						JSON.stringify({ total: 3, results: [{ id: '3' }] }),
						{
							status: 200,
							headers: { 'x-hubspot-correlation-id': 'request_2' },
						},
					)
				},
			)

		const operation = createHubSpotOperation('crm.objects.search', {
			objectType: 'contacts',
			properties: ['email', 'lifecyclestage'],
			filterGroups: [
				{
					filters: [
						{
							propertyName: 'lifecyclestage',
							operator: 'EQ',
							value: 'customer',
						},
					],
				},
			],
			pageSize: 2,
			limit: 3,
		})
		const result = await dispatchHubSpot({
			operation,
			config: {},
			credentials: { accessToken: 'private-secret' },
			signal: new AbortController().signal,
			fetch,
		})

		expect(requests).toEqual([
			{
				url: 'https://api.hubapi.com/crm/objects/2026-03/contacts/search',
				body: {
					properties: ['email', 'lifecyclestage'],
					filterGroups: [
						{
							filters: [
								{
									propertyName: 'lifecyclestage',
									operator: 'EQ',
									value: 'customer',
								},
							],
						},
					],
					limit: 2,
				},
			},
			{
				url: 'https://api.hubapi.com/crm/objects/2026-03/contacts/search',
				body: {
					properties: ['email', 'lifecyclestage'],
					filterGroups: [
						{
							filters: [
								{
									propertyName: 'lifecyclestage',
									operator: 'EQ',
									value: 'customer',
								},
							],
						},
					],
					limit: 1,
					after: '2',
				},
			},
		])
		expect(result).toMatchObject({
			ok: true,
			data: { pages: 2, rowCount: 3 },
			providerRequestId: 'request_2',
		})
		expect(JSON.stringify(result)).not.toContain('private-secret')
		expect(new TextDecoder().decode(result.rawBytes!)).toContain(
			'attacker.invalid/ignored',
		)
	})

	it('rejects unreviewed objects and object-specific properties before dispatch', async () => {
		expect(() =>
			createHubSpotOperation('crm.objects.list', {
				objectType: 'products',
				properties: [],
				limit: 1,
			}),
		).toThrow('objectType')
		expect(() =>
			createHubSpotOperation('crm.objects.list', {
				objectType: 'contacts',
				properties: ['hs_sensitive_data'],
				limit: 1,
			}),
		).toThrow('property')
	})

	it('enforces HubSpot Search page, query, filter, and total-result bounds', () => {
		expect(() =>
			createHubSpotOperation('crm.objects.search', {
				objectType: 'contacts',
				properties: ['email'],
				pageSize: 201,
				limit: 1,
			}),
		).toThrow('pageSize')
		expect(() =>
			createHubSpotOperation('crm.objects.search', {
				objectType: 'contacts',
				properties: ['email'],
				pageSize: 1,
				limit: 10_001,
			}),
		).toThrow('10000')
		expect(() =>
			createHubSpotOperation('crm.objects.search', {
				objectType: 'contacts',
				properties: ['email'],
				query: 'x'.repeat(3_001),
				pageSize: 1,
				limit: 1,
			}),
		).toThrow('3000')
	})

	it('uses only fixed current-version endpoints for every reviewed operation', () => {
		expect(
			planHubSpotRequest(
				createHubSpotOperation('crm.properties.list', {
					objectType: 'companies',
				}),
				{},
			),
		).toEqual({
			method: 'GET',
			endpoint: 'https://api.hubapi.com/crm/properties/2026-03/companies',
		})
		expect(
			planHubSpotRequest(
				createHubSpotOperation('crm.associations.list', {
					fromObjectType: 'contacts',
					objectId: '123',
					toObjectType: 'companies',
					limit: 10,
				}),
				{},
			),
		).toEqual({
			method: 'GET',
			endpoint:
				'https://api.hubapi.com/crm/objects/2026-03/contacts/123/associations/companies',
		})
		expect(
			planHubSpotRequest(
				createHubSpotOperation('events.occurrences.list', {
					occurredAfter: '2026-08-01T00:00:00Z',
					occurredBefore: '2026-08-02T00:00:00Z',
					properties: ['hs_url'],
					limit: 10,
				}),
				{},
			),
		).toEqual({
			method: 'GET',
			endpoint: 'https://api.hubapi.com/events/event-occurrences/2026-03',
		})
		expect(
			planHubSpotRequest(
				createHubSpotOperation('crm.pipelines.list', { objectType: 'deals' }),
				{},
			),
		).toEqual({
			method: 'GET',
			endpoint: 'https://api.hubapi.com/crm/pipelines/2026-03/deals',
		})
		expect(
			planHubSpotRequest(
				createHubSpotOperation('crm.owners.list', { limit: 10 }),
				{},
			),
		).toEqual({
			method: 'GET',
			endpoint: 'https://api.hubapi.com/crm/owners/2026-03',
		})
	})

	it('requires an allowlisted event property projection', async () => {
		expect(() =>
			createHubSpotOperation('events.occurrences.list', {
				occurredAfter: '2026-08-01T00:00:00Z',
				occurredBefore: '2026-08-02T00:00:00Z',
				properties: ['email'],
				limit: 1,
			}),
		).toThrow('event property')

		let capturedUrl = ''
		await dispatchHubSpot({
			operation: createHubSpotOperation('events.occurrences.list', {
				occurredAfter: '2026-08-01T00:00:00Z',
				occurredBefore: '2026-08-02T00:00:00Z',
				objectType: 'contact',
				objectId: '123',
				properties: ['hs_url', 'hs_page_title'],
				limit: 1,
			}),
			config: {},
			credentials: { accessToken: 'private-secret' },
			signal: new AbortController().signal,
			fetch: async (input) => {
				capturedUrl = String(input)
				return new Response(JSON.stringify({ results: [] }), { status: 200 })
			},
		})

		const url = new URL(capturedUrl)
		expect(url.origin + url.pathname).toBe(
			'https://api.hubapi.com/events/event-occurrences/2026-03',
		)
		expect(url.searchParams.getAll('properties')).toEqual([
			'hs_url',
			'hs_page_title',
		])
		expect(url.searchParams.get('objectType')).toBe('contact')
		expect(url.searchParams.get('objectId')).toBe('123')
	})

	it('maps timeout and post-handoff cancellation to unknown outcomes', async () => {
		const fetch = async (
			_input: string | URL | Request,
			init?: RequestInit,
		): Promise<Response> =>
			await new Promise((_resolve, reject) => {
				init?.signal?.addEventListener(
					'abort',
					() => reject(new Error('aborted')),
					{ once: true },
				)
			})
		const operation = createHubSpotOperation('crm.owners.list', { limit: 1 })
		const timedOut = await dispatchHubSpot({
			operation,
			config: {},
			credentials: { accessToken: 'private-secret' },
			signal: new AbortController().signal,
			fetch,
			timeoutMs: 1,
		})
		expect(timedOut).toMatchObject({
			ok: false,
			code: 'TIMEOUT',
			retryable: true,
			outcome: 'unknown',
		})

		const controller = new AbortController()
		const cancelledPromise = dispatchHubSpot({
			operation,
			config: {},
			credentials: { accessToken: 'private-secret' },
			signal: controller.signal,
			fetch,
		})
		controller.abort()
		await expect(cancelledPromise).resolves.toMatchObject({
			ok: false,
			code: 'UNKNOWN_OUTCOME',
			outcome: 'unknown',
		})
	})

	it.each([
		[401, 'AUTH_FAILED', false],
		[403, 'AUTH_FAILED', false],
		[429, 'RATE_LIMITED', true],
		[400, 'PROVIDER_ERROR', false],
		[500, 'UNKNOWN_OUTCOME', true],
	] as const)(
		'maps HTTP %i without projecting provider PII',
		async (status, code, retryable) => {
			const result = await dispatchHubSpot({
				operation: createHubSpotOperation('crm.owners.list', { limit: 1 }),
				config: {},
				credentials: { accessToken: 'private-secret' },
				signal: new AbortController().signal,
				fetch: async () =>
					new Response(
						JSON.stringify({
							status: 'error',
							category: 'VALIDATION_ERROR',
							correlationId: 'safe-correlation',
							message: 'contact person@example.com token private-secret',
							context: { email: ['person@example.com'] },
						}),
						{ status },
					),
			})

			expect(result).toMatchObject({
				ok: false,
				code,
				retryable,
				details: {
					httpStatus: status,
					providerCategory: 'VALIDATION_ERROR',
				},
				providerRequestId: 'safe-correlation',
			})
			expect(JSON.stringify(result)).not.toContain('person@example.com')
			expect(JSON.stringify(result)).not.toContain('private-secret')
		},
	)
})
