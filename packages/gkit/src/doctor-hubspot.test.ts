import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { runHubSpotDoctor } from './doctor'
import { serializeEnvelope } from './envelope'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	)
})

describe('HubSpot doctor', () => {
	it('probes only fixed account details and redacts the token', async () => {
		const fixture = await createFixture()
		let capturedUrl = ''
		const result = await runHubSpotDoctor({
			profileFlag: 'app-a',
			env: { TEST_HUBSPOT_ACCESS_TOKEN: 'private-secret' },
			xdgConfigHome: fixture.xdgConfigHome,
			signal: new AbortController().signal,
			fetch: async (input, init) => {
				capturedUrl = String(input)
				expect(new Headers(init?.headers).get('authorization')).toBe(
					'Bearer private-secret',
				)
				return new Response(
					JSON.stringify({
						portalId: 123456,
						accountType: 'STANDARD',
						timeZone: 'Asia/Singapore',
						companyCurrency: 'SGD',
					}),
					{
						status: 200,
						headers: { 'x-hubspot-correlation-id': 'doctor_123' },
					},
				)
			},
		})

		expect(capturedUrl).toBe(
			'https://api.hubapi.com/account-info/2026-03/details',
		)
		expect(result.envelope).toMatchObject({
			ok: true,
			data: {
				provider: 'hubspot',
				portalId: '123456',
				authMode: 'private_app_token',
				networkProbe: 'connected',
			},
			meta: { provider: 'hubspot', providerRequestId: 'doctor_123' },
		})
		expect(serializeEnvelope(result.envelope, result.secrets)).not.toContain(
			'private-secret',
		)
	})

	it.each([
		[401, 'AUTH_FAILED', false],
		[403, 'AUTH_FAILED', false],
		[429, 'RATE_LIMITED', true],
		[400, 'PROVIDER_ERROR', false],
		[500, 'UNKNOWN_OUTCOME', true],
	] as const)(
		'maps safe connectivity HTTP %i',
		async (status, code, retryable) => {
			const fixture = await createFixture()
			const result = await runHubSpotDoctor({
				profileFlag: 'app-a',
				env: { TEST_HUBSPOT_ACCESS_TOKEN: 'private-secret' },
				xdgConfigHome: fixture.xdgConfigHome,
				signal: new AbortController().signal,
				fetch: async () =>
					new Response(
						JSON.stringify({
							category: 'MISSING_SCOPES',
							correlationId: 'doctor_error',
							message: 'person@example.com private-secret',
						}),
						{ status },
					),
			})

			expect(result.envelope).toMatchObject({
				ok: false,
				error: { code, retryable },
				meta: { providerRequestId: 'doctor_error' },
			})
			const serialized = serializeEnvelope(result.envelope, result.secrets)
			expect(serialized).not.toContain('person@example.com')
			expect(serialized).not.toContain('private-secret')
		},
	)

	it('reports a bounded connectivity timeout without leaking the token', async () => {
		const fixture = await createFixture()
		const result = await runHubSpotDoctor({
			profileFlag: 'app-a',
			env: { TEST_HUBSPOT_ACCESS_TOKEN: 'private-secret' },
			xdgConfigHome: fixture.xdgConfigHome,
			signal: new AbortController().signal,
			timeoutMs: 1,
			fetch: async (_input, init) =>
				await new Promise((_resolve, reject) => {
					init?.signal?.addEventListener(
						'abort',
						() => reject(new Error('aborted')),
						{
							once: true,
						},
					)
				}),
		})

		expect(result.envelope).toMatchObject({
			ok: false,
			error: { code: 'TIMEOUT', retryable: true, outcome: 'unknown' },
		})
		expect(serializeEnvelope(result.envelope, result.secrets)).not.toContain(
			'private-secret',
		)
	})
})

async function createFixture() {
	const root = await mkdtemp(join(tmpdir(), 'gkit-hubspot-doctor-'))
	temporaryDirectories.push(root)
	const xdgConfigHome = join(root, 'config')
	const profilePath = join(xdgConfigHome, 'gkit/profiles/app-a.json')
	await mkdir(dirname(profilePath), { recursive: true })
	await writeFile(
		profilePath,
		JSON.stringify({
			version: 1,
			name: 'app-a',
			providers: {
				hubspot: {
					config: {},
					policy: {},
					secrets: { accessToken: 'env:TEST_HUBSPOT_ACCESS_TOKEN' },
				},
			},
		}),
	)
	return { root, xdgConfigHome }
}
